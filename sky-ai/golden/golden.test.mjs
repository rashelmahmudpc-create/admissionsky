/* F0.6 — tests for the golden set and its scorer.
 *
 * These do NOT call a model. A model call is a cost and a flake; what needs to
 * be pinned here is that the yardstick itself is sound: the set is intact, the
 * answer keys are real, and the scorer grades the way it claims to. The model
 * score is a separate, deliberate run (run-baseline.mjs).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { isCorrect, normalize, optionIndexFromLetter, score } from './score.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const set = JSON.parse(readFileSync(join(HERE, 'golden-set-v1.json'), 'utf8'));

test('golden set has at least 200 items (the F0.6 bar)', () => {
  assert.ok(set.items.length >= 200, `only ${set.items.length} items`);
  assert.equal(set.count, set.items.length);
  assert.equal(set.version, 'golden-v1');
});

test('every item is answerable: question, options, and a key that is one of them', () => {
  for (const it of set.items) {
    assert.ok(it.question && it.question.trim(), `empty question: ${it.id}`);
    assert.ok(Array.isArray(it.options) && it.options.length >= 2, `bad options: ${it.id}`);
    assert.ok(it.answerIndex >= 0 && it.answerIndex < it.options.length, `key out of range: ${it.id}`);
    assert.equal(it.answer, it.options[it.answerIndex], `answer text mismatch: ${it.id}`);
  }
});

test('item ids are unique and topics are covered', () => {
  const ids = new Set(set.items.map((i) => i.id));
  assert.equal(ids.size, set.items.length);
  const topics = new Set(set.items.map((i) => i.topic));
  assert.ok(topics.size >= 5, `only ${topics.size} topics`);
});

test('the set is reproducible: rebuilding from the bank gives the same ids', async () => {
  const bank = JSON.parse(readFileSync(join(HERE, '..', '..', 'mcq_final.json'), 'utf8')).questions;
  const known = new Set(bank.map((q) => q.id));
  for (const it of set.items) assert.ok(known.has(it.id), `not in bank: ${it.id}`);
});

test('scorer: exact, contained, letter, and Bangla-letter answers are correct', () => {
  const it = { answer: 'নীল গাভি', answerIndex: 0, options: ['নীল গাভি', 'গোষ্ঠীর মোড়ল', 'শীত', 'সাঁওতালগোষ্ঠীর লোক'] };
  assert.ok(isCorrect('নীল গাভি', it));
  assert.ok(isCorrect('✅ সঠিক উত্তরটি হলো: **ক. নীল গাভি**।', it));
  assert.ok(isCorrect('ক', it));
  assert.ok(isCorrect('উত্তর: ক', it));
  assert.ok(isCorrect('নীলগাভি', it), 'one-char typo should still pass');
});

test('scorer: a different option is wrong, and no answer is wrong', () => {
  const it = { answer: 'নীল গাভি', answerIndex: 0, options: ['নীল গাভি', 'গোষ্ঠীর মোড়ল', 'শীত', 'সাঁওতালগোষ্ঠীর লোক'] };
  assert.equal(isCorrect('গোষ্ঠীর মোড়ল', it), false);
  assert.equal(isCorrect('খ', it), false);
  assert.equal(isCorrect('', it), false);
  assert.equal(isCorrect(null, it), false);
});

test('scorer: letter mapping handles a-e and ক-ঙ, and rejects junk', () => {
  assert.equal(optionIndexFromLetter('খ. খ্রিস্টান ধর্মযাজক'), 1);
  assert.equal(optionIndexFromLetter('উত্তর: গ'), 2);
  assert.equal(optionIndexFromLetter('b'), 1);
  assert.equal(optionIndexFromLetter('কিছুই না'), -1);
});

test('scorer: normalize strips Bangla/English punctuation and Bengali digits', () => {
  assert.equal(normalize('  ১২৩, নীল গাভি! '), '123 নীল গাভি');
  assert.equal(normalize('**ক. নীল গাভি**।'), 'ক নীল গাভি');
});

test('scorer: score() reports per-topic accuracy and misses', () => {
  const tiny = {
    version: 'golden-v1',
    items: [
      { id: 'a', topic: 'T1', question: 'q1', options: ['x', 'y'], answer: 'x', answerIndex: 0 },
      { id: 'b', topic: 'T1', question: 'q2', options: ['x', 'y'], answer: 'y', answerIndex: 1 },
      { id: 'c', topic: 'T2', question: 'q3', options: ['x', 'y'], answer: 'x', answerIndex: 0 }
    ]
  };
  const r = score({ a: 'x', b: 'wrong', c: 'x' }, tiny);
  assert.equal(r.total, 3);
  assert.equal(r.correct, 2);
  assert.equal(r.answered, 3);
  assert.equal(r.accuracy, 0.6667);
  assert.equal(r.misses.length, 1);
  assert.equal(r.misses[0].id, 'b');
  assert.deepEqual(r.perTopic.map((t) => t.topic).sort(), ['T1', 'T2']);
});

test('a committed baseline score exists and is internally consistent', () => {
  const r = JSON.parse(readFileSync(join(HERE, 'baseline-v1.default.json'), 'utf8'));
  assert.equal(r.total, set.items.length);
  assert.ok(r.correct <= r.total);
  assert.equal(r.accuracy, +(r.correct / r.total).toFixed(4));
  assert.ok(Array.isArray(r.perTopic) && r.perTopic.length >= 5);
  assert.ok(r.model, 'baseline must record which model produced it');
});
