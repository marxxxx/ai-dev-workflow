# Design: Azure DevOps Ticketing Backend

**Date:** 2026-06-28
**Status:** Approved (pending spec review)

## Goal

Add a third ticketing backend, `azure-devops`, alongside the existing `github` and
`file` backends. Ticketing operations run through the local **`@azure-devops/mcp`** MCP
server (working reference config: `/home/mx/src/WorkLog/.mcp.json`) rather than a CLI.
The Azure DevOps **organization** name must be supplied by the user (the example uses
`StroblDev`).

## Architecture

The backend is selected by `ticketing.backend: "azure-devops"` in the project-owned
`ai-project.json`. Exactly as with `github`/`file`, the only runtime artifact is the
rendered include at `{{ticketing.include}}` (default `.agents/includes/ticketing.md`).
Agent and skill bodies are **not** changed — they already point at the include as the
single source of truth and must not hardcode provider-specific commands, status
encoding, or repository names.

Operations target the `@azure-devops/mcp` server tools (domains `core`, `work`,
`work-items`) instead of `gh`/shell.

### Files

| File | Change |
|---|---|
| `agent-src/includes/ticketing-azure-devops.md` | **New** — source-of-truth include for the backend |
| `agent-src/generate.mjs` | Status/azureState token resolution, ADO config tokens, `.mcp.json` merge emission |
| `agent-src/ai-workflow.json` | Add per-state `azureState` field (data-driven native-State mapping) |
| `ai-project.json` | Add `ticketing.azureDevOps` sub-config + switch example (kept as-is / documented) |
| `agent-src/ai-project.template.json` | Add `ticketing.azureDevOps` block so `init` scaffolds it |
| `README.md` / `agent-src/README.md` | Document the new backend + `.mcp.json` ownership |

## Config Shape (`ai-project.json`, project-owned)

```jsonc
"ticketing": {
  "backend": "azure-devops",
  "itemNoun": "work item",
  "azureDevOps": {
    "organization": "StroblDev",   // feeds the MCP server arg; user MUST fill in
    "project": "MyProject",        // scopes work-item queries/creation
    "featureType": "Issue",        // Basic process default; Agile users set "User Story"
    "bugType": "Issue"             // Basic process default; Agile users set "Bug"
  }
}
```

`repository.slug` continues to identify the git repository (used for branch/PR flow).

The shipped defaults target the **Basic** process template (work item types
`Epic`/`Issue`/`Task`, states `To Do`/`Doing`/`Done`). Agile/Scrum users override
`featureType`/`bugType` and the `azureState` mapping. Both are overridable; no value is
hardcoded into the include.

## Status Encoding — Tags + Native State (Hybrid)

The 6 workflow states (`new`, `in-progress`, `review`, `test`, `failed`,
`acceptance-test`) do not map cleanly onto Azure DevOps' small, process-specific State
set, so the authoritative machine lives in **tags**, with the native **State** field
nudged for board visibility.

- **Tags** carry the precise workflow state — `status:new`, `status:in-progress`, etc.
  — mirroring the GitHub-labels model. A transition removes the old tag and adds the new
  one. These resolve from each state's existing `label` field in `ai-workflow.json`.
- **Native State** is set from a new per-state `azureState` field in `ai-workflow.json`.
  Default mapping (Basic process):

  | workflow state | azureState |
  |---|---|
  | new | To Do |
  | in-progress | Doing |
  | review | Doing |
  | test | Doing |
  | failed | Doing |
  | acceptance-test | Doing |
  | (human acceptance) | **Done — never set by automation** |

`Done`/closing is reserved for humans, consistent with the other backends (automation
never closes a ticket).

### Generator token wiring (`buildGlobalTokens`)

- `status.<id>` resolves to the **tag** string for the `azure-devops` backend (the
  `label`, e.g. `status:in-progress`) — same source the `github` backend uses.
- A parallel `azureState.<id>` token set exposes the native-State value for each state,
  consumed by the include on transitions.
