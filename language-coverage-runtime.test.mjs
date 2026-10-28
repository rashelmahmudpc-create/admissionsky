/* T7b regression — the owner's actual complaint.

   Choosing English left the account and profile flows in Bengali. A table
   check alone does not catch this: the string can be in the table yet still
   render, or render through a path the table scan never reads. So this test
   boots the real modules with the real engine in English mode and fails if any
   Bengali is visible on screen.

   Both sw.js BUILD_ID markers and the shell are exercised by the other suites;
   this one owns "what the user sees in English". */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const read = (name) => readFileSync(new URL(`./${name}`, import.meta.url), 'utf8');
const ENGINE = read('language-engine.js');
const UI = read('profile-ui.js');
const AUTH = read('account-access.js');
const INSTITUTIONS = read('institutions-bd.js');
const DASHBOARD = read('dashboard-v2.js');

/* The global AhI18n engine is an inline <script> in index.html. Lift the exact
   block rather than re-implementing it: the welcome picker calls `AhI18n.set`,
   so a stand-in would let a broken contract pass. */
const I18N = (() => {
  const html = read('index.html');
  /* Anchor on the two phrases, not on the punctuation between them: the
     shipped-copy typography pass (29a1ac7) rewrites interstitial em dashes,
     which used to break this lookup even though the engine was intact. */
  const start = html.search(/\/\*\s*ADMISSION HUB[^\n]*Global i18n Engine/);
  const marker = html.indexOf('window.AhI18n', start);
  const end = html.indexOf('})();', marker);
  assert.ok(start >= 0 && marker > start && end > marker, 'AhI18n engine block not found in index.html');
  return html.slice(start, end + 5);
})();

const BENGALI = /[\u0980-\u09FF]/;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));


const untranslated = (window) => {
  const found = new Map();
  for (const el of window.document.querySelectorAll('*')) {
    if (el.children.length) continue;
    if (['SCRIPT', 'STYLE', 'CODE', 'PRE', 'TEXTAREA'].includes(el.tagName)) continue;
    const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
    if (text && BENGALI.test(text)) found.set(text, true);
    for (const attr of ['placeholder', 'aria-label', 'title']) {
      const value = el.getAttribute(attr);
      if (value && BENGALI.test(value)) found.set(value, true);
    }
  }
  return [...found.keys()];
};

function bootProfile() {
  const dom = new JSDOM('<!doctype html><html lang="bn"><body><div id="app"></div></body></html>', {
    url: 'https://admissionhub.pages.dev/#my-profile',
    runScripts: 'dangerously',
    pretendToBeVisual: true
  });
  const { window } = dom;
  window.localStorage.setItem('ahLang', 'en');
  window.NotificationHub = { openCenter() {} };
  window.AdmissionAccount = { isVerified: () => true, getSessionState: () => 'AUTHENTICATED', open() {} };
  window.AhAppearance = { set() {} };
  window.AH_AcademicCatalog = {
    listSessions: () => [{ id: '2025-26' }],
    getUniversity: () => null,
    unitsFor: () => [{ id: 'A' }],
    subjectsFor: () => ['Physics', 'Math'],
    searchUniversities: () => []
  };
  window.CACHE = { examResults: [], mistakes: [] };
  window.localStorage.setItem('ah-public-profile-id', 'AH-TEST-0001');
  window.fetch = async () => ({
    ok: true, status: 200, headers: { get: () => null },
    json: async () => ({
      publicId: 'AH-TEST-0001', completion: 62, joinedYear: '2026',
      profile: {
        fullName: 'Rashel Test', dob: '2007-04-11', mobile: '01712345678',
        bio: 'test bio', visibility: 'private', admissionSession: '2025-26',
        targets: [{ name: 'University of Dhaka', unit: 'A' }],
        subjects: ['Physics', 'Math']
      },
      context: { greeting: 'আবার দেখা হলো' }
    })
  });
  window.eval(ENGINE);
  window.eval(UI);
  window.renderProfilePage();
  return window;
}

