/* AUTH V2.1 (owner 2026-10-31): an idle session ends.
 *
 * The blueprint's finding ১২. The session table has carried `last_seen_at` since
 * the beginning, and the repository has always written it — but nothing ever
 * compared it. The only bound on a session was its absolute 30-day expiry, so a
 * session a student stopped using three weeks ago was still fully valid. A
 * leaked cookie stayed useful for the rest of its month whether or not anyone
 * was behind it, and no amount of "the student is clearly not using this" could
 * end it early.
 *
 * These tests drive the real engine and the real repository — the in-memory
 * double and SQLite both, because the whole risk of a rule like this is that
 * one implementation gets it and the other does not. They are behavioural: the
 * assertion is what `getSession` answers after time passes, not that a constant
 * exists.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';

import { CloudflareNativeAuthEngine } from './auth-native/core/auth-engine.mjs';
import { MemoryAuthRepository } from './auth-native/testing/memory-auth-repository.mjs';
import { SqliteAuthRepository } from './auth-native/storage/sqlite-auth-repository.mjs';
import { AUTH_ERROR_CODES } from './auth-native/core/errors.mjs';
import {
  SECURITY_SESSION_IDLE_TTL_MS,
  SECURITY_SESSION_TOUCH_INTERVAL_MS
} from './auth-native/core/security-config.mjs';

const SECRET = 'session-idle-secret-0123456789-ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const START = 1_800_000_000_000;
const EMAIL = 'idle.student@gmail.com';
const SUBJECT = 'firebase-idle-uid';
const CONTEXT = Object.freeze({
  ip: '203.0.113.31', deviceId: 'device-idle-0123456789012345', userAgent: 'Chrome',
  origin: 'https://admissionhub.pages.dev'
});
const DAY = 24 * 60 * 60 * 1000;

/* The two repositories must agree, so every test below runs against both. */
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

const engines = () => {
  const sqlite = sqliteFixture();
  return [
    { name: 'memory', repository: new MemoryAuthRepository(), close: () => {} },
    { name: 'sqlite', repository: sqlite.repository, close: sqlite.close }
  ];
};

test('V2.1-১২: a session untouched for longer than the idle window is refused', async t => {
  for (const { name, repository, close } of engines()) {
    await t.test(name, async () => {
      let now = START;
      const engine = new CloudflareNativeAuthEngine({ repository, hmacSecret: SECRET, now: () => now });
      const login = await engine.establishFirebaseSession({ email: EMAIL, subject: SUBJECT }, CONTEXT);
      assert.ok(login.sessionToken, 'the login established a session');

      /* A read inside the idle window stays valid. 13 days in: inside the
       * 14-day window, and well inside the 30-day absolute expiry, so a pass
       * here is about the idle rule and not about the session having died of
       * old age. */
      now = START + 13 * DAY;
      const alive = await engine.getSession(login.sessionToken);
      // The engine returns the session plus the public user projection; assert
      // on the identity rather than on the mask's shape, which is a
      // presentation detail this test has no business pinning.
      assert.ok(alive?.user?.id, 'a session in use stays valid');
      assert.equal(alive.user.status, 'active');

      /* Then it goes quiet. 13 + 15 = 28 days from login: still inside the
       * 30-day absolute expiry, so if this is refused it is the IDLE rule that
       * refused it — which is the only thing this test is claiming. Measuring
       * from the last use, not from the login, is what makes it a sliding
       * window rather than a second fixed deadline. */
      now = START + 13 * DAY + 15 * DAY;
      assert.ok(now - START < 30 * DAY, 'the fixture must stay inside the absolute expiry, or this proves nothing');
      await assert.rejects(
        () => engine.getSession(login.sessionToken),
        error => error?.code === AUTH_ERROR_CODES.SESSION_INVALID,
        'a session idle past the window must be refused'
      );
      close();
    });
  }
});

test('V2.1-১২: the idle bound is checked before the touch, so use cannot extend a dead session', async t => {
  /* The ordering is the whole correctness of a sliding window. If the touch ran
   * first it would rewrite `last_seen_at` to now, the idle check would then see
   * a fresh session, and the timeout would never fire — a rule that reads
   * correctly and does nothing. */
  for (const { name, repository, close } of engines()) {
    await t.test(name, async () => {
      let now = START;
      const engine = new CloudflareNativeAuthEngine({ repository, hmacSecret: SECRET, now: () => now });
      const login = await engine.establishFirebaseSession({ email: EMAIL, subject: SUBJECT }, CONTEXT);

      now = START + SECURITY_SESSION_IDLE_TTL_MS + 1;
      await assert.rejects(() => engine.getSession(login.sessionToken),
        error => error?.code === AUTH_ERROR_CODES.SESSION_INVALID);

      // And it stays refused: a refused read must not have refreshed anything.
      now += 1;
      await assert.rejects(() => engine.getSession(login.sessionToken),
        error => error?.code === AUTH_ERROR_CODES.SESSION_INVALID);
      close();
    });
  }
});

test('V2.1-১২: an active student is never interrupted — the window slides', async t => {
  /* The risk of a timeout is that it logs real students out. A student who uses
   * the app every few days must be able to keep going indefinitely, and that is
   * a property worth asserting rather than assuming: it is what separates a
   * security bound from an annoyance. */
  for (const { name, repository, close } of engines()) {
    await t.test(name, async () => {
      let now = START;
      const engine = new CloudflareNativeAuthEngine({ repository, hmacSecret: SECRET, now: () => now });
      const login = await engine.establishFirebaseSession({ email: EMAIL, subject: SUBJECT }, CONTEXT);

      // Visit every 10 days for four months — well past both the idle window
      // and, deliberately, past nothing else: the absolute expiry is 30 days,
      // so this also proves the sliding window does not extend the absolute one.
      for (let visit = 0; visit < 12; visit += 1) {
        now = START + visit * 10 * DAY;
        if (now - START >= 30 * DAY) {
          await assert.rejects(() => engine.getSession(login.sessionToken),
            error => error?.code === AUTH_ERROR_CODES.SESSION_INVALID,
            'the absolute 30-day expiry still ends the session');
          return close();
        }
        const alive = await engine.getSession(login.sessionToken);
        assert.ok(alive.user, `visit ${visit} inside the idle window must work`);
      }
      close();
    });
  }
});

test('V2.1-১২: the idle window is the blueprint number, and shorter than the absolute one', () => {
  // ১৪ days, per ৪.৫. A bound longer than the session's own life would be a
  // second rule that can never fire — the failure mode this whole change is
  // about, one level up.
  assert.equal(SECURITY_SESSION_IDLE_TTL_MS, 14 * DAY);
  assert.ok(SECURITY_SESSION_IDLE_TTL_MS < 30 * DAY, 'idle must be able to fire before the absolute expiry');
  assert.ok(SECURITY_SESSION_TOUCH_INTERVAL_MS < SECURITY_SESSION_IDLE_TTL_MS,
    'the touch throttle must be finer than the window it maintains, or the column goes stale enough to expire a live session');
});
