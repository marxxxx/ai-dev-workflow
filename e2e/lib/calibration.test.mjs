import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { evaluateCalibration, findCalibration, renderCalibrationReport } from './calibration.mjs';

const criteria = [{ id: 'AC1', text: 'a' }, { id: 'AC4', text: 'b' }];
const rubric = { conventions: 'q', tests: 'q' };
const pv = (ac1, ac4, review = { conventions: 5, tests: 5 }) => ({ acceptanceCriteria: { AC1: ac1, AC4: ac4 }, review,
  verifierError: ac1 === null ? 'verifier exit 1: crash' : null, reviewError: null });

test('a calibration passes when every verdict matches in every run and the review expectations hold', () => {
  const expected = { reference: { fail: [], reviewMin: 4 }, 'broken-done': { fail: ['AC4'] }, messy: { fail: [], reviewBelowReference: { conventions: 2 } } };
  const results = { reference: [pv('pass', 'pass'), pv('pass', 'pass')], 'broken-done': [pv('pass', 'fail'), pv('pass', 'fail')],
    messy: [pv('pass', 'pass', { conventions: 2, tests: 5 }), pv('pass', 'pass', { conventions: 3, tests: 5 })] };
  const r = evaluateCalibration({ expected, results, criteria, rubric });
  assert.deepEqual(r.findings, []);
  assert.equal(r.pass, true);
  assert.deepEqual(r.reviewMedians.messy, { conventions: 2.5, tests: 5 });
});

test('a verdict wrong in every run is wrong, in some runs flaky; a verifier error counts as a miss', () => {
  const expected = { 'broken-done': { fail: ['AC4'] } };
  const wrong = evaluateCalibration({ expected, criteria, rubric, results: { 'broken-done': [pv('pass', 'pass'), pv('pass', 'pass')] } });
  assert.deepEqual(wrong.findings, [{ variant: 'broken-done', check: 'AC4', expected: 'fail', got: ['pass', 'pass'], kind: 'wrong' }]);
  const flaky = evaluateCalibration({ expected, criteria, rubric, results: { 'broken-done': [pv('pass', 'fail'), pv(null, null)] } });
  assert.deepEqual(flaky.findings.map((f) => [f.check, f.kind]), [['AC1', 'flaky'], ['AC4', 'flaky']]);
  assert.equal(flaky.pass, false);
});

test('review expectations are checked on the median per variant', () => {
  const expected = { reference: { fail: [], reviewMin: 4 }, messy: { fail: [], reviewBelowReference: { conventions: 2, tests: 2 } } };
  const results = { reference: [pv('pass', 'pass', { conventions: 5, tests: 3 }), pv('pass', 'pass', { conventions: 5, tests: 5 })],
    messy: [pv('pass', 'pass', { conventions: 4, tests: 2 }), pv('pass', 'pass', { conventions: 4, tests: 2 })] };
  const r = evaluateCalibration({ expected, results, criteria, rubric });
  assert.deepEqual(r.findings.map((f) => [f.variant, f.check, f.kind]), [['messy', 'review:conventions', 'wrong']]);
});

test('a variant without runs, or with null review scores, fails', () => {
  const none = evaluateCalibration({ expected: { reference: { fail: [], reviewMin: 4 } }, criteria, rubric, results: { reference: [] } });
  assert.deepEqual(none.findings, [{ variant: 'reference', check: 'runs', expected: '≥ 1', got: 0, kind: 'wrong' }]);
  const unscored = evaluateCalibration({ expected: { reference: { fail: [], reviewMin: 4 } }, criteria, rubric, results: { reference: [pv('pass', 'pass', null)] } });
  assert.deepEqual(unscored.findings.map((f) => f.check), ['review:conventions', 'review:tests']);
});

test('findCalibration picks the newest passing calibration with the same hash', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'adw-cal-'));
  try {
    for (const [ts, hash, pass] of [['2026-10-12T0900Z', 'h1', true], ['2026-10-12T1000Z', 'h1', false], ['2026-10-12T1100Z', 'h2', true]]) {
      mkdirSync(path.join(dir, ts));
      writeFileSync(path.join(dir, ts, 'calibration.json'), JSON.stringify({ hash, pass }));
    }
    assert.equal(findCalibration({ dir, hash: 'h1' }), '2026-10-12T0900Z');
    assert.equal(findCalibration({ dir, hash: 'h3' }), null);
    assert.equal(findCalibration({ dir: path.join(dir, 'missing'), hash: 'h1' }), null);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the calibration report shows the verdict, findings, per-run verdicts, review medians and errors', () => {
  const md = renderCalibrationReport({ ts: 't', hash: 'abcdef0123', pass: false, runs: 2, models: { verifier: 'v-m', review: 'r-m' },
    findings: [{ variant: 'broken-done', check: 'AC4', expected: 'fail', got: ['pass', null], kind: 'flaky' }],
    reviewMedians: { 'broken-done': { conventions: 4, tests: 5 } },
    variants: { 'broken-done': [pv('pass', 'pass'), pv(null, null)] } });
  for (const s of ['**fail**', '`abcdef0`', 'verifier `v-m`', '| broken-done | AC4 | fail | pass — | flaky |',
    '| broken-done | pass — | pass — |', '| broken-done | 4 | 5 |', '- broken-done run 2 verifier: verifier exit 1: crash']) assert.ok(md.includes(s), s);
});
