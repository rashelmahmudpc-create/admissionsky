import test from 'node:test';
import assert from 'node:assert/strict';
import { AUTH_ERROR_CODES } from './auth-native/core/errors.mjs';
import { VerificationOrchestrator } from './auth-native/verification/orchestrator.mjs';
import { MemoryVerificationRepository } from './auth-native/verification/memory-verification-repository.mjs';
import {
  VERIFICATION_CHANNELS,
  VERIFICATION_FAILURE_CLASS,
  VERIFICATION_MODES,
  VerificationProviderError
} from './auth-native/verification/provider-contract.mjs';

const SECRET = 'verification-orchestrator-secret-0123456789-ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const DAY_MS = 86_400_000;
const identity = Object.freeze({
  sessionToken: `session-${'s'.repeat(48)}`,
  subject: 'firebase-uid-verification-user',
  userId: 'usr_canonical_verification_user',
  email: 'backup.student@example.com',
  purpose: 'account-backup'
});
const context = Object.freeze({
  ip: '203.0.113.55',
  deviceId: 'device-verification-0123456789',
  userAgent: 'Chrome',
  origin: 'https://admissionhub.pages.dev'
});

class MockProvider {
  constructor({ id, channel = VERIFICATION_CHANNELS.OTP, verificationMode = VERIFICATION_MODES.LOCAL_CODE, sendPlan = [], verifyPlan = [], remaining = 100 } = {}) {
    this.id = id;
    this.channel = channel;
    this.verificationMode = verificationMode;
    this.sendPlan = [...sendPlan];
    this.verifyPlan = [...verifyPlan];
    this.remaining = remaining;
    this.sends = [];
    this.verifies = [];
    this.telegramCodes = [];
  }

  async checkAvailability() { return { available: true, code: 'READY' }; }
  async getRemainingQuota() { return { remaining: this.remaining, limit: 100, resetAt: 1_900_000_000_000 }; }
  async getProviderStatus() { return { status: 'healthy', configured: true }; }
  async sendVerification(input) {
    this.sends.push(input);
    const next = this.sendPlan.shift() || 'success';
    if (next === 'hard') throw new VerificationProviderError('HARD_DOWN', VERIFICATION_FAILURE_CLASS.HARD);
    if (next === 'temporary') throw new VerificationProviderError('TEMPORARY_DOWN', VERIFICATION_FAILURE_CLASS.TEMPORARY);
    if (next === 'retry-after') throw new VerificationProviderError('RATE_LIMITED', VERIFICATION_FAILURE_CLASS.TEMPORARY, { retryAfter: 60 });
    if (next === 'user') throw new VerificationProviderError('INVALID_DESTINATION', VERIFICATION_FAILURE_CLASS.USER);
    if (this.id === 'telegram') {
      return { accepted: true, interaction: { type: 'telegram-link', url: `https://t.me/AdmissionHubVerifyBot?start=${input.linkToken}` } };
    }
    return { accepted: true };
  }
  async sendTelegramCode(input) {
    this.telegramCodes.push(input);
    return { accepted: true };
  }
  async verifyCode(input) {
    this.verifies.push(input);
    const next = this.verifyPlan.shift();
    if (next === 'temporary') throw new VerificationProviderError('VERIFY_TIMEOUT', VERIFICATION_FAILURE_CLASS.TEMPORARY);
    if (next === 'user') throw new VerificationProviderError('EVIDENCE_REJECTED', VERIFICATION_FAILURE_CLASS.USER);
    return { verified: next !== false };
  }
}

const rawConfig = (providers, policy = {}) => ({
  enabled: true,
  policy,
  providers: providers.map((provider, index) => ({
    id: provider.id,
    enabled: true,
    priority: (index + 1) * 10,
    dailyQuota: 100,
    timeoutMs: 1000
  }))
});

const setup = ({ providers, config = rawConfig(providers), start = 1_800_000_000_000 } = {}) => {
  let now = start;
  const repository = new MemoryVerificationRepository();
  const orchestrator = new VerificationOrchestrator({ repository, hmacSecret: SECRET, config, providers, activated: true, now: () => now });
  return { repository, orchestrator, now: () => now, advance: value => { now += value; } };
};

async function expectCode(action, code) {
  await assert.rejects(action, error => error?.code === code);
}

test('backup verification stays fail-closed until the independent production activation gate is enabled', async () => {
  const provider = new MockProvider({ id: 'otp-a' });
  const repository = new MemoryVerificationRepository();
  const orchestrator = new VerificationOrchestrator({
    repository,
    hmacSecret: SECRET,
    config: rawConfig([provider]),
    providers: [provider],
    activated: false,
    now: () => 1_800_000_000_000
  });
  assert.equal((await orchestrator.capabilities()).available, false);
  const status = await orchestrator.adminStatus();
  assert.equal(status.activation, 'disabled');
  assert.equal(status.runtimeEnabled, true);
  assert.equal(status.enabled, false);
  await expectCode(() => orchestrator.requestVerification(identity, context), AUTH_ERROR_CODES.BACKUP_UNAVAILABLE);
  assert.equal(provider.sends.length, 0);
});

test('capability health probes run in parallel so one slow provider cannot serialize every fallback', async () => {
  const first = new MockProvider({ id: 'otp-a' });
  const second = new MockProvider({ id: 'otp-b' });
  let release;
  let started = 0;
  const gate = new Promise(resolve => { release = resolve; });
  first.checkAvailability = async () => {
    started += 1;
    await gate;
    return { available: true, code: 'READY' };
  };
  second.checkAvailability = async () => {
    started += 1;
    release();
    return { available: true, code: 'READY' };
  };
  const app = setup({ providers: [first, second] });
  const capabilities = await Promise.race([
    app.orchestrator.capabilities(),
    new Promise((_, reject) => setTimeout(() => reject(new Error('provider probes were serialized')), 250))
  ]);
  assert.equal(capabilities.available, true);
  assert.equal(started, 2);
});

test('public capability checks are cached for thirty seconds', async () => {
  const provider = new MockProvider({ id: 'otp-a' });
  let availabilityChecks = 0;
  let quotaChecks = 0;
  provider.checkAvailability = async () => { availabilityChecks += 1; return { available: true, code: 'READY' }; };
  provider.getRemainingQuota = async () => { quotaChecks += 1; return { remaining: 100, limit: 100, resetAt: 1_900_000_000_000 }; };
  const app = setup({ providers: [provider] });
  await app.orchestrator.capabilities();
  await app.orchestrator.capabilities();
  assert.equal(availabilityChecks, 1);
  assert.equal(quotaChecks, 1);
  app.advance(30_001);
  await app.orchestrator.capabilities();
  assert.equal(availabilityChecks, 2);
  assert.equal(quotaChecks, 2);
});

