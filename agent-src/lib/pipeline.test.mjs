// In-process tests for the render pipeline and config merge — importing the functions directly
// (fast, and they assert internal invariants the CLI can't easily observe).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { renderAll, loadConfig } from '../generate.mjs';
import { makeTmpRoot, tmpProject } from '../test-helpers.mjs';

function writeProject(root, config) {
  fs.writeFileSync(path.join(root, 'ai-project.json'), JSON.stringify(config, null, 2) + '\n');
}

test('renderAll produces a set of unique output paths (file backend)', () => {
  const { root, cleanup } = tmpProject();
  try {
    const outputs = renderAll(root);
    assert.ok(outputs.length > 0);
    const paths = outputs.map((o) => o.path);
    assert.equal(paths.length, new Set(paths).size, 'output paths must be unique');
    // The ticketing include path is a config string (forward slashes), not a path.join result.
    assert.ok(paths.includes('.agents/includes/ticketing.md'));
  } finally {
    cleanup();
  }
});

test('azure-devops backend injects ADO tools into ticketing agents and emits .mcp.json', () => {
  const { root, cleanup } = makeTmpRoot();
  try {
    writeProject(root, {
      project: { name: 'ADO', slug: 'ado', serenaProject: 'ado', description: '' },
      repository: { slug: 'ado', defaultBranch: 'main' },
      ticketing: {
        backend: 'azure-devops',
        azureDevOps: {
          organization: 'acme', project: 'widgets', featureType: 'Issue', bugType: 'Issue',
          processTemplate: 'basic', stateMapping: {},
        },
      },
      git: { branchPattern: 'x', prTarget: 'main' },
    });
    const outputs = renderAll(root);
    const mcp = outputs.find((o) => o.path === '.mcp.json');
    assert.ok(mcp, '.mcp.json should be produced for azure-devops');
    assert.match(mcp.content, /@azure-devops\/mcp@2/, 'the ADO MCP server must be pinned to a major');

    const developer = outputs.find((o) => o.path === path.join('.claude', 'agents', 'developer.md'));
    assert.ok(developer, 'developer agent should be rendered');
    assert.match(developer.content, /mcp__ado__wit_query/, 'ADO MCP tool should be added to the allowlist');
    // The v1 tool surface was renamed wholesale in @azure-devops/mcp v2. An allowlist naming tools
    // the pinned server no longer registers leaves the subagent with no ADO tools at all.
    assert.doesNotMatch(
      developer.content,
      /mcp__ado__wit_(query_by_wiql|get_work_item|create_work_item|update_work_item|add_work_item_comment|list_work_item_comments)\b/,
      'retired v1 ADO tool names must not appear in the allowlist',
    );
  } finally {
    cleanup();
  }
});

