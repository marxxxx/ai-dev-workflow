// Shared harness for the generate.mjs test suite.
//
// - runCli: black-box driver — spawns `node generate.mjs …` in a child process so the tests
//   exercise the real CLI surface (arg parsing, exit codes, stdout/stderr) and stay valid
//   across the commit-2 refactor.
// - tmpProject / makeTmpRoot: throwaway project roots under os.tmpdir() (reusing the existing
//   `adw-` mkdtemp prefix) with an optional minimal ai-project.json, plus a cleanup helper.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const SRC_DIR = path.dirname(fileURLToPath(import.meta.url));
const GENERATE = path.join(SRC_DIR, 'generate.mjs');

/** A minimal, valid file-backend ai-project.json used by most CLI/e2e tests. */
export const MINIMAL_PROJECT = {
  project: { name: 'Test Project', slug: 'test-project', serenaProject: 'test-project', description: 'A test' },
  repository: { slug: 'me/test-project', defaultBranch: 'main' },
  ticketing: { backend: 'file', file: { dir: '.tickets/issues', metadataFile: '.tickets/metadata.json' } },
  git: { branchPattern: 'feat/<issue-number>_<slug>', prTarget: 'main' },
};

/**
 * Run the generator CLI as a subprocess. Returns { status, stdout, stderr }.
 * stdin is empty (never a TTY), matching how the tool runs in CI.
 */
export function runCli(args, { cwd } = {}) {
  const res = spawnSync(process.execPath, [GENERATE, ...args], {
    cwd: cwd || process.cwd(),
    input: '',
    encoding: 'utf8',
  });
  if (res.error) throw res.error;
  return { status: res.status, stdout: res.stdout || '', stderr: res.stderr || '' };
}

/**
 * Whether this process can create symlinks. Windows only permits it with Developer Mode or an
 * elevated shell, so symlink-dependent tests must skip rather than fail there. Probed once.
 */
export const canSymlink = (() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'adw-symlink-probe-'));
  try {
    fs.symlinkSync(GENERATE, path.join(dir, 'probe'));
    return true;
  } catch {
    return false;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
})();

/**
 * Run the CLI through a symlink to generate.mjs, mirroring how npm exposes a `bin` entry on
 * Linux/macOS (a symlink in node_modules/.bin or the global bin dir, not a copy of the file).
 * Node resolves symlinks when computing import.meta.url for the entry module, so this is the
 * scenario that catches a `process.argv[1] === import.meta.url` main-module check that forgot
 * to realpath argv[1] first — that mismatch makes `main()` silently never run (exit 0, no output).
 */
export function runCliViaSymlink(args, { cwd } = {}) {
  const linkDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adw-bin-'));
  const link = path.join(linkDir, 'ai-dev-workflow');
  fs.symlinkSync(GENERATE, link);
  try {
    const res = spawnSync(process.execPath, [link, ...args], {
      cwd: cwd || process.cwd(),
      input: '',
      encoding: 'utf8',
    });
    if (res.error) throw res.error;
    return { status: res.status, stdout: res.stdout || '', stderr: res.stderr || '' };
  } finally {
    fs.rmSync(linkDir, { recursive: true, force: true });
  }
}

/** Create an empty throwaway project root. Returns { root, cleanup }. */
export function makeTmpRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'adw-'));
  return { root, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

/**
 * Create a throwaway project root seeded with an ai-project.json.
 * `config` overrides MINIMAL_PROJECT (pass a full object). Returns { root, cleanup }.
 */
export function tmpProject(config = MINIMAL_PROJECT) {
  const { root, cleanup } = makeTmpRoot();
  fs.writeFileSync(path.join(root, 'ai-project.json'), JSON.stringify(config, null, 2) + '\n');
  return { root, cleanup };
}
