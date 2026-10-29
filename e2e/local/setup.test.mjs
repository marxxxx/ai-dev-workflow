import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createScriptedPrompter } from '../../agent-src/lib/onboard.mjs';
import { detectTestCommand, e2eChanges, makePrompter, ownComposeRun, projectVolume, runSetup, renderE2eSection, stepContainerFiles, stepE2eSection, stepEnvValues, stepInterview, stepLogins, stepProjectConfig, stepTicket } from './setup.mjs';
import { composeProject } from './session.mjs';
import { readLocalState, readTicket, ticketDir, writeLocalState, writeTicket } from './store.mjs';
import { spawnSync } from 'node:child_process';

const tmp = () => mkdtempSync(path.join(tmpdir(), 'adw-setup-'));
const noop = { log() {}, error() {} };

test('stepProjectConfig: runs the init interview on yes, not without an answer', async () => {
  const root = tmp();
  const calls = [];
  const d = { ...noop, cmdInit: async (r, o) => { calls.push([r, o]); return 0; } };
  const prompter = createScriptedPrompter({ setup: { init: 'y' } });
  await stepProjectConfig({ root, opts: {}, d, prompter, state: {} });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], root);
  assert.equal(calls[0][1].prompter, prompter);
  await stepProjectConfig({ root, opts: {}, d, prompter: createScriptedPrompter({}), state: {} });
  assert.equal(calls.length, 1);
  rmSync(root, { recursive: true });
});

test('stepProjectConfig: nothing to do with an ai-project.json or without a prompter', async () => {
  const root = tmp();
  const d = { ...noop, cmdInit: async () => { throw new Error('no'); } };
  await stepProjectConfig({ root, opts: {}, d, prompter: null, state: {} });
  writeFileSync(path.join(root, 'ai-project.json'), '{}');
  await stepProjectConfig({ root, opts: {}, d, prompter: createScriptedPrompter({ setup: { init: 'y' } }), state: {} });
  rmSync(root, { recursive: true });
});

test('stepContainerFiles: writes the files on yes and git-ignores .env.ai-dev', async () => {
  const root = tmp();
  writeFileSync(path.join(root, 'ai-project.json'), JSON.stringify({ ticketing: { backend: 'file' } }));
  const prompter = createScriptedPrompter({ setup: { container: 'y' }, container: { enabled: 'y', stack: 'node' } });
  await stepContainerFiles({ root, opts: {}, d: noop, prompter, state: {} });
  assert.ok(existsSync(path.join(root, 'compose.ai-dev.yml')));
  assert.match(readFileSync(path.join(root, '.gitignore'), 'utf8'), /\.env\.ai-dev/);
  rmSync(root, { recursive: true });
});

test('stepContainerFiles: no question when compose.ai-dev.yml exists; no write without an answer', async () => {
  const root = tmp();
  const asked = [];
  const prompter = { ...createScriptedPrompter({}), ask: async (q) => { asked.push(q); return 'y'; } };
  writeFileSync(path.join(root, 'compose.ai-dev.yml'), 'services: {}\n');
  await stepContainerFiles({ root, opts: {}, d: noop, prompter, state: {} });
  assert.deepEqual(asked, []);
  rmSync(path.join(root, 'compose.ai-dev.yml'));
  await stepContainerFiles({ root, opts: {}, d: noop, prompter: createScriptedPrompter({}), state: {} });
  assert.equal(existsSync(path.join(root, 'compose.ai-dev.yml')), false);
  rmSync(root, { recursive: true });
});

test('makePrompter: null without interactivity, scripted for --answers, close is a no-op', () => {
  const tty = { stdin: true, stdout: true };
  const no = { stdin: false, stdout: false };
  assert.equal(makePrompter({ noInput: true, answers: null }, { isTTY: tty }), null);
  assert.equal(makePrompter({ noInput: true, answers: 'a.json' }, { isTTY: tty }), null);
  assert.equal(makePrompter({ noInput: false, answers: null }, { isTTY: no }), null);
  const root = tmp();
  const file = path.join(root, 'a.json');
  writeFileSync(file, JSON.stringify({ setup: { init: 'y' } }));
  const p = makePrompter({ noInput: false, answers: file }, { isTTY: no });
  assert.equal(p.scripted, true);
  p.close();
  rmSync(root, { recursive: true });
});

test('runSetup: without a prompter returns the empty state; closes a real prompter', async () => {
  const root = tmp();
  writeTicket(ticketDir(root, 7), { title: 'X', body: 'Y' });
  const empty = await runSetup({ root, opts: { ticket: 7 }, d: noop, prompter: null });
  assert.deepEqual({ ...empty, config: null, creds: null }, { envAdditions: {}, ticketText: null, config: null, creds: null, fallbackHome: null });
  let closed = 0;
  const prompter = { ...createScriptedPrompter({}), close: () => {}, closeReal: () => { closed++; } };
  await runSetup({ root, opts: { ticket: 7 }, d: noop, prompter });
  assert.equal(closed, 1);
  rmSync(root, { recursive: true });
});

const ghProject = (root, backend = 'github') => writeFileSync(path.join(root, 'ai-project.json'),
  JSON.stringify({ ticketing: { backend }, repository: { slug: 'o/r' } }));
const hostFails = ({ exec }) => { if (!exec) throw new Error('ticket import (github) failed: gh issue view'); return JSON.parse(exec('gh', ['issue', 'view', '7'])); };
const ticketOpts = { ticket: 7, ticketFile: null };

