/* AUTH V2.4 (owner 2026-10-31): the dashboard says which slots have delivered.
 *
 * The blueprint's finding ২৫: `liveDeliveryVerified` is never true, so the admin
 * cannot tell a slot that has carried a real code from one that has only ever
 * been configured.
 *
 * The owner's decision on the provider chain is to keep the unproven slots and
 * put them BEHIND the proven ones rather than delete them — "বাদ দেওয়ার দরকার
 * নাই, অচলগুলো পিছনে থাকবে". That decision needs a screen he can make it from,
 * and a table where all 26 rows read "configured" is not one.
 *
 * This is a reporting change and nothing else. It adds no ordering rule, because
 * two attempts at an automatic reorder were reverted for a real reason: provider
 * health is tracked per provider, not per destination, so "Appwrite delivered to
 * iCloud" says nothing about whether it should jump ahead of Brevo for a Gmail
 * address — and the owner's priority order is the product of his own testing.
 * Ordering stays his; this makes the evidence he needs visible.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { VerificationOrchestrator } from './auth-native/verification/orchestrator.mjs';
import { MemoryVerificationRepository } from './auth-native/verification/memory-verification-repository.mjs';
import {
  VERIFICATION_CHANNELS, VERIFICATION_FAILURE_CLASS, VERIFICATION_MODES, VerificationProviderError
} from './auth-native/verification/provider-contract.mjs';

const SECRET = 'proven-visible-secret-0123456789-ABCDEFGHIJKLMNOP';
const NOW = 1_800_000_000_000;

class MockProvider {
  constructor({ id, plan = [] } = {}) {
    this.id = id;
    this.channel = VERIFICATION_CHANNELS.OTP;
    this.verificationMode = VERIFICATION_MODES.LOCAL_CODE;
    this.plan = [...plan];
    this.sends = [];
  }
  async checkAvailability() { return { available: true, code: 'READY' }; }
  async getRemainingQuota() { return { remaining: 100, limit: 100, resetAt: NOW + 86_400_000 }; }
  async getProviderStatus() { return { status: 'configured', configured: true }; }
  async sendVerification(input) {
    this.sends.push(input);
    const next = this.plan.shift() || 'ok';
    // The real error class, not a shape-alike: the orchestrator classifies by
    // `instanceof`, so a plain object would be read as an unexpected failure and
    // the fixture would prove something other than what it claims.
    if (next === 'fail') throw new VerificationProviderError('PROVIDER_REJECTED', VERIFICATION_FAILURE_CLASS.HARD);
    return { accepted: true };
  }
  async verifyCode() { return { verified: false }; }
}

const setup = ({ providers, plan = {} } = {}) => {
  const repository = new MemoryVerificationRepository();
  const rows = providers.map(id => ({ id, enabled: true, priority: 10, dailyQuota: 100, timeoutMs: 1000 }));
  const orchestrator = new VerificationOrchestrator({
    repository,
    hmacSecret: SECRET,
    providers: providers.map(id => new MockProvider({ id, plan: plan[id] || [] })),
    activated: true,
    now: () => NOW,
    config: { enabled: true, policy: {}, providers: rows, allowedDomains: ['gmail.com'] }
  });
  return { orchestrator, repository };
};

/* The refs must be the 64-char HMAC shapes the orchestrator validates, and the
 * purpose needs its destination allowlisted — a fixture that skips either fails
 * for a reason unrelated to what is under test. Copied from the established
 * helper in verification-orchestrator.test.mjs rather than invented. */
/* The orchestrator validates the request context (a device id of the right
 * shape), so a fixture that omits it fails before reaching any provider — for a
 * reason that has nothing to do with what is under test. */
const CONTEXT = Object.freeze({
  ip: '203.0.113.9', deviceId: 'device-proven-0123456789012345', userAgent: 'Chrome',
  origin: 'https://admissionhub.pages.dev'
});

const identity = () => Object.freeze({
  purpose: 'email-ownership',
  trustedIdentity: {
    userId: 'usr_proven_visible', sessionRef: 'a'.repeat(64), subjectRef: 'b'.repeat(64),
    emailRef: 'c'.repeat(64), email: 'proven@gmail.com'
  }
});

