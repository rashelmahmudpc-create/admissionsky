import test from 'node:test';
import assert from 'node:assert/strict';

import { readFileSync } from 'node:fs';
import worker from './_worker.js';

/* Emulates Cloudflare Pages static-asset behaviour: known files are served with
   their real content type, everything else falls back to index.html with 200. */
const REAL_FILES = new Map([
  ['/', 'text/html; charset=utf-8'],
  ['/index.html', 'text/html; charset=utf-8'],
  ['/splash-preview.html', 'text/html; charset=utf-8'],
  ['/verification-control-center.html', 'text/html; charset=utf-8'],
  ['/students-control-center.html', 'text/html; charset=utf-8'],
  ['/ai-performance-analysis-live.html', 'text/html; charset=utf-8'],
  ['/notification-command-center.html', 'text/html; charset=utf-8'],
  ['/welcome-onboarding.html', 'text/html; charset=utf-8'],
  ['/courses/prottoy/index.html', 'text/html; charset=utf-8'],
  ['/courses/prottoy-master/index.html', 'text/html; charset=utf-8'],
  ['/courses/sandhi/index.html', 'text/html; charset=utf-8'],
  ['/courses/somas/index.html', 'text/html; charset=utf-8'],
  ['/robots.txt', 'text/plain; charset=utf-8'],
  ['/sitemap.xml', 'application/xml; charset=utf-8'],
  ['/favicon.ico', 'image/x-icon'],
  ['/og-image.png', 'image/png'],
  ['/apple-touch-icon.png', 'image/png'],
  ['/manifest.json', 'application/manifest+json'],
  ['/manifest.webmanifest', 'application/manifest+json'],
  ['/sw.js', 'text/javascript'],
  ['/icons/icon-192.png', 'image/png'],
  ['/icons/uni/du.png', 'image/png'],
  ['/course-assets/sandhi/guide.pdf', 'application/pdf']
]);

const assets = {
  async fetch(request) {
    const { pathname } = new URL(request.url);
    const known = REAL_FILES.get(pathname);
    if (known) {
      return new Response('<html>real</html>', {
        status: 200,
        headers: { 'Content-Type': known }
      });
    }
    // Pages SPA fallback: unknown path returns the app shell with 200.
    return new Response('<!DOCTYPE html><html>app shell</html>', {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' }
    });
  }
};

const get = path => worker.fetch(new Request(`https://admissionhub.pages.dev${path}`), { ASSETS: assets });

test('public SPA entry points stay 200', async () => {
  for (const path of ['/', '/index.html']) {
    const res = await get(path);
    assert.equal(res.status, 200, `${path} must stay 200`);
    assert.match(res.headers.get('content-type'), /text\/html/);
  }
});

test('static course landing pages stay 200', async () => {
  for (const slug of ['prottoy', 'prottoy-master', 'sandhi', 'somas']) {
    for (const path of [`/courses/${slug}/`, `/courses/${slug}`, `/courses/${slug}/index.html`]) {
      const res = await get(path);
      assert.equal(res.status, 200, `${path} must stay 200`);
    }
  }
});

test('unknown course slug is 404', async () => {
  const res = await get('/courses/bogus/');
  assert.equal(res.status, 404);
});

test('public profile URLs stay 200', async () => {
  for (const path of ['/AH-ABC234', '/AH-ABC234/']) {
    const res = await get(path);
    assert.equal(res.status, 200, `${path} must stay 200`);
  }
});

test('malformed profile IDs are 404', async () => {
  // The app matches /^\/(AH-[A-Z2-9]{6})\/?$/i, so it accepts lowercase IDs.
  // Only wrong length or excluded characters may 404.
  for (const path of ['/AH-ABC23', '/AH-ABC2345', '/AH-A1C234', '/AH-ABC!34']) {
    const res = await get(path);
    assert.equal(res.status, 404, `${path} must be 404`);
  }
});

test('seed assets and manifests stay 200', async () => {
  for (const path of ['/robots.txt', '/sitemap.xml', '/favicon.ico', '/og-image.png',
    '/apple-touch-icon.png', '/manifest.json', '/manifest.webmanifest', '/sw.js',
    '/icons/icon-192.png', '/icons/uni/du.png', '/course-assets/sandhi/guide.pdf']) {
    const res = await get(path);
    assert.equal(res.status, 200, `${path} must stay 200`);
    assert.doesNotMatch(res.headers.get('content-type'), /text\/html/,
      `${path} must not be served as HTML`);
  }
});

