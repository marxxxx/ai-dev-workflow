# E2E demo-todo · opencode

Model: `mistral/mistral-large-4` · verifier `claude-sonnet-5-5` · review `claude-sonnet-5-5` · adw 0.25.0 (576ccfb) · trials: 3

Verifier calibration: `2026-10-12T1659Z` (verifier hash cf30252)

## Summary

| Signal | Value |
|---|---|
| reward rate | 1 |
| median tokens | 3,289,978 |
| median cost (USD) | $0.82 |
| median agent time (s) | 631 |
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

### opencode-1

reward 1 · contract 1 · acceptance 1 · own tests 1 · tokens 2,905,205 · cost $1.11 · agent 635 s · tool errors 3
superpowers active: no

Failed checks: none
Acceptance: AC1 pass · AC2 pass · AC3 pass · AC4 pass · AC5 pass · AC6 pass · AC7 pass

| Model | Input | Output | Cache read | Cache write | Total | Cost |
|---|---|---|---|---|---|---|
| mistral-large-4 | 1,438,687 | 15,094 | 1,451,424 | 0 | 2,905,205 | $1.11 |

- review requirements 5: The spec and the diff cover all seven acceptance criteria: optional date on create, change and remove through PATCH, 400 on invalid dates, the overdue filter, date display, the 'überfällig' marker and the 'nur überfällige' control.
- review scope 5: The change is limited to what the ticket asks for, plus the spec and plan docs the workflow requires. The only edit to an existing test is the one the new field forces.
- review tests 4: The API tests cover creation, invalid format, 30 February, update, removal, and the overdue boundaries (today, done, no date). The UI is only checked by regex on the served HTML, so marker and filter behaviour is not tested automatically, and no test calls isValidDueDate or isOverdue directly.
- review conventions 5: The change uses ValidationError mapped to 400, adds no dependencies, adds data-testid attributes to new elements, and follows the existing test helpers and naming style.
- review architecture 4: Validation and the overdue predicate sit in the store and the filter is applied in the store's list(). The overdue predicate is duplicated in the client script, which is unavoidable without a server-provided flag.
- review codeQuality 4: The code is small and readable, and the calendar-date round-trip check is correct. Minor edges: todayUtc in the page is computed once at load, so it goes stale if the page stays open past midnight UTC, and the fetch in render() has no error handling or ordering guard.

### opencode-2

reward 1 · contract 1 · acceptance 1 · own tests 1 · tokens 3,289,978 · cost $0.82 · agent 569 s · tool errors 2
superpowers active: yes

Failed checks: none
Acceptance: AC1 pass · AC2 pass · AC3 pass · AC4 pass · AC5 pass · AC6 pass · AC7 pass

| Model | Input | Output | Cache read | Cache write | Total | Cost |
|---|---|---|---|---|---|---|
| mistral-large-4 | 914,471 | 13,947 | 2,361,560 | 0 | 3,289,978 | $0.82 |

- review requirements 5: The spec and diff cover all seven acceptance criteria, including set, change and remove (null), 400 on invalid dates, UTC overdue semantics, the date display, the "überfällig" marker and the "nur überfällige" button.
- review scope 4: The change stays on the ticket; the only extras are an aria-pressed state the spec allowed and the plan and spec docs.
- review tests 3: API tests cover validation, update and removal, the overdue filter, done todos and a due date of today, and the one edited existing assertion only adds dueDate: null. The UI has only a string-match test for the button, so the marker, date display and toggle are covered only by manual Playwright runs, and the leap-year edge case has no test.
- review conventions 5: Follows AGENTS.md: ValidationError maps to 400, no dependencies, data-testid on new elements, and it matches the existing test style.
- review architecture 4: Validation and the overdue predicate live in the store with the HTTP layer only passing through, though the overdue predicate is duplicated in the client.
- review codeQuality 4: The code is clear and handles edge cases such as impossible calendar dates and the strict < comparison; applyDueDate has a duplicated error message and the page recomputes today's date for every todo.

### opencode-3

reward 1 · contract 1 · acceptance 1 · own tests 1 · tokens 4,314,501 · cost $0.44 · agent 631 s · tool errors 3
superpowers active: no

Failed checks: none
Acceptance: AC1 pass · AC2 pass · AC3 pass · AC4 pass · AC5 pass · AC6 pass · AC7 pass

| Model | Input | Output | Cache read | Cache write | Total | Cost |
|---|---|---|---|---|---|---|
| mistral-large-4 | 155,497 | 20,260 | 4,138,744 | 0 | 4,314,501 | $0.44 |

- review requirements 5: All seven acceptance criteria are covered by the spec and the diff, including the UTC and done-todo overdue rule, which the spec was updated to match.
- review scope 4: The change stays within the ticket; the extra plan and spec docs and the .gitignore entry for Playwright artifacts are minor additions.
- review tests 4: Store and API tests cover validation, PATCH set/clear, and overdue edge cases, but the UI is only checked for the filter's testid and the existing test was only extended.
- review conventions 5: The change uses ValidationError mapped to 400, adds data-testid on the new elements, has no new dependencies, and follows the existing test style.
- review architecture 3: The overdue predicate is duplicated in app.mjs and index.html, and the filtering logic sits in the route handler instead of the store.
- review codeQuality 4: The code is clear and the date validation is strict, but the overdue logic is duplicated and the page's initial load has no error handling.
