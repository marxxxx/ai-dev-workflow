import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildFingerprint, diffFingerprints } from './fingerprint.mjs';
import { loadConfig } from './config.mjs';

function demoRepo() {
  const d = mkdtempSync(path.join(tmpdir(), 'adw-e2e-'));
  for (const [p, c] of [['.claude/skills/agent-dev/SKILL.md', 'c'], ['.agents/skills/agent-dev/SKILL.md', 'x'],
    ['.opencode/skills/agent-dev/SKILL.md', 'o'], ['.agents/includes/ticketing.md', 't']]) {
    mkdirSync(path.dirname(path.join(d, p)), { recursive: true });
    writeFileSync(path.join(d, p), c);
  }
  return d;
}
const exec = (cmd, args) => {
  const key = `${cmd} ${args.join(' ')}`;
  if (key === 'git rev-parse HEAD') return 'abc123\n';
  if (key === 'git status --porcelain') return '';
  if (key.startsWith('docker image inspect')) return 'sha256:img1\n';
  if (key === 'harbor --version') return '0.24.0\n';
  throw new Error(`unexpected ${key}`);
};

test('fingerprint records versions, hashes and image', () => {
  const repo = demoRepo();
  try {
    const fp = buildFingerprint({ config: loadConfig(), harness: 'codex', demoRepo: repo, exec });
    assert.equal(fp.adw.sha, 'abc123');
    assert.equal(fp.adw.dirty, false);
    assert.equal(fp.image.id, 'sha256:img1');
    assert.equal(fp.harbor.version, '0.24.0');
    assert.match(fp.skill.claude, /^[0-9a-f]{64}$/);
    assert.match(fp.image.harnessVersion, /^\d+\.\d+\.\d+/);
    assert.match(fp.image.superpowers, /^[0-9a-f]{40}$/);
  } finally { rmSync(repo, { recursive: true, force: true }); }
});

test('diffFingerprints lists changed dotted keys only', () => {
  const a = { adw: { sha: '1', dirty: false }, skill: { claude: 'h1' }, config: 'c' };
  const b = { adw: { sha: '2', dirty: false }, skill: { claude: 'h2' }, config: 'c' };
  assert.deepEqual(diffFingerprints(a, b), [
    { key: 'adw.sha', from: '1', to: '2' }, { key: 'skill.claude', from: 'h1', to: 'h2' }]);
});
