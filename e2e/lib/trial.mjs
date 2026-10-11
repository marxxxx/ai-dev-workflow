// Builds one trial record (the spec's run.json "trials" entry) from a trial dir's evidence.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import * as metrics from './metrics.mjs';
import { ccusageCrossCheck } from './ccusage.mjs';
import { runJudge } from './judge.mjs';

export const CONTRACT_CHECKS = ['ticket_open', 'ticket_review', 'spec_comment', 'spec_comment_complete',
  'summary_comment', 'cost_comment', 'only_allowed_comments', 'pr_draft', 'branch_naming', 'pr_title_naming',
  'e2e_performed', 'app_stopped', 'no_screenshots_in_repo'];

const DEFAULT_DEPS = { ...metrics, ccusageCrossCheck, runJudge };
const readJson = (f) => (existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null);
const readText = (f) => (existsSync(f) ? readFileSync(f, 'utf8') : '');
const section = (comments = [], title) => comments.filter((c) => c.body.trimStart().startsWith(`## ${title}`)).map((c) => c.body).join('\n\n');

export function buildTrialRecord({ id, harness, trialDir, config, briefing, env, deps = DEFAULT_DEPS }) {
  const result = readJson(path.join(trialDir, 'result.json')) ?? {};
  const reward = readJson(path.join(trialDir, 'verifier/reward.json'));
  const ticket = readJson(path.join(trialDir, 'verifier/ticket.json'));
  const checks = Object.fromEntries(CONTRACT_CHECKS.map((c) => [c, reward?.[c] === 1 ? 1 : 0]));
  checks.e2e_performed = deps.e2ePerformed(harness, trialDir, config.app.port);
  const contract = Number((Object.values(checks).reduce((a, b) => a + b, 0) / CONTRACT_CHECKS.length).toFixed(4));
  const acceptance = reward?.acceptance ?? 0;
  const ownTests = reward?.own_tests_pass ?? 0;
  const tokens = deps.targetTokens(harness, trialDir);
  let judge = null; let judgeReasons = null; let judgeError = null;
  if (ticket) {
    const j = deps.runJudge({ config, briefing, env, spec: section(ticket.comments, 'Approved Spec'),
      diff: readText(path.join(trialDir, 'verifier/pr.diff')), summary: section(ticket.comments, 'Implementation Summary') });
    judge = j.scores; judgeReasons = j.reasons; judgeError = j.error;
  }
  const errors = deps.errors(harness, trialDir, result);
  errors.quota = Boolean(errors.quota || /usage_limit_reached/.test(judgeError ?? ''));
  return {
    id, reward: contract === 1 && ownTests === 1 && acceptance === 1 ? 1 : 0, contract, checks, acceptance, ownTests,
    judge, judgeReasons, judgeError, durations: deps.durations(result), tokens,
    ccusage: deps.ccusageCrossCheck(harness, trialDir, tokens), userTokens: deps.userTokens(result),
    errors, soft: deps.softSignals(harness, trialDir),
  };
}
