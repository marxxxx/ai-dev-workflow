# Coding agents in an isolated project container

Build reusable tool images in this repository and run them from a consuming project.
The complete project is mounted once at `/workspace`, including `.git`, `.agents`,
`.codex`, `.claude` and `.opencode`. Startup uses those generated definitions without
rewriting them. Run the generator on the **host** before launching the container;
the image neither installs nor invokes it.

## Build images

From the ai-dev-workflow checkout (PowerShell and POSIX use the same commands):

```text
node docker/build.mjs                              # tags <image>:<YYYY.MM.DD> and <image>:latest
node docker/build.mjs --tag 2026.09.11.2 --no-cache
```

The script first checks every pin against `tools/inventory.json`, then builds the
base and derives the Node and .NET variants from exactly that base build (`BASE_IMAGE`
build argument). Each image carries OCI version/revision labels (`docker inspect`).
Plain `docker build -f docker/Dockerfile[.node|.dotnet] … docker` still works and
produces `latest` only.

The build context is the standalone `docker/` directory. The base includes all
three agents, local Serena, Playwright MCP and its matching Chromium, Context7,
Azure DevOps MCP v2, Azure CLI with its `azure-devops` extension, Superpowers and
ccusage. The Node variant adds native compilation tools, package managers and
TypeScript semantic tooling; the .NET variant adds an exact SDK version and trusts
the ASP.NET Core HTTPS development certificate for `localhost`. Project dependency
installation remains the consuming project's responsibility.

### Published images (Docker Hub)

CI builds all images for every pull request and push to `main`. On `main` (push or
manual *Run workflow*) it pushes them, after `verify-runtime.sh` passes, into one
repository, `marxx/ai-dev-workflow` by default:

| Image | Versioned tag | Moving tag |
|---|---|---|
| base | `2026.09.11` | `latest` |
| Node | `node-2026.09.11` | `node-latest` |
| .NET | `dotnet-2026.09.11` | `dotnet-latest` |

The version is the UTC build date; a second build on the same day replaces that tag.
Configure under *Settings → Secrets and variables → Actions*:

- secret `DOCKERHUB_TOKEN`: Docker Hub personal access token with *Read & Write* scope
- optional variables `DOCKERHUB_USERNAME` (default `marxx`) and `DOCKERHUB_REPOSITORY`
  (default `marxx/ai-dev-workflow`)

To publish a local build instead: `docker login`, then
`node docker/build.mjs push --tag 2026.09.11 --repository marxx/ai-dev-workflow`.
Consuming projects can use `AGENT_IMAGE=marxx/ai-dev-workflow:node-latest` without a
local build, or pin `marxx/ai-dev-workflow:node-2026.09.11`.

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

The same Azure CLI login serves the pinned `azure-devops` CLI extension (`az devops`,
`az boards`, `az repos`, `az pipelines`). It is installed in the image under
`AZURE_EXTENSION_DIR` (`/opt/azure-cli/extensions`), not in the home volume, so image
updates replace it. Set a default organization with
`az devops configure --defaults organization=https://dev.azure.com/<org>`.

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

## Separating host and container dependencies

Everything below `$HOME` is already isolated: the NuGet package cache, the npm cache, uv
and Azure CLI state live in the `agent-home` volume, the Playwright browsers in the image.
What the bind mount shares are the artifacts that sit *inside* the project tree, and it
shares them both ways: a `node_modules` full of `win32` binaries breaks builds in the
container, and the container overwrites `bin`/`obj` with Linux paths and RIDs, which then
breaks the build on the host.

**.NET needs no configuration.** The .NET image sets `ArtifactsPath=/home/dev/artifacts`
and `NUGET_PACKAGES=/home/dev/.nuget/packages`; MSBuild takes both as global properties, so
every build in the container writes below the home volume and the project tree stays
untouched — no `bin`, no `obj`, and the host's `obj/project.assets.json` is never read.
Output is namespaced per project (`artifacts/{bin,obj}/<project>/<configuration>/`). Three
caveats: a `Directory.Build.props` that sets `ArtifactsPath` or `BaseOutputPath` itself wins
over the environment; scripts with hardcoded paths such as `bin/Debug/net10.0/App.dll` break
in the container; and non-SDK projects are not covered.

**Node needs one volume per dependency tree.** npm has no equivalent redirect, so declare a
named volume for each `node_modules` of your project. Mounted below the bind, it masks the
host directory: the host install stays intact and usable, the container gets its own Linux
tree, and on Docker Desktop it is markedly faster than going through the bind mount.

```yaml
services:
  ai-dev-workflow:
    volumes:
      # … the existing bind on /workspace and the agent-home volume …
      - type: volume
        source: deps-apps-web
        target: /workspace/apps/web/node_modules

volumes:
  agent-home:
  deps-apps-web:
```

Use **named** volumes, not anonymous ones: anonymous volumes disappear with `run --rm`,
named ones persist per Compose project name (`-p`) like `agent-home`. Two consequences: the
volume starts out empty, so the first container start needs an `npm ci` (or your project's
equivalent) inside the container; and where the mount point does not exist on the host,
Docker creates it as an empty directory — harmless, and usually gitignored.

The runtime does the rest on its own. It discovers these mounts through
`/proc/self/mountinfo` rather than configuration, and gives each one to the runtime user, so
installing into a fresh volume works without a recursive chown of the project. On every
start it also checks the project for artifacts that *no* volume masks — an unmasked
`node_modules` holding host-platform packages, or in-tree `bin`/`obj` without a redirect —
and prints the compose entry that is missing. That check is advisory and never fails the
start.

