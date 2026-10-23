# E2E demo-todo · codex

Model: `openai/gpt-6.1-sol` · verifier `claude-sonnet-5-5` · review `claude-sonnet-5-5` · adw 0.28.0 (2533ab0) · trials: 3

Verifier calibration: `2026-10-12T1659Z` (verifier hash cf30252)

## Summary

| Signal | Value |
|---|---|
| reward rate | 1 |
| median tokens | 3,577,340 |
| median cost (USD) | $0.88 |
| median agent time (s) | 1,412 |
| review requirements (median) | 5 |
| review scope (median) | 4 |
| review tests (median) | 5 |
| review conventions (median) | 5 |
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
| serena | 0/3 | 0 |
| playwright | 3/3 | 20 |
| context7 | 0/3 | 0 |

## Trials

### codex-1

reward 1 · contract 1 · acceptance 1 · own tests 1 · tokens 3,577,340 · cost $0.87 · agent 836 s · tool errors 0
superpowers active: yes
MCP: serena 0 · playwright 8 (browser_run_code_unsafe 5, browser_take_screenshot 2, browser_navigate 1) · context7 0
built-in: CommandExecution 52, FileChange 10, CollabAgentToolCall 1

Failed checks: none
Acceptance: AC1 pass · AC2 pass · AC3 pass · AC4 pass · AC5 pass · AC6 pass · AC7 pass

| Model | Input | Output | Cache read | Cache write | Total | Cost |
|---|---|---|---|---|---|---|
| gpt-6.1-sol | 111,124 | 30,184 | 3,436,032 | 0 | 3,577,340 | $0.87 |

- review requirements 5: The spec and diff cover all seven acceptance criteria, including the UTC rule, the exact labels, and the HTTP 400 mapping, and they add edge cases such as atomic PATCH and leap years.
- review scope 4: The code stays within the ticket, apart from a clock-injection parameter that the spec allows. The only extras are the plan and spec documents, which come from the process.
- review tests 4: The store and API tests are thorough, covering validation, atomicity, UTC midnight, filtering, and an empty result, and no existing tests were weakened. UI rendering of the date, the label, and the filter behaviour is checked only manually, and the automated page test only inspects the checkbox HTML.
- review conventions 5: The change uses Node built-ins only, throws ValidationError for bad dates, writes tests first, and gives new elements data-testid attributes, as AGENTS.md requires.
- review architecture 4: Validation lives in the store and the derived overdue status is computed once in the API, so the page only reads the value. The `present` helper's default `today` parameter is a little awkward and is computed separately in the list route.
- review codeQuality 4: The code is clean and correct at the edges: it handles stale requests with a generation counter, uses textContent, and applies PATCH changes atomically. The page's reload has no error handling for failed fetches.

### codex-2

reward 1 · contract 1 · acceptance 1 · own tests 1 · tokens 3,707,902 · cost $0.93 · agent 1,473 s · tool errors 0
superpowers active: yes
MCP: serena 0 · playwright 8 (browser_run_code_unsafe 3, browser_console_messages 2, browser_close 2, browser_navigate 1) · context7 0
built-in: CommandExecution 70, FileChange 11

Failed checks: none
Acceptance: AC1 pass · AC2 pass · AC3 pass · AC4 pass · AC5 pass · AC6 pass · AC7 pass

| Model | Input | Output | Cache read | Cache write | Total | Cost |
|---|---|---|---|---|---|---|
| gpt-6.1-sol | 106,191 | 36,399 | 3,565,312 | 0 | 3,707,902 | $0.93 |

- review requirements 4: All seven ACs are covered, but the marker is rendered as capitalised "Überfällig" where AC6 says the word "überfällig", which is a small and possibly case-sensitive deviation.
- review scope 3: The UI adds an error banner with a hidden alert element and extra failure-handling tests that no AC asked for, and it commits large plan and spec docs.
- review tests 5: Store, API and UI tests cover UTC boundaries, leap years, atomic PATCH, filter values, stale responses and failure paths; the one existing test was only updated for the new fields.
- review conventions 5: The change uses ValidationError mapped to 400, adds data-testid on new elements, has no new dependencies and follows the repo's test style.
- review architecture 4: Date logic lives in the store, with a thin HTTP layer and an injectable clock, but the UI tests run the inline script through a hand-rolled vm DOM double.
- review codeQuality 4: Validation is atomic and the clock is read once per list, but the validator has a redundant length check, and fetching `/todos?overdue=false` is never needed.

### codex-3

reward 1 · contract 1 · acceptance 1 · own tests 1 · tokens 3,331,935 · cost $0.88 · agent 1,412 s · tool errors 0
superpowers active: yes
MCP: serena 0 · playwright 4 (browser_run_code_unsafe 2, browser_navigate 1, browser_console_messages 1) · context7 0
built-in: CommandExecution 52, FileChange 13, ImageView 1, CollabAgentToolCall 1

Failed checks: none
Acceptance: AC1 pass · AC2 pass · AC3 pass · AC4 pass · AC5 pass · AC6 pass · AC7 pass

| Model | Input | Output | Cache read | Cache write | Total | Cost |
|---|---|---|---|---|---|---|
| gpt-6.1-sol | 108,729 | 34,086 | 3,189,120 | 0 | 3,331,935 | $0.88 |

- review requirements 5: The spec and diff cover AC1–AC7: optional, changeable and removable dates, 400 on invalid input, a UTC overdue filter, date display, the lowercase marker and the labelled checkbox.
- review scope 4: Error banner and rollback of the filter on load failure go beyond the ACs, though the spec records them; the committed plan and spec docs are process artifacts.
- review tests 5: Store, API and page tests cover leap days, years below 0100, UTC midnight, atomic PATCH, filter results, and stale or failed requests; the one existing assertion was extended rather than weakened.
- review conventions 5: Uses ValidationError mapped to HTTP 400, no dependencies, tests written first, data-testid on all new elements, and textContent for titles.
- review architecture 4: Overdue logic stays in the store with an injectable clock and the route only filters, but the page script is tested through a hand-built vm DOM stub.
- review codeQuality 4: Validation runs before any mutation and the date round-trip check is correct at the edges; the page's request counter and rollback logic is slightly intricate but sound.
