# E2E demo-todo · opencode

Model: `mistral/mistral-large-4` · verifier `claude-sonnet-5-5` · review `claude-sonnet-5-5` · adw 0.28.0 (4c61966) · trials: 3

Verifier calibration: `2026-10-12T1659Z` (verifier hash cf30252)

## Summary

| Signal | Value |
|---|---|
| reward rate | 1 |
| median tokens | 3,734,520 |
| median cost (USD) | $0.71 |
| median agent time (s) | 570 |
| review requirements (median) | 5 |
| review scope (median) | 4 |
| review tests (median) | 4 |
| review conventions (median) | 4 |
| review architecture (median) | 4 |
| review codeQuality (median) | 4 |
| error classes | harbor, timeout |

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

## MCP usage

Information only, never a check: every configured server, used or not.

| Server | Trials using | Calls |
|---|---|---|
| serena | 0/3 | 0 |
| playwright | 3/3 | 38 |
| context7 | 0/3 | 0 |

## Trials

### opencode-1

reward 1 · contract 1 · acceptance 1 · own tests 1 · tokens 5,382,965 · cost $1.05 · agent 570 s · tool errors 3
superpowers active: yes
MCP: serena 0 · playwright 11 (browser_snapshot 3, browser_take_screenshot 3, browser_click 3, browser_navigate 1, browser_console_messages 1) · context7 0
built-in: bash 64, read 17, edit 15, skill 7, todowrite 4, glob 3, write 3, task 1

Failed checks: none
Acceptance: AC1 pass · AC2 pass · AC3 pass · AC4 pass · AC5 pass · AC6 pass · AC7 pass

| Model | Input | Output | Cache read | Cache write | Total | Cost |
|---|---|---|---|---|---|---|
| mistral-large-4 | 161,878 | 25,715 | 5,195,372 | 0 | 5,382,965 | $1.05 |

- review requirements 5: All seven acceptance criteria are covered by the spec and the diff, including null-clearing, impossible dates, the UTC overdue rule and the 'überfällig' and 'nur überfällige' labels.
- review scope 4: The code changes are tightly scoped; the only extras are the plan and spec markdown files added to the repo.
- review tests 4: API tests cover valid, invalid, set, clear and overdue-filter cases, and the one changed existing assertion only adds dueDate: null. The new UI (marker, toggle, date format) has no automated test, only a manual Playwright run.
- review conventions 5: It uses ValidationError for 400s, Node builtins only, the existing test helpers, and data-testid on every new UI element, as AGENTS.md requires.
- review architecture 4: Validation and filtering live in the store and the route only passes the query flag through. The overdue rule is duplicated in the UI, but the spec explicitly allows client-side filtering.
- review codeQuality 4: The code is clear and handles the edge cases (impossible dates, non-string values, null clearing). Minor nits: the NaN check is redundant, the date is parsed twice, and the UI hides items with inline styles.

### opencode-2

reward 1 · contract 1 · acceptance 1 · own tests 1 · tokens 3,734,520 · cost $0.71 · agent 1,801 s · tool errors 5 · harbor: AgentTimeoutError
superpowers active: yes
MCP: serena 0 · playwright 12 (browser_take_screenshot 4, browser_snapshot 3, browser_click 3, browser_navigate 1, browser_console_messages 1) · context7 0
built-in: bash 46, edit 12, read 11, skill 6, todowrite 5, write 2, task 1

Failed checks: none
Acceptance: AC1 pass · AC2 pass · AC3 pass · AC4 pass · AC5 pass · AC6 pass · AC7 pass

| Model | Input | Output | Cache read | Cache write | Total | Cost |
|---|---|---|---|---|---|---|
| mistral-large-4 | 84,963 | 19,441 | 3,630,116 | 0 | 3,734,520 | $0.71 |

- review requirements 5: The spec and the diff cover all seven acceptance criteria, including the UTC rule, the null/clear case, the 400 on invalid input, the 'überfällig' marker and the 'nur überfällige' button.
- review scope 2: The .gitignore change removes the existing `node_modules/` entry, which is unrelated and risky. The added plan and spec docs are also extra files.
- review tests 3: API and validation tests are good, including the today/done/no-date boundaries. The UI rendering, marker and toggle are only checked by a static HTML string match plus manual E2E, and the one existing assertion was updated only for the new field.
- review conventions 3: The change uses ValidationError, data-testid attributes and TDD, but it drops `node_modules/` from .gitignore. The summary also says screenshots were saved in `.playwright-mcp/` inside the repo, while AGENTS.md says to save them outside it.
- review architecture 4: Validation sits in the store and the filter in app.mjs, and `store.list()` is untouched, as the spec says. The overdue predicate is inlined in app.mjs and duplicated in the HTML, but that duplication is hard to avoid with zero dependencies.
- review codeQuality 4: The code is concise and correct at the edges: it checks the date round-trip, handles null and a non-string type, and compares UTC dates as strings. The small blemish is the repeated validation block in `add` and `update`.

### opencode-3

reward 1 · contract 1 · acceptance 1 · own tests 1 · tokens 3,420,648 · cost $0.68 · agent 537 s · tool errors 4
superpowers active: yes
MCP: serena 0 · playwright 15 (browser_take_screenshot 5, browser_click 4, browser_snapshot 3, browser_navigate 1, browser_console_messages 1, browser_find 1) · context7 0
built-in: bash 40, todowrite 9, read 8, edit 6, skill 5, write 2

Failed checks: none
Acceptance: AC1 pass · AC2 pass · AC3 pass · AC4 pass · AC5 pass · AC6 pass · AC7 pass

| Model | Input | Output | Cache read | Cache write | Total | Cost |
|---|---|---|---|---|---|---|
| mistral-large-4 | 97,115 | 19,361 | 3,304,172 | 0 | 3,420,648 | $0.68 |

- review requirements 5: The spec and diff cover AC1–AC7: optional date on POST, set and clear on PATCH, 400 on invalid dates, the overdue filter, date display, the "überfällig" marker and the "nur überfällige" button.
- review scope 4: The change stays on the feature; the only extras are the `.gitignore` entry for `.playwright-mcp/` and committed spec and plan docs, which are minor.
- review tests 4: New tests cover POST and PATCH validation, setting and clearing the date, and an overdue filter with yesterday, today, tomorrow, no-date and done cases, and the existing deepEqual test was extended rather than weakened; the UI has no automated test beyond a manual E2E run.
- review conventions 4: The code uses `ValidationError` for HTTP 400, adds no dependencies, gives new UI elements a `data-testid`, and follows TDD; the E2E screenshots were saved in the repo's `.playwright-mcp/` directory instead of outside the repository as AGENTS.md requires.
- review architecture 4: Validation and filtering live in the store and `app.mjs` only passes the query parameter through; the UI repeats the overdue rule on the client, which the spec chose deliberately.
- review codeQuality 4: The code is clean and handles edge cases such as date round-tripping and null; `parseDueDate` throws the same error in two places, and the page computes `today` once at load so it goes stale in a long-open tab.
