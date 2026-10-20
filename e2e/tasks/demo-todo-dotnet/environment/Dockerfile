# E2E task image: the workflow image (which ships acpx and the ACP adapters Harbor pins) plus E2E-only tooling.
FROM ai-dev-workflow-dotnet:latest
# Harbor may npm-install its ACP bridge/adapters as the agent user at runtime: let it own the global prefix.
RUN chown -R 1000:1000 /usr/local/lib/node_modules /usr/local/bin \
    && mkdir -p /workspace /opt/e2e && chown 1000:1000 /workspace
COPY --chown=1000:1000 seed/repo /workspace
# Every checkout builds into its own bin/ and obj/ (git-ignored): the agent may build /workspace and
# worktrees, and the verifier a clone of the PR head, in this one container. The base image's shared
# ArtifactsPath is keyed by project name only, so parallel builds of two checkouts would collide.
ENV ArtifactsPath=
# Warm NuGet cache: restore the seed as the agent user, so the agent's builds, its own tests and the
# verifier need no package download. Packages land in NUGET_PACKAGES (/home/dev/.nuget/packages). The
# restore runs in a throwaway copy, so /workspace ships without obj/ (the entrypoint warns about
# in-tree build output it finds at start).
USER 1000:1000
RUN d="$(mktemp -d)" && cp -r /workspace/. "$d" && cd "$d" && HOME=/home/dev dotnet restore DemoTodo.slnx \
    && cd / && rm -rf "$d"
USER root
COPY seed/issue.md /opt/e2e/issue.md
COPY seed/seed.sh /usr/local/lib/agent-runtime/startup.d/50-e2e-seed
RUN chmod 0755 /usr/local/lib/agent-runtime/startup.d/50-e2e-seed
ENV PROJECT_ROOT=/workspace
WORKDIR /workspace
HEALTHCHECK --interval=3s --timeout=3s --retries=100 CMD test -f /tmp/e2e-ready
