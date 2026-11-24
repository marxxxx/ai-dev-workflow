# MCP Session Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An opt-in MCP server in the dev-container image with the tools `start_session`, `query_session`, `post_session`, `list_sessions`, `terminate_session`, which drives Claude Code / Codex / OpenCode through `acpx`.

**Architecture:** A zero-dependency Node HTTP server (`docker/mcp/`) speaks the stateless subset of MCP Streamable HTTP. Session state is one JSON file per session on the agent-home volume; each turn runs in a detached `worker.mjs` that calls `acpx prompt`. A project-owned compose overlay runs it as a second service; `adw init` writes the overlay and a generated token only on opt-in.

**Tech Stack:** Node >=24 builtins (`node:http`, `node:https`, `node:crypto`, `node:test`), `acpx` 0.22.0 + ACP adapters (already pinned in `docker/tools/inventory.json`), Docker Compose.

**Spec:** `docs/superpowers/specs/2026-11-22-mcp-session-server-design.md`

## Global Constraints

- Zero runtime dependencies; Node `>=24`; LF line endings (AGENTS.md).
- Pins only in `docker/tools/inventory.json`; derived files via `node docker/tools/inventory.mjs sync`, never hand-edited.
- Auth: header `x-api-key`, also `Authorization: Bearer <token>`; constant-time compare; token from `ADW_MCP_TOKEN`, **at least 32 characters**, server refuses to start otherwise; token never in logs or error output.
- Statuses exactly: `running`, `idle`, `failed`, `terminated`. Only `running` and `idle` hold the workspace; **one live session per workspace**.
- `task`: one argv element, never a shell; non-empty, at most 8000 characters. `last_message`: at most 64 KiB, cut with a marker.
- Opening text of turn 1: `/agent-dev <task>` for `claude-code`, `$agent-dev <task>` for `codex` and `opencode`.
- Transport: `POST /mcp`, JSON in, `application/json` out, no SSE; `GET /mcp` is 405; wrong/missing token is 401 without detail.
- Inside the container the server listens on `0.0.0.0:8787`; `ADW_MCP_BIND` (default `127.0.0.1`) and `ADW_MCP_PORT` (default `8787`) are the host side of the published port in the compose overlay.
- Optional TLS via `ADW_MCP_TLS_CERT` + `ADW_MCP_TLS_KEY` (both or neither).
- The MCP server is **opt-in** in `adw init` (default no); `upgrade` never enables it; `generate`/`check` never warn about its absence.
- No change to the `agent-dev` skill. Real ticketing backend and real PR CLIs: sessions are not sandboxed trials.
- Tests only for logic (AGENTS.md TDD workstyle); no tests for prose or templates beyond what renders them.
- Commit messages end with the attribution lines of the session's system reminder.

## Review Focus

1. A session id such as `../../etc` or a non-UUID reaches the filesystem: reject before any disk access (Task 4).
2. Two `start_session` calls arriving together: exactly one wins, the other gets the "live session" error (Task 4; check-and-create must contain no `await`).
3. `task` containing shell metacharacters, newlines, leading `-`, or 8001 characters: passed verbatim as one argument or rejected, never interpreted (Tasks 4, 5).
4. Server restart: a `running` record whose pid is dead becomes `failed`; one whose pid is alive stays `running`; a corrupt `session.json` is skipped by `list_sessions` instead of crashing it (Task 4).
5. Oversized or non-UTF-8 `acpx` output and a request body over 1 MiB: output capped and valid text, body answered 413 (Tasks 5, 6).

---

### Task 1: Spike — what `acpx` 0.22.0 really does

**Files:**
- Create: `docs/superpowers/specs/2026-11-22-mcp-acpx-findings.md`

**Interfaces:**
- Produces: written answers that fix the argv in `docker/mcp/acpx.mjs` (Task 5) and decide whether the design holds.

