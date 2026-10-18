# `init` container setup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `init` asks whether to set up the dev container and writes the project-owned
`compose.ai-dev.yml`, the certs overlay, `ai-dev.sh`, `ai-dev.ps1` and `AI-DEV.md`, all preset for
the chosen stack and backend. It then prints exact next steps.

**Architecture:** A new leaf-ish module `agent-src/lib/container.mjs` holds the pure logic (stack
detection, slug, template rendering, next-steps text) and the write-if-missing file I/O. Templates
live in `agent-src/container/` and use `@@KEY@@` placeholders, rendered by plain string replacement
outside the generator pipeline. `onboard.mjs` asks the two new questions and calls into
`container.mjs`.

**Tech Stack:** Node >= 24 builtins only, `node:test`, POSIX sh, PowerShell 5.1/7, Docker Compose.

**Spec:** `docs/superpowers/specs/2026-10-18-init-container-setup-design.md`

## Global Constraints

- Zero runtime dependencies; LF line endings in every written file (including `ai-dev.ps1`).
- Container answers are **not** written to `ai-project.json`; `generate`/`check`/`upgrade` never touch the container files.
- Never overwrite an existing file; report each one as left untouched.
- Interactive default for `container.enabled` is `y`; a scripted prompter with the key missing means **no** container.
- Image tags: `node` → `marxx/ai-dev-workflow:node-latest`, `dotnet` → `marxx/ai-dev-workflow:dotnet-latest`, `generic` → `marxx/ai-dev-workflow:latest`, always as `${AGENT_IMAGE:-<image>}`.
- Compose project name: top-level `name: <slug>-ai`.
- Launchers pass args through verbatim, add no flags, default to `bash` (no args).
- Every new non-test runtime file is reachable through `package.json` `files` (AGENTS.md rule 2).
- Tests cover logic only. Templates and prose get no tests beyond "no unresolved placeholders".

## Review Focus

1. Project name that slugs to empty (e.g. `"!!!"`, non-Latin script) → slug falls back to `project`, never `-ai` (test in Task 1).
2. Existing `.gitignore` without trailing newline, or already containing `.env.ai-dev` → appended on its own line exactly once (test in Task 2).
3. Declined overwrite with an existing `ai-project.json` that lacks `project.name`/`ticketing` → falls back to the directory basename / `file` backend instead of crashing (test in Task 3).
4. Project root path with spaces → launchers quote `PROJECT_ROOT` and the compose file paths (manual check in Task 5).
5. `.env.ai-dev` with CRLF lines, `#` comments or a value already set in the environment → CR stripped, comments skipped, environment wins (manual check in Task 5).

---

### Task 1: Templates and pure rendering (`container.mjs`)

**Files:**
- Create: `agent-src/container/compose.ai-dev.yml` (from `docker/docker-compose.yml`)
- Create: `agent-src/container/compose.ai-dev.certs.yml` (from `docker/docker-compose.certs.yml`)
- Create: `agent-src/container/ai-dev.sh`, `agent-src/container/ai-dev.ps1`, `agent-src/container/AI-DEV.md`
- Create: `agent-src/container/ticketing/{file,github,gitea,azure-devops}.md`
- Create: `agent-src/lib/container.mjs`
- Test: `agent-src/lib/container.test.mjs`
- Modify: `package.json` `files` (add `"agent-src/container"` and `"agent-src/lib/container.mjs"`)

**Interfaces:**
- Produces:
  - `STACKS = ['node', 'dotnet', 'generic']`
  - `detectStack(projectRoot: string) => 'node'|'dotnet'|'generic'`
  - `composeSlug(name: string) => string`
  - `renderContainerFiles({ name, stack, backend, giteaLogin? }) => Array<{ path: string, content: string, mode?: number }>`. Its paths are relative to the project root, in this order: `compose.ai-dev.yml`, `compose.ai-dev.certs.yml`, `ai-dev.sh` (mode `0o755`), `ai-dev.ps1`, `AI-DEV.md`. It throws `Error('container template: unresolved placeholder …')` if any `@@[A-Z_]+@@` remains.

Placeholders: `@@SLUG@@`, `@@IMAGE@@`, `@@TICKETING@@` (the whole content of `ticketing/<backend>.md`),
`@@GITEA_LOGIN@@` (only inside `ticketing/gitea.md`), `@@NODE_MOUNT@@` and `@@NODE_VOLUME@@`. The last two
are each alone on a line. For `node` they become the volume mount
(`- type: volume` / `source: deps-node-modules` / `target: /workspace/node_modules`, with the
surrounding indentation) and the top-level `deps-node-modules:` entry. For other stacks the whole
line is removed.

