# adw e2e: the project's dev image plus the pinned ACP tooling that drives the agent under test.
# Built by e2e/local/image.mjs; package.json and the lockfile derive from docker/tools/inventory.json.
ARG BASE_IMAGE
FROM ${BASE_IMAGE}
COPY package.json package-lock.json /opt/adw-e2e/
RUN npm ci --prefix /opt/adw-e2e --omit=dev --no-audit --no-fund \
    && ln -s /opt/adw-e2e/node_modules/.bin/acpx /opt/adw-e2e/node_modules/.bin/claude-code-acp \
       /opt/adw-e2e/node_modules/.bin/codex-acp /usr/local/bin/
