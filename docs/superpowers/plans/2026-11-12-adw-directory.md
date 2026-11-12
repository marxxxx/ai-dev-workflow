# `.adw/` Directory and `adw` Launchers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move everything adw owns in a consuming project into `.adw/`, rename the root launchers to `adw.sh` / `adw.ps1`, and let `upgrade` migrate existing projects and print each change.

**Architecture:** One set of path constants in `agent-src/lib/constants.mjs` replaces every hard-coded root path. A new `agent-src/lib/layout.mjs` owns the old→new map, the old-layout refusal and the migration; `generate.mjs` calls the refusal for `generate`/`check`/`init` and runs the migration first in `upgrade`. Every `docker compose` call adw makes gets `--project-directory <root>`.

**Tech Stack:** Node ≥ 24, builtins only, `node:test`; POSIX sh + PowerShell launchers; Docker Compose.

**Spec:** `docs/superpowers/specs/2026-11-12-adw-directory-design.md`

## Global Constraints

- Zero runtime dependencies; LF line endings everywhere.
- New paths, exactly: `.adw/project.json`, `.adw/compose.yml`, `.adw/compose.certs.yml`, `.adw/compose.dind.yml`, `.adw/compose.dind-certs.yml`, `.adw/README.md`, `.adw/.env`, `.adw/custom/`, launchers `adw.sh` (mode 0755) and `adw.ps1` at the root. `.adw/e2e/` is unchanged.
- Unchanged names: Compose project `name: <slug>-ai`, service `ai-dev-workflow`, image `marxx/ai-dev-workflow:*`, `# BEGIN/END ai-dev-workflow managed` markers, `~/.cache/ai-dev-workflow`, all `AGENT_*` variables.
- `.gitignore`: add `.adw/.env`, never remove `.env.ai-dev`. `.gitattributes`: `adw.sh text eol=lf` replaces `ai-dev.sh text eol=lf`.
- `upgrade` moves files without changing content; only `adw.sh`, `adw.ps1` and `.adw/README.md` are written fresh from templates (old `ai-dev.sh`, `ai-dev.ps1`, `AI-DEV.md` deleted). Never overwrite an existing target.
- `.env.ai-dev` never blocks a command; every other old-layout path does (`generate`, `check`, `init`, `adw e2e`).
- No old-layout support in `adw e2e` sandboxes (no migration of base commits).
- Rule 2 of AGENTS.md: a new `agent-src/lib/*.mjs` goes into `package.json` `files` in the same commit; verify with `npm pack --dry-run`.
- User docs state only the user-visible change and what to do.

## Review Focus

1. Running `upgrade` twice: the second run finds nothing to move, prints no move lines and exits 0. → Task 3 test `migrateLayout is idempotent`.
2. A project with `ai-project.json` (and maybe `agent-custom/`) but no container files: only those move; no launcher or README is written, `.gitignore`/`.gitattributes` untouched. → Task 3 test `migrateLayout without container files moves only the config`.
3. A `.gitignore` with CRLF endings or no `.env.ai-dev` line but a moved `.env.ai-dev`: `.adw/.env` is still added exactly once. → Task 3 test `migrateLayout adds .adw/.env to a CRLF .gitignore once`.
4. A customized `compose.ai-dev.yml` whose `name:` does not end in `-ai` (or has none): README slug falls back to `composeSlug(project.name, basename(root))`, no crash. → Task 3 test `migrateLayout README slug falls back without a -ai name`.
5. `adw.sh` started from a subdirectory (`cd src && ../adw.sh`): Compose still gets `--project-directory <root>` and `-f <root>/.adw/compose.yml`. → Task 2 test `adw.sh passes the project root as project directory from any cwd`.

---

### Task 1: Project config and customizations live under `.adw/`

**Files:**
- Modify: `agent-src/lib/constants.mjs`, `agent-src/lib/config.mjs:32`, `agent-src/lib/skills.mjs:84-120`, `agent-src/lib/upgrade.mjs:125-133`, `agent-src/lib/onboard.mjs:53-61,261-301`, `agent-src/lib/units.mjs:39-43`, `agent-src/lib/renderers.mjs:9-14`, `agent-src/generate.mjs:113`
- Test: `agent-src/test-helpers.mjs`, `agent-src/cli.test.mjs`, `agent-src/generate.test.mjs`, `agent-src/lib/{pipeline,skills,upgrade,onboard}.test.mjs`

