import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const read = name => readFileSync(new URL(`./${name}`, import.meta.url), 'utf8');
const JS = read('account-access.js');
const CSS = read('account-access.css');
const HTML = read('index.html');
const SW = read('sw.js');
const RELEASE = read('.github/workflows/telegram-auth-canary-activate.yml');
const BUNDLE_GUARD = read('.github/workflows/cf-pages.yml');
const UI_VERSION = '20261018-allowlist-v1';
const UI_JS_VERSION = '20261021-turnstile-v1';

const SHELL_VERSION = 'v364-sky-goal';

const signupStart = JS.indexOf('<form class="ah-account-view ah-signup-view"');
const signupEnd = JS.indexOf('<div class="ah-account-view ah-created-view"', signupStart);
const signup = JS.slice(signupStart, signupEnd);
const personalStart = signup.indexOf('data-signup-panel="personal"');
const schoolStart = signup.indexOf('data-signup-panel="school"');
const personal = signup.slice(personalStart, schoolStart);
const securityStart = signup.indexOf('data-signup-panel="security"');
const security = signup.slice(securityStart);
const mediaTag = /<(?:img|picture|source|canvas|video|object|embed)(?:\s|>)/i;

test('Signup 01 Personal is an input-bound native profile UI, not artwork or screenshot', () => {
  assert.ok(signupStart > 0 && signupEnd > signupStart);
  assert.match(signup, /data-personal-visual-contract="interactive-native-personal-v1"/);
  assert.match(signup, /data-media-contract="zero-raster-entry-v1"/);
  assert.match(signup, /<i>1<\/i><span>Personal<\/span><small>Your identity<\/small>/);
  assert.match(signup, /<i>2<\/i><span>Education<\/span><small>Study details<\/small>/);
  assert.match(signup, /<i>3<\/i><span>Security<\/span><small>Secure account<\/small>/);
  assert.match(personal, /data-dob-contract="premium-dropdown-dob-v2"/);
  assert.match(personal, /class="ah-dob-select" id="ah-dob-day"/);
  assert.match(personal, /class="ah-dob-select" id="ah-dob-month"/);
  assert.match(personal, /class="ah-dob-select" id="ah-dob-year"/);
  assert.doesNotMatch(personal, /data-wheel=/);
  assert.match(personal, /Personal information/);
  assert.match(personal, /Continue/);
  assert.doesNotMatch(personal, /data-profile-preview-contract="input-bound-profile-v1"/);
  assert.doesNotMatch(personal, /data-role="personal-live-initials"/);
  assert.doesNotMatch(personal, /LIVE PROFILE/);
  assert.doesNotMatch(personal, /পরিচয়টা তৈরি করি/);
  assert.doesNotMatch(personal, mediaTag);
  assert.doesNotMatch(personal, /ah-native-profile|ah-native-pedestal|ah-native-book|ah-native-cap|ah-native-leaf|ah-personal-landscape/);
});

