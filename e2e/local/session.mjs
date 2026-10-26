// The agent under test: an acpx session in a one-off container of the project's own dev-container
// compose service, on the project's dev image plus the e2e layer (image.mjs), one fresh compose project
// (and so a fresh agent-home volume) per trial.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { walk } from '../lib/fsutil.mjs';
import { isCliQuota } from '../lib/llm.mjs';
import { scrubSecretsInTree, secretLeaves } from '../lib/secrets.mjs';

const HOME = '/home/dev';
const SERVICE = 'ai-dev-workflow';
const BIN = '/opt/agent-tools/node_modules/.bin';
const CLI = { 'claude-code': 'claude', codex: 'codex', opencode: 'opencode' };
const OPENCODE_MODEL_FILE = `${HOME}/.adw-e2e/opencode.json`;
const CLAUDE_SETTINGS = `${HOME}/.claude/settings.json`;

// Each harness's session logs (default locations in the container) → the layout metrics.mjs/ccusage.mjs read.
const LOGS = {
  'claude-code': { from: `${HOME}/.claude/projects`, to: 'agent/sessions/projects' },
  codex: { from: `${HOME}/.codex/sessions`, to: 'agent/sessions' },
  opencode: { from: `${HOME}/.local/share/opencode`, to: 'agent/opencode/xdg-data/opencode' },
};

// Env names a harness may log in with; only the agent's own go into its container.
const AUTH_ENV = {
  'claude-code': ['CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX'],
  codex: ['OPENAI_API_KEY'],
  opencode: [],
};

// What docker/entrypoint.sh exports when the certs overlay installs a CA bundle; docker exec skips the entrypoint,
// so the run sets them (container paths, no secrets) for every exec to inherit.
const CA_ENV = ['NODE_EXTRA_CA_CERTS=/etc/ssl/agent-extra-ca.pem', 'SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt',
  'REQUESTS_CA_BUNDLE=/etc/ssl/certs/ca-certificates.crt'];

// No config/data dir overrides: the image's entrypoint configures MCP and tools in the default homes.
// `cli` is the image's own claude/codex (resolved in the container), which the adapters run instead of their bundled ones.
// The model: claude-code-acp takes it from settings.json (writeModelConfig; ANTHROPIC_MODEL as Harbor also sets it),
// codex-acp only from CODEX_CONFIG (it ignores argv), opencode from an OPENCODE_CONFIG file, since the image's
// wrapper overwrites OPENCODE_CONFIG_CONTENT.
export function acpCommand(harness, model, { cli = null } = {}) {
  if (harness === 'claude-code') {
    return ['env', '-u', 'CLAUDECODE', ...(model ? [`ANTHROPIC_MODEL=${model}`] : []), ...(cli ? [`CLAUDE_CODE_EXECUTABLE=${cli}`] : []), 'claude-code-acp'];
  }
  if (harness === 'codex') {
    return ['env', 'NO_BROWSER=1', 'INITIAL_AGENT_MODE=agent-full-access', ...(model ? [`CODEX_CONFIG=${JSON.stringify({ model: model.split('/').at(-1) })}`] : []),
      ...(cli ? [`CODEX_PATH=${cli}`] : []), 'codex-acp'];
  }
  if (harness === 'opencode') return ['env', 'OPENCODE_FAKE_VCS=git', ...(model ? [`OPENCODE_CONFIG=${OPENCODE_MODEL_FILE}`] : []), 'opencode', 'acp'];
  throw new Error(`unknown harness: ${harness}`);
}

export const acpxConfig = ([command, ...args], timeoutSec = 1800) => ({
  agents: { target: { command, args } }, defaultAgent: 'target', defaultPermissions: 'approve-all', ttl: 0, timeout: timeoutSec, format: 'quiet',
});

const kebab = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

// Compose project names allow [a-z0-9_-]; the repo part gives way so the trial id survives the 63-char cap.
export function composeProject(root, trialId) {
  const id = kebab(String(trialId));
  const name = kebab(path.basename(path.resolve(root))).slice(0, 63 - 'adw-e2e-'.length - id.length - 1).replace(/-+$/, '');
  return `adw-e2e-${name}-${id}`;
}

// Same rules as ai-dev.sh: comments, `export `, a valid key, one pair of surrounding quotes stripped.
export function parseEnvFile(text) {
  const out = {};
  for (let line of text.split('\n')) {
    line = line.replaceAll('\r', '');
    if (line === '' || line.startsWith('#')) continue;
    if (line.startsWith('export ')) line = line.slice(7);
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq);
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    out[key] = line.slice(eq + 1).replace(/^"(.*)"$|^'(.*)'$/s, (_, a, b) => a ?? b);
  }
  return out;
}

