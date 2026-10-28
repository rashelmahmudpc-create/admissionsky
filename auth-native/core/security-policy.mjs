// Phase 6, Security Policy / Risk Evaluation (blueprint §3, §4, §30, §33)
//
// Deterministic, pure risk evaluation. It consumes already-computed signals
// (never raw PII, never tokens) and returns a risk level plus the actions
// the caller must take.
//
// Conservative combination rules (§4):
//  - A SINGLE behavioural signal can at most reach ELEVATED. Nobody is
//    accused on one signal alone.
//  - Two or more independent behavioural signals combine to at most HIGH.
//  - CRITICAL comes only from authoritative facts (e.g. account suspended
//    by the authority) or a fact + behavioural escalation, never from
//    behaviour alone.
//
// Fail-safe (§30-§31): if evaluation itself fails, resolveFailSafe() maps
// the action class to a bounded fallback, sensitive actions are never
// blind-allowed, and normal actions are never locked out.

import {
  SECURITY_RISK_LEVELS,
  SECURITY_RISK_RANK,
  SECURITY_RISK_THRESHOLDS,
  SECURITY_RISK_SESSION_POLICY,
  SECURITY_FAILSAFE_POLICY,
  SECURITY_ACTION_CLASSES,
  SECURITY_POLICY_VERSION,
  SECURITY_COOLDOWN_THRESHOLD_FAILURES,
  SECURITY_COOLDOWN_STEPS_MS,
  resolveSecurityConfig
} from './security-config.mjs';

// Signal kinds. 'fact' = authoritative state (not an accusation);
// 'behavior' = observed activity pattern (never accusatory alone).
const BEHAVIOR_SIGNALS = new Set(['failedLogins', 'rapidRequests', 'newDevice', 'recoveryActive', 'unverifiedAccount']);

function rank(level) {
  return SECURITY_RISK_RANK[level] ?? 0;
}

/**
 * Evaluate risk from normalized signals.
 *
 * @param {object} signals
 * @param {'active'|'restricted'|'suspended'|'deactivated'} [signals.accountState]
 * @param {number}   [signals.failedLogins]     failed login attempts in the window (count)
 * @param {number}   [signals.rapidRequests]    auth requests from one IP in the window (count)
 * @param {boolean}  [signals.newDevice]        device not previously seen for this user
 * @param {boolean}  [signals.recoveryActive]   an account recovery flow is in progress
 * @param {boolean}  [signals.unverifiedAccount] account identity not yet ownership-verified
 * @param {object}   [config]                   effective security config
 * @returns {object} { level, reasons, actions, policyVersion }
 */
export function evaluateRisk(signals = {}, config = resolveSecurityConfig()) {
  const t = config.riskThresholds;
  const facts = [];
  const behaviors = [];

  // Authoritative facts (state, not accusation).
  if (signals.accountState === 'suspended' || signals.accountState === 'deactivated') {
    facts.push('account-disabled');
  } else if (signals.accountState === 'restricted') {
    facts.push('account-restricted');
  }
  if (signals.recoveryActive === true) facts.push('recovery-active');

  // Behavioural signals (each capped at ELEVATED on its own).
  const failed = Math.max(0, Number(signals.failedLogins) || 0);
  if (failed >= t.failedLoginHighAt) behaviors.push('failed-logins-high');
  else if (failed >= t.failedLoginElevatedAt) behaviors.push('failed-logins-elevated');
  if (signals.rapidRequests >= t.rapidAuthRequestsHighAt) behaviors.push('rapid-requests');
  if (signals.newDevice === true) behaviors.push('new-device');
  if (signals.unverifiedAccount === true) behaviors.push('unverified-account');

  let level = 'LOW';
  if (facts.includes('account-disabled')) {
    level = 'CRITICAL'; // authoritative authority decision, not a guess
  } else {
    // Each behavioural signal is capped at ELEVATED on its own (§4: no
    // single-signal accusation); 'unverified-account' is weaker still.
    let behaviorRank = 0;
    for (const signal of behaviors) {
      const signalRank = signal === 'unverified-account' ? rank('NORMAL') : rank('ELEVATED');
      behaviorRank = Math.max(behaviorRank, signalRank);
    }
    // Combination: 2+ independent behaviours escalate one step (max HIGH).
    if (behaviors.length >= 2) behaviorRank = Math.min(behaviorRank + 1, rank('HIGH'));
    // A fact (restricted / recovery) + any behaviour reaches at least HIGH.
    if (facts.length > 0 && behaviors.length > 0) behaviorRank = Math.max(behaviorRank, rank('HIGH'));
    const levels = [...SECURITY_RISK_LEVELS];
    level = behaviors.length > 0 || facts.length > 0 ? levels[Math.min(behaviorRank, levels.length - 1)] : 'NORMAL';
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

/**
 * Escalating cooldown after repeated failures (§14). Returns the cooldown
 * duration in ms for the Nth consecutive failure, or 0 when below the
 * threshold. The ceiling is the last step, never permanent.
 */
export function cooldownForFailure(failures, config = resolveSecurityConfig()) {
  const n = Math.max(0, Number(failures) || 0);
  if (n < config.cooldownThresholdFailures) return 0;
  const steps = config.cooldownStepsMs;
  const index = Math.min(n - config.cooldownThresholdFailures, steps.length - 1);
  return steps[index] ?? 0;
}

/**
 * Fail-safe resolver (§30-§31): when the risk engine itself cannot produce
 * a decision, the fallback depends on how sensitive the action is.
 */
export function resolveFailSafe(actionClass, config = resolveSecurityConfig()) {
  const cls = SECURITY_ACTION_CLASSES.includes(actionClass) ? actionClass : 'sensitive';
  const fallback = config.failSafePolicy[cls] || config.failSafePolicy.sensitive;
  return Object.freeze({
    fallback,
    proceed: fallback === 'proceed',
    challenge: fallback === 'challenge',
    block: fallback === 'block',
    policyVersion: config.policyVersion
  });
}

export { SECURITY_RISK_LEVELS, SECURITY_POLICY_VERSION };
