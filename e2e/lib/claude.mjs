// One `claude -p --output-format json` call, shared by the E2E verifier and the review judge.

// The CLI prints one JSON line; anything before it (e.g. container start-up output) is noise.
function cliJson(stdout) {
  const line = String(stdout ?? '').trim().split('\n').reverse().find((l) => l.trimStart().startsWith('{'));
  return line ? JSON.parse(line) : null;
}

// claude -p reports API errors (e.g. usage limits) on stdout, not stderr.
export function cliError(stdout) {
  try {
    const j = cliJson(stdout);
    if (j) return [j.api_error, j.result].filter(Boolean).join(': ');
  } catch { /* not JSON */ }
  return String(stdout ?? '').trim();
}

// The JSON object in the model's answer text, fenced or not.
export function resultJson(stdout) {
  const j = cliJson(stdout);
  if (!j) throw new Error('no claude -p JSON result');
  if (j.is_error) throw new Error(cliError(stdout));
  const json = String(j.result ?? '').match(/\{[\s\S]*\}/)?.[0];
  if (!json) throw new Error('answer holds no JSON object');
  return JSON.parse(json);
}

export const isQuota = (error) => /usage_limit_reached/.test(error ?? '');

// `run` has spawnSync's signature. Returns the answer's JSON object or throws a labelled error.
export function callClaude({ cmd = 'claude', args, input, cwd, env = {}, timeoutMs, label, run }) {
  const r = run(cmd, args, { input, cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: timeoutMs, env: { ...process.env, ...env } });
  if (r.error?.code === 'ETIMEDOUT') throw new Error(`${label} timed out after ${timeoutMs / 1000} s`);
  if (r.error) throw new Error(`${label}: ${r.error.message}`);
  if (r.status !== 0) {
    const detail = [cliError(r.stdout), String(r.stderr ?? '').trim()].filter(Boolean).join(' | ');
    throw new Error(`${label} exit ${r.status}: ${detail.slice(0, 500)}`);
  }
  return resultJson(r.stdout);
}
