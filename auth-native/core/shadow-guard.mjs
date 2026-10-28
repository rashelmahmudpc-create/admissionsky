// Shadow Guard (P30): risk-scored login friction that a real student never
// notices and an attacker never learns from.
//
// The engine already evaluates risk (security-policy.mjs, five levels) and
// already issues challenges. This module is the layer between a raw login
// request and that engine: it turns observable facts into signals, decides
// the band the caller must act on, and owns the two behaviours the owner
// asked for by name - the generic error under a shadow-ban, and the small
// randomized delay that costs a bot far more than it costs a person.
//
// Design rules kept deliberately:
//
//  - A shadow-ban answers exactly like a wrong password. The status, the
//    code and the message are the ones errors.mjs already produces, so an
//    attacker cannot tell a correct guess from a wrong one by the response.
//  - The delay is randomized per attempt, so an attacker cannot average it
//    out to learn whether an address exists.
//  - Signals are facts the runtime already has. No fingerprinting, no
//    third-party call on the login path.

import { evaluateRisk } from './security-policy.mjs';
import { resolveSecurityConfig } from './security-config.mjs';
import { AUTH_ERROR_CODES } from './errors.mjs';

export const SHADOW_GUARD_POLICY_VERSION = 'shadow-guard-v1';

// What the deployment asks the guard to do.
//
//  - off     : nothing runs.
//  - observe : the guard scores every login and reports, but refuses nobody.
//              This is the safe way to start: a ban can hit a correct
//              password (a first login on a new phone from a VPN is a new
//              device plus a network change), and a student who is refused
//              with "wrong password" has no way to tell what happened.
//              Watching first turns that from a guess into a measurement.
//  - enforce : a high band is refused.
export const SHADOW_GUARD_MODES = Object.freeze({
  OFF: 'off',
  OBSERVE: 'observe',
  ENFORCE: 'enforce'
});

/**
 * Map the activation value to a mode.
 *
 * An unset value - or one nobody recognises - is `observe`: the guard scores
 * and reports and refuses nobody. That is the fail-safe direction on both
 * sides, because a typo must never be able to lock a student out and must
 * never silently stop the guard either. Refusing a login takes the explicit
 * word `enforce` (or the older `canary`/`enabled`).
 *
 * The deployment carries no variable for this by default: the Worker sits on
 * Cloudflare's 64-variable free-tier ceiling, so a 65th is rejected at deploy
 * time. Code default, not a variable, for the same reason the other
 * activation switches in this repo default in code.
 */
export function resolveGuardMode(value) {
  const raw = String(value ?? '').trim().toLowerCase();
  if (raw === 'off' || raw === 'none' || raw === 'disabled') return SHADOW_GUARD_MODES.OFF;
  if (raw === 'enforce' || raw === 'canary' || raw === 'enabled' || raw === 'on') return SHADOW_GUARD_MODES.ENFORCE;
  return SHADOW_GUARD_MODES.OBSERVE;
}

// The delay window. Long enough to make a thousand attempts a thousand
// seconds, short enough that a person reading the message does not notice.
export const SHADOW_GUARD_DELAY_MIN_MS = 300;
export const SHADOW_GUARD_DELAY_MAX_MS = 900;

// A bot score below this is treated as a signal. Cloudflare reports 1-99
// where 1 is most automated; 30 catches the obvious cases without touching
// ordinary browsers, which score well above it.
export const SHADOW_GUARD_BOT_SCORE_THRESHOLD = 30;

// One address trying this many distinct accounts in the window is the shape
// of credential stuffing rather than a shared campus network.
export const SHADOW_GUARD_EMAILS_PER_IP_THRESHOLD = 10;

/**
 * Turn the facts a login request carries into two sets:
 *
 *  - `signals`, in the vocabulary the risk engine already knows, and
 *  - `extras`, observations the engine does not model (edge geography, bot
 *    score, stuffing from one address).
 *
 * Every input is optional: a missing fact is simply not a signal, so a
 * runtime that cannot report it degrades to less friction, never to an
 * accusation.
 */
export function computeRiskSignals(facts = {}) {
  const signals = {};

  if (facts.accountState) signals.accountState = facts.accountState;
  if (facts.recoveryActive === true) signals.recoveryActive = true;

  const failed = Math.max(0, Number(facts.failedLogins) || 0);
  if (failed > 0) signals.failedLogins = failed;

  const rapid = Math.max(0, Number(facts.rapidRequests) || 0);
  if (rapid > 0) signals.rapidRequests = rapid;

  if (facts.unverifiedAccount === true) signals.unverifiedAccount = true;

  // A device the account has never proved itself on. An established device
  // is never a signal, which is what keeps a returning student at LOW.
  if (facts.deviceKnown === false) signals.newDevice = true;

  // Geography and network. Both are reported by the edge, so a change is a
  // real observation rather than a guess; an absent value is not a change.
  // These stay in `extras` rather than being folded into an engine signal:
  // a country change is not a new device, and collapsing the two would
  // under-count independent signals and lose the escalation.
  const botScore = Number(facts.botScore);
  const botSuspicious = Number.isFinite(botScore) && botScore > 0 && botScore < SHADOW_GUARD_BOT_SCORE_THRESHOLD;
  const stuffing = (Number(facts.emailsFromIp) || 0) >= SHADOW_GUARD_EMAILS_PER_IP_THRESHOLD;

  const extras = [];
  if (facts.countryChanged === true) extras.push('country-changed');
  if (facts.asnChanged === true) extras.push('asn-changed');
  if (botSuspicious) extras.push('bot-suspicious');
  if (stuffing) extras.push('many-emails-from-ip');

  return Object.freeze({ signals: Object.freeze(signals), extras: Object.freeze(extras) });
}

