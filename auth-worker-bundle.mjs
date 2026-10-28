// cors-policy.mjs
var PRODUCTION_HOSTS = /* @__PURE__ */ new Set([
  "admissionhub.pages.dev",
  "admissionsky.pages.dev",
  "admission-gk.admissionhub.workers.dev"
]);
var allowedOrigin = (origin) => {
  if (!origin) return false;
  try {
    const url = new URL(origin);
    if (url.protocol !== "https:") return false;
    if (url.port) return false;
    return PRODUCTION_HOSTS.has(url.hostname.toLowerCase());
  } catch {
    return false;
  }
};
var corsHeaders = (request) => {
  const origin = request && request.headers && request.headers.get("Origin") || "";
  if (!origin || !allowedOrigin(origin)) return { Vary: "Origin" };
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Credentials": "true",
    Vary: "Origin"
  };
};

// auth-native/core/errors.mjs
var AUTH_ERROR_CODES = Object.freeze({
  INVALID_INPUT: "INVALID_INPUT",
  // A failed Turnstile check is not "bad input" any more than a weak password is:
  // reporting it as INVALID_INPUT told the student the form was wrong when the
  // real problem was the human check (owner report 2026-10-24).
  HUMAN_CHECK_FAILED: "HUMAN_CHECK_FAILED",
  CLIENT_UPDATE_REQUIRED: "CLIENT_UPDATE_REQUIRED",
  NOT_CONFIGURED: "NOT_CONFIGURED",
  RATE_LIMITED: "RATE_LIMITED",
  RESEND_COOLDOWN: "RESEND_COOLDOWN",
  OTP_INVALID: "OTP_INVALID",
  OTP_EXPIRED: "OTP_EXPIRED",
  OTP_LOCKED: "OTP_LOCKED",
  OTP_USED: "OTP_USED",
  INVALID_CREDENTIALS: "INVALID_CREDENTIALS",
  EMAIL_ALREADY_IN_USE: "EMAIL_ALREADY_IN_USE",
  DISPOSABLE_EMAIL: "DISPOSABLE_EMAIL",
  ACCOUNT_LINK_REQUIRED: "ACCOUNT_LINK_REQUIRED",
  ACCOUNT_CONFLICT: "ACCOUNT_CONFLICT",
  GOOGLE_UNAVAILABLE: "GOOGLE_UNAVAILABLE",
  TELEGRAM_VERIFICATION_UNAVAILABLE: "TELEGRAM_VERIFICATION_UNAVAILABLE",
  TELEGRAM_VERIFICATION_PENDING: "TELEGRAM_VERIFICATION_PENDING",
  TELEGRAM_VERIFICATION_INVALID: "TELEGRAM_VERIFICATION_INVALID",
  PASSKEY_UNAVAILABLE: "PASSKEY_UNAVAILABLE",
  PASSKEY_INVALID: "PASSKEY_INVALID",
  PASSKEY_NOT_FOUND: "PASSKEY_NOT_FOUND",
  PASSKEY_REGISTRATION_REQUIRED: "PASSKEY_REGISTRATION_REQUIRED",
  EMAIL_NOT_VERIFIED: "EMAIL_NOT_VERIFIED",
  WEAK_PASSWORD: "WEAK_PASSWORD",
  ACCOUNT_DISABLED: "ACCOUNT_DISABLED",
  ACCOUNT_STATE_INVALID: "ACCOUNT_STATE_INVALID",
  ACCOUNT_NOT_FOUND: "ACCOUNT_NOT_FOUND",
  SESSION_INVALID: "SESSION_INVALID",
  VERIFICATION_UNAVAILABLE: "VERIFICATION_UNAVAILABLE",
  BACKUP_UNAVAILABLE: "BACKUP_UNAVAILABLE",
  STEP_UP_REQUIRED: "STEP_UP_REQUIRED",
  CHALLENGE_INVALID: "CHALLENGE_INVALID",
  PROFILE_VERSION_CONFLICT: "PROFILE_VERSION_CONFLICT",
  PUBLIC_PROFILE_NOT_FOUND: "PUBLIC_PROFILE_NOT_FOUND",
  AUTH_PROVIDER_UNAVAILABLE: "AUTH_PROVIDER_UNAVAILABLE",
  DELIVERY_UNAVAILABLE: "DELIVERY_UNAVAILABLE",
  STORAGE_UNAVAILABLE: "STORAGE_UNAVAILABLE",
  INTERNAL_ERROR: "INTERNAL_ERROR"
});
var DEFAULTS = Object.freeze({
  [AUTH_ERROR_CODES.INVALID_INPUT]: Object.freeze({ status: 400, message: "তথ্যটি সঠিকভাবে লিখুন।" }),
  [AUTH_ERROR_CODES.HUMAN_CHECK_FAILED]: Object.freeze({ status: 400, message: "মানব যাচাই সম্পন্ন হয়নি। পেজটি একবার রিফ্রেশ করে আবার চেষ্টা করুন।" }),
  [AUTH_ERROR_CODES.CLIENT_UPDATE_REQUIRED]: Object.freeze({ status: 409, message: "Admission Hub-এর নতুন সংস্করণ চালু হয়েছে, পেজটি একবার রিফ্রেশ করে আবার চেষ্টা করুন।" }),
  [AUTH_ERROR_CODES.NOT_CONFIGURED]: Object.freeze({ status: 503, message: "অ্যাকাউন্ট সেবা এখনো প্রস্তুত নয়।" }),
  [AUTH_ERROR_CODES.RATE_LIMITED]: Object.freeze({ status: 429, message: "অনেকবার চেষ্টা হয়েছে, একটু পরে আবার চেষ্টা করুন।" }),
  [AUTH_ERROR_CODES.RESEND_COOLDOWN]: Object.freeze({ status: 429, message: "নতুন কোড পাঠাতে একটু অপেক্ষা করুন।" }),
  [AUTH_ERROR_CODES.OTP_INVALID]: Object.freeze({ status: 401, message: "কোডটি সঠিক নয়।" }),
  [AUTH_ERROR_CODES.OTP_EXPIRED]: Object.freeze({ status: 410, message: "কোডের সময় শেষ হয়েছে, নতুন কোড নিন।" }),
  [AUTH_ERROR_CODES.OTP_LOCKED]: Object.freeze({ status: 429, message: "অনেকবার ভুল কোড দেওয়া হয়েছে, অপেক্ষার সময় শেষ হলে নতুন কোড নিন।" }),
  [AUTH_ERROR_CODES.OTP_USED]: Object.freeze({ status: 409, message: "এই কোডটি ইতিমধ্যে ব্যবহার হয়েছে।" }),
  [AUTH_ERROR_CODES.INVALID_CREDENTIALS]: Object.freeze({ status: 401, message: "ইমেইল বা পাসওয়ার্ড সঠিক নয়।" }),
  [AUTH_ERROR_CODES.EMAIL_ALREADY_IN_USE]: Object.freeze({ status: 409, message: "এই ইমেইলে অ্যাকাউন্ট আছে, লগইন করুন।" }),
  [AUTH_ERROR_CODES.DISPOSABLE_EMAIL]: Object.freeze({ status: 400, message: "এই ইমেইলে কোড পাঠানো সম্ভব না। শুধু Gmail, Yahoo, iCloud, Hotmail বা Outlook ইমেইল ব্যবহার করো।" }),
  [AUTH_ERROR_CODES.ACCOUNT_LINK_REQUIRED]: Object.freeze({ status: 409, message: "একই ইমেইলের আগের অ্যাকাউন্টে একবার পাসওয়ার্ড দিয়ে Google যুক্ত করুন।" }),
  [AUTH_ERROR_CODES.ACCOUNT_CONFLICT]: Object.freeze({ status: 409, message: "এই পরিচয়টি অন্য একটি অ্যাকাউন্টের সঙ্গে যুক্ত, নিরাপত্তার জন্য লগইন বন্ধ রাখা হয়েছে।" }),
  [AUTH_ERROR_CODES.GOOGLE_UNAVAILABLE]: Object.freeze({ status: 503, message: "Google দিয়ে প্রবেশ এখন পাওয়া যাচ্ছে না, ইমেইল দিয়ে চেষ্টা করুন।" }),
  [AUTH_ERROR_CODES.TELEGRAM_VERIFICATION_UNAVAILABLE]: Object.freeze({ status: 503, message: "Telegram যাচাই এখন পাওয়া যাচ্ছে না, ইমেইল যাচাই ব্যবহার করুন।" }),
  [AUTH_ERROR_CODES.TELEGRAM_VERIFICATION_PENDING]: Object.freeze({ status: 409, message: "Telegram-এ পরিচয় নিশ্চিত হওয়ার অপেক্ষা চলছে।" }),
  [AUTH_ERROR_CODES.TELEGRAM_VERIFICATION_INVALID]: Object.freeze({ status: 401, message: "অ্যাকাউন্ট যাচাইয়ের session সঠিক নয় বা সময় শেষ হয়েছে, আবার লগইন অথবা সাইনআপ করুন।" }),
  [AUTH_ERROR_CODES.PASSKEY_UNAVAILABLE]: Object.freeze({ status: 503, message: "এই ডিভাইসে Passkey এখন পাওয়া যাচ্ছে না, অন্য পদ্ধতি ব্যবহার করুন।" }),
  [AUTH_ERROR_CODES.PASSKEY_INVALID]: Object.freeze({ status: 401, message: "Passkey যাচাই হয়নি, আবার চেষ্টা করুন।" }),
  [AUTH_ERROR_CODES.PASSKEY_NOT_FOUND]: Object.freeze({ status: 404, message: "এই Passkey-এর সঙ্গে কোনো অ্যাকাউন্ট পাওয়া যায়নি।" }),
  [AUTH_ERROR_CODES.PASSKEY_REGISTRATION_REQUIRED]: Object.freeze({ status: 409, message: "আগে অ্যাকাউন্টে ঢুকে এই ডিভাইসে Passkey যোগ করুন।" }),
  [AUTH_ERROR_CODES.EMAIL_NOT_VERIFIED]: Object.freeze({ status: 403, message: "ইমেইলে পাঠানো যাচাইয়ের লিংকে ক্লিক করে তারপর লগইন করুন।" }),
  [AUTH_ERROR_CODES.WEAK_PASSWORD]: Object.freeze({ status: 400, message: "কমপক্ষে ৮ অক্ষরের শক্তিশালী পাসওয়ার্ড দিন।" }),
  [AUTH_ERROR_CODES.ACCOUNT_DISABLED]: Object.freeze({ status: 403, message: "এই অ্যাকাউন্টটি এখন ব্যবহার করা যাচ্ছে না।" }),
  [AUTH_ERROR_CODES.ACCOUNT_STATE_INVALID]: Object.freeze({ status: 409, message: "অ্যাকাউন্টের অবস্থা পরিবর্তন করা যায়নি, আবার চেষ্টা করুন।" }),
  [AUTH_ERROR_CODES.ACCOUNT_NOT_FOUND]: Object.freeze({ status: 404, message: "অ্যাকাউন্টটি খুঁজে পাওয়া যায়নি।" }),
  [AUTH_ERROR_CODES.SESSION_INVALID]: Object.freeze({ status: 401, message: "নিরাপদ সেশন পাওয়া যায়নি।" }),
  [AUTH_ERROR_CODES.VERIFICATION_UNAVAILABLE]: Object.freeze({ status: 503, message: "যাচাইয়ের ইমেইল এখন পাঠানো যাচ্ছে না, একটু পরে আবার চেষ্টা করুন।" }),
  [AUTH_ERROR_CODES.BACKUP_UNAVAILABLE]: Object.freeze({ status: 503, message: "বিকল্প যাচাই এখন পাওয়া যাচ্ছে না, অন্য পদ্ধতি ব্যবহার করুন।" }),
  [AUTH_ERROR_CODES.STEP_UP_REQUIRED]: Object.freeze({ status: 409, message: "এই গুরুত্বপূর্ণ কাজটি নিশ্চিত করতে একটি fresh security verification দরকার।" }),
  [AUTH_ERROR_CODES.CHALLENGE_INVALID]: Object.freeze({ status: 409, message: "Security verification সঠিক নয় বা সময় শেষ হয়ে গেছে, আবার চেষ্টা করুন।" }),
  [AUTH_ERROR_CODES.PROFILE_VERSION_CONFLICT]: Object.freeze({ status: 409, message: "Profile-এ একই সময়ে অন্য জায়গা থেকে পরিবর্তন হয়েছে, আবার দেখে সংরক্ষণ করুন।" }),
  [AUTH_ERROR_CODES.PUBLIC_PROFILE_NOT_FOUND]: Object.freeze({ status: 404, message: "এই public profile পাওয়া যায়নি।" }),
  [AUTH_ERROR_CODES.AUTH_PROVIDER_UNAVAILABLE]: Object.freeze({ status: 503, message: "অ্যাকাউন্ট সেবা সাময়িকভাবে পাওয়া যাচ্ছে না, একটু পরে চেষ্টা করুন।" }),
  [AUTH_ERROR_CODES.DELIVERY_UNAVAILABLE]: Object.freeze({ status: 503, message: "ইমেইল এখন সাময়িকভাবে পাঠানো যাচ্ছে না, একটু পরে চেষ্টা করুন।" }),
  [AUTH_ERROR_CODES.STORAGE_UNAVAILABLE]: Object.freeze({ status: 503, message: "অ্যাকাউন্ট সেবা সাময়িকভাবে ব্যস্ত, একটু পরে চেষ্টা করুন।" }),
  [AUTH_ERROR_CODES.INTERNAL_ERROR]: Object.freeze({ status: 500, message: "অপ্রত্যাশিত সমস্যা হয়েছে, আবার চেষ্টা করুন।" })
});
var NativeAuthError = class extends Error {
  constructor(code, options = {}) {
    const fallback = DEFAULTS[code] || DEFAULTS[AUTH_ERROR_CODES.INTERNAL_ERROR];
    super(String(options.message || fallback.message));
    this.name = "NativeAuthError";
    this.code = DEFAULTS[code] ? code : AUTH_ERROR_CODES.INTERNAL_ERROR;
    this.status = Number(options.status || fallback.status);
    this.retryAfter = Math.max(0, Math.ceil(Number(options.retryAfter || 0)));
    this.safe = true;
  }
  toPublic() {
    return Object.freeze({
      code: this.code,
      message: this.message,
      ...this.retryAfter ? { retryAfter: this.retryAfter } : {}
    });
  }
};
var failAuth = (code, options) => {
  throw new NativeAuthError(code, options);
};
function asNativeAuthError(error) {
  if (error instanceof NativeAuthError) return error;
  return new NativeAuthError(AUTH_ERROR_CODES.INTERNAL_ERROR);
}

// auth-native/core/crypto.mjs
var encoder = new TextEncoder();
var EMAIL_LOCAL = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+$/;
var DOMAIN_LABEL = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;
function normalizeAuthEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  if (!email || email.length > 254 || email.includes("..")) failAuth(AUTH_ERROR_CODES.INVALID_INPUT);
  const at = email.lastIndexOf("@");
  if (at <= 0 || at !== email.indexOf("@")) failAuth(AUTH_ERROR_CODES.INVALID_INPUT);
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (local.length > 64 || local.startsWith(".") || local.endsWith(".") || !EMAIL_LOCAL.test(local)) failAuth(AUTH_ERROR_CODES.INVALID_INPUT);
  const labels = domain.split(".");
  if (labels.length < 2 || labels.some((label) => !DOMAIN_LABEL.test(label))) failAuth(AUTH_ERROR_CODES.INVALID_INPUT);
  if (labels.at(-1).length < 2 || labels.at(-1).length > 63) failAuth(AUTH_ERROR_CODES.INVALID_INPUT);
  return email;
}
var bytesToBase64Url = (bytes) => {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 32768) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(bytes.length, offset + 32768)));
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
};
function randomToken(byteLength = 32, cryptoImpl = globalThis.crypto) {
  const size = Math.max(16, Math.min(64, Number(byteLength) || 32));
  if (!cryptoImpl || typeof cryptoImpl.getRandomValues !== "function") failAuth(AUTH_ERROR_CODES.NOT_CONFIGURED);
  const bytes = new Uint8Array(size);
  cryptoImpl.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}
function constantTimeEqual(left, right) {
  const a = String(left || "");
  const b = String(right || "");
  const length = Math.max(a.length, b.length);
  let mismatch = a.length ^ b.length;
  for (let index = 0; index < length; index += 1) {
    mismatch |= (a.charCodeAt(index % Math.max(1, a.length)) || 0) ^ (b.charCodeAt(index % Math.max(1, b.length)) || 0);
  }
  return mismatch === 0;
}

// auth-native/core/security-config.mjs
var SECURITY_POLICY_VERSION = "security-policy-v1";
var SECURITY_RISK_LEVELS = Object.freeze(["LOW", "NORMAL", "ELEVATED", "HIGH", "CRITICAL"]);
var SECURITY_RISK_RANK = Object.freeze({
  LOW: 0,
  NORMAL: 1,
  ELEVATED: 2,
  HIGH: 3,
  CRITICAL: 4
});
var SECURITY_CHALLENGE_TTL_MS = 15 * 60 * 1e3;
var SECURITY_CHALLENGE_MAX_ATTEMPTS = 5;
var SECURITY_CHALLENGE_METHODS_V1 = Object.freeze(["email", "telegram", "passkey"]);
var SECURITY_TRUST_TTL_MS = 30 * 24 * 60 * 60 * 1e3;
var SECURITY_TRUST_MAX_DEVICES_PER_USER = 10;
var SECURITY_FAILED_LOGIN_WINDOW_MS = 15 * 60 * 1e3;
var SECURITY_COOLDOWN_THRESHOLD_FAILURES = 5;
var SECURITY_COOLDOWN_STEPS_MS = Object.freeze([
  5 * 60 * 1e3,
  // 5 min
  15 * 60 * 1e3,
  // 15 min
  60 * 60 * 1e3
  // 60 min, ceiling; never permanent
]);
var SECURITY_RISK_THRESHOLDS = Object.freeze({
  failedLoginElevatedAt: 3,
  // 3+ failed logins in window -> ELEVATED signal
  failedLoginHighAt: 8,
  // 8+ -> HIGH signal
  rapidAuthRequestsWindowMs: 60 * 1e3,
  rapidAuthRequestsHighAt: 20
  // 20+ auth requests / IP / minute -> HIGH signal
});
var SECURITY_RISK_SESSION_POLICY = Object.freeze({
  LOW: { sessionTtlMs: 30 * 24 * 60 * 60 * 1e3, trustOffer: true, challenge: null },
  NORMAL: { sessionTtlMs: 30 * 24 * 60 * 60 * 1e3, trustOffer: true, challenge: null },
  ELEVATED: { sessionTtlMs: 30 * 24 * 60 * 60 * 1e3, trustOffer: true, challenge: "new-device" },
  HIGH: { sessionTtlMs: 24 * 60 * 60 * 1e3, trustOffer: false, challenge: "step-up" },
  CRITICAL: { sessionTtlMs: null, trustOffer: false, challenge: null, block: true }
});
var SECURITY_PURPOSES = Object.freeze({
  STEP_UP: "step-up",
  NEW_DEVICE: "new-device",
  RECOVERY: "recovery",
  DEVICE_REVOCATION: "device-revoke"
});
var SECURITY_FAILSAFE_POLICY = Object.freeze({
  lowRisk: "proceed",
  // normal action under normal auth
  sensitive: "challenge",
  // sensitive action requires stronger verification
  critical: "block"
  // critical action is temporarily blocked + recovery path
});
var SECURITY_STEP_UP_RECENT_SESSION_MS = 5 * 60 * 1e3;
var SECURITY_ACTION_CLASSES = Object.freeze(["lowRisk", "sensitive", "critical"]);
var SECURITY_CONFIG = Object.freeze({
  policyVersion: SECURITY_POLICY_VERSION,
  riskLevels: SECURITY_RISK_LEVELS,
  challengeTtlMs: SECURITY_CHALLENGE_TTL_MS,
  challengeMaxAttempts: SECURITY_CHALLENGE_MAX_ATTEMPTS,
  challengeMethods: SECURITY_CHALLENGE_METHODS_V1,
  trustTtlMs: SECURITY_TRUST_TTL_MS,
  trustMaxDevicesPerUser: SECURITY_TRUST_MAX_DEVICES_PER_USER,
  failedLoginWindowMs: SECURITY_FAILED_LOGIN_WINDOW_MS,
  cooldownThresholdFailures: SECURITY_COOLDOWN_THRESHOLD_FAILURES,
  cooldownStepsMs: SECURITY_COOLDOWN_STEPS_MS,
  riskThresholds: SECURITY_RISK_THRESHOLDS,
  riskSessionPolicy: SECURITY_RISK_SESSION_POLICY,
  purposes: SECURITY_PURPOSES,
  failSafePolicy: SECURITY_FAILSAFE_POLICY,
  actionClasses: SECURITY_ACTION_CLASSES,
  stepUpRecentSessionMs: SECURITY_STEP_UP_RECENT_SESSION_MS
});
function resolveSecurityConfig(overrideRaw = "") {
  if (!overrideRaw) return SECURITY_CONFIG;
  try {
    const parsed = JSON.parse(String(overrideRaw));
    if (!parsed || typeof parsed !== "object") return SECURITY_CONFIG;
    const base = { ...SECURITY_CONFIG };
    for (const key of Object.keys(base)) {
      if (!(key in parsed)) continue;
      const value = parsed[key];
      if (typeof base[key] === "number") {
        if (!Number.isFinite(value) || value <= 0) return SECURITY_CONFIG;
        base[key] = value;
      } else if (typeof base[key] === "string") {
        if (typeof value !== "string" || !value) return SECURITY_CONFIG;
        base[key] = value;
      }
    }
    return Object.freeze(base);
  } catch {
    return SECURITY_CONFIG;
  }
}

// auth-native/core/security-policy.mjs
function rank(level) {
  return SECURITY_RISK_RANK[level] ?? 0;
}
function evaluateRisk(signals = {}, config = resolveSecurityConfig()) {
  const t = config.riskThresholds;
  const facts = [];
  const behaviors = [];
  if (signals.accountState === "suspended" || signals.accountState === "deactivated") {
    facts.push("account-disabled");
  } else if (signals.accountState === "restricted") {
    facts.push("account-restricted");
  }
  if (signals.recoveryActive === true) facts.push("recovery-active");
  const failed = Math.max(0, Number(signals.failedLogins) || 0);
  if (failed >= t.failedLoginHighAt) behaviors.push("failed-logins-high");
  else if (failed >= t.failedLoginElevatedAt) behaviors.push("failed-logins-elevated");
  if (signals.rapidRequests >= t.rapidAuthRequestsHighAt) behaviors.push("rapid-requests");
  if (signals.newDevice === true) behaviors.push("new-device");
  if (signals.unverifiedAccount === true) behaviors.push("unverified-account");
  let level = "LOW";
  if (facts.includes("account-disabled")) {
    level = "CRITICAL";
  } else {
    let behaviorRank = 0;
    for (const signal of behaviors) {
      const signalRank = signal === "unverified-account" ? rank("NORMAL") : rank("ELEVATED");
      behaviorRank = Math.max(behaviorRank, signalRank);
    }
    if (behaviors.length >= 2) behaviorRank = Math.min(behaviorRank + 1, rank("HIGH"));
    if (facts.length > 0 && behaviors.length > 0) behaviorRank = Math.max(behaviorRank, rank("HIGH"));
    const levels = [...SECURITY_RISK_LEVELS];
    level = behaviors.length > 0 || facts.length > 0 ? levels[Math.min(behaviorRank, levels.length - 1)] : "NORMAL";
  }
  const actions = policyActions(level, config);
  return Object.freeze({
    level,
    reasons: Object.freeze([...facts, ...behaviors]),
    actions,
    policyVersion: config.policyVersion
  });
}
function policyActions(level, config) {
  const policy = config.riskSessionPolicy[level] || config.riskSessionPolicy.NORMAL;
  const challenge = policy.challenge || null;
  return Object.freeze({
    // A pending challenge always gates the action: the caller may only
    // proceed after the challenge is verified for the matching purpose.
    proceed: policy.block !== true && challenge === null,
    challenge,
    block: policy.block === true,
    sessionTtlMs: policy.sessionTtlMs || null,
    trustOffer: policy.trustOffer === true,
    recoveryPath: policy.block === true
  });
}

// auth-native/core/webauthn.mjs
var encoder2 = new TextEncoder();
var decoder = new TextDecoder("utf-8", { fatal: true });
var MAX_ATTESTATION_BYTES = 16 * 1024;

// auth-native/core/secret-vault.mjs
var encoder3 = new TextEncoder();
var decoder2 = new TextDecoder("utf-8", { fatal: true });

