// Shared constants + tiny CLI-arg primitive. Leaf module — imports nothing from the package.

import path from 'node:path';
import { fileURLToPath } from 'node:url';

// SRC_DIR is where the package payload lives (these source modules + the units). Derived
// relative to THIS module, which sits in agent-src/ — the same resolved path as under the
// old single-file generate.mjs.
export const SRC_DIR = path.dirname(fileURLToPath(import.meta.url));
export const KNOWN_PLATFORMS = ['claude', 'codex', 'opencode'];

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
