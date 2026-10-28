/* Admission Hub, P14 public-API abuse guard.
 *
 * The public surface (AI chat/actions, content writes) is reachable without a
 * login, so it needs a ceiling that does not depend on the caller being honest.
 * This is a fixed-window per-network counter in PUB_KV: one read + at most one
 * write per guarded request, cheap enough for the Free plan.
 *
 * Two independent ceilings exist by design:
 *   - per anonymous DEVICE (inside agentChat) for a fair-share quota;
 *   - per NETWORK here, so opening a new device/browser does not reset the
 *     ceiling. A shared IP (campus/café) is served generously, not starved.
 *
 * Pure logic only, no KV binding is touched unless one is passed in, so the
 * whole thing is unit-testable with a Map-backed fake.
 */
export const RATE_DEFAULTS = Object.freeze({ limit: 120, windowMs: 60000 });

const clamp = (value, lo, hi, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : fallback;
};

export function clientNetwork(request) {
  const header = request && request.headers;
  const raw = header && (header.get('CF-Connecting-IP') || header.get('X-Forwarded-For'));
  return String(raw || 'unknown').split(',')[0].trim() || 'unknown';
}

export async function networkHash(request, salt = '') {
  const bytes = await crypto.subtle.digest(
    'SHA-256', new TextEncoder().encode(`${clientNetwork(request)}|${salt}`)
  );
  return [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 24);
}

/* Every guarded path must be idempotent to compute and cheap: a GET of static
   content is edge-cached and must NOT burn a KV write; only AI and writes are
   counted. */
export function isGuarded(request, path) {
  if (!path || path === '/api/health') return false;
  if (path.startsWith('/api/admin/')) return false;      // token-gated, separate guard
  if (path.startsWith('/api/ai')) return true;           // chat, prefs, actions, status
  return request && request.method !== 'GET' && request && request.method !== 'HEAD';
}

export function windowKey(hash, now, windowMs) {
  return `rlpub:${hash}:${Math.floor(now / windowMs)}`;
}

/* Fixed-window per-network counter. The Durable Object is preferred when bound:
   it is one of the three KV writes a chat that capped the free plan, and the DO
   free allowance is 100,000 requests a day. Returns null when the binding is
   absent so the KV path below stays the fallback. */
async function consumeViaDo(env, hash, limit, windowMs, now) {
  const binding = env && env.AI_STATE;
  if (!binding || typeof binding.idFromName !== 'function' || typeof binding.get !== 'function') return null;
  try {
    const stub = binding.get(binding.idFromName('net:' + hash));
    const response = await stub.fetch(new Request('https://ai-state/rate/consume', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ limit, windowMs, now })
    }));
    if (!response.ok) return null;
    return await response.json();
  } catch (_) { return null; }
}

/* Returns { allowed, remaining, limit, retryAfter }, never throws. A KV failure
   fails OPEN (allowed) so a lookup hiccup never bricks the public site; the
   per-device cap inside agentChat still backs the AI path. */
export async function checkAbuse(request, env, opts = {}) {
  const limit = clamp(opts.limit ?? (env && env.PUBLIC_RATE_LIMIT), 1, 5000, RATE_DEFAULTS.limit);
  const windowMs = clamp(opts.windowMs ?? (env && env.PUBLIC_RATE_WINDOW_MS), 1000, 3600000, RATE_DEFAULTS.windowMs);
  const now = Number(opts.now) || Date.now();
  const store = env && env.PUB_KV;
  const hasDo = Boolean(env && env.AI_STATE && typeof env.AI_STATE.idFromName === 'function');
  if (!store && !hasDo) return { allowed: true, limit, windowMs, remaining: limit };
  const hash = await networkHash(request, opts.salt || '');
  if (hasDo) {
    const viaDo = await consumeViaDo(env, hash, limit, windowMs, now);
    if (viaDo) {
      return viaDo.allowed === false
        ? { allowed: false, limit: viaDo.limit, windowMs: viaDo.windowMs, remaining: 0, retryAfter: viaDo.retryAfter }
        : { allowed: true, limit: viaDo.limit, windowMs: viaDo.windowMs, remaining: viaDo.remaining };
    }
  }
  if (!store) return { allowed: true, limit, windowMs, remaining: limit };
  const key = windowKey(hash, now, windowMs);
  let count = 0;
  try { count = Number(await store.get(key)) || 0; } catch (_) { return { allowed: true, limit, windowMs, remaining: limit }; }
  if (count >= limit) {
    const retryAfter = Math.max(1, Math.ceil((windowMs - (now % windowMs)) / 1000));
    return { allowed: false, limit, windowMs, remaining: 0, retryAfter };
  }
  try { await store.put(key, String(count + 1), { expirationTtl: Math.ceil(windowMs / 1000) + 2 }); } catch (_) {}
  return { allowed: true, limit, windowMs, remaining: limit - count - 1 };
}

/* Non-mutating view (used by tests and health): current count for this window. */
export async function peekAbuse(request, env, opts = {}) {
  const store = env && env.PUB_KV;
  if (!store) return 0;
  const now = Number(opts.now) || Date.now();
  const windowMs = clamp(opts.windowMs ?? (env && env.PUBLIC_RATE_WINDOW_MS), 1000, 3600000, RATE_DEFAULTS.windowMs);
  const hash = await networkHash(request, opts.salt || '');
  try { return Number(await store.get(windowKey(hash, now, windowMs))) || 0; } catch (_) { return 0; }
}