// auth-native/core/auth-engine.mjs
var AUTH_NATIVE_VERSION = "firebase-canonical-auth-v3";
var SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1e3;
var REMEMBER_OFF_TTL_MS = 7 * 24 * 60 * 60 * 1e3;
var FIREBASE_VERIFICATION_RESEND_COOLDOWN_MS = 60 * 1e3;
var PASSKEY_CHALLENGE_TTL_MS = 5 * 60 * 1e3;
var PASSKEY_TICKET_TTL_MS = 60 * 1e3;
var ACCOUNT_VERIFICATION_TICKET_TTL_MS = 15 * 60 * 1e3;
var PASSKEY_RP_IDS = Object.freeze(["admissionhub.pages.dev", "admissionsky.pages.dev"]);
var SECURITY_RISK_SCOPES = Object.freeze({
  loginFailure: Object.freeze({ scope: "security-login-fail-email-15m", windowMs: 15 * 60 * 1e3 }),
  rapidAuthIp: Object.freeze({ scope: "security-auth-ip-60s", windowMs: 60 * 1e3 })
});
var PASSKEY_REGISTRATION_LIMITS = Object.freeze([
  Object.freeze({ scope: "passkey-register-user-hour", source: "email", limit: 6, windowMs: 60 * 60 * 1e3 }),
  Object.freeze({ scope: "passkey-register-ip-hour", source: "ip", limit: 20, windowMs: 60 * 60 * 1e3 }),
  Object.freeze({ scope: "passkey-register-device-hour", source: "device", limit: 12, windowMs: 60 * 60 * 1e3 })
]);
var PASSKEY_LOGIN_LIMITS = Object.freeze([
  Object.freeze({ scope: "passkey-login-ip-15m", source: "ip", limit: 60, windowMs: 15 * 60 * 1e3 }),
  Object.freeze({ scope: "passkey-login-device-15m", source: "device", limit: 30, windowMs: 15 * 60 * 1e3 }),
  Object.freeze({ scope: "passkey-login-global-minute", source: "global", limit: 180, windowMs: 60 * 1e3 })
]);
var ACCOUNT_VERIFICATION_LIMITS = Object.freeze([
  Object.freeze({ scope: "telegram-account-verify-email-day", source: "email", limit: 5, windowMs: 24 * 60 * 60 * 1e3 }),
  Object.freeze({ scope: "telegram-account-verify-ip-hour", source: "ip", limit: 20, windowMs: 60 * 60 * 1e3 }),
  Object.freeze({ scope: "telegram-account-verify-device-hour", source: "device", limit: 10, windowMs: 60 * 60 * 1e3 }),
  Object.freeze({ scope: "telegram-account-verify-global-minute", source: "global", limit: 120, windowMs: 60 * 1e3 })
]);
var FIREBASE_OPERATION_LIMITS = Object.freeze({
  signup: Object.freeze([
    Object.freeze({ scope: "firebase-verification-email-minute", source: "email", limit: 1, windowMs: FIREBASE_VERIFICATION_RESEND_COOLDOWN_MS }),
    Object.freeze({ scope: "firebase-verification-email-day", source: "email", limit: 8, windowMs: 24 * 60 * 60 * 1e3 }),
    Object.freeze({ scope: "firebase-verification-ip-hour", source: "ip", limit: 20, windowMs: 60 * 60 * 1e3 }),
    Object.freeze({ scope: "firebase-verification-device-hour", source: "device", limit: 10, windowMs: 60 * 60 * 1e3 })
  ]),
  "verification-resend": Object.freeze([
    Object.freeze({ scope: "firebase-verification-email-minute", source: "email", limit: 1, windowMs: FIREBASE_VERIFICATION_RESEND_COOLDOWN_MS }),
    Object.freeze({ scope: "firebase-verification-email-day", source: "email", limit: 8, windowMs: 24 * 60 * 60 * 1e3 }),
    Object.freeze({ scope: "firebase-verification-ip-hour", source: "ip", limit: 20, windowMs: 60 * 60 * 1e3 }),
    Object.freeze({ scope: "firebase-verification-device-hour", source: "device", limit: 10, windowMs: 60 * 60 * 1e3 })
  ]),
  "verification-send": Object.freeze([
    Object.freeze({ scope: "firebase-verification-global-day", source: "global", limit: 1e3, windowMs: 24 * 60 * 60 * 1e3 })
  ]),
  login: Object.freeze([
    Object.freeze({ scope: "firebase-login-email-15m", source: "email", limit: 12, windowMs: 15 * 60 * 1e3 }),
    Object.freeze({ scope: "firebase-login-ip-15m", source: "ip", limit: 60, windowMs: 15 * 60 * 1e3 }),
    Object.freeze({ scope: "firebase-login-device-15m", source: "device", limit: 30, windowMs: 15 * 60 * 1e3 }),
    Object.freeze({ scope: SECURITY_RISK_SCOPES.rapidAuthIp.scope, source: "ip", limit: 1e5, windowMs: SECURITY_RISK_SCOPES.rapidAuthIp.windowMs })
  ]),
  google: Object.freeze([
    Object.freeze({ scope: "firebase-google-ip-15m", source: "ip", limit: 60, windowMs: 15 * 60 * 1e3 }),
    Object.freeze({ scope: "firebase-google-device-15m", source: "device", limit: 30, windowMs: 15 * 60 * 1e3 }),
    Object.freeze({ scope: "firebase-google-global-minute", source: "global", limit: 180, windowMs: 60 * 1e3 })
  ]),
  // The /facebook handler asks for a 'facebook' slot before it calls Firebase.
  // Without an entry here consumeFirebaseOperation throws INVALID_INPUT and the
  // whole sign-in fails before Facebook is ever reached (owner bug 2026-10-14).
  facebook: Object.freeze([
    Object.freeze({ scope: "firebase-facebook-ip-15m", source: "ip", limit: 60, windowMs: 15 * 60 * 1e3 }),
    Object.freeze({ scope: "firebase-facebook-device-15m", source: "device", limit: 30, windowMs: 15 * 60 * 1e3 }),
    Object.freeze({ scope: "firebase-facebook-global-minute", source: "global", limit: 180, windowMs: 60 * 1e3 })
  ]),
  // POST /telegram/login (owner 2026-10-18) asks for its own slot.
  "telegram-login": Object.freeze([
    Object.freeze({ scope: "firebase-telegram-ip-15m", source: "ip", limit: 60, windowMs: 15 * 60 * 1e3 }),
    Object.freeze({ scope: "firebase-telegram-device-15m", source: "device", limit: 30, windowMs: 15 * 60 * 1e3 }),
    Object.freeze({ scope: "firebase-telegram-global-minute", source: "global", limit: 180, windowMs: 60 * 1e3 })
  ]),
  "password-reset": Object.freeze([
    Object.freeze({ scope: "firebase-reset-email-hour", source: "email", limit: 3, windowMs: 60 * 60 * 1e3 }),
    Object.freeze({ scope: "firebase-reset-email-day", source: "email", limit: 8, windowMs: 24 * 60 * 60 * 1e3 }),
    Object.freeze({ scope: "firebase-reset-ip-hour", source: "ip", limit: 20, windowMs: 60 * 60 * 1e3 }),
    Object.freeze({ scope: "firebase-reset-device-hour", source: "device", limit: 10, windowMs: 60 * 60 * 1e3 }),
    Object.freeze({ scope: "firebase-reset-global-day", source: "global", limit: 1e3, windowMs: 24 * 60 * 60 * 1e3 })
  ]),
  "verification-status": Object.freeze([
    Object.freeze({ scope: "firebase-verification-status-ip-15m", source: "ip", limit: 60, windowMs: 15 * 60 * 1e3 }),
    Object.freeze({ scope: "firebase-verification-status-device-15m", source: "device", limit: 30, windowMs: 15 * 60 * 1e3 })
  ]),
  "pending-profile-write": Object.freeze([
    Object.freeze({ scope: "firebase-pending-profile-ip-hour", source: "ip", limit: 120, windowMs: 60 * 60 * 1e3 }),
    Object.freeze({ scope: "firebase-pending-profile-device-hour", source: "device", limit: 20, windowMs: 60 * 60 * 1e3 }),
    Object.freeze({ scope: "firebase-pending-profile-global-minute", source: "global", limit: 1e3, windowMs: 60 * 1e3 })
  ]),
  "profile-write": Object.freeze([
    Object.freeze({ scope: "firebase-profile-email-day", source: "email", limit: 30, windowMs: 24 * 60 * 60 * 1e3 }),
    Object.freeze({ scope: "firebase-profile-device-day", source: "device", limit: 60, windowMs: 24 * 60 * 60 * 1e3 }),
    Object.freeze({ scope: "firebase-profile-ip-hour", source: "ip", limit: 300, windowMs: 60 * 60 * 1e3 }),
    Object.freeze({ scope: "firebase-profile-global-minute", source: "global", limit: 1e3, windowMs: 60 * 1e3 })
  ]),
  // Phase 7, profile patch + avatar + public reads.
  "profile-patch": Object.freeze([
    Object.freeze({ scope: "firebase-profile-email-day", source: "email", limit: 30, windowMs: 24 * 60 * 60 * 1e3 }),
    Object.freeze({ scope: "firebase-profile-device-day", source: "device", limit: 60, windowMs: 24 * 60 * 60 * 1e3 }),
    Object.freeze({ scope: "firebase-profile-ip-hour", source: "ip", limit: 300, windowMs: 60 * 60 * 1e3 }),
    Object.freeze({ scope: "firebase-profile-global-minute", source: "global", limit: 1e3, windowMs: 60 * 1e3 })
  ]),
  "avatar-write": Object.freeze([
    Object.freeze({ scope: "firebase-avatar-email-day", source: "email", limit: 10, windowMs: 24 * 60 * 60 * 1e3 }),
    Object.freeze({ scope: "firebase-avatar-device-day", source: "device", limit: 20, windowMs: 24 * 60 * 60 * 1e3 }),
    Object.freeze({ scope: "firebase-avatar-ip-hour", source: "ip", limit: 60, windowMs: 60 * 60 * 1e3 }),
    Object.freeze({ scope: "firebase-avatar-global-minute", source: "global", limit: 100, windowMs: 60 * 1e3 })
  ]),
  "public-profile-read": Object.freeze([
    Object.freeze({ scope: "firebase-publicprofile-ip-15m", source: "ip", limit: 60, windowMs: 15 * 60 * 1e3 }),
    Object.freeze({ scope: "firebase-publicprofile-device-15m", source: "device", limit: 30, windowMs: 15 * 60 * 1e3 }),
    Object.freeze({ scope: "firebase-publicprofile-global-minute", source: "global", limit: 600, windowMs: 60 * 1e3 })
  ])
});
var requiredRepositoryMethods = Object.freeze([
  "consumeLimits",
  "establishExternalSession",
  "getExternalSession",
  "getSession",
  "revokeSession",
  "revokeUserSessions",
  "getAccountState",
  "setAccountState",
  "identitySnapshot",
  "listLinkedIdentities",
  "beginFirebaseAccountVerification",
  "getFirebaseAccountVerification",
  "getFirebaseVerificationRecipientName",
  "completeFirebaseAccountVerification",
  "getFirebaseIdentity",
  "savePendingProfile",
  "saveProfile",
  "getProfile",
  "beginPasskeyRegistration",
  "getPasskeyRegistrationChallenge",
  "finishPasskeyRegistration",
  "beginPasskeyAuthentication",
  "getPasskeyAuthenticationMaterial",
  "issuePasskeyTicket",
  "completePasskeySession",
  "getPasskeyStatus",
  "removePasskey",
  "isDeviceTrusted",
  "registerTrustedDevice",
  "revokeTrustedDevice",
  "listTrustedDevices",
  "getLoginRiskSignals",
  "ping",
  "cleanup",
  "nextExpiry"
]);
var AVATAR_MIME_MAGIC = Object.freeze({
  "image/jpeg": Object.freeze([255, 216, 255]),
  "image/png": Object.freeze([137, 80, 78, 71]),
  "image/webp": Object.freeze([82, 73, 70, 70])
});
var AVATAR_MAX_BYTES = 2 * 1024 * 1024;

// email-policy.js
var DISPOSABLE_DOMAINS = Object.freeze([
  // Dedicated temporary-mail services.
  "temp-mail.org",
  "tempmail.com",
  "tempmail.net",
  "tempmail.dev",
  "tempmailo.com",
  "tempmail.plus",
  "temp-mail.io",
  "tempmailaddress.com",
  "10minutemail.com",
  "10minutemail.net",
  "10minutemail.org",
  "10minemail.com",
  "20minutemail.com",
  "guerrillamail.com",
  "guerrillamail.net",
  "guerrillamail.org",
  "guerrillamail.de",
  "sharklasers.com",
  "grr.la",
  "guerrillamailblock.com",
  "spam4.me",
  "mailinator.com",
  "mailinator.net",
  "mailinator2.com",
  "notmailinator.com",
  "yopmail.com",
  "yopmail.fr",
  "yopmail.net",
  "cool.fr.nf",
  "jetable.org",
  "trashmail.com",
  "trashmail.net",
  "trashmail.org",
  "trashmail.de",
  "trash-mail.com",
  "throwawaymail.com",
  "throwaway.email",
  "getnada.com",
  "nada.email",
  "dispostable.com",
  "maildrop.cc",
  "mailnesia.com",
  "mailcatch.com",
  "mytemp.email",
  "moakt.com",
  "tempr.email",
  "discard.email",
  "discardmail.com",
  "fakeinbox.com",
  "fakemail.net",
  "mail-temporaire.fr",
  "emailondeck.com",
  "mohmal.com",
  "mohmal.im",
  "luxusmail.org",
  "emailfake.com",
  "crazymailing.com",
  "generator.email",
  "tempinbox.com",
  "tempinbox.co",
  "spamgourmet.com",
  "mailmetrash.com",
  "mailsac.com",
  "inboxkitten.com",
  "harakirimail.com",
  "mailforspam.com",
  "tempmailer.com",
  "tempmailer.de",
  "tempemail.net",
  "burnermail.io",
  "anonaddy.com",
  "33mail.com",
  "mailpoof.com",
  "smailpro.com",
  "vomoto.com",
  "eyepaste.com",
  "1secmail.com",
  "1secmail.net",
  "1secmail.org",
  "1secmail.ru",
  "tuta.io",
  "tempmail.email",
  "tempmailbox.net",
  // Mailbox providers whose signup needs no verification, so they are used the
  // same way as a throwaway inbox.
  "mail.ru",
  "bk.ru",
  "inbox.ru",
  "list.ru",
  "internet.ru"
]);
function emailDomain(email) {
  const value = String(email || "").trim().toLowerCase();
  const at = value.lastIndexOf("@");
  if (at < 0 || at === value.length - 1) return "";
  return value.slice(at + 1).replace(/\.+$/, "");
}
var ALLOWED_EMAIL_DOMAINS = Object.freeze(["gmail.com", "yahoo.com", "icloud.com", "hotmail.com", "outlook.com"]);
function isDisposableEmail(email) {
  const domain = emailDomain(email);
  if (!domain) return false;
  return !ALLOWED_EMAIL_DOMAINS.includes(domain);
}

// auth-native/providers/firebase-auth.mjs
var IDENTITY_TOOLKIT = "https://identitytoolkit.googleapis.com/v1";
var SECURE_TOKEN = "https://securetoken.googleapis.com/v1/token";
var GOOGLE_USERINFO = "https://www.googleapis.com/oauth2/v3/userinfo";
var DEFAULT_CONTINUE_URL = "https://admissionsky.pages.dev/?firebaseVerified=1";
var FirebaseRequestError = class extends Error {
  constructor(reason = "FIREBASE_UNAVAILABLE", status = 0) {
    super(reason);
    this.name = "FirebaseRequestError";
    this.reason = String(reason || "FIREBASE_UNAVAILABLE").slice(0, 80);
    this.status = Number(status || 0);
  }
};
var errorReason = (payload) => String(payload?.error?.message || "FIREBASE_UNAVAILABLE").split(/\s*:\s*/, 1)[0].trim().toUpperCase().replace(/[^A-Z0-9_-]/g, "_").slice(0, 80) || "FIREBASE_UNAVAILABLE";
var validApiKey = (value) => /^[A-Za-z0-9_-]{20,128}$/.test(String(value || ""));
var validToken = (value) => typeof value === "string" && value.length >= 20 && value.length <= 4096 && !/[\r\n\u0000;]/.test(value);
var validSubject = (value) => typeof value === "string" && value.length >= 1 && value.length <= 256 && !/[\r\n\u0000]/.test(value);
var validGoogleClientId = (value) => /^\d{6,}-[A-Za-z0-9_-]{8,}\.apps\.googleusercontent\.com$/.test(String(value || ""));
var validFacebookAppId = (value) => /^\d{6,20}$/.test(String(value || ""));
var FACEBOOK_AUTH_HOST = "www.facebook.com";
var FACEBOOK_GRAPH = "https://graph.facebook.com";
function safeContinueUrl(value) {
  try {
    const url = new URL(String(value || DEFAULT_CONTINUE_URL));
    if (url.protocol !== "https:" || !["admissionhub.pages.dev", "admissionsky.pages.dev"].includes(url.hostname)) return DEFAULT_CONTINUE_URL;
    return url.href;
  } catch {
    return DEFAULT_CONTINUE_URL;
  }
}
function googleIdpFromProject(payload) {
  const entries = Array.isArray(payload?.idpConfig) ? payload.idpConfig : [];
  const row = entries.find((item) => {
    const provider = String(item?.provider || item?.providerId || "").toLowerCase();
    return provider === "google" || provider === "google.com";
  });
  const clientId = String(row?.clientId || "");
  return Object.freeze({
    enabled: row?.enabled === true,
    clientId: validGoogleClientId(clientId) ? clientId : ""
  });
}
function facebookIdpFromProject(payload) {
  const entries = Array.isArray(payload?.idpConfig) ? payload.idpConfig : [];
  const row = entries.find((item) => {
    const provider = String(item?.provider || item?.providerId || "").toLowerCase();
    return provider === "facebook" || provider === "facebook.com";
  });
  const clientId = String(row?.clientId || "");
  return Object.freeze({
    enabled: row?.enabled === true,
    clientId: validFacebookAppId(clientId) ? clientId : ""
  });
}
function googleCredential(input = {}) {
  const idToken = String(input.idToken || "").trim();
  const accessToken = String(input.accessToken || "").trim();
  if (Boolean(idToken) === Boolean(accessToken)) throw new FirebaseRequestError("INVALID_IDP_RESPONSE");
  const value = idToken || accessToken;
  if (!validToken(value)) throw new FirebaseRequestError("INVALID_IDP_RESPONSE");
  return Object.freeze({ kind: idToken ? "id_token" : "access_token", value });
}
var FirebaseEmailPasswordProvider = class {
  constructor({ apiKey, continueUrl, fetchImpl = globalThis.fetch } = {}) {
    this.apiKey = String(apiKey || "").trim();
    this.continueUrl = safeContinueUrl(continueUrl);
    this.fetch = typeof fetchImpl === "function" ? fetchImpl.bind(globalThis) : fetchImpl;
  }
  get configured() {
    return validApiKey(this.apiKey) && typeof this.fetch === "function";
  }
  async inspectProject() {
    if (!this.configured) throw new FirebaseRequestError("NOT_CONFIGURED");
    let response;
    try {
      response = await this.fetch(`${IDENTITY_TOOLKIT}/projects?key=${encodeURIComponent(this.apiKey)}`, {
        method: "GET",
        headers: { Accept: "application/json", "Cache-Control": "no-store" },
        redirect: "manual",
        signal: AbortSignal.timeout(12e3)
      });
    } catch {
      throw new FirebaseRequestError("NETWORK_ERROR");
    }
    let payload = {};
    try {
      payload = await response.json();
    } catch {
    }
    if (!response.ok) throw new FirebaseRequestError(errorReason(payload), response.status);
    const authorizedDomains = Array.isArray(payload?.authorizedDomains) ? payload.authorizedDomains.map((value) => String(value).toLowerCase()) : [];
    return Object.freeze({
      projectIdentified: typeof payload?.projectId === "string" && payload.projectId.length > 3,
      continueDomainAuthorized: authorizedDomains.includes(new URL(this.continueUrl).hostname),
      google: googleIdpFromProject(payload),
      facebook: facebookIdpFromProject(payload)
    });
  }
  async #post(url, body, { form = false } = {}) {
    if (!this.configured) throw new FirebaseRequestError("NOT_CONFIGURED");
    let response;
    try {
      response = await this.fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": form ? "application/x-www-form-urlencoded" : "application/json",
          Accept: "application/json",
          "Cache-Control": "no-store"
        },
        body: form ? String(body) : JSON.stringify(body),
        redirect: "manual",
        signal: AbortSignal.timeout(12e3)
      });
    } catch {
      throw new FirebaseRequestError("NETWORK_ERROR");
    }
    let payload = {};
    try {
      payload = await response.json();
    } catch {
    }
    if (!response.ok) throw new FirebaseRequestError(errorReason(payload), response.status);
    return payload;
  }
  async inspectGoogleProvider() {
    const payload = await this.#post(`${IDENTITY_TOOLKIT}/accounts:createAuthUri?key=${encodeURIComponent(this.apiKey)}`, {
      providerId: "google.com",
      continueUri: new URL(this.continueUrl).origin,
      customParameter: { prompt: "select_account" }
    });
    let authUri;
    try {
      authUri = new URL(String(payload?.authUri || ""));
    } catch {
      throw new FirebaseRequestError("INVALID_PROVIDER_RESPONSE");
    }
    const clientId = authUri.searchParams.get("client_id") || "";
    if (payload?.providerId !== "google.com" || !validToken(String(payload?.sessionId || "")) || authUri.protocol !== "https:" || authUri.hostname !== "accounts.google.com" || !validGoogleClientId(clientId)) {
      throw new FirebaseRequestError("INVALID_PROVIDER_RESPONSE");
    }
    return Object.freeze({ available: true, clientId });
  }
  async inspectFacebookProvider() {
    const payload = await this.#post(`${IDENTITY_TOOLKIT}/accounts:createAuthUri?key=${encodeURIComponent(this.apiKey)}`, {
      providerId: "facebook.com",
      continueUri: new URL(this.continueUrl).origin
    });
    let authUri;
    try {
      authUri = new URL(String(payload?.authUri || ""));
    } catch {
      throw new FirebaseRequestError("INVALID_PROVIDER_RESPONSE");
    }
    const appId = authUri.searchParams.get("client_id") || "";
    if (payload?.providerId !== "facebook.com" || !validToken(String(payload?.sessionId || "")) || authUri.protocol !== "https:" || authUri.hostname !== FACEBOOK_AUTH_HOST || !validFacebookAppId(appId)) {
      throw new FirebaseRequestError("INVALID_PROVIDER_RESPONSE");
    }
    return Object.freeze({ available: true, clientId: appId });
  }
  async inspectGoogleRedirectFlow(sessionId) {
    if (!validToken(sessionId)) throw new FirebaseRequestError("INVALID_SESSION_ID");
    const continueUri = "https://admissionsky.pages.dev/?googleAuthCallback=1";
    const payload = await this.#post(`${IDENTITY_TOOLKIT}/accounts:createAuthUri?key=${encodeURIComponent(this.apiKey)}`, {
      providerId: "google.com",
      continueUri,
      sessionId,
      authFlowType: "CODE_FLOW",
      customParameter: { prompt: "select_account" }
    });
    let authUri;
    let redirectUri;
    try {
      authUri = new URL(String(payload?.authUri || ""));
      redirectUri = new URL(String(authUri.searchParams.get("redirect_uri") || ""));
    } catch {
      throw new FirebaseRequestError("INVALID_PROVIDER_RESPONSE");
    }
    const clientId = authUri.searchParams.get("client_id") || "";
    const responseTypes = new Set(String(authUri.searchParams.get("response_type") || "").split(/\s+/).filter(Boolean));
    const callbackKind = redirectUri.protocol === "https:" && redirectUri.hostname.endsWith(".firebaseapp.com") && redirectUri.pathname === "/__/auth/handler" ? "firebase-handler" : redirectUri.origin === new URL(continueUri).origin ? "pages-origin" : "other";
    if (payload?.providerId !== "google.com" || payload?.sessionId !== sessionId || authUri.protocol !== "https:" || authUri.hostname !== "accounts.google.com" || !validGoogleClientId(clientId) || !responseTypes.has("code") || redirectUri.protocol !== "https:") throw new FirebaseRequestError("INVALID_PROVIDER_RESPONSE");
    let authorizationResponse;
    try {
      authorizationResponse = await this.fetch(authUri.href, {
        method: "GET",
        headers: { Accept: "text/html", "Cache-Control": "no-store" },
        redirect: "manual",
        signal: AbortSignal.timeout(12e3)
      });
    } catch {
      throw new FirebaseRequestError("NETWORK_ERROR");
    }
    const redirected = authorizationResponse.status >= 300 && authorizationResponse.status < 400;
    if (!authorizationResponse.ok && !redirected) throw new FirebaseRequestError("OAUTH_AUTHORIZATION_REQUEST_REJECTED", authorizationResponse.status);
    if (redirected) {
      let location;
      try {
        location = new URL(String(authorizationResponse.headers.get("Location") || ""), authUri);
      } catch {
        throw new FirebaseRequestError("INVALID_PROVIDER_RESPONSE");
      }
      if (location.protocol !== "https:" || location.hostname !== "accounts.google.com") {
        throw new FirebaseRequestError("INVALID_PROVIDER_RESPONSE");
      }
    }
    return Object.freeze({
      available: true,
      sessionBound: true,
      responseMode: "code",
      callbackKind,
      authorizationRequestAccepted: true
    });
  }
  async signUp(email, password) {
    const payload = await this.#post(`${IDENTITY_TOOLKIT}/accounts:signUp?key=${encodeURIComponent(this.apiKey)}`, {
      email,
      password,
      returnSecureToken: true
    });
    if (!validToken(payload?.idToken) || !validToken(payload?.refreshToken) || !validSubject(payload?.localId)) {
      throw new FirebaseRequestError("INVALID_PROVIDER_RESPONSE");
    }
    return Object.freeze({ idToken: payload.idToken, refreshToken: payload.refreshToken, subject: payload.localId });
  }
  async sendVerificationEmail(idToken, email) {
    if (!validToken(idToken)) throw new FirebaseRequestError("INVALID_ID_TOKEN");
    const payload = await this.#post(`${IDENTITY_TOOLKIT}/accounts:sendOobCode?key=${encodeURIComponent(this.apiKey)}`, {
      requestType: "VERIFY_EMAIL",
      idToken,
      email,
      continueUrl: this.continueUrl,
      canHandleCodeInApp: false
    });
    if (typeof payload?.email !== "string" || payload.email.trim().toLowerCase() !== String(email || "").trim().toLowerCase()) {
      throw new FirebaseRequestError("INVALID_PROVIDER_RESPONSE");
    }
    return Object.freeze({ accepted: true });
  }
  async sendPasswordResetEmail(email) {
    const normalized = String(email || "").trim().toLowerCase();
    if (!normalized || normalized.length > 254 || /[\r\n\u0000]/.test(normalized)) throw new FirebaseRequestError("INVALID_EMAIL");
    const continueUrl = new URL(this.continueUrl);
    continueUrl.searchParams.delete("firebaseVerified");
    continueUrl.searchParams.set("passwordReset", "1");
    const payload = await this.#post(`${IDENTITY_TOOLKIT}/accounts:sendOobCode?key=${encodeURIComponent(this.apiKey)}`, {
      requestType: "PASSWORD_RESET",
      email: normalized,
      continueUrl: continueUrl.href,
      canHandleCodeInApp: false
    });
    if (typeof payload?.email !== "string" || payload.email.trim().toLowerCase() !== normalized) {
      throw new FirebaseRequestError("INVALID_PROVIDER_RESPONSE");
    }
    return Object.freeze({ accepted: true });
  }
  async deleteAccount(idToken) {
    if (!validToken(idToken)) throw new FirebaseRequestError("INVALID_ID_TOKEN");
    await this.#post(`${IDENTITY_TOOLKIT}/accounts:delete?key=${encodeURIComponent(this.apiKey)}`, { idToken });
    return Object.freeze({ deleted: true });
  }
  async signIn(email, password) {
    const payload = await this.#post(`${IDENTITY_TOOLKIT}/accounts:signInWithPassword?key=${encodeURIComponent(this.apiKey)}`, {
      email,
      password,
      returnSecureToken: true
    });
    if (!validToken(payload?.idToken) || !validToken(payload?.refreshToken) || !validSubject(payload?.localId)) {
      throw new FirebaseRequestError("INVALID_PROVIDER_RESPONSE");
    }
    return Object.freeze({
      idToken: payload.idToken,
      refreshToken: payload.refreshToken,
      subject: payload.localId,
      expiresIn: Math.max(60, Number(payload.expiresIn || 3600))
    });
  }
  async #googleSignIn(input, firebaseIdToken = "") {
    const credential = googleCredential(input);
    if (firebaseIdToken && !validToken(firebaseIdToken)) throw new FirebaseRequestError("INVALID_ID_TOKEN");
    const postBody = new URLSearchParams({ [credential.kind]: credential.value, providerId: "google.com" });
    const payload = await this.#post(`${IDENTITY_TOOLKIT}/accounts:signInWithIdp?key=${encodeURIComponent(this.apiKey)}`, {
      requestUri: new URL(this.continueUrl).origin,
      postBody: postBody.toString(),
      returnIdpCredential: true,
      returnSecureToken: true,
      autoCreate: !firebaseIdToken,
      ...firebaseIdToken ? { idToken: firebaseIdToken } : {}
    });
    if (!validToken(payload?.idToken) || !validToken(payload?.refreshToken) || !validSubject(payload?.localId) || typeof payload?.email !== "string" || payload?.emailVerified !== true) {
      throw new FirebaseRequestError("INVALID_PROVIDER_RESPONSE");
    }
    return Object.freeze({
      idToken: payload.idToken,
      refreshToken: payload.refreshToken,
      subject: payload.localId,
      email: payload.email,
      emailVerified: true,
      isNewUser: payload.isNewUser === true,
      expiresIn: Math.max(60, Number(payload.expiresIn || 3600))
    });
  }
  signInWithGoogle(input) {
    return this.#googleSignIn(input);
  }
  linkGoogle(firebaseIdToken, input) {
    return this.#googleSignIn(input, firebaseIdToken);
  }
  // Facebook uses the same Identity Toolkit IDP exchange as Google. Facebook's
  // browser flow yields an access_token (not an id_token), so that is the
  // credential kind this path accepts.
  async #facebookSignIn(input, firebaseIdToken = "") {
    const credential = googleCredential(input);
    if (credential.kind !== "access_token") throw new FirebaseRequestError("INVALID_IDP_RESPONSE");
    if (firebaseIdToken && !validToken(firebaseIdToken)) throw new FirebaseRequestError("INVALID_ID_TOKEN");
    const postBody = new URLSearchParams({ access_token: credential.value, providerId: "facebook.com" });
    const payload = await this.#post(`${IDENTITY_TOOLKIT}/accounts:signInWithIdp?key=${encodeURIComponent(this.apiKey)}`, {
      requestUri: new URL(this.continueUrl).origin,
      postBody: postBody.toString(),
      returnIdpCredential: true,
      returnSecureToken: true,
      autoCreate: !firebaseIdToken,
      ...firebaseIdToken ? { idToken: firebaseIdToken } : {}
    });
    if (!validToken(payload?.idToken) || !validToken(payload?.refreshToken) || !validSubject(payload?.localId) || typeof payload?.email !== "string" || !payload.email) {
      throw new FirebaseRequestError("INVALID_PROVIDER_RESPONSE");
    }
    return Object.freeze({
      idToken: payload.idToken,
      refreshToken: payload.refreshToken,
      subject: payload.localId,
      email: payload.email,
      emailVerified: payload.emailVerified === true,
      isNewUser: payload.isNewUser === true,
      expiresIn: Math.max(60, Number(payload.expiresIn || 3600))
    });
  }
  signInWithFacebook(input) {
    return this.#facebookSignIn(input);
  }
  linkFacebook(firebaseIdToken, input) {
    return this.#facebookSignIn(input, firebaseIdToken);
  }
  // Read the verified Facebook identity behind an access token. The Graph API is
  // asked for the app-scoped user id and email; the email is only trusted when
  // Facebook reports it as verified.
  async facebookIdentity(accessToken) {
    if (!validToken(accessToken)) throw new FirebaseRequestError("INVALID_IDP_RESPONSE");
    let response;
    try {
      response = await this.fetch(`${FACEBOOK_GRAPH}/me?fields=id,email&access_token=${encodeURIComponent(accessToken)}`, {
        method: "GET",
        headers: { Accept: "application/json", "Cache-Control": "no-store" },
        redirect: "manual",
        signal: AbortSignal.timeout(12e3)
      });
    } catch {
      throw new FirebaseRequestError("NETWORK_ERROR");
    }
    let payload = {};
    try {
      payload = await response.json();
    } catch {
    }
    if (!response.ok || payload?.error) throw new FirebaseRequestError("INVALID_IDP_RESPONSE", response.status);
    if (!validSubject(payload?.id) || typeof payload?.email !== "string" || !payload.email) {
      throw new FirebaseRequestError("INVALID_IDP_RESPONSE");
    }
    return Object.freeze({ subject: String(payload.id), email: payload.email, emailVerified: true });
  }
  async googleIdentity(accessToken) {
    if (!validToken(accessToken)) throw new FirebaseRequestError("INVALID_IDP_RESPONSE");
    let response;
    try {
      response = await this.fetch(GOOGLE_USERINFO, {
        method: "GET",
        headers: { Accept: "application/json", Authorization: `Bearer ${accessToken}`, "Cache-Control": "no-store" },
        redirect: "manual",
        signal: AbortSignal.timeout(12e3)
      });
    } catch {
      throw new FirebaseRequestError("NETWORK_ERROR");
    }
    let payload = {};
    try {
      payload = await response.json();
    } catch {
    }
    if (!response.ok) throw new FirebaseRequestError("INVALID_IDP_RESPONSE", response.status);
    if (!validSubject(payload?.sub) || typeof payload?.email !== "string" || payload?.email_verified !== true) {
      throw new FirebaseRequestError("INVALID_IDP_RESPONSE");
    }
    return Object.freeze({ subject: payload.sub, email: payload.email, emailVerified: true });
  }
  async lookup(idToken) {
    if (!validToken(idToken)) throw new FirebaseRequestError("INVALID_ID_TOKEN");
    const payload = await this.#post(`${IDENTITY_TOOLKIT}/accounts:lookup?key=${encodeURIComponent(this.apiKey)}`, { idToken });
    const user = Array.isArray(payload?.users) ? payload.users[0] : null;
    if (!user || !validSubject(user.localId) || typeof user.email !== "string") {
      throw new FirebaseRequestError("INVALID_PROVIDER_RESPONSE");
    }
    const providerRows = Array.isArray(user.providerUserInfo) ? user.providerUserInfo : [];
    return Object.freeze({
      subject: user.localId,
      email: user.email,
      emailVerified: user.emailVerified === true,
      disabled: user.disabled === true,
      displayName: typeof user.displayName === "string" && user.displayName ? user.displayName : null,
      photoUrl: typeof user.photoUrl === "string" && user.photoUrl ? user.photoUrl : null,
      providers: Object.freeze(providerRows.map((row) => String(row?.providerId || "")).filter(Boolean)),
      googleSubjects: Object.freeze(providerRows.filter((row) => row?.providerId === "google.com" && validSubject(row?.rawId)).map((row) => String(row.rawId))),
      facebookSubjects: Object.freeze(providerRows.filter((row) => row?.providerId === "facebook.com" && validSubject(row?.rawId)).map((row) => String(row.rawId)))
    });
  }
  async refresh(refreshToken) {
    if (!validToken(refreshToken)) throw new FirebaseRequestError("INVALID_REFRESH_TOKEN");
    const body = new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken });
    const payload = await this.#post(`${SECURE_TOKEN}?key=${encodeURIComponent(this.apiKey)}`, body, { form: true });
    if (!validToken(payload?.id_token) || !validToken(payload?.refresh_token) || !validSubject(payload?.user_id)) {
      throw new FirebaseRequestError("INVALID_PROVIDER_RESPONSE");
    }
    return Object.freeze({
      idToken: payload.id_token,
      refreshToken: payload.refresh_token,
      subject: payload.user_id,
      expiresIn: Math.max(60, Number(payload.expires_in || 3600))
    });
  }
};
var __firebaseProviderTest = Object.freeze({ validGoogleClientId, googleIdpFromProject });

