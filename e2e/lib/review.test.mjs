import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from './config.mjs';
import { buildReviewPrompt, runReview, validateReviewAnswer } from './review.mjs';

const config = loadConfig();
const rubric = config.review.criteria;
const criteria = [{ id: 'AC1', text: 'A todo can get a due date.' }];
const input = { criteria, spec: 'SPEC', summary: 'SUM', diffPath: '/tmp/pv/pr.diff' };
const good = Object.fromEntries(Object.keys(rubric).map((k, i) => [k, { score: (i % 5) + 1, reason: `r-${k}` }]));

test('the review rubric has the six configured criteria', () => {
  assert.deepEqual(Object.keys(rubric), ['requirements', 'scope', 'tests', 'conventions', 'architecture', 'codeQuality']);
});

test('prompt carries rubric, criteria, spec, summary and the diff path, and points to AGENTS.md', () => {
  const p = buildReviewPrompt({ rubric, ...input });
  for (const k of Object.keys(rubric)) assert.ok(p.includes(`- ${k}: `), k);
  for (const s of ['- AC1: A todo can get a due date.', '<approved-spec>\nSPEC', '<implementation-summary>\nSUM', '/tmp/pv/pr.diff', 'AGENTS.md']) {
    assert.ok(p.includes(s), s);
  }
});

test('answer validation rejects a missing criterion and out-of-range or non-integer scores', () => {
  assert.equal(validateReviewAnswer(good, rubric).reasons.conventions, 'r-conventions');
  assert.throws(() => validateReviewAnswer({ ...good, architecture: undefined }, rubric), /architecture/);
  assert.throws(() => validateReviewAnswer({ ...good, tests: { score: 9 } }, rubric), /tests/);
  assert.throws(() => validateReviewAnswer({ ...good, scope: { score: 3.5 } }, rubric), /scope/);
});

test('runReview runs read-only in the checkout with the review model, and fails to null scores', () => {
  let seen;
  const ok = runReview({ config, checkout: '/tmp/pv/review', ...input, env: { CLAUDE_CODE_OAUTH_TOKEN: 't' },
    run: (cmd, args, o) => { seen = { cmd, args, ...o }; return { status: 0, stdout: JSON.stringify({ result: JSON.stringify(good) }) }; } });
  assert.equal(seen.cmd, 'claude');
  assert.equal(seen.cwd, '/tmp/pv/review');
  assert.equal(seen.args[seen.args.indexOf('--model') + 1], config.review.model);
  assert.equal(seen.args[seen.args.indexOf('--allowedTools') + 1], 'Read,Grep,Glob');
  assert.equal(seen.args[seen.args.indexOf('--disallowedTools') + 1], 'Bash,Edit,Write,NotebookEdit,Task,WebFetch,WebSearch');
  assert.equal(seen.args[seen.args.indexOf('--add-dir') + 1], '/tmp/pv');
  assert.ok(seen.args.includes('--strict-mcp-config'));
  assert.equal(seen.args[seen.args.indexOf('--setting-sources') + 1], 'user', 'agent-authored project settings are not loaded');
  assert.equal(seen.timeout, config.review.timeoutSec * 1000);
  assert.equal(seen.env.CLAUDE_CODE_OAUTH_TOKEN, 't');
  assert.equal(ok.error, null);
  assert.equal(ok.scores.requirements, good.requirements.score);
  const bad = runReview({ config, checkout: '/c', ...input, run: () => ({ status: 1, stdout: '', stderr: 'boom' }) });
  assert.deepEqual(bad.scores, Object.fromEntries(Object.keys(rubric).map((k) => [k, null])));
  assert.match(bad.error, /review exit 1: boom/);
});
