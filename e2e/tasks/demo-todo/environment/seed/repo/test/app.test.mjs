import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createApp } from '../src/app.mjs';

async function withServer(fn) {
  const server = createServer(createApp()).listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await fn(base);
  } finally {
    server.close();
  }
}

const json = (method, body) => ({
  method,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

test('creates and lists todos', () =>
  withServer(async (base) => {
    const created = await fetch(`${base}/todos`, json('POST', { title: 'Milch kaufen' }));
    assert.equal(created.status, 201);
    const list = await (await fetch(`${base}/todos`)).json();
    assert.deepEqual(list, [{ id: 1, title: 'Milch kaufen', done: false }]);
  }));

test('rejects an empty title', () =>
  withServer(async (base) => {
    const res = await fetch(`${base}/todos`, json('POST', { title: ' ' }));
    assert.equal(res.status, 400);
  }));

test('marks a todo done', () =>
  withServer(async (base) => {
    await fetch(`${base}/todos`, json('POST', { title: 'A' }));
    const res = await fetch(`${base}/todos/1`, json('PATCH', { done: true }));
    assert.equal((await res.json()).done, true);
  }));

test('serves the list page', () =>
  withServer(async (base) => {
    const res = await fetch(`${base}/`);
    assert.equal(res.status, 200);
    assert.match(await res.text(), /data-testid="todo-list"/);
  }));
