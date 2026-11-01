/* F1.4 — JSON output / the structured envelope reaches the caller.
 *
 * response-validator.js has built a structured envelope since M5:
 *   { version, type, message, insights, recommendations, actions, confidence }
 * and the chat route put it on both the JSON body and the `done` event.
 *
 * Two gaps meant a caller could not actually get it:
 *   1. a GUIDANCE reply (the OTP/password policy text) had no `structured` at
 *      all — it was hand-built prose while every other reply carried one;
 *   2. the CLIENT parsed the `done` event, read the envelope, and dropped it, so
 *      every UI caller saw prose and nothing else.
 *
 * These tests hold the property: whichever path answers, the envelope is there,
 * it is built by ONE builder, and the client hands it back to its caller.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { agentChat, __test } from '../../ai-agent.js';
import { TYPE, RESPONSE_VALIDATION_VERSION, buildEnvelope } from '../../response-validator.js';

const client = readFileSync(new URL('../../ai-agent-chat.js', import.meta.url), 'utf8');

/* A request that takes the guidance path: an OTP topic is refused with a policy
   statement instead of being sent to a model. */
const guidanceBody = () => ({
  messages: [{ role: 'user', content: 'আমার Telegram OTP কোডটা কী?' }],
  stream: false
});
const req = (body) => new Request('https://w/api/ai/chat', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'x-sky-uid': 'account-1' },
  body: JSON.stringify(body)
});

test('a guidance reply carries the structured envelope, not just prose', async () => {
  const res = await agentChat(req(guidanceBody()), {}, 'account-1', { stream: false });
  const body = await res.json();
  assert.ok(body.structured, 'guidance must carry a structured envelope');
  assert.equal(body.structured.type, TYPE.GUIDANCE);
  assert.equal(body.structured.version, RESPONSE_VALIDATION_VERSION);
  assert.equal(typeof body.structured.message, 'string');
  assert.equal(Array.isArray(body.structured.actions), true);
  assert.equal(typeof body.structured.confidence, 'number');
});

test('the guidance envelope is built by the one builder, so it cannot drift', async () => {
  /* Not "it looks right" — it must equal what buildEnvelope produces for the
     same text, or a second hand-made envelope has crept back in. */
  const res = await agentChat(req(guidanceBody()), {}, 'account-1', { stream: false });
  const body = await res.json();
  const expected = buildEnvelope(body.text, { blocked: true });
  assert.deepEqual(body.structured, expected, 'the envelope must come from buildEnvelope');
});

test('a guidance reply is not rewritten by its own envelope', async () => {
  /* The guidance text is the system's own policy statement. Scanning it as if it
     were model output could replace a correct instruction with a violation
     notice, so the text must survive verbatim. */
  const res = await agentChat(req(guidanceBody()), {}, 'account-1', { stream: false });
  const body = await res.json();
  assert.ok(body.text.includes('OTP'), 'the real instruction must be sent: ' + body.text.slice(0, 60));
  assert.equal(body.structured.message, body.text, 'the envelope must carry the same text, not a notice');
});

test('the client keeps the envelope instead of throwing it away', () => {
  /* The gap this file exists for. The client used to read `j.structured` and
     drop it; every caller then saw prose only. */
  assert.ok(/structured/.test(client), 'the client must handle the field at all');
  assert.ok(/structured = j\.structured/.test(client), 'it must store the envelope from the done event');
  assert.ok(/reqId, structured[,}]/.test(client), 'and return it to its caller');
});

test('the envelope stays optional, so an older server changes nothing', () => {
  /* A pre-F1.4 server sends no `structured` on done. The client must not invent
     one or fail — it returns null and every existing caller behaves as before. */
  assert.ok(/j\.structured && typeof j\.structured === 'object'/.test(client),
    'the field must be read defensively');
  assert.ok(/structured = null/.test(client), 'and default to null, not undefined-shaped garbage');
});

test('every answer path reports the same envelope version', async () => {
  /* One version string across guidance and model answers — a caller reading
     `version` must not have to special-case which path answered. */
  const res = await agentChat(req(guidanceBody()), {}, 'account-1', { stream: false });
  const body = await res.json();
  assert.match(body.structured.version, /^rv-v\d+$/);
  assert.equal(body.structured.version, RESPONSE_VALIDATION_VERSION);
});
