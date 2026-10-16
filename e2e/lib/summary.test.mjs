import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarizeTrials, median } from './summary.mjs';

test('median ignores nulls', () => {
  assert.equal(median([3, null, 1, 2]), 2);
  assert.equal(median([1, 2, 3, 4]), 2.5);
  assert.equal(median([null]), null);
});

test('summary computes rates, medians, per-criterion rates and error classes', () => {
  const t = (reward, spec, tokens, agent, req, ac4, errs = {}) => ({ reward, checks: { spec_comment: spec, pr_draft: 1 },
    acceptance: reward, ownTests: 1, acceptanceCriteria: { AC1: 'pass', AC4: ac4 }, tokens: { total: tokens }, cost: tokens / 100, durations: { agent },
    review: { requirements: req }, errors: { harbor: null, bridge: null, tool: 0, timeout: false, ...errs } });
  const s = summarizeTrials([t(1, 1, 100, 10, 5, 'pass'), t(0, 0, 300, 30, 3, 'fail', { bridge: 'BRIDGE FAILURE: x' }), t(1, 1, 200, 20, 4, 'pass')]);
  assert.equal(s.rewardRate, 0.67);
  assert.deepEqual(s.checkRates, { spec_comment: 0.67, pr_draft: 1, acceptance: 0.67, ownTests: 1, 'ac:AC1': 1, 'ac:AC4': 0.67 });
  assert.deepEqual(s.median, { tokens: 200, cost: 2, agent: 20 });
  assert.deepEqual(s.reviewMedian, { requirements: 4 });
  assert.deepEqual(s.errorClasses, ['bridge']);
});

test('an unjudged trial (verifier failed) counts in no rate and surfaces as the verifier error class', () => {
  const judged = { reward: 1, checks: {}, acceptance: 1, ownTests: 1, acceptanceCriteria: { AC1: 'pass' }, review: null, errors: {} };
  const broken = { reward: null, checks: {}, acceptance: null, ownTests: 1, acceptanceCriteria: { AC1: null }, review: null,
    verifierError: 'verifier exit 1: crash', errors: {} };
  const s = summarizeTrials([judged, broken]);
  assert.equal(s.rewardRate, 1);
  assert.equal(s.checkRates.acceptance, 1);
  assert.equal(s.checkRates['ac:AC1'], 1);
  assert.deepEqual(s.errorClasses, ['verifier']);
});

test('a failed review surfaces as the judge error class; a usage limit only as quota', () => {
  const t = (o) => ({ reward: 1, checks: {}, acceptance: 1, ownTests: 1, review: null, errors: {}, ...o });
  assert.deepEqual(summarizeTrials([t({ reviewError: 'review exit 1: boom' })]).errorClasses, ['judge']);
  assert.deepEqual(summarizeTrials([t({ verifierError: 'verifier exit 1: usage_limit_reached', reviewError: 'verifier exit 1: usage_limit_reached',
    errors: { quota: true } })]).errorClasses, ['quota']);
  assert.deepEqual(summarizeTrials([t({ errors: { harbor: 'NonZeroAgentExitCodeError', quota: true } })]).errorClasses, ['harbor', 'quota']);
});

test('summary counts MCP calls and the trials that used each server', () => {
  const t = (mcp) => ({ reward: 1, checks: {}, tools: { builtin: {}, mcp } });
  const s = summarizeTrials([t({ serena: {}, playwright: { browser_navigate: 2, browser_click: 1 } }),
    t({ serena: { find_symbol: 1 }, playwright: { browser_navigate: 1 } }), { reward: 1, checks: {} }]);
  assert.deepEqual(s.mcp, { serena: { calls: 1, trials: 1 }, playwright: { calls: 4, trials: 2 } });
});
