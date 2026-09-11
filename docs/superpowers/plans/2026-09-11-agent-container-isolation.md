# Agent Container Isolation — Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task when implementation is requested. Operating-model and login choices have been confirmed. Steps use checkbox syntax for tracking.

**Goal:** Coding agents run against a consuming project's workspace with their internal permission prompts disabled, using preinstalled tools and the project's existing generated workflow definitions.

**Architecture:** Build reusable tool images in ai-dev-workflow; run an image from the consuming project. Mount the complete project at `/workspace`, keep user configuration and authentication in a separate project-specific Docker volume, and apply container-specific MCP commands without changing generated project files.

**Tech Stack:** Docker Compose, Debian/Linux, Node.js, Bash, Claude Code, Codex, OpenCode, Serena, Playwright MCP/Chromium, Context7, Azure DevOps MCP, Azure CLI, Superpowers, ccusage.

**Spec:** The user's request in this conversation and the operating contract below. Checked items have been implemented and verified; the separate BomManagerWeb application integration remains unchecked.

## Global constraints

- The image neither installs nor invokes the ai-dev-workflow generator. Generation remains a host-side project preparation step.
- Existing generated files under `.codex`, `.claude`, `.opencode`, and `.agents` remain in the project. Startup must not rewrite them.
- Preserve the user's uncommitted `docker/docker-compose.yml` changes while evolving their intended project-root mounting behavior.
- Do not modify BomManagerWeb during implementation in this repository. Its integration is a separate, explicitly identified project task.
- ai-dev-workflow provides only the generic foundation. MongoDB services, app-specific environment, ports, dependency volumes and E2E startup instructions belong exclusively to the consuming project.
- Preserve existing Windows development scripts, especially `dev:max`, unchanged. Add a separate `dev:ai` script for Linux/container development; any required Linux-specific startup changes belong there.
- Keep the generator zero-dependency. Container-only tool dependencies belong under `docker/`.
- Use LF line endings. Do not put credentials in images, versioned configuration, build arguments, or test output.
- Agent commands run as a non-root user. Required initialization failures stop startup with an actionable error.
- Host filesystem access is limited to the mounted project. Runtime home, caches and database volumes are additional writable container state. Network/MCP operations are governed by the credentials provided; filesystem isolation does not make Azure DevOps read-only.

## Observed state (2026-09-11)

1. `docker/Dockerfile` copies and globally installs the generator. Both READMEs explicitly advertise running it in the container, contrary to the requested runtime model.
2. The uncommitted Compose change correctly replaces `..:/workspace` with `${PROJECT_ROOT}:/workspace`. However, project `.codex` and `.claude` are also mounted as user directories. `configure-agents.sh` consequently modifies project config and introduces runtime state into generated directories.
3. The remaining `${HOME}/.config/opencode` mount resolves to `/.config/opencode` when `HOME` is absent in PowerShell. This was observed with `docker compose config --format json`.
4. BomManagerWeb's copied `compose.ai-dev.yml` retains `build.context: ..`. Compose resolves this to `D:\src\BSH`, not the ai-dev-workflow source repository. This was observed with `docker compose config --format json`.
5. BomManagerWeb has all three `.codex/agents/*.toml` definitions, the workflow skills under `.agents/skills`, additional project skills, and generated runtime includes. Current Codex supports these project locations directly. Project config loading requires project trust.
6. `agent-src/lib/ticketing.mjs` emits `npx -y @azure-devops/mcp@2 ...` in both `.mcp.json` and `.codex/config.toml`. BomManagerWeb also configures the remote `dxdocs` MCP server. A user-level ADO definition alone cannot override Codex's higher-priority project definition.
7. Azure DevOps MCP is absent from the image. Its actual executable is `mcp-server-azuredevops`; the existing workflow depends on its v2 tool contract.
8. Tool package arguments float, Superpowers clones an unpinned default branch, and Serena installation is only best-effort cache priming through `uvx`. Builds/startup can succeed without required tooling. The Node image tag and .NET channel also float within their selected release lines.
9. Superpowers is only linked into a Claude plugin directory; there is no Codex or OpenCode setup. A checkout alone does not demonstrate that a harness has loaded its skills/hooks.
10. Playwright MCP starts without `--headless` although the image has no display. Chromium is installed using a separately installed Playwright version; compatibility with the MCP package's browser revision is not ensured.
11. BomManagerWeb E2E guidance starts MongoDB through Docker Compose. The agent image has no Docker client/daemon integration. Its `dev:max` script uses Windows `set CONFIG=max&&`, which does not export CONFIG under Linux. Server configuration permits explicit environment overrides, including `MONGO_CONNECTION_STRING`.
12. Several BomManagerWeb integration tests use Testcontainers. Starting a preconfigured MongoDB service addresses browser E2E infrastructure, but does not by itself satisfy these tests' Docker API requirement.
13. Existing CI runs generator tests and generation checks only. It neither builds nor exercises the Docker runtime. The analysis has not built images, authenticated clients, or run the application's E2E tests.

