# E2E demo-todo · claude-code

Model: `claude-opus-5-5` · verifier `claude-sonnet-5-5` · review `claude-sonnet-5-5` · adw 0.29.1 (fe1008a) · trials: 1

Verifier calibration: `2026-10-12T1659Z` (verifier hash cf30252)

## Summary

| Signal | Value |
|---|---|
| reward rate | 1 |
| median tokens | 3,359,466 |
| median cost (USD) | $2.31 |
| median agent time (s) | 397 |
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
| serena | 0/1 | 0 |
| playwright | 1/1 | 13 |
| context7 | 0/1 | 0 |

## Trials

### claude-code-1

reward 1 · contract 1 · acceptance 1 · own tests 1 · tokens 3,359,466 · cost $2.31 · agent 397 s · tool errors 2
superpowers active: yes
MCP: serena 0 · playwright 13 (browser_snapshot 4, browser_take_screenshot 4, browser_click 3, browser_navigate 1, browser_close 1) · context7 0
built-in: Bash 30, Edit 8, Skill 5, Write 5, ToolSearch 4, Read 3, Agent 1, KillShell 1

Failed checks: none
Acceptance: AC1 pass · AC2 pass · AC3 pass · AC4 pass · AC5 pass · AC6 pass · AC7 pass

| Model | Input | Output | Cache read | Cache write | Total | Cost |
|---|---|---|---|---|---|---|
| claude-opus-5-5 | 148 | 37,047 | 3,192,987 | 129,284 | 3,359,466 | $2.31 |

- review requirements 5: All seven acceptance criteria are covered by the spec and the diff, and the agent's own decisions (field name, injectable `today`) are labelled as such.
- review scope 4: The PATCH atomicity refactor of title and done goes beyond the ticket, but it is needed so a rejected dueDate leaves the todo unchanged, and it is documented and tested. The plan and spec docs are the expected process artifacts.
- review tests 4: The store and HTTP tests cover boundaries, invalid values, clearing the date and atomic PATCH. Gaps: the page test only checks for static strings, a PATCH over HTTP is never tested, and the only existing-test change is a legitimate update to the expected shape.
- review conventions 5: The change uses ValidationError and 400, zero dependencies, TDD, new data-testid attributes, and the existing test style.
- review architecture 4: The overdue rule lives only in the store and the app maps the query parameter to it. The page makes two requests and marks todos by id, which the spec accepts as approach A.
- review codeQuality 4: The code is clean and the date validation is robust. Minor edges: the page keeps stale overdue data after any change, and it does not handle fetch errors (the original page did not either).
