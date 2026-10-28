import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const script = readFileSync(new URL('./account-access.js', import.meta.url), 'utf8');
const reply = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: () => null },
  async json() { return body; }
});
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
async function waitFor(predicate, timeout = 6000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    if (predicate()) return;
    await sleep(5);
  }
  throw new Error('Timed out waiting for Telegram UI state.');
}

const interaction = token => ({
  type: 'telegram-link',
  url: `https://t.me/AdmissionHubVerifyBot?start=${token}`,
  proof: 'local-code-required',
  identityKind: 'telegram-account',
  phoneOwnership: false
});

function setup({ pending = { pending: false }, verifyPlan = [], verifyGate = null, pageUrl = 'https://admissionhub.pages.dev/?telegramCanary=1' } = {}) {
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
    url: pageUrl,
    runScripts: 'dangerously',
    pretendToBeVisual: true
  });
  Object.defineProperty(dom.window.navigator, 'userAgent', {
    value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit Mobile Safari',
    configurable: true
  });
  Object.defineProperty(dom.window, 'innerWidth', { value: 390, configurable: true });
  const calls = [];
  let currentPending = pending;
  let challengeSequence = 1;
  dom.window.fetch = async (url, options = {}) => {
    const path = String(url);
    const body = options.body ? JSON.parse(options.body) : null;
    calls.push({ path, method: options.method || 'GET', body, headers: options.headers || {} });
    if (path.includes('/config')) return reply(200, {
      auth: {
        available: true,
        methods: {
          google: { available: false },
          passkey: { available: false },
          emailPassword: { available: true },
          telegramVerification: {
            available: true,
            availabilityCode: 'READY',
            optional: true,
            codeLength: 6,
            expiresInSeconds: 300,
            maxAttempts: 5,
            verifiesEmailOwnership: false,
            canonicalIdentity: 'firebase-uid'
          },
          backup: { available: true, genericFlow: true, contactInput: 'none' }
        },
        verificationEmail: { resendCooldownSeconds: 60 }
      }
    });
    if (path.includes('/session') && !path.includes('/session/') && (options.method || 'GET') === 'GET') {
      return reply(401, { error: { code: 'SESSION_INVALID', message: 'সেশন নেই।' } });
    }
    if (path.includes('/telegram/verification/pending')) return reply(200, currentPending);
    if (path.includes('/login')) {
      return reply(202, {
        authenticated: false,
        accountVerified: false,
        verification: {
          sent: false,
          selectionRequired: true,
          emailMasked: 's***@example.com',
          options: { email: { available: true }, telegram: { available: true, verifiesEmailOwnership: false } }
        }
      });
    }
    if (path.includes('/signup')) {
      return reply(202, {
        accountCreated: true,
        authenticated: false,
        verification: {
          sent: false,
          selectionRequired: true,
          emailMasked: 's***@example.com',
          options: { email: { available: true }, telegram: { available: true, verifiesEmailOwnership: false } }
        }
      });
    }
    if (path.includes('/account-verification/email/start')) {
      return reply(202, { authenticated: false, verification: { sent: true, emailMasked: 's***@example.com', resendAfter: 60 } });
    }
    if (path.includes('/telegram/verification/start')) {
      const token = 'S'.repeat(42) + challengeSequence;
      currentPending = {
        pending: true,
        attemptId: `telegram-ui-attempt-${challengeSequence}-123456789`,
        expiresAt: Date.now() + 300_000,
        resendAt: Date.now(),
        codeSent: false,
        interaction: interaction(token)
      };
      return reply(202, {
        accepted: true,
        attemptId: currentPending.attemptId,
        expiresAt: currentPending.expiresAt,
        resendAfter: 0,
        attemptsAllowed: 5,
        interaction: currentPending.interaction
      });
    }
    if (path.includes('/telegram/verification/resend')) {
      challengeSequence += 1;
      const token = 'R'.repeat(42) + challengeSequence;
      currentPending = {
        pending: true,
        attemptId: `telegram-ui-attempt-${challengeSequence}-123456789`,
        expiresAt: Date.now() + 300_000,
        resendAt: Date.now(),
        codeSent: false,
        interaction: interaction(token)
      };
      return reply(202, {
        accepted: true,
        attemptId: currentPending.attemptId,
        expiresAt: currentPending.expiresAt,
        resendAfter: 0,
        attemptsAllowed: 5,
        interaction: currentPending.interaction
      });
    }
    if (path.includes('/telegram/verification/verify')) {
      if (verifyGate) await verifyGate;
      const next = verifyPlan.shift() || { status: 200, body: {
        authenticated: true,
        accountVerified: true,
        emailVerified: false,
        telegramVerified: true,
        user: { id: 'usr-telegram-ui', emailMasked: 's***@example.com' }
      } };
      return reply(next.status, next.body);
    }
    return reply(404, { error: { code: 'NOT_FOUND', message: 'পাওয়া যায়নি।' } });
  };
  dom.window.eval(script);
  return { dom, window: dom.window, document: dom.window.document, calls };
}

