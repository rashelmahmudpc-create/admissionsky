// AUTH-ROADMAP step 1 (করণীয় ৩–৪): DO routes + handler flow for the held signup.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AUTH_ERROR_CODES, NativeAuthError } from './auth-native/core/errors.mjs';
import { VerificationOrchestrator } from './auth-native/verification/orchestrator.mjs';
import { MemoryVerificationRepository } from './auth-native/verification/memory-verification-repository.mjs';
import { VERIFICATION_CHANNELS, VERIFICATION_FAILURE_CLASS, VERIFICATION_MODES, VerificationProviderError } from './auth-native/verification/provider-contract.mjs';
import { PendingSignupStore, isPendingSignupTicket } from './auth-native/worker/pending-signup.mjs';
import { handlePendingSignupRoute, isPendingSignupRoute } from './auth-native/worker/pending-signup-authority.mjs';
import * as flow from './auth-native/worker/pending-signup-public.mjs';

const SECRET = 'pending-signup-secret-0123456789-ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const context = Object.freeze({ ip: '203.0.113.9', deviceId: 'device-pending-signup-0123456789', userAgent: 'Chrome', isNewDevice: false });
const EMAIL = 'new.student@gmail.com';
const PASSWORD = 'Strong-Pass-123';

class MemoryKv {
  constructor() { this.map = new Map(); }
  async get(key) { return this.map.has(key) ? structuredClone(this.map.get(key)) : undefined; }
  async put(key, value) { this.map.set(key, structuredClone(value)); }
  async delete(key) { for (const k of Array.isArray(key) ? key : [key]) this.map.delete(k); }
  async list({ prefix = '' } = {}) { return new Map([...this.map].filter(([k]) => k.startsWith(prefix)).map(([k, v]) => [k, structuredClone(v)])); }
}

class MockProvider {
  constructor({ id, down = false }) { Object.assign(this, { id, down, channel: VERIFICATION_CHANNELS.OTP, verificationMode: VERIFICATION_MODES.LOCAL_CODE, sends: [] }); }
  async checkAvailability() { return { available: true, code: 'READY' }; }
  async getRemainingQuota() { return { remaining: 100, limit: 100, resetAt: 1_900_000_000_000 }; }
  async getProviderStatus() { return { status: 'healthy', configured: true }; }
  async sendVerification(input) {
    this.sends.push(input);
    if (this.down) throw new VerificationProviderError('HARD_DOWN', VERIFICATION_FAILURE_CLASS.HARD);
    return { accepted: true };
  }
  async verifyCode() { return { verified: false }; }
}

class FakeSql {
  constructor() { this.rows = new Map(); }
  exec(query, ...args) {
    if (query.startsWith('SELECT')) return this.rows.has(args[0]) ? [this.rows.get(args[0])] : [];
    this.rows.set(args[0], { subjectRef: args[1], emailRef: args[2], providerId: args[3] });
    return [];
  }
}

