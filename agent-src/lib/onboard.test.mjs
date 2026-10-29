// In-process onboarding tests: drive cmdInit with a scripted prompter (no TTY, no subprocess)
// and assert the written config matches buildProjectConfig of the same answers.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { cmdInit, createScriptedPrompter, buildProjectConfig } from '../generate.mjs';
import { makeTmpRoot } from '../test-helpers.mjs';

/** Collect console.log output until restore(). */
function captureLog() {
  const lines = [];
  const orig = console.log;
  console.log = (...a) => lines.push(a.join(' '));
  return { text: () => lines.join('\n'), restore: () => { console.log = orig; } };
}

const FILE_ANSWERS = {
  name: 'File Demo',
  repoSlug: 'me/file-demo', backend: 'file',
  file: { dir: '.tickets/issues', metadataFile: '.tickets/metadata.json' },
  prTarget: 'main',
};

const GITHUB_ANSWERS = {
  name: 'GH Demo',
  repoSlug: 'me/gh-demo', backend: 'github',
  prTarget: 'main',
};

const AZURE_ANSWERS = {
  name: 'ADO Demo',
  repoSlug: 'ado-demo', backend: 'azure-devops',
  azure: { organization: 'acme', project: 'widgets', processTemplate: 'scrum' },
  prTarget: 'main',
};

const GITEA_ANSWERS = {
  name: 'Gitea Demo',
  repoSlug: 'me/gitea-demo', backend: 'gitea',
  gitea: { login: 'myserver' },
  prTarget: 'main',
};

for (const answers of [FILE_ANSWERS, GITHUB_ANSWERS, AZURE_ANSWERS, GITEA_ANSWERS]) {
  test(`cmdInit (${answers.backend}) writes buildProjectConfig(answers) and nothing else`, async () => {
    const { root, cleanup } = makeTmpRoot();
    try {
      const code = await cmdInit(root, { prompter: createScriptedPrompter(answers) });
      assert.equal(code, 0);

      const written = JSON.parse(fs.readFileSync(path.join(root, 'ai-project.json'), 'utf8'));
      // An answers file without skills.show-me declines it, like container.enabled.
      assert.deepEqual(written, { ...buildProjectConfig(answers), skills: { 'show-me': false } });

      assert.deepEqual(fs.readdirSync(root), ['ai-project.json'], 'init wrote files beyond ai-project.json');
    } finally {
      cleanup();
    }
  });
}

test('cmdInit writes no e2e block, no scripts, and no AGENTS.md, and never spawns', async () => {
  const { root, cleanup } = makeTmpRoot();
  try {
    let spawned = false;
    const spawn = () => { spawned = true; return { status: 0 }; };
    const code = await cmdInit(root, { prompter: createScriptedPrompter(FILE_ANSWERS), spawn });
    assert.equal(code, 0);
    assert.equal(spawned, false, 'onboarding no longer hands off to a coding agent');

    const written = JSON.parse(fs.readFileSync(path.join(root, 'ai-project.json'), 'utf8'));
    assert.ok(!('e2e' in written), 'no e2e block is written');

    assert.equal(fs.existsSync(path.join(root, 'scripts', 'e2e-up')), false, 'no e2e-up scaffolded');
    assert.equal(fs.existsSync(path.join(root, 'scripts', 'e2e-down')), false, 'no e2e-down scaffolded');
    assert.equal(fs.existsSync(path.join(root, 'AGENTS.md')), false, 'AGENTS.md is user-owned via native /init');
  } finally {
    cleanup();
  }
});

test('cmdInit leaves an existing ai-project.json untouched when overwrite is declined', async () => {
  const { root, cleanup } = makeTmpRoot();
  try {
    const dest = path.join(root, 'ai-project.json');
    fs.writeFileSync(dest, '{"keep":true}');
    // No `overwrite` key → scripted prompter falls back to the 'N' default → declined.
    const code = await cmdInit(root, { prompter: createScriptedPrompter(FILE_ANSWERS) });
    assert.equal(code, 0);
    assert.deepEqual(JSON.parse(fs.readFileSync(dest, 'utf8')), { keep: true });
  } finally {
    cleanup();
  }
});

test('cmdInit overwrites an existing ai-project.json when overwrite is accepted', async () => {
  const { root, cleanup } = makeTmpRoot();
  try {
    const dest = path.join(root, 'ai-project.json');
    fs.writeFileSync(dest, '{"keep":true}');
    const code = await cmdInit(root, { prompter: createScriptedPrompter({ ...FILE_ANSWERS, overwrite: 'y' }) });
    assert.equal(code, 0);
    assert.deepEqual(JSON.parse(fs.readFileSync(dest, 'utf8')), { ...buildProjectConfig(FILE_ANSWERS), skills: { 'show-me': false } });
  } finally {
    cleanup();
  }
});

