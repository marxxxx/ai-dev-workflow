# Self-development container for ai-dev-workflow

**Date:** 2026-09-19
**Status:** Approved design, pending implementation

## Problem

`ai-dev-workflow` is a *generator*, not a consuming project. It has no `ai-project.json`
and no generated `.claude/.codex/.opencode` dev-cycle definitions. Yet the tool images it
ships (Node 24, git, `gh`, Serena, Playwright, Context7, Superpowers) are exactly the tool
stack you want when working *on this repo itself*.

The existing container cannot be pointed at this repo. `docker/launch-agent.mjs`
`readProjectState()` hard-requires `/workspace/ai-project.json`, and it is called by both:

- `configureRuntime()` — run at **every** container startup via `entrypoint.sh` →
  `configure-agents.sh` → `launch-agent.mjs --configure`, and
- `buildLaunchPlan()` — run on **every** agent launch.

So today the container dies at startup here with
`ai-project.json is required in /workspace`.

## Goal

Provide a container entry, shipped by this repo, for working on this repo. It exposes only
the **tool stack** — harnesses (Claude Code / Codex / OpenCode), managed MCP servers, and
GitHub CLI — and deliberately **not** the dev-cycle skills and subagents the generator
produces for consuming projects.

## Non-goals

- No generator run in or for this repo; no `.claude/.codex/.opencode` dev-cycle definitions.
- No `.devcontainer/` (VS Code spec); the entry is a root Compose file.
- No new image variant; the **base** image already carries everything this repo needs.
- No change to consuming-project behavior: a missing `ai-project.json` must still fail
  loudly in the normal (non-tool-stack) path.
- No `package.json` `files` allowlist change — no new `lib/*.mjs` module is added.

## Design

### 1. Tool-stack-only runtime mode — `docker/launch-agent.mjs`

The only source change. Introduce an opt-in `toolstackOnly` flag:

- `readProjectState(workspace, { toolstackOnly = false } = {})` — when `toolstackOnly` is
  true, return the neutral state `{ backend: undefined, organization: undefined,
  projectServers: {} }` immediately, **without** reading `ai-project.json`, `.mcp.json`, or
  `.codex/config.toml` from the workspace.
- Thread the option through `configureRuntime(opts)` and
  `buildLaunchPlan(agent, forwardedArgs, opts)` into `readProjectState`.
- In `runCli()`, derive it from `process.env.AGENT_TOOLSTACK_ONLY === '1'` and pass it to
  both the `--configure` call and the `buildLaunchPlan` call.

Behavior with the flag set:

- `configureRuntime` still performs all **tool-stack** setup — Codex `trust_level`, the
  Superpowers marketplace/plugin registration, the Serena config materialization,
  the OpenCode config dir. None of that depends on project state.
- `buildLaunchPlan` produces only the **managed MCP servers** — `serena`, `playwright`,
  `context7`. `backend` is undefined, so there is no `ado` server and no Azure auth gate;
  `projectServers` is empty, so no project MCP servers are merged.

Behavior with the flag unset is unchanged: a missing `ai-project.json` still throws, so
consuming projects keep their "did you forget to run the generator?" safety net.

### 2. Container entry — root `compose.ai-dev.yml`

A self-targeted analog of `docker/docker-compose.yml`, committed at the repo root:

- `image: ${AGENT_IMAGE:-marxx/ai-dev-workflow:latest}` — the base image (Node 24 + git +
  `gh` + Serena/Playwright/Context7/Superpowers). No local build required; overridable to a
  locally built or pinned tag.
- The same hardened service shape as the existing template: `init: true`, `stdin_open`,
  `tty`, `cap_drop: [ALL]` with the minimal `cap_add` set the entrypoint needs for
  UID/GID remap, `no-new-privileges`, `shm_size: 1gb`.
- `environment` adds `AGENT_TOOLSTACK_ONLY: "1"` alongside the usual passthrough:
  `PROJECT_ROOT` (required, absolute), `HOST_UID`/`HOST_GID` (default 1000),
  `CONTEXT7_API_KEY` (optional). `AZURE_TENANT_ID` is not relevant here and is omitted.
