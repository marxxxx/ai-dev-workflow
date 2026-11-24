import assert from 'node:assert/strict';
import test from 'node:test';
import { SessionError } from './sessions.mjs';
import { buildTools } from './tools.mjs';

const ID = '00000000-0000-4000-8000-000000000001';
const record = {
  id: ID, harness: 'codex', task: 'secret task', status: 'idle', turn: 2, lastMessage: 'hello', error: null,
  createdAt: 'c', updatedAt: 'u', pid: 4242,
};
const VIEW = { session_id: ID, harness: 'codex', status: 'idle', turn: 2, last_message: 'hello', error: null, created_at: 'c', updated_at: 'u' };

function setup(overrides = {}) {
  const calls = [];
  const record1 = (name) => (args) => { calls.push([name, args]); return record; };
  const sessions = {
    start: record1('start'),
    query: record1('query'),
    post: record1('post'),
    terminate: async (args) => { calls.push(['terminate', args]); return record; },
    list: (args) => { calls.push(['list', args]); return [record, { ...record, id: '2' }]; },
    ...overrides,
  };
  const logged = [];
  const tools = Object.fromEntries(buildTools(sessions, { log: (line) => logged.push(line) }).map((t) => [t.name, t]));
  return { tools, calls, logged };
}
const text = (result) => result.content[0].text;

test('buildTools has the five tools with a description and an object schema', () => {
  const { tools } = setup();
  assert.deepEqual(Object.keys(tools), ['start_session', 'query_session', 'post_session', 'list_sessions', 'terminate_session']);
  for (const tool of Object.values(tools)) {
    assert.ok(tool.description.length > 0);
    assert.equal(tool.inputSchema.type, 'object');
    assert.equal(typeof tool.handler, 'function');
  }
  assert.deepEqual(tools.start_session.inputSchema.required, ['harness', 'task']);
  assert.deepEqual(tools.post_session.inputSchema.required, ['session_id', 'message']);
});

test('start_session maps its arguments and returns the snake_case view without pid or task', async () => {
  const { tools, calls } = setup();
  const result = await tools.start_session.handler({ harness: 'codex', task: 'do it' });
  assert.deepEqual(calls, [['start', { harness: 'codex', task: 'do it' }]]);
  assert.deepEqual(JSON.parse(text(result)), VIEW);
  assert.equal(result.isError, undefined);
  assert.ok(!text(result).includes('4242') && !text(result).includes('secret task'));
});

test('query_session and post_session map session_id, message and the optional harness', async () => {
  const { tools, calls } = setup();
  assert.deepEqual(JSON.parse(text(await tools.query_session.handler({ session_id: ID }))), VIEW);
  await tools.query_session.handler({ session_id: ID, harness: 'codex' });
  await tools.post_session.handler({ session_id: ID, message: 'go on', harness: 'codex' });
  assert.deepEqual(calls, [
    ['query', { sessionId: ID, harness: undefined }],
    ['query', { sessionId: ID, harness: 'codex' }],
    ['post', { sessionId: ID, message: 'go on', harness: 'codex' }],
  ]);
});

test('list_sessions returns { sessions } of views and passes the status filter', async () => {
  const { tools, calls } = setup();
  const body = JSON.parse(text(await tools.list_sessions.handler({ status: 'idle' })));
  assert.equal(body.sessions.length, 2);
  assert.deepEqual(body.sessions[0], VIEW);
  assert.deepEqual(Object.keys(body.sessions[1]).sort(), Object.keys(VIEW).sort());
  await tools.list_sessions.handler(undefined);
  assert.deepEqual(calls, [['list', { status: 'idle' }], ['list', { status: undefined }]]);
});

test('terminate_session awaits the terminate call', async () => {
  const { tools, calls } = setup();
  assert.deepEqual(JSON.parse(text(await tools.terminate_session.handler({ session_id: ID }))), VIEW);
  assert.deepEqual(calls, [['terminate', { sessionId: ID }]]);
});

test('a SessionError becomes an isError result with its message', async () => {
  const { tools, logged } = setup({ start: () => { throw new SessionError('session x is running'); } });
  const result = await tools.start_session.handler({ harness: 'codex', task: 'a' });
  assert.deepEqual(result, { isError: true, content: [{ type: 'text', text: 'session x is running' }] });
  assert.deepEqual(logged, []);
});

test('a SessionError from an async tool is an isError result too', async () => {
  const { tools } = setup({ terminate: async () => { throw new SessionError('unknown session'); } });
  const result = await tools.terminate_session.handler({ session_id: ID });
  assert.equal(result.isError, true);
  assert.equal(text(result), 'unknown session');
});

test('any other error is the generic text and is logged without detail of the arguments', async () => {
  const { tools, logged } = setup({ query: () => { throw new Error('disk exploded'); } });
  const result = await tools.query_session.handler({ session_id: ID, harness: 'TOKEN-IN-ARGS' });
  assert.deepEqual(result, { isError: true, content: [{ type: 'text', text: 'internal error' }] });
  assert.equal(logged.length, 1);
  assert.ok(logged[0].includes('disk exploded'));
  assert.ok(!logged[0].includes('TOKEN-IN-ARGS'));
});

test('missing or mistyped arguments are isError results and never reach the sessions', async () => {
  const { tools, calls } = setup();
  const bad = [
    [tools.query_session, {}], [tools.query_session, { session_id: '' }], [tools.query_session, { session_id: 5 }],
    [tools.query_session, { session_id: ID, harness: 5 }],
    [tools.post_session, { session_id: ID }], [tools.post_session, { message: 'x' }],
    [tools.terminate_session, {}], [tools.start_session, { harness: 'codex' }], [tools.start_session, { task: 'x' }],
    [tools.start_session, { harness: 'codex', task: 5 }], [tools.list_sessions, { status: 5 }],
    [tools.query_session, [ID]], [tools.query_session, null],
  ];
  for (const [tool, args] of bad) {
    const result = await tool.handler(args);
    assert.equal(result.isError, true, `${tool.name} ${JSON.stringify(args)}`);
    assert.notEqual(text(result), 'internal error');
  }
  assert.deepEqual(calls, []);
});
