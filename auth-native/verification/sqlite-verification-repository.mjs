import { AUTH_ERROR_CODES } from '../core/errors.mjs';
import { constantTimeEqual } from '../core/crypto.mjs';
import { VERIFICATION_FAILURE_CLASS } from './provider-contract.mjs';

const DAY_MS = 86_400_000;
const EVENT_RETENTION_MS = 90 * DAY_MS;
const safeReason = value => String(value || 'UNKNOWN').toUpperCase().replace(/[^A-Z0-9_-]/g, '_').slice(0, 64) || 'UNKNOWN';

export class SqliteVerificationRepository {
  constructor(storage) {
    if (!storage?.sql || typeof storage.sql.exec !== 'function') throw new TypeError('SQLite Durable Object storage is required.');
    this.storage = storage;
    this.sql = storage.sql;
  }

  migrate() {
    const statements = [
      `CREATE TABLE IF NOT EXISTS auth_verification_challenges (
        attempt_id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        session_ref TEXT NOT NULL,
        subject_ref TEXT NOT NULL,
        email_ref TEXT NOT NULL,
        destination_ref TEXT NOT NULL,
        device_ref TEXT NOT NULL,
        ip_ref TEXT NOT NULL,
        purpose TEXT NOT NULL CHECK(purpose IN ('account-backup','sensitive-action','email-ownership')),
        code_mac TEXT NOT NULL,
        code_cipher TEXT NOT NULL DEFAULT '',
        link_token_mac TEXT NOT NULL,
        link_cipher TEXT NOT NULL DEFAULT '',
        provider_id TEXT,
        channel TEXT,
        verification_mode TEXT,
        state TEXT NOT NULL CHECK(state IN ('pending','sent','verified','failed','expired','locked','superseded')),
        attempts INTEGER NOT NULL DEFAULT 0,
        max_attempts INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        resend_at INTEGER NOT NULL,
        sent_at INTEGER,
        verified_at INTEGER,
        lockout_until INTEGER NOT NULL DEFAULT 0,
        provider_confirmed INTEGER NOT NULL DEFAULT 0,
        external_identity_ref TEXT,
        FOREIGN KEY(user_id) REFERENCES auth_users(user_id)
      )`,
      `CREATE INDEX IF NOT EXISTS auth_verification_user_purpose
       ON auth_verification_challenges(user_id,purpose,created_at DESC)`,
      `CREATE INDEX IF NOT EXISTS auth_verification_expiry
       ON auth_verification_challenges(expires_at)`,
      `CREATE TABLE IF NOT EXISTS auth_telegram_identity_links (
        user_id TEXT PRIMARY KEY,
        subject_ref TEXT NOT NULL UNIQUE,
        external_identity_ref TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL CHECK(status IN ('active','revoked')),
        linked_at INTEGER NOT NULL,
        last_verified_at INTEGER NOT NULL,
        revoked_at INTEGER,
        FOREIGN KEY(user_id) REFERENCES auth_users(user_id)
      )`,
      `CREATE INDEX IF NOT EXISTS auth_telegram_identity_status
       ON auth_telegram_identity_links(status,last_verified_at DESC)`,
      `CREATE TABLE IF NOT EXISTS auth_email_ownership_links (
        user_id TEXT PRIMARY KEY,
        subject_ref TEXT NOT NULL UNIQUE,
        email_ref TEXT NOT NULL,
        provider_id TEXT NOT NULL,
        method TEXT NOT NULL CHECK(method IN ('email-otp')),
        status TEXT NOT NULL CHECK(status IN ('active','revoked')),
        proven_at INTEGER NOT NULL,
        last_verified_at INTEGER NOT NULL,
        revoked_at INTEGER,
        FOREIGN KEY(user_id) REFERENCES auth_users(user_id)
      )`,
      `CREATE INDEX IF NOT EXISTS auth_email_ownership_status
       ON auth_email_ownership_links(status,last_verified_at DESC)`,
      `CREATE TABLE IF NOT EXISTS auth_verification_daily_quota (
        provider_id TEXT NOT NULL,
        day_start INTEGER NOT NULL,
        used INTEGER NOT NULL,
        quota_limit INTEGER NOT NULL,
        reset_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY(provider_id,day_start)
      )`,
      `CREATE INDEX IF NOT EXISTS auth_verification_quota_reset
       ON auth_verification_daily_quota(reset_at)`,
      `CREATE TABLE IF NOT EXISTS auth_verification_provider_state (
        provider_id TEXT PRIMARY KEY,
        circuit TEXT NOT NULL CHECK(circuit IN ('closed','open','half-open')),
        consecutive_failures INTEGER NOT NULL DEFAULT 0,
        success_count INTEGER NOT NULL DEFAULT 0,
        failure_count INTEGER NOT NULL DEFAULT 0,
        user_error_count INTEGER NOT NULL DEFAULT 0,
        latency_ewma_ms INTEGER NOT NULL DEFAULT 0,
        cooldown_until INTEGER NOT NULL DEFAULT 0,
        last_success_at INTEGER NOT NULL DEFAULT 0,
        last_failure_at INTEGER NOT NULL DEFAULT 0,
        last_reason TEXT NOT NULL DEFAULT 'NONE',
        updated_at INTEGER NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS auth_verification_runtime_config (
        config_key TEXT PRIMARY KEY,
        config_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS auth_verification_events (
        event_id INTEGER PRIMARY KEY AUTOINCREMENT,
        attempt_id TEXT,
        user_id TEXT,
        subject_ref TEXT,
        provider_id TEXT,
        channel TEXT,
        occurred_at INTEGER NOT NULL,
        outcome TEXT NOT NULL,
        reason TEXT NOT NULL,
        latency_ms INTEGER NOT NULL DEFAULT 0
      )`,
      `CREATE INDEX IF NOT EXISTS auth_verification_events_time
       ON auth_verification_events(occurred_at DESC)`
    ];
    for (const statement of statements) this.sql.exec(statement);
    const challengeColumns = new Set(
      Array.from(this.sql.exec('PRAGMA table_info(auth_verification_challenges)')).map(row => String(row.name || ''))
    );
    const additiveColumns = [
      ['code_cipher', "ALTER TABLE auth_verification_challenges ADD COLUMN code_cipher TEXT NOT NULL DEFAULT ''"],
      ['link_token_mac', "ALTER TABLE auth_verification_challenges ADD COLUMN link_token_mac TEXT NOT NULL DEFAULT ''"],
      ['link_cipher', "ALTER TABLE auth_verification_challenges ADD COLUMN link_cipher TEXT NOT NULL DEFAULT ''"],
      ['provider_confirmed', 'ALTER TABLE auth_verification_challenges ADD COLUMN provider_confirmed INTEGER NOT NULL DEFAULT 0'],
      ['external_identity_ref', 'ALTER TABLE auth_verification_challenges ADD COLUMN external_identity_ref TEXT']
    ];
    for (const [column, statement] of additiveColumns) {
      if (!challengeColumns.has(column)) this.sql.exec(statement);
    }
    // SQLite cannot alter a CHECK constraint in place, so a database created before
    // `email-ownership` existed still rejects that purpose. Rebuild the table once,
    // detected from the stored DDL, rather than version-stamping the migration.
    const challengeDdl = String(this.#one(
      "SELECT sql FROM sqlite_master WHERE type='table' AND name='auth_verification_challenges'"
    )?.sql || '');
    if (challengeDdl && !challengeDdl.includes('email-ownership')) {
      this.sql.exec('ALTER TABLE auth_verification_challenges RENAME TO auth_verification_challenges_legacy');
      this.sql.exec(`CREATE TABLE auth_verification_challenges (
        attempt_id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        session_ref TEXT NOT NULL,
        subject_ref TEXT NOT NULL,
        email_ref TEXT NOT NULL,
        destination_ref TEXT NOT NULL,
        device_ref TEXT NOT NULL,
        ip_ref TEXT NOT NULL,
        purpose TEXT NOT NULL CHECK(purpose IN ('account-backup','sensitive-action','email-ownership')),
        code_mac TEXT NOT NULL,
        code_cipher TEXT NOT NULL DEFAULT '',
        link_token_mac TEXT NOT NULL,
        link_cipher TEXT NOT NULL DEFAULT '',
        provider_id TEXT,
        channel TEXT,
        verification_mode TEXT,
        state TEXT NOT NULL CHECK(state IN ('pending','sent','verified','failed','expired','locked','superseded')),
        attempts INTEGER NOT NULL DEFAULT 0,
        max_attempts INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        resend_at INTEGER NOT NULL,
        sent_at INTEGER,
        verified_at INTEGER,
        lockout_until INTEGER NOT NULL DEFAULT 0,
        provider_confirmed INTEGER NOT NULL DEFAULT 0,
        external_identity_ref TEXT,
        FOREIGN KEY(user_id) REFERENCES auth_users(user_id)
      )`);
      this.sql.exec(`INSERT INTO auth_verification_challenges(
        attempt_id,user_id,session_ref,subject_ref,email_ref,destination_ref,device_ref,ip_ref,purpose,
        code_mac,code_cipher,link_token_mac,link_cipher,provider_id,channel,verification_mode,state,
        attempts,max_attempts,created_at,expires_at,resend_at,sent_at,verified_at,lockout_until,
        provider_confirmed,external_identity_ref
      ) SELECT
        attempt_id,user_id,session_ref,subject_ref,email_ref,destination_ref,device_ref,ip_ref,purpose,
        code_mac,code_cipher,link_token_mac,link_cipher,provider_id,channel,verification_mode,state,
        attempts,max_attempts,created_at,expires_at,resend_at,sent_at,verified_at,lockout_until,
        provider_confirmed,external_identity_ref
      FROM auth_verification_challenges_legacy`);
      this.sql.exec('DROP TABLE auth_verification_challenges_legacy');
      this.sql.exec('CREATE INDEX IF NOT EXISTS auth_verification_user_purpose ON auth_verification_challenges(user_id,purpose,created_at DESC)');
      this.sql.exec('CREATE INDEX IF NOT EXISTS auth_verification_expiry ON auth_verification_challenges(expires_at)');
    }
    this.sql.exec("INSERT INTO auth_meta(key,value) VALUES('schema_version','6') ON CONFLICT(key) DO UPDATE SET value=excluded.value");
  }

  #rows(statement, ...bindings) { return Array.from(this.sql.exec(statement, ...bindings)); }
  #one(statement, ...bindings) { return this.#rows(statement, ...bindings)[0] || null; }
  #transaction(work) { return typeof this.storage.transactionSync === 'function' ? this.storage.transactionSync(work) : work(); }

  async getRuntimeConfig() {
    const row = this.#one("SELECT config_json AS configJson,updated_at AS updatedAt FROM auth_verification_runtime_config WHERE config_key='active'");
    if (!row) return null;
    try {
      const config = JSON.parse(row.configJson);
      return config && typeof config === 'object' ? { ...config, updatedAt: Number(row.updatedAt) } : null;
    } catch { return null; }
  }

  async setRuntimeConfig({ config, now }) {
    this.sql.exec(
      `INSERT INTO auth_verification_runtime_config(config_key,config_json,updated_at) VALUES('active',?,?)
       ON CONFLICT(config_key) DO UPDATE SET config_json=excluded.config_json,updated_at=excluded.updated_at`,
      JSON.stringify(config), Number(now)
    );
    return { updated: true, updatedAt: Number(now) };
  }

  #event(input) {
    this.sql.exec(
      `INSERT INTO auth_verification_events(
        attempt_id,user_id,subject_ref,provider_id,channel,occurred_at,outcome,reason,latency_ms
      ) VALUES(?,?,?,?,?,?,?,?,?)`,
      input.attemptId || null,
      input.userId || null,
      input.subjectRef || null,
      input.providerId || null,
      input.channel || null,
      Number(input.now),
      safeReason(input.outcome),
      safeReason(input.reason),
      Math.max(0, Math.round(Number(input.latencyMs || 0)))
    );
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

  #challenge(input) {
    const row = this.#one(
      `SELECT attempt_id AS attemptId,user_id AS userId,session_ref AS sessionRef,subject_ref AS subjectRef,
        email_ref AS emailRef,destination_ref AS destinationRef,device_ref AS deviceRef,ip_ref AS ipRef,
        purpose,code_mac AS codeMac,code_cipher AS codeCipher,link_token_mac AS linkTokenMac,
        link_cipher AS linkCipher,provider_id AS providerId,channel,verification_mode AS verificationMode,
        state,attempts,max_attempts AS maxAttempts,
        created_at AS createdAt,expires_at AS expiresAt,resend_at AS resendAt,sent_at AS sentAt,
        verified_at AS verifiedAt,lockout_until AS lockoutUntil,provider_confirmed AS providerConfirmed,
        external_identity_ref AS externalIdentityRef
       FROM auth_verification_challenges WHERE attempt_id=?`,
      input.attemptId
    );
    if (!row || row.sessionRef !== input.sessionRef || row.subjectRef !== input.subjectRef || row.userId !== input.userId
      || row.deviceRef !== input.deviceRef || row.emailRef !== input.emailRef || row.purpose !== input.purpose) {
      return { error: AUTH_ERROR_CODES.OTP_INVALID };
    }
    if (row.state === 'verified') return { error: AUTH_ERROR_CODES.OTP_USED };
    if (row.state === 'locked') return {
      error: AUTH_ERROR_CODES.OTP_LOCKED,
      retryAfter: Math.max(1, Math.ceil((Number(row.lockoutUntil || input.now + 1000) - input.now) / 1000))
    };
    if (row.state !== 'sent') return { error: AUTH_ERROR_CODES.OTP_INVALID };
    if (Number(row.expiresAt) <= input.now) {
      this.sql.exec("UPDATE auth_verification_challenges SET state='expired',code_mac='',code_cipher='',link_token_mac='',link_cipher='' WHERE attempt_id=?", input.attemptId);
      return { error: AUTH_ERROR_CODES.OTP_EXPIRED };
    }
    return { challenge: row };
  }

  async reserveChallenge(input) {
    return this.#transaction(() => {
      const lockout = this.#one(
        `SELECT MAX(lockout_until) AS lockoutUntil FROM auth_verification_challenges
         WHERE user_id=? AND purpose=? AND state='locked' AND lockout_until>?`,
        input.userId, input.purpose, input.now
      );
      if (Number(lockout?.lockoutUntil || 0) > input.now) {
        return {
          error: AUTH_ERROR_CODES.OTP_LOCKED,
          retryAfter: Math.max(1, Math.ceil((Number(lockout.lockoutUntil) - input.now) / 1000))
        };
      }
      const denied = this.#consumeLimits(input.limits, input.now);
      if (denied) return denied;
      const latest = this.#one(
        `SELECT resend_at AS resendAt FROM auth_verification_challenges
         WHERE user_id=? AND purpose=? AND state IN ('pending','sent')
         ORDER BY created_at DESC LIMIT 1`,
        input.userId, input.purpose
      );
      if (latest && input.now < Number(latest.resendAt)) {
        return { error: AUTH_ERROR_CODES.RESEND_COOLDOWN, retryAfter: Math.max(1, Math.ceil((Number(latest.resendAt) - input.now) / 1000)) };
      }
      this.sql.exec(
        `INSERT INTO auth_verification_challenges(
          attempt_id,user_id,session_ref,subject_ref,email_ref,destination_ref,device_ref,ip_ref,purpose,
          code_mac,code_cipher,link_token_mac,link_cipher,provider_id,channel,verification_mode,state,
          attempts,max_attempts,created_at,expires_at,resend_at,sent_at,verified_at,lockout_until
        ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,NULL,NULL,NULL,'pending',0,?,?,?,?,NULL,NULL,0)`,
        input.attemptId, input.userId, input.sessionRef, input.subjectRef, input.emailRef,
        input.destinationRef, input.deviceRef, input.ipRef, input.purpose, input.codeMac,
        input.codeCipher, input.linkTokenMac, input.linkCipher, input.maxAttempts,
        input.createdAt, input.expiresAt, input.resendAt
      );
      this.#event({ ...input, outcome: 'prepared', reason: 'accepted' });
      return { reserved: true };
    });
  }

  async markChallengeDelivery(input) {
    return this.#transaction(() => {
      const row = this.#one("SELECT user_id AS userId,subject_ref AS subjectRef,purpose,state FROM auth_verification_challenges WHERE attempt_id=?", input.attemptId);
      if (!row || row.state !== 'pending') return { error: AUTH_ERROR_CODES.OTP_INVALID };
      this.sql.exec(
        `UPDATE auth_verification_challenges
         SET provider_id=?,channel=?,verification_mode=?,state='sent',sent_at=?,
             code_cipher=CASE WHEN ? THEN code_cipher ELSE '' END,
             link_cipher=CASE WHEN ? THEN link_cipher ELSE '' END
         WHERE attempt_id=? AND state='pending'`,
        input.providerId, input.channel, input.verificationMode, input.now,
        input.retainCodeCipher ? 1 : 0, input.retainLinkCipher ? 1 : 0, input.attemptId
      );
      this.sql.exec(
        `UPDATE auth_verification_challenges
         SET state='superseded',code_mac='',code_cipher='',link_token_mac='',link_cipher=''
         WHERE user_id=? AND purpose=? AND attempt_id<>? AND state IN ('pending','sent')`,
        row.userId, row.purpose, input.attemptId
      );
      this.#event({ ...input, userId: row.userId, subjectRef: row.subjectRef, outcome: 'sent', reason: 'accepted' });
      return { delivered: true };
    });
  }

  async confirmProviderEvidence(input) {
    return this.#transaction(() => {
      const row = this.#one(
        `SELECT attempt_id AS attemptId,user_id AS userId,subject_ref AS subjectRef,provider_id AS providerId,channel
         FROM auth_verification_challenges
         WHERE link_token_mac=? AND provider_id=? AND channel=? AND state='sent' AND expires_at>?`,
        input.linkTokenMac, input.providerId, input.channel, input.now
      );
      if (!row) return { error: AUTH_ERROR_CODES.OTP_INVALID };
      this.sql.exec(
        `UPDATE auth_verification_challenges
         SET provider_confirmed=1,external_identity_ref=?,link_token_mac=''
         WHERE attempt_id=? AND state='sent' AND link_token_mac=?`,
        input.externalIdentityRef, row.attemptId, input.linkTokenMac
      );
      this.#event({ ...row, now: input.now, outcome: 'provider_confirmed', reason: 'webhook_verified' });
      return { confirmed: true, attemptId: row.attemptId };
    });
  }

  async claimTelegramDelivery(input) {
    return this.#transaction(() => {
      const row = this.#one(
        `SELECT attempt_id AS attemptId,user_id AS userId,subject_ref AS subjectRef,
          code_cipher AS codeCipher,expires_at AS expiresAt,provider_confirmed AS providerConfirmed,
          external_identity_ref AS externalIdentityRef
         FROM auth_verification_challenges
         WHERE link_token_mac=? AND provider_id='telegram' AND channel='telegram'
           AND verification_mode='local-code' AND state='sent'`,
        input.linkTokenMac
      );
      if (!row || Number(row.expiresAt) <= input.now || !row.codeCipher) return { error: AUTH_ERROR_CODES.OTP_INVALID };
      if (row.providerConfirmed && row.externalIdentityRef !== input.externalIdentityRef) {
        return { error: AUTH_ERROR_CODES.ACCOUNT_CONFLICT };
      }
      const externalOwner = this.#one(
        "SELECT user_id AS userId,subject_ref AS subjectRef FROM auth_telegram_identity_links WHERE external_identity_ref=? AND status='active'",
        input.externalIdentityRef
      );
      const userLink = this.#one(
        "SELECT external_identity_ref AS externalIdentityRef,subject_ref AS subjectRef FROM auth_telegram_identity_links WHERE user_id=? AND status='active'",
        row.userId
      );
      const claimedElsewhere = this.#one(
        `SELECT user_id AS userId FROM auth_verification_challenges
         WHERE external_identity_ref=? AND provider_id='telegram' AND state='sent'
           AND provider_confirmed=1 AND attempt_id<>?`,
        input.externalIdentityRef, row.attemptId
      );
      if ((externalOwner && (externalOwner.userId !== row.userId || externalOwner.subjectRef !== row.subjectRef))
        || (userLink && (userLink.externalIdentityRef !== input.externalIdentityRef || userLink.subjectRef !== row.subjectRef))
        || (claimedElsewhere && claimedElsewhere.userId !== row.userId)) {
        return { error: AUTH_ERROR_CODES.ACCOUNT_CONFLICT };
      }
      this.sql.exec(
        `UPDATE auth_verification_challenges
         SET provider_confirmed=1,external_identity_ref=?
         WHERE attempt_id=? AND state='sent' AND (provider_confirmed=0 OR external_identity_ref=?)`,
        input.externalIdentityRef, row.attemptId, input.externalIdentityRef
      );
      this.#event({ ...row, providerId: 'telegram', channel: 'telegram', now: input.now, outcome: 'provider_confirmed', reason: 'private_same_user_start' });
      return {
        claimed: true,
        attemptId: row.attemptId,
        codeCipher: row.codeCipher,
        expiresAt: Number(row.expiresAt),
        userId: row.userId,
        subjectRef: row.subjectRef
      };
    });
  }

  async confirmTelegramDelivery(input) {
    return this.#transaction(() => {
      const row = this.#one(
        `SELECT user_id AS userId,subject_ref AS subjectRef FROM auth_verification_challenges
         WHERE attempt_id=? AND provider_id='telegram' AND provider_confirmed=1 AND state='sent'`,
        input.attemptId
      );
      if (!row) return { error: AUTH_ERROR_CODES.OTP_INVALID };
      this.sql.exec("UPDATE auth_verification_challenges SET code_cipher='',link_token_mac='',link_cipher='' WHERE attempt_id=?", input.attemptId);
      this.#event({ ...row, attemptId: input.attemptId, providerId: 'telegram', channel: 'telegram', now: input.now, outcome: 'sent', reason: 'telegram_code_accepted' });
      return { delivered: true };
    });
  }

  async getPendingChallenge(input) {
    return this.#transaction(() => {
      const row = this.#one(
        `SELECT attempt_id AS attemptId,expires_at AS expiresAt,resend_at AS resendAt,
          provider_id AS providerId,channel,verification_mode AS verificationMode,
          provider_confirmed AS providerConfirmed,code_cipher AS codeCipher,link_cipher AS linkCipher,state
         FROM auth_verification_challenges
         WHERE user_id=? AND session_ref=? AND subject_ref=? AND email_ref=?
           AND device_ref=? AND purpose=? AND state='sent'
         ORDER BY created_at DESC LIMIT 1`,
        input.userId, input.sessionRef, input.subjectRef, input.emailRef,
        input.deviceRef, input.purpose
      );
      if (!row) return { pending: false };
      if (Number(row.expiresAt) <= input.now) {
        this.sql.exec("UPDATE auth_verification_challenges SET state='expired',code_mac='',code_cipher='',link_token_mac='',link_cipher='' WHERE attempt_id=?", row.attemptId);
        return { pending: false };
      }
      return { pending: true, challenge: row };
    });
  }

  async isTelegramLinked(input) {
    const row = this.#one(
      "SELECT status FROM auth_telegram_identity_links WHERE user_id=? AND subject_ref=?",
      input.userId, input.subjectRef
    );
    return { linked: row?.status === 'active' };
  }

  async isEmailOwnershipProven(input) {
    const row = this.#one(
      "SELECT status,method FROM auth_email_ownership_links WHERE user_id=? AND subject_ref=?",
      input.userId, input.subjectRef
    );
    return {
      proven: row?.status === 'active',
      method: row?.status === 'active' ? row.method : null
    };
  }

  async revokeEmailOwnership(input) {
    this.sql.exec(
      "UPDATE auth_email_ownership_links SET status='revoked',revoked_at=? WHERE user_id=? AND status='active'",
      input.now, input.userId
    );
    return { revoked: true };
  }

  async failChallenge(input) {
    return this.#transaction(() => {
      const row = this.#one(
        'SELECT user_id AS userId,subject_ref AS subjectRef,provider_id AS providerId,channel FROM auth_verification_challenges WHERE attempt_id=?',
        input.attemptId
      );
      this.sql.exec(
        "UPDATE auth_verification_challenges SET state='failed',code_mac='',code_cipher='',link_token_mac='',link_cipher='' WHERE attempt_id=? AND state IN ('pending','sent')",
        input.attemptId
      );
      this.#event({ ...(row || {}), ...input, outcome: 'failed' });
      return { failed: true };
    });
  }

  async getChallenge(input) { return this.#transaction(() => this.#challenge(input)); }

  async rejectChallengeAttempt(input) {
    return this.#transaction(() => {
      const selected = this.#challenge(input);
      if (selected.error) return selected;
      const row = selected.challenge;
      const attempts = Number(row.attempts || 0) + 1;
      if (attempts >= Number(row.maxAttempts)) {
        const lockoutUntil = input.now + input.lockoutMs;
        this.sql.exec(
          "UPDATE auth_verification_challenges SET attempts=?,state='locked',code_mac='',code_cipher='',link_token_mac='',link_cipher='',lockout_until=? WHERE attempt_id=?",
          attempts, lockoutUntil, input.attemptId
        );
        this.#event({ ...row, now: input.now, outcome: 'locked', reason: 'attempt_limit' });
        return { error: AUTH_ERROR_CODES.OTP_LOCKED, retryAfter: Math.ceil(input.lockoutMs / 1000) };
      }
      this.sql.exec('UPDATE auth_verification_challenges SET attempts=? WHERE attempt_id=?', attempts, input.attemptId);
      this.#event({ ...row, now: input.now, outcome: 'rejected', reason: input.reason || 'user_code_mismatch' });
      return { error: AUTH_ERROR_CODES.OTP_INVALID, attemptsRemaining: Number(row.maxAttempts) - attempts };
    });
  }

  async verifyLocalChallenge(input) {
    return this.#transaction(() => {
      const selected = this.#challenge(input);
      if (selected.error) return selected;
      const row = selected.challenge;
      if (row.providerId === 'telegram' && (!row.providerConfirmed || !row.externalIdentityRef)) {
        return { error: AUTH_ERROR_CODES.TELEGRAM_VERIFICATION_PENDING };
      }
      if (!constantTimeEqual(row.codeMac, input.candidateCodeMac)) {
        const attempts = Number(row.attempts || 0) + 1;
        if (attempts >= Number(row.maxAttempts)) {
          const lockoutUntil = input.now + input.lockoutMs;
          this.sql.exec(
            "UPDATE auth_verification_challenges SET attempts=?,state='locked',code_mac='',code_cipher='',link_token_mac='',link_cipher='',lockout_until=? WHERE attempt_id=?",
            attempts, lockoutUntil, input.attemptId
          );
          this.#event({ ...row, now: input.now, outcome: 'locked', reason: 'attempt_limit' });
          return { error: AUTH_ERROR_CODES.OTP_LOCKED, retryAfter: Math.ceil(input.lockoutMs / 1000) };
        }
        this.sql.exec('UPDATE auth_verification_challenges SET attempts=? WHERE attempt_id=?', attempts, input.attemptId);
        this.#event({ ...row, now: input.now, outcome: 'rejected', reason: 'user_code_mismatch' });
        return { error: AUTH_ERROR_CODES.OTP_INVALID, attemptsRemaining: Number(row.maxAttempts) - attempts };
      }
      if (row.providerId === 'telegram') {
        const externalOwner = this.#one(
          "SELECT user_id AS userId,subject_ref AS subjectRef FROM auth_telegram_identity_links WHERE external_identity_ref=? AND status='active'",
          row.externalIdentityRef
        );
        const userLink = this.#one(
          "SELECT external_identity_ref AS externalIdentityRef,subject_ref AS subjectRef FROM auth_telegram_identity_links WHERE user_id=? AND status='active'",
          row.userId
        );
        if ((externalOwner && (externalOwner.userId !== row.userId || externalOwner.subjectRef !== row.subjectRef))
          || (userLink && (userLink.externalIdentityRef !== row.externalIdentityRef || userLink.subjectRef !== row.subjectRef))) {
          return { error: AUTH_ERROR_CODES.ACCOUNT_CONFLICT };
        }
        if (userLink) {
          this.sql.exec(
            "UPDATE auth_telegram_identity_links SET last_verified_at=?,status='active',revoked_at=NULL WHERE user_id=?",
            input.now, row.userId
          );
        } else {
          this.sql.exec(
            `INSERT INTO auth_telegram_identity_links(
              user_id,subject_ref,external_identity_ref,status,linked_at,last_verified_at,revoked_at
            ) VALUES(?,?,?,'active',?,?,NULL)`,
            row.userId, row.subjectRef, row.externalIdentityRef, input.now, input.now
          );
        }
      }
      this.sql.exec(
        "UPDATE auth_verification_challenges SET state='verified',code_mac='',code_cipher='',link_token_mac='',link_cipher='',verified_at=? WHERE attempt_id=? AND state='sent'",
        input.now, input.attemptId
      );
      // A code delivered to the address itself is proof of ownership of that
      // address, so record it alongside the challenge. The session gate reads this
      // when Firebase's own emailVerified flag is still false.
      if (row.purpose === 'email-ownership') {
        const existing = this.#one(
          'SELECT email_ref AS emailRef,subject_ref AS subjectRef,status FROM auth_email_ownership_links WHERE user_id=?',
          row.userId
        );
        if (existing && (existing.subjectRef !== row.subjectRef || existing.emailRef !== row.emailRef)) {
          return { error: AUTH_ERROR_CODES.ACCOUNT_CONFLICT };
        }
        this.sql.exec(
          `INSERT INTO auth_email_ownership_links(
            user_id,subject_ref,email_ref,provider_id,method,status,proven_at,last_verified_at,revoked_at
          ) VALUES(?,?,?,?,'email-otp','active',?,?,NULL)
          ON CONFLICT(user_id) DO UPDATE SET
            status='active',provider_id=excluded.provider_id,last_verified_at=excluded.last_verified_at,revoked_at=NULL`,
          row.userId, row.subjectRef, row.emailRef, row.providerId || 'otp', input.now, input.now
        );
      }
      this.#event({ ...row, now: input.now, outcome: 'verified', reason: 'accepted' });
      return {
        verified: true,
        userId: row.userId,
        purpose: row.purpose,
        telegramLinked: row.providerId === 'telegram',
        emailOwnershipProven: row.purpose === 'email-ownership',
        emailVerified: false
      };
    });
  }

  async completeRemoteChallenge(input) {
    return this.#transaction(() => {
      const selected = this.#challenge(input);
      if (selected.error) return selected;
      const row = selected.challenge;
      // Owner 2026-10-17: a code checked by Logto/Appwrite/Ory/Hanko proves the
      // address exactly like a locally checked one. Without the ownership link the
      // worker refused the right code and the burned challenge then said "used".
      // The conflict check runs before the challenge is spent.
      const ownership = row.purpose === 'email-ownership';
      if (ownership) {
        const existing = this.#one(
          'SELECT email_ref AS emailRef,subject_ref AS subjectRef,status FROM auth_email_ownership_links WHERE user_id=?',
          row.userId
        );
        if (existing && (existing.subjectRef !== row.subjectRef || existing.emailRef !== row.emailRef)) {
          return { error: AUTH_ERROR_CODES.ACCOUNT_CONFLICT };
        }
      }
      this.sql.exec(
        "UPDATE auth_verification_challenges SET state='verified',code_mac='',code_cipher='',link_token_mac='',link_cipher='',verified_at=? WHERE attempt_id=? AND state='sent'",
        input.now, input.attemptId
      );
      if (ownership) {
        this.sql.exec(
          `INSERT INTO auth_email_ownership_links(
            user_id,subject_ref,email_ref,provider_id,method,status,proven_at,last_verified_at,revoked_at
          ) VALUES(?,?,?,?,'email-otp','active',?,?,NULL)
          ON CONFLICT(user_id) DO UPDATE SET
            status='active',provider_id=excluded.provider_id,last_verified_at=excluded.last_verified_at,revoked_at=NULL`,
          row.userId, row.subjectRef, row.emailRef, row.providerId || 'otp', input.now, input.now
        );
      }
      this.#event({ ...row, now: input.now, outcome: 'verified', reason: 'provider_evidence' });
      return {
        verified: true,
        userId: row.userId,
        purpose: row.purpose,
        ...(ownership ? { emailOwnershipProven: true, emailVerified: false } : {})
      };
    });
  }

  async dailyQuotaSnapshot({ providerId, dailyQuota, now }) {
    const dayStart = Math.floor(now / DAY_MS) * DAY_MS;
    const resetAt = dayStart + DAY_MS;
    const row = this.#one(
      'SELECT used FROM auth_verification_daily_quota WHERE provider_id=? AND day_start=?',
      providerId, dayStart
    );
    const used = Math.max(0, Number(row?.used || 0));
    return { used, remaining: Math.max(0, dailyQuota - used), limit: dailyQuota, resetAt };
  }

  async reserveDailyQuota({ providerId, dailyQuota, now }) {
    return this.#transaction(() => {
      const dayStart = Math.floor(now / DAY_MS) * DAY_MS;
      const resetAt = dayStart + DAY_MS;
      this.sql.exec(
        `INSERT INTO auth_verification_daily_quota(provider_id,day_start,used,quota_limit,reset_at,updated_at)
         VALUES(?,?,0,?,?,?) ON CONFLICT(provider_id,day_start)
         DO UPDATE SET quota_limit=excluded.quota_limit,reset_at=excluded.reset_at,updated_at=excluded.updated_at`,
        providerId, dayStart, dailyQuota, resetAt, now
      );
      const before = this.#one(
        'SELECT used FROM auth_verification_daily_quota WHERE provider_id=? AND day_start=?',
        providerId, dayStart
      );
      if (dailyQuota <= 0 || Number(before?.used || 0) >= dailyQuota) {
        return { exhausted: true, used: Number(before?.used || 0), remaining: 0, limit: dailyQuota, resetAt };
      }
      this.sql.exec(
        `UPDATE auth_verification_daily_quota SET used=used+1,updated_at=?
         WHERE provider_id=? AND day_start=? AND used<quota_limit`,
        now, providerId, dayStart
      );
      const row = this.#one(
        'SELECT used FROM auth_verification_daily_quota WHERE provider_id=? AND day_start=?',
        providerId, dayStart
      );
      const used = Number(row?.used || 0);
      return { exhausted: false, used, remaining: Math.max(0, dailyQuota - used), limit: dailyQuota, resetAt };
    });
  }

  async providerSnapshot({ providerId, now }) {
    return this.#transaction(() => {
      this.sql.exec(
        `INSERT OR IGNORE INTO auth_verification_provider_state(
          provider_id,circuit,consecutive_failures,success_count,failure_count,user_error_count,
          latency_ewma_ms,cooldown_until,last_success_at,last_failure_at,last_reason,updated_at
        ) VALUES(?,'closed',0,0,0,0,0,0,0,0,'NONE',?)`,
        providerId, now
      );
      this.sql.exec(
        "UPDATE auth_verification_provider_state SET circuit='half-open',updated_at=? WHERE provider_id=? AND circuit='open' AND cooldown_until<=?",
        now, providerId, now
      );
      return this.#one(
        `SELECT provider_id AS providerId,circuit,consecutive_failures AS consecutiveFailures,
          success_count AS successCount,failure_count AS failureCount,user_error_count AS userErrorCount,
          latency_ewma_ms AS latencyEwmaMs,cooldown_until AS cooldownUntil,
          last_success_at AS lastSuccessAt,last_failure_at AS lastFailureAt,last_reason AS lastReason
         FROM auth_verification_provider_state WHERE provider_id=?`,
        providerId
      );
    });
  }

  async recordProviderResult(input) {
    return this.#transaction(() => {
      const current = this.#one(
        `SELECT provider_id AS providerId,circuit,consecutive_failures AS consecutiveFailures,
          success_count AS successCount,failure_count AS failureCount,user_error_count AS userErrorCount,
          latency_ewma_ms AS latencyEwmaMs,cooldown_until AS cooldownUntil,
          last_success_at AS lastSuccessAt,last_failure_at AS lastFailureAt,last_reason AS lastReason
         FROM auth_verification_provider_state WHERE provider_id=?`,
        input.providerId
      ) || {
        providerId: input.providerId, circuit: 'closed', consecutiveFailures: 0, successCount: 0,
        failureCount: 0, userErrorCount: 0, latencyEwmaMs: 0, cooldownUntil: 0,
        lastSuccessAt: 0, lastFailureAt: 0, lastReason: 'NONE'
      };
      const latency = Math.max(0, Number(input.latencyMs || 0));
      const next = {
        ...current,
        latencyEwmaMs: current.latencyEwmaMs ? Math.round((Number(current.latencyEwmaMs) * 0.8) + (latency * 0.2)) : Math.round(latency),
        lastReason: safeReason(input.reason)
      };
      if (input.success) {
        next.successCount = Number(next.successCount) + 1;
        next.consecutiveFailures = 0;
        next.circuit = 'closed';
        next.cooldownUntil = 0;
        next.lastSuccessAt = input.now;
      } else if (input.failureClass === VERIFICATION_FAILURE_CLASS.USER) {
        next.userErrorCount = Number(next.userErrorCount) + 1;
        // AUTH V2.0 (owner 2026-10-31): a probe that answers USER-class never
        // closes, so the circuit stays half-open forever. The slot is then
        // sorted first on every request as "the probe", and each request pays
        // its full timeout before the healthy providers get a turn — a
        // permanent tax paid for a provider that is merely answering oddly.
        // Reopen it for another cooldown instead: the slot keeps its chance to
        // recover on a later probe, but stops being tried ahead of everyone.
        if (next.circuit === 'half-open') {
          next.circuit = 'open';
          next.cooldownUntil = input.now + input.cooldownMs;
        }
      } else {
        next.failureCount = Number(next.failureCount) + 1;
        next.consecutiveFailures = Number(next.consecutiveFailures) + 1;
        next.lastFailureAt = input.now;
        if (input.failureClass === VERIFICATION_FAILURE_CLASS.HARD || input.forceCooldown === true || next.consecutiveFailures >= input.failureThreshold) {
          next.circuit = 'open';
          next.cooldownUntil = input.now + input.cooldownMs;
        }
      }
      this.sql.exec(
        `INSERT INTO auth_verification_provider_state(
          provider_id,circuit,consecutive_failures,success_count,failure_count,user_error_count,
          latency_ewma_ms,cooldown_until,last_success_at,last_failure_at,last_reason,updated_at
        ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(provider_id) DO UPDATE SET
          circuit=excluded.circuit,consecutive_failures=excluded.consecutive_failures,
          success_count=excluded.success_count,failure_count=excluded.failure_count,
          user_error_count=excluded.user_error_count,latency_ewma_ms=excluded.latency_ewma_ms,
          cooldown_until=excluded.cooldown_until,last_success_at=excluded.last_success_at,
          last_failure_at=excluded.last_failure_at,last_reason=excluded.last_reason,updated_at=excluded.updated_at`,
        input.providerId, next.circuit, next.consecutiveFailures, next.successCount, next.failureCount,
        next.userErrorCount, next.latencyEwmaMs, next.cooldownUntil, next.lastSuccessAt,
        next.lastFailureAt, next.lastReason, input.now
      );
      this.#event({ ...input, outcome: input.success ? 'provider_success' : 'provider_failure' });
      return next;
    });
  }

  async status({ providerIds, now }) {
    const providerStates = [];
    for (const providerId of providerIds) providerStates.push(await this.providerSnapshot({ providerId, now }));
    return {
      providerStates,
      quotas: this.#rows(
        `SELECT provider_id AS providerId,day_start AS dayStart,used,quota_limit AS "limit",reset_at AS resetAt
         FROM auth_verification_daily_quota WHERE reset_at>? ORDER BY provider_id`,
        now
      ),
      recentEvents: this.#rows(
        `SELECT attempt_id AS attemptId,user_id AS userId,subject_ref AS subjectRef,provider_id AS providerId,
          channel,occurred_at AS occurredAt,outcome,reason,latency_ms AS latencyMs
         FROM auth_verification_events ORDER BY occurred_at DESC,event_id DESC LIMIT 100`
      ).reverse()
    };
  }

  async cleanup(now) {
    return this.#transaction(() => {
      this.sql.exec('DELETE FROM auth_verification_challenges WHERE expires_at<=?', now);
      this.sql.exec('DELETE FROM auth_verification_daily_quota WHERE reset_at<=?', now);
      this.sql.exec('DELETE FROM auth_verification_events WHERE occurred_at<?', now - EVENT_RETENTION_MS);
      return { cleaned: true };
    });
  }

  async nextExpiry(now) {
    const row = this.#one(
      `SELECT MIN(expiry) AS nextExpiry FROM (
        SELECT MIN(expires_at) AS expiry FROM auth_verification_challenges WHERE expires_at>?
        UNION ALL SELECT MIN(reset_at) FROM auth_verification_daily_quota WHERE reset_at>?
        UNION ALL SELECT MIN(cooldown_until) FROM auth_verification_provider_state WHERE cooldown_until>?
      )`,
      now, now, now
    );
    const next = Number(row?.nextExpiry || 0);
    return next > now ? next : null;
  }
}
