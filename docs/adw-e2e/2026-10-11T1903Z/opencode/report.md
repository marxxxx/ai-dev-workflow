# E2E opencode

Model: `mistral/mistral-large-4` · adw 0.25.0 (15f57c8) · trials: 3

## Summary

| Signal | Value |
|---|---|
| reward rate | 0 |
| median tokens | 1,478,185 |
| median agent time (s) | 398 |
| judge requirements (median) | 3 |
| judge scope (median) | 5 |
| judge tests (median) | 4 |
| judge readability (median) | 4 |
| error classes | none |

## Check pass rates

| Check | Rate |
|---|---|
| ticket_open | 1 |
| ticket_review | 1 |
| spec_comment | 1 |
| spec_comment_complete | 1 |
| summary_comment | 0.67 |
| cost_comment | 1 |
| only_allowed_comments | 1 |
| pr_draft | 1 |
| branch_naming | 1 |
| pr_title_naming | 1 |
| e2e_performed | 0 |
| app_stopped | 1 |
| no_screenshots_in_repo | 1 |
| acceptance | 0.33 |
| ownTests | 1 |

## Trials

### opencode-1

reward 0 · contract 0.9231 · acceptance 0.8571 · own tests 1 · tokens 1,083,825 · agent 381 s · tool errors 0
superpowers active: no

Failed checks: e2e_performed

- judge requirements 2: The spec and the code both leave out the briefing's rule that done todos are never overdue: `list({overdue})` and the UI badge never check `done`. They also use the server's local date instead of UTC for "today", so two core rules of the overdue filter are wrong even though format, validation, PATCH clearing and the UI display are covered.
- judge scope 5: The changes stay inside the requested feature: no sorting, reminders, styling work or unrelated refactors; the only additions are the workflow's spec and plan files and the `data-testid` hooks.
- judge tests 3: Validation, PATCH clearing and the overdue filter have solid store and API tests, but the date fixtures use UTC (`toISOString`) while the code compares against local time, so the tests can fail near midnight. There is no test that done todos are excluded and no automated test of the UI rendering or toggle.
- judge readability 4: The code is clean, idiomatic and matches the repo's style, with minor duplication: the date-string helper exists in both client and server, and the same error message is repeated three times in `validateDueDate`.

### opencode-2

reward 0 · contract 0.9231 · acceptance 1 · own tests 1 · tokens 1,478,185 · agent 398 s · tool errors 0
superpowers active: no

Failed checks: e2e_performed

- judge requirements 4: The spec and diff cover every briefing item: optional `dueDate`, create/patch/clear, 400 on bad formats and impossible dates, the overdue filter, the due-date display, the „überfällig“ marker and the „nur überfällige“ toggle; however, the spec says „heute“ is the server's day instead of UTC (the code does use UTC).
- judge scope 5: No sorting, reminders or styling were added, and the only extra files are the spec and plan that the workflow itself produces.
- judge tests 4: The API tests are thorough (valid and invalid dates, including 2026-02-30, PATCH set/clear, and an overdue filter with done, future and undated todos), but the UI test only greps the HTML for testids, so the UI behaviour rests on the agent's Playwright run, which is not committed.
- judge readability 4: The code is clean, small and matches the repo's style, but the overdue rule is written twice (server filter and client `isOverdue`), and the summary first calls the date the server's "local" date before saying it is UTC-based.

### opencode-3

reward 0 · contract 0.8462 · acceptance 0.8571 · own tests 1 · tokens 1,486,443 · agent 422 s · tool errors 0
superpowers active: no

Failed checks: summary_comment, e2e_performed

- judge requirements 3: Almost every requirement is in the diff, including optional dueDate, PATCH clearing, 400 for impossible dates, the UTC overdue rule, the due date shown in the list, the „überfällig“ marker and the „nur überfällige“ toggle, but the briefing asked for `GET /todos?overdue=true` and the spec and code only accept `?overdue=1`, so `?overdue=true` returns the unfiltered list.
- judge scope 5: The changes cover only the requested feature plus the workflow's spec and plan files, with no sorting, reminders or styling.
- judge tests 4: Store and API tests cover validation (including impossible dates and non-strings), setting and clearing via PATCH, and all overdue edge cases, but no automated test covers the UI and the Playwright end-to-end check was not committed.
- judge readability 5: The code is small and idiomatic and follows the existing style: the validation helper and `render`/`load` refactor are clean, `data-testid` naming is consistent, and the only nit is a missing trailing newline in the spec file.
