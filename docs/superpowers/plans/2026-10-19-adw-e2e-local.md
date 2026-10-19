# `adw e2e` Local Runs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `npx @strobl_dev/adw e2e <base-commit> <ticket> <harness>` runs `agent-dev` on a consumer
project's real ticket in a sandbox. It replays stored clarification answers and asks the human only
about new questions. Afterwards it judges and measures the run and compares it with the previous one.

**Architecture:** New shipped modules in `e2e/local/` orchestrate one run:
- store (layout and persistence)
- ticket import
- sandbox (clone at the base commit, `file` backend, local bare origin)
- session (the project's `compose.ai-dev.yml` + `acpx`)
- answerer (replay or ask the human)
- acceptance drafting
- file-backend contract
- record and compare

They reuse the Harbor self-test's judges, metrics, report and compare from `e2e/lib/`. The judges
get an injectable container-argument builder so they can run through the project's compose file.

**Tech Stack:** Node ≥24 builtins only, `node:test`, Docker Compose, `acpx` + ACP adapters in the
product image, `claude -p` for answerer and judges.

**Spec:** `docs/superpowers/specs/2026-10-19-adw-e2e-local-design.md` (read the "Refinements" section too)

## Global Constraints
- Zero runtime dependencies; LF line endings; match the terse, comment-per-intent style of `e2e/lib/`.
- Every shipped non-test `.mjs` is listed individually in `package.json` `files` (AGENTS.md Rule 2).
- Never write to the real tracker or the real git remote. The sandbox's origin is a local bare repo.
- Committed per ticket: `.adw/e2e/<n>/ticket.md`, `answers.json`, `acceptance.md`. Git-ignored:
  `.adw/e2e/<n>/runs/`. The CLI writes `.adw/e2e/.gitignore` containing `*/runs/` when it is missing.
- Opening message: `Nutze den agent-dev Skill für Ticket <n>.` The fallback after "unknown skill"
  is `/agent-dev <n>` for claude-code and `$agent-dev <n>` otherwise.
- Default models: answerer `claude-sonnet-5-5`, verifier `claude-sonnet-5-5` (900 s), review
  `claude-sonnet-5-5` (600 s). The rubric and thresholds are copied from `e2e/config.json`. The
  harness model defaults to the CLI's own default unless `--model` is given.
- Checks never inspect superpowers internals (paths, worktrees, TDD order).
- Harbor self-test behaviour stays unchanged. `npm test` stays green after every task.

## Review Focus
1. **Base commit predates `ai-project.json` or generated files.** The sandbox must still produce a
   working `file`-backend setup from the package template plus the project's identity, never crash.
   Test in Task 4.
2. **The agent never finishes (stuck, timeout, quota).** The loop must stop after
   `maxTurns` (default 60) or the agent turn timeout. The trial is recorded with an error class,
   containers are torn down, and the run is marked not comparable. Test in Task 7.
3. **Ctrl-C during a human prompt or an agent turn.** Compose projects are removed and no partial
   `answers.json` write happens (answers are written atomically via a temp file + rename). Test in
   Tasks 2 and 9.
4. **No PR branch pushed.** Bundle creation must not throw. The trial gets `emptyOutcome` and a
   failing `branch_pushed`. Test in Task 5.
5. **Secrets in collected logs.** The Codex/OpenCode auth copies and the Claude token must not
   remain in `runs/` (`scanForSecrets` reports zero after `scrubSecretsInTree`). Test in Task 6.

---

### Task 1: Judges accept an injectable container-argument builder

**Files:**
- Modify: `e2e/lib/claude.mjs`, `e2e/lib/verifier.mjs`, `e2e/lib/review.mjs`, `e2e/lib/postverify.mjs`
- Test: `e2e/lib/claude.test.mjs`, `e2e/lib/verifier.test.mjs`, `e2e/lib/review.test.mjs`, `e2e/lib/postverify.test.mjs`

**Interfaces:**
- Produces:
  - `buildClaudeComposeArgs({ composeFile, project, service = 'ai-dev-workflow', name, checkout, model, uid, gid, mounts = [], claudeArgs })`
    returns `['compose', '-f', composeFile, '-p', project, 'run', '--rm', '-T', '--name', name,
    '-e', 'HOST_UID=…', …, '-v', '<checkout>:/workspace', …mounts, service, 'claude', '-p', …same
    flags as buildClaudeDockerArgs…, …claudeArgs]`. The `PROJECT_ROOT` env for compose is set by
    the caller.
  - `runVerifier({ …, buildArgs = buildClaudeDockerArgs })` and `runReview({ …, buildArgs = buildClaudeDockerArgs })`
    pass `{ image, name, checkout, model, uid, gid, mounts, claudeArgs }` to `buildArgs`.
  - `postVerify({ …, buildArgs })` forwards `buildArgs` to both.
  - Cleanup after a timeout stays `docker rm -f <name>`, because compose `run --name` names the
    container the same way.

- [ ] **Step 1: Write failing tests.** `buildClaudeComposeArgs` puts the service before `claude`,
  includes `-v <checkout>:/workspace` and each mount, and uses `--setting-sources user
  --strict-mcp-config`. `runVerifier` with a stub `buildArgs` receives the verifier's
  `claudeArgs` (contains `--mcp-config`) and its result is passed to `run`. `postVerify` passes
  `buildArgs` through (stub deps capture it).
- [ ] **Step 2: Run** `node --test e2e/lib/claude.test.mjs e2e/lib/verifier.test.mjs e2e/lib/review.test.mjs e2e/lib/postverify.test.mjs`. Expect FAIL.
- [ ] **Step 3: Implement.** Refactor `buildClaudeDockerArgs` to share the claude flag tail with
  the compose builder. Build the verifier's `claudeArgs` in `runVerifier` and drop
  `buildVerifierDockerArgs` (update its test to the new seam). The `verifierHash` material
  stays identical.
- [ ] **Step 4: Run** `npm test`. Expect PASS, and the existing `verifierHash` test value is unchanged.
- [ ] **Step 5: Commit** `refactor(e2e): judges take an injectable container-argument builder`

### Task 2: Local config and `.adw/e2e` store

**Files:**
- Create: `e2e/local/defaults.json`, `e2e/local/config.mjs`, `e2e/local/store.mjs`
- Test: `e2e/local/config.test.mjs`, `e2e/local/store.test.mjs`

**Interfaces:**
- Produces (`config.mjs`):
  - `loadLocalConfig(projectRoot) -> { root, verifier:{model,timeoutSec}, review:{model,timeoutSec,criteria}, answerer:{model,timeoutSec}, thresholds, ccusage:{version}, maxTurns, turnTimeoutSec, testCommand|null, appPort|null, mcpServers }`.
  - It deep-merges `defaults.json` with `ai-project.json` `.e2e`. An unknown key in `.e2e` throws
    `unknown e2e setting: <key>`.
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
  - merge precedence (project overrides the default model) and the unknown-key error
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
  - `startSession({ root, work, harness, model, project, creds, exec }) -> Session`:
    1. `PROJECT_ROOT=<work> docker compose -f <root>/compose.ai-dev.yml [-f compose.ai-dev.certs.yml when AGENT_CA_DIR] -p <project> run -d --name <project>-agent ai-dev-workflow sleep infinity` (`run` also starts the project's `depends_on` services); then wait until `exec … true` succeeds.
    2. Copy the creds in: codex `auth.json` → `$AGENT_LOGS/auth.json`; opencode `auth.json` →
       `$AGENT_LOGS/opencode/xdg-data/opencode/auth.json`. The Claude token goes in as env.
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
- Consumes: `callClaude` (`e2e/lib/claude.mjs`), `appendAnswer` (Task 2), `Session.prompt` (Task 6).
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
- Consumes: `parseCriteria` (`e2e/lib/criteria.mjs`), `callClaude`.
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
  - `localFingerprint({ root, harness, model, image, imageId, cliVersion, baseCommit, dir, config, verifierHash }) -> { adw:{version}, baseCommit, harness:{id, cliVersion, model}, image:{ref,id}, ticket, answers, acceptance, models:{answerer,verifier,review}, verifierHash, config }`.
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
  - `parseE2eArgs(argv) -> { baseCommit, ticket:number, harness, repetitions:1, model:null, ticketFile:null, baseline:null, root }`.
    Harness ∈ `claude-code|codex|opencode`; the ticket is a positive integer. Usage errors exit 2
    with the usage line.
  - `runE2e(opts, deps) -> exit code`. The order:
    1. preflight (docker, `compose.ai-dev.yml`, Claude token, harness auth, `git rev-parse --verify <base>^{commit}`)
    2. `ensureGitignore`
    3. import the ticket if `ticket.md` is missing
    4. per repetition: sandbox → session → conversation → collect → contract + own tests (when
       `testCommand`, run via `compose run` in the work tree) → close
    5. on the first finished trial without `acceptance.md`: draft + confirm
    6. `postVerify` with `buildArgs = buildClaudeComposeArgs` bound to the project's compose,
       when a bundle exists and criteria exist and `hasE2eSection(AGENTS.md)`. Otherwise
       `unjudgedOutcome` with the reason, or `emptyOutcome` without a bundle.
    7. `writeRun`, `compareWithBaseline`
    8. print a five-line summary: reward, contract, acceptance, tokens/cost, verdict against the
       baseline or "no baseline", plus "not comparable: N new answers" when relevant

    SIGINT/SIGTERM tear down the compose projects and exit 130 (Review Focus 3).

- [ ] **Step 1: Write failing tests:**
  - `parseE2eArgs` valid and invalid inputs
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
  - `e2e/lib/{claude,verifier,review,postverify,bundle,metrics,ccusage,compare,fingerprint,config,tasks,fsutil,secrets,summary,report,criteria,trial}.mjs`
  - `e2e/tasks/_shared/instruction.md` and `e2e/tasks/_shared/acceptance-criteria.md` if read at runtime
- Modify: `README.md` (an "E2E on your project" section with the command, prerequisites
  — `init` container files, the ai-dev image with acpx, a Claude token, an `AGENTS.md` E2E
  section — and the precision trade-offs), `docs/adw-e2e/README.md` ("Local runs on your
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
- [ ] Regression: `node e2e/run.mjs run --task demo-todo --harness claude-code --repetitions 1`
  still passes.
