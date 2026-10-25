import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  applyChanges, findDrift, latestDebianVersion, latestVersion, lockfileCommand, lockfileStale, muslWithoutLibc, renderDerivedFiles,
  resolveUpdates, selectChanges, syncDerivedFiles,
} from '../tools/inventory.mjs';

const dockerDir = fileURLToPath(new URL('..', import.meta.url));
// The dind overlay is an init template under agent-src/container/, next to docker/.
const dindOverlay = '../agent-src/container/compose.ai-dev.dind.yml';
// The third-party agent skills that adw init/upgrade install into consuming projects.
const skillsConfig = '../agent-src/config/skills.json';
// The ACP layer adw e2e builds on a project's dev image (e2e/local/image), derived from e2eNpmPackages.
const e2ePackage = '../e2e/local/image/package.json';
const e2eLockfile = '../e2e/local/image/package-lock.json';
const pinnedFiles = ['Dockerfile', 'Dockerfile.dotnet', dindOverlay, skillsConfig, e2ePackage, e2eLockfile,
  'tools/inventory.json', 'tools/package.json', 'tools/package-lock.json'];

function fixture(t) {
  const base = mkdtempSync(path.join(tmpdir(), 'agent-inventory-'));
  const root = path.join(base, 'docker');
  for (const file of pinnedFiles) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    cpSync(path.join(dockerDir, file), path.join(root, file));
  }
  t.after(() => rmSync(base, { recursive: true, force: true }));
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

test('the ACP packages are e2e-only pins', () => {
  const inventory = JSON.parse(readFileSync(path.join(dockerDir, 'tools/inventory.json'), 'utf8'));
  assert.deepEqual(Object.keys(inventory.e2eNpmPackages).sort(),
    ['@agentclientprotocol/codex-acp', '@zed-industries/claude-code-acp', 'acpx']);
  for (const name of Object.keys(inventory.e2eNpmPackages)) assert.ok(!(name in inventory.npmPackages), name);
});

test('reports an e2e package.json and lockfile that disagree with the inventory', t => {
  const root = fixture(t);
  editJson(path.join(root, 'tools/inventory.json'), inventory => { inventory.e2eNpmPackages.acpx = '9.9.9'; });
  const drift = findDrift(root).join('\n');
  assert.match(drift, /e2e\/local\/image\/package\.json/);
  assert.match(drift, /e2e\/local\/image\/package-lock\.json: acpx resolves to 0\.11\.2, inventory pins 9\.9\.9/);
});

test('sync rewrites the e2e package.json from the inventory', t => {
  const root = fixture(t);
  editJson(path.join(root, 'tools/inventory.json'), inventory => { inventory.e2eNpmPackages.acpx = '9.9.9'; });
  syncDerivedFiles(root, { regenerateLockfile: false });
  const manifest = JSON.parse(readFileSync(path.join(root, e2ePackage), 'utf8'));
  assert.equal(manifest.dependencies.acpx, '9.9.9');
});

test('a -musl lockfile entry without libc is drift', t => {
  const lock = { packages: {
    'node_modules/x-linux-x64-musl': { version: '1.0.0', libc: ['musl'] },
    'node_modules/y-linux-x64-musl': { version: '1.0.0' },
    'node_modules/@s/z-linux-x64-musl': { version: '1.0.0' },
    'node_modules/@img/sharp-linuxmusl-x64': { version: '1.0.0' },
    'node_modules/@img/sharp-linux-x64': { version: '1.0.0' },
  } };
  assert.deepEqual(muslWithoutLibc(lock),
    ['node_modules/y-linux-x64-musl', 'node_modules/@s/z-linux-x64-musl', 'node_modules/@img/sharp-linuxmusl-x64']);
  const root = fixture(t);
  editJson(path.join(root, e2eLockfile), l => {
    l.packages['node_modules/fake-linux-x64-musl'] = { version: '1.0.0', os: ['linux'] };
  });
  assert.match(findDrift(root).join('\n'), /e2e\/local\/image\/package-lock\.json: node_modules\/fake-linux-x64-musl has no libc/);
});

test('a lockfile is stale when its root dependencies differ or it lost libc', () => {
  const root = { packages: { '': { dependencies: { acpx: '1.0.0' } }, 'node_modules/acpx': { version: '1.0.0' } } };
  assert.equal(lockfileStale({ acpx: '1.0.0' }, root), false);
  assert.equal(lockfileStale({ acpx: '2.0.0' }, root), true);
  assert.equal(lockfileStale({ acpx: '1.0.0' }, {}), true, 'missing lockfile');
  const lostLibc = structuredClone(root);
  lostLibc.packages['node_modules/@img/sharp-linuxmusl-x64'] = { version: '1.0.0' };
  assert.equal(lockfileStale({ acpx: '1.0.0' }, lostLibc), true);
});

