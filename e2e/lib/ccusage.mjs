// Prices the target agent's sessions with ccusage and cross-checks our session-log token sum,
// run with an isolated HOME. Without the isolation, ccusage would also count every session on the
// host. Cost is the API list-price equivalent from the price table bundled with the pinned ccusage
// version, so runs stay comparable. It only warns: any failure becomes a warning, never an
// exception, so the trial's reporting keeps going.
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const LAYOUT = {
  'claude-code': { from: 'agent/sessions/projects', to: '.claude/projects', env: (h) => ({ CLAUDE_CONFIG_DIR: path.join(h, '.claude') }) },
  codex: { from: 'agent/sessions', to: '.codex/sessions', env: (h) => ({ CODEX_HOME: path.join(h, '.codex') }) },
  opencode: { from: 'agent/opencode/xdg-data/opencode', to: '.local/share/opencode', env: (h) => ({ XDG_DATA_HOME: path.join(h, '.local/share') }) },
};
const EMPTY = { ccusageTotal: null, deviation: null, warning: null, cost: null, models: null };

// Per model across all sessions, most expensive first.
function modelBreakdown(sessions) {
  const models = {};
  for (const b of sessions.flatMap((s) => s.modelBreakdowns ?? [])) {
    const m = models[b.modelName] ??= { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, cost: 0 };
    m.input += b.inputTokens ?? 0; m.output += b.outputTokens ?? 0;
    m.cacheRead += b.cacheReadTokens ?? 0; m.cacheWrite += b.cacheCreationTokens ?? 0;
    m.total = m.input + m.output + m.cacheRead + m.cacheWrite;
    m.cost = Number((m.cost + (b.cost ?? 0)).toFixed(6));
  }
  return Object.fromEntries(Object.entries(models).sort(([, a], [, b]) => b.cost - a.cost));
}

export function ccusageUsage(harness, trialDir, tokens, { run = spawnSync, version = '20' } = {}) {
  const layout = LAYOUT[harness];
  if (!layout || !tokens) return EMPTY;
  let home;
  try {
    home = mkdtempSync(path.join(tmpdir(), 'adw-ccusage-'));
    cpSync(path.join(trialDir, layout.from), path.join(home, layout.to), { recursive: true });
    const r = run('npx', ['-y', `ccusage@${version}`, 'session', '--json', '--offline'],
      { env: { ...process.env, HOME: home, ...layout.env(home) }, encoding: 'utf8', timeout: 300000 });
    if (r.status !== 0) return { ...EMPTY, warning: `ccusage failed (exit ${r.status})` };
    const out = JSON.parse(r.stdout);
    const total = out.totals?.totalTokens ?? null;
    if (total === null) return { ...EMPTY, warning: 'ccusage returned no totals' };
    // A zero session-log total against a nonzero ccusage total is a full deviation, not a match.
    const deviation = tokens.total ? Math.abs(total - tokens.total) / tokens.total : (total === 0 ? 0 : 1);
    return { ccusageTotal: total, deviation: Number(deviation.toFixed(4)),
      warning: deviation > 0.01 ? `token deviation ${(deviation * 100).toFixed(1)}% vs ccusage` : null,
      cost: typeof out.totals.totalCost === 'number' ? Number(out.totals.totalCost.toFixed(6)) : null, models: out.session ? modelBreakdown(out.session) : null };
  } catch (err) {
    return { ...EMPTY, warning: `ccusage failed: ${err.message}` };
  } finally {
    if (home) rmSync(home, { recursive: true, force: true });
  }
}