Template content (exact copy is the builder's, structure fixed by the spec):
- `compose.ai-dev.yml`: today's `docker/docker-compose.yml` with `name: @@SLUG@@-ai` first, image
  `${AGENT_IMAGE:-@@IMAGE@@}`, the header comment replaced by "Project-owned; written once by
  ai-dev-workflow init. Start it with ./ai-dev.sh or .\ai-dev.ps1", the two node placeholders, and
  the nested-tree example kept.
- `compose.ai-dev.certs.yml`: today's overlay with its header saying the launchers apply it when
  `AGENT_CA_DIR` is set (e.g. in `.env.ai-dev`).
- `ai-dev.sh` / `ai-dev.ps1`: behavior per spec § Launchers, steps 1–5. In `.env.ai-dev` parsing,
  strip a trailing `\r`, skip blank and `#` lines, split on the first `=`, and never override a
  variable that is already set, even to an empty value.
- `AI-DEV.md`: spec § `AI-DEV.md` sections 1, 2, 4, 5, with `@@TICKETING@@` as section 3 and
  `@@SLUG@@` in the `docker volume rm @@SLUG@@-ai_agent-home` line.
- `ticketing/*.md`: spec § `AI-DEV.md` item 3, one file per backend; each ends with the
  `git ls-remote origin` check.

- [ ] **Step 1: Write the failing tests** in `container.test.mjs`:

```js
test('detectStack: package.json → node, *.csproj/*.sln/*.slnx → dotnet, both → dotnet, neither → generic', …);
test('composeSlug lowercases and dashes runs of invalid chars', () => {
  assert.equal(composeSlug('My Cool_App 2'), 'my-cool_app-2');
  assert.equal(composeSlug('  --Foo..Bar--  '), 'foo-bar');
  assert.equal(composeSlug('!!!'), 'project');
});
for (const stack of STACKS) test(`renderContainerFiles(${stack}) sets name, image and node volume only for node`, () => {
  // compose.ai-dev.yml contains 'name: demo-ai' and `${AGENT_IMAGE:-marxx/ai-dev-workflow:<tag>}`
  // contains 'target: /workspace/node_modules' and '  deps-node-modules:' iff stack === 'node'
  // no line in it is blank-but-whitespace-only where a placeholder was removed
});
for (const backend of ['file','github','gitea','azure-devops']) test(`AI-DEV.md for ${backend} carries only that backend's login`, () => {
  // github → contains 'gh auth setup-git', not 'az login' / 'tea login'
  // gitea (giteaLogin: 'myserver') → contains 'tea login add' and 'myserver'
  // azure-devops → contains 'az login --use-device-code'
  // file → contains none of 'gh auth', 'tea login', 'az login'
  // every backend → contains 'git ls-remote origin' and 'docker volume rm demo-ai_agent-home'
});
test('rendered files contain no @@PLACEHOLDER@@ and ai-dev.sh has mode 0o755', …);
```

- [ ] **Step 2: Run** `node --test agent-src/lib/container.test.mjs`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement** the templates and `container.mjs`. Read templates from `path.join(SRC_DIR, 'container')`. Empty-slug fallback: `'project'`.
- [ ] **Step 4: Run** `node --test agent-src/lib/container.test.mjs`. Expected: PASS. Then `bash -n agent-src/container/ai-dev.sh` (exit 0) and `npm pack --dry-run 2>&1 | grep -c 'agent-src/container/'` (≥ 9).
- [ ] **Step 5: Commit** `feat(init): container templates and rendering`.

### Task 2: Writing the files (`container.mjs`)

**Files:**
- Modify: `agent-src/lib/container.mjs`
- Test: `agent-src/lib/container.test.mjs`

**Interfaces:**
- Consumes: `renderContainerFiles` (Task 1).
- Produces:
  - `ensureLine(file: string, line: string) => boolean`: creates the file if missing; appends `line` (preceded by `\n` if the file does not end in one) unless a trimmed line already equals it; returns true if it wrote.
  - `writeContainerFiles(projectRoot, opts) => { written: string[], skipped: string[] }`. `opts` is the same object as `renderContainerFiles`. It writes each rendered file only if missing, `chmod`s it when `mode` is set, and reports the path in `skipped` otherwise. It then calls `ensureLine('.gitignore', '.env.ai-dev')` and `ensureLine('.gitattributes', 'ai-dev.sh text eol=lf')`, and adds each to `written` when it changed.

- [ ] **Step 1: Write the failing tests:**

```js
test('writeContainerFiles writes all files into an empty root', …); // written has 7 entries; ai-dev.sh stat mode & 0o777 === 0o755 (skip the mode assert on win32)
test('writeContainerFiles leaves existing files untouched and reports them', …); // pre-write compose.ai-dev.yml 'mine' → still 'mine', in skipped
test('ensureLine appends once, on its own line, and creates missing files', () => {
  // '.gitignore' = 'node_modules' (no trailing NL) → 'node_modules\n.env.ai-dev\n'; second call returns false, content unchanged
  // existing '  .env.ai-dev  ' line → returns false
});
```

- [ ] **Step 2: Run** `node --test agent-src/lib/container.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement** both functions.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(init): write container files once`.

### Task 3: Interview and next steps (`onboard.mjs`)

**Files:**
- Modify: `agent-src/lib/onboard.mjs` (`createReadlinePrompter`, `createScriptedPrompter`, `runInterview` caller, `cmdInit`)
- Modify: `agent-src/lib/container.mjs` (add `nextSteps`)
- Test: `agent-src/lib/onboard.test.mjs`, `agent-src/lib/container.test.mjs`

**Interfaces:**
- Consumes: `detectStack`, `STACKS`, `writeContainerFiles` (Tasks 1–2).
- Produces:
  - Prompters gain `scripted: boolean` (`true` only for `createScriptedPrompter`).
  - `askContainer(prompter, projectRoot) => { enabled: boolean, stack?: string }` in `onboard.mjs`. It asks `Set up the dev container? (Y/n)` (key `container.enabled`, default `prompter.scripted ? 'n' : 'y'`, yes = `/^(y|yes|true)$/i`), then `Container stack` via `askChoice` (key `container.stack`, choices `STACKS`, default `detectStack(projectRoot)`).
  - `nextSteps({ backend, version }) => string` in `container.mjs`, the container-path printout from spec § Next-steps printout. Generate line: `npx @strobl_dev/adw@<version> generate`. Ticketing line per backend: github `./ai-dev.sh gh auth login && ./ai-dev.sh gh auth setup-git`; gitea `./ai-dev.sh tea login add`; azure-devops `./ai-dev.sh az login --use-device-code --allow-no-subscriptions`; file has no line, and the following steps renumber.

`cmdInit` flow:
1. If `ai-project.json` exists and overwrite is declined, take `name` from `config.project?.name || path.basename(projectRoot)` and `backend` / `giteaLogin` from `config.ticketing` (default `file`), read leniently, a parse error → treat as `{}`. Then `askContainer`. Disabled → print `Left untouched.` and return 0 (today's behavior). Enabled → write the container files and print the summary.
2. Otherwise: interview → write `ai-project.json` → `askContainer` → when enabled, write the container files.
3. Output when enabled: `Created <dest>` (if written), one line per written file, `left untouched: <path>` per skipped one, then `nextSteps(...)`. `DEPENDENCIES` and `AGENTS_MD_GUIDANCE` are not printed. When disabled: today's output, unchanged.
4. `version` is read from `path.join(SRC_DIR, '..', 'package.json')`.

- [ ] **Step 1: Write the failing tests:**

```js
// onboard.test.mjs
test('cmdInit without container answers writes only ai-project.json', …); // existing 'nothing else' loop already covers it; keep green
test('cmdInit with container.enabled y writes the container files for the chosen stack', …); // { ...GITHUB_ANSWERS, container: { enabled: 'y', stack: 'dotnet' } } → compose has 'dotnet-latest', AI-DEV.md has 'gh auth'
test('cmdInit stack defaults to the detected one', …); // root has package.json, container: { enabled: 'y' } → 'node-latest'
test('declined overwrite still writes container files from the existing config', …); // existing ai-project.json = buildProjectConfig(GITEA_ANSWERS); answers { container: { enabled: 'y', stack: 'generic' } } → ai-project.json byte-identical, AI-DEV.md has 'myserver'
test('declined overwrite with an incomplete ai-project.json falls back to dir name and file backend', …); // '{"keep":true}' → compose 'name: <slug of basename>-ai', AI-DEV.md has no 'gh auth'
test('declining both overwrite and container writes nothing', …);
// container.test.mjs
test('nextSteps lists the versioned generate command and the backend login, numbered without gaps', …); // github → '1. npx @strobl_dev/adw@1.2.3 generate', contains 'gh auth setup-git'; file → no 'auth' line and steps numbered 1..5 consecutively
```

- [ ] **Step 2: Run** `node --test agent-src/lib/onboard.test.mjs agent-src/lib/container.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement** per the flow above.
- [ ] **Step 4: Run** `npm test`. Expected: all PASS (the e2e seed path is unaffected because its answers lack `container`).
- [ ] **Step 5: Commit** `feat(init): ask for and set up the dev container`.

