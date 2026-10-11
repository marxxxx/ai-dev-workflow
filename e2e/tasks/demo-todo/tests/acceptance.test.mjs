// Hidden acceptance tests for ticket #1 (dueDate). Never visible to the agent.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createApp } from '../src/app.mjs';

async function withServer(fn) {
  const server = createServer(createApp()).listen(0);
  await new Promise((r) => server.once('listening', r));
  try {
    await fn(`http://127.0.0.1:${server.address().port}`);
  } finally {
    server.close();
  }
}
const req = (method, body) => ({
  method,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});
const day = (offset) => new Date(Date.now() + offset * 864e5).toISOString().slice(0, 10);

test('acceptance: dueDate is stored on create', () =>
  withServer(async (b) => {
    const res = await fetch(`${b}/todos`, req('POST', { title: 'A', dueDate: '2030-01-15' }));
    assert.equal(res.status, 201);
    assert.equal((await res.json()).dueDate, '2030-01-15');
  }));

test('acceptance: invalid dates are rejected', () =>
  withServer(async (b) => {
    for (const dueDate of ['15.01.2030', '2030-1-5', '2026-02-30', '2030-01-15T10:00:00Z']) {
      const res = await fetch(`${b}/todos`, req('POST', { title: 'A', dueDate }));
      assert.equal(res.status, 400, dueDate);
    }
  }));

test('acceptance: PATCH sets and clears dueDate', () =>
  withServer(async (b) => {
    await fetch(`${b}/todos`, req('POST', { title: 'A' }));
    let todo = await (await fetch(`${b}/todos/1`, req('PATCH', { dueDate: '2030-03-01' }))).json();
    assert.equal(todo.dueDate, '2030-03-01');
    const res = await fetch(`${b}/todos/1`, req('PATCH', { dueDate: null }));
    assert.equal(res.status, 200);
    todo = await res.json();
    assert.ok(todo.dueDate === null || !('dueDate' in todo));
    assert.equal((await fetch(`${b}/todos/1`, req('PATCH', { dueDate: 'x' }))).status, 400);
  }));

test('acceptance: overdue filter', () =>
  withServer(async (b) => {
    await fetch(`${b}/todos`, req('POST', { title: 'past', dueDate: day(-2) }));
    await fetch(`${b}/todos`, req('POST', { title: 'today', dueDate: day(0) }));
    await fetch(`${b}/todos`, req('POST', { title: 'future', dueDate: day(5) }));
    await fetch(`${b}/todos`, req('POST', { title: 'none' }));
    await fetch(`${b}/todos`, req('POST', { title: 'past-done', dueDate: day(-3) }));
    await fetch(`${b}/todos/5`, req('PATCH', { done: true }));
    const overdue = await (await fetch(`${b}/todos?overdue=true`)).json();
    assert.deepEqual(overdue.map((t) => t.title), ['past']);
    const all = await (await fetch(`${b}/todos`)).json();
    assert.equal(all.length, 5);
  }));
