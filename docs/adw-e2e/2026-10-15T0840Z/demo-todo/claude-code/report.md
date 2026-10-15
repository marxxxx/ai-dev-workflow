# E2E demo-todo · claude-code

Model: `claude-opus-5-5` · verifier `claude-sonnet-5-5` · review `claude-sonnet-5-5` · adw 0.25.0 (b408a44) · trials: 3

Verifier calibration: `2026-10-12T1659Z` (verifier hash cf30252)

## Summary

| Signal | Value |
|---|---|
| reward rate | 1 |
| median tokens | 2,640,787 |
| median cost (USD) | $1.49 |
| median agent time (s) | 287 |
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

### claude-code-1

reward 1 · contract 1 · acceptance 1 · own tests 1 · tokens 2,705,697 · cost $1.64 · agent 400 s · tool errors 4
superpowers active: yes

Failed checks: none
Acceptance: AC1 pass · AC2 pass · AC3 pass · AC4 pass · AC5 pass · AC6 pass · AC7 pass

| Model | Input | Output | Cache read | Cache write | Total | Cost |
|---|---|---|---|---|---|---|
| claude-opus-5-5 | 106 | 24,826 | 2,602,510 | 78,255 | 2,705,697 | $1.64 |

- review requirements 5: Every acceptance criterion (AC1–AC7) is captured in the spec and implemented, including PATCH with null to remove the date, 400 on invalid dates, the UTC overdue rule, and the list-page display, marker and filter.
- review scope 4: The change stays within the ticket; the only extras are the strict 400 for any `overdue` value other than true, which the spec approved, and an injectable clock for the store.
- review tests 4: Tests cover create, change, remove, many invalid dates, the leap day, the UTC overdue boundary with a fixed clock, and the invalid overdue values. The UI is only checked by an HTML regex, with no browser tests; the one edited existing assertion only added `dueDate: null`.
- review conventions 5: The change uses ValidationError for 400s, adds no dependencies, follows TDD, gives new elements data-testid attributes, and matches the existing test helper style.
- review architecture 4: Validation and the overdue logic live in the store and routing stays in app.mjs. The overdue rule is duplicated in the page script, but that follows the spec, which keeps the marker client-side and adds no overdue field.
- review codeQuality 4: The code is clear, and the round-trip check handles impossible dates correctly. Minor edge: the page's `render()` has no handling for fetch errors and can race when the checkbox is toggled quickly.

### claude-code-2

reward 1 · contract 1 · acceptance 1 · own tests 1 · tokens 1,896,754 · cost $1.24 · agent 287 s · tool errors 2
superpowers active: yes

Failed checks: none
Acceptance: AC1 pass · AC2 pass · AC3 pass · AC4 pass · AC5 pass · AC6 pass · AC7 pass

| Model | Input | Output | Cache read | Cache write | Total | Cost |
|---|---|---|---|---|---|---|
| claude-opus-5-5 | 80 | 20,077 | 1,817,631 | 58,966 | 1,896,754 | $1.24 |

- review requirements 5: All seven acceptance criteria are covered by the spec and the diff, including the edge cases (today is not overdue, done todos are not overdue, and a PATCH with null removes the date).
- review scope 4: The change stays within the ticket; the only addition is the 400 for invalid overdue values, which the spec approved, and the injectable `today` is a small testability hook.
- review tests 4: The tests cover validation, the overdue edge cases and the filter, and the existing deepEqual was updated rather than weakened; the UI is only checked by regex on the HTML source, and the agent's Playwright run is not part of the suite.
- review conventions 5: The change follows AGENTS.md: no dependencies, `ValidationError` for 400s, tests written first, and `data-testid` on every new element.
- review architecture 4: Validation and the derived `overdue` flag live in the store, the app only parses the query parameter, and the `view` helper is reused; the UI refactor into `render` and `span` is reasonable.
- review codeQuality 4: The code is clean and the date validation is robust, with a round-trip check that catches 30 February; the PATCH can change the title before a 400 on the date, and the render fetch has no error handling, which is minor.

### claude-code-3

reward 1 · contract 1 · acceptance 1 · own tests 1 · tokens 2,640,787 · cost $1.49 · agent 280 s · tool errors 4
superpowers active: yes

Failed checks: none
Acceptance: AC1 pass · AC2 pass · AC3 pass · AC4 pass · AC5 pass · AC6 pass · AC7 pass

| Model | Input | Output | Cache read | Cache write | Total | Cost |
|---|---|---|---|---|---|---|
| claude-opus-5-5 | 104 | 23,654 | 2,553,742 | 63,287 | 2,640,787 | $1.49 |

- review requirements 5: All seven acceptance criteria are covered by the spec and the diff, including the 400 cases, the UTC overdue rule, the date and marker display, and the filter control.
- review scope 4: The change stays within the ticket. The one extra is the fix so a rejected POST no longer consumes an ID, which the summary mentions. The 400 on invalid `overdue` filter values is in the approved spec.
- review tests 4: The tests cover create, change, remove, invalid dates, leap year, clock injection, done todos, the filter and invalid filter values. The only existing test touched was updated for the new fields. The UI has no automated test and relies on the agent's manual Playwright run. No test covers a PATCH with a valid `done` and an invalid `dueDate`.
- review conventions 4: It uses `ValidationError`, adds `data-testid` attributes, has no dependencies, and follows the repository's test style and TDD flow. Comments are short and fit the surrounding code.
- review architecture 4: Date validation and the derived `overdue` flag live in the store, and the clock is injectable. The route handler filters the store's list result. A store-level filter would have been tidier but isn't needed.
- review codeQuality 3: The code is readable, but `update` applies `done` before validating `dueDate`. A PATCH with a valid `done` and an invalid `dueDate` returns 400 but still changes `done`. The date check also does redundant `Date.parse` and `toISOString` work.
