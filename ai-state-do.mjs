/* Admission Hub, per-user AI state in a Durable Object.
 *
 * Why this exists: the AI chat path wrote to Workers KV three times per message
 * (a rate counter, a memory blob, and the abuse guard's per-network counter).
 * On the Workers Free plan KV allows 1,000 writes a day, so the whole app was
 * capped at roughly 300-500 chats a day no matter how few students used it. The
 * Durable Objects free tier allows 100,000 requests a day, about a hundred times
 * that, and the app already runs three SQLite-backed objects.
 *
 * One object per user. A Durable Object is single-threaded per instance, so the
 * read-modify-write in consume() needs no lock: two messages from the same
 * student cannot both see the same "used" count.
 *
 * The wire format is deliberately tiny and JSON-only, matching the existing
 * EmailGatewayCoordinator store, so it is unit-testable with a fake ctx.
 */

import { cleanInc } from './sky-daily-report.mjs';

export const AI_STATE_VERSION = 'ai-state-v1';

/* Matches the KV default in ai-agent.js so behaviour does not shift when the
   storage moves. The cap itself is passed in, never read from storage. */
export const RL_WINDOW_MS = 24 * 60 * 60 * 1000;

const K_QUOTA = 'quota';
/* One entry per quota-consuming request id, so a request that is retried (or
   answered by admission-gk after sky-ai already counted it) is not counted
   twice. Kept only for an allowed decision: a refusal wrote nothing, so replaying
   it costs nothing either. */
const K_QUOTA_ID = (id) => 'quotaid:' + id;

/* F0.5 / GW-07: how long a request id may be replayed. This is what keeps
   idempotency from becoming a quota bypass. The id exists so a RETRY — the
   client re-sending a turn whose answer was lost — does not spend a second
   message. Without a bound, pressing "আবার" on the same question would answer
   for free for as long as the entry lives (a whole 24-hour window), which is a
   student getting unlimited answers from one credit. Five minutes covers every
   real retry (a reconnect, a dropped stream, a double tap) and nothing else. */
export const REPLAY_WINDOW_MS = 5 * 60 * 1000;

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json' }
});

