/* Shared CORS policy for the admission API.
 *
 * Why this exists: six handlers used to build CORS headers by echoing whatever
 * Origin the caller sent and pairing it with Allow-Credentials: true. That lets
 * any site on the internet make credentialed cross-origin calls and read the
 * response, which turns a logged-in student's browser into an open proxy for
 * their results, profile, notifications and analytics.
 *
 * The allowlist below is the one auth-native/worker/public-auth-handler.mjs
 * already used for its own routes; it lives here so every handler shares a
 * single definition instead of six copies drifting apart.
 *
 * A1.5 ② / AU-SEC-05 / owner decision D-5 (22 Oct 2026): production no longer
 * accepts localhost / 127.0.0.1 or *.admissionhub.pages.dev preview builds.
 * Only the two live sites (and the Worker's own origin) are allowed.
 * Rollback: revert this commit.
 *
 * Contract: return the CORS headers only for an allowed Origin. For anything
 * else return an empty object, so no Access-Control-Allow-Origin is emitted at
 * all -- a wildcard is not a fallback, because with credentials enabled it
 * would be the vulnerability this module exists to close.
 */

const PRODUCTION_HOSTS = new Set([
  'admissionhub.pages.dev',
  'admissionsky.pages.dev',
  'admission-gk.admissionhub.workers.dev'
]);

export const allowedOrigin = origin => {
  if (!origin) return false;
  try {
    const url = new URL(origin);
    if (url.protocol !== 'https:') return false;
    if (url.port) return false;
    return PRODUCTION_HOSTS.has(url.hostname.toLowerCase());
  } catch { return false; }
};

/* Returns { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Credentials': 'true' }
 * for an allowed Origin, otherwise {}. Spread into a response's headers object.
 * Vary: Origin is always set so a shared cache never reuses one origin's
 * response for another. */
export const corsHeaders = request => {
  const origin = (request && request.headers && request.headers.get('Origin')) || '';
  if (!origin || !allowedOrigin(origin)) return { Vary: 'Origin' };
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Credentials': 'true',
    Vary: 'Origin'
  };
};