**Interfaces:**
- Produces (in `constants.mjs`, all forward-slash relative paths, used with `path.join(root, X)`):
  `ADW_DIR = '.adw'`, `PROJECT_FILE = '.adw/project.json'`, `CUSTOM_DIR = '.adw/custom'`, `ENV_FILE = '.adw/.env'`, `README_FILE = '.adw/README.md'`,
  `COMPOSE_FILES = { base: '.adw/compose.yml', certs: '.adw/compose.certs.yml', dind: '.adw/compose.dind.yml', dindCerts: '.adw/compose.dind-certs.yml' }`,
  `LAUNCHERS = { sh: 'adw.sh', ps1: 'adw.ps1' }`.

- [ ] **Step 1: Switch the test fixtures to the new location and add the new assertions**

`tmpProject` in `test-helpers.mjs` writes `MINIMAL_PROJECT` to `.adw/project.json` (mkdir `.adw`). Replace every `ai-project.json` / `agent-custom` fixture path in the listed tests with `PROJECT_FILE` / `CUSTOM_DIR`. Add:

```js
test('init --answers writes .adw/project.json and nothing at the root', () => {
  // runCli(['init', '--answers', answersFile, '--root', root]) with a file-backend answers file
  assert.ok(fs.existsSync(path.join(root, '.adw', 'project.json')));
  assert.ok(!fs.existsSync(path.join(root, 'ai-project.json')));
});
test('a customized unit carries the .adw/custom banner', () => {
  // .adw/custom/skills/agent-dev/append.md present → rendered SKILL.md
  assert.match(content, /DO NOT EDIT — generated from agent-src\/skills\/agent-dev \+ \.adw\/custom\/skills\/agent-dev;/);
});
```

- [ ] **Step 2: Run `npm test` and confirm the new and switched tests fail** (config not found / wrong banner).

- [ ] **Step 3: Implement**

Add the constants. `loadConfig`, `syncSkills`, `cleanProjectConfig`, `cmdScaffold`, `cmdInit`, `generate.mjs` read/write `path.join(root, PROJECT_FILE)` (writers `mkdirSync(.adw, { recursive: true })` first). `units.mjs` uses `CUSTOM_DIR`; `renderers.mjs` builds the banner source from `CUSTOM_DIR` (`${CUSTOM_DIR}/${type}/${name}`). User-facing strings say `.adw/project.json`; `onboard.mjs` messages say `adw generate` instead of `ai-dev-workflow generate`.

- [ ] **Step 4: Run `npm test`; expected: all pass.**

- [ ] **Step 5: Commit** — `feat: read project config and customizations from .adw/`

---

### Task 2: Container files render into `.adw/` with `adw` launchers

**Files:**
- Rename (git mv) in `agent-src/container/`: `compose.ai-dev.yml`→`compose.yml`, `compose.ai-dev.certs.yml`→`compose.certs.yml`, `compose.ai-dev.dind.yml`→`compose.dind.yml`, `compose.ai-dev.dind-certs.yml`→`compose.dind-certs.yml`, `ai-dev.sh`→`adw.sh`, `ai-dev.ps1`→`adw.ps1`, `AI-DEV.md`→`README.md`
- Modify: those templates' text, `agent-src/container/ticketing/*.md`, `agent-src/lib/container.mjs`, `agent-src/lib/onboard.mjs` (`setUpContainer` messages, `askContainer` comment), `docker/tools/inventory.mjs:24`, `docker/tests/inventory.test.mjs:14`, `docker/tests/dind-smoke.mjs:16-23`, `docker/tests/runtime-smoke.mjs` (template names, project file `.adw/project.json`), `.claude/skills/dependency-update-check/SKILL.md:22`
- Test: `agent-src/lib/container.test.mjs`, `agent-src/lib/onboard.test.mjs`

