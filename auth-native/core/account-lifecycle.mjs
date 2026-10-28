// Phase 3, Account Lifecycle (state machine)
//
// Centralized account state authority. Frontend components and feature
// modules must never mutate account state directly; every state change
// flows through this module and is validated against the transition table.
//
// States (blueprint §10 / EXTRA 04):
//   provisioning         , account record exists, identity not fully settled
//   verification_required, identity settled, ownership verification pending
//   active               , fully usable; the ONLY state that may hold sessions
//   restricted           , authenticated actions limited (security hold)
//   suspended            , disabled by authority (admin/Firebase disabled)
//   recovery             , explicit recovery/reactivation in progress
//   deactivated          , deactivated; identity retained, never reused
//
// Legacy storage values (pre-Phase 3 rows) normalize into the canonical set:
//   'disabled' -> 'suspended'

import { AUTH_ERROR_CODES, NativeAuthError } from './errors.mjs';

export const ACCOUNT_STATES = Object.freeze([
  'provisioning',
  'verification_required',
  'active',
  'restricted',
  'suspended',
  'recovery',
  'deactivated'
]);

// Canonical single source of truth for session usability: only 'active'.
// Matches the live session check (status !== 'active' -> ACCOUNT_DISABLED).
export const SESSION_USABLE_STATES = Object.freeze(['active']);

const ALIASES = Object.freeze({
  disabled: 'suspended',
  verified: 'active',
  pending: 'provisioning'
});

export function normalizeAccountStatus(raw) {
  const value = String(raw ?? '').trim().toLowerCase();
  const canonical = ALIASES[value] || value;
  if (!ACCOUNT_STATES.includes(canonical)) {
    throw new NativeAuthError(AUTH_ERROR_CODES.ACCOUNT_STATE_INVALID);
  }
  return canonical;
}

const TRANSITIONS = Object.freeze({
  provisioning: new Set(['verification_required', 'active', 'restricted', 'suspended', 'deactivated']),
  verification_required: new Set(['active', 'restricted', 'suspended', 'deactivated']),
  active: new Set(['verification_required', 'restricted', 'suspended', 'recovery', 'deactivated']),
  restricted: new Set(['active', 'suspended', 'deactivated']),
  suspended: new Set(['active', 'recovery', 'deactivated']),
  recovery: new Set(['active', 'suspended', 'deactivated']),
  deactivated: new Set(['recovery'])
});

export function canTransition(fromRaw, toRaw) {
  try {
    const from = normalizeAccountStatus(fromRaw);
    const to = normalizeAccountStatus(toRaw);
    if (from === to) return true;
    return TRANSITIONS[from].has(to);
  } catch {
    return false;
  }
}

// Returns the canonical target state, or throws ACCOUNT_STATE_INVALID.
export function transitionAccount(fromRaw, toRaw) {
  const from = normalizeAccountStatus(fromRaw);
  const to = normalizeAccountStatus(toRaw);
  if (from === to) return to;
  if (!TRANSITIONS[from].has(to)) {
    throw new NativeAuthError(AUTH_ERROR_CODES.ACCOUNT_STATE_INVALID);
  }
  return to;
}

export function isSessionUsable(statusRaw) {
  try {
    return SESSION_USABLE_STATES.includes(normalizeAccountStatus(statusRaw));
  } catch {
    return false;
  }
}

// Deactivation contract (blueprint §32): identity retained, account disabled,
// User ID never reused. Reactivation only through recovery.
export const DEACTIVATION_POLICY = Object.freeze({
  retainsIdentity: true,
  revokesSessions: true,
  userIdNeverReused: true,
  reactivationPath: 'recovery'
});
