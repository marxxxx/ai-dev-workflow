// Code-review judge: one one-shot LLM run (config.review.harness, claude-code by default) in a fresh container
// (like the verifier), read-only on a fresh checkout of the PR head at /workspace and the diff at /diff.
// It derives conventions and architecture from AGENTS.md and the code; the prompt holds no stack knowledge.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { callLlm, dockerRunArgs, isInterrupt } from './llm.mjs';

export { REVIEW_ALLOWED_TOOLS, REVIEW_DENIED_TOOLS } from './llm.mjs';

export function buildReviewPrompt({ rubric, criteria, spec, summary, diffPath }) {
  return `You are a strict senior code reviewer. A coding agent implemented a ticket in the repository that is your current directory; its pull request branch is checked out. The full change against the base branch is in ${diffPath}.

Read AGENTS.md and the code around the change yourself, and derive the project's conventions and architecture from them and from the existing code. The acceptance criteria are the requirements; the approved spec and the implementation summary are what the agent posted on the ticket.
Score each review criterion from 1 (poor) to 5 (excellent) with one short sentence of reasoning.

Review criteria:
${Object.entries(rubric).map(([k, q]) => `- ${k}: ${q}`).join('\n')}

Answer with JSON only, exactly this shape:
{${Object.keys(rubric).map((k) => `"${k}": {"score": <1-5>, "reason": "<sentence>"}`).join(', ')}}

<acceptance-criteria>
${criteria.map((c) => `- ${c.id}: ${c.text}`).join('\n')}
</acceptance-criteria>

<approved-spec>
${spec}
</approved-spec>

<implementation-summary>
${summary}
</implementation-summary>
`;
}

export function validateReviewAnswer(answer, rubric) {
  const scores = {}; const reasons = {};
  for (const k of Object.keys(rubric)) {
    const v = answer?.[k];
    if (!v || !Number.isInteger(v.score) || v.score < 1 || v.score > 5) throw new Error(`review criterion ${k} invalid`);
    scores[k] = v.score; reasons[k] = String(v.reason ?? '');
  }
  return { scores, reasons };
}

export function runReview({ config, checkout, diffPath, criteria, spec, summary, env = {}, image, name = `adw-review-${process.pid}-${Date.now()}`,
  run = spawnSync, uid = process.getuid(), gid = process.getgid(), onTranscript, buildArgs = dockerRunArgs({ image, uid, gid }) }) {
  const { harness = 'claude-code', model = null, criteria: rubric, timeoutSec } = config.review;
  try {
    const answer = callLlm({ role: 'review', harness, model, tools: 'read', addDirs: ['/diff'], buildArgs, name, checkout, readOnly: true,
      mounts: [`${path.dirname(diffPath)}:/diff:ro`], env, timeoutMs: timeoutSec * 1000, run, onStdout: onTranscript,
      input: buildReviewPrompt({ rubric, criteria, spec, summary, diffPath: `/diff/${path.basename(diffPath)}` }) });
    return { ...validateReviewAnswer(answer, rubric), error: null };
  } catch (err) {
    if (isInterrupt(err)) throw err;
    return { scores: Object.fromEntries(Object.keys(rubric).map((k) => [k, null])), reasons: {}, error: err.message };
  } finally {
    // A timeout kills only the docker client; the container would keep running.
    run('docker', ['rm', '-f', name], { encoding: 'utf8', stdio: 'ignore' });
  }
}
