import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadLocalConfig, selfJudged } from './config.mjs';

function project(e2e) {
  const root = mkdtempSync(join(tmpdir(), 'adw-cfg-'));
  writeFileSync(join(root, 'ai-project.json'), JSON.stringify(e2e === undefined ? {} : { e2e }));
  return root;
}

test('project overrides defaults; CLI harness overrides e2e.agent', () => {
  const c = loadLocalConfig(project({ agent: { harness: 'codex', model: 'm1' }, maxTurns: 10, review: { timeoutSec: 5 } }), { harness: 'opencode' });
  assert.deepEqual(c.agent, { harness: 'opencode', model: 'm1' });
  assert.equal(c.maxTurns, 10);
  assert.equal(c.review.timeoutSec, 5);
  assert.ok(c.review.criteria.scope);
  assert.equal(c.turnTimeoutSec, 1800);
});

test('CLI model overrides the project model', () => {
  const c = loadLocalConfig(project({ agent: { harness: 'codex', model: 'm1' } }), { model: 'm2' });
  assert.deepEqual(c.agent, { harness: 'codex', model: 'm2' });
});

test('roles inherit the agent harness with a null model', () => {
  const c = loadLocalConfig(project({ agent: { harness: 'codex' } }));
  for (const role of ['answerer', 'verifier', 'review']) assert.deepEqual({ h: c[role].harness, m: c[role].model }, { h: 'codex', m: null });
  assert.equal(c.answerer.timeoutSec, 300);
});

test('an explicit role harness and model are kept', () => {
  const c = loadLocalConfig(project({ agent: { harness: 'codex' }, review: { harness: 'opencode', model: 'azure/x' } }));
  assert.equal(c.review.harness, 'opencode');
  assert.equal(c.review.model, 'azure/x');
  assert.equal(c.verifier.harness, 'codex');
});

test('a role with a model but no harness keeps the model on the agent harness', () => {
  const c = loadLocalConfig(project({ agent: { harness: 'codex', model: 'm1' }, verifier: { model: 'gpt-5-mini' } }));
  assert.equal(c.verifier.harness, 'codex');
  assert.equal(c.verifier.model, 'gpt-5-mini');
  assert.equal(c.review.model, null);
});

test('errors: unknown key, bad harness, missing harness', () => {
  assert.throws(() => loadLocalConfig(project({ bogus: 1 }), { harness: 'codex' }), /unknown e2e setting: bogus/);
  assert.throws(() => loadLocalConfig(project({ review: { harness: 'nope' } }), { harness: 'codex' }), /e2e\.review\.harness must be one of claude-code, codex, opencode/);
  assert.throws(() => loadLocalConfig(project({}), { harness: 'nope' }), /e2e\.agent\.harness must be one of/);
  assert.throws(() => loadLocalConfig(project({})), /no agent harness: pass one or set e2e\.agent\.harness/);
});

test('a project without ai-project.json uses defaults', () => {
  const c = loadLocalConfig(mkdtempSync(join(tmpdir(), 'adw-cfg-')), { harness: 'claude-code' });
  assert.equal(c.testCommand, null);
  assert.deepEqual(c.env, []);
});

test('selfJudged lists roles on the agent harness and model', () => {
  const same = loadLocalConfig(project({ agent: { harness: 'codex' } }));
  assert.deepEqual(selfJudged(same), ['verifier', 'review']);
  const mixed = loadLocalConfig(project({ agent: { harness: 'codex' }, review: { harness: 'claude-code' } }));
  assert.deepEqual(selfJudged(mixed), ['verifier']);
  const model = loadLocalConfig(project({ agent: { harness: 'codex', model: 'a' } }));
  assert.deepEqual(selfJudged(model), []);
});
