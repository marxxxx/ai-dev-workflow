import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { bundleBranch, bundleLeaks, checkoutBundle, createCalibrationBundle } from './bundle.mjs';

const git = (cwd, ...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', '-C', cwd, ...a],
  { encoding: 'utf8', stdio: 'pipe' });

// A host repo with a tracked seed dir (plus one untracked file) and a patch for the seed's app file.
function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'adw-bundle-'));
  const seed = path.join(root, 'seed');
  mkdirSync(path.join(seed, 'src'), { recursive: true });
  writeFileSync(path.join(seed, 'src/app.mjs'), 'export const a = 1;\n');
  writeFileSync(path.join(seed, 'ignored.txt'), 'untracked\n');
  git(root, 'init', '-q', '-b', 'main');
  git(root, 'add', 'seed/src/app.mjs');
  git(root, 'commit', '-qm', 'seed');
  const patch = path.join(root, 'v.patch');
  writeFileSync(patch, 'diff --git a/src/app.mjs b/src/app.mjs\n--- a/src/app.mjs\n+++ b/src/app.mjs\n@@ -1 +1,2 @@\n export const a = 1;\n+export const b = 2;\n');
  return { root, seed, patch };
}

test('a calibration bundle holds the tracked seed on main and the patch on one branch; checkout yields the diff', () => {
  const { root, seed, patch } = fixture();
  try {
    const out = path.join(root, 'v.bundle');
    createCalibrationBundle({ root, seedRepo: seed, patch, out });
    assert.equal(bundleBranch(out), '1_calibration');
    const co = path.join(root, 'co');
    const { branch, diff } = checkoutBundle(out, co);
    assert.equal(branch, '1_calibration');
    assert.match(diff, /^\+export const b = 2;$/m);
    assert.equal(readFileSync(path.join(co, 'src/app.mjs'), 'utf8'), 'export const a = 1;\nexport const b = 2;\n');
    assert.throws(() => readFileSync(path.join(co, 'ignored.txt')), /ENOENT/, 'untracked seed files stay out');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a bundle without main or with two PR branches is rejected', () => {
  const { root } = fixture();
  try {
    git(root, 'branch', 'b1');
    git(root, 'branch', 'b2');
    const two = path.join(root, 'two.bundle');
    git(root, 'bundle', 'create', two, 'main', 'b1', 'b2');
    assert.throws(() => bundleBranch(two), /main and one PR branch/);
    const nomain = path.join(root, 'nomain.bundle');
    git(root, 'bundle', 'create', nomain, 'b1');
    assert.throws(() => bundleBranch(nomain), /main and one PR branch/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('bundleLeaks finds a secret value anywhere in the bundle history', () => {
  const { root, seed, patch } = fixture();
  try {
    const out = path.join(root, 'v.bundle');
    createCalibrationBundle({ root, seedRepo: seed, patch, out });
    assert.equal(bundleLeaks(out, ['sk-not-there']), false);
    assert.equal(bundleLeaks(out, ['export const b']), true);
    assert.equal(bundleLeaks(out, []), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
