import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { applyPostVerification, buildTrialRecord, CONTRACT_CHECKS, emptyOutcome, rewardOf, section, unjudgedOutcome } from './trial.mjs';
import { RESULT } from './fixtures/make.mjs';

const criteria = [{ id: 'AC1', text: 'a' }, { id: 'AC2', text: 'b' }];
const config = { app: { port: 3000 }, mcpServers: ['serena'] };
const DEPS = {
  targetTokens: () => ({ input: 1, output: 2, cacheRead: 3, cacheWrite: 4, total: 10 }),
  userTokens: () => ({ total: 5 }),
  durations: () => ({ setup: 1, agent: 2, verifier: 3, total: 6 }),
  errors: () => ({ harbor: null, bridge: null, tool: 0, timeout: false, quota: false }),
  e2ePerformed: () => 1,
  showMeRead: () => 1,
  softSignals: () => ({ superpowersActive: true }),
  toolUsage: (h, d, servers) => ({ builtin: { Bash: 2 }, mcp: Object.fromEntries(servers.map((s) => [s, {}])) }),
  ccusageUsage: () => ({ ccusageTotal: 10, deviation: 0, warning: null, cost: 0.42, models: {} }),
};

test('trial record merges verifier rewards, host e2e check and metrics; acceptance waits for post-verification', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'adw-e2e-'));
  try {
    mkdirSync(path.join(dir, 'verifier'));
    writeFileSync(path.join(dir, 'result.json'), JSON.stringify(RESULT));
    const checks = Object.fromEntries(CONTRACT_CHECKS.filter((c) => !['e2e_performed', 'show_me_read'].includes(c)).map((c) => [c, 1]));
    writeFileSync(path.join(dir, 'verifier/reward.json'), JSON.stringify({ ...checks, own_tests_pass: 1 }));
    const t = buildTrialRecord({ id: 'codex-1', harness: 'codex', trialDir: dir, config, criteria, deps: { ...DEPS, e2ePerformed: () => 0 } });
    assert.equal(t.checks.e2e_performed, 0);
    assert.equal(t.contract, Number(((CONTRACT_CHECKS.length - 1) / CONTRACT_CHECKS.length).toFixed(4)));
    assert.equal(t.ownTests, 1);
    assert.deepEqual(t.acceptanceCriteria, { AC1: 'fail', AC2: 'fail' });
    assert.equal(t.acceptance, 0);
    assert.equal(t.review, null);
    assert.equal(t.reward, 0);
    assert.equal(t.tokens.total, 10);
    assert.equal(t.cost, 0.42);
    assert.equal(t.errors.quota, false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('post-verification sets verdicts and reward; a usage limit in either role marks quota', () => {
  const base = { id: 'x', contract: 1, ownTests: 1, checks: {}, ...emptyOutcome(criteria), errors: { harbor: null, quota: false } };
  const pv = { acceptanceCriteria: { AC1: 'pass', AC2: 'pass' }, acceptanceEvidence: { AC1: 'e', AC2: 'e' }, acceptance: 1,
    verifierError: null, review: { scope: 5 }, reviewReasons: { scope: 'ok' }, reviewError: null };
  const t = applyPostVerification(base, pv);
  assert.equal(t.reward, 1);
  assert.deepEqual(t.review, { scope: 5 });
  assert.equal('acceptanceEvidence' in t, false, 'evidence stays in acceptance.json');
  assert.equal(applyPostVerification({ ...base, ownTests: 0 }, pv).reward, 0);
  const unjudged = applyPostVerification(base, { ...pv, acceptanceCriteria: { AC1: null, AC2: null }, acceptance: null,
    verifierError: 'verifier exit 1: usage_limit_reached: x' });
  assert.equal(unjudged.errors.quota, true);
  assert.equal(unjudged.reward, null, 'an unjudged trial has no reward');
  assert.equal(applyPostVerification(base, { ...pv, reviewError: 'review exit 1: usage_limit_reached' }).errors.quota, true);
});

test('an unjudged trial has a reward only while nothing already forces zero', () => {
  const unjudged = { acceptance: null, contract: 1, ownTests: 1 };
  assert.equal(rewardOf(unjudged), null, 'a broken verifier is no agent failure');
  assert.equal(rewardOf({ ...unjudged, ownTests: 0 }), 0, 'failing own tests already fail the trial');
  assert.equal(rewardOf({ ...unjudged, contract: 0.9231 }), 0, 'a contract miss already fails the trial');
  assert.equal(rewardOf({ acceptance: 1, contract: 1, ownTests: 1 }), 1);
  assert.equal(rewardOf({ acceptance: 0.5, contract: 1, ownTests: 1 }), 0);
  assert.equal(rewardOf({ acceptance: 1, contract: 1, ownTests: null }), 1, 'no own tests to run (local runs without testCommand)');
  assert.equal(rewardOf({ ...unjudged, ownTests: null }), null);
});

test('unjudgedOutcome leaves every verdict null and carries the error for both roles', () => {
  const cfg = { review: { criteria: { scope: 'q', tests: 'q' } } };
  assert.deepEqual(unjudgedOutcome(criteria, cfg, 'no PR-head bundle (see clone-error.txt)'), {
    acceptanceCriteria: { AC1: null, AC2: null }, acceptanceEvidence: null, acceptance: null,
    verifierError: 'no PR-head bundle (see clone-error.txt)', review: { scope: null, tests: null }, reviewReasons: {},
    reviewError: 'no PR-head bundle (see clone-error.txt)' });
  const base = { id: 'x', contract: 1, ownTests: 1, checks: {}, ...emptyOutcome(criteria), errors: { harbor: null, quota: false } };
  assert.equal(applyPostVerification(base, unjudgedOutcome(criteria, cfg, 'e')).reward, null);
  assert.equal(applyPostVerification({ ...base, ownTests: 0 }, unjudgedOutcome(criteria, cfg, 'e')).reward, 0);
});

test('section joins every comment that starts with the heading', () => {
  assert.equal(section([{ body: '## Approved Spec\nA' }, { body: 'x' }, { body: '  ## Approved Spec\nB' }], 'Approved Spec'),
    '## Approved Spec\nA\n\n  ## Approved Spec\nB');
  assert.equal(section(undefined, 'Approved Spec'), '');
});

test('a trial without verifier output scores zero instead of throwing', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'adw-e2e-'));
  try {
    writeFileSync(path.join(dir, 'result.json'), JSON.stringify({ ...RESULT, exception_info: { exception_type: 'RuntimeError' } }));
    const t = buildTrialRecord({ id: 'x-1', harness: 'codex', trialDir: dir, config, criteria,
      deps: { ...DEPS, targetTokens: () => null, e2ePerformed: () => 0, showMeRead: () => 0, errors: () => ({ harbor: 'RuntimeError', bridge: null, tool: 0, timeout: false }) } });
    assert.equal(t.reward, 0);
    assert.equal(t.contract, 0);
    assert.equal(t.acceptance, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('trial record carries the tool usage for the configured MCP servers', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'adw-e2e-'));
  try {
    const t = buildTrialRecord({ id: 'codex-1', harness: 'codex', trialDir: dir, config, criteria, deps: DEPS });
    assert.deepEqual(t.tools, { builtin: { Bash: 2 }, mcp: { serena: {} } });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
