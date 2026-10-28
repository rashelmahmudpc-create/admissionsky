// 🧩 PHASE 9, M6: TOOL REGISTRY
// Typed, permission-classified tool declarations with cross-user isolation
// enforced at the tool boundary.
//
// Blueprint rule (§52 gap 4, §28/§45/§47 finding S6): a tool is a *typed*
// declaration carrying name / description / permission / inputSchema /
// outputSchema / riskLevel / enabled, and the permission classes READ, WRITE and
// EXECUTE are separated with READ-only as the default. Cross-user isolation must
// be designed in here, not retrofitted later, so the owner of any tool call is
// always the server-validated request identity, never a value the model or the
// client can supply.
//
// Nothing here executes anything. This module is pure data plus pure guards; the
// chat path does not invoke it yet. Registering a tool grants no capability.

export const TOOL_REGISTRY_VERSION = 'tr-v1';

/** Permission classes. Only READ may be enabled in Phase 9. */
export const PERMISSION = Object.freeze({
  READ: 'read',
  WRITE: 'write',
  EXECUTE: 'execute'
});

/** Declared risk of a tool, independent of its permission class. */
export const RISK = Object.freeze({
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high'
});

/** Fields every tool declaration must carry. */
export const REQUIRED_TOOL_FIELDS = Object.freeze([
  'name', 'description', 'permission', 'inputSchema', 'outputSchema', 'riskLevel', 'enabled'
]);

/* A frozen JSON-Schema-shaped description. Kept tiny on purpose: it documents the
   contract for a future caller and for tests, and carries no runtime behaviour. */
const schema = (type, properties, required = []) =>
  Object.freeze({ type, properties: Object.freeze({ ...properties }), required: Object.freeze([...required]) });

/* The registry is deliberately empty of *enabled* capability: the one entry below
   is declared READ-only, owner-scoped and disabled, so M6 ships the rules a tool
   must satisfy without turning anything on. Enabling a tool is a later, separate,
   owner-approved step. */
const REGISTRY = Object.freeze({
  'student.progress.read': Object.freeze({
    name: 'student.progress.read',
    description: "Read the signed-in student's own practice stats (exams, questions, accuracy, streak, mistakes).",
    permission: PERMISSION.READ,
    inputSchema: schema('object', {}, []),
    outputSchema: schema('object', {
      ownerUid: { type: 'string' },
      exams: { type: 'number' },
      questions: { type: 'number' },
      accuracy: { type: 'number' },
      streak: { type: 'number' },
      mistakes: { type: 'number' }
    }, ['ownerUid']),
    riskLevel: RISK.LOW,
    // Isolation marker: this tool may only ever run against the caller's own data.
    ownerScoped: true,
    // Enabled because it is READ-only and owner-scoped, the one class of tool
    // Phase 9 permits. Enabled ≠ wired: the chat path does not call it yet, so
    // this grants no runtime capability. WRITE/EXECUTE stay disabled until M9.
    enabled: true
  }),
  /* owner 2026-10-18: live web search (Tavily). READ-only; it reads no user data
     at all, only the cleaned question text leaves the server, so it is
     owner-scoped by construction. Daily cap + kill switch live in sky-tools.mjs. */
  'web.search': Object.freeze({
    name: 'web.search',
    description: 'Search the live web for news or recent facts; returns titles, snippets and source links.',
    permission: PERMISSION.READ,
    inputSchema: schema('object', { query: { type: 'string' } }, ['query']),
    outputSchema: schema('object', { results: { type: 'array' } }, ['results']),
    riskLevel: RISK.LOW,
    ownerScoped: true,
    enabled: true
  }),
  /* owner 2026-10-18: live clock + calendar (Asia/Dhaka, Bangla date, days left).
     Pure computation, reads no user data. */
  'time.now': Object.freeze({
    name: 'time.now',
    description: 'Current date and time in Bangladesh (Asia/Dhaka), weekday, Bangla date and days left to a date.',
    permission: PERMISSION.READ,
    inputSchema: schema('object', { text: { type: 'string' } }, []),
    outputSchema: schema('object', { iso: { type: 'string' }, weekday: { type: 'string' }, bangla: { type: 'string' } }, ['iso']),
    riskLevel: RISK.LOW,
    ownerScoped: true,
    enabled: true
  })
});

