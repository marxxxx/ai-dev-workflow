import assert from 'node:assert/strict';
import test from 'node:test';
import { handleMessage } from './mcp.mjs';

const serverInfo = { name: 'adw-mcp', version: '1.0.0' };
const echo = {
  name: 'echo',
  description: 'Echoes',
  inputSchema: { type: 'object', properties: {} },
  handler: async (args) => ({ content: [{ type: 'text', text: JSON.stringify(args) }] }),
};
const boom = { name: 'boom', description: 'Throws', inputSchema: { type: 'object' }, handler: async () => { throw new Error('secret detail'); } };
const run = (message, tools = [echo]) => handleMessage(message, { tools, serverInfo });

test('initialize echoes a supported protocol version', async () => {
  for (const protocolVersion of ['2025-03-26', '2025-06-18']) {
    const reply = await run({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion } });
    assert.deepEqual(reply, {
      jsonrpc: '2.0', id: 1, result: { protocolVersion, capabilities: { tools: {} }, serverInfo },
    });
  }
});

test('initialize answers 2025-06-18 for an unsupported or missing version', async () => {
  for (const params of [{ protocolVersion: '1999-01-01' }, {}, undefined]) {
    const reply = await run({ jsonrpc: '2.0', id: 'a', method: 'initialize', params });
    assert.equal(reply.id, 'a');
    assert.equal(reply.result.protocolVersion, '2025-06-18');
  }
});

test('ping answers an empty result', async () => {
  assert.deepEqual(await run({ jsonrpc: '2.0', id: 2, method: 'ping' }), { jsonrpc: '2.0', id: 2, result: {} });
});

test('tools/list names the tools without their handlers', async () => {
  const reply = await run({ jsonrpc: '2.0', id: 3, method: 'tools/list' }, [echo, boom]);
  assert.deepEqual(reply.result.tools.map((t) => t.name), ['echo', 'boom']);
  assert.deepEqual(Object.keys(reply.result.tools[0]).sort(), ['description', 'inputSchema', 'name']);
});

test('tools/call runs the handler with the arguments', async () => {
  const reply = await run({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'echo', arguments: { a: 1 } } });
  assert.deepEqual(reply.result, { content: [{ type: 'text', text: '{"a":1}' }] });
});

test('tools/call with an unknown tool or bad params is -32602', async () => {
  for (const params of [{ name: 'nope' }, {}, null, 'echo']) {
    const reply = await run({ jsonrpc: '2.0', id: 5, method: 'tools/call', params });
    assert.equal(reply.error.code, -32602);
  }
});

test('a handler that throws becomes -32603 without its message, and only its name and code are logged', async () => {
  const logged = [];
  const failing = { ...boom, handler: async () => { throw Object.assign(new TypeError('secret detail'), { code: 'E_BOOM' }); } };
  const reply = await handleMessage(
    { jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'boom', arguments: { task: 'secret argument' } } },
    { tools: [failing], serverInfo, log: (line) => logged.push(line) },
  );
  assert.equal(reply.error.code, -32603);
  assert.ok(!JSON.stringify(reply).includes('secret detail'));
  assert.equal(logged.length, 1);
  assert.ok(logged[0].includes('boom') && logged[0].includes('TypeError') && logged[0].includes('E_BOOM'), logged[0]);
  assert.ok(!/secret/.test(logged[0]), logged[0]);
});

test('an unknown method is -32601', async () => {
  const reply = await run({ jsonrpc: '2.0', id: 7, method: 'resources/list' });
  assert.deepEqual(reply, { jsonrpc: '2.0', id: 7, error: { code: -32601, message: 'method not found' } });
});

test('notifications and client responses return null', async () => {
  assert.equal(await run({ jsonrpc: '2.0', method: 'notifications/initialized' }), null);
  assert.equal(await run({ jsonrpc: '2.0', method: 'whatever/unknown' }), null);
  assert.equal(await run({ jsonrpc: '2.0', id: 9, result: {} }), null);
});

test('arrays, non-objects and messages without a method are -32600', async () => {
  for (const message of [[{ jsonrpc: '2.0', id: 1, method: 'ping' }], 'ping', 5, null, { jsonrpc: '2.0', id: 1 }, { id: 1, method: 5 }]) {
    const reply = await run(message);
    assert.equal(reply.error.code, -32600, JSON.stringify(message));
    assert.equal(reply.id, message?.id ?? null);
  }
});
