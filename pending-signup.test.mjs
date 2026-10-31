// AUTH-ROADMAP step 1: signup is held until the email OTP is proven.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AUTH_ERROR_CODES } from './auth-native/core/errors.mjs';
import { VerificationOrchestrator } from './auth-native/verification/orchestrator.mjs';
import { MemoryVerificationRepository } from './auth-native/verification/memory-verification-repository.mjs';
import { VERIFICATION_CHANNELS, VERIFICATION_FAILURE_CLASS, VERIFICATION_MODES, VerificationProviderError } from './auth-native/verification/provider-contract.mjs';
import {
  PENDING_SIGNUP_TTL_MS, PendingSignupStore, isPendingSignupTicket, requestPendingSignupCode, verifyPendingSignupCode
} from './auth-native/worker/pending-signup.mjs';

const SECRET = 'pending-signup-secret-0123456789-ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const context = Object.freeze({ ip: '203.0.113.9', deviceId: 'device-pending-signup-0123456789', userAgent: 'Chrome', origin: 'https://admissionsky.pages.dev' });
const EMAIL = 'new.student@gmail.com';
const PASSWORD = 'Strong-Pass-123';

class MemoryKv {
  constructor() { this.map = new Map(); }
  async get(key) { return this.map.has(key) ? structuredClone(this.map.get(key)) : undefined; }
  async put(key, value) { this.map.set(key, structuredClone(value)); }
  async delete(key) { for (const k of Array.isArray(key) ? key : [key]) this.map.delete(k); }
  async list({ prefix = '' } = {}) { return new Map([...this.map].filter(([k]) => k.startsWith(prefix)).map(([k, v]) => [k, structuredClone(v)])); }
}

class MockProvider {
  constructor({ id, verificationMode = VERIFICATION_MODES.LOCAL_CODE, sendPlan = [], verifyPlan = [] }) {
    Object.assign(this, { id, channel: VERIFICATION_CHANNELS.OTP, verificationMode, sendPlan: [...sendPlan], verifyPlan: [...verifyPlan], sends: [], verifies: [] });
  }
  async checkAvailability() { return { available: true, code: 'READY' }; }
  async getRemainingQuota() { return { remaining: 100, limit: 100, resetAt: 1_900_000_000_000 }; }
  async getProviderStatus() { return { status: 'healthy', configured: true }; }
  async sendVerification(input) {
    this.sends.push(input);
    const next = this.sendPlan.shift() || 'success';
    if (next === 'hard') throw new VerificationProviderError('HARD_DOWN', VERIFICATION_FAILURE_CLASS.HARD);
    if (next === 'user') throw new VerificationProviderError('INVALID_DESTINATION', VERIFICATION_FAILURE_CLASS.USER);
    return { accepted: true };
  }
  async verifyCode(input) { this.verifies.push(input); return { verified: this.verifyPlan.shift() !== false }; }
}

const setup = (providers) => {
  let now = 1_800_000_000_000;
  const events = [];
  const orchestrator = new VerificationOrchestrator({
    repository: new MemoryVerificationRepository(),
    hmacSecret: SECRET,
    config: { enabled: true, policy: {}, providers: providers.map((p, i) => ({ id: p.id, enabled: true, priority: (i + 1) * 10, dailyQuota: 100, timeoutMs: 1000 })) },
    providers,
    activated: true,
    now: () => now,
    onDeliveryEvent: event => events.push(event)
  });
  const storage = new MemoryKv();
  const store = new PendingSignupStore({ storage, hmacSecret: SECRET, now: () => now });
  return { orchestrator, store, storage, events, advance: ms => { now += ms; } };
};

const rejectsWith = (promise, code) => assert.rejects(promise, error => error?.code === code);

test('signup is only held: ticket is opaque, password is encrypted, nothing readable is stored', async () => {
  const { store, storage } = setup([new MockProvider({ id: 'otp-a' })]);
  const begun = await store.begin({ email: EMAIL, password: PASSWORD, profile: { fullName: 'রিয়া' }, context });
  assert.ok(isPendingSignupTicket(begun.verificationTicket));
  assert.equal(begun.expiresAt, 1_800_000_000_000 + PENDING_SIGNUP_TTL_MS);
  const dump = JSON.stringify([...storage.map]);
  assert.ok(!dump.includes(PASSWORD) && !dump.includes(EMAIL) && !dump.includes(begun.verificationTicket.slice(2)));
  const material = await store.material(begun.verificationTicket, context);
  assert.equal(material.email, EMAIL);
  assert.equal(material.password, PASSWORD);
  assert.equal(material.profile.fullName, 'রিয়া');
});

