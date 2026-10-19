// `adw e2e`: one replayable E2E run of agent-dev on a consumer project's ticket, wired from the e2e/local modules.
// Per trial: sandbox → agent session → answer loop → collect → contract + own tests → close; then acceptance (first
// time), judges, run.json, compare. Every compose project it starts is torn down, on Ctrl-C too.
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { parseArgs } from 'node:util';
import { HARNESSES, composeRunArgs, isInterrupt, InterruptError } from '../lib/llm.mjs';
import { parseCriteria } from '../lib/criteria.mjs';
import { median } from '../lib/summary.mjs';
import { redactSecrets } from '../lib/secrets.mjs';
import { applyPostVerification, emptyOutcome } from '../lib/trial.mjs';
import { postVerify, verifierHash } from '../lib/postverify.mjs';
import { loadLocalConfig, selfJudged } from './config.mjs';
import { appendAnswer, ensureGitignore, newRunDir, readAnswers, readTicket, ticketDir, writeTicket } from './store.mjs';
import { importTicket } from './ticket-import.mjs';
import { collectSandbox, createSandbox } from './sandbox.mjs';
import { appPortFromAgentsMd, evaluateLocalContract, hasE2eSection } from './contract.mjs';
import { composeEnv, composeProject, stageCredentials, startSession } from './session.mjs';
import { askHumanTty, makeDecide, runConversation } from './answerer.mjs';
import { confirmAcceptance, draftAcceptance, renderAcceptance } from './acceptance.mjs';
import { buildLocalTrialRecord, compareWithBaseline, localFingerprint, localReward, writeRun } from './record.mjs';

export const USAGE = 'usage: adw e2e <base-commit> <ticket> [claude-code|codex|opencode] [--repetitions n] [--model m] [--ticket-file f] [--baseline runDir] [--root dir]';
const SERVICE = 'ai-dev-workflow';
const ROLES = ['agent', 'answerer', 'verifier', 'review'];
const opening = (ticket) => `Nutze den agent-dev Skill für Ticket ${ticket}.`;
const timestamp = () => new Date().toISOString().replace(/:\d\d\.\d+Z$/, 'Z').replace(/:/g, '');
// spawnSync blocks the event loop: yielding once lets a pending Ctrl-C handler run before the next step.
const tick = () => new Promise((resolve) => setImmediate(resolve));

const usageError = (message) => Object.assign(new Error(message), { usage: true });

export function parseE2eArgs(argv) {
  let parsed;
  try {
    parsed = parseArgs({ args: argv, allowPositionals: true, options: { repetitions: { type: 'string' }, model: { type: 'string' },
      'ticket-file': { type: 'string' }, baseline: { type: 'string' }, root: { type: 'string' } } });
  } catch (err) { throw usageError(err.message); }
  const { positionals: [baseCommit, ticket, harness = null, ...extra], values: v } = parsed;
  if (!baseCommit || !ticket) throw usageError('base commit and ticket are required');
  if (extra.length) throw usageError(`unexpected argument: ${extra.join(' ')}`);
  if (!/^[1-9]\d*$/.test(ticket)) throw usageError(`the ticket must be a positive integer, got "${ticket}"`);
  if (harness !== null && !HARNESSES.includes(harness)) throw usageError(`unknown harness "${harness}" (${HARNESSES.join(', ')})`);
  if (v.repetitions !== undefined && !/^[1-9]\d*$/.test(v.repetitions)) throw usageError(`--repetitions must be a positive integer, got "${v.repetitions}"`);
  return { baseCommit, ticket: Number(ticket), harness, repetitions: Number(v.repetitions ?? 1), model: v.model ?? null,
    ticketFile: v['ticket-file'] ?? null, baseline: v.baseline ?? null, root: v.root ?? process.cwd() };
}

// One line typed on the terminal (the acceptance confirmation). Not a TTY readline, so Ctrl-C stays a SIGINT.
async function promptLine(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: false });
  try { return await rl.question(question); } finally { rl.close(); }
}

