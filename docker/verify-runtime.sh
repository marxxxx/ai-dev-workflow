#!/usr/bin/env bash
# Host-side verification. Does not log in or perform authenticated API calls.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"
node --test docker/tests/workspace.test.mjs docker/launch-agent.test.mjs
for image in ai-dev-workflow ai-dev-workflow-node ai-dev-workflow-dotnet; do
  docker run --rm --init --network none --shm-size 1g \
    --user dev --entrypoint /usr/local/bin/verify-tools.sh "$image"
done
bash docker/tests/runtime-smoke.sh
