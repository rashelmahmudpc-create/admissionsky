/* Compact notification sheet (owner bug-fix 2026-09-16) — source contract.
 * 1) Dashboard bell must open the sheet, never navigate to history.
 * 2) The sheet is compact: FCM + master + close; official concise FCM copy
 *    in BOTH languages (bn + en) for the dual-language rule. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const HUB = readFileSync('notification-hub.js', 'utf8');
const DASH = readFileSync('dashboard-v2.js', 'utf8');

test('dashboard bell: bellTap (inbox/one-time sheet), never history', () => {
  assert.match(DASH, /dv2-bell[^>]*onclick="NotificationHub\.bellTap\(\)"/, 'bell → bellTap (round 2)');
  assert.ok(!/dv2-bell[^>]*navigate\('history'\)/.test(DASH), 'bell must not navigate to history');
});

test('dashboard card gear opens the real settings modal (owner fix 2026-09-24)', () => {
  /* The gear used to open openSheet() — a near-empty panel — so it read as a
   * dead button. It must open the full settings modal that holds FCM, the
   * daily reminder, categories and quiet hours. */
  assert.match(HUB, /onclick="NotificationHub\.openSettings\(\)">\$\{icon\('gear'/);
  const dashboardBlock = HUB.slice(HUB.indexOf('const dashboardHtml ='), HUB.indexOf('const globalUnreadCount'));
  assert.ok(!dashboardBlock.includes('openSheet()'), 'the dashboard gear must not open the empty sheet');
});

