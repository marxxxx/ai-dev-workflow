import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateContract, runOwnTests, testCommand } from './checks.mjs';

const spec = `## Approved Spec\n${'x'.repeat(420)}`;
const good = {
  issue: { state: 'open', labels: [{ name: 'status:review' }] },
  comments: [{ body: spec }, { body: '## Implementation Summary\nEnd-to-end: tested with Playwright\n'
    + 'Spec: `docs/specs/s.md` (removed) · Plan: docs/plans/p.md (removed) · PR: http://pr' }, { body: '## Cost Summary\n|a|' }],
  pulls: [{ title: 'WIP: 1: Due dates', body: 'Approach: due dates.\n\nRefs #1', merged: false, base: { ref: 'main' }, head: { ref: '1_due_dates' } }],
  prDiff: 'diff --git a/src/app.mjs b/src/app.mjs\ndiff --git a/docs/architecture/architecture.md b/docs/architecture/architecture.md\n',
  appListening: false,
};

test('a correct run passes every verifier-side contract check', () => {
  const c = evaluateContract(good);
  assert.ok(Object.values(c).every((v) => v === 1), JSON.stringify(c));
  assert.equal(Object.keys(c).length, 15);
});

test('a short in-chat agreement counts as a complete spec comment', () => {
  const short = { body: '## Approved Spec\nOptional due date (date only), 400 on invalid, overdue filter.' };
  const c = evaluateContract({ ...good, comments: [short, ...good.comments.slice(1)] });
  assert.equal(c.spec_comment, 1);
  assert.equal(c.spec_comment_complete, 1);
});

test('a German summary stating the end-to-end status passes', () => {
  for (const e2e of ['Ende-zu-Ende durch den Agenten getestet', 'Ende zu Ende vom Agent getestet']) {
    const comments = [good.comments[0], { body: `## Implementation Summary\n${e2e}` }, good.comments[2]];
    assert.equal(evaluateContract({ ...good, comments }).summary_comment, 1, e2e);
  }
});

test('each deviation fails exactly its check', () => {
  const cases = [
    ['ticket_review', { issue: { state: 'open', labels: [{ name: 'status:new' }, { name: 'status:review' }] } }],
    ['ticket_open', { issue: { state: 'closed', labels: [{ name: 'status:review' }] } }],
    ['spec_comment_complete', { comments: [{ body: '## Approved Spec\n`spec.md`\n\n$(cat spec.md)' }, ...good.comments.slice(1)] }],
    ['summary_comment', { comments: [good.comments[0], { body: '## Implementation Summary\nDone.' }, good.comments[2]] }],
    ['only_allowed_comments', { comments: [...good.comments, { body: 'hello' }] }],
    ['pr_draft', { pulls: [{ ...good.pulls[0], title: '1: Due dates' }] }],
    ['branch_naming', { pulls: [{ ...good.pulls[0], head: { ref: 'feature/due' } }] }],
    ['app_stopped', { appListening: true }],
    ['no_screenshots_in_repo', { prDiff: `${good.prDiff}diff --git a/shot.png b/shot.png\nnew file mode 100644\n` }],
    ['docs_architecture', { prDiff: 'diff --git a/src/app.mjs b/src/app.mjs\n' }],
    ['spec_plan_discard', { prDiff: `${good.prDiff}diff --git a/docs/plans/p.md b/docs/plans/p.md\n` }],
    ['pr_description_clean', { pulls: [{ ...good.pulls[0], body: 'Approach.\nSpec: docs/specs/s.md' }] }],
    ['pr_description_clean', { pulls: [] }],
  ];
  for (const [check, patch] of cases) {
    const c = evaluateContract({ ...good, ...patch });
    assert.equal(c[check], 0, check);
  }
});

test('a summary naming no spec or plan has nothing to discard', () => {
  const comments = [good.comments[0], { body: '## Implementation Summary\nEnd-to-end: tested' }, good.comments[2]];
  assert.equal(evaluateContract({ ...good, comments }).spec_plan_discard, 1);
});

test('own tests run the task TEST_COMMAND in the PR checkout', () => {
  const calls = [];
  const r = runOwnTests('/tmp/pr', testCommand({ TEST_COMMAND: ' npm test ' }), (cwd, cmd, args) => { calls.push([cwd, cmd, args]); return { ok: false, out: 'boom' }; });
  assert.deepEqual(calls, [['/tmp/pr', 'bash', ['-c', 'npm test']]]);
  assert.deepEqual(r, { pass: 0, out: 'boom' });
  assert.equal(runOwnTests('/tmp/pr', 'dotnet test', () => ({ ok: true, out: '' })).pass, 1);
  assert.throws(() => testCommand({}), /TEST_COMMAND/);
  assert.throws(() => testCommand({ TEST_COMMAND: '  ' }), /TEST_COMMAND/);
});
