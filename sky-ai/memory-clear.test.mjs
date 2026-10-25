import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { handleMemoryClear } from './memory-clear.mjs';
import { handle, SKY_AI_VERSION } from './worker.mjs';
import { clearAiEverything } from '../ai-agent.js';
import { MEMORY_VERSION } from '../memory-engine.js';

// F0.1 step 4f. The first moved route that DESTROYS data, so these tests are
// about what must never happen: a "cleared" answer over a half-cleared account,
// a guest being told their memory is gone, one key quietly left behind, or the
// two sides disagreeing about what "forget" means.

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

const call = (extra = {}) => new Request('https://sky-ai.example/api/ai/memory/clear', {
  method: 'POST',
  headers: headers(extra)
});

/* A Durable Object binding that just counts what it was asked, so a test can
 * prove the conversation store is emptied through the SAME object admission-gk
 * uses (the cross-script binding) and not a second, empty one. */
const fakeAiState = () => {
  const calls = [];
  const names = [];
  return {
    calls,
    names,
    idFromName: (n) => { names.push(n); return { toString: () => 'id:' + n }; },
    get: () => ({
      fetch: async (req) => {
        const body = await req.clone().json().catch(() => ({}));
        calls.push({ path: new URL(req.url).pathname, uid: body.uid, keys: body.keys });
        return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
      }
    })
  };
};

const seeded = () => ({
  [KV_KEY]: 'K',
  'aiprefs:account-1': '{"tone":"easy"}',
  'aiinstr:account-1': '{"text":"সহজ ভাষায়","ts":1,"v":"instr-v1"}',
  'actaudit:account-1': '[]',
  'actprop:account-1': '{}',
  'chatmem:account-1': '[]',
  'chatmemsum:account-1': '{}',
  ['mem:' + MEMORY_VERSION + ':account-1']: '{}',
  // Someone else's data, which must survive untouched.
  'aiprefs:account-2': '{"tone":"strict"}',
  'chatmem:account-2': '[]'
});

test('trust is required before anything is deleted', async () => {
  const env = { PUB_KV: kvStore(seeded()) };
  const before = { ...env.PUB_KV.bag };
  assert.equal(await handleMemoryClear(call({ 'x-sky-ai-caller': 'nobody' }), env), null);
  assert.equal(await handleMemoryClear(call({ 'x-sky-internal': 'wrong' }), env), null);
  assert.equal(await handleMemoryClear(call({ 'x-sky-uid': '' }), env), null);
  assert.equal(await handleMemoryClear(new Request('https://x/api/ai/memory/clear', { method: 'GET', headers: headers() }), env), null);
  assert.deepEqual(env.PUB_KV.bag, before, 'a call that failed the trust gate deleted nothing');
});

test('every key that "forget" covers is gone, and nobody else\u2019s is touched', async () => {
  const env = { PUB_KV: kvStore(seeded()), AI_STATE: fakeAiState() };
  const res = await handleMemoryClear(call(), env);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.message, 'তোমার AI মেমরি মুছে ফেলা হয়েছে।');

  for (const k of ['aiprefs:account-1', 'aiinstr:account-1', 'actaudit:account-1', 'actprop:account-1', 'chatmem:account-1', 'chatmemsum:account-1', 'mem:' + MEMORY_VERSION + ':account-1']) {
    assert.equal(env.PUB_KV.bag[k], undefined, `${k} was deleted`);
  }
  assert.equal(env.PUB_KV.bag['aiprefs:account-2'], '{"tone":"strict"}', 'another account kept its prefs');
  assert.equal(env.PUB_KV.bag['chatmem:account-2'], '[]', 'another account kept its conversation');
  assert.equal(env.PUB_KV.bag[KV_KEY], 'K', 'the internal key itself is not a student key');
});

