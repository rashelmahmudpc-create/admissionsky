/* AUTH V2.6 (owner 2026-11-02): the student-directory schema is retired.
 *
 * Fresh Start phase 2 created eight tables on every Durable Object boot, and no
 * production code ever wrote to or read one of them. This file used to test
 * those tables — their constraints, their cascades, their validation. All of
 * that was correct, and all of it was testing code that did nothing.
 *
 * What is left is the part that still matters: the migration MECHANISM (order,
 * idempotence, atomicity, refusal of a malformed list) and the retirement
 * itself (v2 drops the eight tables, `schema_migrations` survives, nothing
 * recreates them on the next boot).
 *
 * The table tests were deleted rather than adapted, because a test of a dropped
 * table has nothing left to assert. Keeping them would have meant keeping the
 * tables. */
import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {
  STUDENT_DIRECTORY_MIGRATIONS,
  STUDENT_DIRECTORY_LATEST_VERSION,
  currentStudentDirectoryVersion,
  migrateStudentDirectory,
  normalizeEmail
} from './auth-native/storage/student-directory-schema.mjs';
import { SqliteAuthRepository } from './auth-native/storage/sqlite-auth-repository.mjs';
import { SqliteVerificationRepository } from './auth-native/verification/sqlite-verification-repository.mjs';

const NOW = 1_800_000_000_000;
// The eight tables v1 created and v2 drops.
const RETIRED_TABLES = ['students', 'login_methods', 'email_verifications', 'otp_attempts', 'sessions', 'devices', 'profiles', 'activity_log'];

// Same shape as the Durable Object storage: sql.exec + transactionSync, with
// foreign keys ON (Durable Object SQLite always enforces them).
function storageFixture() {
  const database = new Database(':memory:');
  database.pragma('foreign_keys = ON');
  const sql = {
    exec(statement, ...bindings) {
      const prepared = database.prepare(statement);
      if (prepared.reader) return prepared.all(...bindings);
      prepared.run(...bindings);
      return [];
    }
  };
  return { database, storage: { sql, transactionSync(work) { return database.transaction(work)(); } } };
}

const tableNames = database => database.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map(row => row.name);

