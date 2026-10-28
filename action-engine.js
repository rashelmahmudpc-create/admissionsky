// 🧩 PHASE 9, M9: WRITE / EXECUTE ACTIONS
// The action permission layer the audit called missing (§52 gap 5/6): READ /
// WRITE / EXECUTE are separate classes, a write or execute action is disabled
// until a human confirms it, and every attempt leaves an audit record.
//
// Blueprint rule: no write/execute action is enabled by default, and every one
// requires explicit confirmation. That is why `ENABLED` is `false`: this module
// ships the *mechanism* (declaration, proposal, single-use confirmation, audit)
// without granting any live capability. Turning the layer on is a separate,
// owner-approved step, flip `ENABLED` in one place.
//
// Like the M6 tool registry, this module is pure data plus pure guards: no
// `env`, no I/O, no model call. The Worker performs the actual KV write; the
// engine only decides whether that write may happen and records the outcome.
//
// Owner isolation is structural, exactly as in M6/M7: the owner of an action is
// always the server-validated request identity, never a value the model or the
// request body can supply.

export const ACTION_VERSION = 'act-v1';

/**
 * Master switch. `true` as of the owner's 2026-09-24 decision to enable M9, so
 * `/api/ai/actions/*` is live for signed-in students. Every action still needs a
 * single-use confirmation, and every attempt is audited.
 *
 * The kill-switch is `USE_WRITE_ACTIONS = "disabled"` (see `actionsEnabled`), so
 * the layer can be turned back off from configuration without a code change.
 */
export const ENABLED = true;

/**
 * Whether the write/execute layer is on for this deployment. On by default, since
 * the owner enabled it; set `USE_WRITE_ACTIONS = "disabled"` to turn the whole
 * layer off from configuration alone. Any other value keeps the default.
 */
export function actionsEnabled(env) {
  return String(env?.USE_WRITE_ACTIONS || '').toLowerCase() !== 'disabled';
}

/** Permission classes an action may carry. READ stays in the M6 tool registry. */
export const PERMISSION = Object.freeze({
  WRITE: 'write',
  EXECUTE: 'execute'
});

/** Declared risk of an action, independent of its permission class. */
export const RISK = Object.freeze({
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high'
});

/** Lifecycle of a single action attempt. */
export const STATUS = Object.freeze({
  PROPOSED: 'proposed',
  CONFIRMED: 'confirmed',
  DENIED: 'denied',
  EXPIRED: 'expired',
  REPLAYED: 'replayed',
  FAILED: 'failed'
});

/** A confirmation is short-lived: an old "yes" must not act on a stale proposal. */
export const CONFIRM_TTL_MS = 5 * 60 * 1000;

/** Audit history is bounded per account. */
export const MAX_AUDIT = 200;

/** Fields every action declaration must carry. */
export const REQUIRED_ACTION_FIELDS = Object.freeze([
  'name', 'description', 'permission', 'riskLevel', 'ready', 'args'
]);

/** Argument keys that may never appear in a caller-supplied action payload. */
const OWNER_ARG_KEYS = Object.freeze(['uid', 'owneruid', 'owner', 'userid', 'accountid', 'user', 'account', 'deviceid']);

const MAX_SUMMARY_LEN = 220;
const MAX_ARG_LEN = 160;

/* Argument shape per action: only these keys survive sanitisation, so a payload
   cannot smuggle extra fields into the executor. */
const ARG_SPECS = Object.freeze({
  'prefs.write': Object.freeze(['langStyle', 'tone', 'responseLen'])
});

/* Declared actions. All are disabled: declaring a WRITE action grants nothing
   until the owner flips ENABLED *and* the action's own `enabled` flag. */
const REGISTRY = Object.freeze({
  'prefs.write': Object.freeze({
    name: 'prefs.write',
    description: "Save the signed-in student's own AI personalization (language style, tone, response length).",
    permission: PERMISSION.WRITE,
    riskLevel: RISK.LOW,
    // Isolation marker: only ever applied to the caller's own account.
    ownerScoped: true,
    args: Object.freeze([...ARG_SPECS['prefs.write']]),
    // Declared and ready, but inert: the master `ENABLED` switch above is off,
    // so nothing here runs until the owner turns the layer on. `ready` means the
    // declaration is complete, not that the action may run.
    ready: true
  })
});

export function getAction(name) {
  const entry = REGISTRY[String(name || '')];
  return entry || null;
}

