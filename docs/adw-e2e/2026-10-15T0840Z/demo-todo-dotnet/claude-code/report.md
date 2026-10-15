# E2E demo-todo-dotnet · claude-code

Model: `claude-opus-5-5` · verifier `claude-sonnet-5-5` · review `claude-sonnet-5-5` · adw 0.25.0 (b408a44) · trials: 3

Verifier calibration: `2026-10-13T1704Z` (verifier hash cf30252)

## Summary

| Signal | Value |
|---|---|
| reward rate | 1 |
| median tokens | 3,640,145 |
| median cost (USD) | $2.14 |
| median agent time (s) | 428 |
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

### claude-code-1

reward 1 · contract 1 · acceptance 1 · own tests 1 · tokens 3,640,145 · cost $2.14 · agent 428 s · tool errors 1
superpowers active: yes

Failed checks: none
Acceptance: AC1 pass · AC2 pass · AC3 pass · AC4 pass · AC5 pass · AC6 pass · AC7 pass

| Model | Input | Output | Cache read | Cache write | Total | Cost |
|---|---|---|---|---|---|---|
| claude-opus-5-5 | 106 | 30,364 | 3,506,282 | 103,393 | 3,640,145 | $2.14 |

- review requirements 5: All seven acceptance criteria are covered by the spec and the diff, including PATCH semantics for missing, null and set values, the 400 cases, and the date-only 'due today is not overdue' edge.
- review scope 4: The change stays close to the ticket. The `overdue=false` filter and the parameterless TodoStore constructor are small additions, and the spec approved the former.
- review tests 4: Store, API and page tests cover the new behaviour, including boundary dates, PATCH semantics and whitespace. The only weakening is that the existing JSON-shape assertion was updated for the new field. The UI filter checkbox toggle has no automated test.
- review conventions 4: The change follows AGENTS.md: ValidationException maps to 400, new data-testids were added, no packages were added, and tests were written. The parameterless TodoStore constructor exists only for tests, and the `@preservewhitespace` workaround is a mild deviation from the existing style.
- review architecture 4: Logic stays in TodoStore, the page calls the store directly, and the time source goes through the TimeProvider abstraction. The raw JsonElement in TodoPatch leaks JSON handling into the domain record.
- review codeQuality 4: The code is readable and handles edge cases such as strict parsing, UTC and null. A few details are awkward: `onlyOverdue ? true : null`, the dual constructor, and an unvalidated `overdue` query binding that relies on framework behaviour.

### claude-code-2

reward 1 · contract 1 · acceptance 1 · own tests 1 · tokens 2,985,691 · cost $1.92 · agent 392 s · tool errors 2
superpowers active: yes

Failed checks: none
Acceptance: AC1 pass · AC2 pass · AC3 pass · AC4 pass · AC5 pass · AC6 pass · AC7 pass

| Model | Input | Output | Cache read | Cache write | Total | Cost |
|---|---|---|---|---|---|---|
| claude-opus-5-5 | 90 | 28,148 | 2,858,983 | 98,470 | 2,985,691 | $1.92 |

- review requirements 5: All seven acceptance criteria are covered by the spec and the diff, including the PATCH omit-vs-null semantics and the UTC clock via TimeProvider.
- review scope 4: The change stays on the ticket. The only extras are the `overdue` query-value validation and the TimeProvider registration, which the spec itself called for.
- review tests 4: Store, API and page tests cover the new behaviour, including the UTC edge case, and the one changed existing assertion only adds `dueDate`. Gaps: no test uses an impossible date like 30 February (it uses month 13), and the filter checkbox is only checked for presence in the markup.
- review conventions 4: The change follows the conventions: new elements carry a `data-testid`, there are no new packages, and the page calls the store directly. The 400 errors for invalid dates rely on the existing bad-request handler rather than `ValidationException`, which is reasonable but is not checked against AGENTS.md's stated mapping.
- review architecture 4: Overdue logic lives in `TodoStore` and is reused by the API and the page. The extra parameterless constructor and the `HasDueDate` flag on the patch record add some complexity.
- review codeQuality 4: The code is readable and handles the edge cases: UTC date, null-vs-omitted, and the Blazor whitespace issue. The `field` keyword with an init-flag property is a bit clever, and the `" · "` separators are a workaround.

### claude-code-3

reward 1 · contract 1 · acceptance 1 · own tests 1 · tokens 6,598,356 · cost $3.34 · agent 701 s · tool errors 9
superpowers active: yes

Failed checks: none
Acceptance: AC1 pass · AC2 pass · AC3 pass · AC4 pass · AC5 pass · AC6 pass · AC7 pass

| Model | Input | Output | Cache read | Cache write | Total | Cost |
|---|---|---|---|---|---|---|
| claude-opus-5-5 | 156 | 48,820 | 6,121,470 | 113,702 | 6,284,148 | $3.11 |
| claude-sonnet-5-5 | 24 | 4,806 | 249,415 | 62,696 | 316,941 | $0.23 |

- review requirements 5: All seven acceptance criteria are covered by the spec and the diff, including PATCH null versus missing, UTC day boundary, 400 on invalid dates, the `?overdue` filter, and the German date display with the 'überfällig' marker and 'nur überfällige' checkbox.
- review scope 4: The diff stays on the ticket; the only extras are the `?overdue=false` filter and the explicit-whitespace test, which the spec approves or which fixes a real rendering bug, plus the plan and spec docs.
- review tests 4: New tests cover set, change, clear and keep on PATCH, invalid-date theories, a rejected PATCH leaving the todo unchanged, the UTC day boundary, the filters and the page markup, and the one existing test that changed was only adjusted for the new JSON shape; the checkbox toggle is not tested automatically and was checked only in the manual end-to-end run.
- review conventions 4: The change follows the repo's TDD, `data-testid`, no-new-packages and xUnit idioms, but invalid dates return the binder's generic 400 message rather than a `ValidationException` from `TodoStore`, which `AGENTS.md` names as the convention.
- review architecture 5: The overdue rule lives once in `Todo.IsOverdue`, `TodoStore` owns the injected `TimeProvider`, and both the API and `Home.razor` reuse it, with the page calling the store directly as `AGENTS.md` requires.
- review codeQuality 4: The code is compact and handles the edge cases (null versus missing in PATCH, UTC, strict `DateOnly` parsing), though the `HasDueDate` init-setter trick is a little subtle and `TodoResponse` is declared after the top-level statements in `Program.cs`.
