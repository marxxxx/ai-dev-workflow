# Ticketing System: Azure DevOps Work Items

This generated include defines Azure DevOps ticket operations for `{{project.name}}`. Edit
`agent-src/includes/ticketing-azure-devops.md` or select another backend in `ai-project.json`, then
regenerate.

## Scope

Work items live in the **{{ticketing.azure.project}}** project of the **{{ticketing.azure.organization}}**
Azure DevOps organization. Git branches and pull requests target the `{{repo.slug}}` repository.

## Tooling

**Use the `ado` MCP server tools for ALL ticketing operations — never a CLI.** Each tool covers
several operations; the `action` parameter selects which one. The relevant tools (domains `core`,
`work`, `work-items`) are:

| Tool | `action` | Use |
|------|----------|-----|
| `wit_query` | `wiql` | List/find work items (filter by tag or state via WIQL) |
| `wit_work_item` | `get` | Read a single work item (pass `expand: "All"` for fields + relations) |
| `wit_work_item` | `list_comments` | Read a work item's comments |
| `wit_work_item_write` | `create` | Create a work item of a given type with fields |
| `wit_work_item_write` | `update` | Change fields (tags, State) via JSON Patch operations |
| `wit_work_item_comment_write` | `add`, `update` | Append a Markdown comment, or rewrite one by `commentId` |
| `wit_work_item_link_write` | `link` | Relate one work item to another |
| `wit_work_item_attachment` | — | Download an attachment (bug screenshots and other evidence) |

**Always pass `project: "{{ticketing.azure.project}}"` to these tools.** When `project` is omitted
the server raises an interactive project-selection prompt, which stalls an autonomous agent.

## Status Encoding

The workflow state is authoritative in the work item's **Tags**. The native **State** field is
nudged alongside for board visibility only.

| Status Tag | Native State (board) | Meaning | Set By |
|------------|----------------------|---------|--------|
| `{{status.new}}` | `{{azureState.new}}` | Ready for development | Product-architect (on creation) |
| `{{status.in-progress}}` | `{{azureState.in-progress}}` | Developer actively working | Developer (before starting) |
| `{{status.review}}` | `{{azureState.review}}` | Implementation complete, awaiting review | Developer (after implementation) |
| `{{status.test}}` | `{{azureState.test}}` | Review passed, ready for QA | Code reviewer |
| `{{status.acceptance-test}}` | `{{azureState.acceptance-test}}` | QA passed; PR/human acceptance pending | QA engineer |
| `{{status.failed}}` | `{{azureState.failed}}` | Review or QA found blocking issues | Code reviewer or QA engineer |
| **Done / Closed** | `Done` | Human has verified and accepted | **Human only — NEVER set by automation** |

Tags are a single semicolon-separated string in the `System.Tags` field. A status transition
**replaces** the status tag (remove the old `status:*`, add the new one) and sets `System.State`.

## Commands Reference

### Reading Work Items

```text
# Find all work items at a given status (WIQL filters on the tag)
wit_query(action: "wiql", project: "{{ticketing.azure.project}}",
  wiql: "SELECT [System.Id], [System.Title], [System.State], [System.Tags] FROM WorkItems
         WHERE [System.TeamProject] = '{{ticketing.azure.project}}'
           AND [System.Tags] CONTAINS '{{status.new}}' ORDER BY [System.Id]")

# Read one work item with all fields and relations ("All" is capitalized)
wit_work_item(action: "get", id: <id>, project: "{{ticketing.azure.project}}", expand: "All")

# Read its comments (the journal and the other artifacts live here) — note: workItemId, not id
wit_work_item(action: "list_comments", workItemId: <id>, project: "{{ticketing.azure.project}}")

# Open an attachment (bug screenshots, logs). Attachments appear in the "get" response above as
# AttachedFile relations; the attachmentId is the last URL segment. Omit savePath to get the
# content inline (images come back viewable), or pass a relative dir to save it instead.
wit_work_item_attachment(attachmentId: "<guid>", project: "{{ticketing.azure.project}}",
  fileName: "screenshot.png")
```

