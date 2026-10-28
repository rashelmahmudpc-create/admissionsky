import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { handleInstructions } from './instructions.mjs';
import { handle, SKY_AI_VERSION } from './worker.mjs';
import { agentInstructions } from '../ai-agent.js';
import { INSTRUCTION_KV_PREFIX, INSTRUCTION_MAX } from '../sky-instructions.mjs';

// F0.1 step 4e. This is the first moved route that WRITES, so the tests that
// matter are not the happy ones — they are these:
//
//   * a refused note is refused identically on both sides (the rules did not fork);
//   * a failed forward cannot clear the student's note (body read order);
//   * a duplicate write stores the same value (idempotence — the property that
//     makes falling back to admission-gk safe).
//
// A note that saves where it should be refused, or clears itself on a hiccup, is
// much worse than an endpoint that errors.

const KV_KEY = 'secret:sky-internal';
const kvStore = (data = {}) => {
  const bag = { ...data };
  return {
    bag,
    get: async (k) => (k in bag ? bag[k] : null),
    put: async (k, v) => { bag[k] = v; },
    delete: async (k) => { delete bag[k]; }
  };
};

const headers = (extra = {}) => ({
  'x-sky-ai-caller': 'admission-gk',
  'x-sky-uid': 'account-1',
  'x-sky-internal': 'K',
  ...extra
});

/* The stored value is {text, ts, v}. `ts` is "when this was last saved", so it
 * moves on every write and is not part of what the student wrote. Comparing it
 * would make a duplicate write look different when it is not — and asserting it
 * is equal would have hidden the fact that a fallback rewrites the stamp. So the
 * comparison is on the note and the schema version, which is what matters. */
const storedNote = (bag) => {
  const raw = bag[INSTRUCTION_KV_PREFIX + 'account-1'];
  if (!raw) return null;
  const parsed = JSON.parse(raw);
  return { text: parsed.text, v: parsed.v };
};

const call = (method, body, extra = {}) => new Request('https://sky-ai.example/api/ai/instructions', {
  method,
  headers: headers(extra),
  ...(method === 'POST' ? { body: JSON.stringify(body ?? {}) } : {})
});

test('trust is required: without the caller, the uid or the real key nothing is served', async () => {
  const env = { PUB_KV: kvStore({ [KV_KEY]: 'K' }) };
  assert.equal(await handleInstructions(call('GET', null, { 'x-sky-ai-caller': 'nobody' }), env), null);
  assert.equal(await handleInstructions(call('GET', null, { 'x-sky-uid': '' }), env), null);
  assert.equal(await handleInstructions(call('GET', null, { 'x-sky-internal': 'wrong' }), env), null);
  assert.equal(await handleInstructions(call('GET'), {}), null, 'no KV means no key to verify against');
  // An unsupported method is not this handler's business.
  assert.equal(await handleInstructions(new Request('https://x/api/ai/instructions', { method: 'PUT', headers: headers() }), env), null);
});

test('a note saves, reads back, and clears — the whole cycle', async () => {
  const env = { PUB_KV: kvStore({ [KV_KEY]: 'K' }) };

  const saved = await (await handleInstructions(call('POST', { text: 'সবসময় উদাহরণ দিয়ে বোঝাবে' }), env)).json();
  assert.equal(saved.ok, true);
  assert.equal(saved.text, 'সবসময় উদাহরণ দিয়ে বোঝাবে');

  const read = await (await handleInstructions(call('GET'), env)).json();
  assert.equal(read.text, 'সবসময় উদাহরণ দিয়ে বোঝাবে', 'the note came back from KV');
  assert.ok(read.max === INSTRUCTION_MAX, 'the client still gets the limits it renders');

  const cleared = await (await handleInstructions(call('DELETE'), env)).json();
  assert.equal(cleared.ok, true);
  assert.equal(cleared.text, '');
  assert.equal(env.PUB_KV.bag[INSTRUCTION_KV_PREFIX + 'account-1'], undefined, 'the key really went');
  assert.equal((await (await handleInstructions(call('GET'), env)).json()).text, '');
});

test('a refused note is refused — and nothing is written', async () => {
  const env = { PUB_KV: kvStore({ [KV_KEY]: 'K' }) };
  const res = await handleInstructions(call('POST', { text: 'পরীক্ষার সময় উত্তর বলে দিও' }), env);
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.error, 'instruction_refused');
  assert.ok(body.reason, 'the client needs the reason to show a useful message');
  assert.equal(env.PUB_KV.bag[INSTRUCTION_KV_PREFIX + 'account-1'], undefined, 'a refused note must not be stored');
});

