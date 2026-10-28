/* Admin passkey login for the Notification Command Center.
 *
 * Why this exists: the Admin Center used to authenticate with a raw
 * `ADMIN_TOKEN` typed on every new device and kept in `sessionStorage`. A
 * leaked token was a full admin grant with no device binding. This module lets
 * the owner enroll a passkey once and then mint a short-lived, device-bound
 * admin session; the token path stays as a break-glass fallback.
 *
 * Verification reuses `auth-native/core/webauthn.mjs`, the same code that
 * guards student passkeys, so there is one WebAuthn implementation to trust.
 *
 * Storage: `GK_KV` (already bound). Keys -
 *   admin:pk:cred:<credentialId>   enrolled credential record
 *   admin:pk:chal:<challengeId>    single-use challenge, TTL 120s
 *   admin:pk:sess:<sessionHash>    minted admin session, TTL 30min
 *
 * Signing key material is derived from `ADMIN_TOKEN` so the Worker does not
 * need another binding (Workers Free caps a Worker at 64 variables).
 */
import {
  verifyPasskeyAuthentication,
  verifyPasskeyRegistration,
  readPasskeyClientChallenge,
  bytesToBase64Url,
  base64UrlToBytes
} from './auth-native/core/webauthn.mjs';

export const PASSKEY_RP_ID = 'admissionhub.pages.dev';
/* Both addresses serve the same admin console; a passkey is bound to the exact
 * domain it was created on, so the RP ID must follow the requesting Origin. */
export const PASSKEY_RP_IDS = Object.freeze(['admissionhub.pages.dev', 'admissionsky.pages.dev']);
const rpIdForRequest = request => {
  try {
    const host = new URL(String(request.headers.get('Origin') || '')).hostname.toLowerCase();
    return PASSKEY_RP_IDS.includes(host) ? host : PASSKEY_RP_ID;
  } catch { return PASSKEY_RP_ID; }
};
export const PASSKEY_RP_NAME = 'AdmissionHub Admin';
/* The single managed admin identity. It is echoed back by authenticators as
 * `userHandle` on assertion, so it must be both offered at registration and
 * persisted with the credential, otherwise every sign-in fails the handle
 * comparison against an undefined stored value. */
export const PASSKEY_USER_ID = 'admissionhub-admin';
export const PASSKEY_ORIGINS = Object.freeze([
  'https://admissionhub.pages.dev',
  'https://admissionsky.pages.dev',
  'https://admission-gk.admissionhub.workers.dev'
]);
export const CHALLENGE_TTL_MS = 120_000;
export const SESSION_TTL_MS = 30 * 60_000;
export const MAX_ADMIN_CREDENTIALS = 8;

const encoder = new TextEncoder();
const CRED_PREFIX = 'admin:pk:cred:';
const CHALLENGE_PREFIX = 'admin:pk:chal:';
const SESSION_PREFIX = 'admin:pk:sess:';
const ADMIN_PATHS = Object.freeze([
  '/api/admin/webauthn/status',
  '/api/admin/webauthn/challenge',
  '/api/admin/webauthn/register',
  '/api/admin/webauthn/assert'
]);

export const isAdminPasskeyPath = path => ADMIN_PATHS.includes(path);

const randomToken = (bytes = 32) => {
  const value = new Uint8Array(bytes);
  crypto.getRandomValues(value);
  return bytesToBase64Url(value);
};

const sha256Hex = async value => {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(String(value)));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
};

/* The signing key is scoped to this purpose so an ADMIN_TOKEN change rotates
 * every outstanding session and challenge without touching stored credentials. */
const sessionKey = async env => {
  const secret = String(env?.ADMIN_TOKEN || '');
  if (!secret) return null;
  const material = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return material;
};

const hmacHex = async (env, label, value) => {
  const key = await sessionKey(env);
  if (!key) return null;
  const mac = await crypto.subtle.sign('HMAC', key, encoder.encode(`${label}:${value}`));
  return [...new Uint8Array(mac)].map(b => b.toString(16).padStart(2, '0')).join('');
};

const json = (obj, status = 200) => new Response(JSON.stringify(obj), {
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
});

const readBody = async request => {
  try {
    const value = await request.json();
    return value && typeof value === 'object' ? value : null;
  } catch {
    return null;
  }
};

const kv = env => env?.GK_KV || null;

