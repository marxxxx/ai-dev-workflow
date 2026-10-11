// Outcome-based quality judge: one claude -p call per trial with a fixed rubric.
import { spawnSync } from 'node:child_process';

export function buildJudgePrompt({ criteria, briefing, spec, diff, summary }) {
  const rubric = Object.entries(criteria).map(([k, q]) => `- ${k}: ${q}`).join('\n');
  return `You are a strict senior reviewer. Score the coding agent's work against the product owner's briefing.
Score each criterion from 1 (poor) to 5 (excellent) with one short sentence of reasoning.

Criteria:
${rubric}

Answer with JSON only, exactly this shape:
{${Object.keys(criteria).map((k) => `"${k}": {"score": <1-5>, "reason": "<sentence>"}`).join(', ')}}

<briefing>
${briefing}
</briefing>

<spec>
${spec}
</spec>

<diff>
${diff}
</diff>

<summary>
${summary}
</summary>
`;
}

export function parseJudgeOutput(stdout, criteria) {
  const text = JSON.parse(stdout).result ?? '';
  const json = text.match(/\{[\s\S]*\}/)?.[0];
  if (!json) throw new Error('judge returned no JSON object');
  const parsed = JSON.parse(json);
  const scores = {}; const reasons = {};
  for (const k of Object.keys(criteria)) {
    const v = parsed[k];
    if (!v || !Number.isInteger(v.score) || v.score < 1 || v.score > 5) throw new Error(`judge criterion ${k} invalid`);
    scores[k] = v.score; reasons[k] = String(v.reason ?? '');
  }
  return { scores, reasons };
}

export function runJudge({ config, briefing, spec, diff, summary, run = spawnSync }) {
  const { model, criteria } = config.judge;
  const nulls = Object.fromEntries(Object.keys(criteria).map((k) => [k, null]));
  try {
    const r = run('claude', ['-p', '--model', model, '--output-format', 'json'],
      { input: buildJudgePrompt({ criteria, briefing, spec, diff, summary }), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    if (r.status !== 0) throw new Error(`judge exit ${r.status}: ${String(r.stderr ?? '').slice(0, 300)}`);
    return { ...parseJudgeOutput(r.stdout, criteria), error: null };
  } catch (err) {
    return { scores: nulls, reasons: {}, error: err.message };
  }
}
