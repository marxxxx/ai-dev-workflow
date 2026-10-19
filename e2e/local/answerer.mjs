// The simulated user of `adw e2e`: after each agent turn, replay a stored answer, ask the real human, or stop.
// The answerer is a one-shot LLM call with no tools; the loop itself is harness-neutral.
import { createInterface } from 'node:readline';
import { callLlm, isInterrupt, isQuotaError } from '../lib/llm.mjs';

const ACTIONS = ['reply', 'askHuman', 'done'];
const SPEC_APPROVAL = 'Spec approval';
const UNKNOWN_SKILL = /unknown skill|kenne.*skill|no skill named/i;

// The command that invokes the skill directly when the agent does not recognise the opening message.
export const fallbackCommand = (harness, ticket) => `${harness === 'claude-code' ? '/' : '$'}agent-dev ${ticket}`;

// `ticket` is { title, body } (store.mjs readTicket); `answers` the current answers.json entries.
export function buildAnswererPrompt({ ticket, answers, message, specApproved }) {
  const stored = answers.map((a) => `- ${a.id} | question: ${a.question} | answer: ${a.answer}`).join('\n');
  return `You play the user (product owner) of a coding agent working on the ticket below. Decide how the user answers the agent's latest message.

Rules:
- Reply only from the stored answers, in the user's voice: short, German, one or two sentences. List the ids you used in usedIds.
- Never invent requirements. Anything the stored answers do not cover gives askHuman.
- A spec or design approval request gives askHuman with "specApproval":true, unless a stored answer's question starts with "${SPEC_APPROVAL}". In that case reply: approve if the spec covers the stored answers, otherwise name the deviation.
- The final report of a pushed branch with the ticket in review, or the agent clearly stuck, gives done ("stuck":true when stuck).
- Output JSON only, exactly one of:
  {"action":"reply","text":"…","usedIds":["A2"]}
  {"action":"askHuman","question":"<agent's question, condensed>","specApproval":false}
  {"action":"done","stuck":false}

The spec is ${specApproved ? 'already approved in this run; a later approval request is about the plan or another step' : 'not yet approved in this run'}.

## Ticket: ${ticket.title}

${ticket.body}

## Stored answers

${stored}

## The agent's latest message

${message}
`;
}

// The answer normalised, or a throw naming what is wrong; `ids` are the stored answer ids.
export function validateAnswererAnswer(a, ids) {
  if (!ACTIONS.includes(a?.action)) throw new Error(`unknown action: ${JSON.stringify(a?.action)}`);
  if (a.action === 'done') return { action: 'done', stuck: a.stuck === true };
  if (a.action === 'askHuman') {
    if (typeof a.question !== 'string' || !a.question.trim()) throw new Error('askHuman with an empty question');
    return { action: 'askHuman', question: a.question.trim(), specApproval: a.specApproval === true };
  }
  if (typeof a.text !== 'string' || !a.text.trim()) throw new Error('reply with an empty text');
  if (!Array.isArray(a.usedIds)) throw new Error('reply without usedIds');
  const unknown = a.usedIds.filter((id) => !ids.includes(id));
  if (unknown.length) throw new Error(`unknown usedIds: ${unknown.join(', ')}`);
  return { action: 'reply', text: a.text.trim(), usedIds: a.usedIds };
}

// The default `decide`: one answerer call per turn, each in its own container (`name-<n>`), the checkout read-only.
export function makeDecide({ ticket, harness, model = null, buildArgs, name, checkout, timeoutMs, run, onStdout }) {
  let n = 0;
  return (message, answers, { specApproved }) => {
    const input = buildAnswererPrompt({ ticket, answers, message, specApproved });
    const answer = callLlm({ role: 'answerer', harness, model, tools: 'none', input, buildArgs,
      name: `${name}-${++n}`, checkout, readOnly: true, timeoutMs, run, onStdout });
    try { return validateAnswererAnswer(answer, answers.map((a) => a.id)); } catch (err) { throw new Error(`answerer (${harness}): ${err.message}`); }
  };
}

// The default `askHuman`: the full agent message, then the condensed question; an empty line asks again.
export const askHumanTty = ({ input = process.stdin, output = process.stdout } = {}) => (agentMessage, question) => new Promise((resolve, reject) => {
  const rl = createInterface({ input, output, terminal: false });
  let answered = false;
  output.write(`\n--- agent ---\n${agentMessage}\n--- question ---\n${question}\n> `);
  rl.on('line', (line) => {
    if (!line.trim()) { output.write('> '); return; }
    answered = true;
    rl.close();
    resolve(line.trim());
  });
  rl.on('close', () => { if (!answered) reject(new Error('no answer: input closed')); });
});

// Turns count the prompts sent to the agent. `ticket` is the ticket number; `store` is { list(), append({question, answer}) }.
// Errors become a result: agent-timeout, quota, `agent: …` or `answerer: …`; an interrupt aborts the run.
export async function runConversation({ ticket, harness, opening, session, decide, askHuman, store, maxTurns = 60 }) {
  const result = { turns: 0, humanAsked: 0, done: false, stuck: false, error: null };
  const classify = (err, who) => {
    if (isInterrupt(err)) throw err;
    if (isQuotaError(err.message)) return 'quota';
    if (who === 'agent' && /timed out/i.test(err.message)) return 'agent-timeout';
    return `${who}: ${err.message}`;
  };
  const send = async (text) => {
    result.turns += 1;
    try { return await session.prompt(text); } catch (err) { result.error = classify(err, 'agent'); return null; }
  };

  let message = await send(opening);
  if (message !== null && UNKNOWN_SKILL.test(message)) message = await send(fallbackCommand(harness, ticket));
  let specApproved = false;
  while (message !== null) {
    let answer;
    try { answer = await decide(message, store.list(), { specApproved }); } catch (err) { result.error = classify(err, 'answerer'); break; }
    if (answer.action === 'done') return { ...result, done: true, stuck: answer.stuck };
    // Checked before a human is asked, so the last allowed turn never costs an answer that is not sent.
    if (result.turns >= maxTurns) { result.error = 'max-turns'; break; }
    let text;
    if (answer.action === 'reply') {
      text = answer.text;
      const approvals = store.list().filter((a) => a.question.startsWith(SPEC_APPROVAL)).map((a) => a.id);
      if (answer.usedIds.some((id) => approvals.includes(id))) specApproved = true;
    } else {
      text = await askHuman(message, answer.question);
      result.humanAsked += 1;
      // Stored before it is sent, so a run that dies on this turn keeps the answer.
      store.append({ question: answer.specApproval ? `${SPEC_APPROVAL}: ${answer.question}` : answer.question, answer: text });
      if (answer.specApproval) specApproved = true;
    }
    message = await send(text);
  }
  return result;
}
