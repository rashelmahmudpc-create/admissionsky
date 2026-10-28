import { AUTH_NATIVE_VERSION, FIREBASE_VERIFICATION_RESEND_COOLDOWN_MS } from '../core/auth-engine.mjs';
import { constantTimeEqual, normalizeAuthEmail, randomToken } from '../core/crypto.mjs';
import { isDisposableEmail } from '../../email-policy.js';
import { AUTH_ERROR_CODES, asNativeAuthError, NativeAuthError } from '../core/errors.mjs';
import { FirebaseEmailPasswordProvider, FirebaseRequestError } from '../providers/firebase-auth.mjs';
import { verificationConfig } from '../verification/config.mjs';
import { verifyTurnstile } from '../verification/turnstile.mjs';
import { resolveTelegramWebhookSecret, validTelegramWebhookSecret } from '../verification/telegram-security.mjs';
import { isTelegramLoginEmail, reservedTelegramLoginEmail, telegramLoginBotId, telegramLoginCredentials, telegramLoginReady, verifyTelegramLogin } from '../verification/telegram-login.mjs';
import { isPendingSignupTicket } from './pending-signup.mjs';
import * as pendingSignup from './pending-signup-public.mjs';
import { shadowVerdict, shadowDelayMs, sleep, resolveGuardMode, SHADOW_GUARD_MODES } from '../core/shadow-guard.mjs';
import { parseCanaryEmails, isCanaryEmail, createKvCanaryFlags } from '../core/canary-accounts.mjs';
import { createKvPasswordGuard, passwordGuardKey, passwordFailuresSoFar } from '../core/password-guard.mjs';
import { createKvLoginFacts, createKvIpBreadth } from '../core/login-facts.mjs';
import { sendThrottledSecurityAlert, SECURITY_ALERT_EVENTS } from '../core/security-alerts.mjs';
/* D-5 / A1.5 ②: one shared CORS policy for every auth surface. This handler
 * used to keep its own copy that still accepted http://localhost and any
 * *.admissionhub.pages.dev preview host, so production served credentialed
 * CORS to preview builds even after the other handlers were tightened. */
import { allowedOrigin, corsHeaders } from '../../cors-policy.mjs';

export const AUTH_API_PREFIX = '/api/auth/v1';
// Phase 7 public-safe profile projection, deliberately unauthenticated and
// therefore outside the auth prefix. Shared as the constant the route gate,
// the CORS check and the route itself all read, so they cannot drift apart.
export const PUBLIC_PROFILE_PREFIX = '/api/public/profile/';

/**
 * F-04: the paths this handler claims, in one place. admission-gk asks this
 * before forwarding a request to the auth Worker, because a second, drifting
 * copy of the rule is exactly how the public profile route once 404'd for
 * everybody (see the note below).
 */
export function claimsAuthPath(pathname) {
  const path = String(pathname || '');
  return path === AUTH_API_PREFIX || path.startsWith(`${AUTH_API_PREFIX}/`) || path.startsWith(PUBLIC_PROFILE_PREFIX);
}
export const AUTH_SESSION_COOKIE = '__Host-ah_session';
export const AUTH_FIREBASE_COOKIE = '__Host-ah_firebase';
export const AUTH_DEVICE_COOKIE = '__Host-ah_device';
export const AUTH_VERIFICATION_COOKIE = '__Host-ah_verification';
const AUTHORITY_NAME = 'admission-hub-global-auth-v1';
const MAX_BODY_BYTES = 24 * 1024;
const YEAR_SECONDS = 365 * 24 * 60 * 60;
const SESSION_SECONDS = 30 * 24 * 60 * 60;
const PASSWORD_MIN = 8;
const PASSWORD_MAX = 128;
const AUTH_UI_VERSION = 'auth-premium-v6';
const FIREBASE_VERIFICATION_RESEND_SECONDS = Math.floor(FIREBASE_VERIFICATION_RESEND_COOLDOWN_MS / 1000);

const JSON_HEADERS = Object.freeze({
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store, max-age=0',
  Pragma: 'no-cache',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Resource-Policy': 'same-site',
  Vary: 'Origin'
});

const json = (request, status, body, extraHeaders = {}) => {
  const headers = new Headers({ ...JSON_HEADERS, ...corsHeaders(request) });
  for (const [name, value] of Object.entries(extraHeaders || {})) {
    if (Array.isArray(value)) value.forEach(item => headers.append(name, item));
    else headers.set(name, value);
  }
  return new Response(JSON.stringify(body), { status, headers });
};

const cookies = request => Object.fromEntries(
  String(request.headers.get('Cookie') || '').split(';').map(part => part.trim()).filter(Boolean).map(part => {
    const index = part.indexOf('=');
    if (index < 1) return ['', ''];
    const value = part.slice(index + 1);
    try { return [part.slice(0, index), decodeURIComponent(value)]; } catch { return [part.slice(0, index), '']; }
  }).filter(([key]) => key)
);

const secureCookie = (name, token, maxAge) => `${name}=${encodeURIComponent(String(token || ''))}; Path=/; Max-Age=${Math.max(0, Math.floor(maxAge))}; HttpOnly; Secure; SameSite=Strict`;
const sessionCookie = (token, maxAge) => secureCookie(AUTH_SESSION_COOKIE, token, maxAge);
const firebaseCookie = (token, maxAge) => secureCookie(AUTH_FIREBASE_COOKIE, token, maxAge);
const deviceCookie = token => `${AUTH_DEVICE_COOKIE}=${encodeURIComponent(token)}; Path=/; Max-Age=${YEAR_SECONDS}; HttpOnly; Secure; SameSite=Lax`;
const verificationCookie = (token, maxAge = 15 * 60) => secureCookie(AUTH_VERIFICATION_COOKIE, token, maxAge);
const clearAuthCookies = () => [sessionCookie('', 0), firebaseCookie('', 0), verificationCookie('', 0)];

async function readJson(request, maxBytes = MAX_BODY_BYTES) {
  if (!String(request.headers.get('Content-Type') || '').toLowerCase().startsWith('application/json')) {
    throw new NativeAuthError(AUTH_ERROR_CODES.INVALID_INPUT);
  }
  const declared = Number(request.headers.get('Content-Length') || 0);
  if (declared > maxBytes || !request.body) throw new NativeAuthError(AUTH_ERROR_CODES.INVALID_INPUT);
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let raw = '';
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new NativeAuthError(AUTH_ERROR_CODES.INVALID_INPUT);
    }
    raw += decoder.decode(value, { stream: true });
  }
  raw += decoder.decode();
  if (!raw) throw new NativeAuthError(AUTH_ERROR_CODES.INVALID_INPUT);
  try { return JSON.parse(raw); } catch { throw new NativeAuthError(AUTH_ERROR_CODES.INVALID_INPUT); }
}

const clientContext = (request, existingDeviceId = '') => {
  const deviceId = /^[A-Za-z0-9_-]{20,96}$/.test(existingDeviceId) ? existingDeviceId : randomToken(24);
  // Edge facts. Cloudflare already knows the country, the network and its own
  // bot score; asking for them costs nothing and inventing them would be a
  // guess. Every one is optional, so a runtime that does not report them
  // simply scores less risk rather than accusing anybody.
  const cf = request.cf || {};
  const botScore = Number(cf.botManagement?.score);
  return Object.freeze({
    deviceId,
    isNewDevice: deviceId !== existingDeviceId,
    ip: String(request.headers.get('CF-Connecting-IP') || 'unknown').slice(0, 96),
    userAgent: String(request.headers.get('User-Agent') || '').slice(0, 300),
    origin: String(request.headers.get('Origin') || new URL(request.url).origin).slice(0, 256),
    country: String(cf.country || '').slice(0, 8),
    asn: Number.isFinite(Number(cf.asn)) ? Number(cf.asn) : undefined,
    botScore: Number.isFinite(botScore) ? botScore : undefined
  });
};

// Shadow Guard (P30) mode. The default - an unset variable, or one nobody
// recognises - is `observe`: every login is scored and reported, and nobody
// is refused. A refusal needs the explicit word `enforce`. The deployment
// carries no variable for this: the Worker sits on Cloudflare's 64-variable
// free-tier ceiling, so a 65th is rejected at deploy time.
const shadowGuardMode = env => resolveGuardMode(env?.SHADOW_GUARD_ACTIVATION);

// The KV namespace the guard records into. Absent binding means the guard
// cannot record, and a guard that cannot record must not silently pretend
// it did: the caller treats it as unavailable and proceeds on the old path.
const shadowGuardStore = env => env?.GK_KV || env?.PUB_KV || null;

// A canary hit is a deliberate act, so it is worth a record even though the
// response says nothing. The flag is raised in the background: an attacker
// must not be able to measure the extra write.
const flagCanaryHit = (env, email, context) => {
  const list = parseCanaryEmails(env?.CANARY_EMAILS);
  if (!isCanaryEmail(email, list)) return false;
  const store = shadowGuardStore(env);
  if (store) {
    const flags = createKvCanaryFlags(store);
    Promise.resolve()
      .then(() => flags.flag(context.ip, context.deviceId))
      .catch(() => {});
  }
  // The owner is told at once: a canary hit is the clearest signal the app
  // has that someone is probing it on purpose.
  sendThrottledSecurityAlert(env, store, {
    event: SECURITY_ALERT_EVENTS.CANARY_HIT,
    email,
    at: Date.now()
  });
  return true;
};

const credentials = body => {
  const email = String(body?.email || '').trim();
  const password = typeof body?.password === 'string' ? body.password : '';
  if (!email || password.length < PASSWORD_MIN || password.length > PASSWORD_MAX || /[\r\n\u0000]/.test(password)) {
    throw new NativeAuthError(password && password.length < PASSWORD_MIN ? AUTH_ERROR_CODES.WEAK_PASSWORD : AUTH_ERROR_CODES.INVALID_INPUT);
  }
  // "Remember me" (Phase 5): explicit false shortens the established session
  // to REMEMBER_OFF_TTL_MS; absent/true keeps the standard SESSION_TTL_MS.
  const remember = body?.remember !== false;
  return Object.freeze({ email, password, remember });
};

const telegramWebhookInput = body => {
  const message = body?.message;
  const telegramUserId = String(message?.from?.id || '');
  const chatId = String(message?.chat?.id || '');
  const text = String(message?.text || '');
  const match = text.match(/^\/start(?:@[A-Za-z0-9_]{5,32})? ([A-Za-z0-9_-]{32,64})$/);
  if (!Number.isSafeInteger(body?.update_id) || message?.chat?.type !== 'private' || message?.from?.is_bot === true || telegramUserId !== chatId || !/^[1-9]\d{0,19}$/.test(telegramUserId) || !match) {
    throw new NativeAuthError(AUTH_ERROR_CODES.INVALID_INPUT);
  }
  return Object.freeze({ linkToken: match[1], telegramUserId, chatId });
};

const googleCredential = body => {
  const accessToken = String(body?.accessToken || '').trim();
  const idToken = String(body?.idToken || '').trim();
  if (Boolean(accessToken) === Boolean(idToken)) throw new NativeAuthError(AUTH_ERROR_CODES.INVALID_INPUT);
  const value = accessToken || idToken;
  if (value.length < 20 || value.length > 4096 || /[\r\n\u0000;]/.test(value)) throw new NativeAuthError(AUTH_ERROR_CODES.INVALID_INPUT);
  return Object.freeze(accessToken ? { accessToken } : { idToken });
};

// Facebook's browser flow returns an OAuth access token, so that is the only
// credential kind this path accepts.
const facebookCredential = body => {
  const accessToken = String(body?.accessToken || '').trim();
  if (accessToken.length < 20 || accessToken.length > 4096 || /[\r\n\u0000;]/.test(accessToken)) {
    throw new NativeAuthError(AUTH_ERROR_CODES.INVALID_INPUT);
  }
  return Object.freeze({ accessToken });
};

// Google Login → Automatic Profile Sync (owner blueprint):
// Google data populates ONLY the empty fields of a NEW profile.
// User-modified data always wins, no silent overwrite, ever.
const GOOGLE_AVATAR_HOSTS = Object.freeze(['.googleusercontent.com']);
const isGoogleAvatarUrl = raw => {
  try {
    const u = new URL(String(raw || ''));
    if (u.protocol !== 'https:') return false;
    return GOOGLE_AVATAR_HOSTS.some(h => u.hostname.endsWith(h));
  } catch { return false; }
};
const looksLikeName = value => {
  const v = String(value || '').trim();
  return v.length >= 2 && v.length <= 80 && /^[\p{L}\p{M} .'-]+$/u.test(v);
};
// Best-effort greeting personalisation for the backup email: a missing or unusual
// profile name must never block sending, so failures collapse to an empty string.
async function verifiedRecipientName(env, context, current) {
  try {
    const profile = await callAuthority(env, '/internal/profile/get-v2', {
      input: { sessionToken: current.sessionToken, email: current.user.email, subject: current.user.subject },
      context
    });
    const name = String(profile?.profile?.fullName || '').trim();
    return looksLikeName(name) ? name : '';
  } catch { return ''; }
}
async function seedGoogleProfile(env, context, established, googleUser) {
  const sessionToken = String(established?.sessionToken || '');
  const email = String(googleUser?.email || '');
  const subject = String(googleUser?.subject || '');
  if (!sessionToken || !email || !subject) return;
  const input = Object.freeze({ sessionToken, email, subject });
  let current = null;
  try {
    // callAuthority already unwraps the authority envelope (data.result).
    current = await callAuthority(env, '/internal/profile/get-v2', { input, context });
  } catch { return; }
  if (!current) return;
  // 1) Name, only when the profile has none yet.
  if (!current.profile?.fullName && looksLikeName(googleUser.displayName)) {
    try {
      await callAuthority(env, '/internal/profile/patch', { input: { ...input, fields: { fullName: String(googleUser.displayName).trim() } }, context });
    } catch { /* seeding is best-effort; login must never fail on it */ }
  }
  // 2) Avatar, only when the user has none yet, and only from Google's own CDN.
  if (!current.avatar?.present && isGoogleAvatarUrl(googleUser.photoUrl)) {
    try {
      const res = await fetch(String(googleUser.photoUrl), {
        redirect: 'manual',
        signal: AbortSignal.timeout(12_000),
        headers: { Accept: 'image/*' }
      });
      if (!res.ok) return;
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.byteLength > 2 * 1024 * 1024) return;
      const isJpeg = buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
      const isPng = buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
      const mime = isJpeg ? 'image/jpeg' : isPng ? 'image/png' : null;
      if (!mime) return;
      await callAuthority(env, '/internal/avatar/save', {
        input: { sessionToken, email, subject, data: buf.toString('base64'), mime },
        context
      });
    } catch { /* avatar seeding is best-effort */ }
  }
}

async function callAuthority(env, path, body, method = 'POST') {
  if (!env?.AUTH_AUTHORITY || typeof env.AUTH_AUTHORITY.idFromName !== 'function') {
    throw new NativeAuthError(AUTH_ERROR_CODES.NOT_CONFIGURED);
  }
  let response;
  try {
    const id = env.AUTH_AUTHORITY.idFromName(AUTHORITY_NAME);
    const stub = env.AUTH_AUTHORITY.get(id, { locationHint: 'apac' });
    response = await stub.fetch(`https://auth.internal${path}`, method === 'GET' ? { method } : {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {})
    });
  } catch {
    throw new NativeAuthError(AUTH_ERROR_CODES.STORAGE_UNAVAILABLE);
  }
  let data;
  try { data = await response.json(); } catch { throw new NativeAuthError(AUTH_ERROR_CODES.STORAGE_UNAVAILABLE); }
  if (!response.ok || !data?.ok) {
    throw new NativeAuthError(data?.error?.code || AUTH_ERROR_CODES.STORAGE_UNAVAILABLE, {
      retryAfter: data?.error?.retryAfter || response.headers.get('Retry-After')
    });
  }
  return data.result || data;
}

