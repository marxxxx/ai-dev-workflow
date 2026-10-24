# E2E demo-todo · claude-code

Model: `claude-opus-5-5` · verifier `claude-sonnet-5-5` · review `claude-sonnet-5-5` · adw 0.28.0 (e440089) · trials: 3

Verifier calibration: `2026-10-12T1659Z` (verifier hash cf30252)

## Summary

| Signal | Value |
|---|---|
| reward rate | 1 |
| median tokens | 3,900,538 |
| median cost (USD) | $2.44 |
| median agent time (s) | 465 |
| review requirements (median) | 5 |
| review scope (median) | 4 |
| review tests (median) | 4 |
| review conventions (median) | 5 |
| review architecture (median) | 5 |
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
| playwright | 3/3 | 33 |
| context7 | 0/3 | 0 |

## Trials

### claude-code-1

reward 1 · contract 1 · acceptance 1 · own tests 1 · tokens 3,900,538 · cost $2.44 · agent 415 s · tool errors 8
superpowers active: yes
MCP: serena 0 · playwright 12 (browser_evaluate 4, browser_take_screenshot 3, browser_navigate 2, browser_click 2, browser_close 1) · context7 0
built-in: Bash 39, Read 9, Edit 7, Skill 5, Write 5, ToolSearch 4, Grep 1, Agent 1, KillShell 1

Failed checks: none
Acceptance: AC1 pass · AC2 pass · AC3 pass · AC4 pass · AC5 pass · AC6 pass · AC7 pass

| Model | Input | Output | Cache read | Cache write | Total | Cost |
|---|---|---|---|---|---|---|
| claude-opus-5-5 | 116 | 34,874 | 3,642,605 | 111,111 | 3,788,706 | $2.32 |
| claude-sonnet-5-5 | 10 | 3,799 | 75,022 | 33,001 | 111,832 | $0.13 |

- review requirements 5: All seven acceptance criteria are covered in the spec and the diff, including the UTC rule, the 400 cases, and the exact UI wording.
- review scope 4: The change adds JSON-object body validation and makes a rejected PATCH atomic, which nobody asked for; the summary does disclose both and they are small.
- review tests 4: Store and API tests cover the validation, UTC boundary, filter and PATCH null cases, and no existing tests were weakened; the page behaviour (date format, marker) is only checked through a static HTML string match, and there is no test for a PATCH that is rejected without changing anything.
- review conventions 5: The change uses ValidationError mapped to 400, adds data-testid on every new UI element, uses only builtins, and writes tests first.
- review architecture 5: The overdue rule lives only in the store's view helper, and the app and page reuse it, so the logic is not duplicated.
- review codeQuality 4: The code is clean and handles edge cases such as the leap day and the PATCH ordering; the Date.parse check is redundant given the round-trip comparison, and render() has no handling for failed fetches.

### claude-code-2

reward 1 · contract 1 · acceptance 1 · own tests 1 · tokens 3,794,122 · cost $2.13 · agent 465 s · tool errors 9
superpowers active: yes
MCP: serena 0 · playwright 12 (browser_evaluate 4, browser_take_screenshot 3, browser_navigate 2, browser_click 2, browser_close 1) · context7 0
built-in: Bash 35, Read 11, Edit 6, Skill 5, Write 4, ToolSearch 3, Agent 1, KillShell 1

Failed checks: none
Acceptance: AC1 pass · AC2 pass · AC3 pass · AC4 pass · AC5 pass · AC6 pass · AC7 pass

| Model | Input | Output | Cache read | Cache write | Total | Cost |
|---|---|---|---|---|---|---|
| claude-opus-5-5 | 120 | 31,768 | 3,574,298 | 82,665 | 3,688,851 | $2.01 |
| claude-sonnet-5-5 | 10 | 3,507 | 70,827 | 30,927 | 105,271 | $0.12 |

- review requirements 5: The spec and the diff cover all seven acceptance criteria, including the UTC boundary, clearing a date with null, 400 on invalid dates, and the exact UI copy and test ids.
- review scope 5: The diff adds only the due-date field, the overdue filter and the UI changes, plus the spec and plan documents; there is no styling or extra filter value.
- review tests 4: The new tests cover validation, the leap day, patching and clearing, id non-consumption and the overdue boundary with an injected clock, but the page test only greps for static HTML and no test covers the due-date and overdue rendering in the browser.
- review conventions 5: The change uses ValidationError, adds data-testid attributes, uses no dependencies, follows TDD, and matches the existing style.
- review architecture 5: The overdue rule lives only in the store with an injectable clock, the app only maps the query parameter, and the page asks the server instead of duplicating the rule.
- review codeQuality 4: The code is clean and correct, and update validates every field before mutating, but checkDueDate builds a Date from a non-string value before the type check and the page makes two requests per render.

### claude-code-3

reward 1 · contract 1 · acceptance 1 · own tests 1 · tokens 4,541,780 · cost $2.49 · agent 521 s · tool errors 8
superpowers active: yes
MCP: serena 0 · playwright 9 (browser_take_screenshot 3, browser_navigate 2, browser_click 2, browser_snapshot 1, browser_close 1) · context7 0
built-in: Bash 42, Read 9, Edit 6, Skill 5, Write 5, ToolSearch 4, Agent 1, KillShell 1

Failed checks: none
Acceptance: AC1 pass · AC2 pass · AC3 pass · AC4 pass · AC5 pass · AC6 pass · AC7 pass

| Model | Input | Output | Cache read | Cache write | Total | Cost |
|---|---|---|---|---|---|---|
| claude-opus-5-5 | 134 | 38,050 | 4,298,291 | 93,330 | 4,429,805 | $2.37 |
| claude-sonnet-5-5 | 10 | 3,255 | 74,003 | 34,707 | 111,975 | $0.13 |

- review requirements 5: All seven acceptance criteria are covered by the spec and the diff: create, change and remove the date, 400 on invalid dates, the overdue filter, date display, the 'überfällig' marker and the 'nur überfällige' control.
- review scope 4: Extras are small and tied to the feature: a read-only `overdue` check, strict `?overdue=` values, and atomic PATCH validation. The atomic PATCH change touches existing behaviour but is disclosed in the summary.
- review tests 4: Store and API tests cover the boundaries (today vs. yesterday, done, a moving clock, impossible dates, a failed PATCH changing nothing) and the filter. The page behaviour is only checked by string matches on the HTML and by a manual e2e run. The existing test was extended rather than weakened.
- review conventions 5: Follows the project rules: zero dependencies, `ValidationError` mapped to 400, tests written first, new elements carry `data-testid`, and the existing test style is reused.
- review architecture 5: The rule, validation and filter live in the store, `app.mjs` only parses the query parameter, and the page uses the API filter. This matches the approach the user chose.
- review codeQuality 4: The code is clear and handles edge cases such as impossible dates, copies on return and `done` toggling. `parseDueDate` is slightly redundant, because the `Date.parse` NaN check is covered by the round-trip comparison, and `rejectOverdue` runs after the other validation in `update`.