test('ownComposeRun: own compose project argv, certs overlay and entrypoint', () => {
  const root = tmp();
  const calls = [];
  const exec = (cmd, args, o) => { calls.push([cmd, args, o]); return { status: 0, stdout: 'x' }; };
  ownComposeRun({ root, env: {}, exec, argv: ['gh', 'a'] });
  assert.deepEqual(calls[0][1], ['compose', '-f', path.join(root, 'compose.ai-dev.yml'), 'run', '--rm', '--no-deps', '-T', 'ai-dev-workflow', 'gh', 'a']);
  ownComposeRun({ root, env: { AGENT_CA_DIR: '/c' }, exec, argv: ['sh'], entrypoint: 'sh' });
  assert.deepEqual(calls[1][1].slice(0, 6), ['compose', '-f', path.join(root, 'compose.ai-dev.yml'), '-f', path.join(root, 'compose.ai-dev.certs.yml'), 'run']);
  assert.ok(calls[1][1].join(' ').includes('--entrypoint sh ai-dev-workflow sh'));
  rmSync(root, { recursive: true });
});

test('stepTicket: host import fails, the dev container import succeeds', async () => {
  const root = tmp();
  ghProject(root);
  const calls = [];
  const d = { ...noop, importTicket: hostFails, env: {}, uid: 1, gid: 1,
    exec: (cmd, args) => { calls.push([cmd, args]); return { status: 0, stdout: '{"title":"T","body":"B"}' }; } };
  const state = { envAdditions: {}, ticketText: null };
  const events = [];
  const prompter = { ...createScriptedPrompter({}), suspend: () => events.push('suspend'), resume: () => events.push('resume') };
  await stepTicket({ root, opts: ticketOpts, d, prompter, state });
  assert.deepEqual(events, ['suspend', 'resume']);
  assert.equal(readFileSync(path.join(ticketDir(root, 7), 'ticket.md'), 'utf8'), '# T\n\nB\n');
  assert.deepEqual(state.ticketText, { title: 'T', body: 'B' });
  assert.deepEqual(calls[0][1].slice(0, 9), ['compose', '-f', path.join(root, 'compose.ai-dev.yml'), 'run', '--rm', '--no-deps', '-T', 'ai-dev-workflow', 'gh']);
  assert.equal(calls[0][1].includes('-p'), false);
  rmSync(root, { recursive: true });
});

test('stepTicket: both imports fail, the editor fallback writes the ticket', async () => {
  const root = tmp();
  ghProject(root);
  const d = { ...noop, importTicket: hostFails, env: {}, uid: 1, gid: 1, exec: () => ({ status: 1, stdout: '', stderr: 'no' }),
    editor: (file) => writeFileSync(file, '# Real\n\nbody') };
  const state = { envAdditions: {}, ticketText: null };
  await stepTicket({ root, opts: ticketOpts, d, prompter: createScriptedPrompter({ setup: { ticketEditor: 'y' } }), state });
  assert.deepEqual(state.ticketText, { title: 'Real', body: 'body' });
  rmSync(root, { recursive: true });
});

test('stepTicket: both fail without a prompter or on decline, ticket.md is removed and the host error thrown', async () => {
  const root = tmp();
  ghProject(root);
  const d = { ...noop, importTicket: hostFails, env: {}, uid: 1, gid: 1, exec: () => ({ status: 1, stdout: '', stderr: 'no' }), editor: () => {} };
  const state = { envAdditions: {}, ticketText: null };
  await assert.rejects(stepTicket({ root, opts: ticketOpts, d, prompter: null, state }), /ticket import \(github\) failed/);
  assert.equal(existsSync(path.join(ticketDir(root, 7), 'ticket.md')), false);
  await assert.rejects(stepTicket({ root, opts: ticketOpts, d, prompter: createScriptedPrompter({}), state }), /ticket import \(github\) failed/);
  assert.equal(existsSync(path.join(ticketDir(root, 7), 'ticket.md')), false);
  rmSync(root, { recursive: true });
});

test('stepTicket: without a prompter the dev container is not tried', async () => {
  const root = tmp();
  ghProject(root);
  const d = { ...noop, importTicket: hostFails, env: {}, exec: () => { throw new Error('container tried'); } };
  await assert.rejects(stepTicket({ root, opts: ticketOpts, d, prompter: null, state: {} }), /ticket import \(github\) failed/);
  rmSync(root, { recursive: true });
});

test('stepTicket: Ctrl-C in the dev container import is an interrupt', async () => {
  const root = tmp();
  ghProject(root);
  const d = { ...noop, importTicket: hostFails, env: {}, exec: () => ({ status: 130, stdout: '', stderr: '' }) };
  await assert.rejects(stepTicket({ root, opts: ticketOpts, d, prompter: createScriptedPrompter({}), state: {} }), (e) => e.interrupted === true);
  rmSync(root, { recursive: true });
});

// Both imports fail; `editor` stands in for $EDITOR on ticket.md.
const editorRun = (root, editor) => {
  ghProject(root);
  const d = { ...noop, importTicket: hostFails, env: {}, exec: () => ({ status: 1, stdout: '', stderr: 'no' }), editor };
  const state = { envAdditions: {}, ticketText: null };
  return { state, run: () => stepTicket({ root, opts: ticketOpts, d, prompter: createScriptedPrompter({ setup: { ticketEditor: 'y' } }), state }) };
};

test('stepTicket: the editor text is read leniently and rewritten as a ticket', async () => {
  const root = tmp();
  const { state, run } = editorRun(root, (file) => writeFileSync(file, 'note\n# Title  \nbody line\n\n'));
  await run();
  assert.deepEqual(state.ticketText, { title: 'Title', body: 'body line' });
  assert.equal(readFileSync(path.join(ticketDir(root, 7), 'ticket.md'), 'utf8'), '# Title\n\nbody line\n');
  rmSync(root, { recursive: true });
});

