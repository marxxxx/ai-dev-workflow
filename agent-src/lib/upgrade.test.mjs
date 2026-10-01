// In-process tests for the upgrade step: removal of pre-0.23 generated files and obsolete
// ai-project.json keys. The CLI wiring is covered in cli.test.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  obsoleteOutputs, removeObsoleteOutputs, pruneProjectConfig, cleanProjectConfig, findCustomLeftovers,
} from './upgrade.mjs';
import { makeTmpRoot, tmpProject, MINIMAL_PROJECT } from '../test-helpers.mjs';

// What ≤0.22 generated and 0.23 no longer does — spelled out so the test does not just mirror
// the implementation's own list.
const LEGACY_FILES = [
  '.claude/agents/developer.md', '.claude/agents/code-reviewer.md', '.claude/agents/qa-engineer.md',
  '.codex/agents/developer.toml', '.codex/agents/code-reviewer.toml', '.codex/agents/qa-engineer.toml',
  '.opencode/agents/developer.md', '.opencode/agents/code-reviewer.md', '.opencode/agents/qa-engineer.md',
  '.claude/skills/dev-cycle/SKILL.md', '.claude/skills/product-architect/SKILL.md',
  '.opencode/skills/dev-cycle/SKILL.md', '.opencode/skills/product-architect/SKILL.md',
  '.agents/skills/dev-cycle/SKILL.md', '.agents/skills/dev-cycle/agents/openai.yaml',
  '.agents/skills/product-architect/SKILL.md', '.agents/skills/product-architect/agents/openai.yaml',
  '.agents/includes/e2e-runtime.md', '.agents/includes/handoff.md',
];

/** Banner text the old generator wrote into a file at `rel`. */
function legacyBanner(rel) {
  const p = rel.split('/');
  if (p[1] === 'includes') return `generated from agent-src/includes/${p[2]}`;
  if (p[1] === 'agents') return `generated from agent-src/agents/${path.parse(p[2]).name}`;
  return `generated from agent-src/skills/${p[2]}`;
}

function write(root, rel, content) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

function seedLegacy(root) {
  for (const rel of LEGACY_FILES) {
    write(root, rel, `<!-- DO NOT EDIT — ${legacyBanner(rel)}; run \`node agent-src/generate.mjs\` -->\n\nold\n`);
  }
}

const exists = (root, rel) => fs.existsSync(path.join(root, rel));

test('obsoleteOutputs lists exactly the files ≤0.22 generated and 0.23 dropped', () => {
  const actual = obsoleteOutputs().map((o) => o.path.split(path.sep).join('/')).sort();
  assert.deepEqual(actual, [...LEGACY_FILES].sort());
});

test('removeObsoleteOutputs deletes every banner-carrying legacy file and its empty unit dirs', () => {
  const { root, cleanup } = makeTmpRoot();
  try {
    seedLegacy(root);
    const { deleted, kept } = removeObsoleteOutputs(root);
    assert.equal(deleted.length, LEGACY_FILES.length);
    assert.deepEqual(kept, []);
    for (const rel of LEGACY_FILES) assert.ok(!exists(root, rel), `${rel} should be gone`);
    for (const dir of ['.claude/skills/dev-cycle', '.agents/skills/dev-cycle', '.opencode/skills/product-architect']) {
      assert.ok(!exists(root, dir), `${dir} should be removed once empty`);
    }
    // Shared parent dirs stay, even when empty.
    for (const dir of ['.claude/skills', '.claude/agents', '.agents/skills', '.agents/includes', '.codex/agents']) {
      assert.ok(exists(root, dir), `${dir} must not be removed`);
    }
  } finally {
    cleanup();
  }
});

test('removeObsoleteOutputs keeps same-named files that adw did not generate', () => {
  const { root, cleanup } = makeTmpRoot();
  try {
    write(root, '.claude/agents/developer.md', '---\nname: developer\n---\nmy own agent\n');
    write(root, '.claude/skills/dev-cycle/SKILL.md', '---\nname: dev-cycle\n---\nmine\n');
    // Banner of a different unit does not count.
    write(root, '.claude/agents/qa-engineer.md', '<!-- DO NOT EDIT — generated from agent-src/agents/developer; -->\n');
    const { deleted, kept } = removeObsoleteOutputs(root);
    assert.deepEqual(deleted, []);
    assert.equal(kept.length, 3);
    assert.ok(exists(root, '.claude/agents/developer.md'));
    assert.ok(exists(root, '.claude/skills/dev-cycle/SKILL.md'));
    assert.ok(exists(root, '.claude/agents/qa-engineer.md'));
  } finally {
    cleanup();
  }
});

test('removeObsoleteOutputs leaves other skills, agents and extra files in unit dirs untouched', () => {
  const { root, cleanup } = makeTmpRoot();
  try {
    seedLegacy(root);
    const others = [
      '.claude/agents/my-agent.md',
      '.claude/skills/my-skill/SKILL.md',
      '.claude/skills/agent-dev/SKILL.md',
      '.agents/includes/ticketing.md',
      '.agents/includes/cost.md',
      '.claude/skills/dev-cycle/notes.md', // a project file inside an obsolete unit dir
    ];
    for (const rel of others) write(root, rel, 'keep\n');
    removeObsoleteOutputs(root);
    for (const rel of others) assert.equal(fs.readFileSync(path.join(root, rel), 'utf8'), 'keep\n', rel);
  } finally {
    cleanup();
  }
});

