# E2E demo-todo · codex

Model: `openai/gpt-6.1-sol` · verifier `claude-sonnet-5-5` · review `claude-sonnet-5-5` · adw 0.29.1 (fe1008a) · trials: 1

Verifier calibration: `2026-10-12T1659Z` (verifier hash cf30252)

## Summary

| Signal | Value |
|---|---|
| reward rate | 1 |
| median tokens | 3,397,277 |
| median cost (USD) | $1.23 |
| median agent time (s) | 705 |
| review requirements (median) | 5 |
| review scope (median) | 4 |
| review tests (median) | 5 |
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
| serena | 0/1 | 0 |
| playwright | 1/1 | 6 |
| context7 | 0/1 | 0 |

## Trials

### codex-1

reward 1 · contract 1 · acceptance 1 · own tests 1 · tokens 3,397,277 · cost $1.23 · agent 705 s · tool errors 0
superpowers active: yes
MCP: serena 0 · playwright 6 (browser_run_code_unsafe 2, browser_close 2, browser_navigate 1, browser_console_messages 1) · context7 0
built-in: CommandExecution 51, FileChange 10, ImageView 1, CollabAgentToolCall 1

Failed checks: none
Acceptance: AC1 pass · AC2 pass · AC3 pass · AC4 pass · AC5 pass · AC6 pass · AC7 pass

| Model | Input | Output | Cache read | Cache write | Total | Cost |
|---|---|---|---|---|---|---|
| gpt-6.1-sol | 82,941 | 32,520 | 3,173,376 | 0 | 3,288,837 | $0.81 |
| gpt-6-astra | 27,026 | 1,414 | 80,000 | 0 | 108,440 | $0.42 |

- review requirements 5: All seven acceptance criteria are covered by the spec and the diff, including strict date validation, UTC overdue logic computed per response, and the filter checkbox with the exact labels.
- review scope 4: The change stays within the ticket. It adds an unrequested error-status element with load-failure handling, and it commits long plan and spec docs.
- review tests 5: Store, HTTP and UI tests cover the date validation table, atomic PATCH, UTC midnight, filter semantics, empty results and stale or failed responses. The only existing test change is adding the two new fields to one expected response.
- review conventions 4: The change follows the conventions in AGENTS.md: zero dependencies, ValidationError mapped to 400, `data-testid` on new elements, and tests written first. The date check is somewhat redundant, and the `test/ui.test.mjs` DOM stub is bespoke.
- review architecture 5: Validation and overdue logic live centrally in the store with an injectable clock. The handler only passes the query through and the page renders API fields without computing overdue itself.
- review codeQuality 4: The code is correct at the edges, with projections, atomic updates and a latest-request guard. `validateDueDate` has redundant checks (length plus regex plus NaN), and the stub-based UI test is brittle.