test('a correct local code releases the credentials; a wrong one never does', async () => {
  const provider = new MockProvider({ id: 'otp-a' });
  const { store, orchestrator, events } = setup([provider]);
  const { verificationTicket: ticket } = await store.begin({ email: EMAIL, password: PASSWORD, context });
  const sent = await requestPendingSignupCode({ store, orchestrator, ticket, context, recipientName: 'রিয়া' });
  assert.equal(sent.accepted, true);
  assert.equal(provider.sends[0].destination, EMAIL);
  assert.ok(events.some(e => e.evt === 'otp_delivery' && e.purpose === 'signup' && e.outcome === 'accepted'));
  const wrong = provider.sends[0].code === '000000' ? '111111' : '000000';
  await rejectsWith(verifyPendingSignupCode({ store, orchestrator, ticket, context, attemptId: sent.attemptId, code: wrong }), AUTH_ERROR_CODES.OTP_INVALID);
  const ok = await verifyPendingSignupCode({ store, orchestrator, ticket, context, attemptId: sent.attemptId, code: provider.sends[0].code });
  assert.equal(ok.verified, true);
  assert.equal(ok.email, EMAIL);
  assert.equal(ok.password, PASSWORD);
  await store.consume(ticket, context);
  await rejectsWith(store.material(ticket, context), AUTH_ERROR_CODES.TELEGRAM_VERIFICATION_INVALID);
});

test('provider-evidence slots (Logto) verify the code at the provider', async () => {
  const provider = new MockProvider({ id: 'otp-h', verificationMode: VERIFICATION_MODES.PROVIDER_EVIDENCE, verifyPlan: [false, true] });
  const { store, orchestrator } = setup([provider]);
  const { verificationTicket: ticket } = await store.begin({ email: EMAIL, password: PASSWORD, context });
  const sent = await requestPendingSignupCode({ store, orchestrator, ticket, context });
  await rejectsWith(verifyPendingSignupCode({ store, orchestrator, ticket, context, attemptId: sent.attemptId, code: '123456' }), AUTH_ERROR_CODES.OTP_INVALID);
  const ok = await verifyPendingSignupCode({ store, orchestrator, ticket, context, attemptId: sent.attemptId, code: '654321' });
  assert.equal(ok.verified, true);
  assert.equal(provider.verifies.length, 2);
});

test('a failing provider falls through to the next; all failing is BACKUP_UNAVAILABLE', async () => {
  const first = new MockProvider({ id: 'otp-a', sendPlan: ['hard'] });
  const second = new MockProvider({ id: 'otp-b' });
  const { store, orchestrator } = setup([first, second]);
  const { verificationTicket: ticket } = await store.begin({ email: EMAIL, password: PASSWORD, context });
  const sent = await requestPendingSignupCode({ store, orchestrator, ticket, context });
  assert.equal(sent.accepted, true);
  assert.equal(second.sends.length, 1);

  const dead = setup([new MockProvider({ id: 'otp-a', sendPlan: ['hard'] })]);
  const begun = await dead.store.begin({ email: EMAIL, password: PASSWORD, context });
  await rejectsWith(requestPendingSignupCode({ store: dead.store, orchestrator: dead.orchestrator, ticket: begun.verificationTicket, context }), AUTH_ERROR_CODES.BACKUP_UNAVAILABLE);
});

test('wrong codes lock the attempt; resend waits for the cooldown', async () => {
  const provider = new MockProvider({ id: 'otp-a' });
  const { store, orchestrator, advance } = setup([provider]);
  const { verificationTicket: ticket } = await store.begin({ email: EMAIL, password: PASSWORD, context });
  const sent = await requestPendingSignupCode({ store, orchestrator, ticket, context });
  await rejectsWith(requestPendingSignupCode({ store, orchestrator, ticket, context }), AUTH_ERROR_CODES.RESEND_COOLDOWN);
  const wrong = provider.sends[0].code === '000000' ? '111111' : '000000';
  const max = orchestrator.config.policy.maxAttempts;
  for (let i = 1; i < max; i += 1) {
    await rejectsWith(verifyPendingSignupCode({ store, orchestrator, ticket, context, attemptId: sent.attemptId, code: wrong }), AUTH_ERROR_CODES.OTP_INVALID);
  }
  await rejectsWith(verifyPendingSignupCode({ store, orchestrator, ticket, context, attemptId: sent.attemptId, code: wrong }), AUTH_ERROR_CODES.OTP_LOCKED);
  await rejectsWith(verifyPendingSignupCode({ store, orchestrator, ticket, context, attemptId: sent.attemptId, code: provider.sends[0].code }), AUTH_ERROR_CODES.OTP_LOCKED);
  advance(orchestrator.config.policy.resendCooldownSeconds * 1000 + 1);
  const again = await requestPendingSignupCode({ store, orchestrator, ticket, context });
  const ok = await verifyPendingSignupCode({ store, orchestrator, ticket, context, attemptId: again.attemptId, code: provider.sends[1].code });
  assert.equal(ok.verified, true);
});

