const n = (v) => (typeof v === 'number' ? v.toLocaleString('en-US') : v ?? '—');

export function renderRunReport(run) {
  const s = run.summary;
  const lines = [`# E2E ${run.harness}`, '',
    `Model: \`${run.config.model}\` · adw ${run.fingerprint.adw.version} (${String(run.fingerprint.adw.sha).slice(0, 7)}) · trials: ${run.trials.length}`, '',
    ...(run.aborted ? [`> **Aborted (${run.aborted})** — incomplete run, never used as a baseline.`, ''] : []),
    '## Summary', '', '| Signal | Value |', '|---|---|',
    `| reward rate | ${s.rewardRate} |`, `| median tokens | ${n(s.median.tokens)} |`, `| median agent time (s) | ${n(s.median.agent)} |`,
    ...Object.entries(s.reviewMedian).map(([k, v]) => `| review ${k} (median) | ${n(v)} |`),
    `| error classes | ${s.errorClasses.join(', ') || 'none'} |`, '',
    '## Check pass rates', '', '| Check | Rate |', '|---|---|',
    ...Object.entries(s.checkRates).map(([k, v]) => `| ${k} | ${v} |`), '', '## Trials', ''];
  for (const t of run.trials) {
    lines.push(`### ${t.id}`, '',
      `reward ${t.reward} · contract ${t.contract} · acceptance ${t.acceptance} · own tests ${t.ownTests} · tokens ${n(t.tokens?.total)} · agent ${n(t.durations?.agent)} s · tool errors ${t.errors?.tool ?? 0}${t.errors?.bridge ? ` · ${t.errors.bridge}` : ''}${t.errors?.harbor ? ` · harbor: ${t.errors.harbor}` : ''}`,
      `superpowers active: ${t.soft?.superpowersActive ? 'yes' : 'no'}`, '',
      `Failed checks: ${Object.entries(t.checks).filter(([, v]) => v !== 1).map(([k]) => k).join(', ') || 'none'}`, '');
    for (const [k, r] of Object.entries(t.reviewReasons ?? {})) lines.push(`- review ${k} ${t.review?.[k]}: ${r}`);
    lines.push('');
  }
  return `${lines.join('\n').trimEnd()}\n`;
}

export function renderSummary(runs) {
  const rows = Object.values(runs).map((r) => `| ${r.harness}${r.aborted ? ` (aborted: ${r.aborted})` : ''} | ${r.summary.rewardRate} | ${n(r.summary.median.tokens)} | ${n(r.summary.median.agent)} | ${Object.values(r.summary.reviewMedian).map(n).join(' / ')} | ${r.summary.errorClasses.join(', ') || 'none'} |`);
  return `# E2E summary\n\n| Harness | Reward rate | Median tokens | Median agent s | Judge medians | Errors |\n|---|---|---|---|---|---|\n${rows.join('\n')}\n`;
}

export function renderCompare({ harness, base, cand, result }) {
  return [`# Compare ${harness}: **${result.verdict}**`, '', `Baseline: \`${base}\``, `Candidate: \`${cand}\``, '',
    '## Signals', '', '| Signal | Baseline | Candidate | Kind |', '|---|---|---|---|',
    ...(result.signals.length ? result.signals.map((s) => `| ${s.signal} | ${n(s.base)} | ${n(s.cand)} | ${s.kind} |`) : ['| — | | | |']), '',
    '## What changed (fingerprint diff)', '',
    ...(result.fingerprintDiff.length ? result.fingerprintDiff.map((d) => `- \`${d.key}\`: ${d.from} → ${d.to}`) : ['- nothing']), ''].join('\n');
}
