# Agent dev container

Coding agents (Claude Code, Codex, OpenCode) with the ai-dev-workflow tool stack, running in a
container that sees only this project. Written once by `adw init`; this file and the
container files are yours to edit. Requires Docker (Docker Desktop on Windows/macOS).

## 1. Start

```sh
./adw.sh                 # shell in the container
./adw.sh <command> ...   # run one command, e.g. ./adw.sh git status
```

Each start first pulls the newest build of the image (`AGENT_IMAGE` or the default in
`.adw/compose.yml`). If the pull fails, for example offline, the launcher warns and starts the
image already on this machine. A project image that `.adw/compose.yml` builds (`build:`, e.g.
`FROM ${BASE_IMAGE}` with extra tools) is rebuilt on the newest base image instead, from the cache
when the base is unchanged; a base image that exists only on this machine is used as it is.

Without the launchers, run this from the project root (with `PROJECT_ROOT`, `HOST_UID` and `HOST_GID` set, as
the compose file requires): `docker compose --project-directory . -f .adw/compose.yml run --rm ai-dev-workflow`.

PowerShell: `.\adw.ps1` instead of `./adw.sh`. If scripts are blocked, run
`powershell -ExecutionPolicy Bypass -File .\adw.ps1` once, or
`Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`. PowerShell swallows a bare `--`
and empty arguments before the script sees them: write `'--'` (e.g. `.\adw.ps1 npm test '--' --watch`),
or open a shell with `.\adw.ps1` and type the command there. If `./adw.sh` reports
*permission denied* (for example after a commit from Windows), run `chmod +x adw.sh` or
`sh adw.sh`.

Logins and caches live in this project's `agent-home` Docker volume and survive restarts and
image updates. `docker volume rm @@SLUG@@-ai_agent-home` deletes them.

## 2. Log in your coding agent

Once per agent you use:

```sh
./adw.sh claude                       # follow the login prompts, then /exit
./adw.sh codex login --device-auth    # opens a device code for your host browser
./adw.sh opencode auth login
```

Then work with:

```sh
./adw.sh claude --dangerously-skip-permissions
./adw.sh codex --yolo
./adw.sh opencode
```

and ask the agent to work on a ticket with `agent-dev`.

`adw e2e` replays `agent-dev` on one of your tickets using this compose file (see the ai-dev-workflow README, "E2E on your project").

## 3. Ticketing and Git

@@TICKETING@@

## 4. Behind a corporate proxy?

Put per-machine settings in `.adw/.env` (git-ignored, read on every start,
so you can add it any time):

```sh
AGENT_CA_DIR=/absolute/path/to/company-root-certificates
HTTPS_PROXY=http://proxy.example:8080
HTTP_PROXY=http://proxy.example:8080
NO_PROXY=localhost,127.0.0.1,::1
```

When `AGENT_CA_DIR` is set, the launchers add `.adw/compose.certs.yml` and the container trusts
those certificates (`*.crt`, `*.pem`, `*.cer`, `*.cert`). Keep `localhost,127.0.0.1,::1` in
`NO_PROXY`. `.adw/.env` also takes `AZURE_TENANT_ID`, `CONTEXT7_API_KEY` and `AGENT_IMAGE`
(e.g. to pin a dated image tag; the launchers pull that tag).

## 5. Docker inside the container (opt-in)

The container has the Docker CLI but no daemon. With `AGENT_DIND=1` in `.adw/.env`, the launchers
add `.adw/compose.dind.yml`: a privileged Docker daemon next to the agent, so it can build images
and run `docker compose` workloads and Testcontainers. Ports published by nested containers answer
on `localhost`. With `AGENT_CA_DIR` set too, `.adw/compose.dind-certs.yml` makes the daemon trust
those certificates (PEM only) for image pulls.

**This is root-equivalent:** any agent in the container can become root on the host (Linux) or in
the Docker Desktop VM, which reaches your drives (Windows). Enable it only where that is acceptable.

The daemon keeps running after the agent exits. Stop it, once no agent session is left, with
`docker compose -p @@SLUG@@-ai down`. Its images and build cache stay in the
`@@SLUG@@-ai_docker-data` volume; `docker volume rm @@SLUG@@-ai_docker-data` deletes them.

## 6. Customize

`.adw/compose.yml` is yours: add a database or other services, publish ports, add
`node_modules` volumes for nested packages. Keep the `/workspace` bind, the `agent-home` volume,
the capability set and the `HOST_UID`/`HOST_GID` settings: the runtime depends on them.
Relative paths in `.adw/compose.yml` resolve against the project root (the launchers pass
`--project-directory`), so write `./db-init`, not `../db-init`.
Details: https://github.com/marxxxx/ai-dev-workflow/blob/main/docker/README.md

## 7. MCP server (opt-in)

An MCP server in this container lets an MCP client start `agent-dev` on a task and steer it, with
five tools: `start_session` (harness `claude-code`, `codex` or `opencode`, and the task or ticket),
`query_session`, `post_session` (answer the agent's question or give feedback), `list_sessions` and
`terminate_session`. Sessions work like you at the terminal: in this project's working tree, with
your agent logins, on the real ticketing backend.

```sh
./adw.sh mcp        # start it (Ctrl+C stops it)
./adw.sh mcp -d     # start it in the background; it comes back after a reboot until you stop it
./adw.sh mcp down   # stop it
```

Endpoint: `http://localhost:8787/mcp`. Clients send `ADW_MCP_TOKEN` from `.adw/.env` in the
`x-api-key` header (or as `Authorization: Bearer <token>`). There is no OAuth: claude.ai custom
connectors may not accept a static header token; Mistral Vibe and generic MCP clients can set the header.

Settings in `.adw/.env`:

- `ADW_MCP_TOKEN`: 32 characters or more; `init` generates one. Anyone who reaches the port with it
  runs agents in this project.
- `ADW_MCP_BIND` (default `127.0.0.1`) and `ADW_MCP_PORT` (default `8787`): the host address and
  port. `ADW_MCP_BIND=0.0.0.0` makes the server reachable from the network.
- `ADW_MCP_TLS_CERT` and `ADW_MCP_TLS_KEY` (both or neither): a PEM certificate and key, as paths in
  the container, e.g. `/workspace/certs/mcp.pem` for a file in the project. Over plain HTTP the
  token is readable on the network: set them unless the port stays on a trusted network.

One session per workspace: while a session is `running` or `idle`, `start_session` refuses another.
`idle` means the agent waits for an answer or is finished: read `last_message`, then answer with
`post_session` or end the session with `terminate_session`, which frees the workspace.

Agents started through MCP get no Docker daemon, even with `AGENT_DIND=1`. Behind a company proxy
(`AGENT_CA_DIR` set) the launchers add `.adw/compose.mcp-certs.yml` automatically. The server needs
Docker Compose 2.24.4 or later (`docker compose version`).

Not set up yet? Run `adw init` again, keep `.adw/project.json`, set up the dev container and answer
yes to the MCP question. It writes `.adw/compose.mcp.yml` and a token and leaves existing files untouched.