test('stepTicket: a kept placeholder, an empty title or a failing editor abort once with the host error', async () => {
  for (const editor of [() => {}, (file) => writeFileSync(file, '# \nbody'), () => { throw new Error('editor exited with 1'); }]) {
    const root = tmp();
    let calls = 0;
    const { run } = editorRun(root, (file) => { calls++; return editor(file); });
    await assert.rejects(run(), /ticket import \(github\) failed/);
    assert.equal(calls, 1);
    assert.equal(existsSync(path.join(ticketDir(root, 7), 'ticket.md')), false);
    rmSync(root, { recursive: true });
  }
});

test('stepTicket: the file backend never tries the container; an existing ticket is left alone', async () => {
  const root = tmp();
  ghProject(root, 'file');
  const d = { ...noop, importTicket: () => { throw new Error('ticket import (file) failed: none'); }, env: {}, uid: 1, gid: 1,
    exec: () => { throw new Error('container tried'); } };
  await assert.rejects(stepTicket({ root, opts: ticketOpts, d, prompter: null, state: {} }), /ticket import \(file\) failed/);
  const dir = ticketDir(root, 7);
  writeTicket(dir, { title: 'X', body: 'Y' });
  const state = { ticketText: null };
  await stepTicket({ root, opts: ticketOpts, d, prompter: null, state });
  assert.equal(state.ticketText, null);
  assert.equal(readTicket(dir).title, 'X');
  rmSync(root, { recursive: true });
});

test('detectTestCommand: npm, dotnet, make, else null', () => {
  const root = tmp();
  assert.equal(detectTestCommand(root), null);
  writeFileSync(path.join(root, 'package.json'), '{"scripts":{"build":"x"}}');
  assert.equal(detectTestCommand(root), null);
  writeFileSync(path.join(root, 'Makefile'), 'build:\n\tx\ntest:\n\ty\n');
  assert.equal(detectTestCommand(root), 'make test');
  writeFileSync(path.join(root, 'App.csproj'), '<Project/>');
  assert.equal(detectTestCommand(root), 'dotnet test');
  writeFileSync(path.join(root, 'package.json'), '{"scripts":{"test":"x"}}');
  assert.equal(detectTestCommand(root), 'npm test');
  rmSync(root, { recursive: true });
});

test('e2eChanges: keeps current keys, sets answers, drops default-valued ones', () => {
  const out = e2eChanges({ maxTurns: 10, agent: { model: 'old' } },
    { agent: { harness: 'codex', model: '' }, testCommand: 'npm test', language: 'en', verifier: { model: '' }, env: [] });
  assert.deepEqual(out, { maxTurns: 10, agent: { harness: 'codex' }, testCommand: 'npm test', language: 'en' });
});

const interviewProject = (root, extra = {}) => {
  const project = { project: { name: 'p' }, ticketing: { backend: 'file' }, ...extra };
  writeFileSync(path.join(root, 'ai-project.json'), JSON.stringify(project, null, 2) + '\n');
  return project;
};
const interviewD = { ...noop, home: '/nonexistent-home', env: {}, log() {} };
const run = (root, opts, answers, state = { envAdditions: {}, ticketText: { title: 'The ticket', body: 'it is for the team' } }) =>
  stepInterview({ root, opts, d: interviewD, prompter: createScriptedPrompter(answers), state });
const readProject = (root) => JSON.parse(readFileSync(path.join(root, 'ai-project.json'), 'utf8'));

test('stepInterview: confirmed answers are written as the e2e block, nothing else changes', async () => {
  const root = tmp();
  const project = interviewProject(root);
  await run(root, {}, { e2e: { agent: { harness: 'codex' }, testCommand: 'npm test', language: 'en' }, setup: { writeE2e: 'y' } });
  assert.deepEqual(readProject(root), { ...project, e2e: { agent: { harness: 'codex' }, testCommand: 'npm test', language: 'en' } });
  assert.match(readFileSync(path.join(root, 'ai-project.json'), 'utf8'), /\n$/);
  rmSync(root, { recursive: true });
});

test('stepInterview: no confirmation, no write', async () => {
  const root = tmp();
  const project = interviewProject(root);
  await run(root, {}, { e2e: { agent: { harness: 'codex' }, testCommand: 'npm test', language: 'en' } });
  assert.deepEqual(readProject(root), project);
  rmSync(root, { recursive: true });
});

test('stepInterview: an existing e2e key skips the questions unless --reconfigure', async () => {
  const root = tmp();
  const project = interviewProject(root, { e2e: { maxTurns: 10 } });
  const prompter = { ...createScriptedPrompter({}), ask: async () => { throw new Error('asked'); }, askChoice: async () => { throw new Error('asked'); } };
  await stepInterview({ root, opts: {}, d: interviewD, prompter, state: { envAdditions: {}, ticketText: null } });
  assert.deepEqual(readProject(root), project);
  await run(root, { reconfigure: true }, { setup: { writeE2e: 'y' }, e2e: { agent: { harness: 'codex' } } });
  assert.deepEqual(readProject(root).e2e, { maxTurns: 10, agent: { harness: 'codex' }, language: 'en' });
  rmSync(root, { recursive: true });
});

test('stepInterview: --reconfigure defaults the harness to the current one', async () => {
  const root = tmp();
  interviewProject(root, { e2e: { agent: { harness: 'opencode' }, maxTurns: 10 } });
  await run(root, { reconfigure: true }, { setup: { writeE2e: 'y' } });
  assert.equal(readProject(root).e2e.agent.harness, 'opencode');
  assert.equal(readProject(root).e2e.maxTurns, 10);
  rmSync(root, { recursive: true });
});

test('stepInterview: the judge model goes to verifier and review; the harness default is opts.harness', async () => {
  const root = tmp();
  interviewProject(root);
  await run(root, { harness: 'codex' }, { e2e: { judgeModel: 'm' }, setup: { writeE2e: 'y' } });
  const e2e = readProject(root).e2e;
  assert.equal(e2e.verifier.model, 'm');
  assert.equal(e2e.review.model, 'm');
  assert.equal(e2e.agent.harness, 'codex');
  rmSync(root, { recursive: true });
});