**Interfaces:**
- Consumes: Task 1 constants.
- Produces (in `container.mjs`):
  - `renderContainerFiles({ name, stack, backend, giteaLogin = '', projectDir = '', slug }) → Array<{ path, content, mode? }>`; paths in this order: `COMPOSE_FILES.base`, `.certs`, `.dind`, `.dindCerts`, `LAUNCHERS.sh` (mode `0o755`), `LAUNCHERS.ps1`, `README_FILE`. `slug` overrides `composeSlug(name, basename(projectDir))` when given.
  - `writeContainerFiles(projectRoot, opts)` — unchanged contract; creates `.adw/`, ensures `.adw/.env` in `.gitignore`, `adw.sh text eol=lf` in `.gitattributes`, settings into `ENV_FILE`.
  - `replaceLine(file, oldLine, newLine) → boolean` — replaces a line whose trim equals `oldLine`; false when absent or file missing; keeps the file's other lines and ending style.
  - `containerWarnings(projectRoot)` — only the KILL check, on `COMPOSE_FILES.base`. `pullWarning` and its tests are removed.
  - `nextSteps({ backend, version })` — `./adw.sh …`, commit step `Commit .adw/, adw.sh, adw.ps1 and the generated dirs.`, footer `Details: .adw/README.md  (PowerShell: .\adw.ps1 instead of ./adw.sh)`.

- [ ] **Step 1: Update and add tests in `container.test.mjs`**

Switch existing expectations to the new paths (`fileOf(files, '.adw/compose.yml')`, the `ai-dev.sh` script tests run `adw.sh`). Add:

```js
test('renderContainerFiles returns the seven files under .adw/ and the root launchers', () => {
  const files = renderContainerFiles({ name: 'Demo', stack: 'generic', backend: 'file' });
  assert.deepEqual(files.map((f) => f.path), ['.adw/compose.yml', '.adw/compose.certs.yml', '.adw/compose.dind.yml',
    '.adw/compose.dind-certs.yml', 'adw.sh', 'adw.ps1', '.adw/README.md']);
  assert.equal(fileOf(files, 'adw.sh').mode, 0o755);
  for (const f of files) assert.doesNotMatch(f.content, /ai-dev\.sh|ai-dev\.ps1|AI-DEV\.md|compose\.ai-dev|\.env\.ai-dev/, f.path);
});
test('renderContainerFiles uses an explicit slug', () => {
  const readme = fileOf(renderContainerFiles({ name: 'Demo', stack: 'generic', backend: 'file', slug: 'legacy' }), '.adw/README.md').content;
  assert.ok(readme.includes('legacy-ai_agent-home'));
});
test('writeContainerFiles ignores .adw/.env and marks adw.sh as LF', () => {
  // empty root → .gitignore has line '.adw/.env', .gitattributes has 'adw.sh text eol=lf', settings land in .adw/.env
});
test('replaceLine swaps one trimmed line and reports whether it changed', () => {
  // file 'a\r\nai-dev.sh text eol=lf\r\n' → true, content 'a\r\nadw.sh text eol=lf\r\n'; second call → false; missing file → false
});
test('adw.sh passes the project root as project directory from any cwd', { skip: process.platform === 'win32' }, () => {
  // run `../adw.sh true` from <root>/src with the existing fake-docker harness; every recorded compose call
  // starts with ['compose', '--project-directory', root, '-f', `${root}/.adw/compose.yml`]
});
test('adw.sh reads .adw/.env and warns about a leftover .env.ai-dev', { skip: process.platform === 'win32' }, () => {
  // .adw/.env AGENT_DIND=1 → dind overlay added; only .env.ai-dev present → stderr matches /move \.env\.ai-dev to \.adw\/\.env/, run continues
});
test('containerWarnings checks .adw/compose.yml for KILL', () => { /* old KILL cases, file at .adw/compose.yml */ });
```

- [ ] **Step 2: Run `node --test agent-src/lib/container.test.mjs`; expected: new tests fail.**

- [ ] **Step 3: Implement the template renames and `container.mjs`**

Template source → destination: launchers keep their template name at the root; every other template goes to `.adw/<template name>`. Launchers: `root` stays the script's directory; env file `$root/.adw/.env`; when `$root/.env.ai-dev` exists and `$root/.adw/.env` does not, print to stderr `adw.sh: move .env.ai-dev to .adw/.env, or run adw upgrade; it is not read anymore.` (same text with `adw.ps1:` via `Write-Warning`); every compose call is `docker compose --project-directory "$root" -f "$root/.adw/compose.yml" …`. Header comments, `README.md` and `ticketing/*.md` say `./adw.sh`, `.\adw.ps1`, `.adw/.env`, `.adw/compose*.yml`, `adw init`; the README's manual command shows `--project-directory`. The derived inventory path becomes `agent-src/container/compose.dind.yml` (run `node docker/tools/inventory.mjs check` afterwards).

