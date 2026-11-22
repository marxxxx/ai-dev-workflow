import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { HARNESSES, SessionError, applyTurnResult, createSessions } from './sessions.mjs';
import { createStore } from './store.mjs';

function setup({ alive = () => true } = {}) {
  const store = createStore(mkdtempSync(join(tmpdir(), 'adw-sessions-')));
  const calls = { startTurn: [], cancel: [] };
  let n = 0;
  let pid = 100;
  const sessions = createSessions({
    store,
    startTurn: (record, text) => { calls.startTurn.push({ id: record.id, turn: record.turn, text }); return pid++; },
    cancel: async (record) => { calls.cancel.push(record.id); },
    isAlive: alive,
    now: () => '2026-01-01T00:00:00.000Z',
    newId: () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`,
  });
  return { store, sessions, calls };
}

test('HARNESSES lists the three harnesses', () => {
  assert.deepEqual(HARNESSES, ['claude-code', 'codex', 'opencode']);
});

test('start validates harness, empty task and an 8001-character task', () => {
  const { sessions, calls } = setup();
  assert.throws(() => sessions.start({ harness: 'vim', task: 'x' }), SessionError);
  assert.throws(() => sessions.start({ harness: 'codex', task: '' }), SessionError);
  assert.throws(() => sessions.start({ harness: 'codex', task: '   ' }), SessionError);
  assert.throws(() => sessions.start({ harness: 'codex', task: 'x'.repeat(8001) }), SessionError);
  assert.throws(() => sessions.start({ harness: 'codex', task: 5 }), SessionError);
  assert.equal(calls.startTurn.length, 0);
  assert.doesNotThrow(() => sessions.start({ harness: 'codex', task: 'x'.repeat(8000) }));
});

test('start creates a running session at turn 1 and starts the turn once with the opening text', () => {
  const { sessions, store, calls } = setup();
  const record = sessions.start({ harness: 'claude-code', task: 'fix it' });
  assert.equal(record.status, 'running');
  assert.equal(record.turn, 1);
  assert.equal(record.pid, 100);
  assert.deepEqual(calls.startTurn, [{ id: record.id, turn: 1, text: '/agent-dev fix it' }]);
  assert.deepEqual(store.get(record.id), record);
});

test('start uses the $agent-dev opening for codex and opencode', () => {
  for (const harness of ['codex', 'opencode']) {
    const { sessions, calls } = setup();
    sessions.start({ harness, task: 'do x' });
    assert.equal(calls.startTurn[0].text, '$agent-dev do x');
  }
});

test('start rejects while a session is running or idle and names it', () => {
  const { sessions, store } = setup();
  const first = sessions.start({ harness: 'codex', task: 'a' });
  assert.throws(() => sessions.start({ harness: 'codex', task: 'b' }), (e) => e instanceof SessionError && e.message.includes(first.id));
  store.update(first.id, { status: 'idle' });
  assert.throws(() => sessions.start({ harness: 'codex', task: 'b' }), (e) => e instanceof SessionError && e.message.includes(first.id));
});

test('start succeeds again once the session is failed or terminated', async () => {
  const { sessions, store } = setup();
  const first = sessions.start({ harness: 'codex', task: 'a' });
  store.update(first.id, { status: 'failed' });
  const second = sessions.start({ harness: 'codex', task: 'b' });
  await sessions.terminate({ sessionId: second.id });
  assert.doesNotThrow(() => sessions.start({ harness: 'codex', task: 'c' }));
});

test('two start calls in the same tick: exactly one succeeds', async () => {
  const { sessions, calls } = setup();
  const results = await Promise.allSettled([
    (async () => sessions.start({ harness: 'codex', task: 'a' }))(),
    (async () => sessions.start({ harness: 'codex', task: 'b' }))(),
  ]);
  assert.deepEqual(results.map((r) => r.status).sort(), ['fulfilled', 'rejected']);
  assert.equal(calls.startTurn.length, 1);
});

test('post works only from idle, bumps the turn and passes the message verbatim', () => {
  const { sessions, store, calls } = setup();
  const { id } = sessions.start({ harness: 'codex', task: 'a' });
  assert.throws(() => sessions.post({ sessionId: id, message: 'm' }), (e) => e instanceof SessionError && /running/.test(e.message));
  store.update(id, { status: 'idle' });
  const record = sessions.post({ sessionId: id, message: '  yes, go\n' });
  assert.equal(record.status, 'running');
  assert.equal(record.turn, 2);
  assert.equal(record.pid, 101);
  assert.deepEqual(calls.startTurn[1], { id, turn: 2, text: '  yes, go\n' });
  store.update(id, { status: 'failed' });
  assert.throws(() => sessions.post({ sessionId: id, message: 'm' }), (e) => /failed/.test(e.message));
});

test('post rejects an empty message, an unknown id and a harness mismatch', () => {
  const { sessions, store } = setup();
  const { id } = sessions.start({ harness: 'codex', task: 'a' });
  store.update(id, { status: 'idle' });
  assert.throws(() => sessions.post({ sessionId: id, message: '' }), SessionError);
  assert.throws(() => sessions.post({ sessionId: id, message: '  ' }), SessionError);
  assert.throws(() => sessions.post({ sessionId: '99999999-9999-4999-8999-999999999999', message: 'm' }), SessionError);
  assert.throws(() => sessions.post({ sessionId: 'not-a-uuid', message: 'm' }), SessionError);
  assert.throws(() => sessions.post({ sessionId: id, message: 'm', harness: 'opencode' }), SessionError);
  assert.equal(sessions.query({ sessionId: id }).turn, 1);
  assert.equal(sessions.post({ sessionId: id, message: 'm', harness: 'codex' }).turn, 2);
});

test('query returns one record, checks harness and errors on unknown ids', () => {
  const { sessions } = setup();
  const { id } = sessions.start({ harness: 'codex', task: 'a' });
  assert.equal(sessions.query({ sessionId: id }).id, id);
  assert.equal(sessions.query({ sessionId: id, harness: 'codex' }).task, 'a');
  assert.throws(() => sessions.query({ sessionId: id, harness: 'opencode' }), SessionError);
  assert.throws(() => sessions.query({ sessionId: '99999999-9999-4999-8999-999999999999' }), SessionError);
  assert.throws(() => sessions.query({ sessionId: '../x' }), SessionError);
});

test('list filters by status', async () => {
  const { sessions } = setup();
  const a = sessions.start({ harness: 'codex', task: 'a' });
  await sessions.terminate({ sessionId: a.id });
  const b = sessions.start({ harness: 'codex', task: 'b' });
  assert.equal(sessions.list({}).length, 2);
  assert.deepEqual(sessions.list({ status: 'running' }).map((r) => r.id), [b.id]);
  assert.deepEqual(sessions.list({ status: 'terminated' }).map((r) => r.id), [a.id]);
  assert.deepEqual(sessions.list({ status: 'failed' }), []);
  assert.throws(() => sessions.list({ status: 'bogus' }), SessionError);
});

test('terminate cancels then marks terminated, from running and idle', async () => {
  const { sessions, store, calls } = setup();
  const a = sessions.start({ harness: 'codex', task: 'a' });
  const done = await sessions.terminate({ sessionId: a.id });
  assert.equal(done.status, 'terminated');
  assert.deepEqual(calls.cancel, [a.id]);
  const b = sessions.start({ harness: 'codex', task: 'b' });
  store.update(b.id, { status: 'idle' });
  assert.equal((await sessions.terminate({ sessionId: b.id })).status, 'terminated');
  assert.deepEqual(calls.cancel, [a.id, b.id]);
});

test('terminate cancels before the status changes', async () => {
  const { store, calls } = setup();
  const seen = [];
  const sessions = createSessions({
    store,
    startTurn: () => 1,
    cancel: async (record) => { seen.push(store.get(record.id).status); calls.cancel.push(record.id); },
    isAlive: () => true,
    now: () => 't',
    newId: () => '00000000-0000-4000-8000-000000000001',
  });
  const { id } = sessions.start({ harness: 'codex', task: 'a' });
  await sessions.terminate({ sessionId: id });
  assert.deepEqual(seen, ['running']);
});

test('terminate cancels again when a post started a new turn while it was cancelling', async () => {
  const { store } = setup();
  const cancelled = [];
  const sessions = createSessions({
    store,
    startTurn: (record) => 100 + record.turn,
    cancel: async (record) => {
      cancelled.push({ turn: record.turn, pid: record.pid });
      // The first cancel is slow: the worker finishes and a post starts turn 2 meanwhile.
      if (cancelled.length === 1) {
        store.update(record.id, { status: 'idle', pid: null });
        sessions.post({ sessionId: record.id, message: 'go on' });
      }
    },
    isAlive: () => true,
    now: () => 't',
    newId: () => '00000000-0000-4000-8000-000000000001',
  });
  const { id } = sessions.start({ harness: 'codex', task: 'a' });
  const done = await sessions.terminate({ sessionId: id });
  assert.deepEqual(cancelled, [{ turn: 1, pid: 101 }, { turn: 2, pid: 102 }]);
  assert.equal(done.status, 'terminated');
  assert.equal(store.get(id).pid, null);
});

test('terminate on a failed session cancels and closes it and marks it terminated', async () => {
  const { sessions, store, calls } = setup();
  const { id } = sessions.start({ harness: 'codex', task: 'a' });
  store.update(id, { status: 'failed', error: 'boom', pid: null });
  const record = await sessions.terminate({ sessionId: id });
  assert.equal(record.status, 'terminated');
  assert.deepEqual(calls.cancel, [id]);
});

test('terminate on a terminated session is a no-op returning the record', async () => {
  const { sessions, store, calls } = setup();
  const { id } = sessions.start({ harness: 'codex', task: 'a' });
  store.update(id, { status: 'terminated' });
  assert.equal((await sessions.terminate({ sessionId: id })).status, 'terminated');
  assert.equal(calls.cancel.length, 0);
  await assert.rejects(() => sessions.terminate({ sessionId: '99999999-9999-4999-8999-999999999999' }), SessionError);
});

test('reconcile fails running sessions with a dead pid and leaves the rest', () => {
  const dead = new Set([100]);
  const { sessions, store } = setup({ alive: (pid) => !dead.has(pid) });
  const a = sessions.start({ harness: 'codex', task: 'a' }); // pid 100
  store.update(a.id, { status: 'failed' });
  const b = sessions.start({ harness: 'codex', task: 'b' }); // pid 101
  const c = store.create({ ...store.get(a.id), id: '55555555-5555-4555-8555-555555555555', status: 'running', pid: 100 });
  const d = store.create({ ...store.get(a.id), id: '66666666-6666-4666-8666-666666666666', status: 'idle', pid: 100 });
  sessions.reconcile();
  assert.equal(store.get(c.id).status, 'failed');
  assert.equal(store.get(c.id).error, 'worker lost');
  assert.equal(store.get(b.id).status, 'running');
  assert.equal(store.get(d.id).status, 'idle');
});

test('reconcile treats a running session without a pid as lost', () => {
  const { sessions, store } = setup();
  const { id } = sessions.start({ harness: 'codex', task: 'a' });
  store.update(id, { pid: null });
  sessions.reconcile();
  assert.equal(store.get(id).error, 'worker lost');
});

test('applyTurnResult: ok sets idle with the message, capped at 64 KiB with a marker', () => {
  const { sessions, store } = setup();
  const { id } = sessions.start({ harness: 'codex', task: 'a' });
  let record = applyTurnResult(store, id, { ok: true, message: 'done' }, () => 'T1');
  assert.equal(record.status, 'idle');
  assert.equal(record.lastMessage, 'done');
  assert.equal(record.updatedAt, 'T1');
  store.update(id, { status: 'running' });
  record = applyTurnResult(store, id, { ok: true, message: 'x'.repeat(100 * 1024) }, () => 'T2');
  assert.equal(record.lastMessage.endsWith('\n[truncated]'), true);
  assert.ok(Buffer.byteLength(record.lastMessage) <= 64 * 1024 + '\n[truncated]'.length);
  assert.ok(Buffer.byteLength(record.lastMessage) > 60 * 1024);
});

test('applyTurnResult cuts on a character boundary for multi-byte text', () => {
  const { sessions, store } = setup();
  const { id } = sessions.start({ harness: 'codex', task: 'a' });
  // 'x' shifts every 'é' to an odd offset, so the cut at 65536 falls mid-character.
  const record = applyTurnResult(store, id, { ok: true, message: 'x' + 'é'.repeat(40000) }, () => 'T');
  assert.equal(record.lastMessage.includes('\uFFFD'), false);
  assert.equal(record.lastMessage.endsWith('\n[truncated]'), true);
  assert.ok(Buffer.byteLength(record.lastMessage) <= 64 * 1024 + '\n[truncated]'.length);
});

test('applyTurnResult: not ok sets failed with the error', () => {
  const { sessions, store } = setup();
  const { id } = sessions.start({ harness: 'codex', task: 'a' });
  const record = applyTurnResult(store, id, { ok: false, error: 'exit 1' }, () => 'T');
  assert.equal(record.status, 'failed');
  assert.equal(record.error, 'exit 1');
});

test('applyTurnResult leaves a failed or idle session unchanged', () => {
  const { sessions, store } = setup();
  const { id } = sessions.start({ harness: 'codex', task: 'a' });
  const failed = store.update(id, { status: 'failed', error: 'worker lost' });
  assert.deepEqual(applyTurnResult(store, id, { ok: true, message: 'late' }, () => 'T'), failed);
  assert.equal(store.get(id).status, 'failed');
  const idle = store.update(id, { status: 'idle', error: null, lastMessage: 'first' });
  assert.deepEqual(applyTurnResult(store, id, { ok: false, error: 'late' }, () => 'T'), idle);
  assert.deepEqual(applyTurnResult(store, id, { ok: true, message: 'late' }, () => 'T'), idle);
  assert.equal(store.get(id).lastMessage, 'first');
});

test('applyTurnResult leaves a terminated session unchanged', async () => {
  const { sessions, store } = setup();
  const { id } = sessions.start({ harness: 'codex', task: 'a' });
  const terminated = await sessions.terminate({ sessionId: id });
  assert.deepEqual(applyTurnResult(store, id, { ok: true, message: 'late' }, () => 'T'), terminated);
  assert.deepEqual(applyTurnResult(store, id, { ok: false, error: 'late' }, () => 'T'), terminated);
  assert.equal(store.get(id).status, 'terminated');
});

test('a startTurn that throws leaves a failed session, not a stuck running one', () => {
  const store = createStore(mkdtempSync(join(tmpdir(), 'adw-sessions-')));
  const sessions = createSessions({
    store,
    startTurn: () => { throw new Error('spawn failed'); },
    cancel: async () => {},
    isAlive: () => true,
    now: () => 't',
    newId: () => '00000000-0000-4000-8000-000000000001',
  });
  assert.throws(() => sessions.start({ harness: 'codex', task: 'a' }), (e) => e instanceof SessionError && /spawn failed/.test(e.message));
  const [record] = store.list();
  assert.equal(record.status, 'failed');
  assert.match(record.error, /spawn failed/);
  assert.equal(store.list().some((r) => ['running', 'idle'].includes(r.status)), false);
});
