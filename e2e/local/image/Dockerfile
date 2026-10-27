# check=skip=InvalidDefaultArgInFrom
# adw e2e: the project's dev image plus the pinned ACP tooling that drives the agent under test.
# Built by e2e/local/image.mjs; package.json and the lockfile derive from docker/tools/inventory.json.
# Always passed by image.mjs, hence the check skipped above.
ARG BASE_IMAGE
# Empty unless adw e2e passes --build-context certs=$AGENT_CA_DIR (company root certificates).
FROM scratch AS certs
FROM ${BASE_IMAGE}
ARG BASE_USER=root
USER root
COPY package.json package-lock.json /opt/adw-e2e/
# PEM or DER files, as the entrypoint accepts them, trusted for npm ci only; nothing is baked into the image.
RUN --mount=type=bind,from=certs,target=/tmp/adw-certs \
    find /tmp/adw-certs -maxdepth 1 -type f \( -iname '*.crt' -o -iname '*.pem' -o -iname '*.cer' -o -iname '*.cert' \) \
      -exec sh -c 'grep -q -- "-----BEGIN CERTIFICATE-----" "$1" && cat "$1" || openssl x509 -inform DER -in "$1"' sh {} \; \
      > /tmp/adw-ca.pem \
    && if [ -s /tmp/adw-ca.pem ]; then export NODE_EXTRA_CA_CERTS=/tmp/adw-ca.pem; fi \
    && npm ci --prefix /opt/adw-e2e --omit=dev --no-audit --no-fund \
    && rm -f /tmp/adw-ca.pem \
    && ln -sf /opt/adw-e2e/node_modules/.bin/acpx /opt/adw-e2e/node_modules/.bin/claude-agent-acp \
       /opt/adw-e2e/node_modules/.bin/codex-acp /usr/local/bin/
# The fake gh, tea and az (pr-cli.mjs): opening a pull request is recorded, never sent to the real host; ahead of any
# real one on PATH (/usr/local/bin before /usr/bin).
COPY pr-cli.mjs /opt/adw-e2e/
RUN for t in gh tea az; do \
      printf '#!/bin/sh\nexec node /opt/adw-e2e/pr-cli.mjs %s "$@"\n' "$t" > "/usr/local/bin/$t" && chmod 755 "/usr/local/bin/$t"; \
    done
USER ${BASE_USER}