- [ ] **Step 4: Run `npm test` and `node docker/tools/inventory.mjs check`; expected: pass.**

- [ ] **Step 5: Commit** — `feat: render container files into .adw/ with adw launchers`

---

### Task 3: `layout.mjs` — old-layout detection and migration

**Files:**
- Create: `agent-src/lib/layout.mjs`, `agent-src/lib/layout.test.mjs`
- Modify: `package.json` (`files`: add `agent-src/lib/layout.mjs`)

**Interfaces:**
- Consumes: Task 1 constants; Task 2 `renderContainerFiles`, `composeSlug`, `ensureLine`, `replaceLine`; `readJson` from `config.mjs`.
- Produces:
  - `LEGACY_MOVES: Array<[from, to]>` — `ai-project.json`→`.adw/project.json`, the four `compose.ai-dev*.yml`→`COMPOSE_FILES.*`, `.env.ai-dev`→`.adw/.env`, `agent-custom`→`.adw/custom`.
  - `LEGACY_REWRITES: Array<[from, to]>` — `ai-dev.sh`→`adw.sh`, `ai-dev.ps1`→`adw.ps1`, `AI-DEV.md`→`.adw/README.md`.
  - `legacyLayoutPaths(projectRoot) → string[]` — existing `from` paths of both lists, except `.env.ai-dev`.
  - `assertCurrentLayout(projectRoot) → void` — throws `Error` with message ``Old adw layout found: <paths, comma-separated>. Run adw's `upgrade` command to move them into .adw/.`` when `legacyLayoutPaths` is non-empty.
  - `migrateLayout(projectRoot, { dryRun = false } = {}) → { changes: Array<{ from, to, kind: 'move' | 'rewrite' }>, conflicts: Array<{ from, to }>, edits: string[] }`.

- [ ] **Step 1: Write the failing tests in `layout.test.mjs`** (use `makeTmpRoot`)

```js
test('migrateLayout moves every old file unchanged and rewrites launchers and README', () => {
  // old layout: ai-project.json (gitea, login 'srv'), compose.ai-dev.yml with 'name: shop-ai' + a custom line,
  // all three overlays, .env.ai-dev, agent-custom/skills/agent-dev/append.md, ai-dev.sh, ai-dev.ps1, AI-DEV.md,
  // .gitignore '.env.ai-dev\n', .gitattributes 'ai-dev.sh text eol=lf\n'
  const r = migrateLayout(root);
  assert.equal(read('.adw/compose.yml'), originalCompose);            // byte-identical
  assert.equal(read('.adw/custom/skills/agent-dev/append.md'), 'x');
  for (const old of ['ai-project.json', 'compose.ai-dev.yml', '.env.ai-dev', 'agent-custom', 'ai-dev.sh', 'ai-dev.ps1', 'AI-DEV.md'])
    assert.ok(!exists(old), old);
  assert.ok(read('.adw/README.md').includes('shop-ai_agent-home') && read('.adw/README.md').includes('--login srv'));
  assert.ok(read('adw.sh').includes('.adw/compose.yml'));
  if (process.platform !== 'win32') assert.equal(fs.statSync(abs('adw.sh')).mode & 0o777, 0o755);
  assert.deepEqual(read('.gitignore').split('\n').filter(Boolean), ['.env.ai-dev', '.adw/.env']);
  assert.equal(read('.gitattributes'), 'adw.sh text eol=lf\n');
  assert.deepEqual(r.conflicts, []);
  assert.ok(r.changes.some((c) => c.from === 'ai-dev.sh' && c.to === 'adw.sh' && c.kind === 'rewrite'));
  assert.ok(r.changes.some((c) => c.from === 'compose.ai-dev.yml' && c.kind === 'move'));
});
test('migrateLayout is idempotent', () => { /* second call → changes [], conflicts [], edits [] */ });
test('migrateLayout dryRun reports the same changes and touches nothing', () => { /* snapshot of the tree before === after */ });
test('migrateLayout leaves both files on a conflict and still moves the rest', () => {
  // ai-project.json and .adw/project.json both exist, plus compose.ai-dev.yml
  // → conflicts [{ from: 'ai-project.json', to: '.adw/project.json' }], both unchanged; compose moved
});
test('migrateLayout without container files moves only the config', () => {
  // only ai-project.json + agent-custom/ → no adw.sh, no .adw/README.md, no .gitignore created
});
test('migrateLayout adds .adw/.env to a CRLF .gitignore once', () => {
  // '.env.ai-dev\r\nnode_modules\r\n' → contains '.adw/.env' exactly once after two runs
});
test('migrateLayout README slug falls back without a -ai name', () => {
  // compose.ai-dev.yml with 'name: custom' and project name 'My Shop' → README mentions 'my-shop-ai_agent-home'
});
test('legacyLayoutPaths ignores .env.ai-dev; assertCurrentLayout names the rest', () => {
  // only .env.ai-dev → []; ai-project.json + ai-dev.sh → throws /Old adw layout found: ai-project\.json, ai-dev\.sh/
});
```

