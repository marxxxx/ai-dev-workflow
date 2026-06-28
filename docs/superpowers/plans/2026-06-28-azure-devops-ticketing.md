# Azure DevOps Ticketing Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an `azure-devops` ticketing backend that drives work items through the `@azure-devops/mcp` server, selectable via `ticketing.backend` in `ai-project.json`.

**Architecture:** Same generator pattern as the existing `github`/`file` backends — a new source-of-truth include (`agent-src/includes/ticketing-azure-devops.md`) is the only runtime artifact for agent/skill bodies. Workflow state is carried in work-item **tags** (authoritative, mirroring GitHub labels) with the native **State** field nudged for board visibility (Basic process: To Do / Doing / Done). The generator additionally merges an `ado` server entry into `.mcp.json` and, for this backend only, injects the `ado` MCP tools into the three Claude ticketing-agent allowlists.

**Tech Stack:** Node ≥ (whatever the repo targets — `node:fs` + `node:path` only, zero dependencies), Markdown includes with `{{token}}` substitution, JSON config.

## Global Constraints

- **Zero runtime dependencies.** The generator uses only `node:fs`, `node:path`, `node:url`. Do not add packages.
- **LF line endings** on every written file (existing `writeAll` already writes raw strings; keep content LF-only).
- **No `{{…}}` may survive** in any rendered output — the generator throws on unresolved placeholders. Every token used in the new include must be defined in `buildGlobalTokens`.
- **Generated outputs carry a `DO NOT EDIT` banner**, EXCEPT `.mcp.json`, which is a non-destructive merge of partly user-owned content and carries no banner.
- **Automation never closes / never sets `Done`.** Closing is human-only, consistent with the other backends.
- **Defaults target the Basic process** (work item types `Issue`; states `To Do`/`Doing`/`Done`). Agile users override via config; nothing process-specific is hardcoded into the include.
- **Backend swap changes only the include** for agent/skill *bodies*. Tags/State/config differences live in the include and generator, not in any agent body.

---

## File Structure

| File | Responsibility |
|---|---|
| `agent-src/ai-workflow.json` | Add `azureState` to each workflow state (data-driven native-State mapping). |
| `agent-src/generate.mjs` | Resolve `status.*` to tags for azure-devops; emit `azureState.*` + `ticketing.azure.*` tokens; merge `.mcp.json`; inject `ado` tools into ticketing agents for this backend. |
| `agent-src/includes/ticketing-azure-devops.md` | New source-of-truth include describing MCP-tool-based ticketing. |
| `agent-src/ai-project.template.json` | Add `ticketing.azureDevOps` block so `init` scaffolds it. |
| `ai-project.json` | Add `ticketing.azureDevOps` block (kept on `file` backend; documents the shape). |
| `README.md` | Document the `azure-devops` backend + `.mcp.json` ownership. |

