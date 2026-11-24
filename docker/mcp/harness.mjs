import { accessSync, constants, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';

const HOME = '/home/dev';
// The model file of OpenCode when a model is set; same path as the e2e copy (a test guards the drift).
const OPENCODE_MODEL_FILE = `${HOME}/.adw-e2e/opencode.json`;
const CLI = { 'claude-code': 'claude', codex: 'codex', opencode: 'opencode' };

// The message that opens a session; the skill is invoked as /agent-dev in Claude Code and $agent-dev elsewhere.
export const openingText = (harness, task) => `${harness === 'claude-code' ? '/' : '$'}agent-dev ${task}`;

// Copy of e2e/local/session.mjs (not in the image). `cli` is the image's own claude/codex, which the adapters run
// instead of their bundled ones.
export function acpCommand(harness, model, { cli = null } = {}) {
  if (harness === 'claude-code') {
    return ['env', '-u', 'CLAUDECODE', ...(model ? [`ANTHROPIC_MODEL=${model}`] : []), ...(cli ? [`CLAUDE_CODE_EXECUTABLE=${cli}`] : []), 'claude-agent-acp'];
  }
  if (harness === 'codex') {
    return ['env', 'NO_BROWSER=1', 'INITIAL_AGENT_MODE=agent-full-access', ...(model ? [`CODEX_CONFIG=${JSON.stringify({ model: model.split('/').at(-1) })}`] : []),
      ...(cli ? [`CODEX_PATH=${cli}`] : []), 'codex-acp'];
  }
  if (harness === 'opencode') return ['env', ...(model ? [`OPENCODE_CONFIG=${OPENCODE_MODEL_FILE}`] : []), 'opencode', 'acp'];
  throw new Error(`unknown harness: ${harness}`);
}

// Absolute path of the harness CLI on PATH (the image's wrapper), or null. Looked up in-process so the worker and the
// server derive the same adapter command: the command string is part of an acpx session's identity.
export function resolveCli(harness, pathEnv = process.env.PATH ?? '') {
  const name = CLI[harness];
  if (!name || harness === 'opencode') return null;
  for (const dir of pathEnv.split(delimiter).filter(Boolean)) {
    const candidate = join(dir, name);
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch { /* next directory */ }
  }
  return null;
}

export const adapterCommand = (harness, pathEnv) => acpCommand(harness, null, { cli: resolveCli(harness, pathEnv) });

// Once per session, before its first turn. claude-agent-acp starts a session without a configured mode in Auto, whose
// classifier denies what acpx's approve-all would allow: start in Manual. Merged, so what the image or the project put in
// settings.json stays. Codex and OpenCode need nothing: no model is set, their logins are in the agent home already.
export function prepareHarness(harness, { home }) {
  if (!Object.hasOwn(CLI, harness)) throw new Error(`unknown harness: ${harness}`);
  if (harness !== 'claude-code') return;
  const file = join(home, '.claude', 'settings.json');
  let raw = '';
  try {
    raw = readFileSync(file, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  let current = {};
  if (raw.trim() !== '') {
    try {
      current = JSON.parse(raw);
    } catch (error) {
      throw new Error(`${file} is not valid JSON, not touching it: ${error.message}`);
    }
    if (current === null || typeof current !== 'object' || Array.isArray(current)) throw new Error(`${file} is not a JSON object, not touching it`);
  }
  const settings = { ...current, permissions: { defaultMode: 'default', ...current.permissions } };
  const text = `${JSON.stringify(settings, null, 2)}\n`;
  if (text === raw) return;
  mkdirSync(join(home, '.claude'), { recursive: true });
  const temp = `${file}.adw-mcp.tmp`;
  writeFileSync(temp, text, { mode: 0o600 });
  renameSync(temp, file);
}
