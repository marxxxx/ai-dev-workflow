// Black-box CLI end-to-end tests. These drive the real `node generate.mjs …` process, so they
// are the primary "the refactor didn't break anything" proof — they pass identically before and
// after generate.mjs is split into modules.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { PROJECT_FILE } from './lib/constants.mjs';
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
    assert.ok(fs.existsSync(path.join(root, PROJECT_FILE)), 'init produced no output/files when run through a symlink');
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
    const cfg = JSON.parse(fs.readFileSync(path.join(root, PROJECT_FILE), 'utf8'));
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
    const cfg = JSON.parse(fs.readFileSync(path.join(root, PROJECT_FILE), 'utf8'));
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

    const cfg = JSON.parse(fs.readFileSync(path.join(root, PROJECT_FILE), 'utf8'));
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
    const cfg = JSON.parse(fs.readFileSync(path.join(root, PROJECT_FILE), 'utf8'));
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
    const cfg = JSON.parse(fs.readFileSync(path.join(root, PROJECT_FILE), 'utf8'));
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

test('init --answers writes .adw/project.json and nothing at the root', () => {
  const { root, cleanup } = makeTmpRoot();
  try {
    fs.writeFileSync(path.join(root, 'answers.json'), JSON.stringify({ name: 'Adw Dir', backend: 'file' }));
    const { status } = runCli(['init', '--answers', path.join(root, 'answers.json'), '--root', root]);
    assert.equal(status, 0);
    assert.ok(fs.existsSync(path.join(root, '.adw', 'project.json')));
    assert.ok(!fs.existsSync(path.join(root, 'ai-project.json')));
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
    assert.equal(fs.existsSync(path.join(root, PROJECT_FILE)), false);
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
  fs.mkdirSync(path.join(root, '.adw'), { recursive: true });
  fs.writeFileSync(path.join(root, PROJECT_FILE), JSON.stringify(config, null, 2) + '\n');
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
    const config = JSON.parse(fs.readFileSync(path.join(root, PROJECT_FILE), 'utf8'));
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
    const before = fs.readFileSync(path.join(root, PROJECT_FILE), 'utf8');
    const { status, stdout } = runCli(['upgrade', '--dry-run', '--root', root]);
    assert.equal(status, 0);
    for (const rel of legacy) assert.ok(fs.existsSync(path.join(root, rel)), `${rel} must survive`);
    assert.equal(fs.readFileSync(path.join(root, PROJECT_FILE), 'utf8'), before);
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
    fs.mkdirSync(path.join(root, '.adw'), { recursive: true });
    fs.writeFileSync(path.join(root, PROJECT_FILE), JSON.stringify(broken, null, 2) + '\n');
    const { status, stderr } = runCli(['upgrade', '--root', root]);
    assert.equal(status, 1);
    assert.match(stderr, /gitea\.login/);
    for (const rel of legacy) assert.ok(fs.existsSync(path.join(root, rel)), `${rel} must survive`);
    assert.match(fs.readFileSync(path.join(root, PROJECT_FILE), 'utf8'), /branchPattern/);
  } finally {
    cleanup();
  }
});

const SKILL_PINS = JSON.parse(fs.readFileSync(new URL('./config/skills.json', import.meta.url), 'utf8'));
const SHOW_ME = SKILL_PINS.skills['show-me'];

/** Run the CLI with the fake npx logging into `root`; returns the result plus each logged argv. */
function runWithNpxLog(root, args, env = {}) {
  const log = path.join(root, '..', `${path.basename(root)}-npx.log`);
  fs.rmSync(log, { force: true });
  const result = runCli(args, { env: { FAKE_NPX_LOG: log, ...env } });
  const calls = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : [];
  fs.rmSync(log, { force: true });
  return { ...result, calls };
}

test('upgrade records the show-me opt-in, installs the pinned commit, and leaves check quiet', () => {
  const { root, cleanup } = tmpProject();
  try {
    const { status, stdout, stderr, calls } = runWithNpxLog(root, ['upgrade', '--root', root]);
    assert.equal(status, 0, stderr);
    assert.deepEqual(calls, [[
      '--yes', `skills@${SKILL_PINS.cli}`, 'add',
      `https://github.com/${SHOW_ME.repository}/tree/${SHOW_ME.revision}/${SHOW_ME.path}`,
      '-y', '-a', 'claude-code', 'codex', 'opencode',
    ]]);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, PROJECT_FILE), 'utf8')).skills, { 'show-me': true });
    assert.match(stdout, /Installed show-me/);
    const check = runCli(['check', '--root', root]);
    assert.equal(check.status, 0);
    assert.doesNotMatch(check.stderr, /show-me/);
    assert.deepEqual(runWithNpxLog(root, ['upgrade', '--root', root]).calls, [], 'a current install is not repeated');
  } finally {
    cleanup();
  }
});

