import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as metrics from '../lib/metrics.mjs';
import { makeClaudeTrial } from '../lib/fixtures/make.mjs';
import { parseCriteria } from '../lib/criteria.mjs';
import { InterruptError } from '../lib/llm.mjs';
import { buildLocalTrialRecord } from './record.mjs';
import { confirmAcceptance } from './acceptance.mjs';
import { USAGE, main, parseE2eArgs, runE2e, timestamp } from './cli.mjs';

const GENERATE = fileURLToPath(new URL('../../agent-src/generate.mjs', import.meta.url));
const E2E_SECTION = '# Agents\n\n## End-to-end testing\n\nStart with `npm start`, open http://localhost:3000/.\n';
const DEPS = { ...metrics, ccusageUsage: () => ({ ccusageTotal: null, deviation: null, warning: null, cost: 0.5, models: null }) };
const TICKET_FILE = '---\nstatus: review\n---\n\nbody\n\n---\n## Approved Spec\n\nthe spec\n\n---\n## Implementation Summary\n\nTested end to end.\n\n---\n## Cost Summary\n\n$1\n';

// A consumer project root with compose file and ai-project.json; `e2e` is its e2e block.
function project(e2e = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'adw-cli-'));
  writeFileSync(path.join(root, 'compose.ai-dev.yml'), 'services: {}\n');
  writeFileSync(path.join(root, 'ai-project.json'), JSON.stringify({ ticketing: { backend: 'file' }, e2e }));
  writeFileSync(path.join(root, 'issue.md'), '# Fälligkeitsdatum\n\nTodos bekommen ein Datum.\n');
  mkdirSync(path.join(root, 'home'));
  return root;
}

// Every external effect stubbed; `calls` is the order of the orchestration steps, `exec` every docker/git call.
function stubs(root, over = {}) {
  const calls = []; const exec = []; const out = []; const seen = {};
  const rec = (name, fn) => (...a) => { calls.push(name); return fn(...a); };
  const session = { prompt: async () => 'ok', close: rec('close', () => null), appListening: rec('appListening', () => 0), cliVersion: (h) => `${h} 1.0` };
  const deps = {
    env: { CLAUDE_CODE_OAUTH_TOKEN: 'tok-secret', PATH: process.env.PATH }, home: path.join(root, 'home'), uid: 1000, gid: 1000,
    exec: (cmd, args, opts = {}) => {
      exec.push({ argv: [cmd, ...args], env: opts.env });
      if (cmd === 'git') return { status: 0, stdout: 'abc123\n', stderr: '' };
      return { status: 0, stdout: '', stderr: '' };
    },
    createSandbox: rec('sandbox', ({ trialDir }) => {
      const work = path.join(trialDir, 'work');
      mkdirSync(work, { recursive: true });
      writeFileSync(path.join(work, 'AGENTS.md'), E2E_SECTION);
      makeClaudeTrial(trialDir);
      return { work, origin: path.join(trialDir, 'origin.git') };
    }),
    startSession: rec('session', (a) => { seen.session = a; return session; }),
    ensureE2eImage: rec('image', (a) => { seen.image = a; return { image: 'img:1', imageId: 'sha256:1', tag: 'adw-e2e:abc', overrideFile: '/run/o.yml' }; }),
    makeDecide: rec('makeDecide', (a) => { seen.decide = a; return () => ({ action: 'done', stuck: false }); }),
    runConversation: rec('conversation', async (a) => { seen.conversation = a; return { turns: 2, humanAsked: 0, done: true, stuck: false, error: null }; }),
    askHuman: () => 'x',
    collectSandbox: rec('collect', () => ({ ticketFile: TICKET_FILE, branches: ['7_due'], bundle: '/b.bundle', diff: '',
      prs: [{ tool: 'gh', branch: '7_due', draft: true, title: '7: Due dates' }] })),
    draftAcceptance: rec('draft', (a) => { seen.draft = a; return [{ id: 'AC1', text: 'a date shows' }]; }),
    confirmAcceptance: rec('confirm', async ({ draft, file }) => { writeFileSync(file, draft); return parseCriteria(draft); }),
    prompt: async () => 'a',
    postVerify: rec('postVerify', (a) => {
      seen.postVerify = a;
      const skip = a.skipVerifier;
      return { acceptanceCriteria: Object.fromEntries(a.criteria.map((c) => [c.id, skip ? null : 'pass'])), acceptanceEvidence: skip ? null : { AC1: 'seen' },
        acceptance: skip ? null : 1, verifierError: skip ?? null, review: { scope: 5 }, reviewReasons: { scope: 'ok' }, reviewError: null };
    }),
    buildLocalTrialRecord: rec('record', (a) => { seen.record = a; return buildLocalTrialRecord({ ...a, deps: DEPS }); }),
    now: () => '2026-10-19T1000Z', clock: () => 0,
    log: (s) => out.push(String(s)), error: (s) => out.push(String(s)),
    onSignal: (h) => { seen.signal = h; return () => { seen.signalOff = true; }; },
    exit: (code) => { seen.exit = code; },
    ...over,
  };
  return { deps, calls, exec, out, seen, session };
}

