import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const script = readFileSync(new URL('./account-access.js', import.meta.url), 'utf8');
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

const reply = (status, body, headers = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: name => headers[String(name).toLowerCase()] || null },
  async json() { return body; }
});

async function waitFor(predicate, timeout = 1000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (predicate()) return;
    await sleep(5);
  }
  throw new Error('Timed out waiting for UI state.');
}

async function fillGuidedProfile(app, email = 'student@example.com') {
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

function setup({ loginVerified = false, resendMode = 'sent' } = {}) {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'https://admissionhub.pages.dev/',
    runScripts: 'dangerously',
    pretendToBeVisual: true
  });
  const calls = [];
  let verified = loginVerified;
  dom.window.fetch = async (url, options = {}) => {
    const path = String(url);
    const body = options.body ? JSON.parse(options.body) : null;
    calls.push({ path, method: options.method || 'GET', body });
    if (path.endsWith('/config')) return reply(200, {
      auth: { available: true, verificationEmail: { resendCooldownSeconds: 60 } }
    });
    if (path.endsWith('/session') && (options.method || 'GET') === 'GET') {
      return reply(401, { error: { code: 'SESSION_INVALID', message: 'সেশন নেই।' } });
    }
    if (path.endsWith('/signup')) {
      return reply(202, {
        accountCreated: true,
        authenticated: false,
        verification: { sent: true, emailMasked: 's***@example.com', dailyCapacity: 1000, resendAfter: 60 }
      });
    }
    if (path.endsWith('/login')) {
      if (!verified) return reply(403, { error: { code: 'EMAIL_NOT_VERIFIED', message: 'ইমেইল যাচাই করুন।' } });
      return reply(200, {
        authenticated: true,
        emailVerified: true,
        user: { id: 'usr_test', emailMasked: 's***@example.com', status: 'active' },
        session: { expiresAt: Date.now() + 100000 }
      });
    }
    if (path.endsWith('/verification/resend')) {
      if (resendMode === 'rate-limited') {
        return reply(429, {
          error: { code: 'RATE_LIMITED', message: 'একটু অপেক্ষা করুন।', retryAfter: 45 }
        }, { 'retry-after': '45' });
      }
      if (resendMode === 'already-verified') return reply(200, { alreadyVerified: true, authenticated: false });
      return reply(202, {
        authenticated: false,
        verification: { sent: true, emailMasked: 's***@example.com', resendAfter: 60 }
      });
    }
    if (path.endsWith('/session/logout')) return reply(200, { authenticated: false });
    return reply(404, { error: { message: 'not found' } });
  };
  dom.window.eval(script);
  return { dom, window: dom.window, document: dom.window.document, calls, setVerified: value => { verified = value; } };
}

test('signup UI collects Email and Password, clears passwords, and waits for standard verification', async () => {
  const app = setup();
  await waitFor(() => app.document.querySelector('#ah-account-page'));
  await waitFor(() => app.calls.some(call => call.path.endsWith('/config')));
  await sleep(0);
  app.window.AdmissionAccount.open();
  app.document.querySelector('[data-role="show-signup"]').click();
  await fillGuidedProfile(app);
  app.document.querySelector('#ah-signup-password').value = 'Secure-password-44';
  app.document.querySelector('#ah-signup-confirm').value = 'Secure-password-44';
  const signupForm = app.document.querySelector('[data-view="signup"]');
  signupForm.dispatchEvent(new app.window.Event('submit', { bubbles: true, cancelable: true }));
  signupForm.dispatchEvent(new app.window.Event('submit', { bubbles: true, cancelable: true }));
  await waitFor(() => app.calls.some(call => call.path.endsWith('/signup')));
  await waitFor(() => app.document.querySelector('[data-view="created"]').hidden === false);
  app.document.querySelector('[data-role="created-continue"]').click();
  await waitFor(() => app.document.querySelector('[data-view="verify"]').hidden === false);

  const signupCall = app.calls.find(call => call.path.endsWith('/signup'));
  const { turnstileToken, ...signupCredentials } = signupCall.body;
  assert.deepEqual(signupCredentials, { email: 'student@example.com', password: 'Secure-password-44' });
  // F-03: the signup call carries a Turnstile token field; it is empty only when
  // the widget did not load, and the server decides whether that is acceptable.
  assert.equal(typeof turnstileToken, 'string');
  assert.equal(app.calls.filter(call => call.path.endsWith('/signup')).length, 1);
  const resendButton = app.document.querySelector('[data-role="resend-submit"]');
  assert.equal(resendButton.disabled, true);
  assert.match(resendButton.textContent, /৫[৮৯]|৬০|5[89]|60/);
  assert.match(app.document.querySelector('[data-role="resend-status"]').textContent, /সেকেন্ড পর/);
  assert.equal(app.document.querySelector('#ah-signup-password').value, '');
  assert.equal(app.document.querySelector('#ah-signup-confirm').value, '');
  assert.equal(app.window.AdmissionAccount.isVerified(), false);
  assert.match(app.document.querySelector('[data-view="verify"]').textContent, /Verification pending|verification-এর অপেক্ষায়/);
  app.dom.window.close();
});

