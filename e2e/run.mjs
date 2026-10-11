#!/usr/bin/env node
// ADW E2E self-test CLI. See docs/adw-e2e/README.md.
import { execFileSync } from 'node:child_process';
import { cpSync, createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { loadConfig } from './lib/config.mjs';
import { buildFingerprint } from './lib/fingerprint.mjs';
import { buildHarborArgs, cleanupCompose, runHarbor } from './lib/harbor.mjs';
import { runPreflight } from './lib/preflight.mjs';
import { stageSecrets, scanForSecrets } from './lib/secrets.mjs';
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
const git = (...a) => execFileSync('git', a, { cwd: config.root, encoding: 'utf8' }).trim();
const timestamp = () => new Date().toISOString().replace(/:\d\d\.\d+Z$/, 'Z').replace(/:/g, '');

function preflight() {
  const staged = stageSecrets({ config, invocationDir: path.join(config.root, config.jobsDir, 'preflight') });
  const has = { 'claude-code': 'CLAUDE_CODE_OAUTH_TOKEN', codex: 'CODEX_AUTH_JSON_PATH', opencode: 'OPENCODE_AUTH_JSON_PATH' };
  const r = runPreflight({ config, harnesses, authPresent: (h) => Boolean(staged.env[has[h]]) });
  staged.cleanup();
  for (const w of r.warnings ?? []) console.warn(`! ${w}`);
  for (const p of r.problems) console.error(`✗ ${p}`);
  console.log(r.ok ? 'preflight ok' : 'preflight failed');
  return r.ok;
}

function compareDirs(baseDir, candDir) {
  const read = (d) => JSON.parse(readFileSync(path.join(d, 'run.json'), 'utf8'));
  const base = read(baseDir); const cand = read(candDir);
  const result = compareRuns(base, cand, config.thresholds);
  writeFileSync(path.join(candDir, 'compare.md'), renderCompare({ harness: cand.harness, base: baseDir, cand: candDir, result }));
  console.log(`${cand.harness}: ${result.verdict} (${path.join(candDir, 'compare.md')})`);
  return result;
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
  const staged = stageSecrets({ config, invocationDir: jobsDir });
  const briefing = readFileSync(path.join(task, 'instruction.md'), 'utf8');
  const repetitions = Number(opts.repetitions ?? config.repetitions);
  const runs = {};
  const onExit = () => { staged.cleanup(); cleanupCompose(); };
  process.on('SIGINT', () => { onExit(); process.exit(130); });
  try {
    for (const harness of harnesses) {
      const fingerprint = buildFingerprint({ config, harness, demoRepo });
      const trials = [];
      for (let i = 1; i <= repetitions; i++) {
        const id = `${harness}-${i}`;
        console.log(`▶ ${id}`);
        const log = createWriteStream(path.join(jobsDir, `${id}.log`));
        await runHarbor({ args: buildHarborArgs({ config, harness, jobName: id, jobsDir }), cwd: config.root, logStream: log,
          env: { ...staged.env, PYTHONPATH: path.join(config.root, 'e2e'), E2E_CLAUDE_SUBAGENT_MODEL: config.harnesses[harness].subagentModel ?? '' } });
        log.end();
        cleanupCompose();
        const jobDir = path.join(jobsDir, id);
        const trialDir = existsSync(jobDir) ? readdirSync(jobDir).map((d) => path.join(jobDir, d)).find((d) => path.basename(d).startsWith('demo-todo__')) : null;
        const trial = trialDir ? buildTrialRecord({ id, harness, trialDir, config, briefing })
          : { id, reward: 0, contract: 0, checks: {}, acceptance: 0, ownTests: 0, judge: null, errors: { harbor: 'no trial dir', bridge: null, tool: 0, timeout: false } };
        trials.push(trial);
        if (trialDir && existsSync(path.join(trialDir, 'verifier'))) {
          const ev = path.join(outRoot, harness, 'evidence', id);
          mkdirSync(ev, { recursive: true });
          for (const f of ['ticket.json', 'pulls.json', 'pr.diff', 'pr-commits.txt', 'acceptance.tap', 'acceptance-ui.txt', 'notes.txt']) {
            const src = path.join(trialDir, 'verifier', f);
            if (existsSync(src)) cpSync(src, path.join(ev, f));
          }
          writeFileSync(path.join(ev, 'judge.json'), JSON.stringify({ scores: trial.judge, reasons: trial.judgeReasons, error: trial.judgeError }, null, 2));
        }
        console.log(`  reward ${trial.reward} · contract ${trial.contract} · acceptance ${trial.acceptance}`);
      }
      const h = config.harnesses[harness];
      const runRecord = { schema: 1, harness, fingerprint, config: { model: h.model, subagentModel: h.subagentModel ?? null, agentKwargs: h.agentKwargs, repetitions },
        trials, summary: summarizeTrials(trials) };
      const dir = path.join(outRoot, harness);
      mkdirSync(dir, { recursive: true });
      writeFileSync(path.join(dir, 'run.json'), `${JSON.stringify(runRecord, null, 2)}\n`);
      writeFileSync(path.join(dir, 'report.md'), renderRunReport(runRecord));
      runs[harness] = runRecord;
      const baseline = findBaseline({ resultsDir: path.join(config.root, config.resultsDir), harness, before: ts,
        isAncestor: (sha) => { try { git('merge-base', '--is-ancestor', sha, 'main'); return true; } catch { return false; } } });
      if (baseline) compareDirs(baseline, dir);
    }
    writeFileSync(path.join(outRoot, 'summary.md'), renderSummary(runs));
    const leaks = scanForSecrets(outRoot, staged.values);
    if (leaks.length) {
      for (const f of leaks) rmSync(f);
      console.error(`✗ secrets found in results; deleted:\n${leaks.join('\n')}`);
      process.exitCode = 1;
    }
    console.log(`results: ${outRoot}`);
  } finally {
    onExit();
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
