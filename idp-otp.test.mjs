// otp-v..otp-za hosted-IdP OTP slots (owner 2026-10-23). Mocked fetch only; the
// live probe (send -> Gmail Inbox -> verify, wrong code rejected) ran 2026-10-23.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  StytchOtpVerificationProvider, WorkOsOtpVerificationProvider, MojoAuthOtpVerificationProvider,
  AuthgearOtpVerificationProvider, StackAuthOtpVerificationProvider, SuperTokensOtpVerificationProvider, createIdpProviders, parseOtpIdp
} from './auth-native/verification/idp-providers.mjs';
import { createConfiguredVerificationProviders, __verificationProvidersTest as helpers } from './auth-native/verification/providers.mjs';
import { VERIFICATION_MODES } from './auth-native/verification/provider-contract.mjs';

const attemptId = 'A'.repeat(32);
const email = 'student@gmail.com';
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
function scripted(steps) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), body: init.body ? JSON.parse(init.body) : null, headers: init.headers });
    const next = steps.shift();
    if (!next) throw new Error('unexpected call');
    return typeof next === 'function' ? next(url, init) : next;
  };
  return { calls, fetchImpl };
}
const base = fetchImpl => ({ declaredDailyQuota: 100, fetchImpl, boundedJson: helpers.boundedJson, httpFailure: helpers.httpFailure });
const STYTCH = { projectId: 'project-test-842a70e5-0eeb-4ea6-add4-4fbafdb03d44', secret: 'secret-test-' + 'x'.repeat(36) + 'HZA=' };

test('Stytch: send stores method id, wrong code false, right code true, never sends the app code', async () => {
  const s = scripted([
    json(200, { email_id: 'email-test-0a0d7897-5527-4305-8710-ee068fdb5b78', user_id: 'user-test-1' }),
    json(401, { error_type: 'otp_code_not_found' }),
    json(200, { user_id: 'user-test-1', status_code: 200 })
  ]);
  const p = new StytchOtpVerificationProvider({ ...base(s.fetchImpl), ...STYTCH });
  assert.equal(p.verificationMode, VERIFICATION_MODES.PROVIDER_EVIDENCE);
  assert.deepEqual(await p.sendVerification({ destination: email, attemptId, code: '999999' }), { accepted: true });
  assert.match(s.calls[0].url, /^https:\/\/test\.stytch\.com\/v1\/otps\/email\/login_or_create$/);
  assert.equal(JSON.stringify(s.calls[0].body).includes('999999'), false);
  assert.deepEqual(await p.verifyCode({ attemptId, evidence: '000000' }), { verified: false });
  assert.deepEqual(await p.verifyCode({ attemptId, evidence: '402802' }), { verified: true });
  assert.equal(s.calls[2].body.method_id, 'email-test-0a0d7897-5527-4305-8710-ee068fdb5b78');
});

test('WorkOS: ignores the code echoed by magic_auth and requires the same email back', async () => {
  const s = scripted([
    json(201, { id: 'magic_auth_1', email, code: '123456' }),
    json(200, { user: { email: 'other@gmail.com' } }),
    json(201, { id: 'magic_auth_2', email, code: '654321' }),
    json(200, { user: { email } })
  ]);
  const p = new WorkOsOtpVerificationProvider({ ...base(s.fetchImpl), apiKey: 'sk_test_' + 'a'.repeat(40), clientId: 'client_' + 'B'.repeat(26) });
  await p.sendVerification({ destination: email, attemptId });
  assert.deepEqual(await p.verifyCode({ attemptId, evidence: '123456' }), { verified: false }, 'email mismatch');
  await p.sendVerification({ destination: email, attemptId });
  assert.deepEqual(await p.verifyCode({ attemptId, evidence: '654321' }), { verified: true });
  assert.equal(s.calls[3].body.grant_type, 'urn:workos:oauth:grant-type:magic-auth:code');
});