- Volumes: bind `${PROJECT_ROOT}` → `/workspace` (`create_host_path: false`), and the
  persistent `agent-home` named volume → `/home/dev`. No `ai-project.json`, no generated
  definitions, no dependency-masking volumes (this repo is zero-dependency and has no
  `node_modules`).
- `command: ["bash"]`.

`AGENT_TOOLSTACK_ONLY` reaches the runtime user: the entrypoint re-execs through
`gosu ... env HOME=... USER=... LOGNAME=...`, which overrides only those names and preserves
the rest of the environment.

Placing the file at the repo root (rather than under `docker/`) makes the self-dev launch
discoverable and lets it run with a bare `-f compose.ai-dev.yml` from the checkout.

### 3. GitHub setup and documentation

"GitHub setup" is satisfied by the base image shipping `gh` and `git`, plus the persistent
`agent-home` volume: a one-time `gh auth login` (and each agent's own `login`) inside the
container persists across `run --rm` invocations because `/home/dev` is a named volume.

Add a **"Working on this repo in a container"** section to `docker/README.md`, pointed to
from the root `README.md`. It documents (POSIX and PowerShell):

```bash
export PROJECT_ROOT="$(pwd)" HOST_UID="$(id -u)" HOST_GID="$(id -g)"
docker compose -f compose.ai-dev.yml run --rm ai-dev-workflow gh auth login   # one-time
docker compose -f compose.ai-dev.yml run --rm ai-dev-workflow claude --dangerously-skip-permissions
docker compose -f compose.ai-dev.yml run --rm ai-dev-workflow codex --yolo
docker compose -f compose.ai-dev.yml run --rm ai-dev-workflow opencode
docker compose -f compose.ai-dev.yml run --rm ai-dev-workflow bash
```

The section states plainly that this entry provides the tool stack only — no generated
dev-cycle skills or subagents — and links back to the generator docs for consuming projects.

### 4. Testing — `docker/launch-agent.test.mjs`

Add cases in the existing options-injection style (no environment mutation required):

- `configureRuntime({ workspace, home, superpowersRoot, serenaConfigFile,
  registerCodexPlugin: false, toolstackOnly: true })` **succeeds against a workspace that
  contains no `ai-project.json`**, and still writes the Codex trust / Superpowers /
  Serena config outputs.
- `buildLaunchPlan('codex', [...], { workspace, home, toolstackOnly: true })` against a
  workspace with no `ai-project.json` emits `serena`, `playwright`, and `context7`
  overrides and **no `ado`** override, with no Azure auth call.
- `buildLaunchPlan('claude', [...], { toolstackOnly: true })` writes an effective MCP
  config containing exactly the three managed servers and no project servers.
- One assertion that the CLI path honors `AGENT_TOOLSTACK_ONLY=1` (e.g. via the existing
  `AGENT_RUNTIME_PRINT_PLAN` print-plan hook, or by asserting `runCli`'s wiring reads the
  env var). Keep it minimal and consistent with existing test seams.

Existing tests (which always provide `ai-project.json` and do not set `toolstackOnly`) must
continue to pass unchanged, proving the default path is untouched.

## Files touched

- `docker/launch-agent.mjs` — add `toolstackOnly` option threading + env wiring.
- `docker/launch-agent.test.mjs` — new tool-stack-only cases.
- `compose.ai-dev.yml` — new, repo root.
- `docker/README.md` — new "Working on this repo in a container" section.
- `README.md` — pointer to the new section.

## Risks and mitigations

- **Silent degradation for consuming projects** — mitigated by making the mode opt-in
  (`AGENT_TOOLSTACK_ONLY=1`), never inferred from a missing `ai-project.json`.
- **Env var not reaching the runtime user** — verified: the entrypoint's `gosu env`
  re-exec preserves all environment except the names it explicitly overrides.
- **Image drift** — the self-dev Compose defaults to the published base `:latest`; a pinned
  tag can be supplied via `AGENT_IMAGE` when reproducibility matters.
