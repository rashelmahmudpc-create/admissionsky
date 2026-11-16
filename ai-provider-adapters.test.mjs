// 🧩 PHASE 9 — M2: AI PROVIDER ADAPTER LAYER (server-side module test)
// Locks the adapter boundary introduced in migration step M2. The provider
// call sites must be structurally reachable only through adapters, while the
// observable behaviour stays identical to the pre-M2 orchestrator.
import { readFileSync } from 'fs';
let pass = 0, fail = 0;
const t = (n, c) => { if (c) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n); } }

const A = await import('./ai-agent.js');
const SRC = readFileSync('ai-agent.js', 'utf8');
const {
  adapterFor, providerChain, PROVIDER_ADAPTERS, GEMINI_ADAPTER, GROQ_ADAPTER,
  routerChain, ProviderError, agentChat, __test
} = A;

const stubEnv = (over = {}) => {
  const store = new Map();
  return {
    store,
    env: {
      GEMINI_KEYS: 'k1,k2', GROQ_API_KEY: 'g1', PUB_KV: {
        get: async (k) => (store.has(k) ? store.get(k) : null),
        put: async (k, v) => { store.set(k, v); }
      },
      ...over
    }
  };
};
const gChunk = (s) => JSON.stringify({ candidates: [{ content: { parts: [{ text: s }] } }] });
const sseRes = (body) => new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });

/* ── ১. Registry shape ── */
t('M2-১. core adapters registered, gemini+groq present and ordered first', PROVIDER_ADAPTERS.length >= 2 && PROVIDER_ADAPTERS[0].id === 'gemini' && PROVIDER_ADAPTERS[1].id === 'groq');
t('M2-২. every adapter exposes the full contract', PROVIDER_ADAPTERS.every(a => typeof a.id === 'string' && typeof a.matches === 'function' && typeof a.chatOnce === 'function' && typeof a.chatStream === 'function' && typeof a.oneShot === 'boolean'));
t('M2-৩. adapterFor maps chain entries to the right adapter', adapterFor({ provider: 'gemini' }) === GEMINI_ADAPTER && adapterFor({ provider: 'groq' }) === GROQ_ADAPTER);
t('M2-৪. adapterFor(unknown) → null (no silent misroute)', adapterFor({ provider: 'openrouter' }) === null && adapterFor({}) === null);
t('M2-৫. gemini is one-shot capable, groq is honestly stream-only', GEMINI_ADAPTER.oneShot === true && GROQ_ADAPTER.oneShot === false);

/* ── ২. Non-stream chain ── */
t('M2-৬. providerChain = router chain minus stream-only providers', (() => {
  const c = providerChain(stubEnv().env, 'SMART', new Set());
  return c.length > 0 && c.every(x => x.provider === 'gemini');
})());
t('M2-৭. providerChain honours the bad-set (same key/model exclusion as router)', (() => {
  const env = { GEMINI_KEYS: 'k1', GROQ_API_KEY: '' };
  const bad = new Set(['k1:gemini-3.6-flash']);
  return !providerChain(env, 'SMART', bad).some(x => x.model === 'gemini-3.6-flash');
})());
t('M2-৮. providerChain {} → empty (still the 503 path)', providerChain({}, 'FAST', new Set()).length === 0);
t('M2-৯. providerChain never includes groq even when GROQ_API_KEY is set', !providerChain(stubEnv().env, 'FAST', new Set()).some(x => x.provider === 'groq'));

/* ── ৩. Groq one-shot fails honestly (never a fake success) ── */
t('M2-১০. GROQ_ADAPTER.chatOnce rejects instead of inventing a fallback', (async () => {
  try { await GROQ_ADAPTER.chatOnce({ provider: 'groq', key: 'g', model: 'm' }, {}); return false; }
  catch (e) { return e instanceof ProviderError && e.bad === false && e.retryable === false; }
})());

