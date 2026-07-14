# agent-src — single source of truth for agent & skill definitions

Custom subagent and skill definitions for Claude Code, Codex, and OpenCode are **generated** from
the canonical sources in this directory. No tool reads `agent-src/` at runtime; it exists only to
generate the per-platform files.

**Edit here, run the generator, never edit the generated files.**

## Workflow

1. Edit a unit's `body.md` (shared, platform-neutral prose) or `manifest.json` (per-platform config).
2. Run the generator:

   ```bash
   node agent-src/generate.mjs
   ```

3. Commit the changed `agent-src/` sources **and** the regenerated platform files together.

Every generated file carries a `DO NOT EDIT — generated from agent-src/…` banner. Hand-edits are
caught by `node agent-src/generate.mjs --check` (renders in memory and diffs against disk; exits
non-zero on drift — suitable for a pre-commit hook or CI gate).

## Layout

```
agent-src/
  generate.mjs                 # entrypoint: zero-dependency Node CLI (parse argv + dispatch); also --check
  lib/                         # feature modules the entrypoint composes:
    constants.mjs serialize.mjs identity.mjs config.mjs tokens.mjs units.mjs
    ticketing.mjs renderers.mjs setup-doc.mjs onboard.mjs pipeline.mjs
  config/
    ai-workflow.json           # PACKAGE-owned config: workflow states/artifacts + ticketing.includePath
    ai-project.template.json   # scaffold template copied by `init` when non-interactive
  includes/
    ticketing-github.md        # ticketing operations — GitHub (gh CLI) variant
    ticketing-file.md          # ticketing operations — file-based (.tickets/) variant
    ticketing-azure-devops.md  # ticketing operations — Azure DevOps (@azure-devops/mcp) variant
  skills/<name>/
    body.md                    # shared SKILL body — uses {{token}}s; references the ticketing include
    manifest.json              # name, description, platforms{}, interface{} (Codex openai.yaml)
  agents/<name>/
    body.md                    # shared agent instructions — uses {{token}}s
    manifest.json              # name, description, platforms{} (model/tools/config per platform)

<project-root>/
  ai-project.json              # PROJECT-owned config: project/repository/git identity + ticketing backend choice
  agent-custom/<agents|skills>/<name>/   # PROJECT-owned, optional: body.md (override) / append.md (extend)
```

## Portability: two config files + the ticketing include

Config is split by ownership so the package can be updated without clobbering project settings, and
the project can't accidentally desync skill-coupled values:

- **`ai-project.json`** lives at the **project root** and is project-owned: `project` identity,
  `repository`, `git`, and the `ticketing` **backend choice** (`"github"` | `"file"` | `"azure-devops"`) plus
  the github/file/azureDevOps sub-configs. This file stays in the project across updates.
- **`agent-src/config/ai-workflow.json`** ships **with the package** and is package-owned: the
  `workflow.states` / `workflow.artifacts` (coupled to the orchestrator skill) and
  `ticketing.includePath` (the fixed runtime convention). It updates with the package; projects
  don't edit it.

Bodies and manifest descriptions reference both through `{{token}}`s, so the same agent/skill sources
work for any project. The generator merges the two files (package wins on `workflow` and
`ticketing.includePath`; project owns the rest of `ticketing`) and reads `ai-project.json` from the
project root (`cwd`, overridable with `--root <dir>`).

To take this setup to another project: edit `ai-project.json` (project identity, `repository.slug`,
`ticketing.backend`) and run the generator. To switch ticketing backends (e.g. GitHub ⇄ local files),
change one line — `ticketing.backend` — and regenerate; the matching `includes/ticketing-<backend>.md`
is copied to `ticketing.includePath`.

**Global tokens.** The generator flattens the merged config into a dotted token namespace available to
every body and to each manifest `description`/`interface` string:

- `{{project.name}}`, `{{project.slug}}`, `{{project.serena}}`, `{{project.description}}`
- `{{repo.slug}}`, `{{repo.defaultBranch}}`
- `{{ticketing.include}}` (path agents read at runtime), `{{ticketing.backend}}`
- `{{git.branchPattern}}`, `{{git.prTarget}}`
- `{{artifact.implementationNotes}}`, `{{artifact.reviewFeedback}}`, `{{artifact.testResults}}`
- `{{status.<id>}}` — resolves to the label (`status:new`) for github and azure-devops, or the
  file-frontmatter value (`new`) for file, depending on `ticketing.backend`. Used only inside the
  ticketing includes; bodies refer to states logically (`new`, `review`, …) and defer their
  representation to the include.
