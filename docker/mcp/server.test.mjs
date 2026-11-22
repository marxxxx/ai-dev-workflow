import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { acpxSettings } from './acpx.mjs';
import { loadConfig } from './config.mjs';
import { alignEnv, createRuntime, createServer } from './server.mjs';

const TOKEN = 'integration-test-token-0123456789abcdef';
const SERVER = fileURLToPath(new URL('./server.mjs', import.meta.url));

// Stands in for acpx: `prompt` records its pid, waits for the gate file (so a test decides when the turn ends), then
// prints a canned message that echoes the prompt text; `cancel` kills the recorded prompt like the real one does. Every
// call records whether ADW_MCP_TOKEN is in its environment (never the value).
const FAKE_ACPX = `#!/bin/sh
if [ -n "\${ADW_MCP_TOKEN+x}" ]; then echo present >> "$FAKE_ACPX_ENVFILE"; else echo absent >> "$FAKE_ACPX_ENVFILE"; fi
for word in "$@"; do
  case "$word" in
    prompt) sub=prompt ;;
    cancel) sub=cancel ;;
  esac
done
case "$sub" in
  prompt)
    input=$(cat)
    echo $$ > "$FAKE_ACPX_PIDFILE"
    while [ ! -f "$FAKE_ACPX_GATE" ]; do sleep 0.05; done
    printf 'canned: %s\\n' "$input"
    ;;
  cancel)
    if [ -f "$FAKE_ACPX_PIDFILE" ]; then kill "$(cat "$FAKE_ACPX_PIDFILE")" 2>/dev/null; fi
    ;;
esac
exit 0
`;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

async function waitFor(check, what) {
  const deadline = Date.now() + 15000;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await sleep(50);
  }
}

// A server on port 0 over a temp HOME and workspace with the fake acpx first on PATH. The workers it spawns inherit this
// process's environment, so it is set for the duration of one test and put back by stop().
async function startServer() {
  const root = mkdtempSync(join(tmpdir(), 'adw-mcp-server-'));
  const bin = join(root, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'acpx'), FAKE_ACPX, { mode: 0o755 });
  const settings = {
    HOME: join(root, 'home'),
    ADW_MCP_WORKSPACE: join(root, 'workspace'),
    PATH: `${bin}:${process.env.PATH}`,
    FAKE_ACPX_PIDFILE: join(root, 'acpx.pid'),
    FAKE_ACPX_GATE: join(root, 'gate'),
    FAKE_ACPX_ENVFILE: join(root, 'acpx.env'),
    // As in `main`, the token arrives in the environment; createRuntime must take it out before any worker starts.
    ADW_MCP_TOKEN: TOKEN,
  };
  mkdirSync(settings.HOME);
  mkdirSync(settings.ADW_MCP_WORKSPACE);
  // createRuntime also sets ADW_MCP_TURN_TIMEOUT_SEC; stop() puts it back too.
  const saved = Object.fromEntries([...Object.keys(settings), 'ADW_MCP_TURN_TIMEOUT_SEC'].map((key) => [key, process.env[key]]));
  Object.assign(process.env, settings);

  const logged = [];
  const config = loadConfig({ ADW_MCP_TOKEN: TOKEN, HOME: settings.HOME, ADW_MCP_WORKSPACE: settings.ADW_MCP_WORKSPACE });
  const { tools, store } = createRuntime(config);
  const server = createServer({ config, tools, log: (line) => logged.push(line) });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  const server_ = {
    port, store, logged, gate: settings.FAKE_ACPX_GATE, pidfile: settings.FAKE_ACPX_PIDFILE, envfile: settings.FAKE_ACPX_ENVFILE,
    url: `http://127.0.0.1:${port}/mcp`,
    openGate: () => writeFileSync(settings.FAKE_ACPX_GATE, ''),
    closeGate: () => rmSync(settings.FAKE_ACPX_GATE, { force: true }),
    async stop() {
      // Release or kill whatever the fake acpx and the workers still run, then put the environment back.
      writeFileSync(settings.FAKE_ACPX_GATE, '');
      for (const record of store.list()) if (record.pid != null && alive(record.pid)) process.kill(record.pid);
      if (existsSync(settings.FAKE_ACPX_PIDFILE)) {
        const pid = Number(readFileSync(settings.FAKE_ACPX_PIDFILE, 'utf8'));
        if (pid > 0 && alive(pid)) process.kill(pid);
      }
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      await sleep(150); // a fake prompt loop between two polls ends by itself within one poll interval
      rmSync(root, { recursive: true, force: true });
    },
  };
  return server_;
}

