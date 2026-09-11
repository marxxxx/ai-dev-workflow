#!/usr/bin/env node
// Container tool pins. tools/inventory.json is the single source of truth; this script
// renders the derived pins (tools/package.json + lockfile, Dockerfile FROM/ARGs), checks
// them for drift and resolves upstream updates. Host-side only; Node builtins only.
//
//   node docker/tools/inventory.mjs check              exit 1 if a derived pin drifted
//   node docker/tools/inventory.mjs sync               rewrite derived pins after editing inventory.json
//   node docker/tools/inventory.mjs outdated           list available updates (network)
//   node docker/tools/inventory.mjs update [--only a,b] apply updates, then sync (network)
import { spawnSync } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { versionOf } from './verify-versions.mjs';

const DOCKER_DIR = fileURLToPath(new URL('..', import.meta.url));
const INVENTORY = 'tools/inventory.json';
const PACKAGE_JSON = 'tools/package.json';
const LOCKFILE = 'tools/package-lock.json';
const DERIVED_FILES = [PACKAGE_JSON, 'Dockerfile', 'Dockerfile.dotnet'];

const DOCKERFILE_ARGS = {
  Dockerfile: {
    UV_VERSION: inventory => inventory.systemTools.uv,
    SERENA_REVISION: inventory => inventory.sourceRevisions.serena,
    SUPERPOWERS_REVISION: inventory => inventory.sourceRevisions.superpowers,
    AZURE_CLI_VERSION: inventory => inventory.systemTools.azureCliDebianPackage,
    AZURE_DEVOPS_EXTENSION_VERSION: inventory => inventory.systemTools.azureDevOpsCliExtension,
  },
  'Dockerfile.dotnet': {
    DOTNET_SDK_VERSION: inventory => inventory.derivedImages.dotnetSdk,
  },
};

// Tracked at the default branch HEAD, which is what the Dockerfile fetches by revision.
const SOURCE_REPOSITORIES = {
  serena: 'https://github.com/oraios/serena.git',
  superpowers: 'https://github.com/obra/superpowers.git',
};

const read = (dir, file) => readFileSync(path.join(dir, file), 'utf8');
const toJson = value => `${JSON.stringify(value, null, 2)}\n`;
const sorted = object => Object.fromEntries(Object.entries(object).sort(([a], [b]) => a.localeCompare(b, 'en')));

export function readInventory(dir = DOCKER_DIR) {
  return JSON.parse(read(dir, INVENTORY));
}

function replaceLine(text, pattern, line, file) {
  if (!pattern.test(text)) throw new Error(`${file}: no line matching ${pattern} to pin`);
  return text.replace(pattern, () => line);
}

export function renderDerivedFiles(inventory, current) {
  const manifest = JSON.parse(current[PACKAGE_JSON]);
  manifest.dependencies = sorted(inventory.npmPackages);
  const rendered = { [PACKAGE_JSON]: toJson(manifest) };
  for (const [file, args] of Object.entries(DOCKERFILE_ARGS)) {
    let text = current[file];
    if (file === 'Dockerfile') {
      text = replaceLine(text, /^FROM [^\r\n]*/m, `FROM ${inventory.baseImage.reference}`, file);
    }
    for (const [name, value] of Object.entries(args)) {
      text = replaceLine(text, new RegExp(`^ARG ${name}=[^\\r\\n]*`, 'm'), `ARG ${name}=${value(inventory)}`, file);
    }
    rendered[file] = text;
  }
  return rendered;
}

function firstDifference(actual, expected) {
  const actualLines = actual.split('\n');
  const expectedLines = expected.split('\n');
  const index = expectedLines.findIndex((line, i) => line !== actualLines[i]);
  return `expected "${expectedLines[index]?.trim()}", found "${actualLines[index]?.trim()}"`;
}

function lockfileDrift(inventory, lock) {
  const drift = [];
  if (!isDeepStrictEqual(sorted(lock.packages?.['']?.dependencies ?? {}), sorted(inventory.npmPackages))) {
    drift.push(`${LOCKFILE}: root dependencies differ from ${INVENTORY}`);
  }
  for (const [name, spec] of Object.entries(inventory.npmPackages)) {
    const resolved = lock.packages?.[`node_modules/${name}`]?.version;
    if (resolved !== versionOf(spec)) {
      drift.push(`${LOCKFILE}: ${name} resolves to ${resolved ?? 'nothing'}, inventory pins ${versionOf(spec)}`);
    }
  }
  for (const [follower, target] of Object.entries(inventory.updatePolicy?.npmFollowDependency ?? {})) {
    const required = lock.packages?.[`node_modules/${target}`]?.dependencies?.[follower];
    if (required !== inventory.npmPackages[follower]) {
      drift.push(`${INVENTORY}: ${follower} ${inventory.npmPackages[follower]} must equal the version ${target} depends on (${required})`);
    }
  }
  return drift;
}

