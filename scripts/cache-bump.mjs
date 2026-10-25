#!/usr/bin/env node
// Bump cache-busting versions across the shell in one step, then regenerate the
// service-worker digests. Usage: node scripts/cache-bump.mjs
//
// Keeping this scripted matters because the version string is asserted in
// several tests and duplicated in index.html and sw.js; a manual edit always
// misses one and the mismatch only shows up in a student's stale cache.
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const root = new URL('../', import.meta.url);
const relative = path => new URL(path, root);

// The asset version string shared by account-access.{js,css} and the
// language-engine table. Bump both when either file changes.
const UI_VERSION_FROM = '20261021-turnstile-v1';
const UI_VERSION_TO = '20261025-pw-guard-hint';
const LANG_VERSION_FROM = 'lang-v5-single-email-button';
const LANG_VERSION_TO = 'lang-v6-pw-guard-hint';
// NOTE: SW_BUILD_TO must always equal the BUILD_ID in sw.js. Without a bump the
// deploy ships new files under old ?v= tokens; browsers then serve them
// immutable for a year, so students keep the old app and every fix misses them.
const SW_BUILD_FROM = 'v364-sky-goal';
const SW_BUILD_TO = 'v365-pw-guard-hint';

const targets = [
  'index.html',
  'sw.js',
  // app-seed.js carries the sky-flow version that loads sky-onboarding.{js,css};
  // if it does not move, the browser asks for the old token and never fetches the
  // newly precached flow.
  'app-seed.js',
  'analytics-service.js',
  'account-retirement.test.mjs',
  'interactive-native-personal-v1.test.mjs',
  'code-native-welcome-v1.test.mjs',
  'startup-ai-regression.test.mjs',
  'startup-fast.test.mjs',
  'profile-ui.test.mjs',
  'fcm-global-contract.test.mjs',
  // The shell version is asserted by these older shell-contract suites too.
  // They were missing from this list, so a bump left them pinned to the
  // previous string and the suite failed on a version that had moved on.
  'idb-hardening.test.mjs',
  'intro.test.mjs',
  'p08-exam-ac3.test.mjs',
  'p08-state-preserve.test.mjs',
  'p10-mistakes.test.mjs',
  'p11-dashboard-v2.test.mjs',
  'p13-dashboard-cache-guard.test.mjs',
  'p16-dashboard-single.test.mjs',
  'p18-legacy-dashboard-kill.test.mjs',
  'p20-voice-sameorigin.test.mjs',
  'p21-ai-agent-ui.test.mjs',
  // The publish workflow greps the deployed shell for these exact literals, so
  // it pins the same version string and must move with it.
  '.github/workflows/telegram-auth-canary-activate.yml'
];

const replacements = [
  [UI_VERSION_FROM, UI_VERSION_TO],
  [LANG_VERSION_FROM, LANG_VERSION_TO],
  [SW_BUILD_FROM, SW_BUILD_TO],
  // The AI chat script's own cache-busting query moves with the shell build, so
  // it is bumped in the same pass to keep index.html and sw.js in lockstep.
  ['ai-agent-chat.js?v=agent-f1-ui-skyv6', 'ai-agent-chat.js?v=agent-f1-ui-skyv7'],
  // dashboard-v2.js is served `immutable, max-age=31536000`, so its ?v= token IS
  // the only thing that makes a browser fetch a new build. This bump was missing
  // from the list: sw.js shipped new dashboard bytes under the old token, so
  // every phone kept the previous dashboard for a year and a fix looked like it
  // never deployed. It must move whenever dashboard-v2.js changes.
  ['dashboard-v2.js?v=dash2f16-avatar-cache', 'dashboard-v2.js?v=dash2f17-v3frame'],
  // sky-onboarding.js gained the disposable-email hint at the field, so its
  // token must move or a cached copy keeps the old flow.
  ['sky-flow-20261016-v6', 'sky-flow-20261016-v7'],
  // sky-onboarding.{js,css} gained the keyboard-aware compact layout.
  ['sky-flow-20261016-v7', 'sky-flow-20261017-v8'],
  // dashboard-v2.js changed (status-strip declaration, safe-area header) and is immutable-cached,
  // so its token must move or phones keep the previous bytes for a year.
  ['dashboard-v2.js?v=dash2f17-v3frame', 'dashboard-v2.js?v=dash2f18-chrome'],
  // sky-onboarding.{js,css}: keyboard-aware (not just focus-aware) compact mode + seam fill.
  ['sky-flow-20261017-v8', 'sky-flow-20261017-v9'],
  // compact keyboard layout: the Next button follows the content (no empty middle).
  ['sky-flow-20261017-v9', 'sky-flow-20261017-v10'],
  // keyboard layout v11: roomy bird, Next above the keyboard, no +140px page, no stale --vh.
  ['sky-flow-20261017-v10', 'sky-flow-20261018-v11']
];

let changed = 0;
for (const target of targets) {
  const url = relative(target);
  const before = readFileSync(url, 'utf8');
  let after = before;
  for (const [from, to] of replacements) after = after.split(from).join(to);
  if (after !== before) {
    writeFileSync(url, after);
    changed += 1;
    console.log(`updated ${target}`);
  }
}

console.log(`${changed} file(s) updated; regenerating service-worker digests`);
execFileSync('node', [relative('scripts/sw-manifest.mjs').pathname], { stdio: 'inherit' });
