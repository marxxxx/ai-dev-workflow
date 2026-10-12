# ADW E2E: a .NET (Blazor Server) demo task

Extends `2026-10-11-adw-e2e-self-test-design.md` and `2026-10-12-adw-e2e-agentic-verification-design.md`.
Every section of those specs not named here stays in force.

## Problem

The E2E self-test measures `agent-dev` on one Node task only. .NET support is mandatory for consumer
projects (sub-project 3), but nothing shows today that the task container, the coding agents, the agent's
own tests and the agentic verifier work on a .NET stack. The runner is also hard-wired to one task:
`config.task`, the Harbor trial prefix `demo-todo__`, the calibration commit message and a single
calibration directory.

## Goal

- A second demo task, `demo-todo-dotnet`: the same todo app as a Blazor Server app with an HTTP JSON API.
  It uses the same ticket, persona, instruction and acceptance criteria AC1–AC7 as `demo-todo`.
- Every `run` measures both tasks. Results, baselines, comparisons and calibrations are kept per task
  and harness.
- Stack-neutral task files exist once, in `e2e/tasks/_shared/`.

Success:
- `calibrate` passes for both tasks.
- One `run` writes results for both tasks, and each task × harness compares against its own baseline.
- `npm test` stays green.

## Non-goals

- Consumer mode (sub-project 3).
- A different ticket or acceptance criteria for .NET.
- Measuring the baseline. It is measured after this lands, on `main` (no baseline is committed yet, so
  the result layout changes without migration).
- A database, EF Core or authentication in the demo app.

## Decisions

| Topic | Decision |
|---|---|
| Role of the .NET task | A fixed second task: every `run` runs all tasks in `config.tasks`. `--task` narrows a run. |
| Ticket | The same as `demo-todo`: due dates, AC1–AC7 unchanged. |
| App | Blazor Server (.NET 10, the SDK in `ai-dev-workflow-dotnet`) with a minimal HTTP JSON API, in-memory store. |
| Shared files | One source in `e2e/tasks/_shared/`, mirrored into each task directory before use (git-ignored copies). |
| Gitea repository | `adw/demo-todo` in both tasks. Each trial has its own throwaway Gitea, so the names never collide. |
| Calibration | Per task: `docs/adw-e2e/calibration/<task>/<ts>/`. A Node calibration never counts for .NET. |
| Result layout | `docs/adw-e2e/<ts>/<task>/<harness>/`. |
| Loop order | Harness outside, task inside, so one limit window can run one harness over both tasks. |

## Task layout

```
e2e/tasks/
  _shared/                         # tracked; the only copy of everything stack-neutral
    instruction.md  persona.md  bridge-prompt.md  acceptance-criteria.md
    tests/          test.sh  verify.mjs  checks.mjs  checks.test.mjs
    environment/    docker-compose.yaml  gitea-init.sh  seed/seed.sh  seed/issue.md  seed/answers.json
    calibration/    spec.md  summary.md  expected.json
  demo-todo/                       # tracked: only what is stack-specific
    task.toml
    environment/Dockerfile
    environment/seed/repo/
    calibration/{reference,alt-interface,broken-done,broken-ui,messy}.patch
  demo-todo-dotnet/                # the same set for Blazor
```

- **Mirroring:** `syncShared(taskDir)` in a new `e2e/lib/tasks.mjs` copies every file of `_shared/` to the
  same relative path in the task directory and overwrites what is there.
  - `run`, `verify` and `calibrate` call it for each task they touch, before any image build, Harbor run
    or calibration bundle.
  - `.gitignore` lists the mirrored paths for every task directory, so copies are never committed.
  - A path that is tracked in both `_shared/` and a task directory is an error. `syncShared` throws on it,
    and a unit test asserts that no such path exists in the repository.
- **`checks.test.mjs`:** `npm test` runs it from `_shared/tests/`, not from a mirrored copy.
- **Fingerprint:** the task hash is computed after mirroring, so it covers the shared files.
- **Moving the existing task:** the current `demo-todo` files split into `_shared/` and `demo-todo/` with
  `git mv`. The passing calibration moves to `docs/adw-e2e/calibration/demo-todo/2026-10-12T1323Z/` and
  stays valid: the verifier hash does not change.

## Runner

