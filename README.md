# ai-dev-workflow

A customizable AI development workflow — subagent and skill definitions for **Claude Code**,
**Codex**, and **OpenCode** — generated per project from one small config file.

The generator is a zero-dependency Node script. It's distributed **directly from this Git repo** (no
npm registry) and the consuming project does **not** need to be a Node project. It works in any repo
(C#/.NET, Go, Rust, …) — the only requirement is Node on the machine that runs the generator (your
dev box and CI). Pin to a Git tag (e.g. `#v0.2.1`) so devs and CI stay in sync.

## What lands in your repo

| File / dir | Owner | Committed? |
|---|---|---|
| `ai-project.json` | **you** — project identity + ticketing backend choice | yes |
| `.claude/`, `.codex/`, `.opencode/`, `.agents/` | generated output | yes (review diffs on update) |
| `.mcp.json` | merged (azure-devops backend only) — the `ado` server entry; other servers preserved | yes |

Everything else (agent/skill sources, workflow state machine, the generator) lives in the package and
updates with it. See [`agent-src/README.md`](agent-src/README.md) for how the sources are authored.

## Quick start (any project, incl. C# — no `package.json` needed)

`npx` can run the bin straight from GitHub — nothing is installed into the repo:

```bash
# 1. run the guided onboarding — writes ai-project.json + docs/ai-workflow-setup.md
npx github:marxxxx/ai-dev-workflow#v0.2.1 init

# 2. (the interview sets project identity, repository, and ticketing.backend.
#    For azure-devops it also captures org/project + process template and pre-fills
#    the state mapping; generate then merges the `ado` server into .mcp.json.)

# 3. generate the platform files
npx github:marxxxx/ai-dev-workflow#v0.2.1 generate

# 4. commit ai-project.json and the generated dirs
```

Pin the tag (`#v0.2.1`) so devs and CI stay in sync — a C# repo has no lockfile to do it for you.

## Commands

| Command | Effect |
|---|---|
| `generate` (default) | Render all platform files to the project root |
| `check` | Render in memory and diff against disk; exit 1 on drift (CI / pre-commit gate) |
| `init` | Interactive onboarding: prompts for project identity, repository, ticketing backend (for azure-devops, the org/project and process template, pre-filling the state mapping), then writes `ai-project.json` and `docs/ai-workflow-setup.md`. Falls back to a template scaffold when stdin is not a TTY. Never overwrites without confirmation. |

All commands accept `--root <dir>` to target a project root other than the current directory.

## In a Node project

Add it as a dev dependency pointing at the Git tag, and wire up scripts:

```jsonc
"devDependencies": {
  "@strobl/ai-dev-workflow": "github:marxxxx/ai-dev-workflow#v0.2.1"
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
