#!/usr/bin/env node
// ADW E2E self-test CLI. See docs/adw-e2e/README.md.
import { execFileSync } from 'node:child_process';
import { copyFileSync, createWriteStream, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { loadConfig } from './lib/config.mjs';
import { buildFingerprint } from './lib/fingerprint.mjs';
import { buildHarborArgs, cleanupCompose, runHarbor } from './lib/harbor.mjs';
import { runPreflight } from './lib/preflight.mjs';
import { stageSecrets, scanForSecrets, redactSecrets, scrubSecretsInTree, removeOpenCodeAuthCopies } from './lib/secrets.mjs';
import { applyPostVerification, buildTrialRecord, emptyOutcome, section, unjudgedOutcome } from './lib/trial.mjs';
import { summarizeTrials } from './lib/summary.mjs';
import { compareRuns, findBaseline } from './lib/compare.mjs';
import { renderCompare, renderRunReport, renderSummary } from './lib/report.mjs';
import { loadCriteria } from './lib/criteria.mjs';
import { buildTaskImage, postVerify, verifierHash } from './lib/postverify.mjs';
import { bundleLeaks, createCalibrationBundle } from './lib/bundle.mjs';
import { evaluateCalibration, findCalibration, renderCalibrationReport } from './lib/calibration.mjs';
import { isQuota } from './lib/claude.mjs';

const config = loadConfig();
const { positionals, values: opts } = parseArgs({ allowPositionals: true,
  options: { harness: { type: 'string', multiple: true }, repetitions: { type: 'string' }, trial: { type: 'string' }, runs: { type: 'string' } } });
const [command, ...rest] = positionals;
const harnesses = opts.harness?.length ? opts.harness : Object.keys(config.harnesses);
const task = path.join(config.root, 'e2e', config.task);
const demoRepo = path.join(task, 'environment/seed/repo');
const fail = (msg) => { console.error(`✗ ${msg}`); process.exit(2); };
const unknown = harnesses.filter((h) => !Object.hasOwn(config.harnesses, h));
if (unknown.length) fail(`unknown harness: ${unknown.join(', ')} (known: ${Object.keys(config.harnesses).join(', ')})`);
for (const name of ['repetitions', 'runs']) {
  if (opts[name] !== undefined && !/^[1-9]\d*$/.test(opts[name])) fail(`--${name} must be a positive integer, got "${opts[name]}"`);
}
const git = (...a) => execFileSync('git', a, { cwd: config.root, encoding: 'utf8' }).trim();
const timestamp = () => new Date().toISOString().replace(/:\d\d\.\d+Z$/, 'Z').replace(/:/g, '');
const criteria = loadCriteria(path.join(task, 'acceptance-criteria.md'));
const hash = verifierHash({ config, criteria });
const calibrationDir = path.join(config.root, config.resultsDir, 'calibration');
const calibration = () => findCalibration({ dir: calibrationDir, hash });
const acLine = (x) => Object.entries(x.acceptanceCriteria).map(([id, v]) => `${id} ${v ?? '—'}`).join(' · ');

// Every text file under the results dir goes through here so known secret values never reach disk.
let secretValues = [];
function writeResult(file, text) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, redactSecrets(text, secretValues));
}
const readRun = (dir) => JSON.parse(readFileSync(path.join(dir, 'run.json'), 'utf8'));
function writeRun(dir, record) {
  writeResult(path.join(dir, 'run.json'), `${JSON.stringify(record, null, 2)}\n`);
  writeResult(path.join(dir, 'report.md'), renderRunReport(record));
}
// summary.md covers every harness of one result set.
function writeSummary(outRoot) {
  const runs = Object.fromEntries(readdirSync(outRoot).filter((h) => existsSync(path.join(outRoot, h, 'run.json')))
    .map((h) => [h, readRun(path.join(outRoot, h))]));
  writeResult(path.join(outRoot, 'summary.md'), renderSummary(runs));
}

function safeCleanupCompose() {
  try { cleanupCompose(); } catch (e) { console.warn(`! compose cleanup failed: ${e.message}`); }
}

