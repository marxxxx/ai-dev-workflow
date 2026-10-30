# `adw e2e` first-run setup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On a fresh customer project, `adw e2e <commit> <ticket> [harness]` asks what it cannot detect, writes the config files and starts the run; a set-up project behaves exactly as today.

**Architecture:** A new `e2e/local/setup.mjs` runs ordered setup steps before today's preflight in `runE2e`. Each step checks its condition, asks through the `init` prompter (readline or `--answers`), writes only after confirmation and returns env additions for this run. `e2e/local/language.mjs` replaces the hardcoded German texts. `createSandbox` overlays the root's `AGENTS.md` E2E section when the base commit has none.

**Tech Stack:** Node ≥24 builtins only, `node:test`, Docker Compose.

**Spec:** `docs/superpowers/specs/2026-10-29-adw-e2e-first-run-setup-design.md`

## Global Constraints

- Zero runtime dependencies; LF line endings.
- New runtime modules go into `package.json` `files` in the same commit that creates them (`e2e/local/package.test.mjs` enforces the import closure of `cli.mjs`).
- Questions only when `!opts.noInput && (opts.answers || (d.isTTY.stdin && d.isTTY.stdout))`. Otherwise no prompt is shown and preflight problems are fatal, as today.
- Scripted prompter: an absent answer means "no" to every write (defaults `'n'` when `prompter.scripted`, `'y'` interactively — the `askContainer` pattern).
- Values are stored only in `.env.ai-dev`, via `setEnvVar` (never replaces a set key). JSON writes keep 2-space indent and every other key.
- Login priority: env (process env over `.env.ai-dev`) → host file → project `agent-home` volume. The volume is read-only, never written, and the Claude login is never taken from it.
- Every value read without echo is pushed to `creds.secrets` before any container starts; it never appears in argv.
- `e2e.language`: `null` | `"en"` | `"de"`. Detection: German when the count of the German stop words `der die das und nicht ist mit für` (whole words, case-insensitive) is higher than the count of `the and is with for not`, else English.
- Container one-offs in the project's **own** compose project: `docker compose -f compose.ai-dev.yml [-f compose.ai-dev.certs.yml] run --rm --no-deps -T ai-dev-workflow …`, env `composeEnv({ root, work: root, env })`, no `-p`.

## Review Focus

1. A key already set by hand in `.env.ai-dev` or `ai-project.json` → left untouched, and the CLI says so (Task 5, Task 6 tests).
2. stdin not a TTY (CI, pipe) with missing pieces → no prompt and no hang; today's `✗ preflight:` lines, exit 1 (Task 3 test).
3. A pasted token with surrounding whitespace, or an empty paste → trimmed; empty counts as declined (Task 6 test).
4. A secret read without echo → absent from every `d.exec` argv and from `out` (Task 6 test greps both).
5. The project never ran `./ai-dev.sh`, so its `agent-home` volume does not exist → `docker volume inspect` fails, no `compose run` is made (that would create the volume), and the CLI goes on to the next login option (Task 6 test).

---

### Task 1: Project root from git, one env source for preflight

**Files:**
- Modify: `e2e/local/cli.mjs` (`parseE2eArgs`, `preflight`, `runE2e` lines ~97-107)
- Test: `e2e/local/cli.test.mjs`

**Interfaces:**
- Produces: `parseE2eArgs(argv).root` is `null` unless `--root` is given. `runE2e` resolves `null` to `git -C <d.cwd> rev-parse --show-toplevel` (new dep `cwd: process.cwd()`), and falls back to `d.cwd` when git fails. `preflight({ root, config, baseCommit, d, env })` takes `env = composeEnv({ root, work: root, env: d.env, uid: d.uid, gid: d.gid })`, and `runE2e` uses this `env` for `stageCredentials`, the `e2e.env` check and the `secretEnv` values.