// Ctrl-C and SIGTERM call `handler` until the returned function uninstalls it.
function onSignal(handler) {
  const h = () => handler();
  process.on('SIGINT', h);
  process.on('SIGTERM', h);
  return () => { process.off('SIGINT', h); process.off('SIGTERM', h); };
}

const DEFAULT_DEPS = {
  env: process.env, home: homedir(), uid: process.getuid?.() ?? 1000, gid: process.getgid?.() ?? 1000,
  exec: (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opts }),
  importTicket, createSandbox, collectSandbox, startSession, makeDecide, runConversation, askHuman: askHumanTty(),
  draftAcceptance, confirmAcceptance, prompt: promptLine, postVerify, buildLocalTrialRecord,
  now: timestamp, clock: () => Date.now(), log: (s) => console.log(s), error: (s) => console.error(s), onSignal, exit: (code) => process.exit(code),
};

// Every problem that would stop the run later, found before any container starts.
function preflight({ root, config, baseCommit, d }) {
  const problems = [];
  const docker = d.exec('docker', ['version', '--format', '{{.Server.Version}}']);
  if (docker.error || docker.status !== 0) problems.push('docker not found or not running');
  if (!existsSync(path.join(root, 'compose.ai-dev.yml'))) problems.push(`${path.join(root, 'compose.ai-dev.yml')} not found: run adw init and write the container files`);
  const creds = stageCredentials({ harnesses: ROLES.map((r) => config[r].harness), env: d.env, home: d.home });
  for (const role of ROLES) {
    for (const m of creds.missing.filter((x) => x.harness === config[role].harness)) problems.push(`${role} uses ${m.harness}: ${m.what} not found`);
  }
  for (const name of config.env) if (!d.env[name]) problems.push(`e2e.env: ${name} is not set`);
  const git = d.exec('git', ['-C', root, 'rev-parse', '--verify', `${baseCommit}^{commit}`]);
  const sha = git.status === 0 ? String(git.stdout).trim() : null;
  if (!sha) problems.push(`base commit ${baseCommit} does not resolve`);
  return { problems, creds, sha };
}

// The text of the `## <title>` section agent-dev appended to the ticket file.
const sectionOf = (ticketFile, title) => ticketFile.split('\n---\n## ').slice(1).filter((s) => s.split('\n')[0].trim() === title).join('\n');
const readIf = (file) => (existsSync(file) ? readFileSync(file, 'utf8') : '');

