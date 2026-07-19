#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# configure-agents.sh (hand-maintained, NOT generated)
#
# Idempotently registers the recommended MCP servers (serena, playwright,
# context7) into each coding agent's per-user config, and wires up superpowers.
#
# Called TWICE:
#   1. at image build time  — bakes config into the default /home/dev, so a
#      container run WITHOUT config bind-mounts is fully configured; and
#   2. at container start   — by entrypoint.sh, because bind-mounting the host's
#      ~/.claude / ~/.codex / ~/.config/opencode SHADOWS the baked config, so it
#      must be re-applied against the mounted dirs on every start.
#
# It is deterministic and node-only (node is always present) for the JSON
# configs, and grep-guarded text-append for Codex's TOML. Re-running it never
# duplicates entries. It NEVER clobbers an unrelated server the user already
# has — it only sets the three servers it manages.
#
# NOTE (version sensitivity): the per-agent config schemas and MCP bin names
# below reflect current releases. If an agent ships a breaking config change,
# adjust the definitions here — this is the single place they live.
# ---------------------------------------------------------------------------
set -u

: "${HOME:?HOME must be set}"

# --- MCP server definitions -------------------------------------------------
# serena runs via uvx (fetches/caches from git). playwright + context7 are
# installed as global npm bins in the image, so they start offline.
SERENA_CMD="uvx"
SERENA_ARGS_JSON='["--from","git+https://github.com/oraios/serena","serena","start-mcp-server"]'
PLAYWRIGHT_CMD="playwright-mcp"
PLAYWRIGHT_ARGS_JSON='[]'
CONTEXT7_CMD="context7-mcp"
CONTEXT7_ARGS_JSON='[]'

MCP_JSON=$(cat <<EOF
{
  "serena":     { "command": "${SERENA_CMD}",     "args": ${SERENA_ARGS_JSON} },
  "playwright": { "command": "${PLAYWRIGHT_CMD}", "args": ${PLAYWRIGHT_ARGS_JSON} },
  "context7":   { "command": "${CONTEXT7_CMD}",   "args": ${CONTEXT7_ARGS_JSON} }
}
EOF
)
export MCP_JSON

# --- Claude Code: ~/.claude.json (top-level mcpServers, "user" scope) --------
CLAUDE_CONFIG="${HOME}/.claude.json" node - <<'NODE' || echo "WARN: claude MCP config skipped"
const fs = require("fs");
const path = require("path");
const p = process.env.CLAUDE_CONFIG;
let cfg = {};
try { cfg = JSON.parse(fs.readFileSync(p, "utf8")); } catch { /* new or empty */ }
cfg.mcpServers = cfg.mcpServers || {};
const servers = JSON.parse(process.env.MCP_JSON);
for (const [name, def] of Object.entries(servers)) {
  cfg.mcpServers[name] = { type: "stdio", command: def.command, args: def.args };
}
fs.mkdirSync(path.dirname(p), { recursive: true });
fs.writeFileSync(p, JSON.stringify(cfg, null, 2) + "\n");
NODE

# --- OpenCode: ~/.config/opencode/opencode.json (mcp map) --------------------
OPENCODE_CONFIG="${HOME}/.config/opencode/opencode.json" node - <<'NODE' || echo "WARN: opencode MCP config skipped"
const fs = require("fs");
const path = require("path");
const p = process.env.OPENCODE_CONFIG;
let cfg = {};
try { cfg = JSON.parse(fs.readFileSync(p, "utf8")); } catch { /* new or empty */ }
if (!cfg["$schema"]) cfg["$schema"] = "https://opencode.ai/config.json";
cfg.mcp = cfg.mcp || {};
const servers = JSON.parse(process.env.MCP_JSON);
for (const [name, def] of Object.entries(servers)) {
  cfg.mcp[name] = { type: "local", command: [def.command, ...def.args], enabled: true };
}
fs.mkdirSync(path.dirname(p), { recursive: true });
fs.writeFileSync(p, JSON.stringify(cfg, null, 2) + "\n");
NODE

# --- Codex: ~/.codex/config.toml ([mcp_servers.<name>] blocks) --------------
codex_conf="${HOME}/.codex/config.toml"
mkdir -p "$(dirname "${codex_conf}")"
touch "${codex_conf}"
add_codex_server() {
  local name="$1" cmd="$2" args_toml="$3"
  if ! grep -q "^\[mcp_servers\.${name}\]" "${codex_conf}" 2>/dev/null; then
    {
      printf '\n[mcp_servers.%s]\n' "${name}"
      printf 'command = "%s"\n' "${cmd}"
      printf 'args = %s\n' "${args_toml}"
    } >> "${codex_conf}"
  fi
}
add_codex_server serena     "${SERENA_CMD}"     '["--from", "git+https://github.com/oraios/serena", "serena", "start-mcp-server"]'
add_codex_server playwright "${PLAYWRIGHT_CMD}" '[]'
add_codex_server context7   "${CONTEXT7_CMD}"   '[]'

# --- superpowers: link the cloned skill library into Claude's plugins --------
if [ -d /opt/superpowers ]; then
  mkdir -p "${HOME}/.claude/plugins"
  if [ ! -e "${HOME}/.claude/plugins/superpowers" ]; then
    ln -s /opt/superpowers "${HOME}/.claude/plugins/superpowers" 2>/dev/null || true
  fi
fi

exit 0