test('lockfiles are generated with the base image npm, as the host user', () => {
  const inventory = { baseImage: { reference: 'node:24-bookworm-slim@sha256:abc' } };
  assert.deepEqual(lockfileCommand(inventory, '/d/tools', { uid: 1001, gid: 1002 }), ['docker', [
    'run', '--rm', '-u', '1001:1002', '-e', 'HOME=/tmp', '-v', '/d/tools:/w', '-w', '/w', '--entrypoint', 'npm',
    'node:24-bookworm-slim@sha256:abc', 'install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund']]);
});

test('reports a dind overlay image that disagrees with the inventory', t => {
  const root = fixture(t);
  editJson(path.join(root, 'tools/inventory.json'), inventory => {
    inventory.dindImage.reference = 'docker:99-dind@sha256:def';
  });
  assert.match(findDrift(root).join('\n'), /compose\.ai-dev\.dind\.yml.*docker:99-dind/);
});

test('reports a skills config that disagrees with the inventory', t => {
  const root = fixture(t);
  editJson(path.join(root, 'tools/inventory.json'), inventory => {
    inventory.agentSkills.skills['show-me'].revision = 'e'.repeat(40);
  });
  assert.match(findDrift(root).join('\n'), /skills\.json/);
});

test('sync rewrites the skills config from the inventory', t => {
  const root = fixture(t);
  editJson(path.join(root, 'tools/inventory.json'), inventory => {
    inventory.agentSkills.cli = '9.9.9';
    inventory.agentSkills.skills['show-me'].revision = 'e'.repeat(40);
  });
  syncDerivedFiles(root, { regenerateLockfile: false });
  const skills = JSON.parse(readFileSync(path.join(root, skillsConfig), 'utf8'));
  assert.equal(skills.cli, '9.9.9');
  assert.equal(skills.skills['show-me'].revision, 'e'.repeat(40));
  assert.equal(skills.skills['show-me'].repository, 'humanlayer/skills');
  assert.deepEqual(findDrift(root), []);
});

test('sync rewrites Dockerfile pins from the inventory', t => {
  const root = fixture(t);
  editJson(path.join(root, 'tools/inventory.json'), inventory => {
    inventory.baseImage.reference = 'node:24-bookworm-slim@sha256:abc';
    inventory.systemTools.uv = '9.9.9';
    inventory.systemTools.azureDevOpsCliExtension = '8.8.8';
    inventory.systemTools.tea = '7.7.7';
    inventory.sourceRevisions.serena = 'f'.repeat(40);
    inventory.derivedImages.dotnetSdk = '10.0.999';
    inventory.derivedImages.dotnetEf = '10.0.99';
    inventory.systemTools.dockerCliDebianPackage = '5:99.0.0-1~debian.12~bookworm';
    inventory.dindImage.reference = 'docker:99-dind@sha256:def';
  });
  syncDerivedFiles(root, { regenerateLockfile: false });
  const dockerfile = readFileSync(path.join(root, 'Dockerfile'), 'utf8');
  assert.match(dockerfile, /^FROM node:24-bookworm-slim@sha256:abc$/m);
  assert.match(dockerfile, /^ARG UV_VERSION=9\.9\.9$/m);
  assert.match(dockerfile, /^ARG AZURE_DEVOPS_EXTENSION_VERSION=8\.8\.8$/m);
  assert.match(dockerfile, /^ARG TEA_VERSION=7\.7\.7$/m);
  assert.match(dockerfile, new RegExp(`^ARG SERENA_REVISION=${'f'.repeat(40)}$`, 'm'));
  const dotnetDockerfile = readFileSync(path.join(root, 'Dockerfile.dotnet'), 'utf8');
  assert.match(dotnetDockerfile, /^ARG DOTNET_SDK_VERSION=10\.0\.999$/m);
  assert.match(dotnetDockerfile, /^ARG DOTNET_EF_VERSION=10\.0\.99$/m);
  assert.match(dockerfile, /^ARG DOCKER_CLI_VERSION=5:99\.0\.0-1~debian\.12~bookworm$/m);
  const dind = readFileSync(path.join(root, dindOverlay), 'utf8');
  assert.match(dind, /^ {4}image: docker:99-dind@sha256:def$/m);
  assert.deepEqual(findDrift(root), []);
});

