import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const read = name => readFileSync(new URL(`./${name}`, import.meta.url), 'utf8');
const JS = read('account-access.js');
const CSS = read('account-access.css');
const DASH_JS = read('dashboard-v2.js');
const DASH_CSS = read('dashboard-v2.css');
const NAV_JS = read('phase12-ui.js');
const HTML = read('index.html');
const SW = read('sw.js');
const PAGES_GUARD = read('.github/workflows/cf-pages.yml');
const RELEASE_WORKFLOW = read('.github/workflows/telegram-auth-canary-activate.yml');
const UI_VERSION = '20261018-allowlist-v1';
const UI_JS_VERSION = '20261021-turnstile-v1';

const SHELL_VERSION = 'v364-sky-goal';

const between = (source, start, end) => {
  const from = source.indexOf(start);
  assert.notEqual(from, -1, `missing start marker: ${start}`);
  const to = source.indexOf(end, from + start.length);
  assert.notEqual(to, -1, `missing end marker: ${end}`);
  return source.slice(from, to);
};
const welcome = between(JS, '<div class="ah-account-view ah-welcome-view"', '<form class="ah-account-view ah-login-view"');

const mediaTag = /<(?:img|picture|source|canvas|video|object|embed)(?:\s|>)/i;
const rasterUrl = /background(?:-image)?\s*:[^;{}]*url\s*\(/i;

test('account access remains a real full-screen document, never popup or dialog semantics', () => {
  assert.match(JS, /pageHost\.id = 'ah-account-page'/);
  assert.match(JS, /<main class="ah-account-shell" aria-labelledby="ah-account-title"[^>]+data-visual-contract="code-native-page-system-v1">/);
  assert.doesNotMatch(JS, /ah-account-overlay|ah-account-modal|role="dialog"|aria-modal="true"|aria-haspopup', 'dialog'/);
  assert.match(JS, /document\.body\.classList\.toggle\('ah-account-page-active', visible\)/);
  assert.match(JS, /node\.inert = visible/);
  assert.doesNotMatch(JS, /document\.documentElement\.style\.overflow = 'hidden'/);
  assert.match(CSS, /body\.ah-account-page-active>#app/);
  assert.match(CSS, /\.ah-account-page\{[\s\S]{0,300}min-height:100dvh/);
  assert.match(CSS, /\.ah-account-page\[data-current-view="welcome"\] \.ah-account-shell\[data-current-view="welcome"\]\{[\s\S]{0,160}width:100%[\s\S]{0,100}max-width:none/);
});

test('Welcome ships only the functional entry controls; the old design is gone', () => {
  assert.match(welcome, /data-page-contract="code-native-welcome-v1"/);
  assert.match(welcome, /data-media-contract="zero-raster-entry-v1"/);
  // The owner's live design (welcome-onboarding.js) replaces this at runtime, so
  // the server view keeps only the controls the account flow binds to.
  assert.match(welcome, /data-native-welcome-mount="welcome-onboarding-v1"/);
  assert.match(welcome, /data-role="welcome-language"/);
  // The old decorative welcome is fully deleted from the server view.
  for (const dead of ['journey-console', 'ah-console-', 'ah-welcome-stage', 'ah-welcome-benefits',
    'ah-welcome-ai-helper', 'ah-welcome-landscape', 'ah-code-ambient', 'ah-brand-mark',
    'STUDY PATH', 'আপনার লক্ষ্যের পথে']) {
    assert.ok(!welcome.includes(dead), `old welcome part still present: ${dead}`);
  }
  assert.doesNotMatch(welcome, /data-3d-student-stage|ah-3d-student|ah-3d-object|ah-3d-campus/);
  assert.doesNotMatch(CSS, /ah-3d-/);
  // The four entry paths remain as functional hooks (Google/guest are wired, not shown).
  assert.deepEqual([...welcome.matchAll(/data-role="(welcome-signup|welcome-login|continue-guest|welcome-google-button)"/g)].map(match => match[1]).sort(), [
    'continue-guest', 'welcome-google-button', 'welcome-login', 'welcome-signup'
  ]);
  assert.doesNotMatch(welcome, /data-role="close"|AI Assistant|ah-guide|robot/i);
});

test('Welcome and the complete account surface ship zero raster or media elements', () => {
  assert.doesNotMatch(welcome, mediaTag);
  assert.doesNotMatch(JS, mediaTag);
  assert.doesNotMatch(CSS, rasterUrl);
  assert.doesNotMatch(JS, /onboarding-(?:welcome|personal)-hero\.webp/);
  assert.doesNotMatch(SW, /onboarding-(?:welcome|personal)-hero\.webp/);
  assert.equal(existsSync(new URL('./onboarding-welcome-hero.webp', import.meta.url)), false);
  assert.equal(existsSync(new URL('./onboarding-personal-hero.webp', import.meta.url)), false);
  assert.match(PAGES_GUARD, /test ! -e dist\/onboarding-welcome-hero\.webp/);
  assert.match(PAGES_GUARD, /test ! -e dist\/onboarding-personal-hero\.webp/);
  assert.match(PAGES_GUARD, /! grep -Eiq '<\(img\|picture\|source\|canvas\|video\|object\|embed\)/);
});

test('Welcome is fluid edge-to-edge on mobile and premium responsive on desktop', () => {
  assert.match(CSS, /Code-native Onboarding v1 — Welcome and Personal use zero raster media/);
  assert.match(CSS, /Welcome — modular journey console/);
  assert.match(CSS, /\.ah-welcome-header\{[\s\S]{0,180}width:min\(calc\(100% - 32px\),1080px\)/);
  assert.match(CSS, /\.ah-welcome-stage\{[\s\S]{0,180}width:min\(calc\(100% - 32px\),1040px\)/);
  assert.match(CSS, /\.ah-entry-actions button\{[^}]+min-height:56px/);
  assert.match(CSS, /@media\(max-width:390px\)[\s\S]+\.ah-welcome-header,.ah-welcome-stage,.ah-welcome-benefits,.ah-entry-actions\{width:calc\(100% - 24px\)\}/);
  assert.match(CSS, /@media\(min-width:760px\)[\s\S]+\.ah-welcome-stage\{grid-template-columns:/);
  assert.match(CSS, /@keyframes ahRouteMove/);
  assert.match(CSS, /transform:perspective\(900px\) rotateX\(var\(--ah-console-rx\)\) rotateY\(var\(--ah-console-ry\)\)/);
  assert.match(CSS, /@media\(prefers-reduced-motion:reduce\)/);
  assert.match(JS, /const journeyConsole = \$\('\[data-native-welcome-visual="journey-console-v1"\]'\)/);
  assert.match(JS, /journeyConsole\.addEventListener\('pointermove'/);
  assert.match(JS, /--ah-console-rx/);
  assert.match(JS, /setWelcomeLanguage/);
  assert.match(JS, /document\.documentElement\.lang = selected/);
});

test('unsupported verification methods remain truthful and fail closed', () => {
  const methods = between(JS, '<div class="ah-method-stack">', '</div>\n            <p class="ah-account-note">শুধু available');
  assert.equal((methods.match(/<button class="ah-method-card/g) || []).length, 6);
  assert.match(methods, /disabled aria-disabled="true"[\s\S]*?<strong>Passkey<\/strong>/);
  assert.match(methods, /WhatsApp[\s\S]*এখন verification পাওয়া যাচ্ছে না/);
  assert.match(methods, /Telegram[\s\S]*real ৬ সংখ্যার code/);
  // Email OTP proves ownership first; Firebase stays as the last-resort backup.
  assert.match(methods, /Email OTP[\s\S]*Email মালিকানার প্রমাণ/);
  const cardOrder = [...methods.matchAll(/data-role="([a-z-]+)"/g)].map(match => match[1]);
  assert.deepEqual(cardOrder, [
    'email-ownership-start', 'email-magiclink-start', 'telegram-verification-start', 'whatsapp-info', 'email-verification-start'
  ]);
  assert.ok(methods.indexOf('email-ownership-start') < methods.indexOf('email-verification-start'));
  assert.ok(methods.indexOf('telegram-verification-start') < methods.indexOf('email-verification-start'));
  const email = between(JS, 'data-role="verification-email-panel"', '<p class="ah-account-switch"><button class="ah-account-link" type="button" data-role="verify-back"');
  assert.equal((email.match(/data-otp-digit/g) || []).length, 0);
  assert.match(email, /Verification link/);
  const telegram = between(JS, '<form class="ah-account-view ah-account-telegram-view"', '<form class="ah-account-view" data-view="google-link"');
  assert.equal((telegram.match(/data-otp-digit="[0-5]"/g) || []).length, 6);
  assert.match(JS, /data-view="whatsapp-info"[\s\S]*type="button" disabled>Continue with WhatsApp/);
});

test('Signup Assistant is removed while the ordinary app AI remains available', () => {
  assert.doesNotMatch(JS, /ASSISTANT_ENABLED|data-role="guide|ah-guide|AI Assistant|context:\s*\{\s*onboarding/);
  assert.doesNotMatch(CSS, /\.ah-guide|\.ah-assistant-hint/);
  assert.match(HTML, /ai-agent-chat\.js\?v=agent-f1-ui-skyv13/);
  assert.match(SW, /ai-agent-chat\.js\?v=agent-f1-ui-skyv13/);
  // bottom-nav AI tab সরানো হয়েছে — AI এখন dashboard-এর Command Center + সরাসরি /ai রুট।
  assert.doesNotMatch(HTML, /\{key:'ai'/);
  assert.doesNotMatch(HTML, /juju-floating\.js/);
  assert.doesNotMatch(SW, /juju-floating\.js/);
  assert.match(HTML, /if\(p==='ai'\)\{ if\(window\.renderAiAgentPage\)/);
  // The v3 dashboard routes through its own go() helper, which hands the path
  // to window.navigate; assert that real wiring instead of a literal call.
  assert.match(DASH_JS, /'nav\.ai':\s*\(\)\s*=>\s*go\('ai'\)/);
  assert.match(DASH_JS, /typeof window\.navigate === 'function'/);
});

test('custom Guest Dashboard is absent and Guest returns to the ordinary app route', () => {
  for (const source of [DASH_JS, DASH_CSS, NAV_JS, HTML]) assert.doesNotMatch(source, /reference-guest-v2|data-guest-nav|dv2-guest|ah-guest-dashboard/);
  assert.match(JS, /rememberEntry\('guest'\);[\s\S]{0,120}close\(\);\s*navigateDashboard\(\);\s*notify\(\)/);
  const navBlock = (HTML.match(/const NAV_TABS=\[[\s\S]*?\];/) || [''])[0];
  assert.match(navBlock, /key:'dashboard'[\s\S]*key:'question-bank'[\s\S]*key:'exam'[\s\S]*key:'my-profile'/);
  // AI আর History bottom tab নয়: AI → dashboard Command Center, History → Exam-এর ভিতরে।
  assert.doesNotMatch(navBlock, /key:'ai'/);
  assert.doesNotMatch(navBlock, /key:'history'/);
  // Phase 7 (owner-approved): the Profile tab is the real signed-in profile,
  // not a custom guest dashboard — guest-dashboard markers above still absent.
  assert.match(HTML, /\{key:'my-profile', icon:'👤', label:'Profile'\}/);
});

test('code-native assets and service-worker release markers are synchronized', () => {
  for (const asset of [`account-access.css?v=${UI_VERSION}`, `account-access.js?v=${UI_JS_VERSION}`, 'dashboard-v2.css?v=dash2f13-theme', 'dashboard-v2.js?v=dash2f18-chrome']) {
    assert.ok(HTML.includes(asset), asset);
    assert.ok(SW.includes(asset), asset);
  }
  assert.match(SW, new RegExp(`const BUILD_ID = '${SHELL_VERSION}'`));
  assert.match(HTML, new RegExp(`expectedSwVersion = '${SHELL_VERSION}'`));
  assert.ok(HTML.indexOf('institutions-bd.js?v=bd-institutions-v2') < HTML.indexOf(`account-access.js?v=${UI_JS_VERSION}`));
  assert.ok(HTML.indexOf(`account-access.js?v=${UI_JS_VERSION}`) < HTML.indexOf('dashboard-v2.js?v=dash2f18-chrome'));
});

test('the welcome screen is the entry point, not the Sky flow directly', () => {
  // Live regression (2026-10-13, owner: "প্রথমে তো welcome আসার কথা"). The
  // rename to Admission Sky rewrote open() to call openSky('signup'|'login')
  // straight away, so the welcome screen -- and the choice between signup and
  // signin -- was skipped entirely. open() must show the welcome view; only the
  // view's own Sign Up / Log In buttons launch the flow.
  const openBody = between(JS, 'const open = options => {', 'const close = () => {');
  assert.match(openBody, /showWelcome\(\)/, 'open() must show the welcome screen on entry');
  assert.doesNotMatch(openBody, /openSky\(/, 'open() must not jump straight into the Sky flow');
  assert.match(JS, /const showWelcome = \(\) => \{[\s\S]{0,220}showView\('welcome'\)/);
  // The legacy fallback now renders through renderView(); showView() is the
  // older name for the same transition, so accept either.
  assert.match(JS, /const showLegacyEntry = mode => \{[\s\S]{0,600}(?:showView|renderView)\('signup'\)[\s\S]{0,200}(?:showView|renderView)\('login'\)/,
    'the fallback must land on the real signup/login form, not back on welcome');
});

test('protected publication remains the only release path for code-native entry v1', () => {
  assert.match(PAGES_GUARD, /Cloudflare Pages Bundle Guard \(No Deploy\)/);
  assert.doesNotMatch(PAGES_GUARD, /wrangler-action|pages deploy dist/);
  assert.match(RELEASE_WORKFLOW, /environment: email-gateway-production/);
  assert.match(RELEASE_WORKFLOW, /npm run test:production-auth/);
  assert.match(RELEASE_WORKFLOW, /npm run audit:premium-browser/);
  assert.match(RELEASE_WORKFLOW, /pages deploy dist --project-name admissionhub --branch main/);
  assert.match(RELEASE_WORKFLOW, /data-media-contract="zero-raster-entry-v1"/);
  assert.match(RELEASE_WORKFLOW, /! grep -Eiq '<\(img\|picture\|source\|canvas\|video\|object\|embed\)/);
  assert.match(RELEASE_WORKFLOW, /! grep -Fq 'onboarding-welcome-hero\.webp'/);
  assert.match(RELEASE_WORKFLOW, /verify_retired_media_absent\(\)/);
  assert.match(RELEASE_WORKFLOW, /verify_retired_media_absent 'onboarding-welcome-hero\.webp'/);
  assert.match(RELEASE_WORKFLOW, /verify_retired_media_absent 'onboarding-personal-hero\.webp'/);
  assert.match(RELEASE_WORKFLOW, /404\|410/);
  assert.match(RELEASE_WORKFLOW, /content-type:\[\[:space:\]\]\*image/);
  assert.match(RELEASE_WORKFLOW, /RIFF'[\s\S]*WEBP/);
  assert.doesNotMatch(RELEASE_WORKFLOW, /fetch_public[^\n]+onboarding-(?:welcome|personal)-hero\.webp/);
  assert.doesNotMatch(RELEASE_WORKFLOW, /printf '%s' "\$[a-z_]+" \| grep -Fq/);
});
