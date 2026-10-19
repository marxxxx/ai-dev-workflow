# `adw e2e` Local Runs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `npx @strobl_dev/adw e2e <base-commit> <ticket> [harness]` runs `agent-dev` on a consumer
project's real ticket in a sandbox. It replays stored clarification answers and asks the human only
about new questions. Afterwards it judges and measures the run and compares it with the previous one.
Every LLM role (agent, answerer, verifier, review) runs on the harness and model the project
configures.

**Architecture:** New shipped modules in `e2e/local/` orchestrate one run:
- store (layout and persistence)
- ticket import
- sandbox (clone at the base commit, `file` backend, local bare origin)
- session (the project's `compose.ai-dev.yml` + `acpx`)
- answerer (replay or ask the human)
- acceptance drafting
- file-backend contract
- record and compare

A new harness-neutral one-shot runner (`e2e/lib/llm.mjs`) handles answerer, drafting and judges
for claude-code, codex and opencode. The existing judges, metrics, report and compare in
`e2e/lib/` are reused; the judges move onto the runner and get an injectable container-argument
builder.

**Tech Stack:** Node ≥24 builtins only, `node:test`, Docker Compose, `acpx` + ACP adapters in the
product image. The one-shot CLIs are `claude -p`, `codex exec` and `opencode run`.

**Spec:** `docs/superpowers/specs/2026-10-19-adw-e2e-local-design.md` (read the "Refinements" and
"Provider choice per role" sections too)

## Global Constraints
- Zero runtime dependencies; LF line endings; match the terse, comment-per-intent style of `e2e/lib/`.
- Every shipped non-test `.mjs` is listed individually in `package.json` `files` (AGENTS.md Rule 2).
- Never write to the real tracker or the real git remote. The sandbox's origin is a local bare repo.
- Committed per ticket: `.adw/e2e/<n>/ticket.md`, `answers.json`, `acceptance.md`. Git-ignored:
  `.adw/e2e/<n>/runs/`. The CLI writes `.adw/e2e/.gitignore` containing `*/runs/` when it is missing.
- Opening message: `Nutze den agent-dev Skill für Ticket <n>.` The fallback after "unknown skill"
  is `/agent-dev <n>` for claude-code and `$agent-dev <n>` otherwise.
- Harnesses: exactly `claude-code`, `codex`, `opencode`, for every role.
- Role defaults: `agent` comes from CLI `[harness]`/`--model`, else `e2e.agent`. `answerer`,
  `verifier` and `review` each default to `{ harness: <agent harness>, model: null }`, where null
  means the CLI's default model. Timeouts: answerer 300 s, verifier 900 s, review 600 s.
- Provider env: the variable names in `e2e.env` are forwarded by name (`-e NAME`, never
  `NAME=value` in argv) into every container.
- The rubric and thresholds are copied from `e2e/config.json`.
- Checks never inspect superpowers internals (paths, worktrees, TDD order).
- Harbor self-test behaviour stays unchanged: its judges remain claude-code, and `verifierHash`
  for claude-code judges is byte-identical to today. `npm test` stays green after every task.

## Review Focus
1. **Base commit predates `ai-project.json` or generated files.** The sandbox must still produce a
   working `file`-backend setup from the package template plus the project's identity, never crash.
   Test in Task 4.
2. **The agent never finishes (stuck, timeout, quota).** The loop must stop after
   `maxTurns` (default 60) or the agent turn timeout. The trial is recorded with an error class,
   containers are torn down, and the run is marked not comparable. Test in Task 7.
3. **A role's harness has no login, or a configured `e2e.env` variable is unset.** Preflight must
   fail before any container starts, and name the role, the harness and the missing login or
   variable. It must not fail later in the middle of a judge. Test in Task 10.
4. **A judge's CLI prints no parsable JSON, or exits with a quota or API error** (each harness
   reports these differently). The result is an unjudged outcome with a labelled error, never a
   crash and never a failed criterion. The quota error is classified for every harness. Test in
   Task 1.
5. **Secrets in collected logs.** Auth copies of every staged harness must not remain in `runs/`
   (`scanForSecrets` reports zero after `scrubSecretsInTree`). Test in Task 6.

---

### Task 1: Harness-neutral one-shot LLM runner; judges move onto it

**Files:**
- Create: `e2e/lib/llm.mjs`, `e2e/lib/fixtures/llm/{claude-code,codex,opencode}-{ok,quota}.jsonl`
- Modify: `e2e/lib/claude.mjs` (keep `resultJson` working on top of the new text-level parser),
  `e2e/lib/verifier.mjs`, `e2e/lib/review.mjs`, `e2e/lib/postverify.mjs`
- Test: `e2e/lib/llm.test.mjs`, plus updates to `verifier.test.mjs`, `review.test.mjs` and
  `postverify.test.mjs`

