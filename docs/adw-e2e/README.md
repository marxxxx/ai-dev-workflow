# ADW E2E self-test

Runs the full `agent-dev` workflow headlessly in Claude Code, Codex and OpenCode against the
`demo-todo` task (a todo API + list page, ticket #1 in a throwaway Gitea), scores every trial and
compares result sets. Design: `docs/superpowers/specs/2026-10-11-adw-e2e-self-test-design.md`.

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

Raw Harbor output: `e2e/jobs/<ts>/` (inspect with `harbor view e2e/jobs/<ts>`).

`npm test` runs the e2e unit tests (`e2e/lib/*.test.mjs` and the verifier's `checks.test.mjs`).

## Read the results

`docs/adw-e2e/<ts>/<harness>/`:
- `run.json`: fingerprint, configuration, per-trial checks, metrics and judge, plus the summary.
- `report.md`: the same data for humans.
- `evidence/<trial>/`: ticket comments, PR diff, test outputs, judge reasons.
- `compare.md`: the verdict against the baseline. The baseline is the newest earlier result on `main`.

`summary.md` puts the harnesses side by side.

To re-render a `report.md` from its `run.json` (e.g. after a report template change), run
`node e2e/run.mjs report <harnessDir>`.

| Signal | Meaning |
|---|---|
| reward | All `agent-dev` contract checks, own tests and hidden acceptance (API + UI) passed |
| contract | Share of contract checks passed (ticket edges, naming, draft PR, e2e via Playwright, app stopped, no screenshots in the repo) |
| judge | 1–5 per criterion from an LLM judge against the briefing (outcome-based) |
| tokens | Target agent only, from its own session logs (cross-checked with ccusage) |

Variance is large between identical runs. Compare rates and medians, never single trials.
`inconclusive` means the spread is bigger than the difference.

## Changing the test

- `e2e/config.json`: models, repetitions, thresholds, rubric. Any change shows in the fingerprint,
  so treat it as a deliberate comparison.
- Hidden tests may only check what the briefing (`instruction.md`) actively communicates, or what follows unambiguously from the ticket.
- Never add checks on superpowers internals: path names, worktrees, TDD order, review steps.
