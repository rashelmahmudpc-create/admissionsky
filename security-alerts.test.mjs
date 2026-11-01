import test from 'node:test';
import assert from 'node:assert/strict';
import {
  deliverSecurityAlert,
  maskAlertEmail,
  renderSecurityAlert,
  sendSecurityAlert,
  sendSecurityAlertInBackground,
  sendThrottledSecurityAlert,
  createKvAlertThrottle,
  SECURITY_ALERT_EVENTS
} from './auth-native/core/security-alerts.mjs';

const env = { TG_BOT_TOKEN: 'test-token-not-real', TG_CHAT_ID: '123456' };

test('an email is masked before it reaches the owner', () => {
  assert.equal(maskAlertEmail('student@example.com'), 's******@example.com');
  assert.equal(maskAlertEmail('a@example.com'), 'a***@example.com');
  assert.equal(maskAlertEmail('NOT-AN-EMAIL'), '');
  assert.equal(maskAlertEmail(''), '');
});

test('a canary alert names the event and the masked account', () => {
  const rendered = renderSecurityAlert({ event: SECURITY_ALERT_EVENTS.CANARY_HIT, email: 'admin@example.com' });
  assert.ok(rendered);
  assert.ok(rendered.text.includes('ক্যানারি'));
  assert.ok(rendered.text.includes('a****@example.com'));
  assert.ok(!rendered.text.includes('admin@example.com'), 'the raw address must never be in the message');
});

test('a shadow-ban alert carries the band and the reasons', () => {
  const rendered = renderSecurityAlert({
    event: SECURITY_ALERT_EVENTS.SHADOW_BAN,
    email: 'student@example.com',
    band: 'high',
    reasons: ['new-device', 'country-changed'],
    at: 1_700_000_000_000
  });
  assert.ok(rendered.text.includes('high'));
  assert.ok(rendered.text.includes('new-device, country-changed'));
  assert.ok(rendered.text.includes('2023-11-14'));
});

test('an unknown event renders nothing', () => {
  assert.equal(renderSecurityAlert({ event: 'made-up' }), null);
  assert.equal(renderSecurityAlert({}), null);
});

test('control characters are stripped from an attacker-controlled field', () => {
  const rendered = renderSecurityAlert({
    event: SECURITY_ALERT_EVENTS.NEW_DEVICE,
    email: 'student@example.com',
    country: 'BD\u0000\u001b[31mX'
  });
  assert.ok(!/[\u0000\u001b]/.test(rendered.text));
});

test('a long reason list is capped', () => {
  const rendered = renderSecurityAlert({
    event: SECURITY_ALERT_EVENTS.SHADOW_BAN,
    reasons: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']
  });
  assert.ok(rendered.text.includes('a, b, c, d, e'));
  assert.ok(!rendered.text.includes('f'));
});

test('a missing secret reports not-configured and never throws', async () => {
  assert.equal(await sendSecurityAlert({}, { event: SECURITY_ALERT_EVENTS.CANARY_HIT }), 'not-configured');
  assert.equal(await sendSecurityAlert({ TG_BOT_TOKEN: 'x' }, { event: SECURITY_ALERT_EVENTS.CANARY_HIT }), 'not-configured');
});

test('a sent alert reports sent', async () => {
  let seen = null;
  const fetchImpl = async (url, init) => {
    seen = { url, body: JSON.parse(init.body) };
    return { ok: true };
  };
  const result = await sendSecurityAlert(env, { event: SECURITY_ALERT_EVENTS.CANARY_HIT, email: 'a@b.com' }, { fetchImpl });
  assert.equal(result, 'sent');
  assert.ok(seen.url.startsWith('https://api.telegram.org/bot'));
  assert.equal(seen.body.chat_id, '123456');
  assert.ok(!seen.url.includes('undefined'));
});

