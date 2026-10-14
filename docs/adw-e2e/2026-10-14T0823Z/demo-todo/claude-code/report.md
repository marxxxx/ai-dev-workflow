# E2E demo-todo · claude-code

Model: `claude-opus-5-5` · verifier `claude-sonnet-5-5` · review `claude-sonnet-5-5` · adw 0.25.0 (ff0376f) · trials: 3

Verifier calibration: `2026-10-12T1659Z` (verifier hash cf30252)

## Summary

| Signal | Value |
|---|---|
| reward rate | 1 |
| median tokens | 4,378,667 |
| median agent time (s) | 423 |
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

## Trials

### claude-code-1

reward 1 · contract 1 · acceptance 1 · own tests 1 · tokens 4,378,667 · agent 423 s · tool errors 10
superpowers active: yes

Failed checks: none
Acceptance: AC1 pass · AC2 pass · AC3 pass · AC4 pass · AC5 pass · AC6 pass · AC7 pass

- review requirements 5: All seven acceptance criteria are covered by the spec and the diff, and the spec also settles edge cases such as UTC today, due-today not being overdue, and null versus absent.
- review scope 4: The change stays on the ticket; the two extras are the `?overdue=false` filter value and the atomic PATCH, and the spec and plan docs are the repo's workflow artifacts.
- review tests 4: The tests are thorough and cover validation, PATCH, UTC boundary, filter and 400 cases, and the one changed existing assertion was only extended. The weak spot is that the list page UI is checked only by regex on the HTML, though e2e was run manually.
- review conventions 5: It uses ValidationError for 400s, adds data-testid to new elements, uses no dependencies, follows TDD with matching test style, and the commits reference the ticket.
- review architecture 5: Domain logic sits in the store with an injectable clock, the app only parses the query, and the page renders server-computed overdue, which fits the existing layering with no duplication.
- review codeQuality 4: The code is clean and handles the edge cases (calendar round-trip, leap day, empty string, atomic patch); minor issues are that the page has no error handling and can show a stale list on rapid toggling, both acknowledged.

### claude-code-2

reward 1 · contract 1 · acceptance 1 · own tests 1 · tokens 5,556,119 · agent 484 s · tool errors 7
superpowers active: yes

Failed checks: none
Acceptance: AC1 pass · AC2 pass · AC3 pass · AC4 pass · AC5 pass · AC6 pass · AC7 pass

- review requirements 5: All seven acceptance criteria are covered by the spec and the diff: creation, change and removal of dueDate, 400 on invalid dates, overdue computed in UTC with the filter, the due date shown in the list, the 'überfällig' marker, and the 'nur überfällige' control.
- review scope 3: The new 400 for non-object JSON bodies and the atomic PATCH validation fix are unrequested; the atomic fix is arguably needed once dueDate is validated, but the readJson change is unrelated, and the diff also adds plan and spec docs.
- review tests 4: Store and API tests cover the new behaviour well, including edge cases (leap days, today versus yesterday, copies, atomic patch) and no existing tests were removed. The UI is only checked with regex matches on the HTML, so rendering and the filter toggle are never exercised, and the spec's PATCH set/change cases are not tested at API level.
- review conventions 5: It stays zero-dependency, uses ValidationError for HTTP 400, gives every new UI element a data-testid, and the tests follow the existing node:test and withServer style.
- review architecture 5: Domain logic sits in the store with an injectable clock, the app only parses the query parameter, and the UI renders API fields without computing overdue itself.
- review codeQuality 4: The code is readable and handles edges well (arithmetic leap-year rule, the stale-response guard, copies returned from the store), but render() has no error handling and unhandled JSON.parse errors in readJson are unchanged.

### claude-code-3

reward 1 · contract 1 · acceptance 1 · own tests 1 · tokens 3,635,191 · agent 379 s · tool errors 6
superpowers active: yes

Failed checks: none
Acceptance: AC1 pass · AC2 pass · AC3 pass · AC4 pass · AC5 pass · AC6 pass · AC7 pass

- review requirements 5: All seven acceptance criteria are covered by the spec and the diff, including the edge cases: 30 February, today not being overdue, done todos, and removing a date with null.
- review scope 4: The change is focused. The small extras are the atomic validate-before-mutate rewrite of update, plus the spec and plan documents, and none of them is harmful.
- review tests 4: The store and HTTP tests cover validation, the overdue boundaries, filtering, PATCH null and the 400 cases, and the one existing assertion was extended rather than weakened. The UI is only checked via a string match on the HTML, and the HTTP tests don't check that a PATCH with an invalid date leaves the todo unchanged.
- review conventions 5: It stays zero-dependency, uses ValidationError for 400s, follows TDD with node:test, and gives every new UI element a data-testid.
- review architecture 5: Validation and the overdue rule live in the store, app.mjs only translates the query parameter, and the clock is injectable, which matches the existing layering.
- review codeQuality 4: The code is clear and correct at the edges, with a NaN guard, view copies and validate-before-mutate in update. Minor points are that update does repeated 'in patch' checks, and the null-body 500 was left as is.