test('stepInterview: env and secretEnv are asked for opencode; secretEnv defaults to all names', async () => {
  const root = tmp();
  interviewProject(root);
  await run(root, {}, { e2e: { agent: { harness: 'opencode' }, env: 'A_KEY, B_URL' }, setup: { writeE2e: 'y' } });
  assert.deepEqual(readProject(root).e2e.env, ['A_KEY', 'B_URL']);
  assert.deepEqual(readProject(root).e2e.secretEnv, ['A_KEY', 'B_URL']);
  rmSync(root, { recursive: true });
});

test('stepInterview: language is detected from the ticket; the only harness with a login is the default', async () => {
  const root = tmp();
  interviewProject(root);
  const state = { envAdditions: { OPENAI_API_KEY: 'k' }, ticketText: { title: 'Das ist der Titel', body: 'und nicht mit dem Rest für die Welt' } };
  await run(root, {}, { setup: { writeE2e: 'y' } }, state);
  assert.deepEqual(readProject(root).e2e, { agent: { harness: 'codex' }, language: 'de' });
  rmSync(root, { recursive: true });
});

test('stepInterview: without a prompter nothing happens', async () => {
  const root = tmp();
  const project = interviewProject(root);
  await stepInterview({ root, opts: {}, d: interviewD, prompter: null, state: { envAdditions: {}, ticketText: null } });
  assert.deepEqual(readProject(root), project);
  rmSync(root, { recursive: true });
});

// stepLogins: a project whose only harness is `harness`; `exec` records every docker call.
function loginsFixture(harness, { setupExit = 0, catStatus = 0, volume = true, cat = '{"tokens":{"refresh_token":"r"}}', envFile = null } = {}) {
  const root = tmp();
  const home = tmp();
  writeFileSync(path.join(root, 'compose.ai-dev.yml'), 'services: {}\n');
  writeFileSync(path.join(root, 'ai-project.json'), JSON.stringify({ ticketing: { backend: 'file' }, e2e: { agent: { harness }, answerer: { harness }, verifier: { harness }, review: { harness } } }));
  if (envFile) writeFileSync(path.join(root, '.env.ai-dev'), envFile);
  const calls = [];
  const out = [];
  const exec = (cmd, args, o = {}) => {
    calls.push([cmd, args, o]);
    if (args.includes('setup-token')) return { status: setupExit };
    if (args.includes('config')) return { status: 0, stdout: '{"name":"proj","services":{"ai-dev-workflow":{"image":"dev:1"}}}' };
    if (args[0] === 'volume') return { status: volume ? 0 : 1, stdout: '' };
    if (args.includes('cat')) return { status: catStatus, stdout: cat };
    return { status: 0, stdout: '' };
  };
  const d = { log: (s) => out.push(String(s)), error() {}, env: {}, home, exec };
  return { root, home, calls, out, d, state: { envAdditions: {}, ticketText: null },
    run: (answers, state) => stepLogins({ root, opts: {}, d, prompter: createScriptedPrompter(answers), state: state ?? undefined }),
    clean: () => { rmSync(root, { recursive: true, force: true }); rmSync(home, { recursive: true, force: true }); } };
}
const runLogins = async (f, answers, prompter = createScriptedPrompter(answers)) => {
  await stepLogins({ root: f.root, opts: {}, d: f.d, prompter, state: f.state });
  return f.state;
};

test('projectVolume: the compose project name plus _agent-home when the volume exists, else null', () => {
  const f = loginsFixture('codex');
  assert.equal(projectVolume(f.root, {}, f.d.exec), 'proj_agent-home');
  assert.deepEqual(f.calls[1][1], ['volume', 'inspect', 'proj_agent-home']);
  const g = loginsFixture('codex', { volume: false });
  assert.equal(projectVolume(g.root, {}, g.d.exec), null);
  f.clean(); g.clean();
});

test('projectVolume: the agent-home volume name from the compose config wins', () => {
  const calls = [];
  const exec = (cmd, args) => {
    calls.push(args);
    if (args.includes('config')) return { status: 0, stdout: '{"name":"proj","volumes":{"agent-home":{"name":"custom_home"}}}' };
    return { status: 0, stdout: '' };
  };
  assert.equal(projectVolume(tmp(), {}, exec), 'custom_home');
  assert.deepEqual(calls[1], ['volume', 'inspect', 'custom_home']);
});

test('stepLogins: no volume means no compose run and no question', async () => {
  const f = loginsFixture('codex', { volume: false });
  const asked = [];
  const prompter = { ...createScriptedPrompter({}), ask: async (q) => { asked.push(q); return 'y'; } };
  const state = await runLogins(f, {}, prompter);
  assert.equal(f.calls.some(([, a]) => a.includes('run')), false);
  assert.deepEqual(asked, []);
  assert.equal(state.creds.missing.length, 1);
  assert.equal(state.fallbackHome, null);
  f.clean();
});

test('stepLogins: the codex login of the volume lands under fallbackHome with mode 600', async () => {
  const f = loginsFixture('codex');
  const state = await runLogins(f, { setup: { volumeLogin: { codex: 'y' } } });
  const file = path.join(state.fallbackHome, '.codex/auth.json');
  assert.equal(readFileSync(file, 'utf8'), '{"tokens":{"refresh_token":"r"}}');
  assert.equal(statSync(file).mode & 0o777, 0o600);
  assert.deepEqual(state.creds.missing, []);
  assert.equal(state.creds.authFiles[0].from, file);
  const read = f.calls.find(([, a]) => a.includes('cat'));
  assert.deepEqual(read[1].slice(-3), ['cat', 'ai-dev-workflow', '/home/dev/.codex/auth.json']);
  assert.ok(!read[1].includes('-p'));
  rmSync(state.fallbackHome, { recursive: true, force: true });
  f.clean();
});

