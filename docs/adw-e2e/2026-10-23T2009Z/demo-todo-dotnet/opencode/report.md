# E2E demo-todo-dotnet · opencode

Model: `mistral/mistral-large-4` · verifier `claude-sonnet-5-5` · review `claude-sonnet-5-5` · adw 0.28.0 (4c61966) · trials: 3

Verifier calibration: `2026-10-13T1704Z` (verifier hash cf30252)

## Summary

| Signal | Value |
|---|---|
| reward rate | 0.33 |
| median tokens | 7,155,881 |
| median cost (USD) | $1.40 |
| median agent time (s) | 2,701 |
| review requirements (median) | 3.5 |
| review scope (median) | 4 |
| review tests (median) | 3.5 |
| review conventions (median) | 3.5 |
| review architecture (median) | 3 |
| review codeQuality (median) | 2.5 |
| error classes | harbor, timeout |

## Check pass rates

| Check | Rate |
|---|---|
| ticket_open | 1 |
| ticket_review | 0.67 |
| spec_comment | 1 |
| spec_comment_complete | 1 |
| summary_comment | 0.67 |
| cost_comment | 0.67 |
| only_allowed_comments | 1 |
| pr_draft | 0.67 |
| branch_naming | 0.67 |
| pr_title_naming | 0.67 |
| e2e_performed | 1 |
| app_stopped | 1 |
| no_screenshots_in_repo | 1 |
| acceptance | 0.33 |
| ownTests | 0.67 |
| ac:AC1 | 0.67 |
| ac:AC2 | 0.67 |
| ac:AC3 | 0.33 |
| ac:AC4 | 0.33 |
| ac:AC5 | 0.67 |
| ac:AC6 | 0.67 |
| ac:AC7 | 0.33 |

## MCP usage

Information only, never a check: every configured server, used or not.

| Server | Trials using | Calls |
|---|---|---|
| serena | 0/3 | 0 |
| playwright | 3/3 | 32 |
| context7 | 0/3 | 0 |

## Trials

### opencode-1

reward 0 · contract 0.5385 · acceptance 0 · own tests 0 · tokens 6,130,173 · cost $1.25 · agent 2,701 s · tool errors 7 · harbor: AgentTimeoutError
superpowers active: yes
MCP: serena 0 · playwright 10 (browser_snapshot 3, browser_click 3, browser_take_screenshot 2, browser_navigate 1, browser_wait_for 1) · context7 0
built-in: bash 57, edit 22, read 17, skill 6, todowrite 6, write 4, task 1

Failed checks: ticket_review, summary_comment, cost_comment, pr_draft, branch_naming, pr_title_naming
Acceptance: AC1 fail · AC2 fail · AC3 fail · AC4 fail · AC5 fail · AC6 fail · AC7 fail

| Model | Input | Output | Cache read | Cache write | Total | Cost |
|---|---|---|---|---|---|---|
| mistral-large-4 | 226,732 | 28,313 | 5,875,128 | 0 | 6,130,173 | $1.25 |


### opencode-2

reward 0 · contract 1 · acceptance 0.571 · own tests 1 · tokens 7,155,881 · cost $1.60 · agent 2,701 s · tool errors 4 · harbor: AgentTimeoutError
superpowers active: yes
MCP: serena 0 · playwright 8 (browser_navigate 2, browser_wait_for 2, browser_snapshot 2, browser_take_screenshot 1, browser_run_code_unsafe 1) · context7 0
built-in: bash 105, read 16, edit 13, skill 7, todowrite 6, write 2, task 1

Failed checks: none
Acceptance: AC1 pass · AC2 pass · AC3 fail · AC4 fail · AC5 pass · AC6 pass · AC7 fail

| Model | Input | Output | Cache read | Cache write | Total | Cost |
|---|---|---|---|---|---|---|
| mistral-large-4 | 320,947 | 52,018 | 6,782,916 | 0 | 7,155,881 | $1.60 |

- review requirements 2: The spec explicitly excluded filtering, so AC4 (API overdue-only) and AC7 (the "nur überfällige" control) are missing from both the spec and the diff, and the UTC definition of today was not captured.
- review scope 4: Nothing unrequested was added beyond the plan and spec docs, but the PATCH handler was fully rewritten with manual JSON parsing.
- review tests 3: The new tests cover set, clear, POST-invalid and the overdue/done/today boundaries, but there is no test for an invalid date in PATCH or for an impossible date such as 30 February, and the overdue assertions use local DateTime.Today.
- review conventions 3: The change follows TDD, uses data-testid attributes and keeps the record style, but it bypasses the ValidationException-to-400 pattern and uses fully qualified System.Text.Json names inline.
- review architecture 2: The PATCH handler now hand-parses JSON in Program.cs and drops model binding. The overdue logic sits inline in Home.razor, so the API and UI cannot share it, and the DueDateSet flag leaks into the store-level record.
- review codeQuality 2: PATCH calls DateOnly.Parse, which throws FormatException (likely a 500) on an invalid date. It also tolerates an empty or malformed body only by throwing, silently ignores wrongly typed fields, and uses local DateTime.Today instead of UTC.

### opencode-3

reward 1 · contract 1 · acceptance 1 · own tests 1 · tokens 7,257,410 · cost $1.40 · agent 939 s · tool errors 4
superpowers active: yes
MCP: serena 0 · playwright 14 (browser_wait_for 3, browser_snapshot 3, browser_take_screenshot 3, browser_click 3, browser_navigate 1, browser_find 1) · context7 0
built-in: bash 48, edit 15, read 8, todowrite 8, skill 5, write 3, invalid 1

Failed checks: none
Acceptance: AC1 pass · AC2 pass · AC3 pass · AC4 pass · AC5 pass · AC6 pass · AC7 pass

| Model | Input | Output | Cache read | Cache write | Total | Cost |
|---|---|---|---|---|---|---|
| mistral-large-4 | 123,679 | 56,559 | 7,077,172 | 0 | 7,257,410 | $1.40 |

- review requirements 5: All seven acceptance criteria are covered, including set, change and clear on PATCH, UTC overdue, 400 on invalid dates, the "überfällig" marker and the "nur überfällige" control.
- review scope 4: The change stays within the ticket; the only extras are the plan and spec docs and the custom PATCH converter, which the clear-by-null requirement justifies.
- review tests 4: Store, API and page tests cover overdue, UTC today, done, 400 and null-clear cases, but nothing tests the filter checkbox's behaviour, the page test never checks that a non-overdue todo lacks the marker, and the one edited existing assertion only gained `dueDate:null`.
- review conventions 4: The code uses the repo's data-testid, ValidationException and 400-mapping idioms and the existing test style, though the converter class sits in TodoStore.cs instead of its own file.
- review architecture 4: Logic stays in TodoStore and the minimal API with the Razor page reusing the store, but the JSON converter is placed in the store file and the overdue test is instance-based rather than injectable for the clock.
- review codeQuality 3: The hand-written TodoPatchJsonConverter silently ignores wrongly typed title, done and dueDate values, so `"dueDate": 123` clears the date instead of returning 400. It also parses the body into a JsonDocument by hand, which is more complex than needed.
