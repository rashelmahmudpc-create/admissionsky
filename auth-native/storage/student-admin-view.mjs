// Fresh Start phase 3 (2026-10-17): read-only Students view for the Control Center.
//
// Reads the live auth tables of the AUTH_AUTHORITY Durable Object (the source
// of truth for every account) and returns an admin-safe projection:
//   - email only as the stored mask (no plaintext email exists server-side);
//   - opaque refs (device/session) shortened to 8 chars, never full;
//   - never: codes, MACs, ciphers, tokens, public keys, IP refs, raw user agents.
// Nothing here writes. Gated by ADMIN_TOKEN in the public handler.

import { coarseUserAgent } from '../core/crypto.mjs';

export const STUDENT_LIST_MAX = 100;
const DAY_MS = 24 * 60 * 60 * 1000;

const rows = (sql, statement, ...bindings) => {
  const result = sql.exec(statement, ...bindings);
  if (Array.isArray(result)) return result;
  return typeof result?.toArray === 'function' ? result.toArray() : [];
};
const one = (sql, statement, ...bindings) => rows(sql, statement, ...bindings)[0] || null;
const has = (sql, table) => Boolean(one(sql, "SELECT name FROM sqlite_master WHERE type='table' AND name=?", table));
const num = value => (value === null || value === undefined ? null : Number(value));
const short = value => (value ? String(value).slice(0, 8) : null);
const clampLimit = value => Math.min(Math.max(Math.trunc(Number(value) || 50), 1), STUDENT_LIST_MAX);
const likeEscape = value => String(value).replace(/[\\%_]/g, char => '\\' + char);
const parseList = raw => { try { const value = JSON.parse(raw || '[]'); return Array.isArray(value) ? value.slice(0, 20).map(String) : []; } catch { return []; } };
const maskMobile = raw => { const digits = String(raw || '').replace(/\D/g, ''); return digits.length >= 4 ? '•••' + digits.slice(-3) : null; };

export function studentCounts(sql, { now = Date.now() } = {}) {
  if (!has(sql, 'auth_users')) return { total: 0, active: 0, disabled: 0, suspended: 0, last24h: 0, last7d: 0 };
  const stateJoin = has(sql, 'auth_account_state') ? 'LEFT JOIN auth_account_state st ON st.user_id=u.user_id' : '';
  /* AUTH V2.4 (owner 2026-11-02): the effective status is the one that is
   * written. `active` already read it, but the two counts beside it read
   * `u.status` — the column set once at INSERT, always to 'active', and never
   * updated. So the dashboard's "suspended" and "disabled" figures were
   * structurally always zero: an operator looking at a suspended student saw
   * them counted as neither, and the totals did not add up.
   *
   * Measured before fixing: two users, one suspended through the account-state
   * table, gave {total: 2, active: 1, suspended: 0}. */
  const effective = stateJoin ? "CASE WHEN u.status<>'active' THEN u.status ELSE COALESCE(st.status,'active') END" : 'u.status';
  const row = one(sql, `SELECT COUNT(*) AS total,
      SUM(CASE WHEN ${effective}='active' THEN 1 ELSE 0 END) AS active,
      SUM(CASE WHEN ${effective}='disabled' THEN 1 ELSE 0 END) AS disabled,
      SUM(CASE WHEN ${effective}='suspended' THEN 1 ELSE 0 END) AS suspended,
      SUM(CASE WHEN u.created_at>=? THEN 1 ELSE 0 END) AS last24h,
      SUM(CASE WHEN u.created_at>=? THEN 1 ELSE 0 END) AS last7d
    FROM auth_users u ${stateJoin}`, Number(now) - DAY_MS, Number(now) - 7 * DAY_MS) || {};
  return {
    total: Number(row.total || 0), active: Number(row.active || 0), disabled: Number(row.disabled || 0),
    suspended: Number(row.suspended || 0), last24h: Number(row.last24h || 0), last7d: Number(row.last7d || 0)
  };
}