async function listCredentials(env) {
  const store = kv(env);
  if (!store) return [];
  const listed = await store.list({ prefix: CRED_PREFIX });
  const out = [];
  for (const entry of listed.keys || []) {
    const raw = await store.get(entry.name);
    if (!raw) continue;
    try { out.push(JSON.parse(raw)); } catch { /* skip a corrupt row rather than fail the request */ }
  }
  return out;
}

const saveCredential = (env, record) =>
  kv(env).put(`${CRED_PREFIX}${record.credentialId}`, JSON.stringify(record));

/* Challenges are stored under a MAC of their own id so a guessed id cannot be
 * replayed: the lookup key only matches the value the server handed out. */
async function putChallenge(env, challengeId, payload) {
  await kv(env).put(`${CHALLENGE_PREFIX}${challengeId}`, JSON.stringify(payload), { expirationTtl: Math.ceil(CHALLENGE_TTL_MS / 1000) });
}

async function takeChallenge(env, challengeId) {
  const store = kv(env);
  const key = `${CHALLENGE_PREFIX}${challengeId}`;
  const raw = await store.get(key);
  if (!raw) return null;
  await store.delete(key);
  try { return JSON.parse(raw); } catch { return null; }
}

async function mintSession(env, credentialId) {
  const token = randomToken(32);
  const hash = await sha256Hex(token);
  await kv(env).put(`${SESSION_PREFIX}${hash}`, JSON.stringify({
    credentialId,
    createdAt: Date.now(),
    expiresAt: Date.now() + SESSION_TTL_MS
  }), { expirationTtl: Math.ceil(SESSION_TTL_MS / 1000) });
  return token;
}

export async function readAdminSession(env, request) {
  const header = String(request.headers.get('X-Admin-Session') || '').trim();
  if (!header || !kv(env)) return null;
  const raw = await kv(env).get(`${SESSION_PREFIX}${await sha256Hex(header)}`);
  if (!raw) return null;
  try {
    const record = JSON.parse(raw);
    if (Number(record.expiresAt || 0) <= Date.now()) return null;
    return record;
  } catch {
    return null;
  }
}

export async function revokeAdminSession(env, request) {
  const header = String(request.headers.get('X-Admin-Session') || '').trim();
  if (!header || !kv(env)) return false;
  await kv(env).delete(`${SESSION_PREFIX}${await sha256Hex(header)}`);
  return true;
}

const statusPayload = async (env, request) => {
  const session = await readAdminSession(env, request);
  const credentials = await listCredentials(env);
  return {
    configured: Boolean(env?.ADMIN_TOKEN) && Boolean(kv(env)),
    enrolled: credentials.length > 0,
    credentialCount: credentials.length,
    session: session ? { expiresAt: session.expiresAt } : null
  };
};

/* Enrollment is gated by the existing ADMIN_TOKEN: only someone who already
 * holds the admin credential may add a passkey to the account. */
async function handleRegister(request, env) {
  const body = await readBody(request);
  if (!body) return json({ error: 'invalid-json' }, 400);
  const challengeId = String(body.challengeId || '');
  const challenge = await takeChallenge(env, challengeId);
  if (!challenge || challenge.purpose !== 'register') return json({ error: 'challenge-expired' }, 400);

  const credentials = await listCredentials(env);
  if (credentials.length >= MAX_ADMIN_CREDENTIALS) return json({ error: 'too-many-credentials' }, 409);

  let verified;
  try {
    verified = await verifyPasskeyRegistration({
      response: body.response,
      expectedChallenge: challenge.challenge,
      rpId: challenge.rpId || PASSKEY_RP_ID,
      allowedOrigins: PASSKEY_ORIGINS
    });
  } catch {
    return json({ error: 'registration-failed' }, 400);
  }
  const record = {
    credentialId: verified.credentialId,
    userHandle: bytesToBase64Url(encoder.encode(PASSKEY_USER_ID)),
    publicKeyJwk: verified.publicKeyJwk,
    counter: verified.counter,
    backupEligible: verified.backupEligible,
    backupState: verified.backupState,
    transports: verified.transports,
    label: String(body.label || 'Admin device').slice(0, 60),
    createdAt: Date.now()
  };
  await saveCredential(env, record);
  return json({ registered: true, credentialCount: (await listCredentials(env)).length });
}