test('stepLogins: a declined volume login (or none scripted) reads nothing', async () => {
  const f = loginsFixture('codex');
  const state = await runLogins(f, {});
  assert.equal(f.calls.some(([, a]) => a.includes('cat')), false);
  assert.equal(state.fallbackHome, null);
  f.clean();
});

// An interactive (not scripted) prompter answering every question with `answer`; `asked` lists the keys.
const ttyPrompter = (answer, asked = []) => ({ ...createScriptedPrompter({}), scripted: false,
  ask: async (_q, key) => { asked.push(key); return answer; } });

test('stepLogins: an interactive answer to the volume question is stored in local.json', async () => {
  for (const [answer, stored] of [['y', true], ['n', false]]) {
    const f = loginsFixture('codex');
    const state = await runLogins(f, {}, ttyPrompter(answer));
    assert.deepEqual(readLocalState(f.root), { loginFromVolume: { codex: stored } });
    assert.match(readFileSync(path.join(f.root, '.adw/e2e/.gitignore'), 'utf8'), /^local\.json$/m);
    if (state.fallbackHome) rmSync(state.fallbackHome, { recursive: true, force: true });
    f.clean();
  }
});

test('stepLogins: a stored yes reads the volume without a question, also without a prompter', async () => {
  for (const prompter of [null, ttyPrompter('n')]) {
    const f = loginsFixture('codex');
    writeLocalState(f.root, { loginFromVolume: { codex: true } });
    const asked = [];
    if (prompter) prompter.ask = async (_q, key) => { asked.push(key); return 'n'; };
    const state = await runLogins(f, {}, prompter);
    assert.deepEqual(asked, []);
    assert.deepEqual(state.creds.missing, []);
    assert.ok(state.fallbackHome);
    rmSync(state.fallbackHome, { recursive: true, force: true });
    f.clean();
  }
});

test('stepLogins: a stored no never asks and reads nothing', async () => {
  const f = loginsFixture('opencode');
  writeLocalState(f.root, { loginFromVolume: { opencode: false } });
  const asked = [];
  const state = await runLogins(f, {}, ttyPrompter('y', asked));
  assert.deepEqual(asked, []);
  assert.deepEqual(f.calls, []);
  assert.equal(state.fallbackHome, null);
  f.clean();
});

test('stepLogins: a scripted answer is not stored', async () => {
  const f = loginsFixture('codex');
  await runLogins(f, {});
  assert.deepEqual(readLocalState(f.root), {});
  f.clean();
});

test('stepLogins: the terminal is handed over around the docker calls of the volume lookup', async () => {
  const f = loginsFixture('codex', { volume: false });
  const events = [];
  const prompter = { ...createScriptedPrompter({}), suspend: () => events.push('suspend'), resume: () => events.push('resume') };
  await runLogins(f, {}, prompter);
  assert.deepEqual(events, ['suspend', 'resume']);
  f.clean();
});

test('stepLogins: Ctrl-C in claude setup-token (exit 130) is an interrupt', async () => {
  const f = loginsFixture('claude-code', { setupExit: 130 });
  await assert.rejects(runLogins(f, { setup: { claudeToken: 'y' } }), (e) => e.interrupted === true && e.signal === 'SIGINT');
  f.clean();
});

test('stepLogins: a pasted Claude token is saved, trimmed, and never reaches argv or the log', async () => {
  const f = loginsFixture('claude-code');
  const state = await runLogins(f, { setup: { claudeToken: 'y', claudeTokenValue: '  tok-123 \n', saveClaudeToken: 'y' } });
  assert.match(readFileSync(path.join(f.root, '.env.ai-dev'), 'utf8'), /^CLAUDE_CODE_OAUTH_TOKEN=tok-123$/m);
  assert.equal(state.envAdditions.CLAUDE_CODE_OAUTH_TOKEN, 'tok-123');
  assert.deepEqual(state.creds.missing, []);
  assert.deepEqual(state.creds.secrets, ['tok-123']);
  const setup = f.calls.find(([, a]) => a.includes('setup-token'));
  assert.deepEqual(setup[1], ['run', '--rm', '-it', '--entrypoint', 'claude', 'dev:1', 'setup-token']);
  assert.equal(setup[2].stdio, 'inherit');
  assert.equal(f.calls.some(([, a]) => a.includes('compose') && a.includes('run')), false);
  assert.equal(JSON.stringify(f.calls.map(([, a]) => a)).includes('tok-123'), false);
  assert.equal(f.out.join('\n').includes('tok-123'), false);
  f.clean();
});

test('stepLogins: the terminal is handed over around setup-token; a failing run is declined without a paste question', async () => {
  const f = loginsFixture('claude-code', { setupExit: 1 });
  const events = [];
  const inner = createScriptedPrompter({ setup: { claudeToken: 'y', claudeTokenValue: 'tok-x', saveClaudeToken: 'y' } });
  const prompter = { ...inner, suspend: () => events.push('suspend'), resume: () => events.push('resume'),
    askSecret: async (...a) => { events.push('paste'); return inner.askSecret(...a); } };
  const errors = [];
  f.d.error = (s) => errors.push(s);
  const state = await runLogins(f, {}, prompter);
  // Once for `docker compose config`, once for setup-token.
  assert.deepEqual(events, ['suspend', 'resume', 'suspend', 'resume']);
  assert.deepEqual(errors, ['claude setup-token failed (exit 1)']);
  assert.deepEqual(state.envAdditions, {});
  f.clean();
});

