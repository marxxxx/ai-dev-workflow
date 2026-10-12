import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { loadConfig } from './config.mjs';
import { taskDir } from './tasks.mjs';
import { loadCriteria, parseCriteria } from './criteria.mjs';

test('parses the AC rows of a criteria table and ignores the header', () => {
  const md = '# x\n\n| Id | Criterion |\n|---|---|\n| AC1 | A todo can get a due date. |\n| AC2 | It can be removed. |\n';
  assert.deepEqual(parseCriteria(md), [{ id: 'AC1', text: 'A todo can get a due date.' }, { id: 'AC2', text: 'It can be removed.' }]);
});

test('rejects a table without criteria or with a duplicate id', () => {
  assert.throws(() => parseCriteria('| Id | Criterion |\n|---|---|\n'), /no acceptance criteria/);
  assert.throws(() => parseCriteria('| AC1 | a |\n| AC1 | b |\n'), /duplicate acceptance criterion AC1/);
});

test('demo-todo has AC1 to AC7 and names no endpoint, query parameter or field', () => {
  const config = loadConfig();
  const criteria = loadCriteria(path.join(taskDir(config, 'demo-todo'), 'acceptance-criteria.md'));
  assert.deepEqual(criteria.map((c) => c.id), ['AC1', 'AC2', 'AC3', 'AC4', 'AC5', 'AC6', 'AC7']);
  for (const { id, text } of criteria) assert.doesNotMatch(text, /\/todos|\?|dueDate|YYYY/, id);
});
