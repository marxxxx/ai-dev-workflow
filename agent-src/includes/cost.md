# Per-Ticket Token And Cost Accounting

This generated include defines how the workflow records `ccusage` sessions and posts
`{{artifact.costSummary}}` when a ticket reaches `{{status.acceptance-test}}`. Edit
`agent-src/includes/cost.md`, then regenerate.

`ccusage` reads local Claude Code, Codex, and OpenCode logs and estimates tokens and USD. Cross-harness
aggregation works when sessions ran under the same machine account. Post comments only through
`{{ticketing.include}}`.

## Run Ledger

Each active ledger has a unique path outside the repository:

```text
<os-temp-dir>/ai-dev-workflow-cost/<ticket>-<nonce>.json
```

Use the OS temp directory and a random nonce of at least eight hex characters so concurrent runs do
not collide. Append each ledger basename to the journal's `Cost ledger ids`; never store an absolute
local path on the ticket. On restart, resolve those basenames under the current OS temp directory and
reuse the newest existing ledger. If none exists, append a new id and retain the missing ids as gaps
for the final summary. Ledger shape:

```json
{
  "ticket": "<number>",
  "nonce": "<random>",
  "createdAt": "<ISO-8601>",
  "sessions": [
    { "phase": "orchestrator", "harness": "claude|codex|opencode", "sessionId": "<id>" },
    { "phase": "developer", "harness": "...", "sessionId": "<id>" }
  ]
}
```

Append with read-modify-write. Only participants in this uniquely named run use the file.

## Identify The Current Session

At the start of a participant's work, select the newest session log scoped to the current project:

- **Claude Code:** `~/.claude/projects/<cwd-encoded>/*.jsonl`; use the filename stem. Task subagents
  share the orchestrator session, so the orchestrator entry already covers all phases.
- **Codex:** `${CODEX_HOME:-~/.codex}/sessions/YYYY/MM/DD/rollout-*.jsonl`; use its rollout id.
  Subagents have separate sessions and each records its own id.
- **OpenCode:** `${OPENCODE_DATA_DIR:-~/.local/share/opencode}/storage/session/<projectHash>/`; use
  the newest filename stem. Subagents record their separate ids.

If detection fails, record `"sessionId": null` with a brief note rather than guessing.

## Recording Responsibilities

- `dev-cycle` reuses or creates the active ledger after sizing permits the run and records
  `orchestrator`.
- A subagent given the ledger path records its matching phase before returning. Duplicate Claude
  entries are harmless because aggregation deduplicates them.
- `product-architect` runs before the ledger exists. At ticket creation it posts
  `{{artifact.costOrigin}}` as `harness=<claude|codex|opencode> session=<id>`.

## Produce The Summary

When the ticket reaches `{{status.acceptance-test}}`:

1. If `{{artifact.costSummary}}` already exists, skip pricing and posting but still perform ledger
   cleanup in step 5.
2. Collect entries from every available ledger listed in `{{artifact.journal}}` plus any
   `{{artifact.costOrigin}}`; deduplicate by `(harness, sessionId)`. List missing ledger ids as cost
   gaps.
3. For each non-null session, run:

   ```bash
   ccusage <harness> session --id <sessionId> --json
   ```

   Use an installed binary. With no network, add `--offline` for cached pricing. Do not download or
   execute an unapproved package; treat a missing binary as unavailable cost data.

   The filtered response is one object, not the `session[]` shape returned by an unfiltered query:

   ```json
   { "sessionId": "<id>", "totalCost": 0.0, "totalTokens": 0, "entries": [] }
   ```

   Read `totalCost` and `totalTokens` at the top level. From `entries`, sum `inputTokens`,
   `outputTokens`, `cacheCreationTokens`, and `cacheReadTokens`; collect distinct `model` values.
4. Group the result by phase:

   | Phase | Model(s) | Input | Output | Cache | Total tokens | Est. USD |
   |---|---|---|---|---|---|---|
   | product-architect (design) | … | … | … | … | … | … |
   | developer | … | … | … | … | … | … |
   | code-review | … | … | … | … | … | … |
   | QA | … | … | … | … | … | … |
   | orchestrator | … | … | … | … | … | … |
   | **Total** | | | | | **…** | **…** |

   For Claude Code, show one `dev-cycle (Claude Code — subagents share the session)` row plus the
   product-architect row. For Codex and OpenCode, show actual phase rows.
5. Post the table as `{{artifact.costSummary}}`, noting that ccusage's USD figure is a local estimate.
   Delete every listed ledger that exists and set `Cost ledger ids` to `cleaned` before any
   backend-specific journal cleanup.

## Degradation

Cost reporting never changes or rolls back ticket state. If ccusage is unavailable, an id is missing,
or lookup fails, post `{{artifact.costSummary}}` naming each gap and continue the final handoff.
