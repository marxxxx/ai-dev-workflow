import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, statSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { stageSecrets, scanForSecrets, redactSecrets, scrubSecretsInTree, removeOpenCodeAuthCopies } from './secrets.mjs';

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

test('scrubSecretsInTree redacts text files, never rewrites binary/db files, honors skip', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'scrub-'));
  const secret = 'sk-very-secret-value';
  writeFileSync(path.join(dir, 'a.log'), `token ${secret} end`);
  writeFileSync(path.join(dir, 'clean.log'), 'nothing');
  const bin = Buffer.concat([Buffer.from([0, 1, 2]), Buffer.from(secret), Buffer.from([255, 254])]);
  writeFileSync(path.join(dir, 'blob.bin'), bin);
  const db = Buffer.from(`SQLite ${secret}`);
  for (const n of ['opencode.db', 'opencode.db-wal', 'opencode.db-shm']) writeFileSync(path.join(dir, n), db);
  mkdirSync(path.join(dir, '.secrets'));
  writeFileSync(path.join(dir, '.secrets', 'x.json'), secret);
  const r = scrubSecretsInTree(dir, [secret], { skip: (f) => f.split(path.sep).includes('.secrets') });
  assert.deepEqual(r.redacted, [path.join(dir, 'a.log')]);
  assert.deepEqual(r.skippedWithSecret.sort(), ['blob.bin', 'opencode.db', 'opencode.db-shm', 'opencode.db-wal'].map((n) => path.join(dir, n)).sort());
  assert.equal(readFileSync(path.join(dir, 'a.log'), 'utf8'), 'token *** end');
  assert.deepEqual(readFileSync(path.join(dir, 'blob.bin')), bin);
  assert.deepEqual(readFileSync(path.join(dir, 'opencode.db')), db);
  assert.equal(readFileSync(path.join(dir, '.secrets', 'x.json'), 'utf8'), secret);
  rmSync(dir, { recursive: true, force: true });
});

test('removeOpenCodeAuthCopies deletes only OpenCode auth.json copies under the jobs dir', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'oc-'));
  const auth = path.join(dir, 'opencode-1/demo-todo__x/agent/opencode/xdg-data/opencode/auth.json');
  const other = path.join(dir, 'opencode-1/demo-todo__x/agent/auth.json');
  for (const f of [auth, other]) { mkdirSync(path.dirname(f), { recursive: true }); writeFileSync(f, '{}'); }
  assert.deepEqual(removeOpenCodeAuthCopies(dir), [auth]);
  assert.equal(existsSync(auth), false);
  assert.equal(existsSync(other), true);
  rmSync(dir, { recursive: true, force: true });
});

test('stageSecrets does not treat account ids or last_refresh as secrets', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'adw-e2e-'));
  try {
    writeFileSync(path.join(dir, 'codex.json'), JSON.stringify({ last_refresh: '2026-10-10T10:00:00Z', tokens: { access_token: 'cx-9', account_id: 'acct-123' } }));
    writeFileSync(path.join(dir, 'oc.json'), JSON.stringify({ openai: { type: 'oauth', access: 'oc-acc', accountId: 'acct-456' } }));
    const config = { root: dir, auth: { claudeEnvFile: 'none.env', codexAuthJson: path.join(dir, 'codex.json'), opencodeAuthJson: path.join(dir, 'oc.json') } };
    const s = stageSecrets({ config, invocationDir: path.join(dir, 'inv') });
    assert.deepEqual(s.values.sort(), ['cx-9', 'oc-acc']);
    s.cleanup();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
