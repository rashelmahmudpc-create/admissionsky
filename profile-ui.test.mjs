import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const read = (name) => readFileSync(new URL(`./${name}`, import.meta.url), 'utf8');
const UI = read('profile-ui.js');
const CSS = read('profile-ui.css');
const HTML = read('index.html');
const SW = read('sw.js');
const REDIRECTS = read('_redirects');
const DASH = read('dashboard-v2.js');
const DASH_CSS = read('dashboard-v2.css');

const mediaTag = /<(?:img|picture|source|canvas|video|object|embed)(?:\s|>)/i;

test('profile-ui.js is a guarded, zero-raster module with safe rendering', () => {
  assert.match(UI, /window\.__profileUiInstalled/);
  assert.match(UI, /const esc = \(s\)/);
  // default avatar is generated SVG — no remote or bundled raster art
  assert.match(UI, /defaultAvatarSvg/);
  assert.match(UI, /<svg viewBox="0 0 96 96"/);
  assert.match(UI, /data-avatar-contract="zero-raster-avatar-v1"/);
  // no hard-coded remote images of any kind
  assert.doesNotMatch(UI, /src=["']https?:/i);
  // the only <img> is the user's own uploaded avatar (user data, not art)
  const imgCount = (UI.match(/<img class=/g) || []).length;
  assert.equal(imgCount, 2);
});

test('public page renders only public-safe fields', () => {
  const pubStart = UI.indexOf('window.renderPublicProfilePage');
  const pub = UI.slice(pubStart);
  assert.ok(pubStart > 0);
  assert.match(pub, /data-public-contract="public-safe-profile-v1"/);
  assert.match(pub, /displayName/);
  assert.match(pub, /p\.publicId/);
  assert.match(pub, /p\.target/);
  assert.match(pub, /p\.bio/);
  assert.match(pub, /p\.completion/);
  assert.match(pub, /p\.joinedYear/);
  // private fields must never appear in the public render
  for (const privateField of ['mobile', 'dob', 'dateOfBirth', 'school', 'higherInstitution', 'email']) {
    assert.doesNotMatch(pub, new RegExp(privateField, 'i'), `${privateField} leaked into public render`);
  }
  // invalid IDs render a safe not-found view, never a fetch
  assert.match(pub, /AH-\[A-Z2-9\]\{6\}/);
});

test('PATCH uses optimistic versioning with conflict + rate-limit handling', () => {
  assert.match(UI, /profile\/patch/);
  assert.match(UI, /expectVersion: state\.version/);
  assert.match(UI, /err\.status === 409/);
  assert.match(UI, /429/);
});

test('avatar pipeline: native camera/gallery -> crop (zoom+pan) -> 512 JPEG -> save', () => {
  assert.match(UI, /capture="environment"/); // Take Photo opens the DEVICE camera
  assert.doesNotMatch(UI, /getUserMedia/);   // in-app camera UI is banned
  assert.match(UI, /data-role="avatar-file-capture"/);
  assert.match(UI, /data-role="avatar-file-gallery"/);
  assert.match(UI, /data-crop-save-contract="crop-save-v1"/);
  assert.match(UI, /crop-zoom-in/);
  assert.match(UI, /crop-zoom-out/);
  // 5MB source ceiling; the encoded 512px output stays under D1's 2MB row cap
  assert.match(UI, /MAX_SOURCE_BYTES = 5 \* 1024 \* 1024/);
  assert.match(UI, /AVATAR_OUTPUT/);
  assert.match(UI, /profile\/avatar/);
  assert.match(UI, /method: 'DELETE'/);
});

test('completion: official short copy, real fields only (casual banned)', () => {
  assert.match(UI, /data-completion-contract="official-completion-v1"/);
  assert.doesNotMatch(UI, /নিজের ঝামেলায়/);
  assert.doesNotMatch(UI, /এখনই সম্পূর্ণ করো/);
  assert.doesNotMatch(UI, /তোমার প্রোফাইল অসম্পূর্ণ/);
});

test('failure isolation: profile problems never break the app or session', () => {
  assert.match(UI, /pp-fallback/);
  assert.match(UI, /data-role="retry-profile"/);
  assert.match(UI, /session আর ডেটা ঠিক আছে/);
});

test('dynamic context: greeting + section order honored from the server', () => {
  assert.match(UI, /context\?\.greeting/);
  assert.match(UI, /context\?\.sectionOrder/);
  assert.match(UI, /SECTION_RENDER/);
});

test('index.html: Profile tab (6th) wired into bottom nav + router', () => {
  const navStart = HTML.indexOf('const NAV_TABS=[');
  const nav = HTML.slice(navStart, navStart + 900);
  assert.ok(navStart > 0);
  assert.match(nav, /key:'my-profile', icon:'👤', label:'Profile'/);
  // order: after history
  // History এখন Exam-এর ভিতরে — bottom nav-এ শুধু ৪টি core tab।
  assert.ok(!nav.slice(0, nav.indexOf('];')).includes("key:'history'"));
  const entries = nav.slice(0, nav.indexOf('];')).match(/key:'/g) || [];
  assert.equal(entries.length, 4);
  // baseTab highlights the profile tab
  assert.match(HTML, /if\(path==='my-profile'\) return 'my-profile'/);
  // hash route dispatch
  assert.match(HTML, /if\(p==='my-profile'\) return \(window\.renderProfilePage/);
  // Route-name regression: the legacy 'profile' hash route stays RETIRED
  // (redirected to dashboard) — the Profile tab must use a different path.
  assert.match(HTML, /const retiredAccountRoute = p === 'profile' \|\| p\.startsWith\('profile\/'\)/);
  assert.doesNotMatch(HTML, /if\(p==='profile'\)/);
  // pretty pathname URL dispatch
  assert.ok(HTML.includes("/^\\/(AH-[A-Z2-9]{6})\\/?$/"), "pathname dispatch regex missing");
  assert.match(HTML, /window\.renderPublicProfilePage\(pid\)/);
});

test('index.html: profile assets linked with versions (v262)', () => {
  assert.match(HTML, /<link rel="stylesheet" href="\.\/profile-ui\.css\?v=profile-v15-uni-tap">/);
  assert.match(HTML, /<script defer src="\.\/academic-catalog\.js\?v=acad-cat-v2"><\/script>/);
  assert.match(HTML, /<script defer src="\.\/profile-ui\.js\?v=profile-v20-sky-instr"><\/script>/);
});

test('sw.js caches the profile assets (v262)', () => {

  assert.match(SW, /const BUILD_ID = 'v364-sky-goal';/);
  assert.match(SW, /'\.\/academic-catalog\.js\?v=acad-cat-v2',/);
  assert.match(SW, /'\.\/profile-ui\.js\?v=profile-v20-sky-instr',/);
  assert.match(SW, /'\.\/profile-ui\.css\?v=profile-v15-uni-tap',/);
});

test('every versioned shell asset is pinned identically in index.html and sw.js', () => {
  // index.html and sw.js both carry the cache token for each shell asset. When
  // one is bumped and the other is not, the service worker precaches a URL the
  // page never requests (and vice versa), so the old file keeps being served
  // from cache. Nothing else compares the two lists, so pin them here.
  const versionsOf = (src, name) =>
    new Set([...src.matchAll(new RegExp(name + '\\?v=([a-z0-9-]+)', 'g'))].map(m => m[1]));
  for (const name of ['profile-ui\\.js', 'profile-ui\\.css', 'academic-catalog\\.js', 'dashboard-v2\\.js', 'session-persist\\.js']) {
    const inHtml = versionsOf(HTML, name);
    const inSw = versionsOf(SW, name);
    assert.equal(inHtml.size, 1, `${name} must carry exactly one version in index.html, saw ${[...inHtml]}`);
    assert.equal(inSw.size, 1, `${name} must carry exactly one version in sw.js, saw ${[...inSw]}`);
    assert.deepEqual([...inSw], [...inHtml], `${name} version differs between index.html and sw.js`);
  }
});

test('v262: academic catalog engine — official per-university+session units (no generic A/B/C/D)', () => {
  const CAT = read('academic-catalog.js');
  // maintainable data layer, versioned, official sources cited
  assert.match(CAT, /ah-acad-catalog-v1/);
  assert.match(CAT, /admission\.cu\.ac\.bd/);
  assert.match(CAT, /admission\.ru\.ac\.bd/);
  assert.match(CAT, /apply\.ku\.ac\.bd/);
  // CU 2025-26 = A, B, B1, B2, C, D, D1 (official) — RU = A, B, C
  assert.match(CAT, /cu: \{ A: U\('A'/);
  assert.match(CAT, /B1: U\('B1'/);
  assert.match(CAT, /ru: \{ A: U\('A', 'sciencePhysics'\), B: U\('B', 'commerce'\), C: U\('C', 'humanities'\) \}/);
  // BUET/IUT have NO unit system — a single admission entry, never A/B/C/D
  assert.match(CAT, /buet: \{ BUET: U\('BUET'/);
  assert.match(CAT, /iut: \{ IUT: U\('IUT'/);
  // API surface for the UI selectors
  for (const fn of ['listSessions', 'searchUniversities', 'getUniversity', 'unitsFor', 'unitFor', 'subjectsFor', 'groupLabel']) {
    assert.match(CAT, new RegExp(`function ${fn}\\(`), `${fn} missing`);
  }
  // the UI consumes the catalog — no hardcoded unit arrays in profile-ui.js
  assert.match(UI, /window\.AH_AcademicCatalog/);
  assert.match(UI, /acadCat\(\)/);
  assert.match(UI, /data-acad-catalog-contract="catalog-driven-units-v1"/);
  // Bangla + English alias search
  assert.match(CAT, /ঢাকা/);
  assert.match(CAT, /চট্টগ্রাম/);
});

test('v262: academic session select reaches the draft (false "already saved" killed)', () => {
  // the session <select> must have a change listener bound on every render
  assert.match(UI, /pp-acad-session/);
  assert.match(UI, /sessSel\) sessSel\.addEventListener\('change'/);
  // The draft stores the CANONICAL 4-digit year, never the catalog label
  // ('2025-26'): the server validates /^(19|20|21)\d{2}$/ and rejected the
  // whole academic save with INVALID_INPUT (owner: "profile reverts to blank").
  assert.match(UI, /d\.session = canonicalYear\(sessSel\.value\)/);
  assert.match(UI, /const canonicalYear = /);
  // the <select> itself submits canonical years, so value/state never diverge
  assert.match(UI, /esc\(canonicalYear\(s\.id\)\)/);
  // unit change re-validates the subject selection (owner spec)
  assert.match(UI, /acadInvalidateSubjects/);
  assert.match(UI, /unitSel\.addEventListener\('change'/);
  // university search suggestions from the catalog
  assert.match(UI, /updateUniSuggestions/);
  assert.match(UI, /acad-pick-uni/);
  // priority targets — reorderable
  assert.match(UI, /acad-move-target/);
});

test('v262: chip attributes render on the element, never as text (owner bug)', () => {
  // chip() puts `extra` on the span tag itself
  assert.match(UI, /const chip = \(label, xrole, extra\) => `<span class="pp-chip pp-chip-lg"\$\{extra \|\| ''\}>\$\{label\}<button/);
  // no leftover pattern where attributes were spliced AFTER the label text
  assert.doesNotMatch(UI, /<span class=\"pp-chip pp-chip-lg\">\$\{label\}\$\{extra/);
});

test('v262: instant profile — persistent cache, background sync, offline PENDING_SYNC', () => {
  assert.match(UI, /ah-profile-cache:/);
  assert.match(UI, /profileCacheRead\(\)/);
  assert.match(UI, /profileCacheWrite\(body\)/);
  // a valid cache is never overwritten with null
  assert.match(UI, /never clobber with null/);
  // offline edits queue and flush when the network returns
  assert.match(UI, /PENDING_SYNC/);
  assert.match(UI, /flushProfileQueue/);
  assert.match(UI, /addEventListener\('online'/);
  // cache cleared on logout (privacy — next user never sees this user's data)
  assert.match(UI, /profileCacheClear\(\)/);
});

test('v262: DOB canonical store + localized Bangla display; server accepts dob/school/higherInstitution patch', () => {
  assert.match(UI, /bnDob/);
  assert.match(UI, /data-role="dob-preview"/);
  const ENGINE = read('auth-native/core/auth-engine.mjs');
  assert.match(ENGINE, /key === 'dob'/);
  assert.match(ENGINE, /key === 'school' \|\| key === 'higherInstitution'/);
  // DOB shares the signup age window (8-80) instead of a fixed year ceiling:
  // the old `y > 2020` drifted with the calendar and silently rejected
  // legitimate young students' dates of birth.
  assert.match(ENGINE, /age < 8 \|\| age > 80/);
  assert.doesNotMatch(ENGINE, /y > 2020/);
  // email surfaces on the private /profile route for the read-only row
  const HANDLER = read('auth-native/worker/public-auth-handler.mjs');
  assert.match(HANDLER, /email: current\.user\.email \|\| null/);
});

test('_redirects serves /AH-* to the SPA', () => {
  assert.match(REDIRECTS, /^\/AH-\* \/ 200/m);
});

test('dashboard avatar is the top entry point to the Profile tab', () => {
  assert.match(DASH, /dv2-avatar-tap/);
  assert.match(DASH, /dv2-avatar-tap[\s\S]{0,140}my-profile/);
  assert.match(DASH_CSS, /\.dv2-avatar-tap\{cursor:pointer\}/);
});

test('dashboard header upgrades to the uploaded avatar, cached by version', () => {
  assert.match(DASH, /window\.__ahAvatarUrl/);
  assert.match(DASH, /dv2-avatar-img/);
  assert.doesNotMatch(DASH, /src="\/api\/auth\/v1\/profile\/avatar"/, 'the dashboard must use the version-scoped URL, not a bare one');
  assert.match(DASH_CSS, /\.dv2-avatar-img\{position:absolute/);
});

test('avatar URL is version-scoped, never cache-busted per render', () => {
  // The old `?ts=Date.now()` forced a re-download on every render; the fix keys
  // the URL on avatar.updatedAt so the browser caches it.
  assert.match(UI, /\$\{API\}\/profile\/avatar\?v=\$\{avatarVersion\(\)\}/);
  assert.doesNotMatch(UI, /profile\/avatar\?ts=/);
});

test('service worker caches the versioned avatar instead of forcing no-store', () => {
  // The blanket `cache: 'no-store'` on /api/auth/ re-downloaded the photo on
  // every render, which is the "বারবার লোডিং" the owner saw. The avatar has its
  // own cache-first branch, keyed by the versioned URL.
  assert.match(SW, /const AVATAR_CACHE = 'admission-hub-avatar-v1';/);
  assert.match(SW, /requestUrl\.pathname === '\/api\/auth\/v1\/profile\/avatar'/);
  assert.match(SW, /await caches\.open\(AVATAR_CACHE\)/);
  // Cache-first: it must return the cached copy before touching the network.
  const branch = SW.slice(SW.indexOf("=== '/api/auth/v1/profile/avatar'"));
  const put = branch.indexOf('cache.put');
  assert.ok(branch.indexOf('if (cached) return cached;') < put, 'cache hit must short-circuit the fetch');
});

test('profile css: bottom sheet, toast, skeleton, 320px-safe wrap', () => {
  assert.match(CSS, /\.pp-sheet-backdrop \{ position: fixed/);
  assert.match(CSS, /safe-area-inset-bottom/);
  assert.match(CSS, /\.pp-skel/);
  assert.match(CSS, /max-width: 520px/);
  assert.match(CSS, /prefers-reduced-motion/);
});

test('profile chrome is code-native: no raster art classes in CSS', () => {
  assert.doesNotMatch(CSS, /url\(\s*["']?\.\/.*\.(png|jpe?g|webp)/i);
});

test('V2: identity space sections all present (hero, stats, academic, journey, achievements, prefs, privacy, edit, avatar)', () => {
  assert.match(UI, /pp-hero-row/);
  assert.match(UI, /Admission Candidate/);
  assert.match(UI, /pp-stats/);
  assert.match(UI, /Day Streak/);
  assert.match(UI, /pp-academic/);
  assert.match(UI, /TARGET UNIVERSITIES/);
  assert.match(UI, /ADMISSION SESSION/);
  assert.match(UI, /ACADEMIC GOAL/);
  assert.match(UI, /PREFERRED SUBJECTS/);
  assert.match(UI, /Your Journey/);
  assert.match(UI, /First Mock/);
  assert.match(UI, /Admission Ready/);
  assert.match(UI, /pp-ach-list/);
  assert.match(UI, /Preferences/);
  assert.match(UI, /Privacy &amp; Visibility/);
  assert.match(UI, /pp-switch/);
  assert.match(UI, /Edit Profile/);
  assert.match(UI, /Change Avatar/);
  assert.match(UI, /Change Photo/);
  assert.match(UI, /Save Changes/);
});

test('V2: stats strip reads real local study data (never faked)', () => {
  assert.match(UI, /window\.CACHE/);
  assert.match(UI, /window\.computeStreak/);
  assert.match(UI, /examResults/);
  assert.match(UI, /r\?\.mode === 'mock'/);
  // honest empty state, no invented numbers
  assert.match(UI, /'—'/);
});

test('V2: Academic Identity — dedicated edit page, multi-field save in one PATCH', () => {
  assert.match(UI, /acad-save/);
  assert.match(UI, /acad-add-target/);
  assert.match(UI, /acad-del-target/);
  assert.match(UI, /acad-add-subject/);
  assert.match(UI, /acad-del-subject/);
  assert.match(UI, /pp-acad-session/);
  assert.match(UI, /pp-acad-goal/);
  assert.match(UI, /saveAcademicPage/);
  assert.match(UI, /academicDraftInit/);
  assert.match(UI, /open-academic/);
  // only-changed-fields single PATCH — single source of truth
  assert.match(UI, /fields\.targets = targets/);
  assert.match(UI, /fields\.admissionSession = session/);
  assert.match(UI, /fields\.academicGoal = goal/);
  assert.match(UI, /fields\.subjects = subjects/);
});

test('V2: journey + achievements are honest (real data only, no XP, no fake unlock)', () => {
  assert.match(UI, /real milestones/i);
  assert.match(UI, /কোনো fake progress নেই/);
  assert.doesNotMatch(UI, /\+ *\d+ *XP/i);
  assert.match(UI, /journeyMilestones/);
  assert.match(UI, /ACHIEVEMENTS/);
});

test('V2: preferences = centralized i18n + 4-theme appearance + AI personalization (blueprint §16-20)', () => {
  assert.match(UI, /ah-profile-prefs-v1/);
  assert.match(UI, /loadPrefs/);
  assert.match(UI, /savePrefs/);
  assert.match(UI, /pref-notifications/);
  // language is a real whole-app switch (no more "coming soon")
  assert.doesNotMatch(UI, /শীঘ্রই আসছে/);
  assert.match(UI, /pick-language/);
  assert.match(UI, /AhI18n/);
  // appearance: light/dark/system/premium green via the global engine
  assert.match(UI, /AhAppearance/);
  assert.match(UI, /'green', 'Premium Green'/);
  // AI Assistant ENABLED toggle is gone; replaced by per-user AI Personalization
  assert.doesNotMatch(UI, /pref-ai/);
  assert.match(UI, /open-ai-prefs/);
  assert.match(UI, /data-ai-prefs-contract="ai-personalization-v1"/);
  assert.match(UI, /pick-ai-style/);
  assert.match(UI, /pick-ai-tone/);
  assert.match(UI, /pick-ai-len/);
  // M7: the memory toggle is gone — memory is automatic and has no UI switch.
  assert.doesNotMatch(UI, /toggle-ai-memory/);
  assert.doesNotMatch(UI, /Conversation Memory/);
  assert.match(UI, /\/api\/ai\/prefs/);
});

test('V2: edit page validates before patching; avatar page = single screen (Take Photo / Gallery / Defaults)', () => {
  assert.match(UI, /saveEditPage/);
  assert.match(UI, /pp-edit-name/);
  assert.match(UI, /pp-edit-dob/);
  assert.match(UI, /pp-edit-bio/);
  assert.match(UI, /pick-default-avatar/);
  assert.match(UI, /av-capture-open/);
  assert.match(UI, /Take Photo/);
  assert.match(UI, /Choose from Gallery/);
  // two gender tabs (male/female) over 10 strong defaults each, zero raster
  assert.match(UI, /pick-avatar-gender/);
  assert.match(UI, /avatarGender/);
  assert.match(UI, /defaultAvatarSvg\(state\.data\?\.profile\?\.fullName/);
});

test('FINAL REBUILD: header clean (no ✓ badge / no pencil) + email read-only row + dirty-state Save', () => {
  assert.doesNotMatch(UI, /pp-verified/);
  assert.doesNotMatch(UI, /✏️/);
  assert.match(UI, /data-email-row-contract="email-readonly-v1"/);
  assert.match(UI, /Not editable/);
  assert.match(UI, /data-save-engine-contract="central-save-v1"/);
  assert.match(UI, /refreshEditDirty/);
  assert.match(UI, /pp-save-dirty/);
});

test('hotfix: bnYear maps all 10 digits via code points (no "undefined" regression)', () => {
  // digit table generated from U+09E6..U+09EF — structurally complete
  assert.match(UI, /String\.fromCharCode\(0x09E6 \+ i\)/);
  assert.match(UI, /BN_DIGITS\[d\]/);
  const BN_DIGITS = Array.from({ length: 10 }, (_, i) => String.fromCharCode(0x09E6 + i));
  const bnYear = (y) => String(y == null ? '' : y).replace(/[0-9]/g, (d) => BN_DIGITS[d]);
  assert.equal(bnYear(2026), '\u09E8\u09E6\u09E8\u09EC'); // ২০৬
  assert.equal(bnYear('1789'), '\u09E7\u09ED\u09EE\u09EF'); // ১৭৯
  assert.equal(bnYear(null), '');
  assert.ok(!String(bnYear(2026)).includes('undefined'));
});

test('7B3: auth gate — AUTH_LOADING shows skeleton (never guest); guest only after the check COMPLETES', () => {
  // old "no skeleton" directive superseded by master prompt Phase U/V:
  // skeleton is required during loading; guest is forbidden until AUTH_CHECK_COMPLETE.
  assert.match(UI, /function authGate\(\)/);
  assert.match(UI, /data-auth-gate="loading"/);
  assert.match(UI, /Login যাচাই হচ্ছে/);
  assert.match(UI, /st === 'UNAUTHENTICATED'\) return 'guest'/);
  assert.match(UI, /admissionhub:authchange/);
  assert.match(UI, /bindAuthGate/);
});

test('hotfix: hero layout resilience — critical styles shipped inline with the page', () => {
  assert.match(UI, /CRITICAL_CSS/);
  assert.match(UI, /<style>\$\{CRITICAL_CSS\}<\/style>/);
  assert.match(UI, /\.pp-hero-avatar\{[^}]*width:72px[^}]*height:72px/);
});

test('V2: emerald visual language, no indigo remnant in profile chrome', () => {
  assert.match(CSS, /--pp-emerald: #0f6b4f/);
  assert.doesNotMatch(CSS, /#4c7af8/);
});

test('floating account launcher removed; Profile tab is the single account entry point', () => {
  const ACC = read('account-access.js');
  // the launcher element is never attached to the document body
  assert.doesNotMatch(ACC, /document\.body\.append\(launcher/);
  assert.match(ACC, /document\.body\.append\(pageHost\)/);
  // the profile page carries the account entry card + public API opener
  assert.match(UI, /data-account-card-contract="profile-account-entry-v1"/);
  assert.match(UI, /role === 'open-account'/);
  assert.match(UI, /acct\.open\(\)/);
  // guests still get a Sign In path
  assert.match(UI, /data-role="guest-signin"/);
});

/* ------------------------------------------------------------------ */
/* Profile V2 STRICT REBUILD (master prompt) — acceptance tests        */
/* ------------------------------------------------------------------ */

const INDEX = read('index.html');
const ACC = read('account-access.js');
const ENGINE = read('auth-native/core/auth-engine.mjs');

test('7B2: hero is the LIGHT reference design (dark text on mint, code-native wash, emerald edit button)', () => {
  assert.match(CSS, /\.pp-hero \{[^}]*background: linear-gradient\(160deg, #f2fbf6/);
  assert.match(CSS, /\.pp-hero \{[^}]*color: #0c3b2a/);
  assert.match(CSS, /\.pp-hero-edit \{[^}]*background: linear-gradient\(150deg, #16a34a, #15803d\); color: #fff/);
  assert.match(CSS, /\.pp-hero-avatar \{[^}]*border: 3px solid #16a34a/);
  // dark-emerald hero gradient is gone
  assert.doesNotMatch(CSS, /#0f6b4f 0%, #17845f 55%/);
  // hero wash is code-native SVG (no raster)
  assert.match(UI, /HERO_WASH/);
  assert.match(UI, /<svg class="pp-hero-wash"/);
  assert.doesNotMatch(UI, /pp-hero[^\n]*<img/);
});

test('7B2: guest profile — no fake identity, 3 CTAs (Google / Log in / Sign up) + benefits', () => {
  assert.match(UI, /data-guest-contract="guest-profile-v2"/);
  assert.match(UI, /Your Profile/);
  assert.match(UI, /Sign in to create your profile/);
  assert.match(UI, /data-guest-google-contract="guest-google-cta-v1"/);
  assert.match(UI, /Continue with Google/);
  assert.match(UI, /data-role="guest-signin"[^>]*>Log in</);
  assert.match(UI, /data-role="guest-create"[^>]*>Sign up</);
  assert.match(UI, /With your profile, you can:/);
  const benefits = UI.match(/pp-guest-benefits[\s\S]{0,400}?<ul>/);
  assert.ok(benefits, 'benefits list present');
  const list = UI.slice(UI.indexOf('const benefits = ['), UI.indexOf('];', UI.indexOf('const benefits = [')));
  assert.match(list, /progress save/);
  assert.match(list, /Exam history/);
  assert.match(list, /Academic profile/);
  assert.match(list, /Leaderboard/);
  assert.match(list, /personalized/);
  // zero fake data: no demo names/avatars/stats anywhere in the profile layer
  for (const hay of [UI, CSS, INDEX]) {
    assert.doesNotMatch(hay, /Rasel Ahmed/);
    assert.doesNotMatch(hay, /12\+ streak/i);
    assert.doesNotMatch(hay, /245 MCQ/i);
  }
});

test('7B2: save button state machine — SAVE → SAVING… → SUCCESS ✓ / FAILED → Try Again, double-tap guard', () => {
  assert.match(UI, /SAVE CHANGES → SAVING… → SUCCESS/);
  assert.match(UI, /btn.textContent = 'Saving…'/);
  assert.match(UI, /btn.textContent = 'SUCCESS ✓'/);
  assert.match(UI, /btn.textContent = 'Try Again'/);
  assert.match(UI, /if \(state\.busy\) return; \/\/ double-tap guard/);
  assert.match(CSS, /\.pp-save-busy/);
  assert.match(CSS, /\.pp-save-ok/);
  assert.match(CSS, /\.pp-save-fail/);
});

test('7B2: Academic Identity is a dedicated edit page (targets/session/goal/subjects + single Save Changes)', () => {
  assert.match(UI, /function academicPageMarkup/);
  assert.match(UI, /pp-acad-sec/);
  assert.match(UI, /Target Universities/);
  assert.match(UI, /Admission Session/);
  assert.match(UI, /Academic Goal/);
  assert.match(UI, /Preferred Subjects/);
  assert.match(UI, /data-role="acad-save"[^>]*>Save Changes</);
  assert.match(CSS, /\.pp-acad-sec \{ padding: 16px/);
});

test('7B3: 16px content padding via .page (double padding killed) + app-like scrolling, no visible scrollbar', () => {
  assert.match(CSS, /\.pp-wrap \{ position: relative; padding: 0 0 8px/);
  assert.match(UI, /\.pp-wrap\{max-width:640px;margin:0 auto;padding:0 0 8px\}/);
  assert.match(INDEX, /\.page\{padding:18px 16px 30px\}/);
  assert.match(INDEX, /scrollbar-width:none/);
  assert.match(INDEX, /::-webkit-scrollbar\{width:0;height:0;display:none;\}/);
});

test('7B2: achievements = icon/title/status/progress/reward rows, real data only, honest empty state', () => {
  assert.match(UI, /data-achievements-contract="achv-progress-v1"/);
  assert.match(UI, /mistake-crusher/);
  assert.match(UI, /m\.mastered === true/);
  assert.match(UI, /data-role="achievements-empty"/);
  assert.match(UI, /প্রথম achievement-এর জন্য practice শুরু করুন/);
  // progress model incl. the blueprint example (500 MCQs — Complete 500 MCQs)
  assert.match(UI, /'500 MCQs'/);
  assert.match(UI, /target: 500/);
  assert.match(UI, /Reward: /);
  assert.match(UI, /pp-ach-status/);
  assert.match(UI, /pp-ach-bar/);
  assert.doesNotMatch(UI, /Top 10%/); // rankings we cannot compute are never faked
});

test('7B2: stats show real 0s once data is ready (never stale "—" after boot)', () => {
  assert.match(UI, /__admissionBootStatus/);
  assert.match(UI, /x == null \|\| !s\.ready/);
  assert.match(UI, /data-role="stats-note"/);
});

test('7B2: signup collects mobile and the server full-save accepts it (one source of truth)', () => {
  assert.match(ACC, /id="ah-signup-mobile"/);
  assert.match(ACC, /const normalizedMobile = /);
  assert.match(ACC, /mobile: normalizedMobile\(\)/);
  assert.match(ACC, /data-role="mobile-feedback"/);
  assert.match(ENGINE, /mobile: mobile \|\| ''/);
  assert.ok(ENGINE.includes('mobile && !/^\\+?[0-9]{8,15}$/.test(mobile)'), 'server mobile validation');
});

/* ------------------------------------------------------------------ */
/* Phase 7B3 — EMERGENCY STABILIZATION acceptance tests               */
/* ------------------------------------------------------------------ */

test('7B3: PHASE I/H — every profile request has a timeout and ONE retry, never an infinite hang', () => {
  assert.match(UI, /API_TIMEOUT_MS = 8000/);
  assert.match(UI, /new AbortController\(\)/);
  assert.match(UI, /attempt < 2/);
  assert.match(UI, /networkLike && attempt === 0/);
});

test('7B3: PHASE H — delegated handlers bind once per host (no duplicate clicks/saves)', () => {
  assert.match(UI, /const boundHosts = new WeakSet\(\)/);
  assert.match(UI, /if \(!boundHosts\.has\(root\)\)/);
  assert.match(UI, /boundHosts\.add\(root\)/);
});

test('7B3: PHASE M — save does WRITE → CONFIRM → READ-BACK → UI', () => {
  assert.match(UI, /PHASE M — READ-BACK/);
  assert.match(UI, /await loadProfile\(\);/);
});

test('7B3: PHASE J — per-section error boundary (one broken section never blanks the page)', () => {
  assert.match(UI, /const safeSection = /);
  assert.match(UI, /pp-section-error/);
  assert.match(UI, /safeSection\('achievements', achievementsCard\)/);
  assert.match(CSS, /\.pp-section-error/);
});

test('7B3: avatar circular everywhere + premium crop (pinch/pan) -> 512x512', () => {
  assert.match(CSS, /\.pp-avatar-img \{[^}]*border-radius: 50%/);
  // premium stage: square, touch-driven, with rule-of-thirds guides + circular mask
  assert.match(CSS, /\.pp-crop-premium \.pp-crop-stage \{[^}]*aspect-ratio: 1 \/ 1/s);
  assert.match(CSS, /\.pp-crop-premium \.pp-crop-stage \{[^}]*touch-action: none/s);
  assert.match(CSS, /\.pp-crop-guides \{/);
  assert.match(CSS, /\.pp-crop-mask \{/);
  assert.match(CSS, /\.pp-crop-zoomrange::-webkit-slider-thumb/);
  assert.match(UI, /\.pp-avatar-img\{[^}]*border-radius:50%\}/);
  assert.match(UI, /canvas\.width = AVATAR_OUTPUT/);
  assert.match(UI, /clampCropPan/);
  assert.match(UI, /setCropZoom/);
  assert.match(UI, /crop\.pointers/, 'pinch zoom must track active pointers');
  assert.match(UI, /data-crop-contract="premium-crop-v2"/);
  assert.match(UI, /data-avatar-hint-contract="square-crop-v1"/);
});

test('7B3: PHASE Q — brand row on profile home, no double topbar, #app wider on desktop', () => {
  assert.match(UI, /function brandHeader\(\)/);
  assert.match(UI, /data-brand-contract="profile-brand-row-v1"/);
  assert.match(UI, /Your Admission\. Our Mission\./);
  assert.match(UI, /shell\(profileViewMarkup\(\), \{ topbar: false \}\)/);
  assert.match(INDEX, /#app\{max-width:760px/);
});

test('7B3: PHASE A/D — account auth state notifies on every transition (observable authority)', () => {
  assert.match(ACC, /Phase 7B3 \(AUTH STABLE\)/);
  assert.match(ACC, /setSessionState = to => \{[\s\S]{0,900}try \{ notify\(\); \}/);
  assert.match(ACC, /admissionhub:authchange/);
});

test('7B3: PHASE P — Preferences & Privacy are dedicated pages (reference), save works, success modal on save', () => {
  assert.match(UI, /function prefsPageMarkup\(\)/);
  assert.match(UI, /function privacyPageMarkup\(\)/);
  assert.match(UI, /pp-topbar-title">Preferences</);
  assert.match(UI, /Privacy &amp; Visibility/);
  assert.match(UI, /What will be visible\?/);
  assert.match(UI, /data-role="prefs-save"/);
  assert.match(UI, /data-role="open-privacy-page"/);
  assert.match(UI, /function successModal\(\)/);
  assert.match(UI, /Profile updated successfully!/);
  assert.match(UI, /Your changes have been saved\./);
  assert.match(UI, /state.showSuccessModal = true/);
  assert.match(CSS, /\.pp-modal-backdrop/);
  assert.match(CSS, /\.pp-priv-visible/);
});

test('7B3: signup → profile automatic (client sends name+mobile+dob+school+college in one canonical write)', () => {
  // collectProfile carries every signup field; the server full-save accepts mobile
  assert.match(ACC, /mobile: normalizedMobile\(\)/);
  assert.match(ACC, /fullName: normalizedName\(\)/);
  assert.match(ACC, /dob: selectedDob\(\)/);
  assert.match(ACC, /school: Object\.freeze\(\{ \.\.\.state\.institutionSelection\.school \}\)/);
  assert.match(ACC, /higherInstitution: state\.institutionSelection\.college/);
  assert.match(ACC, /api\(pending \? '\/profile\/pending' : '\/profile',/);
});

test('7B3: Google login seeds empty profile fields only (server, verified data, never overwrites)', () => {
  const HANDLER = read('auth-native/worker/public-auth-handler.mjs');
  const PROVIDER = read('auth-native/providers/firebase-auth.mjs');
  assert.match(HANDLER, /seedGoogleProfile/);
  assert.match(HANDLER, /isGoogleAvatarUrl/);
  assert.match(HANDLER, /looksLikeName/);
  assert.match(HANDLER, /Never overwrites anything the student already set/);
  assert.match(PROVIDER, /displayName: typeof user\.displayName === 'string'/);
  assert.match(PROVIDER, /photoUrl: typeof user\.photoUrl === 'string'/);
  // non-Google avatar URLs are refused (SSRF guard)
  assert.match(HANDLER, /GOOGLE_AVATAR_HOSTS/);
});

test('v263: truncated-script self-heal (owner bug: "SyntaxError: Unexpected EOF" pill)', () => {
  // the global crash handler detects parse errors on .js assets and reloads once
  assert.match(HTML, /Unexpected \(EOF\|end of input\)/);
  assert.match(HTML, /ah-script-reload/);
  assert.match(HTML, /Date\.now\(\) - last > 60000/);
  assert.match(HTML, /location\.reload\(\)/);
  // friendly Bengali message if the truncation repeats within the guard window
  assert.match(HTML, /অসম্পূর্ণ এসেছে/);
  // service worker bounds static-asset fetches (no infinite hang on stalled links)
  assert.match(SW, /STATIC_ASSET_TIMEOUT_MS = 20000/);
  assert.match(SW, /controller\.abort\(\), STATIC_ASSET_TIMEOUT_MS/);
});

test('v264: poisoned-cache fix — asset re-pin, no-store SW fetch, digest-verified precache', () => {
  // New cache keys for every shell asset (device HTTP/SW caches held a
  // truncated copy from the network-blip window — new URL = clean fetch).
  assert.match(HTML, /profile-ui\.js\?v=profile-v20-sky-instr/);
  assert.match(HTML, /profile-ui\.css\?v=profile-v15-uni-tap/);
  assert.match(HTML, /academic-catalog\.js\?v=acad-cat-v2/);
  assert.match(HTML, /dashboard-v2\.js\?v=dash2f18-chrome/);
  assert.match(HTML, /session-persist\.js\?v=session-v2/);
  // SW runtime asset fetches never consult the browser HTTP cache
  assert.match(SW, /fetch\(request, \{ cache: 'no-store', signal: controller\.signal \}\)/);
  // Generated digest manifest — a truncated download can never be precached
  assert.match(SW, /sw-manifest:start/);
  assert.match(SW, /sw-manifest:end/);
  assert.match(SW, /blob\.digest\('SHA-256'\)/);
  assert.match(SW, /hex !== expected/);
});

test('v265: parse-error pill never tells the user to refresh a real code defect', () => {
  // A parse error on a .js asset has two causes: a truncated download (a
  // reload really fixes it) or a syntax defect in the file (a reload never
  // fixes it). The handler must re-fetch and parse the server copy to tell
  // them apart, instead of blaming the network and telling the user to refresh.
  assert.match(HTML, /err-script-defect/);
  assert.match(HTML, /new Function\(text\)/);
  assert.match(HTML, /cache: 'no-store'/);
  // the defect branch must NOT claim the file was incomplete or that a
  // refresh will fix it
  assert.doesNotMatch(HTML, /fname \+ ' অসম্পূর্ণ এসেছে/);
  assert.doesNotMatch(HTML, /ইন্টারনেট সংযোগে সমস্যা — ' \+ fname/);
});
