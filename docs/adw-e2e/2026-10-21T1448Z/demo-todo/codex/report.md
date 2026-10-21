# E2E demo-todo · codex

Model: `openai/gpt-6.1-sol` · verifier `claude-sonnet-5-5` · review `claude-sonnet-5-5` · adw 0.27.0 (d8bf3ac) · trials: 3

Verifier calibration: `2026-10-12T1659Z` (verifier hash cf30252)

## Summary

| Signal | Value |
|---|---|
| reward rate | 1 |
| median tokens | 2,658,450 |
| median cost (USD) | $0.82 |
| median agent time (s) | 777 |
| review requirements (median) | 5 |
| review scope (median) | 4 |
| review tests (median) | 4 |
| review conventions (median) | 4 |
| review architecture (median) | 4 |
| review codeQuality (median) | 4 |
| error classes | harbor, timeout |

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
| playwright | 3/3 | 26 |
| context7 | 0/3 | 0 |

## Trials

### codex-1

reward 1 · contract 1 · acceptance 1 · own tests 1 · tokens 2,658,450 · cost $0.82 · agent 777 s · tool errors 0
superpowers active: yes
MCP: serena 0 · playwright 11 (browser_run_code_unsafe 6, browser_navigate 2, browser_close 2, browser_take_screenshot 1) · context7 0
built-in: CommandExecution 80, FileChange 11

Failed checks: none
Acceptance: AC1 pass · AC2 pass · AC3 pass · AC4 pass · AC5 pass · AC6 pass · AC7 pass

| Model | Input | Output | Cache read | Cache write | Total | Cost |
|---|---|---|---|---|---|---|
| gpt-6.1-sol | 151,105 | 26,705 | 2,480,640 | 0 | 2,658,450 | $0.82 |

- review requirements 5: All seven acceptance criteria are covered: optional date on create, change and remove via PATCH, 400 on invalid dates, an overdue API filter, date and "überfällig" in the list, and the "nur überfällige" checkbox.
- review scope 4: The change stays on the ticket, but it adds an `overdue=false` filter value and a stale-response guard that nobody asked for, and it changes `update` to copy instead of mutate.
- review tests 4: API and store tests are thorough, including the UTC boundary, leap days, invalid-input atomicity and the filter. The one existing assertion was updated rather than weakened. The UI changes (date, "überfällig", checkbox) have no automated test, only manual Playwright runs.
- review conventions 4: The change uses ValidationError mapped to 400, adds no dependencies, and gives the new UI elements data-testid attributes. It follows the idioms already in the code. The AGENTS.md TDD rule can't be confirmed from the diff.
- review architecture 4: Validation and overdue computation live in the store, and the app only parses the query. The filter runs in the app layer over `store.list()` rather than in the store, which is acceptable.
- review codeQuality 4: The code is clear, and the date validation round-trips through Date for correctness. The UI doesn't handle fetch failures and clears the list before each load, which can flicker.

### codex-2

reward 1 · contract 1 · acceptance 1 · own tests 1 · tokens 2,768,288 · cost $0.87 · agent 1,801 s · tool errors 0 · harbor: AgentTimeoutError
superpowers active: yes
MCP: serena 0 · playwright 10 (browser_run_code_unsafe 4, browser_take_screenshot 4, browser_navigate 1, browser_close 1) · context7 0
built-in: CommandExecution 123, FileChange 7

Failed checks: none
Acceptance: AC1 pass · AC2 pass · AC3 pass · AC4 pass · AC5 pass · AC6 pass · AC7 pass

| Model | Input | Output | Cache read | Cache write | Total | Cost |
|---|---|---|---|---|---|---|
| gpt-6.1-sol | 143,414 | 32,106 | 2,592,768 | 0 | 2,768,288 | $0.87 |

- review requirements 4: All seven ACs are covered by the spec and the diff, including the 'überfällig' wording and the 'nur überfällige' control. The first spec version mistakenly capitalised 'Überfällig' and left out the filter, and only a later update corrected both.
- review scope 3: The change adds an unrequested error paragraph and a loading-disable mechanism in the UI, and it commits a large plan document to docs/. The strict overdue query validation and the retry behaviour are also additions beyond the ACs.
- review tests 4: The API and store tests are thorough: UTC boundaries, validation, atomic patches, filter cases and order. There are no automated UI tests, and an existing test was only updated for the new fields, not weakened.
- review conventions 4: The change uses ValidationError mapped to 400, Node builtins only, data-testid attributes and TDD-style tests. The new elements follow existing idioms, and the plan document is extra repository clutter.
- review architecture 4: Validation and the overdue computation live in the store, and the HTTP layer only filters and maps errors. The date logic is slightly duplicated in the test and snapshot code, and snapshot defaults today per call.
- review codeQuality 4: Patches are applied atomically and the date round-trip validation is strict and correct. Minor issues: a null input to add() would throw a TypeError, and the page's top-level await makes the UI code a bit heavier than needed.

### codex-3

reward 1 · contract 1 · acceptance 1 · own tests 1 · tokens 1,588,484 · cost $0.56 · agent 485 s · tool errors 0
superpowers active: yes
MCP: serena 0 · playwright 5 (browser_run_code_unsafe 3, browser_navigate 1, browser_close 1) · context7 0
built-in: CommandExecution 29, FileChange 3, ImageView 2

Failed checks: none
Acceptance: AC1 pass · AC2 pass · AC3 pass · AC4 pass · AC5 pass · AC6 pass · AC7 pass

| Model | Input | Output | Cache read | Cache write | Total | Cost |
|---|---|---|---|---|---|---|
| gpt-6.1-sol | 127,479 | 16,397 | 1,444,608 | 0 | 1,588,484 | $0.56 |

- review requirements 5: All seven acceptance criteria are covered by the diff, and the spec adds sensible detail such as the UTC boundary, atomic PATCH and the empty-result state.
- review scope 4: The status line, loading state and disabled toggle are small UI extras beyond the ticket, and the atomic PATCH refactor changes existing behaviour, but both stay close to the feature.
- review tests 4: API tests cover validation, PATCH, clearing, the UTC boundary and the filter thoroughly with mocked time, and no existing tests were weakened. The UI has no automated test, and the new page markers (the overdue-filter checkbox and the 'überfällig' marker) are not asserted in the served-page test.
- review conventions 5: The change uses ValidationError, adds data-testid to new elements, has no new dependencies, and follows the existing test style.
- review architecture 4: Filter and validation logic sit in the store and the app only passes the query flag. The client duplicates the overdue rule, and the UTC date computation appears in both the store and the UI.
- review codeQuality 4: Date validation is correct and PATCH is atomic. The client calculates overdue using the browser's clock, which can disagree with the server's, and any value other than 'true' for the overdue param silently returns everything.
