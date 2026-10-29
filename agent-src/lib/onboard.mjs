// Onboarding: prompters (readline / scripted), the single reusable interview, the scaffold
// fallback, and cmdInit — which resolves a prompter and writes ai-project.json.

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { SRC_DIR, argValue } from './constants.mjs';
import { detectRepoSlug } from './identity.mjs';
import { readJson, buildProjectConfig } from './config.mjs';
import { STACKS, DIND_WARNING, detectStack, writeContainerFiles, nextSteps } from './container.mjs';
import { loadSkillPins, installSkills, reportSkills } from './skills.mjs';

/**
 * The next-step guidance printed after onboarding: create AGENTS.md with the coding agent's native
 * `/init`. Shared by both entry points.
 */
const AGENTS_MD_GUIDANCE =
  'Create AGENTS.md with your coding agent\'s native `/init` command. agent-dev reads it first, so\n' +
  'keep build/test commands and project conventions there. For end-to-end checks, add an\n' +
  '"End-to-end testing" section describing how to start the app (see the ai-dev-workflow README).';

/**
 * The tooling the agents expect, printed after onboarding. Deliberately names and links each
 * project without explaining how to install it: install steps differ per harness, go stale, and
 * are already documented upstream. Installing these is the user's job.
 */
const DEPENDENCIES =
  'Tooling — install for whichever coding agent you use. These are not installed for you.\n' +
  '\n' +
  'Required:\n' +
  '  superpowers  Skill library: the brainstorm -> plan -> implement workflow agent-dev runs\n' +
  '               https://github.com/obra/superpowers\n' +
  '\n' +
  'Recommended:\n' +
  '  serena       MCP server: semantic, symbol-level code navigation and editing\n' +
  '               https://github.com/oraios/serena\n' +
  '\n' +
  '  playwright   MCP server: drives a real browser for agent-dev\'s optional end-to-end check\n' +
  '               https://github.com/microsoft/playwright-mcp\n' +
  '\n' +
  '  context7     MCP server: up-to-date library and framework documentation\n' +
  '               https://github.com/upstash/context7\n' +
  '\n' +
  '  ccusage      CLI: token/cost reporting used for agent-dev\'s cost summary\n' +
  '               https://ccusage.com\n' +
  '\n' +
  '  show-me      Skill: compact views of a spec or plan for agent-dev\'s reviews; `init` and\n' +
  '               `upgrade` install it into the project unless you opt out\n' +
  '               https://github.com/humanlayer/skills';

/** Template-copy scaffold — the non-interactive fallback. Never overwrites. */
export function cmdScaffold(projectRoot) {
  const template = path.join(SRC_DIR, 'config', 'ai-project.template.json');
  if (!fs.existsSync(template)) throw new Error(`scaffold template missing at ${template}`);
  const dest = path.join(projectRoot, 'ai-project.json');
  if (fs.existsSync(dest)) {
    console.log(`ai-project.json already exists at ${dest} — left untouched.`);
    return 0;
  }
  fs.copyFileSync(template, dest);
  console.log(`Created ${dest}.\nEdit project identity + ticketing.backend, then run \`ai-dev-workflow generate\`.`);
  console.log(`\n${DEPENDENCIES}`);
  console.log(`\n${AGENTS_MD_GUIDANCE}`);
  return 0;
}

/**
 * A prompter answers the onboarding questions. Two implementations share one interface:
 *   ask(label, key, def)         → resolved answer (def when blank)
 *   askRequired(label, key, def) → like ask but never returns empty
 *   askChoice(label, key, opts, def) → constrained to `opts`
 *   askSecret(label, key)        → an answer read without echo, trimmed ('' when absent)
 *   suspend() / resume()         → free the terminal for a child process and take it back
 *   close()                      → release any resources
 *   scripted                     → true for the --answers prompter (absent answers mean "no" to opt-ins)
 * `key` is a stable identifier per question (readline ignores it; scripted looks answers up by it).
 */
