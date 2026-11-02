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
const { spawn, spawnSync } = require('node:child_process');
const [codex, claude, opencode] = process.argv.slice(2).map(JSON.parse);
if (!codex.args.some(value => value.includes('mcp_servers.playwright.args='))) throw new Error('Codex Playwright override missing');
if (!claude.args.includes('--strict-mcp-config')) throw new Error('Claude strict effective config missing');
const config = JSON.parse(opencode.env.OPENCODE_CONFIG_CONTENT);
if (!config.mcp.servers.playwright || !config.plugins.includes('/opt/superpowers')) throw new Error('OpenCode runtime config missing');
// Resolve the supplied runtime config outside the project. OpenCode 2 lists each
// config source; the inline one is a document layer. --standalone: otherwise it leaves a
// background server running with every MCP server, and managed Serena creates /workspace/.serena.
const resolved = spawnSync(opencode.command, ['--standalone', 'debug', 'config'], {
  cwd: '/tmp', env: opencode.env, encoding: 'utf8',
});
if (resolved.status !== 0) throw new Error(`OpenCode config resolution failed: ${resolved.stderr}`);
const layers = JSON.parse(resolved.stdout).filter(source => source.type === 'document').map(source => source.info);
if (!layers.some(layer => layer.mcp?.servers?.playwright)) throw new Error('OpenCode did not resolve the MCP servers');
if (!layers.some(layer => layer.plugins?.includes('/opt/superpowers'))) throw new Error('OpenCode did not load Superpowers');
// The plugin registers its skills asynchronously, so ask a running server until they show up.
// The server gets only the plugin: the check needs no MCP servers, and managed Serena would
// create /workspace/.serena. A free port each run; a server that exits fails at once.
(async () => {
  const port = await new Promise((resolve, reject) => {
    const probe = require('node:net').createServer().once('error', reject);
    probe.listen(0, '127.0.0.1', () => { const { port } = probe.address(); probe.close(() => resolve(port)); });
  });
  const env = { ...opencode.env, OPENCODE_CONFIG_CONTENT: JSON.stringify({ plugins: config.plugins }),
    OPENCODE_PASSWORD: require('node:crypto').randomUUID() };
  const server = spawn(opencode.command, ['serve', '--hostname', '127.0.0.1', '--port', String(port)],
    { cwd: '/tmp', env, stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  let exited = null;
  server.stderr.on('data', chunk => { stderr += chunk; });
  server.on('exit', (code, signal) => { exited = signal ?? code; });
  try {
    let skills = [];
    for (let attempt = 0; attempt < 30 && !skills.includes('brainstorming'); attempt++) {
      await new Promise(resolve => setTimeout(resolve, 2000));
      if (exited !== null) throw new Error(`OpenCode server exited (${exited}): ${stderr.trim()}`);
      const listed = spawnSync(opencode.command, ['--server', `http://127.0.0.1:${port}`, 'api', 'skill.list'], { cwd: '/tmp', env, encoding: 'utf8' });
      if (listed.status === 0) skills = JSON.parse(listed.stdout).data.map(skill => skill.id);
    }
    if (!skills.includes('brainstorming')) throw new Error('OpenCode did not register Superpowers skills');
  } finally {
    server.kill();
  }
})().catch(error => { console.error(error); process.exit(1); });
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