function bootAuth({ language = 'en' } = {}) {
  const dom = new JSDOM('<!doctype html><html lang="bn"><body><main id="app"></main></body></html>', {
    url: 'https://admissionhub.pages.dev/',
    runScripts: 'dangerously',
    pretendToBeVisual: true
  });
  const { window } = dom;
  window.localStorage.setItem('ahLang', language);
  // A real visitor has usually opened the profile sheet, which writes the
  // preference below. Seed it so the boot reconcile is exercised: once saved,
  // the preference outranks `ahLang` and would quietly restore Bengali.
  window.localStorage.setItem('ah-profile-prefs-v1', JSON.stringify({
    language, notifications: 'on', appearance: 'light', aiAssistant: 'on', avatarStyle: 0, avatarGender: 'boy', v: 1
  }));
  window.open = () => ({ closed: false });
  window.PublicKeyCredential = undefined;
  window.fetch = async (url) => {
    const path = String(url);
    const reply = (status, body) => ({
      ok: status >= 200 && status < 300, status, headers: { get: () => null }, json: async () => body
    });
    if (path.includes('/config')) return reply(200, {
      auth: { available: true, uiContract: 'auth-premium-v6', methods: {
        google: { available: true, clientId: 'test-client' },
        passkey: { available: false, enrollmentAvailable: false },
        telegramVerification: { available: true },
        backup: { available: false } } }
    });
    if (path.includes('/session') && !path.includes('/session/')) return reply(401, { error: { code: 'SESSION_INVALID' } });
    if (path.endsWith('/profile')) return reply(200, { profile: null });
    return reply(404, { error: { code: 'NOT_FOUND' } });
  };
  window.eval(I18N);
  window.eval(ENGINE);
  window.eval(INSTITUTIONS);
  window.eval(AUTH);
  return window;
}

test('the profile flow shows no Bengali once English is chosen', async () => {
  const window = bootProfile();
  await sleep(300);
  assert.deepEqual(untranslated(window), [], 'these strings stayed Bengali in the profile flow');
});

test('the every sheet in the profile flow is translated too', async () => {
  const window = bootProfile();
  await sleep(250);
  const roles = ['open-prefs-sheet', 'open-privacy-page', 'open-edit-page', 'open-avatar-page', 'open-academic'];
  const missed = new Map();
  for (const role of roles) {
    const el = window.document.querySelector(`[data-role="${role}"]`);
    if (!el) continue;
    el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await sleep(120);
    for (const text of untranslated(window)) missed.set(`${role}: ${text}`, true);
    // Return to the profile page so the next trigger is reachable.
    const back = window.document.querySelector('[data-role="prefs-back"], [data-role="privacy-back"], [data-role="back-profile"]');
    if (back) back.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await sleep(80);
  }
  assert.deepEqual([...missed.keys()], [], 'these strings stayed Bengali inside profile sheets');
});

test('the account shell shows no Bengali once English is chosen', async () => {
  const window = bootAuth();
  await sleep(400);
  const missed = untranslated(window);
  assert.deepEqual(missed, [], 'these strings stayed Bengali in the account flow');
});

/* The welcome picker is the first language control a visitor meets and the one
   the owner used. Its handler only rewrote the copy inside its own page: it
   never wrote `ahLang` and never told either engine, so the next view rendered
   Bengali again. Every other test seeds English before boot, which is exactly
   why the hole survived. Boot in Bengali and drive the real <select>. */
test('the welcome picker stores the language and translates the first screen', async () => {
  const window = bootAuth({ language: 'bn' });
  await sleep(400);

  const picker = window.document.querySelector('[data-role="welcome-language"]');
  assert.ok(picker, 'no [data-role="welcome-language"] control found');
  assert.equal(picker.value, 'bn', 'the picker should open on the stored language');

  picker.value = 'en';
  picker.dispatchEvent(new window.Event('change', { bubbles: true }));
  await sleep(300);

  assert.equal(window.localStorage.getItem('ahLang'), 'en',
    'the welcome picker did not store the choice, so a reload loses it');
  const prefs = JSON.parse(window.localStorage.getItem('ah-profile-prefs-v1') || '{}');
  assert.equal(prefs.language, 'en',
    'the synced preference still disagrees and boot reconcile would restore Bengali');

  assert.deepEqual(untranslated(window), [], 'these strings stayed Bengali after choosing English');
});

