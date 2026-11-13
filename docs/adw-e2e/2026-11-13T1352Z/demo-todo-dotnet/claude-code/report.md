# E2E demo-todo-dotnet · claude-code

Model: `claude-opus-5-5` · verifier `claude-sonnet-5-5` · review `claude-sonnet-5-5` · adw 0.31.0 (e3196af) · trials: 3

Verifier calibration: `2026-10-13T1704Z` (verifier hash cf30252)

## Summary

| Signal | Value |
|---|---|
| reward rate | 1 |
| median tokens | 4,521,153 |
| median cost (USD) | $2.89 |
| median agent time (s) | 532 |
| review requirements (median) | 5 |
| review scope (median) | 5 |
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
| show_me_read | 1 |
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
| playwright | 3/3 | 43 |
| context7 | 0/3 | 0 |

## Trials

### claude-code-1

reward 1 · contract 1 · acceptance 1 · own tests 1 · tokens 4,479,624 · cost $2.89 · agent 532 s · tool errors 3
superpowers active: yes
MCP: serena 0 · playwright 16 (browser_snapshot 4, browser_take_screenshot 3, browser_click 3, browser_navigate 2, browser_wait_for 2, browser_console_messages 1, browser_close 1) · context7 0
built-in: Bash 42, Edit 10, Read 7, Write 7, Skill 5, ToolSearch 3, Agent 1

Failed checks: none
Acceptance: AC1 pass · AC2 pass · AC3 pass · AC4 pass · AC5 pass · AC6 pass · AC7 pass

| Model | Input | Output | Cache read | Cache write | Total | Cost |
|---|---|---|---|---|---|---|
| claude-opus-5-5 | 154 | 49,676 | 4,283,857 | 145,937 | 4,479,624 | $2.89 |

- review requirements 5: The spec and diff cover AC1–AC7 with the date-only format, PATCH set/clear/keep, 400 on invalid dates, the UTC overdue rule, and the list page's date, marker and filter labelled as required.
- review scope 5: Only the requested behaviour is added. The plan and spec documents are expected process artifacts, and the extras (a TimeProvider fake, an Optional type) were both approved in the spec.
- review tests 4: The store, API and page tests cover the overdue boundary (due today, done, undated), the PATCH variants, invalid input and the filter, and the one changed existing assertion was legitimately updated. The checkbox toggle has no automated test (it was only checked end-to-end by hand), and the impossible-date case such as 30 February is only represented by 2026-13-40.
- review conventions 4: The change follows TDD, uses ValidationException for validation, adds data-testids and introduces no new packages, but AGENTS.md was not updated with the new data-testids or files.
- review architecture 5: The overdue rule lives in TodoStore and is shared by the API and the page, the clock is injected as a TimeProvider, the response DTO is separate, and Home.razor calls the store directly as AGENTS.md requires.
- review codeQuality 4: The code is clean and handles the edges (null comparison, absent vs. null). The Optional<T> struct is slightly subtle, since a default-constructed value has HasValue false while an explicit construction sets it to true. Read also uses the null-forgiving operator on Deserialize<T>.

### claude-code-2

reward 1 · contract 1 · acceptance 1 · own tests 1 · tokens 4,521,153 · cost $2.88 · agent 517 s · tool errors 4
superpowers active: yes
MCP: serena 0 · playwright 9 (browser_snapshot 2, browser_take_screenshot 2, browser_click 2, browser_navigate 1, browser_wait_for 1, browser_close 1) · context7 0
built-in: Bash 40, Read 8, Write 7, Edit 7, Skill 5, ToolSearch 3, Agent 1, KillShell 1

Failed checks: none
Acceptance: AC1 pass · AC2 pass · AC3 pass · AC4 pass · AC5 pass · AC6 pass · AC7 pass

| Model | Input | Output | Cache read | Cache write | Total | Cost |
|---|---|---|---|---|---|---|
| claude-opus-5-5 | 152 | 49,784 | 4,328,475 | 142,742 | 4,521,153 | $2.88 |

- review requirements 5: The spec and diff cover all seven acceptance criteria: create, change and clear a date, 400 on invalid dates, the overdue API filter, and the list page's date, "überfällig" marker and "nur überfällige" control. The edge cases are explicit: due today, done todos, UTC date, and PATCH missing versus null.
- review scope 5: The change stays within the ticket. The only extras are the spec and plan docs, which the workflow produces, and the small test helper.
- review tests 4: Store and API tests are thorough and TDD-style, covering the UTC boundary, done todos, PATCH keep/clear and invalid inputs. Gaps: the page test never checks that non-overdue todos lack the marker, never tests the checkbox filter, and the existing test was only updated for the new JSON shape.
- review conventions 4: The change follows the AGENTS.md rules: no new packages, a TimeProvider, data-testid on new elements, and the existing 400 mapping. It does not add the new testids to AGENTS.md's locator list. The PATCH 400 comes from a BadHttpRequestException with a generic message, which is not the ValidationException route the convention names.
- review architecture 4: Logic stays in TodoStore, the page calls the store directly, and the clock is injected. Optional<T> with a converter factory is a reasonable way to tell a missing field from null. The overdue filter runs after mapping every todo, which is acceptable at this size.
- review codeQuality 4: The code is compact and readable, and the edges are handled: overdue is computed on read, and a null value is wrapped via HandleNull. Weak spots: the `!` on the deserialized value, the generic error message that does not name dueDate, and a stale overdue marker on a page that stays open past midnight, which the agent flagged.

### claude-code-3

reward 1 · contract 1 · acceptance 1 · own tests 1 · tokens 6,353,223 · cost $3.63 · agent 634 s · tool errors 3
superpowers active: yes
MCP: serena 0 · playwright 18 (browser_wait_for 4, browser_take_screenshot 4, browser_evaluate 4, browser_navigate 2, browser_click 2, browser_snapshot 1, browser_close 1) · context7 0
built-in: Bash 48, Edit 11, Read 8, Write 7, ToolSearch 5, Skill 5, KillShell 2, Agent 1

Failed checks: none
Acceptance: AC1 pass · AC2 pass · AC3 pass · AC4 pass · AC5 pass · AC6 pass · AC7 pass

| Model | Input | Output | Cache read | Cache write | Total | Cost |
|---|---|---|---|---|---|---|
| claude-opus-5-5 | 188 | 60,079 | 6,124,754 | 168,202 | 6,353,223 | $3.63 |

- review requirements 5: The spec and diff cover all seven acceptance criteria, including PATCH absent-versus-null, the UTC boundary and the 400 cases, and mark the agent's own decisions as such.
- review scope 4: The change stays on the ticket. The extra whitespace test and the plan and spec docs are small additions that follow from the work.
- review tests 4: Store and API tests are thorough (boundaries, UTC offset, keep/clear patch, invalid dates with an unchanged store, filter), and the one existing assertion was updated rather than weakened; the toggle's actual filtering is not covered by an automated test, only by manual E2E.
- review conventions 4: It follows TDD, uses data-testid on new elements, adds no packages, and relies on the existing 400 middleware; AGENTS.md's locator list was not updated.
- review architecture 5: The overdue rule lives once in TodoStore and is reused by the API, the filter and the page, with TimeProvider injected and a TodoView mapping in the API layer.
- review codeQuality 4: The code is clean and correct at the edges (null < today is false, the filter reads today once before taking the lock). The setter-flag TodoPatch is slightly clever, and the generic 400 message does not name dueDate.