/* ── ৪. Structural: providers are reached only through adapters ── */
const ORCH = SRC.slice(SRC.indexOf('export async function agentChat'), SRC.indexOf('export async function agentStatus'));
t('M2-১১. no raw provider URL anywhere inside the orchestrator body', !ORCH.includes('generativelanguage.googleapis.com') && !ORCH.includes('api.groq.com'));
t('M2-১২. provider endpoints exist only in the stream helpers + chatOnce adapter', (SRC.match(/generativelanguage\.googleapis\.com/g) || []).length === 2 && (SRC.match(/api\.groq\.com\/openai\/v1\/chat\/completions/g) || []).length === 1 && (ORCH.match(/fetch\(/g) || []).length === 0);
t('M2-১৩. orchestrator dispatches by adapter, not by provider name', SRC.includes('const adapter = adapterFor(c)') && !SRC.includes("if (c.provider === 'groq')"));

/* ── ৫. Behaviour unchanged (same E2E outcomes as baseline) ── */
t('M2-১৪. E2E: gemini-500 → groq-fallback still streams through adapters', (async () => {
  const { env } = stubEnv();
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    if (u.includes('streamGenerateContent')) return new Response('boom', { status: 500 });
    if (u.includes('api.groq.com')) return sseRes('data: ' + JSON.stringify({ choices: [{ delta: { content: 'গ্রক-উত্তর' } }] }) + '\n\ndata: [DONE]\n\n');
    return new Response('unexpected', { status: 500 });
  };
  try {
    const r = await agentChat(new Request('https://x/api/ai/chat', { method: 'POST', body: JSON.stringify({ messages: [{ role: 'user', content: 'বুঝাও' }] }) }), env, 'account-um2');
    const text = await r.text();
    return r.status === 200 && text.includes('গ্রক-উত্তর') && text.includes('"provider":"groq"');
  } finally { globalThis.fetch = real; }
})(), { timeout: 10000 });

t('M2-১৫. E2E: non-stream path still returns gemini text through GEMINI_ADAPTER', (async () => {
  const { env } = stubEnv();
  const real = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes(':generateContent')) return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'সরাসরি-উত্তর' }] } }] }), { status: 200 });
    return new Response('boom', { status: 500 });
  };
  try {
    const r = await agentChat(new Request('https://x/api/ai', { method: 'POST', body: JSON.stringify({ messages: [{ role: 'user', content: 'বুঝাও' }] }) }), env, 'account-um2b');
    const d = await r.json();
    return r.status === 200 && d.text === 'সরাসরি-উত্তর' && d.provider === undefined && d.model === 'gemini-3.6-flash';
  } finally { globalThis.fetch = real; }
})(), { timeout: 10000 });

t('M2-১৬. E2E: no-provider env still yields 503 (wording unchanged)', (async () => {
  const { env } = stubEnv({ GEMINI_KEYS: '', GROQ_API_KEY: '' });
  const r = await agentChat(new Request('https://x/api/ai', { method: 'POST', body: JSON.stringify({ messages: [{ role: 'user', content: 'হ্যালো' }] }) }), env, 'account-um2c');
  const d = await r.json();
  return r.status === 503 && d.error === 'no_providers';
})(), { timeout: 10000 });

t('M2-১৭. adapters are exported on the test surface for later steps', __test.GEMINI_ADAPTER === GEMINI_ADAPTER && __test.GROQ_ADAPTER === GROQ_ADAPTER && __test.adapterFor === adapterFor);

/* ── ৬. M2.5: Cloudflare Workers AI backup ── */
const { CLOUDFLARE_ADAPTER } = A;
const cfEnv = (over = {}) => ({ GEMINI_KEYS: 'k1', GROQ_API_KEY: 'g1', CLOUDFLARE_ACCOUNT_ID: 'acct', CLOUDFLARE_AI_API_KEY: 'cftok', PUB_KV: { get: async () => null, put: async () => {} }, ...over });

