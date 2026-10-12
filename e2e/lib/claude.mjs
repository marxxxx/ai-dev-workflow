// One `claude -p --output-format json` call in a fresh task container, shared by the E2E verifier and the review judge.

// Named only: docker copies their values from its own environment, so they never reach argv.
const AUTH_ENV = ['CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_FORCE_OAUTH'];

// E2E_VERIFY=1 skips the task image's Gitea seed hook (environment/seed/seed.sh). AGENT_TOOLSTACK_ONLY=1
// configures only the tool stack: a calibration checkout has no ai-project.json, and a judge needs no ticketing.
// `mounts` are extra `-v` specs after the checkout; `claudeArgs` follow the common claude flags.
export function buildClaudeDockerArgs({ image, name, checkout, model, uid, gid, mounts = [], claudeArgs }) {
  return ['run', '--rm', '-i', '--name', name,
    '-e', `HOST_UID=${uid}`, '-e', `HOST_GID=${gid}`, '-e', 'E2E_VERIFY=1', '-e', 'AGENT_TOOLSTACK_ONLY=1', ...AUTH_ENV.flatMap((k) => ['-e', k]),
    '-v', `${checkout}:/workspace`, ...mounts.flatMap((m) => ['-v', m]), image,
    'claude', '-p', '--model', model, '--output-format', 'json', '--setting-sources', 'user', '--strict-mcp-config', ...claudeArgs];
}

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

const parseObject = (text) => {
  try { const v = JSON.parse(text); return v && typeof v === 'object' && !Array.isArray(v) ? v : null; } catch { return null; }
};

// The JSON object in the model's answer text: the last fenced block that parses, else the whole text,
// else the span from the first { to the last }. Braces in the prose before a fenced answer do not matter.
export function resultJson(stdout) {
  const j = cliJson(stdout);
  if (!j) throw new Error('no claude -p JSON result');
  if (j.is_error) throw new Error(cliError(stdout));
  const text = String(j.result ?? '');
  // Fences are paired by their info string, so a block in another language (```bash) cannot shift the pairing.
  const fenced = [...text.matchAll(/```([^\n`]*)\n([\s\S]*?)```/g)]
    .filter((m) => ['', 'json'].includes(m[1].trim().toLowerCase())).map((m) => parseObject(m[2])).filter(Boolean);
  const answer = fenced.at(-1) ?? parseObject(text.trim()) ?? parseObject(text.match(/\{[\s\S]*\}/)?.[0]);
  if (!answer) {
    // The tail says what the model answered instead, so a calibration.json / run.json failure can be diagnosed.
    const tail = text.replace(/\s+/g, ' ').trim().slice(-500);
    throw new Error(`answer holds no JSON object; ${tail ? `answer ends: "${tail}"` : 'answer was empty'}`);
  }
  return answer;
}

export const isQuota = (error) => /usage_limit_reached/.test(error ?? '');

// Ctrl-C / SIGTERM ended the child: not a verdict, so it must abort the whole command, never be recorded.
export class InterruptError extends Error {
  interrupted = true;
  constructor(signal) { super(`interrupted (${signal})`); this.signal = signal; }
}
export const isInterrupt = (err) => err?.interrupted === true;
// spawnSync reports the signal; a docker client proxies it and exits with 128+n.
const INTERRUPT_STATUS = { 130: 'SIGINT', 143: 'SIGTERM' };

// `run` has spawnSync's signature. Returns the answer's JSON object or throws a labelled error.
export function callClaude({ cmd = 'claude', args, input, cwd, env = {}, timeoutMs, label, run }) {
  const r = run(cmd, args, { input, cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: timeoutMs, env: { ...process.env, ...env } });
  if (r.error?.code === 'ETIMEDOUT') throw new Error(`${label} timed out after ${timeoutMs / 1000} s`);
  if (r.error) throw new Error(`${label}: ${r.error.message}`);
  const signal = ['SIGINT', 'SIGTERM'].includes(r.signal) ? r.signal : INTERRUPT_STATUS[r.status];
  if (signal) throw new InterruptError(signal);
  if (r.status !== 0) {
    const detail = [cliError(r.stdout), String(r.stderr ?? '').trim()].filter(Boolean).join(' | ');
    throw new Error(`${label} exit ${r.status}: ${detail.slice(0, 500)}`);
  }
  return resultJson(r.stdout);
}
