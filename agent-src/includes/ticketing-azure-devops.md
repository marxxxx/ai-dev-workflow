# Ticketing: Azure DevOps Work Items

Generated from `agent-src/includes/ticketing-azure-devops.md` for {{project.name}} — do not edit by
hand. Work items live in project **{{ticketing.azure.project}}** of organization
**{{ticketing.azure.organization}}**; the code lives in repository `{{repo.slug}}`.

Use the `ado` MCP server (`@azure-devops/mcp` v2) for every ticket operation, and **always pass
`project: "{{ticketing.azure.project}}"`** — without it the server prompts interactively and stalls.

## Read

```text
wit_work_item(action: "get", id: <id>, project: "{{ticketing.azure.project}}", expand: "All")
wit_work_item(action: "list_comments", workItemId: <id>, project: "{{ticketing.azure.project}}")
# Attachments (screenshots, logs) appear as AttachedFile relations; the id is the last URL segment.
wit_work_item_attachment(attachmentId: "<guid>", project: "{{ticketing.azure.project}}", fileName: "<name>")
```

## Create

Created straight into `{{status.in-progress}}`; the response carries the new work item's `id`.
`fields` is an array of `{ name, value }` entries, and the Markdown body needs `format: "Markdown"`.

```text
wit_work_item_write(action: "create", project: "{{ticketing.azure.project}}",
  workItemType: "{{ticketing.azure.featureType}}", fields: [
    { name: "System.Title", value: "<title>" },
    { name: "System.Description", value: "<a few sentences summarizing the spec; spec path>", format: "Markdown" },
    { name: "System.Tags", value: "{{status.in-progress}}" },
    { name: "System.State", value: "{{azureState.in-progress}}" }
  ])
```

Use `{{ticketing.azure.bugType}}` instead when the work is a bug fix.

## Comment

```text
wit_work_item_comment_write(action: "add", workItemId: <id>,
  project: "{{ticketing.azure.project}}", text: "## <Title>\n...", format: "Markdown")
```

## Status

The status tag in `System.Tags` (semicolon-separated) is authoritative; `System.State` is nudged along
for the board. A transition replaces the old `status:*` tag and sets the State. Read the current tags
first, then write the recomputed string (every patch `value` must be a string).

| Tag | Board State | Meaning |
|---|---|---|
| `{{status.new}}` | `{{azureState.new}}` | Ready to build |
| `{{status.in-progress}}` | `{{azureState.in-progress}}` | agent-dev is working on it |
| `{{status.review}}` | `{{azureState.review}}` | Work finished; awaiting human review and acceptance |

```text
wit_work_item_write(action: "update", id: <id>, project: "{{ticketing.azure.project}}", updates: [
  { "op": "replace", "path": "/fields/System.Tags", "value": "<other tags>;{{status.review}}" },
  { "op": "replace", "path": "/fields/System.State", "value": "{{azureState.review}}" }
])
```

Never set `Done` and never remove a work item — that is the human's acceptance.

## Pull Requests

Always open PRs as drafts; the human reviewer publishes them after reviewing and testing.

```bash
az repos pr create --repository "{{repo.slug}}" --project "{{ticketing.azure.project}}" \
  --organization "https://dev.azure.com/{{ticketing.azure.organization}}" \
  --target-branch "{{git.prTarget}}" --source-branch "<branch>" --draft true \
  --title "<pr-title>" --description "..."
```
