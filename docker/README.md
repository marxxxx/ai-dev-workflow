# Coding agents in an isolated project container

Build reusable tool images in this repository and run them from a consuming project.
The complete project is mounted once at `/workspace`, including `.git`, `.agents`,
`.codex`, `.claude` and `.opencode`. Startup uses those generated definitions without
rewriting them. Run the generator on the **host** before launching the container;
the image neither installs nor invokes it.

## Build images

From the ai-dev-workflow checkout (PowerShell and POSIX use the same commands):

```text
docker build -f docker/Dockerfile -t ai-dev-workflow docker
docker build -f docker/Dockerfile.node -t ai-dev-workflow-node docker
docker build -f docker/Dockerfile.dotnet -t ai-dev-workflow-dotnet docker
```

The build context is the standalone `docker/` directory. The base includes all
three agents, local Serena, Playwright MCP and its matching Chromium, Context7,
Azure DevOps MCP v2, Azure CLI, Superpowers and ccusage. The Node variant adds
native compilation tools, package managers and TypeScript semantic tooling; the
.NET variant adds an exact SDK version. Project dependency installation remains
the consuming project's responsibility.

Copy `docker/docker-compose.yml` into the consuming project as `compose.ai-dev.yml`.
It is a run-only template: no checkout/build path back to this repository is needed.
Select a locally built image or an image you have published separately.

## Prepare and launch (PowerShell)

Run the project's existing host-side generation command first. Then, from that
project directory:

```powershell
$env:PROJECT_ROOT = (Get-Location).Path
$env:AGENT_IMAGE = 'ai-dev-workflow-node'
# Use a distinct stable Compose project name for each consuming project.
docker compose -p my-project-ai -f compose.ai-dev.yml config --quiet
docker compose -p my-project-ai -f compose.ai-dev.yml run --rm ai-dev-workflow codex login --device-auth
docker compose -p my-project-ai -f compose.ai-dev.yml run --rm ai-dev-workflow codex --yolo
# Other commands:
docker compose -p my-project-ai -f compose.ai-dev.yml run --rm ai-dev-workflow claude --dangerously-skip-permissions
docker compose -p my-project-ai -f compose.ai-dev.yml run --rm ai-dev-workflow opencode
docker compose -p my-project-ai -f compose.ai-dev.yml run --rm ai-dev-workflow bash
```

No host `HOME` variable or home bind is needed. Docker Desktop uses the default
container IDs `1000:1000`; it mediates ownership for Windows bind mounts. Paths
with spaces work. `PROJECT_ROOT` must be absolute and already exist. A missing
source directory is rejected rather than created automatically.

## Prepare and launch (POSIX)

After the project's host-side generation, from its root:

```bash
export PROJECT_ROOT="$(pwd)" AGENT_IMAGE=ai-dev-workflow-node
export HOST_UID="$(id -u)" HOST_GID="$(id -g)"
docker compose -p my-project-ai -f compose.ai-dev.yml config --quiet
docker compose -p my-project-ai -f compose.ai-dev.yml run --rm ai-dev-workflow codex login --device-auth
docker compose -p my-project-ai -f compose.ai-dev.yml run --rm ai-dev-workflow codex --yolo
docker compose -p my-project-ai -f compose.ai-dev.yml run --rm ai-dev-workflow claude --dangerously-skip-permissions
docker compose -p my-project-ai -f compose.ai-dev.yml run --rm ai-dev-workflow opencode
docker compose -p my-project-ai -f compose.ai-dev.yml run --rm ai-dev-workflow bash
```

The template may remain outside the consuming project: supply its absolute path
with `-f`, the same explicit `PROJECT_ROOT`, and a unique `-p` project name. Relative
workspace paths are rejected at startup. External linked-worktree Git directories
are unsupported: use a standalone clone or a layout whose Git directory is entirely
inside the mounted project. No unrelated host path is mounted automatically.

## Authentication and persistence

The Compose project owns an `agent-home` named volume at `/home/dev`. It persists
across `run --rm` and image updates; another Compose project name gets another home.
Keep the same `-p` value to retain logins. `docker compose down` retains volumes;
`down --volumes` deletes them and therefore deletes saved credentials and sessions.

Codex uses file-based credential storage under `/home/dev/.codex`. Complete its
one-time ChatGPT device login in a host browser. The account must permit device
authentication. Project definitions contain agent instructions, not user credentials.
Claude authentication/config lives in `.claude` and `.claude.json`; use its interactive
login inside the runtime. OpenCode uses `.config/opencode` for configuration and
`.local/share/opencode` for data including `auth.json`; use `opencode auth login`.
The volume also persists Azure CLI state (`.azure`), caches and global Serena state.
Project Serena metadata remains under `/workspace/.serena`.

### Azure DevOps

For `ticketing.backend: azure-devops`, the launcher reads
`ticketing.azureDevOps.organization` from `ai-project.json`. It starts the installed
v2 MCP binary with:

```text
mcp-server-azuredevops <organization> -d core work work-items --authentication azcli
```

ADO's browser-based interactive MCP login does not support this headless runtime.
Instead, authenticate Azure CLI interactively with device code. From either host
shell (append `--tenant <tenant-id>` when needed):

```text
docker compose -p my-project-ai -f compose.ai-dev.yml run --rm ai-dev-workflow az login --use-device-code --allow-no-subscriptions --output none
docker compose -p my-project-ai -f compose.ai-dev.yml run --rm ai-dev-workflow az account show --query tenantId --output tsv
```

