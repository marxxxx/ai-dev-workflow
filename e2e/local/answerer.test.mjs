import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { InterruptError } from '../lib/llm.mjs';
import { DEFAULT_ANSWERS } from './store.mjs';
import { askHumanTty, buildAnswererPrompt, fallbackCommand, makeDecide, runConversation, validateAnswererAnswer } from './answerer.mjs';

const OPENING = 'Nutze den agent-dev Skill für Ticket 7.';

// An in-memory store with the store.mjs id scheme.
function memStore(initial = DEFAULT_ANSWERS) {
  const answers = initial.map((a) => ({ ...a }));
  return {
    list: () => answers.map((a) => ({ ...a })),
    append({ question, answer }) {
      const entry = { id: `A${answers.length + 1}`, question, answer, source: 'human' };
      answers.push(entry);
      return entry;
    },
    answers,
  };
}

// An agent that answers each prompt from `replies` in order (the last one repeats), recording what it was sent.
function stubSession(replies) {
  const sent = [];
  return { sent, prompt: async (text) => { sent.push(text); return replies[Math.min(sent.length - 1, replies.length - 1)]; } };
}

// A decide that answers each turn from `answers` in order, recording its arguments.
function stubDecide(answers) {
  const calls = [];
  const decide = (message, list, ctx) => { calls.push({ message, ids: list.map((a) => a.id), ctx }); return answers[calls.length - 1]; };
  return Object.assign(decide, { calls });
}

const noHuman = async () => { throw new Error('human asked'); };

test('a full replay asks no human and ends done', async () => {
  const session = stubSession(['Frage 1?', 'Frage 2?', 'Branch gepusht, Ticket in review.']);
  const decide = stubDecide([
    { action: 'reply', text: 'Bitte stell deine Fragen.', usedIds: ['A1'] },
    { action: 'reply', text: 'Teste selbst.', usedIds: ['A2'] },
    { action: 'done', stuck: false },
  ]);
  const store = memStore();
  const r = await runConversation({ ticket: 7, harness: 'codex', opening: OPENING, session, decide, askHuman: noHuman, store, maxTurns: 10 });
  assert.deepEqual(r, { turns: 3, humanAsked: 0, done: true, stuck: false, error: null });
  assert.deepEqual(session.sent, [OPENING, 'Bitte stell deine Fragen.', 'Teste selbst.']);
  assert.equal(store.answers.length, DEFAULT_ANSWERS.length);
});

test('one askHuman stores one answer before it is sent, and later turns see it', async () => {
  const session = stubSession(['Welche Farbe?', 'Und die Größe?', 'fertig']);
  const decide = stubDecide([
    { action: 'askHuman', question: 'Which colour' },
    { action: 'reply', text: 'Blau, wie gesagt.', usedIds: ['A6'] },
    { action: 'done', stuck: false },
  ]);
  const store = memStore();
  const asked = [];
  const askHuman = async (message, question) => {
    asked.push({ message, question, stored: store.answers.length });
    return 'Blau.';
  };
  const r = await runConversation({ ticket: 7, harness: 'codex', opening: OPENING, session, decide, askHuman, store, maxTurns: 10 });
  assert.equal(r.humanAsked, 1);
  assert.equal(r.done, true);
  assert.deepEqual(asked, [{ message: 'Welche Farbe?', question: 'Which colour', stored: 5 }]);
  assert.deepEqual(store.answers.at(-1), { id: 'A6', question: 'Which colour', answer: 'Blau.', source: 'human' });
  assert.equal(session.sent[1], 'Blau.');
  assert.ok(decide.calls[1].ids.includes('A6'));
});

