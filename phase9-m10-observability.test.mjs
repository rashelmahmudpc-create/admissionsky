// 🧩 PHASE 9 — M10: OBSERVABILITY + COST / QUOTA
// Locks the last audit gap (§52 items 9/10) and the two honesty rules it has to
// keep: a trace never carries content, and a cost is never invented.
//
// The sharpest test here is the negative one. `PRICING` ships empty on purpose —
// the Gemini model aliases are preview/lite and their rates move, so a guessed
// rate would corrupt every total derived from it. The suite therefore proves the
// engine reports `priced: false` rather than a fabricated number, and that the
// arithmetic is correct *when* a rate exists (injected), not that a rate exists.
import { readFileSync } from 'fs';
let pass = 0, fail = 0;
const t = (n, c) => { if (c) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n); } }

const O = await import('./observability.js');
const AGENT_SRC = readFileSync('ai-agent.js', 'utf8');
const WORKER_SRC = readFileSync('gk-agent-worker.js', 'utf8');
const {
  OBSERVABILITY_VERSION, MAX_TRACES, FALLBACK, PRICING, TRACE_FIELDS,
  FORBIDDEN_TRACE_KEYS, QUOTA_WARN_AT, estimateTokens, makeRequestId, callerRef,
  costFor, estimateCost, makeTrace, sanitizeTrace, appendTrace, parseTraces,
  emptyUsage, addUsage, quotaState, renderTrace, describeObservability,
  validateObservability
} = O;

/* ── ১. Engine shape ── */
t('M10-১. engine self-validation passes and the version is stamped',
  Array.isArray(validateObservability()) && validateObservability().length === 0
  && OBSERVABILITY_VERSION === 'obs-v1');
t('M10-২. the eight fallback reasons cover every way a request can miss',
  Object.values(FALLBACK).length === 8
  && Object.values(FALLBACK).includes('none') && Object.values(FALLBACK).includes('provider-error')
  && Object.values(FALLBACK).includes('bad-key') && Object.values(FALLBACK).includes('rate-limited'));
t('M10-৩. trace history is bounded and the bound is positive', MAX_TRACES === 200 && MAX_TRACES > 0);

/* ── ২. A trace is not a transcript ── */
t('M10-৪. the field whitelist carries no content field',
  !TRACE_FIELDS.includes('text') && !TRACE_FIELDS.includes('uid')
  && !TRACE_FIELDS.includes('messages') && !TRACE_FIELDS.includes('prompt'));
t('M10-৫. sanitize drops forbidden keys even when a call site passes a whole message object',
  (() => {
    const dirty = { rid: 'r-1', provider: 'gemini', model: 'm',
      text: 'SECRET STUDENT ANSWER', uid: 'account-abc123', messages: [{ role: 'user', content: 'x' }],
      prompt: 'system', key: 'AIza-secret', token: 'tok', email: 'a@b.c' };
    const clean = sanitizeTrace(dirty);
    const serialised = JSON.stringify(clean);
    return !('text' in clean) && !('uid' in clean) && !('messages' in clean) && !('key' in clean)
      && !serialised.includes('SECRET') && !serialised.includes('account-abc123') && !serialised.includes('AIza')
      && clean.provider === 'gemini';
  })());
t('M10-৬. every forbidden key is genuinely absent from the whitelist',
  FORBIDDEN_TRACE_KEYS.every(k => !TRACE_FIELDS.includes(k)) && FORBIDDEN_TRACE_KEYS.length >= 8);
t('M10-৭. the raw uid never appears — only a stable correlation ref',
  (() => {
    const uid = 'account-rashel-12345';
    const ref = callerRef(uid);
    const line = renderTrace(makeTrace({ rid: 'r-9', callerRef: ref, provider: 'gemini', model: 'm' }));
    return ref.length === 8 && /^[0-9a-f]{8}$/.test(ref) && callerRef(uid) === ref
      && !line.includes(uid) && line.includes(ref);
  })());
