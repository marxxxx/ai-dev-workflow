import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadConfig, configHash, harnessVersion } from './config.mjs';

test('loadConfig reads e2e/config.json and adds the repo root', () => {
  const config = loadConfig();
  assert.equal(config.repetitions, 3);
  assert.deepEqual(Object.keys(config.harnesses), ['claude-code', 'codex', 'opencode']);
  assert.ok(path.isAbsolute(config.root));
});

test('configHash ignores root and is stable', () => {
  const a = { schema: 1, root: '/a', x: { b: 1, a: 2 } };
  const b = { x: { a: 2, b: 1 }, schema: 1, root: '/b' };
  assert.equal(configHash(a), configHash(b));
  assert.notEqual(configHash(a), configHash({ ...a, schema: 2 }));
});

test('harnessVersion reads the pin from the inventory', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'adw-e2e-'));
  try {
    const inv = path.join(dir, 'inventory.json');
    writeFileSync(inv, JSON.stringify({ npmPackages: { '@openai/codex': '0.161.0' } }));
    const config = { harnesses: { codex: { inventoryPackage: '@openai/codex' } } };
    assert.equal(harnessVersion(config, 'codex', inv), '0.161.0');
    assert.throws(() => harnessVersion(config, 'opencode', inv), /unknown harness/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('mcpServers lists every server the image launcher always configures', () => {
  const config = loadConfig();
  const source = readFileSync(path.join(config.root, 'docker/launch-agent.mjs'), 'utf8');
  const block = source.match(/function managedServers[\s\S]*?const servers = \{([\s\S]*?)\n  \};/)[1];
  assert.deepEqual(config.mcpServers, [...block.matchAll(/^    (\w+): \{/gm)].map((m) => m[1]));
});
