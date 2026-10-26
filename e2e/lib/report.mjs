const n = (v) => (typeof v === 'number' ? v.toLocaleString('en-US') : v ?? '—');
const usd = (v) => (typeof v === 'number' ? `$${v.toFixed(2)}` : '—');
const verdicts = (ac) => Object.entries(ac ?? {}).map(([id, v]) => `${id} ${v ?? '—'}`).join(' · ') || '—';
const UNCALIBRATED = '> **Verifier not calibrated**';
const byCount = (counts) => Object.entries(counts).sort((a, b) => b[1] - a[1]);
const callSum = (counts) => Object.values(counts).reduce((a, b) => a + b, 0);
const mcpLine = (mcp) => Object.entries(mcp).map(([server, tools]) => (callSum(tools)
  ? `${server} ${callSum(tools)} (${byCount(tools).map(([k, v]) => `${k} ${v}`).join(', ')})` : `${server} 0`)).join(' · ');
const mcpTotals = (mcp = {}) => Object.entries(mcp).map(([server, u]) => `${server} ${u.calls}`).join(' · ') || '—';

function mcpSection(run) {
  const usage = Object.entries(run.summary.mcp ?? {});
  if (!usage.length) return [];
  const withTools = run.trials.filter((t) => t.tools).length;
  return ['## MCP usage', '', 'Information only, never a check: every configured server, used or not.', '',
    '| Server | Trials using | Calls |', '|---|---|---|', ...usage.map(([k, u]) => `| ${k} | ${u.trials}/${withTools} | ${u.calls} |`), ''];
}

// Local runs (adw e2e) have no calibration set; they flag human questions and self-judging instead.
function localLines(run) {
  return [`> **Verifier not calibrated (local run)** — treat acceptance and review verdicts with care.`,
    ...(run.selfJudged?.length ? [`> **Self-judged:** ${run.selfJudged.join(', ')} run on the agent's own harness and model.`] : []), '',
    `Answerer \`${run.fingerprint.models?.answerer}\` · base commit \`${String(run.fingerprint.baseCommit).slice(0, 7)}\` · Human asked: ${run.humanAsked} · nudged: ${run.nudged ?? 0} · comparable: ${run.comparable ? 'yes' : 'no'}`];
}

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
    `Model: \`${run.config.model}\` · verifier \`${m.verifier}\` · review \`${m.review}\` · adw ${run.fingerprint.adw.version}${run.fingerprint.adw.sha === null ? '' : ` (${String(run.fingerprint.adw.sha).slice(0, 7)})`} · trials: ${run.trials.length}`, '',
    ...(run.aborted ? [`> **Aborted (${run.aborted})** — incomplete run, never used as a baseline.`, ''] : []),
    ...(run.local ? localLines(run) : [calibrationLine(run)]), '',
    '## Summary', '', '| Signal | Value |', '|---|---|',
    `| reward rate | ${n(s.rewardRate)} |`, `| median tokens | ${n(s.median.tokens)} |`, `| median cost (USD) | ${usd(s.median.cost)} |`, `| median agent time (s) | ${n(s.median.agent)} |`,
    ...Object.entries(s.reviewMedian).map(([k, v]) => `| review ${k} (median) | ${n(v)} |`),
    `| error classes | ${s.errorClasses.join(', ') || 'none'} |`, '',
    '## Check pass rates', '', '| Check | Rate |', '|---|---|',
    ...Object.entries(s.checkRates).map(([k, v]) => `| ${k} | ${n(v)} |`), '', ...mcpSection(run), '## Trials', ''];
  for (const t of run.trials) {
    lines.push(`### ${t.id}`, '',
      `reward ${n(t.reward)} · contract ${t.contract} · acceptance ${n(t.acceptance)} · own tests ${t.ownTests === null ? '—' : t.ownTests} · tokens ${n(t.tokens?.total)} · cost ${usd(t.cost)} · agent ${n(t.durations?.agent)} s · tool errors ${t.errors?.tool ?? 0}${t.errors?.bridge ? ` · ${t.errors.bridge}` : ''}${t.errors?.harbor ? ` · harbor: ${t.errors.harbor}` : ''}`,
      `superpowers active: ${t.soft?.superpowersActive ? 'yes' : 'no'}`,
      ...(t.tools ? [`MCP: ${mcpLine(t.tools.mcp) || 'none configured'}`,
        `built-in: ${byCount(t.tools.builtin).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}`] : []), '',
      `Failed checks: ${Object.entries(t.checks).filter(([, v]) => v !== 1 && v !== null).map(([k]) => k).join(', ') || 'none'}`,
      `Acceptance: ${verdicts(t.acceptanceCriteria)}`, '');
    const models = Object.entries(t.ccusage?.models ?? {});
    if (models.length) {
      lines.push('| Model | Input | Output | Cache read | Cache write | Total | Cost |', '|---|---|---|---|---|---|---|',
        ...models.map(([k, m]) => `| ${k} | ${n(m.input)} | ${n(m.output)} | ${n(m.cacheRead)} | ${n(m.cacheWrite)} | ${n(m.total)} | ${usd(m.cost)} |`), '');
    }
    if (t.verifierError) lines.push(`- verifier error: ${t.verifierError}`);
    if (t.reviewError) lines.push(`- review error: ${t.reviewError}`);
    for (const [k, r] of Object.entries(t.reviewReasons ?? {})) lines.push(`- review ${k} ${t.review?.[k]}: ${r}`);
    lines.push('');
  }
  return `${lines.join('\n').trimEnd()}\n`;
}

export function renderSummary(runs) {
  const rows = runs.map((r) => `| ${r.task} | ${r.harness}${r.aborted ? ` (aborted: ${r.aborted})` : ''} | ${n(r.summary.rewardRate)} | ${n(r.summary.median.tokens)} | ${usd(r.summary.median.cost)} | ${n(r.summary.median.agent)} | ${Object.values(r.summary.reviewMedian).map(n).join(' / ')} | ${r.summary.errorClasses.join(', ') || 'none'} | ${mcpTotals(r.summary.mcp)} |`);
  return `# E2E summary\n\n| Task | Harness | Reward rate | Median tokens | Median cost | Median agent s | Review medians | Errors | MCP calls |\n|---|---|---|---|---|---|---|---|---|\n${rows.join('\n')}\n`;
}

export function renderCompare({ task, harness, base, cand, result, calibrated }) {
  return [`# Compare ${task} · ${harness}: **${result.verdict}**`, '', `Baseline: \`${base}\``, `Candidate: \`${cand}\``, '',
    ...(calibrated === false ? [`${UNCALIBRATED} for the candidate: acceptance and review signals may be verifier noise.`, ''] : []),
    '## Signals', '', '| Signal | Baseline | Candidate | Kind |', '|---|---|---|---|',
    ...(result.signals.length ? result.signals.map((s) => `| ${s.signal} | ${n(s.base)} | ${n(s.cand)} | ${s.kind} |`) : ['| — | | | |']), '',
    '## What changed (fingerprint diff)', '',
    ...(result.fingerprintDiff.length ? result.fingerprintDiff.map((d) => `- \`${d.key}\`: ${d.from} → ${d.to}`) : ['- nothing']), ''].join('\n');
}
