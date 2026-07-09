// Shared constants + tiny CLI-arg primitive. Leaf module — imports nothing from the package.

import path from 'node:path';
import { fileURLToPath } from 'node:url';

// SRC_DIR is the package payload root (agent-src/): it holds the unit sources (agents/,
// skills/, includes/) and the config/ dir. This module lives in agent-src/lib/, so resolve
// one level up to reach the payload root.
export const SRC_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const KNOWN_PLATFORMS = ['claude', 'codex', 'opencode'];

// Project-owned, committed dir (at the project root) that mirrors the agent-src/{agents,skills}/<name>/
// layout and lets a project override or extend the body of any shipped unit. See lib/units.mjs.
export const CUSTOM_DIR = 'agent-custom';

// Agents that perform ticketing operations and therefore need the azure-devops MCP tools
// added to their Claude allowlist when that backend is selected.
export const TICKETING_AGENTS = ['developer', 'code-reviewer', 'qa-engineer'];
export const ADO_MCP_TOOLS = [
  'mcp__ado__wit_query_by_wiql',
  'mcp__ado__wit_get_work_item',
  'mcp__ado__wit_list_work_item_comments',
  'mcp__ado__wit_create_work_item',
  'mcp__ado__wit_update_work_item',
  'mcp__ado__wit_add_work_item_comment',
];

/** Value that follows `flag` in argv, or '' when the flag (or its value) is absent. */
export function argValue(argv, flag) {
  const i = argv.indexOf(flag);
  return i !== -1 && argv[i + 1] ? argv[i + 1] : '';
}
