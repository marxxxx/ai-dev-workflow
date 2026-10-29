// The setup phase of `adw e2e`: everything a first run is missing, offered before the run starts. Each step is
// `async ({ root, opts, d, prompter, state })`; `state` is a plain object the steps share. With `prompter === null`
// (CI, pipe, --no-input) only the non-interactive parts run, and preflight stays fatal for what is still missing.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setEnvVar } from '../../agent-src/lib/container.mjs';
import { askContainer, createReadlinePrompter, createScriptedPrompter, setUpContainer } from '../../agent-src/lib/onboard.mjs';
import { spawnEditor } from './acceptance.mjs';
import { HARNESSES } from '../lib/llm.mjs';
import { LANGUAGES, detectLanguage } from './language.mjs';
import { loadLocalConfig } from './config.mjs';
import { devImage } from './image.mjs';
import { composeEnv, stageCredentials } from './session.mjs';
import { readTicket, ticketDir, writeTicket } from './store.mjs';

const DEFAULTS = JSON.parse(readFileSync(new URL('./defaults.json', import.meta.url), 'utf8'));

const yes = (answer) => /^(y|yes|true)$/i.test(answer);

// Questions only when asked for: an answers file, or a terminal on both ends. Otherwise null.
export function makePrompter(opts, d) {
  if (opts.noInput) return null;
  let real;
  if (opts.answers) real = createScriptedPrompter(JSON.parse(readFileSync(path.resolve(opts.answers), 'utf8')));
  else if (d.isTTY.stdin && d.isTTY.stdout) real = createReadlinePrompter();
  else return null;
  // cmdInit closes its prompter in `finally`; the interview is only one step of many, so runSetup closes the real one.
  return { ...real, close: () => {}, closeReal: () => real.close() };
}

const readJson = (file) => {
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return {}; }
};

export async function stepProjectConfig({ root, d, prompter }) {
  if (!prompter || existsSync(path.join(root, 'ai-project.json'))) return;
  const answer = await prompter.ask('No ai-project.json here. Run the adw init interview now? (Y/n)', 'setup.init', prompter.scripted ? 'n' : 'y');
  if (yes(answer)) await d.cmdInit(root, { prompter });
}

export async function stepContainerFiles({ root, prompter }) {
  if (!prompter || existsSync(path.join(root, 'compose.ai-dev.yml'))) return;
  const answer = await prompter.ask('No dev container files (compose.ai-dev.yml). Write them now? (Y/n)', 'setup.container', prompter.scripted ? 'n' : 'y');
  if (!yes(answer)) return;
  const container = await askContainer(prompter, root);
  if (container.enabled) setUpContainer(root, container, readJson(path.join(root, 'ai-project.json')));
}

// A one-off in the project's own compose project (no -p), with the env the containers get; the caller reads the result.
const ownComposeFiles = (root, cenv) => ['compose', '-f', path.join(root, 'compose.ai-dev.yml'),
  ...(cenv.AGENT_CA_DIR ? ['-f', path.join(root, 'compose.ai-dev.certs.yml')] : [])];

export function ownComposeRun({ root, env, exec, argv, entrypoint = null, stdio = 'pipe' }) {
  const cenv = composeEnv({ root, work: root, env });
  const args = [...ownComposeFiles(root, cenv),
    'run', '--rm', '--no-deps', '-T', ...(entrypoint ? ['--entrypoint', entrypoint] : []), 'ai-dev-workflow', ...argv];
  return exec('docker', args, { env: cenv, encoding: 'utf8', stdio });
}

const PLACEHOLDER = '# <title>\n\n<body>\n';

