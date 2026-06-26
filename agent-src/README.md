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
  generate.mjs                 # zero-dependency Node renderer (node:fs + node:path); also --check
  project.json                 # single source of truth for project identity + ticketing (see below)
  includes/
    ticketing-github.md        # ticketing operations — GitHub (gh CLI) variant
    ticketing-file.md          # ticketing operations — file-based (.tickets/) variant
  skills/<name>/
    body.md                    # shared SKILL body — uses {{token}}s; references the ticketing include
    manifest.json              # name, description, platforms{}, interface{} (Codex openai.yaml)
  agents/<name>/
    body.md                    # shared agent instructions — uses {{token}}s
    manifest.json              # name, description, platforms{} (model/tools/config per platform)
```

## Portability: `project.json` + the ticketing include

Everything project-specific — the project name, the repository, the ticketing backend, the workflow
state names — lives in `agent-src/project.json`. Bodies and manifest descriptions reference it through
`{{token}}`s, so the same agent/skill sources work for any project.

To take this setup to another project: edit `project.json` (project identity, `repository.slug`) and
run the generator. To switch ticketing backends (e.g. GitHub ⇄ local files), change one line —
`ticketing.backend` (`"github"` | `"file"`) — and regenerate.

**Global tokens.** The generator flattens `project.json` into a dotted token namespace available to
every body and to each manifest `description`/`interface` string:

- `{{project.name}}`, `{{project.slug}}`, `{{project.serena}}`, `{{project.description}}`
- `{{repo.slug}}`, `{{repo.defaultBranch}}`
- `{{ticketing.include}}` (path agents read at runtime), `{{ticketing.itemNoun}}`, `{{ticketing.backend}}`
- `{{git.branchPattern}}`, `{{git.prTarget}}`
- `{{artifact.implementationNotes}}`, `{{artifact.reviewFeedback}}`, `{{artifact.testResults}}`
- `{{status.<id>}}` — resolves to the GitHub label (`status:new`) or the file-frontmatter value
  (`new`) depending on `ticketing.backend`. Used only inside the ticketing includes; bodies refer to
  states logically (`new`, `review`, …) and defer their representation to the include.

Per-unit `manifest.tokens` still work and override a global token of the same name.

**Ticketing is read at runtime, not inlined.** The generator renders the selected
`includes/ticketing-<backend>.md` (with tokens substituted) to `ticketing.includePath`
(default `.agent/includes/ticketing.md`) and **every** agent/skill body — across all three harnesses —
instructs the agent to read that one file before any ticket operation. The includes are the single
place that knows repository names, CLI commands, status encoding, comment mechanisms, and PR/handoff;
the includes folder is where you add a new backend.

`AGENTS.md` (and `CLAUDE.md`) remain hand-maintained, project-specific docs — they are **not**
generated. They still carry the tech-stack/ports/conventions prose.

A unit *may* also contain `overlays/<platform>.md`; the generator appends it to that platform's
rendered body. This is the structural guarantee that platform-specific guidance does **not leak**
between tools. None exist today — Serena, Playwright, and superpowers are available on all three
platforms, so that guidance lives in the shared `body.md`.

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
  tokens derived from `project.json` for that unit only. Prefer overlays for structural/tooling/workflow
  differences.

## Output map

The selected ticketing variant is also emitted once, to `ticketing.includePath`
(default `.agent/includes/ticketing.md`); all three harnesses read that same file at runtime.

| Source unit | → Claude | → Codex | → OpenCode |
|---|---|---|---|
| `skills/dev-cycle` | `.claude/skills/dev-cycle/SKILL.md` | `.agents/skills/dev-cycle/SKILL.md` + `…/agents/openai.yaml` | `.opencode/skills/dev-cycle/SKILL.md` |
| `skills/product-architect` | `.claude/skills/product-architect/SKILL.md` | `.agents/skills/product-architect/SKILL.md` + `…/agents/openai.yaml` | `.opencode/skills/product-architect/SKILL.md` |
| `agents/developer` | `.claude/agents/developer.md` | `.codex/agents/developer.toml` | `.opencode/agents/developer.md` |
| `agents/qa-engineer` | `.claude/agents/qa-engineer.md` | `.codex/agents/qa-engineer.toml` | `.opencode/agents/qa-engineer.md` |
| `agents/code-reviewer` | `.claude/agents/code-reviewer.md` | `.codex/agents/code-reviewer.toml` | `.opencode/agents/code-reviewer.md` |

Note: Codex skills are emitted under `.agents/skills/` (the location Codex loads skills from at
runtime), not `.codex/`.
