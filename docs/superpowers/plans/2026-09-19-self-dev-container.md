# Self-Development Container Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let this generator repo be worked on inside its own agent container, exposing only the tool stack (harnesses + managed MCPs + GitHub CLI) and not the generated dev-cycle definitions.

**Architecture:** Add an opt-in `toolstackOnly` path to `docker/launch-agent.mjs` so `readProjectState` returns a neutral state (no `ai-project.json` required) and only the managed MCP servers are wired; ship a repo-root `compose.ai-dev.yml` that sets `AGENT_TOOLSTACK_ONLY=1` and mounts this repo; document the launch.

**Tech Stack:** Zero-dependency Node (builtins only, `>=24`), `node --test`, Docker Compose, the published base image `marxx/ai-dev-workflow:latest`.

**Spec:** `docs/superpowers/specs/2026-09-19-self-dev-container-design.md`

## Global Constraints

- **Zero runtime dependencies** — Node builtins only; do not add packages.
- **LF line endings** on every file.
- **Default (non-tool-stack) behavior must stay identical** — a missing `ai-project.json` still fails when `toolstackOnly` is not set; every existing test in `docker/launch-agent.test.mjs` must pass unchanged.
- Tool-stack-only mode is triggered **only** by the explicit env var `AGENT_TOOLSTACK_ONLY=1` (or the `toolstackOnly: true` option in tests), never inferred from a missing file.
- The managed MCP servers are exactly `serena`, `playwright`, `context7` (no `ado` in this mode).
- No new `agent-src/lib/*.mjs` module is added, so `package.json` `files` is untouched.

---

### Task 1: Tool-stack-only runtime mode in `launch-agent.mjs`

**Files:**
- Modify: `docker/launch-agent.mjs` (`readProjectState` at :63, `configureRuntime` at :143, `buildLaunchPlan` at :226, `runCli` at :280)
- Test: `docker/launch-agent.test.mjs`

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `readProjectState(workspace, { toolstackOnly = false } = {})` → when `toolstackOnly`, returns `{ backend: undefined, organization: undefined, projectServers: {} }` without touching the workspace.
  - `configureRuntime({ …, toolstackOnly = false })` — forwards `toolstackOnly` to `readProjectState`.
  - `buildLaunchPlan(agent, forwardedArgs, { …, toolstackOnly = false })` — forwards `toolstackOnly` to `readProjectState`.
  - `runCli()` reads `process.env.AGENT_TOOLSTACK_ONLY === '1'` and passes it to both `configureRuntime` and `buildLaunchPlan`.

- [ ] **Step 1: Write the failing tests**

Append to `docker/launch-agent.test.mjs`. First add `spawnSync` and `fileURLToPath` to the imports, and a `scriptPath` constant near the top of the file (after the existing imports):

```js
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(new URL('./launch-agent.mjs', import.meta.url));

// Bare workspace with NO ai-project.json / .mcp.json / .codex — proves tool-stack-only reads none of them.
function bareWorkspace(t) {
  const root = mkdtempSync(path.join(tmpdir(), 'agent-toolstack-'));
  const workspace = path.join(root, 'workspace');
  const home = path.join(root, 'home');
  mkdirSync(workspace, { recursive: true });
  mkdirSync(home);
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return { root, workspace, home };
}
```

Then the four test cases:

