// In-process tests for the render pipeline and config merge — importing the functions directly
// (fast, and they assert internal invariants the CLI can't easily observe).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { renderAll, loadConfig } from '../generate.mjs';
import { makeTmpRoot, tmpProject } from '../test-helpers.mjs';

function writeProject(root, config) {
  fs.writeFileSync(path.join(root, 'ai-project.json'), JSON.stringify(config, null, 2) + '\n');
}

test('renderAll produces a set of unique output paths (file backend)', () => {
  const { root, cleanup } = tmpProject();
  try {
    const outputs = renderAll(root);
    assert.ok(outputs.length > 0);
    const paths = outputs.map((o) => o.path);
    assert.equal(paths.length, new Set(paths).size, 'output paths must be unique');
    // The ticketing include path is a config string (forward slashes), not a path.join result.
    assert.ok(paths.includes('.agents/includes/ticketing.md'));
  } finally {
    cleanup();
  }
});

test('azure-devops backend injects ADO tools into ticketing agents and emits .mcp.json', () => {
  const { root, cleanup } = makeTmpRoot();
  try {
    writeProject(root, {
      project: { name: 'ADO', slug: 'ado', serenaProject: 'ado', description: '' },
      repository: { slug: 'ado', defaultBranch: 'main' },
      ticketing: {
        backend: 'azure-devops',
        azureDevOps: {
          organization: 'acme', project: 'widgets', featureType: 'Issue', bugType: 'Issue',
          processTemplate: 'basic', stateMapping: {},
        },
      },
      git: { branchPattern: 'x', prTarget: 'main' },
    });
    const outputs = renderAll(root);
    const mcp = outputs.find((o) => o.path === '.mcp.json');
    assert.ok(mcp, '.mcp.json should be produced for azure-devops');
    assert.match(mcp.content, /@azure-devops\/mcp/);

    const developer = outputs.find((o) => o.path === path.join('.claude', 'agents', 'developer.md'));
    assert.ok(developer, 'developer agent should be rendered');
    assert.match(developer.content, /mcp__ado__wit_query_by_wiql/, 'ADO MCP tool should be added to the allowlist');
  } finally {
    cleanup();
  }
});

