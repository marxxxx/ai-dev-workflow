import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ccusageUsage } from './ccusage.mjs';
import { makeClaudeTrial, makeOpenCodeTrial } from './fixtures/make.mjs';

test('cross-check runs ccusage with an isolated HOME holding a copy of the sessions', () => {
  const dir = makeClaudeTrial(mkdtempSync(path.join(tmpdir(), 'adw-e2e-')));
  let seen;
  const run = (cmd, args, opts) => {
    seen = { cmd, args, home: opts.env.HOME, hasCopy: existsSync(path.join(opts.env.HOME, '.claude/projects/-workspace/abc.jsonl')) };
    return { status: 0, stdout: JSON.stringify({ totals: { totalTokens: 1801 } }) };
  };
  try {
    const r = ccusageUsage('claude-code', dir, { total: 1801 }, { run, version: '20.0.31' });
    assert.deepEqual(r, { ccusageTotal: 1801, deviation: 0, warning: null, cost: null, models: null });
    assert.equal(seen.cmd, 'npx');
    assert.deepEqual(seen.args, ['-y', 'ccusage@20.0.31', 'session', '--json', '--offline']);
    assert.equal(seen.hasCopy, true);
    assert.equal(existsSync(seen.home), false, 'isolated HOME is removed afterwards');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('deviation above 1% produces a warning; an unknown harness is skipped', () => {
  const dir = makeClaudeTrial(mkdtempSync(path.join(tmpdir(), 'adw-e2e-')));
  try {
    const run = () => ({ status: 0, stdout: JSON.stringify({ totals: { totalTokens: 2000 } }) });
    const r = ccusageUsage('claude-code', dir, { total: 1801 }, { run });
    assert.equal(r.ccusageTotal, 2000);
    assert.match(r.warning, /deviation/);
    assert.deepEqual(ccusageUsage('other', dir, { total: 1 }, { run }), { ccusageTotal: null, deviation: null, warning: null, cost: null, models: null });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

const session = (models) => ({ modelBreakdowns: models.map(([modelName, inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens, cost]) =>
  ({ modelName, inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens, cost })) });

test('cost and per-model tokens are summed across sessions, most expensive model first', () => {
  const dir = makeClaudeTrial(mkdtempSync(path.join(tmpdir(), 'adw-e2e-')));
  const out = { session: [session([['claude-opus-5-5', 10, 20, 300, 40, 1.25], ['claude-haiku-5-5', 1, 2, 3, 4, 0.01]]),
    session([['claude-opus-5-5', 5, 5, 100, 0, 0.5]])], totals: { totalTokens: 1801, totalCost: 1.76 } };
  try {
    const r = ccusageUsage('claude-code', dir, { total: 1801 }, { run: () => ({ status: 0, stdout: JSON.stringify(out) }) });
    assert.equal(r.cost, 1.76);
    assert.deepEqual(r.models, {
      'claude-opus-5-5': { input: 15, output: 25, cacheRead: 400, cacheWrite: 40, total: 480, cost: 1.75 },
      'claude-haiku-5-5': { input: 1, output: 2, cacheRead: 3, cacheWrite: 4, total: 10, cost: 0.01 },
    });
    assert.deepEqual(Object.keys(r.models), ['claude-opus-5-5', 'claude-haiku-5-5']);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('opencode runs ccusage with its database under an isolated XDG data dir', () => {
  const dir = makeOpenCodeTrial(mkdtempSync(path.join(tmpdir(), 'adw-e2e-')));
  let hasDb;
  const run = (cmd, args, opts) => {
    hasDb = existsSync(path.join(opts.env.XDG_DATA_HOME, 'opencode/opencode.db'));
    return { status: 0, stdout: JSON.stringify({ session: [], totals: { totalTokens: 7, totalCost: 0.2 } }) };
  };
  try {
    const r = ccusageUsage('opencode', dir, { total: 7 }, { run });
    assert.equal(hasDb, true);
    assert.equal(r.cost, 0.2);
    assert.deepEqual(r.models, {});
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a trial without session logs returns a warning instead of throwing', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'adw-e2e-'));
  let called = false;
  const run = () => { called = true; return { status: 0, stdout: '{}' }; };
  try {
    const r = ccusageUsage('claude-code', dir, { total: 1801 }, { run });
    assert.equal(r.ccusageTotal, null);
    assert.equal(r.deviation, null);
    assert.match(r.warning, /ENOENT|no such file/i);
    assert.equal(called, false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('malformed ccusage output returns a warning instead of throwing', () => {
  const dir = makeClaudeTrial(mkdtempSync(path.join(tmpdir(), 'adw-e2e-')));
  try {
    const r = ccusageUsage('claude-code', dir, { total: 1801 }, { run: () => ({ status: 0, stdout: 'not json' }) });
    assert.equal(r.ccusageTotal, null);
    assert.equal(r.cost, null);
    assert.match(r.warning, /ccusage failed/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a zero session-log total against a nonzero ccusage total is a full deviation', () => {
  const dir = makeClaudeTrial(mkdtempSync(path.join(tmpdir(), 'adw-e2e-')));
  try {
    const r = ccusageUsage('claude-code', dir, { total: 0 }, { run: () => ({ status: 0, stdout: JSON.stringify({ totals: { totalTokens: 500 } }) }) });
    assert.equal(r.ccusageTotal, 500);
    assert.equal(r.deviation, 1);
    assert.match(r.warning, /deviation/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
