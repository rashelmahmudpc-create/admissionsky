/* A5 / AUTH-ROADMAP step 5 (owner 2026-10-31): forgot password.
 *
 * Two things were true of the reset path before this suite existed, and both
 * were invisible from the outside:
 *   1. The handler answered 202 for a known address, an unknown one and a
 *      disabled one alike — correct, but it also meant "the link never arrived"
 *      and "there is no such account" left no trace anywhere.
 *   2. Nothing ended the sessions an account still held. Firebase revokes its
 *      own refresh tokens when the password changes; our session rows are ours.
 *
 * These tests pin the three jobs the step actually shipped: the refusal reason
 * reaches the log and nothing else does, the reset screen enforces the strength
 * rules Firebase's own page does not, and the sessions are closed.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { sanitizeOtpDeliveryEvent } from './observability/otp-delivery-log.mjs';
import { otpAlertFor, formatOtpAlert } from './observability/otp-alert.mjs';
import { AUTH_ERROR_CODES, NativeAuthError } from './auth-native/core/errors.mjs';

const read = file => readFileSync(new URL(file, import.meta.url), 'utf8');
const HANDLER = read('./auth-native/worker/public-auth-handler.mjs');
const AUTHORITY = read('./auth-native/worker/auth-authority-do.mjs');
const CLIENT = read('./account-access.js');
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
    HANDLER.indexOf("url.pathname === `${AUTH_API_PREFIX}/password-reset/complete`")
  );
  const answer = branch.slice(branch.indexOf('return json(request, 202'));
  assert.match(answer, /accepted: true/);
  assert.match(answer, /deliveryDisclosed: false/);
  assert.doesNotMatch(answer, /email/);
  assert.doesNotMatch(answer, /USER_DISABLED|EMAIL_NOT_FOUND|PROVIDER_FAILED/);
  // The reasons are read off the provider error, never off anything the caller sent.
  assert.match(branch, /cause instanceof FirebaseRequestError/);
});

test('A5-৬: a reset closes every session the account holds, without a step-up gate', () => {
  // Unlike /session/logout-all (which is step-up gated because it is asked for
  // from inside a session), the reset path proves the address with a
  // single-use link and has no session to challenge.
  const engine = read('./auth-native/core/auth-engine.mjs');
  const method = engine.slice(engine.indexOf('async revokeSessionsAfterPasswordReset'));
  const body = method.slice(0, method.indexOf('\n  ping()'));
  assert.match(body, /revokeSessionsForEmailRef/);
  assert.doesNotMatch(body, /#assertStepUp/);
  // It has to work with no session at all: the sessions it closes are ones the
  // caller cannot see.
  assert.doesNotMatch(body, /sessionToken/);
  assert.match(AUTHORITY, /'\/internal\/session\/revoke-user'/);
  assert.match(AUTHORITY, /hmac\.hex\('email-ref-v1', normalizeAuthEmail\(body\.input\?\.email\)\)/);
  assert.match(HANDLER, /revokeSessionsForReset\(env, prepared\.email\)/);
});

test('A5-৭: the repository closes the rows by address, in both implementations', () => {
  const sqlite = read('./auth-native/storage/sqlite-auth-repository.mjs');
  const memory = read('./auth-native/testing/memory-auth-repository.mjs');
  for (const source of [sqlite, memory]) assert.match(source, /async revokeSessionsForEmailRef\(\{ emailRef, now \}\)/);
  assert.match(sqlite, /UPDATE auth_sessions SET revoked_at=\? WHERE user_id=\? AND revoked_at IS NULL/);
  assert.match(read('./auth-native/core/auth-engine.mjs'), /'revokeSessionsForEmailRef'/);
});

test('A5-৮: the reset screen enforces the rules Firebase\'s own page does not', () => {
  assert.match(CLIENT, /data-view="reset"/);
  assert.match(CLIENT, /api\/password-reset\/complete|'\/password-reset\/complete'/);
  // Strength meter and rule list, scoped so the signup screen keeps its own.
  assert.match(CLIENT, /data-password-meter="reset"/);
  assert.match(CLIENT, /data-password-rule="length" data-password-scope="reset"/);
  assert.match(CLIENT, /updatePasswordFeedback\('reset'\)/);
  // Breach check, k-anonymity only.
  assert.match(CLIENT, /api\.pwnedpasswords\.com\/range\/\$\{hash\.slice\(0, 5\)\}/);
  assert.doesNotMatch(CLIENT, /pwnedpasswords\.com\/range\/\$\{hash\}/);
  // A positive hit blocks the submit; an outage never does.
  assert.match(CLIENT, /state\.resetBreach === 'breached'/);
  assert.match(CLIENT, /catch \(_\) \{ return 'unknown'; \}/);
});

test('A5-৯: the server refuses a short password before any provider call', () => {
  const route = HANDLER.slice(HANDLER.indexOf("`${AUTH_API_PREFIX}/password-reset/complete`"));
  const guard = route.indexOf('PASSWORD_MIN');
  const send = route.indexOf('sendPasswordResetEmail');
  assert.ok(guard > -1 && send > guard, 'the length check must come before the provider call');
  assert.match(route, /AUTH_ERROR_CODES\.WEAK_PASSWORD/);
  // Firebase will not issue a second link while one is unspent, which is what
  // makes "accepted" here mean a live link exists.
  assert.match(route, /AUTH_ERROR_CODES\.PASSWORD_RESET_EXPIRED/);
  assert.match(read('./auth-native/core/errors.mjs'), /PASSWORD_RESET_EXPIRED: 'PASSWORD_RESET_EXPIRED'/);
});

test('A5-১০: returning from the reset link drops the dead session', () => {
  assert.match(CLIENT, /const dropStaleResetCookies = \(\) => \{/);
  const uses = (CLIENT.match(/dropStaleResetCookies\(\);/g) || []).length;
  // both bootstrap branches + the submit handler (the definition has no semicolon)
  assert.ok(uses >= 3, `expected the cleanup on every reset return, found ${uses}`);
  // The auth cookies are HttpOnly: client code cannot clear them, and the
  // tab-storage invariant forbids caching an address there. Both jobs go
  // through the server route that already owns them.
  const body = CLIENT.slice(CLIENT.indexOf('const dropStaleResetCookies'), CLIENT.indexOf('const completeLogoutAll'));
  assert.match(body, /api\('\/session\/logout', \{ method: 'POST', body: \{\} \}\)/);
  assert.doesNotMatch(body, /document\.cookie/);
  assert.doesNotMatch(CLIENT, /RESET_EMAIL_KEY/);
});

test('A5-১১: the new view and error code are registered on the client', () => {
  assert.match(CLIENT, /SKY_ROUTED_VIEWS = new Set\(\['login', 'signup', 'forgot', 'reset'/);
  assert.match(CLIENT, /PASSWORD_RESET_EXPIRED: 'Reset link-এর সময় শেষ/);
});

test('A5-১২: the roadmap step records what shipped and what it deliberately did not', () => {
  // The step keeps the parts that were deliberately NOT done (Descope in front,
  // the custom action URL) — dropping them would hide why the flow still hands
  // the student to Firebase's own page.
  assert.match(ROADMAP, /### ধাপ ৫: Forgot password/);
  assert.match(ROADMAP, /নিজেদের `\/reset` পাতা/);
});

test('A5-১৩: the new error code carries a safe status and a student-facing message', () => {
  const error = new NativeAuthError(AUTH_ERROR_CODES.PASSWORD_RESET_EXPIRED);
  assert.equal(error.status, 403);
  assert.match(error.message, /Reset link/);
  assert.equal(error.safe, true);
  assert.doesNotMatch(JSON.stringify(error.toPublic()), /firebase|provider|stack/i);
});