test('provider contract drives local OTP success without persisting plaintext code, destination, subject, or session', async () => {
  const provider = new MockProvider({ id: 'otp-a' });
  const app = setup({ providers: [provider] });
  const requested = await app.orchestrator.requestVerification(identity, context);
  assert.equal(requested.accepted, true);
  assert.equal(requested.attemptsAllowed, 5);
  assert.equal(provider.sends.length, 1);
  assert.match(provider.sends[0].code, /^\d{6}$/);
  assert.match(provider.sends[0].linkToken, /^[A-Za-z0-9_-]{40,96}$/);
  assert.equal('providerId' in requested, false);
  assert.equal('channel' in requested, false);

  const serialized = JSON.stringify(app.repository.snapshot());
  assert.equal(serialized.includes(provider.sends[0].code), false);
  assert.equal(serialized.includes(provider.sends[0].linkToken), false);
  assert.equal(serialized.includes(identity.email), false);
  assert.equal(serialized.includes(identity.subject), false);
  assert.equal(serialized.includes(identity.sessionToken), false);

  const verified = await app.orchestrator.verify({ ...identity, attemptId: requested.attemptId, code: provider.sends[0].code }, context);
  assert.deepEqual(verified, { verified: true, purpose: 'account-backup', userId: identity.userId });
  await expectCode(
    () => app.orchestrator.verify({ ...identity, attemptId: requested.attemptId, code: provider.sends[0].code }, context),
    AUTH_ERROR_CODES.OTP_USED
  );
});

test('a verification challenge cannot be reused for another purpose', async () => {
  const provider = new MockProvider({ id: 'otp-a' });
  const app = setup({ providers: [provider] });
  const requested = await app.orchestrator.requestVerification(identity, context);
  const code = provider.sends[0].code;
  await expectCode(() => app.orchestrator.verify({
    ...identity, purpose: 'sensitive-action', attemptId: requested.attemptId, code
  }, context), AUTH_ERROR_CODES.OTP_INVALID);
  const verified = await app.orchestrator.verify({ ...identity, attemptId: requested.attemptId, code }, context);
  assert.equal(verified.purpose, 'account-backup');
});

test('wrong OTP never sends again or switches provider and locks at five attempts', async () => {
  const first = new MockProvider({ id: 'otp-a' });
  const second = new MockProvider({ id: 'otp-b' });
  const app = setup({ providers: [first, second] });
  const requested = await app.orchestrator.requestVerification(identity, context);
  const correct = first.sends[0].code;
  const wrong = correct === '999999' ? '000000' : '999999';
  for (let attempt = 1; attempt < 5; attempt += 1) {
    await expectCode(() => app.orchestrator.verify({ ...identity, attemptId: requested.attemptId, code: wrong }, context), AUTH_ERROR_CODES.OTP_INVALID);
  }
  await expectCode(() => app.orchestrator.verify({ ...identity, attemptId: requested.attemptId, code: wrong }, context), AUTH_ERROR_CODES.OTP_LOCKED);
  await expectCode(() => app.orchestrator.verify({ ...identity, attemptId: requested.attemptId, code: correct }, context), AUTH_ERROR_CODES.OTP_LOCKED);
  await expectCode(() => app.orchestrator.requestVerification(identity, context), AUTH_ERROR_CODES.OTP_LOCKED);
  assert.equal(first.sends.length, 1);
  assert.equal(second.sends.length, 0);
  app.advance(900_001);
  await app.orchestrator.requestVerification(identity, context);
  assert.equal(first.sends.length, 2);
});

test('OTP expires after ten minutes and resend cooldown is enforced', async () => {
  const provider = new MockProvider({ id: 'otp-a' });
  const app = setup({ providers: [provider] });
  const requested = await app.orchestrator.requestVerification(identity, context);
  await expectCode(() => app.orchestrator.requestVerification(identity, context), AUTH_ERROR_CODES.RESEND_COOLDOWN);
  app.advance(600_001);
  await expectCode(
    () => app.orchestrator.verify({ ...identity, attemptId: requested.attemptId, code: provider.sends[0].code }, context),
    AUTH_ERROR_CODES.OTP_EXPIRED
  );
});

test('a failed resend keeps the previously delivered unexpired code usable', async () => {
  const provider = new MockProvider({ id: 'otp-a' });
  const app = setup({ providers: [provider] });
  const first = await app.orchestrator.requestVerification(identity, context);
  const firstCode = provider.sends[0].code;
  app.advance(60_001);
  provider.sendPlan.push('hard');
  await expectCode(() => app.orchestrator.requestVerification(identity, context), AUTH_ERROR_CODES.BACKUP_UNAVAILABLE);
  const verified = await app.orchestrator.verify({ ...identity, attemptId: first.attemptId, code: firstCode }, context);
  assert.equal(verified.verified, true);
});

test('an accepted delivery is never sent twice when local delivery-state persistence fails', async () => {
  const provider = new MockProvider({ id: 'otp-a' });
  const app = setup({ providers: [provider] });
  app.repository.markChallengeDelivery = async () => { throw new Error('storage unavailable'); };
  await expectCode(() => app.orchestrator.requestVerification(identity, context), AUTH_ERROR_CODES.STORAGE_UNAVAILABLE);
  assert.equal(provider.sends.length, 1);
});

