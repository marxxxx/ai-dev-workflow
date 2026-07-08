# E2E Runtime: How to Start the App for Acceptance Testing

This file is the single source of truth for bringing the application (and its backing services)
up and down for end-to-end testing. It is generated from
`agent-src/includes/e2e-runtime-configured.md` because this project declared an `e2e` block in
`ai-project.json`. To change the commands, edit `e2e` in `ai-project.json` and regenerate — do not
edit this file by hand.

## The contract

Two project-owned commands implement a fixed contract the QA agent depends on:

- **Up:** `{{app.up}}`
  - Starts backing services (database, cache, broker, …), applies migrations/seed, and starts the
    application processes (backend, then frontend).
  - **Blocks until the app is actually reachable** — it does not return early.
  - Prints one `BASE_URL=<url>` line per reachable app to stdout (the first is the primary URL to
    drive in the browser).
  - Writes service/app logs under `{{app.logsDir}}`.
  - Exits `0` when everything is ready; non-zero on any failure or if readiness is not reached
    within `{{app.readinessTimeout}}` seconds.
- **Down:** `{{app.down}}`
  - Idempotently tears down everything `up` started. Safe to run even if `up` failed partway.

## Procedure (run via the Bash tool)

1. Run `{{app.up}}`. Wait for it to exit, then branch on the outcome:
   - **Exit 0 with a `BASE_URL=<url>` line** → the app is up; continue at step 2.
   - **Exit 0 with no `BASE_URL=` line** → no app is available for browser testing (e.g. the stub
     script is not yet implemented). **Skip** browser e2e: run the automated suite only, mark
     UI/interactive criteria `NEEDS HUMAN REVIEW` with a note, and do **not** fail the item for it.
     Then run `{{app.down}}` and stop here.
   - **Non-zero exit, or readiness exceeds `{{app.readinessTimeout}}` seconds** → a real failure:
     capture the output and the logs under `{{app.logsDir}}`, run `{{app.down}}`, and **report a
     blocker** — do not claim a pass and do not improvise alternative start commands.
2. Read the `BASE_URL=<url>` value(s) from the `up` output. Use the primary URL as the browser
   target — never hardcode a port or guess a URL.
3. Drive the running app with the Playwright MCP browser tools against that `BASE_URL`: exercise
   each objectively testable acceptance criterion as a real user would.
4. Capture evidence for UI criteria: screenshots, and relevant console/network errors. Store local
   evidence under `.playwright-mcp/test-results/` when that convention is available; app/service
   logs live under `{{app.logsDir}}`.
5. **Always run `{{app.down}}` when finished** — including when a test fails or you hit a blocker.
   Leaving services running is a defect in the run, not a pass condition.

## Rules

- A running app is required for a functional PASS on UI/interactive criteria. Do not substitute
  unit tests, direct component/method calls, mocked events, API-only checks, or DOM-state injection
  for browser verification against `BASE_URL`.
- A **non-zero** `up` (or a readiness timeout) is a blocker to report — not a `NEEDS HUMAN REVIEW`
  and not a silent pass. A **clean exit 0 without a `BASE_URL`** is a deliberate skip (handled in
  step 1), not a failure.
- Never edit the application, its tests, or the `up`/`down` scripts to make a test pass.