test('MojoAuth: authenticated must be true for the bound address', async () => {
  const s = scripted([
    json(200, { state_id: '6adb5f34927926907b3b4773' }),
    json(400, { message: 'invalid otp' }),
    json(200, { authenticated: true, user: { email } })
  ]);
  const p = new MojoAuthOtpVerificationProvider({ ...base(s.fetchImpl), apiKey: '52f7dd89-5d33-40f2-b3c1-1e664252df83' });
  await p.sendVerification({ destination: email, attemptId });
  assert.deepEqual(await p.verifyCode({ attemptId, evidence: '000000' }), { verified: false });
  assert.deepEqual(await p.verifyCode({ attemptId, evidence: '401536' }), { verified: true });
  assert.equal(s.calls[0].headers['X-API-Key'], '52f7dd89-5d33-40f2-b3c1-1e664252df83');
});

test('Authgear: login path picks email OTP; signup path finishes with email OTP authenticator', async () => {
  const login = scripted([
    json(200, { result: { state_token: 't1', action: { type: 'identify' } } }),
    json(200, { result: { state_token: 't2', action: { type: 'authenticate', data: { type: 'authentication_data', options: [{ authentication: 'primary_password' }, { authentication: 'primary_oob_otp_email' }] } } } }),
    json(200, { result: { state_token: 't3', action: { type: 'authenticate', data: { type: 'verify_oob_otp_data' } } } }),
    json(401, { result: { state_token: 't3' }, error: { reason: 'InvalidCredentials' } }),
    json(200, { result: { state_token: 't4', action: { type: 'finished', data: {} } } })
  ]);
  const p = new AuthgearOtpVerificationProvider(base(login.fetchImpl));
  await p.sendVerification({ destination: email, attemptId });
  assert.deepEqual(login.calls[2].body.input, { authentication: 'primary_oob_otp_email', index: 1 });
  assert.deepEqual(await p.verifyCode({ attemptId, evidence: '000000' }), { verified: false });
  assert.deepEqual(await p.verifyCode({ attemptId, evidence: '295774' }), { verified: true });

  const signup = scripted([
    json(200, { result: { state_token: 's1', action: { type: 'identify' } } }),
    json(200, { result: { state_token: 's2', action: { type: 'verify', data: { type: 'verify_oob_otp_data' } } } }),
    json(200, { result: { state_token: 's3', action: { type: 'create_authenticator', data: {} } } }),
    json(200, { result: { state_token: 's4', action: { type: 'finished', data: {} } } })
  ]);
  const q = new AuthgearOtpVerificationProvider(base(signup.fetchImpl));
  await q.sendVerification({ destination: email, attemptId });
  assert.deepEqual(await q.verifyCode({ attemptId, evidence: '108169' }), { verified: true });
  assert.deepEqual(signup.calls[3].body.input, { authentication: 'primary_oob_otp_email' });
});

test('expired or unknown attempt is a user error, malformed code is just false', async () => {
  const p = new MojoAuthOtpVerificationProvider({ ...base(async () => { throw new Error('no call'); }), apiKey: '52f7dd89-5d33-40f2-b3c1-1e664252df83' });
  assert.deepEqual(await p.verifyCode({ attemptId, evidence: '12ab' }), { verified: false });
  await assert.rejects(p.verifyCode({ attemptId, evidence: '123456' }), error => error.code === 'CHALLENGE_EXPIRED');
});

test('OTP_IDP: missing or bad keys keep slots inert; Authgear needs no key', () => {
  assert.deepEqual(parseOtpIdp('not json'), {});
  const none = createIdpProviders({ raw: '', slotQuota: () => 100, helpers });
  assert.deepEqual(none.map(p => [p.id, p.configured]), [['otp-v', false], ['otp-w', false], ['otp-x', false], ['otp-y', true], ['otp-z', false], ['otp-za', false]]);
  const bad = createIdpProviders({ raw: JSON.stringify({ stytch: { projectId: 'x', secret: 'y' }, mojoauth: { apiKey: 'nope' } }), slotQuota: () => 100, helpers });
  assert.equal(bad.some(p => p.id !== 'otp-y' && p.configured), false);
  const noRow = createIdpProviders({ raw: '', slotQuota: () => '', helpers });
  assert.equal(noRow.find(p => p.id === 'otp-y').configured, false, 'no orchestrator row -> inert');
});