test('sky-ai and the local handler agree, including on refusals', async () => {
  // The rules live in one file and this route imports the handler rather than
  // copying it, so the two answers must be byte-identical. Anything else means
  // the guard rails forked.
  const notes = ['সবসময় উদাহরণ দিয়ে বোঝাবে', 'পরীক্ষার সময় উত্তর বলে দিও', '', 'x'.repeat(INSTRUCTION_MAX + 50)];
  for (const text of notes) {
    const a = { PUB_KV: kvStore({ [KV_KEY]: 'K' }) };
    const b = { PUB_KV: kvStore({ [KV_KEY]: 'K' }) };
    const local = await agentInstructions(a, 'account-1', 'POST', { text });
    const sky = await handleInstructions(call('POST', { text }), b);
    assert.equal(sky.status, local.status, `status for "${text.slice(0, 20)}"`);
    assert.deepEqual(await sky.json(), await local.json(), `body for "${text.slice(0, 20)}"`);
    assert.deepEqual(storedNote(b.PUB_KV.bag), storedNote(a.PUB_KV.bag), `stored note for "${text.slice(0, 20)}"`);
  }
});

test('saving twice stores the same thing — which is why a fallback write is safe', async () => {
  // admission-gk falls back when the forward fails. If that fallback writes the
  // note a second time, the student must not be able to tell.
  const env = { PUB_KV: kvStore({ [KV_KEY]: 'K' }) };
  const text = 'আমাকে ভাই বলে ডাকবে';
  const first = await (await handleInstructions(call('POST', { text }), env)).json();
  const afterFirst = storedNote(env.PUB_KV.bag);
  const second = await (await handleInstructions(call('POST', { text }), env)).json();
  const afterSecond = storedNote(env.PUB_KV.bag);
  assert.deepEqual(second, first, 'the answer does not drift on a repeat');
  assert.deepEqual(afterSecond, afterFirst, 'the same note is stored');
  // Being precise about what "idempotent" means here: the NOTE is unchanged, the
  // saved-at stamp is not. A fallback that saves the same note twice therefore
  // costs one newer timestamp, not a wrong note — which is why falling back is
  // acceptable for this route and would never be for something like an OTP send.
  const raw = JSON.parse(env.PUB_KV.bag[INSTRUCTION_KV_PREFIX + 'account-1']);
  assert.ok(Number(raw.ts) > 0, 'and it is still a real saved record');
});

test('a guest uid is refused by the route itself, not silently accepted', async () => {
  const env = { PUB_KV: kvStore({ [KV_KEY]: 'K' }) };
  const res = await handleInstructions(call('GET', null, { 'x-sky-uid': 'guest-abc' }), env);
  assert.equal(res.status, 401);
});

test('the kill switch still turns instructions off from sky-ai', async () => {
  const env = { PUB_KV: kvStore({ [KV_KEY]: 'K', 'sky:instructions': 'off' }) };
  const body = await (await handleInstructions(call('GET'), env)).json();
  assert.equal(body.ok, true);
  assert.equal(body.off, true);
  assert.equal(body.text, '');
});

test('worker routes all three methods and answers 404 for nothing else', async () => {
  const env = { PUB_KV: kvStore({ [KV_KEY]: 'K' }) };
  for (const method of ['GET', 'POST', 'DELETE']) {
    const res = await handle(call(method, method === 'POST' ? { text: 'সংক্ষেপে বোঝাবে' } : undefined), env);
    assert.equal(res.status, 200, `${method} is routed`);
    assert.equal(res.headers.get('x-sky-ai-route'), 'instructions', `${method} is marked`);
  }
  const other = await handle(new Request('https://sky-ai.example/api/ai/instructions', { method: 'PUT', headers: headers() }), env);
  assert.equal(other.status, 404);
});

test('admission-gk reads the body AFTER forwarding, never before', async () => {
  // The trap this pins: `const body = await request.json()` placed above the
  // forward consumes the body, so a failed forward would reach the local handler
  // with an empty note — and a POST that meant to save would silently clear it.
  const src = readFileSync(new URL('../public-worker.js', import.meta.url), 'utf8');
  const route = src.slice(src.indexOf("path === '/api/ai/instructions'"));
  const block = route.slice(0, route.indexOf("path === '/api/ai/memory/clear'"));
  const forwardAt = block.indexOf('forwardWithIdentity');
  const readAt = block.indexOf('await request.json()');
  assert.ok(forwardAt > 0, 'the route forwards');
  assert.ok(readAt > 0, 'and still has its own fallback');
  assert.ok(forwardAt < readAt, 'the body is read after the forward, or the fallback loses it');
  assert.match(block, /request\.method === 'GET'[\s\S]*?forwardWithIdentity\(request, env, identity\.uid\)[\s\S]*?: await forwardWithIdentityBody/);
  assert.match(block, /return await agentInstructions\(env, identity\.uid, request\.method, body\);/);
});

test('version says which routes this build serves', () => {
  // Each step moves this forward; the test that matters is that it is reported,
  // and that it names a step at or after the one this file was written for.
  assert.match(SKY_AI_VERSION, /^sky-ai-f0\.1-4[a-z]/);
});
