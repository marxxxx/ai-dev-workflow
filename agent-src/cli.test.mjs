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
    assert.equal(fs.existsSync(path.join(root, 'docs')), false, 'init generates no docs — dependencies are printed');
  } finally {
    cleanup();
  }
});

test('init prints the dependencies with links and no install instructions', () => {
  const { root, cleanup } = makeTmpRoot();
  try {
    fs.writeFileSync(path.join(root, 'answers.json'), JSON.stringify({ name: 'File Demo', backend: 'file' }));
    const { status, stdout } = runCli(['init', '--answers', path.join(root, 'answers.json'), '--root', root]);
    assert.equal(status, 0, stdout);

    assert.match(stdout, /https:\/\/github\.com\/obra\/superpowers/);
    assert.match(stdout, /https:\/\/github\.com\/oraios\/serena/);
    assert.match(stdout, /https:\/\/github\.com\/microsoft\/playwright-mcp/);
    assert.match(stdout, /https:\/\/github\.com\/upstash\/context7/);

    // Installing is the user's job — the old setup doc's per-harness recipes must not come back.
    assert.doesNotMatch(stdout, /claude mcp add/, 'no install instructions');
    assert.doesNotMatch(stdout, /uv tool install/, 'no install instructions');
    assert.doesNotMatch(stdout, /plugin install/, 'no install instructions');
    assert.doesNotMatch(stdout, /ai-workflow-setup\.md/, 'the setup doc is gone');
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

test('init writes no e2e block or scripts, and generate emits the AGENTS-driven include', () => {
  const { root, cleanup } = makeTmpRoot();
  try {
    fs.writeFileSync(path.join(root, 'answers.json'), JSON.stringify({ name: 'E2E Demo', backend: 'file' }));
    assert.equal(runCli(['init', '--answers', path.join(root, 'answers.json'), '--root', root]).status, 0);

    const cfg = JSON.parse(fs.readFileSync(path.join(root, 'ai-project.json'), 'utf8'));
    assert.ok(!('e2e' in cfg), 'no e2e block is written');
    assert.equal(fs.existsSync(path.join(root, 'scripts', 'e2e-up')), false, 'no stub scripts scaffolded');
    assert.equal(fs.existsSync(path.join(root, 'scripts', 'e2e-down')), false, 'no stub scripts scaffolded');
    assert.equal(fs.existsSync(path.join(root, 'AGENTS.md')), false, 'AGENTS.md is user-owned via native /init');

    assert.equal(runCli(['generate', '--root', root]).status, 0);
    const include = fs.readFileSync(path.join(root, '.agents', 'includes', 'e2e-runtime.md'), 'utf8');
    assert.match(include, /AGENTS\.md/, 'include points the agent at AGENTS.md');
    assert.doesNotMatch(include, /scripts\/e2e-up/, 'no start/stop scripts referenced');
    assert.doesNotMatch(include, /\{\{.*?\}\}/, 'include fully resolves');
  } finally {
    cleanup();
  }
});

test('init --answers scaffolds an azure-devops project, and generate emits MCP config for shared and Codex consumers', () => {
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
    const codexConfig = fs.readFileSync(path.join(root, '.codex', 'config.toml'), 'utf8');
    assert.match(codexConfig, /\[mcp_servers\.ado\]/);
    assert.match(codexConfig, /command = "npx"/);
    assert.match(codexConfig, /@azure-devops\/mcp/);
    assert.match(codexConfig, /"acme"/);
  } finally {
    cleanup();
  }
});
