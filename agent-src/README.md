# agent-src — single source of truth for agent & skill definitions

The `agent-dev` skill (and any future skill or subagent) definitions for Claude Code, Codex, and OpenCode are **generated** from
the canonical sources in this directory. No tool reads `agent-src/` at runtime; it exists only to
generate the per-platform files.

**Edit here, run the generator, never edit the generated files.**

## Workflow

1. Edit a unit's `body.md` (shared, platform-neutral prose) or `manifest.json` (per-platform config).
2. Run `npm test`, then render into a consuming project to inspect the output (this repo has no
   `ai-project.json` and no generated files of its own):

   ```bash
   node agent-src/generate.mjs generate --root <project>
   ```

Every generated file carries a `DO NOT EDIT — generated from agent-src/…` banner. Hand-edits are
caught by `generate.mjs check` (renders in memory and diffs against disk; exits non-zero on drift).

## Layout

```
agent-src/
  generate.mjs                 # entrypoint: zero-dependency Node CLI (parse argv + dispatch)
  lib/                         # feature modules the entrypoint composes:
    constants.mjs serialize.mjs identity.mjs config.mjs tokens.mjs units.mjs
    ticketing.mjs cost.mjs renderers.mjs onboard.mjs pipeline.mjs
  config/
    ai-workflow.json           # PACKAGE-owned config: ticket states/comment titles + runtime include paths
    ai-project.template.json   # scaffold template copied by `init` when non-interactive
  includes/
    ticketing-github.md        # ticket read/comment/status/PR — GitHub (gh CLI)
    ticketing-gitea.md         # … — Gitea (tea CLI, verified vs. 0.15.1)
    ticketing-file.md          # … — file-based (.tickets/)
    ticketing-azure-devops.md  # … — Azure DevOps (@azure-devops/mcp)
    cost.md                    # how agent-dev totals a run's ccusage sessions + posts the summary
  skills/<name>/
    body.md                    # shared SKILL body — uses {{token}}s; references the includes
    manifest.json              # name, description, platforms{}, interface{} (Codex openai.yaml)
  agents/<name>/               # (none ship today; the renderers still support subagents)
    body.md, manifest.json

<project-root>/
  ai-project.json              # PROJECT-owned config: project/repository/git identity + ticketing backend choice
  agent-custom/<agents|skills>/<name>/   # PROJECT-owned, optional: body.md (override) / append.md (extend)
```

## Portability: two config files + the ticketing include

Config is split by ownership so the package can be updated without clobbering project settings, and
the project can't accidentally desync skill-coupled values:

- **`ai-project.json`** lives at the **project root** and is project-owned: `project` identity,
  `repository`, `git`, and the `ticketing` **backend choice** (`"github"` | `"file"` | `"gitea"` |
  `"azure-devops"`) plus the github/file/gitea/azureDevOps sub-configs. This file stays in the project across updates.
- **`agent-src/config/ai-workflow.json`** ships **with the package** and is package-owned: the
  `workflow.states` / `workflow.artifacts` (coupled to the `agent-dev` skill) and
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
- `{{ticketing.dir}}`, `{{ticketing.metadataFile}}` — file backend only
- `{{git.prTarget}}` (branch and PR names are fixed by `agent-dev`, derived from the ticket)
- `{{artifact.implementationSummary}}`, `{{artifact.costSummary}}` — one per key of
  `workflow.artifacts`; each is the title of a ticket comment `agent-dev` posts at close-out
- `{{cost.include}}` — the cost-summary include path, package-owned like `{{ticketing.include}}`
- `{{status.<id>}}` — resolves to the label (`status:new`) for github, gitea and azure-devops, or the
  file-frontmatter value (`new`) for file, depending on `ticketing.backend`. Used only inside the
  ticketing includes; bodies refer to states logically (`new`, `in-progress`, `review`) and defer their
  representation to the include.
- `{{azureState.<id>}}` — the Azure DevOps native board State (e.g. `Doing`) the work item is
  nudged to on each transition; azure-devops backend only.