test('hard and temporary provider failures retry intelligently then fail over', async t => {
  await t.test('hard failure skips retry and uses next provider', async () => {
    const first = new MockProvider({ id: 'otp-a', sendPlan: ['hard'] });
    const second = new MockProvider({ id: 'otp-b' });
    const app = setup({ providers: [first, second] });
    await app.orchestrator.requestVerification(identity, context);
    assert.equal(first.sends.length, 1);
    assert.equal(second.sends.length, 1);
  });

  await t.test('temporary failure retries once before failover', async () => {
    const first = new MockProvider({ id: 'otp-a', sendPlan: ['temporary', 'temporary'] });
    const second = new MockProvider({ id: 'otp-b' });
    const app = setup({ providers: [first, second] });
    await app.orchestrator.requestVerification(identity, context);
    assert.equal(first.sends.length, 2);
    assert.equal(second.sends.length, 1);
  });

  await t.test('provider Retry-After opens cooldown without an immediate retry before failover', async () => {
    const first = new MockProvider({ id: 'otp-a', sendPlan: ['retry-after'] });
    const second = new MockProvider({ id: 'otp-b' });
    const app = setup({ providers: [first, second] });
    await app.orchestrator.requestVerification(identity, context);
    assert.equal(first.sends.length, 1);
    assert.equal(second.sends.length, 1);
    const state = await app.repository.providerSnapshot({ providerId: 'otp-a', now: app.now() });
    assert.equal(state.circuit, 'open');
    assert.ok(state.cooldownUntil >= app.now() + 60_000);
  });

  await t.test('user error never retries or fails over', async () => {
    const first = new MockProvider({ id: 'otp-a', sendPlan: ['user'] });
    const second = new MockProvider({ id: 'otp-b' });
    const app = setup({ providers: [first, second] });
    await expectCode(() => app.orchestrator.requestVerification(identity, context), AUTH_ERROR_CODES.INVALID_INPUT);
    assert.equal(first.sends.length, 1);
    assert.equal(second.sends.length, 0);
  });
});

test('a repaired provider is probed again instead of staying circuit-open forever', async () => {
  const first = new MockProvider({ id: 'otp-a', sendPlan: ['hard'] });
  const second = new MockProvider({ id: 'otp-b' });
  const app = setup({ providers: [first, second] });

  await app.orchestrator.requestVerification(identity, context);
  assert.equal(first.sends.length, 1);
  assert.equal(second.sends.length, 1, 'the healthy fallback carries the send');
  assert.equal((await app.repository.providerSnapshot({ providerId: 'otp-a', now: app.now() })).circuit, 'open');

  app.advance(301_000);
  await app.orchestrator.requestVerification(identity, context);
  assert.equal(first.sends.length, 2, 'the expired cooldown is probed rather than skipped');

  // The credential is repaired and the probe succeeds, so the slot closes and
  // takes the next send instead of staying penalised behind the healthy fallback.
  app.advance(61_000);
  await app.orchestrator.requestVerification(identity, context);
  assert.equal(first.sends.length, 2); // Resend rotates away from the previous provider.
  assert.equal((await app.repository.providerSnapshot({ providerId: 'otp-a', now: app.now() })).circuit, 'closed');
});

test('backup sends enforce independent Firebase-user, IP, and device limits', async t => {
  const scopedIdentity = index => ({
    ...identity,
    sessionToken: `session-${String(index).padStart(48, 's')}`,
    subject: `firebase-rate-uid-${index}`,
    userId: `usr_rate_${index}`,
    email: `rate-${index}@example.com`
  });

  await t.test('Firebase user limit', async () => {
    const provider = new MockProvider({ id: 'otp-a', remaining: 100 });
    const app = setup({ providers: [provider] });
    for (let index = 0; index < 5; index += 1) {
      if (index) app.advance(61_000);
      await app.orchestrator.requestVerification(scopedIdentity(1), context);
    }
    app.advance(61_000);
    await expectCode(() => app.orchestrator.requestVerification(scopedIdentity(1), context), AUTH_ERROR_CODES.RATE_LIMITED);
    assert.equal(provider.sends.length, 5);
  });

  await t.test('device limit across Firebase users', async () => {
    const provider = new MockProvider({ id: 'otp-a', remaining: 100 });
    const app = setup({ providers: [provider] });
    for (let index = 0; index < 10; index += 1) await app.orchestrator.requestVerification(scopedIdentity(index + 10), context);
    await expectCode(() => app.orchestrator.requestVerification(scopedIdentity(20), context), AUTH_ERROR_CODES.RATE_LIMITED);
    assert.equal(provider.sends.length, 10);
  });

  await t.test('IP limit across Firebase users and devices', async () => {
    const provider = new MockProvider({ id: 'otp-a', remaining: 100 });
    const app = setup({ providers: [provider] });
    for (let index = 0; index < 20; index += 1) {
      await app.orchestrator.requestVerification(scopedIdentity(index + 30), { ...context, deviceId: `rate-device-${String(index).padStart(24, 'd')}` });
    }
    await expectCode(
      () => app.orchestrator.requestVerification(scopedIdentity(50), { ...context, deviceId: `rate-device-${'z'.repeat(24)}` }),
      AUTH_ERROR_CODES.RATE_LIMITED
    );
    assert.equal(provider.sends.length, 20);
  });
});

test('daily quota is atomic, exhausts safely, and resets at the next UTC day', async () => {
  const provider = new MockProvider({ id: 'otp-a' });
  const config = rawConfig([provider]);
  config.providers[0].dailyQuota = 1;
  const app = setup({ providers: [provider], config, start: 1_800_000_000_000 });
  await app.orchestrator.requestVerification(identity, context);
  app.advance(61_000);
  await expectCode(() => app.orchestrator.requestVerification(identity, context), AUTH_ERROR_CODES.BACKUP_UNAVAILABLE);
  const resetAt = (Math.floor(app.now() / DAY_MS) + 1) * DAY_MS;
  app.advance(resetAt - app.now() + 1);
  await app.orchestrator.requestVerification(identity, context);
  assert.equal(provider.sends.length, 2);
});

test('low-quota awareness preserves depleted primary capacity when a healthy fallback exists', async () => {
  const first = new MockProvider({ id: 'otp-a' });
  const second = new MockProvider({ id: 'otp-b' });
  const config = rawConfig([first, second]);
  config.providers[0].dailyQuota = 10;
  config.providers[1].dailyQuota = 100;
  const app = setup({ providers: [first, second], config });
  for (let index = 0; index < 9; index += 1) {
    await app.repository.reserveDailyQuota({ providerId: 'otp-a', dailyQuota: 10, now: app.now() });
  }
  await app.orchestrator.requestVerification(identity, context);
  assert.equal(first.sends.length, 0);
  assert.equal(second.sends.length, 1);
});

