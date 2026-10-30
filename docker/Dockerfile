# syntax=docker/dockerfile:1
# Reusable agent tool runtime. Build with: docker build -f docker/Dockerfile -t ai-dev-workflow docker
FROM node:24-bookworm-slim@sha256:c86ecead9e55a5210ac1727de38a4ca840bf03dcaf34dc9749addbf383b1920c

ARG UV_VERSION=0.13.6
ARG SERENA_REVISION=ede329aaf0c824bea75455a2926f01420d7aa620
ARG SUPERPOWERS_REVISION=2ce8aa15d05bd57213e6f746f953aafb7ded7a8b
ARG AZURE_CLI_VERSION=2.91.0-1~bookworm
ARG AZURE_DEVOPS_EXTENSION_VERSION=1.0.10
ARG TEA_VERSION=0.16.0
ARG DOCKER_CLI_VERSION=5:29.9.2-1~debian.12~bookworm
ARG DOCKER_BUILDX_VERSION=0.38.1-1~debian.12~bookworm
ARG DOCKER_COMPOSE_VERSION=5.6.1-1~debian.12~bookworm

ENV DEBIAN_FRONTEND=noninteractive \
    APP_USER=dev \
    APP_HOME=/home/dev \
    AGENT_TOOLS_PACKAGE=/opt/agent-tools/package.json \
    AZURE_EXTENSION_DIR=/opt/azure-cli/extensions \
    PLAYWRIGHT_BROWSERS_PATH=/opt/ms-playwright \
    UV_INSTALL_DIR=/usr/local/bin \
    UV_NO_MODIFY_PATH=1 \
    UV_TOOL_BIN_DIR=/opt/uv/bin \
    UV_TOOL_DIR=/opt/uv/tools \
    UV_PYTHON_INSTALL_DIR=/opt/uv/python \
    PATH=/usr/local/bin:/opt/uv/bin:/opt/agent-tools/node_modules/.bin:/usr/sbin:/usr/bin:/sbin:/bin

# System utilities, GitHub CLI, Azure CLI, Docker CLI and libraries required by Chromium. openssl is
# listed explicitly: the entrypoint uses it to convert mounted DER company root certificates. The
# Docker CLI (with buildx and compose) has no daemon here; the opt-in dind overlay provides one.
# Vendor/apt repository contents remain mutable; inventory.json does not claim byte-identical builds.
RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends \
      ca-certificates curl git gnupg gosu libsecret-1-0 openssl python3 ripgrep xz-utils; \
    install -m 0755 -d /etc/apt/keyrings; \
    curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
      -o /etc/apt/keyrings/githubcli-archive-keyring.gpg; \
    chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg; \
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
      > /etc/apt/sources.list.d/github-cli.list; \
    curl -fsSL https://packages.microsoft.com/keys/microsoft.asc -o /tmp/microsoft.asc; \
    gpg --dearmor -o /etc/apt/keyrings/microsoft.gpg /tmp/microsoft.asc; \
    rm /tmp/microsoft.asc; \
    chmod go+r /etc/apt/keyrings/microsoft.gpg; \
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/microsoft.gpg] https://packages.microsoft.com/repos/azure-cli/ bookworm main" \
      > /etc/apt/sources.list.d/azure-cli.list; \
    curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc; \
    chmod go+r /etc/apt/keyrings/docker.asc; \
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian bookworm stable" \
      > /etc/apt/sources.list.d/docker.list; \
    apt-get update; \
    apt-get install -y --no-install-recommends gh "azure-cli=${AZURE_CLI_VERSION}" \
      "docker-ce-cli=${DOCKER_CLI_VERSION}" "docker-buildx-plugin=${DOCKER_BUILDX_VERSION}" \
      "docker-compose-plugin=${DOCKER_COMPOSE_VERSION}"; \
    rm -rf /var/lib/apt/lists/*

# Azure CLI extensions live in the image, not in the persisted ~/.azure of the home volume.
RUN set -eux; \
    az extension add --name azure-devops --version "${AZURE_DEVOPS_EXTENSION_VERSION}" --yes --only-show-errors; \
    chmod -R a+rX "${AZURE_EXTENSION_DIR}"; \
    rm -rf /root/.azure

# Gitea CLI for ticketing.backend gitea, checked against the checksum published next to the binary.
RUN set -eux; \
    file="tea-${TEA_VERSION}-linux-$(dpkg --print-architecture)"; \
    cd /tmp; \
    curl -fsSLO "https://dl.gitea.com/tea/${TEA_VERSION}/${file}"; \
    curl -fsSLO "https://dl.gitea.com/tea/${TEA_VERSION}/${file}.sha256"; \
    sha256sum -c "${file}.sha256"; \
    install -m 0755 "${file}" /usr/local/bin/tea; \
    rm "${file}" "${file}.sha256"