test('DOB is a premium native dropdown trio — no 3D wheel machinery left', () => {
  assert.match(JS, /const setupDobDropdowns = \(\) => \{/);
  assert.match(JS, /const EN_MONTHS = \[/);
  assert.match(JS, /const syncDobDays = \(\) => \{/);
  assert.match(JS, /updateDobPreview\(\);/);
  assert.doesNotMatch(JS, /setupDobWheels|renderDobWheel|ah-dob-wheel|BANGLA_MONTHS/);
  assert.match(CSS, /\.ah-dob-select\{[^}]+appearance:none/);
  assert.match(CSS, /\.ah-dob-select-wrap>svg\{/);
  assert.match(CSS, /\.ah-dob-select:focus-visible\{/);
  assert.doesNotMatch(CSS, /\.ah-dob-wheel/);
  assert.doesNotMatch(CSS, /\.ah-live-profile/);
});

test('name and all DOB selectors stay combined on Personal without collecting Email early', () => {
  for (const id of ['ah-signup-name', 'ah-dob-day', 'ah-dob-month', 'ah-dob-year']) assert.match(personal, new RegExp(`id="${id}"`));
  assert.equal((personal.match(/<select /g) || []).length, 3);
  assert.doesNotMatch(signup, /data-signup-panel="dob"/);
  assert.doesNotMatch(personal, /id="ah-signup-email"/);
  assert.match(security, /id="ah-signup-email"/);
  assert.match(JS, /const order = \['personal', 'school', 'college', 'security'\]/);
  assert.match(JS, /const validatePersonal = \(\) => \{[\s\S]{0,700}return validateDob\(\)/);
  assert.match(JS, /const validateSecurity = \(\) => \{[\s\S]{0,350}সঠিক Email address/);
});

test('both rejected image-based entry designs are absent and mobile spacing is fluid', () => {
  assert.equal(existsSync(new URL('./onboarding-welcome-hero.webp', import.meta.url)), false);
  assert.equal(existsSync(new URL('./onboarding-personal-hero.webp', import.meta.url)), false);
  assert.doesNotMatch(JS, /onboarding-(?:welcome|personal)-hero\.webp/);
  assert.doesNotMatch(SW, /onboarding-(?:welcome|personal)-hero\.webp/);
  assert.doesNotMatch(JS, mediaTag);
  assert.doesNotMatch(CSS, /background(?:-image)?\s*:[^;{}]*url\s*\(/i);
  assert.match(CSS, /Personal — real input-bound profile preview, not an illustration or image/);
  assert.match(CSS, /\.ah-personal-panel\{[^}]*width:min\(calc\(100% - 32px\),980px\)/);
  assert.match(CSS, /@media\(max-width:390px\)[\s\S]+\.ah-signup-progress,.ah-personal-panel\{width:calc\(100% - 24px\)\}/);
  assert.match(CSS, /\.ah-personal-card\{[^}]+border-radius:25px[^}]+background:rgba\(255,255,255,\.94\)/);
  assert.match(CSS, /\.ah-personal-next\{[^}]+min-height:56px[^}]+border-radius:17px/);
  assert.match(CSS, /\.ah-dob-selects\{[^}]+grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
  assert.match(CSS, /@media\(prefers-reduced-motion:reduce\)/);
  assert.doesNotMatch(CSS, /https?:\/\//);
});

test('code-native release markers and fail-closed publication checks are synchronized', () => {
  for (const asset of [`account-access.css?v=${UI_VERSION}`, `account-access.js?v=${UI_JS_VERSION}`]) {
    assert.ok(HTML.includes(asset), asset);
    assert.ok(SW.includes(asset), asset);
  }
  assert.ok(HTML.includes(`expectedSwVersion = '${SHELL_VERSION}'`));
  assert.ok(SW.includes(`const BUILD_ID = '${SHELL_VERSION}'`));
  assert.ok(BUNDLE_GUARD.includes('test ! -e dist/onboarding-welcome-hero.webp'));
  assert.ok(BUNDLE_GUARD.includes('test ! -e dist/onboarding-personal-hero.webp'));
  assert.ok(RELEASE.includes('data-personal-visual-contract="interactive-native-personal-v1"'));
  assert.ok(RELEASE.includes('data-dob-contract="premium-dropdown-dob-v2"'));
  assert.ok(RELEASE.includes('data-media-contract="zero-raster-entry-v1"'));
  assert.ok(RELEASE.includes('setupDobDropdowns'));
  assert.ok(RELEASE.includes('Personal — real input-bound profile preview'));
  assert.ok(RELEASE.includes(`const BUILD_ID = '${SHELL_VERSION}'`));
  assert.doesNotMatch(RELEASE, /fetch_public[^\n]+onboarding-(?:welcome|personal)-hero\.webp/);
});

test('Signup stays AI-free while the ordinary application AI remains shipped', () => {
  assert.doesNotMatch(JS, /\/api\/ai\/chat|data-role="guide|class="ah-guide/);
  assert.doesNotMatch(CSS, /\.ah-guide/);
  // The chat bundle is idle-loaded through index.html's data-ah-src hook, not
  // a plain defer <script>, so the guard asserts the tag that really ships.
  assert.match(HTML, /<script type="application\/x-ah-idle" data-ah-src="\.\/ai-agent-chat\.js\?v=agent-f1-ui-skyv13"><\/script>/);
  assert.match(SW, /\.\/ai-agent-chat\.js\?v=agent-f1-ui-skyv13/);
});
