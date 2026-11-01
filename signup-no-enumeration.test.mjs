/* AUTH V2.0 (owner 2026-10-31): /signup must not answer "this address exists".
 *
 * Before this change the handler chose its path from a request header. A
 * caller that sent `X-AH-Signup-Flow: pending-v1` got the held signup, which
 * creates nothing and answers 202 for any address. A caller that did not send
 * it — a scraper, a patched client, a cached bundle — fell through to
 * `provider.signUp`, and Firebase's answer came back verbatim: 409 for an
 * address that already has an account, 202 for one that does not. That is a
 * user-enumeration oracle on an endpoint with no authentication, and the
 * entire held-signup design existed to avoid exactly it.
 *
 * The blueprint (docs/AUTH-V2-BLUEPRINT.md, finding ৫) calls for the reset
 * path's rule instead: the same answer whether the address is known or not.
 * The tests below hold that at the HTTP boundary — they drive the real
 * handler, not a slice of it — because the leak lived in the routing decision
 * between two code paths, which is precisely what a unit test of either path
 * would have missed.
 *
 * The 409 is not gone; it moved. It still answers after the emailed code is
 * proven, where the caller has demonstrated they own the mailbox and "you
 * already have an account" tells them nothing a login would not.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { AUTH_API_PREFIX, createNativeAuthHandler } from './auth-native/worker/public-auth-handler.mjs';
import { CloudflareNativeAuthEngine } from './auth-native/core/auth-engine.mjs';
import { MemoryAuthRepository } from './auth-native/testing/memory-auth-repository.mjs';
import { PendingSignupStore } from './auth-native/worker/pending-signup.mjs';
import { handlePendingSignupRoute, isPendingSignupRoute } from './auth-native/worker/pending-signup-authority.mjs';
import { VerificationOrchestrator } from './auth-native/verification/orchestrator.mjs';
import { MemoryVerificationRepository } from './auth-native/verification/memory-verification-repository.mjs';
import { VERIFICATION_CHANNELS, VERIFICATION_MODES } from './auth-native/verification/provider-contract.mjs';

const SECRET = 'signup-no-enumeration-secret-0123456789-ABCDEFGHIJKLM';
const HANDLER_SRC = readFileSync(new URL('./auth-native/worker/public-auth-handler.mjs', import.meta.url), 'utf8');

class MemoryKv {
  constructor() { this.map = new Map(); }
  async get(key) { return this.map.has(key) ? structuredClone(this.map.get(key)) : undefined; }
  async put(key, value) { this.map.set(key, structuredClone(value)); }
  async delete(key) { for (const k of Array.isArray(key) ? key : [key]) this.map.delete(k); }
  async list({ prefix = '' } = {}) {
    return new Map([...this.map].filter(([k]) => k.startsWith(prefix)).map(([k, v]) => [k, structuredClone(v)]));
  }
}

/* A Firebase double whose only interesting behaviour is EMAIL_EXISTS. The point
 * of the test is that this branch is never reached on the signup path any more,
 * so the double records every call and the assertions read that record. */
class FirebaseDouble {
  constructor({ existing = [] } = {}) {
    this.users = new Set(existing.map(value => String(value).toLowerCase()));
    this.calls = [];
    this.sequence = 0;
  }
  async fetch(url, init = {}) {
    const parsed = new URL(url);
    if (parsed.hostname === 'challenges.cloudflare.com') {
      return Response.json({ success: String(init?.body?.get?.('response') || '') === 'turnstile-good-token' });
    }
    const body = JSON.parse(String(init?.body || '{}'));
    this.calls.push(parsed.pathname);
    if (parsed.pathname.endsWith('/accounts:signUp')) {
      const email = String(body.email || '').toLowerCase();
      if (this.users.has(email)) return Response.json({ error: { message: 'EMAIL_EXISTS' } }, { status: 400 });
      this.users.add(email);
      this.sequence += 1;
      return Response.json({
        localId: `firebase-uid-${this.sequence}`,
        idToken: `firebase-id-${this.sequence}-${'i'.repeat(30)}`,
        refreshToken: `firebase-refresh-${this.sequence}-${'r'.repeat(30)}`,
        expiresIn: '3600'
      });
    }
    return Response.json({ error: { message: 'NOT_FOUND' } }, { status: 404 });
  }
}