**Interfaces:**
- Produces (`llm.mjs`):
  - `HARNESSES = ['claude-code', 'codex', 'opencode']`
  - `TOOL_PROFILES = ['none', 'read', 'verify']`
  - `oneShotCommand({ harness, model, tools, playwright = false }) -> { argv: string[], env: Record<string,string> }`.
    This is the command inside the container. The prompt goes on stdin.
    - claude-code: `claude -p [--model m] --output-format stream-json --verbose --setting-sources user --strict-mcp-config` plus, by profile:
      - none: `--tools ""`
      - read: `--allowedTools Read,Grep,Glob --disallowedTools Bash,Edit,Write,NotebookEdit,Task,WebFetch,WebSearch`
        (= `REVIEW_*`)
      - verify: `--mcp-config <playwright json> --allowedTools Bash,Read,Grep,Glob,mcp__playwright --disallowedTools Edit,Write,NotebookEdit,Task,WebFetch,WebSearch`
        (= `VERIFIER_*`)
    - codex: `codex exec --json --skip-git-repo-check --ephemeral -o /tmp/adw-last.txt [-m m]`
      `-s read-only` for none/read and `-s danger-full-access` for verify (the container is the
      boundary). Verify adds
      `-c mcp_servers.playwright.command="playwright-mcp" -c 'mcp_servers.playwright.args=["--headless","--browser","chromium","--isolated"]'`.
      The prompt is `-` (stdin).
    - opencode: `opencode run --format json [-m provider/model]` with env
      `OPENCODE_CONFIG_CONTENT` set to `{"permission":{...},"mcp":{...}}`:
      - none: edit, bash and webfetch all `deny`
      - read: edit `deny`, bash `deny`, webfetch `deny`
      - verify: edit `deny`, bash `allow`, plus `mcp.playwright = {type:"local", command:["playwright-mcp","--headless","--browser","chromium","--isolated"]}`

      The prompt is read from stdin; if `opencode run` refuses stdin, pass it with
      `-f /tmp/adw-prompt.md` and a one-line message. Verify which one against the real CLI.
  - `parseOneShot(harness, stdout) -> { text: string|null, error: string|null }`:
    - claude-code: the existing `cliJson`/`cliError` logic.
    - codex: the last `item.completed` event whose `item.type === 'agent_message'` gives the
      text; `turn.failed`/`error` events give the error.
    - opencode: the concatenated `text` parts of the last assistant message; `error` events give
      the error.

    Record the fixtures from one real call per harness, and confirm the event names against
    them.
  - `answerJson(text) -> object`: the fenced, whole-text or brace-span JSON extraction moved out
    of `claude.mjs` `resultJson` (unchanged behaviour; `resultJson` now calls it).
  - `isQuotaError(error) -> boolean`: claude `usage_limit_reached`, codex
    `usageLimitExceeded|usage_limit`, opencode/HTTP `429|rate.?limit|quota`. `claude.mjs`
    `isQuota` re-exports it.
  - `callLlm({ role, harness, model, tools, playwright, input, buildArgs, name, checkout, mounts, env, timeoutMs, run, onStdout }) -> object`.
    It builds `buildArgs({ name, checkout, mounts, argv, env })` (container argv), runs it with
    the `callClaude`-style error, timeout and interrupt handling, then applies
    `parseOneShot` → `answerJson`. It throws labelled errors (`<role> (<harness>): …`).
  - `dockerRunArgs({ image, uid, gid, envNames = [], authMounts = [] }) -> buildArgs` and
    `composeRunArgs({ composeFile, certsFile = null, project, service = 'ai-dev-workflow', uid, gid, envNames = [], authMounts = [] }) -> buildArgs`.
    Both keep today's `E2E_VERIFY=1`, `AGENT_TOOLSTACK_ONLY=1` and `HOST_UID/GID`. They forward
    `CLAUDE_CODE_OAUTH_TOKEN`, `CLAUDE_FORCE_OAUTH` and each name in `envNames` by name, mount the
    checkout at `/workspace` and each `authMounts` entry read-only (e.g. codex
    `auth.json` → `/home/dev/.codex/auth.json`).
  - `runVerifier({ config, …, buildArgs = dockerRunArgs({ image, … }) })` and `runReview(...)`
    read `config.verifier.harness ?? 'claude-code'` and `config.review.harness ?? 'claude-code'`,
    call `callLlm` with profile `verify` or `read`, and mount the review checkout and the diff
    `:ro`.
  - `postVerify({ …, buildArgs })` forwards `buildArgs` to both.
  - `verifierHash` adds `{ harness }` to its material **only** when a judge's harness is not
    `claude-code`.
  - Cleanup after a timeout stays `docker rm -f <name>`.

- [ ] **Step 1: Write failing tests:**
  - `oneShotCommand` for each harness × profile, with the exact argv and env from above
  - `parseOneShot` on each `*-ok.jsonl` fixture gives the expected text, and each `*-quota.jsonl`
    gives an error that `isQuotaError` accepts (Review Focus 4)
  - `answerJson` behaviour: the existing `resultJson` tests keep passing unchanged
  - `callLlm` with a stub `run`:
    - unparsable output gives `<role> (codex): answer holds no JSON object…`
    - a non-zero exit with an opencode error event gives a labelled error
  - `composeRunArgs` puts the service last before the argv, forwards `envNames` by name only (no
    `=` in argv), and mounts auth files `:ro`
  - `runVerifier` with `config.verifier.harness = 'codex'` and a stub `run` sends the codex argv
  - `verifierHash` for claude-code judges equals the value pinned in the existing test, and
    changes when `review.harness = 'opencode'`
