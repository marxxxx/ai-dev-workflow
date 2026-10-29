import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LANGUAGES, detectLanguage, textsFor } from './language.mjs';

test('detectLanguage: German stop words win, else English', () => {
  assert.equal(detectLanguage('Todos bekommen ein Datum, das nicht leer ist und mit der Liste'), 'de');
  assert.equal(detectLanguage('Todos get a due date that is shown with the list'), 'en');
  assert.equal(detectLanguage(''), 'en');
});

test('textsFor: openings and reply languages', () => {
  assert.deepEqual(LANGUAGES, ['en', 'de']);
  assert.equal(textsFor('en').opening(7), 'Use the agent-dev skill for ticket 7.');
  assert.equal(textsFor('de').opening(7), 'Nutze den agent-dev Skill für Ticket 7.');
  assert.equal(textsFor('en').replyLanguage, 'English');
  assert.equal(textsFor('de').replyLanguage, 'German');
});

test('textsFor: both languages have A1..A5 with identical questions', () => {
  const en = textsFor('en').defaultAnswers;
  const de = textsFor('de').defaultAnswers;
  assert.deepEqual(en.map((a) => a.id), ['A1', 'A2', 'A3', 'A4', 'A5']);
  assert.deepEqual(de.map((a) => [a.id, a.question]), en.map((a) => [a.id, a.question]));
  assert.ok(en.every((a) => a.source === 'default' && a.answer));
  assert.notEqual(textsFor('en').continueText, textsFor('de').continueText);
});