const setup = ({ down = false } = {}) => {
  const provider = new MockProvider({ id: 'otp-a', down });
  const verification = new VerificationOrchestrator({
    repository: new MemoryVerificationRepository(),
    hmacSecret: SECRET,
    config: { enabled: true, policy: {}, providers: [{ id: 'otp-a', enabled: true, priority: 10, dailyQuota: 100, timeoutMs: 1000 }] },
    providers: [provider],
    activated: true,
    onDeliveryEvent: () => {}
  });
  const sql = new FakeSql();
  const calls = [];
  const accounts = new Map();
  const authority = {
    pendingSignups: new PendingSignupStore({ storage: new MemoryKv(), hmacSecret: SECRET }),
    verification,
    verificationRepository: { sql },
    engine: {
      async getFirebaseAccountVerification(ticket, input) {
        const row = accounts.get(ticket);
        if (!row || row.email !== input.email || row.subject !== input.subject) throw new NativeAuthError(AUTH_ERROR_CODES.TELEGRAM_VERIFICATION_INVALID);
        return { userId: row.userId, subjectRef: `sub:${row.subject}`, emailRef: `email:${row.email}` };
      }
    }
  };
  const callAuthority = async (env, path, body) => {
    calls.push(path);
    if (isPendingSignupRoute(path)) return JSON.parse(JSON.stringify(await handlePendingSignupRoute(authority, path, JSON.parse(JSON.stringify(body)))));
    if (path === '/internal/firebase/account-verification/begin') {
      const ticket = `real${'x'.repeat(44)}${accounts.size}`;
      accounts.set(ticket, { email: body.input.email, subject: body.input.subject, userId: `usr_${accounts.size}` });
      return { verificationTicket: ticket };
    }
    if (path === '/internal/profile/save-pending') return { saved: true, profile: body.input };
    if (path === '/internal/firebase/account-verification/complete') return { sessionToken: 's', user: { id: accounts.get(body.input.verificationTicket).userId }, created: false };
    throw new Error(`unexpected ${path}`);
  };
  const firebase = { signUps: [], links: [], deleted: 0,
    async signUp(email, password) { this.signUps.push({ email, password }); return { subject: `fb-${this.signUps.length}`, idToken: 'id-token', refreshToken: 'refresh-token-0123456789-abcdef' }; },
    async sendVerificationEmail(idToken, email) { this.links.push(email); },
    async deleteAccount() { this.deleted += 1; } };
  const deps = {
    callAuthority,
    json: (request, status, body, headers = {}) => ({ status, body, headers }),
    authSuccess: (request, established, refreshToken, ctx, verification, cookies) => ({ status: 200, body: { authenticated: true, user: established.user, ...verification }, cookies }),
    verificationCookie: (token, maxAge = 900) => `__Host-ah_verification=${token}; Max-Age=${maxAge}`,
    deviceCookie: token => `__Host-ah_device=${token}`,
    providerError: cause => cause
  };
  // AUTH V2.0: no opt-in header any more — the plain signup request is the one
  // that has to hold the credentials, or the 409/202 split comes back.
  const request = new Request('https://admissionsky.pages.dev/api/auth/v1/signup');
  return { authority, provider, sql, calls, firebase, deps, request, env: {} };
};

const begin = async app => {
  const response = await flow.beginPendingSignup({ request: app.request, env: app.env, context, prepared: { email: EMAIL, emailMask: 'n***@gmail.com' }, password: PASSWORD, deps: app.deps });
  const ticket = response.headers['Set-Cookie'][0].split(';')[0].split('=')[1];
  return { response, ticket };
};

test('signup holds the credentials: no Firebase call, p. ticket, telegram off, no password in the response', async () => {
  const app = setup();
  const { response, ticket } = await begin(app);
  assert.equal(response.status, 202);
  assert.equal(response.body.accountCreated, false);
  assert.equal(response.body.verification.selectionRequired, true);
  assert.equal(response.body.verification.options.telegram.available, false);
  assert.ok(isPendingSignupTicket(ticket));
  assert.equal(app.firebase.signUps.length, 0);
  assert.ok(!JSON.stringify(response).includes(PASSWORD));
  const saved = await flow.savePendingSignupProfile({ request: app.request, env: app.env, context, ticket, profile: { fullName: 'রিয়া' }, deps: app.deps });
  assert.equal(saved.body.saved, true);
});

