// 🛰️ PHASE 26, client error reporting to Sentry (owner order 2026-10-17).
//
// The P19 monitor (`p19-error-monitor.mjs`) records failures the *Worker* sees.
// An error that happens inside the student's browser, a thrown handler, a
// rejected promise, never reaches it, so the owner hears about those only when
// a student complains. This module closes that gap: it reports those failures
// to Sentry, where the owner's agent reads them and tells him in Bengali.
//
// Four rules shape this module:
//
//  1. **Never send student data.** The payload carries the error, the pathname
//     and the user agent, never a uid, email, phone, name, or the query string
//     (a query can carry a token or an id). `buildEvent` is the only thing that
//     assembles a payload and it copies from an allowlist, so a caller cannot
//     leak a field by adding one.
//  2. **A message is not a transcript.** Error text is sanitised on the way in
//     with the same secret shapes P19 uses, so a credential caught inside an
//     exception string cannot be published to a third party.
//  3. **Never break the page.** Every entry point is wrapped; a failure to
//     report must never become a second error. No script is loaded from a
//     third-party CDN, the module talks to the ingest host itself, so no CSP
//     `script-src` change is needed.
//  4. **Bounded.** A render loop that throws 10,000 times must not send 10,000
//     events: repeats collapse by signature and a hard cap ends the page's
//     quota. What is sent is counted, never estimated.

export const SENTRY_VERSION = 'sentry-report-v1';

/**
 * The project DSN. A DSN is a *public* write-only key, it is meant to ship in
 * client code, and it can do nothing but submit events to this one project.
 * Kept here rather than fetched so reporting works on the very first error,
 * before any network round-trip has completed.
 */
export const SENTRY_DSN =
  'https://1b0f3f02a41435f2e85ffd6236ae5493@o4512198814072832.ingest.de.sentry.io/4512271394799696';

/** Repeats of one signature are counted; distinct signatures are capped. */
export const MAX_EVENTS = 20;

/** A single message is clipped so one huge exception cannot fill the payload. */
export const MAX_MESSAGE = 500;

/** Same shapes P19 redacts by; kept in step with p19-error-monitor.mjs. */
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

/** Replace every secret-shaped run with [REDACTED]. Pure. */
export function sanitizeText(text) {
  let out = String(text == null ? '' : text);
  for (const re of SECRET_PATTERNS) {
    out = out.replace(re, (match) =>
      /password|passwd|secret|token|api[_-]?key|authorization/i.test(match)
        ? match.replace(/[=:]\s*\S+/, '=[REDACTED]')
        : '[REDACTED]');
  }
  return out.slice(0, MAX_MESSAGE);
}

/**
 * Split a DSN into the three parts the store endpoint needs, or null when the
 * string is not a DSN. Pure, the caller decides what to do with a null.
 */
export function parseDsn(dsn) {
  const m = String(dsn || '').match(
    /^https?:\/\/([^@/]+)@([^/]+)\/(\d+)$/);
  if (!m) return null;
  return { key: m[1], host: m[2], projectId: m[3] };
}

/**
 * Pathname only. The query string and hash are dropped deliberately: they are
 * the most likely place for a token, an email or a student id to be sitting.
 * Pure.
 */
export function safePath(url) {
  try {
    const u = new URL(String(url || ''), 'https://x.invalid');
    return (u.pathname || '/').slice(0, 200);
  } catch {
    return '/';
  }
}

/**
 * Which errors are worth a network round-trip. A bare "Script error." from a
 * cross-origin frame carries no message, no line and no stack, so sending it
 * would spend the quota on nothing. Pure.
 */
export function isReportable(message, filename) {
  const msg = String(message == null ? '' : message).trim();
  if (!msg) return false;
  if (msg === 'Script error.' || msg === 'Script error') return false;
  // A browser-extension frame is not our code and not fixable by us.
  if (/^(chrome|moz|safari|ms-browser)-extension:\/\//i.test(String(filename || ''))) {
    return false;
  }
  return true;
}

/** The identity of an error, for collapsing repeats. Pure. */
export function signatureOf(message, path) {
  return `${path || '/'} :: ${sanitizeText(message).slice(0, 160)}`;
}

/**
 * Build the exact JSON Sentry receives. The allowlist is here and nowhere else:
 * every field is named, so a caller cannot add a uid or an email to the event
 * by passing one in. Pure.
 */
export function buildEvent({ message, path, source, at, userAgent, release } = {}) {
  const clean = sanitizeText(message) || 'unknown error';
  return {
    event_id: randomHex32(),
    timestamp: new Date(Number(at) || Date.now()).toISOString(),
    platform: 'javascript',
    level: 'error',
    logger: 'admission-hub',
    environment: 'production',
    ...(release ? { release: String(release).slice(0, 64) } : {}),
    tags: { source: String(source || 'unknown').slice(0, 40) },
    request: { url: `https://admission-hub.invalid${safePath(path)}` },
    exception: { values: [{ type: 'Error', value: clean }] },
    extra: { userAgent: String(userAgent || '').slice(0, 200) },
    breadcrumbs: [],
  };
}

