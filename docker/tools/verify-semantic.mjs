import { spawn } from 'node:child_process';
import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import { once } from 'node:events';

const fixture = '/tmp/serena-typescript-fixture';
await mkdir(fixture, { recursive: true });
await writeFile(`${fixture}/sample.ts`, 'export function semanticAnswer(): number { return 42; }\n');
await mkdir('/tmp/serena-home', { recursive: true });
await copyFile('/opt/serena-runtime/serena_config.yml', '/tmp/serena-home/serena_config.yml');

const child = spawn('/opt/uv/bin/serena', [
  'start-mcp-server',
  '--context', 'codex',
  '--project', fixture,
  '--enable-web-dashboard', 'false',
], {
  env: { ...process.env, HOME: '/tmp/serena-home', SERENA_HOME: '/tmp/serena-home', NO_COLOR: '1' },
  stdio: ['pipe', 'pipe', 'pipe'],
});

let nextId = 1;
let stdout = '';
let stderr = '';
const pending = new Map();
let timeoutId;
const timeout = new Promise((_, reject) => {
  timeoutId = setTimeout(() => {
    child.kill('SIGKILL');
    reject(new Error(`Timed out waiting for Serena semantic tools. stderr: ${stderr.slice(-4000)}`));
  }, 45_000);
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

function notify(method, params = {}) {
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);
}

try {
  await Promise.race([(async () => {
    await send('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'ai-dev-workflow-verifier', version: '1.0.0' },
    });
    notify('notifications/initialized');
    const listed = await send('tools/list');
    const names = new Set(listed.tools.map(tool => tool.name));
    if (!names.has('get_symbols_overview')) {
      throw new Error('Serena did not expose get_symbols_overview');
    }
    const result = await send('tools/call', {
      name: 'get_symbols_overview',
      arguments: { relative_path: 'sample.ts', depth: 1 },
    });
    const rendered = JSON.stringify(result);
    if (!rendered.includes('semanticAnswer')) {
      throw new Error(`Serena semantic result omitted semanticAnswer: ${rendered}`);
    }
    console.log('Serena TypeScript semantics: ok');
  })(), timeout]);
} finally {
  clearTimeout(timeoutId);
  child.stdin.end();
  child.kill('SIGTERM');
  await Promise.race([once(child, 'exit'), new Promise(resolve => setTimeout(resolve, 2_000))]);
  if (child.exitCode === null) child.kill('SIGKILL');
}
