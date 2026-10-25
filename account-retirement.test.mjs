// Admission Hub current shell — retired account/profile/personalization-onboarding guard.
import { existsSync, readFileSync } from 'node:fs';
import publicWorker, { publishGlobal } from './public-worker.js';
import bundledWorker from './worker-bundle.mjs';
import pagesWorker from './_worker.js';

let passed = 0;
let failed = 0;
async function test(name, check) {
  try {
    const ok = await (typeof check === 'function' ? check() : check);
    if (!ok) throw new Error('assertion returned false');
    passed++;
    console.log('  ✓', name);
  } catch (error) {
    failed++;
    console.error('  ✗', name, '—', error?.message || error);
  }
}

class MemoryKV {
  constructor(seed = {}) {
    this.data = new Map(Object.entries(seed));
    this.writes = [];
    this.deletes = [];
  }
  async get(key, type) {
    const value = this.data.has(key) ? this.data.get(key) : null;
    if (type === 'json' && value != null) return JSON.parse(value);
    return value;
  }
  async put(key, value, options) {
    this.data.set(key, String(value));
    this.writes.push({ key, value: String(value), options });
  }
  async delete(key) {
    this.data.delete(key);
    this.deletes.push(key);
  }
}

const H = readFileSync('index.html', 'utf8');
const SW = readFileSync('sw.js', 'utf8');
const UI = readFileSync('ai-agent-chat.js', 'utf8');
const CLOUD = readFileSync('cloud-content-sync.js', 'utf8');
const SOURCE = readFileSync('public-worker.js', 'utf8');
const BUNDLE = readFileSync('worker-bundle.mjs', 'utf8');
const DISPATCH = readFileSync('gk-agent-worker.js', 'utf8');
const PAGES = readFileSync('_worker.js', 'utf8');
const STUDIO_SHELL = readFileSync('experience-studio-shell.js', 'utf8');
const STUDIO_CARDS = readFileSync('experience-studio-cards.js', 'utf8');
const ACCOUNT_UI = readFileSync('account-access.js', 'utf8');
const AUTH_HANDLER = readFileSync('auth-native/worker/public-auth-handler.mjs', 'utf8');
const INSTITUTIONS = readFileSync('institutions-bd.js', 'utf8');

const retiredFiles = [
  'premium-auth.js', 'premium-auth.css', 'auth-svg.js', 'user-account.js',
  'onboarding.js', 'onboarding.css', 'curriculum-config.js', 'preview-onboarding.html',
  'email-preview-otp.html', 'otp-gmail.gs', 'auth-art', 'auth-screens'
];
const retiredStaticUrls = [
  ...retiredFiles.filter(file => !['auth-art', 'auth-screens'].includes(file)),
  'auth-art/login-crest.jpg', 'auth-art/otp-shield.jpg', 'auth-art/signup-book.jpg',
  'auth-art/success-medal.jpg', 'auth-art/welcome-hero.jpg',
  'auth-screens/login.jpg', 'auth-screens/otp.jpg', 'auth-screens/signup.jpg',
  'auth-screens/success.jpg', 'auth-screens/welcome.jpg'
];
/* The retired assets are matched on a path boundary: the live Admission Sky
   assets (sky-onboarding.js / .css) legitimately contain the substrings
   'onboarding.js' and 'onboarding.css', so a bare substring check would flag
   the live flow as retired. */
const retiredAssetRe = new RegExp(`premium-auth|auth-svg|user-account|ahAuthGate|ahOnboardGate|AHAuth|ahPubToken|accounts\\.google\\.com/gsi|curriculum-config\\.js|(?<![\\w-])onboarding\\.(?:js|css)|auth-art|auth-screens|email-preview-otp|otp-gmail\\.gs`);
const retiredRoutes = [
  '/api/auth/config', '/api/auth/login', '/api/auth/register', '/api/auth/register-email',
  '/api/auth/google', '/api/auth/me', '/api/auth/logout', '/api/auth/otp/send',
  '/api/auth/passkey/login/begin', '/api/auth/password', '/api/auth/delete',
  '/api/profile', '/api/profile/photo', '/api/onboarding', '/api/onboarding/catalog',
  '/api/state', '/api/export', '/api/re-auth', '/api/security/activity',
  '/api/sessions', '/api/sessions/revoke', '/api/admin/users', '/api/admin/user',
  '/api/admin/block', '/api/admin/status'
];

await test('retired frontend source/assets are deleted', retiredFiles.every(file => !existsSync(file)));
await test('production HTML does not load or mount retired account/onboarding UI', !retiredAssetRe.test(H));
await test('Google identity client is not unconditionally loaded in HTML', !H.includes('accounts.google.com') && !H.includes('openid email profile'));