t('M10-৮. renderTrace is single-line so a trace cannot forge extra log lines',
  (() => {
    const line = renderTrace(makeTrace({ rid: 'r-1', provider: 'gemini', model: 'a\nb\r\nc' }));
    return !/[\r\n]/.test(line) && JSON.parse(line).model === 'a\nb\r\nc';
  })());

/* ── ৩. A cost is never invented ── */
t('M10-৯. the shipped rate sheet is empty on purpose',
  Object.keys(PRICING).every(p => Object.keys(PRICING[p]).length === 0));
t('M10-১০. an unpriced model reports priced:false and a null cost, never a guess',
  (() => {
    const r = estimateCost({ provider: 'gemini', model: 'gemini-3.1-flash-lite', tokensIn: 1000, tokensOut: 500 });
    return r.priced === false && r.usd === null && r.reason === 'no-rate-for-model';
  })());
t('M10-১১. an unknown provider is unpriced rather than crashing',
  estimateCost({ provider: 'nope', model: 'x', tokensIn: 10 }).priced === false);
t('M10-১২. a half-filled rate is treated as absent, so no total is half-guessed',
  (() => {
    const sheet = { gemini: { 'm-half': { in: 0.1 } } };
    return costFor('gemini', 'm-half', sheet) === null
      && estimateCost({ provider: 'gemini', model: 'm-half', pricing: sheet }).priced === false;
  })());
t('M10-১৩. with a rate present the arithmetic is exact (per 1M tokens)',
  (() => {
    const sheet = { gemini: { 'm-1': { in: 1, out: 2 } } };
    const r = estimateCost({ provider: 'gemini', model: 'm-1', tokensIn: 1_000_000, tokensOut: 500_000, pricing: sheet });
    return r.priced === true && r.usd === 2;
  })());
t('M10-১৪. a trace built from an unpriced model carries costUsd null and priced false',
  (() => {
    const tr = makeTrace({ rid: 'r-1', provider: 'gemini', model: 'gemini-3.1-flash-lite', tokensIn: 40, tokensOut: 40 });
    return tr.costUsd === null && tr.priced === false;
  })());

/* ── ৪. Usage totals stay honest ── */
t('M10-১৫. an empty accumulator is all zeros',
  (() => { const u = emptyUsage(); return u.requests === 0 && u.tokensIn === 0 && u.usd === 0 && u.unpriced === 0; })());
t('M10-১৬. unpriced requests are counted separately so a total is never read as complete',
  (() => {
    const a = addUsage(emptyUsage(), makeTrace({ rid: 'r-1', provider: 'gemini', model: 'm', tokensIn: 10, tokensOut: 10 }));
    const b = addUsage(a, makeTrace({ rid: 'r-2', provider: 'gemini', model: 'm', tokensIn: 10, tokensOut: 10 }));
    return b.requests === 2 && b.tokensIn === 20 && b.tokensOut === 20 && b.usd === 0 && b.unpriced === 2;
  })());
t('M10-১৭. a priced request adds to usd and leaves unpriced untouched',
  (() => {
    const priced = makeTrace({ rid: 'r-1', provider: 'gemini', model: 'm-1', tokensIn: 1_000_000, pricing: { gemini: { 'm-1': { in: 1, out: 1 } } } });
    const u = addUsage(emptyUsage(), priced);
    return priced.priced === true && u.usd === 1 && u.unpriced === 0;
  })());
t('M10-১৮. a fallback is counted, a clean request is not',
  (() => {
    const ok = addUsage(emptyUsage(), makeTrace({ rid: 'r-1', provider: 'g', model: 'm' }));
    const bad = addUsage(ok, makeTrace({ rid: 'r-2', provider: 'g', model: 'm', fallbackReason: FALLBACK.PROVIDER_ERROR }));
    return ok.fallbacks === 0 && bad.fallbacks === 1;
  })());

