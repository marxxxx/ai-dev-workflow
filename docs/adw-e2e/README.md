# ADW E2E self-test

Runs the full `agent-dev` workflow headlessly in Claude Code, Codex and OpenCode against two
tasks with the same ticket (#1 in a throwaway Gitea): `demo-todo`, a Node todo API with a list page,
and `demo-todo-dotnet`, the same app as a .NET 10 Blazor Server app with a minimal API. It scores
every trial and compares result sets. Design: `docs/superpowers/specs/2026-10-11-adw-e2e-self-test-design.md`.
Agentic verification: `docs/superpowers/specs/2026-10-12-adw-e2e-agentic-verification-design.md`.
.NET task: `docs/superpowers/specs/2026-10-12-adw-e2e-dotnet-task-design.md`.

## Prerequisites (host)

- Docker, and the local images: `node docker/build.mjs` (builds `ai-dev-workflow-node` and `ai-dev-workflow-dotnet`)
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
    node e2e/run.mjs run                        # every task × harness, 3 trials each (~3–4 h)
    node e2e/run.mjs run --harness codex --task demo-todo --repetitions 1
    node e2e/run.mjs compare docs/adw-e2e/<old>/<task>/codex docs/adw-e2e/<new>/<task>/codex
    node e2e/run.mjs verify docs/adw-e2e/<ts>/<task>/<harness> [--trial <id>]   # re-judge stored PR heads, no agent run
    node e2e/run.mjs calibrate [--task <task>] [--runs 2]   # judge the known variants per task; needed after any verifier change

The simulated user, the E2E verifier, the review judge and the claude-code harness all draw on the one Claude subscription. Each trial adds two Sonnet runs (verifier and review); a calibration adds 20 per task. A full run (every task × harness) can exhaust the subscription's 5-hour limit: run one harness per limit window (`--harness`); it covers every task. The codex harness draws on the ChatGPT subscription's limit the same way. A trial that hits either limit (`quota` error class) aborts the run; the partial result is marked `aborted` and is never used as a baseline. Delete it and rerun after the reset. A `verify` that hits a limit writes nothing; a `calibrate` that hits it writes nothing for the task it was on (earlier tasks keep their result).

Raw Harbor output: `e2e/jobs/<ts>/<task>/` (inspect with `harbor view e2e/jobs/<ts>/<task>`).

The verifier's and the review judge's full claude transcripts (stream-json: every tool call, its output and the final answer) are kept next to it, never committed: `e2e/jobs/<ts>/<task>/<trial>-{verifier,review}.jsonl` for a run, `e2e/jobs/verify-<ts>/<task>/<harness>/<trial>-…` for `verify`, `e2e/jobs/calibrate-<ts>/<task>/<variant>-run<n>-…` for `calibrate`. They explain a surprising verdict or an unparsable answer.

`npm test` runs the e2e unit tests (`e2e/lib/*.test.mjs` and the verifier's `e2e/tasks/_shared/tests/checks.test.mjs`).

## Read the results

`docs/adw-e2e/<ts>/<task>/<harness>/`:
- `run.json`: fingerprint (incl. verifier hash and role models), calibration, per-trial checks, acceptance criteria, metrics and review, plus the summary.
- `report.md`: the same data for humans.
- `evidence/<trial>/`: ticket comments, PR diff, own test output, `pr-head.bundle` (the PR head, re-verifiable), `acceptance.json` (per-criterion verdicts with evidence), `review.json` (scores and reasons).
- `compare.md`: the verdict against the baseline. The baseline is the newest earlier result of the same task and harness on `main`.

`docs/adw-e2e/<ts>/summary.md` puts tasks and harnesses side by side.

- `docs/adw-e2e/calibration/<task>/<ts>/`: calibration verdicts per task (`report.md`, `calibration.json`).

To re-render a `report.md` from its `run.json` (e.g. after a report template change), run
`node e2e/run.mjs report <harnessDir>`.

| Signal | Meaning |
|---|---|
| reward | All contract checks, own tests (`TEST_COMMAND`) and every acceptance criterion passed; `—` when the verifier could not judge |
| contract | Share of contract checks passed (ticket edges, naming, draft PR, e2e via Playwright, app stopped, no screenshots in the repo) |
| acceptance / `ac:ACn` | Share of acceptance criteria an agentic verifier observed in the running app, and the pass rate per criterion (`e2e/tasks/_shared/acceptance-criteria.md`) |
| review | 1–5 per criterion from a code review with read access to the repo: requirements, scope, tests, conventions, architecture, code quality |
| tokens | Target agent only, from its own session logs (cross-checked with ccusage) |
| cost | Target agent only, in USD at API list price, from ccusage (`ccusage.version` in `e2e/config.json`, pinned so its bundled price table stays the same between runs). The run report adds input, output, cache read, cache write, total and cost per model for each trial. A cost rise at equal tokens points to a model mix shift (e.g. more main-model, fewer subagent-model turns). |

A report that says **Verifier not calibrated** has no passing calibration for its verifier hash (prompts, verifier/review models, review criteria, acceptance criteria). Run `calibrate` before trusting acceptance and review.

Variance is large between identical runs. Compare rates and medians, never single trials.
`inconclusive` means the spread is bigger than the difference.

## Changing the test

- Task files: `e2e/tasks/_shared/` holds everything stack-neutral (instruction, persona, bridge prompt,
  acceptance criteria, the container verifier, Gitea seeding, calibration expectations, spec and summary).
  `e2e/tasks/<task>/` holds only what is stack-specific: `task.toml`, `environment/Dockerfile`, the seed repo and
  the calibration patches. The runner mirrors `_shared/` into each task before use (git-ignored copies): edit
  only `_shared/`; a shared file that is also tracked in a task stops the run.
- `e2e/config.json`: models, repetitions, thresholds, rubric. Any change shows in the fingerprint,
  so treat it as a deliberate comparison.
- Acceptance criteria (`acceptance-criteria.md`) describe observable behaviour only: no endpoints, parameters or field names, and only what the briefing (`instruction.md`) actively communicates or what follows unambiguously from the ticket.
- Any change to the criteria, the verifier or review prompt, their models or `review.criteria` changes the verifier hash: run `calibrate`, and keep the calibration variants (`calibration/*.patch`, `expected.json`) in step with the criteria.
- Never add checks on superpowers internals: path names, worktrees, TDD order, review steps.
