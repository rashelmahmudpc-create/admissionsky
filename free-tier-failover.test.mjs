// Proves the free-tier failover the operator depends on: Brevo (otp-a, 300/day)
// carries traffic until its headroom runs low, then the orchestrator shifts the
// remainder to the Apps Script mailer (otp-b, 100/day). When both are spent the
// request fails closed rather than overspending a free tier.
//
// Both providers are the shipped classes and only their HTTP transport is faked,
// so the quota arithmetic, candidate scoring and per-provider budget run exactly
// as deployed. The Apps Script double re-derives the HMAC over apps-script/
// Code.gs's canonical string and rejects a bad signature, so this test also pins
// the Worker <-> Code.gs wire contract: change either side's canonical form and
// the failover path goes red instead of silently 403ing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { AUTH_ERROR_CODES } from './auth-native/core/errors.mjs';
import { VerificationOrchestrator } from './auth-native/verification/orchestrator.mjs';
import { MemoryVerificationRepository } from './auth-native/verification/memory-verification-repository.mjs';
import {
  BrevoOtpVerificationProvider,
  AppsScriptOtpVerificationProvider
} from './auth-native/verification/providers.mjs';

const SECRET = 'free-tier-failover-secret-0123456789-ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const BREVO_KEY = `xkeysib-${'b'.repeat(48)}`;
const APPS_SCRIPT_SECRET = 'apps-script-shared-secret-0123456789-ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx/exec';
const NOW = 1_800_000_000_000;
const DAY_MS = 86_400_000;
const BREVO_LIMIT = 300;
const APPS_SCRIPT_LIMIT = 100;

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

