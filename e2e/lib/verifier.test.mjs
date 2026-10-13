import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isInterrupt } from './claude.mjs';
import { buildVerifierDockerArgs, buildVerifierPrompt, runVerifier, validateVerifierAnswer } from './verifier.mjs';

const criteria = [{ id: 'AC1', text: 'A todo can get a due date.' }, { id: 'AC2', text: 'The list shows it.' }];
const config = { verifier: { model: 'claude-sonnet-5-5', timeoutSec: 900 } };
const answer = (list) => JSON.stringify({ type: 'result', result: JSON.stringify({ criteria: list }) });
const both = [{ id: 'AC1', pass: true, evidence: 'POST ok' }, { id: 'AC2', pass: false, evidence: 'no date shown' }];

test('prompt lists every criterion and points to the E2E section of AGENTS.md, never the spec or ticket', () => {
  const p = buildVerifierPrompt({ criteria, spec: 'SPEC-TEXT', ticket: 'TICKET-TEXT' });
  for (const s of ['- AC1: A todo can get a due date.', '- AC2: The list shows it.', 'AGENTS.md', '"End-to-end testing"', 'date -u +%F']) {
    assert.ok(p.includes(s), s);
  }
  assert.ok(!p.includes('SPEC-TEXT') && !p.includes('TICKET-TEXT'));
});

test('prompt makes the verifier write evidence before the verdict', () => {
  const p = buildVerifierPrompt({ criteria });
  const shape = p.split('\n').find((l) => l.startsWith('{"criteria"'));
  assert.ok(shape.indexOf('"evidence"') < shape.indexOf('"pass"'));
  assert.ok(p.includes('Write each criterion\'s evidence first, then set "pass" from that evidence alone; never revise a verdict inside the evidence text.'));
});

test('answer validation demands every criterion exactly once with a boolean verdict', () => {
  const ids = ['AC1', 'AC2'];
  assert.deepEqual(validateVerifierAnswer({ criteria: both }, ids),
    { AC1: { pass: true, evidence: 'POST ok' }, AC2: { pass: false, evidence: 'no date shown' } });
  assert.throws(() => validateVerifierAnswer({ criteria: [both[0]] }, ids), /missing: AC2/);
  assert.throws(() => validateVerifierAnswer({ criteria: [...both, both[0]] }, ids), /AC1 twice/);
  assert.throws(() => validateVerifierAnswer({ criteria: [...both, { id: 'AC9', pass: true }] }, ids), /unknown criterion AC9/);
  assert.throws(() => validateVerifierAnswer({ criteria: [{ ...both[0], pass: 'yes' }, both[1]] }, ids), /AC1 has no boolean pass/);
  assert.throws(() => validateVerifierAnswer({}, ids), /no criteria array/);
});

test('docker args pass auth by name only, skip the Gitea seed and mount the checkout at /workspace', () => {
  const args = buildVerifierDockerArgs({ image: 'adw-e2e-demo-todo', name: 'v1', checkout: '/tmp/co', model: 'm', uid: 1000, gid: 1000 });
  assert.deepEqual(args.slice(0, 5), ['run', '--rm', '-i', '--name', 'v1']);
  assert.equal(args[args.indexOf('CLAUDE_CODE_OAUTH_TOKEN') - 1], '-e');
  assert.ok(args.includes('E2E_VERIFY=1'));
  assert.ok(args.includes('AGENT_TOOLSTACK_ONLY=1'));
  assert.ok(args.includes('/tmp/co:/workspace'));
  assert.equal(args[args.indexOf('claude') - 1], 'adw-e2e-demo-todo');
  assert.equal(args[args.indexOf('--model') + 1], 'm');
  assert.equal(args[args.indexOf('--setting-sources') + 1], 'user', 'agent-authored project settings are not loaded');
  assert.equal(args[args.indexOf('--allowedTools') + 1], 'Bash,Read,Grep,Glob,mcp__playwright');
  assert.equal(args[args.indexOf('--disallowedTools') + 1], 'Edit,Write,NotebookEdit,Task,WebFetch,WebSearch');
  assert.match(args[args.indexOf('--mcp-config') + 1], /"command":"playwright-mcp"/);
});

test('runVerifier never puts the token on the command line and always removes the container', () => {
  const calls = [];
  const run = (cmd, args, o) => { calls.push({ cmd, args, env: o?.env }); return args[0] === 'run' ? { status: 0, stdout: answer(both) } : { status: 0 }; };
  const r = runVerifier({ config, checkout: '/tmp/co', criteria, env: { CLAUDE_CODE_OAUTH_TOKEN: 'sk-secret' }, image: 'img', name: 'v1', run, uid: 1000, gid: 1000 });
  assert.equal(r.error, null);
  assert.equal(r.criteria.AC2.pass, false);
  assert.ok(calls.every((c) => c.cmd === 'docker' && !c.args.some((a) => a.includes('sk-secret'))), 'token value on argv');
  assert.equal(calls[0].env.CLAUDE_CODE_OAUTH_TOKEN, 'sk-secret', 'docker inherits the token through its env');
  assert.deepEqual(calls.at(-1).args, ['rm', '-f', 'v1']);
});

test('a timed-out or invalid verifier yields no verdicts and an error, and the container is still removed', () => {
  const calls = [];
  const timeout = (cmd, args) => { calls.push(args); return args[0] === 'run' ? { status: null, error: Object.assign(new Error('ETIMEDOUT'), { code: 'ETIMEDOUT' }) } : { status: 0 }; };
  assert.deepEqual(runVerifier({ config, checkout: '/c', criteria, image: 'img', name: 'v2', run: timeout, uid: 1, gid: 1 }),
    { criteria: null, error: 'verifier timed out after 900 s' });
  assert.deepEqual(calls.at(-1), ['rm', '-f', 'v2']);
  const partial = runVerifier({ config, checkout: '/c', criteria, image: 'img', name: 'v3', uid: 1, gid: 1,
    run: (cmd, args) => (args[0] === 'run' ? { status: 0, stdout: answer([both[0]]) } : { status: 0 }) });
  assert.equal(partial.criteria, null);
  assert.match(partial.error, /missing: AC2/);
});

test('an interrupted verifier run propagates instead of becoming an error verdict, and the container is still removed', () => {
  const calls = [];
  const run = (cmd, args) => { calls.push(args); return args[0] === 'run' ? { status: null, signal: 'SIGINT' } : { status: 0 }; };
  assert.throws(() => runVerifier({ config, checkout: '/c', criteria, image: 'img', name: 'v4', run, uid: 1, gid: 1 }), (e) => isInterrupt(e));
  assert.deepEqual(calls.at(-1), ['rm', '-f', 'v4']);
});

test('runVerifier hands the raw transcript to onTranscript, also when the answer is unusable', () => {
  const seen = [];
  const run = (cmd, args) => (args[0] === 'run' ? { status: 0, stdout: answer([both[0]]) } : { status: 0 });
  const r = runVerifier({ config, checkout: '/c', criteria, image: 'img', name: 'v5', run, uid: 1, gid: 1, onTranscript: (s) => seen.push(s) });
  assert.match(r.error, /missing: AC2/);
  assert.deepEqual(seen, [answer([both[0]])]);
});
