#!/usr/bin/env bash
set -euo pipefail

variant="${1:-${IMAGE_VARIANT:-base}}"
tool_bin=/opt/agent-tools/node_modules/.bin

fail() {
  echo "tool verification failed: $*" >&2
  exit 1
}

[[ "$(id -u)" -ne 0 ]] || fail "verification must run as the non-root runtime user"
[[ -r /opt/agent-tools/inventory.json ]] || fail "tool inventory is missing"

for command in node npm git gh rg az uv uvx serena playwright-mcp context7-mcp mcp-server-azuredevops ccusage; do
  command -v "$command" >/dev/null || fail "$command is not on PATH"
done

for command in claude codex opencode; do
  [[ -x "$tool_bin/$command" ]] || fail "real $command binary is missing from $tool_bin"
done

command -v ai-dev-workflow >/dev/null 2>&1 && fail "the host-side generator is present in the runtime image"

node --version
"$tool_bin/claude" --version
"$tool_bin/codex" --version
"$tool_bin/opencode" --version
playwright-mcp --help >/dev/null
context7-mcp --help >/dev/null
mcp-server-azuredevops --version >/dev/null
ccusage --version
az version --output none
uv --version
serena --help >/dev/null

node /usr/local/lib/agent-runtime/verify-browser.mjs
node /usr/local/lib/agent-runtime/verify-mcp.mjs

case "$variant" in
  base)
    ;;
  node)
    for command in gcc g++ make pnpm yarn tsc typescript-language-server; do
      command -v "$command" >/dev/null || fail "$command is not on PATH in the Node image"
    done
    pnpm --version
    yarn --version
    tsc --version
    typescript-language-server --version
    node /usr/local/lib/agent-runtime/verify-semantic.mjs
    ;;
  dotnet)
    command -v dotnet >/dev/null || fail "dotnet is not on PATH in the .NET image"
    dotnet --version
    ;;
  *)
    fail "unknown image variant: $variant"
    ;;
esac

echo "Tool runtime verification ($variant): ok"
