// Harbor verifier: Gitea contract checks and the agent's own tests on the PR head. It stores the PR
// head as a git bundle; acceptance and review run on the host from it (e2e/lib/postverify.mjs).
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { evaluateContract, runOwnTests, testCommand } from './checks.mjs';

const OUT = '/logs/verifier';
const TOKEN = readFileSync('/shared/token', 'utf8').trim();
const API = 'http://gitea:3000/api/v1/repos/adw/demo-todo';
const TEST_COMMAND = testCommand(process.env); // a task without it is misconfigured: fail loudly
const redact = (s) => String(s).split(TOKEN).join('***');
const get = async (p) => {
  const res = await fetch(`${API}${p}`, { headers: { authorization: `token ${TOKEN}` } });
  if (!res.ok) throw new Error(`${p}: HTTP ${res.status}`);
  return res.json();
};
const write = (f, d) => writeFileSync(path.join(OUT, f), redact(typeof d === 'string' ? d : JSON.stringify(d, null, 2)));
const run = (cwd, cmd, args, env = {}) => {
  try { return { ok: true, out: redact(execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: 'pipe', env: { ...process.env, ...env } })) }; }
  catch (e) { return { ok: false, out: redact(`${e.stdout ?? ''}${e.stderr ?? ''}`) }; }
};
const listening = async (url) => { try { await fetch(url, { signal: AbortSignal.timeout(1500) }); return true; } catch { return false; } };

const issue = await get('/issues/1');
const comments = await get('/issues/1/comments');
const pulls = await get('/pulls?state=all');
write('ticket.json', { issue: { state: issue.state, labels: issue.labels.map((l) => ({ name: l.name })) },
  comments: comments.map((c) => ({ body: c.body, created_at: c.created_at })) });
write('pulls.json', pulls.map((p) => ({ title: p.title, merged: p.merged, state: p.state, base: { ref: p.base.ref }, head: { ref: p.head.ref } })));

let prDiff = ''; let ownTests = 0;
const pr = pulls[0];
if (pr) try {
  const dir = mkdtempSync(path.join(tmpdir(), 'pr-'));
  execFileSync('git', ['clone', '-q', '-b', pr.head.ref, `http://adw:${TOKEN}@gitea:3000/adw/demo-todo.git`, dir]);
  prDiff = execFileSync('git', ['-C', dir, 'diff', 'origin/main...HEAD'], { encoding: 'utf8' });
  write('pr.diff', prDiff);
  write('pr-commits.txt', execFileSync('git', ['-C', dir, 'log', '--format=%h %s', 'origin/main..HEAD'], { encoding: 'utf8' }));
  // main plus the PR branch: the shape e2e/lib/bundle.mjs expects.
  execFileSync('git', ['-C', dir, 'branch', 'main', 'origin/main'], { stdio: 'pipe' });
  execFileSync('git', ['-C', dir, 'bundle', 'create', path.join(OUT, 'pr-head.bundle'), 'main', pr.head.ref], { stdio: 'pipe' });
  const tests = runOwnTests(dir, TEST_COMMAND, run);
  write('own-tests.txt', tests.out);
  ownTests = tests.pass;
} catch (e) {
  write('clone-error.txt', String(e.message));
  ownTests = 0;
}

const checks = evaluateContract({ issue, comments, pulls, prDiff, appListening: await listening('http://127.0.0.1:3000/health') });
const reward = { ...checks, own_tests_pass: ownTests };
write('reward.json', reward);
write('notes.txt', Object.entries(reward).filter(([, v]) => v !== 1).map(([k, v]) => `${k}=${v}`).join('\n'));
console.log(JSON.stringify(reward, null, 2));