```js
test('tool-stack-only configureRuntime needs no ai-project.json', t => {
  const { root, workspace, home } = bareWorkspace(t);
  const serenaConfigFile = path.join(root, 'serena_config.yml');
  writeFileSync(serenaConfigFile, 'projects: []\n');

  assert.doesNotThrow(() => configureRuntime({
    workspace, home, superpowersRoot: '/opt/superpowers', serenaConfigFile,
    registerCodexPlugin: false, toolstackOnly: true,
  }));
  const codex = readFileSync(path.join(home, '.codex/config.toml'), 'utf8');
  assert.match(codex, /trust_level = "trusted"/);
  assert.match(codex, /superpowers@agent-runtime/);
  assert.equal(readFileSync(path.join(home, '.cache/ai-dev-workflow/serena/serena_config.yml'), 'utf8'), 'projects: []\n');
});

test('tool-stack-only Codex plan emits only managed servers and never checks Azure', t => {
  const { workspace, home } = bareWorkspace(t);
  let azureChecked = false;
  const plan = buildLaunchPlan('codex', ['--yolo'], {
    workspace, home, toolstackOnly: true,
    checkAzureAuth: () => { azureChecked = true; return false; },
  });
  assert.equal(azureChecked, false);
  const flat = plan.args.join(' ');
  assert.ok(flat.includes('mcp_servers.serena.command'));
  assert.ok(flat.includes('mcp_servers.playwright.args'));
  assert.ok(flat.includes('mcp_servers.context7.command'));
  assert.ok(!flat.includes('mcp_servers.ado'));
  assert.deepEqual(plan.args.slice(-1), ['--yolo']);
});

test('tool-stack-only Claude config has exactly the three managed servers', t => {
  const { workspace, home } = bareWorkspace(t);
  const plan = buildLaunchPlan('claude', ['--dangerously-skip-permissions'], {
    workspace, home, toolstackOnly: true,
  });
  const configPath = plan.args[plan.args.indexOf('--mcp-config') + 1];
  const effective = JSON.parse(readFileSync(configPath, 'utf8'));
  assert.deepEqual(Object.keys(effective.mcpServers).sort(), ['context7', 'playwright', 'serena']);
});

test('CLI honors AGENT_TOOLSTACK_ONLY with no ai-project.json on disk', () => {
  const result = spawnSync(process.execPath, [scriptPath, 'codex', '--yolo'], {
    env: { ...process.env, AGENT_TOOLSTACK_ONLY: '1', AGENT_RUNTIME_PRINT_PLAN: '1' },
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  const plan = JSON.parse(result.stdout);
  const flat = plan.args.join(' ');
  assert.ok(flat.includes('mcp_servers.serena.command'));
  assert.ok(!flat.includes('mcp_servers.ado'));
});
```

