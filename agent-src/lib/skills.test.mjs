// In-process tests for the third-party skill installs (show-me): the opt-in recorded in
// ai-project.json, the pinned `npx skills add` call, and the drift warnings. `run` is injected,
// so nothing touches the network.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  loadSkillPins, installArgs, manualCommand, skillWarnings, syncSkills, installSkills,
} from './skills.mjs';
import { makeTmpRoot, MINIMAL_PROJECT } from '../test-helpers.mjs';

const PINS = {
  cli: '1.7.4',
  skills: { 'show-me': { repository: 'humanlayer/skills', path: 'plugins/show-me/skills/show-me', revision: 'a'.repeat(40) } },
};

/** A fake `npx skills add` that records its calls and writes the lock entry like the real CLI. */
function fakeRun({ fail = false } = {}) {
  const calls = [];
  const run = (args, cwd) => {
    calls.push({ args, cwd });
    if (fail) return { ok: false, message: 'network down' };
    const [, , revision] = /\/tree\/([0-9a-f]+)\//.exec(args[3]) ?? [];
    writeLock(cwd, { 'show-me': revision });
    return { ok: true };
  };
  return { run, calls };
}

function writeLock(root, refs) {
  const skills = Object.fromEntries(Object.entries(refs).map(([name, ref]) => [name, { source: 'humanlayer/skills', ref }]));
  fs.writeFileSync(path.join(root, 'skills-lock.json'), JSON.stringify({ version: 1, skills }, null, 2));
}

function writeProject(root, extra = {}) {
  fs.writeFileSync(path.join(root, 'ai-project.json'), JSON.stringify({ ...MINIMAL_PROJECT, ...extra }, null, 2) + '\n');
}

const readProject = (root) => JSON.parse(fs.readFileSync(path.join(root, 'ai-project.json'), 'utf8'));

test('the shipped pins name show-me at a full commit and an exact skills CLI version', () => {
  const pins = loadSkillPins();
  assert.match(pins.cli, /^\d+\.\d+\.\d+$/);
  assert.equal(pins.skills['show-me'].repository, 'humanlayer/skills');
  assert.match(pins.skills['show-me'].revision, /^[0-9a-f]{40}$/);
});

test('installArgs pins the CLI version and the commit, for all three harnesses, without prompts', () => {
  assert.deepEqual(installArgs(PINS, 'show-me'), [
    '--yes', 'skills@1.7.4', 'add',
    `https://github.com/humanlayer/skills/tree/${'a'.repeat(40)}/plugins/show-me/skills/show-me`,
    '-y', '-a', 'claude-code', 'codex', 'opencode',
  ]);
  assert.match(manualCommand(PINS, 'show-me'), /^npx --yes skills@1\.7\.4 add https:\/\/github\.com\/humanlayer\/skills\/tree\//);
});

test('syncSkills on a project without the key records the opt-in and installs the pin', () => {
  const { root, cleanup } = makeTmpRoot();
  try {
    writeProject(root);
    const { run, calls } = fakeRun();
    const result = syncSkills(root, { pins: PINS, run });
    assert.deepEqual(readProject(root).skills, { 'show-me': true });
    assert.deepEqual(result.recorded, ['show-me']);
    assert.deepEqual(result.installed, ['show-me']);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].cwd, root);
  } finally {
    cleanup();
  }
});

test('syncSkills leaves a current install alone and updates a stale one', () => {
  const { root, cleanup } = makeTmpRoot();
  try {
    writeProject(root, { skills: { 'show-me': true } });
    writeLock(root, { 'show-me': 'a'.repeat(40) });
    const current = fakeRun();
    assert.deepEqual(syncSkills(root, { pins: PINS, run: current.run }).current, ['show-me']);
    assert.equal(current.calls.length, 0);

    writeLock(root, { 'show-me': 'b'.repeat(40) });
    const stale = fakeRun();
    assert.deepEqual(syncSkills(root, { pins: PINS, run: stale.run }).installed, ['show-me']);
    assert.equal(stale.calls.length, 1);
  } finally {
    cleanup();
  }
});

test('syncSkills respects an opt-out and never installs', () => {
  const { root, cleanup } = makeTmpRoot();
  try {
    writeProject(root, { skills: { 'show-me': false } });
    const { run, calls } = fakeRun();
    const result = syncSkills(root, { pins: PINS, run });
    assert.deepEqual(result.skipped, ['show-me']);
    assert.equal(calls.length, 0);
    assert.deepEqual(readProject(root).skills, { 'show-me': false });
  } finally {
    cleanup();
  }
});

test('syncSkills --dry-run reports what it would do and writes nothing', () => {
  const { root, cleanup } = makeTmpRoot();
  try {
    writeProject(root);
    const before = fs.readFileSync(path.join(root, 'ai-project.json'), 'utf8');
    const { run, calls } = fakeRun();
    const result = syncSkills(root, { pins: PINS, run, dryRun: true });
    assert.deepEqual(result.recorded, ['show-me']);
    assert.deepEqual(result.installed, ['show-me']);
    assert.equal(calls.length, 0);
    assert.equal(fs.readFileSync(path.join(root, 'ai-project.json'), 'utf8'), before);
  } finally {
    cleanup();
  }
});

test('syncSkills reports a failed install with the manual command instead of throwing', () => {
  const { root, cleanup } = makeTmpRoot();
  try {
    writeProject(root);
    const { run } = fakeRun({ fail: true });
    const result = syncSkills(root, { pins: PINS, run });
    assert.deepEqual(result.installed, []);
    assert.equal(result.failed.length, 1);
    assert.equal(result.failed[0].name, 'show-me');
    assert.match(result.failed[0].message, /network down/);
    assert.equal(result.failed[0].command, manualCommand(PINS, 'show-me'));
    assert.deepEqual(readProject(root).skills, { 'show-me': true }, 'the opt-in is still recorded');
  } finally {
    cleanup();
  }
});

test('installSkills installs only the named skills', () => {
  const { root, cleanup } = makeTmpRoot();
  try {
    const { run, calls } = fakeRun();
    assert.deepEqual(installSkills(root, [], { pins: PINS, run }).installed, []);
    assert.equal(calls.length, 0);
    assert.deepEqual(installSkills(root, ['show-me'], { pins: PINS, run }).installed, ['show-me']);
    assert.equal(calls.length, 1);
  } finally {
    cleanup();
  }
});

test('skillWarnings flags a missing or stale wanted skill and stays quiet otherwise', () => {
  const { root, cleanup } = makeTmpRoot();
  try {
    const project = { ...MINIMAL_PROJECT };
    assert.match(skillWarnings(root, project, PINS).join('\n'), /show-me is not installed.*upgrade/);
    writeLock(root, { 'show-me': 'b'.repeat(40) });
    assert.match(skillWarnings(root, project, PINS).join('\n'), /show-me is installed at b{7}.*pins a{7}.*upgrade/);
    writeLock(root, { 'show-me': 'a'.repeat(40) });
    assert.deepEqual(skillWarnings(root, project, PINS), []);
    fs.rmSync(path.join(root, 'skills-lock.json'));
    assert.deepEqual(skillWarnings(root, { ...project, skills: { 'show-me': false } }, PINS), []);
  } finally {
    cleanup();
  }
});