# Keep a stable non-root identity while allowing entrypoint remapping for Linux hosts.
RUN set -eux; \
    userdel node; \
    groupadd --gid 1000 "${APP_USER}"; \
    useradd --uid 1000 --gid 1000 --create-home --home-dir "${APP_HOME}" --shell /bin/bash "${APP_USER}"

# Every Node CLI and MCP server is resolved by the committed lockfile under one prefix.
COPY tools/package.json tools/package-lock.json /opt/agent-tools/
RUN set -eux; \
    npm ci --prefix /opt/agent-tools --omit=dev --no-audit --no-fund; \
    chmod 0755 /opt/agent-tools/node_modules/@ccusage/ccusage-linux-x64/bin/ccusage; \
    npm cache clean --force
COPY tools/inventory.json /opt/agent-tools/inventory.json

# Install Chromium from the exact Playwright revision used by @playwright/mcp.
RUN set -eux; \
    /opt/agent-tools/node_modules/.bin/playwright install-deps chromium; \
    /opt/agent-tools/node_modules/.bin/playwright install chromium; \
    chmod -R a+rX "${PLAYWRIGHT_BROWSERS_PATH}"; \
    rm -rf /var/lib/apt/lists/*

# Pin uv and install Serena as a real offline-usable tool, including its Python runtime.
COPY tools/prepare-serena-config.mjs tools/serena-typescript.mjs /tmp/
RUN set -eux; \
    curl -LsSf "https://astral.sh/uv/${UV_VERSION}/install.sh" -o /tmp/install-uv.sh; \
    sh /tmp/install-uv.sh; \
    rm /tmp/install-uv.sh; \
    uv --version | grep -F "${UV_VERSION}"; \
    mkdir -p /opt/uv/bin /opt/uv/tools /opt/uv/python; \
    uv tool install --python 3.12 "git+https://github.com/oraios/serena.git@${SERENA_REVISION}"; \
    /opt/uv/bin/serena --help >/dev/null; \
    mkdir -p /opt/serena-runtime; \
    node /tmp/prepare-serena-config.mjs \
      /opt/uv/tools/serena-agent/lib/python3.12/site-packages/serena/resources/serena_config.template.yml \
      /opt/serena-runtime/serena_config.yml; \
    node /tmp/serena-typescript.mjs \
      /opt/uv/tools/serena-agent/lib/python3.12/site-packages/solidlsp/language_servers/typescript_language_server.py \
      /opt/agent-tools/node_modules/typescript-serena \
      /opt/serena-runtime/ls; \
    rm /tmp/prepare-serena-config.mjs /tmp/serena-typescript.mjs; \
    chmod -R a+rX,go-w /opt/serena-runtime/ls; \
    chmod -R a+rX /opt/uv

# Pin and validate the complete Superpowers plugin source. Each harness loads this local checkout.
RUN set -eux; \
    git init /opt/superpowers; \
    git -C /opt/superpowers remote add origin https://github.com/obra/superpowers.git; \
    git -C /opt/superpowers fetch --depth 1 origin "${SUPERPOWERS_REVISION}"; \
    git -C /opt/superpowers checkout --detach FETCH_HEAD; \
    test "$(git -C /opt/superpowers rev-parse HEAD)" = "${SUPERPOWERS_REVISION}"; \
    test -f /opt/superpowers/.codex-plugin/plugin.json; \
    test -f /opt/superpowers/skills/using-superpowers/SKILL.md; \
    rm -rf /opt/superpowers/.git

COPY --chmod=0755 configure-agents.sh entrypoint.sh agent-wrapper.sh verify-agent-config.sh verify-tools.sh /usr/local/bin/
COPY launch-agent.mjs validate-workspace.mjs workspace-mounts.mjs check-host-artifacts.mjs docker-proxy-config.mjs tools/verify-browser.mjs tools/verify-mcp.mjs tools/verify-semantic.mjs tools/verify-versions.mjs /usr/local/lib/agent-runtime/
RUN set -eux; \
    ln -s /usr/local/bin/agent-wrapper.sh /usr/local/bin/claude; \
    ln -s /usr/local/bin/agent-wrapper.sh /usr/local/bin/codex; \
    ln -s /usr/local/bin/agent-wrapper.sh /usr/local/bin/opencode; \
    chown -R "${APP_USER}:${APP_USER}" "${APP_HOME}"; \
    mcp-server-azuredevops --version; \
    node /usr/local/lib/agent-runtime/verify-versions.mjs base

WORKDIR /workspace
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["bash"]
