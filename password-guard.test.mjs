import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PASSWORD_GUARD_SCALES,
  guardDecision,
  recordPasswordFailure,
  recordPasswordSuccess,
  normalizeGuardState,
  passwordGuardKey,
  passwordFailuresSoFar,
  createKvPasswordGuard
} from './auth-native/core/password-guard.mjs';

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const user = PASSWORD_GUARD_SCALES.user;
const admin = PASSWORD_GUARD_SCALES.admin;
const T0 = 1_000_000_000_000;

const failTimes = (state, times, start = T0, scale = user) => {
  let current = state;
  let decision;
  for (let i = 0; i < times; i += 1) {
    const result = recordPasswordFailure(current, start + i * 1000, scale);
    current = result.state;
    decision = result.decision;
  }
  return { state: current, decision };
};

test('user scale: the first four wrong passwords cost nothing', () => {
  for (const count of [1, 2, 3, 4]) {
    const { decision } = failTimes(null, count);
    assert.equal(decision.blocked, false, `${count} failures must not block`);
    assert.equal(decision.attemptsRemaining, 5 - count);
  }
});

test('user scale: the fifth wrong password costs thirty minutes', () => {
  const { decision } = failTimes(null, 5);
  assert.equal(decision.blocked, true);
  assert.equal(decision.retryAfterMs, 30 * MINUTE);
  assert.equal(decision.strikes, 1);
});

test('user scale: five more cost five hours, then five more cost a day', () => {
  const first = failTimes(null, 5);
  const second = failTimes(first.state, 5, first.state.until + 1000);
  assert.equal(second.decision.retryAfterMs, 5 * HOUR);
  assert.equal(second.decision.strikes, 2);

  const third = failTimes(second.state, 5, second.state.until + 1000);
  assert.equal(third.decision.retryAfterMs, 1 * DAY);
  assert.equal(third.decision.strikes, 3);

  const fourth = failTimes(third.state, 5, third.state.until + 1000);
  assert.equal(fourth.decision.retryAfterMs, 1 * DAY, 'the ladder has a ceiling');
});

test('user scale: a student typing slowly is never blocked', () => {
  // A typo every twenty minutes - outside the fifteen-minute window - stays a
  // single failure forever, and the fifth-in-a-window rule never fires.
  let state = null;
  let now = T0;
  for (let i = 0; i < 20; i += 1) {
    state = recordPasswordFailure(state, now, user).state;
    now += 20 * MINUTE;
    assert.equal(guardDecision(state, now, user).blocked, false);
  }
  assert.equal(state.fails, 1, 'each typo fell outside the fifteen-minute window');
});

test('user scale: a burst of typos inside the window is what counts', () => {
  // Three typos in three minutes is one failure short of the block; a fourth
  // and fifth inside the same window reach it. That is the intended shape:
  // the count measures a burst, not a person's memory.
  const four = failTimes(null, 4, T0);
  assert.equal(four.decision.blocked, false);
  assert.equal(four.decision.attemptsRemaining, 1);
  const five = failTimes(null, 5, T0);
  assert.equal(five.decision.blocked, true);
});

test('admin scale: every wrong password escalates 5m, 7h, 2d, 7d', () => {
  let state = null;
  let now = T0;
  for (const duration of [5 * MINUTE, 7 * HOUR, 2 * DAY, 7 * DAY, 7 * DAY]) {
    const result = recordPasswordFailure(state, now, admin);
    state = result.state;
    assert.equal(result.decision.retryAfterMs, duration);
    now += duration + 1000;
  }
});

test('a wrong password during a block does not extend it', () => {
  const first = recordPasswordFailure(null, T0, admin);
  const during = recordPasswordFailure(first.state, T0 + 1000, admin);
  assert.equal(during.escalated, false);
  assert.equal(during.decision.retryAfterMs, 5 * MINUTE - 1000, 'the clock is not pushed back');
});

test('a correct password during a block clears nothing', () => {
  const blocked = recordPasswordFailure(null, T0, admin).state;
  const after = recordPasswordSuccess(blocked, T0 + 1000, admin);
  assert.equal(after.until, blocked.until, 'the block survives a correct guess');
  assert.equal(guardDecision(after, T0 + 1000, admin).blocked, true);
});

test('a correct password outside a block resets the ladder', () => {
  const blocked = failTimes(null, 5).state;
  const cleared = recordPasswordSuccess(blocked, blocked.until + 1000, user);
  assert.equal(cleared.strikes, 0);
  assert.equal(cleared.fails, 0);
});

test('a malformed stored record fails closed to the empty state', () => {
  assert.deepEqual(normalizeGuardState('not json'), { fails: 0, windowStartedAt: 0, strikes: 0, until: 0, lastAt: 0 });
  assert.deepEqual(normalizeGuardState({ fails: -5, until: 'x' }), { fails: 0, windowStartedAt: 0, strikes: 0, until: 0, lastAt: 0 });
  assert.equal(guardDecision(null, Date.now(), admin).blocked, false);
});

test('the counter is keyed on the ip+email pair, not the email alone', () => {
  const attacker = passwordGuardKey('Student@Example.com ', '203.0.113.7');
  const student = passwordGuardKey('student@example.com', '198.51.100.9');
  assert.notEqual(attacker, student, 'the same address from another ip is another key');
  assert.equal(attacker, passwordGuardKey('student@example.com', '203.0.113.7'), 'case and padding do not split the key');
});

test('an attacker cannot lock a student out from another address', async () => {
  const store = new Map();
  const kv = {
    async get(key) {
      return store.has(key) ? store.get(key) : null;
    },
    async put(key, value) {
      store.set(key, value);
    }
  };
  let now = T0;
  const guard = createKvPasswordGuard(kv, { now: () => now });

  const attacker = passwordGuardKey('student@example.com', '203.0.113.7');
  const student = passwordGuardKey('student@example.com', '198.51.100.9');

  for (let i = 0; i < 5; i += 1) await guard.recordFailure(attacker, user);
  assert.equal((await guard.check(attacker, user)).blocked, true, 'the attacker address is blocked');
  assert.equal((await guard.check(student, user)).blocked, false, 'the real student is not');

  now += 30 * MINUTE + 1000;
  await guard.recordSuccess(attacker, user);
  assert.equal((await guard.check(attacker, user)).blocked, false, 'the recovery path lifts the block');
});

// --- the count the risk engine needs ------------------------------------------

test('the failures-so-far count survives a strike, which resets only the window', () => {
  // The guard reports strikes (blocks served) and fails (guesses inside the
  // current window) separately, and `fails` resets at each strike. The risk
  // engine wants total attempts, so the two are recombined.
  assert.equal(passwordFailuresSoFar({ strikes: 0, fails: 3 }), 3);
  assert.equal(passwordFailuresSoFar({ strikes: 1, fails: 0 }), 5);
  assert.equal(passwordFailuresSoFar({ strikes: 2, fails: 4 }), 14);
});

test('a missing decision counts as no failures', () => {
  assert.equal(passwordFailuresSoFar(null), 0);
  assert.equal(passwordFailuresSoFar(undefined), 0);
  assert.equal(passwordFailuresSoFar({}), 0);
});

test('the count reaches the level the shadow guard treats as high', () => {
  // 8+ wrong guesses is the engine's high threshold; two served strikes plus
  // three guesses is 13, so the guard can act on what the counter knows.
  assert.ok(passwordFailuresSoFar({ strikes: 2, fails: 3 }) >= 8);
});

