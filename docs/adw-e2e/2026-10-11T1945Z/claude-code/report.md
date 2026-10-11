# E2E claude-code

Model: `claude-opus-5-5` · adw 0.25.0 (15f57c8) · trials: 1

## Summary

| Signal | Value |
|---|---|
| reward rate | 1 |
| median tokens | 5,369,728 |
| median agent time (s) | 537 |
| judge requirements (median) | 5 |
| judge scope (median) | 3 |
| judge tests (median) | 4 |
| judge readability (median) | 5 |
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

## Trials

### claude-code-1

reward 1 · contract 1 · acceptance 1 · own tests 1 · tokens 5,369,728 · agent 537 s · tool errors 9
superpowers active: yes

Failed checks: none

- judge requirements 5: The spec and diff cover every briefing bullet: an optional `YYYY-MM-DD` dueDate on POST and PATCH (including clearing with null), 400 for bad formats and impossible dates, `?overdue=true` using UTC with no-date todos excluded, the date shown next to the title, the 'überfällig' marker and the 'nur überfällige' toggle.
- judge scope 3: Several things were added that nobody asked for: an `overdue` field in every response, a `?overdue=false` filter, 400 errors for other filter values, red colouring despite 'no styling work', and an atomic-PATCH refactor of existing update behaviour.
- judge tests 4: Store and HTTP tests thoroughly cover validation edge cases (leap days, impossible dates, wrong types), clearing via null, overdue logic at the UTC boundary and the filter, but the UI is only checked by regex on the HTML source, with real behaviour left to the agent's E2E run.
- judge readability 5: The code is small and idiomatic, matches the existing style of the repo, separates concerns cleanly (a pure isOverdue, an injectable clock, a readListFilter helper) and keeps comments short and useful.