function preflight() {
  const staged = stageSecrets({ config, invocationDir: path.join(config.root, config.jobsDir, 'preflight') });
  const has = { 'claude-code': 'CLAUDE_CODE_OAUTH_TOKEN', codex: 'CODEX_AUTH_JSON_PATH', opencode: 'OPENCODE_AUTH_JSON_PATH' };
  let r;
  try {
    r = runPreflight({ config, harnesses, env: staged.env, authPresent: (h) => Boolean(staged.env[has[h]]) });
  } finally {
    staged.cleanup();
  }
  for (const w of r.warnings ?? []) console.warn(`! ${w}`);
  for (const p of r.problems) console.error(`✗ ${p}`);
  console.log(r.ok ? 'preflight ok' : 'preflight failed');
  return r.ok;
}

// verify and calibrate need only the Claude login (verifier and review).
function stageClaude(name) {
  const staged = stageSecrets({ config, invocationDir: path.join(config.root, config.jobsDir, name) });
  if (!staged.env.CLAUDE_CODE_OAUTH_TOKEN) { staged.cleanup(); fail(`claude login missing: put CLAUDE_CODE_OAUTH_TOKEN into ${config.auth.claudeEnvFile}`); }
  secretValues = staged.values;
  return staged;
}

// The E2E verifier and the review judge on one PR head (e2e/lib/postverify.mjs).
function postVerifyTrial(bundle, evidenceDir, env, image) {
  const ticket = JSON.parse(readFileSync(path.join(evidenceDir, 'ticket.json'), 'utf8'));
  return postVerify({ config, bundle, criteria, env, image,
    spec: section(ticket.comments, 'Approved Spec'), summary: section(ticket.comments, 'Implementation Summary') });
}
function writeVerdicts(evidenceDir, pv) {
  writeResult(path.join(evidenceDir, 'acceptance.json'),
    `${JSON.stringify({ criteria: pv.acceptanceCriteria, evidence: pv.acceptanceEvidence, error: pv.verifierError }, null, 2)}\n`);
  writeResult(path.join(evidenceDir, 'review.json'), `${JSON.stringify({ scores: pv.review, reasons: pv.reviewReasons, error: pv.reviewError }, null, 2)}\n`);
}

function compareDirs(baseDir, candDir) {
  const base = readRun(baseDir); const cand = readRun(candDir);
  for (const [dir, r] of [[baseDir, base], [candDir, cand]]) {
    if (r.schema !== 2) fail(`${dir}: schema ${r.schema ?? 1} runs cannot be compared (no bundles to re-verify)`);
  }
  const result = compareRuns(base, cand, config.thresholds);
  writeResult(path.join(candDir, 'compare.md'), renderCompare({ harness: cand.harness, base: baseDir, cand: candDir, result, calibrated: Boolean(cand.calibration) }));
  console.log(`${cand.harness}: ${result.verdict} (${path.join(candDir, 'compare.md')})`);
  return result;
}

// Last line of defence: no staged secret value may stay under the jobs dir (e.g. in agent logs).
function scrubJobs(jobsDir, values) {
  try {
    const { redacted, skippedWithSecret } = scrubSecretsInTree(jobsDir, values,
      { skip: (f) => path.relative(jobsDir, f).split(path.sep)[0] === '.secrets' });
    if (redacted.length) console.warn(`! redacted secrets in:\n${redacted.join('\n')}`);
    if (skippedWithSecret.length) console.warn(`! secrets in binary/db files left untouched (remove manually):\n${skippedWithSecret.join('\n')}`);
  } catch (e) { console.warn(`! jobs secret scan failed: ${e.message}`); }
}

function reportLeaks(dir, values) {
  const leaks = scanForSecrets(dir, values);
  if (leaks.length) {
    console.error(`✗ secrets found in results despite redaction:\n${leaks.join('\n')}`);
    process.exitCode = 1;
  }
}

// Whether the container verifier saw at least one PR (an unreadable file counts as none).
function hasPull(file) {
  try { return JSON.parse(readFileSync(file, 'utf8')).length > 0; } catch { return false; }
}

