import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, statSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { stageSecrets, scanForSecrets, redactSecrets } from './secrets.mjs';

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

test('stageSecrets collects OpenCode OAuth access and refresh tokens, not the type label', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'adw-e2e-'));
  try {
    const shape = { anthropic: { type: 'oauth', access: 'acc-token-111', refresh: 'ref-token-222', expires: 1790000000000 } };
    writeFileSync(path.join(dir, 'oc.json'), JSON.stringify(shape));
    const config = { root: dir, auth: { claudeEnvFile: '.env', codexAuthJson: path.join(dir, 'missing.json'), opencodeAuthJson: path.join(dir, 'oc.json') } };
    const s = stageSecrets({ config, invocationDir: path.join(dir, 'inv') });
    assert.ok(s.values.includes('acc-token-111'));
    assert.ok(s.values.includes('ref-token-222'));
    assert.ok(!s.values.includes('oauth'));
    s.cleanup();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('stageSecrets removes its staging dir when an auth file is not valid JSON', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'adw-e2e-'));
  try {
    writeFileSync(path.join(dir, 'bad.json'), '{not json');
    const config = { root: dir, auth: { claudeEnvFile: '.env', codexAuthJson: path.join(dir, 'bad.json'), opencodeAuthJson: path.join(dir, 'missing.json') } };
    const inv = path.join(dir, 'inv');
    assert.throws(() => stageSecrets({ config, invocationDir: inv }), SyntaxError);
    assert.equal(existsSync(path.join(inv, '.secrets')), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('redactSecrets replaces every occurrence of each value and ignores empty values', () => {
  assert.equal(redactSecrets('a SECRET b SECRET c tok-2', ['SECRET', '', 'tok-2']), 'a *** b *** c ***');
  assert.equal(redactSecrets('nothing here', []), 'nothing here');
  assert.equal(redactSecrets('abc-long abc', ['abc', 'abc-long']), '*** ***');
});

test('stageSecrets strips export and quotes from the env-file token', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'adw-e2e-'));
  try {
    const config = { root: dir, auth: { claudeEnvFile: '.env', codexAuthJson: path.join(dir, 'm1.json'), opencodeAuthJson: path.join(dir, 'm2.json') } };
    for (const line of ['export CLAUDE_CODE_OAUTH_TOKEN="tok-q"', "CLAUDE_CODE_OAUTH_TOKEN='tok-q'", 'export CLAUDE_CODE_OAUTH_TOKEN=tok-q']) {
      writeFileSync(path.join(dir, '.env'), `${line}\n`);
      const s = stageSecrets({ config, invocationDir: path.join(dir, 'inv') });
      assert.equal(s.env.CLAUDE_CODE_OAUTH_TOKEN, 'tok-q', line);
      s.cleanup();
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('stageSecrets falls back to the process env when the env file lacks the key', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'adw-e2e-'));
  const prev = process.env.CLAUDE_CODE_OAUTH_TOKEN;
  try {
    writeFileSync(path.join(dir, '.env'), 'OTHER=1\n');
    process.env.CLAUDE_CODE_OAUTH_TOKEN = 'tok-env';
    const config = { root: dir, auth: { claudeEnvFile: '.env', codexAuthJson: path.join(dir, 'm1.json'), opencodeAuthJson: path.join(dir, 'm2.json') } };
    const s = stageSecrets({ config, invocationDir: path.join(dir, 'inv') });
    assert.equal(s.env.CLAUDE_CODE_OAUTH_TOKEN, 'tok-env');
    s.cleanup();
  } finally {
    if (prev === undefined) delete process.env.CLAUDE_CODE_OAUTH_TOKEN; else process.env.CLAUDE_CODE_OAUTH_TOKEN = prev;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('stageSecrets does not treat auth_mode labels as secrets', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'adw-e2e-'));
  try {
    writeFileSync(path.join(dir, 'cx.json'), '{"auth_mode":"chatgpt","tokens":{"access_token":"cx-9"}}');
    const config = { root: dir, auth: { claudeEnvFile: '.env', codexAuthJson: path.join(dir, 'cx.json'), opencodeAuthJson: path.join(dir, 'm.json') } };
    const s = stageSecrets({ config, invocationDir: path.join(dir, 'inv') });
    assert.ok(s.values.includes('cx-9'));
    assert.ok(!s.values.includes('chatgpt'));
    s.cleanup();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