test('a spec approval with no stored approval asks the human and is stored as a spec approval', async () => {
  const session = stubSession(['Hier ist die Spec. Freigeben?', 'Plan fertig. Freigeben?', 'fertig']);
  const decide = stubDecide([
    { action: 'askHuman', question: 'Approve the spec for the colour picker', specApproval: true },
    { action: 'reply', text: 'Der Plan ist freigegeben.', usedIds: ['A3'] },
    { action: 'done', stuck: false },
  ]);
  const store = memStore();
  const askHuman = async () => 'Passt, freigegeben.';
  const r = await runConversation({ ticket: 7, harness: 'codex', opening: OPENING, session, decide, askHuman, store, maxTurns: 10 });
  assert.equal(r.humanAsked, 1);
  assert.equal(store.answers.at(-1).question, 'Spec approval: Approve the spec for the colour picker');
  assert.deepEqual(decide.calls.map((c) => c.ctx.specApproved), [false, true, true]);
});

test('a replayed spec approval marks the spec approved', async () => {
  const store = memStore([...DEFAULT_ANSWERS, { id: 'A6', question: 'Spec approval: colour picker', answer: 'Freigegeben.', source: 'human' }]);
  const session = stubSession(['Spec freigeben?', 'weiter', 'fertig']);
  const decide = stubDecide([
    { action: 'reply', text: 'Freigegeben.', usedIds: ['A6'] },
    { action: 'reply', text: 'Ja.', usedIds: ['A4'] },
    { action: 'done', stuck: false },
  ]);
  await runConversation({ ticket: 7, harness: 'codex', opening: OPENING, session, decide, askHuman: noHuman, store, maxTurns: 10 });
  assert.deepEqual(decide.calls.map((c) => c.ctx.specApproved), [false, true, true]);
});

test('an endless agent stops at maxTurns', async () => {
  const session = stubSession(['Noch eine Frage?']);
  const decide = () => ({ action: 'reply', text: 'Ja.', usedIds: ['A4'] });
  const r = await runConversation({ ticket: 7, harness: 'codex', opening: OPENING, session, decide, askHuman: noHuman, store: memStore(), maxTurns: 3 });
  assert.deepEqual(r, { turns: 3, humanAsked: 0, done: false, stuck: false, error: 'max-turns' });
  assert.equal(session.sent.length, 3);
  const asking = await runConversation({ ticket: 7, harness: 'codex', opening: OPENING, session: stubSession(['?']),
    decide: () => ({ action: 'askHuman', question: 'q' }), askHuman: noHuman, store: memStore(), maxTurns: 1 });
  assert.equal(asking.error, 'max-turns');
});

test('a stuck agent ends done with stuck', async () => {
  const r = await runConversation({ ticket: 7, harness: 'codex', opening: OPENING, session: stubSession(['Ich komme nicht weiter.']),
    decide: () => ({ action: 'done', stuck: true }), askHuman: noHuman, store: memStore(), maxTurns: 5 });
  assert.deepEqual(r, { turns: 1, humanAsked: 0, done: true, stuck: true, error: null });
});

test('a prompt timing out gives agent-timeout; a quota rejection gives quota', async () => {
  const timeout = { prompt: () => Promise.reject(new Error('agent (codex): timed out after 1800 s')) };
  let r = await runConversation({ ticket: 7, harness: 'codex', opening: OPENING, session: timeout, decide: noHuman, askHuman: noHuman, store: memStore(), maxTurns: 5 });
  assert.deepEqual(r, { turns: 1, humanAsked: 0, done: false, stuck: false, error: 'agent-timeout' });
  const quota = { prompt: () => Promise.reject(new Error('agent (codex): quota: exit 1: usage limit')) };
  r = await runConversation({ ticket: 7, harness: 'codex', opening: OPENING, session: quota, decide: noHuman, askHuman: noHuman, store: memStore(), maxTurns: 5 });
  assert.equal(r.error, 'quota');
});