export async function runE2e(opts, deps = {}) {
  const d = { ...DEFAULT_DEPS, ...deps };
  const root = path.resolve(opts.root);
  const config = loadLocalConfig(root, { harness: opts.harness ?? undefined, model: opts.model ?? undefined });
  const { problems, creds, sha } = preflight({ root, config, baseCommit: opts.baseCommit, d });
  if (problems.length) {
    for (const p of problems) d.error(`✗ preflight: ${p}`);
    return 1;
  }
  for (const r of ROLES) d.log(`${r.padEnd(9)} ${config[r].harness}/${config[r].model ?? 'default'}`);
  const self = selfJudged(config);
  if (self.length) d.log(`! ${self.join(', ')} judge with the agent's own harness and model: self-judging`);

  ensureGitignore(root);
  const dir = ticketDir(root, opts.ticket);
  if (!readTicket(dir)) {
    const file = path.join(root, 'ai-project.json');
    const project = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
    const ticketFile = opts.ticketFile ? readFileSync(path.resolve(opts.ticketFile), 'utf8') : undefined;
    writeTicket(dir, d.importTicket({ root, ticket: opts.ticket, project, ticketFile }));
  }
  const ticketText = readTicket(dir);
  const acceptanceFile = path.join(dir, 'acceptance.md');
  let criteria = existsSync(acceptanceFile) ? parseCriteria(readFileSync(acceptanceFile, 'utf8')) : null;
  const ts = d.now();
  const harness = config.agent.harness;
  const runDir = newRunDir(dir, harness, ts);
  const store = { list: () => readAnswers(dir), append: (a) => appendAnswer(dir, a) };
  const composeFile = path.join(root, 'compose.ai-dev.yml');
  const certsFile = path.join(root, 'compose.ai-dev.certs.yml');
  const composeArgs = (env, project) => ['compose', '-f', composeFile, ...(env.AGENT_CA_DIR ? ['-f', certsFile] : []), '-p', project];

  // Compose projects started and not yet torn down: project → { work, agent }.
  const active = new Map();
  const down = (project) => {
    const { work, agent } = active.get(project);
    active.delete(project);
    const env = composeEnv({ root, work, env: d.env, uid: d.uid, gid: d.gid });
    if (agent) d.exec('docker', ['rm', '-f', `${project}-agent`]);
    d.exec('docker', [...composeArgs(env, project), 'down', '-v'], { env });
  };
  const teardownAll = () => { for (const project of [...active.keys()]) down(project); };
  const off = d.onSignal(() => { teardownAll(); d.exit(130); });

  const cliVersions = {};
  const trials = [];
  let aborted = null;
  try {
    for (let i = 1; i <= opts.repetitions; i++) {
      const id = `${harness}-${i}`;
      const trialDir = path.join(runDir, id);
      const project = composeProject(root, `${opts.ticket}-${ts}-${i}`);
      const judgeProject = composeProject(root, `${opts.ticket}-${ts}-${i}-judge`);
      d.log(`trial ${id}`);
      const { work, origin } = d.createSandbox({ root, baseCommit: sha, ticket: opts.ticket, ticketText, trialDir });
      const judgeEnv = composeEnv({ root, work, env: d.env, uid: d.uid, gid: d.gid });
      // Judge-side containers (answerer, drafting, judges, own tests) share one compose project per trial.
      const buildArgs = (harnesses) => composeRunArgs({ composeFile, certsFile: judgeEnv.AGENT_CA_DIR ? certsFile : null, project: judgeProject,
        uid: d.uid, gid: d.gid, envNames: [...config.env, ...creds.envNames],
        authMounts: creds.authFiles.filter((f) => harnesses.includes(f.harness)).map((f) => `${f.from}:${f.to}`) });
      const run = (cmd, args, o = {}) => d.exec(cmd, args, { ...o, env: { ...o.env, ...judgeEnv } });
      const transcript = (kind) => (text) => {
        mkdirSync(trialDir, { recursive: true });
        appendFileSync(path.join(trialDir, `${kind}.jsonl`), redactSecrets(text, creds.secrets));
      };

      let trial;
      active.set(project, { work, agent: true });
      active.set(judgeProject, { work, agent: false });
      try {
        let conversation; let appListening = null; let agentSeconds = null; let port = null;
        const session = d.startSession({ root, work, harness, model: config.agent.model, project, creds, envNames: config.env,
          env: d.env, turnTimeoutSec: config.turnTimeoutSec });
        try {
          for (const h of new Set(ROLES.map((r) => config[r].harness))) {
            try { cliVersions[h] ??= session.cliVersion(h); } catch { cliVersions[h] ??= 'unknown'; }
          }
          const decide = d.makeDecide({ ticket: ticketText, harness: config.answerer.harness, model: config.answerer.model,
            buildArgs: buildArgs([config.answerer.harness]), name: `${judgeProject}-answerer`, checkout: work,
            timeoutMs: config.answerer.timeoutSec * 1000, run, onStdout: transcript('answerer') });
          const t0 = d.clock();
          conversation = await d.runConversation({ ticket: opts.ticket, harness, opening: opening(opts.ticket), session, decide,
            askHuman: d.askHuman, store, maxTurns: config.maxTurns });
          agentSeconds = Math.round((d.clock() - t0) / 1000);
          await tick();
          port = appPortFromAgentsMd(readIf(path.join(work, 'AGENTS.md'))) ?? config.appPort;
          if (port) {
            try { appListening = session.appListening(port); } catch { appListening = null; }
          }
        } finally {
          try { session.close(trialDir); } finally { active.delete(project); }
        }

        const collected = d.collectSandbox({ work, origin, ticket: opts.ticket });
        const checks = evaluateLocalContract({ ticket: opts.ticket, ticketFile: collected.ticketFile, branches: collected.branches,
          diff: collected.diff, appListening });
        let ownTests = null;
        if (config.testCommand) {
          const r = d.exec('docker', [...composeArgs(judgeEnv, judgeProject), 'run', '--rm', '-T', SERVICE, 'bash', '-lc', config.testCommand],
            { env: judgeEnv });
          if (r.status === 130 || r.status === 143) throw new InterruptError(r.status === 130 ? 'SIGINT' : 'SIGTERM');
          writeFileSync(path.join(trialDir, 'own-tests.txt'), redactSecrets(`${r.stdout ?? ''}${r.stderr ?? ''}`, creds.secrets));
          ownTests = r.status === 0 ? 1 : 0;
          await tick();
        }

        // The first PR head without stored criteria: draft them from ticket + answers, the human confirms.
        if (!criteria && collected.bundle) {
          try {
            const draft = d.draftAcceptance({ ticket: ticketText, answers: readAnswers(dir), harness: config.answerer.harness,
              model: config.answerer.model, buildArgs: buildArgs([config.answerer.harness]), name: `${judgeProject}-acceptance`,
              checkout: work, timeoutMs: config.answerer.timeoutSec * 1000, run });
            // A readline aborted by Ctrl-C rejects with an AbortError: that is an interrupt, not a failed draft.
            const prompt = (q) => Promise.resolve(d.prompt(q)).catch((err) => { throw err?.code === 'ABORT_ERR' ? new InterruptError('SIGINT') : err; });
            criteria = await d.confirmAcceptance({ draft: renderAcceptance(ticketText.title, draft), file: acceptanceFile, prompt });
          } catch (err) {
            if (isInterrupt(err)) throw err;
            d.error(`! acceptance draft failed: ${err.message}`);
          }
        }

        trial = d.buildLocalTrialRecord({ id, harness, trialDir, config: { ...config, appPort: port }, criteria: criteria ?? [], checks,
          ownTests, conversation, agentSeconds });
        let outcome;
        // Without criteria or an E2E section the verifier is skipped (acceptance null); the review still runs.
        let skipVerifier;
        if (!criteria) skipVerifier = 'verifier skipped: no acceptance criteria (acceptance.md missing)';
        else if (!hasE2eSection(readIf(path.join(work, 'AGENTS.md')))) {
          d.log('  hint: add an "## End-to-end testing" section to AGENTS.md so the verifier can run the app');
          skipVerifier = 'verifier skipped: AGENTS.md has no "## End-to-end testing" section';
        }
        if (!collected.bundle) outcome = emptyOutcome(criteria ?? []);
        else {
          d.log(skipVerifier ? '  post-verifying (review)' : '  post-verifying (E2E verifier, review)');
          outcome = d.postVerify({ config, bundle: collected.bundle, criteria: criteria ?? [], env: judgeEnv, skipVerifier,
            buildArgs: buildArgs([...(skipVerifier ? [] : [config.verifier.harness]), config.review.harness]),
            spec: sectionOf(collected.ticketFile, 'Approved Spec'), summary: sectionOf(collected.ticketFile, 'Implementation Summary'),
            onTranscript: (kind, text) => transcript(kind)(text) });
          await tick();
          writeFileSync(path.join(trialDir, 'acceptance.json'),
            `${JSON.stringify({ criteria: outcome.acceptanceCriteria, evidence: outcome.acceptanceEvidence, error: outcome.verifierError }, null, 2)}\n`);
          writeFileSync(path.join(trialDir, 'review.json'),
            `${JSON.stringify({ scores: outcome.review, reasons: outcome.reviewReasons, error: outcome.reviewError }, null, 2)}\n`);
        }
        // The local reward rules (null checks, no test command) win over the Harbor ones.
        const merged = applyPostVerification(trial, outcome);
        trial = { ...merged, reward: localReward(merged) };
      } finally {
        if (active.has(project)) down(project);
        if (active.has(judgeProject)) down(judgeProject);
      }
      trials.push(trial);
      d.log(`  reward ${trial.reward} · contract ${trial.contract} · acceptance ${trial.acceptance ?? '—'}`);
      // Every later trial would hit the same limit and poison the comparison.
      if (trial.errors?.quota) { aborted = 'quota'; d.error(`✗ usage limit reached in ${id}: run aborted, not a valid baseline`); break; }
    }

    const fingerprint = localFingerprint({ ...imageOf(d, composeArgs, root), cliVersions, baseCommit: sha, dir, config,
      verifierHash: criteria ? verifierHash({ config, criteria }) : null });
    const run = writeRun({ runDir, ticket: opts.ticket, fingerprint, trials, aborted });
    let cmp = null;
    try { cmp = compareWithBaseline({ dir, runDir, run, config, baseline: opts.baseline }); } catch (err) { d.error(`! baseline compare failed: ${err.message}`); }
    printSummary(d, run, cmp, runDir);
    return aborted ? 1 : 0;
  } catch (err) {
    teardownAll();
    if (isInterrupt(err)) { d.error(`✗ ${err.message}: stopped, nothing written for the interrupted trial`); return 130; }
    d.error(`✗ ${err.message}`);
    return 1;
  } finally {
    off();
  }
}

