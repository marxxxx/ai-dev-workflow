import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_ANSWERS, ticketDir, readTicket, writeTicket, readAnswers, appendAnswer, newRunDir, ensureGitignore, findLocalBaseline, readLocalState, writeLocalState } from './store.mjs';

const tmp = () => mkdtempSync(join(tmpdir(), 'adw-store-'));

test('ticketDir is absolute under .adw/e2e', () => {
  assert.equal(ticketDir('/p', 7), '/p/.adw/e2e/7');
});

test('ticket round trip', () => {
  const dir = join(tmp(), 't');
  assert.equal(readTicket(dir), null);
  writeTicket(dir, { title: 'Add x', body: 'Line 1\n\nLine 2' });
  assert.equal(readFileSync(join(dir, 'ticket.md'), 'utf8'), '# Add x\n\nLine 1\n\nLine 2\n');
  assert.deepEqual(readTicket(dir), { title: 'Add x', body: 'Line 1\n\nLine 2' });
});

test('DEFAULT_ANSWERS are A1..A5 defaults without spec approval', () => {
  assert.deepEqual(DEFAULT_ANSWERS.map((a) => a.id), ['A1', 'A2', 'A3', 'A4', 'A5']);
  assert.ok(DEFAULT_ANSWERS.every((a) => a.source === 'default' && a.question && a.answer));
});

test('readAnswers defaults when the file is missing', () => {
  assert.deepEqual(readAnswers(tmp()), DEFAULT_ANSWERS);
});

test('appendAnswer starts at A6, increments and leaves no temp file', () => {
  const dir = tmp();
  assert.deepEqual(appendAnswer(dir, { question: 'q1', answer: 'a1' }), { id: 'A6', question: 'q1', answer: 'a1', source: 'human' });
  assert.equal(appendAnswer(dir, { question: 'q2', answer: 'a2' }).id, 'A7');
  const all = readAnswers(dir);
  assert.equal(all.length, 7);
  assert.deepEqual(all.slice(0, 5), DEFAULT_ANSWERS);
  assert.deepEqual(readdirSync(dir), ['answers.json']);
});

test('newRunDir', () => {
  assert.equal(newRunDir('/d', 'codex', '2026-01-01T00Z'), '/d/runs/2026-01-01T00Z/codex');
});

test('ensureGitignore is idempotent', () => {
  const root = tmp();
  ensureGitignore(root);
  ensureGitignore(root);
  assert.equal(readFileSync(join(root, '.adw/e2e/.gitignore'), 'utf8'), '*/runs/\nlocal.json\n');
});

test('ensureGitignore adds local.json to an existing .gitignore and keeps its lines', () => {
  const root = tmp();
  mkdirSync(join(root, '.adw/e2e'), { recursive: true });
  writeFileSync(join(root, '.adw/e2e/.gitignore'), '*/runs/\nown');
  ensureGitignore(root);
  assert.equal(readFileSync(join(root, '.adw/e2e/.gitignore'), 'utf8'), '*/runs/\nown\nlocal.json\n');
});

test('local state: empty when missing or unreadable; writes merge and git-ignore local.json', () => {
  const root = tmp();
  assert.deepEqual(readLocalState(root), {});
  writeLocalState(root, { loginFromVolume: { codex: true } });
  writeLocalState(root, { e2eSectionDeclined: true });
  writeLocalState(root, { loginFromVolume: { opencode: false } });
  assert.deepEqual(readLocalState(root), { loginFromVolume: { codex: true, opencode: false }, e2eSectionDeclined: true });
  assert.match(readFileSync(join(root, '.adw/e2e/.gitignore'), 'utf8'), /^local\.json$/m);
  writeFileSync(join(root, '.adw/e2e/local.json'), '{ nope');
  assert.deepEqual(readLocalState(root), {});
});

test('findLocalBaseline picks the newest eligible earlier run', () => {
  const dir = tmp();
  const put = (ts, run, harness = 'codex') => {
    const d = newRunDir(dir, harness, ts);
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, 'run.json'), JSON.stringify(run));
    return d;
  };
  const ok = (extra = {}) => ({ fingerprint: { baseCommit: 'abc' }, comparable: true, ...extra });
  const good = put('2026-01-01', ok());
  put('2026-01-02', ok({ aborted: true }));
  put('2026-01-03', ok({ comparable: false }));
  put('2026-01-04', { fingerprint: { baseCommit: 'other' }, comparable: true });
  put('2026-01-05', ok(), 'opencode');
  put('2026-01-06', { fingerprint: { baseCommit: 'abc', worktree: 'tree1' }, comparable: true });
  put('2026-01-09', ok());
  assert.equal(findLocalBaseline({ dir, harness: 'codex', before: '2026-01-08', baseCommit: 'abc' }), good);
  assert.equal(findLocalBaseline({ dir, harness: 'codex', before: '2026-01-01', baseCommit: 'abc' }), null);
  assert.equal(findLocalBaseline({ dir: tmp(), harness: 'codex', before: 'z', baseCommit: 'abc' }), null);
});
