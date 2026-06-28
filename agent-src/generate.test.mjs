import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildGlobalTokens } from './generate.mjs';

const WORKFLOW = {
  states: [
    { id: 'new', label: 'status:new', frontmatter: 'new', azureState: 'To Do' },
    { id: 'in-progress', label: 'status:in-progress', frontmatter: 'in-progress', azureState: 'Doing' },
  ],
  artifacts: {},
};

test('azureState falls back to package default when no stateMapping', () => {
  const tokens = buildGlobalTokens({ ticketing: { backend: 'azure-devops' }, workflow: WORKFLOW });
  assert.equal(tokens['azureState.new'], 'To Do');
  assert.equal(tokens['azureState.in-progress'], 'Doing');
});

test('per-project stateMapping overrides the package default', () => {
  const tokens = buildGlobalTokens({
    ticketing: { backend: 'azure-devops', azureDevOps: { stateMapping: { new: 'New', 'in-progress': 'Committed' } } },
    workflow: WORKFLOW,
  });
  assert.equal(tokens['azureState.new'], 'New');
  assert.equal(tokens['azureState.in-progress'], 'Committed');
});

import { kebabCase, parseOriginSlug, azureMapping } from './generate.mjs';

test('kebabCase normalizes names', () => {
  assert.equal(kebabCase('My Cool Project'), 'my-cool-project');
  assert.equal(kebabCase('  Edge--Case_42!! '), 'edge-case-42');
});

test('parseOriginSlug handles github ssh, github https, and azure', () => {
  const ssh = '[remote "origin"]\n\turl = git@github.com:marxxxx/ai-dev-workflow.git\n';
  assert.equal(parseOriginSlug(ssh), 'marxxxx/ai-dev-workflow');
  const https = '[remote "origin"]\n\turl = https://github.com/marxxxx/ai-dev-workflow.git\n';
  assert.equal(parseOriginSlug(https), 'marxxxx/ai-dev-workflow');
  const ado = '[remote "origin"]\n\turl = https://dev.azure.com/myorg/myproj/_git/myrepo\n';
  assert.equal(parseOriginSlug(ado), 'myrepo');
});

test('parseOriginSlug returns empty when no origin url', () => {
  assert.equal(parseOriginSlug('[core]\n\tbare = false\n'), '');
  assert.equal(parseOriginSlug(''), '');
});

test('azureMapping returns the basic and scrum tables', () => {
  const basic = azureMapping('basic');
  assert.equal(basic.featureType, 'Issue');
  assert.equal(basic.bugType, 'Issue');
  assert.equal(basic.stateMapping['new'], 'To Do');
  assert.equal(basic.stateMapping['acceptance-test'], 'Doing');
  const scrum = azureMapping('scrum');
  assert.equal(scrum.featureType, 'Product Backlog Item');
  assert.equal(scrum.bugType, 'Bug');
  assert.equal(scrum.stateMapping['new'], 'New');
  assert.equal(scrum.stateMapping['in-progress'], 'Committed');
});

test('azureMapping throws on unknown template', () => {
  assert.throws(() => azureMapping('agile'), /unknown Azure process template/);
});

import { buildProjectConfig, renderSetupDoc } from './generate.mjs';

test('buildProjectConfig (file backend) omits azureDevOps', () => {
  const cfg = buildProjectConfig({
    name: 'Demo', slug: 'demo', serena: 'demo', description: 'A demo',
    repoSlug: 'me/demo', defaultBranch: 'main', backend: 'file', itemNoun: 'issue',
    branchPattern: 'feat/<issue-number>_<slug>', prTarget: 'main',
    file: { dir: '.tickets/issues', metadataFile: '.tickets/metadata.json' },
  });
  assert.equal(cfg.project.name, 'Demo');
  assert.equal(cfg.ticketing.backend, 'file');
  assert.equal(cfg.ticketing.file.dir, '.tickets/issues');
  assert.ok(!('azureDevOps' in cfg.ticketing));
});

test('buildProjectConfig (azure scrum) fills types + stateMapping', () => {
  const cfg = buildProjectConfig({
    name: 'Demo', slug: 'demo', serena: 'demo', description: '',
    repoSlug: 'demo', defaultBranch: 'main', backend: 'azure-devops', itemNoun: 'issue',
    branchPattern: 'feat/<issue-number>_<slug>', prTarget: 'main',
    azure: { organization: 'myorg', project: 'myproj', processTemplate: 'scrum' },
  });
  const a = cfg.ticketing.azureDevOps;
  assert.equal(a.organization, 'myorg');
  assert.equal(a.project, 'myproj');
  assert.equal(a.featureType, 'Product Backlog Item');
  assert.equal(a.bugType, 'Bug');
  assert.equal(a.processTemplate, 'scrum');
  assert.equal(a.stateMapping['in-progress'], 'Committed');
  assert.ok(!('file' in cfg.ticketing));
});

test('renderSetupDoc lists the three plugins and the banner', () => {
  const cfg = buildProjectConfig({
    name: 'Demo', slug: 'demo', serena: 'demo', description: '',
    repoSlug: 'me/demo', defaultBranch: 'main', backend: 'file', itemNoun: 'issue',
    branchPattern: 'x', prTarget: 'main', file: { dir: 'd', metadataFile: 'm' },
  });
  const doc = renderSetupDoc(cfg);
  assert.match(doc, /DO NOT EDIT/);
  assert.match(doc, /superpowers@claude-plugins-official/);
  assert.match(doc, /ctx7 setup/);
  assert.match(doc, /serena start-mcp-server/);
  assert.doesNotMatch(doc, /ado.*MCP server/i); // no azure section for file backend
});

test('renderSetupDoc includes the ado section for azure-devops', () => {
  const cfg = buildProjectConfig({
    name: 'Demo', slug: 'demo', serena: 'demo', description: '',
    repoSlug: 'demo', defaultBranch: 'main', backend: 'azure-devops', itemNoun: 'issue',
    branchPattern: 'x', prTarget: 'main',
    azure: { organization: 'myorg', project: 'myproj', processTemplate: 'basic' },
  });
  assert.match(renderSetupDoc(cfg), /\.mcp\.json/);
});

import { cmdScaffold } from './generate.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('cmdScaffold copies the template into an empty project root', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'adw-'));
  const code = cmdScaffold(root);
  assert.equal(code, 0);
  const written = JSON.parse(fs.readFileSync(path.join(root, 'ai-project.json'), 'utf8'));
  assert.ok(written.project);
  fs.rmSync(root, { recursive: true, force: true });
});

test('cmdScaffold leaves an existing ai-project.json untouched', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'adw-'));
  fs.writeFileSync(path.join(root, 'ai-project.json'), '{"keep":true}');
  cmdScaffold(root);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, 'ai-project.json'), 'utf8')), { keep: true });
  fs.rmSync(root, { recursive: true, force: true });
});