async function run() {
  if (!preflight()) process.exit(1);
  rmSync(path.join(demoRepo, 'ai-project.json'), { force: true }); // init --answers needs a fresh tree
  execFileSync('node', ['agent-src/generate.mjs', 'init', '--answers', path.join(task, 'environment/seed/answers.json'), '--root', demoRepo],
    { cwd: config.root, stdio: 'inherit', input: '' });
  execFileSync('node', ['agent-src/generate.mjs', 'generate', '--root', demoRepo], { cwd: config.root, stdio: 'inherit' });
  const image = buildTaskImage({ config });
  const calibrated = calibration();
  if (!calibrated) console.warn('! verifier not calibrated for this verifier hash: run node e2e/run.mjs calibrate');
  const ts = timestamp();
  const jobsDir = path.join(config.root, config.jobsDir, ts);
  const outRoot = path.join(config.root, config.resultsDir, ts);
  mkdirSync(jobsDir, { recursive: true });
  const repetitions = Number(opts.repetitions ?? config.repetitions);
  let aborted = null;
  let staged;
  let cleanedUp = false;
  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    try { removeOpenCodeAuthCopies(jobsDir); } catch (e) { console.warn(`! auth copy removal failed: ${e.message}`); }
    if (staged) scrubJobs(jobsDir, staged.values);
    staged?.cleanup();
    safeCleanupCompose();
  };
  process.on('SIGINT', () => { cleanup(); process.exit(130); });
  process.on('SIGTERM', () => { cleanup(); process.exit(143); });
  try {
    staged = stageSecrets({ config, invocationDir: jobsDir });
    secretValues = staged.values;
    for (const harness of harnesses) {
      if (aborted) break;
      const fingerprint = buildFingerprint({ config, harness, demoRepo, verifierHash: hash });
      const trials = [];
      for (let i = 1; i <= repetitions; i++) {
        const id = `${harness}-${i}`;
        console.log(`▶ ${id}`);
        const failed = (harbor) => ({ id, reward: 0, contract: 0, checks: {}, ownTests: 0, ...emptyOutcome(criteria),
          errors: { harbor, bridge: null, tool: 0, timeout: false, quota: false } });
        let trial;
        try {
          const log = createWriteStream(path.join(jobsDir, `${id}.log`));
          log.on('error', (e) => console.warn(`! log stream error: ${e.message}`));
          const code = await runHarbor({ args: buildHarborArgs({ config, harness, jobName: id, jobsDir }), cwd: config.root, logStream: log,
            timeoutMs: 7_200_000,
            env: { ...staged.env, PYTHONPATH: path.join(config.root, 'e2e'), E2E_CLAUDE_SUBAGENT_MODEL: config.harnesses[harness].subagentModel ?? '' } });
          log.end();
          safeCleanupCompose();
          const jobDir = path.join(jobsDir, id);
          const trialDir = existsSync(jobDir) ? readdirSync(jobDir).map((d) => path.join(jobDir, d)).find((d) => path.basename(d).startsWith('demo-todo__')) : null;
          trial = trialDir ? buildTrialRecord({ id, harness, trialDir, config, criteria }) : failed(`harbor exit ${code}`);
          if (trialDir && code !== 0 && !trial.errors.harbor) trial.errors.harbor = `harbor exit ${code}`;
          // The OpenCode adapter uploads its auth.json into the bind-mounted logs dir: never keep it.
          if (trialDir) rmSync(path.join(trialDir, 'agent/opencode/xdg-data/opencode/auth.json'), { force: true });
          if (trialDir && existsSync(path.join(trialDir, 'verifier'))) {
            const ev = path.join(outRoot, harness, 'evidence', id);
            mkdirSync(ev, { recursive: true });
            for (const f of ['ticket.json', 'pulls.json', 'pr.diff', 'pr-commits.txt', 'own-tests.txt', 'notes.txt', 'clone-error.txt']) {
              const src = path.join(trialDir, 'verifier', f);
              if (existsSync(src)) writeResult(path.join(ev, f), readFileSync(src, 'utf8'));
            }
            const bundle = path.join(trialDir, 'verifier/pr-head.bundle');
            if (existsSync(bundle)) {
              try {
                if (bundleLeaks(bundle, staged.values)) {
                  console.error(`✗ ${id}: a secret occurs in the PR history: bundle not stored, the trial cannot be re-verified`);
                  process.exitCode = 1;
                } else copyFileSync(bundle, path.join(ev, 'pr-head.bundle'));
              } catch (e) {
                console.error(`✗ ${id}: bundle could not be scanned for secrets (${e.message}): not stored, the trial cannot be re-verified`);
                process.exitCode = 1;
              }
              console.log('  post-verifying (E2E verifier, review)');
              try {
                const pv = postVerifyTrial(bundle, ev, staged.env, image);
                writeVerdicts(ev, pv);
                trial = applyPostVerification(trial, pv);
              } catch (e) {
                // A broken verifier is no agent failure: keep the trial, leave it unjudged.
                const error = `post-verification: ${e.message}`;
                console.error(`✗ ${id}: ${error}`);
                trial = applyPostVerification(trial, unjudgedOutcome(criteria, config, error));
              }
              console.log(`  ${acLine(trial)}`);
            } else if (hasPull(path.join(trialDir, 'verifier/pulls.json'))) {
              // A PR exists but its head could not be bundled: a verifier failure, not an agent failure.
              trial = applyPostVerification(trial, unjudgedOutcome(criteria, config, 'no PR-head bundle (see clone-error.txt)'));
              console.log(`  ${acLine(trial)}`);
            }
          }
        } catch (e) {
          trial = failed(`runner error: ${e.message}`);
          safeCleanupCompose();
        }
        trials.push(trial);
        console.log(`  reward ${trial.reward} · contract ${trial.contract} · acceptance ${trial.acceptance}`);
        // Every later trial would fail the same way and poison the comparison: stop here.
        if (trial.errors?.quota) {
          aborted = 'quota';
          console.error(`✗ subscription usage limit reached in ${id}: run aborted, results are not a valid baseline`);
          break;
        }
      }
      const h = config.harnesses[harness];
      const runRecord = { schema: 2, harness, ...(aborted ? { aborted } : {}), fingerprint, calibration: calibrated,
        config: { model: h.model, subagentModel: h.subagentModel ?? null, agentKwargs: h.agentKwargs, repetitions },
        trials, summary: summarizeTrials(trials) };
      const dir = path.join(outRoot, harness);
      writeRun(dir, runRecord);
      try {
        const baseline = findBaseline({ resultsDir: path.join(config.root, config.resultsDir), harness, before: ts,
          isAncestor: (sha) => { try { git('merge-base', '--is-ancestor', sha, 'main'); return true; } catch { return false; } } });
        if (baseline && !aborted) compareDirs(baseline, dir);
      } catch (e) { console.warn(`! baseline compare failed: ${e.message}`); }
    }
    writeSummary(outRoot);
    reportLeaks(outRoot, staged.values);
    if (aborted) process.exitCode = 1;
    console.log(`results: ${outRoot}`);
  } finally {
    cleanup();
  }
}