// emailRef: exact HMAC ref (caller hashes the typed email the same way the
// engine does). text: user id prefix or name substring.
export function listStudents(sql, { limit, before = null, emailRef = null, text = null, now = Date.now() } = {}) {
  const size = clampLimit(limit);
  const counts = studentCounts(sql, { now });
  if (!has(sql, 'auth_users')) return { counts, entries: [], nextBefore: null };
  const where = [];
  const bindings = [];
  if (before !== null && before !== undefined && before !== '') {
    const cursor = Number(before);
    if (Number.isFinite(cursor) && cursor > 0) { where.push('u.created_at<?'); bindings.push(cursor); }
  }
  if (emailRef) { where.push('u.email_ref=?'); bindings.push(String(emailRef)); }
  const hasProfiles = has(sql, 'auth_profiles');
  if (text) {
    const pattern = likeEscape(String(text).trim().slice(0, 80));
    if (hasProfiles) { where.push("(u.user_id LIKE ? ESCAPE '\\' OR p.full_name LIKE ? ESCAPE '\\')"); bindings.push(pattern + '%', '%' + pattern + '%'); }
    else { where.push("u.user_id LIKE ? ESCAPE '\\'"); bindings.push(pattern + '%'); }
  }
  const select = [
    'u.user_id AS userId', 'u.email_mask AS emailMask', 'u.status AS status',
    'u.created_at AS createdAt', 'u.last_login_at AS lastLoginAt',
    hasProfiles ? 'p.full_name AS fullName' : 'NULL AS fullName',
    hasProfiles ? 'p.admission_session AS admissionSession' : 'NULL AS admissionSession',
    has(sql, 'auth_account_state') ? 'st.status AS lifecycle' : 'NULL AS lifecycle',
    has(sql, 'auth_passkey_credentials') ? "(SELECT COUNT(*) FROM auth_passkey_credentials c WHERE c.user_id=u.user_id AND c.status='active') AS passkeys" : '0 AS passkeys',
    has(sql, 'auth_telegram_identity_links') ? "(SELECT COUNT(*) FROM auth_telegram_identity_links t WHERE t.user_id=u.user_id AND t.status='active') AS telegram" : '0 AS telegram',
    has(sql, 'auth_email_ownership_links') ? "(SELECT COUNT(*) FROM auth_email_ownership_links e WHERE e.user_id=u.user_id AND e.status='active') AS emailOwned" : '0 AS emailOwned',
    has(sql, 'auth_external_identities') ? '(SELECT GROUP_CONCAT(x.provider) FROM auth_external_identities x WHERE x.user_id=u.user_id) AS providers' : 'NULL AS providers'
  ];
  const joins = [
    hasProfiles ? 'LEFT JOIN auth_profiles p ON p.user_id=u.user_id' : '',
    has(sql, 'auth_account_state') ? 'LEFT JOIN auth_account_state st ON st.user_id=u.user_id' : ''
  ].join(' ');
  const list = rows(sql, `SELECT ${select.join(', ')} FROM auth_users u ${joins}
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY u.created_at DESC, u.user_id DESC LIMIT ?`, ...bindings, size);
  const entries = list.map(row => ({
    userId: String(row.userId),
    emailMask: row.emailMask || null,
    status: row.status !== 'active' ? row.status : (row.lifecycle || 'active'),
    fullName: row.fullName || null,
    admissionSession: row.admissionSession || null,
    createdAt: num(row.createdAt),
    lastLoginAt: num(row.lastLoginAt),
    methods: loginMethodLabels(row)
  }));
  return { counts, entries, nextBefore: entries.length === size ? entries[entries.length - 1].createdAt : null };
}

function loginMethodLabels(row) {
  const labels = [];
  for (const provider of String(row.providers || '').split(',').filter(Boolean)) labels.push(provider === 'firebase' ? 'firebase' : provider);
  if (Number(row.passkeys) > 0) labels.push('passkey');
  if (Number(row.telegram) > 0) labels.push('telegram');
  if (Number(row.emailOwned) > 0) labels.push('email-otp');
  return [...new Set(labels)];
}