test('azure-devops backend emits Codex project-local ADO MCP config', () => {
  const { root, cleanup } = makeTmpRoot();
  try {
    writeProject(root, {
      project: { name: 'ADO', slug: 'ado', serenaProject: 'ado', description: '' },
      repository: { slug: 'ado', defaultBranch: 'main' },
      ticketing: {
        backend: 'azure-devops',
        azureDevOps: {
          organization: 'acme', project: 'widgets', featureType: 'Issue', bugType: 'Issue',
          processTemplate: 'basic', stateMapping: {},
        },
      },
      git: { branchPattern: 'x', prTarget: 'main' },
    });

    const outputs = renderAll(root);
    const codexConfig = outputs.find((o) => o.path === path.join('.codex', 'config.toml'));
    assert.ok(codexConfig, '.codex/config.toml should be produced for azure-devops');
    assert.match(codexConfig.content, /# BEGIN ai-dev-workflow managed mcp_servers\.ado/);
    assert.match(codexConfig.content, /\[mcp_servers\.ado\]/);
    assert.match(codexConfig.content, /command = "npx"/);
    assert.match(codexConfig.content, /args = \["-y", "@azure-devops\/mcp@2", "acme", "-d", "core", "work", "work-items"\]/);
    assert.match(codexConfig.content, /# END ai-dev-workflow managed mcp_servers\.ado/);
  } finally {
    cleanup();
  }
});

test('azure-devops Codex MCP config preserves unrelated TOML and replaces ado only', () => {
  const { root, cleanup } = makeTmpRoot();
  try {
    writeProject(root, {
      project: { name: 'ADO', slug: 'ado', serenaProject: 'ado', description: '' },
      repository: { slug: 'ado', defaultBranch: 'main' },
      ticketing: {
        backend: 'azure-devops',
        azureDevOps: {
          organization: 'new-org', project: 'widgets', featureType: 'Issue', bugType: 'Issue',
          processTemplate: 'basic', stateMapping: {},
        },
      },
      git: { branchPattern: 'x', prTarget: 'main' },
    });

    const codexDir = path.join(root, '.codex');
    fs.mkdirSync(codexDir, { recursive: true });
    fs.writeFileSync(path.join(codexDir, 'config.toml'), [
      'model = "gpt-5-codex"',
      '',
      '[mcp_servers.context7]',
      'url = "https://mcp.context7.com/mcp"',
      '',
      '[mcp_servers.ado]',
      'command = "old-command"',
      'args = ["old-org"]',
      '',
      '[profiles.default]',
      'approval_policy = "on-request"',
      '',
    ].join('\n'));

    const outputs = renderAll(root);
    const codexConfig = outputs.find((o) => o.path === path.join('.codex', 'config.toml'));
    assert.ok(codexConfig);
    assert.match(codexConfig.content, /model = "gpt-5-codex"/);
    assert.match(codexConfig.content, /\[mcp_servers\.context7\]\nurl = "https:\/\/mcp\.context7\.com\/mcp"/);
    assert.match(codexConfig.content, /\[profiles\.default\]\napproval_policy = "on-request"/);
    assert.doesNotMatch(codexConfig.content, /old-command/);
    assert.doesNotMatch(codexConfig.content, /old-org/);
    assert.match(codexConfig.content, /"new-org"/);
  } finally {
    cleanup();
  }
});

test('renderAll throws when azure-devops lacks an organization', () => {
  const { root, cleanup } = makeTmpRoot();
  try {
    writeProject(root, {
      project: { name: 'ADO', slug: 'ado', serenaProject: 'ado', description: '' },
      repository: { slug: 'ado', defaultBranch: 'main' },
      ticketing: { backend: 'azure-devops', azureDevOps: { project: 'widgets' } },
      git: { branchPattern: 'x', prTarget: 'main' },
    });
    assert.throws(() => renderAll(root), /organization is required/);
  } finally {
    cleanup();
  }
});

test('renderAll emits the single AGENTS-driven e2e include and the qa-engineer points at it', () => {
  const { root, cleanup } = tmpProject();
  try {
    const outputs = renderAll(root);
    const e2e = outputs.find((o) => o.path === '.agents/includes/e2e-runtime.md');
    assert.ok(e2e, 'e2e-runtime include should always be produced');
    assert.match(e2e.content, /AGENTS\.md/, 'include points the agent at AGENTS.md');
    assert.match(e2e.content, /NEEDS HUMAN REVIEW/);
    assert.doesNotMatch(e2e.content, /scripts\/e2e-up|scripts\/e2e-down/, 'no start/stop scripts');
    assert.doesNotMatch(e2e.content, /\{\{.*?\}\}/, 'include must fully resolve');
    // The qa-engineer body points at the include and must resolve on every platform.
    const qa = outputs.find((o) => o.path === path.join('.claude', 'agents', 'qa-engineer.md'));
    assert.match(qa.content, /\.agents\/includes\/e2e-runtime\.md/);
    assert.doesNotMatch(qa.content, /\{\{.*?\}\}/);
  } finally {
    cleanup();
  }
});

test('renderAll emits the cost include and dev-cycle points at it', () => {
  const { root, cleanup } = tmpProject();
  try {
    const outputs = renderAll(root);
    const cost = outputs.find((o) => o.path === '.agents/includes/cost.md');
    assert.ok(cost, 'cost include should always be produced');
    assert.match(cost.content, /ccusage/, 'cost include invokes ccusage');
    assert.match(cost.content, /Cost Summary/, 'cost include names the summary artifact');
    assert.doesNotMatch(cost.content, /\{\{.*?\}\}/, 'include must fully resolve');
    // The dev-cycle orchestrator points at the cost include and must resolve on every platform.
    const devcycle = outputs.find((o) => o.path === path.join('.claude', 'skills', 'dev-cycle', 'SKILL.md'));
    assert.match(devcycle.content, /\.agents\/includes\/cost\.md/);
    assert.doesNotMatch(devcycle.content, /\{\{.*?\}\}/);
  } finally {
    cleanup();
  }
});

test('renderAll emits the handoff include and developer + dev-cycle point at it', () => {
  const { root, cleanup } = tmpProject();
  try {
    const outputs = renderAll(root);
    const handoff = outputs.find((o) => o.path === '.agents/includes/handoff.md');
    assert.ok(handoff, 'handoff include should always be produced');
    assert.match(handoff.content, /Developer Journal/, 'handoff include names the journal artifact');
    assert.doesNotMatch(handoff.content, /\{\{.*?\}\}/, 'include must fully resolve');
    // Both sides of the protocol must point at the same include on every platform.
    const dev = outputs.find((o) => o.path === path.join('.claude', 'agents', 'developer.md'));
    assert.match(dev.content, /\.agents\/includes\/handoff\.md/);
    assert.doesNotMatch(dev.content, /\{\{.*?\}\}/);
    const devcycle = outputs.find((o) => o.path === path.join('.claude', 'skills', 'dev-cycle', 'SKILL.md'));
    assert.match(devcycle.content, /\.agents\/includes\/handoff\.md/);
  } finally {
    cleanup();
  }
});

// The journal is the workflow's only progress state, and it lives on the ticket as one comment that
// is created once and then edited in place. That only works if every backend's include actually
// documents an address-a-single-comment-by-id update — which is exactly what these assert.
const JOURNAL_OPS = {
  file: {
    project: {
      project: { name: 'File Demo', slug: 'file-demo', serenaProject: 'file-demo', description: '' },
      repository: { slug: 'me/file-demo', defaultBranch: 'main' },
      ticketing: { backend: 'file', file: { dir: '.tickets/issues', metadataFile: '.tickets/metadata.json' } },
      git: { branchPattern: 'feat/<issue-number>_<slug>', prTarget: 'main' },
    },
    // No comment objects here: the journal stays a local file the ticket points at.
    create: /ai-dev-workflow-handoff\/file-demo-<number>\.md/,
    discover: /## Developer Journal/,
    update: /cat > "\$JOURNAL"/,
  },
  github: {
    project: {
      project: { name: 'GH Demo', slug: 'gh-demo', serenaProject: 'gh-demo', description: '' },
      repository: { slug: 'me/gh-demo', defaultBranch: 'main' },
      ticketing: { backend: 'github' },
      git: { branchPattern: 'feat/<issue-number>_<slug>', prTarget: 'main' },
    },
    create: /gh api -X POST repos\/me\/gh-demo\/issues\/<number>\/comments/,
    discover: /startswith\("## Developer Journal"\)/,
    update: /gh api -X PATCH repos\/me\/gh-demo\/issues\/comments\/<comment-id>/,
  },
  gitea: {
    project: {
      project: { name: 'Gitea Demo', slug: 'gitea-demo', serenaProject: 'gitea-demo', description: '' },
      repository: { slug: 'me/gitea-demo', defaultBranch: 'main' },
      ticketing: { backend: 'gitea', gitea: { login: 'myserver' } },
      git: { branchPattern: 'feat/<issue-number>_<slug>', prTarget: 'main' },
    },
    create: /tea comments add .*<number> "\$BODY"/,
    discover: /tea comments list .*--output json/,
    update: /tea comments edit .*<comment-id> "\$BODY"/,
  },
  'azure-devops': {
    project: {
      project: { name: 'ADO Demo', slug: 'ado-demo', serenaProject: 'ado-demo', description: '' },
      repository: { slug: 'ado-repo', defaultBranch: 'main' },
      ticketing: { backend: 'azure-devops', azureDevOps: { organization: 'contoso', project: 'widgets' } },
      git: { branchPattern: 'feat/<issue-number>_<slug>', prTarget: 'main' },
    },
    create: /wit_work_item_comment_write\(action: "add", workItemId: <id>/,
    discover: /wit_work_item\(action: "list_comments", workItemId: <id>/,
    update: /wit_work_item_comment_write\(action: "update", workItemId: <id>, commentId: <comment-id>/,
  },
};

for (const [backend, spec] of Object.entries(JOURNAL_OPS)) {
  test(`${backend} ticketing include documents create/discover/update for the journal comment`, () => {
    const { root, cleanup } = makeTmpRoot();
    try {
      writeProject(root, spec.project);
      const include = renderAll(root).find((o) => o.path === '.agents/includes/ticketing.md');
      assert.ok(include, `the ticketing include should be produced for ${backend}`);
      assert.match(include.content, /## The Journal Comment/,
        'every backend must document how the journal comment is addressed');
      assert.match(include.content, spec.create, 'the include must show how the journal is created');
      assert.match(include.content, spec.discover, 'the include must show how the journal is found/read');
      assert.match(include.content, spec.update, 'the include must show an in-place update, not a re-post');
      assert.doesNotMatch(include.content, /\{\{.*?\}\}/, 'include must fully resolve');
    } finally {
      cleanup();
    }
  });

  test(`${backend} ticketing include lists the journal artifact and not the retired handoff one`, () => {
    const { root, cleanup } = makeTmpRoot();
    try {
      writeProject(root, spec.project);
      const include = renderAll(root).find((o) => o.path === '.agents/includes/ticketing.md');
      assert.match(include.content, /`Developer Journal` — the workflow's progress record/,
        'the journal must be listed among the ticket artifacts');
      assert.doesNotMatch(include.content, /Developer Handoff/,
        'the append-only handoff artifact was merged into the journal comment');
    } finally {
      cleanup();
    }
  });
}

test('renderAll documents the persisted oversized-journal gate before developer dispatch', () => {
  const { root, cleanup } = tmpProject();
  try {
    const outputs = renderAll(root);
    const handoff = outputs.find((o) => o.path === '.agents/includes/handoff.md');
    const devcycle = outputs.find((o) => o.path === path.join('.claude', 'skills', 'dev-cycle', 'SKILL.md'));

    assert.match(handoff.content, /Item count: <positive integer>/,
      'new journals must persist their acceptance-criterion count');
    assert.match(handoff.content, /Sizing decision: <automatic \| pending \| proceed \| split>/,
      'new journals must persist whether the human approved development or requested a split');
    assert.match(handoff.content, /Continuation limit: <positive integer \| pending>/,
      'new journals must persist the effective continuation limit');

    assert.match(devcycle.content, /fifteen or fewer\s+items record an `automatic`\s+decision/is,
      'journals of fifteen or fewer items must skip the oversized gate');
    assert.match(devcycle.content, /more than fifteen items.*before creating a cost\s+ledger or spawning a developer/is,
      'oversized journals must block implementation setup until a decision exists');
    assert.match(devcycle.content, /new journal.*more than fifteen items.*`pending`\s+decision.*`pending` continuation\s+limit.*before asking/is,
      'new oversized journals must persist their pending state before prompting the human');
    assert.match(devcycle.content, /1 continuation for 1-6 items, 2 for 7-9, 3 for 10-15/,
      'automatic journals must derive their continuation limit from the item-count bands');
    assert.match(devcycle.content, /continuation limit `ceil\(item count \/ 5\)`/,
      'an approved oversized ticket must scale at one attempt per five criteria');
    assert.match(devcycle.content, /16 to 20 items use 4 continuations; 21 to 25 items use 5/,
      'the oversized examples must document the scaled limits');
    assert.match(devcycle.content, /additional developer attempt after the first/i,
      'a continuation must be defined as an attempt beyond the initial developer');
    assert.match(devcycle.content, /recorded proceed decision.*without\s+asking again/is,
      'restart behavior must reuse a persisted proceed decision');
    assert.match(devcycle.content, /legacy journal.*lacks sizing metadata.*record.*before developer\s+dispatch/is,
      'legacy journals must be migrated through the gate exactly once');
  } finally {
    cleanup();
  }
});

test('renderAll documents the split path without developer dispatch or a cost ledger', () => {
  const { root, cleanup } = tmpProject();
  try {
    const devcycle = renderAll(root)
      .find((o) => o.path === path.join('.claude', 'skills', 'dev-cycle', 'SKILL.md'));

    assert.match(devcycle.content, /On \*\*split\*\*.*do not spawn a developer.*do not create a cost ledger/is,
      'split must stop before any implementation-only setup');
    assert.match(devcycle.content, /end this dev-cycle path.*start `\$product-architect` interactively in the same conversation/is,
      'split must transfer to the foreground product-architect workflow');
    assert.match(devcycle.content, /do not close.*or accept the original ticket/is,
      'ticket acceptance remains a human workflow after a split decision');
    assert.match(devcycle.content, /three implementation-review iterations.*unchanged/is,
      'the sizing policy must not alter implementation-review iteration limits');
    assert.match(devcycle.content, /progress guard \(unchanged\).*two consecutive continuations/is,
      'the sizing policy must not alter the existing continuation progress guard');
  } finally {
    cleanup();
  }
});

test('loadConfig merges package workflow + includePath over the project file', () => {
  const { root, cleanup } = tmpProject();
  try {
    const cfg = loadConfig(root);
    // project-owned
    assert.equal(cfg.ticketing.backend, 'file');
    assert.equal(cfg.project.slug, 'test-project');
    // package-owned (from agent-src/config/ai-workflow.json)
    assert.ok(cfg.workflow, 'workflow states/artifacts come from the package');
    assert.equal(cfg.ticketing.includePath, '.agents/includes/ticketing.md');
    assert.equal(cfg.app.includePath, '.agents/includes/e2e-runtime.md');
    assert.equal(cfg.cost.includePath, '.agents/includes/cost.md');
    assert.equal(cfg.handoff.includePath, '.agents/includes/handoff.md');
  } finally {
    cleanup();
  }
});

test('loadConfig returns package-only config when ai-project.json is absent', () => {
  const { root, cleanup } = makeTmpRoot();
  try {
    const cfg = loadConfig(root);
    assert.ok(cfg.workflow);
    assert.equal(cfg.ticketing.includePath, '.agents/includes/ticketing.md');
    assert.ok(!cfg.project, 'no project identity without ai-project.json');
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// Project-level customization via agent-custom/{agents,skills}/<name>/.
// ---------------------------------------------------------------------------

/** Write a file under agent-custom/<rel>, creating parent dirs. */
function writeCustom(root, rel, content) {
  const abs = path.join(root, 'agent-custom', rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

const DEVELOPER = path.join('.claude', 'agents', 'developer.md');

test('agent-custom append.md is appended after the package body with tokens resolved', () => {
  const { root, cleanup } = tmpProject();
  try {
    writeCustom(root, 'agents/developer/append.md', '## House rules\nAlways lint for {{project.name}}.\n');
    const dev = renderAll(root).find((o) => o.path === DEVELOPER);
    // Package prose still present…
    assert.match(dev.content, /Own implementation only\./);
    // …and the fragment is appended, with {{project.name}} resolved from MINIMAL_PROJECT.
    assert.match(dev.content, /## House rules\nAlways lint for Test Project\./);
    assert.doesNotMatch(dev.content, /\{\{.*?\}\}/);
    // Banner now points at both sources.
    assert.match(dev.content, /agent-src\/agents\/developer \+ agent-custom\/agents\/developer/);
  } finally {
    cleanup();
  }
});

test('agent-custom body.md fully overrides the package body', () => {
  const { root, cleanup } = tmpProject();
  try {
    writeCustom(root, 'agents/developer/body.md', 'Custom developer for {{project.name}} only.\n');
    const dev = renderAll(root).find((o) => o.path === DEVELOPER);
    assert.match(dev.content, /Custom developer for Test Project only\./);
    assert.doesNotMatch(dev.content, /Own implementation only\./, 'package body must be gone');
    assert.doesNotMatch(dev.content, /\{\{.*?\}\}/);
  } finally {
    cleanup();
  }
});

test('agent-custom override and append combine (override is the base, append follows)', () => {
  const { root, cleanup } = tmpProject();
  try {
    writeCustom(root, 'agents/developer/body.md', 'BASE override.\n');
    writeCustom(root, 'agents/developer/append.md', 'EXTRA appended.\n');
    const dev = renderAll(root).find((o) => o.path === DEVELOPER);
    // A blank-line separator sits between base and fragment (same as the overlay append).
    assert.match(dev.content, /BASE override\.\n\nEXTRA appended\./);
    assert.doesNotMatch(dev.content, /Own implementation only\./);
  } finally {
    cleanup();
  }
});

test('an unresolved token in an agent-custom file throws through the pipeline guard', () => {
  const { root, cleanup } = tmpProject();
  try {
    writeCustom(root, 'agents/developer/append.md', 'Uses {{nope}}.\n');
    assert.throws(() => renderAll(root), /no matching token/);
  } finally {
    cleanup();
  }
});

test('no agent-custom dir is a no-op: output identical to package-only render', () => {
  const a = tmpProject();
  const b = tmpProject();
  try {
    const bare = renderAll(a.root).find((o) => o.path === DEVELOPER).content;
    writeCustom(b.root, 'agents/developer/append.md', 'x\n');
    fs.rmSync(path.join(b.root, 'agent-custom'), { recursive: true, force: true });
    const removed = renderAll(b.root).find((o) => o.path === DEVELOPER).content;
    assert.equal(removed, bare, 'removing agent-custom returns to package defaults');
    assert.doesNotMatch(bare, /agent-custom/);
  } finally {
    a.cleanup();
    b.cleanup();
  }
});

test('gitea backend renders the tea-driven ticketing include with the login substituted', () => {
  const { root, cleanup } = makeTmpRoot();
  try {
    writeProject(root, {
      project: { name: 'Gitea Demo', slug: 'gitea-demo', serenaProject: 'gitea-demo', description: '' },
      repository: { slug: 'me/gitea-demo', defaultBranch: 'main' },
      ticketing: { backend: 'gitea', gitea: { login: 'myserver' } },
      git: { branchPattern: 'feat/<issue-number>_<slug>', prTarget: 'main' },
    });
    const outputs = renderAll(root);
    const include = outputs.find((o) => o.path === '.agents/includes/ticketing.md');
    assert.ok(include, 'the ticketing include should be produced for gitea');
    assert.match(include.content, /tea issues list/, 'commands should be driven by the tea CLI');
    assert.match(include.content, /--login "myserver"/, 'the configured tea login should be substituted');
    assert.match(include.content, /status:new/, 'gitea statuses are labels, like GitHub');
    assert.doesNotMatch(include.content, /\bgh issue\b/, 'no leftover gh commands from the GitHub include');
  } finally {
    cleanup();
  }
});

test('renderAll throws when gitea lacks a login', () => {
  const { root, cleanup } = makeTmpRoot();
  try {
    writeProject(root, {
      project: { name: 'Gitea Demo', slug: 'gitea-demo', serenaProject: 'gitea-demo', description: '' },
      repository: { slug: 'me/gitea-demo', defaultBranch: 'main' },
      ticketing: { backend: 'gitea' },
      git: { branchPattern: 'x', prTarget: 'main' },
    });
    assert.throws(() => renderAll(root), /ticketing\.gitea\.login is required/);
  } finally {
    cleanup();
  }
});

test('a gitea login containing a space stays one shell argument in the rendered commands', () => {
  const { root, cleanup } = makeTmpRoot();
  try {
    writeProject(root, {
      project: { name: 'Gitea Demo', slug: 'gitea-demo', serenaProject: 'gitea-demo', description: '' },
      repository: { slug: 'me/gitea-demo', defaultBranch: 'main' },
      // `tea login add` happily accepts spaces in a profile name, and real installs have them.
      ticketing: { backend: 'gitea', gitea: { login: 'gitea ki' } },
      git: { branchPattern: 'x', prTarget: 'main' },
    });
    const include = renderAll(root).find((o) => o.path === '.agents/includes/ticketing.md');
    const bare = include.content.match(/--login (?!")\S*/g) || [];
    assert.deepEqual(bare, [], `every --login value must be quoted, found: ${bare.join(', ')}`);
    assert.match(include.content, /--login "gitea ki"/);
  } finally {
    cleanup();
  }
});
