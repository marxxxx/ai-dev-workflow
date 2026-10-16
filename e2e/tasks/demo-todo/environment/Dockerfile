# E2E task image: the workflow image plus E2E-only tooling. The product image stays unchanged.
FROM ai-dev-workflow-node:latest
# Harbor npm-installs its ACP bridge/adapters as the agent user at runtime: preinstall the
# versions Harbor 0.24.0 pins and let the agent user own the global prefix.
RUN npm install -g acpx@0.11.2 @zed-industries/claude-code-acp@0.16.2 @agentclientprotocol/codex-acp@1.12.0 \
    && chown -R 1000:1000 /usr/local/lib/node_modules /usr/local/bin \
    && mkdir -p /workspace /opt/e2e && chown 1000:1000 /workspace
COPY --chown=1000:1000 seed/repo /workspace
COPY seed/issue.md /opt/e2e/issue.md
COPY seed/seed.sh /usr/local/lib/agent-runtime/startup.d/50-e2e-seed
RUN chmod 0755 /usr/local/lib/agent-runtime/startup.d/50-e2e-seed
ENV PROJECT_ROOT=/workspace
WORKDIR /workspace
HEALTHCHECK --interval=3s --timeout=3s --retries=100 CMD test -f /tmp/e2e-ready
