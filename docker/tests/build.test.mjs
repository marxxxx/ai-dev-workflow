import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPlan, defaultTag } from '../build.mjs';

const dockerDir = fileURLToPath(new URL('..', import.meta.url));

test('builds the base first and derives variants from the same versioned base', () => {
  const plan = buildPlan({ tag: '2026.09.11', revision: 'abc123' });
  assert.deepEqual(plan.map(step => step.image), ['ai-dev-workflow', 'ai-dev-workflow-node', 'ai-dev-workflow-dotnet']);
  const [base, node, dotnet] = plan.map(step => step.args);
  assert.deepEqual(base.slice(0, 3), ['build', '-f', path.join(dockerDir, 'Dockerfile')]);
  assert.equal(base.at(-1), dockerDir);
  for (const expected of ['ai-dev-workflow:2026.09.11', 'ai-dev-workflow:latest',
    'org.opencontainers.image.version=2026.09.11', 'org.opencontainers.image.revision=abc123']) {
    assert.ok(base.includes(expected), `base build is missing ${expected}`);
  }
  assert.ok(!base.includes('--build-arg'));
  for (const args of [node, dotnet]) {
    assert.equal(args[args.indexOf('--build-arg') + 1], 'BASE_IMAGE=ai-dev-workflow:2026.09.11');
  }
  assert.ok(node.includes('ai-dev-workflow-node:2026.09.11') && node.includes('ai-dev-workflow-node:latest'));
  assert.ok(plan.every(step => !step.args.includes('--no-cache')));
});

test('passes --no-cache to every build when requested', () => {
  const plan = buildPlan({ tag: 't', revision: 'r', noCache: true });
  assert.ok(plan.every(step => step.args.includes('--no-cache')));
});

test('rejects tags Docker would not accept', () => {
  for (const tag of ['', 'bad tag', '-leading', 'x'.repeat(129)]) {
    assert.throws(() => buildPlan({ tag, revision: 'r' }), /tag/);
  }
});

test('defaults the tag to the local build date', () => {
  assert.equal(defaultTag(new Date(2026, 8, 1, 23, 30)), '2026.09.01');
});

test('variant Dockerfiles take their base image as a build argument', () => {
  for (const file of ['Dockerfile.node', 'Dockerfile.dotnet']) {
    const text = readFileSync(path.join(dockerDir, file), 'utf8');
    assert.match(text, /^ARG BASE_IMAGE=ai-dev-workflow\nFROM \$\{BASE_IMAGE\}$/m, file);
  }
});
