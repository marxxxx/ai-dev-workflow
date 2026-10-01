// Serena semantic checks inside an image.
//   node verify-semantic.mjs                     TypeScript, on a throwaway fixture and home
//   node verify-semantic.mjs csharp [--restore]  C#, on the project in /workspace, started the
//     way the launcher starts Serena (its managed SERENA_HOME on the home volume); run through
//     the normal entrypoint by docker/tests/semantic-csharp.mjs.
import { spawn, spawnSync } from 'node:child_process';
import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { once } from 'node:events';
import path from 'node:path';

const RUNTIME = '/usr/local/lib/agent-runtime';
const PROVISIONED_ROSLYN = '/opt/serena-runtime/ls/CSharpLanguageServer';

async function withSerena({ command, args, env, timeoutMs }, body) {
  const child = spawn(command, args, { env: { ...env, NO_COLOR: '1' }, stdio: ['pipe', 'pipe', 'pipe'] });
  let nextId = 1;
  let stdout = '';
  let stderr = '';
  const pending = new Map();
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`Timed out waiting for Serena semantic tools. stderr: ${stderr.slice(-4000)}`));
    }, timeoutMs);
  });

  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', chunk => { stderr += chunk; });
  child.stdout.on('data', chunk => {
    stdout += chunk;
    for (;;) {
      const newline = stdout.indexOf('\n');
      if (newline < 0) break;
      const line = stdout.slice(0, newline).trim();
      stdout = stdout.slice(newline + 1);
      if (!line.startsWith('{')) continue;
      const message = JSON.parse(line);
      const waiter = pending.get(message.id);
      if (waiter) {
        pending.delete(message.id);
        message.error ? waiter.reject(new Error(JSON.stringify(message.error))) : waiter.resolve(message.result);
      }
    }
  });

  function send(method, params = {}) {
    const id = nextId++;
    const result = new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    return result;
  }

  async function call(name, toolArguments) {
    const result = await send('tools/call', { name, arguments: toolArguments });
    const text = (result.content ?? []).map(part => part.text ?? '').join('\n');
    if (result.isError) throw new Error(`Serena ${name} failed: ${text}`);
    return text;
  }

  try {
    await Promise.race([(async () => {
      await send('initialize', {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'ai-dev-workflow-verifier', version: '1.0.0' },
      });
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} })}\n`);
      const listed = await send('tools/list');
      const names = new Set(listed.tools.map(tool => tool.name));
      for (const tool of ['get_symbols_overview', 'find_symbol', 'find_referencing_symbols']) {
        if (!names.has(tool)) throw new Error(`Serena did not expose ${tool}`);
      }
      await body(call);
    })(), timeout]);
  } finally {
    clearTimeout(timeoutId);
    child.stdin.end();
    child.kill('SIGTERM');
    await Promise.race([once(child, 'exit'), new Promise(resolve => setTimeout(resolve, 2_000))]);
    if (child.exitCode === null) child.kill('SIGKILL');
  }
}

async function verifyTypeScript() {
  const fixture = '/tmp/serena-typescript-fixture';
  await mkdir(fixture, { recursive: true });
  await writeFile(`${fixture}/sample.ts`, 'export function semanticAnswer(): number { return 42; }\n');
  await mkdir('/tmp/serena-home', { recursive: true });
  await copyFile('/opt/serena-runtime/serena_config.yml', '/tmp/serena-home/serena_config.yml');
  await withSerena({
    command: '/opt/uv/bin/serena',
    args: ['start-mcp-server', '--context', 'codex', '--project', fixture, '--enable-web-dashboard', 'false'],
    env: { ...process.env, HOME: '/tmp/serena-home', SERENA_HOME: '/tmp/serena-home' },
    timeoutMs: 45_000,
  }, async call => {
    const overview = await call('get_symbols_overview', { relative_path: 'sample.ts', depth: 1 });
    if (!overview.includes('semanticAnswer')) throw new Error(`Serena semantic result omitted semanticAnswer: ${overview}`);
  });
  console.log('Serena TypeScript semantics: ok');
}

function check(condition, message) {
  if (!condition) throw new Error(`C# semantic verification: ${message}`);
}

// The Serena server definition the launcher hands to an agent, not a hand-built one.
function launcherSerena() {
  const printed = spawnSync(process.execPath, [`${RUNTIME}/launch-agent.mjs`, 'claude'], {
    env: { ...process.env, AGENT_RUNTIME_PRINT_PLAN: '1' }, encoding: 'utf8',
  });
  check(printed.status === 0, `launcher plan failed: ${printed.stderr}`);
  const { args } = JSON.parse(printed.stdout);
  const config = JSON.parse(readFileSync(args[args.indexOf('--mcp-config') + 1], 'utf8'));
  return config.mcpServers.serena;
}

function findDirectories(root, name) {
  return readdirSync(root, { recursive: true, withFileTypes: true })
    .filter(entry => entry.isDirectory() && entry.name === name)
    .map(entry => path.join(entry.parentPath, entry.name));
}

