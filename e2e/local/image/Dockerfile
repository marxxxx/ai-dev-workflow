# check=skip=InvalidDefaultArgInFrom
# adw e2e: the project's dev image plus the fake PR CLIs; the ACP tooling comes from the base image.
# Built by e2e/local/image.mjs. BASE_IMAGE is always passed by image.mjs, hence the check skipped above.
ARG BASE_IMAGE
FROM ${BASE_IMAGE}
ARG BASE_USER=root
USER root
# The ACP tooling ships in the base image (/opt/agent-tools); an older image lacks it.
RUN test -x /opt/agent-tools/node_modules/.bin/acpx \
    || { echo "adw e2e: acpx is missing from the dev image (/opt/agent-tools); rebuild the image from a current adw version." >&2; exit 1; } \
    && ln -sf /opt/agent-tools/node_modules/.bin/acpx /opt/agent-tools/node_modules/.bin/claude-agent-acp \
       /opt/agent-tools/node_modules/.bin/codex-acp /usr/local/bin/
# The fake gh, tea and az (pr-cli.mjs): opening a pull request is recorded, never sent to the real host; ahead of any
# real one on PATH (/usr/local/bin before /usr/bin).
COPY pr-cli.mjs /opt/adw-e2e/
RUN for t in gh tea az; do \
      printf '#!/bin/sh\nexec node /opt/adw-e2e/pr-cli.mjs %s "$@"\n' "$t" > "/usr/local/bin/$t" && chmod 755 "/usr/local/bin/$t"; \
    done
USER ${BASE_USER}
