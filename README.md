# ai-dev-workflow

A customizable AI development workflow — subagent and skill definitions for **Claude Code**,
**Codex**, and **OpenCode** — generated per project from one small config file.

The generator is a zero-dependency Node script. It's distributed **directly from this Git repo** (no
npm registry) and the consuming project does **not** need to be a Node project. It works in any repo
(C#/.NET, Go, Rust, …) — the only requirement is Node on the machine that runs the generator (your
dev box and CI). Pin to a Git tag (e.g. `#v0.12.2`) so devs and CI stay in sync.

## What lands in your repo

| File / dir | Owner | Committed? |
|---|---|---|
| `ai-project.json` | **you** — project identity + ticketing backend choice | yes |
| `AGENTS.md` | **you** — create with your coding agent's native `/init`; describe e2e setup here (see [End-to-end testing](#end-to-end-testing-qa)) | yes |
| `agent-custom/` | **you** (optional) — per-project tweaks to agent/skill bodies (see [Customizing agents](#customizing-agents)) | yes |
| `.claude/`, `.codex/`, `.opencode/`, `.agents/` | generated output | yes (review diffs on update) |
| `.mcp.json` | merged (azure-devops backend only) — the shared `ado` server entry; other servers preserved | yes |
| `.codex/config.toml` | merged (azure-devops backend only) — the Codex project-local `ado` MCP server entry; other Codex settings preserved | yes |

Everything else (agent/skill sources, workflow state machine, the generator) lives in the package and
updates with it. See [`agent-src/README.md`](agent-src/README.md) for how the sources are authored.

## Quick start (any project, incl. C# — no `package.json` needed)

`npx` can run the bin straight from GitHub — nothing is installed into the repo:

```bash
# 1. run the guided onboarding — writes ai-project.json, prints the recommended tooling
npx github:marxxxx/ai-dev-workflow#v0.12.2 init

# 2. (the interview sets project identity, repository, and ticketing.backend.
#    For azure-devops it also captures org/project + process template and pre-fills
#    the state mapping; generate then merges the `ado` server into .mcp.json
#    and .codex/config.toml.
#    Install the tooling it lists — see Recommended tooling below.
#    Then create AGENTS.md with your coding agent's native /init and describe your
#    e2e setup there — see End-to-end testing below.)

# 3. generate the platform files
npx github:marxxxx/ai-dev-workflow#v0.12.2 generate

# 4. commit ai-project.json and the generated dirs
```

Pin the tag (`#v0.12.2`) so devs and CI stay in sync — a C# repo has no lockfile to do it for you.

## Recommended tooling

The agents are written to take advantage of the tools below, and `init` prints this list. **You
install them** — for whichever of Claude Code / Codex / OpenCode you run. This workflow deliberately
does not carry install instructions: they differ per harness and go stale. Follow each project's own
docs, which are the authority on installing it.

| Tool | What the agents use it for |
|---|---|
| [superpowers](https://github.com/obra/superpowers) | Skill library driving the brainstorm → plan → implement workflow (`developer`) |
| [serena](https://github.com/oraios/serena) | MCP server: semantic, symbol-level code navigation and editing (`developer`, `code-reviewer`) |
| [playwright](https://github.com/microsoft/playwright-mcp) | MCP server: drives a real browser for end-to-end testing (`qa-engineer`) |
| [context7](https://github.com/upstash/context7) | MCP server: up-to-date library and framework documentation |
| [ccusage](https://ccusage.com) | CLI: per-session token/cost reporting behind the [per-ticket cost summary](#per-ticket-cost-summary) |

None are hard requirements — an agent degrades to what is available (the `qa-engineer`, for example,
reports a blocker rather than claiming a pass if Playwright is missing). Scope MCP servers to the
project rather than installing them globally, so other projects on the machine don't inherit them.

The `ado` MCP server is the exception: for the `azure-devops` backend, `generate` merges it into
`.mcp.json` and `.codex/config.toml` for you — nothing to install by hand.

## Commands

| Command | Effect |
|---|---|
| `generate` (default) | Render all platform files to the project root |
| `check` | Render in memory and diff against disk; exit 1 on drift (CI / pre-commit gate) |
| `init` | Interactive onboarding: prompts for project identity, repository, ticketing backend (for azure-devops, the org/project and process template, pre-filling the state mapping), then writes `ai-project.json` — the only file it creates. It prints the [recommended tooling](#recommended-tooling) for you to install, and points you to create `AGENTS.md` with your coding agent's native `/init` and describe your e2e setup there. Falls back to a template scaffold when stdin is not a TTY. Never overwrites without confirmation. |

All commands accept `--root <dir>` to target a project root other than the current directory.

## Customizing agents

`ai-project.json` and per-unit `tokens` cover most tuning. When a project needs to change the actual
instructions of a shipped agent or skill, add a committed **`agent-custom/`** directory that mirrors
the source layout (`agent-custom/{agents,skills}/<name>/`). Two knobs per unit:

| File | Effect |
|---|---|
| `agent-custom/<agents\|skills>/<name>/append.md` | **Appended** to the package body (after any platform overlay). The safe default — core instructions stay intact and upstream improvements to that agent keep flowing on update. |
| `agent-custom/<agents\|skills>/<name>/body.md` | **Full override** — replaces the package body for that unit. Escape hatch for a wholesale rewrite; you then own that body (it no longer tracks upstream). |

Both files support the same `{{tokens}}` as package bodies (`{{project.name}}`, `{{repo.slug}}`, …);
an unresolved token fails the generator with a clear error. `<name>` must match a unit that ships in
the package. Resolution order is **package body (or your override) → platform overlay → your append**.

Example — add a house rule to the developer without forking its body:

```
agent-custom/agents/developer/append.md
```
```md
## House rules
Always run `npm run lint` before moving a ticket to review.
```

Then `generate` and commit. Because `agent-custom/` files are **inputs** to generation (not edits to
the generated output), `check` still passes and still catches hand-edits to the generated files — a
customized unit's `DO NOT EDIT` banner names both sources so you know where to edit.

## End-to-end testing (QA)

The `qa-engineer` needs to reliably start your app to test it with Playwright. Because "start the
app" differs per stack (Node, .NET, …) **and per OS** (Windows, Linux), the workflow does **not**
ship start/stop scripts. Instead you describe **what** it takes to bring the app up, in prose, in the
**End-to-end testing** section of your `AGENTS.md`; the QA agent translates that into the concrete
commands for whatever OS it runs on. Cover: which backing services to start (db/cache/broker), any
migrate/seed steps, how to start the app, how to know it's reachable, and the base URL (your **Ports
& URLs**).

Also name your **test-locator attribute** in `AGENTS.md` — the attribute the QA agent uses to select
elements in Playwright tests (e.g. `data-testid`, or whatever convention the codebase already uses).
Being explicit keeps browser tests reliable.

From that section the QA agent decides:

| `AGENTS.md` e2e section | QA behavior |
|---|---|
| describes how to start the app | bring it up, drive the browser against its URL end-to-end, then tear down |
| absent (or no `AGENTS.md`) | **skip** browser e2e — run the suite, mark UI criteria `NEEDS HUMAN REVIEW`, **leave e2e to the human** (not a failure) |
| described, but startup genuinely fails | report a **blocker** |

The QA agent reads this via `.agents/includes/e2e-runtime.md` (generated — the single source of truth
that points it at your `AGENTS.md`). Create `AGENTS.md` with your coding agent's native `/init`
(Claude `/init` → `CLAUDE.md`; Codex / OpenCode `/init` → `AGENTS.md`), then make sure it covers the
tech stack, the install / build / run / test commands, and the points above.

## Per-ticket cost summary

The workflow records what each ticket cost to build and posts a **Cost Summary** comment when
`dev-cycle` moves the ticket to `acceptance-test` — a per-phase token/USD breakdown (design,
implement, review, QA) plus a grand total. Cost data comes from [`ccusage`](https://ccusage.com), a
standalone CLI that reads each coding agent's local session logs; it reads the logs of **all three
harnesses**, so a ticket whose design ran in one harness and whose implementation ran in another
still aggregates correctly — as long as both ran on the same machine and user account. The
`product-architect` skill stamps a **Cost Origin** marker on the ticket so design cost is attributed
back to the right run.

The mechanics live in one generated file, `.agents/includes/cost.md` (the single source of truth for
the ccusage ledger and aggregation), which every agent and skill reads at runtime. It **degrades
gracefully**: if `ccusage` isn't installed the summary is skipped rather than failing the handoff,
and re-runs are idempotent. The summary is posted through the same ticketing mechanism as every other
comment, so it lands wherever your `ticketing.backend` puts ticket comments (GitHub / file / Azure
DevOps).

## In a Node project

Add it as a dev dependency pointing at the Git tag, and wire up scripts:

```jsonc
"devDependencies": {
  "@strobl/ai-dev-workflow": "github:marxxxx/ai-dev-workflow#v0.12.2"
},
"scripts": {
  "agents:generate": "ai-dev-workflow generate",
  "agents:check":    "ai-dev-workflow check"
}
```

## Updating

```bash
npx github:marxxxx/ai-dev-workflow#<new-tag> generate   # or bump the pinned tag, then `generate`
```

Review the diff in `.claude/`/`.codex/`/etc. and commit. `ai-project.json` is never touched. Run
`check` in CI to catch a stale or mismatched version. Every generated file carries a
`DO NOT EDIT — generated from agent-src/…` banner.

## Run in a container

Prefer not to install the agents and MCP tooling on your host? The workflow ships a **container
runtime** — a base image with all three agents (Claude Code, Codex, OpenCode) and the recommended MCP
tooling (serena, playwright + chromium, context7), plus superpowers, ccusage, and the generator,
**already installed and configured**. Mount your repo at `/workspace`, bind-mount your existing agent
logins so there is zero re-auth, and run an agent:

```bash
HOST_UID=$(id -u) HOST_GID=$(id -g) \
  docker compose -f docker/docker-compose.yml run --rm ai-dev-workflow claude   # or codex | opencode
```

Two derived images add app-facing runtimes (`ai-dev-workflow-node`, `ai-dev-workflow-dotnet`). The
container assets live under `docker/` and are **hand-maintained, not generated**. See
[`docker/README.md`](docker/README.md) for the run model, mounts, auth/persistence, UID/GID mapping,
and how a consuming project extends the base.

## License

Apache-2.0