test('official WhatsApp and Telegram slots both use locally verified single-use codes', async t => {
  await t.test('whatsapp official-code flow', async () => {
    const provider = new MockProvider({ id: 'whatsapp', channel: VERIFICATION_CHANNELS.WHATSAPP, verificationMode: VERIFICATION_MODES.LOCAL_CODE });
    const app = setup({ providers: [provider] });
    const linkedDestinations = { whatsapp: '+8801700000000' };
    const requested = await app.orchestrator.requestVerification({ ...identity, linkedDestinations }, context);
    const verified = await app.orchestrator.verify({ ...identity, linkedDestinations, attemptId: requested.attemptId, code: provider.sends[0].code }, context);
    assert.equal(verified.verified, true);
    assert.equal(provider.verifies.length, 0);
  });

  await t.test('Telegram START sends an OTP that the app verifies locally', async () => {
    const provider = new MockProvider({ id: 'telegram', channel: VERIFICATION_CHANNELS.TELEGRAM, verificationMode: VERIFICATION_MODES.LOCAL_CODE });
    const app = setup({ providers: [provider] });
    const requested = await app.orchestrator.requestVerification({ ...identity, allowTelegramLink: true }, context);
    assert.equal(requested.interaction.proof, 'local-code-required');
    assert.match(provider.sends[0].linkToken, /^[A-Za-z0-9_-]{40,96}$/);
    await expectCode(
      () => app.orchestrator.verify({ ...identity, allowTelegramLink: true, attemptId: requested.attemptId, code: provider.sends[0].code }, context),
      AUTH_ERROR_CODES.TELEGRAM_VERIFICATION_PENDING
    );
    assert.equal(app.repository.snapshot().challenges[0].attempts, 0);
    await app.orchestrator.confirmTelegramWebhook({
      linkToken: provider.sends[0].linkToken,
      telegramUserId: '123456789',
      chatId: '123456789'
    });
    assert.equal(provider.telegramCodes.length, 1);
    assert.equal(provider.telegramCodes[0].code, provider.sends[0].code);
    const serialized = JSON.stringify(app.repository.snapshot());
    assert.equal(serialized.includes('123456789'), false);
    assert.equal(serialized.includes(provider.sends[0].linkToken), false);
    await expectCode(() => app.orchestrator.confirmTelegramWebhook({
      linkToken: provider.sends[0].linkToken,
      telegramUserId: '123456789',
      chatId: '123456789'
    }), AUTH_ERROR_CODES.OTP_INVALID);
    const verified = await app.orchestrator.verify({
      ...identity, allowTelegramLink: true, attemptId: requested.attemptId, code: provider.telegramCodes[0].code
    }, context);
    assert.equal(verified.verified, true);
    assert.equal(verified.telegramLinked, true);
    assert.equal(verified.emailVerified, false);
    assert.equal(provider.verifies.length, 0);
    await expectCode(() => app.orchestrator.verify({
      ...identity, allowTelegramLink: true, attemptId: requested.attemptId, code: provider.telegramCodes[0].code
    }, context), AUTH_ERROR_CODES.OTP_USED);
  });
});

test('wrong Telegram OTP consumes only an attempt and never switches provider or resends', async () => {
  const telegram = new MockProvider({
    id: 'telegram', channel: VERIFICATION_CHANNELS.TELEGRAM, verificationMode: VERIFICATION_MODES.LOCAL_CODE
  });
  const whatsapp = new MockProvider({
    id: 'whatsapp', channel: VERIFICATION_CHANNELS.WHATSAPP, verificationMode: VERIFICATION_MODES.LOCAL_CODE
  });
  const app = setup({ providers: [telegram, whatsapp] });
  const linkedDestinations = { whatsapp: '+8801700000000' };
  const requested = await app.orchestrator.requestVerification({ ...identity, linkedDestinations, allowTelegramLink: true }, context);
  await app.orchestrator.confirmTelegramWebhook({
    linkToken: telegram.sends[0].linkToken,
    telegramUserId: '987654321',
    chatId: '987654321'
  });
  const wrong = telegram.telegramCodes[0].code === '999999' ? '000000' : '999999';
  await expectCode(
    () => app.orchestrator.verify({ ...identity, linkedDestinations, allowTelegramLink: true, attemptId: requested.attemptId, code: wrong }, context),
    AUTH_ERROR_CODES.OTP_INVALID
  );
  assert.equal(telegram.sends.length, 1);
  assert.equal(telegram.telegramCodes.length, 1);
  assert.equal(whatsapp.sends.length, 0);
});

test('daily quota reservation stays atomic under concurrent claims', async () => {
  const repository = new MemoryVerificationRepository();
  const results = await Promise.all(Array.from({ length: 50 }, () => repository.reserveDailyQuota({
    providerId: 'otp-a', dailyQuota: 7, now: 1_800_000_000_000
  })));
  assert.equal(results.filter(row => !row.exhausted).length, 7);
  assert.equal(results.filter(row => row.exhausted).length, 43);
  assert.equal((await repository.dailyQuotaSnapshot({ providerId: 'otp-a', dailyQuota: 7, now: 1_800_000_000_000 })).used, 7);
});

test('safe admin policy updates persist only normalized non-secret fields', async () => {
  const provider = new MockProvider({ id: 'otp-a' });
  const app = setup({ providers: [provider] });
  const updated = await app.orchestrator.updateConfig({
    enabled: true,
    secret: 'must-not-persist',
    policy: { codeTtlSeconds: 240, maxAttempts: 4, apiKey: 'must-not-persist' },
    providers: [{ id: 'otp-a', enabled: true, priority: 77, dailyQuota: 12, token: 'must-not-persist' }]
  });
  assert.equal(updated.policy.codeTtlSeconds, 240);
  assert.equal(updated.policy.maxAttempts, 4);
  assert.equal(updated.providers.find(row => row.id === 'otp-a').priority, 77);
  const persisted = await app.repository.getRuntimeConfig();
  const serialized = JSON.stringify(persisted);
  assert.equal(serialized.includes('must-not-persist'), false);
  assert.equal(serialized.includes('apiKey'), false);
  assert.equal(serialized.includes('token'), false);
  const disabled = await app.orchestrator.updateConfig({ ...persisted, enabled: false });
  assert.equal(disabled.enabled, false);
  assert.equal(disabled.providers.find(row => row.id === 'otp-a').enabled, true);
  assert.equal((await app.orchestrator.capabilities()).available, false);
});

test('admin status is sanitized and reports priority, quota, reset, health, rates, latency, failures, and events', async () => {
  const provider = new MockProvider({ id: 'otp-a' });
  const app = setup({ providers: [provider] });
  await app.orchestrator.requestVerification(identity, context);
  const status = await app.orchestrator.adminStatus();
  const row = status.providers.find(item => item.id === 'otp-a');
  assert.equal(row.enabled, true);
  assert.equal(row.configured, true);
  assert.equal(row.priority, 10);
  assert.equal(row.quota.local.used, 1);
  assert.ok(row.quota.local.resetAt > app.now());
  assert.equal(row.health.successCount, 1);
  assert.equal(row.health.failureCount, 0);
  assert.ok(row.health.latencyMs >= 0);
  const serialized = JSON.stringify(status);
  assert.equal(serialized.includes(provider.sends[0].code), false);
  assert.equal(serialized.includes(provider.sends[0].linkToken), false);
  assert.equal(serialized.includes(identity.email), false);
  assert.equal(serialized.includes(identity.sessionToken), false);
});

