import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fallbackCommand } from '../../e2e/local/answerer.mjs';
import { acpCommand as e2eAcpCommand } from '../../e2e/local/session.mjs';
import { acpCommand, openingText, prepareHarness, resolveCli } from './harness.mjs';

const HARNESSES = ['claude-code', 'codex', 'opencode'];
const tmp = () => mkdtempSync(join(tmpdir(), 'adw-harness-'));

test('openingText starts agent-dev with / for Claude Code and $ for the others', () => {
  assert.equal(openingText('claude-code', 'PROJ-1'), '/agent-dev PROJ-1');
  assert.equal(openingText('codex', 'PROJ-1'), '$agent-dev PROJ-1');
  assert.equal(openingText('opencode', 'PROJ-1'), '$agent-dev PROJ-1');
});

test('openingText embeds the task verbatim', () => {
  const task = '--help; $(x)\nnext';
  assert.equal(openingText('codex', task), `$agent-dev ${task}`);
});

test('openingText equals the e2e fallbackCommand (drift guard)', () => {
  for (const harness of HARNESSES) assert.equal(openingText(harness, 'T-9 x'), fallbackCommand(harness, 'T-9 x'));
});

test('acpCommand equals the e2e copy for every harness (drift guard)', () => {
  for (const harness of HARNESSES) {
    for (const model of [null, 'anthropic/some model']) {
      for (const cli of [null, '/usr/local/bin/agent']) {
        assert.deepEqual(acpCommand(harness, model, { cli }), e2eAcpCommand(harness, model, { cli }));
      }
    }
    assert.deepEqual(acpCommand(harness, null), e2eAcpCommand(harness, null));
  }
  assert.throws(() => acpCommand('vim', null), /unknown harness/);
});

test('resolveCli finds the harness CLI on PATH and is null for opencode or when absent', () => {
  const bin = tmp();
  const other = tmp();
  writeFileSync(join(bin, 'claude'), '#!/bin/sh\n');
  chmodSync(join(bin, 'claude'), 0o755);
  writeFileSync(join(other, 'codex'), '#!/bin/sh\n'); // not executable
  const pathEnv = `${other}:${bin}`;
  assert.equal(resolveCli('claude-code', pathEnv), join(bin, 'claude'));
  assert.equal(resolveCli('codex', pathEnv), null);
  assert.equal(resolveCli('opencode', pathEnv), null);
  assert.equal(resolveCli('claude-code', ''), null);
});

test('prepareHarness starts Claude Code in Manual mode and keeps what is in settings.json', () => {
  const home = tmp();
  prepareHarness('claude-code', { home });
  const file = join(home, '.claude', 'settings.json');
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { permissions: { defaultMode: 'default' } });
  assert.equal(statSync(file).mode & 0o777, 0o600);

  writeFileSync(file, JSON.stringify({ theme: 'dark', permissions: { allow: ['Bash(ls)'] } }));
  prepareHarness('claude-code', { home });
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { theme: 'dark', permissions: { defaultMode: 'default', allow: ['Bash(ls)'] } });

  writeFileSync(file, JSON.stringify({ permissions: { defaultMode: 'plan' } }));
  prepareHarness('claude-code', { home });
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).permissions.defaultMode, 'plan');
});

test('prepareHarness refuses to overwrite a settings.json it cannot parse', () => {
  const home = tmp();
  mkdirSync(join(home, '.claude'));
  const file = join(home, '.claude', 'settings.json');
  writeFileSync(file, '{ nope');
  assert.throws(() => prepareHarness('claude-code', { home }), /settings\.json/);
  assert.equal(readFileSync(file, 'utf8'), '{ nope');
});

test('prepareHarness leaves Codex and OpenCode alone', () => {
  const home = tmp();
  prepareHarness('codex', { home });
  prepareHarness('opencode', { home });
  assert.throws(() => statSync(join(home, '.claude')));
  assert.throws(() => prepareHarness('vim', { home }), /unknown harness/);
});