// Ticket import, first source that works: --ticket-file, the host CLI, the same CLI in the dev container (it often
// holds the login the host lacks), the user's editor. Runs only without a stored ticket.
export async function stepTicket({ root, opts, d, prompter, state }) {
  const dir = ticketDir(root, opts.ticket);
  if (readTicket(dir)) return;
  const file = path.join(root, 'ai-project.json');
  const project = existsSync(file) ? readJson(file) : {};
  const ticketFile = opts.ticketFile ? readFileSync(path.resolve(opts.ticketFile), 'utf8') : undefined;
  const done = (ticket) => { writeTicket(dir, ticket); state.ticketText = readTicket(dir); };
  let hostError;
  try { return done(d.importTicket({ root, ticket: opts.ticket, project, ticketFile })); } catch (e) { hostError = e; }
  let last = hostError;
  if (ticketFile === undefined && project.ticketing?.backend !== 'file') {
    const exec = (cmd, args) => {
      const r = ownComposeRun({ root, env: d.env, exec: d.exec, argv: [cmd, ...args] });
      if (r.error) throw r.error;
      if (r.status !== 0) throw new Error(`exit ${r.status}: ${String(r.stderr ?? '').trim().slice(-300)}`);
      return String(r.stdout ?? '');
    };
    try { return done(d.importTicket({ root, ticket: opts.ticket, project, exec })); } catch (e) { last = e; }
  }
  const answer = prompter && await prompter.ask(`Ticket import failed (${last.message}). Write the ticket in your editor? (Y/n)`, 'setup.ticketEditor', prompter.scripted ? 'n' : 'y');
  if (!yes(answer)) throw hostError;
  const target = path.join(dir, 'ticket.md');
  mkdirSync(dir, { recursive: true });
  writeFileSync(target, PLACEHOLDER);
  try {
    do (d.editor ?? spawnEditor)(target); while (!(readTicket(dir)?.title.trim() && readTicket(dir).title !== '<title>'));
  } catch {
    rmSync(target, { force: true });
    throw hostError;
  }
  state.ticketText = readTicket(dir);
}

export function detectTestCommand(root) {
  const pkg = path.join(root, 'package.json');
  if (existsSync(pkg) && readJson(pkg).scripts?.test) return 'npm test';
  if (readdirSync(root).some((f) => /\.(sln|csproj)$/.test(f))) return 'dotnet test';
  const makefile = path.join(root, 'Makefile');
  if (existsSync(makefile) && /^test:/m.test(readFileSync(makefile, 'utf8'))) return 'make test';
  return null;
}

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// The e2e block to write: `current` plus every answered key (nested like the block itself); an answer equal to its
// defaults.json value (blank included) is dropped, so only deviations are stored.
export function e2eChanges(current, answers) {
  const walk = (cur, ans, def) => {
    const out = { ...cur };
    for (const [key, value] of Object.entries(ans)) {
      if (isObject(value)) {
        const inner = walk(isObject(cur[key]) ? cur[key] : {}, value, isObject(def?.[key]) ? def[key] : {});
        if (Object.keys(inner).length) out[key] = inner; else delete out[key];
      } else if (value === '' || value == null || JSON.stringify(value) === JSON.stringify(def?.[key] ?? null)) delete out[key];
      else out[key] = value;
    }
    return out;
  };
  return walk(current, answers, DEFAULTS);
}

export function writeProjectE2e(root, e2e) {
  const file = path.join(root, 'ai-project.json');
  writeFileSync(file, `${JSON.stringify({ ...readJson(file), e2e }, null, 2)}\n`);
}

const names = (text) => String(text).split(',').map((n) => n.trim()).filter(Boolean);

// The first-run interview: asks for the e2e settings, shows the block, writes it to ai-project.json on confirmation.
export async function stepInterview({ root, opts, d, prompter, state }) {
  const file = path.join(root, 'ai-project.json');
  if (!prompter || !existsSync(file)) return;
  const project = readJson(file);
  if ('e2e' in project && !opts.reconfigure) return;
  const current = isObject(project.e2e) ? project.e2e : {};
  const ticket = state.ticketText ?? readTicket(ticketDir(root, opts.ticket));
  const env = composeEnv({ root, work: root, env: { ...d.env, ...state.envAdditions } });
  const loggedIn = ['claude-code', 'codex'].filter((h) => !stageCredentials({ harnesses: [h], env, home: d.home }).missing.length);

  const harness = await prompter.askChoice('Harness for the agent under test', 'e2e.agent.harness', HARNESSES,
    opts.harness ?? current.agent?.harness ?? (loggedIn.length === 1 ? loggedIn[0] : ''));
  const model = await prompter.ask("Model for the agent (blank: the CLI's default)", 'e2e.agent.model', opts.model ?? current.agent?.model ?? '');
  const judgeModel = await prompter.ask("Model for the verifier and the review judge (blank: the agent's; the report will warn about self-judging)",
    'e2e.judgeModel', current.verifier?.model ?? current.review?.model ?? '');
  const testCommand = await prompter.ask('Command that runs your tests in the dev container (blank: none)', 'e2e.testCommand',
    current.testCommand ?? detectTestCommand(root) ?? '');
  const roles = [harness, ...['answerer', 'verifier', 'review'].map((r) => current[r]?.harness ?? harness)];
  let envNames = current.env ?? [];
  let secretEnv = current.secretEnv ?? [];
  if (roles.includes('opencode') || env.CLAUDE_CODE_USE_BEDROCK || env.CLAUDE_CODE_USE_VERTEX) {
    envNames = names(await prompter.ask('Provider variables to pass into the containers (names, comma-separated)', 'e2e.env', envNames.join(',')));
    if (envNames.length) {
      secretEnv = names(await prompter.ask('Which of them are secrets (names, comma-separated)', 'e2e.secretEnv', (current.secretEnv ?? envNames).join(',')));
    } else secretEnv = [];
  }
  const language = await prompter.askChoice('Language of the ticket and your answers', 'e2e.language', LANGUAGES,
    current.language ?? detectLanguage(ticket ? `${ticket.title}\n${ticket.body}` : ''));

  const e2e = e2eChanges(current, { agent: { harness, model }, verifier: { model: judgeModel }, review: { model: judgeModel },
    testCommand, env: envNames, secretEnv, language });
  d.log(`e2e in ai-project.json, now:\n${JSON.stringify(project.e2e ?? null, null, 2)}\nnew:\n${JSON.stringify(e2e, null, 2)}`);
  const answer = await prompter.ask('Write this to ai-project.json? (Y/n)', 'setup.writeE2e', prompter.scripted ? 'n' : 'y');
  if (yes(answer)) writeProjectE2e(root, e2e);
}

