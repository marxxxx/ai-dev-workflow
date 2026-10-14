import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

// Runs fn with the host's global git config replaced by `file` (the module must not depend on it).
function withGlobalConfig(file, fn) {
  const prev = process.env.GIT_CONFIG_GLOBAL;
  process.env.GIT_CONFIG_GLOBAL = file;
  try { return fn(); } finally {
    if (prev === undefined) delete process.env.GIT_CONFIG_GLOBAL; else process.env.GIT_CONFIG_GLOBAL = prev;
  }
}

test('a calibration bundle holds the tracked seed on main and the patch on one branch; checkout yields the diff', () => {
  const { root, seed, patch } = fixture();
  try {
    const out = path.join(root, 'v.bundle');
    createCalibrationBundle({ root, seedRepo: seed, patch, out, name: 'demo-todo' });
    assert.equal(bundleBranch(out), '1_calibration');
    const co = path.join(root, 'co');
    const { branch, diff } = checkoutBundle(out, co);
    assert.equal(branch, '1_calibration');
    assert.equal(git(co, 'log', '-1', '--format=%s', 'origin/main').trim(), 'Initial demo-todo');
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

test('a bundle with main, a PR branch and an extra non-head ref is rejected', () => {
  const { root } = fixture();
  try {
    git(root, 'branch', 'b1');
    git(root, 'tag', 'x');
    const out = path.join(root, 'tagged.bundle');
    git(root, 'bundle', 'create', out, 'main', 'b1', 'refs/tags/x');
    assert.throws(() => bundleBranch(out), /main and one PR branch, has: .*refs\/tags\/x/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('bundleLeaks finds a secret value anywhere in the bundle history', () => {
  const { root, seed, patch } = fixture();
  try {
    const out = path.join(root, 'v.bundle');
    createCalibrationBundle({ root, seedRepo: seed, patch, out, name: 'demo-todo' });
    assert.equal(bundleLeaks(out, ['sk-not-there']), false);
    assert.equal(bundleLeaks(out, ['export const b']), true);
    assert.equal(bundleLeaks(out, []), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('bundleLeaks finds a secret inside a binary blob', () => {
  const { root } = fixture();
  try {
    git(root, 'checkout', '-qb', 'bin');
    writeFileSync(path.join(root, 'blob.bin'), Buffer.from('x\0SECRETBIN\0y'));
    git(root, 'add', 'blob.bin');
    git(root, 'commit', '-qm', 'binary');
    const out = path.join(root, 'bin.bundle');
    git(root, 'bundle', 'create', out, 'main', 'bin');
    assert.equal(bundleLeaks(out, ['SECRETBIN']), true);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('bundleLeaks finds a secret that only an earlier, later-removed commit holds', () => {
  const { root } = fixture();
  try {
    git(root, 'checkout', '-qb', 'pr');
    writeFileSync(path.join(root, 's.txt'), 'SECRET-EARLIER\n');
    git(root, 'add', 's.txt');
    git(root, 'commit', '-qm', 'add');
    git(root, 'rm', '-q', 's.txt');
    git(root, 'commit', '-qm', 'remove');
    const out = path.join(root, 'pr.bundle');
    git(root, 'bundle', 'create', out, 'main', 'pr');
    assert.equal(bundleLeaks(out, ['SECRET-EARLIER']), true);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('bundleLeaks finds a secret in a commit message', () => {
  const { root } = fixture();
  try {
    git(root, 'checkout', '-qb', 'msg');
    git(root, 'commit', '-q', '--allow-empty', '-m', 'token SECRET-IN-MSG');
    const out = path.join(root, 'msg.bundle');
    git(root, 'bundle', 'create', out, 'main', 'msg');
    assert.equal(bundleLeaks(out, ['SECRET-IN-MSG']), true);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('bundleLeaks finds a secret reachable only from a non-head ref', () => {
  const { root } = fixture();
  try {
    git(root, 'checkout', '-qb', 'side');
    writeFileSync(path.join(root, 's.txt'), 'SECRET-STASH\n');
    git(root, 'add', 's.txt');
    git(root, 'commit', '-qm', 'stash-like');
    const sha = git(root, 'rev-parse', 'HEAD').trim();
    git(root, 'checkout', '-q', 'main');
    git(root, 'update-ref', 'refs/extra/x', sha);
    const out = path.join(root, 'extra.bundle');
    git(root, 'bundle', 'create', out, 'main', 'refs/extra/x');
    assert.equal(bundleLeaks(out, ['SECRET-STASH']), true);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('the calibration bundle keeps a tracked seed file that a host global excludes would drop', () => {
  const { root, seed, patch } = fixture();
  try {
    writeFileSync(path.join(seed, 'keep.txt'), 'tracked\n');
    git(root, 'add', 'seed/keep.txt');
    git(root, 'commit', '-qm', 'keep');
    const ignore = path.join(root, 'ignore');
    writeFileSync(ignore, '*.txt\n');
    const globalCfg = path.join(root, 'global.gitconfig');
    writeFileSync(globalCfg, `[core]\n\texcludesFile = ${ignore}\n`);
    const out = path.join(root, 'v.bundle');
    withGlobalConfig(globalCfg, () => createCalibrationBundle({ root, seedRepo: seed, patch, out, name: 'demo-todo' }));
    const co = path.join(root, 'co');
    checkoutBundle(out, co);
    assert.equal(readFileSync(path.join(co, 'keep.txt'), 'utf8'), 'tracked\n');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('checkoutBundle runs no host template hooks and ignores host diff prefix settings', () => {
  const { root, seed, patch } = fixture();
  try {
    const out = path.join(root, 'v.bundle');
    createCalibrationBundle({ root, seedRepo: seed, patch, out, name: 'demo-todo' });
    const tpl = path.join(root, 'tpl');
    mkdirSync(path.join(tpl, 'hooks'), { recursive: true });
    const marker = path.join(root, 'hook-ran');
    writeFileSync(path.join(tpl, 'hooks/post-checkout'), `#!/bin/sh\ntouch ${marker}\n`, { mode: 0o755 });
    const hostCfg = path.join(root, 'host.gitconfig');
    writeFileSync(hostCfg, `[init]\n\ttemplateDir = ${tpl}\n[diff]\n\tnoprefix = true\n`);
    const { diff } = withGlobalConfig(hostCfg, () => checkoutBundle(out, path.join(root, 'co')));
    assert.equal(existsSync(marker), false, 'host post-checkout hook must not run');
    assert.match(diff, /^\+\+\+ b\/src\/app\.mjs$/m);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('relative paths resolve against the caller directory, not the git working directory', () => {
  const { root } = fixture();
  const cwd = process.cwd();
  try {
    process.chdir(root);
    createCalibrationBundle({ root: '.', seedRepo: 'seed', patch: 'v.patch', out: 'v.bundle', name: 'demo-todo' });
    assert.equal(bundleBranch('v.bundle'), '1_calibration');
    const { diff } = checkoutBundle('v.bundle', 'co');
    assert.match(diff, /^\+export const b = 2;$/m);
    assert.equal(bundleLeaks('v.bundle', ['export const b']), true);
  } finally { process.chdir(cwd); rmSync(root, { recursive: true, force: true }); }
});