### Creating Work Items

Use `{{ticketing.azure.featureType}}` for features and `{{ticketing.azure.bugType}}` for bugs.
Set the title, the body (Description), and the initial status tag. `fields` is an **array** of
`{ name, value }` entries — not an object map — and large Markdown bodies need `format: "Markdown"`
or they are stored as HTML and render mangled.

```text
wit_work_item_write(
  action: "create",
  project: "{{ticketing.azure.project}}",
  workItemType: "{{ticketing.azure.featureType}}",
  fields: [
    { name: "System.Title", value: "[Work item title]" },
    { name: "System.Description", value: "<rendered body from the template below>", format: "Markdown" },
    { name: "System.Tags", value: "{{status.new}}" },
    { name: "System.State", value: "{{azureState.new}}" }
  ])
```

### Updating Work Items

```text
# Transition status: swap the status tag and set the board State.
# Read System.Tags first (wit_work_item action "get"), recompute the tag string, then:
# (every patch `value` must be a string — object payloads are rejected)
wit_work_item_write(action: "update", id: <id>, project: "{{ticketing.azure.project}}", updates: [
  { "op": "replace", "path": "/fields/System.Tags", "value": "<other tags>;{{status.test}}" },
  { "op": "replace", "path": "/fields/System.State", "value": "{{azureState.test}}" }
])

# Add a comment — note: workItemId and text (not id and comment)
wit_work_item_comment_write(action: "add", workItemId: <id>,
  project: "{{ticketing.azure.project}}", text: "...", format: "Markdown")
```

Never set `System.State` to `Done` and never remove a work item — human acceptance only.

### Linking an Upstream Work Item

A work item may originate from an **upstream ticket** — typically an Azure DevOps Product Backlog Item
where the initial requirement was described. How the product-architect records one depends on where the
upstream ticket lives.

```text
# Upstream is an Azure DevOps work item (natural case): native "related" link.
wit_work_item_link_write(action: "link", project: "{{ticketing.azure.project}}", updates: [
  { id: <impl-id>, linkToId: <upstream-id>, type: "related", comment: "Upstream requirement" }
])

# Upstream lives outside Azure DevOps: record it as a comment on the implementation work item.
# The MCP server offers no arbitrary hyperlink relation, so the comment is the record.
wit_work_item_comment_write(action: "add", workItemId: <impl-id>,
  project: "{{ticketing.azure.project}}", format: "Markdown",
  text: "**Upstream:** <upstream-url>")

# No upstream ticket: record the explicit answer required by the creation gate.
wit_work_item_comment_write(action: "add", workItemId: <impl-id>,
  project: "{{ticketing.azure.project}}", format: "Markdown",
  text: "**Upstream:** None")
```

An upstream ticket is optional, but recording the answer is mandatory. With `None`, the implementation
work item is the single source of truth. An upstream number drives the feature-branch name (see Git
Branching Convention). Later agents read the record from relations via
`wit_work_item(action: "get", id, expand: "All")`, or the `**Upstream:**` comment via
`wit_work_item(action: "list_comments", workItemId)`.

### Pull Requests

```bash
az repos pr create --repository "{{repo.slug}}" \
  --project "{{ticketing.azure.project}}" \
  --organization "https://dev.azure.com/{{ticketing.azure.organization}}" \
  --target-branch "{{git.prTarget}}" --source-branch "{{git.branchPattern}}" \
  --draft true \
  --title "[id]: [work item title]" \
  --description "..."
```

Automation creates only draft pull requests. A human publishes, reviews, merges, and closes them.
Automation leaves the work item at `{{status.acceptance-test}}` (board State
`{{azureState.acceptance-test}}`) and never sets `Done`.

## Work Item Comment Artifacts

Use named comments for `{{artifact.implementationNotes}}` (developer),
`{{artifact.reviewFeedback}}` (reviewer), `{{artifact.testResults}}` (QA),
`{{artifact.costOrigin}}` (product-architect), and `{{artifact.costSummary}}` (`dev-cycle`).
`{{artifact.journal}}` — the workflow's progress record — is the only mutable artifact: create it with comment action `add`, then edit
it in place with `update`.

