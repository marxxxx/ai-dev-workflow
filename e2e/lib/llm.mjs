// One non-interactive LLM call in a fresh container, on any harness: the E2E judges and the simulated user share it.
// The prompt goes on stdin; the answer is the JSON object in the model's final text.

export const HARNESSES = ['claude-code', 'codex', 'opencode'];
export const TOOL_PROFILES = ['none', 'read', 'verify'];

export const REVIEW_ALLOWED_TOOLS = 'Read,Grep,Glob';
export const REVIEW_DENIED_TOOLS = 'Bash,Edit,Write,NotebookEdit,Task,WebFetch,WebSearch';
export const VERIFIER_ALLOWED_TOOLS = 'Bash,Read,Grep,Glob,mcp__playwright';
export const VERIFIER_DENIED_TOOLS = 'Edit,Write,NotebookEdit,Task,WebFetch,WebSearch';
const PLAYWRIGHT = ['playwright-mcp', '--headless', '--browser', 'chromium', '--isolated'];

// stream-json prints the whole session (tool calls and their results) as JSON lines; its last line is the result object.
// --setting-sources user: settings the coding agent committed to the project never load.
function claudeCommand({ model, tools, playwright, addDirs }) {
  const browser = playwright ? ['--mcp-config', JSON.stringify({ mcpServers: { playwright: { command: PLAYWRIGHT[0], args: PLAYWRIGHT.slice(1) } } })] : [];
  const profile = {
    none: ['--tools', ''],
    read: ['--allowedTools', REVIEW_ALLOWED_TOOLS, '--disallowedTools', REVIEW_DENIED_TOOLS],
    verify: ['--allowedTools', playwright ? VERIFIER_ALLOWED_TOOLS : 'Bash,Read,Grep,Glob', '--disallowedTools', VERIFIER_DENIED_TOOLS],
  }[tools];
  return { argv: ['claude', '-p', ...(model ? ['--model', model] : []), '--output-format', 'stream-json', '--verbose', '--setting-sources', 'user',
    '--strict-mcp-config', ...addDirs.flatMap((d) => ['--add-dir', d]), ...browser, ...profile], env: {} };
}

// The sandbox reads everywhere; verify needs a shell that may start the app, and the container is the boundary.
function codexCommand({ model, tools, playwright }) {
  const browser = playwright ? ['-c', `mcp_servers.playwright.command="${PLAYWRIGHT[0]}"`, '-c', `mcp_servers.playwright.args=${JSON.stringify(PLAYWRIGHT.slice(1))}`] : [];
  return { argv: ['codex', 'exec', '--json', '--skip-git-repo-check', '--ephemeral', '-o', '/tmp/adw-last.txt', ...(model ? ['-m', model] : []),
    '-s', tools === 'verify' ? 'danger-full-access' : 'read-only', ...browser, '-'], env: {} };
}

// opencode run auto-rejects every permission it would ask for, reads outside the workspace included: addDirs are allowed explicitly.
// OPENCODE_DISABLE_PROJECT_CONFIG: like claude's --setting-sources user, the checkout's opencode.json and .opencode/ (written by
// the agent) never steer the call; opencode also stops writing .opencode/.gitignore, which fails in a read-only /workspace.
function opencodeCommand({ model, tools, playwright, addDirs }) {
  const permission = { edit: 'deny', bash: tools === 'verify' ? 'allow' : 'deny', webfetch: 'deny',
    ...(addDirs.length ? { external_directory: Object.fromEntries(addDirs.map((d) => [`${d}/*`, 'allow'])) } : {}) };
  const mcp = playwright ? { playwright: { type: 'local', command: PLAYWRIGHT } } : {};
  return { argv: ['opencode', 'run', '--format', 'json', ...(model ? ['-m', model] : [])],
    env: { OPENCODE_CONFIG_CONTENT: JSON.stringify({ permission, mcp }), OPENCODE_DISABLE_PROJECT_CONFIG: '1' } };
}

const COMMANDS = { 'claude-code': claudeCommand, codex: codexCommand, opencode: opencodeCommand };

// The command inside the container; `addDirs` are extra read-only paths outside /workspace (the review's /diff).
export function oneShotCommand({ harness, model = null, tools, playwright = false, addDirs = [] }) {
  if (!COMMANDS[harness]) throw new Error(`unknown harness ${harness}`);
  if (!TOOL_PROFILES.includes(tools)) throw new Error(`unknown tool profile ${tools}`);
  return COMMANDS[harness]({ model, tools, playwright, addDirs });
}

