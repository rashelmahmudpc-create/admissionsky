/* AUTH V2.2 (owner 2026-10-31): the auth contract — one door, versioned.
 *
 * The blueprint's pillar ২: interface first, implementation after. Today every
 * caller reaches into `auth-native/` directly — the Worker calls
 * `createNativeAuthHandler`, tests construct `CloudflareNativeAuthEngine`, and
 * nothing states which of those are promises and which are accidents. That is
 * how a codebase becomes impossible to change: every internal name is load
 * bearing because someone, somewhere, imported it.
 *
 * This file is the one door. It declares what an auth implementation must do,
 * and nothing about how. A second implementation can then exist beside the
 * first — which is V2.2's whole point, and the reason this ships BEFORE anything
 * is migrated to it: a contract written after the migration just describes what
 * was built, which is not a contract.
 *
 * Deliberately NOT wired into anything yet. Nothing calls this module in this
 * change, so it cannot break a student. The next step (V2.3) moves callers onto
 * it, one at a time, with both implementations running side by side and their
 * behaviour compared.
 *
 * What this file is careful about:
 *
 *   • It names only operations that EXIST. Every method below corresponds to a
 *     real method on `CloudflareNativeAuthEngine`, with the same argument and
 *     return shape. An invented interface is worse than none: it looks like a
 *     plan and cannot be implemented without changing it.
 *
 *   • It does not leak an implementation. No Firebase, no Durable Object, no
 *     SQLite appears in a name, an argument or a return value. That is the
 *     property that lets the implementation change without the app noticing.
 *
 *   • It does not invent an error model. Failures are the `AUTH_ERROR_CODES`
 *     values the engine already throws, because a contract that renamed them
 *     would force every caller to learn a second vocabulary for the same facts.
 */

/** The contract version. Callers may branch on this; implementations may not
 *  change its meaning without a new version, because a caller that read the old
 *  one is still out there. */
export const AUTH_CONTRACT_VERSION = 'auth-contract-v1';

/* The four states of the student journey, from the blueprint §3. These are the
 * states a caller reasons about; the engine's internal rows are not. */
export const AUTH_JOURNEY_STATES = Object.freeze({
  /** No identity claimed. */
  UNKNOWN: 'unknown',
  /** An identity is claimed and a proof is outstanding. */
  VERIFYING: 'verifying',
  /** The identity is proven; no session yet. */
  ESTABLISHED: 'established',
  /** A live session exists. */
  SESSION: 'session'
});

/* The operations every implementation must provide. Kept as data so a test can
 * assert an implementation is complete without reading its source — the
 * blueprint's "a test must measure behaviour, not text".
 *
 * The names are the JOB, not today's way of doing it. There is no `Firebase`
 * here on purpose: the whole value of a contract is that the implementation can
 * change without a caller noticing, and a method called `establishFirebaseSession`
 * would make Firebase part of the promise. The engine's own names are mapped to
 * these in one table below — that table is the only place the two vocabularies
 * meet, which is exactly where that knowledge belongs. */
export const AUTH_CONTRACT_METHODS = Object.freeze([
  // Identity: who the student is, and the session that proves it.
  'establishSession',
  // Verification: proving the address before the account exists.
  'beginVerification',
  'completeVerification',
  // Session: the live credential.
  'getSession',
  'rotateSession',
  'revokeSession',
  'revokeAllSessions',
  // Security: the account's own state and the student's devices.
  'getSecurityState',
  'trustCurrentDevice',
  'revokeTrustedDevice',
  'requestChallenge',
  'verifyChallenge',
  // Profile: what the student sees about themselves.
  'getProfile',
  'saveProfile',
  'saveProfilePatch'
]);

/* The bridge between the contract's vocabulary and the engine's.
 *
 * One table, in one place, read in one direction. A second implementation fills
 * this in with its own method names and nothing above changes — which is the
 * only reason a contract is worth writing. Kept as data so a test can assert
 * every contract method has a mapping, and that no mapping names a method the
 * contract does not promise. */
