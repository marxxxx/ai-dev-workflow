const n = (v) => (typeof v === 'number' ? v.toLocaleString('en-US') : v ?? '—');
const verdicts = (ac) => Object.entries(ac ?? {}).map(([id, v]) => `${id} ${v ?? '—'}`).join(' · ') || '—';
const UNCALIBRATED = '> **Verifier not calibrated**';

function calibrationLine(run) {
  const hash = String(run.fingerprint?.verifierHash ?? '').slice(0, 7);
  return run.calibration
    ? `Verifier calibration: \`${run.calibration}\` (verifier hash ${hash})`
    : `${UNCALIBRATED} — no passing calibration for verifier hash \`${hash}\` (run \`node e2e/run.mjs calibrate\`). Treat acceptance and review verdicts with care.`;
}

export function renderRunReport(run) {
  const s = run.summary;
  const m = run.fingerprint.models ?? {};
  const lines = [`# E2E ${run.task} · ${run.harness}`, '',
    `Model: \`${run.config.model}\` · verifier \`${m.verifier}\` · review \`${m.review}\` · adw ${run.fingerprint.adw.version} (${String(run.fingerprint.adw.sha).slice(0, 7)}) · trials: ${run.trials.length}`, '',
    ...(run.aborted ? [`> **Aborted (${run.aborted})** — incomplete run, never used as a baseline.`, ''] : []),
    calibrationLine(run), '',
    '## Summary', '', '| Signal | Value |', '|---|---|',
    `| reward rate | ${n(s.rewardRate)} |`, `| median tokens | ${n(s.median.tokens)} |`, `| median agent time (s) | ${n(s.median.agent)} |`,
    ...Object.entries(s.reviewMedian).map(([k, v]) => `| review ${k} (median) | ${n(v)} |`),
    `| error classes | ${s.errorClasses.join(', ') || 'none'} |`, '',
    '## Check pass rates', '', '| Check | Rate |', '|---|---|',
    ...Object.entries(s.checkRates).map(([k, v]) => `| ${k} | ${n(v)} |`), '', '## Trials', ''];
  for (const t of run.trials) {
    lines.push(`### ${t.id}`, '',
      `reward ${n(t.reward)} · contract ${t.contract} · acceptance ${n(t.acceptance)} · own tests ${t.ownTests} · tokens ${n(t.tokens?.total)} · agent ${n(t.durations?.agent)} s · tool errors ${t.errors?.tool ?? 0}${t.errors?.bridge ? ` · ${t.errors.bridge}` : ''}${t.errors?.harbor ? ` · harbor: ${t.errors.harbor}` : ''}`,
      `superpowers active: ${t.soft?.superpowersActive ? 'yes' : 'no'}`, '',
      `Failed checks: ${Object.entries(t.checks).filter(([, v]) => v !== 1).map(([k]) => k).join(', ') || 'none'}`,
      `Acceptance: ${verdicts(t.acceptanceCriteria)}`, '');
    if (t.verifierError) lines.push(`- verifier error: ${t.verifierError}`);
    if (t.reviewError) lines.push(`- review error: ${t.reviewError}`);
    for (const [k, r] of Object.entries(t.reviewReasons ?? {})) lines.push(`- review ${k} ${t.review?.[k]}: ${r}`);
    lines.push('');
  }
  return `${lines.join('\n').trimEnd()}\n`;
}

export function renderSummary(runs) {
  const rows = runs.map((r) => `| ${r.task} | ${r.harness}${r.aborted ? ` (aborted: ${r.aborted})` : ''} | ${n(r.summary.rewardRate)} | ${n(r.summary.median.tokens)} | ${n(r.summary.median.agent)} | ${Object.values(r.summary.reviewMedian).map(n).join(' / ')} | ${r.summary.errorClasses.join(', ') || 'none'} |`);
  return `# E2E summary\n\n| Task | Harness | Reward rate | Median tokens | Median agent s | Review medians | Errors |\n|---|---|---|---|---|---|---|\n${rows.join('\n')}\n`;
}

export function renderCompare({ task, harness, base, cand, result, calibrated }) {
  return [`# Compare ${task} · ${harness}: **${result.verdict}**`, '', `Baseline: \`${base}\``, `Candidate: \`${cand}\``, '',
    ...(calibrated === false ? [`${UNCALIBRATED} for the candidate: acceptance and review signals may be verifier noise.`, ''] : []),
    '## Signals', '', '| Signal | Baseline | Candidate | Kind |', '|---|---|---|---|',
    ...(result.signals.length ? result.signals.map((s) => `| ${s.signal} | ${n(s.base)} | ${n(s.cand)} | ${s.kind} |`) : ['| — | | | |']), '',
    '## What changed (fingerprint diff)', '',
    ...(result.fingerprintDiff.length ? result.fingerprintDiff.map((d) => `- \`${d.key}\`: ${d.from} → ${d.to}`) : ['- nothing']), ''].join('\n');
}