- [ ] **Step 1: Install the pinned package into a scratch directory** (`npm pack acpx@0.22.0` and extract, or `npm i --prefix <scratch> acpx@0.22.0`); read its `--help` and docs.
- [ ] **Step 2: Answer in the findings file, each with the command line that proves it:**
  1. How is a named session created, resumed by a later separate `acpx prompt` process, listed, cancelled and closed? Does a session belong to a cwd, a name, or both?
  2. Where does acpx read its agent configuration from (`.acpxrc.json` in cwd as in `e2e/local/session.mjs`, a flag, an env var)? Can it be kept out of the live `/workspace` (git-clean)?
  3. What does `acpx prompt` print with `format: quiet`, and the exit codes for success, agent error, cancelled turn?
  4. Can two named sessions coexist in one cwd (relevant for terminate then start)?
- [ ] **Step 3: Run it against a real harness if a login is available** (one `claude-agent-acp` prompt); otherwise say so in the file.
- [ ] **Step 4: Gate.** If 1 or 3 show acpx cannot resume a session across processes or cannot return a clean final message, **stop and bring the finding to the user**; do not start Task 5.
- [ ] **Step 5: Commit** the findings file.

### Task 2: Move the ACP packages into the base image

**Files:**
- Modify: `docker/tools/inventory.json` (move `@agentclientprotocol/claude-agent-acp`, `@agentclientprotocol/codex-acp`, `acpx` from `e2eNpmPackages` into `npmPackages`; delete `e2eNpmPackages`)
- Modify: `docker/tools/inventory.mjs` (drop the `e2eNpmPackages` group, `E2E_PACKAGE_JSON`/`E2E_LOCKFILE`, its `DERIVED_FILES` entry and the update loop entry)
- Modify: `docker/tests/inventory.test.mjs` (the `ACP packages are e2e-only pins` test becomes "the ACP packages are base-image pins"; drop e2e package.json drift tests and fixtures)
- Modify: `e2e/local/image/Dockerfile` (no `npm ci`; link `acpx`, `claude-agent-acp`, `codex-acp` from `/opt/agent-tools/node_modules/.bin` into `/usr/local/bin`, failing with a clear message if `acpx` is absent, i.e. the base image is too old; keep the PR fakes), `e2e/local/image.mjs` (`LAYER_FILES` loses `package-lock.json`)
- Delete: `e2e/local/image/package.json`, `e2e/local/image/package-lock.json`
- Modify: `package.json` `files` (remove the two deleted entries), `AGENTS.md` and `.claude/skills/dependency-update-check/SKILL.md` (every `e2eNpmPackages` mention), `docker/tools/package.json` + lockfile (via sync)

**Interfaces:**
- Produces: `acpx`, `claude-agent-acp`, `codex-acp` in `/opt/agent-tools/node_modules/.bin` of every image; `verify-versions.mjs` already checks every `npmPackages` entry.

- [ ] **Step 1: Change the test first:** `inventory.test.mjs` asserts the three names are keys of `inventory.npmPackages` and that `inventory.e2eNpmPackages` is `undefined`. Run `node --test docker/tests/inventory.test.mjs`; expected FAIL.
- [ ] **Step 2: Edit `inventory.json` and `inventory.mjs`; run `node docker/tools/inventory.mjs sync` then `check`.** Expected: check passes.
- [ ] **Step 3: Adjust the e2e layer and `image.mjs`; update `files`, `AGENTS.md`, the skill.** Verify no leftovers: `grep -rn e2eNpmPackages . --exclude-dir=node_modules --exclude-dir=docs` prints nothing.
- [ ] **Step 4: Run** `node --test docker/tests/*.test.mjs` and `npm test`; expected PASS. Run `npm pack --dry-run` and confirm no deleted path is listed.
- [ ] **Step 5: Commit.**

### Task 3: Config and auth

**Files:**
- Create: `docker/mcp/config.mjs`, `docker/mcp/auth.mjs`
- Test: `docker/mcp/config.test.mjs`, `docker/mcp/auth.test.mjs`
- Modify: `package.json` `scripts.test` (append `docker/mcp/*.test.mjs`)

