import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { handleChat } from './chat.mjs';
import { handle, SKY_AI_VERSION } from './worker.mjs';
import { providerReadiness, readyProviderNames } from '../ai-agent.js';

// F0.1 step 4h. The chat route is the only one a student feels directly, and the
// only one that needs CREDENTIALS rather than just code. The tests are ordered by
// what would hurt most:
//
//   1. a partial key set answering anyway — slower, worse replies and no error
//      anywhere, which is worse than an outage because an outage gets noticed;
//   2. a second charge to the student's daily allowance when an answer is retried;
//   3. the answer-stream being buffered or the SSE shape being broken;
//   4. the two rooms disagreeing about the settings that shape an answer.

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
  'x-sky-need-providers': 'gemini',
  ...extra
});
const chatReq = (extra = {}, path = '/api/ai/chat', body = { messages: [{ role: 'user', content: 'hi' }] }) =>
  new Request('https://sky-ai.example' + path, {
    method: 'POST',
    headers: headers(extra),
    body: JSON.stringify(body)
  });

/* Keys are read through public-key names on env (pickKey prefers env), so a
 * readiness test does not need the KV overlay at all. */
const envWithKeys = (over = {}) => ({ PUB_KV: kvStore({ [KV_KEY]: 'K' }), ...over });

test('trust is required before a single token is spent', async () => {
  const env = envWithKeys({ GEMINI_KEYS: 'sk-test' });
  for (const extra of [{ 'x-sky-ai-caller': 'nobody' }, { 'x-sky-internal': 'wrong' }, { 'x-sky-uid': '' }]) {
    assert.equal(await handleChat(chatReq(extra), env), null, JSON.stringify(extra));
  }
  assert.equal(await handleChat(chatReq(), {}), null, 'no KV means no key to verify against');
});

test('a missing provider makes the route decline instead of answering worse', async () => {
  // This is the whole point: admission-gk can reach gemini AND groq, this room
  // has only groq. Answering would give a free-model reply with no error
  // anywhere. Declining sends the student to the code that runs today.
  const env = envWithKeys({ GROQ_API_KEY: 'gsk-test' });
  assert.equal(await handleChat(chatReq({ 'x-sky-need-providers': 'gemini,groq' }), env), null);
  // And with everything present it does NOT decline.
  const full = envWithKeys({ GROQ_API_KEY: 'gsk-test', GEMINI_KEYS: 'sk-test' });
  const res = await handle(chatReq({ 'x-sky-need-providers': 'gemini,groq' }, '/api/ai/chat', { messages: [] }), full);
  assert.notEqual(res.status, 404, 'a complete key set is not a decline');
});

test('no expected providers means nothing to gain, so it declines', async () => {
  const env = envWithKeys({ GEMINI_KEYS: 'sk-test' });
  assert.equal(await handleChat(chatReq({ 'x-sky-need-providers': '' }), env), null);
  assert.equal(await handleChat(chatReq({ 'x-sky-need-providers': '' }, '/api/ai'), env), null);
});

test('readiness reports names only — no key, no length, no prefix', async () => {
  const env = envWithKeys({ GEMINI_KEYS: 'SECRET-A,SECRET-B', GROQ_API_KEY: 'gsk-SECRET' });
  const ready = await providerReadiness(env);
  const names = readyProviderNames(ready);
  assert.deepEqual(names, ['gemini', 'groq']);
  const printed = JSON.stringify(ready) + names.join(',');
  for (const secret of ['SECRET-A', 'SECRET-B', 'gsk-']) assert.equal(printed.includes(secret), false, 'a secret reached the output');
});

test('the stream is passed through, not buffered, and keeps its SSE headers', async () => {
  const env = envWithKeys({});
  const src = readFileSync(new URL('./chat.mjs', import.meta.url), 'utf8');
  const fn = src.slice(src.indexOf('export async function handleChat'));
  /* The wrapper must hand the ORIGINAL body stream to the new Response. Reading it
     into text (await res.text()) or building a JSON response would hold the whole
     answer until the model finished — the student would stare at nothing. */
  assert.match(fn, /new Response\(res\.body, \{ status: res\.status, headers \}\)/);
  assert.equal(/await res\.text\(\)|await res\.json\(\)|\.blob\(\)/.test(fn), false, 'the body must not be consumed');
  // and every header the SSE response carried survives the re-wrap
  assert.match(fn, /const headers = new Headers\(res\.headers\)/);
  assert.match(fn, /headers\.set\('x-sky-ai-route', 'chat'\)/);
  assert.equal(env.PUB_KV.bag[KV_KEY], 'K');
});

