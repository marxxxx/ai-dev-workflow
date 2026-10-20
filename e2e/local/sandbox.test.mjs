import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ISOLATE, COMMIT, bundleBranch } from '../lib/bundle.mjs';
import { createSandbox, collectSandbox } from './sandbox.mjs';

const g = (args, cwd) => execFileSync('git', [...ISOLATE, ...args], { cwd, encoding: 'utf8' }).trim();
const TICKET = { title: 'Add Due Dates!', body: 'Todos get a due date.' };

function makeRepo(aiProject) {
  const dir = mkdtempSync(path.join(tmpdir(), 'adw-sandbox-'));
  const root = path.join(dir, 'proj');
  mkdirSync(root);
  g(['init', '-q', '-b', 'main'], root);
  writeFileSync(path.join(root, 'README.md'), 'hi\n');
  if (aiProject) writeFileSync(path.join(root, 'ai-project.json'), JSON.stringify(aiProject));
  g(['add', '-A'], root);
  g([...COMMIT, 'commit', '-qm', 'base'], root);
  g(['remote', 'add', 'origin', 'https://example.invalid/real.git'], root);
  return { dir, root, base: g(['rev-parse', 'HEAD'], root) };
}

const AZURE = {
  project: { name: 'Proj' }, repository: { slug: 'proj' }, git: { prTarget: 'develop' },
  ticketing: { backend: 'azure-devops', azureDevOps: { organization: 'o', project: 'p', featureType: 'Issue', bugType: 'Issue', processTemplate: 'basic', stateMapping: { new: 'To Do', 'in-progress': 'Doing', review: 'Doing' } } },
};

test('sandbox switches to the file backend, generates, and isolates the remote', () => {
  const { dir, root, base } = makeRepo(AZURE);
  try {
    const trialDir = path.join(dir, 'trial');
    const { work, origin } = createSandbox({ root, baseCommit: base, ticket: 7, ticketText: TICKET, trialDir });
    const cfg = JSON.parse(readFileSync(path.join(work, 'ai-project.json'), 'utf8'));
    assert.equal(cfg.ticketing.backend, 'file');
    assert.equal(cfg.git.prTarget, 'main');
    assert.equal(cfg.project.name, 'Proj');
    const ticket = readFileSync(path.join(work, '.tickets/issues/7_add_due_dates.md'), 'utf8');
    assert.match(ticket, /^---\ntitle: "Add Due Dates!"\nstatus: new\n---\n\nTodos get a due date\.\n$/);
    assert.ok(existsSync(path.join(work, '.claude/skills/agent-dev/SKILL.md')));
    assert.equal(g(['remote'], work), 'origin');
    assert.equal(g(['remote', 'get-url', 'origin'], work), origin);
    assert.equal(g(['rev-parse', 'main'], origin), g(['rev-parse', 'HEAD'], work));
    assert.equal(g(['status', '--porcelain'], work), '');
    assert.match(readFileSync(path.join(work, '.git/info/exclude'), 'utf8'), /^\.acpxrc\.json$/m);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the work clone takes no host template hooks and keeps only main', () => {
  const { dir, root, base } = makeRepo(null);
  try {
    // A host init.templateDir with a hook, and a root checked out on another branch.
    const template = path.join(dir, 'template');
    mkdirSync(path.join(template, 'hooks'), { recursive: true });
    writeFileSync(path.join(template, 'hooks', 'pre-commit'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
    g(['checkout', '-qb', 'develop'], root);
    const git = (args) => execFileSync('git', [...ISOLATE, '-c', `init.templateDir=${template}`, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    const { work } = createSandbox({ root, baseCommit: base, ticket: 1, ticketText: TICKET, trialDir: path.join(dir, 'trial'), git });
    assert.equal(existsSync(path.join(work, '.git', 'hooks', 'pre-commit')), false);
    assert.equal(g(['for-each-ref', '--format=%(refname:short)', 'refs/heads/'], work), 'main');
    assert.match(readFileSync(path.join(work, '.git/info/exclude'), 'utf8'), /^\.acpxrc\.json$/m);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a base commit without ai-project.json still works', () => {
  const { dir, root, base } = makeRepo(null);
  try {
    const { work } = createSandbox({ root, baseCommit: base, ticket: 1, ticketText: TICKET, trialDir: path.join(dir, 'trial') });
    const cfg = JSON.parse(readFileSync(path.join(work, 'ai-project.json'), 'utf8'));
    assert.equal(cfg.project.name, 'proj');
    assert.equal(cfg.ticketing.backend, 'file');
    assert.ok(existsSync(path.join(work, '.agents/skills/agent-dev/SKILL.md')));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('collectSandbox: no branch gives no bundle, one branch gives a bundleBranch-valid bundle', () => {
  const { dir, root, base } = makeRepo(AZURE);
  try {
    const sb = createSandbox({ root, baseCommit: base, ticket: 7, ticketText: TICKET, trialDir: path.join(dir, 'trial') });
    const none = collectSandbox({ ...sb, ticket: 7 });
    assert.deepEqual([none.branches, none.bundle, none.diff], [[], null, '']);
    assert.match(none.ticketFile, /status: new/);

    g(['checkout', '-qb', 'feat/7'], sb.work);
    writeFileSync(path.join(sb.work, 'f.txt'), 'x\n');
    g(['add', '-A'], sb.work);
    g([...COMMIT, 'commit', '-qm', 'feat'], sb.work);
    g(['push', '-q', 'origin', 'feat/7'], sb.work);
    const one = collectSandbox({ ...sb, ticket: 7 });
    assert.deepEqual(one.branches, ['feat/7']);
    assert.equal(bundleBranch(one.bundle), 'feat/7');
    assert.match(one.diff, /\+x/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
