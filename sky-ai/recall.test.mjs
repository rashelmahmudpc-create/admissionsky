import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { handleRecallPost } from './recall.mjs';
import { handle, SKY_AI_VERSION } from './worker.mjs';
import { agentRecall } from '../ai-agent.js';
import { aiStateStore } from '../ai-state-do.mjs';
import { MEMORY_VERSION } from '../memory-engine.js';

/* Derived, never typed: the key was 'mem:v1:...' in a first draft of this test
 * and every assertion passed for the wrong reason, because nothing was ever
 * found. A fixture that cannot match the real key is a fixture that tests
 * nothing. */
const MEM_KEY = 'mem:' + MEMORY_VERSION + ':account-1';

// F0.1 step 4d. Recall is the first /api/ai route to move into sky-ai, and the
// first that carries a request body. Two failure modes matter more than the
// happy path:
//
//   1. a student's reminder silently disappears because the memory store moved
//      (AI_STATE is bound cross-script — same trap F-04 hit with AUTH_AUTHORITY);
//   2. a request body is lost on the hop, so recall answers as if the client
//      sent nothing.
//
// Everything here is the same input through both paths, asserting the answers
// are identical.

const KV_KEY = 'secret:sky-internal';
const kv = (data) => ({ get: async (k) => (k in data ? data[k] : null) });

const headers = (extra = {}) => ({
  'x-sky-ai-caller': 'admission-gk',
  'x-sky-uid': 'account-1',
  'x-sky-internal': 'K',
  ...extra
});

const postRecall = (body, extra = {}) => new Request('https://sky-ai.example/api/ai/recall', {
  method: 'POST',
  headers: headers(extra),
  body: JSON.stringify(body)
});

/* A fake AI_STATE namespace that behaves like the real binding: get(id) returns
 * a stub whose fetch answers /state/get. */
const stateNamespace = (bag, { fail = false } = {}) => ({
  idFromName: (n) => n,
  get: () => ({
    fetch: async (request) => {
      if (fail) throw new Error('binding down');
      const url = new URL(request.url);
      if (url.pathname !== '/state/get') return Response.json({ ok: false }, { status: 400 });
      const { key } = await request.json();
      const idKey = Object.keys(bag).find(k => bag[k]?.[key] !== undefined);
      return Response.json({ ok: true, value: bag.__all?.[key] ?? null });
    }
  })
});

test('trust is required: no caller header, no uid, no key, wrong key -> null (fallback)', async () => {
  const env = { PUB_KV: kv({ [KV_KEY]: 'K' }) };
  const body = JSON.stringify({ stats: {} });
  assert.equal(await handleRecallPost(new Request('https://x/api/ai/recall', { method: 'POST', body }), env), null);
  assert.equal(await handleRecallPost(postRecall({}, { 'x-sky-ai-caller': 'nobody' }), env), null);
  assert.equal(await handleRecallPost(postRecall({}, { 'x-sky-uid': '' }), env), null);
  assert.equal(await handleRecallPost(postRecall({}, { 'x-sky-internal': 'wrong' }), env), null);
  // No KV at all: nothing to verify the key against, so nothing is served.
  assert.equal(await handleRecallPost(postRecall({}), {}), null);
});

test('a trusted call answers with the route marker and the real body', async () => {
  const env = { PUB_KV: kv({ [KV_KEY]: 'K' }) };
  const res = await handleRecallPost(postRecall({ stats: {}, recent: [] }), env);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('x-sky-ai-route'), 'recall');
  assert.equal(res.headers.get('cache-control'), 'no-store');
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.ok('recall' in body, 'the shape the client already reads');
});

test('sky-ai and the local handler produce the SAME answer for the SAME input', async () => {
  // The whole point of the move: a student must not be able to tell which script
  // answered. Same env, same body, both paths.
  const stored = JSON.stringify([{
    kind: 'weak-topic', key: 'গণিত', value: 'ভগ্নাংশ', reason: 'পরীক্ষায় বারবার ভুল',
    source: 'exam', confidence: 0.8, ts: Date.now() - 3600_000, ownerUid: 'account-1'
  }]);
  const env = {
    PUB_KV: kv({ [KV_KEY]: 'K', [MEM_KEY]: stored }),
    AI_STATE: stateNamespace({ __all: { [MEM_KEY]: stored } })
  };
  // A reminder needs something to say: two wrong answers in the last two days.
  const body = { stats: {}, recent: { mistakes: 2, since: Date.now() - 3600_000 } };
  const local = await agentRecall(env, 'account-1', body);
  const sky = await handleRecallPost(postRecall(body), env);
  const localBody = await local.json();
  const skyBody = await sky.json();
  // If both were null this test would pass and prove nothing, so first insist
  // that there is an answer to compare.
  assert.ok(localBody.recall, 'the fixture really produces a reminder');
  assert.deepEqual(skyBody, localBody);
});

