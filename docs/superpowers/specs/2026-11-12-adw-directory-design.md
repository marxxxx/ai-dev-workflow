# Project files move into `.adw/`, launchers become `adw.sh` / `adw.ps1`

## Problem

`init` and `generate` put up to nine files and one directory at the root of a consuming project:
`ai-project.json`, `compose.ai-dev.yml` plus three overlays, `ai-dev.sh`, `ai-dev.ps1`, `AI-DEV.md`,
`.env.ai-dev` and, optionally, `agent-custom/`. Next to the project's own files, the root becomes hard
to read. The names also mix two brands: the package and CLI are `adw`, the files say `ai-dev`.

## Goal

Everything adw owns in a project lives in one tooling directory, `.adw/`, which is the convention
`.devcontainer/`, `.github/` and the harness dirs already follow. The project root keeps only the
two launchers people type every day, renamed to the `adw` brand. An existing project gets the new
layout with one `npx @strobl_dev/adw@<new> upgrade`, which prints every file it moved or renamed.

Success:
- After a fresh `init` (container set up) and `generate`, the root holds only `adw.sh`, `adw.ps1`,
  `.adw/` and the paths no tool lets us move (see "Stays at the root").
- On an existing project, `upgrade` moves the files, rewrites the launchers, prints an
  `old → new` line for each, and the container starts with `./adw.sh` with all logins intact
  (same compose project name, so the same `agent-home` volume).
- A customized `compose.ai-dev.yml` arrives byte-identical at `.adw/compose.yml`.
- `npm test` stays green; `npm pack --dry-run` lists the renamed templates.

## Target layout

```
adw.sh                        ← ai-dev.sh
adw.ps1                       ← ai-dev.ps1
.adw/
  project.json                ← ai-project.json
  compose.yml                 ← compose.ai-dev.yml
  compose.certs.yml           ← compose.ai-dev.certs.yml
  compose.dind.yml            ← compose.ai-dev.dind.yml
  compose.dind-certs.yml      ← compose.ai-dev.dind-certs.yml
  README.md                   ← AI-DEV.md
  .env                        ← .env.ai-dev
  custom/                     ← agent-custom/
  e2e/                        (unchanged: adw e2e's local store already lives here)
```