### Task 4: Single source and docs

**Files:**
- Delete: `docker/docker-compose.yml`, `docker/docker-compose.certs.yml`
- Modify: `docker/tests/runtime-smoke.mjs:9,86`, `docker/README.md`, `README.md` (§ Run in a container), `AGENTS.md` (Architecture: `container.mjs` bullet; `onboard.mjs` bullet no longer says "Writes `ai-project.json` only"), `agent-src/README.md` (layout: `container/`)

**Interfaces:**
- Consumes: `renderContainerFiles` (Task 1).

- [ ] **Step 1: Point the smoke test at the rendered template.** At startup, write `renderContainerFiles({ name: 'smoke', stack: 'generic', backend: 'azure-devops' })`'s `compose.ai-dev.yml` content into the temp dir and use that path as `template`. It imports from `../../agent-src/lib/container.mjs`. Line 86, which copies it to `project/compose.ai-dev.yml`, keeps working. The rest stays `-p`-based (`-p` overrides `name:`).
- [ ] **Step 2: Run** `node --check docker/tests/runtime-smoke.mjs` (exit 0). If Docker and a local image are available, also `node docker/tests/runtime-smoke.mjs`; otherwise note that it was skipped.
- [ ] **Step 3: Docs.** In `docker/README.md`, replace the "Copy `docker/docker-compose.yml` …" paragraph and both *Prepare and launch* sections with: run `init`, answer yes, use `./ai-dev.sh` / `.\ai-dev.ps1`; manual: `init --answers` with a `container` block. TLS step 2 becomes "put `AGENT_CA_DIR` in `.env.ai-dev`; the launchers add the overlay". Keep the other sections, rewriting `docker compose -p … run --rm ai-dev-workflow X` examples as `./ai-dev.sh X`. `README.md`: lead § Run in a container with `init`, drop the consuming-project `export … -p` block, keep the self-dev block, and change the certs paragraph to `.env.ai-dev`. Then run `grep -rn "docker/docker-compose" --exclude-dir=node_modules --exclude-dir=docs .`. Expected: no hits.
- [ ] **Step 4: Run** `npm test` (PASS) and `npm pack --dry-run` (lists `agent-src/container/…` and `agent-src/lib/container.mjs`, no `docker/`).
- [ ] **Step 5: Commit** `refactor(docker): init owns the compose templates; docs point at init`.

