import { allowedOrigin } from '../../cors-policy.mjs';
import { AUTH_ERROR_CODES, errorFromRepository, failAuth, NativeAuthError } from './errors.mjs';
import {
  AuthHmac,
  coarseUserAgent,
  constantTimeEqual,
  maskAuthEmail,
  normalizeAuthEmail,
  randomToken
} from './crypto.mjs';
import {
  SECURITY_PURPOSES,
  SECURITY_RISK_RANK,
  resolveSecurityConfig
} from './security-config.mjs';
import { cooldownForFailure, evaluateRisk, resolveFailSafe } from './security-policy.mjs';
import { AuthSecretVault } from './secret-vault.mjs';
import {
  PASSKEY_ALGORITHM,
  readPasskeyClientChallenge,
  verifyPasskeyAuthentication,
  verifyPasskeyRegistration
} from './webauthn.mjs';

export const AUTH_NATIVE_VERSION = 'firebase-canonical-auth-v3';
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
// "Remember me" off: shorter-lived session (7 days) established at login.
export const REMEMBER_OFF_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const FIREBASE_VERIFICATION_RESEND_COOLDOWN_MS = 60 * 1000;
export const PASSKEY_CHALLENGE_TTL_MS = 5 * 60 * 1000;
export const PASSKEY_TICKET_TTL_MS = 60 * 1000;
export const ACCOUNT_VERIFICATION_TICKET_TTL_MS = 15 * 60 * 1000;
export const PASSKEY_RP_ID = 'admissionhub.pages.dev';
/* The owner's chosen short address (2026-10-13). Both hosts serve the same app,
 * so each must be a valid WebAuthn RP ID in its own right: a passkey is bound to
 * the exact domain it was created on, and browsers reject an RP ID that is not a
 * registrable suffix of the current origin. */
export const PASSKEY_RP_IDS = Object.freeze(['admissionhub.pages.dev', 'admissionsky.pages.dev']);

/* The RP ID to use for a request that arrived on `origin`. Falls back to the
 * legacy host so a missing/blank Origin (Worker-to-Worker, no-Origin clients)
 * keeps the previous behaviour. */
export const passkeyRpIdForOrigin = origin => {
  try {
    const host = new URL(String(origin || '')).hostname.toLowerCase();
    return PASSKEY_RP_IDS.includes(host) ? host : PASSKEY_RP_ID;
  } catch { return PASSKEY_RP_ID; }
};

// Phase 6, risk-signal scopes stored in the existing auth_rate_limits table
// (no new table). Both are count-only: the huge limits mean they measure,
// they never hard-block.
export const SECURITY_RISK_SCOPES = Object.freeze({
  loginFailure: Object.freeze({ scope: 'security-login-fail-email-15m', windowMs: 15 * 60 * 1000 }),
  rapidAuthIp: Object.freeze({ scope: 'security-auth-ip-60s', windowMs: 60 * 1000 })
});

const PASSKEY_REGISTRATION_LIMITS = Object.freeze([
  Object.freeze({ scope: 'passkey-register-user-hour', source: 'email', limit: 6, windowMs: 60 * 60 * 1000 }),
  Object.freeze({ scope: 'passkey-register-ip-hour', source: 'ip', limit: 20, windowMs: 60 * 60 * 1000 }),
  Object.freeze({ scope: 'passkey-register-device-hour', source: 'device', limit: 12, windowMs: 60 * 60 * 1000 })
]);

const PASSKEY_LOGIN_LIMITS = Object.freeze([
  Object.freeze({ scope: 'passkey-login-ip-15m', source: 'ip', limit: 60, windowMs: 15 * 60 * 1000 }),
  Object.freeze({ scope: 'passkey-login-device-15m', source: 'device', limit: 30, windowMs: 15 * 60 * 1000 }),
  Object.freeze({ scope: 'passkey-login-global-minute', source: 'global', limit: 180, windowMs: 60 * 1000 })
]);

const ACCOUNT_VERIFICATION_LIMITS = Object.freeze([
  Object.freeze({ scope: 'telegram-account-verify-email-day', source: 'email', limit: 5, windowMs: 24 * 60 * 60 * 1000 }),
  Object.freeze({ scope: 'telegram-account-verify-ip-hour', source: 'ip', limit: 20, windowMs: 60 * 60 * 1000 }),
  Object.freeze({ scope: 'telegram-account-verify-device-hour', source: 'device', limit: 10, windowMs: 60 * 60 * 1000 }),
  Object.freeze({ scope: 'telegram-account-verify-global-minute', source: 'global', limit: 120, windowMs: 60 * 1000 })
]);

const FIREBASE_OPERATION_LIMITS = Object.freeze({
  signup: Object.freeze([
    Object.freeze({ scope: 'firebase-verification-email-minute', source: 'email', limit: 1, windowMs: FIREBASE_VERIFICATION_RESEND_COOLDOWN_MS }),
    Object.freeze({ scope: 'firebase-verification-email-day', source: 'email', limit: 8, windowMs: 24 * 60 * 60 * 1000 }),
    Object.freeze({ scope: 'firebase-verification-ip-hour', source: 'ip', limit: 20, windowMs: 60 * 60 * 1000 }),
    Object.freeze({ scope: 'firebase-verification-device-hour', source: 'device', limit: 10, windowMs: 60 * 60 * 1000 })
  ]),
  'verification-resend': Object.freeze([
    Object.freeze({ scope: 'firebase-verification-email-minute', source: 'email', limit: 1, windowMs: FIREBASE_VERIFICATION_RESEND_COOLDOWN_MS }),
    Object.freeze({ scope: 'firebase-verification-email-day', source: 'email', limit: 8, windowMs: 24 * 60 * 60 * 1000 }),
    Object.freeze({ scope: 'firebase-verification-ip-hour', source: 'ip', limit: 20, windowMs: 60 * 60 * 1000 }),
    Object.freeze({ scope: 'firebase-verification-device-hour', source: 'device', limit: 10, windowMs: 60 * 60 * 1000 })
  ]),
  'verification-send': Object.freeze([
    Object.freeze({ scope: 'firebase-verification-global-day', source: 'global', limit: 1000, windowMs: 24 * 60 * 60 * 1000 })
  ]),
  login: Object.freeze([
    Object.freeze({ scope: 'firebase-login-email-15m', source: 'email', limit: 12, windowMs: 15 * 60 * 1000 }),
    Object.freeze({ scope: 'firebase-login-ip-15m', source: 'ip', limit: 60, windowMs: 15 * 60 * 1000 }),
    Object.freeze({ scope: 'firebase-login-device-15m', source: 'device', limit: 30, windowMs: 15 * 60 * 1000 }),
    Object.freeze({ scope: SECURITY_RISK_SCOPES.rapidAuthIp.scope, source: 'ip', limit: 100_000, windowMs: SECURITY_RISK_SCOPES.rapidAuthIp.windowMs })
  ]),
  google: Object.freeze([
    Object.freeze({ scope: 'firebase-google-ip-15m', source: 'ip', limit: 60, windowMs: 15 * 60 * 1000 }),
    Object.freeze({ scope: 'firebase-google-device-15m', source: 'device', limit: 30, windowMs: 15 * 60 * 1000 }),
    Object.freeze({ scope: 'firebase-google-global-minute', source: 'global', limit: 180, windowMs: 60 * 1000 })
  ]),
  // The /facebook handler asks for a 'facebook' slot before it calls Firebase.
  // Without an entry here consumeFirebaseOperation throws INVALID_INPUT and the
  // whole sign-in fails before Facebook is ever reached (owner bug 2026-10-14).
  facebook: Object.freeze([
    Object.freeze({ scope: 'firebase-facebook-ip-15m', source: 'ip', limit: 60, windowMs: 15 * 60 * 1000 }),
    Object.freeze({ scope: 'firebase-facebook-device-15m', source: 'device', limit: 30, windowMs: 15 * 60 * 1000 }),
    Object.freeze({ scope: 'firebase-facebook-global-minute', source: 'global', limit: 180, windowMs: 60 * 1000 })
  ]),
  // POST /telegram/login (owner 2026-10-18) asks for its own slot.
  'telegram-login': Object.freeze([
    Object.freeze({ scope: 'firebase-telegram-ip-15m', source: 'ip', limit: 60, windowMs: 15 * 60 * 1000 }),
    Object.freeze({ scope: 'firebase-telegram-device-15m', source: 'device', limit: 30, windowMs: 15 * 60 * 1000 }),
    Object.freeze({ scope: 'firebase-telegram-global-minute', source: 'global', limit: 180, windowMs: 60 * 1000 })
  ]),
  'password-reset': Object.freeze([
    Object.freeze({ scope: 'firebase-reset-email-hour', source: 'email', limit: 3, windowMs: 60 * 60 * 1000 }),
    Object.freeze({ scope: 'firebase-reset-email-day', source: 'email', limit: 8, windowMs: 24 * 60 * 60 * 1000 }),
    Object.freeze({ scope: 'firebase-reset-ip-hour', source: 'ip', limit: 20, windowMs: 60 * 60 * 1000 }),
    Object.freeze({ scope: 'firebase-reset-device-hour', source: 'device', limit: 10, windowMs: 60 * 60 * 1000 }),
    Object.freeze({ scope: 'firebase-reset-global-day', source: 'global', limit: 1000, windowMs: 24 * 60 * 60 * 1000 })
  ]),
  'verification-status': Object.freeze([
    Object.freeze({ scope: 'firebase-verification-status-ip-15m', source: 'ip', limit: 60, windowMs: 15 * 60 * 1000 }),
    Object.freeze({ scope: 'firebase-verification-status-device-15m', source: 'device', limit: 30, windowMs: 15 * 60 * 1000 })
  ]),
  'pending-profile-write': Object.freeze([
    Object.freeze({ scope: 'firebase-pending-profile-ip-hour', source: 'ip', limit: 120, windowMs: 60 * 60 * 1000 }),
    Object.freeze({ scope: 'firebase-pending-profile-device-hour', source: 'device', limit: 20, windowMs: 60 * 60 * 1000 }),
    Object.freeze({ scope: 'firebase-pending-profile-global-minute', source: 'global', limit: 1000, windowMs: 60 * 1000 })
  ]),
  'profile-write': Object.freeze([
    Object.freeze({ scope: 'firebase-profile-email-day', source: 'email', limit: 30, windowMs: 24 * 60 * 60 * 1000 }),
    Object.freeze({ scope: 'firebase-profile-device-day', source: 'device', limit: 60, windowMs: 24 * 60 * 60 * 1000 }),
    Object.freeze({ scope: 'firebase-profile-ip-hour', source: 'ip', limit: 300, windowMs: 60 * 60 * 1000 }),
    Object.freeze({ scope: 'firebase-profile-global-minute', source: 'global', limit: 1000, windowMs: 60 * 1000 })
  ]),
  // Phase 7, profile patch + avatar + public reads.
  'profile-patch': Object.freeze([
    Object.freeze({ scope: 'firebase-profile-email-day', source: 'email', limit: 30, windowMs: 24 * 60 * 60 * 1000 }),
    Object.freeze({ scope: 'firebase-profile-device-day', source: 'device', limit: 60, windowMs: 24 * 60 * 60 * 1000 }),
    Object.freeze({ scope: 'firebase-profile-ip-hour', source: 'ip', limit: 300, windowMs: 60 * 60 * 1000 }),
    Object.freeze({ scope: 'firebase-profile-global-minute', source: 'global', limit: 1000, windowMs: 60 * 1000 })
  ]),
  'avatar-write': Object.freeze([
    Object.freeze({ scope: 'firebase-avatar-email-day', source: 'email', limit: 10, windowMs: 24 * 60 * 60 * 1000 }),
    Object.freeze({ scope: 'firebase-avatar-device-day', source: 'device', limit: 20, windowMs: 24 * 60 * 60 * 1000 }),
    Object.freeze({ scope: 'firebase-avatar-ip-hour', source: 'ip', limit: 60, windowMs: 60 * 60 * 1000 }),
    Object.freeze({ scope: 'firebase-avatar-global-minute', source: 'global', limit: 100, windowMs: 60 * 1000 })
  ]),
  'public-profile-read': Object.freeze([
    Object.freeze({ scope: 'firebase-publicprofile-ip-15m', source: 'ip', limit: 60, windowMs: 15 * 60 * 1000 }),
    Object.freeze({ scope: 'firebase-publicprofile-device-15m', source: 'device', limit: 30, windowMs: 15 * 60 * 1000 }),
    Object.freeze({ scope: 'firebase-publicprofile-global-minute', source: 'global', limit: 600, windowMs: 60 * 1000 })
  ])
});