const navBlock = (H.match(/const NAV_TABS=\[[\s\S]*?\];/) || [''])[0];
await test('retired Profile stays removed while the four core tabs remain (AI → floating JUJU, History → Exam)',
  ['dashboard', 'question-bank', 'exam', 'my-profile'].every(key => navBlock.includes(`key:'${key}'`)) &&
  !navBlock.includes("key:'ai'") && !navBlock.includes("key:'history'") &&
  !navBlock.includes("key:'profile'") && (navBlock.match(/\{key:/g) || []).length === 4);
await test('core route dispatch remains available',
  ["p==='dashboard'", "p==='question-bank'", "p==='exam'", "p==='ai'", "p==='history'", "p==='exam/history'"].every(marker => H.includes(marker)));
await test('retired Profile/account hashes only redirect to Dashboard',
  !H.includes("path.startsWith('profile')") && H.includes("const retiredAccountRoute = p === 'profile'") &&
  H.includes('if (retiredAccountRoute) return true') && H.includes("Router.path = 'dashboard'") && !H.includes('Authentication'));
await test('Profile-only cosmetic tools are absent while the rest of Experience Studio remains',
  !/Profile Avatars|profile-avatars/.test(STUDIO_SHELL) && !/Profile Identity Card|card-026/.test(STUDIO_CARDS) &&
  STUDIO_SHELL.includes('Card Styles') && STUDIO_CARDS.includes('MCQ Orbit Card'));

await test('AI client uses ephemeral guests and Firebase-account-scoped local conversations',
  UI.includes("'X-AH-Guest': guestId()") && UI.includes("localStorage.removeItem(key)") &&
  UI.includes("window.addEventListener('admissionhub:authchange'") && UI.includes('scopedWrite(STORE') &&
  !UI.includes("localStorage.setItem('ahAiGuestV1'") && !/Authorization\s*:\s*['"`]Bearer/.test(UI));
await test('AI keeps local study-stat context', UI.includes('computeLifetimeStats()') && UI.includes('computeStreak()') && UI.includes('CACHE.mistakes'));
await test('content hydration is public and account-independent',
  CLOUD.includes("apiFetch('/api/content/meta')") && CLOUD.includes("apiFetch('/api/content')") &&
  /* The public content READS must stay unauthenticated, and they do: both use
     the plain APP_HEADER. Only the control-role publish WRITE carries the
     owner's token (BUG-001, 2026-10-25 audit) — the read path is untouched. */
  /apiFetch\('\/api\/content\/meta'\)[^\n]*/.test(CLOUD) &&
  !/apiFetch\('\/api\/content\/meta'\)[^\n]*Authorization/.test(CLOUD) &&
  !/apiFetch\('\/api\/content'\)[^\n]*Authorization/.test(CLOUD) &&
  !/AHAuth|ahPubToken|authHeaders/.test(CLOUD) &&
  CLOUD.includes("apiFetch('/api/cloud/publish', { method: 'POST', headers: writeHeaders()"));

await test('service-worker build and HTML registration are synchronized',
  (() => {
    // Read the live build id from sw.js so a normal BUILD_ID bump never needs a test edit,
    // but index.html must always follow it (a stale value deletes the live offline shell).
    const m = SW.match(/const BUILD_ID = '([^']+)'/);
    return !!m && H.includes(`const expectedSwVersion = '${m[1]}'`) && H.includes(`admission-hub-shell-${m[1]}`);
  })());
await test('service-worker shell cannot cache retired assets', !retiredAssetRe.test(SW));
await test('premium account and institution assets use synchronized cache-busting versions',
  ['account-access.css?v=20261018-allowlist-v1', 'account-access.js?v=20261021-turnstile-v1', 'institutions-bd.js?v=bd-institutions-v2']
    .every(asset => H.includes(asset) && SW.includes(asset)) &&
  H.indexOf('institutions-bd.js?v=bd-institutions-v2') < H.indexOf('account-access.js?v=20261021-turnstile-v1'));
await test('premium Auth UI/server contract and curated-manual institution policy are locked',
  ACCOUNT_UI.includes("'X-AH-Auth-UI': 'auth-premium-v6'") &&
  AUTH_HANDLER.includes("const AUTH_UI_VERSION = 'auth-premium-v6'") &&
  AUTH_HANDLER.includes("version: 'premium-onboarding-v1'") &&
  INSTITUTIONS.includes("coverage: 'curated-starter-index'") && INSTITUTIONS.includes("mode: 'manual'"));
await test('main-app AI client is versioned in the public shell while prior shells are still purged',
  SW.includes('ai-agent-chat.js?v=agent-f1-ui-skyv13') &&
  H.includes('ai-agent-chat.js?v=agent-f1-ui-skyv13') &&
  H.includes("name.startsWith('admission-hub-shell-')") &&
  SW.includes('.filter(key => key !== CACHE_NAME && key !== AVATAR_CACHE)'));

const forbiddenWorkerRoutes = retiredRoutes.filter(route => !route.startsWith('/api/admin/'));
await test('source Worker contains no retired account/profile/onboarding route literals', forbiddenWorkerRoutes.every(route => !SOURCE.includes(route)));
await test('deploy bundle contains no retired route literals or insecure implementation primitives',
  retiredRoutes.every(route => !BUNDLE.includes(route)) &&
  !/issueToken|hashPassword|verifyAuth|otpSend|GOOGLE_CLIENT_ID|TWILIO_SID|RESEND_KEY|BREVO_KEY/.test(BUNDLE) &&
  BUNDLE.includes('PASSKEY_AUTH_ACTIVATION') && BUNDLE.includes('GOOGLE_AUTH_ACTIVATION'));
await test('dispatcher forwards only content/admin/anonymous-AI environment',
  DISPATCH.includes('AGENT_PUBLIC_DAILY_CAP') &&
  !/GOOGLE_CLIENT_ID|GOOGLE_CLIENT_SECRET|TWILIO|RESEND|BREVO|BULKSMS|GREENWEB/.test(DISPATCH));
await test('dispatcher forwards every anonymous-AI provider binding, including the Cloudflare backup',
  ['GEMINI_KEYS', 'GROQ_API_KEY', 'CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_AI_API_KEY', 'AGENT_CLOUDFLARE_MODELS', 'USE_CONTEXT_ENGINE'].every(name => DISPATCH.includes(name + ': env.')));
await test('non-account Worker capabilities remain bundled',
  ['GK_SCHEMA', 'NEWS_SCHEMA', 'GK_PROMPT', 'ASK_PROMPT', 'createWithFailover', 'bankUpload', 'scheduled(event, env, ctx)'].every(marker => BUNDLE.includes(marker)));
await test('Pages same-origin API proxy preserves request headers', PAGES.includes("url.pathname.startsWith('/api/')") && PAGES.includes('new Headers(request.headers)') && PAGES.includes("headers.set('x-ah-pages-proxy', '1')"));
await test('runtime: retired static URLs return 410 instead of the SPA shell', async () => {
  let assetReads = 0;
  const env = { ASSETS: { fetch: async () => { assetReads++; return new Response('unexpected'); } } };
  for (const file of [...retiredStaticUrls, 'auth-art', 'auth-screens']) {
    const response = await pagesWorker.fetch(new Request('https://pages.example/' + file), env);
    if (response.status !== 410 || response.headers.get('X-Content-Type-Options') !== 'nosniff') return false;
  }
  return assetReads === 0;
});

await test('runtime: health declares Firebase-account or ephemeral-guest AI identity',  async () => {
  const kv = new MemoryKV();
  const response = await publicWorker.fetch(new Request('https://worker/api/health'), { PUB_KV: kv });
  const data = await response.json();
  return response.status === 200 && data.ok === true && data.accountSystem === 'retired' && data.identity === 'firebase-account-or-ephemeral-guest';
});

await test('runtime: every retired endpoint resolves to 404 with no KV mutation', async () => {
  const kv = new MemoryKV({ 'user:legacy': '{"name":"Dormant"}', 'prof:legacy': '{"goal":"kept"}' });
  for (const route of retiredRoutes) {
    const headers = route.startsWith('/api/admin/') ? { Authorization: 'Bearer admin-test' } : {};
    const response = await publicWorker.fetch(new Request('https://worker' + route, { method: 'GET', headers }), { PUB_KV: kv, ADMIN_TOKEN: 'admin-test' });
    if (response.status !== 404) return false;
  }
  return kv.writes.length === 0 && kv.deletes.length === 0 && kv.data.has('user:legacy') && kv.data.has('prof:legacy');
});

await test('runtime: retired POST routes also resolve to 404', async () => {
  const kv = new MemoryKV();
  for (const route of ['/api/auth/login', '/api/profile', '/api/onboarding', '/api/state', '/api/sessions/revoke']) {
    const response = await publicWorker.fetch(new Request('https://worker' + route, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}'
    }), { PUB_KV: kv });
    if (response.status !== 404) return false;
  }
  return kv.writes.filter(entry => !entry.key.startsWith('rlpub:')).length === 0 && kv.deletes.length === 0;
});

