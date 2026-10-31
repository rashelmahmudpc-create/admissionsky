/* A5 / AUTH-ROADMAP step 5 (owner 2026-10-31): forgot password.
 *
 * One thing was true of the reset path before this suite existed, and it was
 * invisible from the outside: the handler answered 202 for a known address, an
 * unknown one and a disabled one alike — correct for the student, but it also
 * meant "the link never arrived" and "there is no such account" left no trace
 * anywhere. The owner had no way to tell a delivery from a refusal.
 *
 * These tests pin the one job the step shipped: the refusal reason reaches the
 * log and the owner's Telegram, and nothing else about the request does.
 *
 * What the step deliberately did NOT ship is recorded in the roadmap and
 * asserted below, because a later reader will otherwise re-propose it: our own
 * password-setting screen needs proof that the caller holds the emailed
 * single-use link, and nothing in this Worker can check that — Firebase only
 * exposes it to its own action page (`accounts:resetPassword` takes the
 * `oobCode`, which the Web API key path never hands back). A screen that took
 * an address and a password without that proof would let anyone who knows a
 * student's address set that student's password, so it is not here.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { sanitizeOtpDeliveryEvent } from './observability/otp-delivery-log.mjs';
import { otpAlertFor, formatOtpAlert } from './observability/otp-alert.mjs';

const read = file => readFileSync(new URL(file, import.meta.url), 'utf8');
const HANDLER = read('./auth-native/worker/public-auth-handler.mjs');
const AUTHORITY = read('./auth-native/worker/auth-authority-do.mjs');
const ROADMAP = read('./docs/AUTH-ROADMAP.md');

test('A5-১: a refused reset leaves a reason code in the log and never an address', () => {
  const record = sanitizeOtpDeliveryEvent({
    evt: 'reset_request', reason: 'USER_DISABLED',
    email: 'student@gmail.com', provider: 'otp-a', label: 'Brevo', method: 'email', purpose: 'password-reset'
  });
  assert.deepEqual(record, { evt: 'reset_request', reason: 'USER_DISABLED' });
  assert.doesNotMatch(JSON.stringify(record), /student@|gmail|Brevo|otp-a/);
});

test('A5-২: an off-list reason is dropped rather than printed', () => {
  // The caller is supposed to pass a code. If it ever passes a message instead,
  // the sanitizer must not become the leak.
  const record = sanitizeOtpDeliveryEvent({ evt: 'reset_request', reason: 'no account for student@gmail.com' });
  assert.deepEqual(record, { evt: 'reset_request' });
  assert.equal(otpAlertFor(record), null);
});

test('A5-৩: a refused reset raises one alert; an accepted one does not', () => {
  const refused = otpAlertFor({ evt: 'reset_request', reason: 'EMAIL_NOT_FOUND' });
  assert.equal(refused.kind, 'reset_refused');
  assert.equal(refused.key, 'reset:EMAIL_NOT_FOUND');
  const text = formatOtpAlert(refused, { evt: 'reset_request', reason: 'EMAIL_NOT_FOUND' }, Date.UTC(2026, 9, 31));
  assert.match(text, /EMAIL_NOT_FOUND/);
  assert.match(text, /202, একই উত্তর/);
  assert.equal(otpAlertFor({ evt: 'reset_request', reason: 'ACCEPTED' }), null);
});

test('A5-৪: the reset path writes the line for accepted, refused and provider-failed alike', () => {
  assert.match(HANDLER, /resetDeliveryEvent\(env, \{ reason: 'ACCEPTED' \}\)/);
  assert.match(HANDLER, /resetDeliveryEvent\(env, \{ reason: privateAccountResult \? cause\.reason : 'PROVIDER_FAILED' \}\)/);
  // The authority owns the sink that reaches Telegram; the public Worker has none.
  assert.match(HANDLER, /callAuthority\(env, '\/internal\/observability\/reset-request'/);
  assert.match(AUTHORITY, /url\.pathname === '\/internal\/observability\/reset-request'/);
  assert.match(AUTHORITY, /this\.otpDeliverySink\(\{ evt: 'reset_request', reason \}\)/);
});

test('A5-৫: the answer to the student is still identical for known, unknown and disabled', () => {
  // The whole reason the reason code is swallowed: enumeration protection. The
  // response body must carry no per-address fact, and the only place the
  // refused reasons may appear is the log call — never in the answer.
  const branch = HANDLER.slice(
    HANDLER.indexOf("url.pathname === `${AUTH_API_PREFIX}/password-reset`"),
    HANDLER.indexOf("url.pathname === `${AUTH_API_PREFIX}/verification/resend`")
  );
  const answer = branch.slice(branch.indexOf('return json(request, 202'));
  assert.match(answer, /accepted: true/);
  assert.match(answer, /deliveryDisclosed: false/);
  assert.doesNotMatch(answer, /email/);
  assert.doesNotMatch(answer, /USER_DISABLED|EMAIL_NOT_FOUND|PROVIDER_FAILED/);
  // The reasons are read off the provider error, never off anything the caller sent.
  assert.match(branch, /cause instanceof FirebaseRequestError/);
});

test('A5-৬: the one sink is shared, so an event cannot raise two Telegram messages', () => {
  // The orchestrator and the reset path both report through the authority. Two
  // sinks would mean two cooldown maps and two messages for the same event.
  assert.equal((AUTHORITY.match(/createOtpDeliverySink\(\{/g) || []).length, 1);
  assert.match(AUTHORITY, /const otpDeliverySink = this\.otpDeliverySink = createOtpDeliverySink\(\{ env, waitUntil/);
  assert.match(AUTHORITY, /onDeliveryEvent: otpDeliverySink/);
});

test('A5-৭: nothing in the reset path can move a password or end a session', () => {
  /* The guard that matters. A password-setting endpoint needs proof that the
   * caller holds the emailed single-use link, and this Worker cannot check one:
   * Firebase's Web API key path issues the link but never returns the oobCode,
   * and `accounts:resetPassword` — which does consume it — is reached from
   * Firebase's own action page. Without that proof, an endpoint that took an
   * address and a password would let a stranger who knows a student's address
   * set that student's password, and one that only revoked sessions would let
   * the same stranger log the student out at will. Neither is here.
   */
  assert.doesNotMatch(HANDLER, /password-reset\/complete/);
  assert.doesNotMatch(HANDLER, /PASSWORD_RESET_EXPIRED/);
  assert.doesNotMatch(HANDLER, /revokeSessionsForReset|revokeSessionsForEmailRef/);
  assert.doesNotMatch(HANDLER, /internal\/session\/revoke-user/);
  assert.doesNotMatch(AUTHORITY, /internal\/session\/revoke-user/);
  assert.doesNotMatch(HANDLER, /accounts:resetPassword/);
  // The reset route still sends exactly one thing: the provider's own mail.
  const branch = HANDLER.slice(
    HANDLER.indexOf("url.pathname === `${AUTH_API_PREFIX}/password-reset`"),
    HANDLER.indexOf("url.pathname === `${AUTH_API_PREFIX}/verification/resend`")
  );
  assert.match(branch, /provider\.sendPasswordResetEmail\(prepared\.email\)/);
  assert.doesNotMatch(branch, /body\?\.password|newPassword/);
});

test('A5-৮: the roadmap step records what shipped and what it deliberately did not', () => {
  // The step keeps the parts that were deliberately NOT done — dropping them
  // would hide why the flow still hands the student to Firebase's own page.
  assert.match(ROADMAP, /### ধাপ ৫: Forgot password/);
  assert.match(ROADMAP, /ইচ্ছাকৃতভাবে বাদ/);
  assert.match(ROADMAP, /oobCode/);
});
