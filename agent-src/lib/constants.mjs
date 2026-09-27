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
// wit_work_item(action: "get"), …), and a floating `latest` silently breaks the tool names
// documented in includes/ticketing-azure-devops.md. Bump this deliberately, together with that include.
export const ADO_MCP_PACKAGE = '@azure-devops/mcp@2';

/** Value that follows `flag` in argv, or '' when the flag (or its value) is absent. */
export function argValue(argv, flag) {
  const i = argv.indexOf(flag);
  return i !== -1 && argv[i + 1] ? argv[i + 1] : '';
}
