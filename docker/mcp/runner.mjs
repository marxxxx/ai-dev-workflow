import { spawn } from 'node:child_process';
import { chmodSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { acpxFor, acpxSettings, defaultExec } from './acpx.mjs';
import { createStore } from './store.mjs';

const WORKER = fileURLToPath(new URL('./worker.mjs', import.meta.url));
const STEP_TIMEOUT_MS = 60 * 1000;

// Writes the turn's text next to the session record (the worker reads it from there, so it never rides argv) and starts
// a detached worker that outlives the server. Returns the worker's pid.
export function startTurn(record, text) {
  const store = createStore(acpxSettings().storeDir);
  const file = join(store.dirOf(record.id), `turn-${record.turn}.txt`);
  writeFileSync(file, text, { mode: 0o600 });
  chmodSync(file, 0o600);
  const child = spawn(process.execPath, [WORKER, record.id, String(record.turn)], { detached: true, stdio: 'ignore', env: process.env });
  child.on('error', () => {});
  child.unref();
  if (child.pid === undefined) throw new Error('could not start the worker process');
  return child.pid;
}

// The worker is started detached, so it leads its own process group: killing the group also ends its acpx prompt and
// whatever that runs. A pid that is not a group leader is killed alone. A process that is gone already is fine.
function killWorker(pid) {
  try {
    process.kill(-pid);
    return;
  } catch { /* not a group leader, or gone */ }
  try {
    process.kill(pid);
  } catch (error) {
    if (error.code !== 'ESRCH') throw error;
  }
}

// Cancels the running turn, closes the acpx session (its owner and adapter exit) and stops the worker. Best effort: a
// failing acpx call (an unknown name is exit 1) must not keep terminate from freeing the workspace.
export async function cancelTurn(record) {
  const settings = acpxSettings();
  const args = acpxFor(record.harness, settings);
  const env = { ...process.env, HOME: settings.home };
  try {
    await defaultExec(args.cancel(record.id), { env, timeoutMs: STEP_TIMEOUT_MS });
    await defaultExec(args.close(record.id), { env, timeoutMs: STEP_TIMEOUT_MS });
  } finally {
    if (record.pid != null) killWorker(record.pid);
  }
}

export function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}
