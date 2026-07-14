# Codex ADO MCP Config Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate project-local Codex MCP configuration for the Azure DevOps `ado` server when `ticketing.backend` is `azure-devops`.

**Architecture:** Keep the existing generic `.mcp.json` merge unchanged, and add a Codex-specific `.codex/config.toml` merge driven by the same Azure DevOps organization setting. The Codex merge preserves unrelated TOML content, replaces any existing generator-owned or plain `[mcp_servers.ado]` table, and appends one managed block for `ado`.

**Tech Stack:** Node.js ES modules, `node:test`, zero third-party dependencies, handwritten TOML emission consistent with existing Codex agent rendering.

## Global Constraints

- Do not add runtime or test dependencies.
- Preserve existing `.mcp.json` behavior.
- Only emit `.codex/config.toml` for `ticketing.backend === "azure-devops"`.
- Fail with `ticketing.azureDevOps.organization is required for the azure-devops backend` when the backend is Azure DevOps and organization is missing.
- Preserve unrelated `.codex/config.toml` content exactly enough that user-owned MCP servers and settings remain present.
- Treat `[mcp_servers.ado]` as generator-owned for Azure DevOps projects, because this workflow owns the ADO ticketing server.
- Keep generated Codex agent files under `.codex/agents/*.toml` unchanged.

---

## File Structure

- Modify `agent-src/lib/ticketing.mjs`: add Codex TOML render/merge helpers next to the existing ADO `.mcp.json` renderer.
- Modify `agent-src/lib/pipeline.mjs`: include the new `.codex/config.toml` output in `renderAll`.
- Modify `agent-src/lib/pipeline.test.mjs`: add in-process tests for Codex ADO output and TOML preservation.
- Modify `agent-src/cli.test.mjs`: extend the Azure DevOps CLI/init coverage to assert `.codex/config.toml`.
- Modify `README.md`: document that Azure DevOps generation now writes both `.mcp.json` and `.codex/config.toml`.
- Modify `agent-src/lib/setup-doc.mjs`: update onboarding setup docs so the generated setup note matches behavior.

### Task 1: Add Codex ADO TOML Renderer

**Files:**
- Modify: `agent-src/lib/ticketing.mjs`
- Test: `agent-src/lib/pipeline.test.mjs`

**Interfaces:**
- Consumes: `config.ticketing.backend`, `config.ticketing.azureDevOps.organization`, `projectRoot`
- Produces: `renderCodexAdoMcpToml(config, projectRoot) -> { path: '.codex/config.toml', content: string } | null`
- Produces: `renderCodexAdoMcpBlock(org) -> string`
- Produces: `mergeCodexAdoMcpBlock(existingContent, org) -> string`

- [ ] **Step 1: Write failing tests for Codex ADO TOML output**

Add this test after `azure-devops backend injects ADO tools into ticketing agents and emits .mcp.json` in `agent-src/lib/pipeline.test.mjs`:

```js
test('azure-devops backend emits Codex project-local ADO MCP config', () => {
  const { root, cleanup } = makeTmpRoot();
  try {
    writeProject(root, {
      project: { name: 'ADO', slug: 'ado', serenaProject: 'ado', description: '' },
      repository: { slug: 'ado', defaultBranch: 'main' },
      ticketing: {
        backend: 'azure-devops', itemNoun: 'work item',
        azureDevOps: {
          organization: 'acme', project: 'widgets', featureType: 'Issue', bugType: 'Issue',
          processTemplate: 'basic', stateMapping: {},
        },
      },
      git: { branchPattern: 'x', prTarget: 'main' },
    });

    const outputs = renderAll(root);
    const codexConfig = outputs.find((o) => o.path === path.join('.codex', 'config.toml'));
    assert.ok(codexConfig, '.codex/config.toml should be produced for azure-devops');
    assert.match(codexConfig.content, /# BEGIN ai-dev-workflow managed mcp_servers\.ado/);
    assert.match(codexConfig.content, /\[mcp_servers\.ado\]/);
    assert.match(codexConfig.content, /command = "npx"/);
    assert.match(codexConfig.content, /args = \["-y", "@azure-devops\/mcp", "acme", "-d", "core", "work", "work-items"\]/);
    assert.match(codexConfig.content, /# END ai-dev-workflow managed mcp_servers\.ado/);
  } finally {
    cleanup();
  }
});
```

- [ ] **Step 2: Write failing tests for preserving existing Codex config**

Add this test after the new output test:

