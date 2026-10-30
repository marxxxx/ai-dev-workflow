import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { prepareTaskDir, SHARED, seedRepo, selectTasks, sharedFiles, syncShared, taskDir, taskNames, tasksRoot } from './tasks.mjs';
import { execFileSync } from 'node:child_process';
import { loadConfig } from './config.mjs';

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
  assert.deepEqual(selectTasks(config, ['b', 'a', 'b']), ['b', 'a']);
  assert.throws(() => selectTasks(config, ['b', 'nope']), /unknown task: nope \(known: a, b\)/);
});

// Windows has no executable bit, so the mode check cannot hold there.
test('syncShared mirrors every shared file, overwrites a stale copy and keeps the executable bit', { skip: process.platform === 'win32' && 'no executable bit on Windows' }, () => {
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

const repo = loadConfig();
const gitIn = (...a) => execFileSync('git', ['-C', repo.root, ...a], { encoding: 'utf8' });
const ignored = (p) => { try { gitIn('check-ignore', '-q', '--no-index', p); return true; } catch { return false; } };
const rel = (p) => path.relative(repo.root, p);

test('every configured task has its stack-specific files, and its Dockerfile builds on the configured base image', () => {
  const expected = JSON.parse(readFileSync(path.join(tasksRoot(repo), SHARED, 'calibration/expected.json'), 'utf8'));
  for (const name of taskNames(repo)) {
    const dir = taskDir(repo, name);
    for (const f of ['task.toml', 'environment/Dockerfile', ...Object.keys(expected).map((v) => `calibration/${v}.patch`)]) {
      assert.ok(existsSync(path.join(dir, f)), `${name}: ${f}`);
    }
    assert.ok(existsSync(seedRepo(repo, name)), `${name}: seed repo`);
    const from = readFileSync(path.join(dir, 'environment/Dockerfile'), 'utf8').match(/^FROM\s+(\S+)/m)?.[1];
    assert.equal(from, repo.tasks[name].baseImage, `${name}: Dockerfile FROM`);
  }
});

test('shared files are tracked only in _shared/, and their mirrored copies are git-ignored in every task', () => {
  const shared = sharedFiles(path.join(tasksRoot(repo), SHARED));
  assert.ok(shared.includes('acceptance-criteria.md') && shared.includes(path.normalize('tests/verify.mjs')));
  for (const name of taskNames(repo)) {
    const dir = rel(taskDir(repo, name));
    const tracked = new Set(gitIn('ls-files', '-z', '--', dir).split('\0').filter(Boolean).map((f) => path.relative(dir, f)));
    for (const f of shared) {
      assert.ok(!tracked.has(f), `${name}/${f} is tracked: keep the only copy in _shared/`);
      assert.ok(ignored(path.join(dir, f)), `${name}/${f} must be git-ignored`);
    }
  }
  for (const f of shared) assert.ok(!ignored(rel(path.join(tasksRoot(repo), SHARED, f))), `_shared/${f} must not be ignored`);
});
