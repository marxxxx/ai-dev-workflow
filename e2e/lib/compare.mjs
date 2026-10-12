// Compares a candidate run against a baseline run, and finds the baseline to compare against.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { diffFingerprints } from './fingerprint.mjs';

const range = (trials, pick) => {
  const v = trials.map(pick).filter((x) => typeof x === 'number');
  return v.length ? [Math.min(...v), Math.max(...v)] : null;
};

function numeric(signal, base, cand, pickTrial, threshold, out) {
  const b = base.summary.median[signal]; const c = cand.summary.median[signal];
  if (b == null || c == null || b === 0) return;
  const [bMin, bMax] = range(base.trials, pickTrial); const [cMin, cMax] = range(cand.trials, pickTrial);
  if (c > b * (1 + threshold)) out.push({ signal: `median:${signal}`, base: b, cand: c, kind: cMin > bMax ? 'regression' : 'noise' });
  else if (c < b * (1 - threshold)) out.push({ signal: `median:${signal}`, base: b, cand: c, kind: cMax < bMin ? 'improvement' : 'noise' });
}

export function compareRuns(base, cand, thresholds) {
  if (base.schema !== 2 || cand.schema !== 2) throw new Error('only schema-2 runs can be compared (schema 1 has no bundles to re-verify)');
  const signals = [];
  const rates = [['rewardRate', base.summary.rewardRate, cand.summary.rewardRate],
    ...Object.keys({ ...base.summary.checkRates, ...cand.summary.checkRates })
      .map((k) => [`check:${k}`, k in base.summary.checkRates ? base.summary.checkRates[k] : 0, k in cand.summary.checkRates ? cand.summary.checkRates[k] : 0])];
  for (const [signal, b, c] of rates) {
    if (b === null || c === null) continue; // unjudged: error:verifier carries it
    if (c < b) signals.push({ signal, base: b, cand: c, kind: 'regression' });
    else if (c > b) signals.push({ signal, base: b, cand: c, kind: 'improvement' });
  }
  for (const k of Object.keys(base.summary.reviewMedian ?? {})) {
    const b = base.summary.reviewMedian[k]; const c = cand.summary.reviewMedian?.[k];
    if (b == null || c == null) continue;
    if (b - c >= thresholds.judgeMedianDrop) signals.push({ signal: `review:${k}`, base: b, cand: c, kind: 'regression' });
    else if (c - b >= 1) signals.push({ signal: `review:${k}`, base: b, cand: c, kind: 'improvement' });
  }
  numeric('tokens', base, cand, (t) => t.tokens?.total, thresholds.tokensMedianRise, signals);
  numeric('agent', base, cand, (t) => t.durations?.agent, thresholds.agentTimeMedianRise, signals);
  for (const e of cand.summary.errorClasses) {
    if (!base.summary.errorClasses.includes(e)) signals.push({ signal: `error:${e}`, base: 0, cand: 1, kind: 'regression' });
  }
  const has = (k) => signals.some((s) => s.kind === k);
  const verdict = has('regression') ? 'worse' : has('noise') ? 'inconclusive' : has('improvement') ? 'better' : 'same';
  return { verdict, signals, fingerprintDiff: diffFingerprints(base.fingerprint, cand.fingerprint) };
}

export function findBaseline({ resultsDir, harness, before, isAncestor }) {
  if (!existsSync(resultsDir)) return null;
  for (const ts of readdirSync(resultsDir).filter((d) => d < before).sort().reverse()) {
    const file = path.join(resultsDir, ts, harness, 'run.json');
    if (!existsSync(file)) continue;
    const run = JSON.parse(readFileSync(file, 'utf8'));
    const sha = run.fingerprint?.adw?.sha;
    if (run.schema === 2 && !run.aborted && sha && isAncestor(sha)) return path.dirname(file);
  }
  return null;
}
