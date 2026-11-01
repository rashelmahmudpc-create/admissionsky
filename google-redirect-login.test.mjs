import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

// Owner 2026-10-17: "Continue with Google" is a full-page redirect straight to
// accounts.google.com on admissionsky.pages.dev. No popup, no direct GSI, no
// Firebase page in between; in-app browsers are sent to Chrome instead.
const script = readFileSync(new URL('./account-access.js', import.meta.url), 'utf8');
const reply = (status, body) => ({ ok: status >= 200 && status < 300, status, headers: { get: () => null }, async json() { return body; } });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(predicate, timeout = 1500) {
  const until = Date.now() + timeout;
  while (Date.now() < until) { if (predicate()) return; await sleep(5); }
  throw new Error('Timed out waiting for UI state.');
}
const SKY = 'https://admissionsky.pages.dev/';
const ANDROID_FB = 'Mozilla/5.0 (Linux; Android 13; SM-A135F Build/TP1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/129.0 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/480.0.0.0;]';
const IOS_MESSENGER = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/MessengerForiOS;FBAV/470.0;FBBV/1;FBDV/iPhone14,5;FBMD/iPhone;FBSN/iOS;FBSV/17.6;FBSS/3;FBCR/;FBID/phone;FBLC/en_US;FBOP/5]';

function setup({ url = SKY, ua = '', redirectFlag = false, redirectResult = null, redirectError = null, googleReply = null, cookie = '' } = {}) {
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { url, runScripts: 'dangerously', pretendToBeVisual: true });
  const w = dom.window;
  if (cookie) w.document.cookie = cookie;
  if (ua) Object.defineProperty(w.navigator, 'userAgent', { value: ua, configurable: true });
  if (redirectFlag) w.sessionStorage.setItem('ah-google-redirect', '1');
  const record = { apps: [], popup: 0, redirect: 0, providers: [], calls: [] };
  w.firebase = {
    apps: [],
    initializeApp(options, name) { const app = { name, options }; this.apps.push(app); record.apps.push(app); return app; },
    auth(app) {
      return {
        app,
        async signInWithPopup() { record.popup += 1; throw new Error('popup must not be used'); },
        async signInWithRedirect(provider) { record.redirect += 1; record.providers.push({ app: app?.name, provider }); },
        async getRedirectResult() {
          if (redirectError) throw redirectError;
          return app?.name === 'ah-google-sky' ? redirectResult : null;
        }
      };
    }
  };
  w.firebase.auth.GoogleAuthProvider = function GoogleAuthProvider() {
    this.scopes = [];
    this.addScope = scope => { this.scopes.push(scope); return this; };
    this.setCustomParameters = params => { this.params = params; return this; };
  };
  w.fetch = async (input, options = {}) => {
    const path = String(input);
    const body = options.body ? JSON.parse(options.body) : null;
    record.calls.push({ path, method: options.method || 'GET', body });
    if (path.includes('/config')) return reply(200, { auth: { available: true, methods: {
      google: { available: true, clientId: '123456789012-exampleclientidentifier.apps.googleusercontent.com' },
      passkey: { available: false }, telegramVerification: { available: false }, backup: { available: false }, emailPassword: { available: true }
    }, verificationEmail: { resendCooldownSeconds: 60 } } });
    if (path.includes('/session') && !path.includes('/session/') && (options.method || 'GET') === 'GET') return reply(401, { error: { code: 'SESSION_INVALID', message: 'সেশন নেই।' } });
    const signedBody = { authenticated: true, created: false, emailVerified: true, user: { id: 'usr-g', emailMasked: 'u***@example.com' } };
    if (path.endsWith('/google')) return googleReply ? googleReply() : reply(200, signedBody);
    if (path.endsWith('/google/link')) return reply(200, signedBody);
    if (path.endsWith('/passkey/status')) return reply(200, { count: 0, credentials: [] });
    return reply(404, { error: { message: 'not found' } });
  };
  w.eval(script);
  const button = () => w.document.querySelector('[data-role="google-button"] button') || w.document.querySelector('[data-role="welcome-google-button"] button');
  const messageText = () => w.document.querySelector('[data-role="message"]')?.textContent || '';
  return { dom, w, document: w.document, record, button, messageText };
}

const TOKEN = `google-access-${'z'.repeat(32)}`;

