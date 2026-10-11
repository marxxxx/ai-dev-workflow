// Per-harness summary: rates, medians and error classes over a set of trial records.
export function median(values) {
  const v = values.filter((x) => typeof x === 'number').sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

const rate = (xs) => (xs.length ? Number((xs.filter((x) => x === 1).length / xs.length).toFixed(2)) : null);

export function summarizeTrials(trials) {
  const checkNames = [...new Set(trials.flatMap((t) => Object.keys(t.checks ?? {})))];
  const checkRates = Object.fromEntries(checkNames.map((c) => [c, rate(trials.map((t) => t.checks?.[c] ?? 0))]));
  checkRates.acceptance = rate(trials.map((t) => t.acceptance));
  checkRates.ownTests = rate(trials.map((t) => t.ownTests));
  const criteria = [...new Set(trials.flatMap((t) => Object.keys(t.judge ?? {})))];
  return {
    rewardRate: rate(trials.map((t) => t.reward)),
    checkRates,
    median: { tokens: median(trials.map((t) => t.tokens?.total)), agent: median(trials.map((t) => t.durations?.agent)) },
    judgeMedian: Object.fromEntries(criteria.map((c) => [c, median(trials.map((t) => t.judge?.[c]))])),
    errorClasses: [...new Set([
      ...trials.flatMap((t) => ['harbor', 'bridge', 'timeout', 'quota'].filter((k) => t.errors?.[k])),
      ...(trials.some((t) => t.judgeError) ? ['judge'] : []),
    ])].sort(),
  };
}
