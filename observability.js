// 🧩 PHASE 9, M10: OBSERVABILITY + COST / QUOTA
// The last gap the audit listed (§52 items 9/10): every AI request should leave
// a record of *what happened*, request id, provider, model, latency, token
// estimate, fallback reason, and the prompt/context versions in play, and the
// spend should be countable.
//
// Two hard rules shape this module:
//
//  1. **Never invent a number.** Token counts are estimates and are labelled as
//     such. Cost is `null` with `priced: false` until the owner fills the rate
//     sheet, so a total can never carry a made-up figure. This mirrors the
//     repo-wide rule that the assistant never fabricates statistics.
//  2. **A trace is not a transcript.** It carries ids, counts and durations -
//     never message text, prompt text, keys, or a raw uid. The caller passes a
//     correlation ref, and `renderTrace()` re-sanitises on the way out, so a
//     stray field added at a call site cannot leak content into the logs.
//
// Like M6/M7/M9 this is pure data plus pure guards: no `env`, no I/O, no model
// call. It also adds **zero KV writes**, the chat path already spends its
// two-write budget on the rate counter and memory, so traces go to the Worker's
// log sink and the engine stays a pure accumulator.

export const OBSERVABILITY_VERSION = 'obs-v1';

/** Bounded, exactly like the M9 audit trail. Oldest records are dropped first. */
export const MAX_TRACES = 200;

/** Why a request did not reach a healthy answer. `none` means it did. */
export const FALLBACK = Object.freeze({
  NONE: 'none',
  EMPTY: 'empty',
  PROVIDER_ERROR: 'provider-error',
  BAD_KEY: 'bad-key',
  NO_PROVIDERS: 'no-providers',
  BLOCKED: 'blocked',
  RATE_LIMITED: 'rate-limited',
  NOT_SIGNED_IN: 'not-signed-in'
});

/**
 * USD per 1M tokens, keyed by provider then model: `{ in, out }`.
 *
 * Deliberately empty. The models in `GEMINI_MODELS` are preview/lite aliases
 * whose public rates move, and a guessed rate would silently corrupt every cost
 * total derived from it. Add an entry as `{ in: <usd>, out: <usd> }` when the
 * owner has the current price sheet; anything absent is reported as
 * `priced: false` rather than estimated.
 */
export const PRICING = Object.freeze({
  gemini: Object.freeze({}),
  groq: Object.freeze({}),
  cloudflare: Object.freeze({})
});

/** Warn once this fraction of the daily cap is spent. */
export const QUOTA_WARN_AT = 0.8;

/**
 * Rough token estimate. Real tokenisers differ per provider and are not
 * available inside a Worker, so this is a ~4-chars-per-token approximation -
 * good enough to spot a runaway prompt, never presented as exact.
 */
export function estimateTokens(text) {
  const s = String(text == null ? '' : text);
  if (!s.length) return 0;
  return Math.ceil(s.length / 4);
}

/**
 * Correlation id for one request. Deterministic for a given seed so a test (or a
 * replayed log) reproduces the same id, random-looking otherwise.
 */
export function makeRequestId(seed) {
  const s = String(seed == null ? '' : seed) || String(Date.now()) + Math.random();
  return 'r-' + fnv1a(s).toString(16).padStart(8, '0');
}

/**
 * Short, stable correlation ref for a caller. FNV-1a is *not* a security
 * boundary, it exists so traces can be grouped without logging a raw account
 * uid. Anything that must resist reversal belongs in a hash, not here.
 */
export function callerRef(uid) {
  const s = String(uid == null ? '' : uid);
  if (!s) return '';
  return fnv1a(s).toString(16).padStart(8, '0');
}

function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** The rate for a provider/model pair, or `null` when the sheet has no entry. */
export function costFor(provider, model, pricing = PRICING) {
  const p = pricing && pricing[String(provider || '')];
  if (!p) return null;
  const rate = p[String(model || '')];
  if (!rate || typeof rate.in !== 'number' || typeof rate.out !== 'number') return null;
  return { in: rate.in, out: rate.out };
}

/**
 * Estimated USD for one request. Returns `{ usd: null, priced: false }` when the
 * model has no rate, the caller must show "unpriced", never a fabricated cost.
 * `pricing` is injectable so the arithmetic is testable while the shipped sheet
 * stays honest.
 */