const opts = (root, over = {}) => ({ baseCommit: 'HEAD', ticket: 7, harness: 'claude-code', repetitions: 1, model: null,
  ticketFile: path.join(root, 'issue.md'), baseline: null, root, ...over });
const downs = (exec) => exec.filter((c) => c.argv.includes('down')).map((c) => c.argv[c.argv.indexOf('-p') + 1]);
const runJson = (root) => JSON.parse(readFileSync(path.join(root, '.adw/e2e/7/runs/2026-10-19T1000Z/claude-code/run.json'), 'utf8'));

test('parseE2eArgs: positionals and flags; the harness is optional', () => {
  assert.deepEqual(parseE2eArgs(['abc', '7', 'codex', '--repetitions', '2', '--model', 'm', '--ticket-file', 'i.md', '--baseline', 'b', '--root', '/p']),
    { baseCommit: 'abc', ticket: 7, harness: 'codex', repetitions: 2, model: 'm', ticketFile: 'i.md', baseline: 'b', root: '/p' });
  assert.deepEqual(parseE2eArgs(['HEAD', '12']),
    { baseCommit: 'HEAD', ticket: 12, harness: null, repetitions: 1, model: null, ticketFile: null, baseline: null, root: process.cwd() });
});

test('parseE2eArgs: usage errors', () => {
  for (const argv of [[], ['HEAD'], ['HEAD', '0'], ['HEAD', 'x'], ['HEAD', '1.5'], ['HEAD', '7', 'gpt'], ['HEAD', '7', 'codex', 'extra'],
    ['HEAD', '7', '--repetitions', '0'], ['HEAD', '7', '--nope']]) {
    assert.throws(() => parseE2eArgs(argv), (e) => e.usage === true, JSON.stringify(argv));
  }
});

test('main: a usage error exits 2 with the usage line first; --help exits 0', async () => {
  const out = [];
  assert.equal(await main([], { error: (s) => out.push(s), log: (s) => out.push(s) }), 2);
  assert.equal(out[0], USAGE);
  assert.equal(await main(['--help'], { log: (s) => out.push(s) }), 0);
});

test('node agent-src/generate.mjs e2e without args exits 2 with the usage line', () => {
  const r = spawnSync(process.execPath, [GENERATE, 'e2e'], { encoding: 'utf8' });
  assert.equal(r.status, 2);
  assert.equal(r.stderr.split('\n')[0], USAGE);
});

