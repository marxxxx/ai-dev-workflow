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
  assert.equal(pair('--user-model'), 'claude-haiku-4-5-20251001');
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
