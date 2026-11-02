// Fresh Start phase 2 (2026-10-17): versioned schema for the student directory.
//
// Lives in the same Durable Object SQLite as the auth_* tables
// (AUTH_AUTHORITY / AdmissionAuthAuthority). It is purely ADDITIVE: it creates
// new tables only, never alters or reads the auth_* / auth_verification_*
// tables, so old data keeps working untouched. Old data is NOT migrated in;
// the directory starts empty and is filled from the Fresh Start onward.
//
// Rules:
//   - Every change is a NEW entry in MIGRATIONS with the next version number.
//     Never edit an applied migration.
//   - Each migration runs inside one transaction together with its
//     schema_migrations row, so it is applied fully or not at all.
//   - No secrets live here: no passwords, no OTP codes, no session tokens.

export const STUDENT_LOGIN_METHODS = Object.freeze(['password', 'google', 'facebook', 'telegram', 'passkey']);
export const EMAIL_VERIFICATION_CHANNELS = Object.freeze(['otp', 'firebase-link', 'telegram', 'oauth']);
export const OTP_OUTCOMES = Object.freeze(['sent', 'failed', 'timeout', 'verified', 'wrong_code', 'expired', 'skipped']);

const list = values => values.map(value => `'${value}'`).join(', ');

export const STUDENT_DIRECTORY_MIGRATIONS = Object.freeze([
  Object.freeze({
    version: 1,
    name: 'student_directory_v1',
    statements: Object.freeze([
      `CREATE TABLE IF NOT EXISTS students (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL,
        email_normalized TEXT NOT NULL UNIQUE
          CHECK (email_normalized = lower(trim(email_normalized))
            AND length(email_normalized) BETWEEN 3 AND 254
            AND instr(email_normalized, '@') > 1),
        auth_user_id TEXT UNIQUE,
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'disabled')),
        email_verified_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        last_login_at INTEGER
      )`,
      'CREATE INDEX IF NOT EXISTS idx_students_created ON students (created_at)',
      'CREATE INDEX IF NOT EXISTS idx_students_status ON students (status, created_at)',

      `CREATE TABLE IF NOT EXISTS login_methods (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        student_id TEXT NOT NULL REFERENCES students (id) ON DELETE CASCADE,
        method TEXT NOT NULL CHECK (method IN (${list(STUDENT_LOGIN_METHODS)})),
        provider_subject TEXT NOT NULL DEFAULT '',
        label TEXT,
        created_at INTEGER NOT NULL,
        last_used_at INTEGER,
        UNIQUE (student_id, method, provider_subject)
      )`,
      // One Google/Facebook/Telegram/passkey identity belongs to one student.
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_login_methods_subject
        ON login_methods (method, provider_subject) WHERE provider_subject <> ''`,

      `CREATE TABLE IF NOT EXISTS email_verifications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        student_id TEXT NOT NULL REFERENCES students (id) ON DELETE CASCADE,
        email_normalized TEXT NOT NULL,
        channel TEXT NOT NULL CHECK (channel IN (${list(EMAIL_VERIFICATION_CHANNELS)})),
        provider_id TEXT,
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'verified', 'failed', 'expired')),
        created_at INTEGER NOT NULL,
        verified_at INTEGER
      )`,
      'CREATE INDEX IF NOT EXISTS idx_email_verifications_student ON email_verifications (student_id, created_at)',

      `CREATE TABLE IF NOT EXISTS otp_attempts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        student_id TEXT NOT NULL REFERENCES students (id) ON DELETE CASCADE,
        email_verification_id INTEGER REFERENCES email_verifications (id) ON DELETE SET NULL,
        provider_id TEXT NOT NULL,
        outcome TEXT NOT NULL CHECK (outcome IN (${list(OTP_OUTCOMES)})),
        error_code TEXT,
        latency_ms INTEGER CHECK (latency_ms IS NULL OR latency_ms >= 0),
        created_at INTEGER NOT NULL
      )`,
      'CREATE INDEX IF NOT EXISTS idx_otp_attempts_student ON otp_attempts (student_id, created_at)',
      'CREATE INDEX IF NOT EXISTS idx_otp_attempts_provider ON otp_attempts (provider_id, created_at)',

      `CREATE TABLE IF NOT EXISTS devices (
        id TEXT PRIMARY KEY,
        student_id TEXT NOT NULL REFERENCES students (id) ON DELETE CASCADE,
        device_hash TEXT NOT NULL,
        label TEXT,
        platform TEXT,
        browser TEXT,
        trusted INTEGER NOT NULL DEFAULT 0 CHECK (trusted IN (0, 1)),
        first_seen_at INTEGER NOT NULL,
        last_seen_at INTEGER NOT NULL,
        UNIQUE (student_id, device_hash)
      )`,

      // id is an opaque reference (e.g. a hash of the auth session id), never
      // the bearer token itself.
      `CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        student_id TEXT NOT NULL REFERENCES students (id) ON DELETE CASCADE,
        device_id TEXT REFERENCES devices (id) ON DELETE SET NULL,
        login_method TEXT CHECK (login_method IS NULL OR login_method IN (${list(STUDENT_LOGIN_METHODS)})),
        created_at INTEGER NOT NULL,
        last_seen_at INTEGER NOT NULL,
        expires_at INTEGER,
        revoked_at INTEGER
      )`,
      'CREATE INDEX IF NOT EXISTS idx_sessions_student ON sessions (student_id, created_at)',

      `CREATE TABLE IF NOT EXISTS profiles (
        student_id TEXT PRIMARY KEY REFERENCES students (id) ON DELETE CASCADE,
        full_name TEXT,
        dob TEXT,
        school TEXT,
        college TEXT,
        hsc_year INTEGER,
        avatar_key TEXT,
        updated_at INTEGER NOT NULL
      )`,

      `CREATE TABLE IF NOT EXISTS activity_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        student_id TEXT NOT NULL REFERENCES students (id) ON DELETE CASCADE,
        kind TEXT NOT NULL CHECK (length(kind) BETWEEN 1 AND 64),
        detail_json TEXT CHECK (detail_json IS NULL OR json_valid(detail_json)),
        created_at INTEGER NOT NULL
      )`,
      'CREATE INDEX IF NOT EXISTS idx_activity_log_student ON activity_log (student_id, created_at)'
    ])
  }),
  /* AUTH V2.6 (owner 2026-11-02): retire the eight tables v1 created.
   *
   * The blueprint's finding ১৩: they are created on every Durable Object boot
   * and no production code writes or reads one of them. That is a real cost
   * paid on every cold start, and worse, it makes the schema lie — a reader
   * sees `sessions` and concludes that is where sessions live, when they live
   * in `auth_sessions` under a different repository.
   *
   * A NEW migration rather than an edit to v1, because v1 has already been
   * applied in production and the rule at the top of this file is that an
   * applied migration is never edited. Dropping here is also what makes this
   * reversible in the right direction: the tables come back by reverting this
   * commit, and any database that already ran v1 loses nothing it was using.
   *
   * `schema_migrations` is deliberately NOT dropped — it is the table this
   * migration mechanism reads to decide what to apply, so dropping it would
   * make every future boot re-run v1 and recreate everything. */
  Object.freeze({
    version: 2,
    name: 'retire_unused_student_directory',
    statements: Object.freeze([
      'DROP TABLE IF EXISTS activity_log',
      'DROP TABLE IF EXISTS profiles',
      'DROP TABLE IF EXISTS sessions',
      'DROP TABLE IF EXISTS devices',
      'DROP TABLE IF EXISTS otp_attempts',
      'DROP TABLE IF EXISTS email_verifications',
      'DROP TABLE IF EXISTS login_methods',
      'DROP TABLE IF EXISTS students'
    ])
  })
]);

export const STUDENT_DIRECTORY_LATEST_VERSION = STUDENT_DIRECTORY_MIGRATIONS.at(-1).version;

// trim + Unicode NFKC + lowercase. Plus-aliases and Gmail dots are kept on
// purpose: a+x@gmail.com is a different sign-up than a@gmail.com.
export function normalizeEmail(raw) {
  const value = String(raw ?? '').normalize('NFKC').trim().toLowerCase();
  if (value.length < 3 || value.length > 254) return '';
  const at = value.indexOf('@');
  if (at < 1 || at !== value.lastIndexOf('@') || at === value.length - 1) return '';
  if (/\s/.test(value)) return '';
  return value;
}

const rows = (sql, statement, ...bindings) => {
  const result = sql.exec(statement, ...bindings);
  if (Array.isArray(result)) return result;
  return typeof result?.toArray === 'function' ? result.toArray() : [];
};

const transaction = (storage, work) => (typeof storage.transactionSync === 'function' ? storage.transactionSync(work) : work());

export function currentStudentDirectoryVersion(storage) {
  const sql = storage.sql;
  const table = rows(sql, "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'");
  if (!table.length) return 0;
  const [row] = rows(sql, 'SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations');
  return Number(row?.version || 0);
}

// Applies every pending migration in order. Safe to call on every Durable
// Object start: already-applied versions are skipped.
export function migrateStudentDirectory(storage, { now = Date.now(), migrations = STUDENT_DIRECTORY_MIGRATIONS } = {}) {
  if (!storage?.sql || typeof storage.sql.exec !== 'function') throw new TypeError('SQLite Durable Object storage is required.');
  const sql = storage.sql;
  sql.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at INTEGER NOT NULL
  )`);
  const applied = new Set(rows(sql, 'SELECT version FROM schema_migrations').map(row => Number(row.version)));
  const ran = [];
  let previous = 0;
  for (const migration of migrations) {
    if (!Number.isInteger(migration.version) || migration.version <= previous) throw new Error('student directory migrations must have strictly increasing integer versions');
    previous = migration.version;
    if (applied.has(migration.version)) continue;
    transaction(storage, () => {
      for (const statement of migration.statements) sql.exec(statement);
      sql.exec('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)', migration.version, migration.name, Number(now));
    });
    ran.push(migration.version);
  }
  return { version: currentStudentDirectoryVersion(storage), applied: ran };
}
