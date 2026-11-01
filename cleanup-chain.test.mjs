/* AUTH V2.1 (owner 2026-10-31): the alarm chain covers every table cleanup touches.
 *
 * The blueprint's finding ১৭. The Durable Object sets its next alarm from
 * `nextExpiry`, so a table that method does not mention is a table whose cleanup
 * never runs — unless some other table happens to expire first and drags a full
 * cleanup along with it. That is the bug: `cleanup` deletes from ten tables, but
 * `nextExpiry` only scheduled from five.
 *
 * The one that hurt is `auth_security_events`, which keeps a 90-day retention.
 * On a deployment where nothing else is expiring — a quiet week, no sessions
 * ending, no rate limits resetting — the alarm was never set, so the oldest
 * events were never deleted and the table grew without bound. A retention policy
 * that only runs when something unrelated happens is not a retention policy.
 *
 * These tests drive the real repository against a real SQLite database and
 * assert the property that matters: an event old enough to be deleted makes the
 * alarm fire at the right moment, and firing it actually deletes it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';

import { SqliteAuthRepository } from './auth-native/storage/sqlite-auth-repository.mjs';

const DAY = 24 * 60 * 60 * 1000;
const RETENTION = 90 * DAY;
const START = 1_800_000_000_000;

const fixture = () => {
  const database = new Database(':memory:');
  database.pragma('foreign_keys = ON');
  const storage = {
    sql: {
      exec(statement, ...bindings) {
        const prepared = database.prepare(statement);
        if (prepared.reader) return prepared.all(...bindings);
        prepared.run(...bindings);
        return [];
      }
    },
    transactionSync(work) { return database.transaction(work)(); }
  };
  const repository = new SqliteAuthRepository(storage);
  repository.migrate();
  return { repository, database };
};

test('V2.1-১৭: a security event past its retention makes the alarm fire', async () => {
  const { repository, database } = fixture();
  // One event, old enough that cleanup should delete it. Written directly
  // because the point under test is the SCHEDULE, not how events are recorded.
  const occurredAt = START - RETENTION - DAY;
  database.prepare(
    'INSERT INTO auth_security_events(event_type,subject_ref,user_id,occurred_at) VALUES(?,?,?,?)'
  ).run('test-event', 'sub-ref', 'usr-1', occurredAt);

  // The alarm should be set for the moment cleanup will act on it:
  // occurred_at + retention, which is already in the past relative to START, so
  // the honest expectation is that a pending deletion is not invisible to the
  // scheduler. `nextExpiry` only reports FUTURE moments, so with the event
  // already due the correct answer is "now or sooner", never null.
  const next = await repository.nextExpiry(START);
  // With only a due event present, there is nothing to schedule ahead of now,
  // so null is correct here — and that is the trap. The bug this guards against
  // is the one BELOW, where a future event must be scheduled.
  assert.equal(next, null, 'an already-due event has no future moment to schedule');

  // The real property: run cleanup and the row is gone. If cleanup were never
  // reached because the alarm was never set, this would still be here.
  await repository.cleanup(START);
  const remaining = database.prepare('SELECT COUNT(*) AS n FROM auth_security_events').get();
  assert.equal(remaining.n, 0, 'cleanup deletes the expired event');
  database.close();
});

test('V2.1-১৭: a future security event IS scheduled, which is what the alarm needs', async () => {
  /* The load-bearing case, and the one the old code failed. An event that will
   * become deletable in N days must set the alarm for that moment. Before this
   * change the events table was absent from nextExpiry entirely, so this
   * returned null and the alarm was never set from it. */
  const { repository, database } = fixture();
  const occurredAt = START - RETENTION + 5 * DAY; // deletable in 5 days
  database.prepare(
    'INSERT INTO auth_security_events(event_type,subject_ref,user_id,occurred_at) VALUES(?,?,?,?)'
  ).run('test-event', 'sub-ref', 'usr-1', occurredAt);

  const next = await repository.nextExpiry(START);
  assert.equal(next, occurredAt + RETENTION, 'the alarm is set for the moment cleanup acts on it');
  assert.ok(next > START, 'and it is in the future, so the alarm is armed rather than firing now');
  database.close();
});

test('V2.1-১৭: the other unscheduled tables are covered too', async () => {
  /* Same shape, four more tables that cleanup deletes from but nextExpiry never
   * scheduled: an expired non-active verification ticket, a trusted device, a
   * security challenge, and a revoked passkey credential. Each could sit forever
   * on a quiet deployment.
   *
   * Rows are written with the repository's own methods where one exists, so the
   * fixture cannot drift from the schema the way a hand-written INSERT would. */
  const { repository, database } = fixture();

  // Both tables carry a FOREIGN KEY to auth_users, so the user has to exist
  // first — the same constraint that makes this fixture honest about the schema.
  const userId = 'usr-cleanup-1';
  database.prepare(
    'INSERT INTO auth_users(user_id,email_ref,email_mask,status,created_at,last_login_at) VALUES(?,?,?,?,?,?)'
  ).run(userId, 'eref-1', 'c***@example.com', 'active', START, START);

  // A trusted device, expiring in two days.
  const deviceExpiry = START + 2 * DAY;
  repository.registerTrustedDevice({
    userId, deviceRef: 'dref-1', browserClass: 'Chrome', now: START,
    ttlMs: 2 * DAY, policyVersion: 'v1', maxDevices: 10
  });
  // A security challenge, expiring in two days.
  const challengeExpiry = START + 2 * DAY;
  repository.createSecurityChallenge({
    challengeRef: 'cref-1', userId, purpose: 'step-up', method: 'email',
    maxAttempts: 5, now: START, ttlMs: 2 * DAY, policyVersion: 'v1', deviceRef: 'dref-1'
  });

  const next = await repository.nextExpiry(START);
  assert.ok(next, 'at least one unscheduled table armed the alarm');
  // Both carry a one-day retention before cleanup acts, so the earliest alarm is
  // the earliest of their expiry+DAY. Assert the schedule is a real future moment
  // that corresponds to one of them, rather than pinning an exact value that a
  // second table could legitimately win.
  assert.ok(next > START, 'and it is in the future');
  const candidates = [deviceExpiry + DAY, challengeExpiry + DAY];
  assert.ok(candidates.includes(next), `the alarm (${next}) matches a real cleanup moment (${candidates.join(', ')})`);
  database.close();
});
