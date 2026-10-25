# AGENTS.md

Guidance for coding agents working in this repository.

## What this repo is

A **generator**, not an application. It renders a lean `agent-dev` skill (a thin wrapper around the
[superpowers](https://github.com/obra/superpowers) workflow) for **Claude Code**, **Codex**, and
**OpenCode** from one canonical source (`agent-src/`) plus a small per-project config
(`ai-project.json` in the consuming project). Zero-dependency Node (builtins only, `>=24`),
published to npm as `@strobl_dev/adw` (`npx @strobl_dev/adw@X.Y.Z`), and
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
node agent-src/generate.mjs upgrade  --root <project>  # delete pre-0.23 generated files + obsolete ai-project.json keys, generate, install/update pinned skills (--dry-run)
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
- **Runtime includes** (`ticketing.mjs`, `cost.mjs` + `includes/`) — shared procedures are **rendered
  once to `.agents/includes/*.md` and read at runtime, never inlined** into bodies.
  `includes/ticketing-<backend>.md` (github | gitea | file | azure-devops) is where a new backend
  goes. azure-devops also merges an `ado` MCP server into `.mcp.json` / `.codex/config.toml`.
- **`upgrade.mjs`** — the `upgrade` command's explicit list of generated files and `ai-project.json`
  keys that earlier versions wrote and the current one no longer does. It deletes a file only if the
  file carries the banner of that exact unit. When you remove or rename a unit, include, or project
  key, add the old one there. `upgrade` is the documented command for every version bump.
- **`skills.mjs`** — third-party skills (today `show-me`) that `init` and `upgrade` install into the
  project with `npx skills add`, pinned by `config/skills.json` (CLI version + commit; derived from
  `docker/tools/inventory.json`). `ai-project.json` `skills.<name>` records the opt-in (missing =
  yes, `false` = opt-out); `skills-lock.json` tells which commit is installed. The installed files
  are project-owned: never rendered, checked or deleted. `generate`/`check` only warn. A failed
  install is a warning, never an error. Tests run `npx` as `ADW_NPX` (a fake in `test-helpers.mjs`).
- **`container.mjs`** + `container/` — the dev-container files `init` offers to write
  (`compose.ai-dev.yml`, certs and opt-in dind overlays, `ai-dev.sh`/`.ps1`, `AI-DEV.md`) from `@@KEY@@` templates.
  Written once when missing, then **project-owned**: never rendered, checked or upgraded by the pipeline.
- **`e2e/local/`** — the `adw e2e` command (`cli.mjs`, dispatched from `generate.mjs`): replays
  `agent-dev` on a consumer project's real ticket in a throwaway clone on the `file` backend, driven
  through the project's ai-dev container plus a locally built layer with `acpx` (`image.mjs`,
  `e2e/local/image/`; its pins derive from `inventory.json` `e2eNpmPackages`). The ticket is read once, never written. It ships
  in the package together with the `e2e/lib` modules it imports, each listed in `files`
  (`e2e/local/package.test.mjs` fails if the import closure of `cli.mjs` is not).
- **`onboard.mjs`** — the `init` interview. Writes `ai-project.json` (and, on request, the container files); recommended tooling is
  *printed*, never installed or documented with install steps — except the pinned skills of
  `skills.mjs`, which it offers to install.

Units: one skill, `agent-dev`. It adds only the ticket edges around the unmodified superpowers chain:
`in-progress` at the start, the approved spec as a comment, and the implementation summary, cost
summary and `review` at the end.
It names only entry skills — `superpowers:brainstorming`, plus `superpowers:writing-plans` when
resuming an in-progress ticket whose spec is already approved — and hooks in at events (spec or plan
handed over for review → a `show-me` view, spec approved, branch created, integration offered), never
at superpowers' internal skill order — that is theirs to
change. **Keep it lean**: every rendered byte is read on every run, so do not restate superpowers
skills or invent process of their own — the spec/plan files superpowers writes are the working artifacts.
See `agent-src/README.md` for the output map and manifest schema.

**Workflow states** (`ai-workflow.json`): `new → in-progress → review`. Bodies refer to states
logically; the ticketing include defines their encoding per backend.

## Releasing

The Git tag is the release: bump `version` in `package.json`, update version references in
`README.md` (`@X.Y.Z`), merge to `main`, then tag `vX.Y.Z` and push the tag.
`.github/workflows/release.yml` checks that the tag matches `package.json`, runs the tests and
publishes to npm via trusted publishing (it skips versions already on npm).

## Container images (`docker/`)

Hand-maintained, not generated. `docker/tools/inventory.json` is the single source for tool pins;
`docker/tools/package.json`, its lockfile, `e2e/local/image/package.json` and its lockfile, Dockerfile `FROM`/`ARG` pins, the `image:` line of
`agent-src/container/compose.ai-dev.dind.yml` and `agent-src/config/skills.json` (`agentSkills`) are derived — never
hand-edit them (`node docker/tools/inventory.mjs update | sync | check`). See `docker/README.md`.

## E2E self-test (`e2e/`)

Hand-maintained, not generated. The Harbor parts (`run.mjs`, `harbor.mjs`, tasks, agents) are not shipped in the npm package; `e2e/local/` and the shared `e2e/lib` modules it imports are. `node e2e/run.mjs run` runs the full
`agent-dev` workflow through Harbor (pinned in `e2e/config.json`) in all three harnesses and on
every task in `config.tasks` (`demo-todo` in Node, `demo-todo-dotnet` in Blazor Server) with a
simulated user and a throwaway Gitea; results land in
`docs/adw-e2e/<ts>/<task>/<harness>/`. Stack-neutral task files live once in `e2e/tasks/_shared/` and
are mirrored into each task (git-ignored copies). An agentic verifier judges each trial's PR head
against `acceptance-criteria.md`, and a review judge with read access scores the code;
`node e2e/run.mjs calibrate` checks both on known variants. Runs use subscription logins and are
triggered locally, never in CI; the `e2e/lib` and verifier unit tests run in `npm test`. Checks cover
only `agent-dev`'s own contract and observable outcomes — never superpowers internals. Python is
allowed only in `e2e/agents/` (Harbor custom agents). See `docs/adw-e2e/README.md`.

## Conventions

- **Every new feature needs an upgrade path and E2E coverage.** Before calling a change done, answer
  two questions in its spec and plan. How does an existing project get it with one
  `npx @strobl_dev/adw@<new> upgrade`, without reading release notes? Extend `upgrade.mjs` /
  `skills.mjs` and the README "Updating" notes. And how does `e2e/` show that it works? Add or
  adjust a contract check in `e2e/lib/trial.mjs` / `e2e/tasks/_shared/` and run it with the
  `e2e-run` skill. If a feature needs neither, say why.

- **Zero runtime dependencies** — don't add packages.
- **LF line endings** everywhere.
- Shared guidance goes in `body.md`; `overlays/<platform>.md` only for genuinely platform-specific
  mechanics (none today).
- A consuming project's `AGENTS.md` / `CLAUDE.md` are hand-owned and never generated; `agent-dev`'s
  optional e2e check reads its End-to-end testing section instead of shipping start/stop scripts.

## TDD Workstyle
- Write tests only for logic / code.
- Never write tests when changing prose just for the sake of following the TDD cycle. 
