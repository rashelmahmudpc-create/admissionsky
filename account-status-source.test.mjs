/* AUTH V2.1 (owner 2026-10-31): the status check reads the status that is written.
 *
 * The blueprint's finding ১৪. The session read checked `auth_users.status` — a
 * column only ever set at INSERT, always to 'active', and never updated by
 * anything. Suspension is written to `auth_account_state` instead, so
 * `if (row.status !== 'active')` could never fire. Nine guards across the
 * repository read that column.
 *
 * It was not an open hole only because suspension also revokes every live
 * session (#242), so a suspended account had no session left to check. But the
 * guard was decorative, and any future change to the revocation path would have
 * made it a real bypass with nothing to catch it — a guard that cannot fire is
 * worse than no guard, because it reads like protection.
 *
 * These tests drive the real repository against real SQLite. The key assertion
 * forces a session to stay live across a suspension, which is the state the
 * revocation path normally prevents; if the status check itself works, that
 * session is still refused.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';

import { SqliteAuthRepository } from './auth-native/storage/sqlite-auth-repository.mjs';
import { AUTH_ERROR_CODES } from './auth-native/core/errors.mjs';

const START = 1_800_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

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

const withSession = async () => {
  const { repository, database } = fixture();
  await repository.establishExternalSession({
    provider: 'firebase', subjectRef: 'sub-ref-1', emailRef: 'email-ref-1', emailMask: 's***@example.com',
    userIdCandidate: 'usr_status_1', sessionRef: 'session-ref-1', sessionExpiresAt: START + 30 * DAY,
    ipRef: 'ip-ref', deviceRef: 'device-ref', userAgent: 'Chrome', now: START
  });
  return { repository, database };
};

const readSession = repository => repository.getExternalSession({
  sessionRef: 'session-ref-1', provider: 'firebase', subjectRef: 'sub-ref-1', emailRef: 'email-ref-1', now: START
});

test('V2.1-১৪: a suspended account is refused even with a live session', async () => {
  /* The state the revocation path normally prevents. Forcing the session back to
   * life is what isolates the STATUS CHECK from the revocation that usually
   * covers for it: if the check reads the right column, this is refused; if it
   * reads the dead one, it passes. That difference is the whole finding. */
  const { repository, database } = await withSession();
  assert.ok((await readSession(repository)).user, 'the session works before any suspension');

  await repository.setAccountState({ userId: 'usr_status_1', toStatus: 'suspended', now: START + 1000 });
  // Undo the revocation setAccountState performs, so only the status remains.
  database.prepare('UPDATE auth_sessions SET revoked_at=NULL').run();

  const after = await readSession(repository);
  assert.equal(after.user, undefined, 'a suspended account must not be usable');
  assert.equal(after.error, AUTH_ERROR_CODES.ACCOUNT_DISABLED, 'and must say why');
  database.close();
});

test('V2.1-১৪: an account with no state row is active, not missing', async () => {
  /* Every user who has never been suspended has no row in auth_account_state.
   * Reading the state table must not turn them into "not found" — the default
   * has to match getAccountState's own, or the fix would lock out every normal
   * student, which is a far worse bug than the one it repairs. */
  const { repository, database } = await withSession();
  const rows = database.prepare('SELECT COUNT(*) AS n FROM auth_account_state').get();
  assert.equal(rows.n, 0, 'the fixture has no state row, like a real unsuspended user');

  const session = await readSession(repository);
  assert.ok(session.user, 'and the session still works');
  assert.equal(session.user.status, 'active', 'reported as active');
  database.close();
});

test('V2.1-১৪: the disabled path is refused too, not just suspended', async () => {
  // `disabled` and `suspended` are both non-usable; a check that handled only
  // one of them would be half a guard.
  for (const toStatus of ['disabled', 'suspended']) {
    const { repository, database } = await withSession();
    await repository.setAccountState({ userId: 'usr_status_1', toStatus, now: START + 1000 });
    database.prepare('UPDATE auth_sessions SET revoked_at=NULL').run();
    const after = await readSession(repository);
    assert.equal(after.error, AUTH_ERROR_CODES.ACCOUNT_DISABLED, `${toStatus} must be refused`);
    database.close();
  }
});

test('V2.1-১৪: re-enabling an account makes it usable again', async () => {
  /* The guard must track the status, not latch it. A student whose false alarm
   * was cleared by support has to be able to sign in again, and the status is
   * the only thing that decides that. */
  const { repository, database } = await withSession();
  await repository.setAccountState({ userId: 'usr_status_1', toStatus: 'suspended', now: START + 1000 });
  database.prepare('UPDATE auth_sessions SET revoked_at=NULL').run();
  assert.equal((await readSession(repository)).error, AUTH_ERROR_CODES.ACCOUNT_DISABLED);

  await repository.setAccountState({ userId: 'usr_status_1', toStatus: 'active', now: START + 2000 });
  database.prepare('UPDATE auth_sessions SET revoked_at=NULL').run();
  const restored = await readSession(repository);
  assert.ok(restored.user, 'a re-enabled account can use its session again');
  assert.equal(restored.user.status, 'active');
  database.close();
});

test('V2.1-১৪: nothing writes auth_users.status, which is why the old check was dead', async () => {
  /* A source assertion, and the one place it earns its keep: the finding is that
   * a column is never written, and no runtime test can observe an absence of
   * writes as directly. If a later change starts maintaining this column, this
   * fails and the reader learns the column is live again — at which point the
   * COALESCE above can be revisited deliberately rather than by accident. */
  const { readFileSync } = await import('node:fs');
  const source = readFileSync(new URL('./auth-native/storage/sqlite-auth-repository.mjs', import.meta.url), 'utf8');
  const writes = [...source.matchAll(/UPDATE auth_users SET ([^'`]+)/g)].map(m => m[1]);
  const statusWrites = writes.filter(set => /\bstatus\s*=/.test(set));
  assert.deepEqual(statusWrites, [],
    'if this column starts being maintained, the session check should read it directly again');
  // And the check now reads the state table, which IS written.
  assert.match(source, /COALESCE\(st\.status,u\.status\) AS status/);
});