test('stepLogins: opencode without a login file is offered the volume login', async () => {
  const f = loginsFixture('opencode', { cat: '{"anthropic":{"refresh":"r"}}' });
  const state = await runLogins(f, { setup: { volumeLogin: { opencode: 'y' } } });
  const file = path.join(state.fallbackHome, '.local/share/opencode/auth.json');
  assert.equal(statSync(file).mode & 0o777, 0o600);
  assert.equal(state.creds.authFiles[0].from, file);
  rmSync(state.fallbackHome, { recursive: true, force: true });
  f.clean();
});

test('stepLogins: opencode with a host login file asks nothing', async () => {
  const f = loginsFixture('opencode');
  mkdirSync(path.join(f.home, '.local/share/opencode'), { recursive: true });
  writeFileSync(path.join(f.home, '.local/share/opencode/auth.json'), '{"a":{"refresh":"h"}}');
  await runLogins(f, { setup: { volumeLogin: { opencode: 'y' } } });
  assert.deepEqual(f.calls, []);
  f.clean();
});

test('stepLogins: a failed volume read reports it and copies nothing', async () => {
  const f = loginsFixture('codex', { catStatus: 1 });
  const state = await runLogins(f, { setup: { volumeLogin: { codex: 'y' } } });
  assert.ok(f.out.some((l) => /reading \.codex\/auth\.json from the agent-home volume failed/.test(l)));
  assert.equal(state.fallbackHome, null);
  f.clean();
});

test('stepLogins: without the save answer the token is only in envAdditions', async () => {
  const f = loginsFixture('claude-code');
  const state = await runLogins(f, { setup: { claudeToken: 'y', claudeTokenValue: 'tok-9' } });
  assert.equal(existsSync(path.join(f.root, '.env.ai-dev')), false);
  assert.equal(state.envAdditions.CLAUDE_CODE_OAUTH_TOKEN, 'tok-9');
  f.clean();
});

test('stepLogins: an empty paste saves nothing and the login stays missing', async () => {
  const f = loginsFixture('claude-code');
  const state = await runLogins(f, { setup: { claudeToken: 'y', claudeTokenValue: '   ', saveClaudeToken: 'y' } });
  assert.equal(existsSync(path.join(f.root, '.env.ai-dev')), false);
  assert.deepEqual(state.envAdditions, {});
  assert.equal(state.creds.missing.length, 1);
  f.clean();
});

test('stepLogins: a CLAUDE_CODE_OAUTH_TOKEN already assigned in .env.ai-dev is kept', async () => {
  const f = loginsFixture('claude-code', { envFile: 'CLAUDE_CODE_OAUTH_TOKEN=\n' });
  await runLogins(f, { setup: { claudeToken: 'y', claudeTokenValue: 'new', saveClaudeToken: 'y' } });
  assert.equal(readFileSync(path.join(f.root, '.env.ai-dev'), 'utf8'), 'CLAUDE_CODE_OAUTH_TOKEN=\n');
  assert.ok(f.out.some((l) => /already sets CLAUDE_CODE_OAUTH_TOKEN/.test(l)));
  f.clean();
});

