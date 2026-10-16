// Per-harness summary: rates, medians and error classes over a set of trial records.
import { isQuota } from './claude.mjs';

export function median(values) {
  const v = values.filter((x) => typeof x === 'number').sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

// Unjudged values (null) count in no rate.
const rate = (xs) => {
  const v = xs.filter((x) => x != null);
  return v.length ? Number((v.filter((x) => x === 1).length / v.length).toFixed(2)) : null;
};
const acNumber = (id) => Number(id.replace(/\D/g, ''));
const sum = (counts) => Object.values(counts).reduce((a, b) => a + b, 0);

// Information only: which MCP servers the agent used, in how many trials. Never a check.
function mcpUsage(trials) {
  const usage = {};
  for (const [server, tools] of trials.flatMap((t) => Object.entries(t.tools?.mcp ?? {}))) {
    const u = usage[server] ??= { calls: 0, trials: 0 };
    u.calls += sum(tools); if (sum(tools)) u.trials += 1;
  }
  return usage;
}

export function summarizeTrials(trials) {
  const checkNames = [...new Set(trials.flatMap((t) => Object.keys(t.checks ?? {})))];
  const checkRates = Object.fromEntries(checkNames.map((c) => [c, rate(trials.map((t) => t.checks?.[c] ?? 0))]));
  checkRates.acceptance = rate(trials.map((t) => t.acceptance));
  checkRates.ownTests = rate(trials.map((t) => t.ownTests));
  const acIds = [...new Set(trials.flatMap((t) => Object.keys(t.acceptanceCriteria ?? {})))].sort((a, b) => acNumber(a) - acNumber(b));
  for (const id of acIds) {
    const v = trials.map((t) => t.acceptanceCriteria?.[id]);
    checkRates[`ac:${id}`] = rate(v.map((x) => (x == null ? null : x === 'pass' ? 1 : 0)));
  }
  const criteria = [...new Set(trials.flatMap((t) => Object.keys(t.review ?? {})))];
  const failed = (error) => Boolean(error) && !isQuota(error);
  return {
    rewardRate: rate(trials.map((t) => t.reward)),
    checkRates,
    median: { tokens: median(trials.map((t) => t.tokens?.total)), cost: median(trials.map((t) => t.cost)), agent: median(trials.map((t) => t.durations?.agent)) },
    mcp: mcpUsage(trials),
    reviewMedian: Object.fromEntries(criteria.map((c) => [c, median(trials.map((t) => t.review?.[c]))])),
    errorClasses: [...new Set([
      ...trials.flatMap((t) => ['harbor', 'bridge', 'timeout', 'quota'].filter((k) => t.errors?.[k])),
      ...(trials.some((t) => failed(t.verifierError)) ? ['verifier'] : []),
      ...(trials.some((t) => failed(t.reviewError)) ? ['judge'] : []),
    ])].sort(),
  };
}
