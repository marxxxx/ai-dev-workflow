import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildTrialRecord, CONTRACT_CHECKS } from './trial.mjs';
import { RESULT } from './fixtures/make.mjs';

test('trial record merges verifier rewards, host e2e check, metrics and judge', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'adw-e2e-'));
  try {
    mkdirSync(path.join(dir, 'verifier'));
    writeFileSync(path.join(dir, 'result.json'), JSON.stringify(RESULT));
    const checks = Object.fromEntries(CONTRACT_CHECKS.filter((c) => c !== 'e2e_performed').map((c) => [c, 1]));
    writeFileSync(path.join(dir, 'verifier/reward.json'), JSON.stringify({ ...checks, own_tests_pass: 1, acceptance: 1 }));
    writeFileSync(path.join(dir, 'verifier/ticket.json'), JSON.stringify({ comments: [
      { body: '## Approved Spec\nSPEC' }, { body: '## Implementation Summary\nSUM' }] }));
    writeFileSync(path.join(dir, 'verifier/pr.diff'), 'DIFF');
    let judged;
    const deps = {
      targetTokens: () => ({ input: 1, output: 2, cacheRead: 3, cacheWrite: 4, total: 10 }),
      userTokens: () => ({ total: 5 }),
      durations: () => ({ setup: 1, agent: 2, verifier: 3, total: 6 }),
      errors: () => ({ harbor: null, bridge: null, tool: 0, timeout: false }),
      e2ePerformed: () => 0,
      softSignals: () => ({ superpowersActive: true }),
      ccusageCrossCheck: () => ({ ccusageTotal: 10, deviation: 0, warning: null }),
      runJudge: (a) => { judged = a; return { scores: { requirements: 5 }, reasons: { requirements: 'ok' }, error: null }; },
    };
    const t = buildTrialRecord({ id: 'codex-1', harness: 'codex', trialDir: dir, config: { app: { port: 3000 } }, briefing: 'BRIEF', env: { X: '1' }, deps });
    assert.deepEqual(judged.env, { X: '1' });
    assert.equal(t.checks.e2e_performed, 0);
    assert.equal(t.contract, Number(((CONTRACT_CHECKS.length - 1) / CONTRACT_CHECKS.length).toFixed(4)));
    assert.equal(t.reward, 0, 'missing e2e makes reward 0');
    assert.deepEqual([judged.spec, judged.summary, judged.diff, judged.briefing], ['## Approved Spec\nSPEC', '## Implementation Summary\nSUM', 'DIFF', 'BRIEF']);
    assert.equal(t.judge.requirements, 5);
    assert.equal(t.tokens.total, 10);
    assert.equal(t.errors.quota, false);
    const limited = buildTrialRecord({ id: 'codex-1', harness: 'codex', trialDir: dir, config: { app: { port: 3000 } }, briefing: 'BRIEF',
      deps: { ...deps, runJudge: () => ({ scores: { requirements: null }, reasons: {}, error: 'judge exit 1: usage_limit_reached: limit' }) } });
    assert.equal(limited.errors.quota, true, 'a usage-limited judge voids the trial too');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a trial without verifier output scores zero instead of throwing', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'adw-e2e-'));
  try {
    writeFileSync(path.join(dir, 'result.json'), JSON.stringify({ ...RESULT, exception_info: { exception_type: 'RuntimeError' } }));
    const deps = { targetTokens: () => null, userTokens: () => ({ total: 0 }), durations: () => ({}), e2ePerformed: () => 0,
      errors: () => ({ harbor: 'RuntimeError', bridge: null, tool: 0, timeout: false }), softSignals: () => ({ superpowersActive: false }),
      ccusageCrossCheck: () => ({ ccusageTotal: null, deviation: null, warning: null }),
      runJudge: () => { throw new Error('must not judge without evidence'); } };
    const t = buildTrialRecord({ id: 'x-1', harness: 'codex', trialDir: dir, config: { app: { port: 3000 } }, briefing: '', deps });
    assert.equal(t.reward, 0);
    assert.equal(t.contract, 0);
    assert.equal(t.judge, null);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a verifier ticket without comments does not throw', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'adw-e2e-'));
  try {
    mkdirSync(path.join(dir, 'verifier'));
    writeFileSync(path.join(dir, 'verifier/ticket.json'), JSON.stringify({}));
    const deps = { targetTokens: () => null, userTokens: () => ({ total: 0 }), durations: () => ({}), e2ePerformed: () => 0,
      errors: () => ({}), softSignals: () => ({}), ccusageCrossCheck: () => ({}),
      runJudge: () => ({ scores: {}, reasons: {}, error: null }) };
    const t = buildTrialRecord({ id: 'x-2', harness: 'codex', trialDir: dir, config: { app: { port: 3000 } }, briefing: '', deps });
    assert.equal(t.reward, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
