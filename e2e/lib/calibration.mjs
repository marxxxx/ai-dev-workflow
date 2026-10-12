// Calibration of the E2E verifier and the review judge: known patch variants of the seed repo,
// judged by the same post-verification as a trial and compared with their expected verdicts.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { median } from './summary.mjs';

export function evaluateCalibration({ expected, results, criteria, rubric }) {
  const reviewMedians = Object.fromEntries(Object.entries(results).map(([variant, runs]) =>
    [variant, Object.fromEntries(Object.keys(rubric).map((k) => [k, median(runs.map((r) => r.review?.[k]))]))]));
  const findings = [];
  for (const [variant, exp] of Object.entries(expected)) {
    const runs = results[variant] ?? [];
    if (!runs.length) { findings.push({ variant, check: 'runs', expected: '≥ 1', got: 0, kind: 'wrong' }); continue; }
    // A criterion verdict must match in every run.
    for (const { id } of criteria) {
      const want = exp.fail.includes(id) ? 'fail' : 'pass';
      const got = runs.map((r) => r.acceptanceCriteria?.[id] ?? null);
      const misses = got.filter((g) => g !== want).length;
      if (misses) findings.push({ variant, check: id, expected: want, got, kind: misses === runs.length ? 'wrong' : 'flaky' });
    }
    // Review expectations hold on the median.
    const medians = reviewMedians[variant];
    if (exp.reviewMin != null) {
      for (const k of Object.keys(rubric)) {
        if (medians[k] == null || medians[k] < exp.reviewMin) findings.push({ variant, check: `review:${k}`, expected: `≥ ${exp.reviewMin}`, got: medians[k], kind: 'wrong' });
      }
    }
    for (const [k, delta] of Object.entries(exp.reviewBelowReference ?? {})) {
      const ref = reviewMedians.reference?.[k];
      if (ref == null || medians[k] == null || ref - medians[k] < delta) {
        findings.push({ variant, check: `review:${k}`, expected: `≤ reference − ${delta} (reference ${ref ?? '—'})`, got: medians[k], kind: 'wrong' });
      }
    }
  }
  return { pass: findings.length === 0, findings, reviewMedians };
}

export function findCalibration({ dir, hash }) {
  if (!existsSync(dir)) return null;
  for (const ts of readdirSync(dir).sort().reverse()) {
    const file = path.join(dir, ts, 'calibration.json');
    if (!existsSync(file)) continue;
    const cal = JSON.parse(readFileSync(file, 'utf8'));
    if (cal.hash === hash && cal.pass === true) return ts;
  }
  return null;
}

const cell = (v) => v ?? '—';

export function renderCalibrationReport(cal) {
  const ids = Object.keys(Object.values(cal.variants)[0]?.[0]?.acceptanceCriteria ?? {});
  const rubric = Object.keys(Object.values(cal.reviewMedians)[0] ?? {});
  const errors = Object.entries(cal.variants).flatMap(([v, runs]) => runs.flatMap((r, i) => [
    r.verifierError && `- ${v} run ${i + 1} verifier: ${r.verifierError}`, r.reviewError && `- ${v} run ${i + 1} review: ${r.reviewError}`].filter(Boolean)));
  return [`# Verifier calibration: **${cal.pass ? 'pass' : 'fail'}**`, '',
    `Verifier hash \`${cal.hash.slice(0, 7)}\` · verifier \`${cal.models.verifier}\` · review \`${cal.models.review}\` · runs per variant: ${cal.runs}`, '',
    '## Findings', '', '| Variant | Check | Expected | Got | Kind |', '|---|---|---|---|---|',
    ...(cal.findings.length ? cal.findings.map((f) => `| ${f.variant} | ${f.check} | ${f.expected} | ${Array.isArray(f.got) ? f.got.map(cell).join(' ') : cell(f.got)} | ${f.kind} |`) : ['| — | | | | |']), '',
    '## Acceptance verdicts (one per run)', '', `| Variant | ${ids.join(' | ')} |`, `|---|${ids.map(() => '---|').join('')}`,
    ...Object.entries(cal.variants).map(([v, runs]) => `| ${v} | ${ids.map((id) => runs.map((r) => cell(r.acceptanceCriteria?.[id])).join(' ')).join(' | ')} |`), '',
    '## Review medians', '', `| Variant | ${rubric.join(' | ')} |`, `|---|${rubric.map(() => '---|').join('')}`,
    ...Object.entries(cal.reviewMedians).map(([v, m]) => `| ${v} | ${rubric.map((k) => cell(m[k])).join(' | ')} |`), '',
    '## Errors', '', ...(errors.length ? errors : ['none']), ''].join('\n');
}
