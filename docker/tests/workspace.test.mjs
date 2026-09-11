import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateWorkspace } from '../validate-workspace.mjs';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'agent workspace '));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

test('requires an absolute project root, including Windows paths with spaces', t => {
  const root = fixture(t);
  for (const source of ['', '.', '../project', 'C:relative', '/']) {
    assert.throws(() => validateWorkspace(root, source), /PROJECT_ROOT/);
  }
  for (const source of ['/home/user/my project', 'D:\\src\\my project', 'D:/src/my project']) {
    assert.doesNotThrow(() => validateWorkspace(root, source));
  }
});

test('rejects missing workspace and files mounted as the workspace', t => {
  const root = fixture(t);
  assert.throws(() => validateWorkspace(join(root, 'missing'), root), /directory/);
  writeFileSync(join(root, 'file'), '');
  assert.throws(() => validateWorkspace(join(root, 'file'), root), /directory/);
});

test('accepts ordinary repositories and git directories within the mount', t => {
  const root = fixture(t);
  mkdirSync(join(root, '.git'));
  assert.doesNotThrow(() => validateWorkspace(root, root));
  const nested = join(root, 'nested');
  mkdirSync(nested);
  writeFileSync(join(nested, '.git'), 'gitdir: ../.git\n');
  assert.doesNotThrow(() => validateWorkspace(root, root));
});

test('rejects external linked worktrees and external common git directories', t => {
  const root = fixture(t);
  writeFileSync(join(root, '.git'), 'gitdir: /outside/project/.git/worktrees/agent\n');
  assert.throws(() => validateWorkspace(root, root), /Git directory.*outside/);
  mkdirSync(join(root, 'git-data'));
  writeFileSync(join(root, '.git'), 'gitdir: git-data\n');
  writeFileSync(join(root, 'git-data', 'commondir'), '../../outside\n');
  assert.throws(() => validateWorkspace(root, root), /Git directory.*outside/);
});
