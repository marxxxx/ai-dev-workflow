# E2E demo-todo-dotnet · codex

Model: `openai/gpt-6.1-sol` · verifier `claude-sonnet-5-5` · review `claude-sonnet-5-5` · adw 0.25.0 (b408a44) · trials: 3

Verifier calibration: `2026-10-13T1704Z` (verifier hash cf30252)

## Summary

| Signal | Value |
|---|---|
| reward rate | 1 |
| median tokens | 3,827,519 |
| median cost (USD) | $0.97 |
| median agent time (s) | 1,969 |
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

### codex-1

reward 1 · contract 1 · acceptance 1 · own tests 1 · tokens 3,827,519 · cost $0.97 · agent 1,969 s · tool errors 0
superpowers active: yes

Failed checks: none
Acceptance: AC1 pass · AC2 pass · AC3 pass · AC4 pass · AC5 pass · AC6 pass · AC7 pass

| Model | Input | Output | Cache read | Cache write | Total | Cost |
|---|---|---|---|---|---|---|
| gpt-6.1-sol | 156,995 | 29,308 | 3,641,216 | 0 | 3,827,519 | $0.97 |

- review requirements 5: The spec and diff cover AC1–AC7, and the spec also settles the PATCH omit/null semantics and the `overdue=false` case.
- review scope 4: The code changes stay within the ticket; the only extras are the plan and spec docs, plus a public `Today` property that the page needs.
- review tests 4: The tests are thorough on API validation, atomicity, UTC boundaries and prerendered markup, and no existing tests were weakened. The checkbox toggle is not covered by an automated test; it was only checked manually with Playwright.
- review conventions 4: The change follows AGENTS.md: `ValidationException` thrown in the store, `data-testid` on new elements, no new packages, and the page uses the store directly. AGENTS.md's list of test ids was not updated.
- review architecture 4: Validation and the overdue rule sit in the store and `Todo`, and both the API and the page reuse them with an injected `TimeProvider`. The `DueDateSpecified` mechanism on `TodoPatch` is somewhat indirect.
- review codeQuality 4: The code is readable, parses dates strictly and applies updates atomically. The `init` accessor that sets a flag is a subtle trick, though it has a comment and is tested.

### codex-2

reward 1 · contract 1 · acceptance 1 · own tests 1 · tokens 5,311,853 · cost $1.27 · agent 2,082 s · tool errors 0
superpowers active: yes

Failed checks: none
Acceptance: AC1 pass · AC2 pass · AC3 pass · AC4 pass · AC5 pass · AC6 pass · AC7 pass

| Model | Input | Output | Cache read | Cache write | Total | Cost |
|---|---|---|---|---|---|---|
| gpt-6.1-sol | 170,958 | 41,887 | 5,099,008 | 0 | 5,311,853 | $1.27 |

- review requirements 5: All seven acceptance criteria are covered in the diff, and the spec adds clear edge-case decisions: PATCH omitted versus null, the UTC rule, and HTTP 400 for bad input.
- review scope 4: The change stays on the ticket. Small extras are the `overdue=false` filter, a committed e2e script, plan and spec docs, and a `.gitignore` entry for `.worktrees/`.
- review tests 4: Store, API and prerendered-page tests cover the UTC boundary, PATCH presence, invalid dates, the filter and the controls. Nothing in the .NET suite exercises the interactive create, save and filter-toggle behaviour, and no existing tests were weakened.
- review conventions 5: The change follows AGENTS.md: no new packages, `ValidationException` kept, `data-testid` on new elements, tests under `tests/`, and tests in the existing xUnit and `WebApplicationFactory` style.
- review architecture 4: The overdue rule lives in one place on `Todo` and `TodoStore`, with `TimeProvider` injected. The page calls the store directly, as AGENTS.md requires.
- review codeQuality 3: The core logic is correct and readable. `Home.razor` writes to `_dueDates` while rendering, and the `_editedDueDates` bookkeeping is somewhat fragile. The presence-tracking PATCH record is slightly clunky.

### codex-3

reward 1 · contract 1 · acceptance 1 · own tests 1 · tokens 3,367,195 · cost $0.90 · agent 760 s · tool errors 0
superpowers active: yes

Failed checks: none
Acceptance: AC1 pass · AC2 pass · AC3 pass · AC4 pass · AC5 pass · AC6 pass · AC7 pass

| Model | Input | Output | Cache read | Cache write | Total | Cost |
|---|---|---|---|---|---|---|
| gpt-6.1-sol | 137,406 | 30,301 | 3,199,488 | 0 | 3,367,195 | $0.90 |

- review requirements 5: All seven acceptance criteria are covered by the spec and the diff, including the PATCH cases of omitting the field, setting it and clearing it with null, and the strict UTC overdue rule.
- review scope 4: The product change stays in scope, but the diff also adds a .gitignore entry for .worktrees/ and a committed agent plan document that nobody asked for.
- review tests 5: The store, API and page tests cover valid and invalid dates, the omitted/null/set PATCH cases, the UTC today boundary, done and undated todos, and the filter. The one existing exact-JSON assertion was updated for the new fields, and no tests were removed.
- review conventions 5: Validation uses ValidationException thrown from TodoStore, the new UI elements have data-testid attributes, no packages were added, and the page calls the store directly, all as AGENTS.md requires.
- review architecture 4: Logic stays in the store with a thin route binding and the page reusing List(bool). The init-accessor presence flag on TodoPatch is a somewhat clever way to tell an omitted field from an explicit null, but it is contained.
- review codeQuality 4: Parsing is strict, happens before any mutation, and IsOverdue is computed on read. The only minor drawbacks are the slightly intricate patch-flag pattern and the page's `@(" ")` spacing workaround.
