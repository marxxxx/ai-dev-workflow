import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, statSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openCodeExport, stageSecrets, scanForSecrets, redactSecrets, scrubSecretsInTree, removeOpenCodeDbCredentials, secretLeaves } from './secrets.mjs';

// Windows has no POSIX file modes, so the 0600 check cannot hold there.
test('stageSecrets copies auth files 0600, exposes env and cleans up', { skip: process.platform === 'win32' && 'no POSIX file modes on Windows' }, () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'adw-e2e-'));
  try {
    writeFileSync(path.join(dir, '.env'), 'CLAUDE_CODE_OAUTH_TOKEN=tok-123\n');
    writeFileSync(path.join(dir, 'codex.json'), '{"tokens":{"access_token":"cx-9"}}');
    writeFileSync(path.join(dir, 'oc.json'), '[{"id":"cred_1","integrationID":"mistral","label":"API key","active":true,"value":{"type":"key","key":"mk-7"}}]');
    const config = { root: dir, auth: { claudeEnvFile: '.env', codexAuthJson: path.join(dir, 'codex.json'), opencodeCredentials: path.join(dir, 'oc.json') } };
    const s = stageSecrets({ config, invocationDir: path.join(dir, 'inv') });
    assert.equal(s.env.CLAUDE_CODE_OAUTH_TOKEN, 'tok-123');
    assert.equal(s.env.CLAUDE_FORCE_OAUTH, '1');
    assert.equal(statSync(s.env.CODEX_AUTH_JSON_PATH).mode & 0o777, 0o600);
    assert.equal(statSync(s.env.OPENCODE_CREDENTIALS_PATH).mode & 0o777, 0o600);
    assert.equal(readFileSync(s.env.OPENCODE_CREDENTIALS_PATH, 'utf8'), readFileSync(path.join(dir, 'oc.json'), 'utf8'),
      'copied as is');
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

test('stageSecrets copies an opencode auth export file as is', { skip: process.platform === 'win32' && 'no POSIX file modes on Windows' }, () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'adw-e2e-'));
  try {
    const text = '[{"id":"cred_1","integrationID":"openrouter","label":"API key","active":true,"value":{"type":"key","key":"sk-or-9"}}]';
    writeFileSync(path.join(dir, 'oc.json'), text);
    const config = { root: dir, auth: { claudeEnvFile: 'none.env', codexAuthJson: path.join(dir, 'missing.json'), opencodeCredentials: path.join(dir, 'oc.json') } };
    const s = stageSecrets({ config, invocationDir: path.join(dir, 'inv') });
    assert.equal(readFileSync(s.env.OPENCODE_CREDENTIALS_PATH, 'utf8'), text);
    assert.equal(statSync(s.env.OPENCODE_CREDENTIALS_PATH).mode & 0o777, 0o600);
    assert.ok(s.values.includes('sk-or-9'));
    for (const label of ['cred_1', 'openrouter', 'API key']) assert.ok(!s.values.includes(label), label);
    s.cleanup();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('stageSecrets rejects an OpenCode 1 auth.json', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'adw-e2e-'));
  try {
    writeFileSync(path.join(dir, 'oc.json'), '{"openrouter":{"type":"api","key":"k"}}');
    const config = { root: dir, auth: { claudeEnvFile: 'none.env', codexAuthJson: path.join(dir, 'missing.json'), opencodeCredentials: path.join(dir, 'oc.json') } };
    const inv = path.join(dir, 'inv');
    assert.throws(() => stageSecrets({ config, invocationDir: inv }), /\(umask 077; opencode auth export > .*oc\.json\)/);
    assert.equal(existsSync(path.join(inv, '.secrets')), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('stageSecrets collects OpenCode OAuth access and refresh tokens, not the type label', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'adw-e2e-'));
  try {
    const shape = [{ id: 'cred_2', integrationID: 'anthropic', label: 'OAuth', active: true, value: { type: 'oauth', methodID: 'oauth', access: 'acc-token-111', refresh: 'ref-token-222', expires: 1790000000000 } }];
    writeFileSync(path.join(dir, 'oc.json'), JSON.stringify(shape));
    const config = { root: dir, auth: { claudeEnvFile: '.env', codexAuthJson: path.join(dir, 'missing.json'), opencodeCredentials: path.join(dir, 'oc.json') } };
    const s = stageSecrets({ config, invocationDir: path.join(dir, 'inv') });
    assert.ok(s.values.includes('acc-token-111'));
    assert.ok(s.values.includes('ref-token-222'));
    assert.ok(!s.values.includes('oauth') && !s.values.includes('cred_2'));
    s.cleanup();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('stageSecrets removes its staging dir when an auth file is not valid JSON', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'adw-e2e-'));
  try {
    writeFileSync(path.join(dir, 'bad.json'), '{not json');
    const config = { root: dir, auth: { claudeEnvFile: '.env', codexAuthJson: path.join(dir, 'bad.json'), opencodeCredentials: path.join(dir, 'missing.json') } };
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
    const config = { root: dir, auth: { claudeEnvFile: '.env', codexAuthJson: path.join(dir, 'm1.json'), opencodeCredentials: path.join(dir, 'm2.json') } };
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
    const config = { root: dir, auth: { claudeEnvFile: '.env', codexAuthJson: path.join(dir, 'm1.json'), opencodeCredentials: path.join(dir, 'm2.json') } };
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
    const config = { root: dir, auth: { claudeEnvFile: '.env', codexAuthJson: path.join(dir, 'cx.json'), opencodeCredentials: path.join(dir, 'm.json') } };
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

test('removeOpenCodeDbCredentials empties the credential tables of every opencode.db and keeps the sessions', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'oc-'));
  const file = path.join(dir, 'opencode-1/demo-todo__x/agent/opencode/xdg-data/opencode/opencode.db');
  mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`create table credential (id text, value text); insert into credential values ('c1', '{"key":"mk-7"}');
    create table account (id text, access_token text); insert into account values ('a1', 'at-9');
    create table session_message (id text, data text); insert into session_message values ('m1', '{}');`);
  db.close();
  const plain = path.join(dir, 'other.db');
  new DatabaseSync(plain).close();
  assert.deepEqual(removeOpenCodeDbCredentials(dir), [file]);
  assert.equal(readFileSync(file).includes('mk-7'), false, 'vacuumed: no deleted value left in the file');
  assert.equal(readFileSync(file).includes('at-9'), false);
  const after = new DatabaseSync(file);
  assert.equal(after.prepare('select count(*) n from credential').get().n, 0);
  assert.equal(after.prepare('select count(*) n from session_message').get().n, 1);
  after.close();
  rmSync(dir, { recursive: true, force: true });
});