export function estimateCost({ provider, model, tokensIn = 0, tokensOut = 0, pricing = PRICING } = {}) {
  const rate = costFor(provider, model, pricing);
  if (!rate) return { usd: null, priced: false, reason: 'no-rate-for-model' };
  const usd = (rate.in * Number(tokensIn || 0) + rate.out * Number(tokensOut || 0)) / 1e6;
  return { usd: Math.round(usd * 1e6) / 1e6, priced: true, reason: '' };
}

/** Field whitelist. Anything not listed is dropped by `sanitizeTrace()`. */
export const TRACE_FIELDS = Object.freeze([
  'rid', 'at', 'callerRef', 'provider', 'model', 'intent', 'tier', 'stream',
  'latencyMs', 'tokensIn', 'tokensOut', 'costUsd', 'priced', 'fallbackReason',
  'promptVersion', 'contextVersion', 'agentVersion', 'responseType', 'validated'
]);

/** Fields that must never appear in a trace, whatever a call site passes. */
export const FORBIDDEN_TRACE_KEYS = Object.freeze([
  'uid', 'text', 'content', 'messages', 'prompt', 'key', 'token', 'args',
  'summary', 'email', 'phone'
]);

const num = (v, min = 0) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= min ? n : 0;
};
const str = (v, max = 120) => String(v == null ? '' : v).slice(0, max);

/**
 * Build a trace from a call site. Forbidden keys are dropped here as well as in
 * `renderTrace()`, so the guarantee holds even if a caller passes a whole
 * message object by mistake.
 */
export function makeTrace(input = {}) {
  const src = input && typeof input === 'object' ? input : {};
  const tokensIn = num(src.tokensIn);
  const tokensOut = num(src.tokensOut);
  const cost = estimateCost({
    provider: src.provider, model: src.model, tokensIn, tokensOut, pricing: src.pricing
  });
  return sanitizeTrace({
    rid: str(src.rid, 24) || makeRequestId(src.seed),
    at: num(src.at) || Date.now(),
    callerRef: str(src.callerRef, 16),
    provider: str(src.provider, 24),
    model: str(src.model, 64),
    intent: str(src.intent, 32),
    tier: str(src.tier, 16),
    stream: !!src.stream,
    latencyMs: num(src.latencyMs),
    tokensIn,
    tokensOut,
    costUsd: cost.usd,
    priced: cost.priced,
    fallbackReason: str(src.fallbackReason, 32) || FALLBACK.NONE,
    promptVersion: str(src.promptVersion, 48),
    contextVersion: str(src.contextVersion, 32),
    agentVersion: str(src.agentVersion, 32),
    responseType: str(src.responseType, 32),
    validated: src.validated !== false
  });
}

/**
 * Normalise a trace: keep whitelisted fields, drop forbidden ones, coerce
 * numbers, clamp lengths. Corrupt input yields a minimal well-formed trace
 * rather than throwing, a bad log line must never break a chat.
 */
export function sanitizeTrace(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const out = {};
  for (const field of TRACE_FIELDS) {
    if (!(field in src)) continue;
    const v = src[field];
    if (field === 'stream' || field === 'validated' || field === 'priced') out[field] = !!v;
    else if (field === 'latencyMs' || field === 'tokensIn' || field === 'tokensOut' || field === 'at') out[field] = num(v);
    else if (field === 'costUsd') out[field] = (v === null || v === undefined) ? null : (Number.isFinite(Number(v)) ? Number(v) : null);
    else if (field === 'rid') out[field] = str(v, 24) || makeRequestId();
    else out[field] = str(v, field === 'model' ? 64 : 48);
  }
  if (!out.rid) out.rid = makeRequestId();
  if (!out.fallbackReason) out.fallbackReason = FALLBACK.NONE;
  if (out.tokensIn === undefined) out.tokensIn = 0;
  if (out.tokensOut === undefined) out.tokensOut = 0;
  return out;
}

/** Bounded append: newest kept, oldest dropped. Returns a new array. */
export function appendTrace(list, trace, max = MAX_TRACES) {
  const arr = Array.isArray(list) ? list.slice() : [];
  arr.push(sanitizeTrace(trace));
  return arr.length > max ? arr.slice(arr.length - max) : arr;
}

