import test from 'node:test';
import assert from 'node:assert/strict';

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
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
    '/blog', '/admin', '/wp-login.php']) {
    const res = await get(path);
    assert.equal(res.status, 404, `${path} must be 404`);
    assert.equal(res.headers.get('x-robots-tag'), 'noindex, follow');
  }
});

test('about and contact are real public pages, not 404s', async () => {
  for (const path of ['/about', '/about.html', '/contact', '/contact.html']) {
    const res = await get(path);
    assert.equal(res.status, 200, `${path} must stay 200`);
    assert.match(res.headers.get('content-type'), /text\/html/);
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

test('every course page serves real content without JavaScript', () => {
  /* The defect this guards, measured 2026-11-03: `/courses/prottoy-master/`
   * builds every screen in JavaScript, so a crawler that does not run JS
   * received 144 characters — the title, the burger button and the brand line.
   * Its three siblings are static HTML and served 23k-49k characters of the
   * same kind of content, so that one page was invisible to search while the
   * others ranked.
   *
   * Asserted as a floor rather than an exact size: the content is generated
   * from the page's own data, so it moves when the lessons do. What must not
   * move is the property — a course page a crawler cannot read is not a page. */
  const MIN = 2000;
  for (const slug of ['prottoy', 'prottoy-master', 'sandhi', 'somas']) {
    const page = readFileSync(new URL(`./courses/${slug}/index.html`, import.meta.url), 'utf8');
    // What a crawler sees: markup with scripts and styles removed.
    const visible = page
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    assert.ok(visible.length >= MIN,
      `${slug} serves only ${visible.length} characters of crawlable text (floor ${MIN}) — is its content built in JavaScript?`);
    // And a real heading, which is what a crawler uses to understand the page.
    const body = page.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '');
    assert.match(body, /<h1[^>]*>/, `${slug} has no server-rendered h1`);
  }
});

test('every course page links back to the site and to its siblings', () => {
  /* The defect this guards, measured 2026-11-03: each course page linked to
   * exactly one URL — its own canonical. No way home, no link to a sibling, no
   * navigation at all, so a crawler arriving on one was at a dead end and could
   * not tell the page belonged to a larger site.
   *
   * Three of the four pages DO have a sidebar full of section links, which is
   * why this went unnoticed: those are `<a>` tags with no `href`, because they
   * are JavaScript click targets. Counting `<a>` would have passed; counting
   * `href` is what sees it. */
  const slugs = ['prottoy', 'prottoy-master', 'sandhi', 'somas'];
  for (const slug of slugs) {
    const page = readFileSync(new URL(`./courses/${slug}/index.html`, import.meta.url), 'utf8');
    const body = page.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '');
    const hrefs = new Set([...body.matchAll(/<a[^>]*href="([^"]+)"/g)].map(m => m[1]));

    assert.ok(hrefs.has('/'), `${slug} has no link back to the homepage`);
    for (const other of slugs) {
      if (other === slug) continue;
      assert.ok(hrefs.has(`/courses/${other}/`), `${slug} does not link to /courses/${other}/`);
    }
    /* And out of the course section entirely. Measured 2026-11-03: a course page
     * linked home, to its three siblings, and to nothing else — so a student who
     * arrived from a search had no path to the 3000 questions, which are the
     * other half of what the site offers. Linking only within a section is how a
     * site becomes several sites. */
    for (const href of ['/question-bank/', '/about.html', '/contact.html']) {
      assert.ok(hrefs.has(href), `${slug} does not link out to ${href}`);
    }
    // And the page must not link to itself as a navigational entry — that is
    // what the only previous link was.
    assert.ok(hrefs.size >= slugs.length, `${slug} links to only ${hrefs.size} distinct URLs`);
  }
});

test('every course page describes itself completely, with nothing dangling', () => {
  /* Two defects this guards, both measured on the live site 2026-11-03:
   *
   * 1. Each Course said `provider: {@id: .../#organization}` and
   *    `isPartOf: {@id: .../#website}`, but neither node was defined on the
   *    page — they lived only in index.html. A schema.org `@id` resolves within
   *    its own graph, not across pages, so to a consumer the provider was
   *    empty and the course was part of nothing.
   * 2. The Course nodes carried no `offers`, `image` or `hasCourseInstance`,
   *    which is what the markup exists to earn — without them the page cannot
   *    qualify for a course rich result.
   *
   * Asserted as a property, not a shape: every `@id` a node references must be
   * defined in the same graph, and the three properties must be present. That
   * catches a future edit that adds a reference without adding its target. */
  const REQUIRED = ['name', 'description', 'provider', 'offers', 'image', 'hasCourseInstance'];
  for (const slug of ['prottoy', 'prottoy-master', 'sandhi', 'somas']) {
    const page = readFileSync(new URL(`./courses/${slug}/index.html`, import.meta.url), 'utf8');
    const m = page.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
    assert.ok(m, `${slug} has no JSON-LD block`);

    let graph;
    let parsed; assert.doesNotThrow(() => { parsed = JSON.parse(m[1]); }, `${slug} JSON-LD must parse`); graph = parsed["@graph"];
    const defined = new Set(graph.map(n => n['@id']).filter(Boolean));

    for (const node of graph) {
      for (const [key, value] of Object.entries(node)) {
        // A reference is an object whose ONLY key is @id.
        if (value && typeof value === 'object' && !Array.isArray(value)
            && Object.keys(value).length === 1 && value['@id']) {
          assert.ok(defined.has(value['@id']),
            `${slug}: ${node['@type']}.${key} points at ${value['@id']}, which this page never defines`);
        }
      }
    }

    const course = graph.find(n => n['@type'] === 'Course');
    assert.ok(course, `${slug} has no Course node`);
    for (const key of REQUIRED) {
      assert.ok(course[key], `${slug}: Course is missing ${key}`);
    }
  }
});

test('every sitemap lastmod is the date its file actually changed', () => {
  /* The defect this guards, measured 2026-11-03: all nine `lastmod` values were
   * wrong. The five highest-priority URLs said 2026-09-15 while their files had
   * changed on 2026-11-02. A crawler reads that date to decide when to come
   * back, so a stale one means the new content waits — and nothing on the site
   * showed a problem, because a sitemap that is wrong still parses.
   *
   * The date is taken from git rather than the filesystem: a checkout sets every
   * mtime to the clone time, which would tell every crawler that everything
   * changed just now, every time. */
  const sitemap = readFileSync(new URL('./sitemap.xml', import.meta.url), 'utf8');
  const entries = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>\s*<lastmod>([^<]+)<\/lastmod>/g)];
  assert.ok(entries.length >= 9, `expected the sitemap to list the site's pages, saw ${entries.length}`);

  /* The check needs history, and three of the five workflows that run this file
   * check out with `fetch-depth: 1`. In a shallow clone `git log` still answers
   * — it just answers about the oldest commit it happens to have, which is a
   * DIFFERENT date, so the comparison fails and blames a sitemap that is
   * correct. (It did, on the first CI run: five files "changed 2026-11-03" in a
   * clone whose only commit was from 2026-11-01.)
   *
   * So the check detects its own precondition and says so, rather than reporting
   * a defect it cannot actually see. A guard that fails on a shallow clone is
   * worse than no guard: it trains the reader to ignore it. */
  const cwd = new URL('./', import.meta.url).pathname;
  const shallow = execFileSync('git', ['rev-parse', '--is-shallow-repository'], { cwd, encoding: 'utf8' }).trim();
  if (shallow === 'true') {
    assert.ok(entries.length >= 9, 'a shallow clone can still check that the sitemap lists the pages');
    return;
  }

  const wrong = [];
  for (const [, loc, lastmod] of entries) {
    const urlPath = loc.replace('https://admissionsky.pages.dev', '');
    // A directory URL is served by its index.html.
    const disk = urlPath === '/' ? 'index.html'
      : urlPath.endsWith('/') ? `${urlPath.slice(1)}index.html`
      : urlPath.slice(1);
    const real = execFileSync('git', ['log', '-1', '--format=%cs', '--', disk], { cwd, encoding: 'utf8' }).trim();
    if (real && real !== lastmod) wrong.push(`${disk}: says ${lastmod}, changed ${real}`);
  }
  assert.deepEqual(wrong, [],
    'these sitemap dates do not match when the file last changed — run: python3 scripts/build-sitemap.py');
});