function restoreFixture(workspace, home) {
  check(findDirectories(workspace, 'obj').length === 0 && findDirectories(workspace, 'bin').length === 0,
    'the project already holds bin/obj assets; it must start without host build output');
  check(!existsSync(process.env.NUGET_PACKAGES), `${process.env.NUGET_PACKAGES} exists; restore must start from an empty NuGet cache`);
  const restored = spawnSync('dotnet', ['restore', 'Fixture.slnx', '--configfile', 'nuget.config'], {
    cwd: workspace, encoding: 'utf8',
  });
  check(restored.status === 0, `dotnet restore failed:\n${restored.stdout}\n${restored.stderr}`);
  for (const project of ['Core', 'App']) {
    const assets = path.join(home, 'artifacts', 'obj', project, 'project.assets.json');
    check(existsSync(assets), `restore did not write ${assets}`);
  }
  check(findDirectories(workspace, 'obj').length === 0, 'restore wrote obj into the project tree instead of ArtifactsPath');
  console.log('C# fixture restored offline into ArtifactsPath');
}

async function verifyCSharp({ restore }) {
  const workspace = '/workspace';
  const home = process.env.HOME;
  check(process.getuid() !== 0, 'must run as the non-root runtime user');
  check(home === '/home/dev', `expected the runtime home /home/dev, got ${home}`);
  const serena = launcherSerena();
  const serenaHome = serena.env.SERENA_HOME;
  check(serenaHome.startsWith(`${home}/`), `launcher SERENA_HOME ${serenaHome} is not on the home volume`);

  const packages = readdirSync(PROVISIONED_ROSLYN);
  check(packages.length === 1, `expected one provisioned Roslyn package, found ${packages.join(', ')}`);
  const provisioned = path.join(PROVISIONED_ROSLYN, packages[0]);
  const link = path.join(serenaHome, 'language_servers', 'static', 'CSharpLanguageServer', packages[0]);
  check(lstatSync(link, { throwIfNoEntry: false })?.isSymbolicLink(), `${link} is not a symlink created at startup`);
  check(realpathSync(link) === provisioned, `${link} resolves to ${realpathSync(link)}, not ${provisioned}`);
  check(existsSync(path.join(link, 'Microsoft.CodeAnalysis.LanguageServer.dll')), 'the linked package has no server DLL');
  console.log(`Roslyn cache link: ${link} -> ${provisioned}`);

  if (restore) restoreFixture(workspace, home);

  await withSerena({ ...serena, env: { ...process.env, ...serena.env }, timeoutMs: 240_000 }, async call => {
    // File-scoped namespaces put the types one level below the namespace symbol.
    for (const [file, namespace, kind, name] of [
      ['Core/IGreeter.cs', 'Fixture.Core', 'Interface', 'IGreeter'],
      ['App/Consumer.cs', 'Fixture.App', 'Class', 'Consumer'],
    ]) {
      const overview = await call('get_symbols_overview', { relative_path: file, depth: 1 });
      const members = JSON.parse(overview).Namespace?.find(entry => entry[namespace])?.[namespace];
      check(members?.[kind]?.includes(name), `overview of ${file} omits ${kind} ${namespace}/${name}: ${overview}`);
    }

    const found = await call('find_symbol', { name_path_pattern: 'IGreeter' });
    const interfaces = JSON.parse(found).filter(symbol => symbol.kind === 'Interface')
      .map(symbol => `${symbol.relative_path}:${symbol.name_path}`).sort();
    check(JSON.stringify(interfaces) === JSON.stringify(['App/Legacy.cs:Fixture.App.Legacy/IGreeter', 'Core/IGreeter.cs:Fixture.Core/IGreeter']),
      `find_symbol IGreeter did not return both same-named interfaces: ${found}`);

    // Roslyn answers with in-project results only until it has loaded the project graph.
    let references;
    for (const deadline = Date.now() + 120_000; ;) {
      references = JSON.parse(await call('find_referencing_symbols', { name_path: 'IGreeter', relative_path: 'Core/IGreeter.cs' }));
      if (references['App/Consumer.cs'] || Date.now() > deadline) break;
      await new Promise(resolve => setTimeout(resolve, 3_000));
    }
    const rendered = JSON.stringify(references);
    check(JSON.stringify(Object.keys(references).sort()) === JSON.stringify(['App/Consumer.cs', 'Core/Greeter.cs']),
      `references to Fixture.Core/IGreeter must come from exactly App/Consumer.cs and Core/Greeter.cs (never App/Legacy.cs): ${rendered}`);
    const consumers = Object.values(references['App/Consumer.cs']).flat().map(symbol => symbol.name_path);
    check(consumers.length > 0 && consumers.every(name => name === 'Fixture.App/Consumer'),
      `cross-project references in App/Consumer.cs are not attributed to Fixture.App/Consumer: ${rendered}`);
  });
  console.log('Serena C# semantics: ok');
}

const [language = 'typescript', ...options] = process.argv.slice(2);
if (language === 'typescript') await verifyTypeScript();
else if (language === 'csharp') await verifyCSharp({ restore: options.includes('--restore') });
else throw new Error(`unknown language ${language}`);
