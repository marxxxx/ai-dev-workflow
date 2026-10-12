import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildHarborArgs, runHarbor } from './harbor.mjs';
import { loadConfig } from './config.mjs';

test('harbor args pin agent, model, version and the constrained simulated user', () => {
  const config = loadConfig();
  const a = buildHarborArgs({ config, harness: 'codex', jobName: 'codex-1', jobsDir: '/j' });
  const pair = (flag) => a[a.indexOf(flag) + 1];
  assert.equal(a[0], 'run');
  assert.equal(pair('-a'), 'agents.codex_subscription:CodexSubscription');
  assert.equal(pair('-m'), 'openai/gpt-6.1-sol');
  const pin = JSON.parse(readFileSync(new URL('../../docker/tools/inventory.json', import.meta.url), 'utf8')).npmPackages['@openai/codex'];
  assert.ok(a.includes(`version=${pin}`));
  assert.ok(a.includes('reasoning_effort=high'));
  assert.equal(pair('--user-model'), 'claude-sonnet-5-5');
  assert.ok(a.includes('disallowed_tools=Skill,Edit,Write,NotebookEdit,Task'));
  assert.equal(pair('--bridge'), 'acp');
  assert.equal(pair('--job-name'), 'codex-1');
  assert.equal(pair('-o'), '/j');
  assert.match(pair('-p'), /e2e\/tasks\/demo-todo$/);
});

test('runHarbor resolves 1 when the child emits error (e.g. harbor not installed)', async () => {
  const { EventEmitter } = await import('node:events');
  const fakeSpawn = () => {
    const child = new EventEmitter();
    queueMicrotask(() => child.emit('error', new Error('spawn harbor ENOENT')));
    return child;
  };
  assert.equal(await runHarbor({ args: ['run'], env: {}, cwd: '/tmp', spawn: fakeSpawn }), 1);
});

test('runHarbor kills the child with SIGTERM and resolves 124 when timeoutMs is exceeded', async () => {
  const { EventEmitter } = await import('node:events');
  let killed;
  const fakeSpawn = () => {
    const child = new EventEmitter();
    child.kill = (sig) => { killed = sig; };
    return child;
  };
  assert.equal(await runHarbor({ args: ['run'], env: {}, cwd: '/tmp', spawn: fakeSpawn, timeoutMs: 20 }), 124);
  assert.equal(killed, 'SIGTERM');
});

test('runHarbor on timeout unpipes the log stream, sends SIGTERM, then SIGKILL if the child does not close', async () => {
  const { EventEmitter } = await import('node:events');
  const kills = [];
  const unpiped = [];
  const stream = (name) => ({ pipe() {}, unpipe(dest) { unpiped.push([name, dest]); } });
  const child = new EventEmitter();
  child.stdout = stream('out'); child.stderr = stream('err');
  child.kill = (sig) => { kills.push(sig); };
  const logStream = { tag: 'log' };
  const code = await runHarbor({ args: ['run'], env: {}, cwd: '/tmp', spawn: () => child, logStream, timeoutMs: 10, killGraceMs: 30 });
  assert.equal(code, 124);
  assert.deepEqual(unpiped, [['out', logStream], ['err', logStream]]);
  assert.deepEqual(kills, ['SIGTERM']);
  await new Promise((r) => setTimeout(r, 60));
  assert.deepEqual(kills, ['SIGTERM', 'SIGKILL']);
});

test('runHarbor does not escalate to SIGKILL when the child closes after SIGTERM', async () => {
  const { EventEmitter } = await import('node:events');
  const kills = [];
  const child = new EventEmitter();
  child.kill = (sig) => { kills.push(sig); queueMicrotask(() => child.emit('close', null)); };
  assert.equal(await runHarbor({ args: ['run'], env: {}, cwd: '/tmp', spawn: () => child, timeoutMs: 10, killGraceMs: 30 }), 124);
  await new Promise((r) => setTimeout(r, 60));
  assert.deepEqual(kills, ['SIGTERM']);
});
