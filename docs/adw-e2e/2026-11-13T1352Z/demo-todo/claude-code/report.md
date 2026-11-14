# E2E demo-todo · claude-code

Model: `claude-opus-5-5` · verifier `claude-sonnet-5-5` · review `claude-sonnet-5-5` · adw 0.31.0 (e3196af) · trials: 3

Verifier calibration: `2026-10-12T1659Z` (verifier hash cf30252)

## Summary

| Signal | Value |
|---|---|
| reward rate | 1 |
| median tokens | 3,611,075 |
| median cost (USD) | $2.25 |
| median agent time (s) | 394 |
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
| playwright | 3/3 | 30 |
| context7 | 0/3 | 0 |

## Trials

### claude-code-1

reward 1 · contract 1 · acceptance 1 · own tests 1 · tokens 3,492,637 · cost $2.24 · agent 346 s · tool errors 3
superpowers active: yes
MCP: serena 0 · playwright 11 (browser_snapshot 4, browser_navigate 2, browser_take_screenshot 2, browser_click 2, browser_close 1) · context7 0
built-in: Bash 33, ToolSearch 5, Skill 5, Write 5, Edit 4, Read 2, Agent 1, KillShell 1

Failed checks: none
Acceptance: AC1 pass · AC2 pass · AC3 pass · AC4 pass · AC5 pass · AC6 pass · AC7 pass

| Model | Input | Output | Cache read | Cache write | Total | Cost |
|---|---|---|---|---|---|---|
| claude-opus-5-5 | 152 | 34,398 | 3,335,626 | 122,461 | 3,492,637 | $2.24 |

- review requirements 5: All seven acceptance criteria are covered by the spec and the diff, and the spec adds the edge cases: due today, done todos, and invalid overdue values.
- review scope 4: The change stays on the ticket. The one extra is that a PATCH now validates every field before changing anything, which is a small, related behaviour change that the summary discloses.
- review tests 4: Store and API tests cover validation, PATCH, null, the filter edge cases and the 400 on bad filter values. There is no PATCH-via-API 400 test, and the list-page test only checks the static HTML, but the existing test was only extended, not weakened.
- review conventions 5: The change uses ValidationError mapped to 400, has no dependencies, follows TDD, and adds data-testids to the new elements, as AGENTS.md requires.
- review architecture 5: Validation and the overdue rule live in the store with an injectable clock. app.mjs only parses the parameter, and the page reuses the server's verdict instead of duplicating the rule.
- review codeQuality 4: The code is clear and handles the edges well. The Date.parse NaN check is redundant given the regex and round-trip comparison, and the page makes two requests, which the spec accepted.

### claude-code-2

reward 1 · contract 1 · acceptance 1 · own tests 1 · tokens 3,611,075 · cost $2.25 · agent 394 s · tool errors 1
superpowers active: yes
MCP: serena 0 · playwright 9 (browser_snapshot 3, browser_take_screenshot 2, browser_click 2, browser_navigate 1, browser_close 1) · context7 0
built-in: Bash 40, Edit 6, Skill 5, Write 5, ToolSearch 4, Agent 1, KillShell 1

Failed checks: none
Acceptance: AC1 pass · AC2 pass · AC3 pass · AC4 pass · AC5 pass · AC6 pass · AC7 pass

| Model | Input | Output | Cache read | Cache write | Total | Cost |
|---|---|---|---|---|---|---|
| claude-opus-5-5 | 154 | 38,229 | 3,462,137 | 110,555 | 3,611,075 | $2.25 |

- review requirements 5: The spec and diff cover all seven acceptance criteria, including the UTC rule, the 400 cases, null to clear the date, and the exact UI strings.
- review scope 5: The change is limited to the due-date feature plus its spec and plan docs; the only extras are small hardening such as atomic updates and ignoring a client-sent overdue.
- review tests 4: The store and HTTP tests are thorough, covering the boundary day, UTC across midnight, invalid dates, and the 400 cases, and no existing tests were weakened. The UI behaviour (rendering, checkbox) is only checked by a static HTML regex in the unit tests, with browser checks done manually.
- review conventions 5: It follows AGENTS.md: zero dependencies, ValidationError mapped to 400, tests written first, and data-testid attributes on the new elements.
- review architecture 5: The overdue rule lives only in the store with an injectable clock, the app layer just parses the query, and the page reuses the API filter instead of duplicating the rule.
- review codeQuality 4: The code is clean and update() now validates before mutating; the Date.parse NaN check in parseDueDate is redundant next to the round-trip check, and the page has no error handling for fetch failures.

### claude-code-3

reward 1 · contract 1 · acceptance 1 · own tests 1 · tokens 3,718,056 · cost $2.40 · agent 420 s · tool errors 2
superpowers active: yes
MCP: serena 0 · playwright 10 (browser_snapshot 3, browser_take_screenshot 3, browser_click 2, browser_navigate 1, browser_close 1) · context7 0
built-in: Bash 35, Skill 6, Write 6, ToolSearch 3, Edit 3, Agent 1, KillShell 1

Failed checks: none
Acceptance: AC1 pass · AC2 pass · AC3 pass · AC4 pass · AC5 pass · AC6 pass · AC7 pass

| Model | Input | Output | Cache read | Cache write | Total | Cost |
|---|---|---|---|---|---|---|
| claude-opus-5-5 | 148 | 40,821 | 3,555,166 | 121,921 | 3,718,056 | $2.40 |

- review requirements 5: All seven acceptance criteria are covered by the spec and the diff, with UTC and today-is-not-overdue edge cases made explicit.
- review scope 4: The change stays within the ticket; the spec and plan docs are process artifacts, and the strict ?overdue= validation and the atomic PATCH validation are small additions beyond the ACs.
- review tests 4: Store and API tests cover overdue edge cases, filtering, invalid dates and atomic PATCH, and the one existing assertion was extended rather than weakened; the UI behaviour is only checked by an HTML string match, and 2026-13-01 and the PATCH-400 path have no test.
- review conventions 4: Follows the zero-dependency rule, uses ValidationError mapped to 400, adds data-testids and writes tests first; the small gap is that the page and API-400 for PATCH are lightly tested.
- review architecture 5: Rules live in the store with an injectable clock, app.mjs only parses the query parameter, and the page reuses the API filter.
- review codeQuality 4: The code is clean and the validation is correct at the edges; the Date.parse check is redundant and the page has no error handling and a double-toggle race, as the agent itself noted.
