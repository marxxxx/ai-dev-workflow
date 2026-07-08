// Black-box CLI end-to-end tests. These drive the real `node generate.mjs …` process, so they
// are the primary "the refactor didn't break anything" proof — they pass identically before and
// after generate.mjs is split into modules.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { runCli, runCliViaSymlink, tmpProject, makeTmpRoot, MINIMAL_PROJECT } from './test-helpers.mjs';

// A representative sample of the files each backend/platform emits.
const SPOT_CHECK = [
  path.join('.claude', 'agents', 'developer.md'),
  path.join('.claude', 'skills', 'dev-cycle', 'SKILL.md'),
  path.join('.codex', 'agents', 'developer.toml'),
  path.join('.opencode', 'agents', 'developer.md'),
  path.join('.agents', 'includes', 'ticketing.md'),
];

test('generate writes all platform files with no leftover placeholders', () => {
  const { root, cleanup } = tmpProject();
  try {
    const { status, stdout } = runCli(['generate', '--root', root]);
    assert.equal(status, 0, stdout);
    for (const rel of SPOT_CHECK) {
      assert.ok(fs.existsSync(path.join(root, rel)), `missing ${rel}`);
    }
    const sample = fs.readFileSync(path.join(root, '.claude', 'agents', 'developer.md'), 'utf8');
    assert.doesNotMatch(sample, /\{\{.*?\}\}/, 'unresolved placeholder leaked into output');
  } finally {
    cleanup();
  }
});

test('check passes right after generate, fails after a file is mutated', () => {
  const { root, cleanup } = tmpProject();
  try {
    assert.equal(runCli(['generate', '--root', root]).status, 0);
    assert.equal(runCli(['check', '--root', root]).status, 0);

    const target = path.join(root, '.claude', 'agents', 'developer.md');
    fs.writeFileSync(target, 'tampered\n');
    const { status, stderr } = runCli(['check', '--root', root]);
    assert.equal(status, 1);
    assert.match(stderr, /stale/);
  } finally {
    cleanup();
  }
});

test('unknown command exits 1 with the usage message', () => {
  const { root, cleanup } = tmpProject();
  try {
    const { status, stderr } = runCli(['frobnicate', '--root', root]);
    assert.equal(status, 1);
    assert.match(stderr, /Unknown command/);
    assert.match(stderr, /generate \| check \| init/);
  } finally {
    cleanup();
  }
});

test('init --answers works when invoked through a symlink, as npm-installed bins are', () => {
  const { root, cleanup } = makeTmpRoot();
  try {
    fs.writeFileSync(path.join(root, 'answers.json'), JSON.stringify({ name: 'Symlink Demo', backend: 'file' }));
    const { status, stdout } = runCliViaSymlink(['init', '--answers', path.join(root, 'answers.json'), '--root', root]);
    assert.equal(status, 0, stdout);
    assert.ok(fs.existsSync(path.join(root, 'ai-project.json')), 'init produced no output/files when run through a symlink');
  } finally {
    cleanup();
  }
});

test('init --answers scaffolds a file-backend project non-interactively', () => {
  const { root, cleanup } = makeTmpRoot();
  try {
    fs.writeFileSync(path.join(root, 'answers.json'), JSON.stringify({ name: 'File Demo', backend: 'file' }));
    const { status } = runCli(['init', '--answers', path.join(root, 'answers.json'), '--root', root]);
    assert.equal(status, 0);
    const cfg = JSON.parse(fs.readFileSync(path.join(root, 'ai-project.json'), 'utf8'));
    assert.equal(cfg.project.name, 'File Demo');
    assert.equal(cfg.ticketing.backend, 'file');
    assert.equal(cfg.ticketing.file.dir, '.tickets/issues'); // default applied
    assert.ok(fs.existsSync(path.join(root, 'docs', 'ai-workflow-setup.md')));
  } finally {
    cleanup();
  }
});

test('init --answers scaffolds a github-backend project', () => {
  const { root, cleanup } = makeTmpRoot();
  try {
    fs.writeFileSync(path.join(root, 'answers.json'),
      JSON.stringify({ name: 'GH Demo', repoSlug: 'me/gh-demo', backend: 'github' }));
    const { status } = runCli(['init', '--answers', path.join(root, 'answers.json'), '--root', root]);
    assert.equal(status, 0);
    const cfg = JSON.parse(fs.readFileSync(path.join(root, 'ai-project.json'), 'utf8'));
    assert.equal(cfg.ticketing.backend, 'github');
    assert.ok(!('file' in cfg.ticketing) && !('azureDevOps' in cfg.ticketing));
  } finally {
    cleanup();
  }
});

test('init scaffolds the e2e stub scripts + block, and generate emits the configured include', () => {
  const { root, cleanup } = makeTmpRoot();
  try {
    fs.writeFileSync(path.join(root, 'answers.json'), JSON.stringify({ name: 'E2E Demo', backend: 'file' }));
    assert.equal(runCli(['init', '--answers', path.join(root, 'answers.json'), '--root', root]).status, 0);

    const cfg = JSON.parse(fs.readFileSync(path.join(root, 'ai-project.json'), 'utf8'));
    assert.deepEqual(cfg.e2e, { up: 'scripts/e2e-up', down: 'scripts/e2e-down', readinessTimeout: 120, logsDir: '.e2e/logs' });
    assert.ok(fs.existsSync(path.join(root, 'scripts', 'e2e-up')), 'stub up script scaffolded');
    assert.ok(fs.existsSync(path.join(root, 'scripts', 'e2e-down')), 'stub down script scaffolded');

    assert.equal(runCli(['generate', '--root', root]).status, 0);
    const include = fs.readFileSync(path.join(root, '.agents', 'includes', 'e2e-runtime.md'), 'utf8');
    assert.match(include, /scripts\/e2e-up/);
    assert.doesNotMatch(include, /\{\{.*?\}\}/, 'configured include fully resolves');
  } finally {
    cleanup();
  }
});

test('init --answers scaffolds an azure-devops project, and a follow-up generate emits .mcp.json', () => {
  const { root, cleanup } = makeTmpRoot();
  try {
    fs.writeFileSync(path.join(root, 'answers.json'), JSON.stringify({
      name: 'ADO Demo', backend: 'azure-devops',
      azure: { organization: 'acme', project: 'widgets', processTemplate: 'basic' },
    }));
    assert.equal(runCli(['init', '--answers', path.join(root, 'answers.json'), '--root', root]).status, 0);
    const cfg = JSON.parse(fs.readFileSync(path.join(root, 'ai-project.json'), 'utf8'));
    assert.equal(cfg.ticketing.azureDevOps.organization, 'acme');
    assert.equal(cfg.ticketing.azureDevOps.featureType, 'Issue'); // basic template

    assert.equal(runCli(['generate', '--root', root]).status, 0);
    const mcp = JSON.parse(fs.readFileSync(path.join(root, '.mcp.json'), 'utf8'));
    assert.ok(mcp.mcpServers.ado, '.mcp.json should carry the ado server entry');
    assert.ok(mcp.mcpServers.ado.args.includes('acme'));
  } finally {
    cleanup();
  }
});