// The project's own compose config as JSON, or null when docker cannot render it.
function projectComposeConfig(root, env, exec) {
  const cenv = composeEnv({ root, work: root, env });
  const r = exec('docker', [...ownComposeFiles(root, cenv), 'config', '--format', 'json'], { env: cenv, encoding: 'utf8' });
  if (r.error || r.status !== 0) return null;
  try { return JSON.parse(r.stdout); } catch { return null; }
}

// The project's agent-home volume (what ./ai-dev.sh logs into), or null when it does not exist: a `compose run` would create it.
export function projectVolume(root, env, exec) {
  const config = projectComposeConfig(root, env, exec);
  if (!config?.name) return null;
  const volume = `${config.name}_agent-home`;
  const inspect = exec('docker', ['volume', 'inspect', volume], { env: composeEnv({ root, work: root, env }), encoding: 'utf8' });
  return !inspect.error && inspect.status === 0 ? volume : null;
}

const LOGIN_ROLES = ['agent', 'answerer', 'verifier', 'review'];
const VOLUME_LOGIN = { codex: '.codex/auth.json', opencode: '.local/share/opencode/auth.json' };

// Missing logins, offered in priority order after env and host files: the project's agent-home volume (codex, opencode),
// a guided `claude setup-token` (claude-code). Leaves `state.config`, `state.creds` and `state.fallbackHome` for the later steps.
// Secrets read here go to files (mode 600) and `.env.ai-dev`, never into argv or the log.
export async function stepLogins({ root, opts, d, prompter, state }) {
  try {
    state.config = loadLocalConfig(root, { harness: opts.harness ?? undefined, model: opts.model ?? undefined });
  } catch { return; } // the real preflight reports it
  const harnesses = LOGIN_ROLES.map((r) => state.config[r].harness);
  const stage = () => stageCredentials({ harnesses, env: composeEnv({ root, work: root, env: { ...d.env, ...state.envAdditions } }), home: d.home,
    fallbackHome: state.fallbackHome ?? null });
  state.fallbackHome ??= null;
  state.creds = stage();
  if (!prompter) return;
  const ask = (label, key) => prompter.ask(label, key, prompter.scripted ? 'n' : 'y');
  const env = () => ({ ...d.env, ...state.envAdditions });
  let volume;
  // opencode's login is optional, so it is never "missing": offered when it is used, no login file exists and the volume may have one.
  const wanted = [...state.creds.missing.map((m) => m.harness),
    ...(harnesses.includes('opencode') && !state.creds.authFiles.some((f) => f.harness === 'opencode') ? ['opencode'] : [])];
  for (const harness of wanted) {
    if (harness === 'claude-code') {
      const provider = d.env.CLAUDE_CODE_USE_BEDROCK || d.env.CLAUDE_CODE_USE_VERTEX;
      if (!yes(await ask("Claude Code needs a long-lived token. Run 'claude setup-token' in the dev container now? (Y/n)", 'setup.claudeToken'))) {
        if (!provider) d.log("For Bedrock or Vertex, set CLAUDE_CODE_USE_BEDROCK or CLAUDE_CODE_USE_VERTEX and list that provider's variables in e2e.env.");
        continue;
      }
      // A plain `docker run` of the dev image: no compose project, so the agent-home volume is neither mounted nor created.
      const config = projectComposeConfig(root, env(), d.exec);
      if (!config) { d.error('claude setup-token failed: the compose config of the dev container cannot be read'); continue; }
      prompter.suspend();
      let run;
      try { run = d.exec('docker', ['run', '--rm', '-it', '--entrypoint', 'claude', devImage(config), 'setup-token'], { stdio: 'inherit' }); } finally { prompter.resume(); }
      if (run.error || run.status !== 0) { d.error(`claude setup-token failed (exit ${run.status ?? run.error?.message})`); continue; }
      const token = (await prompter.askSecret('Paste the token', 'setup.claudeTokenValue')).trim();
      if (!token) continue;
      if (yes(await ask('Save it to .env.ai-dev? (Y/n)', 'setup.saveClaudeToken'))) {
        if (!setEnvVar(path.join(root, '.env.ai-dev'), 'CLAUDE_CODE_OAUTH_TOKEN', token)) d.log('.env.ai-dev already sets CLAUDE_CODE_OAUTH_TOKEN: left as is');
      }
      state.envAdditions.CLAUDE_CODE_OAUTH_TOKEN = token;
    } else if (VOLUME_LOGIN[harness]) {
      volume ??= projectVolume(root, env(), d.exec) ?? false;
      if (!volume) continue;
      const rel = VOLUME_LOGIN[harness];
      const answer = await ask(`Use the ${harness} login of this project's dev container (agent-home volume)? A trial may refresh it; then log in again with ./ai-dev.sh. (Y/n)`,
        `setup.volumeLogin.${harness}`);
      if (!yes(answer)) continue;
      const r = ownComposeRun({ root, env: env(), exec: d.exec, entrypoint: 'cat', argv: [`/home/dev/${rel}`] });
      if (r.error || r.status !== 0) { d.log(`! reading ${rel} from the agent-home volume failed`); continue; }
      const text = String(r.stdout ?? '');
      try { JSON.parse(text); } catch { d.log(`! no usable ${rel} in the agent-home volume`); continue; }
      state.fallbackHome ??= mkdtempSync(path.join(os.tmpdir(), 'adw-e2e-auth-'));
      const target = path.join(state.fallbackHome, rel);
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, text, { mode: 0o600 });
    }
  }
  state.creds = stage();
}