```js
test('azure-devops Codex MCP config preserves unrelated TOML and replaces ado only', () => {
  const { root, cleanup } = makeTmpRoot();
  try {
    writeProject(root, {
      project: { name: 'ADO', slug: 'ado', serenaProject: 'ado', description: '' },
      repository: { slug: 'ado', defaultBranch: 'main' },
      ticketing: {
        backend: 'azure-devops', itemNoun: 'work item',
        azureDevOps: {
          organization: 'new-org', project: 'widgets', featureType: 'Issue', bugType: 'Issue',
          processTemplate: 'basic', stateMapping: {},
        },
      },
      git: { branchPattern: 'x', prTarget: 'main' },
    });

    const codexDir = path.join(root, '.codex');
    fs.mkdirSync(codexDir, { recursive: true });
    fs.writeFileSync(path.join(codexDir, 'config.toml'), [
      'model = "gpt-5-codex"',
      '',
      '[mcp_servers.context7]',
      'url = "https://mcp.context7.com/mcp"',
      '',
      '[mcp_servers.ado]',
      'command = "old-command"',
      'args = ["old-org"]',
      '',
      '[profiles.default]',
      'approval_policy = "on-request"',
      '',
    ].join('\n'));

    const outputs = renderAll(root);
    const codexConfig = outputs.find((o) => o.path === path.join('.codex', 'config.toml'));
    assert.ok(codexConfig);
    assert.match(codexConfig.content, /model = "gpt-5-codex"/);
    assert.match(codexConfig.content, /\[mcp_servers\.context7\]\nurl = "https:\/\/mcp\.context7\.com\/mcp"/);
    assert.match(codexConfig.content, /\[profiles\.default\]\napproval_policy = "on-request"/);
    assert.doesNotMatch(codexConfig.content, /old-command/);
    assert.doesNotMatch(codexConfig.content, /old-org/);
    assert.match(codexConfig.content, /"new-org"/);
  } finally {
    cleanup();
  }
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run:

```bash
node --test agent-src/lib/pipeline.test.mjs
```

Expected: FAIL. The first new test fails because `.codex/config.toml` is not produced.

- [ ] **Step 4: Add Codex TOML helper exports**

In `agent-src/lib/ticketing.mjs`, add `dq` to imports:

```js
import { normalizeLF, dq } from './serialize.mjs';
```

Then add these constants and functions after `renderMcpJson`:

```js
const CODEX_ADO_BEGIN = '# BEGIN ai-dev-workflow managed mcp_servers.ado';
const CODEX_ADO_END = '# END ai-dev-workflow managed mcp_servers.ado';

export function renderCodexAdoMcpBlock(org) {
  return [
    CODEX_ADO_BEGIN,
    '[mcp_servers.ado]',
    'command = "npx"',
    `args = [${['-y', '@azure-devops/mcp', org, '-d', 'core', 'work', 'work-items'].map(dq).join(', ')}]`,
    CODEX_ADO_END,
  ].join('\n');
}