**Shared test fixture (used by several tasks):** an azure-devops-configured project root at `/tmp/ado-fixture`. Each test that needs it (re)creates it self-contained, so tasks are order-independent. The fixture is outside the repo, so the package repo stays clean (this repo's own backend is `file`).

---

### Task 1: Native-State mapping + generator token wiring

Adds the `azureState` data to the workflow states and teaches `buildGlobalTokens` to (a) resolve `status.*` to tags for the azure-devops backend, (b) emit `azureState.*` tokens, and (c) emit `ticketing.azure.*` config tokens.

**Files:**
- Modify: `agent-src/ai-workflow.json` (add `azureState` to each state)
- Modify: `agent-src/generate.mjs` (`buildGlobalTokens`, ~lines 144-176)
- Test: `/tmp/ado-token-check.mjs` (throwaway assertion script)

**Interfaces:**
- Produces (tokens available to every include/body):
  - `status.<id>` → tag string (the state's `label`, e.g. `status:in-progress`) for `github` **and** `azure-devops`; the state's `frontmatter` for `file`.
  - `azureState.<id>` → native State string (e.g. `Doing`) for every state.
  - `ticketing.azure.organization`, `ticketing.azure.project`, `ticketing.azure.featureType` (default `Issue`), `ticketing.azure.bugType` (default `Issue`).

- [ ] **Step 1: Add `azureState` to each state in `agent-src/ai-workflow.json`**

Add an `"azureState"` field to every object in `workflow.states`. Final values (Basic process):

```json
{ "id": "new", "label": "status:new", "frontmatter": "new", "azureState": "To Do", "meaning": "Ready to build", "next": "in-progress" },
{ "id": "in-progress", "label": "status:in-progress", "frontmatter": "in-progress", "azureState": "Doing", "meaning": "Implementation running or interrupted", "next": "review" },
{ "id": "review", "label": "status:review", "frontmatter": "review", "azureState": "Doing", "meaning": "Awaiting code review", "next": "test" },
{ "id": "test", "label": "status:test", "frontmatter": "test", "azureState": "Doing", "meaning": "Ready for acceptance QA", "next": "acceptance-test" },
{ "id": "failed", "label": "status:failed", "frontmatter": "failed", "azureState": "Doing", "meaning": "Review or QA failure", "next": "in-progress" },
{ "id": "acceptance-test", "label": "status:acceptance-test", "frontmatter": "acceptance-test", "azureState": "Doing", "meaning": "PR/human acceptance pending", "next": null }
```

(Preserve the existing key order per object; just insert `azureState` after `frontmatter`.)

- [ ] **Step 2: Write the failing token-check script**

Create `/tmp/ado-token-check.mjs`:

```js
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const REPO = process.argv[2]; // pass repo root
// Re-import the generator's internals by requiring via a tiny shim is hard (it self-runs main()).
// Instead, generate against an azure-devops fixture and assert the rendered include tokens.
const FIXT = '/tmp/ado-fixture';
fs.mkdirSync(FIXT, { recursive: true });
fs.writeFileSync(path.join(FIXT, 'ai-project.json'), JSON.stringify({
  project: { name: 'Demo', slug: 'demo', serenaProject: 'demo', description: 'demo' },
  repository: { slug: 'Demo', defaultBranch: 'main' },
  ticketing: { backend: 'azure-devops', itemNoun: 'work item',
    azureDevOps: { organization: 'StroblDev', project: 'DemoProject' } },
  git: { branchPattern: 'feat/<issue-number>_<slug>', prTarget: 'main' }
}, null, 2));

execFileSync('node', [path.join(REPO, 'agent-src/generate.mjs'), '--root', FIXT, 'generate'], { stdio: 'inherit' });
const inc = fs.readFileSync(path.join(FIXT, '.agents/includes/ticketing.md'), 'utf8');
const must = ['status:in-progress', 'StroblDev', 'DemoProject', 'Doing', 'To Do'];
for (const m of must) {
  if (!inc.includes(m)) { console.error('MISSING:', m); process.exit(1); }
}
console.log('TOKEN CHECK PASS');
```

- [ ] **Step 3: Run it to confirm it fails**

Run: `node /tmp/ado-token-check.mjs /home/mx/src/ai-dev-workflow`
Expected: FAIL — generation errors with `ticketing backend "azure-devops" selected but agent-src/includes/ticketing-azure-devops.md not found` (the include doesn't exist yet) **or** an unresolved-token error. Either failure confirms the wiring isn't complete. (This test fully passes only after Task 2 lands the include; for Task 1 the goal is that `buildGlobalTokens` no longer throws on the azure tokens — verified in Step 5.)

- [ ] **Step 4: Update `buildGlobalTokens` in `agent-src/generate.mjs`**

Replace the status loop and add azure tokens. Find:

```js
  put('ticketing.dir', c.ticketing?.file?.dir);
  put('ticketing.metadataFile', c.ticketing?.file?.metadataFile);
```

Insert immediately after it:

```js
  put('ticketing.azure.organization', c.ticketing?.azureDevOps?.organization);
  put('ticketing.azure.project', c.ticketing?.azureDevOps?.project);
  put('ticketing.azure.featureType', c.ticketing?.azureDevOps?.featureType || 'Issue');
  put('ticketing.azure.bugType', c.ticketing?.azureDevOps?.bugType || 'Issue');
```

Then find:

```js
  for (const s of c.workflow?.states || []) {
    put(`status.${s.id}`, backend === 'github' ? s.label : s.frontmatter);
  }
```

Replace with:

```js
  const usesTagLabels = backend === 'github' || backend === 'azure-devops';
  for (const s of c.workflow?.states || []) {
    put(`status.${s.id}`, usesTagLabels ? s.label : s.frontmatter);
    put(`azureState.${s.id}`, s.azureState);
  }
```

- [ ] **Step 5: Verify the token wiring resolves (no token error)**

The full include doesn't exist yet, so generation still fails on the missing include file — but it must fail with the **missing-include** message, NOT a token error. Run:

```bash
node /tmp/ado-token-check.mjs /home/mx/src/ai-dev-workflow 2>&1 | tail -5
```

Expected: output contains `agent-src/includes/ticketing-azure-devops.md not found`. (Confirms `buildGlobalTokens` accepted the azure config without an undefined-token throw.)

- [ ] **Step 6: Confirm existing backends still generate cleanly**

Run: `node agent-src/generate.mjs generate`
Expected: `Generated N file(s) from agent-src/.` with no error (the repo's own `file` backend is unaffected; `azureState.*` tokens are defined-but-unused there, which is allowed). The generated dirs are gitignored, so `generate` is the regression signal here rather than `check`.

- [ ] **Step 7: Commit**

```bash
git add agent-src/ai-workflow.json agent-src/generate.mjs
git commit -m "adds azure-devops state mapping and token wiring to generator"
```

---

### Task 2: The `ticketing-azure-devops.md` include

The runtime source-of-truth describing every ticketing operation via the `@azure-devops/mcp` tools. Same section structure as `ticketing-github.md`. After this task the full token-check from Task 1 passes.

**Files:**
- Create: `agent-src/includes/ticketing-azure-devops.md`
- Test: reuse `/tmp/ado-token-check.mjs`

**Interfaces:**
- Consumes tokens from Task 1: `status.*`, `azureState.*`, `ticketing.azure.organization`, `ticketing.azure.project`, `ticketing.azure.featureType`, `ticketing.azure.bugType`, plus existing globals (`project.name`, `repo.slug`, `git.*`, `artifact.*`, `ticketing.itemNoun`).
- Produces: the rendered `.agents/includes/ticketing.md` consumed by all agent/skill bodies.

- [ ] **Step 1: Write the include**

Create `agent-src/includes/ticketing-azure-devops.md` with exactly this content:

````markdown
# Ticketing System: Azure DevOps Work Items

This file is the single source of truth for how every agent interacts with the ticketing system.
It is generated from `agent-src/includes/ticketing-azure-devops.md` for {{project.name}}. To switch
the project to a different backend (for example GitHub issues), change `ticketing.backend` in
`ai-project.json` and regenerate — do not edit this file by hand.

## Scope

Work items live in the **{{ticketing.azure.project}}** project of the **{{ticketing.azure.organization}}**
Azure DevOps organization. Git branches and pull requests target the `{{repo.slug}}` repository.

## Tooling

**Use the `ado` MCP server tools for ALL ticketing operations — never a CLI.** The relevant tools
(domains `core`, `work`, `work-items`) are:

| Tool | Use |
|------|-----|
| `wit_query_by_wiql` | List/find work items (filter by tag or state via WIQL) |
| `wit_get_work_item` | Read a single work item (pass `expand: "all"` for fields + relations) |
| `wit_list_work_item_comments` | Read a work item's comments |
| `wit_create_work_item` | Create a work item of a given type with fields |
| `wit_update_work_item` | Change fields (tags, State) via JSON Patch operations |
| `wit_add_work_item_comment` | Append a Markdown comment |

Always pass `project: "{{ticketing.azure.project}}"` to these tools.

## Status Encoding

The workflow state is authoritative in the work item's **Tags**. The native **State** field is
nudged alongside for board visibility only.

| Status Tag | Native State (board) | Meaning | Set By |
|------------|----------------------|---------|--------|
| `{{status.new}}` | `{{azureState.new}}` | Ready for development | Product-architect (on creation) |
| `{{status.in-progress}}` | `{{azureState.in-progress}}` | Developer actively working | Developer (before starting) |
| `{{status.review}}` | `{{azureState.review}}` | Implementation complete, awaiting review | Developer (after implementation) |
| `{{status.test}}` | `{{azureState.test}}` | Review passed, ready for QA | Orchestrator (after review passes) |
| `{{status.acceptance-test}}` | `{{azureState.acceptance-test}}` | Automated workflow complete, PR open | Orchestrator (after QA passes) |
| `{{status.failed}}` | `{{azureState.failed}}` | Review or QA found issues | Orchestrator (on failure) |
| **Done / Closed** | `Done` | Human has verified and accepted | **Human only — NEVER set by automation** |

Tags are a single semicolon-separated string in the `System.Tags` field. A status transition
**replaces** the status tag (remove the old `status:*`, add the new one) and sets `System.State`.

## Commands Reference

### Reading Work Items

```text
# Find all work items at a given status (WIQL filters on the tag)
wit_query_by_wiql(project: "{{ticketing.azure.project}}",
  wiql: "SELECT [System.Id], [System.Title], [System.State], [System.Tags] FROM WorkItems
         WHERE [System.TeamProject] = '{{ticketing.azure.project}}'
           AND [System.Tags] CONTAINS '{{status.new}}' ORDER BY [System.Id]")

# Read one work item with all fields
wit_get_work_item(id: <id>, project: "{{ticketing.azure.project}}", expand: "all")

# Read its comments (artifact handoffs live here)
wit_list_work_item_comments(id: <id>, project: "{{ticketing.azure.project}}")
```

### Creating Work Items

Use `{{ticketing.azure.featureType}}` for features and `{{ticketing.azure.bugType}}` for bugs.
Set the title, the body (Description), and the initial status tag.

```text
wit_create_work_item(
  project: "{{ticketing.azure.project}}",
  workItemType: "{{ticketing.azure.featureType}}",
  fields: {
    "System.Title": "[Work item title]",
    "System.Description": "<rendered body from the template below>",
    "System.Tags": "{{status.new}}",
    "System.State": "{{azureState.new}}"
  })
```

### Updating Work Items

```text
# Transition status: swap the status tag and set the board State.
# Read System.Tags first (wit_get_work_item), recompute the tag string, then:
wit_update_work_item(id: <id>, project: "{{ticketing.azure.project}}", updates: [
  { "op": "replace", "path": "/fields/System.Tags", "value": "<other tags>;{{status.test}}" },
  { "op": "replace", "path": "/fields/System.State", "value": "{{azureState.test}}" }
])

# Add a comment
wit_add_work_item_comment(id: <id>, project: "{{ticketing.azure.project}}",
  comment: "...")
```

Never set `System.State` to `Done` and never remove a work item — human acceptance only.

### Pull Requests

```bash
gh pr create --repo {{repo.slug}} \
  --base {{git.prTarget}} --head {{git.branchPattern}} \
  --title "feat: [work item title] #[id]" \
  --body "..."
```

A human reviews, merges, and accepts. Automation leaves the work item at
`{{status.acceptance-test}}` (board State `{{azureState.acceptance-test}}`) and never sets `Done`.

## Work Item Comment Artifacts

The workflow hands context between agents through named work-item comments (via
`wit_add_work_item_comment`):

- `{{artifact.implementationNotes}}` — posted by the developer after implementation.
- `{{artifact.reviewFeedback}}` — posted by the code reviewer when findings exist.
- `{{artifact.testResults}}` — posted by the QA engineer after acceptance testing.

## Work Item Body Templates

### Feature Template

```markdown
## Overview
[Brief description of the feature and its value to the user]

## Requirements
- [ ] Requirement 1
- [ ] Requirement 2

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
- [ ] Criterion 1
- [ ] Criterion 2
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

## Architecture & Implementation Guidance
### Likely Root Cause
[Analysis of where the bug likely originates]

### Suggested Fix Approach
[High-level guidance on how to fix it]

## Acceptance Criteria
- [ ] Bug no longer occurs when following reproduction steps
```

## Git Branching Convention

- Branch name: `{{git.branchPattern}}` (for example `feat/42_user-login`).
- All implementation work happens on the feature branch.
- Merged into `{{git.prTarget}}` only after human acceptance.
````

- [ ] **Step 2: Run the full token check — expect PASS**

Run: `node /tmp/ado-token-check.mjs /home/mx/src/ai-dev-workflow`
Expected: ends with `TOKEN CHECK PASS` (generation succeeds; the rendered include contains `status:in-progress`, `StroblDev`, `DemoProject`, `Doing`, `To Do`).

- [ ] **Step 3: Assert no unresolved placeholders survived**

Run: `grep -n '{{' /tmp/ado-fixture/.agents/includes/ticketing.md || echo 'NO PLACEHOLDERS'`
Expected: `NO PLACEHOLDERS`.

- [ ] **Step 4: Assert the DO-NOT-EDIT banner is present**

Run: `head -1 /tmp/ado-fixture/.agents/includes/ticketing.md`
Expected: a line containing `DO NOT EDIT — generated from agent-src/includes/ticketing-azure-devops.md`.

- [ ] **Step 5: Commit**

```bash
git add agent-src/includes/ticketing-azure-devops.md
git commit -m "adds azure-devops ticketing include (MCP work-item operations)"
```

---

### Task 3: Merge the `ado` server into `.mcp.json`

When the backend is `azure-devops`, the generator emits/updates `.mcp.json`, replacing only the `ado` server entry and preserving everything else. Fails fast when the organization is missing.

**Files:**
- Modify: `agent-src/generate.mjs` (new `renderMcpJson`, called from `renderAll`, ~after the ticketing include block at lines 401-409)
- Test: shell assertions against `/tmp/ado-fixture`

**Interfaces:**
- Produces: `renderMcpJson(config, projectRoot)` → `{ path: '.mcp.json', content }` or `null` (non-azure backend). Output participates in `writeAll`/`checkAll` like any other output.

- [ ] **Step 1: Write the failing test (pre-existing server must survive)**

```bash
rm -rf /tmp/ado-fixture && mkdir -p /tmp/ado-fixture
cat > /tmp/ado-fixture/ai-project.json <<'JSON'
{
  "project": { "name": "Demo", "slug": "demo", "serenaProject": "demo", "description": "demo" },
  "repository": { "slug": "Demo", "defaultBranch": "main" },
  "ticketing": { "backend": "azure-devops", "itemNoun": "work item",
    "azureDevOps": { "organization": "StroblDev", "project": "DemoProject" } },
  "git": { "branchPattern": "feat/<issue-number>_<slug>", "prTarget": "main" }
}
JSON
cat > /tmp/ado-fixture/.mcp.json <<'JSON'
{ "mcpServers": { "existing": { "type": "stdio", "command": "echo", "args": ["hi"] } }, "inputs": [] }
JSON
node agent-src/generate.mjs --root /tmp/ado-fixture generate
node -e "const d=require('/tmp/ado-fixture/.mcp.json'); if(!d.mcpServers.existing) throw new Error('clobbered existing server'); if(!d.mcpServers.ado) throw new Error('ado not added'); if(d.mcpServers.ado.args[2]!=='StroblDev') throw new Error('org not interpolated'); console.log('MCP MERGE PASS')"
```

Expected: FAIL — `.mcp.json` is unchanged (no `ado` key), so the `node -e` assertion throws `ado not added`.

- [ ] **Step 2: Add `renderMcpJson` to `agent-src/generate.mjs`**

Insert this function immediately after `renderTicketingInclude` (before the "Renderers" section comment, ~line 276):

```js
/**
 * For the azure-devops backend, merge the `ado` MCP server entry into the project's
 * .mcp.json, preserving any other servers and `inputs`. Returns null for other backends.
 * Reads current disk so `check` can re-merge and diff. Not banner-stamped — .mcp.json is
 * partly user-owned; the merge is keyed on the `ado` server name only.
 */
function renderMcpJson(config, projectRoot) {
  if (config.ticketing?.backend !== 'azure-devops') return null;
  const org = config.ticketing?.azureDevOps?.organization;
  if (!org) {
    throw new Error('ticketing.azureDevOps.organization is required for the azure-devops backend');
  }
  const mcpPath = path.join(projectRoot, '.mcp.json');
  let doc = { mcpServers: {}, inputs: [] };
  if (fs.existsSync(mcpPath)) {
    try {
      doc = JSON.parse(fs.readFileSync(mcpPath, 'utf8'));
    } catch (e) {
      throw new Error(`.mcp.json is not valid JSON: ${e.message}`);
    }
    if (!doc.mcpServers || typeof doc.mcpServers !== 'object') doc.mcpServers = {};
  }
  doc.mcpServers.ado = {
    type: 'stdio',
    command: 'npx',
    args: ['-y', '@azure-devops/mcp', org, '-d', 'core', 'work', 'work-items'],
  };
  return { path: '.mcp.json', content: JSON.stringify(doc, null, 2) + '\n' };
}
```

- [ ] **Step 3: Call it from `renderAll`**

Find (≈ lines 401-409):

```js
  // The resolved ticketing include — referenced at runtime by every body.
  const ticketing = renderTicketingInclude(config, globalTokens);
  if (ticketing) {
    if (/\{\{.*?\}\}/.test(ticketing.content)) {
      throw new Error(`Ticketing include: unresolved placeholder in ${ticketing.path}`);
    }
    seenPaths.add(ticketing.path);
    outputs.push(ticketing);
  }
```

Insert immediately after that block:

```js
  // The azure-devops backend also owns the `ado` entry in .mcp.json (non-destructive merge).
  const mcp = renderMcpJson(config, projectRoot);
  if (mcp) {
    seenPaths.add(mcp.path);
    outputs.push(mcp);
  }
```

(No placeholder check needed — `.mcp.json` content is pure JSON with no `{{…}}`.)

- [ ] **Step 4: Run the merge test — expect PASS**

```bash
rm -f /tmp/ado-fixture/.mcp.json
cat > /tmp/ado-fixture/.mcp.json <<'JSON'
{ "mcpServers": { "existing": { "type": "stdio", "command": "echo", "args": ["hi"] } }, "inputs": [] }
JSON
node agent-src/generate.mjs --root /tmp/ado-fixture generate
node -e "const d=require('/tmp/ado-fixture/.mcp.json'); if(!d.mcpServers.existing) throw new Error('clobbered existing server'); if(!d.mcpServers.ado) throw new Error('ado not added'); if(d.mcpServers.ado.args[2]!=='StroblDev') throw new Error('org not interpolated'); console.log('MCP MERGE PASS')"
```

Expected: prints `MCP MERGE PASS`.

- [ ] **Step 5: Verify `check` is clean right after generate**

Run: `node agent-src/generate.mjs --root /tmp/ado-fixture check`
Expected: `--check: N file(s) up to date.` (the re-merge is idempotent, including the preserved `existing` server).

- [ ] **Step 6: Verify missing-organization fails clearly**

```bash
node -e "const fs=require('fs');const p='/tmp/ado-fixture/ai-project.json';const d=JSON.parse(fs.readFileSync(p));delete d.ticketing.azureDevOps.organization;fs.writeFileSync(p,JSON.stringify(d,null,2))"
node agent-src/generate.mjs --root /tmp/ado-fixture generate; echo "exit=$?"
```

Expected: stderr contains `ticketing.azureDevOps.organization is required`; `exit=1`. (Restore the org afterward: re-add `"organization": "StroblDev"`.)

- [ ] **Step 7: Commit**

```bash
git add agent-src/generate.mjs
git commit -m "merges ado mcp server into .mcp.json for azure-devops backend"
```

---

### Task 4: Inject `ado` MCP tools into the Claude ticketing agents

The Claude `developer`, `code-reviewer`, and `qa-engineer` agents have restricted tool allowlists with no Azure DevOps tools. For the `azure-devops` backend only, the generator appends the `ado` MCP tools so these agents can read/comment/transition work items. Other backends are unaffected (they use `Bash`/`gh`).

**Files:**
- Modify: `agent-src/generate.mjs` (constants near `KNOWN_PLATFORMS` line 31; injection step inside `renderAll` before the per-unit render loop, ~line 411)
- Test: shell assertions against `/tmp/ado-fixture` generated `.claude/agents/*.md`

**Interfaces:**
- Consumes: `config.ticketing.backend`, each unit's `manifest.platforms.claude.tools`.
- Produces: for `azure-devops`, the three named agents' Claude frontmatter `tools` list additionally contains the six `mcp__ado__wit_*` tools.

- [ ] **Step 1: Write the failing test**

```bash
node agent-src/generate.mjs --root /tmp/ado-fixture generate
grep -q 'mcp__ado__wit_create_work_item' /tmp/ado-fixture/.claude/agents/developer.md && \
grep -q 'mcp__ado__wit_update_work_item' /tmp/ado-fixture/.claude/agents/code-reviewer.md && \
grep -q 'mcp__ado__wit_add_work_item_comment' /tmp/ado-fixture/.claude/agents/qa-engineer.md && \
echo 'ADO TOOLS PASS' || echo 'ADO TOOLS FAIL'
```

Expected: `ADO TOOLS FAIL` (tools not yet injected). (Ensure the org was restored after Task 3 Step 6 so generate succeeds.)

- [ ] **Step 2: Add the constants in `agent-src/generate.mjs`**

After the `KNOWN_PLATFORMS` line (line 31), add:

```js
// Agents that perform ticketing operations and therefore need the azure-devops MCP tools
// added to their Claude allowlist when that backend is selected.
const TICKETING_AGENTS = ['developer', 'code-reviewer', 'qa-engineer'];
const ADO_MCP_TOOLS = [
  'mcp__ado__wit_query_by_wiql',
  'mcp__ado__wit_get_work_item',
  'mcp__ado__wit_list_work_item_comments',
  'mcp__ado__wit_create_work_item',
  'mcp__ado__wit_update_work_item',
  'mcp__ado__wit_add_work_item_comment',
];
```

- [ ] **Step 3: Inject the tools in `renderAll`**

Find the start of the per-unit loop (≈ line 411):

```js
  for (const unit of units) {
    const platforms = unit.manifest.platforms || {};
```

Insert this block immediately **before** that `for` loop:

```js
  // azure-devops backend: give ticketing agents access to the `ado` MCP tools on Claude.
  if (config.ticketing?.backend === 'azure-devops') {
    for (const unit of units) {
      if (unit.kind !== 'agent' || !TICKETING_AGENTS.includes(unit.name)) continue;
      const claude = unit.manifest.platforms?.claude;
      if (!claude || !Array.isArray(claude.tools)) continue;
      for (const tool of ADO_MCP_TOOLS) {
        if (!claude.tools.includes(tool)) claude.tools.push(tool);
      }
    }
  }
```

- [ ] **Step 4: Run the test — expect PASS**

```bash
node agent-src/generate.mjs --root /tmp/ado-fixture generate
grep -q 'mcp__ado__wit_create_work_item' /tmp/ado-fixture/.claude/agents/developer.md && \
grep -q 'mcp__ado__wit_update_work_item' /tmp/ado-fixture/.claude/agents/code-reviewer.md && \
grep -q 'mcp__ado__wit_add_work_item_comment' /tmp/ado-fixture/.claude/agents/qa-engineer.md && \
echo 'ADO TOOLS PASS' || echo 'ADO TOOLS FAIL'
```

Expected: `ADO TOOLS PASS`.

- [ ] **Step 5: Verify other backends are NOT affected**

Run: `node agent-src/generate.mjs generate`
Expected: `Generated N file(s) from agent-src/.` with no error, and the regenerated `.claude/agents/developer.md` (file backend) does NOT contain `mcp__ado__`:

```bash
grep -c 'mcp__ado__' .claude/agents/developer.md
```
Expected: `0`.

- [ ] **Step 6: Commit**

```bash
git add agent-src/generate.mjs
git commit -m "injects ado mcp tools into ticketing agents for azure-devops backend"
```

---

### Task 5: Config scaffolding + documentation

Adds the `ticketing.azureDevOps` block to the scaffold template and the repo's own `ai-project.json` (as documentation of the shape; the repo stays on `file`), and documents the backend + `.mcp.json` ownership in the README.

**Files:**
- Modify: `agent-src/ai-project.template.json`
- Modify: `ai-project.json`
- Modify: `README.md`

**Interfaces:** none (config + docs only).

- [ ] **Step 1: Add the `azureDevOps` block to `agent-src/ai-project.template.json`**

In the `ticketing` object, after the `file` sub-object, add an `azureDevOps` sibling so `init`-scaffolded projects see the shape:

```json
  "ticketing": {
    "backend": "file",
    "itemNoun": "issue",
    "github": {
    },
    "file": {
      "dir": ".tickets/issues",
      "metadataFile": ".tickets/metadata.json"
    },
    "azureDevOps": {
      "organization": "YourAdoOrg",
      "project": "YourAdoProject",
      "featureType": "Issue",
      "bugType": "Issue"
    }
  },
```

- [ ] **Step 2: Mirror the same block into the repo's `ai-project.json`**

Apply the identical `ticketing` object edit to `/home/mx/src/ai-dev-workflow/ai-project.json` (keep `backend: "file"`).

- [ ] **Step 3: Document the backend in `README.md`**

In the "What lands in your repo" table, add a row:

```markdown
| `.mcp.json` | merged (azure-devops backend only) — the `ado` server entry; other servers preserved | yes |
```

And update the `init` step note (step 2 of Quick start) from:

```markdown
# 2. edit ai-project.json — set project identity, repository, and ticketing.backend ("file" | "github")
```

to:

```markdown
# 2. edit ai-project.json — set project identity, repository, and ticketing.backend ("file" | "github" | "azure-devops")
#    For azure-devops, also set ticketing.azureDevOps.organization and .project (the generator
#    merges an `ado` server into .mcp.json; the @azure-devops/mcp server handles its own auth).
```

- [ ] **Step 4: Verify the repo still generates cleanly**

Run: `node agent-src/generate.mjs generate`
Expected: `Generated N file(s) from agent-src/.` with no error (config addition doesn't change `file`-backend output).

- [ ] **Step 5: Verify the azure-devops fixture still generates end-to-end**

```bash
node /tmp/ado-token-check.mjs /home/mx/src/ai-dev-workflow
```

Expected: `TOKEN CHECK PASS`.

- [ ] **Step 6: Commit**

```bash
git add agent-src/ai-project.template.json ai-project.json README.md
git commit -m "documents azure-devops ticketing backend and scaffolds its config"
```

---

## Final Verification (after all tasks)

- [ ] `node agent-src/generate.mjs generate` → `Generated N file(s)` with no error (file backend, this repo).
- [ ] `node /tmp/ado-token-check.mjs /home/mx/src/ai-dev-workflow` → `TOKEN CHECK PASS`.
- [ ] `.mcp.json` merge preserves a pre-existing server (Task 3 Step 4) → `MCP MERGE PASS`.
- [ ] Ticketing agents carry the `ado` tools under azure-devops (Task 4 Step 4) → `ADO TOOLS PASS`.
- [ ] Missing organization fails generation with a clear message (Task 3 Step 6).
- [ ] `rm -rf /tmp/ado-fixture` to clean up the throwaway fixture.

## Spec Coverage Check

- Backend selection via `ticketing.backend` → Tasks 1, 5.
- Tags-authoritative + native-State hybrid (Basic process) → Tasks 1, 2.
- `@azure-devops/mcp` tool-based operations → Task 2 (include) + Task 4 (agent tool access).
- Organization + Project config → Tasks 1, 5.
- `.mcp.json` non-destructive merge, org required → Task 3.
- Configurable work item types (Basic defaults) → Tasks 1, 2, 5.
- Docs / scaffolding → Task 5.
