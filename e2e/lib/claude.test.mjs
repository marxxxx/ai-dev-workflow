import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildClaudeDockerArgs, callClaude, cliError, isInterrupt, isQuota, resultJson } from './claude.mjs';

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

test('resultJson says what the answer was when it holds no JSON object', () => {
  const answer = (result) => JSON.stringify({ type: 'result', result });
  assert.throws(() => resultJson(answer('I could not\n  decide.\n\nThe  criteria are unclear.')),
    (e) => e.message === 'answer holds no JSON object; answer ends: "I could not decide. The criteria are unclear."');
  const long = `HEAD-${'x'.repeat(600)}-TAIL`;
  assert.throws(() => resultJson(answer(long)), (e) => e.message.endsWith(`answer ends: "${long.slice(-500)}"`) && !e.message.includes('HEAD-'));
  assert.throws(() => resultJson(answer(' \n ')), (e) => e.message === 'answer holds no JSON object; answer was empty');
  assert.throws(() => resultJson(JSON.stringify({ type: 'result' })), (e) => e.message === 'answer holds no JSON object; answer was empty');
});

test('resultJson pairs fences by their info string: a block in another language does not shift the pairing', () => {
  const answer = (result) => JSON.stringify({ type: 'result', result });
  assert.deepEqual(resultJson(answer('I ran:\n```bash\ncurl -d \'{ }\' http://x\n```\nThen the answer:\n```json\n{"a":6}\n```')), { a: 6 });
  assert.deepEqual(resultJson(answer('```json\n{"a":7}\n```\nand then\n```bash\n{"a":8}\n```')), { a: 7 }, 'a JSON-looking block in another language is no answer');
  assert.deepEqual(resultJson(answer('```JSON\n{"a":9}\n```')), { a: 9 });
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

test('callClaude hands the raw output to onStdout before it parses, so an unparsable answer keeps its transcript', () => {
  const seen = [];
  const stream = `${JSON.stringify({ type: 'assistant', message: 'tool call' })}\n${JSON.stringify({ type: 'result', result: 'no json' })}\n`;
  assert.throws(() => callClaude({ args: [], label: 'verifier', timeoutMs: 1000, onStdout: (s) => seen.push(s), run: () => ({ status: 0, stdout: stream }) }),
    /answer holds no JSON object/);
  assert.deepEqual(seen, [stream]);
  assert.throws(() => callClaude({ args: [], label: 'verifier', timeoutMs: 1000, onStdout: (s) => seen.push(s), run: () => ({ status: 1, stdout: 'boom' }) }), /exit 1/);
  assert.deepEqual(seen, [stream, 'boom'], 'a failed call keeps its output too');
  assert.deepEqual(callClaude({ args: [], label: 'review', timeoutMs: 1000, run: () => ({ status: 0, stdout: stream.replace('no json', '{\\"a\\":1}') }) }), { a: 1 },
    'the result line of a stream-json transcript is the answer');
});

test('buildClaudeDockerArgs asks for the stream-json transcript', () => {
  const args = buildClaudeDockerArgs({ image: 'i', name: 'n', checkout: '/c', model: 'm', uid: 1, gid: 1, claudeArgs: [] });
  assert.deepEqual(args.slice(args.indexOf('--output-format'), args.indexOf('--output-format') + 3), ['--output-format', 'stream-json', '--verbose']);
});
