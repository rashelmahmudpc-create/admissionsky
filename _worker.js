/* Cloudflare Pages advanced-mode worker.
   Same-origin /api/* requests are proxied to the production Workers; all other
   requests are served from Pages assets. No client or service credential is
   stored here. */
import { corsHeaders } from './cors-policy.mjs';

const ORIGIN = 'https://admission-gk.admissionhub.workers.dev';
const VOICE_ORIGIN = 'https://admission-voice.admissionhub.workers.dev';
/* P23, the live voice AGENT is served by the main Worker, not the vocabulary
   voice worker, so its ticket/login/session calls must be proxied there. Every
   other /api/voice path still belongs to the vocabulary voice worker. */
const AGENT_API = /^\/api\/voice\/(agent|login|session)(\/|$)/;
const RETIRED_ASSETS = new Set([
  '/premium-auth.js', '/premium-auth.css', '/auth-svg.js', '/user-account.js',
  '/onboarding.js', '/onboarding.css', '/curriculum-config.js', '/preview-onboarding.html',
  '/email-preview-otp.html', '/otp-gmail.gs'
]);
const RETIRED_ASSET_PREFIXES = ['/auth-art', '/auth-screens'];
const SERVER_ONLY_ASSETS = new Set([
  '/gk-agent-worker.js', '/public-worker.js', '/ai-agent.js', '/worker-bundle.mjs',
  '/voice-worker.js', '/notification-worker.js', '/fcm-notification.mjs',
  '/p14-abuse-guard.mjs', '/action-engine.js', '/userdata-api.mjs',
  '/wrangler.toml', '/wrangler.staging.toml', '/supabase_sync_schema.sql',
  '/package.json', '/package-lock.json',
  /* AI audit 2026-10-16: Worker-only AI modules (system prompt text, safety
     validator patterns, memory/cache/router internals). None is loaded by a
     page; they were being served as public assets. */
  '/prompt-registry.js', '/response-validator.js', '/memory-engine.js',
  '/context-engine.js', '/tool-registry.js', '/observability.js',
  '/ai-chat-cache.mjs', '/ai-history-trim.mjs', '/ai-tier-router.mjs',
  '/ai-state-do.mjs', '/ai-provider-health.mjs', '/ai-analytics-copilot.mjs',
  '/ai-analytics-routes.mjs', '/ai-analytics-provider.mjs', '/ai-analytics-store.mjs',
  '/ai-analytics-policy.mjs', '/ai-analytics-intelligence.mjs', '/p19-error-monitor.mjs',
  /* Audit 2026-10-20 (SEC-001): further Worker-only modules that were still
     being served as public assets. Verified none is referenced by index.html or
     sw.js, and none is imported by a client-public module, so all are
     server-only. sentry-report.js is deliberately NOT listed here: index.html
     loads it as a module, so it must stay downloadable. */
  '/analytics-engine.mjs', '/personalized-notification.mjs',
  '/notification-intelligence.mjs', '/sky-tools.mjs',
  '/digest-notifications.mjs', '/event-notifications.mjs',
  '/files-storage.mjs', '/email-policy.js',
  '/sky-recall.mjs', '/sky-time.mjs', '/sky-goal.mjs', '/sky-contact.mjs',
  '/sky-instructions.mjs', '/sky-web-search.mjs', '/sky-daily-report.mjs',
  '/sky-app-features.mjs',
  '/voice-agent.mjs', '/voice-agent-core.mjs', '/voice-agent-gate.mjs',
  '/voice-agent-providers.mjs',
  '/p19-backup.mjs', '/p13-api-compression.mjs', '/p13-d1-read.mjs',
  '/p13-load-runner.mjs', '/p13-load-harness.js', '/master-update.js',
  /* Same audit: server-only modules imported exclusively by other server-only
     modules (never by a page, the service worker or a client bundle). */
  '/cors-policy.mjs', '/admin-passkey.mjs', '/analytics-notifications.mjs',
  '/send-planner.mjs', '/sky-ai-route.mjs'
]);
const SERVER_ONLY_PREFIXES = ['/auth/', '/auth-native/', '/email-gateway/', '/apps-script/', '/docs/', '/AGENT_RESUME/', '/.github/', '/tools/', '/scripts/', '/tests/', '/sky-ai/'];
const isRetiredAsset = pathname => RETIRED_ASSETS.has(pathname) ||
  RETIRED_ASSET_PREFIXES.some(prefix => pathname === prefix || pathname.startsWith(prefix + '/'));