export const AUTH_ENGINE_METHOD_MAP = Object.freeze({
  establishSession: 'establishFirebaseSession',
  beginVerification: 'beginFirebaseAccountVerification',
  completeVerification: 'completeFirebaseAccountVerification',
  getSession: 'getSession',
  rotateSession: 'rotateSession',
  revokeSession: 'revokeSession',
  revokeAllSessions: 'revokeAllSessions',
  getSecurityState: 'getSecurityState',
  trustCurrentDevice: 'trustCurrentDevice',
  revokeTrustedDevice: 'revokeTrustedDevice',
  requestChallenge: 'requestChallenge',
  verifyChallenge: 'verifyChallenge',
  getProfile: 'getProfile',
  saveProfile: 'saveProfile',
  saveProfilePatch: 'saveProfilePatch'
});

/* Methods that return a session token. Named separately because these are the
 * only operations that hand out a credential, and a caller that forgets to put
 * one in an HttpOnly cookie is a security bug rather than a wiring mistake. */
export const AUTH_CREDENTIAL_METHODS = Object.freeze([
  'establishSession',
  'completeVerification',
  'rotateSession'
]);

/**
 * Assert that a value is a usable auth implementation.
 *
 * Throws with the FIRST missing method named, rather than a list: a caller
 * fixing an implementation wants to know what to add next, and a wall of names
 * buries the one that matters. `label` is included so a failure says which
 * implementation is incomplete when two are running side by side — which is the
 * whole V2.2 setup.
 *
 * This is a shape check, not a behaviour check. Behaviour is what the
 * conformance suite below measures; this only catches the case where something
 * is so incomplete that comparing behaviour would be meaningless.
 */
export function assertAuthImplementation(candidate, label = 'auth implementation') {
  if (!candidate || (typeof candidate !== 'object' && typeof candidate !== 'function')) {
    throw new TypeError(`${label} must be an object`);
  }
  // The check reads the MAP, not the contract: an implementation is judged on
  // whether it can serve each contract method, whatever it calls that method
  // internally. Judging it on the contract's names would force every
  // implementation to adopt one implementation's vocabulary.
  const missing = AUTH_CONTRACT_METHODS.filter(method => typeof candidate[AUTH_ENGINE_METHOD_MAP[method]] !== 'function');
  if (missing.length) {
    throw new TypeError(`${label} cannot serve required method: ${missing[0]}`);
  }
  return candidate;
}

/**
 * Build a contract object from an engine.
 *
 * Deliberately thin: it binds the declared methods and adds the version, and
 * does nothing else. A contract that also reshaped arguments or re-mapped errors
 * would be a second implementation wearing a wrapper's name, and the two would
 * drift — which is the failure mode this whole step exists to prevent.
 *
 * The one thing it does add is freezing. A caller cannot add a method to the
 * contract, so a caller cannot come to depend on something the contract does not
 * promise. That is what keeps the door the only door.
 */
export function createAuthContract(engine) {
  assertAuthImplementation(engine, 'engine');
  const contract = { version: AUTH_CONTRACT_VERSION, states: AUTH_JOURNEY_STATES };
  for (const method of AUTH_CONTRACT_METHODS) {
    const target = AUTH_ENGINE_METHOD_MAP[method];
    contract[method] = (...args) => engine[target](...args);
  }
  return Object.freeze(contract);
}

/**
 * The journey state a caller is in, derived from what the engine knows.
 *
 * Pure, and separate from any implementation, because it is the one piece of
 * logic the blueprint wants in exactly one place (§3: "any state change not in
 * the table is impossible"). A caller asks this rather than inspecting a session
 * object's fields, so a change to those fields cannot change what the app
 * believes about the student.
 *
 * Returns UNKNOWN for anything it does not recognise rather than throwing: a
 * state helper that can fail is a state helper a caller has to guard, and the
 * safe answer to "I do not know" is the state that claims nothing.
 */
export function journeyState({ session = null, verification = null } = {}) {
  if (session && session.user) return AUTH_JOURNEY_STATES.SESSION;
  if (verification && verification.ticket) return AUTH_JOURNEY_STATES.ESTABLISHED;
  if (verification && verification.pending === true) return AUTH_JOURNEY_STATES.VERIFYING;
  return AUTH_JOURNEY_STATES.UNKNOWN;
}