- [ ] **Step 2: Run `node --test agent-src/lib/layout.test.mjs`; expected: fails (module missing).**

- [ ] **Step 3: Implement `layout.mjs`**

Order: (1) moves with `fs.renameSync` after `mkdirSync('.adw')`, conflict when `to` exists; (2) rewrites, only when `from` exists: render via `renderContainerFiles` with backend/login from the (moved) project file — in `dryRun` read the old location — `stack: 'generic'`, `slug` from the first `^name:\s*["']?(\S+?)-ai["']?\s*$` line of the moved or old compose file, else undefined (the default then applies); write `to` (mode 0755 for `adw.sh`), delete `from`; conflict when `to` exists; (3) edits: when `.env.ai-dev` was moved or `.gitignore` lists it, `ensureLine(.gitignore, '.adw/.env')` → edit `Added .adw/.env to .gitignore`; `replaceLine(.gitattributes, 'ai-dev.sh text eol=lf', 'adw.sh text eol=lf')` → edit `Replaced ai-dev.sh with adw.sh in .gitattributes`. In `dryRun` steps compute their results without writing.

- [ ] **Step 4: Run `node --test agent-src/lib/layout.test.mjs` and `npm pack --dry-run | grep layout.mjs`; expected: pass, file listed.**

- [ ] **Step 5: Commit** — `feat: migrate the old root layout into .adw/`

---

### Task 4: CLI — refuse the old layout, `upgrade` migrates first

**Files:**
- Modify: `agent-src/generate.mjs` (`main`, `upgrade`, header comment), `agent-src/lib/onboard.mjs` (`cmdInit` start)
- Test: `agent-src/cli.test.mjs`

**Interfaces:**
- Consumes: Task 3 `assertCurrentLayout`, `migrateLayout`.
- Produces: `upgrade(projectRoot, dryRun) → exitCode` now renders itself (after the migration); `main` no longer renders before `upgrade`.

- [ ] **Step 1: Write the failing CLI tests**

```js
test('generate and check refuse the old layout and name upgrade', () => {
  // root with ai-project.json → status 1, stderr matches /Old adw layout found: ai-project\.json.*upgrade/s, no .claude/ written
});
test('a leftover .env.ai-dev alone does not block generate', () => { /* .adw/project.json + .env.ai-dev → status 0 */ });
test('init refuses the old layout', () => { /* ai-project.json at root → status 1, /init failed: Old adw layout found/ */ });
test('upgrade moves the old layout, prints each change, then generates', () => {
  // old layout incl. ai-dev.sh → status 0; stdout has 'Moved ai-project.json → .adw/project.json',
  // 'Rewrote ai-dev.sh → adw.sh', 'Added .adw/.env to .gitignore'; .claude/skills/agent-dev/SKILL.md exists; then check → 0
});
test('upgrade --dry-run lists the moves and changes nothing', () => {
  // stdout 'Would move ai-project.json → .adw/project.json', 'Would rewrite AI-DEV.md → .adw/README.md'; tree unchanged; status 0
});
test('upgrade stops with exit 1 on a conflict and does not generate', () => {
  // ai-project.json + .adw/project.json → status 1, stderr /Conflict: ai-project\.json and \.adw\/project\.json both exist/, no .claude/
});
```

Switch the existing `upgrade` tests to fixtures in the new layout where they test other steps.

- [ ] **Step 2: Run `node --test agent-src/cli.test.mjs`; expected: new tests fail.**

- [ ] **Step 3: Implement**

