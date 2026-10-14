# E2E demo-todo-dotnet · opencode

Model: `mistral/mistral-large-4` · verifier `claude-sonnet-5-5` · review `claude-sonnet-5-5` · adw 0.25.0 (8795ced) · trials: 3

Verifier calibration: `2026-10-13T1704Z` (verifier hash cf30252)

## Summary

| Signal | Value |
|---|---|
| reward rate | 0 |
| median tokens | 1,767,315 |
| median cost (USD) | $0.26 |
| median agent time (s) | 576 |
| review requirements (median) | 4 |
| review scope (median) | 4 |
| review tests (median) | 3 |
| review conventions (median) | 3 |
| review architecture (median) | 3 |
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
| acceptance | 0.67 |
| ownTests | 1 |
| ac:AC1 | 1 |
| ac:AC2 | 1 |
| ac:AC3 | 0.67 |
| ac:AC4 | 1 |
| ac:AC5 | 1 |
| ac:AC6 | 1 |
| ac:AC7 | 1 |

## Trials

### opencode-1

reward 0 · contract 0.9231 · acceptance 0.857 · own tests 1 · tokens 1,509,845 · cost $0.26 · agent 576 s · tool errors 0
superpowers active: no

Failed checks: e2e_performed
Acceptance: AC1 pass · AC2 pass · AC3 fail · AC4 pass · AC5 pass · AC6 pass · AC7 pass

| Model | Input | Output | Cache read | Cache write | Total | Cost |
|---|---|---|---|---|---|---|
| mistral-large-4 | 195,058 | 17,083 | 1,297,704 | 0 | 1,509,845 | $0.26 |

- review requirements 4: The spec and diff cover all seven ACs, but the spec says PUT while the API uses PATCH, and it doesn't pin down the 30 February case or the date's wire format.
- review scope 4: The change stays on the feature; the hand-written JSON parsing, which loosens validation of title and done, and the plan and spec files are side effects of the chosen design.
- review tests 3: Store, API and prerendered page tests cover most behaviour, but there is no test for an impossible date such as 30 February or a non-string dueDate, and the live filter toggle is untested. No existing tests were weakened.
- review conventions 4: It uses ValidationException for 400s, data-testid on the new elements, and xUnit tests in the existing style; the manual JsonElement parsing departs from the repo's typed-binding idiom.
- review architecture 3: The overdue logic is shared in TodoStore.IsOverdue, but hand-parsing request bodies in Program.cs and the tri-state TodoPatch with a secondary constructor are heavier than needed. An anonymous-object ToDto helper also sits in Program.cs.
- review codeQuality 3: The `when` guards silently ignore a dueDate of the wrong type, such as a number, instead of returning 400, which breaks AC3. A non-object body would likely cause a 500, and the response serializes dueDate as a full UTC timestamp rather than a plain date.

### opencode-2

reward 0 · contract 0.9231 · acceptance 1 · own tests 1 · tokens 1,767,315 · cost $0.26 · agent 511 s · tool errors 0
superpowers active: no

Failed checks: e2e_performed
Acceptance: AC1 pass · AC2 pass · AC3 pass · AC4 pass · AC5 pass · AC6 pass · AC7 pass

| Model | Input | Output | Cache read | Cache write | Total | Cost |
|---|---|---|---|---|---|---|
| mistral-large-4 | 170,726 | 16,853 | 1,579,736 | 0 | 1,767,315 | $0.26 |

- review requirements 4: All seven acceptance criteria are covered in the spec and the diff, but the spec says nothing about the 400 body shape for POST, where `DateOnly?` binding errors don't go through the `ValidationException` path.
- review scope 4: The change stays on the feature; the only extras are the plan and spec docs under docs/, which are low-risk.
- review tests 3: The store, API and page tests are good and no existing test was weakened. The 'nur überfällige' toggle behaviour has no test, the POST 400 tests check only the status code, and the PATCH tests never cover a non-object body.
- review conventions 3: AGENTS.md says `TodoStore` throws `ValidationException`, but the date validation lives in `Program.cs`'s `ParsePatch`. POST relies on JSON binding errors instead, so its 400 body may not be the `{"error": ...}` shape.
- review architecture 3: The hand-rolled `JsonElement` parser in `Program.cs`, plus a `DueDateSet` flag on `TodoPatch`, puts parsing and validation in the wrong layer. The two input paths also validate differently: POST uses framework binding, PATCH uses `TryParseExact`.
- review codeQuality 3: `ParsePatch` throws `InvalidOperationException`, giving a 500, when the body isn't a JSON object, because `TryGetProperty` is called on a non-object. It also silently ignores wrongly typed `title` and `done` values, and POST and PATCH accept different date formats.

### opencode-3

reward 0 · contract 0.9231 · acceptance 1 · own tests 1 · tokens 4,297,175 · cost $0.61 · agent 2,392 s · tool errors 0
superpowers active: no

Failed checks: e2e_performed
Acceptance: AC1 pass · AC2 pass · AC3 pass · AC4 pass · AC5 pass · AC6 pass · AC7 pass

| Model | Input | Output | Cache read | Cache write | Total | Cost |
|---|---|---|---|---|---|---|
| mistral-large-4 | 330,042 | 54,181 | 3,912,952 | 0 | 4,297,175 | $0.61 |

- review requirements 4: The spec and diff cover AC1–AC7 (optional date, set/change/remove, 400 on invalid dates, overdue filter, display, marker, toggle); the spec's PATCH section is somewhat muddled, but the behaviour is clear.
- review scope 4: The changes stay on the feature; the only extras are the spec and plan markdown files and the extra public factory overloads and test helpers.
- review tests 3: Store and API tests cover the date logic, validation and the overdue filter well, but the page test only checks that the testids and the word appear and never that non-overdue todos lack the marker. The toggle's filtering behaviour is not tested. Existing tests were adapted to the new signatures, not weakened.
- review conventions 3: The code reuses ValidationException and the existing 400 middleware and uses German UI text and testids as the spec asks, but the `NewTodo.Of` factory workaround and the `default` JsonElement arguments in tests depart from the plain record style used before.
- review architecture 3: The clock and the overdue predicate sit in TodoStore and the page reads the store directly, which fits. Using raw JsonElement in the public DTO records, with TodoJson and ToElement helpers living in production code mainly to serve tests, is a leaky and awkward design.
- review codeQuality 3: The behaviour is correct at the edges (strict format, UTC today, null versus missing), but the JsonElement-based records with overloaded Of factories are needlessly complex, and the JsonException catch could mask unrelated errors.
