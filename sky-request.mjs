/* F0.5 / GW-07 — the request id, and what it is for.
 *
 * The gateway already had the *mechanism*: admission-gk mints one id per chat
 * and hands the same id to both the sky-ai hop and the local fallback, and the
 * Durable Object remembers the quota decision against it. That is what makes a
 * message answered by sky-ai and then re-answered by the fallback cost one
 * credit instead of two.
 *
 * Two gaps remained, and this file closes both:
 *
 *   1. The id was minted per HTTP REQUEST, not per TURN. A retry — the client
 *      re-sending the turn it just failed to get an answer for — arrived as a
 *      brand-new id, so it spent a second message from the student's daily
 *      allowance. That is the opposite of what the id is for, and it is the one
 *      place a duplicate costs the student something real.
 *
 *   2. The id was never RETURNED. It rode in the Worker log line, but nothing
 *      reached the student or the client, so "my answer was cut off" could not
 *      be tied to the request that produced it. A correlation id that only one
 *      side can see does not correlate anything.
 *
 * The rule this file encodes: ONE ID PER TURN. The client mints it, the server
 * honours it when it is well-formed, and it is echoed back on `done`. A retry
 * carries the same id and replays the first decision; a new question mints a
 * new id and is charged normally.
 *
 * The id is NOT a security boundary and is not treated as one. It is scoped to
 * one student by the Durable Object it lands in (one object per uid), so a
 * forged id can only replay that same student's own decision — it can never
 * borrow someone else's, and it can never grant an unlimited allowance because
 * every id is stored once and expires with the 24-hour window.
 */

export const SKY_REQUEST_ID_HEADER = 'x-sky-req-id';

/* Deliberately strict. A caller-supplied id is stored as a storage key, so it
   must be short and must not carry anything a key cannot (no spaces, no ':' to
   collide with the 'quotaid:' prefix, no control characters). Anything that
   does not match is ignored and the server mints its own — a bad id must never
   fail a chat. */
const REQ_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

/** A well-formed id, or '' for anything else. Never throws. */
export function normalizeRequestId(raw) {
  const s = String(raw == null ? '' : raw).trim();
  return REQ_ID_RE.test(s) ? s : '';
}

/** A fresh id for one turn. `crypto.randomUUID` exists in a Worker and in the
    browser; the fallback keeps a test or an old runtime working. */
export function mintRequestId() {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch (_) { /* fall through to the timestamp form */ }
  return 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

/** The id carried by a request, or '' when it carries none. */
export function requestIdFrom(request) {
  try {
    return normalizeRequestId(request && request.headers && request.headers.get(SKY_REQUEST_ID_HEADER));
  } catch (_) { return ''; }
}

/* The client keeps its id for a turn, so a retry replays instead of recharging.
   `turnId` is the decision: reuse the id the caller already has for THIS turn,
   otherwise mint one. Exported so the client and a test share one rule. */
export function turnId(held) {
  return normalizeRequestId(held) || mintRequestId();
}