test('Google uses its own Firebase app on admissionsky.pages.dev and a full-page redirect, never a popup', async () => {
  const app = setup();
  await waitFor(() => app.button());
  app.button().click();
  await waitFor(() => app.record.redirect === 1);
  const sky = app.record.apps.find(item => item.name === 'ah-google-sky');
  assert.ok(sky, 'Google must use the ah-google-sky app');
  assert.equal(sky.options.authDomain, 'admissionsky.pages.dev');
  assert.equal(sky.options.projectId, 'admissionsky-997d2');
  assert.equal(app.record.providers[0].app, 'ah-google-sky');
  assert.deepEqual(app.record.providers[0].provider.scopes, ['email', 'profile']);
  assert.equal(app.record.popup, 0);
  assert.equal(app.record.apps.some(item => item.name === 'ah-google'), false, 'Google must not touch the Facebook app');
  assert.equal(app.w.sessionStorage.getItem('ah-google-redirect'), '1');
  assert.equal(app.document.querySelector('script[src*="accounts.google.com/gsi"]'), null, 'no GSI script');
  app.dom.window.close();
});

test('source: no popup or GSI path for Google; Facebook keeps the firebaseapp.com authDomain', () => {
  assert.doesNotMatch(script, /DIRECT_GOOGLE|initTokenClient|requestAccessToken|accounts\.google\.com\/gsi/);
  assert.match(script, /const GOOGLE_AUTH_DOMAIN = 'admissionsky-997d2\.firebaseapp\.com';/);
  assert.match(script, /firebaseAuthFor\('ah-google', GOOGLE_AUTH_DOMAIN\)/);
  assert.match(script, /firebaseAuthFor\(GOOGLE_SKY_APP, GOOGLE_SKY_HOST\)/);
  assert.match(script, /const GOOGLE_SKY_HOST = 'admissionsky\.pages\.dev';/);
  const google = script.slice(script.indexOf('const startGoogleRedirect'), script.indexOf('const finishOAuthRedirect'));
  assert.doesNotMatch(google, /signInWithPopup/);
  assert.match(google, /beginOAuthRedirect\(auth, provider, true\)/);
});

test('any other host hands Google off to admissionsky.pages.dev with the start flag', async () => {
  const app = setup({ url: 'https://admissionhub.pages.dev/' });
  await waitFor(() => app.button());
  app.button().click();
  await sleep(150);
  assert.equal(app.record.redirect, 0, 'no Firebase redirect from the old host');
  assert.equal(app.record.apps.some(item => item.name === 'ah-google-sky'), false);
  assert.match(script, /const GOOGLE_SKY_URL = `https:\/\/\$\{GOOGLE_SKY_HOST\}\/\?ahGoogle=1`;/);
  assert.match(script, /location\.assign\(GOOGLE_SKY_URL\)/);
  app.dom.window.close();
});

test('?ahGoogle=1 on admissionsky.pages.dev starts the Google redirect and cleans the URL', async () => {
  const app = setup({ url: `${SKY}?ahGoogle=1` });
  await waitFor(() => app.record.redirect === 1, 2500);
  assert.equal(new URL(app.w.location.href).searchParams.get('ahGoogle'), null);
  assert.equal(new URL(app.w.location.href).searchParams.get('ahAuthReturn'), 'g', 'return marker rides on the redirect URL');
  assert.equal(app.record.providers[0].app, 'ah-google-sky');
  app.dom.window.close();
});

test('Android in-app browser never starts Google and offers "Chrome-এ খুলুন" plus copy link', async () => {
  const app = setup({ ua: ANDROID_FB });
  await waitFor(() => app.button());
  app.button().click();
  await waitFor(() => app.document.getElementById('ah-google-inapp'));
  assert.equal(app.record.redirect, 0);
  assert.equal(app.record.popup, 0);
  const chrome = app.document.querySelector('[data-role="google-open-chrome"]');
  assert.ok(chrome);
  assert.equal(chrome.getAttribute('href'), 'intent://admissionsky.pages.dev/?ahGoogle=1#Intent;scheme=https;package=com.android.chrome;end');
  assert.match(chrome.textContent, /Chrome-এ খুলুন/);
  assert.ok(app.document.querySelector('[data-role="google-copy-link"]'));
  await waitFor(() => /\[in-app-browser\]/.test(app.messageText()));
  app.document.querySelector('[data-role="google-inapp-close"]').click();
  assert.equal(app.document.getElementById('ah-google-inapp').style.display, 'none');
  app.dom.window.close();
});