/** Tool names that may not appear in a caller-supplied argument object. */
const OWNER_ARG_KEYS = Object.freeze(['uid', 'owneruid', 'owner', 'userid', 'accountid', 'user', 'account', 'deviceid']);

export function getTool(name) {
  const entry = REGISTRY[String(name || '')];
  return entry || null;
}

export function listTools() {
  return Object.values(REGISTRY).map(
    ({ name, description, permission, riskLevel, enabled, ownerScoped }) =>
      ({ name, description, permission, riskLevel, enabled, ownerScoped: ownerScoped !== false })
  );
}

/**
 * Structural self-check for the registry. Encodes the Phase 9 safety rules so a
 * future addition cannot quietly break them:
 *  - every tool carries all required fields, with a known permission/risk;
 *  - only READ tools may be enabled (WRITE/EXECUTE stay off until M9);
 *  - every tool is owner-scoped (no cross-user tool may be registered).
 */
export function validateToolRegistry() {
  const problems = [];
  for (const [key, entry] of Object.entries(REGISTRY)) {
    for (const field of REQUIRED_TOOL_FIELDS) {
      if (entry[field] === undefined || entry[field] === null || entry[field] === '') {
        problems.push(key + ': missing ' + field);
      }
    }
    if (entry.name !== key) problems.push(key + ': name mismatch');
    if (!Object.values(PERMISSION).includes(entry.permission)) problems.push(key + ': unknown permission');
    if (!Object.values(RISK).includes(entry.riskLevel)) problems.push(key + ': unknown riskLevel');
    if (entry.permission !== PERMISSION.READ && entry.enabled) {
      problems.push(key + ': non-READ tool must not be enabled before M9');
    }
    if (entry.ownerScoped !== true) problems.push(key + ': tool must be owner-scoped');
    if (!entry.inputSchema || typeof entry.inputSchema !== 'object') problems.push(key + ': bad inputSchema');
    if (!entry.outputSchema || typeof entry.outputSchema !== 'object') problems.push(key + ': bad outputSchema');
  }
  return problems;
}

/**
 * The owner of a tool call is always the server-validated identity. A tool may
 * never be pointed at another user, so the owner is derived from the uid alone
 * and never merged with anything the model or the request body supplied.
 * Returns null when there is no durable account to scope to.
 */
export function resolveToolOwner(uid) {
  return String(uid || '').startsWith('account-') ? String(uid) : null;
}

/**
 * Authorize a tool call. Denies, with a reason, unless every condition holds:
 * the tool exists, is enabled, is READ-only, has a resolvable owner, and its
 * arguments carry no attempt to name another owner. `owner` in the result is the
 * uid the caller must use, callers must never build it themselves.
 */
export function authorizeToolCall(name, { uid, args } = {}) {
  const tool = getTool(name);
  if (!tool) return { allowed: false, reason: 'unknown-tool', owner: null };
  if (!tool.enabled) return { allowed: false, reason: 'tool-disabled', owner: null };
  if (tool.permission !== PERMISSION.READ) return { allowed: false, reason: 'permission-denied', owner: null };

  const owner = resolveToolOwner(uid);
  if (!owner) return { allowed: false, reason: 'no-owner-identity', owner: null };

  if (args && typeof args === 'object') {
    for (const key of Object.keys(args)) {
      if (OWNER_ARG_KEYS.includes(String(key).toLowerCase())) {
        return { allowed: false, reason: 'owner-from-args-rejected', owner: null };
      }
    }
  }
  return { allowed: true, reason: 'ok', owner };
}

/**
 * Second gate: a tool result must declare the owner it was produced for, and that
 * owner must equal the caller. A missing or mismatched owner is treated as a leak
 * and blocked rather than trusted.
 */
export function guardToolResult(result, callerUid) {
  const owner = callerUid && String(callerUid).startsWith('account-') ? String(callerUid) : null;
  if (!owner) return { ok: false, reason: 'no-owner-identity' };
  if (!result || typeof result !== 'object') return { ok: false, reason: 'empty-result' };
  if (String(result.ownerUid || '') !== owner) return { ok: false, reason: 'owner-mismatch' };
  return { ok: true, reason: 'ok' };
}