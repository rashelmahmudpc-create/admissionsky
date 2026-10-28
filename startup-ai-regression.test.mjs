// current-shell/chatv14-guest — iPhone fast-start + single-frame composer + full AI response guard
import { readFileSync } from 'node:fs';

const H = readFileSync('index.html', 'utf8');
const DP = readFileSync('data-protection.js', 'utf8');
const SW = readFileSync('sw.js', 'utf8');
const NW = readFileSync('notification-worker.js', 'utf8');
const DASH = readFileSync('dashboard-v2.js', 'utf8');
const AI = readFileSync('ai-agent-chat.js', 'utf8');
let pass = 0;
let fail = 0;
function test(name, condition) {
  if (condition) { pass += 1; console.log('  ✓', name); }
  else { fail += 1; console.error('  ✗', name); }
}

const bootBlock = (H.match(/async function boot\(\)\{[\s\S]*?\n\}/) || [''])[0];
const coordinator = (H.match(/const startFinalRender = \(options\) => \{[\s\S]*?else modulesParsed\(\);/) || [''])[0];
const appShellBlock = (SW.match(/const APP_SHELL = \[[\s\S]*?\n\];/) || [''])[0];
const shellAssets = [...appShellBlock.matchAll(/^\s*['"]\.\/[^'"]+['"],?$/gm)].length;
const dashboardTag = H.indexOf('./dashboard-v2.js?v=dash2f18-chrome');
const firstOptionalTag = H.indexOf('qbank-redesign.js?v=practice15');

/* Startup deadline and race fix */
test('১. unwanted slow/recovery screen text is absent from production HTML',
  !H.includes('একটু বেশি সময় লাগছে') && !H.includes('showGentleRecovery') && !H.includes('showStorageRecovery'));
test('২. watchdog opens a normal usable shell before 5 seconds',
  /__admissionSplashWatchdog=setTimeout\(openUsableShell,(\d+)\)/.test(H) && Number((H.match(/__admissionSplashWatchdog=setTimeout\(openUsableShell,(\d+)\)/) || [])[1]) <= 4500 && H.includes('data-admission-usable="true"'));
test('৩. boot no longer lies that deferred modules are ready',
  bootBlock.includes("window.__admissionFinalModulesReady=false") && !bootBlock.includes("window.__admissionFinalModulesReady=true"));
test('৪. boot-ready and dashboard-ready can each trigger final render without window.load',
  coordinator.includes("window.addEventListener('admission:boot-ready',startFinalRender)") && coordinator.includes("document.addEventListener('DOMContentLoaded',modulesParsed") && DASH.includes('window.__admissionDashboardModuleReady = true'));
test('৫. dashboard first-interaction module is ordered before optional tools', dashboardTag > -1 && dashboardTag < firstOptionalTag);
test('৫a. later phase12 code cannot replace dashboard-v2 with another loader',
  readFileSync('phase12-ui.js', 'utf8').includes('if (!window.__dashboardV2Installed)'));
test('৫b. startup has no retired identity gate or token-dependent paint',
  !/ahAuthGate|ahPubToken|premium-auth|accounts\.google\.com/.test(H));
test('৬. stalled Safari IndexedDB open is bounded at 3 seconds and never clears data',
  H.includes("openTimer=window.setTimeout(()=>fail(new Error('IndexedDB open timed out; existing data was left untouched')),3000)") && !bootBlock.includes('dbClear('));
test('৭. startup readonly reads bypass the write queue and can run together', H.includes("return mode==='readonly' ? execute() : queueDb(execute)"));
test('৮. settings normalization is deferred off first paint', H.includes('Deferred settings normalization skipped.') && H.includes("requestIdleCallback(persist,{timeout:6000})"));
test('৯. removed-route cleanup is UI-only and no longer purges vocabulary/settings/progress',
  !H.includes('purgeRemovedData') && !H.includes("dbClear('vocabulary')") && H.includes('Removed feature data is deliberately retained'));

/* Data-protection startup cost */
const prepareBlock = (DP.match(/async function prepareOpen[\s\S]*?\n  \}/) || [''])[0];
test('১০. prepareOpen is metadata-only (no IndexedDB snapshot/health scan)',
  prepareBlock.includes('readSnapshots()') && !prepareBlock.includes('await snapshot(') && !prepareBlock.includes('localStorageHealth()'));
test('১১. protection snapshot runs as idle post-boot work',
  DP.includes("global.addEventListener('admission:boot-ready', scheduleBootSnapshot") && DP.includes('requestIdleCallback(run, { timeout: 12000 })'));

