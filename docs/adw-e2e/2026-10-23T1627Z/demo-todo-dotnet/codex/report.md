# E2E demo-todo-dotnet · codex

Model: `openai/gpt-6.1-sol` · verifier `claude-sonnet-5-5` · review `claude-sonnet-5-5` · adw 0.28.0 (2533ab0) · trials: 3

Verifier calibration: `2026-10-13T1704Z` (verifier hash cf30252)

## Summary

| Signal | Value |
|---|---|
| reward rate | 1 |
| median tokens | 5,017,626 |
| median cost (USD) | $1.07 |
| median agent time (s) | 1,462 |
| review requirements (median) | 5 |
| review scope (median) | 4 |
| review tests (median) | 4 |
| review conventions (median) | 4 |
| review architecture (median) | 4 |
| review codeQuality (median) | 4 |
| error classes | none |

## Check pass rates

| Check | Rate |
|---|---|
| ticket_open | 1 |
| ticket_review | 1 |
| spec_comment | 1 |
| spec_comment_complete | 1 |
| summary_comment | 1 |
| cost_comment | 1 |
| only_allowed_comments | 1 |
| pr_draft | 1 |
| branch_naming | 1 |
| pr_title_naming | 1 |
| e2e_performed | 1 |
| app_stopped | 1 |
| no_screenshots_in_repo | 1 |
| acceptance | 1 |
| ownTests | 1 |
| ac:AC1 | 1 |
| ac:AC2 | 1 |
| ac:AC3 | 1 |
| ac:AC4 | 1 |
| ac:AC5 | 1 |
| ac:AC6 | 1 |
| ac:AC7 | 1 |

## MCP usage

Information only, never a check: every configured server, used or not.

| Server | Trials using | Calls |
|---|---|---|
| serena | 1/3 | 1 |
| playwright | 3/3 | 36 |
| context7 | 0/3 | 0 |

## Trials

### codex-1

reward 1 · contract 1 · acceptance 1 · own tests 1 · tokens 5,017,626 · cost $1.07 · agent 1,462 s · tool errors 0
superpowers active: yes
MCP: serena 0 · playwright 11 (browser_run_code_unsafe 6, browser_navigate 2, browser_close 2, browser_console_messages 1) · context7 0
built-in: CommandExecution 63, FileChange 11, ImageView 1

Failed checks: none
Acceptance: AC1 pass · AC2 pass · AC3 pass · AC4 pass · AC5 pass · AC6 pass · AC7 pass

| Model | Input | Output | Cache read | Cache write | Total | Cost |
|---|---|---|---|---|---|---|
| gpt-6.1-sol | 111,599 | 35,627 | 4,870,400 | 0 | 5,017,626 | $1.07 |

- review requirements 5: All seven acceptance criteria are covered, including the 30 February case returning 400, and the spec adds sensible edge rules such as today not being overdue and PATCH omission versus null.
- review scope 4: The change stays on the feature. The only extras are a `.worktrees/` entry in `.gitignore` and the plan and spec docs, which are small and workflow-driven.
- review tests 4: Store, API and prerender page tests are thorough: UTC midnight, PATCH preservation, invalid dates, filter order and an empty result. The checkbox toggle is never exercised in an automated test, only in the manual Playwright run, and the one existing test that changed only had its expected JSON updated for the new fields.
- review conventions 4: It follows AGENTS.md: no new packages, a failing test first, `data-testid` on the new elements, and validation errors mapped through the existing 400 handling. The test style matches the existing tests.
- review architecture 5: Logic stays in the shared `TodoStore`, which is injected with a `TimeProvider`. Status is derived at read time through a single `Snapshot` path, so the API and the page share one rule and the page still calls the store directly.
- review codeQuality 4: The code is clean and handles the edge cases correctly: one captured `today` per operation, no stored overdue flag, and an omitted `dueDate` kept distinct from null. The `HasDueDate` presence-tracking property on the patch record is slightly intricate.

