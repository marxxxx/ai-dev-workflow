import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { targetTokens, userTokens, durations, errors } from './metrics.mjs';
import { makeClaudeTrial, makeCodexTrial, makeOpenCodeTrial, RESULT } from './fixtures/make.mjs';

const tmp = () => mkdtempSync(path.join(tmpdir(), 'adw-e2e-'));

test('claude tokens dedupe message ids and include subagents', () => {
  const dir = makeClaudeTrial(tmp());
  try {
    assert.deepEqual(targetTokens('claude-code', dir),
      { input: 16, output: 130, cacheRead: 1600, cacheWrite: 55, total: 1801 });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('codex tokens use the last token_count event', () => {
  const dir = makeCodexTrial(tmp());
  try {
    assert.deepEqual(targetTokens('codex', dir),
      { input: 100, output: 50, cacheRead: 900, cacheWrite: 0, total: 1050 });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('opencode tokens sum assistant messages, reasoning counts as output', () => {
  const dir = makeOpenCodeTrial(tmp());
  try {
    assert.deepEqual(targetTokens('opencode', dir),
      { input: 150, output: 35, cacheRead: 700, cacheWrite: 7, total: 892 });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('missing session data yields null tokens', () => {
  const dir = tmp();
  try { assert.equal(targetTokens('codex', dir), null); }
  finally { rmSync(dir, { recursive: true, force: true }); }
});

test('durations come from result.json phases', () => {
  assert.deepEqual(durations(RESULT), { setup: 14, agent: 360, verifier: 1, total: 403 });
});

test('userTokens reads agent_result', () => {
  assert.deepEqual(userTokens(RESULT), { total: 235649 + 2072 });
});

test('errors count tool errors and detect bridge failure', () => {
  const c = makeClaudeTrial(tmp()), o = makeOpenCodeTrial(tmp());
  try {
    assert.deepEqual(errors('claude-code', c, RESULT), { harbor: null, bridge: null, tool: 1, timeout: false });
    const e = errors('opencode', o, { ...RESULT, exception_info: { exception_type: 'AgentTimeoutError', exception_message: 'x' } });
    assert.equal(e.bridge, 'BRIDGE FAILURE: Token refresh failed: 401');
    assert.equal(e.tool, 1);
    assert.equal(e.timeout, true);
    assert.equal(e.harbor, 'AgentTimeoutError');
  } finally { rmSync(c, { recursive: true, force: true }); rmSync(o, { recursive: true, force: true }); }
});