/** 32 lowercase hex chars, as the store endpoint requires. */
export function randomHex32() {
  const b = new Uint8Array(16);
  try {
    (globalThis.crypto || {}).getRandomValues?.(b);
  } catch { /* fall through to Math.random */ }
  for (let i = 0; i < b.length; i++) {
    if (!b[i]) b[i] = Math.floor(Math.random() * 256);
  }
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

/**
 * A counter that decides which repeats go out. Kept separate from the network
 * so the decision is testable without a request. Pure apart from its own Map.
 */
export function makeQuota(max = MAX_EVENTS) {
  const seen = new Map();
  let sent = 0;
  return {
    /** true when this signature should be sent (and records it). */
    take(signature) {
      if (sent >= max) return false;
      const n = (seen.get(signature) || 0) + 1;
      seen.set(signature, n);
      // First sighting and the tenth of a repeat: enough to see a loop without
      // spending the quota on it.
      if (n !== 1 && n !== 10) return false;
      sent += 1;
      return true;
    },
    get sent() { return sent; },
    get kinds() { return seen.size; },
  };
}

/**
 * Send one event. Never throws: a failure to report is not an error.
 * `navigator.sendBeacon` is preferred because it survives a page unload, with
 * `fetch(keepalive)` as the fallback.
 */
export function post(dsn, event, fetchImpl) {
  const parsed = parseDsn(dsn);
  if (!parsed) return false;
  const body = JSON.stringify(event);
  const url = `https://${parsed.host}/api/${parsed.projectId}/store/`;
  const headers = {
    'Content-Type': 'application/json',
    'X-Sentry-Auth': `Sentry sentry_version=7, sentry_key=${parsed.key}, sentry_client=${SENTRY_VERSION}`,
  };
  try {
    const nav = globalThis.navigator;
    if (nav && typeof nav.sendBeacon === 'function' && !fetchImpl) {
      // sendBeacon cannot set headers, so the auth rides in the query string
      // (the documented fallback for beacon transports).
      const q = `${url}?sentry_key=${encodeURIComponent(parsed.key)}&sentry_version=7&sentry_client=${encodeURIComponent(SENTRY_VERSION)}`;
      if (nav.sendBeacon(q, new Blob([body], { type: 'application/json' }))) return true;
    }
    const f = fetchImpl || globalThis.fetch;
    if (typeof f !== 'function') return false;
    const p = f.call(globalThis, url, { method: 'POST', headers, body, keepalive: true });
    if (p && typeof p.catch === 'function') p.catch(() => {});
    return true;
  } catch {
    return false;
  }
}

/**
 * P27, the owner's phone alert (owner order 2026-10-17).
 *
 * This goes to our own Worker, not to Telegram: the bot token stays server-side
 * (a token in the browser can be read by anyone), and the request stays
 * same-origin so `connect-src 'self'` still covers it. Never throws, for the
 * same reason `post` never throws.
 */
export const ALERT_URL = '/api/report-error';

export function postAlert(url, event, fetchImpl) {
  try {
    if (!url) return false;
    const body = JSON.stringify(event);
    const nav = globalThis.navigator;
    if (nav && typeof nav.sendBeacon === 'function' && !fetchImpl) {
      if (nav.sendBeacon(url, new Blob([body], { type: 'application/json' }))) return true;
    }
    const f = fetchImpl || globalThis.fetch;
    if (typeof f !== 'function') return false;
    const p = f.call(globalThis, url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
    });
    if (p && typeof p.catch === 'function') p.catch(() => {});
    return true;
  } catch {
    return false;
  }
}

/**
 * Wire the two browser seams. Called once from the module body in a browser.
 * `transport` and `alert` are injectable so a test can watch what would be sent
 * without a real request leaving the process. Returns the quota for inspection.
 */
export function install(win = globalThis, transport = post, alert = null) {
  const quota = makeQuota();
  if (!win || typeof win.addEventListener !== 'function') return quota;

  const report = (message, filename, source) => {
    try {
      if (!isReportable(message, filename)) return;
      const path = safePath(win.location && win.location.href);
      const signature = signatureOf(message, path);
      if (!quota.take(signature)) return;
      const event = buildEvent({
        message,
        path,
        source,
        at: Date.now(),
        userAgent: win.navigator && win.navigator.userAgent,
        release: win.AH_BUILD || win.AH_PAGE_VERSION,
      });
      transport(SENTRY_DSN, event);
      /* The alert carries the same event plus its signature, which is what the
       * Worker dedupes on. Kept off the Sentry payload so the verified event
       * shape does not change. */
      if (typeof alert === 'function') alert({ ...event, signature });
    } catch { /* never let reporting throw */ }
  };

  win.addEventListener('error', (e) => {
    const err = e && e.error;
    report(
      (err && (err.message || err.stack)) || (e && e.message),
      e && e.filename,
      'window.onerror',
    );
  });

  win.addEventListener('unhandledrejection', (e) => {
    const r = e && e.reason;
    report(
      (r && (r.message || r.stack)) || (r != null ? String(r) : 'unhandled rejection'),
      '',
      'unhandledrejection',
    );
  });

  return quota;
}

if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  install(window, post, (event) => postAlert(ALERT_URL, event));
}
