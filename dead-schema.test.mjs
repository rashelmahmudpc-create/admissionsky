/* AUTH V2.4 (owner 2026-10-31): the dead schema is named, and stays named.
 *
 * The blueprint's finding ১৩: the student-directory schema creates eight tables
 * — students, login_methods, email_verifications, otp_attempts, devices,
 * sessions, profiles, activity_log — on every Durable Object boot, and no
 * production code writes or reads a single one of them.
 *
 * It is dead, and it is not harmless:
 *
 *   • it runs on every cold start, so it is a real cost paid forever;
 *   • it makes the schema lie. A reader — human or agent — sees `sessions` and
 *     reasonably concludes that is where sessions live, when they live in
 *     `auth_sessions` under a different repository. The blueprint's word for
 *     this is "মৃত স্কিমা ভুল বোঝায়" — a dead schema misleads.
 *
 * This change does NOT delete the tables. Dropping schema is destructive, it is
 * V2.6's job in the blueprint's own ordering, and it needs the owner's decision
 * because a rollback would be a restore rather than a revert. What it does is
 * make the claim checkable: the day someone writes to one of these tables, this
 * fails and says so — either the table is alive and should be kept, or the write
 * was a mistake. Either way the ambiguity ends.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const ROOT = new URL('./', import.meta.url);
const SCHEMA = readFileSync(new URL('./auth-native/storage/student-directory-schema.mjs', import.meta.url), 'utf8');

/* The tables the schema creates, read from the source rather than listed by hand
 * — a hand-written list is what this finding is about.
 *
 * `schema_migrations` is excluded, and it is the one that is NOT dead: the
 * migration reads it on every boot to decide what to apply. Including it would
 * make this test assert something false about live code. */
const declaredTables = () => [...SCHEMA.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)]
  .map(match => match[1])
  .filter(name => name !== 'schema_migrations');

/* Every .mjs under auth-native, minus the schema file itself and the tests. */
const sourceFiles = () => {
  const walk = dir => readdirSync(dir).flatMap(name => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return walk(full);
    return full.endsWith('.mjs') ? [full] : [];
  });
  return walk(new URL('./auth-native/', import.meta.url).pathname);
};

test('V2.4-১৩: the schema still declares the eight tables the finding names', () => {
  // Pinned so the finding cannot quietly stop being true — if V2.6 removes them,
  // this fails and the reader learns the tables were dealt with.
  assert.deepEqual(declaredTables().sort(), [
    'activity_log', 'devices', 'email_verifications', 'login_methods',
    'otp_attempts', 'profiles', 'sessions', 'students'
  ]);
});

test('V2.4-১৩: no production file writes or reads any of them', () => {
  /* The claim, checked rather than trusted. Each table is searched for across
   * the whole auth runtime; the schema file and its own tests are excluded
   * because they are where the tables are DEFINED, not used. */
  const files = sourceFiles().filter(file => !file.includes('student-directory-schema.mjs'));
  const haystack = files.map(file => ({ file, text: readFileSync(file, 'utf8') }));
  const used = [];
  for (const table of declaredTables()) {
    const pattern = new RegExp(`\\b(?:INSERT INTO|UPDATE|DELETE FROM|FROM)\\s+${table}\\b`);
    for (const { file, text } of haystack) {
      if (pattern.test(text)) used.push(`${table} in ${relative(ROOT.pathname, file).split(sep).join('/')}`);
    }
  }
  assert.deepEqual(used, [],
    'a student-directory table is now used in production — either keep it deliberately (and update this test) or remove the write');
});

test('V2.6: the migration no longer runs on boot, which was the cost', () => {
  /* This test used to assert the opposite — that the migration DID run on every
   * cold start — and it was right to: "unused code" and "unused code that runs
   * on every boot" call for different urgency, and the second is the one worth
   * fixing. V2.6 fixed it, so the assertion flips rather than disappearing.
   *
   * Kept as an assertion at all because the failure it guards is silent in the
   * other direction too: someone re-adding the call would pay the cost again
   * with nothing to notice it. */
  const doSource = readFileSync(new URL('./auth-native/worker/auth-authority-do.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(doSource, /migrateStudentDirectory\(state\.storage\)/,
    'the dead schema must not run on boot again');
  // The tables it created are dropped by a v2 migration, so a database that
  // already has them is cleaned rather than left holding orphans.
  const schema = readFileSync(new URL('./auth-native/storage/student-directory-schema.mjs', import.meta.url), 'utf8');
  assert.match(schema, /version: 2,[\s\S]*?DROP TABLE IF EXISTS students/,
    'v2 drops the tables v1 created');
  for (const table of ['students', 'login_methods', 'email_verifications', 'otp_attempts', 'devices', 'sessions', 'profiles', 'activity_log']) {
    assert.match(schema, new RegExp(`DROP TABLE IF EXISTS ${table}\\b`), `v2 drops ${table}`);
  }
  // `schema_migrations` must survive: it is what the mechanism reads to decide
  // what to apply, so dropping it would make every boot re-run v1.
  assert.doesNotMatch(schema, /DROP TABLE IF EXISTS schema_migrations/,
    'dropping schema_migrations would make every boot recreate everything');
});

test('V2.4-১৩: the live session table is a different name, which is why this misleads', () => {
  /* The concrete confusion the finding describes. If these ever became the same
   * table, the dead schema would stop being dead — and this test would be the
   * place that says so. */
  const live = readFileSync(new URL('./auth-native/storage/sqlite-auth-repository.mjs', import.meta.url), 'utf8');
  assert.match(live, /CREATE TABLE IF NOT EXISTS auth_sessions/, 'sessions live in auth_sessions');
  assert.doesNotMatch(live, /CREATE TABLE IF NOT EXISTS sessions\b/, 'and not in the dead `sessions` table');
});