/* PWA lifecycle */
test('১২. build/cache/static-Welcome and main-app AI versions are synchronized',

  (() => {
    const m = H.match(/const expectedSwVersion = '([^']+)'/);
    const build = m && m[1];
    /* sw.js must be registered WITHOUT a ?v= query: a versioned JS URL matches
       the `/*.js?v=*` immutable rule in _headers and pins an old worker on every
       device forever (owner bug 2026-10-13 — recurring ERR_FAILED). Only the
       bare path gets the no-store rule. */
    return Boolean(build) && SW.includes(`const BUILD_ID = '${build}'`) &&
      H.includes("register('./sw.js',{scope:'./',updateViaCache:'none'})") &&
      !/register\('\.\/sw\.js\?v=/.test(H);
  })() &&
  /* The shell must precache the exact account-access build the page loads; a
     drift here silently leaves the offline shell on an older UI (found during
     the 2026-10-12 audit: shell pinned v…-static-welcome-lock3 while the page
     loaded v…-kbsafe1). */
  (() => {
    /* The page and the precache must agree per asset. They no longer share one
       version string: the CSS and the JS are re-pinned independently, so a
       combined match compared the CSS version against the JS entry. */
    const loadedCss = H.match(/account-access\.css\?v=([^"']+)/);
    const loadedJs = H.match(/account-access\.js\?v=([^"']+)/);
    return Boolean(loadedCss && loadedJs) &&
      SW.includes(`account-access.css?v=${loadedCss[1]}`) &&
      SW.includes(`account-access.js?v=${loadedJs[1]}`);
  })() &&
  H.includes('ai-agent-chat.js?v=agent-f1-ui-skyv13') && SW.includes('ai-agent-chat.js?v=agent-f1-ui-skyv13'));
test('১৩. service-worker activation never navigates or reloads open clients',
  !SW.includes('c.navigate(c.url)') && !SW.includes("self.clients.matchAll({ type: 'window', includeUncontrolled: true });\n      for"));
test('১৪. installed PWA serves the current-build shell instantly, then revalidates; a first visit is never aborted on a timer',
  SW.indexOf('if (isDocumentRequest(request)) {') < SW.indexOf('const staticAsset =') &&
  /* current-build shell is the SAME build, so serving it cannot show an old UI */
  SW.includes("const shell = await caches.match('./index.html');") &&
  SW.includes('event.waitUntil(') &&
  /* a slow-but-working first navigation must not be aborted and handed the splash */
  !SW.includes('controller.abort(), DOCUMENT_NETWORK_TIMEOUT_MS') &&
  SW.includes('return offlineFallback(request);'));
test('১৪খ. a route whose tool script lands late recovers itself — no dead "লোড হয়নি" card',
  H.includes('function waitForRenderer(') &&
  H.includes("const LAZY_RENDERER = { ai: 'renderAiAgentPage'") &&
  H.includes("waitForRenderer('my-profile', () => typeof window.renderProfilePage === 'function')") &&
  H.includes('if (Router.path === path) render();'));
test('১৪গ. a notification tap can never open a retired host',
  /* the deleted GitHub mirror fails DNS on every device — the SW must keep the
     tap on this origin, and the worker must default to the live address */
  SW.includes('new URL(raw, self.location.origin).origin === self.location.origin ? raw : ') &&
  !/nd\.url\s*\|\|\s*'\.\/';\s*\n\s*\}/.test(SW) &&
  !NW.includes("'https://sheikhrashel47-stack.github.io/admission-hub/'") &&
  NW.includes("'https://admissionsky.pages.dev/'"));
test('১৪ঘ. an installed-PWA launch (no navigate mode) still gets the rescue page, never a bare ERR_FAILED',
  /* owner screenshot 2026-10-13: .../?source=pwa#dashboard → "This site can't
     be reached — ERR_FAILED". A PWA/WebView top-level navigation can arrive
     without mode:'navigate'; it must still be treated as a document so a
     failed fetch returns rescueResponse(), not Response.error(). */
  SW.includes("String(request.headers.get('accept') || '').includes('text/html')") &&
  SW.includes('return rescueResponse();'));
test('১৫. precache stays lean because code-native entry pages add no raster assets',
  /* Bound tracks the hand-curated APP_SHELL list. It grew from 33 → 37 when the
     P16 accessibility core landed, then 37 → 39 with the P15 offline status
     pill, then 39 → 41 with the two P17 study-plan assets, then 41 → 43 with the two P18 admission-intelligence assets, then 43 → 44
     with the P18 official question-pattern dataset, then 44 → 46 when the
     Admission Sky flow replaced welcome-onboarding as the entry screen (its
     CSS and JS are precached, like the flow they replace), then 46 → 48 when
     the owner's Welcome Story replaced the static welcome artboard as the entry
     screen (its CSS and JS are precached the same way). The
     point of the ceiling is to catch an accidental bulk import, not to pin an
     exact size. */
  /* Ceiling raised 48 → 64 (2026-10-24): the code-native entry page, the Sky
     tool client and the vocabulary/notification bundles that ship with the
     current shell pushed the hand-curated list to 60 entries. The ceiling
     exists to catch an accidental bulk import, not to pin an exact size. */
  shellAssets > 0 && shellAssets <= 64 && !appShellBlock.includes('result-analysis-500.js') && !appShellBlock.includes("  '',"));
test('১৬. PWA updates are in-place; active worker is never unregistered first', !H.includes('registration.unregister()'));

/* AI composer and response */
test('১৭. composer ইনপুট iOS-এ আলাদা ফ্রেম বানায় না (textarea + ১৬px, no contenteditable)',
  /* Sky uses a plain textarea. A font below 16px makes iOS Safari zoom the
     whole page on focus, which is the frame this guard exists to prevent. */
  !AI.includes('contenteditable') && AI.includes('id="inp"') && AI.includes('font-size:16px') && AI.includes('-webkit-appearance:none;appearance:none'));
test('১৮. rich and plain AI messages render their complete bodies directly',
  /* Escape-first, then markdown: every message body goes through md() whole
     (mdRich wraps it for charts/flows), with no fold step between the model
     text and the DOM. */
  AI.includes('function md(src)') && AI.includes('else inner = mdRich(m.text)') && AI.includes('b.innerHTML = mdRich(full)'));
test('১৯. AI response/code collapse implementation and label are completely absent',
  !AI.includes('ai-rb-fold') && !AI.includes('ai-code-fold') && !AI.includes('respFold(') && !AI.includes('সম্পূর্ণ দেখুন') && !AI.includes('Expand full response'));
test('২০. long code stays fully visible (কোনো truncate নয়)',
  AI.includes('<pre><code>') && !AI.includes('if (n > 18)') && !AI.includes('ai-code-fold'));

console.log(`\nFAST-START + AI REGRESSION: ${pass} pass / ${fail} fail`);
process.exit(fail ? 1 : 0);
