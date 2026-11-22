import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createStore } from './store.mjs';

const ID = '11111111-1111-4111-8111-111111111111';
const ID2 = '22222222-2222-4222-8222-222222222222';
const record = (id, extra = {}) => ({
  id, harness: 'codex', task: 't', status: 'running', turn: 1, lastMessage: null, error: null,
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', pid: 42, ...extra,
});
const tmp = () => mkdtempSync(join(tmpdir(), 'adw-store-'));

test('create and get round trip', () => {
  const store = createStore(tmp());
  store.create(record(ID));
  assert.deepEqual(store.get(ID), record(ID));
  assert.equal(store.get(ID2), null);
});

test('create leaves only session.json behind (atomic write, no temp files)', () => {
  const dir = tmp();
  const store = createStore(dir);
  store.create(record(ID));
  store.update(ID, { turn: 2 });
  assert.deepEqual(readdirSync(join(dir, ID)), ['session.json']);
});

test('update merges the patch and returns the record', () => {
  const store = createStore(tmp());
  store.create(record(ID));
  const updated = store.update(ID, { status: 'idle', lastMessage: 'hi' });
  assert.equal(updated.status, 'idle');
  assert.equal(updated.task, 't');
  assert.deepEqual(store.get(ID), updated);
});

test('update of an unknown id throws', () => {
  assert.throws(() => createStore(tmp()).update(ID, { turn: 2 }), /unknown session/);
});

test('list returns records and skips corrupt or unreadable files', () => {
  const dir = tmp();
  const store = createStore(dir);
  store.create(record(ID));
  store.create(record(ID2));
  mkdirSync(join(dir, '33333333-3333-4333-8333-333333333333'));
  mkdirSync(join(dir, '44444444-4444-4444-8444-444444444444'));
  writeFileSync(join(dir, '44444444-4444-4444-8444-444444444444', 'session.json'), '{not json');
  writeFileSync(join(dir, 'stray.txt'), 'x');
  assert.deepEqual(store.list().map((r) => r.id).sort(), [ID, ID2]);
});

test('list on a missing directory is empty', () => {
  assert.deepEqual(createStore(join(tmp(), 'nope')).list(), []);
});

test('ids that are not UUIDs throw in get, update and dirOf', () => {
  const store = createStore(tmp());
  for (const bad of ['../x', '', 'abc', `${ID}/..`, undefined]) {
    assert.throws(() => store.get(bad), /invalid session id/);
    assert.throws(() => store.update(bad, {}), /invalid session id/);
    assert.throws(() => store.dirOf(bad), /invalid session id/);
  }
  assert.equal(store.dirOf(ID).endsWith(ID), true);
});
