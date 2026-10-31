import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { emitOtpDeliveryEvent, sanitizeOtpDeliveryEvent } from './observability/otp-delivery-log.mjs';

test('otp delivery log keeps provider, outcome and timing only', () => {
  const record = sanitizeOtpDeliveryEvent({
    evt: 'otp_delivery', provider: 'otp-a', outcome: 'accepted', latencyMs: 812.4, rank: 1, try: 1,
    attempt: 'abcdefghijklmnop', purpose: 'email-ownership',
    email: 'student@gmail.com', code: '123456', linkToken: 'secret', destination: 'student@gmail.com'
  });
  assert.deepEqual(record, {
    evt: 'otp_delivery', provider: 'otp-a', name: 'Brevo', outcome: 'accepted', latencyMs: 812, rank: 1, try: 1,
    attempt: 'abcdefgh', purpose: 'email-ownership'
  });
  assert.doesNotMatch(JSON.stringify(record), /student@|123456|secret/);
});

test('unknown events are dropped and failures go to warn', () => {
  assert.equal(sanitizeOtpDeliveryEvent({ evt: 'other', provider: 'otp-a' }), null);
  const lines = { log: [], warn: [] };
  const sink = { log: line => lines.log.push(line), warn: line => lines.warn.push(line) };
  emitOtpDeliveryEvent({ evt: 'otp_request', outcome: 'all_failed', tried: 'otp-a:PROVIDER_TIMEOUT', totalMs: 9000 }, sink);
  emitOtpDeliveryEvent({ evt: 'otp_request', outcome: 'sent', provider: 'otp-e', totalMs: 1200 }, sink);
  assert.equal(lines.warn.length, 1);
  assert.equal(lines.log.length, 1);
  assert.equal(JSON.parse(lines.log[0]).name, 'AgentMail');
});

test('auth-native stays free of logging primitives; the orchestrator only uses the injected sink', () => {
  const orchestrator = readFileSync(new URL('./auth-native/verification/orchestrator.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(orchestrator, /console\.(log|info|warn|error|debug)\s*\(/);
  assert.match(orchestrator, /this\.onDeliveryEvent\?\.\(/);
  const authority = readFileSync(new URL('./auth-native/worker/auth-authority-do.mjs', import.meta.url), 'utf8');
  // The authority owns exactly one sink, built once and shared: the
  // orchestrator gets it for provider tries, the step-5 reset path for its
  // reason codes. Two sinks would mean two cooldown maps and two Telegram
  // messages for the same event.
  assert.match(authority, /const otpDeliverySink = this\.otpDeliverySink = createOtpDeliverySink\(\{ env, waitUntil/);
  assert.match(authority, /onDeliveryEvent: otpDeliverySink/);
  assert.equal((authority.match(/createOtpDeliverySink\(\{/g) || []).length, 1);
});