t('M2.5-১. cloudflare adapter registered with the full contract', Boolean(CLOUDFLARE_ADAPTER) && PROVIDER_ADAPTERS.some(a => a.id === 'cloudflare') && typeof CLOUDFLARE_ADAPTER.chatStream === 'function' && CLOUDFLARE_ADAPTER.oneShot === false);
t('M2.5-২. adapterFor routes cloudflare chain entries', adapterFor({ provider: 'cloudflare' }) === CLOUDFLARE_ADAPTER);
t('M2.5-৩. chatOnce rejects honestly (no invented one-shot path)', (async () => {
  try { await CLOUDFLARE_ADAPTER.chatOnce({ provider: 'cloudflare' }, {}); return false; }
  catch (e) { return e instanceof ProviderError && e.bad === false; }
})());
t('M2.5-৪. router appends cloudflare only when account id AND token exist', (() => {
  const both = routerChain(cfEnv(), 'FAST', new Set());
  const noAcct = routerChain({ GEMINI_KEYS: 'k', CLOUDFLARE_AI_API_KEY: 't' }, 'FAST', new Set());
  const noTok = routerChain({ GEMINI_KEYS: 'k', CLOUDFLARE_ACCOUNT_ID: 'a' }, 'FAST', new Set());
  return both.some(x => x.provider === 'cloudflare') && !noAcct.some(x => x.provider === 'cloudflare') && !noTok.some(x => x.provider === 'cloudflare');
})());
t('M2.5-৫. cloudflare sits AFTER gemini and groq (backup, not primary)', (() => {
  const c = routerChain(cfEnv(), 'FAST', new Set());
  return c.findIndex(x => x.provider === 'cloudflare') > c.findIndex(x => x.provider === 'groq');
})());
t('M2.5-৬. model list is overridable for catalogue rotation', (() => {
  const c = routerChain(cfEnv({ AGENT_CLOUDFLARE_MODELS: '@cf/a,@cf/b' }), 'FAST', new Set()).filter(x => x.provider === 'cloudflare');
  return c.length === 2 && c.map(x => x.model).join(',') === '@cf/a,@cf/b';
})());
t('M2.5-৭. no cloudflare entry when the whole env is empty (503 path intact)', !routerChain({}, 'FAST', new Set()).some(x => x.provider === 'cloudflare'));
t('M2.5-৮. E2E: gemini+groq down → cloudflare streams the answer', (async () => {
  const env = cfEnv();
  const real = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes('generativelanguage') || u.includes('api.groq.com')) return new Response('boom', { status: 500 });
    if (u.includes('api.cloudflare.com/client/v4/accounts/acct/ai/v1/chat/completions')) {
      return sseRes('data: ' + JSON.stringify({ choices: [{ delta: { content: 'সিএফ-উত্তর' } }] }) + '\n\ndn\n');
    }
    return new Response('unexpected ' + u, { status: 500 });
  };
  try {
    const r = await agentChat(new Request('https://x/api/ai/chat', { method: 'POST', body: JSON.stringify({ messages: [{ role: 'user', content: 'বুঝাও' }] }) }), env, 'account-ucf');
    const text = await r.text();
    return r.status === 200 && text.includes('সিএফ-উত্তর') && text.includes('"provider":"cloudflare"');
  } finally { globalThis.fetch = real; }
})(), { timeout: 10000 });

t('M2.5-৯. cloudflare adapter never leaks the token into the request URL', (() => {
  const src = SRC.slice(SRC.indexOf('CLOUDFLARE_ADAPTER'), SRC.indexOf('export function adapterFor'));
  return src.includes('accounts/${encodeURIComponent(account)}') && !/chat\/completions\?.*(token|key=)/i.test(src);
})());
t('M2.5-১০. agentStatus reports the cloudflare slot', (async () => {
  const r = await A.agentStatus(new Request('https://x/api/ai/status'), cfEnv(), 'u');
  const d = await r.json();
  return d.providers.cloudflare === true && d.providers.gemini === true;
})(), { timeout: 10000 });