export function createReadlinePrompter({ input = process.stdin, output = process.stdout, terminal } = {}) {
  const rl = readline.createInterface({ input, output, ...(terminal === undefined ? {} : { terminal }) });
  // Ctrl-C at a question rejects it (`interrupted`, like e2e's InterruptError) instead of closing rl and leaving the
  // question pending forever; a Ctrl-C between questions rejects the next one.
  const interrupt = () => Object.assign(new Error('interrupted (SIGINT)'), { interrupted: true, signal: 'SIGINT' });
  let pending = null;
  let interrupted = false;
  rl.on('SIGINT', () => { if (pending) pending(interrupt()); else interrupted = true; });
  const question = (text, onAnswer, onSettle = () => {}) => new Promise((res, rej) => {
    if (interrupted) { interrupted = false; onSettle(); rej(interrupt()); return; }
    // The abort drops rl's question callback, so a later question is not answered into this one.
    const ac = new AbortController();
    pending = (err) => { pending = null; ac.abort(); onSettle(); rej(err); };
    rl.question(text, { signal: ac.signal }, (a) => { pending = null; onSettle(); res(onAnswer(a)); });
  });
  const ask = (q, _key, def) => question(`${q}${def ? ` [${def}]` : ''}: `, (a) => a.trim() || def || '');
  const askRequired = async (q, key, def) => {
    for (;;) { const v = await ask(q, key, def); if (v) return v; console.log('  (required)'); }
  };
  const askChoice = async (q, key, choices, def) => {
    for (;;) {
      const v = await ask(`${q} (${choices.join('/')})`, key, def);
      if (choices.includes(v)) return v;
      console.log(`  (choose one of: ${choices.join(', ')})`);
    }
  };
  // The prompt is printed, then rl's echo is switched off until the line is read.
  const askSecret = (q) => {
    output.write(`${q}: `);
    const write = rl._writeToOutput;
    rl._writeToOutput = () => {};
    return question('', (a) => a.trim(), () => { rl._writeToOutput = write; output.write('\n'); });
  };
  // Hands the terminal to a child process (raw mode off, so Ctrl-C is a real SIGINT; readline paused) and takes it back.
  const suspend = () => { rl.pause(); input.setRawMode?.(false); };
  const resume = () => { input.setRawMode?.(true); rl.resume(); };
  return { ask, askRequired, askChoice, askSecret, suspend, resume, close: () => rl.close(), scripted: false };
}

/**
 * Non-interactive prompter backed by a `values` object. Dotted keys (e.g. `file.dir`) are
 * resolved by nested-path lookup so the answers file mirrors the natural interview shape.
 * Missing/blank values fall back to `def`; required/choice questions throw on an unusable value.
 */
export function createScriptedPrompter(values) {
  const lookup = (key) => {
    let cur = values;
    for (const part of key.split('.')) {
      if (cur == null || typeof cur !== 'object') return undefined;
      cur = cur[part];
    }
    return cur;
  };
  const resolve = (key, def) => {
    const v = lookup(key);
    if (v == null || v === '') return def || '';
    return String(v).trim();
  };
  const ask = async (_q, key, def) => resolve(key, def);
  const askRequired = async (_q, key, def) => {
    const v = resolve(key, def);
    if (!v) throw new Error(`init: required answer "${key}" is missing`);
    return v;
  };
  const askChoice = async (_q, key, choices, def) => {
    const v = resolve(key, def);
    if (!choices.includes(v)) {
      throw new Error(`init: answer "${key}" must be one of ${choices.join(', ')} (got "${v}")`);
    }
    return v;
  };
  const askSecret = async (_q, key) => resolve(key, '');
  return { ask, askRequired, askChoice, askSecret, suspend() {}, resume() {}, close: () => {}, scripted: true };
}

