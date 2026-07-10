# E2E Runtime: How to Start the App for Acceptance Testing

This file is the single source of truth for how the QA agent starts the application (and its backing
services) for end-to-end testing. It is generated from `agent-src/includes/e2e-runtime.md`. Do not
edit it here — edit the source and regenerate.

The workflow does **not** ship start/stop scripts. Instead, the project's `AGENTS.md` describes, in
prose, **what** it takes to bring the e2e environment up; you translate that into the concrete
commands appropriate for the machine you are running on (Windows or Linux). If `AGENTS.md` does not
describe an e2e setup, end-to-end testing is left to the human.

## Procedure

1. Read the **End-to-end testing** section of `AGENTS.md` (the project's e2e-infrastructure setup
   contract). Then branch:
   - **It describes how to bring up the app + backing services** → continue at step 2.
   - **It has no e2e-setup instructions (or no `AGENTS.md`)** → **skip** browser e2e: run the
     automated suite only, mark UI/interactive criteria `NEEDS HUMAN REVIEW` with a note that
     **end-to-end testing is left to the human** because the project describes no e2e setup, and do
     **not** fail the {{ticketing.itemNoun}} for it. Stop here.
2. Follow the `AGENTS.md` steps to bring the environment up, translating each into concrete commands
   for the current OS: start backing services (db/cache/broker), apply any migrations/seed, then
   start the app. **Block until the app is actually reachable** — poll it; do not proceed early.
   Determine the base URL the app serves from (as `AGENTS.md` describes, e.g. its **Ports & URLs**).
3. Drive the running app with the Playwright MCP browser tools against that base URL: exercise each
   objectively testable acceptance criterion as a real user would. Do not substitute unit tests,
   API-only checks, or DOM-state injection for browser verification.
4. Capture evidence for UI criteria: screenshots, and relevant console/network errors. Store local
   evidence under `.playwright-mcp/test-results/` when that convention is available.
5. **Always tear the environment back down when finished** — stop the app process and any backing
   services `AGENTS.md` had you start — including when a test fails or you hit a blocker. Leaving
   services running is a defect in the run, not a pass condition.

## Rules

- A running app is required for a functional PASS on UI/interactive criteria. Do not improvise
  startup when `AGENTS.md` says nothing — an absent e2e setup is a deliberate skip (`NEEDS HUMAN
  REVIEW`), not a failure and not a guess.
- A genuine failure while following the described setup (services won't start, the app never becomes
  reachable) is a **blocker** to report in your `{{artifact.testResults}}` comment — not a silent
  pass. Capture the output/logs.
- Never edit the application or its tests to make a test pass.
