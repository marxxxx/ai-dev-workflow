// The per-ticket store under <root>/.adw/e2e/<ticket>/: ticket, answers, runs.
import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

// The process answers every run starts with; spec approval is deliberately absent (it must reach the human).
export const DEFAULT_ANSWERS = [
  { id: 'A1', question: 'Offer to skip the questions and just start', answer: 'Nein, bitte stell deine Fragen, überspring sie nicht.', source: 'default' },
  { id: 'A2', question: 'Should the agent test end to end or the user manually', answer: 'Teste bitte selbst Ende-zu-Ende, ich teste nicht manuell.', source: 'default' },
  { id: 'A3', question: 'Approve the implementation plan', answer: 'Der Plan ist freigegeben, nimm die von dir empfohlene Option.', source: 'default' },
  { id: 'A4', question: 'Isolation / worktree choice', answer: 'Nimm die von dir empfohlene Option.', source: 'default' },
  { id: 'A5', question: 'Create a new ticket', answer: 'Nein, kein neues Ticket, das Ticket existiert bereits.', source: 'default' },
];

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

export function readAnswers(dir) {
  const file = join(dir, 'answers.json');
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : DEFAULT_ANSWERS.map((a) => ({ ...a }));
}

// A first human answer on a fresh ticket writes the defaults too, so it becomes A6.
export function appendAnswer(dir, { question, answer }) {
  const answers = readAnswers(dir);
  const max = Math.max(0, ...answers.map((a) => Number(a.id.slice(1))));
  const entry = { id: `A${max + 1}`, question, answer, source: 'human' };
  mkdirSync(dir, { recursive: true });
  const tmp = join(dir, 'answers.json.tmp');
  writeFileSync(tmp, `${JSON.stringify([...answers, entry], null, 2)}\n`);
  renameSync(tmp, join(dir, 'answers.json'));
  return entry;
}

export const newRunDir = (dir, harness, ts) => join(dir, 'runs', ts, harness);

// Run output stays out of git; the ticket, answers and acceptance criteria are committed.
export function ensureGitignore(root) {
  const file = join(resolve(root), '.adw', 'e2e', '.gitignore');
  if (existsSync(file)) return;
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, '*/runs/\n');
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
