// Onboarding: prompters (readline / scripted), the single reusable interview, the scaffold
// fallback, and cmdInit — which resolves a prompter and writes ai-project.json.

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { SRC_DIR, argValue } from './constants.mjs';
import { detectRepoSlug } from './identity.mjs';
import { readJson, buildProjectConfig } from './config.mjs';
import { STACKS, detectStack, writeContainerFiles, nextSteps } from './container.mjs';

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
  '               https://ccusage.com';

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
 *   close()                      → release any resources
 *   scripted                     → true for the --answers prompter (absent answers mean "no" to opt-ins)
 * `key` is a stable identifier per question (readline ignores it; scripted looks answers up by it).
 */
export function createReadlinePrompter() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q, _key, def) => new Promise((res) => {
    const hint = def ? ` [${def}]` : '';
    rl.question(`${q}${hint}: `, (a) => res(a.trim() || def || ''));
  });
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
  return { ask, askRequired, askChoice, close: () => rl.close(), scripted: false };
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
  return { ask, askRequired, askChoice, close: () => {}, scripted: true };
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
  if (!/^(y|yes|true)$/i.test(enabled)) return { enabled: false };
  const stack = await prompter.askChoice('Container stack', 'container.stack', STACKS, detectStack(projectRoot));
  return { enabled: true, stack };
}

/** The ai-dev-workflow version, for the `npx @strobl_dev/adw@<version>` line of the next steps. */
function packageVersion() {
  return readJson(path.join(SRC_DIR, '..', 'package.json'), 'package.json', true).version;
}

/** Write the container files for `config` and print what happened plus the next steps. */
function setUpContainer(projectRoot, stack, config) {
  const backend = config.ticketing?.backend || 'file';
  const { written, skipped } = writeContainerFiles(projectRoot, {
    name: config.project?.name || path.basename(projectRoot),
    stack,
    backend,
    giteaLogin: config.ticketing?.gitea?.login || '',
  });
  for (const f of written) console.log(`Wrote ${f}`);
  for (const f of skipped) console.log(`${f} exists — left untouched.`);
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
export async function cmdInit(projectRoot, { prompter } = {}) {
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
        if (container.enabled) setUpContainer(projectRoot, container.stack, readExistingConfig(dest));
        return 0;
      }
    }

    const answers = await runInterview(active, { detectRepoSlug, projectRoot });
    const config = buildProjectConfig(answers);
    const container = await askContainer(active, projectRoot);
    fs.writeFileSync(dest, JSON.stringify(config, null, 2) + '\n');

    console.log(`\nCreated ${dest}`);
    if (container.enabled) {
      setUpContainer(projectRoot, container.stack, config);
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
