// The setup phase of `adw e2e`: everything a first run is missing, offered before the run starts. Each step is
// `async ({ root, opts, d, prompter, state })`; `state` is a plain object the steps share. With `prompter === null`
// (CI, pipe, --no-input) only the non-interactive parts run, and preflight stays fatal for what is still missing.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { askContainer, createReadlinePrompter, createScriptedPrompter, setUpContainer } from '../../agent-src/lib/onboard.mjs';
import { spawnEditor } from './acceptance.mjs';
import { composeEnv } from './session.mjs';
import { readTicket, ticketDir, writeTicket } from './store.mjs';

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

const STEPS = [stepProjectConfig, stepContainerFiles, stepTicket];

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