test('upgrade --dry-run names the show-me install without running it', () => {
  const { root, cleanup } = tmpProject();
  try {
    const { status, stdout, calls } = runWithNpxLog(root, ['upgrade', '--dry-run', '--root', root]);
    assert.equal(status, 0);
    assert.deepEqual(calls, []);
    assert.match(stdout, /Would install show-me/);
    assert.equal(JSON.parse(fs.readFileSync(path.join(root, PROJECT_FILE), 'utf8')).skills, undefined);
  } finally {
    cleanup();
  }
});

test('upgrade still succeeds when the show-me install fails, and prints the manual command', () => {
  const { root, cleanup } = tmpProject();
  try {
    const { status, stderr } = runWithNpxLog(root, ['upgrade', '--root', root], { FAKE_NPX_FAIL: '1' });
    assert.equal(status, 0);
    assert.match(stderr, /show-me could not be installed/);
    assert.match(stderr, /npx --yes skills@/);
    assert.ok(fs.existsSync(path.join(root, '.claude', 'skills', 'agent-dev', 'SKILL.md')), 'generation still happened');
  } finally {
    cleanup();
  }
});

test('upgrade respects a show-me opt-out', () => {
  const { root, cleanup } = tmpProject({ ...MINIMAL_PROJECT, skills: { 'show-me': false } });
  try {
    const { status, calls } = runWithNpxLog(root, ['upgrade', '--root', root]);
    assert.equal(status, 0);
    assert.deepEqual(calls, []);
    assert.doesNotMatch(runCli(['check', '--root', root]).stderr, /show-me/);
  } finally {
    cleanup();
  }
});

test('generate and check point at upgrade when show-me is missing, without failing', () => {
  const { root, cleanup } = tmpProject();
  try {
    const generate = runCli(['generate', '--root', root]);
    assert.equal(generate.status, 0);
    assert.match(generate.stderr, /show-me is not installed.*upgrade/);
    const check = runCli(['check', '--root', root]);
    assert.equal(check.status, 0, 'a missing skill is not drift');
    assert.match(check.stderr, /show-me is not installed/);
  } finally {
    cleanup();
  }
});

test('upgrade, generate and check name a .adw/compose.yml without KILL, without failing', () => {
  const { root, cleanup } = tmpProject();
  try {
    fs.mkdirSync(path.join(root, '.adw'), { recursive: true });
    fs.writeFileSync(path.join(root, '.adw/compose.yml'),
      'services:\n  ai-dev-workflow:\n    cap_drop:\n      - ALL\n    cap_add:\n      - SETUID\n      - SETGID\n');
    for (const args of [['upgrade', '--dry-run'], ['generate'], ['check']]) {
      const { status, stderr } = runCli([...args, '--root', root]);
      assert.equal(status, 0, `${args[0]}: ${stderr}`);
      assert.match(stderr, /\.adw\/compose\.yml lacks the KILL capability/, args[0]);
    }
  } finally {
    cleanup();
  }
});

// The pre-.adw layout: config and container files at the project root.
function seedOldLayout(root, { launcher = true } = {}) {
  fs.writeFileSync(path.join(root, 'ai-project.json'), JSON.stringify(MINIMAL_PROJECT, null, 2) + '\n');
  if (launcher) fs.writeFileSync(path.join(root, 'ai-dev.sh'), '#!/bin/sh\n');
  fs.writeFileSync(path.join(root, 'AI-DEV.md'), 'old readme\n');
  fs.writeFileSync(path.join(root, '.env.ai-dev'), 'X=1\n');
  fs.writeFileSync(path.join(root, '.gitignore'), '.env.ai-dev\n');
  fs.writeFileSync(path.join(root, '.gitattributes'), 'ai-dev.sh text eol=lf\n');
}

function listTree(dir, base = dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? listTree(p, base) : [`${path.relative(base, p)}:${fs.readFileSync(p, 'utf8')}`];
  }).sort();
}

test('generate and check refuse the old layout and name upgrade', () => {
  const { root, cleanup } = makeTmpRoot();
  try {
    seedOldLayout(root);
    for (const command of ['generate', 'check']) {
      const { status, stderr } = runCli([command, '--root', root]);
      assert.equal(status, 1);
      assert.match(stderr, /Old adw layout found: ai-project\.json.*upgrade/s);
    }
    assert.ok(!fs.existsSync(path.join(root, '.claude')), 'nothing is written');
  } finally {
    cleanup();
  }
});

test('a leftover .env.ai-dev alone does not block generate', () => {
  const { root, cleanup } = tmpProject();
  try {
    fs.writeFileSync(path.join(root, '.env.ai-dev'), 'X=1\n');
    assert.equal(runCli(['generate', '--root', root]).status, 0);
  } finally {
    cleanup();
  }
});