const isServerOnlyAsset = pathname => SERVER_ONLY_ASSETS.has(pathname) ||
  SERVER_ONLY_PREFIXES.some(prefix => pathname.startsWith(prefix));

/* SEO, the SPA is hash-routed, so only these pathnames are real public URLs.
   Anything else must answer 404 instead of a 200 copy of index.html, otherwise
   crawlers index unlimited duplicate pages. */
const PUBLIC_ROUTES = new Set([
  '/', '/index.html',
  '/privacy', '/privacy.html', '/data-deletion', '/data-deletion.html',
  /* The account page is a single full-screen document now; these preview pages
     stay reachable so the owner can open the designs on their own. */
  '/splash-preview', '/splash-preview.html',
  '/verification-control-center', '/verification-control-center.html',
  /* Fresh Start phase 3: admin-token Students page (noindex, network-only in sw.js). */
  '/students-control-center', '/students-control-center.html',
  '/ai-performance-analysis-live', '/ai-performance-analysis-live.html',
  '/notification-command-center', '/notification-command-center.html',
  /* Profile V2, the design is fetched as a document and injected into an
     iframe's srcdoc, so the page itself is never navigated to. It still has to
     be reachable, or the fetch gets the 404 page and the mount shows nothing. */
  '/profile-v2', '/profile-v2.html',
  /* Owner-only live voice page, behind a password (owner's call, no login).
     The page and its module must be reachable, or the gate has nothing to
     protect; the socket and login calls are refused without the signed cookie
     the password issues. */
  '/voice-agent', '/voice-agent.html',
  '/voice-agent-login', '/voice-agent-login.html'
]);
const PUBLIC_FILES = new Set([
  '/robots.txt', '/sitemap.xml', '/favicon.ico', '/og-image.png',
  '/apple-touch-icon.png', '/manifest.json', '/manifest.webmanifest', '/sw.js'
]);
const PUBLIC_PREFIXES = ['/icons/', '/course-assets/'];
const COURSE_SLUGS = new Set(['prottoy', 'prottoy-master', 'sandhi', 'somas']);
const PROFILE_PATH = /^\/AH-[A-Z2-9]{6}\/?$/i;
const ASSET_EXT = /\.(css|js|mjs|json|webmanifest|png|jpe?g|webp|avif|gif|svg|ico|pdf|woff2?|ttf|otf|eot|mp3|mp4|webm|txt|xml|map)$/i;

const isAssetPath = pathname => ASSET_EXT.test(pathname);
const isCoursePath = pathname => {
  const m = pathname.match(/^\/courses\/([^/]+)(?:\/(?:index\.html)?)?\/?$/);
  return !!m && COURSE_SLUGS.has(m[1]);
};
const isPublicPath = pathname => PUBLIC_ROUTES.has(pathname) ||
  PUBLIC_FILES.has(pathname) ||
  PUBLIC_PREFIXES.some(prefix => pathname.startsWith(prefix)) ||
  PROFILE_PATH.test(pathname) ||
  isCoursePath(pathname);

const NOT_FOUND_HTML = `<!DOCTYPE html>
<html lang="bn" dir="ltr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, follow">
<title>পেজটি পাওয়া যায়নি, Admission Hub</title>
<style>
body{margin:0;min-height:100dvh;display:grid;place-content:center;justify-items:center;gap:10px;
padding:32px 24px;background:#faf9f6;color:#1a1d1b;text-align:center;
font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Noto Sans Bengali",sans-serif}
.mark{display:grid;place-items:center;width:52px;height:52px;border-radius:16px;background:#0f6b4f;
color:#fff;font-size:26px;box-shadow:0 10px 24px rgba(15,107,79,.18)}
h1{margin:6px 0 0;font-size:19px}
p{margin:0;max-width:34ch;color:#6b7370;font-size:14px;line-height:1.6}
a{margin-top:8px;display:inline-block;padding:11px 20px;border-radius:12px;background:#0f6b4f;color:#fff;
text-decoration:none;font-weight:600;font-size:14px}
</style>
</head>
<body>
<div class="mark">✦</div>
<h1>পেজটি পাওয়া যায়নি</h1>
<p>আপনি যে লিংকে এসেছেন সেটি নেই বা সরিয়ে ফেলা হয়েছে।</p>
<a href="/">হোমে ফিরে যান</a>
</body>
</html>`;

