import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createScriptedPrompter } from '../../agent-src/lib/onboard.mjs';
import { makePrompter, runSetup, stepContainerFiles, stepProjectConfig } from './setup.mjs';

const tmp = () => mkdtempSync(path.join(tmpdir(), 'adw-setup-'));
const noop = { log() {}, error() {} };

test('stepProjectConfig: runs the init interview on yes, not without an answer', async () => {
  const root = tmp();
  const calls = [];
  const d = { ...noop, cmdInit: async (r, o) => { calls.push([r, o]); return 0; } };
  const prompter = createScriptedPrompter({ setup: { init: 'y' } });
  await stepProjectConfig({ root, opts: {}, d, prompter, state: {} });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], root);
  assert.equal(calls[0][1].prompter, prompter);
  await stepProjectConfig({ root, opts: {}, d, prompter: createScriptedPrompter({}), state: {} });
  assert.equal(calls.length, 1);
  rmSync(root, { recursive: true });
});

test('stepProjectConfig: nothing to do with an ai-project.json or without a prompter', async () => {
  const root = tmp();
  const d = { ...noop, cmdInit: async () => { throw new Error('no'); } };
  await stepProjectConfig({ root, opts: {}, d, prompter: null, state: {} });
  writeFileSync(path.join(root, 'ai-project.json'), '{}');
  await stepProjectConfig({ root, opts: {}, d, prompter: createScriptedPrompter({ setup: { init: 'y' } }), state: {} });
  rmSync(root, { recursive: true });
});

test('stepContainerFiles: writes the files on yes and git-ignores .env.ai-dev', async () => {
  const root = tmp();
  writeFileSync(path.join(root, 'ai-project.json'), JSON.stringify({ ticketing: { backend: 'file' } }));
  const prompter = createScriptedPrompter({ setup: { container: 'y' }, container: { enabled: 'y', stack: 'node' } });
  await stepContainerFiles({ root, opts: {}, d: noop, prompter, state: {} });
  assert.ok(existsSync(path.join(root, 'compose.ai-dev.yml')));
  assert.match(readFileSync(path.join(root, '.gitignore'), 'utf8'), /\.env\.ai-dev/);
  rmSync(root, { recursive: true });
});

test('stepContainerFiles: no question when compose.ai-dev.yml exists; no write without an answer', async () => {
  const root = tmp();
  const asked = [];
  const prompter = { ...createScriptedPrompter({}), ask: async (q) => { asked.push(q); return 'y'; } };
  writeFileSync(path.join(root, 'compose.ai-dev.yml'), 'services: {}\n');
  await stepContainerFiles({ root, opts: {}, d: noop, prompter, state: {} });
  assert.deepEqual(asked, []);
  rmSync(path.join(root, 'compose.ai-dev.yml'));
  await stepContainerFiles({ root, opts: {}, d: noop, prompter: createScriptedPrompter({}), state: {} });
  assert.equal(existsSync(path.join(root, 'compose.ai-dev.yml')), false);
  rmSync(root, { recursive: true });
});

test('makePrompter: null without interactivity, scripted for --answers, close is a no-op', () => {
  const tty = { stdin: true, stdout: true };
  const no = { stdin: false, stdout: false };
  assert.equal(makePrompter({ noInput: true, answers: null }, { isTTY: tty }), null);
  assert.equal(makePrompter({ noInput: true, answers: 'a.json' }, { isTTY: tty }), null);
  assert.equal(makePrompter({ noInput: false, answers: null }, { isTTY: no }), null);
  const root = tmp();
  const file = path.join(root, 'a.json');
  writeFileSync(file, JSON.stringify({ setup: { init: 'y' } }));
  const p = makePrompter({ noInput: false, answers: file }, { isTTY: no });
  assert.equal(p.scripted, true);
  p.close();
  rmSync(root, { recursive: true });
});

test('runSetup: without a prompter returns the empty state; closes a real prompter', async () => {
  const root = tmp();
  assert.deepEqual(await runSetup({ root, opts: {}, d: noop, prompter: null }), { envAdditions: {}, ticketText: null });
  let closed = 0;
  const prompter = { ...createScriptedPrompter({}), close: () => {}, closeReal: () => { closed++; } };
  await runSetup({ root, opts: {}, d: noop, prompter });
  assert.equal(closed, 1);
  rmSync(root, { recursive: true });
});