export function listActions() {
  return Object.values(REGISTRY).map(
    ({ name, description, permission, riskLevel, ready, ownerScoped, args }) =>
      ({ name, description, permission, riskLevel, enabled: ENABLED && ready === true, ownerScoped: ownerScoped !== false, args: [...args] })
  );
}

/**
 * Structural self-check. Encodes the Phase 9 rules so a future addition cannot
 * quietly break them:
 *  - every action carries all required fields with a known permission/risk;
 *  - no action is enabled while the master switch is off;
 *  - every action is owner-scoped (no cross-user action may be registered);
 *  - every action declares an argument spec.
 */
export function validateActionEngine() {
  const problems = [];
  for (const [key, entry] of Object.entries(REGISTRY)) {
    for (const field of REQUIRED_ACTION_FIELDS) {
      if (entry[field] === undefined || entry[field] === null || entry[field] === '') {
        problems.push(key + ': missing ' + field);
      }
    }
    if (entry.name !== key) problems.push(key + ': name mismatch');
    if (!Object.values(PERMISSION).includes(entry.permission)) problems.push(key + ': unknown permission');
    if (!Object.values(RISK).includes(entry.riskLevel)) problems.push(key + ': unknown riskLevel');
    if (!ENABLED && listActions().some(a => a.enabled)) {
      problems.push(key + ': no action may be live while the layer is off');
    }
    if (entry.ownerScoped !== true) problems.push(key + ': action must be owner-scoped');
    if (!Array.isArray(entry.args) || entry.args.length === 0) problems.push(key + ': missing args');
  }
  return problems;
}

/**
 * The owner of an action is always the server-validated identity. Only a durable
 * account can own one; a guest uid or an empty uid owns nothing.
 */
export function resolveActionOwner(uid) {
  return String(uid || '').startsWith('account-') ? String(uid) : null;
}

/**
 * Keep only declared, non-owner argument keys, trimmed and length-bounded. A
 * payload naming an owner is rejected outright rather than silently stripped, so
 * the attempt is visible.
 */
export function sanitizeActionArgs(name, args) {
  const spec = ARG_SPECS[String(name || '')];
  if (!spec) return { ok: false, reason: 'unknown-action', args: null };
  if (args === undefined || args === null) return { ok: true, reason: 'ok', args: Object.freeze({}) };
  if (typeof args !== 'object' || Array.isArray(args)) return { ok: false, reason: 'bad-args', args: null };
  for (const key of Object.keys(args)) {
    if (OWNER_ARG_KEYS.includes(String(key).toLowerCase())) {
      return { ok: false, reason: 'owner-from-args-rejected', args: null };
    }
  }
  const out = {};
  for (const key of spec) {
    if (args[key] === undefined) continue;
    if (typeof args[key] !== 'string') return { ok: false, reason: 'bad-arg-type', args: null };
    out[key] = args[key].slice(0, MAX_ARG_LEN);
  }
  return { ok: true, reason: 'ok', args: Object.freeze(out) };
}

/**
 * Authorize an action. Denies, with a reason, unless every condition holds: the
 * layer is on, the action exists, is enabled, has a resolvable owner, and its
 * arguments are clean.
 *
 * `enabled` defaults to the module master switch, the Worker never overrides it.
 * Tests pass `enabled: true` to exercise the flow the switch guards.
 */
export function authorizeAction(name, { uid, args, enabled = ENABLED } = {}) {
  if (!enabled) return { allowed: false, reason: 'layer-disabled', owner: null, args: null };
  const action = getAction(name);
  if (!action) return { allowed: false, reason: 'unknown-action', owner: null, args: null };
  if (action.ready !== true) return { allowed: false, reason: 'action-not-ready', owner: null, args: null };

  const owner = resolveActionOwner(uid);
  if (!owner) return { allowed: false, reason: 'no-owner-identity', owner: null, args: null };

  const clean = sanitizeActionArgs(name, args);
  if (!clean.ok) return { allowed: false, reason: clean.reason, owner: null, args: null };
  return { allowed: true, reason: 'ok', owner, args: clean.args };
}

/**
 * Build a proposal the student must confirm. Returns null when authorization
 * fails, so a refused attempt can never become a confirmable proposal.
 */
export function makeProposal(name, { uid, args, now = Date.now(), id, enabled = ENABLED } = {}) {
  const auth = authorizeAction(name, { uid, args, enabled });
  if (!auth.allowed) return null;
  const action = getAction(name);
  const proposalId = String(id || '').trim();
  if (!proposalId) return null;
  return Object.freeze({
    id: proposalId,
    action: action.name,
    permission: action.permission,
    riskLevel: action.riskLevel,
    args: auth.args,
    ownerUid: auth.owner,
    summary: proposalSummary(action.name, auth.args),
    status: STATUS.PROPOSED,
    createdAt: now,
    expiresAt: now + CONFIRM_TTL_MS
  });
}