`main`: for `generate`/`check` call `assertCurrentLayout` before `renderAll` (error → `console.error(err.message)`, exit 1); `cmdInit` calls it first. `upgrade`: `migrateLayout` → print `${dryRun ? 'Would move' : 'Moved'} ${from} → ${to}` (`rewrite`: `Would rewrite` / `Rewrote`), each edit (`Would: ` prefix in dry run), conflicts to stderr as `Conflict: ${from} and ${to} both exist; left both in place. Merge them by hand, delete ${from}, then run upgrade again.` → return 1 before anything else. When changes exist: `See .adw/README.md for the container setup.` if that file exists or would be written. In dry run with changes: print `Dry run: the remaining upgrade steps are listed once the files are in .adw/.` and return 0. Otherwise `renderAll` (failure → exit 1 before `removeObsoleteOutputs`) and the existing steps.

- [ ] **Step 4: Run `npm test`; expected: pass.**

- [ ] **Step 5: Commit** — `feat: upgrade moves the old layout, other commands refuse it`

---

### Task 5: `adw e2e` uses the new layout and `--project-directory`

**Files:**
- Modify: `e2e/local/session.mjs` (`composeEnv`, `startSession`, `OPENCODE_LOGIN_HELP`), `e2e/local/cli.mjs` (`main` start, `preflight`, `runPrepared` compose args), `e2e/local/setup.mjs` (`stepProjectConfig`, `stepContainerFiles`, `ownComposeFiles`, `:85,166,174,204-205,259-282,309-336,353-359`), `e2e/local/image.mjs` (`ensureE2eImage`), `e2e/local/sandbox.mjs` (`sandboxConfig`, project write), `e2e/local/config.mjs:27`
- Test: `e2e/local/{session,cli,setup,image,sandbox,config}.test.mjs`

**Interfaces:**
- Consumes: Task 1 constants, Task 3 `legacyLayoutPaths`.
- Produces (in `session.mjs`): `composeBaseArgs({ root, env }) → string[]` = `['compose', '--project-directory', root, '-f', join(root, COMPOSE_FILES.base), ...(env.AGENT_CA_DIR ? ['-f', join(root, COMPOSE_FILES.certs)] : [])]`; used by `startSession`, `cli.mjs`, `setup.mjs`. `ensureE2eImage` prefixes its compose args with `'--project-directory', root`. The project directory is always `root` (where the compose files are), never the trial's `work` tree.

- [ ] **Step 1: Update fixtures and add tests**

```js
test('composeEnv reads .adw/.env and never .env.ai-dev', () => { /* both files → only .adw/.env values */ });
test('composeBaseArgs puts the root as project directory before the .adw compose files', () => {
  assert.deepEqual(composeBaseArgs({ root: '/p', env: { AGENT_CA_DIR: '/c' } }),
    ['compose', '--project-directory', '/p', '-f', path.join('/p', '.adw/compose.yml'), '-f', path.join('/p', '.adw/compose.certs.yml')]);
});
test('adw e2e refuses the old layout before any setup step', () => {
  // root with compose.ai-dev.yml → main returns 1, error names upgrade, no prompter question asked
});
test('createSandbox writes the trial config to .adw/project.json', () => { /* work/.adw/project.json has backend file */ });
```

Every recorded docker compose call in the existing session/setup/image tests now expects `--project-directory <root>`.

- [ ] **Step 2: Run `node --test e2e/local/*.test.mjs`; expected: new tests fail.**

- [ ] **Step 3: Implement** the path switch, `composeBaseArgs`, the refusal at the start of `cli.mjs` `main` (after resolving `root`, before setup: print `✗ ` + the `assertCurrentLayout` message, return 1), messages (`No .adw/project.json here…`, `No dev container files (.adw/compose.yml)…`, `Save it to .adw/.env?`, `./adw.sh`).

- [ ] **Step 4: Run `npm test`; expected: pass.**

- [ ] **Step 5: Commit** — `feat: adw e2e reads the .adw layout`

---

### Task 6: Image wrapper reads `.adw/project.json` with fallback

**Files:**
- Modify: `docker/launch-agent.mjs:76-79`, `docker/check-host-artifacts.mjs:94,111`, `docker/tests/semantic-csharp.mjs:29`
- Test: `docker/launch-agent.test.mjs`

**Interfaces:** none new; `readProjectState(workspace)` keeps its return shape.

- [ ] **Step 1: Tests**