- [ ] **Step 1: Write the failing tests**
  - `parseE2eArgs: root is null without --root`: `parseE2eArgs(['HEAD', '7']).root === null`.
  - `runE2e resolves the root from git toplevel`: stub `exec` answers `rev-parse --show-toplevel` with the temp project, `d.cwd` is a subdir, `opts.root` is null → run reaches `sandbox` (calls include `'sandbox'`).
  - `preflight reads .env.ai-dev`: project with `.env.ai-dev` containing `CLAUDE_CODE_OAUTH_TOKEN=file-tok` and `deps.env` without it → no `✗ preflight` in `out`, and `'file-tok'` is redacted from transcripts (i.e. in the secrets: write an answerer transcript containing it via a `makeDecide` stub calling `onStdout('file-tok')` and assert `answerer.jsonl` lacks it).
  - `e2e.env value from .env.ai-dev passes preflight`: `e2e: { env: ['AZ_KEY'] }`, `.env.ai-dev` has `AZ_KEY=x` → no `e2e.env: AZ_KEY is not set`.
- [ ] **Step 2: Run** `node --test e2e/local/cli.test.mjs` → the four new tests FAIL.
- [ ] **Step 3: Implement** as in Interfaces; `composeEnv` is already imported from `session.mjs`.
- [ ] **Step 4: Run** `node --test e2e/local/cli.test.mjs` → PASS.
- [ ] **Step 5: Commit** `fix(e2e-local): root from git toplevel; preflight reads .env.ai-dev like the containers`

---

### Task 2: Language table instead of hardcoded German

**Files:**
- Create: `e2e/local/language.mjs`, `e2e/local/language.test.mjs`
- Modify: `e2e/local/defaults.json` (`"language": null`), `e2e/local/config.mjs`, `e2e/local/store.mjs`, `e2e/local/answerer.mjs`, `e2e/local/cli.mjs`, `e2e/local/record.mjs`, `package.json` (`files`), the existing tests that import `DEFAULT_ANSWERS` / `CONTINUE_TEXT`

**Interfaces:**
- Produces (`language.mjs`):
  - `LANGUAGES = ['en', 'de']`;
  - `detectLanguage(text: string) → 'en' | 'de'`;
  - `textsFor(lang) → { opening(ticket: number): string, defaultAnswers: Answer[], continueText: string, replyLanguage: 'English' | 'German' }`.
- `store.mjs`: `DEFAULT_ANSWERS` becomes `textsFor('de').defaultAnswers` (re-exported, so existing tests keep working). `readAnswers(dir, defaults = DEFAULT_ANSWERS)`, `appendAnswer(dir, entry, defaults = DEFAULT_ANSWERS)`.
- `answerer.mjs`: `buildAnswererPrompt({ ticket, answers, message, replyLanguage = 'German' })` writes `short, ${replyLanguage}`. `makeDecide({ …, replyLanguage })`. `runConversation({ …, continueText = CONTINUE_TEXT })`. `CONTINUE_TEXT` stays as the German default. `UNKNOWN_SKILL` already matches both languages; leave it.
- `config.mjs`: `loadLocalConfig` throws `e2e.language must be one of en, de or null` for any other value.
- `record.mjs`: `localFingerprint({ …, language })` adds `language` to the fingerprint.
- `cli.mjs`: `const lang = config.language ?? detectLanguage(`${ticketText.title}\n${ticketText.body}`)`; `texts = textsFor(lang)`. Use it for the opening, `readAnswers`/`appendAnswer` defaults, `makeDecide`'s `replyLanguage`, `runConversation`'s `continueText` and the fingerprint's `language`.

Exact English copy:

| | text |
|---|---|
| opening | `Use the agent-dev skill for ticket ${n}.` |
| A1 | `No, please ask your questions, don't skip them.` |
| A2 | `Please test end to end yourself, I won't test manually.` |
| A3 | `The plan is approved, take the option you recommend.` |
| A4 | `Take the option you recommend.` |
| A5 | `No, no new ticket, the ticket already exists.` |
| continue | `Carry on and report back when you have results or need a decision from me.` |