test('azure-devops backend emits Codex project-local ADO MCP config', () => {
  const { root, cleanup } = makeTmpRoot();
  try {
    writeProject(root, {
      project: { name: 'ADO', slug: 'ado', serenaProject: 'ado', description: '' },
      repository: { slug: 'ado', defaultBranch: 'main' },
      ticketing: {
        backend: 'azure-devops',
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

test('azure-devops Codex MCP config preserves unrelated TOML and replaces ado only', () => {
  const { root, cleanup } = makeTmpRoot();
  try {
    writeProject(root, {
      project: { name: 'ADO', slug: 'ado', serenaProject: 'ado', description: '' },
      repository: { slug: 'ado', defaultBranch: 'main' },
      ticketing: {
        backend: 'azure-devops',
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

test('renderAll throws when azure-devops lacks an organization', () => {
  const { root, cleanup } = makeTmpRoot();
  try {
    writeProject(root, {
      project: { name: 'ADO', slug: 'ado', serenaProject: 'ado', description: '' },
      repository: { slug: 'ado', defaultBranch: 'main' },
      ticketing: { backend: 'azure-devops', azureDevOps: { project: 'widgets' } },
      git: { branchPattern: 'x', prTarget: 'main' },
    });
    assert.throws(() => renderAll(root), /organization is required/);
  } finally {
    cleanup();
  }
});

test('renderAll emits the single AGENTS-driven e2e include and the qa-engineer points at it', () => {
  const { root, cleanup } = tmpProject();
  try {
    const outputs = renderAll(root);
    const e2e = outputs.find((o) => o.path === '.agents/includes/e2e-runtime.md');
    assert.ok(e2e, 'e2e-runtime include should always be produced');
    assert.match(e2e.content, /AGENTS\.md/, 'include points the agent at AGENTS.md');
    assert.match(e2e.content, /NEEDS HUMAN REVIEW/);
    assert.doesNotMatch(e2e.content, /scripts\/e2e-up|scripts\/e2e-down/, 'no start/stop scripts');
    assert.doesNotMatch(e2e.content, /\{\{.*?\}\}/, 'include must fully resolve');
    // The qa-engineer body points at the include and must resolve on every platform.
    const qa = outputs.find((o) => o.path === path.join('.claude', 'agents', 'qa-engineer.md'));
    assert.match(qa.content, /\.agents\/includes\/e2e-runtime\.md/);
    assert.doesNotMatch(qa.content, /\{\{.*?\}\}/);
  } finally {
    cleanup();
  }
});

test('renderAll emits the cost include and dev-cycle points at it', () => {
  const { root, cleanup } = tmpProject();
  try {
    const outputs = renderAll(root);
    const cost = outputs.find((o) => o.path === '.agents/includes/cost.md');
    assert.ok(cost, 'cost include should always be produced');
    assert.match(cost.content, /ccusage/, 'cost include invokes ccusage');
    assert.match(cost.content, /Cost Summary/, 'cost include names the summary artifact');
    assert.doesNotMatch(cost.content, /\{\{.*?\}\}/, 'include must fully resolve');
    // The dev-cycle orchestrator points at the cost include and must resolve on every platform.
    const devcycle = outputs.find((o) => o.path === path.join('.claude', 'skills', 'dev-cycle', 'SKILL.md'));
    assert.match(devcycle.content, /\.agents\/includes\/cost\.md/);
    assert.doesNotMatch(devcycle.content, /\{\{.*?\}\}/);
  } finally {
    cleanup();
  }
});

test('loadConfig merges package workflow + includePath over the project file', () => {
  const { root, cleanup } = tmpProject();
  try {
    const cfg = loadConfig(root);
    // project-owned
    assert.equal(cfg.ticketing.backend, 'file');
    assert.equal(cfg.project.slug, 'test-project');
    // package-owned (from agent-src/config/ai-workflow.json)
    assert.ok(cfg.workflow, 'workflow states/artifacts come from the package');
    assert.equal(cfg.ticketing.includePath, '.agents/includes/ticketing.md');
    assert.equal(cfg.app.includePath, '.agents/includes/e2e-runtime.md');
    assert.equal(cfg.cost.includePath, '.agents/includes/cost.md');
  } finally {
    cleanup();
  }
});

test('loadConfig returns package-only config when ai-project.json is absent', () => {
  const { root, cleanup } = makeTmpRoot();
  try {
    const cfg = loadConfig(root);
    assert.ok(cfg.workflow);
    assert.equal(cfg.ticketing.includePath, '.agents/includes/ticketing.md');
    assert.ok(!cfg.project, 'no project identity without ai-project.json');
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// Project-level customization via agent-custom/{agents,skills}/<name>/.
// ---------------------------------------------------------------------------

/** Write a file under agent-custom/<rel>, creating parent dirs. */
function writeCustom(root, rel, content) {
  const abs = path.join(root, 'agent-custom', rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

const DEVELOPER = path.join('.claude', 'agents', 'developer.md');

test('agent-custom append.md is appended after the package body with tokens resolved', () => {
  const { root, cleanup } = tmpProject();
  try {
    writeCustom(root, 'agents/developer/append.md', '## House rules\nAlways lint for {{project.name}}.\n');
    const dev = renderAll(root).find((o) => o.path === DEVELOPER);
    // Package prose still present…
    assert.match(dev.content, /Own implementation only\./);
    // …and the fragment is appended, with {{project.name}} resolved from MINIMAL_PROJECT.
    assert.match(dev.content, /## House rules\nAlways lint for Test Project\./);
    assert.doesNotMatch(dev.content, /\{\{.*?\}\}/);
    // Banner now points at both sources.
    assert.match(dev.content, /agent-src\/agents\/developer \+ agent-custom\/agents\/developer/);
  } finally {
    cleanup();
  }
});

test('agent-custom body.md fully overrides the package body', () => {
  const { root, cleanup } = tmpProject();
  try {
    writeCustom(root, 'agents/developer/body.md', 'Custom developer for {{project.name}} only.\n');
    const dev = renderAll(root).find((o) => o.path === DEVELOPER);
    assert.match(dev.content, /Custom developer for Test Project only\./);
    assert.doesNotMatch(dev.content, /Own implementation only\./, 'package body must be gone');
    assert.doesNotMatch(dev.content, /\{\{.*?\}\}/);
  } finally {
    cleanup();
  }
});

test('agent-custom override and append combine (override is the base, append follows)', () => {
  const { root, cleanup } = tmpProject();
  try {
    writeCustom(root, 'agents/developer/body.md', 'BASE override.\n');
    writeCustom(root, 'agents/developer/append.md', 'EXTRA appended.\n');
    const dev = renderAll(root).find((o) => o.path === DEVELOPER);
    // A blank-line separator sits between base and fragment (same as the overlay append).
    assert.match(dev.content, /BASE override\.\n\nEXTRA appended\./);
    assert.doesNotMatch(dev.content, /Own implementation only\./);
  } finally {
    cleanup();
  }
});

test('an unresolved token in an agent-custom file throws through the pipeline guard', () => {
  const { root, cleanup } = tmpProject();
  try {
    writeCustom(root, 'agents/developer/append.md', 'Uses {{nope}}.\n');
    assert.throws(() => renderAll(root), /no matching token/);
  } finally {
    cleanup();
  }
});

test('no agent-custom dir is a no-op: output identical to package-only render', () => {
  const a = tmpProject();
  const b = tmpProject();
  try {
    const bare = renderAll(a.root).find((o) => o.path === DEVELOPER).content;
    writeCustom(b.root, 'agents/developer/append.md', 'x\n');
    fs.rmSync(path.join(b.root, 'agent-custom'), { recursive: true, force: true });
    const removed = renderAll(b.root).find((o) => o.path === DEVELOPER).content;
    assert.equal(removed, bare, 'removing agent-custom returns to package defaults');
    assert.doesNotMatch(bare, /agent-custom/);
  } finally {
    a.cleanup();
    b.cleanup();
  }
});
