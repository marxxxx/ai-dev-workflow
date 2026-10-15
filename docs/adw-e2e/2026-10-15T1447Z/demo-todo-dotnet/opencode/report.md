# E2E demo-todo-dotnet · opencode

Model: `mistral/mistral-large-4` · verifier `claude-sonnet-5-5` · review `claude-sonnet-5-5` · adw 0.25.0 (576ccfb) · trials: 3

Verifier calibration: `2026-10-13T1704Z` (verifier hash cf30252)

## Summary

| Signal | Value |
|---|---|
| reward rate | 0.33 |
| median tokens | 4,799,720 |
| median cost (USD) | $0.48 |
| median agent time (s) | 1,005 |
| review requirements (median) | 5 |
| review scope (median) | 4 |
| review tests (median) | 3 |
| review conventions (median) | 4 |
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
| only_allowed_comments | 0.67 |
| pr_draft | 1 |
| branch_naming | 1 |
| pr_title_naming | 1 |
| e2e_performed | 1 |
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

reward 0 · contract 0.9231 · acceptance 1 · own tests 1 · tokens 4,799,720 · cost $0.48 · agent 689 s · tool errors 2
superpowers active: yes

Failed checks: only_allowed_comments
Acceptance: AC1 pass · AC2 pass · AC3 pass · AC4 pass · AC5 pass · AC6 pass · AC7 pass

| Model | Input | Output | Cache read | Cache write | Total | Cost |
|---|---|---|---|---|---|---|
| mistral-large-4 | 173,726 | 19,714 | 4,606,280 | 0 | 4,799,720 | $0.48 |

- review requirements 3: The diff meets all seven ACs, but the approved spec has a non-goal of 'keine Filterung' and never mentions the ?overdue=true API filter or the 'nur überfällige' control (AC4, AC7), and it does not state the 30 February case.
- review scope 4: Changes stay on due dates, the overdue filter and the toggle; the only extras are the plan and spec docs and the new 'alle anzeigen' toggle label.
- review tests 3: Store, API and page-markup tests cover most behaviour and existing tests were adapted without being weakened, but nothing tests the toggle's click behaviour, an impossible date like 30 February, or a PATCH body that isn't a JSON object.
- review conventions 4: It follows the TDD flow, data-testid usage, the ValidationException/400 mapping and the no-new-packages rule, though Program.cs uses long fully-qualified System.Text.Json names inline.
- review architecture 3: Overdue logic sits on Todo and the filter in TodoStore.List, which fits the layout, but the PATCH handler parses the body by hand and uses a public DueDateSet flag, a workaround that leaks into the record and can be set through the JSON body.
- review codeQuality 3: The code is mostly readable, but the PATCH handler is a dense one-liner, a non-object JSON body would make TryGetProperty throw and return 500, and the UTC 'today' computation is repeated in the page and the store.

### opencode-2

reward 1 · contract 1 · acceptance 1 · own tests 1 · tokens 6,695,019 · cost $0.78 · agent 1,005 s · tool errors 3
superpowers active: no

Failed checks: none
Acceptance: AC1 pass · AC2 pass · AC3 pass · AC4 pass · AC5 pass · AC6 pass · AC7 pass

| Model | Input | Output | Cache read | Cache write | Total | Cost |
|---|---|---|---|---|---|---|
| mistral-large-4 | 391,792 | 33,939 | 6,269,288 | 0 | 6,695,019 | $0.78 |

- review requirements 5: The spec and diff cover all seven acceptance criteria, including the date-only format, the 400 cases, the clear-with-null semantics, the UTC overdue rule, the "überfällig" marker and the "nur überfällige" checkbox, and the spec also pins down edge cases such as today and done todos.
- review scope 5: Every change maps to an acceptance criterion or to the spec; the plan and spec docs are the expected artifacts and no extra features were added.
- review tests 4: The new tests cover the store, the API and the prerendered page well, including the boundary and clear-versus-omitted cases, and the existing JSON assertion was only updated for the new field. The checkbox filtering behaviour is untested in the suite, and so are the page cases for a done todo and for no due date.
- review conventions 4: The change follows AGENTS.md: ValidationException for validation errors, data-testid on the new elements, no new packages, and TDD per the plan. Parsing now lives in Program.cs instead of TodoStore, which the spec accepts, but the endpoints grew long inline lambdas.
- review architecture 4: IsOverdue lives on Todo and is shared by the API filter and the page, and the date parsing is a single helper. Hand-parsing the POST and PATCH bodies with JsonDocument duplicates the title and done extraction and replaces model binding, which the spec chose in order to tell null from omitted.
- review codeQuality 3: The date validation and IsOverdue logic are correct. The manual body parsing is fragile: a non-object JSON body such as `[]` makes TryGetProperty throw InvalidOperationException, which gives a 500 where model binding would not. A non-string title or a non-boolean done is also silently ignored, and the PATCH `done` line is dense.

### opencode-3

reward 0 · contract 1 · acceptance 0.857 · own tests 1 · tokens 4,770,733 · cost $0.48 · agent 1,202 s · tool errors 1
superpowers active: no

Failed checks: none
Acceptance: AC1 pass · AC2 pass · AC3 fail · AC4 pass · AC5 pass · AC6 pass · AC7 pass

| Model | Input | Output | Cache read | Cache write | Total | Cost |
|---|---|---|---|---|---|---|
| mistral-large-4 | 164,991 | 21,146 | 4,584,596 | 0 | 4,770,733 | $0.48 |

- review requirements 5: The spec and diff cover all seven acceptance criteria, including the 30 February case, removing the date with null or an empty string, and the strict `<` boundary for overdue.
- review scope 4: The code changes stay within the ticket; the only extras are the spec and plan documents the workflow asks for, and the `todo-overdue` and `todo-due-date` test ids the ticket's UI needs.
- review tests 3: Store and API tests are thorough, but nothing exercises the 'nur überfällige' toggle behaviour (AC7), only that the button is present. Existing tests were adapted to the new record signatures, not weakened.
- review conventions 4: The change follows AGENTS.md: validation lives in `TodoStore` and throws `ValidationException`, new UI elements carry `data-testid`, and test style matches. The inline fully qualified `System.Text.Json` names are slightly off the repo's style.
- review architecture 3: The logic sits in the store and is reused by the API and the page, but `TodoPatch` now carries a `JsonElement`, which leaks JSON concerns into the domain record. `IsOverdue` also re-parses the date string instead of reusing a shared helper.
- review codeQuality 3: The code is readable, but a PATCH with a non-string `dueDate` such as a number makes `GetString()` throw `InvalidOperationException`, giving a 500 instead of a 400. The `DateTime.UtcNow` call is also duplicated across the page.
