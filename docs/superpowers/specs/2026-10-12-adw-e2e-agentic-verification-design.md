# ADW E2E: agentic verification (revision of the self-test spec)

Revises `2026-10-11-adw-e2e-self-test-design.md`. It replaces that spec's hidden acceptance tests and
its judge. Every section of the original spec not named here stays in force.

## Problem

The first baseline showed that hidden unit and UI tests measure interface choices the agent may
legitimately make, not behaviour:
- opencode-3 built `GET /todos?overdue=1` instead of `?overdue=true`. That matched its approved spec,
  and the simulated user had approved it, yet the trial failed the hidden API test.
- The tests also inherit unstated assumptions from the seed app:
  - `createApp()` returns a fresh store;
  - ids are sequential from 1, so the test patches `/todos/5` directly;
  - list items are `<li>`;
  - the server starts via `src/server.mjs`.
- Hidden tests cannot be carried over to consumer projects (sub-project 3). Each project would need a
  hand-written suite in its own stack, and .NET support is mandatory.

## Goal

- Judge a trial's outcome by:
  - functional acceptance criteria, checked by an agentic E2E verifier against the running app;
  - a code review with repository access, covering quality, conventions and architecture.
- Neither may depend on the agent's interface choices or on the stack.
- Both must be re-runnable on a stored result without re-running the agent.
- Their accuracy is calibrated on known solutions.

## Non-goals

- A .NET demo task. This revision only removes every Node assumption from the host side and the
  verifier. A .NET task (on `ai-dev-workflow-dotnet`) gets its own spec.
- Consumer mode (sub-project 3). It reuses this design later.

## Decisions

| Topic | Decision |
|---|---|
| Hidden tests | Removed. Replaced by acceptance criteria and an agentic E2E verifier. |
| What the verifier may know | **Discover, judge against the criteria.** It may read the PR (diff, code, `AGENTS.md`) to learn *how* to exercise a feature, but it judges only against the fixed acceptance criteria. It never sees the agent's spec, ticket or summary. |
| Where verification runs | On the host, after the trial, from a `git bundle` of the PR head. It is re-runnable with `run.mjs verify`. |
| Separation | The E2E verifier and the review judge are two independent runs. Neither sees the other's result. |
| Models | Configurable per role in `e2e/config.json`: target, subagents, simulated user, verifier, review. The default for verifier and review is `claude-sonnet-5-5`. Every role model is part of the fingerprint. |
| Calibration | Full calibration: five known variants, 2 runs each, and a `verifierHash` gate that warns and does not block. |
| Own tests | `own_tests_pass` stays. The command comes from the task (`TEST_COMMAND`), not from a hard-coded `node --test`. |

## Flow per trial

1. **Agent phase** (Harbor): unchanged.
2. **Deterministic verifier** (container, `tests/verify.mjs`):
   - It runs the contract checks (unchanged; `e2e_performed` is still computed on the host).
   - `own_tests_pass` runs `$TEST_COMMAND` on the PR head. The task sets it in `task.toml` under
     `[verifier.env]`; demo-todo uses `npm test`.
   - It writes the evidence: `ticket.json`, `pulls.json`, `pr.diff`, `pr-commits.txt`.
   - **New:** it writes `pr-head.bundle`, a `git bundle` containing `main` and the PR branch.
   - **Removed:** the hidden API and UI tests and the app start.
3. **Post-verification** (host, `e2e/lib/postverify.mjs`): it checks out the bundle fresh and then
   runs:
   - the E2E verifier, which writes `evidence/<trial>/acceptance.json`;
   - the review judge, which writes `evidence/<trial>/review.json` (it replaces `judge.json`).

`run` calls post-verification after each trial. The command `node e2e/run.mjs verify <resultDir>
[--trial <id>]` re-runs it from the committed bundles, then rewrites `run.json`, `report.md` and
`summary.md`.

The bundles are committed as `evidence/<trial>/pr-head.bundle`. For demo-todo they are a few KB. They
go through the same secret scan as every result file.

## Acceptance criteria

The file is `e2e/tasks/demo-todo/acceptance-criteria.md`, and the agent never sees it.
- Each criterion has an id (`AC1`…) and is phrased as observable behaviour.
- Exact names appear only where a user sees them: the word "überfällig" and the control label "nur
  überfällige".
- No endpoint paths, query parameters or field names.

