// 🚨 PHASE 19, error monitoring (the P19 gap: "monitoring/error-tracking").
//
// The public Worker's fetch() already ends in a catch that turns a thrown error
// into a JSON 500. That reply told the *caller* something went wrong and told
// *nobody else*, an uncaught route error was invisible to the owner.
//
// Two rules shape this module, copied from observability.js:
//
//  1. **Never invent a number.** The log holds errors that actually happened.
//     Nothing is seeded, estimated or back-filled; an empty log means no error
//     was recorded, not that the feature is off.
//  2. **A log entry is not a transcript.** Messages are sanitised on the way in
//     (see sanitizeErrorText) so a credential caught inside an exception string
//     cannot be written to KV and later read back out through the admin route.
//     Only the path is kept, never the query string, a query can carry a token.

export const ERROR_LOG_KEY = 'errlog:v1';

/** Bounded: the newest MAX_KINDS signatures survive, the rest are dropped. */
export const MAX_KINDS = 50;

/** A single message is clipped so one huge exception cannot fill the record. */
export const MAX_MESSAGE = 180;

/**
 * Secrets that must never reach the log. Each pattern is replaced with
 * [REDACTED] rather than dropped, so a truncated key still reads as a key.
 * Same shapes the conversation backup redacts by (tools/backup-conversations.py).
 */
const SECRET_PATTERNS = [
  /\bsk-[A-Za-z0-9_-]{8,}/g,
  /\bghp_[A-Za-z0-9]{8,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{8,}/g,
  /\bAIza[0-9A-Za-z_-]{10,}/g,
  /\bck_[A-Za-z0-9]{8,}/g,
  /\bgsk_[A-Za-z0-9]{8,}/g,
  /\bxox[baprs]-[A-Za-z0-9-]{8,}/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/g,
  /\b\d{8,10}:[A-Za-z0-9_-]{30,}/g,
  /(password|passwd|secret|token|api[_-]?key|authorization)\s*[=:]\s*\S+/gi,
];

/** Replace every secret-shaped run in `text` with [REDACTED]. Pure. */
export function sanitizeErrorText(text) {
  let out = String(text == null ? '' : text);
  for (const re of SECRET_PATTERNS) out = out.replace(re, match =>
    /password|passwd|secret|token|api[_-]?key|authorization/i.test(match)
      ? match.replace(/[=:]\s*\S+/, '=[REDACTED]')
      : '[REDACTED]');
  return out.slice(0, MAX_MESSAGE);
}

/**
 * The identity of an error, for grouping repeats. The same route failing the
 * same way 500 times is one kind with count 500, not 500 entries, a bounded
 * log has to group or a loop would evict everything else.
 */
export function errorSignature(path, message) {
  return `${path || '/'} :: ${sanitizeErrorText(message)}`;
}

/** One recorded failure. `path` is pathname-only; the query string is dropped. */
export function makeErrorEntry({ path, method, status, message, at }) {
  return {
    path: String(path || '/').slice(0, 120),
    method: String(method || 'GET').toUpperCase().slice(0, 10),
    status: Number(status) || 500,
    message: sanitizeErrorText(message),
    at: Number(at) || 0,
  };
}

/**
 * Fold a new failure into the existing log. Pure: returns the new log and never
 * mutates the input. A repeat of a known signature bumps its count and moves it
 * to the front (newest first); a new signature is unshifted and the log is
 * trimmed to MAX_KINDS.
 */
export function appendError(log, entry) {
  const list = Array.isArray(log) ? log.slice() : [];
  const sig = errorSignature(entry.path, entry.message);
  const idx = list.findIndex(e => e && e.sig === sig);
  if (idx >= 0) {
    const seen = list[idx];
    list[idx] = {
      ...seen,
      count: (Number(seen.count) || 1) + 1,
      lastAt: entry.at,
      method: entry.method,
      status: entry.status,
      message: entry.message,
    };
    return list.slice(0, MAX_KINDS);
  }
  list.unshift({ sig, count: 1, firstAt: entry.at, lastAt: entry.at, ...entry });
  return list.slice(0, MAX_KINDS);
}

/** Total failures across every kind, the honest "how many" for the owner. */
export function totalErrors(log) {
  return (Array.isArray(log) ? log : []).reduce((n, e) => n + (Number(e?.count) || 0), 0);
}

/** The admin view: real counts, newest first, nothing invented. */
export function summarizeErrors(log) {
  const list = Array.isArray(log) ? log : [];
  return {
    ok: true,
    kinds: list.length,
    total: totalErrors(list),
    errors: list.map(e => ({
      path: e.path,
      method: e.method,
      status: e.status,
      message: e.message,
      count: Number(e.count) || 1,
      firstAt: e.firstAt || e.at || 0,
      lastAt: e.lastAt || e.at || 0,
    })),
  };
}

/**
 * Record a failure through the catch block. Best-effort: a monitoring write must
 * never turn a handled 500 into a thrown one, so every failure here is swallowed
 * and the caller always continues. No-op when the KV binding is absent.
 */
export async function recordError(env, { path, method, status, message, now } = {}) {
  try {
    if (!env || !env.PUB_KV || typeof env.PUB_KV.get !== 'function') return;
    const entry = makeErrorEntry({ path, method, status, message, at: (now || Date.now)() });
    const raw = await env.PUB_KV.get(ERROR_LOG_KEY);
    let log = [];
    try { log = raw ? JSON.parse(raw) : []; } catch (_) { log = []; }
    const next = appendError(log, entry);
    await env.PUB_KV.put(ERROR_LOG_KEY, JSON.stringify(next));
  } catch (_) { /* monitoring is best-effort; never mask the original error */ }
}
