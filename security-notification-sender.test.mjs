/* AUTH V2.1 (owner 2026-10-31): the security notice actually goes out.
 *
 * Phase 6 built the notification boundary and shipped it dry-run with
 * `securityNotificationSender = null` on the Durable Object. Everything worked
 * except the point of the feature: `password-changed`, `new-device-login` and
 * `suspicious-activity` were rendered, counted, and dropped. The blueprint's
 * finding ৩ — a feature that exists in name only.
 *
 * These tests hold the three things that make the wiring safe to turn on:
 *
 *   ১. the notice is rendered and handed to a sender (it was not before);
 *   ২. the recipient reaches the sender as an ENVELOPE and never as content —
 *      the renderer still refuses a raw address, which is the boundary that
 *      made this look impossible to wire;
 *   ৩. nothing about a missing gateway, a missing address or a failing provider
 *      can throw into the auth path.
 *
 * They also pin the default: with the activation flag unset, nothing sends.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { dispatchSecurityNotifications, renderSecurityNotification } from './auth-native/core/security-notifications.mjs';
import { createSecurityNotificationSender, notificationRequestId, SECURITY_ALERT_EMAIL_TYPE } from './auth-native/core/security-notification-sender.mjs';

const DO_SRC = readFileSync(new URL('./auth-native/worker/auth-authority-do.mjs', import.meta.url), 'utf8');
const AT = 1_800_000_000_000;
const MASK = 's***@gmail.com';
const ADDRESS = 'student@gmail.com';

const event = (extra = {}) => ({
  eventType: 'new-device-login', emailMasked: MASK, recipient: ADDRESS, at: AT, ...extra
});

/* ── ১. the notice is actually dispatched ────────────────────────────────── */

test('V2.1-১: a security event reaches a sender once the deployment opts in', async () => {
  const seen = [];
  const result = await dispatchSecurityNotifications({
    events: [event()],
    dryRun: false,
    sendSecurityEmail: async (item, envelope) => { seen.push({ item, envelope }); return { ok: true }; }
  });
  assert.equal(result.dryRun, false);
  assert.equal(result.requested, 1);
  assert.equal(result.skipped, 0);
  assert.deepEqual(result.sent, [{ template: 'security-new-device-login', ok: true }]);
  assert.equal(seen.length, 1, 'the sender was called exactly once');
  assert.equal(seen[0].envelope.recipient, ADDRESS, 'and it got the address it needs');
});

test('V2.1-১: dry-run still sends nothing, so the flag remains the gate', async () => {
  let calls = 0;
  const result = await dispatchSecurityNotifications({
    events: [event()], dryRun: true, sendSecurityEmail: async () => { calls += 1; return { ok: true }; }
  });
  assert.equal(calls, 0, 'dry-run must not reach the sender');
  assert.equal(result.dryRun, true);
  assert.equal(result.requested, 1, 'but it still renders, so the count is visible');
});

/* ── ২. the address is an envelope, never content ────────────────────────── */

test('V2.1-২: the recipient never enters the rendered body', async () => {
  // The renderer fails closed on a raw address. That is the contract this whole
  // design works around: the body is PII-free, the envelope carries the address.
  assert.throws(
    () => renderSecurityNotification({ eventType: 'new-device-login', emailMasked: MASK, email: ADDRESS }),
    /raw email is not allowed/,
    'the renderer still refuses a raw address'
  );
  const item = renderSecurityNotification({ eventType: 'new-device-login', emailMasked: MASK, at: AT, recipient: ADDRESS });
  assert.ok(item, 'the envelope field does not break rendering');
  assert.equal(JSON.stringify(item).includes(ADDRESS), false, 'and the address is not in the body');
  assert.equal(item.emailMasked, MASK, 'only the mask travels in the content');
});

test('V2.1-২: the sender puts the address in the gateway recipient, never in variables', async () => {
  const sent = [];
  const sender = createSecurityNotificationSender({ send: async request => { sent.push(request); return { ok: true }; } });
  const item = renderSecurityNotification({ eventType: 'new-device-login', emailMasked: MASK, at: AT });
  const result = await sender(item, { recipient: ADDRESS });
  assert.equal(result.ok, true);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].recipient, ADDRESS, 'the address is the envelope');
  assert.equal(sent[0].type, SECURITY_ALERT_EMAIL_TYPE);
  assert.equal(sent[0].template, SECURITY_ALERT_EMAIL_TYPE);
  assert.equal(JSON.stringify(sent[0].variables).includes(ADDRESS), false, 'and never the content');
  // The gateway's SECURITY_ALERT template accepts exactly activity and time.
  assert.deepEqual(Object.keys(sent[0].variables).sort(), ['activity', 'time']);
});

