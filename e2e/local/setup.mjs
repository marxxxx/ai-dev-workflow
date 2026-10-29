// The setup phase of `adw e2e`: everything a first run is missing, offered before the run starts. Each step is
// `async ({ root, opts, d, prompter, state })`; `state` is a plain object the steps share. With `prompter === null`
// (CI, pipe, --no-input) only the non-interactive parts run, and preflight stays fatal for what is still missing.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { askContainer, createReadlinePrompter, createScriptedPrompter, setUpContainer } from '../../agent-src/lib/onboard.mjs';

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

const STEPS = [stepProjectConfig, stepContainerFiles];

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