## Proposed operating contract and alternatives

### Recommended default

- A consuming project copies a run-only Compose template and selects an already-built image. No build path back to this repository is needed at runtime.
- Require an explicit absolute `PROJECT_ROOT`; fail when it is missing or not an existing project directory. Use long bind syntax with automatic host-path creation disabled.
- Mount the project once at `/workspace`. Preserve access to hidden directories and `.git`. Reject an external linked-worktree Git directory with a clear diagnostic unless its layout is explicitly supported; do not silently mount unrelated host paths.
- Persist `/home/dev` in a Compose project-scoped named volume, without a globally fixed volume name. Do not bind host home directories. Keep project `.serena` data under `/workspace/.serena` and global Serena state in the runtime home.
- Start Codex with `--yolo`, or Claude with `--dangerously-skip-permissions`, as explicitly selected commands. Shell/login/diagnostic commands remain usable. Trust `/workspace` in the container's own Codex configuration.
- Launch local MCP processes in the agent container. Compose starts any declared backing services. Codex starts/stops backend and frontend processes and Playwright accesses them on container-local URLs.
- Do not expose the host Docker socket or use privileged/host-network execution. Use a private Compose network, normal Docker isolation, an init process and sufficient browser shared memory. Keep non-root setup compatible with any capability reductions.

### Alternatives considered

1. **Project-defined backing services (recommended):** smallest setup for browser E2E and preserves the intended filesystem boundary. Infrastructure lifecycle belongs to host-side Compose; project guidance must reflect this.
2. **Dedicated Docker daemon in an isolated environment:** supports Testcontainers and agent-managed containers, but adds storage, networking, workspace-path and lifecycle complexity. Select this only if Docker API access is a requirement; do not treat a privileged DinD container as equivalent to the default boundary.
3. **Host Docker socket:** simple container management, but the daemon can mount host paths outside the project. This does not meet the stated host-filesystem boundary and is excluded from the recommended design.

### Confirmed user decisions

- **Confirmed:** MongoDB runs as a Compose service declared by BomManagerWeb. The shared ai-dev-workflow template contains no MongoDB or other project-specific services.
- **Confirmed:** Codex uses a separate container home and a one-time ChatGPT login. Use file-based credential storage within that volume. Prefer `codex login --device-auth` when enabled for the account; do not import the host home.
- **Confirmed:** Interactive development remains on Windows. Keep `dev:max` unchanged and add `dev:ai` for the agent container in the consuming project.
- **Confirmed requirement:** ADO authentication must be interactive, with no PAT or manually supplied bearer-token default.
- **New finding:** upstream ADO troubleshooting explicitly says its default interactive OAuth flow cannot complete in a headless Docker environment. Current `src/auth.ts` calls `acquireTokenInteractive` and attempts to open a browser; it does not expose a device-code method. Do not claim this works by passing `--authentication interactive` alone or by persisting HOME.
- **Confirmed follow-up:** install Azure CLI and interactively run `az login --use-device-code`, then run ADO MCP with `--authentication azcli`. The person confirms the code in a host browser; CLI credentials remain in the container home's `.azure` directory. Supply tenant selection through project/runtime inputs when required, and support accounts without Azure subscriptions. No GUI/browser service is added to the image.

The base/runtime and login design is now settled. Testcontainers support is a separate project capability, not implied by the accepted MongoDB sidecar topology. Actual login remains subject to the account's device-code policy and will be checked during implementation acceptance.

## Task 1: Make images a complete, versioned tool runtime

