/* Put the provider credentials where BOTH Workers can read them.
 *
 * WHY THIS EXISTS. F0.1 step 4j measured the two rooms and found a real
 * difference: admission-gk can reach `cloudflare` (its API key lives in that
 * Worker's environment) and sky-ai cannot, because sky-ai's environment has no
 * such variable. The result was not an outage — chat simply declined and
 * admission-gk kept answering — but "the split is done" was not true, and the
 * only reason anyone knew is that the two lists were finally compared.
 *
 * The fix is not to copy a secret by hand. Both Workers already bind the SAME KV
 * namespace and aiKeyOverlay() already prefers KV for everything it cannot find in
 * env, so a credential placed in KV is visible to both rooms by construction. This
 * module performs that move from inside the Worker that owns the variable:
 *
 *   read env → read KV secret:AI_KEYS → write back only the names that are
 *   missing, and only if something was actually missing.
 *
 * WHAT IT WILL NEVER DO:
 *   - overwrite a value that is already in KV (an operator may have rotated one
 *     there deliberately; env is only used to fill a gap);
 *   - log, return or report any secret — the result carries NAMES only;
 *   - write on every request. A missing name is added once; after that the KV blob
 *     already contains it, so the check finds nothing to do and stops. One
 *     isolate-local flag also skips the read entirely after the first pass.
 *   - fail a request. Every path is best-effort; a KV problem leaves the
 *     deployment exactly as it is today.
 */
import { PROVIDER_KEY_NAMES } from './ai-agent.js';

const KV_KEY = 'secret:AI_KEYS';

/* One attempt per isolate is enough: the KV blob is the durable record, and the
 * read below is cheap but pointless to repeat on every request. Exported for
 * tests, which need a fresh state per case. */
let doneInThisIsolate = false;
export const __resetKeySyncForTests = () => { doneInThisIsolate = false; };

/* OFF BY DEFAULT, because of what happened after the first deploy.
 *
 * First run (2026-10-25) reported `parity: { ok: false, needed: ["cloudflare","gemini"] }`
 * — a SHORTER list than the eight providers admission-gk could reach before, and
 * sky-ai's own list dropped from seven to none. Something emptied or unreadable-ised
 * `secret:AI_KEYS`, and this module is the only code that writes it. Rather than
 * reason about that from outside, the automatic pass is disabled until the blob's
 * shape can be observed directly (see aiKeyBlobShape and /health).
 *
 * `force` still works, so the function and its tests stay honest — but nothing calls
 * it automatically while AI_KEY_SYNC is not explicitly "on". */
export async function syncProviderKeysToKv(env, { force = false } = {}) {
  const armed = String((env && env.AI_KEY_SYNC) || '').toLowerCase() === 'on';
  if (!armed && !force) return { ok: true, skipped: 'disabled', added: [] };
  if (!force && doneInThisIsolate) return { ok: true, skipped: 'already-checked', added: [] };
  doneInThisIsolate = true;
  const kv = env && env.PUB_KV;
  if (!kv || typeof kv.get !== 'function' || typeof kv.put !== 'function') {
    return { ok: false, reason: 'no-kv', added: [] };
  }
  let blob = {};
  try {
    const raw = await kv.get(KV_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) blob = parsed;
  } catch (_) {
    /* A malformed blob is treated as empty rather than overwritten with junk:
       we would rather copy nothing than destroy an operator's file. */
    return { ok: false, reason: 'unreadable', added: [] };
  }

  const added = [];
  const next = { ...blob };
  for (const name of PROVIDER_KEY_NAMES) {
    if (next[name] && String(next[name]).trim()) continue; // KV wins; never overwrite
    const value = String((env && env[name]) || '').trim();
    if (!value) continue; // this Worker does not have it either
    next[name] = value;
    added.push(name);
  }
  if (!added.length) return { ok: true, added: [] };

  try { await kv.put(KV_KEY, JSON.stringify(next)); } catch (_) { return { ok: false, reason: 'write-failed', added: [] }; }
  // NAMES only. The values must never reach a log.
  return { ok: true, added };
}
