/* Phase 2 — Global Notification Engine wiring contract (source-level).
 * The engine tests (fcm-global.test.mjs) cover the worker API behavior;
 * this file covers the WIRING: cron trigger, client topic subscription,
 * inbox merge, badge, click logging, admin center, and pin consistency
 * across index.html / sw.js. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const WORKER = readFileSync('gk-agent-worker.js', 'utf8');
const FCM = readFileSync('fcm-notification.mjs', 'utf8');
const WRANGLER = readFileSync('wrangler.toml', 'utf8');
const CLIENT_FCM = readFileSync('notification-fcm.js', 'utf8');
const INBOX = readFileSync('notification-inbox.js', 'utf8');
const HUB = readFileSync('notification-hub.js', 'utf8');
const SW_MSG = readFileSync('firebase-messaging-sw.js', 'utf8');
const ADMIN = readFileSync('notification-command-center.html', 'utf8');
const ADMIN_ROUTE = readFileSync('notification-center-route.js', 'utf8');
const INDEX = readFileSync('index.html', 'utf8');
const SW = readFileSync('sw.js', 'utf8');

test('worker entry: cron calls the global scheduler (try/catch, before GK)', () => {
  assert.match(WORKER, /import \{ handleFcmNotificationRequest, runScheduledGlobalNotifications \} from '\.\/fcm-notification\.mjs';/);
  assert.match(WORKER, /try \{ await runScheduledGlobalNotifications\(env\); \} catch \(_\) \{\}/, 'scheduler runs on every cron tick, fail-soft');
  const schedIdx = WORKER.indexOf('async scheduled');
  const schedBody = WORKER.slice(schedIdx);
  assert.ok(schedBody.indexOf('runScheduledGlobalNotifications') < schedBody.indexOf("get('gkDay')"), 'global scheduler runs BEFORE the date-guarded GK check');
});

test('wrangler cron: every minute (GK stays date-guarded, spec: Cloudflare Cron replaces Vercel Cron)', () => {
  assert.match(WRANGLER, /crons = \["\* \* \* \* \*"\]/);
});

test('worker exposes all 10 Phase 2 routes', () => {
  for (const p of [
    '/api/notifications/global/send',
    '/api/notifications/global/schedule',
    '/api/notifications/global/cancel',
    '/api/notifications/history',
    '/api/notifications/templates',
    '/api/notifications/topics/subscribe',
    '/api/notifications/topics/unsubscribe',
    '/api/notifications/inbox',
    '/api/notifications/read',
    '/api/notifications/click'
  ]) assert.ok(FCM.includes(`path === '${p}'`), `route ${p}`);
});

test('worker: topic-first hybrid send (no per-user loop), single-token fallback, caps', () => {
  assert.match(FCM, /const GLOBAL_DAILY_CAP = 10;/);
  assert.ok(FCM.includes('fcmSendToTopic'), 'topic sender exists');
  assert.ok(FCM.includes('activeDevicesMissingTopic'), 'fallback targets only non-topic devices');
  /* The fallback must use the single-send contract (`token:`), not the batch
   * `tokens:` array — that array belongs to a different FCM endpoint and every
   * non-topic device silently received nothing while the row read "sent". */
  assert.match(FCM, /const message = \{\s*\n\s*token: target\.token,/, 'single-send uses token:');
  assert.ok(!/message: \{ tokens:/.test(FCM), 'never batch-send to the single-send endpoint');
  assert.ok(FCM.includes("status IN ('sent','scheduled')"), 'dedup window covers sent + scheduled');
});

