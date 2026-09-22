# AGENTS.md

Guidance for coding agents working in this repository.

## What this repo is

A **generator**, not an application. It renders subagent & skill definitions for **Claude Code**,
**Codex**, and **OpenCode** from one canonical source (`agent-src/`) plus a small per-project config
(`ai-project.json` in the consuming project). Zero-dependency Node (builtins only, `>=24`),
distributed from Git (`npx github:marxxxx/ai-dev-workflow#vX.Y.Z`, no npm registry), and
language-agnostic — consuming projects need not be Node projects.

This repo has no `ai-project.json` and no generated output of its own; run the generator against a
consuming project with `--root`.

## Commands

```bash
npm test          # node --test over agent-src/*.test.mjs + agent-src/lib/*.test.mjs
node --test agent-src/lib/pipeline.test.mjs                               # single file
node --test --test-name-pattern "azure" agent-src/lib/*.test.mjs          # single test

node agent-src/generate.mjs init     --root <project>  # interactive; --answers <file.json> for non-interactive
node agent-src/generate.mjs generate --root <project>  # render all platform files into the project
node agent-src/generate.mjs check    --root <project>  # render in memory, diff against disk, exit 1 on drift
```

## Rule 1: never hand-edit generated files

`agent-src/` is the single source of truth. Everything the generator writes into a consuming project
(`.claude/`, `.codex/`, `.opencode/`, `.agents/`, plus the merged `.mcp.json` / `.codex/config.toml`
for azure-devops) is generated; files carry a `DO NOT EDIT` banner. Change behavior in `agent-src/`:
a unit's `body.md`, `manifest.json`, `overlays/<platform>.md`, or an `includes/*.md`.

## Rule 2: keep the `package.json` `files` allowlist in sync

`files` lists each runtime `agent-src/lib/*.mjs` **individually** (tests excluded). npm honors it
when installing from Git too, so a module missing from the list works locally and in CI but fails at
import time for consumers (`ERR_MODULE_NOT_FOUND`). **When you add, rename, or delete a non-test
`lib/*.mjs`, or any runtime asset under `config/` or `includes/`, update `files` in the same
commit.** Verify with `npm pack --dry-run`.

## Architecture

`agent-src/generate.mjs` is a thin CLI (parse argv → dispatch). `lib/pipeline.mjs` composes a linear
pipeline: **config → tokens → units → renderers → outputs**.

- **`config.mjs`** — merges package-owned `agent-src/config/ai-workflow.json` (workflow states,
  artifacts, include paths — coupled to the skills) with project-owned `ai-project.json` (identity,
  repository, git, `ticketing.backend`). Package wins on `workflow` and include paths. Flattens the
  result into dotted `{{tokens}}`.
- **`tokens.mjs`** — `{{token}}` substitution. **Unresolved tokens throw** (fail-closed), re-checked
  over every output in the pipeline.
- **`units.mjs`** — loads units from `agent-src/{agents,skills}/<name>/`, layering a consuming
  project's optional `agent-custom/` (`body.md` overrides, `append.md` appends). Body order: package
  body (or override) → platform overlay → project append.
- **`renderers.mjs`** — `RENDERERS[kind][platform]`; emits Markdown+frontmatter (Claude/OpenCode),
  `.toml` (Codex agents) or `.agents/skills/…` + `openai.yaml` (Codex skills). `smokeCheck` validates
  required fields.
- **Runtime includes** (`ticketing.mjs`, `app.mjs`, `cost.mjs`, `handoff.mjs` + `includes/`) — shared
  procedures are **rendered once to `.agents/includes/*.md` and read at runtime, never inlined** into
  bodies. `includes/ticketing-<backend>.md` (github | gitea | file | azure-devops) is where a new
  backend goes. azure-devops also merges an `ado` MCP server into `.mcp.json` / `.codex/config.toml`
  and adds its tools to the ticketing agents' Claude allowlists (`constants.mjs`).
- **`onboard.mjs`** — the `init` interview. Writes `ai-project.json` only; recommended tooling is
  *printed*, never installed or documented with install steps.

Units: agents `developer`, `code-reviewer`, `qa-engineer`; skills `dev-cycle` (orchestrator) and
`product-architect`. See `agent-src/README.md` for the output map and manifest schema.

**Workflow states** (`ai-workflow.json`): `new → in-progress → review → test → acceptance-test`, with
`failed → in-progress` on rejection. Bodies refer to states logically; the ticketing include defines
their encoding per backend.

## Releasing

The Git tag is the release: update version references in `README.md` (`#vX.Y.Z`), tag `vX.Y.Z`,
push the tag and merge to `main`.

## Container images (`docker/`)

Hand-maintained, not generated. `docker/tools/inventory.json` is the single source for tool pins;
`docker/tools/package.json`, its lockfile and Dockerfile `FROM`/`ARG` pins are derived — never
hand-edit them (`node docker/tools/inventory.mjs update | sync | check`). See `docker/README.md`.

## Conventions

- **Zero runtime dependencies** — don't add packages.
- **LF line endings** everywhere.
- Shared guidance goes in `body.md`; `overlays/<platform>.md` only for genuinely platform-specific
  mechanics (currently just `skills/dev-cycle/overlays/codex.md`).
- A consuming project's `AGENTS.md` / `CLAUDE.md` are hand-owned and never generated; the qa-engineer
  is pointed at its e2e section instead of shipping start/stop scripts.