// The project image's ref and id; both null when compose or docker cannot tell.
function imageOf(d, composeArgs, root) {
  const env = composeEnv({ root, work: root, env: d.env, uid: d.uid, gid: d.gid });
  const r = d.exec('docker', [...composeArgs(env, 'adw-e2e-image'), 'config', '--images', SERVICE], { env });
  const image = r.status === 0 ? String(r.stdout ?? '').trim().split('\n')[0] || null : null;
  const i = image ? d.exec('docker', ['image', 'inspect', '--format', '{{.Id}}', image]) : null;
  return { image, imageId: i?.status === 0 ? String(i.stdout ?? '').trim() || null : null };
}

function printSummary(d, run, cmp, runDir) {
  const s = run.summary;
  const tokens = s.median.tokens ?? '—';
  const cost = s.median.cost == null ? '—' : `$${s.median.cost.toFixed(2)}`;
  d.log(`reward      ${s.rewardRate ?? '—'}`);
  d.log(`contract    ${median(run.trials.map((t) => t.contract)) ?? '—'}`);
  d.log(`acceptance  ${s.checkRates.acceptance ?? '—'}`);
  d.log(`tokens/cost ${tokens} · ${cost}`);
  d.log(`baseline    ${cmp ? `${cmp.result.verdict} vs ${cmp.baseline}` : 'no baseline'}`);
  if (!run.comparable) d.log(`not comparable: ${run.aborted ? `aborted (${run.aborted})` : `${run.humanAsked} new answers`}`);
  d.log(`results: ${runDir}`);
}

// Entry point of `adw e2e`; returns the exit code.
export async function main(argv, deps = {}) {
  const d = { ...DEFAULT_DEPS, ...deps };
  if (argv.includes('--help') || argv.includes('-h')) { d.log(USAGE); return 0; }
  let opts;
  try { opts = parseE2eArgs(argv); } catch (err) {
    d.error(USAGE);
    d.error(`✗ ${err.message}`);
    return 2;
  }
  try { return await runE2e(opts, deps); } catch (err) {
    d.error(`✗ ${err.message}`);
    return 1;
  }
}
