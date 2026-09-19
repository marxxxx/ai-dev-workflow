import { spawnSync } from 'node:child_process';
import {
  existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync,
  symlinkSync, writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const toolPackage = process.env.AGENT_TOOLS_PACKAGE
  ? pathToFileURL(process.env.AGENT_TOOLS_PACKAGE)
  : new URL('./tools/package.json', import.meta.url);
const require = createRequire(toolPackage);
const { parse: parseToml, stringify: stringifyToml } = require('smol-toml');
const { parse: parseJsonc, printParseErrorCode } = require('jsonc-parser');

const REAL_BIN = '/opt/agent-tools/node_modules/.bin';
const DEFAULT_WORKSPACE = '/workspace';
const DEFAULT_HOME = '/home/dev';
const DEFAULT_SUPERPOWERS = '/opt/superpowers';
const AGENTS = new Set(['codex', 'claude', 'opencode']);

function fail(message) {
  throw new Error(`agent runtime: ${message}`);
}

function readJson(file, label = file) {
  if (!existsSync(file)) return undefined;
  try { return JSON.parse(readFileSync(file, 'utf8')); }
  catch (error) { fail(`${label} is not valid JSON: ${error.message}`); }
}

function readJsonc(file, label = file) {
  if (!existsSync(file)) return undefined;
  const errors = [];
  const value = parseJsonc(readFileSync(file, 'utf8'), errors, { allowTrailingComma: true });
  if (errors.length) {
    const first = errors[0];
    fail(`${label} is not valid JSONC at offset ${first.offset}: ${printParseErrorCode(first.error)}`);
  }
  return value;
}

function readToml(file, label = file) {
  if (!existsSync(file)) return {};
  try { return parseToml(readFileSync(file, 'utf8')); }
  catch (error) { fail(`${label} is not valid TOML: ${error.message}`); }
}

function atomicWrite(file, content) {
  mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}`;
  writeFileSync(temporary, content, { mode: 0o600 });
  renameSync(temporary, file);
}

function deepSort(value) {
  if (Array.isArray(value)) return value.map(deepSort);
  if (!value || typeof value !== 'object' || value instanceof Date) return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, deepSort(value[key])]));
}

function readProjectState(workspace, { toolstackOnly = false } = {}) {
  if (toolstackOnly) return { backend: undefined, organization: undefined, projectServers: {} };
  const identity = readJson(path.join(workspace, 'ai-project.json'), 'ai-project.json');
  if (!identity || typeof identity !== 'object') fail('ai-project.json is required in /workspace. Run the generator preparation on the host.');
  const backend = identity.ticketing?.backend;
  const organization = identity.ticketing?.azureDevOps?.organization;
  if (backend === 'azure-devops' && (typeof organization !== 'string' || !organization.trim())) {
    fail('ticketing.azureDevOps.organization is required for the azure-devops backend.');
  }
  const mcpDocument = readJson(path.join(workspace, '.mcp.json'), '.mcp.json') ?? {};
  if (mcpDocument.mcpServers != null &&
      (!mcpDocument.mcpServers || typeof mcpDocument.mcpServers !== 'object' || Array.isArray(mcpDocument.mcpServers))) {
    fail('.mcp.json mcpServers must be an object.');
  }
  readToml(path.join(workspace, '.codex', 'config.toml'), '.codex/config.toml');
  return { backend, organization: organization?.trim(), projectServers: mcpDocument.mcpServers ?? {} };
}

function managedServers(agent, project, home) {
  const context = agent === 'codex' ? 'codex' : agent === 'claude' ? 'claude-code' : 'ide-assistant';
  const servers = {
    serena: {
      command: '/opt/uv/bin/serena',
      args: ['start-mcp-server', '--context', context, '--project', DEFAULT_WORKSPACE, '--enable-web-dashboard', 'false'],
      env: { SERENA_HOME: path.posix.join(home, '.cache', 'ai-dev-workflow', 'serena') },
    },
    playwright: {
      command: 'playwright-mcp',
      args: ['--headless', '--browser', 'chromium', '--isolated'],
      env: { PLAYWRIGHT_BROWSERS_PATH: '/opt/ms-playwright' },
    },
    context7: { command: 'context7-mcp', args: [] },
  };
  if (project.backend === 'azure-devops') {
    servers.ado = {
      command: 'mcp-server-azuredevops',
      args: [project.organization, '-d', 'core', 'work', 'work-items', '--authentication', 'azcli'],
    };
  }
  return servers;
}

function claudeServer(definition) {
  if (definition.url) return { ...definition };
  return {
    type: definition.type ?? 'stdio', command: definition.command, args: definition.args ?? [],
    ...(definition.env ? { env: definition.env } : {}),
  };
}

function openCodeServer(definition) {
  if (definition.url) {
    return {
      type: 'remote', url: definition.url, enabled: definition.enabled ?? true,
      ...(definition.headers ? { headers: definition.headers } : {}),
    };
  }
  if (!definition.command) fail('A local MCP server definition is missing command.');
  return {
    type: 'local', command: [definition.command, ...(definition.args ?? [])], enabled: definition.enabled ?? true,
    ...(definition.env ? { environment: definition.env } : {}),
  };
}

function isAgentLoginOrMaintenance(agent, args) {
  const first = args[0];
  if (['--help', '-h', '--version', '-V', '-v'].includes(first)) return true;
  if (agent === 'codex') return ['login', 'logout', 'update', 'doctor', 'completion', 'plugin'].includes(first);
  if (agent === 'claude') return ['auth', 'setup-token', 'install', 'update', 'upgrade', 'doctor'].includes(first);
  return ['auth', 'upgrade', 'uninstall', 'completion'].includes(first);
}

function defaultAzureCheck() {
  const result = spawnSync('az', ['account', 'show', '--output', 'none'], { stdio: 'ignore' });
  return result.status === 0;
}

function lstatSafe(file) {
  try { return lstatSync(file); } catch { return undefined; }
}

export function configureRuntime({
  workspace = DEFAULT_WORKSPACE,
  home = DEFAULT_HOME,
  superpowersRoot = DEFAULT_SUPERPOWERS,
  serenaConfigFile = '/opt/serena-runtime/serena_config.yml',
  registerCodexPlugin = true,
  toolstackOnly = false,
} = {}) {
  readProjectState(workspace, { toolstackOnly });
  readJson(path.join(home, '.claude.json'), '~/.claude.json');
  readJsonc(path.join(home, '.config', 'opencode', 'opencode.json'), '~/.config/opencode/opencode.json');
  readJsonc(path.join(home, '.config', 'opencode', 'opencode.jsonc'), '~/.config/opencode/opencode.jsonc');

  const codexFile = path.join(home, '.codex', 'config.toml');
  const codex = readToml(codexFile, '~/.codex/config.toml');
  codex.cli_auth_credentials_store = 'file';
  codex.projects ??= {};
  codex.projects[DEFAULT_WORKSPACE] = { ...(codex.projects[DEFAULT_WORKSPACE] ?? {}), trust_level: 'trusted' };

  const runtimeCache = path.join(home, '.cache', 'ai-dev-workflow');
  const marketplaceRoot = path.join(runtimeCache, 'codex-marketplace');
  const marketplaceFile = path.join(marketplaceRoot, '.claude-plugin', 'marketplace.json');
  const marketplace = readJson(marketplaceFile, 'managed Codex marketplace') ?? {
    name: 'agent-runtime', interface: { displayName: 'Agent Runtime' }, plugins: [],
  };
  if (typeof marketplace.name !== 'string' || !marketplace.name || !Array.isArray(marketplace.plugins)) {
    fail('managed Codex marketplace must have a name and plugins array.');
  }
  const plugin = {
    name: 'superpowers',
    source: { source: 'local', path: './plugins/superpowers' },
    policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL', products: ['CODEX'] },
    category: 'Developer Tools',
  };
  marketplace.plugins = [...marketplace.plugins.filter(entry => entry?.name !== 'superpowers'), plugin];
  atomicWrite(marketplaceFile, `${JSON.stringify(deepSort(marketplace), null, 2)}\n`);
  codex.plugins ??= {};
  codex.plugins[`superpowers@${marketplace.name}`] = {
    ...(codex.plugins[`superpowers@${marketplace.name}`] ?? {}), enabled: true,
  };
  atomicWrite(codexFile, stringifyToml(deepSort(codex)));

  if (existsSync(superpowersRoot)) {
    const link = path.join(home, 'plugins', 'superpowers');
    mkdirSync(path.dirname(link), { recursive: true });
    if (existsSync(link) || lstatSafe(link)) {
      if (!lstatSync(link).isSymbolicLink() || realpathSync(link) !== realpathSync(superpowersRoot)) {
        fail(`${link} exists and is not the managed Superpowers link.`);
      }
    } else {
      symlinkSync(superpowersRoot, link, 'dir');
    }
    const marketplaceLink = path.join(marketplaceRoot, 'plugins', 'superpowers');
    mkdirSync(path.dirname(marketplaceLink), { recursive: true });
    if (existsSync(marketplaceLink) || lstatSafe(marketplaceLink)) {
      if (!lstatSync(marketplaceLink).isSymbolicLink() || realpathSync(marketplaceLink) !== realpathSync(superpowersRoot)) {
        fail(`${marketplaceLink} exists and is not the managed Superpowers link.`);
      }
    } else {
      symlinkSync(superpowersRoot, marketplaceLink, 'dir');
    }
  }
  const serenaHome = path.join(runtimeCache, 'serena');
  mkdirSync(serenaHome, { recursive: true });
  if (!existsSync(serenaConfigFile)) fail(`managed Serena configuration is missing: ${serenaConfigFile}`);
  atomicWrite(path.join(serenaHome, 'serena_config.yml'), readFileSync(serenaConfigFile, 'utf8'));
  mkdirSync(path.join(home, '.config', 'opencode'), { recursive: true });
  if (registerCodexPlugin) {
    const pluginEnvironment = { ...process.env, HOME: home, CODEX_HOME: path.join(home, '.codex') };
    for (const args of [
      ['plugin', 'marketplace', 'add', marketplaceRoot, '--json'],
      ['plugin', 'add', `superpowers@${marketplace.name}`, '--json'],
    ]) {
      const result = spawnSync(path.join(REAL_BIN, 'codex'), args, {
        env: pluginEnvironment, encoding: 'utf8', windowsHide: true,
      });
      if (result.error || result.status !== 0) {
        fail(`Codex Superpowers registration failed: ${result.error?.message ?? result.stderr?.trim() ?? `exit ${result.status}`}`);
      }
    }
  }
  return { marketplace: marketplace.name };
}

export function buildLaunchPlan(agent, forwardedArgs, {
  workspace = DEFAULT_WORKSPACE,
  home = DEFAULT_HOME,
  superpowersRoot = DEFAULT_SUPERPOWERS,
  toolBin = REAL_BIN,
  checkAzureAuth = defaultAzureCheck,
  environment = process.env,
  toolstackOnly = false,
} = {}) {
  if (!AGENTS.has(agent)) fail(`Unsupported agent ${JSON.stringify(agent)}. Expected codex, claude, or opencode.`);
  if (!Array.isArray(forwardedArgs)) fail('Forwarded agent arguments must be an array.');
  const project = readProjectState(workspace, { toolstackOnly });
  // The produced plan executes inside Linux even when unit tests run on Windows.
  const command = path.posix.join(toolBin, agent);
  if (isAgentLoginOrMaintenance(agent, forwardedArgs)) {
    return { command, args: [...forwardedArgs], env: { ...environment } };
  }
  if (project.backend === 'azure-devops' && !checkAzureAuth()) {
    fail('Azure CLI is not authenticated. Run az login --use-device-code --allow-no-subscriptions (and --tenant when required), then retry.');
  }
  const managed = managedServers(agent, project, home);
  if (agent === 'codex') {
    const overrides = [];
    for (const [name, definition] of Object.entries(managed)) {
      overrides.push('-c', `mcp_servers.${name}.command=${JSON.stringify(definition.command)}`);
      overrides.push('-c', `mcp_servers.${name}.args=${JSON.stringify(definition.args)}`);
      for (const [key, value] of Object.entries(definition.env ?? {})) {
        overrides.push('-c', `mcp_servers.${name}.env.${key}=${JSON.stringify(value)}`);
      }
    }
    return { command, args: [...overrides, ...forwardedArgs], env: { ...environment } };
  }
  if (agent === 'claude') {
    const effectiveServers = Object.fromEntries(Object.entries(project.projectServers).map(([name, value]) => [name, claudeServer(value)]));
    for (const [name, definition] of Object.entries(managed)) effectiveServers[name] = claudeServer(definition);
    const configFile = path.join(home, '.cache', 'ai-dev-workflow', 'claude-mcp.json');
    atomicWrite(configFile, `${JSON.stringify({ mcpServers: deepSort(effectiveServers) }, null, 2)}\n`);
    return {
      command,
      args: ['--mcp-config', configFile, '--strict-mcp-config', '--plugin-dir', superpowersRoot, ...forwardedArgs],
      env: { ...environment },
    };
  }
  const effectiveServers = Object.fromEntries(Object.entries(project.projectServers).map(([name, value]) => [name, openCodeServer(value)]));
  for (const [name, definition] of Object.entries(managed)) effectiveServers[name] = openCodeServer(definition);
  return {
    command,
    args: [...forwardedArgs],
    env: {
      ...environment,
      OPENCODE_CONFIG_CONTENT: JSON.stringify({ mcp: deepSort(effectiveServers), plugin: [superpowersRoot] }),
    },
  };
}

function runCli() {
  const [, , action, ...args] = process.argv;
  const toolstackOnly = process.env.AGENT_TOOLSTACK_ONLY === '1';
  if (action === '--configure') {
    configureRuntime({ toolstackOnly });
    return;
  }
  const plan = buildLaunchPlan(action, args, {
    toolstackOnly,
    checkAzureAuth: process.env.AGENT_RUNTIME_PRINT_PLAN === '1' ? () => true : defaultAzureCheck,
  });
  if (process.env.AGENT_RUNTIME_PRINT_PLAN === '1') {
    process.stdout.write(`${JSON.stringify(plan)}\n`);
    return;
  }
  const result = spawnSync(plan.command, plan.args, { env: plan.env, stdio: 'inherit' });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { runCli(); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
