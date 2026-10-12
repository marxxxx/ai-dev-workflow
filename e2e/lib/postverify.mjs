// Post-verification of one PR head, on the host: fresh checkouts of its bundle, then the E2E
// verifier and the review judge, independently of each other. Runs after each trial, and again
// with `run.mjs verify` and `run.mjs calibrate`.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { checkoutBundle } from './bundle.mjs';
import { isQuota } from './claude.mjs';
import { REVIEW_ALLOWED_TOOLS, REVIEW_DENIED_TOOLS, buildReviewPrompt, runReview } from './review.mjs';
import { VERIFIER_ALLOWED_TOOLS, VERIFIER_DENIED_TOOLS, buildVerifierPrompt, runVerifier } from './verifier.mjs';

export const taskImage = (config) => `adw-e2e-${path.basename(config.task)}`;

// The verifier runs in the task's own image; the Docker layer cache makes rebuilding cheap.
export function buildTaskImage({ config, exec = (cmd, args) => execFileSync(cmd, args, { stdio: ['ignore', 'ignore', 'inherit'] }) }) {
  const dir = path.join(config.root, 'e2e', config.task, 'environment');
  exec('docker', ['build', '-t', taskImage(config), '-f', path.join(dir, 'Dockerfile'), dir]);
  return taskImage(config);
}

// Changes whenever anything that shapes a verdict changes: prompts, tools, models, rubric, criteria.
export function verifierHash({ config, criteria }) {
  const material = {
    verifierPrompt: buildVerifierPrompt({ criteria }), verifierTools: [VERIFIER_ALLOWED_TOOLS, VERIFIER_DENIED_TOOLS],
    reviewPrompt: buildReviewPrompt({ rubric: config.review.criteria, criteria, spec: '', summary: '', diffPath: '' }),
    reviewTools: [REVIEW_ALLOWED_TOOLS, REVIEW_DENIED_TOOLS],
    models: { verifier: config.verifier.model, review: config.review.model },
  };
  return createHash('sha256').update(JSON.stringify(material)).digest('hex');
}

// The coding agent authored this tree: its Claude settings (hooks, env, apiKeyHelper) must neither run nor steer a judge.
function stripAgentSettings(dir) {
  for (const f of ['settings.json', 'settings.local.json']) rmSync(path.join(dir, '.claude', f), { force: true });
}

const DEFAULT_DEPS = { checkoutBundle, runVerifier, runReview };

export function postVerify({ config, bundle, criteria, spec, summary, env = {}, image, deps = DEFAULT_DEPS }) {
  const nulls = Object.fromEntries(Object.keys(config.review.criteria).map((k) => [k, null]));
  const work = mkdtempSync(path.join(tmpdir(), 'adw-postverify-'));
  try {
    let verdict; let review;
    try {
      // Separate checkouts: the verifier runs the app in its tree, the review reads a pristine one.
      const { diff } = deps.checkoutBundle(bundle, path.join(work, 'verify'));
      deps.checkoutBundle(bundle, path.join(work, 'review'));
      stripAgentSettings(path.join(work, 'verify'));
      stripAgentSettings(path.join(work, 'review'));
      // The diff gets its own directory: the review's --add-dir exposes only the diff, never the checkouts.
      mkdirSync(path.join(work, 'diff'));
      const diffPath = path.join(work, 'diff', 'pr.diff');
      writeFileSync(diffPath, diff);
      verdict = deps.runVerifier({ config, checkout: path.join(work, 'verify'), criteria, env, image });
      review = isQuota(verdict.error) ? { scores: nulls, reasons: {}, error: verdict.error }
        : deps.runReview({ config, checkout: path.join(work, 'review'), diffPath, criteria, spec, summary, env });
    } catch (err) {
      const error = `checkout: ${err.message}`;
      verdict = { criteria: null, error };
      review = { scores: nulls, reasons: {}, error };
    }
    return outcome(criteria, verdict, review);
  } finally {
    try { rmSync(work, { recursive: true, force: true }); } catch (e) { console.warn(`! could not remove ${work}: ${e.message}`); }
  }
}

function outcome(criteria, verdict, review) {
  const v = verdict.criteria;
  const acceptanceCriteria = Object.fromEntries(criteria.map(({ id }) => [id, v ? (v[id].pass ? 'pass' : 'fail') : null]));
  const passed = Object.values(acceptanceCriteria).filter((x) => x === 'pass').length;
  return {
    acceptanceCriteria,
    acceptanceEvidence: v ? Object.fromEntries(criteria.map(({ id }) => [id, v[id].evidence])) : null,
    acceptance: v ? Number((passed / criteria.length).toFixed(4)) : null,
    verifierError: verdict.error,
    review: review.scores, reviewReasons: review.reasons, reviewError: review.error,
  };
}