test('stepLogins: a declined Claude login points to Bedrock and Vertex', async () => {
  const f = loginsFixture('claude-code');
  await runLogins(f, {});
  assert.ok(f.out.some((l) => /^For Bedrock or Vertex, set CLAUDE_CODE_USE_BEDROCK or CLAUDE_CODE_USE_VERTEX and list that provider's variables in e2e\.env\.$/.test(l)));
  f.clean();
});

test('stepLogins: without a prompter nothing is asked and no docker call is made; a broken config is left to preflight', async () => {
  const f = loginsFixture('codex');
  const state = await runLogins(f, {}, null);
  assert.deepEqual(f.calls, []);
  assert.equal(state.creds.missing.length, 1);
  assert.ok(state.config);
  writeFileSync(path.join(f.root, 'ai-project.json'), '{ nope');
  const other = { envAdditions: {}, ticketText: null };
  await stepLogins({ root: f.root, opts: {}, d: f.d, prompter: null, state: other });
  assert.equal(other.config, undefined);
  f.clean();
});

test('runSetup: returns fallbackHome, config and creds', async () => {
  const f = loginsFixture('codex');
  const r = await runSetup({ root: f.root, opts: { ticket: 1 }, d: { ...f.d, cmdInit: async () => 0, importTicket: () => ({ title: 't', body: 'b' }) }, prompter: null });
  assert.ok('fallbackHome' in r && r.config && r.creds);
  f.clean();
});

// stepEnvValues: a project with e2e.env AZ_KEY (secret) and AZ_NAME.
function envFixture(envFile = null) {
  const root = tmp();
  writeFileSync(path.join(root, 'ai-project.json'), JSON.stringify({ ticketing: { backend: 'file' } }));
  if (envFile !== null) writeFileSync(path.join(root, '.env.ai-dev'), envFile);
  const config = { env: ['AZ_KEY', 'AZ_NAME'], secretEnv: ['AZ_KEY'] };
  const spy = [];
  const inner = createScriptedPrompter({ setup: { env: { AZ_KEY: 'k1', AZ_NAME: 'n1' }, saveEnv: 'y' } });
  const prompter = { ...inner, ask: async (q, k, ...r) => { spy.push(['ask', k]); return inner.ask(q, k, ...r); },
    askSecret: async (q, k) => { spy.push(['askSecret', k]); return inner.askSecret(q, k); } };
  return { root, spy, prompter, state: { envAdditions: {}, config }, d: { env: {}, log() {} } };
}
const envFile = (root) => (existsSync(path.join(root, '.env.ai-dev')) ? readFileSync(path.join(root, '.env.ai-dev'), 'utf8') : null);

test('stepEnvValues: secrets via askSecret, others via ask, saved to .env.ai-dev on yes', async () => {
  const f = envFixture();
  await stepEnvValues({ root: f.root, opts: {}, d: f.d, prompter: f.prompter, state: f.state });
  assert.deepEqual(f.spy.filter(([, k]) => k.startsWith('setup.env.')), [['askSecret', 'setup.env.AZ_KEY'], ['ask', 'setup.env.AZ_NAME']]);
  assert.match(envFile(f.root), /AZ_KEY=k1/);
  assert.match(envFile(f.root), /AZ_NAME=n1/);
  assert.deepEqual(f.state.envAdditions, { AZ_KEY: 'k1', AZ_NAME: 'n1' });
});

test('stepEnvValues: without the save answer .env.ai-dev is unchanged but envAdditions holds the values', async () => {
  const f = envFixture('OTHER=1\n');
  const inner = createScriptedPrompter({ setup: { env: { AZ_KEY: 'k1', AZ_NAME: 'n1' } } });
  await stepEnvValues({ root: f.root, opts: {}, d: f.d, prompter: inner, state: f.state });
  assert.equal(envFile(f.root), 'OTHER=1\n');
  assert.deepEqual(f.state.envAdditions, { AZ_KEY: 'k1', AZ_NAME: 'n1' });
});

test('stepEnvValues: names already set (env file, process env) are not asked; no config or prompter is a no-op', async () => {
  const f = envFixture('AZ_KEY=x\n');
  f.d.env = { AZ_NAME: 'y' };
  await stepEnvValues({ root: f.root, opts: {}, d: f.d, prompter: f.prompter, state: f.state });
  assert.deepEqual(f.spy, []);
  const g = envFixture();
  await stepEnvValues({ root: g.root, opts: {}, d: g.d, prompter: null, state: g.state });
  await stepEnvValues({ root: g.root, opts: {}, d: g.d, prompter: g.prompter, state: { envAdditions: {} } });
  assert.deepEqual(g.spy, []);
  assert.equal(envFile(g.root), null);
});

test('renderE2eSection: the heading and four lines in order', () => {
  assert.equal(renderE2eSection({ start: 'npm start', ready: 'port 3000 listens', url: 'http://localhost:3000', stop: 'npm run stop' }),
    '## End-to-end testing\n\n- Start: npm start\n- Ready when: port 3000 listens\n- Base URL: http://localhost:3000\n- Stop: npm run stop');
});

const e2eFixture = (agentsMd = '# P\n') => {
  const root = tmp();
  writeFileSync(path.join(root, 'ai-project.json'), JSON.stringify({ ticketing: { backend: 'file' } }));
  if (agentsMd !== null) writeFileSync(path.join(root, 'AGENTS.md'), agentsMd);
  const out = []; const errors = []; const execs = [];
  const d = { log: (s) => out.push(String(s)), error: (s) => errors.push(String(s)), env: {}, exec: (c, a) => { execs.push(a); return { status: 0 }; }, callLlm: () => { throw new Error('no llm'); } };
  const state = { envAdditions: {}, ticketText: { title: 'T', body: 'b' },
    config: { language: 'en', answerer: { harness: 'claude-code', model: null, timeoutSec: 60 }, env: [] }, creds: { envNames: [], authFiles: [] } };
  return { root, out, errors, execs, d, state, draft: path.join(root, '.adw', 'e2e', 'agents-e2e-section.md'),
    run: (answers, over = {}) => stepE2eSection({ root, opts: {}, d: { ...d, ...over.d }, prompter: over.prompter === undefined ? createScriptedPrompter(answers) : over.prompter, state: over.state ?? state }) };
};

test('stepE2eSection: [a]sk writes the four lines, accepted, to AGENTS.md and deletes the draft', async () => {
  const f = e2eFixture();
  await f.run({ setup: { e2eSection: 'a', e2eSectionConfirm: 'a', e2e: { start: 'npm start', ready: 'up', url: 'http://localhost:3000', stop: 'npm stop' } } });
  assert.equal(readFileSync(path.join(f.root, 'AGENTS.md'), 'utf8'),
    `# P\n\n${renderE2eSection({ start: 'npm start', ready: 'up', url: 'http://localhost:3000', stop: 'npm stop' })}\n`);
  assert.equal(existsSync(f.draft), false);
  assert.match(f.out.join('\n'), /Commit AGENTS\.md so later base commits include it; \/init in your coding agent writes the rest of the file\./);
  rmSync(f.root, { recursive: true });
});

test('stepE2eSection: AGENTS.md is created when missing', async () => {
  const f = e2eFixture(null);
  await f.run({ setup: { e2eSection: 'a', e2eSectionConfirm: 'a', e2e: { start: 's', ready: 'r', url: 'u', stop: 'x' } } });
  assert.match(readFileSync(path.join(f.root, 'AGENTS.md'), 'utf8'), /^## End-to-end testing\n\n- Start: s\n/);
  rmSync(f.root, { recursive: true });
});

test('stepE2eSection: scripted default, a missing confirm, a present section, no prompter or no config change nothing', async () => {
  const f = e2eFixture();
  await f.run({});
  await f.run({ setup: { e2eSection: 'a', e2e: { start: 's', ready: 'r', url: 'u', stop: 'x' } } });
  assert.equal(readFileSync(path.join(f.root, 'AGENTS.md'), 'utf8'), '# P\n');
  assert.equal(existsSync(f.draft), false);
  await f.run({ setup: { e2eSection: 'a', e2eSectionConfirm: 'a' } }, { prompter: null });
  await f.run({ setup: { e2eSection: 'a', e2eSectionConfirm: 'a' } }, { state: { ...f.state, config: null } });
  writeFileSync(path.join(f.root, 'AGENTS.md'), '## End-to-end testing\n\nown\n');
  await f.run({ setup: { e2eSection: 'a', e2eSectionConfirm: 'a', e2e: { start: 's', ready: 'r', url: 'u', stop: 'x' } } });
  assert.equal(readFileSync(path.join(f.root, 'AGENTS.md'), 'utf8'), '## End-to-end testing\n\nown\n');
  rmSync(f.root, { recursive: true });
});

// A git repo with AGENTS.md committed and a git-ignored .env.ai-dev beside it; git runs for real, docker is recorded.
const gitE2eFixture = () => {
  const f = e2eFixture();
  const git = (...a) => spawnSync('git', ['-C', f.root, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { encoding: 'utf8' });
  writeFileSync(path.join(f.root, '.gitignore'), '.env.ai-dev\n');
  writeFileSync(path.join(f.root, '.env.ai-dev'), 'SECRET=s\n');
  git('init', '-q'); git('add', '.'); git('commit', '-qm', 'init');
  f.d.exec = (c, a, o) => { f.execs.push(a); return c === 'git' ? spawnSync(c, a, { encoding: 'utf8', ...o }) : { status: 0 }; };
  return f;
};

test('stepE2eSection: [d]raft calls the LLM read-only in the setup compose project and appends its section', async () => {
  const f = gitE2eFixture();
  let seen; let clone;
  const events = [];
  const section = renderE2eSection({ start: 'make run', ready: 'ok', url: 'http://localhost:1', stop: 'make stop' });
  const prompter = { ...createScriptedPrompter({ setup: { e2eSection: 'd', e2eSectionConfirm: 'a' } }),
    suspend: () => events.push('suspend'), resume: () => events.push('resume') };
  await f.run({}, { prompter, d: { callLlm: (a) => {
    seen = a;
    events.push('llm');
    clone = { agents: existsSync(path.join(a.checkout, 'AGENTS.md')), env: existsSync(path.join(a.checkout, '.env.ai-dev')) };
    return { section };
  } } });
  assert.deepEqual(events, ['suspend', 'llm', 'resume']);
  assert.equal(seen.role, 'agents-e2e');
  assert.equal(seen.harness, 'claude-code');
  assert.equal(seen.tools, 'read');
  assert.equal(seen.readOnly, true);
  // The model sees a clone of the committed HEAD only: never the live root with its git-ignored secrets.
  assert.notEqual(seen.checkout, f.root);
  assert.deepEqual(clone, { agents: true, env: false });
  assert.equal(existsSync(seen.checkout), false);
  const cloneCall = f.execs.find((a) => a.includes('clone'));
  assert.deepEqual(cloneCall.slice(-6), ['clone', '-q', '--no-hardlinks', '--template=', f.root, seen.checkout]);
  assert.ok(cloneCall.includes('core.hooksPath=/dev/null'));
  assert.match(seen.input, /Four parts, in English:/);
  assert.match(seen.input, /\{"section":/);
  const argv = seen.buildArgs({ name: 'n', checkout: seen.checkout, readOnly: true, argv: ['x'] });
  assert.ok(argv.includes('-p'));
  assert.ok(argv.includes(composeProject(f.root, 'setup')));
  assert.match(readFileSync(path.join(f.root, 'AGENTS.md'), 'utf8'), /- Start: make run/);
  assert.deepEqual(f.execs.find((a) => a.includes('down')), ['compose', '-f', path.join(f.root, 'compose.ai-dev.yml'), '-p', composeProject(f.root, 'setup'), 'down', '-v']);
  rmSync(f.root, { recursive: true });
});

test('stepE2eSection: a failed draft is reported and writes nothing', async () => {
  const f = e2eFixture();
  await f.run({ setup: { e2eSection: 'd', e2eSectionConfirm: 'a' } }, { d: { callLlm: () => ({ section: 'no heading' }) } });
  assert.equal(readFileSync(path.join(f.root, 'AGENTS.md'), 'utf8'), '# P\n');
  assert.match(f.errors.join('\n'), /! AGENTS\.md draft failed/);
  assert.equal(existsSync(f.draft), false);
  rmSync(f.root, { recursive: true });
});

test('stepE2eSection: a scripted confirm answer other than a, e or s skips instead of looping', async () => {
  const f = e2eFixture();
  await f.run({ setup: { e2eSection: 'a', e2eSectionConfirm: 'y', e2e: { start: 's', ready: 'r', url: 'u', stop: 'x' } } });
  assert.equal(readFileSync(path.join(f.root, 'AGENTS.md'), 'utf8'), '# P\n');
  assert.equal(existsSync(f.draft), false);
  rmSync(f.root, { recursive: true });
});

test('stepE2eSection: an interactive [s]kip is stored and the section is not offered again', async () => {
  const f = e2eFixture();
  const asked = [];
  await f.run({}, { prompter: ttyPrompter('s', asked) });
  assert.deepEqual(readLocalState(f.root), { e2eSectionDeclined: true });
  await f.run({}, { prompter: ttyPrompter('a', asked) });
  assert.deepEqual(asked, ['setup.e2eSection']);
  assert.equal(readFileSync(path.join(f.root, 'AGENTS.md'), 'utf8'), '# P\n');
  rmSync(f.root, { recursive: true });
});

test('stepE2eSection: a failing editor at the confirmation is reported, not fatal', async () => {
  const f = e2eFixture();
  await f.run({ setup: { e2eSection: 'a', e2eSectionConfirm: 'e', e2e: { start: 's', ready: 'r', url: 'u', stop: 'x' } } },
    { d: { editor: () => { throw new Error('editor exited with 1'); } } });
  assert.match(f.errors.join('\n'), /editor exited with 1/);
  assert.equal(existsSync(f.draft), false);
  rmSync(f.root, { recursive: true });
});