/** A short Bangla line describing what would happen, for the confirm prompt. */
export function proposalSummary(name, args = {}) {
  const a = args || {};
  let line;
  if (name === 'prefs.write') {
    const bits = [];
    if (a.langStyle) bits.push('ভাষা: ' + a.langStyle);
    if (a.tone) bits.push('সুর: ' + a.tone);
    if (a.responseLen) bits.push('উত্তরের দৈর্ঘ্য: ' + a.responseLen);
    line = bits.length ? 'তোমার AI পছন্দ সেভ করব, ' + bits.join(', ') : 'তোমার AI পছন্দ সেভ করব।';
  } else {
    line = 'এই কাজটা করব: ' + String(name || '');
  }
  return line.slice(0, MAX_SUMMARY_LEN);
}

/**
 * Decide whether a confirmation may proceed. Pure: the caller supplies the
 * stored proposal, the confirmation token it issued, the caller's uid and the
 * current time. A confirmation is refused when the layer is off, the proposal is
 * missing or malformed, the caller is not the owner, the token does not match,
 * or the proposal has expired.
 *
 * Single-use is enforced by the caller deleting the stored proposal on success -
 * the same token then finds no proposal and reports `already-consumed`.
 */
export function confirmProposal(proposal, token, callerUid, { now = Date.now(), enabled = ENABLED } = {}) {
  if (!enabled) return { ok: false, reason: 'layer-disabled', status: STATUS.DENIED };
  if (!proposal || typeof proposal !== 'object') return { ok: false, reason: 'no-proposal', status: STATUS.DENIED };

  const owner = resolveActionOwner(callerUid);
  if (!owner) return { ok: false, reason: 'no-owner-identity', status: STATUS.DENIED };
  if (String(proposal.ownerUid || '') !== owner) return { ok: false, reason: 'owner-mismatch', status: STATUS.DENIED };

  const wanted = String(proposal.id || '');
  if (!wanted || String(token || '') !== wanted) return { ok: false, reason: 'bad-token', status: STATUS.DENIED };

  if (!Number.isFinite(proposal.expiresAt) || now > proposal.expiresAt) {
    return { ok: false, reason: 'expired', status: STATUS.EXPIRED };
  }
  return {
    ok: true,
    reason: 'ok',
    status: STATUS.CONFIRMED,
    action: proposal.action,
    args: proposal.args || Object.freeze({}),
    owner
  };
}

/** A bounded, owner-stamped audit record for one attempt. */
export function makeAuditRecord({ proposal, status, uid, at = Date.now(), detail = '' } = {}) {
  const owner = resolveActionOwner(uid);
  if (!owner) return null;
  return Object.freeze({
    action: String(proposal?.action || '').slice(0, 64),
    status: Object.values(STATUS).includes(status) ? status : STATUS.FAILED,
    ownerUid: owner,
    args: Object.freeze({ ...(proposal?.args || {}) }),
    summary: String(proposal?.summary || '').slice(0, MAX_SUMMARY_LEN),
    detail: String(detail || '').slice(0, MAX_SUMMARY_LEN),
    at
  });
}

/** Parse stored audit history, keeping only the caller's own records. */
export function parseAudit(raw, callerUid) {
  const owner = resolveActionOwner(callerUid);
  if (!owner) return [];
  let list = [];
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (Array.isArray(parsed)) list = parsed;
  } catch (_) { list = []; }
  return list
    .filter(r => r && String(r.ownerUid || '') === owner)
    .slice(0, MAX_AUDIT)
    .map(r => Object.freeze({ ...r, ownerUid: owner }));
}

/** Prepend a record, newest first, bounded. */
export function appendAudit(list, record, callerUid) {
  const owner = resolveActionOwner(callerUid);
  const base = parseAudit(list, callerUid);
  if (!record || record.ownerUid !== owner) return base;
  return [Object.freeze({ ...record }), ...base].slice(0, MAX_AUDIT);
}

/** Metadata for `agentStatus`, shape only, never a capability. */
export function describeActions(env) {
  const on = actionsEnabled(env);
  return Object.freeze({
    version: ACTION_VERSION,
    enabled: on,
    confirmTtlMs: CONFIRM_TTL_MS,
    declared: listActions().map(a => ({ ...a, enabled: on && a.enabled }))
  });
}
