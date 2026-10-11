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
export function openCodeRows(trialDir, table) {
  const file = path.join(trialDir, 'agent/opencode/xdg-data/opencode/opencode.db');
  if (!existsSync(file)) return [];
  const db = new DatabaseSync(file, { readOnly: true });
  try { return db.prepare(`select data from ${table}`).all().map((r) => JSON.parse(r.data)); }
  finally { db.close(); }
}

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
    const last = codexEvents(trialDir)
      .filter((e) => e.type === 'event_msg' && e.payload?.type === 'token_count' && e.payload.info)
      .at(-1)?.payload.info.total_token_usage;
    if (!last) return null;
    return finish({ input: last.input_tokens - last.cached_input_tokens, output: last.output_tokens,
      cacheRead: last.cached_input_tokens, cacheWrite: 0 });
  }
  if (harness === 'opencode') {
    const msgs = openCodeRows(trialDir, 'message').filter((m) => m.role === 'assistant');
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
  return openCodeRows(trialDir, 'part').filter((p) => p.type === 'tool')
    .map((p) => ({ name: p.tool, text: JSON.stringify(p.state?.input ?? {}) }));
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
  return openCodeRows(trialDir, 'part').filter((p) => p.type === 'tool' && p.state?.status === 'error').length;
}

export function errors(harness, trialDir, result) {
  const log = path.join(trialDir, 'user-agent/claude-code.txt');
  const bridge = existsSync(log) ? readFileSync(log, 'utf8').match(/BRIDGE FAILURE:[^"\\]*/)?.[0].trim() ?? null : null;
  const type = result.exception_info?.exception_type ?? null;
  return { harbor: type, bridge, tool: toolErrorCount(harness, trialDir), timeout: /Timeout/i.test(type ?? '') };
}

export function e2ePerformed(harness, trialDir, port) {
  return toolCalls(harness, trialDir)
    .some((c) => /browser_navigate/.test(c.name + c.text) && c.text.includes(`:${port}`)) ? 1 : 0;
}

export function softSignals(harness, trialDir) {
  const blob = harness === 'opencode'
    ? JSON.stringify([openCodeRows(trialDir, 'message'), openCodeRows(trialDir, 'part')])
    : JSON.stringify(harness === 'codex' ? codexEvents(trialDir) : claudeEvents(trialDir));
  return { superpowersActive: blob.includes('using-superpowers') };
}