// Names in e2e.env that nothing sets: asked for (secretEnv names without echo), then optionally saved to `.env.ai-dev`.
// The values are scrubbed by runE2e, which reads secretEnv from the env merged with envAdditions; never logged here.
export async function stepEnvValues({ root, d, prompter, state }) {
  if (!prompter || !state.config) return;
  const env = composeEnv({ root, work: root, env: { ...d.env, ...state.envAdditions } });
  const given = {};
  for (const name of state.config.env.filter((n) => !env[n])) {
    const key = `setup.env.${name}`;
    const label = `Value for ${name}`;
    const value = (state.config.secretEnv.includes(name) ? await prompter.askSecret(label, key) : await prompter.ask(label, key, '')).trim();
    if (value) given[name] = value;
  }
  if (!Object.keys(given).length) return;
  if (yes(await prompter.ask('Save these values to .env.ai-dev? (Y/n)', 'setup.saveEnv', prompter.scripted ? 'n' : 'y'))) {
    for (const [name, value] of Object.entries(given)) {
      if (!setEnvVar(path.join(root, '.env.ai-dev'), name, value)) d.log(`.env.ai-dev already sets ${name}: left as is`);
    }
  }
  Object.assign(state.envAdditions, given);
}

const STEPS = [stepProjectConfig, stepContainerFiles, stepTicket, stepInterview, stepLogins, stepEnvValues];

export async function runSetup({ root, opts, d, prompter }) {
  const state = { envAdditions: {}, ticketText: null, config: null, creds: null, fallbackHome: null };
  try {
    for (const step of STEPS) await step({ root, opts, d, prompter, state });
  } catch (err) {
    if (state.fallbackHome) rmSync(state.fallbackHome, { recursive: true, force: true });
    throw err;
  } finally {
    // The stdin readline must be free before the first agent turn (askHumanTty).
    prompter?.closeReal();
  }
  return { envAdditions: state.envAdditions, ticketText: state.ticketText, config: state.config, creds: state.creds, fallbackHome: state.fallbackHome };
}
