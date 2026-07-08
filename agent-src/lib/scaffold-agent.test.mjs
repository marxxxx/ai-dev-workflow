// Unit tests for the coding-agent scaffolding handoff: prompt content, adapter dispatch, and
// the never-throw contract. No real CLI is launched — `spawn` is stubbed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AGENT_ADAPTERS, buildScaffoldPrompt, runScaffoldAgent } from '../generate.mjs';

const CONFIG = {
  project: { name: 'Demo App' },
  e2e: { up: 'scripts/e2e-up', down: 'scripts/e2e-down', logsDir: '.e2e/logs' },
};

test('buildScaffoldPrompt embeds the contract, AGENTS.md, and configured script paths', () => {
  const prompt = buildScaffoldPrompt(CONFIG);
  assert.match(prompt, /BASE_URL=<url>/);
  assert.match(prompt, /AGENTS\.md/);
  assert.match(prompt, /scripts\/e2e-up/);
  assert.match(prompt, /scripts\/e2e-down/);
  assert.match(prompt, /Demo App/);
});

test('buildScaffoldPrompt tolerates a config without an e2e block', () => {
  const prompt = buildScaffoldPrompt({});
  assert.match(prompt, /scripts\/e2e-up/);
  assert.match(prompt, /scripts\/e2e-down/);
});

test('runScaffoldAgent invokes the adapter bin/args and passes the prompt on stdin', () => {
  for (const [agent, adapter] of Object.entries(AGENT_ADAPTERS)) {
    const calls = [];
    const spawn = (bin, args, opts) => { calls.push({ bin, args, opts }); return { status: 0 }; };
    const status = runScaffoldAgent(agent, { projectRoot: '/proj', config: CONFIG, spawn });
    assert.equal(status, 0);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].bin, adapter.bin);
    assert.deepEqual(calls[0].args, adapter.args);
    assert.equal(calls[0].opts.cwd, '/proj');
    assert.equal(calls[0].opts.input, buildScaffoldPrompt(CONFIG));
  }
});

test('runScaffoldAgent ignores an unknown agent without spawning or throwing', () => {
  let spawned = false;
  const spawn = () => { spawned = true; return { status: 0 }; };
  const status = runScaffoldAgent('nope', { projectRoot: '/proj', config: CONFIG, spawn });
  assert.equal(status, null);
  assert.equal(spawned, false);
});

test('runScaffoldAgent swallows a missing CLI (ENOENT)', () => {
  const spawn = () => ({ error: Object.assign(new Error('spawn claude ENOENT'), { code: 'ENOENT' }) });
  const status = runScaffoldAgent('claude', { projectRoot: '/proj', config: CONFIG, spawn });
  assert.equal(status, null);
});

test('runScaffoldAgent reports a non-zero exit but does not throw', () => {
  const spawn = () => ({ status: 2 });
  const status = runScaffoldAgent('codex', { projectRoot: '/proj', config: CONFIG, spawn });
  assert.equal(status, 2);
});