test('a wrong code creates no account; the right one creates it once, links ownership, then clears the row', async () => {
  const app = setup();
  const { ticket } = await begin(app);
  await flow.savePendingSignupProfile({ request: app.request, env: app.env, context, ticket, profile: { fullName: 'রিয়া' }, deps: app.deps });
  const started = await flow.startPendingSignupCode({ request: app.request, env: app.env, provider: app.firebase, context, ticket, magicLink: false, deps: app.deps });
  assert.equal(started.body.delivery.method, 'email-otp');
  const attemptId = started.body.ownership.attemptId;
  const code = String(app.provider.sends[0].code || app.provider.sends[0].otp || '').trim();
  assert.match(code, /^\d{6}$/);
  const wrong = code === '000000' ? '111111' : '000000';
  await assert.rejects(flow.verifyPendingSignupCodeAndCreate({ request: app.request, env: app.env, provider: app.firebase, context, ticket, attemptId, code: wrong, deps: app.deps }), e => e?.code === AUTH_ERROR_CODES.OTP_INVALID);
  assert.equal(app.firebase.signUps.length, 0);
  app.calls.length = 0;
  const done = await flow.verifyPendingSignupCodeAndCreate({ request: app.request, env: app.env, provider: app.firebase, context, ticket, attemptId, code, deps: app.deps });
  assert.equal(done.status, 200);
  assert.equal(done.body.emailOwnershipProven, true);
  assert.deepEqual(app.firebase.signUps, [{ email: EMAIL, password: PASSWORD }]);
  assert.deepEqual(app.calls, [
    '/internal/signup/pending/verify', '/internal/firebase/account-verification/begin', '/internal/profile/save-pending',
    '/internal/signup/pending/ownership', '/internal/firebase/account-verification/complete', '/internal/signup/pending/consume'
  ]);
  assert.equal(app.sql.rows.get('usr_0').subjectRef, 'sub:fb-1');
  assert.ok(!JSON.stringify(done).includes(PASSWORD));
  await assert.rejects(flow.verifyPendingSignupCodeAndCreate({ request: app.request, env: app.env, provider: app.firebase, context, ticket, attemptId, code, deps: app.deps }));
  assert.equal(app.firebase.signUps.length, 1);
});

test('ownership is refused before the code is verified, and magic-link is not offered for a held signup', async () => {
  const app = setup();
  const { ticket } = await begin(app);
  await assert.rejects(handlePendingSignupRoute(app.authority, '/internal/signup/pending/ownership', { input: { ticket, email: EMAIL, subject: 'x', verificationTicket: 'y' }, context }), e => e?.code === AUTH_ERROR_CODES.OTP_INVALID);
  await assert.rejects(flow.startPendingSignupCode({ request: app.request, env: app.env, provider: app.firebase, context, ticket, magicLink: true, deps: app.deps }), e => e?.code === AUTH_ERROR_CODES.BACKUP_UNAVAILABLE);
  assert.equal(app.provider.sends.length, 0);
});

test('every OTP provider down: the account is created then and the Firebase link is the last resort', async () => {
  const app = setup({ down: true });
  const { ticket } = await begin(app);
  const result = await flow.startPendingSignupCode({ request: app.request, env: app.env, provider: app.firebase, context, ticket, magicLink: false, deps: app.deps });
  assert.equal(result.body.delivery.method, 'firebase-link');
  assert.equal(result.body.delivery.fallback, true);
  assert.equal(app.firebase.signUps.length, 1);
  assert.deepEqual(app.firebase.links, [EMAIL]);
  assert.ok(!JSON.stringify(result).includes(PASSWORD));
  assert.ok(!isPendingSignupTicket(result.headers['Set-Cookie'][0].split(';')[0].split('=')[1]));
});

test('wiring stays small and silent: no console in the new files, DO and handler only dispatch', () => {
  for (const file of ['auth-native/worker/pending-signup-authority.mjs', 'auth-native/worker/pending-signup-public.mjs', 'auth-native/verification/email-ownership-record.mjs']) {
    assert.doesNotMatch(readFileSync(file, 'utf8'), /console\./);
  }
  const authorityDo = readFileSync('auth-native/worker/auth-authority-do.mjs', 'utf8');
  assert.match(authorityDo, /this\.pendingSignups = new PendingSignupStore\(\{ storage: state\.storage, hmacSecret: env\.AUTH_HMAC_SECRET \}\)/);
  assert.match(authorityDo, /pendingSignups\?\.cleanup\(\)/);
  assert.match(authorityDo, /pendingSignups\?\.nextExpiry\(\)/);
  const handler = readFileSync('auth-native/worker/public-auth-handler.mjs', 'utf8');
  assert.equal((handler.match(/isPendingSignupTicket\(verificationTicket\)/g) || []).length, 3);
  assert.match(readFileSync('package.json', 'utf8'), /pending-signup\.test\.mjs/);
});
