# E2E demo-todo-dotnet · claude-code

Model: `claude-opus-5-5` · verifier `claude-sonnet-5-5` · review `claude-sonnet-5-5` · adw 0.28.0 (e440089) · trials: 3

Verifier calibration: `2026-10-13T1704Z` (verifier hash cf30252)

## Summary

| Signal | Value |
|---|---|
| reward rate | 1 |
| median tokens | 6,251,527 |
| median cost (USD) | $3.42 |
| median agent time (s) | 770 |
| review requirements (median) | 5 |
| review scope (median) | 4 |
| review tests (median) | 4 |
| review conventions (median) | 5 |
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

## MCP usage

Information only, never a check: every configured server, used or not.

| Server | Trials using | Calls |
|---|---|---|
| serena | 0/3 | 0 |
| playwright | 3/3 | 65 |
| context7 | 0/3 | 0 |

## Trials

### claude-code-1

reward 1 · contract 1 · acceptance 1 · own tests 1 · tokens 6,604,935 · cost $3.79 · agent 822 s · tool errors 7
superpowers active: yes
MCP: serena 0 · playwright 22 (browser_evaluate 6, browser_wait_for 5, browser_take_screenshot 5, browser_navigate 3, browser_click 2, browser_close 1) · context7 0
built-in: Bash 46, Edit 19, Read 11, Write 7, Skill 6, ToolSearch 4, Agent 1

Failed checks: none
Acceptance: AC1 pass · AC2 pass · AC3 pass · AC4 pass · AC5 pass · AC6 pass · AC7 pass

| Model | Input | Output | Cache read | Cache write | Total | Cost |
|---|---|---|---|---|---|---|
| claude-opus-5-5 | 136 | 56,266 | 6,262,380 | 156,970 | 6,475,752 | $3.63 |
| claude-sonnet-5-5 | 10 | 3,941 | 83,166 | 42,066 | 129,183 | $0.15 |

- review requirements 5: All seven acceptance criteria are covered by the spec and the diff, including the boundary cases (due today, done, no date, `PATCH` with `null`, and a 400 for an invalid date or a non-boolean filter).
- review scope 4: The change stays on the ticket; the plan and spec documents and the `AGENTS.md` locator update follow the repo's workflow, and the only extras are a small `UsesTheRegisteredClock` test and the `FixedTimeProvider` helper.
- review tests 4: The tests cover the boundary, the UTC clock, `PATCH` semantics, the filter, the 400 cases and the page output, and no existing test was weakened (only the one JSON expectation was updated); the interactive filter checkbox is only checked by hand in E2E.
- review conventions 5: The change follows `AGENTS.md`: `ValidationException` thrown in the store, no new packages, `data-testid` on every new element, tests written first, and the locators documented.
- review architecture 5: The overdue rule lives once in `Todo.IsOverdue`, the API and the page share it, the store owns parsing and the clock, and `TodoView` keeps the computed `overdue` out of the stored record.
- review codeQuality 4: The code is clean and handles the edge cases; the `@(" ")` whitespace workaround in `Home.razor` is a little awkward, and the `Optional` converter's `!` on a null deserialize is slightly loose but harmless.

### claude-code-2

reward 1 · contract 1 · acceptance 1 · own tests 1 · tokens 6,251,527 · cost $3.35 · agent 667 s · tool errors 8
superpowers active: yes
MCP: serena 0 · playwright 22 (browser_wait_for 5, browser_take_screenshot 5, browser_evaluate 5, browser_navigate 3, browser_click 2, browser_snapshot 1, browser_close 1) · context7 0
built-in: Bash 44, Read 9, Edit 8, Write 7, ToolSearch 5, Skill 5, KillShell 2, Agent 1

Failed checks: none
Acceptance: AC1 pass · AC2 pass · AC3 pass · AC4 pass · AC5 pass · AC6 pass · AC7 pass

| Model | Input | Output | Cache read | Cache write | Total | Cost |
|---|---|---|---|---|---|---|
| claude-opus-5-5 | 140 | 47,886 | 5,819,463 | 132,168 | 5,999,657 | $3.18 |
| claude-sonnet-5-5 | 16 | 4,852 | 204,716 | 42,286 | 251,870 | $0.17 |

- review requirements 5: The spec and the diff cover all seven acceptance criteria: optional DateOnly, change and clear through Optional<T>, 400 on invalid dates, the overdue filter, the due date display, the "überfällig" mark and the "nur überfällige" checkbox. The spec also pins edge cases such as today not being overdue and the UTC rule.
- review scope 4: The changes stay on the ticket. The extra `@preservewhitespace` and the whitespace test are a justified fix for the new spans, and the plan and spec docs follow the repo's workflow.
- review tests 4: Tests cover the store rule, the filter, PATCH missing/value/null, invalid dates, the page markup and the UTC-offset clock. The checkbox filter behaviour is only checked in the E2E run, not by an automated test, and the one changed assertion is an additive expected-JSON update.
- review conventions 5: The change follows AGENTS.md: no new packages, validation stays in the store and the existing 400 path, data-testids on all new UI elements, and TDD with commits split per task.
- review architecture 4: Logic stays in TodoStore, which the API and the page share, and TimeProvider is injected through DI. Storing a Todo with a placeholder Overdue=false and filling it in on read is slightly awkward.
- review codeQuality 4: The code is small and readable, with correct handling of absent versus null and of the UTC date. Minor nits: WithOverdue calls the clock once per item, and the Optional converter uses reflection and a null-forgiving `!`.

### claude-code-3

reward 1 · contract 1 · acceptance 1 · own tests 1 · tokens 6,209,352 · cost $3.42 · agent 770 s · tool errors 8
superpowers active: yes
MCP: serena 0 · playwright 21 (browser_take_screenshot 5, browser_evaluate 5, browser_navigate 3, browser_wait_for 3, browser_click 3, browser_snapshot 1, browser_close 1) · context7 0
built-in: Bash 44, Read 9, Write 6, Skill 5, ToolSearch 4, Edit 3, KillShell 2, Agent 1

Failed checks: none
Acceptance: AC1 pass · AC2 pass · AC3 pass · AC4 pass · AC5 pass · AC6 pass · AC7 pass

| Model | Input | Output | Cache read | Cache write | Total | Cost |
|---|---|---|---|---|---|---|
| claude-opus-5-5 | 146 | 50,500 | 5,898,600 | 134,533 | 6,083,779 | $3.27 |
| claude-sonnet-5-5 | 10 | 4,451 | 80,410 | 40,702 | 125,573 | $0.15 |

- review requirements 5: The spec and diff cover AC1–AC7, including the edge cases of an empty string, a null value that removes the date, and the UTC boundary.
- review scope 4: The change stays on the ticket. It also adds the spec and plan documents and a public TimeProvider constructor, which are minor extras.
- review tests 4: The store, API and page tests are good and no existing tests were weakened. The existing JSON assertion was only updated for the new fields. The checkbox filter and the 'Keine überfälligen Todos' hint have no xUnit test, and the page test never checks the 'todo-due-date' test id.
- review conventions 4: ValidationException in the store, data-testids on new elements and TDD all follow AGENTS.md. AGENTS.md itself was not updated with the four new data-testids, although it lists the existing ones.
- review architecture 5: The overdue rule lives only in the store, the API and the page share it, and the time source is injected. The Optional<T> type cleanly separates an absent field from a null one.
- review codeQuality 4: The code is clear and the edge cases are handled. The custom Optional converter and the explicit @(" ") spacing add some complexity, and Optional.Read uses a null-forgiving '!' on the deserialized value.
