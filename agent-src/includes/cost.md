# Cost Summary

How `agent-dev` totals what one run cost. Nothing is recorded during the run: a run is a **time
window**, from the start time `agent-dev` recorded to now, over every coding-agent session on this
machine. That automatically includes subagent sessions, whichever harness ran them.

## Collect

One command covers every harness (Claude Code, Codex, OpenCode, …) with the same JSON shape.
`<date>` is the start date as `YYYYMMDD`; add `--offline` without network:

```bash
npx -y ccusage@20 session --json --since <date>
```

ccusage's JSON is not a stable API, so stay on the pinned major (`@20`). The response is
`{ "session": [ … ], "totals": { … } }`. Keep each row whose `metadata.lastActivity` is at or after
the start time. For a partial summary with a given end, keep rows at or before that end too. Each
kept row gives you:

- `agent` (harness) and `period` (session id);
- `inputTokens`, `outputTokens`, `cacheReadTokens`, `cacheCreationTokens`, `totalTokens`;
- `totalCost` (USD) and `modelsUsed`.

A model listed in `totals.unpricedModels`, or in a `modelBreakdowns` entry with `missingPricing`,
counts as $0. Never report that as a real $0: name the unpriced models and mark the USD total as
incomplete.

## Report

Sum the kept rows and post one `{{artifact.costSummary}}` comment (see `{{ticketing.include}}`), or
print it when there is no ticket:

```markdown
## {{artifact.costSummary}}
Window: <start> → <end> · Models: <models>

| Input | Output | Cache read | Cache write | Total tokens | Est. USD |
|---|---|---|---|---|---|
| … | … | … | … | … | … |

Sessions counted: <agent>:<period>, …
USD is a local ccusage estimate<; unpriced: <models>>. Every session on this machine active in the
window is counted, including unrelated ones.
```

**Partial** (failed or interrupted run): same procedure over the window the caller gives, with the
heading `## {{artifact.costSummary}} (partial — not completed)`. A ticket may carry several cost
comments, one per attempt; together they are its total cost.

**Never block** on cost: if `ccusage` is unavailable or fails, post the comment stating what was
unavailable.
