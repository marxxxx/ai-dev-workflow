# E2E demo-todo-dotnet · codex

Model: `openai/gpt-6.1-sol` · verifier `claude-sonnet-5-5` · review `claude-sonnet-5-5` · adw 0.27.0 (d8bf3ac) · trials: 3

Verifier calibration: `2026-10-13T1704Z` (verifier hash cf30252)

## Summary

| Signal | Value |
|---|---|
| reward rate | 0.67 |
| median tokens | 4,017,171 |
| median cost (USD) | $1.00 |
| median agent time (s) | 1,283 |
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
| acceptance | 0.67 |
| ownTests | 1 |
| ac:AC1 | 1 |
| ac:AC2 | 1 |
| ac:AC3 | 1 |
| ac:AC4 | 0.67 |
| ac:AC5 | 1 |
| ac:AC6 | 1 |
| ac:AC7 | 0.67 |

## MCP usage

Information only, never a check: every configured server, used or not.

| Server | Trials using | Calls |
|---|---|---|
| serena | 0/3 | 0 |
| playwright | 3/3 | 24 |
| context7 | 0/3 | 0 |

## Trials

### codex-1

reward 1 · contract 1 · acceptance 1 · own tests 1 · tokens 4,017,171 · cost $1.00 · agent 1,414 s · tool errors 0
superpowers active: yes
MCP: serena 0 · playwright 7 (browser_run_code_unsafe 3, browser_navigate 2, browser_close 2) · context7 0
built-in: CommandExecution 78, FileChange 13, ImageView 1

Failed checks: none
Acceptance: AC1 pass · AC2 pass · AC3 pass · AC4 pass · AC5 pass · AC6 pass · AC7 pass

| Model | Input | Output | Cache read | Cache write | Total | Cost |
|---|---|---|---|---|---|---|
| gpt-6.1-sol | 135,756 | 34,503 | 3,846,912 | 0 | 4,017,171 | $1.00 |

- review requirements 5: All seven acceptance criteria are covered, and the spec adds clear PATCH omitted/null semantics, UTC handling and the filter modes.
- review scope 4: It stays within the ticket, apart from a small .gitignore change for .worktrees and a committed plan document, neither of which was requested.
- review tests 4: Store and API tests are thorough, covering PATCH omitted vs null, invalid dates with no mutation, all three filter modes and the page markup. Some tests use the real UTC date, which could fail around midnight, and the interactive checkbox is only checked by hand in the browser.
- review conventions 4: It follows the repo rules: ValidationException in the store, data-testid on new elements, no new packages, and the page calls the store directly. The new tests are slightly verbose, with fully qualified CultureInfo.
- review architecture 4: Parsing and the overdue logic sit in the store and the page reuses it, though the TodoPatch init-tracking pattern is a bit unusual and IsOverdue reads the clock inside the record.
- review codeQuality 4: The code is readable and handles edge cases such as strict parsing, no mutation on invalid input and date range limits. The clock is read in several places and the HasDueDate trick adds some complexity.

### codex-2

reward 0 · contract 1 · acceptance 0.714 · own tests 1 · tokens 4,286,655 · cost $1.04 · agent 1,283 s · tool errors 0
superpowers active: yes
MCP: serena 0 · playwright 7 (browser_take_screenshot 3, browser_run_code_unsafe 2, browser_navigate 1, browser_console_messages 1) · context7 0
built-in: CommandExecution 54, FileChange 7, ImageView 2, CollabAgentToolCall 1

Failed checks: none
Acceptance: AC1 pass · AC2 pass · AC3 pass · AC4 fail · AC5 pass · AC6 pass · AC7 fail

| Model | Input | Output | Cache read | Cache write | Total | Cost |
|---|---|---|---|---|---|---|
| gpt-6.1-sol | 176,073 | 28,278 | 4,082,304 | 0 | 4,286,655 | $1.04 |

- review requirements 2: The spec and diff leave out AC4's API filter for overdue todos and AC7's "nur überfällige" control, so two of the seven acceptance criteria are missing. AC1–AC3, AC5 and AC6 are covered.
- review scope 4: The code changes stay on due dates and overdue state. The only extra is a plan document with verification notes committed under docs/.
- review tests 4: Store, API and page tests thoroughly cover dates, overdue edge cases, PATCH omit versus null, and invalid inputs. The exact-JSON assertion was loosened to property checks, which is justified by the new fields. Nothing tests the missing filter.
- review conventions 4: The change follows AGENTS.md: the store throws ValidationException, new elements get data-testid, no new packages, and tests were written first. The badge text "Überfällig" is capitalized.
- review architecture 4: Logic stays in the shared TodoStore records and Home.razor reads from the store directly. The omitted-versus-null PATCH handling uses a slightly clever init-setter presence flag.
- review codeQuality 4: The code is compact and readable, handles edge cases such as UTC, today, and leap days, and is covered by invalid-date tests. The mutable-looking patch record with a private init flag is a bit subtle.

### codex-3

reward 1 · contract 1 · acceptance 1 · own tests 1 · tokens 3,627,044 · cost $0.88 · agent 885 s · tool errors 0
superpowers active: yes
MCP: serena 0 · playwright 10 (browser_run_code_unsafe 3, browser_navigate 2, browser_console_messages 2, browser_close 2, browser_take_screenshot 1) · context7 0
built-in: CommandExecution 70, FileChange 9, ImageView 2

Failed checks: none
Acceptance: AC1 pass · AC2 pass · AC3 pass · AC4 pass · AC5 pass · AC6 pass · AC7 pass

| Model | Input | Output | Cache read | Cache write | Total | Cost |
|---|---|---|---|---|---|---|
| gpt-6.1-sol | 103,299 | 32,033 | 3,491,712 | 0 | 3,627,044 | $0.88 |

- review requirements 5: All seven acceptance criteria are covered: optional date on create, PATCH to change or remove it, HTTP 400 for invalid dates, the overdue API filter, date display, the "überfällig" marker and the "nur überfällige" checkbox.
- review scope 4: The change stays on the feature. The `isOverdue` response field and the 400 for an invalid `overdue` value are small additions the spec approved.
- review tests 3: Store, API, PATCH-semantics, validation, UTC-boundary and filter tests are good. Nothing tests that ticking the checkbox filters the list (only the initial render is checked), and an existing exact-JSON assertion was loosened.
- review conventions 4: The change follows AGENTS.md: `ValidationException` thrown from the store, no new packages, `data-testid` on new elements, and the page calls the store directly.
- review architecture 4: Parsing and filtering sit in the shared `TodoStore`, and the page and API reuse `List(onlyOverdue)`. The `TodoPatch` `HasDueDate` workaround for missing versus null is slightly heavy, but it works.
- review codeQuality 4: The code is concise and correct at the edges: strict `yyyy-MM-dd` parsing, validation before the lock, and atomic rejection on invalid input. `IsOverdue` reads the clock on each call, which is acceptable.
