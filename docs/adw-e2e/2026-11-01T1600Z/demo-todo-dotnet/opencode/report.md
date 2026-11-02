# E2E demo-todo-dotnet · opencode

Model: `mistral/mistral-large-4` · verifier `claude-sonnet-5-5` · review `claude-sonnet-5-5` · adw 0.29.1 (fe1008a) · trials: 3

Verifier calibration: `2026-10-13T1704Z` (verifier hash cf30252)

## Summary

| Signal | Value |
|---|---|
| reward rate | 0.33 |
| median tokens | 6,312,704 |
| median cost (USD) | $0.68 |
| median agent time (s) | 900 |
| review requirements (median) | 5 |
| review scope (median) | 4.5 |
| review tests (median) | 4 |
| review conventions (median) | 4 |
| review architecture (median) | 4 |
| review codeQuality (median) | 4 |
| error classes | judge |

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
| show_me_read | 0.33 |
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
| playwright | 3/3 | 81 |
| context7 | 0/3 | 0 |

## Trials

### opencode-1

reward 0 · contract 0.9286 · acceptance 1 · own tests 1 · tokens 6,312,704 · cost $0.68 · agent 900 s · tool errors 4
superpowers active: yes
MCP: serena 0 · playwright 33 (browser_take_screenshot 9, browser_snapshot 8, browser_wait_for 6, browser_click 5, browser_navigate 3, browser_find 1, browser_close 1) · context7 0
built-in: shell 65, edit 29, read 17, skill 7, execute 5, write 4, glob 3, bash 2, question 1, subagent 1

Failed checks: show_me_read
Acceptance: AC1 pass · AC2 pass · AC3 pass · AC4 pass · AC5 pass · AC6 pass · AC7 pass

| Model | Input | Output | Cache read | Cache write | Total | Cost |
|---|---|---|---|---|---|---|
| mistral-large-4 | 175,690 | 64,694 | 6,072,320 | 0 | 6,312,704 | $0.68 |

- review requirements 5: All seven acceptance criteria appear in the final spec and the diff, including the UTC overdue rule, the 'überfällig' word and the 'nur überfällige' control.
- review scope 5: The change adds only what the ticket asks for. It also commits the spec and plan documents, which the workflow produces.
- review tests 4: The new tests cover set, change and clear of the due date, invalid input, the overdue boundaries, the API filter and the page markup. Gaps: no test clicks the UI filter to show it hides non-overdue todos, and the page test only checks that strings appear somewhere in the HTML. Existing tests were adapted to the new signatures, not weakened.
- review conventions 4: It follows AGENTS.md: ValidationException from the store, data-testid on the new elements, TDD, and no new packages. Minor: the filter checkbox's data-testid is on the input, not the label.
- review architecture 4: Logic sits in TodoStore and Todo, the page filters over the store, and the API filter is a small change to the existing GET handler. Minor: the overdue filter exists in both Program.cs and Home.razor.
- review codeQuality 4: Parsing is strict and the PATCH switch handles all three states and rejects other kinds. Small issues: Overdue reads DateTime.UtcNow on every access, so it can flip mid-request, and an absent JsonElement relies on default(JsonElement) being Undefined.

### opencode-2

reward 0 · contract 0.9286 · acceptance 1 · own tests 1 · tokens 5,959,821 · cost $0.61 · agent 749 s · tool errors 1
superpowers active: yes
MCP: serena 0 · playwright 13 (browser_wait_for 3, browser_take_screenshot 3, browser_snapshot 2, browser_find 2, browser_navigate 1, browser_click 1, browser_close 1) · context7 0
built-in: shell 49, edit 11, read 10, write 8, skill 6, glob 5, execute 2, question 1

Failed checks: show_me_read
Acceptance: AC1 pass · AC2 pass · AC3 pass · AC4 pass · AC5 pass · AC6 pass · AC7 pass

| Model | Input | Output | Cache read | Cache write | Total | Cost |
|---|---|---|---|---|---|---|
| mistral-large-4 | 139,049 | 51,556 | 5,769,216 | 0 | 5,959,821 | $0.61 |

- review error: review (claude-code): answer holds no JSON object; answer ends: ""score": 5, "reason": "The overdue rule lives once on `Todo`, the store does the filtering, and the page injects the store directly, as the repo layout requires. The tri-state is handled in a small converter type."}, "codeQuality": {"score": 4, "reason": "The code is compact and correct at the edges: due today is not overdue, null dates are handled, and invalid dates surface as `JsonException`. Minor smells are `showOnlyOverdue ? true : null` and a `Write` that throws `NotSupportedException`."}}"

### opencode-3

reward 1 · contract 1 · acceptance 1 · own tests 1 · tokens 6,536,038 · cost $0.75 · agent 900 s · tool errors 4
superpowers active: yes
MCP: serena 0 · playwright 35 (browser_snapshot 11, browser_take_screenshot 8, browser_wait_for 7, browser_click 6, browser_close 2, browser_navigate 1) · context7 0
built-in: shell 55, edit 16, read 14, write 11, skill 7, execute 4, glob 3, bash 3, subagent 1

Failed checks: none
Acceptance: AC1 pass · AC2 pass · AC3 pass · AC4 pass · AC5 pass · AC6 pass · AC7 pass

| Model | Input | Output | Cache read | Cache write | Total | Cost |
|---|---|---|---|---|---|---|
| mistral-large-4 | 244,269 | 67,129 | 6,224,640 | 0 | 6,536,038 | $0.75 |

- review requirements 5: All seven acceptance criteria appear in the spec and the diff, including the clear/keep semantics for PATCH, the strictly-before-today rule in UTC, and the exact UI labels and test ids.
- review scope 4: The code changes stay within the ticket. The plan and spec docs were added, which fits the workflow, but AGENTS.md was not updated with the new data-testids.
- review tests 4: Store and API tests cover set, keep, clear, invalid dates, the today/done/no-date overdue edges, and the filter. Existing tests were only adapted to the new signatures. The page test only checks the server-rendered HTML, so the toggle's filtering is never tested.
- review conventions 4: The change follows the existing conventions: ValidationException thrown from the store, data-testid on new elements, xUnit style, and the page calling the store directly. It misses the AGENTS.md locator list update.
- review architecture 4: Validation and PATCH semantics live in TodoStore and IsOverdue sits on the record, so there is one source of truth. The page and the API both reuse it. The only wart is the raw-string and JsonElement DTO shape, which the agent justified.
- review codeQuality 4: The code is readable, uses strict yyyy-MM-dd invariant parsing, and handles non-string JSON kinds. The Update method's setDueDate/dueDate flag pair is slightly clunky, and the test class computes Today once in a static field, which could be off around midnight UTC.