test('UI blocks unverified login and exposes verified state only after server-confirmed login', async () => {
  const app = setup();
  let latestAuth = null;
  app.window.addEventListener('admissionhub:authchange', event => { latestAuth = event.detail; });
  await waitFor(() => app.document.querySelector('#ah-account-page'));
  await waitFor(() => app.calls.some(call => call.path.endsWith('/config')));
  await sleep(0);
  app.window.AdmissionAccount.open();
  app.document.querySelector('#ah-login-email').value = 'student@example.com';
  app.document.querySelector('#ah-login-password').value = 'Secure-password-44';
  app.document.querySelector('[data-view="login"]').dispatchEvent(new app.window.Event('submit', { bubbles: true, cancelable: true }));
  await waitFor(() => app.document.querySelector('[data-view="verify"]').hidden === false);
  assert.equal(app.window.AdmissionAccount.isVerified(), false);
  assert.equal(app.document.querySelector('#ah-login-password').value, '');

  app.setVerified(true);
  app.document.querySelector('[data-role="verified-login"]').click();
  app.document.querySelector('#ah-login-password').value = 'Secure-password-44';
  app.document.querySelector('[data-view="login"]').dispatchEvent(new app.window.Event('submit', { bubbles: true, cancelable: true }));
  await waitFor(() => app.document.querySelector('[data-view="signed"]').hidden === false);
  assert.equal(app.window.AdmissionAccount.isVerified(), true);
  assert.equal(latestAuth.authenticated, true);
  assert.equal(latestAuth.emailVerified, true);
  app.dom.window.close();
});

test('resend UI enforces Retry-After countdown, blocks repeated submit, and clears the password', async () => {
  const app = setup({ resendMode: 'rate-limited' });
  await waitFor(() => app.document.querySelector('#ah-account-page'));
  await waitFor(() => app.calls.some(call => call.path.endsWith('/config')));
  await sleep(0);
  app.window.AdmissionAccount.open();
  app.document.querySelector('#ah-login-email').value = 'student@example.com';
  app.document.querySelector('#ah-login-password').value = 'Secure-password-44';
  app.document.querySelector('[data-view="login"]').dispatchEvent(new app.window.Event('submit', { bubbles: true, cancelable: true }));
  await waitFor(() => app.document.querySelector('[data-view="verify"]').hidden === false);

  app.document.querySelector('#ah-resend-email').value = 'student@example.com';
  app.document.querySelector('#ah-resend-password').value = 'Secure-password-44';
  const form = app.document.querySelector('[data-role="resend-form"]');
  form.dispatchEvent(new app.window.Event('submit', { bubbles: true, cancelable: true }));
  form.dispatchEvent(new app.window.Event('submit', { bubbles: true, cancelable: true }));
  await waitFor(() => app.calls.some(call => call.path.endsWith('/verification/resend')));
  await waitFor(() => app.document.querySelector('#ah-resend-password').value === '');
  await waitFor(() => app.document.querySelector('[data-role="resend-submit"]').disabled === true);

  assert.equal(app.calls.filter(call => call.path.endsWith('/verification/resend')).length, 1);
  assert.equal(app.document.querySelector('#ah-resend-password').value, '');
  assert.match(app.document.querySelector('[data-role="resend-submit"]').textContent, /৪[৩-৫]|4[3-5]/);
  assert.match(app.document.querySelector('[data-role="message"]').textContent, /অপেক্ষা/);
  app.dom.window.close();
});

test('resend UI handles an already-verified account without creating a frontend session', async () => {
  const app = setup({ resendMode: 'already-verified' });
  await waitFor(() => app.document.querySelector('#ah-account-page'));
  await waitFor(() => app.calls.some(call => call.path.endsWith('/config')));
  await sleep(0);
  app.window.AdmissionAccount.open();
  app.document.querySelector('#ah-login-email').value = 'student@example.com';
  app.document.querySelector('#ah-login-password').value = 'Secure-password-44';
  app.document.querySelector('[data-view="login"]').dispatchEvent(new app.window.Event('submit', { bubbles: true, cancelable: true }));
  await waitFor(() => app.document.querySelector('[data-view="verify"]').hidden === false);

  app.document.querySelector('#ah-resend-email').value = 'student@example.com';
  app.document.querySelector('#ah-resend-password').value = 'Secure-password-44';
  app.document.querySelector('[data-role="resend-form"]').dispatchEvent(new app.window.Event('submit', { bubbles: true, cancelable: true }));
  await waitFor(() => app.document.querySelector('[data-view="login"]').hidden === false);

  assert.match(app.document.querySelector('[data-role="message"]').textContent, /ইতিমধ্যে যাচাইকৃত/);
  assert.equal(app.window.AdmissionAccount.isVerified(), false);
  app.dom.window.close();
});
