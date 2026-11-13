import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { RENDERERS } from './renderers.mjs';

test('OpenCode 2 agent: .opencode/agents/<name>.md with description, mode, model; no temperature', () => {
  const unit = {
    name: 'reviewer',
    manifest: {
      name: 'reviewer',
      description: 'Reviews code',
      platforms: { opencode: { mode: 'subagent', model: 'anthropic/claude-sonnet-5-5#high', temperature: 0.1 } },
    },
  };
  const [out] = RENDERERS.agent.opencode(unit, 'Body\n');
  assert.equal(out.path, path.join('.opencode', 'agents', 'reviewer.md'));
  assert.match(out.content, /^mode: subagent$/m);
  assert.match(out.content, /^model: anthropic\/claude-sonnet-5-5#high$/m);
  assert.doesNotMatch(out.content, /temperature/);
});
