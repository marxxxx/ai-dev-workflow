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
