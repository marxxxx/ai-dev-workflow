#!/usr/bin/env node
// ADW E2E self-test CLI. See docs/adw-e2e/README.md.
import { execFileSync } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { loadConfig } from './lib/config.mjs';
import { buildFingerprint } from './lib/fingerprint.mjs';
import { buildHarborArgs, cleanupCompose, runHarbor } from './lib/harbor.mjs';
import { runPreflight } from './lib/preflight.mjs';
import { stageSecrets, scanForSecrets, redactSecrets, scrubSecretsInTree, removeOpenCodeAuthCopies } from './lib/secrets.mjs';
import { buildTrialRecord } from './lib/trial.mjs';
import { summarizeTrials } from './lib/summary.mjs';
import { compareRuns, findBaseline } from './lib/compare.mjs';
import { renderCompare, renderRunReport, renderSummary } from './lib/report.mjs';

const config = loadConfig();
const { positionals, values: opts } = parseArgs({ allowPositionals: true,
  options: { harness: { type: 'string', multiple: true }, repetitions: { type: 'string' } } });
const [command, ...rest] = positionals;
const harnesses = opts.harness?.length ? opts.harness : Object.keys(config.harnesses);
const task = path.join(config.root, 'e2e', config.task);
const demoRepo = path.join(task, 'environment/seed/repo');
const fail = (msg) => { console.error(`✗ ${msg}`); process.exit(2); };
const unknown = harnesses.filter((h) => !Object.hasOwn(config.harnesses, h));
if (unknown.length) fail(`unknown harness: ${unknown.join(', ')} (known: ${Object.keys(config.harnesses).join(', ')})`);
if (opts.repetitions !== undefined && !/^[1-9]\d*$/.test(opts.repetitions)) fail(`--repetitions must be a positive integer, got "${opts.repetitions}"`);
const git = (...a) => execFileSync('git', a, { cwd: config.root, encoding: 'utf8' }).trim();
const timestamp = () => new Date().toISOString().replace(/:\d\d\.\d+Z$/, 'Z').replace(/:/g, '');

// Every file under the results dir goes through here so known secret values never reach disk.
let secretValues = [];
function writeResult(file, text) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, redactSecrets(text, secretValues));
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

function compareDirs(baseDir, candDir) {
  const read = (d) => JSON.parse(readFileSync(path.join(d, 'run.json'), 'utf8'));
  const base = read(baseDir); const cand = read(candDir);
  const result = compareRuns(base, cand, config.thresholds);
  writeResult(path.join(candDir, 'compare.md'), renderCompare({ harness: cand.harness, base: baseDir, cand: candDir, result }));
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

async function run() {
  if (!preflight()) process.exit(1);
  rmSync(path.join(demoRepo, 'ai-project.json'), { force: true }); // init --answers needs a fresh tree
  execFileSync('node', ['agent-src/generate.mjs', 'init', '--answers', path.join(task, 'environment/seed/answers.json'), '--root', demoRepo],
    { cwd: config.root, stdio: 'inherit', input: '' });
  execFileSync('node', ['agent-src/generate.mjs', 'generate', '--root', demoRepo], { cwd: config.root, stdio: 'inherit' });
  const ts = timestamp();
  const jobsDir = path.join(config.root, config.jobsDir, ts);
  const outRoot = path.join(config.root, config.resultsDir, ts);
  mkdirSync(jobsDir, { recursive: true });
  const briefing = readFileSync(path.join(task, 'instruction.md'), 'utf8');
  const repetitions = Number(opts.repetitions ?? config.repetitions);
  const runs = {};
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
      const fingerprint = buildFingerprint({ config, harness, demoRepo });
      const trials = [];
      for (let i = 1; i <= repetitions; i++) {
        const id = `${harness}-${i}`;
        console.log(`▶ ${id}`);
        const failed = (harbor) => ({ id, reward: 0, contract: 0, checks: {}, acceptance: 0, ownTests: 0, judge: null, errors: { harbor, bridge: null, tool: 0, timeout: false, quota: false } });
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
          trial = trialDir ? buildTrialRecord({ id, harness, trialDir, config, briefing, env: staged.env }) : failed(`harbor exit ${code}`);
          if (trialDir && code !== 0 && !trial.errors.harbor) trial.errors.harbor = `harbor exit ${code}`;
          // The OpenCode adapter uploads its auth.json into the bind-mounted logs dir: never keep it.
          if (trialDir) rmSync(path.join(trialDir, 'agent/opencode/xdg-data/opencode/auth.json'), { force: true });
          if (trialDir && existsSync(path.join(trialDir, 'verifier'))) {
            const ev = path.join(outRoot, harness, 'evidence', id);
            for (const f of ['ticket.json', 'pulls.json', 'pr.diff', 'pr-commits.txt', 'acceptance.tap', 'acceptance-ui.txt', 'notes.txt', 'clone-error.txt']) {
              const src = path.join(trialDir, 'verifier', f);
              if (existsSync(src)) writeResult(path.join(ev, f), readFileSync(src, 'utf8'));
            }
            writeResult(path.join(ev, 'judge.json'), JSON.stringify({ scores: trial.judge, reasons: trial.judgeReasons, error: trial.judgeError }, null, 2));
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
      const runRecord = { schema: 1, harness, ...(aborted ? { aborted } : {}), fingerprint, config: { model: h.model, subagentModel: h.subagentModel ?? null, agentKwargs: h.agentKwargs, repetitions },
        trials, summary: summarizeTrials(trials) };
      const dir = path.join(outRoot, harness);
      writeResult(path.join(dir, 'run.json'), `${JSON.stringify(runRecord, null, 2)}\n`);
      writeResult(path.join(dir, 'report.md'), renderRunReport(runRecord));
      runs[harness] = runRecord;
      try {
        const baseline = findBaseline({ resultsDir: path.join(config.root, config.resultsDir), harness, before: ts,
          isAncestor: (sha) => { try { git('merge-base', '--is-ancestor', sha, 'main'); return true; } catch { return false; } } });
        if (baseline && !aborted) compareDirs(baseline, dir);
      } catch (e) { console.warn(`! baseline compare failed: ${e.message}`); }
    }
    writeResult(path.join(outRoot, 'summary.md'), renderSummary(runs));
    const leaks = scanForSecrets(outRoot, staged.values);
    if (leaks.length) {
      console.error(`✗ secrets found in results despite redaction:\n${leaks.join('\n')}`);
      process.exitCode = 1;
    }
    if (aborted) process.exitCode = 1;
    console.log(`results: ${outRoot}`);
  } finally {
    cleanup();
  }
}

if (command === 'preflight') process.exit(preflight() ? 0 : 1);
else if (command === 'run') await run();
else if (command === 'compare' && rest.length === 2) compareDirs(path.resolve(rest[0]), path.resolve(rest[1]));
else if (command === 'report' && rest.length === 1) {
  const r = JSON.parse(readFileSync(path.join(rest[0], 'run.json'), 'utf8'));
  writeFileSync(path.join(rest[0], 'report.md'), renderRunReport(r));
} else {
  console.error('usage: node e2e/run.mjs preflight|run [--harness h]... [--repetitions n] | compare <baseDir> <candDir> | report <harnessDir>');
  process.exit(2);
}
