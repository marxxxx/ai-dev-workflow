#!/usr/bin/env bash
set -euo pipefail

fail() { printf 'agent runtime: %s\n' "$*" >&2; exit 1; }
# Gives a volume tree to the runtime user without following symlinks or leaving the filesystem.
# Another container of the same Compose project may create and delete files there during the
# walk (an agent session running npm ci), so entries that vanish are not failures; only an
# entry that still exists with foreign ownership is.
own_tree() {
  local path owner
  find "$1" -xdev -ignore_readdir_race \( ! -uid "$HOST_UID" -o ! -gid "$HOST_GID" \) \
    -exec chown -h "$HOST_UID:$HOST_GID" {} + 2>/dev/null && return 0
  while IFS= read -r -d '' path; do
    owner="$(stat -c '%u:%g' -- "$path" 2>/dev/null)" || continue
    [[ "$owner" == "$HOST_UID:$HOST_GID" ]] && continue
    printf 'agent runtime: %s is still owned by %s\n' "$path" "$owner" >&2
    return 1
  done < <(find "$1" -xdev -ignore_readdir_race \( ! -uid "$HOST_UID" -o ! -gid "$HOST_GID" \) -print0 2>/dev/null)
}
APP_USER=dev
APP_HOME=/home/dev
HOST_UID="${HOST_UID:-1000}"
HOST_GID="${HOST_GID:-1000}"
for value in "$HOST_UID" "$HOST_GID"; do
  [[ "$value" =~ ^[1-9][0-9]{0,9}$ ]] && (( value < 4294967295 )) ||
    fail 'HOST_UID and HOST_GID must be nonzero numeric IDs below 4294967295.'
done

node /usr/local/lib/agent-runtime/validate-workspace.mjs

if [[ "$(id -u)" == 0 ]]; then
  [[ ! -L "$APP_HOME" ]] || fail '/home/dev must be a directory, not a symlink.'
  if [[ "$(id -g "$APP_USER")" != "$HOST_GID" ]]; then
    groupmod -o -g "$HOST_GID" "$APP_USER" || fail 'Could not map runtime group.'
  fi
  if [[ "$(id -u "$APP_USER")" != "$HOST_UID" ]]; then
    usermod -o -u "$HOST_UID" -g "$HOST_GID" "$APP_USER" || fail 'Could not map runtime user.'
  fi
  mkdir -p "$APP_HOME"
  # Reused homes can have old IDs.
  own_tree "$APP_HOME" || fail 'Could not initialize home volume ownership.'
  # Compose may mask project subdirectories with volumes (a container-only node_modules).
  # A fresh volume below the bind mount has no template in the image and starts out
  # root-owned. Repair only when the mount root itself has foreign ownership; -xdev keeps
  # the walk inside the volume, so the project is never chowned recursively.
  while IFS= read -r -d '' mount; do
    owner="$(stat -c '%u:%g' "$mount" 2>/dev/null || true)"
    if [[ "$owner" != "$HOST_UID:$HOST_GID" ]]; then
      own_tree "$mount" ||
        printf 'agent runtime: warning: could not adjust ownership of %s\n' "$mount" >&2
    fi
  done < <(node /usr/local/lib/agent-runtime/workspace-mounts.mjs)
  exec gosu "$APP_USER" env HOME="$APP_HOME" USER="$APP_USER" LOGNAME="$APP_USER" \
    /usr/local/bin/entrypoint.sh "$@"
fi

[[ "$(id -u)" == "$HOST_UID" && "$(id -g)" == "$HOST_GID" ]] ||
  fail 'Runtime UID/GID differs from HOST_UID/HOST_GID. Start with the default entrypoint user for mapping.'
export HOME="$APP_HOME" USER="$APP_USER" LOGNAME="$APP_USER"
export XDG_CONFIG_HOME="$HOME/.config" XDG_CACHE_HOME="$HOME/.cache" XDG_DATA_HOME="$HOME/.local/share"
export CODEX_HOME="$HOME/.codex" UV_CACHE_DIR="$HOME/.cache/uv" AZURE_CONFIG_DIR="$HOME/.azure"
cd /workspace
git config --global --replace-all safe.directory /workspace
configure-agents.sh
# Variant images add idempotent per-home setup here (the .NET image trusts its dev certificate).
for hook in /usr/local/lib/agent-runtime/startup.d/*; do
  if [[ -x "$hook" ]]; then "$hook"; fi
done
# Advisory: host build artifacts the project shares with the container. Never fatal.
node /usr/local/lib/agent-runtime/check-host-artifacts.mjs || true
if [[ $# == 0 ]]; then set -- bash; fi
exec "$@"
