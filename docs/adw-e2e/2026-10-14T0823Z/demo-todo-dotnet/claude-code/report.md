# E2E demo-todo-dotnet · claude-code

Model: `claude-opus-5-5` · verifier `claude-sonnet-5-5` · review `claude-sonnet-5-5` · adw 0.25.0 (ff0376f) · trials: 3

Verifier calibration: `2026-10-13T1704Z` (verifier hash cf30252)

## Summary

| Signal | Value |
|---|---|
| reward rate | 1 |
| median tokens | 5,981,768 |
| median agent time (s) | 759 |
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

reward 1 · contract 1 · acceptance 1 · own tests 1 · tokens 5,981,768 · agent 783 s · tool errors 9
superpowers active: yes

Failed checks: none
Acceptance: AC1 pass · AC2 pass · AC3 pass · AC4 pass · AC5 pass · AC6 pass · AC7 pass

- review requirements 5: The spec and diff cover all seven acceptance criteria, including the edge cases of removal via null, leap days, a todo due today, and a done todo.
- review scope 4: The change stays within the ticket; the only extras are the spec and plan docs and a small whitespace-separation test.
- review tests 4: The tests are thorough and use a fake clock, and the one existing assertion was only extended for the new fields. The filter toggle is not tested outside the manual end-to-end run.
- review conventions 5: The change follows AGENTS.md: ValidationException from the store, no new packages, data-testid on new elements, and tests written alongside the code.
- review architecture 5: Validation and the overdue rule live only in TodoStore; the API and page reuse it, and Program.cs changes by a single line.
- review codeQuality 4: The code is clean and the null-versus-absent PATCH handling is sound. The TodoPatch backing-field trick is slightly clever and Overdue is computed on every read, but both are acceptable.

### claude-code-2

reward 1 · contract 1 · acceptance 1 · own tests 1 · tokens 5,448,769 · agent 682 s · tool errors 8
superpowers active: yes

Failed checks: none
Acceptance: AC1 pass · AC2 pass · AC3 pass · AC4 pass · AC5 pass · AC6 pass · AC7 pass

- review requirements 5: The spec and diff cover AC1–AC7 (optional date, change and clear, 400 on invalid dates, UTC overdue rule and filter, date and 'überfällig' on the page, 'nur überfällige' checkbox), and add edge cases such as the due day itself, leap days and a non-string dueDate.
- review scope 4: The code changes stay within the ticket; the only extras are the spec and plan docs under docs/superpowers, and the `?overdue=false` filter value, which the ACs don't ask for.
- review tests 4: Store, API and page tests cover the new behaviour with a fixed clock, including boundary dates and null-versus-missing PATCH, and no existing test was weakened; the checkbox toggle itself has no automated test and was only checked by hand with Playwright.
- review conventions 4: The change follows the conventions (ValidationException from the store, no new packages, data-testid on new elements, tests written first), but AGENTS.md's list of existing data-testids was not updated with the three new ones.
- review architecture 5: The overdue rule and date validation live in TodoStore behind an injected TimeProvider, the page calls the store directly, and the API maps through one TodoResponse helper, matching the layout in AGENTS.md.
- review codeQuality 4: The code is compact and handles edge cases such as strict date parsing, UTC today, and patch semantics for a missing field versus null; the generic Optional<T> converter is a little heavy for one field, and Read uses a null-forgiving `!`.

### claude-code-3

reward 1 · contract 1 · acceptance 1 · own tests 1 · tokens 7,678,433 · agent 759 s · tool errors 7
superpowers active: yes

Failed checks: none
Acceptance: AC1 pass · AC2 pass · AC3 pass · AC4 pass · AC5 pass · AC6 pass · AC7 pass

- review requirements 5: The spec and diff cover AC1–AC7 and add edge cases the ACs only imply: set, clear and keep on PATCH, 30 February, empty or time-bearing strings, today and done boundaries, and UTC.
- review scope 4: Everything traces to the ticket; the plan and spec docs and the `@preservewhitespace` change are justified by the E2E finding, but the extra whitespace test and docs add a little beyond the minimum.
- review tests 4: Store, API and page behaviour are well covered with boundary cases and the one existing test was only updated for the new JSON shape; the filter checkbox's interactive behaviour has no automated test and relies on the manual E2E run.
- review conventions 4: Follows TDD, adds data-testids, adds no packages and uses the existing 400 handling; AGENTS.md was not updated with the new testids, and the validation errors come from JSON binding rather than ValidationException, which the spec chose deliberately.
- review architecture 5: The overdue rule lives in TodoStore with an injected TimeProvider, the API maps through a TodoResponse, and the page calls the store directly as AGENTS.md requires.
- review codeQuality 4: The code is small and clear, with UTC handling, InvariantCulture and the lock kept; the generic Optional converter uses `!` on null deserialization and reflection, which is acceptable here but slightly heavy.
