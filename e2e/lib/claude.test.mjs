import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cliError, isInterrupt, isQuota, resultJson } from './claude.mjs';
import { isQuotaError } from './llm.mjs';

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

test('isQuota is the harness-neutral isQuotaError', () => {
  assert.equal(isQuota, isQuotaError);
  assert.ok(isQuota('usage_limit_reached: limit'));
});

test('the interrupt helpers stay importable from claude.mjs', () => {
  assert.equal(isInterrupt(new Error('x')), false);
  assert.equal(isInterrupt(undefined), false);
});