> Note: the Claude test uses `home` inside a temp dir (writable); the CLI test uses `codex`, whose plan writes no config file, so the default `/home/dev` is never touched.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test docker/launch-agent.test.mjs`
Expected: the four new tests FAIL (e.g. `ai-project.json is required in /workspace`, or `configureRuntime` throwing); the existing tests still PASS.

- [ ] **Step 3: Add `toolstackOnly` to `readProjectState`**

Change the signature and short-circuit at the top (`docker/launch-agent.mjs:63`):

```js
function readProjectState(workspace, { toolstackOnly = false } = {}) {
  if (toolstackOnly) return { backend: undefined, organization: undefined, projectServers: {} };
  const identity = readJson(path.join(workspace, 'ai-project.json'), 'ai-project.json');
```

Leave the rest of the function body unchanged.

- [ ] **Step 4: Thread `toolstackOnly` through `configureRuntime`**

At `docker/launch-agent.mjs:143`, add `toolstackOnly = false` to the destructured options and pass it down. The options block becomes:

```js
export function configureRuntime({
  workspace = DEFAULT_WORKSPACE,
  home = DEFAULT_HOME,
  superpowersRoot = DEFAULT_SUPERPOWERS,
  serenaConfigFile = '/opt/serena-runtime/serena_config.yml',
  registerCodexPlugin = true,
  toolstackOnly = false,
} = {}) {
  readProjectState(workspace, { toolstackOnly });
```

(Only the first line of the body — the `readProjectState(workspace)` call — changes.)

- [ ] **Step 5: Thread `toolstackOnly` through `buildLaunchPlan`**

At `docker/launch-agent.mjs:226`, add `toolstackOnly = false` to the options and pass it to `readProjectState`:

```js
export function buildLaunchPlan(agent, forwardedArgs, {
  workspace = DEFAULT_WORKSPACE,
  home = DEFAULT_HOME,
  superpowersRoot = DEFAULT_SUPERPOWERS,
  toolBin = REAL_BIN,
  checkAzureAuth = defaultAzureCheck,
  environment = process.env,
  toolstackOnly = false,
} = {}) {
```

and change the `const project = readProjectState(workspace);` line (:236) to:

```js
  const project = readProjectState(workspace, { toolstackOnly });
```

- [ ] **Step 6: Wire the env var in `runCli`**

Replace the body of `runCli` (`docker/launch-agent.mjs:280`) so it reads the env var once and passes it to both paths:

```js
function runCli() {
  const [, , action, ...args] = process.argv;
  const toolstackOnly = process.env.AGENT_TOOLSTACK_ONLY === '1';
  if (action === '--configure') {
    configureRuntime({ toolstackOnly });
    return;
  }
  const plan = buildLaunchPlan(action, args, {
    toolstackOnly,
    checkAzureAuth: process.env.AGENT_RUNTIME_PRINT_PLAN === '1' ? () => true : defaultAzureCheck,
  });
  if (process.env.AGENT_RUNTIME_PRINT_PLAN === '1') {
    process.stdout.write(`${JSON.stringify(plan)}\n`);
    return;
  }
  const result = spawnSync(plan.command, plan.args, { env: plan.env, stdio: 'inherit' });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}
```

- [ ] **Step 7: Run the full docker test file to verify all pass**

Run: `node --test docker/launch-agent.test.mjs`
Expected: PASS — the four new tests and every pre-existing test.

- [ ] **Step 8: Run the whole suite to confirm no regressions**

Run: `npm test`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add docker/launch-agent.mjs docker/launch-agent.test.mjs
git commit -m "feat(container): add tool-stack-only runtime mode"
```

---

### Task 2: Repo-root `compose.ai-dev.yml`

**Files:**
- Create: `compose.ai-dev.yml`

**Interfaces:**
- Consumes: `AGENT_TOOLSTACK_ONLY=1` handling from Task 1.
- Produces: a Compose service `ai-dev-workflow` that mounts this repo at `/workspace` and runs in tool-stack-only mode.

- [ ] **Step 1: Create the Compose file**

Create `compose.ai-dev.yml` at the repo root with exactly this content:

```yaml
# Work on ai-dev-workflow itself inside its own agent image.
# Tool stack only (harnesses + managed MCPs + GitHub CLI); no generated
# dev-cycle definitions and no ai-project.json are required or read.
services:
  ai-dev-workflow:
    image: ${AGENT_IMAGE:-marxx/ai-dev-workflow:latest}
    working_dir: /workspace
    init: true
    stdin_open: true
    tty: true
    shm_size: 1gb
    security_opt:
      - no-new-privileges:true
    cap_drop:
      - ALL
    # Root setup remaps dev and owns its home, then drops privileges.
    cap_add:
      - CHOWN
      - DAC_OVERRIDE
      - FOWNER
      - SETUID
      - SETGID
    environment:
      AGENT_TOOLSTACK_ONLY: "1"
      PROJECT_ROOT: ${PROJECT_ROOT:?Set PROJECT_ROOT to this repo's absolute path}
      HOST_UID: ${HOST_UID:-1000}
      HOST_GID: ${HOST_GID:-1000}
      CONTEXT7_API_KEY: ${CONTEXT7_API_KEY:-}
    volumes:
      - type: bind
        source: ${PROJECT_ROOT:?Set PROJECT_ROOT to this repo's absolute path}
        target: /workspace
        bind:
          create_host_path: false
      - type: volume
        source: agent-home
        target: /home/dev
    command: ["bash"]

volumes:
  agent-home:
```

- [ ] **Step 2: Validate the Compose file parses**

Run: `PROJECT_ROOT="$(pwd)" docker compose -f compose.ai-dev.yml config --quiet`
Expected: exit 0, no output. (If Docker is unavailable in the execution environment, note that and skip — the file mirrors the validated `docker/docker-compose.yml` shape.)

- [ ] **Step 3: Commit**

```bash
git add compose.ai-dev.yml
git commit -m "feat(container): add self-dev compose.ai-dev.yml"
```

---

### Task 3: Documentation

**Files:**
- Modify: `docker/README.md` (insert a section after "## Prepare and launch (POSIX)", before "## Authentication and persistence" at :104)
- Modify: `README.md` (append to the "## Run in a container" section, before "## License" at :267)

**Interfaces:**
- Consumes: `compose.ai-dev.yml` from Task 2.
- Produces: user-facing launch instructions.

- [ ] **Step 1: Add the section to `docker/README.md`**

Insert this section immediately before the `## Authentication and persistence` heading:

```markdown
## Working on this repo in a container

This repository is the **generator**, not a consuming project — it has no `ai-project.json`
and no generated `.claude/.codex/.opencode` definitions. To work on it inside the agent image,
use the repo-root `compose.ai-dev.yml`, which sets `AGENT_TOOLSTACK_ONLY=1`. That mode wires
**only the tool stack** — the Claude Code / Codex / OpenCode harnesses, the managed Serena,
Playwright and Context7 MCP servers, Superpowers, and the GitHub CLI — and skips all
project-specific state (no `ai-project.json` read, no `ado` server, no generated dev-cycle
skills or subagents).

The default image is the published base `marxx/ai-dev-workflow:latest`; no local build is
needed. Override `AGENT_IMAGE` to use a locally built or pinned tag.

POSIX, from the repository root:

```bash
export PROJECT_ROOT="$(pwd)" HOST_UID="$(id -u)" HOST_GID="$(id -g)"
docker compose -f compose.ai-dev.yml run --rm ai-dev-workflow gh auth login   # one-time
docker compose -f compose.ai-dev.yml run --rm ai-dev-workflow claude --dangerously-skip-permissions
docker compose -f compose.ai-dev.yml run --rm ai-dev-workflow codex --yolo
docker compose -f compose.ai-dev.yml run --rm ai-dev-workflow opencode
docker compose -f compose.ai-dev.yml run --rm ai-dev-workflow bash
```

PowerShell:

```powershell
$env:PROJECT_ROOT = (Get-Location).Path
docker compose -f compose.ai-dev.yml run --rm ai-dev-workflow gh auth login   # one-time
docker compose -f compose.ai-dev.yml run --rm ai-dev-workflow claude --dangerously-skip-permissions
```

The `agent-home` volume persists `/home/dev`, so the one-time `gh auth login` and each agent's
own `login` survive across `run --rm` invocations. `npm test` (`node --test`) runs inside `bash`
just as it does on the host.
```

- [ ] **Step 2: Add a pointer in the root `README.md`**

Append this paragraph to the end of the "## Run in a container" section (immediately before `## License`):

```markdown
To work on **this repository itself** in a container — tool stack only, without the generated
dev-cycle skills and subagents — use the repo-root `compose.ai-dev.yml` (it sets
`AGENT_TOOLSTACK_ONLY=1`):

```bash
export PROJECT_ROOT="$(pwd)" HOST_UID="$(id -u)" HOST_GID="$(id -g)"
docker compose -f compose.ai-dev.yml run --rm ai-dev-workflow bash
```

See [`docker/README.md`](docker/README.md) → *Working on this repo in a container*.
```

- [ ] **Step 3: Verify the docs render and links resolve**

Run: `grep -n "Working on this repo in a container" docker/README.md README.md`
Expected: the heading in `docker/README.md` and the pointer reference in `README.md` both appear.

- [ ] **Step 4: Commit**

```bash
git add docker/README.md README.md
git commit -m "docs(container): document the self-dev tool-stack container"
```

---

## Self-Review

**Spec coverage:**
- Tool-stack-only runtime mode (spec §1) → Task 1 (all steps).
- Root `compose.ai-dev.yml` with `AGENT_TOOLSTACK_ONLY=1`, base image default, hardened shape, home volume (spec §2) → Task 2.
- GitHub setup + docs section + root pointer (spec §3) → Task 3.
- Testing (spec §4): configureRuntime without `ai-project.json`, buildLaunchPlan managed-only/no-ado for codex and claude, CLI env-var path → Task 1 Steps 1–8.
- Non-goals (spec §5): no generator run, no `.devcontainer/`, no image variant, no `files` allowlist change — nothing in any task adds these. ✓

**Placeholder scan:** No TBD/TODO; every code step shows exact content. ✓

**Type/name consistency:** `toolstackOnly` (option) and `AGENT_TOOLSTACK_ONLY` (env) used identically across `readProjectState`, `configureRuntime`, `buildLaunchPlan`, `runCli`, and the Compose file. Managed server names (`serena`, `playwright`, `context7`, absence of `ado`) match `managedServers` in the source. ✓
