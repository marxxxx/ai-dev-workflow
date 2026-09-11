import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  applyChanges, findDrift, latestDebianVersion, latestVersion, renderDerivedFiles,
  resolveUpdates, selectChanges, syncDerivedFiles,
} from '../tools/inventory.mjs';

const dockerDir = fileURLToPath(new URL('..', import.meta.url));
const pinnedFiles = ['Dockerfile', 'Dockerfile.dotnet', 'tools/inventory.json', 'tools/package.json', 'tools/package-lock.json'];

function fixture(t) {
  const root = mkdtempSync(path.join(tmpdir(), 'agent-inventory-'));
  mkdirSync(path.join(root, 'tools'));
  for (const file of pinnedFiles) cpSync(path.join(dockerDir, file), path.join(root, file));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function editJson(file, edit) {
  const value = JSON.parse(readFileSync(file, 'utf8'));
  edit(value);
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

test('the committed pins agree with the inventory', () => {
  assert.deepEqual(findDrift(dockerDir), []);
});

test('reports each derived file that disagrees with the inventory', t => {
  const root = fixture(t);
  editJson(path.join(root, 'tools/inventory.json'), inventory => {
    inventory.systemTools.uv = '9.9.9';
    inventory.npmPackages['@anthropic-ai/claude-code'] = '9.9.9';
  });
  const drift = findDrift(root).join('\n');
  assert.match(drift, /Dockerfile.*UV_VERSION/);
  assert.match(drift, /tools\/package\.json/);
  assert.match(drift, /package-lock\.json/);
});

test('sync rewrites Dockerfile pins from the inventory', t => {
  const root = fixture(t);
  editJson(path.join(root, 'tools/inventory.json'), inventory => {
    inventory.baseImage.reference = 'node:24-bookworm-slim@sha256:abc';
    inventory.systemTools.uv = '9.9.9';
    inventory.sourceRevisions.serena = 'f'.repeat(40);
    inventory.derivedImages.dotnetSdk = '10.0.999';
  });
  syncDerivedFiles(root, { regenerateLockfile: false });
  const dockerfile = readFileSync(path.join(root, 'Dockerfile'), 'utf8');
  assert.match(dockerfile, /^FROM node:24-bookworm-slim@sha256:abc$/m);
  assert.match(dockerfile, /^ARG UV_VERSION=9\.9\.9$/m);
  assert.match(dockerfile, new RegExp(`^ARG SERENA_REVISION=${'f'.repeat(40)}$`, 'm'));
  assert.match(readFileSync(path.join(root, 'Dockerfile.dotnet'), 'utf8'), /^ARG DOTNET_SDK_VERSION=10\.0\.999$/m);
  assert.deepEqual(findDrift(root), []);
});

test('rendering fails closed when a pinned ARG is missing', t => {
  const root = fixture(t);
  const inventory = JSON.parse(readFileSync(path.join(root, 'tools/inventory.json'), 'utf8'));
  const current = Object.fromEntries(['Dockerfile', 'Dockerfile.dotnet', 'tools/package.json']
    .map(file => [file, readFileSync(path.join(root, file), 'utf8')]));
  current.Dockerfile = current.Dockerfile.replace(/^ARG UV_VERSION=.*\n/m, '');
  assert.throws(() => renderDerivedFiles(inventory, current), /UV_VERSION/);
});

test('detects a playwright pin that diverges from the MCP dependency', t => {
  const root = fixture(t);
  editJson(path.join(root, 'tools/package-lock.json'), lock => {
    lock.packages['node_modules/@playwright/mcp'].dependencies.playwright = '0.0.1';
  });
  assert.match(findDrift(root).join('\n'), /playwright.*@playwright\/mcp/);
});

test('picks the highest stable version, optionally within a major', () => {
  assert.equal(latestVersion(['1.2.3', '1.10.0', '2.0.0-beta.1', '1.9.9']), '1.10.0');
  assert.equal(latestVersion(['1.5.0', '2.1.0', '1.4.9'], { major: 1 }), '1.5.0');
  assert.throws(() => latestVersion(['2.0.0'], { major: 1 }), /no stable version/);
});

test('picks the highest Debian package version for the pinned distribution', () => {
  const packages = [
    'Package: azure-cli\nVersion: 2.65.0-1~bookworm\n',
    'Package: azure-cli\nVersion: 2.90.0-1~bookworm\n',
    'Package: azure-cli\nVersion: 2.9.0-1~bookworm\n',
    'Package: azure-cli\nVersion: 2.91.0-1~bullseye\n',
    'Package: other\nVersion: 9.0.0-1~bookworm\n',
  ].join('\n');
  assert.equal(latestDebianVersion(packages, 'azure-cli', '~bookworm'), '2.90.0-1~bookworm');
});

function sampleInventory() {
  return {
    baseImage: { reference: 'node:24-bookworm-slim@sha256:old', node: '24.1.0' },
    npmPackages: {
      '@anthropic-ai/claude-code': '2.1.0',
      '@azure-devops/mcp': '2.10.0',
      '@playwright/mcp': '0.0.80',
      playwright: '1.63.0-alpha-2026-08-31',
      'typescript-serena': 'npm:typescript@5.9.3',
      yarn: '1.22.22',
    },
    systemTools: { azureCliDebianPackage: '2.90.0-1~bookworm', uv: '0.12.13' },
    sourceRevisions: { serena: 'a'.repeat(40), superpowers: 'b'.repeat(40) },
    derivedImages: { dotnetSdk: '10.0.401' },
    updatePolicy: {
      npmMajorHolds: { '@azure-devops/mcp': 2, 'typescript-serena': 5 },
      npmFollowDependency: { playwright: '@playwright/mcp' },
      dotnetChannel: '10.0',
    },
  };
}

function fakeSources() {
  const packuments = {
    '@anthropic-ai/claude-code': { latest: '2.2.0', versions: ['2.1.0', '2.2.0'] },
    '@azure-devops/mcp': { latest: '3.0.0', versions: ['2.10.0', '2.11.0', '3.0.0'] },
    '@playwright/mcp': { latest: '0.0.81', versions: ['0.0.80', '0.0.81'], dependencies: { playwright: '1.64.0-alpha-2026-09-10' } },
    typescript: { latest: '7.0.3', versions: ['5.9.3', '5.9.4', '6.0.1', '7.0.3'] },
    yarn: { latest: '1.22.22', versions: ['1.22.22'] },
  };
  return {
    npmPackument: async name => {
      const { latest, versions, dependencies = {} } = packuments[name];
      return { 'dist-tags': { latest }, versions: Object.fromEntries(versions.map(v => [v, { dependencies }])) };
    },
    dockerImage: async repoTag => {
      assert.equal(repoTag, 'node:24-bookworm-slim');
      return { digest: 'sha256:new', nodeVersion: '24.2.0' };
    },
    gitHead: async url => (url.includes('serena') ? 'c' : 'b').repeat(40),
    githubLatestRelease: async repo => {
      assert.equal(repo, 'astral-sh/uv');
      return '0.13.0';
    },
    debianPackages: async () => 'Package: azure-cli\nVersion: 2.91.0-1~bookworm\n',
    dotnetLatestSdk: async channel => {
      assert.equal(channel, '10.0');
      return '10.0.402';
    },
  };
}

test('resolves the latest versions within the update policy', async () => {
  const changes = await resolveUpdates(sampleInventory(), fakeSources());
  const byName = Object.fromEntries(changes.map(change => [change.name, change.to]));
  assert.deepEqual(byName, {
    baseImage: { reference: 'node:24-bookworm-slim@sha256:new', node: '24.2.0' },
    '@anthropic-ai/claude-code': '2.2.0',
    '@azure-devops/mcp': '2.11.0',
    '@playwright/mcp': '0.0.81',
    playwright: '1.64.0-alpha-2026-09-10',
    'typescript-serena': 'npm:typescript@5.9.4',
    azureCliDebianPackage: '2.91.0-1~bookworm',
    uv: '0.13.0',
    serena: 'c'.repeat(40),
    dotnetSdk: '10.0.402',
  });
});

test('applies selected changes and keeps followers with their target', async () => {
  const inventory = sampleInventory();
  const changes = await resolveUpdates(inventory, fakeSources());
  const selected = selectChanges(changes, ['@playwright/mcp']);
  assert.deepEqual(selected.map(change => change.name).sort(), ['@playwright/mcp', 'playwright']);
  const next = applyChanges(inventory, selected);
  assert.equal(next.npmPackages['@playwright/mcp'], '0.0.81');
  assert.equal(next.npmPackages.playwright, '1.64.0-alpha-2026-09-10');
  assert.equal(next.npmPackages['@anthropic-ai/claude-code'], '2.1.0');
  assert.equal(inventory.npmPackages['@playwright/mcp'], '0.0.80', 'input inventory is not mutated');
  assert.throws(() => selectChanges(changes, ['no-such-tool']), /no-such-tool/);
});