test('other prompt and decide errors stop the loop with a labelled error; interrupts are rethrown', async () => {
  const broken = { prompt: () => Promise.reject(new Error('agent (codex): exit 2: boom')) };
  let r = await runConversation({ ticket: 7, harness: 'codex', opening: OPENING, session: broken, decide: noHuman, askHuman: noHuman, store: memStore(), maxTurns: 5 });
  assert.equal(r.error, 'agent: agent (codex): exit 2: boom');
  const failing = () => { throw new Error('answerer (opencode): no answer in the opencode output'); };
  r = await runConversation({ ticket: 7, harness: 'codex', opening: OPENING, session: stubSession(['?']), decide: failing, askHuman: noHuman, store: memStore(), maxTurns: 5 });
  assert.deepEqual(r, { turns: 1, humanAsked: 0, done: false, stuck: false, error: 'answerer: answerer (opencode): no answer in the opencode output' });
  const quota = () => { throw new Error('answerer (opencode): quota: 429'); };
  r = await runConversation({ ticket: 7, harness: 'codex', opening: OPENING, session: stubSession(['?']), decide: quota, askHuman: noHuman, store: memStore(), maxTurns: 5 });
  assert.equal(r.error, 'quota');
  const interrupt = () => { throw new InterruptError('SIGINT'); };
  await assert.rejects(runConversation({ ticket: 7, harness: 'codex', opening: OPENING, session: stubSession(['?']), decide: interrupt, askHuman: noHuman, store: memStore(), maxTurns: 5 }), /interrupted/);
  const interrupted = { prompt: () => Promise.reject(new InterruptError('SIGTERM')) };
  await assert.rejects(runConversation({ ticket: 7, harness: 'codex', opening: OPENING, session: interrupted, decide: noHuman, askHuman: noHuman, store: memStore(), maxTurns: 5 }), /interrupted/);
});

test('an unknown-skill first reply gets the harness fallback once', async () => {
  for (const [harness, reply] of [['claude-code', 'Unknown skill: agent-dev'], ['codex', 'Ich kenne keinen solchen Skill.'], ['opencode', 'There is no skill named agent-dev.']]) {
    const session = stubSession([reply, 'Unknown skill again', 'fertig']);
    const decide = stubDecide([{ action: 'reply', text: 'Ja.', usedIds: ['A4'] }, { action: 'done', stuck: false }]);
    const r = await runConversation({ ticket: 7, harness, opening: OPENING, session, decide, askHuman: noHuman, store: memStore(), maxTurns: 10 });
    assert.deepEqual(session.sent, [OPENING, fallbackCommand(harness, 7), 'Ja.']);
    assert.equal(r.turns, 3);
    assert.equal(decide.calls[0].message, 'Unknown skill again');
  }
  assert.equal(fallbackCommand('claude-code', 7), '/agent-dev 7');
  assert.equal(fallbackCommand('codex', 7), '$agent-dev 7');
  assert.equal(fallbackCommand('opencode', 7), '$agent-dev 7');
});

test('validateAnswererAnswer accepts the three actions and rejects bad answers', () => {
  const ids = ['A1', 'A2'];
  assert.deepEqual(validateAnswererAnswer({ action: 'reply', text: 'Ja.', usedIds: ['A2'] }, ids), { action: 'reply', text: 'Ja.', usedIds: ['A2'] });
  assert.deepEqual(validateAnswererAnswer({ action: 'askHuman', question: 'Which colour' }, ids), { action: 'askHuman', question: 'Which colour', specApproval: false });
  assert.deepEqual(validateAnswererAnswer({ action: 'askHuman', question: 'Spec', specApproval: true }, ids), { action: 'askHuman', question: 'Spec', specApproval: true });
  assert.deepEqual(validateAnswererAnswer({ action: 'done' }, ids), { action: 'done', stuck: false });
  assert.deepEqual(validateAnswererAnswer({ action: 'done', stuck: true }, ids), { action: 'done', stuck: true });
  assert.throws(() => validateAnswererAnswer({ action: 'shrug' }, ids), /unknown action/);
  assert.throws(() => validateAnswererAnswer(null, ids), /unknown action/);
  assert.throws(() => validateAnswererAnswer({ action: 'reply', text: '  ', usedIds: [] }, ids), /empty text/);
  assert.throws(() => validateAnswererAnswer({ action: 'reply', text: 'Ja.' }, ids), /usedIds/);
  assert.throws(() => validateAnswererAnswer({ action: 'reply', text: 'Ja.', usedIds: ['A9'] }, ids), /unknown usedIds: A9/);
  assert.throws(() => validateAnswererAnswer({ action: 'askHuman', question: '' }, ids), /empty question/);
});

