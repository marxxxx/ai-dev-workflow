// Host-side metrics from a Harbor trial directory. Target tokens come from the agent's native
// session logs, because Harbor's own numbers cover the simulated user or only the last turn.
import { existsSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { readJsonl, walk } from './fsutil.mjs';

const zero = () => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 });
const finish = (t) => ({ ...t, total: t.input + t.output + t.cacheRead + t.cacheWrite });

export function claudeEvents(trialDir) {
  return walk(path.join(trialDir, 'agent/sessions/projects'))
    .filter((f) => f.endsWith('.jsonl')).flatMap(readJsonl);
}
export function codexEvents(trialDir) {
  return walk(path.join(trialDir, 'agent/sessions'))
    .filter((f) => /rollout-.*\.jsonl$/.test(f)).sort().flatMap(readJsonl);
}
// OpenCode 2 keeps messages in session_message, each assistant one with its tool calls in `content`.
function openCodeRows(trialDir) {
  const file = path.join(trialDir, 'agent/opencode/xdg-data/opencode/opencode.db');
  if (!existsSync(file)) return { messages: [] };
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const messages = db.prepare('select type, data from session_message order by seq').all()
      .map((r) => ({ ...JSON.parse(r.data), role: r.type }));
    return { messages };
  } finally { db.close(); }
}

// Every opencode tool call as {name, status, input}.
function openCodeTools(trialDir) {
  return openCodeRows(trialDir).messages.flatMap((m) => m.content ?? []).filter((c) => c.type === 'tool')
    .map((c) => ({ name: c.name, status: c.state?.status, input: c.state?.input ?? {} }));
}

// The entry skills agent-dev names; loading one of them is the proof that superpowers is active.
export const SUPERPOWERS_ENTRY_SKILLS = ['brainstorming', 'writing-plans'];

export function targetTokens(harness, trialDir) {
  if (harness === 'claude-code') {
    const events = claudeEvents(trialDir);
    if (!events.length) return null;
    const seen = new Set(); const t = zero();
    for (const e of events) {
      const m = e.message;
      if (e.type !== 'assistant' || !m?.usage || seen.has(m.id)) continue;
      seen.add(m.id);
      t.input += m.usage.input_tokens ?? 0; t.output += m.usage.output_tokens ?? 0;
      t.cacheRead += m.usage.cache_read_input_tokens ?? 0; t.cacheWrite += m.usage.cache_creation_input_tokens ?? 0;
    }
    return finish(t);
  }
  if (harness === 'codex') {
    // One rollout per session; subagents get their own file, so sum the last cumulative total of each.
    const t = zero(); let any = false;
    for (const f of walk(path.join(trialDir, 'agent/sessions')).filter((f) => /rollout-.*\.jsonl$/.test(f))) {
      const last = readJsonl(f)
        .filter((e) => e.type === 'event_msg' && e.payload?.type === 'token_count' && e.payload.info)
        .at(-1)?.payload.info.total_token_usage;
      if (!last) continue;
      any = true;
      t.input += last.input_tokens - last.cached_input_tokens; t.output += last.output_tokens;
      t.cacheRead += last.cached_input_tokens;
    }
    return any ? finish(t) : null;
  }
  if (harness === 'opencode') {
    const msgs = openCodeRows(trialDir).messages.filter((m) => m.role === 'assistant');
    if (!msgs.length) return null;
    const t = zero();
    for (const { tokens: k = {} } of msgs) {
      t.input += k.input ?? 0; t.output += (k.output ?? 0) + (k.reasoning ?? 0);
      t.cacheRead += k.cache?.read ?? 0; t.cacheWrite += k.cache?.write ?? 0;
    }
    return finish(t);
  }
  throw new Error(`unknown harness: ${harness}`);
}

export function userTokens(result) {
  const a = result.agent_result ?? {};
  return { total: (a.n_input_tokens ?? 0) + (a.n_output_tokens ?? 0) };
}

const secs = (p) => (p?.started_at && p?.finished_at
  ? Math.round((new Date(p.finished_at) - new Date(p.started_at)) / 1000) : null);

export function durations(result) {
  return { setup: secs(result.environment_setup), agent: secs(result.agent_execution),
    verifier: secs(result.verifier), total: secs(result) };
}

// Every tool call as {name, text}: the e2e detector and error counter read only this shape.
export function toolCalls(harness, trialDir) {
  if (harness === 'claude-code') {
    return claudeEvents(trialDir).flatMap((e) => (e.type === 'assistant' ? e.message?.content ?? [] : [])
      .filter((c) => c.type === 'tool_use').map((c) => ({ name: c.name, text: JSON.stringify(c.input) })));
  }
  if (harness === 'codex') {
    return codexEvents(trialDir).filter((e) => e.type === 'response_item' && ['function_call', 'custom_tool_call'].includes(e.payload?.type))
      .map((e) => ({ name: e.payload.name ?? '', text: String(e.payload.arguments ?? e.payload.input ?? '') }));
  }
  return openCodeTools(trialDir).map((c) => ({ name: c.name, text: JSON.stringify(c.input) }));
}

