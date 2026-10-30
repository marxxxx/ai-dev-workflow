// Trial records, run.json, report.md and the baseline compare for local runs (adw e2e).
// Same record and run shape as the Harbor self-test, so summary, report and compare are shared.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as metrics from '../lib/metrics.mjs';
import { ccusageUsage } from '../lib/ccusage.mjs';
import { emptyOutcome, rewardOf } from '../lib/trial.mjs';
import { summarizeTrials } from '../lib/summary.mjs';
import { renderCompare, renderRunReport } from '../lib/report.mjs';
import { compareRuns } from '../lib/compare.mjs';
import { configHash } from '../lib/config.mjs';
import { sha256File } from '../lib/fsutil.mjs';
import { selfJudged } from './config.mjs';
import { findLocalBaseline } from './store.mjs';

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DEFAULT_DEPS = { ...metrics, ccusageUsage };
const ROLES = ['agent', 'answerer', 'verifier', 'review'];
const roleName = ({ harness, model }) => `${harness}/${model ?? 'default'}`;
const hashIfAny = (file) => (existsSync(file) ? sha256File(file) : null);
const writeJson = (file, value) => writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);

// Unchecked (null) checks count in neither direction; no test command (ownTests null) fails nothing.
export const localReward = (t) => {
  const contract = Object.values(t.checks ?? {}).every((v) => v === null || v === 1) ? 1 : 0;
  return rewardOf({ acceptance: t.acceptance, contract, ownTests: t.ownTests });
};

// Share of the non-null checks that pass.
const contractOf = (checks) => {
  const v = Object.values(checks).filter((x) => x !== null);
  return v.length ? Number((v.filter((x) => x === 1).length / v.length).toFixed(4)) : null;
};

export function buildLocalTrialRecord({ id, harness, trialDir, config, criteria, checks, ownTests, conversation, agentSeconds, deps = DEFAULT_DEPS }) {
  const all = { ...checks, e2e_performed: config.appPort ? deps.e2ePerformed(harness, trialDir, config.appPort) : null };
  const tokens = deps.targetTokens(harness, trialDir);
  const ccusage = deps.ccusageUsage(harness, trialDir, tokens, { version: config.ccusage?.version });
  const record = {
    id, reward: 0, contract: contractOf(all), checks: all, ownTests, ...emptyOutcome(criteria),
    durations: { agent: agentSeconds }, tokens, cost: ccusage.cost, ccusage, userTokens: null,
    errors: { ...deps.errors(harness, trialDir, {}), harbor: null, bridge: conversation.error,
      timeout: conversation.error === 'agent-timeout', quota: conversation.error === 'quota' },
    soft: deps.softSignals(harness, trialDir), tools: deps.toolUsage(harness, trialDir, config.mcpServers ?? []),
    humanAsked: conversation.humanAsked, nudged: conversation.nudged ?? 0,
  };
  return { ...record, reward: localReward(record) };
}

// `root` is the adw package root. Every role's harness, model and CLI version is part of it, so a
// role change shows up in the fingerprint diff; ticket, answers and acceptance are file hashes.
export function localFingerprint({ root = PACKAGE_ROOT, image, imageId, e2eImage = null, cliVersions, baseCommit, worktree = null, dir, config, verifierHash, language, e2eSection = null }) {
  const roles = Object.fromEntries(ROLES.map((r) => [r, { harness: config[r].harness, model: config[r].model ?? null,
    cliVersion: cliVersions[config[r].harness] ?? null }]));
  return {
    adw: { version: JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).version, sha: null },
    // `worktree` (adw e2e . on uncommitted changes) only when set, so commit runs keep their fingerprint.
    baseCommit, ...(worktree ? { worktree } : {}), image: { ref: image, id: imageId, e2e: e2eImage }, roles,
    models: { target: roleName(roles.agent), answerer: roleName(roles.answerer), verifier: roleName(roles.verifier), review: roleName(roles.review) },
    ticket: hashIfAny(path.join(dir, 'ticket.md')), answers: hashIfAny(path.join(dir, 'answers.json')),
    acceptance: hashIfAny(path.join(dir, 'acceptance.md')), verifierHash, language, e2eSection: e2eSection ? createHash('sha256').update(e2eSection).digest('hex') : null, config: configHash(config),
  };
}

// A run that asked the human is no baseline: its answers were not yet all stored.
// `error` is the failure that aborted the run, if any.
export function writeRun({ runDir, ticket, fingerprint, trials, aborted, error = null }) {
  const run = {
    schema: 2, local: true, task: `#${ticket}`, harness: fingerprint.roles.agent.harness,
    ...(aborted ? { aborted } : {}), ...(error ? { error } : {}), comparable: !aborted && trials.every((t) => t.humanAsked === 0),
    humanAsked: trials.reduce((a, t) => a + (t.humanAsked ?? 0), 0), nudged: trials.reduce((a, t) => a + (t.nudged ?? 0), 0), selfJudged: selfJudged(fingerprint.roles),
    fingerprint, calibration: null, config: { model: fingerprint.roles.agent.model ?? 'default' },
    trials, summary: summarizeTrials(trials),
  };
  mkdirSync(runDir, { recursive: true });
  writeJson(path.join(runDir, 'run.json'), run);
  writeFileSync(path.join(runDir, 'report.md'), renderRunReport(run));
  return run;
}

// runDir is <dir>/runs/<ts>/<harness>; the baseline is the newest earlier comparable run on the same base commit,
// unless `baseline` (a run dir, --baseline) names one.
export function compareWithBaseline({ dir, runDir, run, config, baseline: explicit = null }) {
  const baseline = explicit ? path.resolve(explicit)
    : findLocalBaseline({ dir, harness: run.harness, before: path.basename(path.dirname(runDir)), baseCommit: run.fingerprint.baseCommit });
  if (!baseline) return null;
  const base = JSON.parse(readFileSync(path.join(baseline, 'run.json'), 'utf8'));
  const result = compareRuns(base, run, config.thresholds);
  writeFileSync(path.join(runDir, 'compare.md'), renderCompare({ task: run.task, harness: run.harness, base: baseline, cand: runDir, result, calibrated: undefined }));
  return { baseline, result };
}