test('init refuses the old layout', () => {
  const { root, cleanup } = makeTmpRoot();
  try {
    seedOldLayout(root);
    fs.writeFileSync(path.join(root, 'answers.json'), JSON.stringify({ name: 'X', backend: 'file' }));
    const { status, stderr } = runCli(['init', '--answers', path.join(root, 'answers.json'), '--root', root]);
    assert.equal(status, 1);
    assert.match(stderr, /init failed: Old adw layout found/);
  } finally {
    cleanup();
  }
});

test('upgrade moves the old layout, prints each change, then generates', () => {
  const { root, cleanup } = makeTmpRoot();
  try {
    seedOldLayout(root);
    const { status, stdout, stderr } = runCli(['upgrade', '--root', root]);
    assert.equal(status, 0, stderr);
    assert.match(stdout, /Moved ai-project\.json → \.adw\/project\.json/);
    assert.match(stdout, /Rewrote ai-dev\.sh → adw\.sh/);
    assert.match(stdout, /Added \.adw\/\.env to \.gitignore/);
    assert.match(stdout, /Replaced ai-dev\.sh with adw\.sh in \.gitattributes/);
    assert.match(stdout, /See \.adw\/README\.md for the container setup\./);
    assert.ok(fs.existsSync(path.join(root, '.claude', 'skills', 'agent-dev', 'SKILL.md')));
    assert.ok(!fs.existsSync(path.join(root, 'ai-project.json')));
    assert.equal(runCli(['check', '--root', root]).status, 0);
  } finally {
    cleanup();
  }
});

test('upgrade --dry-run lists the moves and changes nothing', () => {
  const { root, cleanup } = makeTmpRoot();
  try {
    seedOldLayout(root);
    const before = listTree(root);
    const { status, stdout } = runCli(['upgrade', '--dry-run', '--root', root]);
    assert.equal(status, 0);
    assert.match(stdout, /Would move ai-project\.json → \.adw\/project\.json/);
    assert.match(stdout, /Would rewrite AI-DEV\.md → \.adw\/README\.md/);
    assert.match(stdout, /Would: Added \.adw\/\.env to \.gitignore/);
    assert.match(stdout, /Dry run: the remaining upgrade steps are listed once the files are in \.adw\//);
    assert.deepEqual(listTree(root), before);
  } finally {
    cleanup();
  }
});

test('upgrade stops with exit 1 on a conflict and does not generate', () => {
  const { root, cleanup } = tmpProject();
  try {
    fs.writeFileSync(path.join(root, 'ai-project.json'), '{}\n');
    const { status, stderr } = runCli(['upgrade', '--root', root]);
    assert.equal(status, 1);
    assert.match(stderr, /Conflict: ai-project\.json and \.adw\/project\.json both exist/);
    assert.ok(!fs.existsSync(path.join(root, '.claude')));
  } finally {
    cleanup();
  }
});

test('upgrade prints the moves that happened before reporting a conflict', () => {
  const { root, cleanup } = tmpProject();
  try {
    fs.writeFileSync(path.join(root, 'ai-project.json'), '{}\n');
    fs.writeFileSync(path.join(root, 'compose.ai-dev.yml'), 'name: x-ai\n');
    const { status, stdout, stderr } = runCli(['upgrade', '--root', root]);
    assert.equal(status, 1);
    assert.match(stdout, /Moved compose\.ai-dev\.yml → \.adw\/compose\.yml/);
    assert.match(stderr, /Conflict: ai-project\.json and \.adw\/project\.json both exist/);
    assert.ok(!fs.existsSync(path.join(root, '.claude')));
  } finally {
    cleanup();
  }
});

test('upgrade --dry-run with a conflict exits 1', () => {
  const { root, cleanup } = tmpProject();
  try {
    fs.writeFileSync(path.join(root, 'ai-project.json'), '{}\n');
    const { status, stderr } = runCli(['upgrade', '--dry-run', '--root', root]);
    assert.equal(status, 1);
    assert.match(stderr, /Conflict: ai-project\.json/);
  } finally {
    cleanup();
  }
});

test('upgrade fails cleanly on an invalid project file and moves nothing', () => {
  const { root, cleanup } = makeTmpRoot();
  try {
    fs.writeFileSync(path.join(root, 'ai-project.json'), '{ nope');
    fs.writeFileSync(path.join(root, 'AI-DEV.md'), 'old readme\n');
    const before = listTree(root);
    const { status, stderr } = runCli(['upgrade', '--root', root]);
    assert.equal(status, 1);
    assert.match(stderr, /upgrade failed: ai-project\.json is not valid JSON/);
    assert.doesNotMatch(stderr, /\n\s+at /);
    assert.deepEqual(listTree(root), before);
  } finally {
    cleanup();
  }
});