const requiredRepositoryMethods = Object.freeze([
  'consumeLimits', 'establishExternalSession',
  'getExternalSession', 'getSession', 'revokeSession', 'revokeUserSessions',
  'getAccountState', 'setAccountState',
  'identitySnapshot', 'listLinkedIdentities',
  'beginFirebaseAccountVerification', 'getFirebaseAccountVerification',
  'getFirebaseVerificationRecipientName',
  'completeFirebaseAccountVerification', 'getFirebaseIdentity',
  'savePendingProfile', 'saveProfile', 'getProfile',
  'beginPasskeyRegistration', 'getPasskeyRegistrationChallenge', 'finishPasskeyRegistration',
  'beginPasskeyAuthentication', 'getPasskeyAuthenticationMaterial', 'issuePasskeyTicket',
  'completePasskeySession', 'getPasskeyStatus', 'removePasskey',
  'isDeviceTrusted', 'registerTrustedDevice', 'revokeTrustedDevice', 'listTrustedDevices',
  'getLoginRiskSignals',
  'ping', 'cleanup', 'nextExpiry'
]);

const assertRepository = repository => {
  if (!repository || requiredRepositoryMethods.some(method => typeof repository[method] !== 'function')) {
    failAuth(AUTH_ERROR_CODES.STORAGE_UNAVAILABLE);
  }
  return repository;
};

/* D-5 / A1.5 ②: the trusted-origin list lives in cors-policy.mjs. This copy
 * still trusted http://localhost and every *.admissionhub.pages.dev preview
 * host, which meant a preview build could write session/device context with a
 * production-equivalent origin. */
const trustedContextOrigin = value => {
  const candidate = String(value || '');
  if (!allowedOrigin(candidate)) return '';
  try { return new URL(candidate).origin; } catch { return ''; }
};

const normalizeContext = context => Object.freeze({
  ip: String(context?.ip || 'unknown').slice(0, 96),
  deviceId: String(context?.deviceId || 'unknown').slice(0, 128),
  userAgent: coarseUserAgent(context?.userAgent),
  origin: trustedContextOrigin(context?.origin)
});

const publicUser = user => Object.freeze({
  id: user.id,
  emailMasked: user.emailMask,
  status: user.status,
  createdAt: Number(user.createdAt)
});

const validSubject = value => {
  const subject = String(value || '').trim();
  if (!subject || subject.length > 256 || /[\r\n\u0000]/.test(subject)) failAuth(AUTH_ERROR_CODES.INVALID_INPUT);
  return subject;
};

const cleanProfileText = (value, max) => String(value || '').normalize('NFKC').trim().replace(/\s+/g, ' ').slice(0, max + 1);
const onboardingInstitution = (value, required = false) => {
  if (!value && !required) return null;
  if (!value || typeof value !== 'object') failAuth(AUTH_ERROR_CODES.INVALID_INPUT);
  const id = cleanProfileText(value.id, 80);
  const name = cleanProfileText(value.name, 120);
  const district = cleanProfileText(value.district, 60);
  if (!/^(?:manual|[a-z0-9][a-z0-9-]{1,79})$/.test(id)
    || name.length < 2 || name.length > 120 || /[\r\n\u0000<>]/.test(name)
    || district.length > 60 || /[\r\n\u0000<>]/.test(district)) failAuth(AUTH_ERROR_CODES.INVALID_INPUT);
  return Object.freeze({ id, name, district });
};

export function normalizeOnboardingProfile(value = {}, now = Date.now()) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) failAuth(AUTH_ERROR_CODES.INVALID_INPUT);
  const fullName = cleanProfileText(value.fullName, 80);
  if (fullName.length < 2 || fullName.length > 80 || !/^[\p{L}\p{M} .'-]+$/u.test(fullName)
    || (fullName.match(/\p{L}/gu) || []).length < 2) failAuth(AUTH_ERROR_CODES.INVALID_INPUT);
  const dob = String(value.dob || '');
  const match = dob.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) failAuth(AUTH_ERROR_CODES.INVALID_INPUT);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  const today = new Date(Number(now));
  let age = today.getUTCFullYear() - year;
  const beforeBirthday = today.getUTCMonth() < month - 1 || (today.getUTCMonth() === month - 1 && today.getUTCDate() < day);
  if (beforeBirthday) age -= 1;
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day || age < 8 || age > 80) {
    failAuth(AUTH_ERROR_CODES.INVALID_INPUT);
  }
  // Phase 7B2, signup now collects mobile too (single source of truth:
  // signup data must appear in the Profile without a second entry).
  const mobile = String(value.mobile || '').replace(/[\s()-]/g, '');
  if (mobile && !/^\+?[0-9]{8,15}$/.test(mobile)) failAuth(AUTH_ERROR_CODES.INVALID_INPUT);
  return Object.freeze({
    version: 1,
    fullName,
    dob,
    school: onboardingInstitution(value.school, true),
    higherInstitution: onboardingInstitution(value.higherInstitution, false),
    mobile: mobile || ''
  });
}

const validChallengeId = value => {
  const challengeId = String(value || '').trim();
  if (!/^[A-Za-z0-9_-]{24,96}$/.test(challengeId)) failAuth(AUTH_ERROR_CODES.PASSKEY_INVALID);
  return challengeId;
};

// Phase 7, avatar upload validation (blueprint §11). Magic-byte checks are
// done server-side after base64 decode; client filenames are never trusted.
const AVATAR_MIME_MAGIC = Object.freeze({
  'image/jpeg': Object.freeze([0xff, 0xd8, 0xff]),
  'image/png': Object.freeze([0x89, 0x50, 0x4e, 0x47]),
  'image/webp': Object.freeze([0x52, 0x49, 0x46, 0x46])
});
const WEBP_MAGIC_OFFSET8 = 0x50424557; // "WEBP" little-endian
const AVATAR_MAX_BYTES = 2 * 1024 * 1024;
const AVATAR_MIN_BYTES = 64;