export function findDrift(dir = DOCKER_DIR) {
  const inventory = readInventory(dir);
  const current = Object.fromEntries(DERIVED_FILES.map(file => [file, read(dir, file)]));
  const rendered = renderDerivedFiles(inventory, current);
  const drift = DERIVED_FILES
    .filter(file => rendered[file] !== current[file])
    .map(file => `${file}: ${firstDifference(current[file], rendered[file])}`);
  return [...drift, ...lockfileDrift(inventory, JSON.parse(read(dir, LOCKFILE)))];
}

// Fixed flags only: npm is a .cmd shim on Windows and needs a shell there.
function npm(args, cwd) {
  const result = spawnSync(['npm', ...args].join(' '), { cwd, stdio: 'inherit', shell: true });
  if (result.status !== 0) throw new Error(`npm ${args.join(' ')} failed with exit code ${result.status}`);
}

// Rewrites derived files; regenerates the lockfile when its root dependencies are stale,
// or from scratch (refreshing transitive dependencies) with freshLockfile.
export function syncDerivedFiles(dir = DOCKER_DIR, { regenerateLockfile = true, freshLockfile = false } = {}) {
  const inventory = readInventory(dir);
  const current = Object.fromEntries(DERIVED_FILES.map(file => [file, read(dir, file)]));
  const rendered = renderDerivedFiles(inventory, current);
  const changed = DERIVED_FILES.filter(file => rendered[file] !== current[file]);
  for (const file of changed) writeFileSync(path.join(dir, file), rendered[file]);
  const lock = JSON.parse(read(dir, LOCKFILE));
  const stale = !isDeepStrictEqual(sorted(lock.packages?.['']?.dependencies ?? {}), sorted(inventory.npmPackages));
  if (regenerateLockfile && (freshLockfile || stale)) {
    if (freshLockfile) rmSync(path.join(dir, LOCKFILE));
    npm(['install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund'], path.join(dir, 'tools'));
    changed.push(LOCKFILE);
  }
  return changed;
}

function numericParts(version) {
  return version.split(/[^0-9]+/).filter(Boolean).map(Number);
}

function compareVersions(a, b) {
  const left = numericParts(a);
  const right = numericParts(b);
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const difference = (left[i] ?? 0) - (right[i] ?? 0);
    if (difference) return difference;
  }
  return 0;
}

export function latestVersion(versions, { major } = {}) {
  const candidates = versions.filter(version => /^\d+\.\d+\.\d+$/.test(version)
    && (major === undefined || numericParts(version)[0] === major));
  if (!candidates.length) {
    throw new Error(`no stable version${major === undefined ? '' : ` in major ${major}`} among ${versions.join(', ')}`);
  }
  return candidates.sort(compareVersions).at(-1);
}

export function latestDebianVersion(packagesText, name, suffix) {
  const versions = packagesText.split(/\n\s*\n/)
    .filter(stanza => /^Package: (.+)$/m.exec(stanza)?.[1] === name)
    .map(stanza => /^Version: (.+)$/m.exec(stanza)?.[1])
    .filter(version => version?.endsWith(suffix));
  if (!versions.length) throw new Error(`no ${name} package ending in ${suffix}`);
  return versions.sort(compareVersions).at(-1);
}

function aliasTarget(name, spec) {
  return spec.startsWith('npm:') ? spec.slice(4, spec.lastIndexOf('@')) : name;
}

function withVersion(spec, version) {
  return spec.startsWith('npm:') ? `${spec.slice(0, spec.lastIndexOf('@'))}@${version}` : version;
}

