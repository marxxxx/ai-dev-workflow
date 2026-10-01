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

test('azure-devops backend emits .mcp.json with the pinned ADO server', () => {
  const { root, cleanup } = makeTmpRoot();
  try {
    writeProject(root, {
      project: { name: 'ADO' },
      repository: { slug: 'ado' },
      ticketing: {
        backend: 'azure-devops',
        azureDevOps: {
          organization: 'acme', project: 'widgets', featureType: 'Issue', bugType: 'Issue',
          processTemplate: 'basic', stateMapping: {},
        },
      },
      git: { prTarget: 'main' },
    });
    const outputs = renderAll(root);
    const mcp = outputs.find((o) => o.path === '.mcp.json');
    assert.ok(mcp, '.mcp.json should be produced for azure-devops');
    assert.match(mcp.content, /@azure-devops\/mcp@2/, 'the ADO MCP server must be pinned to a major');
  } finally {
    cleanup();
  }
});

const AGENT_DEV_PATHS = [
  path.join('.claude', 'skills', 'agent-dev', 'SKILL.md'),
  path.join('.agents', 'skills', 'agent-dev', 'SKILL.md'),
  path.join('.agents', 'skills', 'agent-dev', 'agents', 'openai.yaml'),
  path.join('.opencode', 'skills', 'agent-dev', 'SKILL.md'),
];

test('renderAll emits only the agent-dev skill plus the ticketing and cost includes', () => {
  const { root, cleanup } = tmpProject();
  try {
    const paths = renderAll(root).map((o) => o.path).sort();
    assert.deepEqual(paths, [...AGENT_DEV_PATHS, '.agents/includes/cost.md', '.agents/includes/ticketing.md'].sort());
  } finally {
    cleanup();
  }
});

test('agent-dev enters the superpowers workflow and defers ticketing and cost to the includes', () => {
  const { root, cleanup } = tmpProject();
  try {
    const outputs = renderAll(root);
    for (const p of AGENT_DEV_PATHS.filter((p) => p.endsWith('SKILL.md'))) {
      const body = outputs.find((o) => o.path === p).content;
      assert.match(body, /superpowers:brainstorming/, `${p} must enter the workflow via superpowers:brainstorming`);
      const entrySkills = ['superpowers:brainstorming', 'superpowers:writing-plans'];
      assert.deepEqual(body.match(/superpowers:[\w-]+/g).filter((s) => !entrySkills.includes(s)), [],
        `${p} must name only entry skills, not restate superpowers' internal chain`);
      assert.match(body, /\.agents\/includes\/ticketing\.md/);
      assert.match(body, /\.agents\/includes\/cost\.md/);
      assert.match(body, /Implementation Summary/);
      assert.match(body, /partial/i, 'failed or interrupted runs offer a partial cost summary');
      assert.match(body, /draft pull request/i, 'a finished run hands off through a draft PR');
      assert.match(body, /`<number>_<short_title_slug>`/, 'branch name derives from the ticket');
      assert.match(body, /`<number>: <short title>`/, 'PR title derives from the ticket');
      assert.match(body, /create a ticket/i, 'without a ticket, offer to create one');
      assert.match(body, /post the spec on it as\s+`Approved Spec` comments/i, 'the approved spec goes onto the ticket as comments');
      assert.doesNotMatch(body, /attach|Approved Plan/i, 'no attachments, and the plan stays in the repo');
      assert.doesNotMatch(body, /\{\{.*?\}\}/);
    }
  } finally {
    cleanup();
  }
});

test('the cost include totals the unified ccusage report over a time window, including partial runs', () => {
  const { root, cleanup } = tmpProject();
  try {
    const cost = renderAll(root).find((o) => o.path === '.agents/includes/cost.md').content;
    assert.match(cost, /ccusage@20 session --json --since/, 'one pinned, harness-agnostic command');
    assert.doesNotMatch(cost, /ccusage@latest|ccusage (claude|codex|opencode) /, 'no floating version, no per-harness commands');
    assert.match(cost, /metadata\.lastActivity/);
    assert.match(cost, /unpricedModels/, 'unpriced models must be named, not reported as $0');
    assert.match(cost, /Cost Summary/);
    assert.match(cost, /partial/i);
    assert.doesNotMatch(cost, /ledger|Developer Journal|code-review|qa-engineer/i, 'no ledger or per-role breakdown');
    assert.doesNotMatch(cost, /\{\{.*?\}\}/);
  } finally {
    cleanup();
  }
});

