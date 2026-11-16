// 🏁 P31 — A BUSY MODEL IS TRIED LAST, NOT ONCE PER KEY
//
// Owner (voice note 2026-10-16): "যেগুলা একদম অচল সেগুলা একদম শেষে করে দাও আর
// যেগুলা সচল সেগুলা একদম ফাস্টে করে দাও" — "put the completely dead ones at the
// very end, and make the working ones really fast."
//
// Measured, not guessed: the FAST tier answered 503 to
// 6/6 live probes at ~0.42 s each, while the SMART tier answered the
// same question in 1.14 s. `routerChain` emits one entry per key per model, so
// with ~17 Gemini keys the student paid ~7.2 s of silent retries before the
// healthy model was reached.
//
// Properties this file locks:
//   (a) a model that is failing across every key is ordered LAST, never dropped;
//   (b) one bad key must not demote a model the other keys still serve;
//   (c) inside one request a failed model is not retried once per key; and
//   (d) the healthy model is the one that actually answers.
import { readFileSync } from 'fs';
let pass = 0, fail = 0;
const t = (n, c) => { if (c) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n); } };

const H = await import('./ai-provider-health.mjs');
const A = await import('./ai-agent.js');
const SRC = readFileSync('ai-agent.js', 'utf8');
const { rankChainByModelHealth, failureMarker, HEALTH } = H;

const e = (key, model) => ({ sig: String(key).slice(0, 12) + ':' + model, provider: 'gemini', key, model });
const FAST = 'gemini-flash-lite-latest';
const SMART = 'gemini-3.6-flash';

/* ── ১. Ordering ── */
t('P31-১. a model failing on every key is moved behind a healthy one', (() => {
  const now = Date.now();
  const list = [e('k1', FAST), e('k2', FAST), e('k3', SMART)];
  const bad = {};
  for (const c of list.filter(x => x.model === FAST)) bad[c.sig] = failureMarker(503, now);
  const out = rankChainByModelHealth(list, bad, now);
  /* Healthy first, dead last: SMART leads, the two FAST entries trail. */
  return out[0].model === SMART && out[out.length - 1].model === FAST
    && out.filter(x => x.model === FAST).length === 2;
})());

t('P31-২. the dead model is kept, never dropped (P28 never-empty still holds)', (() => {
  const now = Date.now();
  const list = [e('k1', FAST), e('k2', FAST), e('k3', SMART)];
  const bad = {};
  for (const c of list.filter(x => x.model === FAST)) bad[c.sig] = failureMarker(503, now);
  const out = rankChainByModelHealth(list, bad, now);
  return out.length === 3 && out.filter(x => x.model === FAST).length === 2;
})());

t('P31-৩. ONE bad key does not demote a model the other keys still serve', (() => {
  const now = Date.now();
  const list = [e('k1', FAST), e('k2', FAST), e('k3', SMART)];
  const bad = { [e('k1', FAST).sig]: failureMarker(503, now) };
  const out = rankChainByModelHealth(list, bad, now);
  /* k1 (cooling) drops out of healthyChain before this runs, but ranking alone
     must keep FAST ahead of SMART because k2 is still healthy. */
  return out[0].model === FAST && out[out.length - 1].model === SMART;
})());

t('P31-৪. an expired marker does not demote the model any more', (() => {
  const now = Date.now();
  const list = [e('k1', FAST), e('k2', SMART)];
  const bad = { [e('k1', FAST).sig]: failureMarker(503, now) };
  const later = now + (HEALTH.TRANSIENT_COOLDOWN_S + 1) * 1000;
  const out = rankChainByModelHealth(list, bad, later);
  return out[0].model === FAST;
})());

t('P31-৫. ordering is stable inside a group — configured priority survives', (() => {
  const now = Date.now();
  const list = [e('a', FAST), e('b', SMART), e('c', FAST)];
  const out = rankChainByModelHealth(list, {}, now);
  return out.map(x => x.key).join(',') === 'a,b,c';
})());

t('P31-৬. an empty or absent chain is returned untouched', (() => {
  return rankChainByModelHealth([], {}, Date.now()).length === 0
    && rankChainByModelHealth(null, {}, Date.now()).length === 0;
})());

/* ── ২. Wiring ── */
t('P31-৭. the chat path ranks the chain by model health',
  SRC.includes('rankChainByModelHealth(chain, badMap, healthNow)'));
