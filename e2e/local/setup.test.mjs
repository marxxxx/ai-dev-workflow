import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createScriptedPrompter } from '../../agent-src/lib/onboard.mjs';
import { detectTestCommand, e2eChanges, makePrompter, ownComposeRun, projectVolume, runSetup, stepContainerFiles, stepInterview, stepLogins, stepProjectConfig, stepTicket } from './setup.mjs';
import { readTicket, ticketDir, writeTicket } from './store.mjs';

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
  await stepTicket({ root, opts: ticketOpts, d, prompter: null, state });
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
function loginsFixture(harness, { volume = true, cat = '{"tokens":{"refresh_token":"r"}}', envFile = null } = {}) {
  const root = tmp();
  const home = tmp();
  writeFileSync(path.join(root, 'compose.ai-dev.yml'), 'services: {}\n');
  writeFileSync(path.join(root, 'ai-project.json'), JSON.stringify({ ticketing: { backend: 'file' }, e2e: { agent: { harness }, answerer: { harness }, verifier: { harness }, review: { harness } } }));
  if (envFile) writeFileSync(path.join(root, '.env.ai-dev'), envFile);
  const calls = [];
  const out = [];
  const exec = (cmd, args, o = {}) => {
    calls.push([cmd, args, o]);
    if (args.includes('config')) return { status: 0, stdout: '{"name":"proj"}' };
    if (args[0] === 'volume') return { status: volume ? 0 : 1, stdout: '' };
    if (args.includes('cat')) return { status: 0, stdout: cat };
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

test('stepLogins: a pasted Claude token is saved, trimmed, and never reaches argv or the log', async () => {
  const f = loginsFixture('claude-code');
  const state = await runLogins(f, { setup: { claudeToken: 'y', claudeTokenValue: '  tok-123 \n', saveClaudeToken: 'y' } });
  assert.match(readFileSync(path.join(f.root, '.env.ai-dev'), 'utf8'), /^CLAUDE_CODE_OAUTH_TOKEN=tok-123$/m);
  assert.equal(state.envAdditions.CLAUDE_CODE_OAUTH_TOKEN, 'tok-123');
  assert.deepEqual(state.creds.missing, []);
  assert.deepEqual(state.creds.secrets, ['tok-123']);
  const setup = f.calls.find(([, a]) => a.includes('setup-token'));
  assert.equal(setup[2].stdio, 'inherit');
  assert.equal(JSON.stringify(f.calls.map(([, a]) => a)).includes('tok-123'), false);
  assert.equal(f.out.join('\n').includes('tok-123'), false);
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