// Returns one change per pin that has a newer upstream version, honoring updatePolicy.
export async function resolveUpdates(inventory, sources) {
  const policy = inventory.updatePolicy ?? {};
  const holds = policy.npmMajorHolds ?? {};
  const follows = policy.npmFollowDependency ?? {};
  const changes = [];
  const propose = (name, keyPath, from, to, extra = {}) => {
    if (!isDeepStrictEqual(from, to)) changes.push({ name, path: keyPath, from, to, ...extra });
  };

  const [repoTag] = inventory.baseImage.reference.split('@');
  const image = await sources.dockerImage(repoTag);
  propose('baseImage', ['baseImage'], inventory.baseImage, { reference: `${repoTag}@${image.digest}`, node: image.nodeVersion });

  const packuments = new Map();
  const packument = name => {
    if (!packuments.has(name)) packuments.set(name, sources.npmPackument(name));
    return packuments.get(name);
  };
  const resolved = {};
  for (const [name, spec] of Object.entries(inventory.npmPackages)) {
    if (follows[name]) continue;
    const document = await packument(aliasTarget(name, spec));
    resolved[name] = holds[name] === undefined
      ? document['dist-tags'].latest
      : latestVersion(Object.keys(document.versions), { major: holds[name] });
    propose(name, ['npmPackages', name], spec, withVersion(spec, resolved[name]));
  }
  for (const [name, target] of Object.entries(follows)) {
    if (!(name in inventory.npmPackages)) continue;
    const required = (await packument(target)).versions[resolved[target]]?.dependencies?.[name];
    if (!/^\d[\w.-]*$/.test(required ?? '')) {
      throw new Error(`${target}@${resolved[target]} does not pin an exact ${name} version (found ${required})`);
    }
    propose(name, ['npmPackages', name], inventory.npmPackages[name], required, { follows: target });
  }

  propose('uv', ['systemTools', 'uv'], inventory.systemTools.uv,
    (await sources.githubLatestRelease('astral-sh/uv')).replace(/^v/, ''));
  const azureCli = inventory.systemTools.azureCliDebianPackage;
  const suffix = /~[^~]+$/.exec(azureCli)?.[0] ?? '';
  propose('azureCliDebianPackage', ['systemTools', 'azureCliDebianPackage'], azureCli,
    latestDebianVersion(await sources.debianPackages(suffix.slice(1)), 'azure-cli', suffix));
  propose('azureDevOpsCliExtension', ['systemTools', 'azureDevOpsCliExtension'], inventory.systemTools.azureDevOpsCliExtension,
    latestVersion(await sources.azureCliExtensionVersions('azure-devops')));
  for (const [name, url] of Object.entries(SOURCE_REPOSITORIES)) {
    propose(name, ['sourceRevisions', name], inventory.sourceRevisions[name], await sources.gitHead(url));
  }
  const channel = policy.dotnetChannel ?? inventory.derivedImages.dotnetSdk.split('.').slice(0, 2).join('.');
  propose('dotnetSdk', ['derivedImages', 'dotnetSdk'], inventory.derivedImages.dotnetSdk, await sources.dotnetLatestSdk(channel));
  return changes;
}

export function inventoryNames(inventory) {
  return ['baseImage', ...Object.keys(inventory.npmPackages), ...Object.keys(inventory.systemTools),
    ...Object.keys(inventory.sourceRevisions), ...Object.keys(inventory.derivedImages)];
}

// Narrows changes to the named pins; dependents (npmFollowDependency) move with their target.
export function selectChanges(changes, names, knownNames = changes.map(change => change.name)) {
  if (!names?.length) return changes;
  const unknown = names.filter(name => !knownNames.includes(name));
  if (unknown.length) throw new Error(`unknown pin: ${unknown.join(', ')}`);
  return changes.filter(change => names.includes(change.name) || names.includes(change.follows));
}

export function applyChanges(inventory, changes) {
  const next = structuredClone(inventory);
  for (const { path: keyPath, to } of changes) {
    const parent = keyPath.slice(0, -1).reduce((node, key) => node[key], next);
    parent[keyPath.at(-1)] = structuredClone(to);
  }
  return next;
}