test('cmdInit asks only for name and repository slug as identity; the PR target defaults to main', async () => {
  const { root, cleanup } = makeTmpRoot();
  try {
    const answers = { name: 'Min', repoSlug: 'me/min', backend: 'github' };
    assert.equal(await cmdInit(root, { prompter: createScriptedPrompter(answers) }), 0);
    const written = JSON.parse(fs.readFileSync(path.join(root, 'ai-project.json'), 'utf8'));
    assert.deepEqual(written.project, { name: 'Min' });
    assert.deepEqual(written.repository, { slug: 'me/min' });
    assert.deepEqual(written.git, { prTarget: 'main' });
  } finally {
    cleanup();
  }
});

test('cmdInit with container.enabled y writes the container files for the chosen stack', async () => {
  const { root, cleanup } = makeTmpRoot();
  try {
    const answers = { ...GITHUB_ANSWERS, container: { enabled: 'y', stack: 'dotnet' } };
    assert.equal(await cmdInit(root, { prompter: createScriptedPrompter(answers) }), 0);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, 'ai-project.json'), 'utf8')), { ...buildProjectConfig(GITHUB_ANSWERS), skills: { 'show-me': false } },
      'container answers are not stored in ai-project.json');
    assert.ok(fs.readFileSync(path.join(root, 'compose.ai-dev.yml'), 'utf8').includes('marxx/ai-dev-workflow:dotnet-latest'));
    assert.ok(fs.readFileSync(path.join(root, 'AI-DEV.md'), 'utf8').includes('gh auth setup-git'));
    for (const f of ['compose.ai-dev.certs.yml', 'ai-dev.sh', 'ai-dev.ps1', '.gitignore', '.gitattributes']) {
      assert.ok(fs.existsSync(path.join(root, f)), f);
    }
  } finally {
    cleanup();
  }
});

test('cmdInit container without dind or certs answers writes no .env.ai-dev', async () => {
  const { root, cleanup } = makeTmpRoot();
  try {
    const answers = { ...GITHUB_ANSWERS, container: { enabled: 'y', stack: 'generic' } };
    assert.equal(await cmdInit(root, { prompter: createScriptedPrompter(answers) }), 0);
    assert.ok(!fs.existsSync(path.join(root, '.env.ai-dev')));
  } finally {
    cleanup();
  }
});

test('cmdInit with container.dind y sets AGENT_DIND=1 and prints the isolation warning', async () => {
  const { root, cleanup } = makeTmpRoot();
  const out = captureLog();
  try {
    const answers = { ...GITHUB_ANSWERS, container: { enabled: 'y', stack: 'generic', dind: 'y' } };
    assert.equal(await cmdInit(root, { prompter: createScriptedPrompter(answers) }), 0);
    assert.equal(fs.readFileSync(path.join(root, '.env.ai-dev'), 'utf8'), 'AGENT_DIND=1\n');
    assert.match(out.text(), /root-equivalent/);
  } finally {
    out.restore();
    cleanup();
  }
});

test('cmdInit with container.certs y and a directory sets AGENT_CA_DIR to it', async () => {
  const { root, cleanup } = makeTmpRoot();
  try {
    const caDir = path.join(root, 'certs');
    fs.mkdirSync(caDir);
    const answers = { ...GITHUB_ANSWERS, container: { enabled: 'y', stack: 'generic', certs: 'y', caDir } };
    assert.equal(await cmdInit(root, { prompter: createScriptedPrompter(answers) }), 0);
    assert.equal(fs.readFileSync(path.join(root, '.env.ai-dev'), 'utf8'), `AGENT_CA_DIR=${caDir}\n`);
  } finally {
    cleanup();
  }
});

test('cmdInit with container.certs y and no directory writes an empty AGENT_CA_DIR and a hint', async () => {
  const { root, cleanup } = makeTmpRoot();
  const out = captureLog();
  try {
    const answers = { ...GITHUB_ANSWERS, container: { enabled: 'y', stack: 'generic', dind: 'y', certs: 'y' } };
    assert.equal(await cmdInit(root, { prompter: createScriptedPrompter(answers) }), 0);
    assert.equal(fs.readFileSync(path.join(root, '.env.ai-dev'), 'utf8'), 'AGENT_DIND=1\nAGENT_CA_DIR=\n');
    assert.match(out.text(), /AGENT_CA_DIR is empty/);
  } finally {
    out.restore();
    cleanup();
  }
});

test('cmdInit container stack defaults to the detected one', async () => {
  const { root, cleanup } = makeTmpRoot();
  try {
    fs.writeFileSync(path.join(root, 'package.json'), '{}');
    const answers = { ...FILE_ANSWERS, container: { enabled: 'y' } };
    assert.equal(await cmdInit(root, { prompter: createScriptedPrompter(answers) }), 0);
    assert.ok(fs.readFileSync(path.join(root, 'compose.ai-dev.yml'), 'utf8').includes('marxx/ai-dev-workflow:node-latest'));
  } finally {
    cleanup();
  }
});

