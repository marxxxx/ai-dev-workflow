import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { acpxFor, acpxSettings, defaultExec } from './acpx.mjs';
import { prepareHarness } from './harness.mjs';
import { applyTurnResult } from './sessions.mjs';
import { createStore } from './store.mjs';

const TAIL = 500;
// What each harness's CLI says when its plan's usage limit is hit (a copy of the patterns of isCliQuota in e2e/lib/llm.mjs).
const QUOTA = {
  'claude-code': /usage_limit_reached|hit your (?:\w+ )?limit/i,
  codex: /usage_limit|usageLimitExceeded|hit your usage limit|\b429\b|rate.?limit|quota/i,
  opencode: /usage_limit|\b429\b|rate.?limit|quota/i,
};
const PROMPT_BACKSTOP_MS = 60 * 1000;
const SETUP_TIMEOUT_MS = 120 * 1000;
const STEP_TIMEOUT_MS = 60 * 1000;

const decode = (value) => (Buffer.isBuffer(value) ? value.toString('utf8') : String(value ?? ''));
const tail = (text) => [...text.trim()].slice(-TAIL).join('');

function failure(harness, run, what) {
  if (run.error) {
    const timedOut = run.error.code === 'ETIMEDOUT';
    return { ok: false, error: `${what}: ${timedOut ? 'timed out' : run.error.code ?? run.error.message}: ${run.error.message}` };
  }
  // Only stderr: acpx reports its errors there, and the stdout of a failed turn is partial text that must not be used.
  const detail = tail(decode(run.stderr));
  const quota = QUOTA[harness]?.test(detail) ? 'quota: ' : '';
  return { ok: false, error: `${quota}${what} exit ${run.status}${detail ? `: ${detail}` : ''}` };
}

// Runs one turn of `record` and stores its result. Turn 1 also prepares the harness and ensures the acpx session.
// acpx exits 0 for a cancelled turn too (partial text); a cancel only comes from terminate, which marks the session
// terminated, and applyTurnResult ignores a result for a session that is not running.
// A failed turn closes its acpx session before the failure frees the workspace: with --ttl 0 the queue owner and the
// adapter stay alive until `sessions close`, and on a timeout the agent may still be working. Best effort, like terminate.
export async function runTurn({ record, text, store, now, exec = defaultExec, settings = acpxSettings(), prepare = prepareHarness, pathEnv }) {
  const { harness, id } = record;
  const args = acpxFor(harness, settings, pathEnv);
  const env = { ...process.env, HOME: settings.home };
  let result;
  let started = false;
  try {
    if (record.turn === 1) {
      prepare(harness, { home: settings.home });
      started = true;
      const ensure = await exec(args.ensure(id), { env, timeoutMs: SETUP_TIMEOUT_MS });
      if (ensure.error || ensure.status !== 0) result = failure(harness, ensure, 'acpx sessions ensure');
    }
    if (!result) {
      started = true;
      const run = await exec(args.prompt(id), { env, input: text, timeoutMs: settings.timeoutSec * 1000 + PROMPT_BACKSTOP_MS });
      result = run.error || run.status !== 0 ? failure(harness, run, 'acpx prompt') : { ok: true, message: decode(run.stdout).trim() };
    }
  } catch (error) {
    result = { ok: false, error: `turn could not run: ${error.message}` };
  }
  if (!result.ok && started) {
    for (const step of [args.cancel, args.close]) {
      try { await exec(step(id), { env, timeoutMs: STEP_TIMEOUT_MS }); } catch { /* best effort */ }
    }
  }
  applyTurnResult(store, id, result, now);
}

async function main(argv) {
  const [id, turn] = argv;
  const settings = acpxSettings();
  const store = createStore(settings.storeDir);
  const now = () => new Date().toISOString();
  try {
    const record = store.get(id);
    if (!record) throw new Error(`unknown session ${id}`);
    const text = readFileSync(join(store.dirOf(id), `turn-${Number(turn)}.txt`), 'utf8');
    await runTurn({ record: { ...record, turn: Number(turn) }, text, store, now, settings });
  } catch (error) {
    // Nobody reads this process's stderr (stdio is ignored); the session record is where the failure shows.
    try { applyTurnResult(store, id, { ok: false, error: `worker error: ${error.message}` }, now); } catch { /* reconcile finds it */ }
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main(process.argv.slice(2));
