---
name: dependency-update-check
description: Use when checking, updating, or bumping the docker/tools/inventory.json pinned dependency set (base image, npm packages, system tools, serena/superpowers revisions) for ai-dev-workflow — classifies each available update as non-breaking, adjustable, or needs-a-decision and routes it to the correct PR or issue.
---

# Dependency Update Check

## Overview

Maintain the `docker/tools/inventory.json` pinned dependency set (base image, npm packages,
system tools, and the serena / superpowers source revisions). Check every pin against its
upstream source, classify the available updates, and take the correct action for each class in a
**single pass** — but split the result into **at most three PRs/issues**: one non-breaking PR,
one adjustable-breaking PR, one (or a few) needs-a-decision issue(s). **Never mix unrelated change
classes into one PR.**

**The iron rule:** never hand-edit derived files (`docker/tools/package.json`,
`package-lock.json`, `Dockerfile*` `ARG`/`FROM` lines). Always go through `inventory.json` +
`node docker/tools/inventory.mjs sync` (or `update`), per `docker/README.md` and `AGENTS.md`.

## Workflow

### 1. Discover available updates

From the repo root:

```bash
node docker/tools/inventory.mjs outdated
```

This resolves the latest upstream version for every npm package, the `node:24-bookworm-slim` base
image, the Azure CLI Debian package + azure-devops extension, `uv`, the .NET SDK channel, and the
serena / superpowers HEAD revisions — honoring `updatePolicy` in `inventory.json` (major-version
holds, `npmFollowDependency` coupling such as `playwright` following `@playwright/mcp`). Treat its
output as the authoritative "current pin → latest available" diff for this pass.

For each changed dependency, fetch its changelog / release notes from upstream (npm `CHANGELOG.md`
or GitHub releases; Azure CLI / azure-devops extension release notes; .NET SDK release notes; the
serena / superpowers commit range between the pinned revision and new HEAD) to classify the change.

### 2. Classify each update

| Class | Definition |
|-------|------------|
| **Non-breaking** | Patch/minor (or a major explicitly allowed by `updatePolicy` — `npmMajorHolds` not hit) with no documented breaking API/CLI/config change for the surfaces this repo touches: Dockerfile build args, `docker/tools/*.mjs`, `docker/*.sh`, MCP server configs, agent CLIs invoked in `docker/entrypoint.sh` / `docker/agent-wrapper.sh`. |
| **Adjustable** | Breaking, but the fix is mechanical and low-risk — a renamed CLI flag, moved config path, changed npm export, Dockerfile `ARG` rename — locatable precisely in the changelog and patchable here with a scoped, verifiable change. |
| **Needs a decision** | Safe adaptation is unclear; affects security posture, authentication flows, or removes a relied-on feature; or `updatePolicy.npmMajorHolds` currently blocks the package at an old major and upstream has moved further ahead. |

### 3. Act per class

**Non-breaking → direct PR**

1. `node docker/tools/inventory.mjs update --only <names>` for the non-breaking npm subset (or edit
   `inventory.json` directly for non-npm pins, then `node docker/tools/inventory.mjs sync`).
2. `node docker/tools/inventory.mjs check` must pass (no drift).
3. `node docker/build.mjs` — confirm all three images still build.
4. Run `node --test docker/tests/*.test.mjs` plus `docker/tests/runtime-smoke.sh` **if a container
   runtime is available**; note in the PR if smoke tests could not run.
5. Open a PR titled `chore(docker): update <deps> (non-breaking)` summarizing each bump with a link
   to its changelog / release notes, and stating what was verified (check, build, tests).

**Adjustable breaking → PR with fixes**

1. Apply the same `update` / `sync` steps for this subset.
2. Make the **minimal** corresponding changes in `docker/Dockerfile*`, `docker/*.sh`,
   `docker/tools/*.mjs`, or MCP/config wiring so the stack keeps working — do not over-refactor
   beyond what the breaking change requires.
3. Verify with `inventory.mjs check`, `node docker/build.mjs`, and the docker test suite.
4. Open a PR titled `fix(docker): adapt to <dep> breaking change` that: quotes the specific
   breaking change from the changelog, explains the adjustment, and lists verification steps. Flag
   anything you could not verify locally (e.g. requires the published Docker Hub image or a live
   Azure DevOps org).

**Needs a decision → issue, no code change**

1. **Do not** modify `inventory.json` or any derived file for this subset.
2. Open one GitHub issue titled `Dependency update needs a decision: <dep> <old> → <new>` (one per
   dependency, or one grouping closely related ones — e.g. a coordinated `playwright` +
   `@playwright/mcp` bump) containing:
   - current pin, target version, link to changelog / release notes;
   - the specific breaking change(s) found and why they need a human call;
   - any `updatePolicy` entry in force (e.g. `npmMajorHolds`);
   - a recommendation if you have one, **clearly marked as a suggestion**.
3. `@`-mention the repository owner for direction; do **not** open a PR for these in this pass.

## Constraints

- **Never hand-edit** `docker/tools/package.json`, `package-lock.json`, or `Dockerfile*`
  `ARG`/`FROM` lines — always route through `inventory.json` + `inventory.mjs sync`/`update`.
- Keep the three outcome classes in **separate** PRs/issues; never combine a non-breaking bump and
  a breaking adjustment in one PR.
- If `inventory.mjs check` reports drift you did not intend, **stop and fix it** before opening any
  PR — a merged PR must leave the repo drift-free.
- Do not touch unrelated pins outside this pass's diff.

## Common Mistakes

- Editing `Dockerfile` `FROM`/`ARG` or `package-lock.json` by hand instead of via `inventory.json`.
- Bundling a mechanical breaking-change fix into the non-breaking PR "since it's small."
- Bumping a pin that `npmMajorHolds` is deliberately holding without opening a decision issue.
- Claiming build/tests passed without a container runtime — say so instead of implying full
  verification.
