# E2E demo-todo · opencode

Model: `mistral/mistral-large-4` · verifier `claude-sonnet-5-5` · review `claude-sonnet-5-5` · adw 0.29.1 (fe1008a) · trials: 3

Verifier calibration: `2026-10-12T1659Z` (verifier hash cf30252)

## Summary

| Signal | Value |
|---|---|
| reward rate | 0 |
| median tokens | 6,117,679 |
| median cost (USD) | $0.66 |
| median agent time (s) | 727 |
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
| show_me_read | 0 |
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
| playwright | 3/3 | 112 |
| context7 | 0/3 | 0 |
| opencode | 2/3 | 5 |

## Trials

### opencode-1

reward 0 · contract 0.9286 · acceptance 1 · own tests 1 · tokens 6,117,679 · cost $0.66 · agent 811 s · tool errors 3
superpowers active: yes
MCP: serena 0 · playwright 57 (browser_evaluate 15, browser_click 11, browser_wait_for 10, browser_snapshot 6, browser_close 5, browser_navigate 4, browser_take_screenshot 4, browser_network_requests 1, browser_console_messages 1) · context7 0
built-in: shell 63, read 19, skill 7, edit 7, execute 5, write 4, glob 3, question 2, bash 1, subagent 1

Failed checks: show_me_read
Acceptance: AC1 pass · AC2 pass · AC3 pass · AC4 pass · AC5 pass · AC6 pass · AC7 pass

| Model | Input | Output | Cache read | Cache write | Total | Cost |
|---|---|---|---|---|---|---|
| mistral-large-4 | 184,198 | 54,953 | 5,878,528 | 0 | 6,117,679 | $0.66 |

- review requirements 5: All seven acceptance criteria (optional date on create, change and remove via PATCH, 400 on invalid dates, overdue filter, due date shown, 'überfällig' marker, 'nur überfällige' toggle) are in the spec and the diff.
- review scope 4: The change stays on the ticket. The plan and spec docs are extra but follow the workflow, and the `?overdue=banana` 400 is a small addition that the spec states openly.
- review tests 4: The tests cover the happy path, the invalid-date cases, the leap day, the UTC boundary with an injected clock, a done todo, PATCH change and remove, and the filter values. The UI tests only grep the static HTML for testids, and the existing test was updated rather than weakened.
- review conventions 5: The change uses ValidationError → 400, writes tests first, gives new elements data-testids, keeps the page in German and adds no dependencies.
- review architecture 5: Validation and the computed overdue flag live in the store, the query filter lives in app.mjs, and rendering lives in the page. An injectable clock keeps the store testable without changing existing callers.
- review codeQuality 4: The code is clear and the date validation is correct. A PATCH that returns 400 can still apply earlier fields, and the agent noted this as an existing problem. Also, `due` in a POST body is not null-checked consistently with how the body is read, which is a minor point.

### opencode-2

reward 0 · contract 0.9286 · acceptance 1 · own tests 1 · tokens 7,152,426 · cost $0.76 · agent 727 s · tool errors 4
superpowers active: yes
MCP: serena 0 · playwright 37 (browser_wait_for 9, browser_run_code_unsafe 9, browser_click 7, browser_take_screenshot 6, browser_navigate 2, browser_console_messages 2, browser_close 2) · context7 0 · opencode 2 (models 2)
built-in: shell 63, edit 23, read 17, skill 7, glob 4, write 4, subagent 2, question 1, bash 1, execute 1

Failed checks: show_me_read
Acceptance: AC1 pass · AC2 pass · AC3 pass · AC4 pass · AC5 pass · AC6 pass · AC7 pass

| Model | Input | Output | Cache read | Cache write | Total | Cost |
|---|---|---|---|---|---|---|
| mistral-large-4 | 214,836 | 52,087 | 6,780,928 | 0 | 7,047,851 | $0.73 |
| mistral-large-latest | 46,255 | 2,128 | 56,192 | 0 | 104,575 | $0.03 |

- review requirements 5: The spec and diff cover AC1–AC7, and the spec adds sensible decisions such as a strict `<` comparison, a 400 for bad `overdue` values, and the testids.
- review scope 4: The change stays on the ticket. The extra `res.ok` fetch guard in the list page and the plan and spec docs committed to the repo are small additions beyond what was asked.
- review tests 3: The API tests are solid, covering validation, patch set/clear, overdue boundaries, and the filter. The UI is only checked with regex matches on the HTML, including a brittle `res.ok` source match, and nothing tests the marker, the date display, or the filter behaviour. The one edited existing test was extended, not weakened.
- review conventions 4: The change uses `ValidationError`, adds testids, has no new dependencies, and follows TDD. The test names and style match the existing tests.
- review architecture 4: Validation sits in the store, and `overdue` is computed in one place in the app layer and reused for every response and the filter. The pure-function helpers live in `app.mjs`, which is acceptable.
- review codeQuality 4: The code is clear, and the date round-trip check handles impossible dates and non-strings. The `normalizeDueDate` condition is a bit dense, and `update` can partly mutate a todo before a later field fails validation.

### opencode-3

reward 0 · contract 0.9286 · acceptance 1 · own tests 1 · tokens 5,559,497 · cost $0.61 · agent 727 s · tool errors 3
superpowers active: yes
MCP: serena 0 · playwright 18 (browser_wait_for 4, browser_evaluate 4, browser_take_screenshot 4, browser_navigate 2, browser_click 2, browser_console_messages 1, browser_close 1) · context7 0 · opencode 3 (worktree_create 1, session_move 1, models 1)
built-in: shell 50, read 21, edit 9, skill 7, write 4, subagent 2, glob 1, question 1, execute 1, bash 1

Failed checks: show_me_read
Acceptance: AC1 pass · AC2 pass · AC3 pass · AC4 pass · AC5 pass · AC6 pass · AC7 pass

| Model | Input | Output | Cache read | Cache write | Total | Cost |
|---|---|---|---|---|---|---|
| mistral-large-4 | 153,517 | 58,908 | 5,347,072 | 0 | 5,559,497 | $0.61 |

- review requirements 5: The spec and diff cover all seven acceptance criteria, including the empty-string, null-clearing and today-not-overdue edge cases.
- review scope 4: The change stays focused on the ticket; the only extras are the spec and plan docs and an unrequested exported `todayUtc` with a `now` parameter.
- review tests 4: The API tests are thorough (invalid dates, clearing, PATCH without the field, today, done, filter), but the UI test only checks static HTML, so the toggle and marker rely on manual E2E, and one existing assertion was extended rather than weakened.
- review conventions 5: Follows AGENTS.md: ValidationError maps to 400, zero dependencies, new elements carry data-testid, TDD tests were added, and the UI stays in German.
- review architecture 5: Validation and the overdue predicate live in the store, the filter and the computed field in app.mjs through a single `view` mapper, and rendering in the page, with no new modules.
- review codeQuality 4: The code is clear and correct, with a calendar round-trip check and string-compared ISO dates; minor nits are the duplicated overdue evaluation (filter, then view) and no fetch error handling in the page.
