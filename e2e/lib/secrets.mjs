import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { walk } from './fsutil.mjs';

const expand = (p, root) => (p.startsWith('~/') ? path.join(homedir(), p.slice(2)) : path.resolve(root, p));

// Every non-empty string leaf of an auth file is a secret except labels under a `type` or `auth_mode` key
// (e.g. "type":"api" or "type":"oauth"), account identifiers and refresh timestamps; those are not
// credentials and show up legitimately in session logs, so they would be false scan hits. The same goes
// for the ids and labels of an `opencode auth export` file.
const NON_SECRET_KEYS = new Set(['type', 'auth_mode', 'account_id', 'accountId', 'last_refresh',
  'id', 'integrationID', 'label', 'methodID']);
export function secretLeaves(value, key = '') {
  if (typeof value === 'string') return !NON_SECRET_KEYS.has(key) && value.length > 0 ? [value] : [];
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([k, v]) => secretLeaves(v, k));
  }
  return [];
}

export function stageSecrets({ config, invocationDir }) {
  const dir = path.join(invocationDir, '.secrets');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const cleanup = () => rmSync(dir, { recursive: true, force: true });
  try {
    const env = { CLAUDE_FORCE_OAUTH: '1' };
    const values = [];
    const envFile = expand(config.auth.claudeEnvFile, config.root);
    const fromFile = existsSync(envFile)
      ? readFileSync(envFile, 'utf8').match(/^(?:export\s+)?CLAUDE_CODE_OAUTH_TOKEN=(.+)$/m)?.[1].trim().replace(/^(["'])(.*)\1$/, '$2')
      : undefined;
    const token = fromFile || process.env.CLAUDE_CODE_OAUTH_TOKEN;
    if (token) { env.CLAUDE_CODE_OAUTH_TOKEN = token; values.push(token); }
    for (const [key, src, name] of [
      ['CODEX_AUTH_JSON_PATH', config.auth.codexAuthJson, 'codex-auth.json'],
      ['OPENCODE_CREDENTIALS_PATH', config.auth.opencodeCredentials, 'opencode-credentials.json'],
    ]) {
      const from = expand(src, config.root);
      if (!existsSync(from)) continue;
      const to = path.join(dir, name);
      const text = readFileSync(from, 'utf8');
      const auth = key === 'OPENCODE_CREDENTIALS_PATH' ? openCodeExport(text, from) : JSON.parse(text);
      writeFileSync(to, text, { mode: 0o600 });
      chmodSync(to, 0o600);
      env[key] = to;
      values.push(...secretLeaves(auth));
    }
    return { env, values, cleanup };
  } catch (e) {
    cleanup();
    throw e;
  }
}

export function scanForSecrets(dir, values) {
  const needles = values.filter((v) => v.length > 0);
  return walk(dir).filter((f) => {
    const text = readFileSync(f, 'utf8');
    return needles.some((n) => text.includes(n));
  });
}

export function redactSecrets(text, values) {
  // Longest first so a value that contains another is redacted whole.
  return [...new Set(values.filter((v) => v.length > 0))].sort((a, b) => b.length - a.length)
    .reduce((t, v) => t.replaceAll(v, '***'), text);
}

const DB_FILE = /\.db(-wal|-shm|-journal)?$/;
const isBinary = (buf) => buf.subarray(0, 8192).includes(0);

// Redacts secret values in text files under dir. Binary and SQLite files are never rewritten
// (a utf8 round-trip would corrupt them); those that contain a secret are reported instead.
export function scrubSecretsInTree(dir, values, { skip } = {}) {
  const needles = values.filter((v) => v.length > 0).map((v) => Buffer.from(v));
  const redacted = [];
  const skippedWithSecret = [];
  for (const f of walk(dir)) {
    if (skip?.(f)) continue;
    const buf = readFileSync(f);
    if (!needles.some((n) => buf.includes(n))) continue;
    if (DB_FILE.test(f) || isBinary(buf)) { skippedWithSecret.push(f); continue; }
    writeFileSync(f, redactSecrets(buf.toString('utf8'), values));
    redacted.push(f);
  }
  return { redacted, skippedWithSecret };
}

// OpenCode 2 keeps credentials in its database (the credential table and the console login in account
// tables). scrubSecretsInTree never rewrites a .db, so the copies of opencode.db lose those rows instead;
// VACUUM drops the deleted pages, so no value is left in the file. One unreadable database does not stop the others;
// the error afterwards names every file that kept its rows.
const CREDENTIAL_TABLES = ['credential', 'account', 'control_account'];
export function removeOpenCodeDbCredentials(dir) {
  const found = walk(dir).filter((f) => path.basename(f) === 'opencode.db');
  const failed = [];
  for (const f of found) {
    try {
      const db = new DatabaseSync(f);
      try {
        const tables = new Set(db.prepare("select name from sqlite_master where type = 'table'").all().map((t) => t.name));
        for (const t of CREDENTIAL_TABLES.filter((t) => tables.has(t))) db.exec(`delete from ${t}`);
        db.exec('vacuum');
      } finally {
        db.close();
      }
    } catch (e) {
      failed.push(`${f}: ${e.message}`);
    }
  }
  if (failed.length) throw new Error(failed.join('; '));
  return found;
}

// OPENCODE_CREDENTIALS is where adw e2e stages an `opencode auth export` file in a container; a fresh data dir
// gets its logins with `opencode auth import`.
export const OPENCODE_CREDENTIALS = '/home/dev/.adw-e2e/opencode-credentials.json';
export function openCodeExport(text, source) {
  let entries;
  try { entries = JSON.parse(text); } catch { /* reported below */ }
  if (!Array.isArray(entries)) throw new Error(`${source} is not an \`opencode auth export\` file (a JSON array); create it with: (umask 077; opencode auth export > ${source})`);
  if (!entries.length) throw new Error(`${source} has no logins (an empty \`opencode auth export\`); create it after logging in with: (umask 077; opencode auth export > ${source})`);
  return entries;
}
