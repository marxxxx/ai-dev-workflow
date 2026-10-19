import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isInterrupt } from './claude.mjs';
import { loadConfig } from './config.mjs';
import { buildReviewPrompt, runReview, validateReviewAnswer } from './review.mjs';
import { oneShotCommand } from './llm.mjs';

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

test('runReview runs in a task container: checkout at /workspace, the diff read-only at /diff, auth by name only', () => {
  const calls = [];
  const run = (cmd, args, o) => { calls.push({ cmd, args, ...o }); return args[0] === 'run' ? { status: 0, stdout: JSON.stringify({ result: JSON.stringify(good) }) } : { status: 0 }; };
  const ok = runReview({ config, checkout: '/tmp/pv/review', ...input, env: { CLAUDE_CODE_OAUTH_TOKEN: 'sk-secret' }, image: 'img', name: 'r1', run, uid: 1000, gid: 1001 });
  const seen = calls[0];
  const { args } = seen;
  assert.equal(seen.cmd, 'docker');
  assert.deepEqual(args.slice(0, 5), ['run', '--rm', '-i', '--name', 'r1']);
  for (const e of ['HOST_UID=1000', 'HOST_GID=1001', 'E2E_VERIFY=1', 'AGENT_TOOLSTACK_ONLY=1']) assert.equal(args[args.indexOf(e) - 1], '-e', e);
  for (const k of ['CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_FORCE_OAUTH']) assert.equal(args[args.indexOf(k) - 1], '-e', `${k} by name`);
  assert.ok(!args.some((a) => a.includes('sk-secret')), 'token value on argv');
  assert.equal(seen.env.CLAUDE_CODE_OAUTH_TOKEN, 'sk-secret', 'docker inherits the token through its env');
  assert.equal(args[args.indexOf('/tmp/pv/review:/workspace:ro') - 1], '-v', 'the review checkout is read-only');
  assert.equal(args[args.indexOf('/tmp/pv:/diff:ro') - 1], '-v');
  assert.ok(args.indexOf('/tmp/pv:/diff:ro') < args.indexOf('img'), 'mounts precede the image');
  assert.equal(args[args.indexOf('claude') - 1], 'img');
  assert.equal(args[args.indexOf('--model') + 1], config.review.model);
  assert.equal(args[args.indexOf('--setting-sources') + 1], 'user', 'agent-authored project settings are not loaded');
  assert.ok(args.includes('--strict-mcp-config'));
  assert.ok(!args.includes('--mcp-config'), 'the review needs no MCP server');
  assert.equal(args[args.indexOf('--add-dir') + 1], '/diff');
  assert.equal(args[args.indexOf('--allowedTools') + 1], 'Read,Grep,Glob');
  assert.equal(args[args.indexOf('--disallowedTools') + 1], 'Bash,Edit,Write,NotebookEdit,Task,WebFetch,WebSearch');
  assert.equal(seen.timeout, config.review.timeoutSec * 1000);
  assert.ok(seen.input.includes('/diff/pr.diff') && !seen.input.includes('/tmp/pv'), 'the prompt names the container path of the diff');
  assert.deepEqual(calls.at(-1).args, ['rm', '-f', 'r1']);
  assert.equal(ok.error, null);
  assert.equal(ok.scores.requirements, good.requirements.score);
});

test('a failed review gives null scores and an error, and the container is still removed', () => {
  const calls = [];
  const run = (cmd, args) => { calls.push(args); return args[0] === 'run' ? { status: 1, stdout: '', stderr: 'boom' } : { status: 0 }; };
  const bad = runReview({ config, checkout: '/c', ...input, image: 'img', name: 'r2', run, uid: 1, gid: 1 });
  assert.deepEqual(bad.scores, Object.fromEntries(Object.keys(rubric).map((k) => [k, null])));
  assert.match(bad.error, /^review \(claude-code\): exit 1: boom$/);
  assert.deepEqual(calls.at(-1), ['rm', '-f', 'r2']);
});

test('an interrupted review run propagates instead of becoming null scores, and the container is still removed', () => {
  const calls = [];
  const run = (cmd, args) => { calls.push(args); return args[0] === 'run' ? { status: 130 } : { status: 0 }; };
  assert.throws(() => runReview({ config, checkout: '/c', ...input, image: 'img', name: 'r3', run, uid: 1, gid: 1 }), (e) => isInterrupt(e));
  assert.deepEqual(calls.at(-1), ['rm', '-f', 'r3']);
});

test('runReview hands the raw transcript to onTranscript', () => {
  const seen = [];
  const stdout = JSON.stringify({ result: JSON.stringify(good) });
  runReview({ config, checkout: '/c', ...input, image: 'img', name: 'r4', uid: 1, gid: 1, onTranscript: (s) => seen.push(s),
    run: (cmd, args) => (args[0] === 'run' ? { status: 0, stdout } : { status: 0 }) });
  assert.deepEqual(seen, [stdout]);
});

test('an opencode review runs read-only with the diff directory readable', () => {
  const calls = [];
  const ocConfig = { ...config, review: { ...config.review, harness: 'opencode', model: 'p/m' } };
  const stdout = JSON.stringify({ type: 'text', part: { type: 'text', messageID: 'm1', text: JSON.stringify(good) } });
  const r = runReview({ config: ocConfig, checkout: '/c', ...input, name: 'r5', buildArgs: ({ name, checkout, readOnly, mounts, argv, env }) => ['run', name, `${checkout}:${readOnly ? 'ro' : 'rw'}`, ...mounts, JSON.stringify(env), ...argv],
    run: (cmd, args) => { calls.push(args); return args[0] === 'run' ? { status: 0, stdout } : { status: 0 }; } });
  assert.equal(r.error, null);
  const cmd = oneShotCommand({ harness: 'opencode', model: 'p/m', tools: 'read', addDirs: ['/diff'] });
  assert.deepEqual(calls[0], ['run', 'r5', '/c:ro', '/tmp/pv:/diff:ro', JSON.stringify(cmd.env), ...cmd.argv]);
  assert.deepEqual(calls.at(-1), ['rm', '-f', 'r5']);
});
