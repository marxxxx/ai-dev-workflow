import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
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
  assert.match(warning, /target: \/workspace\/apps\/web\/node_modules/);
  assert.match(warning, /source: deps-apps-web/);
});

test('stays silent once the node_modules is masked by a mount', t => {
  const root = fixture(t);
  tree(root, { 'apps/web/node_modules/@esbuild/win32-x64/pkg.json': '' });
  const mounts = [path.join(root, 'apps', 'web', 'node_modules')];
  assert.deepEqual(findHostArtifacts({ root, mounts }), []);
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
  tree(root, { 'package.json': '{}', 'bin/cli.js': '' });
  assert.deepEqual(findHostArtifacts({ root }), []);
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