await test('runtime: dormant account/profile/onboarding/state records survive content publishing', async () => {
  const dormant = {
    'user:legacy': '{"id":"legacy"}', 'prof:legacy': '{"name":"Legacy"}',
    'onboard:legacy': '{"completed":true}', 'state:legacy': '{"examResults":[1]}',
    'tok:legacy': '{"id":"legacy"}'
  };
  const oldContent = { v: 2, exams: [{ id: 'exam-kept', title: 'Kept' }] };
  const kv = new MemoryKV({ ...dormant, pubContent: JSON.stringify(oldContent), pubContentMeta: '{"v":2}' });
  const result = await publishGlobal({ PUB_KV: kv }, {
    subjects: [{ id: 's1', name: 'Bangla' }], topics: [{ id: 't1', subjectId: 's1' }],
    questions: [{ id: 'q1', question: 'প্রশ্ন?', options: ['ক', 'খ'] }], vocabulary: [], vocabularyMaster: []
  });
  const published = JSON.parse(kv.data.get('pubContent'));
  return result.published === true && published.exams[0].id === 'exam-kept' &&
    Object.entries(dormant).every(([key, value]) => kv.data.get(key) === value) && kv.deletes.length === 0;
});

await test('runtime: public content/meta remain readable', async () => {
  const doc = { v: 7, at: 11, sig: 'sig7', subjects: [{ id: 's' }], topics: [{ id: 't' }], questions: [{ id: 'q' }], vocabulary: [], vocabularyMaster: [], exams: [] };
  const kv = new MemoryKV({ pubContent: JSON.stringify(doc), pubContentMeta: JSON.stringify({ v: 7, at: 11, sig: 'sig7', counts: { questions: 1 } }) });
  const content = await publicWorker.fetch(new Request('https://worker/api/content'), { PUB_KV: kv });
  const meta = await publicWorker.fetch(new Request('https://worker/api/content/meta'), { PUB_KV: kv });
  return content.status === 200 && (await content.json()).questions.length === 1 && meta.status === 200 && (await meta.json()).v === 7;
});