// The compose env as ai-dev.sh builds it: .env.ai-dev never overrides a set variable, PROJECT_ROOT is the work tree.
export function composeEnv({ root, work, env = process.env, uid = process.getuid?.() ?? 1000, gid = process.getgid?.() ?? 1000 }) {
  const file = path.join(root, '.env.ai-dev');
  const fromFile = existsSync(file) ? parseEnvFile(readFileSync(file, 'utf8')) : {};
  const out = { ...fromFile, ...env, PROJECT_ROOT: work };
  out.HOST_UID = String(out.HOST_UID ?? uid);
  out.HOST_GID = String(out.HOST_GID ?? gid);
  return out;
}

// Which logins exist for each harness; copies nothing. `secrets` are the values to scrub from collected logs.
export function stageCredentials({ harnesses, env = process.env, home = homedir() }) {
  const out = { envNames: [], authFiles: [], secrets: [], missing: [] };
  const authFile = (harness, rel) => {
    const from = path.join(home, rel);
    if (!existsSync(from)) return false;
    out.authFiles.push({ harness, from, to: path.posix.join(HOME, rel) });
    out.secrets.push(...secretLeaves(JSON.parse(readFileSync(from, 'utf8'))));
    return true;
  };
  for (const harness of new Set(harnesses)) {
    if (harness === 'claude-code') {
      const provider = ['CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX'].find((n) => env[n]);
      if (env.CLAUDE_CODE_OAUTH_TOKEN) {
        out.envNames.push('CLAUDE_CODE_OAUTH_TOKEN');
        out.secrets.push(env.CLAUDE_CODE_OAUTH_TOKEN);
      } else if (provider) out.envNames.push(provider);
      else out.missing.push({ harness, what: 'CLAUDE_CODE_OAUTH_TOKEN, CLAUDE_CODE_USE_BEDROCK or CLAUDE_CODE_USE_VERTEX' });
    } else if (harness === 'codex') {
      if (authFile(harness, '.codex/auth.json')) continue;
      if (env.OPENAI_API_KEY) {
        out.envNames.push('OPENAI_API_KEY');
        out.secrets.push(env.OPENAI_API_KEY);
      } else out.missing.push({ harness, what: '~/.codex/auth.json or OPENAI_API_KEY' });
    } else if (harness === 'opencode') {
      // Optional: opencode providers may be configured by env alone.
      authFile(harness, '.local/share/opencode/auth.json');
    } else throw new Error(`unknown harness: ${harness}`);
  }
  return out;
}

// The entrypoint has handed over to the container command once `sleep infinity` runs.
const READY = 'for f in /proc/[0-9]*/cmdline; do [ "$(tr \'\\0\' \' \' < "$f" 2>/dev/null)" = "sleep infinity " ] && exit 0; done; exit 1';
const pause = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const defaultExec = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opts });

// 1 when a socket listens on `port` in /proc/net/tcp(6) text (state 0A), else 0.
export function listening(procNetTcp, port) {
  const hex = port.toString(16).toUpperCase().padStart(4, '0');
  return procNetTcp.split('\n').some((l) => { const f = l.trim().split(/\s+/); return f[3] === '0A' && f[1]?.endsWith(`:${hex}`); }) ? 1 : 0;
}

