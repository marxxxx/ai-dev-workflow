import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { DEFAULT_TURN_TIMEOUT_SEC, turnTimeoutSec } from './config.mjs';
import { adapterCommand } from './harness.mjs';

// Where a session runs, which home acpx keeps its state in (~/.acpx) and how long a turn may run; the same for the server
// and its workers.
export function acpxSettings(env = process.env) {
  const home = env.HOME ?? '/home/dev';
  return { home, workspace: env.ADW_MCP_WORKSPACE ?? '/workspace', storeDir: join(home, '.adw-mcp', 'sessions'), timeoutSec: turnTimeoutSec(env) };
}

// One argv word per element, in the quoting acpx's --agent parser reads back (single quotes are literal; a quote is
// written as '\''). Words made of safe characters stay as they are.
export const joinCommand = (argv) => argv
  .map((word) => (/^[A-Za-z0-9_@%+=:,./-]+$/.test(word) ? word : `'${word.replaceAll("'", "'\\''")}'`))
  .join(' ');

// Global flags go before the subcommand and are identical for every call of a session: acpx finds a named session by
// adapter command + cwd + name. No .acpxrc.json, so nothing is written into the workspace. The prompt text goes in on
// stdin (`-f -`), never as an argv word.
export function acpxArgs({ agent, cwd, timeoutSec = DEFAULT_TURN_TIMEOUT_SEC }) {
  const prefix = ['acpx', '--agent', agent, '--approve-all', '--format', 'quiet', '--ttl', '0', '--timeout', String(timeoutSec), '--cwd', cwd];
  return {
    ensure: (session) => [...prefix, 'sessions', 'ensure', '-s', session],
    prompt: (session) => [...prefix, 'prompt', '-s', session, '-f', '-'],
    cancel: (session) => [...prefix, 'cancel', '-s', session],
    close: (session) => [...prefix, 'sessions', 'close', session],
  };
}

export const acpxFor = (harness, { workspace, timeoutSec }, pathEnv) =>
  acpxArgs({ agent: joinCommand(adapterCommand(harness, pathEnv)), cwd: workspace, timeoutSec });

// Runs argv without a shell; never rejects: a failure to run is `error` (code ENOENT, ETIMEDOUT, ...). stdout and stderr are
// Buffers, so the caller decides how to decode them.
export function defaultExec(argv, { input, env, timeoutMs, cwd } = {}) {
  return new Promise((resolve) => {
    const out = [];
    const err = [];
    let error = null;
    let timer = null;
    let child;
    try {
      child = spawn(argv[0], argv.slice(1), { env: env ?? process.env, cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (spawnError) {
      resolve({ status: null, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0), error: spawnError });
      return;
    }
    child.stdout.on('data', (chunk) => out.push(chunk));
    child.stderr.on('data', (chunk) => err.push(chunk));
    child.on('error', (spawnError) => { error ??= spawnError; });
    child.stdin.on('error', () => {});
    child.on('close', (status) => {
      clearTimeout(timer);
      resolve({ status, stdout: Buffer.concat(out), stderr: Buffer.concat(err), error });
    });
    if (timeoutMs) {
      timer = setTimeout(() => {
        error ??= Object.assign(new Error(`timed out after ${Math.round(timeoutMs / 1000)} s`), { code: 'ETIMEDOUT' });
        child.kill('SIGKILL');
      }, timeoutMs);
    }
    child.stdin.end(input ?? '');
  });
}
