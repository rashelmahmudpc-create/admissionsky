import { AUTH_ERROR_CODES, NativeAuthError } from '../core/errors.mjs';

// Cloudflare Turnstile, server side (owner 2026-10-16: human verification before
// an OTP goes out). A front-end widget alone proves nothing, a bot skips it, so
// the token is checked here against Cloudflare's siteverify endpoint.
const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/**
 * Verify a Turnstile token. Resolves when the token is good, throws
 * HUMAN_CHECK_FAILED when it is missing or rejected. The code is deliberately
 * not INVALID_INPUT: a student whose human check could not run needs a refresh,
 * not a hint that the form fields are wrong.
 *
 * The guard is inert until TURNSTILE_SECRET_KEY is configured, so enabling the
 * code before the Cloudflare secret exists cannot lock students out of signup.
 * Once the secret is set the endpoint fails closed: a Cloudflare outage or a
 * missing token refuses the send rather than waving it through.
 */
export async function verifyTurnstile({ env, token, ip, fetchImpl = fetch, timeoutMs = 8000 } = {}) {
  const secret = String(env?.TURNSTILE_SECRET_KEY || '').trim();
  if (!secret) return { enforced: false };
  const value = String(token ?? '');
  if (!value || value.length > 4096) throw new NativeAuthError(AUTH_ERROR_CODES.HUMAN_CHECK_FAILED);
  const form = new URLSearchParams({ secret, response: value });
  if (ip && ip !== 'unknown') form.set('remoteip', String(ip).slice(0, 96));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(SITEVERIFY_URL, { method: 'POST', body: form, signal: controller.signal });
    const data = await response.json().catch(() => null);
    if (data && data.success === true) return { enforced: true };
  } catch {
    // Falls through to the refusal below: an unverifiable request is a failed one.
  } finally {
    clearTimeout(timer);
  }
  throw new NativeAuthError(AUTH_ERROR_CODES.HUMAN_CHECK_FAILED);
}
