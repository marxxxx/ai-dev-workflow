import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { outputHasVersion, runChecks, versionChecks } from '../tools/verify-versions.mjs';

const inventory = JSON.parse(readFileSync(fileURLToPath(new URL('../tools/inventory.json', import.meta.url)), 'utf8'));

test('matches a version as a whole token in command output', () => {
  assert.ok(outputHasVersion('2.1.268 (Claude Code)', '2.1.268'));
  assert.ok(outputHasVersion('v24.21.0\n', '24.21.0'));
  assert.ok(outputHasVersion('Version 7.0.2', '7.0.2'));
  assert.ok(outputHasVersion('uv 0.12.13 (x86_64-unknown-linux-gnu)', '0.12.13'));
  assert.ok(outputHasVersion('"azure-cli": "2.90.0",', '2.90.0'));
  assert.ok(!outputHasVersion('1.22.22', '1.22.2'));
  assert.ok(!outputHasVersion('11.22.2', '1.22.2'));
});

test('each variant checks the base tools plus its own', () => {
  const labels = variant => versionChecks(inventory, variant).map(check => check.label);
  const base = labels('base');
  for (const label of ['node', 'claude', 'codex', 'opencode', 'uv', 'az', 'az extension azure-devops', 'serena', 'package @playwright/mcp', 'package pnpm']) {
    assert.ok(base.includes(label), `base is missing ${label}`);
  }
  assert.ok(!base.includes('pnpm') && !base.includes('dotnet'));
  assert.ok(['pnpm', 'yarn', 'tsc', 'typescript-language-server'].every(label => labels('node').includes(label)));
  assert.ok(labels('dotnet').includes('dotnet'));
  assert.throws(() => versionChecks(inventory, 'rust'), /variant/);
});

test('derives expectations from the inventory', () => {
  const byLabel = Object.fromEntries(versionChecks(inventory, 'node').map(check => [check.label, check.expected]));
  assert.equal(byLabel.node, inventory.baseImage.node);
  assert.equal(byLabel.az, inventory.systemTools.azureCliDebianPackage.split('-')[0]);
  assert.equal(byLabel['az extension azure-devops'], inventory.systemTools.azureDevOpsCliExtension);
  assert.equal(byLabel.tsc, inventory.npmPackages.typescript);
  assert.equal(byLabel['package typescript-serena'], '5.9.3');
  assert.equal(byLabel.serena, `rev=${inventory.sourceRevisions.serena}`);
});

test('reports mismatching, failing and missing tools', t => {
  const root = mkdtempSync(path.join(tmpdir(), 'agent-versions-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, 'pkg'));
  writeFileSync(path.join(root, 'pkg/package.json'), '{"version":"1.0.0"}');
  writeFileSync(path.join(root, 'receipt.toml'), 'git = "https://example?rev=abc"');
  const checks = [
    { label: 'ok-command', expected: '1.0.0', command: ['ok'] },
    { label: 'old-command', expected: '2.0.0', command: ['old'] },
    { label: 'broken-command', expected: '1.0.0', command: ['broken'] },
    { label: 'ok-package', expected: '1.0.0', file: path.join(root, 'pkg/package.json'), jsonField: 'version' },
    { label: 'old-package', expected: '1.0.1', file: path.join(root, 'pkg/package.json'), jsonField: 'version' },
    { label: 'ok-receipt', expected: 'rev=abc', file: path.join(root, 'receipt.toml') },
    { label: 'missing-file', expected: 'x', file: path.join(root, 'absent') },
  ];
  const exec = command => {
    if (command[0] === 'broken') throw new Error('exit 127');
    return command[0] === 'ok' ? 'tool 1.0.0' : 'tool 1.9.0';
  };
  const failures = runChecks(checks, { exec });
  assert.deepEqual(failures.map(failure => failure.split(':')[0]), ['old-command', 'broken-command', 'old-package', 'missing-file']);
});