**Interfaces:**
- Produces:
  - `loadConfig(env = process.env): { token: string, host: string, port: number, tls: { cert: string, key: string } | null, home: string, workspace: string }`. Defaults: `host` `0.0.0.0` (`ADW_MCP_HOST`), `port` 8787 (`ADW_MCP_PORT`), `home` `env.HOME ?? '/home/dev'`, `workspace` `env.ADW_MCP_WORKSPACE ?? '/workspace'`. Throws `Error` with these messages: `ADW_MCP_TOKEN is not set`, `ADW_MCP_TOKEN must be at least 32 characters`, `ADW_MCP_PORT must be an integer from 1 to 65535`, `ADW_MCP_TLS_CERT and ADW_MCP_TLS_KEY must be set together`.
  - `isAuthorized(headers: http.IncomingHttpHeaders, token: string): boolean`.

- [ ] **Step 1: Write failing tests.** `config.test.mjs`: each throwing case above, a 31-character token fails and 32 passes, defaults, TLS pair accepted. `auth.test.mjs`: correct `x-api-key` true; correct `Authorization: Bearer` true; wrong, missing, empty, different-length value and a `bearer` scheme typo false; an error message from `loadConfig` never contains the token value.
- [ ] **Step 2: Run** `node --test docker/mcp/config.test.mjs docker/mcp/auth.test.mjs`; expected FAIL (modules missing).
- [ ] **Step 3: Implement both.** Compare SHA-256 digests with `crypto.timingSafeEqual`.
- [ ] **Step 4: Run the same command**; expected PASS.
- [ ] **Step 5: Commit.**

### Task 4: Session store and state machine

**Files:**
- Create: `docker/mcp/store.mjs`, `docker/mcp/sessions.mjs`
- Test: `docker/mcp/store.test.mjs`, `docker/mcp/sessions.test.mjs`

**Interfaces:**
- Produces:
  - Record: `{ id, harness, task, status, turn, lastMessage, error, createdAt, updatedAt, pid }` (`lastMessage`, `error`, `pid` nullable).
  - `createStore(dir: string): { create(record), get(id): record | null, update(id, patch): record, list(): record[], dirOf(id): string }`. Layout `<dir>/<id>/session.json`, written atomically (temp file + rename). `get`/`update`/`dirOf` throw for an id that is not a UUID. `list()` skips unreadable or corrupt files.
  - `class SessionError extends Error` (message is user-facing).
  - `HARNESSES = ['claude-code', 'codex', 'opencode']`.
  - `createSessions({ store, startTurn, cancel, isAlive, now, newId }): { start({ harness, task }), query({ sessionId, harness }), post({ sessionId, message, harness }), list({ status }), terminate({ sessionId }), reconcile() }`. Injected: `startTurn(record, text): number` (returns the worker pid), `cancel(record): Promise<void>`, `isAlive(pid): boolean`, `now(): string` (ISO), `newId(): string`. All methods but `terminate` are synchronous; `terminate` is async.
  - `applyTurnResult(store, id, { ok: boolean, message?: string, error?: string }, now): record`: sets `idle` (with `lastMessage`) or `failed` (with `error`); a record already `terminated` is left unchanged.

- [ ] **Step 1: Write failing tests** (names are the assertions):
  - store: round trip; `update` merges; corrupt file skipped by `list`; id `../x`, `''`, `'abc'` throw in `get`/`update`/`dirOf`.
  - `start`: validates harness, empty task, 8001-character task (each `SessionError`); creates `running`, `turn: 1`, calls `startTurn` once with the opening text from Global Constraints and stores the returned pid; a second `start` while a session is `running` or `idle` throws and names the live session id; after that session is `failed` or `terminated` a new start succeeds; two `start` calls in the same tick: exactly one succeeds.
  - `post`: only from `idle` (else error naming the status); increments `turn`, sets `running`, calls `startTurn` with the message verbatim; empty message and unknown id error; `harness` mismatch errors.
  - `query`/`list`: view of one record; `list({status})` filters; `query` with unknown id errors.
  - `terminate`: from `running` and `idle` calls `cancel` then sets `terminated`; on `failed`/`terminated` it is a no-op returning the record.
  - `reconcile`: `running` with dead pid becomes `failed` with error `worker lost`; alive pid stays; `idle` untouched.
  - `applyTurnResult`: ok → `idle` + message capped at 64 KiB with a trailing marker line `[truncated]`; not ok → `failed`; `terminated` stays.