The German texts are today's, unchanged. `question` fields and ids are the same in both languages.

- [ ] **Step 1: Write the failing tests** (`language.test.mjs`)
  - `detectLanguage`: `'Todos bekommen ein Datum, das nicht leer ist und mit der Liste'` → `'de'`; `'Todos get a due date that is shown with the list'` → `'en'`; `''` → `'en'`.
  - `textsFor('en').opening(7) === 'Use the agent-dev skill for ticket 7.'`; `textsFor('de').opening(7) === 'Nutze den agent-dev Skill für Ticket 7.'`.
  - Both languages have ids `A1..A5` with identical `question` fields.
  - In `config.test.mjs`: `language: 'fr'` throws `/e2e.language must be one of en, de or null/`; default is `null`.
  - In `answerer.test.mjs`: `buildAnswererPrompt({ …, replyLanguage: 'English' })` contains `short, English`; `runConversation` with `continueText: 'go on'` sends `'go on'` on `continue`.
  - In `cli.test.mjs`: an English `issue.md` (`# Due dates\n\nTodos get a due date that is shown with the list.`) → `seen.conversation.opening === 'Use the agent-dev skill for ticket 7.'` and `runJson(root).fingerprint.language === 'en'`; with `e2e: { language: 'de' }` the opening is German.
- [ ] **Step 2: Run** `node --test e2e/local/*.test.mjs` → new tests FAIL.
- [ ] **Step 3: Implement** as in Interfaces; add `e2e/local/language.mjs` to `package.json` `files` after `e2e/local/record.mjs`.
- [ ] **Step 4: Run** `npm test` → PASS (the package test confirms the closure).
- [ ] **Step 5: Commit** `feat(e2e-local): e2e.language; English and German texts, detected from the ticket`

---

### Task 3: Setup phase skeleton, flags, project config and container files

**Files:**
- Create: `e2e/local/setup.mjs`, `e2e/local/setup.test.mjs`
- Modify: `agent-src/lib/onboard.mjs` (export `setUpContainer`; add `askSecret` to both prompters), `agent-src/lib/onboard.test.mjs`, `e2e/local/cli.mjs`, `e2e/local/cli.test.mjs`, `package.json` (`files`)

**Interfaces:**
- `onboard.mjs`:
  - `export function setUpContainer(projectRoot, { stack, env }, config)` (unchanged body).
  - Both prompters get `askSecret(label, key) → Promise<string>`. Readline: output muted while typing, the answer trimmed. Scripted: `resolve(key, '')`.