test('Telegram webhook setup is available only through the enabled Telegram slot and returns bounded state', async () => {
  const provider = new MockProvider({
    id: 'telegram',
    channel: VERIFICATION_CHANNELS.TELEGRAM,
    verificationMode: VERIFICATION_MODES.LOCAL_CODE
  });
  let configured = 0;
  let removed = 0;
  provider.configureWebhook = async () => {
    configured += 1;
    return { ready: true, identityReady: true, webhookReady: true, endpointAccepted: true, webhookChanged: true, privateDetail: 'must-not-return' };
  };
  provider.removeConfiguredWebhook = async () => { removed += 1; return { removed: true }; };
  const app = setup({ providers: [provider] });
  assert.deepEqual(await app.orchestrator.configureTelegramWebhook(), {
    ready: true,
    identityReady: true,
    webhookReady: true,
    endpointAccepted: true,
    webhookChanged: true
  });
  assert.deepEqual(await app.orchestrator.removeTelegramWebhook(), { removed: true });
  assert.equal(configured, 1);
  assert.equal(removed, 1);

  const disabled = setup({ providers: [provider], config: { enabled: false, providers: [{ id: 'telegram', enabled: false }] } });
  await expectCode(() => disabled.orchestrator.configureTelegramWebhook(), AUTH_ERROR_CODES.BACKUP_UNAVAILABLE);
});

// Owner 2026-10-16 anti-abuse: email-ownership may only deliver to an approved
// domain, and no single address may take more than three OTPs a day.
const ownershipIdentity = email => Object.freeze({
  purpose: 'email-ownership',
  trustedIdentity: {
    userId: 'usr_ownership_guard',
    sessionRef: 'a'.repeat(64),
    subjectRef: 'b'.repeat(64),
    emailRef: 'c'.repeat(64),
    email
  }
});
const allowConfig = (providers, allowedDomains) => ({ ...rawConfig(providers), allowedDomains });

test('email-ownership refuses a domain outside the allowlist and sends nothing', async () => {
  const provider = new MockProvider({ id: 'otp-a' });
  const app = setup({ providers: [provider], config: allowConfig([provider], ['gmail.com', 'yahoo.com', 'icloud.com', 'outlook.com']) });
  await expectCode(() => app.orchestrator.requestVerification(ownershipIdentity('student@mailinator.com'), context), AUTH_ERROR_CODES.INVALID_INPUT);
  assert.equal(provider.sends.length, 0);
});

test('email-ownership accepts an owner domain but refuses a Bangladesh college suffix', async () => {
  const provider = new MockProvider({ id: 'otp-a' });
  const app = setup({ providers: [provider], config: allowConfig([provider], ['gmail.com', 'outlook.com']) });
  const gmail = await app.orchestrator.requestVerification(ownershipIdentity('student@gmail.com'), context);
  assert.equal(gmail.accepted, true);
  app.advance(61_000);
  const collegeIdentity = ownershipIdentity('student@college.ac.bd');
  await expectCode(() => app.orchestrator.requestVerification(
    { ...collegeIdentity, trustedIdentity: { ...collegeIdentity.trustedIdentity, emailRef: 'd'.repeat(64) } },
    context
  ), AUTH_ERROR_CODES.INVALID_INPUT);
  assert.equal(provider.sends.length, 1);
});

test('an explicit empty allowlist can no longer widen the owner list', async () => {
  const provider = new MockProvider({ id: 'otp-a' });
  const app = setup({ providers: [provider], config: allowConfig([provider], []) });
  await expectCode(() => app.orchestrator.requestVerification(ownershipIdentity('anything@example.com'), context), AUTH_ERROR_CODES.INVALID_INPUT);
  assert.equal(provider.sends.length, 0);
});

test('the fourth email-ownership OTP to one address in a day is rate limited', async () => {
  const provider = new MockProvider({ id: 'otp-a' });
  const app = setup({ providers: [provider], config: allowConfig([provider], ['gmail.com']) });
  const one = ownershipIdentity('repeat@gmail.com');
  for (let index = 0; index < 3; index += 1) {
    const answer = await app.orchestrator.requestVerification(one, { ...context, deviceId: `device-verification-0000000000${index}` });
    assert.equal(answer.accepted, true, `send ${index + 1} should be allowed`);
    app.advance(61_000);
  }
  await expectCode(() => app.orchestrator.requestVerification(one, { ...context, deviceId: 'device-verification-00000000009' }), AUTH_ERROR_CODES.RATE_LIMITED);
});

test('the account-backup purpose ignores the email-ownership allowlist', async () => {
  const provider = new MockProvider({ id: 'otp-a' });
  const app = setup({ providers: [provider], config: allowConfig([provider], ['gmail.com']) });
  const requested = await app.orchestrator.requestVerification(identity, context);
  assert.equal(requested.accepted, true);
});


test('owner 2026-10-16: an iCloud/Yahoo/Outlook recipient is offered to Appwrite first', async () => {
  // Owner report: those mailboxes did not get codes the top slot accepted, and he
  // verified Appwrite delivers to all three. Brevo (otp-a) keeps the best operator
  // priority, so only the recipient bias can move the send.
  const brevo = new MockProvider({ id: 'otp-a' });
  const appwrite = new MockProvider({ id: 'otp-i', verificationMode: VERIFICATION_MODES.PROVIDER_EVIDENCE });
  const app = setup({
    providers: [brevo, appwrite],
    config: allowConfig([brevo, appwrite], ['gmail.com', 'yahoo.com', 'icloud.com', 'outlook.com'])
  });
  const result = await app.orchestrator.requestVerification(ownershipIdentity('student@yahoo.com'), context);
  assert.equal(result.accepted, true);
  assert.equal(appwrite.sends.length, 1, 'Appwrite must carry the Yahoo send');
  assert.equal(brevo.sends.length, 0, 'Brevo must not be chosen for a Yahoo recipient');
});

