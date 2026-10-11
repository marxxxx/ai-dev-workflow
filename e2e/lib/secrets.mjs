import { copyFileSync, chmodSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { walk } from './fsutil.mjs';

const expand = (p, root) => (p.startsWith('~/') ? path.join(homedir(), p.slice(2)) : path.resolve(root, p));

// Every non-empty string leaf of an auth file is a secret except labels under a `type` or `auth_mode` key
// (e.g. "type":"api" or "type":"oauth"), which would otherwise be scan needles.
function secretLeaves(value, key = '') {
  if (typeof value === 'string') return key !== 'type' && key !== 'auth_mode' && value.length > 0 ? [value] : [];
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
      ['OPENCODE_AUTH_JSON_PATH', config.auth.opencodeAuthJson, 'opencode-auth.json'],
    ]) {
      const from = expand(src, config.root);
      if (!existsSync(from)) continue;
      const to = path.join(dir, name);
      copyFileSync(from, to);
      chmodSync(to, 0o600);
      env[key] = to;
      values.push(...secretLeaves(JSON.parse(readFileSync(to, 'utf8'))));
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
