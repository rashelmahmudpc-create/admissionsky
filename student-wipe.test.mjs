// Fresh Start phase 4: wipe all users but keep OTP config, quota and schema meta.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import { SqliteAuthRepository } from './auth-native/storage/sqlite-auth-repository.mjs';
import { SqliteVerificationRepository } from './auth-native/verification/sqlite-verification-repository.mjs';
import { migrateStudentDirectory } from './auth-native/storage/student-directory-schema.mjs';
import { listWipeTables, wipeAll, wipeConfirmPhrase, wipeCounts, WIPE_KEEP_TABLES } from './auth-native/storage/student-wipe.mjs';

const NOW = 1_800_000_000_000;

function fixture() {
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
  const storage = { sql, transactionSync(work) { return database.transaction(work)(); } };
  new SqliteAuthRepository(storage).migrate();
  new SqliteVerificationRepository(storage).migrate();
  migrateStudentDirectory(storage, { now: NOW });
  return { sql };
}

function seed(sql) {
  for (const id of ['u-a', 'u-b', 'u-c']) {
    sql.exec('INSERT INTO auth_users(user_id,email_ref,email_mask,status,created_at,last_login_at) VALUES(?,?,?,?,?,?)', id, `ref-${id}`, 'x***@gmail.com', 'active', NOW, NOW);
    sql.exec('INSERT INTO auth_external_identities(provider,subject_ref,user_id,created_at,last_verified_at) VALUES(?,?,?,?,?)', 'firebase', `subj-${id}`, id, NOW, NOW);
    sql.exec('INSERT INTO auth_sessions(session_ref,user_id,created_at,expires_at,last_seen_at,revoked_at,ip_ref,device_ref,user_agent) VALUES(?,?,?,?,?,?,?,?,?)', `s-${id}`, id, NOW, NOW + 1, NOW, null, 'ip', 'dev', 'ua');
  }
  sql.exec('INSERT INTO auth_verification_events(attempt_id,user_id,subject_ref,provider_id,channel,occurred_at,outcome,reason,latency_ms) VALUES(?,?,?,?,?,?,?,?,?)', 'att-1', 'u-a', 'subj-u-a', 'otp-a', 'email', NOW, 'sent', 'ACCEPTED', 300);
  sql.exec("INSERT INTO auth_verification_runtime_config(config_key,config_json,updated_at) VALUES('active','{\"enabled\":true}',?)", NOW);
}

test('keep list protects OTP config, quota, provider state and schema meta', () => {
  const { sql } = fixture();
  const tables = listWipeTables(sql);
  for (const kept of WIPE_KEEP_TABLES) assert.equal(tables.includes(kept), false, kept);
  for (const wiped of ['auth_users', 'auth_sessions', 'auth_profiles', 'auth_verification_challenges', 'auth_verification_events']) {
    assert.equal(tables.includes(wiped), true, wiped);
  }
  /* AUTH V2.6: `students` used to be in this list. The table is retired — v2 of
   * the directory migration drops it — so asserting it is wiped asserted that a
   * table which no longer exists is still enumerable. Removed rather than kept
   * as a tautology. */
  assert.equal(tables.includes('students'), false, 'the retired directory table must not come back into the wipe list');
});

test('dry-run counts are exact and the confirm phrase carries the user count', () => {
  const { sql } = fixture();
  seed(sql);
  const counts = wipeCounts(sql);
  assert.equal(counts.users, 3);
  assert.equal(counts.tables.auth_sessions, 3);
  assert.equal(counts.tables.auth_external_identities, 3);
  assert.equal(wipeConfirmPhrase(counts.users), 'WIPE-ALL-3');
});

test('wipe deletes every user row despite foreign keys and keeps the OTP config', () => {
  const { sql } = fixture();
  seed(sql);
  const configBefore = sql.exec('SELECT config_json FROM auth_verification_runtime_config');
  const metaBefore = sql.exec('SELECT key,value FROM auth_meta ORDER BY key');
  const migrationsBefore = sql.exec('SELECT version FROM schema_migrations');
  const outcome = wipeAll(sql);
  assert.equal(outcome.complete, true, JSON.stringify(outcome.failures));
  assert.deepEqual(outcome.remaining, {});
  assert.equal(outcome.deleted.auth_users, 3);
  const after = wipeCounts(sql);
  assert.equal(after.users, 0);
  assert.equal(after.rows, 0);
  assert.deepEqual(sql.exec('SELECT config_json FROM auth_verification_runtime_config'), configBefore);
  assert.deepEqual(sql.exec('SELECT key,value FROM auth_meta ORDER BY key'), metaBefore);
  assert.deepEqual(sql.exec('SELECT version FROM schema_migrations'), migrationsBefore);
});

test('the same email can be stored again after a wipe', () => {
  const { sql } = fixture();
  seed(sql);
  wipeAll(sql);
  sql.exec('INSERT INTO auth_users(user_id,email_ref,email_mask,status,created_at,last_login_at) VALUES(?,?,?,?,?,?)', 'u-new', 'ref-u-a', 'x***@gmail.com', 'active', NOW, NOW);
  assert.equal(wipeCounts(sql).users, 1);
});

test('worker wiring: admin token gate, dry run by default, exact phrase required', () => {
  const handler = readFileSync('auth-native/worker/public-auth-handler.mjs', 'utf8');
  const at = handler.indexOf('/admin/students/wipe`');
  const route = handler.slice(at - 120, at + 900);
  assert.match(route, /adminAuthorized\(request, env\)/);
  assert.match(route, /request\.method === 'POST'|POST/);
  assert.match(route, /dryRun: true/);
  const authority = readFileSync('auth-native/worker/auth-authority-do.mjs', 'utf8');
  const block = authority.slice(authority.indexOf("'/internal/admin/students/wipe'"), authority.indexOf("'/internal/admin/students/wipe'") + 1200);
  assert.match(block, /input\.dryRun !== false/);
  assert.match(block, /wipeConfirmPhrase\(before\.users\)/);
  assert.match(block, /WIPE_CONFIRM_MISMATCH/);
});