test('every indexable page has a description and a share card', () => {
  /* Measured on the live site 2026-11-03: privacy.html and data-deletion.html
   * had no `<meta name="description">` at all, so a search result for either
   * showed whatever sentence a crawler chose to lift from the middle of the
   * policy. None of the four small pages had any Open Graph or Twitter tag, so a
   * shared link rendered as a bare URL while the course pages rendered a card.
   *
   * Both are the kind of thing that stays wrong because nobody looks at these
   * pages — which is exactly why the check belongs here rather than in a habit. */
  const PAGES = ['index.html', 'about.html', 'contact.html', 'privacy.html', 'data-deletion.html',
    'courses/prottoy/index.html', 'courses/prottoy-master/index.html',
    'courses/sandhi/index.html', 'courses/somas/index.html'];
  for (const file of PAGES) {
    const page = readFileSync(new URL(`./${file}`, import.meta.url), 'utf8');
    const head = page.slice(0, page.indexOf('</head>'));

    const descriptions = head.match(/<meta name="description"/g) || [];
    assert.equal(descriptions.length, 1, `${file} must have exactly one meta description, saw ${descriptions.length}`);

    /* A result shows roughly 160 characters and then cuts. Measured 2026-11-03:
     * the prottoy course page's description was 183 characters, so the sentence
     * was cut mid-clause and the last claim never appeared. A description that
     * ends in an ellipsis is a promise the reader never sees. */
    const description = head.match(/<meta name="description" content="([^"]*)"/)[1];
    assert.ok(description.length <= 160,
      `${file} description is ${description.length} characters; a result cuts at about 160`);

    // The title is the other half of the result. 60 is the working limit.
    const title = head.match(/<title>([^<]*)<\/title>/)[1];
    assert.ok(title.length <= 60, `${file} title is ${title.length} characters: ${title}`);

    for (const tag of ['og:title', 'og:description', 'og:url', 'og:image']) {
      assert.ok(head.includes(`property="${tag}"`), `${file} is missing ${tag}`);
    }
    for (const tag of ['twitter:card', 'twitter:title']) {
      assert.ok(head.includes(`name="${tag}"`), `${file} is missing ${tag}`);
    }

    /* And structured data. Measured 2026-11-03: the four small pages were the
     * only ones on the site without it — the homepage, the courses and the 15
     * question-bank pages all carry a graph. A page with none is one a search
     * engine has to guess about. */
    const ld = page.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
    assert.ok(ld, `${file} has no structured data`);
    let graph;
    assert.doesNotThrow(() => { graph = JSON.parse(ld[1])['@graph']; }, `${file} JSON-LD must parse`);

    // Same property the course pages are held to: an @id a node points at must
    // be defined in the same graph, or the reference resolves to nothing.
    const defined = new Set(graph.map(n => n['@id']).filter(Boolean));
    for (const node of graph) {
      for (const [key, value] of Object.entries(node)) {
        if (value && typeof value === 'object' && !Array.isArray(value)
            && Object.keys(value).length === 1 && value['@id']) {
          assert.ok(defined.has(value['@id']),
            `${file}: ${node['@type']}.${key} points at ${value['@id']}, which this page never defines`);
        }
      }
    }
  }
});