test('fcm send: app-logo icon/badge on every path + distinct-token fanout', () => {
  /* Android showed the OS default "A" avatar because the payload carried no
   * icon at all. Both the topic and per-device paths must set it from the live
   * logo URL, so a logo swap reaches every future push with no redeploy. */
  assert.match(FCM, /const APP_ICON_PATH = '\/icons\/icon-192\.png';/);
  /* The icon must point at the Pages origin, NOT the worker origin: the Pages
   * proxy forwards /api/* to the worker with the worker's own URL, and
   * /icons/* on the worker host answers 403 → Android draws "A". */
  assert.match(FCM, /const publicOrigin = request =>/, 'a public-origin resolver exists');
  assert.match(FCM, /const iconAbsolute = request => `\$\{publicOrigin\(request\)\}\$\{APP_ICON_PATH\}`;/, 'icon is built on the public origin');
  assert.ok(!/new URL\(APP_ICON_PATH, request/.test(FCM), 'never derive the icon from request.url (worker origin)');
  assert.match(FCM, /webpush: \{ notification: \{/, 'webpush block present');
  assert.match(FCM, /android: \{ notification: \{/, 'android block present');
  assert.equal((FCM.match(/iconUrl \? \{ icon: iconUrl \}/g) || []).length, 4, 'icon set on both paths (webpush+android each)');
  /* One physical device = one FCM token. Several accounts on the same phone
   * must not make it ring several times. */
  assert.match(FCM, /const byToken = new Map\(\);/);
  assert.match(FCM, /COUNT\(DISTINCT fcm_token\) AS n FROM fcm_devices WHERE is_active=1/);
});

test('client fcm: subscribes the device to all_students after register + on refresh', () => {
  assert.match(CLIENT_FCM, /const GLOBAL_TOPIC = 'all_students';/);
  assert.match(CLIENT_FCM, /await messaging\.subscribeToTopic\(GLOBAL_TOPIC\);/);
  assert.match(CLIENT_FCM, /'\/topics\/subscribe'/);
  assert.ok(CLIENT_FCM.indexOf("await ensureTopic(messaging, token); return 'granted'") > -1, 'topic sub on first enable');
  assert.match(CLIENT_FCM, /await ensureTopic\(messaging, token\);/, 'topic sub refreshed on boot reconcile');
  assert.match(CLIENT_FCM, /catch \(_\) \{ \/\* server fallback covers this device \*\/ \}/, 'best-effort — never breaks enablement');
});

/* Owner directive: users must receive push with no extra/confusing steps.
 * Permission already granted is the durable signal — if the device looks
 * "off" only because a flag/token went stale, boot must silently re-register
 * rather than wait for the user to tap Enable again. */
test('client fcm: boot reconciles push instead of trusting the flag', () => {
  assert.match(CLIENT_FCM, /const reconcile = async \(force = false\) =>/, 'a reconciler exists');
  assert.match(CLIENT_FCM, /const refreshIfEnabled = \(\) => reconcile\(\);/, 'boot hook routes through it');
  assert.match(CLIENT_FCM, /if \(st\.optedOut\) return;/, 'an explicit opt-out is respected, never overridden');
  assert.match(CLIENT_FCM, /if \(permission\(\) !== 'granted'\) return;/, 'permission is the durable signal');
  assert.ok(!/if \(!st\.enabled\) return;/.test(CLIENT_FCM), 'a stale/absent enabled flag must not skip reconciliation');
  assert.match(CLIENT_FCM, /stateSet\(\{ enabled: true, optedOut: false, token, at: Date\.now\(\) \}\);/, 'success records the token for next boot');
  assert.match(CLIENT_FCM, /stateSet\(\{ enabled: false, optedOut: true, at: Date\.now\(\) \}\);/, 'disable records the opt-out');
  assert.ok(!/Notification\.requestPermission\(\)[\s\S]{0,200}reconcile/.test(CLIENT_FCM), 'reconcile never prompts');
});

/* Turning push off must actually stop push. The settings sheet's VAPID path
 * and the FCM registration are two channels; stopping only one left push
 * arriving while the UI said "off". */
test('client hub: turning push off stops both push channels', () => {
  const HUB = readFileSync('notification-hub.js', 'utf8');
  const body = HUB.slice(HUB.indexOf('const disablePush ='), HUB.indexOf('// ── UI: dashboard card'));
  assert.match(body, /\/api\/push\/unsubscribe'/, 'drops the VAPID subscription');
  assert.match(body, /subscription\.unsubscribe\(\)/, 'and unsets it locally');
  assert.match(body, /await window\.AhFcm\?\.disable\?\.\(\)/, 'and stops the FCM channel too');
});

test('inbox v6: merges the global feed, dedupes by id, taps log read + deep link', () => {
  assert.match(INBOX, /'\/api\/notifications\/inbox'/);
  assert.ok(INBOX.includes("source: 'global'"), 'global rows are tagged');
  assert.match(INBOX, /const seen = new Set\(global\.map\(r => r\.id\)\);\s*\n\s*return \[\.\.\.global, \.\.\.local\.filter\(r => !seen\.has\(r\.id\)\)\];/, 'dedup by id');
  assert.match(INBOX, /'\/api\/notifications\/read'/, 'tap marks the global read server-side');
  assert.match(INBOX, /location\.hash = targetUrl\.replace/, 'tap deep-links (spec: click → specific page)');
});

test('hub v119: bell badge includes global unread; click logging on boot', () => {
  assert.match(HUB, /const globalUnreadCount = async/);
  assert.match(HUB, /const unread = \(await unreadCount\(\)\) \+ \(await globalUnreadCount\(\)\);/, 'badge = local + global unread');
  assert.match(HUB, /caches\.open\('ah-fcm-click'\)/, 'boot reads the stored click from Cache Storage');
  assert.match(HUB, /'\/api\/notifications\/click'/, 'boot logs the click to the API');
  assert.match(HUB, /c\.delete\(ahFcmClickKey\)/, 'click logged once');
  assert.match(HUB, /globalUnreadCount, bellTap/, 'exported');
});

test('service worker: notificationclick stores {id: gid, link} for the app', () => {
  /* A service worker has no localStorage; the click is written to Cache
   * Storage, and the write rides inside event.waitUntil so it survives the
   * worker being terminated after the event.
   * Phase 3 added a second branch: an intelligence push carries `key` rather
   * than `gid`, and that key is what the outcome route attributes a click to. */
  assert.match(SW_MSG, /caches\.open\('ah-fcm-click'\)\.then\(\(c\) => c\.put\(/);
  assert.match(SW_MSG, /\{ id: String\(nd\.gid\), link: route, at: Date\.now\(\) \}/, 'global push keeps the gid record');
  assert.match(SW_MSG, /\{ intelKey: String\(nd\.key\), link: route, at: Date\.now\(\) \}/, 'intel push records the engine key');
  assert.match(SW_MSG, /const clickRecord = nd\.gid/, 'the two branches are chosen by which field the push carries');
  assert.ok(!/self\.localStorage/.test(SW_MSG), 'a service worker must not touch localStorage');
  assert.match(SW_MSG, /event\.notification\.close\(\);/, 'closes the notification (unchanged behavior)');
});

test('command center: token gate (sessionStorage only) + all 6 types and 5 audiences', () => {
  assert.match(ADMIN, /const API_TOKEN_KEY='ahAdminTok'/, 'admin token stored');
  assert.match(ADMIN, /sessionStorage\.setItem\(API_TOKEN_KEY,v\)/, 'sessionStorage — never localStorage/URL');
  assert.ok(!/localStorage\.[gs]etItem\('ahAdminTok'\)/.test(ADMIN), 'token never in localStorage');
  const types = ['new-content', 'announcement', 'new-feature', 'challenge', 'course', 'important'];
  for (const k of types) assert.ok(ADMIN.includes(`key:"${k}"`), `type ${k}`);
  const audiences = ['all_students', 'beginner', 'intermediate', 'pro', 'course_subscribers'];
  for (const k of audiences) assert.ok(ADMIN.includes(`key:"${k}"`), `audience ${k}`);
});

test('command center data layer: real endpoints, Bearer token, no demo send', () => {
  assert.match(ADMIN, /NS\.api\.get\('\/api\/notifications\/history'\)/, 'history from the API');
  assert.match(ADMIN, /\/api\/notifications\/global\/send/, 'real send endpoint');
  assert.match(ADMIN, /\/api\/notifications\/global\/schedule/, 'real schedule endpoint');
  assert.match(ADMIN, /\/api\/notifications\/global\/cancel/, 'real cancel endpoint');
  assert.match(ADMIN, /'Authorization':'Bearer '\+apiToken\(\)/, 'every admin call carries the Bearer token');
  assert.doesNotMatch(ADMIN, /Recorded send approval and started delivery \(SAMPLE\)/, 'demo audit copy is gone');
  assert.doesNotMatch(ADMIN, /state\.sent\.unshift\(newRow\)/, 'demo send-into-state is gone');
});

test('command center composer: typing never re-renders the form (mobile keyboard stays up)', () => {
  /* The v2 composer updates state and patches the preview in place on `input`;
   * it never replaces the focused <input> node, so the keyboard stays up. */
  assert.match(ADMIN, /data-field="title"/, 'title field is addressable');
  assert.match(ADMIN, /data-field="body"/, 'body field is addressable');
  assert.match(ADMIN, /function refreshPreviewOnly\(\)/, 'in-place preview refresh exists');
  assert.match(ADMIN, /querySelectorAll\('\.ns-compose-side'\)/, 'refresh targets the side panels');
  assert.match(ADMIN, /refreshPreviewOnly\(\); return;/, 'input handler refreshes in place without re-rendering');
  assert.match(ADMIN, /function initKeyboard\(\)/, 'visualViewport keyboard handling exists');
  assert.match(ADMIN, /--keyboard-inset/, 'the keyboard inset is computed');
});

test('index.html: command-center script tag + route dispatch (hidden route, not in nav)', () => {
  assert.match(INDEX, /<script defer src="\.\/notification-center-route\.js\?v=ns-cc-route-v1"><\/script>/);
  assert.match(INDEX, /if\(p==='notif-admin'\)\{/);
  assert.match(INDEX, /window\.NotificationCenterRoute\.render/);
  assert.match(ADMIN_ROUTE, /window\.renderNotificationAdmin = openCenter;/, 'back-compat route contract kept');
  assert.match(ADMIN_ROUTE, /notification-command-center\.html/, 'hands off to the standalone page');
});

test('pin consistency: index.html script pins match sw.js cache entries + digests', () => {
  const pins = {
    'notification-fcm.js': 'fcm-p3-v15',
    'notification-inbox.js': 'notif-inbox-v7',
    'notification-hub.js': 'notify-p3-v122',
    'notification-center-route.js': 'ns-cc-route-v1'
  };
  for (const [file, pin] of Object.entries(pins)) {
    assert.match(INDEX, new RegExp(`<script defer src="\\./${file}\\?v=${pin}">`), `${file} pin in index.html`);
  }
  /* shell-precached subset (the hub is not in APP_SHELL by design) */
  for (const file of ['notification-fcm.js', 'notification-inbox.js', 'notification-center-route.js']) {
    assert.ok(SW.includes(`'./${file}?v=${pins[file]}'`), `${file} pin in sw.js APP_SHELL`);
  }
  /* digests must exist for the shell-cached files */
  for (const file of ['notification-fcm.js', 'notification-inbox.js', 'notification-center-route.js']) {
    const pin = pins[file];
    assert.match(SW, new RegExp(`"./${file}\\?v=${pin}": "[0-9a-f]{64}"`), `digest for ${file}`);
  }
  /* shell canary bumped together in both files */
  assert.match(INDEX, /v364-sky-goal/g);
  assert.match(SW, /const BUILD_ID = 'v364-sky-goal';/);
  // index.html pins the canary twice: the SW-version check and the cache name.
  assert.ok((INDEX.match(/v364-sky-goal/g) || []).length >= 2, 'canary pinned in index.html (register + SW check)');
});

test('sw-manifest digest of the command-center route shim is correct', () => {
  const m = SW.match(/"\/?\.\/notification-center-route\.js\?v=ns-cc-route-v1": "([0-9a-f]{64})"/);
  assert.ok(m, 'digest present');
  const actual = createHash('sha256').update(readFileSync('notification-center-route.js')).digest('hex');
  assert.equal(m[1], actual, 'digest matches the file on disk');
});
