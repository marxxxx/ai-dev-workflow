import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { after } from 'node:test';
import { applyTurnResult } from './sessions.mjs';
import { createStore } from './store.mjs';
import { cancelTurn, isAlive, startTurn } from './runner.mjs';
import { runTurn } from './worker.mjs';

const ID = '00000000-0000-4000-8000-000000000001';
const NOW = '2026-01-01T00:00:00.000Z';
const now = () => NOW;
// Every temp dir of this file, removed once its tests are done.
const dirs = [];
after(() => { for (const dir of dirs) rmSync(dir, { recursive: true, force: true }); });
const tmp = () => {
  const dir = mkdtempSync(join(tmpdir(), 'adw-worker-'));
  dirs.push(dir);
  return dir;
};

function setup({ turn = 1, status = 'running', harness = 'codex' } = {}) {
  const home = tmp();
  const store = createStore(join(home, '.adw-mcp', 'sessions'));
  const record = store.create({
    id: ID, harness, task: 'T-1', status, turn, lastMessage: null, error: null, createdAt: NOW, updatedAt: NOW, pid: 42,
  });
  const calls = [];
  const prepared = [];
  const reply = (r) => ({ status: 0, stdout: '', stderr: '', ...r });
  const run = (responses) => (text) => runTurn({
    record,
    text,
    store,
    now,
    settings: { home, workspace: '/workspace', timeoutSec: 1800 },
    prepare: (h, options) => prepared.push({ h, ...options }),
    exec: async (argv, options) => {
      calls.push({ argv, options });
      const sub = ['prompt', 'cancel', 'close'].find((word) => argv.includes(word)) ?? 'ensure';
      return reply(typeof responses === 'function' ? responses(sub, argv) : responses[sub] ?? {});
    },
  });
  return { home, store, record, calls, prepared, run };
}

test('turn 1 prepares the harness, ensures the session, then prompts with the text on stdin', async () => {
  const { home, store, calls, prepared, run } = setup();
  await run({ prompt: { stdout: 'Done.\n' } })('/agent-dev T-1');
  assert.deepEqual(prepared, [{ h: 'codex', home }]);
  assert.deepEqual(calls.map((c) => c.argv.slice(-4)), [['sessions', 'ensure', '-s', ID], ['-s', ID, '-f', '-']]);
  assert.equal(calls[0].options.input, undefined);
  assert.equal(calls[1].options.input, '/agent-dev T-1');
  assert.equal(calls[1].options.env.HOME, home);
  assert.ok(calls[1].options.timeoutMs > 1800 * 1000);
  const after = store.get(ID);
  assert.equal(after.status, 'idle');
  assert.equal(after.lastMessage, 'Done.');
  assert.equal(after.pid, null);
});

test('a later turn only prompts', async () => {
  const { calls, prepared, store, run } = setup({ turn: 2 });
  await run({ prompt: { stdout: 'again' } })('more');
  assert.equal(prepared.length, 0);
  assert.equal(calls.length, 1);
  assert.ok(calls[0].argv.includes('prompt'));
  assert.equal(store.get(ID).lastMessage, 'again');
});

test('a non-zero exit fails the session with the last 500 characters of stderr and ignores stdout', async () => {
  const { store, run } = setup({ turn: 2 });
  await run({ prompt: { status: 3, stdout: 'partial text', stderr: `${'x'.repeat(600)}[acpx] error: TIMEOUT after 2000ms` } })('go');
  const after = store.get(ID);
  assert.equal(after.status, 'failed');
  assert.ok(after.error.endsWith('[acpx] error: TIMEOUT after 2000ms'));
  assert.ok(after.error.includes('exit 3'));
  assert.ok(!after.error.includes('partial'));
  assert.ok(after.error.length < 560);
  assert.equal(after.lastMessage, null);
});

test('a failed ensure fails the session without prompting', async () => {
  const { store, calls, run } = setup();
  await run({ ensure: { status: 1, stderr: '[acpx] error: RUNTIME could not start' } })('go');
  assert.ok(!calls.some((c) => c.argv.includes('prompt')));
  assert.equal(store.get(ID).status, 'failed');
  assert.match(store.get(ID).error, /RUNTIME could not start/);
});

