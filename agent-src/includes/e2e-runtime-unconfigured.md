# E2E Runtime: Not Configured

This file is the single source of truth for how the QA agent handles end-to-end app startup. It is
generated from `agent-src/includes/e2e-runtime-unconfigured.md` because this project has **not**
declared an `e2e` block in `ai-project.json`, so there is no reliable, project-owned way to start
the application for browser testing.

Do not improvise start commands (`npm start`, `dotnet run`, guessed ports, ad-hoc readiness waits).
Improvised startup is exactly the unreliability this workflow avoids.

## Procedure

1. Run the automated test suite (backend and frontend) and confirm it passes. This remains
   required and is the basis for the functional result.
2. **Skip browser-based end-to-end testing.** There is no configured runtime to start the app.
3. For every acceptance criterion that requires a running app (UI, navigation, interactive
   behavior, cross-service flows), mark it `NEEDS HUMAN REVIEW` — do **not** mark it PASS, and do
   **not** mark it FAIL solely because e2e is unconfigured.
4. In your `{{artifact.testResults}}` comment, add a clear note that end-to-end verification was
   skipped because no e2e runtime is configured, and list each `NEEDS HUMAN REVIEW` criterion so a
   human can test it manually.

## Result

- Base the PASS/FAIL status transition on the automated suite and any criteria you could verify
  without a running app.
- The absence of an e2e runtime is **not** a functional failure on its own. Do not move the item to
  the failed state just because browser testing could not run — hand off with the human-review notes
  instead.

## To enable end-to-end testing

Add an `e2e` block to `ai-project.json` (`up`, `down`, `readinessTimeout`, `logsDir`) pointing at
project-owned start/stop scripts, then regenerate. Re-run `ai-dev-workflow init` and choose an e2e
stack to scaffold starter scripts. This file will be replaced by the concrete startup contract.
