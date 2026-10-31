/* A5 / AUTH-ROADMAP step 6 (owner 2026-10-31): a known device skips the OTP for
 * 30 days.
 *
 * The 30-day fast path itself was already built (Phase 6): a device that has
 * completed the new-device challenge is registered as trusted, and a later
 * login from it takes the trusted branch instead of being challenged again.
 * What this suite pins is the part that was missing, and it was missing in the
 * one place where it matters most.
 *
 * "সব device থেকে Log Out" revoked sessions and left device trust alone. A
 * student taps that button when their phone is stolen — it is the only thing
 * the account card offers them. With the trust rows still live, the stolen
 * phone came back through the trusted fast path for the rest of the 30 days and
 * was never challenged: the button did the opposite of what it says. Sessions
 * and trust are one decision, so they now end together.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { CloudflareNativeAuthEngine } from './auth-native/core/auth-engine.mjs';
import { MemoryAuthRepository } from './auth-native/testing/memory-auth-repository.mjs';
import { SECURITY_CONFIG } from './auth-native/core/security-config.mjs';

const SECRET = 'device-trust-step6-secret-0123456789-ABCDEFGHIJKLMNOPQ';
const DAY_MS = 24 * 60 * 60 * 1000;

const setup = (start = 1_800_000_000_000) => {
  let now = start;
  const repository = new MemoryAuthRepository();
  const engine = new CloudflareNativeAuthEngine({ repository, hmacSecret: SECRET, now: () => now });
  const context = { ip: '203.0.113.9', deviceId: 'device-step6-primary-0123456', userAgent: 'Mozilla/5.0 Chrome/140', origin: 'https://admissionsky.pages.dev' };
  return { repository, engine, context, now: () => now, advance: ms => { now += ms; } };
};

const login = (state, context = state.context) => state.engine.establishFirebaseSession(
  { email: 'step6@example.com', subject: 'uid-step6', verified: true, newDevice: true, securityChallenge: true },
  context
);
// A session without the challenge gate, which is how the trust prompt is
// actually reached: the student has already signed in on this device once.
const sessionOn = (state, context = state.context) => state.engine.establishFirebaseSession(
  { email: 'step6@example.com', subject: 'uid-step6', verified: true, newDevice: true, securityChallenge: false },
  context
);
const trust = (state, session, context = state.context) => state.engine.trustCurrentDevice(
  { sessionToken: session.sessionToken, email: 'step6@example.com', subject: 'uid-step6' }, context
);
const liveTrust = state => state.repository.snapshot().trustedDevices.filter(row => !row.revokedAt && row.expiresAt > state.now()).length;

test('A6-১: finishing the new-device challenge earns 30 days of trust', async () => {
  // The single consent moment: the student proves the device once, and the
  // prompt never comes back on that device for the trust window.
  const state = setup();
  const first = await login(state);
  assert.equal(first.challenge?.type, 'new-device');
  assert.equal(first.sessionToken, undefined, 'a challenged login must not hand out a session');

  const begun = await state.engine.beginFirebaseAccountVerification(
    { email: 'step6@example.com', subject: 'uid-step6', refreshToken: 'r'.repeat(40), purpose: 'new-device' }, state.context
  );
  const done = await state.engine.completeFirebaseAccountVerification(
    { verificationTicket: begun.verificationTicket, email: 'step6@example.com', subject: 'uid-step6' }, state.context
  );
  assert.ok(done.sessionToken, 'completing the challenge issues the session');
  assert.equal(done.trusted, true);
  assert.equal(liveTrust(state), 1);
  assert.equal(
    state.repository.snapshot().trustedDevices[0].expiresAt - state.now(),
    SECURITY_CONFIG.trustTtlMs,
    'trust lasts the configured 30 days'
  );
});

test('A6-২: a trusted device logs in without a second challenge', async () => {
  const state = setup();
  const session = await sessionOn(state);
  await trust(state, session);
  const again = await login(state);
  assert.equal(again.challenge, undefined, 'the trusted fast path is the whole point of step 6');
  assert.equal(again.security.trusted, true);
  assert.ok(again.sessionToken);
});

test('A6-৩: "সব device থেকে Log Out" ends the trust as well as the sessions', async () => {
  /* The security fix this step carries. A student logs out everywhere because
   * their phone was stolen; that phone must stop being trusted, or it keeps
   * skipping the OTP for the rest of the window. */
  const state = setup();
  const session = await sessionOn(state);
  await trust(state, session);
  assert.equal(liveTrust(state), 1);

  const out = await state.engine.revokeAllSessions(
    { sessionToken: session.sessionToken, email: 'step6@example.com', subject: 'uid-step6' }, state.context
  );
  assert.equal(out.devicesRevoked, 1, 'the answer must report the trust it ended, not just the sessions');
  assert.equal(liveTrust(state), 0);
  const after = await login(state);
  assert.equal(after.challenge?.type, 'new-device', 'the stolen device must be challenged again, not waved through');
});

test('A6-৪: trust expires on its own after 30 days', async () => {
  const state = setup();
  const session = await sessionOn(state);
  await trust(state, session);

  state.advance(SECURITY_CONFIG.trustTtlMs - 1);
  assert.equal((await login(state)).challenge, undefined, 'still trusted one millisecond before expiry');

  state.advance(2);
  assert.equal((await login(state)).challenge?.type, 'new-device', 'and challenged again once the window closes');
});

test('A6-৫: a CRITICAL account state still blocks, trust never outranks it', async () => {
  // Trust is a convenience, never an authority: a suspended account cannot log
  // in from a device it trusted a minute ago.
  const state = setup();
  const session = await sessionOn(state);
  await trust(state, session);
  const userId = state.repository.snapshot().users[0].id;
  await state.repository.setAccountState({ userId, toStatus: 'suspended', now: state.now() });
  await assert.rejects(
    () => login(state),
    error => error?.code === 'ACCOUNT_DISABLED'
  );
});

test('A6-৬: the client tells the student the trust was ended too', async () => {
  /* The message is the only feedback the button gives. Saying "sessions ended"
   * while trust silently survives is how the hole stayed invisible. */
  const CLIENT = readFileSync(new URL('./account-access.js', import.meta.url), 'utf8');
  assert.match(CLIENT, /result\.devicesRevoked/);
  assert.match(CLIENT, /trusted device বাতিল/);
});

test('A6-৭: the step is recorded on the roadmap with what it deliberately did not add', async () => {
  const ROADMAP = readFileSync(new URL('./docs/AUTH-ROADMAP.md', import.meta.url), 'utf8');
  assert.match(ROADMAP, /### ধাপ ৬: চেনা device এ ৩০ দিন OTP লাগবে না/);
  assert.match(ROADMAP, /devicesRevoked|trust বাতিল/);
});
