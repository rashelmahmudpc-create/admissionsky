import { AUTH_ERROR_CODES } from '../core/errors.mjs';
import { constantTimeEqual } from '../core/crypto.mjs';
import { transitionAccount, isSessionUsable } from '../core/account-lifecycle.mjs';

const DAY_MS = 24 * 60 * 60 * 1000;
const EVENT_RETENTION_MS = 90 * DAY_MS;

// Calendar year from a stored timestamp (ms epoch, s epoch, or YYYYMMDD
// compact date). The old raw-slice produced fake "1789"-style years.
function joinedYearOf(ts) {
  const t = Number(ts);
  if (!Number.isFinite(t) || t <= 0) return null;
  if (t >= 10000000 && t <= 99999999) return Math.floor(t / 10000); // YYYYMMDD
  const ms = t < 1e12 ? t * 1000 : t;
  const y = new Date(ms).getFullYear();
  return y >= 1990 && y <= 2100 ? y : null;
}

export class SqliteAuthRepository {
  constructor(storage) {
    if (!storage?.sql || typeof storage.sql.exec !== 'function') throw new TypeError('SQLite Durable Object storage is required.');
    this.storage = storage;
    this.sql = storage.sql;
  }

  migrate() {
    const statements = [
      `CREATE TABLE IF NOT EXISTS auth_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS auth_users (
        user_id TEXT PRIMARY KEY,
        email_ref TEXT NOT NULL UNIQUE,
        email_mask TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('active','disabled','suspended')),
        created_at INTEGER NOT NULL,
        last_login_at INTEGER NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS auth_profiles (
        user_id TEXT PRIMARY KEY,
        profile_version INTEGER NOT NULL,
        full_name TEXT NOT NULL,
        date_of_birth TEXT NOT NULL,
        school_id TEXT NOT NULL,
        school_name TEXT NOT NULL,
        school_district TEXT NOT NULL,
        higher_id TEXT,
        higher_name TEXT,
        higher_district TEXT,
        admission_session TEXT NOT NULL DEFAULT '',
        academic_goal TEXT NOT NULL DEFAULT '',
        subjects TEXT NOT NULL DEFAULT '[]',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY(user_id) REFERENCES auth_users(user_id)
      )`,
      `CREATE INDEX IF NOT EXISTS auth_profiles_updated ON auth_profiles(updated_at DESC)`,
      `CREATE TABLE IF NOT EXISTS auth_external_identities (
        provider TEXT NOT NULL,
        subject_ref TEXT NOT NULL,
        user_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        last_verified_at INTEGER NOT NULL,
        PRIMARY KEY(provider, subject_ref),
        UNIQUE(provider, user_id),
        FOREIGN KEY(user_id) REFERENCES auth_users(user_id)
      )`,
      `CREATE INDEX IF NOT EXISTS auth_external_user ON auth_external_identities(user_id)`,
      // Standalone OTP identity was retired; backup challenges live only in the
      // Firebase-session-bound verification repository.
      `DROP TABLE IF EXISTS auth_challenges`,
      `CREATE TABLE IF NOT EXISTS auth_sessions (
        session_ref TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        last_seen_at INTEGER NOT NULL,
        revoked_at INTEGER,
        ip_ref TEXT NOT NULL,
        device_ref TEXT NOT NULL,
        user_agent TEXT NOT NULL,
        FOREIGN KEY(user_id) REFERENCES auth_users(user_id)
      )`,
      `CREATE INDEX IF NOT EXISTS auth_sessions_user ON auth_sessions(user_id, created_at DESC)`,
      `CREATE INDEX IF NOT EXISTS auth_sessions_expiry ON auth_sessions(expires_at)`,
      `CREATE TABLE IF NOT EXISTS auth_account_verification_tickets (
        ticket_ref TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        subject_ref TEXT NOT NULL,
        email_ref TEXT NOT NULL,
        refresh_cipher TEXT NOT NULL,
        state TEXT NOT NULL CHECK(state IN ('active','consumed','expired','superseded')),
        purpose TEXT,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        consumed_at INTEGER,
        ip_ref TEXT NOT NULL,
        device_ref TEXT NOT NULL,
        FOREIGN KEY(user_id) REFERENCES auth_users(user_id)
      )`,
      `CREATE INDEX IF NOT EXISTS auth_account_verification_ticket_expiry ON auth_account_verification_tickets(expires_at)`,
      `CREATE INDEX IF NOT EXISTS auth_account_verification_ticket_user ON auth_account_verification_tickets(user_id,state,created_at DESC)`,
      `CREATE TABLE IF NOT EXISTS auth_rate_limits (
        scope TEXT NOT NULL,
        bucket_key TEXT NOT NULL,
        window_start INTEGER NOT NULL,
        window_ms INTEGER NOT NULL,
        count INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        PRIMARY KEY(scope, bucket_key, window_start)
      )`,
      `CREATE INDEX IF NOT EXISTS auth_rate_expiry ON auth_rate_limits(expires_at)`,
      `CREATE TABLE IF NOT EXISTS auth_passkey_user_handles (
        user_id TEXT PRIMARY KEY,
        user_handle TEXT NOT NULL UNIQUE,
        created_at INTEGER NOT NULL,
        FOREIGN KEY(user_id) REFERENCES auth_users(user_id)
      )`,
      `CREATE TABLE IF NOT EXISTS auth_passkey_credentials (
        credential_id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        subject_ref TEXT NOT NULL,
        user_handle TEXT NOT NULL,
        public_key_jwk TEXT NOT NULL,
        sign_count INTEGER NOT NULL DEFAULT 0,
        transports TEXT NOT NULL,
        backup_eligible INTEGER NOT NULL DEFAULT 0,
        backup_state INTEGER NOT NULL DEFAULT 0,
        refresh_cipher TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('active','revoked')),
        created_at INTEGER NOT NULL,
        last_used_at INTEGER,
        revoked_at INTEGER,
        FOREIGN KEY(user_id) REFERENCES auth_users(user_id)
      )`,
      `CREATE INDEX IF NOT EXISTS auth_passkey_user ON auth_passkey_credentials(user_id,status,created_at DESC)`,
      `CREATE TABLE IF NOT EXISTS auth_passkey_challenges (
        challenge_id TEXT PRIMARY KEY,
        challenge_mac TEXT NOT NULL,
        kind TEXT NOT NULL CHECK(kind IN ('registration','authentication')),
        user_id TEXT,
        subject_ref TEXT,
        user_handle TEXT,
        refresh_cipher TEXT,
        state TEXT NOT NULL CHECK(state IN ('active','consumed','expired','superseded')),
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        consumed_at INTEGER,
        ip_ref TEXT NOT NULL,
        device_ref TEXT NOT NULL,
        FOREIGN KEY(user_id) REFERENCES auth_users(user_id)
      )`,
      `CREATE INDEX IF NOT EXISTS auth_passkey_challenge_expiry ON auth_passkey_challenges(expires_at)`,
      `CREATE INDEX IF NOT EXISTS auth_passkey_challenge_device ON auth_passkey_challenges(device_ref,kind,created_at DESC)`,
      `CREATE TABLE IF NOT EXISTS auth_passkey_tickets (
        ticket_ref TEXT PRIMARY KEY,
        credential_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        subject_ref TEXT NOT NULL,
        device_ref TEXT NOT NULL,
        state TEXT NOT NULL CHECK(state IN ('active','consumed','expired')),
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        consumed_at INTEGER,
        FOREIGN KEY(credential_id) REFERENCES auth_passkey_credentials(credential_id),
        FOREIGN KEY(user_id) REFERENCES auth_users(user_id)
      )`,
      `CREATE INDEX IF NOT EXISTS auth_passkey_ticket_expiry ON auth_passkey_tickets(expires_at)`,
      `CREATE TABLE IF NOT EXISTS auth_security_events (
        event_id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_type TEXT NOT NULL,
        subject_ref TEXT,
        user_id TEXT,
        occurred_at INTEGER NOT NULL,
        device_ref TEXT,
        purpose TEXT,
        policy_version TEXT
      )`,
      `CREATE INDEX IF NOT EXISTS auth_security_events_time ON auth_security_events(occurred_at DESC)`,
      // Phase 6, device trust (§5-§7). Opaque HMAC device refs only; no
      // fingerprinting, no location. A trusted device skips the new-device
      // challenge for its TTL.
      `CREATE TABLE IF NOT EXISTS auth_trusted_devices (
        user_id TEXT NOT NULL,
        device_ref TEXT NOT NULL,
        browser_class TEXT NOT NULL,
        trusted_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        revoked_at INTEGER,
        policy_version TEXT,
        PRIMARY KEY(user_id, device_ref),
        FOREIGN KEY(user_id) REFERENCES auth_users(user_id)
      )`,
      `CREATE INDEX IF NOT EXISTS auth_trusted_devices_expiry ON auth_trusted_devices(expires_at)`,
      // Phase 6, first-class security challenges (§11-§12). Purpose-bound,
      // single-use, attempt-capped, expiring. `attempt_id` links the
      // underlying verification attempt (email/Telegram material);
      // `step_up_token_mac` carries the one-time token a verified step-up
      // challenge hands to the sensitive action that consumed it.
      `CREATE TABLE IF NOT EXISTS auth_security_challenges (
        challenge_ref TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        purpose TEXT NOT NULL,
        method TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('created','sent','verified','failed','expired','cancelled')),
        attempts INTEGER NOT NULL DEFAULT 0,
        max_attempts INTEGER NOT NULL,
        attempt_id TEXT,
        device_ref TEXT NOT NULL,
        step_up_token_mac TEXT,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        verified_at INTEGER,
        consumed_at INTEGER,
        policy_version TEXT,
        FOREIGN KEY(user_id) REFERENCES auth_users(user_id)
      )`,
      `CREATE INDEX IF NOT EXISTS auth_security_challenges_user ON auth_security_challenges(user_id,purpose,status,created_at DESC)`,
      `CREATE INDEX IF NOT EXISTS auth_security_challenges_expiry ON auth_security_challenges(expires_at)`,
      // Phase 3, lifecycle overlay. Existing auth_users rows stay untouched;
      // users without a state row implicitly hold the legacy 'active' state.
      `CREATE TABLE IF NOT EXISTS auth_account_state (
        user_id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        state_version INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY(user_id) REFERENCES auth_users(user_id)
      )`,
      `CREATE INDEX IF NOT EXISTS auth_account_state_status ON auth_account_state(status)`
    ];
    for (const statement of statements) this.sql.exec(statement);
    // Phase 6, schema v6: auth_security_events gains device_ref / purpose /
    // policy_version. Brand-new databases get them from the CREATE above;
    // existing deployments are upgraded by column-presence checks. Gating on
    // actual columns (not the shared schema_version key, which the
    // verification repository also writes) keeps this idempotent and
    // order-independent across restarts.
    const eventColumns = new Set(this.#rows('PRAGMA table_info(auth_security_events)').map(row => row.name));
    if (!eventColumns.has('device_ref')) this.sql.exec('ALTER TABLE auth_security_events ADD COLUMN device_ref TEXT');
    if (!eventColumns.has('purpose')) this.sql.exec('ALTER TABLE auth_security_events ADD COLUMN purpose TEXT');
    if (!eventColumns.has('policy_version')) this.sql.exec('ALTER TABLE auth_security_events ADD COLUMN policy_version TEXT');
    // Phase 6, challenge purpose on account-verification tickets (new-device
    // challenges reuse the existing ticket flow; NULL = legacy verification).
    const ticketColumns = new Set(this.#rows('PRAGMA table_info(auth_account_verification_tickets)').map(row => row.name));
    if (!ticketColumns.has('purpose')) this.sql.exec('ALTER TABLE auth_account_verification_tickets ADD COLUMN purpose TEXT');
    // Phase 7, schema v7: profile personalization fields (blueprint §2, §3,
    // §12, §14, §21). Additive only, the protected Phase 3 core columns and
    // write path (setAccountState & friends) are untouched.
    const profileColumns = new Set(this.#rows('PRAGMA table_info(auth_profiles)').map(row => row.name));
    if (!profileColumns.has('mobile')) this.sql.exec('ALTER TABLE auth_profiles ADD COLUMN mobile TEXT');
    if (!profileColumns.has('bio')) this.sql.exec('ALTER TABLE auth_profiles ADD COLUMN bio TEXT');
    if (!profileColumns.has('targets')) this.sql.exec("ALTER TABLE auth_profiles ADD COLUMN targets TEXT DEFAULT '[]'");
    if (!profileColumns.has('visibility')) this.sql.exec("ALTER TABLE auth_profiles ADD COLUMN visibility TEXT NOT NULL DEFAULT 'private'");
    if (!profileColumns.has('admission_session')) this.sql.exec("ALTER TABLE auth_profiles ADD COLUMN admission_session TEXT NOT NULL DEFAULT ''");
    if (!profileColumns.has('academic_goal')) this.sql.exec("ALTER TABLE auth_profiles ADD COLUMN academic_goal TEXT NOT NULL DEFAULT ''");
    if (!profileColumns.has('subjects')) this.sql.exec("ALTER TABLE auth_profiles ADD COLUMN subjects TEXT NOT NULL DEFAULT '[]'");
    this.sql.exec(
      `CREATE TABLE IF NOT EXISTS auth_public_identities (
        user_id TEXT PRIMARY KEY,
        public_id TEXT NOT NULL UNIQUE,
        created_at INTEGER NOT NULL,
        FOREIGN KEY(user_id) REFERENCES auth_users(user_id)
      )`
    );
    this.sql.exec("INSERT INTO auth_meta(key,value) VALUES('schema_version','7') ON CONFLICT(key) DO UPDATE SET value=excluded.value");
  }

  // Phase 6, device trust lifecycle (§5-§7). Refs are opaque HMAC values;
  // nothing here stores raw device ids, IPs or user agents.
  #storeTrustedDevice({ userId, deviceRef, browserClass, now, ttlMs, policyVersion, maxDevices }) {
    const browser = String(browserClass || '').slice(0, 40) || 'unknown';
    const expiresAt = now + Number(ttlMs);
    const active = this.#rows(
      'SELECT device_ref AS deviceRef FROM auth_trusted_devices WHERE user_id=? AND revoked_at IS NULL AND expires_at>? ORDER BY trusted_at ASC, device_ref ASC',
      userId, now
    );
    const max = Math.max(1, Number(maxDevices) || 10);
    if (active.length >= max) {
      const overflow = active.slice(0, active.length - max + 1);
      for (const row of overflow) {
        this.sql.exec('UPDATE auth_trusted_devices SET revoked_at=? WHERE user_id=? AND device_ref=? AND revoked_at IS NULL', now, userId, row.deviceRef);
      }
      this.#event('device-trust-evicted', null, userId, now, { policyVersion });
    }
    this.sql.exec(
      `INSERT INTO auth_trusted_devices(user_id,device_ref,browser_class,trusted_at,expires_at,revoked_at,policy_version)
       VALUES(?,?,?,?,?,NULL,?)
       ON CONFLICT(user_id,device_ref) DO UPDATE SET
         browser_class=excluded.browser_class, trusted_at=excluded.trusted_at, expires_at=excluded.expires_at,
         revoked_at=NULL, policy_version=excluded.policy_version`,
      userId, deviceRef, browser, now, expiresAt, policyVersion || null
    );
    this.#event('device-trusted', null, userId, now, { deviceRef, policyVersion });
    return expiresAt;
  }

  async isDeviceTrusted({ userId, deviceRef, now }) {
    const row = this.#one(
      'SELECT 1 AS ok FROM auth_trusted_devices WHERE user_id=? AND device_ref=? AND revoked_at IS NULL AND expires_at>?',
      userId, deviceRef, now
    );
    return Object.freeze({ trusted: Boolean(row) });
  }

