import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { chromium, devices } from 'playwright-core';

const ROOT = process.cwd();
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav'
};
const requests = [];
let emailStatusChecks = 0;
let authenticated = false;

const sendJson = (response, status, value, headers = {}) => {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  response.end(JSON.stringify(value));
};
const bodyOf = request => new Promise(resolveBody => {
  let raw = '';
  request.setEncoding('utf8');
  request.on('data', chunk => { raw += chunk; });
  request.on('end', () => {
    try { resolveBody(raw ? JSON.parse(raw) : null); } catch { resolveBody(null); }
  });
});

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1');
  const body = ['POST', 'PUT', 'PATCH'].includes(request.method) ? await bodyOf(request) : null;
  if (url.pathname.startsWith('/api/')) requests.push({ path: url.pathname, method: request.method, body, headers: request.headers });
  if (url.pathname === '/api/auth/v1/config') return sendJson(response, 200, {
    auth: {
      available: true, uiContract: 'auth-premium-v6', onboarding: { version: 'premium-onboarding-v1', profileVersion: 1 },
      methods: {
        emailPassword: { available: true }, passwordReset: { available: true }, profile: { available: true },
        google: { available: false }, passkey: { available: false, enrollmentAvailable: true },
        telegramVerification: { available: true }, backup: { available: false }
      },
      verificationEmail: { resendCooldownSeconds: 0 }
    }
  });
  if (url.pathname === '/api/auth/v1/session') return authenticated
    ? sendJson(response, 200, { authenticated: true, emailVerified: true, user: { emailMasked: 's***@example.com' } })
    : sendJson(response, 401, { error: { code: 'SESSION_INVALID' } });
  if (url.pathname === '/api/auth/v1/telegram/verification/pending') return sendJson(response, 404, { error: { code: 'TELEGRAM_VERIFICATION_INVALID' } });
  if (url.pathname === '/api/auth/v1/signup') return sendJson(response, 202, {
    verification: { selectionRequired: true, sent: false, emailMasked: 's***@example.com', resendAfter: 0 }
  });
  if (url.pathname === '/api/auth/v1/profile/pending') return sendJson(response, 200, { saved: true, profile: { version: 1 } });
  if (url.pathname === '/api/auth/v1/account-verification/email/start') return sendJson(response, 202, {
    verification: { sent: true, emailMasked: 's***@example.com', resendAfter: 0 }
  });
  if (url.pathname === '/api/auth/v1/account-verification/email/status') {
    emailStatusChecks += 1;
    if (emailStatusChecks < 2) return sendJson(response, 200, { authenticated: false, emailVerified: false });
    authenticated = true;
    return sendJson(response, 200, { authenticated: true, emailVerified: true, user: { emailMasked: 's***@example.com' } });
  }
  if (url.pathname === '/api/auth/v1/password-reset') return sendJson(response, 202, { accepted: true, deliveryDisclosed: false });
  if (url.pathname === '/api/auth/v1/passkey/registration/begin') return sendJson(response, 200, {
    challengeId: 'browser-passkey-challenge-123456789',
    options: {
      challenge: 'AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE',
      rp: { name: 'Admission Hub', id: 'localhost' },
      user: { id: 'AgICAgICAgICAgICAgICAg', name: 'student@example.com', displayName: 'Browser Student' },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      timeout: 60000,
      attestation: 'none',
      authenticatorSelection: { authenticatorAttachment: 'platform', residentKey: 'required', userVerification: 'required' },
      excludeCredentials: []
    }
  });
  if (url.pathname === '/api/auth/v1/passkey/registration/finish') return sendJson(response, 200, { registered: true, credentialCount: 1 });
  if (url.pathname === '/api/auth/v1/passkey/status') return sendJson(response, 200, { count: 1, credentials: [{ id: 'virtual-browser-passkey', createdAt: Date.now(), synced: false }] });
  if (url.pathname === '/api/auth/v1/profile') return sendJson(response, 200, { profile: { version: 1 } });
  if (url.pathname === '/api/content/meta') return sendJson(response, 200, { v: 1, sig: 'browser-audit' });
  if (url.pathname === '/api/content') return sendJson(response, 200, { v: 1, subjects: [], topics: [], questions: [], vocabulary: [], vocabularyMaster: [], exams: [] });
  if (url.pathname === '/api/ai/status') return sendJson(response, 200, { ok: true, streaming: true });
  if (url.pathname.startsWith('/api/')) return sendJson(response, 404, { error: { code: 'NOT_FOUND' } });

  let pathname = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
  if (pathname.includes('\0') || pathname.split('/').includes('..')) { response.writeHead(400); return response.end(); }
  const filename = resolve(ROOT, `.${pathname}`);
  if (!filename.startsWith(ROOT + sep)) { response.writeHead(403); return response.end(); }
  try {
    const info = await stat(filename);
    if (!info.isFile()) throw new Error('not-file');
    const data = await readFile(filename);
    response.writeHead(200, {
      'Content-Type': MIME[extname(filename).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': url.pathname === '/sw.js' ? 'no-cache' : 'no-store',
      'Service-Worker-Allowed': '/'
    });
    response.end(data);
  } catch {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Not found');
  }
});

