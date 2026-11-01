// AUTH-ROADMAP step 1 (করণীয় ৪): public-handler side of the account-less signup.
// A `p.` verification ticket means no Firebase account exists yet. The account
// is created only after the emailed code is verified (or, as the last resort,
// when every OTP provider is down and the Firebase link must be used).
// The password never appears in a response. `deps` carries the handler helpers.
import { AUTH_ERROR_CODES, NativeAuthError } from '../core/errors.mjs';
import { PENDING_SIGNUP_TTL_MS } from './pending-signup.mjs';

const PENDING = '/internal/signup/pending';
/* AUTH V2.0 (owner 2026-10-31): the per-request opt-in header is gone.
 *
 * STEP1 shipped the held signup behind `X-AH-Signup-Flow: pending-v1` so a
 * cached bundle kept the old account-first path until the new frontend sent it.
 * Both live frontends send it now, but "sends it" was the whole check — so a
 * caller that simply omitted the header fell through to `provider.signUp`,
 * whose EMAIL_EXISTS answer is 409 for an address that exists and 202 for one
 * that does not. That is a user-enumeration oracle on an unauthenticated
 * endpoint, and it was the one leak the rest of this path was built to avoid.
 *
 * Holding the credentials is now the only signup path whenever ownership can be
 * verified, so the answer no longer depends on anything the caller chooses to
 * send. The 409 still exists, but only after the code is proven — at that point
 * the caller has demonstrated they own the mailbox, so "you already have an
 * account" tells them nothing they could not already learn by logging in.
 */
const TICKET_SECONDS = Math.floor(PENDING_SIGNUP_TTL_MS / 1000);
const deviceHeaders = (context, deps, cookies = []) => {
  const list = [...(context.isNewDevice ? [deps.deviceCookie(context.deviceId)] : []), ...cookies];
  return list.length ? { 'Set-Cookie': list } : {};
};

// /signup: hold the credentials, send nothing, create nothing.
export async function beginPendingSignup({ request, env, context, prepared, password, deps }) {
  const held = await deps.callAuthority(env, `${PENDING}/begin`, { input: { email: prepared.email, password }, context });
  return deps.json(request, 202, {
    ok: true,
    accountCreated: false,
    authenticated: false,
    verification: {
      sent: false,
      selectionRequired: true,
      emailMasked: held.emailMask || prepared.emailMask,
      requiredBeforeLogin: true,
      options: {
        email: { available: true, verifiesEmailOwnership: true },
        telegram: { available: false, verifiesEmailOwnership: false }
      }
    }
  }, deviceHeaders(context, deps, [deps.verificationCookie(held.verificationTicket, TICKET_SECONDS)]));
}

// /profile/pending
export async function savePendingSignupProfile({ request, env, context, ticket, profile, deps }) {
  const result = await deps.callAuthority(env, `${PENDING}/profile`, { input: { ticket, profile }, context });
  return deps.json(request, 200, { ok: true, saved: result?.saved === true }, deviceHeaders(context, deps));
}

// Firebase account + real verification ticket + pending profile moved over.
async function createAccount({ env, provider, context, email, password, profile, deps }) {
  let signed;
  try { signed = await provider.signUp(email, password); } catch (cause) { throw deps.providerError(cause, 'signup'); }
  try {
    const real = await deps.callAuthority(env, '/internal/firebase/account-verification/begin', {
      input: { email, subject: signed.subject, refreshToken: signed.refreshToken },
      context
    });
    if (profile && typeof profile === 'object') {
      try {
        await deps.callAuthority(env, '/internal/profile/save-pending', { verificationTicket: real.verificationTicket, input: profile, context });
      } catch {}
    }
    return { signed, verificationTicket: real.verificationTicket };
  } catch (cause) {
    try { await provider.deleteAccount(signed.idToken); } catch {}
    throw cause;
  }
}

// /email-ownership/start
export async function startPendingSignupCode({ request, env, provider, context, ticket, magicLink, deps }) {
  if (magicLink) throw new NativeAuthError(AUTH_ERROR_CODES.BACKUP_UNAVAILABLE);
  const result = await deps.callAuthority(env, `${PENDING}/request`, { input: { ticket }, context });
  if (result?.fallback === true) {
    const created = await createAccount({ env, provider, context, email: result.email, password: result.password, profile: result.profile, deps });
    try { await provider.sendVerificationEmail(created.signed.idToken, result.email); } catch (cause) {
      throw cause instanceof NativeAuthError ? cause : deps.providerError(cause, 'verification');
    }
    try { await deps.callAuthority(env, `${PENDING}/consume`, { input: { ticket }, context }); } catch {}
    return deps.json(request, 202, {
      ok: true,
      authenticated: false,
      delivery: { method: 'firebase-link', sent: true, fallback: true, emailMasked: result.emailMasked || 'আপনার ইমেইলে', resendAfter: 60 }
    }, deviceHeaders(context, deps, [deps.verificationCookie(created.verificationTicket)]));
  }
  return deps.json(request, 202, {
    ok: true,
    authenticated: false,
    delivery: { method: 'email-otp', sent: true, fallback: false },
    ownership: {
      sent: true,
      attemptId: result?.attemptId || '',
      emailMasked: result?.emailMasked || 'আপনার ইমেইলে',
      resendAfter: Number(result?.resendAfter || 60)
    }
  }, deviceHeaders(context, deps));
}

// /email-ownership/verify: the only place a pending signup becomes an account.
export async function verifyPendingSignupCodeAndCreate({ request, env, provider, context, ticket, attemptId, code, deps }) {
  const verified = await deps.callAuthority(env, `${PENDING}/verify`, { input: { ticket, attemptId, code }, context });
  if (verified?.verified !== true || !verified.email || !verified.password) throw new NativeAuthError(AUTH_ERROR_CODES.OTP_INVALID);
  const email = verified.email;
  const created = await createAccount({ env, provider, context, email, password: verified.password, profile: verified.profile, deps });
  const identity = { verificationTicket: created.verificationTicket, email, subject: created.signed.subject };
  let established;
  try {
    await deps.callAuthority(env, `${PENDING}/ownership`, { input: { ticket, ...identity }, context });
    established = await deps.callAuthority(env, '/internal/firebase/account-verification/complete', { input: identity, context });
  } catch (cause) {
    try { await provider.deleteAccount(created.signed.idToken); } catch {}
    throw cause;
  }
  const response = deps.authSuccess(request, established, created.signed.refreshToken, context, {
    emailVerified: false,
    emailOwnershipProven: true
  }, [deps.verificationCookie('', 0)]);
  try { await deps.callAuthority(env, `${PENDING}/consume`, { input: { ticket }, context }); } catch {}
  return response;
}