const post = (server, body, headers = { authorization: `Bearer ${TOKEN}` }) => fetch(server.url, {
  method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body),
});

// A raw request, so that hop-by-hop headers such as `connection` are seen as sent.
const raw = (url, { method = 'POST', headers = {}, body } = {}) => new Promise((resolve, reject) => {
  const request = http.request(url, { method, headers }, (response) => {
    let text = '';
    response.setEncoding('utf8');
    response.on('data', (chunk) => { text += chunk; });
    response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body: text }));
  });
  request.on('error', reject);
  request.end(body);
});

let nextId = 1;
async function call(server, name, args) {
  const response = await post(server, { jsonrpc: '2.0', id: nextId++, method: 'tools/call', params: { name, arguments: args } });
  assert.equal(response.status, 200);
  const { result } = await response.json();
  return { isError: result.isError === true, text: result.content[0].text, value: result.isError ? null : JSON.parse(result.content[0].text) };
}

const waitForStatus = (server, sessionId, status) => waitFor(async () => {
  const { value } = await call(server, 'query_session', { session_id: sessionId });
  return value.status === status ? value : null;
}, `${sessionId} to be ${status}`);

test('a request without a token or with a wrong one is 401 without detail', async (t) => {
  const server = await startServer();
  t.after(() => server.stop());
  const body = { jsonrpc: '2.0', id: 1, method: 'ping' };
  for (const headers of [{}, { authorization: 'Bearer wrong' }, { 'x-api-key': 'wrong' }, { authorization: TOKEN }]) {
    const response = await post(server, body, headers);
    assert.equal(response.status, 401);
    const text = await response.text();
    assert.ok(!text.includes(TOKEN));
    assert.ok(!/token|bearer/i.test(text), text);
  }
  assert.equal((await post(server, body, { 'x-api-key': TOKEN })).status, 200);
  assert.equal((await post(server, body)).status, 200);
});

test('401, 404 and 405 close the connection instead of draining an unread body', async (t) => {
  const server = await startServer();
  t.after(() => server.stop());
  const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' });
  const cases = [
    [401, server.url, 'POST', {}],
    [404, `http://127.0.0.1:${server.port}/other`, 'POST', { authorization: `Bearer ${TOKEN}` }],
    [405, server.url, 'PUT', { authorization: `Bearer ${TOKEN}` }],
  ];
  for (const [status, url, method, headers] of cases) {
    const response = await raw(url, { method, headers: { 'content-type': 'application/json', ...headers }, body });
    assert.equal(response.status, status);
    assert.equal(response.headers.connection, 'close', String(status));
  }
});

test('the server limits the time for headers and for the whole request to 30 s', async () => {
  const server = createServer({ config: { token: TOKEN, tls: null }, tools: [] });
  assert.equal(server.headersTimeout, 30000);
  assert.equal(server.requestTimeout, 30000);
});

test('authentication comes before the body: an unauthorised oversized body is 401', async (t) => {
  const server = await startServer();
  t.after(() => server.stop());
  const response = await post(server, 'x'.repeat(2 * 1024 * 1024), {});
  assert.equal(response.status, 401);
});