- [ ] **Step 2: Run** `node --test e2e/lib/llm.test.mjs e2e/lib/claude.test.mjs e2e/lib/verifier.test.mjs e2e/lib/review.test.mjs e2e/lib/postverify.test.mjs`. Expect FAIL.
- [ ] **Step 3: Record fixtures** with one trivial prompt per harness inside
  `ai-dev-workflow-node:latest`, e.g.
  `echo 'Answer {"ok":true}' | codex exec --json --skip-git-repo-check --ephemeral -`. Strip ids
  and tokens before committing them.
- [ ] **Step 4: Implement** `llm.mjs` and move the judges onto it.
- [ ] **Step 5: Run** `npm test`. Expect PASS.
- [ ] **Step 6: Commit** `refactor(e2e): harness-neutral one-shot runner; judges run on any harness`

### Task 2: Local config and `.adw/e2e` store

**Files:**
- Create: `e2e/local/defaults.json`, `e2e/local/config.mjs`, `e2e/local/store.mjs`
- Test: `e2e/local/config.test.mjs`, `e2e/local/store.test.mjs`

**Interfaces:**
- Produces (`config.mjs`):
  - `loadLocalConfig(projectRoot, { harness, model } = {}) -> { root, agent:{harness,model}, answerer:{harness,model,timeoutSec}, verifier:{harness,model,timeoutSec}, review:{harness,model,timeoutSec,criteria}, env:string[], thresholds, ccusage:{version}, maxTurns, turnTimeoutSec, testCommand|null, appPort|null, mcpServers }`.
  - It deep-merges `defaults.json` with `ai-project.json` `.e2e`, then applies the CLI
    `harness`/`model` to `agent`. Each role without its own `harness` inherits
    `agent.harness`, with `model: null`.
  - It throws `unknown e2e setting: <key>` on an unknown key, and
    `e2e.<role>.harness must be one of claude-code, codex, opencode` on a bad harness.
  - It throws `no agent harness: pass one or set e2e.agent.harness` when there is none.
  - `selfJudged(config) -> string[]`: the roles among `verifier` and `review` whose
    harness+model equal the agent's. The report prints a warning for these.
