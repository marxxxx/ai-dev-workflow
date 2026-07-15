# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

A **generator**, not an application. It renders subagent & skill definitions for three coding-agent
platforms — **Claude Code**, **Codex**, and **OpenCode** — from one canonical source (`agent-src/`)
plus a small per-project config. It is zero-dependency Node (builtins only, `>=18`), distributed
directly from Git (no npm registry), and language-agnostic — consuming projects need not be Node
projects.

This repo **dogfoods itself**: the committed `.claude/`, `.codex/`, `.opencode/`, and `.agents/`
directories at the root are the generator's *output*, rendered against the placeholder
`ai-project.json` (`ProjectName` / `ProjectSlug`). They are generated artifacts — see below.

## Commands

```bash
npm test          # node --test over agent-src/*.test.mjs + agent-src/lib/*.test.mjs
npm run generate  # render all platform files to the project root (node agent-src/generate.mjs generate)
npm run check     # render in memory, diff against disk, exit 1 on drift (CI / pre-commit gate)

# a single test file / test name:
node --test agent-src/lib/pipeline.test.mjs
node --test --test-name-pattern "azure" agent-src/lib/*.test.mjs

# onboarding a consuming project (interactive; --answers <file.json> for non-interactive):
node agent-src/generate.mjs init
```

All commands accept `--root <dir>` to target a project root other than `cwd`.

Note: on Windows without symlink privilege, one test in `agent-src/cli.test.mjs` (the "invoked
through a symlink" case) fails with `EPERM` — this is an environmental limitation, not a code fault.

## The one rule that matters: never hand-edit generated files

`agent-src/` is the single source of truth. Every file under `.claude/`, `.codex/`, `.opencode/`,
`.agents/` (and merged `.mcp.json` / `.codex/config.toml` for the azure-devops backend) carries a
`DO NOT EDIT — generated from agent-src/…` banner.

**Workflow for any change to agent/skill behavior:**
1. Edit the canonical source under `agent-src/` (a unit's `body.md`, `manifest.json`, an
   `overlays/<platform>.md`, or an `includes/ticketing-*.md`).
2. Run `npm run generate`.
3. Commit the `agent-src/` change **and** the regenerated platform files **together**.

`npm run check` renders in memory and diffs against disk — it catches both a stale regen and any
hand-edit to a generated file. Run it before committing.

## Architecture

`agent-src/generate.mjs` is a thin CLI orchestrator (parse argv → dispatch). The real work lives in
`agent-src/lib/`, composed by `lib/pipeline.mjs` as a linear pipeline:

**config → tokens → units → renderers → outputs**

- **`lib/config.mjs`** — merges the *two* config sources. `agent-src/config/ai-workflow.json` is
  **package-owned** (workflow `states`/`artifacts` coupled to the orchestrator skill, plus the
  `ticketing`/`app` `includePath` conventions). `ai-project.json` at the project root is
  **project-owned** (project/repository/git identity + the `ticketing.backend` choice). The package
  wins on `workflow` and the `includePath`s; the project owns the rest. `buildGlobalTokens` then
  flattens the merged config into a dotted `{{token}}` namespace (`{{project.name}}`, `{{repo.slug}}`,
  `{{ticketing.include}}`, `{{status.<id>}}`, `{{azureState.<id>}}`, …).
- **`lib/units.mjs`** — loads each unit from `agent-src/{agents,skills}/<name>/` (`body.md` +
  `manifest.json`, optional `overlays/<platform>.md`). Also layers a consuming project's optional
  `agent-custom/{agents,skills}/<name>/` — `body.md` fully overrides the package body; `append.md`
  is appended after the overlay.
- **`lib/tokens.mjs`** — `{{token}}` substitution. Token values may be a string or a per-platform
  map. **An unresolved token throws** (fail-closed) — this is enforced again in `pipeline.mjs` over
  every rendered output. Body resolution order: **package body (or project override) → platform
  overlay → project append**.
- **`lib/renderers.mjs`** — `RENDERERS[kind][platform]` dispatch. Each renderer emits
  `{ path, content }` with the right shape: Claude/OpenCode = Markdown + YAML frontmatter, Codex
  agents = `.toml` with a `developer_instructions = """…"""` block, Codex skills = `.agents/skills/…`
  Markdown **plus** an `agents/openai.yaml` interface descriptor. `smokeCheck` asserts each emitted
  file has its required fields.
- **`lib/ticketing.mjs` + `includes/`** — ticketing is **read at runtime, never inlined**. The
  selected `includes/ticketing-<backend>.md` (github | file | azure-devops) is rendered once to
  `ticketing.includePath` (`.agents/includes/ticketing.md`); every agent/skill body across all three
  platforms is instructed to read that one file before any ticket operation. The `includes/` folder
  is where you add a new backend. The **azure-devops** backend additionally merges an `ado` MCP
  server into `.mcp.json` and `.codex/config.toml` (non-destructively) and injects the ADO work-item
  tools into the ticketing agents' Claude allowlists (`lib/constants.mjs` → `ADO_MCP_TOOLS`,
  `TICKETING_AGENTS`).
- **`lib/app.mjs`** — renders the e2e-runtime include the `qa-engineer` reads to bring the app up.
- **`lib/onboard.mjs`** — the `init` interview. It writes `ai-project.json` and nothing else: the
  tooling the agents expect (superpowers, serena, playwright, context7) is *printed* — name, purpose,
  link — and installing it is the user's job. Don't add install instructions or generate a doc for
  them; per-harness install steps differ and go stale, and each project's own docs are the authority.

The units themselves are three agents (`developer`, `code-reviewer`, `qa-engineer`) and two skills
(`dev-cycle`, `product-architect`). See `agent-src/README.md` for the output map and manifest schema.

### The workflow state machine

`ai-workflow.json` defines the ticket lifecycle the `dev-cycle` skill orchestrates:
`new → in-progress → review → test → acceptance-test`, with `failed → in-progress` for review/QA
rejections. States are represented differently per backend (GitHub/ADO labels vs. file frontmatter),
which is exactly why bodies refer to states *logically* and defer their concrete encoding to the
ticketing include.

## Conventions

- **Zero runtime dependencies** — Node builtins only. Don't add packages.
- **LF line endings** on every platform (the generator writes LF regardless of OS).
- Everything shared across platforms lives in a unit's `body.md`; use `overlays/<platform>.md` only
  for genuinely platform-specific guidance (none exist today — Serena, Playwright, and superpowers
  are available on all three platforms). This is the structural guarantee that platform guidance does
  not leak between tools.
- `AGENTS.md` / `CLAUDE.md` in a *consuming* project are hand-owned and never regenerated; the
  generator points the qa-engineer at the consuming project's `AGENTS.md` e2e section rather than
  shipping start/stop scripts.
