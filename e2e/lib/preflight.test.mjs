import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runPreflight } from './preflight.mjs';
import { loadConfig, harnessVersion } from './config.mjs';

const config = loadConfig();
const versions = { claude: harnessVersion(config, 'claude-code'), codex: harnessVersion(config, 'codex'), opencode: harnessVersion(config, 'opencode') };
const exec = (cmd, args) => {
  const k = `${cmd} ${args.join(' ')}`;
  if (k === 'harbor --version') return '0.24.0';
  if (k === 'docker info --format {{.ServerVersion}}') return '29.8.1';
  if (k.startsWith('docker image inspect')) return 'sha256:x';
  if (k.startsWith('docker run')) return `${versions.claude} (Claude Code)\ncodex-cli ${versions.codex}\n${versions.opencode}\n`;
  throw new Error(k);
};

test('preflight passes when everything matches', () => {
  const r = runPreflight({ config, harnesses: ['codex'], exec, probe: () => null, authPresent: () => true, platform: 'linux', root: '/home/u/src/adw' });
  assert.deepEqual(r, { ok: true, problems: [], warnings: [] });
});

test('preflight refuses native Windows and warns for a repo on a Windows drive under WSL', () => {
  const win = runPreflight({ config, harnesses: ['codex'], exec: () => { throw new Error('must not run'); },
    probe: () => null, authPresent: () => true, platform: 'win32', root: 'C:\\src\\adw' });
  assert.equal(win.ok, false);
  assert.deepEqual(win.problems, ['native Windows is not supported: run the E2E self-test inside WSL2 (see docs/adw-e2e/README.md)']);
  const mnt = runPreflight({ config, harnesses: ['codex'], exec, probe: () => null, authPresent: () => true, platform: 'linux', root: '/mnt/c/src/adw' });
  assert.equal(mnt.ok, true);
  assert.match(mnt.warnings[0], /\/mnt\/c/);
});

test('preflight reports version drift, missing auth and failing model probes', () => {
  const bad = (cmd, args) => (cmd === 'harbor' ? '0.25.0' : exec(cmd, args));
  const r = runPreflight({ config, harnesses: ['codex', 'claude-code'], exec: bad, platform: 'linux', root: '/home/u/adw',
    probe: (h) => (h === 'codex' ? 'model not supported' : null), authPresent: (h) => h !== 'claude-code' });
  assert.equal(r.ok, false);
  assert.ok(r.problems.some((p) => /harbor 0.25.0/.test(p)));
  assert.ok(r.problems.some((p) => /claude-code: login missing/.test(p)));
  assert.ok(r.problems.some((p) => /codex: model probe failed: model not supported/.test(p)));
});
