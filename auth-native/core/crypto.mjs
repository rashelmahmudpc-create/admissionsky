import { AUTH_ERROR_CODES, failAuth } from './errors.mjs';

const encoder = new TextEncoder();
const EMAIL_LOCAL = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+$/;
const DOMAIN_LABEL = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;

export function normalizeAuthEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  if (!email || email.length > 254 || email.includes('..')) failAuth(AUTH_ERROR_CODES.INVALID_INPUT);
  const at = email.lastIndexOf('@');
  if (at <= 0 || at !== email.indexOf('@')) failAuth(AUTH_ERROR_CODES.INVALID_INPUT);
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (local.length > 64 || local.startsWith('.') || local.endsWith('.') || !EMAIL_LOCAL.test(local)) failAuth(AUTH_ERROR_CODES.INVALID_INPUT);
  const labels = domain.split('.');
  if (labels.length < 2 || labels.some(label => !DOMAIN_LABEL.test(label))) failAuth(AUTH_ERROR_CODES.INVALID_INPUT);
  if (labels.at(-1).length < 2 || labels.at(-1).length > 63) failAuth(AUTH_ERROR_CODES.INVALID_INPUT);
  return email;
}

export function maskAuthEmail(email) {
  const normalized = normalizeAuthEmail(email);
  const [local, domain] = normalized.split('@');
  const labels = domain.split('.');
  const localMask = local.length < 3 ? `${local[0]}••` : `${local.slice(0, 2)}${'•'.repeat(Math.min(5, Math.max(2, local.length - 2)))}`;
  const host = labels[0];
  const hostMask = `${host[0]}${'•'.repeat(Math.min(4, Math.max(2, host.length - 1)))}`;
  return `${localMask}@${hostMask}.${labels.slice(1).join('.')}`;
}

const bytesToBase64Url = bytes => {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(bytes.length, offset + 0x8000)));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
};

