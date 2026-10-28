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
 *   - CREATE the blob. If `secret:AI_KEYS` does not read back, this stops. The
 *     first deploy of this module read no blob (a KV miss) and wrote env-only
 *     names, which replaced an eight-name file with three — the very accident
 *     that made 4l necessary. A shared credential file is created by the
 *     owner-authorised workflow (ai-key-set.yml), never by request-path code;
 *   - shrink it: the merged file must hold at least every name it held before,
 *     and an empty or non-object file is a read problem, not an invitation;
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
  let blob = null;
  try {
    const raw = await kv.get(KV_KEY);
    /* A MISS IS NOT AN EMPTY FILE. `null` here can mean "no such key" or "this
       read did not reach the storage" — and the two are indistinguishable from
       inside a Worker. Treating the second as the first is what replaced the
       eight-name file with three names on the first deploy: the merge was
       correct, the input was not. So: no blob, no write. */
    if (!raw) return { ok: true, skipped: 'no-blob', added: [] };
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ok: false, reason: 'not-an-object', added: [] };
    }
    if (!Object.keys(parsed).length) return { ok: false, reason: 'empty-blob', added: [] };
    blob = parsed;
  } catch (_) {
    /* Malformed: leave it exactly as it is. We would rather copy nothing than
       destroy a file we cannot read. */
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
  /* Cannot happen with the merge above, and asserted anyway: this module is only
     allowed to add. A write that would drop a name is refused, not attempted. */
  for (const name of Object.keys(blob)) {
    if (!(name in next)) return { ok: false, reason: 'would-shrink', added: [] };
  }

  try { await kv.put(KV_KEY, JSON.stringify(next)); } catch (_) { return { ok: false, reason: 'write-failed', added: [] }; }
  // NAMES only. The values must never reach a log.
  return { ok: true, added };
}