/** Parse a stored trace list; corrupt history reads as empty, never throws. */
export function parseTraces(raw, ref) {
  let parsed;
  try { parsed = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch (_) { return []; }
  if (!Array.isArray(parsed)) return [];
  const want = ref == null ? '' : String(ref);
  const out = [];
  for (const item of parsed) {
    if (!item || typeof item !== 'object') continue;
    const clean = sanitizeTrace(item);
    if (want && clean.callerRef !== want) continue;
    out.push(clean);
  }
  return out.slice(-MAX_TRACES);
}

/** Zeroed accumulator. */
export function emptyUsage() {
  return { requests: 0, tokensIn: 0, tokensOut: 0, usd: 0, unpriced: 0, fallbacks: 0 };
}

/**
 * Fold one trace into a usage total. Unpriced requests are counted separately so
 * a total is never read as complete when part of it has no known rate.
 */
export function addUsage(acc, trace) {
  const base = acc && typeof acc === 'object' ? acc : emptyUsage();
  const t = sanitizeTrace(trace);
  const priced = t.priced === true && typeof t.costUsd === 'number';
  return {
    requests: num(base.requests) + 1,
    tokensIn: num(base.tokensIn) + num(t.tokensIn),
    tokensOut: num(base.tokensOut) + num(t.tokensOut),
    usd: Math.round((num(base.usd) + (priced ? t.costUsd : 0)) * 1e6) / 1e6,
    unpriced: num(base.unpriced) + (priced ? 0 : 1),
    fallbacks: num(base.fallbacks) + (t.fallbackReason && t.fallbackReason !== FALLBACK.NONE ? 1 : 0)
  };
}

/** Daily-quota view for one caller. `used` comes from the existing rate counter. */
export function quotaState({ used = 0, cap = 80, warnAt = QUOTA_WARN_AT } = {}) {
  const u = num(used);
  const c = num(cap, 1) || 1;
  const remaining = Math.max(0, c - u);
  return {
    used: u,
    cap: c,
    remaining,
    exhausted: u >= c,
    warning: !(u >= c) && u >= Math.ceil(c * warnAt)
  };
}

/** One-line JSON for the Worker log sink. Newlines are stripped so a trace can
    never forge extra log lines. */
export function renderTrace(trace) {
  return JSON.stringify(sanitizeTrace(trace)).replace(/[\r\n]+/g, ' ');
}

/** Shape advertised by `agentStatus`, names and versions, never a capability. */
export function describeObservability() {
  return {
    version: OBSERVABILITY_VERSION,
    maxTraces: MAX_TRACES,
    fields: TRACE_FIELDS.slice(),
    fallbackReasons: Object.values(FALLBACK),
    pricedProviders: Object.keys(PRICING).filter(p => Object.keys(PRICING[p]).length > 0),
    tokenCount: 'estimate'
  };
}

/** Self-check, same contract as the other M-series engines: `[]` means healthy. */
export function validateObservability() {
  const problems = [];
  if (OBSERVABILITY_VERSION !== 'obs-v1') problems.push('version');
  if (!(MAX_TRACES > 0)) problems.push('maxTraces');
  if (Object.values(FALLBACK).length !== 8) problems.push('fallback-reasons');
  if (TRACE_FIELDS.includes('uid') || TRACE_FIELDS.includes('text')) problems.push('whitelist-leaks-content');
  for (const forbidden of FORBIDDEN_TRACE_KEYS) {
    if (TRACE_FIELDS.includes(forbidden)) problems.push('forbidden-in-whitelist:' + forbidden);
  }
  for (const provider of Object.keys(PRICING)) {
    for (const [model, rate] of Object.entries(PRICING[provider])) {
      if (!rate || typeof rate.in !== 'number' || typeof rate.out !== 'number') {
        problems.push('half-filled-rate:' + provider + ':' + model);
      }
    }
  }
  const probe = sanitizeTrace({ rid: 'x', latencyMs: -5, text: 'leak', uid: 'account-1' });
  if ('text' in probe || 'uid' in probe) problems.push('sanitize-keeps-forbidden');
  if (probe.latencyMs !== 0) problems.push('sanitize-negative-latency');
  return problems;
}
