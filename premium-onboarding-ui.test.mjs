import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const accountSource = readFileSync(new URL('./account-access.js', import.meta.url), 'utf8');
const accountCss = readFileSync(new URL('./account-access.css', import.meta.url), 'utf8');
const institutionSource = readFileSync(new URL('./institutions-bd.js', import.meta.url), 'utf8');

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(check, timeout = 1800) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (check()) return;
    await wait(10);
  }
  throw new Error('Timed out waiting for premium onboarding state.');
}

function jsonReply(status, body, headers = {}) {
  const normalized = Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), String(value)]));
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: key => normalized[String(key).toLowerCase()] || null },
    json: async () => body
  };
}

function setup({
  cookie = '',
  signupError = '',
  emailStatuses = [],
  signedSession = null,
  googleAvailable = true,
  aiText = 'Education ধাপে School suggestion বেছে নাও।',
  aiFailure = false,
  url = 'https://admissionhub.pages.dev/',
  startupDelay = 0,
  profileDelay = 0
} = {}) {
  const dom = new JSDOM('<!doctype html><html><body><main id="app"></main></body></html>', {
    url,
    runScripts: 'dangerously',
    pretendToBeVisual: true
  });
  const { window } = dom;
  const calls = [];
  let statusIndex = 0;
  if (cookie) {
    for (const pair of cookie.split(/;\s*/)) {
      if (pair.includes('=')) window.document.cookie = `${pair}; Path=/; SameSite=Lax`;
    }
  }
  window.open = () => ({ closed: false });
  window.PublicKeyCredential = undefined;
  window.fetch = async (url, options = {}) => {
    const path = String(url);
    let body = null;
    try { body = options.body ? JSON.parse(options.body) : null; } catch {}
    const headers = Object.fromEntries(Object.entries(options.headers || {}));
    calls.push({ path, method: options.method || 'GET', body, headers });
    if (startupDelay > 0 && (path.includes('/config') || (path.includes('/session') && !path.includes('/session/')))) {
      await new Promise(resolve => setTimeout(resolve, startupDelay));
    }

    if (path.includes('/api/ai/chat')) {
      if (aiFailure) return new Response('', { status: 503 });
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ text: aiText })}\n\n`));
          controller.enqueue(new TextEncoder().encode('event: done\ndata: {}\n\n'));
          controller.close();
        }
      });
      return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    }
    if (path.includes('/config')) return jsonReply(200, {
      auth: {
        available: true,
        uiContract: 'auth-premium-v6',
        methods: {
          google: { available: googleAvailable, clientId: googleAvailable ? 'client.apps.googleusercontent.com' : '' },
          passkey: { available: false, enrollmentAvailable: false },
          telegramVerification: { available: true },
          backup: { available: false }
        }
      }
    });
    if (path.includes('/session') && !path.includes('/session/')) {
      return signedSession ? jsonReply(200, signedSession) : jsonReply(401, { error: { code: 'SESSION_INVALID' } });
    }
    if (path.includes('/telegram/verification/pending')) return jsonReply(404, { error: { code: 'TELEGRAM_VERIFICATION_INVALID' } });
    if (path.includes('/signup')) {
      if (signupError) return jsonReply(503, { error: { code: signupError } });
      return jsonReply(202, {
        verification: { selectionRequired: true, sent: false, emailMasked: 's***@example.com', resendAfter: 0 }
      });
    }
    if (path.includes('/profile/pending')) {
      if (profileDelay > 0) await new Promise(resolve => setTimeout(resolve, profileDelay));
      return jsonReply(200, { saved: true, profile: { version: 1 } });
    }
    if (path.includes('/account-verification/email/start')) return jsonReply(202, {
      verification: { sent: true, emailMasked: 's***@example.com', resendAfter: 0 }
    });
    if (path.includes('/account-verification/email/status')) {
      const authenticated = Boolean(emailStatuses[Math.min(statusIndex++, Math.max(0, emailStatuses.length - 1))]);
      return authenticated
        ? jsonReply(200, { authenticated: true, emailVerified: true, user: { emailMasked: 's***@example.com' } })
        : jsonReply(200, { authenticated: false, emailVerified: false });
    }
    if (path.includes('/password-reset')) return jsonReply(202, { accepted: true, deliveryDisclosed: false });
    if (path.endsWith('/profile')) return jsonReply(200, { profile: null });
    return jsonReply(404, { error: { code: 'NOT_FOUND' } });
  };
  window.eval(institutionSource);
  window.eval(accountSource);
  return { dom, window, document: window.document, calls };
}

async function openSignup(app) {
  await waitFor(() => app.calls.some(call => call.path.includes('/config')));
  await waitFor(() => app.document.querySelector('[data-view="welcome"]')?.hidden === false);
  app.document.querySelector('[data-role="welcome-signup"]').click();
}

async function completeGuidedFields(app, email = 'student@example.com') {
  const { document, window } = app;
  document.querySelector('#ah-signup-name').value = 'Test Student';
  document.querySelector('#ah-dob-day').value = '12';
  document.querySelector('#ah-dob-month').value = '5';
  document.querySelector('#ah-dob-year').value = '2007';
  for (const id of ['ah-dob-day', 'ah-dob-month', 'ah-dob-year']) {
    document.getElementById(id).dispatchEvent(new window.Event('change', { bubbles: true }));
  }
  document.querySelector('[data-role="signup-next-education"]').click();
  await waitFor(() => document.querySelector('[data-signup-panel="school"]').hidden === false);
  const school = document.querySelector('#ah-signup-school');
  school.value = 'Cox';
  school.dispatchEvent(new window.Event('input', { bubbles: true }));
  await waitFor(() => document.querySelectorAll('#ah-school-results [role="option"]').length > 0);
  document.querySelector('#ah-school-results [role="option"]').click();
  document.querySelector('[data-role="signup-next-college"]').click();
  await waitFor(() => document.querySelector('[data-signup-panel="college"]').hidden === false);
  document.querySelector('[data-role="signup-next-security"]').click();
  await waitFor(() => document.querySelector('[data-signup-panel="security"]').hidden === false);
  document.querySelector('#ah-signup-email').value = email;
  const password = document.querySelector('#ah-signup-password');
  const confirm = document.querySelector('#ah-signup-confirm');
  password.value = 'StrongPassword!9';
  confirm.value = 'StrongPassword!9';
  password.dispatchEvent(new window.Event('input', { bubbles: true }));
  confirm.dispatchEvent(new window.Event('input', { bubbles: true }));
}

function submitSignup(app) {
  app.document.querySelector('[data-view="signup"]').dispatchEvent(new app.window.Event('submit', {
    bubbles: true,
    cancelable: true
  }));
}

test('first entry has exactly four paths; Guest goes directly to Dashboard and is remembered without browser storage', async t => {
  const first = setup();
  t.after(() => first.dom.window.close());
  await waitFor(() => first.document.querySelector('[data-view="welcome"]')?.hidden === false);
  const paths = [...first.document.querySelectorAll('.ah-entry-actions button')];
  assert.equal(paths.length, 4);
  const welcomeText = first.document.querySelector('[data-view="welcome"]').textContent;
  for (const label of ['Sign Up', 'Log In', 'Continue with Google', 'Continue as Guest']) assert.match(welcomeText, new RegExp(label));
  assert.doesNotMatch(welcomeText, /Firebase|SMTP|webhook|quota|backend|database|\bAPI\b|\bprovider\b|\btoken\b/i);
  assert.equal(first.document.querySelector('[data-role="close"]').hidden, true);
  first.document.querySelector('.ah-account-page').dispatchEvent(new first.window.Event('click', { bubbles: true }));
  first.document.dispatchEvent(new first.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(first.document.querySelector('[data-view="welcome"]').hidden, false);
  first.document.querySelector('[data-role="welcome-login"]').click();
  first.document.querySelector('[data-role="close"]').click();
  assert.equal(first.document.querySelector('[data-view="welcome"]').hidden, false);
  first.document.querySelector('[data-role="welcome-signup"]').click();
  first.document.querySelector('[data-role="close"]').click();
  assert.equal(first.document.querySelector('[data-view="welcome"]').hidden, false);
  first.document.querySelector('[data-role="continue-guest"]').click();
  await waitFor(() => first.document.querySelector('.ah-account-page').hidden === true);
  assert.equal(first.window.location.hash, '#dashboard');
  assert.match(first.document.cookie, /ah_entry_v1=guest/);
  assert.equal(first.window.localStorage.length, 0);
  assert.equal(first.window.sessionStorage.length, 0);
  const rememberedCookie = first.document.cookie;
  first.dom.window.close();

  const returning = setup({ cookie: rememberedCookie });
  t.after(() => returning.dom.window.close());
  await waitFor(() => returning.calls.some(call => call.path.includes('/session')));
  await wait(30);
  assert.equal(returning.document.querySelector('.ah-account-page').hidden, true);
  returning.window.AdmissionAccount.open();
  assert.equal(returning.document.querySelector('[data-view="login"]').hidden, false);
  assert.equal(returning.document.querySelector('[data-view="welcome"]').hidden, true);
  returning.dom.window.close();
});

test('slow account startup never delays Welcome or blocks direct Guest entry', async t => {
  const startedAt = Date.now();
  const app = setup({ startupDelay: 1000 });
  t.after(() => app.dom.window.close());
  await waitFor(() => app.document.querySelector('[data-view="welcome"]')?.hidden === false);
  assert.ok(Date.now() - startedAt < 800);
  app.document.querySelector('[data-role="continue-guest"]').click();
  assert.equal(app.document.querySelector('.ah-account-page').hidden, true);
  assert.match(app.document.cookie, /ah_entry_v1=guest/);
  assert.equal(app.window.location.hash, '#dashboard');
  await new Promise(resolve => setTimeout(resolve, 1050));
  assert.equal(app.document.querySelector('.ah-account-page').hidden, true);
  app.dom.window.close();
});

test('Signup 01 Personal uses a premium dropdown DOB picker and keeps name together on one screen', async t => {
  const app = setup();
  t.after(() => app.dom.window.close());
  await openSignup(app);
  const personal = app.document.querySelector('[data-signup-panel="personal"]');
  const signup = app.document.querySelector('[data-view="signup"]');
  assert.equal(signup.dataset.personalVisualContract, 'interactive-native-personal-v1');
  assert.equal(signup.dataset.mediaContract, 'zero-raster-entry-v1');
  assert.equal(personal.hidden, false);
  assert.equal(app.document.querySelector('[data-signup-panel="dob"]'), null);
  assert.match(personal.textContent, /Set up your profile/);
  assert.match(personal.textContent, /Personal information/);
  assert.match(personal.textContent, /Continue/);
  assert.equal(personal.querySelector('.ah-dob-select').id, 'ah-dob-day');
  assert.equal(personal.querySelectorAll('.ah-dob-select').length, 3);
  assert.equal(personal.querySelectorAll('.ah-dob-wheel').length, 0);
  assert.doesNotMatch(personal.textContent, /LIVE PROFILE/);
  assert.doesNotMatch(accountSource, /onboarding-(?:welcome|personal)-hero\.webp/);
  assert.match(accountCss, /Personal — real input-bound profile preview, not an illustration or image/);
  assert.deepEqual([...app.document.querySelectorAll('[data-signup-step-button]')].map(button => button.querySelector('i').textContent + button.querySelector('span').textContent), ['1Personal', '2Education', '3Security']);
  for (const id of ['ah-signup-name', 'ah-dob-day', 'ah-dob-month', 'ah-dob-year']) {
    assert.equal(personal.contains(app.document.getElementById(id)), true, id);
  }
  assert.equal(personal.contains(app.document.querySelector('#ah-signup-email')), false);
  assert.equal(app.document.querySelector('#ah-signup-email').closest('[data-signup-panel]')?.dataset.signupPanel, 'security');
  assert.equal(personal.querySelectorAll('select').length, 3);
  assert.equal(personal.querySelectorAll('[data-role="guide-open"],.ah-guide,.ah-guide-orb').length, 0);
});

test('guided Signup validates steps, caps institution matches, preserves canonical credentials, and blocks duplicate delivery', async t => {
  const app = setup();
  t.after(() => app.dom.window.close());
  await openSignup(app);
  const year = app.document.querySelector('#ah-dob-year');
  const month = app.document.querySelector('#ah-dob-month');
  year.value = '2008';
  year.dispatchEvent(new app.window.Event('change', { bubbles: true }));
  month.value = '2';
  month.dispatchEvent(new app.window.Event('change', { bubbles: true }));
  assert.equal(app.document.querySelector('#ah-dob-day').options.length, 30);
  app.document.querySelector('[data-role="signup-next-education"]').click();
  assert.equal(app.document.querySelector('[data-signup-panel="personal"]').hidden, false);
  await completeGuidedFields(app);
  assert.equal(app.document.querySelectorAll('#ah-school-results [role="option"]').length <= 4, true);
  const password = app.document.querySelector('#ah-signup-password');
  const confirm = app.document.querySelector('#ah-signup-confirm');
  password.value = confirm.value = 'lowercase1';
  submitSignup(app);
  assert.equal(app.calls.filter(call => call.path.includes('/signup')).length, 0);
  assert.match(app.document.querySelector('[data-role="message"]').textContent, /বড় English অক্ষর/);
  password.value = confirm.value = 'UppercaseOnly';
  submitSignup(app);
  assert.equal(app.calls.filter(call => call.path.includes('/signup')).length, 0);
  assert.match(app.document.querySelector('[data-role="message"]').textContent, /একটি সংখ্যা/);
  password.value = confirm.value = 'StrongPassword!9';
  password.dispatchEvent(new app.window.Event('input', { bubbles: true }));
  confirm.dispatchEvent(new app.window.Event('input', { bubbles: true }));
  assert.match(app.document.querySelector('[data-role="password-strength"]').textContent, /খুব শক্তিশালী/);
  assert.match(app.document.querySelector('[data-role="password-match"]').textContent, /মিলেছে/);
  assert.equal(app.document.querySelectorAll('[data-password-rule].met').length, 3);
  submitSignup(app);
  submitSignup(app);
  await waitFor(() => app.document.querySelector('[data-view="created"]').hidden === false);
  assert.equal(app.calls.some(call => call.path.includes('/account-verification/email/start')), false);
  assert.equal(app.calls.some(call => call.path.includes('/telegram/verification/start')), false);
  app.document.querySelector('[data-role="created-continue"]').click();
  await waitFor(() => app.document.querySelector('[data-view="verify"]').hidden === false && app.document.querySelector('[data-role="verification-selection"]').hidden === false);
  const signupCalls = app.calls.filter(call => call.path.includes('/signup'));
  assert.equal(signupCalls.length, 1);
  const { turnstileToken: signupToken, ...signupBody } = signupCalls[0].body;
  assert.deepEqual(signupBody, { email: 'student@example.com', password: 'StrongPassword!9' });
  // F-03: the signup call also carries the Turnstile token field.
  assert.equal(typeof signupToken, 'string');
  await waitFor(() => app.calls.some(call => call.path.includes('/profile/pending')));
  const profileCall = app.calls.find(call => call.path.includes('/profile/pending'));
  assert.equal(profileCall.body.fullName, 'Test Student');
  assert.equal(profileCall.body.school.name.length > 0, true);
  assert.equal(JSON.stringify(profileCall.body).includes('StrongPassword!9'), false);
  assert.equal(app.calls.some(call => call.path.includes('/account-verification/email/start')), false);
  assert.equal(app.calls.some(call => call.path.includes('/telegram/verification/start')), false);
  assert.equal(app.document.querySelector('#ah-signup-password').value, '');
  assert.equal(app.document.querySelector('#ah-signup-confirm').value, '');
  app.dom.window.close();
});

test('verification waits for an in-flight profile handoff without duplicating either request', async t => {
  const app = setup({ profileDelay: 140 });
  t.after(() => app.dom.window.close());
  await openSignup(app);
  await completeGuidedFields(app);
  app.document.querySelector('[data-view="signup"]').dispatchEvent(new app.window.Event('submit', { bubbles: true, cancelable: true }));
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(app.document.querySelector('[data-view="created"]').hidden, true);
  assert.equal(app.document.querySelector('[data-view="verify"]').hidden, true);
  assert.equal(app.calls.filter(call => call.path.includes('/email/start')).length, 0);
  await waitFor(() => app.document.querySelector('[data-view="created"]')?.hidden === false);
  app.document.querySelector('[data-role="created-continue"]').click();
  app.document.querySelector('[data-role="email-verification-start"]').click();
  assert.equal(app.document.querySelector('[data-view="email-intro"]').hidden, false);
  assert.equal(app.calls.some(call => call.path.includes('/email/start')), false);
  app.document.querySelector('[data-role="email-intro-continue"]').click();
  await waitFor(() => app.calls.some(call => call.path.includes('/email/start')));
  assert.equal(app.calls.filter(call => call.path.includes('/profile/pending')).length, 1);
  assert.ok(app.calls.findIndex(call => call.path.includes('/profile/pending')) < app.calls.findIndex(call => call.path.includes('/email/start')));
  app.dom.window.close();
});

test('refresh restores pending selection or Email-check state without sending a duplicate message', async t => {
  const selectedEmail = setup({ cookie: 'ah_signup_pending_v1=email', emailStatuses: [false] });
  t.after(() => selectedEmail.dom.window.close());
  await waitFor(() => selectedEmail.document.querySelector('[data-view="verify"]')?.hidden === false);
  assert.equal(selectedEmail.document.querySelector('[data-role="verification-email-panel"]').hidden, false);
  assert.equal(selectedEmail.calls.filter(call => call.path.includes('/email/status')).length, 1);
  assert.equal(selectedEmail.calls.some(call => call.path.includes('/email/start')), false);
  assert.equal(selectedEmail.document.querySelector('[data-view="success"]').hidden, true);
  selectedEmail.dom.window.close();

  const unselected = setup({ cookie: 'ah_signup_pending_v1=select', emailStatuses: [false] });
  t.after(() => unselected.dom.window.close());
  await waitFor(() => unselected.document.querySelector('[data-view="verify"]')?.hidden === false);
  assert.equal(unselected.document.querySelector('[data-role="verification-selection"]').hidden, false);
  assert.equal(unselected.calls.some(call => call.path.includes('/email/start')), false);
  assert.equal(unselected.calls.some(call => call.path.includes('/telegram/verification/start')), false);
  unselected.dom.window.close();
});

test('verification setup failure shows no fake sent or success state', async t => {
  const app = setup({ signupError: 'VERIFICATION_UNAVAILABLE' });
  t.after(() => app.dom.window.close());
  await openSignup(app);
  await completeGuidedFields(app, 'outage@example.com');
  submitSignup(app);
  await waitFor(() => app.document.querySelector('[data-view="login"]').hidden === false);
  assert.match(app.document.querySelector('[data-role="message"]').textContent, /কোনো verification message পাঠানো হয়নি/);
  assert.equal(app.calls.some(call => call.path.includes('/account-verification/email/start')), false);
  assert.equal(app.document.querySelector('[data-view="success"]').hidden, true);
  app.dom.window.close();
});

test('Email path reaches Ready only after authoritative status and renders real profile readiness', async t => {
  const app = setup({ emailStatuses: [false, true] });
  t.after(() => app.dom.window.close());
  await openSignup(app);
  await completeGuidedFields(app, 'status@example.com');
  submitSignup(app);
  await waitFor(() => app.document.querySelector('[data-view="created"]').hidden === false);
  app.document.querySelector('[data-role="created-continue"]').click();
  await waitFor(() => app.document.querySelector('[data-view="verify"]').hidden === false && app.document.querySelector('[data-role="verification-selection"]').hidden === false);
  await waitFor(() => app.document.querySelector('[data-role="email-verification-start"]').disabled === false);
  app.document.querySelector('[data-role="email-verification-start"]').click();
  assert.equal(app.document.querySelector('[data-view="email-intro"]').hidden, false);
  assert.equal(app.calls.some(call => call.path.includes('/email/start')), false);
  app.document.querySelector('[data-role="email-intro-continue"]').click();
  await waitFor(() => app.document.querySelector('[data-role="verification-email-panel"]').hidden === false);
  app.document.querySelector('[data-role="verified-login"]').click();
  await waitFor(() => app.calls.filter(call => call.path.includes('/email/status')).length === 1);
  await waitFor(() => app.document.querySelector('[data-role="verified-login"]').disabled === false);
  assert.equal(app.document.querySelector('[data-view="success"]').hidden, true);
  app.document.querySelector('[data-role="verified-login"]').click();
  await waitFor(() => app.document.querySelector('[data-view="verified"]').hidden === false);
  assert.match(app.document.querySelector('[data-role="verified-title"]').textContent, /Email Verified/);
  assert.equal(app.document.querySelector('[data-view="success"]').hidden, true);
  app.document.querySelector('[data-role="verified-continue"]').click();
  await waitFor(() => app.document.querySelector('[data-view="success"]').hidden === false);
  assert.match(app.document.querySelector('[data-role="ready-profile"]').textContent, /Profile Created/);
  assert.equal(app.window.AdmissionAccount.isVerified(), true);
  app.dom.window.close();
});

test('Password-reset return opens Login with truthful guidance and removes the callback marker', async t => {
  const app = setup({ url: 'https://admissionhub.pages.dev/?passwordReset=1' });
  t.after(() => app.dom.window.close());
  await waitFor(() => app.document.querySelector('[data-view="login"]')?.hidden === false);
  assert.equal(app.window.location.search, '');
  assert.match(app.document.querySelector('[data-role="message"]').textContent, /শেষ করে থাকলে/);
  assert.equal(app.document.querySelector('[data-view="success"]').hidden, true);
  app.dom.window.close();
});

test('Forgot Password stays enumeration-safe while Signup has no Assistant component or AI request', async t => {
  const app = setup();
  t.after(() => app.dom.window.close());
  await waitFor(() => app.document.querySelector('[data-view="welcome"]')?.hidden === false);
  app.document.querySelector('[data-role="welcome-login"]').click();
  app.document.querySelector('[data-role="show-forgot"]').click();
  app.document.querySelector('#ah-forgot-email').value = 'possibly.missing@example.com';
  app.document.querySelector('[data-view="forgot"]').dispatchEvent(new app.window.Event('submit', { bubbles: true, cancelable: true }));
  await waitFor(() => app.document.querySelector('[data-role="message"]').textContent.includes('অ্যাকাউন্ট থাকলে'));
  assert.match(app.document.querySelector('[data-role="message"]').textContent, /অ্যাকাউন্ট থাকলে/);
  assert.doesNotMatch(app.document.querySelector('[data-role="message"]').textContent, /exists|পাওয়া গেছে|নেই/i);
  assert.equal(app.document.querySelector('[data-role="guide"]'), null);
  assert.equal(app.document.querySelector('[data-role="guide-open"]'), null);
  assert.equal(app.document.querySelector('#ah-guide-input'), null);
  assert.equal(app.calls.some(call => call.path.includes('/api/ai/chat')), false);
  app.dom.window.close();
});

test('Welcome language control updates the page locale without changing its four actions', async t => {
  const app = setup();
  t.after(() => app.dom.window.close());
  await waitFor(() => app.document.querySelector('[data-view="welcome"]')?.hidden === false);
  const picker = app.document.querySelector('[data-role="welcome-language"]');
  picker.value = 'en';
  picker.dispatchEvent(new app.window.Event('change', { bubbles: true }));
  assert.equal(app.document.documentElement.lang, 'en');
  picker.value = 'bn';
  picker.dispatchEvent(new app.window.Event('change', { bubbles: true }));
  assert.equal(app.document.documentElement.lang, 'bn');
  assert.equal(app.document.querySelectorAll('.ah-entry-actions button').length, 4);
  assert.equal(app.calls.some(call => call.path.includes('/api/ai/chat')), false);
  app.dom.window.close();
});

test('Signup Assistant is absent and the core Signup journey remains independent from AI', async t => {
  const app = setup();
  t.after(() => app.dom.window.close());
  await waitFor(() => app.document.querySelector('[data-view="welcome"]')?.hidden === false);
  assert.equal(app.document.querySelector('[data-role="guide"]'), null);
  assert.equal(app.document.querySelector('[data-role="guide-open"]'), null);
  app.document.querySelector('[data-role="welcome-signup"]').click();
  assert.equal(app.document.querySelector('[data-view="signup"]').hidden, false);
  assert.equal(app.document.querySelector('[data-role="signup-next-education"]').disabled, false);
  assert.equal(app.calls.some(call => call.path.includes('/api/ai/chat')), false);
  app.dom.window.close();
});

test('every verification view is a direct child of the account body, so none can nest inside a hidden sibling', async t => {
  const app = setup();
  t.after(() => app.dom.window.close());
  await waitFor(() => app.document.querySelector('[data-view="welcome"]')?.hidden === false);
  const body = app.document.querySelector('.ah-account-body');
  const views = [...app.document.querySelectorAll('[data-view]')];
  assert.ok(views.length >= 15, `expected the full view set, got ${views.length}`);
  // Regression: `whatsapp-info` once opened while `email-ownership` was still
  // unclosed, so the whole Email OTP form became a child of a hidden view and
  // rendered as a 0x0 blank page. A view nested in another view is always that bug.
  for (const view of views) {
    assert.equal(view.parentElement, body, `[data-view="${view.dataset.view}"] must be a direct child of .ah-account-body`);
  }
  assert.equal(app.document.querySelectorAll('[data-view] [data-view]').length, 0, 'a view must never be nested inside another view');
});