### codex-2

reward 1 · contract 1 · acceptance 1 · own tests 1 · tokens 5,272,871 · cost $1.17 · agent 1,550 s · tool errors 0
superpowers active: yes
MCP: serena 1 (initial_instructions 1) · playwright 8 (browser_run_code_unsafe 3, browser_console_messages 3, browser_navigate 1, browser_close 1) · context7 0
built-in: CommandExecution 67, FileChange 12, ImageView 2

Failed checks: none
Acceptance: AC1 pass · AC2 pass · AC3 pass · AC4 pass · AC5 pass · AC6 pass · AC7 pass

| Model | Input | Output | Cache read | Cache write | Total | Cost |
|---|---|---|---|---|---|---|
| gpt-6.1-sol | 159,404 | 34,811 | 5,078,656 | 0 | 5,272,871 | $1.17 |

- review requirements 4: The spec and diff cover AC1–AC7, including the PATCH omitted-versus-null distinction and the 400 cases; the marker text is "Überfällig" rather than the AC's lowercase "überfällig", a minor deviation.
- review scope 4: The code changes stay within the ticket. The plan and spec docs are extra but follow the project's workflow.
- review tests 4: Store and API tests cover date lifecycle, invalid dates, overdue boundaries, the filter and the prerendered markup. The interactive checkbox toggle has no automated test, and the one existing assertion that changed was updated only for the additive fields.
- review conventions 4: The change uses records, the existing store and middleware, and data-testid attributes, as the code around it does. I did not read AGENTS.md in detail.
- review architecture 4: Overdue logic lives once in Todo.IsOverdue and the store's List filter, shared by the API and the page, with no new endpoint or HTTP calls from the page.
- review codeQuality 4: The code is compact and correct. The init-setter presence flag on TodoPatch is a little clever but works, and IsOverdue calls DateTime.UtcNow directly, so it can't be tested with a fixed clock.

### codex-3

reward 1 · contract 1 · acceptance 1 · own tests 1 · tokens 4,922,318 · cost $1.06 · agent 1,443 s · tool errors 0
superpowers active: yes
MCP: serena 0 · playwright 17 (browser_run_code_unsafe 7, browser_take_screenshot 5, browser_navigate 2, browser_console_messages 2, browser_close 1) · context7 0
built-in: CommandExecution 73, FileChange 10, ImageView 2

Failed checks: none
Acceptance: AC1 pass · AC2 pass · AC3 pass · AC4 pass · AC5 pass · AC6 pass · AC7 pass

| Model | Input | Output | Cache read | Cache write | Total | Cost |
|---|---|---|---|---|---|---|
| gpt-6.1-sol | 125,636 | 32,906 | 4,763,776 | 0 | 4,922,318 | $1.06 |

- review requirements 5: The spec and diff cover all seven acceptance criteria and add explicit decisions on PATCH semantics, the UTC boundary, and the 400 error format.
- review scope 4: The code changes stay within the ticket; only the spec and plan docs are extra, and the project's workflow plausibly calls for them.
- review tests 4: Store, API and page tests cover the UTC boundaries, PATCH semantics, invalid dates without mutation, and filter ordering, and no existing tests were weakened. The page tests only inspect prerendered HTML and never toggle the filter. A few date assertions are fragile, such as `2028-02-29` expiring in 2028 and the use of the real clock.
- review conventions 5: The change keeps the shared singleton store and Blazor's direct store access, adds `data-testid` to the new elements, adds no packages, uses the existing 400 mapping, and follows the existing test style.
- review architecture 4: Overdue logic and filtering live in one place in the store and are reused by both the API and the page. The `HasDueDate` presence flag on `TodoPatch` is slightly clunky but works with System.Text.Json without a custom converter.
- review codeQuality 4: The code is concise and correct at the edges: it captures a single `now` per list call, compares UTC dates, and applies PATCH under the lock. The `HasDueDate` flag relies on init-setter side effects, which is subtle.