test('unknown crawler-visible URLs are real 404s', async () => {
  for (const path of ['/nonexistent-xyz', '/login', '/signup', '/dashboard',
    '/about', '/blog', '/admin', '/wp-login.php']) {
    const res = await get(path);
    assert.equal(res.status, 404, `${path} must be 404`);
    assert.equal(res.headers.get('x-robots-tag'), 'noindex, follow');
  }
});

test('missing assets 404 instead of returning the HTML shell', async () => {
  for (const path of ['/nonexistent.png', '/missing.css', '/nope.json', '/no-such.js',
    '/icons/ghost.png', '/course-assets/sandhi/missing.pdf']) {
    const res = await get(path);
    assert.equal(res.status, 404, `${path} must be 404`);
    // The styled 404 page is HTML by design, but it must not be the app shell.
    const body = await res.text();
    assert.match(body, /পেজটি পাওয়া যায়নি/, `${path} must serve the 404 page`);
    assert.doesNotMatch(body, /app shell/, `${path} must not serve the app shell`);
  }
});

test('404 body is a standalone noindex page', async () => {
  const res = await get('/definitely-not-a-route');
  const body = await res.text();
  assert.match(body, /<meta name="robots" content="noindex, follow">/);
  assert.match(body, /lang="bn"/);
  assert.equal(res.headers.get('cache-control'), 'no-store');
});

test('retired and server-only paths keep their original status codes', async () => {
  assert.equal((await get('/premium-auth.js')).status, 410);
  assert.equal((await get('/gk-agent-worker.js')).status, 404);
  assert.equal((await get('/docs/x')).status, 404);
  assert.equal((await get('/AGENT_RESUME/notes.md')).status, 404);
  assert.equal((await get('/internal/x')).status, 404);
});

test('preview surfaces are reachable but marked noindex', async () => {
  for (const path of ['/splash-preview.html', '/ai-performance-analysis-live.html',
    '/verification-control-center.html', '/notification-command-center.html',
    /* Fresh Start phase 3: shipped in #73 but missing here, so it answered 404. */
    '/students-control-center.html', '/students-control-center',
    /* The profile-v2 mount fetches this document into an iframe's srcdoc. The
       page is never navigated to, so it is easy to forget it must still be
       reachable — a 404 here leaves the profile screen blank (2026-10-16). */
    '/profile-v2.html', '/profile-v2']) {
    const res = await get(path);
    assert.equal(res.status, 200, `${path} must stay reachable`);
  }
});

test('every preview document actually carries a noindex robots meta', () => {
  /* The reachability test above passed while four of these documents had no
     robots meta at all, so "reachable but noindex" was only half true and the
     crawler was free to index an internal admin screen. The route status and
     the document's own meta are two different things; this reads the file. */
  const files = ['splash-preview.html', 'ai-performance-analysis-live.html',
    'notification-command-center.html', 'profile-v2.html',
    'students-control-center.html', 'verification-control-center.html'];
  for (const file of files) {
    const html = readFileSync(new URL(`./${file}`, import.meta.url), 'utf8');
    assert.match(html, /<meta\s+name="robots"\s+content="[^"]*noindex/,
      `${file} must declare noindex in its own head`);
  }
});

test('the owner\'s personal email is published only as a contact address', () => {
  /* notification-command-center.html hardcodes the admin's address as sample
     data; that is acceptable only while the document is noindex, which the test
     above enforces. privacy.html and data-deletion.html do publish the address
     on purpose -- a reachable contact is what the privacy and data-deletion
     rules require -- so on an indexable page the address is allowed only inside
     a mailto: link, never as bare text or sample data. */
  const indexable = ['index.html', 'privacy.html', 'data-deletion.html'];
  const ADDRESS = 'rashelmahmudpc@gmail\\.com|rashelzayan3@gmail\\.com';
  for (const file of indexable) {
    const html = readFileSync(new URL(`./${file}`, import.meta.url), 'utf8');
    /* Drop the whole mailto anchor, link text included: the visible address in
       "যোগাযোগ / Contact: <a ...>address</a>" is part of the contact block. */
    const bare = html.replace(/<a\b[^>]*mailto:[^>]*>[\s\S]*?<\/a>/gi, '');
    assert.doesNotMatch(bare, new RegExp(ADDRESS),
      `${file} is indexed, so the owner's address may appear only inside a mailto contact link`);
  }
});

test('the legacy welcome template route is retired; the sky flow needs no template fetch', async () => {
  /* welcome-onboarding.js fetched a standalone template at runtime. The sky
     flow builds its own DOM in sky-onboarding.js, so the partial is gone and
     the SPA 404 guard must treat both pathnames as unknown. */
  for (const path of ['/welcome-onboarding', '/welcome-onboarding.html']) {
    const res = await get(path);
    assert.equal(res.status, 404, `${path} must stay retired`);
  }
});