- `{{azureState.<id>}}` — the Azure DevOps native board State (e.g. `Doing`) the work item is
  nudged to on each transition; azure-devops backend only.
- `{{ticketing.azure.organization}}`, `{{ticketing.azure.project}}`, `{{ticketing.azure.featureType}}`,
  `{{ticketing.azure.bugType}}` — azure-devops work item targeting + types.

Per-unit `manifest.tokens` still work and override a global token of the same name.

**Ticketing is read at runtime, not inlined.** The generator renders the selected
`includes/ticketing-<backend>.md` (with tokens substituted) to `ticketing.includePath`
(default `.agents/includes/ticketing.md`) and **every** agent/skill body — across all three harnesses —
instructs the agent to read that one file before any ticket operation. The includes are the single
place that knows repository names, CLI commands, status encoding, comment mechanisms, and PR/handoff;
the includes folder is where you add a new backend. The azure-devops backend additionally merges an
`ado` server into the project's `.mcp.json` (non-destructively) and injects the `@azure-devops/mcp`
work-item tools into the Claude allowlists of the ticketing agents.

`AGENTS.md` (and `CLAUDE.md`) remain hand-owned, project-specific docs carrying the
tech-stack/ports/conventions prose — including the **End-to-end testing** section the qa-engineer
reads to bring the app up. `init` does not scaffold or own them; you create `AGENTS.md` with your
coding agent's native `/init` (see `docs/ai-workflow-setup.md`). They are never regenerated or
overwritten — unlike the platform files, which `generate` owns.

A unit *may* also contain `overlays/<platform>.md`; the generator appends it to that platform's
rendered body. This is the structural guarantee that platform-specific guidance does **not leak**
between tools. None exist today — Serena, Playwright, and superpowers are available on all three
platforms, so that guidance lives in the shared `body.md`.

**Project overrides (`agent-custom/`).** A consuming project can tailor any shipped unit without
forking the package by adding a committed `agent-custom/{agents,skills}/<name>/` dir at its root
(read via `--root`). Per unit: `body.md` **replaces** the package body (escape hatch), and
`append.md` is **appended** after the platform overlay (safe, upstream-tracking default). Both get
the same `{{token}}` treatment; an unresolved token throws. Resolution order is **package body (or the
project override) → platform overlay → project append**. These files are generation *inputs*, so
`check` stays meaningful; a customized unit's `DO NOT EDIT` banner names both sources. See the root
[README](../README.md#customizing-agents) for the consumer-facing guide.

## Manifest schema

- `name`, `description` — shared across platforms (the `description` is platform-neutral).
- `platforms` — one key per emitted platform (`claude`, `codex`, `opencode`); a platform absent from
  this map is not emitted. Per-platform config:
  - **claude**: `model`, `tools[]` (allowlist).
  - **codex**: `model`, `model_reasoning_effort`, `nickname_candidates[]`.
  - **opencode**: `model`, `temperature`, `mode`.
- `interface` (skills only) — Codex skill descriptor written to `agents/openai.yaml`
  (`display_name`, `short_description`, `default_prompt`).
- `tokens` — per-unit `{{token}}` overrides (string or per-platform map). These override the global
  tokens derived from the merged config for that unit only. Prefer overlays for structural/tooling/workflow
  differences.

## Output map

The selected ticketing variant is also emitted once, to `ticketing.includePath`
(default `.agents/includes/ticketing.md`); all three harnesses read that same file at runtime.

| Source unit | → Claude | → Codex | → OpenCode |
|---|---|---|---|
| `skills/dev-cycle` | `.claude/skills/dev-cycle/SKILL.md` | `.agents/skills/dev-cycle/SKILL.md` + `…/agents/openai.yaml` | `.opencode/skills/dev-cycle/SKILL.md` |
| `skills/product-architect` | `.claude/skills/product-architect/SKILL.md` | `.agents/skills/product-architect/SKILL.md` + `…/agents/openai.yaml` | `.opencode/skills/product-architect/SKILL.md` |
| `agents/developer` | `.claude/agents/developer.md` | `.codex/agents/developer.toml` | `.opencode/agents/developer.md` |
| `agents/qa-engineer` | `.claude/agents/qa-engineer.md` | `.codex/agents/qa-engineer.toml` | `.opencode/agents/qa-engineer.md` |
| `agents/code-reviewer` | `.claude/agents/code-reviewer.md` | `.codex/agents/code-reviewer.toml` | `.opencode/agents/code-reviewer.md` |

Note: Codex skills are emitted under `.agents/skills/` (the location Codex loads skills from at
runtime), not `.codex/`.