test('a telegram failure is a value, not an exception', async () => {
  const throwing = async () => {
    throw new Error('network down');
  };
  assert.equal(await sendSecurityAlert(env, { event: SECURITY_ALERT_EVENTS.NEW_DEVICE }, { fetchImpl: throwing }), 'failed');
  const bad = async () => ({ ok: false, status: 500 });
  assert.equal(await sendSecurityAlert(env, { event: SECURITY_ALERT_EVENTS.NEW_DEVICE }, { fetchImpl: bad }), 'failed');
});

test('the background wrapper never rejects', async () => {
  const throwing = async () => {
    throw new Error('boom');
  };
  assert.equal(await sendSecurityAlertInBackground(env, { event: SECURITY_ALERT_EVENTS.NEW_DEVICE }, { fetchImpl: throwing }), 'failed');
});

// --- the throttle -------------------------------------------------------------

// A minimal in-memory KV, enough to exercise the throttle's contract.
const fakeStore = () => {
  const rows = new Map();
  return {
    rows,
    async get(key) {
      return rows.get(key) ?? null;
    },
    async put(key, value, options) {
      rows.set(key, value);
      return options;
    }
  };
};

test('a burst of identical events collapses to one alert', async () => {
  const store = fakeStore();
  let sends = 0;
  const fetchImpl = async () => {
    sends += 1;
    return { ok: true };
  };
  const input = { event: SECURITY_ALERT_EVENTS.SHADOW_BAN, email: 'student@example.com' };
  const results = [];
  for (let i = 0; i < 5; i += 1) {
    results.push(await sendThrottledSecurityAlert(env, store, input, { fetchImpl }));
  }
  assert.equal(results[0], 'sent');
  assert.deepEqual(results.slice(1), ['throttled', 'throttled', 'throttled', 'throttled']);
  assert.equal(sends, 1, 'only the first alert reaches Telegram');
});

test('a different account is not throttled by another account burst', async () => {
  const store = fakeStore();
  const fetchImpl = async () => ({ ok: true });
  const first = await sendThrottledSecurityAlert(env, store, { event: SECURITY_ALERT_EVENTS.SHADOW_BAN, email: 'a@example.com' }, { fetchImpl });
  const second = await sendThrottledSecurityAlert(env, store, { event: SECURITY_ALERT_EVENTS.SHADOW_BAN, email: 'b@example.com' }, { fetchImpl });
  assert.equal(first, 'sent');
  assert.equal(second, 'sent');
});

test('a different event type is throttled separately', async () => {
  const store = fakeStore();
  const fetchImpl = async () => ({ ok: true });
  const ban = await sendThrottledSecurityAlert(env, store, { event: SECURITY_ALERT_EVENTS.SHADOW_BAN, email: 'a@example.com' }, { fetchImpl });
  const device = await sendThrottledSecurityAlert(env, store, { event: SECURITY_ALERT_EVENTS.NEW_DEVICE, email: 'a@example.com' }, { fetchImpl });
  assert.equal(ban, 'sent');
  assert.equal(device, 'sent');
});

test('the stored key never contains the address', async () => {
  const throttle = createKvAlertThrottle(fakeStore());
  const key = await throttle.keyFor(SECURITY_ALERT_EVENTS.CANARY_HIT, 'student@example.com');
  assert.ok(!key.includes('student'));
  assert.ok(!key.includes('@'));
  assert.ok(key.startsWith('alert-seen:canary-hit:'));
});

test('a store that cannot read never swallows an alert', async () => {
  const broken = {
    async get() {
      throw new Error('kv down');
    },
    async put() {
      throw new Error('kv down');
    }
  };
  const fetchImpl = async () => ({ ok: true });
  assert.equal(await sendThrottledSecurityAlert(env, broken, { event: SECURITY_ALERT_EVENTS.CANARY_HIT, email: 'a@example.com' }, { fetchImpl }), 'sent');
});

test('without a store the alert is still sent', async () => {
  const fetchImpl = async () => ({ ok: true });
  assert.equal(await sendThrottledSecurityAlert(env, null, { event: SECURITY_ALERT_EVENTS.CANARY_HIT, email: 'a@example.com' }, { fetchImpl }), 'sent');
});