test('wrangler.toml: otp-v..otp-y at priority 38 before the last-resort pair, no new plain vars', async () => {
  const toml = await readFile(new URL('./wrangler.toml', import.meta.url), 'utf8');
  assert.equal(/^OTP_IDP\s*=/m.test(toml), false, 'OTP_IDP is a secret, never a plain var');
  const rows = JSON.parse(toml.match(/VERIFICATION_ORCHESTRATOR_CONFIG = '(.*)'/)[1]).providers;
  for (const id of ['otp-v', 'otp-w', 'otp-x', 'otp-y', 'otp-z', 'otp-za']) {
    const row = rows.find(r => r.id === id);
    assert.equal(row.enabled, id !== 'otp-z', id); // otp-z off until the code box accepts letters
    assert.equal(row.priority, 38, id);
  }
  const env = { VERIFICATION_ORCHESTRATOR_CONFIG: toml.match(/VERIFICATION_ORCHESTRATOR_CONFIG = '(.*)'/)[1] };
  assert.equal(createConfiguredVerificationProviders(env).some(p => p.id === 'otp-y'), false, 'inert until OTP_IDP is bound');
  const ids = createConfiguredVerificationProviders({ ...env, OTP_IDP: '{}' }).map(p => p.id);
  for (const id of ['otp-v', 'otp-w', 'otp-x', 'otp-y', 'otp-za']) assert.ok(ids.includes(id), id);
});

const STACK = { projectId: 'bfd8bb47-248b-4dc5-9093-5606678bd32e', secretServerKey: 'ssk_' + 'a'.repeat(40) };
test('Stack Auth: nonce stored, letter+digit code accepted, wrong code false, right code true', async () => {
  const s = scripted([json(200, { nonce: 'n'.repeat(40) }), json(400, { code: 'INVALID' }), json(200, { access_token: 't', refresh_token: 'r' })]);
  const p = new StackAuthOtpVerificationProvider({ ...base(s.fetchImpl), ...STACK });
  assert.equal(p.configured, true);
  assert.deepEqual(await p.sendVerification({ destination: email, attemptId }), { accepted: true });
  assert.equal(s.calls[0].headers['x-stack-access-type'], 'server');
  assert.equal(s.calls[0].body.email, email);
  assert.deepEqual(await p.verifyCode({ attemptId, evidence: 'AAAAAA' }), { verified: false });
  assert.deepEqual(await p.verifyCode({ attemptId, evidence: 'nqwkn5' }), { verified: true });
  assert.equal(s.calls[2].body.code, 'NQWKN5' + 'n'.repeat(40));
  assert.deepEqual(await p.verifyCode({ attemptId, evidence: 'bad!' }), { verified: false });
});

const ST = { connectionUri: 'https://st-dev-624c4460-cef9-11f1-bda6-f9cc99b68e9f.aws.supertokens.io/', apiKey: 'k'.repeat(26) };
test('SuperTokens: core makes code, free mail service sends it as Admissionsky, consume checks email', async () => {
  const made = { status: 'OK', preAuthSessionId: 'pre', deviceId: 'dev', userInputCode: '390798', linkCode: 'l', codeLifetime: 900000 };
  const s = scripted([json(200, made), json(200, {}), json(200, { status: 'INCORRECT_USER_INPUT_CODE_ERROR' }), json(200, { status: 'OK', user: { emails: [email] } })]);
  const p = new SuperTokensOtpVerificationProvider({ ...base(s.fetchImpl), ...ST });
  assert.equal(p.configured, true);
  assert.deepEqual(await p.sendVerification({ destination: email, attemptId }), { accepted: true });
  assert.equal(s.calls[0].headers['api-key'], 'k'.repeat(26));
  assert.match(s.calls[1].url, /^https:\/\/api\.supertokens\.io\/0\/st\/auth\/passwordless\/login$/);
  assert.equal(s.calls[1].body.appName, 'Admissionsky');
  assert.deepEqual(await p.verifyCode({ attemptId, evidence: '111111' }), { verified: false });
  assert.deepEqual(await p.verifyCode({ attemptId, evidence: '390798' }), { verified: true });
  assert.equal(new SuperTokensOtpVerificationProvider({ ...base(s.fetchImpl), connectionUri: 'https://evil.example.com', apiKey: 'k'.repeat(26) }).configured, false);
});