const listen = () => new Promise((resolveListen, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => resolveListen(server.address().port));
});
const one = (list, predicate, label) => {
  const selected = list.filter(predicate);
  assert.equal(selected.length, 1, label);
  return selected[0];
};

let browser;
try {
  const port = await listen();
  const origin = `http://localhost:${port}`;
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });

  const context = await browser.newContext({
    ...devices['iPhone 13'],
    viewport: { width: 390, height: 844 },
    screen: { width: 390, height: 844 },
    locale: 'bn-BD',
    reducedMotion: 'no-preference'
  });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true
    }
  });
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(String(error.message || error)));
  await page.goto(origin, { waitUntil: 'domcontentloaded' });
  const welcome = page.locator('[data-view="welcome"]');
  await welcome.waitFor({ state: 'visible' });
  await page.waitForFunction(() => document.activeElement?.matches('[data-role="welcome-signup"]'));

  const entryButtons = page.locator('.ah-entry-actions button');
  assert.equal(await entryButtons.count(), 4);
  assert.deepEqual((await entryButtons.allTextContents()).map(value => value.trim().replace(/^G(?=Continue)/, '').replace(/→$/, '').trim()), [
    'Sign Up', 'Log In', 'Continue with Google', 'Continue as Guest'
  ]);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true, 'iPhone page has horizontal overflow');
  // v248 owner rule: the Welcome page may scroll (a normal web page), but nothing
  // may be hidden and nothing may be scaled/shrunk to fake a fit.
  assert.equal(await page.evaluate(() => [...document.querySelectorAll('.ah-welcome-benefits article')]
    .filter(n => getComputedStyle(n).display !== 'none' && getComputedStyle(n).visibility !== 'hidden'
      && n.getBoundingClientRect().height > 8).length), 4, 'all four benefit cards must stay visible on a phone');
  assert.equal(await page.evaluate(() => [...document.querySelectorAll('.ah-welcome-view, .ah-welcome-view *')]
    .filter(n => n.classList.contains('ah-welcome-fit') || n.classList.contains('ah-welcome-fit-inner')
      || n.classList.contains('is-scaled') || (n.style && n.style.getPropertyValue('--ah-fit'))).length), 0,
    'Welcome content must not be scaled or wrapped in a fit/shrink layer');
  assert.equal(await page.evaluate(() => [document.querySelector('.ah-journey-console'), document.querySelector('.ah-welcome-copy h1'), document.querySelector('.ah-welcome-landscape')]
    .every(n => Boolean(n) && getComputedStyle(n).display !== 'none' && getComputedStyle(n).visibility !== 'hidden')), true,
    'console, heading and Welcome art must all render on a phone');
  assert.deepEqual(await page.locator('.ah-entry-actions button').evaluateAll(b => b.map(n => Math.round(n.getBoundingClientRect().height) >= 44)), [true, true, true, true], 'every entry path keeps a natural 44px+ touch target');
  // v249: the page may scroll, and the last option must be reachable even when a
  // floating browser address bar covers the bottom of the screen.
  assert.equal(await page.evaluate(async () => {
    const guest = document.querySelector('.ah-entry-guest');
    if (!guest) return false;
    const coveredByBrowserBar = 80;
    window.scrollTo(0, document.documentElement.scrollHeight);
    await new Promise(resolve => setTimeout(resolve, 150));
    const rect = guest.getBoundingClientRect();
    return rect.bottom <= innerHeight - coveredByBrowserBar
      || document.documentElement.scrollHeight <= innerHeight + 1;
  }), true, 'the last Welcome option must be scrollable clear of a floating browser bar');
  const mobileWelcomeGeometry = await page.locator('.ah-account-shell').evaluate(node => {
    const box = node.getBoundingClientRect();
    return { width: box.width, height: box.height, viewportWidth: innerWidth, viewportHeight: innerHeight };
  });
  assert.ok(
    mobileWelcomeGeometry.width >= mobileWelcomeGeometry.viewportWidth - 1
      && mobileWelcomeGeometry.height >= mobileWelcomeGeometry.viewportHeight - 1,
    JSON.stringify(mobileWelcomeGeometry)
  );
  const welcomeTargets = await entryButtons.evaluateAll(buttons => buttons.map(button => {
    const rect = button.getBoundingClientRect();
    return { text: button.textContent.trim(), width: rect.width, height: rect.height };
  }));
  assert.equal(welcomeTargets.every(target => target.width >= 44 && target.height >= 44), true, JSON.stringify(welcomeTargets));
  assert.equal(await page.locator('.ah-account-shell').getAttribute('role'), null);
  assert.equal(await page.locator('.ah-account-shell').getAttribute('aria-modal'), null);
  assert.ok(await page.locator('.ah-account-shell').getAttribute('aria-labelledby'));
  const welcomeCloseState = await page.locator('[data-role="close"]').evaluate(node => ({ hidden: node.hidden, display: getComputedStyle(node).display, currentView: node.closest('.ah-account-shell')?.dataset.currentView }));
  assert.deepEqual(welcomeCloseState, { hidden: true, display: 'none', currentView: 'welcome' }, `Welcome exposed a fifth dismiss path: ${JSON.stringify(welcomeCloseState)}`);
  const semanticIssues = await page.evaluate(() => {
    const root = document.querySelector('.ah-account-page');
    const controls = [...root.querySelectorAll('input:not([type="hidden"]),select,textarea')]
      .filter(control => !control.labels?.length && !control.getAttribute('aria-label') && !control.getAttribute('aria-labelledby'))
      .map(control => control.id || control.outerHTML.slice(0, 80));
    const unnamedActions = [...root.querySelectorAll('button,a[href]')]
      .filter(action => !action.textContent.trim() && !action.getAttribute('aria-label') && !action.getAttribute('aria-labelledby') && !action.getAttribute('title'))
      .map(action => action.outerHTML.slice(0, 80));
    return { controls, unnamedActions };
  });
  assert.deepEqual(semanticIssues, { controls: [], unnamedActions: [] });
  await page.keyboard.press('Escape');
  await welcome.waitFor({ state: 'visible' });
  assert.deepEqual(await page.evaluate(() => ({ appInert: document.querySelector('#app').inert, bodyClass: document.body.classList.contains('ah-account-page-active'), pagePosition: getComputedStyle(document.querySelector('.ah-account-page')).position })), { appInert: true, bodyClass: true, pagePosition: 'relative' });
  assert.equal(await page.locator('.ah-guide,.ah-guide-orb,[data-role="guide-open"]').count(), 0, 'Signup Assistant component still exists');
  assert.equal(await page.locator('.ah-welcome-benefits article').count(), 4);
  assert.equal(await page.locator('[data-native-welcome-visual="journey-console-v1"]').count(), 1);
  assert.equal(await welcome.getAttribute('data-media-contract'), 'zero-raster-entry-v1');
  assert.equal(await welcome.locator('img,picture,source,canvas,video,object,embed').count(), 0, 'Welcome must contain zero media elements');
  const welcomeCodeVisual = await page.locator('[data-native-welcome-visual="journey-console-v1"]').evaluate(consoleNode => ({
    core: Boolean(consoleNode.querySelector('.ah-console-core')),
    route: Boolean(consoleNode.querySelector('.ah-route-track')),
    modules: consoleNode.querySelectorAll('.ah-console-modules article').length,
    rasterBackgrounds: [consoleNode, ...consoleNode.querySelectorAll('*')].filter(node => /url\s*\(/i.test(getComputedStyle(node).backgroundImage)).length
  }));
  assert.deepEqual(welcomeCodeVisual, { core: true, route: true, modules: 3, rasterBackgrounds: 0 });
  const consoleInteraction = await page.locator('[data-native-welcome-visual="journey-console-v1"]').evaluate(node => {
    const rect = node.getBoundingClientRect();
    node.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerType: 'mouse', clientX: rect.right - 5, clientY: rect.top + 5 }));
    const moved = { x: node.style.getPropertyValue('--ah-console-rx'), y: node.style.getPropertyValue('--ah-console-ry') };
    node.dispatchEvent(new PointerEvent('pointerleave', { pointerType: 'mouse' }));
    return { moved, reset: { x: node.style.getPropertyValue('--ah-console-rx'), y: node.style.getPropertyValue('--ah-console-ry') } };
  });
  assert.ok(consoleInteraction.moved.x && consoleInteraction.moved.y, JSON.stringify(consoleInteraction));
  assert.deepEqual(consoleInteraction.reset, { x: '', y: '' });
  await page.locator('[data-role="welcome-language"]').selectOption('en');
  assert.match(await page.locator('#ah-welcome-heading').textContent(), /On the path to your goal/);
  await page.locator('[data-role="welcome-language"]').selectOption('bn');

  assert.equal(await page.locator('.ah-account-shell').getAttribute('data-visual-contract'), 'code-native-page-system-v1');
  await page.getByRole('button', { name: 'Sign Up', exact: true }).click();
  await page.locator('[data-signup-panel="personal"]').waitFor({ state: 'visible' });
  const signup = page.locator('[data-view="signup"]');
  assert.equal(await signup.getAttribute('data-personal-visual-contract'), 'interactive-native-personal-v1');
  assert.equal(await signup.getAttribute('data-media-contract'), 'zero-raster-entry-v1');
  assert.equal(await page.locator('.ah-personal-dob-card').getAttribute('data-dob-contract'), 'premium-dropdown-dob-v2');
  assert.equal(await page.locator('[data-signup-panel="dob"]').count(), 0, 'DOB must stay on visible Personal, not a separate screen');
  assert.equal(await page.locator('[data-profile-preview-contract="input-bound-profile-v1"]').count(), 0, 'Live profile card must be gone');
  assert.equal(await page.locator('.ah-live-profile').count(), 0, 'Live profile card must be gone');
  assert.equal(await page.locator('.ah-dob-select').count(), 3, 'Three premium dropdowns for day/month/year');
  assert.equal(await page.locator('.ah-dob-wheel').count(), 0, '3D wheels removed in favour of dropdowns');
  assert.match((await page.locator('#ah-personal-title').textContent()), /Set up your profile/);
  assert.equal(await page.locator('[data-signup-panel="personal"] img,[data-signup-panel="personal"] picture,[data-signup-panel="personal"] source,[data-signup-panel="personal"] canvas,[data-signup-panel="personal"] video,[data-signup-panel="personal"] object,[data-signup-panel="personal"] embed').count(), 0, 'Personal must contain zero media elements');
  assert.deepEqual(await page.locator('[data-signup-step-button]').evaluateAll(buttons => buttons.map(button => `${button.querySelector('i').textContent}${button.querySelector('span').textContent}`)), ['1Personal', '2Education', '3Security']);
  await page.waitForTimeout(250);
  const personalGeometry = await page.evaluate(() => {
    const box = selector => {
      const rect = document.querySelector(selector).getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, bottom: rect.bottom };
    };
    return {
      viewport: { width: innerWidth, height: innerHeight },
      page: { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight },
      card: box('.ah-personal-card'),
      cta: box('.ah-personal-next'),
      name: box('#ah-signup-name'),
      selects: [...document.querySelectorAll('.ah-dob-select')].map(el => { const rect = el.getBoundingClientRect(); return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, bottom: rect.bottom }; })
    };
  });
  assert.deepEqual(personalGeometry.viewport, { width: 390, height: 844 });
  assert.equal(personalGeometry.page.width <= 391, true, JSON.stringify(personalGeometry));
  assert.equal(personalGeometry.page.height >= 844, true, JSON.stringify(personalGeometry));
  assert.equal(personalGeometry.card.x >= 10 && personalGeometry.card.x <= 18 && personalGeometry.card.width >= 354, true, JSON.stringify(personalGeometry.card));
  assert.equal(personalGeometry.cta.x >= 10 && personalGeometry.cta.x <= 18 && personalGeometry.cta.width >= 354 && personalGeometry.cta.height >= 52, true, JSON.stringify(personalGeometry.cta));
  assert.equal(personalGeometry.name.height >= 52, true);
  assert.equal(personalGeometry.selects.every(sel => sel.width >= 90 && sel.height >= 44), true, JSON.stringify(personalGeometry.selects));
  assert.equal(await page.locator('#ah-signup-name').evaluate(input => input.labels.length), 1);
  assert.equal(await page.locator('#ah-signup-name').evaluate(input => parseFloat(getComputedStyle(input).fontSize) >= 16), true);
  assert.equal(await page.locator('#ah-signup-email').isHidden(), true, 'Email belongs to Security, not Personal');
  assert.deepEqual(await page.evaluate(() => ['app', 'navRoot', 'toast', 'modalRoot'].map(id => getComputedStyle(document.getElementById(id)).display)), ['none', 'none', 'none', 'none']);
  await page.locator('[data-role="signup-next-education"]').click();
  assert.equal(await page.locator('[data-signup-panel="personal"]').isVisible(), true);
  assert.match(await page.locator('[data-role="name-feedback"]').textContent(), /at least 2 characters/);
  await page.locator('#ah-signup-name').fill('Browser Student');
  // Premium dropdown DOB, deterministic native selects, no scroll guessing.
  await page.locator('#ah-dob-day').selectOption('2');
  await page.waitForTimeout(150);
  assert.equal(await page.evaluate(() => document.querySelector('#ah-dob-day').value), '2', 'day dropdown selects 2');
  await page.locator('#ah-dob-day').selectOption('1');
  await page.waitForTimeout(150);
  assert.equal(await page.evaluate(() => document.querySelector('#ah-dob-day').value), '1', 'day dropdown selects 1');
  await page.locator('#ah-dob-month').selectOption('5');
  await page.locator('#ah-dob-year').selectOption('2007');
  await page.waitForTimeout(250);
  assert.equal(await page.evaluate(() => document.querySelector('#ah-dob-day').value), '1', 'day preserved after month/year change');
  await page.locator('#ah-dob-day').selectOption('12');
  await page.waitForTimeout(200);
  await page.locator('[data-role="signup-next-education"]').click();
  const educationState = await page.evaluate(() => ({
    visible: !document.querySelector('[data-signup-panel="school"]').hidden,
    message: document.querySelector('[data-role="message"]')?.textContent,
    values: {
      name: document.querySelector('#ah-signup-name')?.value,
      email: document.querySelector('#ah-signup-email')?.value,
      day: document.querySelector('#ah-dob-day')?.value,
      month: document.querySelector('#ah-dob-month')?.value,
      year: document.querySelector('#ah-dob-year')?.value
    }
  }));
  assert.equal(educationState.visible, true, JSON.stringify(educationState));
  await page.locator('[data-role="close"]').click();
  await page.locator('[data-signup-panel="personal"]').waitFor({ state: 'visible' });
  assert.deepEqual(await page.evaluate(() => [
    document.querySelector('#ah-signup-name').value,
    document.querySelector('#ah-dob-day').value,
    document.querySelector('#ah-dob-month').value,
    document.querySelector('#ah-dob-year').value
  ]), ['Browser Student', '12', '5', '2007']);
  await page.locator('[data-role="signup-next-education"]').click();
  await page.locator('[data-signup-panel="school"]').waitFor({ state: 'visible' });
  const school = page.locator('#ah-signup-school');
  await school.fill('Cox');
  await page.locator('#ah-school-results [role="option"]').first().waitFor({ state: 'visible' });
  const suggestionCount = await page.locator('#ah-school-results [role="option"]').count();
  assert.ok(suggestionCount >= 2 && suggestionCount <= 4, `suggestions=${suggestionCount}`);
  await school.press('ArrowDown');
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('role')), 'option');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('#ah-signup-school')?.getAttribute('aria-expanded') === 'false');
  await page.locator('[data-role="signup-next-college"]').click();
  await page.locator('[data-signup-panel="college"]').waitFor({ state: 'visible' });
  await page.locator('[data-role="signup-next-security"]').click();
  await page.locator('[data-signup-panel="security"]').waitFor({ state: 'visible' });
  await page.locator('#ah-signup-email').fill('student@example.com');
  assert.equal(await page.locator('#ah-signup-email').evaluate(input => input.labels.length), 1);
  assert.equal(await page.locator('#ah-signup-email').evaluate(input => parseFloat(getComputedStyle(input).fontSize) >= 16), true);
  await page.locator('#ah-signup-password').fill('StrongPassword!9');
  await page.locator('#ah-signup-confirm').fill('StrongPassword!9');
  await page.locator('[data-role="password-strength"]').filter({ hasText: 'খুব শক্তিশালী' }).waitFor();
  await page.locator('[data-role="password-match"]').filter({ hasText: 'মিলেছে' }).waitFor();
  assert.equal(await page.locator('[data-password-rule].met').count(), 3);
  assert.equal(await page.locator('#ah-signup-password').getAttribute('type'), 'password');
  await page.locator('[data-password-target="ah-signup-password"]').click();
  assert.equal(await page.locator('#ah-signup-password').getAttribute('type'), 'text');
  await page.locator('[data-view="signup"] button[type="submit"]').click();
  await page.locator('[data-view="created"]').waitFor({ state: 'visible' });
  assert.equal(requests.filter(item => item.path === '/api/auth/v1/account-verification/email/start').length, 0);
  assert.equal(requests.filter(item => item.path === '/api/auth/v1/telegram/verification/start').length, 0);
  await page.locator('[data-role="created-continue"]').click();
  await page.locator('[data-view="verify"]').waitFor({ state: 'visible' });
  assert.equal(await page.locator('.ah-method-card').count(), 4);
  assert.equal(await page.getByText('Email OTP নয়', { exact: false }).isVisible(), true);
  assert.equal(await page.getByText('এখন verification পাওয়া যাচ্ছে না', { exact: false }).isVisible(), true);
  assert.equal(await page.locator('[data-otp-digit]').count(), 6);
  assert.equal(requests.filter(item => item.path === '/api/auth/v1/account-verification/email/start').length, 0);
  assert.equal(requests.filter(item => item.path === '/api/auth/v1/telegram/verification/start').length, 0);
  const signupRequest = one(requests, item => item.path === '/api/auth/v1/signup', 'one signup request');
  assert.deepEqual(signupRequest.body, { email: 'student@example.com', password: 'StrongPassword!9' });
  const profileRequest = one(requests, item => item.path === '/api/auth/v1/profile/pending', 'one pending profile request');
  assert.equal(profileRequest.body.fullName, 'Browser Student');
  assert.equal(JSON.stringify(profileRequest.body).includes('StrongPassword!9'), false);
  assert.equal(signupRequest.headers['x-ah-auth-ui'], 'auth-premium-v6');
  assert.equal(await page.locator('#ah-signup-password').inputValue(), '');
  assert.equal(await page.locator('#ah-signup-confirm').inputValue(), '');

  await page.locator('[data-role="email-verification-start"]').click();
  await page.locator('[data-view="email-intro"]').waitFor({ state: 'visible' });
  assert.equal(requests.filter(item => item.path === '/api/auth/v1/account-verification/email/start').length, 0);
  await page.locator('[data-role="email-intro-continue"]').click();
  await page.locator('[data-role="verification-email-panel"]').waitFor({ state: 'visible' });
  await page.locator('[data-role="verified-login"]').click();
  await page.getByText('Verification এখনো শেষ হয়নি', { exact: false }).waitFor();
  assert.equal(await page.locator('[data-view="success"]').isVisible(), false);
  await page.locator('[data-role="verified-login"]').click();
  await page.locator('[data-view="verified"]').waitFor({ state: 'visible' });
  assert.match(await page.locator('[data-role="verified-title"]').textContent(), /Email Verified/);
  assert.equal(await page.locator('[data-view="success"]').isVisible(), false);
  await page.locator('[data-role="verified-continue"]').click();
  await page.locator('[data-view="security-setup"]').waitFor({ state: 'visible' });
  assert.equal(await page.locator('[data-view="success"]').isVisible(), false);
  await page.locator('[data-role="setup-passkey"]').click();
  await page.waitForTimeout(500);
  const passkeyViewState = await page.evaluate(() => ({
    visible: [...document.querySelectorAll('[data-view]')].find(view => !view.hidden)?.dataset.view,
    message: document.querySelector('[data-role="message"]')?.textContent || ''
  }));
  assert.equal(passkeyViewState.visible, 'success', `${JSON.stringify(passkeyViewState)} requests=${JSON.stringify(requests.filter(item => item.path.includes('/passkey/')).map(item => item.path))}`);
  await page.locator('[data-role="ready-profile"]').filter({ hasText: 'Profile Created' }).waitFor();
  const passkeyFinish = one(requests, item => item.path === '/api/auth/v1/passkey/registration/finish', 'one native Passkey finish');
  assert.equal(passkeyFinish.body.challengeId, 'browser-passkey-challenge-123456789');
  assert.ok(passkeyFinish.body.response.rawId.length >= 16);
  assert.ok(passkeyFinish.body.response.clientDataJSON.length >= 16);
  assert.ok(passkeyFinish.body.response.attestationObject.length >= 16);
  assert.equal(emailStatusChecks, 2);
  const browserStorage = await page.evaluate(() => ({
    local: Object.entries(localStorage),
    session: Object.entries(sessionStorage)
  }));
  const serializedStorage = JSON.stringify(browserStorage);
  assert.equal(browserStorage.local.some(([key]) => /ah_entry_v1|ah_signup_pending_v1|auth|session|token|password/i.test(key)), false);
  assert.equal(browserStorage.session.some(([key]) => /ah_entry_v1|ah_signup_pending_v1|auth|token|password/i.test(key)), false);
  assert.equal(/StrongPassword!9|student@example\.com/.test(serializedStorage), false);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true, 'verified iPhone view overflow');

  await page.locator('[data-role="enter-app"]').click();
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(100);
  assert.equal(await page.locator('.ah-account-page').isVisible(), false, 'returning account entry repeated Welcome');
  await page.evaluate(() => window.AdmissionAccount.open());
  await page.locator('[data-view="signed"]').waitFor({ state: 'visible' });

  const duplicateIds = await page.evaluate(() => {
    const ids = [...document.querySelectorAll('[id]')].map(node => node.id);
    return [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
  });
  assert.deepEqual(duplicateIds, []);
  assert.deepEqual(pageErrors, []);
  await cdp.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId });
  await context.close();

  const completedEmailStatusChecks = emailStatusChecks;
  authenticated = false;
  emailStatusChecks = 0;
  const guestContext = await browser.newContext({ ...devices['iPhone 13'], locale: 'bn-BD' });
  const guestPage = await guestContext.newPage();
  await guestPage.goto(origin, { waitUntil: 'domcontentloaded' });
  await guestPage.locator('[data-view="welcome"]').waitFor({ state: 'visible' });
  await guestPage.getByRole('button', { name: 'Continue as Guest', exact: true }).click();
  assert.equal(await guestPage.locator('.ah-account-page').isVisible(), false);
  assert.equal(new URL(guestPage.url()).hash, '#dashboard');
  await guestPage.locator('.dv2-root').waitFor({ state: 'visible' });
  assert.equal(await guestPage.locator('[data-dashboard-contract="reference-guest-v2"],[data-guest-nav],.dv2-guest-root').count(), 0);
  assert.deepEqual(await guestPage.locator('[data-nav-tab]').evaluateAll(nodes => nodes.map(node => node.dataset.navTab)), ['dashboard', 'question-bank', 'exam', 'ai', 'history']);
  assert.equal(await guestPage.locator('[data-nav-tab="ai"]').count(), 1);
  assert.equal(await guestPage.evaluate(() => [...document.scripts].some(script => script.src.includes('ai-agent-chat.js'))), true);
  assert.equal(await guestPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true, 'ordinary Guest dashboard overflow');
  await guestPage.locator('[data-nav-tab="ai"]').click();
  await guestPage.locator('.ai-agent-root').waitFor({ state: 'visible' });
  assert.equal(await guestPage.locator('.ah-guide,.ah-guide-orb,[data-role="guide-open"]').count(), 0);
  assert.equal(await guestPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true, 'main-app AI overflow');
  await guestPage.locator('#aiHomeBtn').click();
  await guestPage.locator('.dv2-root').waitFor({ state: 'visible' });
  await guestPage.locator('[data-nav-tab="history"]').click();
  await guestPage.waitForFunction(() => location.hash.startsWith('#history'));
  assert.equal(await guestPage.locator('body').evaluate(node => node.classList.contains('ah-guest-dashboard')), false);
  await guestPage.locator('[data-nav-tab="dashboard"]').click();
  await guestPage.locator('.dv2-root').waitFor({ state: 'visible' });
  await guestPage.reload({ waitUntil: 'domcontentloaded' });
  await guestPage.waitForTimeout(100);
  assert.equal(await guestPage.locator('.ah-account-page').isVisible(), false, 'returning Guest entry repeated Welcome');
  await guestPage.evaluate(() => window.AdmissionAccount.open());
  await guestPage.locator('[data-view="login"]').waitFor({ state: 'visible' });
  await guestPage.locator('[data-role="close"]').click();

  await guestPage.evaluate(async () => { await navigator.serviceWorker.ready; });
  await guestContext.setOffline(true);
  await guestPage.reload({ waitUntil: 'domcontentloaded' });
  await guestPage.waitForTimeout(200);
  assert.equal(await guestPage.locator('body').isVisible(), true);
  assert.equal(await guestPage.locator('.ah-account-page').isVisible(), false, 'offline returning Guest was blocked');
  await guestContext.setOffline(false);
  await guestContext.close();

  const compactContext = await browser.newContext({ viewport: { width: 320, height: 568 }, screen: { width: 320, height: 568 }, isMobile: true, hasTouch: true, locale: 'bn-BD', reducedMotion: 'reduce' });
  const compactPage = await compactContext.newPage();
  await compactPage.goto(origin, { waitUntil: 'domcontentloaded' });
  await compactPage.getByRole('button', { name: 'Sign Up', exact: true }).click();
  await compactPage.locator('[data-signup-panel="personal"]').waitFor({ state: 'visible' });
  assert.equal(await compactPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, 'compact Personal overflow');
  assert.equal(await compactPage.locator('.ah-personal-next').evaluate(node => {
    node.scrollIntoView({ block: 'center' });
    const rect = node.getBoundingClientRect();
    return rect.width >= 260 && rect.height >= 48;
  }), true, 'compact Personal CTA is not reachable');
  await compactContext.close();

  const desktopContext = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'bn-BD', reducedMotion: 'reduce' });
  const desktopPage = await desktopContext.newPage();
  await desktopPage.goto(origin, { waitUntil: 'domcontentloaded' });
  await desktopPage.locator('[data-view="welcome"]').waitFor({ state: 'visible' });
  await desktopPage.locator('.ah-account-page').dispatchEvent('click');
  await desktopPage.locator('[data-view="welcome"]').waitFor({ state: 'visible' });
  const desktopBox = await desktopPage.locator('.ah-account-shell').boundingBox();
  const desktopWelcomeStyle = await desktopPage.locator('.ah-account-shell').evaluate(node => ({
    borderRadius: getComputedStyle(node).borderRadius,
    boxShadow: getComputedStyle(node).boxShadow
  }));
  assert.ok(desktopBox.width >= 1439 && desktopBox.width <= 1441 && desktopBox.height >= 900, JSON.stringify(desktopBox));
  assert.equal(desktopWelcomeStyle.borderRadius, '0px');
  assert.equal(desktopWelcomeStyle.boxShadow, 'none');
  assert.equal(await desktopPage.locator('.ah-account-page').evaluate(node => getComputedStyle(node).position), 'relative');
  assert.equal(await desktopPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true);
  assert.equal(await desktopPage.locator('[data-view="welcome"] img,[data-view="welcome"] picture,[data-view="welcome"] canvas,[data-view="welcome"] video').count(), 0);
  assert.equal(await desktopPage.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 1), true, 'Desktop Welcome must fit one screen without scrolling');
  const desktopConsole = await desktopPage.locator('.ah-journey-console').boundingBox();
  assert.ok(desktopConsole.width >= 500 && desktopConsole.width <= 580, JSON.stringify(desktopConsole));
  await desktopPage.getByRole('button', { name: 'Sign Up', exact: true }).click();
  await desktopPage.locator('[data-signup-panel="personal"]').waitFor({ state: 'visible' });
  const desktopPersonalBox = await desktopPage.locator('.ah-account-shell').boundingBox();
  const desktopPersonalPanel = await desktopPage.locator('.ah-personal-panel').boundingBox();
  assert.ok(desktopPersonalBox.width >= 1439 && desktopPersonalBox.width <= 1441 && desktopPersonalBox.height >= 900, JSON.stringify(desktopPersonalBox));
  assert.ok(desktopPersonalPanel.width >= 979 && desktopPersonalPanel.width <= 981 && desktopPersonalPanel.x >= 229 && desktopPersonalPanel.x <= 231, JSON.stringify(desktopPersonalPanel));
  assert.equal(await desktopPage.locator('[data-signup-panel="personal"] img,[data-signup-panel="personal"] picture,[data-signup-panel="personal"] canvas,[data-signup-panel="personal"] video').count(), 0);
  assert.equal(await desktopPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true);
  const motion = await desktopPage.locator('.ah-account-shell').evaluate(element => ({
    animationDuration: getComputedStyle(element).animationDuration,
    transitionDuration: getComputedStyle(element).transitionDuration
  }));
  assert.ok(['0s', '0.001s', '0.01ms'].includes(motion.animationDuration) || parseFloat(motion.animationDuration) <= 0.01, JSON.stringify(motion));
  await desktopContext.close();

  console.log(JSON.stringify({
    ok: true,
    browser: await browser.version(),
    mobile: 'iPhone 13 / 390x844',
    desktop: '1440x900',
    signupRequests: requests.filter(item => item.path === '/api/auth/v1/signup').length,
    profileRequests: requests.filter(item => item.path === '/api/auth/v1/profile/pending').length,
    emailStatusChecks: completedEmailStatusChecks,
    nativePasskeyVirtualDevice: true,
    referenceVisualContracts: ['code-native-welcome-v1', 'interactive-native-personal-v1'],
    zeroRasterEntryPages: true,
    modularWelcomeConsole: true,
    interactivePersonalPreview: true,
    personalNameAndDobCombined: true,
    personalFluidWidth: true,
    firstEntryFullScreenNotPopup: true,
    desktopResponsiveComposition: true,
    customGuestDashboardRemoved: true,
    signupAssistantRemoved: true,
    mainAppAiRestored: true,
    unsupportedMethodsFailClosed: true,
    offlineReturningGuest: true,
    accessibility: { documentPage: true, noDialogSemantics: true, appInertWhileActive: true, labeledFields: true, touchTargets: true, noDuplicateIds: true },
    pageErrors: 0
  }, null, 2));
} finally {
  if (browser) await browser.close();
  await new Promise(resolveClose => server.close(() => resolveClose()));
}