- `parseE2eArgs` adds `noInput` (`--no-input`, boolean), `answers` (`--answers <file>`, string|null) and `reconfigure` (`--reconfigure`, boolean). `USAGE` lists them.
- `setup.mjs`:
  - `export function makePrompter(opts, d) → Prompter | null`: `null` when not interactive (Global Constraints). Otherwise the scripted prompter for `opts.answers`, else readline. In both cases `close` is wrapped so `cmdInit`'s `finally { close() }` does not close it; `runSetup` closes the real one.
  - `export async function runSetup({ root, opts, d, prompter }) → { envAdditions: Record<string,string>, ticketText: {title, body} | null }`: runs the steps in spec order. Each step is an exported `async function step…({ root, opts, d, prompter, state })`, where `state` carries `envAdditions` and `ticketText` between steps. With `prompter === null` it runs only the non-interactive parts (Task 4's host and container import).
  - `stepProjectConfig`: no `ai-project.json` → ask `No ai-project.json here. Run the adw init interview now? (Y/n)` (key `setup.init`). Yes → `d.cmdInit(root, { prompter })`.
  - `stepContainerFiles`: no `compose.ai-dev.yml` → ask `No dev container files (compose.ai-dev.yml). Write them now? (Y/n)` (key `setup.container`). Yes → `askContainer(prompter, root)` then `setUpContainer(root, answers, <ai-project.json>)`.
- `runE2e`: `const prompter = makePrompter(opts, d)`. `const setup = await d.runSetup({ root, opts, d, prompter })` comes before `loadLocalConfig`. Then `d = { ...d, env: { ...d.env, ...setup.envAdditions } }`. The prompter is closed before the first agent turn, so the stdin readline is free for `askHumanTty`. New deps: `runSetup`, `cmdInit`, `isTTY: { stdin: process.stdin.isTTY, stdout: process.stdout.isTTY }`.

- [ ] **Step 1: Write the failing tests**
  - `onboard.test.mjs`: the scripted `askSecret('x', 'a.b')` with `{ a: { b: ' t ' } }` → `'t'`; absent → `''`.
  - `setup.test.mjs`:
    - `stepProjectConfig`, scripted `{ setup: { init: 'y' } }` and stub `cmdInit` → called once with `root`; absent answer → not called.
    - `stepContainerFiles`, scripted `{ setup: { container: 'y' }, container: { stack: 'node' } }` → `compose.ai-dev.yml` written and `.env.ai-dev` git-ignored; with an existing `compose.ai-dev.yml` → no question asked (the prompter's `ask` spy is never called).
    - `makePrompter`: `{ noInput: true }` → `null`; no TTY and no `--answers` → `null`; `--answers` without a TTY → scripted.
  - `cli.test.mjs`:
    - `non-TTY run without compose file asks nothing and fails as today`: `isTTY` false, no compose file → `out` has `✗ preflight: … compose.ai-dev.yml not found`, exit 1, and the `ask` spy is never called (Review Focus 2).
    - `parseE2eArgs` parses `--no-input --answers a.json --reconfigure`.
- [ ] **Step 2: Run** `node --test agent-src/lib/onboard.test.mjs e2e/local/setup.test.mjs e2e/local/cli.test.mjs` → FAIL.
- [ ] **Step 3: Implement** as in Interfaces; add `e2e/local/setup.mjs` to `files`. The import closure now includes `agent-src/lib/onboard.mjs` and its imports, which already ship.
- [ ] **Step 4: Run** `npm test` → PASS.
- [ ] **Step 5: Commit** `feat(e2e-local): setup phase; adw e2e offers init and the container files`

---

### Task 4: Ticket import fallbacks

**Files:**
- Modify: `e2e/local/setup.mjs`, `e2e/local/setup.test.mjs`, `e2e/local/cli.mjs` (the ticket import block moves into `stepTicket`)

**Interfaces:**
- Consumes: `importTicket({ root, ticket, project, exec, ticketFile })` (`exec(cmd, args) → stdout string`, throws on failure).
- Produces:
  - `export function ownComposeRun({ root, env, exec, argv, entrypoint = null, stdio = 'pipe' }) → spawnSync result`: the Global Constraints command, plus `--entrypoint <e>` when given.
  - `stepTicket` runs only when `readTicket(ticketDir(root, n))` is `null`. It tries, in order:
    1. `--ticket-file`;
    2. `d.importTicket` with host exec;
    3. for backends ≠ `file`, `d.importTicket` with `exec = (cmd, args) => ownComposeRun({ …, argv: [cmd, ...args] }).stdout` (throws on non-zero);
    4. interactive only: write `# <title>\n\n<body>\n` (literal placeholders) to `ticket.md`, ask `Ticket import failed (<last error>). Write the ticket in your editor? (Y/n)` (key `setup.ticketEditor`), run `d.editor(file)` (default `spawnEditor` from `acceptance.mjs`) and loop until `readTicket` has a title other than `<title>`.

    Declined or aborted: delete `ticket.md` and throw the host import's error, which is today's message.

- [ ] **Step 1: Write the failing tests**
  - Host `gh` throws, container run returns `{"title":"T","body":"B"}` → `ticket.md` is `# T\n\nB\n`; the container argv is `['compose','-f',<root>/compose.ai-dev.yml,'run','--rm','--no-deps','-T','ai-dev-workflow','gh','issue','view','7',…]` with no `-p`.
  - Both imports fail, scripted `setup.ticketEditor: 'y'`, editor stub writes `# Real\n\nbody` → the run continues with title `Real`.
  - Both fail, no prompter → throws `/ticket import \(github\) failed/` and `ticket.md` does not exist.
  - Backend `file` → the container route is never tried.
- [ ] **Step 2: Run** `node --test e2e/local/setup.test.mjs` → FAIL.
- [ ] **Step 3: Implement**; `runE2e` takes `ticketText` from `setup` when set, else `readTicket(dir)` as today.
- [ ] **Step 4: Run** `node --test e2e/local/*.test.mjs` → PASS.
- [ ] **Step 5: Commit** `feat(e2e-local): ticket import falls back to the dev container and the editor`

---

### Task 5: The `e2e` interview

**Files:**
- Modify: `e2e/local/setup.mjs`, `e2e/local/setup.test.mjs`

**Interfaces:**
- Produces:
  - `export function detectTestCommand(root) → string | null`:
    - `npm test` when `package.json` has `scripts.test`;
    - `dotnet test` when a `*.sln` or `*.csproj` is at the root;
    - `make test` when `Makefile` has a line matching `/^test:/m`;
    - else `null`.
  - `export function e2eChanges(current: object, answers: object) → object`: the `e2e` block to write. It keeps every key in `current`, sets each answered key, and drops keys whose answer equals `defaults.json` (blank → default).
  - `export function writeProjectE2e(root, e2e)`: reads `ai-project.json`, replaces only `e2e`, writes 2-space JSON plus a newline.
  - `stepInterview` runs when `ai-project.json` has no `e2e` key or `opts.reconfigure` is set. Questions with keys and defaults exactly as in the spec table; `current` values are the defaults on `--reconfigure`:
    - `e2e.agent.harness`: `askChoice` over `HARNESSES`; default `opts.harness`, else the only harness `stageCredentials` finds without `missing`.
    - `e2e.agent.model`.
    - `e2e.judgeModel`, written to both `verifier.model` and `review.model`.
    - `e2e.testCommand`.
    - `e2e.env`: asked only when a role uses opencode, or when `CLAUDE_CODE_USE_BEDROCK`/`CLAUDE_CODE_USE_VERTEX` is set.
    - `e2e.secretEnv`: default all names from `e2e.env`.
    - `e2e.language`: `askChoice` over `['en', 'de']`, default `detectLanguage(ticket)`.

    It prints the old and new `e2e` block as JSON, then asks `Write this to ai-project.json? (Y/n)` (key `setup.writeE2e`).

- [ ] **Step 1: Write the failing tests**
  - `detectTestCommand` for the four cases.
  - Scripted `{ e2e: { agent: { harness: 'codex' }, testCommand: 'npm test', language: 'en' }, setup: { writeE2e: 'y' } }` on a project with `{ project: { name: 'p' }, ticketing: {…} }` → `ai-project.json` equals the old object plus `e2e: { agent: { harness: 'codex' }, testCommand: 'npm test', language: 'en' }` (no default-valued keys).
  - Same answers without `setup.writeE2e` → file unchanged.
  - An existing `e2e: { maxTurns: 10 }` without `--reconfigure` → no question asked. With `--reconfigure` and a blank harness answer → the harness default is the current `e2e.agent.harness`, and `maxTurns: 10` is kept (Review Focus 1).
  - A judge model answer `m` → `verifier.model === 'm'` and `review.model === 'm'`.
- [ ] **Step 2: Run** `node --test e2e/local/setup.test.mjs` → FAIL.
- [ ] **Step 3: Implement**.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(e2e-local): first-run e2e interview writes ai-project.json e2e`

---

### Task 6: Logins — project volume and a guided Claude token

**Files:**
- Modify: `e2e/local/session.mjs` (`stageCredentials`), `e2e/local/session.test.mjs`, `e2e/local/setup.mjs`, `e2e/local/setup.test.mjs`, `e2e/local/cli.mjs` (temp dir cleanup)

**Interfaces:**
- `stageCredentials({ harnesses, env, home, fallbackHome = null })`: wherever it checks `path.join(home, rel)`, it then checks `path.join(fallbackHome, rel)`. `authFiles[].from` is the file actually found, and `to` is unchanged.
- `setup.mjs`:
  - `export function projectVolume(root, env, exec) → string | null`. It reads `docker compose -f … config --format json` and returns `<config.name>_agent-home` when `docker volume inspect` of that name succeeds, else `null`.
  - `stepLogins` loads `loadLocalConfig(root, { harness: opts.harness ?? undefined, model: opts.model ?? undefined })` (after the interview) and calls `stageCredentials` with the merged env. A Claude prompt that is declined while neither Bedrock nor Vertex is set prints: `For Bedrock or Vertex, set CLAUDE_CODE_USE_BEDROCK or CLAUDE_CODE_USE_VERTEX and list that provider's variables in e2e.env.`
  - `stepLogins` runs for each harness in `ROLES` with `missing` entries:
    - **codex / opencode:** when `projectVolume` is non-null, ask `Use the <harness> login of this project's dev container (agent-home volume)? A trial may refresh it; then log in again with ./ai-dev.sh. (Y/n)` (key `setup.volumeLogin.<harness>`). Yes → read the file with `ownComposeRun({ entrypoint: 'cat', argv: ['/home/dev/<rel>'] })` into `<fallbackHome>/<rel>`, where `fallbackHome = mkdtempSync(os.tmpdir()/adw-e2e-auth-)` and the file mode is 600. `rel`: `.codex/auth.json`, `.local/share/opencode/auth.json`.
    - **claude-code:** ask `Claude Code needs a long-lived token. Run 'claude setup-token' in the dev container now? (Y/n)` (key `setup.claudeToken`). Yes → `ownComposeRun({ argv: ['claude', 'setup-token'], stdio: 'inherit' })`, then `askSecret('Paste the token', 'setup.claudeTokenValue')` (trimmed; empty = declined). Then ask `Save it to .env.ai-dev? (Y/n)` (key `setup.saveClaudeToken`): yes → `setEnvVar`. Either way the token goes into `state.envAdditions.CLAUDE_CODE_OAUTH_TOKEN`.
  - `runSetup` returns `fallbackHome`. `runE2e` passes it to `stageCredentials` and `rmSync(fallbackHome, { recursive: true, force: true })` in its outer `finally`.

- [ ] **Step 1: Write the failing tests**
  - `session.test.mjs`: no host `.codex/auth.json`, but `fallbackHome` has one → `authFiles[0].from` is under `fallbackHome`, nothing `missing`; host file present → host wins.
  - `setup.test.mjs`:
    - `docker volume inspect` fails → no `compose … run` in the exec log, and no question for the volume login (Review Focus 5).
    - Scripted `setup.volumeLogin.codex: 'y'` with a `cat` stub returning `{"tokens":{"refresh_token":"r"}}` → the file exists under `fallbackHome` with mode `0o600`.
    - Claude: scripted `claudeToken: 'y'`, `claudeTokenValue: '  tok-123 \n'`, `saveClaudeToken: 'y'` → `.env.ai-dev` has `CLAUDE_CODE_OAUTH_TOKEN=tok-123`, `envAdditions` has it, and no `d.exec` argv contains `tok-123` (Review Focus 3, 4).
    - Empty paste → nothing saved, `missing` stays.
    - `.env.ai-dev` already assigns `CLAUDE_CODE_OAUTH_TOKEN=old` → it stays `old` (Review Focus 1).
  - `cli.test.mjs`: after a run, `fallbackHome` no longer exists.
- [ ] **Step 2: Run** `node --test e2e/local/session.test.mjs e2e/local/setup.test.mjs e2e/local/cli.test.mjs` → FAIL.
- [ ] **Step 3: Implement**.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(e2e-local): logins from the project volume; guided Claude token`

---

### Task 7: Missing `e2e.env` values

**Files:**
- Modify: `e2e/local/setup.mjs`, `e2e/local/setup.test.mjs`

**Interfaces:**
- `stepEnvValues`: for each name in `config.env` that is unset in `composeEnv` + `state.envAdditions`, ask for the value with `askSecret` when the name is in `config.secretEnv`, else with `ask` (label `Value for <NAME>`, key `setup.env.<NAME>`). Empty → skip. Afterwards ask once `Save these values to .env.ai-dev? (Y/n)` (key `setup.saveEnv`). The values go into `envAdditions` either way.

- [ ] **Step 1: Write the failing tests**
  - `e2e: { env: ['AZ_KEY','AZ_NAME'], secretEnv: ['AZ_KEY'] }`, scripted values: `AZ_KEY` is read through `askSecret` (spy) and `AZ_NAME` through `ask`; `saveEnv: 'y'` → both lines appended to `.env.ai-dev`.
  - Without `saveEnv` → `.env.ai-dev` is unchanged, and `envAdditions` holds both values.
  - A name already in `.env.ai-dev` → not asked.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(e2e-local): adw e2e asks for missing e2e.env values`

---

### Task 8: `AGENTS.md` E2E section — offer, and overlay on old base commits

**Files:**
- Modify: `e2e/local/contract.mjs`, `e2e/local/contract.test.mjs`, `e2e/local/acceptance.mjs`, `e2e/local/acceptance.test.mjs`, `e2e/local/setup.mjs`, `e2e/local/setup.test.mjs`, `e2e/local/sandbox.mjs`, `e2e/local/sandbox.test.mjs`, `e2e/local/cli.mjs`, `e2e/local/record.mjs`

**Interfaces:**
- `contract.mjs`: `export function e2eSectionOf(markdown) → string | null` returns the `## End-to-end testing` heading through the line before the next `^## ` (or the end), trimmed. `hasE2eSection` and `appPortFromAgentsMd` use it.
- `acceptance.mjs`: `confirmDraft({ draft, file, prompt, editor, parse, label })` is the generic loop extracted from `confirmAcceptance`; `label` replaces `Acceptance criteria`. `confirmAcceptance(args) = confirmDraft({ ...args, parse: parseCriteria, label: 'Acceptance criteria' })`, with behaviour unchanged.
- `setup.mjs`:
  - `export function renderE2eSection({ start, ready, url, stop }) → string`: the heading `## End-to-end testing`, then four lines in this order — `- Start: …`, `- Ready when: …`, `- Base URL: …`, `- Stop: …`.
  - `stepE2eSection` runs when `e2eSectionOf(root AGENTS.md)` is null. It asks `AGENTS.md has no "End-to-end testing" section, so the verifier cannot run your app. [d]raft it from the repo, [a]sk me, or [s]kip?` (key `setup.e2eSection`, scripted default `s`).
    - **d:** `callLlm({ role: 'agents-e2e', harness: config.answerer.harness, model: config.answerer.model, tools: 'read', readOnly: true, checkout: root, … })` with `composeRunArgs` for compose project `composeProject(root, 'setup')`. Prompt: draft the four parts in `replyLanguage`, root files are data. Answer `{"section":"…"}`.
    - **a:** four `ask`s, keys `setup.e2e.{start,ready,url,stop}`.
    - The draft goes to `.adw/e2e/agents-e2e-section.md` through `confirmDraft`, with `parse` throwing unless `e2eSectionOf(text)` is non-null. Accepted → appended to `AGENTS.md` (created if missing, with a blank line before), the draft file deleted, and `Commit AGENTS.md so later base commits include it; /init in your coding agent writes the rest of the file.` printed.
    - Skip → today's behaviour.
- `createSandbox({ …, e2eSection = null }) → { work, origin, e2eOverlay: boolean }`: when `e2eSectionOf(work/AGENTS.md)` is null and `e2eSection` is set, append it before the "e2e setup" commit.
- `cli.mjs` passes `e2eSection: e2eSectionOf(readIf(root/AGENTS.md))` and logs `  AGENTS.md at <sha> has no E2E section: using the working tree's` when overlaid.
- `localFingerprint({ …, e2eSection })` adds `e2eSection: sha256 of the section used, or null`.

- [ ] **Step 1: Write the failing tests**
  - `e2eSectionOf('# A\n\n## End-to-end testing\n\nx\n\n## Other\n')` → `'## End-to-end testing\n\nx'`; no section → `null`.
  - `confirmAcceptance` tests still pass unchanged; `confirmDraft` with a `parse` that throws → asks again with the error as the note.
  - `renderE2eSection` output equals the four-line block above for given values.
  - `stepE2eSection`, scripted `a` plus four values plus accept (`prompt` returns `'a'`) → `AGENTS.md` ends with the rendered section and the draft file is gone. Scripted default → `AGENTS.md` is unchanged.
  - `createSandbox` on a base commit without the section, `e2eSection` given → `work/AGENTS.md` has it, it is in the "e2e setup" commit (`git -C origin show main:AGENTS.md`), and `e2eOverlay: true`. With the section at base → unchanged, `false`.
  - `cli.test.mjs`: `runJson(root).fingerprint.e2eSection` is a 64-hex string when the stub sandbox's `AGENTS.md` has a section.
- [ ] **Step 2: Run** `node --test e2e/local/*.test.mjs` → FAIL.
- [ ] **Step 3: Implement**.
- [ ] **Step 4: Run** `npm test` → PASS.
- [ ] **Step 5: Commit** `feat(e2e-local): offer the AGENTS.md E2E section; overlay it on older base commits`

---

### Task 9: Docs and the recorded real run

**Files:**
- Modify: `README.md` (section "E2E on your project", "Updating"), `agent-src/generate.mjs` (usage comment lines 14-15), `docs/adw-e2e/README.md` (pointer line unchanged unless wording conflicts)

- [ ] **Step 1: README "E2E on your project":**
  - Prerequisites shrink to "Docker and a git repo; `adw e2e` offers to set up the rest", followed by one short list of what it asks.
  - Add the flags `--no-input`, `--answers <file>`, `--reconfigure` and the `.env.ai-dev` storage.
  - Add `e2e.language` to the config example.
  - Logins: the volume reuse (Codex/OpenCode) and the `setup-token` guidance; the Claude login is never taken from the volume.
  - The base-commit `AGENTS.md` overlay, in one sentence.
- [ ] **Step 2: README "Updating":** "The first `adw e2e` run after this update starts a new baseline (`e2e.language` changes the config hash); no `upgrade` step is needed."
- [ ] **Step 3: Run** `npm test` and `npm pack --dry-run | grep e2e/local/` → `setup.mjs` and `language.mjs` are listed.
- [ ] **Step 4: Commit** `docs: adw e2e first-run setup`
- [ ] **Step 5: Real run (manual, results into the PR description).** On a fresh clone of the `demo-todo` seed:
  1. Remove the `ai-project.json` `e2e` key, `compose.ai-dev.yml` and the AGENTS.md E2E section.
  2. Log in only through `./ai-dev.sh codex login --device-auth`.
  3. Run `npx <packed tgz> e2e <seed-commit> 1 codex` with a TTY.

  Expected:
  - one interview, the files written, the volume login offered;
  - the run completes with acceptance ≠ `—`;
  - a second call asks nothing.
