import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { probeAuthgearLiveness, AUTHGEAR_LIVENESS_CODES, AUTHGEAR_LIVENESS_ADDRESS } from './auth-native/verification/authgear-liveness.mjs';
import { runDailyOtpLiveness, renderOtpLivenessAlert, dhakaDay, OTP_LIVENESS_MARKER_PREFIX } from './auth-native/operations/otp-liveness-daily.mjs';

const okResponse = (body) => ({ ok: true, status: 200, json: async () => body });

test('a healthy provider reaches the email-OTP step and reports READY', async () => {
  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push({ url, body: JSON.parse(init.body) });
    if (url.endsWith('/api/v1/authentication_flows')) return okResponse({ result: { state_token: 'A'.repeat(32) } });
    return okResponse({ result: { action: { type: 'verify', data: { type: 'verify_oob_otp_data', channel: 'email', code_length: 6, delivery_status: 'sending' } } } });
  };
  const r = await probeAuthgearLiveness({ fetchImpl });
  assert.equal(r.ok, true);
  assert.equal(r.code, AUTHGEAR_LIVENESS_CODES.READY);
  assert.equal(r.deliveryStatus, 'sending');
  assert.equal(seen.length, 2);
  assert.equal(seen[1].body.input.login_id, AUTHGEAR_LIVENESS_ADDRESS);
});

test('a provider that stops delivering fails instead of passing by default', async () => {
  const fetchImpl = async (url) => url.endsWith('/api/v1/authentication_flows')
    ? okResponse({ result: { state_token: 'A'.repeat(32) } })
    : okResponse({ result: { action: { type: 'verify', data: { type: 'verify_oob_otp_data', channel: 'email', code_length: 6, delivery_status: 'failed' } } } });
  const r = await probeAuthgearLiveness({ fetchImpl });
  assert.equal(r.ok, false);
  assert.equal(r.code, AUTHGEAR_LIVENESS_CODES.NOT_DELIVERING);
});

test('a flow that never reaches the code step fails, and a network error is named', async () => {
  const noOtp = async (url) => url.endsWith('/api/v1/authentication_flows')
    ? okResponse({ result: { state_token: 'A'.repeat(32) } })
    : okResponse({ result: { action: { type: 'authenticate', data: { type: 'identify' } } } });
  assert.equal((await probeAuthgearLiveness({ fetchImpl: noOtp })).code, AUTHGEAR_LIVENESS_CODES.NO_EMAIL_OTP);
  const boom = async () => { throw new Error('offline'); };
  assert.equal((await probeAuthgearLiveness({ fetchImpl: boom })).code, AUTHGEAR_LIVENESS_CODES.NETWORK_ERROR);
});

test('an endpoint outside the provider host is refused before any request', async () => {
  let called = 0;
  const r = await probeAuthgearLiveness({ fetchImpl: async () => { called++; return okResponse({}); }, endpoint: 'https://evil.example.com' });
  assert.equal(r.ok, false);
  assert.equal(called, 0);
});

test('the daily tick runs once per Dhaka day and writes its marker first', async () => {
  const store = new Map();
  const env = { PUB_KV: { get: async k => store.get(k) ?? null, put: async (k, v) => { store.set(k, v); } } };
  let probes = 0;
  const probe = async () => { probes++; return { ok: true, code: 'READY', latencyMs: 5 }; };
  const first = await runDailyOtpLiveness({ env, now: Date.UTC(2026, 9, 31, 3, 0), probe });
  assert.equal(first.ran, true);
  assert.equal(probes, 1);
  assert.equal(store.get(`${OTP_LIVENESS_MARKER_PREFIX}${dhakaDay(Date.UTC(2026, 9, 31, 3, 0))}`), 'done');
  const second = await runDailyOtpLiveness({ env, now: Date.UTC(2026, 9, 31, 4, 0), probe });
  assert.equal(second.ran, false);
  assert.equal(probes, 1);
  const tomorrow = await runDailyOtpLiveness({ env, now: Date.UTC(2026, 9, 31, 19, 0), probe });
  assert.equal(tomorrow.ran, true);
  assert.equal(probes, 2);
});

test('a failing probe alerts once, and a healthy one stays quiet unless asked', async () => {
  const store = new Map();
  const env = { PUB_KV: { get: async k => store.get(k) ?? null, put: async (k, v) => { store.set(k, v); } } };
  const alerts = [];
  const alert = async text => { alerts.push(text); return true; };
  const bad = await runDailyOtpLiveness({ env, now: Date.UTC(2026, 9, 31, 3, 0), probe: async () => ({ ok: false, code: 'NOT_DELIVERING', latencyMs: 12 }), alert });
  assert.equal(bad.ok, false);
  assert.equal(bad.alerted, true);
  assert.equal(alerts.length, 1);
  assert.match(alerts[0], /NOT_DELIVERING/);
  // The same day cannot alert twice — the marker is the throttle.
  await runDailyOtpLiveness({ env, now: Date.UTC(2026, 9, 31, 5, 0), probe: async () => ({ ok: false, code: 'NOT_DELIVERING', latencyMs: 12 }), alert });
  assert.equal(alerts.length, 1);
  const quiet = await runDailyOtpLiveness({ env, now: Date.UTC(2026, 10, 1, 3, 0), probe: async () => ({ ok: true, code: 'READY', latencyMs: 5 }), alert });
  assert.equal(quiet.alerted, false);
  assert.equal(alerts.length, 1);
});

test('without KV the tick does nothing rather than probing unguarded every minute', async () => {
  let probes = 0;
  const r = await runDailyOtpLiveness({ env: {}, probe: async () => { probes++; return { ok: true }; } });
  assert.equal(r.ran, false);
  assert.equal(r.code, 'NO_KV');
  assert.equal(probes, 0);
});

test('the every-minute cron actually calls the daily tick', () => {
  /* Same shape as sky-daily-report.test.mjs W2: a module nothing calls is not
     a daily probe. This is the wiring half of the guard — the behaviour tests
     above would all pass against a function the Worker never invokes. */
  const worker = readFileSync('./gk-agent-worker.js', 'utf8');
  assert.match(worker, /await runDailyOtpLiveness\(\{ env, alert: text => sendTelegramAlert\(env, text\) \}\)/);
  const scheduled = worker.slice(worker.indexOf('async scheduled(event, env, ctx)'));
  assert.ok(scheduled.indexOf('runDailyOtpLiveness') > 0, 'the tick must be inside scheduled()');
  const bundle = readFileSync('./worker-bundle.mjs', 'utf8');
  assert.match(bundle, /otpLivenessDay:/);
});

test('the alert text is plain, names the slot, and carries no markup', () => {
  const text = renderOtpLivenessAlert({ ok: false, code: 'NETWORK_ERROR', latencyMs: 900 }, '2026-10-31');
  assert.match(text, /otp-y/);
  assert.match(text, /2026-10-31/);
  /* `sendTelegramAlert` sends without parse_mode, so anything that looks like
     markup would arrive literally. Underscores are allowed: they only appear
     inside reason codes such as NETWORK_ERROR, and plain text renders them. */
  assert.equal(/[*`<>&]/.test(text), false);
});