- New ADO config tokens: `ticketing.azure.organization`, `ticketing.azure.project`,
  `ticketing.azure.featureType`, `ticketing.azure.bugType`.

The current line
`put('status.' + id, backend === 'github' ? s.label : s.frontmatter)` becomes a small
switch: `github` and `azure-devops` use `s.label`; `file` uses `s.frontmatter`.

## `.mcp.json` Generation — Non-Destructive Merge

When `backend === "azure-devops"`, the generator emits/updates `.mcp.json` at the
project root:

```jsonc
"ado": {
  "type": "stdio",
  "command": "npx",
  "args": ["-y", "@azure-devops/mcp", "<organization>", "-d", "core", "work", "work-items"]
}
```

Behavior:

- Read the existing `.mcp.json` if present; set/replace **only** the `ado` server key
  under `mcpServers`; preserve every other server and any `inputs`. If absent, create it
  with `{ "mcpServers": { "ado": {…} }, "inputs": [] }`.
- `<organization>` is interpolated from `ticketing.azureDevOps.organization`. If that is
  missing/empty, generation fails with a clear error (the org is required).
- `check` mode performs the same in-memory merge against current disk and diffs, so
  drift detection keeps working.
- This is the first generated output whose content depends on existing disk state, so it
  is handled by a dedicated merge path (not the pure-render pipeline). The existing
  unresolved-placeholder and duplicate-path checks continue to apply to all other
  outputs. Because `.mcp.json` content is partly user-owned, it does **not** carry the
  `DO NOT EDIT` banner; the merge is keyed on the `ado` server name only.

## The Include (`ticketing-azure-devops.md`)

Same section structure as `ticketing-github.md` / `ticketing-file.md`:

1. **Repository / Scope** — work items in project `{{ticketing.azure.project}}` of
   organization `{{ticketing.azure.organization}}`.
2. **Tooling** — use the `@azure-devops/mcp` MCP server tools for all ticketing
   operations (no CLI). Exact tool names (e.g. work-item create/get/update/query, add
   comment, update tags + State) are **verified against `@azure-devops/mcp` during
   implementation** and written explicitly into the include.
3. **Status table** — tag per state (`{{status.*}}`) + the native State it nudges
   (`{{azureState.*}}`); Done is human-only.
4. **Commands Reference** — reading, creating (Feature→`{{ticketing.azure.featureType}}`,
   Bug→`{{ticketing.azure.bugType}}`), commenting, status transition (swap tag + set
   State), PR/handoff.
5. **Artifacts** — the same named comments (`{{artifact.implementationNotes}}`,
   `{{artifact.reviewFeedback}}`, `{{artifact.testResults}}`) posted as work-item
   comments.
6. **Issue/Bug body templates** — same content as the other backends.
7. **Git branching** — `{{git.branchPattern}}` → `{{git.prTarget}}`, same as today;
   PRs created via the existing git/`gh` flow or left human-driven, matching the repo's
   convention.

## Testing / Validation

No automated test harness exists in the repo; the generator self-validates via `check`
and deterministic smoke checks. Validation steps for this change:

1. Point a sample `ai-project.json` at `backend: "azure-devops"` with an org/project and
   run `generate`.
2. Confirm `.agents/includes/ticketing.md` renders with **no** unresolved `{{…}}`.
3. Confirm `.mcp.json` is created with the `ado` server; re-run with a pre-existing dummy
   server in `.mcp.json` and confirm that server is **preserved** and only `ado` is
   updated.
4. Confirm `check` reports clean immediately after `generate`.
5. Confirm a missing/empty `organization` fails generation with a clear message.

## Out of Scope

- Mapping our state machine onto Azure DevOps Boards columns / swimlanes.
- Area path / team / iteration scoping (can be added to `azureDevOps` config later).
- Authenticating the MCP server (handled by the user's Azure CLI / env, per the
  `@azure-devops/mcp` docs).
