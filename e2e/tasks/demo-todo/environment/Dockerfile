# E2E task image: the workflow image (which ships acpx and the ACP adapters Harbor pins) plus E2E-only tooling.
FROM ai-dev-workflow-node:latest
# Harbor may npm-install its ACP bridge/adapters as the agent user at runtime: let it own the global prefix.
RUN chown -R 1000:1000 /usr/local/lib/node_modules /usr/local/bin \
    && mkdir -p /workspace /opt/e2e && chown 1000:1000 /workspace
COPY --chown=1000:1000 seed/repo /workspace
COPY seed/issue.md /opt/e2e/issue.md
COPY seed/seed.sh /usr/local/lib/agent-runtime/startup.d/50-e2e-seed
RUN chmod 0755 /usr/local/lib/agent-runtime/startup.d/50-e2e-seed
ENV PROJECT_ROOT=/workspace
WORKDIR /workspace
HEALTHCHECK --interval=3s --timeout=3s --retries=100 CMD test -f /tmp/e2e-ready
