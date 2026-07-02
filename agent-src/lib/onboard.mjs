// Onboarding: prompters (readline / scripted), the single reusable interview, the scaffold
// fallback, and cmdInit — which resolves a prompter and writes ai-project.json + the setup doc.

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { SRC_DIR, argValue } from './constants.mjs';
import { kebabCase, detectRepoSlug } from './identity.mjs';
import { readJson, buildProjectConfig } from './config.mjs';
import { renderSetupDoc } from './setup-doc.mjs';

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
  return 0;
}

/**
 * A prompter answers the onboarding questions. Two implementations share one interface:
 *   ask(label, key, def)         → resolved answer (def when blank)
 *   askRequired(label, key, def) → like ask but never returns empty
 *   askChoice(label, key, opts, def) → constrained to `opts`
 *   close()                      → release any resources
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
  return { ask, askRequired, askChoice, close: () => rl.close() };
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
  return { ask, askRequired, askChoice, close: () => {} };
}

/**
 * The single ordered onboarding interview. Drives the given prompter and returns the flat
 * answers object consumed by buildProjectConfig. Backend selection gates the file/azure asks.
 */
export async function runInterview(prompter, { detectRepoSlug, projectRoot }) {
  const name = await prompter.askRequired('Project name', 'name');
  const slug = await prompter.ask('Project slug', 'slug', kebabCase(name));
  const serena = await prompter.ask('Serena project name', 'serena', slug);
  const description = await prompter.ask('Description', 'description', '');
  const repoSlug = await prompter.ask('Repository slug (owner/repo)', 'repoSlug', detectRepoSlug(projectRoot));
  const defaultBranch = await prompter.ask('Default branch', 'defaultBranch', 'main');
  const backend = await prompter.askChoice('Ticketing backend', 'backend', ['file', 'github', 'azure-devops'], 'file');
  const itemNoun = await prompter.ask('Item noun', 'itemNoun', 'issue');

  const answers = { name, slug, serena, description, repoSlug, defaultBranch, backend, itemNoun };
  if (backend === 'file') {
    answers.file = {
      dir: await prompter.ask('Tickets dir', 'file.dir', '.tickets/issues'),
      metadataFile: await prompter.ask('Metadata file', 'file.metadataFile', '.tickets/metadata.json'),
    };
  } else if (backend === 'azure-devops') {
    answers.azure = {
      organization: await prompter.askRequired('Azure DevOps organization', 'azure.organization'),
      project: await prompter.askRequired('Azure DevOps project', 'azure.project'),
      processTemplate: await prompter.askChoice('Process template', 'azure.processTemplate', ['basic', 'scrum'], 'basic'),
    };
  }
  answers.branchPattern = await prompter.ask('Branch pattern', 'branchPattern', 'feat/<issue-number>_<slug>');
  answers.prTarget = await prompter.ask('PR target branch', 'prTarget', defaultBranch);
  return answers;
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
      if (!/^y(es)?$/i.test(ow)) { console.log('Left untouched.'); return 0; }
    }

    const answers = await runInterview(active, { detectRepoSlug, projectRoot });
    const config = buildProjectConfig(answers);
    fs.writeFileSync(dest, JSON.stringify(config, null, 2) + '\n');
    const setupPath = path.join(projectRoot, 'docs', 'ai-workflow-setup.md');
    fs.mkdirSync(path.dirname(setupPath), { recursive: true });
    fs.writeFileSync(setupPath, renderSetupDoc(config));

    console.log(`\nCreated ${dest}`);
    console.log(`Created ${setupPath}`);
    console.log('Next: run `ai-dev-workflow generate`, then commit ai-project.json and the generated dirs.');
    return 0;
  } finally {
    active.close();
  }
}