  async registerTrustedDevice({ userId, deviceRef, browserClass, now, ttlMs, policyVersion, maxDevices }) {
    return this.#transaction(() => {
      const user = this.#one('SELECT user_id AS id FROM auth_users WHERE user_id=?', userId);
      if (!user) return { error: AUTH_ERROR_CODES.ACCOUNT_NOT_FOUND };
      if (!deviceRef || deviceRef.length > 128) return { error: AUTH_ERROR_CODES.INVALID_INPUT };
      const expiresAt = this.#storeTrustedDevice({ userId, deviceRef, browserClass, now, ttlMs, policyVersion, maxDevices });
      return Object.freeze({ registered: true, expiresAt });
    });
  }

  async revokeTrustedDevice({ userId, deviceRef, now, policyVersion }) {
    return this.#transaction(() => {
      const user = this.#one('SELECT user_id AS id FROM auth_users WHERE user_id=?', userId);
      if (!user) return { error: AUTH_ERROR_CODES.ACCOUNT_NOT_FOUND };
      const rows = deviceRef
        ? this.#rows('SELECT device_ref AS deviceRef FROM auth_trusted_devices WHERE user_id=? AND device_ref=? AND revoked_at IS NULL', userId, deviceRef)
        : this.#rows('SELECT device_ref AS deviceRef FROM auth_trusted_devices WHERE user_id=? AND revoked_at IS NULL', userId);
      if (!rows.length) return Object.freeze({ revoked: 0 });
      if (deviceRef) this.sql.exec('UPDATE auth_trusted_devices SET revoked_at=? WHERE user_id=? AND device_ref=? AND revoked_at IS NULL', now, userId, deviceRef);
      else this.sql.exec('UPDATE auth_trusted_devices SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL', now, userId);
      this.#event('device-revoked', null, userId, now, { deviceRef: deviceRef || null, policyVersion });
      return Object.freeze({ revoked: rows.length });
    });
  }

  async listTrustedDevices({ userId, now }) {
    const rows = this.#rows(
      'SELECT device_ref AS deviceRef,browser_class AS browserClass,trusted_at AS trustedAt,expires_at AS expiresAt FROM auth_trusted_devices WHERE user_id=? AND revoked_at IS NULL AND expires_at>? ORDER BY trusted_at DESC',
      userId, now
    );
    return Object.freeze(rows.map(row => Object.freeze({
      deviceRef: String(row.deviceRef),
      browserClass: String(row.browserClass || 'unknown'),
      trustedAt: Number(row.trustedAt),
      expiresAt: Number(row.expiresAt)
    })));
  }

  // Phase 6, security challenge lifecycle (§11-§12).
  createSecurityChallenge({ challengeRef, userId, purpose, method, maxAttempts, now, ttlMs, policyVersion, deviceRef }) {
    this.sql.exec(
      `INSERT INTO auth_security_challenges(
        challenge_ref,user_id,purpose,method,status,attempts,max_attempts,attempt_id,
        device_ref,step_up_token_mac,created_at,expires_at,verified_at,consumed_at,policy_version
      ) VALUES(?,?,?,?, 'created', 0,?,?,?, NULL,?,?,NULL,NULL,?)`,
      challengeRef, userId, purpose, method, maxAttempts, null, deviceRef, now, now + Number(ttlMs), policyVersion || null
    );
    this.#event('security-challenge-created', null, userId, now, { deviceRef, purpose, policyVersion });
  }

  markSecurityChallengeSent({ challengeRef, attemptId, now }) {
    this.sql.exec(
      "UPDATE auth_security_challenges SET status='sent',attempt_id=? WHERE challenge_ref=? AND status='created'",
      attemptId, challengeRef
    );
  }

  getSecurityChallenge({ challengeRef, userId, now }) {
    const row = this.#one(
      `SELECT challenge_ref AS challengeRef,user_id AS userId,purpose,method,status,attempts AS attempts,
        max_attempts AS maxAttempts,attempt_id AS attemptId,device_ref AS deviceRef,
        step_up_token_mac AS stepUpTokenMac,created_at AS createdAt,expires_at AS expiresAt,
        consumed_at AS consumedAt,policy_version AS policyVersion
       FROM auth_security_challenges WHERE challenge_ref=? AND user_id=?`,
      challengeRef, userId
    );
    if (!row) return null;
    if (row.status === 'sent' && Number(row.expiresAt) <= now) {
      this.sql.exec("UPDATE auth_security_challenges SET status='expired' WHERE challenge_ref=? AND status='sent'", challengeRef);
      row.status = 'expired';
    }
    return row;
  }

  recordSecurityChallengeAttempt({ challengeRef, now }) {
    this.sql.exec('UPDATE auth_security_challenges SET attempts=attempts+1 WHERE challenge_ref=?', challengeRef);
  }

  // Single-use, race-safe: only a still-sent challenge can be flipped to
  // verified. The flip is proven by the token MAC stored in the row, a
  // concurrent second verify sees the winner's MAC and loses.
  verifySecurityChallenge({ challengeRef, now, stepUpTokenMac }) {
    this.sql.exec(
      "UPDATE auth_security_challenges SET status='verified',verified_at=?,step_up_token_mac=? WHERE challenge_ref=? AND status='sent'",
      now, stepUpTokenMac, challengeRef
    );
    const row = this.#one('SELECT step_up_token_mac AS mac FROM auth_security_challenges WHERE challenge_ref=?', challengeRef);
    return row?.mac != null && row.mac === stepUpTokenMac;
  }

  failSecurityChallenge({ challengeRef }) {
    this.sql.exec("UPDATE auth_security_challenges SET status='failed' WHERE challenge_ref=? AND status='sent'", challengeRef);
  }

  cancelSecurityChallenge({ challengeRef }) {
    this.sql.exec("UPDATE auth_security_challenges SET status='cancelled' WHERE challenge_ref=? AND status IN ('created','sent')", challengeRef);
  }

  // Consume a verified step-up token for the sensitive action that presented
  // it (constant-time compare by the caller; this only flips once).
  consumeSecurityChallenge({ challengeRef, now }) {
    this.sql.exec(
      "UPDATE auth_security_challenges SET consumed_at=? WHERE challenge_ref=? AND status='verified' AND consumed_at IS NULL",
      now, challengeRef
    );
    const row = this.#one('SELECT consumed_at AS consumedAt FROM auth_security_challenges WHERE challenge_ref=?', challengeRef);
    return row?.consumedAt != null;
  }

  latestVerifiedStepUpChallenge({ userId, now }) {
    const row = this.#one(
      `SELECT challenge_ref AS challengeRef,step_up_token_mac AS stepUpTokenMac,device_ref AS deviceRef,
        expires_at AS expiresAt,consumed_at AS consumedAt
       FROM auth_security_challenges
       WHERE user_id=? AND purpose='step-up' AND status='verified' AND consumed_at IS NULL AND expires_at>?
       ORDER BY verified_at DESC LIMIT 1`,
      userId, now
    );
    return row || null;
  }

  listSecurityChallenges({ userId, now }) {
    const rows = this.#rows(
      `SELECT purpose,method,status,attempts AS attempts,created_at AS createdAt,expires_at AS expiresAt,
        verified_at AS verifiedAt,consumed_at AS consumedAt,policy_version AS policyVersion
       FROM auth_security_challenges WHERE user_id=? AND created_at>?
       ORDER BY created_at DESC LIMIT 50`,
      userId, now - EVENT_RETENTION_MS
    );
    return Object.freeze(rows.map(row => Object.freeze({
      purpose: String(row.purpose),
      method: String(row.method),
      status: String(row.status),
      attempts: Number(row.attempts),
      createdAt: Number(row.createdAt),
      expiresAt: Number(row.expiresAt),
      verifiedAt: row.verifiedAt == null ? null : Number(row.verifiedAt),
      consumedAt: row.consumedAt == null ? null : Number(row.consumedAt),
      policyVersion: row.policyVersion || null
    })));
  }


  // Phase 6 Chunk 4, recent login history for the privacy boundary (§27):
  // method + coarse browser class + time only. No IP, no location, no raw
  // email or raw device identifier ever leave this method.
  recentSecurityHistory({ userId, now, limit }) {
    const sessions = this.#rows(
      `SELECT s.created_at AS at,s.user_agent AS browserClass,s.revoked_at AS revokedAt,s.device_ref AS deviceRef
       FROM auth_sessions s WHERE s.user_id=?
       ORDER BY s.created_at DESC, s.rowid DESC LIMIT ?`,
      userId, Math.min(Number(limit) || 10, 50)
    );
    return Object.freeze(sessions.map(session => {
      const event = this.#one(
        `SELECT event_type AS eventType FROM auth_security_events
         WHERE user_id=? AND occurred_at=? AND (device_ref IS ? OR ? IS NULL)
           AND event_type IN ('firebase-login','firebase-account-linked','login-trusted-device','firebase-passkey-login','new-device-challenge-completed')
         ORDER BY rowid DESC LIMIT 1`,
        userId, session.at, session.deviceRef, session.deviceRef
      );
      const type = event ? String(event.eventType) : 'firebase-login';
      return Object.freeze({
        at: Number(session.at),
        method: type === 'firebase-passkey-login' ? 'passkey' : 'credentials',
        browserClass: String(session.browserClass || 'unknown'),
        trusted: type === 'login-trusted-device',
        active: session.revokedAt == null
      });
    }));
  }

  // Phase 6 Chunk 4, admin security health: event counts inside a window.
  securityEventCounts({ now, windowMs }) {
    const start = Number(now) - Number(windowMs);
    const counts = {};
    this.#rows(
      'SELECT event_type AS eventType,count(*) AS n FROM auth_security_events WHERE occurred_at>=? GROUP BY event_type',
      start
    ).forEach(row => { counts[String(row.eventType)] = Number(row.n); });
    return Object.freeze({
      failedLogins: counts['login-failed'] || 0,
      challengesCreated: counts['security-challenge-created'] || 0,
      challengesVerified: counts['security-challenge-verified'] || 0,
      challengesFailed: counts['security-challenge-failed'] || 0,
      newDeviceLogins: counts['new-device-challenge-completed'] || 0,
      devicesRevoked: counts['device-revoked'] || 0,
      sessionsRevoked: counts['account-sessions-revoked'] || 0
    });
  }

  // Phase 6 Chunk 4, paged ledger view for admins: refs only, no PII
  // (subject/user/device are opaque HMAC refs; there is no raw column here).
  listSecurityEvents({ limit, before }) {
    const rows = before
      ? this.#rows(
        `SELECT event_type AS eventType,subject_ref AS subjectRef,user_id AS userId,occurred_at AS occurredAt,
          device_ref AS deviceRef,purpose,policy_version AS policyVersion
         FROM auth_security_events WHERE occurred_at<?
         ORDER BY occurred_at DESC, rowid DESC LIMIT ?`,
        before, limit
      )
      : this.#rows(
        `SELECT event_type AS eventType,subject_ref AS subjectRef,user_id AS userId,occurred_at AS occurredAt,
          device_ref AS deviceRef,purpose,policy_version AS policyVersion
         FROM auth_security_events
         ORDER BY occurred_at DESC, rowid DESC LIMIT ?`,
        limit
      );
    return Object.freeze({ entries: rows });
  }

  // Risk signals for the login decision (§3-§4), derived from auth_rate_limits
  // state only, no new table, no raw identifiers leave the DO.
  async getLoginRiskSignals({ emailScope, emailWindowMs, ipScope, ipWindowMs, emailRef, ipRef, now }) {
    const emailStart = Math.floor(Number(now) / Number(emailWindowMs)) * Number(emailWindowMs);
    const ipStart = Math.floor(Number(now) / Number(ipWindowMs)) * Number(ipWindowMs);
    const emailRow = this.#one('SELECT count FROM auth_rate_limits WHERE scope=? AND bucket_key=? AND window_start=?', emailScope, emailRef, emailStart);
    const ipRow = this.#one('SELECT count FROM auth_rate_limits WHERE scope=? AND bucket_key=? AND window_start=?', ipScope, ipRef, ipStart);
    return Object.freeze({
      failedLogins: Number(emailRow?.count || 0),
      rapidRequests: Number(ipRow?.count || 0)
    });
  }

  // Read-only reconciliation snapshot (Phase 3). HMAC refs only, never
  // emails, tokens or raw provider subjects.
  async identitySnapshot() {
    const users = this.#rows('SELECT user_id AS id, status FROM auth_users')
      .map(row => Object.freeze({ id: row.id, status: row.status }));
    const externalIdentities = this.#rows(
      'SELECT provider, subject_ref AS subjectRef, user_id AS userId FROM auth_external_identities'
    ).map(row => Object.freeze({ provider: row.provider, subjectRef: row.subjectRef, userId: row.userId }));
    return Object.freeze({ users: Object.freeze(users), externalIdentities: Object.freeze(externalIdentities) });
  }

  // Linked identities for a user: provider + verification facts only.
  async listLinkedIdentities({ userId }) {
    const rows = this.#rows(
      'SELECT provider, last_verified_at AS lastVerifiedAt, created_at AS createdAt FROM auth_external_identities WHERE user_id=? ORDER BY provider',
      userId
    );
    return Object.freeze(rows.map(row => Object.freeze({
      provider: String(row.provider),
      linked: true,
      verified: Boolean(row.lastVerifiedAt),
      lastVerifiedAt: Number(row.lastVerifiedAt || 0),
      linkedAt: Number(row.createdAt || 0)
    })));
  }

  async getAccountState({ userId, now }) {
    const user = this.#one('SELECT user_id AS id FROM auth_users WHERE user_id=?', userId);
    if (!user) return { error: AUTH_ERROR_CODES.ACCOUNT_NOT_FOUND };
    const row = this.#one(
      'SELECT status,state_version AS version,updated_at AS updatedAt FROM auth_account_state WHERE user_id=?',
      userId
    );
    return Object.freeze({
      userId,
      status: row ? String(row.status) : 'active',
      stateVersion: Number(row?.version || 0),
      updatedAt: Number(row?.updatedAt || 0),
      now: Number(now)
    });
  }

  // Centralized, transition-validated account state change. The only write
  // path to auth_account_state; every change is audited and non-usable
  // targets revoke all live sessions for the user (blueprint §10, §32).
  async setAccountState({ userId, toStatus, now }) {
    return this.#transaction(() => {
      const user = this.#one('SELECT user_id AS id FROM auth_users WHERE user_id=?', userId);
      if (!user) return { error: AUTH_ERROR_CODES.ACCOUNT_NOT_FOUND };
      const row = this.#one(
        'SELECT status AS current,state_version AS version FROM auth_account_state WHERE user_id=?',
        userId
      );
      const currentStatus = row ? String(row.current) : 'active';
      let target;
      try {
        target = transitionAccount(currentStatus, toStatus);
      } catch {
        return { error: AUTH_ERROR_CODES.ACCOUNT_STATE_INVALID };
      }
      if (target === currentStatus) {
        return Object.freeze({ userId, status: target, stateVersion: Number(row?.version || 0), changed: false, revokedSessions: 0 });
      }
      const version = Number(row?.version || 0) + 1;
      this.sql.exec(
        `INSERT INTO auth_account_state(user_id,status,state_version,created_at,updated_at)
         VALUES(?,?,?,?,?)
         ON CONFLICT(user_id) DO UPDATE SET status=excluded.status,state_version=excluded.state_version,updated_at=excluded.updated_at`,
        userId, target, version, now, now
      );
      let revoked = 0;
      if (!isSessionUsable(target)) {
        const open = this.#one('SELECT COUNT(*) AS count FROM auth_sessions WHERE user_id=? AND revoked_at IS NULL', userId);
        this.sql.exec('UPDATE auth_sessions SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL', now, userId);
        revoked = Number(open?.count || 0);
        this.#event('account-sessions-revoked', null, userId, now);
      }
      this.#event('account-state-changed', null, userId, now);
      return Object.freeze({ userId, status: target, stateVersion: version, changed: true, revokedSessions: revoked });
    });
  }

  #rows(statement, ...bindings) {
    return Array.from(this.sql.exec(statement, ...bindings));
  }

  #one(statement, ...bindings) {
    return this.#rows(statement, ...bindings)[0] || null;
  }

  #transaction(work) {
    if (typeof this.storage.transactionSync === 'function') return this.storage.transactionSync(work);
    return work();
  }

  #consumeLimits(limits, now) {
    let denied = null;
    for (const limit of limits || []) {
      const start = Math.floor(now / limit.windowMs) * limit.windowMs;
      const expiresAt = start + limit.windowMs;
      this.sql.exec(
        `INSERT INTO auth_rate_limits(scope,bucket_key,window_start,window_ms,count,expires_at)
         VALUES(?,?,?,?,1,?)
         ON CONFLICT(scope,bucket_key,window_start) DO UPDATE SET count=count+1`,
        limit.scope, limit.key, start, limit.windowMs, expiresAt
      );
      const row = this.#one(
        'SELECT count,expires_at AS expiresAt FROM auth_rate_limits WHERE scope=? AND bucket_key=? AND window_start=?',
        limit.scope, limit.key, start
      );
      if (Number(row?.count || 0) > limit.limit) {
        const retryAfter = Math.max(1, Math.ceil((Number(row.expiresAt) - now) / 1000));
        if (!denied || retryAfter > denied.retryAfter) denied = { error: AUTH_ERROR_CODES.RATE_LIMITED, retryAfter };
      }
    }
    return denied;
  }

  #event(eventType, subjectRef, userId, now, extras = {}) {
    this.sql.exec(
      'INSERT INTO auth_security_events(event_type,subject_ref,user_id,occurred_at,device_ref,purpose,policy_version) VALUES(?,?,?,?,?,?,?)',
      String(eventType).slice(0, 48), subjectRef || null, userId || null, now,
      extras.deviceRef || null, extras.purpose || null, extras.policyVersion || null
    );
  }

  // Public audit hook for security decisions that originate in the engine
  // (challenge lifecycle, step-up enforcement, trust changes).
  recordSecurityEvent({ eventType, subjectRef, userId, now, deviceRef, purpose, policyVersion }) {
    this.#event(eventType, subjectRef || null, userId || null, now, {
      deviceRef: deviceRef || null,
      purpose: purpose || null,
      policyVersion: policyVersion || null
    });
  }

  #parseTargets(raw) {
    try {
      const value = JSON.parse(String(raw || '[]'));
      return Array.isArray(value) ? value : [];
    } catch {
      return [];
    }
  }

  #parseSubjects(raw) {
    try {
      const value = JSON.parse(String(raw || '[]'));
      if (!Array.isArray(value)) return [];
      return value.filter((x) => typeof x === 'string' && x.length > 0).slice(0, 8);
    } catch {
      return [];
    }
  }

  #profileForUser(userId) {
    const row = this.#one(
      `SELECT profile_version AS version,full_name AS fullName,date_of_birth AS dob,
        school_id AS schoolId,school_name AS schoolName,school_district AS schoolDistrict,
        higher_id AS higherId,higher_name AS higherName,higher_district AS higherDistrict,
        mobile AS mobile,bio AS bio,targets AS targets,visibility AS visibility,
        admission_session AS admissionSession,academic_goal AS academicGoal,subjects AS subjectsRaw,
        created_at AS createdAt,updated_at AS updatedAt
       FROM auth_profiles WHERE user_id=?`,
      userId
    );
    if (!row) return null;
    const visibility = ['private', 'limited', 'public'].includes(row.visibility) ? row.visibility : 'private';
    return {
      version: Number(row.version || 1),
      fullName: row.fullName,
      dob: row.dob,
      school: { id: row.schoolId, name: row.schoolName, district: row.schoolDistrict || '' },
      // Presence is the NAME (patch-created institutions carry no id).
      higherInstitution: row.higherName ? { id: row.higherId || '', name: row.higherName, district: row.higherDistrict || '' } : null,
      mobile: row.mobile || '',
      bio: row.bio || '',
      targets: this.#parseTargets(row.targets),
      admissionSession: row.admissionSession || '',
      academicGoal: row.academicGoal || '',
      subjects: this.#parseSubjects(row.subjectsRaw),
      visibility,
      createdAt: Number(row.createdAt),
      updatedAt: Number(row.updatedAt)
    };
  }

  #writeProfile(userId, profile, now) {
    const higher = profile.higherInstitution || null;
    const targets = JSON.stringify(Array.isArray(profile.targets) ? profile.targets : []);
    const subjects = JSON.stringify(Array.isArray(profile.subjects) ? profile.subjects : []);
    const visibility = ['private', 'limited', 'public'].includes(profile.visibility) ? profile.visibility : 'private';
    this.sql.exec(
      `INSERT INTO auth_profiles(
        user_id,profile_version,full_name,date_of_birth,school_id,school_name,school_district,
        higher_id,higher_name,higher_district,mobile,bio,targets,visibility,
        admission_session,academic_goal,subjects,created_at,updated_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(user_id) DO UPDATE SET
        profile_version=excluded.profile_version,full_name=excluded.full_name,date_of_birth=excluded.date_of_birth,
        school_id=excluded.school_id,school_name=excluded.school_name,school_district=excluded.school_district,
        higher_id=excluded.higher_id,higher_name=excluded.higher_name,higher_district=excluded.higher_district,
        mobile=excluded.mobile,bio=excluded.bio,targets=excluded.targets,visibility=excluded.visibility,
        admission_session=excluded.admission_session,academic_goal=excluded.academic_goal,subjects=excluded.subjects,
        updated_at=excluded.updated_at`,
      userId, Number(profile.version || 1), profile.fullName || '', profile.dob || '',
      profile.school?.id || '', profile.school?.name || '', profile.school?.district || '',
      // Preserve institutions that have a name but no id (patch path);
      // a bare `id || null` silently dropped them (owner data loss).
      higher ? (higher.id || '') : null, higher ? (higher.name || '') : null, higher ? (higher.district || '') : null,
      profile.mobile || '', profile.bio || '', targets, visibility,
      profile.admissionSession || '', profile.academicGoal || '', subjects, now, now
    );
    return this.#profileForUser(userId);
  }

  #canonicalSession({ sessionRef, subjectRef, emailRef, now }) {
    const row = this.#one(
      `SELECT u.user_id AS id,u.email_ref AS emailRef,u.email_mask AS emailMask,u.status,
        u.created_at AS createdAt,s.expires_at AS expiresAt
       FROM auth_sessions s
       JOIN auth_users u ON u.user_id=s.user_id
       JOIN auth_external_identities x ON x.user_id=u.user_id AND x.provider='firebase' AND x.subject_ref=?
       WHERE s.session_ref=? AND s.revoked_at IS NULL AND s.expires_at>? AND u.email_ref=?`,
      subjectRef, sessionRef, now, emailRef
    );
    if (!row) return { error: AUTH_ERROR_CODES.SESSION_INVALID };
    if (row.status !== 'active') return { error: AUTH_ERROR_CODES.ACCOUNT_DISABLED };
    return { user: row };
  }

  #passkeyChallenge({ challengeId, candidateChallengeMac, deviceRef, kind, now }) {
    const row = this.#one(
      `SELECT challenge_id AS challengeId,challenge_mac AS challengeMac,kind,user_id AS userId,
        subject_ref AS subjectRef,user_handle AS userHandle,refresh_cipher AS refreshCipher,
        state,created_at AS createdAt,expires_at AS expiresAt,device_ref AS deviceRef
       FROM auth_passkey_challenges WHERE challenge_id=?`,
      challengeId
    );
    if (!row || row.kind !== kind || row.deviceRef !== deviceRef || !constantTimeEqual(row.challengeMac, candidateChallengeMac)) {
      return { error: AUTH_ERROR_CODES.PASSKEY_INVALID };
    }
    if (row.state !== 'active') return { error: AUTH_ERROR_CODES.PASSKEY_INVALID };
    if (Number(row.expiresAt) <= now) {
      this.sql.exec("UPDATE auth_passkey_challenges SET state='expired',challenge_mac='',refresh_cipher=NULL WHERE challenge_id=?", challengeId);
      return { error: AUTH_ERROR_CODES.PASSKEY_INVALID };
    }
    return { challenge: row };
  }

  async consumeLimits({ limits, now, eventType, subjectRef }) {
    return this.#transaction(() => {
      const denied = this.#consumeLimits(limits, now);
      if (denied) return denied;
      this.#event(eventType, subjectRef, null, now);
      return { accepted: true };
    });
  }

  async establishExternalSession(input) {
    return this.#transaction(() => {
      const identity = this.#one(
        `SELECT user_id AS userId FROM auth_external_identities
         WHERE provider=? AND subject_ref=?`,
        input.provider, input.subjectRef
      );
      let user = identity ? this.#one(
        `SELECT user_id AS id,email_ref AS emailRef,email_mask AS emailMask,status,created_at AS createdAt
         FROM auth_users WHERE user_id=?`,
        identity.userId
      ) : this.#one(
        `SELECT user_id AS id,email_ref AS emailRef,email_mask AS emailMask,status,created_at AS createdAt
         FROM auth_users WHERE email_ref=?`,
        input.emailRef
      );
      if (identity && !user) return { error: AUTH_ERROR_CODES.STORAGE_UNAVAILABLE };
      if (!identity && user) {
        const existingForUser = this.#one(
          'SELECT subject_ref AS subjectRef FROM auth_external_identities WHERE provider=? AND user_id=?',
          input.provider, user.id
        );
        if (existingForUser && existingForUser.subjectRef !== input.subjectRef) {
          this.#event('firebase-identity-conflict', input.subjectRef, user.id, input.now);
          return { error: AUTH_ERROR_CODES.ACCOUNT_CONFLICT };
        }
      }
      let created = false;
      if (!user) {
        this.sql.exec(
          `INSERT OR IGNORE INTO auth_users(user_id,email_ref,email_mask,status,created_at,last_login_at)
           VALUES(?,?,?,'active',?,?)`,
          input.userIdCandidate, input.emailRef, input.emailMask, input.now, input.now
        );
        user = this.#one(
          `SELECT user_id AS id,email_ref AS emailRef,email_mask AS emailMask,status,created_at AS createdAt
           FROM auth_users WHERE email_ref=?`,
          input.emailRef
        );
        created = user?.id === input.userIdCandidate;
      }
      if (!user) return { error: AUTH_ERROR_CODES.STORAGE_UNAVAILABLE };
      if (user.status !== 'active') return { error: AUTH_ERROR_CODES.ACCOUNT_DISABLED };
      if (identity && user.emailRef !== input.emailRef) {
        const emailOwner = this.#one('SELECT user_id AS id FROM auth_users WHERE email_ref=?', input.emailRef);
        if (emailOwner && emailOwner.id !== user.id) return { error: AUTH_ERROR_CODES.ACCOUNT_CONFLICT };
        this.sql.exec('UPDATE auth_users SET email_ref=?,email_mask=? WHERE user_id=?', input.emailRef, input.emailMask, user.id);
        user.emailRef = input.emailRef;
        user.emailMask = input.emailMask;
      }
      if (!identity) {
        this.sql.exec(
          `INSERT INTO auth_external_identities(provider,subject_ref,user_id,created_at,last_verified_at)
           VALUES(?,?,?,?,?)`,
          input.provider, input.subjectRef, user.id, input.now, input.now
        );
      } else {
        this.sql.exec(
          'UPDATE auth_external_identities SET last_verified_at=? WHERE provider=? AND subject_ref=?',
          input.now, input.provider, input.subjectRef
        );
      }
      this.sql.exec('UPDATE auth_users SET last_login_at=? WHERE user_id=?', input.now, user.id);
      this.sql.exec(
        `INSERT INTO auth_sessions(
          session_ref,user_id,created_at,expires_at,last_seen_at,revoked_at,ip_ref,device_ref,user_agent
        ) VALUES(?,?,?,?,?,NULL,?,?,?)`,
        input.sessionRef, user.id, input.now, input.sessionExpiresAt, input.now,
        input.ipRef, input.deviceRef, input.userAgent
      );
      this.#event(
        input.loginEvent || (created ? 'firebase-account-linked' : 'firebase-login'),
        input.subjectRef, user.id, input.now,
        input.eventExtras || {}
      );
      return { established: true, created, user };
    });
  }

  async getExternalSession({ sessionRef, provider, subjectRef, emailRef, now, trackRefresh = false }) {
    return this.#transaction(() => {
      const row = this.#one(
        `SELECT s.expires_at AS expiresAt,s.last_seen_at AS lastSeenAt,
          u.user_id AS id,u.email_mask AS emailMask,u.status,u.created_at AS createdAt
         FROM auth_sessions s
         JOIN auth_users u ON u.user_id=s.user_id
         JOIN auth_external_identities x ON x.user_id=u.user_id AND x.provider=? AND x.subject_ref=?
         WHERE s.session_ref=? AND s.revoked_at IS NULL AND u.email_ref=?`,
        provider, subjectRef, sessionRef, emailRef
      );
      if (!row || Number(row.expiresAt) <= now) return { error: AUTH_ERROR_CODES.SESSION_INVALID };
      if (row.status !== 'active') return { error: AUTH_ERROR_CODES.ACCOUNT_DISABLED };
      if (now - Number(row.lastSeenAt) > 6 * 60 * 60 * 1000) {
        this.sql.exec('UPDATE auth_sessions SET last_seen_at=? WHERE session_ref=?', now, sessionRef);
      }
      if (trackRefresh) this.#event('session-refreshed', subjectRef, row.id, now);
      return {
        expiresAt: Number(row.expiresAt),
        user: { id: row.id, emailMask: row.emailMask, status: row.status, createdAt: Number(row.createdAt) }
      };
    });
  }

  async beginFirebaseAccountVerification(input) {
    return this.#transaction(() => {
      const denied = this.#consumeLimits(input.limits, input.now);
      if (denied) return denied;
      const identity = this.#one(
        "SELECT user_id AS userId FROM auth_external_identities WHERE provider='firebase' AND subject_ref=?",
        input.subjectRef
      );
      let user = identity ? this.#one(
        'SELECT user_id AS id,email_ref AS emailRef,email_mask AS emailMask,status,created_at AS createdAt FROM auth_users WHERE user_id=?',
        identity.userId
      ) : this.#one(
        'SELECT user_id AS id,email_ref AS emailRef,email_mask AS emailMask,status,created_at AS createdAt FROM auth_users WHERE email_ref=?',
        input.emailRef
      );
      if (identity && !user) return { error: AUTH_ERROR_CODES.STORAGE_UNAVAILABLE };
      if (!identity && user) {
        const existing = this.#one(
          "SELECT subject_ref AS subjectRef FROM auth_external_identities WHERE provider='firebase' AND user_id=?",
          user.id
        );
        if (existing && existing.subjectRef !== input.subjectRef) return { error: AUTH_ERROR_CODES.ACCOUNT_CONFLICT };
      }
      if (!user) {
        this.sql.exec(
          `INSERT OR IGNORE INTO auth_users(user_id,email_ref,email_mask,status,created_at,last_login_at)
           VALUES(?,?,?,'active',?,?)`,
          input.userIdCandidate, input.emailRef, input.emailMask, input.now, input.now
        );
        user = this.#one(
          'SELECT user_id AS id,email_ref AS emailRef,email_mask AS emailMask,status,created_at AS createdAt FROM auth_users WHERE email_ref=?',
          input.emailRef
        );
      }
      if (!user) return { error: AUTH_ERROR_CODES.STORAGE_UNAVAILABLE };
      if (user.status !== 'active') return { error: AUTH_ERROR_CODES.ACCOUNT_DISABLED };
      if (user.emailRef !== input.emailRef) return { error: AUTH_ERROR_CODES.ACCOUNT_CONFLICT };
      if (!identity) {
        this.sql.exec(
          `INSERT INTO auth_external_identities(provider,subject_ref,user_id,created_at,last_verified_at)
           VALUES('firebase',?,?,?,?)`,
          input.subjectRef, user.id, input.now, input.now
        );
      }
      this.sql.exec(
        `UPDATE auth_account_verification_tickets
         SET state='superseded',refresh_cipher=''
         WHERE user_id=? AND state='active'`,
        user.id
      );
      this.sql.exec(
        `INSERT INTO auth_account_verification_tickets(
          ticket_ref,user_id,subject_ref,email_ref,refresh_cipher,state,purpose,created_at,expires_at,
          consumed_at,ip_ref,device_ref
        ) VALUES(?,?,?,?,?,'active',?,?,?,NULL,?,?)`,
        input.ticketRef, user.id, input.subjectRef, input.emailRef, input.refreshCipher,
        input.purpose || null, input.now, input.expiresAt, input.ipRef, input.deviceRef
      );
      this.#event('firebase-account-verification-started', input.subjectRef, user.id, input.now);
      return { prepared: true, user };
    });
  }

  async getFirebaseAccountVerification(input) {
    return this.#transaction(() => {
      const row = this.#one(
        `SELECT t.user_id AS userId,t.subject_ref AS subjectRef,t.email_ref AS emailRef,
          t.refresh_cipher AS refreshCipher,t.state,t.expires_at AS expiresAt,
          u.email_mask AS emailMask,u.status,u.created_at AS createdAt
         FROM auth_account_verification_tickets t
         JOIN auth_users u ON u.user_id=t.user_id
         WHERE t.ticket_ref=? AND t.device_ref=?`,
        input.ticketRef, input.deviceRef
      );
      if (!row || row.state !== 'active') return { error: AUTH_ERROR_CODES.TELEGRAM_VERIFICATION_INVALID };
      if (Number(row.expiresAt) <= input.now) {
        this.sql.exec("UPDATE auth_account_verification_tickets SET state='expired',refresh_cipher='' WHERE ticket_ref=?", input.ticketRef);
        return { error: AUTH_ERROR_CODES.TELEGRAM_VERIFICATION_INVALID };
      }
      if (row.status !== 'active') return { error: AUTH_ERROR_CODES.ACCOUNT_DISABLED };
      return row;
    });
  }

  async completeFirebaseAccountVerification(input) {
    return this.#transaction(() => {
      const row = this.#one(
        `SELECT t.user_id AS userId,t.subject_ref AS subjectRef,t.email_ref AS emailRef,
          t.state,t.purpose AS purpose,t.expires_at AS expiresAt,u.email_mask AS emailMask,u.status,u.created_at AS createdAt
         FROM auth_account_verification_tickets t JOIN auth_users u ON u.user_id=t.user_id
         WHERE t.ticket_ref=? AND t.device_ref=?`,
        input.ticketRef, input.deviceRef
      );
      if (!row || row.state !== 'active' || Number(row.expiresAt) <= input.now
        || row.subjectRef !== input.subjectRef || row.emailRef !== input.emailRef) {
        return { error: AUTH_ERROR_CODES.TELEGRAM_VERIFICATION_INVALID };
      }
      if (row.status !== 'active') return { error: AUTH_ERROR_CODES.ACCOUNT_DISABLED };
      this.sql.exec(
        "UPDATE auth_account_verification_tickets SET state='consumed',refresh_cipher='',consumed_at=? WHERE ticket_ref=? AND state='active'",
        input.now, input.ticketRef
      );
      this.sql.exec(
        `INSERT INTO auth_sessions(
          session_ref,user_id,created_at,expires_at,last_seen_at,revoked_at,ip_ref,device_ref,user_agent
        ) VALUES(?,?,?,?,?,NULL,?,?,?)`,
        input.sessionRef, row.userId, input.now, input.sessionExpiresAt, input.now,
        input.ipRef, input.deviceRef, input.userAgent
      );
      this.sql.exec('UPDATE auth_users SET last_login_at=? WHERE user_id=?', input.now, row.userId);
      // Phase 6, completing a new-device challenge is the consent moment:
      // the device that verified earns 30-day trust (config-driven TTL).
      let trusted = false;
      // 2026-10-18: the first (signup) verification is also a consent moment;
      // without this the very device that verified kept getting OTP prompts.
      if (input.trust && Number(input.trust.ttlMs) > 0) {
        this.#storeTrustedDevice({
          userId: row.userId,
          deviceRef: input.deviceRef,
          browserClass: input.userAgent,
          now: input.now,
          ttlMs: input.trust.ttlMs,
          policyVersion: input.trust.policyVersion,
          maxDevices: input.trust.maxDevices
        });
        trusted = true;
      }
      this.#event(
        row.purpose === 'new-device' ? 'new-device-challenge-completed' : 'firebase-telegram-verification-session',
        input.subjectRef, row.userId, input.now,
        row.purpose ? { deviceRef: input.deviceRef, purpose: row.purpose, policyVersion: input.trust?.policyVersion } : {}
      );
      return {
        established: true,
        trusted,
        user: { id: row.userId, emailRef: row.emailRef, emailMask: row.emailMask, status: row.status, createdAt: Number(row.createdAt) }
      };
    });
  }

  async getFirebaseIdentity(input) {
    const row = this.#one(
      `SELECT u.user_id AS id,u.email_ref AS emailRef,u.email_mask AS emailMask,u.status,u.created_at AS createdAt
       FROM auth_external_identities x JOIN auth_users u ON u.user_id=x.user_id
       WHERE x.provider='firebase' AND x.subject_ref=? AND u.email_ref=?`,
      input.subjectRef, input.emailRef
    );
    if (!row) return { error: AUTH_ERROR_CODES.SESSION_INVALID };
    if (row.status !== 'active') return { error: AUTH_ERROR_CODES.ACCOUNT_DISABLED };
    return { user: row };
  }

  // Greeting personalisation for the ownership OTP. The pending profile written
  // during signup already holds the name, so the server resolves it against the
  // ticket instead of trusting a client-supplied value.
  async getFirebaseVerificationRecipientName(input) {
    const row = this.#one(
      `SELECT p.full_name AS fullName
       FROM auth_account_verification_tickets t
       JOIN auth_profiles p ON p.user_id=t.user_id
       WHERE t.ticket_ref=? AND t.device_ref=? AND t.state='active' AND t.expires_at>?`,
      input.ticketRef, input.deviceRef, input.now
    );
    return { fullName: String(row?.fullName || '') };
  }

  async savePendingProfile(input) {
    return this.#transaction(() => {
      const row = this.#one(
        `SELECT t.user_id AS userId,t.state,t.expires_at AS expiresAt,u.status
         FROM auth_account_verification_tickets t JOIN auth_users u ON u.user_id=t.user_id
         WHERE t.ticket_ref=? AND t.device_ref=?`,
        input.ticketRef, input.deviceRef
      );
      if (!row || row.state !== 'active' || Number(row.expiresAt) <= input.now) return { error: AUTH_ERROR_CODES.TELEGRAM_VERIFICATION_INVALID };
      if (row.status !== 'active') return { error: AUTH_ERROR_CODES.ACCOUNT_DISABLED };
      const profile = this.#writeProfile(row.userId, input.profile, input.now);
      this.#event('onboarding-profile-saved', null, row.userId, input.now);
      return { saved: true, profile };
    });
  }

  async saveProfile(input) {
    return this.#transaction(() => {
      const session = this.#canonicalSession(input);
      if (session.error) return session;
      const profile = this.#writeProfile(session.user.id, input.profile, input.now);
      this.#event('account-profile-updated', input.subjectRef, session.user.id, input.now);
      return { saved: true, profile };
    });
  }

  async getProfile(input) {
    const session = this.#canonicalSession(input);
    if (session.error) return session;
    return { profile: this.#profileForUser(session.user.id) };
  }

  // ---------------------------------------------------------------------
  // Phase 7, Profile & Personal Identity (blueprint §3-§4, §14, §21, §25)
  // Profile is a consumer of the protected Identity Core: everything below
  // derives the user from the verified session and never rewrites
  // identity/auth fields.
  // ---------------------------------------------------------------------

  // Deterministic, permanent, non-sensitive public display ID (blueprint §14).
  // 31-char alphabet (no ambiguous 0/O/1/I/L glyphs); 6 digits ≈ 887M
  // combinations. Rare deterministic collisions retry with a salt.
  static PUBLIC_ID_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

  async #derivePublicId(userId, attempt = 0) {
    const { crypto } = globalThis;
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`ah-public-id-v1|${userId}|${attempt}`));
    const bytes = new Uint8Array(digest).subarray(0, 4);
    const alphabet = SqliteAuthRepository.PUBLIC_ID_ALPHABET;
    let value = ((bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]) >>> 0;
    let out = '';
    for (let i = 0; i < 6; i += 1) {
      out += alphabet[value % 31];
      value = Math.floor(value / 31);
    }
    return `AH-${out}`;
  }

  async #ensurePublicIdentity(userId, now) {
    const existing = this.#one('SELECT public_id AS publicId FROM auth_public_identities WHERE user_id=?', userId);
    if (existing) return existing.publicId;
    let attempt = 0;
    for (;;) {
      attempt += 1;
      const candidate = await this.#derivePublicId(userId, attempt - 1);
      const clash = this.#one('SELECT user_id AS userId FROM auth_public_identities WHERE public_id=?', candidate);
      if (clash && clash.userId !== userId) continue; // deterministic collision, retry
      this.sql.exec('INSERT INTO auth_public_identities(user_id,public_id,created_at) VALUES(?,?,?)', userId, candidate, now);
      return candidate;
    }
  }

  // Blueprint §4, profile provisioning must never fail a login. Creates a
  // neutral, editable placeholder row for accounts that reached a verified
  // session without an onboarding row (legacy/abandoned-onboarding edge).
  #provisionProfile(userId, now) {
    if (this.#profileForUser(userId)) return null;
    this.sql.exec(
      `INSERT INTO auth_profiles(
        user_id,profile_version,full_name,date_of_birth,school_id,school_name,school_district,
        higher_id,higher_name,higher_district,mobile,bio,targets,visibility,created_at,updated_at
      ) VALUES(?,1,'','','','','',NULL,NULL,NULL,'','','[]','private',?,?)`,
      userId, now, now
    );
    this.#event('profile-provisioned', null, userId, now);
    return this.#profileForUser(userId);
  }

  // Blueprint §6, weighted, display-only completion (never blocks access).
  #profileCompletion(profile, { avatarPresent = false } = {}) {
    if (!profile) return 0;
    let score = 0;
    // Phase 7B (V2, owner-approved weights; sums to 100):
    // name 15 · dob 10 · mobile 10 · school 5 · higher 5 · targets 15 ·
    // session 5 · subjects 10 · goal 15 · bio 5 · avatar 10
    if (profile.fullName && profile.fullName.length >= 2) score += 15;
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(profile.dob || ''))) score += 10;
    if (profile.mobile) score += 10;
    if (profile.school && profile.school.name) score += 5;
    if (profile.higherInstitution && profile.higherInstitution.name) score += 5;
    if (Array.isArray(profile.targets) && profile.targets.length > 0 && profile.targets[0]?.name) score += 15;
    if (profile.admissionSession) score += 5;
    if (Array.isArray(profile.subjects) && profile.subjects.length > 0) score += 10;
    if (profile.academicGoal) score += 15;
    if (profile.bio) score += 5;
    if (avatarPresent) score += 10;
    return Math.min(100, score);
  }

  async getProfileV2(input) {
    const session = this.#canonicalSession(input);
    if (session.error) return session;
    const provisioned = this.#provisionProfile(session.user.id, input.now);
    const profile = provisioned || this.#profileForUser(session.user.id);
    const publicId = await this.#ensurePublicIdentity(session.user.id, input.now);
    const avatarPresent = input.avatarPresent === true;
    const account = this.#one('SELECT created_at AS createdAt,last_login_at AS lastLoginAt FROM auth_users WHERE user_id=?', session.user.id);
    return {
      profile,
      publicId,
      completion: this.#profileCompletion(profile, { avatarPresent }),
      avatarPresent,
      joinedYear: account ? joinedYearOf(account.createdAt) : null,
      lastLoginAt: account ? Number(account.lastLoginAt) : null
    };
  }

  // Blueprint §27/§28, PATCH semantics: only provided fields change;
  // optimistic concurrency via profile_version (client sends expectVersion).
  async saveProfilePatch(input) {
    return this.#transaction(() => {
      const session = this.#canonicalSession(input);
      if (session.error) return session;
      const provisioned = this.#provisionProfile(session.user.id, input.now);
      const current = provisioned || this.#profileForUser(session.user.id);
      const expect = input.expectVersion === undefined || input.expectVersion === null
        ? null
        : Number(input.expectVersion);
      if (expect !== null && Number.isFinite(expect) && expect !== current.version) {
        return { error: AUTH_ERROR_CODES.PROFILE_VERSION_CONFLICT, currentVersion: current.version };
      }
      const next = {
        ...current,
        version: current.version + 1,
        ...input.fields,
        updatedAt: input.now
      };
      this.#writeProfile(session.user.id, next, input.now);
      const changed = Object.keys(input.fields);
      this.#event(changed.includes('visibility') ? 'profile-visibility-changed' : 'profile-patched', input.subjectRef, session.user.id, input.now);
      return { saved: true, profile: this.#profileForUser(session.user.id) };
    });
  }

  // Blueprint §22, public-safe projection. Private profiles never surface;
  // limited = name + ID + avatar; public = + target + joined year + bio.
  // Never includes email, mobile, DOB, school details or internal refs.
  async getPublicProfile(input) {
    // Phase 6 fact: suspension lives in auth_account_state (auth_users.status
    // is the deactivation path), both must be active for a public surface.
    const row = this.#one(
      `SELECT p.user_id AS userId,p.full_name AS fullName,p.bio AS bio,p.targets AS targets,p.visibility AS visibility,
        u.created_at AS createdAt,
        (SELECT subject_ref FROM auth_external_identities WHERE user_id=p.user_id AND provider='firebase' LIMIT 1) AS subjectRef
       FROM auth_profiles p
       JOIN auth_users u ON u.user_id=p.user_id
       JOIN auth_public_identities x ON x.user_id=p.user_id
       LEFT JOIN auth_account_state st ON st.user_id=p.user_id
       WHERE x.public_id=? AND u.status='active' AND COALESCE(st.status,'active')='active'`,
      input.publicId
    );
    if (!row) return { error: AUTH_ERROR_CODES.PUBLIC_PROFILE_NOT_FOUND };
    const visibility = ['private', 'limited', 'public'].includes(row.visibility) ? row.visibility : 'private';
    if (visibility === 'private') return { error: AUTH_ERROR_CODES.PUBLIC_PROFILE_NOT_FOUND };
    const publicId = this.#one('SELECT public_id AS publicId FROM auth_public_identities WHERE user_id=?', row.userId);
    const profile = this.#profileForUser(row.userId);
    const base = {
      publicId: publicId?.publicId,
      displayName: row.fullName || 'Admission Student',
      avatarPresent: false,
      visibility
    };
    if (visibility !== 'public') return { profile: base, subjectRef: row.subjectRef || null };
    // Phase 7B (V2, owner-approved allowlist): public = all targets +
    // admission session + academic goal + joined year + bio + completion.
    // Never: email, mobile, DOB, school/higher details, subjects, progress.
    const targets = this.#parseTargets(row.targets).slice(0, 5)
      .map((t) => Object.freeze({ name: t.name, unit: t.unit || '', year: t.year || '' }));
    const target = targets[0] || null;
    return {
      profile: {
        ...base,
        targets: Object.freeze(targets),
        target: target ? { name: target.name, unit: target.unit || '', year: target.year || '' } : null,
        admissionSession: profile.admissionSession || null,
        goal: profile.academicGoal || null,
        joinedYear: joinedYearOf(row.createdAt),
        bio: row.bio || '',
        completion: this.#profileCompletion(profile, { avatarPresent: false })
      },
      subjectRef: row.subjectRef || null
    };
  }

  async beginPasskeyRegistration(input) {
    return this.#transaction(() => {
      const denied = this.#consumeLimits(input.limits, input.now);
      if (denied) return denied;
      const session = this.#canonicalSession(input);
      if (session.error) return session;
      let handle = this.#one('SELECT user_handle AS userHandle FROM auth_passkey_user_handles WHERE user_id=?', session.user.id);
      if (!handle) {
        this.sql.exec(
          'INSERT INTO auth_passkey_user_handles(user_id,user_handle,created_at) VALUES(?,?,?)',
          session.user.id, input.userHandleCandidate, input.now
        );
        handle = { userHandle: input.userHandleCandidate };
      }
      this.sql.exec(
        "UPDATE auth_passkey_challenges SET state='superseded',challenge_mac='',refresh_cipher=NULL WHERE kind='registration' AND user_id=? AND state='active'",
        session.user.id
      );
      this.sql.exec(
        `INSERT INTO auth_passkey_challenges(
          challenge_id,challenge_mac,kind,user_id,subject_ref,user_handle,refresh_cipher,state,
          created_at,expires_at,ip_ref,device_ref
        ) VALUES(?,?,'registration',?,?,?,?, 'active',?,?,?,?)`,
        input.challengeId, input.challengeMac, session.user.id, input.subjectRef, handle.userHandle,
        input.refreshCipher, input.now, input.expiresAt, input.ipRef, input.deviceRef
      );
      const credentials = this.#rows(
        `SELECT credential_id AS credentialId,transports FROM auth_passkey_credentials
         WHERE user_id=? AND status='active' ORDER BY created_at DESC LIMIT 20`,
        session.user.id
      ).map(row => {
        let transports = [];
        try { transports = JSON.parse(row.transports); } catch {}
        return { credentialId: row.credentialId, transports: Array.isArray(transports) ? transports : [] };
      });
      this.#event('passkey-registration-started', input.subjectRef, session.user.id, input.now);
      return { user: session.user, userHandle: handle.userHandle, credentials };
    });
  }

  async getPasskeyRegistrationChallenge(input) {
    return this.#transaction(() => {
      const selected = this.#passkeyChallenge({ ...input, kind: 'registration' });
      if (selected.error) return selected;
      const session = this.#canonicalSession(input);
      if (session.error) return session;
      if (session.user.id !== selected.challenge.userId || input.subjectRef !== selected.challenge.subjectRef) {
        return { error: AUTH_ERROR_CODES.ACCOUNT_CONFLICT };
      }
      return { ...selected.challenge, user: session.user };
    });
  }

  async finishPasskeyRegistration(input) {
    return this.#transaction(() => {
      const selected = this.#passkeyChallenge({ ...input, kind: 'registration' });
      if (selected.error) return selected;
      const challenge = selected.challenge;
      const existing = this.#one('SELECT user_id AS userId,status FROM auth_passkey_credentials WHERE credential_id=?', input.credential.credentialId);
      if (existing) {
        if (existing.userId !== challenge.userId || existing.status === 'active') return { error: AUTH_ERROR_CODES.ACCOUNT_CONFLICT };
        return { error: AUTH_ERROR_CODES.PASSKEY_INVALID };
      }
      this.sql.exec(
        `INSERT INTO auth_passkey_credentials(
          credential_id,user_id,subject_ref,user_handle,public_key_jwk,sign_count,transports,
          backup_eligible,backup_state,refresh_cipher,status,created_at,last_used_at,revoked_at
        ) VALUES(?,?,?,?,?,?,?,?,?,?,'active',?,NULL,NULL)`,
        input.credential.credentialId, challenge.userId, challenge.subjectRef, challenge.userHandle,
        JSON.stringify(input.credential.publicKeyJwk), Number(input.credential.counter || 0),
        JSON.stringify(input.credential.transports || []), input.credential.backupEligible ? 1 : 0,
        input.credential.backupState ? 1 : 0, input.credential.refreshCipher, input.now
      );
      this.sql.exec(
        "UPDATE auth_passkey_challenges SET state='consumed',consumed_at=?,challenge_mac='',refresh_cipher=NULL WHERE challenge_id=? AND state='active'",
        input.now, input.challengeId
      );
      const user = this.#one(
        'SELECT user_id AS id,email_mask AS emailMask,status,created_at AS createdAt FROM auth_users WHERE user_id=?',
        challenge.userId
      );
      const count = this.#one("SELECT COUNT(*) AS count FROM auth_passkey_credentials WHERE user_id=? AND status='active'", challenge.userId);
      this.#event('passkey-registered', challenge.subjectRef, challenge.userId, input.now);
      return { registered: true, credentialCount: Number(count?.count || 0), user };
    });
  }

  async beginPasskeyAuthentication(input) {
    return this.#transaction(() => {
      const denied = this.#consumeLimits(input.limits, input.now);
      if (denied) return denied;
      this.sql.exec(
        "UPDATE auth_passkey_challenges SET state='superseded',challenge_mac='' WHERE kind='authentication' AND device_ref=? AND state='active'",
        input.deviceRef
      );
      this.sql.exec(
        `INSERT INTO auth_passkey_challenges(
          challenge_id,challenge_mac,kind,user_id,subject_ref,user_handle,refresh_cipher,state,
          created_at,expires_at,ip_ref,device_ref
        ) VALUES(?,?,'authentication',NULL,NULL,NULL,NULL,'active',?,?,?,?)`,
        input.challengeId, input.challengeMac, input.now, input.expiresAt, input.ipRef, input.deviceRef
      );
      this.#event('passkey-authentication-started', null, null, input.now);
      return { prepared: true };
    });
  }

  async getPasskeyAuthenticationMaterial(input) {
    return this.#transaction(() => {
      const selected = this.#passkeyChallenge({ ...input, kind: 'authentication' });
      if (selected.error) return selected;
      const row = this.#one(
        `SELECT p.credential_id AS credentialId,p.user_id AS userId,p.subject_ref AS subjectRef,
          p.user_handle AS userHandle,p.public_key_jwk AS publicKeyJwk,p.sign_count AS counter,
          p.refresh_cipher AS refreshCipher,p.status,u.status AS userStatus
         FROM auth_passkey_credentials p JOIN auth_users u ON u.user_id=p.user_id
         WHERE p.credential_id=?`,
        input.credentialId
      );
      if (!row || row.status !== 'active') return { error: AUTH_ERROR_CODES.PASSKEY_NOT_FOUND };
      if (row.userStatus !== 'active') return { error: AUTH_ERROR_CODES.ACCOUNT_DISABLED };
      let publicKeyJwk;
      try { publicKeyJwk = JSON.parse(row.publicKeyJwk); } catch { return { error: AUTH_ERROR_CODES.STORAGE_UNAVAILABLE }; }
      return {
        credential: {
          credentialId: row.credentialId,
          userHandle: row.userHandle,
          publicKeyJwk,
          counter: Number(row.counter || 0)
        }
      };
    });
  }

  async issuePasskeyTicket(input) {
    return this.#transaction(() => {
      const selected = this.#passkeyChallenge({ ...input, kind: 'authentication' });
      if (selected.error) return selected;
      const credential = this.#one(
        `SELECT credential_id AS credentialId,user_id AS userId,subject_ref AS subjectRef,
          sign_count AS counter,refresh_cipher AS refreshCipher,status
         FROM auth_passkey_credentials WHERE credential_id=?`,
        input.credentialId
      );
      if (!credential || credential.status !== 'active') return { error: AUTH_ERROR_CODES.PASSKEY_NOT_FOUND };
      if (Number(credential.counter || 0) !== Number(input.previousCounter || 0)) return { error: AUTH_ERROR_CODES.PASSKEY_INVALID };
      this.sql.exec(
        'UPDATE auth_passkey_credentials SET sign_count=?,backup_state=?,last_used_at=? WHERE credential_id=? AND status=\'active\'',
        Math.max(Number(credential.counter || 0), Number(input.nextCounter || 0)), input.backupState ? 1 : 0,
        input.now, input.credentialId
      );
      this.sql.exec(
        "UPDATE auth_passkey_challenges SET state='consumed',consumed_at=?,challenge_mac='' WHERE challenge_id=? AND state='active'",
        input.now, input.challengeId
      );
      this.sql.exec(
        "UPDATE auth_passkey_tickets SET state='expired' WHERE credential_id=? AND state='active'",
        input.credentialId
      );
      this.sql.exec(
        `INSERT INTO auth_passkey_tickets(
          ticket_ref,credential_id,user_id,subject_ref,device_ref,state,created_at,expires_at,consumed_at
        ) VALUES(?,?,?,?,?,'active',?,?,NULL)`,
        input.ticketRef, input.credentialId, credential.userId, credential.subjectRef,
        input.deviceRef, input.now, input.expiresAt
      );
      this.#event('passkey-assertion-verified', credential.subjectRef, credential.userId, input.now);
      return { issued: true, refreshCipher: credential.refreshCipher, subjectRef: credential.subjectRef };
    });
  }

  async completePasskeySession(input) {
    return this.#transaction(() => {
      const ticket = this.#one(
        `SELECT ticket_ref AS ticketRef,credential_id AS credentialId,user_id AS userId,
          subject_ref AS subjectRef,device_ref AS deviceRef,state,expires_at AS expiresAt
         FROM auth_passkey_tickets WHERE ticket_ref=?`,
        input.ticketRef
      );
      if (!ticket || ticket.state !== 'active' || ticket.deviceRef !== input.deviceRef || ticket.subjectRef !== input.subjectRef) {
        return { error: AUTH_ERROR_CODES.PASSKEY_INVALID };
      }
      if (Number(ticket.expiresAt) <= input.now) {
        this.sql.exec("UPDATE auth_passkey_tickets SET state='expired' WHERE ticket_ref=?", input.ticketRef);
        return { error: AUTH_ERROR_CODES.PASSKEY_INVALID };
      }
      const identity = this.#one(
        `SELECT u.user_id AS id,u.email_ref AS emailRef,u.email_mask AS emailMask,u.status,u.created_at AS createdAt
         FROM auth_users u JOIN auth_external_identities x ON x.user_id=u.user_id
         WHERE u.user_id=? AND x.provider='firebase' AND x.subject_ref=?`,
        ticket.userId, input.subjectRef
      );
      if (!identity) return { error: AUTH_ERROR_CODES.ACCOUNT_CONFLICT };
      if (identity.status !== 'active') return { error: AUTH_ERROR_CODES.ACCOUNT_DISABLED };
      if (identity.emailRef !== input.emailRef) {
        const owner = this.#one('SELECT user_id AS id FROM auth_users WHERE email_ref=?', input.emailRef);
        if (owner && owner.id !== identity.id) return { error: AUTH_ERROR_CODES.ACCOUNT_CONFLICT };
        this.sql.exec('UPDATE auth_users SET email_ref=?,email_mask=? WHERE user_id=?', input.emailRef, input.emailMask, identity.id);
        identity.emailRef = input.emailRef;
        identity.emailMask = input.emailMask;
      }
      const credential = this.#one(
        "SELECT status FROM auth_passkey_credentials WHERE credential_id=? AND user_id=? AND subject_ref=?",
        ticket.credentialId, ticket.userId, input.subjectRef
      );
      if (!credential || credential.status !== 'active') return { error: AUTH_ERROR_CODES.PASSKEY_NOT_FOUND };
      this.sql.exec(
        "UPDATE auth_passkey_tickets SET state='consumed',consumed_at=? WHERE ticket_ref=? AND state='active'",
        input.now, input.ticketRef
      );
      this.sql.exec(
        "UPDATE auth_passkey_credentials SET refresh_cipher=?,last_used_at=? WHERE credential_id=? AND status='active'",
        input.refreshCipher, input.now, ticket.credentialId
      );
      this.sql.exec(
        `INSERT INTO auth_sessions(
          session_ref,user_id,created_at,expires_at,last_seen_at,revoked_at,ip_ref,device_ref,user_agent
        ) VALUES(?,?,?,?,?,NULL,?,?,?)`,
        input.sessionRef, ticket.userId, input.now, input.sessionExpiresAt, input.now,
        input.ipRef, input.deviceRef, input.userAgent
      );
      this.sql.exec('UPDATE auth_users SET last_login_at=? WHERE user_id=?', input.now, ticket.userId);
      this.#event('firebase-passkey-login', input.subjectRef, ticket.userId, input.now);
      return { established: true, user: identity };
    });
  }

  async getPasskeyStatus(input) {
    return this.#transaction(() => {
      const session = this.#canonicalSession(input);
      if (session.error) return session;
      const credentials = this.#rows(
        `SELECT credential_id AS id,created_at AS createdAt,last_used_at AS lastUsedAt,
          backup_eligible AS backupEligible,backup_state AS backupState
         FROM auth_passkey_credentials WHERE user_id=? AND subject_ref=? AND status='active'
         ORDER BY created_at DESC LIMIT 20`,
        session.user.id, input.subjectRef
      ).map(row => ({
        id: row.id,
        createdAt: Number(row.createdAt),
        lastUsedAt: row.lastUsedAt == null ? null : Number(row.lastUsedAt),
        synced: Boolean(row.backupEligible),
        backedUp: Boolean(row.backupState)
      }));
      return { count: credentials.length, credentials };
    });
  }

  async removePasskey(input) {
    return this.#transaction(() => {
      const session = this.#canonicalSession(input);
      if (session.error) return session;
      const row = this.#one(
        "SELECT status FROM auth_passkey_credentials WHERE credential_id=? AND user_id=? AND subject_ref=?",
        input.credentialId, session.user.id, input.subjectRef
      );
      if (!row || row.status !== 'active') return { error: AUTH_ERROR_CODES.PASSKEY_NOT_FOUND };
      this.sql.exec(
        "UPDATE auth_passkey_credentials SET status='revoked',refresh_cipher='',revoked_at=? WHERE credential_id=?",
        input.now, input.credentialId
      );
      this.sql.exec("UPDATE auth_passkey_tickets SET state='expired' WHERE credential_id=? AND state='active'", input.credentialId);
      const count = this.#one("SELECT COUNT(*) AS count FROM auth_passkey_credentials WHERE user_id=? AND status='active'", session.user.id);
      this.#event('passkey-removed', input.subjectRef, session.user.id, input.now);
      return { removed: true, credentialCount: Number(count?.count || 0) };
    });
  }

  async getSession({ sessionRef, now }) {
    return this.#transaction(() => {
      const row = this.#one(
        `SELECT s.expires_at AS expiresAt,s.last_seen_at AS lastSeenAt,s.created_at AS sessionCreatedAt,
          u.user_id AS id,u.email_mask AS emailMask,u.status,u.created_at AS createdAt
         FROM auth_sessions s JOIN auth_users u ON u.user_id=s.user_id
         WHERE s.session_ref=? AND s.revoked_at IS NULL`,
        sessionRef
      );
      if (!row || Number(row.expiresAt) <= now) return { error: AUTH_ERROR_CODES.SESSION_INVALID };
      if (row.status !== 'active') return { error: AUTH_ERROR_CODES.ACCOUNT_DISABLED };
      if (now - Number(row.lastSeenAt) > 6 * 60 * 60 * 1000) {
        this.sql.exec('UPDATE auth_sessions SET last_seen_at=? WHERE session_ref=?', now, sessionRef);
      }
      return {
        expiresAt: Number(row.expiresAt),
        createdAt: Number(row.sessionCreatedAt),
        user: { id: row.id, emailMask: row.emailMask, status: row.status, createdAt: Number(row.createdAt) }
      };
    });
  }

  async revokeSession({ sessionRef, now }) {
    return this.#transaction(() => {
      const row = this.#one('SELECT revoked_at AS revokedAt FROM auth_sessions WHERE session_ref=?', sessionRef);
      if (!row || row.revokedAt) return { revoked: false };
      this.sql.exec('UPDATE auth_sessions SET revoked_at=? WHERE session_ref=?', now, sessionRef);
      this.#event('logout', null, null, now);
      return { revoked: true };
    });
  }

  // Phase 5, logout-all: revoke every session for one user. Other users'
  // sessions are untouched (multi-device isolation, blueprint §10-12).
  async revokeUserSessions({ userId, now }) {
    return this.#transaction(() => {
      const user = this.#one('SELECT user_id AS id FROM auth_users WHERE user_id=?', userId);
      if (!user) return { error: AUTH_ERROR_CODES.ACCOUNT_NOT_FOUND };
      const open = this.#one('SELECT COUNT(*) AS count FROM auth_sessions WHERE user_id=? AND revoked_at IS NULL', userId);
      const count = Number(open?.count || 0);
      if (count > 0) {
        this.sql.exec('UPDATE auth_sessions SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL', now, userId);
      }
      this.#event('logout-all', null, userId, now);
      return { revoked: count };
    });
  }

  async ping() {
    const row = this.#one("SELECT value FROM auth_meta WHERE key='schema_version'");
    const schema = Number(row?.value || 0);
    return { ok: schema >= 3, storage: 'sqlite-durable-object', schema };
  }

  async cleanup(now) {
    return this.#transaction(() => {
      this.sql.exec("UPDATE auth_account_verification_tickets SET state='expired',refresh_cipher='' WHERE state='active' AND expires_at<=?", now);
      this.sql.exec('DELETE FROM auth_account_verification_tickets WHERE expires_at<?', now - DAY_MS);
      this.sql.exec('DELETE FROM auth_passkey_challenges WHERE expires_at<=?', now);
      this.sql.exec('DELETE FROM auth_passkey_tickets WHERE expires_at<=?', now);
      this.sql.exec("DELETE FROM auth_passkey_credentials WHERE status='revoked' AND revoked_at<?", now - EVENT_RETENTION_MS);
      this.sql.exec('DELETE FROM auth_rate_limits WHERE expires_at<=?', now);
      this.sql.exec('DELETE FROM auth_trusted_devices WHERE expires_at<?', now - DAY_MS);
      this.sql.exec('DELETE FROM auth_security_challenges WHERE expires_at<?', now - DAY_MS);
      this.sql.exec('DELETE FROM auth_sessions WHERE expires_at<=? OR revoked_at IS NOT NULL', now);
      this.sql.exec('DELETE FROM auth_security_events WHERE occurred_at<?', now - EVENT_RETENTION_MS);
      this.sql.exec("INSERT INTO auth_meta(key,value) VALUES('last_cleanup',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", String(now));
      return { cleaned: true };
    });
  }

  async nextExpiry(now) {
    const row = this.#one(
      `SELECT MIN(expiry) AS nextExpiry FROM (
        SELECT MIN(expires_at) AS expiry FROM auth_account_verification_tickets WHERE expires_at>? AND state='active'
        UNION ALL SELECT MIN(expires_at) FROM auth_passkey_challenges WHERE expires_at>?
        UNION ALL SELECT MIN(expires_at) FROM auth_passkey_tickets WHERE expires_at>?
        UNION ALL SELECT MIN(expires_at) FROM auth_sessions WHERE expires_at>? AND revoked_at IS NULL
        UNION ALL SELECT MIN(expires_at) FROM auth_rate_limits WHERE expires_at>?
      )`,
      now, now, now, now, now
    );
    const next = Number(row?.nextExpiry || 0);
    return next > now ? next : null;
  }
}