// The JSON lines of a CLI's output; container start-up output and banners in between are skipped.
const events = (stdout) => String(stdout ?? '').split('\n').flatMap((l) => {
  if (!l.trimStart().startsWith('{')) return [];
  try { return [JSON.parse(l)]; } catch { return []; }
});

// The claude result is the CLI's last JSON line; anything before it (the transcript, container start-up output) is no answer.
export function cliJson(stdout) {
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

function parseClaude(stdout) {
  let j;
  try { j = cliJson(stdout); } catch { return { text: null, error: null }; }
  if (!j) return { text: null, error: null };
  if (j.is_error) return { text: null, error: cliError(stdout) };
  return { text: String(j.result ?? ''), error: null };
}

// codex exec --json: the last agent message is the answer. An `error` event alone may be a retried stream; a failed turn is final.
function parseCodex(stdout) {
  let text = null; let failed = null; let lastError = null;
  for (const e of events(stdout)) {
    if (e.type === 'item.completed' && e.item?.type === 'agent_message') text = String(e.item.text ?? '');
    else if (e.type === 'turn.failed') failed = String(e.error?.message ?? 'turn failed');
    else if (e.type === 'error') lastError = String(e.message ?? 'error');
  }
  return { text: failed ? null : text, error: failed ?? (text === null ? lastError : null) };
}

// opencode run --format json: text parts carry their message id; the answer is the last assistant message's text.
// An error followed by assistant text was retried and recovered (like codex's stream errors); only a trailing one counts.
function parseOpencode(stdout) {
  const texts = new Map(); let errors = [];
  for (const e of events(stdout)) {
    if (e.type === 'text' && e.part) {
      texts.set(e.part.messageID, [...(texts.get(e.part.messageID) ?? []), String(e.part.text ?? '')]);
      errors = [];
    } else if (e.type === 'error') {
      const { name, data } = e.error ?? {};
      const message = [name, data?.message].filter(Boolean).join(': ') || 'error';
      errors.push(data?.statusCode ? `${message} (HTTP ${data.statusCode})` : message);
    }
  }
  if (errors.length) return { text: null, error: errors.join('; ') };
  const last = [...texts.values()].at(-1);
  return { text: last ? last.join('\n') : null, error: null };
}

const PARSERS = { 'claude-code': parseClaude, codex: parseCodex, opencode: parseOpencode };

// The model's final answer text, or the CLI's own error; both null when the output holds neither.
export const parseOneShot = (harness, stdout) => PARSERS[harness](stdout);

const parseObject = (text) => {
  try { const v = JSON.parse(text); return v && typeof v === 'object' && !Array.isArray(v) ? v : null; } catch { return null; }
};

// The JSON object in the model's answer text: the last fenced block that parses, else the whole text,
// else the span from the first { to the last }. Braces in the prose before a fenced answer do not matter.
export function answerJson(text) {
  text = String(text ?? '');
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

// How each CLI words a usage limit in its own error (parseOneShot's `error`), never in answer text or the raw stream:
// claude's stream carries a rate_limit_event in every normal run. claude: usage_limit_reached, or through ACP only
// "You've hit your session/weekly/usage limit"; codex: usageLimitExceeded / "You've hit your usage limit"; opencode and
// plain HTTP: 429, rate limit, quota.
const CLI_QUOTA = {
  'claude-code': /usage_limit_reached|hit your (?:\w+ )?limit/i,
  codex: /usage_limit|usageLimitExceeded|hit your usage limit|\b429\b|rate.?limit|quota/i,
  opencode: /usage_limit|\b429\b|rate.?limit|quota/i,
};
export const isCliQuota = (harness, error) => CLI_QUOTA[harness].test(error ?? '');

// A labelled callLlm error (or any judge error) that is a usage limit: callLlm marks it `<role> (<harness>): quota: …`
// after classifying the CLI's own error; claude's usage_limit_reached is recognised anywhere, as it always was.
export const isQuotaError = (error) => /usage_limit_reached|^[\w-]+ \([\w-]+\): quota: /.test(error ?? '');

// Ctrl-C / SIGTERM ended the child: not a verdict, so it must abort the whole command, never be recorded.
export class InterruptError extends Error {
  interrupted = true;
  constructor(signal) { super(`interrupted (${signal})`); this.signal = signal; }
}
export const isInterrupt = (err) => err?.interrupted === true;
// spawnSync reports the signal; a docker client proxies it and exits with 128+n.
const INTERRUPT_STATUS = { 130: 'SIGINT', 143: 'SIGTERM' };

// Named only: docker copies their values from its own environment, so they never reach argv.
const AUTH_ENV = ['CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_FORCE_OAUTH'];

// E2E_VERIFY=1 skips the task image's Gitea seed hook (environment/seed/seed.sh). AGENT_TOOLSTACK_ONLY=1
// configures only the tool stack: a calibration checkout has no ai-project.json, and a judge needs no ticketing.
// `env` is the command's own non-secret settings (OPENCODE_CONFIG_CONTENT); `authMounts` are `host:container` login files.
// `readOnly` mounts the checkout read-only (the review judge).
function containerFlags({ uid, gid, envNames, authMounts, name, checkout, readOnly, mounts, env }) {
  return ['--name', name, '-e', `HOST_UID=${uid}`, '-e', `HOST_GID=${gid}`, '-e', 'E2E_VERIFY=1', '-e', 'AGENT_TOOLSTACK_ONLY=1',
    ...[...AUTH_ENV, ...envNames].flatMap((k) => ['-e', k]), ...Object.entries(env).flatMap(([k, v]) => ['-e', `${k}=${v}`]),
    '-v', `${checkout}:/workspace${readOnly ? ':ro' : ''}`, ...mounts.flatMap((m) => ['-v', m]), ...authMounts.flatMap((m) => ['-v', `${m}:ro`])];
}

// `docker run` of a prebuilt image (the Harbor task images).
export const dockerRunArgs = ({ image, uid, gid, envNames = [], authMounts = [] }) => ({ name, checkout, readOnly = false, mounts = [], argv, env = {} }) =>
  ['run', '--rm', '-i', ...containerFlags({ uid, gid, envNames, authMounts, name, checkout, readOnly, mounts, env }), image, ...argv];

// `docker compose run` of the project's own dev-container service; -T keeps stdin a pipe for the prompt.
// `overrideFile` (adw e2e's compose.adw-e2e.yml) goes last.
export const composeRunArgs = ({ composeFile, certsFile = null, overrideFile = null, project, service = 'ai-dev-workflow', uid, gid, envNames = [],
  authMounts = [] }) => ({ name, checkout, readOnly = false, mounts = [], argv, env = {} }) => ['compose', '-f', composeFile,
  ...(certsFile ? ['-f', certsFile] : []), ...(overrideFile ? ['-f', overrideFile] : []), '-p', project,
    'run', '--rm', '-T', ...containerFlags({ uid, gid, envNames, authMounts, name, checkout, readOnly, mounts, env }), service, ...argv];

// `run` has spawnSync's signature, `buildArgs` makes the docker argv for the container command. Returns the answer's JSON
// object or throws an error labelled `<role> (<harness>)`. `onStdout` gets the raw output before it is judged,
// so a failed or unparsable call keeps its transcript.
export function callLlm({ role, harness = 'claude-code', model = null, tools, playwright = false, addDirs = [], input, buildArgs,
  name, checkout, readOnly = false, mounts = [], env = {}, timeoutMs, run, onStdout = () => {} }) {
  const label = `${role} (${harness})`;
  const cmd = oneShotCommand({ harness, model, tools, playwright, addDirs });
  const args = buildArgs({ name, checkout, readOnly, mounts, argv: cmd.argv, env: cmd.env });
  const r = run('docker', args, { input, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: timeoutMs, env: { ...process.env, ...env } });
  if (r.stdout) onStdout(r.stdout);
  if (r.error?.code === 'ETIMEDOUT') throw new Error(`${label}: timed out after ${timeoutMs / 1000} s`);
  if (r.error) throw new Error(`${label}: ${r.error.message}`);
  const signal = ['SIGINT', 'SIGTERM'].includes(r.signal) ? r.signal : INTERRUPT_STATUS[r.status];
  if (signal) throw new InterruptError(signal);
  const { text, error } = parseOneShot(harness, r.stdout);
  // Only the CLI's own error is classified; the raw output a failed call falls back to is not.
  const head = isCliQuota(harness, error) ? `${label}: quota:` : `${label}:`;
  if (r.status !== 0) {
    const own = harness === 'claude-code' ? cliError(r.stdout) : error ?? String(r.stdout ?? '').trim();
    // The CLI's own error leads; stderr's end, since docker's error follows compose's progress lines.
    const detail = [String(own).slice(0, 500), String(r.stderr ?? '').trim().slice(-500)].filter(Boolean).join(' | ');
    throw new Error(`${head} exit ${r.status}: ${detail}`);
  }
  if (error) throw new Error(`${head} ${error}`);
  if (text === null) throw new Error(`${label}: no answer in the ${harness} output`);
  try { return answerJson(text); } catch (err) { throw new Error(`${label}: ${err.message}`); }
}