test('sheet exists with close affordances', () => {
  assert.match(HUB, /const openSheet = async/);
  assert.match(HUB, /onclick="closeModal\(\)" aria-label="\$\{sheetT\('closeAria'\)\}">\$\{icon\('close'/, 'header close button (SVG)');
  assert.match(HUB, /class="btn" style="width:100%[^"]*" onclick="closeModal\(\)"/, 'bottom close button');
  assert.ok(HUB.includes('toggleMasterSheet'), 'master toggle re-renders the sheet');
});

test('official concise FCM copy exists in BOTH languages', () => {
  assert.ok(HUB.includes('bn: \'আপনার ফোনে নোটিফিকেশন চালু করুন\''), 'bn official copy');
  assert.ok(HUB.includes("en: 'Turn on notifications on your phone'"), 'en official copy');
  assert.ok(HUB.includes("bn: 'নোটিফিকেশন'") && HUB.includes("en: 'Notifications'"), 'title dual language');
  assert.ok(HUB.includes("bn: 'বন্ধ করুন'") && HUB.includes("en: 'Close'"), 'close dual language');
});

test('dual language rendered via AhI18n (never both at once)', () => {
  assert.match(HUB, /AhI18n\.get\(\)/, 'sheet picks the active language');
  assert.match(HUB, /AhI18n\.apply\(document\.getElementById\('modalRoot'\)\)/, 'applies engine to the rendered sheet');
});

/* Owner bug (2026-09-17): "চালু হয়েছে কিন্তু নোটিফিকেশন দাঁও..." — every push
 * path reported success yet nothing appeared. The toast that carries BOTH the
 * self-test result and the foreground push message rendered *behind* the sheet
 * that triggered it (#modalRoot z-index 2000 vs .toast z-index 100), so the
 * feedback existed but was invisible. The toast must always outrank the modal
 * layer, and .toast is the app's only foreground-push display surface. */
test('toast outranks the modal layer so feedback is never hidden', () => {
  const H = readFileSync('index.html', 'utf8');
  const toast = H.match(/\.toast\{[^}]*z-index:\s*(\d+)/);
  const modal = H.match(/\.modal-bg\{[^}]*z-index:\s*(\d+)/);
  const modalRoot = H.match(/#modalRoot\{[^}]*z-index:\s*(\d+)/);
  assert.ok(toast, '.toast carries an explicit z-index');
  assert.ok(modal, '.modal-bg carries an explicit z-index');
  assert.ok(modalRoot, '#modalRoot carries an explicit z-index');
  const toastZ = Number(toast[1]);
  assert.ok(toastZ > Number(modal[1]), `toast z-index ${toastZ} must exceed .modal-bg ${modal[1]}`);
  assert.ok(toastZ > Number(modalRoot[1]), `toast z-index ${toastZ} must exceed #modalRoot ${modal[1]}`);
  // The sheet opens through openModal()/closeModal() → #modalRoot.
  assert.match(HUB, /openModal\(/, 'the sheet renders inside #modalRoot');
});

test('foreground push is surfaced through window.toast', () => {
  const CLIENT = readFileSync('notification-fcm.js', 'utf8');
  assert.match(CLIENT, /messaging\.onMessage\(/, 'foreground handler attached');
  assert.match(CLIENT, /window\.toast\?\.\(/, 'foreground payload reaches the toast');
});

test('sheet options are minimal (categories/quiet-hours/cap not in the sheet)', () => {
  const sheet = HUB.slice(HUB.indexOf('const openSheet'), HUB.indexOf('const toggleMasterSheet'));
  assert.ok(!sheet.includes('CAT_LABEL'), 'no 8-category list in the compact sheet');
  assert.ok(!sheet.includes('setQuiet'), 'no quiet-hours editor in the compact sheet');
  assert.ok(!sheet.includes('setCap'), 'no daily-cap editor in the compact sheet');
});

/* ── Round 2 (owner directive 2026-09-17): full-screen inbox + one-time prompt + iOS fix ── */

const INBOX = readFileSync('notification-inbox.js', 'utf8');
const WORKER_SRC = readFileSync('fcm-notification.mjs', 'utf8');
const PROFILE = readFileSync('profile-ui.js', 'utf8');
const INDEX = readFileSync('index.html', 'utf8');
const SW = readFileSync('sw.js', 'utf8');
const FCM = readFileSync('notification-fcm.js', 'utf8');

test('bell uses bellTap: registered → inbox, not registered → allow dialog (round 8)', () => {
  assert.match(DASH, /dv2-bell[^>]*onclick="NotificationHub\.bellTap\(\)"/, 'bell → NotificationHub.bellTap()');
  assert.match(HUB, /const bellTap = async/);
  assert.match(HUB, /location\.hash = 'notifications'/, 'goInbox navigates to #notifications');
  const bell = HUB.slice(HUB.indexOf('const bellTap'), HUB.indexOf('const markOneRead'));
  assert.ok(bell.includes('openAllowDialog()'), 'not registered → premium centered allow dialog');
  assert.ok(!bell.includes('ahNotifPromptShown'), 'no one-time prompt flag left');
  assert.ok(!bell.includes('openSheet()'), 'bell never opens the settings sheet');
})

test('inbox: CLEAN full-screen list — no status bar, no test button, back works (round 8)', () => {
  assert.match(INBOX, /window\.renderNotificationsInbox = function renderNotificationsInbox/);
  assert.match(INBOX, /window\.__nifBack = \(\) => \{/, 'back button handler (owner bug: back did nothing)');
  assert.match(INBOX, /window\.navigate\('dashboard'\)/, 'back uses the app router');
  assert.match(INBOX, /nif-tab[^>]*onclick="window\.__nifTab\('all'\)"/, 'All tab');
  assert.match(INBOX, /nif-tab[^>]*onclick="window\.__nifTab\('unread'\)"/, 'Unread tab');
  assert.match(INBOX, /app\.classList\.add\('no-nav'\)/, 'full-screen (nav hidden)');
  assert.ok(INBOX.includes("bn: 'সব'") && INBOX.includes("en: 'All'"), 'All tab dual language');
  assert.ok(INBOX.includes("bn: 'অপঠিত'") && INBOX.includes("en: 'Unread'"), 'Unread tab dual language');
  assert.ok(INBOX.includes("bn: 'নোটিফিকেশন'") && INBOX.includes("en: 'Notifications'"), 'title dual language');
  assert.match(INBOX, /hub\._log\(\)/, 'data from the hub log (real data only)');
  assert.match(INBOX, /hub\.markOneRead\(id\)/, 'tap marks a row read');
  assert.ok(!INBOX.includes('nif-statusbar'), 'no "Push চালু আছে / device" status bar');
  assert.ok(!INBOX.includes('nifTestBtn'), 'no Test button in the inbox');
  assert.ok(!INBOX.includes('nif-pushbar'), 'no push-off/ios banner in the inbox');
})

test('router: #notifications route + script tags + SW pin (round 8 pins)', () => {
  assert.match(INDEX, /p==='notifications' && window\.renderNotificationsInbox/);
  assert.match(INDEX, /notification-inbox\.js\?v=notif-inbox-v7/);
  assert.match(INDEX, /notification-hub\.js\?v=notify-p3-v122/);
  assert.match(INDEX, /notification-fcm\.js\?v=fcm-p3-v15/);
  assert.match(INDEX, /profile-ui\.js\?v=profile-v20-sky-instr/);
  assert.match(SW, /notification-inbox\.js\?v=notif-inbox-v7/);
  assert.match(SW, /dashboard-v2\.js\?v=dash2f16-avatar-cache/);
})

test('iOS fix: permission ask runs before any network await (hub + fcm)', () => {
  const toggle = HUB.slice(HUB.indexOf('const doPushToggle'), HUB.indexOf('const fcmSheetToggle'));
  const ask = toggle.indexOf('Notification.requestPermission()');
  const status = toggle.indexOf('await window.AhFcm.status()');
  assert.ok(ask !== -1 && status !== -1, 'both calls present in doPushToggle');
  assert.ok(ask < status, 'requestPermission() BEFORE the status() network await');
  const enable = FCM.slice(FCM.indexOf('const enable'), FCM.indexOf('const disable'));
  const fcmAsk = enable.indexOf('Notification.requestPermission()');
  const fcmCfg = enable.indexOf('await getConfig()');
  assert.ok(fcmAsk !== -1 && fcmCfg !== -1, 'both calls present in enable()');
  assert.ok(fcmAsk < fcmCfg, 'requestPermission() BEFORE getConfig() in AhFcm.enable()');
});

test('profile: Notifications row removed from Preferences (owner: সরিয়ে নাও)', () => {
  assert.ok(!PROFILE.includes("row('🔔', 'Notifications'"), 'no Notifications row in profile');
  assert.ok(!PROFILE.includes('pref-notifications') || !/row\('🔔'/.test(PROFILE), 'no row with pref-notifications role');
});

test('enable() failures stay specific internally (no raw error codes shown to users, round 8)', () => {
  assert.match(FCM, /setErr\('config-failed', 'config request failed'\); return 'config-failed'/);
  assert.match(FCM, /setErr\('sdk-failed', errText\(e\)\); return 'sdk-failed'/);
  assert.match(FCM, /setErr\('token-failed', errText\(e\)\); return 'token-failed'/);
  assert.match(FCM, /setErr\('register-' \+ out\.status/);
  assert.match(FCM, /_state: stateGet, _config: getConfig, lastErr/, 'lastErr retained for diagnostics');
  assert.match(FCM, /detail: detail \? String\(detail\)\.slice\(0, 200\) : undefined/, 'raw failure reason is retained');
  assert.ok(!HUB.includes("sheetT('lastErrLabel')"), 'sheet no longer renders the raw error code');
})

test('test push: no user-facing buttons anywhere (owner 2026-09-17); endpoint stays for dev', () => {
  assert.match(FCM, /const selfTest = async/, 'AhFcm.selfTest client kept for diagnostics');
  assert.match(FCM, /_state: stateGet, _config: getConfig, lastErr, selfTest/);
  assert.ok(!HUB.includes('sendSelfTest()'), 'no test button in the sheet');
  assert.ok(!INBOX.includes('__nifTest()'), 'no test button in the inbox');
  assert.match(WORKER_SRC, /'\/api\/notifications\/self-test'/, 'worker endpoint still exists (rate-limited, session-bound)');
  assert.ok(!WORKER_SRC.includes("FCM_WELCOME_PUSH !== 'off'"), 'welcome push removed from the worker');
})

test('Firebase SDK self-hosted (Cloudflare stack) with gstatic fallback', () => {
  assert.match(FCM, /const SDK_LOCAL = '.\/sdk'/);
  assert.match(FCM, /try \{ return await tryLoadSdk\(SDK_LOCAL\); \}/);
  assert.match(FCM, /catch \(_\) \{ return await tryLoadSdk\(SDK_BASE\); \}/);
  assert.ok(HUB.includes("bn: 'বেশিবার চেষ্টা হয়েছে, ১ ঘণ্টা পর আবার চেষ্টা করুন'"), '429 toast bn');
  assert.ok(HUB.includes("bn: 'Login session সমস্যা, আবার login করে চেষ্টা করুন'"), '401 toast bn');
  assert.match(HUB, /r === 'register-429'\) toastShort\(sheetT\('errRate'\)/);
  assert.match(HUB, /r === 'register-401'\) toastShort\(sheetT\('errLogin'\)/);
});

test('iOS Home-Screen guidance: allow dialog + sheet (round 8)', () => {
  assert.match(HUB, /const isIOS = \(\) =>/, 'hub detects iOS');
  assert.match(HUB, /iosInstallBody/, 'sheet has the Home-Screen instructions');
  assert.ok(HUB.includes("bn: 'iPhone-এ ওয়েব পুশ শুধু Home Screen-এ"), 'bn instruction');
  assert.ok(HUB.includes("en: 'On iPhone, web push works only when the app is on your Home Screen."), 'en instruction');
  assert.match(HUB, /toastShort\(isIOS\(\) \? sheetT\('iosToast'\) : sheetT\('blocked'\)\)/, 'unsupported-on-iOS → helpful toast, not "blocked"');
  assert.match(HUB, /s\.permission === 'unsupported'/, 'sheet row handles the unsupported state');
  assert.match(HUB, /allowT\('iosHome'\)/, 'allow dialog guides iOS Home-Screen install');
  assert.ok(HUB.includes("bn: 'নোটিফিকেশন চালু করুন'") && HUB.includes("en: 'Turn on notifications'"), 'allow dialog title dual language');
  assert.ok(HUB.includes("bn: 'অনুমতি দিই'") && HUB.includes("en: 'Allow'"), 'allow dialog button dual language');
})