- [ ] **Step 2: Run** `node --test docker/mcp/store.test.mjs docker/mcp/sessions.test.mjs`; expected FAIL.
- [ ] **Step 3: Implement.** No `await` between the live-session check and `store.create` in `start`.
- [ ] **Step 4: Run again**; expected PASS.
- [ ] **Step 5: Commit.**

### Task 5: Turn execution (acpx, harness setup, worker)

**Files:**
- Create: `docker/mcp/acpx.mjs`, `docker/mcp/harness.mjs`, `docker/mcp/worker.mjs`, `docker/mcp/runner.mjs`
- Test: `docker/mcp/harness.test.mjs`, `docker/mcp/acpx.test.mjs`, `docker/mcp/worker.test.mjs`

**Interfaces:**
- Consumes: Task 1 findings (exact acpx argv and config location); Task 4 `createStore`, `applyTurnResult`.
- Produces:
  - `openingText(harness: string, task: string): string`.
  - `acpCommand(harness, model, { cli }): string[]`, `acpxConfig(command: string[], timeoutSec = 1800): object`: copies of the functions in `e2e/local/session.mjs` (the e2e file is not in the image, so they are duplicated on purpose).
  - `acpxArgs`: pure argv builders `{ ensure(session), prompt(session, text), cancel(session), close(session) }` returning `string[]` per the findings.
  - `runTurn({ record, text, exec, store, now }): Promise<void>` in `worker.mjs`: runs `acpx prompt`, then `applyTurnResult`. `exec` has `spawn`-like injected behavior for tests. Run as CLI: `node worker.mjs <sessionId> <turn>`; the text of the turn is read from `<store.dirOf(id)>/turn-<turn>.txt`.
  - `startTurn(record, text): number` in `runner.mjs`: writes `turn-<turn>.txt` (mode 0600), spawns `process.execPath worker.mjs <id> <turn>` detached with stdio ignored and `unref()`, returns the pid. `cancelTurn(record): Promise<void>`: runs the acpx cancel and close argv, then `process.kill(record.pid)` ignoring ESRCH.
  - `isAlive(pid): boolean` via `process.kill(pid, 0)`.

- [ ] **Step 1: Write failing tests.**
  - `harness.test.mjs`: `openingText('claude-code', 'PROJ-1')` is `/agent-dev PROJ-1`, `codex`/`opencode` give `$agent-dev …`; a task of `--help; $(x)\nnext` is embedded verbatim; for all three harnesses `acpCommand(...)` deep-equals the same call imported from `../../e2e/local/session.mjs` (drift guard); `openingText` equals `fallbackCommand` from `../../e2e/local/answerer.mjs`.
  - `acpx.test.mjs`: each builder returns the argv fixed by the findings, and the task/message text is a single array element.
  - `worker.test.mjs` with a fake `exec`: exit 0 → record `idle` with the final message; non-zero → `failed` with the last 500 characters of the output; quota-like output (reuse the detection idea of `isCliQuota` in `e2e/lib/llm.mjs`; copy the minimal patterns) prefixes the error with `quota:`; output over 64 KiB or containing invalid UTF-8 ends as valid capped text; a record already `terminated` stays `terminated`.
