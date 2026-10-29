// The setup phase of `adw e2e`: everything a first run is missing, offered before the run starts. Each step is
// `async ({ root, opts, d, prompter, state })`; `state` is a plain object the steps share. With `prompter === null`
// (CI, pipe, --no-input) only the non-interactive parts run, and preflight stays fatal for what is still missing.
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { askContainer, createReadlinePrompter, createScriptedPrompter, setUpContainer } from '../../agent-src/lib/onboard.mjs';
import { spawnEditor } from './acceptance.mjs';
import { HARNESSES } from '../lib/llm.mjs';
import { LANGUAGES, detectLanguage } from './language.mjs';
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
export function ownComposeRun({ root, env, exec, argv, entrypoint = null, stdio = 'pipe' }) {
  const cenv = composeEnv({ root, work: root, env });
  const args = ['compose', '-f', path.join(root, 'compose.ai-dev.yml'),
    ...(cenv.AGENT_CA_DIR ? ['-f', path.join(root, 'compose.ai-dev.certs.yml')] : []),
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

const STEPS = [stepProjectConfig, stepContainerFiles, stepTicket, stepInterview];

export async function runSetup({ root, opts, d, prompter }) {
  const state = { envAdditions: {}, ticketText: null };
  try {
    for (const step of STEPS) await step({ root, opts, d, prompter, state });
  } finally {
    // The stdin readline must be free before the first agent turn (askHumanTty).
    prompter?.closeReal();
  }
  return { envAdditions: state.envAdditions, ticketText: state.ticketText };
}