const signupRequest = (body, { origin = 'https://admissionhub.pages.dev' } = {}) => new Request(
  `https://worker.example${AUTH_API_PREFIX}/signup`,
  {
    method: 'POST',
    headers: {
      Origin: origin,
      'CF-Connecting-IP': '203.0.113.44',
      'User-Agent': 'Mozilla/5.0 Android Chrome/140',
      'X-AH-Auth-UI': 'auth-premium-v6',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  }
);

/* The mailer the held signup walks. It records what it was asked to send so a
 * test can read the real code back out and drive the verify step. */
class SignupOtpProvider {
  constructor(now) {
    this.id = 'otp-a';
    this.channel = VERIFICATION_CHANNELS.OTP;
    this.verificationMode = VERIFICATION_MODES.LOCAL_CODE;
    this.now = now;
    this.sends = [];
  }
  async checkAvailability() { return { available: true, code: 'READY' }; }
  async getRemainingQuota() { return { remaining: 100, limit: 100, resetAt: this.now() + 86_400_000 }; }
  async getProviderStatus() { return { status: 'healthy', configured: true }; }
  async sendVerification(input) { this.sends.push(input); return { accepted: true }; }
  async verifyCode() { return { verified: false }; }
}

/* The one ownership row the held signup writes after the code is proven. */
class FakeOwnershipSql {
  constructor() { this.rows = new Map(); }
  exec(query, ...args) {
    if (query.startsWith('SELECT')) return this.rows.has(args[0]) ? [this.rows.get(args[0])] : [];
    this.rows.set(args[0], { emailRef: args[2], subjectRef: args[1] });
    return [];
  }
}

async function setup({ existing = [] } = {}) {
  let now = 1_800_000_000_000;
  const engine = new CloudflareNativeAuthEngine({
    repository: new MemoryAuthRepository(), hmacSecret: SECRET, now: () => now
  });
  const firebase = new FirebaseDouble({ existing });
  const handler = createNativeAuthHandler({ fetchImpl: firebase.fetch.bind(firebase) });
  const pendingSignups = new PendingSignupStore({ storage: new MemoryKv(), hmacSecret: SECRET, now: () => now });
  // The held signup sends its code through a real orchestrator, so the journey
  // can reach the verify step where a refusal has to keep its error code.
  const otpProvider = new SignupOtpProvider(() => now);
  const verification = new VerificationOrchestrator({
    repository: new MemoryVerificationRepository(),
    hmacSecret: SECRET,
    providers: [otpProvider],
    activated: true,
    now: () => now,
    config: { enabled: true, policy: {}, providers: [{ id: 'otp-a', enabled: true, priority: 10, dailyQuota: 100, timeoutMs: 1000 }] }
  });
  const authority = {
    pendingSignups,
    verification,
    verificationRepository: { sql: new FakeOwnershipSql() },
    idFromName: name => name,
    get() { return { fetch: (request, init) => this.fetch(request instanceof Request ? request : new Request(request, init)) }; },
    async fetch(request) {
      const path = new URL(request.url).pathname;
      const body = request.method === 'GET' ? {} : await request.json();
      try {
        if (isPendingSignupRoute(path)) {
          return Response.json({ ok: true, result: await handlePendingSignupRoute(authority, path, body) });
        }
        if (path === '/internal/firebase/rate') {
          return Response.json({ ok: true, result: await engine.consumeFirebaseOperation(body.input, body.context) });
        }
        return Response.json({ ok: false, error: { code: 'NOT_FOUND' } }, { status: 404 });
      } catch (cause) {
        const status = Number(cause?.status) || 400;
        return Response.json({ ok: false, error: { code: String(cause?.code || 'ERROR'), message: String(cause?.message || '') } }, { status });
      }
    }
  };
  const env = {
    AUTH_AUTHORITY: authority,
    FIREBASE_WEB_API_KEY: 'test-firebase-api-key-1234567890',
    FIREBASE_CONTINUE_URL: 'https://admissionhub.pages.dev/?firebaseVerified=1',
    // Ownership is live in production (verified against /api/auth/v1/config),
    // so the test runs with the same switch the real deployment has on.
    VERIFICATION_AUTH_ACTIVATION: 'enabled'
  };
  return { firebase, handler, env, otpProvider };
}

test('V2.0-৫: a taken address and a free one get the same answer from /signup', async () => {
  const taken = 'already.registered@gmail.com';
  const free = 'brand.new.student@gmail.com';
  const app = await setup({ existing: [taken] });
  const password = 'Correct-Horse-42';

  const known = await app.handler(signupRequest({ email: taken, password }), app.env, {});
  const unknown = await app.handler(signupRequest({ email: free, password }), app.env, {});

  // The oracle was status 409 vs 202. Both are 202 now, and the bodies carry
  // the same keys — nothing in the answer is a function of the address.
  assert.equal(known.status, 202);
  assert.equal(unknown.status, 202);
  const knownBody = await known.json();
  const unknownBody = await unknown.json();
  assert.deepEqual(Object.keys(knownBody).sort(), Object.keys(unknownBody).sort());
  assert.deepEqual(Object.keys(knownBody.verification).sort(), Object.keys(unknownBody.verification).sort());
  assert.equal(knownBody.accountCreated, false);
  assert.equal(unknownBody.accountCreated, false);
  assert.equal(knownBody.verification.selectionRequired, true);
  assert.equal(unknownBody.verification.selectionRequired, true);
  // And the address never comes back, known or unknown.
  assert.equal(JSON.stringify(knownBody).includes(taken), false);
  assert.equal(JSON.stringify(unknownBody).includes(free), false);
});

test('V2.0-৫: signup reaches no Firebase account call at all, so EMAIL_EXISTS cannot answer', async () => {
  const taken = 'already.registered@gmail.com';
  const app = await setup({ existing: [taken] });
  const response = await app.handler(signupRequest({ email: taken, password: 'Correct-Horse-42' }), app.env, {});
  assert.equal(response.status, 202);
  // This is the load-bearing assertion: the branch that produced the 409 is
  // never entered, so the leak cannot come back by a provider answering
  // differently.
  assert.equal(app.firebase.calls.some(path => path.endsWith('/accounts:signUp')), false);
  assert.equal(app.firebase.calls.some(path => path.endsWith('/accounts:sendOobCode')), false);
});

test('V2.0-৫: no header is needed — the held path is the only signup path', async () => {
  // The header used to select the safe path. A caller that omitted it got the
  // leaking one, so the guard was only ever as good as the caller's manners.
  const app = await setup({ existing: ['already.registered@gmail.com'] });
  const request = signupRequest({ email: 'already.registered@gmail.com', password: 'Correct-Horse-42' });
  assert.equal(request.headers.get('X-AH-Signup-Flow'), null);
  const response = await app.handler(request, app.env, {});
  assert.equal(response.status, 202);
  assert.equal((await response.json()).verification.selectionRequired, true);
  assert.equal(app.firebase.calls.some(path => path.endsWith('/accounts:signUp')), false);
});

test('V2.0-৫: the handler no longer reads a signup-flow header, and the module exports none', () => {
  // A guard against the opt-out creeping back: if the header returns, the
  // 409/202 split returns with it. The assertions target the read itself, not
  // the words — the comments here name the header on purpose, so a plain
  // substring check would fail on its own documentation.
  assert.doesNotMatch(HANDLER_SRC, /pendingSignupRequested/);
  assert.doesNotMatch(HANDLER_SRC, /headers\.get\('X-AH-Signup-Flow'\)/);
  const module = readFileSync(new URL('./auth-native/worker/pending-signup-public.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(module, /export const PENDING_SIGNUP_HEADER/);
  assert.doesNotMatch(module, /export const pendingSignupRequested/);
  assert.doesNotMatch(module, /headers\.get\(PENDING_SIGNUP_HEADER\)/);
  // The gate on the held path is the published-ownership switch, not a
  // caller's header — and specifically not `emailOwnershipRequested`, which is
  // also true for `?telegramCanary=1` and would drag the Telegram canary into a
  // path that deliberately offers no Telegram.
  assert.match(HANDLER_SRC, /if \(verificationPublished\(env\)\) return await pendingSignup\.beginPendingSignup\(/);
});

test('V2.0-৫: every held-signup call in the handler is awaited, so a refusal keeps its code', async () => {
  /* Found while making this path the only one. The handler returns these
   * promises from inside its try block without awaiting them, and a `return
   * promise` does not run the catch below it — so a wrong code escaped as an
   * unhandled rejection instead of arriving as OTP_INVALID, and the student saw
   * a 500 where they should have seen "the code is wrong". Latent while the
   * header let most callers take the other path; load-bearing now that they
   * cannot. Pinned both ways: the source must await, and the behaviour must
   * follow. */
  for (const call of ['beginPendingSignup', 'startPendingSignupCode', 'verifyPendingSignupCodeAndCreate', 'savePendingSignupProfile']) {
    const awaited = new RegExp(`return await pendingSignup\\.${call}\\(`);
    const bare = new RegExp(`return pendingSignup\\.${call}\\(`);
    assert.match(HANDLER_SRC, awaited, `${call} must be awaited`);
    assert.doesNotMatch(HANDLER_SRC, bare, `${call} must not be returned un-awaited`);
  }

  const app = await setup({ existing: [] });
  const email = 'awaited.refusal@gmail.com';
  const signup = await app.handler(signupRequest({ email, password: 'Correct-Horse-42' }), app.env, {});
  assert.equal(signup.status, 202);
  const ticket = String(signup.headers.get('Set-Cookie') || '');
  const cookies = ticket.split(/,\s*/).map(part => part.split(';')[0]).join('; ');

  // The code is wrong, so the held-signup store refuses. The answer must be the
  // mapped 401, not an escaped rejection that the runtime reports as a 500.
  const started = await app.handler(new Request(`https://worker.example${AUTH_API_PREFIX}/email-ownership/start`, {
    method: 'POST',
    headers: {
      Origin: 'https://admissionhub.pages.dev', 'CF-Connecting-IP': '203.0.113.44',
      'User-Agent': 'Mozilla/5.0 Android Chrome/140', 'X-AH-Auth-UI': 'auth-premium-v6',
      'Content-Type': 'application/json', Cookie: cookies
    },
    body: JSON.stringify({})
  }), app.env, {});
  assert.equal(started.status, 202);
  const attemptId = (await started.json()).ownership?.attemptId;
  const wrongCode = (await app.handler(new Request(`https://worker.example${AUTH_API_PREFIX}/email-ownership/verify`, {
    method: 'POST',
    headers: {
      Origin: 'https://admissionhub.pages.dev', 'CF-Connecting-IP': '203.0.113.44',
      'User-Agent': 'Mozilla/5.0 Android Chrome/140', 'X-AH-Auth-UI': 'auth-premium-v6',
      'Content-Type': 'application/json', Cookie: cookies
    },
    body: JSON.stringify({ attemptId, code: '000000' })
  }), app.env, {}));
  // A mapped refusal — any auth error code is fine, an unhandled throw is not.
  assert.equal(wrongCode.status, 401);
  assert.equal((await wrongCode.json()).error.code, 'OTP_INVALID');
});

test('V2.0-৫: the 409 still exists where it is safe — after the code proves the mailbox', () => {
  // Deliberately not removed: once the caller has proven they own the address,
  // "this account already exists" is information a login would give them.
  // Deleting the code entirely would trade an enumeration leak for a signup
  // that silently does nothing.
  const errors = readFileSync(new URL('./auth-native/core/errors.mjs', import.meta.url), 'utf8');
  assert.match(errors, /EMAIL_ALREADY_IN_USE: 'EMAIL_ALREADY_IN_USE'/);
  assert.match(errors, /\[AUTH_ERROR_CODES\.EMAIL_ALREADY_IN_USE\]: Object\.freeze\(\{ status: 409/);
  const module = readFileSync(new URL('./auth-native/worker/pending-signup-public.mjs', import.meta.url), 'utf8');
  // The account is created after verification, and that is where a duplicate
  // address is discovered.
  assert.match(module, /export async function verifyPendingSignupCodeAndCreate/);
  assert.match(module, /async function createAccount/);
});
