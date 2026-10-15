# E2E demo-todo-dotnet · opencode

Model: `mistral/mistral-large-4` · verifier `claude-sonnet-5-5` · review `claude-sonnet-5-5` · adw 0.25.0 (e886701) · trials: 3

Verifier calibration: `2026-10-13T1704Z` (verifier hash cf30252)

## Summary

| Signal | Value |
|---|---|
| reward rate | 0 |
| median tokens | 1,476,328 |
| median cost (USD) | $0.20 |
| median agent time (s) | 386 |
| review requirements (median) | 4 |
| review scope (median) | 4 |
| review tests (median) | 3 |
| review conventions (median) | 3 |
| review architecture (median) | 4 |
| review codeQuality (median) | 3 |
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

reward 0 · contract 0.9231 · acceptance 1 · own tests 1 · tokens 1,489,982 · cost $0.21 · agent 386 s · tool errors 0
superpowers active: no

Failed checks: e2e_performed
Acceptance: AC1 pass · AC2 pass · AC3 pass · AC4 pass · AC5 pass · AC6 pass · AC7 pass

| Model | Input | Output | Cache read | Cache write | Total | Cost |
|---|---|---|---|---|---|---|
| mistral-large-4 | 119,857 | 16,513 | 1,353,612 | 0 | 1,489,982 | $0.21 |

- review requirements 4: All seven ACs are implemented, but the posted spec said `null` removes the date and the implementation needs a separate `clearDueDate` flag, and the spec's `ValidationException` plan was dropped.
- review scope 4: Changes stay on the ticket; the extra `ClearDueDate` field and the committed spec file are minor additions.
- review tests 3: Store and API tests are good, covering the due-today boundary and done todos. Nothing tests the 'überfällig' marker or the toggle filtering on the page. The one existing test was changed only for the new field.
- review conventions 3: Invalid dates are rejected through the generic bad-request middleware rather than `ValidationException` thrown by `TodoStore`, which AGENTS.md and the spec require. New `data-testid`s are present.
- review architecture 4: Logic sits in `TodoStore` and is reused by the API and the page. `IsOverdue` is an instance method that doesn't need instance state.
- review codeQuality 3: The code is compact and readable. Sending `dueDate: null` in a PATCH silently does nothing, and `DateTime.UtcNow` is evaluated per call, so a list can disagree with itself at midnight.

### opencode-2

reward 0 · contract 0.9231 · acceptance 1 · own tests 1 · tokens 1,476,328 · cost $0.20 · agent 366 s · tool errors 0
superpowers active: no

Failed checks: e2e_performed
Acceptance: AC1 pass · AC2 pass · AC3 pass · AC4 pass · AC5 pass · AC6 pass · AC7 pass

| Model | Input | Output | Cache read | Cache write | Total | Cost |
|---|---|---|---|---|---|---|
| mistral-large-4 | 107,885 | 15,443 | 1,353,000 | 0 | 1,476,328 | $0.20 |

- review requirements 4: All seven acceptance criteria are covered, but a non-string `dueDate` in PATCH is silently ignored instead of rejected with 400.
- review scope 3: The `Done` flag added to `NewTodo` was not requested and exists only to make tests convenient.
- review tests 3: Store, API and prerender tests were added and none were weakened, but nothing tests that the toggle filters the list, 400 for PATCH, or a body that is not a JSON object.
- review conventions 3: AGENTS.md says `TodoStore` throws `ValidationException`, but the date parsing and its throw are in `Program.cs`. POST 400s come from framework binding and likely lack the `{"error"}` body.
- review architecture 2: The overdue rule is duplicated in `Home.razor` and `TodoStore`. Hand-written JSON parsing in the PATCH endpoint replaces record binding, and the `ClearDueDate` flag leaks the absent-vs-null workaround into the model.
- review codeQuality 2: The PATCH handler is fragile: a non-object body makes `TryGetProperty` throw a 500, wrongly typed fields are silently ignored, and the parsing is verbose.

### opencode-3

reward 0 · contract 0.9231 · acceptance 1 · own tests 1 · tokens 1,333,974 · cost $0.18 · agent 571 s · tool errors 0
superpowers active: no

Failed checks: e2e_performed
Acceptance: AC1 pass · AC2 pass · AC3 pass · AC4 pass · AC5 pass · AC6 pass · AC7 pass

| Model | Input | Output | Cache read | Cache write | Total | Cost |
|---|---|---|---|---|---|---|
| mistral-large-4 | 102,971 | 11,575 | 1,219,428 | 0 | 1,333,974 | $0.18 |

- review requirements 4: All seven acceptance criteria are covered by the spec and the diff, but the spec leaves the remove mechanism (`clearDueDate`) open and does not explicitly pin AC3 for an impossible date on PATCH.
- review scope 5: The change is limited to due date, overdue filtering and display; the only extra is the spec file, which the workflow calls for.
- review tests 3: There are store, API and page tests, but none covers the 'due today is not overdue' boundary, the PATCH 30 February case, or the client-side toggle. The page test's 'überfällig' assertion is also satisfied by the 'nur überfällige' label, and it never checks that the normal todo is unmarked.
- review conventions 4: The change follows the data-testid, no-new-packages and TDD conventions, and reuses the existing 400 mapping for invalid dates; the only gap is that the new filter and PATCH-date tests are missing from the tests it names.
- review architecture 4: Overdue logic is centralised in the static `TodoStore.IsOverdue` and shared by the API and the page, and the page still calls the store directly; the 'today UTC' computation is duplicated in Program.cs and Home.razor.
- review codeQuality 4: The code is small and readable and handles the set, change and clear cases correctly. `Store.List()` is called repeatedly and `DateTime.UtcNow` is read per call, but this is minor.
