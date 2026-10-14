// Builds one trial record (run.json schema 2 "trials" entry) from a trial dir's evidence. Acceptance
// and review verdicts come from post-verification (postverify.mjs) through applyPostVerification.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import * as metrics from './metrics.mjs';
import { ccusageUsage } from './ccusage.mjs';
import { isQuota } from './claude.mjs';

export const CONTRACT_CHECKS = ['ticket_open', 'ticket_review', 'spec_comment', 'spec_comment_complete',
  'summary_comment', 'cost_comment', 'only_allowed_comments', 'pr_draft', 'branch_naming', 'pr_title_naming',
  'e2e_performed', 'app_stopped', 'no_screenshots_in_repo'];

const DEFAULT_DEPS = { ...metrics, ccusageUsage };
const readJson = (f) => (existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null);
export const section = (comments = [], title) => comments.filter((c) => c.body.trimStart().startsWith(`## ${title}`)).map((c) => c.body).join('\n\n');

// null only when the verifier could not judge and nothing else already fails the trial: a broken verifier is no agent failure.
export const rewardOf = (t) => (t.acceptance === null && t.contract === 1 && t.ownTests === 1 ? null
  : t.contract === 1 && t.ownTests === 1 && t.acceptance === 1 ? 1 : 0);

// A trial without a PR head to verify: every criterion failed, nothing reviewed.
export function emptyOutcome(criteria) {
  return { acceptanceCriteria: Object.fromEntries(criteria.map(({ id }) => [id, 'fail'])), acceptance: 0,
    verifierError: null, review: null, reviewReasons: null, reviewError: null };
}

// A PR head exists but could not be judged (verifier or checkout broke): no verdicts, never a failed criterion.
export function unjudgedOutcome(criteria, config, error) {
  return { acceptanceCriteria: Object.fromEntries(criteria.map(({ id }) => [id, null])), acceptanceEvidence: null, acceptance: null,
    verifierError: error, review: Object.fromEntries(Object.keys(config.review.criteria).map((k) => [k, null])), reviewReasons: {}, reviewError: error };
}

export function buildTrialRecord({ id, harness, trialDir, config, criteria, deps = DEFAULT_DEPS }) {
  const result = readJson(path.join(trialDir, 'result.json')) ?? {};
  const reward = readJson(path.join(trialDir, 'verifier/reward.json'));
  const checks = Object.fromEntries(CONTRACT_CHECKS.map((c) => [c, reward?.[c] === 1 ? 1 : 0]));
  checks.e2e_performed = deps.e2ePerformed(harness, trialDir, config.app.port);
  const contract = Number((Object.values(checks).reduce((a, b) => a + b, 0) / CONTRACT_CHECKS.length).toFixed(4));
  const tokens = deps.targetTokens(harness, trialDir);
  const ccusage = deps.ccusageUsage(harness, trialDir, tokens, { version: config.ccusage?.version });
  const record = {
    id, reward: 0, contract, checks, ownTests: reward?.own_tests_pass ?? 0, ...emptyOutcome(criteria),
    durations: deps.durations(result), tokens, cost: ccusage.cost, ccusage,
    userTokens: deps.userTokens(result), errors: deps.errors(harness, trialDir, result), soft: deps.softSignals(harness, trialDir),
  };
  return { ...record, reward: rewardOf(record) };
}

// Merges a post-verification outcome into a trial; the per-criterion evidence stays in acceptance.json.
export function applyPostVerification(trial, pv) {
  const { acceptanceEvidence, ...verdicts } = pv;
  const quota = Boolean(trial.errors?.quota || isQuota(pv.verifierError) || isQuota(pv.reviewError));
  const next = { ...trial, ...verdicts, errors: { ...trial.errors, quota } };
  return { ...next, reward: rewardOf(next) };
}
