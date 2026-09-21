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
# Installs company root certificates from the read-only mount into the system store. c_rehash
# links only files holding exactly one certificate, so bundles are split one certificate per
# file and DER is converted. Without the mount this is a no-op. Runs on every start, so a
# shrunk certificate set leaves no stale trust behind.
install_extra_cas() {
  [[ -d "$AGENT_CA_SOURCE" ]] || return 0
  local file pem count=0
  rm -rf "$AGENT_CA_ANCHORS" "$AGENT_CA_BUNDLE"
  mkdir -p "$AGENT_CA_ANCHORS"
  while IFS= read -r -d '' file; do
    if grep -q -- '-----BEGIN CERTIFICATE-----' "$file"; then
      pem="$(cat -- "$file")"
    elif pem="$(openssl x509 -inform DER -in "$file" 2>/dev/null)"; then
      :
    else
      printf 'agent runtime: warning: skipping %s (not a PEM or DER certificate)\n' "$file" >&2
      continue
    fi
    count="$(printf '%s\n' "$pem" | awk -v dir="$AGENT_CA_ANCHORS" -v n="$count" '
      { sub(/\r$/, "") }
      /-----BEGIN CERTIFICATE-----/ { n++; out = sprintf("%s/agent-extra-%03d.crt", dir, n); inside = 1 }
      inside { print > out }
      /-----END CERTIFICATE-----/ { if (inside) close(out); inside = 0 }
      END { print n }')"
  done < <(find "$AGENT_CA_SOURCE" -maxdepth 1 -type f \
    \( -iname '*.crt' -o -iname '*.pem' -o -iname '*.cer' -o -iname '*.cert' \) -print0 | sort -z)
  if (( count == 0 )); then
    rmdir "$AGENT_CA_ANCHORS"
    printf 'agent runtime: warning: %s holds no certificates; nothing trusted\n' "$AGENT_CA_SOURCE" >&2
    return 0
  fi
  chmod 0644 "$AGENT_CA_ANCHORS"/*.crt
  cat "$AGENT_CA_ANCHORS"/*.crt > "$AGENT_CA_BUNDLE"
  chmod 0644 "$AGENT_CA_BUNDLE"
  # Its rehash always warns about the combined ca-certificates.crt; show output only on failure.
  local output
  output="$(update-ca-certificates 2>&1)" || fail "Could not install company root certificates: $output"
  printf 'agent runtime: trusted %d company root certificate(s) from %s\n' "$count" "$AGENT_CA_SOURCE" >&2
}
APP_USER=dev
APP_HOME=/home/dev
# Company root certificates: read-only mount in, split anchors and an extras-only bundle out.
# The bundle lives outside /etc/ssl/certs so update-ca-certificates does not try to hash it.
AGENT_CA_SOURCE=/etc/agent-certs
AGENT_CA_ANCHORS=/usr/local/share/ca-certificates/agent-extra
AGENT_CA_BUNDLE=/etc/ssl/agent-extra-ca.pem
HOST_UID="${HOST_UID:-1000}"
HOST_GID="${HOST_GID:-1000}"
for value in "$HOST_UID" "$HOST_GID"; do
  [[ "$value" =~ ^[1-9][0-9]{0,9}$ ]] && (( value < 4294967295 )) ||
    fail 'HOST_UID and HOST_GID must be nonzero numeric IDs below 4294967295.'
done

node /usr/local/lib/agent-runtime/validate-workspace.mjs

if [[ "$(id -u)" == 0 ]]; then
  [[ ! -L "$APP_HOME" ]] || fail '/home/dev must be a directory, not a symlink.'
  install_extra_cas
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
# Node appends the extras to its bundled list; OpenSSL and Python replace their default file,
# so those get the full system bundle. Pointing any of them at a missing file breaks all TLS.
if [[ -s "$AGENT_CA_BUNDLE" ]]; then
  export NODE_EXTRA_CA_CERTS="$AGENT_CA_BUNDLE"
  export SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt REQUESTS_CA_BUNDLE=/etc/ssl/certs/ca-certificates.crt
fi
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