const BACKENDS = {
  file: {
    project: {
      project: { name: 'File Demo' },
      repository: { slug: 'me/file-demo' },
      ticketing: { backend: 'file', file: { dir: '.tickets/issues', metadataFile: '.tickets/metadata.json' } },
      git: { prTarget: 'main' },
    },
    review: /status: review/,
    draft: /gh pr create --draft/,
    create: /next_id/,
    spec: /## Approved Spec\n`<spec path>`\nBODY_EOF/,
  },
  github: {
    project: {
      project: { name: 'GH Demo' },
      repository: { slug: 'me/gh-demo' },
      ticketing: { backend: 'github' },
      git: { prTarget: 'main' },
    },
    review: /status:review/,
    draft: /gh pr create --draft/,
    create: /gh issue create/,
    spec: /## Approved Spec[\s\S]*gh issue comment/,
  },
  gitea: {
    project: {
      project: { name: 'Gitea Demo' },
      repository: { slug: 'me/gitea-demo' },
      ticketing: { backend: 'gitea', gitea: { login: 'myserver' } },
      git: { prTarget: 'main' },
    },
    review: /status:review/,
    draft: /--title "WIP: /,
    create: /tea issues create/,
    spec: /## Approved Spec[\s\S]*tea comments add/,
  },
  'azure-devops': {
    project: {
      project: { name: 'ADO Demo' },
      repository: { slug: 'ado-repo' },
      ticketing: { backend: 'azure-devops', azureDevOps: { organization: 'contoso', project: 'widgets' } },
      git: { prTarget: 'main' },
    },
    review: /status:review/,
    draft: /--draft true/,
    create: /wit_work_item_write\(action: "create"/,
    spec: /## Approved Spec[\s\S]*wit_work_item_comment_write/,
  },
};

for (const [backend, spec] of Object.entries(BACKENDS)) {
  test(`${backend} ticketing include is slim: read, comment, in-progress/review, PR — no journal or templates`, () => {
    const { root, cleanup } = makeTmpRoot();
    try {
      writeProject(root, spec.project);
      const include = renderAll(root).find((o) => o.path === '.agents/includes/ticketing.md');
      assert.ok(include, `the ticketing include should be produced for ${backend}`);
      assert.match(include.content, spec.review, 'the include must show the move to review');
      assert.match(include.content, /## Pull Requests/);
      assert.match(include.content, spec.draft, 'finished work is handed off as a draft PR');
      assert.match(include.content, spec.create, 'the include must show how to create a ticket');
      assert.match(include.content, /## Post the spec/);
      assert.match(include.content, spec.spec, 'the include must show how the spec is posted as a comment');
      assert.doesNotMatch(include.content, /"rel": "AttachedFile"|--resource attachments|<details>/, 'the spec is a readable comment, not an attachment');
      assert.doesNotMatch(include.content, /Upstream|feat\//, 'naming derives from the ticket itself, not an upstream reference or pattern');
      assert.doesNotMatch(include.content, /Journal|Issue Body Templates|Work Item Body Templates|acceptance-test|Developer Handoff/);
      assert.doesNotMatch(include.content, /\{\{.*?\}\}/, 'include must fully resolve');
      assert.ok(include.content.length < 6000, `${backend} include should stay small (${include.content.length} bytes)`);
    } finally {
      cleanup();
    }
  });
}

test('azure-devops backend emits Codex project-local ADO MCP config', () => {
  const { root, cleanup } = makeTmpRoot();
  try {
    writeProject(root, {
      project: { name: 'ADO' },
      repository: { slug: 'ado' },
      ticketing: {
        backend: 'azure-devops',
        azureDevOps: {
          organization: 'acme', project: 'widgets', featureType: 'Issue', bugType: 'Issue',
          processTemplate: 'basic', stateMapping: {},
        },
      },
      git: { prTarget: 'main' },
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
      project: { name: 'ADO' },
      repository: { slug: 'ado' },
      ticketing: {
        backend: 'azure-devops',
        azureDevOps: {
          organization: 'new-org', project: 'widgets', featureType: 'Issue', bugType: 'Issue',
          processTemplate: 'basic', stateMapping: {},
        },
      },
      git: { prTarget: 'main' },
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
      project: { name: 'ADO' },
      repository: { slug: 'ado' },
      ticketing: { backend: 'azure-devops', azureDevOps: { project: 'widgets' } },
      git: { prTarget: 'main' },
    });
    assert.throws(() => renderAll(root), /organization is required/);
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
    assert.equal(cfg.project.name, 'Test Project');
    // package-owned (from agent-src/config/ai-workflow.json)
    assert.ok(cfg.workflow, 'workflow states/artifacts come from the package');
    assert.equal(cfg.ticketing.includePath, '.agents/includes/ticketing.md');
    assert.equal(cfg.cost.includePath, '.agents/includes/cost.md');
    assert.ok(!('app' in cfg) && !('handoff' in cfg), 'the e2e and handoff includes are retired');
    assert.deepEqual(cfg.workflow.states.map((s) => s.id), ['new', 'in-progress', 'review']);
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

const AGENT_DEV = path.join('.claude', 'skills', 'agent-dev', 'SKILL.md');

test('agent-custom append.md is appended after the package body with tokens resolved', () => {
  const { root, cleanup } = tmpProject();
  try {
    writeCustom(root, 'skills/agent-dev/append.md', '## House rules\nAlways lint for {{project.name}}.\n');
    const dev = renderAll(root).find((o) => o.path === AGENT_DEV);
    // Package prose still present…
    assert.match(dev.content, /superpowers:brainstorming/);
    // …and the fragment is appended, with {{project.name}} resolved from MINIMAL_PROJECT.
    assert.match(dev.content, /## House rules\nAlways lint for Test Project\./);
    assert.doesNotMatch(dev.content, /\{\{.*?\}\}/);
    // Banner now points at both sources.
    assert.match(dev.content, /agent-src\/skills\/agent-dev \+ agent-custom\/skills\/agent-dev/);
  } finally {
    cleanup();
  }
});

test('agent-custom body.md fully overrides the package body', () => {
  const { root, cleanup } = tmpProject();
  try {
    writeCustom(root, 'skills/agent-dev/body.md', 'Custom agent-dev for {{project.name}} only.\n');
    const dev = renderAll(root).find((o) => o.path === AGENT_DEV);
    assert.match(dev.content, /Custom agent-dev for Test Project only\./);
    assert.doesNotMatch(dev.content, /superpowers:brainstorming/, 'package body must be gone');
    assert.doesNotMatch(dev.content, /\{\{.*?\}\}/);
  } finally {
    cleanup();
  }
});

test('agent-custom override and append combine (override is the base, append follows)', () => {
  const { root, cleanup } = tmpProject();
  try {
    writeCustom(root, 'skills/agent-dev/body.md', 'BASE override.\n');
    writeCustom(root, 'skills/agent-dev/append.md', 'EXTRA appended.\n');
    const dev = renderAll(root).find((o) => o.path === AGENT_DEV);
    // A blank-line separator sits between base and fragment (same as the overlay append).
    assert.match(dev.content, /BASE override\.\n\nEXTRA appended\./);
    assert.doesNotMatch(dev.content, /superpowers:brainstorming/);
  } finally {
    cleanup();
  }
});

test('an unresolved token in an agent-custom file throws through the pipeline guard', () => {
  const { root, cleanup } = tmpProject();
  try {
    writeCustom(root, 'skills/agent-dev/append.md', 'Uses {{nope}}.\n');
    assert.throws(() => renderAll(root), /no matching token/);
  } finally {
    cleanup();
  }
});

test('no agent-custom dir is a no-op: output identical to package-only render', () => {
  const a = tmpProject();
  const b = tmpProject();
  try {
    const bare = renderAll(a.root).find((o) => o.path === AGENT_DEV).content;
    writeCustom(b.root, 'skills/agent-dev/append.md', 'x\n');
    fs.rmSync(path.join(b.root, 'agent-custom'), { recursive: true, force: true });
    const removed = renderAll(b.root).find((o) => o.path === AGENT_DEV).content;
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
      project: { name: 'Gitea Demo' },
      repository: { slug: 'me/gitea-demo' },
      ticketing: { backend: 'gitea', gitea: { login: 'myserver' } },
      git: { prTarget: 'main' },
    });
    const outputs = renderAll(root);
    const include = outputs.find((o) => o.path === '.agents/includes/ticketing.md');
    assert.ok(include, 'the ticketing include should be produced for gitea');
    assert.match(include.content, /tea issues --login/, 'commands should be driven by the tea CLI');
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
      project: { name: 'Gitea Demo' },
      repository: { slug: 'me/gitea-demo' },
      ticketing: { backend: 'gitea' },
      git: { prTarget: 'main' },
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
      project: { name: 'Gitea Demo' },
      repository: { slug: 'me/gitea-demo' },
      // `tea login add` happily accepts spaces in a profile name, and real installs have them.
      ticketing: { backend: 'gitea', gitea: { login: 'gitea ki' } },
      git: { prTarget: 'main' },
    });
    const include = renderAll(root).find((o) => o.path === '.agents/includes/ticketing.md');
    const bare = include.content.match(/--login (?!")\S*/g) || [];
    assert.deepEqual(bare, [], `every --login value must be quoted, found: ${bare.join(', ')}`);
    assert.match(include.content, /--login "gitea ki"/);
  } finally {
    cleanup();
  }
});

