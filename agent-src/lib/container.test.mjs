// Container setup written by `init`: stack detection, Compose slug, template rendering, the
// write-once file I/O and the next-steps printout.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { STACKS, detectStack, composeSlug, renderContainerFiles, ensureLine, writeContainerFiles, nextSteps } from './container.mjs';
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

const OPTS = { name: 'Demo', stack: 'node', backend: 'github' };

test('writeContainerFiles writes all files into an empty root', () => {
  const { root, cleanup } = makeTmpRoot();
  try {
    const { written, skipped } = writeContainerFiles(root, OPTS);
    assert.deepEqual(written, ['compose.ai-dev.yml', 'compose.ai-dev.certs.yml', 'ai-dev.sh', 'ai-dev.ps1',
      'AI-DEV.md', '.gitignore', '.gitattributes']);
    assert.deepEqual(skipped, []);
    assert.equal(fs.readFileSync(path.join(root, '.gitignore'), 'utf8'), '.env.ai-dev\n');
    assert.equal(fs.readFileSync(path.join(root, '.gitattributes'), 'utf8'), 'ai-dev.sh text eol=lf\n');
    if (process.platform !== 'win32') {
      assert.equal(fs.statSync(path.join(root, 'ai-dev.sh')).mode & 0o777, 0o755);
    }
  } finally {
    cleanup();
  }
});

test('writeContainerFiles leaves existing files untouched and reports them', () => {
  const { root, cleanup } = makeTmpRoot();
  try {
    fs.writeFileSync(path.join(root, 'compose.ai-dev.yml'), 'mine');
    fs.writeFileSync(path.join(root, '.gitignore'), '.env.ai-dev\n');
    const { written, skipped } = writeContainerFiles(root, OPTS);
    assert.equal(fs.readFileSync(path.join(root, 'compose.ai-dev.yml'), 'utf8'), 'mine');
    assert.deepEqual(skipped, ['compose.ai-dev.yml']);
    assert.ok(!written.includes('compose.ai-dev.yml'));
    assert.ok(!written.includes('.gitignore'), 'an unchanged .gitignore is not reported as written');
  } finally {
    cleanup();
  }
});

test('ensureLine appends once, on its own line, and creates missing files', () => {
  const { root, cleanup } = makeTmpRoot();
  try {
    const file = path.join(root, '.gitignore');
    fs.writeFileSync(file, 'node_modules');
    assert.equal(ensureLine(file, '.env.ai-dev'), true);
    assert.equal(fs.readFileSync(file, 'utf8'), 'node_modules\n.env.ai-dev\n');
    assert.equal(ensureLine(file, '.env.ai-dev'), false);
    assert.equal(fs.readFileSync(file, 'utf8'), 'node_modules\n.env.ai-dev\n');

    fs.writeFileSync(file, 'a\r\n  .env.ai-dev  \r\n');
    assert.equal(ensureLine(file, '.env.ai-dev'), false);

    const fresh = path.join(root, 'new-file');
    assert.equal(ensureLine(fresh, 'x'), true);
    assert.equal(fs.readFileSync(fresh, 'utf8'), 'x\n');
  } finally {
    cleanup();
  }
});

test('nextSteps lists the versioned generate command and the backend login, numbered without gaps', () => {
  const steps = (text) => text.split('\n').map((l) => l.match(/^ {2}(\d+)\. /)?.[1]).filter(Boolean).map(Number);

  const github = nextSteps({ backend: 'github', version: '1.2.3' });
  assert.match(github, /^ {2}1\. npx @strobl_dev\/adw@1\.2\.3 generate/m);
  assert.ok(github.includes('./ai-dev.sh gh auth login && ./ai-dev.sh gh auth setup-git'));
  assert.deepEqual(steps(github), [1, 2, 3, 4, 5, 6]);
  assert.ok(github.includes('AI-DEV.md'));
  assert.ok(github.includes('.\\ai-dev.ps1'));

  assert.ok(nextSteps({ backend: 'gitea', version: '1' }).includes('./ai-dev.sh tea login add'));
  assert.ok(nextSteps({ backend: 'azure-devops', version: '1' }).includes('./ai-dev.sh az login --use-device-code --allow-no-subscriptions'));

  const file = nextSteps({ backend: 'file', version: '1' });
  assert.doesNotMatch(file, /gh auth|tea login|az login/);
  assert.deepEqual(steps(file), [1, 2, 3, 4, 5]);
});

test('composeSlug never starts with an underscore (Compose rejects it)', () => {
  assert.equal(composeSlug('_internal'), 'internal');
  assert.equal(composeSlug('-_x'), 'x');
});

test('composeSlug falls back to the next candidate before the shared "project" default', () => {
  assert.equal(composeSlug('日本', 'My Repo'), 'my-repo');
  assert.equal(composeSlug('日本', '日本'), 'project');
});

test('writeContainerFiles names a non-Latin project after its directory, not the shared fallback', () => {
  const { root, cleanup } = makeTmpRoot();
  try {
    writeContainerFiles(root, { name: 'Проект', stack: 'generic', backend: 'file' });
    const compose = fs.readFileSync(path.join(root, 'compose.ai-dev.yml'), 'utf8');
    assert.match(compose, new RegExp(`^name: ${composeSlug(path.basename(root))}-ai$`, 'm'));
    assert.doesNotMatch(compose, /^name: project-ai$/m);
  } finally {
    cleanup();
  }
});

test('nextSteps prefixes every container command with the launcher', () => {
  const text = nextSteps({ backend: 'file', version: '1' });
  assert.ok(text.includes('./ai-dev.sh codex login --device-auth'));
  assert.ok(text.includes('./ai-dev.sh opencode auth login'));
});
