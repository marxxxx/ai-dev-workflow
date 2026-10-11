import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildJudgePrompt, parseJudgeOutput, runJudge } from './judge.mjs';
import { tmpdir } from 'node:os';
import { loadConfig } from './config.mjs';

const config = loadConfig();
const { criteria } = config.judge;
const input = { briefing: 'B', spec: 'S', diff: 'D', summary: 'U' };
const good = { requirements: { score: 5, reason: 'r1' }, scope: { score: 4, reason: 'r2' },
  tests: { score: 3, reason: 'r3' }, readability: { score: 5, reason: 'r4' } };

test('prompt contains every criterion and all inputs', () => {
  const p = buildJudgePrompt({ criteria, ...input });
  for (const k of Object.keys(criteria)) assert.ok(p.includes(k));
  for (const tag of ['<briefing>\nB', '<spec>\nS', '<diff>\nD', '<summary>\nU']) assert.ok(p.includes(tag), tag);
});

test('parse accepts claude -p json with a fenced JSON result', () => {
  const stdout = JSON.stringify({ type: 'result', result: `Here:\n\`\`\`json\n${JSON.stringify(good)}\n\`\`\`` });
  assert.deepEqual(parseJudgeOutput(stdout, criteria), {
    scores: { requirements: 5, scope: 4, tests: 3, readability: 5 },
    reasons: { requirements: 'r1', scope: 'r2', tests: 'r3', readability: 'r4' } });
});

test('parse rejects missing criteria and out-of-range scores', () => {
  const wrap = (o) => JSON.stringify({ result: JSON.stringify(o) });
  assert.throws(() => parseJudgeOutput(wrap({ ...good, scope: undefined }), criteria), /scope/);
  assert.throws(() => parseJudgeOutput(wrap({ ...good, tests: { score: 9, reason: 'x' } }), criteria), /tests/);
});

test('runJudge calls claude -p with the judge model and returns null scores on failure', () => {
  let args; let opts;
  const ok = runJudge({ config, ...input, env: { CLAUDE_CODE_OAUTH_TOKEN: 'tok' }, run: (cmd, a, o) => { args = [cmd, ...a]; opts = o; return { status: 0, stdout: JSON.stringify({ result: JSON.stringify(good) }) }; } });
  assert.equal(args[0], 'claude');
  assert.deepEqual(args.slice(1, 5), ['-p', '--model', 'claude-opus-5-5', '--output-format']);
  assert.equal(args[args.indexOf('--disallowedTools') + 1], 'Bash,Edit,Write,Read,Glob,Grep,WebFetch,WebSearch,Task,NotebookEdit');
  assert.equal(opts.env.CLAUDE_CODE_OAUTH_TOKEN, 'tok');
  assert.ok(opts.env.PATH);
  assert.equal(opts.cwd, tmpdir());
  assert.equal(opts.timeout, 600000);
  assert.equal(ok.scores.requirements, 5);
  assert.equal(ok.error, null);
  const bad = runJudge({ config, ...input, run: () => ({ status: 1, stdout: '', stderr: 'boom' }) });
  assert.deepEqual(bad.scores, { requirements: null, scope: null, tests: null, readability: null });
  assert.match(bad.error, /boom/);
  const limited = runJudge({ config, ...input, run: () => ({ status: 1, stderr: '',
    stdout: JSON.stringify({ is_error: true, api_error: 'usage_limit_reached', result: "You've hit your session limit" }) }) });
  assert.match(limited.error, /usage_limit_reached: You've hit your session limit/);
});
