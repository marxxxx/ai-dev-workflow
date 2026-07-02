// In-process onboarding tests: drive cmdInit with a scripted prompter (no TTY, no subprocess)
// and assert the written config matches buildProjectConfig of the same answers.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { cmdInit, createScriptedPrompter, buildProjectConfig, renderSetupDoc } from '../generate.mjs';
import { makeTmpRoot } from '../test-helpers.mjs';

const FILE_ANSWERS = {
  name: 'File Demo', slug: 'file-demo', serena: 'file-demo', description: 'A file project',
  repoSlug: 'me/file-demo', defaultBranch: 'main', backend: 'file', itemNoun: 'issue',
  file: { dir: '.tickets/issues', metadataFile: '.tickets/metadata.json' },
  branchPattern: 'feat/<issue-number>_<slug>', prTarget: 'main',
};

const GITHUB_ANSWERS = {
  name: 'GH Demo', slug: 'gh-demo', serena: 'gh-demo', description: '',
  repoSlug: 'me/gh-demo', defaultBranch: 'main', backend: 'github', itemNoun: 'issue',
  branchPattern: 'feat/<issue-number>_<slug>', prTarget: 'main',
};

const AZURE_ANSWERS = {
  name: 'ADO Demo', slug: 'ado-demo', serena: 'ado-demo', description: '',
  repoSlug: 'ado-demo', defaultBranch: 'main', backend: 'azure-devops', itemNoun: 'work item',
  azure: { organization: 'acme', project: 'widgets', processTemplate: 'scrum' },
  branchPattern: 'feat/<issue-number>_<slug>', prTarget: 'main',
};

for (const answers of [FILE_ANSWERS, GITHUB_ANSWERS, AZURE_ANSWERS]) {
  test(`cmdInit (${answers.backend}) writes buildProjectConfig(answers) + setup doc`, async () => {
    const { root, cleanup } = makeTmpRoot();
    try {
      const code = await cmdInit(root, { prompter: createScriptedPrompter(answers) });
      assert.equal(code, 0);

      const written = JSON.parse(fs.readFileSync(path.join(root, 'ai-project.json'), 'utf8'));
      assert.deepEqual(written, buildProjectConfig(answers));

      const setupPath = path.join(root, 'docs', 'ai-workflow-setup.md');
      assert.ok(fs.existsSync(setupPath));
      assert.equal(fs.readFileSync(setupPath, 'utf8'), renderSetupDoc(written));
    } finally {
      cleanup();
    }
  });
}

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
