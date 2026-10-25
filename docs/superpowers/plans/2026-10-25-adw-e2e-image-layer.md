# `adw e2e` ACP layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move `acpx` and the ACP adapters out of the dev images into a thin layer that `adw e2e` builds on the project's own dev image.

**Architecture:** `docker/tools/inventory.json` gets an `e2eNpmPackages` group from which `inventory.mjs` derives `e2e/local/image/package.json` + lockfile (generated with the base image's npm). A new `e2e/local/image.mjs` resolves the project's compose image, builds `adw-e2e:<hash>` from `e2e/local/image/Dockerfile` when missing, prunes the project's older layers and writes a compose override; `session.mjs` adds that override as the last `-f`.

**Tech Stack:** Node ≥24 builtins only, `node:test`, Docker / Docker Compose ≥2.24 (`!reset`).

**Spec:** `docs/superpowers/specs/2026-10-25-adw-e2e-image-layer-design.md`

## Global Constraints

- Zero runtime dependencies; LF line endings.
- ACP pins: `acpx` 0.11.2, `@zed-industries/claude-code-acp` 0.16.2, `@agentclientprotocol/codex-acp` 1.12.0.
- Layer tag: `adw-e2e:<first 12 hex of sha256(base image ID, Dockerfile, lockfile)>`; label `adw.e2e.root=<project root>`.
- Override file `compose.adw-e2e.yml` in the run dir: `image: <tag>`, `pull_policy: never`, `build: !reset null`.
- Base image pulled only when missing locally (compose's `pull_policy: missing`).
- Lockfiles generated with `docker run --rm <inventory.baseImage.reference> npm install --package-lock-only --ignore-scripts --no-audit --no-fund`, never the host's npm.
- Harbor keeps its own pins (`ACP_VERSIONS`, the `npm install -g` line in the task Dockerfiles), not derived.
- Every runtime file `adw e2e` reads ships in `package.json` `files` (AGENTS.md Rule 2).
- Derived files are never hand-edited: change `inventory.json`, run `node docker/tools/inventory.mjs sync`.

## Review Focus

1. Project compose with `build:` and no `image:` → the image compose would name is built and used as the base; the override drops `build`.
2. Base image absent locally (fresh machine) → it is pulled once, then the layer builds; a failed pull stops before any trial.
3. Certs overlay (`AGENT_CA_DIR`) set → the image is resolved with the same `-f` files as a trial, and the override comes after the certs file.
4. A second `adw e2e` with unchanged image and pins → no `docker build`, no prune.
5. A host whose npm drops `libc` (≤11.6) → `inventory.mjs check` fails on a `-musl` entry without `libc` instead of shipping a bloated image.

---

### Task 1: ACP pins move from the dev images to `e2eNpmPackages`

**Files:**
- Modify: `docker/tools/inventory.json`, `docker/tools/inventory.mjs`, `docker/tests/inventory.test.mjs`
- Create: `e2e/local/image/package.json` (seed; then derived), `e2e/local/image/package-lock.json` (derived)
- Regenerate: `docker/tools/package.json`, `docker/tools/package-lock.json`
- Modify: `e2e/tasks/demo-todo/environment/Dockerfile`, `e2e/tasks/demo-todo-dotnet/environment/Dockerfile`, `docker/README.md:25`, `e2e/local/session.test.mjs:24-29`

**Interfaces:**
- Produces: `e2e/local/image/package.json` + `package-lock.json` with exactly the three ACP pins; exported `lockfileCommand(inventory, dir, { uid, gid })` and `muslWithoutLibc(lock)` from `inventory.mjs`.

- [ ] **Step 1: Write the failing tests** in `docker/tests/inventory.test.mjs`. Add the e2e files to the fixture copy list:

```js
// The ACP layer adw e2e builds on a project's dev image (e2e/local/image), derived from e2eNpmPackages.
const e2ePackage = '../e2e/local/image/package.json';
const e2eLockfile = '../e2e/local/image/package-lock.json';
const pinnedFiles = ['Dockerfile', 'Dockerfile.dotnet', dindOverlay, skillsConfig, e2ePackage, e2eLockfile,
  'tools/inventory.json', 'tools/package.json', 'tools/package-lock.json'];
```

and the tests (import `lockfileCommand`, `muslWithoutLibc`):

```js
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
  } };
  assert.deepEqual(muslWithoutLibc(lock), ['node_modules/y-linux-x64-musl', 'node_modules/@s/z-linux-x64-musl']);
  const root = fixture(t);
  editJson(path.join(root, e2eLockfile), l => {
    l.packages['node_modules/fake-linux-x64-musl'] = { version: '1.0.0', os: ['linux'] };
  });
  assert.match(findDrift(root).join('\n'), /e2e\/local\/image\/package-lock\.json: node_modules\/fake-linux-x64-musl has no libc/);
});

test('lockfiles are generated with the base image npm, as the host user', () => {
  const inventory = { baseImage: { reference: 'node:24-bookworm-slim@sha256:abc' } };
  assert.deepEqual(lockfileCommand(inventory, '/d/tools', { uid: 1001, gid: 1002 }), ['docker', [
    'run', '--rm', '-u', '1001:1002', '-e', 'HOME=/tmp', '-v', '/d/tools:/w', '-w', '/w', '--entrypoint', 'npm',
    'node:24-bookworm-slim@sha256:abc', 'install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund']]);
});
```

Also extend `resolves the latest versions within the update policy` (around line 232): add `e2eNpmPackages: { acpx: '0.11.2' }` to its inventory, a packument for `acpx` with `dist-tags.latest: '0.12.0'` to its fake sources, and assert a change `{ name: 'acpx', path: ['e2eNpmPackages', 'acpx'], from: '0.11.2', to: '0.12.0' }`.

In `e2e/local/session.test.mjs` delete the test `the product image pins acpx and the adapters at ACP_VERSIONS` (lines 24-29) and the now unused `ACP_VERSIONS` import: Harbor's pins and ours may differ.

- [ ] **Step 2: Run, expect FAIL**

Run: `node --test docker/tests/inventory.test.mjs`
Expected: FAIL (`lockfileCommand` / `muslWithoutLibc` not exported; fixture copy of `e2e/local/image/package.json` fails with ENOENT).

- [ ] **Step 3: Implement**

`docker/tools/inventory.json`: move the three ACP entries from `npmPackages` into a new top-level group after it:

```json
  "e2eNpmPackages": {
    "@agentclientprotocol/codex-acp": "1.12.0",
    "@zed-industries/claude-code-acp": "0.16.2",
    "acpx": "0.11.2"
  },
```

Seed `e2e/local/image/package.json`:

```json
{
  "name": "adw-e2e-layer",
  "private": true,
  "description": "Pinned ACP tooling adw e2e layers on a project's dev image (derived from docker/tools/inventory.json e2eNpmPackages)",
  "license": "UNLICENSED",
  "dependencies": {}
}
```

`docker/tools/inventory.mjs`:

```js
const E2E_PACKAGE_JSON = '../e2e/local/image/package.json';
const E2E_LOCKFILE = '../e2e/local/image/package-lock.json';
const DERIVED_FILES = [PACKAGE_JSON, E2E_PACKAGE_JSON, 'Dockerfile', 'Dockerfile.dotnet', DIND_OVERLAY, SKILLS_CONFIG];
// Each npm group and the package.json + lockfile derived from it.
const NPM_GROUPS = [
  { key: 'npmPackages', manifest: PACKAGE_JSON, lockfile: LOCKFILE },
  { key: 'e2eNpmPackages', manifest: E2E_PACKAGE_JSON, lockfile: E2E_LOCKFILE },
];
```

In `renderDerivedFiles`, render every group's manifest:

```js
  const rendered = {};
  for (const { key, manifest } of NPM_GROUPS) {
    const value = JSON.parse(current[manifest]);
    value.dependencies = sorted(inventory[key]);
    rendered[manifest] = toJson(value);
  }
```

Generalize `lockfileDrift(inventory, lock)` to `lockfileDrift(packages, lock, lockfile)` (root deps + resolved versions against `packages`, messages prefixed with `lockfile`), keep the `npmFollowDependency` check in a separate `followerDrift(inventory, lock)` for `npmPackages` only, and add:

```js
// npm before 11.7 drops `libc` from the lockfile, so `npm ci` also installs musl binaries.
export function muslWithoutLibc(lock) {
  return Object.entries(lock.packages ?? {})
    .filter(([key, entry]) => /-musl$/.test(key) && !entry.libc)
    .map(([key]) => key);
}
```

`findDrift` returns `[...drift, ...NPM_GROUPS.flatMap(({ key, lockfile }) => { const lock = JSON.parse(read(dir, lockfile)); return [...lockfileDrift(inventory[key], lock, lockfile), ...muslWithoutLibc(lock).map(k => `${lockfile}: ${k} has no libc (regenerate with node docker/tools/inventory.mjs sync)`)]; }), ...followerDrift(inventory, JSON.parse(read(dir, LOCKFILE)))]`.

Replace the host `npm()` helper with:

```js
// The base image's npm, not the host's: an older npm drops the libc fields (see muslWithoutLibc).
export function lockfileCommand(inventory, dir, { uid, gid }) {
  return ['docker', ['run', '--rm', '-u', `${uid}:${gid}`, '-e', 'HOME=/tmp', '-v', `${dir}:/w`, '-w', '/w', '--entrypoint', 'npm',
    inventory.baseImage.reference, 'install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund']];
}

function generateLockfile(inventory, dir) {
  const [cmd, args] = lockfileCommand(inventory, dir, { uid: process.getuid?.() ?? 1000, gid: process.getgid?.() ?? 1000 });
  const result = spawnSync(cmd, args, { stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`npm install --package-lock-only in ${dir} failed with exit code ${result.status}`);
}
```

`syncDerivedFiles` loops over `NPM_GROUPS`: for each, stale when the lock's root dependencies differ from `inventory[key]`; with `freshLockfile` remove the lockfile first (`rmSync(..., { force: true })`); regenerate with `generateLockfile(inventory, path.dirname(path.join(dir, lockfile)))`; push `lockfile` to `changed`. A missing e2e lockfile counts as stale (read it with a fallback `{}`).

`resolveUpdates`: run the existing latest/hold loop over `{ ...inventory.npmPackages, ...inventory.e2eNpmPackages }` with the key path `[group, name]` of the group that holds the name. `inventoryNames` adds `...Object.keys(inventory.e2eNpmPackages ?? {})`. `applyChanges` already follows `change.path`.

- [ ] **Step 4: Derive and run**

Run: `node docker/tools/inventory.mjs sync && node docker/tools/inventory.mjs check`
Expected: rewrites `tools/package.json`, `tools/package-lock.json`, `../e2e/local/image/package.json`, `../e2e/local/image/package-lock.json`; then "Tool pins are in sync". Then `git diff origin/main -- docker/tools/package.json` shows no ACP packages, and `grep -c '"libc"' e2e/local/image/package-lock.json` is > 0.

Run: `node --test docker/tests/inventory.test.mjs e2e/local/session.test.mjs`
Expected: PASS.

- [ ] **Step 5: Harbor task images and docker README**

In both `e2e/tasks/demo-todo/environment/Dockerfile` and `e2e/tasks/demo-todo-dotnet/environment/Dockerfile`, restore `main`'s header and preinstall (`git show origin/main:<path>` shows it):

```dockerfile
# E2E task image: the workflow image plus E2E-only tooling. The product image stays unchanged.
FROM ai-dev-workflow-node:latest
# Harbor npm-installs its ACP bridge/adapters as the agent user at runtime: preinstall the
# versions Harbor 0.24.0 pins and let the agent user own the global prefix.
RUN npm install -g acpx@0.11.2 @zed-industries/claude-code-acp@0.16.2 @agentclientprotocol/codex-acp@1.12.0 \
    && chown -R 1000:1000 /usr/local/lib/node_modules /usr/local/bin \
    && mkdir -p /workspace /opt/e2e && chown 1000:1000 /workspace
```

(keep each file's own `FROM` line; the dotnet task uses its own base). In `docker/README.md:25` drop "`acpx` with the Claude Code and Codex ACP adapters, " from the base image's list.

- [ ] **Step 6: Full tests and commit**

Run: `npm test` → PASS.

```bash
git add docker/tools docker/tests/inventory.test.mjs docker/README.md e2e/local/image e2e/tasks/demo-todo/environment/Dockerfile \
  e2e/tasks/demo-todo-dotnet/environment/Dockerfile e2e/local/session.test.mjs
git commit -m "feat(docker): ACP tooling becomes e2e-only pins (e2eNpmPackages); lockfiles from the base image npm"
```

### Task 2: `e2e/local/image.mjs` builds the layer

**Files:**
- Create: `e2e/local/image/Dockerfile`, `e2e/local/image.mjs`, `e2e/local/image.test.mjs`
- Modify: `package.json` (`files`), `e2e/local/package.test.mjs`

**Interfaces:**
- Consumes: `e2e/local/image/package.json`, `package-lock.json` (Task 1).
- Produces: `ensureE2eImage({ root, runDir, composeFiles, env, exec, log, imageDir? }) -> { image: string, imageId: string, tag: string, overrideFile: string }`; `layerTag(baseId, dockerfile, lockfile) -> string`; `overrideYaml(tag) -> string`. Throws `Error` on any failed docker step.

- [ ] **Step 1: Write the failing tests** `e2e/local/image.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ensureE2eImage, layerTag, overrideYaml } from './image.mjs';

const BASE_ID = 'sha256:1111';

// A layer dir and run dir; `docker` answers each argv (first match wins), everything else succeeds empty.
function setup(t, answers = []) {
  const dir = mkdtempSync(path.join(tmpdir(), 'adw-image-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const imageDir = path.join(dir, 'image');
  mkdirSync(imageDir);
  writeFileSync(path.join(imageDir, 'Dockerfile'), 'FROM x\n');
  writeFileSync(path.join(imageDir, 'package-lock.json'), '{}\n');
  const calls = []; const logs = [];
  const exec = (cmd, args, opts = {}) => {
    calls.push({ cmd, args, opts });
    const hit = answers.find(([match]) => match(args));
    return hit ? hit[1] : { status: 0, stdout: '', stderr: '' };
  };
  const tag = layerTag(BASE_ID, 'FROM x\n', '{}\n');
  const opts = { root: '/proj', runDir: path.join(dir, 'run'), composeFiles: ['/proj/compose.ai-dev.yml'], env: { PROJECT_ROOT: '/proj' },
    exec, log: (s) => logs.push(s), imageDir };
  return { calls, logs, opts, tag };
}

const is = (...parts) => (args) => parts.every((p, i) => args[i] === p);
const has = (part) => (args) => args.includes(part);
const configJson = (service) => ({ status: 0, stdout: JSON.stringify({ services: { 'ai-dev-workflow': service } }) });
const images = (ref) => [[has('--images'), { status: 0, stdout: `${ref}\n` }]];
const baseInspect = (ref) => [(a) => is('image', 'inspect')(a) && a.at(-1) === ref, { status: 0, stdout: `${BASE_ID}\n` }];
const layerMissing = [(a) => is('image', 'inspect')(a) && a.at(-1).startsWith('adw-e2e:'), { status: 1, stdout: '', stderr: 'No such image' }];

test('layerTag is stable and changes with the base image or the lockfile', () => {
  const tag = layerTag('sha256:a', 'D', 'L');
  assert.match(tag, /^adw-e2e:[0-9a-f]{12}$/);
  assert.equal(layerTag('sha256:a', 'D', 'L'), tag);
  assert.notEqual(layerTag('sha256:b', 'D', 'L'), tag);
  assert.notEqual(layerTag('sha256:a', 'D', 'L2'), tag);
});

test('builds the layer on the compose image, labels it, prunes older ones and writes the override', (t) => {
  const ref = 'marxx/ai-dev-workflow:node-latest';
  const { calls, logs, opts, tag } = setup(t, [
    [has('--format'), configJson({ image: ref })], ...images(ref), baseInspect(ref), layerMissing,
    [is('image', 'ls'), { status: 0, stdout: `${tag}\nadw-e2e:000000000000\n` }],
  ]);
  const out = ensureE2eImage(opts);
  assert.deepEqual(out, { image: ref, imageId: BASE_ID, tag, overrideFile: path.join(opts.runDir, 'compose.adw-e2e.yml') });
  const build = calls.find((c) => c.args[0] === 'build');
  assert.deepEqual(build.args, ['build', '--build-arg', `BASE_IMAGE=${BASE_ID}`, '--label', 'adw.e2e.root=/proj', '-t', tag, opts.imageDir]);
  assert.equal(build.opts.stdio, 'inherit');
  assert.ok(logs.some((l) => l.includes(`building the e2e layer on ${ref}`)));
  assert.deepEqual(calls.find((c) => is('image', 'ls')(c.args)).args, ['image', 'ls', '--filter', 'label=adw.e2e.root=/proj', '--format', '{{.Repository}}:{{.Tag}}']);
  assert.deepEqual(calls.filter((c) => is('image', 'rm')(c.args)).map((c) => c.args), [['image', 'rm', 'adw-e2e:000000000000']]);
  assert.equal(readFileSync(out.overrideFile, 'utf8'), overrideYaml(tag));
  assert.ok(!calls.some((c) => c.args[0] === 'pull'), 'present locally: no pull');
});

test('skips build and prune when the layer exists', (t) => {
  const ref = 'img:1';
  const { calls, opts } = setup(t, [[has('--format'), configJson({ image: ref })], ...images(ref), baseInspect(ref)]);
  ensureE2eImage(opts);
  assert.ok(!calls.some((c) => c.args[0] === 'build' || is('image', 'ls')(c.args)));
});

test('a compose build: section is built first and its image is the base', (t) => {
  const ref = 'adw-e2e-image-ai-dev-workflow';
  const { calls, opts } = setup(t, [
    [has('--format'), configJson({ build: { context: '/proj' } })], ...images(ref), baseInspect(ref), layerMissing,
  ]);
  ensureE2eImage(opts);
  const i = calls.findIndex((c) => c.args.includes('build') && c.args.includes('ai-dev-workflow') && c.args[0] === 'compose');
  assert.ok(i >= 0, 'compose build ai-dev-workflow');
  assert.ok(i < calls.findIndex((c) => c.args[0] === 'build'), 'before the layer build');
});

test('pulls the base image only when it is missing', (t) => {
  const ref = 'img:2';
  let pulled = false;
  const { calls, opts } = setup(t, [
    [has('--format'), configJson({ image: ref })], ...images(ref),
    [(a) => is('pull')(a), { status: 0, stdout: '' }],
    [(a) => is('image', 'inspect')(a) && a.at(-1) === ref && !pulled && (pulled = true), { status: 1, stdout: '', stderr: 'No such image' }],
    baseInspect(ref), layerMissing,
  ]);
  ensureE2eImage(opts);
  assert.deepEqual(calls.find((c) => c.args[0] === 'pull').args, ['pull', ref]);
});

test('every compose call uses the given files, so the certs overlay is honoured', (t) => {
  const ref = 'img:3';
  const { calls, opts } = setup(t, [[has('--format'), configJson({ image: ref })], ...images(ref), baseInspect(ref)]);
  ensureE2eImage({ ...opts, composeFiles: ['/proj/compose.ai-dev.yml', '/proj/compose.ai-dev.certs.yml'] });
  for (const c of calls.filter((x) => x.args[0] === 'compose')) {
    assert.deepEqual(c.args.slice(0, 5), ['compose', '-f', '/proj/compose.ai-dev.yml', '-f', '/proj/compose.ai-dev.certs.yml']);
    assert.equal(c.opts.env.PROJECT_ROOT, '/proj');
  }
});

test('a failed build throws before any override is written', (t) => {
  const ref = 'img:4';
  const { opts } = setup(t, [
    [has('--format'), configJson({ image: ref })], ...images(ref), baseInspect(ref), layerMissing,
    [is('build'), { status: 1, stdout: null, stderr: null }],
  ]);
  assert.throws(() => ensureE2eImage(opts), /docker build failed \(exit 1\)/);
});

test('overrideYaml replaces the image and drops the build section', () => {
  assert.equal(overrideYaml('adw-e2e:abc'), [
    '# Written by adw e2e: the agent runs on the e2e layer over the project\'s dev image.',
    'services:', '  ai-dev-workflow:', '    image: adw-e2e:abc', '    pull_policy: never', '    build: !reset null', '',
  ].join('\n'));
});
```

In `e2e/local/package.test.mjs` extend `ships the runtime data e2e/local reads`:

```js
  for (const f of ['e2e/local/image/Dockerfile', 'e2e/local/image/package.json', 'e2e/local/image/package-lock.json']) assert.ok(files.includes(f), f);
```

- [ ] **Step 2: Run, expect FAIL**

Run: `node --test e2e/local/image.test.mjs e2e/local/package.test.mjs`
Expected: FAIL (`Cannot find module './image.mjs'`; Dockerfile missing from `files`).

- [ ] **Step 3: Implement**

`e2e/local/image/Dockerfile`:

```dockerfile
# adw e2e: the project's dev image plus the pinned ACP tooling that drives the agent under test.
# Built by e2e/local/image.mjs; package.json and the lockfile derive from docker/tools/inventory.json.
ARG BASE_IMAGE
FROM ${BASE_IMAGE}
COPY package.json package-lock.json /opt/adw-e2e/
RUN npm ci --prefix /opt/adw-e2e --omit=dev --no-audit --no-fund \
    && ln -s /opt/adw-e2e/node_modules/.bin/acpx /opt/adw-e2e/node_modules/.bin/claude-code-acp \
       /opt/adw-e2e/node_modules/.bin/codex-acp /usr/local/bin/
```

`e2e/local/image.mjs`:

```js
// The agent under test runs on the project's own dev image plus a thin layer with acpx and the ACP adapters
// (e2e/local/image). Built once per adw e2e call when its tag is missing; the project's older layers are pruned.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const IMAGE_DIR = fileURLToPath(new URL('./image', import.meta.url));
const SERVICE = 'ai-dev-workflow';
const LABEL = 'adw.e2e.root';

export function layerTag(baseId, dockerfile, lockfile) {
  const hash = createHash('sha256').update(`${baseId}\n${dockerfile}\n${lockfile}`).digest('hex');
  return `adw-e2e:${hash.slice(0, 12)}`;
}

export const overrideYaml = (tag) => [
  '# Written by adw e2e: the agent runs on the e2e layer over the project\'s dev image.',
  'services:', `  ${SERVICE}:`, `    image: ${tag}`, '    pull_policy: never', '    build: !reset null', '',
].join('\n');

// `composeFiles` and `env` are a trial's (compose.ai-dev.yml, the certs overlay when set; composeEnv).
export function ensureE2eImage({ root, runDir, composeFiles, env, exec, log, imageDir = IMAGE_DIR }) {
  // Streamed steps (stdio inherit) have no stderr to quote: their output is already on the terminal.
  const docker = (args, opts = {}) => {
    const r = exec('docker', args, opts);
    if (r.error) throw r.error;
    if (r.status !== 0) {
      const step = args[0] === 'compose' ? `compose ${args[args.indexOf('-p') + 2]}` : args[0];
      const detail = String(r.stderr ?? '').trim().slice(-500) || 'see the output above';
      throw new Error(`docker ${step} failed (exit ${r.status}): ${detail}`);
    }
    return String(r.stdout ?? '');
  };
  const compose = ['compose', ...composeFiles.flatMap((f) => ['-f', f]), '-p', 'adw-e2e-image'];
  const service = JSON.parse(docker([...compose, 'config', '--format', 'json'], { env })).services?.[SERVICE];
  if (!service) throw new Error(`${composeFiles[0]} has no ${SERVICE} service`);
  if (service.build) docker([...compose, 'build', SERVICE], { env, stdio: 'inherit' });
  const image = docker([...compose, 'config', '--images', SERVICE], { env }).trim().split('\n')[0];
  const inspect = () => exec('docker', ['image', 'inspect', '--format', '{{.Id}}', image]);
  let found = inspect();
  if (found.status !== 0) {
    docker(['pull', image], { stdio: 'inherit' });
    found = inspect();
    if (found.status !== 0) throw new Error(`${image}: not found after pull`);
  }
  const imageId = String(found.stdout ?? '').trim();
  const tag = layerTag(imageId, readFileSync(path.join(imageDir, 'Dockerfile'), 'utf8'),
    readFileSync(path.join(imageDir, 'package-lock.json'), 'utf8'));
  if (exec('docker', ['image', 'inspect', '--format', '{{.Id}}', tag]).status !== 0) {
    log(`building the e2e layer on ${image}`);
    docker(['build', '--build-arg', `BASE_IMAGE=${imageId}`, '--label', `${LABEL}=${root}`, '-t', tag, imageDir], { stdio: 'inherit' });
    const old = docker(['image', 'ls', '--filter', `label=${LABEL}=${root}`, '--format', '{{.Repository}}:{{.Tag}}']);
    // An image still in use stays; the next build tries again.
    for (const ref of old.split('\n').map((s) => s.trim()).filter((s) => s && s !== tag)) exec('docker', ['image', 'rm', ref]);
  }
  mkdirSync(runDir, { recursive: true });
  const overrideFile = path.join(runDir, 'compose.adw-e2e.yml');
  writeFileSync(overrideFile, overrideYaml(tag));
  return { image, imageId, tag, overrideFile };
}
```

`package.json` `files`, after `"e2e/local/defaults.json",`:

```json
    "e2e/local/image.mjs",
    "e2e/local/image/Dockerfile",
    "e2e/local/image/package.json",
    "e2e/local/image/package-lock.json",
```

- [ ] **Step 4: Run, expect PASS**

Run: `node --test e2e/local/image.test.mjs e2e/local/package.test.mjs` → PASS (the import-closure test passes once Task 3 imports `image.mjs` too; it already passes now since `files` lists it).

- [ ] **Step 5: Real build smoke check**

Run (needs Docker):

```bash
docker build --build-arg BASE_IMAGE=ai-dev-workflow-node:latest -t adw-e2e:smoke e2e/local/image \
  && docker run --rm --entrypoint sh adw-e2e:smoke -c 'acpx --version && command -v claude-code-acp codex-acp' \
  && docker image rm adw-e2e:smoke
```

Expected: `0.11.2` and two paths under `/usr/local/bin`.

- [ ] **Step 6: Commit**

```bash
git add e2e/local/image.mjs e2e/local/image.test.mjs e2e/local/image/Dockerfile e2e/local/package.test.mjs package.json
git commit -m "feat(e2e-local): build the ACP layer on the project's dev image"
```

### Task 3: `adw e2e` runs the agent on the layer

**Files:**
- Modify: `e2e/local/session.mjs:136-186`, `e2e/local/session.test.mjs`, `e2e/local/cli.mjs` (`DEFAULT_DEPS`, `runE2e`, remove `imageOf`), `e2e/local/cli.test.mjs`, `e2e/local/record.mjs:53-62`, `e2e/local/record.test.mjs`

**Interfaces:**
- Consumes: `ensureE2eImage(...)` from Task 2.
- Produces: `startSession({ ..., overrideFile = null })`; `localFingerprint({ ..., e2eImage = null })` → `image: { ref, id, e2e }`.

- [ ] **Step 1: Write the failing tests**

`e2e/local/session.test.mjs`:

```js
test('startSession adds the e2e override as the last compose file', () => {
  const { dir, root, work, creds } = fixture();
  try {
    const { calls, exec } = recorder();
    startSession({ root, work, harness: 'opencode', model: null, project: 'p1', creds, exec, env: { AGENT_CA_DIR: '/ca' },
      overrideFile: '/run/compose.adw-e2e.yml' });
    assert.deepEqual(calls[0].args.slice(0, 9), ['compose', '-f', path.join(root, 'compose.ai-dev.yml'),
      '-f', path.join(root, 'compose.ai-dev.certs.yml'), '-f', '/run/compose.adw-e2e.yml', '-p', 'p1']);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
```

`e2e/local/cli.test.mjs`: in `stubs()` add to `deps`

```js
    ensureE2eImage: rec('image', (a) => { seen.image = a; return { image: 'img:1', imageId: 'sha256:1', tag: 'adw-e2e:abc', overrideFile: '/run/o.yml' }; }),
```

and the tests:

```js
test('the e2e layer is ensured once, before the first sandbox, and the session gets its override', async () => {
  const root = project();
  const { deps, calls, seen } = stubs(root);
  await runE2e(opts(root, { repetitions: 2 }), deps);
  assert.equal(calls.filter((c) => c === 'image').length, 1);
  assert.ok(calls.indexOf('image') < calls.indexOf('sandbox'));
  assert.equal(seen.session.overrideFile, '/run/o.yml');
  assert.deepEqual(seen.image.composeFiles, [path.join(root, 'compose.ai-dev.yml')]);
  assert.equal(seen.image.root, root);
});

test('a failed layer build stops before any trial', async () => {
  const root = project();
  const { deps, calls, out } = stubs(root, { ensureE2eImage: () => { throw new Error('docker build failed (exit 1): see the output above'); } });
  assert.equal(await runE2e(opts(root), deps), 1);
  assert.ok(!calls.includes('sandbox'));
  assert.ok(out.some((l) => l.includes('docker build failed')));
});

test('run.json records the base image and the e2e layer', async () => {
  const root = project();
  const { deps } = stubs(root);
  await runE2e(opts(root), deps);
  const runDir = path.join(root, '.adw/e2e/7/runs/2026-10-19T1000Z/claude-code');
  const run = JSON.parse(readFileSync(path.join(runDir, 'run.json'), 'utf8'));
  assert.deepEqual(run.fingerprint.image, { ref: 'img:1', id: 'sha256:1', e2e: 'adw-e2e:abc' });
});
```

(Adjust the `.adw/e2e/7/...` path to what `ticketDir`/`newRunDir` produce if an existing cli test already computes it; reuse that helper.) In `e2e/local/record.test.mjs`, where `localFingerprint` is asserted, pass `e2eImage: 'adw-e2e:abc'` and expect `image: { ref, id, e2e: 'adw-e2e:abc' }`.

- [ ] **Step 2: Run, expect FAIL**

Run: `node --test e2e/local/session.test.mjs e2e/local/cli.test.mjs e2e/local/record.test.mjs`
Expected: FAIL (no override in the compose args; `image` never called; `e2e` missing).

- [ ] **Step 3: Implement**

`session.mjs` `startSession`: add `overrideFile = null` to the parameters and

```js
  const compose = ['compose', '-f', path.join(root, 'compose.ai-dev.yml'),
    ...(cenv.AGENT_CA_DIR ? ['-f', path.join(root, 'compose.ai-dev.certs.yml')] : []),
    ...(overrideFile ? ['-f', overrideFile] : []), '-p', project];
```

Replace the `acpx sessions ensure` catch hint with plain `inAgent(['acpx', 'sessions', 'ensure'], { cwd: true });` (the layer provides acpx), and update the file's header comment: "on the project's dev image plus the e2e layer (image.mjs)".

`cli.mjs`: `import { ensureE2eImage } from './image.mjs';`, add `ensureE2eImage` to `DEFAULT_DEPS`. In `runE2e`, first statement inside the outer `try`:

```js
    const rootEnv = composeEnv({ root, work: root, env: d.env, uid: d.uid, gid: d.gid });
    const layer = d.ensureE2eImage({ root, runDir, composeFiles: [composeFile, ...(rootEnv.AGENT_CA_DIR ? [certsFile] : [])],
      env: rootEnv, exec: d.exec, log: d.log });
```

pass `overrideFile: layer.overrideFile` to `d.startSession(...)`, and build the fingerprint with `localFingerprint({ image: layer.image, imageId: layer.imageId, e2eImage: layer.tag, cliVersions, ... })`. Delete `imageOf`.

`record.mjs` `localFingerprint`: add `e2eImage = null` to the parameters; `image: { ref: image, id: imageId, e2e: e2eImage }`.

- [ ] **Step 4: Run, expect PASS**

Run: `npm test` → PASS.

- [ ] **Step 5: Commit**

```bash
git add e2e/local/session.mjs e2e/local/session.test.mjs e2e/local/cli.mjs e2e/local/cli.test.mjs e2e/local/record.mjs e2e/local/record.test.mjs
git commit -m "feat(e2e-local): the agent session runs on the e2e layer"
```

### Task 4: Docs

**Files:**
- Modify: `README.md:307`, `AGENTS.md:79-83`, `.claude/skills/dependency-update-check/SKILL.md` (description and where it lists the inventory groups)

No tests (prose only).

- [ ] **Step 1: README** — replace the prerequisite

```markdown
- the container files from `init` (`compose.ai-dev.yml`), and an ai-dev image that includes `acpx`;
```

with

```markdown
- the container files from `init` (`compose.ai-dev.yml`). The first run builds a thin layer with `acpx` and the ACP
  adapters on your dev image (about 480 MB, cached until the image or the pins change; older layers are removed);
```

- [ ] **Step 2: AGENTS.md** — in the `e2e/local/` bullet replace "through the project's ai-dev container (`acpx`)" with "through the project's ai-dev container plus a locally built layer with `acpx` (`image.mjs`, `e2e/local/image/`; its pins derive from `inventory.json` `e2eNpmPackages`)". In the "Container images" section add `e2e/local/image/package.json` and its lockfile to the list of derived files.

- [ ] **Step 3: dependency-update-check** — add "the ACP tooling adw e2e layers on a project image (`e2eNpmPackages`)" to the description's list, and wherever the body enumerates inventory groups, add `e2eNpmPackages` with: an update needs `node docker/tools/inventory.mjs sync`, then `npm test`; no dev image rebuild.

- [ ] **Step 4: Verify and commit**

Run: `npm pack --dry-run 2>&1 | grep e2e/local/image` → the Dockerfile, package.json, package-lock.json and `image.mjs`.

```bash
git add README.md AGENTS.md .claude/skills/dependency-update-check/SKILL.md
git commit -m "docs: adw e2e builds its ACP layer on the project's dev image"
```

### Task 5: Acceptance run on dursthelfer (manual, in the user's terminal)

Not code. The spec's E2E acceptance; the human runs it because the first run is interactive.

- [ ] **Step 1: Prepare dursthelfer** (`/home/ai/src/dursthelfer`, not committed until the run succeeds): add to `ai-project.json`

```json
  "e2e": {
    "agent": { "harness": "claude-code", "model": "claude-opus-5-5" },
    "env": ["CLAUDE_CODE_EFFORT_LEVEL"]
  }
```

and write the ticket file without the reference to the spec that only exists on the feature branch:

```bash
gh issue view 510 -R marxxxx/dursthelfer --json title,body \
  --jq '"# " + .title + "\n\n" + (.body | sub(" Approved spec: [^ ]+\\.md\\.?"; ""))' > /tmp/dursthelfer-510.md
```

- [ ] **Step 2: Run** (user's terminal, after `claude setup-token`):

```bash
export CLAUDE_CODE_OAUTH_TOKEN=<token> CLAUDE_CODE_EFFORT_LEVEL=medium
node ~/src/ai-dev-workflow/agent-src/generate.mjs e2e d531913 510 claude-code \
  --ticket-file /tmp/dursthelfer-510.md --root ~/src/dursthelfer
```

Expected: "building the e2e layer on marxx/ai-dev-workflow:node-latest", one trial, a summary with `results: …/.adw/e2e/510/runs/<ts>/claude-code`, and `run.json` `fingerprint.image.e2e` set. A second invocation shows no build line.

- [ ] **Step 3: Record** — commit `.adw/e2e/510/{ticket.md,answers.json,acceptance.md}` and the `ai-project.json` `e2e` block in dursthelfer; report the result (reward, contract, acceptance, tokens/cost) here.