test('cmdInit with declined overwrite still writes container files from the existing config', async () => {
  const { root, cleanup } = makeTmpRoot();
  try {
    const dest = path.join(root, 'ai-project.json');
    const existing = JSON.stringify(buildProjectConfig(GITEA_ANSWERS), null, 2) + '\n';
    fs.writeFileSync(dest, existing);
    const answers = { container: { enabled: 'y', stack: 'generic' } };
    assert.equal(await cmdInit(root, { prompter: createScriptedPrompter(answers) }), 0);
    assert.equal(fs.readFileSync(dest, 'utf8'), existing);
    assert.match(fs.readFileSync(path.join(root, 'compose.ai-dev.yml'), 'utf8'), /^name: gitea-demo-ai$/m);
    assert.ok(fs.readFileSync(path.join(root, 'AI-DEV.md'), 'utf8').includes('myserver'));
  } finally {
    cleanup();
  }
});

test('cmdInit with declined overwrite and an incomplete ai-project.json falls back to dir name and file backend', async () => {
  const { root, cleanup } = makeTmpRoot();
  try {
    fs.writeFileSync(path.join(root, 'ai-project.json'), '{"keep":true}');
    const answers = { container: { enabled: 'y', stack: 'generic' } };
    assert.equal(await cmdInit(root, { prompter: createScriptedPrompter(answers) }), 0);
    const slug = path.basename(root).toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
    assert.ok(fs.readFileSync(path.join(root, 'compose.ai-dev.yml'), 'utf8').includes(`name: ${slug}-ai`));
    assert.ok(!fs.readFileSync(path.join(root, 'AI-DEV.md'), 'utf8').includes('gh auth'));
  } finally {
    cleanup();
  }
});

test('cmdInit declining both overwrite and container writes nothing', async () => {
  const { root, cleanup } = makeTmpRoot();
  try {
    fs.writeFileSync(path.join(root, 'ai-project.json'), '{"keep":true}');
    const answers = { container: { enabled: 'n' } };
    assert.equal(await cmdInit(root, { prompter: createScriptedPrompter(answers) }), 0);
    assert.deepEqual(fs.readdirSync(root), ['ai-project.json']);
  } finally {
    cleanup();
  }
});

/** A fake `npx skills add` runner that records its calls. */
function fakeSkillRun({ fail = false } = {}) {
  const calls = [];
  return { calls, run: (args, cwd) => { calls.push({ args, cwd }); return fail ? { ok: false, message: 'offline' } : { ok: true }; } };
}

test('cmdInit with skills.show-me y records the opt-in and installs the pinned skill', async () => {
  const { root, cleanup } = makeTmpRoot();
  const log = captureLog();
  try {
    const { run, calls } = fakeSkillRun();
    const prompter = createScriptedPrompter({ ...FILE_ANSWERS, skills: { 'show-me': 'y' } });
    assert.equal(await cmdInit(root, { prompter, runSkill: run }), 0);
    const written = JSON.parse(fs.readFileSync(path.join(root, 'ai-project.json'), 'utf8'));
    assert.deepEqual(written.skills, { 'show-me': true });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].cwd, root);
    assert.ok(calls[0].args.some((a) => a.includes('humanlayer/skills/tree/')), calls[0].args.join(' '));
    assert.match(log.text(), /Installed show-me/);
  } finally {
    log.restore();
    cleanup();
  }
});

test('cmdInit without a show-me answer in scripted mode installs nothing', async () => {
  const { root, cleanup } = makeTmpRoot();
  try {
    const { run, calls } = fakeSkillRun();
    assert.equal(await cmdInit(root, { prompter: createScriptedPrompter(FILE_ANSWERS), runSkill: run }), 0);
    assert.equal(calls.length, 0);
  } finally {
    cleanup();
  }
});

test('cmdInit still succeeds when the show-me install fails, and prints the manual command', async () => {
  const { root, cleanup } = makeTmpRoot();
  const warnings = [];
  const orig = console.warn;
  console.warn = (...a) => warnings.push(a.join(' '));
  try {
    const { run } = fakeSkillRun({ fail: true });
    const prompter = createScriptedPrompter({ ...FILE_ANSWERS, skills: { 'show-me': 'y' } });
    assert.equal(await cmdInit(root, { prompter, runSkill: run }), 0);
    assert.match(warnings.join('\n'), /show-me could not be installed: offline[\s\S]*npx --yes skills@/);
    assert.ok(fs.existsSync(path.join(root, 'ai-project.json')));
  } finally {
    console.warn = orig;
    cleanup();
  }
});

test('scripted askSecret: trimmed value, empty when absent', async () => {
  const p = createScriptedPrompter({ a: { b: ' t ' } });
  assert.equal(await p.askSecret('x', 'a.b'), 't');
  assert.equal(await p.askSecret('x', 'a.c'), '');
});
