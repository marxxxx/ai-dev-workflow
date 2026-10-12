# ADW E2E self-test (sub-project 1 of 3)

**Date:** 2026-10-11
**Status:** Implemented. The hidden acceptance tests and the judge are superseded by `2026-10-12-adw-e2e-agentic-verification-design.md`.
**Builds on:** `docs/superpowers/specs/2026-10-10-adw-e2e-spike-findings.md`

## Problem

Today the effect of a change to any element of the workflow shows up only in real project use, and
often late. The elements are: the `agent-dev` prompt, an include, a harness update, MCP servers, the
superpowers revision, or the LLM. The symptoms are more tokens, lower quality, longer runs and broken
process steps.

## Goal

Make the effect visible, reproducibly, from this repo:
- Run the full `agent-dev` workflow headlessly for Claude Code, Codex and OpenCode.
- Use a fixed standard configuration, a fixed task, a fixed start state and a simulated user.
- Score each run (process contract, acceptance, quality, duration, tokens, errors).
- Store the result under `docs/adw-e2e/{timestamp}/{harness}/`.
- Compare two result sets, so that one can say whether a change is better or worse than the
  previous version, and which component changed.

The E2E effort has three sub-projects:
1. **Self-test core** (this spec): a demo repo and a throwaway Gitea, in this repo.
2. `dependency-update-check` uses (1) to classify component bumps. This is a separate spec.
3. Consumer mode: `adw e2e` for consuming projects, with a base branch and a cloned template ticket
   in the real backend. This is a separate spec.

## Non-goals

