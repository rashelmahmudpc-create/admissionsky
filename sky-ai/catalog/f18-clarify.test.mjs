/* F1.8 — Clarify: a message with nothing in it gets a question, not a guess.
 *
 * A message of only punctuation ("?", "...", "।") passed validation — it is
 * non-empty after trim, so not `empty_messages`, and short, so not
 * `message_too_long`. It then went down the whole chat path: classified as
 * GENERAL_CHAT, sent to a model, charged a real daily credit, and the model,
 * with no subject to answer, invented one.
 *
 * These tests hold the property: a message with no letter or digit is answered
 * with a short question back and costs the student nothing, while anything with
 * real content is untouched, and a genuinely empty message is still rejected
 * rather than clarified.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { needsClarification, clarifyMessage, classifyIntent } from '../../ai-agent.js';

const src = readFileSync(new URL('../../ai-agent.js', import.meta.url), 'utf8');

test('a punctuation-only message is clarified, not answered', () => {
  /* The regression this file exists for. */
  for (const t of ['?', '...', '।', '!!!', '   ?  ', '—']) {
    assert.equal(needsClarification(t), true, JSON.stringify(t) + ' carries no content');
  }
});

test('real content in any script is left alone', () => {
  /* Bengali, Latin and digits must all pass through untouched, or this becomes
     a filter that swallows real questions. */
  for (const t of ['২৫×৪ কত', 'বাংলা', 'a', '?a', 'কি?', '123']) {
    assert.equal(needsClarification(t), false, JSON.stringify(t) + ' has content');
  }
});

test('an emoji is not a question', () => {
  assert.equal(needsClarification('😀'), true);
});

test('an empty message is not "clarified" — it is rejected earlier', () => {
  /* The distinction matters: empty is a malformed request (400), content-free
     punctuation is a real message that needs a better question. If empty were
     clarified here, the validator's empty_messages path would be shadowed. */
  assert.equal(needsClarification(''), false);
  assert.equal(needsClarification('   '), false);
  assert.equal(needsClarification(null), false);
});

test('the clarification is a real question back, in Bengali', () => {
  const m = clarifyMessage();
  assert.ok(/[?？]$/.test(m.trim()), 'it must ask something: ' + m);
  assert.ok(/[\u0980-\u09FF]/.test(m), 'the student reads Bengali');
});

test('clarify runs before the model call and before the daily cap', () => {
  /* Order is the whole point: clarifying after the quota check would still cost
     the student a credit, and after the chain would still cost a model call. */
  const gate = src.indexOf('needsClarification(toolText)');
  const cap = src.indexOf('rate limit: প্রতি-user rolling 24h window');
  const chain = src.indexOf('if (!chain.length && hasImage)');
  assert.ok(gate > 0, 'the gate is wired into the handler');
  assert.ok(cap > 0 && chain > 0);
  assert.ok(gate < cap, 'clarify must come before the quota check');
  assert.ok(gate < chain, 'clarify must come before any provider is used');
});

test('the classifier is untouched — clarify is a handler gate, not a new intent', () => {
  /* Adding an intent would change routing accuracy and every intent consumer.
     This is deliberately a pre-classification gate instead. */
  assert.equal(classifyIntent('?').intent, 'GENERAL_CHAT');
});
