# E2E demo-todo-dotnet · claude-code

Model: `claude-opus-5-5` · verifier `claude-sonnet-5-5` · review `claude-sonnet-5-5` · adw 0.25.0 (26becd1) · trials: 1

Verifier calibration: `2026-10-13T1704Z` (verifier hash cf30252)

## Summary

| Signal | Value |
|---|---|
| reward rate | 1 |
| median tokens | 6,338,762 |
| median agent time (s) | 749 |
| review requirements (median) | 5 |
| review scope (median) | 4 |
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

## Trials

### claude-code-1

reward 1 · contract 1 · acceptance 1 · own tests 1 · tokens 6,338,762 · agent 749 s · tool errors 5
superpowers active: yes

Failed checks: none
Acceptance: AC1 pass · AC2 pass · AC3 pass · AC4 pass · AC5 pass · AC6 pass · AC7 pass

- review requirements 5: The spec and diff cover all seven ACs and add sensible edge decisions: absent vs null on PATCH, a UTC boundary, `?overdue=abc` returning 400, and strict format parsing.
- review scope 4: The change stays on the feature. It adds the plan and spec docs and a layout-only whitespace test, and the `?overdue=false` filter goes slightly beyond the ACs, but all of it was in the approved spec.
- review tests 4: Store and API tests are thorough (PATCH absent/null, invalid dates, UTC boundary, filters). The checkbox filter is not tested interactively, only that the prerendered HTML contains it, and the one existing test change (the `dueDate:null` JSON expectation) is a legitimate update.
- review conventions 4: Validation stays in the store as `ValidationException`, new elements carry testids, and the tests came first as the plan describes. The new testids were not added to the AGENTS.md locators list.
- review architecture 5: A single `IsOverdue` definition in the store serves both the filter and the page. `TimeProvider` is injected through DI, and the page calls the store directly, as AGENTS.md requires.
- review codeQuality 4: The code is clean. The C# 14 `field` accessor with `HasDueDate` is a bit clever, but it is commented and works. `Add` and `Update` parse the date outside the lock, and the explicit `@(" ")` whitespace in the razor page is a small wart.
