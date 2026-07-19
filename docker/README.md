<!-- hand-maintained, NOT generated. This directory is a published artifact of
     ai-dev-workflow and is NOT produced by the agent-src/ generator, so it is
     not covered by `npm run check`. Edit these files directly. -->

# Run ai-dev-workflow in a container

The container **is the runtime where the coding agents execute**. You mount your
project's repo root into it and run one of the agents (Claude Code, Codex, or
OpenCode) — with the recommended MCP tooling (serena, playwright + chromium,
context7), plus superpowers, ccusage, and the `ai-dev-workflow` generator
**already installed and configured** inside the image. Nothing to set up per
container.

The folders that must survive container restarts — each agent's config/login and
Serena's cache — are **bind-mounted** from your host, so logins are reused with
zero re-auth and Serena's index/memories persist.

## Images

| Image | What it adds | Dockerfile |
|---|---|---|
| `ai-dev-workflow` | **Base.** Debian-slim + Node LTS + git/gh/ripgrep + Playwright chromium; the three agents with serena/playwright/context7 pre-registered; superpowers, ccusage, and the `ai-dev-workflow` generator on `PATH`. Language-agnostic w.r.t. the app under test. | `docker/Dockerfile` |
| `ai-dev-workflow-node` | Base + app-facing Node LTS declared + `build-essential` / native build tooling. | `docker/Dockerfile.node` |
| `ai-dev-workflow-dotnet` | Base + the .NET SDK. | `docker/Dockerfile.dotnet` |

The base stays language-agnostic; the Node/.NET **runtimes for the app under
test** live only in the derived images. Other stacks extend the base themselves
(`FROM ai-dev-workflow`).

## Build

The build context **must be the repo root** (the Dockerfile copies the generator
in), so build with `-f`:

```bash
# base
docker build -f docker/Dockerfile         -t ai-dev-workflow        .
# derived (require the base to exist first)
docker build -f docker/Dockerfile.node    -t ai-dev-workflow-node   .
docker build -f docker/Dockerfile.dotnet  -t ai-dev-workflow-dotnet .
```

The chromium browser layer is large — that is expected; the browser is core to
the `qa-engineer`.

## Run

`docker run` with your repo mounted at `/workspace` and the run arg selecting the
agent:

```bash
docker run --rm -it \
  -e HOST_UID=$(id -u) -e HOST_GID=$(id -g) \
  -v "$(pwd)":/workspace \
  -v "$HOME/.claude":/home/dev/.claude \
  -v "$HOME/.codex":/home/dev/.codex \
  -v "$HOME/.config/opencode":/home/dev/.config/opencode \
  -v "$HOME/.serena":/home/dev/.serena \
  ai-dev-workflow claude        # or: codex | opencode | bash
```

### With docker compose (recommended)

`docker/docker-compose.yml` encodes all of the above. From the repo root:

```bash
# create the host config dirs once so they aren't auto-created as root:
mkdir -p ~/.claude ~/.codex ~/.config/opencode ~/.serena

export HOST_UID=$(id -u) HOST_GID=$(id -g)

docker compose -f docker/docker-compose.yml build
docker compose -f docker/docker-compose.yml run --rm ai-dev-workflow            # shell
docker compose -f docker/docker-compose.yml run --rm ai-dev-workflow claude     # agent
docker compose -f docker/docker-compose.yml run --rm ai-dev-workflow codex
docker compose -f docker/docker-compose.yml run --rm ai-dev-workflow opencode
docker compose -f docker/docker-compose.yml run --rm ai-dev-workflow ai-dev-workflow check
```

The default command is an interactive shell; **override the command** to launch
a specific agent, as shown.

## Mounts

