# E2E demo-todo · opencode

Model: `mistral/mistral-large-4` · verifier `claude-sonnet-5-5` · review `claude-sonnet-5-5` · adw 0.25.0 (e886701) · trials: 3

Verifier calibration: `2026-10-12T1659Z` (verifier hash cf30252)

## Summary

| Signal | Value |
|---|---|
| reward rate | 0 |
| median tokens | 1,486,186 |
| median cost (USD) | $0.18 |
| median agent time (s) | 448 |
| review requirements (median) | 5 |
| review scope (median) | 4 |
| review tests (median) | 4 |
| review conventions (median) | 4 |
| review architecture (median) | 3 |
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

reward 0 · contract 0.9231 · acceptance 1 · own tests 1 · tokens 1,486,186 · cost $0.19 · agent 448 s · tool errors 2
superpowers active: no

Failed checks: e2e_performed
Acceptance: AC1 pass · AC2 pass · AC3 pass · AC4 pass · AC5 pass · AC6 pass · AC7 pass

| Model | Input | Output | Cache read | Cache write | Total | Cost |
|---|---|---|---|---|---|---|
| mistral-large-4 | 88,260 | 16,254 | 1,381,672 | 0 | 1,486,186 | $0.19 |

- review requirements 4: All seven acceptance criteria are covered, including UTC overdue logic, 400 on invalid dates, and removal via null; the spec only covered the filter (AC4, AC7) through a later update, but the diff delivers it.
- review scope 5: Only due-date and overdue-filter changes are present, with no unrelated edits.
- review tests 3: API tests are good (valid and invalid dates, update and clear, overdue filter including done and no-date cases), but no automated test covers the UI marker, due-date display or checkbox, and the one existing test was only updated for the new field.
- review conventions 4: Uses ValidationError mapped to 400, adds data-testid to every new element, stays dependency-free, and follows the TDD test style.
- review architecture 3: Server-side validation and isOverdue live in the store, but the page re-implements isOverdue in the browser and filters client-side rather than using the new ?overdue=true endpoint, which duplicates logic.
- review codeQuality 4: Date validation is correct with a round-trip calendar check and the code is readable; minor issues are reassigning the dueDate parameter and tests that compute dates from Date.now.

### opencode-2

reward 0 · contract 0.9231 · acceptance 1 · own tests 1 · tokens 914,650 · cost $0.11 · agent 337 s · tool errors 0
superpowers active: no

Failed checks: e2e_performed
Acceptance: AC1 pass · AC2 pass · AC3 pass · AC4 pass · AC5 pass · AC6 pass · AC7 pass

| Model | Input | Output | Cache read | Cache write | Total | Cost |
|---|---|---|---|---|---|---|
| mistral-large-4 | 46,686 | 9,748 | 858,216 | 0 | 914,650 | $0.11 |

- review requirements 5: All seven acceptance criteria are captured in the spec and implemented, including the 400 on invalid dates, the UTC overdue rule, the "überfällig" marker and the "nur überfällige" toggle.
- review scope 4: The change stays within the ticket, but the unused `store.isOverdue(id)` method was not requested and is only used by tests.
- review tests 4: The API and store tests cover validation, leap years, PATCH set/remove, and the overdue filter with edge cases. No browser e2e test was committed, though the spec called for one, and the one existing assertion was only updated for the new `dueDate: null` field.
- review conventions 4: The change uses `ValidationError`, zero dependencies, `data-testid` attributes and the existing test style. The overdue logic is not covered by a test written first, and the e2e check is only reported in the summary, not committed.
- review architecture 3: The overdue rule is written three times: in `isOverdue`, in `listOverdue`, and in the front-end `isOverdue` (client-side, using the browser's date). `listOverdue` does not reuse `isOverdue`.
- review codeQuality 4: The code is readable and handles edge cases such as impossible dates, non-string values and a todo due today. The duplicated validation message and the `isOverdue` duplication are minor flaws, and the UI computes its 'today' in the browser, so it can disagree with the server's UTC day only if the browser clock is off.

### opencode-3

reward 0 · contract 0.9231 · acceptance 1 · own tests 1 · tokens 1,515,735 · cost $0.18 · agent 455 s · tool errors 1
superpowers active: no

Failed checks: e2e_performed
Acceptance: AC1 pass · AC2 pass · AC3 pass · AC4 pass · AC5 pass · AC6 pass · AC7 pass

| Model | Input | Output | Cache read | Cache write | Total | Cost |
|---|---|---|---|---|---|---|
| mistral-large-4 | 77,488 | 15,163 | 1,423,084 | 0 | 1,515,735 | $0.18 |

- review requirements 5: All seven acceptance criteria are covered by the diff, and the spec adds precise edge cases (today is not overdue, null removes the date, wrong type returns 400).
- review scope 4: The code changes stay within the ticket. The only extras are the committed spec and plan docs, and the sample todo in the overdue test carries a redundant `done: false`.
- review tests 4: Store and API tests cover set, change, remove, invalid input and the overdue filter edge cases, and the existing page test was extended rather than weakened. Gaps: the E2E run was manual and left no committed test, and there is no API-level test for a non-string dueDate.
- review conventions 5: The change uses ValidationError for 400s, adds no dependencies, follows TDD, and gives the new UI elements data-testid attributes as AGENTS.md requires.
- review architecture 4: Validation and the overdue filter live in the store and the route only passes the query parameter through. The UI re-implements the overdue rule client-side instead of using ?overdue=true, which the spec allows.
- review codeQuality 4: The code is clear and handles edge cases well, using a Date.UTC round-trip for validation, UTC string comparison, and delete on null. Minor points: the UI computes today once at page load, and a null dueDate on POST gives 400 rather than being ignored.