// Re-runs post-verification from the committed bundles, then rewrites run.json, report.md and summary.md.
async function verify(harnessDir, trialId) {
  const record = readRun(harnessDir);
  if (record.schema !== 2) fail(`${harnessDir}: schema ${record.schema ?? 1} runs have no bundles to re-verify`);
  if (trialId && !record.trials.some((t) => t.id === trialId)) fail(`no trial ${trialId} in ${harnessDir}`);
  const image = buildTaskImage({ config });
  const staged = stageClaude(`verify-${timestamp()}`);
  try {
    const verified = new Map();
    for (const t of record.trials) {
      if (trialId && t.id !== trialId) continue;
      const ev = path.join(harnessDir, 'evidence', t.id);
      const bundle = path.join(ev, 'pr-head.bundle');
      if (!existsSync(bundle)) { console.log(`- ${t.id}: no bundle (no PR head), kept as is`); continue; }
      console.log(`▶ verify ${t.id}`);
      const pv = postVerifyTrial(bundle, ev, staged.env, image);
      if (isQuota(pv.verifierError) || isQuota(pv.reviewError)) {
        console.error(`✗ subscription usage limit reached in ${t.id}: nothing written, rerun after the reset`);
        process.exitCode = 1;
        return;
      }
      verified.set(t.id, pv);
      console.log(`  ${acLine(pv)}`);
    }
    for (const [id, pv] of verified) writeVerdicts(path.join(harnessDir, 'evidence', id), pv);
    const trials = record.trials.map((t) => (verified.has(t.id) ? applyPostVerification(t, verified.get(t.id)) : t));
    writeRun(harnessDir, { ...record, calibration: calibration(), trials, summary: summarizeTrials(trials),
      fingerprint: { ...record.fingerprint, verifierHash: hash,
        models: { ...record.fingerprint.models, verifier: config.verifier.model, review: config.review.model } } });
    writeSummary(path.dirname(harnessDir));
    reportLeaks(harnessDir, staged.values);
    console.log(`verified: ${harnessDir}`);
  } finally {
    staged.cleanup();
  }
}