**Files:** modify `docker/Dockerfile`, `docker/Dockerfile.node`, `docker/Dockerfile.dotnet`; add `docker/tools/package.json`, `docker/tools/package-lock.json` and `docker/verify-tools.sh`.

**Interface:** all required CLIs are on PATH, independent of the project and runtime network downloads. `/opt/agent-tools` owns Node tooling; generator dependencies remain untouched.

- [x] Remove the generator COPY/install block and generator-related build assumptions. Use `docker/` as the standalone build context and adjust script COPY paths accordingly.
- [x] Resolve and commit exact compatible versions of the three CLIs, MCP servers, ccusage and any promised package managers. Install the Node tool set with its lockfile under `/opt/agent-tools`; expose its executable directory on PATH. Preserve simple executable names for consumers.
- [x] Include an exact Azure DevOps MCP v2 release. Check its tools against `ADO_MCP_TOOLS` and the ticketing include. Do not upgrade to another major implicitly.
- [x] Install and version Azure CLI as a generic authentication prerequisite; verify it as part of the image inventory. Keep organization/tenant identity in project/runtime inputs.
- [x] Pin Serena and Superpowers to immutable revisions, install Serena as a real tool, and fail the build if either is unavailable. Pin uv and record the base image digest and .NET SDK version. Record resolved tools in an image-readable inventory; do not claim that floating apt repositories give byte-identical rebuilds.
- [x] Install Chromium and system libraries using the selected MCP package's matching Playwright installer. Avoid a second unrelated browser version. Verify actual browser launch as the runtime user.
- [x] Keep native compilation tools in the Node variant. Explicitly install and verify promised package managers; remove `corepack enable || true` as a substitute for a working installation. Provision the TypeScript language server used by Serena and verify semantic startup in the Node variant.
- [x] Run `docker build -f docker/Dockerfile -t ai-dev-workflow docker`, followed by the derived builds with the same context. Run `verify-tools.sh` with network disabled: local executable startup and a browser launch must work, and `command -v ai-dev-workflow` must fail.

**Acceptance:** required local tools cannot be silently missing. Offline process startup is distinguished from API calls and project dependency installation, which can require network access.

## Task 2: Separate workspace, runtime state and image build

**Files:** modify `docker/docker-compose.yml`, `docker/entrypoint.sh`; add `docker/.env.example` and `docker/tests/runtime-smoke.sh`.

**Interface:** `PROJECT_ROOT` selects the only host workspace bind; `AGENT_IMAGE` selects the built image. Compose-scoped volumes hold runtime state.

- [x] Remove `build:` from the consuming-project template. Use an image variable and retain `/workspace` as the working directory.
- [x] Replace the duplicated project/home mounts with one validated workspace bind and a named home volume. Remove the dependency on host `HOME` interpolation. Document absolute-path setup for PowerShell and POSIX shells.
- [x] Retain UID/GID mapping for Linux; validate nonzero numeric IDs and fail on mapping failures. Initialize fresh volume ownership correctly and test reuse with a different UID. Do not recursively chown the project.
- [x] Keep privileged setup narrowly scoped, then exec the selected command as the runtime user. Include process reaping and signal/exit-code propagation. Required configuration failures must abort startup.
- [x] Test missing root, nonexistent root, paths containing spaces, a Compose file outside the project, and a copied Compose file at the project root. Inspect the resolved mounts and ensure their sources do not depend on the template's location.
- [x] Test workspace write ownership, persistence across `run --rm`, separation between two Compose projects, and the absence of any host-home or Docker-socket mount. Verify startup does not alter hashes of project agent/MCP configuration.

**Acceptance:** launching from BomManagerWeb uses BomManagerWeb as the workspace and never requires an ai-dev-workflow checkout in the container or at the consuming project's build path.

## Task 3: Load project definitions and override only container MCP execution

**Files:** modify `docker/configure-agents.sh`; add `docker/launch-agent.mjs`, `docker/launch-agent.test.mjs`, and `docker/verify-agent-config.sh`; integrate invocation in the image and entrypoint.

**Interface:** the launcher accepts an agent name and forwards its argument vector without shell-string interpolation. It reads project identity from `ai-project.json`, writes only container-home state, and uses the actual installed agent executables.

