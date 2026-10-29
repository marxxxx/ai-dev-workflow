// The per-ticket store under <root>/.adw/e2e/<ticket>/: ticket, answers, runs.
import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ensureLine } from '../../agent-src/lib/container.mjs';
import { textsFor } from './language.mjs';

// The process answers every run starts with (German here; cli.mjs picks the language); spec approval is deliberately absent (it must reach the human).
export const DEFAULT_ANSWERS = textsFor('de').defaultAnswers;

export const ticketDir = (root, ticket) => join(resolve(root), '.adw', 'e2e', String(ticket));

export function readTicket(dir) {
  const file = join(dir, 'ticket.md');
  if (!existsSync(file)) return null;
  const text = readFileSync(file, 'utf8');
  const m = /^# (.*)\n\n([\s\S]*?)\n?$/.exec(text);
  return m ? { title: m[1], body: m[2] } : { title: '', body: text.trim() };
}

export function writeTicket(dir, { title, body }) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'ticket.md'), `# ${title}\n\n${body}\n`);
}

export function readAnswers(dir, defaults = DEFAULT_ANSWERS) {
  const file = join(dir, 'answers.json');
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : defaults.map((a) => ({ ...a }));
}

// A first human answer on a fresh ticket writes the defaults too, so it becomes A6.
export function appendAnswer(dir, { question, answer }, defaults = DEFAULT_ANSWERS) {
  const answers = readAnswers(dir, defaults);
  const max = Math.max(0, ...answers.map((a) => Number(a.id.slice(1))));
  const entry = { id: `A${max + 1}`, question, answer, source: 'human' };
  mkdirSync(dir, { recursive: true });
  const tmp = join(dir, 'answers.json.tmp');
  writeFileSync(tmp, `${JSON.stringify([...answers, entry], null, 2)}\n`);
  renameSync(tmp, join(dir, 'answers.json'));
  return entry;
}

export const newRunDir = (dir, harness, ts) => join(dir, 'runs', ts, harness);

// Run output and this machine's choices (local.json) stay out of git; the ticket, answers and acceptance criteria are committed.
export function ensureGitignore(root) {
  const file = join(resolve(root), '.adw', 'e2e', '.gitignore');
  mkdirSync(join(file, '..'), { recursive: true });
  ensureLine(file, '*/runs/');
  ensureLine(file, 'local.json');
}

const localFile = (root) => join(resolve(root), '.adw', 'e2e', 'local.json');

// Machine-local setup decisions (`loginFromVolume.<harness>`, `e2eSectionDeclined`); {} when missing or unreadable.
export function readLocalState(root) {
  try {
    const state = JSON.parse(readFileSync(localFile(root), 'utf8'));
    return state && typeof state === 'object' && !Array.isArray(state) ? state : {};
  } catch { return {}; }
}

// Merges `patch` into local.json (one level deep for object values), git-ignored before the first write.
export function writeLocalState(root, patch) {
  ensureGitignore(root);
  const state = readLocalState(root);
  for (const [key, value] of Object.entries(patch)) {
    state[key] = value && typeof value === 'object' && !Array.isArray(value) ? { ...state[key], ...value } : value;
  }
  writeFileSync(localFile(root), `${JSON.stringify(state, null, 2)}\n`);
}

// Newest earlier run of this harness on the same base commit that finished and is comparable.
export function findLocalBaseline({ dir, harness, before, baseCommit }) {
  const runs = join(dir, 'runs');
  if (!existsSync(runs)) return null;
  const stamps = readdirSync(runs).filter((ts) => !before || ts < before).sort().reverse();
  for (const ts of stamps) {
    const runDir = join(runs, ts, harness);
    const file = join(runDir, 'run.json');
    if (!existsSync(file)) continue;
    let run;
    try { run = JSON.parse(readFileSync(file, 'utf8')); } catch { continue; }
    if (run.fingerprint?.baseCommit === baseCommit && !run.aborted && run.comparable === true) return runDir;
  }
  return null;
}
