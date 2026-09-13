import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { findHostArtifacts } from '../check-host-artifacts.mjs';

function fixture(t) {
  const root = mkdtempSync(path.join(tmpdir(), 'host artifacts '));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function tree(root, files) {
  for (const [relative, content] of Object.entries(files)) {
    const full = path.join(root, relative);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
}

test('warns about an unmasked node_modules holding host packages', t => {
  const root = fixture(t);
  tree(root, {
    'package.json': '{}',
    'apps/web/node_modules/@rollup/rollup-win32-x64-msvc/index.js': '',
    'apps/web/node_modules/react/index.js': '',
  });
  const [warning, ...rest] = findHostArtifacts({ root });
  assert.deepEqual(rest, []);
  assert.match(warning, /apps\/web\/node_modules/);
  assert.match(warning, /@rollup\/rollup-win32-x64-msvc/);
  assert.match(warning, /target: "\/workspace\/apps\/web\/node_modules"/);
  assert.match(warning, /source: deps-apps-web/);
});

test('stays silent once the node_modules is masked by a mount', t => {
  const root = fixture(t);
  tree(root, { 'apps/web/node_modules/@esbuild/win32-x64/pkg.json': '' });
  const mounts = [path.join(root, 'apps', 'web', 'node_modules')];
  assert.deepEqual(findHostArtifacts({ root, mounts }), []);
});

test('stays silent when a mount at the parent directory masks node_modules', t => {
  const root = fixture(t);
  tree(root, { 'apps/web/node_modules/@esbuild/win32-x64/pkg.json': '' });
  // The mount is the node_modules' parent, not the node_modules itself — exercises the
  // ancestor branch of masked() rather than the exact-match branch covered above.
  const mounts = [path.join(root, 'apps', 'web')];
  assert.deepEqual(findHostArtifacts({ root, mounts }), []);
});

test('treats a pnpm-style symlinked scoped package as a host trace', t => {
  const root = fixture(t);
  const store = path.join(root, '.pnpm-store', 'esbuild-darwin-arm64');
  mkdirSync(store, { recursive: true });
  writeFileSync(path.join(store, 'pkg.json'), '');
  mkdirSync(path.join(root, 'node_modules', '@esbuild'), { recursive: true });
  const link = path.join(root, 'node_modules', '@esbuild', 'darwin-arm64');
  let symlinked = true;
  try {
    symlinkSync(store, link, 'dir');
  } catch {
    // No privilege to create directory symlinks on this host (see the fix report) — cover
    // the same code path with a plain directory instead.
    symlinked = false;
    mkdirSync(link);
    writeFileSync(path.join(link, 'pkg.json'), '');
  }
  if (!symlinked) t.diagnostic('directory symlinks unavailable on this host; used a plain directory instead');
  const [warning, ...rest] = findHostArtifacts({ root });
  assert.deepEqual(rest, []);
  assert.match(warning, /@esbuild\/darwin-arm64/);
});

test('treats Windows command shims as host traces and Linux trees as clean', t => {
  const shims = fixture(t);
  tree(shims, { 'node_modules/.bin/tsc.cmd': '', 'node_modules/typescript/index.js': '' });
  assert.match(findHostArtifacts({ root: shims })[0], /\.bin[\\/]tsc\.cmd/);
  assert.match(findHostArtifacts({ root: shims })[0], /source: deps-root/);

  const linux = fixture(t);
  tree(linux, {
    'node_modules/.bin/tsc': '',
    'node_modules/@esbuild/linux-x64/pkg.json': '',
    'node_modules/darwinia/index.js': '',
  });
  assert.deepEqual(findHostArtifacts({ root: linux }), []);
});

test('warns about in-tree .NET output only without a redirect', t => {
  const root = fixture(t);
  tree(root, {
    'src/App/App.csproj': '<Project />',
    'src/App/obj/project.assets.json': '{}',
    'src/App/bin/Debug/App.dll': '',
  });
  const [warning] = findHostArtifacts({ root });
  assert.match(warning, /src[\\/]App[\\/]obj/);
  assert.match(warning, /ArtifactsPath/);
  assert.deepEqual(findHostArtifacts({ root, artifactsPath: '/home/dev/artifacts' }), []);
});

test('ignores bin directories without a .NET project', t => {
  const root = fixture(t);
  tree(root, {
    'package.json': '{}',
    'bin/cli.js': '',
    // A project file elsewhere in the tree must not make this unrelated bin/ suspect.
    'lib/Tool.csproj': '<Project />',
  });
  assert.deepEqual(findHostArtifacts({ root }), []);
});

test('only warns about .NET output that shares a directory with the project file', t => {
  const root = fixture(t);
  tree(root, {
    'cli-tool/bin/run.js': '',
    'services/api/Api.csproj': '<Project />',
    'services/api/obj/project.assets.json': '{}',
  });
  const [warning, ...rest] = findHostArtifacts({ root });
  assert.deepEqual(rest, []);
  assert.match(warning, /services[\\/]api[\\/]obj/);
  assert.doesNotMatch(warning, /cli-tool[\\/]bin/);
});

test('does not descend into node_modules, .git or build output', t => {
  const root = fixture(t);
  tree(root, {
    'node_modules/pkg/node_modules/@esbuild/win32-x64/pkg.json': '',
    '.git/modules/x/node_modules/@esbuild/win32-x64/pkg.json': '',
    'obj/node_modules/@esbuild/win32-x64/pkg.json': '',
  });
  // The outer node_modules is clean; nothing below it or below .git/obj is reported.
  assert.deepEqual(findHostArtifacts({ root }), []);
});

test('tolerates a missing root', () => {
  assert.deepEqual(findHostArtifacts({ root: path.join(tmpdir(), 'does-not-exist-91237') }), []);
});

test('a solution file next to bin/ is not mistaken for a .NET project', t => {
  const root = fixture(t);
  tree(root, {
    'App.sln': '',
    'bin/cli.js': '',
  });
  assert.deepEqual(findHostArtifacts({ root }), []);
});

test('honours a mount that masks in-tree .NET output', t => {
  const root = fixture(t);
  tree(root, {
    'src/App/App.csproj': '<Project />',
    'src/App/obj/project.assets.json': '{}',
  });
  // The remedy for rule (a) — a named volume mounted on the output directory — must also
  // satisfy rule (b): a masked obj/ is not "shared with the host" any more.
  const mounts = [path.join(root, 'src', 'App', 'obj')];
  assert.deepEqual(findHostArtifacts({ root, mounts }), []);
});

test('lists only the unmasked half of a project with mixed bin/obj masking', t => {
  const root = fixture(t);
  tree(root, {
    'src/App/App.csproj': '<Project />',
    'src/App/obj/project.assets.json': '{}',
    'src/App/bin/Debug/App.dll': '',
  });
  const mounts = [path.join(root, 'src', 'App', 'obj')];
  const [warning] = findHostArtifacts({ root, mounts });
  assert.match(warning, /src[\\/]App[\\/]bin/);
  assert.doesNotMatch(warning, /src[\\/]App[\\/]obj/);
});

test('caps rule-(a) warnings and summarises the rest', t => {
  const root = fixture(t);
  const files = {};
  for (const name of ['a', 'b', 'c', 'd', 'e']) {
    files[`apps/${name}/node_modules/@esbuild/win32-x64/pkg.json`] = '';
  }
  tree(root, files);
  const warnings = findHostArtifacts({ root });
  assert.equal(warnings.length, 4);
  assert.equal(warnings.slice(0, 3).filter(warning => /holds host-platform files/.test(warning)).length, 3);
  assert.match(warnings[3], /2 more unmasked dependency tree\(s\) found/i);
  assert.match(warnings[3], /same recipe applies/i);
});

test('detects a symlinked node_modules without descending into it', t => {
  const root = fixture(t);
  const store = path.join(root, '.store', 'real-node-modules');
  mkdirSync(path.join(store, '@esbuild', 'win32-x64'), { recursive: true });
  writeFileSync(path.join(store, '@esbuild', 'win32-x64', 'pkg.json'), '');
  mkdirSync(path.join(root, 'apps', 'web'), { recursive: true });
  const link = path.join(root, 'apps', 'web', 'node_modules');
  let symlinked = true;
  try {
    symlinkSync(store, link, 'dir');
  } catch {
    // No privilege to create directory symlinks on this host (see the fix report) — cover
    // the same code path with a plain directory instead, as the pnpm-scoped-package test
    // above does.
    symlinked = false;
    mkdirSync(path.join(link, '@esbuild', 'win32-x64'), { recursive: true });
    writeFileSync(path.join(link, '@esbuild', 'win32-x64', 'pkg.json'), '');
  }
  if (!symlinked) t.diagnostic('directory symlinks unavailable on this host; used a plain directory instead');
  const [warning, ...rest] = findHostArtifacts({ root });
  assert.deepEqual(rest, []);
  assert.match(warning, /apps\/web\/node_modules/);
  assert.match(warning, /@esbuild\/win32-x64/);
});

test('quotes the target path when it contains YAML-breaking characters', t => {
  const root = fixture(t);
  // ": " isn't a legal Windows path segment, so use another sequence an unquoted YAML plain
  // scalar chokes on just the same: a space followed by "#" opens a comment mid-line.
  tree(root, { 'apps/My App #2/node_modules/@esbuild/win32-x64/pkg.json': '' });
  const [warning] = findHostArtifacts({ root });
  assert.match(warning, /target: "\/workspace\/apps\/My App #2\/node_modules"/);
});