### Task 5: End-to-end manual check

- [ ] **Step 1:** In a scratch dir containing `package.json` and the project name `My App`, run `node agent-src/generate.mjs init --root <dir> --answers <file>` with `{ name: 'My App', repoSlug: 'me/app', backend: 'github', container: { enabled: 'y' } }`. Expected: 7 files reported, then the next-steps list.
- [ ] **Step 2:** Move the dir to a path with a space. Run `HOST_UID= ./ai-dev.sh true` from another cwd (`<dir>/ai-dev.sh true`). Expected: exit 0, and the container started from `marxx/ai-dev-workflow:node-latest` (pull allowed). Then `./ai-dev.sh bash -c 'exit 3'`. Expected: exit 3.
- [ ] **Step 3:** Write `.env.ai-dev` with CRLF lines, a `# comment` and `AGENT_CA_DIR=<dir with one PEM>`. Run `./ai-dev.sh true`. Expected: `trusted 1 company root certificate(s)` in the output. Run `AGENT_CA_DIR= ./ai-dev.sh true`. Expected: no cert line, because the environment wins over `.env.ai-dev`.
- [ ] **Step 4:** Syntax-check the PowerShell script: `docker run --rm -v <dir>:/w mcr.microsoft.com/powershell:lts-7.4-ubuntu-22.04 pwsh -NoProfile -Command "[System.Management.Automation.Language.Parser]::ParseFile('/w/ai-dev.ps1',[ref]\$null,[ref]\$e) > \$null; \$e.Count"`. Expected: `0`. Ask the user to run `.\ai-dev.ps1 true` on Windows.
- [ ] **Step 5:** Fix anything found (commit `fix(init): …`), then `npm test` is green.