test('iPhone Messenger gets the copy-link help, no Android intent, and the bridge reports the code', async () => {
  const app = setup({ ua: IOS_MESSENGER });
  await waitFor(() => app.w.AdmissionSkyBridge);
  const outcome = await app.w.AdmissionSkyBridge.google().then(() => 'resolved', error => error.userMessage || error.message);
  assert.match(outcome, /\[in-app-browser\]/);
  assert.ok(app.document.querySelector('[data-role="google-copy-link"]'));
  assert.equal(app.document.querySelector('[data-role="google-open-chrome"]'), null);
  assert.equal(app.record.redirect, 0);
  await waitFor(() => app.button());
  await sleep(100);
  app.dom.window.close();
});

test('coming back from Google signs in through POST /google and clears the flag', async () => {
  const app = setup({ redirectFlag: true, redirectResult: { user: { uid: 'g' }, credential: { providerId: 'google.com', accessToken: TOKEN } } });
  await waitFor(() => app.record.calls.some(call => call.path.endsWith('/google')), 2500);
  const call = app.record.calls.find(item => item.path.endsWith('/google'));
  assert.deepEqual(call.body, { accessToken: TOKEN });
  await waitFor(() => app.w.AdmissionAccount.isVerified() === true);
  assert.equal(app.w.sessionStorage.getItem('ah-google-redirect'), null);
  assert.equal(app.w.localStorage.length, 0);
  await sleep(100);
  app.dom.window.close();
});

test('ACCOUNT_LINK_REQUIRED after the redirect opens google-link and reuses the same token', async () => {
  const app = setup({
    redirectFlag: true,
    redirectResult: { user: { uid: 'g' }, credential: { providerId: 'google.com', accessToken: TOKEN } },
    googleReply: () => reply(409, { error: { code: 'ACCOUNT_LINK_REQUIRED', message: 'link' } })
  });
  await waitFor(() => app.document.querySelector('[data-view="google-link"]')?.hidden === false, 2500);
  assert.match(app.messageText(), /\[ACCOUNT_LINK_REQUIRED\]/);
  app.document.querySelector('#ah-link-email').value = 'student@example.com';
  app.document.querySelector('#ah-link-password').value = 'password-123';
  app.document.querySelector('[data-view="google-link"]').dispatchEvent(new app.w.Event('submit', { cancelable: true }));
  await waitFor(() => app.record.calls.some(call => call.path.endsWith('/google/link')));
  const link = app.record.calls.find(item => item.path.endsWith('/google/link'));
  /* AUTH V2.0: this route now runs the shared guard, so the body carries the
   * human-check token and the bot signals alongside the credentials. The
   * credentials themselves are unchanged, which is what this test is about. */
  assert.equal(link.body.email, 'student@example.com');
  assert.equal(link.body.password, 'password-123');
  assert.equal(link.body.accessToken, TOKEN);
  assert.ok('turnstileToken' in link.body, 'the guarded route needs a human-check token');
  assert.ok('ah_contact_website' in link.body, 'and the honeypot field the guard reads');
  assert.equal(app.record.redirect, 0, 'linking must not need a second trip to Google');
  await waitFor(() => app.w.AdmissionAccount.isVerified() === true);
  await sleep(100);
  app.dom.window.close();
});

test('a failed redirect shows the real error code', async () => {
  const app = setup({ redirectFlag: true, redirectError: Object.assign(new Error('net'), { code: 'auth/network-request-failed' }) });
  await waitFor(() => /\[auth\/network-request-failed\]/.test(app.messageText()), 2500);
  await sleep(100);
  app.dom.window.close();
});

test('a Google redirect sign-in lands on the Dashboard even from the signup flow, and a late Sky open is ignored', async () => {
  const app = setup({
    cookie: 'ah_signup_pending_v1=select; Path=/',
    redirectFlag: true,
    redirectResult: { user: { uid: 'g' }, credential: { providerId: 'google.com', accessToken: TOKEN } }
  });
  await waitFor(() => app.w.AdmissionAccount.isVerified() === true, 2500);
  await waitFor(() => !app.document.body.classList.contains('ah-account-page-active'), 2500);
  assert.doesNotMatch(app.document.cookie, /ah_signup_pending_v1=select/, 'the pending signup journey must end');
  // sky-onboarding.js loads late on a cold page; its reveal() must not cover the Dashboard.
  app.w.AdmissionSkyBridge.reveal();
  assert.equal(app.document.body.classList.contains('ah-account-page-active'), false);
  const mount = app.document.getElementById('ah-sky-flow');
  assert.ok(!mount || mount.hidden === true);
  await sleep(100);
  app.dom.window.close();
});
