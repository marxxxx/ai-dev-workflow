// The PR head as a git bundle: refs/heads/main plus exactly one PR branch. Written by the task's
// verifier in the container (tests/verify.mjs) and by calibration; read by post-verification.
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Nothing here may depend on the host's git config: no hooks, no global ignores, no autocrlf.
const ISOLATE = ['-c', 'core.hooksPath=/dev/null', '-c', 'core.excludesFile=/dev/null', '-c', 'core.autocrlf=false'];
const defaultGit = (args) => execFileSync('git', [...ISOLATE, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 256 * 1024 * 1024 });
// Commits made here must not depend on the host's git identity or signing setup.
const COMMIT = ['-c', 'user.name=ADW E2E', '-c', 'user.email=e2e@adw.local', '-c', 'commit.gpgsign=false'];
// Fixed diff format: host diff.* settings (prefixes, external diff, textconv, colour) must not change the diff.
const DIFF = ['--no-ext-diff', '--no-textconv', '--no-color', '--src-prefix=a/', '--dst-prefix=b/'];

export function bundleBranch(bundle, git = defaultGit) {
  const heads = git(['bundle', 'list-heads', path.resolve(bundle)]).split('\n').map((l) => l.split(' ')[1]).filter((r) => r && r !== 'HEAD');
  const branches = heads.filter((r) => r.startsWith('refs/heads/') && r !== 'refs/heads/main');
  if (!heads.includes('refs/heads/main') || branches.length !== 1 || heads.length !== 2) {
    throw new Error(`bundle must hold main and one PR branch, has: ${heads.join(', ') || 'nothing'}`);
  }
  return branches[0].slice('refs/heads/'.length);
}

export function checkoutBundle(bundle, dir, git = defaultGit) {
  const src = path.resolve(bundle);
  const target = path.resolve(dir);
  const branch = bundleBranch(src, git);
  git(['clone', '-q', '--template=', '-b', branch, src, target]);
  return { branch, diff: git(['-C', target, 'diff', ...DIFF, 'origin/main...HEAD']) };
}

export function createCalibrationBundle({ root, seedRepo, patch, out, name, git = defaultGit }) {
  const repo = path.resolve(root);
  const seed = path.resolve(seedRepo);
  const patchFile = path.resolve(patch);
  const bundleOut = path.resolve(out);
  const dir = mkdtempSync(path.join(tmpdir(), 'adw-calibration-'));
  try {
    // Only tracked seed files: generated skill files and ai-project.json are not part of the variant.
    for (const file of git(['-C', repo, 'ls-files', '-z', '--', seed]).split('\0').filter(Boolean)) {
      const target = path.join(dir, path.relative(seed, path.join(repo, file)));
      mkdirSync(path.dirname(target), { recursive: true });
      cpSync(path.join(repo, file), target);
    }
    git(['init', '-q', '--template=', '-b', 'main', dir]);
    git(['-C', dir, 'add', '-A']);
    git([...COMMIT, '-C', dir, 'commit', '-qm', `Initial ${name}`]);
    git(['-C', dir, 'checkout', '-qb', '1_calibration']);
    git(['-C', dir, 'apply', patchFile]);
    git(['-C', dir, 'add', '-A']);
    git([...COMMIT, '-C', dir, 'commit', '-qm', 'Calibration variant']);
    git(['-C', dir, 'bundle', 'create', bundleOut, 'main', '1_calibration']);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

// The bundle is binary and cannot be redacted: a secret anywhere in its history keeps it out of the results.
export function bundleLeaks(bundle, values, git = defaultGit) {
  const needles = values.filter(Boolean);
  if (!needles.length) return false;
  const dir = mkdtempSync(path.join(tmpdir(), 'adw-bundle-scan-'));
  try {
    const bare = path.join(dir, 'b.git');
    git(['init', '-q', '--bare', '--template=', bare]);
    // Every ref, not only heads: a clone of heads would skip objects reachable only from e.g. refs/stash.
    git(['-C', bare, 'fetch', '-q', path.resolve(bundle), '+refs/*:refs/*']);
    // Raw content of every object: `git log -p` would print binary blobs as "Binary files differ".
    const objects = git(['-C', bare, 'cat-file', '--batch-all-objects', '--batch']);
    return needles.some((n) => objects.includes(n));
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