- Fixing the workflow issues the spike found (#51–#55). They are tracked separately, and become the
  first regression cases.
- Running real E2E runs in CI. Runs are local and deliberately triggered, because of subscription
  logins, quota and duration.
- Asserting on superpowers internals. See "Coupling rule".
- Shipping any of this in the npm package. `package.json` `files` is unchanged.

## Decisions (from brainstorming and the spike)

| Topic | Decision |
|---|---|
| Runner | [Harbor](https://github.com/laude-institute/harbor), pinned, invoked as an external CLI. We build only our layer on top. |
| Dialogue | Harbor's ACP bridge with an LLM persona as the simulated user. Accepted fidelity gap: mid-turn questions do not reach the user, and Claude uses ACP client tools. |
| Auth | Subscription logins only: Claude `setup-token`, Codex ChatGPT/Business `auth.json`, the OpenCode provider entry. They are copied into the run, never committed. |
| Ticket and PR backend | A throwaway Gitea sidecar per trial; ticketing backend `gitea`. |
| Storage | Committed: `run.json`, `report.md`, `evidence/`. Raw Harbor jobs and trajectories go in the git-ignored `e2e/jobs/`. |
| Quality | An LLM judge with a fixed rubric, run on the host after each trial. |
| Repetitions | 3 per harness. The spike measured token spread of ×1.4 (Claude) to ×3.5 (Codex) at identical config. |
| Coupling rule | Checks cover only `agent-dev`'s contract, observable outcomes and outcome-based judging. Whether superpowers was active is a soft signal and is not scored. |

## Standard configuration

Versioned in `e2e/config.json`. Changing it is a deliberate comparison, and the fingerprint records
it.

| Role | Model / settings |
|---|---|
| Claude Code (target) | main `claude-opus-5-5`, subagents `claude-sonnet-5-5` (`CLAUDE_CODE_SUBAGENT_MODEL`) |
| Codex (target) | `gpt-6.1-sol`, reasoning `high`; subagents `gpt-6.1-sol` at default effort, if Codex exposes a subagent effort setting, otherwise a documented limitation |
| OpenCode (target) | `mistral/mistral-large-4` |
| Simulated user | Claude Code, `claude-sonnet-5-5`, tools restricted |
| Judge | `claude-opus-5-5` via host `claude -p` |
| Repetitions | 3 per harness, run in sequence |
| Harbor | `0.24.0` (`uv tool install harbor==0.24.0`) |

Model availability depends on how fresh the login is: `gpt-6.1-sol` was refused until a re-login.
The preflight therefore probes every configured model before any trial starts.

## Test task

**Start state.**
- A throwaway Gitea holds `adw/demo-todo` on `main`. `demo-todo` is a zero-dependency Node 24 todo
  app:
  - a JSON API for creating, listing, updating and deleting todos, with 3 existing tests;
  - a minimal vanilla-HTML list page served at `/`, using `data-testid` locators.
- Ticket #1, "Fälligkeitsdatum für Todos", has deliberately vague content: *"Todos sollen ein
  Fälligkeitsdatum bekommen, damit man sieht, was überfällig ist – in der API und in der Liste."*
- The demo repo's `AGENTS.md` has an "End-to-end testing" section: start command, readiness URL,
  base URL, the `data-testid` locator attribute, and the stop command.

**Opening message from the simulated user ("Petra", PO):** *"Nutze den agent-dev Skill für
Ticket 1."* Everything else must be elicited in the interview.

**Hidden requirements in the briefing.** Petra reveals them only when asked, one topic at a time:
- Optional `dueDate` (`YYYY-MM-DD`, no time), settable on `POST`, changeable via `PATCH`, and
  cleared with `null`.
- Invalid dates (wrong format, impossible dates such as `2026-02-30`) → HTTP 400.
- `GET /todos?overdue=true` returns only todos that are not done and are due before today (UTC).
  Todos without a date are never overdue.
- The list page shows each todo's due date, marks overdue todos with the word "überfällig", and
  offers a toggle labelled "nur überfällige" that uses the filter.
- Nothing else: no sorting, reminders or styling work.

**Fixed process answers:**
- The agent tests end to end itself, so the visible change must trigger `agent-dev`'s Playwright
  path.
- No new ticket.
- Design and plan are approved when they match the requirements.

**Why this task:**
- It is small enough for about 7–13 min per trial.
- It is vague enough that the interview matters.
- It has testable edge cases (invalid dates, clearing with `null`, overdue logic).
- It covers the whole `agent-dev` flow, including the browser-based end-to-end step that the
  API-only spike task never exercised.

## Layout

```
e2e/
  run.mjs                 # CLI: preflight | run | compare | report   (zero-dep Node)
  lib/                    # fingerprint, metrics, judge, compare, report, harbor (+ *.test.mjs)
  config.json             # standard configuration, repetitions, thresholds, rubric
  agents/                 # Harbor custom agents (Python, the only non-Node code; e2e-only)
    claude_subscription.py
    codex_subscription.py
    opencode_subscription.py
  tasks/demo-todo/        # Harbor task
    task.toml
    instruction.md        # briefing for the simulated user (hidden requirements)
    persona.md
    bridge-prompt.md      # strict channel rules for the simulated user
    environment/          # Dockerfile (FROM our image), docker-compose.yaml (gitea), seed hook, demo repo
    tests/                # test.sh, verify.mjs, acceptance.test.mjs (API), acceptance-ui.mjs (Playwright)
  jobs/                   # git-ignored Harbor output
docs/adw-e2e/<timestamp>/<harness>/
  run.json  report.md  evidence/
docs/adw-e2e/<timestamp>/summary.md        # cross-harness overview of one invocation
```

The demo repo's generated adw files are **not** committed. `run` renders them fresh into the task
environment with `agent-src/generate.mjs`, so every run tests the current generator output.

## Components

### Task environment (from the spike, hardened)

- **`main` service:** `FROM` the locally built `ai-dev-workflow-node` image, plus the demo repo
  baked into `/workspace`. `configure-agents.sh` needs `ai-project.json` at container start.
- **Startup hook** (`startup.d`):
  - waits for the Gitea token;
  - creates the repo, the status labels and ticket #1, and pushes `main`;
  - registers the `e2e` tea login;
  - adds `.acpxrc.json` to `.git/info/exclude`;
  - signals readiness through the healthcheck.
- **`gitea` service:** a self-seeding Gitea (admin user and token written to a shared volume).
- **Image changes:** E2E-only tooling (`tea` 0.15.1, `acpx` 0.11.2, `@zed-industries/claude-code-acp`
  0.16.2, `@agentclientprotocol/codex-acp` 1.12.0, agent-user write access to the global npm prefix,
  so Harbor's runtime `npm install -g` is a no-op) lives in the task Dockerfile; the product image
  is unchanged (`tea` for the product image: #53). Harness versions still come from `inventory.json`.

### Custom agents (Python, from the spike)

| Class | Purpose |
|---|---|
| `ClaudeSubscription` | Uploads the OAuth token to a 0600 file. The ACP command reads it at adapter start, because Claude Code does not pass its token to the simulated user's Bash subprocesses. Sets the subagent model. |
| `CodexSubscription` | Copies `auth.json` into the ACP `CODEX_HOME` (Harbor refuses `auth.json` for ACP targets) and drops the forced API-key auth method. |
| `OpenCodeSubscription` | Copies the model provider's auth entry. Passes model and provider through an `OPENCODE_CONFIG` file, because the image wrapper overwrites `OPENCODE_CONFIG_CONTENT`. |

The simulated user always gets these settings:
- `--uk disallowed_tools=Skill,Edit,Write,NotebookEdit,Task`
- a role-pinning `append_system_prompt`
- `bridge-prompt.md`, which forbids touching `.acpxrc.json`, starting other agents or sessions, and
  doing the work. On a repeated bridge error the user ends with `BRIDGE FAILURE: …`.

### Verifier (`tests/verify.mjs`, runs in the container)

The verifier writes `reward.json` (one metric per check) and the evidence files: `ticket.json`,
`pulls.json`, `pr.diff`, `pr-commits.txt`, `acceptance.tap`.

**Contract checks.** These are scored, and all of them come from `agent-dev` or its includes:

| Check | Pass condition |
|---|---|
| `ticket_open` | ticket not closed |
| `ticket_review` | exactly one `status:*` label, and it is `status:review` |
| `spec_comment` | an `## Approved Spec` comment exists |
| `spec_comment_complete` | spec comment(s) ≥ 400 chars and free of unexpanded `$(`/`${` |
| `summary_comment` | `## Implementation Summary` exists and states the end-to-end status |
| `cost_comment` | `## Cost Summary` exists |
| `only_allowed_comments` | no other comments |
| `pr_draft` | exactly one PR, `WIP:` title (Gitea draft), base `main`, not merged |
| `branch_naming` | `^1_[a-z0-9_]+$` |
| `pr_title_naming` | `^WIP:\s*1: \S` |
| `e2e_performed` | the target session contains Playwright MCP tool calls against the app's base URL. Computed on the host from the session logs by the metrics module (tool names differ per harness), then merged into the contract. |
| `app_stopped` | nothing listens on the app port after the run (`agent-dev`: shut the app down) |
| `no_screenshots_in_repo` | the PR diff adds no image files (`agent-dev`: screenshots outside the repo) |

**Outcome checks:**
- `own_tests_pass`: `npm test` on the PR head.
- `acceptance`: the hidden tests' pass ratio on the PR head. It covers both:
  - API tests (`node:test`);
  - a headless Playwright UI test (`acceptance-ui.mjs`, using the image's Playwright). It creates a
    past-due and a future todo, opens `/`, and asserts that the dates are visible, that the past-due
    todo shows the word "überfällig", and that the toggle labelled "nur überfällige" filters.

  Hidden tests may only cover requirements that the briefing actively communicates, or that follow
  unambiguously from the ticket. Hidden UI tests use only visible text and roles, never
  markup details.

Derived values: `contract` = the share of contract checks passed. `reward` = 1 only if
`contract == 1`, `own_tests_pass == 1` and `acceptance == 1`.

### Metrics (`e2e/lib/metrics.mjs`, on the host)

- **Durations,** from Harbor `result.json`: environment setup, agent execution, verifier, total.
- **Target tokens,** from the target's native session logs in the trial directory. Harbor's own
  numbers are not used: they cover the simulated user, or only the last turn.
  - Claude: session JSONL, deduplicated by message id, including subagent sessions.
  - Codex: the last `token_count` event of the rollout.
  - OpenCode: the `message` table of its session DB.
  - The values are cross-checked with an isolated `ccusage@20` run, with `HOME` and the config dir
    pointed at a copy of the trial sessions. A deviation above 1 % is recorded as a metrics warning.
- **Simulated-user tokens** are recorded separately and are not part of the target metrics.
- **USD** is recorded as an API-price equivalent only. Comparisons use tokens.
- **Errors:**
  - a Harbor exception;
  - `BRIDGE FAILURE` from the user;
  - target tool errors (non-zero exits, tool-result errors), counted;
  - the agent hitting the timeout or budget.
- **Soft signal** (not scored): superpowers bootstrap present in the target session
  (`superpowersActive`).

### Judge (`e2e/lib/judge.mjs`, on the host)

After each trial the judge is called once:

```
claude -p --model <judge> --output-format json
```

Its input is the briefing (`instruction.md`), the posted spec comment, the PR diff and the
Implementation Summary. Its output is JSON, validated against a schema in `config.json`:

| Criterion | Question (1–5) |
|---|---|
| `requirements` | Did the posted spec and the diff capture every requirement of the briefing? This measures interview quality by its outcome. |
| `scope` | No unrequested features or unrelated changes? |
| `tests` | Do the agent's own tests cover the new behaviour meaningfully? |
| `readability` | Clear, idiomatic, consistent with the repo's conventions? |

Each criterion gets a short justification, stored in `evidence/judge.json`. If the judge fails, the
trial is kept and the scores are marked `null` with the error. A failed judge call counts as the
error class `judge`, so compare reports it as a regression instead of silently skipping null scores.

### Fingerprint (`e2e/lib/fingerprint.mjs`)

Every trial records:
- adw `package.json` version and git SHA, plus a dirty flag;
- a hash of the rendered `SKILL.md` per platform and of `.agents/includes/*.md`;
- the image ID (no repo digest, the image is built locally), the `inventory.json` hash, and the harness versions and superpowers
  revision read from it;
- Harbor version and ACP package versions;
- the config hash (models, efforts, repetitions, rubric);
- the task hash (task directory contents).

### Result files

`docs/adw-e2e/<timestamp>/<harness>/run.json`:

```json
{
  "schema": 1,
  "harness": "claude-code",
  "fingerprint": { "...": "..." },
  "config": { "model": "claude-opus-5-5", "subagentModel": "claude-sonnet-5-5", "repetitions": 3 },
  "trials": [
    { "id": "claude-code-1", "reward": 1, "contract": 1, "checks": { "ticket_review": 1 },
      "acceptance": 1, "ownTests": 1,
      "judge": { "requirements": 5, "scope": 4, "tests": 4, "readability": 5 },
      "durations": { "setup": 15, "agent": 325, "verifier": 1, "total": 387 },
      "tokens": { "input": 130, "output": 25199, "cacheRead": 4040283, "cacheWrite": 68608, "total": 4134220 },
      "userTokens": { "total": 210000 },
      "errors": { "harbor": null, "bridge": null, "tool": 2, "timeout": false },
      "soft": { "superpowersActive": true } }
  ],
  "summary": { "rewardRate": 0.67, "checkRates": { "spec_comment": 0.67 }, "median": { "tokens": 4134220, "agent": 325 },
               "judgeMedian": { "requirements": 5 } }
}
```

`report.md` is a human-readable rendering of the same data: a summary table, per-check rates,
trials, and the judge's justifications. `summary.md` puts all harnesses of one invocation side by
side.

### Compare (`e2e/run.mjs compare <baseline-dir> <candidate-dir>`)

The baseline is given explicitly. Without one, it is the newest earlier `docs/adw-e2e/*` result for
the same harness on a commit reachable from `main`.

For each harness, compare reports deltas and a verdict:

| Signal | Regression when |
|---|---|
| Contract / acceptance / own-tests check rates | any rate drops |
| Reward rate | drops |
| Judge medians | any criterion drops by ≥ 1 |
| Median tokens / median agent time | rises above `thresholds` in `config.json`, initially +50 % |
| Errors | any new error class |

The output is `compare.md` in the candidate directory. It contains the verdict per harness
(`better` | `same` | `worse` | `inconclusive`) and the **fingerprint diff**, that is, which
components changed between baseline and candidate: the candidates for the cause.
`inconclusive` is used when the spread within either side exceeds the difference.

The thresholds are provisional. After the first three baseline invocations, the plan revisits them
using the measured spread.

### CLI flow (`e2e/run.mjs run [--harness <h>] [--repetitions <n>]`)

1. **Preflight** (also available as `preflight`). It fails fast with a clear message:
   - Harbor version as pinned; Docker running;
   - local image present, with versions matching `inventory.json`;
   - logins present: Claude token file or env, Codex `auth.json`, OpenCode provider entry;
   - every configured model answers a one-line probe.
2. Render the demo repo's adw files with `agent-src/generate.mjs` into the task environment.
3. Per harness and repetition, in sequence: `harbor run` with the custom agent, the
   simulated-user flags and an isolated jobs directory.
   - Afterwards, collect metrics, run the judge and build the trial record.
   - A failed trial is recorded, never retried silently.
4. Write `run.json` and `report.md` per harness, and `summary.md`. Print the paths. If a baseline
   exists, run `compare` automatically.

## Error handling

- **Bridge health.** The first `acpx prompt` must return a target reply. If the user ends with
  `BRIDGE FAILURE`, the trial is marked `errors.bridge` and the runner moves on, instead of letting
  a dead session run to the timeout. This is what happened in spike run claude-2.
- **Budgets:** the agent timeout per trial lives in the task's `task.toml` (default 30 min) and Claude
  `max_budget_usd`.
- **Cleanup.** Harbor tears down the compose project. After every trial the runner also removes any
  leftover `demo-todo__*` compose projects, including after a crash or Ctrl-C.
- **Secrets.** Auth copies live in a temp dir under `e2e/jobs/.secrets/` (git-ignored, 0600) and are
  deleted after the invocation. `evidence/` must never contain tokens: the verifier redacts the
  Gitea token in all evidence it writes, and the runner redacts known secret values in every file it
  writes under `docs/adw-e2e/` before writing it (a report-only backstop scan runs afterwards).
- **Login drift.** Codex refresh tokens rotate. Trials run in sequence, from one copy per invocation.
  The host's own `auth.json` is never written.

## Testing

TDD for all Node logic, using `node:test`. Fixtures come from spike trial directories, trimmed and
with secrets redacted.

| Unit | Tests |
|---|---|
| `metrics` | token extraction per harness from fixture sessions; ccusage cross-check deviation; duration parsing; error counting; `e2e_performed` detection (Playwright MCP calls) per harness |
| `fingerprint` | stable hashes; dirty flag; missing image is reported |
| `compare` | rates and medians; each regression rule; `inconclusive`; fingerprint diff |
| `judge` | prompt assembly; schema validation; failure gives `null` scores |
| `report` | `run.json` → `report.md` / `summary.md` snapshots |
| `verify.mjs` | against recorded Gitea API responses, both a passing and a failing ticket |

The Python agent classes stay thin and are exercised by the live verification below. No live E2E
runs in CI.

`npm test` includes `e2e/lib/*.test.mjs` and the verifier unit tests. It lists the verifier's test
explicitly (`e2e/tasks/demo-todo/tests/checks.test.mjs`), because the hidden acceptance tests in that
directory run only inside the verifier. CI needs no credentials for them.

## Verification (acceptance of this sub-project)

1. `node e2e/run.mjs preflight` passes on a machine with logins and a built image.
2. `node e2e/run.mjs run` produces `docs/adw-e2e/<ts>/{claude-code,codex,opencode}/run.json`,
   `report.md`, `evidence/` and `summary.md` for 3 trials each.
3. A second invocation with a deliberately degraded `agent-dev` body produces `compare.md` with
   `worse` and the skill-hash change in the fingerprint diff. The degradation is removing the
   instruction to post the approved spec.
4. Evidence contains no secret: grep for the token values.
5. `npm test` (including `e2e/lib` and the verifier unit tests) passes. `npm pack --dry-run` shows no `e2e/` files.

## Risks

- **ACP fidelity gap.** Results describe agent-dev *under ACP*. The fallback, if this proves
  misleading, is to replace only the dialogue driver (native `--resume` / `exec resume` /
  `opencode serve`) and keep the task, verifier and metrics.
- **Harbor churn** (0.x). It is pinned, and a Harbor bump is itself a component change that
  `compare` must catch.
- **Simulated-user role breaks.** Mitigated by tool restrictions and the bridge prompt. Residual
  risk is visible as `BRIDGE FAILURE` or as a contract failure.
- **Quota.** One full invocation is 9 trials of about 7–13 min each, plus the judge. It is triggered
  deliberately.

## Open questions for the plan

- Forcing the pinned superpowers for Codex under ACP. Mechanism used, in `CodexSubscription.acp_install`:
  register the image's managed marketplace `~/.cache/ai-dev-workflow/codex-marketplace` in the ACP
  `CODEX_HOME` via `codex plugin marketplace add` and `codex plugin add superpowers@<name>`, and
  append `[plugins."superpowers@openai-curated-remote"] enabled = false` to its `config.toml`.
  Outcome (first live run, 2026-10-11): Codex accepted the config; the rollouts reference the
  managed `codex-marketplace` and no `openai-curated-remote/superpowers` path.
- Whether Codex exposes a separate subagent reasoning effort.
- Why OpenCode does not activate the superpowers bootstrap under ACP (#55). This affects only the
  soft signal, not scoring.