- Produces (`store.mjs`), every path absolute under `<root>/.adw/e2e/<ticket>/`:
  - `ticketDir(root, ticket)`, `readTicket(dir) -> {title, body}|null`, `writeTicket(dir, {title, body})`
    (format: `# <title>\n\n<body>\n`).
  - `readAnswers(dir) -> Answer[]` with `Answer = { id: 'A<n>', question, answer, source: 'default'|'human' }`.
    A missing file means `DEFAULT_ANSWERS`.
  - `appendAnswer(dir, {question, answer}) -> Answer` (next id, atomic temp + rename).
  - `DEFAULT_ANSWERS`: the process answers from `e2e/tasks/_shared/instruction.md` ("Process
    answers"), as `source: 'default'`, ids `A1…A5`.
  - `newRunDir(dir, harness, ts) -> <dir>/runs/<ts>/<harness>`.
  - `ensureGitignore(root)`.
  - `findLocalBaseline({ dir, harness, before, baseCommit }) -> runDir|null`: the newest run with
    `run.json.fingerprint.baseCommit === baseCommit`, `!aborted` and `comparable === true`.

- [ ] **Step 1: Write failing tests:**
  - merge precedence (project overrides the default model; the CLI harness overrides `e2e.agent`)
  - role inheritance: `e2e: { agent: { harness: 'codex' } }` gives the answerer, verifier and
    review `{ harness: 'codex', model: null }`
  - an explicit `review: { harness: 'opencode', model: 'azure/x' }` is kept
  - errors for an unknown key, a bad harness and a missing agent harness
  - `selfJudged`
  - `readAnswers` defaults
  - `appendAnswer` gives ids `A6`, `A7` and leaves no temp file behind
  - ticket round trip
  - `ensureGitignore` is idempotent
  - `findLocalBaseline` skips aborted, non-comparable, other-commit and later runs
- [ ] **Step 2: Run** `node --test e2e/local/*.test.mjs`. Expect FAIL.
- [ ] **Step 3: Implement both modules.** Add `e2e/local/*.test.mjs` to the `npm test` script.
- [ ] **Step 4: Run** `npm test`. Expect PASS.
- [ ] **Step 5: Commit** `feat(e2e-local): config defaults and .adw/e2e store`

### Task 3: Ticket import (read-only)

**Files:**
- Create: `e2e/local/ticket-import.mjs`
- Test: `e2e/local/ticket-import.test.mjs`

**Interfaces:**
- Consumes: `writeTicket` (Task 2), the project's `ai-project.json`.
- Produces: `importTicket({ root, ticket, project, exec, ticketFile }) -> {title, body}`.
  `exec(cmd, args) -> stdout`. Readers per `project.ticketing.backend`:
  - `github`: `gh issue view <n> --repo <repository.slug> --json title,body`
  - `gitea`: `tea api --login <gitea.login> repos/<slug>/issues/<n>` (`title`, `body`)
  - `azure-devops`: `az boards work-item show --id <n> --org https://dev.azure.com/<organization> --output json`.
    Use `fields["System.Title"]` and `fields["System.Description"]`, plus
    `Microsoft.VSTS.Common.AcceptanceCriteria` when present, with HTML tags stripped and
    entities decoded.
  - `file`: `<file.dir>/<n>_*.md`. The title comes from the frontmatter and the body is the text
    after the frontmatter, up to the first `\n---\n## ` comment section.
  - `ticketFile` (CLI `--ticket-file`) wins over all of them. Its first `# ` line is the title and
    the rest is the body.
  - An unknown backend or empty title throws an error that names `--ticket-file`.

- [ ] **Step 1: Write failing tests,** one per backend with a stub `exec` that returns canned
  JSON. Assert the exact args and the `{title, body}` result. Add HTML stripping for ADO
  (`<div>a &amp; b</div>` becomes `a & b`) and the `ticketFile` precedence.
- [ ] **Step 2: Run** `node --test e2e/local/ticket-import.test.mjs`. Expect FAIL.
- [ ] **Step 3: Implement.** Check the `tea api` and `az boards` flags against their `--help`
  before you finish.
- [ ] **Step 4: Run.** Expect PASS.
- [ ] **Step 5: Commit** `feat(e2e-local): read-only ticket import`

### Task 4: Sandbox

**Files:**
- Create: `e2e/local/sandbox.mjs`
- Test: `e2e/local/sandbox.test.mjs` (real git in `mkdtemp` dirs)

**Interfaces:**
- Consumes: `renderAll`/`writeAll` from `agent-src/lib/pipeline.mjs` (the generate path in
  `agent-src/generate.mjs`), `readTicket`.
- Produces:
  - `createSandbox({ root, baseCommit, ticket, ticketText, trialDir, git }) -> { work, origin }`:
    1. `git clone --no-hardlinks --no-checkout <root> <trialDir>/work`, then `checkout --detach <baseCommit>`.
    2. Delete all remotes. Run `git init --bare <trialDir>/origin.git`, add it as `origin`,
       create and push `main` from the base commit.
    3. Rewrite `ai-project.json`: keep `project`/`repository`/`git`, set
       `ticketing = { backend: 'file', file: { dir: '.tickets/issues', metadataFile: '.tickets/metadata.json' } }`
       and `git.prTarget = 'main'`. When the file is missing, derive the identity from the template
       and the root dir name.
    4. Write `.tickets/issues/<n>_<slug>.md` with frontmatter `title` and `status: new`, plus the body.
    5. Run this package's pipeline against `work`.
    6. Commit everything as `e2e setup` with fixed identity flags (`bundle.mjs` `COMMIT`) and
       push to `main`.
    7. Append `.acpxrc.json` to `.git/info/exclude`.
  - `collectSandbox({ work, origin, ticket, git }) -> { ticketFile: string, branches: string[], bundle: string|null, diff: string }`.
    `branches` are the origin heads other than `main`. With exactly one branch, `bundle` is
    `<trialDir>/pr-head.bundle` holding `main` + that branch (the shape `bundleBranch` expects)
    and `diff` is `main...branch`. Otherwise `bundle` is `null` and `diff` is `''`.

- [ ] **Step 1: Write failing tests:**
  - sandbox from a temp repo with an azure-devops `ai-project.json`: the backend is rewritten,
    the ticket file exists, `.claude/skills/agent-dev/SKILL.md` is generated, `git -C work
    remote -v` lists only the bare origin, `main` at origin = HEAD
  - a base commit without `ai-project.json` still works (Review Focus 1)
  - `collectSandbox` with zero branches gives `bundle: null`; with one pushed branch,
    `bundleBranch(bundle)` returns its name
- [ ] **Step 2: Run** `node --test e2e/local/sandbox.test.mjs`. Expect FAIL.
- [ ] **Step 3: Implement.** Reuse the `ISOLATE`/`COMMIT` git flags (export them from
  `e2e/lib/bundle.mjs`).
- [ ] **Step 4: Run.** Expect PASS.
- [ ] **Step 5: Commit** `feat(e2e-local): sandbox clone on the file backend`

### Task 5: File-backend contract and app port

**Files:**
- Create: `e2e/local/contract.mjs`
- Test: `e2e/local/contract.test.mjs`

**Interfaces:**
- Produces:
  - `LOCAL_CONTRACT_CHECKS = ['ticket_review', 'spec_section', 'summary_section', 'cost_section', 'only_allowed_sections', 'branch_pushed', 'branch_naming', 'app_stopped', 'no_screenshots_in_repo']`
  - `evaluateLocalContract({ ticket, ticketFile, branches, diff, appListening }) -> Record<check, 0|1|null>`:
    - `ticket_review`: frontmatter `status: review`
    - sections: the `\n---\n## <Title>` blocks appended to the ticket file. The allowed titles
      are `Approved Spec`, `Implementation Summary` (it must match
      `/end[- ]to[- ]end|ende[- ]zu[- ]ende|e2e/i`, as in `_shared/tests/checks.mjs`) and
      `Cost Summary`.
    - `branch_naming`: `^<n>_[a-z0-9_]+$`
    - `app_stopped`: `null` when `appListening === null`
  - `appPortFromAgentsMd(markdown) -> number|null`: the first `http://(localhost|127.0.0.1|0.0.0.0):<port>`
    inside the `## End-to-end testing` section (up to the next `## `).
  - `hasE2eSection(markdown) -> boolean`.

- [ ] **Step 1: Write failing tests:**
  - a complete ticket file gives all 1
  - an extra `## Notes` section gives `only_allowed_sections` 0
  - two branches give `branch_pushed` 0
  - a PNG in the diff gives 0
  - port parsing, including no section → `null` and a port outside the section ignored
- [ ] **Step 2: Run.** Expect FAIL. **Step 3: Implement.** **Step 4: Run.** Expect PASS.
- [ ] **Step 5: Commit** `feat(e2e-local): file-backend contract checks`

### Task 6: Product image ships acpx; agent session via the project's compose

**Files:**
- Modify: `docker/tools/inventory.json`, then run `node docker/tools/inventory.mjs update` (never
  hand-edit derived files). Remove the `npm install -g acpx…` line from
  `e2e/tasks/demo-todo/environment/Dockerfile` and `e2e/tasks/demo-todo-dotnet/environment/Dockerfile`.
  Keep the `chown`/`mkdir`.
- Create: `e2e/local/session.mjs`
- Test: `e2e/local/session.test.mjs`

**Interfaces:**
- Consumes: `ACP_VERSIONS` (`e2e/lib/fingerprint.mjs`) for the pins, plus `scrubSecretsInTree`
  and `scanForSecrets` (`e2e/lib/secrets.mjs`).
- Produces:
  - `AGENT_LOGS = '/home/dev/.adw-e2e/agent'`
  - `acpCommand(harness, model) -> string[]`:
    - claude-code: `env -u CLAUDECODE CLAUDE_CONFIG_DIR=$AGENT_LOGS/sessions [ANTHROPIC_MODEL=<m>] claude-code-acp`
    - codex: `env NO_BROWSER=1 INITIAL_AGENT_MODE=agent-full-access CODEX_HOME=$AGENT_LOGS codex-acp [-c model=<m>]`
    - opencode: `env OPENCODE_FAKE_VCS=git XDG_DATA_HOME=$AGENT_LOGS/opencode/xdg-data XDG_STATE_HOME=$AGENT_LOGS/opencode/xdg-state [OPENCODE_CONFIG_CONTENT={"model":"<m>"}] opencode acp`

    These layouts are the ones `metrics.mjs`/`ccusage.mjs` read under `<trialDir>/agent`.
  - `acpxConfig(cmd) -> { agents:{target:{command,args}}, defaultAgent:'target', defaultPermissions:'approve-all', ttl:0, timeout:<turnTimeoutSec>, format:'quiet' }`
  - `composeProject(root, trialId) -> 'adw-e2e-<kebab(basename root)>-<trialId>'` (lowercase, ≤63 chars)
  - `stageCredentials({ harnesses, env = process.env, home = homedir() }) -> { envNames: string[], authFiles: {harness, from, to}[], secrets: string[], missing: {harness, what}[] }`.
    It is a pure lookup with no copying:
    - claude-code: `CLAUDE_CODE_OAUTH_TOKEN`, or `CLAUDE_CODE_USE_BEDROCK`/`CLAUDE_CODE_USE_VERTEX`
      (provider mode, no token needed)
    - codex: `~/.codex/auth.json` or `OPENAI_API_KEY`
    - opencode: `~/.local/share/opencode/auth.json`. When it is missing, it is not reported as
      missing, because opencode providers may be configured by env alone.

    `secrets` uses `secretLeaves` from `e2e/lib/secrets.mjs` (export it).
  - `startSession({ root, work, harness, model, project, creds, envNames, exec }) -> Session`:
    1. `PROJECT_ROOT=<work> docker compose -f <root>/compose.ai-dev.yml [-f compose.ai-dev.certs.yml when AGENT_CA_DIR] -p <project> run -d --name <project>-agent ai-dev-workflow sleep infinity` (`run` also starts the project's `depends_on` services); then wait until `exec … true` succeeds.
    2. Copy the agent harness's auth in: codex `auth.json` → `$AGENT_LOGS/auth.json`; opencode
       `auth.json` → `$AGENT_LOGS/opencode/xdg-data/opencode/auth.json`. The Claude token and
       every `envNames` entry go in by name.
    3. Write `.acpxrc.json` into `work`.
    4. Run `acpx sessions ensure`.
  - `Session.prompt(text) -> Promise<string>`: `docker exec -i -u dev <project>-agent acpx prompt <text>` (a `run` container is addressed by name, not by service),
    returning the agent's final message from stdout. It rejects on timeout.
  - `Session.close(trialDir)`: `acpx sessions close`, then `docker cp <project>-agent:$AGENT_LOGS <trialDir>/agent`.
    After that, delete the copied `auth.json` files and run `scrubSecretsInTree`, then
    `compose down -v`, which also runs on error (`finally`).
  - `Session.appListening(port) -> 0|1`: `ss -ltn` in the container.
  - `Session.cliVersion(harness) -> string`.

- [ ] **Step 1: Write failing tests** for the pure parts:
  - `acpCommand` per harness, with and without a model
  - the `acpxConfig` shape
  - `composeProject` sanitizing (`My Repo` gives `adw-e2e-my-repo-<id>`)
  - the arg lists `startSession`/`prompt`/`close` send to a recording `exec`, including
    `down -v` after a throwing `cp`
  - after `close` on a fixture agent dir with `auth.json`, `scanForSecrets` finds nothing
    (Review Focus 5)
- [ ] **Step 2: Run.** Expect FAIL. **Step 3: Implement**, plus the inventory change (acpx + both
  adapters at the `ACP_VERSIONS` pins). **Step 4: Run** `npm test` and `node docker/tools/inventory.mjs check`. Expect PASS.
- [ ] **Step 5: Build check:** `node docker/build.mjs`, then
  `docker run --rm ai-dev-workflow-node:latest acpx --version` prints `0.11.2`.
- [ ] **Step 6: Commit** `feat(e2e-local): acpx in the product image; agent session via project compose`

### Task 7: Answerer loop

**Files:**
- Create: `e2e/local/answerer.mjs`
- Test: `e2e/local/answerer.test.mjs`

**Interfaces:**
- Consumes: `callLlm` with profile `none` (Task 1) on `config.answerer.harness`/`.model`,
  `appendAnswer` (Task 2), `Session.prompt` (Task 6). The answerer runs as a separate one-shot
  container (`composeRunArgs`), never inside the agent's session container.
- Produces:
  - `buildAnswererPrompt({ ticket, answers, message, specApproved }) -> string`. The rules:
    - Reply only from the stored answers, in the user's voice: short, German, one or two
      sentences.
    - Never invent requirements. Anything not covered gives `askHuman`.
    - A spec or design approval request gives `askHuman` unless a stored answer has
      `question` starting with `Spec approval`. In that case, approve if the spec covers the
      stored answers, otherwise name the deviation.
    - The final report of a pushed branch with the ticket in review, or the agent clearly
      stuck, gives `done`.
    - Output is JSON only: `{"action":"reply","text":"…","usedIds":["A2"]}` |
      `{"action":"askHuman","question":"<agent's question, condensed>"}` |
      `{"action":"done","stuck":false}`.
  - `validateAnswererAnswer(a, ids)` throws on an unknown action, an empty text, or unknown
    `usedIds`.
  - `runConversation({ ticket, opening, session, decide, askHuman, store, maxTurns }) -> { turns, humanAsked: number, done: boolean, stuck: boolean, error: string|null }`.
    - `decide(message) -> answer`.
    - `askHuman(agentMessage, question) -> Promise<string>` uses readline on the TTY and prints
      the full agent message first. An empty input re-asks.
    - Each human answer is stored via `appendAnswer({question, answer})` before it is sent.
      Spec approvals are stored as `question: 'Spec approval: <question>'`.
    - On `maxTurns`, the result is `error: 'max-turns'`. A rejected prompt gives
      `error: 'agent-timeout'`, or `'quota'` when `isQuota`.
    - "Unknown skill" fallback: if the first reply matches `/unknown skill|kenne.*skill|no skill named/i`,
      send the harness fallback command once.

- [ ] **Step 1: Write failing tests** with stub `session`/`decide`/`askHuman`:
  - a full replay gives `humanAsked: 0` and `done`
  - one `askHuman` gives one stored answer, and that text is sent to the agent
  - spec approval with no stored approval asks the human
  - `maxTurns: 3` with an endless agent gives `error: 'max-turns'` (Review Focus 2)
  - a prompt rejecting with a timeout gives `agent-timeout`
  - validator errors
  - the prompt contains every stored answer id
- [ ] **Step 2: Run.** Expect FAIL. **Step 3: Implement.** **Step 4: Run.** Expect PASS.
- [ ] **Step 5: Commit** `feat(e2e-local): replaying answerer with human escalation`

### Task 8: Acceptance criteria drafting

**Files:**
- Create: `e2e/local/acceptance.mjs`
- Test: `e2e/local/acceptance.test.mjs`

**Interfaces:**
- Consumes: `parseCriteria` (`e2e/lib/criteria.mjs`), and `callLlm` with profile `none` on the
  answerer's harness and model.
- Produces:
  - `buildDraftPrompt({ ticket, answers })`. It carries the rule lines of
    `e2e/tasks/_shared/acceptance-criteria.md`: observable behaviour only, no endpoints or field
    names, exact wording only for user-visible text, only what the ticket and answers state.
    Output: `{"criteria":[{"id":"AC1","text":"…"}]}`.
  - `renderAcceptance(ticketTitle, criteria) -> markdown`, a `| Id | Criterion |` table that
    `parseCriteria` round-trips.
  - `confirmAcceptance({ draft, file, prompt, editor }) -> criteria`. It writes the draft and asks
    `[a]ccept / [e]dit / [s]kip`. Edit opens `$EDITOR <file>` and re-parses, re-asking on a parse
    error. Skip deletes the file and returns `null`, which means no verifier this run.

- [ ] **Step 1: Write failing tests:** render → `parseCriteria` round trip; accept, edit
  (editor stub rewrites the file) and skip paths; an invalid edit re-asks.
- [ ] **Step 2–4:** run (FAIL), implement, run (PASS).
- [ ] **Step 5: Commit** `feat(e2e-local): draft and confirm acceptance criteria`

### Task 9: Trial record, run.json, report and compare

**Files:**
- Create: `e2e/local/record.mjs`
- Test: `e2e/local/record.test.mjs`

**Interfaces:**
- Consumes: `e2e/lib/metrics.mjs` (`targetTokens`, `toolUsage`, `softSignals`, `e2ePerformed`, `errors`), `ccusageUsage`, `emptyOutcome`/`unjudgedOutcome`/`applyPostVerification`
  (`e2e/lib/trial.mjs`), `summarizeTrials`, `renderRunReport`, `compareRuns`, `renderCompare`,
  `diffFingerprints`, `sha256File`.
- Produces:
  - `buildLocalTrialRecord({ id, harness, trialDir, config, criteria, checks, ownTests, conversation, agentSeconds, deps }) -> trial`.
    Same fields as `buildTrialRecord`, plus `humanAsked`, and `durations: { agent: agentSeconds }`.
    `errors` is `{ ...errors(harness, trialDir, {}), harbor: null, bridge: conversation.error, timeout: conversation.error === 'agent-timeout', quota: conversation.error === 'quota' }`.
    `checks.e2e_performed` is `e2ePerformed(...)`, or `null` without a port.
  - `localReward(t)`: 1 iff every non-null check is 1, `ownTests` is 1 or null, and acceptance is
    1. It is `null` iff acceptance is `null` and everything else passes.
  - `localFingerprint({ root, image, imageId, cliVersions, baseCommit, dir, config, verifierHash }) -> { adw:{version}, baseCommit, image:{ref,id}, roles:{agent,answerer,verifier,review: {harness, model, cliVersion}}, ticket, answers, acceptance, verifierHash, config }`.
    `cliVersions` maps each used harness to its `--version` output. A change of any role's
    harness or model therefore shows up in `diffFingerprints`.
    The `ticket`, `answers` and `acceptance` fields are sha256 of the stored files.
  - `writeRun({ runDir, fingerprint, trials, aborted }) -> run`. It writes `run.json` (schema 2,
    `comparable: !aborted && trials.every(t => t.humanAsked === 0)`) and `report.md`.
  - `compareWithBaseline({ dir, runDir, run, config }) -> { baseline, result }|null`. It writes
    `compare.md`.

- [ ] **Step 1: Write failing tests** with a fixture trial dir (copy the shape of
  `e2e/lib/fixtures`):
  - the record has numeric `tokens.total`
  - `localReward` truth table, including null checks and null `ownTests`
  - a run with `humanAsked: 1` gives `comparable: false`
  - a run → baseline → `compareRuns` verdict `same` for identical runs
  - `renderRunReport` does not throw on a local run
- [ ] **Step 2–4:** run (FAIL), implement, run (PASS).
- [ ] **Step 5: Commit** `feat(e2e-local): trial records, reports and baseline compare`

### Task 10: `adw e2e` CLI orchestration

**Files:**
- Create: `e2e/local/cli.mjs`
- Modify: `agent-src/generate.mjs`: dispatch `e2e` before the generate path, extend the header
  usage comment and the unknown-command message, and skip the values of the e2e flags in
  `parseCommand`.
- Test: `e2e/local/cli.test.mjs`

**Interfaces:**
- Consumes: everything from Tasks 1–9.
- Produces:
  - `parseE2eArgs(argv) -> { baseCommit, ticket:number, harness:string|null, repetitions:1, model:null, ticketFile:null, baseline:null, root }`.
    `[harness]` is optional (it falls back to `e2e.agent.harness`, Task 2). When given, it must
    be one of `claude-code|codex|opencode`. The ticket is a positive integer. Usage errors exit 2
    with the usage line.
  - `runE2e(opts, deps) -> exit code`. The order:
    1. preflight: docker; `compose.ai-dev.yml`; `stageCredentials` over the set of role
       harnesses, where each `missing` entry fails with `<role> uses <harness>: <what> not found`;
       each `e2e.env` name is set; `git rev-parse --verify <base>^{commit}`. Then print the role
       table (role → harness/model) and any `selfJudged` warning.
    2. `ensureGitignore`
    3. import the ticket if `ticket.md` is missing
    4. per repetition: sandbox → session → conversation → collect → contract + own tests (when
       `testCommand`, run via `compose run` in the work tree) → close
    5. on the first finished trial without `acceptance.md`: draft + confirm
    6. `postVerify` with `buildArgs = composeRunArgs({ …project compose, envNames, authMounts for the judge harnesses })`,
       when a bundle exists and criteria exist and `hasE2eSection(AGENTS.md)`. Otherwise
       `unjudgedOutcome` with the reason, or `emptyOutcome` without a bundle.
    7. `writeRun`, `compareWithBaseline`
    8. print a five-line summary: reward, contract, acceptance, tokens/cost, verdict against the
       baseline or "no baseline", plus "not comparable: N new answers" when relevant

    SIGINT/SIGTERM tear down the compose projects and exit 130 (Review Focus 3).

- [ ] **Step 1: Write failing tests:**
  - `parseE2eArgs` valid and invalid inputs, including the missing optional harness
  - preflight with `review.harness = 'codex'` and no codex auth fails with
    `review uses codex: ~/.codex/auth.json or OPENAI_API_KEY not found`; an unset `e2e.env` name
    fails, and both happen before any compose call (Review Focus 3)
  - judges receive their own role's harness (stubbed `postVerify` captures `config.verifier.harness`)
  - `runE2e` with all deps stubbed: the order of calls, the acceptance draft only when the file
    is missing, the verifier skipped without an E2E section, teardown called when the
    conversation throws, exit 130 and teardown on an `InterruptError`
  - `node agent-src/generate.mjs e2e` with no args exits 2 with the usage line
- [ ] **Step 2–4:** run (FAIL), implement, run `npm test` (PASS).
- [ ] **Step 5: Commit** `feat: adw e2e command`

### Task 11: Packaging and docs

**Files:**
- Modify: `package.json` `files`. Add each shipped module individually:
  - `e2e/local/{cli,config,store,ticket-import,sandbox,contract,session,answerer,acceptance,record}.mjs`
  - `e2e/local/defaults.json`
  - `e2e/lib/{llm,claude,verifier,review,postverify,bundle,metrics,ccusage,compare,fingerprint,config,tasks,fsutil,secrets,summary,report,criteria,trial}.mjs`
  - `e2e/tasks/_shared/instruction.md` and `e2e/tasks/_shared/acceptance-criteria.md` if read at runtime
- Modify: `README.md` (an "E2E on your project" section with the command, prerequisites
  — `init` container files, the ai-dev image with acpx, a login or provider env for each
  harness in use, an `AGENTS.md` E2E section — the `e2e` role config with an Azure-via-opencode
  example, and the precision and self-judging trade-offs), `docs/adw-e2e/README.md` ("Local runs on your
  project"), `agent-src/container/AI-DEV.md` (one line saying `adw e2e` uses this compose file),
  and `AGENTS.md` (the `e2e/local/` architecture bullet; the e2e section no longer says "not
  shipped" for these modules).

- [ ] **Step 1:** Run `npm pack --dry-run` and confirm every module above is listed.
- [ ] **Step 2:** In the scratch dir, run `npm pack`, then `npm i <tgz>`, then
  `npx adw e2e 2>&1 | head -1`. It prints the usage line, with no `ERR_MODULE_NOT_FOUND`.
- [ ] **Step 3:** Write the docs.
- [ ] **Step 4: Commit** `docs: adw e2e on consumer projects; ship e2e/local`

### Task 12: Real-run verification (manual, uses subscriptions)

- [ ] Copy `e2e/tasks/demo-todo/environment/seed/repo` into a scratch git repo and run `init`
  there (file backend, container files). Add an `AGENTS.md` E2E section if the seed lacks one,
  and commit.
- [ ] Run `npx <tgz> e2e HEAD 1 claude-code --ticket-file <issue.md with "# Fälligkeitsdatum für Todos">`.
  Answer the questions and approve the spec, then accept the drafted ACs. Expect `run.json`
  with `comparable: false` and `answers.json` with human entries.
- [ ] Run the same command again. Expect no human prompt, `comparable: true` and
  "no baseline" (the first run was not comparable).
- [ ] Run it a third time. Expect a compare verdict against run 2 that is printed and written to
  `compare.md`.
- [ ] Provider mix: set `e2e: { verifier: { harness: 'codex' }, review: { harness: 'opencode' }, answerer: { harness: 'opencode' } }`
  and run a fourth time. Expect a fully replayed run whose fingerprint diff names the changed roles,
  `acceptance` and `review` filled in (not unjudged), and no auth files under `runs/`.
- [ ] Regression: `node e2e/run.mjs run --task demo-todo --harness claude-code --repetitions 1`
  still passes.