// Judges the known patch variants (e2e/tasks/<task>/calibration) and compares with expected.json.
async function calibrate() {
  const runs = Number(opts.runs ?? 2);
  const calDir = path.join(task, 'calibration');
  const expected = JSON.parse(readFileSync(path.join(calDir, 'expected.json'), 'utf8'));
  const spec = readFileSync(path.join(calDir, 'spec.md'), 'utf8');
  const summary = readFileSync(path.join(calDir, 'summary.md'), 'utf8');
  const image = buildTaskImage({ config });
  const ts = timestamp();
  const staged = stageClaude(`calibrate-${ts}`);
  const work = mkdtempSync(path.join(tmpdir(), 'adw-calibrate-'));
  try {
    const bundles = Object.fromEntries(Object.keys(expected).map((variant) => {
      const out = path.join(work, `${variant}.bundle`);
      createCalibrationBundle({ root: config.root, seedRepo: demoRepo, patch: path.join(calDir, `${variant}.patch`), out });
      return [variant, out];
    }));
    const results = Object.fromEntries(Object.keys(expected).map((v) => [v, []]));
    for (let i = 1; i <= runs; i++) {
      for (const [variant, bundle] of Object.entries(bundles)) {
        console.log(`▶ ${variant} (run ${i}/${runs})`);
        const pv = postVerify({ config, bundle, criteria, spec, summary, env: staged.env, image });
        if (isQuota(pv.verifierError) || isQuota(pv.reviewError)) {
          console.error('✗ subscription usage limit reached: calibration aborted, nothing written');
          process.exitCode = 1;
          return;
        }
        results[variant].push(pv);
        console.log(`  ${acLine(pv)}${pv.verifierError ? ` · verifier: ${pv.verifierError}` : ''}${pv.reviewError ? ` · review: ${pv.reviewError}` : ''}`);
      }
    }
    const evaluation = evaluateCalibration({ expected, results, criteria, rubric: config.review.criteria });
    const cal = { schema: 1, ts, hash, pass: evaluation.pass, runs, models: { verifier: config.verifier.model, review: config.review.model },
      findings: evaluation.findings, reviewMedians: evaluation.reviewMedians, variants: results };
    const out = path.join(calibrationDir, ts);
    writeResult(path.join(out, 'calibration.json'), `${JSON.stringify(cal, null, 2)}\n`);
    writeResult(path.join(out, 'report.md'), renderCalibrationReport(cal));
    reportLeaks(out, staged.values);
    console.log(`calibration ${cal.pass ? 'passed' : 'FAILED'}: ${out}`);
    if (!cal.pass) process.exitCode = 1;
  } finally {
    staged.cleanup();
    rmSync(work, { recursive: true, force: true });
  }
}

if (command === 'preflight') process.exit(preflight() ? 0 : 1);
else if (command === 'run') await run();
else if (command === 'verify' && rest.length === 1) await verify(path.resolve(rest[0]), opts.trial);
else if (command === 'calibrate' && rest.length === 0) await calibrate();
else if (command === 'compare' && rest.length === 2) compareDirs(path.resolve(rest[0]), path.resolve(rest[1]));
else if (command === 'report' && rest.length === 1) {
  const r = JSON.parse(readFileSync(path.join(rest[0], 'run.json'), 'utf8'));
  writeFileSync(path.join(rest[0], 'report.md'), renderRunReport(r));
} else {
  console.error('usage: node e2e/run.mjs preflight | run [--harness h]... [--repetitions n] | verify <harnessDir> [--trial id] | calibrate [--runs n] | compare <baseDir> <candDir> | report <harnessDir>');
  process.exit(2);
}
