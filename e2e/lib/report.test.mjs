import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderRunReport, renderSummary, renderCompare } from './report.mjs';
import { summarizeTrials } from './summary.mjs';

const trial = { id: 'codex-1', reward: 1, contract: 1, checks: { spec_comment: 1, e2e_performed: 1 }, acceptance: 1, ownTests: 1,
  judge: { requirements: 5 }, judgeReasons: { requirements: 'all captured' }, durations: { agent: 225, total: 287 },
  tokens: { total: 916414 }, errors: { harbor: null, bridge: null, tool: 1, timeout: false }, soft: { superpowersActive: true } };
const run = { harness: 'codex', config: { model: 'openai/gpt-6.1-sol' }, fingerprint: { adw: { version: '0.24.0', sha: 'abc' } },
  trials: [trial], summary: summarizeTrials([trial]) };

test('run report shows summary, checks, trials and judge reasons', () => {
  const md = renderRunReport(run);
  for (const s of ['# E2E codex', 'openai/gpt-6.1-sol', '| spec_comment | 1 |', 'codex-1', '916,414', 'all captured', 'superpowers active: yes'])
    assert.ok(md.includes(s), s);
});

test('summary puts harnesses side by side', () => {
  const md = renderSummary({ codex: run, opencode: { ...run, harness: 'opencode' } });
  assert.match(md, /\| codex \| 1 \|/);
  assert.match(md, /\| opencode \| 1 \|/);
});

test('compare report shows verdict, signals and fingerprint diff', () => {
  const md = renderCompare({ harness: 'codex', base: '/b', cand: '/c', result: { verdict: 'worse',
    signals: [{ signal: 'check:spec_comment', base: 1, cand: 0.67, kind: 'regression' }],
    fingerprintDiff: [{ key: 'skill.codex', from: 'h1', to: 'h2' }] } });
  for (const s of ['**worse**', 'check:spec_comment', 'regression', 'skill.codex']) assert.ok(md.includes(s), s);
});
