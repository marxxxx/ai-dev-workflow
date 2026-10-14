# E2E demo-todo · codex

Model: `openai/gpt-6.1-sol` · verifier `claude-sonnet-5-5` · review `claude-sonnet-5-5` · adw 0.25.0 (ff0376f) · trials: 3

Verifier calibration: `2026-10-12T1659Z` (verifier hash cf30252)

## Summary

| Signal | Value |
|---|---|
| reward rate | 1 |
| median tokens | 3,375,204 |
| median agent time (s) | 1,642 |
| review requirements (median) | 5 |
| review scope (median) | 4 |
| review tests (median) | 5 |
| review conventions (median) | 5 |
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

## Trials

### codex-1

reward 1 · contract 1 · acceptance 1 · own tests 1 · tokens 3,375,204 · agent 1,802 s · tool errors 0 · harbor: AgentTimeoutError
superpowers active: yes

Failed checks: none
Acceptance: AC1 pass · AC2 pass · AC3 pass · AC4 pass · AC5 pass · AC6 pass · AC7 pass

- review requirements 5: All seven acceptance criteria are covered by the spec and the diff, including the strict calendar validation, the UTC overdue rule, the German "überfällig" marker and the "nur überfällige" checkbox.
- review scope 4: The code stays on the ticket, but the diff adds a .gitignore entry for .worktrees/ and committed spec and plan documents that the ticket did not ask for.
- review tests 5: Store and HTTP tests cover validation, atomic PATCH, UTC midnight, one clock reading per list, filter errors and ignored client overdue values. The existing assertions were only extended, not weakened, and the UI was checked with Playwright.
- review conventions 5: The change uses ValidationError mapped to 400, adds data-testid attributes to the new elements, uses Node builtins only, and keeps the existing node:test style.
- review architecture 4: Validation and the overdue projection live in the store and the handler only filters, which fits the layering. The date validator is a standalone function inside the store file, and the page keeps its logic inline in the HTML.
- review codeQuality 4: The code is correct at the edges: it validates before mutating, uses a single clock reading, handles repeated query parameters and renders text safely. The redundant length check before the regex is minor, and the page does not handle fetch errors.

### codex-2

reward 1 · contract 1 · acceptance 1 · own tests 1 · tokens 3,310,041 · agent 1,642 s · tool errors 0
superpowers active: yes

Failed checks: none
Acceptance: AC1 pass · AC2 pass · AC3 pass · AC4 pass · AC5 pass · AC6 pass · AC7 pass

- review requirements 5: All seven acceptance criteria are covered in the spec and the diff, and the spec adds precise edge-case contracts: atomic updates, UTC handling, and filter validation.
- review scope 4: The change stays on the feature, but it adds a .worktrees/ entry to .gitignore, stale-response and error handling that the ticket did not ask for, and extensive plan and spec docs.
- review tests 5: Store, HTTP and page tests cover the new behaviour thoroughly, including leap years, UTC midnight, atomic rejection, filter validation and stale responses; the only existing assertions touched were extended, none weakened or removed.
- review conventions 5: The change keeps to zero dependencies, uses ValidationError mapped to 400, follows TDD, and adds data-testid attributes to every new element as AGENTS.md asks.
- review architecture 5: Validation and the overdue projection live in the store, the filter parameter is validated in app.mjs, and the page reuses the API's overdue value without computing its own.
- review codeQuality 4: The code is correct and compact, but the date validator has a redundant length check and an awkward invalid() closure, and the page test harness is somewhat heavy.

### codex-3

reward 1 · contract 1 · acceptance 1 · own tests 1 · tokens 3,437,030 · agent 1,556 s · tool errors 0
superpowers active: yes

Failed checks: none
Acceptance: AC1 pass · AC2 pass · AC3 pass · AC4 pass · AC5 pass · AC6 pass · AC7 pass

- review requirements 5: The spec and diff cover all seven acceptance criteria, including UTC overdue semantics, the 400 responses, the exact 'überfällig' marker and the 'nur überfällige' control, plus sensible edge rules such as the year range and the repeated filter parameter.
- review scope 4: The extra non-object JSON body rejection and the `overdue=false` filter go slightly past the ACs, but both were in the approved spec, and the plan and spec docs are process artifacts.
- review tests 5: The new tests cover leap years, UTC day boundaries, atomic PATCH, both filter values, invalid queries, stale responses, error recovery and literal titles; the only existing test change is the agreed extra response fields.
- review conventions 4: It stays dependency-free, uses ValidationError for HTTP 400, follows TDD and adds data-testid attributes, though the dense inline filter condition in app.mjs is a bit out of step with the surrounding style.
- review architecture 4: Validation and overdue computation live in the store, filtering stays in the handler, and the page reuses the API result; the filter check inside the route handler is slightly cluttered.
- review codeQuality 4: The code is correct, with atomic updates, a single UTC day per list and stale-response guards; minor nits are a redundant length check next to the regex and clearing the list before every fetch.