- [x] Replace append-only/best-effort config setup with deterministic managed runtime configuration. Preserve unrelated user settings and fail on invalid input instead of replacing malformed files with empty defaults.
- [x] Codex: trust `/workspace` in container user config; discover agents and skills directly from the mounted project. Apply container command/args for managed MCP names using high-priority CLI overrides. Verify those overrides are inherited by the project's subagents.
- [x] For ADO projects, use `mcp-server-azuredevops <organization> -d core work work-items --authentication azcli`. Use the confirmed interactive Azure CLI device-code login. Do not silently substitute PAT/envvar authentication. ADO is preinstalled in every image but activated only for relevant projects.
- [x] Keep host-side generated `npx` settings portable and untouched. Do not add an `npx` interception shim or regenerate files at container startup. Explicitly test that ADO process execution invokes the installed binary even when the project still declares `npx`.
- [x] Claude: assemble an effective runtime MCP configuration from project definitions and the managed container overrides; load it through supported CLI config flags. Preserve `dxdocs` and other project servers. Verify the effective configuration with the pinned CLI.
- [x] OpenCode: apply equivalent runtime-only configuration through the pinned CLI's supported configuration mechanism, retaining project definitions and custom servers. Confirm its actual config/auth persistence paths within the home volume.
- [x] Start Playwright with `--headless --browser chromium --isolated`. Configure Serena for `/workspace` and its harness-specific context (`codex` for Codex); disable automatic dashboard browser opening. Verify server startup rather than relying only on registration output.
- [x] Register the pinned Superpowers package for each harness and verify both skills and any required startup hooks. For Codex, ensure the supported skill/plugin discovery mechanism makes it visible alongside `.agents/skills`; a symlink in Claude's plugin directory is not an acceptance test.
- [x] Test a fixture with generated ADO definitions and a custom `dxdocs` server. Assert effective ADO executable/arguments, preserved custom servers, missing-auth diagnostics, no duplicate managed entries and byte-identical project files after two starts.
- [x] Perform a real Codex session in a fixture or read-only consuming project: discover `dev-cycle`/`product-architect`, invoke each generated role with a harmless read-only task, use Serena and Playwright, and verify no internal command approval prompts under `--yolo`.
- [x] Test interactive logins with the user, then recreate the container and verify Codex and ADO still authenticate. Verify ADO from both the primary agent and a subagent; document reauthentication behavior rather than assuming the MCP itself persists an OAuth cache.

**Acceptance:** installing a tool, registering it and successfully using it are all verified. ADO authentication and Git remote authentication are separate; document and check the required Git credential mechanism for full development-cycle use without mounting host-wide credentials.

## Task 4: Separate consuming-project integration — BomManagerWeb

**Files in the consuming project (separate task):** `compose.ai-dev.yml`, `server/package.json`, `docs/e2e-testing-guidance.md`, relevant `AGENTS.md` guidance; add `server/.env.ai.example` for the container profile.

**Interface:** use `ai-dev-workflow-node`; app processes and MCP browser share the agent container. Database hostname and startup ownership follow the selected operating model.

This task describes follow-up work in BomManagerWeb. None of its MongoDB definitions, project paths, credentials, ports or application startup configuration are added to ai-dev-workflow's runtime artifacts.

- [ ] Adapt the copied Compose file to the run-only template. For the recommended topology, declare an E2E MongoDB service with a healthcheck, a dedicated dataset volume and a shared network. Use `mongo` as the database hostname. Do not stop or overwrite the existing developer database.
- [ ] Establish required migrations, test-data seeding and the documented test-user setup. Determine which E2E scenarios require SQL Server or other integrations and provide their test dependencies explicitly; an empty MongoDB volume alone is not evidence that the app can be tested.
- [ ] Add `"dev:ai": "CONFIG=ai npm run dev"` to `server/package.json` and launch the backend with `npm run dev:ai` in the container. Preserve `dev:max` and all existing Windows startup scripts unchanged. Put any additional Linux-specific startup behavior in the new script or a helper dedicated to it.
- [ ] Document the separate `.env.ai` profile using `server/.env.ai.example`, with actual secrets supplied outside version control and an explicit container `MONGO_CONNECTION_STRING`. Validate all path/connection values for Linux. Avoid printing credential values.
- [ ] Verify that `npm run dev:ai` loads the AI profile and starts the backend under Linux, and confirm by diff that `dev:max` and existing Windows startup commands are unchanged. Document both entry points and their respective environments.
- [ ] Mount separate Linux `node_modules` volumes at `/workspace/server/node_modules` and `/workspace/client/node_modules`; install from the project's lockfiles. Keep host Windows native dependencies separate. Verify application tool versions and license prerequisites.
- [ ] Start backend and frontend, poll their actual readiness and run Playwright against `http://localhost:4210`; verify API access at port 3000. Host browser access is optional and requires explicit port publication and suitable listen addresses, including `--service-ports` when using Compose run.
- [ ] Exercise login and one agreed representative application flow. Save screenshots and console/network failure evidence under the project's E2E artifact location. Stop only the processes owned by this session; host Compose tears down services it started.
- [ ] Resolve the Testcontainers requirement explicitly. If full integration testing is required, implement and validate the dedicated-daemon alternative before claiming that the entire test suite works. Do not silently skip affected tests or add the host socket.