test('V2.1-২: a caller cannot smuggle an address through the body', async () => {
  // If the renderer ever stopped refusing raw addresses, this is the test that
  // would still hold the line: the envelope is read from the event's own
  // `recipient` field, so text an attacker puts in the event cannot become the
  // delivery address.
  const seen = [];
  await dispatchSecurityNotifications({
    events: [{
      eventType: 'new-device-login', emailMasked: MASK, at: AT,
      body: 'please mail sneaky@evil.com', recipient: ADDRESS
    }],
    dryRun: false,
    sendSecurityEmail: async (item, envelope) => { seen.push({ item, envelope }); return { ok: true }; }
  });
  assert.equal(seen[0].envelope.recipient, ADDRESS, 'the envelope is the real recipient, not the body text');
  // The rendered body comes from the catalog, so caller text never becomes
  // content either — the notice reads the same whatever a caller sends.
  assert.equal(seen[0].item.body.includes('sneaky@evil.com'), false, 'caller text does not become content');
});

/* ── ৩. nothing can throw into the auth path ─────────────────────────────── */

test('V2.1-৩: a missing address is a value, not a throw', async () => {
  const sender = createSecurityNotificationSender({ send: async () => ({ ok: true }) });
  for (const envelope of [undefined, {}, { recipient: '' }, { recipient: 'not-an-email' }, { recipient: 'a@b' }]) {
    const result = await sender({ eventType: 'new-device-login', subject: 's', body: 'b', at: AT }, envelope);
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'recipient-unavailable');
  }
});

test('V2.1-৩: a provider failure is reported as a code and never quotes the address', async () => {
  const sender = createSecurityNotificationSender({
    send: async () => { throw Object.assign(new Error(`rejected ${ADDRESS}`), { code: 'PROVIDER_REJECTED' }); }
  });
  const result = await sender({ eventType: 'new-device-login', subject: 's', body: 'b', at: AT }, { recipient: ADDRESS });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'PROVIDER_REJECTED');
  assert.equal(JSON.stringify(result).includes(ADDRESS), false, 'the address must not appear in the result');
});

test('V2.1-৩: a hung provider is abandoned, not awaited forever', async () => {
  // A send that never resolves would leak a pending promise per login, so the
  // timeout is load-bearing rather than defensive.
  const sender = createSecurityNotificationSender({
    send: () => new Promise(() => {}),
    timeoutMs: 5
  });
  const result = await sender({ eventType: 'new-device-login', subject: 's', body: 'b', at: AT }, { recipient: ADDRESS });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'send-timeout');
});

test('V2.1-৩: a dispatcher that is handed no sender reports it instead of throwing', async () => {
  const result = await dispatchSecurityNotifications({ events: [event()], dryRun: false, sendSecurityEmail: null });
  assert.deepEqual(result.sent, [{ template: 'security-new-device-login', ok: false, reason: 'sender-not-configured' }]);
});

/* ── the composition root ────────────────────────────────────────────────── */

test('V2.1: the sender is built at the composition root and stays gated', () => {
  // The wiring has to live where both halves are available: the DO holds the
  // real recipient and the EMAIL_COORDINATOR binding the OTP chain delivers
  // through. Asserted as source because the alternative — a live gateway — is
  // not something a unit test can stand up.
  assert.match(DO_SRC, /createSecurityNotificationSender\(\{ send: gateway\.send \}\)/);
  assert.match(DO_SRC, /if \(!this\.securityNotificationsDryRun\)/,
    'the gateway is only built when the deployment opted in');
  // Two assignments: the initial null, and the one in the catch. A gateway that
  // cannot be built must leave the sender null rather than a half-built one.
  assert.equal((DO_SRC.match(/this\.securityNotificationSender = null;/g) || []).length, 2,
    'a gateway that cannot be built leaves the sender null');
  assert.match(DO_SRC, /this\.securityNotificationFailure = String\(error/,
    'and records why, as a code, without an address');
  // Every dispatch site carries the recipient, or the notice has no address.
  const sites = DO_SRC.split('#dispatchSecurityEvents([').length - 1;
  const withRecipient = DO_SRC.split('recipient: String(body.input?.email').length - 1;
  assert.equal(sites, withRecipient, 'every dispatch site passes the real recipient');
  assert.ok(sites >= 3, 'the three Phase 6 sites are still wired');
});

test('V2.1: the request id is stable for one event, so a retry is idempotent', () => {
  const first = notificationRequestId({ eventType: 'new-device-login', at: AT, recipientRef: MASK });
  const again = notificationRequestId({ eventType: 'new-device-login', at: AT, recipientRef: MASK });
  const other = notificationRequestId({ eventType: 'new-device-login', at: AT + 1, recipientRef: MASK });
  assert.equal(first, again, 'the same event must not produce two emails');
  assert.notEqual(first, other, 'a different event is a different request');
  // The gateway validates its own pattern; a mismatch would refuse every send.
  assert.match(first, /^[A-Za-z0-9][A-Za-z0-9:_-]{15,127}$/);
});
