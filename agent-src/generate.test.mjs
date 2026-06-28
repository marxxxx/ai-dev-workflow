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