function addStudent(database, id, email, extra = {}) {
  database.prepare('INSERT INTO students (id, email, email_normalized, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, email, normalizeEmail(email), extra.status || 'pending', NOW, NOW);
}

test('V2.6: a fresh database ends with no directory tables at all', () => {
  /* The retirement, asserted from a clean database: v1 creates the eight tables
   * and v2 drops them, so the net result of a full migration is nothing. This
   * is the assertion that would have caught the cost — a fresh Durable Object
   * used to pay eight CREATE TABLE statements on every cold start for tables it
   * would never use. */
  const { database, storage } = storageFixture();
  assert.equal(currentStudentDirectoryVersion(storage), 0);
  const result = migrateStudentDirectory(storage, { now: NOW });
  assert.equal(result.version, STUDENT_DIRECTORY_LATEST_VERSION);
  assert.deepEqual(result.applied, STUDENT_DIRECTORY_MIGRATIONS.map(m => m.version), 'both migrations ran');

  const names = tableNames(database);
  for (const table of RETIRED_TABLES) {
    assert.equal(names.includes(table), false, `${table} must not exist after the full migration`);
  }
  // `schema_migrations` survives: it is what the mechanism reads to decide what
  // to apply, so dropping it would make every future boot re-run v1.
  assert.ok(names.includes('schema_migrations'), 'schema_migrations must survive');
  const row = database.prepare('SELECT version, name, applied_at FROM schema_migrations WHERE version = 2').get();
  assert.deepEqual(row, { version: 2, name: 'retire_unused_student_directory', applied_at: NOW });
});

test('V2.6: a database that already has the tables is cleaned, not left with orphans', () => {
  /* The upgrade path, which is the one production is actually on: a Durable
   * Object that ran v1 before this change already holds the eight tables. v2
   * must drop them there too, and the migration must be recorded so it does not
   * run again. */
  const { database, storage } = storageFixture();
  // Apply v1 only, the way an existing deployment sits today.
  const v1Only = STUDENT_DIRECTORY_MIGRATIONS.filter(m => m.version === 1);
  migrateStudentDirectory(storage, { now: NOW, migrations: v1Only });
  for (const table of RETIRED_TABLES) {
    assert.ok(tableNames(database).includes(table), `precondition: v1 created ${table}`);
  }
  // Now the real list runs, as it will on the next boot.
  const upgraded = migrateStudentDirectory(storage, { now: NOW + 1 });
  assert.deepEqual(upgraded.applied, [2], 'only the retirement was pending');
  for (const table of RETIRED_TABLES) {
    assert.equal(tableNames(database).includes(table), false, `${table} must be dropped on upgrade`);
  }
});

test('V2.6: a second run applies nothing — the retirement is idempotent', () => {
  const { database, storage } = storageFixture();
  migrateStudentDirectory(storage, { now: NOW });
  const again = migrateStudentDirectory(storage, { now: NOW + 1 });
  assert.deepEqual(again.applied, [], 'nothing left to apply');
  assert.equal(database.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get().n, STUDENT_DIRECTORY_MIGRATIONS.length);
  for (const table of RETIRED_TABLES) {
    assert.equal(tableNames(database).includes(table), false, `${table} must stay dropped`);
  }
});

test('existing auth tables with old data keep working next to the migration', () => {
  const { database, storage } = storageFixture();
  const auth = new SqliteAuthRepository(storage);
  auth.migrate();
  const verification = new SqliteVerificationRepository(storage);
  verification.migrate();
  const before = tableNames(database).filter(name => name.startsWith('auth_')).sort();
  database.prepare('INSERT INTO auth_meta (key, value) VALUES (?, ?)').run('legacy-marker', 'kept');
  migrateStudentDirectory(storage, { now: NOW });
  const after = tableNames(database).filter(name => name.startsWith('auth_')).sort();
  assert.deepEqual(after, before, 'no auth_* table may be added, dropped or renamed');
  assert.equal(database.prepare('SELECT value FROM auth_meta WHERE key = ?').get('legacy-marker').value, 'kept');
  // The auth migrations still run cleanly afterwards (every Durable Object start).
  auth.migrate();
  verification.migrate();
  migrateStudentDirectory(storage, { now: NOW + 5 });
});

test('normalizeEmail trims and lowercases but keeps plus aliases and dots', () => {
  assert.equal(normalizeEmail('  RashelMahmudPC+OtpTest1017@Gmail.COM '), 'rashelmahmudpc+otptest1017@gmail.com');
  assert.equal(normalizeEmail('first.last@gmail.com'), 'first.last@gmail.com');
  assert.equal(normalizeEmail('ＡＢＣ@example.com'), 'abc@example.com');
  for (const bad of ['', 'no-at', '@example.com', 'a@', 'a@@b.com', 'a b@c.com', null, undefined]) assert.equal(normalizeEmail(bad), '', String(bad));
});

test('V2.6: the retirement drops every table v1 created, and nothing else', () => {
  /* A drop list is the one place a mistake is unrecoverable, so it is asserted
   * as an exact set rather than sampled: a table added to v1 later and missed
   * here would survive forever, and a table that is NOT in v1 must never appear
   * — dropping `auth_sessions` would destroy live student sessions. */
  const v2 = STUDENT_DIRECTORY_MIGRATIONS.find(m => m.version === 2);
  assert.ok(v2, 'the retirement migration exists');
  const dropped = v2.statements
    .map(st => String(st).match(/^DROP TABLE IF EXISTS (\w+)$/)?.[1])
    .filter(Boolean)
    .sort();
  assert.deepEqual(dropped, [...RETIRED_TABLES].sort(), 'exactly the eight tables v1 created');

  const v1 = STUDENT_DIRECTORY_MIGRATIONS.find(m => m.version === 1);
  const created = v1.statements
    .map(st => String(st).match(/CREATE TABLE IF NOT EXISTS (\w+)/)?.[1])
    .filter(Boolean)
    .sort();
  assert.deepEqual(dropped, created,
    'every table v1 creates must be dropped by v2 — a new v1 table would otherwise survive forever');
});

test('a failed migration rolls back completely and can be retried', () => {
  const { database, storage } = storageFixture();
  migrateStudentDirectory(storage, { now: NOW });
  const broken = [...STUDENT_DIRECTORY_MIGRATIONS, { version: 99, name: 'broken', statements: ['CREATE TABLE half_done (id INTEGER)', 'THIS IS NOT SQL'] }];
  assert.throws(() => migrateStudentDirectory(storage, { now: NOW, migrations: broken }));
  assert.equal(tableNames(database).includes('half_done'), false);
  assert.equal(currentStudentDirectoryVersion(storage), STUDENT_DIRECTORY_LATEST_VERSION);
  assert.throws(() => migrateStudentDirectory(storage, { migrations: [{ version: 2, name: 'b', statements: [] }, { version: 2, name: 'c', statements: [] }] }), /strictly increasing/);
});