/* ── ৫. Bounded history, corrupt-safe parse ── */
t('M10-১৯. appendTrace keeps the newest and drops the oldest at the bound',
  (() => {
    let list = [];
    for (let i = 0; i < MAX_TRACES + 25; i++) list = appendTrace(list, makeTrace({ rid: 'r-' + i, provider: 'g', model: 'm' }));
    return list.length === MAX_TRACES && list[list.length - 1].rid === 'r-' + (MAX_TRACES + 24);
  })());
t('M10-২০. corrupt history parses as empty and never throws',
  parseTraces('{not json').length === 0 && parseTraces(null).length === 0 && parseTraces('{"a":1}').length === 0);
t('M10-২১. parseTraces filters to the caller’s own ref and re-sanitises each record',
  (() => {
    const mine = JSON.stringify([makeTrace({ rid: 'r-1', callerRef: 'aaaa1111', provider: 'g', model: 'm', text: 'leak' }),
      makeTrace({ rid: 'r-2', callerRef: 'bbbb2222', provider: 'g', model: 'm' })]);
    const got = parseTraces(mine, 'aaaa1111');
    return got.length === 1 && got[0].rid === 'r-1' && !('text' in got[0]);
  })());
t('M10-২২. a negative or absurd latency is clamped to a number, not stored raw',
  (() => { const tr = sanitizeTrace({ rid: 'r-1', latencyMs: -50 }); return tr.latencyMs === 0; })());

/* ── ৬. Quota view ── */
t('M10-২৩. quota reports remaining, exhaustion and the 80% warning',
  (() => {
    const fresh = quotaState({ used: 0, cap: 80 });
    const warn = quotaState({ used: 64, cap: 80 });
    const full = quotaState({ used: 80, cap: 80 });
    const over = quotaState({ used: 99, cap: 80 });
    return fresh.remaining === 80 && !fresh.warning && !fresh.exhausted
      && warn.warning === true && !warn.exhausted && warn.used === 64
      && full.exhausted === true && full.remaining === 0 && full.warning === false
      && over.exhausted === true && over.remaining === 0;
  })());
t('M10-২৪. a zero cap cannot divide the quota into a negative or NaN state',
  (() => { const q = quotaState({ used: 0, cap: 0 }); return q.cap === 1 && Number.isFinite(q.remaining) && q.remaining >= 0; })());
t('M10-২৫. the warn threshold is 80%', QUOTA_WARN_AT === 0.8);

/* ── ৭. Wiring into the chat path ── */
t('M10-২৬. the orchestrator emits a trace on success and on provider failure',
  AGENT_SRC.includes('emitTrace({ provider: c.provider, model: c.model, text: raw')
  && AGENT_SRC.includes('emitTrace({ fallbackReason: FALLBACK.PROVIDER_ERROR, validated: false })'));
t('M10-২৭. the trace carries the prompt and context versions actually in play',
  AGENT_SRC.includes('promptVersion: SYSTEM_PROMPT_V')
  && AGENT_SRC.includes('contextVersion: ctxBundle ? CONTEXT_VERSION : \'\''));
t('M10-২৮. observability adds no KV write — the two-write budget is intact',
  !/putKv\([^)]*obs/i.test(AGENT_SRC) && !AGENT_SRC.includes("'obstrace:'")
  && !AGENT_SRC.includes("'aobs:'"));
t('M10-২৯. agentStatus advertises observability as shape, not capability',
  AGENT_SRC.includes('observability: describeObservability()')
  && describeObservability().tokenCount === 'estimate'
  && Array.isArray(describeObservability().pricedProviders)
  && describeObservability().pricedProviders.length === 0);
t('M10-৩০. the rate limit still answers 429 with the same error code and cap',
  AGENT_SRC.includes("error: 'rate_limited'") && AGENT_SRC.includes('}, 429)')
  && AGENT_SRC.includes('quotaState({ used: quotaNow.n, cap })'));

/* ── ৭ক. The per-user state moved to a Durable Object ──
 * The KV path allowed only 1,000 writes a day on the free plan and the chat
 * wrote three keys a message, which capped the feature. These assert the object
 * is the preferred path and KV remains the fallback, so a missing binding still
 * works and the earlier KV-based behaviour is not silently deleted. */