test('the conversation store is emptied through the shared object, not a second one', async () => {
  const ai = fakeAiState();
  const env = { PUB_KV: kvStore(seeded()), AI_STATE: ai };
  await handleMemoryClear(call(), env);
  assert.equal(ai.calls.length, 1, 'exactly one object was contacted');
  assert.deepEqual(ai.names, ['account-1'], 'the object addressed is this student\'s own');
  assert.equal(ai.calls[0].path, '/state/delete');
  assert.deepEqual(ai.calls[0].keys.sort(), ['chatmem:account-1', 'chatmemsum:account-1', 'mem:' + MEMORY_VERSION + ':account-1'].sort());
});

test('clearing twice is the same as clearing once', async () => {
  const env = { PUB_KV: kvStore(seeded()), AI_STATE: fakeAiState() };
  const first = await (await handleMemoryClear(call(), env)).json();
  const second = await (await handleMemoryClear(call(), env)).json();
  assert.deepEqual(second, first, 'the second answer is identical, so a fallback retry is invisible');
  assert.equal(env.PUB_KV.bag['aiprefs:account-1'], undefined);
});

test('a guest uid is refused, and nothing is deleted', async () => {
  const env = { PUB_KV: kvStore(seeded()), AI_STATE: fakeAiState() };
  const res = await handleMemoryClear(call({ 'x-sky-uid': 'guest-abc' }), env);
  assert.equal(res.status, 500, 'not a cheerful success');
  assert.equal((await res.json()).error, 'clear_failed');
  assert.equal(env.PUB_KV.bag['aiprefs:account-1'], '{"tone":"easy"}', 'nothing was cleared');
});

test('a storage failure is reported as a failure, never as "cleared"', async () => {
  const kv = kvStore(seeded());
  kv.delete = async () => { throw new Error('kv down'); };
  const env = { PUB_KV: kv, AI_STATE: fakeAiState() };
  const res = await handleMemoryClear(call(), env);
  assert.equal(res.status, 500);
  assert.equal((await res.json()).error, 'clear_failed');
});

test('the two sides delete exactly the same keys', async () => {
  // What "forget" means must not fork. Both paths call clearAiEverything(), and
  // this drives them independently to prove the resulting key sets match.
  const a = { PUB_KV: kvStore(seeded()), AI_STATE: fakeAiState() };
  const b = { PUB_KV: kvStore(seeded()), AI_STATE: fakeAiState() };
  await clearAiEverything(a, 'account-1');
  await handleMemoryClear(call(), b);
  const keysOf = (env) => Object.keys(env.PUB_KV.bag).filter((k) => k !== KV_KEY).sort();
  assert.deepEqual(keysOf(b), keysOf(a));
});

test('worker serves it and marks the answer', async () => {
  const env = { PUB_KV: kvStore(seeded()), AI_STATE: fakeAiState() };
  const res = await handle(call(), env);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('x-sky-ai-route'), 'memory-clear');
  const wrongMethod = await handle(new Request('https://sky-ai.example/api/ai/memory/clear', { method: 'GET', headers: headers() }), env);
  assert.equal(wrongMethod.status, 404, 'GET is not this route');
});

test('admission-gk forwards, and still keeps its own clear as the fallback', () => {
  const src = readFileSync(new URL('../public-worker.js', import.meta.url), 'utf8');
  const at = src.indexOf("path === '/api/ai/memory/clear'");
  const block = src.slice(at, at + 1600);
  assert.match(block, /const viaSky = await forwardWithIdentityBody\(request, env, identity\.uid\);/);
  assert.match(block, /if \(viaSky\) return viaSky;/);
  assert.match(block, /await clearAiEverything\(env, identity\.uid\);/);
  assert.ok(block.indexOf('viaSky') < block.indexOf('clearAiEverything(env'), 'the forward is attempted first');
  // The four inline deletes are gone from here; a second copy is exactly the
  // drift this refactor removed.
  assert.equal(src.includes("PUB_KV.delete('aiprefs:'"), false, 'the key list lives in one place only');
});

test('version says which routes this build serves', () => {
  // Moves with every added route; what matters is that it names a step, not the
  // exact letter, or every later step would have to edit this file.
  assert.match(SKY_AI_VERSION, /^sky-ai-f0\.1-4[a-z]/);
});
