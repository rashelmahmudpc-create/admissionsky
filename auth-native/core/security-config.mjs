// Phase 6, Central Security Configuration (blueprint §28, §29)
//
// Every security threshold the engine uses lives in this module, nothing
// security-related is hard-coded across components. Environments may
// override via the SECURITY_CONFIG_JSON binding at activation; the frozen
// defaults below are the conservative production baseline.
//
// Policy versioning (§29): every security event is stamped with
// SECURITY_POLICY_VERSION so audits can attribute decisions to the policy
// that produced them.

export const SECURITY_POLICY_VERSION = 'security-policy-v1';

export const SECURITY_RISK_LEVELS = Object.freeze(['LOW', 'NORMAL', 'ELEVATED', 'HIGH', 'CRITICAL']);

export const SECURITY_RISK_RANK = Object.freeze({
  LOW: 0,
  NORMAL: 1,
  ELEVATED: 2,
  HIGH: 3,
  CRITICAL: 4
});

// Challenge engine defaults (§11-§12).
export const SECURITY_CHALLENGE_TTL_MS = 15 * 60 * 1000; // 15 min, short-lived
export const SECURITY_CHALLENGE_MAX_ATTEMPTS = 5; // attempt-limited
export const SECURITY_CHALLENGE_METHODS_V1 = Object.freeze(['email', 'telegram', 'passkey']);

// Device trust defaults (§5-§7). Opaque server-issued device cookie only -
// no fingerprinting, no location.
export const SECURITY_TRUST_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
export const SECURITY_TRUST_MAX_DEVICES_PER_USER = 10;

// Repeated-failure protection (§13-§14): escalating cooldowns, never a
// permanent lockout. The Nth consecutive failure in the window applies the
// cooldown at index min(failures - threshold, steps.length - 1).
export const SECURITY_FAILED_LOGIN_WINDOW_MS = 15 * 60 * 1000;
export const SECURITY_COOLDOWN_THRESHOLD_FAILURES = 5;
export const SECURITY_COOLDOWN_STEPS_MS = Object.freeze([
  5 * 60 * 1000, // 5 min
  15 * 60 * 1000, // 15 min
  60 * 60 * 1000 // 60 min, ceiling; never permanent
]);

// Risk signal thresholds (§3-§4). A single behavioural signal can at most
// reach ELEVATED on its own; independent signals combine conservatively.
export const SECURITY_RISK_THRESHOLDS = Object.freeze({
  failedLoginElevatedAt: 3, // 3+ failed logins in window -> ELEVATED signal
  failedLoginHighAt: 8, // 8+ -> HIGH signal
  rapidAuthRequestsWindowMs: 60 * 1000,
  rapidAuthRequestsHighAt: 20 // 20+ auth requests / IP / minute -> HIGH signal
});

// Session policy by risk level (§23). LOW/NORMAL keep the standard 30-day
// session; HIGH-risk sessions are short-lived and earn no device trust.
export const SECURITY_RISK_SESSION_POLICY = Object.freeze({
  LOW: { sessionTtlMs: 30 * 24 * 60 * 60 * 1000, trustOffer: true, challenge: null },
  NORMAL: { sessionTtlMs: 30 * 24 * 60 * 60 * 1000, trustOffer: true, challenge: null },
  ELEVATED: { sessionTtlMs: 30 * 24 * 60 * 60 * 1000, trustOffer: true, challenge: 'new-device' },
  HIGH: { sessionTtlMs: 24 * 60 * 60 * 1000, trustOffer: false, challenge: 'step-up' },
  CRITICAL: { sessionTtlMs: null, trustOffer: false, challenge: null, block: true }
});

// Step-up purposes (§10, §12). Challenges are purpose-bound: a challenge
// verified for one purpose can never satisfy another.
export const SECURITY_PURPOSES = Object.freeze({
  STEP_UP: 'step-up',
  NEW_DEVICE: 'new-device',
  RECOVERY: 'recovery',
  DEVICE_REVOCATION: 'device-revoke'
});

// Fail-safe policy (§30-§31): when risk evaluation itself cannot complete,
// the fallback is action-sensitive, never blind-allow sensitive actions,
// never lock everyone out.
export const SECURITY_FAILSAFE_POLICY = Object.freeze({
  lowRisk: 'proceed', // normal action under normal auth
  sensitive: 'challenge', // sensitive action requires stronger verification
  critical: 'block' // critical action is temporarily blocked + recovery path
});

// Step-up policy (§12): sensitive account actions (logout-all in v1) are
// allowed without a fresh challenge only while the session is recent AND the
// request's risk stays below ELEVATED. "Recent" is the arm window the client
// keeps between the user's confirmation tap and the request.
export const SECURITY_STEP_UP_RECENT_SESSION_MS = 5 * 60 * 1000; // 5 minutes

// Security action classes used by the fail-safe resolver.
export const SECURITY_ACTION_CLASSES = Object.freeze(['lowRisk', 'sensitive', 'critical']);

export const SECURITY_CONFIG = Object.freeze({
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

/**
 * Build the effective security config from an optional environment override
 * (SECURITY_CONFIG_JSON binding). Unknown keys are ignored; known numeric
 * values must be finite and positive. On any validation failure the frozen
 * defaults are returned, a bad override can never weaken the baseline.
 */
export function resolveSecurityConfig(overrideRaw = '') {
  if (!overrideRaw) return SECURITY_CONFIG;
  try {
    const parsed = JSON.parse(String(overrideRaw));
    if (!parsed || typeof parsed !== 'object') return SECURITY_CONFIG;
    const base = { ...SECURITY_CONFIG };
    for (const key of Object.keys(base)) {
      if (!(key in parsed)) continue;
      const value = parsed[key];
      if (typeof base[key] === 'number') {
        if (!Number.isFinite(value) || value <= 0) return SECURITY_CONFIG;
        base[key] = value;
      } else if (typeof base[key] === 'string') {
        if (typeof value !== 'string' || !value) return SECURITY_CONFIG;
        base[key] = value;
      }
      // Nested structures (thresholds, policy tables) are NOT overrideable in
      // v1, they are the conservative core. Only scalar knobs flex.
    }
    return Object.freeze(base);
  } catch {
    return SECURITY_CONFIG;
  }
}
