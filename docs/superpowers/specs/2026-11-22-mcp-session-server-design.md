# An MCP server in the dev container to start and steer `agent-dev` sessions remotely

## Why

`agent-dev` runs in Claude Code, Codex or OpenCode inside the ADW dev container, and today a
human sits at its terminal. The owner wants to start a ticket implementation from elsewhere
(claude.ai, Mistral Vibe, any MCP client), look at where it stands, and answer the agent's
questions (clarifying questions, spec approval) without being at the terminal.

## Goals

- An MCP server, shipped in the container image, with five tools:
  - `start_session(harness, task)`: harness is `claude-code | codex | opencode`; `task` is a ticket
    reference or free text, exactly what `agent-dev` accepts. Returns a `session_id`.
  - `query_session(session_id, harness?)`: status and the agent's last message.
  - `post_session(session_id, message, harness?)`: send the next user message (the answer to a question).
  - `list_sessions(status?)`: all known sessions.
  - `terminate_session(session_id)`: cancel the running turn and close the session.
- Reachable over HTTP by remote MCP clients, protected by a token from an environment variable.
- Drives all three harnesses uniformly through `acpx` plus the ACP adapters that `adw e2e` already
  uses (`e2e/local/session.mjs` is the working reference, including the per-harness setup).
- Zero runtime dependencies (AGENTS.md): the MCP protocol subset is hand-written on `node:http`.

## Non-goals

- No live streaming or progress feed (not a claude remote-control clone). A session is observable
  between turns only.
- No forwarding of harness permission prompts. Sessions run approve-all, as in `adw e2e`; the
  container is the sandbox.
- No OAuth, no tunnel/reverse proxy shipped, no multi-user or per-user tokens.
- No parallel sessions on one working tree in v1 (see Concurrency).

## Anti-goals

- The endpoint must never be open without a token: an unauthenticated server is remote code
  execution with the owner's subscription logins. No token configured means the server refuses to start.
- No change to the `agent-dev` skill: it must not know it is driven remotely.

## Constraints

- The token travels in a header (`x-api-key`; `Authorization: Bearer` is accepted too, since clients
  differ). Anthropic's claude.ai custom connectors may not support a static header token at all;
  that is unverified and is the owner's risk for claude.ai, not something this design works around.
  Mistral Vibe and generic MCP clients that set headers are the target.
- The server is exposed directly by IP, without TLS termination in front. A plain-HTTP token is
  sniffable, so optional native TLS is included (`node:https`, cert and key files by path).
- Pins live in `docker/tools/inventory.json` only (AGENTS.md). `acpx` and the adapters today sit in
  `e2eNpmPackages`, the e2e layer; they must be pinned for the base image too without a second source of truth.
- Every new feature needs an upgrade path and test coverage (AGENTS.md); see the last two sections.

## Approaches considered

1. **`acpx` as the engine (chosen).** One `acpx` process per turn, driven by a small session
   registry. Reuses the proven harness setup of `e2e/local/session.mjs`. Gives turn-level state only.
2. **Own ACP client in the server.** Would allow progress updates and permission forwarding, at
   roughly three times the work (protocol, persistence, adapter quirks). Rejected for v1, and
   approach 1 does not block it later.
3. **Call the harness CLIs directly** (`claude -p`, `codex exec`, `opencode run`). Three session
   models, no uniform question handling. Rejected.

The owner chose approach 1.

## Design

### Where it lives

- `docker/mcp/` in this repo (hand-maintained like the rest of `docker/`): `server.mjs` (HTTP, auth,
  MCP JSON-RPC), `sessions.mjs` (registry and acpx driving), `worker.mjs` (runs one turn). Copied
  into the image next to `launch-agent.mjs` under `/usr/local/lib/agent-runtime/`.
- `acpx`, `claude-agent-acp`, `codex-acp` join the base image's pinned tools. The e2e layer then
  needs only what the base lacks; the derived files stay in sync via `inventory.mjs`.
- **Optional, never a default.** `adw init` asks whether to set up the MCP server (in the container
  step, next to the dind and certs overlays; default no) and only then writes the overlay below.
  Projects that say no get no extra service, no port, no token. The server code is in the image
  either way (it is inert unless started).
- A compose overlay `.adw/compose.mcp.yml` (template in `agent-src/container/`, written once on
  opt-in, then project-owned like the other container files) defines a second service from the same image:
  runs the server as the `dev` user through the normal entrypoint, mounts `/workspace` and the
  same `agent-home` volume (so the harness logins done with `./adw.sh claude login` etc. apply),
  publishes `${ADW_MCP_BIND:-127.0.0.1}:${ADW_MCP_PORT:-8787}`. `./adw.sh mcp` starts it.

### Configuration (environment)

- `ADW_MCP_TOKEN` (required, at least 32 characters; otherwise the server exits with a clear message).
- `ADW_MCP_BIND` (default `127.0.0.1`; set `0.0.0.0` to be reachable from the internet), `ADW_MCP_PORT`.
- `ADW_MCP_TLS_CERT`, `ADW_MCP_TLS_KEY` (optional paths; both or neither).

### Protocol

MCP Streamable HTTP, stateless: `POST /mcp` with JSON-RPC, answered as `application/json` (no SSE).
Methods: `initialize`, `notifications/initialized`, `ping`, `tools/list`, `tools/call`. `GET /mcp` is
405. Token compared in constant time; wrong or missing token is 401 with no detail; request bodies
are size-limited; the token never appears in logs.