| Id | Criterion |
|---|---|
| AC1 | A todo can optionally get a due date when it is created. The date is a calendar date without a time. |
| AC2 | The due date can be changed later and removed again. |
| AC3 | An invalid date (wrong format, an impossible date such as 30 February) is rejected with HTTP 400. |
| AC4 | The API can return only overdue todos. A todo is overdue when it is not done and its due date is before today (UTC). Todos without a due date, and done todos, are never overdue. |
| AC5 | The list page shows each todo's due date. |
| AC6 | Overdue todos in the list are marked with the word "überfällig"; other todos are not. |
| AC7 | A control labelled "nur überfällige" filters the list to overdue todos. |

The simulated user's briefing (`instruction.md`) becomes behavioural in the same way:
- `GET /todos?overdue=true` becomes "the API can filter for overdue todos";
- the field name `dueDate` and the format `YYYY-MM-DD` remain only as "a calendar date without a
  time".

The rule for acceptance criteria replaces the original spec's rule for hidden tests: criteria may
only cover requirements that the briefing actively communicates, or that follow unambiguously from
the ticket.

## E2E verifier

- **Image and container:**
  - `postverify` builds the task image itself from `e2e/tasks/<task>/environment/Dockerfile` as
    `adw-e2e-<task>`, using the Docker cache.
  - It runs a fresh container with the checkout mounted at `/workspace`.
  - The startup seed hook for Gitea is not run.
  - The container is removed afterwards, including when the run fails.
- **Call:** `claude -p --model <verifier.model> --output-format json --mcp-config <playwright>`.
  - Allowed tools: Bash (start the app, curl), Read, Grep, Glob and the Playwright MCP tools.
  - Denied tools: Edit, Write, NotebookEdit, Task, WebFetch and WebSearch.
- **Auth:** `CLAUDE_CODE_OAUTH_TOKEN` comes from the same secret staging as `run`. It is passed into
  the container only as an inherited environment variable (`-e NAME`), never as a value on the
  command line.
- **Prompt input:** the acceptance criteria and a pointer to the "End-to-end testing" section of
  `AGENTS.md` (how to start the app, readiness, base URL, how to stop). The prompt instructs it to:
  - create its own test data through the app;
  - explore the diff and code only to learn how to exercise a feature;
  - judge strictly against the criteria;
  - never change repository files;
  - stop the app at the end.
- **Output:** JSON, validated against a schema:
  `{"criteria": [{"id": "AC1", "pass": true, "evidence": "<steps and observation>"}]}`. Every
  criterion id must appear exactly once.
- **Limits:** 15 min timeout (`verifier.timeoutSec`).
- **Failure:** a crash, a timeout, invalid JSON or a missing criterion makes `acceptance` `null`,
  with error class `verifier`. A usage-limit rejection counts as `quota` and aborts the run like
  today. A broken verifier must never look like a bad agent.

`acceptance` is the share of criteria that passed. `reward` = 1 only if `contract == 1`,
`ownTests == 1` and `acceptance == 1`.

## Review judge

- **Call:** `claude -p --model <review.model> --output-format json`, run on the host with the fresh
  checkout as cwd.
  - Allowed tools: Read, Grep and Glob only.
  - It reads `AGENTS.md`, the surrounding code and existing patterns itself.
- **Prompt input:** the acceptance criteria (as the requirements yardstick), the posted `Approved
  Spec` comment, the `Implementation Summary`, and the path to `pr.diff`. It does not see the E2E
  verifier's result.
- **Stack knowledge:** none in the prompt. It derives conventions from `AGENTS.md` and the code.
- **Criteria:** each scored 1–5 with a one-sentence reason, configured in `config.json` under
  `review.criteria`:

| Criterion | Question |
|---|---|
| `requirements` | Do the spec and the diff capture every acceptance criterion? This measures interview quality by its outcome. |
| `scope` | No unrequested features, no unrelated changes? |
| `tests` | Do the agent's new tests meaningfully cover the new behaviour? Were existing tests deleted or weakened? |
| `conventions` | Does the code follow `AGENTS.md` and the repo's idioms (naming, error handling, test style)? |
| `architecture` | Does the change fit the existing structure (where logic lives, layering, reuse instead of duplication)? |
| `codeQuality` | Is the code readable and correct at the edges, without needless complexity? |

- **Failure:** unchanged from the original judge. Scores become `null` with error class `judge`; a
  usage limit counts as `quota`.

## Calibration

Calibration checks that the verifier and the review judge judge correctly before anyone trusts their
verdicts. It runs without any agent run.

**Variants** are patches on the seed repo in `e2e/tasks/demo-todo/calibration/<variant>.patch`.
`expected.json` holds the expected verdicts:

