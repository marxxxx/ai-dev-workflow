import { test } from 'node:test';
import assert from 'node:assert/strict';
import { callClaude, cliError, isInterrupt, isQuota, resultJson } from './claude.mjs';

test('resultJson takes the last JSON line and accepts a fenced answer', () => {
  const stdout = `agent runtime: trusted 1 company root certificate(s)\n${JSON.stringify({ type: 'result', result: 'Here:\n```json\n{"a":1}\n```' })}\n`;
  assert.deepEqual(resultJson(stdout), { a: 1 });
  assert.throws(() => resultJson(JSON.stringify({ result: 'no json here' })), /no JSON object/);
  assert.throws(() => resultJson('plain text'), /no claude -p JSON result/);
  assert.throws(() => resultJson(JSON.stringify({ is_error: true, api_error: 'usage_limit_reached', result: 'limit' })), /usage_limit_reached: limit/);
});

test('resultJson prefers the last fenced block over braces in the prose before it', () => {
  const answer = (result) => JSON.stringify({ type: 'result', result });
  assert.deepEqual(resultJson(answer('I ran `curl -d {"curl": 1}` and saw {"x": 2} first.\n```json\n{"criteria": []}\n```\nDone {.')), { criteria: [] });
  assert.deepEqual(resultJson(answer('```json\n{"a":1}\n```\nCorrection:\n```\n{"a":2}\n```')), { a: 2 }, 'the last block wins');
  assert.deepEqual(resultJson(answer('```json\nnot json\n```\n{"a":3}')), { a: 3 }, 'an unparsable block is skipped');
  assert.deepEqual(resultJson(answer('  {"a":4}\n')), { a: 4 });
  assert.deepEqual(resultJson(answer('Here you go: {"a":5} - hope it helps')), { a: 5 }, 'greedy match as the last resort');
  assert.throws(() => resultJson(answer('only {prose} here')), /answer holds no JSON object/);
});

test('cliError reads api_error and result from the JSON line, else returns the raw text', () => {
  assert.equal(cliError(`noise\n${JSON.stringify({ api_error: 'usage_limit_reached', result: 'x' })}`), 'usage_limit_reached: x');
  assert.equal(cliError('boom\n'), 'boom');
  assert.equal(cliError(undefined), '');
});

test('callClaude reports a usage limit hidden behind container stderr noise as quota', () => {
  const run = () => ({ status: 1, stderr: 'agent runtime: warning: something',
    stdout: JSON.stringify({ is_error: true, api_error: 'usage_limit_reached', result: "You've hit your limit" }) });
  assert.throws(() => callClaude({ args: [], label: 'verifier', timeoutMs: 1000, run }),
    (e) => isQuota(e.message) && /^verifier exit 1: /.test(e.message) && /agent runtime: warning/.test(e.message));
});

test('callClaude passes input, cwd, timeout and merged env, and names a timeout', () => {
  let seen;
  const ok = callClaude({ args: ['-p'], input: 'PROMPT', cwd: '/x', env: { A: '1' }, timeoutMs: 5000, label: 'review',
    run: (cmd, args, o) => { seen = { cmd, args, ...o }; return { status: 0, stdout: JSON.stringify({ result: '{"ok":true}' }) }; } });
  assert.deepEqual(ok, { ok: true });
  assert.equal(seen.cmd, 'claude');
  assert.deepEqual([seen.input, seen.cwd, seen.timeout, seen.env.A], ['PROMPT', '/x', 5000, '1']);
  assert.ok(seen.env.PATH);
  const timedOut = () => ({ status: null, error: Object.assign(new Error('spawnSync docker ETIMEDOUT'), { code: 'ETIMEDOUT' }) });
  assert.throws(() => callClaude({ args: [], label: 'verifier', timeoutMs: 900000, run: timedOut }), /^Error: verifier timed out after 900 s$/);
});

test('a child that ended on an interrupt is an interrupt error, not a verdict', () => {
  const call = (r) => callClaude({ args: [], label: 'verifier', timeoutMs: 1000, run: () => r });
  for (const r of [{ status: null, signal: 'SIGINT' }, { status: 130 }]) {
    assert.throws(() => call(r), (e) => isInterrupt(e) && e.signal === 'SIGINT' && e.message === 'interrupted (SIGINT)');
  }
  for (const r of [{ status: null, signal: 'SIGTERM' }, { status: 143 }]) {
    assert.throws(() => call(r), (e) => isInterrupt(e) && e.signal === 'SIGTERM' && e.message === 'interrupted (SIGTERM)');
  }
  assert.throws(() => call({ status: 1, stdout: 'boom' }), (e) => !isInterrupt(e), 'an ordinary failure is no interrupt');
  assert.equal(isInterrupt(new Error('x')), false);
  assert.equal(isInterrupt(undefined), false);
});
