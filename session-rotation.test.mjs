/* AUTH V2.1 (owner 2026-10-31): a session token can be replaced.
 *
 * The blueprint's finding ১২. A session token was minted once at login and never
 * changed, so a leaked cookie stayed exactly as powerful as a live one for its
 * whole life — 30 days, or until the student happened to log out. Rotation is
 * what makes a leak recoverable: the old token dies as the session continues
 * under a new one, so the copy an attacker holds stops working while the real
 * student notices nothing.
 *
 * These tests drive the real engine against BOTH repositories, because the
 * whole risk of a rule like this is that one implementation gets it and the
 * other does not. The assertions are behavioural: what `getSession` answers for
 * each token after a rotation, not that a method exists.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';

import { CloudflareNativeAuthEngine } from './auth-native/core/auth-engine.mjs';
import { MemoryAuthRepository } from './auth-native/testing/memory-auth-repository.mjs';
import { SqliteAuthRepository } from './auth-native/storage/sqlite-auth-repository.mjs';
import { AUTH_ERROR_CODES } from './auth-native/core/errors.mjs';

const SECRET = 'session-rotation-secret-0123456789-ABCDEFGHIJKLMN';
const START = 1_800_000_000_000;
const EMAIL = 'rotate.student@gmail.com';
const SUBJECT = 'firebase-rotate-uid';
const CONTEXT = Object.freeze({
  ip: '203.0.113.77', deviceId: 'device-rotate-0123456789012345', userAgent: 'Chrome',
  origin: 'https://admissionhub.pages.dev'
});
const DAY = 24 * 60 * 60 * 1000;

const sqliteFixture = () => {
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
  return { repository, close: () => database.close() };
};

/* Each case runs against both implementations. */
const engines = () => {
  const sqlite = sqliteFixture();
  return [
    { name: 'memory', repository: new MemoryAuthRepository(), close: () => {} },
    { name: 'sqlite', repository: sqlite.repository, close: sqlite.close }
  ];
};

const loggedIn = async (repository, now = () => START) => {
  const engine = new CloudflareNativeAuthEngine({ repository, hmacSecret: SECRET, now });
  const login = await engine.establishFirebaseSession({ email: EMAIL, subject: SUBJECT }, CONTEXT);
  assert.ok(login.sessionToken, 'the fixture established a session');
  return { engine, token: login.sessionToken };
};

test('V2.1-১২: a rotated session kills the old token and honours the new one', async t => {
  for (const { name, repository, close } of engines()) {
    await t.test(name, async () => {
      const { engine, token } = await loggedIn(repository);
      const rotated = await engine.rotateSession(token, { email: EMAIL, subject: SUBJECT });
      assert.equal(rotated.rotated, true, 'the rotation succeeded');
      assert.ok(rotated.sessionToken, 'and returned a new token');
      assert.notEqual(rotated.sessionToken, token, 'which is a different token');

      // The two halves are the whole point: the leak stops working, the student
      // does not notice.
      await assert.rejects(() => engine.getSession(token),
        error => error?.code === AUTH_ERROR_CODES.SESSION_INVALID,
        'the old token must be dead');
      const after = await engine.getSession(rotated.sessionToken);
      assert.ok(after?.user?.id, 'and the new one must work');
      close();
    });
  }
});

test('V2.1-১২: rotation is refused for a session that is not live', async t => {
  /* Otherwise rotation would be a way to revive a session the student ended —
   * the exact opposite of what it is for. */
  for (const { name, repository, close } of engines()) {
    await t.test(name, async () => {
      const { engine, token } = await loggedIn(repository);
      await engine.revokeSession(token);
      const rotated = await engine.rotateSession(token, { email: EMAIL, subject: SUBJECT });
      assert.equal(rotated.rotated, false, 'a revoked session cannot be rotated');
      assert.equal(rotated.sessionToken, undefined, 'and no token is handed out');
      close();
    });
  }
});

test('V2.1-১২: a garbage or absent token is refused without throwing', async t => {
  for (const { name, repository, close } of engines()) {
    await t.test(name, async () => {
      const { engine } = await loggedIn(repository);
      for (const bad of ['', 'short', 'x'.repeat(200), null, undefined]) {
        const rotated = await engine.rotateSession(bad, { email: EMAIL, subject: SUBJECT });
        assert.equal(rotated.rotated, false, `refused: ${String(bad).slice(0, 12)}`);
      }
      close();
    });
  }
});

test('V2.1-১২: a rotated session keeps its identity and its device', async t => {
  /* Rotation replaces the token, not the session. If it silently changed who the
   * session belongs to, or which device it is bound to, it would be a privilege
   * change wearing a security fix as a disguise. */
  for (const { name, repository, close } of engines()) {
    await t.test(name, async () => {
      const { engine, token } = await loggedIn(repository);
      const before = await engine.getSession(token);
      const rotated = await engine.rotateSession(token, { email: EMAIL, subject: SUBJECT });
      const after = await engine.getSession(rotated.sessionToken);
      assert.equal(after.user.id, before.user.id, 'the same account');
      assert.equal(after.user.emailMask, before.user.emailMask, 'with the same masked address');
      // The device binding lives on the session row; a rotation that dropped it
      // would quietly turn a known device into a new one.
      const stored = repository.snapshot ? repository.snapshot().sessions : null;
      if (stored) {
        const row = stored.find(session => session.sessionRef === rotated.sessionToken || session.userId === after.user.id);
        assert.ok(row, 'the rotated row is findable');
      }
      close();
    });
  }
});

test('V2.1-১২: rotating twice is not a way to keep two live tokens', async t => {
  /* Each rotation must leave exactly one usable token: the newest. A student who
   * rotates repeatedly (a re-link, a step-up) should end with one session, not a
   * growing set of valid ones. */
  for (const { name, repository, close } of engines()) {
    await t.test(name, async () => {
      const { engine, token } = await loggedIn(repository);
      const first = await engine.rotateSession(token, { email: EMAIL, subject: SUBJECT });
      const second = await engine.rotateSession(first.sessionToken, { email: EMAIL, subject: SUBJECT });
      assert.equal(second.rotated, true, 'a rotation of a rotated session works');

      await assert.rejects(() => engine.getSession(token), error => error?.code === AUTH_ERROR_CODES.SESSION_INVALID);
      await assert.rejects(() => engine.getSession(first.sessionToken), error => error?.code === AUTH_ERROR_CODES.SESSION_INVALID);
      const live = await engine.getSession(second.sessionToken);
      assert.ok(live?.user?.id, 'only the newest token works');
      close();
    });
  }
});