const notFound = () => new Response(NOT_FOUND_HTML, {
  status: 404,
  headers: {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Robots-Tag': 'noindex, follow',
    'X-Content-Type-Options': 'nosniff'
  }
});

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    /* Firebase Auth helper (/__/auth/handler, /__/auth/iframe, init.json) served
     * same-origin, so the authDomain can become this site once
     * https://admissionsky.pages.dev/__/auth/handler is an authorised redirect
     * URI for the Google and Facebook OAuth clients.
     *
     * sw.js must leave these three paths alone (owner 2026-10-22): it used to
     * answer them from the app shell, the hidden iframe never completed its
     * handshake, and "Continue with Google" sat for a minute or two. Anything
     * that touches the service worker has to keep that bypass. */
    if (url.pathname.startsWith('/__/auth/') || url.pathname === '/__/firebase/init.json') {
      const upstream = new URL(url.pathname + url.search, 'https://admissionsky-997d2.firebaseapp.com');
      const init = { method: request.method, headers: request.headers, redirect: 'manual' };
      if (request.method !== 'GET' && request.method !== 'HEAD') init.body = request.body;
      return fetch(upstream, init);
    }

    if (isRetiredAsset(url.pathname)) {
      return new Response('Retired', {
        status: 410,
        headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }
      });
    }

    if (isServerOnlyAsset(url.pathname)) {
      return new Response('Not found', {
        status: 404,
        headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }
      });
    }

    // Internal service endpoints must never be proxied or exposed through Pages.
    if (url.pathname.startsWith('/internal/')) {
      return new Response('Not found', {
        status: 404,
        headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }
      });
    }

    if (url.pathname.startsWith('/api/')) {
      try {
        const base = AGENT_API.test(url.pathname) ? ORIGIN
          : url.pathname.startsWith('/api/voice') ? VOICE_ORIGIN : ORIGIN;
        const target = new URL(base + url.pathname + url.search);
        const headers = new Headers(request.headers);
        headers.delete('host');
        headers.set('x-ah-pages-proxy', '1');
        /* BUG-001 (2026-10-29 audit). The header above is caller-supplied, so it
           proves nothing on its own — a non-browser client sets it freely. For
           the alert route the proxy also signs the body with ALERT_PROXY_SECRET,
           which only this worker and the gk worker hold, so the gk worker can
           tell a real forward from a forged one. */
        if (url.pathname === '/api/report-error' && env.ALERT_PROXY_SECRET
            && request.method === 'POST' && request.body) {
          const raw = await request.clone().text();
          const ts = String(Date.now());
          const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.ALERT_PROXY_SECRET),
            { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
          const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${ts}.${raw}`));
          headers.set('x-ah-proxy-ts', ts);
          headers.set('x-ah-proxy-sig', [...new Uint8Array(mac)].map(b => b.toString(16).padStart(2, '0')).join(''));
        }
        const init = { method: request.method, headers, redirect: 'manual' };
        if (request.method !== 'GET' && request.method !== 'HEAD' && request.body) init.body = request.body;
        const response = await fetch(target, init);
        return new Response(response.body, response);
      } catch (_) {
        return new Response(JSON.stringify({ error: 'api-unavailable', at: Date.now() }), {
          status: 502,
          // BUG-005: never '*' here. corsHeaders returns {} (plus Vary: Origin)
          // for a non-allowlisted Origin, so the response is unreadable to it.
          headers: { 'Content-Type': 'application/json', ...corsHeaders(request) }
        });
      }
    }

    try {
      // Serve only the two legal .html aliases through their Pages canonical paths.
      // This avoids the .html redirect while retaining the strict SEO allowlist.
      let assetRequest = request;
      if (url.pathname === '/privacy.html' || url.pathname === '/data-deletion.html') {
        const assetUrl = new URL(request.url);
        assetUrl.pathname = url.pathname.slice(0, -5);
        assetRequest = new Request(assetUrl, request);
      }
      const response = await env.ASSETS.fetch(assetRequest);
      // Pages answers 200 + index.html for any unknown path. A real asset never
      // comes back as HTML, so an HTML response to an asset-looking path means
      // the file is missing and must 404.
      const servedHtml = response.status === 200 &&
        (response.headers.get('content-type') || '').includes('text/html');
      if (servedHtml && (isAssetPath(url.pathname) || !isPublicPath(url.pathname))) {
        return notFound();
      }
      return response;
    } catch (_) {
      return notFound();
    }
  }
};