/* ── ৬. KV key overlay (Workers Free 64-variable cap) ── */
t('M2.6-১. aiKeyOverlay reads secret:<NAME> for each declared name', (async () => {
  const { store, env } = stubEnv({ AI_KV_KEY_NAMES: 'GROQ_API_KEY, OPENROUTER_API_KEYS' });
  store.set('secret:GROQ_API_KEY', 'kv-groq');
  store.set('secret:OPENROUTER_API_KEYS', 'kv-or');
  const kv = await A.aiKeyOverlay(env);
  return kv.GROQ_API_KEY === 'kv-groq' && kv.OPENROUTER_API_KEYS === 'kv-or';
})());

t('M2.6-২. a KV-backed Groq key reaches the chain with no env var at all', (() => {
  const c = routerChain({}, 'FAST', new Set(), { GROQ_API_KEY: 'kv-groq' });
  return c.filter(x => x.provider === 'groq').length === 2;
})());

t('M2.6-৩. an env key wins over the KV copy (dashboard can always override)', (() => {
  const c = routerChain({ GROQ_API_KEY: 'env-groq' }, 'FAST', new Set(), { GROQ_API_KEY: 'kv-groq' });
  return c.filter(x => x.provider === 'groq').every(x => x.key === 'env-groq');
})());

t('M2.6-৪. aiKeyOverlay is silent when no names are declared or KV is absent', (async () => {
  const a = await A.aiKeyOverlay({ PUB_KV: stubEnv().env.PUB_KV });
  const b = await A.aiKeyOverlay({ AI_KV_KEY_NAMES: 'GROQ_API_KEY' });
  return Object.keys(a).length === 0 && Object.keys(b).length === 0;
})());

t('M2.6-৫. a stored secret:GROQ_API_KEY is picked up with no variable at all', (async () => {
  const { store, env } = stubEnv();
  store.set('secret:GROQ_API_KEY', 'kv-groq');
  const kv = await A.aiKeyOverlay(env);
  return kv.GROQ_API_KEY === 'kv-groq';
})());

t('M2.6-৬. the secret:AI_KEYS JSON blob carries any number of keys in one get', (async () => {
  const { store, env } = stubEnv();
  store.set('secret:AI_KEYS', JSON.stringify({ OPENROUTER_API_KEYS: 'or-1', MISTRAL_API_KEYS: 'm-1', '': 'skip-me' }));
  const kv = await A.aiKeyOverlay(env);
  return kv.OPENROUTER_API_KEYS === 'or-1' && kv.MISTRAL_API_KEYS === 'm-1' && !('' in kv);
})());

t('M2.6-৭. a malformed AI_KEYS blob degrades to no keys instead of throwing', (async () => {
  const { store, env } = stubEnv();
  store.set('secret:AI_KEYS', '{not json');
  const kv = await A.aiKeyOverlay(env);
  return Object.keys(kv).length === 0;
})());

t('M2.6-৮. an AI_KEYS entry reaches the chain end to end', (() => {
  const c = routerChain({}, 'FAST', new Set(), { OPENROUTER_API_KEYS: 'or-kv' }).filter(x => x.provider === 'openai-compat');
  return c.length === 1 && c[0].key === 'or-kv';
})());

/* ── ৭. OpenAI-compatible providers (OpenRouter and friends) ── */
t('M2.7-১. openai-compat adapter is registered and maps by provider id', (() => {
  const ad = adapterFor({ provider: 'openai-compat' });
  return Boolean(ad) && ad.id === 'openai-compat' && ad.oneShot === false;
})());

