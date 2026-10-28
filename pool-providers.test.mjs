import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseOtpRawPool, createPoolProviders, POOL_SLOTS } from './auth-native/verification/pool-providers.mjs';
import { createConfiguredVerificationProviders } from './auth-native/verification/providers.mjs';
import { verificationConfig } from './auth-native/verification/config.mjs';

// All values below are obviously fake placeholders (no real key format).
const RAW = `maileroo: fakeMailerooValue0001 from otp@x.maileroo.org
Elastic email  fakeElasticValue00000002  sender: me@abc.com
mailguh: fakeMailgunValue00000003  domain: mg.abc.com eu
alibaba  id: fakeAccessIdValue0004  secret: fakeAccessSecretValue0005  from: no-reply@mail.abc.com
loops: fakeLoopsValue0000000006  template: fakeTemplate0007
plunk fakePlunkValue000000008 from otp@x.maileroo.org
bird fakeSparkValue000000009 otp@abc.com`;

const HELPERS = { boundedJson: async r => { try { return await r.json(); } catch { return {}; } }, httpFailure: () => new Error('http'), otpEmailBody: () => ({ text: 't', html: 'h' }), appName: 'AdmissionSky' };
const wranglerConfig = () => readFileSync('wrangler.toml', 'utf8').match(/VERIFICATION_ORCHESTRATOR_CONFIG = '(.*)'/)[1];

test('free-text OTP_RAW is split per provider', () => {
  const pool = parseOtpRawPool(RAW);
  assert.equal(pool.maileroo.apiKey, 'fakeMailerooValue0001');
  assert.equal(pool.maileroo.from, 'otp@x.maileroo.org');
  assert.equal(pool.elasticemail.apiKey, 'fakeElasticValue00000002');
  assert.equal(pool.elasticemail.from, 'me@abc.com');
  assert.equal(pool.mailgun.apiKey, 'fakeMailgunValue00000003');
  assert.equal(pool.mailgun.domain, 'mg.abc.com');
  assert.equal(pool.mailgun.region, 'eu');
  assert.equal(pool.mailgun.from, 'otp@mg.abc.com');
  assert.equal(pool.alibaba.accessKeyId, 'fakeAccessIdValue0004');
  assert.equal(pool.alibaba.accessKeySecret, 'fakeAccessSecretValue0005');
  assert.equal(pool.loops.apiKey, 'fakeLoopsValue0000000006');
  assert.equal(pool.loops.transactionalId, 'fakeTemplate0007');
  assert.equal(pool.plunk.apiKey, 'fakePlunkValue000000008');
  assert.equal(pool.sparkpost.apiKey, 'fakeSparkValue000000009');
  assert.equal(pool.sparkpost.from, 'otp@abc.com');
});

test('JSON OTP_RAW works too', () => {
  const pool = parseOtpRawPool('{"mailgun":{"apiKey":"fakeJsonValue000000010","domain":"mg.x.com","from":"otp@mg.x.com","region":"us"}}');
  assert.equal(pool.mailgun.apiKey, 'fakeJsonValue000000010');
  assert.equal(pool.mailgun.region, 'us');
});

test('status never exposes a key, only the last four characters', async () => {
  const providers = createPoolProviders({ raw: RAW, slotQuota: () => 100, fetchImpl: async () => new Response('{}'), helpers: HELPERS });
  for (const provider of providers) {
    const status = JSON.stringify(await provider.getProviderStatus());
    assert.doesNotMatch(status, /fake[A-Za-z]+Value/);
  }
});

test('a provider with no keys stays inert', async () => {
  const [maileroo] = createPoolProviders({ raw: '', slotQuota: () => 100, fetchImpl: async () => new Response('{}'), helpers: HELPERS });
  assert.equal(maileroo.configured, false);
  assert.equal((await maileroo.checkAvailability()).available, false);
});

test('every pool slot is a known, enabled orchestrator slot before the last-resort pair', () => {
  const config = verificationConfig(wranglerConfig());
  for (const id of Object.values(POOL_SLOTS)) {
    const row = config.providers.find(entry => entry.id === id);
    assert.ok(row, id);
    assert.equal(row.enabled, true);
    assert.ok(row.priority < 39, id);
    assert.ok(row.dailyQuota > 0, id);
  }
});

test('Maileroo send uses its v2 API with the parsed key', async () => {
  const calls = [];
  const env = { OTP_RAW: RAW, VERIFICATION_ORCHESTRATOR_CONFIG: wranglerConfig() };
  const providers = createConfiguredVerificationProviders(env, { fetchImpl: async (url, init) => { calls.push({ url, init }); return new Response('{"success":true}', { status: 200 }); } });
  const maileroo = providers.find(p => p.id === POOL_SLOTS.maileroo);
  assert.equal(maileroo.configured, true);
  await maileroo.sendVerification({ destination: 'student@gmail.com', code: '123456', expiresAt: Date.now() + 300000 });
  assert.equal(calls[0].url, 'https://smtp.maileroo.com/api/v2/emails');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer fakeMailerooValue0001');
});

test('Alibaba request is signed', async () => {
  const calls = [];
  const providers = createPoolProviders({ raw: RAW, slotQuota: () => 60, fetchImpl: async (url, init) => { calls.push({ url, init }); return new Response('{"EnvId":"1"}'); }, helpers: HELPERS });
  const alibaba = providers.find(p => p.id === POOL_SLOTS.alibaba);
  await alibaba.sendVerification({ destination: 'student@gmail.com', code: '123456' });
  assert.equal(calls[0].url, 'https://dm.ap-southeast-1.aliyuncs.com/');
  assert.match(calls[0].init.body, /Action=SingleSendMail/);
  assert.match(calls[0].init.body, /&Signature=/);
});