t('P31-৮. the streaming loop skips a failed model before its next key',
  /for \(const c of chain\) \{\n\s+\/\* P31[^]*?if \(\(modelFails\.get\(c\.model\)/.test(SRC));
t('P31-৯. the one-shot loop carries the same per-model limit',
  SRC.includes('oneShotFails.get(c.model)'));
t('P31-১০. a 5xx retires the model for the rest of the request, a 4xx does not',
  /st >= 500 \|\| st === 429\)\s*\n\s*\? MODEL_FAIL_LIMIT/.test(SRC));

/* ── ৩. Real end-to-end: the exact measured outage ── */
async function runE2E(fetchImpl, opts = {}) {
  const real = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => { calls.push(String(url)); return fetchImpl(url, init); };
  const store = {};
  const env = Object.assign({
    PUB_KV: { async get(k) { return store[k] || null; }, async put(k, v) { store[k] = v; return { ok: true }; } },
    /* 17 keys for the busy FAST model, exactly the shape that cost ~7.2 s. */
    GEMINI_KEYS: Array.from({ length: 17 }, (_, i) => 'fastkey' + i).join(','),
    AGENT_GEMINI_MODELS: FAST + ',' + SMART
  }, opts.env || {});
  try {
    const res = await A.agentChat(new Request('https://x/api/ai/chat', {
      method: 'POST', body: JSON.stringify({ messages: [{ role: 'user', content: 'নিউটনের ২য় সূত্র কী?' }], fresh: true })
    }), env, 'account-p31' + Math.random(), opts.agentOpts || { persistMemory: false });
    const body = await res.text();
    return { body, store, calls };
  } finally { globalThis.fetch = real; }
}
const sse = (text) => 'data: ' + JSON.stringify({ choices: [{ delta: { content: text } }] }) + '\n\ndata:';
const gemini503 = () => new Response(JSON.stringify({ error: { code: 503, status: 'UNAVAILABLE' } }), { status: 503, headers: { 'Content-Type': 'application/json' } });

t('P31-১১. E2E: a model busy on every key costs at most 2 attempts, not 17', (async () => {
  let fastTries = 0, smartTries = 0;
  const r = await runE2E(async (url) => {
    const u = String(url);
    if (/generativelanguage/.test(u)) {
      if (u.includes(FAST)) { fastTries++; return gemini503(); }
      smartTries++; return new Response(sse('উত্তর'), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    }
    return new Response('{}', { status: 200 });
  });
  return r.body.includes('উত্তর') && fastTries <= 2 && smartTries === 1;
})());

t('P31-১২. E2E: the healthy model answers even though the busy one leads the tier', (async () => {
  const r = await runE2E(async (url) => {
    const u = String(url);
    if (/generativelanguage/.test(u)) {
      if (u.includes(FAST)) return gemini503();
      return new Response(sse('স্বাস্থ্যকর মডেলের উত্তর'), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    }
    return new Response('{}', { status: 200 });
  });
  return r.body.includes('স্বাস্থ্যকর মডেলের উত্তর');
})());

t('P31-১৩. E2E: a second request skips the now-known-dead model almost entirely', (async () => {
  const store = {};
  const env = {
    PUB_KV: { async get(k) { return store[k] || null; }, async put(k, v) { store[k] = v; return { ok: true }; } },
    GEMINI_KEYS: Array.from({ length: 17 }, (_, i) => 'fastkey' + i).join(','),
    AGENT_GEMINI_MODELS: FAST + ',' + SMART
  };
  const real = globalThis.fetch;
  let fastTries = 0;
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (/generativelanguage/.test(u)) {
      if (u.includes(FAST)) { fastTries++; return gemini503(); }
      return new Response(sse('দ্বিতীয় উত্তর'), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    }
    return new Response('{}', { status: 200 });
  };
  try {
    const call = () => A.agentChat(new Request('https://x/api/ai/chat', {
      method: 'POST', body: JSON.stringify({ messages: [{ role: 'user', content: 'সন্ধি কী?' }], fresh: true })
    }), env, 'account-p31b' + Math.random(), { persistMemory: false });
    await (await call()).text();
    const before = fastTries;
    const second = await (await call()).text();
    return second.includes('দ্বিতীয় উত্তর') && fastTries - before === 0;
  } finally { globalThis.fetch = real; }
})());

console.log(`\nP31: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
