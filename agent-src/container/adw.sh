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
elif [ -f "$root/.env.ai-dev" ]; then
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

# Newest build of the configured image (AGENT_IMAGE or the default); offline, the local one starts.
compose pull ai-dev-workflow || echo "adw.sh: could not pull the image; starting the local one." >&2
compose run --rm ai-dev-workflow "$@"