**Acceptance:** a real Codex session can read the generated workflow, modify a disposable project fixture, start the actual project, and complete an agreed browser flow. A failed login, missing dataset, or unavailable integration remains a reported blocker rather than a pass.

## Task 5: Document and continuously verify the supported workflow

**Files:** modify `docker/README.md`, root `README.md`, `.github/workflows/ci.yml`; add `docker/verify-runtime.sh` to orchestrate the preceding checks.

- [x] Replace generator-in-container instructions with host-side preparation, separate image build, consuming-project launch, authentication, persistence and E2E lifecycle instructions.
- [x] Include complete PowerShell and POSIX examples with explicit project root/image selection, `codex --yolo`, `claude --dangerously-skip-permissions`, login commands and config diagnostics. State that user login may be required and that project definitions do not contain user credentials.
- [x] Document the exact tool inventory/update process, filesystem boundary, permitted runtime state, credential scope, and the selected Testcontainers support model.
- [x] Add a Linux CI job for image build and credential-free runtime smoke tests. Test real subprocess/browser startup, effective config precedence, preservation of project files, and startup failure behavior. Keep live authenticated API/E2E checks as separately recorded acceptance evidence.
- [x] Run `npm test`; if canonical generator changes prove necessary, edit `agent-src/` only, run `npm run generate` and `npm run check`, and maintain the package files allowlist. No generator change is currently required by the recommended runtime override approach.
- [x] Review the final diff and ensure the only analysis-phase artifact is this plan; implementation commits must preserve unrelated user changes.

## Sources used for the design

- [Docker Compose path resolution](https://docs.docker.com/compose/how-tos/multiple-compose-files/merge/) — relative resources depend on the Compose base, not simply the calling shell's directory.
- [Docker daemon security](https://docs.docker.com/engine/security/) — daemon access permits mounting additional host paths.
- [Codex config precedence and trust](https://developers.openai.com/codex/config-basic/) — CLI overrides take precedence over trusted project config, then user config.
- [Codex project subagents](https://developers.openai.com/codex/subagents/) and [skill discovery](https://developers.openai.com/codex/skills/) — project definition paths and inheritance.
- [Codex authentication](https://developers.openai.com/codex/auth/) — choose an authentication flow that works in a headless container.
- [Azure DevOps MCP setup/authentication](https://github.com/microsoft/azure-devops-mcp/blob/main/docs/GETTINGSTARTED.md) and [package executable](https://github.com/microsoft/azure-devops-mcp/blob/main/package.json).
- [ADO headless authentication troubleshooting](https://github.com/microsoft/azure-devops-mcp/blob/main/docs/TROUBLESHOOTING.md) and [current OAuth implementation](https://github.com/microsoft/azure-devops-mcp/blob/main/src/auth.ts) — direct interactive login requires browser integration.
- [Playwright MCP](https://github.com/microsoft/playwright-mcp) and [package dependencies](https://github.com/microsoft/playwright-mcp/blob/main/package.json) — headless browser startup and matching revisions.
- [Serena client configuration](https://github.com/oraios/serena/blob/main/docs/02-usage/030_clients.md) — direct installed executable and Codex context.
- [Superpowers harness installation](https://github.com/obra/superpowers) — per-harness registration is necessary.
