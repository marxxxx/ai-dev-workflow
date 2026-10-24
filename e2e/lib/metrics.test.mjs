import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { targetTokens, userTokens, durations, errors, e2ePerformed, showMeRead, softSignals, toolUsage } from './metrics.mjs';
import { makeClaudeTrial, makeCodexTrial, makeOpenCodeTrial, RESULT } from './fixtures/make.mjs';

const tmp = () => mkdtempSync(path.join(tmpdir(), 'adw-e2e-'));

test('claude tokens dedupe message ids and include subagents', () => {
  const dir = makeClaudeTrial(tmp());
  try {
    assert.deepEqual(targetTokens('claude-code', dir),
      { input: 16, output: 130, cacheRead: 1600, cacheWrite: 55, total: 1801 });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('codex tokens use the last token_count event of a rollout', () => {
  const dir = makeCodexTrial(tmp());
  try {
    assert.deepEqual(targetTokens('codex', dir),
      { input: 100, output: 50, cacheRead: 900, cacheWrite: 0, total: 1050 });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('codex tokens sum the last token_count of every rollout file (subagent sessions)', () => {
  const dir = makeCodexTrial(tmp());
  try {
    const total = { input_tokens: 200, cached_input_tokens: 150, output_tokens: 5, total_tokens: 205 };
    const line = (o) => `${JSON.stringify(o)}\n`;
    writeFileSync(path.join(dir, 'agent/sessions/2026/10/10/rollout-2.jsonl'),
      line({ type: 'session_meta', payload: { source: { subagent: {} } } }) +
      line({ type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: total } } }));
    assert.deepEqual(targetTokens('codex', dir),
      { input: 150, output: 55, cacheRead: 1050, cacheWrite: 0, total: 1255 });
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
    assert.deepEqual(errors('claude-code', c, RESULT), { harbor: null, bridge: null, tool: 1, timeout: false, quota: false });
    const e = errors('opencode', o, { ...RESULT, exception_info: { exception_type: 'AgentTimeoutError', exception_message: 'x' } });
    assert.equal(e.bridge, 'BRIDGE FAILURE: Token refresh failed: 401');
    assert.equal(e.tool, 1);
    assert.equal(e.timeout, true);
    assert.equal(e.harbor, 'AgentTimeoutError');
  } finally { rmSync(c, { recursive: true, force: true }); rmSync(o, { recursive: true, force: true }); }
});

test('errors flag a usage-limit rejection of the subscription as quota', () => {
  const c = makeClaudeTrial(tmp());
  try {
    appendFileSync(path.join(c, 'user-agent/claude-code.txt'),
      `${JSON.stringify({ type: 'result', is_error: true, api_error_status: 429, api_error: 'usage_limit_reached', result: "You've hit your session limit" })}\n`);
    assert.equal(errors('claude-code', c, RESULT).quota, true);
  } finally { rmSync(c, { recursive: true, force: true }); }
});

test('errors flag a Codex usage-limit rejection in the ACP bridge trajectory as quota', () => {
  const c = makeCodexTrial(tmp());
  try {
    assert.equal(errors('codex', c, RESULT).quota, false);
    writeFileSync(path.join(c, 'agent/bridge-trajectory.json'), JSON.stringify([{ jsonrpc: '2.0', id: 3, error: { code: -32603,
      message: 'Internal error', data: { message: 'Your workspace is out of credits.', codexErrorInfo: 'usageLimitExceeded' } } }], null, 2));
    assert.equal(errors('codex', c, RESULT).quota, true);
  } finally { rmSync(c, { recursive: true, force: true }); }
});

test('e2ePerformed detects Playwright navigation to the app port in every harness', () => {
  const dirs = [['claude-code', makeClaudeTrial(tmp())], ['codex', makeCodexTrial(tmp())], ['opencode', makeOpenCodeTrial(tmp())]];
  try {
    for (const [h, d] of dirs) {
      assert.equal(e2ePerformed(h, d, 3000), 1, h);
      assert.equal(e2ePerformed(h, d, 4000), 0, h);
      assert.equal(e2ePerformed(h, d, 30001), 0, h);
      assert.equal(e2ePerformed(h, d, 300), 0, h);
    }
  } finally { for (const [, d] of dirs) rmSync(d, { recursive: true, force: true }); }
});

test('showMeRead detects a read of the show-me SKILL.md in every harness', () => {
  const makers = [['claude-code', makeClaudeTrial], ['codex', makeCodexTrial], ['opencode', makeOpenCodeTrial]];
  const dirs = [];
  try {
    for (const [h, make] of makers) {
      const without = make(tmp());
      const withRead = make(tmp(), { read: '.agents/skills/show-me/SKILL.md' });
      const other = make(tmp(), { read: '.agents/skills/agent-dev/SKILL.md' });
      dirs.push(without, withRead, other);
      assert.equal(showMeRead(h, without), 0, h);
      assert.equal(showMeRead(h, withRead), 1, h);
      assert.equal(showMeRead(h, other), 0, h);
    }
  } finally { for (const d of dirs) rmSync(d, { recursive: true, force: true }); }
});

test('softSignals reports the superpowers bootstrap', () => {
  const dir = makeClaudeTrial(tmp());
  try {
    assert.deepEqual(softSignals('claude-code', dir), { superpowersActive: false });
    appendFileSync(path.join(dir, 'agent/sessions/projects/-workspace/abc.jsonl'),
      `${JSON.stringify({ type: 'user', message: { content: [{ type: 'text', text: 'skills/using-superpowers/SKILL.md' }] } })}\n`);
    assert.deepEqual(softSignals('claude-code', dir), { superpowersActive: true });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('e2ePerformed ignores navigation to another host on the same port', () => {
  const dir = makeClaudeTrial(tmp());
  try {
    const nav = (url) => `${JSON.stringify({ type: 'assistant', message: { id: 'n', content: [{ type: 'tool_use', name: 'mcp__playwright__browser_navigate', input: { url } }] } })}\n`;
    writeFileSync(path.join(dir, 'agent/sessions/projects/-workspace/abc.jsonl'), nav('http://gitea:3000/adw/demo-todo'));
    assert.equal(e2ePerformed('claude-code', dir, 3000), 0);
    writeFileSync(path.join(dir, 'agent/sessions/projects/-workspace/abc.jsonl'), nav('http://0.0.0.0:3000/'));
    assert.equal(e2ePerformed('claude-code', dir, 3000), 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

const SERVERS = ['serena', 'playwright', 'context7'];

test('toolUsage counts claude built-ins and MCP calls per server, listing unused servers', () => {
  const dir = makeClaudeTrial(tmp());
  try {
    appendFileSync(path.join(dir, 'agent/sessions/projects/-workspace/abc.jsonl'),
      `${JSON.stringify({ type: 'assistant', message: { id: 'm3', content: [
        { type: 'tool_use', name: 'mcp__acp__Bash', input: {} }, { type: 'tool_use', name: 'Skill', input: {} },
        { type: 'tool_use', name: 'mcp__playwright__browser_navigate', input: {} }, { type: 'tool_use', name: 'mcp__other__ping', input: {} }] } })}\n`);
    assert.deepEqual(toolUsage('claude-code', dir, SERVERS), {
      builtin: { Bash: 1, Skill: 1 },
      mcp: { serena: {}, playwright: { browser_navigate: 2 }, context7: {}, other: { ping: 1 } } });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('toolUsage reads codex MCP calls from completed items, also inside code-mode exec', () => {
  const dir = makeCodexTrial(tmp());
  try {
    const item = (i) => `${JSON.stringify({ type: 'event_msg', payload: { type: 'item_completed', item: i } })}\n`;
    appendFileSync(path.join(dir, 'agent/sessions/2026/10/10/rollout-1.jsonl'),
      item({ type: 'McpToolCall', server: 'serena', tool: 'initial_instructions' }) +
      item({ type: 'McpToolCall', server: 'serena', tool: 'find_symbol' }) +
      item({ type: 'CommandExecution', command: ['bash'] }) + item({ type: 'FileChange' }) +
      item({ type: 'AgentMessage' }) + item({ type: 'Reasoning' }) + item({ type: 'UserMessage' }));
    assert.deepEqual(toolUsage('codex', dir, SERVERS), {
      builtin: { CommandExecution: 1, FileChange: 1 },
      mcp: { serena: { initial_instructions: 1, find_symbol: 1 }, playwright: {}, context7: {} } });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('toolUsage splits opencode tool names at the configured server prefixes', () => {
  const dir = makeOpenCodeTrial(tmp());
  try {
    assert.deepEqual(toolUsage('opencode', dir, SERVERS), {
      builtin: { bash: 1 }, mcp: { serena: {}, playwright: { browser_navigate: 1 }, context7: {} } });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('toolUsage of a trial without session logs lists the configured servers unused', () => {
  const dir = tmp();
  try { assert.deepEqual(toolUsage('codex', dir, ['serena']), { builtin: {}, mcp: { serena: {} } }); }
  finally { rmSync(dir, { recursive: true, force: true }); }
});
