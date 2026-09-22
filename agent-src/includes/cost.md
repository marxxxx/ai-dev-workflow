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

**The journal remembers every ledger.** An interrupted run leaves its ledger behind, and the run that
resumes the ticket must still price it. So the orchestrator appends each new ledger's **basename**
(`<ticket>-<nonce>.json`) to the `Cost ledger ids` field of the ticket's `{{artifact.journal}}` (see
`{{handoff.include}}`) in the same step that creates the file. Never store an absolute local path on
the ticket. On restart, resolve the listed basenames under the current machine's
`<os-temp-dir>/ai-dev-workflow-cost/` and reuse the newest one that exists as this run's ledger. If
none exists — a different machine, or a cleared temp directory — create a new ledger, append its id,
and keep the missing ids listed: they become named gaps in the final summary.

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

- **Orchestrator (`dev-cycle`)** — reuses or creates the ledger at the start of each ticket (see
  above), records its id in the journal, and records its own session with `phase: "orchestrator"`.
- **Subagents (`developer`, `code-reviewer`, `qa-engineer`)** — when the prompt packet includes a
  cost-ledger path, append an entry with the matching `phase` before finishing. (On Claude Code this
  is a no-op by design, since the subagent shares the orchestrator's session — recording it again is
  harmless; dedupe on aggregation.)
- **`product-architect`** — runs earlier, in its own interactive session, and does not share the
  run's ledger. Instead it stamps its origin **onto the ticket** as the `{{artifact.costOrigin}}`
  comment at creation time, in the form `harness=<claude|codex|opencode> session=<id>`. The
  orchestrator reads that marker at handoff and attributes the design cost to the ticket.

## Producing the summary (at `{{status.acceptance-test}}`)

Once a ticket reaches `{{status.acceptance-test}}` and the orchestrator has audited the QA result:

1. **Idempotency** — if a `{{artifact.costSummary}}` comment already exists on the ticket, do not
   price or post a second one (handles re-runs on an already-`{{status.acceptance-test}}` ticket), but
   still perform the cleanup in step 6.
2. Collect the sessions to price:
   - every entry in every available ledger listed in the journal's `Cost ledger ids` — earlier,
     interrupted runs of this ticket included; list each missing ledger id as a gap, and
   - the `{{artifact.costOrigin}}` marker on the ticket (the product-architect session), if present.
   Deduplicate by `(harness, sessionId)` — this collapses Claude Code's shared session that multiple
   phases reported.
3. For each unique `(harness, sessionId)`, run:
   ```bash
   ccusage <harness> session --id <sessionId> --json
   ```
   Mind the response shape — it is **not** the same as unfiltered `ccusage session --json`. A
   `--id`-filtered response is a single object:
   ```json
   { "sessionId": "<id>", "totalCost": 0.0, "totalTokens": 0, "entries": [ /* per-message rows */ ] }
   ```
   There is **no `session[]` array** here (that only exists in the *unfiltered* output, where each
   row's session id is the `period` field — there is no `sessionId` key on those rows). So read
   `totalCost` and `totalTokens` from the **top level** of the filtered object, and derive the rest by
   aggregating `entries[]`: sum `inputTokens`, `outputTokens`, `cacheCreationTokens`, and
   `cacheReadTokens` across the entries, and collect `modelsUsed` from the distinct `entries[].model`
   values (each entry also carries a per-message `costUSD`). Prefer an installed `ccusage`; otherwise
   use `npx ccusage@latest` (or `bunx ccusage`). Add `--offline` if the machine has no network (uses
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
6. **Clean up** — delete every listed ledger file that exists and set `Cost ledger ids` to `cleaned`,
   before any backend-specific journal cleanup in `{{ticketing.include}}`.

## Degradation

Cost reporting must never block the handoff. If `ccusage` is not installed, a session id is missing,
or a lookup fails, still proceed with the `{{status.acceptance-test}}` handoff and post a
`{{artifact.costSummary}}` comment that names what was unavailable (e.g. "ccusage not installed — no
cost data" or "product-architect session not recorded"), so the gap is visible rather than silent.