test('GET and other methods on /mcp are 405, other paths 404', async (t) => {
  const server = await startServer();
  t.after(() => server.stop());
  for (const method of ['GET', 'DELETE', 'PUT']) {
    const response = await fetch(server.url, { method, headers: { authorization: `Bearer ${TOKEN}` } });
    assert.equal(response.status, 405, method);
    assert.equal(response.headers.get('allow'), 'POST');
    await response.text();
  }
  for (const path of ['/', '/mcp/x', '/other']) {
    const response = await fetch(`http://127.0.0.1:${server.port}${path}`, { method: 'POST', headers: { authorization: `Bearer ${TOKEN}` }, body: '{}' });
    assert.equal(response.status, 404, path);
    await response.text();
  }
  const withQuery = await fetch(`${server.url}?x=1`, { method: 'POST', headers: { authorization: `Bearer ${TOKEN}` }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }) });
  assert.equal(withQuery.status, 200);
  await withQuery.text();
});

test('a body over 1 MiB is 413, whether declared or streamed without a length', async (t) => {
  const server = await startServer();
  t.after(() => server.stop());
  const declared = await post(server, 'x'.repeat(1024 * 1024 + 1));
  assert.equal(declared.status, 413);
  await declared.text();

  const streamed = await new Promise((resolve, reject) => {
    const request = http.request(server.url, { method: 'POST', headers: { authorization: `Bearer ${TOKEN}`, 'transfer-encoding': 'chunked' } }, (response) => {
      response.resume();
      resolve(response.statusCode);
    });
    request.on('error', reject);
    request.write('x'.repeat(600 * 1024));
    request.write('x'.repeat(600 * 1024));
    request.end();
  });
  assert.equal(streamed, 413);

  const atLimit = await post(server, `{"jsonrpc":"2.0","id":1,"method":"ping"}${' '.repeat(1024 * 1024 - 40)}`);
  assert.equal(atLimit.status, 200);
  await atLimit.text();
});

test('malformed JSON is 400 with -32700, an array is 400 with -32600, a notification is 202 with no body', async (t) => {
  const server = await startServer();
  t.after(() => server.stop());
  const malformed = await post(server, '{not json');
  assert.equal(malformed.status, 400);
  assert.deepEqual((await malformed.json()).error.code, -32700);

  const batch = await post(server, [{ jsonrpc: '2.0', id: 1, method: 'ping' }]);
  assert.equal(batch.status, 400);
  assert.equal((await batch.json()).error.code, -32600);

  const note = await post(server, { jsonrpc: '2.0', method: 'notifications/initialized' });
  assert.equal(note.status, 202);
  assert.equal(await note.text(), '');
});

