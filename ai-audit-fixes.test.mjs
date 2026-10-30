// AI audit 2026-10-16 — regression tests for the fixes found by the audit.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { agentChat, clearAiMemory, CHAT_MEMORY_TTL_MS } from './ai-agent.js';
import { AiStateObject } from './ai-state-do.mjs';
import { allowedOrigin } from './cors-policy.mjs';

const enc = new TextEncoder();
function memKv() {
  const store = new Map();
  const ttl = new Map();
  return {
    store, ttl,
    get: async (k) => (store.has(k) ? store.get(k) : null),
    put: async (k, v, o) => { store.set(k, String(v)); if (o && o.expirationTtl) ttl.set(k, o.expirationTtl); },
    delete: async (k) => { store.delete(k); },
    list: async () => ({ keys: [] })
  };
}
const sse = (obj) => enc.encode('data: ' + JSON.stringify(obj) + '\n\n');
function installFetch({ geminiPartialThenFail = false, groqOk = true } = {}) {
  globalThis.fetch = async (url) => {
    url = String(url);
    if (url.includes('generativelanguage')) {
      if (!geminiPartialThenFail) return new Response('busy', { status: 503 });
      const body = new ReadableStream({ start(c) {
        c.enqueue(sse({ candidates: [{ content: { parts: [{ text: 'PARTIAL ' }] } }] }));
        setTimeout(() => c.error(new Error('socket reset')), 20);
      } });
      return new Response(body, { status: 200 });
    }
    if (url.includes('groq')) {
      if (!groqOk) return new Response('busy', { status: 503 });
      const body = new ReadableStream({ start(c) {
        c.enqueue(sse({ choices: [{ delta: { content: 'FULL answer' } }] }));
        c.enqueue(enc.encode('data: [DONE]\n\n')); c.close();
      } });
      return new Response(body, { status: 200 });
    }
    return new Response('{}', { status: 404 });
  };
}
const req = (content) => new Request('https://x/api/ai/chat', { method: 'POST', body: JSON.stringify({ messages: [{ role: 'user', content }] }) });
function replay(text) {
  // Same reducer the client uses (ai-agent-chat.js ask()).
  let full = '';
  for (const part of text.split('\n\n')) {
    let evt = '';
    for (const line of part.split('\n')) {
      if (line.startsWith('event:')) { evt = line.slice(6).trim(); continue; }
      if (!line.startsWith('data:')) continue;
      let j; try { j = JSON.parse(line.slice(5).trim()); } catch (_) { continue; }
      if (evt === 'replace' && typeof j.text === 'string') full = j.text;
      else if (j.text) full += j.text;
    }
  }
  return full;
}

test('a provider failing mid-stream leaves no partial text on screen', async () => {
  installFetch({ geminiPartialThenFail: true });
  const env = { PUB_KV: memKv(), GEMINI_KEYS: 'k1', GROQ_API_KEY: 'g1', AGENT_DAILY_CAP: '50' };
  const r = await agentChat(req('বাংলাদেশের রাজধানী কোথায় এবং কেন?'), env, 'account-audit0001', { persistMemory: true });
  assert.equal(replay(await r.text()), 'FULL answer');
});

test('conversation memory stores the question once, with a TTL', async () => {
  installFetch();
  const kv = memKv();
  const env = { PUB_KV: kv, GEMINI_KEYS: 'k1', GROQ_API_KEY: 'g1', AGENT_DAILY_CAP: '50' };
  const r = await agentChat(req('সালোকসংশ্লেষণ কী এবং কেন দরকার?'), env, 'account-audit0002', { persistMemory: true });
  await r.text();
  const mem = JSON.parse(kv.store.get('chatmem:account-audit0002'));
  assert.deepEqual(mem.map((m) => m.role), ['user', 'assistant']);
  assert.equal(kv.ttl.get('chatmem:account-audit0002'), Math.round(CHAT_MEMORY_TTL_MS / 1000));
});

test('an unanswered message refunds its quota credit and leaks no provider detail', async () => {
  installFetch({ groqOk: false });
  const kv = memKv();
  const env = { PUB_KV: kv, GEMINI_KEYS: 'k1', GROQ_API_KEY: 'g1', AGENT_DAILY_CAP: '50' };
  const r = await agentChat(req('নিউটনের প্রথম সূত্র বুঝিয়ে বলো'), env, 'account-audit0003', { persistMemory: true });
  const body = await r.text();
  assert.match(body, /provider_failed/);
  assert.doesNotMatch(body, /"detail"/);
  assert.equal(JSON.parse(kv.store.get('airl:account-audit0003')).n, 0);
});