`AZURE_TENANT_ID` is an optional runtime input for tenant selection. No PAT or
manually copied bearer token is the default. Azure CLI refreshes its own saved
credentials; re-run device login when policy, expiry or revoked access requires it.
The MCP does not create a separate persistent interactive OAuth session in this
mode. ADO is installed in every image and activated only for ADO projects.

ADO API login and Git remote authentication are separate. For GitHub, `gh auth login`
followed by `gh auth setup-git` stores credentials in this project's runtime home.
For other remotes configure a project-scoped Git credential helper or a dedicated
SSH key inside that home, according to the remote's instructions. Verify the actual
remote with `git ls-remote origin` before a full development cycle; do not mount a
host-wide credential store. Azure CLI authentication alone does not configure Git.

## Configuration and diagnostics

Use the launcher commands `codex`, `claude` and `opencode` on PATH. They forward
argument vectors directly to the installed binaries and apply container-specific
MCP execution settings. Codex receives CLI overrides above project configuration;
Claude receives an effective MCP file including custom project servers; OpenCode
receives inline runtime overrides. Host-side generated `npx` definitions remain
portable and unchanged. Custom servers such as `dxdocs` remain available.

```text
docker compose -p my-project-ai -f compose.ai-dev.yml run --rm ai-dev-workflow verify-agent-config.sh
docker compose -p my-project-ai -f compose.ai-dev.yml run --rm ai-dev-workflow codex mcp list
docker compose -p my-project-ai -f compose.ai-dev.yml run --rm ai-dev-workflow opencode debug config
```

Configuration parse errors abort startup with a diagnostic. Shell and login commands
remain usable before authentication. Playwright runs headless with an isolated
Chromium profile. Local MCP process startup and browser launch are checked without
network; authenticated API operations and project dependency downloads need network.

Superpowers is pinned in `/opt/superpowers` and registered with the supported
mechanism for each harness. Generated project agents and skills coexist with its
skills. Live model use, subagent MCP inheritance and account logins require the
separate acceptance session described below.

## Filesystem and process boundary

The only host filesystem bind is the selected project, writable by the agents.
Runtime home, caches and project-defined data volumes are additional container
state. The default uses a private Compose bridge network, an init process, 1 GiB
browser shared memory and no host Docker socket, privileged mode or host networking.
Outbound network access remains available. Credentials define remote API access;
filesystem isolation does not make Azure DevOps read-only.

Startup briefly runs as root to map nonzero numeric `HOST_UID`/`HOST_GID` and initialize
the home volume, then executes configuration and the chosen command as `dev`.
Reusing a home with different IDs repairs its ownership. It does not recursively
chown the project. Capability reductions retain only the setup capabilities needed
for remapping and privilege drop; commands run non-root. Exit codes and signals
propagate through the entrypoint and Compose init process.

## Consuming-project E2E integration

Backing services, healthchecks, seeded datasets, application environment, ports and
Linux dependency volumes belong to the consuming project. Compose on the host owns
service lifecycle; the agent starts its backend/frontend processes, waits for
readiness and drives them through Playwright at container-local URLs. Document those
commands in that project's `AGENTS.md`. Host browser access requires explicit port
publication and suitable listen addresses (`run --service-ports` when applicable).

BomManagerWeb integration is a **separate task**: provide its MongoDB sidecar and
dataset, separate Linux `node_modules` volumes, an `.env.ai` profile and a new
`dev:ai` entry point. Keep `dev:max` and other Windows scripts unchanged. This generic
repository adds none of that application's services, ports or settings.

The default topology does **not** support Testcontainers or other Docker API clients.
A MongoDB sidecar does not satisfy that requirement. Full integration testing needs
an explicitly designed dedicated-daemon environment; exposing the host socket would
break the stated filesystem boundary and is not part of this template.

## Tool inventory, updates and verification

Exact Node package versions and transitive resolutions live in
`tools/package.json` and `tools/package-lock.json`. Dockerfiles pin the base image,
uv, Serena/Superpowers revisions, Azure CLI and .NET SDK. The image carries a readable
inventory under `/opt/agent-tools`. OS packages still use apt repositories, so this
is a versioned tool runtime, not a claim of byte-identical rebuilds.

To update, resolve exact upstream releases, edit the pins, regenerate the container
lockfile, rebuild all three images and run the checks. Keep ADO on v2 and compare
its actual tool inventory with `ADO_MCP_TOOLS` and the ticketing include. Install
Chromium through the MCP package's matching Playwright dependency. Do not add these
dependencies to the zero-dependency generator or run the generator in the image.

```bash
npm test
npm ci --prefix docker/tools --ignore-scripts
bash docker/verify-runtime.sh
```

Linux CI builds all images and performs credential-free checks: local executables,
MCP/browser startup, configuration precedence, preserved project files, mount
boundaries, runtime ownership, persistence and startup failures. The runtime smoke
suite uses disposable fixture projects and removes only its own Compose volumes.

Live acceptance is recorded separately: complete Codex and Azure CLI device logins,
recreate the container and verify retained authentication; start a real Codex
`--yolo` session, discover `dev-cycle`/`product-architect`, invoke developer,
code-reviewer and qa-engineer on harmless read-only fixture tasks, use Serena and
Playwright, and perform an ADO read from the primary agent and a subagent. Check Git
remote access separately. Record actual results; an unperformed or blocked login,
model call, application E2E or Testcontainers run is not a passing automated check.
