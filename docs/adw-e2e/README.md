# ADW E2E self-test

Runs the full `agent-dev` workflow headlessly in Claude Code, Codex and OpenCode against the
`demo-todo` task (a todo API + list page, ticket #1 in a throwaway Gitea), scores every trial and
compares result sets. Design: `docs/superpowers/specs/2026-10-11-adw-e2e-self-test-design.md`.
Agentic verification: docs/superpowers/specs/2026-10-12-adw-e2e-agentic-verification-design.md.

## Prerequisites (host)

- Docker, and the local image: `node docker/build.mjs`
- Harbor 0.24.0: `uv tool install harbor==0.24.0`
- Logins, used as copies and never committed:
  - Claude: `claude setup-token`, then put `CLAUDE_CODE_OAUTH_TOKEN=<token>` into `e2e/.env`
  - Codex: `codex login --device-auth` (refresh it if a model is refused)
  - OpenCode: `opencode auth login` for the configured provider

### Windows

Run the self-test inside **WSL2**. Native Windows is not supported, and the preflight refuses it.
- Install Ubuntu (`wsl --install -d Ubuntu`) and Docker Desktop with WSL integration for that
  distribution. Give Docker 8 GB of RAM: Gitea, the agent container and headless Chromium run per
  trial.
- Clone the repo **inside** the WSL filesystem (`~/src/...`), not under `/mnt/c/...`. File modes,
  CRLF line endings and I/O speed break the task there, and the preflight warns about it.
- Install Node 24, uv, Harbor and the `claude`/`codex`/`opencode` CLIs inside WSL, then log in
  again there. Windows logins are not visible to WSL. Device-login links open in the Windows
  browser.
- Build the image inside WSL (`node docker/build.mjs`). Results can be reached from Windows under
  `\\wsl$\Ubuntu\home\<user>\src\ai-dev-workflow`.

## Run

    node e2e/run.mjs preflight
    node e2e/run.mjs run                        # all harnesses, 3 trials each (~1.5–2 h)
    node e2e/run.mjs run --harness codex --repetitions 1
    node e2e/run.mjs compare docs/adw-e2e/<old>/codex docs/adw-e2e/<new>/codex
    node e2e/run.mjs verify docs/adw-e2e/<ts>/<harness> [--trial <id>]   # re-judge stored PR heads, no agent run
    node e2e/run.mjs calibrate [--runs 2]       # judge the known variants; needed after any verifier change

The simulated user, the E2E verifier, the review judge and the claude-code harness all draw on the one Claude subscription. Each trial adds two Sonnet runs (verifier and review); a calibration adds 20. A full run can exhaust the subscription's 5-hour limit: split it per harness across limit windows. The codex harness draws on the ChatGPT subscription's limit the same way. A trial that hits either limit (`quota` error class) aborts the run; the partial result is marked `aborted` and is never used as a baseline. Delete it and rerun after the reset. A `verify` or `calibrate` that hits a limit writes nothing.

Raw Harbor output: `e2e/jobs/<ts>/` (inspect with `harbor view e2e/jobs/<ts>`).

`npm test` runs the e2e unit tests (`e2e/lib/*.test.mjs` and the verifier's `checks.test.mjs`).

## Read the results

`docs/adw-e2e/<ts>/<harness>/`:
- `run.json`: fingerprint (incl. verifier hash and role models), calibration, per-trial checks, acceptance criteria, metrics and review, plus the summary.
- `report.md`: the same data for humans.
- `evidence/<trial>/`: ticket comments, PR diff, own test output, `pr-head.bundle` (the PR head, re-verifiable), `acceptance.json` (per-criterion verdicts with evidence), `review.json` (scores and reasons)
- `compare.md`: the verdict against the baseline. The baseline is the newest earlier result on `main`.

`summary.md` puts the harnesses side by side.

`docs/adw-e2e/calibration/<ts>/`: calibration verdicts (`report.md`, `calibration.json`)

To re-render a `report.md` from its `run.json` (e.g. after a report template change), run
`node e2e/run.mjs report <harnessDir>`.

| Signal | Meaning |
|---|---|
| reward | All contract checks, own tests (`TEST_COMMAND`) and every acceptance criterion passed; `—` when the verifier could not judge |
| contract | Share of contract checks passed (ticket edges, naming, draft PR, e2e via Playwright, app stopped, no screenshots in the repo) |
| acceptance / `ac:ACn` | Share of acceptance criteria an agentic verifier observed in the running app, and the pass rate per criterion (`e2e/tasks/<task>/acceptance-criteria.md`) |
| review | 1–5 per criterion from a code review with read access to the repo: requirements, scope, tests, conventions, architecture, code quality |
| tokens | Target agent only, from its own session logs (cross-checked with ccusage) |

A report that says **Verifier not calibrated** has no passing calibration for its verifier hash (prompts, verifier/review models, review criteria, acceptance criteria). Run `calibrate` before trusting acceptance and review.

Variance is large between identical runs. Compare rates and medians, never single trials.
`inconclusive` means the spread is bigger than the difference.

## Changing the test

- `e2e/config.json`: models, repetitions, thresholds, rubric. Any change shows in the fingerprint,
  so treat it as a deliberate comparison.
- Acceptance criteria (`acceptance-criteria.md`) describe observable behaviour only: no endpoints, parameters or field names, and only what the briefing (`instruction.md`) actively communicates or what follows unambiguously from the ticket.
- Any change to the criteria, the verifier or review prompt, their models or `review.criteria` changes the verifier hash: run `calibrate`, and keep the calibration variants (`calibration/*.patch`, `expected.json`) in step with the criteria.
- Never add checks on superpowers internals: path names, worktrees, TDD order, review steps.
