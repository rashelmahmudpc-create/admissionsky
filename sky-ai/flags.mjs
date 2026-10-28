/* Sky AI feature flags + canary, F0.2 / DV-02 (blueprint v1.0).
 *
 * One flag = { on, percent, beta, killed }:
 *   killed  -> always off (kill switch, wins over everything)
 *   beta    -> listed uids are always on (when the flag is on)
 *   percent -> stable canary bucket: hash(flag + ':' + uid) % 100 < percent
 * Defaults live here and are all OFF, so shipping this file changes nothing
 * for students. An optional KV binding SKY_FLAGS (key "flags:v1", JSON) can
 * override them later without a code change; any KV error falls back to the
 * defaults. Unknown flags are always off.
 */

export const FLAGS_KEY = 'flags:v1';

export const DEFAULT_FLAGS = Object.freeze({
  /* F0.1 follow-up: move /api/ai/* traffic to sky-ai step by step. */
  'sky.route_via_binding': Object.freeze({ on: false, percent: 0, beta: Object.freeze([]), killed: false })
});

/* FNV-1a 32-bit: tiny, sync and deterministic, so one uid always lands in the
 * same bucket for a given flag (no flapping between requests). */
export function bucket(flag, uid) {
  const s = String(flag) + ':' + String(uid);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h % 100;
}

function normalize(f) {
  if (!f || typeof f !== 'object') return null;
  const pct = Number(f.percent);
  return {
    on: f.on === true,
    percent: Number.isFinite(pct) ? Math.min(100, Math.max(0, Math.floor(pct))) : 0,
    beta: Array.isArray(f.beta) ? f.beta.filter((u) => typeof u === 'string' && u) : [],
    killed: f.killed === true
  };
}

export function isEnabled(flags, name, uid) {
  const f = normalize(flags && Object.prototype.hasOwnProperty.call(flags, name) ? flags[name] : null);
  if (!f || f.killed || !f.on) return false;
  if (uid && f.beta.includes(uid)) return true;
  if (f.percent >= 100) return true;
  if (!uid || f.percent <= 0) return false;
  return bucket(name, uid) < f.percent;
}

export async function loadFlags(env = {}) {
  const merged = { ...DEFAULT_FLAGS };
  const kv = env && env.SKY_FLAGS;
  if (!kv || typeof kv.get !== 'function') return merged;
  try {
    const raw = await kv.get(FLAGS_KEY);
    if (!raw) return merged;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      for (const [k, v] of Object.entries(parsed)) {
        const n = normalize(v);
        if (n) merged[k] = n;
      }
    }
  } catch (_) { /* bad JSON or KV outage: keep the safe defaults */ }
  return merged;
}

export function evaluateAll(flags, uid) {
  const out = {};
  for (const name of Object.keys(flags || {})) out[name] = isEnabled(flags, name, uid);
  return out;
}