async function fillGuidedProfile(app, email) {
  const { document, window } = app;
  document.querySelector('#ah-signup-name').value = 'Test Student';
  document.querySelector('#ah-dob-day').value = '12';
  document.querySelector('#ah-dob-month').value = '5';
  document.querySelector('#ah-dob-year').value = '2007';
  document.querySelector('[data-role="signup-next-education"]').click();
  const school = document.querySelector('#ah-signup-school');
  school.value = 'Test School';
  school.dispatchEvent(new window.Event('input', { bubbles: true }));
  await waitFor(() => document.querySelectorAll('#ah-school-results [role="option"]').length > 0);
  [...document.querySelectorAll('#ah-school-results [role="option"]')].at(-1).click();
  document.querySelector('[data-role="signup-next-college"]').click();
  document.querySelector('[data-role="signup-next-security"]').click();
  document.querySelector('#ah-signup-email').value = email;
}

async function openSignupTelegram(app) {
  await waitFor(() => app.calls.some(call => call.path.includes('/config?telegramCanary=1')));
  app.window.AdmissionAccount.open();
  app.document.querySelector('[data-role="show-signup"]').click();
  await fillGuidedProfile(app, 'student@example.com');
  app.document.querySelector('#ah-signup-password').value = 'StrongPassword!9';
  app.document.querySelector('#ah-signup-confirm').value = 'StrongPassword!9';
  app.document.querySelector('[data-view="signup"]').dispatchEvent(new app.window.Event('submit', { bubbles: true, cancelable: true }));
  await waitFor(() => app.document.querySelector('[data-view="created"]').hidden === false);
  app.document.querySelector('[data-role="created-continue"]').click();
  await waitFor(() => app.document.querySelector('[data-view="verify"]').hidden === false);
  assert.equal(app.document.querySelector('[data-role="verification-selection"]').hidden, false);
  assert.equal(app.calls.some(call => call.path.includes('/account-verification/email/start')), false);
  assert.equal(app.calls.some(call => call.path.includes('/telegram/verification/start')), false);
  assert.match(app.document.querySelector('[data-role="email-verification-start"]').textContent, /Email/);
  app.document.querySelector('[data-role="telegram-verification-start"]').click();
  assert.equal(app.document.querySelector('[data-view="telegram-intro"]').hidden, false);
  assert.equal(app.calls.some(call => call.path.includes('/telegram/verification/start')), false);
  app.document.querySelector('[data-role="telegram-intro-continue"]').click();
  await waitFor(() => app.calls.some(call => call.path.includes('/telegram/verification/start')));
  await waitFor(() => app.document.querySelector('[data-view="telegram"]').hidden === false);
}

/* RETIRED 2026-10-24: the owner removed the post-signup "verify with Telegram"
 * choice on 2026-10-18 (see the capability reset in account-access.js:
 * "Telegram is a LOGIN method now; the post-signup Telegram verification choice
 * is removed"). The client no longer exposes that flow, so these tests drive UI
 * that cannot exist. They are skipped rather than deleted so the assertions are
 * still here if the flow is ever re-enabled. */