- `{{ticketing.azure.organization}}`, `{{ticketing.azure.project}}`, `{{ticketing.azure.featureType}}`,
  `{{ticketing.azure.bugType}}` — azure-devops work item targeting + types.
- `{{ticketing.gitea.login}}` — the `tea login add` profile naming the Gitea instance; passed as
  `--login` on every `tea` command. Required for the gitea backend (rendering fails without it).

Per-unit `manifest.tokens` still work and override a global token of the same name.

**Ticketing is read at runtime, not inlined.** The generator renders the selected
`includes/ticketing-<backend>.md` (with tokens substituted) to `ticketing.includePath`
(default `.agents/includes/ticketing.md`) and **every** agent/skill body — across all three harnesses —
instructs the agent to read that one file before any ticket operation. The includes are the single
place that knows repository names, CLI commands, status encoding, comments, branch naming, and PRs;
the includes folder is where you add a new backend. Keep them short — they are read on every run.
The azure-devops backend additionally merges an `ado` server into the project's `.mcp.json` and
`.codex/config.toml` (non-destructively).

`AGENTS.md` (and `CLAUDE.md`) remain hand-owned, project-specific docs carrying the
tech-stack/commands/conventions prose that `agent-dev` reads first. `init` does not scaffold or own
them; you create `AGENTS.md` with your coding agent's native `/init`. They are never regenerated or
overwritten — unlike the platform files, which `generate` owns.

A unit *may* also contain `overlays/<platform>.md`; the generator appends it to that platform's
rendered body. This is the structural guarantee that platform-specific guidance does **not leak**
between tools. None exist today: superpowers ships its own per-harness tool mappings, so `agent-dev`
needs no platform-specific guidance. Anything not genuinely platform-specific belongs in `body.md`.

**Project overrides (`agent-custom/`).** A consuming project can tailor any shipped unit without
forking the package by adding a committed `agent-custom/{agents,skills}/<name>/` dir at its root
(read via `--root`). Per unit: `body.md` **replaces** the package body (escape hatch), and
`append.md` is **appended** after the platform overlay (safe, upstream-tracking default). Both get
the same `{{token}}` treatment; an unresolved token throws. Resolution order is **package body (or the
project override) → platform overlay → project append**. These files are generation *inputs*, so
`check` stays meaningful; a customized unit's `DO NOT EDIT` banner names both sources. See the root
[README](../README.md#customizing-the-skill) for the consumer-facing guide.

## Manifest schema

- `name`, `description` — shared across platforms (the `description` is platform-neutral).
- `platforms` — one key per emitted platform (`claude`, `codex`, `opencode`); a platform absent from
  this map is not emitted. Per-platform config:
  - **claude**: `model`, `tools[]` (allowlist, emitted verbatim).
  - **codex**: `model`, `model_reasoning_effort`, `nickname_candidates[]`.
  - **opencode**: `model`, `temperature`, `mode`.
- `interface` (skills only) — Codex skill descriptor written to `agents/openai.yaml`
  (`display_name`, `short_description`, `default_prompt`).
- `tokens` — per-unit `{{token}}` overrides (string or per-platform map). These override the global
  tokens derived from the merged config for that unit only. Prefer overlays for structural/tooling/workflow
  differences.

## Output map

The selected ticketing variant is emitted once to `ticketing.includePath`
(`.agents/includes/ticketing.md`), and the cost include to `.agents/includes/cost.md`; all three
harnesses read those same files at runtime.

| Source unit | → Claude | → Codex | → OpenCode |
|---|---|---|---|
| `skills/agent-dev` | `.claude/skills/agent-dev/SKILL.md` | `.agents/skills/agent-dev/SKILL.md` + `…/agents/openai.yaml` | `.opencode/skills/agent-dev/SKILL.md` |
| `agents/<name>` (none ship today) | `.claude/agents/<name>.md` | `.codex/agents/<name>.toml` | `.opencode/agents/<name>.md` |

Note: Codex skills are emitted under `.agents/skills/` (the location Codex loads skills from at
runtime), not `.codex/`.