test('owner 2026-10-16: an iCloud recipient uses Appwrite and a Gmail recipient keeps the operator order', async () => {
  const brevo = new MockProvider({ id: 'otp-a' });
  const appwrite = new MockProvider({ id: 'otp-i', verificationMode: VERIFICATION_MODES.PROVIDER_EVIDENCE });
  const app = setup({
    providers: [brevo, appwrite],
    config: allowConfig([brevo, appwrite], ['gmail.com', 'yahoo.com', 'icloud.com', 'outlook.com'])
  });
  await app.orchestrator.requestVerification(ownershipIdentity('student@icloud.com'), context);
  assert.equal(appwrite.sends.length, 1);
  assert.equal(brevo.sends.length, 0);
  app.advance(61_000);
  await app.orchestrator.requestVerification(ownershipIdentity('student@gmail.com'), context);
  assert.equal(brevo.sends.length, 1, 'a Gmail recipient must still prefer the operator order');
  assert.equal(appwrite.sends.length, 1);
});

test('owner 2026-10-16: a misconfigured Appwrite falls through instead of starving a Yahoo send', async () => {
  const brevo = new MockProvider({ id: 'otp-a' });
  const appwrite = new MockProvider({ id: 'otp-i', verificationMode: VERIFICATION_MODES.PROVIDER_EVIDENCE });
  // A preference lowers a score; it must never promote a slot the probe rejected.
  appwrite.checkAvailability = async () => ({ available: false, code: 'NOT_CONFIGURED' });
  const app = setup({
    providers: [brevo, appwrite],
    config: allowConfig([brevo, appwrite], ['gmail.com', 'yahoo.com', 'icloud.com', 'outlook.com'])
  });
  const result = await app.orchestrator.requestVerification(ownershipIdentity('student@yahoo.com'), context);
  assert.equal(result.accepted, true);
  assert.equal(appwrite.sends.length, 0);
  assert.equal(brevo.sends.length, 1, 'the send must fall through to a healthy slot');
});

const liveOrderConfig = list => {
  const base = rawConfig(list);
  const live = { 'otp-a': 10, 'otp-h': 15, 'otp-i': 38 };
  return { ...base, allowedDomains: ['gmail.com', 'yahoo.com', 'icloud.com', 'outlook.com'], providers: base.providers.map(row => ({ ...row, priority: live[row.id] })) };
};

test('owner 2026-10-16 (Logto first): a Yahoo recipient goes to Logto before Appwrite and Brevo', async () => {
  const brevo = new MockProvider({ id: 'otp-a' });
  const logto = new MockProvider({ id: 'otp-h', verificationMode: VERIFICATION_MODES.PROVIDER_EVIDENCE });
  const appwrite = new MockProvider({ id: 'otp-i', verificationMode: VERIFICATION_MODES.PROVIDER_EVIDENCE });
  const app = setup({ providers: [brevo, logto, appwrite], config: liveOrderConfig([brevo, logto, appwrite]) });
  const result = await app.orchestrator.requestVerification(ownershipIdentity('student@yahoo.com'), context);
  assert.equal(result.accepted, true);
  assert.equal(logto.sends.length, 1, 'Logto must carry the Yahoo send');
  assert.equal(appwrite.sends.length, 0);
  assert.equal(brevo.sends.length, 0);
});

test('owner 2026-10-16 (Logto first): Appwrite carries a Yahoo send when Logto is unavailable', async () => {
  const brevo = new MockProvider({ id: 'otp-a' });
  const logto = new MockProvider({ id: 'otp-h', verificationMode: VERIFICATION_MODES.PROVIDER_EVIDENCE });
  const appwrite = new MockProvider({ id: 'otp-i', verificationMode: VERIFICATION_MODES.PROVIDER_EVIDENCE });
  logto.checkAvailability = async () => ({ available: false, code: 'NOT_CONFIGURED' });
  const app = setup({ providers: [brevo, logto, appwrite], config: liveOrderConfig([brevo, logto, appwrite]) });
  const result = await app.orchestrator.requestVerification(ownershipIdentity('student@outlook.com'), context);
  assert.equal(result.accepted, true);
  assert.equal(appwrite.sends.length, 1, 'Appwrite is the second choice');
  assert.equal(brevo.sends.length, 0);
});

test('owner 2026-10-16 (Logto first): a Gmail recipient keeps Brevo first', async () => {
  const brevo = new MockProvider({ id: 'otp-a' });
  const logto = new MockProvider({ id: 'otp-h', verificationMode: VERIFICATION_MODES.PROVIDER_EVIDENCE });
  const appwrite = new MockProvider({ id: 'otp-i', verificationMode: VERIFICATION_MODES.PROVIDER_EVIDENCE });
  const app = setup({ providers: [brevo, logto, appwrite], config: liveOrderConfig([brevo, logto, appwrite]) });
  await app.orchestrator.requestVerification(ownershipIdentity('student@gmail.com'), context);
  assert.equal(brevo.sends.length, 1, 'Gmail keeps the operator order');
  assert.equal(logto.sends.length, 0);
  assert.equal(appwrite.sends.length, 0);
});

test('owner 2026-10-16 (user-error failover): a provider 422 fails over to the next slot', async () => {
  const mailersend = new MockProvider({ id: 'otp-f' });
  mailersend.sendVerification = async input => {
    mailersend.sends.push(input);
    throw new VerificationProviderError('PROVIDER_HTTP_422', VERIFICATION_FAILURE_CLASS.USER);
  };
  const logto = new MockProvider({ id: 'otp-h', verificationMode: VERIFICATION_MODES.PROVIDER_EVIDENCE });
  const app = setup({ providers: [mailersend, logto] });
  const result = await app.orchestrator.requestVerification(identity, context);
  assert.equal(result.accepted, true);
  assert.equal(mailersend.sends.length, 1, 'no retry on the same provider');
  assert.equal(logto.sends.length, 1, 'Logto carries the send');
});

test('owner 2026-10-16 (user-error failover): an invalid destination still stops the request', async () => {
  const first = new MockProvider({ id: 'otp-f', sendPlan: ['user'] });
  const second = new MockProvider({ id: 'otp-h', verificationMode: VERIFICATION_MODES.PROVIDER_EVIDENCE });
  const app = setup({ providers: [first, second] });
  await expectCode(() => app.orchestrator.requestVerification(identity, context), AUTH_ERROR_CODES.INVALID_INPUT);
  assert.equal(second.sends.length, 0);
});

