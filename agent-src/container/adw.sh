#!/bin/sh
# Project-owned; written once by adw init. Runs a command in this project's agent
# container: ./adw.sh [command [args...]] (no command opens bash). See .adw/README.md.
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)

# Per-machine settings (AGENT_CA_DIR, proxies, AGENT_IMAGE, …). Never overrides a variable that is
# already set in the environment, even to an empty value.
if [ -f "$root/.adw/.env" ]; then
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
  done < "$root/.adw/.env"
fi
if [ -f "$root/.env.ai-dev" ]; then
  echo "adw.sh: move .env.ai-dev to .adw/.env, or run adw upgrade; it is not read anymore." >&2
fi

export PROJECT_ROOT="$root"
export HOST_UID="${HOST_UID:-$(id -u)}"
export HOST_GID="${HOST_GID:-$(id -g)}"

# docker compose with this project's compose files.
compose() {
  # Opt-in Docker daemon (AGENT_DIND=1): root-equivalent on the host, see .adw/README.md.
  if [ "${AGENT_DIND:-}" = 1 ]; then
    if [ -n "${AGENT_CA_DIR:-}" ]; then
      set -- -f "$root/.adw/compose.dind-certs.yml" "$@"
    fi
    set -- -f "$root/.adw/compose.dind.yml" "$@"
  fi
  if [ -n "${AGENT_CA_DIR:-}" ]; then
    set -- -f "$root/.adw/compose.certs.yml" "$@"
  fi
  docker compose --project-directory "$root" -f "$root/.adw/compose.yml" "$@"
}

# Newest build of the configured image (AGENT_IMAGE or the default). A project image built from
# .adw/compose.yml (build:) is rebuilt on the newest base image instead, from the cache when the
# base is unchanged, and without pulling when the base image exists only locally. Offline, the
# local image starts.
update_image() {
  if compose config ai-dev-workflow 2>/dev/null | grep -q '^    build:'; then
    compose build --pull ai-dev-workflow || compose build ai-dev-workflow \
      || echo "adw.sh: could not build the image; starting the local one." >&2
  else
    compose pull ai-dev-workflow || echo "adw.sh: could not pull the image; starting the local one." >&2
  fi
}

# The opt-in MCP server of .adw/compose.mcp.yml: ./adw.sh mcp [up options] starts it (-d: in the
# background), ./adw.sh mcp down stops it.
if [ "${1:-}" = mcp ]; then
  shift
  if [ ! -f "$root/.adw/compose.mcp.yml" ]; then
    echo "adw.sh: the MCP server is not set up. Run adw init again (keep .adw/project.json, set up the dev container) and answer yes to the MCP question." >&2
    exit 1
  fi
  if [ -z "${ADW_MCP_TOKEN:-}" ]; then
    echo "adw.sh: ADW_MCP_TOKEN is empty. Set it in .adw/.env (32 characters or more)." >&2
    exit 1
  fi
  mcp_compose() {
    if [ -n "${AGENT_CA_DIR:-}" ]; then
      set -- -f "$root/.adw/compose.mcp-certs.yml" "$@"
    fi
    compose -f "$root/.adw/compose.mcp.yml" "$@"
  }
  if [ "${1:-}" = down ]; then
    shift
    mcp_compose stop "$@" adw-mcp
    exit
  fi
  update_image
  mcp_compose up "$@" adw-mcp
  exit
fi

update_image
compose run --rm ai-dev-workflow "$@"