test('removeOpenCodeDbCredentials scrubs every other opencode.db when one fails, then throws naming it', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'oc-'));
  const bad = path.join(dir, 'a/opencode.db');
  const good = path.join(dir, 'b/opencode.db');
  mkdirSync(path.dirname(bad), { recursive: true });
  mkdirSync(path.dirname(good), { recursive: true });
  writeFileSync(bad, 'not a database, but long enough to fail the sqlite header check');
  const db = new DatabaseSync(good);
  db.exec(`create table credential (id text, value text); insert into credential values ('c1', '{"key":"mk-7"}');`);
  db.close();
  assert.throws(() => removeOpenCodeDbCredentials(dir), (e) => e.message.includes(bad) && !e.message.includes(good));
  assert.equal(readFileSync(good).includes('mk-7'), false);
  rmSync(dir, { recursive: true, force: true });
});

test('secretLeaves of an `opencode auth export` file skips ids and labels', () => {
  const exported = [{ id: 'cred_1', integrationID: 'mistral', label: 'API key', active: true, value: { type: 'key', key: 'mk-7' } }];
  assert.deepEqual(secretLeaves(exported), ['mk-7']);
});

test('stageSecrets does not treat account ids or last_refresh as secrets', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'adw-e2e-'));
  try {
    writeFileSync(path.join(dir, 'codex.json'), JSON.stringify({ last_refresh: '2026-10-10T10:00:00Z', tokens: { access_token: 'cx-9', account_id: 'acct-123' } }));
    writeFileSync(path.join(dir, 'oc.json'), JSON.stringify([{ id: 'c', integrationID: 'openai', label: 'L', active: true, value: { type: 'oauth', access: 'oc-acc' } }]));
    const config = { root: dir, auth: { claudeEnvFile: 'none.env', codexAuthJson: path.join(dir, 'codex.json'), opencodeCredentials: path.join(dir, 'oc.json') } };
    const s = stageSecrets({ config, invocationDir: path.join(dir, 'inv') });
    assert.deepEqual(s.values.sort(), ['cx-9', 'oc-acc']);
    s.cleanup();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('openCodeExport rejects an empty export and names the source and the command', () => {
  assert.throws(() => openCodeExport('[]', 'oc.json'), /oc\.json has no logins.*\(umask 077; opencode auth export > oc\.json\)/);
  assert.equal(openCodeExport('[{"id":"c"}]', 'oc.json').length, 1);
});