// Codex runs MCP tools inside its code-mode exec, so its calls come from the completed items.
const CODEX_NON_TOOL_ITEMS = new Set(['UserMessage', 'AgentMessage', 'Reasoning', 'SubAgentActivity']);

// Calls per tool name: built-ins, and MCP tools grouped by server. Every configured server is
// listed, so an unused one shows up with no calls. OpenCode 2 calls MCP tools from Code Mode's
// `execute` code (`tools.<server>.<tool>(…)`); an execute without one counts as a built-in.
// A server with `codemode: false` exposes its tools directly, which OpenCode 2 names `<server>_<tool>`; only the
// configured server names can split those.
const CODE_MODE_CALL = /\btools(?:\.([\w$]+)|\[["']([^"']+)["']\])\.([\w$]+)\s*\(/g;
export function toolUsage(harness, trialDir, servers) {
  const usage = { builtin: {}, mcp: Object.fromEntries(servers.map((s) => [s, {}])) };
  const count = (bucket, name) => { bucket[name] = (bucket[name] ?? 0) + 1; };
  const mcp = (server, tool) => count(usage.mcp[server] ??= {}, tool);
  if (harness === 'codex') {
    for (const e of codexEvents(trialDir)) {
      const item = e.payload?.type === 'item_completed' ? e.payload.item : null;
      if (item?.type === 'McpToolCall') mcp(item.server, item.tool);
      else if (item?.type && !CODEX_NON_TOOL_ITEMS.has(item.type)) count(usage.builtin, item.type);
    }
    return usage;
  }
  const prefixes = [...servers].sort((a, b) => b.length - a.length);
  for (const { name, text } of toolCalls(harness, trialDir)) {
    if (harness === 'opencode' && name === 'execute') {
      const code = JSON.parse(text).code ?? '';
      const calls = [...code.matchAll(CODE_MODE_CALL)];
      if (!calls.length) count(usage.builtin, name);
      for (const [, server, quoted, tool] of calls) mcp(server ?? quoted, tool);
      continue;
    }
    const parts = harness === 'claude-code' ? name.match(/^mcp__(.+?)__(.+)$/)?.slice(1) : null;
    const server = harness === 'opencode' ? prefixes.find((s) => name.startsWith(`${s}_`)) : parts?.[0];
    if (!server || server === 'acp') count(usage.builtin, parts?.[1] ?? name); // the ACP bridge serves Claude's built-ins
    else mcp(server, parts?.[1] ?? name.slice(server.length + 1));
  }
  return usage;
}

function toolErrorCount(harness, trialDir) {
  if (harness === 'claude-code') {
    return claudeEvents(trialDir).flatMap((e) => (e.type === 'user' && Array.isArray(e.message?.content) ? e.message.content : []))
      .filter((c) => c.type === 'tool_result' && c.is_error).length;
  }
  if (harness === 'codex') {
    return codexEvents(trialDir).filter((e) => e.payload?.type === 'function_call_output'
      && /^(failed to|error:|Exit code [1-9])/i.test(String(e.payload.output ?? ''))).length;
  }
  return openCodeTools(trialDir).filter((c) => c.status === 'error').length;
}

export function errors(harness, trialDir, result) {
  const log = path.join(trialDir, 'user-agent/claude-code.txt');
  const text = existsSync(log) ? readFileSync(log, 'utf8') : '';
  const bridge = text.match(/BRIDGE FAILURE:[^"\\]*/)?.[0].trim() ?? null;
  const type = result.exception_info?.exception_type ?? null;
  // A usage-limit rejection of a subscription (the simulated user's Claude one, or the target
  // agent's via the ACP bridge) voids the trial.
  const trajectory = path.join(trialDir, 'agent/bridge-trajectory.json');
  const quota = text.includes('"api_error":"usage_limit_reached"')
    || (existsSync(trajectory) && /"codexErrorInfo":\s*"usageLimitExceeded"/.test(readFileSync(trajectory, 'utf8')));
  return { harbor: type, bridge, tool: toolErrorCount(harness, trialDir), timeout: /Timeout/i.test(type ?? ''), quota };
}

export function e2ePerformed(harness, trialDir, port) {
  return toolCalls(harness, trialDir)
    .some((c) => /browser_navigate/.test(c.name + c.text) && new RegExp(`(localhost|127\\.0\\.0\\.1|0\\.0\\.0\\.0):${port}(?!\\d)`).test(c.text)) ? 1 : 0;
}

// agent-dev's spec/plan review hook: the agent read show-me's SKILL.md (user-invoked only, so read as a file).
export function showMeRead(harness, trialDir) {
  return toolCalls(harness, trialDir).some((c) => /show-me[\\/]+SKILL\.md/.test(c.text)) ? 1 : 0;
}

export function softSignals(harness, trialDir) {
  if (harness === 'opencode') {
    // The superpowers plugin injects its bootstrap per request and never stores it, so look for a skill call.
    return { superpowersActive: openCodeTools(trialDir).some((t) => t.name === 'skill' && t.status === 'completed' && SUPERPOWERS_ENTRY_SKILLS.includes(t.input?.id)) };
  }
  const events = harness === 'codex' ? codexEvents(trialDir) : claudeEvents(trialDir);
  return { superpowersActive: JSON.stringify(events).includes('using-superpowers') };
}
