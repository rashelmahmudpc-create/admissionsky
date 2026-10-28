import { claimsAuthPath } from './public-auth-handler.mjs';

/**
 * F-04 phase 2: send the auth surface to its own Worker, without ever leaving
 * the student without a working login.
 *
 * The switch is a var, not a deploy: `AUTH_ROUTE = "service"` forwards, anything
 * else (including a typo, or a missing binding) keeps the in-process handler that
 * has been serving these routes all along. Flipping it back is instant and needs
 * no code change, which is the whole point of doing the move this way.
 */
export const AUTH_ROUTE_MODES = Object.freeze({ local: 'local', service: 'service' });

/**
 * Paths the auth Worker is not yet equipped to answer, so they stay in process
 * even in service mode.
 *
 * All of them need a secret that lives only in admission-gk. A Cloudflare secret
 * is write-only: it cannot be copied to another script, only re-issued — and
 * re-issuing AUTH_HMAC_SECRET would change every derived Telegram address and
 * orphan those accounts, while re-issuing the bot token would break the
 * registered webhook. So these routes keep the script that already holds them:
 *
 *   /config              reports what is configured *here*; served by the script
 *                        with the full environment, so the login page can never
 *                        claim a method is missing while another script answers it.
 *   /telegram/login      verifies Telegram's signature with the bot token and
 *                        derives the account from the HMAC key.
 *   /telegram/webhook    verifies a secret derived from the HMAC key.
 *   /telegram/canary/*   operator-only probes that need the same keys.
 *
 * Everything else a student touches — signup, login, session, refresh, logout,
 * Google, Facebook, passkey, OTP, reset, account and the public profile — is
 * forwarded. The one thing they must not lose is their session: a Telegram-login
 * account is recognised across the split by asking the authority (see
 * `telegramLoginAccountFor`), which is where the secret stayed.
 */
export const AUTH_ROUTE_LOCAL_PATHS = Object.freeze([
  '/api/auth/v1/config',
  '/api/auth/v1/telegram/login',
  '/api/auth/v1/telegram/webhook',
  '/api/auth/v1/telegram/canary/activate',
  '/api/auth/v1/telegram/canary/deactivate'
]);

export function authRouteMode(env) {
  const requested = String(env?.AUTH_ROUTE || '').trim().toLowerCase();
  if (requested !== AUTH_ROUTE_MODES.service) return AUTH_ROUTE_MODES.local;
  const binding = env?.AUTH_WORKER;
  // A named mode with no usable binding is a configuration mistake, not an
  // instruction to stop logging people in.
  return binding && typeof binding.fetch === 'function' ? AUTH_ROUTE_MODES.service : AUTH_ROUTE_MODES.local;
}

/**
 * @param local   the in-process handler; its contract is unchanged (it returns
 *                null for paths it does not own)
 * @param forward optional override used by tests; defaults to the binding
 */
export async function routeAuthRequest({ request, env, ctx, local, forward = null }) {
  if (authRouteMode(env) === AUTH_ROUTE_MODES.local) return local(request, env, ctx);

  let pathname;
  try {
    pathname = new URL(request.url).pathname;
  } catch (_) {
    return local(request, env, ctx);
  }
  // Only what the auth Worker owns is forwarded. Everything else has to keep
  // falling through the app's own chain exactly as it does today, and the one
  // shared predicate is what guarantees the two sides cannot disagree.
  if (!claimsAuthPath(pathname)) return local(request, env, ctx);
  if (AUTH_ROUTE_LOCAL_PATHS.includes(pathname)) return local(request, env, ctx);

  try {
    // Clone first: a service binding reads the body, and the fallback below has
    // to be able to send the very same POST (signup is a POST with a body).
    const response = await (forward ? forward(request.clone()) : env.AUTH_WORKER.fetch(request.clone()));
    if (response) return response;
  } catch (_) {
    // Transport failure: fall through and answer in process rather than fail a
    // login that the old path can still complete.
  }
  return local(request, env, ctx);
}