test.skip('mobile-first signup presents Verify with Telegram, START link, OTP box, checking, and authoritative success states', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const app = setup({ verifyGate: gate });
  await openSignupTelegram(app);
  const view = app.document.querySelector('[data-view="telegram"]');
  const link = app.document.querySelector('[data-role="telegram-link"]');
  const code = app.document.querySelector('#ah-telegram-code');
  assert.match(link.href, /^https:\/\/t\.me\/AdmissionHubVerifyBot\?start=/);
  assert.equal(link.target, '_blank');
  assert.equal(link.rel, 'noopener noreferrer');
  assert.equal(code.inputMode, 'numeric');
  assert.equal(code.autocomplete, 'one-time-code');
  assert.equal(code.maxLength, 6);
  assert.equal(view.querySelectorAll('[data-otp-digit]').length, 6);
  assert.match(view.textContent, /START/);
  assert.match(view.textContent, /Email মালিকানা নয়/);
  assert.match(view.textContent, /Code বা Password কখনো অন্য কোনো chat-এ লিখবে না/);
  assert.doesNotMatch(view.textContent, /Assistant/);

  code.value = '654321';
  view.dispatchEvent(new app.window.Event('submit', { bubbles: true, cancelable: true }));
  await waitFor(() => view.dataset.state === 'checking');
  const verifyCall = app.calls.find(call => call.path.includes('/telegram/verification/verify'));
  assert.deepEqual(verifyCall.body, { attemptId: 'telegram-ui-attempt-1-123456789', code: '654321' });
  assert.equal(JSON.stringify(verifyCall.body).includes('start='), false);
  release();
  await waitFor(() => app.document.querySelector('[data-view="verified"]').hidden === false);
  assert.match(app.document.querySelector('[data-role="verified-title"]').textContent, /Telegram Verified/);
  assert.doesNotMatch(app.document.querySelector('[data-role="verified-copy"]').textContent, /Email মালিকানা নিশ্চিত/);
  app.document.querySelector('[data-role="verified-continue"]').click();
  await waitFor(() => app.document.querySelector('[data-view="success"]').hidden === false);
  assert.equal(app.window.AdmissionAccount.isVerified(), true);
  app.window.AdmissionAccount.open();
  await waitFor(() => app.document.querySelector('[data-view="signed"]').hidden === false);
  assert.equal(app.window.AdmissionAccount.getSession().emailVerified, false);
  assert.equal(app.window.AdmissionAccount.getSession().telegramVerified, true);
  assert.match(app.document.querySelector('[data-role="account-verification-summary"]').textContent, /Email মালিকানা দাবি করা হয়নি/);
  assert.equal(app.window.localStorage.length, 0);
  assert.equal(app.window.sessionStorage.length, 0);
  app.dom.window.close();
});

test('signup sends no verification message until the student chooses Email or Telegram', async () => {
  const app = setup();
  await waitFor(() => app.calls.some(call => call.path.includes('/config?telegramCanary=1')));
  app.window.AdmissionAccount.open();
  app.document.querySelector('[data-role="show-signup"]').click();
  await fillGuidedProfile(app, 'choice@example.com');
  app.document.querySelector('#ah-signup-password').value = 'StrongPassword!9';
  app.document.querySelector('#ah-signup-confirm').value = 'StrongPassword!9';
  app.document.querySelector('[data-view="signup"]').dispatchEvent(new app.window.Event('submit', { bubbles: true, cancelable: true }));
  await waitFor(() => app.document.querySelector('[data-view="created"]').hidden === false);
  app.document.querySelector('[data-role="created-continue"]').click();
  await waitFor(() => app.document.querySelector('[data-role="verification-selection"]').hidden === false);
  const signupCall = app.calls.find(call => call.path.includes('/signup'));
  assert.equal(signupCall.headers['X-AH-Auth-UI'], 'auth-premium-v6');
  assert.equal(app.calls.some(call => call.path.includes('/account-verification/email/start')), false);
  assert.equal(app.calls.some(call => call.path.includes('/telegram/verification/start')), false);
  await waitFor(() => app.document.querySelector('[data-role="email-verification-start"]').disabled === false);
  app.document.querySelector('[data-role="email-verification-start"]').click();
  assert.equal(app.document.querySelector('[data-view="email-intro"]').hidden, false);
  assert.equal(app.calls.some(call => call.path.includes('/account-verification/email/start')), false);
  app.document.querySelector('[data-role="email-intro-continue"]').click();
  await waitFor(() => app.calls.some(call => call.path.includes('/account-verification/email/start')));
  await waitFor(() => app.document.querySelector('[data-role="verification-email-panel"]').hidden === false);
  assert.match(app.document.querySelector('[data-role="verification-title"]').textContent, /pending/i);
  assert.equal(app.calls.filter(call => call.path.includes('/account-verification/email/start')).length, 1);
  assert.equal(app.calls.some(call => call.path.includes('/telegram/verification/start')), false);
  app.dom.window.close();
});

test.skip('existing unverified login offers the Telegram alternative without creating a frontend session', async () => {
  const app = setup();
  await waitFor(() => app.calls.some(call => call.path.includes('/config?telegramCanary=1')));
  app.window.AdmissionAccount.open();
  app.document.querySelector('#ah-login-email').value = 'student@example.com';
  app.document.querySelector('#ah-login-password').value = 'StrongPassword!9';
  app.document.querySelector('[data-view="login"]').dispatchEvent(new app.window.Event('submit', { bubbles: true, cancelable: true }));
  await waitFor(() => app.document.querySelector('[data-view="verify"]').hidden === false);
  assert.equal(app.window.AdmissionAccount.getSession(), null);
  assert.equal(app.document.querySelector('[data-role="verification-selection"]').hidden, false);
  assert.equal(app.document.querySelector('[data-role="telegram-verification-start"]').hidden, false);
  assert.equal(app.calls.some(call => call.path.includes('/telegram/verification/start')), false);
  assert.equal(app.document.querySelector('#ah-login-password').value, '');
  app.dom.window.close();
});