/**
 * The single ordered onboarding interview. Drives the given prompter and returns the flat
 * answers object consumed by buildProjectConfig. Backend selection gates the file/azure asks.
 */
export async function runInterview(prompter, { detectRepoSlug, projectRoot }) {
  const name = await prompter.askRequired('Project name', 'name');
  const repoSlug = await prompter.ask('Repository slug (owner/repo)', 'repoSlug', detectRepoSlug(projectRoot));
  const backend = await prompter.askChoice('Ticketing backend', 'backend', ['file', 'github', 'gitea', 'azure-devops'], 'file');

  const answers = { name, repoSlug, backend };
  if (backend === 'file') {
    answers.file = {
      dir: await prompter.ask('Tickets dir', 'file.dir', '.tickets/issues'),
      metadataFile: await prompter.ask('Metadata file', 'file.metadataFile', '.tickets/metadata.json'),
    };
  } else if (backend === 'gitea') {
    answers.gitea = {
      login: await prompter.askRequired('Gitea login profile (from `tea login add`)', 'gitea.login'),
    };
  } else if (backend === 'azure-devops') {
    answers.azure = {
      organization: await prompter.askRequired('Azure DevOps organization', 'azure.organization'),
      project: await prompter.askRequired('Azure DevOps project', 'azure.project'),
      processTemplate: await prompter.askChoice('Process template', 'azure.processTemplate', ['basic', 'scrum'], 'basic'),
    };
  }
  answers.prTarget = await prompter.ask('PR target branch', 'prTarget', 'main');
  return answers;
}

/**
 * The dev-container questions. Interactive runs default to yes; an answers file without
 * `container.enabled` means no, so existing automation keeps getting only ai-project.json.
 */
export async function askContainer(prompter, projectRoot) {
  const enabled = await prompter.ask('Set up the dev container? (Y/n)', 'container.enabled', prompter.scripted ? 'n' : 'y');
  if (!yes(enabled)) return { enabled: false };
  const stack = await prompter.askChoice('Container stack', 'container.stack', STACKS, detectStack(projectRoot));

  // Settings for the git-ignored .env.ai-dev; both opt-ins default to no.
  const env = {};
  const dind = await prompter.ask('Give the agent a Docker daemon (Docker overlay)? (y/N)', 'container.dind', 'n');
  if (yes(dind)) {
    console.log(DIND_WARNING);
    env.AGENT_DIND = '1';
  }
  const certs = await prompter.ask('Trust company root certificates (TLS-inspecting proxy)? (y/N)', 'container.certs', 'n');
  if (yes(certs)) {
    env.AGENT_CA_DIR = await prompter.ask('Absolute directory holding the certificates (blank: set it later)', 'container.caDir', '');
  }
  return { enabled: true, stack, env };
}

/**
 * One question per pinned third-party skill (config/skills.json). Interactive runs default to
 * yes; an answers file without `skills.<name>` means no.
 */
export async function askSkills(prompter, pins = loadSkillPins()) {
  const choices = {};
  for (const [name, { purpose, repository }] of Object.entries(pins.skills)) {
    const answer = await prompter.ask(`Install the ${name} skill (${purpose}, from ${repository})? (Y/n)`, `skills.${name}`, prompter.scripted ? 'n' : 'y');
    choices[name] = yes(answer);
  }
  return choices;
}

const yes = (answer) => /^(y|yes|true)$/i.test(answer);

/** The ai-dev-workflow version, for the `npx @strobl_dev/adw@<version>` line of the next steps. */
function packageVersion() {
  return readJson(path.join(SRC_DIR, '..', 'package.json'), 'package.json', true).version;
}