test('the prompt holds the ticket, the agent message, every stored answer id and the rules', () => {
  const answers = [...DEFAULT_ANSWERS, { id: 'A6', question: 'Which colour', answer: 'Blau.', source: 'human' }];
  const p = buildAnswererPrompt({ ticket: { title: 'Farbwahl', body: 'Der Nutzer wählt eine Farbe.' }, answers, message: 'AGENT-MESSAGE-XYZ', specApproved: false });
  for (const a of answers) assert.ok(p.includes(a.id), a.id);
  for (const s of ['Farbwahl', 'Der Nutzer wählt eine Farbe.', 'AGENT-MESSAGE-XYZ', 'Blau.', 'Spec approval', '"action":"reply"', '"action":"askHuman"', '"action":"done"', 'German'])
    assert.ok(p.includes(s), s);
  assert.match(p, /not yet approved/);
  assert.match(buildAnswererPrompt({ ticket: { title: 't', body: 'b' }, answers, message: 'm', specApproved: true }), /already approved/);
});

test('makeDecide calls the answerer with no tools and validates its answer', () => {
  const calls = [];
  const run = (cmd, args, opts) => {
    calls.push({ args, input: opts.input, timeout: opts.timeout });
    return { status: 0, stdout: `${JSON.stringify({ type: 'result', is_error: false, result: '{"action":"reply","text":"Ja.","usedIds":["A1"]}' })}\n` };
  };
  const buildArgs = ({ name, checkout, readOnly, argv }) => [name, checkout, String(readOnly), ...argv];
  const decide = makeDecide({ ticket: { title: 'T', body: 'B' }, harness: 'claude-code', model: 'haiku', buildArgs, name: 'adw-answerer', checkout: '/w', timeoutMs: 300000, run });
  assert.deepEqual(decide('Frage?', DEFAULT_ANSWERS, { specApproved: false }), { action: 'reply', text: 'Ja.', usedIds: ['A1'] });
  assert.equal(calls[0].timeout, 300000);
  assert.ok(calls[0].input.includes('Frage?'));
  assert.equal(calls[0].args[1], '/w');
  assert.equal(calls[0].args[2], 'true');
  assert.ok(calls[0].args.includes('--tools'));
  assert.ok(calls[0].args.includes('haiku'));
  decide('Noch?', DEFAULT_ANSWERS, { specApproved: false });
  assert.notEqual(calls[0].args[0], calls[1].args[0]);
  const bad = makeDecide({ ticket: { title: 'T', body: 'B' }, harness: 'claude-code', buildArgs, name: 'n', checkout: '/w', timeoutMs: 1, run: () => ({ status: 0, stdout: JSON.stringify({ result: '{"action":"reply","text":"x","usedIds":["A99"]}' }) }) });
  assert.throws(() => bad('m', DEFAULT_ANSWERS, { specApproved: false }), /answerer \(claude-code\): unknown usedIds: A99/);
});

test('askHumanTty prints the agent message and the question and re-asks on empty input', async () => {
  const input = new PassThrough(); const output = new PassThrough();
  let out = '';
  output.on('data', (d) => { out += d; });
  const ask = askHumanTty({ input, output });
  const answer = ask('Volle Nachricht des Agenten.', 'Which colour');
  setImmediate(() => { input.write('\n'); setImmediate(() => input.write('  Blau.  \n')); });
  assert.equal(await answer, 'Blau.');
  assert.ok(out.includes('Volle Nachricht des Agenten.'));
  assert.ok(out.includes('Which colour'));
  assert.ok(out.indexOf('Volle Nachricht') < out.indexOf('Which colour'));
});

test('askHumanTty rejects when the input closes without an answer', async () => {
  const input = new PassThrough(); const output = new PassThrough();
  const answer = askHumanTty({ input, output })('m', 'q');
  setImmediate(() => input.end());
  await assert.rejects(answer, /input closed/);
});