```js
test('readProjectState reads .adw/project.json', () => { /* workspace with .adw/project.json azure-devops org 'o' → backend 'azure-devops', organization 'o' */ });
test('readProjectState falls back to ai-project.json', () => { /* only ai-project.json → same result */ });
test('readProjectState prefers .adw/project.json when both exist', () => { /* differing backends → the .adw one */ });
test('readProjectState names .adw/project.json when neither exists', () => { /* fails with /\.adw\/project\.json is required in \/workspace/ */ });
```

(Use however the existing tests reach `readProjectState`; export it if they cannot.)

- [ ] **Step 2: Run `node --test docker/launch-agent.test.mjs`; expected: new tests fail.**

- [ ] **Step 3: Implement** the lookup (`.adw/project.json` first, then `ai-project.json`), error `.adw/project.json is required in /workspace. Run adw init on the host.`; messages in `check-host-artifacts.mjs` say `.adw/compose.yml`; `semantic-csharp.mjs` writes `.adw/project.json`.

- [ ] **Step 4: Run `node --test docker/launch-agent.test.mjs`; expected: pass.** (`bash docker/verify-runtime.sh` runs the smoke tests in CI; locally see the memory note on Git Bash.)

- [ ] **Step 5: Commit** — `feat: image wrapper reads .adw/project.json, falls back to ai-project.json`

---

### Task 7: Harbor e2e, docs, end-to-end verification

**Files:**
- Modify: `e2e/run.mjs:165`, `e2e/.gitignore:9`, `e2e/lib/bundle.mjs:40` (comment), `e2e/agents/opencode_subscription.py:51` (comment), `e2e/lib/llm.test.mjs` (fixtures), `README.md`, `agent-src/README.md`, `AGENTS.md`, `docker/README.md`

- [ ] **Step 1: Harbor seeds** — `run.mjs` removes both `.adw/project.json` and a stale root `ai-project.json` before `init --answers`; `e2e/.gitignore` ignores `tasks/*/environment/seed/repo/.adw/project.json`.

- [ ] **Step 2: Docs** — current paths everywhere (`README.md` file table and container section, `agent-src/README.md` layout block and "Portability" section, `AGENTS.md` mentions of `ai-project.json`, `agent-custom/`, the container file list and the derived `compose.dind.yml`, `docker/README.md`). Historical "Upgrading to v0.x" notes stay as written. Add to README "Updating":

> **Upgrading to v0.32.0.** adw's files move into `.adw/` (`ai-project.json` → `.adw/project.json`, `compose.ai-dev*.yml` → `.adw/compose*.yml`, `AI-DEV.md` → `.adw/README.md`, `.env.ai-dev` → `.adw/.env`, `agent-custom/` → `.adw/custom/`), and the launchers are now `adw.sh` / `adw.ps1`. `upgrade` does the move and lists every file. Teammates move their own `.env.ai-dev` to `.adw/.env` or run `upgrade`.

- [ ] **Step 3: Full checks** — `npm test` → all pass; `npm pack --dry-run` lists `agent-src/lib/layout.mjs` and `agent-src/container/{compose.yml,adw.sh,adw.ps1,README.md}`; `node docker/tools/inventory.mjs check` → clean; `grep -rn "compose\.ai-dev\|ai-dev\.sh\|ai-dev\.ps1\|AI-DEV\.md\|\.env\.ai-dev\|agent-custom" agent-src e2e/local docker/*.mjs` → only `layout.mjs`, its test, the launchers' `.env.ai-dev` warning and launch-agent's fallback.

- [ ] **Step 4: Manual upgrade run** — in a scratch dir: install the old layout with `npx @strobl_dev/adw@0.31.0 init --answers <file>` (container on) + `generate`, add a custom line to `compose.ai-dev.yml`, then `node <repo>/agent-src/generate.mjs upgrade --root <dir>`. Expected: one line per move/rewrite, `.adw/compose.yml` byte-identical to the customized file, `check` → exit 0, `docker compose --project-directory <dir> -f <dir>/.adw/compose.yml config` shows the bind source `<dir>` and `name: <slug>-ai`.

- [ ] **Step 5: Harbor run** — run one harness with the `e2e-run` skill; expected: the trial passes as in the previous run (the generator and the in-image wrapper read `.adw/project.json`).

- [ ] **Step 6: Commit** — `docs: describe the .adw layout and the upgrade`
