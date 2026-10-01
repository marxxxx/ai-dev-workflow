// In-process onboarding tests: drive cmdInit with a scripted prompter (no TTY, no subprocess)
// and assert the written config matches buildProjectConfig of the same answers.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { cmdInit, createScriptedPrompter, buildProjectConfig } from '../generate.mjs';
import { makeTmpRoot } from '../test-helpers.mjs';

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
      assert.deepEqual(written, buildProjectConfig(answers));

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
    assert.deepEqual(JSON.parse(fs.readFileSync(dest, 'utf8')), buildProjectConfig(FILE_ANSWERS));
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
