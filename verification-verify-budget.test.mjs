/* AUTH V2.0 (owner 2026-10-31): the verify call gets the same ceiling as send.
 *
 * `requestVerification` bounds every provider call by the shared delivery budget
 * (25s by default) so a slow chain cannot turn a signup into a minute-long
 * spinner. `verify` is the other call the student waits on — they are sitting in
 * front of a code box — and it had no such bound: it used the slot's own
 * timeoutMs, which may be 20 seconds. A single hung provider could therefore
 * hold a verification for longer than the entire budget the send path promises.
 *
 * These tests drive a provider that never answers and assert what the student
 * experiences: the call returns within the budget, and the slot is recorded as
 * having failed rather than left in limbo.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { VerificationOrchestrator } from './auth-native/verification/orchestrator.mjs';
import { MemoryVerificationRepository } from './auth-native/verification/memory-verification-repository.mjs';
import { VERIFICATION_CHANNELS, VERIFICATION_MODES, VERIFICATION_FAILURE_CLASS, VerificationProviderError } from './auth-native/verification/provider-contract.mjs';

const SECRET = 'verify-budget-secret-0123456789-ABCDEFGHIJKLMNOP';
const BUDGET_MS = 3_000;   // the config floor, and well under the slot's own 20s

// The identity a challenge is bound to. verify() re-derives it from the request
// context and the session token, so the fixture must present the same one.
const identity = Object.freeze({
  sessionToken: `session-${'s'.repeat(48)}`,
  subject: 'firebase-uid-verify-budget',
  userId: 'usr_canonical_verify_budget',
  email: 'budget.student@example.com',
  purpose: 'account-backup'
});

// A provider whose verifyCode never resolves. Its own timeout is 20s while the
// budget is 3s, so WHICH bound is applied is observable in the elapsed time:
// without the fix this call sits on the provider for 20s.
class HangingProvider {
  constructor(id, timeoutMs) {
    Object.assign(this, { id, channel: VERIFICATION_CHANNELS.OTP, verificationMode: VERIFICATION_MODES.PROVIDER_EVIDENCE, timeoutMs, verifies: 0 });
  }
  async checkAvailability() { return { available: true, code: 'READY' }; }
  async getRemainingQuota() { return { remaining: 100, limit: 100, resetAt: 0 }; }
  async getProviderStatus() { return { status: 'healthy', configured: true }; }
  async sendVerification() { return { accepted: true }; }
  verifyCode() { this.verifies += 1; return new Promise(() => {}); }
}

const config = () => ({
  enabled: true,
  policy: { deliveryBudgetMs: BUDGET_MS },
  providers: [{
    id: 'otp-h', enabled: true, priority: 15, dailyQuota: 1000,
    timeoutMs: 20_000, verificationMode: VERIFICATION_MODES.PROVIDER_EVIDENCE
  }]
});

const setup = () => {
  const repository = new MemoryVerificationRepository();
  const provider = new HangingProvider('otp-h', 20_000);
  const orchestrator = new VerificationOrchestrator({
    repository,
    hmacSecret: SECRET,
    config: config(),
    activated: true,
    providers: [provider]
  });
  return { repository, provider, orchestrator };
};

const context = Object.freeze({
  ip: '203.0.113.9',
  deviceId: 'device-verify-budget-0123456789',
  userAgent: 'Chrome',
  origin: 'https://admissionsky.pages.dev'
});

// A challenge the student is answering, created through the real send path so
// the record is exactly what verify reads.
// verify() re-derives the identity from the request, so it must be given the
// same subject/email the challenge was created with, plus the attempt id.
const challengeFor = async orchestrator => {
  const sent = await orchestrator.requestVerification(identity, context);
  return { ...sent, attemptId: sent.attemptId, identity };
};
const verifyInput = sent => ({ ...identity, attemptId: sent.attemptId, code: '123456' });

test('V2.0-২২: a hung provider cannot hold verify past the delivery budget', async () => {
  const { orchestrator, repository } = setup();
  const sent = await challengeFor(orchestrator);
  assert.ok(sent.attemptId, 'the fixture has a live challenge');

  const started = Date.now();
  await assert.rejects(
    () => orchestrator.verify(verifyInput(sent), context),
    () => true,
    'a provider that never answers must surface as a failure, not hang'
  );
  const elapsed = Date.now() - started;
  // Without the bound this waits out the slot's own 20s timeout. With it, the
  // 3s budget decides. The margin allows for scheduling noise.
  assert.ok(elapsed < 10_000,
    `verify returned in ${elapsed}ms; the slot's own timeout is 20s, so anything near that means the budget did not bind`);
  assert.ok(elapsed >= BUDGET_MS - 500,
    `verify returned in ${elapsed}ms, which is before the ${BUDGET_MS}ms budget — the call was cut short rather than bounded`);
});

test('V2.0-২৩: the hung slot is recorded as a failure, not left in limbo', async () => {
  const { orchestrator, repository, provider } = setup();
  const sent = await challengeFor(orchestrator);
  await orchestrator.verify(verifyInput(sent), context).catch(() => {});

  assert.equal(provider.verifies, 1, 'the slot was tried exactly once');
  const state = await repository.providerSnapshot({ providerId: 'otp-h', now: Date.now() });
  assert.ok(state.failureCount + state.userErrorCount >= 1,
    'a provider that never answered must not look healthy afterwards');
});

test('V2.0-২৪: the bound is the budget, not the slot timeout', async () => {
  /* Stated as a property of the code so a later edit cannot quietly swap the
     slot's own timeout back in. */
  const { readFileSync } = await import('node:fs');
  const source = readFileSync(new URL('./auth-native/verification/orchestrator.mjs', import.meta.url), 'utf8');
  const start = source.indexOf('async verify(');
  assert.ok(start > -1, 'verify still exists');
  const body = source.slice(start, source.indexOf('\n  async ', start + 10));
  assert.match(body, /deliveryBudgetMs/, 'verify must read the shared delivery budget');
  assert.match(body, /Math\.min\(entry\.timeoutMs, Math\.max\(1, verifyDeadline - Date\.now\(\)\)\)/,
    'and bound the provider call by the earlier of the two');
});