test('the request id reaches the quota counter from both sides', () => {
  // A retry that reaches the fallback after sky-ai already counted must replay the
  // same decision. That only works if the SAME id is used on both sides, so both
  // call sites are pinned.
  const worker = readFileSync(new URL('../public-worker.js', import.meta.url), 'utf8');
  const helper = worker.slice(worker.indexOf('const chatWithFallback ='), worker.indexOf('const publishGlobal'));
  /* F0.5 / GW-07: the id is the TURN's, so the caller's id is honoured and one
     is minted only when it is absent. That is what makes a retry replay. */
  assert.match(helper, /normalizeRequestId\(request\.headers\.get\(SKY_REQUEST_ID_HEADER\)\) \|\| mintRequestId\(\)/);
  assert.match(helper, /'x-sky-req-id': reqId/);
  assert.match(helper, /withRequestId\(await agentChat\(request, env, identity\.uid, local\), reqId\)/);
  assert.match(helper, /const local = \{ stream, persistMemory: identity\.persistMemory, reqId \}/);
  /* the id must come back, or it cannot correlate anything */
  assert.match(helper, /headers\.set\(SKY_REQUEST_ID_HEADER, reqId\)/);

  const chat = readFileSync(new URL('./chat.mjs', import.meta.url), 'utf8');
  assert.match(chat, /reqId: request\.headers\.get\('x-sky-req-id'\) \|\| undefined/);

  const agent = readFileSync(new URL('../ai-agent.js', import.meta.url), 'utf8');
  /* F0.5 / GW-07: the quota counter and the trace line now share ONE id, minted
     once at the top of agentChat, so a decision and the log line that explains
     it can be joined. */
  assert.match(agent, /const reqId = normalizeRequestId\(opts && opts\.reqId\) \|\| makeRequestId\(/);
  assert.match(agent, /consumeQuota\(sendCtx\.uid, cap, reqId\)/);
  assert.match(agent, /const rid = reqId;/);
  const doSrc = readFileSync(new URL('../ai-state-do.mjs', import.meta.url), 'utf8');
  /* F0.5 / GW-07: a replay is bounded to a short window, so idempotency cannot
     become a quota bypass (one id answering the same question all day). */
  assert.match(doSrc, /REPLAY_WINDOW_MS/);
  assert.match(doSrc, /replayed: true/);
});

test('the settings that shape an answer cross the hop, so the rooms cannot drift', () => {
  const worker = readFileSync(new URL('../public-worker.js', import.meta.url), 'utf8');
  const helper = worker.slice(worker.indexOf('const chatWithFallback ='));
  for (const name of ['AGENT_DAILY_CAP', 'AGENT_GEMINI_MODELS', 'AGENT_GROQ_MODELS', 'AGENT_CLOUDFLARE_MODELS']) {
    assert.ok(helper.includes(name), `${name} is forwarded`);
  }
  /* Step 4i moved the applying side into parity.mjs, because status needs the
     same handling. The list and the assignment moved together — asserting on the
     file that really owns them is stricter than asserting on a copy. */
  const parity = readFileSync(new URL('./parity.mjs', import.meta.url), 'utf8');
  for (const name of ['AGENT_DAILY_CAP', 'AGENT_GEMINI_MODELS', 'AGENT_GROQ_MODELS', 'AGENT_CLOUDFLARE_MODELS']) {
    assert.ok(parity.includes(name), `${name} is applied`);
  }
  // The daily cap is the one with a real consequence: 10 vs 20 messages a day.
  assert.match(parity, /out\[name\] = sent/);
  const chat = readFileSync(new URL('./chat.mjs', import.meta.url), 'utf8');
  assert.match(chat, /applyEnvPassthrough\(env, request\)/, 'chat applies whatever was sent');
});

test('both chat paths are routed and the non-streaming one asks for JSON', async () => {
  // The room must hold the provider it was told about, or the decline is correct.
  const env = envWithKeys({ GEMINI_KEYS: 'sk-test' });
  for (const path of ['/api/ai/chat', '/api/ai']) {
    const res = await handle(chatReq({}, path, { messages: [] }), env);
    assert.notEqual(res.status, 404, `${path} is routed`);
    assert.equal(res.headers.get('x-sky-ai-route'), 'chat');
  }
  const chat = readFileSync(new URL('./chat.mjs', import.meta.url), 'utf8');
  assert.match(chat, /stream: new URL\(request\.url\)\.pathname !== '\/api\/ai'/);
});

test('a guest never reaches the model call', () => {
  // The signed-in gate stays in admission-gk, where identity is resolved; the uid
  // that arrives here has already been verified. Pinned so it cannot be dropped.
  const worker = readFileSync(new URL('../public-worker.js', import.meta.url), 'utf8');
  const chatRoute = worker.slice(worker.indexOf("path === '/api/ai/chat'"));
  const block = chatRoute.slice(0, chatRoute.indexOf("path === '/api/ai'"));
  assert.match(block, /if \(!identity\.authenticated\) return json\(\{ error: 'sign_in_required'/);
  assert.ok(block.indexOf('sign_in_required') < block.indexOf('chatWithFallback'), 'the gate runs first');
});

test('E2E: the answer really streams back through this Worker', async () => {
  // The parity and quota tests prove the guards. This proves the thing the guards
  // protect: that sky-ai can actually complete a model call and hand the streamed
  // answer back, with the route marker on it. A fake provider response is used and
  // global fetch is restored afterwards, exactly like the provider-adapter suite.
  const env = envWithKeys({ GEMINI_KEYS: 'sk-test' });
  const real = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes('generativelanguage')) {
      return new Response('data: ' + JSON.stringify({ candidates: [{ content: { parts: [{ text: 'উত্তর পাওয়া গেছে' }] }, finishReason: 'STOP' }] }) + '\n\n', {
        status: 200,
        headers: { 'content-type': 'text/event-stream' }
      });
    }
    return new Response('unexpected ' + u, { status: 500 });
  };
  try {
    const res = await handleChat(chatReq({}, '/api/ai/chat', { messages: [{ role: 'user', content: 'বুঝিয়ে বলো' }] }), env);
    assert.ok(res, 'a complete key set means this route answers');
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('x-sky-ai-route'), 'chat');
    assert.match(String(res.headers.get('content-type') || ''), /text\/event-stream/, 'the student reads it as it arrives');
    const text = await res.text();
    assert.ok(text.includes('উত্তর পাওয়া গেছে'), 'the model answer reached the client');
  } finally {
    globalThis.fetch = real;
  }
});

test('version says which routes this build serves', () => {
  // Moves with every added route; the assertion that matters is that a step is
  // named at all, not which letter, or each later step would edit this file.
  assert.match(SKY_AI_VERSION, /^sky-ai-f0\.1-4[a-z]/);
});
