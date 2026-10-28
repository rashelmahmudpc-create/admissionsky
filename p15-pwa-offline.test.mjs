/* P15 — PWA + offline-first guarantees.
 *
 * The service worker precaches the app shell and refuses to cache a corrupt
 * download. These tests read the real sw.js and index.html and verify the
 * manifest, the version markers and every asset digest against the files on
 * disk, so a stale digest or an out-of-sync build id cannot ship. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';

const sw = readFileSync(new URL('./sw.js', import.meta.url), 'utf8');
const indexHtml = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
const manifest = JSON.parse(readFileSync(new URL('./manifest.webmanifest', import.meta.url), 'utf8'));

const buildId = (sw.match(/const BUILD_ID = '([^']+)'/) || [])[1];
const expectedInIndex = (indexHtml.match(/expectedSwVersion\s*=\s*'([^']+)'/) || [])[1];

test('p15-01: the manifest declares a standalone, installable app', () => {
  assert.ok(manifest.name && manifest.short_name, 'name and short_name are required');
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.start_url, './?source=pwa#dashboard');
  assert.equal(manifest.scope, './');
  assert.equal(manifest.lang, 'bn');
  const sizes = (manifest.icons || []).map(i => i.sizes);
  assert.ok(sizes.includes('192x192'), 'a 192px icon is required to install');
  assert.ok(sizes.includes('512x512'), 'a 512px icon is required to install');
});

test('p15-02: the service worker build id matches the one index.html expects', () => {
  assert.ok(buildId, 'sw.js must declare a BUILD_ID');
  assert.ok(expectedInIndex, 'index.html must declare an expectedSwVersion');
  assert.equal(buildId, expectedInIndex, 'a mismatch makes the update loop fire forever');
});

test('p15-03: the app shell precaches the entry documents and the sync engine', () => {
  for (const asset of ['./index.html', './manifest.webmanifest', './student-data-sync.js']) {
    assert.ok(sw.includes(`'${asset}`) || sw.includes(`"${asset}`), `${asset} must be precached`);
  }
});

test('p15-04: every precached asset matches its recorded SHA-256 (no corrupt shell)', () => {
  const block = sw.match(/\/\* sw-manifest:start \*\/([\s\S]*?)\/\* sw-manifest:end \*\//);
  assert.ok(block, 'the sw-manifest digest block must be present');
  const digests = {};
  for (const m of block[1].matchAll(/"([^"]+)":\s*"([0-9a-f]{64})"/g)) digests[m[1]] = m[2];
  assert.ok(Object.keys(digests).length >= 30, 'the digest table must cover the shell');

  let checked = 0;
  for (const [filePath, expected] of Object.entries(digests)) {
    const rel = filePath.replace(/^\.\//, '').replace(/\?.*$/, '');
    const abs = new URL('./' + rel, import.meta.url);
    // A versioned query (widget.js?v=…) is not part of the file name.
    if (!existsSync(abs)) continue;
    const actual = createHash('sha256').update(readFileSync(abs)).digest('hex');
    assert.equal(actual, expected, `${rel} digest is stale — run: npm run sw:manifest`);
    checked += 1;
  }
  assert.ok(checked >= 20, `verified only ${checked} assets`);
});

test('p15-05: the worker refuses a corrupt download and can be told to take over', () => {
  assert.match(sw, /isCurrentBuild/, 'a build-marker check must gate what is cached');
  assert.match(sw, /SKIP_WAITING/, 'the update flow needs a skipWaiting escape hatch');
  assert.match(sw, /caches\.match\('\.\/index\.html'\)/, 'a current-build shell must be served from cache');
});

test('p15-06: the install-guide pop-up ships and is precached', () => {
  assert.ok(sw.includes('install-guide.js'), 'the install guide must be in the app shell');
  assert.ok(sw.includes('install-guide.css'), 'the install guide styles must be in the app shell');
  assert.match(indexHtml, /\.\/install-guide\.js/, 'index.html must load the install guide');
  assert.match(indexHtml, /\.\/install-guide\.css/, 'index.html must link the install guide styles');
});

test('p15-07: Background Sync is registered and the worker wakes closed clients', () => {
  const sync = readFileSync(new URL('./student-data-sync.js', import.meta.url), 'utf8');
  assert.match(sync, /reg\.sync\.register\('ah-student-sync'\)/, 'the engine must register the sync tag');
  assert.match(sw, /addEventListener\('sync'/, 'the worker must handle the sync event');
  assert.match(sw, /event\.tag !== 'ah-student-sync'/, 'it must filter to our tag');
  assert.match(sw, /FLUSH_STUDENT_SYNC/, 'it must nudge clients to flush');
  assert.match(sync, /FLUSH_STUDENT_SYNC/, 'the engine must react to the nudge');
});

test('p15-08: an offline write is queued, persisted and safe when offline', () => {
  const sync = readFileSync(new URL('./student-data-sync.js', import.meta.url), 'utf8');
  assert.match(sync, /persistQueue\(\)/, 'the queue must persist across reloads');
  assert.match(sync, /if \(!state\.online\) return \{ skipped: true, offline: true \}/, 'pushes must pause offline');
  assert.match(sync, /MAX_QUEUE/, 'there must be a bounded queue');
  // Coalescing: a newer write for a record replaces the older one.
  assert.match(sync, /queue\.splice\(i, 1\)/, 'writes must coalesce per record');
});

test('p15-09: the offline indicator is honest and shipped', () => {
  const js = readFileSync(new URL('./offline-status.js', import.meta.url), 'utf8');
  assert.match(js, /sync-status/, 'it must listen to the real sync status stream');
  assert.match(js, /অফলাইন/, 'it must show an offline state');
  // Owner decision (2026-10-11): the floating pill is offline-only. It must not
  // linger a "syncing" message over the bottom nav while online.
  assert.ok(!js.includes('সিংক হচ্ছে'), 'the online syncing pill must be removed');
  assert.ok(sw.includes('offline-status.js'), 'the indicator must be in the app shell');
  assert.match(indexHtml, /\.\/offline-status\.js/, 'index.html must load the indicator');
  // It must not claim success it cannot verify: no fabricated "saved" on error.
  assert.ok(!/lastError[^\n]*সিংক হয়েছে/.test(js), 'an error must not read as success');
});

/* The shell precache was silently dead in production: the digest gate called
 * `Blob.prototype.digest`, which no browser implements, so every asset threw
 * inside the per-asset try/catch and the shell cache stayed empty (an offline
 * open fell through to the rescue page). Two things must never come back. */
test('p15-11: the digest gate uses Web Crypto and tolerates the edge-injected beacon', () => {
  assert.match(sw, /crypto\.subtle\.digest\('SHA-256'/, 'hashing must use crypto.subtle.digest');
  assert.doesNotMatch(sw, /\.digest\('SHA-256'\)/, 'Blob.prototype.digest does not exist in any browser');
  // Cloudflare Pages injects its analytics beacon into HTML at the edge, so a
  // served document can never match the file on disk byte-for-byte.
  assert.match(sw, /stripEdgeInjectedAnalytics/, 'the edge-injected snippet must be stripped before hashing');
  assert.match(sw, /cloudflareinsights/, 'the beacon script must be recognised');
});

test('p15-10: the offline data boundary is documented', () => {
  const doc = readFileSync(new URL('./docs/P15-OFFLINE-BOUNDARY.md', import.meta.url), 'utf8');
  assert.match(doc, /Safari/i, 'the iOS limitation must be stated');
  assert.match(doc, /Background Sync/i, 'background sync must be described');
  assert.match(doc, /IndexedDB/i, 'the local store must be described');
});
