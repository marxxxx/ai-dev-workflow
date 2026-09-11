#!/usr/bin/env bash
set -euo pipefail
: "${HOME:?HOME must be set}"
exec node /usr/local/lib/agent-runtime/launch-agent.mjs --configure