export function normalizeProfilePatch(value = {}, now = Date.now()) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) failAuth(AUTH_ERROR_CODES.INVALID_INPUT);
  const fields = Object.create(null);
  let touched = false;
  for (const [key, raw] of Object.entries(value)) {
    if (raw === undefined) continue;
    touched = true;
    if (key === 'fullName') {
      const name = cleanProfileText(raw, 80);
      if (name.length < 2 || name.length > 80 || !/^[\p{L}\p{M} .'-]+$/u.test(name)) failAuth(AUTH_ERROR_CODES.INVALID_INPUT);
      fields.fullName = name;
    } else if (key === 'mobile') {
      const mobile = String(raw || '').replace(/[\s()-]/g, '');
      if (!/^\+?[0-9]{8,15}$/.test(mobile)) failAuth(AUTH_ERROR_CODES.INVALID_INPUT);
      fields.mobile = mobile;
    } else if (key === 'bio') {
      const bio = String(raw || '').normalize('NFKC').replace(/\s+/g, ' ').trim().slice(0, 281);
      if (bio.length > 280 || /[\r\n\u0000]/.test(bio)) failAuth(AUTH_ERROR_CODES.INVALID_INPUT);
      fields.bio = bio;
    } else if (key === 'dob') {
      // Canonical date value (YYYY-MM-DD) or '' to clear, never a display string.
      const v = String(raw || '').trim();
      if (v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) failAuth(AUTH_ERROR_CODES.INVALID_INPUT);
      if (v) {
        // Same age window as signup (8–80). A fixed year ceiling drifted out of
        // sync with the calendar and rejected legitimate young students.
        const match = v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        const year = Number(match[1]);
        const month = Number(match[2]);
        const day = Number(match[3]);
        const parsed = new Date(`${v}T00:00:00Z`);
        const today = new Date(Number(now));
        let age = today.getUTCFullYear() - year;
        const beforeBirthday = today.getUTCMonth() < month - 1 || (today.getUTCMonth() === month - 1 && today.getUTCDate() < day);
        if (beforeBirthday) age -= 1;
        const validDate = parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
        if (!Number.isFinite(parsed.getTime()) || !validDate || age < 8 || age > 80) failAuth(AUTH_ERROR_CODES.INVALID_INPUT);
      }
      fields.dob = v;
    } else if (key === 'school' || key === 'higherInstitution') {
      // null/'' clears; otherwise { name (required), district? }, id is server-owned.
      if (raw === null || raw === '') { fields[key] = null; continue; }
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) failAuth(AUTH_ERROR_CODES.INVALID_INPUT);
      const instName = cleanProfileText(raw.name, 120);
      const instDistrict = cleanProfileText(raw.district || '', 80);
      if (instName.length < 2 || instName.length > 120 || instDistrict.length > 80
        || /[\r\n\u0000<>]/.test(instName) || /[\r\n\u0000<>]/.test(instDistrict)) {
        failAuth(AUTH_ERROR_CODES.INVALID_INPUT);
      }
      fields[key] = Object.freeze({ id: '', name: instName, district: instDistrict });
    } else if (key === 'target') {
      if (raw === null) { fields.targets = []; continue; }
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) failAuth(AUTH_ERROR_CODES.INVALID_INPUT);
      const name = cleanProfileText(raw.name, 120);
      const unit = cleanProfileText(raw.unit, 20);
      const year = cleanProfileText(raw.year, 10);
      if (name.length < 2 || name.length > 120 || unit.length > 20 || year.length > 10
        || /[\r\n\u0000<>]/.test(name) || /[\r\n\u0000<>]/.test(unit) || /[\r\n\u0000<>]/.test(year)) {
        failAuth(AUTH_ERROR_CODES.INVALID_INPUT);
      }
      fields.targets = [Object.freeze({ name, unit, year })];
    } else if (key === 'visibility') {
      if (!['private', 'limited', 'public'].includes(raw)) failAuth(AUTH_ERROR_CODES.INVALID_INPUT);
      fields.visibility = raw;
    } else if (key === 'admissionSession') {
      const v = cleanProfileText(raw, 4);
      if (v && !/^(19|20|21)\d{2}$/.test(v)) failAuth(AUTH_ERROR_CODES.INVALID_INPUT);
      fields.admissionSession = v;
    } else if (key === 'academicGoal') {
      const v = cleanProfileText(raw, 160);
      if (v.length > 160 || /[\r\n\u0000<>]/.test(v)) failAuth(AUTH_ERROR_CODES.INVALID_INPUT);
      fields.academicGoal = v;
    } else if (key === 'subjects') {
      if (raw === null) { fields.subjects = []; continue; }
      if (!Array.isArray(raw)) failAuth(AUTH_ERROR_CODES.INVALID_INPUT);
      if (raw.length > 8) failAuth(AUTH_ERROR_CODES.INVALID_INPUT);
      const list = [];
      for (const item of raw) {
        const sv = cleanProfileText(item, 40);
        if (!sv || /[\r\n\u0000<>]/.test(sv)) failAuth(AUTH_ERROR_CODES.INVALID_INPUT);
        if (!list.includes(sv)) list.push(sv);
      }
      if (list.length > 8) failAuth(AUTH_ERROR_CODES.INVALID_INPUT);
      fields.subjects = list;
    } else if (key === 'targets') {
      if (raw === null) { fields.targets = []; continue; }
      if (!Array.isArray(raw)) failAuth(AUTH_ERROR_CODES.INVALID_INPUT);
      if (raw.length > 5) failAuth(AUTH_ERROR_CODES.INVALID_INPUT);
      const list = [];
      for (const t of raw) {
        if (!t || typeof t !== 'object' || Array.isArray(t)) failAuth(AUTH_ERROR_CODES.INVALID_INPUT);
        const name = cleanProfileText(t.name, 120);
        const unit = cleanProfileText(t.unit, 20);
        const year = cleanProfileText(t.year, 10);
        if (name.length < 2 || name.length > 120 || unit.length > 20 || year.length > 10
          || /[\r\n\u0000<>]/.test(name) || /[\r\n\u0000<>]/.test(unit) || /[\r\n\u0000<>]/.test(year)) {
          failAuth(AUTH_ERROR_CODES.INVALID_INPUT);
        }
        list.push(Object.freeze({ name, unit, year }));
      }
      fields.targets = list;
    } else {
      failAuth(AUTH_ERROR_CODES.INVALID_INPUT);
    }
  }
  if (!touched) failAuth(AUTH_ERROR_CODES.INVALID_INPUT);
  return Object.freeze(fields);
}

export class CloudflareNativeAuthEngine {
  constructor({ repository, hmacSecret, now = () => Date.now(), cryptoImpl = globalThis.crypto, passkeyRpId = PASSKEY_RP_ID, passkeyOrigins = PASSKEY_RP_IDS.map(id => `https://${id}`), securityConfigRaw = '', avatarStore = null } = {}) {
    this.repository = assertRepository(repository);
    // Phase 7, provider-agnostic avatar store (D1ProfileStore); avatar
    // objects are keyed by the canonical firebase subject ref (the provider
    // set is frozen at ['firebase'] by the Identity Core protection contract).
    this.avatarStore = avatarStore || null;
    this.hmac = new AuthHmac(hmacSecret, cryptoImpl);
    this.vault = new AuthSecretVault(hmacSecret, cryptoImpl);
    this.now = now;
    this.crypto = cryptoImpl;
    this.passkeyRpId = String(passkeyRpId || PASSKEY_RP_ID);
    this.passkeyOrigins = Object.freeze([...new Set(passkeyOrigins.map(value => new URL(value).origin))]);
    // Phase 6, effective security config (env override via
    // SECURITY_CONFIG_JSON is validated; bad overrides fall back to the
    // frozen conservative baseline).
    this.securityConfig = resolveSecurityConfig(securityConfigRaw);
  }

