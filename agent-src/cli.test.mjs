// Black-box CLI end-to-end tests. These drive the real `node generate.mjs …` process, so they
// are the primary "the refactor didn't break anything" proof — they pass identically before and
// after generate.mjs is split into modules.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { runCli, runCliViaSymlink, canSymlink, tmpProject, makeTmpRoot, MINIMAL_PROJECT } from './test-helpers.mjs';

// A representative sample of the files each backend/platform emits.
const SPOT_CHECK = [
  path.join('.claude', 'skills', 'agent-dev', 'SKILL.md'),
  path.join('.agents', 'skills', 'agent-dev', 'SKILL.md'),
  path.join('.opencode', 'skills', 'agent-dev', 'SKILL.md'),
  path.join('.agents', 'includes', 'cost.md'),
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
    const sample = fs.readFileSync(path.join(root, '.claude', 'skills', 'agent-dev', 'SKILL.md'), 'utf8');
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

    const target = path.join(root, '.claude', 'skills', 'agent-dev', 'SKILL.md');
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
    assert.match(stderr, /generate \| check \| init \| upgrade/);
  } finally {
    cleanup();
  }
});

// Skipped where the process lacks symlink privilege — Windows grants it only under Developer Mode
// or an elevated shell.
test('init --answers works when invoked through a symlink, as npm-installed bins are', {
  skip: canSymlink ? false : 'no symlink privilege on this platform',
}, () => {
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
    assert.match(stdout, /Required:\n\s+superpowers/, 'agent-dev cannot run without superpowers');
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

test('init writes no e2e block or scripts, and generate emits no e2e include', () => {
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
    assert.equal(fs.existsSync(path.join(root, '.agents', 'includes', 'e2e-runtime.md')), false, 'the e2e include is retired');
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
    assert.ok(mcp.mcpServers.ado.args.includes('@azure-devops/mcp@2'), 'the ADO MCP server must be pinned to a major');
    const codexConfig = fs.readFileSync(path.join(root, '.codex', 'config.toml'), 'utf8');
    assert.match(codexConfig, /\[mcp_servers\.ado\]/);
    assert.match(codexConfig, /command = "npx"/);
    assert.match(codexConfig, /@azure-devops\/mcp@2/);
    assert.match(codexConfig, /"acme"/);
  } finally {
    cleanup();
  }
});

test('init --answers scaffolds a gitea project, and generate emits the tea-driven ticketing include', () => {
  const { root, cleanup } = makeTmpRoot();
  try {
    fs.writeFileSync(path.join(root, 'answers.json'), JSON.stringify({
      name: 'Gitea Demo', repoSlug: 'me/gitea-demo', backend: 'gitea', gitea: { login: 'myserver' },
    }));
    assert.equal(runCli(['init', '--answers', path.join(root, 'answers.json'), '--root', root]).status, 0);
    const cfg = JSON.parse(fs.readFileSync(path.join(root, 'ai-project.json'), 'utf8'));
    assert.equal(cfg.ticketing.backend, 'gitea');
    assert.equal(cfg.ticketing.gitea.login, 'myserver');

    assert.equal(runCli(['generate', '--root', root]).status, 0);
    const include = fs.readFileSync(path.join(root, '.agents', 'includes', 'ticketing.md'), 'utf8');
    assert.match(include, /tea issues --login "myserver" --repo me\/gitea-demo <number>/);
    assert.doesNotMatch(include, /\{\{.*?\}\}/, 'include fully resolves');
  } finally {
    cleanup();
  }
});

test('init --answers rejects a gitea project without a tea login', () => {
  const { root, cleanup } = makeTmpRoot();
  try {
    fs.writeFileSync(path.join(root, 'answers.json'),
      JSON.stringify({ name: 'Gitea Demo', repoSlug: 'me/gitea-demo', backend: 'gitea' }));
    const { status, stderr } = runCli(['init', '--answers', path.join(root, 'answers.json'), '--root', root]);
    assert.notEqual(status, 0, 'init should fail rather than write a config the generator will reject');
    assert.match(stderr, /gitea\.login/);
    assert.equal(fs.existsSync(path.join(root, 'ai-project.json')), false);
  } finally {
    cleanup();
  }
});

// A ≤0.22 project: the old subagents/skills/includes on disk plus obsolete ai-project.json keys.
function seedLegacyProject(root) {
  const legacy = {
    '.claude/agents/developer.md': 'agents/developer',
    '.codex/agents/qa-engineer.toml': 'agents/qa-engineer',
    '.claude/skills/dev-cycle/SKILL.md': 'skills/dev-cycle',
    '.agents/skills/product-architect/agents/openai.yaml': 'skills/product-architect',
    '.agents/includes/handoff.md': 'includes/handoff.md',
  };
  for (const [rel, source] of Object.entries(legacy)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, `<!-- DO NOT EDIT — generated from agent-src/${source}; run \`node agent-src/generate.mjs\` -->\n`);
  }
  const mine = path.join(root, '.claude', 'skills', 'my-skill', 'SKILL.md');
  fs.mkdirSync(path.dirname(mine), { recursive: true });
  fs.writeFileSync(mine, 'mine\n');
  const config = {
    ...MINIMAL_PROJECT,
    project: { ...MINIMAL_PROJECT.project, slug: 'test-project', serenaProject: 'test-project', description: 'A test' },
    git: { branchPattern: 'feat/<issue-number>_<slug>', prTarget: 'main' },
  };
  fs.writeFileSync(path.join(root, 'ai-project.json'), JSON.stringify(config, null, 2) + '\n');
  return Object.keys(legacy);
}