// With --ttl 0 the queue owner and adapter outlive a failed turn until `sessions close`; a timeout does not cancel the
// agent either. The worker cancels and closes before the failure frees the workspace.
test('a failed turn cancels and closes the acpx session before it stores the failure', async () => {
  for (const [turn, responses] of [
    [2, { prompt: { status: 1, stderr: '[acpx] error: RUNTIME boom' } }],
    [2, { prompt: { status: 3, stderr: '[acpx] error: TIMEOUT' } }],
    [2, { prompt: { status: null, error: Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' }) } }],
    [1, { ensure: { status: 1, stderr: '[acpx] error: RUNTIME could not start' } }],
  ]) {
    const { store, calls, run } = setup({ turn });
    const statuses = [];
    const failing = run((sub) => {
      if (sub === 'cancel' || sub === 'close') statuses.push(store.get(ID).status);
      return responses[sub] ?? {};
    });
    await failing('go');
    assert.deepEqual(calls.slice(-2).map((c) => c.argv.slice(-3)), [['cancel', '-s', ID], ['sessions', 'close', ID]], JSON.stringify(responses));
    assert.equal(calls.at(-1).options.env.HOME, calls[0].options.env.HOME);
    assert.deepEqual(statuses, ['running', 'running'], 'the workspace stays held until the session is closed');
    assert.equal(store.get(ID).status, 'failed');
  }
});

test('a failing cancel or close still stores the failure', async () => {
  const { store, run } = setup({ turn: 2 });
  await run((sub) => (sub === 'prompt' ? { status: 1, stderr: 'boom' } : { status: 4, error: Object.assign(new Error('x'), { code: 'ENOENT' }) }))('go');
  assert.equal(store.get(ID).status, 'failed');
  assert.match(store.get(ID).error, /boom/);
});

test('a successful turn neither cancels nor closes', async () => {
  const { calls, run } = setup({ turn: 2 });
  await run({ prompt: { stdout: 'ok' } })('go');
  assert.deepEqual(calls.map((c) => c.argv.includes('prompt')), [true]);
});

test('quota-like failures are prefixed with quota:', async () => {
  for (const [harness, stderr] of [
    ['claude-code', "[acpx] error: RUNTIME You've hit your session limit"],
    ['codex', '[acpx] error: RUNTIME usageLimitExceeded'],
    ['opencode', '[acpx] error: RUNTIME 429 Too Many Requests'],
  ]) {
    const { store, run } = setup({ turn: 2, harness });
    await run({ prompt: { status: 1, stderr } })('go');
    assert.match(store.get(ID).error, /^quota: /, harness);
  }
  const { store, run } = setup({ turn: 2, harness: 'claude-code' });
  await run({ prompt: { status: 1, stderr: 'boom' } })('go');
  assert.doesNotMatch(store.get(ID).error, /quota/);
});

test('a spawn error or timeout of acpx fails the session', async () => {
  for (const code of ['ENOENT', 'ETIMEDOUT']) {
    const { store, run } = setup({ turn: 2 });
    await run({ prompt: { status: null, error: Object.assign(new Error(`spawn ${code}`), { code }) } })('go');
    assert.equal(store.get(ID).status, 'failed');
    assert.match(store.get(ID).error, new RegExp(code === 'ETIMEDOUT' ? 'timed out' : 'ENOENT'));
  }
});

test('a failing harness setup fails the session without calling acpx', async () => {
  const { store, calls } = setup();
  await runTurn({
    record: store.get(ID), text: 'go', store, now, settings: { home: '/h', workspace: '/w', timeoutSec: 1800 },
    prepare: () => { throw new Error('settings.json is not valid JSON'); },
    exec: async (argv) => { calls.push(argv); return { status: 0, stdout: '', stderr: '' }; },
  });
  assert.equal(calls.length, 0);
  assert.match(store.get(ID).error, /settings\.json is not valid JSON/);
});

test('output over 64 KiB ends as valid capped text', async () => {
  const { store, run } = setup({ turn: 2 });
  await run({ prompt: { stdout: `${'é'.repeat(40 * 1024)}\n` } })('go');
  const message = store.get(ID).lastMessage;
  assert.ok(Buffer.byteLength(message) <= 64 * 1024 + '\n[truncated]'.length);
  assert.ok(message.endsWith('\n[truncated]'));
  assert.equal(Buffer.from(message, 'utf8').toString('utf8'), message);
  assert.ok(!message.slice(0, -'\n[truncated]'.length).includes('�'));
});

test('invalid UTF-8 in the output ends as valid text', async () => {
  const { store, run } = setup({ turn: 2 });
  await run({ prompt: { stdout: Buffer.concat([Buffer.from('ok '), Buffer.from([0xff, 0xc3]), Buffer.from(' end')]) } })('go');
  const message = store.get(ID).lastMessage;
  assert.equal(Buffer.from(message, 'utf8').toString('utf8'), message);
  assert.ok(message.startsWith('ok ') && message.endsWith(' end'));
});

test('a terminated session stays terminated when the turn finishes later', async () => {
  const { store, run } = setup({ turn: 2 });
  const pending = run({ prompt: { stdout: 'late' } })('go');
  store.update(ID, { status: 'terminated', pid: null });
  await pending;
  const after = store.get(ID);
  assert.equal(after.status, 'terminated');
  assert.equal(after.lastMessage, null);
});

test('applyTurnResult is what a finished turn goes through', () => {
  const { store } = setup();
  assert.equal(applyTurnResult(store, ID, { ok: true, message: 'm' }, now).status, 'idle');
});

// startTurn / cancelTurn / the worker CLI against a fake `acpx` on PATH.
function fakeAcpx(dir, script) {
  writeFileSync(join(dir, 'acpx'), `#!/bin/sh\n${script}\n`);
  chmodSync(join(dir, 'acpx'), 0o755);
}

async function until(check, ms = 10000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const value = check();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('timed out waiting');
}

async function withEnv(env, fn) {
  const saved = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
  Object.assign(process.env, env);
  try { return await fn(); } finally {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
}

test('startTurn runs the worker detached: the fake acpx gets the text on stdin and the session ends idle', async () => {
  const bin = tmp();
  const home = tmp();
  const log = join(bin, 'argv.log');
  fakeAcpx(bin, `echo "$@" >> "${log}"\ncase " $* " in *" prompt "*) printf 'reply to: '; cat;; *) echo some-id;; esac`);
  await withEnv({ HOME: home, PATH: `${bin}:${process.env.PATH}` }, async () => {
    const store = createStore(join(home, '.adw-mcp', 'sessions'));
    const record = store.create({ id: ID, harness: 'opencode', task: 'T-1', status: 'running', turn: 1, lastMessage: null, error: null, createdAt: NOW, updatedAt: NOW, pid: null });
    const pid = startTurn(record, '$(touch /tmp/adw-pwned) "quoted"');
    assert.ok(Number.isInteger(pid) && pid > 0);
    const done = await until(() => (store.get(ID).status === 'running' ? null : store.get(ID)));
    assert.equal(done.status, 'idle');
    assert.equal(done.lastMessage, 'reply to: $(touch /tmp/adw-pwned) "quoted"');
    assert.equal(statSync(join(store.dirOf(ID), 'turn-1.txt')).mode & 0o777, 0o600);
    const lines = readFileSync(log, 'utf8').trim().split('\n');
    assert.equal(lines.length, 2);
    assert.match(lines[0], new RegExp(`--cwd ${process.env.ADW_MCP_WORKSPACE ?? '/workspace'} sessions ensure -s ${ID}$`));
    assert.match(lines[1], new RegExp(`prompt -s ${ID} -f -$`));
  });
});

test('cancelTurn runs acpx cancel then close and kills the worker with its acpx child; isAlive follows it', async () => {
  const bin = tmp();
  const home = tmp();
  const log = join(bin, 'argv.log');
  const pids = join(bin, 'prompt.pids');
  fakeAcpx(bin, `echo "$@" >> "${log}"\ncase " $* " in *" prompt "*) sleep 30 & echo "$$ $!" > "${pids}"; wait;; *) echo some-id;; esac`);
  await withEnv({ HOME: home, PATH: `${bin}:${process.env.PATH}` }, async () => {
    const store = createStore(join(home, '.adw-mcp', 'sessions'));
    const record = store.create({ id: ID, harness: 'opencode', task: 'T-1', status: 'running', turn: 1, lastMessage: null, error: null, createdAt: NOW, updatedAt: NOW, pid: null });
    const pid = startTurn(record, 'go');
    assert.equal(isAlive(pid), true);
    await until(() => { try { return readFileSync(log, 'utf8').includes(' prompt '); } catch { return false; } });
    const children = await until(() => { try { return readFileSync(pids, 'utf8').trim().split(' ').map(Number); } catch { return null; } });
    await cancelTurn({ ...record, pid });
    await until(() => !isAlive(pid));
    // The worker is a process-group leader (detached): its acpx prompt and what that runs die with it.
    await until(() => children.every((child) => !isAlive(child)), 3000);
    const lines = readFileSync(log, 'utf8').trim().split('\n');
    assert.match(lines.at(-2), new RegExp(`cancel -s ${ID}$`));
    assert.match(lines.at(-1), new RegExp(`sessions close ${ID}$`));
    await cancelTurn({ ...record, pid }); // already gone: no throw
    await cancelTurn({ ...record, pid: null });
  });
});