export function createSources(fetchImpl = globalThis.fetch) {
  async function get(url, headers = {}) {
    const response = await fetchImpl(url, { headers });
    if (!response.ok) throw new Error(`GET ${url}: HTTP ${response.status}`);
    return response;
  }
  const getJson = async (url, headers) => (await get(url, headers)).json();
  return {
    npmPackument: name => getJson(`https://registry.npmjs.org/${name}`, { Accept: 'application/vnd.npm.install-v1+json' }),
    async dockerImage(repoTag) {
      const [repository, tag] = repoTag.split(':');
      if (repository.split('/')[0].includes('.')) throw new Error(`only Docker Hub base images can be resolved: ${repoTag}`);
      const name = repository.includes('/') ? repository : `library/${repository}`;
      const { token } = await getJson(`https://auth.docker.io/token?service=registry.docker.io&scope=repository:${name}:pull`);
      const auth = { Authorization: `Bearer ${token}` };
      const registry = `https://registry-1.docker.io/v2/${name}`;
      const indexResponse = await get(`${registry}/manifests/${tag}`, {
        ...auth, Accept: 'application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json',
      });
      const digest = indexResponse.headers.get('docker-content-digest');
      const platform = (await indexResponse.json()).manifests
        ?.find(entry => entry.platform?.os === 'linux' && entry.platform?.architecture === 'amd64');
      if (!digest || !platform) throw new Error(`${repoTag} is not a multi-platform image index with linux/amd64`);
      const manifest = await getJson(`${registry}/manifests/${platform.digest}`, { ...auth, Accept: platform.mediaType });
      const config = await getJson(`${registry}/blobs/${manifest.config.digest}`, auth);
      const nodeVersion = config.config.Env.find(entry => entry.startsWith('NODE_VERSION='))?.split('=')[1];
      if (!nodeVersion) throw new Error(`${repoTag} does not declare NODE_VERSION`);
      return { digest, nodeVersion };
    },
    async gitHead(url) {
      const result = spawnSync('git', ['ls-remote', url, 'HEAD'], { encoding: 'utf8' });
      const sha = result.status === 0 ? result.stdout.split(/\s/)[0] : '';
      if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error(`git ls-remote ${url} HEAD failed: ${result.stderr}`);
      return sha;
    },
    async githubLatestRelease(repository) {
      const headers = { Accept: 'application/vnd.github+json' };
      if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
      return (await getJson(`https://api.github.com/repos/${repository}/releases/latest`, headers)).tag_name;
    },
    async debianPackages(distribution) {
      const url = `https://packages.microsoft.com/repos/azure-cli/dists/${distribution}/main/binary-amd64/Packages.gz`;
      return gunzipSync(Buffer.from(await (await get(url)).arrayBuffer())).toString('utf8');
    },
    async azureCliExtensionVersions(name) {
      const index = await getJson('https://azcliextensionsync.blob.core.windows.net/index1/index.json');
      return (index.extensions?.[name] ?? []).map(entry => entry.metadata?.version).filter(Boolean);
    },
    async dotnetLatestSdk(channel) {
      const url = `https://dotnetcli.blob.core.windows.net/dotnet/release-metadata/${channel}/releases.json`;
      return (await getJson(url))['latest-sdk'];
    },
  };
}

function describe(value) {
  return typeof value === 'object' ? `${value.reference} (node ${value.node})` : value;
}

function printChanges(changes) {
  const width = Math.max(...changes.map(change => change.name.length));
  for (const change of changes) {
    console.log(`  ${change.name.padEnd(width)}  ${describe(change.from)} -> ${describe(change.to)}`);
  }
}

function reportDrift(drift) {
  if (!drift.length) {
    console.log(`Tool pins are in sync with ${INVENTORY}.`);
    return 0;
  }
  for (const line of drift) console.error(`drift: ${line}`);
  console.error(`Edit only ${INVENTORY}, then run: node docker/tools/inventory.mjs sync`);
  return 1;
}

async function main([command = 'check', ...args]) {
  switch (command) {
    case 'check':
      return reportDrift(findDrift());
    case 'sync': {
      const changed = syncDerivedFiles();
      console.log(changed.length ? `Rewrote ${changed.join(', ')}.` : 'Nothing to rewrite.');
      return reportDrift(findDrift());
    }
    case 'outdated':
    case 'update': {
      const inventory = readInventory();
      const onlyIndex = args.indexOf('--only');
      const only = onlyIndex === -1 ? [] : (args[onlyIndex + 1] ?? '').split(',').filter(Boolean);
      const changes = selectChanges(await resolveUpdates(inventory, createSources()), only, inventoryNames(inventory));
      if (!changes.length) {
        console.log('All selected pins are current.');
        return 0;
      }
      console.log(command === 'update' ? 'Updating:' : 'Updates available:');
      printChanges(changes);
      if (command === 'outdated') return 0;
      writeFileSync(path.join(DOCKER_DIR, INVENTORY), toJson(applyChanges(inventory, changes)));
      syncDerivedFiles(DOCKER_DIR, { freshLockfile: only.length === 0 });
      const status = reportDrift(findDrift());
      if (status === 0) {
        console.log('Next: review release notes, then run node docker/build.mjs --no-cache and bash docker/verify-runtime.sh');
      }
      return status;
    }
    default:
      console.error('usage: node docker/tools/inventory.mjs check | sync | outdated | update [--only name,...]');
      return 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then(code => { process.exitCode = code; }, error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