// auth-native/verification/provider-contract.mjs
var VERIFICATION_CHANNELS = Object.freeze({
  OTP: "otp",
  WHATSAPP: "whatsapp",
  TELEGRAM: "telegram"
});
var VERIFICATION_FAILURE_CLASS = Object.freeze({
  HARD: "hard-provider-failure",
  TEMPORARY: "temporary-provider-failure",
  USER: "user-error"
});
var VERIFICATION_MODES = Object.freeze({
  LOCAL_CODE: "local-code",
  PROVIDER_EVIDENCE: "provider-evidence"
});
var CHANNEL_VALUES = new Set(Object.values(VERIFICATION_CHANNELS));
var FAILURE_VALUES = new Set(Object.values(VERIFICATION_FAILURE_CLASS));
var MODE_VALUES = new Set(Object.values(VERIFICATION_MODES));
var REQUIRED_METHODS = Object.freeze([
  "sendVerification",
  "checkAvailability",
  "getRemainingQuota",
  "verifyCode",
  "getProviderStatus"
]);
var __verificationProviderTest = Object.freeze({ CHANNEL_VALUES, FAILURE_VALUES, MODE_VALUES, REQUIRED_METHODS });

// auth-native/verification/config.mjs
var SLOT_DEFINITIONS = Object.freeze({
  "otp-a": Object.freeze({ channel: VERIFICATION_CHANNELS.OTP, verificationMode: VERIFICATION_MODES.LOCAL_CODE, priority: 10 }),
  "otp-h": Object.freeze({ channel: VERIFICATION_CHANNELS.OTP, verificationMode: VERIFICATION_MODES.PROVIDER_EVIDENCE, priority: 15 }),
  "otp-i": Object.freeze({ channel: VERIFICATION_CHANNELS.OTP, verificationMode: VERIFICATION_MODES.PROVIDER_EVIDENCE, priority: 38 }),
  "otp-j": Object.freeze({ channel: VERIFICATION_CHANNELS.OTP, verificationMode: VERIFICATION_MODES.PROVIDER_EVIDENCE, priority: 38 }),
  "otp-k": Object.freeze({ channel: VERIFICATION_CHANNELS.OTP, verificationMode: VERIFICATION_MODES.PROVIDER_EVIDENCE, priority: 38 }),
  "otp-l": Object.freeze({ channel: VERIFICATION_CHANNELS.OTP, verificationMode: VERIFICATION_MODES.PROVIDER_EVIDENCE, priority: 38 }),
  // otp-m is the Descope magic link. It never joins the code failover: only an
  // explicit 'magic-link' email-ownership request may select it.
  "otp-m": Object.freeze({ channel: VERIFICATION_CHANNELS.OTP, verificationMode: VERIFICATION_MODES.PROVIDER_EVIDENCE, priority: 38 }),
  "otp-b": Object.freeze({ channel: VERIFICATION_CHANNELS.OTP, verificationMode: VERIFICATION_MODES.LOCAL_CODE, priority: 20 }),
  "otp-c": Object.freeze({ channel: VERIFICATION_CHANNELS.OTP, verificationMode: VERIFICATION_MODES.LOCAL_CODE, priority: 30 }),
  "otp-d": Object.freeze({ channel: VERIFICATION_CHANNELS.OTP, verificationMode: VERIFICATION_MODES.LOCAL_CODE, priority: 35 }),
  "otp-e": Object.freeze({ channel: VERIFICATION_CHANNELS.OTP, verificationMode: VERIFICATION_MODES.LOCAL_CODE, priority: 37 }),
  "otp-f": Object.freeze({ channel: VERIFICATION_CHANNELS.OTP, verificationMode: VERIFICATION_MODES.LOCAL_CODE, priority: 38 }),
  "otp-g": Object.freeze({ channel: VERIFICATION_CHANNELS.OTP, verificationMode: VERIFICATION_MODES.LOCAL_CODE, priority: 39 }),
  // otp-n..otp-u: OTP_RAW pool mailers (pool-providers.mjs).
  "otp-n": Object.freeze({ channel: VERIFICATION_CHANNELS.OTP, verificationMode: VERIFICATION_MODES.LOCAL_CODE, priority: 38 }),
  "otp-o": Object.freeze({ channel: VERIFICATION_CHANNELS.OTP, verificationMode: VERIFICATION_MODES.LOCAL_CODE, priority: 38 }),
  "otp-q": Object.freeze({ channel: VERIFICATION_CHANNELS.OTP, verificationMode: VERIFICATION_MODES.LOCAL_CODE, priority: 38 }),
  "otp-r": Object.freeze({ channel: VERIFICATION_CHANNELS.OTP, verificationMode: VERIFICATION_MODES.LOCAL_CODE, priority: 38 }),
  "otp-s": Object.freeze({ channel: VERIFICATION_CHANNELS.OTP, verificationMode: VERIFICATION_MODES.LOCAL_CODE, priority: 38 }),
  "otp-t": Object.freeze({ channel: VERIFICATION_CHANNELS.OTP, verificationMode: VERIFICATION_MODES.LOCAL_CODE, priority: 38 }),
  "otp-u": Object.freeze({ channel: VERIFICATION_CHANNELS.OTP, verificationMode: VERIFICATION_MODES.LOCAL_CODE, priority: 38 }),
  // otp-v..otp-za: hosted IdP OTP (idp-providers.mjs) — provider mails and checks the code.
  "otp-v": Object.freeze({ channel: VERIFICATION_CHANNELS.OTP, verificationMode: VERIFICATION_MODES.PROVIDER_EVIDENCE, priority: 38 }),
  "otp-w": Object.freeze({ channel: VERIFICATION_CHANNELS.OTP, verificationMode: VERIFICATION_MODES.PROVIDER_EVIDENCE, priority: 38 }),
  "otp-x": Object.freeze({ channel: VERIFICATION_CHANNELS.OTP, verificationMode: VERIFICATION_MODES.PROVIDER_EVIDENCE, priority: 38 }),
  "otp-y": Object.freeze({ channel: VERIFICATION_CHANNELS.OTP, verificationMode: VERIFICATION_MODES.PROVIDER_EVIDENCE, priority: 38 }),
  "otp-z": Object.freeze({ channel: VERIFICATION_CHANNELS.OTP, verificationMode: VERIFICATION_MODES.PROVIDER_EVIDENCE, priority: 38 }),
  "otp-za": Object.freeze({ channel: VERIFICATION_CHANNELS.OTP, verificationMode: VERIFICATION_MODES.PROVIDER_EVIDENCE, priority: 38 }),
  whatsapp: Object.freeze({ channel: VERIFICATION_CHANNELS.WHATSAPP, verificationMode: VERIFICATION_MODES.LOCAL_CODE, priority: 40 }),
  telegram: Object.freeze({ channel: VERIFICATION_CHANNELS.TELEGRAM, verificationMode: VERIFICATION_MODES.LOCAL_CODE, priority: 50 })
});
var DEFAULT_POLICY = Object.freeze({
  codeTtlSeconds: 600,
  maxAttempts: 5,
  resendCooldownSeconds: 60,
  lockoutSeconds: 900,
  maxProviderRetries: 1,
  circuitFailureThreshold: 3,
  circuitCooldownSeconds: 300,
  lowQuotaRatio: 0.15,
  /* F-02 (blueprint 06): one code, one wall-clock budget. The send chain used to
     be unbounded — every enabled slot waited its own timeoutMs in turn, so a bad
     day across a dozen providers could hold the student for ~160s. The budget
     caps the whole request (health probes included), not each attempt. */
  deliveryBudgetMs: 25e3
});
function safeJson(raw) {
  if (!raw) return {};
  const text = String(raw);
  if (text.length > 16384) return {};
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}
var OWNER_ALLOWED_DOMAINS = Object.freeze(["gmail.com", "yahoo.com", "icloud.com", "hotmail.com", "outlook.com"]);
var __verificationConfigTest = Object.freeze({ SLOT_DEFINITIONS, DEFAULT_POLICY, safeJson });

// auth-native/verification/turnstile.mjs
var SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
async function verifyTurnstile({ env, token, ip, fetchImpl = fetch, timeoutMs = 8e3 } = {}) {
  const secret = String(env?.TURNSTILE_SECRET_KEY || "").trim();
  if (!secret) return { enforced: false };
  const value = String(token ?? "");
  if (!value || value.length > 4096) throw new NativeAuthError(AUTH_ERROR_CODES.HUMAN_CHECK_FAILED);
  const form = new URLSearchParams({ secret, response: value });
  if (ip && ip !== "unknown") form.set("remoteip", String(ip).slice(0, 96));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(SITEVERIFY_URL, { method: "POST", body: form, signal: controller.signal });
    const data = await response.json().catch(() => null);
    if (data && data.success === true) return { enforced: true };
  } catch {
  } finally {
    clearTimeout(timer);
  }
  throw new NativeAuthError(AUTH_ERROR_CODES.HUMAN_CHECK_FAILED);
}

// auth-native/verification/telegram-security.mjs
var WEBHOOK_CONTEXT = "admission-hub-telegram-webhook-v1";
var SECRET_PATTERN = /^[A-Za-z0-9_-]{20,256}$/;
var safeRootSecret = (value) => {
  const text = String(value || "");
  return text.length >= 32 && text.length <= 4096 && !/[\r\n\u0000]/.test(text) ? text : "";
};
var base64Url = (bytes) => {
  let binary = "";
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
};
var validTelegramWebhookSecret = (value) => SECRET_PATTERN.test(String(value || ""));
async function deriveTelegramWebhookSecret(rootSecret2, cryptoImpl = globalThis.crypto) {
  const source = safeRootSecret(rootSecret2);
  if (!source || !cryptoImpl?.subtle) return "";
  try {
    const encoder5 = new TextEncoder();
    const key = await cryptoImpl.subtle.importKey(
      "raw",
      encoder5.encode(source),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    const signature = await cryptoImpl.subtle.sign("HMAC", key, encoder5.encode(WEBHOOK_CONTEXT));
    const derived = base64Url(signature);
    return validTelegramWebhookSecret(derived) ? derived : "";
  } catch {
    return "";
  }
}
async function resolveTelegramWebhookSecret(env = {}, cryptoImpl = globalThis.crypto) {
  const explicit = String(env?.TELEGRAM_AUTH_WEBHOOK_SECRET || "");
  if (validTelegramWebhookSecret(explicit)) return explicit;
  return deriveTelegramWebhookSecret(env?.AUTH_HMAC_SECRET, cryptoImpl);
}
var __telegramSecurityTest = Object.freeze({ WEBHOOK_CONTEXT, safeRootSecret, base64Url });

// auth-native/verification/telegram-login.mjs
var TELEGRAM_LOGIN_DOMAIN = "telegram.admissionsky.pages.dev";
var MAX_AGE_SECONDS = 600;
var BOT_TOKEN_PATTERN = /^\d{5,15}:[A-Za-z0-9_-]{30,64}$/;
var LOGIN_EMAIL_PATTERN = /^tg(\d{1,20})\.([0-9a-f]{20})@telegram\.admissionsky\.pages\.dev$/;
var encoder4 = new TextEncoder();
var hex = (buffer) => [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
var hmacHex = async (keyBytes, text, cryptoImpl) => {
  const key = await cryptoImpl.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await cryptoImpl.subtle.sign("HMAC", key, encoder4.encode(text)));
};
var rootSecret = (env) => {
  const value = String(env?.AUTH_HMAC_SECRET || "");
  return value.length >= 32 && value.length <= 4096 ? value : "";
};
var telegramLoginBotToken = (env) => {
  const token = String(env?.TELEGRAM_AUTH_BOT_TOKEN || env?.TG_BOT_TOKEN || "").trim();
  return BOT_TOKEN_PATTERN.test(token) ? token : "";
};
var telegramLoginBotId = (env) => telegramLoginBotToken(env).split(":")[0] || "";
var telegramLoginReady = (env) => Boolean(
  telegramLoginBotToken(env) && rootSecret(env) && String(env?.TELEGRAM_LOGIN_ACTIVATION || "enabled") !== "disabled"
);
var reservedTelegramLoginEmail = (email) => String(email || "").trim().toLowerCase().endsWith(`@${TELEGRAM_LOGIN_DOMAIN}`);
var TelegramLoginError = class extends Error {
  constructor(reason) {
    super(reason);
    this.name = "TelegramLoginError";
    this.reason = reason;
  }
};
async function verifyTelegramLogin(input, env, { now = Date.now(), cryptoImpl = globalThis.crypto } = {}) {
  const token = telegramLoginBotToken(env);
  if (!token || !cryptoImpl?.subtle) throw new TelegramLoginError("TELEGRAM_LOGIN_UNAVAILABLE");
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new TelegramLoginError("TELEGRAM_LOGIN_INVALID");
  const hash = String(input.hash || "").toLowerCase();
  const data = {};
  for (const [key, value] of Object.entries(input)) {
    if (key === "hash" || value === void 0 || value === null) continue;
    if (!/^[a-z_]{1,32}$/.test(key) || !["string", "number", "boolean"].includes(typeof value)) throw new TelegramLoginError("TELEGRAM_LOGIN_INVALID");
    data[key] = String(value);
  }
  if (Object.keys(data).length > 16 || !/^[0-9a-f]{64}$/.test(hash) || !/^\d{1,20}$/.test(data.id || "") || !/^\d{9,12}$/.test(data.auth_date || "")) {
    throw new TelegramLoginError("TELEGRAM_LOGIN_INVALID");
  }
  const checkString = Object.keys(data).sort().map((key) => `${key}=${data[key]}`).join("\n");
  const secret = await cryptoImpl.subtle.digest("SHA-256", encoder4.encode(token));
  const expected = await hmacHex(secret, checkString, cryptoImpl);
  if (!constantTimeEqual(expected, hash)) throw new TelegramLoginError("TELEGRAM_LOGIN_INVALID");
  const age = Math.floor(Number(now) / 1e3) - Number(data.auth_date);
  if (age > MAX_AGE_SECONDS || age < -60) throw new TelegramLoginError("TELEGRAM_LOGIN_EXPIRED");
  const clean = (value) => String(value || "").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 64);
  return Object.freeze({
    id: data.id,
    displayName: [clean(data.first_name), clean(data.last_name)].filter(Boolean).join(" ").slice(0, 80),
    username: clean(data.username)
  });
}
async function telegramLoginCredentials(telegramId, env, cryptoImpl = globalThis.crypto) {
  const root = rootSecret(env);
  const id = String(telegramId || "");
  if (!root || !/^\d{1,20}$/.test(id)) throw new TelegramLoginError("TELEGRAM_LOGIN_UNAVAILABLE");
  const key = encoder4.encode(root);
  const [tag, password] = await Promise.all([
    hmacHex(key, `admission-hub-telegram-login-email-v1:${id}`, cryptoImpl),
    hmacHex(key, `admission-hub-telegram-login-password-v1:${id}`, cryptoImpl)
  ]);
  return Object.freeze({ email: `tg${id}.${tag.slice(0, 20)}@${TELEGRAM_LOGIN_DOMAIN}`, password: `Tg-${password.slice(0, 44)}` });
}
async function isTelegramLoginEmail(email, env, cryptoImpl = globalThis.crypto) {
  const match = LOGIN_EMAIL_PATTERN.exec(String(email || "").trim().toLowerCase());
  if (!match || !rootSecret(env)) return false;
  try {
    const expected = await telegramLoginCredentials(match[1], env, cryptoImpl);
    return constantTimeEqual(expected.email, `tg${match[1]}.${match[2]}@${TELEGRAM_LOGIN_DOMAIN}`);
  } catch {
    return false;
  }
}

// auth-native/worker/pending-signup.mjs
var PENDING_SIGNUP_TTL_MS = 10 * 60 * 1e3;
var HOUR_MS = 60 * 60 * 1e3;
var BEGIN_LIMITS = Object.freeze([
  Object.freeze({ scope: "email", limit: 5, windowMs: HOUR_MS }),
  Object.freeze({ scope: "device", limit: 10, windowMs: HOUR_MS }),
  Object.freeze({ scope: "ip", limit: 30, windowMs: HOUR_MS })
]);
var TICKET_PATTERN = /^p\.[A-Za-z0-9_-]{40,96}$/;
var isPendingSignupTicket = (value) => typeof value === "string" && TICKET_PATTERN.test(value);

