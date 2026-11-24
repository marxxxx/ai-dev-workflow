import assert from 'node:assert/strict';
import test from 'node:test';
import { isAuthorized } from './auth.mjs';

const TOKEN = 'a'.repeat(32);

test('accepts the token in x-api-key', () => {
  assert.equal(isAuthorized({ 'x-api-key': TOKEN }, TOKEN), true);
});

test('accepts the token as a Bearer credential', () => {
  assert.equal(isAuthorized({ authorization: `Bearer ${TOKEN}` }, TOKEN), true);
});

test('rejects wrong, missing, empty and different-length values', () => {
  assert.equal(isAuthorized({ 'x-api-key': 'b'.repeat(32) }, TOKEN), false);
  assert.equal(isAuthorized({}, TOKEN), false);
  assert.equal(isAuthorized({ 'x-api-key': '' }, TOKEN), false);
  assert.equal(isAuthorized({ authorization: 'Bearer ' }, TOKEN), false);
  assert.equal(isAuthorized({ 'x-api-key': 'a'.repeat(5) }, TOKEN), false);
  assert.equal(isAuthorized({ 'x-api-key': TOKEN + 'a' }, TOKEN), false);
});

test('rejects a mistyped scheme', () => {
  assert.equal(isAuthorized({ authorization: `bearer ${TOKEN}` }, TOKEN), false);
  assert.equal(isAuthorized({ authorization: TOKEN }, TOKEN), false);
});