- [ ] **Step 2: Run** `node --test docker/mcp/harness.test.mjs docker/mcp/acpx.test.mjs docker/mcp/worker.test.mjs`; expected FAIL.
- [ ] **Step 3: Implement.** Port the claude `settings.json` Manual-mode merge and OpenCode config handling from `session.mjs` (`startSession`) into `harness.mjs` as `prepareHarness(harness, { home, exec })`, called once on turn 1; do **not** port credential staging, clone, log scrubbing or the fake PR CLIs. Keep the acpx config out of the git-tracked workspace per Task 1.
- [ ] **Step 4: Run again**; expected PASS.
- [ ] **Step 5: Commit.**

### Task 6: MCP protocol, tools and HTTP server

**Files:**
- Create: `docker/mcp/mcp.mjs`, `docker/mcp/tools.mjs`, `docker/mcp/server.mjs`
- Test: `docker/mcp/mcp.test.mjs`, `docker/mcp/tools.test.mjs`, `docker/mcp/server.test.mjs`

**Interfaces:**
- Consumes: Task 3 (`loadConfig`, `isAuthorized`), Task 4 (`createSessions`, `SessionError`), Task 5 (`startTurn`, `cancelTurn`, `isAlive`).
- Produces:
  - `handleMessage(message: object, { tools, serverInfo }): Promise<object | null>` in `mcp.mjs`: `initialize` (echoes the client's `protocolVersion` if it is one of `2025-03-26`, `2025-06-18`, else answers `2025-06-18`; capabilities `{ tools: {} }`), `ping`, `tools/list`, `tools/call`; notifications return `null`; unknown method → JSON-RPC error `-32601`; non-object or array message → `-32600`.
  - `buildTools(sessions): Tool[]` with `Tool = { name, description, inputSchema, handler(args): Promise<object> }` for the five names. Tool results are `{ content: [{ type: 'text', text: JSON.stringify(view) }] }`; a `SessionError` or invalid argument becomes `{ isError: true, content: [{ type: 'text', text: message }] }`; any other error becomes the generic text `internal error` (logged without the token).
  - Session view (snake_case): `{ session_id, harness, status, turn, last_message, error, created_at, updated_at }`; `list_sessions` returns `{ sessions: view[] }`. `start_session` args `{ harness, task }`; `query_session` `{ session_id, harness? }`; `post_session` `{ session_id, message, harness? }`; `list_sessions` `{ status? }`; `terminate_session` `{ session_id }`.
  - `createServer({ config, tools }): http.Server` (https when `config.tls`); `main()` runs only when the file is the entry point: `loadConfig`, create store at `<config.home>/.adw-mcp/sessions`, `reconcile()`, listen, print `adw-mcp: listening on <host>:<port> (http|https)`; a config error prints its message and exits 1.

- [ ] **Step 1: Write failing tests.**
  - `mcp.test.mjs`: initialize negotiation (supported and unsupported version), `tools/list` names, unknown method `-32601`, notification → `null`, array → `-32600`.
  - `tools.test.mjs` with a fake `sessions`: each tool maps args to the right call and returns the snake_case view; `SessionError` → `isError`; a thrown generic error → `internal error` text; missing `session_id`/`task` → `isError`.
  - `server.test.mjs` over real HTTP on port 0 with a fake `acpx` (a tiny executable script on PATH that prints a canned final message, and one that sleeps for the terminate case): no token and wrong token → 401 with a body that does not contain the token; `GET /mcp` → 405; other path → 404; body over 1 MiB → 413; malformed JSON → 400 with `-32700`; full flow `start_session` → `query_session` shows `running` → after the fake exits `idle` with the canned `last_message` → `post_session` → `idle` again with `turn` 2 → `list_sessions` has it → a second `start_session` is `isError` while idle → `terminate_session` → new `start_session` works. `ADW_MCP_TOKEN` shorter than 32 characters makes `main` exit non-zero with the message (spawn it as a child process).
- [ ] **Step 2: Run** `node --test docker/mcp/*.test.mjs`; expected FAIL.
- [ ] **Step 3: Implement.** Read the body with a running byte count and abort over 1 MiB; do not log request bodies or headers.
- [ ] **Step 4: Run again**; expected all `docker/mcp` tests PASS, then `npm test` PASS.
- [ ] **Step 5: Commit.**

### Task 7: Ship it in the image and the compose overlay

**Files:**
- Modify: `docker/Dockerfile` (copy `mcp/*.mjs` except tests to `/usr/local/lib/agent-runtime/mcp/`)
- Create: `agent-src/container/compose.mcp.yml`

**Interfaces:**
- Produces: service `adw-mcp` in `.adw/compose.mcp.yml`; image path `/usr/local/lib/agent-runtime/mcp/server.mjs`.

- [ ] **Step 1: Dockerfile.** Add a `COPY` of `mcp/` next to the existing `launch-agent.mjs` line, then remove `*.test.mjs` in the same `RUN` layer; add a `RUN node --check` of `server.mjs`. Extend `docker/tests/runtime-smoke.mjs` only if it enumerates installed runtime files (follow what it does for `launch-agent.mjs`).
- [ ] **Step 2: Write the overlay** header-commented like `compose.dind.yml` ("Project-owned; written once by adw init. Opt-in …"). Service `adw-mcp`: `extends: { file: compose.yml, service: ai-dev-workflow }`, `command: ["node", "/usr/local/lib/agent-runtime/mcp/server.mjs"]`, `tty: false`, `stdin_open: false`, `restart: unless-stopped`, environment `ADW_MCP_TOKEN: ${ADW_MCP_TOKEN:?Set ADW_MCP_TOKEN in .adw/.env}`, `ADW_MCP_PORT: "8787"`, `ADW_MCP_TLS_CERT`/`ADW_MCP_TLS_KEY` passed through empty by default, `ports: ["${ADW_MCP_BIND:-127.0.0.1}:${ADW_MCP_PORT:-8787}:8787"]`. Note in the header that the port is the host side and that a token over plain HTTP is readable on the network (use TLS or a trusted network).
- [ ] **Step 3: Verify the compose merge** on a throwaway project dir with the generated `compose.yml` + overlay: `PROJECT_ROOT=<dir> ADW_MCP_TOKEN=<32+ chars> docker compose --project-directory <dir> -f <dir>/.adw/compose.yml -f <dir>/.adw/compose.mcp.yml config`. Expected: service `adw-mcp` has the base image, `/workspace` bind, `agent-home` volume, the command and the port; if `extends: file: compose.yml` does not resolve from `.adw/`, adjust the path and note the reason in the file header.
- [ ] **Step 4: Commit.**

### Task 8: `adw init` opt-in

**Files:**
- Modify: `agent-src/lib/constants.mjs` (`COMPOSE_FILES.mcp = '.adw/compose.mcp.yml'`), `agent-src/lib/container.mjs`, `agent-src/lib/onboard.mjs`
- Test: `agent-src/lib/container.test.mjs`, `agent-src/lib/onboard.test.mjs`

**Interfaces:**
- Produces:
  - `renderContainerFiles({ …, mcp = false })` includes `COMPOSE_FILES.mcp` only when `mcp` is true; `writeContainerFiles(projectRoot, { env, mcp, …})` passes it through.
  - `askContainer` asks `Run an MCP server to start and steer agent sessions remotely? (y/N)` with answers key `container.mcp` (default `n`, also when scripted); returns `{ enabled, stack, env, mcp }`; on yes `env.ADW_MCP_TOKEN` is a fresh `crypto.randomBytes(24).toString('hex')` (48 hex characters).
  - `setUpContainer` prints, for `mcp`, where the token lives (`.adw/.env`, git-ignored), `./adw.sh mcp`, the endpoint `http://<host>:8787/mcp`, header `x-api-key`, and that `ADW_MCP_BIND=0.0.0.0` in `.adw/.env` exposes it to the network (with TLS advice).
  - `containerWarnings` gains one check: if `.adw/compose.mcp.yml` exists and `adw.sh` or `adw.ps1` has no `mcp` handler (`grep` for `compose.mcp.yml` in the launcher text), print the launcher fix in the style of `pullWarning` (delete the launcher, run `init` declining the overwrite).

- [ ] **Step 1: Write failing tests.** `container.test.mjs`: default render has no `.adw/compose.mcp.yml`, `mcp: true` renders it with no unresolved placeholder; `writeContainerFiles` with `mcp: true` writes it and an existing `ADW_MCP_TOKEN` in `.adw/.env` is kept (reported in `kept`); `containerWarnings` warns for an overlay plus a launcher without the handler and stays silent without the overlay or with a current launcher. `onboard.test.mjs`: scripted answers without `container.mcp` → `mcp: false` and no token in `env`; `container.mcp: 'y'` → `mcp: true` and `/^[0-9a-f]{48}$/` token.
- [ ] **Step 2: Run** `node --test agent-src/lib/container.test.mjs agent-src/lib/onboard.test.mjs`; expected FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run again**, then `npm test`; expected PASS. `npm pack --dry-run` lists `agent-src/container/compose.mcp.yml` (covered by the `agent-src/container` entry in `files`).
- [ ] **Step 5: Commit.**

### Task 9: Launchers, docs, manual smoke

**Files:**
- Modify: `agent-src/container/adw.sh`, `agent-src/container/adw.ps1`, `agent-src/container/README.md`, `README.md`, `docker/README.md`

**Interfaces:**
- Produces: `./adw.sh mcp [up-args]` / `.\adw.ps1 mcp [up-args]`.

- [ ] **Step 1: `adw.sh`.** Before the image pull, handle first argument `mcp`: without `.adw/compose.mcp.yml` print how to enable it (re-run `init`, answer yes to the MCP question) and exit 1; without `ADW_MCP_TOKEN` print where to set it and exit 1; `down` runs `compose -f "$root/.adw/compose.mcp.yml" down`; otherwise pull as usual, then `compose -f "$root/.adw/compose.mcp.yml" up "$@" adw-mcp` (so `./adw.sh mcp -d` works). The existing `compose` function keeps adding the certs/dind overlays. Same behavior in `adw.ps1`.
- [ ] **Step 2: Docs.** `agent-src/container/README.md`: new section "7. MCP server (opt-in)": what it is, the five tools, token and `x-api-key`, `ADW_MCP_BIND`/`ADW_MCP_PORT`, TLS variables, one session per workspace, `idle` means "agent waits or is finished" and `terminate_session` frees the workspace, no OAuth (claude.ai connectors may not accept a static header token; Mistral Vibe and generic clients can set headers), how to enable it later (re-run `init`). Root `README.md`: the `init --answers` example gains `"mcp": "y"` (optional), the `.adw/` file table row, and a short "Upgrading to v0.42.0" note: opt-in feature, `upgrade` does not touch it, enable by re-running `init`. No release bump here. `docker/README.md`: a "Smoke test the MCP server" section: start with a real token, call the five tools with `curl` once per harness against a throwaway ticket (`start_session` → `query_session` → answer a question with `post_session` → `terminate_session`), and the expected statuses. Fix any prose that now misdescribes the e2e layer after Task 2.
- [ ] **Step 3: Run the smoke test yourself for at least one harness** and record the result in the commit message; if no login is available, say so there.
- [ ] **Step 4: Run** `npm test` and `node --test docker/tests/*.test.mjs docker/mcp/*.test.mjs`; expected PASS.
- [ ] **Step 5: Commit.**

---

## Self-review notes

- Spec coverage: five tools (T6), acpx engine and spike gate (T1, T5), HTTP/token/TLS (T3, T6), state machine and lock (T4), image shipping and overlay (T2, T7), opt-in in init and launcher fix warning (T8, T9), upgrade path and docs (T8, T9), tests and manual smoke (all). The e2e/Harbor contract is intentionally untouched (spec: it tests `agent-dev`, which does not change).
- Correction to the spec found while planning: the server cannot bind `127.0.0.1` inside the container; `ADW_MCP_BIND` is the host side of the published port (spec updated).