test('owner 2026-10-16 (timeout failover): a hung provider is tried once, then the next slot accepts', async () => {
  const hung = new MockProvider({ id: 'otp-a' });
  hung.sendVerification = async input => {
    hung.sends.push(input);
    return new Promise(() => {});
  };
  const next = new MockProvider({ id: 'otp-b' });
  const app = setup({ providers: [hung, next] });
  const started = Date.now();
  const result = await app.orchestrator.requestVerification(identity, context);
  assert.equal(result.accepted, true);
  assert.equal(hung.sends.length, 1, 'no second wait on the hung provider');
  assert.equal(next.sends.length, 1, 'the next slot carries the send');
  assert.ok(Date.now() - started < 1900, 'only one timeoutMs was spent');
});

test('owner 2026-10-16 (timeout failover): a 503 still retries the same provider once', async () => {
  const flaky = new MockProvider({ id: 'otp-a' });
  flaky.sendVerification = async input => {
    flaky.sends.push(input);
    throw new VerificationProviderError('PROVIDER_HTTP_503', VERIFICATION_FAILURE_CLASS.TEMPORARY);
  };
  const next = new MockProvider({ id: 'otp-b' });
  const app = setup({ providers: [flaky, next] });
  const result = await app.orchestrator.requestVerification(identity, context);
  assert.equal(result.accepted, true);
  assert.equal(flaky.sends.length, 2, '503 keeps the single retry');
  assert.equal(next.sends.length, 1);
});

test('wrangler.toml timeoutMs matches each slot speed (owner 2026-10-16)', async () => {
  const { readFile } = await import('node:fs/promises');
  const toml = await readFile(new URL('./wrangler.toml', import.meta.url), 'utf8');
  const rows = JSON.parse(toml.match(/VERIFICATION_ORCHESTRATOR_CONFIG = '(.*)'/)[1]).providers;
  const got = Object.fromEntries(rows.map(row => [row.id, row.timeoutMs]));
  assert.deepEqual(got, {
    'otp-a': 8000, 'otp-h': 12000, 'otp-i': 12000, 'otp-j': 12000, 'otp-k': 12000, 'otp-l': 12000, 'otp-m': 12000, 'otp-b': 20000,
    'otp-d': 8000, 'otp-e': 8000, 'otp-f': 8000, 'otp-g': 8000, 'otp-c': 8000, 'otp-n': 8000, 'otp-o': 8000, 'otp-q': 8000, 'otp-r': 8000, 'otp-s': 8000, 'otp-t': 8000, 'otp-u': 8000, 'otp-v': 12000, 'otp-w': 12000, 'otp-x': 12000, 'otp-y': 12000, 'otp-z': 12000, 'otp-za': 12000, telegram: 20000
  });
});

// Owner 2026-10-17 (screenshots): Logto code "already used", Logto before Brevo on Gmail.
test('owner 2026-10-17: a correct Logto code proves email ownership on the first try', async () => {
  const logto = new MockProvider({ id: 'otp-h', verificationMode: VERIFICATION_MODES.PROVIDER_EVIDENCE });
  const app = setup({ providers: [logto], config: allowConfig([logto], ['gmail.com']) });
  const who = ownershipIdentity('student@gmail.com');
  const sent = await app.orchestrator.requestVerification(who, context);
  const verified = await app.orchestrator.verify({ ...who, attemptId: sent.attemptId, code: '325916' }, context);
  assert.equal(verified.verified, true);
  assert.equal(verified.emailOwnershipProven, true, 'the worker gate needs this flag');
  const proven = await app.repository.isEmailOwnershipProven({ userId: who.trustedIdentity.userId, subjectRef: who.trustedIdentity.subjectRef });
  assert.equal(proven.proven, true);
});

test('owner 2026-10-17: Brevo goes before a fresh Logto on Gmail even with a latency and failure history', async () => {
  const brevo = new MockProvider({ id: 'otp-a' });
  const logto = new MockProvider({ id: 'otp-h', verificationMode: VERIFICATION_MODES.PROVIDER_EVIDENCE });
  const base = allowConfig([brevo, logto], ['gmail.com']);
  const config = { ...base, providers: base.providers.map(row => ({ ...row, priority: row.id === 'otp-a' ? 10 : 15 })) };
  const app = setup({ providers: [brevo, logto], config });
  for (let i = 0; i < 13; i += 1) {
    await app.repository.recordProviderResult({ providerId: 'otp-a', channel: 'otp', success: false, failureClass: VERIFICATION_FAILURE_CLASS.TEMPORARY, reason: 'TIMEOUT', latencyMs: 5000, failureThreshold: 100, cooldownMs: 1000, now: app.now() });
  }
  await app.repository.recordProviderResult({ providerId: 'otp-a', channel: 'otp', success: true, reason: 'ACCEPTED', latencyMs: 2800, failureThreshold: 100, cooldownMs: 1000, now: app.now() });
  await app.orchestrator.requestVerification(ownershipIdentity('student@gmail.com'), context);
  assert.equal(brevo.sends.length, 1, 'Brevo carries the Gmail send');
  assert.equal(logto.sends.length, 0);
});

test('owner 2026-10-17: an admin save without timeoutMs keeps each slot timeout', async () => {
  const brevo = new MockProvider({ id: 'otp-a' });
  const logto = new MockProvider({ id: 'otp-h', verificationMode: VERIFICATION_MODES.PROVIDER_EVIDENCE });
  const base = rawConfig([brevo, logto]);
  const config = { ...base, allowedDomains: ['gmail.com', 'example.com'], providers: base.providers.map(row => ({ ...row, timeoutMs: row.id === 'otp-h' ? 12000 : 8000 })) };
  const app = setup({ providers: [brevo, logto], config });
  const status = await app.orchestrator.updateConfig({
    enabled: true,
    policy: { codeTtlSeconds: 600 },
    providers: [{ id: 'otp-a', enabled: true, priority: 10, dailyQuota: 300 }, { id: 'otp-h', enabled: true, priority: 15, dailyQuota: 5000 }]
  });
  assert.equal(status.providers.find(row => row.id === 'otp-h').timeoutMs, 12000);
  assert.equal(status.providers.find(row => row.id === 'otp-a').timeoutMs, 8000);
  assert.equal(status.policy.codeTtlSeconds, 600);
  assert.deepEqual([...app.orchestrator.config.allowedDomains], ['gmail.com', 'example.com']);
});

/* F-02 (blueprint 06): one code, one deadline. Before this the chain waited a
   full timeoutMs per slot — 26 enabled slots in production meant a bad day could
   hold the student for minutes. The budget is wall-clock for the whole request,
   health probes included. */