// `exec` has spawnSync's signature. Starts the container, stages the agent's auth and opens the acpx session.
// `origin` (the sandbox's bare remote) is mounted at its host path: the clone's remote URL then works in the container too.
export function startSession({ root, work, origin = null, harness, model, project, creds, envNames = [], exec = defaultExec, env = process.env,
  turnTimeoutSec = 1800, readyTimeoutSec = 300, overrideFile = null }) {
  const name = `${project}-agent`;
  const cenv = composeEnv({ root, work, env });
  const compose = ['compose', '-f', path.join(root, 'compose.ai-dev.yml'),
    ...(cenv.AGENT_CA_DIR ? ['-f', path.join(root, 'compose.ai-dev.certs.yml')] : []),
    ...(overrideFile ? ['-f', overrideFile] : []), '-p', project];
  const label = `agent (${harness})`;
  const run = (args, opts = {}) => {
    const r = exec('docker', args, opts);
    if (r.error) throw r.error;
    if (r.status !== 0) throw new Error(`docker ${args.slice(0, 2).join(' ')} failed (exit ${r.status}): ${String(r.stderr ?? '').trim().slice(-500)}`);
    return String(r.stdout ?? '');
  };
  const inAgent = (argv, { cwd = false, ...opts } = {}) => run(['exec', '-u', 'dev', ...(cwd ? ['-w', '/workspace'] : []), name, ...argv], opts);
  // Content by stdin (never argv) into a file in the container, owned by dev, mode 600.
  const writeIn = (to, input) => run(['exec', '-i', '-u', 'dev', name, 'sh', '-c', 'umask 077 && mkdir -p "$(dirname "$1")" && cat > "$1"', 'sh', to], { input });
  const teardown = () => {
    exec('docker', ['rm', '-f', name]);
    exec('docker', [...compose, 'down', '-v'], { env: cenv });
  };

  // Logins go in by name, so their values never reach argv.
  const names = [...creds.envNames.filter((n) => AUTH_ENV[harness].includes(n)), ...envNames];
  try {
    run([...compose, 'run', '-d', '--name', name, ...[...names, ...(cenv.AGENT_CA_DIR ? CA_ENV : [])].flatMap((n) => ['-e', n]),
      ...(origin ? ['-v', `${origin}:${origin}`] : []), SERVICE, 'sleep', 'infinity'], { env: cenv });
    for (let t = 0; ; t++) {
      const r = exec('docker', ['exec', '-u', 'dev', name, 'sh', '-c', READY]);
      if (r.status === 0) break;
      // A failed entrypoint stops the container: no point in waiting.
      if (/is not running|No such container/.test(r.stderr ?? '') || t >= readyTimeoutSec) {
        const l = exec('docker', ['logs', '--tail', '20', name]);
        const logs = `${l.stdout ?? ''}${l.stderr ?? ''}`.trim();
        throw new Error(`${name} not ready: ${String(r.stderr ?? '').trim() || `${readyTimeoutSec} s`}${logs ? ` | ${logs}` : ''}`);
      }
      pause(1000);
    }
    // Auth files by stdin into the default homes, owned by dev, mode 600.
    for (const f of creds.authFiles.filter((a) => a.harness === harness)) writeIn(f.to, readFileSync(f.from));
    if (model && harness === 'claude-code') {
      // Merged after startup, so whatever the image or the project put there stays.
      const current = inAgent(['sh', '-c', 'cat "$1" 2>/dev/null || true', 'sh', CLAUDE_SETTINGS]).trim();
      writeIn(CLAUDE_SETTINGS, `${JSON.stringify({ ...(current ? JSON.parse(current) : {}), model }, null, 2)}\n`);
    }
    if (model && harness === 'opencode') writeIn(OPENCODE_MODEL_FILE, `${JSON.stringify({ model })}\n`);
    const cli = harness === 'opencode' ? null : inAgent(['sh', '-c', `command -v ${CLI[harness]}`]).trim();
    writeFileSync(path.join(work, '.acpxrc.json'), `${JSON.stringify(acpxConfig(acpCommand(harness, model, { cli }), turnTimeoutSec), null, 2)}\n`);
    inAgent(['acpx', 'sessions', 'ensure'], { cwd: true });
  } catch (e) {
    teardown();
    throw e;
  }

  return {
    // The agent's final message of the turn; acpx's own timeout fires first, ours is the backstop.
    prompt(text) {
      const r = exec('docker', ['exec', '-i', '-u', 'dev', '-w', '/workspace', name, 'acpx', 'prompt', text],
        { input: '', timeout: (turnTimeoutSec + 60) * 1000 });
      if (r.error?.code === 'ETIMEDOUT') return Promise.reject(new Error(`${label}: timed out after ${turnTimeoutSec} s`));
      if (r.error) return Promise.reject(new Error(`${label}: ${r.error.message}`));
      if (r.status !== 0) {
        const detail = [r.stdout, r.stderr].map((s) => String(s ?? '').trim()).filter(Boolean).join(' | ');
        return Promise.reject(new Error(`${label}:${isCliQuota(harness, detail) ? ' quota:' : ''} exit ${r.status}: ${detail.slice(-500)}`));
      }
      return Promise.resolve(String(r.stdout).trim());
    },
    // Copies the harness's logs into <trialDir>/agent, drops auth copies, scrubs secrets; always tears down.
    close(trialDir) {
      const { from, to } = LOGS[harness];
      const agentDir = path.join(trialDir, 'agent');
      let scrubbed = null;
      try {
        exec('docker', ['exec', '-u', 'dev', '-w', '/workspace', name, 'acpx', 'sessions', 'close']);
        if (exec('docker', ['exec', '-u', 'dev', name, 'test', '-d', from]).status === 0) {
          mkdirSync(path.join(trialDir, to), { recursive: true });
          run(['cp', `${name}:${from}/.`, path.join(trialDir, to)]);
        }
      } finally {
        // Also after a failed copy: a partial one may already hold auth copies or secrets.
        try {
          if (existsSync(agentDir)) {
            for (const f of walk(agentDir).filter((f) => path.basename(f) === 'auth.json')) rmSync(f, { force: true });
            scrubbed = scrubSecretsInTree(agentDir, creds.secrets);
          }
        } finally {
          teardown();
        }
      }
      return scrubbed;
    },
    appListening: (port) => listening(inAgent(['sh', '-c', 'cat /proc/net/tcp /proc/net/tcp6 2>/dev/null; true']), port),
    cliVersion: (h) => inAgent([`${BIN}/${CLI[h]}`, '--version']).trim(),
  };
}
