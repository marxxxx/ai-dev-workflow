# syntax=docker/dockerfile:1
# ---------------------------------------------------------------------------
# ai-dev-workflow — BASE image (hand-maintained, NOT generated)
#
# This file is a hand-owned published artifact of the ai-dev-workflow project.
# It is NOT produced by the agent-src/ generator and carries no "DO NOT EDIT"
# banner semantics — edit it directly. `npm run check` does not cover it.
#
# What this image provides (language-agnostic w.r.t. the app under test):
#   - Debian-slim + a pinned Node LTS (required by the agent CLIs / Playwright /
#     ccusage / the generator)
#   - git, gh, ripgrep, ca-certificates, Playwright system deps + chromium
#   - The three coding agents: Claude Code, Codex, OpenCode
#   - MCP servers pre-registered for each agent: serena, playwright, context7
#   - superpowers (skill library) and ccusage (cost reporting)
#   - The ai-dev-workflow generator on PATH as `ai-dev-workflow` (runs offline)
#
# Build (context MUST be the repo root so the generator can be copied in):
#   docker build -f docker/Dockerfile -t ai-dev-workflow .
#
# The container runs as root only long enough for entrypoint.sh to remap to the
# host UID/GID and drop privileges with gosu. See docker/README.md.
# ---------------------------------------------------------------------------

# Pinned Node LTS on Debian slim. Bumping the tag is the supported way to move
# the base Node version.
FROM node:22-bookworm-slim

# --- Tunable tool versions (pin for reproducibility) -----------------------
# Left as floating tags by default so a fresh build picks up upstream fixes;
# pin any of these to an exact version for a reproducible image.
ARG CLAUDE_CODE_PKG="@anthropic-ai/claude-code"
ARG CODEX_PKG="@openai/codex"
ARG OPENCODE_PKG="opencode-ai"
ARG PLAYWRIGHT_MCP_PKG="@playwright/mcp"
ARG CONTEXT7_PKG="@upstash/context7-mcp"
ARG PLAYWRIGHT_PKG="playwright"
ARG CCUSAGE_PKG="ccusage"
ARG SUPERPOWERS_REPO="https://github.com/obra/superpowers"

ENV DEBIAN_FRONTEND=noninteractive \
    # Browsers live in a world-readable shared path so both the (root) build
    # step and the (non-root) runtime user can use them.
    PLAYWRIGHT_BROWSERS_PATH=/opt/ms-playwright \
    # uv caches/pythons under /opt so the runtime `dev` user reuses what the
    # build primed instead of re-downloading serena's Python on first run.
    UV_INSTALL_DIR=/usr/local/bin \
    UV_CACHE_DIR=/opt/uv/cache \
    UV_PYTHON_INSTALL_DIR=/opt/uv/python \
    UV_TOOL_DIR=/opt/uv/tools \
    # Non-root runtime user; entrypoint.sh remaps its UID/GID to the host's.
    APP_USER=dev \
    APP_HOME=/home/dev