/* The flip side of the same bug: opening the page must not overwrite a choice
   the user already made. */
test('merely opening the account shell does not overwrite the stored language', async () => {
  const window = bootAuth({ language: 'en' });
  await sleep(400);
  assert.equal(window.localStorage.getItem('ahLang'), 'en', 'boot reset a stored English choice back to Bengali');
  const picker = window.document.querySelector('[data-role="welcome-language"]');
  if (picker) assert.equal(picker.value, 'en', 'the picker did not reflect the stored language');
});


/* Dashboard v2 builds its markup from live counters, so several sentences are a
   fixed frame around a number. Those can never match a dictionary key and were
   slipping through as Bengali in English mode. Both data states are booted:
   the empty-state branch and the populated one render different copy. */
function bootDashboard(cache, language = 'en') {
  const dom = new JSDOM('<!doctype html><html lang="bn"><body><main id="app"></main></body></html>', {
    url: 'https://admissionhub.pages.dev/#dashboard',
    runScripts: 'dangerously',
    pretendToBeVisual: true
  });
  const { window } = dom;
  window.localStorage.setItem('ahLang', language);
  window.open = () => ({ closed: false });
  window.CACHE = cache;
  window.toast = () => {};
  window.navigate = () => {};
  window.topicName = (t) => t;
  window.openModal = () => {};
  window.closeModal = () => {};
  window.Router = { path: 'dashboard' };
  window.eval(I18N);
  window.eval(ENGINE);
  window.eval(DASHBOARD);
  window.renderDashboard();
  return window;
}

const EMPTY_CACHE = { dailyStats: [], examResults: [], exams: [], subjects: [], settings: {}, activityLogs: [] };

const populatedCache = () => {
  const ago = (o) => Date.now() - o * 86400000;
  return {
    dailyStats: [
      { date: ago(0), questions: 42, correct: 30, wrong: 12, time: 90000 },
      { date: ago(1), questions: 88, correct: 70, wrong: 18 },
      { date: ago(5), questions: 60, correct: 45, wrong: 15 }
    ],
    examResults: [
      { id: 'e1', status: 'done', topics: ['সন্ধি'], total: 20, correct: 8, wrong: 12, date: ago(1) }
    ],
    exams: [{ id: 'run', status: 'running' }],
    subjects: [{ id: 's1', name: 'বাংলা', icon: '📘' }],
    settings: {
      dailyTarget: 100,
      dailyGoal: { university: 'RU', unit: 'A', examDate: new Date(ago(-91)).toISOString().slice(0, 10) }
    },
    activityLogs: [], planDays: [], plans: []
  };
};

test('the dashboard shows no Bengali in English mode (empty account)', async () => {
  const window = bootDashboard(EMPTY_CACHE);
  await sleep(120);
  assert.deepEqual(untranslated(window), [], 'these strings stayed Bengali on an empty dashboard');
});

test('the dashboard shows no Bengali in English mode (active account)', async () => {
  const window = bootDashboard(populatedCache());
  await sleep(120);
  assert.deepEqual(untranslated(window), [], 'these strings stayed Bengali on a populated dashboard');
});

test('switching the dashboard back to Bengali restores the original wording', async () => {
  const window = bootDashboard(populatedCache(), 'bn');
  await sleep(120);
  const app = window.document.getElementById('app');
  const bengali = app.textContent.replace(/\s+/g, ' ').trim();

  window.localStorage.setItem('ahLang', 'en');
  window.AhLanguage.apply(app);
  assert.equal(BENGALI.test(app.textContent), false, 'Bengali survived the switch to English');

  window.localStorage.setItem('ahLang', 'bn');
  window.AhLanguage.apply(app);
  assert.equal(app.textContent.replace(/\s+/g, ' ').trim(), bengali,
    'the original Bengali wording was not restored byte-for-byte');
});