| Host path | Container path | Purpose |
|---|---|---|
| your repo root | `/workspace` | The project the agents work on. Files written here are **host-owned** (see UID/GID mapping). |
| `~/.claude` | `/home/dev/.claude` | Claude Code login/credentials + session logs (read by ccusage). |
| `~/.codex` | `/home/dev/.codex` | Codex login + config + session logs. |
| `~/.config/opencode` | `/home/dev/.config/opencode` | OpenCode config + session logs. |
| `~/.serena` | `/home/dev/.serena` | Serena's semantic index / memories — persisted across restarts. |

All config mounts are **read-write** (the agents write session logs there and
ccusage reads them).

## Auth & persistence

- **Reuse existing host logins — zero re-auth.** Because the agent config dirs
  are bind-mounted, an agent you are already logged into on the host is logged in
  inside the container too. Serena's cache is likewise a bind-mount, so it does
  not re-index after a restart.
- **Non-interactive / CI fallback.** `ANTHROPIC_API_KEY` (and `OPENAI_API_KEY`,
  `CONTEXT7_API_KEY`, `GITHUB_TOKEN` / `GH_TOKEN`) are passed through by the
  compose file and honored when no login is mounted.
- **MCP registration survives the bind-mounts.** The image bakes MCP config into
  its default home, but a bind-mount of a config dir *shadows* that. The
  entrypoint therefore **re-applies** the serena/playwright/context7 registration
  against the mounted dirs on every start (idempotently, without clobbering any
  server you already configured). Verify inside the container with
  `claude mcp list` (and the equivalent for the other agents).
- **Claude specifics.** Claude Code keeps its *user* MCP config in `~/.claude.json`
  (a file at the home root, outside the mounted `~/.claude` directory), so that config
  is baked into the image and re-applied on start; the `~/.claude` bind-mount persists
  Claude's login (`~/.claude/.credentials.json`) and session logs.

## UID/GID mapping (host-owned files)

The container starts as root only long enough for `entrypoint.sh` to remap its
`dev` user to `HOST_UID` / `HOST_GID`, then drops privileges with `gosu`. Pass
your own IDs so files the agents create in `/workspace` are owned by you, not
root:

```bash
-e HOST_UID=$(id -u) -e HOST_GID=$(id -g)      # docker run
HOST_UID=$(id -u) HOST_GID=$(id -g) docker compose ... run ...
```

The entrypoint also marks `/workspace` as a git `safe.directory`.

## Running the generator in the container

The generator is baked in and runs **offline** against the mounted repo:

```bash
docker compose -f docker/docker-compose.yml run --rm ai-dev-workflow ai-dev-workflow generate
docker compose -f docker/docker-compose.yml run --rm ai-dev-workflow ai-dev-workflow check
docker compose -f docker/docker-compose.yml run --rm ai-dev-workflow ai-dev-workflow init
```

## Extending the base in a consuming project

A consuming project does **not** need to be a Node project — the generator runs
from the baked-in copy. To add your own runtime or tools, extend the base:

```dockerfile
# your-project/docker/Dockerfile
FROM ai-dev-workflow
# add your app's runtime / build tools here (or start FROM ai-dev-workflow-node
# / ai-dev-workflow-dotnet if one of those already fits)
```

Then copy `docker/docker-compose.yml` into your project, point the `/workspace`
mount at your repo root, and set `image:` to your extended image. Describe how to
start your app for the `qa-engineer` in your project's `AGENTS.md` (see the
top-level README's *End-to-end testing* section).

## Not published here

Building and **pushing** these images to a registry (e.g. Azure Container
Registry) is intentionally out of scope for this artifact — it is handled by a
separate CI/publishing setup.

## Version pinning

The base pins Node via its `FROM node:22-bookworm-slim` tag. The agent CLIs, MCP
servers, and .NET channel are exposed as build `ARG`s (`CLAUDE_CODE_PKG`,
`CODEX_PKG`, `OPENCODE_PKG`, `DOTNET_CHANNEL`, …) — pass `--build-arg` to pin any
of them to an exact version for a reproducible image.
