#!/usr/bin/env bash
set -euo pipefail
: "${HOME:?HOME must be set}"

for agent in codex claude opencode; do
  plan="$(AGENT_RUNTIME_PRINT_PLAN=1 node /usr/local/lib/agent-runtime/launch-agent.mjs "$agent" --help)"
  node -e '
    const plan = JSON.parse(process.argv[1]);
    if (!plan.command.startsWith("/opt/agent-tools/node_modules/.bin/")) throw new Error("launcher does not use installed binary");
  ' "$plan"
done

codex_plan="$(AGENT_RUNTIME_PRINT_PLAN=1 node /usr/local/lib/agent-runtime/launch-agent.mjs codex --yolo fixture)"
claude_plan="$(AGENT_RUNTIME_PRINT_PLAN=1 node /usr/local/lib/agent-runtime/launch-agent.mjs claude --dangerously-skip-permissions fixture)"
opencode_plan="$(AGENT_RUNTIME_PRINT_PLAN=1 node /usr/local/lib/agent-runtime/launch-agent.mjs opencode run fixture)"
node - "$codex_plan" "$claude_plan" "$opencode_plan" <<'NODE'
const { spawnSync } = require('node:child_process');
const [codex, claude, opencode] = process.argv.slice(2).map(JSON.parse);
if (!codex.args.some(value => value.includes('mcp_servers.playwright.args='))) throw new Error('Codex Playwright override missing');
if (!claude.args.includes('--strict-mcp-config')) throw new Error('Claude strict effective config missing');
const config = JSON.parse(opencode.env.OPENCODE_CONFIG_CONTENT);
if (!config.mcp.playwright || !config.plugin.includes('/opt/superpowers')) throw new Error('OpenCode runtime config missing');
// Resolve the supplied runtime config outside the project. OpenCode may bootstrap
// plugin support by writing .opencode/.gitignore in its current project.
const resolved = spawnSync(opencode.command, ['debug', 'config'], {
  cwd: '/tmp', env: opencode.env, encoding: 'utf8',
});
if (resolved.status !== 0) throw new Error(`OpenCode config resolution failed: ${resolved.stderr}`);
const effective = JSON.parse(resolved.stdout);
if (!effective.plugin?.includes('/opt/superpowers')) throw new Error('OpenCode did not load Superpowers');
if (!effective.skills?.paths?.includes('/opt/superpowers/skills')) throw new Error('OpenCode did not register Superpowers skills');
NODE

test -r "$HOME/.codex/config.toml"
test -r "$HOME/.cache/ai-dev-workflow/codex-marketplace/.claude-plugin/marketplace.json"
# Version-agnostic: the plugin cache path carries the superpowers release version, which the
# toolstack bumps independently — glob it so a version bump does not silently break this check.
compgen -G "$HOME/.codex/plugins/cache/agent-runtime/superpowers/*/skills/using-superpowers/SKILL.md" >/dev/null
plugins="$(/opt/agent-tools/node_modules/.bin/codex plugin list --json)"
node -e '
  const plugins = JSON.parse(process.argv[1]);
  const superpowers = plugins.installed.find(plugin => plugin.pluginId === "superpowers@agent-runtime");
  if (!superpowers?.enabled) throw new Error("Codex does not report Superpowers as installed and enabled");
' "$plugins"
claude_plugin="$(/opt/agent-tools/node_modules/.bin/claude plugin validate /opt/superpowers --json)"
node -e '
  const validation = JSON.parse(process.argv[1]);
  if (!validation.success) throw new Error("Claude rejected the Superpowers plugin");
' "$claude_plugin"
echo 'Agent runtime configuration: ok'