test('V2.4-২৫: a slot that has never sent is reported as never-tried, not as unproven-by-failure', async () => {
  /* The distinction an operator needs. "We have not tested this" and "this did
   * not work" call for different actions, and a single `false` collapses them. */
  const { orchestrator } = setup({ providers: ['otp-a', 'otp-b'] });
  const status = await orchestrator.adminStatus();
  for (const provider of status.providers) {
    assert.equal(provider.proven, false, `${provider.id} has not sent anything`);
    assert.equal(provider.deliveryEvidence, 'never-tried', `${provider.id} must say never-tried`);
  }
});

test('V2.4-২৫: a slot that carried a code is reported as proven', async () => {
  const { orchestrator } = setup({ providers: ['otp-a', 'otp-b'] });
  await orchestrator.requestVerification(identity(), CONTEXT);

  const status = await orchestrator.adminStatus();
  const sent = status.providers.find(provider => provider.health.successCount > 0);
  assert.ok(sent, 'exactly one slot carried the send');
  assert.equal(sent.proven, true, 'and it is reported as proven');
  assert.equal(sent.deliveryEvidence, 'proven', 'with the evidence it rests on');

  // The other slot is still never-tried, not failed — it was never reached.
  const untouched = status.providers.find(provider => provider.id !== sent.id);
  assert.equal(untouched.proven, false);
  assert.equal(untouched.deliveryEvidence, 'never-tried', 'a slot that was not reached is not a failed slot');
});

test('V2.4-২৫: a slot that was tried and refused is reported as failed, not as never-tried', async () => {
  /* This is the case the owner needs to see: a slot the chain DID try and which
   * did not work. It is the difference between "move this to the back" and
   * "nobody has ever looked at this". */
  const { orchestrator } = setup({ providers: ['otp-a'], plan: { 'otp-a': ['fail', 'fail'] } });
  await orchestrator.requestVerification(identity(), CONTEXT).catch(() => {});
  const status = await orchestrator.adminStatus();
  const row = status.providers[0];
  assert.ok(row.health.failureCount > 0, 'the failure was recorded');
  assert.equal(row.proven, false);
  assert.equal(row.deliveryEvidence, 'failed', 'a tried slot is not never-tried');
});

test('V2.4-২৫: the verdict is a boolean an operator can filter on, and the count still ships', async () => {
  /* `proven` is the single word; the raw counters stay, so the claim can be
   * checked rather than trusted. A verdict that replaced its own evidence would
   * be a verdict nobody could audit. */
  const { orchestrator } = setup({ providers: ['otp-a'] });
  await orchestrator.requestVerification(identity(), CONTEXT);
  const row = (await orchestrator.adminStatus()).providers[0];
  assert.equal(typeof row.proven, 'boolean');
  assert.equal(typeof row.deliveryEvidence, 'string');
  assert.equal(typeof row.health.successCount, 'number', 'the evidence behind the verdict is still reported');
  assert.equal(row.health.successCount > 0, row.proven, 'and it agrees with the verdict');
});

test('V2.4: the ordering is still the owner\'s — this change adds no reorder', async () => {
  /* Pinned deliberately. Two attempts at an automatic reorder were written and
   * reverted during this work: provider health is tracked per provider, not per
   * destination, so a slot proven for iCloud is not thereby proven for Gmail, and
   * demoting the owner's first choice on that basis broke a deliberate decision
   * he had made from his own testing. If a later change reintroduces an
   * automatic reorder, it must say so here. */
  const { orchestrator } = setup({ providers: ['otp-a', 'otp-b'] });
  // otp-a has priority 10 in this fixture and otp-y also 10, so the tiebreak is
  // the id — which is the documented behaviour, unchanged by this work.
  await orchestrator.requestVerification(identity(), CONTEXT);
  const first = (await orchestrator.adminStatus()).providers.find(p => p.health.successCount > 0);
  assert.equal(first.id, 'otp-a', 'the operator order still decides, not delivery history');
});
