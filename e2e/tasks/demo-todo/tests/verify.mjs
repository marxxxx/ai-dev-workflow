// Harbor verifier: Gitea contract checks, own tests and hidden API+UI acceptance on the PR head.
import { execFileSync, spawn } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { evaluateContract } from './checks.mjs';

const OUT = '/logs/verifier';
const TOKEN = readFileSync('/shared/token', 'utf8').trim();
const API = 'http://gitea:3000/api/v1/repos/adw/demo-todo';
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

let prDiff = ''; let ownTests = 0; let acceptance = 0;
const pr = pulls[0];
if (pr) try {
  const dir = mkdtempSync(path.join(tmpdir(), 'acc-'));
  execFileSync('git', ['clone', '-q', '-b', pr.head.ref, `http://adw:${TOKEN}@gitea:3000/adw/demo-todo.git`, dir]);
  prDiff = execFileSync('git', ['-C', dir, 'diff', 'origin/main...HEAD'], { encoding: 'utf8' });
  write('pr.diff', prDiff);
  write('pr-commits.txt', execFileSync('git', ['-C', dir, 'log', '--format=%h %s', 'origin/main..HEAD'], { encoding: 'utf8' }));
  ownTests = run(dir, 'node', ['--test']).ok ? 1 : 0;
  copyFileSync('/tests/acceptance.test.mjs', path.join(dir, 'test', 'zz-acceptance.test.mjs'));
  const api = run(dir, 'node', ['--test', '--test-reporter=tap', 'test/zz-acceptance.test.mjs']);
  write('acceptance.tap', api.out);
  const apiPass = Number(/^# pass (\d+)/m.exec(api.out)?.[1] ?? 0);
  const apiTotal = Number(/^# tests (\d+)/m.exec(api.out)?.[1] ?? 0);
  const server = spawn('node', ['src/server.mjs'], { cwd: dir, env: { ...process.env, PORT: '3100' }, stdio: 'ignore' });
  for (let i = 0; i < 50 && !(await listening('http://127.0.0.1:3100/health')); i++) await new Promise((r) => setTimeout(r, 200));
  const ui = run(dir, 'node', ['/tests/acceptance-ui.mjs', 'http://127.0.0.1:3100']);
  server.kill();
  write('acceptance-ui.txt', ui.out);
  const uiPass = (ui.out.match(/^ok - /gm) ?? []).length;
  const uiTotal = uiPass + (ui.out.match(/^not ok - /gm) ?? []).length || 3;
  acceptance = Number(((apiPass + uiPass) / (apiTotal + uiTotal)).toFixed(4));
} catch (e) {
  write('clone-error.txt', String(e.message));
  ownTests = 0; acceptance = 0;
}

const checks = evaluateContract({ issue, comments, pulls, prDiff, appListening: await listening('http://127.0.0.1:3000/health') });
const reward = { ...checks, own_tests_pass: ownTests, acceptance };
write('reward.json', reward);
write('notes.txt', Object.entries(reward).filter(([, v]) => v !== 1).map(([k, v]) => `${k}=${v}`).join('\n'));
console.log(JSON.stringify(reward, null, 2));
