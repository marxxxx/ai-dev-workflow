// e2e/lib/fixtures/make.mjs: builds fixture trial dirs in a temp dir for tests
import { mkdirSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';

const line = (o) => `${JSON.stringify(o)}\n`;

export function makeClaudeTrial(dir) {
  const s = path.join(dir, 'agent/sessions/projects/-workspace');
  mkdirSync(path.join(s, 'abc/subagents'), { recursive: true });
  const usage = (i, o, cr, cc) => ({ input_tokens: i, output_tokens: o, cache_read_input_tokens: cr, cache_creation_input_tokens: cc });
  writeFileSync(path.join(s, 'abc.jsonl'),
    line({ type: 'assistant', message: { id: 'm1', model: 'claude-opus-5-5', usage: usage(10, 100, 1000, 50),
      content: [{ type: 'tool_use', name: 'mcp__playwright__browser_navigate', input: { url: 'http://localhost:3000/' } }] } }) +
    line({ type: 'assistant', message: { id: 'm1', model: 'claude-opus-5-5', usage: usage(10, 100, 1000, 50), content: [] } }) +
    line({ type: 'user', message: { content: [{ type: 'tool_result', is_error: true, content: 'Exit code 1' }] } }) +
    line({ type: 'assistant', message: { id: 'm2', model: 'claude-opus-5-5', usage: usage(5, 20, 500, 0),
      content: [{ type: 'text', text: 'done' }] } }) +
    'not json\n');
  writeFileSync(path.join(s, 'abc/subagents/agent-1.jsonl'),
    line({ type: 'assistant', message: { id: 's1', model: 'claude-sonnet-5-5', usage: usage(1, 10, 100, 5), content: [] } }));
  writeUserLog(dir, false);
  return dir;
}

export function makeCodexTrial(dir) {
  const s = path.join(dir, 'agent/sessions/2026/10/10');
  mkdirSync(s, { recursive: true });
  const total = (i, c, o) => ({ input_tokens: i, cached_input_tokens: c, output_tokens: o, total_tokens: i + o });
  writeFileSync(path.join(s, 'rollout-1.jsonl'),
    line({ type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: total(100, 80, 10) } } }) +
    line({ type: 'response_item', payload: { type: 'function_call', name: 'mcp__playwright__browser_navigate', arguments: '{"url":"http://127.0.0.1:3000"}' } }) +
    line({ type: 'response_item', payload: { type: 'function_call_output', output: 'failed to parse function arguments: unknown field' } }) +
    line({ type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: total(1000, 900, 50) } } }));
  writeUserLog(dir, false);
  return dir;
}

export function makeOpenCodeTrial(dir) {
  const d = path.join(dir, 'agent/opencode/xdg-data/opencode');
  mkdirSync(d, { recursive: true });
  const db = new DatabaseSync(path.join(d, 'opencode.db'));
  db.exec('create table message (id text, data text); create table part (id text, data text);');
  const msg = db.prepare('insert into message values (?, ?)');
  msg.run('1', JSON.stringify({ role: 'user' }));
  msg.run('2', JSON.stringify({ role: 'assistant', tokens: { input: 100, output: 20, reasoning: 5, cache: { read: 400, write: 0 } } }));
  msg.run('3', JSON.stringify({ role: 'assistant', tokens: { input: 50, output: 10, reasoning: 0, cache: { read: 300, write: 7 } } }));
  const part = db.prepare('insert into part values (?, ?)');
  part.run('a', JSON.stringify({ type: 'tool', tool: 'playwright_browser_navigate', state: { status: 'completed', input: { url: 'http://localhost:3000' } } }));
  part.run('b', JSON.stringify({ type: 'tool', tool: 'bash', state: { status: 'error', input: { command: 'x' } } }));
  db.close();
  writeUserLog(dir, true);
  return dir;
}

function writeUserLog(dir, bridgeFailure) {
  mkdirSync(path.join(dir, 'user-agent'), { recursive: true });
  writeFileSync(path.join(dir, 'user-agent/claude-code.txt'),
    line({ type: 'assistant', message: { content: [{ type: 'text', text: bridgeFailure ? 'BRIDGE FAILURE: Token refresh failed: 401' : 'Danke!' }] } }));
}

export const RESULT = {
  started_at: '2026-10-10T11:46:00Z', finished_at: '2026-10-10T11:52:43Z',
  environment_setup: { started_at: '2026-10-10T11:46:01Z', finished_at: '2026-10-10T11:46:15Z' },
  agent_execution: { started_at: '2026-10-10T11:46:39Z', finished_at: '2026-10-10T11:52:39Z' },
  verifier: { started_at: '2026-10-10T11:52:42Z', finished_at: '2026-10-10T11:52:43Z' },
  agent_result: { n_input_tokens: 235649, n_cache_tokens: 224706, n_output_tokens: 2072 },
  exception_info: null,
};