export function studentProfile(sql, userId, { now = Date.now() } = {}) {
  const id = String(userId || '').trim();
  if (!id || id.length > 128 || !has(sql, 'auth_users')) return null;
  const user = one(sql, 'SELECT user_id AS userId, email_mask AS emailMask, status, created_at AS createdAt, last_login_at AS lastLoginAt FROM auth_users WHERE user_id=?', id);
  if (!user) return null;
  const lifecycle = has(sql, 'auth_account_state') ? one(sql, 'SELECT status, updated_at AS updatedAt FROM auth_account_state WHERE user_id=?', id) : null;
  const publicId = has(sql, 'auth_public_identities') ? one(sql, 'SELECT public_id AS publicId FROM auth_public_identities WHERE user_id=?', id) : null;
  const p = has(sql, 'auth_profiles') ? one(sql, 'SELECT * FROM auth_profiles WHERE user_id=?', id) : null;
  const profile = p ? {
    fullName: p.full_name || null,
    dateOfBirth: p.date_of_birth || null,
    school: p.school_name ? { name: p.school_name, district: p.school_district || null } : null,
    higher: p.higher_name ? { name: p.higher_name, district: p.higher_district || null } : null,
    admissionSession: p.admission_session || null,
    academicGoal: p.academic_goal || null,
    subjects: parseList(p.subjects),
    targets: parseList(p.targets),
    visibility: p.visibility || 'private',
    mobileMasked: maskMobile(p.mobile),
    createdAt: num(p.created_at),
    updatedAt: num(p.updated_at)
  } : null;

  const loginMethods = [];
  if (has(sql, 'auth_external_identities')) {
    for (const row of rows(sql, 'SELECT provider, created_at AS createdAt, last_verified_at AS lastVerifiedAt FROM auth_external_identities WHERE user_id=? ORDER BY created_at', id)) {
      loginMethods.push({ method: row.provider, note: row.provider === 'firebase' ? 'password বা Google (Firebase Auth)' : null, since: num(row.createdAt), lastUsedAt: num(row.lastVerifiedAt), status: 'active' });
    }
  }
  if (has(sql, 'auth_passkey_credentials')) {
    for (const row of rows(sql, 'SELECT status, created_at AS createdAt, last_used_at AS lastUsedAt, revoked_at AS revokedAt FROM auth_passkey_credentials WHERE user_id=? ORDER BY created_at', id)) {
      loginMethods.push({ method: 'passkey', note: null, since: num(row.createdAt), lastUsedAt: num(row.lastUsedAt), status: row.status, revokedAt: num(row.revokedAt) });
    }
  }
  if (has(sql, 'auth_telegram_identity_links')) {
    const row = one(sql, 'SELECT status, linked_at AS linkedAt, last_verified_at AS lastVerifiedAt, revoked_at AS revokedAt FROM auth_telegram_identity_links WHERE user_id=?', id);
    if (row) loginMethods.push({ method: 'telegram', note: null, since: num(row.linkedAt), lastUsedAt: num(row.lastVerifiedAt), status: row.status, revokedAt: num(row.revokedAt) });
  }

  const ownership = has(sql, 'auth_email_ownership_links')
    ? one(sql, 'SELECT provider_id AS providerId, method, status, proven_at AS provenAt, last_verified_at AS lastVerifiedAt, revoked_at AS revokedAt FROM auth_email_ownership_links WHERE user_id=?', id)
    : null;
  const firebaseLinks = has(sql, 'auth_account_verification_tickets')
    ? rows(sql, 'SELECT state, purpose, created_at AS createdAt, consumed_at AS consumedAt FROM auth_account_verification_tickets WHERE user_id=? ORDER BY created_at DESC LIMIT 20', id)
        .map(row => ({ state: row.state, purpose: row.purpose || null, createdAt: num(row.createdAt), consumedAt: num(row.consumedAt) }))
    : [];
  const emailVerification = {
    otpOwnership: ownership ? { ...ownership, provenAt: num(ownership.provenAt), lastVerifiedAt: num(ownership.lastVerifiedAt), revokedAt: num(ownership.revokedAt) } : null,
    firebaseLinks
  };

  const otpChallenges = has(sql, 'auth_verification_challenges')
    ? rows(sql, `SELECT attempt_id AS attemptId, purpose, provider_id AS providerId, channel, verification_mode AS mode, state, attempts, max_attempts AS maxAttempts,
        created_at AS createdAt, sent_at AS sentAt, verified_at AS verifiedAt
        FROM auth_verification_challenges WHERE user_id=? ORDER BY created_at DESC LIMIT 50`, id)
        .map(row => ({ attempt: short(row.attemptId), purpose: row.purpose, providerId: row.providerId || null, channel: row.channel || null, mode: row.mode || null, state: row.state,
          attempts: Number(row.attempts || 0), maxAttempts: Number(row.maxAttempts || 0), createdAt: num(row.createdAt), sentAt: num(row.sentAt), verifiedAt: num(row.verifiedAt) }))
    : [];
  const otpEvents = has(sql, 'auth_verification_events')
    ? rows(sql, `SELECT attempt_id AS attemptId, provider_id AS providerId, channel, outcome, reason, latency_ms AS latencyMs, occurred_at AS occurredAt
        FROM auth_verification_events WHERE user_id=? ORDER BY occurred_at DESC LIMIT 100`, id)
        .map(row => ({ attempt: short(row.attemptId), providerId: row.providerId || null, channel: row.channel || null, outcome: row.outcome, reason: row.reason, latencyMs: Number(row.latencyMs || 0), occurredAt: num(row.occurredAt) }))
    : [];

  const devices = has(sql, 'auth_trusted_devices')
    ? rows(sql, 'SELECT device_ref AS deviceRef, browser_class AS browserClass, trusted_at AS trustedAt, expires_at AS expiresAt, revoked_at AS revokedAt FROM auth_trusted_devices WHERE user_id=? ORDER BY trusted_at DESC LIMIT 50', id)
        .map(row => ({ device: short(row.deviceRef), browser: row.browserClass || null, trustedAt: num(row.trustedAt), expiresAt: num(row.expiresAt), revokedAt: num(row.revokedAt),
          active: !row.revokedAt && Number(row.expiresAt) > Number(now) }))
    : [];

  let sessions = { total: 0, active: 0, recent: [] };
  if (has(sql, 'auth_sessions')) {
    const counts = one(sql, 'SELECT COUNT(*) AS total, SUM(CASE WHEN revoked_at IS NULL AND expires_at>? THEN 1 ELSE 0 END) AS active FROM auth_sessions WHERE user_id=?', Number(now), id) || {};
    const recent = rows(sql, 'SELECT device_ref AS deviceRef, user_agent AS userAgent, created_at AS createdAt, last_seen_at AS lastSeenAt, expires_at AS expiresAt, revoked_at AS revokedAt FROM auth_sessions WHERE user_id=? ORDER BY created_at DESC LIMIT 20', id)
      .map(row => ({ device: short(row.deviceRef), browser: coarseUserAgent(row.userAgent || ''), createdAt: num(row.createdAt), lastSeenAt: num(row.lastSeenAt), expiresAt: num(row.expiresAt), revokedAt: num(row.revokedAt),
        active: !row.revokedAt && Number(row.expiresAt) > Number(now) }));
    sessions = { total: Number(counts.total || 0), active: Number(counts.active || 0), recent };
  }

  const security = has(sql, 'auth_security_events')
    ? rows(sql, 'SELECT event_type AS eventType, occurred_at AS occurredAt, purpose, device_ref AS deviceRef FROM auth_security_events WHERE user_id=? ORDER BY occurred_at DESC LIMIT 200', id)
    : [];
  const timeline = [
    { at: num(user.createdAt), kind: 'account-created', detail: null },
    ...security.map(row => ({ at: num(row.occurredAt), kind: row.eventType, detail: row.purpose || null, device: short(row.deviceRef) })),
    ...otpEvents.map(row => ({ at: row.occurredAt, kind: 'otp-' + row.outcome, detail: [row.providerId, row.reason].filter(Boolean).join(' · ') || null })),
    ...(ownership ? [{ at: num(ownership.provenAt), kind: 'email-verified-otp', detail: ownership.providerId }] : [])
  ].filter(entry => Number.isFinite(entry.at)).sort((a, b) => b.at - a.at).slice(0, 300);

  return {
    account: {
      userId: user.userId,
      publicId: publicId?.publicId || null,
      emailMask: user.emailMask || null,
      status: user.status !== 'active' ? user.status : (lifecycle?.status || 'active'),
      createdAt: num(user.createdAt),
      lastLoginAt: num(user.lastLoginAt)
    },
    profile,
    loginMethods,
    emailVerification,
    otp: { challenges: otpChallenges, events: otpEvents },
    devices,
    sessions,
    timeline
  };
}
