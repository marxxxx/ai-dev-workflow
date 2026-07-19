#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# entrypoint.sh (hand-maintained, NOT generated)
#
# Runs as root, then drops to the non-root `dev` user with gosu. Responsibilities:
#   1. Remap the `dev` user's UID/GID to the host's (HOST_UID/HOST_GID) so files
#      the agents write into the /workspace bind-mount are owned by the host user.
#   2. Mark /workspace as a git safe.directory.
#   3. Ensure the agent config + Serena cache dirs exist (they are bind-mount
#      targets) and (re)apply the MCP registration against them — bind-mounts
#      shadow the config baked at build time, so it must be re-applied on start.
#   4. exec the requested command (default: an interactive bash shell; pass
#      `claude` / `codex` / `opencode` to launch an agent in the mounted repo).
#
# None of the setup steps are allowed to abort startup — the workflow must come
# up even if a best-effort config step fails.
# ---------------------------------------------------------------------------
set -euo pipefail

APP_USER="${APP_USER:-dev}"
APP_HOME="${APP_HOME:-/home/dev}"
HOST_UID="${HOST_UID:-1000}"
HOST_GID="${HOST_GID:-1000}"

run_as_dev() {
  exec gosu "${APP_USER}" env \
    HOME="${APP_HOME}" USER="${APP_USER}" LOGNAME="${APP_USER}" "$@"
}

if [ "$(id -u)" = "0" ]; then
  # --- 1. Remap the runtime user to the host UID/GID ----------------------
  current_gid="$(getent group "${APP_USER}" | cut -d: -f3 || true)"
  if [ -n "${HOST_GID}" ] && [ "${HOST_GID}" != "${current_gid}" ]; then
    groupmod -o -g "${HOST_GID}" "${APP_USER}" || true
  fi
  current_uid="$(id -u "${APP_USER}" || true)"
  if [ -n "${HOST_UID}" ] && [ "${HOST_UID}" != "${current_uid}" ]; then
    usermod -o -u "${HOST_UID}" -g "${HOST_GID}" "${APP_USER}" || true
  fi

  # --- 2/3. Ensure bind-mount target dirs exist and are host-owned --------
  mkdir -p \
    "${APP_HOME}/.claude" \
    "${APP_HOME}/.codex" \
    "${APP_HOME}/.config/opencode" \
    "${APP_HOME}/.serena"
  # Chown only the dir roots (a deep chown of a large bind-mount is wasteful,
  # and the host paths are already owned by the host user anyway).
  chown "${HOST_UID}:${HOST_GID}" "${APP_HOME}" || true
  for d in .claude .codex .config .config/opencode .serena; do
    chown "${HOST_UID}:${HOST_GID}" "${APP_HOME}/${d}" || true
  done

  # --- 3b. Make the uv cache/python tree writable by the runtime user ------
  # The build primed serena's Python + package into /opt/uv AS ROOT, then made
  # it world-readable (a+rX). Readable is not enough: `uvx ...serena` must WRITE
  # its cache on first run, and root-owned 755 dirs make that abort with
  # "Failed to initialize cache ... Permission denied (os error 13)". Rechown the
  # whole tree to the remapped UID/GID so the primed cache stays reusable AND
  # writable -- this holds for the default `node`/`dev` uid and any remapped host
  # uid alike, and keeps serena offline on first run (no network fetch).
  if [ -d /opt/uv ]; then
    chown -R "${HOST_UID}:${HOST_GID}" /opt/uv || true
  fi

  gosu "${APP_USER}" env HOME="${APP_HOME}" \
    git config --global --add safe.directory /workspace || true

  gosu "${APP_USER}" env HOME="${APP_HOME}" \
    configure-agents.sh || echo "WARN: agent MCP configuration incomplete"

  run_as_dev "$@"
else
  # Already non-root (e.g. run with --user): best-effort, then exec.
  export HOME="${HOME:-${APP_HOME}}"
  git config --global --add safe.directory /workspace || true
  configure-agents.sh || echo "WARN: agent MCP configuration incomplete"
  exec "$@"
fi
