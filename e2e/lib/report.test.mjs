import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderRunReport, renderSummary, renderCompare } from './report.mjs';
import { summarizeTrials } from './summary.mjs';

const trial = { id: 'codex-1', reward: 0, contract: 1, checks: { spec_comment: 1, e2e_performed: 1 }, ownTests: 1,
  acceptanceCriteria: { AC1: 'pass', AC4: 'fail' }, acceptance: 0.5, verifierError: null,
  review: { conventions: 4 }, reviewReasons: { conventions: 'follows AGENTS.md' }, reviewError: null,
  durations: { agent: 225, total: 287 }, tokens: { total: 916414 }, errors: { harbor: null, bridge: null, tool: 1, timeout: false },
  soft: { superpowersActive: true } };
const run = { schema: 2, task: 'demo-todo', harness: 'codex', calibration: '2026-10-12T0900Z', config: { model: 'openai/gpt-6.1-sol' },
  fingerprint: { adw: { version: '0.24.0', sha: 'abc' }, verifierHash: 'f00dfeed', models: { verifier: 'claude-sonnet-5-5', review: 'claude-sonnet-5-5' } },
  trials: [trial], summary: summarizeTrials([trial]) };

test('run report shows summary, per-criterion verdicts, review reasons and the calibration', () => {
  const md = renderRunReport(run);
  for (const s of ['# E2E demo-todo · codex', 'openai/gpt-6.1-sol', 'verifier `claude-sonnet-5-5`', '| spec_comment | 1 |', '| ac:AC4 | 0 |',
    'codex-1', '916,414', 'Acceptance: AC1 pass · AC4 fail', 'review conventions 4: follows AGENTS.md', '| review conventions (median) | 4 |',
    'superpowers active: yes', 'Verifier calibration: `2026-10-12T0900Z`']) assert.ok(md.includes(s), s);
});

test('an uncalibrated verifier, an unjudged trial and verifier errors are visible', () => {
  const broken = { ...trial, reward: null, acceptance: null, acceptanceCriteria: { AC1: null, AC4: null }, verifierError: 'verifier timed out after 900 s' };
  const md = renderRunReport({ ...run, calibration: null, trials: [broken], summary: summarizeTrials([broken]) });
  assert.match(md, /Verifier not calibrated.*f00dfee/);
  assert.match(md, /reward — · contract 1 · acceptance —/);
  assert.match(md, /Acceptance: AC1 — · AC4 —/);
  assert.match(md, /- verifier error: verifier timed out after 900 s/);
});

test('an aborted run is flagged as not a valid baseline in report and summary', () => {
  const aborted = { ...run, aborted: 'quota' };
  assert.match(renderRunReport(aborted), /Aborted \(quota\)/);
  assert.match(renderSummary([aborted]), /\| demo-todo \| codex \(aborted: quota\) \|/);
});

test('summary puts tasks and harnesses side by side with review medians', () => {
  const md = renderSummary([run, { ...run, harness: 'opencode' }, { ...run, task: 'demo-todo-dotnet' }]);
  assert.match(md, /\| Task \| Harness \| Reward rate/);
  assert.match(md, /Review medians/);
  assert.match(md, /\| demo-todo \| codex \| 0 \|/);
  assert.match(md, /\| demo-todo \| opencode \| 0 \|/);
  assert.match(md, /\| demo-todo-dotnet \| codex \| 0 \|/);
});

test('compare report shows verdict, signals, fingerprint diff and an uncalibrated candidate', () => {
  const result = { verdict: 'worse', signals: [{ signal: 'check:ac:AC4', base: 1, cand: 0.67, kind: 'regression' }],
    fingerprintDiff: [{ key: 'skill.codex', from: 'h1', to: 'h2' }] };
  const md = renderCompare({ task: 'demo-todo', harness: 'codex', base: '/b', cand: '/c', result, calibrated: true });
  for (const s of ['# Compare demo-todo · codex: **worse**', '**worse**', 'check:ac:AC4', 'regression', 'skill.codex']) assert.ok(md.includes(s), s);
  assert.doesNotMatch(md, /not calibrated/);
  assert.match(renderCompare({ task: 'demo-todo', harness: 'codex', base: '/b', cand: '/c', result, calibrated: false }), /Verifier not calibrated/);
});