/* ── AUTH V2.1: a lost alert is no longer a silence ─────────────────────────
 *
 * The blueprint's finding ৪. Every call site fired the alert promise and threw
 * the result away, so a failure became the string 'failed' that nobody read.
 * The handler sites did not even hand the promise to waitUntil — and a
 * Cloudflare Worker cancels work still pending when the response returns, so an
 * alert could be dropped before the fetch was ever made. The owner's whole
 * security channel could go quiet and nothing would say so.
 *
 * These tests hold the two halves of the fix: the promise is registered with
 * waitUntil where the runtime offers one, and the outcome is reported —
 * including 'failed' — so a dropped alert is a fact somebody can count.
 */

test('V2.1: the send is registered with waitUntil, so the Worker cannot cancel it', async () => {
  const registered = [];
  const waitUntil = promise => registered.push(promise);
  const fetchImpl = async () => ({ ok: true });
  const job = deliverSecurityAlert({
    env, store: null, waitUntil, options: { fetchImpl },
    input: { event: SECURITY_ALERT_EVENTS.CANARY_HIT, email: 'a@example.com' }
  });
  assert.equal(registered.length, 1, 'the promise must be handed to the runtime');
  assert.equal(await job, 'sent');
  assert.equal(await registered[0], 'sent', 'and it is the same promise, not a copy');
});

test('V2.1: a failed alert is reported, not swallowed', async () => {
  const outcomes = [];
  const fetchImpl = async () => { throw new Error('telegram down'); };
  const result = await deliverSecurityAlert({
    env, store: null, options: { fetchImpl },
    onOutcome: (outcome, input) => outcomes.push([outcome, input.event]),
    input: { event: SECURITY_ALERT_EVENTS.CANARY_HIT, email: 'a@example.com' }
  });
  assert.equal(result, 'failed', 'the caller still gets the value it always got');
  assert.deepEqual(outcomes, [['failed', SECURITY_ALERT_EVENTS.CANARY_HIT]],
    'and the failure is now a fact somebody can count');
});

test('V2.1: a throttled repeat is reported as throttled, not as a failure', async () => {
  const outcomes = [];
  const store = { async get() { return '1'; }, async put() {} };
  const fetchImpl = async () => ({ ok: true });
  const result = await deliverSecurityAlert({
    env, store, options: { fetchImpl },
    onOutcome: outcome => outcomes.push(outcome),
    input: { event: SECURITY_ALERT_EVENTS.CANARY_HIT, email: 'a@example.com' }
  });
  assert.equal(result, 'throttled');
  assert.deepEqual(outcomes, ['throttled'], 'the throttle is visible too, and distinct from a loss');
});

test('V2.1: a reporter that throws cannot break the alert or the request', async () => {
  // The whole point is that alerting never takes a student down, so a broken
  // reporter must be as harmless as a broken provider.
  const fetchImpl = async () => ({ ok: true });
  const result = await deliverSecurityAlert({
    env, store: null, options: { fetchImpl },
    onOutcome: () => { throw new Error('reporter exploded'); },
    input: { event: SECURITY_ALERT_EVENTS.CANARY_HIT, email: 'a@example.com' }
  });
  assert.equal(result, 'sent');
});

test('V2.1: a broken sender is a value, never an exception', async () => {
  // sendThrottledSecurityAlert is written not to throw, but a future edit could
  // change that, and an alert that throws into a login path is the failure this
  // helper exists to prevent.
  const outcomes = [];
  const result = await deliverSecurityAlert({
    env, store: null, options: { fetchImpl: null },
    onOutcome: outcome => outcomes.push(outcome),
    input: { event: SECURITY_ALERT_EVENTS.CANARY_HIT, email: 'a@example.com' }
  });
  assert.equal(typeof result, 'string', 'it resolves, it does not reject');
});
