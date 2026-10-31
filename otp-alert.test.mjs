import test from 'node:test';
import assert from 'node:assert/strict';
import { createOtpDeliverySink, otpAlertFor, OTP_ALERT_COOLDOWN_MS } from './observability/otp-alert.mjs';
import { sanitizeOtpDeliveryEvent } from './observability/otp-delivery-log.mjs';

const quiet = { log() {}, warn() {} };
const env = { TG_BOT_TOKEN: `123456:${'A'.repeat(35)}`, TG_CHAT_ID: '8160600900' };
const setup = (extra = {}) => {
  const sent = []; const jobs = []; let clock = 1_000_000;
  const onEvent = createOtpDeliverySink({
    env, sink: quiet, now: () => clock, waitUntil: p => jobs.push(p),
    send: async args => { sent.push(args); return { sent: true, messageId: 1 }; }, ...extra
  });
  return { onEvent, sent, jobs, tick: ms => { clock += ms; } };
};

test('alert rules: provider failed, all failed, slow >30s; normal sends stay quiet', () => {
  const r = e => otpAlertFor(sanitizeOtpDeliveryEvent(e));
  assert.equal(r({ evt: 'otp_delivery', provider: 'otp-a', outcome: 'failed', reason: 'PROVIDER_TIMEOUT', latencyMs: 8000 }).kind, 'provider_failed');
  assert.equal(r({ evt: 'otp_request', outcome: 'all_failed', totalMs: 9000 }).kind, 'all_failed');
  assert.equal(r({ evt: 'otp_request', outcome: 'sent', provider: 'otp-e', totalMs: 31000 }).kind, 'slow');
  assert.equal(r({ evt: 'otp_request', outcome: 'sent', provider: 'otp-e', totalMs: 4000 }), null);
  assert.equal(r({ evt: 'otp_delivery', provider: 'otp-a', outcome: 'accepted', latencyMs: 900 }), null);
  assert.equal(r({ evt: 'otp_delivery', provider: 'otp-a', outcome: 'quota_exhausted' }), null);
});

test('failure goes to Telegram once per cooldown, without address or code', async () => {
  const { onEvent, sent, jobs, tick } = setup();
  const failed = { evt: 'otp_delivery', provider: 'otp-a', outcome: 'failed', reason: 'PROVIDER_TIMEOUT', latencyMs: 8000, attempt: 'abcdefghijkl', email: 'student@gmail.com', code: '123456' };
  onEvent(failed); onEvent(failed);
  await Promise.all(jobs);
  assert.equal(sent.length, 1);
  assert.match(sent[0].message, /Brevo/);
  assert.match(sent[0].message, /PROVIDER_TIMEOUT/);
  assert.doesNotMatch(sent[0].message, /student@|123456|abcdefghijkl/);
  tick(OTP_ALERT_COOLDOWN_MS + 1);
  onEvent(failed);
  await Promise.all(jobs);
  assert.equal(sent.length, 2);
});

test('missing Telegram secrets (staging) and Telegram errors never break the send path', async () => {
  const noSecrets = createOtpDeliverySink({ env: {}, sink: quiet, send: () => { throw new Error('must not send'); } });
  assert.equal(noSecrets({ evt: 'otp_request', outcome: 'all_failed' }).outcome, 'all_failed');
  const warns = [];
  const { onEvent, jobs } = setup({ sink: { log() {}, warn: l => warns.push(l) }, send: async () => { const e = new Error('x'); e.code = 'PROVIDER_REJECTED'; throw e; } });
  assert.doesNotThrow(() => onEvent({ evt: 'otp_request', outcome: 'all_failed', totalMs: 9000 }));
  await Promise.all(jobs);
  assert.ok(warns.some(l => JSON.parse(l).evt === 'otp_alert_failed'));
});

/* A4 / AU-OB-02 (owner 2026-10-31): a slow or failed send is only actionable if
   the owner can see which faster slots never got a turn. The alert carries the
   same skip reasons the delivery log does, in one short line. */
test('a slow-send alert names the slots that were passed over and why', async () => {
  const { onEvent, sent, jobs } = setup();
  onEvent({
    evt: 'otp_request', outcome: 'sent', provider: 'otp-y', totalMs: 31000,
    candidates: 1, tried: 'otp-y:ok', skipped: 'otp-a:provider-quota,otp-b:unavailable'
  });
  await Promise.all(jobs);
  assert.equal(sent.length, 1);
  assert.match(sent[0].message, /বাদ পড়েছে: otp-a:provider-quota,otp-b:unavailable/);
  assert.match(sent[0].message, /চেষ্টা: otp-y:ok/);
});