test('the AI_STATE binding is what keeps recall working — KV alone is the fallback', async () => {
  // If the cross-script binding is missing, agentRecall falls back to KV and the
  // answer quietly changes. That is precisely why /health reports it: this test
  // documents the silent failure so nobody has to rediscover it.
  // The only place this student's weak topic is written: the Durable Object.
  // Nothing in KV. So the reminder exists if and only if the binding really works.
  const stored = JSON.stringify([{
    kind: 'studies', key: 'weak-topic', value: 'রসায়ন', reason: 'নিজেই বলেছে দুর্বল',
    source: 'user_stated', confidence: 0.9, ts: Date.now() - 60_000, ownerUid: 'account-1'
  }]);
  const withDo = { PUB_KV: kv({ [KV_KEY]: 'K' }), AI_STATE: stateNamespace({ __all: { [MEM_KEY]: stored } }) };
  const withoutDo = { PUB_KV: kv({ [KV_KEY]: 'K' }) };
  // Nothing else to go on: no measured weak topic, no recent mistakes, no goal.
  // Every remaining source of a reminder is that one stored memory.
  const body = { stats: {}, recent: {} };
  const a = await (await agentRecall(withDo, 'account-1', body)).json();
  const b = await (await agentRecall(withoutDo, 'account-1', body)).json();
  assert.ok(a.recall, 'with the store bound the reminder exists');
  assert.ok(String(a.recall.line || '').includes('রসায়ন'), 'and it names the topic from stored memory');
  assert.deepEqual(a.recall.kinds, ['weak-stated'], 'sourced from memory, not from a submitted stat');
  assert.equal(b.recall, null, 'without it the reminder vanishes — never let this ship silently');
});

test('a non-account uid gets an empty recall, exactly like today', async () => {
  const env = { PUB_KV: kv({ [KV_KEY]: 'K' }) };
  const res = await handleRecallPost(postRecall({}, { 'x-sky-uid': 'guest-abc' }), env);
  assert.deepEqual(await res.json(), { ok: true, recall: null });
});

test('the kill switch still works from sky-ai', async () => {
  const env = { PUB_KV: kv({ [KV_KEY]: 'K', 'sky:recall': 'off' }) };
  const body = await (await handleRecallPost(postRecall({}), env)).json();
  assert.equal(body.recall, null);
  assert.equal(body.off, true);
});

test('worker routes POST /api/ai/recall and leaves other methods alone', async () => {
  const env = { PUB_KV: kv({ [KV_KEY]: 'K' }) };
  const ok = await handle(postRecall({}), env);
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get('x-sky-ai-route'), 'recall');
  // GET on the same path is not a route here; the local handler owns it.
  const wrong = await handle(new Request('https://sky-ai.example/api/ai/recall', { headers: headers() }), env);
  assert.equal(wrong.status, 404);
  assert.equal((await wrong.json()).error, 'not-implemented-in-sky-ai');
});

test('health reports the memory binding, and does not invent a healthy answer', async () => {
  const bound = await (await handle(new Request('https://sky-ai.example/health'), { PUB_KV: kv({}), AI_STATE: stateNamespace({}) })).json();
  assert.equal(bound.deps.aiState, 'ok');
  assert.equal(bound.deps.kv, true);

  const missing = await (await handle(new Request('https://sky-ai.example/health'), { PUB_KV: kv({}) })).json();
  assert.equal(missing.deps.aiState, 'missing');

  const broken = await (await handle(new Request('https://sky-ai.example/health'), { AI_STATE: stateNamespace({}, { fail: true }) })).json();
  assert.equal(broken.deps.aiState, 'error');

  // The version moves with every route that is added here; the assertion that
  // matters is that it is reported at all, not its exact spelling.
  assert.match(SKY_AI_VERSION, /^sky-ai-f0\.1-4[a-z]/);
});

test('the deployed config really binds the SAME object, not a new one', async () => {
  const toml = readFileSync(new URL('./wrangler.toml', import.meta.url), 'utf8');
  assert.match(toml, /\[\[durable_objects\.bindings\]\]\nname = "AI_STATE"\nclass_name = "AiStateObject"\nscript_name = "admission-gk"/);
  // A migrations block here would declare a second store. Checked at line start,
  // because the comment above the binding mentions the words on purpose.
  assert.equal(/^\[\[migrations\]\]/m.test(toml), false, 'sky-ai must never migrate or redeclare AiStateObject');
  // And the declaring script really exports the class, or the binding 404s.
  const declaring = readFileSync(new URL('../gk-agent-worker.js', import.meta.url), 'utf8');
  assert.match(declaring, /export \{ AiStateObject \} from '\.\/ai-state-do\.mjs'/);
  assert.ok(aiStateStore({ AI_STATE: stateNamespace({}) }), 'the helper this Worker calls');
});
