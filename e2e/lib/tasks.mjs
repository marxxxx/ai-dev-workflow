// E2E tasks: e2e/tasks/<name>/ holds what is stack-specific, e2e/tasks/_shared/ what every task shares.
// prepareTaskDir mirrors _shared/ into a task before Harbor, an image build or a calibration reads it;
// the copies are git-ignored (e2e/.gitignore), so _shared/ stays the only tracked copy.
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { walk } from './fsutil.mjs';

export const SHARED = '_shared';
export const tasksRoot = (config) => path.join(config.root, 'e2e', 'tasks');
export const taskNames = (config) => Object.keys(config.tasks);
export const taskDir = (config, name) => path.join(tasksRoot(config), name);
export const seedRepo = (config, name) => path.join(taskDir(config, name), 'environment', 'seed', 'repo');

export function selectTasks(config, requested = []) {
  const known = taskNames(config);
  const unknown = requested.filter((t) => !known.includes(t));
  if (unknown.length) throw new Error(`unknown task: ${unknown.join(', ')} (known: ${known.join(', ')})`);
  return requested.length ? requested : known;
}

export function sharedFiles(sharedDir) {
  return walk(sharedDir).map((f) => path.relative(sharedDir, f)).sort();
}

export function syncShared({ sharedDir, dir, tracked }) {
  if (!existsSync(sharedDir)) throw new Error(`${sharedDir} is missing`);
  const files = sharedFiles(sharedDir);
  const clash = files.filter((f) => tracked.has(f));
  if (clash.length) throw new Error(`${dir}: tracked files shadow _shared/ (keep the only copy in _shared/): ${clash.join(', ')}`);
  for (const f of files) {
    mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    cpSync(path.join(sharedDir, f), path.join(dir, f));
  }
  return files;
}

const gitTracked = (root, dir) => new Set(execFileSync('git', ['-C', root, 'ls-files', '-z', '--', dir], { encoding: 'utf8' })
  .split('\0').filter(Boolean).map((f) => path.relative(dir, path.join(root, f))));

export function prepareTaskDir(config, name, { tracked } = {}) {
  const dir = taskDir(config, name);
  return syncShared({ sharedDir: path.join(tasksRoot(config), SHARED), dir, tracked: tracked ?? gitTracked(config.root, dir) });
}
