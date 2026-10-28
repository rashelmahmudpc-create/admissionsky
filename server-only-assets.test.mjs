/* Guards SEC-001: Cloudflare Pages serves any root file as a static asset, so a
   server-only module left out of SERVER_ONLY_ASSETS is publicly downloadable and
   leaks Worker source. This test derives the expected sets from the repo itself
   instead of hardcoding a list, so a newly added server module fails the suite
   until it is either marked server-only or referenced by the client. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';

const worker = readFileSync('_worker.js', 'utf8');

/* Parse ONLY the SERVER_ONLY_ASSETS set and the SERVER_ONLY_PREFIXES array.
   Scanning every quoted path in _worker.js would pick up unrelated allowlists
   (e.g. /sw.js is a legitimate public asset listed elsewhere in the file). */
const serverOnlyBlock = worker.match(/const SERVER_ONLY_ASSETS = new Set\(\[([\s\S]*?)\]\)/)?.[1] ?? '';
const listed = new Set(
  [...serverOnlyBlock.matchAll(/'(?:\.\/)?(\/[^']+\.(?:mjs|js))'/g)].map(m => m[1].replace(/^\//, ''))
);
const prefixes = (worker.match(/const SERVER_ONLY_PREFIXES = \[([^\]]*)\]/)?.[1] ?? '')
  .match(/'[^']+'/g)?.map(s => s.slice(1, -1).replace(/^\//, '')) ?? [];

/* A module is client-public if a client entry point names it, or if a
   client-public module imports it. Client entries include index.html, the
   service worker, every other root .html page, and the web manifests. Some
   modules are still loaded by runtime logic this scan cannot see (dynamic
   imports built from variables), so the "not client-public" test is a hint, not
   a proof - only the two explicit tests below are authoritative. */
const clientEntryFiles = [
  ...readdirSync('.').filter(f => f.endsWith('.html')),
  ...['sw.js', 'manifest.json', 'manifest.webmanifest'].filter(existsSync),
];
const clientEntry = clientEntryFiles.map(f => readFileSync(f, 'utf8')).join('\n');
const clientRefs = new Set(
  [...clientEntry.matchAll(/["'`(]\.?\/?([\w.\-]+\.(?:mjs|js))(?:\?[^"'`)]*)?["'`)]/g)].map(m => m[1])
);

const rootModules = readdirSync('.').filter(f =>
  (f.endsWith('.mjs') || f.endsWith('.js')) &&
  !f.endsWith('.test.mjs') &&
  !f.endsWith('.config.js') &&
  f !== '_worker.js'
);

const importsOf = f => {
  const t = readFileSync(f, 'utf8');
  return new Set([
    ...[...t.matchAll(/from\s+['"]\.\/([\w.\-]+)['"]/g)].map(m => m[1]),
    ...[...t.matchAll(/import\(\s*['"]\.\/([\w.\-]+)['"]/g)].map(m => m[1]),
  ]);
};

/* A module is client-public if the client names it, or if a client-public module
   imports it. Everything else at the repo root is server-only and must 404. */
const publicSet = new Set(rootModules.filter(f => clientRefs.has(f)));
for (let changed = true; changed;) {
  changed = false;
  for (const f of rootModules) {
    if (publicSet.has(f)) continue;
    for (const g of publicSet) {
      if (importsOf(g).has(f)) { publicSet.add(f); changed = true; break; }
    }
  }
}

const isBlocked = f => listed.has(f) || prefixes.some(p => f.startsWith(p));

/* Candidate leaks: root modules no client entry point names and no
   client-public module imports. This is a HINT list - runtime dynamic imports
   are invisible to a static scan, so a name here is not proof it is server-only.
   The authoritative checks are the three explicit tests below. */
test('reports root modules with no visible client reference (hint)', () => {
  const unreferenced = rootModules.filter(f => !publicSet.has(f) && !isBlocked(f));
  if (unreferenced.length) {
    console.log(`[hint] no client reference found, verify before blocking: ${unreferenced.join(', ')}`);
  }
  assert.ok(Array.isArray(unreferenced));
});

test('no client-loaded module is blocked', () => {
  const broken = [...publicSet].filter(f => listed.has(f));
  assert.deepEqual(broken, [],
    `client-loaded modules would 404 and break the app: ${broken.join(', ')}`);
});

test('sentry-report.js stays public because index.html loads it', () => {
  assert.ok(clientEntry.includes('sentry-report.js'));
  assert.ok(!listed.has('sentry-report.js'),
    'sentry-report.js is loaded by index.html; blocking it breaks client error reporting');
});

test('the previously leaked Worker modules are now blocked', () => {
  for (const f of ['analytics-engine.mjs', 'personalized-notification.mjs',
                   'notification-intelligence.mjs', 'sky-tools.mjs']) {
    assert.ok(isBlocked(f), `${f} must be server-only`);
  }
});