t('M10-৩০ক. agentChat prefers the AI-state Durable Object and keeps KV as fallback',
  AGENT_SRC.includes("from './ai-state-do.mjs'")
  && AGENT_SRC.includes('const aiState = aiStateStore(env);')
  /* F0.1 step 4h added a request id to this call, so a chat answered by sky-ai and
     retried by admission-gk is counted once instead of twice. The assertion follows
     the argument rather than pinning the old literal — it is checking that the
     Durable Object is preferred, not how many arguments it takes. */
  && /await aiState\.consumeQuota\(sendCtx\.uid, cap[^)]*\)/.test(AGENT_SRC)
  && AGENT_SRC.includes("return getKv(env.PUB_KV, key);"));
t('M10-৩০গ. the status endpoint reports which state store is live',
  AGENT_SRC.includes("state: aiStateStore(env) ? { store: 'durable-object'")
  && AGENT_SRC.includes("{ store: 'kv', version: 'kv-fallback' }"));
/* The public handler gets an explicit env whitelist. A binding left out of it is
 * silently absent downstream, and both the quota and the abuse guard then fall
 * back to KV — which is exactly what happened on the first deploy of this
 * change. This asserts the binding is in the whitelist so it cannot recur. */
t('M10-৩০ঘ. AI_STATE is passed into the public handler whitelist',
  WORKER_SRC.includes('AI_STATE: env.AI_STATE')
  && /envPub = \{[\s\S]*?AI_STATE: env\.AI_STATE[\s\S]*?\};/.test(WORKER_SRC));
/* Groq retired llama-3.3-70b-versatile and llama-3.1-8b-instant; both answer
 * 404 model_not_found now. A 404 from a provider is not transient, so leaving a
 * dead model in the chain means every request pays a wasted round-trip to Groq
 * before falling through. */
t('M10-৩০ঙ. the chain names only Groq models that still exist',
  !AGENT_SRC.includes('llama-3.3-70b-versatile')
  && !AGENT_SRC.includes('llama-3.1-8b-instant')
  && AGENT_SRC.includes("'openai/gpt-oss-120b'")
  && AGENT_SRC.includes("'openai/gpt-oss-20b'"));
t('M10-৩০খ. memory reads and writes go through the state helpers, not KV directly',
  AGENT_SRC.includes("await stateGet('chatmem:' + sendCtx.uid)")
  && AGENT_SRC.includes("await statePut('chatmem:' + sendCtx.uid, JSON.stringify(next), CHAT_MEMORY_TTL_MS)")
  /* P30: the long-term record is read once (memKeyEarly) and the last-topic save
     reuses it, writing in the background — still through the state helper. */
  && AGENT_SRC.includes('stateGet(memKeyEarly)')
  && AGENT_SRC.includes('statePut(memKey, JSON.stringify(upsertMemory(stored, record, sendCtx.uid)))')
  && !AGENT_SRC.includes("putKv(env.PUB_KV, 'chatmem:' + sendCtx.uid")
  && !AGENT_SRC.includes("getKv(env.PUB_KV, memKey)"));

/* ── ৮. Token estimate is labelled an estimate ── */
t('M10-৩১. estimateTokens is a documented approximation, not a tokeniser',
  estimateTokens('') === 0 && estimateTokens('abcd') === 1 && estimateTokens('abcde') === 2
  && describeObservability().tokenCount === 'estimate');
t('M10-৩২. makeRequestId is deterministic for a seed so a log can be replayed',
  makeRequestId('same-seed') === makeRequestId('same-seed')
  && makeRequestId('a') !== makeRequestId('b')
  && /^r-[0-9a-f]{8}$/.test(makeRequestId('x')));

console.log(`\n🧩 PHASE9-M10-OBSERVABILITY: ${pass} pass / ${fail} fail`);
process.exit(fail ? 1 : 0);
