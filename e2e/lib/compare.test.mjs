import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { compareRuns, findBaseline } from './compare.mjs';
import { summarizeTrials } from './summary.mjs';

const TH = { tokensMedianRise: 0.5, agentTimeMedianRise: 0.5, judgeMedianDrop: 1 };
const trial = (o = {}) => ({ reward: 1, checks: { spec_comment: 1 }, acceptance: 1, ownTests: 1,
  tokens: { total: 100 }, durations: { agent: 10 }, review: { requirements: 5 },
  errors: { harbor: null, bridge: null, tool: 0, timeout: false }, ...o });
const run = (trials, sha = 'a') => ({ schema: 2, trials, summary: summarizeTrials(trials), fingerprint: { adw: { sha } } });

test('identical runs are same', () => {
  const r = compareRuns(run([trial(), trial()]), run([trial(), trial()]), TH);
  assert.equal(r.verdict, 'same');
});

test('a dropped check rate is worse, and the fingerprint diff names the change', () => {
  const r = compareRuns(run([trial(), trial()], 'a'), run([trial(), trial({ checks: { spec_comment: 0 }, reward: 0 })], 'b'), TH);
  assert.equal(r.verdict, 'worse');
  assert.ok(r.signals.some((s) => s.signal === 'check:spec_comment' && s.kind === 'regression'));
  assert.deepEqual(r.fingerprintDiff, [{ key: 'adw.sha', from: 'a', to: 'b' }]);
});

test('token rise with overlapping ranges is inconclusive, disjoint ranges are worse', () => {
  const base = run([trial({ tokens: { total: 100 } }), trial({ tokens: { total: 400 } })]);
  const overlap = run([trial({ tokens: { total: 300 } }), trial({ tokens: { total: 500 } })]);
  assert.equal(compareRuns(base, overlap, TH).verdict, 'inconclusive');
  const disjoint = run([trial({ tokens: { total: 900 } }), trial({ tokens: { total: 1000 } })]);
  assert.equal(compareRuns(base, disjoint, TH).verdict, 'worse');
});

test('judge drop and new error class are regressions; improvements are better', () => {
  assert.equal(compareRuns(run([trial()]), run([trial({ review: { requirements: 3 } })]), TH).verdict, 'worse');
  assert.equal(compareRuns(run([trial()]), run([trial({ errors: { harbor: null, bridge: 'x', tool: 0, timeout: false } })]), TH).verdict, 'worse');
  assert.equal(compareRuns(run([trial({ reward: 0, acceptance: 0 })]), run([trial()]), TH).verdict, 'better');
});

test('findBaseline picks the newest earlier run whose sha is on main', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'adw-e2e-'));
  try {
    for (const [ts, sha] of [['2026-10-01T0900Z', 'old'], ['2026-10-02T0900Z', 'branch'], ['2026-10-03T0900Z', 'cand']]) {
      mkdirSync(path.join(dir, ts, 'demo-todo', 'codex'), { recursive: true });
      writeFileSync(path.join(dir, ts, 'demo-todo', 'codex', 'run.json'), JSON.stringify({ schema: 2, fingerprint: { adw: { sha } } }));
    }
    const found = findBaseline({ resultsDir: dir, task: 'demo-todo', harness: 'codex', before: '2026-10-03T0900Z', isAncestor: (s) => s === 'old' });
    assert.equal(found, path.join(dir, '2026-10-01T0900Z', 'demo-todo', 'codex'));
    assert.equal(findBaseline({ resultsDir: dir, task: 'demo-todo', harness: 'opencode', before: 'z', isAncestor: () => true }), null);
    mkdirSync(path.join(dir, '2026-10-02T1000Z', 'demo-todo', 'codex'), { recursive: true });
    writeFileSync(path.join(dir, '2026-10-02T1000Z', 'demo-todo', 'codex', 'run.json'), JSON.stringify({ schema: 2, aborted: 'quota', fingerprint: { adw: { sha: 'old' } } }));
    assert.equal(findBaseline({ resultsDir: dir, task: 'demo-todo', harness: 'codex', before: '2026-10-03T0900Z', isAncestor: (s) => s === 'old' }),
      path.join(dir, '2026-10-01T0900Z', 'demo-todo', 'codex'), 'an aborted run is never a baseline');
    assert.equal(findBaseline({ resultsDir: dir, task: 'demo-todo-dotnet', harness: 'codex', before: '2026-10-03T0900Z', isAncestor: () => true }), null,
      'another task is never a baseline');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a candidate whose judge always fails is worse, not same', () => {
  const failed = trial({ review: null, reviewError: 'review exited 1' });
  const r = compareRuns(run([trial()]), run([failed, failed]), TH);
  assert.equal(r.verdict, 'worse');
  assert.ok(r.signals.some((s) => s.signal === 'error:judge' && s.kind === 'regression'));
});

test('schema-1 runs are never a baseline and cannot be compared', () => {
  assert.throws(() => compareRuns({ ...run([trial()]), schema: 1 }, run([trial()]), TH), /schema-2/);
  const dir = mkdtempSync(path.join(tmpdir(), 'adw-e2e-'));
  try {
    mkdirSync(path.join(dir, '2026-10-01T0900Z', 'demo-todo', 'codex'), { recursive: true });
    writeFileSync(path.join(dir, '2026-10-01T0900Z', 'demo-todo', 'codex', 'run.json'), JSON.stringify({ schema: 1, fingerprint: { adw: { sha: 'old' } } }));
    assert.equal(findBaseline({ resultsDir: dir, task: 'demo-todo', harness: 'codex', before: 'z', isAncestor: () => true }), null);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a review median drop is a review: regression', () => {
  const r = compareRuns(run([trial()]), run([trial({ review: { requirements: 3 } })]), TH);
  assert.ok(r.signals.some((s) => s.signal === 'review:requirements' && s.kind === 'regression'));
});

test('a candidate whose trials are all unjudged is flagged by error:verifier, not by rate regressions', () => {
  const unjudged = trial({ reward: null, acceptance: null, acceptanceCriteria: { AC1: null }, review: null,
    verifierError: 'verifier exit 1: crash' });
  const base = trial({ acceptanceCriteria: { AC1: 'pass' } });
  const r = compareRuns(run([base]), run([unjudged, unjudged]), TH);
  assert.ok(!r.signals.some((s) => s.signal === 'rewardRate' || s.signal === 'check:acceptance' || s.signal.startsWith('check:ac:')));
  assert.ok(r.signals.some((s) => s.signal === 'error:verifier' && s.kind === 'regression'));
  assert.equal(r.verdict, 'worse');
});