test('clearAiMemory removes memory keys but not the quota', async () => {
  const kv = memKv();
  const uid = 'account-audit0004';
  for (const k of ['chatmem:' + uid, 'chatmemsum:' + uid, 'airl:' + uid]) kv.store.set(k, 'x');
  const res = await clearAiMemory({ PUB_KV: kv }, uid);
  assert.equal(res.ok, true);
  assert.equal(kv.store.has('chatmem:' + uid), false);
  assert.equal(kv.store.has('chatmemsum:' + uid), false);
  assert.equal(kv.store.has('airl:' + uid), true);
  assert.equal((await clearAiMemory({ PUB_KV: kv }, 'guest-abc')).ok, false);
});

test('AI state object: refund never goes negative; delete refuses quota and rate keys', async () => {
  const data = new Map();
  const ctx = { storage: { get: async (k) => data.get(k), put: async (k, v) => { data.set(k, v); }, delete: async (k) => data.delete(k) } };
  const obj = new AiStateObject(ctx, {});
  await obj.consume({ uid: 'u', cap: 10, now: Date.now() });
  assert.equal((await obj.refund()).used, 0);
  assert.equal((await obj.refund()).used, 0);
  data.set('chatmem:u', { v: 'x', exp: 0 });
  data.set('rate:1', { v: 1, exp: 0 });
  await obj.deleteState({ keys: ['chatmem:u', 'quota', 'rate:1'] });
  assert.equal(data.has('chatmem:u'), false);
  assert.equal(data.has('quota'), true);
  assert.equal(data.has('rate:1'), true);
});

test('envPub forwards the AI kill-switches to the public handler', () => {
  const src = readFileSync(new URL('./gk-agent-worker.js', import.meta.url), 'utf8');
  const block = src.slice(src.indexOf('const envPub = {'), src.indexOf('};', src.indexOf('const envPub = {')));
  for (const k of ['USE_WRITE_ACTIONS', 'AI_CHAT_CACHE', 'PUBLIC_RATE_SALT', 'AGENT_GROQ_MODELS', 'AGENT_FIRST_CHUNK_MS']) {
    assert.ok(block.includes(`${k}: env.${k}`), k + ' missing from envPub');
  }
});

test('Pages does not serve the Worker-only AI modules', () => {
  const src = readFileSync(new URL('./_worker.js', import.meta.url), 'utf8');
  for (const f of ['/prompt-registry.js', '/response-validator.js', '/memory-engine.js', '/ai-chat-cache.mjs']) assert.ok(src.includes(`'${f}'`), f);
  assert.ok(!src.includes("'/ai-agent-chat.js'"), 'the chat UI script must stay public');
});

test('voice-worker accepts only the app origins', () => {
  // AU-SEC-05 (2026-10-30): this test used to assert that an arbitrary
  // subdomain -- `abc123.admissionsky.pages.dev` -- was ACCEPTED. That was the
  // P20 behaviour, and it was the hole: only the apex hosts are the owner's, so
  // any other name under pages.dev was treated as the app and handed
  // `Access-Control-Allow-Origin` with credentials. The 2026-10-22 CORS
  // decision (D-5) dropped preview subdomains; the shared policy in
  // cors-policy.mjs now enforces that, and voice-worker.js delegates to it
  // instead of keeping a copy. The subdomain cases below are the regression.
  const src = readFileSync(new URL('./voice-worker.js', import.meta.url), 'utf8');
  assert.match(src, /const originAllowed = allowedOrigin;/,
    'voice-worker.js must delegate to the shared policy, not restate it');
  const originAllowed = allowedOrigin;
  assert.equal(originAllowed('https://admissionsky.pages.dev'), true);
  assert.equal(originAllowed('https://admissionhub.pages.dev'), true);
  assert.equal(originAllowed('https://abc123.admissionsky.pages.dev'), false);
  assert.equal(originAllowed('https://evil.admissionsky.pages.dev'), false);
  assert.equal(originAllowed('https://evil.pages.dev'), false);
  assert.equal(originAllowed('https://evil.github.io'), false);
});

test('OpenRouter defaults to free models only', () => {
  const src = readFileSync(new URL('./ai-agent.js', import.meta.url), 'utf8');
  const line = src.split('\n').find((l) => l.includes("key: 'OPENROUTER_API_KEYS'"));
  assert.ok(line && !line.includes('gpt-4o-mini') && line.includes(':free'));
});
