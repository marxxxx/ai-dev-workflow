import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, statSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { stageSecrets, scanForSecrets } from './secrets.mjs';

test('stageSecrets copies auth files 0600, exposes env and cleans up', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'adw-e2e-'));
  try {
    writeFileSync(path.join(dir, '.env'), 'CLAUDE_CODE_OAUTH_TOKEN=tok-123\n');
    writeFileSync(path.join(dir, 'codex.json'), '{"tokens":{"access_token":"cx-9"}}');
    writeFileSync(path.join(dir, 'oc.json'), '{"mistral":{"type":"api","key":"mk-7"}}');
    const config = { root: dir, auth: { claudeEnvFile: '.env', codexAuthJson: path.join(dir, 'codex.json'), opencodeAuthJson: path.join(dir, 'oc.json') } };
    const s = stageSecrets({ config, invocationDir: path.join(dir, 'inv') });
    assert.equal(s.env.CLAUDE_CODE_OAUTH_TOKEN, 'tok-123');
    assert.equal(s.env.CLAUDE_FORCE_OAUTH, '1');
    assert.equal(statSync(s.env.CODEX_AUTH_JSON_PATH).mode & 0o777, 0o600);
    assert.equal(readFileSync(s.env.OPENCODE_AUTH_JSON_PATH, 'utf8'), '{"mistral":{"type":"api","key":"mk-7"}}');
    assert.ok(s.values.includes('tok-123') && s.values.includes('cx-9') && s.values.includes('mk-7'));
    s.cleanup();
    assert.equal(existsSync(s.env.CODEX_AUTH_JSON_PATH), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('scanForSecrets finds leaked values', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'adw-e2e-'));
  try {
    mkdirSync(path.join(dir, 'e'));
    writeFileSync(path.join(dir, 'e/a.txt'), 'clean');
    writeFileSync(path.join(dir, 'e/b.txt'), 'oops tok-123');
    assert.deepEqual(scanForSecrets(dir, ['tok-123']), [path.join(dir, 'e/b.txt')]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