test('removeObsoleteOutputs with dryRun reports but deletes nothing, and is idempotent', () => {
  const { root, cleanup } = makeTmpRoot();
  try {
    seedLegacy(root);
    const dry = removeObsoleteOutputs(root, { dryRun: true });
    assert.equal(dry.deleted.length, LEGACY_FILES.length);
    for (const rel of LEGACY_FILES) assert.ok(exists(root, rel), `${rel} must survive a dry run`);

    removeObsoleteOutputs(root);
    const again = removeObsoleteOutputs(root);
    assert.deepEqual(again, { deleted: [], kept: [] });
  } finally {
    cleanup();
  }
});

const LEGACY_PROJECT = {
  project: { name: 'Legacy', slug: 'legacy', serenaProject: 'legacy', description: 'old' },
  repository: { slug: 'me/legacy', defaultBranch: 'main' },
  ticketing: {
    backend: 'azure-devops',
    itemNoun: 'issue',
    azureDevOps: {
      organization: 'acme', project: 'widgets', featureType: 'Issue', bugType: 'Issue', processTemplate: 'basic',
      stateMapping: {
        'new': 'To Do', 'in-progress': 'Doing', 'review': 'Doing',
        'test': 'Doing', 'failed': 'Doing', 'acceptance-test': 'Doing',
      },
    },
  },
  git: { branchPattern: 'feat/<issue-number>_<slug>', prTarget: 'develop' },
  e2e: { up: 'scripts/e2e-up', down: 'scripts/e2e-down' },
  app: {},
  handoff: {},
  tokens: { custom: 'x' },
};

test('pruneProjectConfig removes the obsolete keys and keeps everything else in order', () => {
  const input = structuredClone(LEGACY_PROJECT);
  const { config, removed } = pruneProjectConfig(input);
  assert.deepEqual(config, {
    project: { name: 'Legacy' },
    repository: { slug: 'me/legacy' },
    ticketing: {
      backend: 'azure-devops',
      azureDevOps: {
        organization: 'acme', project: 'widgets', featureType: 'Issue', bugType: 'Issue', processTemplate: 'basic',
        stateMapping: { 'new': 'To Do', 'in-progress': 'Doing', 'review': 'Doing' },
      },
    },
    git: { prTarget: 'develop' },
    tokens: { custom: 'x' },
  });
  assert.deepEqual(Object.keys(config), ['project', 'repository', 'ticketing', 'git', 'tokens']);
  assert.deepEqual([...removed].sort(), [
    'app', 'e2e', 'git.branchPattern', 'handoff',
    'project.description', 'project.serenaProject', 'project.slug',
    'repository.defaultBranch',
    'ticketing.azureDevOps.stateMapping.acceptance-test',
    'ticketing.azureDevOps.stateMapping.failed',
    'ticketing.azureDevOps.stateMapping.test',
    'ticketing.itemNoun',
  ]);
  assert.deepEqual(input, LEGACY_PROJECT, 'input must not be mutated');
});

test('cleanProjectConfig rewrites ai-project.json only when something was removed', () => {
  const { root, cleanup } = tmpProject(LEGACY_PROJECT);
  try {
    const file = path.join(root, 'ai-project.json');
    const dry = cleanProjectConfig(root, { dryRun: true });
    assert.ok(dry.removed.length > 0);
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), LEGACY_PROJECT, 'dry run must not write');

    cleanProjectConfig(root);
    const text = fs.readFileSync(file, 'utf8');
    assert.ok(text.endsWith('}\n'));
    assert.equal(JSON.parse(text).git.branchPattern, undefined);

    const mtime = fs.statSync(file).mtimeMs;
    assert.deepEqual(cleanProjectConfig(root).removed, []);
    assert.equal(fs.statSync(file).mtimeMs, mtime, 'a clean config is not rewritten');
  } finally {
    cleanup();
  }
});

test('cleanProjectConfig is a no-op without ai-project.json', () => {
  const { root, cleanup } = makeTmpRoot();
  try {
    assert.deepEqual(cleanProjectConfig(root).removed, []);
    assert.ok(!exists(root, 'ai-project.json'));
  } finally {
    cleanup();
  }
});

test('findCustomLeftovers names project-owned leftovers of the removed units', () => {
  const { root, cleanup } = tmpProject(MINIMAL_PROJECT);
  try {
    assert.deepEqual(findCustomLeftovers(root), []);
    write(root, 'agent-custom/agents/developer/append.md', 'x');
    write(root, 'agent-custom/skills/dev-cycle/body.md', 'x');
    write(root, 'agent-custom/skills/agent-dev/append.md', 'x');
    write(root, 'scripts/e2e-up', 'x');
    const found = findCustomLeftovers(root).map((p) => p.split(path.sep).join('/')).sort();
    assert.deepEqual(found, ['agent-custom/agents/developer', 'agent-custom/skills/dev-cycle', 'scripts/e2e-up']);
  } finally {
    cleanup();
  }
});
