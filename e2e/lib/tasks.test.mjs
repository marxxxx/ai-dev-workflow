import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { prepareTaskDir, seedRepo, selectTasks, sharedFiles, syncShared, taskDir, taskNames } from './tasks.mjs';

function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'adw-tasks-'));
  const shared = path.join(root, 'e2e/tasks/_shared');
  for (const [p, c] of [['instruction.md', 'I'], ['tests/verify.mjs', 'V'], ['environment/seed/seed.sh', '#!/bin/sh\n']]) {
    mkdirSync(path.dirname(path.join(shared, p)), { recursive: true });
    writeFileSync(path.join(shared, p), c);
  }
  chmodSync(path.join(shared, 'environment/seed/seed.sh'), 0o755);
  mkdirSync(path.join(root, 'e2e/tasks/a/environment/seed/repo'), { recursive: true });
  return { root, shared, config: { root, tasks: { a: { baseImage: 'img-a' }, b: { baseImage: 'img-b' } } } };
}

test('task names, dirs and seed repos come from config.tasks', () => {
  const { root, config } = fixture();
  try {
    assert.deepEqual(taskNames(config), ['a', 'b']);
    assert.equal(taskDir(config, 'b'), path.join(root, 'e2e/tasks/b'));
    assert.equal(seedRepo(config, 'a'), path.join(root, 'e2e/tasks/a/environment/seed/repo'));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('selectTasks defaults to all tasks, keeps a requested subset and rejects unknown names', () => {
  const config = { tasks: { a: {}, b: {} } };
  assert.deepEqual(selectTasks(config, []), ['a', 'b']);
  assert.deepEqual(selectTasks(config, ['b']), ['b']);
  assert.throws(() => selectTasks(config, ['b', 'nope']), /unknown task: nope \(known: a, b\)/);
});

test('syncShared mirrors every shared file, overwrites a stale copy and keeps the executable bit', () => {
  const { root, shared, config } = fixture();
  try {
    const dir = taskDir(config, 'a');
    mkdirSync(path.join(dir, 'tests'), { recursive: true });
    writeFileSync(path.join(dir, 'tests/verify.mjs'), 'stale');
    const files = syncShared({ sharedDir: shared, dir, tracked: new Set() });
    assert.deepEqual(files, ['environment/seed/seed.sh', 'instruction.md', 'tests/verify.mjs']);
    assert.deepEqual(sharedFiles(shared), files);
    assert.equal(readFileSync(path.join(dir, 'tests/verify.mjs'), 'utf8'), 'V');
    assert.equal(readFileSync(path.join(dir, 'instruction.md'), 'utf8'), 'I');
    assert.ok(statSync(path.join(dir, 'environment/seed/seed.sh')).mode & 0o100, 'seed.sh stays executable');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a shared path tracked in the task dir is an error, and nothing is copied', () => {
  const { root, shared, config } = fixture();
  try {
    const dir = taskDir(config, 'a');
    assert.throws(() => syncShared({ sharedDir: shared, dir, tracked: new Set(['instruction.md', 'task.toml']) }),
      /tracked files shadow _shared\/ .*: instruction\.md$/);
    assert.throws(() => readFileSync(path.join(dir, 'tests/verify.mjs')), /ENOENT/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a missing _shared dir is an error', () => {
  const { root, config } = fixture();
  try {
    rmSync(path.join(root, 'e2e/tasks/_shared'), { recursive: true });
    assert.throws(() => prepareTaskDir(config, 'a', { tracked: new Set() }), /_shared is missing/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
