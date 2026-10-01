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
  assert.deepEqual(basic.stateMapping, { 'new': 'To Do', 'in-progress': 'Doing', 'review': 'Doing' });
  const scrum = azureMapping('scrum');
  assert.equal(scrum.featureType, 'Product Backlog Item');
  assert.equal(scrum.bugType, 'Bug');
  assert.equal(scrum.stateMapping['new'], 'New');
  assert.deepEqual(scrum.stateMapping, { 'new': 'New', 'in-progress': 'Committed', 'review': 'Committed' });
});

test('azureMapping throws on unknown template', () => {
  assert.throws(() => azureMapping('agile'), /unknown Azure process template/);
});

import { buildProjectConfig } from './generate.mjs';

test('buildProjectConfig (file backend) omits azureDevOps', () => {
  const cfg = buildProjectConfig({
    name: 'Demo',
    repoSlug: 'me/demo', backend: 'file',
    prTarget: 'main',
    file: { dir: '.tickets/issues', metadataFile: '.tickets/metadata.json' },
  });
  assert.equal(cfg.project.name, 'Demo');
  assert.equal(cfg.ticketing.backend, 'file');
  assert.equal(cfg.ticketing.file.dir, '.tickets/issues');
  assert.ok(!('azureDevOps' in cfg.ticketing));
});

test('buildProjectConfig (azure scrum) fills types + stateMapping', () => {
  const cfg = buildProjectConfig({
    name: 'Demo',
    repoSlug: 'demo', backend: 'azure-devops',
    prTarget: 'main',
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

test('buildProjectConfig (github backend) omits both file and azureDevOps', () => {
  const cfg = buildProjectConfig({
    name: 'Demo',
    repoSlug: 'me/demo', backend: 'github',
    prTarget: 'main',
  });
  assert.equal(cfg.ticketing.backend, 'github');
  assert.ok(!('file' in cfg.ticketing));
  assert.ok(!('azureDevOps' in cfg.ticketing));
});

test('buildProjectConfig writes only the PR target under git — naming is fixed, not configurable', () => {
  const cfg = buildProjectConfig({
    name: 'Demo',
    repoSlug: 'me/demo', backend: 'github', prTarget: 'main',
  });
  assert.deepEqual(cfg.git, { prTarget: 'main' });
});

test('buildProjectConfig writes only the project name and repository slug as identity', () => {
  const cfg = buildProjectConfig({ name: 'Demo', repoSlug: 'me/demo', backend: 'github', prTarget: 'main' });
  assert.deepEqual(cfg.project, { name: 'Demo' });
  assert.deepEqual(cfg.repository, { slug: 'me/demo' });
});

test('buildGlobalTokens ignores the legacy project slug/serena/description and default branch', () => {
  const tokens = buildGlobalTokens({
    project: { name: 'Demo', slug: 'demo', serenaProject: 'demo', description: 'x' },
    repository: { slug: 'me/demo', defaultBranch: 'main' },
    workflow: WORKFLOW,
  });
  for (const key of ['project.slug', 'project.serena', 'project.description', 'repo.defaultBranch']) {
    assert.ok(!(key in tokens), `${key} is no longer a token`);
  }
  assert.equal(tokens['project.name'], 'Demo');
  assert.equal(tokens['repo.slug'], 'me/demo');
});

test('buildGlobalTokens ignores a legacy git.branchPattern', () => {
  const tokens = buildGlobalTokens({ git: { branchPattern: 'feat/<issue-number>_<slug>', prTarget: 'main' }, workflow: WORKFLOW });
  assert.ok(!('git.branchPattern' in tokens), 'the branch name is derived from the ticket, not a project pattern');
  assert.equal(tokens['git.prTarget'], 'main');
});

test('buildProjectConfig writes no e2e block', () => {
  const base = {
    name: 'Demo',
    repoSlug: 'me/demo', backend: 'file',
    prTarget: 'main', file: { dir: 'd', metadataFile: 'm' },
  };
  assert.ok(!('e2e' in buildProjectConfig(base)), 'no e2e block — e2e setup lives in AGENTS.md prose');
});

test('buildGlobalTokens sets cost.include and the summary artifact tokens', () => {
  const costCfg = {
    cost: { includePath: '.agents/includes/cost.md' },
    workflow: {
      states: WORKFLOW.states,
      artifacts: { ...WORKFLOW.artifacts, implementationSummary: 'Implementation Summary', costSummary: 'Cost Summary' },
    },
  };
  const tokens = buildGlobalTokens(costCfg);
  assert.equal(tokens['cost.include'], '.agents/includes/cost.md');
  assert.equal(tokens['artifact.implementationSummary'], 'Implementation Summary');
  assert.equal(tokens['artifact.costSummary'], 'Cost Summary');
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

test('buildProjectConfig (gitea backend) records the tea login and omits file + azureDevOps', () => {
  const cfg = buildProjectConfig({
    name: 'Demo',
    repoSlug: 'me/demo', backend: 'gitea',
    prTarget: 'main',
    gitea: { login: 'myserver' },
  });
  assert.equal(cfg.ticketing.backend, 'gitea');
  assert.equal(cfg.ticketing.gitea.login, 'myserver');
  assert.ok(!('file' in cfg.ticketing));
  assert.ok(!('azureDevOps' in cfg.ticketing));
});

test('buildGlobalTokens exposes the gitea login and renders statuses as labels', () => {
  const tokens = buildGlobalTokens({
    ticketing: { backend: 'gitea', gitea: { login: 'myserver' } },
    workflow: WORKFLOW,
  });
  assert.equal(tokens['ticketing.backend'], 'gitea');
  assert.equal(tokens['ticketing.gitea.login'], 'myserver');
  assert.equal(tokens['status.new'], 'status:new');
  assert.equal(tokens['status.in-progress'], 'status:in-progress');
});
