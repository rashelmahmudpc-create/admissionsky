// Password strength (P30, component 7): reject the passwords an attacker
// tries first, at signup only.
//
// Two checks, in this order:
//   1. A local list of the passwords that appear at the top of every breach
//      corpus. This costs nothing, needs no network, and catches the bulk.
//   2. HIBP k-anonymity: the first five characters of the SHA-1 hash go out,
//      never the password or the full hash, and the answer is matched
//      locally. A network failure is not a rejection - the owner's rule is
//      that a breach check must never stop a student from signing up.
//
// The owner's own rule on composition is kept: length 10 to 128, no
// "must contain a symbol" theatre, because that rule is what produces
// Password1! and a sticky note.

export const PASSWORD_STRENGTH_POLICY_VERSION = 'password-strength-v1';

export const PASSWORD_STRENGTH_MIN = 10;
export const PASSWORD_STRENGTH_MAX = 128;

// Deliberately short and obvious: this list exists to catch the passwords
// that a credential-stuffing run tries first, not to be a dictionary. A
// long list here would be a maintenance burden for no extra safety, since
// HIBP covers the long tail.
export const COMMON_PASSWORDS = Object.freeze([
  'password', 'password1', 'password123', 'passw0rd', 'p@ssw0rd', 'p@ssword1',
  '1234567890', '12345678901', '123456789012', '1234567890123', '0123456789',
  'qwertyuiop', 'qwerty12345', 'qwertyuiop1', '1qaz2wsx3edc', 'zaq12wsxcde3',
  'iloveyou123', 'admin12345', 'administrator', 'administrator1', 'adminadmin',
  'welcome123', 'welcome1234', 'letmein123', 'letmein1234', 'monkey12345',
  'dragon12345', 'football123', 'baseball123', 'sunshine123', 'princess123',
  'abcd12345678', 'abc123456789', 'a1b2c3d4e5', 'asdfghjkl123', 'zxcvbnm123456',
  'bangladesh1', 'bangladesh123', 'dhaka123456', 'student12345', 'student1234',
  'admission123', 'admission1', 'college12345', 'school123456', 'teacher12345',
  'hello123456', 'test12345678', 'changeme123', 'secret123456', 'master123456'
]);

const COMMON_SET = new Set(COMMON_PASSWORDS);

export function isCommonPassword(password) {
  const value = String(password || '').toLowerCase();
  if (!value) return false;
  if (COMMON_SET.has(value)) return true;
  // Trailing digits and a single trailing punctuation are the two most
  // common "hardening" moves; strip them and check again.
  const stripped = value.replace(/[0-9]{1,4}$/, '').replace(/[!@#$%^&*._-]+$/, '');
  return stripped.length >= 6 && COMMON_SET.has(stripped);
}

export function passwordLengthVerdict(password) {
  const value = String(password || '');
  if (value.length < PASSWORD_STRENGTH_MIN) return 'too-short';
  if (value.length > PASSWORD_STRENGTH_MAX) return 'too-long';
  return 'ok';
}

/**
 * SHA-1 as hex, which is what the HIBP range API expects. Uses the runtime's
 * built-in Web Crypto digest, so there is no dependency and no bundled hash
 * implementation.
 */
export async function sha1Hex(value, cryptoImpl = globalThis.crypto) {
  if (!cryptoImpl?.subtle) throw new Error('crypto-unavailable');
  const bytes = new TextEncoder().encode(String(value));
  const digest = await cryptoImpl.subtle.digest('SHA-1', bytes);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * HIBP k-anonymity check. Sends the first five hash characters; the API
 * answers with every suffix that shares that prefix, and the match happens
 * here. Returns 'breached' | 'clean' | 'unknown' - 'unknown' on any network
 * or shape problem, and the caller must treat 'unknown' as a pass.
 */
export async function breachedPassword(password, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const cryptoImpl = options.cryptoImpl || globalThis.crypto;
  if (typeof fetchImpl !== 'function') return { verdict: 'unknown', reason: 'no-fetch' };

  let hash;
  try {
    hash = await sha1Hex(password, cryptoImpl);
  } catch {
    return { verdict: 'unknown', reason: 'no-crypto' };
  }

  const prefix = hash.slice(0, 5).toUpperCase();
  const suffix = hash.slice(5).toUpperCase();

  try {
    const response = await fetchImpl(`https://api.pwnedpasswords.com/range/${prefix}`, {
      method: 'GET',
      headers: { 'Add-Padding': 'true', 'User-Agent': String(options.userAgent || 'admission-hub-password-check') }
    });
    if (!response || !response.ok) return { verdict: 'unknown', reason: 'bad-response' };
    const body = await response.text();
    const hit = String(body || '')
      .split('\n')
      .map(line => line.trim().split(':')[0]?.toUpperCase())
      .some(value => value === suffix);
    return { verdict: hit ? 'breached' : 'clean' };
  } catch {
    return { verdict: 'unknown', reason: 'network' };
  }
}

/**
 * The full signup verdict. Local checks first, so the common cases never
 * reach the network.
 */
export async function signupPasswordVerdict(password, options = {}) {
  const length = passwordLengthVerdict(password);
  if (length !== 'ok') return Object.freeze({ ok: false, reason: length, policyVersion: PASSWORD_STRENGTH_POLICY_VERSION });
  if (isCommonPassword(password)) return Object.freeze({ ok: false, reason: 'common', policyVersion: PASSWORD_STRENGTH_POLICY_VERSION });

  if (options.checkBreaches === false) {
    return Object.freeze({ ok: true, reason: 'ok', breachCheck: 'skipped', policyVersion: PASSWORD_STRENGTH_POLICY_VERSION });
  }

  const breach = await breachedPassword(password, options);
  // 'unknown' passes: a breach API outage must not block signups.
  return Object.freeze({
    ok: breach.verdict !== 'breached',
    reason: breach.verdict === 'breached' ? 'breached' : 'ok',
    breachCheck: breach.verdict,
    policyVersion: PASSWORD_STRENGTH_POLICY_VERSION
  });
}