const num = (v, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

/* Storage entries are `{ v, exp }` rather than bare values so a key can expire
   like its KV counterpart did; a Durable Object has no per-key TTL. An expired
   entry reads as absent and is deleted on the way out. */
export class AiStateObject {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
  }

  async #entry(key) {
    const raw = await this.ctx.storage.get(key);
    if (!raw || typeof raw !== 'object') return null;
    if (raw.exp && num(raw.exp) <= Date.now()) {
      await this.ctx.storage.delete(key).catch(() => {});
      return null;
    }
    return raw;
  }

  /* Rolling 24-hour window, first message starts it, the same rule the KV
     version used, so a Dhaka morning does not hand out a second allowance. */
  async consume({ uid, cap, now, reqId }) {
    const limit = Math.max(1, Math.min(500, num(cap, 10)));
    const t = num(now, Date.now());
    const rid = String(reqId || '').trim();
    /* Idempotent by request id. F0.1 step 4h: once chat can be answered by either
       Worker, a retry must not spend a second message from the student's daily
       allowance. The stored decision is returned verbatim, with `replayed` so a
       caller can tell it apart while debugging. */
    if (rid) {
      const prior = await this.#entry(K_QUOTA_ID(rid));
      /* Only a RECENT decision replays. A stale id is treated as a new request,
         so the bound above cannot be widened by holding an id. */
      if (prior && prior.v && (t - num(prior.v.at, 0)) < REPLAY_WINDOW_MS) {
        return { ...prior.v, replayed: true };
      }
    }
    const cur = await this.#entry(K_QUOTA);
    let n = cur ? num(cur.v && cur.v.n) : 0;
    let start = cur && cur.v ? num(cur.v.start, t) : t;
    if (t - start >= RL_WINDOW_MS) { n = 0; start = t; }
    if (n >= limit) {
      return { allowed: false, used: n, cap: limit, remaining: 0, start, uid: String(uid || '') };
    }
    await this.ctx.storage.put(K_QUOTA, { v: { n: n + 1, start }, exp: 0 });
    const decision = { allowed: true, used: n + 1, cap: limit, remaining: limit - n - 1, start, uid: String(uid || '') };
    if (rid) {
      /* `at` is the replay clock and the expiry is the replay window, not the
         24-hour quota window: the entry is only useful while a retry is
         plausible, so it is not kept a day longer than that. */
      try { await this.ctx.storage.put(K_QUOTA_ID(rid), { v: { ...decision, at: t }, exp: t + REPLAY_WINDOW_MS }); } catch (_) { /* counting still happened */ }
    }
    return decision;
  }

  /* AI audit 2026-10-16: give back one credit for a message the AI never
     answered. Never goes below zero and keeps the window start. */
  async refund() {
    const cur = await this.#entry(K_QUOTA);
    if (!cur || !cur.v) return { ok: true, used: 0 };
    const n = Math.max(0, num(cur.v.n) - 1);
    await this.ctx.storage.put(K_QUOTA, { v: { n, start: num(cur.v.start, Date.now()) }, exp: 0 });
    return { ok: true, used: n };
  }

  /* Delete named keys (memory reset). Only keys the caller names, the quota
     and rate keys are refused, so clearing memory can never reset a cap. */
  async deleteState({ keys }) {
    const list = (Array.isArray(keys) ? keys : []).map(String)
      .filter(k => k && k !== K_QUOTA && !k.startsWith('rate:')).slice(0, 32);
    for (const k of list) await this.ctx.storage.delete(k).catch(() => {});
    return { ok: true, deleted: list.length };
  }

  async getState({ key, now }) {
    const entry = await this.#entry(String(key));
    return { value: entry ? entry.v : null };
  }

  async putState({ key, value, ttlMs }) {
    const ttl = num(ttlMs);
    const exp = ttl > 0 ? Date.now() + ttl : 0;
    await this.ctx.storage.put(String(key), { v: value, exp });
    return { ok: true };
  }

  /* Fixed-window per-network counter, the Durable Object half of the P14 abuse
     guard. Same arithmetic as p14-abuse-guard.mjs so the two agree. */
  async consumeRate({ limit, windowMs, now }) {
    const lim = Math.max(1, Math.min(5000, num(limit, 120)));
    const win = Math.max(1000, Math.min(3600000, num(windowMs, 60000)));
    const t = num(now, Date.now());
    const key = 'rate:' + Math.floor(t / win);
    const cur = await this.#entry(key);
    const count = cur ? num(cur.v) : 0;
    if (count >= lim) {
      const retryAfter = Math.max(1, Math.ceil((win - (t % win)) / 1000));
      return { allowed: false, limit: lim, windowMs: win, remaining: 0, retryAfter };
    }
    /* The window index in the key already separates windows, so this entry is
       only cleanup: it expires on the real clock, never on the caller's `now`,
       which in a test is a small fixed number and would expire it instantly. */
    await this.ctx.storage.put(key, { v: count + 1, exp: Date.now() + win + 2000 });
    return { allowed: true, limit: lim, windowMs: win, remaining: lim - count - 1 };
  }

  /* Anonymous daily AI counters (sky-daily-report.mjs). Only whitelisted
     numeric fields are kept; a day expires after 40 days. Single-threaded, so
     the read-modify-write needs no lock. */
  async bumpStats({ day, inc }) {
    const d = String(day || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return { ok: false };
    const clean = cleanInc(inc);
    const key = 'stats:' + d;
    const cur = (await this.#entry(key)) || { v: {} };
    const v = Object.assign({}, cur.v || {});
    for (const k of Object.keys(clean)) v[k] = num(v[k]) + clean[k];
    await this.ctx.storage.put(key, { v, exp: Date.now() + 40 * 86400000 });
    return { ok: true };
  }

  async getStats({ day }) {
    const entry = await this.#entry('stats:' + String(day || '').slice(0, 10));
    return { stats: entry ? cleanInc(entry.v) : {} };
  }

  async fetch(request) {
    const path = new URL(request.url).pathname;
    let body = {};
    if (request.method === 'POST') body = await request.json().catch(() => ({}));
    try {
      switch (path) {
        case '/quota/consume': return json(await this.consume(body));
        case '/state/get': return json(await this.getState(body));
        case '/state/put': return json(await this.putState(body));
        case '/state/delete': return json(await this.deleteState(body));
        case '/quota/refund': return json(await this.refund(body));
        case '/rate/consume': return json(await this.consumeRate(body));
        case '/stats/bump': return json(await this.bumpStats(body));
        case '/stats/get': return json(await this.getStats(body));
        default: return json({ error: 'not_found' }, 404);
      }
    } catch (error) {
      return json({ error: 'ai_state_error', message: String((error && error.message) || error) }, 500);
    }
  }
}

/* Client used from the Worker. Returns null when the binding is absent, which is
   what keeps every caller's KV fallback, and the existing tests, working. */
export function aiStateStore(env) {
  const binding = env && env.AI_STATE;
  if (!binding || typeof binding.idFromName !== 'function' || typeof binding.get !== 'function') return null;

  const call = async (uid, path, body) => {
    const stub = binding.get(binding.idFromName(String(uid)));
    const response = await stub.fetch(new Request('https://ai-state' + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {})
    }));
    if (!response.ok) throw new Error('ai-state-' + response.status);
    return response.json();
  };

  return {
    version: AI_STATE_VERSION,
    consumeQuota: (uid, cap, reqId) => call(uid, '/quota/consume', { cap, reqId }),
    get: async (uid, key) => (await call(uid, '/state/get', { key })).value,
    put: (uid, key, value, ttlMs) => call(uid, '/state/put', { key, value, ttlMs }),
    del: (uid, keys) => call(uid, '/state/delete', { keys }),
    refundQuota: (uid) => call(uid, '/quota/refund', {}),
    consumeRate: (uid, limit, windowMs, now) => call(uid, '/rate/consume', { limit, windowMs, now })
  };
}
