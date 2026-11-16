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
 *
 * `required` (AU-SEC-01 L3) removes the inert escape hatch for one request: a
 * caller the edge placed on a hosting ASN, or a deployment whose quota is in
 * the L8 hard band, must clear a human check even when no secret is bound.
 * That case still cannot be *satisfied* without a secret — there is nothing to
 * verify against — so it refuses rather than pretending. It is only ever set
 * for callers already judged suspicious, never for the ordinary path, so an
 * unconfigured deployment keeps serving students normally.
 *
 * `optional` (owner 2026-11-16) is the one flag that lets a *missing* token
 * through. The owner's instruction was that students must log in "like water"
 * while Turnstile keeps guarding against bots: the widget now renders invisible
 * and a real person never sees it, so the ordinary path must never be blocked
 * by a challenge that silently failed to mint a token on their device. An
 * explicit refusal from Cloudflare still refuses, and the `required` callers
 * above still fail closed, so this is not a general bypass — it is "the check
 * could not run, so do not punish the student for it."
 */
export async function verifyTurnstile({ env, token, ip, fetchImpl = fetch, timeoutMs = 8000, required = false, optional = false } = {}) {
  const secret = String(env?.TURNSTILE_SECRET_KEY || '').trim();
  if (!secret) {
    if (required) throw new NativeAuthError(AUTH_ERROR_CODES.HUMAN_CHECK_FAILED);
    return { enforced: false };
  }
  const value = String(token ?? '');
  if (!value) {
    if (optional && !required) return { enforced: false, skipped: true };
    throw new NativeAuthError(AUTH_ERROR_CODES.HUMAN_CHECK_FAILED);
  }
  if (value.length > 4096) throw new NativeAuthError(AUTH_ERROR_CODES.HUMAN_CHECK_FAILED);
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