// The engine returns five levels because account state can be CRITICAL. The
// caller only needs three decisions, and the owner named them: low, medium,
// high.
const BAND_BY_LEVEL = Object.freeze({
  LOW: 'low',
  NORMAL: 'low',
  ELEVATED: 'medium',
  HIGH: 'high',
  CRITICAL: 'high'
});

// The engine's behavioural signal names, so its own combination count can be
// read back out of `reasons`.
const ENGINE_BEHAVIOURS = new Set(['failed-logins-high', 'failed-logins-elevated', 'rapid-requests', 'new-device', 'unverified-account']);

const RANK = Object.freeze({ LOW: 0, NORMAL: 1, ELEVATED: 2, HIGH: 3, CRITICAL: 4 });
const LEVELS = Object.freeze(['LOW', 'NORMAL', 'ELEVATED', 'HIGH', 'CRITICAL']);

/**
 * Decide what a login attempt must do.
 *
 * The engine's own conservative rule is extended to the extras rather than
 * bypassed: one extra is a single signal and is capped at ELEVATED, two or
 * more independent extras reach HIGH, and an engine behaviour combined with
 * an extra also reaches HIGH. Nothing reaches CRITICAL on behaviour alone.
 *
 * @returns {object} frozen { band, level, reasons, extras, challenge,
 *   shadowBan, genericError, policyVersion }
 */
export function shadowVerdict(facts = {}, config = resolveSecurityConfig()) {
  const { signals, extras } = computeRiskSignals(facts);
  const evaluation = evaluateRisk(signals, config);
  const engineBehaviours = evaluation.reasons.filter(reason => ENGINE_BEHAVIOURS.has(reason)).length;

  let rank = RANK[evaluation.level] ?? 0;
  if (extras.length === 1) rank = Math.max(rank, RANK.ELEVATED);
  if (extras.length >= 2) rank = Math.max(rank, RANK.HIGH);
  if (engineBehaviours > 0 && extras.length > 0) rank = Math.max(rank, RANK.HIGH);
  // An authoritative fact (a suspended account) is the only route to
  // CRITICAL, and the engine has already applied it.
  if (evaluation.level === 'CRITICAL') rank = RANK.CRITICAL;

  const level = LEVELS[Math.min(rank, LEVELS.length - 1)];
  const band = BAND_BY_LEVEL[level] || 'low';

  return Object.freeze({
    policyVersion: SHADOW_GUARD_POLICY_VERSION,
    band,
    level,
    reasons: Object.freeze([...evaluation.reasons, ...extras]),
    extras,
    // A medium attempt may continue once the challenge is satisfied; a high
    // one is answered as though the credentials were wrong.
    challenge: band === 'medium' ? evaluation.actions.challenge || 'step-up' : null,
    shadowBan: band === 'high',
    genericError: band === 'high' ? AUTH_ERROR_CODES.INVALID_CREDENTIALS : null
  });
}

/**
 * A fresh delay for one attempt. Random on purpose: a fixed delay tells an
 * attacker that the account exists and that the delay is part of the
 * protocol rather than the network.
 *
 * The default source is Web Crypto rather than a weak pseudo-random call:
 * this runtime is audited for weak randomness (native-auth-protection.test.mjs
 * rejects it anywhere under auth-native), and a delay an attacker can predict
 * is a delay that tells them the account exists.
 */
export function cryptoRandomUnit(cryptoImpl = globalThis.crypto) {
  const buffer = new Uint32Array(1);
  if (cryptoImpl?.getRandomValues) {
    cryptoImpl.getRandomValues(buffer);
    return buffer[0] / 0x1_0000_0000;
  }
  return 0.5;
}

export function shadowDelayMs(random, min = SHADOW_GUARD_DELAY_MIN_MS, max = SHADOW_GUARD_DELAY_MAX_MS) {
  const low = Math.max(0, Math.min(min, max));
  const high = Math.max(low, max);
  const draw = Number(typeof random === 'function' ? random() : cryptoRandomUnit());
  const value = Number.isFinite(draw) ? Math.min(Math.max(draw, 0), 1) : 0;
  return Math.round(low + value * (high - low));
}

export function sleep(ms, timer = setTimeout) {
  const wait = Math.max(0, Number(ms) || 0);
  if (wait === 0) return Promise.resolve();
  return new Promise(resolve => timer(resolve, wait));
}
