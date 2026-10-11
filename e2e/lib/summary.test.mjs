import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarizeTrials, median } from './summary.mjs';

test('median ignores nulls', () => {
  assert.equal(median([3, null, 1, 2]), 2);
  assert.equal(median([1, 2, 3, 4]), 2.5);
  assert.equal(median([null]), null);
});

test('summary computes rates, medians and error classes', () => {
  const t = (reward, spec, tokens, agent, req, errs = {}) => ({ reward, checks: { spec_comment: spec, pr_draft: 1 },
    acceptance: reward, ownTests: 1, tokens: { total: tokens }, durations: { agent }, judge: { requirements: req },
    errors: { harbor: null, bridge: null, tool: 0, timeout: false, ...errs } });
  const s = summarizeTrials([t(1, 1, 100, 10, 5), t(0, 0, 300, 30, 3, { bridge: 'BRIDGE FAILURE: x' }), t(1, 1, 200, 20, 4)]);
  assert.equal(s.rewardRate, 0.67);
  assert.deepEqual(s.checkRates, { spec_comment: 0.67, pr_draft: 1, acceptance: 0.67, ownTests: 1 });
  assert.deepEqual(s.median, { tokens: 200, agent: 20 });
  assert.deepEqual(s.judgeMedian, { requirements: 4 });
  assert.deepEqual(s.errorClasses, ['bridge']);
});

test('a failed judge surfaces as the judge error class', () => {
  const s = summarizeTrials([{ reward: 1, checks: {}, acceptance: 1, ownTests: 1, judge: null, judgeError: 'exit 1',
    errors: { harbor: null, bridge: null, tool: 0, timeout: false } }]);
  assert.deepEqual(s.errorClasses, ['judge']);
});

test('a quota rejection surfaces as the quota error class', () => {
  const s = summarizeTrials([{ reward: 0, checks: {}, acceptance: 0, ownTests: 0, judge: null,
    errors: { harbor: 'NonZeroAgentExitCodeError', bridge: null, tool: 0, timeout: false, quota: true } }]);
  assert.deepEqual(s.errorClasses, ['harbor', 'quota']);
});
