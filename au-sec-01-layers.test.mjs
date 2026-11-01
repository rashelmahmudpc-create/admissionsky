// AU-SEC-01 — one test per defence layer, plus the simulated attack.
//
// The blueprint's done-condition for step 2 (A3) is: "প্রতিটা স্তরের আলাদা
// টেস্টের প্রমাণ · সিমুলেটেড আক্রমণে কোটা অক্ষত" — a separate proof for each
// layer, and proof that a simulated attack leaves the provider quota intact.
//
// Layers L1, L2 and the dashboard half of L3 live in the Cloudflare dashboard,
// not in this repository, so they cannot be proven here. What this file CAN
// prove is that the code depends on them correctly and that nothing in the repo
// quietly contradicts them; those tests say so explicitly rather than pretending
// to have tested a dashboard.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  DATACENTER_ASNS,
  HONEYPOT_FIELD,
  MIN_FORM_MS,
  FUZZ_ALERT_RATIO,
  FUZZ_HARD_RATIO,
  fuzzBand,
  isDatacenterAsn,
  looksAutomated,
  networkPrefix,
  worstFuzzBand
} from './auth-native/core/abuse-signals.mjs';
import { verifyTurnstile } from './auth-native/verification/turnstile.mjs';
import { VerificationOrchestrator } from './auth-native/verification/orchestrator.mjs';
import { MemoryVerificationRepository } from './auth-native/verification/memory-verification-repository.mjs';
import { otpAlertFor } from './observability/otp-alert.mjs';
import { AUTH_ERROR_CODES } from './auth-native/core/errors.mjs';
import { VERIFICATION_CHANNELS, VERIFICATION_MODES } from './auth-native/verification/provider-contract.mjs';

const HANDLER = readFileSync(new URL('./auth-native/worker/public-auth-handler.mjs', import.meta.url), 'utf8');
const CLIENT = readFileSync(new URL('./account-access.js', import.meta.url), 'utf8');
const DO_SRC = readFileSync(new URL('./auth-native/worker/auth-authority-do.mjs', import.meta.url), 'utf8');
const ALERT_SRC = readFileSync(new URL('./observability/otp-alert.mjs', import.meta.url), 'utf8');

const SECRET = 'au-sec-01-layers-secret-0123456789-ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
const GUARDED = ['/signup', '/login', '/password-reset', '/email-ownership/start', '/verification/resend', '/telegram/verification/start', '/backup/request'];
const context = Object.freeze({
  ip: '203.0.113.55',
  deviceId: 'device-au-sec-01-0123456789',
  userAgent: 'Chrome',
  origin: 'https://admissionhub.pages.dev'
});
const identity = index => ({
  sessionToken: `session-${String(index).padStart(48, 's')}`,
  subject: `firebase-uid-${index}`,
  userId: `usr_${index}`,
  email: `student-${index}@example.com`,
  purpose: 'account-ownership'
});

class CountingProvider {
  constructor(id = 'otp-a') {
    this.id = id;
    this.channel = VERIFICATION_CHANNELS.OTP;
    this.verificationMode = VERIFICATION_MODES.LOCAL_CODE;
    this.sends = [];
    this.remaining = 100;
  }
  async checkAvailability() { return { available: true, code: 'READY' }; }
  async getRemainingQuota() { return { remaining: this.remaining, limit: 100, resetAt: 1_900_000_000_000 }; }
  async getProviderStatus() { return { status: 'healthy', configured: true }; }
  async sendVerification(input) { this.sends.push(input); return { accepted: true }; }
  async verifyCode() { return { verified: true }; }
}

const setup = ({ quota = 100, start = 1_800_000_000_000 } = {}) => {
  let now = start;
  const provider = new CountingProvider();
  const repository = new MemoryVerificationRepository();
  const config = {
    enabled: true,
    providers: [{ id: 'otp-a', enabled: true, priority: 10, dailyQuota: quota, timeoutMs: 1000 }]
  };
  const orchestrator = new VerificationOrchestrator({
    repository, hmacSecret: SECRET, config, providers: [provider], activated: true, now: () => now
  });
  return { provider, repository, orchestrator, now: () => now, advance: ms => { now += ms; } };
};

/* ── L1 — Bot Fight Mode (dashboard) ──────────────────────────────────────── */

