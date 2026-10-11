import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ccusageCrossCheck } from './ccusage.mjs';
import { makeClaudeTrial } from './fixtures/make.mjs';

test('cross-check runs ccusage with an isolated HOME holding a copy of the sessions', () => {
  const dir = makeClaudeTrial(mkdtempSync(path.join(tmpdir(), 'adw-e2e-')));
  let seen;
  const run = (cmd, args, opts) => {
    seen = { cmd, args, home: opts.env.HOME, hasCopy: existsSync(path.join(opts.env.HOME, '.claude/projects/-workspace/abc.jsonl')) };
    return { status: 0, stdout: JSON.stringify({ totals: { totalTokens: 1801 } }) };
  };
  try {
    const r = ccusageCrossCheck('claude-code', dir, { total: 1801 }, { run });
    assert.deepEqual(r, { ccusageTotal: 1801, deviation: 0, warning: null });
    assert.equal(seen.cmd, 'npx');
    assert.deepEqual(seen.args, ['-y', 'ccusage@20', 'session', '--json', '--offline']);
    assert.equal(seen.hasCopy, true);
    assert.equal(existsSync(seen.home), false, 'isolated HOME is removed afterwards');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('deviation above 1% produces a warning; opencode is skipped', () => {
  const dir = makeClaudeTrial(mkdtempSync(path.join(tmpdir(), 'adw-e2e-')));
  try {
    const run = () => ({ status: 0, stdout: JSON.stringify({ totals: { totalTokens: 2000 } }) });
    const r = ccusageCrossCheck('claude-code', dir, { total: 1801 }, { run });
    assert.equal(r.ccusageTotal, 2000);
    assert.match(r.warning, /deviation/);
    assert.deepEqual(ccusageCrossCheck('opencode', dir, { total: 1 }, { run }), { ccusageTotal: null, deviation: null, warning: null });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