function providerAvailabilityFailure(cause) {
  if (!(cause instanceof FirebaseRequestError)) return Object.freeze({ code: 'PROVIDER_CHECK_FAILED', providerStatus: 0 });
  const reason = String(cause.reason || '');
  const providerStatus = Number.isInteger(cause.status) && cause.status >= 100 && cause.status <= 599 ? cause.status : 0;
  if (reason === 'NETWORK_ERROR') return Object.freeze({ code: 'PROVIDER_NETWORK_ERROR', providerStatus });
  if (/REFERER|REFERRER/.test(reason)) return Object.freeze({ code: 'API_KEY_REFERRER_RESTRICTED', providerStatus });
  if (/ACCESS_NOT_CONFIGURED|SERVICE_DISABLED|API_NOT_ACTIVATED/.test(reason)) return Object.freeze({ code: 'IDENTITY_TOOLKIT_DISABLED', providerStatus });
  if (/API_KEY/.test(reason)) return Object.freeze({ code: 'API_KEY_REJECTED', providerStatus });
  if (reason === 'PROJECT_NOT_FOUND') return Object.freeze({ code: 'PROJECT_NOT_FOUND', providerStatus });
  if (reason === 'OPERATION_NOT_ALLOWED') return Object.freeze({ code: 'PROVIDER_DISABLED', providerStatus });
  return Object.freeze({ code: providerStatus ? `PROVIDER_HTTP_${providerStatus}` : 'PROVIDER_CHECK_FAILED', providerStatus });
}

const PROVIDER_DIAGNOSTIC_REASONS = new Set([
  'NETWORK_ERROR', 'INVALID_PROVIDER_RESPONSE', 'INVALID_IDP_RESPONSE', 'NOT_CONFIGURED', 'API_KEY_INVALID',
  'PROJECT_NOT_FOUND', 'OPERATION_NOT_ALLOWED', 'INVALID_EMAIL', 'MISSING_EMAIL',
  'MISSING_PASSWORD', 'EMAIL_EXISTS', 'WEAK_PASSWORD', 'INVALID_LOGIN_CREDENTIALS',
  'EMAIL_NOT_FOUND', 'INVALID_PASSWORD', 'USER_DISABLED', 'TOO_MANY_ATTEMPTS_TRY_LATER',
  'TOO_MANY_ATTEMPTS', 'IP_BLOCKED', 'QUOTA_EXCEEDED', 'INVALID_CONTINUE_URI',
  'UNAUTHORIZED_DOMAIN', 'INVALID_REFRESH_TOKEN', 'TOKEN_EXPIRED', 'INVALID_ID_TOKEN',
  'USER_NOT_FOUND', 'FEDERATED_USER_ID_ALREADY_LINKED', 'MISSING_RECAPTCHA_TOKEN',
  'INVALID_RECAPTCHA_TOKEN', 'CAPTCHA_CHECK_FAILED', 'RECAPTCHA_CHECK_FAILED'
]);

function providerDiagnostic(cause, stage) {
  const operation = String(stage || 'auth').toUpperCase().replace(/[^A-Z0-9_]/g, '_').slice(0, 24) || 'AUTH';
  if (!(cause instanceof FirebaseRequestError)) return `${operation}_UNEXPECTED`;
  const reason = PROVIDER_DIAGNOSTIC_REASONS.has(cause.reason)
    ? cause.reason
    : cause.status >= 100 && cause.status <= 599 ? `HTTP_${cause.status}` : 'UNKNOWN';
  return `${operation}_${reason}`;
}

function providerError(cause, stage = 'auth') {
  const tagged = error => {
    error.providerDiagnostic = providerDiagnostic(cause, stage);
    return error;
  };
  if (!(cause instanceof FirebaseRequestError)) return tagged(new NativeAuthError(AUTH_ERROR_CODES.AUTH_PROVIDER_UNAVAILABLE));
  const reason = cause.reason;
  if (reason === 'NOT_CONFIGURED' || ['API_KEY_INVALID', 'PROJECT_NOT_FOUND', 'OPERATION_NOT_ALLOWED'].includes(reason)) {
    return tagged(new NativeAuthError(stage.startsWith('google') || stage.startsWith('facebook') ? AUTH_ERROR_CODES.GOOGLE_UNAVAILABLE : AUTH_ERROR_CODES.NOT_CONFIGURED));
  }
  if (['INVALID_EMAIL', 'MISSING_EMAIL', 'MISSING_PASSWORD', 'INVALID_IDP_RESPONSE'].includes(reason)) return tagged(new NativeAuthError(AUTH_ERROR_CODES.INVALID_INPUT));
  if (reason === 'EMAIL_EXISTS' && (stage.startsWith('google') || stage.startsWith('facebook'))) return tagged(new NativeAuthError(AUTH_ERROR_CODES.ACCOUNT_LINK_REQUIRED));
  if (reason === 'EMAIL_EXISTS') return tagged(new NativeAuthError(AUTH_ERROR_CODES.EMAIL_ALREADY_IN_USE));
  if (reason === 'FEDERATED_USER_ID_ALREADY_LINKED') return tagged(new NativeAuthError(AUTH_ERROR_CODES.ACCOUNT_CONFLICT));
  if (reason === 'WEAK_PASSWORD') return tagged(new NativeAuthError(AUTH_ERROR_CODES.WEAK_PASSWORD));
  if (['INVALID_LOGIN_CREDENTIALS', 'EMAIL_NOT_FOUND', 'INVALID_PASSWORD'].includes(reason)) return tagged(new NativeAuthError(AUTH_ERROR_CODES.INVALID_CREDENTIALS));
  if (reason === 'USER_DISABLED') return tagged(new NativeAuthError(AUTH_ERROR_CODES.ACCOUNT_DISABLED));
  if (['TOO_MANY_ATTEMPTS_TRY_LATER', 'TOO_MANY_ATTEMPTS', 'IP_BLOCKED'].includes(reason)) {
    return tagged(new NativeAuthError(AUTH_ERROR_CODES.RATE_LIMITED, { retryAfter: 60 }));
  }
  if (stage === 'verification' && ['QUOTA_EXCEEDED', 'INVALID_CONTINUE_URI', 'UNAUTHORIZED_DOMAIN', 'NETWORK_ERROR', 'INVALID_PROVIDER_RESPONSE'].includes(reason)) {
    return tagged(new NativeAuthError(AUTH_ERROR_CODES.VERIFICATION_UNAVAILABLE));
  }
  if (['refresh', 'lookup-session', 'passkey-refresh'].includes(stage) && ['INVALID_REFRESH_TOKEN', 'TOKEN_EXPIRED', 'INVALID_ID_TOKEN', 'USER_NOT_FOUND'].includes(reason)) {
    return tagged(new NativeAuthError(AUTH_ERROR_CODES.SESSION_INVALID));
  }
  return tagged(new NativeAuthError(stage.startsWith('google') ? AUTH_ERROR_CODES.GOOGLE_UNAVAILABLE : AUTH_ERROR_CODES.AUTH_PROVIDER_UNAVAILABLE));
}

const assertProviderUser = (signed, user) => {
  if (signed.subject !== user.subject) throw new NativeAuthError(AUTH_ERROR_CODES.AUTH_PROVIDER_UNAVAILABLE);
  if (user.disabled) throw new NativeAuthError(AUTH_ERROR_CODES.ACCOUNT_DISABLED);
};

const telegramVerificationStatus = async ({ env, user, context, allowed }) => {
  if (!allowed) return false;
  try {
    const result = await callAuthority(env, '/internal/verification/telegram/status', {
      input: { email: user.email, subject: user.subject },
      context
    });
    return result?.linked === true;
  } catch { return false; }
};

const telegramVerificationAvailable = async (env, allowed) => {
  if (!allowed) return false;
  try {
    const result = await callAuthority(env, '/internal/verification/capabilities', {});
    return result?.telegramAvailable === true;
  } catch { return false; }
};

const emailOwnershipProven = async ({ env, user, context, allowed }) => {
  if (!allowed) return false;
  try {
    const result = await callAuthority(env, '/internal/verification/ownership/status', {
      input: { email: user.email, subject: user.subject },
      context
    });
    return result?.proven === true;
  } catch { return false; }
};

/**
 * F-04: is this address a "Continue with Telegram" account?
 *
 * The derivation needs AUTH_HMAC_SECRET, and a Cloudflare secret is write-only:
 * it cannot be copied into the split-out auth Worker, only re-issued (which
 * would change every derived address and orphan those accounts). So the answer
 * is asked from the authority, which still holds the secret — but only for an
 * address in the reserved Telegram domain, and only after the local derivation,
 * available in admission-gk, has said no. A normal student address costs one
 * string compare and never reaches the authority.
 */
export const telegramLoginAccountFor = async ({ env, email }) => {
  const address = String(email || '').trim().toLowerCase();
  if (!reservedTelegramLoginEmail(address)) return false;
  if (await isTelegramLoginEmail(address, env)) return true;
  try {
    const result = await callAuthority(env, '/internal/telegram/login-email', { email: address });
    return result?.loginAccount === true;
  } catch { return false; }
};

const firebaseReadySession = async ({ provider, jar, env, context, allowTelegram = false, trackRefresh = false }) => {
  const sessionToken = jar[AUTH_SESSION_COOKIE];
  const refreshToken = jar[AUTH_FIREBASE_COOKIE];
  if (!sessionToken || !refreshToken) throw new NativeAuthError(AUTH_ERROR_CODES.SESSION_INVALID);
  let refreshed;
  let user;
  try { refreshed = await provider.refresh(refreshToken); } catch (cause) { throw providerError(cause, 'refresh'); }
  try { user = await provider.lookup(refreshed.idToken); } catch (cause) { throw providerError(cause, 'lookup-session'); }
  assertProviderUser(refreshed, user);
  // Ownership is proven by an OTP delivered to the address itself, so it unlocks
  // the session even while Firebase's own emailVerified flag is still false.
  // Firebase remains the fallback: it either sets that flag or proves ownership too.
  const ownershipProven = !user.emailVerified && await emailOwnershipProven({ env, user, context, allowed: true });
  // A "Continue with Telegram" account is proven by Telegram's signature at
  // login; its derived address can never receive mail, so it counts as verified.
  const telegramLoginAccount = !user.emailVerified && !ownershipProven
    && await telegramLoginAccountFor({ env, email: user.email });
  const telegramVerified = telegramLoginAccount || (!user.emailVerified && !ownershipProven
    && await telegramVerificationStatus({ env, user, context, allowed: allowTelegram }));
  if (!user.emailVerified && !ownershipProven && !telegramVerified) throw new NativeAuthError(AUTH_ERROR_CODES.EMAIL_NOT_VERIFIED);
  const session = await callAuthority(env, '/internal/firebase/session/get', {
    sessionToken,
    input: { email: user.email, subject: user.subject, ...(trackRefresh ? { trackRefresh: true } : {}) }
  });
  return Object.freeze({ sessionToken, refreshed, user, session, telegramVerified, ownershipProven });
};

const sessionCookies = (established, refreshToken, context) => {
  const maxAge = Math.max(1, Math.min(SESSION_SECONDS, Math.floor((Number(established.sessionExpiresAt || established.expiresAt) - Date.now()) / 1000)));
  const values = [];
  if (established.sessionToken) values.push(sessionCookie(established.sessionToken, maxAge));
  values.push(firebaseCookie(refreshToken, maxAge));
  if (context.isNewDevice) values.push(deviceCookie(context.deviceId));
  return values;
};

const authSuccess = (request, established, refreshToken, context, verification = {}, extraCookies = []) => {
  const emailVerified = verification.emailVerified !== false;
  const telegramVerified = verification.telegramVerified === true;
  const emailOwnershipProven = verification.emailOwnershipProven === true;
  return json(request, 200, {
    ok: true,
    authenticated: true,
    accountVerified: emailVerified || telegramVerified || emailOwnershipProven,
    emailVerified,
    telegramVerified,
    emailOwnershipProven,
    created: Boolean(established.created),
    user: established.user,
    // Phase 6, security decision travels with the session: trustOffer drives
    // the "trust this device 30 days" prompt (Chunk 3 client); HIGH risk
    // shortens expiresAt server-side.
    session: { expiresAt: established.sessionExpiresAt, security: established.security || null }
  }, { 'Set-Cookie': [...sessionCookies(established, refreshToken, context), ...extraCookies] });
};

const googleEndpointReady = env => ['canary', 'enabled'].includes(String(env?.GOOGLE_AUTH_ACTIVATION || ''));
const googlePublished = env => env?.GOOGLE_AUTH_ACTIVATION === 'enabled';
const googleCanaryRequested = (env, url) =>
  env?.GOOGLE_AUTH_ACTIVATION === 'canary' && url.searchParams.get('googleCanary') === '1';
// Facebook has no switch of its own: this Worker sits exactly on the Workers
// Free ceiling of 64 variables (secrets + text), so a 65th is rejected on
// deploy. The native social sign-in is activated as one unit by
// GOOGLE_AUTH_ACTIVATION; the Firebase project itself decides whether the
// facebook.com provider is actually configured.
const facebookEndpointReady = env => ['canary', 'enabled'].includes(String(env?.GOOGLE_AUTH_ACTIVATION || ''));
const facebookPublished = env => env?.GOOGLE_AUTH_ACTIVATION === 'enabled';
const verificationEndpointReady = env => ['canary', 'enabled'].includes(String(env?.VERIFICATION_AUTH_ACTIVATION || ''));
const verificationPublished = env => env?.VERIFICATION_AUTH_ACTIVATION === 'enabled';
const telegramCanaryRequested = (env, url) =>
  verificationEndpointReady(env) && url.searchParams.get('telegramCanary') === '1';
const telegramVerificationRequested = (env, url) => verificationPublished(env) || telegramCanaryRequested(env, url);
// Email-ownership rides the same activation switch as the rest of the backup
// verification family; it needs no separate canary because it is gated by the
// pre-verification ticket and the provider quota.
const emailOwnershipRequested = (env, url) => verificationPublished(env) || telegramCanaryRequested(env, url);
const currentAuthUi = request => request.headers.get('X-AH-Auth-UI') === AUTH_UI_VERSION;
const telegramActivationAuthorized = (request, env) => {
  const expected = String(env?.TELEGRAM_CANARY_ACTIVATION_SECRET || '');
  const supplied = String(request.headers.get('X-AH-Telegram-Activation') || '');
  return /^[A-Za-z0-9_-]{32,128}$/.test(expected)
    && supplied.length === expected.length
    && constantTimeEqual(supplied, expected);
};
// Owner 2026-10-17: forward only known, non-secret fields, and only the ones the
// admin actually sent. Normalizing here (verificationConfig) filled every missing
// timeoutMs with 8s before the orchestrator could keep the current value.
const ADMIN_POLICY_KEYS = Object.freeze(['codeTtlSeconds', 'maxAttempts', 'resendCooldownSeconds', 'lockoutSeconds', 'maxProviderRetries', 'circuitFailureThreshold', 'circuitCooldownSeconds', 'lowQuotaRatio']);
const ADMIN_PROVIDER_KEYS = Object.freeze(['id', 'enabled', 'priority', 'dailyQuota', 'timeoutMs', 'label']);
const pickKeys = (source, keys) => Object.fromEntries(keys
  .filter(key => Object.prototype.hasOwnProperty.call(source, key))
  .filter(key => ['string', 'number', 'boolean'].includes(typeof source[key]))
  .map(key => [key, source[key]]));