test('the homepage links to every crawlable section, not just the courses', () => {
  /* Measured on the live site 2026-11-03: the homepage's static markup linked to
   * the four course pages and to nothing else. The question bank — 15 generated
   * pages, 3000 questions — was reachable from the sitemap and from nowhere in
   * the site's own navigation. A page with no inbound link is a page a crawler
   * finds late or not at all, and it is the page most likely to earn a search
   * visit, because students search for the questions themselves.
   *
   * Checked on the static markup rather than the rendered page: a crawler that
   * does not run JavaScript sees only what is in the HTML, which is the whole
   * reason these pages exist. */
  const page = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
  const body = page.replace(/<script[\s\S]*?<\/script>/gi, '');
  const hrefs = new Set([...body.matchAll(/<a[^>]*href="([^"]+)"/g)].map(m => m[1]));

  const REQUIRED = [
    ['/question-bank/', 'the question bank hub'],
    ['/courses/prottoy/', 'a course page'],
    ['/about.html', 'a site page'],
  ];
  for (const [href, what] of REQUIRED) {
    assert.ok(hrefs.has(href), `the homepage does not link to ${what} (${href})`);
  }

  // And no navigation link may be a bare fragment: a crawler cannot follow one.
  for (const href of hrefs) {
    assert.ok(!href.startsWith('#'), `the homepage navigates to a fragment (${href}), which a crawler cannot follow`);
  }
});

test('the question bank pages the worker serves are the ones it allows', async () => {
  /* The gap this closes, measured 2026-11-03: removing `/question-bank/` from
   * the worker's PUBLIC_PREFIXES and its hub route turned every one of the 15
   * generated pages into a 404 — and no test noticed. The pages exist in dist,
   * the sitemap lists them, the generator's own tests pass; the only thing
   * standing between them and a 404 is one line in _worker.js, and nothing
   * checked that line.
   *
   * The stub is the realistic one: Cloudflare Pages answers an unknown path with
   * 200 and the app shell, which is exactly why the worker has to distinguish
   * "a real page" from "the SPA fallback". A stub returning plain text would
   * hide the difference and pass either way — which is what the first version of
   * this check did. */
  const PATHS = ['/question-bank/', '/question-bank/top-001/', '/question-bank/top-004/'];
  for (const path of PATHS) {
    const res = await get(path);
    assert.notEqual(res.status, 404,
      `${path} is served by the worker as a 404 — is it still in PUBLIC_PREFIXES or PUBLIC_ROUTES?`);
  }

  // And the check is not vacuous: a path the worker does NOT allow must 404,
  // or the assertion above would pass on a worker that allows everything.
  const stranger = await get('/question-bank-not-a-real-section/');
  assert.equal(stranger.status, 404, 'an unlisted path must still 404, or the allowlist proves nothing');
});