# --- 1. System packages -----------------------------------------------------
# ca-certificates, curl, gnupg for repos; git/ripgrep for the agents; gosu for
# the privilege drop; python3 as a fallback interpreter. gh from GitHub's repo.
RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends \
        ca-certificates curl gnupg git ripgrep gosu python3 xz-utils; \
    install -m 0755 -d /etc/apt/keyrings; \
    curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
        -o /etc/apt/keyrings/githubcli-archive-keyring.gpg; \
    chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg; \
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
        > /etc/apt/sources.list.d/github-cli.list; \
    apt-get update; \
    apt-get install -y --no-install-recommends gh; \
    rm -rf /var/lib/apt/lists/*

# --- 2. Non-root runtime user ----------------------------------------------
# The node base image already ships a uid/gid 1000 (`node`), so let the system
# assign `dev`'s ids here — the exact build-time ids don't matter because
# entrypoint.sh remaps them at runtime to the host's UID/GID (so files written
# into the /workspace bind-mount are host-owned).
RUN set -eux; \
    if ! getent group "${APP_USER}" >/dev/null; then groupadd "${APP_USER}"; fi; \
    if ! id -u "${APP_USER}" >/dev/null 2>&1; then \
        useradd --gid "${APP_USER}" --create-home --home-dir "${APP_HOME}" \
            --shell /bin/bash "${APP_USER}"; \
    fi

# --- 3. uv (for serena) -----------------------------------------------------
RUN set -eux; \
    curl -LsSf https://astral.sh/uv/install.sh | sh; \
    uv --version; \
    mkdir -p "${UV_CACHE_DIR}" "${UV_PYTHON_INSTALL_DIR}" "${UV_TOOL_DIR}"

# --- 4. Coding agent CLIs + MCP servers + cost tooling (global npm) ---------
# The playwright/context7 MCP servers are installed as real global bins (not
# left to `npx` at runtime) so they start offline. serena runs via `uvx`.
RUN set -eux; \
    npm install -g --no-fund --no-audit \
        "${CLAUDE_CODE_PKG}" \
        "${CODEX_PKG}" \
        "${OPENCODE_PKG}" \
        "${PLAYWRIGHT_MCP_PKG}" \
        "${CONTEXT7_PKG}" \
        "${PLAYWRIGHT_PKG}" \
        "${CCUSAGE_PKG}"; \
    npm cache clean --force

# --- 5. Playwright system deps + chromium ----------------------------------
# install-deps apt-installs the shared libraries chromium needs; install pulls
# the browser into PLAYWRIGHT_BROWSERS_PATH. Made world-readable for `dev`.
RUN set -eux; \
    playwright install-deps chromium; \
    playwright install chromium; \
    chmod -R a+rX "${PLAYWRIGHT_BROWSERS_PATH}"; \
    rm -rf /var/lib/apt/lists/*

# --- 6. Bake the generator (copied from the build context = repo root) ------
# Installed globally so `ai-dev-workflow generate|check|init` run offline from
# the mounted project. Zero runtime deps → this is just a bin symlink.
COPY package.json LICENSE /opt/ai-dev-workflow/
COPY agent-src /opt/ai-dev-workflow/agent-src
RUN set -eux; \
    npm install -g --no-fund --no-audit /opt/ai-dev-workflow; \
    ai-dev-workflow --help >/dev/null 2>&1 || true; \
    npm cache clean --force

# --- 7. superpowers (skill library) ----------------------------------------
# Cloned into the shared skel; wired into the agents' config at configure time.
# Best-effort: a clone failure must not break the image build.
RUN set -eux; \
    git clone --depth 1 "${SUPERPOWERS_REPO}" /opt/superpowers || \
        echo "WARN: superpowers clone failed; install it manually inside the container"

# --- 8. Agent config skel + MCP registration --------------------------------
# configure-agents.sh is idempotent and reused at runtime by entrypoint.sh
# (bind-mounts shadow build-time config, so it must be re-applied on start).
# Here it primes the default /home/dev config for the no-bind-mount case.
COPY docker/configure-agents.sh /usr/local/bin/configure-agents.sh
COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN set -eux; \
    chmod +x /usr/local/bin/configure-agents.sh /usr/local/bin/entrypoint.sh; \
    # Prime serena so its Python + package are cached in /opt (best-effort).
    HOME="${APP_HOME}" uvx --from git+https://github.com/oraios/serena \
        serena --help >/dev/null 2>&1 || \
        echo "WARN: serena prime failed; it will fetch on first use (needs network)"; \
    chmod -R a+rX /opt/uv; \
    # Bake MCP config into the default home for runs without config bind-mounts.
    gosu "${APP_USER}" env HOME="${APP_HOME}" /usr/local/bin/configure-agents.sh; \
    chown -R "${APP_USER}:${APP_USER}" "${APP_HOME}"

WORKDIR /workspace

# Root at start so entrypoint.sh can remap the user; it drops to `dev` via gosu.
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["bash"]