const adminVerificationConfigInput = raw => {
  const sent = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const out = {};
  if (typeof sent.enabled === 'boolean') out.enabled = sent.enabled;
  if (sent.policy && typeof sent.policy === 'object' && !Array.isArray(sent.policy)) out.policy = pickKeys(sent.policy, ADMIN_POLICY_KEYS);
  if (Array.isArray(sent.providers)) {
    out.providers = sent.providers.slice(0, 64)
      .filter(row => row && typeof row === 'object' && !Array.isArray(row))
      .map(row => pickKeys(row, ADMIN_PROVIDER_KEYS));
  }
  if (Array.isArray(sent.allowedDomains)) out.allowedDomains = sent.allowedDomains.filter(value => typeof value === 'string').slice(0, 200);
  return out;
};
const adminAuthorized = (request, env) => {
  const expected = String(env?.ADMIN_TOKEN || '');
  const supplied = String(request.headers.get('X-AH-Admin-Token') || '');
  return expected.length >= 20 && supplied.length === expected.length && constantTimeEqual(supplied, expected);
};
const passkeyEndpointReady = env => ['canary', 'enabled'].includes(String(env?.PASSKEY_AUTH_ACTIVATION || ''));
const passkeyPublished = env => env?.PASSKEY_AUTH_ACTIVATION === 'enabled';
const passkeyCanaryRequested = (env, url) =>
  env?.PASSKEY_AUTH_ACTIVATION === 'canary' && url.searchParams.get('passkeyCanary') === '1';

const pendingDeps = () => ({ callAuthority, json, authSuccess, verificationCookie, deviceCookie, providerError });

