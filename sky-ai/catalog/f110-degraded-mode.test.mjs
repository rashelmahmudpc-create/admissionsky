/* F1.10 — Degraded Mode: exhaustion says which failure it was.
 *
 * Every exhausted-chain path reported `provider_failed` with "AI একটু ব্যস্ত,
 * কয়েক সেকেন্ড পরে আবার চেষ্টা করো" — a busy/transient message — whatever had
 * actually happened. When the failures were credential failures (401/402/403)
 * the AI is not busy: its keys are dead.
 *
 * That is the worst kind of wrong message: it tells the student to retry in a
 * few seconds, so they loop on something that cannot succeed, and it hides a
 * real operations problem behind a reassuring sentence.
 *
 * These tests hold the property: a total credential failure reads differently
 * from a busy provider, one surviving key is enough to make it "busy", and both
 * the streaming and one-shot paths classify identically.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { degradedOutcome, CREDENTIAL_STATUSES } from '../../ai-agent.js';

const src = readFileSync(new URL('../../ai-agent.js', import.meta.url), 'utf8');

test('a total credential failure is not reported as "busy"', () => {
  /* The regression this file exists for. */
  const out = degradedOutcome(4, 4);
  assert.equal(out.error, 'provider_unconfigured');
  assert.equal(out.retryable, false, 'a dead key cannot be retried into working');
  assert.equal(out.status, 503);
  assert.ok(!/ব্যস্ত/.test(out.message), 'must not say busy: ' + out.message);
});

test('a genuinely busy provider still reads as busy and retryable', () => {
  const out = degradedOutcome(4, 0);
  assert.equal(out.error, 'provider_failed');
  assert.equal(out.retryable, true, 'a transient failure should invite a retry');
  assert.equal(out.status, 502);
  assert.ok(/ব্যস্ত/.test(out.message), 'the busy message is correct here');
});

test('one surviving key makes it busy, not unconfigured', () => {
  /* Mixed evidence is not a configuration fault. If even one provider failed for
     a transient reason, the retry advice is still the right advice. */
  assert.equal(degradedOutcome(4, 3).error, 'provider_failed');
  assert.equal(degradedOutcome(1, 0).error, 'provider_failed');
});

test('nothing tried is not a configuration verdict', () => {
  /* An empty attempt set proves nothing about the keys, so it must not accuse
     them. (An empty chain is answered earlier, as no_providers.) */
  assert.equal(degradedOutcome(0, 0).error, 'provider_failed');
});

test('429 and 5xx are transient, so `bad` could not be the test', () => {
  /* Why this reads `status` and not the existing `bad` flag: `bad` is true for
     429 and 5xx too, and those really are transient. Only 401/402/403 mean the
     credential is dead. */
  assert.deepEqual([...CREDENTIAL_STATUSES], [401, 402, 403]);
  assert.equal(CREDENTIAL_STATUSES.includes(429), false);
  assert.equal(CREDENTIAL_STATUSES.includes(500), false);
});

test('both exhaustion paths classify through the same helper', () => {
  /* A student must not get "busy" on one transport and "off" on the other for
     the same outage. Neither path may hand-write the verdict any more. */
  const calls = (src.match(/degradedOutcome\(/g) || []).length;
  assert.ok(calls >= 3, 'the definition plus both call sites, found ' + calls);
  assert.ok(!/s\.error\(\{ error: 'provider_failed'/.test(src),
    'the stream path must not hard-code the busy verdict');
});