/** Write the container files for `config` and print what happened plus the next steps. */
export function setUpContainer(projectRoot, { stack, env }, config) {
  const backend = config.ticketing?.backend || 'file';
  const { written, skipped, kept } = writeContainerFiles(projectRoot, {
    name: config.project?.name || path.basename(projectRoot),
    stack,
    backend,
    giteaLogin: config.ticketing?.gitea?.login || '',
    env,
  });
  for (const f of written) console.log(`Wrote ${f}`);
  for (const f of skipped) console.log(`${f} exists — left untouched.`);
  for (const k of kept) console.log(`${k} is already set in .env.ai-dev — left untouched.`);
  if (env.AGENT_CA_DIR === '' && !kept.includes('AGENT_CA_DIR')) {
    console.log(
      '\nAGENT_CA_DIR is empty in .env.ai-dev, so the certificates overlay stays off. To enable it,\n' +
      'set it to the absolute directory holding the company root certificates (*.crt, *.pem, *.cer,\n' +
      '*.cert), e.g. AGENT_CA_DIR=/etc/company-certs. See AI-DEV.md, section 4.');
  } else if (env.AGENT_CA_DIR && !kept.includes('AGENT_CA_DIR') &&
             !(path.isAbsolute(env.AGENT_CA_DIR) && fs.statSync(env.AGENT_CA_DIR, { throwIfNoEntry: false })?.isDirectory())) {
    console.log(`\nWarning: AGENT_CA_DIR=${env.AGENT_CA_DIR} is not an existing absolute directory; the container will not start until it is. Fix it in .env.ai-dev.`);
  }
  console.log(`\n${nextSteps({ backend, version: packageVersion() })}`);
}

/**
 * Onboarding. Prompter resolution order:
 *   1. injected `prompter` (tests) — run the interview with it.
 *   2. `--answers <file>` on argv — scripted prompter fed by that JSON (no TTY needed).
 *   3. interactive TTY — readline prompter.
 *   4. otherwise (no TTY, no answers) — cmdScaffold fallback.
 * The `--answers` path is a scripted prompter, so interactive and non-interactive init share
 * exactly one interview code path.
 */
export async function cmdInit(projectRoot, { prompter, runSkill } = {}) {
  const dest = path.join(projectRoot, 'ai-project.json');
  let active = prompter;
  if (!active) {
    const answersPath = argValue(process.argv, '--answers');
    if (answersPath) {
      active = createScriptedPrompter(readJson(path.resolve(answersPath), '--answers file', true));
    } else if (!process.stdin.isTTY) {
      console.log('Non-interactive stdin — scaffolding ai-project.json from template instead.');
      return cmdScaffold(projectRoot);
    } else {
      active = createReadlinePrompter();
    }
  }

  try {
    if (fs.existsSync(dest)) {
      const ow = await active.ask('ai-project.json exists — overwrite? (y/N)', 'overwrite', 'N');
      if (!/^y(es)?$/i.test(ow)) {
        console.log('ai-project.json left untouched.');
        const container = await askContainer(active, projectRoot);
        if (container.enabled) setUpContainer(projectRoot, container, readExistingConfig(dest));
        return 0;
      }
    }

    const answers = await runInterview(active, { detectRepoSlug, projectRoot });
    const config = { ...buildProjectConfig(answers), skills: await askSkills(active) };
    const container = await askContainer(active, projectRoot);
    fs.writeFileSync(dest, JSON.stringify(config, null, 2) + '\n');

    console.log(`\nCreated ${dest}`);
    const wanted = Object.keys(config.skills).filter((name) => config.skills[name]);
    reportSkills(installSkills(projectRoot, wanted, runSkill ? { run: runSkill } : {}));
    if (container.enabled) {
      setUpContainer(projectRoot, container, config);
      return 0;
    }

    console.log(`\n${DEPENDENCIES}`);
    console.log(`\n${AGENTS_MD_GUIDANCE}`);
    console.log('Next: run `ai-dev-workflow generate`, then commit ai-project.json and the generated dirs.');
    return 0;
  } finally {
    active.close();
  }
}

/** An existing ai-project.json, read leniently: anything unreadable counts as empty. */
function readExistingConfig(file) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}
