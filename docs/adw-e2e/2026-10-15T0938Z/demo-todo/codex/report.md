# E2E demo-todo · codex

Model: `openai/gpt-6.1-sol` · verifier `claude-sonnet-5-5` · review `claude-sonnet-5-5` · adw 0.25.0 (b408a44) · trials: 3

Verifier calibration: `2026-10-12T1659Z` (verifier hash cf30252)

## Summary

| Signal | Value |
|---|---|
| reward rate | 1 |
| median tokens | 2,359,174 |
| median cost (USD) | $0.72 |
| median agent time (s) | 497 |
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

### codex-1

reward 1 · contract 1 · acceptance 1 · own tests 1 · tokens 2,359,174 · cost $0.72 · agent 583 s · tool errors 0
superpowers active: yes

Failed checks: none
Acceptance: AC1 pass · AC2 pass · AC3 pass · AC4 pass · AC5 pass · AC6 pass · AC7 pass

| Model | Input | Output | Cache read | Cache write | Total | Cost |
|---|---|---|---|---|---|---|
| gpt-6.1-sol | 138,073 | 22,573 | 2,198,528 | 0 | 2,359,174 | $0.72 |

- review requirements 5: All seven acceptance criteria are covered in the spec and the diff: optional date, change and removal, 400 on invalid dates, the overdue filter, date display, the "überfällig" label and the "nur überfällige" checkbox.
- review scope 4: The change stays on the ticket, but it also adds a `.worktrees/` entry to `.gitignore` and commits a long plan document with execution notes, which the ticket did not ask for.
- review tests 4: Store and HTTP tests are thorough, covering UTC midnight, leap years, invalid types, atomic PATCH and filter order, and no existing test was weakened. The UI is only checked by a regex on the checkbox markup, with no automated test of the date or overdue rendering.
- review conventions 4: It uses `ValidationError`, adds `data-testid` attributes, has no new dependencies and follows the TDD flow, though the plan doc and the `.gitignore` edit add repository clutter.
- review architecture 5: Logic sits in the store, with an injected clock and derived status computed on read. The route filters in one place, and the page reuses the API filter.
- review codeQuality 4: The validation is correct, PATCH checks everything before it mutates, and a request counter stops stale responses overwriting newer ones. The page still has no handling for failed fetches, and `get` computes today separately from `list`, which is a minor inconsistency.

### codex-2

reward 1 · contract 1 · acceptance 1 · own tests 1 · tokens 2,433,141 · cost $0.72 · agent 491 s · tool errors 0
superpowers active: yes

Failed checks: none
Acceptance: AC1 pass · AC2 pass · AC3 pass · AC4 pass · AC5 pass · AC6 pass · AC7 pass

| Model | Input | Output | Cache read | Cache write | Total | Cost |
|---|---|---|---|---|---|---|
| gpt-6.1-sol | 94,385 | 18,363 | 2,091,008 | 0 | 2,203,756 | $0.58 |
| gpt-6-sol | 34,284 | 2,973 | 192,128 | 0 | 229,385 | $0.14 |

- review requirements 5: The spec and diff cover all seven acceptance criteria: optional date, change and removal, HTTP 400 on invalid dates, the overdue API filter, date display, the 'überfällig' marker, and the 'nur überfällige' control.
- review scope 4: The change stays on the feature. It adds an error element, stale-response handling and a plan doc, which are small extras, and the plan doc is arguably clutter.
- review tests 4: The store and API tests are thorough and cover calendar validation, atomic patches, UTC boundaries and filtering. The existing test was only updated for the new fields, and the UI has no automated test in the repo, only manual Playwright checks.
- review conventions 4: The change uses ValidationError, data-testid, zero dependencies and node:test. The Playwright checks were not saved as repo tests, which AGENTS.md does not require.
- review architecture 4: Validation and derived state sit in the store, the app does the filtering, and the page reuses the existing structure. The filter lives in app.mjs rather than the store, which is acceptable.
- review codeQuality 4: Date validation is strict, patches are applied atomically and stale responses are guarded. The validateDueDate check is slightly redundant, and the missing-todo path in snapshot(undefined) is handled.

### codex-3

reward 1 · contract 1 · acceptance 1 · own tests 1 · tokens 2,091,504 · cost $0.60 · agent 497 s · tool errors 0
superpowers active: yes

Failed checks: none
Acceptance: AC1 pass · AC2 pass · AC3 pass · AC4 pass · AC5 pass · AC6 pass · AC7 pass

| Model | Input | Output | Cache read | Cache write | Total | Cost |
|---|---|---|---|---|---|---|
| gpt-6.1-sol | 110,719 | 17,777 | 1,963,008 | 0 | 2,091,504 | $0.60 |

- review requirements 5: All seven acceptance criteria are covered by the diff, and the spec adds clear detail (UTC boundary, null to remove, HTTP 400, filter checkbox).
- review scope 4: The change stays on topic; the stale-response guard in the UI and the exposed `overdue` field on every response go slightly beyond the ticket but are small and justified.
- review tests 4: Store, API and UI tests cover UTC boundaries, validation, atomic rejection and filter races, and the one existing assertion was only extended; the UI test uses a hand-rolled fake DOM, which is brittle, and the checkbox label is never asserted.
- review conventions 5: The change uses ValidationError mapped to HTTP 400, adds data-testid on the new elements, uses no dependencies, and follows the existing test style.
- review architecture 4: Validation and the overdue computation sit in the store and the filter in the route, which fits, though the filtering is done in app.mjs rather than the store.
- review codeQuality 4: The code is clean: validation runs before any mutation, and the round-trip date check handles leap years. A fetch error or non-OK response in the UI is unhandled, and `overdue=true` is the only value the filter recognises.
