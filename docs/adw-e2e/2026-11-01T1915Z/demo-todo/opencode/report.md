# E2E demo-todo · opencode

Model: `mistral/mistral-large-4` · verifier `claude-sonnet-5-5` · review `claude-sonnet-5-5` · adw 0.29.1 (fe1008a) · trials: 1

Verifier calibration: `2026-10-12T1659Z` (verifier hash cf30252)

## Summary

| Signal | Value |
|---|---|
| reward rate | 1 |
| median tokens | 3,263,754 |
| median cost (USD) | $0.39 |
| median agent time (s) | 466 |
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
| playwright | 1/1 | 21 |
| context7 | 0/1 | 0 |

## Trials

### opencode-1

reward 1 · contract 1 · acceptance 1 · own tests 1 · tokens 3,263,754 · cost $0.39 · agent 466 s · tool errors 0
superpowers active: yes
MCP: serena 0 · playwright 21 (browser_wait_for 5, browser_evaluate 5, browser_take_screenshot 4, browser_navigate 3, browser_click 2, browser_snapshot 1, browser_close 1) · context7 0
built-in: shell 32, read 12, edit 9, skill 5, glob 5, write 3, execute 3

Failed checks: none
Acceptance: AC1 pass · AC2 pass · AC3 pass · AC4 pass · AC5 pass · AC6 pass · AC7 pass

| Model | Input | Output | Cache read | Cache write | Total | Cost |
|---|---|---|---|---|---|---|
| mistral-large-4 | 154,205 | 32,429 | 3,077,120 | 0 | 3,263,754 | $0.39 |

- review requirements 5: All seven ACs are covered by the spec and the diff: optional date, PATCH change and null removal, 400 on invalid input, the overdue filter, and the UI date, label and toggle.
- review scope 4: The change stays on-ticket. The only extras are a small `.gitignore` entry for `.superpowers/` and the committed spec and plan docs.
- review tests 4: The new tests cover validation, PATCH set and clear, UTC overdue, the done case and the filter, and the existing test was updated rather than weakened. The UI is checked only by markup regex, and the 'today' case is tested against a real clock.
- review conventions 5: The code uses `ValidationError` for HTTP 400, adds `data-testid` to every new UI element, uses only Node builtins, and keeps the existing test style.
- review architecture 4: Validation sits in the store and the computed overdue field and filter sit in the HTTP layer, as the spec says. The list filter calls `withOverdue` twice per todo, which is minor duplication.
- review codeQuality 4: The code is clean and handles edge cases such as the 2026-02-30 round-trip check and non-string input. Minor issues: `update` does not guard against a null patch, and the UI fetch has no error handling.