test('F-02: the delivery budget caps the whole chain, not one timeout per slot', async () => {
  const hung = id => {
    const provider = new MockProvider({ id });
    provider.sendVerification = async input => {
      provider.sends.push(input);
      return new Promise(() => {});
    };
    return provider;
  };
  const providers = [hung('otp-a'), hung('otp-b'), hung('otp-c'), hung('otp-d')];
  const app = setup({ providers, config: rawConfig(providers, { deliveryBudgetMs: 3_000 }) });
  const started = Date.now();
  await expectCode(() => app.orchestrator.requestVerification(identity, context), AUTH_ERROR_CODES.BACKUP_UNAVAILABLE);
  const elapsed = Date.now() - started;
  assert.ok(elapsed < 4_500, `the budget must bound the request; it took ${elapsed}ms`);
  const sends = providers.reduce((sum, provider) => sum + provider.sends.length, 0);
  assert.ok(sends < providers.length, 'the budget stops the chain instead of trying every slot');
});

test('F-02: a budget that is still fresh never shortens a healthy first send', async () => {
  const primary = new MockProvider({ id: 'otp-a' });
  const secondary = new MockProvider({ id: 'otp-b' });
  const app = setup({ providers: [primary, secondary], config: rawConfig([primary, secondary], { deliveryBudgetMs: 25_000 }) });
  const result = await app.orchestrator.requestVerification(identity, context);
  assert.equal(result.accepted, true);
  assert.match(result.attemptId, /.+/);
  assert.equal(secondary.sends.length, 0, 'a healthy primary still takes the send alone');
});

/* Duplicate guard (owner 2026-10-24). A parallel "hedged" send shipped earlier
   the same day and was withdrawn: two providers can both deliver, and a message
   handed to a provider cannot be recalled. These two tests pin the rule that
   makes a duplicate impossible — one slot sends at a time, always. */
test('F-02: a slow but working slot is waited for, never doubled', async () => {
  const order = [];
  const primary = new MockProvider({ id: 'otp-a' });
  primary.sendVerification = input => {
    primary.sends.push(input);
    order.push('otp-a');
    return new Promise(resolve => setTimeout(() => resolve({ accepted: true }), 400));
  };
  const secondary = new MockProvider({ id: 'otp-b' });
  secondary.sendVerification = input => {
    secondary.sends.push(input);
    order.push('otp-b');
    return Promise.resolve({ accepted: true });
  };
  const app = setup({ providers: [primary, secondary], config: rawConfig([primary, secondary], { deliveryBudgetMs: 25_000 }) });

  const result = await app.orchestrator.requestVerification(identity, context);
  assert.equal(result.accepted, true);
  assert.equal(secondary.sends.length, 0, 'the second slot is never asked while the first is still sending');
  assert.deepEqual(order, ['otp-a'], 'exactly one send left the process');
});

test('F-02: the next slot starts only after the previous one has failed', async () => {
  const started = Date.now();
  let secondAt = -1;
  const primary = new MockProvider({ id: 'otp-a' });
  primary.sendVerification = input => {
    primary.sends.push(input);
    return new Promise(() => {}); // hangs until its own timeoutMs
  };
  const secondary = new MockProvider({ id: 'otp-b' });
  secondary.sendVerification = input => {
    secondary.sends.push(input);
    secondAt = Date.now() - started;
    return Promise.resolve({ accepted: true });
  };
  const app = setup({ providers: [primary, secondary], config: rawConfig([primary, secondary], { deliveryBudgetMs: 25_000 }) });

  const result = await app.orchestrator.requestVerification(identity, context);
  assert.equal(result.accepted, true);
  assert.equal(primary.sends.length, 1);
  assert.equal(secondary.sends.length, 1);
  assert.ok(secondAt >= 900, `the next slot must wait for the first slot's 1000ms timeout; it started at ${secondAt}ms`);
});

/* Owner 2026-10-24: OTP has to be quick without ever sending twice. Speed comes
   from the slot order, not from a parallel send: a provider that has measurably
   slow sends is pushed behind the others, so the first attempt already leaves
   through the fast one. Everything else keeps the operator's priority order. */
const seedProviderSpeed = async (repository, providerId, { latencyMs, times = 5, now = 1_800_000_000_000 }) => {
  for (let index = 0; index < times; index += 1) {
    await repository.recordProviderResult({
      providerId,
      attemptId: `seed-${providerId}-${index}`,
      userId: 'usr_seed',
      subjectRef: 'subject_seed',
      channel: VERIFICATION_CHANNELS.OTP,
      success: true,
      reason: 'accepted',
      latencyMs,
      failureThreshold: 3,
      forceCooldown: false,
      cooldownMs: 0,
      now
    });
  }
};

test('a measurably slow slot moves behind the fast one, and only one send leaves', async () => {
  const slow = new MockProvider({ id: 'otp-a' });
  const fast = new MockProvider({ id: 'otp-b' });
  const app = setup({ providers: [slow, fast] });
  await seedProviderSpeed(app.repository, 'otp-a', { latencyMs: 6_000 });
  await seedProviderSpeed(app.repository, 'otp-b', { latencyMs: 400 });

  const result = await app.orchestrator.requestVerification(identity, context);
  assert.equal(result.accepted, true);
  assert.equal(fast.sends.length, 1, 'the fast slot carries the send');
  assert.equal(slow.sends.length, 0, 'the slow slot is behind it, not beside it');
});

test('slots that perform alike keep the operator priority order', async () => {
  const first = new MockProvider({ id: 'otp-a' });
  const second = new MockProvider({ id: 'otp-b' });
  const app = setup({ providers: [first, second] });
  await seedProviderSpeed(app.repository, 'otp-a', { latencyMs: 900 });
  await seedProviderSpeed(app.repository, 'otp-b', { latencyMs: 400 });

  await app.orchestrator.requestVerification(identity, context);
  assert.equal(first.sends.length, 1, 'priority 10 still goes first when the gap is not a problem');
  assert.equal(second.sends.length, 0);
});

test('a slow reading is not trusted until the slot has a few successes', async () => {
  const unproven = new MockProvider({ id: 'otp-a' });
  const fast = new MockProvider({ id: 'otp-b' });
  const app = setup({ providers: [unproven, fast] });
  await seedProviderSpeed(app.repository, 'otp-a', { latencyMs: 6_000, times: 2 });
  await seedProviderSpeed(app.repository, 'otp-b', { latencyMs: 400 });

  await app.orchestrator.requestVerification(identity, context);
  assert.equal(unproven.sends.length, 1, 'two samples are not enough to demote an operator-ordered slot');
  assert.equal(fast.sends.length, 0);
});