test('L1 (dashboard): the repo never disables Bot Fight Mode, and says where the layer lives', () => {
  // The setting itself is a Cloudflare dashboard toggle; no file in this repo
  // can turn it on. What is checkable is that nothing contradicts it, and that
  // the code that depends on it names the dependency.
  const wrangler = readFileSync(new URL('./wrangler.toml', import.meta.url), 'utf8');
  assert.doesNotMatch(wrangler, /bot_?fight_?mode\s*=\s*false/i, 'Bot Fight Mode must not be disabled in config');
  assert.match(HANDLER, /botManagement/, 'the handler reads the edge bot score, which only exists when the edge is scoring');
});

/* ── L2 — WAF rate rule (dashboard) ───────────────────────────────────────── */

test('L2 (dashboard): the four WAF-protected paths are the four the blueprint names', () => {
  // The rule is created in the dashboard. This pins the path list so a route
  // rename cannot silently leave a path unprotected at the edge.
  const PATHS = ['/signup', '/email-ownership/start', '/login', '/password-reset'];
  for (const path of PATHS) {
    assert.ok(HANDLER.includes('`${AUTH_API_PREFIX}' + path + '`'), `${path} must still exist for the WAF rule to match it`);
  }
});

/* ── L3 — ASN rule (Worker) ───────────────────────────────────────────────── */

test('L3: a hosting ASN is recognised, a student network is not', () => {
  for (const asn of [14061, 16509, 24940, 20473, 16276]) {
    assert.equal(isDatacenterAsn(asn), true, `ASN ${asn} is hosting`);
  }
  // The networks Bangladeshi students actually arrive from.
  for (const asn of [24389, 24432, 25227, 17494, 23688]) {
    assert.equal(isDatacenterAsn(asn), false, `ASN ${asn} is a student network and must not be flagged`);
  }
  // Cloudflare's own edge: flagging it would flag every request through the proxy.
  assert.equal(isDatacenterAsn(13335), false);
});

test('L3: an absent or nonsensical ASN is never a signal', () => {
  for (const value of [undefined, null, '', 'unknown', 0, -1, NaN, 'not-a-number']) {
    assert.equal(isDatacenterAsn(value), false, `${JSON.stringify(value)} must not be treated as hosting`);
  }
});

test('L3: a hosting ASN forces the human check even with no Turnstile secret bound', async () => {
  // Ordinary caller, no secret: inert, as before.
  assert.deepEqual(await verifyTurnstile({ env: {}, token: '' }), { enforced: false });
  // Hosting caller, no secret: refused. There is nothing to verify against, so
  // the honest answer is a refusal, not a silent pass.
  await assert.rejects(
    () => verifyTurnstile({ env: {}, token: '', required: true }),
    error => error?.code === AUTH_ERROR_CODES.HUMAN_CHECK_FAILED
  );
});

test('L3: the strict flag is wired to the ASN test and to the fuzz band, nowhere else', () => {
  const gate = HANDLER.slice(HANDLER.indexOf('const guardSend ='), HANDLER.indexOf('const shadowGuardStore'));
  assert.match(gate, /required = requiresHardHumanCheck\(context\) \|\| \(await fuzzBandNow\(env\)\) === 'hard'/);
});

test('L3: an ordinary caller on a normal day pays nothing for the ASN test', () => {
  // The ASN test is pure and the fuzz read is cached, so the strict path is
  // only taken when one of the two actually fires.
  assert.match(HANDLER, /const FUZZ_CACHE_MS = 60_000;/);
  const helper = HANDLER.slice(HANDLER.indexOf('const fuzzBandNow'), HANDLER.indexOf('const guardSend'));
  assert.match(helper, /expiresAt: now \+ FUZZ_CACHE_MS/, 'a signup must not pay a DO round trip per request');
  // A failed fuzz read returns 'normal' and never blocks: an escalation must not
  // become an outage when the authority is briefly unreachable.
  assert.match(helper, /return 'normal';/);
});

/* ── L4 — Turnstile on all nine endpoints ─────────────────────────────────── */