// auth-native/worker/pending-signup-public.mjs
var PENDING = "/internal/signup/pending";
var PENDING_SIGNUP_HEADER = "X-AH-Signup-Flow";
var PENDING_SIGNUP_FLOW = "pending-v1";
var pendingSignupRequested = (request) => request?.headers?.get(PENDING_SIGNUP_HEADER) === PENDING_SIGNUP_FLOW;
var TICKET_SECONDS = Math.floor(PENDING_SIGNUP_TTL_MS / 1e3);
var deviceHeaders = (context, deps, cookies2 = []) => {
  const list = [...context.isNewDevice ? [deps.deviceCookie(context.deviceId)] : [], ...cookies2];
  return list.length ? { "Set-Cookie": list } : {};
};
async function beginPendingSignup({ request, env, context, prepared, password, deps }) {
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
async function savePendingSignupProfile({ request, env, context, ticket, profile, deps }) {
  const result = await deps.callAuthority(env, `${PENDING}/profile`, { input: { ticket, profile }, context });
  return deps.json(request, 200, { ok: true, saved: result?.saved === true }, deviceHeaders(context, deps));
}
async function createAccount({ env, provider, context, email, password, profile, deps }) {
  let signed;
  try {
    signed = await provider.signUp(email, password);
  } catch (cause) {
    throw deps.providerError(cause, "signup");
  }
  try {
    const real = await deps.callAuthority(env, "/internal/firebase/account-verification/begin", {
      input: { email, subject: signed.subject, refreshToken: signed.refreshToken },
      context
    });
    if (profile && typeof profile === "object") {
      try {
        await deps.callAuthority(env, "/internal/profile/save-pending", { verificationTicket: real.verificationTicket, input: profile, context });
      } catch {
      }
    }
    return { signed, verificationTicket: real.verificationTicket };
  } catch (cause) {
    try {
      await provider.deleteAccount(signed.idToken);
    } catch {
    }
    throw cause;
  }
}
async function startPendingSignupCode({ request, env, provider, context, ticket, magicLink, deps }) {
  if (magicLink) throw new NativeAuthError(AUTH_ERROR_CODES.BACKUP_UNAVAILABLE);
  const result = await deps.callAuthority(env, `${PENDING}/request`, { input: { ticket }, context });
  if (result?.fallback === true) {
    const created = await createAccount({ env, provider, context, email: result.email, password: result.password, profile: result.profile, deps });
    try {
      await provider.sendVerificationEmail(created.signed.idToken, result.email);
    } catch (cause) {
      throw cause instanceof NativeAuthError ? cause : deps.providerError(cause, "verification");
    }
    try {
      await deps.callAuthority(env, `${PENDING}/consume`, { input: { ticket }, context });
    } catch {
    }
    return deps.json(request, 202, {
      ok: true,
      authenticated: false,
      delivery: { method: "firebase-link", sent: true, fallback: true, emailMasked: result.emailMasked || "আপনার ইমেইলে", resendAfter: 60 }
    }, deviceHeaders(context, deps, [deps.verificationCookie(created.verificationTicket)]));
  }
  return deps.json(request, 202, {
    ok: true,
    authenticated: false,
    delivery: { method: "email-otp", sent: true, fallback: false },
    ownership: {
      sent: true,
      attemptId: result?.attemptId || "",
      emailMasked: result?.emailMasked || "আপনার ইমেইলে",
      resendAfter: Number(result?.resendAfter || 60)
    }
  }, deviceHeaders(context, deps));
}
async function verifyPendingSignupCodeAndCreate({ request, env, provider, context, ticket, attemptId, code, deps }) {
  const verified = await deps.callAuthority(env, `${PENDING}/verify`, { input: { ticket, attemptId, code }, context });
  if (verified?.verified !== true || !verified.email || !verified.password) throw new NativeAuthError(AUTH_ERROR_CODES.OTP_INVALID);
  const email = verified.email;
  const created = await createAccount({ env, provider, context, email, password: verified.password, profile: verified.profile, deps });
  const identity = { verificationTicket: created.verificationTicket, email, subject: created.signed.subject };
  let established;
  try {
    await deps.callAuthority(env, `${PENDING}/ownership`, { input: { ticket, ...identity }, context });
    established = await deps.callAuthority(env, "/internal/firebase/account-verification/complete", { input: identity, context });
  } catch (cause) {
    try {
      await provider.deleteAccount(created.signed.idToken);
    } catch {
    }
    throw cause;
  }
  const response = deps.authSuccess(request, established, created.signed.refreshToken, context, {
    emailVerified: false,
    emailOwnershipProven: true
  }, [deps.verificationCookie("", 0)]);
  try {
    await deps.callAuthority(env, `${PENDING}/consume`, { input: { ticket }, context });
  } catch {
  }
  return response;
}

// auth-native/core/shadow-guard.mjs
var SHADOW_GUARD_POLICY_VERSION = "shadow-guard-v1";
var SHADOW_GUARD_MODES = Object.freeze({
  OFF: "off",
  OBSERVE: "observe",
  ENFORCE: "enforce"
});
function resolveGuardMode(value) {
  const raw = String(value ?? "").trim().toLowerCase();
  if (raw === "off" || raw === "none" || raw === "disabled") return SHADOW_GUARD_MODES.OFF;
  if (raw === "enforce" || raw === "canary" || raw === "enabled" || raw === "on") return SHADOW_GUARD_MODES.ENFORCE;
  return SHADOW_GUARD_MODES.OBSERVE;
}
var SHADOW_GUARD_DELAY_MIN_MS = 300;
var SHADOW_GUARD_DELAY_MAX_MS = 900;
var SHADOW_GUARD_BOT_SCORE_THRESHOLD = 30;
var SHADOW_GUARD_EMAILS_PER_IP_THRESHOLD = 10;
function computeRiskSignals(facts = {}) {
  const signals = {};
  if (facts.accountState) signals.accountState = facts.accountState;
  if (facts.recoveryActive === true) signals.recoveryActive = true;
  const failed = Math.max(0, Number(facts.failedLogins) || 0);
  if (failed > 0) signals.failedLogins = failed;
  const rapid = Math.max(0, Number(facts.rapidRequests) || 0);
  if (rapid > 0) signals.rapidRequests = rapid;
  if (facts.unverifiedAccount === true) signals.unverifiedAccount = true;
  if (facts.deviceKnown === false) signals.newDevice = true;
  const botScore = Number(facts.botScore);
  const botSuspicious = Number.isFinite(botScore) && botScore > 0 && botScore < SHADOW_GUARD_BOT_SCORE_THRESHOLD;
  const stuffing = (Number(facts.emailsFromIp) || 0) >= SHADOW_GUARD_EMAILS_PER_IP_THRESHOLD;
  const extras = [];
  if (facts.countryChanged === true) extras.push("country-changed");
  if (facts.asnChanged === true) extras.push("asn-changed");
  if (botSuspicious) extras.push("bot-suspicious");
  if (stuffing) extras.push("many-emails-from-ip");
  return Object.freeze({ signals: Object.freeze(signals), extras: Object.freeze(extras) });
}
var BAND_BY_LEVEL = Object.freeze({
  LOW: "low",
  NORMAL: "low",
  ELEVATED: "medium",
  HIGH: "high",
  CRITICAL: "high"
});
var ENGINE_BEHAVIOURS = /* @__PURE__ */ new Set(["failed-logins-high", "failed-logins-elevated", "rapid-requests", "new-device", "unverified-account"]);
var RANK = Object.freeze({ LOW: 0, NORMAL: 1, ELEVATED: 2, HIGH: 3, CRITICAL: 4 });
var LEVELS = Object.freeze(["LOW", "NORMAL", "ELEVATED", "HIGH", "CRITICAL"]);
function shadowVerdict(facts = {}, config = resolveSecurityConfig()) {
  const { signals, extras } = computeRiskSignals(facts);
  const evaluation = evaluateRisk(signals, config);
  const engineBehaviours = evaluation.reasons.filter((reason) => ENGINE_BEHAVIOURS.has(reason)).length;
  let rank2 = RANK[evaluation.level] ?? 0;
  if (extras.length === 1) rank2 = Math.max(rank2, RANK.ELEVATED);
  if (extras.length >= 2) rank2 = Math.max(rank2, RANK.HIGH);
  if (engineBehaviours > 0 && extras.length > 0) rank2 = Math.max(rank2, RANK.HIGH);
  if (evaluation.level === "CRITICAL") rank2 = RANK.CRITICAL;
  const level = LEVELS[Math.min(rank2, LEVELS.length - 1)];
  const band = BAND_BY_LEVEL[level] || "low";
  return Object.freeze({
    policyVersion: SHADOW_GUARD_POLICY_VERSION,
    band,
    level,
    reasons: Object.freeze([...evaluation.reasons, ...extras]),
    extras,
    // A medium attempt may continue once the challenge is satisfied; a high
    // one is answered as though the credentials were wrong.
    challenge: band === "medium" ? evaluation.actions.challenge || "step-up" : null,
    shadowBan: band === "high",
    genericError: band === "high" ? AUTH_ERROR_CODES.INVALID_CREDENTIALS : null
  });
}
function cryptoRandomUnit(cryptoImpl = globalThis.crypto) {
  const buffer = new Uint32Array(1);
  if (cryptoImpl?.getRandomValues) {
    cryptoImpl.getRandomValues(buffer);
    return buffer[0] / 4294967296;
  }
  return 0.5;
}
function shadowDelayMs(random, min = SHADOW_GUARD_DELAY_MIN_MS, max = SHADOW_GUARD_DELAY_MAX_MS) {
  const low = Math.max(0, Math.min(min, max));
  const high = Math.max(low, max);
  const draw = Number(typeof random === "function" ? random() : cryptoRandomUnit());
  const value = Number.isFinite(draw) ? Math.min(Math.max(draw, 0), 1) : 0;
  return Math.round(low + value * (high - low));
}
function sleep(ms, timer = setTimeout) {
  const wait = Math.max(0, Number(ms) || 0);
  if (wait === 0) return Promise.resolve();
  return new Promise((resolve) => timer(resolve, wait));
}

// auth-native/core/canary-accounts.mjs
var CANARY_POLICY_VERSION = "canary-v1";
function parseCanaryEmails(raw = "") {
  return Object.freeze(
    String(raw || "").split(/[\s,;]+/).map((value) => value.trim().toLowerCase()).filter((value) => value.includes("@")).filter((value, index, list) => list.indexOf(value) === index)
  );
}
function isCanaryEmail(email, canaryEmails = []) {
  const value = String(email || "").trim().toLowerCase();
  if (!value) return false;
  return canaryEmails.includes(value);
}
var CANARY_FLAG_TTL_SECONDS = 30 * 24 * 60 * 60;
function createKvCanaryFlags(store, options = {}) {
  const prefix = String(options.prefix || "canaryflag");
  const clock = typeof options.now === "function" ? options.now : () => Date.now();
  const keyFor = (kind) => `${prefix}:${kind}`;
  return Object.freeze({
    policyVersion: CANARY_POLICY_VERSION,
    async flag(ip, deviceId) {
      const at = clock();
      const entries = [
        ["ip", String(ip || "").trim()],
        ["device", String(deviceId || "").trim()]
      ].filter(([, value]) => value);
      for (const [kind, value] of entries) {
        const key = `${keyFor(kind)}:${value}`;
        const previous = Number(await store.get(key)) || 0;
        await store.put(key, String(previous + 1), { expirationTtl: CANARY_FLAG_TTL_SECONDS });
      }
      return entries.length;
    },
    async isFlagged(ip, deviceId) {
      for (const [kind, value] of [["ip", ip], ["device", deviceId]]) {
        if (!value) continue;
        const count = Number(await store.get(`${keyFor(kind)}:${String(value).trim()}`)) || 0;
        if (count > 0) return true;
      }
      return false;
    }
  });
}

// auth-native/core/password-guard.mjs
var PASSWORD_GUARD_POLICY_VERSION = "password-guard-v1";
var MINUTE = 60 * 1e3;
var HOUR = 60 * MINUTE;
var DAY = 24 * HOUR;
var PASSWORD_GUARD_SCALES = Object.freeze({
  user: Object.freeze({
    name: "user",
    windowMs: 15 * MINUTE,
    triggers: Object.freeze([5, 5, 5]),
    stepsMs: Object.freeze([30 * MINUTE, 5 * HOUR, 1 * DAY])
  }),
  admin: Object.freeze({
    name: "admin",
    windowMs: 0,
    triggers: Object.freeze([1, 1, 1, 1]),
    stepsMs: Object.freeze([5 * MINUTE, 7 * HOUR, 2 * DAY, 7 * DAY])
  })
});
function resolvePasswordGuardScale(scale) {
  if (typeof scale === "string") return PASSWORD_GUARD_SCALES[scale] || PASSWORD_GUARD_SCALES.user;
  if (scale && typeof scale === "object" && Array.isArray(scale.stepsMs) && scale.stepsMs.length) {
    const windowMs = Number.isFinite(scale.windowMs) && scale.windowMs > 0 ? scale.windowMs : 0;
    const triggers = (Array.isArray(scale.triggers) && scale.triggers.length ? scale.triggers : [1]).map((value) => Math.max(1, Math.floor(Number(value) || 1)));
    return { name: String(scale.name || "custom"), windowMs, triggers, stepsMs: scale.stepsMs.slice() };
  }
  return PASSWORD_GUARD_SCALES.user;
}
function emptyGuardState() {
  return { fails: 0, windowStartedAt: 0, strikes: 0, until: 0, lastAt: 0 };
}
function normalizeGuardState(raw) {
  if (!raw) return emptyGuardState();
  let value = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      return emptyGuardState();
    }
  }
  if (!value || typeof value !== "object") return emptyGuardState();
  const number = (key) => {
    const n = Math.floor(Number(value[key]));
    return Number.isFinite(n) && n > 0 ? n : 0;
  };
  return {
    fails: number("fails"),
    windowStartedAt: number("windowStartedAt"),
    strikes: number("strikes"),
    until: number("until"),
    lastAt: number("lastAt")
  };
}
function triggerFor(strikes, scale) {
  const list = scale.triggers;
  return list[Math.min(Math.max(strikes, 0), list.length - 1)];
}
function stepFor(strikes, scale) {
  const list = scale.stepsMs;
  return list[Math.min(Math.max(strikes - 1, 0), list.length - 1)] || 0;
}
function guardDecision(state, now, scale = PASSWORD_GUARD_SCALES.user) {
  const resolved = resolvePasswordGuardScale(scale);
  const current = normalizeGuardState(state);
  const blocked = current.until > now;
  const needed = triggerFor(current.strikes, resolved);
  return Object.freeze({
    policyVersion: PASSWORD_GUARD_POLICY_VERSION,
    scale: resolved.name,
    blocked,
    retryAfterMs: blocked ? current.until - now : 0,
    retryAfterSeconds: blocked ? Math.ceil((current.until - now) / 1e3) : 0,
    strikes: current.strikes,
    fails: current.fails,
    attemptsRemaining: Math.max(0, needed - current.fails),
    // The recovery path is the handler's job; the guard only states that a
    // blocked identity must be offered one.
    recoveryRequired: blocked
  });
}
function recordPasswordFailure(state, now, scale = PASSWORD_GUARD_SCALES.user) {
  const resolved = resolvePasswordGuardScale(scale);
  const current = normalizeGuardState(state);
  if (current.until > now) {
    return Object.freeze({ state: current, decision: guardDecision(current, now, resolved), escalated: false });
  }
  const windowExpired = resolved.windowMs > 0 && now - current.windowStartedAt > resolved.windowMs;
  const fails = (windowExpired ? 0 : current.fails) + 1;
  const windowStartedAt = windowExpired || !current.windowStartedAt ? now : current.windowStartedAt;
  let next = { fails, windowStartedAt, strikes: current.strikes, until: current.until, lastAt: now };
  let escalated = false;
  if (fails >= triggerFor(current.strikes, resolved)) {
    const strikes = current.strikes + 1;
    next = { fails: 0, windowStartedAt: 0, strikes, until: now + stepFor(strikes, resolved), lastAt: now };
    escalated = true;
  }
  return Object.freeze({ state: next, decision: guardDecision(next, now, resolved), escalated });
}
function recordPasswordSuccess(state, now, scale = PASSWORD_GUARD_SCALES.user) {
  const resolved = resolvePasswordGuardScale(scale);
  const current = normalizeGuardState(state);
  if (current.until > now) return current;
  return { ...emptyGuardState(), lastAt: now };
}
function passwordGuardKey(email, ip) {
  const mail = String(email || "").trim().toLowerCase();
  const address = String(ip || "").trim();
  return `${address}|${mail}`;
}
function passwordFailuresSoFar(decision, scale = PASSWORD_GUARD_SCALES.user) {
  if (!decision) return 0;
  const resolved = resolvePasswordGuardScale(scale);
  const perStrike = Number(resolved.triggers?.[0]) > 0 ? Number(resolved.triggers[0]) : 1;
  const strikes = Math.max(0, Number(decision.strikes) || 0);
  const fails = Math.max(0, Number(decision.fails) || 0);
  return strikes * perStrike + fails;
}
function createKvPasswordGuard(store, options = {}) {
  const prefix = String(options.prefix || "pwfail");
  const clock = typeof options.now === "function" ? options.now : () => Date.now();
  const keyFor = (identity) => `${prefix}:${identity}`;
  async function read(identity) {
    const raw = await store.get(keyFor(identity));
    return normalizeGuardState(raw);
  }
  async function write(identity, state, scale) {
    const resolved = resolvePasswordGuardScale(scale);
    const ttlMs = Math.max(6e4, state.until - clock(), resolved.windowMs * 2);
    await store.put(keyFor(identity), JSON.stringify(state), { expirationTtl: Math.ceil(ttlMs / 1e3) });
  }
  async function one(identity, run) {
    if (!identity) return null;
    return run(String(identity));
  }
  return Object.freeze({
    policyVersion: PASSWORD_GUARD_POLICY_VERSION,
    async check(identity, scale) {
      return one(identity, async (key) => guardDecision(await read(key), clock(), scale));
    },
    async recordFailure(identity, scale) {
      return one(identity, async (key) => {
        const result = recordPasswordFailure(await read(key), clock(), scale);
        await write(key, result.state, scale);
        return result.decision;
      });
    },
    // The recovery path (an email OTP or a reset link) calls this to lift the
    // block; nothing else may, so a correct password alone cannot clear it.
    // A pair with nothing recorded is left alone: most logins are successful
    // first try, and a write per login would be pure cost.
    async recordSuccess(identity, scale) {
      return one(identity, async (key) => {
        const current = await read(key);
        if (!current.fails && !current.strikes && !current.until) return true;
        const cleared = recordPasswordSuccess(current, clock(), scale);
        await write(key, cleared, scale);
        return true;
      });
    }
  });
}

// auth-native/core/login-facts.mjs
var DAY_MS = 24 * 60 * 60 * 1e3;
async function shortHash(value) {
  const text = String(value ?? "");
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    return "";
  }
  const digest = await subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest).slice(0, 10)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
function createKvLoginFacts(store, options = {}) {
  const prefix = String(options.prefix || "acct-facts");
  const ttlSeconds = Number(options.ttlSeconds) > 0 ? Number(options.ttlSeconds) : 180 * 24 * 60 * 60;
  const now = typeof options.now === "function" ? options.now : () => Date.now();
  const keyFor = async (identity) => `${prefix}:${await shortHash(identity)}`;
  return Object.freeze({
    keyFor,
    /**
     * @returns {Promise<{first:boolean, known:boolean, countryChanged:boolean,
     *   asnChanged:boolean}>} `known` is false when the store could not be
     *   read, so the caller can tell "nothing recorded" from "no change".
     */
    async observe(identity, observed = {}) {
      const empty = { first: false, known: false, countryChanged: false, asnChanged: false };
      if (!store || !identity) return empty;
      const country = String(observed.country || "").trim().toUpperCase();
      const asn = Number(observed.asn);
      const hasCountry = country.length === 2;
      const hasAsn = Number.isFinite(asn) && asn > 0;
      if (!hasCountry && !hasAsn) return empty;
      const key = await keyFor(identity);
      if (!key) return empty;
      let previous = null;
      try {
        const raw = await store.get(key);
        previous = raw ? JSON.parse(raw) : null;
      } catch {
        return empty;
      }
      if (!previous || typeof previous !== "object") previous = null;
      const next = {
        country: hasCountry ? country : previous?.country || null,
        asn: hasAsn ? asn : previous?.asn || null,
        at: now()
      };
      const result = {
        first: !previous,
        known: Boolean(previous),
        // A first sighting records without reporting a move: the first login
        // on a new phone is not travel.
        countryChanged: Boolean(previous?.country && hasCountry && previous.country !== country),
        asnChanged: Boolean(previous?.asn && hasAsn && previous.asn !== asn)
      };
      const changed = !previous || result.countryChanged || result.asnChanged || !previous.country || !previous.asn;
      if (changed) {
        try {
          await store.put(key, JSON.stringify(next), { expirationTtl: ttlSeconds });
        } catch {
        }
      }
      return result;
    }
  });
}
function createKvIpBreadth(store, options = {}) {
  const prefix = String(options.prefix || "ip-breadth");
  const windowSeconds = Number(options.windowSeconds) > 0 ? Number(options.windowSeconds) : 60 * 60;
  const cap = Number(options.cap) > 0 ? Number(options.cap) : 50;
  const keyFor = async (ip) => `${prefix}:${await shortHash(ip)}`;
  return Object.freeze({
    keyFor,
    /**
     * @returns {Promise<{emailsFromIp:number, known:boolean}>} `known` is
     *   false when the store could not be read, so the caller never reads a
     *   failed lookup as "zero accounts, safe".
     */
    async observe(ip, identity) {
      if (!store || !ip || !identity) return { emailsFromIp: 0, known: false };
      const key = await keyFor(ip);
      if (!key) return { emailsFromIp: 0, known: false };
      let list = [];
      try {
        const raw = await store.get(key);
        if (raw) list = JSON.parse(raw);
      } catch {
        return { emailsFromIp: 0, known: false };
      }
      if (!Array.isArray(list)) list = [];
      list = list.filter((entry) => typeof entry === "string");
      const fingerprint = await shortHash(identity);
      if (!fingerprint) return { emailsFromIp: list.length, known: true };
      if (!list.includes(fingerprint)) {
        list = [...list, fingerprint].slice(-cap);
        try {
          await store.put(key, JSON.stringify(list), { expirationTtl: Math.max(60, windowSeconds) });
        } catch {
        }
      }
      return { emailsFromIp: list.length, known: true };
    }
  });
}

// auth-native/core/security-alerts.mjs
var SECURITY_ALERT_EVENTS = Object.freeze({
  CANARY_HIT: "canary-hit",
  SHADOW_BAN: "shadow-ban",
  NEW_DEVICE: "new-device"
});
var MAX_FIELD = 200;
var field = (value, max = MAX_FIELD) => typeof value === "string" ? value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim().slice(0, max) : "";
var EMAIL_SHAPE = /^([^@\s]{1,64})@([^@\s]{1,190})$/;
function maskAlertEmail(value) {
  const email = field(value, 254);
  const match = EMAIL_SHAPE.exec(email);
  if (!match) return "";
  const local = match[1];
  const head = local.slice(0, 1);
  return `${head}${"*".repeat(Math.max(3, local.length - 1))}@${match[2].toLowerCase()}`;
}
var LABELS = Object.freeze({
  [SECURITY_ALERT_EVENTS.CANARY_HIT]: "🍯 ক্যানারি অ্যাকাউন্টে চেষ্টা",
  [SECURITY_ALERT_EVENTS.SHADOW_BAN]: "👻 ছায়া-ব্যান হয়েছে",
  [SECURITY_ALERT_EVENTS.NEW_DEVICE]: "📱 নতুন ডিভাইসে লগইন"
});
function renderSecurityAlert(input = {}) {
  const event = String(input.event || "");
  const label = LABELS[event];
  if (!label) return null;
  const lines = [label];
  const email = maskAlertEmail(input.email);
  if (email) lines.push(`অ্যাকাউন্ট: ${email}`);
  const country = field(input.country, 40);
  if (country) lines.push(`দেশ: ${country}`);
  const band = field(input.band, 20);
  if (band) lines.push(`ঝুঁকি: ${band}`);
  const reasons = Array.isArray(input.reasons) ? input.reasons.map((value) => field(value, 40)).filter(Boolean).slice(0, 5) : [];
  if (reasons.length) lines.push(`কারণ: ${reasons.join(", ")}`);
  const at = Number(input.at);
  if (Number.isFinite(at) && at > 0) lines.push(`সময়: ${new Date(at).toISOString()}`);
  return Object.freeze({ event, text: lines.join("\n") });
}
async function sendSecurityAlert(env, input = {}, options = {}) {
  const rendered = renderSecurityAlert(input);
  if (!rendered) return "unknown-event";
  const token = String(env?.TG_BOT_TOKEN || "");
  const chatId = String(env?.TG_CHAT_ID || "");
  if (!token || !chatId) return "not-configured";
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== "function") return "failed";
  try {
    const response = await fetchImpl(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: rendered.text, disable_web_page_preview: true })
    });
    return response?.ok ? "sent" : "failed";
  } catch {
    return "failed";
  }
}
function createKvAlertThrottle(store, options = {}) {
  const prefix = String(options.prefix || "alert-seen");
  const windowMs = Number(options.windowMs) > 0 ? Number(options.windowMs) : 60 * 60 * 1e3;
  const now = typeof options.now === "function" ? options.now : () => Date.now();
  const digest = async (value) => {
    const subtle = globalThis.crypto?.subtle;
    if (!subtle) return String(value).length.toString(36);
    const bytes = new TextEncoder().encode(String(value));
    const hash = await subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(hash).slice(0, 8)].map((b) => b.toString(16).padStart(2, "0")).join("");
  };
  return Object.freeze({
    /** @returns {boolean} true when this event should be delivered. */
    async shouldSend(event, identity) {
      if (!store) return true;
      const key = `${prefix}:${event}:${await digest(`${identity || ""}`)}`;
      try {
        const seen = await store.get(key);
        if (seen) return false;
        await store.put(key, "1", { expirationTtl: Math.max(60, Math.ceil(windowMs / 1e3)) });
        return true;
      } catch {
        return true;
      }
    },
    /** Exposed for tests. */
    keyFor: async (event, identity) => `${prefix}:${event}:${await digest(`${identity || ""}`)}`,
    windowMs,
    now
  });
}
function sendThrottledSecurityAlert(env, store, input = {}, options = {}) {
  return Promise.resolve().then(async () => {
    const throttle = createKvAlertThrottle(store, options);
    if (!await throttle.shouldSend(input.event, input.email || input.identity || "")) return "throttled";
    return sendSecurityAlert(env, input, options);
  }).catch(() => "failed");
}