| Variant | Content | Expected |
|---|---|---|
| `reference` | clean solution | all criteria pass; every review criterion ≥ 4 |
| `alt-interface` | correct, with different interfaces: `?overdue=1`, German date display, different markup | all criteria pass |
| `broken-done` | the overdue filter ignores `done` | AC4 fails, all others pass |
| `broken-ui` | no "nur überfällige" control and no "überfällig" marker | AC6 and AC7 fail, all others pass |
| `messy` | functionally correct, but validation is inline in `app.mjs` instead of `ValidationError` in the store, date logic is duplicated, and there are no new tests | all criteria pass; `conventions`, `architecture` and `tests` are each ≥ 2 points below `reference` |

**Command `node e2e/run.mjs calibrate [--runs n]`** (default n = 2):
- It builds one bundle per variant from the seed repo plus the patch.
- It runs the same post-verification as `verify` n times on each bundle.
- It compares every verdict with `expected.json`:
  - A criterion verdict must match in every run. A mismatch in only some runs is reported as
    `flaky`; a mismatch in all runs is `wrong`.
  - The review expectations are checked on the median per variant.
- It writes `docs/adw-e2e/calibration/<ts>/report.md` and `calibration.json`, both committed.
- Calibration passes only without any `wrong` or `flaky` verdict.

**`verifierHash`** is a hash over:
- the verifier and review prompts;
- `verifier.model` and `review.model`;
- `review.criteria`;
- the acceptance criteria.

It is part of the fingerprint and of `calibration.json`. `run` looks for the newest passing
calibration with the same hash. If none exists, `report.md` and `compare.md` show "verifier not
calibrated". This is a warning and does not block the run.

Cost: 5 variants × 2 runs × 2 roles = 20 Sonnet runs, no agent run.

## Results, compare and fingerprint

- `run.json` gets `schema: 2`. Per trial:
  - `acceptanceCriteria` maps each AC id to `pass`, `fail` or `null`;
  - `acceptance` is the ratio;
  - `review` and `reviewReasons` replace `judge` and `judgeReasons`;
  - `verifierError` and `reviewError` record failures.
- The fingerprint adds `verifierHash` and the role models (`simulatedUser`, `verifier`, `review`).
- `summary.checkRates` gains one rate per AC id (`ac:AC4`), so compare names the exact behaviour that
  broke. Review criteria are compared like the old judge criteria, with threshold `judgeMedianDrop`.
- `findBaseline` and `compare` ignore schema-1 runs. Those runs have no bundles and cannot be
  re-verified. The two schema-1 baseline directories committed on the feature branch (5f177c5) are
  deleted. They never reached `main`.

## Testing

Unit tests run in `npm test`, with no LLM and no Docker:
- `verify.mjs`: `own_tests_pass` uses `TEST_COMMAND`.
- Verifier and review prompt building: they contain the criteria and the `AGENTS.md` pointer; the
  verifier prompt never contains the spec or the ticket.
- Output parsing and schema validation: a missing or duplicate criterion, an invalid score, and a
  fenced JSON result.
- Error classification: a crash or invalid output gives `verifier`/`judge`; a usage limit gives
  `quota`.
- `postverify`: the Docker arguments pass the token only as `-e NAME`, never as a value. Docker and
  the CLI are injected as functions in the tests.
- Calibration comparison: `wrong`, `flaky`, the median-based review check, and the pass verdict.
- `verifierHash` stability and sensitivity; the schema-1 filter in `findBaseline` and `compare`;
  per-AC rates in `summarizeTrials`.

## Verification (acceptance of this revision)

1. `npm test` is green.
2. `node e2e/run.mjs calibrate` passes with no `wrong` and no `flaky` verdict.
3. `node e2e/run.mjs run --harness claude-code --repetitions 1` produces a plausible
   `acceptance.json` and `review.json`, and the report shows the verifier as calibrated.
4. `node e2e/run.mjs verify` on that result reproduces it from the committed bundle (same per-AC
   verdicts).
5. The new baseline, 3 trials per harness including codex, is measured afterwards by the user, split
   across usage-limit windows.

## Risks

- **Verifier variance.** Mitigated by fixed criteria and per-criterion verdicts with evidence. The
  calibration detects flakiness, and `verify` allows re-judging without agent cost.
- **Verifier quota.** Two extra Sonnet runs per trial draw on the Claude subscription, which is
  already the bottleneck. Mitigated by the Sonnet default and the quota abort.
- **The verifier reads the agent's code and adopts its view.** Mitigated by the prompt rule "judge
  only against the criteria", and checked by `broken-done`: the code there looks deliberate, but
  AC4 must still fail.