test('upgrade removes the legacy files and config keys, keeps other skills, and generates', () => {
  const { root, cleanup } = makeTmpRoot();
  try {
    const legacy = seedLegacyProject(root);
    const { status, stdout, stderr } = runCli(['upgrade', '--root', root]);
    assert.equal(status, 0, stderr);
    for (const rel of legacy) assert.ok(!fs.existsSync(path.join(root, rel)), `${rel} should be deleted`);
    assert.ok(fs.existsSync(path.join(root, '.claude', 'skills', 'my-skill', 'SKILL.md')));
    const config = JSON.parse(fs.readFileSync(path.join(root, 'ai-project.json'), 'utf8'));
    assert.deepEqual(config.git, { prTarget: 'main' });
    assert.equal(config.project.slug, undefined);
    assert.match(stdout, /git\.branchPattern/);
    assert.equal(runCli(['check', '--root', root]).status, 0, 'upgrade leaves the project up to date');
  } finally {
    cleanup();
  }
});

test('upgrade --dry-run reports the changes and writes nothing', () => {
  const { root, cleanup } = makeTmpRoot();
  try {
    const legacy = seedLegacyProject(root);
    const before = fs.readFileSync(path.join(root, 'ai-project.json'), 'utf8');
    const { status, stdout } = runCli(['upgrade', '--dry-run', '--root', root]);
    assert.equal(status, 0);
    for (const rel of legacy) assert.ok(fs.existsSync(path.join(root, rel)), `${rel} must survive`);
    assert.equal(fs.readFileSync(path.join(root, 'ai-project.json'), 'utf8'), before);
    assert.ok(!fs.existsSync(path.join(root, '.claude', 'skills', 'agent-dev')), 'dry run generates nothing');
    assert.match(stdout, /developer\.md/);
  } finally {
    cleanup();
  }
});

test('upgrade fails before deleting anything when the config cannot be rendered', () => {
  const { root, cleanup } = makeTmpRoot();
  try {
    const legacy = seedLegacyProject(root);
    const broken = { ...MINIMAL_PROJECT, ticketing: { backend: 'gitea', gitea: {} }, git: { branchPattern: 'x', prTarget: 'main' } };
    fs.writeFileSync(path.join(root, 'ai-project.json'), JSON.stringify(broken, null, 2) + '\n');
    const { status, stderr } = runCli(['upgrade', '--root', root]);
    assert.equal(status, 1);
    assert.match(stderr, /gitea\.login/);
    for (const rel of legacy) assert.ok(fs.existsSync(path.join(root, rel)), `${rel} must survive`);
    assert.match(fs.readFileSync(path.join(root, 'ai-project.json'), 'utf8'), /branchPattern/);
  } finally {
    cleanup();
  }
});
