#!/usr/bin/env bash
# Startup hook of the .NET image: trust the ASP.NET Core HTTPS development certificate
# for localhost. Certificate, key and trust are per user and live in the home volume,
# so this runs on every start and is a no-op once trusted. SSL_CERT_DIR (image ENV)
# covers OpenSSL clients such as curl and HttpClient; the NSS database covers Chromium.
set -euo pipefail
: "${HOME:?HOME must be set}"
# Outside /workspace, so a project global.json cannot select another SDK.
cd "$HOME"
dotnet dev-certs https --check --trust >/dev/null 2>&1 && exit 0
nssdb="$HOME/.pki/nssdb"
# dev-certs only trusts in existing NSS databases; Chromium would create this one lazily.
if [[ ! -f "$nssdb/cert9.db" ]]; then
  mkdir -p "$nssdb"
  certutil -d "sql:$nssdb" -N --empty-password
fi
if ! output="$(dotnet dev-certs https --trust 2>&1)"; then
  printf '%s\n' "$output" >&2
  printf 'agent runtime: could not trust the ASP.NET Core HTTPS development certificate.\n' >&2
  exit 1
fi