The copied `compose.ai-dev.yml` is yours to edit: add the database or other services your
development setup needs, publish ports, pass credentials through `environment`. Only the
`PROJECT_ROOT` bind on `/workspace` and the `agent-home` volume are load-bearing.

## Consuming-project E2E integration

Backing services, healthchecks, seeded datasets, application environment, ports and
Linux dependency volumes belong to the consuming project. Compose on the host owns
service lifecycle; the agent starts its backend/frontend processes, waits for
readiness and drives them through Playwright at container-local URLs. Document those
commands in that project's `AGENTS.md`. Host browser access requires explicit port
publication and suitable listen addresses (`run --service-ports` when applicable).

### HTTPS on localhost (.NET image)

On every start the .NET image runs a startup hook as `dev` that executes
`dotnet dev-certs https --trust` unless the development certificate is already
trusted. Kestrel then serves `https://localhost` with that certificate, and
Playwright's Chromium (NSS database `~/.pki/nssdb`) as well as OpenSSL clients such
as curl and `HttpClient` (via `SSL_CERT_DIR`) accept it without certificate errors.
Certificate, private key and trust live in the `agent-home` volume, one per Compose
project, and are never part of the published image. The first start in a new
volume takes a few seconds longer. Node.js clients use their bundled CA list and do
not see this trust; browsers on the host do not trust the container's certificate.

BomManagerWeb integration is a **separate task**: provide its MongoDB sidecar and
dataset, its `node_modules` volumes (see [Separating host and container
dependencies](#separating-host-and-container-dependencies)), an `.env.ai` profile and a new
`dev:ai` entry point. Keep `dev:max` and other Windows scripts unchanged. This generic
repository adds none of that application's services, ports or settings.

The default topology does **not** support Testcontainers or other Docker API clients.
A MongoDB sidecar does not satisfy that requirement. Full integration testing needs
an explicitly designed dedicated-daemon environment; exposing the host socket would
break the stated filesystem boundary and is not part of this template.

## Tool inventory, updates and verification

`tools/inventory.json` is the single source for every pin: base image digest and its
Node version, all Node CLIs and MCP servers, uv, Azure CLI and its `azure-devops`
extension, Serena/Superpowers revisions and the .NET SDK. `tools/package.json`, `tools/package-lock.json` and the Dockerfile
`FROM`/`ARG` pins are derived from it; do not edit them by hand. The inventory is copied
to `/opt/agent-tools/inventory.json` and every build verifies the installed versions
against it (`tools/verify-versions.mjs`). OS packages still use apt repositories, so
this is a versioned tool runtime, not a claim of byte-identical rebuilds.

```text
node docker/tools/inventory.mjs outdated     # newer upstream versions (read-only)
node docker/tools/inventory.mjs update       # all pins, fresh lockfile
node docker/tools/inventory.mjs update --only @anthropic-ai/claude-code,@openai/codex
node docker/tools/inventory.mjs sync         # re-derive after editing inventory.json by hand
node docker/tools/inventory.mjs check        # drift gate (CI and build.mjs)
```

`updatePolicy` in the inventory bounds automatic updates:

- `npmMajorHolds`: `@azure-devops/mcp` stays on v2 (launcher arguments and
  `ADO_MCP_TOOLS` target v2). `typescript-serena` stays on TypeScript 5 because
  Serena's language server needs `lib/tsserver.js`, which native TypeScript 7 no
  longer ships.
- `npmFollowDependency`: `playwright` always equals the exact version `@playwright/mcp`
  depends on, so the installed Chromium matches the MCP.
- `dotnetChannel`: the SDK follows the latest patch of this channel.

Serena and Superpowers follow their default-branch HEAD; the base image keeps its tag
and refreshes the digest. Raise a hold or channel deliberately by editing the policy.

Update workflow:

1. `node docker/tools/inventory.mjs update`, then read the upstream release notes for
   the printed changes. Watch for changed agent CLI flags and config formats
   (`launch-agent.mjs`, `verify-agent-config.sh`) and compare the ADO MCP tool list
   with `ADO_MCP_TOOLS` and the ticketing include.
2. `npm ci --prefix docker/tools --ignore-scripts`, then `node docker/build.mjs --no-cache`;
   `--no-cache` also refreshes unpinned apt packages such as `gh`.
3. `npm test`, `bash docker/verify-runtime.sh`, then the live acceptance below.
4. Commit `tools/inventory.json` together with the derived files.

Consuming projects pick up `:latest` on their next `docker compose run`; logins
survive in the `agent-home` volume. To stay on a known build, or to roll back, set
`AGENT_IMAGE` to a dated tag such as `ai-dev-workflow-node:2026.09.11` (published:
`marxx/ai-dev-workflow:node-2026.09.11`). Old tags remain
until removed with `docker image rm`. Do not add these dependencies to the
zero-dependency generator or run the generator in the image.

Linux CI builds all images and performs credential-free checks: local executables,
MCP/browser startup, configuration precedence, preserved project files, mount
boundaries, runtime ownership, persistence and startup failures. In the .NET image
curl and Chromium must load `https://localhost` with the trusted development
certificate. The runtime smoke suite runs against the base and the .NET image, uses
disposable fixture projects and removes only its own Compose volumes.

Live acceptance is recorded separately: complete Codex and Azure CLI device logins,
recreate the container and verify retained authentication; start a real Codex
`--yolo` session, discover `dev-cycle`/`product-architect`, invoke developer,
code-reviewer and qa-engineer on harmless read-only fixture tasks, use Serena and
Playwright, and perform an ADO read from the primary agent and a subagent. Check Git
remote access separately. Record actual results; an unperformed or blocked login,
model call, application E2E or Testcontainers run is not a passing automated check.