// auth-native/worker/public-auth-handler.mjs
var AUTH_API_PREFIX = "/api/auth/v1";
var PUBLIC_PROFILE_PREFIX = "/api/public/profile/";
function claimsAuthPath(pathname) {
  const path = String(pathname || "");
  return path === AUTH_API_PREFIX || path.startsWith(`${AUTH_API_PREFIX}/`) || path.startsWith(PUBLIC_PROFILE_PREFIX);
}
var AUTH_SESSION_COOKIE = "__Host-ah_session";
var AUTH_FIREBASE_COOKIE = "__Host-ah_firebase";
var AUTH_DEVICE_COOKIE = "__Host-ah_device";
var AUTH_VERIFICATION_COOKIE = "__Host-ah_verification";
var AUTHORITY_NAME = "admission-hub-global-auth-v1";
var MAX_BODY_BYTES = 24 * 1024;
var YEAR_SECONDS = 365 * 24 * 60 * 60;
var SESSION_SECONDS = 30 * 24 * 60 * 60;
var PASSWORD_MIN = 8;
var PASSWORD_MAX = 128;
var AUTH_UI_VERSION = "auth-premium-v6";
var FIREBASE_VERIFICATION_RESEND_SECONDS = Math.floor(FIREBASE_VERIFICATION_RESEND_COOLDOWN_MS / 1e3);
var JSON_HEADERS = Object.freeze({
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store, max-age=0",
  Pragma: "no-cache",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Cross-Origin-Resource-Policy": "same-site",
  Vary: "Origin"
});
var json = (request, status, body, extraHeaders = {}) => {
  const headers = new Headers({ ...JSON_HEADERS, ...corsHeaders(request) });
  for (const [name, value] of Object.entries(extraHeaders || {})) {
    if (Array.isArray(value)) value.forEach((item) => headers.append(name, item));
    else headers.set(name, value);
  }
  return new Response(JSON.stringify(body), { status, headers });
};
var cookies = (request) => Object.fromEntries(
  String(request.headers.get("Cookie") || "").split(";").map((part) => part.trim()).filter(Boolean).map((part) => {
    const index = part.indexOf("=");
    if (index < 1) return ["", ""];
    const value = part.slice(index + 1);
    try {
      return [part.slice(0, index), decodeURIComponent(value)];
    } catch {
      return [part.slice(0, index), ""];
    }
  }).filter(([key]) => key)
);
var secureCookie = (name, token, maxAge) => `${name}=${encodeURIComponent(String(token || ""))}; Path=/; Max-Age=${Math.max(0, Math.floor(maxAge))}; HttpOnly; Secure; SameSite=Strict`;
var sessionCookie = (token, maxAge) => secureCookie(AUTH_SESSION_COOKIE, token, maxAge);
var firebaseCookie = (token, maxAge) => secureCookie(AUTH_FIREBASE_COOKIE, token, maxAge);
var deviceCookie = (token) => `${AUTH_DEVICE_COOKIE}=${encodeURIComponent(token)}; Path=/; Max-Age=${YEAR_SECONDS}; HttpOnly; Secure; SameSite=Lax`;
var verificationCookie = (token, maxAge = 15 * 60) => secureCookie(AUTH_VERIFICATION_COOKIE, token, maxAge);
var clearAuthCookies = () => [sessionCookie("", 0), firebaseCookie("", 0), verificationCookie("", 0)];
async function readJson(request, maxBytes = MAX_BODY_BYTES) {
  if (!String(request.headers.get("Content-Type") || "").toLowerCase().startsWith("application/json")) {
    throw new NativeAuthError(AUTH_ERROR_CODES.INVALID_INPUT);
  }
  const declared = Number(request.headers.get("Content-Length") || 0);
  if (declared > maxBytes || !request.body) throw new NativeAuthError(AUTH_ERROR_CODES.INVALID_INPUT);
  const reader = request.body.getReader();
  const decoder3 = new TextDecoder();
  let raw = "";
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new NativeAuthError(AUTH_ERROR_CODES.INVALID_INPUT);
    }
    raw += decoder3.decode(value, { stream: true });
  }
  raw += decoder3.decode();
  if (!raw) throw new NativeAuthError(AUTH_ERROR_CODES.INVALID_INPUT);
  try {
    return JSON.parse(raw);
  } catch {
    throw new NativeAuthError(AUTH_ERROR_CODES.INVALID_INPUT);
  }
}
var clientContext = (request, existingDeviceId = "") => {
  const deviceId = /^[A-Za-z0-9_-]{20,96}$/.test(existingDeviceId) ? existingDeviceId : randomToken(24);
  const cf = request.cf || {};
  const botScore = Number(cf.botManagement?.score);
  return Object.freeze({
    deviceId,
    isNewDevice: deviceId !== existingDeviceId,
    ip: String(request.headers.get("CF-Connecting-IP") || "unknown").slice(0, 96),
    userAgent: String(request.headers.get("User-Agent") || "").slice(0, 300),
    origin: String(request.headers.get("Origin") || new URL(request.url).origin).slice(0, 256),
    country: String(cf.country || "").slice(0, 8),
    asn: Number.isFinite(Number(cf.asn)) ? Number(cf.asn) : void 0,
    botScore: Number.isFinite(botScore) ? botScore : void 0
  });
};
var shadowGuardMode = (env) => resolveGuardMode(env?.SHADOW_GUARD_ACTIVATION);
var shadowGuardStore = (env) => env?.GK_KV || env?.PUB_KV || null;
var flagCanaryHit = (env, email, context) => {
  const list = parseCanaryEmails(env?.CANARY_EMAILS);
  if (!isCanaryEmail(email, list)) return false;
  const store = shadowGuardStore(env);
  if (store) {
    const flags = createKvCanaryFlags(store);
    Promise.resolve().then(() => flags.flag(context.ip, context.deviceId)).catch(() => {
    });
  }
  sendThrottledSecurityAlert(env, store, {
    event: SECURITY_ALERT_EVENTS.CANARY_HIT,
    email,
    at: Date.now()
  });
  return true;
};
var credentials = (body) => {
  const email = String(body?.email || "").trim();
  const password = typeof body?.password === "string" ? body.password : "";
  if (!email || password.length < PASSWORD_MIN || password.length > PASSWORD_MAX || /[\r\n\u0000]/.test(password)) {
    throw new NativeAuthError(password && password.length < PASSWORD_MIN ? AUTH_ERROR_CODES.WEAK_PASSWORD : AUTH_ERROR_CODES.INVALID_INPUT);
  }
  const remember = body?.remember !== false;
  return Object.freeze({ email, password, remember });
};
var telegramWebhookInput = (body) => {
  const message = body?.message;
  const telegramUserId = String(message?.from?.id || "");
  const chatId = String(message?.chat?.id || "");
  const text = String(message?.text || "");
  const match = text.match(/^\/start(?:@[A-Za-z0-9_]{5,32})? ([A-Za-z0-9_-]{32,64})$/);
  if (!Number.isSafeInteger(body?.update_id) || message?.chat?.type !== "private" || message?.from?.is_bot === true || telegramUserId !== chatId || !/^[1-9]\d{0,19}$/.test(telegramUserId) || !match) {
    throw new NativeAuthError(AUTH_ERROR_CODES.INVALID_INPUT);
  }
  return Object.freeze({ linkToken: match[1], telegramUserId, chatId });
};
var googleCredential2 = (body) => {
  const accessToken = String(body?.accessToken || "").trim();
  const idToken = String(body?.idToken || "").trim();
  if (Boolean(accessToken) === Boolean(idToken)) throw new NativeAuthError(AUTH_ERROR_CODES.INVALID_INPUT);
  const value = accessToken || idToken;
  if (value.length < 20 || value.length > 4096 || /[\r\n\u0000;]/.test(value)) throw new NativeAuthError(AUTH_ERROR_CODES.INVALID_INPUT);
  return Object.freeze(accessToken ? { accessToken } : { idToken });
};
var facebookCredential = (body) => {
  const accessToken = String(body?.accessToken || "").trim();
  if (accessToken.length < 20 || accessToken.length > 4096 || /[\r\n\u0000;]/.test(accessToken)) {
    throw new NativeAuthError(AUTH_ERROR_CODES.INVALID_INPUT);
  }
  return Object.freeze({ accessToken });
};
var GOOGLE_AVATAR_HOSTS = Object.freeze([".googleusercontent.com"]);
var isGoogleAvatarUrl = (raw) => {
  try {
    const u = new URL(String(raw || ""));
    if (u.protocol !== "https:") return false;
    return GOOGLE_AVATAR_HOSTS.some((h) => u.hostname.endsWith(h));
  } catch {
    return false;
  }
};
var looksLikeName = (value) => {
  const v = String(value || "").trim();
  return v.length >= 2 && v.length <= 80 && /^[\p{L}\p{M} .'-]+$/u.test(v);
};
async function verifiedRecipientName(env, context, current) {
  try {
    const profile = await callAuthority(env, "/internal/profile/get-v2", {
      input: { sessionToken: current.sessionToken, email: current.user.email, subject: current.user.subject },
      context
    });
    const name = String(profile?.profile?.fullName || "").trim();
    return looksLikeName(name) ? name : "";
  } catch {
    return "";
  }
}
async function seedGoogleProfile(env, context, established, googleUser) {
  const sessionToken = String(established?.sessionToken || "");
  const email = String(googleUser?.email || "");
  const subject = String(googleUser?.subject || "");
  if (!sessionToken || !email || !subject) return;
  const input = Object.freeze({ sessionToken, email, subject });
  let current = null;
  try {
    current = await callAuthority(env, "/internal/profile/get-v2", { input, context });
  } catch {
    return;
  }
  if (!current) return;
  if (!current.profile?.fullName && looksLikeName(googleUser.displayName)) {
    try {
      await callAuthority(env, "/internal/profile/patch", { input: { ...input, fields: { fullName: String(googleUser.displayName).trim() } }, context });
    } catch {
    }
  }
  if (!current.avatar?.present && isGoogleAvatarUrl(googleUser.photoUrl)) {
    try {
      const res = await fetch(String(googleUser.photoUrl), {
        redirect: "manual",
        signal: AbortSignal.timeout(12e3),
        headers: { Accept: "image/*" }
      });
      if (!res.ok) return;
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.byteLength > 2 * 1024 * 1024) return;
      const isJpeg = buf.length > 3 && buf[0] === 255 && buf[1] === 216 && buf[2] === 255;
      const isPng = buf.length > 8 && buf[0] === 137 && buf[1] === 80 && buf[2] === 78 && buf[3] === 71;
      const mime = isJpeg ? "image/jpeg" : isPng ? "image/png" : null;
      if (!mime) return;
      await callAuthority(env, "/internal/avatar/save", {
        input: { sessionToken, email, subject, data: buf.toString("base64"), mime },
        context
      });
    } catch {
    }
  }
}
async function callAuthority(env, path, body, method = "POST") {
  if (!env?.AUTH_AUTHORITY || typeof env.AUTH_AUTHORITY.idFromName !== "function") {
    throw new NativeAuthError(AUTH_ERROR_CODES.NOT_CONFIGURED);
  }
  let response;
  try {
    const id = env.AUTH_AUTHORITY.idFromName(AUTHORITY_NAME);
    const stub = env.AUTH_AUTHORITY.get(id, { locationHint: "apac" });
    response = await stub.fetch(`https://auth.internal${path}`, method === "GET" ? { method } : {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body || {})
    });
  } catch {
    throw new NativeAuthError(AUTH_ERROR_CODES.STORAGE_UNAVAILABLE);
  }
  let data;
  try {
    data = await response.json();
  } catch {
    throw new NativeAuthError(AUTH_ERROR_CODES.STORAGE_UNAVAILABLE);
  }
  if (!response.ok || !data?.ok) {
    throw new NativeAuthError(data?.error?.code || AUTH_ERROR_CODES.STORAGE_UNAVAILABLE, {
      retryAfter: data?.error?.retryAfter || response.headers.get("Retry-After")
    });
  }
  return data.result || data;
}
function providerAvailabilityFailure(cause) {
  if (!(cause instanceof FirebaseRequestError)) return Object.freeze({ code: "PROVIDER_CHECK_FAILED", providerStatus: 0 });
  const reason = String(cause.reason || "");
  const providerStatus = Number.isInteger(cause.status) && cause.status >= 100 && cause.status <= 599 ? cause.status : 0;
  if (reason === "NETWORK_ERROR") return Object.freeze({ code: "PROVIDER_NETWORK_ERROR", providerStatus });
  if (/REFERER|REFERRER/.test(reason)) return Object.freeze({ code: "API_KEY_REFERRER_RESTRICTED", providerStatus });
  if (/ACCESS_NOT_CONFIGURED|SERVICE_DISABLED|API_NOT_ACTIVATED/.test(reason)) return Object.freeze({ code: "IDENTITY_TOOLKIT_DISABLED", providerStatus });
  if (/API_KEY/.test(reason)) return Object.freeze({ code: "API_KEY_REJECTED", providerStatus });
  if (reason === "PROJECT_NOT_FOUND") return Object.freeze({ code: "PROJECT_NOT_FOUND", providerStatus });
  if (reason === "OPERATION_NOT_ALLOWED") return Object.freeze({ code: "PROVIDER_DISABLED", providerStatus });
  return Object.freeze({ code: providerStatus ? `PROVIDER_HTTP_${providerStatus}` : "PROVIDER_CHECK_FAILED", providerStatus });
}
var PROVIDER_DIAGNOSTIC_REASONS = /* @__PURE__ */ new Set([
  "NETWORK_ERROR",
  "INVALID_PROVIDER_RESPONSE",
  "INVALID_IDP_RESPONSE",
  "NOT_CONFIGURED",
  "API_KEY_INVALID",
  "PROJECT_NOT_FOUND",
  "OPERATION_NOT_ALLOWED",
  "INVALID_EMAIL",
  "MISSING_EMAIL",
  "MISSING_PASSWORD",
  "EMAIL_EXISTS",
  "WEAK_PASSWORD",
  "INVALID_LOGIN_CREDENTIALS",
  "EMAIL_NOT_FOUND",
  "INVALID_PASSWORD",
  "USER_DISABLED",
  "TOO_MANY_ATTEMPTS_TRY_LATER",
  "TOO_MANY_ATTEMPTS",
  "IP_BLOCKED",
  "QUOTA_EXCEEDED",
  "INVALID_CONTINUE_URI",
  "UNAUTHORIZED_DOMAIN",
  "INVALID_REFRESH_TOKEN",
  "TOKEN_EXPIRED",
  "INVALID_ID_TOKEN",
  "USER_NOT_FOUND",
  "FEDERATED_USER_ID_ALREADY_LINKED",
  "MISSING_RECAPTCHA_TOKEN",
  "INVALID_RECAPTCHA_TOKEN",
  "CAPTCHA_CHECK_FAILED",
  "RECAPTCHA_CHECK_FAILED"
]);
function providerDiagnostic(cause, stage) {
  const operation = String(stage || "auth").toUpperCase().replace(/[^A-Z0-9_]/g, "_").slice(0, 24) || "AUTH";
  if (!(cause instanceof FirebaseRequestError)) return `${operation}_UNEXPECTED`;
  const reason = PROVIDER_DIAGNOSTIC_REASONS.has(cause.reason) ? cause.reason : cause.status >= 100 && cause.status <= 599 ? `HTTP_${cause.status}` : "UNKNOWN";
  return `${operation}_${reason}`;
}
function providerError(cause, stage = "auth") {
  const tagged = (error) => {
    error.providerDiagnostic = providerDiagnostic(cause, stage);
    return error;
  };
  if (!(cause instanceof FirebaseRequestError)) return tagged(new NativeAuthError(AUTH_ERROR_CODES.AUTH_PROVIDER_UNAVAILABLE));
  const reason = cause.reason;
  if (reason === "NOT_CONFIGURED" || ["API_KEY_INVALID", "PROJECT_NOT_FOUND", "OPERATION_NOT_ALLOWED"].includes(reason)) {
    return tagged(new NativeAuthError(stage.startsWith("google") || stage.startsWith("facebook") ? AUTH_ERROR_CODES.GOOGLE_UNAVAILABLE : AUTH_ERROR_CODES.NOT_CONFIGURED));
  }
  if (["INVALID_EMAIL", "MISSING_EMAIL", "MISSING_PASSWORD", "INVALID_IDP_RESPONSE"].includes(reason)) return tagged(new NativeAuthError(AUTH_ERROR_CODES.INVALID_INPUT));
  if (reason === "EMAIL_EXISTS" && (stage.startsWith("google") || stage.startsWith("facebook"))) return tagged(new NativeAuthError(AUTH_ERROR_CODES.ACCOUNT_LINK_REQUIRED));
  if (reason === "EMAIL_EXISTS") return tagged(new NativeAuthError(AUTH_ERROR_CODES.EMAIL_ALREADY_IN_USE));
  if (reason === "FEDERATED_USER_ID_ALREADY_LINKED") return tagged(new NativeAuthError(AUTH_ERROR_CODES.ACCOUNT_CONFLICT));
  if (reason === "WEAK_PASSWORD") return tagged(new NativeAuthError(AUTH_ERROR_CODES.WEAK_PASSWORD));
  if (["INVALID_LOGIN_CREDENTIALS", "EMAIL_NOT_FOUND", "INVALID_PASSWORD"].includes(reason)) return tagged(new NativeAuthError(AUTH_ERROR_CODES.INVALID_CREDENTIALS));
  if (reason === "USER_DISABLED") return tagged(new NativeAuthError(AUTH_ERROR_CODES.ACCOUNT_DISABLED));
  if (["TOO_MANY_ATTEMPTS_TRY_LATER", "TOO_MANY_ATTEMPTS", "IP_BLOCKED"].includes(reason)) {
    return tagged(new NativeAuthError(AUTH_ERROR_CODES.RATE_LIMITED, { retryAfter: 60 }));
  }
  if (stage === "verification" && ["QUOTA_EXCEEDED", "INVALID_CONTINUE_URI", "UNAUTHORIZED_DOMAIN", "NETWORK_ERROR", "INVALID_PROVIDER_RESPONSE"].includes(reason)) {
    return tagged(new NativeAuthError(AUTH_ERROR_CODES.VERIFICATION_UNAVAILABLE));
  }
  if (["refresh", "lookup-session", "passkey-refresh"].includes(stage) && ["INVALID_REFRESH_TOKEN", "TOKEN_EXPIRED", "INVALID_ID_TOKEN", "USER_NOT_FOUND"].includes(reason)) {
    return tagged(new NativeAuthError(AUTH_ERROR_CODES.SESSION_INVALID));
  }
  return tagged(new NativeAuthError(stage.startsWith("google") ? AUTH_ERROR_CODES.GOOGLE_UNAVAILABLE : AUTH_ERROR_CODES.AUTH_PROVIDER_UNAVAILABLE));
}
var assertProviderUser = (signed, user) => {
  if (signed.subject !== user.subject) throw new NativeAuthError(AUTH_ERROR_CODES.AUTH_PROVIDER_UNAVAILABLE);
  if (user.disabled) throw new NativeAuthError(AUTH_ERROR_CODES.ACCOUNT_DISABLED);
};
var telegramVerificationStatus = async ({ env, user, context, allowed }) => {
  if (!allowed) return false;
  try {
    const result = await callAuthority(env, "/internal/verification/telegram/status", {
      input: { email: user.email, subject: user.subject },
      context
    });
    return result?.linked === true;
  } catch {
    return false;
  }
};
var telegramVerificationAvailable = async (env, allowed) => {
  if (!allowed) return false;
  try {
    const result = await callAuthority(env, "/internal/verification/capabilities", {});
    return result?.telegramAvailable === true;
  } catch {
    return false;
  }
};
var emailOwnershipProven = async ({ env, user, context, allowed }) => {
  if (!allowed) return false;
  try {
    const result = await callAuthority(env, "/internal/verification/ownership/status", {
      input: { email: user.email, subject: user.subject },
      context
    });
    return result?.proven === true;
  } catch {
    return false;
  }
};
var telegramLoginAccountFor = async ({ env, email }) => {
  const address = String(email || "").trim().toLowerCase();
  if (!reservedTelegramLoginEmail(address)) return false;
  if (await isTelegramLoginEmail(address, env)) return true;
  try {
    const result = await callAuthority(env, "/internal/telegram/login-email", { email: address });
    return result?.loginAccount === true;
  } catch {
    return false;
  }
};
var firebaseReadySession = async ({ provider, jar, env, context, allowTelegram = false, trackRefresh = false }) => {
  const sessionToken = jar[AUTH_SESSION_COOKIE];
  const refreshToken = jar[AUTH_FIREBASE_COOKIE];
  if (!sessionToken || !refreshToken) throw new NativeAuthError(AUTH_ERROR_CODES.SESSION_INVALID);
  let refreshed;
  let user;
  try {
    refreshed = await provider.refresh(refreshToken);
  } catch (cause) {
    throw providerError(cause, "refresh");
  }
  try {
    user = await provider.lookup(refreshed.idToken);
  } catch (cause) {
    throw providerError(cause, "lookup-session");
  }
  assertProviderUser(refreshed, user);
  const ownershipProven = !user.emailVerified && await emailOwnershipProven({ env, user, context, allowed: true });
  const telegramLoginAccount = !user.emailVerified && !ownershipProven && await telegramLoginAccountFor({ env, email: user.email });
  const telegramVerified = telegramLoginAccount || !user.emailVerified && !ownershipProven && await telegramVerificationStatus({ env, user, context, allowed: allowTelegram });
  if (!user.emailVerified && !ownershipProven && !telegramVerified) throw new NativeAuthError(AUTH_ERROR_CODES.EMAIL_NOT_VERIFIED);
  const session = await callAuthority(env, "/internal/firebase/session/get", {
    sessionToken,
    input: { email: user.email, subject: user.subject, ...trackRefresh ? { trackRefresh: true } : {} }
  });
  return Object.freeze({ sessionToken, refreshed, user, session, telegramVerified, ownershipProven });
};
var sessionCookies = (established, refreshToken, context) => {
  const maxAge = Math.max(1, Math.min(SESSION_SECONDS, Math.floor((Number(established.sessionExpiresAt || established.expiresAt) - Date.now()) / 1e3)));
  const values = [];
  if (established.sessionToken) values.push(sessionCookie(established.sessionToken, maxAge));
  values.push(firebaseCookie(refreshToken, maxAge));
  if (context.isNewDevice) values.push(deviceCookie(context.deviceId));
  return values;
};
var authSuccess = (request, established, refreshToken, context, verification = {}, extraCookies = []) => {
  const emailVerified = verification.emailVerified !== false;
  const telegramVerified = verification.telegramVerified === true;
  const emailOwnershipProven2 = verification.emailOwnershipProven === true;
  return json(request, 200, {
    ok: true,
    authenticated: true,
    accountVerified: emailVerified || telegramVerified || emailOwnershipProven2,
    emailVerified,
    telegramVerified,
    emailOwnershipProven: emailOwnershipProven2,
    created: Boolean(established.created),
    user: established.user,
    // Phase 6, security decision travels with the session: trustOffer drives
    // the "trust this device 30 days" prompt (Chunk 3 client); HIGH risk
    // shortens expiresAt server-side.
    session: { expiresAt: established.sessionExpiresAt, security: established.security || null }
  }, { "Set-Cookie": [...sessionCookies(established, refreshToken, context), ...extraCookies] });
};
var googleEndpointReady = (env) => ["canary", "enabled"].includes(String(env?.GOOGLE_AUTH_ACTIVATION || ""));
var googlePublished = (env) => env?.GOOGLE_AUTH_ACTIVATION === "enabled";
var googleCanaryRequested = (env, url) => env?.GOOGLE_AUTH_ACTIVATION === "canary" && url.searchParams.get("googleCanary") === "1";
var facebookEndpointReady = (env) => ["canary", "enabled"].includes(String(env?.GOOGLE_AUTH_ACTIVATION || ""));
var facebookPublished = (env) => env?.GOOGLE_AUTH_ACTIVATION === "enabled";
var verificationEndpointReady = (env) => ["canary", "enabled"].includes(String(env?.VERIFICATION_AUTH_ACTIVATION || ""));
var verificationPublished = (env) => env?.VERIFICATION_AUTH_ACTIVATION === "enabled";
var telegramCanaryRequested = (env, url) => verificationEndpointReady(env) && url.searchParams.get("telegramCanary") === "1";
var telegramVerificationRequested = (env, url) => verificationPublished(env) || telegramCanaryRequested(env, url);
var emailOwnershipRequested = (env, url) => verificationPublished(env) || telegramCanaryRequested(env, url);
var currentAuthUi = (request) => request.headers.get("X-AH-Auth-UI") === AUTH_UI_VERSION;
var telegramActivationAuthorized = (request, env) => {
  const expected = String(env?.TELEGRAM_CANARY_ACTIVATION_SECRET || "");
  const supplied = String(request.headers.get("X-AH-Telegram-Activation") || "");
  return /^[A-Za-z0-9_-]{32,128}$/.test(expected) && supplied.length === expected.length && constantTimeEqual(supplied, expected);
};
var ADMIN_POLICY_KEYS = Object.freeze(["codeTtlSeconds", "maxAttempts", "resendCooldownSeconds", "lockoutSeconds", "maxProviderRetries", "circuitFailureThreshold", "circuitCooldownSeconds", "lowQuotaRatio"]);
var ADMIN_PROVIDER_KEYS = Object.freeze(["id", "enabled", "priority", "dailyQuota", "timeoutMs", "label"]);
var pickKeys = (source, keys) => Object.fromEntries(keys.filter((key) => Object.prototype.hasOwnProperty.call(source, key)).filter((key) => ["string", "number", "boolean"].includes(typeof source[key])).map((key) => [key, source[key]]));
var adminVerificationConfigInput = (raw) => {
  const sent = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const out = {};
  if (typeof sent.enabled === "boolean") out.enabled = sent.enabled;
  if (sent.policy && typeof sent.policy === "object" && !Array.isArray(sent.policy)) out.policy = pickKeys(sent.policy, ADMIN_POLICY_KEYS);
  if (Array.isArray(sent.providers)) {
    out.providers = sent.providers.slice(0, 64).filter((row) => row && typeof row === "object" && !Array.isArray(row)).map((row) => pickKeys(row, ADMIN_PROVIDER_KEYS));
  }
  if (Array.isArray(sent.allowedDomains)) out.allowedDomains = sent.allowedDomains.filter((value) => typeof value === "string").slice(0, 200);
  return out;
};
var adminAuthorized = (request, env) => {
  const expected = String(env?.ADMIN_TOKEN || "");
  const supplied = String(request.headers.get("X-AH-Admin-Token") || "");
  return expected.length >= 20 && supplied.length === expected.length && constantTimeEqual(supplied, expected);
};
var passkeyEndpointReady = (env) => ["canary", "enabled"].includes(String(env?.PASSKEY_AUTH_ACTIVATION || ""));
var passkeyPublished = (env) => env?.PASSKEY_AUTH_ACTIVATION === "enabled";
var passkeyCanaryRequested = (env, url) => env?.PASSKEY_AUTH_ACTIVATION === "canary" && url.searchParams.get("passkeyCanary") === "1";
var pendingDeps = () => ({ callAuthority, json, authSuccess, verificationCookie, deviceCookie, providerError });
function createNativeAuthHandler({ fetchImpl = globalThis.fetch } = {}) {
  const publicConfigCache = /* @__PURE__ */ new WeakMap();
  return async function handleNativeAuthRequest(request, env, executionContext) {
    const url = new URL(request.url);
    const isPublicProfileRoute = url.pathname.startsWith(PUBLIC_PROFILE_PREFIX);
    if (!claimsAuthPath(url.pathname)) return null;
    const origin = request.headers.get("Origin") || "";
    const telegramOperation = request.method === "POST" && [
      `${AUTH_API_PREFIX}/telegram/webhook`,
      `${AUTH_API_PREFIX}/telegram/canary/activate`,
      `${AUTH_API_PREFIX}/telegram/canary/deactivate`
    ].includes(url.pathname);
    const originOptional = request.method === "GET" || telegramOperation;
    if (!origin && !originOptional || origin && !allowedOrigin(origin)) {
      return json(request, 403, { ok: false, error: { code: "ORIGIN_FORBIDDEN", message: "অনুমোদিত উৎস নয়।" } });
    }
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          ...JSON_HEADERS,
          ...corsHeaders(request),
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "content-type, x-ah-admin-token, x-ah-auth-ui, x-ah-signup-flow",
          "Access-Control-Max-Age": "600"
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
    const googleRequest = request.method === "POST" && url.pathname === `${AUTH_API_PREFIX}/google`;
    let authStage = "PROVIDER_CONFIG";
    try {
      if (request.method === "POST" && [
        `${AUTH_API_PREFIX}/telegram/canary/activate`,
        `${AUTH_API_PREFIX}/telegram/canary/deactivate`
      ].includes(url.pathname)) {
        if (url.hostname !== "admission-gk.admissionhub.workers.dev" || !["canary", "enabled"].includes(env?.VERIFICATION_AUTH_ACTIVATION) || !telegramActivationAuthorized(request, env)) {
          return json(request, 403, { ok: false, error: { code: "FORBIDDEN", message: "অনুমতি নেই।" } });
        }
        await readJson(request);
        const action = url.pathname.endsWith("/deactivate") ? "deactivate" : "activate";
        const result = await callAuthority(env, `/internal/verification/telegram/${action}`, {});
        return json(request, 200, {
          ok: true,
          ...action === "activate" ? {
            ready: result?.ready === true,
            identityReady: result?.identityReady === true,
            webhookReady: result?.webhookReady === true,
            endpointAccepted: result?.endpointAccepted === true,
            webhookChanged: result?.webhookChanged === true
          } : { removed: result?.removed === true }
        });
      }
      if (request.method === "POST" && url.pathname === `${AUTH_API_PREFIX}/telegram/webhook`) {
        const expected = await resolveTelegramWebhookSecret(env);
        const supplied = String(request.headers.get("X-Telegram-Bot-Api-Secret-Token") || "");
        if (!validTelegramWebhookSecret(expected) || supplied.length !== expected.length || !constantTimeEqual(supplied, expected)) {
          return json(request, 403, { ok: false, error: { code: "FORBIDDEN", message: "অনুমতি নেই।" } });
        }
        const payload = await readJson(request);
        let input;
        try {
          input = telegramWebhookInput(payload);
        } catch {
          return json(request, 200, { ok: true });
        }
        try {
          await callAuthority(env, "/internal/verification/telegram/webhook", { input });
        } catch (cause) {
          if (cause?.code !== AUTH_ERROR_CODES.OTP_INVALID) throw cause;
        }
        return json(request, 200, { ok: true });
      }
      if (request.method === "GET" && url.pathname === `${AUTH_API_PREFIX}/config`) {
        const googleCanary = googleCanaryRequested(env, url);
        const passkeyCanary = passkeyCanaryRequested(env, url);
        const telegramCanary = telegramCanaryRequested(env, url);
        const cacheVariant = `${googleCanary ? "google-canary" : "public"}:${passkeyCanary ? "passkey-canary" : "public"}:${telegramCanary ? "telegram-canary" : "public"}`;
        const cache = publicConfigCache.get(env);
        const cached = cache?.get(cacheVariant);
        if (cached && cached.expiresAt > Date.now()) return json(request, 200, cached.body);
        const health = await callAuthority(env, "/internal/ping", null, "GET");
        let firebaseReady = false;
        let project = null;
        let availability = Object.freeze({ code: provider.configured ? "PROJECT_CHECK_FAILED" : "CREDENTIAL_MISSING", providerStatus: 0 });
        if (provider.configured) {
          try {
            project = await provider.inspectProject();
            firebaseReady = project.projectIdentified && project.continueDomainAuthorized;
            availability = Object.freeze({
              code: !project.projectIdentified ? "PROJECT_NOT_IDENTIFIED" : !project.continueDomainAuthorized ? "PAGES_DOMAIN_NOT_AUTHORIZED" : "READY",
              providerStatus: 0
            });
          } catch (cause) {
            availability = providerAvailabilityFailure(cause);
          }
        }
        const available = firebaseReady && health.ok === true;
        const googleRequested = googlePublished(env) || googleCanary;
        let google = {
          available: false,
          availabilityCode: googleRequested ? "PROVIDER_CHECK_FAILED" : googleEndpointReady(env) ? "LIVE_E2E_PENDING" : "LIVE_E2E_NOT_APPROVED"
        };
        if (available && googleRequested) {
          try {
            const discovered = project?.google?.enabled && project.google.clientId ? { available: true, clientId: project.google.clientId } : await provider.inspectGoogleProvider();
            google = { available: discovered.available === true, availabilityCode: "READY", clientId: discovered.clientId };
          } catch (cause) {
            const failure = providerAvailabilityFailure(cause);
            google = { available: false, availabilityCode: failure.code };
          }
        }
        const facebookRequested = facebookPublished(env);
        let facebook = {
          available: false,
          availabilityCode: facebookRequested ? "PROVIDER_CHECK_FAILED" : facebookEndpointReady(env) ? "LIVE_E2E_PENDING" : "LIVE_E2E_NOT_APPROVED"
        };
        if (available && facebookRequested) {
          try {
            const discovered = project?.facebook?.enabled && project.facebook.clientId ? { available: true, clientId: project.facebook.clientId } : await provider.inspectFacebookProvider();
            facebook = { available: discovered.available === true, availabilityCode: "READY", clientId: discovered.clientId };
          } catch (cause) {
            const failure = providerAvailabilityFailure(cause);
            facebook = { available: false, availabilityCode: failure.code };
          }
        }
        const verificationRequested = verificationPublished(env) || telegramCanary;
        let telegramAvailable = false;
        let backup = {
          available: false,
          availabilityCode: verificationRequested ? "STATUS_UNAVAILABLE" : verificationEndpointReady(env) ? "LIVE_E2E_PENDING" : "NOT_ACTIVATED",
          genericFlow: true,
          providerNamesExposed: false
        };
        if (available && verificationRequested) {
          try {
            const capabilities = await callAuthority(env, "/internal/verification/capabilities", {});
            telegramAvailable = capabilities?.telegramAvailable === true;
            backup = {
              available: capabilities?.available === true,
              availabilityCode: String(capabilities?.availabilityCode || "STATUS_UNAVAILABLE"),
              genericFlow: true,
              providerNamesExposed: false,
              contactInput: ["none", "optional", "required"].includes(capabilities?.contactInput) ? capabilities.contactInput : "none",
              maxAttempts: Number(capabilities?.maxAttempts || 5),
              expiresInSeconds: Number(capabilities?.expiresInSeconds || 300)
            };
          } catch {
            backup = { available: false, availabilityCode: "STATUS_UNAVAILABLE", genericFlow: true, providerNamesExposed: false };
          }
        }
        const emailOwnership = {
          available: verificationRequested && backup?.available === true,
          availabilityCode: verificationRequested ? String(backup?.availabilityCode || "STATUS_UNAVAILABLE") : verificationEndpointReady(env) ? "LIVE_E2E_PENDING" : "NOT_ACTIVATED",
          verifiesEmailOwnership: true,
          codeLength: 6,
          maxAttempts: Number(backup?.maxAttempts || 5),
          expiresInSeconds: Number(backup?.expiresInSeconds || 300),
          providerNamesExposed: false
        };
        const telegramVerification = {
          available: verificationRequested && telegramAvailable,
          availabilityCode: verificationRequested ? String(backup?.availabilityCode || "STATUS_UNAVAILABLE") : verificationEndpointReady(env) ? "LIVE_E2E_PENDING" : "NOT_ACTIVATED",
          optional: true,
          codeLength: 6,
          expiresInSeconds: Number(backup?.expiresInSeconds || 300),
          maxAttempts: Number(backup?.maxAttempts || 5),
          verifiesEmailOwnership: false,
          canonicalIdentity: "firebase-uid"
        };
        const passkeyAvailable = available && health.schema >= 3 && (passkeyPublished(env) || passkeyCanary);
        const passkeyEnrollmentAvailable = available && health.schema >= 3 && passkeyEndpointReady(env);
        const publicBackup = verificationPublished(env) || telegramCanary ? backup : {
          available: false,
          availabilityCode: "LIVE_E2E_PENDING",
          genericFlow: true,
          providerNamesExposed: false
        };
        const body = {
          ok: true,
          auth: {
            version: AUTH_NATIVE_VERSION,
            uiContract: AUTH_UI_VERSION,
            onboarding: {
              version: "premium-onboarding-v1",
              firstEntryRemembered: true,
              guestAllowed: true,
              profileVersion: 1
            },
            mode: "firebase-canonical-multi-method",
            provider: "firebase",
            available,
            availabilityCode: available ? "READY" : availability.code,
            providerStatus: availability.providerStatus,
            storage: health.storage,
            accountVerificationRequired: true,
            emailVerifiedRequired: !telegramVerification.available && !emailOwnership.available,
            emailOwnershipProof: emailOwnership.available ? "email-otp-or-firebase-email-verification" : "firebase-email-verification-only",
            methods: {
              google,
              facebook,
              telegramLogin: available && telegramLoginReady(env) ? { available: true, botId: telegramLoginBotId(env) } : { available: false },
              passkey: {
                available: passkeyAvailable,
                enrollmentAvailable: passkeyEnrollmentAvailable,
                availabilityCode: passkeyAvailable ? "READY" : passkeyEndpointReady(env) ? "LIVE_E2E_PENDING" : "NOT_ACTIVATED",
                requiresEnrollment: true,
                neverMandatory: true
              },
              emailPassword: { available, availabilityCode: available ? "READY" : availability.code },
              passwordReset: { available, availabilityCode: available ? "READY" : availability.code },
              profile: { available, version: 1, accountScoped: true, pendingTicketScoped: true },
              emailOwnership,
              telegramVerification,
              backup: publicBackup
            },
            verificationEmail: {
              kind: "address-verification",
              dailyCapacity: 1e3,
              resendCooldownSeconds: FIREBASE_VERIFICATION_RESEND_SECONDS,
              statusCheckAvailable: true
            },
            registeredAccountLimit: "unlimited",
            session: { transport: "secure-http-only-cookie", maxAge: SESSION_SECONDS }
          }
        };
        const nextCache = cache || /* @__PURE__ */ new Map();
        nextCache.set(cacheVariant, { body, expiresAt: Date.now() + 3e4 });
        if (!cache) publicConfigCache.set(env, nextCache);
        return json(request, 200, body);
      }
      if (request.method === "POST" && url.pathname === `${AUTH_API_PREFIX}/signup`) {
        if (!provider.configured) throw new NativeAuthError(AUTH_ERROR_CODES.NOT_CONFIGURED);
        const telegramRequested = telegramVerificationRequested(env, url);
        if (telegramRequested && !currentAuthUi(request)) {
          throw new NativeAuthError(AUTH_ERROR_CODES.CLIENT_UPDATE_REQUIRED);
        }
        const turnstileBody = await readJson(request);
        await verifyTurnstile({ env, token: turnstileBody?.turnstileToken, ip: context.ip, fetchImpl });
        const input = credentials(turnstileBody);
        if (isDisposableEmail(input.email)) throw new NativeAuthError(AUTH_ERROR_CODES.DISPOSABLE_EMAIL);
        if (reservedTelegramLoginEmail(input.email)) throw new NativeAuthError(AUTH_ERROR_CODES.DISPOSABLE_EMAIL);
        const prepared = await callAuthority(env, "/internal/firebase/rate", { input: { operation: "signup", email: input.email }, context });
        if (emailOwnershipRequested(env, url) && pendingSignupRequested(request)) return beginPendingSignup({ request, env, context, prepared, password: input.password, deps: pendingDeps() });
        let signed;
        try {
          signed = await provider.signUp(prepared.email, input.password);
        } catch (cause) {
          throw providerError(cause, "signup");
        }
        const telegramAvailable = await telegramVerificationAvailable(env, telegramRequested);
        if (telegramRequested) {
          try {
            const temporaryRefreshMaterial = signed.refreshToken;
            const ticket = await callAuthority(env, "/internal/firebase/account-verification/begin", {
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
              "Set-Cookie": [
                ...context.isNewDevice ? [deviceCookie(context.deviceId)] : [],
                verificationCookie(ticket.verificationTicket)
              ]
            });
          } catch {
            throw new NativeAuthError(AUTH_ERROR_CODES.VERIFICATION_UNAVAILABLE, {
              message: "অ্যাকাউন্ট তৈরি হয়েছে, কিন্তু যাচাইয়ের পদ্ধতি এখন প্রস্তুত করা যাচ্ছে না, কিছু পাঠানো হয়নি। একটু পরে এই ইমেইল দিয়ে লগইন করুন।"
            });
          }
        }
        try {
          await callAuthority(env, "/internal/firebase/rate", { input: { operation: "verification-send", email: prepared.email }, context });
          await provider.sendVerificationEmail(signed.idToken, prepared.email);
        } catch (cause) {
          try {
            await provider.deleteAccount(signed.idToken);
          } catch {
          }
          throw cause instanceof NativeAuthError ? cause : providerError(cause, "verification");
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
            dailyCapacity: 1e3,
            resendAfter: FIREBASE_VERIFICATION_RESEND_SECONDS
          }
        }, context.isNewDevice ? { "Set-Cookie": deviceCookie(context.deviceId) } : {});
      }
      if (request.method === "POST" && url.pathname === `${AUTH_API_PREFIX}/password-reset`) {
        if (!provider.configured) throw new NativeAuthError(AUTH_ERROR_CODES.NOT_CONFIGURED);
        const body = await readJson(request);
        await verifyTurnstile({ env, token: body?.turnstileToken, ip: context.ip, fetchImpl });
        const email = normalizeAuthEmail(body?.email);
        if (isDisposableEmail(email)) throw new NativeAuthError(AUTH_ERROR_CODES.DISPOSABLE_EMAIL);
        const prepared = await callAuthority(env, "/internal/firebase/rate", {
          input: { operation: "password-reset", email },
          context
        });
        try {
          await provider.sendPasswordResetEmail(prepared.email);
        } catch (cause) {
          const privateAccountResult = cause instanceof FirebaseRequestError && ["EMAIL_NOT_FOUND", "USER_DISABLED", "INVALID_EMAIL", "MISSING_EMAIL"].includes(cause.reason);
          if (!privateAccountResult) throw providerError(cause, "password-reset");
        }
        return json(request, 202, {
          ok: true,
          accepted: true,
          deliveryDisclosed: false,
          resendAfter: FIREBASE_VERIFICATION_RESEND_SECONDS
        }, context.isNewDevice ? { "Set-Cookie": deviceCookie(context.deviceId) } : {});
      }
      if (request.method === "POST" && url.pathname === `${AUTH_API_PREFIX}/verification/resend`) {
        if (!provider.configured) throw new NativeAuthError(AUTH_ERROR_CODES.NOT_CONFIGURED);
        const turnstileBody = await readJson(request);
        await verifyTurnstile({ env, token: turnstileBody?.turnstileToken, ip: context.ip, fetchImpl });
        const input = credentials(turnstileBody);
        const prepared = await callAuthority(env, "/internal/firebase/rate", { input: { operation: "verification-resend", email: input.email }, context });
        let signed;
        let user;
        try {
          signed = await provider.signIn(prepared.email, input.password);
        } catch (cause) {
          throw providerError(cause, "signin");
        }
        try {
          user = await provider.lookup(signed.idToken);
        } catch (cause) {
          throw providerError(cause, "lookup");
        }
        assertProviderUser(signed, user);
        if (user.emailVerified) return json(request, 200, { ok: true, alreadyVerified: true, authenticated: false });
        await callAuthority(env, "/internal/firebase/rate", { input: { operation: "verification-send", email: user.email }, context });
        try {
          await provider.sendVerificationEmail(signed.idToken, user.email);
        } catch (cause) {
          throw providerError(cause, "verification");
        }
        return json(request, 202, {
          ok: true,
          authenticated: false,
          verification: { sent: true, emailMasked: prepared.emailMask, dailyCapacity: 1e3, resendAfter: FIREBASE_VERIFICATION_RESEND_SECONDS }
        }, context.isNewDevice ? { "Set-Cookie": deviceCookie(context.deviceId) } : {});
      }
      if (request.method === "POST" && url.pathname === `${AUTH_API_PREFIX}/login`) {
        if (!provider.configured) throw new NativeAuthError(AUTH_ERROR_CODES.NOT_CONFIGURED);
        const turnstileBody = await readJson(request);
        await verifyTurnstile({ env, token: turnstileBody?.turnstileToken, ip: context.ip, fetchImpl });
        const input = credentials(turnstileBody);
        const prepared = await callAuthority(env, "/internal/firebase/rate", { input: { operation: "login", email: input.email }, context });
        if (Number(prepared?.retryAfter) > 0) {
          return json(request, 429, { ok: false, error: { code: "RATE_LIMITED", message: "অনেকবার চেষ্টা হয়েছে, একটু পরে আবার চেষ্টা করুন।" } }, { "Retry-After": String(prepared.retryAfter) });
        }
        const canaryHit = flagCanaryHit(env, prepared.email, context);
        const mode = shadowGuardMode(env);
        const guardActive = mode !== SHADOW_GUARD_MODES.OFF || canaryHit;
        const enforcing = mode === SHADOW_GUARD_MODES.ENFORCE || canaryHit;
        const guardStore = shadowGuardStore(env);
        const passwordGuard = guardActive && guardStore ? createKvPasswordGuard(guardStore) : null;
        const guardKey = passwordGuard ? passwordGuardKey(prepared.email, context.ip) : "";
        let priorStrikes = 0;
        if (passwordGuard) {
          let state = null;
          try {
            state = await passwordGuard.check(guardKey, "user");
          } catch {
            state = null;
          }
          priorStrikes = passwordFailuresSoFar(state, "user");
          if (enforcing && state?.blocked) {
            return json(request, 429, {
              ok: false,
              error: { code: "RATE_LIMITED", message: "অনেকবার ভুল পাসওয়ার্ড দেওয়া হয়েছে। কিছুক্ষণ পর আবার চেষ্টা করুন।" }
            }, { "Retry-After": String(state.retryAfterSeconds) });
          }
        }
        let shadow = null;
        if (guardActive) {
          let accountFacts = null;
          let breadth = null;
          try {
            accountFacts = guardStore ? await createKvLoginFacts(guardStore).observe(prepared.email, { country: context.country, asn: context.asn }) : null;
            breadth = guardStore ? await createKvIpBreadth(guardStore).observe(context.ip, prepared.email) : null;
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
            accountState: canaryHit ? "suspended" : void 0
          });
          if (shadow.shadowBan) {
            sendThrottledSecurityAlert(env, guardStore, {
              event: SECURITY_ALERT_EVENTS.SHADOW_BAN,
              email: prepared.email,
              band: shadow.band,
              reasons: enforcing ? shadow.reasons : [...shadow.reasons, "observe-only"],
              at: Date.now()
            });
            if (enforcing) {
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
          if (cause instanceof FirebaseRequestError && ["INVALID_LOGIN_CREDENTIALS", "EMAIL_NOT_FOUND", "INVALID_PASSWORD"].includes(cause.reason)) {
            try {
              const recorded = await callAuthority(env, "/internal/firebase/login/failure", { input: { email: prepared.email }, context });
              failureRetryAfter = Number(recorded?.retryAfter || 0);
            } catch {
            }
            if (passwordGuard) {
              try {
                const counted = await passwordGuard.recordFailure(guardKey, "user");
                if (counted?.blocked) failureRetryAfter = Math.max(failureRetryAfter, counted.retryAfterSeconds);
              } catch {
              }
            }
          }
          const error = providerError(cause, "signin");
          if (failureRetryAfter > 0) error.retryAfter = Math.max(Number(error.retryAfter || 0), failureRetryAfter);
          throw error;
        }
        try {
          user = await provider.lookup(signed.idToken);
        } catch (cause) {
          throw providerError(cause, "lookup");
        }
        assertProviderUser(signed, user);
        if (passwordGuard) {
          try {
            await passwordGuard.recordSuccess(guardKey, "user");
          } catch {
          }
        }
        if (guardActive && context.isNewDevice && (enforcing || shadow?.band === "high")) {
          sendThrottledSecurityAlert(env, guardStore, {
            event: SECURITY_ALERT_EVENTS.NEW_DEVICE,
            email: prepared.email,
            band: shadow ? shadow.band : "low",
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
            const ticket = await callAuthority(env, "/internal/firebase/account-verification/begin", {
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
              "Set-Cookie": [
                ...context.isNewDevice ? [deviceCookie(context.deviceId)] : [],
                verificationCookie(ticket.verificationTicket)
              ]
            });
          } catch {
          }
        }
        if (!accountVerified) throw new NativeAuthError(AUTH_ERROR_CODES.EMAIL_NOT_VERIFIED);
        const established = await callAuthority(env, "/internal/firebase/session/create", {
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
        if (established.challenge) {
          let ticket;
          try {
            const temporaryRefreshMaterial = signed.refreshToken;
            ticket = await callAuthority(env, "/internal/firebase/account-verification/begin", {
              input: {
                email: user.email,
                subject: user.subject,
                refreshToken: temporaryRefreshMaterial,
                purpose: "new-device"
              },
              context
            });
          } catch {
            throw new NativeAuthError(AUTH_ERROR_CODES.VERIFICATION_UNAVAILABLE, {
              message: "নিরাপত্তার জন্য এই ডিভাইসটি এখন যাচাই করা যাচ্ছে না, একটু পরে আবার চেষ্টা করুন।"
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
              reason: "new-device",
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
            "Set-Cookie": [
              ...context.isNewDevice ? [deviceCookie(context.deviceId)] : [],
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
      if (request.method === "POST" && url.pathname === `${AUTH_API_PREFIX}/google`) {
        if (!provider.configured || !googleEndpointReady(env)) throw new NativeAuthError(AUTH_ERROR_CODES.GOOGLE_UNAVAILABLE);
        try {
          await provider.inspectGoogleProvider();
        } catch (cause) {
          throw providerError(cause, "google-config");
        }
        authStage = "CREDENTIAL_INPUT";
        const credential = googleCredential2(await readJson(request));
        authStage = "RATE_CHECK";
        await callAuthority(env, "/internal/firebase/rate", { input: { operation: "google" }, context });
        let signed;
        let user;
        authStage = "FIREBASE_EXCHANGE";
        try {
          signed = await provider.signInWithGoogle(credential);
        } catch (cause) {
          throw providerError(cause, "google-signin");
        }
        authStage = "IDENTITY_LOOKUP";
        try {
          user = await provider.lookup(signed.idToken);
        } catch (cause) {
          throw providerError(cause, "google-lookup");
        }
        assertProviderUser(signed, user);
        if (!user.providers.includes("google.com")) throw new NativeAuthError(AUTH_ERROR_CODES.ACCOUNT_CONFLICT);
        if (!user.emailVerified) throw new NativeAuthError(AUTH_ERROR_CODES.EMAIL_NOT_VERIFIED);
        authStage = "ACCOUNT_SESSION";
        let established;
        try {
          established = await callAuthority(env, "/internal/firebase/session/create", { input: { email: user.email, subject: user.subject }, context });
        } catch (cause) {
          if (cause?.code === AUTH_ERROR_CODES.ACCOUNT_CONFLICT && signed.isNewUser) {
            let deleted = false;
            try {
              deleted = (await provider.deleteAccount(signed.idToken))?.deleted === true;
            } catch {
            }
            if (!deleted) throw new NativeAuthError(AUTH_ERROR_CODES.ACCOUNT_CONFLICT);
            throw new NativeAuthError(AUTH_ERROR_CODES.ACCOUNT_LINK_REQUIRED);
          }
          throw cause;
        }
        const enrichment = seedGoogleProfile(env, context, established, user).catch(() => {
        });
        if (typeof executionContext?.waitUntil === "function") executionContext.waitUntil(enrichment);
        else await enrichment;
        const result = authSuccess(request, established, signed.refreshToken, context);
        result.headers.set("X-AH-Auth-Stage", "SESSION_CREATED");
        return result;
      }
      if (request.method === "POST" && url.pathname === `${AUTH_API_PREFIX}/google/link`) {
        if (!provider.configured || !googleEndpointReady(env)) throw new NativeAuthError(AUTH_ERROR_CODES.GOOGLE_UNAVAILABLE);
        const body = await readJson(request);
        const input = credentials(body);
        const credential = googleCredential2(body);
        if (!credential.accessToken) throw new NativeAuthError(AUTH_ERROR_CODES.INVALID_INPUT);
        const email = normalizeAuthEmail(input.email);
        let googleIdentity;
        try {
          googleIdentity = await provider.googleIdentity(credential.accessToken);
        } catch (cause) {
          throw providerError(cause, "google-identity");
        }
        if (normalizeAuthEmail(googleIdentity.email) !== email) throw new NativeAuthError(AUTH_ERROR_CODES.ACCOUNT_CONFLICT);
        const prepared = await callAuthority(env, "/internal/firebase/rate", { input: { operation: "login", email }, context });
        let passwordSession;
        let passwordUser;
        try {
          passwordSession = await provider.signIn(prepared.email, input.password);
        } catch (cause) {
          throw providerError(cause, "signin");
        }
        try {
          passwordUser = await provider.lookup(passwordSession.idToken);
        } catch (cause) {
          throw providerError(cause, "lookup");
        }
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
        try {
          linked = await provider.linkGoogle(passwordSession.idToken, credential);
        } catch (cause) {
          throw providerError(cause, "google-link");
        }
        if (linked.subject !== passwordSession.subject) throw new NativeAuthError(AUTH_ERROR_CODES.ACCOUNT_CONFLICT);
        try {
          user = await provider.lookup(linked.idToken);
        } catch (cause) {
          throw providerError(cause, "google-lookup");
        }
        assertProviderUser(linked, user);
        if (!user.providers.includes("google.com") || !user.googleSubjects.includes(googleIdentity.subject)) {
          throw new NativeAuthError(AUTH_ERROR_CODES.ACCOUNT_CONFLICT);
        }
        const established = await callAuthority(env, "/internal/firebase/session/create", { input: { email: user.email, subject: user.subject }, context });
        return authSuccess(request, established, linked.refreshToken, context, {
          emailVerified: user.emailVerified === true,
          telegramVerified: user.emailVerified !== true && passwordTelegramVerified
        });
      }
      if (request.method === "POST" && url.pathname === `${AUTH_API_PREFIX}/telegram/login`) {
        if (!provider.configured || !telegramLoginReady(env)) throw new NativeAuthError(AUTH_ERROR_CODES.TELEGRAM_VERIFICATION_UNAVAILABLE);
        authStage = "CREDENTIAL_INPUT";
        let telegramUser;
        try {
          telegramUser = await verifyTelegramLogin(await readJson(request), env);
        } catch {
          throw new NativeAuthError(AUTH_ERROR_CODES.TELEGRAM_VERIFICATION_INVALID);
        }
        authStage = "RATE_CHECK";
        await callAuthority(env, "/internal/firebase/rate", { input: { operation: "telegram-login" }, context });
        const credentials2 = await telegramLoginCredentials(telegramUser.id, env);
        authStage = "FIREBASE_EXCHANGE";
        let signed;
        try {
          signed = await provider.signIn(credentials2.email, credentials2.password);
        } catch (signInCause) {
          try {
            signed = await provider.signUp(credentials2.email, credentials2.password);
          } catch (cause) {
            if (String(cause?.reason || "").startsWith("EMAIL_EXISTS")) throw providerError(signInCause, "telegram-signin");
            throw providerError(cause, "telegram-signup");
          }
        }
        authStage = "IDENTITY_LOOKUP";
        let user;
        try {
          user = await provider.lookup(signed.idToken);
        } catch (cause) {
          throw providerError(cause, "telegram-lookup");
        }
        assertProviderUser(signed, user);
        authStage = "ACCOUNT_SESSION";
        const established = await callAuthority(env, "/internal/firebase/session/create", {
          input: { email: user.email, subject: user.subject, verified: true },
          context
        });
        const enrichment = seedGoogleProfile(env, context, established, { ...user, displayName: telegramUser.displayName, photoUrl: "" }).catch(() => {
        });
        if (typeof executionContext?.waitUntil === "function") executionContext.waitUntil(enrichment);
        else await enrichment;
        const result = authSuccess(request, established, signed.refreshToken, context, { emailVerified: false, telegramVerified: true });
        result.headers.set("X-AH-Auth-Stage", "SESSION_CREATED");
        return result;
      }
      if (request.method === "POST" && url.pathname === `${AUTH_API_PREFIX}/facebook`) {
        if (!provider.configured || !facebookEndpointReady(env)) throw new NativeAuthError(AUTH_ERROR_CODES.GOOGLE_UNAVAILABLE);
        try {
          await provider.inspectFacebookProvider();
        } catch (cause) {
          throw providerError(cause, "facebook-config");
        }
        const credential = facebookCredential(await readJson(request));
        await callAuthority(env, "/internal/firebase/rate", { input: { operation: "facebook" }, context });
        let signed;
        let user;
        try {
          signed = await provider.signInWithFacebook(credential);
        } catch (cause) {
          throw providerError(cause, "facebook-signin");
        }
        try {
          user = await provider.lookup(signed.idToken);
        } catch (cause) {
          throw providerError(cause, "facebook-lookup");
        }
        assertProviderUser(signed, user);
        if (!user.providers.includes("facebook.com")) throw new NativeAuthError(AUTH_ERROR_CODES.ACCOUNT_CONFLICT);
        if (!user.emailVerified) {
          let facebookUser = null;
          try {
            facebookUser = await provider.facebookIdentity(credential.accessToken);
          } catch {
          }
          if (!facebookUser || normalizeAuthEmail(facebookUser.email) !== normalizeAuthEmail(user.email)) {
            throw new NativeAuthError(AUTH_ERROR_CODES.EMAIL_NOT_VERIFIED);
          }
        }
        let established;
        try {
          established = await callAuthority(env, "/internal/firebase/session/create", { input: { email: user.email, subject: user.subject }, context });
        } catch (cause) {
          if (cause?.code === AUTH_ERROR_CODES.ACCOUNT_CONFLICT && signed.isNewUser) {
            let deleted = false;
            try {
              deleted = (await provider.deleteAccount(signed.idToken))?.deleted === true;
            } catch {
            }
            if (!deleted) throw new NativeAuthError(AUTH_ERROR_CODES.ACCOUNT_CONFLICT);
            throw new NativeAuthError(AUTH_ERROR_CODES.ACCOUNT_LINK_REQUIRED);
          }
          throw cause;
        }
        try {
          const establishedBody = established?.result || established;
          await seedGoogleProfile(env, context, establishedBody, user);
        } catch {
        }
        return authSuccess(request, established, signed.refreshToken, context);
      }
      if (request.method === "POST" && url.pathname === `${AUTH_API_PREFIX}/account-verification/email/start`) {
        if (!provider.configured) throw new NativeAuthError(AUTH_ERROR_CODES.NOT_CONFIGURED);
        const verificationTicket = jar[AUTH_VERIFICATION_COOKIE];
        if (!verificationTicket) throw new NativeAuthError(AUTH_ERROR_CODES.TELEGRAM_VERIFICATION_INVALID);
        await readJson(request);
        const material = await callAuthority(env, "/internal/firebase/account-verification/material", {
          verificationTicket,
          context
        });
        let refreshed;
        let user;
        try {
          refreshed = await provider.refresh(material.refreshToken);
        } catch (cause) {
          throw providerError(cause, "refresh");
        }
        try {
          user = await provider.lookup(refreshed.idToken);
        } catch (cause) {
          throw providerError(cause, "lookup-session");
        }
        assertProviderUser(refreshed, user);
        const ownershipAlreadyProven = !user.emailVerified && await emailOwnershipProven({ env, user, context, allowed: true });
        if (user.emailVerified || ownershipAlreadyProven) {
          return json(request, 200, { ok: true, alreadyVerified: true, authenticated: false });
        }
        await callAuthority(env, "/internal/firebase/rate", { input: { operation: "verification-send", email: user.email }, context });
        try {
          await provider.sendVerificationEmail(refreshed.idToken, user.email);
        } catch (cause) {
          throw providerError(cause, "verification");
        }
        return json(request, 202, {
          ok: true,
          authenticated: false,
          verification: {
            sent: true,
            emailMasked: material.user?.emailMasked || "আপনার ইমেইলে",
            dailyCapacity: 1e3,
            resendAfter: FIREBASE_VERIFICATION_RESEND_SECONDS
          }
        }, context.isNewDevice ? { "Set-Cookie": deviceCookie(context.deviceId) } : {});
      }
      if (request.method === "POST" && url.pathname === `${AUTH_API_PREFIX}/account-verification/email/status`) {
        if (!provider.configured) throw new NativeAuthError(AUTH_ERROR_CODES.NOT_CONFIGURED);
        const verificationTicket = jar[AUTH_VERIFICATION_COOKIE];
        if (!verificationTicket) throw new NativeAuthError(AUTH_ERROR_CODES.TELEGRAM_VERIFICATION_INVALID);
        await readJson(request);
        await callAuthority(env, "/internal/firebase/rate", { input: { operation: "verification-status" }, context });
        const material = await callAuthority(env, "/internal/firebase/account-verification/material", {
          verificationTicket,
          context
        });
        let refreshed;
        let user;
        try {
          refreshed = await provider.refresh(material.refreshToken);
        } catch (cause) {
          throw providerError(cause, "refresh");
        }
        try {
          user = await provider.lookup(refreshed.idToken);
        } catch (cause) {
          throw providerError(cause, "lookup-session");
        }
        assertProviderUser(refreshed, user);
        if (user.emailVerified !== true) {
          const ownershipVerified = await emailOwnershipProven({ env, user, context, allowed: true });
          if (!ownershipVerified) {
            return json(request, 200, {
              ok: true,
              authenticated: false,
              emailVerified: false,
              emailMasked: material.user?.emailMasked || "তোমার Email-এ"
            }, context.isNewDevice ? { "Set-Cookie": deviceCookie(context.deviceId) } : {});
          }
        }
        const established = await callAuthority(env, "/internal/firebase/account-verification/complete", {
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
        }, [verificationCookie("", 0)]);
      }
      if (request.method === "POST" && url.pathname === `${AUTH_API_PREFIX}/email-ownership/start`) {
        if (!provider.configured || !emailOwnershipRequested(env, url)) {
          throw new NativeAuthError(AUTH_ERROR_CODES.BACKUP_UNAVAILABLE);
        }
        const verificationTicket = jar[AUTH_VERIFICATION_COOKIE];
        if (!verificationTicket) throw new NativeAuthError(AUTH_ERROR_CODES.TELEGRAM_VERIFICATION_INVALID);
        const startBody = await readJson(request);
        const magicLink = startBody?.method === "magic-link";
        await verifyTurnstile({ env, token: startBody?.turnstileToken, ip: context.ip, fetchImpl });
        if (isPendingSignupTicket(verificationTicket)) return startPendingSignupCode({ request, env, provider, context, ticket: verificationTicket, magicLink, deps: pendingDeps() });
        const material = await callAuthority(env, "/internal/firebase/account-verification/material", {
          verificationTicket,
          context
        });
        let refreshed;
        let user;
        try {
          refreshed = await provider.refresh(material.refreshToken);
        } catch (cause) {
          throw providerError(cause, "refresh");
        }
        try {
          user = await provider.lookup(refreshed.idToken);
        } catch (cause) {
          throw providerError(cause, "lookup-session");
        }
        assertProviderUser(refreshed, user);
        if (user.emailVerified) {
          return json(request, 200, { ok: true, alreadyVerified: true, authenticated: false });
        }
        await callAuthority(env, "/internal/firebase/rate", { input: { operation: "verification-send", email: user.email }, context });
        let result;
        try {
          result = await callAuthority(env, "/internal/verification/ownership/request", {
            input: {
              verificationTicket,
              email: user.email,
              subject: user.subject,
              ...magicLink ? { deliveryMethod: "magic-link" } : {}
            },
            context
          });
        } catch (cause) {
          if (magicLink) throw cause;
          if (!(cause instanceof NativeAuthError) || cause.code !== AUTH_ERROR_CODES.BACKUP_UNAVAILABLE) throw cause;
          try {
            await provider.sendVerificationEmail(refreshed.idToken, user.email);
          } catch (sendCause) {
            throw sendCause instanceof NativeAuthError ? sendCause : providerError(sendCause, "verification");
          }
          return json(request, 202, {
            ok: true,
            authenticated: false,
            delivery: {
              method: "firebase-link",
              sent: true,
              fallback: true,
              emailMasked: material.user?.emailMasked || "আপনার ইমেইলে",
              resendAfter: FIREBASE_VERIFICATION_RESEND_SECONDS
            }
          }, context.isNewDevice ? { "Set-Cookie": deviceCookie(context.deviceId) } : {});
        }
        return json(request, 202, {
          ok: true,
          authenticated: false,
          delivery: { method: magicLink ? "email-magic-link" : "email-otp", sent: result?.sent !== false, fallback: false },
          ownership: {
            sent: result?.sent !== false,
            attemptId: result?.attemptId || "",
            emailMasked: material.user?.emailMasked || "আপনার ইমেইলে",
            resendAfter: Number(result?.resendAfter || FIREBASE_VERIFICATION_RESEND_SECONDS)
          }
        }, context.isNewDevice ? { "Set-Cookie": deviceCookie(context.deviceId) } : {});
      }
      if (request.method === "POST" && url.pathname === `${AUTH_API_PREFIX}/email-ownership/verify`) {
        if (!provider.configured || !emailOwnershipRequested(env, url)) {
          throw new NativeAuthError(AUTH_ERROR_CODES.BACKUP_UNAVAILABLE);
        }
        const verificationTicket = jar[AUTH_VERIFICATION_COOKIE];
        if (!verificationTicket) throw new NativeAuthError(AUTH_ERROR_CODES.TELEGRAM_VERIFICATION_INVALID);
        const body = await readJson(request);
        const magicToken = typeof body.token === "string" ? body.token.trim() : "";
        const code = magicToken || String(body.code || "").trim();
        const attemptId = String(body.attemptId || "").trim();
        const codeOk = magicToken ? /^[A-Za-z0-9._~-]{16,2048}$/.test(magicToken) : /^\d{6}$/.test(code);
        if (!codeOk || !/^[A-Za-z0-9_-]{24,96}$/.test(attemptId)) {
          throw new NativeAuthError(AUTH_ERROR_CODES.INVALID_INPUT);
        }
        if (isPendingSignupTicket(verificationTicket)) {
          if (magicToken) throw new NativeAuthError(AUTH_ERROR_CODES.INVALID_INPUT);
          return verifyPendingSignupCodeAndCreate({ request, env, provider, context, ticket: verificationTicket, attemptId, code, deps: pendingDeps() });
        }
        const material = await callAuthority(env, "/internal/firebase/account-verification/material", {
          verificationTicket,
          context
        });
        let refreshed;
        let user;
        try {
          refreshed = await provider.refresh(material.refreshToken);
        } catch (cause) {
          throw providerError(cause, "refresh");
        }
        try {
          user = await provider.lookup(refreshed.idToken);
        } catch (cause) {
          throw providerError(cause, "lookup-session");
        }
        assertProviderUser(refreshed, user);
        const verified = await callAuthority(env, "/internal/verification/ownership/verify", {
          input: { verificationTicket, email: user.email, subject: user.subject, attemptId, code },
          context
        });
        if (verified?.verified !== true || verified?.emailOwnershipProven !== true) {
          throw new NativeAuthError(AUTH_ERROR_CODES.OTP_INVALID);
        }
        const established = await callAuthority(env, "/internal/firebase/account-verification/complete", {
          input: { verificationTicket, email: user.email, subject: user.subject },
          context
        });
        return authSuccess(request, established, refreshed.refreshToken, context, {
          emailVerified: false,
          emailOwnershipProven: true
        }, [verificationCookie("", 0)]);
      }
      if (request.method === "POST" && url.pathname === `${AUTH_API_PREFIX}/email-ownership/status`) {
        if (!provider.configured || !emailOwnershipRequested(env, url)) {
          throw new NativeAuthError(AUTH_ERROR_CODES.BACKUP_UNAVAILABLE);
        }
        const verificationTicket = jar[AUTH_VERIFICATION_COOKIE];
        if (!verificationTicket) throw new NativeAuthError(AUTH_ERROR_CODES.TELEGRAM_VERIFICATION_INVALID);
        await readJson(request);
        const material = await callAuthority(env, "/internal/firebase/account-verification/material", {
          verificationTicket,
          context
        });
        let refreshed;
        let user;
        try {
          refreshed = await provider.refresh(material.refreshToken);
        } catch (cause) {
          throw providerError(cause, "refresh");
        }
        try {
          user = await provider.lookup(refreshed.idToken);
        } catch (cause) {
          throw providerError(cause, "lookup-session");
        }
        assertProviderUser(refreshed, user);
        if (!user.emailVerified) {
          return json(request, 200, { ok: true, authenticated: false, emailVerified: false });
        }
        const established = await callAuthority(env, "/internal/firebase/account-verification/complete", {
          input: { verificationTicket, email: user.email, subject: user.subject },
          context
        });
        return authSuccess(request, established, refreshed.refreshToken, context, {
          emailVerified: true,
          telegramVerified: false
        }, [verificationCookie("", 0)]);
      }
      if (request.method === "POST" && url.pathname === `${AUTH_API_PREFIX}/telegram/verification/start`) {
        if (!provider.configured || !telegramVerificationRequested(env, url)) {
          throw new NativeAuthError(AUTH_ERROR_CODES.TELEGRAM_VERIFICATION_UNAVAILABLE);
        }
        const verificationTicket = jar[AUTH_VERIFICATION_COOKIE];
        if (!verificationTicket) throw new NativeAuthError(AUTH_ERROR_CODES.TELEGRAM_VERIFICATION_INVALID);
        const turnstileBody = await readJson(request);
        await verifyTurnstile({ env, token: turnstileBody?.turnstileToken, ip: context.ip, fetchImpl });
        const result = await callAuthority(env, "/internal/verification/preauth/request", {
          input: { verificationTicket },
          context
        });
        return json(request, 202, { ok: true, ...result }, context.isNewDevice ? { "Set-Cookie": deviceCookie(context.deviceId) } : {});
      }
      if (request.method === "GET" && url.pathname === `${AUTH_API_PREFIX}/telegram/verification/pending`) {
        if (!provider.configured || !telegramVerificationRequested(env, url)) {
          throw new NativeAuthError(AUTH_ERROR_CODES.TELEGRAM_VERIFICATION_UNAVAILABLE);
        }
        const verificationTicket = jar[AUTH_VERIFICATION_COOKIE];
        if (!verificationTicket) throw new NativeAuthError(AUTH_ERROR_CODES.TELEGRAM_VERIFICATION_INVALID);
        const [material, result] = await Promise.all([
          callAuthority(env, "/internal/firebase/account-verification/material", { verificationTicket, context }),
          callAuthority(env, "/internal/verification/preauth/pending", {
            input: { verificationTicket },
            context
          })
        ]);
        return json(request, 200, {
          ok: true,
          ...result,
          ...!result?.pending ? {
            selectionRequired: true,
            emailMasked: material.user?.emailMasked || "আপনার ইমেইলে",
            options: {
              email: { available: true, verifiesEmailOwnership: true },
              telegram: { available: true, verifiesEmailOwnership: false }
            }
          } : {}
        }, context.isNewDevice ? { "Set-Cookie": deviceCookie(context.deviceId) } : {});
      }
      if (request.method === "POST" && url.pathname === `${AUTH_API_PREFIX}/telegram/verification/resend`) {
        if (!provider.configured || !telegramVerificationRequested(env, url)) {
          throw new NativeAuthError(AUTH_ERROR_CODES.TELEGRAM_VERIFICATION_UNAVAILABLE);
        }
        const verificationTicket = jar[AUTH_VERIFICATION_COOKIE];
        if (!verificationTicket) throw new NativeAuthError(AUTH_ERROR_CODES.TELEGRAM_VERIFICATION_INVALID);
        await readJson(request);
        const result = await callAuthority(env, "/internal/verification/preauth/request", {
          input: { verificationTicket },
          context
        });
        return json(request, 202, { ok: true, ...result }, context.isNewDevice ? { "Set-Cookie": deviceCookie(context.deviceId) } : {});
      }
      if (request.method === "POST" && url.pathname === `${AUTH_API_PREFIX}/telegram/verification/verify`) {
        if (!provider.configured || !telegramVerificationRequested(env, url)) {
          throw new NativeAuthError(AUTH_ERROR_CODES.TELEGRAM_VERIFICATION_UNAVAILABLE);
        }
        const verificationTicket = jar[AUTH_VERIFICATION_COOKIE];
        if (!verificationTicket) throw new NativeAuthError(AUTH_ERROR_CODES.TELEGRAM_VERIFICATION_INVALID);
        const body = await readJson(request);
        const code = String(body.code || "").trim();
        const attemptId = String(body.attemptId || "").trim();
        if (!/^\d{6}$/.test(code) || !/^[A-Za-z0-9_-]{24,96}$/.test(attemptId)) {
          throw new NativeAuthError(AUTH_ERROR_CODES.INVALID_INPUT);
        }
        const material = await callAuthority(env, "/internal/firebase/account-verification/material", {
          verificationTicket,
          context
        });
        let refreshed;
        let user;
        try {
          refreshed = await provider.refresh(material.refreshToken);
        } catch (cause) {
          throw providerError(cause, "refresh");
        }
        try {
          user = await provider.lookup(refreshed.idToken);
        } catch (cause) {
          throw providerError(cause, "lookup-session");
        }
        assertProviderUser(refreshed, user);
        const verified = await callAuthority(env, "/internal/verification/preauth/verify", {
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
        const established = await callAuthority(env, "/internal/firebase/account-verification/complete", {
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
        }, [verificationCookie("", 0)]);
      }
      if (request.method === "POST" && url.pathname === `${AUTH_API_PREFIX}/profile/pending`) {
        const verificationTicket = jar[AUTH_VERIFICATION_COOKIE];
        if (!verificationTicket) throw new NativeAuthError(AUTH_ERROR_CODES.TELEGRAM_VERIFICATION_INVALID);
        const profile = await readJson(request);
        await callAuthority(env, "/internal/firebase/rate", { input: { operation: "pending-profile-write" }, context });
        if (isPendingSignupTicket(verificationTicket)) return savePendingSignupProfile({ request, env, context, ticket: verificationTicket, profile, deps: pendingDeps() });
        const result = await callAuthority(env, "/internal/profile/save-pending", {
          verificationTicket,
          input: profile,
          context
        });
        return json(
          request,
          200,
          { ok: true, saved: result?.saved === true },
          context.isNewDevice ? { "Set-Cookie": deviceCookie(context.deviceId) } : {}
        );
      }
      if (request.method === "POST" && url.pathname === `${AUTH_API_PREFIX}/profile`) {
        if (!provider.configured) throw new NativeAuthError(AUTH_ERROR_CODES.NOT_CONFIGURED);
        const profile = await readJson(request);
        const current = await firebaseReadySession({
          provider,
          jar,
          env,
          context,
          allowTelegram: telegramVerificationRequested(env, url)
        });
        await callAuthority(env, "/internal/firebase/rate", {
          input: { operation: "profile-write", email: current.user.email },
          context
        });
        const result = await callAuthority(env, "/internal/profile/save", {
          input: {
            sessionToken: current.sessionToken,
            email: current.user.email,
            subject: current.user.subject,
            profile
          },
          context
        });
        return json(request, 200, { ok: true, saved: result?.saved === true, profile: result?.profile || null }, {
          "Set-Cookie": sessionCookies(current.session, current.refreshed.refreshToken, context)
        });
      }
      if (request.method === "GET" && url.pathname === `${AUTH_API_PREFIX}/profile`) {
        if (!provider.configured) throw new NativeAuthError(AUTH_ERROR_CODES.NOT_CONFIGURED);
        const current = await firebaseReadySession({
          provider,
          jar,
          env,
          context,
          allowTelegram: telegramVerificationRequested(env, url)
        });
        const result = await callAuthority(env, "/internal/profile/get-v2", {
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
          "Set-Cookie": sessionCookies(current.session, current.refreshed.refreshToken, context)
        });
      }
      if (request.method === "POST" && url.pathname === `${AUTH_API_PREFIX}/profile/patch`) {
        if (!provider.configured) throw new NativeAuthError(AUTH_ERROR_CODES.NOT_CONFIGURED);
        const body = await readJson(request);
        const current = await firebaseReadySession({
          provider,
          jar,
          env,
          context,
          allowTelegram: telegramVerificationRequested(env, url)
        });
        await callAuthority(env, "/internal/firebase/rate", {
          input: { operation: "profile-patch", email: current.user.email },
          context
        });
        const result = await callAuthority(env, "/internal/profile/patch", {
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
          "Set-Cookie": sessionCookies(current.session, current.refreshed.refreshToken, context)
        });
      }
      if (request.method === "POST" && url.pathname === `${AUTH_API_PREFIX}/profile/avatar`) {
        if (!provider.configured) throw new NativeAuthError(AUTH_ERROR_CODES.NOT_CONFIGURED);
        const body = await readJson(request, 35e5);
        const current = await firebaseReadySession({
          provider,
          jar,
          env,
          context,
          allowTelegram: telegramVerificationRequested(env, url)
        });
        await callAuthority(env, "/internal/firebase/rate", {
          input: { operation: "avatar-write", email: current.user.email },
          context
        });
        const result = await callAuthority(env, "/internal/avatar/save", {
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
          "Set-Cookie": sessionCookies(current.session, current.refreshed.refreshToken, context)
        });
      }
      if (request.method === "DELETE" && url.pathname === `${AUTH_API_PREFIX}/profile/avatar`) {
        if (!provider.configured) throw new NativeAuthError(AUTH_ERROR_CODES.NOT_CONFIGURED);
        const current = await firebaseReadySession({
          provider,
          jar,
          env,
          context,
          allowTelegram: telegramVerificationRequested(env, url)
        });
        await callAuthority(env, "/internal/firebase/rate", {
          input: { operation: "avatar-write", email: current.user.email },
          context
        });
        const result = await callAuthority(env, "/internal/avatar/delete", {
          input: {
            sessionToken: current.sessionToken,
            email: current.user.email,
            subject: current.user.subject
          },
          context
        });
        return json(request, 200, { ok: true, deleted: result?.deleted === true }, {
          "Set-Cookie": sessionCookies(current.session, current.refreshed.refreshToken, context)
        });
      }
      if (request.method === "GET" && url.pathname === `${AUTH_API_PREFIX}/profile/avatar`) {
        if (!provider.configured) throw new NativeAuthError(AUTH_ERROR_CODES.NOT_CONFIGURED);
        const current = await firebaseReadySession({
          provider,
          jar,
          env,
          context,
          allowTelegram: telegramVerificationRequested(env, url)
        });
        const result = await callAuthority(env, "/internal/avatar/get", {
          input: {
            sessionToken: current.sessionToken,
            email: current.user.email,
            subject: current.user.subject
          },
          context
        });
        if (!result?.present) return json(request, 404, { ok: false, error: { code: "AVATAR_NOT_FOUND" } });
        const bytes = Uint8Array.from(atob(result.data), (char) => char.charCodeAt(0));
        const etag = `"av-${result.updatedAt || result.bytes || 0}"`;
        if (request.headers.get("If-None-Match") === etag) {
          return new Response(null, { status: 304, headers: new Headers({ "ETag": etag, "Cache-Control": "private, max-age=300, must-revalidate", ...corsHeaders(request) }) });
        }
        return new Response(bytes, {
          status: 200,
          headers: new Headers({
            "Content-Type": result.mime,
            "Content-Length": String(bytes.byteLength),
            "ETag": etag,
            "Cache-Control": "private, max-age=300, must-revalidate",
            ...corsHeaders(request)
          })
        });
      }
      if (request.method === "GET" && url.pathname.startsWith(PUBLIC_PROFILE_PREFIX)) {
        const suffix = decodeURIComponent(url.pathname.slice(PUBLIC_PROFILE_PREFIX.length));
        const isAvatar = suffix.endsWith("/avatar");
        const publicId = isAvatar ? suffix.slice(0, -"/avatar".length) : suffix;
        await callAuthority(env, "/internal/firebase/rate", {
          input: { operation: "public-profile-read" },
          context
        });
        if (isAvatar) {
          const result2 = await callAuthority(env, "/internal/public-profile/avatar", {
            input: { publicId }
          });
          if (!result2?.present) return json(request, 404, { ok: false, error: { code: "AVATAR_NOT_FOUND" } });
          const bytes = Uint8Array.from(atob(result2.data), (char) => char.charCodeAt(0));
          return new Response(bytes, {
            status: 200,
            headers: new Headers({
              "Content-Type": result2.mime,
              "Content-Length": String(bytes.byteLength),
              "Cache-Control": "public, max-age=3600",
              "Cross-Origin-Resource-Policy": "cross-site",
              ...corsHeaders(request)
            })
          });
        }
        const result = await callAuthority(env, "/internal/public-profile/get", {
          input: { publicId }
        });
        return json(request, 200, { ok: true, profile: result?.profile || null });
      }
      if (request.method === "GET" && url.pathname === `${AUTH_API_PREFIX}/account`) {
        if (!provider.configured) throw new NativeAuthError(AUTH_ERROR_CODES.NOT_CONFIGURED);
        const current = await firebaseReadySession({
          provider,
          jar,
          env,
          context,
          allowTelegram: telegramVerificationRequested(env, url)
        });
        const result = await callAuthority(env, "/internal/account/state", {
          sessionToken: current.sessionToken,
          input: { email: current.user.email, subject: current.user.subject },
          context
        });
        return json(request, 200, { ok: true, account: result?.account || null }, {
          "Set-Cookie": sessionCookies(current.session, current.refreshed.refreshToken, context)
        });
      }
      if (request.method === "GET" && url.pathname === `${AUTH_API_PREFIX}/identities`) {
        if (!provider.configured) throw new NativeAuthError(AUTH_ERROR_CODES.NOT_CONFIGURED);
        const current = await firebaseReadySession({
          provider,
          jar,
          env,
          context,
          allowTelegram: telegramVerificationRequested(env, url)
        });
        const result = await callAuthority(env, "/internal/account/identities", {
          sessionToken: current.sessionToken,
          input: { email: current.user.email, subject: current.user.subject },
          context
        });
        return json(request, 200, { ok: true, identities: result?.identities || [] }, {
          "Set-Cookie": sessionCookies(current.session, current.refreshed.refreshToken, context)
        });
      }
      if (request.method === "GET" && url.pathname === `${AUTH_API_PREFIX}/admin/identity/health`) {
        if (!adminAuthorized(request, env)) return json(request, 403, { ok: false, error: { code: "FORBIDDEN", message: "অনুমতি নেই।" } });
        const result = await callAuthority(env, "/internal/identity/health", {});
        return json(request, 200, { ok: true, health: result?.health || null });
      }
      if (request.method === "POST" && url.pathname === `${AUTH_API_PREFIX}/admin/account/state`) {
        if (!adminAuthorized(request, env)) return json(request, 403, { ok: false, error: { code: "FORBIDDEN", message: "অনুমতি নেই।" } });
        const body = await readJson(request);
        const result = await callAuthority(env, "/internal/account/state/set", {
          userId: String(body?.userId || "").slice(0, 256),
          status: String(body?.status || "")
        });
        return json(request, 200, { ok: true, account: result?.account || null });
      }
      if (request.method === "POST" && url.pathname === `${AUTH_API_PREFIX}/passkey/registration/begin`) {
        if (!provider.configured || !passkeyEndpointReady(env)) throw new NativeAuthError(AUTH_ERROR_CODES.PASSKEY_UNAVAILABLE);
        const current = await firebaseReadySession({ provider, jar, env, context, allowTelegram: telegramVerificationRequested(env, url) });
        const result = await callAuthority(env, "/internal/passkey/registration/begin", {
          input: {
            sessionToken: current.sessionToken,
            refreshToken: current.refreshed.refreshToken,
            email: current.user.email,
            subject: current.user.subject
          },
          context
        });
        return json(request, 200, { ok: true, ...result }, {
          "Set-Cookie": sessionCookies(current.session, current.refreshed.refreshToken, context)
        });
      }
      if (request.method === "POST" && url.pathname === `${AUTH_API_PREFIX}/passkey/registration/finish`) {
        if (!provider.configured || !passkeyEndpointReady(env)) throw new NativeAuthError(AUTH_ERROR_CODES.PASSKEY_UNAVAILABLE);
        const body = await readJson(request);
        const current = await firebaseReadySession({ provider, jar, env, context, allowTelegram: telegramVerificationRequested(env, url) });
        const result = await callAuthority(env, "/internal/passkey/registration/finish", {
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
          "Set-Cookie": sessionCookies(current.session, current.refreshed.refreshToken, context)
        });
      }
      if (request.method === "POST" && url.pathname === `${AUTH_API_PREFIX}/passkey/authentication/begin`) {
        if (!provider.configured || !passkeyEndpointReady(env)) throw new NativeAuthError(AUTH_ERROR_CODES.PASSKEY_UNAVAILABLE);
        const result = await callAuthority(env, "/internal/passkey/authentication/begin", { context });
        return json(request, 200, { ok: true, ...result }, context.isNewDevice ? { "Set-Cookie": deviceCookie(context.deviceId) } : {});
      }
      if (request.method === "POST" && url.pathname === `${AUTH_API_PREFIX}/passkey/authentication/finish`) {
        if (!provider.configured || !passkeyEndpointReady(env)) throw new NativeAuthError(AUTH_ERROR_CODES.PASSKEY_UNAVAILABLE);
        const body = await readJson(request);
        const assertion = await callAuthority(env, "/internal/passkey/authentication/finish", {
          input: { challengeId: body.challengeId, response: body.response },
          context
        });
        let refreshed;
        let user;
        try {
          refreshed = await provider.refresh(assertion.refreshToken);
        } catch (cause) {
          throw providerError(cause, "passkey-refresh");
        }
        try {
          user = await provider.lookup(refreshed.idToken);
        } catch (cause) {
          throw providerError(cause, "lookup-session");
        }
        assertProviderUser(refreshed, user);
        const passkeyTelegramVerified = !user.emailVerified && await telegramVerificationStatus({
          env,
          user,
          context,
          allowed: telegramVerificationRequested(env, url)
        });
        if (!user.emailVerified && !passkeyTelegramVerified) throw new NativeAuthError(AUTH_ERROR_CODES.EMAIL_NOT_VERIFIED);
        const established = await callAuthority(env, "/internal/passkey/session/complete", {
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
      if (request.method === "GET" && url.pathname === `${AUTH_API_PREFIX}/passkey/status`) {
        if (!provider.configured || !passkeyEndpointReady(env)) throw new NativeAuthError(AUTH_ERROR_CODES.PASSKEY_UNAVAILABLE);
        const current = await firebaseReadySession({ provider, jar, env, context, allowTelegram: telegramVerificationRequested(env, url) });
        const result = await callAuthority(env, "/internal/passkey/status", {
          input: { sessionToken: current.sessionToken, email: current.user.email, subject: current.user.subject },
          context
        });
        return json(request, 200, { ok: true, ...result }, {
          "Set-Cookie": sessionCookies(current.session, current.refreshed.refreshToken, context)
        });
      }
      if (request.method === "POST" && url.pathname === `${AUTH_API_PREFIX}/passkey/remove`) {
        if (!provider.configured || !passkeyEndpointReady(env)) throw new NativeAuthError(AUTH_ERROR_CODES.PASSKEY_UNAVAILABLE);
        const body = await readJson(request);
        const current = await firebaseReadySession({ provider, jar, env, context, allowTelegram: telegramVerificationRequested(env, url) });
        const result = await callAuthority(env, "/internal/passkey/remove", {
          input: {
            credentialId: body.credentialId,
            sessionToken: current.sessionToken,
            email: current.user.email,
            subject: current.user.subject
          },
          context
        });
        return json(request, 200, { ok: true, ...result }, {
          "Set-Cookie": sessionCookies(current.session, current.refreshed.refreshToken, context)
        });
      }
      if (request.method === "POST" && url.pathname === `${AUTH_API_PREFIX}/backup/request`) {
        if (!provider.configured || !(verificationPublished(env) || telegramCanaryRequested(env, url))) {
          throw new NativeAuthError(AUTH_ERROR_CODES.BACKUP_UNAVAILABLE);
        }
        const body = await readJson(request);
        await verifyTurnstile({ env, token: body?.turnstileToken, ip: context.ip, fetchImpl });
        const contact = String(body.contact || "").trim();
        if (contact && !/^\+[1-9]\d{7,14}$/.test(contact)) throw new NativeAuthError(AUTH_ERROR_CODES.INVALID_INPUT);
        const current = await firebaseReadySession({ provider, jar, env, context, allowTelegram: telegramVerificationRequested(env, url) });
        const recipientName = await verifiedRecipientName(env, context, current);
        const result = await callAuthority(env, "/internal/verification/request", {
          input: {
            sessionToken: current.sessionToken,
            email: current.user.email,
            subject: current.user.subject,
            recipientName,
            purpose: body.purpose === "sensitive-action" ? "sensitive-action" : "account-backup",
            contact,
            allowTelegramLink: true
          },
          context
        });
        return json(request, 202, { ok: true, ...result }, {
          "Set-Cookie": sessionCookies(current.session, current.refreshed.refreshToken, context)
        });
      }
      if (request.method === "POST" && url.pathname === `${AUTH_API_PREFIX}/backup/verify`) {
        if (!provider.configured || !(verificationPublished(env) || telegramCanaryRequested(env, url))) {
          throw new NativeAuthError(AUTH_ERROR_CODES.BACKUP_UNAVAILABLE);
        }
        const body = await readJson(request);
        const current = await firebaseReadySession({ provider, jar, env, context, allowTelegram: telegramVerificationRequested(env, url) });
        const result = await callAuthority(env, "/internal/verification/verify", {
          input: {
            sessionToken: current.sessionToken,
            email: current.user.email,
            subject: current.user.subject,
            purpose: body.purpose === "sensitive-action" ? "sensitive-action" : "account-backup",
            attemptId: body.attemptId,
            code: body.code,
            evidence: body.evidence
          },
          context
        });
        return json(request, 200, { ok: true, ...result }, {
          "Set-Cookie": sessionCookies(current.session, current.refreshed.refreshToken, context)
        });
      }
      if (request.method === "GET" && url.pathname === `${AUTH_API_PREFIX}/admin/verification/status`) {
        if (!adminAuthorized(request, env)) return json(request, 403, { ok: false, error: { code: "FORBIDDEN", message: "অনুমতি নেই।" } });
        const result = await callAuthority(env, "/internal/verification/admin/status", {});
        return json(request, 200, { ok: true, ...result });
      }
      if (request.method === "POST" && url.pathname === `${AUTH_API_PREFIX}/admin/verification/config`) {
        if (!adminAuthorized(request, env)) return json(request, 403, { ok: false, error: { code: "FORBIDDEN", message: "অনুমতি নেই।" } });
        const body = await readJson(request);
        const result = await callAuthority(env, "/internal/verification/admin/config", { config: adminVerificationConfigInput(body.config) });
        publicConfigCache.delete(env);
        return json(request, 200, { ok: true, ...result });
      }
      if (request.method === "GET" && url.pathname === `${AUTH_API_PREFIX}/session`) {
        const current = await firebaseReadySession({ provider, jar, env, context, allowTelegram: telegramVerificationRequested(env, url), trackRefresh: true });
        const maxAge = Math.max(1, Math.min(SESSION_SECONDS, Math.floor((Number(current.session.expiresAt) - Date.now()) / 1e3)));
        return json(request, 200, {
          ok: true,
          authenticated: true,
          accountVerified: true,
          emailVerified: current.user.emailVerified === true,
          telegramVerified: current.telegramVerified === true,
          ...current.session
        }, {
          "Set-Cookie": [firebaseCookie(current.refreshed.refreshToken, maxAge), ...context.isNewDevice ? [deviceCookie(context.deviceId)] : []]
        });
      }
      if (request.method === "POST" && url.pathname === `${AUTH_API_PREFIX}/session/logout`) {
        const sessionToken = jar[AUTH_SESSION_COOKIE];
        if (sessionToken) await callAuthority(env, "/internal/session/revoke", { sessionToken });
        return json(request, 200, { ok: true, authenticated: false }, { "Set-Cookie": clearAuthCookies() });
      }
      if (request.method === "POST" && url.pathname === `${AUTH_API_PREFIX}/session/logout-all`) {
        const body = await readJson(request);
        const current = await firebaseReadySession({ provider, jar, env, context, allowTelegram: telegramVerificationRequested(env, url) });
        const result = await callAuthority(env, "/internal/session/revoke-all", {
          sessionToken: current.sessionToken,
          input: { email: current.user.email, subject: current.user.subject, stepUpToken: String(body?.stepUpToken || "") },
          context
        });
        return json(request, 200, { ok: true, authenticated: false, revoked: Number(result?.revoked || 0) }, { "Set-Cookie": clearAuthCookies() });
      }
      if (request.method === "POST" && url.pathname === `${AUTH_API_PREFIX}/security/challenge/request`) {
        const body = await readJson(request);
        const current = await firebaseReadySession({ provider, jar, env, context, allowTelegram: telegramVerificationRequested(env, url) });
        const result = await callAuthority(env, "/internal/security/challenge/request", {
          input: {
            sessionToken: current.sessionToken,
            email: current.user.email,
            subject: current.user.subject,
            purpose: String(body?.purpose || ""),
            method: String(body?.method || "email")
          },
          context
        });
        return json(request, 200, { ok: true, ...result }, {
          "Set-Cookie": sessionCookies(current.session, current.refreshed.refreshToken, context)
        });
      }
      if (request.method === "POST" && url.pathname === `${AUTH_API_PREFIX}/security/challenge/verify`) {
        const body = await readJson(request);
        const current = await firebaseReadySession({ provider, jar, env, context, allowTelegram: telegramVerificationRequested(env, url) });
        const result = await callAuthority(env, "/internal/security/challenge/verify", {
          input: {
            sessionToken: current.sessionToken,
            email: current.user.email,
            subject: current.user.subject,
            challengeRef: String(body?.challengeRef || ""),
            purpose: String(body?.purpose || ""),
            code: String(body?.code || "")
          },
          context
        });
        return json(request, 200, { ok: true, ...result }, {
          "Set-Cookie": sessionCookies(current.session, current.refreshed.refreshToken, context)
        });
      }
      if (request.method === "POST" && url.pathname === `${AUTH_API_PREFIX}/security/challenge/cancel`) {
        const body = await readJson(request);
        const current = await firebaseReadySession({ provider, jar, env, context, allowTelegram: telegramVerificationRequested(env, url) });
        const result = await callAuthority(env, "/internal/security/challenge/cancel", {
          input: {
            sessionToken: current.sessionToken,
            email: current.user.email,
            subject: current.user.subject,
            challengeRef: String(body?.challengeRef || ""),
            purpose: String(body?.purpose || "")
          },
          context
        });
        return json(request, 200, { ok: true, ...result }, {
          "Set-Cookie": sessionCookies(current.session, current.refreshed.refreshToken, context)
        });
      }
      if (request.method === "POST" && url.pathname === `${AUTH_API_PREFIX}/security/device/trust`) {
        await readJson(request);
        const current = await firebaseReadySession({ provider, jar, env, context, allowTelegram: telegramVerificationRequested(env, url) });
        const result = await callAuthority(env, "/internal/security/device/trust", {
          input: { sessionToken: current.sessionToken, email: current.user.email, subject: current.user.subject },
          context
        });
        return json(request, 200, { ok: true, ...result }, {
          "Set-Cookie": sessionCookies(current.session, current.refreshed.refreshToken, context)
        });
      }
      if (request.method === "GET" && url.pathname === `${AUTH_API_PREFIX}/security/state`) {
        const current = await firebaseReadySession({ provider, jar, env, context, allowTelegram: telegramVerificationRequested(env, url) });
        const result = await callAuthority(env, "/internal/security/state", {
          input: { sessionToken: current.sessionToken, email: current.user.email, subject: current.user.subject },
          context
        });
        return json(request, 200, { ok: true, ...result }, {
          "Set-Cookie": sessionCookies(current.session, current.refreshed.refreshToken, context)
        });
      }
      if (request.method === "GET" && url.pathname === `${AUTH_API_PREFIX}/security/history`) {
        const current = await firebaseReadySession({ provider, jar, env, context, allowTelegram: telegramVerificationRequested(env, url) });
        const result = await callAuthority(env, "/internal/security/history", {
          input: { sessionToken: current.sessionToken, email: current.user.email, subject: current.user.subject },
          context
        });
        return json(request, 200, { ok: true, ...result }, {
          "Set-Cookie": sessionCookies(current.session, current.refreshed.refreshToken, context)
        });
      }
      if (request.method === "POST" && url.pathname === `${AUTH_API_PREFIX}/security/devices/revoke`) {
        const body = await readJson(request);
        const current = await firebaseReadySession({ provider, jar, env, context, allowTelegram: telegramVerificationRequested(env, url) });
        const result = await callAuthority(env, "/internal/security/device/revoke", {
          input: {
            sessionToken: current.sessionToken,
            email: current.user.email,
            subject: current.user.subject,
            scope: String(body?.scope || "current"),
            deviceRef: String(body?.deviceRef || ""),
            stepUpToken: String(body?.stepUpToken || "")
          },
          context
        });
        return json(request, 200, { ok: true, ...result }, {
          "Set-Cookie": sessionCookies(current.session, current.refreshed.refreshToken, context)
        });
      }
      if (request.method === "GET" && url.pathname === `${AUTH_API_PREFIX}/admin/security/health`) {
        if (!adminAuthorized(request, env)) return json(request, 403, { ok: false, error: { code: "FORBIDDEN", message: "অনুমতি নেই।" } });
        const result = await callAuthority(env, "/internal/admin/security/health", {});
        return json(request, 200, { ok: true, result });
      }
      if (request.method === "GET" && url.pathname === `${AUTH_API_PREFIX}/admin/students`) {
        if (!adminAuthorized(request, env)) return json(request, 403, { ok: false, error: { code: "FORBIDDEN", message: "অনুমতি নেই।" } });
        const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 50, 1), 100);
        const before = url.searchParams.get("before") ? Number(url.searchParams.get("before")) : null;
        const q = String(url.searchParams.get("q") || "").slice(0, 254);
        const result = await callAuthority(env, "/internal/admin/students/list", { input: { limit, before, q } });
        return json(request, 200, { ok: true, ...result }, { "X-Robots-Tag": "noindex, nofollow" });
      }
      if (request.method === "GET" && url.pathname === `${AUTH_API_PREFIX}/admin/students/profile`) {
        if (!adminAuthorized(request, env)) return json(request, 403, { ok: false, error: { code: "FORBIDDEN", message: "অনুমতি নেই।" } });
        const userId = String(url.searchParams.get("id") || "").slice(0, 128);
        const result = await callAuthority(env, "/internal/admin/students/get", { input: { userId } });
        return json(request, result?.found ? 200 : 404, { ok: Boolean(result?.found), ...result }, { "X-Robots-Tag": "noindex, nofollow" });
      }
      if (request.method === "POST" && url.pathname === `${AUTH_API_PREFIX}/admin/students/wipe`) {
        if (!adminAuthorized(request, env)) return json(request, 403, { ok: false, error: { code: "FORBIDDEN", message: "অনুমতি নেই।" } });
        const body = await readJson(request);
        const input = body?.dryRun === false ? { dryRun: false, confirm: String(body?.confirm || "").slice(0, 64) } : { dryRun: true };
        const result = await callAuthority(env, "/internal/admin/students/wipe", { input });
        return json(request, 200, { ok: true, ...result }, { "X-Robots-Tag": "noindex, nofollow" });
      }
      if (request.method === "GET" && url.pathname === `${AUTH_API_PREFIX}/admin/security/events`) {
        if (!adminAuthorized(request, env)) return json(request, 403, { ok: false, error: { code: "FORBIDDEN", message: "অনুমতি নেই।" } });
        const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 50, 1), 200);
        const before = url.searchParams.get("before") ? Number(url.searchParams.get("before")) : null;
        const result = await callAuthority(env, "/internal/admin/security/events", { input: { limit, before } });
        return json(request, 200, { ok: true, ...result });
      }
      return json(request, 404, { ok: false, error: { code: "NOT_FOUND", message: "Endpoint পাওয়া যায়নি।" } });
    } catch (cause) {
      const error = asNativeAuthError(cause);
      const clearSession = Boolean(jar[AUTH_SESSION_COOKIE]) && [AUTH_ERROR_CODES.SESSION_INVALID, AUTH_ERROR_CODES.EMAIL_NOT_VERIFIED, AUTH_ERROR_CODES.ACCOUNT_DISABLED].includes(error.code);
      if (clearSession && jar[AUTH_SESSION_COOKIE]) {
        try {
          await callAuthority(env, "/internal/session/revoke", { sessionToken: jar[AUTH_SESSION_COOKIE] });
        } catch {
        }
      }
      const providerDiagnosticCode = /^[A-Z0-9_]{1,80}$/.test(String(error.providerDiagnostic || "")) ? String(error.providerDiagnostic) : "";
      return json(request, error.status, { ok: false, error: error.toPublic() }, {
        ...error.retryAfter ? { "Retry-After": String(error.retryAfter) } : {},
        ...providerDiagnosticCode ? { "X-AH-Auth-Diagnostic": providerDiagnosticCode } : {},
        ...googleRequest ? { "X-AH-Auth-Stage": authStage } : {},
        ...clearSession ? { "Set-Cookie": clearAuthCookies() } : {}
      });
    }
  };
}
var __publicAuthTest = Object.freeze({
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

// auth-worker.js
var nativeAuthHandler = createNativeAuthHandler();
var auth_worker_default = {
  async fetch(request, env, ctx) {
    const response = await nativeAuthHandler(request, env, ctx);
    if (response) {
      const marked = new Response(response.body, response);
      marked.headers.set("X-AH-Auth-Front", "admission-auth");
      marked.headers.set("X-AH-Client-Addr", request.headers.get("CF-Connecting-IP") ? "present" : "absent");
      return marked;
    }
    return new Response("Not found", {
      status: 404,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff"
      }
    });
  }
};
export {
  auth_worker_default as default
};