- **Config:** `config.json` replaces `task` with `"tasks": ["tasks/demo-todo", "tasks/demo-todo-dotnet"]`.
  `image` (the preflight's pinned-tools check) becomes the list of base images the tasks need:
  `ai-dev-workflow-node:latest` and `ai-dev-workflow-dotnet:latest`.
- **Commands:**
  - `run [--harness h]... [--task t]... [--repetitions n]`: all tasks × harnesses unless narrowed.
  - `calibrate [--task t]... [--runs n]`: each selected task gets its own calibration.
  - `verify <harnessDir> [--trial id]`: the task is the parent directory name of the harness directory.
  - `compare <baseDir> <candDir>`: refuses directories of different tasks.
  - `preflight`: checks both base images.
- **Per-task values** come from the task directory name `<task>`:
  - seed repo `e2e/tasks/<task>/environment/seed/repo` (agent-dev is generated into it as today);
  - task image `adw-e2e-<task>`;
  - Harbor trial prefix and compose project prefix `<task>__` (today the literal `demo-todo__`);
  - calibration bundle commit message `Initial <task>`.
- **Results:** `docs/adw-e2e/<ts>/<task>/<harness>/` holds what a harness directory holds today.
  `summary.md` in `<ts>/` shows one row per task × harness.
- **Baseline and calibration lookup:** `findBaseline` searches `<ts>/<task>/<harness>` for the same task
  and harness. `findCalibration` searches `calibration/<task>/`. A run of task `t` records the
  calibration of `t`, or "Verifier not calibrated".
- **Quota:** a quota hit aborts the whole run, as today. The README's advice changes from "split a full
  run per harness" to "one harness per limit window covers both tasks"; a full run has twice the trials.
- **Docs:** `docs/adw-e2e/README.md` (layout, commands, costs) and the "E2E self-test" paragraph in
  `AGENTS.md` name both tasks and the `_shared/` rule.

## The .NET seed app

`e2e/tasks/demo-todo-dotnet/environment/seed/repo/`:

```
DemoTodo.slnx
src/DemoTodo/                    Blazor Web App, interactive server render mode
  Program.cs                     minimal API: GET /todos, POST /todos, PATCH /todos/{id}, GET /health → {"ok":true}
  TodoStore.cs                   in-memory singleton; ValidationException maps to HTTP 400
  Components/Pages/Home.razor    the list at "/", @rendermode InteractiveServer, reads the store directly
tests/DemoTodo.Tests/            xUnit: API tests via WebApplicationFactory, store tests
AGENTS.md
.gitignore                       bin/, obj/
```

- **Same surface as the Node app:** the same paths, the same fields (`id`, `title`, `done`), the same
  status codes (201 on create, 400 on validation, 404 on an unknown id), and the same `data-testid`s
  on the page (`todo-list`, `todo-item`, `todo-title`).
- **Data flow:** the verifier creates data through the API and reloads the page; Blazor Server renders
  from the same singleton store. The "nur überfällige" filter the agent builds is a real interactive
  Blazor control over SignalR.
- **`AGENTS.md`:**
  - commands: `dotnet test`; `dotnet run --project src/DemoTodo --urls http://localhost:3000`;
  - conventions: no new NuGet packages, `ValidationException` maps to 400, TDD with a failing test in
    `tests/` first, a `data-testid` on every new UI element;
  - "End-to-end testing" section: start `dotnet run --project src/DemoTodo --urls http://localhost:3000 &`
    from the repo root, readiness `GET http://localhost:3000/health`, base URL `http://localhost:3000`,
    the existing locators, Playwright MCP for the UI, stop by killing the background process.
  - Port 3000 matches the Node task, so the contract check `appListening` stays unchanged.
- **`task.toml`:** name `adw/demo-todo-dotnet`, `TEST_COMMAND = "dotnet test"`, agent timeout 2700 s
  (Node: 1800 s), because .NET builds lengthen every TDD cycle.

## Image

- `demo-todo-dotnet/environment/Dockerfile`: `FROM ai-dev-workflow-dotnet:latest`, plus the same E2E
  additions as the Node task image (tea, the pinned ACP bridge and adapters, the seed hook, the seed repo
  in `/workspace`).
- It runs `dotnet restore` on the seed app as the agent user at build time, so the NuGet cache in the
  image is warm. The agent, the agent's own tests and the verifier then build without downloading
  packages.
- Prerequisite: `node docker/build.mjs` already builds `ai-dev-workflow-dotnet`. The preflight checks
  that it exists.

## Calibration variants

`demo-todo-dotnet/calibration/` holds the same five variants as `demo-todo`, with the same intent, as
patches against the .NET seed app:

| Variant | Intent | Expected |
|---|---|---|
| reference | a clean solution; its own tests cover the store, the HTTP surface and the list page | all pass, review ≥ 4 |
| alt-interface | field `due`, query `?overdue=1` | all pass |
| broken-done | done todos still count as overdue | AC4 fails |
| broken-ui | no overdue marker, filter control does nothing | AC6, AC7 fail |
| messy | works, but ignores conventions, no new tests, an existing assertion weakened | all pass, review clearly below reference |

`expected.json` is therefore identical for both tasks and lives in `_shared/calibration/`.

Every variant is checked before any LLM run:
- the patch applies to the seed commit (`createCalibrationBundle`);
- `dotnet test` passes in the variant;
- the deterministic Playwright oracle from the agentic-verification work confirms the expected verdicts.
  The oracle takes the app's start command as a parameter instead of hard-coding `node src/server.mjs`.

## Error handling

- `syncShared` throws on a path tracked in both places, and on a missing `_shared/` directory. The
  runner turns that into `fail()` before any container starts.
- `--task` with an unknown name and `verify` on a directory whose task is not in `config.tasks` fail
  with a usage message.
- A task image build failure fails that command. In `run` it fails before the first trial.

## Testing

- `npm test`:
  - `tasks.mjs`: mirroring, overwrite, the collision error, and the repository-wide no-collision check;
  - the runner's per-task paths, prefixes, result layout, baseline and calibration lookup per task, and
    `compare` refusing mixed tasks;
  - the existing suites, adjusted to the new layout.
- Docker, no LLM:
  - both task images build;
  - `dotnet test` passes on the .NET seed app inside its image;
  - the oracle gives the expected verdicts for all five .NET variants, and still for the five Node
    variants.
- Live, only with the user's approval, naming the cost first:
  - `node e2e/run.mjs calibrate --task demo-todo-dotnet` (about 20 Sonnet runs);
  - `node e2e/run.mjs run --harness claude-code --task demo-todo-dotnet --repetitions 1` (one Opus agent
    run, a Sonnet user, 2 Sonnet runs);
  - `verify` on that result (2 Sonnet runs).
  - The Node task needs no recalibration: the verifier hash is unchanged.