test('L4: all nine endpoints pass through the shared gate, which checks Turnstile', () => {
  // AUTH V2.0 (owner 2026-10-31): seven became nine when /google/link and
  // /facebook were brought under the gate. Both take credentials — the first an
  // email AND a password — so guessing there had leaned on the rate limiter
  // alone. The client sends the token on both now; without that half the guard
  // would fail closed and lock students out of social sign-in.
  const guarded = HANDLER.split('await guardSend(').length - 1;
  assert.equal(guarded, 9, 'nine guarded endpoints');
  const gate = HANDLER.slice(HANDLER.indexOf('const guardSend ='), HANDLER.indexOf('const shadowGuardStore'));
  assert.match(gate, /await verifyTurnstile\(/);
});

test('L4: a missing or rejected token is a 4xx, which is the blueprint\'s own done-condition', async () => {
  // "৭টা endpoint-এ token ছাড়া 4xx" — proven on the verifier itself rather than
  // by reading the source: with a secret bound, an absent token and a rejected
  // token must both fail, and the code they fail with must be a 4xx.
  // Siteverify answers `{ success: true }`; anything else is a refusal. The stub
  // is a Response-shaped object, because the verifier reads `.json()`.
  const reply = payload => async () => ({ json: async () => payload });
  const reject = reply({ success: false, 'error-codes': ['invalid-input-response'] });
  const accepting = reply({ success: true });
  const call = (token, fetchImpl) => verifyTurnstile({
    env: { TURNSTILE_SECRET_KEY: 'secret' }, token, ip: '203.0.113.5', fetchImpl
  });

  // Absent, empty and oversized tokens never even reach the network.
  let fetches = 0;
  const counting = async () => { fetches += 1; return { json: async () => ({ success: true }) }; };
  for (const token of [undefined, '', null, 'x'.repeat(4097)]) {
    await assert.rejects(() => call(token, counting), error => error?.code === AUTH_ERROR_CODES.HUMAN_CHECK_FAILED);
  }
  assert.equal(fetches, 0, 'a token that cannot be valid must not cost a siteverify round trip');

  // A token Cloudflare rejects is a failure too, not a pass.
  await assert.rejects(() => call('plausible-token', reject), error => error?.code === AUTH_ERROR_CODES.HUMAN_CHECK_FAILED);
  // And a token Cloudflare accepts is the only thing that passes.
  assert.deepEqual(await call('plausible-token', accepting), { enforced: true });

  // The status the seven endpoints actually answer with, read off the error the
  // verifier throws rather than from a table copied into this test.
  try {
    await call('plausible-token', reject);
    assert.fail('a rejected token must throw');
  } catch (error) {
    assert.equal(error.code, AUTH_ERROR_CODES.HUMAN_CHECK_FAILED);
    assert.ok(error.status >= 400 && error.status < 500, `a missing token must answer 4xx, got ${error.status}`);
  }
});

/* ── L5 — honeypot + form speed ───────────────────────────────────────────── */

test('L5: a filled honeypot is automated, whatever the timing says', () => {
  assert.equal(looksAutomated({ honeypot: 'http://spam.example', elapsedMs: 60_000 }).reason, 'HONEYPOT_FILLED');
  assert.equal(looksAutomated({ honeypot: 'x', elapsedMs: undefined }).automated, true);
  assert.equal(looksAutomated({ honeypot: '   ' }).automated, false, 'whitespace is not a filled field');
});

test('L5: a form submitted faster than a person can type is automated', () => {
  assert.equal(looksAutomated({ elapsedMs: MIN_FORM_MS - 1 }).reason, 'FORM_TOO_FAST');
  assert.equal(looksAutomated({ elapsedMs: 0 }).automated, true);
  assert.equal(looksAutomated({ elapsedMs: MIN_FORM_MS }).automated, false, 'exactly at the floor is allowed');
  assert.equal(looksAutomated({ elapsedMs: 12_000 }).automated, false);
});

test('L5: an implausible clock is automated, but a missing one never is', () => {
  // Absent timing is an older cached bundle, not a bot: refusing it would lock
  // out every student who has not refreshed.
  for (const value of [undefined, null, '']) {
    const verdict = looksAutomated({ elapsedMs: value });
    assert.equal(verdict.automated, false, `elapsedMs ${JSON.stringify(value)} must be clean`);
    assert.equal(verdict.reason, 'NO_TIMING_SIGNAL');
  }
  // Negative or absurdly large means the value was not produced by a real form.
  assert.equal(looksAutomated({ elapsedMs: -1 }).automated, true);
  assert.equal(looksAutomated({ elapsedMs: 999_999_999_999 }).reason, 'FORM_TIMING_IMPLAUSIBLE');
});

test('L5: the client ships the honeypot and the timing on the signup call', () => {
  assert.ok(CLIENT.includes('botSignals('), 'the shared helper exists');
  assert.match(CLIENT, /api\('\/signup',[\s\S]{0,220}\.\.\.botSignals\('signup'\)/, 'signup spreads the bot signals');
  assert.ok(CLIENT.includes('ah-contact-website'), 'the honeypot input is in the markup');
  assert.ok(CLIENT.includes('tabindex="-1"'), 'the honeypot is out of the tab order');
  assert.ok(CLIENT.includes('aria-hidden="true"'), 'the honeypot is hidden from assistive tech');
  // The client must never send a signal the server does not read, and vice versa.
  assert.ok(CLIENT.includes(HONEYPOT_FIELD), 'the client field name matches abuse-signals.HONEYPOT_FIELD');
});

test('L5: the automated answer is a silent 202, not a 400 that teaches the bot', () => {
  const gate = HANDLER.slice(HANDLER.indexOf('const botGate ='), HANDLER.indexOf('const requiresHardHumanCheck'));
  assert.match(gate, /json\(request, 202, \{ ok: true, accepted: true, deliveryDisclosed: false \}\)/,
    'the gate answers the success shape so the bot does not retry');
  assert.doesNotMatch(gate, /400/, 'a refusal code here would be a free hint');
});

test('L5: a drop reaches the owner through the throttled alert sink, not a console', () => {
  const gate = HANDLER.slice(HANDLER.indexOf('const botGate ='), HANDLER.indexOf('const requiresHardHumanCheck'));
  /* AUTH V2.1: the call now goes through deliverSecurityAlert, which still uses
   * the throttled sink — it wraps it, so the throttle is inside — and adds the
   * two things finding ৪ was about: the promise is handed to waitUntil (a Worker
   * cancels pending work when the response returns, so the alert could be
   * dropped before the fetch was made) and the outcome is reported instead of
   * being thrown away. The throttle assertion is unchanged in substance. */
  assert.match(gate, /deliverSecurityAlert\(\{/, 'the alert goes through the surviving-send helper');
  assert.match(gate, /store: shadowGuardStore\(env\)/, 'and keeps the throttled sink');
  assert.match(gate, /waitUntil:/, 'and is registered so the Worker cannot cancel it');
  assert.match(gate, /event: SECURITY_ALERT_EVENTS\.BOT_GATE_DROP/);
  // `reasons` is the field renderSecurityAlert actually reads; `reason` alone
  // would produce an alert with no detail in it.
  assert.match(gate, /reasons: \[verdict\.reason,/, 'the reason is in the field the renderer reads');
  assert.doesNotMatch(gate, /console\./, 'the auth runtime must not log through the console');
});

test('L5: the drop event renders, and carries the reason and the path', async () => {
  const { renderSecurityAlert, SECURITY_ALERT_EVENTS } = await import('./auth-native/core/security-alerts.mjs');
  const rendered = renderSecurityAlert({
    event: SECURITY_ALERT_EVENTS.BOT_GATE_DROP,
    reasons: ['FORM_TOO_FAST', '/api/auth/v1/signup'],
    at: 1_800_000_000_000
  });
  assert.ok(rendered, 'a known event must render');
  assert.match(rendered.text, /বট-ফাঁদ/);
  assert.match(rendered.text, /FORM_TOO_FAST/);
  assert.match(rendered.text, /signup/);
});

test('L5: every guarded route runs the bot gate before it does any work', () => {
  // A gate that runs after the send is decoration. This walks each of the seven
  // route bodies and requires the guard to come first.
  for (const path of GUARDED) {
    const marker = "request.method === 'POST' && url.pathname === `${AUTH_API_PREFIX}" + path + '`';
    const start = HANDLER.indexOf(marker);
    assert.ok(start > 0, `route ${path} exists`);
    const next = HANDLER.indexOf('if (request.method ===', start + marker.length);
    const block = HANDLER.slice(start, next > 0 ? next : undefined);
    const gate = block.indexOf('await guardSend(');
    assert.ok(gate > 0, `${path} runs guardSend`);
    // The gate must come before anything that spends money or creates state.
    for (const work of ['callAuthority(', 'provider.signUp(', 'provider.signIn(', 'provider.sendPasswordResetEmail(', 'provider.sendVerificationEmail(', 'provider.refresh(']) {
      const at = block.indexOf(work);
      if (at > 0) assert.ok(gate < at, `${path}: the bot gate runs before ${work}`);
    }
  }
  // And the honeypot is checked before the Turnstile round trip, so a submission
  // already known to be automated never pays for a siteverify call.
  assert.ok(
    HANDLER.indexOf('const gate = botGate(request, env, context, body);') < HANDLER.indexOf('await verifyTurnstile({', HANDLER.indexOf('const guardSend =')),
    'the honeypot check precedes the human check'
  );
});

test('L5: the client sends the honeypot and the timing on every guarded call', () => {
  for (const path of GUARDED) {
    const needle = `'${path}'`;
    let at = CLIENT.indexOf(needle);
    let seen = 0;
    while (at >= 0) {
      if (/(?:api|skyApi|backupApiPath)\($/.test(CLIENT.slice(Math.max(0, at - 14), at))) {
        seen += 1;
        const call = CLIENT.slice(at, at + 400);
        assert.ok(call.includes('...botSignals('), `${path} call near offset ${at} sends the bot signals`);
      }
      at = CLIENT.indexOf(needle, at + needle.length);
    }
    assert.ok(seen > 0, `client calls ${path}`);
  }
});

test('L5: the honeypot is hidden by the stylesheet and unreachable by keyboard', () => {
  // Hidden from a person but still a real input, so a scraper that walks the
  // markup fills it in. Off-screen rather than display:none, because some bots
  // skip inputs that are not rendered.
  const css = readFileSync(new URL('./account-access.css', import.meta.url), 'utf8');
  assert.match(css, /\.ah-honeypot\{[^}]*left:-9999px/);
  assert.match(css, /\.ah-honeypot\{[^}]*opacity:0/);
  // The client reads every honeypot input, not just the first form's, so the
  // signup variant cannot silently stop reporting.
  assert.match(CLIENT, /querySelectorAll\('\.ah-honeypot input'\)/);
});

/* ── L6 — device quota ────────────────────────────────────────────────────── */

test('L6: a /64 (v6) or /24 (v4) is the network key, and unparseable is no key', () => {
  assert.equal(networkPrefix('203.0.113.55'), '203.0.113.0/24');
  assert.equal(networkPrefix('2001:db8:1234:5678:9abc:def0:1234:5678'), '2001:0db8:1234:5678');
  // The point of the prefix: cycling the host part must not mint an identity.
  assert.equal(networkPrefix('2001:db8:1234:5678::1'), networkPrefix('2001:db8:1234:5678::ffff'));
  assert.equal(networkPrefix('198.51.100.7'), networkPrefix('198.51.100.200'));
  // A different /64 IS a different network.
  assert.notEqual(networkPrefix('2001:db8:1234:5678::1'), networkPrefix('2001:db8:1234:9999::1'));
  // Unparseable must be '' so the caller treats it as "no signal" rather than
  // lumping every bad header into one shared bucket.
  for (const bad of ['', 'unknown', 'not-an-ip', '1.2.3', '10.0.0.256']) {
    assert.equal(networkPrefix(bad), '', `${JSON.stringify(bad)} must yield no key`);
  }
});

test('L6: one device is capped at 5 OTP a day, across accounts', async () => {
  const app = setup();
  for (let index = 0; index < 5; index += 1) {
    await app.orchestrator.requestVerification(identity(index), context);
  }
  await assert.rejects(
    () => app.orchestrator.requestVerification(identity(99), context),
    error => error?.code === AUTH_ERROR_CODES.RATE_LIMITED
  );
  assert.equal(app.provider.sends.length, 5, 'the sixth send must never reach the provider');
});

test('L6: discarding the cookie does not reset the ceiling, because the /64 is also counted', async () => {
  // The provider quota is raised well above the network ceiling on purpose, so
  // that what stops this run can only be the /64 day cap and not the day's
  // provider budget running out first.
  const app = setup({ quota: 100_000 });
  // The evasion this layer exists for: a fresh device cookie on every request,
  // and — because one address can only spend 20 an hour — a fresh address inside
  // the same /24 as well. One caller cannot reach the /64 ceiling alone; a rented
  // slice of a subnet can. Paced at one request a second, so the global
  // 120/minute window is not what stops it either.
  //
  // The expected number is read from the source rather than written here, so
  // raising the network ceiling does not silently turn this into a test of some
  // other window.
  const networkLimit = Number(/const NETWORK_DAILY_OTP_LIMIT = (\d+)/.exec(
    readFileSync(new URL('./auth-native/verification/orchestrator.mjs', import.meta.url), 'utf8')
  )[1]);
  const perAddress = 20;
  const addresses = Math.ceil((networkLimit + 60) / perAddress);
  let refused = null;
  for (let host = 1; host <= addresses && !refused; host += 1) {
    for (let slot = 0; slot < perAddress; slot += 1) {
      const index = (host - 1) * perAddress + slot;
      try {
        await app.orchestrator.requestVerification(identity(index), {
          ...context,
          ip: `203.0.113.${host}`,
          deviceId: `fresh-device-${String(index).padStart(24, 'd')}`
        });
      } catch (error) { refused = error; break; }
      app.advance(1_000);
    }
  }
  assert.equal(refused?.code, AUTH_ERROR_CODES.RATE_LIMITED);
  assert.equal(app.provider.sends.length, networkLimit, 'the /64 ceiling is what stopped the sweep');
  assert.equal(app.provider.sends.length > perAddress, true, 'no single address could have reached this ceiling');
});

test('L6: a burst inside one minute is stopped by the global window, before any per-key quota', async () => {
  // The finding from the simulated attacks: a sweep that rotates both keys and
  // does not pace itself is stopped at 120 by the global per-minute window, not
  // by the /64 ceiling. That is the right order — the burst limiter is the
  // cheapest wall and it costs the attacker nothing to hit it.
  const app = setup({ quota: 10_000 });
  let refused = null;
  for (let attempt = 0; attempt < 200 && !refused; attempt += 1) {
    try {
      await app.orchestrator.requestVerification(identity(attempt), {
        ...context,
        ip: `2001:db8:1234:5678::${(attempt % 65535).toString(16)}`,
        deviceId: `rotating-device-${String(attempt).padStart(20, '0')}`
      });
    } catch (error) { refused = error; break; }
  }
  assert.equal(refused?.code, AUTH_ERROR_CODES.RATE_LIMITED);
  assert.equal(app.provider.sends.length, 120, 'the global 120/minute window is the first wall a burst meets');
});

test('L6: the network ceiling is per network — a different /64 gets its own allowance', async () => {
  const app = setup();
  // Same device, 45 different /64s. If the network cap were a single global
  // bucket these would start failing at 40, which would be a deployment-wide
  // outage dressed up as a rate limit.
  for (let index = 0; index < 45; index += 1) {
    await app.orchestrator.requestVerification(identity(index), {
      ...context,
      ip: `2001:db8:${index.toString(16)}::1`,
      deviceId: `dev-${String(index).padStart(24, 'd')}`
    });
  }
  assert.equal(app.provider.sends.length, 45, 'each network carries its own daily allowance');
});

test('L6: the network ceiling is far above the device one, so a shared uplink is not starved', () => {
  // Read the constants the source declares rather than guessing at them.
  const src = readFileSync(new URL('./auth-native/verification/orchestrator.mjs', import.meta.url), 'utf8');
  const device = Number(/const DEVICE_DAILY_OTP_LIMIT = (\d+)/.exec(src)[1]);
  const network = Number(/const NETWORK_DAILY_OTP_LIMIT = (\d+)/.exec(src)[1]);
  assert.equal(device, 5, 'the blueprint says a device gets at most 5 a day');
  assert.ok(network >= device * 5, 'a campus /64 must not be capped at one device worth of codes');
  // An absent address must produce no network limit at all, not a shared bucket
  // that every caller without an IP would drain together.
  const limits = setup().orchestrator;
  assert.ok(limits, 'the orchestrator builds');
  assert.match(src, /if \(identity\.networkRef\) \{/, 'the network limit is conditional on having a network');
});

/* ── L7 — destination quota ───────────────────────────────────────────────── */

test('L7: one address is capped at 3 an hour, on top of the 3 a day', async () => {
  const app = setup();
  // The ownership path only delivers to the five real domains (email-policy.js),
  // and only accepts pre-hashed refs from the worker — so the trusted-identity
  // shape below is the one the worker actually passes.
  const trusted = index => ({
    userId: `usr_own_${index}`,
    sessionRef: 'a'.repeat(64),
    subjectRef: 'b'.repeat(64),
    emailRef: 'c'.repeat(64),
    email: 'target@gmail.com',
    recipientName: 'Student'
  });
  const send = index => app.orchestrator.requestVerification(
    { purpose: 'email-ownership', trustedIdentity: trusted(index) }, context
  );

  await send(1);
  app.advance(61_000);
  await send(2);
  app.advance(61_000);
  await send(3);
  assert.equal(app.provider.sends.length, 3, 'three inside the hour are allowed');
  // The fourth, still inside the hour, must be refused by the hourly window.
  app.advance(61_000);
  await assert.rejects(send(4), error => error?.code === AUTH_ERROR_CODES.RATE_LIMITED);
  assert.equal(app.provider.sends.length, 3, 'the refusal happens before the provider is called');
});

test('L7: spreading the same three across the day does not buy a fourth', async () => {
  const app = setup();
  const trusted = index => ({
    userId: `usr_own_${index}`,
    sessionRef: 'a'.repeat(64),
    subjectRef: 'b'.repeat(64),
    emailRef: 'c'.repeat(64),
    email: 'target@gmail.com',
    recipientName: 'Student'
  });
  const send = index => app.orchestrator.requestVerification(
    { purpose: 'email-ownership', trustedIdentity: trusted(index) }, context
  );
  // Just over an hour apart, so every request clears the hourly window. The
  // daily cap is the only thing left that can stop the fourth.
  await send(1); app.advance(3_700_000);
  await send(2); app.advance(3_700_000);
  await send(3); app.advance(3_700_000);
  await assert.rejects(send(4), error => error?.code === AUTH_ERROR_CODES.RATE_LIMITED);
  assert.equal(app.provider.sends.length, 3);
});

test('L7: the daily window is separate from the hourly one and is not raised to 8', () => {
  const src = readFileSync(new URL('./auth-native/verification/orchestrator.mjs', import.meta.url), 'utf8');
  assert.match(src, /const EMAIL_HOURLY_LIMIT = 3/, 'the hourly cap the blueprint names');
  assert.match(src, /const EMAIL_DAILY_LIMIT = 3/,
    "the owner's own 3/day rule stands; the blueprint's 8/day was deliberately not adopted");
  assert.match(src, /scope: 'ownership-email-hour'/, 'the hourly window is a separate scope, so neither resets the other');
});

/* ── L8 — global fuzz ─────────────────────────────────────────────────────── */

test('L8: the band escalates at 80% and hardens at 95%', () => {
  assert.equal(fuzzBand({ used: 0, limit: 100 }).band, 'normal');
  assert.equal(fuzzBand({ used: 79, limit: 100 }).band, 'normal');
  assert.equal(fuzzBand({ used: 80, limit: 100 }).band, 'alert');
  assert.equal(fuzzBand({ used: 94, limit: 100 }).band, 'alert');
  assert.equal(fuzzBand({ used: 95, limit: 100 }).band, 'hard');
  assert.equal(fuzzBand({ used: 100, limit: 100 }).band, 'hard');
  assert.equal(FUZZ_ALERT_RATIO, 0.8);
  assert.equal(FUZZ_HARD_RATIO, 0.95);
});

test('L8: an unlimited slot is never pressure, and the worst slot decides', () => {
  // dailyQuota 0 means "no ceiling by design"; dividing by it would flag everything.
  assert.deepEqual(fuzzBand({ used: 500, limit: 0 }), { band: 'normal', ratio: 0 });
  assert.deepEqual(fuzzBand({}), { band: 'normal', ratio: 0 });
  // One slot in the hard band makes the whole deployment hard.
  assert.equal(worstFuzzBand([{ used: 0, limit: 100 }, { used: 96, limit: 100 }]).band, 'hard');
  assert.equal(worstFuzzBand([{ used: 85, limit: 100 }, { used: 0, limit: 100 }]).band, 'alert');
  assert.equal(worstFuzzBand([{ used: 10, limit: 100 }, { used: 20, limit: 100 }]).band, 'normal');
});

test('L8: the band is measured on the real reservation counters', async () => {
  const app = setup({ quota: 10 });
  assert.equal((await app.orchestrator.fuzzPressure()).band, 'normal');
  for (let index = 0; index < 8; index += 1) {
    await app.orchestrator.requestVerification(identity(index), { ...context, deviceId: `dev-${String(index).padStart(24, 'd')}` });
  }
  const pressure = await app.orchestrator.fuzzPressure();
  assert.equal(pressure.used, 8);
  assert.equal(pressure.limit, 10);
  assert.equal(pressure.band, 'alert', '8 of 10 is the 80% band');
});

test('L8: pressure reaches the owner as an alert, throttled per band', () => {
  const alert = otpAlertFor({ evt: 'otp_delivery', outcome: 'quota_pressure', band: 'hard', ratio: 0.96, provider: 'otp-a' });
  assert.equal(alert.kind, 'fuzz_hard');
  assert.match(alert.title, /96%/);
  const soft = otpAlertFor({ evt: 'otp_delivery', outcome: 'quota_pressure', band: 'alert', ratio: 0.82, provider: 'otp-a' });
  assert.equal(soft.kind, 'fuzz_alert');
  // Same band, different provider => one key, so a run through the slot list
  // does not produce a message per provider.
  assert.equal(alert.key, otpAlertFor({ ...{ evt: 'otp_delivery', outcome: 'quota_pressure', band: 'hard', ratio: 0.97 }, provider: 'otp-b' }).key);
  assert.match(ALERT_SRC, /quota_pressure/, 'the sink knows the event');
});

test('L8: the handler reads the band from the DO, and never blocks on a failure', () => {
  assert.match(DO_SRC, /'\/internal\/verification\/fuzz'/, 'the DO exposes the band');
  assert.match(DO_SRC, /fuzzPressure\(\)/, 'and it comes from the real counters');
  const helper = HANDLER.slice(HANDLER.indexOf('const fuzzBandNow'), HANDLER.indexOf('const guardSend'));
  assert.match(helper, /catch \{\s*\/\/[^]*?return 'normal';/, 'a read failure degrades to normal rather than refusing everyone');
  assert.match(helper, /expiresAt: now \+ FUZZ_CACHE_MS/, 'cached, so a signup does not pay a DO round trip');
});

test('L8: the same pressure also reaches the owner through the security alert sink', () => {
  // Two sinks, deliberately: the OTP alert is per-delivery and the security
  // alert is the owner's audit channel. Both must carry the numbers, because a
  // bare "quota pressure" message cannot be acted on.
  assert.match(DO_SRC, /SECURITY_ALERT_EVENTS\.PROVIDER_QUOTA_PRESSURE/);
  assert.match(ALERT_SRC, /quota_pressure/);
});

/* ── the done-condition: a simulated attack leaves the quota intact ───────── */

test('simulated attack: a bot hammering one endpoint cannot burn the provider quota', async () => {
  const app = setup({ quota: 100 });
  let refused = 0;
  let sent = 0;
  // 500 attempts: same device, same network, rotating accounts — exactly what a
  // signup-bot does when it is not stopped.
  for (let attempt = 0; attempt < 500; attempt += 1) {
    try {
      await app.orchestrator.requestVerification(identity(attempt), context);
      sent += 1;
    } catch (error) {
      assert.equal(error?.code, AUTH_ERROR_CODES.RATE_LIMITED, 'every refusal is a rate limit, not a crash');
      refused += 1;
    }
  }
  assert.equal(sent, 5, 'the device ceiling is the binding one, as designed');
  assert.equal(refused, 495);
  assert.equal(app.provider.sends.length, 5, 'the provider was called five times, not five hundred');
  // The whole point: the day's quota is essentially untouched after the attack.
  const pressure = await app.orchestrator.fuzzPressure();
  assert.equal(pressure.used, 5);
  assert.equal(pressure.band, 'normal', 'a stopped attack must not push the deployment into the fuzz band');
});

test('simulated attack: rotating both the device AND the address still cannot drain the quota', async () => {
  // A big provider budget, so the wall the run hits is the /64 ceiling rather
  // than the provider's own daily limit.
  const app = setup({ quota: 10_000 });
  // The stronger evasion: a fresh device cookie and a fresh address inside the
  // same /64 for every attempt, which is what a rented VPS slice looks like.
  // Paced at one request a second — under the 120/minute global window — so the
  // ceiling the run meets is the /64 one, not the global burst limiter.
  const networkLimit = Number(/const NETWORK_DAILY_OTP_LIMIT = (\d+)/.exec(
    readFileSync(new URL('./auth-native/verification/orchestrator.mjs', import.meta.url), 'utf8')
  )[1]);
  const attempts = networkLimit + 60;
  let sent = 0;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await app.orchestrator.requestVerification(identity(attempt), {
        ...context,
        ip: `2001:db8:1234:5678::${(attempt % 65535).toString(16)}`,
        deviceId: `rotating-device-${String(attempt).padStart(20, '0')}`
      });
      sent += 1;
    } catch { /* rate limited */ }
    app.advance(1_000);
  }
  assert.equal(sent, networkLimit, 'the shared /64 ceiling binds even when the host part rotates');
  assert.equal(app.provider.sends.length, networkLimit);
  assert.ok(app.provider.sends.length < attempts, 'the provider quota survives the attack');
});
