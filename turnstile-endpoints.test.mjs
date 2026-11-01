import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// A1.5 / AU-SEC-01 L4 (+ L3, L5): every public endpoint that can send an
// email/OTP or try a password must clear the bot gate — honeypot and form
// speed first, then Turnstile — before doing any work of its own.
//
// The routes used to each call verifyTurnstile() inline. They now call the one
// shared `guardSend`, which runs the L5 gate and then the L4 human check with
// the L3 strictness flag. Asserting on the shared call is the stronger test:
// it proves the gate ran, not merely that a token was checked, and it keeps a
// new route from copying half the sequence.
const HANDLER = readFileSync(new URL('./auth-native/worker/public-auth-handler.mjs', import.meta.url), 'utf8');
const CLIENT = readFileSync(new URL('./account-access.js', import.meta.url), 'utf8');

/* AUTH V2.0 (owner 2026-10-31): /google/link and /facebook were the two
 * credential-taking routes missing from this list. /google/link takes an email
 * AND a password, so password guessing there leaned on the rate limiter alone.
 * Both are here now, and the client sends the token on all four of their call
 * sites (two for /facebook, one for /google/link, one on the Sky bridge) — the
 * two halves ship together because the guard fails closed once the secret is
 * bound, and it is bound in production. */
const ENDPOINTS = ['/signup', '/login', '/password-reset', '/email-ownership/start', '/verification/resend', '/telegram/verification/start', '/backup/request', '/google/link', '/facebook'];

const routeBlock = path => {
  const marker = "request.method === 'POST' && url.pathname === `${AUTH_API_PREFIX}" + path + '`';
  const start = HANDLER.indexOf(marker);
  assert.ok(start > 0, `route ${path} exists`);
  const next = HANDLER.indexOf('if (request.method ===', start + marker.length);
  return HANDLER.slice(start, next > 0 ? next : undefined);
};

test('the shared bot gate really is honeypot-then-human-check, in that order', () => {
  const gate = HANDLER.slice(HANDLER.indexOf('const guardSend ='), HANDLER.indexOf('const shadowGuardStore'));
  assert.ok(gate.includes('botGate('), 'the L5 honeypot/speed gate runs');
  assert.ok(gate.includes('verifyTurnstile('), 'the L4 human check runs');
  assert.ok(gate.indexOf('botGate(') < gate.indexOf('verifyTurnstile('),
    'a submission already known to be automated must not pay for a siteverify round trip');
  assert.match(gate, /required = requiresHardHumanCheck\(context\)/,
    'L3: a hosting ASN forces the strict human check');
  assert.match(gate, /\(await fuzzBandNow\(env\)\) === 'hard'/,
    'L8: a nearly-exhausted provider quota forces the same strict check');
});

for (const path of ENDPOINTS) {
  test(`server runs the bot gate on ${path} before any provider/authority call`, () => {
    const block = routeBlock(path);
    const check = block.indexOf('await guardSend(');
    assert.ok(check > 0, `${path} calls the shared bot gate`);
    for (const work of ['callAuthority(', 'provider.signUp(', 'provider.signIn(', 'provider.sendPasswordResetEmail(', 'firebaseReadySession(']) {
      const at = block.indexOf(work);
      if (at > 0) assert.ok(check < at, `${path}: the gate runs before ${work}`);
    }
  });
}

test('every guarded route answers the gate short-circuit instead of falling through', () => {
  // A gate whose 202 was ignored would be worse than none: the request would
  // continue and the OTP would still be sent.
  const guarded = HANDLER.split('await guardSend(').length - 1;
  const handled = HANDLER.split('if (denied) return denied;').length - 1;
  assert.equal(guarded, ENDPOINTS.length, 'one gate call per guarded endpoint');
  assert.equal(handled, ENDPOINTS.length, 'every gate call is checked');
});

test('client sends a fresh Turnstile token on every guarded call', () => {
  // Every guarded endpoint, so a route added to ENDPOINTS without its client
  // half fails here rather than locking students out in production.
  for (const path of ENDPOINTS) {
    const needle = `'${path}'`;
    let at = CLIENT.indexOf(needle);
    let seen = 0;
    while (at >= 0) {
      if (/(?:api|skyApi|backupApiPath)\($/.test(CLIENT.slice(Math.max(0, at - 14), at))) {
        seen += 1;
        assert.ok(CLIENT.slice(at, at + 260).includes('turnstileToken: await humanToken()'), `${path} call near offset ${at} sends a token`);
      }
      at = CLIENT.indexOf(needle, at + needle.length);
    }
    assert.ok(seen > 0, `client calls ${path}`);
  }
});

// Owner report 2026-10-24: signup stopped right after the confirm-password
// field with "তথ্যটি ভুল". The server was answering INVALID_INPUT for a failed
// human check, which the client had no mapping for, so it showed the generic
// "write the information correctly" banner and the student re-typed a form that
// was never the problem. These two guards keep that dead end from returning.
test('a failed human check carries its own error code end to end', () => {
  assert.ok(CLIENT.includes('HUMAN_CHECK_FAILED:'), 'friendlyError maps the human-check code');
  assert.ok(!/INVALID_INPUT:\s*'[^']*মানব যাচাই/.test(CLIENT), 'the human-check message is not attached to INVALID_INPUT');
});

// Owner order 2026-11-01 (voice): "make it visible for everyone so students can
// click". The previous shape only enlarged itself *after* Cloudflare announced a
// challenge, and it was pinned to the bottom of the screen -- on a phone the
// keyboard covered it, so the tap could not be made and the check timed out.
// The box is now always visible and pinned above the keyboard.
test('the human check can actually be completed when Cloudflare asks for a tap', () => {
  assert.ok(CLIENT.includes("appearance: 'always'"), 'the widget is visible before a challenge, not only after one');
  assert.ok(CLIENT.includes('visualViewport'), 'the box is pinned above the on-screen keyboard');
  assert.ok(!/size: 'invisible'/.test(CLIENT), 'an invisible widget cannot show an interaction challenge');
  assert.ok(!/appearance: 'interaction-only'/.test(CLIENT), 'an interaction-only widget renders nothing until challenged, so a covered box has no second chance');
});
