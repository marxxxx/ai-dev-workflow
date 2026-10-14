# E2E demo-todo-dotnet · codex

Model: `openai/gpt-6.1-sol` · verifier `claude-sonnet-5-5` · review `claude-sonnet-5-5` · adw 0.25.0 (ff0376f) · trials: 3

Verifier calibration: `2026-10-13T1704Z` (verifier hash cf30252)

## Summary

| Signal | Value |
|---|---|
| reward rate | 0.33 |
| median tokens | 6,811,775 |
| median agent time (s) | 2,339 |
| review requirements (median) | 5 |
| review scope (median) | 4 |
| review tests (median) | 4 |
| review conventions (median) | 4 |
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
| summary_comment | 0.33 |
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

reward 0 · contract 0.9231 · acceptance 1 · own tests 1 · tokens 6,811,775 · agent 2,339 s · tool errors 0
superpowers active: yes

Failed checks: summary_comment
Acceptance: AC1 pass · AC2 pass · AC3 pass · AC4 pass · AC5 pass · AC6 pass · AC7 pass

- review requirements 5: The spec and diff cover all seven acceptance criteria and go further on PATCH missing-versus-null, boundary dates and UTC rollover.
- review scope 4: The code changes stay in scope; the only extras are the committed spec and plan docs and a shared test clock helper.
- review tests 4: Store, API and page tests are thorough, covering invalid dates without mutation, UTC midnight and the filter, and no existing tests were weakened. The checkbox toggle is only checked in the manual E2E run, not in an automated test.
- review conventions 5: The change follows AGENTS.md: ValidationException from the store, mapped to 400 by the existing handler, new data-testid attributes, no new packages, tests written first, and the page reads from the store directly.
- review architecture 5: Validation, the overdue rule and filtering live once in TodoStore, with an injected TimeProvider; the API and page reuse it and Program.cs only binds the query parameter.
- review codeQuality 4: The code is compact and correct, with validation before the lock and a fresh overdue calculation on every read. The PATCH presence flag set in an init accessor is slightly clever but works and is tested.

### codex-2

reward 1 · contract 1 · acceptance 1 · own tests 1 · tokens 4,858,775 · agent 1,818 s · tool errors 0
superpowers active: yes

Failed checks: none
Acceptance: AC1 pass · AC2 pass · AC3 pass · AC4 pass · AC5 pass · AC6 pass · AC7 pass

- review requirements 5: The spec and diff cover all seven acceptance criteria, including the PATCH missing-versus-null distinction, UTC overdue rules and the exact UI texts.
- review scope 4: The code changes stay on the ticket; the only extras are the spec and plan documents added under docs/, and the extra overdue=false filter, which the approved spec asks for.
- review tests 4: Store, API and prerender tests are thorough and no existing tests were weakened; the interactive checkbox filtering and the page's toggle behaviour have no automated test, only manual Playwright runs.
- review conventions 4: The change follows the ValidationException pattern, data-testid usage, TDD and adds no new packages; it does not update the AGENTS.md locators list for the new test IDs.
- review architecture 5: Validation, overdue computation and filtering all live in TodoStore, the page and API reuse List(overdue), and the clock is injected through TimeProvider.
- review codeQuality 4: The code is clean and atomic, validating before it mutates, but the HasDueDate flag set inside an init setter is slightly subtle, and Todo carries a computed IsOverdue init property that every snapshot has to populate.

### codex-3

reward 0 · contract 0.9231 · acceptance 1 · own tests 1 · tokens 7,830,755 · agent 2,583 s · tool errors 0
superpowers active: yes

Failed checks: summary_comment
Acceptance: AC1 pass · AC2 pass · AC3 pass · AC4 pass · AC5 pass · AC6 pass · AC7 pass

- review requirements 5: The spec and diff cover all seven acceptance criteria: optional date on create, PATCH set/replace/clear, 400 on invalid dates, the overdue API filter, date display, the 'überfällig' marker, and the 'nur überfällige' checkbox. They also add edge cases such as the UTC midnight crossing.
- review scope 4: The product code stays within the ticket, but the diff adds plan and spec documents under docs/ and an extra DatePatchForUnknownId test, which are small extras.
- review tests 4: Store, API and prerendered page tests are thorough, including a controlled clock, PATCH omitted-vs-null and no-mutation cases, and no tests were weakened. The checkbox's interactive filtering is only checked by manual E2E, not an automated test.
- review conventions 4: The change follows TDD, uses data-testid attributes, ValidationException and the existing 400 handling, and adds no packages. AGENTS.md's list of locators was not updated with the three new data-testids.
- review architecture 5: Overdue computation and filtering sit in the shared singleton store behind an injected TimeProvider, Home.razor calls the store directly, and the API and page reuse the same List(overdue) method.
- review codeQuality 4: The code is clear, takes one clock read per call, and keeps computed IsOverdue out of stored state. The HasDueDate presence-tracking init hack on TodoPatch is slightly subtle but tested.