await test('runtime: AI status is guest-accessible and does not consume usage', async () => {
  const kv = new MemoryKV();
  const response = await publicWorker.fetch(new Request('https://worker/api/ai/status', { headers: { 'X-AH-Guest': 'device-guest-00000001', 'CF-Connecting-IP': '203.0.113.7' } }), { PUB_KV: kv });
  const data = await response.json();
  return response.status === 200 && data.ok === true && data.streaming === true &&
    kv.writes.filter(entry => !entry.key.startsWith('rlpub:')).length === 0;
});

await test('runtime: guest AI calls are refused up front and never persist conversation content or raw guest IDs', async () => {
  const kv = new MemoryKV();
  const env = { PUB_KV: kv };
  for (const id of ['device-guest-00000001', 'device-guest-00000002']) {
    const response = await publicWorker.fetch(new Request('https://worker/api/ai/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-AH-Guest': id, 'CF-Connecting-IP': '203.0.113.7' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'বাংলা ব্যাকরণ বুঝাও' }] })
    }), env);
    // M7: a guest has no durable identity, so AI chat is refused before rate,
    // memory or the provider — 401 sign_in_required, no conversation or guest
    // record in KV. P14's network abuse counter (rlpub:) is the one write here
    // and runs before the route, so it is excluded from this check.
    if (response.status !== 401) return false;
  }
  const keys = [...kv.data.keys()];
  return !keys.some(key => key.startsWith('chatmem:') || key.startsWith('chatmemsum:'))
    && !keys.some(key => key.startsWith('mem:'))
    && !keys.some(key => key.includes('device-guest-'))
    && !keys.some(key => !key.startsWith('rlpub:'));
});

await test('runtime: CORS preflight permits anonymous-device header', async () => {
  const response = await publicWorker.fetch(new Request('https://worker/api/ai/chat', { method: 'OPTIONS' }), { PUB_KV: new MemoryKV() });
  return response.status === 204 && String(response.headers.get('Access-Control-Allow-Headers')).toLowerCase().includes('x-ah-guest');
});

await test('runtime: deployed bundle returns 404 for retired route', async () => {
  const response = await bundledWorker.fetch(new Request('https://worker/api/auth/login', { method: 'POST' }), { PUB_KV: new MemoryKV(), OLD_KV: new MemoryKV() }, {});
  return response.status === 404;
});

console.log(`\nACCOUNT RETIREMENT GUARD: ${passed} pass / ${failed} fail`);
if (failed) process.exit(1);
