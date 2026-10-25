#!/bin/sh
# Project-owned; written once by ai-dev-workflow init. Runs a command in this project's agent
# container: ./ai-dev.sh [command [args...]] (no command opens bash). See AI-DEV.md.
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)

# Per-machine settings (AGENT_CA_DIR, proxies, AGENT_IMAGE, …). Never overrides a variable that is
# already set in the environment, even to an empty value.
if [ -f "$root/.env.ai-dev" ]; then
  while IFS= read -r line || [ -n "$line" ]; do
    line=$(printf '%s' "$line" | tr -d '\r')
    case $line in ''|'#'*) continue ;; 'export '*) line=${line#export } ;; esac
    case $line in *=*) ;; *) continue ;; esac
    key=${line%%=*}
    case $key in ''|[0-9]*|*[!A-Za-z0-9_]*) continue ;; esac
    value=${line#*=}
    case $value in \"*\") value=${value#\"}; value=${value%\"} ;; \'*\') value=${value#\'}; value=${value%\'} ;; esac
    eval "isset=\${$key+x}"
    [ -n "$isset" ] || export "$key=$value"
  done < "$root/.env.ai-dev"
fi

export PROJECT_ROOT="$root"
export HOST_UID="${HOST_UID:-$(id -u)}"
export HOST_GID="${HOST_GID:-$(id -g)}"

set -- run --rm ai-dev-workflow "$@"
# Opt-in Docker daemon (AGENT_DIND=1): root-equivalent on the host, see AI-DEV.md.
if [ "${AGENT_DIND:-}" = 1 ]; then
  if [ -n "${AGENT_CA_DIR:-}" ]; then
    set -- -f "$root/compose.ai-dev.dind-certs.yml" "$@"
  fi
  set -- -f "$root/compose.ai-dev.dind.yml" "$@"
fi
if [ -n "${AGENT_CA_DIR:-}" ]; then
  set -- -f "$root/compose.ai-dev.certs.yml" "$@"
fi
exec docker compose -f "$root/compose.ai-dev.yml" "$@"