test.skip('Telegram UI renders wrong, expired, locked, unavailable, and resend states without guessing or retaining a code', async () => {
  const plans = [
    { status: 401, body: { error: { code: 'OTP_INVALID', message: 'কোডটি সঠিক নয়।' } } },
    { status: 410, body: { error: { code: 'OTP_EXPIRED', message: 'কোডের সময় শেষ।' } } },
    { status: 429, body: { error: { code: 'OTP_LOCKED', message: 'সাময়িকভাবে বন্ধ।', retryAfter: 900 } } },
    { status: 503, body: { error: { code: 'TELEGRAM_VERIFICATION_UNAVAILABLE', message: 'সেবা পাওয়া যাচ্ছে না।' } } }
  ];
  const app = setup({ verifyPlan: plans });
  await openSignupTelegram(app);
  const view = app.document.querySelector('[data-view="telegram"]');
  const input = app.document.querySelector('#ah-telegram-code');
  const submit = async expected => {
    input.value = '111111';
    view.dispatchEvent(new app.window.Event('submit', { bubbles: true, cancelable: true }));
    await waitFor(() => view.dataset.state === expected);
    assert.equal(input.value, '');
  };
  await submit('wrong');
  await submit('expired');
  // Expired disables verification; get a fresh challenge before testing the next server states.
  app.document.querySelector('[data-role="telegram-resend"]').click();
  await waitFor(() => app.calls.some(call => call.path.includes('/telegram/verification/resend')));
  await waitFor(() => view.dataset.state === 'waiting');
  await submit('locked');
  // A locked challenge is terminal in the UI; reopen with a fresh fixture for unavailable.
  app.dom.window.close();

  const unavailable = setup({ verifyPlan: [plans[0] || {
    status: 503,
    body: { error: { code: 'TELEGRAM_VERIFICATION_UNAVAILABLE', message: 'সেবা পাওয়া যাচ্ছে না।' } }
  }] });
  // plans[0] is now the unavailable entry after the prior shifts.
  await openSignupTelegram(unavailable);
  const unavailableView = unavailable.document.querySelector('[data-view="telegram"]');
  unavailable.document.querySelector('#ah-telegram-code').value = '222222';
  unavailableView.dispatchEvent(new unavailable.window.Event('submit', { bubbles: true, cancelable: true }));
  await waitFor(() => unavailableView.dataset.state === 'unavailable');
  assert.match(unavailable.document.querySelector('[data-role="telegram-status"]').textContent, /ইমেইল ব্যবহার করুন/);
  unavailable.dom.window.close();
});

test.skip('refresh and reopen recover both pre-START links and post-START code-entry state on Mobile Safari', async t => {
  await t.test('pre-START link recovery', async () => {
    const token = 'P'.repeat(43);
    const app = setup({ pending: {
      pending: true,
      attemptId: 'pending-ui-attempt-123456789',
      expiresAt: Date.now() + 300_000,
      resendAt: Date.now() + 60_000,
      codeSent: false,
      interaction: interaction(token)
    } });
    await waitFor(() => app.calls.some(call => call.path.includes('/telegram/verification/pending')));
    app.window.AdmissionAccount.open();
    await waitFor(() => app.document.querySelector('[data-view="telegram"]').hidden === false);
    assert.equal(new URL(app.document.querySelector('[data-role="telegram-link"]').href).searchParams.get('start'), token);
    assert.equal(app.window.localStorage.length, 0);
    assert.equal(app.window.sessionStorage.length, 0);
    app.dom.window.close();
  });

  await t.test('post-START code-entry recovery', async () => {
    const app = setup({ pending: {
      pending: true,
      attemptId: 'pending-code-ui-attempt-12345',
      expiresAt: Date.now() + 240_000,
      resendAt: Date.now() + 30_000,
      codeSent: true
    } });
    await waitFor(() => app.calls.some(call => call.path.includes('/telegram/verification/pending')));
    app.window.AdmissionAccount.open();
    await waitFor(() => app.document.querySelector('[data-view="telegram"]').hidden === false);
    assert.equal(app.document.querySelector('[data-role="telegram-link"]').hidden, true);
    assert.match(app.document.querySelector('[data-role="telegram-status"]').textContent, /কোড পাঠানো হয়েছে/);
    assert.equal(app.document.querySelector('#ah-telegram-code').disabled, false);
    app.dom.window.close();
  });
});