test('preflight: a judge harness without login fails before any compose call, naming role, harness and login', async () => {
  const root = project({ review: { harness: 'codex' } });
  try {
    const s = stubs(root);
    assert.equal(await runE2e(opts(root), s.deps), 1);
    assert.ok(s.out.some((l) => l.includes('review uses codex: ~/.codex/auth.json or OPENAI_API_KEY not found')), s.out.join('\n'));
    assert.deepEqual(s.calls, []);
    assert.equal(s.exec.some((c) => c.argv.includes('compose')), false);
    assert.equal(existsSync(path.join(root, '.adw')), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('preflight: an unset e2e.env name, a missing compose file and an unresolvable base commit fail before any compose call', async () => {
  const root = project({ env: ['AZURE_API_KEY'] });
  try {
    rmSync(path.join(root, 'compose.ai-dev.yml'));
    const s = stubs(root);
    s.deps.exec = (cmd, args) => { s.exec.push({ argv: [cmd, ...args] }); return cmd === 'git' ? { status: 128, stdout: '', stderr: 'bad' } : { status: 0, stdout: '' }; };
    assert.equal(await runE2e(opts(root), s.deps), 1);
    const text = s.out.join('\n');
    assert.match(text, /e2e\.env: AZURE_API_KEY is not set/);
    assert.match(text, /compose\.ai-dev\.yml not found/);
    assert.match(text, /base commit HEAD does not resolve/);
    assert.deepEqual(s.calls, []);
    assert.equal(s.exec.some((c) => c.argv.includes('compose')), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('runE2e: the order of a first run; the ticket is imported, acceptance drafted, judged and recorded', async () => {
  const root = project();
  try {
    const s = stubs(root);
    assert.equal(await runE2e(opts(root), s.deps), 0);
    assert.deepEqual(s.calls, ['image', 'sandbox', 'session', 'makeDecide', 'conversation', 'appListening', 'close', 'collect', 'draft', 'confirm', 'record', 'postVerify']);
    const dir = path.join(root, '.adw/e2e/7');
    assert.equal(readFileSync(path.join(dir, 'ticket.md'), 'utf8'), '# Fälligkeitsdatum\n\nTodos bekommen ein Datum.\n');
    assert.equal(readFileSync(path.join(root, '.adw/e2e/.gitignore'), 'utf8'), '*/runs/\n');
    assert.ok(existsSync(path.join(dir, 'acceptance.md')));
    assert.equal(s.seen.conversation.opening, 'Nutze den agent-dev Skill für Ticket 7.');
    assert.equal(s.seen.conversation.ticket, 7);
    assert.deepEqual(s.seen.conversation.store.list().map((a) => a.id).slice(0, 2), ['A1', 'A2']);
    assert.equal(s.seen.session.envNames.length, 0);
    assert.equal(s.seen.postVerify.spec.includes('the spec'), true);
    // The app port comes from the AGENTS.md E2E section.
    assert.equal(s.seen.record.config.appPort, 3000);
    const run = runJson(root);
    assert.equal(run.fingerprint.baseCommit, 'abc123');
    assert.equal(run.fingerprint.roles.agent.cliVersion, 'claude-code 1.0');
    assert.equal(run.trials[0].acceptance, 1);
    assert.equal(run.trials[0].reward, 1);
    assert.ok(s.seen.signalOff, 'signal handlers restored');
    // Judge project torn down, summary printed with no baseline.
    assert.ok(downs(s.exec).some((p) => p.endsWith('-judge')));
    const text = s.out.join('\n');
    assert.match(text, /reward\s+1/);
    assert.match(text, /no earlier fully replayed run; this run is the new baseline/);
    assert.doesNotMatch(text, /not comparable/);

    // A second run reuses ticket.md and acceptance.md: no import, no draft; it compares with the first.
    const t = stubs(root, { now: () => '2026-10-19T1100Z' });
    assert.equal(await runE2e(opts(root, { ticketFile: null }), t.deps), 0);
    assert.equal(t.calls.includes('draft'), false);
    assert.match(t.out.join('\n'), /baseline\s+same/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('runE2e: judges and answerer get their own role harness, provider env by name and the judge compose project', async () => {
  const root = project({ verifier: { harness: 'opencode', model: 'azure/gpt' }, review: { harness: 'codex' }, answerer: { harness: 'codex' }, env: ['AZURE_API_KEY'] });
  try {
    const s = stubs(root);
    s.deps.env = { ...s.deps.env, OPENAI_API_KEY: 'sk-x', AZURE_API_KEY: 'az' };
    assert.equal(await runE2e(opts(root), s.deps), 0);
    const pv = s.seen.postVerify;
    assert.equal(pv.config.verifier.harness, 'opencode');
    assert.equal(pv.config.verifier.model, 'azure/gpt');
    assert.equal(pv.config.review.harness, 'codex');
    assert.equal(s.seen.decide.harness, 'codex');
    assert.equal(s.seen.draft.harness, 'codex');
    const argv = pv.buildArgs({ name: 'n', checkout: '/c', argv: ['x'] });
    const project = argv[argv.indexOf('-p') + 1];
    assert.match(project, /-judge$/);
    assert.ok(argv.includes('AZURE_API_KEY') && argv.includes('OPENAI_API_KEY'));
    assert.equal(argv.some((a) => a.includes('sk-x') || a.includes('=az')), false, 'values never in argv');
    assert.equal(pv.env.PROJECT_ROOT, s.seen.session.work);
    assert.deepEqual(s.seen.session.envNames, ['AZURE_API_KEY']);
    // The answerer's docker calls get the compose env (PROJECT_ROOT) too.
    const env = {};
    s.seen.decide.run('docker', ['x'], { env: { A: '1' } });
    Object.assign(env, s.exec.at(-1).env);
    assert.equal(env.PROJECT_ROOT, s.seen.session.work);
    assert.equal(env.A, '1');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('runE2e: without an E2E section in AGENTS.md the verifier is skipped with a hint, the review still runs', async () => {
  const root = project();
  try {
    const s = stubs(root);
    const sandbox = s.deps.createSandbox;
    s.deps.createSandbox = (a) => { const r = sandbox(a); writeFileSync(path.join(r.work, 'AGENTS.md'), '# Agents\n'); return r; };
    assert.equal(await runE2e(opts(root), s.deps), 0);
    assert.match(s.seen.postVerify.skipVerifier, /End-to-end testing/);
    assert.deepEqual(s.seen.postVerify.criteria.map((c) => c.id), ['AC1']);
    assert.match(s.out.join('\n'), /hint: add an "## End-to-end testing" section/);
    const t = runJson(root).trials[0];
    assert.equal(t.acceptance, null);
    assert.match(t.verifierError, /End-to-end testing/);
    assert.deepEqual(t.review, { scope: 5 });
    assert.equal(t.checks.e2e_performed, null, 'no port without the section or e2e.appPort');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('runE2e: skipped acceptance criteria skip the verifier; the review runs with no criteria', async () => {
  const root = project();
  try {
    const s = stubs(root, { confirmAcceptance: async () => null });
    assert.equal(await runE2e(opts(root), s.deps), 0);
    assert.deepEqual(s.seen.postVerify.criteria, []);
    assert.match(s.seen.postVerify.skipVerifier, /no acceptance criteria/);
    const t = runJson(root).trials[0];
    assert.equal(t.acceptance, null);
    assert.deepEqual(t.review, { scope: 5 });
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('runE2e: Ctrl-C at the acceptance prompt (readline AbortError) aborts with 130 and leaves no draft', async () => {
  const root = project();
  try {
    const s = stubs(root, { confirmAcceptance, prompt: async () => { throw Object.assign(new Error('Aborted with Ctrl+C'), { code: 'ABORT_ERR', name: 'AbortError' }); } });
    assert.equal(await runE2e(opts(root), s.deps), 130);
    assert.equal(existsSync(path.join(root, '.adw/e2e/7/acceptance.md')), false);
    assert.equal(s.calls.includes('postVerify'), false);
    assert.ok(downs(s.exec).some((p) => p.endsWith('-judge')));
    assert.doesNotMatch(s.out.join('\n'), /acceptance draft failed/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('runE2e: no PR head gives the empty outcome; a human answer marks the run not comparable', async () => {
  const root = project();
  try {
    const s = stubs(root, {
      collectSandbox: () => ({ ticketFile: '', branches: [], bundle: null, diff: '' }),
      runConversation: async () => ({ turns: 3, humanAsked: 2, done: true, stuck: false, error: null }),
    });
    const code = await runE2e(opts(root), s.deps);
    assert.equal(code, 0, s.out.join("\n"));
    assert.equal(s.calls.includes('draft'), false);
    assert.equal(s.calls.includes('postVerify'), false);
    const run = runJson(root);
    assert.equal(run.trials[0].acceptance, 0);
    assert.equal(run.comparable, false);
    assert.match(s.out.join('\n'), /not comparable: 2 new answers/);
    assert.match(s.out.join('\n'), /baseline\s+no baseline/);
    assert.doesNotMatch(s.out.join('\n'), /new baseline/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('runE2e: own tests run in the work tree through compose when testCommand is set', async () => {
  const root = project({ testCommand: 'npm test' });
  try {
    const s = stubs(root);
    const exec = s.deps.exec;
    s.deps.exec = (cmd, args, o) => (args.includes('bash') ? (s.exec.push({ argv: [cmd, ...args], env: o?.env }), { status: 1, stdout: 'fail', stderr: '' }) : exec(cmd, args, o));
    assert.equal(await runE2e(opts(root), s.deps), 0);
    const call = s.exec.find((c) => c.argv.includes('bash'));
    assert.deepEqual(call.argv.slice(-7), ['run', '--rm', '-T', 'ai-dev-workflow', 'bash', '-lc', 'npm test']);
    assert.match(call.argv[call.argv.indexOf('-p') + 1], /-judge$/);
    assert.equal(call.env.PROJECT_ROOT, s.seen.session.work);
    assert.equal(s.seen.record.ownTests, 0);
    assert.equal(runJson(root).trials[0].reward, 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('timestamp has second resolution and sorts lexicographically', () => {
  assert.equal(timestamp(new Date('2026-10-19T10:00:05.123Z')), '2026-10-19T100005Z');
  assert.ok(timestamp(new Date('2026-10-19T10:00:05Z')) < timestamp(new Date('2026-10-19T10:00:06Z')));
});

test('runE2e: only e2e.secretEnv values are scrubbed like logins; other e2e.env values stay as they are', async () => {
  const root = project({ env: ['AZURE_API_KEY', 'AZURE_RESOURCE_NAME'], secretEnv: ['AZURE_API_KEY'] });
  try {
    const s = stubs(root);
    s.deps.env = { ...s.deps.env, AZURE_API_KEY: 'az-secret-value', AZURE_RESOURCE_NAME: 'acme', EMPTY: '' };
    assert.equal(await runE2e(opts(root), s.deps), 0);
    assert.ok(s.seen.session.creds.secrets.includes('az-secret-value'));
    assert.ok(!s.seen.session.creds.secrets.includes('acme'));
    s.seen.decide.onStdout('{"leak":"az-secret-value","name":"acme"}\n');
    const file = path.join(root, '.adw/e2e/7/runs/2026-10-19T1000Z/claude-code/claude-code-1/answerer.jsonl');
    const text = readFileSync(file, 'utf8');
    assert.doesNotMatch(text, /az-secret-value/);
    assert.match(text, /acme/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('runE2e: an error in a later repetition keeps the finished trials in an aborted run', async () => {
  const root = project();
  try {
    let n = 0;
    const s = stubs(root, { runConversation: async () => {
      if (++n === 2) throw new Error('docker exploded');
      return { turns: 2, humanAsked: 0, done: true, stuck: false, error: null };
    } });
    assert.equal(await runE2e(opts(root, { repetitions: 3 }), s.deps), 1);
    const run = runJson(root);
    assert.equal(run.trials.length, 1);
    assert.equal(run.aborted, 'error');
    assert.equal(run.comparable, false);
    assert.match(run.error, /claude-code-2: docker exploded/);
    assert.equal(n, 2, 'no further repetitions');
    assert.ok(downs(s.exec).filter((p) => p.endsWith('-judge')).length >= 2);
    assert.match(s.out.join('\n'), /claude-code-2: docker exploded/);
    assert.match(s.out.join('\n'), /not comparable: aborted \(error\)/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('runE2e: a throwing conversation still closes the session and tears the judge project down', async () => {
  const root = project();
  try {
    const s = stubs(root, { runConversation: async () => { throw new Error('no answer: input closed'); } });
    assert.equal(await runE2e(opts(root), s.deps), 1);
    assert.ok(s.calls.includes('close'));
    assert.ok(downs(s.exec).some((p) => p.endsWith('-judge')));
    assert.match(s.out.join('\n'), /input closed/);
    assert.ok(s.seen.signalOff);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('runE2e: an InterruptError exits 130 after teardown, nothing recorded', async () => {
  const root = project();
  try {
    const s = stubs(root, { runConversation: async () => { throw new InterruptError('SIGINT'); } });
    assert.equal(await runE2e(opts(root), s.deps), 130);
    assert.ok(s.calls.includes('close'));
    assert.ok(downs(s.exec).some((p) => p.endsWith('-judge')));
    assert.equal(existsSync(path.join(root, '.adw/e2e/7/runs/2026-10-19T1000Z/claude-code/run.json')), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('runE2e: SIGINT during the conversation tears down every started compose project and exits 130', async () => {
  const root = project();
  try {
    const s = stubs(root);
    s.deps.runConversation = async () => {
      s.seen.signal();
      return { turns: 1, humanAsked: 0, done: false, stuck: false, error: null };
    };
    await runE2e(opts(root), s.deps);
    assert.equal(s.seen.exit, 130);
    const projects = downs(s.exec);
    assert.ok(projects.some((p) => p.endsWith('-judge')));
    assert.ok(projects.some((p) => !p.endsWith('-judge')), projects.join(','));
    assert.ok(s.exec.some((c) => c.argv[1] === 'rm' && c.argv.at(-1).endsWith('-agent')));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('the e2e layer is ensured once, before the first sandbox, and the session gets its override', async () => {
  const root = project();
  const { deps, calls, seen } = stubs(root);
  await runE2e(opts(root, { repetitions: 2 }), deps);
  assert.equal(calls.filter((c) => c === 'image').length, 1);
  assert.ok(calls.indexOf('image') < calls.indexOf('sandbox'));
  assert.equal(seen.session.overrideFile, '/run/o.yml');
  assert.match(seen.session.origin, /origin\.git$/);
  assert.deepEqual(seen.image.composeFiles, [path.join(root, 'compose.ai-dev.yml')]);
  assert.equal(seen.image.root, root);
});

test('a failed layer build stops before any trial', async () => {
  const root = project();
  const { deps, calls, out } = stubs(root, { ensureE2eImage: () => { throw new Error('docker build failed (exit 1): see the output above'); } });
  assert.equal(await runE2e(opts(root), deps), 1);
  assert.ok(!calls.includes('sandbox'));
  assert.ok(out.some((l) => l.includes('docker build failed')));
});

test('run.json records the base image and the e2e layer', async () => {
  const root = project();
  const { deps } = stubs(root);
  await runE2e(opts(root), deps);
  assert.deepEqual(runJson(root).fingerprint.image, { ref: 'img:1', id: 'sha256:1', e2e: 'adw-e2e:abc' });
});

test('judge-side compose calls (answerer, judges, own tests, teardown) use the e2e override too', async () => {
  const root = project({ testCommand: 'npm test' });
  try {
    const s = stubs(root);
    await runE2e(opts(root), s.deps);
    const judge = s.seen.decide.buildArgs({ name: 'n', checkout: '/c', argv: ['x'] });
    assert.deepEqual(judge.slice(judge.indexOf('-p') - 2, judge.indexOf('-p')), ['-f', '/run/o.yml']);
    const compose = s.exec.filter((c) => c.argv[1] === 'compose');
    assert.ok(compose.some((c) => c.argv.includes('bash')) && compose.some((c) => c.argv.includes('down')));
    for (const c of compose) assert.equal(c.argv[c.argv.indexOf('-p') - 1], '/run/o.yml', c.argv.join(' '));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
