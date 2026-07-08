# ai-dev-workflow

A customizable AI development workflow — subagent and skill definitions for **Claude Code**,
**Codex**, and **OpenCode** — generated per project from one small config file.

The generator is a zero-dependency Node script. It's distributed **directly from this Git repo** (no
npm registry) and the consuming project does **not** need to be a Node project. It works in any repo
(C#/.NET, Go, Rust, …) — the only requirement is Node on the machine that runs the generator (your
dev box and CI). Pin to a Git tag (e.g. `#v0.3.0`) so devs and CI stay in sync.

## What lands in your repo

| File / dir | Owner | Committed? |
|---|---|---|
| `ai-project.json` | **you** — project identity + ticketing backend choice + `e2e` block | yes |
| `.claude/`, `.codex/`, `.opencode/`, `.agents/` | generated output | yes (review diffs on update) |
| `.mcp.json` | merged (azure-devops backend only) — the `ado` server entry; other servers preserved | yes |
| `scripts/e2e-up`, `scripts/e2e-down` | scaffolded stubs — **you** implement (see [End-to-end testing](#end-to-end-testing-qa)) | yes |

Everything else (agent/skill sources, workflow state machine, the generator) lives in the package and
updates with it. See [`agent-src/README.md`](agent-src/README.md) for how the sources are authored.

## Quick start (any project, incl. C# — no `package.json` needed)

`npx` can run the bin straight from GitHub — nothing is installed into the repo:

```bash
# 1. run the guided onboarding — writes ai-project.json + docs/ai-workflow-setup.md
npx github:marxxxx/ai-dev-workflow#v0.3.0 init

# 2. (the interview sets project identity, repository, and ticketing.backend.
#    For azure-devops it also captures org/project + process template and pre-fills
#    the state mapping; generate then merges the `ado` server into .mcp.json.
#    It also offers to hand off to an installed coding agent — claude/codex/opencode
#    — to flesh out AGENTS.md and the e2e scripts, or skip and fill them in yourself.)

# 3. generate the platform files
npx github:marxxxx/ai-dev-workflow#v0.3.0 generate

# 4. commit ai-project.json and the generated dirs
```

Pin the tag (`#v0.3.0`) so devs and CI stay in sync — a C# repo has no lockfile to do it for you.

## Commands

| Command | Effect |
|---|---|
| `generate` (default) | Render all platform files to the project root |
| `check` | Render in memory and diff against disk; exit 1 on drift (CI / pre-commit gate) |
| `init` | Interactive onboarding: prompts for project identity, repository, ticketing backend (for azure-devops, the org/project and process template, pre-filling the state mapping), then writes `ai-project.json` and `docs/ai-workflow-setup.md`, scaffolds a baseline `AGENTS.md` plus the `scripts/e2e-up` / `scripts/e2e-down` stubs, and optionally hands off to a coding agent (claude/codex/opencode) to flesh those out. Falls back to a template scaffold when stdin is not a TTY. Never overwrites without confirmation. |

All commands accept `--root <dir>` to target a project root other than the current directory.

## End-to-end testing (QA)

The `qa-engineer` needs to reliably start your app to test it with Playwright. Because "start the
app" differs per stack (Node, .NET, …), the workflow relies on a **project-authored contract**
rather than guessing commands. `init` writes an `e2e` block to `ai-project.json` and scaffolds two
stub scripts you fill in:

```jsonc
"e2e": {
  "up": "scripts/e2e-up",       // command the QA agent runs to start the app
  "down": "scripts/e2e-down",   // idempotent teardown
  "readinessTimeout": 120,       // seconds to wait for readiness
  "logsDir": ".e2e/logs"
}
```

**The `up` contract** (what your `scripts/e2e-up` must do): start backing services + the app, block
until it's reachable, print a `BASE_URL=<url>` line to stdout, and exit `0`. `down` idempotently
tears everything back down. `init` scaffolds these as stubs; if you pick a coding agent during
onboarding it inspects your repo and fills them (and `AGENTS.md`) in as a starting point. From the
`up` result the QA agent decides:

| `up` result | QA behavior |
|---|---|
| exit `0` **with** `BASE_URL=` | drive the browser against that URL end-to-end |
| exit `0` **without** `BASE_URL=` | **skip** browser e2e — run the suite, defer UI criteria to human review (the scaffolded stubs do this until you implement them) |
| **non-zero** exit / readiness timeout | report a **blocker** (real startup failure) |

The contract is regenerated into `.agents/includes/e2e-runtime.md` (the single source of truth the
QA agent reads); the `up`/`down` scripts are yours to own and edit. A project with no app can delete
the `e2e` block entirely — QA then runs the suite only and defers UI criteria to a human.

## In a Node project

Add it as a dev dependency pointing at the Git tag, and wire up scripts:

```jsonc
"devDependencies": {
  "@strobl/ai-dev-workflow": "github:marxxxx/ai-dev-workflow#v0.3.0"
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

## License

Apache-2.0