test('rendering fails closed when a pinned ARG is missing', t => {
  const root = fixture(t);
  const inventory = JSON.parse(readFileSync(path.join(root, 'tools/inventory.json'), 'utf8'));
  const current = Object.fromEntries(['Dockerfile', 'Dockerfile.dotnet', 'tools/package.json', e2ePackage]
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
    e2eNpmPackages: { acpx: '0.11.2' },
    systemTools: {
      azureCliDebianPackage: '2.90.0-1~bookworm',
      azureDevOpsCliExtension: '1.0.8',
      dockerBuildxDebianPackage: '0.37.0-1~debian.12~bookworm',
      dockerCliDebianPackage: '5:29.8.0-1~debian.12~bookworm',
      dockerComposeDebianPackage: '5.6.0-1~debian.12~bookworm',
      tea: '0.15.1',
      uv: '0.12.13',
    },
    sourceRevisions: { serena: 'a'.repeat(40), superpowers: 'b'.repeat(40) },
    derivedImages: { dotnetSdk: '10.0.401', dotnetEf: '10.0.11' },
    dindImage: { reference: 'docker:29-dind@sha256:old', docker: '29.8.0' },
    agentSkills: {
      cli: '1.7.0',
      skills: { 'show-me': { repository: 'humanlayer/skills', path: 'plugins/show-me/skills/show-me', revision: 'd'.repeat(40) } },
    },
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
    acpx: { latest: '0.12.0', versions: ['0.11.2', '0.12.0'] },
    skills: { latest: '1.8.0', versions: ['1.7.0', '1.8.0'] },
  };
  return {
    npmPackument: async name => {
      const { latest, versions, dependencies = {} } = packuments[name];
      return { 'dist-tags': { latest }, versions: Object.fromEntries(versions.map(v => [v, { dependencies }])) };
    },
    dockerImage: async repoTag => ({
      'node:24-bookworm-slim': { digest: 'sha256:new', env: { NODE_VERSION: '24.2.0' } },
      'docker:29-dind': { digest: 'sha256:newdind', env: { DOCKER_VERSION: '29.9.0' } },
    })[repoTag],
    gitHead: async url => (url.includes('serena') ? 'c' : url.includes('humanlayer') ? 'e' : 'b').repeat(40),
    githubLatestRelease: async repo => {
      assert.equal(repo, 'astral-sh/uv');
      return '0.13.0';
    },
    giteaLatestRelease: async (host, repo) => {
      assert.deepEqual([host, repo], ['https://gitea.com', 'gitea/tea']);
      return 'v0.16.0';
    },
    debianPackages: async () => 'Package: azure-cli\nVersion: 2.91.0-1~bookworm\n',
    dockerDebianPackages: async distribution => {
      assert.equal(distribution, 'bookworm');
      return [
        'Package: docker-ce-cli\nVersion: 5:29.9.1-1~debian.12~bookworm\n',
        'Package: docker-ce-cli\nVersion: 5:29.10.0-1~debian.13~trixie\n',
        'Package: docker-buildx-plugin\nVersion: 0.38.0-1~debian.12~bookworm\n',
        'Package: docker-compose-plugin\nVersion: 5.6.0-1~debian.12~bookworm\n',
      ].join('\n');
    },
    azureCliExtensionVersions: async name => {
      assert.equal(name, 'azure-devops');
      return ['0.26.0', '1.0.9', '1.0.8', '1.1.0b1'];
    },
    nugetVersions: async name => {
      assert.equal(name, 'dotnet-ef');
      return ['9.0.9', '10.0.11', '10.0.12', '10.1.0', '11.0.0-preview.1'];
    },
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
    acpx: '0.12.0',
    azureCliDebianPackage: '2.91.0-1~bookworm',
    azureDevOpsCliExtension: '1.0.9',
    dockerCliDebianPackage: '5:29.9.1-1~debian.12~bookworm',
    dockerBuildxDebianPackage: '0.38.0-1~debian.12~bookworm',
    dindImage: { reference: 'docker:29-dind@sha256:newdind', docker: '29.9.0' },
    tea: '0.16.0',
    uv: '0.13.0',
    serena: 'c'.repeat(40),
    skills: '1.8.0',
    'show-me': 'e'.repeat(40),
    dotnetSdk: '10.0.402',
    dotnetEf: '10.0.12',
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
  assert.deepEqual(changes.find(change => change.name === 'acpx').path, ['e2eNpmPackages', 'acpx']);
  assert.throws(() => selectChanges(changes, ['no-such-tool']), /no-such-tool/);
});