t('M2.7-২. a compat key adds its entry with the provider URL, none without it', (() => {
  const off = routerChain({}, 'FAST', new Set()).filter(x => x.provider === 'openai-compat');
  const on = routerChain({ OPENROUTER_API_KEYS: 'or-k' }, 'FAST', new Set()).filter(x => x.provider === 'openai-compat');
  return off.length === 0 && on.length === 1 && on[0].url === 'https://openrouter.ai/api/v1/chat/completions';
})());

t('M2.7-৩. a compat model list overrides the default', (() => {
  const c = routerChain({ MISTRAL_API_KEYS: 'm-k', MISTRAL_API_KEYS_MODELS: 'mistral-large-latest,mistral-medium-latest' }, 'FAST', new Set())
    .filter(x => x.provider === 'openai-compat');
  return c.length === 2 && c[0].model === 'mistral-large-latest';
})());

t('M2.7-৪. a KV-backed compat key works too (64-cap workaround holds for new APIs)', (() => {
  const c = routerChain({}, 'FAST', new Set(), { OPENROUTER_API_KEYS: 'kv-or' }).filter(x => x.provider === 'openai-compat');
  return c.length === 1 && c[0].key === 'kv-or';
})());

t('M2.7-৫. compat entries honour the bad-set like every other provider', (() => {
  const key = 'or-badkey-1234567890';
  /* Read the model the provider actually ships instead of pinning a literal —
     the catalogue rotates (e.g. mistral-small-latest -> ministral-14b-latest)
     and a hardcoded model turns a rotation into a false failure. */
  const shipped = routerChain({ OPENROUTER_API_KEYS: key }, 'FAST', new Set())
    .find(x => x.provider === 'openai-compat' && x.key === key);
  if (!shipped) return false;
  const bad = new Set([key.slice(0, 12) + ':' + shipped.model]);
  const c = routerChain({ OPENROUTER_API_KEYS: key }, 'FAST', bad).filter(x => x.provider === 'openai-compat');
  return c.length === 0;
})());

t('M2.7-৬. a comma-separated compat value yields one entry per key', (() => {
  const c = routerChain({ MISTRAL_API_KEYS: 'm-one,m-two' }, 'FAST', new Set())
    .filter(x => x.provider === 'openai-compat');
  return c.length === 2 && c[0].key === 'm-one' && c[1].key === 'm-two';
})());

t('M2.7-৭. a bad-set hit on one compat key leaves the other in the chain', (() => {
  const dead = 'm-dead-key-0000';
  const shipped = routerChain({ MISTRAL_API_KEYS: dead }, 'FAST', new Set())
    .find(x => x.provider === 'openai-compat' && x.key === dead);
  if (!shipped) return false;
  const bad = new Set([dead.slice(0, 12) + ':' + shipped.model]);
  const c = routerChain({ MISTRAL_API_KEYS: 'm-live-key,m-dead-key-0000' }, 'FAST', bad)
    .filter(x => x.provider === 'openai-compat');
  return c.length === 1 && c[0].key === 'm-live-key';
})());

t('M2.7-৮. every added provider keeps the openai-compat shape and a URL', (() => {
  const names = ['SAMBANOVA_API_KEYS', 'COHERE_API_KEYS', 'HUGGINGFACE_API_KEYS', 'DEEPINFRA_API_KEYS',
    'TOGETHER_API_KEYS', 'KIMI_API_KEYS', 'AIML_API_KEYS', 'LLM7_API_KEYS', 'SILICONFLOW_API_KEYS',
    'STEPFUN_API_KEYS', 'MINIMAX_API_KEYS'];
  return names.every(n => {
    const c = routerChain({ [n]: 'k' }, 'FAST', new Set()).filter(x => x.provider === 'openai-compat');
    return c.length === 1 && c[0].key === 'k' && /^https:\/\//.test(c[0].url) && Boolean(c[0].model);
  });
})());

console.log(`\n🧩 PHASE9-M2-ADAPTERS: ${pass} pass / ${fail} fail`);
process.exit(fail ? 1 : 0);