### Sessions

State lives under `/home/dev/.adw-mcp/sessions/<id>/session.json` (agent-home volume, so it survives
container restarts of the service): `{id, harness, task, status, turn, lastMessage, error, createdAt,
updatedAt, pid}`. Statuses:

- `running`: a turn is in progress.
- `idle`: the turn ended. The agent either asked a question or is finished; the server cannot and
  does not tell which. The client reads `last_message` and decides whether to `post_session`.
- `failed`: the turn exited non-zero (message in `error`, quota errors recognised like `isCliQuota`).
- `terminated`: by `terminate_session`.

Flow:
- `start_session` validates input, creates the record (`running`), starts a detached `worker.mjs`
  for turn 1 and returns at once. The opening text is the one `adw e2e` uses to start `agent-dev`
  (`fallbackCommand`: `/agent-dev <task>` for Claude Code, `$agent-dev <task>` otherwise).
- The worker writes the per-session `.acpxrc.json` / harness setup as `session.mjs` does, runs
  `acpx prompt`, then stores stdout as `lastMessage` and sets `idle` or `failed`.
- `post_session` is rejected unless the session is `idle`; otherwise it starts the next turn.
- `terminate_session` runs `acpx cancel` then `sessions close` and kills the worker.
- On server start, every `running` session whose worker pid is gone becomes `failed`
  ("worker lost").
- `query_session` and `post_session` accept `harness` as an optional cross-check (the id alone is
  unique); a mismatch is an error.
- Tool errors use MCP `isError` results with a short message, never stack traces.

### Concurrency (confirmed by the owner)

v1 allows one live session (`running` or `idle`) per workspace: `start_session` fails with a clear
message naming the live session until it is terminated. Reason: `agent-dev` creates a branch in the
shared `/workspace`; two sessions would collide on the working tree. Per-session git worktrees are
the natural next step and not part of this design.

### Settled after the builder check

Answered by the conversation or the repo:
- **Real work, not a sandbox.** Sessions run `agent-dev` in the live `/workspace` as the `dev` user,
  against the project's real ticketing backend and real PR CLIs, exactly like a human at the terminal.
  Only the harness-specific start-up of `session.mjs` is reused (adapter command lines, Claude
  Manual mode, OpenCode model file, credentials already in `agent-home`). The `adw e2e` parts that
  make it a trial are **not** reused: throwaway clone, `file` backend, fake `gh`/`tea`/`az`, login staging, log scrubbing.
- **`last_message`** is the agent's final message of the turn, as `acpx` prints it with `format: quiet`
  (see `acpxConfig`); no tool logs. Capped at 64 KiB (cut with a marker).
- **The e2e layer** is built locally by the installed `adw` from its own `inventory.json`, so there
  is no compatibility with older published versions to keep.

Author's calls (minor; builder may revisit with a reason):
- `task` goes to `acpx` as one argv element, never through a shell; at most 8000 characters; empty is rejected.
- `failed` and `terminated` sessions release the workspace lock; only `running` and `idle` hold it.
  There is no idle timeout or auto-release: the owner terminates explicitly.
- If the first-task spike shows `acpx` cannot keep a session across separate `prompt` processes or
  cannot return a clean final message, **stop and bring the finding back** before switching to a
  long-lived worker per session; that would change the worker and recovery model.
- The ACP packages go into the base image for every project (a few MB of npm packages; they are
  inert unless MCP is opted in), not into a separate image.

## Upgrade path (AGENTS.md convention)

A new image carries the server. Because the feature is opt-in, `upgrade` never enables it and
`generate`/`check` never warn about its absence. A project that has the overlay (opted in on a fresh
`init`) gets later template fixes through the existing `containerWarnings` mechanism. An existing
project that wants it adds the overlay following the README section (the template is documented
there; no hidden state). `adw.sh`/`adw.ps1` get an `mcp` subcommand through the usual launcher
update; without the overlay it prints how to enable it instead of failing obscurely. `init`
`--answers` gets a matching boolean for non-interactive use. The README gets a short "MCP server" section and an
"Upgrading to vX" note; no `package.json` `files` change beyond the new template if it is a new file
under `agent-src/container/` (already covered by the `agent-src/container` entry; verify with
`npm pack --dry-run`). The `docker/` code is not part of the npm package.

## Test coverage

- Unit tests (logic only, per the TDD workstyle) for: auth (missing, wrong, right, bearer variant),
  JSON-RPC handling, the session state machine (every transition and every rejected one), the
  startup reconciliation, token-length check, TLS option validation.
- Integration test in `docker/tests/` that starts the real server with a **fake `acpx`** (same idea
  as the `ADW_NPX` fake) and walks start, query, post, list, terminate over real HTTP.
- `adw e2e` / Harbor do not apply: they test the `agent-dev` contract, which this feature does not
  touch. The real-harness path is covered by a documented manual smoke run per harness against a
  throwaway ticket (to be listed in the plan), since quotas make a CI run unsuitable.

## Left to the builder

- Exact `acpx` invocations for per-session naming, cancel and close; verify against the pinned
  version first (first plan task, a short spike).
- Tool input/output JSON schemas in detail, status codes, log format.
- How `inventory.json` expresses the promotion of the ACP packages to the base image.
- Whether `adw.ps1` gets the same subcommand in the same change.