// apps-script/Code.gs: signatureFor_() joins with "\n" and base64url-encodes the
// MAC with the padding stripped.
async function codeGsSignature(action, fields) {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(APPS_SCRIPT_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const canonical = [action, fields.timestamp, fields.nonce, fields.destination, fields.code].join('\n');
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(canonical));
  return Buffer.from(mac).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function harness({ brevoCredits = 3 } = {}) {
  const sent = { brevo: [], appsScript: [] };
  const rejectedSignatures = [];
  let credits = brevoCredits;
  // The orchestrator enforces a 120/minute global send cap, so a simulated day
  // has to move the clock instead of issuing every request at one instant.
  let clock = NOW;
  const now = () => clock;

  const fetchImpl = async (url, init = {}) => {
    const target = String(url);
    if (target.includes('api.brevo.com')) {
      // The account spends one `sendLimit` credit per accepted send, which is
      // exactly what getRemainingQuota reads back.
      if (target.endsWith('/v3/senders')) return json({ senders: [{ email: 'sender@example.com', active: true }] });
      if (target.endsWith('/v3/account')) return json({ plan: [{ creditsType: 'sendLimit', credits }] });
      sent.brevo.push(JSON.parse(init.body).to[0].email);
      credits = Math.max(0, credits - 1);
      return json({ messageId: `<brevo-${sent.brevo.length}@example.com>` });
    }
    if (!target.startsWith(APPS_SCRIPT_URL.split('/exec')[0])) throw new Error(`unexpected fetch: ${target}`);

    const parsed = new URL(target);
    const isSend = String(init.method || 'GET').toUpperCase() === 'POST';
    const fields = isSend ? JSON.parse(init.body) : {
      timestamp: parsed.searchParams.get('timestamp') || '',
      nonce: parsed.searchParams.get('nonce') || '',
      destination: parsed.searchParams.get('destination') || '',
      code: parsed.searchParams.get('code') || ''
    };
    const action = isSend ? 'send' : parsed.searchParams.get('action');
    const expected = await codeGsSignature(action, fields);
    const provided = isSend ? fields.signature : parsed.searchParams.get('signature');
    if (provided !== expected) {
      rejectedSignatures.push(action);
      return json({ ok: false, error: 'forbidden' }, 403);
    }

    if (action === 'health') return json({ ok: true, ready: true, limit: APPS_SCRIPT_LIMIT, remaining: APPS_SCRIPT_LIMIT, resetAt: NOW + DAY_MS });
    if (action === 'quota') return json({ ok: true, limit: APPS_SCRIPT_LIMIT, remaining: APPS_SCRIPT_LIMIT - sent.appsScript.length, resetAt: NOW + DAY_MS });
    sent.appsScript.push(fields.destination);
    return json({ ok: true, accepted: true, messageRef: `gmail-0000-${sent.appsScript.length}`, remaining: APPS_SCRIPT_LIMIT - sent.appsScript.length });
  };

  const brevo = new BrevoOtpVerificationProvider({
    id: 'otp-a', apiKey: BREVO_KEY, fromAddress: 'sender@example.com', fromName: 'Admission Sky',
    declaredDailyQuota: BREVO_LIMIT, fetchImpl, now
  });
  const appsScript = new AppsScriptOtpVerificationProvider({
    id: 'otp-b', webAppUrl: APPS_SCRIPT_URL, sharedSecret: APPS_SCRIPT_SECRET,
    declaredDailyQuota: APPS_SCRIPT_LIMIT, fetchImpl, now
  });
  assert.equal(appsScript.configured, true, 'Apps Script provider must be configured for this test to mean anything');

  const repository = new MemoryVerificationRepository();
  const orchestrator = new VerificationOrchestrator({
    repository,
    hmacSecret: SECRET,
    // otp-a outranks otp-b: Brevo is spent first and the mailer only mops up.
    config: {
      enabled: true,
      policy: {},
      providers: [
        { id: 'otp-a', enabled: true, priority: 10, dailyQuota: BREVO_LIMIT, timeoutMs: 5000 },
        { id: 'otp-b', enabled: true, priority: 20, dailyQuota: APPS_SCRIPT_LIMIT, timeoutMs: 5000 }
      ]
    },
    providers: [brevo, appsScript],
    activated: true,
    now
  });
  return { orchestrator, repository, sent, rejectedSignatures, advance: ms => { clock += ms; } };
}

// The orchestrator rate-limits per user/ip/device, so each simulated student
// needs its own tuple or the later requests never reach a provider.
const requestIdentity = index => Object.freeze({
  sessionToken: `session-${String(index).padStart(3, '0')}-${'s'.repeat(48)}`,
  subject: `firebase-uid-failover-${index}`,
  userId: `usr_failover_${index}`,
  email: 'failover.student@example.com',
  purpose: 'account-backup'
});
const contextFor = index => Object.freeze({
  ip: `203.0.${Math.floor(index / 250)}.${(index % 250) + 1}`,
  deviceId: `device-failover-${String(index).padStart(6, '0')}`,
  userAgent: 'Chrome',
  origin: 'https://admissionhub.pages.dev'
});
const used = (repository, providerId, dailyQuota) =>
  repository.dailyQuotaSnapshot({ providerId, dailyQuota, now: NOW });

test('no OTP request fails while either free tier has headroom, and traffic moves from Brevo to the mailer', async () => {
  const app = harness({ brevoCredits: BREVO_LIMIT });
  const total = 150;
  for (let index = 0; index < total; index += 1) {
    // One request per second keeps the global 120/minute cap out of the way.
    app.advance(1_000);
    const result = await app.orchestrator.requestVerification(requestIdentity(index), contextFor(index));
    assert.equal(result.accepted, true);
    // The chosen provider must never leak to the caller.
    assert.equal('providerId' in result, false);
  }

  // 150 requested and 150 delivered: while both tiers have room the orchestrator
  // spreads the work in proportion to their declared limits (a 300/day tier takes
  // roughly 3x the mailer's 100/day share — a 150-request day lands about 120/30)
  // instead of draining Brevo first and leaving the mailer idle as the sole
  // remaining point of failure.
  assert.equal(app.sent.brevo.length + app.sent.appsScript.length, total);
  assert.ok(app.sent.brevo.length > app.sent.appsScript.length, 'the larger tier must carry the larger share');
  assert.ok(app.sent.appsScript.length <= APPS_SCRIPT_LIMIT, 'the mailer must never exceed its 100/day free tier');
  assert.deepEqual(app.rejectedSignatures, [], 'the Worker HMAC must satisfy the Code.gs canonical string');
  assert.equal((await used(app.repository, 'otp-b', APPS_SCRIPT_LIMIT)).used, app.sent.appsScript.length);
});

test('otp-b has its own 100/day budget: exhausting both providers fails closed instead of overspending a free tier', async () => {
  const app = harness({ brevoCredits: 0 });
  let delivered = 0;
  let failure = null;
  for (let index = 0; index < 101; index += 1) {
    try {
      await app.orchestrator.requestVerification(requestIdentity(index), contextFor(index));
      delivered += 1;
    } catch (error) {
      failure = error;
      break;
    }
  }

  assert.equal(delivered, APPS_SCRIPT_LIMIT, 'Apps Script must deliver exactly its declared 100/day, no more');
  assert.equal(app.sent.appsScript.length, APPS_SCRIPT_LIMIT);
  assert.equal(app.sent.brevo.length, 0, 'a Brevo call would have blown a free tier that has no credits left');
  assert.equal(failure?.code, AUTH_ERROR_CODES.BACKUP_UNAVAILABLE, 'the 101st request fails closed instead of calling Google again');
});

test('Brevo is skipped in favour of Apps Script when its reported credits are already spent', async () => {
  const app = harness({ brevoCredits: 0 });
  const result = await app.orchestrator.requestVerification(requestIdentity(0), contextFor(0));
  assert.equal(result.accepted, true);
  assert.equal(app.sent.brevo.length, 0);
  assert.equal(app.sent.appsScript.length, 1);
});