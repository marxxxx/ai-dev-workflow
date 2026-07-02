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
        backend: 'azure-devops', itemNoun: 'issue',
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

test('renderAll throws when azure-devops lacks an organization', () => {
  const { root, cleanup } = makeTmpRoot();
  try {
    writeProject(root, {
      project: { name: 'ADO', slug: 'ado', serenaProject: 'ado', description: '' },
      repository: { slug: 'ado', defaultBranch: 'main' },
      ticketing: { backend: 'azure-devops', itemNoun: 'issue', azureDevOps: { project: 'widgets' } },
      git: { branchPattern: 'x', prTarget: 'main' },
    });
    assert.throws(() => renderAll(root), /organization is required/);
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
