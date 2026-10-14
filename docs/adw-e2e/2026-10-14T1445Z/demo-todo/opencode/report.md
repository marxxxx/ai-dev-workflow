# E2E demo-todo · opencode

Model: `mistral/mistral-large-4` · verifier `claude-sonnet-5-5` · review `claude-sonnet-5-5` · adw 0.25.0 (8795ced) · trials: 3

Verifier calibration: `2026-10-12T1659Z` (verifier hash cf30252)

## Summary

| Signal | Value |
|---|---|
| reward rate | 0 |
| median tokens | 881,140 |
| median cost (USD) | $0.16 |
| median agent time (s) | 425 |
| review requirements (median) | 5 |
| review scope (median) | 4 |
| review tests (median) | 4 |
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
| e2e_performed | 0 |
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

## Trials

### opencode-1

reward 0 · contract 0.9231 · acceptance 1 · own tests 1 · tokens 1,630,147 · cost $0.26 · agent 1,694 s · tool errors 1
superpowers active: no

Failed checks: e2e_performed
Acceptance: AC1 pass · AC2 pass · AC3 pass · AC4 pass · AC5 pass · AC6 pass · AC7 pass

| Model | Input | Output | Cache read | Cache write | Total | Cost |
|---|---|---|---|---|---|---|
| mistral-large-4 | 194,153 | 14,958 | 1,421,036 | 0 | 1,630,147 | $0.26 |

- review requirements 5: The spec and diff cover all seven acceptance criteria: optional date-only dueDate, change and clear, 400 on invalid input, the overdue API filter, due date display, the "überfällig" marker, and the "nur überfällige" control.
- review scope 4: The code changes stay within the ticket; the only extras are the spec and plan markdown files committed to the repo.
- review tests 4: Store and API tests cover valid, invalid, null and overdue cases, and the existing test was only updated for the new dueDate field; the list-page test is weak because its regexes use `|todo-due` alternations and only check that strings appear.
- review conventions 5: The change uses ValidationError for HTTP 400, adds no dependencies, puts data-testid on all new elements, follows TDD, and matches the existing style.
- review architecture 4: Validation sits in the store and the overdue filter in the app layer as planned, but isOverdue is duplicated between server and client, which is unavoidable here since there is no shared module and no bundler.
- review codeQuality 4: The code is clear and the calendar-date check handles rollover correctly; minor nits are todayUtc being computed once at page load on the client and `todo.dueDate !== null` failing on a missing field.

### opencode-2

reward 0 · contract 0.9231 · acceptance 1 · own tests 1 · tokens 881,140 · cost $0.16 · agent 425 s · tool errors 0
superpowers active: no

Failed checks: e2e_performed
Acceptance: AC1 pass · AC2 pass · AC3 pass · AC4 pass · AC5 pass · AC6 pass · AC7 pass

| Model | Input | Output | Cache read | Cache write | Total | Cost |
|---|---|---|---|---|---|---|
| mistral-large-4 | 124,871 | 9,689 | 746,580 | 0 | 881,140 | $0.16 |

- review requirements 5: All seven acceptance criteria are covered by the spec and the diff, including a null-removal path, 30 February rejection, UTC overdue logic, the 'überfällig' label and the 'nur überfällige' control.
- review scope 4: No extra features were added, but there is a stray blank line in app.mjs and the committed plan and spec files add some noise.
- review tests 4: API tests cover create, update, remove, invalid dates and the overdue filter edge cases, and the existing assertion was only adjusted for the new field; the UI has no automated test and the test has a pointless `done: false` in the POST body.
- review conventions 4: Uses ValidationError, zero dependencies, data-testids and TDD per AGENTS.md; the duplicated error message and the stray blank line are minor blemishes.
- review architecture 3: Validation and filtering live in the store and the route stays thin, but isOverdue is duplicated in the UI, and the exported isOverdue is only used inside the store.
- review codeQuality 4: Date validation via a Date.UTC round trip is correct and the code is readable; minor issues are the duplicated validation block and the UI computing today only once at page load.

### opencode-3

reward 0 · contract 0.9231 · acceptance 1 · own tests 1 · tokens 807,817 · cost $0.12 · agent 248 s · tool errors 0
superpowers active: no

Failed checks: e2e_performed
Acceptance: AC1 pass · AC2 pass · AC3 pass · AC4 pass · AC5 pass · AC6 pass · AC7 pass

| Model | Input | Output | Cache read | Cache write | Total | Cost |
|---|---|---|---|---|---|---|
| mistral-large-4 | 72,818 | 11,319 | 723,680 | 0 | 807,817 | $0.12 |

- review requirements 5: The spec and diff cover all seven acceptance criteria: optional date-only dueDate, set/change/remove, 400 on invalid dates, the overdue filter, date display, the 'überfällig' marker and the 'nur überfällige' toggle.
- review scope 4: The change stays within the ticket. The only additions beyond the code are the spec and plan markdown files, which the workflow calls for.
- review tests 4: Store and API tests cover validation, leap years, update/remove and the overdue filter. The existing test was adjusted only for the new dueDate field. Gaps: no test pins the 'heute' boundary at the API level, and the UI has no automated test.
- review conventions 5: The change uses ValidationError for 400s, adds no dependencies, gives every new UI element a data-testid, and follows the TDD-style tests and the existing code style.
- review architecture 4: Validation and overdue logic live in the store and the API reuses isOverdue. The UI duplicates the overdue check client-side, which is minor and was planned.
- review codeQuality 4: The date validation is strict and correct, with a Date.UTC round trip for real calendar days. One edge: PATCH treats undefined as null, which is harmless for JSON bodies. The UI also doesn't handle a failed fetch.