`.gitignore` gets `.adw/.env` **added** (the old `.env.ai-dev` line stays, see "Teammates' local
`.env.ai-dev`"); `.gitattributes` gets `adw.sh text eol=lf` (replacing `ai-dev.sh text eol=lf`).

### Stays at the root

`.claude/`, `.codex/` (incl. `config.toml`), `.opencode/`, `.agents/`, `.mcp.json` (harness lookup
locations), `skills-lock.json` (location fixed by `npx skills`), `AGENTS.md` / `CLAUDE.md`
(hand-owned, read by the harnesses), `docs/superpowers/` (superpowers' convention). `.agents/includes/`
stays where it is; it is hidden already and moving it gains nothing.

## Decisions

### Names that change, names that stay

Everything a user sees and touches in the project moves to `adw`: the directory, the launchers, the
file names above, CLI messages and docs (e.g. `onboard.mjs` still prints "run `ai-dev-workflow
generate`"; that becomes the `adw` command).

These three stay as they are, because they live inside the project-owned `compose.yml`, which
`upgrade` only moves and never edits, and because renaming the first would orphan the volumes that
hold every login:
- the Compose project name `name: <slug>-ai`
- the Compose service name `ai-dev-workflow`
- the image `marxx/ai-dev-workflow:*`

Also unchanged: the `# BEGIN/END ai-dev-workflow managed` markers in `.codex/config.toml` and the
`~/.cache/ai-dev-workflow` path inside the image.

### `.adw/.env` replaces `.env.ai-dev`

The launchers keep parsing the file themselves, with today's rules (never override a set variable),
and export its values, so Compose interpolation sees them.

### Compose keeps the project root as its project directory (my call)

Every `docker compose` call adw makes (launchers, `e2e/local/session.mjs`, `e2e/local/setup.mjs`,
`e2e/local/cli.mjs`, `image.mjs`) passes `--project-directory <project root>`. Without it, Compose
would resolve relative paths in a customized `compose.yml` (bind sources like `./db-init`, `build:`
context, `env_file:`, `configs`/`secrets`/`extends`) against `.adw/`, and a moved, byte-identical
file would break. With it, Compose behaves exactly as today: relative paths resolve against the
root, and Compose's own `.env` auto-load still reads the root `.env`. The `.env` side effect discussed
earlier therefore does not happen; nobody has to move `AGENT_IMAGE` out of a root `.env`.
`.adw/README.md` shows `--project-directory` in the "without the launchers" command, and the overlay
header comments that show a manual `docker compose -f …` command (new templates only) do too.

### The container still sees the whole project

The compose files use only absolute paths from variables (`${PROJECT_ROOT}`, `${AGENT_CA_DIR}`).
The launchers stay at the root, so `PROJECT_ROOT` remains the launcher's directory; only the `-f`
paths (`.adw/compose*.yml`) and the env-file path change. Verified with `docker compose config`:
with the file under a subdirectory the bind source is still the project root and the project name is
unchanged.

### Teammates' local `.env.ai-dev` (my call)

`.env.ai-dev` is git-ignored, so `upgrade` moves it only on the machine that runs it. A teammate who
pulls the upgrade commit still has a root `.env.ai-dev`, possibly with secrets
(`CLAUDE_CODE_OAUTH_TOKEN`, written by `adw e2e`).
- `.gitignore` keeps the `.env.ai-dev` line, so the file never becomes committable.
- When `.env.ai-dev` exists at the root and `.adw/.env` does not, `adw.sh` / `adw.ps1` print one
  line to stderr ("move .env.ai-dev to .adw/.env, or run adw upgrade") and continue without it.
- `upgrade` on that machine moves it like any other old file.

### `upgrade` migrates the layout

Runs first, before the existing steps (so `cleanProjectConfig` and `generate` already see
`.adw/project.json`).

- **Move** each old path that exists to its new path: `ai-project.json`, the four compose files,
  `.env.ai-dev`, `agent-custom/`. A plain filesystem move; content is never changed,
  including a customized `compose.ai-dev.yml`. No `git mv`; committing is the user's job.
- **`AI-DEV.md`:** when it exists, write `.adw/README.md` fresh from the current template and delete
  the old file (owner's decision: it is never customized, and a moved copy would keep ~22 stale
  `./ai-dev.sh` commands). The template needs `@@SLUG@@` (read it from the `name: <slug>-ai` line of
  the moved `.adw/compose.yml`, falling back to `composeSlug(project.name, basename(root))`), the
  backend and, for gitea, the login (both from `.adw/project.json`). The header comments of the
  moved compose files keep their old `./ai-dev.sh` mentions; that is accepted.
- **Launchers:** when `ai-dev.sh` / `ai-dev.ps1` exist, write `adw.sh` / `adw.ps1` fresh from the
  current templates (mode 0755 for `adw.sh`) and delete the old ones. Old launchers are never
  customized (owner's statement), so they are not compared or preserved. If `ai-dev.*` does not
  exist, no launcher is written.
- **Ignore files:** add `.adw/.env` to `.gitignore` when `.env.ai-dev` is listed there (keep the old
  line); replace `ai-dev.sh text eol=lf` in `.gitattributes` with `adw.sh text eol=lf` when present.
- **Conflicts:** if the target already exists, leave both in place, do not overwrite, and report the
  pair as a conflict. The migration still handles the other files; then `upgrade` stops before
  `cleanProjectConfig`, `generate` and the skills sync and exits non-zero (my call), so a script
  notices. Today `generate.mjs` renders before calling `upgrade()`; the migration has to run before
  that render.
- **Output:** one line per move or rename (`ai-project.json → .adw/project.json`), plus conflicts,
  plus a closing pointer to `.adw/README.md`.
- **`--dry-run`:** prints the same list without touching anything.

### Old layout outside `upgrade`

`generate`, `check`, `init` and `adw e2e` know only the new layout. If the project root holds any
old-layout path that `upgrade` would move or rename (`ai-project.json`, `compose.ai-dev*.yml`,
`AI-DEV.md`, `agent-custom/`, `ai-dev.sh`, `ai-dev.ps1`), they fail with a message to run `upgrade`,
instead of rendering with defaults or writing a second set of files. A leftover after an `upgrade`
conflict is such a path, so it blocks too. `.env.ai-dev` does not block (it is per machine; the
launchers warn instead). The check lives in the CLI commands on the live project root.

`adw e2e` is not in use by any project yet, so a base commit with the old layout is not supported
(owner's decision): its sandbox reads and writes only the new paths (`.adw/project.json`,
`.adw/custom/`) and does no layout migration.

### The image reads both locations

`docker/launch-agent.mjs` (the in-image wrapper) reads `/workspace/.adw/project.json` and falls back
to `/workspace/ai-project.json`. Images and npm versions are released independently and the
launchers pull before every start, so the fallback lets an un-upgraded project run on the new image.
CI pushes the image on every merge to `main`, so it is out before the release tag publishes to npm.

### Container warnings

`containerWarnings` checks `.adw/compose.yml` for the `KILL` capability. The pull warning for old
launchers goes away: `upgrade` replaces those launchers anyway, and `generate`/`check` refuse the
old layout.

### `.adw/README.md` stays findable

`.adw/` is hidden on Linux/macOS. The launchers' header comment, `init`'s "Details:" line and the
`upgrade` output name `.adw/README.md` explicitly.

## Places to change (orientation, not exhaustive)

- `agent-src/container/`: rename templates; update paths and the text in launchers, `README.md`
  (ex `AI-DEV.md`), `ticketing/*.md` (`./adw.sh …`).
- `agent-src/lib/`: `container.mjs` (file list, ignore lines, warnings, `nextSteps`),
  `constants.mjs` (`CUSTOM_DIR` → `.adw/custom`; the generator banner text changes with it),
  `config.mjs`, `skills.mjs`, `onboard.mjs`, `upgrade.mjs`, `generate.mjs`.
- `e2e/local/`: `cli.mjs`, `session.mjs`, `setup.mjs`, `sandbox.mjs`, `config.mjs`, `image.mjs`
  (compose file paths, `.adw/.env`, `.adw/project.json`, messages).
- Harbor e2e: `e2e/lib/bundle.mjs`, `e2e/run.mjs`, `e2e/.gitignore`,
  `e2e/agents/opencode_subscription.py` (references to `ai-project.json`).
- `docker/launch-agent.mjs` (fallback), `docker/check-host-artifacts.mjs` (messages),
  `docker/README.md`.
- `README.md`, `agent-src/README.md`, `AGENTS.md` (paths and an "Upgrading to vX" note: "`upgrade`
  moves the files into `.adw/` and renames the launchers to `adw.sh` / `adw.ps1`; teammates move
  their own `.env.ai-dev` to `.adw/.env` or run `upgrade`").
- `package.json` `files` for the renamed templates.

## Upgrade path

Covered by the `upgrade` migration above: one `npx @strobl_dev/adw@<new> upgrade` moves everything
and prints what it did. README "Updating" gets the version note.

## E2E coverage

- Unit tests (`upgrade.test.mjs`, `container.test.mjs`, launch-agent tests, `e2e/local` tests): every
  move, a customized compose file arriving unchanged, `.adw/README.md` rewritten with the right slug
  and backend, the conflict case (non-zero exit, no generate), `--dry-run`, the ignore-line changes, the launcher rewrite, the old-layout refusal in
  `generate`/`check`, the image fallback, `--project-directory` in every compose call.
- Harbor e2e: the bundles switch to `.adw/project.json`, so one run (e2e-run skill, any harness)
  shows the generator and the in-image wrapper work with the new location. No new contract check:
  Harbor exercises `agent-dev`, which this change does not touch.
- `adw e2e` on a consumer project exercises the new compose paths and `.adw/.env`.

## Non-goals

- Renaming the image, the Compose project name or the service name.
- The hand-maintained dev container of this repository (`compose.ai-dev.yml`, `ai-dev.ps1` at its
  root): no consumer uses it.
- Moving the file backend's `.tickets/` default (my call; the ticket dir is configured per project).
- Supporting the old layout in `generate`/`check`/`init`/`adw e2e`, including `adw e2e` replays of
  pre-migration base commits.

## Anti-goals

- Editing a project-owned file's content while moving it. (The launchers and `AI-DEV.md` are not
  moved but rewritten from the template, by the owner's decision.)
- Overwriting anything that already exists at a target path.
- Silent moves: every change `upgrade` makes is printed.