export function randomToken(byteLength = 32, cryptoImpl = globalThis.crypto) {
  const size = Math.max(16, Math.min(64, Number(byteLength) || 32));
  if (!cryptoImpl || typeof cryptoImpl.getRandomValues !== 'function') failAuth(AUTH_ERROR_CODES.NOT_CONFIGURED);
  const bytes = new Uint8Array(size);
  cryptoImpl.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

export function randomSixDigitOtp(cryptoImpl = globalThis.crypto) {
  if (!cryptoImpl || typeof cryptoImpl.getRandomValues !== 'function') failAuth(AUTH_ERROR_CODES.NOT_CONFIGURED);
  const range = 1_000_000;
  const ceiling = Math.floor(0x1_0000_0000 / range) * range;
  const word = new Uint32Array(1);
  for (let attempt = 0; attempt < 128; attempt += 1) {
    cryptoImpl.getRandomValues(word);
    if (word[0] < ceiling) return String(word[0] % range).padStart(6, '0');
  }
  failAuth(AUTH_ERROR_CODES.INTERNAL_ERROR);
}

export function constantTimeEqual(left, right) {
  const a = String(left || '');
  const b = String(right || '');
  const length = Math.max(a.length, b.length);
  let mismatch = a.length ^ b.length;
  for (let index = 0; index < length; index += 1) {
    mismatch |= (a.charCodeAt(index % Math.max(1, a.length)) || 0) ^ (b.charCodeAt(index % Math.max(1, b.length)) || 0);
  }
  return mismatch === 0;
}

/* AUTH V2.4 (owner 2026-10-31): a reference can say which key made it.
 *
 * The blueprint's finding ১৫. Every derived reference — session, email, device,
 * network, subject — is an HMAC of the same secret, and the repository matches
 * on those references directly (`WHERE email_ref=?`, `WHERE session_ref=?`).
 * That is what makes rotation impossible: change the secret and every stored
 * reference stops matching, so every account, session and trusted device is
 * orphaned at once. The secret can never be changed, which is the same as saying
 * a leaked one is permanent.
 *
 * This adds the missing piece: a reference can be PREFIXED with the version of
 * the key that produced it, and a lookup can try the current key and then the
 * previous one. A rotation then becomes two deployable steps rather than one
 * impossible one — introduce the new key as `current` while the old stays
 * readable, let references migrate as students use the app, then retire the old
 * one. Nothing here changes any existing behaviour: with a single key and no
 * version prefix, every reference is byte-identical to what it was before.
 *
 * Deliberately NOT a new environment variable: the Worker sits on Cloudflare's
 * 64-variable ceiling, so a second secret cannot be added as its own binding.
 * `AUTH_HMAC_SECRET` accepts a `current:previous` pair instead, which is why
 * this is a parsing change and not a binding change. */
/** Split a keyring value into its ordered keys.
 *
 *  A ring is written with a LEADING MARKER: `v2:<current>:<previous>`. Anything
 *  without that marker is a single key, whatever it contains.
 *
 *  The marker is not decoration, and this is the one detail worth reading twice.
 *  Splitting on every colon would mean a secret that merely CONTAINS a colon is
 *  read as a two-key ring — and a secret is arbitrary text. The day one held a
 *  colon, every derived reference would change under it and every account,
 *  session and trusted device would be orphaned at once. `AUTH_HMAC_SECRET` is a
 *  Cloudflare secret: write-only, unreadable from here, and re-issuing it is the
 *  exact outage this whole change exists to prevent. So the safe reading is the
 *  default one — no marker, no split — and the risky reading has to be asked for
 *  explicitly. A secret that starts with `v<digits>:` and was never meant as a
 *  ring is the only way left to surprise anyone, and that shape is not what a
 *  generated secret looks like.
 *
 *  An EMPTY segment inside a marked ring is an error, not something to skip.
 *  `v2:KEY:` and `v2::KEY` both look like a ring with a key missing, and
 *  filtering the gap out would turn either into a one-key ring that works — so a
 *  typo during a rotation would silently sign under the wrong key, or quietly
 *  retire the one still in use. Empty segments are kept and the constructor
 *  refuses them, which is the loud failure the operator needs. */
export function parseHmacKeyring(secret) {
  const value = String(secret || '');
  if (!value.trim()) return [];
  const marked = value.trim().match(/^v\d+:(.*)$/s);
  if (!marked) return [value.trim()];
  return marked[1].split(':').map(part => part.trim());
}

export class AuthHmac {
  constructor(secret, cryptoImpl = globalThis.crypto) {
    const keys = parseHmacKeyring(secret);
    if (!keys.length || keys.some(key => key.length < 32 || /[\r\n\u0000]/.test(key))) {
      failAuth(AUTH_ERROR_CODES.NOT_CONFIGURED);
    }
    if (!cryptoImpl?.subtle) failAuth(AUTH_ERROR_CODES.NOT_CONFIGURED);
    this.crypto = cryptoImpl;
    // Index 0 signs. The rest can only verify, which is what lets a rotation be
    // staged: old references keep resolving while new ones are written under the
    // new key.
    this.keys = keys.map(key => cryptoImpl.subtle.importKey(
      'raw', encoder.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
    ));
    this.key = this.keys[0];
  }

  /** Sign with the CURRENT key. Unchanged output: no prefix, same digest. */
  async hex(context, value) {
    const key = await this.key;
    const signature = await this.crypto.subtle.sign('HMAC', key, encoder.encode(`${String(context)}\u0000${String(value)}`));
    return [...new Uint8Array(signature)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  }

  /** Every digest this value could have, current key first.
   *
   *  A caller that must FIND a row rather than write one tries these in order.
   *  With one key this is a single-element list and costs nothing extra — the
   *  cost only appears during a rotation, which is exactly when it is wanted. */
  async candidates(context, value) {
    const payload = encoder.encode(`${String(context)}\u0000${String(value)}`);
    const digests = [];
    for (const key of this.keys) {
      const signature = await this.crypto.subtle.sign('HMAC', await key, payload);
      digests.push([...new Uint8Array(signature)].map(byte => byte.toString(16).padStart(2, '0')).join(''));
    }
    return digests;
  }
}

export function coarseUserAgent(value) {
  const ua = String(value || '').slice(0, 300);
  const device = /iPhone/i.test(ua) ? 'iPhone'
    : /iPad/i.test(ua) ? 'iPad'
      : /Android/i.test(ua) ? 'Android'
        : /Windows/i.test(ua) ? 'Windows'
          : /Macintosh|Mac OS/i.test(ua) ? 'Mac'
            : /Linux/i.test(ua) ? 'Linux' : 'Browser';
  const browser = /Edg\//i.test(ua) ? 'Edge'
    : /Firefox\//i.test(ua) ? 'Firefox'
      : /Chrome\//i.test(ua) ? 'Chrome'
        : /Safari\//i.test(ua) ? 'Safari' : 'Browser';
  return `${device} · ${browser}`;
}
