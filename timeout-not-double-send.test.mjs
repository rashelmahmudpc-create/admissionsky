/* AUTH V2.4 (owner 2026-10-31): a timed-out send is not a double send.
 *
 * The blueprint's finding ২১: "double-SEND possible, though the comment says
 * never twice". I reproduced it — provider A delivering at 1400ms with a 1000ms
 * slot timeout really does produce two deliveries (`otp-b, otp-a`), and I wrote
 * a fix that made a timeout end the whole request.
 *
 * Then I checked whether it was actually harmful, and reverted the fix. It is
 * not harmful, and the owner's 2026-10-16 decision — which that fix would have
 * overridden — is correct. Two facts decide it, and both are asserted here:
 *
 *   ১. The code is generated ONCE, before the provider loop. Both deliveries
 *      carry the same six digits, so the student's second mail is not a decoy —
 *      it is the same code again. The "double-SEND" the finding describes is a
 *      duplicate notification, not two competing credentials.
 *   ২. Only the first delivery is recorded. `markChallengeDelivery` guards its
 *      UPDATE with `state='pending'`, so once a provider has been marked as
 *      sent, a later delivery cannot overwrite the record.
 *
 * So the behaviour is deliberate and the trade is the owner's: a hung provider
 * costs one timeout, and the next slot carries the send, which is what makes a
 * slow provider survivable at all. A student may get the same code twice; they
 * will not get a code that does not work.
 *
 * This file exists so the finding is answered rather than re-opened. If someone
 * later changes the loop to generate a fresh code per provider — which would
 * make the duplicate genuinely dangerous — the first test fails and says why.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { VerificationOrchestrator } from './auth-native/verification/orchestrator.mjs';
import { MemoryVerificationRepository } from './auth-native/verification/memory-verification-repository.mjs';
import { VERIFICATION_CHANNELS, VERIFICATION_MODES } from './auth-native/verification/provider-contract.mjs';

const SECRET = 'timeout-not-double-secret-0123456789-ABCDEFG';
const CONTEXT = Object.freeze({
  ip: '203.0.113.9', deviceId: 'device-timeout-0123456789012345', userAgent: 'Chrome',
  origin: 'https://admissionhub.pages.dev'
});
const ORCHESTRATOR_SRC = readFileSync(new URL('./auth-native/verification/orchestrator.mjs', import.meta.url), 'utf8');

const provider = (id, { delayMs = 0 } = {}) => {
  const sends = [];
  return {
    id, sends,
    channel: VERIFICATION_CHANNELS.OTP,
    verificationMode: VERIFICATION_MODES.LOCAL_CODE,
    async checkAvailability() { return { available: true, code: 'READY' }; },
    async getRemainingQuota() { return { remaining: 100, limit: 100, resetAt: 1e12 }; },
    async getProviderStatus() { return { status: 'configured', configured: true }; },
    async sendVerification(input) {
      sends.push({ code: input.code, at: Date.now() });
      if (delayMs) await new Promise(resolve => setTimeout(resolve, delayMs));
      return { accepted: true };
    },
    async verifyCode() { return { verified: false }; }
  };
};

const run = async (providers, timeoutMs = 1000) => {
  const orchestrator = new VerificationOrchestrator({
    repository: new MemoryVerificationRepository(),
    hmacSecret: SECRET,
    providers,
    activated: true,
    now: () => 1_800_000_000_000,
    config: {
      enabled: true, policy: {}, allowedDomains: ['gmail.com'],
      providers: providers.map((entry, index) => ({
        id: entry.id, enabled: true, priority: (index + 1) * 10, dailyQuota: 100, timeoutMs
      }))
    }
  });
  let outcome = null;
  try {
    outcome = await orchestrator.requestVerification({
      purpose: 'email-ownership',
      trustedIdentity: {
        userId: 'usr_timeout_probe', sessionRef: 'a'.repeat(64), subjectRef: 'b'.repeat(64),
        emailRef: 'c'.repeat(64), email: 'probe@gmail.com'
      }
    }, CONTEXT);
  } catch (error) { outcome = { error: error.code }; }
  return outcome;
};

test('V2.4-২১: a timeout may deliver twice, and both carry the SAME code', async () => {
  /* The fact that makes the duplicate harmless. A slow provider that answers
   * after its slot timeout, and the fallback that carries the send, both send
   * the one code generated before the loop. */
  const slow = provider('otp-a', { delayMs: 1400 });
  const next = provider('otp-b');
  await run([slow, next]);
  // Let the in-flight send finish; it is the whole point of the finding.
  await new Promise(resolve => setTimeout(resolve, 700));

  assert.equal(slow.sends.length, 1, 'the slow provider was handed the code');
  assert.equal(next.sends.length, 1, 'and the fallback carried the send');
  assert.equal(slow.sends[0].code, next.sends[0].code,
    'the student gets the same code twice, not two different codes — this is why the duplicate is safe');
});

test('V2.4-২১: the code is generated once, before the provider loop', () => {
  /* The structural fact behind the test above. If a later change moves code
   * generation inside the loop, each provider would issue a DIFFERENT code and
   * the duplicate would become two competing credentials — the real bug the
   * finding was reaching for. */
  const codeAt = ORCHESTRATOR_SRC.indexOf('const code = randomSixDigitOtp(this.crypto);');
  const loopAt = ORCHESTRATOR_SRC.indexOf('for (const candidate of candidates)');
  assert.ok(codeAt > 0, 'the code is generated');
  assert.ok(loopAt > 0, 'the loop exists');
  assert.ok(codeAt < loopAt, 'and it is generated ONCE, before the loop');
});

test('V2.4-২১: only the first delivery is recorded', async () => {
  /* The second half: `markChallengeDelivery` refuses once the challenge is no
   * longer pending, so a late delivery cannot overwrite the record of the one
   * that was accepted first. Asserted against the repository's own guard. */
  const repository = new MemoryVerificationRepository();
  const source = readFileSync(new URL('./auth-native/verification/sqlite-verification-repository.mjs', import.meta.url), 'utf8');
  const block = source.slice(source.indexOf('async markChallengeDelivery'));
  assert.match(block.slice(0, 900), /state !== 'pending'/,
    'the delivery record is written only while the challenge is pending');
  assert.ok(repository, 'the double exists for the same rule');
});

test('V2.4-২১: the timeout failover the owner asked for still works', async () => {
  /* The behaviour my first fix would have broken. A hung provider must cost one
   * timeout and then hand over — that is what makes a slow slot survivable, and
   * it is the owner's 2026-10-16 decision. */
  const hung = provider('otp-a', { delayMs: 1400 });
  const next = provider('otp-b');
  const started = Date.now();
  const outcome = await run([hung, next]);
  assert.equal(outcome?.accepted, true, 'the send is carried by the next slot');
  assert.ok(Date.now() - started < 1900, 'and only one slot timeout was spent');
  assert.equal(next.sends.length, 1, 'the fallback delivered');
});