test('initialize, ping, tools/list and an unknown method over HTTP', async (t) => {
  const server = await startServer();
  t.after(() => server.stop());
  const init = await (await post(server, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26' } })).json();
  assert.equal(init.result.protocolVersion, '2025-03-26');
  assert.equal(init.result.serverInfo.name, 'adw-mcp');
  const list = await (await post(server, { jsonrpc: '2.0', id: 2, method: 'tools/list' })).json();
  assert.deepEqual(list.result.tools.map((tool) => tool.name), ['start_session', 'query_session', 'post_session', 'list_sessions', 'terminate_session']);
  const unknown = await post(server, { jsonrpc: '2.0', id: 3, method: 'nope' });
  assert.equal(unknown.headers.get('content-type'), 'application/json');
  assert.equal((await unknown.json()).error.code, -32601);
});

test('full flow: start, running, idle with the canned message, post, list, one live session, terminate, start again', async (t) => {
  const server = await startServer();
  t.after(() => server.stop());

  const started = await call(server, 'start_session', { harness: 'codex', task: 'T-1' });
  assert.equal(started.value.status, 'running');
  assert.equal(started.value.turn, 1);
  assert.deepEqual(Object.keys(started.value).sort(), ['created_at', 'error', 'harness', 'last_message', 'session_id', 'status', 'turn', 'updated_at']);
  const id = started.value.session_id;

  await waitFor(() => existsSync(server.pidfile), 'the fake acpx prompt');
  assert.equal((await call(server, 'query_session', { session_id: id, harness: 'codex' })).value.status, 'running');
  server.openGate();
  const idle = await waitForStatus(server, id, 'idle');
  assert.equal(idle.last_message, 'canned: $agent-dev T-1');
  assert.equal(idle.turn, 1);

  server.closeGate();
  const posted = await call(server, 'post_session', { session_id: id, message: 'go on' });
  assert.equal(posted.value.status, 'running');
  assert.equal(posted.value.turn, 2);
  server.openGate();
  const again = await waitForStatus(server, id, 'idle');
  assert.equal(again.turn, 2);
  assert.equal(again.last_message, 'canned: go on');

  const listed = await call(server, 'list_sessions', {});
  assert.deepEqual(listed.value.sessions.map((s) => s.session_id), [id]);
  assert.deepEqual((await call(server, 'list_sessions', { status: 'running' })).value.sessions, []);

  const second = await call(server, 'start_session', { harness: 'codex', task: 'T-2' });
  assert.equal(second.isError, true);
  assert.ok(second.text.includes(id));

  const mismatch = await call(server, 'query_session', { session_id: id, harness: 'opencode' });
  assert.equal(mismatch.isError, true);
  assert.equal((await call(server, 'query_session', { session_id: 'nope' })).isError, true);

  const done = await call(server, 'terminate_session', { session_id: id });
  assert.equal(done.value.status, 'terminated');

  server.closeGate();
  const third = await call(server, 'start_session', { harness: 'codex', task: 'T-3' });
  assert.equal(third.isError, false);
  assert.equal(third.value.status, 'running');
  assert.ok(server.logged.every((line) => !line.includes(TOKEN)));
});

test('terminate stops a running turn: the fake acpx prompt and the worker are gone', async (t) => {
  const server = await startServer();
  t.after(() => server.stop());
  const started = await call(server, 'start_session', { harness: 'codex', task: 'long' });
  const id = started.value.session_id;
  await waitFor(() => existsSync(server.pidfile), 'the fake acpx prompt');
  const prompt = Number(readFileSync(server.pidfile, 'utf8'));
  const worker = server.store.get(id).pid;
  assert.ok(alive(prompt) && alive(worker));

  const done = await call(server, 'terminate_session', { session_id: id });
  assert.equal(done.value.status, 'terminated');
  await waitFor(() => !alive(worker) && !alive(prompt), 'the processes to exit');
  assert.equal(server.store.get(id).status, 'terminated');
  assert.equal(server.store.get(id).pid, null);
});

test('createServer picks https only when config.tls is set, reading the files', () => {
  const dir = mkdtempSync(join(tmpdir(), 'adw-mcp-tls-'));
  try {
    writeFileSync(join(dir, 'cert.pem'), 'CERT');
    writeFileSync(join(dir, 'key.pem'), 'KEY');
    const made = [];
    const factories = {
      http: (options, handler) => { made.push(['http', options, handler]); return { kind: 'http-server' }; },
      https: (options, handler) => { made.push(['https', options, handler]); return { kind: 'https-server' }; },
    };
    assert.equal(createServer({ config: { token: TOKEN, tls: null }, tools: [], factories }).kind, 'http-server');
    const tls = { cert: join(dir, 'cert.pem'), key: join(dir, 'key.pem') };
    assert.equal(createServer({ config: { token: TOKEN, tls }, tools: [], factories }).kind, 'https-server');
    assert.deepEqual(made.map((m) => m[0]), ['http', 'https']);
    assert.equal(made[1][1].cert.toString(), 'CERT');
    assert.equal(made[1][1].key.toString(), 'KEY');
    for (const [, options, handler] of made) {
      assert.equal(options.headersTimeout, 30000);
      assert.equal(options.requestTimeout, 30000);
      assert.equal(typeof handler, 'function');
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('alignEnv makes the process environment agree with the config, so workers use the same paths, and drops the token', () => {
  const config = { token: TOKEN, home: '/data/home', workspace: '/data/ws', turnTimeoutSec: 14400 };
  const target = { HOME: '/other', ADW_MCP_WORKSPACE: undefined, PATH: '/bin', ADW_MCP_TOKEN: TOKEN, ADW_MCP_TLS_CERT: '/c.pem', ADW_MCP_PORT: '9000', ADW_MCP_TURN_TIMEOUT_SEC: '' };
  alignEnv(config, target);
  assert.equal(target.HOME, '/data/home');
  assert.equal(target.ADW_MCP_WORKSPACE, '/data/ws');
  assert.equal(target.PATH, '/bin');
  assert.ok(!('ADW_MCP_TOKEN' in target));
  assert.equal(target.ADW_MCP_TLS_CERT, '/c.pem');
  assert.equal(target.ADW_MCP_PORT, '9000');
  const settings = acpxSettings(target);
  assert.equal(settings.storeDir, join('/data/home', '.adw-mcp', 'sessions'));
  assert.equal(settings.workspace, '/data/ws');
  assert.equal(target.ADW_MCP_TURN_TIMEOUT_SEC, '14400');
  assert.equal(settings.timeoutSec, 14400);
});

test('createRuntime puts the store under <home>/.adw-mcp/sessions and aligns the environment', async (t) => {
  const server = await startServer();
  t.after(() => server.stop());
  const created = await call(server, 'start_session', { harness: 'codex', task: 'x' });
  assert.ok(existsSync(join(process.env.HOME, '.adw-mcp', 'sessions', created.value.session_id, 'session.json')));
});

test('the token is not in the environment of the runtime, the worker or acpx', async (t) => {
  const server = await startServer();
  t.after(() => server.stop());
  assert.ok(!('ADW_MCP_TOKEN' in process.env));
  const started = await call(server, 'start_session', { harness: 'codex', task: 'env' });
  await waitFor(() => existsSync(server.pidfile), 'the fake acpx prompt');
  server.openGate();
  await waitForStatus(server, started.value.session_id, 'idle');
  const seen = readFileSync(server.envfile, 'utf8').trim().split('\n');
  assert.ok(seen.length >= 2, seen.join(',')); // sessions ensure and prompt
  assert.deepEqual([...new Set(seen)], ['absent']);
});

test('main exits 1 with a one-line message, no stack and no token, when the TLS certificate cannot be read', () => {
  const dir = mkdtempSync(join(tmpdir(), 'adw-mcp-main-'));
  try {
    const child = spawnSync(process.execPath, [SERVER], {
      env: {
        PATH: process.env.PATH, HOME: dir, ADW_MCP_WORKSPACE: dir, ADW_MCP_TOKEN: TOKEN, ADW_MCP_HOST: '127.0.0.1',
        ADW_MCP_TLS_CERT: join(dir, 'missing-cert.pem'), ADW_MCP_TLS_KEY: join(dir, 'missing-key.pem'),
      },
      encoding: 'utf8', timeout: 20000,
    });
    assert.equal(child.status, 1, child.stderr);
    assert.ok(child.stderr.startsWith('adw-mcp:'), child.stderr);
    assert.ok(child.stderr.includes('missing-cert.pem'), child.stderr);
    assert.ok(!child.stderr.includes(TOKEN) && !child.stdout.includes(TOKEN));
    assert.ok(!child.stderr.includes('    at '), child.stderr);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('main exits 1 with the message for a missing or too short token, without echoing it', () => {
  for (const [value, message] of [[undefined, 'ADW_MCP_TOKEN is not set'], ['short-secret', 'at least 32 characters']]) {
    const child = spawnSync(process.execPath, [SERVER], {
      env: { PATH: process.env.PATH, ...(value ? { ADW_MCP_TOKEN: value } : {}) }, encoding: 'utf8', timeout: 20000,
    });
    assert.equal(child.status, 1);
    assert.ok(child.stderr.includes(message), child.stderr);
    assert.ok(!child.stdout.includes('short-secret') && !child.stderr.includes('short-secret'));
  }
});