test('an abandoned signup expires after 10 minutes and cleanup removes it', async () => {
  const { store, storage, advance } = setup([new MockProvider({ id: 'otp-a' })]);
  const { verificationTicket: ticket, expiresAt } = await store.begin({ email: EMAIL, password: PASSWORD, context });
  assert.equal(await store.nextExpiry(), expiresAt);
  advance(PENDING_SIGNUP_TTL_MS + 1);
  await store.cleanup();
  assert.equal([...storage.map.keys()].filter(k => k.startsWith('psu:rec:') || k.startsWith('psu:email:')).length, 0);
  await rejectsWith(store.material(ticket, context), AUTH_ERROR_CODES.TELEGRAM_VERIFICATION_INVALID);
  assert.equal(await store.nextExpiry(), null);
});

test('ticket is bound to the device, a fresh signup replaces the old one, and begin is rate limited', async () => {
  const { store } = setup([new MockProvider({ id: 'otp-a' })]);
  const first = await store.begin({ email: EMAIL, password: PASSWORD, context });
  await rejectsWith(store.material(first.verificationTicket, { ...context, deviceId: 'another-device-0123456789' }), AUTH_ERROR_CODES.TELEGRAM_VERIFICATION_INVALID);
  const second = await store.begin({ email: EMAIL, password: PASSWORD, context });
  await rejectsWith(store.material(first.verificationTicket, context), AUTH_ERROR_CODES.TELEGRAM_VERIFICATION_INVALID);
  assert.equal((await store.material(second.verificationTicket, context)).email, EMAIL);
  for (let i = 0; i < 3; i += 1) await store.begin({ email: EMAIL, password: PASSWORD, context });
  await rejectsWith(store.begin({ email: EMAIL, password: PASSWORD, context }), AUTH_ERROR_CODES.RATE_LIMITED);
  await rejectsWith(store.begin({ email: 'x@gmail.com', password: 'short', context }), AUTH_ERROR_CODES.WEAK_PASSWORD);
});

test('pending-signup source has no console.* and never touches Firebase', () => {
  const source = readFileSync(new URL('./auth-native/worker/pending-signup.mjs', import.meta.url), 'utf8');
  assert.ok(!/console\./.test(source));
  assert.ok(!/signUp\(|firebase-auth/.test(source));
});

/* A4 / AU-OB-02 (owner 2026-10-31): the signup path keeps its own candidate
   list, so it has to name the slots it passed over for the same reason the
   backup path does — otherwise a slow signup code is just as unexplained. */
test('a signup that lands on a later slot names the faster slots it passed over', async () => {
  const outOfQuota = new MockProvider({ id: 'otp-a' });
  outOfQuota.getRemainingQuota = async () => ({ remaining: 0, limit: 100, resetAt: 1_900_000_000_000 });
  const working = new MockProvider({ id: 'otp-b' });
  const { store, orchestrator, events } = setup([outOfQuota, working]);
  const { verificationTicket: ticket } = await store.begin({ email: EMAIL, password: PASSWORD, context });

  const sent = await requestPendingSignupCode({ store, orchestrator, ticket, context, recipientName: 'রিয়া' });
  assert.equal(sent.accepted, true);
  assert.equal(working.sends.length, 1);
  assert.equal(outOfQuota.sends.length, 0);

  const request = events.find(event => event.evt === 'otp_request' && event.purpose === 'signup');
  assert.equal(request.candidates, 1);
  assert.equal(request.skipped, 'otp-a:provider-quota', 'the log says why the first slot was passed over');
  assert.equal(request.provider, 'otp-b');
});
