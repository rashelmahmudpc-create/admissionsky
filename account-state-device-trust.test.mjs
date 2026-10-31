/* AUTH V2.0 (owner 2026-10-31): disabling or suspending an account must end
 * device trust, not just sessions.
 *
 * Step 6 fixed "সব device থেকে Log Out", which revoked sessions and left the
 * trust rows behind — so the stolen phone kept skipping the OTP. The same
 * adjacent-state bug lived on a second path nobody had looked at: an admin
 * disabling or suspending an account.
 *
 * `setAccountState` revoked sessions and stopped there. Trust is exactly what
 * lets a device skip the OTP, so the sequence that mattered was: an account is
 * disabled, later re-enabled, and the device that caused the trouble walks back
 * in unchallenged for the rest of its 30-day window. Re-enabling is a normal
 * thing to do — support does it after a false alarm — so the rows have to be
 * gone by then, and the only moment that can be guaranteed is the disable.
 *
 * The two repositories are kept in step here because the memory double is what
 * every one of these suites runs against; a fix that lived only in the SQLite
 * repository would pass its own tests and change nothing in production.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { CloudflareNativeAuthEngine } from './auth-native/core/auth-engine.mjs';
import { MemoryAuthRepository } from './auth-native/testing/memory-auth-repository.mjs';

const SECRET = 'account-state-device-trust-secret-0123456789-ABCDEFG';
const DAY_MS = 24 * 60 * 60 * 1000;

const setup = (start = 1_800_000_000_000) => {
  let now = start;
  const repository = new MemoryAuthRepository();
  const engine = new CloudflareNativeAuthEngine({ repository, hmacSecret: SECRET, now: () => now });
  const context = {
    ip: '203.0.113.9',
    deviceId: 'device-account-state-0123456789',
    userAgent: 'Mozilla/5.0 Chrome/140',
    origin: 'https://admissionsky.pages.dev'
  };
  return { repository, engine, context, now: () => now, advance: ms => { now += ms; } };
};

// A session without the challenge gate, which is how a returning student signs
// in: the device is already known, so there is nothing to challenge.
const sessionOn = (state, context = state.context) => state.engine.establishFirebaseSession(
  { email: 'state@example.com', subject: 'uid-state', verified: true, newDevice: true, securityChallenge: false },
  context
);
const trust = (state, session, context = state.context) => state.engine.trustCurrentDevice(
  { sessionToken: session.sessionToken, email: 'state@example.com', subject: 'uid-state' }, context
);
const liveTrust = state => state.repository.snapshot().trustedDevices
  .filter(row => !row.revokedAt && row.expiresAt > state.now()).length;
const userIdOf = state => state.repository.snapshot().users[0].id;

test('V2.0-১: suspending an account ends its device trust too', async () => {
  const state = setup();
  const session = await sessionOn(state);
  await trust(state, session);
  assert.equal(liveTrust(state), 1, 'the device is trusted before the account is touched');

  const suspended = await state.repository.setAccountState({
    userId: userIdOf(state), toStatus: 'suspended', now: state.now()
  });
  assert.equal(suspended.changed, true);
  assert.equal(liveTrust(state), 0, 'a state that cannot sign in must not leave a device that can skip the OTP');
});

test('V2.0-২: the device is challenged again after the account is re-enabled', async () => {
  /* The scenario the fix exists for. Re-enabling is routine — support does it
   * after a false alarm — so the trust has to be gone by the time it happens. */
  const state = setup();
  const session = await sessionOn(state);
  await trust(state, session);
  const userId = userIdOf(state);

  await state.repository.setAccountState({ userId, toStatus: 'suspended', now: state.now() });
  state.advance(DAY_MS);
  await state.repository.setAccountState({ userId, toStatus: 'active', now: state.now() });

  const after = await state.engine.establishFirebaseSession(
    { email: 'state@example.com', subject: 'uid-state', verified: true, newDevice: true, securityChallenge: true },
    state.context
  );
  assert.equal(after.challenge?.type, 'new-device',
    'the device that got the account disabled must prove itself again, not walk in on old trust');
});

test('V2.0-৩: disabling revokes trust, and the revocation is recorded', async () => {
  const state = setup();
  const session = await sessionOn(state);
  await trust(state, session);
  await state.repository.setAccountState({ userId: userIdOf(state), toStatus: 'disabled', now: state.now() });

  const events = state.repository.snapshot().events.map(event => event.type);
  assert.ok(events.includes('device-revoked'), 'the audit trail must show the trust ended');
  assert.ok(events.includes('account-sessions-revoked'), 'and that the sessions went with it');
});

test('V2.0-৪: an account state that can still sign in leaves trust alone', async () => {
  /* The guard against over-reach: only states that cannot sign in may end
   * trust. A state change that keeps the account usable must not log anyone
   * out of a device they trust. */
  const state = setup();
  const session = await sessionOn(state);
  await trust(state, session);

  const same = await state.repository.setAccountState({
    userId: userIdOf(state), toStatus: 'active', now: state.now()
  });
  assert.equal(same.changed, false, 'active to active is not a change');
  assert.equal(liveTrust(state), 1, 'nothing to revoke, so nothing was revoked');
});

test('V2.0-৫: the SQLite repository carries the same rule as the memory double', async () => {
  /* These suites run against the memory double, so a fix that lived only there
   * would look green and change nothing in production. Read the real repository
   * and require the trust revocation to be present in setAccountState. */
  const { readFileSync } = await import('node:fs');
  const source = readFileSync(new URL('./auth-native/storage/sqlite-auth-repository.mjs', import.meta.url), 'utf8');
  const start = source.indexOf('async setAccountState(');
  assert.ok(start > -1, 'the repository still has setAccountState');
  const body = source.slice(start, source.indexOf('\n  async ', start + 10));
  assert.match(body, /auth_trusted_devices SET revoked_at/,
    'setAccountState must revoke trusted devices when the state cannot sign in');
  assert.match(body, /isSessionUsable\(target\)/,
    'and must do it on the same branch that decides the sessions cannot be used');
});