export function mergeCodexAdoMcpBlock(existingContent, org) {
  const lines = normalizeLF(existingContent || '').split('\n');
  const kept = [];
  let skippingManaged = false;
  let skippingAdoTable = false;

  for (const line of lines) {
    if (line.trim() === CODEX_ADO_BEGIN) {
      skippingManaged = true;
      skippingAdoTable = false;
      continue;
    }
    if (skippingManaged) {
      if (line.trim() === CODEX_ADO_END) skippingManaged = false;
      continue;
    }
    if (/^\s*\[mcp_servers\.ado\]\s*(?:#.*)?$/.test(line)) {
      skippingAdoTable = true;
      continue;
    }
    if (skippingAdoTable && /^\s*\[/.test(line)) {
      skippingAdoTable = false;
    }
    if (skippingAdoTable) continue;
    kept.push(line);
  }

  let prefix = kept.join('\n').replace(/\s+$/u, '');
  const block = renderCodexAdoMcpBlock(org);
  if (prefix.length > 0) prefix += '\n\n';
  return `${prefix}${block}\n`;
}

export function renderCodexAdoMcpToml(config, projectRoot) {
  if (config.ticketing?.backend !== 'azure-devops') return null;
  const org = config.ticketing?.azureDevOps?.organization;
  if (!org) {
    throw new Error('ticketing.azureDevOps.organization is required for the azure-devops backend');
  }
  const configPath = path.join(projectRoot, '.codex', 'config.toml');
  const existing = fs.existsSync(configPath) ? fs.readFileSync(configPath, 'utf8') : '';
  return {
    path: path.join('.codex', 'config.toml'),
    content: mergeCodexAdoMcpBlock(existing, org),
  };
}
```

- [ ] **Step 5: Run the focused test and confirm the first test still fails**

Run:

```bash
node --test agent-src/lib/pipeline.test.mjs
```

Expected: FAIL. The helper exists, but the pipeline has not included it yet, so `.codex/config.toml` is still absent from `renderAll`.

### Task 2: Wire Codex ADO Config Into the Render Pipeline

**Files:**
- Modify: `agent-src/lib/pipeline.mjs`
- Test: `agent-src/lib/pipeline.test.mjs`

**Interfaces:**
- Consumes: `renderCodexAdoMcpToml(config, projectRoot)`
- Produces: A unique output path `.codex/config.toml` when backend is Azure DevOps

- [ ] **Step 1: Import the new renderer**

In `agent-src/lib/pipeline.mjs`, replace:

```js
import { renderTicketingInclude, renderMcpJson } from './ticketing.mjs';
```

with:

```js
import { renderTicketingInclude, renderMcpJson, renderCodexAdoMcpToml } from './ticketing.mjs';
```

- [ ] **Step 2: Add the new output after `.mcp.json`**

In `renderAll`, immediately after the existing `.mcp.json` block:

```js
  // The azure-devops backend also owns the Codex project-local `ado` MCP server config.
  const codexAdoMcp = renderCodexAdoMcpToml(config, projectRoot);
  if (codexAdoMcp) {
    if (seenPaths.has(codexAdoMcp.path)) {
      throw new Error(`Duplicate output path declared: ${codexAdoMcp.path}`);
    }
    seenPaths.add(codexAdoMcp.path);
    outputs.push(codexAdoMcp);
  }
```

- [ ] **Step 3: Run the focused pipeline tests**

Run:

```bash
node --test agent-src/lib/pipeline.test.mjs
```

Expected: PASS. The new tests should pass, and existing pipeline tests should remain green.

- [ ] **Step 4: Commit the renderer and pipeline changes**

Run:

```bash
git add agent-src/lib/ticketing.mjs agent-src/lib/pipeline.mjs agent-src/lib/pipeline.test.mjs
git commit -m "feat: generate Codex ADO MCP config"
```

Expected: commit succeeds with only these three files staged.

### Task 3: Add CLI Regression Coverage

**Files:**
- Modify: `agent-src/cli.test.mjs`

**Interfaces:**
- Consumes: CLI `generate --root <dir>`
- Produces: End-to-end assertion that generated files include `.mcp.json` and `.codex/config.toml`

- [ ] **Step 1: Locate the Azure DevOps CLI test**

Open `agent-src/cli.test.mjs` and find the test named:

```js
test('init --answers scaffolds an azure-devops project, and a follow-up generate emits .mcp.json', () => {
```

- [ ] **Step 2: Rename the test**

Change the test name to:

```js
test('init --answers scaffolds an azure-devops project, and generate emits MCP config for shared and Codex consumers', () => {
```

- [ ] **Step 3: Add Codex config assertions**

After the existing `.mcp.json` assertions in that test, add:

```js
    const codexConfig = fs.readFileSync(path.join(root, '.codex', 'config.toml'), 'utf8');
    assert.match(codexConfig, /\[mcp_servers\.ado\]/);
    assert.match(codexConfig, /command = "npx"/);
    assert.match(codexConfig, /@azure-devops\/mcp/);
    assert.match(codexConfig, /"acme"/);
```

- [ ] **Step 4: Run CLI tests**

Run:

```bash
node --test agent-src/cli.test.mjs
```

Expected: PASS. The Azure DevOps CLI flow now proves both generated MCP surfaces exist.

- [ ] **Step 5: Commit CLI coverage**

Run:

```bash
git add agent-src/cli.test.mjs
git commit -m "test: cover Codex ADO MCP generation in CLI flow"
```

Expected: commit succeeds with only `agent-src/cli.test.mjs` staged.

### Task 4: Update User-Facing Documentation

**Files:**
- Modify: `README.md`
- Modify: `agent-src/lib/setup-doc.mjs`
- Test: `agent-src/generate.test.mjs`

**Interfaces:**
- Consumes: existing docs and setup document generation
- Produces: docs that explain `.mcp.json` plus `.codex/config.toml` for Azure DevOps

- [ ] **Step 1: Update README ownership table**

In `README.md`, replace the `.mcp.json` table row:

```md
| `.mcp.json` | merged (azure-devops backend only) — the `ado` server entry; other servers preserved | yes |
```

with:

```md
| `.mcp.json` | merged (azure-devops backend only) — the shared `ado` server entry; other servers preserved | yes |
| `.codex/config.toml` | merged (azure-devops backend only) — the Codex project-local `ado` MCP server entry; other Codex settings preserved | yes |
```

- [ ] **Step 2: Update README quick start note**

In `README.md`, replace:

```md
#    the state mapping; generate then merges the `ado` server into .mcp.json.
```

with:

```md
#    the state mapping; generate then merges the `ado` server into .mcp.json
#    and .codex/config.toml.
```

- [ ] **Step 3: Update setup doc Azure section**

In `agent-src/lib/setup-doc.mjs`, replace the Azure DevOps note array entries:

```js
      'For the `azure-devops` ticketing backend, `ai-dev-workflow generate` automatically merges an',
      '`ado` server entry into `.mcp.json` (the `@azure-devops/mcp` server handles its own auth).',
      'Nothing to install by hand — just run `generate` and reload your MCP servers.',
```

with:

```js
      'For the `azure-devops` ticketing backend, `ai-dev-workflow generate` automatically merges an',
      '`ado` server entry into `.mcp.json` and the Codex project-local `.codex/config.toml`',
      '(`@azure-devops/mcp` handles its own auth).',
      'Nothing to install by hand — just run `generate` and reload your MCP servers.',
```

- [ ] **Step 4: Update setup doc test expectation**

In `agent-src/generate.test.mjs`, find the test named:

```js
test('renderSetupDoc includes the ado section for azure-devops', () => {
```

Inside it, keep the existing `.mcp.json` assertion and add:

```js
  assert.match(renderSetupDoc(cfg), /\.codex\/config\.toml/);
```

- [ ] **Step 5: Run docs-related tests**

Run:

```bash
node --test agent-src/generate.test.mjs
```

Expected: PASS. The generated setup doc mentions Codex’s project-local MCP config for Azure DevOps.

- [ ] **Step 6: Commit documentation changes**

Run:

```bash
git add README.md agent-src/lib/setup-doc.mjs agent-src/generate.test.mjs
git commit -m "docs: document Codex ADO MCP config generation"
```

Expected: commit succeeds with only these three files staged.

### Task 5: Full Verification

**Files:**
- No source edits
- Verifies all changed behavior

**Interfaces:**
- Consumes: all prior tasks
- Produces: passing repository test suite and a manual generated-output sanity check

- [ ] **Step 1: Run the full Node test suite**

Run:

```bash
npm test
```

Expected: PASS. All `node:test` suites pass.

- [ ] **Step 2: Run generator check in this repository**

Run:

```bash
node agent-src/generate.mjs check
```

Expected: The result reflects the current repository’s own generated-output state. If it fails because generated files are stale, inspect the listed paths; do not treat `.codex/config.toml` absence as a failure here unless this repository’s own `ai-project.json` uses `azure-devops`.

- [ ] **Step 3: Manually verify Azure DevOps output in a temp fixture**

Create a temporary project root with this `ai-project.json`:

```json
{
  "project": {
    "name": "ADO Demo",
    "slug": "ado-demo",
    "serenaProject": "ado-demo",
    "description": ""
  },
  "repository": {
    "slug": "ado-demo",
    "defaultBranch": "main"
  },
  "ticketing": {
    "backend": "azure-devops",
    "itemNoun": "work item",
    "azureDevOps": {
      "organization": "acme",
      "project": "widgets",
      "featureType": "Issue",
      "bugType": "Issue",
      "processTemplate": "basic",
      "stateMapping": {}
    }
  },
  "git": {
    "branchPattern": "feat/<issue-number>_<slug>",
    "prTarget": "main"
  }
}
```

Run:

```bash
node agent-src/generate.mjs --root <temp-project-root> generate
```

Expected:

```text
Generated N file(s) from agent-src/.
```

Then inspect `<temp-project-root>/.codex/config.toml`. Expected content includes:

```toml
# BEGIN ai-dev-workflow managed mcp_servers.ado
[mcp_servers.ado]
command = "npx"
args = ["-y", "@azure-devops/mcp", "acme", "-d", "core", "work", "work-items"]
# END ai-dev-workflow managed mcp_servers.ado
```

- [ ] **Step 4: Inspect final diff**

Run:

```bash
git diff --stat HEAD~3..HEAD
```

Expected: The diff only covers generator code, tests, and docs related to Codex ADO MCP generation.

## Self-Review

- Spec coverage: The plan adds Codex-specific ADO MCP generation, preserves existing `.mcp.json`, tests the render pipeline, tests the CLI flow, and updates docs.
- Placeholder scan: The plan contains no deferred implementation placeholders.
- Type consistency: The new functions are named consistently across `ticketing.mjs` and `pipeline.mjs`: `renderCodexAdoMcpToml`, `mergeCodexAdoMcpBlock`, and `renderCodexAdoMcpBlock`.