  async #references(email, context) {
    const values = await Promise.all([
      this.hmac.hex('email-ref-v1', email),
      this.hmac.hex('network-ref-v1', context.ip),
      this.hmac.hex('device-ref-v1', context.deviceId)
    ]);
    return Object.freeze({ emailRef: values[0], ipRef: values[1], deviceRef: values[2] });
  }

  async #firebaseIdentity(input, requestContext, invalidCode = AUTH_ERROR_CODES.INVALID_INPUT) {
    const email = normalizeAuthEmail(input?.email);
    let subject;
    try { subject = validSubject(input?.subject); } catch { failAuth(invalidCode); }
    const context = normalizeContext(requestContext);
    const refs = await this.#references(email, context);
    const [subjectRef, sessionRef] = await Promise.all([
      this.hmac.hex('firebase-subject-v1', subject),
      input?.sessionToken ? this.hmac.hex('session-ref-v1', String(input.sessionToken)) : Promise.resolve('')
    ]);
    return Object.freeze({ email, subject, context, refs, subjectRef, sessionRef });
  }

  #limits(definitions, refs) {
    return definitions.map(definition => Object.freeze({
      scope: definition.scope,
      key: definition.source === 'email' ? refs.emailRef
        : definition.source === 'ip' ? refs.ipRef
          : definition.source === 'device' ? refs.deviceRef : 'global',
      limit: definition.limit,
      windowMs: definition.windowMs
    }));
  }

  #passkeyOrigins() {
    return this.passkeyOrigins;
  }

  /* The RP ID for the current request. A passkey is bound to one exact domain,
   * so a device that created its passkey on admissionsky.pages.dev must be
   * verified against admissionsky.pages.dev, not the legacy host. Derive it
   * from the (already validated) context origin, never from raw client input. */
  #passkeyRpId(context) {
    const origin = String(context?.origin || '');
    return origin ? passkeyRpIdForOrigin(origin) : this.passkeyRpId;
  }

  async consumeFirebaseOperation(input = {}, requestContext = {}) {
    const operation = String(input.operation || '');
    const definitions = FIREBASE_OPERATION_LIMITS[operation];
    if (!definitions) failAuth(AUTH_ERROR_CODES.INVALID_INPUT);
    const email = input.email ? normalizeAuthEmail(input.email) : 'firebase-operation@admissionhub.invalid';
    const context = normalizeContext(requestContext);
    const refs = await this.#references(email, context);
    const now = Number(this.now());
    errorFromRepository(await this.repository.consumeLimits({
      limits: this.#limits(definitions, refs),
      now,
      eventType: `firebase-${operation}`,
      subjectRef: input.email ? refs.emailRef : null
    }));
    // Phase 6, escalating cooldown after repeated failed logins (§14):
    // measured from recorded failures (auth_rate_limits state), applied as a
    // delay within the current window. Ceiling 60 min, never a lockout.
    let retryAfter = 0;
    if (operation === 'login' && input.email) {
      const config = this.securityConfig;
      const failScope = SECURITY_RISK_SCOPES.loginFailure;
      const signals = await this.repository.getLoginRiskSignals({
        emailScope: failScope.scope,
        emailWindowMs: failScope.windowMs,
        ipScope: SECURITY_RISK_SCOPES.rapidAuthIp.scope,
        ipWindowMs: SECURITY_RISK_SCOPES.rapidAuthIp.windowMs,
        emailRef: refs.emailRef,
        ipRef: refs.ipRef,
        now
      });
      // Block when the already-recorded failure count has reached the
      // threshold: "5 failures → the next attempt waits." (Plan §13-§14.)
      const cooldownMs = cooldownForFailure(signals.failedLogins, config);
      if (cooldownMs > 0) {
        const windowStart = Math.floor(now / failScope.windowMs) * failScope.windowMs;
        const resumeAt = windowStart + cooldownMs;
        if (now < resumeAt) retryAfter = Math.max(1, Math.ceil((resumeAt - now) / 1000));
      }
    }
    return Object.freeze({
      accepted: true,
      ...(input.email ? { email, emailMask: maskAuthEmail(email) } : {}),
      ...(retryAfter ? { retryAfter } : {}),
      acceptedAt: now
    });
  }

  // Phase 6, record one failed login attempt (count-only risk scope).
  // Called by the public handler only on credential-rejection, so the
  // cooldown measures real failures, not total attempts.
  async recordLoginFailure(input = {}, requestContext = {}) {
    const email = input.email ? normalizeAuthEmail(input.email) : '';
    if (!email) failAuth(AUTH_ERROR_CODES.INVALID_INPUT);
    const context = normalizeContext(requestContext);
    const refs = await this.#references(email, context);
    const now = Number(this.now());
    const failScope = SECURITY_RISK_SCOPES.loginFailure;
    errorFromRepository(await this.repository.consumeLimits({
      limits: [Object.freeze({ scope: failScope.scope, key: refs.emailRef, limit: 100_000, windowMs: failScope.windowMs })],
      now,
      eventType: 'login-failed',
      subjectRef: refs.emailRef
    }));
    const config = this.securityConfig;
    const signals = await this.repository.getLoginRiskSignals({
      emailScope: failScope.scope,
      emailWindowMs: failScope.windowMs,
      ipScope: SECURITY_RISK_SCOPES.rapidAuthIp.scope,
      ipWindowMs: SECURITY_RISK_SCOPES.rapidAuthIp.windowMs,
      emailRef: refs.emailRef,
      ipRef: refs.ipRef,
      now
    });
    const cooldownMs = cooldownForFailure(signals.failedLogins, config);
    let retryAfter = 0;
    if (cooldownMs > 0) {
      const windowStart = Math.floor(now / failScope.windowMs) * failScope.windowMs;
      const resumeAt = windowStart + cooldownMs;
      if (now < resumeAt) retryAfter = Math.max(1, Math.ceil((resumeAt - now) / 1000));
    }
    return Object.freeze({ accepted: true, ...(retryAfter ? { retryAfter } : {}) });
  }

  // Phase 6, risk decision for a login attempt (§3, §4, §30).
  //
  // Inputs are already-normalized server-side facts (never raw PII). The
  // decision is fail-safe: if evaluation cannot complete, sensitive actions
  // fall toward a challenge, never a silent proceed (§30-§31).
  async #loginRiskDecision({ email, subject, refs, now, verified, newDevice }) {
    const config = this.securityConfig;
    const signals = {
      accountState: 'active',
      failedLogins: 0,
      rapidRequests: 0,
      newDevice: newDevice === true,
      recoveryActive: false, // v1: recovery flows are not yet DO-tracked
      unverifiedAccount: verified !== true
    };
    let trusted = false;
    try {
      // Behavioural signals are read even when the account has no local
      // identity yet (the rate-limit rows exist from the first attempt).
      const counts = await this.repository.getLoginRiskSignals({
        emailScope: SECURITY_RISK_SCOPES.loginFailure.scope,
        emailWindowMs: SECURITY_RISK_SCOPES.loginFailure.windowMs,
        ipScope: SECURITY_RISK_SCOPES.rapidAuthIp.scope,
        ipWindowMs: SECURITY_RISK_SCOPES.rapidAuthIp.windowMs,
        emailRef: refs.emailRef,
        ipRef: refs.ipRef,
        now
      });
      signals.failedLogins = counts.failedLogins;
      signals.rapidRequests = counts.rapidRequests;
      const subjectRef = await this.hmac.hex('firebase-subject-v1', subject);
      const identity = await this.repository.getFirebaseIdentity({ subjectRef, emailRef: refs.emailRef });
      if (identity.user) {
        trusted = Boolean((await this.repository.isDeviceTrusted({
          userId: identity.user.id,
          deviceRef: refs.deviceRef,
          now
        })).trusted);
        const state = await this.repository.getAccountState({ userId: identity.user.id, now });
        signals.accountState = state.status || 'active';
        // A trusted device has, by definition, been seen before, it must
        // not itself raise the risk level.
        if (trusted) signals.newDevice = false;
      }
    } catch {
      // Fall through to the fail-safe below, an evaluation outage must not
      // silently allow a sensitive action, and must not lock normal logins
      // out when the risk engine is the thing that failed.
      // 2026-10-18: a verified account on a device whose cookie is already known
      // is a normal login; a risk-store outage must not turn it into an OTP.
      if (verified === true && newDevice !== true) {
        return Object.freeze({
          level: 'NORMAL',
          trusted: false,
          challenge: null,
          block: false,
          sessionTtlMs: config.riskSessionPolicy.NORMAL?.sessionTtlMs ?? null,
          trustOffer: false,
          policyVersion: config.policyVersion
        });
      }
      const failSafe = resolveFailSafe('sensitive', config);
      return Object.freeze({
        level: 'ELEVATED',
        trusted: false,
        challenge: failSafe.challenge ? 'new-device' : null,
        block: failSafe.block,
        sessionTtlMs: config.riskSessionPolicy.ELEVATED.sessionTtlMs,
        trustOffer: false,
        policyVersion: config.policyVersion
      });
    }
    const risk = evaluateRisk(signals, config);
    const actions = risk.actions;
    // A trusted device skips the new-device challenge (fast path), but a
    // CRITICAL account fact always blocks, trust never outranks authority.
    const challenge = actions.block ? null : (trusted ? null : actions.challenge);
    return Object.freeze({
      level: risk.level,
      trusted,
      challenge,
      block: actions.block === true,
      sessionTtlMs: actions.sessionTtlMs,
      trustOffer: actions.trustOffer === true,
      policyVersion: risk.policyVersion
    });
  }

  async establishFirebaseSession(input = {}, requestContext = {}) {
    const email = normalizeAuthEmail(input.email);
    const subject = validSubject(input.subject);
    const context = normalizeContext(requestContext);
    const refs = await this.#references(email, context);
    const now = Number(this.now());
    const decision = await this.#loginRiskDecision({
      email,
      subject,
      refs,
      now,
      verified: input.verified === true,
      newDevice: input.newDevice === true
    });
    if (decision.block) failAuth(AUTH_ERROR_CODES.ACCOUNT_DISABLED);
    if (decision.challenge && input.securityChallenge === true) {
      return Object.freeze({
        challenge: Object.freeze({
          type: decision.challenge,
          level: decision.level,
          policyVersion: decision.policyVersion
        })
      });
    }
    const rememberTtl = input.remember === false ? REMEMBER_OFF_TTL_MS : SESSION_TTL_MS;
    const riskTtl = Number(decision.sessionTtlMs) > 0 ? Number(decision.sessionTtlMs) : null;
    const sessionTtlMs = riskTtl ? Math.min(rememberTtl, riskTtl) : rememberTtl;
    const sessionToken = randomToken(32, this.crypto);
    const userIdCandidate = `usr_${randomToken(18, this.crypto)}`;
    const [subjectRef, sessionRef] = await Promise.all([
      this.hmac.hex('firebase-subject-v1', subject),
      this.hmac.hex('session-ref-v1', sessionToken)
    ]);
    const established = errorFromRepository(await this.repository.establishExternalSession({
      provider: 'firebase',
      subjectRef,
      emailRef: refs.emailRef,
      emailMask: maskAuthEmail(email),
      sessionRef,
      userIdCandidate,
      ipRef: refs.ipRef,
      deviceRef: refs.deviceRef,
      userAgent: context.userAgent,
      now,
      sessionExpiresAt: now + sessionTtlMs,
      loginEvent: decision.trusted ? 'login-trusted-device' : null,
      eventExtras: decision.trusted ? { deviceRef: refs.deviceRef, policyVersion: decision.policyVersion } : {}
    }));
    return Object.freeze({
      sessionToken,
      sessionExpiresAt: now + sessionTtlMs,
      user: publicUser(established.user),
      created: Boolean(established.created),
      security: Object.freeze({
        level: decision.level,
        trusted: decision.trusted === true,
        trustOffer: decision.trustOffer === true,
        policyVersion: decision.policyVersion
      })
    });
  }

  async getFirebaseSession(sessionToken, input = {}) {
    const token = String(sessionToken || '').trim();
    if (!/^[A-Za-z0-9_-]{40,96}$/.test(token)) failAuth(AUTH_ERROR_CODES.SESSION_INVALID);
    const identity = await this.#firebaseIdentity({ ...input, sessionToken: token }, {}, AUTH_ERROR_CODES.SESSION_INVALID);
    const result = errorFromRepository(await this.repository.getExternalSession({
      sessionRef: identity.sessionRef,
      provider: 'firebase',
      subjectRef: identity.subjectRef,
      emailRef: identity.refs.emailRef,
      now: Number(this.now()),
      trackRefresh: Boolean(input.trackRefresh)
    }));
    return Object.freeze({ expiresAt: result.expiresAt, user: publicUser(result.user) });
  }

  async beginFirebaseAccountVerification(input = {}, requestContext = {}) {
    const refreshToken = String(input.refreshToken || '').trim();
    if (refreshToken.length < 20 || refreshToken.length > 4096 || /[\r\n\u0000;]/.test(refreshToken)) {
      failAuth(AUTH_ERROR_CODES.TELEGRAM_VERIFICATION_INVALID);
    }
    // Phase 6, purpose-bound ticket (new-device challenge reuses the
    // existing ticket flow). Only known purposes are accepted; anything
    // else falls back to the legacy (purpose-less) verification ticket.
    const purpose = Object.values(SECURITY_PURPOSES).includes(input.purpose) ? input.purpose : null;
    const identity = await this.#firebaseIdentity(input, requestContext, AUTH_ERROR_CODES.TELEGRAM_VERIFICATION_INVALID);
    const now = Number(this.now());
    const verificationTicket = randomToken(32, this.crypto);
    const userIdCandidate = `usr_${randomToken(18, this.crypto)}`;
    const [ticketRef, refreshCipher] = await Promise.all([
      this.hmac.hex('session-ref-v1', verificationTicket),
      this.vault.seal(refreshToken, `account-verification-refresh:${identity.subjectRef}`)
    ]);
    const prepared = errorFromRepository(await this.repository.beginFirebaseAccountVerification({
      ticketRef,
      userIdCandidate,
      subjectRef: identity.subjectRef,
      emailRef: identity.refs.emailRef,
      emailMask: maskAuthEmail(identity.email),
      refreshCipher,
      purpose,
      ipRef: identity.refs.ipRef,
      deviceRef: identity.refs.deviceRef,
      limits: this.#limits(ACCOUNT_VERIFICATION_LIMITS, identity.refs),
      now,
      expiresAt: now + ACCOUNT_VERIFICATION_TICKET_TTL_MS
    }));
    return Object.freeze({
      verificationTicket,
      expiresAt: now + ACCOUNT_VERIFICATION_TICKET_TTL_MS,
      user: publicUser(prepared.user)
    });
  }

  // Greeting personalisation for the pre-verification OTP. The name is read from
  // the profile the signup flow already saved, so the client never supplies it.
  async getFirebaseVerificationRecipientName(verificationTicket, requestContext = {}) {
    const token = String(verificationTicket || '').trim();
    if (!/^[A-Za-z0-9_-]{40,96}$/.test(token)) failAuth(AUTH_ERROR_CODES.TELEGRAM_VERIFICATION_INVALID);
    const context = normalizeContext(requestContext);
    const refs = await this.#references('account-verification@admissionhub.invalid', context);
    const result = errorFromRepository(await this.repository.getFirebaseVerificationRecipientName({
      ticketRef: await this.hmac.hex('session-ref-v1', token),
      deviceRef: refs.deviceRef,
      now: Number(this.now())
    }));
    return Object.freeze({ fullName: String(result?.fullName || '') });
  }

  async getFirebaseAccountVerification(verificationTicket, input = {}, requestContext = {}) {
    const token = String(verificationTicket || '').trim();
    if (!/^[A-Za-z0-9_-]{40,96}$/.test(token)) failAuth(AUTH_ERROR_CODES.TELEGRAM_VERIFICATION_INVALID);
    const context = normalizeContext(requestContext);
    const [refs, ticketRef] = await Promise.all([
      this.#references('account-verification@admissionhub.invalid', context),
      this.hmac.hex('session-ref-v1', token)
    ]);
    const row = errorFromRepository(await this.repository.getFirebaseAccountVerification({
      ticketRef,
      deviceRef: refs.deviceRef,
      now: Number(this.now())
    }));
    if (input?.email || input?.subject) {
      const identity = await this.#firebaseIdentity(input, requestContext, AUTH_ERROR_CODES.TELEGRAM_VERIFICATION_INVALID);
      if (identity.subjectRef !== row.subjectRef || identity.refs.emailRef !== row.emailRef) {
        failAuth(AUTH_ERROR_CODES.TELEGRAM_VERIFICATION_INVALID);
      }
    }
    const refreshToken = await this.vault.open(row.refreshCipher, `account-verification-refresh:${row.subjectRef}`);
    return Object.freeze({
      refreshToken,
      userId: row.userId,
      subjectRef: row.subjectRef,
      emailRef: row.emailRef,
      sessionRef: ticketRef,
      user: publicUser({
        id: row.userId,
        emailMask: row.emailMask,
        status: row.status,
        createdAt: row.createdAt
      })
    });
  }

  async completeFirebaseAccountVerification(input = {}, requestContext = {}) {
    const token = String(input.verificationTicket || '').trim();
    if (!/^[A-Za-z0-9_-]{40,96}$/.test(token)) failAuth(AUTH_ERROR_CODES.TELEGRAM_VERIFICATION_INVALID);
    const identity = await this.#firebaseIdentity(input, requestContext, AUTH_ERROR_CODES.TELEGRAM_VERIFICATION_INVALID);
    const now = Number(this.now());
    const sessionToken = randomToken(32, this.crypto);
    const config = this.securityConfig;
    const [ticketRef, sessionRef] = await Promise.all([
      this.hmac.hex('session-ref-v1', token),
      this.hmac.hex('session-ref-v1', sessionToken)
    ]);
    const completed = errorFromRepository(await this.repository.completeFirebaseAccountVerification({
      ticketRef,
      subjectRef: identity.subjectRef,
      emailRef: identity.refs.emailRef,
      sessionRef,
      ipRef: identity.refs.ipRef,
      deviceRef: identity.refs.deviceRef,
      userAgent: identity.context.userAgent,
      now,
      sessionExpiresAt: now + SESSION_TTL_MS,
      trust: {
        ttlMs: config.trustTtlMs,
        maxDevices: config.trustMaxDevicesPerUser,
        policyVersion: config.policyVersion
      }
    }));
    return Object.freeze({
      sessionToken,
      sessionExpiresAt: now + SESSION_TTL_MS,
      user: publicUser(completed.user),
      created: false,
      trusted: completed.trusted === true
    });
  }

  async getFirebaseIdentity(input = {}, requestContext = {}) {
    const identity = await this.#firebaseIdentity(input, requestContext, AUTH_ERROR_CODES.SESSION_INVALID);
    const result = errorFromRepository(await this.repository.getFirebaseIdentity({
      subjectRef: identity.subjectRef,
      emailRef: identity.refs.emailRef,
      now: Number(this.now())
    }));
    return Object.freeze({
      user: publicUser(result.user),
      userId: result.user.id,
      subjectRef: identity.subjectRef,
      emailRef: identity.refs.emailRef
    });
  }

  async savePendingProfile(verificationTicket, input = {}, requestContext = {}) {
    const token = String(verificationTicket || '').trim();
    if (!/^[A-Za-z0-9_-]{40,96}$/.test(token)) failAuth(AUTH_ERROR_CODES.TELEGRAM_VERIFICATION_INVALID);
    const context = normalizeContext(requestContext);
    const profile = normalizeOnboardingProfile(input, Number(this.now()));
    const [refs, ticketRef] = await Promise.all([
      this.#references('account-verification@admissionhub.invalid', context),
      this.hmac.hex('session-ref-v1', token)
    ]);
    const result = errorFromRepository(await this.repository.savePendingProfile({
      ticketRef,
      deviceRef: refs.deviceRef,
      profile,
      now: Number(this.now())
    }));
    return Object.freeze({ saved: result.saved === true, profile: result.profile });
  }

  async saveProfile(input = {}, requestContext = {}) {
    const profile = normalizeOnboardingProfile(input.profile, Number(this.now()));
    const identity = await this.#firebaseIdentity(input, requestContext, AUTH_ERROR_CODES.SESSION_INVALID);
    const result = errorFromRepository(await this.repository.saveProfile({
      sessionRef: identity.sessionRef,
      subjectRef: identity.subjectRef,
      emailRef: identity.refs.emailRef,
      profile,
      now: Number(this.now())
    }));
    return Object.freeze({ saved: result.saved === true, profile: result.profile });
  }

  async getProfile(input = {}, requestContext = {}) {
    const identity = await this.#firebaseIdentity(input, requestContext, AUTH_ERROR_CODES.SESSION_INVALID);
    const result = errorFromRepository(await this.repository.getProfile({
      sessionRef: identity.sessionRef,
      subjectRef: identity.subjectRef,
      emailRef: identity.refs.emailRef,
      now: Number(this.now())
    }));
    return Object.freeze({ profile: result.profile || null });
  }

  // -------------------------------------------------------------------
  // Phase 7, Profile & Personal Identity (blueprint §3-§36)
  // The profile is a consumer of the protected Identity/Session/Security
  // cores: every operation below starts from the verified session
  // (#firebaseIdentity) and never rewrites identity or auth fields.
  // -------------------------------------------------------------------

  #bufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return btoa(binary);
  }

  // High-dynamic blueprint §01/§04/§05/§13/§14, deterministic rule table.
  // No AI, no behavioral inference; only real account/profile state.
  profileContext({ profile = null, completion = 0, lastLoginAt = null, now = Date.now() }) {
    const DAY_MS = 86_400_000;
    const createdAt = profile?.createdAt ? Number(profile.createdAt) : null;
    const hasTarget = Array.isArray(profile?.targets) && profile.targets.length > 0 && Boolean(profile.targets[0]?.name);
    const ageDays = createdAt ? (now - createdAt) / DAY_MS : Number.POSITIVE_INFINITY;
    const gapDays = lastLoginAt ? (now - Number(lastLoginAt)) / DAY_MS : Number.POSITIVE_INFINITY;
    let context = 'DEFAULT';
    let greeting = 'আগে থেকেই চলো';
    if (!profile || Number(completion) < 60) {
      context = 'PROFILE_INCOMPLETE';
      greeting = 'তোমার প্রোফাইলটা পূরণ করে নাও';
    } else if (ageDays < 7) {
      context = 'NEW_USER';
      greeting = 'Admission Hub-এ স্বাগতম!';
    } else if (hasTarget) {
      context = 'GOAL_SET';
      greeting = 'লক্ষ্যে অগ্রসর হও';
    } else if (gapDays > 14) {
      context = 'RETURNING';
      greeting = 'ফিরে আসায় ভালো লাগলো!';
    }
    const sectionOrder = Object.freeze({
      PROFILE_INCOMPLETE: Object.freeze(['identity', 'completion', 'academic', 'security']),
      NEW_USER: Object.freeze(['identity', 'completion', 'academic', 'security']),
      GOAL_SET: Object.freeze(['identity', 'goal', 'academic', 'stats']),
      RETURNING: Object.freeze(['identity', 'goal', 'stats', 'academic']),
      DEFAULT: Object.freeze(['identity', 'academic', 'completion', 'security'])
    }[context]);
    return Object.freeze({
      context,
      greeting,
      sectionOrder,
      freshness: 'LIVE',
      computedAt: now
    });
  }

  async getProfileV2(input = {}, requestContext = {}) {
    const identity = await this.#firebaseIdentity(input, requestContext, AUTH_ERROR_CODES.SESSION_INVALID);
    let avatar = { present: false };
    if (this.avatarStore?.available?.()) {
      try { avatar = await this.avatarStore.getAvatarMeta(identity.subjectRef); } catch { avatar = { present: false }; }
    }
    const result = errorFromRepository(await this.repository.getProfileV2({
      sessionRef: identity.sessionRef,
      subjectRef: identity.subjectRef,
      emailRef: identity.refs.emailRef,
      now: Number(this.now()),
      avatarPresent: avatar.present === true
    }));
    return Object.freeze({
      profile: result.profile || null,
      publicId: result.publicId,
      completion: Number(result.completion || 0),
      avatar: avatar.present === true
        ? Object.freeze({ present: true, mime: avatar.mime, bytes: Number(avatar.bytes), updatedAt: Number(avatar.updatedAt) })
        : Object.freeze({ present: false }),
      avatarUrl: avatar.present === true ? '/api/auth/v1/profile/avatar' : null,
      joinedYear: result.joinedYear || null,
      context: this.profileContext({
        profile: result.profile,
        completion: result.completion,
        lastLoginAt: result.lastLoginAt,
        now: Number(this.now())
      })
    });
  }

  async saveProfilePatch(input = {}, requestContext = {}) {
    const fields = normalizeProfilePatch(input.fields, Number(this.now()));
    const identity = await this.#firebaseIdentity(input, requestContext, AUTH_ERROR_CODES.SESSION_INVALID);
    const result = errorFromRepository(await this.repository.saveProfilePatch({
      sessionRef: identity.sessionRef,
      subjectRef: identity.subjectRef,
      emailRef: identity.refs.emailRef,
      fields,
      expectVersion: input.expectVersion === undefined || input.expectVersion === null ? null : Number(input.expectVersion),
      now: Number(this.now())
    }));
    return Object.freeze({ saved: result.saved === true, profile: result.profile || null });
  }

  #validateAvatar(bytes, mime) {
    const magic = AVATAR_MIME_MAGIC[mime];
    if (!magic) failAuth(AUTH_ERROR_CODES.INVALID_INPUT);
    if (bytes.byteLength < AVATAR_MIN_BYTES || bytes.byteLength > AVATAR_MAX_BYTES) failAuth(AUTH_ERROR_CODES.INVALID_INPUT);
    for (let i = 0; i < magic.length; i += 1) {
      if (bytes[i] !== magic[i]) failAuth(AUTH_ERROR_CODES.INVALID_INPUT);
    }
    if (mime === 'image/webp' && (bytes[8] | bytes[9] << 8 | bytes[10] << 16 | bytes[11] << 24) !== WEBP_MAGIC_OFFSET8) {
      failAuth(AUTH_ERROR_CODES.INVALID_INPUT);
    }
    return bytes.byteLength;
  }

  async saveAvatar(input = {}, requestContext = {}) {
    if (!this.avatarStore?.available?.()) failAuth(AUTH_ERROR_CODES.STORAGE_UNAVAILABLE);
    const mime = String(input.mime || '');
    let bytes;
    try {
      bytes = Uint8Array.from(atob(String(input.data || '')), char => char.charCodeAt(0));
    } catch {
      failAuth(AUTH_ERROR_CODES.INVALID_INPUT);
    }
    const size = this.#validateAvatar(bytes, mime);
    const identity = await this.#firebaseIdentity(input, requestContext, AUTH_ERROR_CODES.SESSION_INVALID);
    const now = Number(this.now());
    await this.avatarStore.saveAvatar({ userId: identity.subjectRef, data: bytes, mime, now });
    await this.repository.recordSecurityEvent({
      eventType: 'profile-avatar-changed',
      subjectRef: identity.subjectRef,
      userId: null,
      now,
      purpose: null,
      policyVersion: null
    });
    return Object.freeze({ saved: true, mime, bytes: size });
  }

  async deleteAvatar(input = {}, requestContext = {}) {
    if (!this.avatarStore?.available?.()) failAuth(AUTH_ERROR_CODES.STORAGE_UNAVAILABLE);
    const identity = await this.#firebaseIdentity(input, requestContext, AUTH_ERROR_CODES.SESSION_INVALID);
    await this.avatarStore.deleteAvatar(identity.subjectRef);
    await this.repository.recordSecurityEvent({
      eventType: 'profile-avatar-removed',
      subjectRef: identity.subjectRef,
      userId: null,
      now: Number(this.now()),
      purpose: null,
      policyVersion: null
    });
    return Object.freeze({ deleted: true });
  }

  async getAvatarData(input = {}, requestContext = {}) {
    if (!this.avatarStore?.available?.()) return Object.freeze({ present: false });
    const identity = await this.#firebaseIdentity(input, requestContext, AUTH_ERROR_CODES.SESSION_INVALID);
    const avatar = await this.avatarStore.getAvatar(identity.subjectRef);
    if (!avatar?.present) return Object.freeze({ present: false });
    return Object.freeze({
      present: true,
      mime: avatar.mime,
      bytes: Number(avatar.bytes),
      updatedAt: Number(avatar.updatedAt || 0),
      data: this.#bufferToBase64(avatar.data)
    });
  }

  async getPublicProfile(input = {}) {
    const publicId = String(input.publicId || '').trim();
    if (!/^AH-[A-Z2-9]{6}$/.test(publicId)) failAuth(AUTH_ERROR_CODES.INVALID_INPUT);
    const result = errorFromRepository(await this.repository.getPublicProfile({
      publicId,
      now: Number(this.now())
    }));
    let avatarPresent = false;
    if (result.subjectRef && this.avatarStore?.available?.()) {
      try { avatarPresent = (await this.avatarStore.getAvatarMeta(result.subjectRef)).present === true; } catch { avatarPresent = false; }
    }
    const profile = { ...result.profile, avatarPresent };
    return Object.freeze({ profile: Object.freeze(profile) });
  }

  // Public-safe avatar: only exists when the profile's visibility allows a
  // public surface (limited/public); private profiles 404 (no existence leak).
  async getPublicAvatar(input = {}) {
    const publicId = String(input.publicId || '').trim();
    if (!/^AH-[A-Z2-9]{6}$/.test(publicId)) failAuth(AUTH_ERROR_CODES.INVALID_INPUT);
    const result = errorFromRepository(await this.repository.getPublicProfile({
      publicId,
      now: Number(this.now())
    }));
    if (!result.subjectRef || !this.avatarStore?.available?.()) return Object.freeze({ present: false });
    const avatar = await this.avatarStore.getAvatar(result.subjectRef);
    if (!avatar?.present) return Object.freeze({ present: false });
    return Object.freeze({
      present: true,
      mime: avatar.mime,
      bytes: Number(avatar.bytes),
      data: this.#bufferToBase64(avatar.data)
    });
  }

  async beginPasskeyRegistration(input = {}, requestContext = {}) {
    const token = String(input.sessionToken || '').trim();
    const refreshToken = String(input.refreshToken || '').trim();
    if (!/^[A-Za-z0-9_-]{40,96}$/.test(token) || refreshToken.length < 20 || refreshToken.length > 4096 || /[\r\n\u0000;]/.test(refreshToken)) failAuth(AUTH_ERROR_CODES.SESSION_INVALID);
    const identity = await this.#firebaseIdentity({ ...input, sessionToken: token }, requestContext, AUTH_ERROR_CODES.SESSION_INVALID);
    const now = Number(this.now());
    const challengeId = randomToken(24, this.crypto);
    const challenge = randomToken(32, this.crypto);
    const challengeMac = await this.hmac.hex('passkey-challenge-v1', `${challengeId}:${challenge}`);
    const refreshCipher = await this.vault.seal(refreshToken, `passkey-refresh:${identity.subjectRef}`);
    const userHandleCandidate = randomToken(32, this.crypto);
    const prepared = errorFromRepository(await this.repository.beginPasskeyRegistration({
      challengeId,
      challengeMac,
      sessionRef: identity.sessionRef,
      subjectRef: identity.subjectRef,
      emailRef: identity.refs.emailRef,
      deviceRef: identity.refs.deviceRef,
      ipRef: identity.refs.ipRef,
      userHandleCandidate,
      refreshCipher,
      limits: this.#limits(PASSKEY_REGISTRATION_LIMITS, identity.refs),
      now,
      expiresAt: now + PASSKEY_CHALLENGE_TTL_MS
    }));
    return Object.freeze({
      challengeId,
      options: Object.freeze({
        challenge,
        rp: Object.freeze({ id: this.#passkeyRpId(identity.context), name: 'Admission Hub' }),
        user: Object.freeze({ id: prepared.userHandle, name: prepared.user.emailMask, displayName: 'Admission Hub শিক্ষার্থী' }),
        pubKeyCredParams: Object.freeze([{ type: 'public-key', alg: PASSKEY_ALGORITHM }]),
        timeout: 120_000,
        attestation: 'none',
        authenticatorSelection: Object.freeze({ residentKey: 'required', requireResidentKey: true, userVerification: 'required' }),
        excludeCredentials: Object.freeze((prepared.credentials || []).map(row => Object.freeze({
          type: 'public-key', id: row.credentialId, transports: row.transports
        })))
      })
    });
  }

  async finishPasskeyRegistration(input = {}, requestContext = {}) {
    const challengeId = validChallengeId(input.challengeId);
    const token = String(input.sessionToken || '').trim();
    const refreshToken = String(input.refreshToken || '').trim();
    if (!/^[A-Za-z0-9_-]{40,96}$/.test(token)
      || refreshToken.length < 20 || refreshToken.length > 4096 || /[\r\n\u0000;]/.test(refreshToken)) {
      failAuth(AUTH_ERROR_CODES.SESSION_INVALID);
    }
    const identity = await this.#firebaseIdentity({ ...input, sessionToken: token }, requestContext, AUTH_ERROR_CODES.SESSION_INVALID);
    const suppliedChallenge = readPasskeyClientChallenge(input.response?.clientDataJSON, 'webauthn.create');
    const candidateChallengeMac = await this.hmac.hex('passkey-challenge-v1', `${challengeId}:${suppliedChallenge}`);
    const challenge = errorFromRepository(await this.repository.getPasskeyRegistrationChallenge({
      challengeId,
      candidateChallengeMac,
      sessionRef: identity.sessionRef,
      subjectRef: identity.subjectRef,
      emailRef: identity.refs.emailRef,
      deviceRef: identity.refs.deviceRef,
      now: Number(this.now())
    }));
    const verified = await verifyPasskeyRegistration({
      response: input.response,
      expectedChallenge: suppliedChallenge,
      rpId: this.#passkeyRpId(identity.context),
      allowedOrigins: this.#passkeyOrigins(identity.context),
      cryptoImpl: this.crypto
    });
    await this.vault.open(challenge.refreshCipher, `passkey-refresh:${challenge.subjectRef}`);
    const refreshCipher = await this.vault.seal(refreshToken, `passkey-refresh:${challenge.subjectRef}`);
    const stored = errorFromRepository(await this.repository.finishPasskeyRegistration({
      challengeId,
      candidateChallengeMac,
      deviceRef: identity.refs.deviceRef,
      credential: {
        ...verified,
        userHandle: challenge.userHandle,
        refreshCipher
      },
      now: Number(this.now())
    }));
    return Object.freeze({ registered: true, credentialCount: stored.credentialCount, user: publicUser(stored.user) });
  }

  async beginPasskeyAuthentication(requestContext = {}) {
    const context = normalizeContext(requestContext);
    const refs = await this.#references('passkey-login@admissionhub.invalid', context);
    const now = Number(this.now());
    const challengeId = randomToken(24, this.crypto);
    const challenge = randomToken(32, this.crypto);
    const challengeMac = await this.hmac.hex('passkey-challenge-v1', `${challengeId}:${challenge}`);
    errorFromRepository(await this.repository.beginPasskeyAuthentication({
      challengeId,
      challengeMac,
      deviceRef: refs.deviceRef,
      ipRef: refs.ipRef,
      limits: this.#limits(PASSKEY_LOGIN_LIMITS, refs),
      now,
      expiresAt: now + PASSKEY_CHALLENGE_TTL_MS
    }));
    return Object.freeze({
      challengeId,
      options: Object.freeze({
        challenge,
        rpId: this.#passkeyRpId(context),
        timeout: 120_000,
        userVerification: 'required'
      })
    });
  }

  async finishPasskeyAuthentication(input = {}, requestContext = {}) {
    const challengeId = validChallengeId(input.challengeId);
    const credentialId = String(input.response?.rawId || '');
    if (!/^[A-Za-z0-9_-]{16,1400}$/.test(credentialId)) failAuth(AUTH_ERROR_CODES.PASSKEY_INVALID);
    const context = normalizeContext(requestContext);
    const refs = await this.#references('passkey-login@admissionhub.invalid', context);
    const suppliedChallenge = readPasskeyClientChallenge(input.response?.clientDataJSON, 'webauthn.get');
    const candidateChallengeMac = await this.hmac.hex('passkey-challenge-v1', `${challengeId}:${suppliedChallenge}`);
    const material = errorFromRepository(await this.repository.getPasskeyAuthenticationMaterial({
      challengeId,
      candidateChallengeMac,
      credentialId,
      deviceRef: refs.deviceRef,
      now: Number(this.now())
    }));
    const verified = await verifyPasskeyAuthentication({
      response: input.response,
      expectedChallenge: suppliedChallenge,
      rpId: this.#passkeyRpId(context),
      allowedOrigins: this.#passkeyOrigins(context),
      credential: material.credential,
      cryptoImpl: this.crypto
    });
    const loginTicket = randomToken(32, this.crypto);
    const ticketRef = await this.hmac.hex('passkey-ticket-v1', loginTicket);
    const issued = errorFromRepository(await this.repository.issuePasskeyTicket({
      challengeId,
      candidateChallengeMac,
      credentialId,
      previousCounter: material.credential.counter,
      nextCounter: verified.counter,
      backupState: verified.backupState,
      ticketRef,
      deviceRef: refs.deviceRef,
      now: Number(this.now()),
      expiresAt: Number(this.now()) + PASSKEY_TICKET_TTL_MS
    }));
    const refreshToken = await this.vault.open(issued.refreshCipher, `passkey-refresh:${issued.subjectRef}`);
    return Object.freeze({ loginTicket, refreshToken });
  }

  async completePasskeySession(input = {}, requestContext = {}) {
    const loginTicket = String(input.loginTicket || '').trim();
    const rotatedRefreshToken = String(input.refreshToken || '').trim();
    if (!/^[A-Za-z0-9_-]{40,96}$/.test(loginTicket) || rotatedRefreshToken.length < 20 || rotatedRefreshToken.length > 4096 || /[\r\n\u0000;]/.test(rotatedRefreshToken)) failAuth(AUTH_ERROR_CODES.PASSKEY_INVALID);
    const identity = await this.#firebaseIdentity(input, requestContext, AUTH_ERROR_CODES.PASSKEY_INVALID);
    const now = Number(this.now());
    const sessionToken = randomToken(32, this.crypto);
    const [ticketRef, sessionRef, refreshCipher] = await Promise.all([
      this.hmac.hex('passkey-ticket-v1', loginTicket),
      this.hmac.hex('session-ref-v1', sessionToken),
      this.vault.seal(rotatedRefreshToken, `passkey-refresh:${identity.subjectRef}`)
    ]);
    const completed = errorFromRepository(await this.repository.completePasskeySession({
      ticketRef,
      subjectRef: identity.subjectRef,
      emailRef: identity.refs.emailRef,
      emailMask: maskAuthEmail(identity.email),
      sessionRef,
      refreshCipher,
      ipRef: identity.refs.ipRef,
      deviceRef: identity.refs.deviceRef,
      userAgent: identity.context.userAgent,
      now,
      sessionExpiresAt: now + SESSION_TTL_MS
    }));
    return Object.freeze({
      sessionToken,
      sessionExpiresAt: now + SESSION_TTL_MS,
      user: publicUser(completed.user),
      created: false
    });
  }

  async getPasskeyStatus(input = {}, requestContext = {}) {
    const token = String(input.sessionToken || '').trim();
    if (!/^[A-Za-z0-9_-]{40,96}$/.test(token)) failAuth(AUTH_ERROR_CODES.SESSION_INVALID);
    const identity = await this.#firebaseIdentity({ ...input, sessionToken: token }, requestContext, AUTH_ERROR_CODES.SESSION_INVALID);
    const result = errorFromRepository(await this.repository.getPasskeyStatus({
      sessionRef: identity.sessionRef,
      subjectRef: identity.subjectRef,
      emailRef: identity.refs.emailRef,
      now: Number(this.now())
    }));
    return Object.freeze({ enabled: result.count > 0, count: result.count, credentials: Object.freeze(result.credentials) });
  }

  async removePasskey(input = {}, requestContext = {}) {
    const token = String(input.sessionToken || '').trim();
    const credentialId = String(input.credentialId || '');
    if (!/^[A-Za-z0-9_-]{40,96}$/.test(token) || !/^[A-Za-z0-9_-]{16,1400}$/.test(credentialId)) failAuth(AUTH_ERROR_CODES.INVALID_INPUT);
    const identity = await this.#firebaseIdentity({ ...input, sessionToken: token }, requestContext, AUTH_ERROR_CODES.SESSION_INVALID);
    const result = errorFromRepository(await this.repository.removePasskey({
      sessionRef: identity.sessionRef,
      subjectRef: identity.subjectRef,
      emailRef: identity.refs.emailRef,
      credentialId,
      now: Number(this.now())
    }));
    return Object.freeze({ removed: true, credentialCount: result.credentialCount });
  }

  async getSession(sessionToken) {
    const token = String(sessionToken || '').trim();
    if (!/^[A-Za-z0-9_-]{40,96}$/.test(token)) failAuth(AUTH_ERROR_CODES.SESSION_INVALID);
    const sessionRef = await this.hmac.hex('session-ref-v1', token);
    const result = errorFromRepository(await this.repository.getSession({ sessionRef, now: Number(this.now()) }));
    return Object.freeze({ expiresAt: result.expiresAt, user: publicUser(result.user) });
  }

  async revokeSession(sessionToken) {
    const token = String(sessionToken || '').trim();
    if (!/^[A-Za-z0-9_-]{40,96}$/.test(token)) return Object.freeze({ revoked: false });
    const sessionRef = await this.hmac.hex('session-ref-v1', token);
    const result = await this.repository.revokeSession({ sessionRef, now: Number(this.now()) });
    return Object.freeze({ revoked: Boolean(result?.revoked) });
  }

  // Phase 6, device trust management (§5-§7). All three require a valid
  // session for the caller's own account; trust never touches other users.
  async trustCurrentDevice(input = {}, requestContext = {}) {
    const identity = await this.#firebaseIdentity(input, requestContext, AUTH_ERROR_CODES.SESSION_INVALID);
    const now = Number(this.now());
    const session = errorFromRepository(await this.repository.getExternalSession({
      sessionRef: identity.sessionRef,
      provider: 'firebase',
      subjectRef: identity.subjectRef,
      emailRef: identity.refs.emailRef,
      now
    }));
    const config = this.securityConfig;
    const result = errorFromRepository(await this.repository.registerTrustedDevice({
      userId: session.user.id,
      deviceRef: identity.refs.deviceRef,
      browserClass: identity.context.userAgent,
      now,
      ttlMs: config.trustTtlMs,
      maxDevices: config.trustMaxDevicesPerUser,
      policyVersion: config.policyVersion
    }));
    return Object.freeze({ trusted: true, expiresAt: result.expiresAt, policyVersion: config.policyVersion });
  }

  // Phase 6 Chunk 4, recent login history for the signed-in user (§27).
  // Privacy boundary: method, coarse browser class and time only, no IP,
  // no location, no raw device identifier, no raw email.
  async securityHistory(input = {}, requestContext = {}) {
    const identity = await this.#firebaseIdentity(input, requestContext, AUTH_ERROR_CODES.SESSION_INVALID);
    const now = Number(this.now());
    const session = errorFromRepository(await this.repository.getExternalSession({
      sessionRef: identity.sessionRef,
      provider: 'firebase',
      subjectRef: identity.subjectRef,
      emailRef: identity.refs.emailRef,
      now
    }));
    const rows = errorFromRepository(await this.repository.recentSecurityHistory({
      userId: session.user.id,
      now,
      limit: 10
    }));
    return Object.freeze({
      entries: rows.map(row => Object.freeze({
        at: Number(row.at),
        method: row.method,
        browserClass: row.browserClass,
        trusted: row.trusted === true,
        active: row.active === true
      })),
      policyVersion: this.securityConfig.policyVersion
    });
  }

  // Phase 6 Chunk 4, admin security health (counts + rates, refs only).
  async securityHealth() {
    const now = Number(this.now());
    const windowMs = 15 * 60 * 1000;
    const counts = errorFromRepository(await this.repository.securityEventCounts({ now, windowMs }));
    return Object.freeze({
      windowMs,
      now,
      failedLogins: counts.failedLogins,
      challengesCreated: counts.challengesCreated,
      challengesVerified: counts.challengesVerified,
      challengesFailed: counts.challengesFailed,
      newDeviceLogins: counts.newDeviceLogins,
      devicesRevoked: counts.devicesRevoked,
      sessionsRevoked: counts.sessionsRevoked
    });
  }

  // Phase 6 Chunk 4, paged security event ledger (refs only, no PII).
  async securityEventsPage(input = {}) {
    const limit = Math.min(Math.max(Number(input.limit) || 50, 1), 200);
    const before = input.before ? Number(input.before) : null;
    if (before !== null && (!Number.isFinite(before) || before <= 0)) failAuth(AUTH_ERROR_CODES.INVALID_INPUT);
    const result = errorFromRepository(await this.repository.listSecurityEvents({ limit, before }));
    const entries = result.entries.map(row => Object.freeze({
      eventType: row.eventType,
      subjectRef: row.subjectRef || null,
      userId: row.userId || null,
      occurredAt: Number(row.occurredAt),
      deviceRef: row.deviceRef || null,
      purpose: row.purpose || null,
      policyVersion: row.policyVersion || null
    }));
    return Object.freeze({
      entries: Object.freeze(entries),
      nextBefore: entries.length === limit ? Number(entries[entries.length - 1].occurredAt) : null
    });
  }

  // Phase 6 Chunk 4, step-up-gated trusted-device revocation.
  async revokeTrustedDevice(input = {}, requestContext = {}) {
    const token = String(input.sessionToken || '').trim();
    if (!/^[A-Za-z0-9_-]{40,96}$/.test(token)) failAuth(AUTH_ERROR_CODES.SESSION_INVALID);
    const identity = await this.#firebaseIdentity({ ...input, sessionToken: token }, requestContext, AUTH_ERROR_CODES.SESSION_INVALID);
    const now = Number(this.now());
    const session = errorFromRepository(await this.repository.getSession({ sessionRef: identity.sessionRef, now }));
    await this.#assertStepUp(input, identity, session, now);
    const config = this.securityConfig;
    const requested = String(input.deviceRef || '').trim();
    let deviceRef;
    if (input.scope === 'all') deviceRef = null;
    else if (input.scope === 'current' || !requested) deviceRef = identity.refs.deviceRef;
    else if (/^[A-Za-z0-9_-]{16,128}$/.test(requested)) deviceRef = requested;
    else failAuth(AUTH_ERROR_CODES.INVALID_INPUT);
    const result = errorFromRepository(await this.repository.revokeTrustedDevice({
      userId: session.user.id,
      deviceRef,
      now,
      policyVersion: config.policyVersion
    }));
    return Object.freeze({ revoked: Number(result.revoked || 0) });
  }

  async getSecurityState(input = {}, requestContext = {}) {
    const identity = await this.#firebaseIdentity(input, requestContext, AUTH_ERROR_CODES.SESSION_INVALID);
    const now = Number(this.now());
    const session = errorFromRepository(await this.repository.getExternalSession({
      sessionRef: identity.sessionRef,
      provider: 'firebase',
      subjectRef: identity.subjectRef,
      emailRef: identity.refs.emailRef,
      now
    }));
    const config = this.securityConfig;
    const [state, devices, trusted] = await Promise.all([
      this.repository.getAccountState({ userId: session.user.id, now }),
      this.repository.listTrustedDevices({ userId: session.user.id, now }),
      this.repository.isDeviceTrusted({ userId: session.user.id, deviceRef: identity.refs.deviceRef, now })
    ]);
    return Object.freeze({
      userId: session.user.id,
      accountStatus: state.status,
      currentDeviceTrusted: trusted.trusted === true,
      devices,
      now,
      policyVersion: config.policyVersion
    });
  }

  // The DO injects the verification orchestrator after construction (the
  // engine owns security policy; the orchestrator owns delivery).
  bindVerification(orchestrator) {
    this.verification = orchestrator || null;
  }

  #requireVerification() {
    if (!this.verification) failAuth(AUTH_ERROR_CODES.NOT_CONFIGURED);
  }

  #challengePurpose(value) {
    const purpose = String(value || '');
    return Object.values(SECURITY_PURPOSES).includes(purpose) ? purpose : null;
  }

  // Phase 6, open a purpose-bound security challenge (§11). v1 methods are
  // email and Telegram (passkey is reserved in the registry). The challenge
  // reuses the existing verification ticket material for delivery; the
  // security binding (purpose, single-use, device) lives in the challenge row.
  async requestChallenge(input = {}, requestContext = {}) {
    this.#requireVerification();
    const purpose = this.#challengePurpose(input.purpose);
    if (!purpose) failAuth(AUTH_ERROR_CODES.INVALID_INPUT);
    const method = String(input.method || 'email');
    if (method === 'passkey') failAuth(AUTH_ERROR_CODES.PASSKEY_UNAVAILABLE);
    if (!['email', 'telegram'].includes(method)) failAuth(AUTH_ERROR_CODES.INVALID_INPUT);
    const token = String(input.sessionToken || '').trim();
    if (!/^[A-Za-z0-9_-]{40,96}$/.test(token)) failAuth(AUTH_ERROR_CODES.SESSION_INVALID);
    const identity = await this.#firebaseIdentity({ ...input, sessionToken: token }, requestContext, AUTH_ERROR_CODES.SESSION_INVALID);
    const now = Number(this.now());
    const session = errorFromRepository(await this.repository.getExternalSession({
      sessionRef: identity.sessionRef,
      provider: 'firebase',
      subjectRef: identity.subjectRef,
      emailRef: identity.refs.emailRef,
      now
    }));
    const config = this.securityConfig;
    const challengeRef = randomToken(24, this.crypto);
    this.repository.createSecurityChallenge({
      challengeRef,
      userId: session.user.id,
      purpose,
      method,
      maxAttempts: config.challengeMaxAttempts,
      now,
      ttlMs: config.challengeTtlMs,
      policyVersion: config.policyVersion,
      deviceRef: identity.refs.deviceRef
    });
    let requested;
    try {
      requested = await this.verification.requestVerification({
        sessionToken: token,
        email: identity.email,
        subject: identity.subject,
        userId: session.user.id,
        purpose: 'sensitive-action',
        allowTelegramLink: true
      }, requestContext);
    } catch (cause) {
      // Delivery failed: no silent bypass, the challenge is cancelled and
      // the sensitive action stays unavailable until a challenge succeeds.
      this.repository.cancelSecurityChallenge({ challengeRef });
      throw cause instanceof NativeAuthError ? cause : new NativeAuthError(AUTH_ERROR_CODES.BACKUP_UNAVAILABLE);
    }
    this.repository.markSecurityChallengeSent({ challengeRef, attemptId: requested.attemptId, now });
    return Object.freeze({
      challengeRef,
      attemptId: requested.attemptId,
      purpose,
      method,
      expiresAt: Number(requested.expiresAt),
      resendAfter: Number(requested.resendAfter || 0),
      policyVersion: config.policyVersion,
      ...(requested.interaction ? { interaction: requested.interaction } : {})
    });
  }

  // Phase 6, verify a challenge (§12): single-use, purpose-bound,
  // device-bound, attempt-capped, expiring, non-replayable.
  async verifyChallenge(input = {}, requestContext = {}) {
    this.#requireVerification();
    const challengeRef = String(input.challengeRef || '').trim();
    if (!/^[A-Za-z0-9_-]{16,96}$/.test(challengeRef)) failAuth(AUTH_ERROR_CODES.INVALID_INPUT);
    const code = String(input.code || '').trim();
    if (!/^\d{6}$/.test(code)) failAuth(AUTH_ERROR_CODES.INVALID_INPUT);
    const purpose = this.#challengePurpose(input.purpose);
    if (!purpose) failAuth(AUTH_ERROR_CODES.INVALID_INPUT);
    const token = String(input.sessionToken || '').trim();
    if (!/^[A-Za-z0-9_-]{40,96}$/.test(token)) failAuth(AUTH_ERROR_CODES.SESSION_INVALID);
    const identity = await this.#firebaseIdentity({ ...input, sessionToken: token }, requestContext, AUTH_ERROR_CODES.SESSION_INVALID);
    const now = Number(this.now());
    const session = errorFromRepository(await this.repository.getExternalSession({
      sessionRef: identity.sessionRef,
      provider: 'firebase',
      subjectRef: identity.subjectRef,
      emailRef: identity.refs.emailRef,
      now
    }));
    const row = this.repository.getSecurityChallenge({ challengeRef, userId: session.user.id, now });
    if (!row || row.purpose !== purpose || row.deviceRef !== identity.refs.deviceRef) failAuth(AUTH_ERROR_CODES.CHALLENGE_INVALID);
    if (row.status !== 'sent') failAuth(AUTH_ERROR_CODES.CHALLENGE_INVALID);
    if (row.attempts >= row.maxAttempts) {
      this.repository.failSecurityChallenge({ challengeRef });
      failAuth(AUTH_ERROR_CODES.CHALLENGE_INVALID);
    }
    this.repository.recordSecurityChallengeAttempt({ challengeRef, now });
    let verified;
    try {
      verified = await this.verification.verify({
        sessionToken: token,
        email: identity.email,
        subject: identity.subject,
        userId: session.user.id,
        purpose: 'sensitive-action',
        attemptId: row.attemptId,
        code
      }, requestContext);
    } catch (cause) {
      const after = this.repository.getSecurityChallenge({ challengeRef, userId: session.user.id, now });
      if (after && after.status === 'sent' && after.attempts >= after.maxAttempts) {
        this.repository.failSecurityChallenge({ challengeRef });
      }
      throw cause instanceof NativeAuthError ? cause : new NativeAuthError(AUTH_ERROR_CODES.STORAGE_UNAVAILABLE);
    }
    if (verified?.verified !== true) failAuth(AUTH_ERROR_CODES.OTP_INVALID);
    const stepUpToken = randomToken(32, this.crypto);
    const stepUpTokenMac = await this.hmac.hex('step-up-token-v1', stepUpToken);
    const won = this.repository.verifySecurityChallenge({ challengeRef, now, stepUpTokenMac });
    if (!won) failAuth(AUTH_ERROR_CODES.CHALLENGE_INVALID);
    this.#eventSecurity('security-challenge-verified', session.user.id, identity.refs.deviceRef, now, purpose, this.securityConfig.policyVersion);
    return Object.freeze({
      verified: true,
      purpose,
      stepUpToken,
      emailMasked: session.user.emailMask,
      browserClass: identity.context.userAgent || null,
      expiresAt: row.expiresAt,
      policyVersion: this.securityConfig.policyVersion
    });
  }

  async cancelChallenge(input = {}, requestContext = {}) {
    const challengeRef = String(input.challengeRef || '').trim();
    if (!/^[A-Za-z0-9_-]{16,96}$/.test(challengeRef)) failAuth(AUTH_ERROR_CODES.INVALID_INPUT);
    const token = String(input.sessionToken || '').trim();
    if (!/^[A-Za-z0-9_-]{40,96}$/.test(token)) failAuth(AUTH_ERROR_CODES.SESSION_INVALID);
    const identity = await this.#firebaseIdentity({ ...input, sessionToken: token }, requestContext, AUTH_ERROR_CODES.SESSION_INVALID);
    const now = Number(this.now());
    const session = errorFromRepository(await this.repository.getExternalSession({
      sessionRef: identity.sessionRef,
      provider: 'firebase',
      subjectRef: identity.subjectRef,
      emailRef: identity.refs.emailRef,
      now
    }));
    this.repository.cancelSecurityChallenge({ challengeRef });
    this.#eventSecurity('security-challenge-cancelled', session.user.id, identity.refs.deviceRef, now, String(input.purpose || ''), this.securityConfig.policyVersion);
    return Object.freeze({ cancelled: true });
  }

  #eventSecurity(eventType, userId, deviceRef, now, purpose, policyVersion) {
    try {
      this.repository.recordSecurityEvent?.({ eventType, userId, deviceRef, now, purpose, policyVersion });
    } catch {
      // audit is best-effort; the security decision itself already happened
    }
  }

  // Phase 6, the shared step-up gate (§12). A presented stepUpToken is
  // validated (constant-time MAC, device-bound) and consumed exactly once;
  // without one, the action is allowed only while the session is recent AND
  // current risk stays below ELEVATED. Otherwise the client's 2-step arm
  // runs a challenge and retries with a fresh token.
  async #assertStepUp(input, identity, session, now) {
    const config = this.securityConfig;
    const userId = session.user.id;
    const stepUpToken = String(input.stepUpToken || '').trim();
    if (stepUpToken) {
      if (stepUpToken.length < 32 || stepUpToken.length > 128) failAuth(AUTH_ERROR_CODES.CHALLENGE_INVALID);
      const row = this.repository.latestVerifiedStepUpChallenge({ userId, now });
      const mac = await this.hmac.hex('step-up-token-v1', stepUpToken);
      const consumed = row && row.deviceRef === identity.refs.deviceRef
        && row.stepUpTokenMac && constantTimeEqual(row.stepUpTokenMac, mac)
        && this.repository.consumeSecurityChallenge({ challengeRef: row.challengeRef, now });
      if (!consumed) failAuth(AUTH_ERROR_CODES.CHALLENGE_INVALID);
      return;
    }
    const ageMs = now - Number(session.createdAt || 0);
    const counts = await this.repository.getLoginRiskSignals({
      emailScope: SECURITY_RISK_SCOPES.loginFailure.scope,
      emailWindowMs: SECURITY_RISK_SCOPES.loginFailure.windowMs,
      ipScope: SECURITY_RISK_SCOPES.rapidAuthIp.scope,
      ipWindowMs: SECURITY_RISK_SCOPES.rapidAuthIp.windowMs,
      emailRef: identity.refs.emailRef,
      ipRef: identity.refs.ipRef,
      now
    });
    const state = await this.repository.getAccountState({ userId, now });
    const risk = evaluateRisk({
      accountState: state.status || 'active',
      failedLogins: counts.failedLogins,
      rapidRequests: counts.rapidRequests,
      newDevice: false,
      recoveryActive: false,
      unverifiedAccount: false
    }, config);
    const recent = ageMs <= config.stepUpRecentSessionMs;
    if (!(recent && (SECURITY_RISK_RANK[risk.level] ?? 1) < SECURITY_RISK_RANK.ELEVATED)) {
      failAuth(AUTH_ERROR_CODES.STEP_UP_REQUIRED);
    }
  }

  // Phase 6, step-up-gated logout-all (§12).
  async revokeAllSessions(input = {}, requestContext = {}) {
    const token = String(input.sessionToken || '').trim();
    if (!/^[A-Za-z0-9_-]{40,96}$/.test(token)) failAuth(AUTH_ERROR_CODES.SESSION_INVALID);
    const identity = await this.#firebaseIdentity({ ...input, sessionToken: token }, requestContext, AUTH_ERROR_CODES.SESSION_INVALID);
    const now = Number(this.now());
    const session = errorFromRepository(await this.repository.getSession({ sessionRef: identity.sessionRef, now }));
    await this.#assertStepUp(input, identity, session, now);
    const result = errorFromRepository(await this.repository.revokeUserSessions({ userId: session.user.id, now }));
    return Object.freeze({
      revoked: Number(result.revoked || 0),
      emailMasked: session.user.emailMask,
      browserClass: identity.context.userAgent || null
    });
  }

  ping() { return this.repository.ping(); }
  cleanup() { return this.repository.cleanup(Number(this.now())); }
  nextExpiry() { return this.repository.nextExpiry(Number(this.now())); }
}
