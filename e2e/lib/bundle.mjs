// The PR head as a git bundle: refs/heads/main plus exactly one PR branch. Written by the task's
// verifier in the container (tests/verify.mjs) and by calibration; read by post-verification.
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const defaultGit = (args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 256 * 1024 * 1024 });
// Commits made here must not depend on the host's git identity, signing setup or global hooks.
const COMMIT = ['-c', 'user.name=ADW E2E', '-c', 'user.email=e2e@adw.local', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null'];

export function bundleBranch(bundle, git = defaultGit) {
  const heads = git(['bundle', 'list-heads', bundle]).split('\n').map((l) => l.split(' ')[1]).filter(Boolean);
  const branches = heads.filter((r) => r.startsWith('refs/heads/') && r !== 'refs/heads/main');
  if (!heads.includes('refs/heads/main') || branches.length !== 1) {
    throw new Error(`bundle must hold main and one PR branch, has: ${heads.join(', ') || 'nothing'}`);
  }
  return branches[0].slice('refs/heads/'.length);
}

export function checkoutBundle(bundle, dir, git = defaultGit) {
  const branch = bundleBranch(bundle, git);
  git(['clone', '-q', '-b', branch, bundle, dir]);
  return { branch, diff: git(['-C', dir, 'diff', 'origin/main...HEAD']) };
}

export function createCalibrationBundle({ root, seedRepo, patch, out, git = defaultGit }) {
  const dir = mkdtempSync(path.join(tmpdir(), 'adw-calibration-'));
  try {
    // Only tracked seed files: generated skill files and ai-project.json are not part of the variant.
    for (const file of git(['-C', root, 'ls-files', '-z', '--', seedRepo]).split('\0').filter(Boolean)) {
      const target = path.join(dir, path.relative(seedRepo, path.join(root, file)));
      mkdirSync(path.dirname(target), { recursive: true });
      cpSync(path.join(root, file), target);
    }
    git(['init', '-q', '-b', 'main', dir]);
    git(['-C', dir, 'add', '-A']);
    git([...COMMIT, '-C', dir, 'commit', '-qm', 'Initial demo-todo']);
    git(['-C', dir, 'checkout', '-qb', '1_calibration']);
    git(['-C', dir, 'apply', patch]);
    git(['-C', dir, 'add', '-A']);
    git([...COMMIT, '-C', dir, 'commit', '-qm', 'Calibration variant']);
    git(['-C', dir, 'bundle', 'create', out, 'main', '1_calibration']);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

// The bundle is binary and cannot be redacted: a secret anywhere in its history keeps it out of the results.
export function bundleLeaks(bundle, values, git = defaultGit) {
  const needles = values.filter(Boolean);
  if (!needles.length) return false;
  const dir = mkdtempSync(path.join(tmpdir(), 'adw-bundle-scan-'));
  try {
    git(['clone', '-q', '--bare', bundle, path.join(dir, 'b.git')]);
    const history = git(['-C', path.join(dir, 'b.git'), 'log', '-p', '--all', '--format=%H%n%B']);
    return needles.some((n) => history.includes(n));
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
