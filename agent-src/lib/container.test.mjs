// Container setup written by `init`: stack detection, Compose slug, template rendering, the
// write-once file I/O and the next-steps printout.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { STACKS, detectStack, composeSlug, renderContainerFiles } from './container.mjs';
import { makeTmpRoot } from '../test-helpers.mjs';

const IMAGES = {
  node: 'marxx/ai-dev-workflow:node-latest',
  dotnet: 'marxx/ai-dev-workflow:dotnet-latest',
  generic: 'marxx/ai-dev-workflow:latest',
};

const fileOf = (files, p) => files.find((f) => f.path === p);

test('detectStack: package.json → node, *.csproj/*.sln/*.slnx → dotnet, both → dotnet, neither → generic', () => {
  const cases = [
    [['package.json'], 'node'],
    [['App.csproj'], 'dotnet'],
    [['App.sln'], 'dotnet'],
    [['App.slnx'], 'dotnet'],
    [['package.json', 'App.sln'], 'dotnet'],
    [['README.md'], 'generic'],
  ];
  for (const [entries, expected] of cases) {
    const { root, cleanup } = makeTmpRoot();
    try {
      for (const e of entries) fs.writeFileSync(path.join(root, e), '');
      assert.equal(detectStack(root), expected, entries.join(','));
    } finally {
      cleanup();
    }
  }
});

test('composeSlug lowercases and dashes runs of invalid chars', () => {
  assert.equal(composeSlug('My Cool_App 2'), 'my-cool_app-2');
  assert.equal(composeSlug('  --Foo..Bar--  '), 'foo-bar');
  assert.equal(composeSlug('!!!'), 'project');
  assert.equal(composeSlug('Ünïcode'), 'n-code');
});

for (const stack of STACKS) {
  test(`renderContainerFiles(${stack}) sets name, image and the node volume only for node`, () => {
    const compose = fileOf(renderContainerFiles({ name: 'Demo', stack, backend: 'file' }), 'compose.ai-dev.yml').content;
    assert.match(compose, /^name: demo-ai$/m);
    assert.ok(compose.includes(`\${AGENT_IMAGE:-${IMAGES[stack]}}`), 'image default');
    assert.equal(compose.includes('target: /workspace/node_modules'), stack === 'node');
    assert.equal(/^ {2}deps-node-modules:$/m.test(compose), stack === 'node');
    assert.doesNotMatch(compose, /^[ \t]+$/m, 'a removed placeholder left a whitespace-only line');
  });
}

for (const backend of ['file', 'github', 'gitea', 'azure-devops']) {
  test(`AI-DEV.md for ${backend} carries only that backend's login`, () => {
    const files = renderContainerFiles({ name: 'Demo', stack: 'generic', backend, giteaLogin: 'myserver' });
    const doc = fileOf(files, 'AI-DEV.md').content;
    assert.equal(doc.includes('gh auth setup-git'), backend === 'github');
    assert.equal(doc.includes('tea login add'), backend === 'gitea');
    assert.equal(doc.includes('myserver'), backend === 'gitea');
    assert.equal(doc.includes('az login --use-device-code'), backend === 'azure-devops');
    assert.ok(doc.includes('git ls-remote origin'));
    assert.ok(doc.includes('docker volume rm demo-ai_agent-home'));
  });
}

test('renderContainerFiles returns the five files in order, no placeholder left, ai-dev.sh executable', () => {
  for (const stack of STACKS) {
    for (const backend of ['file', 'github', 'gitea', 'azure-devops']) {
      const files = renderContainerFiles({ name: 'Demo', stack, backend, giteaLogin: 'x' });
      assert.deepEqual(files.map((f) => f.path),
        ['compose.ai-dev.yml', 'compose.ai-dev.certs.yml', 'ai-dev.sh', 'ai-dev.ps1', 'AI-DEV.md']);
      for (const f of files) assert.doesNotMatch(f.content, /@@[A-Z_]+@@/, `${stack}/${backend}: ${f.path}`);
      assert.equal(fileOf(files, 'ai-dev.sh').mode, 0o755);
      assert.equal(fileOf(files, 'ai-dev.ps1').mode, undefined);
    }
  }
});