## The Journal Comment

The `{{artifact.journal}}` comment is one mutable comment per work item, addressed by its numeric
**comment id** and rewritten in place on every update. Its content and protocol are defined in the
handoff include; the operations below are the Azure DevOps mechanics.

`wit_work_item_comment_write` takes `action: "update"` alongside `add` — that is what makes the
in-place journal possible here. It requires **both** `workItemId` and `commentId`: comment ids are
scoped per work item, not global, so a `commentId` alone is not addressable.

There is no "get one comment" tool. Discover the id — and read the body — from a single
`list_comments` call, **once per ticket**; every write afterwards is a direct `update` that needs no
listing. In the `list_comments` response the comment's identifier is the `id` field.

```text
# Create the journal comment (once per work item). Keep the comment id from the response.
wit_work_item_comment_write(action: "add", workItemId: <id>,
  project: "{{ticketing.azure.project}}", format: "Markdown",
  text: "## {{artifact.journal}}\n...the full journal, per the handoff include...")

# Discover the id — and read the body — of an existing journal comment (once per ticket).
# Take the newest entry whose text starts with "## {{artifact.journal}}"; its `id` is the comment id.
wit_work_item(action: "list_comments", workItemId: <id>, project: "{{ticketing.azure.project}}")

# Update the journal in place by id (replaces the whole text)
wit_work_item_comment_write(action: "update", workItemId: <id>, commentId: <comment-id>,
  project: "{{ticketing.azure.project}}", format: "Markdown",
  text: "## {{artifact.journal}}\n...the full journal...")
```

The MCP server exposes no comment delete — correct for the journal, which is edited, never replaced.

## Work Item Body Templates

### Feature Template

```markdown
## Overview
[Brief description of the feature and its value to the user]

## Requirements
- [ ] Requirement 1
- [ ] Requirement 2

## Explicit Exclusions
- [Out-of-scope behavior, or None]

## Architecture & Implementation Guidance
[High-level technical approach agreed upon with the human.]

### Affected Layers
- **Frontend:** [Components, services, or modules affected]
- **Backend:** [Controllers, services, or modules affected]
- **Data Model:** [Schema changes if any]

### Approach
[Description of the agreed-upon technical approach]

### Constraints & Hints
- [Specific patterns the developer must follow]
- [Libraries or utilities to use or avoid]

## Dependencies
[List dependent work items or "None"]

## Acceptance Criteria
### Functional Criteria
- [ ] Criterion 1
- [ ] Criterion 2

### Visual Criteria [HUMAN REVIEW]
- [ ] [VISUAL - HUMAN REVIEW] [Subjective criterion; omit section when none]
```

### Bug Template

```markdown
## Overview
[Brief description of the bug]

## Steps to Reproduce
1. Step 1
2. Step 2

## Expected Behavior
[What should happen]

## Actual Behavior
[What actually happens]

## Evidence
- Screenshots: [attach or reference]
- Console errors: [relevant error messages]

## Explicit Exclusions
- [Out-of-scope behavior, or None]

## Architecture & Implementation Guidance
### Likely Root Cause
[Analysis of where the bug likely originates]

### Suggested Fix Approach
[High-level guidance on how to fix it]

## Acceptance Criteria
### Functional Criteria
- [ ] Bug no longer occurs when following reproduction steps

### Visual Criteria [HUMAN REVIEW]
- [ ] [VISUAL - HUMAN REVIEW] [Subjective criterion; omit section when none]
```

## Git Branching Convention

- Branch name: `{{git.branchPattern}}` (for example `feat/42_user-login`).
- When the work item records an upstream ticket (a `System.LinkTypes.Related` relation or an
  `**Upstream:**` comment), the branch's first segment is the **upstream ticket number**
  instead of the implementation work-item id — for example an upstream PBI `12345` uses
  `feat/12345_user-login`. With no upstream ticket, use the implementation work-item id as before.
- All implementation work happens on the feature branch.
- Merged into `{{git.prTarget}}` only after human acceptance.