export function createNativeAuthHandler({ fetchImpl = globalThis.fetch } = {}) {
  const publicConfigCache = new WeakMap();
  return async function handleNativeAuthRequest(request, env, executionContext) {
    const url = new URL(request.url);
    // The public-safe profile projection lives further down in this handler but
    // sits OUTSIDE the /api/auth/v1 prefix. Gating on the auth prefix alone made
    // it unreachable: the request fell through to the product API, which
    // answered {"error":"not-found"}, every shared public profile 404'd.
    const isPublicProfileRoute = url.pathname.startsWith(PUBLIC_PROFILE_PREFIX);
    if (!claimsAuthPath(url.pathname)) return null;
    const origin = request.headers.get('Origin') || '';
    const telegramOperation = request.method === 'POST' && [
      `${AUTH_API_PREFIX}/telegram/webhook`,
      `${AUTH_API_PREFIX}/telegram/canary/activate`,
      `${AUTH_API_PREFIX}/telegram/canary/deactivate`
    ].includes(url.pathname);
    const originOptional = request.method === 'GET' || telegramOperation;
    if ((!origin && !originOptional) || (origin && !allowedOrigin(origin))) {
      return json(request, 403, { ok: false, error: { code: 'ORIGIN_FORBIDDEN', message: 'অনুমোদিত উৎস নয়।' } });
    }
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          ...JSON_HEADERS,
          ...corsHeaders(request),
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'content-type, x-ah-admin-token, x-ah-auth-ui, x-ah-signup-flow',
          'Access-Control-Max-Age': '600'
        }
      });
    }

    const provider = new FirebaseEmailPasswordProvider({
      apiKey: env?.FIREBASE_WEB_API_KEY,
      continueUrl: env?.FIREBASE_CONTINUE_URL,
      fetchImpl
    });
    const jar = cookies(request);
    const context = clientContext(request, jar[AUTH_DEVICE_COOKIE]);
    const googleRequest = request.method === 'POST' && url.pathname === `${AUTH_API_PREFIX}/google`;
    let authStage = 'PROVIDER_CONFIG';

    try {
      if (request.method === 'POST' && [
        `${AUTH_API_PREFIX}/telegram/canary/activate`,
        `${AUTH_API_PREFIX}/telegram/canary/deactivate`
      ].includes(url.pathname)) {
        if (url.hostname !== 'admission-gk.admissionhub.workers.dev'
          || !['canary', 'enabled'].includes(env?.VERIFICATION_AUTH_ACTIVATION)
          || !telegramActivationAuthorized(request, env)) {
          return json(request, 403, { ok: false, error: { code: 'FORBIDDEN', message: 'অনুমতি নেই।' } });
        }
        await readJson(request);
        const action = url.pathname.endsWith('/deactivate') ? 'deactivate' : 'activate';
        const result = await callAuthority(env, `/internal/verification/telegram/${action}`, {});
        return json(request, 200, {
          ok: true,
          ...(action === 'activate' ? {
            ready: result?.ready === true,
            identityReady: result?.identityReady === true,
            webhookReady: result?.webhookReady === true,
            endpointAccepted: result?.endpointAccepted === true,
            webhookChanged: result?.webhookChanged === true
          } : { removed: result?.removed === true })
        });
      }

      if (request.method === 'POST' && url.pathname === `${AUTH_API_PREFIX}/telegram/webhook`) {
        const expected = await resolveTelegramWebhookSecret(env);
        const supplied = String(request.headers.get('X-Telegram-Bot-Api-Secret-Token') || '');
        if (!validTelegramWebhookSecret(expected) || supplied.length !== expected.length || !constantTimeEqual(supplied, expected)) {
          return json(request, 403, { ok: false, error: { code: 'FORBIDDEN', message: 'অনুমতি নেই।' } });
        }
        const payload = await readJson(request);
        let input;
        try { input = telegramWebhookInput(payload); }
        catch { return json(request, 200, { ok: true }); }
        try { await callAuthority(env, '/internal/verification/telegram/webhook', { input }); }
        catch (cause) {
          if (cause?.code !== AUTH_ERROR_CODES.OTP_INVALID) throw cause;
        }
        return json(request, 200, { ok: true });
      }

      if (request.method === 'GET' && url.pathname === `${AUTH_API_PREFIX}/config`) {
        const googleCanary = googleCanaryRequested(env, url);
        const passkeyCanary = passkeyCanaryRequested(env, url);
        const telegramCanary = telegramCanaryRequested(env, url);
        const cacheVariant = `${googleCanary ? 'google-canary' : 'public'}:${passkeyCanary ? 'passkey-canary' : 'public'}:${telegramCanary ? 'telegram-canary' : 'public'}`;
        const cache = publicConfigCache.get(env);
        const cached = cache?.get(cacheVariant);
        if (cached && cached.expiresAt > Date.now()) return json(request, 200, cached.body);
        const health = await callAuthority(env, '/internal/ping', null, 'GET');
        let firebaseReady = false;
        let project = null;
        let availability = Object.freeze({ code: provider.configured ? 'PROJECT_CHECK_FAILED' : 'CREDENTIAL_MISSING', providerStatus: 0 });
        if (provider.configured) {
          try {
            project = await provider.inspectProject();
            firebaseReady = project.projectIdentified && project.continueDomainAuthorized;
            availability = Object.freeze({
              code: !project.projectIdentified ? 'PROJECT_NOT_IDENTIFIED' : !project.continueDomainAuthorized ? 'PAGES_DOMAIN_NOT_AUTHORIZED' : 'READY',
              providerStatus: 0
            });
          } catch (cause) { availability = providerAvailabilityFailure(cause); }
        }
        const available = firebaseReady && health.ok === true;
        const googleRequested = googlePublished(env) || googleCanary;
        let google = {
          available: false,
          availabilityCode: googleRequested ? 'PROVIDER_CHECK_FAILED' : googleEndpointReady(env) ? 'LIVE_E2E_PENDING' : 'LIVE_E2E_NOT_APPROVED'
        };
        if (available && googleRequested) {
          try {
            const discovered = project?.google?.enabled && project.google.clientId
              ? { available: true, clientId: project.google.clientId }
              : await provider.inspectGoogleProvider();
            google = { available: discovered.available === true, availabilityCode: 'READY', clientId: discovered.clientId };
          } catch (cause) {
            const failure = providerAvailabilityFailure(cause);
            google = { available: false, availabilityCode: failure.code };
          }
        }
        const facebookRequested = facebookPublished(env);
        let facebook = {
          available: false,
          availabilityCode: facebookRequested ? 'PROVIDER_CHECK_FAILED' : facebookEndpointReady(env) ? 'LIVE_E2E_PENDING' : 'LIVE_E2E_NOT_APPROVED'
        };
        if (available && facebookRequested) {
          try {
            const discovered = project?.facebook?.enabled && project.facebook.clientId
              ? { available: true, clientId: project.facebook.clientId }
              : await provider.inspectFacebookProvider();
            facebook = { available: discovered.available === true, availabilityCode: 'READY', clientId: discovered.clientId };
          } catch (cause) {
            const failure = providerAvailabilityFailure(cause);
            facebook = { available: false, availabilityCode: failure.code };
          }
        }
        const verificationRequested = verificationPublished(env) || telegramCanary;
        let telegramAvailable = false;
        let backup = {
          available: false,
          availabilityCode: verificationRequested
            ? 'STATUS_UNAVAILABLE'
            : verificationEndpointReady(env) ? 'LIVE_E2E_PENDING' : 'NOT_ACTIVATED',
          genericFlow: true,
          providerNamesExposed: false
        };
        if (available && verificationRequested) {
          try {
            const capabilities = await callAuthority(env, '/internal/verification/capabilities', {});
            telegramAvailable = capabilities?.telegramAvailable === true;
            backup = {
              available: capabilities?.available === true,
              availabilityCode: String(capabilities?.availabilityCode || 'STATUS_UNAVAILABLE'),
              genericFlow: true,
              providerNamesExposed: false,
              contactInput: ['none', 'optional', 'required'].includes(capabilities?.contactInput) ? capabilities.contactInput : 'none',
              maxAttempts: Number(capabilities?.maxAttempts || 5),
              expiresInSeconds: Number(capabilities?.expiresInSeconds || 300)
            };
          } catch { backup = { available: false, availabilityCode: 'STATUS_UNAVAILABLE', genericFlow: true, providerNamesExposed: false }; }
        }
        const emailOwnership = {
          available: verificationRequested && backup?.available === true,
          availabilityCode: verificationRequested
            ? String(backup?.availabilityCode || 'STATUS_UNAVAILABLE')
            : verificationEndpointReady(env) ? 'LIVE_E2E_PENDING' : 'NOT_ACTIVATED',
          verifiesEmailOwnership: true,
          codeLength: 6,
          maxAttempts: Number(backup?.maxAttempts || 5),
          expiresInSeconds: Number(backup?.expiresInSeconds || 300),
          providerNamesExposed: false
        };
        const telegramVerification = {
          available: verificationRequested && telegramAvailable,
          availabilityCode: verificationRequested ? String(backup?.availabilityCode || 'STATUS_UNAVAILABLE') : verificationEndpointReady(env) ? 'LIVE_E2E_PENDING' : 'NOT_ACTIVATED',
          optional: true,
          codeLength: 6,
          expiresInSeconds: Number(backup?.expiresInSeconds || 300),
          maxAttempts: Number(backup?.maxAttempts || 5),
          verifiesEmailOwnership: false,
          canonicalIdentity: 'firebase-uid'
        };
        const passkeyAvailable = available && health.schema >= 3 && (passkeyPublished(env) || passkeyCanary);
        const passkeyEnrollmentAvailable = available && health.schema >= 3 && passkeyEndpointReady(env);
        const publicBackup = (verificationPublished(env) || telegramCanary) ? backup : {
          available: false,
          availabilityCode: 'LIVE_E2E_PENDING',
          genericFlow: true,
          providerNamesExposed: false
        };
        const body = {
          ok: true,
          auth: {
            version: AUTH_NATIVE_VERSION,
            uiContract: AUTH_UI_VERSION,
            onboarding: {
              version: 'premium-onboarding-v1',
              firstEntryRemembered: true,
              guestAllowed: true,
              profileVersion: 1
            },
            mode: 'firebase-canonical-multi-method',
            provider: 'firebase',
            available,
            availabilityCode: available ? 'READY' : availability.code,
            providerStatus: availability.providerStatus,
            storage: health.storage,
            accountVerificationRequired: true,
            emailVerifiedRequired: !telegramVerification.available && !emailOwnership.available,
            emailOwnershipProof: emailOwnership.available
              ? 'email-otp-or-firebase-email-verification'
              : 'firebase-email-verification-only',
            methods: {
              google,
              facebook,
              telegramLogin: available && telegramLoginReady(env)
                ? { available: true, botId: telegramLoginBotId(env) }
                : { available: false },
              passkey: {
                available: passkeyAvailable,
                enrollmentAvailable: passkeyEnrollmentAvailable,
                availabilityCode: passkeyAvailable ? 'READY' : passkeyEndpointReady(env) ? 'LIVE_E2E_PENDING' : 'NOT_ACTIVATED',
                requiresEnrollment: true,
                neverMandatory: true
              },
              emailPassword: { available, availabilityCode: available ? 'READY' : availability.code },
              passwordReset: { available, availabilityCode: available ? 'READY' : availability.code },
              profile: { available, version: 1, accountScoped: true, pendingTicketScoped: true },
              emailOwnership,
              telegramVerification,
              backup: publicBackup
            },
            verificationEmail: {
              kind: 'address-verification',
              dailyCapacity: 1000,
              resendCooldownSeconds: FIREBASE_VERIFICATION_RESEND_SECONDS,
              statusCheckAvailable: true
            },
            registeredAccountLimit: 'unlimited',
            session: { transport: 'secure-http-only-cookie', maxAge: SESSION_SECONDS }
          }
        };
        const nextCache = cache || new Map();
        nextCache.set(cacheVariant, { body, expiresAt: Date.now() + 30_000 });
        if (!cache) publicConfigCache.set(env, nextCache);
        return json(request, 200, body);
      }

      if (request.method === 'POST' && url.pathname === `${AUTH_API_PREFIX}/signup`) {
        if (!provider.configured) throw new NativeAuthError(AUTH_ERROR_CODES.NOT_CONFIGURED);
        const telegramRequested = telegramVerificationRequested(env, url);
        if (telegramRequested && !currentAuthUi(request)) {
          throw new NativeAuthError(AUTH_ERROR_CODES.CLIENT_UPDATE_REQUIRED);
        }
        const turnstileBody = await readJson(request);
        // A1.5 / AU-SEC-01 L4: human check before any Firebase or OTP work.
        await verifyTurnstile({ env, token: turnstileBody?.turnstileToken, ip: context.ip, fetchImpl });
        const input = credentials(turnstileBody);
        // Owner order 2026-10-16: refuse a throwaway inbox before any account is
        // created or any OTP is sent. Server-side so a patched client cannot skip it.
        if (isDisposableEmail(input.email)) throw new NativeAuthError(AUTH_ERROR_CODES.DISPOSABLE_EMAIL);
        if (reservedTelegramLoginEmail(input.email)) throw new NativeAuthError(AUTH_ERROR_CODES.DISPOSABLE_EMAIL);
        const prepared = await callAuthority(env, '/internal/firebase/rate', { input: { operation: 'signup', email: input.email }, context });
        // AUTH-ROADMAP step 1: an opted-in dual-choice signup holds the credentials; no account until the code is proven.
        if (emailOwnershipRequested(env, url) && pendingSignup.pendingSignupRequested(request)) return pendingSignup.beginPendingSignup({ request, env, context, prepared, password: input.password, deps: pendingDeps() });
        let signed;
        try { signed = await provider.signUp(prepared.email, input.password); } catch (cause) { throw providerError(cause, 'signup'); }

        const telegramAvailable = await telegramVerificationAvailable(env, telegramRequested);
        if (telegramRequested) {
          try {
            const temporaryRefreshMaterial = signed.refreshToken;
            const ticket = await callAuthority(env, '/internal/firebase/account-verification/begin', {
              input: {
                email: prepared.email,
                subject: signed.subject,
                refreshToken: temporaryRefreshMaterial
              },
              context
            });
            return json(request, 202, {
              ok: true,
              accountCreated: true,
              authenticated: false,
              verification: {
                sent: false,
                selectionRequired: true,
                emailMasked: prepared.emailMask,
                requiredBeforeLogin: true,
                options: {
                  email: { available: true, verifiesEmailOwnership: true },
                  telegram: { available: telegramAvailable, verifiesEmailOwnership: false }
                }
              }
            }, {
              'Set-Cookie': [
                ...(context.isNewDevice ? [deviceCookie(context.deviceId)] : []),
                verificationCookie(ticket.verificationTicket)
              ]
            });
          } catch {
            // Public dual-choice signup must never silently fall back to sending
            // Email. Keep the canonical Firebase subject recoverable by password
            // login, but fail closed with an explicit no-delivery message.
            throw new NativeAuthError(AUTH_ERROR_CODES.VERIFICATION_UNAVAILABLE, {
              message: 'অ্যাকাউন্ট তৈরি হয়েছে, কিন্তু যাচাইয়ের পদ্ধতি এখন প্রস্তুত করা যাচ্ছে না, কিছু পাঠানো হয়নি। একটু পরে এই ইমেইল দিয়ে লগইন করুন।'
            });
          }
        }

        try {
          await callAuthority(env, '/internal/firebase/rate', { input: { operation: 'verification-send', email: prepared.email }, context });
          await provider.sendVerificationEmail(signed.idToken, prepared.email);
        } catch (cause) {
          try { await provider.deleteAccount(signed.idToken); } catch {}
          throw cause instanceof NativeAuthError ? cause : providerError(cause, 'verification');
        }
        return json(request, 202, {
          ok: true,
          accountCreated: true,
          authenticated: false,
          verification: {
            sent: true,
            selectionRequired: false,
            emailMasked: prepared.emailMask,
            requiredBeforeLogin: true,
            dailyCapacity: 1000,
            resendAfter: FIREBASE_VERIFICATION_RESEND_SECONDS
          }
        }, context.isNewDevice ? { 'Set-Cookie': deviceCookie(context.deviceId) } : {});
      }

      if (request.method === 'POST' && url.pathname === `${AUTH_API_PREFIX}/password-reset`) {
        if (!provider.configured) throw new NativeAuthError(AUTH_ERROR_CODES.NOT_CONFIGURED);
        const body = await readJson(request);
        // A1.5 / AU-SEC-01 L4: human check before any send.
        await verifyTurnstile({ env, token: body?.turnstileToken, ip: context.ip, fetchImpl });
        const email = normalizeAuthEmail(body?.email);
        if (isDisposableEmail(email)) throw new NativeAuthError(AUTH_ERROR_CODES.DISPOSABLE_EMAIL);
        const prepared = await callAuthority(env, '/internal/firebase/rate', {
          input: { operation: 'password-reset', email }, context
        });
        try {
          await provider.sendPasswordResetEmail(prepared.email);
        } catch (cause) {
          // Account existence, disabled state, and provider-side address normalization must look identical.
          const privateAccountResult = cause instanceof FirebaseRequestError
            && ['EMAIL_NOT_FOUND', 'USER_DISABLED', 'INVALID_EMAIL', 'MISSING_EMAIL'].includes(cause.reason);
          if (!privateAccountResult) throw providerError(cause, 'password-reset');
        }
        return json(request, 202, {
          ok: true,
          accepted: true,
          deliveryDisclosed: false,
          resendAfter: FIREBASE_VERIFICATION_RESEND_SECONDS
        }, context.isNewDevice ? { 'Set-Cookie': deviceCookie(context.deviceId) } : {});
      }

      if (request.method === 'POST' && url.pathname === `${AUTH_API_PREFIX}/verification/resend`) {
        if (!provider.configured) throw new NativeAuthError(AUTH_ERROR_CODES.NOT_CONFIGURED);
        const turnstileBody = await readJson(request);
        // A1.5 / AU-SEC-01 L4: human check before any Firebase or OTP work.
        await verifyTurnstile({ env, token: turnstileBody?.turnstileToken, ip: context.ip, fetchImpl });
        const input = credentials(turnstileBody);
        const prepared = await callAuthority(env, '/internal/firebase/rate', { input: { operation: 'verification-resend', email: input.email }, context });
        let signed;
        let user;
        try { signed = await provider.signIn(prepared.email, input.password); } catch (cause) { throw providerError(cause, 'signin'); }
        try { user = await provider.lookup(signed.idToken); } catch (cause) { throw providerError(cause, 'lookup'); }
        assertProviderUser(signed, user);
        if (user.emailVerified) return json(request, 200, { ok: true, alreadyVerified: true, authenticated: false });
        await callAuthority(env, '/internal/firebase/rate', { input: { operation: 'verification-send', email: user.email }, context });
        try { await provider.sendVerificationEmail(signed.idToken, user.email); } catch (cause) { throw providerError(cause, 'verification'); }
        return json(request, 202, {
          ok: true,
          authenticated: false,
          verification: { sent: true, emailMasked: prepared.emailMask, dailyCapacity: 1000, resendAfter: FIREBASE_VERIFICATION_RESEND_SECONDS }
        }, context.isNewDevice ? { 'Set-Cookie': deviceCookie(context.deviceId) } : {});
      }

      if (request.method === 'POST' && url.pathname === `${AUTH_API_PREFIX}/login`) {
        if (!provider.configured) throw new NativeAuthError(AUTH_ERROR_CODES.NOT_CONFIGURED);
        const turnstileBody = await readJson(request);
        // A1.5 / AU-SEC-01 L4: human check before any Firebase or OTP work.
        await verifyTurnstile({ env, token: turnstileBody?.turnstileToken, ip: context.ip, fetchImpl });
        const input = credentials(turnstileBody);
        const prepared = await callAuthority(env, '/internal/firebase/rate', { input: { operation: 'login', email: input.email }, context });
        // Phase 6, escalating cooldown after repeated failed logins (§14):
        // the DO counts recorded failures and asks us to delay this attempt.
        // A delay, never a lockout: the cooldown always expires.
        if (Number(prepared?.retryAfter) > 0) {
          return json(request, 429, { ok: false, error: { code: 'RATE_LIMITED', message: 'অনেকবার চেষ্টা হয়েছে, একটু পরে আবার চেষ্টা করুন।' } }, { 'Retry-After': String(prepared.retryAfter) });
        }
        // Shadow Guard (P30). Off unless SHADOW_GUARD_ACTIVATION is set, so
        // this block is inert by default. A canary address is flagged and
        // then treated as a high-risk attempt: it must look exactly like a
        // wrong password, otherwise the decoy teaches the attacker it was a
        // decoy.
        const canaryHit = flagCanaryHit(env, prepared.email, context);
        const mode = shadowGuardMode(env);
        const guardActive = mode !== SHADOW_GUARD_MODES.OFF || canaryHit;
        // A canary is a decoy, so it is enforced even while the guard is only
        // observing: nobody legitimate ever signs in with it, and letting it
        // through in observe mode would defeat its whole purpose.
        const enforcing = mode === SHADOW_GUARD_MODES.ENFORCE || canaryHit;
        const guardStore = shadowGuardStore(env);
        // The password guard counts the ip+email pair, so an attacker guessing
        // on a student's address from elsewhere can never spend that student's
        // attempts. A block is refused before the provider is called at all.
        const passwordGuard = guardActive && guardStore
          ? createKvPasswordGuard(guardStore)
          : null;
        const guardKey = passwordGuard ? passwordGuardKey(prepared.email, context.ip) : '';
        // The strike count is read even while the guard is only observing:
        // without it the guard has almost no facts, the high band is
        // unreachable, and the shadow-ban it exists to perform never runs.
        let priorStrikes = 0;
        if (passwordGuard) {
          // A guard must never be able to break a login. The KV read is the
          // one call here that can reject, and if it does the attempt simply
          // proceeds unguarded - which is exactly the behaviour of the
          // deployment before the guard existed.
          let state = null;
          try {
            state = await passwordGuard.check(guardKey, 'user');
          } catch {
            state = null;
          }
          priorStrikes = passwordFailuresSoFar(state, 'user');
          if (enforcing && state?.blocked) {
            return json(request, 429, {
              ok: false,
              error: { code: 'RATE_LIMITED', message: 'অনেকবার ভুল পাসওয়ার্ড দেওয়া হয়েছে। কিছুক্ষণ পর আবার চেষ্টা করুন।' }
            }, { 'Retry-After': String(state.retryAfterSeconds) });
          }
        }
        let shadow = null;
        if (guardActive) {
          // Where this account was last seen from, and how many accounts this
          // address is trying. Both are stored hashed and both fail open. The
          // whole block is wrapped as well: the guard is a passenger on the
          // login path, and a passenger must never be able to stop the train.
          let accountFacts = null;
          let breadth = null;
          try {
            accountFacts = guardStore
              ? await createKvLoginFacts(guardStore).observe(prepared.email, { country: context.country, asn: context.asn })
              : null;
            breadth = guardStore
              ? await createKvIpBreadth(guardStore).observe(context.ip, prepared.email)
              : null;
          } catch {
            accountFacts = null;
            breadth = null;
          }
          shadow = shadowVerdict({
            deviceKnown: context.isNewDevice !== true,
            failedLogins: priorStrikes,
            countryChanged: accountFacts?.countryChanged === true,
            asnChanged: accountFacts?.asnChanged === true,
            emailsFromIp: breadth?.emailsFromIp || 0,
            botScore: context.botScore,
            accountState: canaryHit ? 'suspended' : undefined
          });
          // In observe mode the verdict is reported and then ignored: the
          // attempt continues exactly as it would with the guard absent.
          if (shadow.shadowBan) {
            sendThrottledSecurityAlert(env, guardStore, {
              event: SECURITY_ALERT_EVENTS.SHADOW_BAN,
              email: prepared.email,
              band: shadow.band,
              reasons: enforcing ? shadow.reasons : [...shadow.reasons, 'observe-only'],
              at: Date.now()
            });
            if (enforcing) {
              // The delay is spent before the answer, so the response time
              // carries no signal either.
              await sleep(shadowDelayMs());
              throw new NativeAuthError(AUTH_ERROR_CODES.INVALID_CREDENTIALS);
            }
          }
        }
        let signed;
        let user;
        let failureRetryAfter = 0;
        try {
          signed = await provider.signIn(prepared.email, input.password);
        } catch (cause) {
          if (cause instanceof FirebaseRequestError && ['INVALID_LOGIN_CREDENTIALS', 'EMAIL_NOT_FOUND', 'INVALID_PASSWORD'].includes(cause.reason)) {
            try {
              const recorded = await callAuthority(env, '/internal/firebase/login/failure', { input: { email: prepared.email }, context });
              failureRetryAfter = Number(recorded?.retryAfter || 0);
            } catch {}
            if (passwordGuard) {
              try {
                const counted = await passwordGuard.recordFailure(guardKey, 'user');
                if (counted?.blocked) failureRetryAfter = Math.max(failureRetryAfter, counted.retryAfterSeconds);
              } catch {}
            }
          }
          const error = providerError(cause, 'signin');
          if (failureRetryAfter > 0) error.retryAfter = Math.max(Number(error.retryAfter || 0), failureRetryAfter);
          throw error;
        }
        try { user = await provider.lookup(signed.idToken); } catch (cause) { throw providerError(cause, 'lookup'); }
        assertProviderUser(signed, user);
        // The password was right, so the pair's failures are spent. This can
        // only run when the pair was not blocked: a block is refused before
        // the provider is reached, so a correct guess can never lift one.
        if (passwordGuard) {
          try { await passwordGuard.recordSuccess(guardKey, 'user'); } catch {}
        }
        // A new device that got past the password is exactly the event the
        // owner asked to hear about: if it was not them, this is the first
        // they will know. In observe mode it is not worth telling: a new
        // device is the ordinary shape of a first login, and at launch that
        // is hundreds of students, not an attack. Only the high band - a
        // would-be ban - is reported while the guard is watching.
        if (guardActive && context.isNewDevice && (enforcing || shadow?.band === 'high')) {
          sendThrottledSecurityAlert(env, guardStore, {
            event: SECURITY_ALERT_EVENTS.NEW_DEVICE,
            email: prepared.email,
            band: shadow ? shadow.band : 'low',
            at: Date.now()
          });
        }
        const telegramRequested = telegramVerificationRequested(env, url);
        const telegramVerified = !user.emailVerified && await telegramVerificationStatus({
          env,
          user,
          context,
          allowed: telegramRequested
        });
        // An address proven by a delivered OTP stays proven for the account, so a
        // later sign-in must not be asked to repeat it. Without this the ownership
        // proof only ever unlocked the session that created it: every logout and
        // sign-in demanded a fresh code even though the record was still active.
        // `allowed: true` mirrors firebaseReadySession, so login and session
        // bootstrap give the same answer for the same account.
        const ownershipVerified = !user.emailVerified && !telegramVerified && await emailOwnershipProven({
          env,
          user,
          context,
          allowed: true
        });
        const accountVerified = user.emailVerified || telegramVerified || ownershipVerified;
        if (!accountVerified && telegramRequested && !currentAuthUi(request)) {
          throw new NativeAuthError(AUTH_ERROR_CODES.CLIENT_UPDATE_REQUIRED);
        }
        const telegramAvailable = await telegramVerificationAvailable(env, telegramRequested);
        if (!accountVerified && telegramRequested) {
          try {
            const temporaryRefreshMaterial = signed.refreshToken;
            const ticket = await callAuthority(env, '/internal/firebase/account-verification/begin', {
              input: {
                email: user.email,
                subject: user.subject,
                refreshToken: temporaryRefreshMaterial
              },
              context
            });
            return json(request, 202, {
              ok: true,
              authenticated: false,
              accountVerified: false,
              verification: {
                sent: false,
                selectionRequired: true,
                emailMasked: prepared.emailMask,
                options: {
                  email: { available: true, verifiesEmailOwnership: true },
                  telegram: { available: telegramAvailable, verifiesEmailOwnership: false }
                }
              }
            }, {
              'Set-Cookie': [
                ...(context.isNewDevice ? [deviceCookie(context.deviceId)] : []),
                verificationCookie(ticket.verificationTicket)
              ]
            });
          } catch {}
        }
        if (!accountVerified) throw new NativeAuthError(AUTH_ERROR_CODES.EMAIL_NOT_VERIFIED);
        const established = await callAuthority(env, '/internal/firebase/session/create', {
          input: {
            email: user.email,
            subject: user.subject,
            remember: input.remember,
            verified: accountVerified,
            newDevice: context.isNewDevice === true,
            securityChallenge: true
          },
          context
        });
        // Phase 6, new device (or elevated risk) on a verified account:
        // challenge-first-then-proceed, reusing the existing verification
        // selection UI. Completing it issues the session AND earns 30-day
        // device trust (single consent moment, no TOTP in v1).
        if (established.challenge) {
          let ticket;
          try {
            const temporaryRefreshMaterial = signed.refreshToken;
            ticket = await callAuthority(env, '/internal/firebase/account-verification/begin', {
              input: {
                email: user.email,
                subject: user.subject,
                refreshToken: temporaryRefreshMaterial,
                purpose: 'new-device'
              },
              context
            });
          } catch {
            // Fail closed: a risk decision can never be silently bypassed.
            throw new NativeAuthError(AUTH_ERROR_CODES.VERIFICATION_UNAVAILABLE, {
              message: 'নিরাপত্তার জন্য এই ডিভাইসটি এখন যাচাই করা যাচ্ছে না, একটু পরে আবার চেষ্টা করুন।'
            });
          }
          return json(request, 202, {
            ok: true,
            authenticated: false,
            accountVerified: true,
            verification: {
              sent: false,
              selectionRequired: true,
              emailMasked: prepared.emailMask,
              reason: 'new-device',
              options: {
                email: { available: true, verifiesEmailOwnership: true },
                telegram: { available: telegramAvailable, verifiesEmailOwnership: false }
              }
            },
            security: {
              challenge: established.challenge.type,
              level: established.challenge.level,
              policyVersion: established.challenge.policyVersion
            }
          }, {
            'Set-Cookie': [
              ...(context.isNewDevice ? [deviceCookie(context.deviceId)] : []),
              verificationCookie(ticket.verificationTicket)
            ]
          });
        }
        return authSuccess(request, established, signed.refreshToken, context, {
          emailVerified: user.emailVerified === true,
          telegramVerified,
          emailOwnershipProven: ownershipVerified
        });
      }

      if (request.method === 'POST' && url.pathname === `${AUTH_API_PREFIX}/google`) {
        if (!provider.configured || !googleEndpointReady(env)) throw new NativeAuthError(AUTH_ERROR_CODES.GOOGLE_UNAVAILABLE);
        try { await provider.inspectGoogleProvider(); } catch (cause) { throw providerError(cause, 'google-config'); }
        authStage = 'CREDENTIAL_INPUT';
        const credential = googleCredential(await readJson(request));
        authStage = 'RATE_CHECK';
        await callAuthority(env, '/internal/firebase/rate', { input: { operation: 'google' }, context });
        let signed;
        let user;
        authStage = 'FIREBASE_EXCHANGE';
        try { signed = await provider.signInWithGoogle(credential); } catch (cause) { throw providerError(cause, 'google-signin'); }
        authStage = 'IDENTITY_LOOKUP';
        try { user = await provider.lookup(signed.idToken); } catch (cause) { throw providerError(cause, 'google-lookup'); }
        assertProviderUser(signed, user);
        if (!user.providers.includes('google.com')) throw new NativeAuthError(AUTH_ERROR_CODES.ACCOUNT_CONFLICT);
        if (!user.emailVerified) throw new NativeAuthError(AUTH_ERROR_CODES.EMAIL_NOT_VERIFIED);
        authStage = 'ACCOUNT_SESSION';
        let established;
        try {
          established = await callAuthority(env, '/internal/firebase/session/create', { input: { email: user.email, subject: user.subject }, context });
        } catch (cause) {
          if (cause?.code === AUTH_ERROR_CODES.ACCOUNT_CONFLICT && signed.isNewUser) {
            let deleted = false;
            try { deleted = (await provider.deleteAccount(signed.idToken))?.deleted === true; } catch {}
            if (!deleted) throw new NativeAuthError(AUTH_ERROR_CODES.ACCOUNT_CONFLICT);
            throw new NativeAuthError(AUTH_ERROR_CODES.ACCOUNT_LINK_REQUIRED);
          }
          throw cause;
        }
        // Google → auto profile: seed the empty name/avatar from the VERIFIED
        // Firebase user. Never overwrites anything the student already set.
        // A seeding failure must never break or delay the login.
        // Optional enrichment must never hold the session cookies hostage.
        const enrichment = seedGoogleProfile(env, context, established, user).catch(() => {});
        if (typeof executionContext?.waitUntil === 'function') executionContext.waitUntil(enrichment);
        else await enrichment; // non-Worker adapters and existing unit tests
        const result = authSuccess(request, established, signed.refreshToken, context);
        result.headers.set('X-AH-Auth-Stage', 'SESSION_CREATED');
        return result;
      }

      if (request.method === 'POST' && url.pathname === `${AUTH_API_PREFIX}/google/link`) {
        if (!provider.configured || !googleEndpointReady(env)) throw new NativeAuthError(AUTH_ERROR_CODES.GOOGLE_UNAVAILABLE);
        const body = await readJson(request);
        const input = credentials(body);
        const credential = googleCredential(body);
        if (!credential.accessToken) throw new NativeAuthError(AUTH_ERROR_CODES.INVALID_INPUT);
        const email = normalizeAuthEmail(input.email);
        let googleIdentity;
        try { googleIdentity = await provider.googleIdentity(credential.accessToken); } catch (cause) { throw providerError(cause, 'google-identity'); }
        if (normalizeAuthEmail(googleIdentity.email) !== email) throw new NativeAuthError(AUTH_ERROR_CODES.ACCOUNT_CONFLICT);
        const prepared = await callAuthority(env, '/internal/firebase/rate', { input: { operation: 'login', email }, context });
        let passwordSession;
        let passwordUser;
        try { passwordSession = await provider.signIn(prepared.email, input.password); } catch (cause) { throw providerError(cause, 'signin'); }
        try { passwordUser = await provider.lookup(passwordSession.idToken); } catch (cause) { throw providerError(cause, 'lookup'); }
        assertProviderUser(passwordSession, passwordUser);
        const passwordTelegramVerified = !passwordUser.emailVerified && await telegramVerificationStatus({
          env,
          user: passwordUser,
          context,
          allowed: telegramVerificationRequested(env, url)
        });
        if (!passwordUser.emailVerified && !passwordTelegramVerified) throw new NativeAuthError(AUTH_ERROR_CODES.EMAIL_NOT_VERIFIED);
        let linked;
        let user;
        try { linked = await provider.linkGoogle(passwordSession.idToken, credential); } catch (cause) { throw providerError(cause, 'google-link'); }
        if (linked.subject !== passwordSession.subject) throw new NativeAuthError(AUTH_ERROR_CODES.ACCOUNT_CONFLICT);
        try { user = await provider.lookup(linked.idToken); } catch (cause) { throw providerError(cause, 'google-lookup'); }
        assertProviderUser(linked, user);
        if (!user.providers.includes('google.com') || !user.googleSubjects.includes(googleIdentity.subject)) {
          throw new NativeAuthError(AUTH_ERROR_CODES.ACCOUNT_CONFLICT);
        }
        const established = await callAuthority(env, '/internal/firebase/session/create', { input: { email: user.email, subject: user.subject }, context });
        return authSuccess(request, established, linked.refreshToken, context, {
          emailVerified: user.emailVerified === true,
          telegramVerified: user.emailVerified !== true && passwordTelegramVerified
        });
      }

      // Owner 2026-10-18: "Continue with Telegram" login.
      if (request.method === 'POST' && url.pathname === `${AUTH_API_PREFIX}/telegram/login`) {
        if (!provider.configured || !telegramLoginReady(env)) throw new NativeAuthError(AUTH_ERROR_CODES.TELEGRAM_VERIFICATION_UNAVAILABLE);
        authStage = 'CREDENTIAL_INPUT';
        let telegramUser;
        try { telegramUser = await verifyTelegramLogin(await readJson(request), env); }
        catch { throw new NativeAuthError(AUTH_ERROR_CODES.TELEGRAM_VERIFICATION_INVALID); }
        authStage = 'RATE_CHECK';
        await callAuthority(env, '/internal/firebase/rate', { input: { operation: 'telegram-login' }, context });
        const credentials = await telegramLoginCredentials(telegramUser.id, env);
        authStage = 'FIREBASE_EXCHANGE';
        let signed;
        try { signed = await provider.signIn(credentials.email, credentials.password); }
        catch (signInCause) {
          try { signed = await provider.signUp(credentials.email, credentials.password); }
          catch (cause) {
            if (String(cause?.reason || '').startsWith('EMAIL_EXISTS')) throw providerError(signInCause, 'telegram-signin');
            throw providerError(cause, 'telegram-signup');
          }
        }
        authStage = 'IDENTITY_LOOKUP';
        let user;
        try { user = await provider.lookup(signed.idToken); } catch (cause) { throw providerError(cause, 'telegram-lookup'); }
        assertProviderUser(signed, user);
        authStage = 'ACCOUNT_SESSION';
        const established = await callAuthority(env, '/internal/firebase/session/create', {
          input: { email: user.email, subject: user.subject, verified: true },
          context
        });
        // Telegram -> auto profile name (best effort, never blocks the login).
        const enrichment = seedGoogleProfile(env, context, established, { ...user, displayName: telegramUser.displayName, photoUrl: '' }).catch(() => {});
        if (typeof executionContext?.waitUntil === 'function') executionContext.waitUntil(enrichment);
        else await enrichment;
        const result = authSuccess(request, established, signed.refreshToken, context, { emailVerified: false, telegramVerified: true });
        result.headers.set('X-AH-Auth-Stage', 'SESSION_CREATED');
        return result;
      }

      if (request.method === 'POST' && url.pathname === `${AUTH_API_PREFIX}/facebook`) {
        if (!provider.configured || !facebookEndpointReady(env)) throw new NativeAuthError(AUTH_ERROR_CODES.GOOGLE_UNAVAILABLE);
        // Validate the provider the same way Google does. The project-level
        // idpConfig is not returned by this Firebase project's /v1/projects
        // endpoint, so only the createAuthUri probe proves facebook.com is live.
        try { await provider.inspectFacebookProvider(); } catch (cause) { throw providerError(cause, 'facebook-config'); }
        const credential = facebookCredential(await readJson(request));
        await callAuthority(env, '/internal/firebase/rate', { input: { operation: 'facebook' }, context });
        let signed;
        let user;
        try { signed = await provider.signInWithFacebook(credential); } catch (cause) { throw providerError(cause, 'facebook-signin'); }
        try { user = await provider.lookup(signed.idToken); } catch (cause) { throw providerError(cause, 'facebook-lookup'); }
        assertProviderUser(signed, user);
        if (!user.providers.includes('facebook.com')) throw new NativeAuthError(AUTH_ERROR_CODES.ACCOUNT_CONFLICT);
        if (!user.emailVerified) {
          // Firebase leaves facebook.com emails unverified by design. Accept the
          // address only when Facebook itself returns the same confirmed email
          // for this access token (Graph /me only exposes confirmed emails).
          let facebookUser = null;
          try { facebookUser = await provider.facebookIdentity(credential.accessToken); } catch {}
          if (!facebookUser || normalizeAuthEmail(facebookUser.email) !== normalizeAuthEmail(user.email)) {
            throw new NativeAuthError(AUTH_ERROR_CODES.EMAIL_NOT_VERIFIED);
          }
        }
        let established;
        try {
          established = await callAuthority(env, '/internal/firebase/session/create', { input: { email: user.email, subject: user.subject }, context });
        } catch (cause) {
          if (cause?.code === AUTH_ERROR_CODES.ACCOUNT_CONFLICT && signed.isNewUser) {
            let deleted = false;
            try { deleted = (await provider.deleteAccount(signed.idToken))?.deleted === true; } catch {}
            if (!deleted) throw new NativeAuthError(AUTH_ERROR_CODES.ACCOUNT_CONFLICT);
            throw new NativeAuthError(AUTH_ERROR_CODES.ACCOUNT_LINK_REQUIRED);
          }
          throw cause;
        }
        // Facebook → auto profile: seed the empty name from the VERIFIED Firebase
        // user. Facebook avatars are not fetched (their CDN is not pinned the way
        // Google's is); a seeding failure must never break the login.
        try {
          const establishedBody = established?.result || established;
          await seedGoogleProfile(env, context, establishedBody, user);
        } catch { /* best-effort by design */ }
        return authSuccess(request, established, signed.refreshToken, context);
      }

      if (request.method === 'POST' && url.pathname === `${AUTH_API_PREFIX}/account-verification/email/start`) {
        if (!provider.configured) throw new NativeAuthError(AUTH_ERROR_CODES.NOT_CONFIGURED);
        const verificationTicket = jar[AUTH_VERIFICATION_COOKIE];
        if (!verificationTicket) throw new NativeAuthError(AUTH_ERROR_CODES.TELEGRAM_VERIFICATION_INVALID);
        await readJson(request);
        const material = await callAuthority(env, '/internal/firebase/account-verification/material', {
          verificationTicket,
          context
        });
        let refreshed;
        let user;
        try { refreshed = await provider.refresh(material.refreshToken); } catch (cause) { throw providerError(cause, 'refresh'); }
        try { user = await provider.lookup(refreshed.idToken); } catch (cause) { throw providerError(cause, 'lookup-session'); }
        assertProviderUser(refreshed, user);
        // An address already proven by an OTP needs no Firebase measurement
        // link: sending one burns the free daily send quota and can never set
        // the flag this method checks. Answer like the Firebase flag was set so
        // the client proceeds straight to the status check.
        const ownershipAlreadyProven = !user.emailVerified && await emailOwnershipProven({ env, user, context, allowed: true });
        if (user.emailVerified || ownershipAlreadyProven) {
          return json(request, 200, { ok: true, alreadyVerified: true, authenticated: false });
        }
        await callAuthority(env, '/internal/firebase/rate', { input: { operation: 'verification-send', email: user.email }, context });
        try { await provider.sendVerificationEmail(refreshed.idToken, user.email); } catch (cause) { throw providerError(cause, 'verification'); }
        return json(request, 202, {
          ok: true,
          authenticated: false,
          verification: {
            sent: true,
            emailMasked: material.user?.emailMasked || 'আপনার ইমেইলে',
            dailyCapacity: 1000,
            resendAfter: FIREBASE_VERIFICATION_RESEND_SECONDS
          }
        }, context.isNewDevice ? { 'Set-Cookie': deviceCookie(context.deviceId) } : {});
      }

      if (request.method === 'POST' && url.pathname === `${AUTH_API_PREFIX}/account-verification/email/status`) {
        if (!provider.configured) throw new NativeAuthError(AUTH_ERROR_CODES.NOT_CONFIGURED);
        const verificationTicket = jar[AUTH_VERIFICATION_COOKIE];
        if (!verificationTicket) throw new NativeAuthError(AUTH_ERROR_CODES.TELEGRAM_VERIFICATION_INVALID);
        await readJson(request);
        await callAuthority(env, '/internal/firebase/rate', { input: { operation: 'verification-status' }, context });
        const material = await callAuthority(env, '/internal/firebase/account-verification/material', {
          verificationTicket,
          context
        });
        let refreshed;
        let user;
        try { refreshed = await provider.refresh(material.refreshToken); } catch (cause) { throw providerError(cause, 'refresh'); }
        try { user = await provider.lookup(refreshed.idToken); } catch (cause) { throw providerError(cause, 'lookup-session'); }
        assertProviderUser(refreshed, user);
        if (user.emailVerified !== true) {
          // An OTP delivered to the address itself proves ownership, so it
          // unlocks the account even while Firebase's own flag stays false.
          // Without this the Email method can never finish when the student is
          // asked to verify a device: the Firebase link only sets that flag for
          // mail Firebase sends, and delivery runs through Brevo, so the check
          // answered emailVerified:false forever.
          const ownershipVerified = await emailOwnershipProven({ env, user, context, allowed: true });
          if (!ownershipVerified) {
            return json(request, 200, {
              ok: true,
              authenticated: false,
              emailVerified: false,
              emailMasked: material.user?.emailMasked || 'তোমার Email-এ'
            }, context.isNewDevice ? { 'Set-Cookie': deviceCookie(context.deviceId) } : {});
          }
        }
        const established = await callAuthority(env, '/internal/firebase/account-verification/complete', {
          input: {
            verificationTicket,
            email: user.email,
            subject: user.subject
          },
          context
        });
        return authSuccess(request, established, refreshed.refreshToken, context, {
          emailVerified: user.emailVerified === true,
          telegramVerified: false,
          emailOwnershipProven: user.emailVerified !== true
        }, [verificationCookie('', 0)]);
      }

      if (request.method === 'POST' && url.pathname === `${AUTH_API_PREFIX}/email-ownership/start`) {
        if (!provider.configured || !emailOwnershipRequested(env, url)) {
          throw new NativeAuthError(AUTH_ERROR_CODES.BACKUP_UNAVAILABLE);
        }
        const verificationTicket = jar[AUTH_VERIFICATION_COOKIE];
        if (!verificationTicket) throw new NativeAuthError(AUTH_ERROR_CODES.TELEGRAM_VERIFICATION_INVALID);
        const startBody = await readJson(request);
        const magicLink = startBody?.method === 'magic-link';
        await verifyTurnstile({ env, token: startBody?.turnstileToken, ip: context.ip, fetchImpl });
        if (isPendingSignupTicket(verificationTicket)) return pendingSignup.startPendingSignupCode({ request, env, provider, context, ticket: verificationTicket, magicLink, deps: pendingDeps() });
        const material = await callAuthority(env, '/internal/firebase/account-verification/material', {
          verificationTicket,
          context
        });
        let refreshed;
        let user;
        try { refreshed = await provider.refresh(material.refreshToken); } catch (cause) { throw providerError(cause, 'refresh'); }
        try { user = await provider.lookup(refreshed.idToken); } catch (cause) { throw providerError(cause, 'lookup-session'); }
        assertProviderUser(refreshed, user);
        if (user.emailVerified) {
          return json(request, 200, { ok: true, alreadyVerified: true, authenticated: false });
        }
        await callAuthority(env, '/internal/firebase/rate', { input: { operation: 'verification-send', email: user.email }, context });
        let result;
        try {
          result = await callAuthority(env, '/internal/verification/ownership/request', {
            input: {
              verificationTicket,
              email: user.email,
              subject: user.subject,
              ...(magicLink ? { deliveryMethod: 'magic-link' } : {})
            },
            context
          });
        } catch (cause) {
          // A magic-link request never silently becomes a Firebase link or code.
          if (magicLink) throw cause;
          // Every OTP provider is out of quota or unreachable. The Firebase
          // measurement link is the documented last resort and needs no
          // third-party quota, so fall back rather than stranding the account.
          if (!(cause instanceof NativeAuthError) || cause.code !== AUTH_ERROR_CODES.BACKUP_UNAVAILABLE) throw cause;
          try { await provider.sendVerificationEmail(refreshed.idToken, user.email); } catch (sendCause) {
            throw sendCause instanceof NativeAuthError ? sendCause : providerError(sendCause, 'verification');
          }
          return json(request, 202, {
            ok: true,
            authenticated: false,
            delivery: {
              method: 'firebase-link',
              sent: true,
              fallback: true,
              emailMasked: material.user?.emailMasked || 'আপনার ইমেইলে',
              resendAfter: FIREBASE_VERIFICATION_RESEND_SECONDS
            }
          }, context.isNewDevice ? { 'Set-Cookie': deviceCookie(context.deviceId) } : {});
        }
        return json(request, 202, {
          ok: true,
          authenticated: false,
          delivery: { method: magicLink ? 'email-magic-link' : 'email-otp', sent: result?.sent !== false, fallback: false },
          ownership: {
            sent: result?.sent !== false,
            attemptId: result?.attemptId || '',
            emailMasked: material.user?.emailMasked || 'আপনার ইমেইলে',
            resendAfter: Number(result?.resendAfter || FIREBASE_VERIFICATION_RESEND_SECONDS)
          }
        }, context.isNewDevice ? { 'Set-Cookie': deviceCookie(context.deviceId) } : {});
      }

      if (request.method === 'POST' && url.pathname === `${AUTH_API_PREFIX}/email-ownership/verify`) {
        if (!provider.configured || !emailOwnershipRequested(env, url)) {
          throw new NativeAuthError(AUTH_ERROR_CODES.BACKUP_UNAVAILABLE);
        }
        const verificationTicket = jar[AUTH_VERIFICATION_COOKIE];
        if (!verificationTicket) throw new NativeAuthError(AUTH_ERROR_CODES.TELEGRAM_VERIFICATION_INVALID);
        const body = await readJson(request);
        // A magic-link token arrives in `token`; it is forwarded once and never logged.
        const magicToken = typeof body.token === 'string' ? body.token.trim() : '';
        const code = magicToken || String(body.code || '').trim();
        const attemptId = String(body.attemptId || '').trim();
        const codeOk = magicToken ? /^[A-Za-z0-9._~-]{16,2048}$/.test(magicToken) : /^\d{6}$/.test(code);
        if (!codeOk || !/^[A-Za-z0-9_-]{24,96}$/.test(attemptId)) {
          throw new NativeAuthError(AUTH_ERROR_CODES.INVALID_INPUT);
        }
        if (isPendingSignupTicket(verificationTicket)) {
          if (magicToken) throw new NativeAuthError(AUTH_ERROR_CODES.INVALID_INPUT);
          return pendingSignup.verifyPendingSignupCodeAndCreate({ request, env, provider, context, ticket: verificationTicket, attemptId, code, deps: pendingDeps() });
        }
        const material = await callAuthority(env, '/internal/firebase/account-verification/material', {
          verificationTicket,
          context
        });
        let refreshed;
        let user;
        try { refreshed = await provider.refresh(material.refreshToken); } catch (cause) { throw providerError(cause, 'refresh'); }
        try { user = await provider.lookup(refreshed.idToken); } catch (cause) { throw providerError(cause, 'lookup-session'); }
        assertProviderUser(refreshed, user);
        const verified = await callAuthority(env, '/internal/verification/ownership/verify', {
          input: { verificationTicket, email: user.email, subject: user.subject, attemptId, code },
          context
        });
        if (verified?.verified !== true || verified?.emailOwnershipProven !== true) {
          throw new NativeAuthError(AUTH_ERROR_CODES.OTP_INVALID);
        }
        const established = await callAuthority(env, '/internal/firebase/account-verification/complete', {
          input: { verificationTicket, email: user.email, subject: user.subject },
          context
        });
        return authSuccess(request, established, refreshed.refreshToken, context, {
          emailVerified: false,
          emailOwnershipProven: true
        }, [verificationCookie('', 0)]);
      }

      if (request.method === 'POST' && url.pathname === `${AUTH_API_PREFIX}/email-ownership/status`) {
        if (!provider.configured || !emailOwnershipRequested(env, url)) {
          throw new NativeAuthError(AUTH_ERROR_CODES.BACKUP_UNAVAILABLE);
        }
        const verificationTicket = jar[AUTH_VERIFICATION_COOKIE];
        if (!verificationTicket) throw new NativeAuthError(AUTH_ERROR_CODES.TELEGRAM_VERIFICATION_INVALID);
        await readJson(request);
        const material = await callAuthority(env, '/internal/firebase/account-verification/material', {
          verificationTicket,
          context
        });
        let refreshed;
        let user;
        try { refreshed = await provider.refresh(material.refreshToken); } catch (cause) { throw providerError(cause, 'refresh'); }
        try { user = await provider.lookup(refreshed.idToken); } catch (cause) { throw providerError(cause, 'lookup-session'); }
        assertProviderUser(refreshed, user);
        if (!user.emailVerified) {
          return json(request, 200, { ok: true, authenticated: false, emailVerified: false });
        }
        const established = await callAuthority(env, '/internal/firebase/account-verification/complete', {
          input: { verificationTicket, email: user.email, subject: user.subject },
          context
        });
        return authSuccess(request, established, refreshed.refreshToken, context, {
          emailVerified: true,
          telegramVerified: false
        }, [verificationCookie('', 0)]);
      }

      if (request.method === 'POST' && url.pathname === `${AUTH_API_PREFIX}/telegram/verification/start`) {
        if (!provider.configured || !telegramVerificationRequested(env, url)) {
          throw new NativeAuthError(AUTH_ERROR_CODES.TELEGRAM_VERIFICATION_UNAVAILABLE);
        }
        const verificationTicket = jar[AUTH_VERIFICATION_COOKIE];
        if (!verificationTicket) throw new NativeAuthError(AUTH_ERROR_CODES.TELEGRAM_VERIFICATION_INVALID);
        const turnstileBody = await readJson(request);
        // A1.5 / AU-SEC-01 L4: human check before a Telegram code is issued.
        await verifyTurnstile({ env, token: turnstileBody?.turnstileToken, ip: context.ip, fetchImpl });
        const result = await callAuthority(env, '/internal/verification/preauth/request', {
          input: { verificationTicket },
          context
        });
        return json(request, 202, { ok: true, ...result }, context.isNewDevice ? { 'Set-Cookie': deviceCookie(context.deviceId) } : {});
      }

      if (request.method === 'GET' && url.pathname === `${AUTH_API_PREFIX}/telegram/verification/pending`) {
        if (!provider.configured || !telegramVerificationRequested(env, url)) {
          throw new NativeAuthError(AUTH_ERROR_CODES.TELEGRAM_VERIFICATION_UNAVAILABLE);
        }
        const verificationTicket = jar[AUTH_VERIFICATION_COOKIE];
        if (!verificationTicket) throw new NativeAuthError(AUTH_ERROR_CODES.TELEGRAM_VERIFICATION_INVALID);
        const [material, result] = await Promise.all([
          callAuthority(env, '/internal/firebase/account-verification/material', { verificationTicket, context }),
          callAuthority(env, '/internal/verification/preauth/pending', {
            input: { verificationTicket },
            context
          })
        ]);
        return json(request, 200, {
          ok: true,
          ...result,
          ...(!result?.pending ? {
            selectionRequired: true,
            emailMasked: material.user?.emailMasked || 'আপনার ইমেইলে',
            options: {
              email: { available: true, verifiesEmailOwnership: true },
              telegram: { available: true, verifiesEmailOwnership: false }
            }
          } : {})
        }, context.isNewDevice ? { 'Set-Cookie': deviceCookie(context.deviceId) } : {});
      }

      if (request.method === 'POST' && url.pathname === `${AUTH_API_PREFIX}/telegram/verification/resend`) {
        if (!provider.configured || !telegramVerificationRequested(env, url)) {
          throw new NativeAuthError(AUTH_ERROR_CODES.TELEGRAM_VERIFICATION_UNAVAILABLE);
        }
        const verificationTicket = jar[AUTH_VERIFICATION_COOKIE];
        if (!verificationTicket) throw new NativeAuthError(AUTH_ERROR_CODES.TELEGRAM_VERIFICATION_INVALID);
        await readJson(request);
        const result = await callAuthority(env, '/internal/verification/preauth/request', {
          input: { verificationTicket },
          context
        });
        return json(request, 202, { ok: true, ...result }, context.isNewDevice ? { 'Set-Cookie': deviceCookie(context.deviceId) } : {});
      }

      if (request.method === 'POST' && url.pathname === `${AUTH_API_PREFIX}/telegram/verification/verify`) {
        if (!provider.configured || !telegramVerificationRequested(env, url)) {
          throw new NativeAuthError(AUTH_ERROR_CODES.TELEGRAM_VERIFICATION_UNAVAILABLE);
        }
        const verificationTicket = jar[AUTH_VERIFICATION_COOKIE];
        if (!verificationTicket) throw new NativeAuthError(AUTH_ERROR_CODES.TELEGRAM_VERIFICATION_INVALID);
        const body = await readJson(request);
        const code = String(body.code || '').trim();
        const attemptId = String(body.attemptId || '').trim();
        if (!/^\d{6}$/.test(code) || !/^[A-Za-z0-9_-]{24,96}$/.test(attemptId)) {
          throw new NativeAuthError(AUTH_ERROR_CODES.INVALID_INPUT);
        }
        const material = await callAuthority(env, '/internal/firebase/account-verification/material', {
          verificationTicket,
          context
        });
        let refreshed;
        let user;
        try { refreshed = await provider.refresh(material.refreshToken); } catch (cause) { throw providerError(cause, 'refresh'); }
        try { user = await provider.lookup(refreshed.idToken); } catch (cause) { throw providerError(cause, 'lookup-session'); }
        assertProviderUser(refreshed, user);
        const verified = await callAuthority(env, '/internal/verification/preauth/verify', {
          input: {
            verificationTicket,
            email: user.email,
            subject: user.subject,
            attemptId,
            code
          },
          context
        });
        if (verified?.verified !== true || verified?.telegramLinked !== true) {
          throw new NativeAuthError(AUTH_ERROR_CODES.TELEGRAM_VERIFICATION_INVALID);
        }
        const established = await callAuthority(env, '/internal/firebase/account-verification/complete', {
          input: {
            verificationTicket,
            email: user.email,
            subject: user.subject
          },
          context
        });
        return authSuccess(request, established, refreshed.refreshToken, context, {
          emailVerified: user.emailVerified === true,
          telegramVerified: true
        }, [verificationCookie('', 0)]);
      }

      if (request.method === 'POST' && url.pathname === `${AUTH_API_PREFIX}/profile/pending`) {
        const verificationTicket = jar[AUTH_VERIFICATION_COOKIE];
        if (!verificationTicket) throw new NativeAuthError(AUTH_ERROR_CODES.TELEGRAM_VERIFICATION_INVALID);
        const profile = await readJson(request);
        await callAuthority(env, '/internal/firebase/rate', { input: { operation: 'pending-profile-write' }, context });
        if (isPendingSignupTicket(verificationTicket)) return pendingSignup.savePendingSignupProfile({ request, env, context, ticket: verificationTicket, profile, deps: pendingDeps() });
        const result = await callAuthority(env, '/internal/profile/save-pending', {
          verificationTicket,
          input: profile,
          context
        });
        return json(request, 200, { ok: true, saved: result?.saved === true },
          context.isNewDevice ? { 'Set-Cookie': deviceCookie(context.deviceId) } : {});
      }

      if (request.method === 'POST' && url.pathname === `${AUTH_API_PREFIX}/profile`) {
        if (!provider.configured) throw new NativeAuthError(AUTH_ERROR_CODES.NOT_CONFIGURED);
        const profile = await readJson(request);
        const current = await firebaseReadySession({
          provider, jar, env, context, allowTelegram: telegramVerificationRequested(env, url)
        });
        await callAuthority(env, '/internal/firebase/rate', {
          input: { operation: 'profile-write', email: current.user.email }, context
        });
        const result = await callAuthority(env, '/internal/profile/save', {
          input: {
            sessionToken: current.sessionToken,
            email: current.user.email,
            subject: current.user.subject,
            profile
          },
          context
        });
        return json(request, 200, { ok: true, saved: result?.saved === true, profile: result?.profile || null }, {
          'Set-Cookie': sessionCookies(current.session, current.refreshed.refreshToken, context)
        });
      }

      // Phase 7, profile response is additive: `profile` keeps the legacy
      // shape; publicId/completion/avatar/context are new read-only fields.
      if (request.method === 'GET' && url.pathname === `${AUTH_API_PREFIX}/profile`) {
        if (!provider.configured) throw new NativeAuthError(AUTH_ERROR_CODES.NOT_CONFIGURED);
        const current = await firebaseReadySession({
          provider, jar, env, context, allowTelegram: telegramVerificationRequested(env, url)
        });
        const result = await callAuthority(env, '/internal/profile/get-v2', {
          input: {
            sessionToken: current.sessionToken,
            email: current.user.email,
            subject: current.user.subject
          },
          context
        });
        return json(request, 200, {
          ok: true,
          profile: result?.profile || null,
          publicId: result?.publicId || null,
          email: current.user.email || null,
          completion: Number(result?.completion || 0),
          avatar: result?.avatar || { present: false },
          avatarUrl: result?.avatarUrl || null,
          joinedYear: result?.joinedYear || null,
          context: result?.context || null
        }, {
          'Set-Cookie': sessionCookies(current.session, current.refreshed.refreshToken, context)
        });
      }

      if (request.method === 'POST' && url.pathname === `${AUTH_API_PREFIX}/profile/patch`) {
        if (!provider.configured) throw new NativeAuthError(AUTH_ERROR_CODES.NOT_CONFIGURED);
        const body = await readJson(request);
        const current = await firebaseReadySession({
          provider, jar, env, context, allowTelegram: telegramVerificationRequested(env, url)
        });
        await callAuthority(env, '/internal/firebase/rate', {
          input: { operation: 'profile-patch', email: current.user.email }, context
        });
        const result = await callAuthority(env, '/internal/profile/patch', {
          input: {
            sessionToken: current.sessionToken,
            email: current.user.email,
            subject: current.user.subject,
            fields: body?.fields,
            expectVersion: body?.expectVersion
          },
          context
        });
        return json(request, 200, { ok: true, saved: result?.saved === true, profile: result?.profile || null }, {
          'Set-Cookie': sessionCookies(current.session, current.refreshed.refreshToken, context)
        });
      }

      // Phase 7, avatar upload (base64 JSON; server validates MIME +
      // magic bytes + size; client filename is never trusted).
      if (request.method === 'POST' && url.pathname === `${AUTH_API_PREFIX}/profile/avatar`) {
        if (!provider.configured) throw new NativeAuthError(AUTH_ERROR_CODES.NOT_CONFIGURED);
        const body = await readJson(request, 3_500_000);
        const current = await firebaseReadySession({
          provider, jar, env, context, allowTelegram: telegramVerificationRequested(env, url)
        });
        await callAuthority(env, '/internal/firebase/rate', {
          input: { operation: 'avatar-write', email: current.user.email }, context
        });
        const result = await callAuthority(env, '/internal/avatar/save', {
          input: {
            sessionToken: current.sessionToken,
            email: current.user.email,
            subject: current.user.subject,
            data: body?.data,
            mime: body?.mime
          },
          context
        });
        return json(request, 200, { ok: true, saved: result?.saved === true }, {
          'Set-Cookie': sessionCookies(current.session, current.refreshed.refreshToken, context)
        });
      }

      if (request.method === 'DELETE' && url.pathname === `${AUTH_API_PREFIX}/profile/avatar`) {
        if (!provider.configured) throw new NativeAuthError(AUTH_ERROR_CODES.NOT_CONFIGURED);
        const current = await firebaseReadySession({
          provider, jar, env, context, allowTelegram: telegramVerificationRequested(env, url)
        });
        await callAuthority(env, '/internal/firebase/rate', {
          input: { operation: 'avatar-write', email: current.user.email }, context
        });
        const result = await callAuthority(env, '/internal/avatar/delete', {
          input: {
            sessionToken: current.sessionToken,
            email: current.user.email,
            subject: current.user.subject
          },
          context
        });
        return json(request, 200, { ok: true, deleted: result?.deleted === true }, {
          'Set-Cookie': sessionCookies(current.session, current.refreshed.refreshToken, context)
        });
      }

      if (request.method === 'GET' && url.pathname === `${AUTH_API_PREFIX}/profile/avatar`) {
        if (!provider.configured) throw new NativeAuthError(AUTH_ERROR_CODES.NOT_CONFIGURED);
        const current = await firebaseReadySession({
          provider, jar, env, context, allowTelegram: telegramVerificationRequested(env, url)
        });
        const result = await callAuthority(env, '/internal/avatar/get', {
          input: {
            sessionToken: current.sessionToken,
            email: current.user.email,
            subject: current.user.subject
          },
          context
        });
        if (!result?.present) return json(request, 404, { ok: false, error: { code: 'AVATAR_NOT_FOUND' } });
        const bytes = Uint8Array.from(atob(result.data), char => char.charCodeAt(0));
        // Stable, version-scoped URL: let the browser cache and revalidate it.
        // The old `no-store` (plus a `?ts=Date.now()` in the client) forced a
        // full re-download on every render, the repeated loading the owner saw.
        const etag = `"av-${result.updatedAt || result.bytes || 0}"`;
        if (request.headers.get('If-None-Match') === etag) {
          return new Response(null, { status: 304, headers: new Headers({ 'ETag': etag, 'Cache-Control': 'private, max-age=300, must-revalidate', ...corsHeaders(request) }) });
        }
        return new Response(bytes, {
          status: 200,
          headers: new Headers({
            'Content-Type': result.mime,
            'Content-Length': String(bytes.byteLength),
            'ETag': etag,
            'Cache-Control': 'private, max-age=300, must-revalidate',
            ...corsHeaders(request)
          })
        });
      }

      // Phase 7, public-safe profile projection (unauthenticated,
      // rate-limited). Private profiles never surface.
      if (request.method === 'GET' && url.pathname.startsWith(PUBLIC_PROFILE_PREFIX)) {
        const suffix = decodeURIComponent(url.pathname.slice(PUBLIC_PROFILE_PREFIX.length));
        const isAvatar = suffix.endsWith('/avatar');
        const publicId = isAvatar ? suffix.slice(0, -'/avatar'.length) : suffix;
        await callAuthority(env, '/internal/firebase/rate', {
          input: { operation: 'public-profile-read' }, context
        });
        if (isAvatar) {
          const result = await callAuthority(env, '/internal/public-profile/avatar', {
            input: { publicId }
          });
          if (!result?.present) return json(request, 404, { ok: false, error: { code: 'AVATAR_NOT_FOUND' } });
          const bytes = Uint8Array.from(atob(result.data), char => char.charCodeAt(0));
          return new Response(bytes, {
            status: 200,
            headers: new Headers({
              'Content-Type': result.mime,
              'Content-Length': String(bytes.byteLength),
              'Cache-Control': 'public, max-age=3600',
              'Cross-Origin-Resource-Policy': 'cross-site',
              ...corsHeaders(request)
            })
          });
        }
        const result = await callAuthority(env, '/internal/public-profile/get', {
          input: { publicId }
        });
        return json(request, 200, { ok: true, profile: result?.profile || null });
      }
      if (request.method === 'GET' && url.pathname === `${AUTH_API_PREFIX}/account`) {
        if (!provider.configured) throw new NativeAuthError(AUTH_ERROR_CODES.NOT_CONFIGURED);
        const current = await firebaseReadySession({
          provider, jar, env, context, allowTelegram: telegramVerificationRequested(env, url)
        });
        const result = await callAuthority(env, '/internal/account/state', {
          sessionToken: current.sessionToken,
          input: { email: current.user.email, subject: current.user.subject },
          context
        });
        return json(request, 200, { ok: true, account: result?.account || null }, {
          'Set-Cookie': sessionCookies(current.session, current.refreshed.refreshToken, context)
        });
      }
      if (request.method === 'GET' && url.pathname === `${AUTH_API_PREFIX}/identities`) {
        if (!provider.configured) throw new NativeAuthError(AUTH_ERROR_CODES.NOT_CONFIGURED);
        const current = await firebaseReadySession({
          provider, jar, env, context, allowTelegram: telegramVerificationRequested(env, url)
        });
        const result = await callAuthority(env, '/internal/account/identities', {
          sessionToken: current.sessionToken,
          input: { email: current.user.email, subject: current.user.subject },
          context
        });
        return json(request, 200, { ok: true, identities: result?.identities || [] }, {
          'Set-Cookie': sessionCookies(current.session, current.refreshed.refreshToken, context)
        });
      }
      if (request.method === 'GET' && url.pathname === `${AUTH_API_PREFIX}/admin/identity/health`) {
        if (!adminAuthorized(request, env)) return json(request, 403, { ok: false, error: { code: 'FORBIDDEN', message: 'অনুমতি নেই।' } });
        const result = await callAuthority(env, '/internal/identity/health', {});
        return json(request, 200, { ok: true, health: result?.health || null });
      }
      if (request.method === 'POST' && url.pathname === `${AUTH_API_PREFIX}/admin/account/state`) {
        if (!adminAuthorized(request, env)) return json(request, 403, { ok: false, error: { code: 'FORBIDDEN', message: 'অনুমতি নেই।' } });
        const body = await readJson(request);
        const result = await callAuthority(env, '/internal/account/state/set', {
          userId: String(body?.userId || '').slice(0, 256),
          status: String(body?.status || '')
        });
        return json(request, 200, { ok: true, account: result?.account || null });
      }

      if (request.method === 'POST' && url.pathname === `${AUTH_API_PREFIX}/passkey/registration/begin`) {
        if (!provider.configured || !passkeyEndpointReady(env)) throw new NativeAuthError(AUTH_ERROR_CODES.PASSKEY_UNAVAILABLE);
        const current = await firebaseReadySession({ provider, jar, env, context, allowTelegram: telegramVerificationRequested(env, url) });
        const result = await callAuthority(env, '/internal/passkey/registration/begin', {
          input: {
            sessionToken: current.sessionToken,
            refreshToken: current.refreshed.refreshToken,
            email: current.user.email,
            subject: current.user.subject
          },
          context
        });
        return json(request, 200, { ok: true, ...result }, {
          'Set-Cookie': sessionCookies(current.session, current.refreshed.refreshToken, context)
        });
      }

      if (request.method === 'POST' && url.pathname === `${AUTH_API_PREFIX}/passkey/registration/finish`) {
        if (!provider.configured || !passkeyEndpointReady(env)) throw new NativeAuthError(AUTH_ERROR_CODES.PASSKEY_UNAVAILABLE);
        const body = await readJson(request);
        const current = await firebaseReadySession({ provider, jar, env, context, allowTelegram: telegramVerificationRequested(env, url) });
        const result = await callAuthority(env, '/internal/passkey/registration/finish', {
          input: {
            challengeId: body.challengeId,
            response: body.response,
            sessionToken: current.sessionToken,
            refreshToken: current.refreshed.refreshToken,
            email: current.user.email,
            subject: current.user.subject
          },
          context
        });
        return json(request, 200, { ok: true, ...result }, {
          'Set-Cookie': sessionCookies(current.session, current.refreshed.refreshToken, context)
        });
      }

      if (request.method === 'POST' && url.pathname === `${AUTH_API_PREFIX}/passkey/authentication/begin`) {
        if (!provider.configured || !passkeyEndpointReady(env)) throw new NativeAuthError(AUTH_ERROR_CODES.PASSKEY_UNAVAILABLE);
        const result = await callAuthority(env, '/internal/passkey/authentication/begin', { context });
        return json(request, 200, { ok: true, ...result }, context.isNewDevice ? { 'Set-Cookie': deviceCookie(context.deviceId) } : {});
      }

      if (request.method === 'POST' && url.pathname === `${AUTH_API_PREFIX}/passkey/authentication/finish`) {
        if (!provider.configured || !passkeyEndpointReady(env)) throw new NativeAuthError(AUTH_ERROR_CODES.PASSKEY_UNAVAILABLE);
        const body = await readJson(request);
        const assertion = await callAuthority(env, '/internal/passkey/authentication/finish', {
          input: { challengeId: body.challengeId, response: body.response },
          context
        });
        let refreshed;
        let user;
        try { refreshed = await provider.refresh(assertion.refreshToken); } catch (cause) { throw providerError(cause, 'passkey-refresh'); }
        try { user = await provider.lookup(refreshed.idToken); } catch (cause) { throw providerError(cause, 'lookup-session'); }
        assertProviderUser(refreshed, user);
        const passkeyTelegramVerified = !user.emailVerified && await telegramVerificationStatus({
          env,
          user,
          context,
          allowed: telegramVerificationRequested(env, url)
        });
        if (!user.emailVerified && !passkeyTelegramVerified) throw new NativeAuthError(AUTH_ERROR_CODES.EMAIL_NOT_VERIFIED);
        const established = await callAuthority(env, '/internal/passkey/session/complete', {
          input: {
            loginTicket: assertion.loginTicket,
            refreshToken: refreshed.refreshToken,
            email: user.email,
            subject: user.subject
          },
          context
        });
        return authSuccess(request, established, refreshed.refreshToken, context, {
          emailVerified: user.emailVerified === true,
          telegramVerified: passkeyTelegramVerified
        });
      }

      if (request.method === 'GET' && url.pathname === `${AUTH_API_PREFIX}/passkey/status`) {
        if (!provider.configured || !passkeyEndpointReady(env)) throw new NativeAuthError(AUTH_ERROR_CODES.PASSKEY_UNAVAILABLE);
        const current = await firebaseReadySession({ provider, jar, env, context, allowTelegram: telegramVerificationRequested(env, url) });
        const result = await callAuthority(env, '/internal/passkey/status', {
          input: { sessionToken: current.sessionToken, email: current.user.email, subject: current.user.subject },
          context
        });
        return json(request, 200, { ok: true, ...result }, {
          'Set-Cookie': sessionCookies(current.session, current.refreshed.refreshToken, context)
        });
      }

      if (request.method === 'POST' && url.pathname === `${AUTH_API_PREFIX}/passkey/remove`) {
        if (!provider.configured || !passkeyEndpointReady(env)) throw new NativeAuthError(AUTH_ERROR_CODES.PASSKEY_UNAVAILABLE);
        const body = await readJson(request);
        const current = await firebaseReadySession({ provider, jar, env, context, allowTelegram: telegramVerificationRequested(env, url) });
        const result = await callAuthority(env, '/internal/passkey/remove', {
          input: {
            credentialId: body.credentialId,
            sessionToken: current.sessionToken,
            email: current.user.email,
            subject: current.user.subject
          },
          context
        });
        return json(request, 200, { ok: true, ...result }, {
          'Set-Cookie': sessionCookies(current.session, current.refreshed.refreshToken, context)
        });
      }

      if (request.method === 'POST' && url.pathname === `${AUTH_API_PREFIX}/backup/request`) {
        if (!provider.configured || !(verificationPublished(env) || telegramCanaryRequested(env, url))) {
          throw new NativeAuthError(AUTH_ERROR_CODES.BACKUP_UNAVAILABLE);
        }
        const body = await readJson(request);
        // A1.5 / AU-SEC-01 L4: human check before any send.
        await verifyTurnstile({ env, token: body?.turnstileToken, ip: context.ip, fetchImpl });
        const contact = String(body.contact || '').trim();
        if (contact && !/^\+[1-9]\d{7,14}$/.test(contact)) throw new NativeAuthError(AUTH_ERROR_CODES.INVALID_INPUT);
        const current = await firebaseReadySession({ provider, jar, env, context, allowTelegram: telegramVerificationRequested(env, url) });
        const recipientName = await verifiedRecipientName(env, context, current);
        const result = await callAuthority(env, '/internal/verification/request', {
          input: {
            sessionToken: current.sessionToken,
            email: current.user.email,
            subject: current.user.subject,
            recipientName,
            purpose: body.purpose === 'sensitive-action' ? 'sensitive-action' : 'account-backup',
            contact,
            allowTelegramLink: true
          },
          context
        });
        return json(request, 202, { ok: true, ...result }, {
          'Set-Cookie': sessionCookies(current.session, current.refreshed.refreshToken, context)
        });
      }

      if (request.method === 'POST' && url.pathname === `${AUTH_API_PREFIX}/backup/verify`) {
        if (!provider.configured || !(verificationPublished(env) || telegramCanaryRequested(env, url))) {
          throw new NativeAuthError(AUTH_ERROR_CODES.BACKUP_UNAVAILABLE);
        }
        const body = await readJson(request);
        const current = await firebaseReadySession({ provider, jar, env, context, allowTelegram: telegramVerificationRequested(env, url) });
        const result = await callAuthority(env, '/internal/verification/verify', {
          input: {
            sessionToken: current.sessionToken,
            email: current.user.email,
            subject: current.user.subject,
            purpose: body.purpose === 'sensitive-action' ? 'sensitive-action' : 'account-backup',
            attemptId: body.attemptId,
            code: body.code,
            evidence: body.evidence
          },
          context
        });
        return json(request, 200, { ok: true, ...result }, {
          'Set-Cookie': sessionCookies(current.session, current.refreshed.refreshToken, context)
        });
      }

      if (request.method === 'GET' && url.pathname === `${AUTH_API_PREFIX}/admin/verification/status`) {
        if (!adminAuthorized(request, env)) return json(request, 403, { ok: false, error: { code: 'FORBIDDEN', message: 'অনুমতি নেই।' } });
        const result = await callAuthority(env, '/internal/verification/admin/status', {});
        return json(request, 200, { ok: true, ...result });
      }

      if (request.method === 'POST' && url.pathname === `${AUTH_API_PREFIX}/admin/verification/config`) {
        if (!adminAuthorized(request, env)) return json(request, 403, { ok: false, error: { code: 'FORBIDDEN', message: 'অনুমতি নেই।' } });
        const body = await readJson(request);
        // Allow-listed raw config: the orchestrator normalizes it after keeping the
        // values the panel does not send (timeoutMs, allowedDomains).
        const result = await callAuthority(env, '/internal/verification/admin/config', { config: adminVerificationConfigInput(body.config) });
        publicConfigCache.delete(env);
        return json(request, 200, { ok: true, ...result });
      }

      if (request.method === 'GET' && url.pathname === `${AUTH_API_PREFIX}/session`) {
        // Explicit session bootstrap: the single tracked refresh/revalidation
        // path (telemetry: 'session-refreshed'). No extra DO round-trip.
        const current = await firebaseReadySession({ provider, jar, env, context, allowTelegram: telegramVerificationRequested(env, url), trackRefresh: true });
        const maxAge = Math.max(1, Math.min(SESSION_SECONDS, Math.floor((Number(current.session.expiresAt) - Date.now()) / 1000)));
        return json(request, 200, {
          ok: true,
          authenticated: true,
          accountVerified: true,
          emailVerified: current.user.emailVerified === true,
          telegramVerified: current.telegramVerified === true,
          ...current.session
        }, {
          'Set-Cookie': [firebaseCookie(current.refreshed.refreshToken, maxAge), ...(context.isNewDevice ? [deviceCookie(context.deviceId)] : [])]
        });
      }

      if (request.method === 'POST' && url.pathname === `${AUTH_API_PREFIX}/session/logout`) {
        const sessionToken = jar[AUTH_SESSION_COOKIE];
        if (sessionToken) await callAuthority(env, '/internal/session/revoke', { sessionToken });
        return json(request, 200, { ok: true, authenticated: false }, { 'Set-Cookie': clearAuthCookies() });
      }
      if (request.method === 'POST' && url.pathname === `${AUTH_API_PREFIX}/session/logout-all`) {
        // Phase 5 §12: revoke every session for the current user on every
        // device. Phase 6 §12: step-up gated, a verified step-up challenge
        // (stepUpToken) is required once the session is no longer recent or
        // current risk reaches ELEVATED. A STEP_UP_REQUIRED error keeps the
        // session alive so the client can run the challenge and retry.
        const body = await readJson(request);
        const current = await firebaseReadySession({ provider, jar, env, context, allowTelegram: telegramVerificationRequested(env, url) });
        const result = await callAuthority(env, '/internal/session/revoke-all', {
          sessionToken: current.sessionToken,
          input: { email: current.user.email, subject: current.user.subject, stepUpToken: String(body?.stepUpToken || '') },
          context
        });
        return json(request, 200, { ok: true, authenticated: false, revoked: Number(result?.revoked || 0) }, { 'Set-Cookie': clearAuthCookies() });
      }

      // Phase 6, purpose-bound security challenges (§11-§12). Session
      // required; codes are delivered by the existing verification pipeline
      // (email/Telegram). A verified challenge returns a one-time
      // stepUpToken bound to this user+device.
      if (request.method === 'POST' && url.pathname === `${AUTH_API_PREFIX}/security/challenge/request`) {
        const body = await readJson(request);
        const current = await firebaseReadySession({ provider, jar, env, context, allowTelegram: telegramVerificationRequested(env, url) });
        const result = await callAuthority(env, '/internal/security/challenge/request', {
          input: {
            sessionToken: current.sessionToken,
            email: current.user.email,
            subject: current.user.subject,
            purpose: String(body?.purpose || ''),
            method: String(body?.method || 'email')
          },
          context
        });
        return json(request, 200, { ok: true, ...result }, {
          'Set-Cookie': sessionCookies(current.session, current.refreshed.refreshToken, context)
        });
      }
      if (request.method === 'POST' && url.pathname === `${AUTH_API_PREFIX}/security/challenge/verify`) {
        const body = await readJson(request);
        const current = await firebaseReadySession({ provider, jar, env, context, allowTelegram: telegramVerificationRequested(env, url) });
        const result = await callAuthority(env, '/internal/security/challenge/verify', {
          input: {
            sessionToken: current.sessionToken,
            email: current.user.email,
            subject: current.user.subject,
            challengeRef: String(body?.challengeRef || ''),
            purpose: String(body?.purpose || ''),
            code: String(body?.code || '')
          },
          context
        });
        return json(request, 200, { ok: true, ...result }, {
          'Set-Cookie': sessionCookies(current.session, current.refreshed.refreshToken, context)
        });
      }
      if (request.method === 'POST' && url.pathname === `${AUTH_API_PREFIX}/security/challenge/cancel`) {
        const body = await readJson(request);
        const current = await firebaseReadySession({ provider, jar, env, context, allowTelegram: telegramVerificationRequested(env, url) });
        const result = await callAuthority(env, '/internal/security/challenge/cancel', {
          input: {
            sessionToken: current.sessionToken,
            email: current.user.email,
            subject: current.user.subject,
            challengeRef: String(body?.challengeRef || ''),
            purpose: String(body?.purpose || '')
          },
          context
        });
        return json(request, 200, { ok: true, ...result }, {
          'Set-Cookie': sessionCookies(current.session, current.refreshed.refreshToken, context)
        });
      }
      // Phase 6, explicit "trust this device" (the 30-day consent).
      if (request.method === 'POST' && url.pathname === `${AUTH_API_PREFIX}/security/device/trust`) {
        await readJson(request);
        const current = await firebaseReadySession({ provider, jar, env, context, allowTelegram: telegramVerificationRequested(env, url) });
        const result = await callAuthority(env, '/internal/security/device/trust', {
          input: { sessionToken: current.sessionToken, email: current.user.email, subject: current.user.subject },
          context
        });
        return json(request, 200, { ok: true, ...result }, {
          'Set-Cookie': sessionCookies(current.session, current.refreshed.refreshToken, context)
        });
      }
      // Phase 6 Chunk 4, signed-in security state (device list, trust, status).
      if (request.method === 'GET' && url.pathname === `${AUTH_API_PREFIX}/security/state`) {
        const current = await firebaseReadySession({ provider, jar, env, context, allowTelegram: telegramVerificationRequested(env, url) });
        const result = await callAuthority(env, '/internal/security/state', {
          input: { sessionToken: current.sessionToken, email: current.user.email, subject: current.user.subject },
          context
        });
        return json(request, 200, { ok: true, ...result }, {
          'Set-Cookie': sessionCookies(current.session, current.refreshed.refreshToken, context)
        });
      }
      // Phase 6 Chunk 4, recent login history (privacy boundary: method,
      // coarse browser class and time only; no IP, no location, ever).
      if (request.method === 'GET' && url.pathname === `${AUTH_API_PREFIX}/security/history`) {
        const current = await firebaseReadySession({ provider, jar, env, context, allowTelegram: telegramVerificationRequested(env, url) });
        const result = await callAuthority(env, '/internal/security/history', {
          input: { sessionToken: current.sessionToken, email: current.user.email, subject: current.user.subject },
          context
        });
        return json(request, 200, { ok: true, ...result }, {
          'Set-Cookie': sessionCookies(current.session, current.refreshed.refreshToken, context)
        });
      }
      // Phase 6 Chunk 4, step-up-gated trusted-device revocation.
      if (request.method === 'POST' && url.pathname === `${AUTH_API_PREFIX}/security/devices/revoke`) {
        const body = await readJson(request);
        const current = await firebaseReadySession({ provider, jar, env, context, allowTelegram: telegramVerificationRequested(env, url) });
        const result = await callAuthority(env, '/internal/security/device/revoke', {
          input: {
            sessionToken: current.sessionToken,
            email: current.user.email,
            subject: current.user.subject,
            scope: String(body?.scope || 'current'),
            deviceRef: String(body?.deviceRef || ''),
            stepUpToken: String(body?.stepUpToken || '')
          },
          context
        });
        return json(request, 200, { ok: true, ...result }, {
          'Set-Cookie': sessionCookies(current.session, current.refreshed.refreshToken, context)
        });
      }
      // Phase 6 Chunk 4, admin security surface (token-gated, refs only).
      if (request.method === 'GET' && url.pathname === `${AUTH_API_PREFIX}/admin/security/health`) {
        if (!adminAuthorized(request, env)) return json(request, 403, { ok: false, error: { code: 'FORBIDDEN', message: 'অনুমতি নেই।' } });
        const result = await callAuthority(env, '/internal/admin/security/health', {});
        return json(request, 200, { ok: true, result });
      }
      // Fresh Start phase 3, Control Center Students (read-only, admin token).
      if (request.method === 'GET' && url.pathname === `${AUTH_API_PREFIX}/admin/students`) {
        if (!adminAuthorized(request, env)) return json(request, 403, { ok: false, error: { code: 'FORBIDDEN', message: 'অনুমতি নেই।' } });
        const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 50, 1), 100);
        const before = url.searchParams.get('before') ? Number(url.searchParams.get('before')) : null;
        const q = String(url.searchParams.get('q') || '').slice(0, 254);
        const result = await callAuthority(env, '/internal/admin/students/list', { input: { limit, before, q } });
        return json(request, 200, { ok: true, ...result }, { 'X-Robots-Tag': 'noindex, nofollow' });
      }
      if (request.method === 'GET' && url.pathname === `${AUTH_API_PREFIX}/admin/students/profile`) {
        if (!adminAuthorized(request, env)) return json(request, 403, { ok: false, error: { code: 'FORBIDDEN', message: 'অনুমতি নেই।' } });
        const userId = String(url.searchParams.get('id') || '').slice(0, 128);
        const result = await callAuthority(env, '/internal/admin/students/get', { input: { userId } });
        return json(request, result?.found ? 200 : 404, { ok: Boolean(result?.found), ...result }, { 'X-Robots-Tag': 'noindex, nofollow' });
      }
      // Fresh Start phase 4, wipe all users (admin token + allowed Origin).
      // { dryRun: true } (default) returns counts; { dryRun: false, confirm:
      // 'WIPE-ALL-<users>' } deletes. OTP config/quota tables are kept.
      if (request.method === 'POST' && url.pathname === `${AUTH_API_PREFIX}/admin/students/wipe`) {
        if (!adminAuthorized(request, env)) return json(request, 403, { ok: false, error: { code: 'FORBIDDEN', message: 'অনুমতি নেই।' } });
        const body = await readJson(request);
        const input = body?.dryRun === false
          ? { dryRun: false, confirm: String(body?.confirm || '').slice(0, 64) }
          : { dryRun: true };
        const result = await callAuthority(env, '/internal/admin/students/wipe', { input });
        return json(request, 200, { ok: true, ...result }, { 'X-Robots-Tag': 'noindex, nofollow' });
      }
      if (request.method === 'GET' && url.pathname === `${AUTH_API_PREFIX}/admin/security/events`) {
        if (!adminAuthorized(request, env)) return json(request, 403, { ok: false, error: { code: 'FORBIDDEN', message: 'অনুমতি নেই।' } });
        const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 50, 1), 200);
        const before = url.searchParams.get('before') ? Number(url.searchParams.get('before')) : null;
        const result = await callAuthority(env, '/internal/admin/security/events', { input: { limit, before } });
        return json(request, 200, { ok: true, ...result });
      }

      return json(request, 404, { ok: false, error: { code: 'NOT_FOUND', message: 'Endpoint পাওয়া যায়নি।' } });
    } catch (cause) {
      const error = asNativeAuthError(cause);
      const clearSession = Boolean(jar[AUTH_SESSION_COOKIE])
        && [AUTH_ERROR_CODES.SESSION_INVALID, AUTH_ERROR_CODES.EMAIL_NOT_VERIFIED, AUTH_ERROR_CODES.ACCOUNT_DISABLED].includes(error.code);
      if (clearSession && jar[AUTH_SESSION_COOKIE]) {
        try { await callAuthority(env, '/internal/session/revoke', { sessionToken: jar[AUTH_SESSION_COOKIE] }); } catch {}
      }
      const providerDiagnosticCode = /^[A-Z0-9_]{1,80}$/.test(String(error.providerDiagnostic || '')) ? String(error.providerDiagnostic) : '';
      return json(request, error.status, { ok: false, error: error.toPublic() }, {
        ...(error.retryAfter ? { 'Retry-After': String(error.retryAfter) } : {}),
        ...(providerDiagnosticCode ? { 'X-AH-Auth-Diagnostic': providerDiagnosticCode } : {}),
        ...(googleRequest ? { 'X-AH-Auth-Stage': authStage } : {}),
        ...(clearSession ? { 'Set-Cookie': clearAuthCookies() } : {})
      });
    }
  };
}

export const __publicAuthTest = Object.freeze({
  allowedOrigin,
  providerError,
  googleEndpointReady,
  googlePublished,
  googleCanaryRequested,
  verificationEndpointReady,
  verificationPublished,
  telegramCanaryRequested,
  telegramActivationAuthorized,
  adminAuthorized,
  passkeyEndpointReady,
  passkeyPublished
});
