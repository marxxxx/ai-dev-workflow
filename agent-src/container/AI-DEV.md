# Agent dev container

Coding agents (Claude Code, Codex, OpenCode) with the ai-dev-workflow tool stack, running in a
container that sees only this project. Written once by `ai-dev-workflow init`; this file and the
container files are yours to edit. Requires Docker (Docker Desktop on Windows/macOS).

## 1. Start

```sh
./ai-dev.sh                 # shell in the container
./ai-dev.sh <command> ...   # run one command, e.g. ./ai-dev.sh git status
```

PowerShell: `.\ai-dev.ps1` instead of `./ai-dev.sh`. If scripts are blocked, run
`powershell -ExecutionPolicy Bypass -File .\ai-dev.ps1` once, or
`Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`. PowerShell swallows a bare `--`
and empty arguments before the script sees them: write `'--'` (e.g. `.\ai-dev.ps1 npm test '--' --watch`),
or open a shell with `.\ai-dev.ps1` and type the command there. If `./ai-dev.sh` reports
*permission denied* (for example after a commit from Windows), run `chmod +x ai-dev.sh` or
`sh ai-dev.sh`.

Logins and caches live in this project's `agent-home` Docker volume and survive restarts and
image updates. `docker volume rm @@SLUG@@-ai_agent-home` deletes them.

## 2. Log in your coding agent

Once per agent you use:

```sh
./ai-dev.sh claude                       # follow the login prompts, then /exit
./ai-dev.sh codex login --device-auth    # opens a device code for your host browser
./ai-dev.sh opencode auth login
```

Then work with:

```sh
./ai-dev.sh claude --dangerously-skip-permissions
./ai-dev.sh codex --yolo
./ai-dev.sh opencode
```

and ask the agent to work on a ticket with `agent-dev`.

## 3. Ticketing and Git

@@TICKETING@@

## 4. Behind a corporate proxy?

Put per-machine settings in `.env.ai-dev` in the project root (git-ignored, read on every start,
so you can add it any time):

```sh
AGENT_CA_DIR=/absolute/path/to/company-root-certificates
HTTPS_PROXY=http://proxy.example:8080
HTTP_PROXY=http://proxy.example:8080
NO_PROXY=localhost,127.0.0.1,::1
```

When `AGENT_CA_DIR` is set, the launchers add `compose.ai-dev.certs.yml` and the container trusts
those certificates (`*.crt`, `*.pem`, `*.cer`, `*.cert`). Keep `localhost,127.0.0.1,::1` in
`NO_PROXY`. `.env.ai-dev` also takes `AZURE_TENANT_ID`, `CONTEXT7_API_KEY` and `AGENT_IMAGE`
(e.g. to pin a dated image tag).

## 5. Docker inside the container (opt-in)

The container has the Docker CLI but no daemon. With `AGENT_DIND=1` in `.env.ai-dev`, the launchers
add `compose.ai-dev.dind.yml`: a privileged Docker daemon next to the agent, so it can build images
and run `docker compose` workloads and Testcontainers. Ports published by nested containers answer
on `localhost`. With `AGENT_CA_DIR` set too, `compose.ai-dev.dind-certs.yml` makes the daemon trust
those certificates (PEM only) for image pulls.

**This is root-equivalent:** any agent in the container can become root on the host (Linux) or in
the Docker Desktop VM, which reaches your drives (Windows). Enable it only where that is acceptable.

The daemon keeps running after the agent exits. Stop it, once no agent session is left, with
`docker compose -p @@SLUG@@-ai down`. Its images and build cache stay in the
`@@SLUG@@-ai_docker-data` volume; `docker volume rm @@SLUG@@-ai_docker-data` deletes them.

## 6. Customize

`compose.ai-dev.yml` is yours: add a database or other services, publish ports, add
`node_modules` volumes for nested packages. Keep the `/workspace` bind, the `agent-home` volume,
the capability set and the `HOST_UID`/`HOST_GID` settings: the runtime depends on them.
Details: https://github.com/marxxxx/ai-dev-workflow/blob/main/docker/README.md