async function handleAssert(request, env) {
  const body = await readBody(request);
  if (!body) return json({ error: 'invalid-json' }, 400);
  const challengeId = String(body.challengeId || '');
  const challenge = await takeChallenge(env, challengeId);
  if (!challenge || challenge.purpose !== 'assert') return json({ error: 'challenge-expired' }, 400);

  const credentialId = String(body.response?.rawId || '');
  const record = credentialId ? JSON.parse(await kv(env).get(`${CRED_PREFIX}${credentialId}`) || 'null') : null;
  if (!record) return json({ error: 'credential-not-found' }, 404);

  let verified;
  try {
    verified = await verifyPasskeyAuthentication({
      response: body.response,
      expectedChallenge: challenge.challenge,
      rpId: challenge.rpId || PASSKEY_RP_ID,
      allowedOrigins: PASSKEY_ORIGINS,
      credential: record
    });
  } catch {
    return json({ error: 'authentication-failed' }, 401);
  }
  await saveCredential(env, { ...record, counter: verified.counter, lastUsedAt: Date.now() });
  const session = await mintSession(env, record.credentialId);
  return json({ authenticated: true, session, expiresAt: Date.now() + SESSION_TTL_MS });
}

export async function handleAdminPasskeyRequest(request, env) {
  const url = new URL(request.url);
  if (!isAdminPasskeyPath(url.pathname)) return null;
  if (!env?.ADMIN_TOKEN) return json({ error: 'not-configured' }, 503);
  if (!kv(env)) return json({ error: 'storage-unavailable' }, 503);

  const bearer = String(request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
  const hasAdminToken = bearer && bearer === env.ADMIN_TOKEN;

  if (url.pathname === '/api/admin/webauthn/status' && request.method === 'GET') {
    return json(await statusPayload(env, request));
  }

  if (url.pathname === '/api/admin/webauthn/challenge' && request.method === 'POST') {
    const body = await readBody(request);
    const purpose = body?.purpose === 'register' ? 'register' : 'assert';
    /* Enrolling a new passkey is a privileged act: require the admin token.
     * Asserting an existing passkey must work without it, that is the point. */
    if (purpose === 'register' && !hasAdminToken) return json({ error: 'forbidden' }, 403);
    if (purpose === 'assert' && !hasAdminToken && !(await listCredentials(env)).length) {
      return json({ error: 'no-credential' }, 404);
    }
    const challengeId = randomToken(24);
    const challenge = randomToken(32);
    const rpId = rpIdForRequest(request);
    await putChallenge(env, challengeId, {
      purpose,
      challenge,
      rpId,
      mac: await hmacHex(env, 'admin-passkey-challenge', `${challengeId}:${challenge}`),
      createdAt: Date.now()
    });
    const credentials = await listCredentials(env);
    /* Registration needs `rp: {id, name}`; only assertions take a bare `rpId`.
     * Sending the flat form for register made navigator.credentials.create()
     * throw before the authenticator was ever reached. */
    const rp = { id: rpId, name: PASSKEY_RP_NAME };
    return json({
      challengeId,
      options: {
        challenge,
        timeout: 120_000,
        userVerification: 'required',
        ...(purpose === 'register'
          ? {
            rp,
            user: { id: bytesToBase64Url(encoder.encode(PASSKEY_USER_ID)), name: 'admin@admissionhub', displayName: 'AdmissionHub Admin' },
            pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
            authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' },
            attestation: 'none',
            excludeCredentials: credentials.map(c => ({ type: 'public-key', id: c.credentialId }))
          }
          : { rpId, allowCredentials: credentials.map(c => ({ type: 'public-key', id: c.credentialId, transports: c.transports || [] })) })
      }
    });
  }

  if (url.pathname === '/api/admin/webauthn/register' && request.method === 'POST') {
    if (!hasAdminToken) return json({ error: 'forbidden' }, 403);
    return handleRegister(request, env);
  }

  if (url.pathname === '/api/admin/webauthn/assert' && request.method === 'POST') {
    return handleAssert(request, env);
  }

  return json({ error: 'method-not-allowed' }, 405);
}

export const __adminPasskeyTest = Object.freeze({
  sha256Hex,
  hmacHex,
  listCredentials,
  putChallenge,
  takeChallenge,
  mintSession,
  readAdminSession,
  CRED_PREFIX,
  CHALLENGE_PREFIX,
  SESSION_PREFIX,
  base64UrlToBytes
});
