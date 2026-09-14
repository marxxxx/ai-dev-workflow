# E2E Runtime For Acceptance Testing

This generated include defines how QA starts and tests the application. Edit
`agent-src/includes/e2e-runtime.md`, then regenerate.

Treat the **End-to-end testing** section of the project's `AGENTS.md` as the runtime contract.

## Procedure

1. Read that section, then choose one path:
   - If it documents the app and backing services, continue.
   - If it is absent or documents no E2E setup, run the automated suite only. Mark affected
     UI/interactive criteria `NEEDS HUMAN REVIEW`, explain that E2E is left to the human, and do not
     fail the ticket for the missing setup. Stop this procedure.
2. Translate the documented setup into commands for the current OS. Stop a prior instance only when
   it is positively identified as this project's and safe to stop; if ownership is uncertain, report
   a blocker. Start required backing services, apply documented migrations or seed data, start the
   app, and wait until its documented base URL is reachable.
3. Use Playwright MCP against the running app. Exercise each objectively testable criterion through
   user-visible behavior; do not substitute unit tests, API-only checks, direct internal calls, or DOM
   injection.
4. Capture relevant screenshots and console/network errors. Store evidence under
   `.playwright-mcp/test-results/` when that convention is available.
5. Always stop the app and every service started for the run, including after failures or blockers.

## Rules

- Never invent startup commands, ports, or waits that `AGENTS.md` does not define.
- A UI/interactive functional `PASS` requires a running app and browser verification.
- Failure of documented startup, readiness, a required service, or Playwright is a blocker. Capture
  logs and report it in `{{artifact.testResults}}`; do not claim a pass.
- Never edit the application or tests to make QA pass.
