#!/usr/bin/env bash
set -euo pipefail
agent="$(basename "$0")"
exec node /usr/local/lib/agent-runtime/launch-agent.mjs "$agent" "$@"
