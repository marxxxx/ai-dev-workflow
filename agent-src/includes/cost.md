# Cost Accounting: Per-Ticket Token & Cost Summary

This file is the single source of truth for how the workflow records what a ticket cost to build and
posts a token/cost breakdown when it reaches `{{status.acceptance-test}}`. It is generated from
`agent-src/includes/cost.md`. Do not edit it here — edit the source and regenerate.

Cost data comes from **`ccusage`**, a standalone CLI that reads each coding agent's local session
logs and reports per-session token counts and estimated USD. It reads the logs of **all three
harnesses** (Claude Code, Codex, OpenCode) regardless of which one you are running in, so a ticket
whose design was done in one harness and whose implementation was done in another still aggregates
correctly — as long as both ran on the same machine/user account.

The summary is posted as the `{{artifact.costSummary}}` comment via the mechanism in
`{{ticketing.include}}` — never with a hardcoded provider command.

## The run ledger (parallel-safe)

A dev-cycle **run** is one pass of a single ticket through implement → review → QA → PR. To keep
concurrent runs from mixing their numbers, each run owns a **ledger file at a unique path**:

```
<os-temp-dir>/ai-dev-workflow-cost/<ticket>-<nonce>.json
```

- `<os-temp-dir>` is the machine's temp directory (`$TMPDIR` / `/tmp` on Unix, `%TEMP%` on Windows).
  The ledger lives outside the repo on purpose — consuming projects commit `.agents/`, so an in-repo
  ledger would risk being committed.
- `<nonce>` is a random token (e.g. 8+ hex chars) generated once when the run starts. Two runs of the
  same ticket never collide because each generates its own nonce.

Ledger shape:

```json
{
  "ticket": "<number>",
  "nonce": "<random>",
  "createdAt": "<ISO-8601>",
  "sessions": [
    { "phase": "orchestrator", "harness": "claude|codex|opencode", "sessionId": "<id>" },
    { "phase": "developer",    "harness": "...", "sessionId": "<id>" }
  ]
}
```

Appends must be safe under concurrency within the run: read the file, add your entry, write it back;
because the path is unique per run, only this run's participants ever touch it.

## Identifying your own session id (best-effort, per harness)

Record your session id **at the moment you start**, before doing other work, by finding the newest
session log **scoped to the current project/working directory** in your harness's log directory:

- **Claude Code** — `~/.claude/projects/<cwd-encoded>/` holds one `*.jsonl` per session; the session
  id is the filename without `.jsonl`. Pick the most recently modified `*.jsonl` in the directory for
  the current working directory. Note: Task-tool **subagents share the orchestrator's session**, so
  on Claude Code the orchestrator's single id already covers the developer, reviewer, and QA phases —
  subagents do not need to (and cannot usefully) record a separate id.
- **Codex** — `${CODEX_HOME:-~/.codex}/sessions/YYYY/MM/DD/` holds `rollout-*.jsonl` files; the id is
  the session's rollout id (in the filename / the file's session metadata). Pick the newest rollout
  under today's date. Codex subagents run as **separate sessions**, so each records its own id.
- **OpenCode** — `${OPENCODE_DATA_DIR:-~/.local/share/opencode}/storage/session/<projectHash>/` holds
  one file per session; the id is the filename stem (e.g. `ses_...`). Pick the newest for the current
  project. OpenCode subagents are separate sessions (ccusage nests them under the parent); each
  records its own id defensively.

This detection is best-effort. Combined with the per-run ledger and cwd scoping, mis-identification
is unlikely, but if you cannot determine your session id, record `"sessionId": null` with a short
note rather than guessing — the summary will show the gap instead of a wrong number.

## Who records, and when

- **Orchestrator (`dev-cycle`)** — creates the ledger at the start of each ticket and records its own
  session with `phase: "orchestrator"`.
- **Subagents (`developer`, `code-reviewer`, `qa-engineer`)** — when the prompt packet includes a
  cost-ledger path, append an entry with the matching `phase` before finishing. (On Claude Code this
  is a no-op by design, since the subagent shares the orchestrator's session — recording it again is
  harmless; dedupe on aggregation.)
- **`product-architect`** — runs earlier, in its own interactive session, and does not share the
  run's ledger. Instead it stamps its origin **onto the ticket** as the `{{artifact.costOrigin}}`
  comment at creation time, in the form `harness=<claude|codex|opencode> session=<id>`. The
  orchestrator reads that marker at handoff and attributes the design cost to the ticket.

## Producing the summary (at `{{status.acceptance-test}}`)

When the orchestrator moves a ticket to `{{status.acceptance-test}}`:

1. **Idempotency** — if a `{{artifact.costSummary}}` comment already exists on the ticket, stop; do
   not post a second one (handles re-runs on an already-`{{status.acceptance-test}}` ticket where the
   ledger from the original run is gone).
2. Collect the sessions to price:
   - every entry in this run's ledger, and
   - the `{{artifact.costOrigin}}` marker on the ticket (the product-architect session), if present.
   Deduplicate by `(harness, sessionId)` — this collapses Claude Code's shared session that multiple
   phases reported.
3. For each unique `(harness, sessionId)`, run:
   ```bash
   ccusage <harness> session --id <sessionId> --json
   ```
   Parse `session[0]`: `inputTokens`, `outputTokens`, `cacheCreationTokens`, `cacheReadTokens`,
   `totalTokens`, `totalCost`, and `modelsUsed`. Prefer an installed `ccusage`; otherwise use
   `npx ccusage@latest` (or `bunx ccusage`). Add `--offline` if the machine has no network (uses
   cached pricing).
4. Build the breakdown grouped by phase:

   | Phase | Model(s) | Input | Output | Cache | Total tokens | Est. USD |
   |---|---|---|---|---|---|---|
   | product-architect (design) | … | … | … | … | … | … |
   | developer | … | … | … | … | … | … |
   | code-review | … | … | … | … | … | … |
   | QA | … | … | … | … | … | … |
   | orchestrator | … | … | … | … | … | … |
   | **Total** | | | | | **…** | **…** |

   On **Claude Code**, the developer/reviewer/QA/orchestrator phases share one session, so report them
   as a single **dev-cycle (Claude Code — subagents share the session)** row plus the
   product-architect row, rather than fabricating a per-phase split. On **Codex/OpenCode**, report the
   true per-phase rows.
5. Post the table as the `{{artifact.costSummary}}` comment using `{{ticketing.include}}`. State that
   USD is an estimate computed locally by ccusage from token counts and may differ from an actual
   bill.
6. **Clean up** — delete the run's ledger file.

## Degradation

Cost reporting must never block the handoff. If `ccusage` is not installed, a session id is missing,
or a lookup fails, still move the ticket to `{{status.acceptance-test}}` and post a
`{{artifact.costSummary}}` comment that names what was unavailable (e.g. "ccusage not installed — no
cost data" or "product-architect session not recorded"), so the gap is visible rather than silent.
