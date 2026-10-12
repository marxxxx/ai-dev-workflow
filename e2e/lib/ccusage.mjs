// Cross-checks our session-log token sum against ccusage, run with an isolated HOME. Without the
// isolation, ccusage would also count every session on the host. It only warns: any failure
// becomes a warning, never an exception, so the trial's reporting keeps going.
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const LAYOUT = {
  'claude-code': { from: 'agent/sessions/projects', to: '.claude/projects', env: (h) => ({ CLAUDE_CONFIG_DIR: path.join(h, '.claude') }) },
  codex: { from: 'agent/sessions', to: '.codex/sessions', env: (h) => ({ CODEX_HOME: path.join(h, '.codex') }) },
};

export function ccusageCrossCheck(harness, trialDir, tokens, { run = spawnSync } = {}) {
  const layout = LAYOUT[harness];
  if (!layout || !tokens) return { ccusageTotal: null, deviation: null, warning: null };
  let home;
  try {
    home = mkdtempSync(path.join(tmpdir(), 'adw-ccusage-'));
    cpSync(path.join(trialDir, layout.from), path.join(home, layout.to), { recursive: true });
    const r = run('npx', ['-y', 'ccusage@20', 'session', '--json', '--offline'],
      { env: { ...process.env, HOME: home, ...layout.env(home) }, encoding: 'utf8', timeout: 300000 });
    if (r.status !== 0) return { ccusageTotal: null, deviation: null, warning: `ccusage failed (exit ${r.status})` };
    const total = JSON.parse(r.stdout).totals?.totalTokens ?? null;
    if (total === null) return { ccusageTotal: null, deviation: null, warning: 'ccusage returned no totals' };
    // A zero session-log total against a nonzero ccusage total is a full deviation, not a match.
    const deviation = tokens.total ? Math.abs(total - tokens.total) / tokens.total : (total === 0 ? 0 : 1);
    return { ccusageTotal: total, deviation: Number(deviation.toFixed(4)),
      warning: deviation > 0.01 ? `token deviation ${(deviation * 100).toFixed(1)}% vs ccusage` : null };
  } catch (err) {
    return { ccusageTotal: null, deviation: null, warning: `ccusage cross-check failed: ${err.message}` };
  } finally {
    if (home) rmSync(home, { recursive: true, force: true });
  }
}
