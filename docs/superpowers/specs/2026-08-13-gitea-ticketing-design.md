# Design: Gitea Ticketing Backend

**Date:** 2026-08-13
**Status:** Implemented

## Goal

Add a fourth ticketing backend, `gitea`, alongside the existing `github`, `file`, and
`azure-devops` backends. Ticketing operations run through **[`tea`](https://gitea.com/gitea/tea)**,
Gitea's official CLI, via the Bash tool — no MCP server is involved. The **`tea` login profile name**
must be supplied by the user; it is the only Gitea-specific value the generator stores.

Gitea is issue-and-label shaped exactly like GitHub, so this backend is structurally the `github`
backend with a different CLI — not a new ticketing model. That is the whole reason it is cheap to add.

## Architecture

The backend is selected by `ticketing.backend: "gitea"` in the project-owned `ai-project.json`. As
with every other backend, the only runtime artifact is the rendered include at `{{ticketing.include}}`
(default `.agents/includes/ticketing.md`). Agent and skill bodies are **not** changed — they already
point at the include as the single source of truth.

Unlike `azure-devops`, this backend emits **no** additional outputs: no `.mcp.json` merge, no
`.codex/config.toml` merge, and no additions to any agent's Claude tool allowlist. All three ticketing
agents already carry `Bash`, which is all `tea` needs. The entire backend is therefore one include
plus config/token wiring.

### Files

| File | Change |
|---|---|
| `agent-src/includes/ticketing-gitea.md` | **New** — source-of-truth include for the backend |
| `agent-src/lib/config.mjs` | `gitea` branch in `buildProjectConfig`; `ticketing.gitea.login` token; `gitea` added to the label-based status encoding |
| `agent-src/lib/pipeline.mjs` | Fail-closed validation: `gitea` without a login throws |
| `agent-src/lib/onboard.mjs` | `gitea` in the backend choice + the login follow-up question |
| `agent-src/config/ai-project.template.json` | Add the `ticketing.gitea` block so the scaffold shows it |
| `README.md` | New "Gitea backend setup" section (CLI, login profile, status labels) |
| `agent-src/README.md`, `CLAUDE.md`, `agent-src/generate.mjs` | Backend lists + token documentation |

`package.json` needs no change: `agent-src/includes` is allowlisted as a whole directory, and no new
`lib/*.mjs` module is introduced. Verified with `npm pack --dry-run`.

## Config Shape (`ai-project.json`, project-owned)

```jsonc
"ticketing": {
  "backend": "gitea",
  "gitea": {
    "login": "myserver"   // the `tea login add` profile name; user MUST fill in
  }
}
```

`repository.slug` continues to identify the repository (`owner/repo`, passed as `--repo`).

**Why the profile name and not a URL + token.** A `tea` login profile already holds the instance URL,
the access token, and the user. Referencing it by name means no server URL and no credential ever
reaches `ai-project.json` or any generated file — both of which are committed. A `url` field was
considered and deliberately dropped: `tea` does not need it, and an optional token used inside the
include would break the fail-closed rule that an unresolved `{{…}}` throws.

Generation fails with a clear error when `ticketing.gitea.login` is missing, mirroring the
`azureDevOps.organization` guard.

## Status Encoding — Labels

Gitea labels behave like GitHub labels, so the six workflow states resolve to the same
`status:<id>` strings from each state's `label` field in `ai-workflow.json`. In `buildGlobalTokens`
the existing switch simply gains a member:

```js
const usesTagLabels = backend === 'github' || backend === 'gitea' || backend === 'azure-devops';
```

No new state mapping, no `azureState`-style parallel token set.

**One Gitea behavior forced a design decision.** Gitea does not error on an unknown label in a filter
— it silently drops the filter. `tea issues list --labels "status:new"` against a repository where
that label does not exist returns **every open issue** rather than none. Since that is exactly the
query the workflow uses to pick up work, a missing label would make the developer treat arbitrary
open issues as ready-to-build tickets. The include therefore makes label existence a hard precondition
checked once per session via `tea labels list`, instructs the agent to stop and ask a human rather
than create labels itself, and adds a post-query check that returned issues actually carry the
requested label. The README documents the same for the human doing the setup.

## The Include (`ticketing-gitea.md`)

Same section structure as `ticketing-github.md`:

1. **Repository** — `{{repo.slug}}` on the instance behind the `{{ticketing.gitea.login}}` profile.
2. **CLI Tool** — `tea` for all operations, plus the two mechanical rules below.
3. **Status labels** — the precondition described above, then the standard table.
4. **Upstream ticket** — unchanged from the GitHub include (Gitea has no formal relation type either,
   so the `**Upstream:**` body line convention carries over verbatim).
5. **Commands Reference** — reading, creating, commenting, status transition, close (human-only), PRs.
6. **Artifacts**, **body templates**, **git branching** — identical to the other backends.

Two `tea` mechanics are encoded explicitly because both were found empirically and neither is obvious:

- **Every `--login` value is quoted.** `tea login add` accepts spaces in a profile name, and a real
  install produced `gitea ki`. Unquoted, that splits into two arguments and `tea` answers
  `Error: login name 'gitea' does not exist`. A regression test asserts that no `--login` value is
  rendered unquoted.
- **Commands must run inside a git working tree.** `tea` resolves the local repository first and
  aborts with `git rev-parse --show-toplevel: fatal: not a git repository` outside one, *even when
  `--repo` is given explicitly*. Never a problem for the agents, who work in the project repo, but
  the include says so rather than claiming location independence.

## Testing / Validation

Automated (added to the existing `node --test` suite, 47 → 54 tests):

1. `buildProjectConfig` records the login and omits the `file`/`azureDevOps` blocks.
2. `buildGlobalTokens` exposes `ticketing.gitea.login` and resolves statuses to labels.
3. `renderAll` renders the include with the login substituted and no `gh` remnants.
4. `renderAll` throws when the login is missing.
5. A login containing a space renders as one shell argument everywhere.
6. `cmdInit`/`init --answers` write the expected config, and reject a `gitea` project without a login.
7. End-to-end: `init --answers` → `generate` produces a fully resolved include.

Manual, against a real Gitea instance and `tea` 0.15.1 — every subcommand and flag checked against
that binary's own `--help`, and each **read-only** command executed verbatim as rendered:
`tea labels list`, `tea issues list` (plain, `--labels`, `--output json`), `tea issues <index>`,
`tea comments list <index>`. The label-filter behavior described above was characterized by comparing
an unfiltered query against filters with an existing-and-present label, an existing-but-absent label,
and a nonexistent label.

The write commands (`tea issues create`/`edit`/`close`, `tea pulls create`) were verified against
`--help` but **not executed**; creating the six status labels via `tea labels create` was the only
write path exercised.

## Out of Scope

- Gitea's **scoped labels** (`status/new` with `exclusive: true`), which would let Gitea itself
  enforce that only one status label is set at a time. Attractive for a state machine, but the label
  strings live in the shared `ai-workflow.json` and are used by the `github` and `azure-devops`
  backends too — changing the scheme is a cross-backend decision, not a Gitea detail.
- Creating the status labels from the generator. It cannot reach the server at generation time, and
  writing to a user's tracker as a side effect of `generate` would be the wrong default.
- Organization-wide or instance-wide label defaults. Documented in the README as a manual option
  (`custom/options/label/*.yaml` needs filesystem access to the server; `tea labels create` has no
  `--org` flag).
- Gitea Actions, releases, wiki, or any other `tea` capability beyond issues, comments, labels, and
  pull requests.
