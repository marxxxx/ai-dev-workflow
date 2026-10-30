#!/usr/bin/env node
// adw e2e: the gh, tea and az of the e2e layer (wrappers in /usr/local/bin call `pr-cli.mjs <tool> …`).
// Opening a pull request is recorded in <git common dir>/adw-e2e/pr.jsonl and answered with a fake link, so the agent
// finishes its workflow and never reaches the real host; every other command fails. Builtins only: it runs in the container.
// A ticketing backend with a new PR command needs it here too (e2e/local/pr-fake.test.mjs checks the includes).
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const FAKED_CLIS = ['gh', 'tea', 'az'];
export const FAKE_PR_URL = 'https://adw-e2e.invalid/pull/1';
const WIP = /^(WIP:|\[WIP\])\s*/i;

// The value of the first of `names` (`--x v` or `--x=v`), or null.
function option(args, names) {
  for (let i = 0; i < args.length; i++) {
    for (const n of names) {
      if (args[i] === n && i + 1 < args.length) return args[i + 1];
      if (args[i].startsWith(`${n}=`)) return args[i].slice(n.length + 1);
    }
  }
  return null;
}

// az's --draft takes a value; bare, it means true.
function azDraft(args) {
  const i = args.findIndex((a) => a === '--draft' || a.startsWith('--draft='));
  if (i < 0) return false;
  const v = args[i].includes('=') ? args[i].split('=')[1] : args[i + 1];
  return v === undefined || v.startsWith('-') ? true : v.toLowerCase() === 'true';
}

// { draft, title, base, head } of a pull request creation, or null for any other command.
export function parsePrCreate(tool, args) {
  if (tool === 'gh' && args[0] === 'pr' && args[1] === 'create') {
    return { draft: args.includes('--draft') || args.includes('-d'), title: option(args, ['--title', '-t']),
      base: option(args, ['--base', '-B']), head: option(args, ['--head', '-H']) };
  }
  if (tool === 'tea' && ['pulls', 'pull', 'pr'].includes(args[0]) && ['create', 'c'].includes(args[1])) {
    const title = option(args, ['--title', '-t']);
    // tea has no draft flag: Gitea treats a WIP title prefix as a draft.
    return { draft: WIP.test(title ?? ''), title: title?.replace(WIP, '') ?? null, base: option(args, ['--base', '-b']), head: option(args, ['--head']) };
  }
  if (tool === 'az' && args[0] === 'repos' && args[1] === 'pr' && args[2] === 'create') {
    return { draft: azDraft(args), title: option(args, ['--title']), base: option(args, ['--target-branch', '-t']),
      head: option(args, ['--source-branch', '-s']) };
  }
  return null;
}

const ok = (stdout = '', stderr = '') => ({ status: 0, stdout, stderr });

// `prs` are the recorded creations, `branch` the checked-out one. Returns { status, stdout, stderr, record? }.
export function fakeCli(tool, args, { prs = [], branch = null } = {}) {
  if (['--version', 'version'].includes(args[0])) return ok(`${tool} version 0.0.0 (adw e2e fake)\n`);
  const pr = parsePrCreate(tool, args);
  if (pr) {
    const record = { tool, branch: pr.head ?? branch, ...pr, args };
    const out = tool === 'az' ? `${JSON.stringify({ pullRequestId: 1, isDraft: pr.draft, title: pr.title, status: 'active', url: FAKE_PR_URL })}\n` : `${FAKE_PR_URL}\n`;
    return { ...ok(out), record };
  }
  const last = prs.at(-1);
  const sub = args.slice(0, 3).join(' ');
  if (tool === 'gh') {
    if (sub.startsWith('auth status')) return ok('', 'Logged in to adw-e2e.invalid (adw e2e sandbox)\n');
    if (/^pr (view|status)\b/.test(sub)) {
      if (!last) return { status: 1, stdout: '', stderr: 'no pull requests found\n' };
      return ok(args.includes('--json') ? `${JSON.stringify({ url: FAKE_PR_URL, number: 1, isDraft: last.draft, title: last.title })}\n` : `${FAKE_PR_URL}\n`);
    }
    if (/^pr list\b/.test(sub)) return ok(last ? `1\t${last.title}\t${last.branch}\tDRAFT\n` : '');
  }
  if (tool === 'tea') {
    if (/^logins? (list|ls)\b/.test(sub)) return ok('NAME     URL                        DEFAULT\nsandbox  https://adw-e2e.invalid  true\n');
    if (/^(pulls|pull|pr)( (list|ls))?$/.test(sub)) return ok(last ? `1  ${last.title}  ${FAKE_PR_URL}\n` : '');
  }
  if (tool === 'az') {
    if (sub.startsWith('account show')) return ok(`${JSON.stringify({ name: 'adw e2e sandbox' })}\n`);
    const json = last && { pullRequestId: 1, isDraft: last.draft, title: last.title, status: 'active', url: FAKE_PR_URL };
    if (sub === 'repos pr list') return ok(`${JSON.stringify(json ? [json] : [])}\n`);
    if (sub === 'repos pr show') return json ? ok(`${JSON.stringify(json)}\n`) : { status: 1, stdout: '', stderr: 'pull request not found\n' };
  }
  return { status: 1, stdout: '', stderr: `${tool} ${args.join(' ')}: not available in the adw e2e sandbox (only opening a pull request is faked)\n` };
}

function git(args) {
  const r = spawnSync('git', args, { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : null;
}

function main([tool, ...args]) {
  // The common dir: a worktree's commits and the main checkout share it.
  const common = git(['rev-parse', '--git-common-dir']);
  const log = common && path.join(path.resolve(common), 'adw-e2e', 'pr.jsonl');
  const prs = log && existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
  const r = fakeCli(tool, args, { prs, branch: git(['rev-parse', '--abbrev-ref', 'HEAD']) });
  if (r.record) {
    if (!log) { process.stderr.write(`${tool}: not a git repository\n`); return 1; }
    mkdirSync(path.dirname(log), { recursive: true });
    appendFileSync(log, `${JSON.stringify(r.record)}\n`);
  }
  process.stdout.write(r.stdout);
  process.stderr.write(r.stderr);
  return r.status;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) process.exitCode = main(process.argv.slice(2));
