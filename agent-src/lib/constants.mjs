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

// The npx spec for the azure-devops MCP server, used by both the .mcp.json and the Codex
// config.toml renderers. Pinned to a major: v2 renamed every v1 tool (wit_get_work_item →
// wit_work_item(action: "get"), …), and a floating `latest` silently breaks ADO_MCP_TOOLS below
// — a Claude subagent allowlist naming tools the server no longer registers yields no tools at
// all. Bump this deliberately, together with ADO_MCP_TOOLS and includes/ticketing-azure-devops.md.
export const ADO_MCP_PACKAGE = '@azure-devops/mcp@2';

// Agents that perform ticketing operations and therefore need the azure-devops MCP tools
// added to their Claude allowlist when that backend is selected.
export const TICKETING_AGENTS = ['developer', 'code-reviewer', 'qa-engineer'];
export const ADO_MCP_TOOLS = [
  'mcp__ado__wit_query',
  'mcp__ado__wit_work_item',
  'mcp__ado__wit_work_item_write',
  'mcp__ado__wit_work_item_comment_write',
  'mcp__ado__wit_work_item_link_write',
  // Bug reports carry repro evidence (screenshots, logs) as attachments; without this the
  // developer and qa-engineer can see that an attachment exists but never open it.
  'mcp__ado__wit_work_item_attachment',
];

/** Value that follows `flag` in argv, or '' when the flag (or its value) is absent. */
export function argValue(argv, flag) {
  const i = argv.indexOf(flag);
  return i !== -1 && argv[i + 1] ? argv[i + 1] : '';
}
