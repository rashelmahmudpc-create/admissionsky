/**
 * 🎙️ P23, OWNER GATE
 *
 * The voice page is for the owner alone, so it is protected by a password
 * rather than a login (owner's call, 2026-10-11: "শুধু আমি ইউজ করবো ... লগইন
 * দেওয়ার দরকার নেই একটি password দিও").
 *
 * The password lives in the Worker as a secret and never reaches the browser -
 * the page only ever sees a signed cookie. This is deliberately a gate, not an
 * account system: one password, one owner, no user records, nothing to leak
 * beyond the page itself.
 *
 * What the cookie is:
 *   base64url(payload).base64url(HMAC-SHA256(payload, secret))
 * where payload = `v1.<expiryMs>`. There is no per-session record to store, so
 * the gate costs no Durable Object and survives a deploy. Because the payload
 * carries its own expiry, the Worker checks it without any lookup.
 *
 * The secret to sign with is VOICE_PAGE_PASSWORD, the password the owner
 * typed, used directly as the HMAC key. Nothing extra to configure: setting the
 * password is the whole setup, and changing the password invalidates every old
 * cookie. It is deliberately the only source: the pre-existing VOICE_ACCESS_TOKEN
 * header gate is a separate mechanism and must keep working unchanged.
 *
 * Timing-safe comparison is used for both the password and the signature, so a
 * wrong guess cannot be narrowed down by how long the answer took.
 */

import { safeEqual } from './voice-agent-core.mjs';

export const COOKIE_NAME = 'ah_voice';
export const SESSION_TTL_MS = 180 * 24 * 60 * 60 * 1000; // 180 days

const encoder = new TextEncoder();
const b64url = (bytes) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** The value the cookie is signed with, or '' when no page password is set. */
export function gateSecret(env) {
  return String((env && env.VOICE_PAGE_PASSWORD) || '');
}

export function gateConfigured(env) {
  return gateSecret(env).length > 0;
}

async function sign(payload, secret) {
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(await crypto.subtle.sign('HMAC', key, encoder.encode(payload)));
}

/**
 * Mint a session cookie value. `now` and `ttl` are injectable so the expiry can
 * be tested without waiting half a year.
 */
export async function makeSession(env, now = Date.now(), ttl = SESSION_TTL_MS) {
  const secret = gateSecret(env);
  if (!secret) return '';
  const payload = `v1.${now + ttl}`;
  return `${payload}.${await sign(payload, secret)}`;
}

/** True when the request carries a well-formed, unexpired, correctly signed cookie. */
export async function sessionValid(env, request, now = Date.now()) {
  const secret = gateSecret(env);
  if (!secret) return false;
  const raw = readCookie(request.headers.get('Cookie') || '', COOKIE_NAME);
  if (!raw) return false;
  const cut = raw.lastIndexOf('.');
  if (cut < 1) return false;
  const payload = raw.slice(0, cut);
  const given = raw.slice(cut + 1);
  if (!/^v1\.\d+$/.test(payload)) return false;
  if (Number(payload.slice(3)) <= now) return false;
  const want = await sign(payload, secret);
  return safeEqual(given, want);
}

/** True when the submitted password matches. Empty submissions never match. */
export function passwordMatches(env, given) {
  const secret = gateSecret(env);
  const value = String(given == null ? '' : given);
  if (!secret || !value) return false;
  return safeEqual(value, secret);
}

/** Read one cookie value without pulling in a parser. */
export function readCookie(header, name) {
  for (const part of String(header).split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return '';
}

/** Set-Cookie for a fresh session. HttpOnly so page scripts cannot read it. */
export function sessionCookieHeader(value, { secure = true, maxAge = Math.floor(SESSION_TTL_MS / 1000) } = {}) {
  return `${COOKIE_NAME}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}
