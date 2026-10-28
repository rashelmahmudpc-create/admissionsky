// Every asset index.html loads must exist on disk AND survive the deploy bundle.
//
// The Pages bundle is not the repo: `deploy-pages-worker.yml` builds `dist/`
// with an rsync exclude list, so a file can be committed, referenced by the app
// and still 404 on the live site — the page loads, then a script silently fails.
// That is invisible below the fold and invisible to a test that only reads the
// repo, which is why the exclude list is the thing worth pinning.
//
// Measured on 24-10-2026: all 118 local assets referenced by index.html return
// 200 on https://admissionsky.pages.dev. This keeps it that way.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const WORKFLOW = join(ROOT, '.github', 'workflows', 'deploy-pages-worker.yml');
const ASSET_RE = /(?:src|href)="(?:\.\/)?([A-Za-z0-9_./-]+\.(?:js|css|png|ico|json|webmanifest))(?:\?[^"]*)?"/g;

function referencedAssets() {
  const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
  const refs = new Set();
  for (const m of html.matchAll(ASSET_RE)) refs.add(m[1]);
  assert.ok(refs.size > 50, `expected index.html to reference many local assets, found ${refs.size}`);
  return [...refs].sort();
}

function excludePatterns() {
  const yml = readFileSync(WORKFLOW, 'utf8');
  const line = yml.split('\n').find((l) => l.includes('rsync -a'));
  assert.ok(line, `could not find the rsync bundle line in ${WORKFLOW}; update this guard if the workflow changed shape`);
  const patterns = [...line.matchAll(/--exclude='([^']+)'/g)].map((m) => m[1]);
  assert.ok(patterns.length > 10, `expected the rsync exclude list to be parsed, got ${patterns.length} entries`);
  return patterns;
}

function excluded(relPath, patterns) {
  const segments = relPath.split('/');
  const glob = (pattern, value) => {
    const rx = new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`);
    return rx.test(value);
  };
  // A bare name ('worker-bundle.mjs') is matched as a basename; a directory rule
  // ('scripts', 'docs') has to be matched against each leading segment of the
  // path, not only against the whole path and the basename — otherwise a nested
  // file slipped past the guard.
  return patterns.find((p) => {
    for (let i = 1; i <= segments.length; i += 1) {
      if (glob(p, segments.slice(0, i).join('/'))) return true;
    }
    return false;
  });
}

test('every asset index.html loads exists on disk', () => {
  const missing = referencedAssets().filter((rel) => !existsSync(join(ROOT, rel)));
  assert.deepEqual(missing, [], `index.html references files that are not in the repo: ${missing.join(', ')}`);
});

test('the exclude matcher reads the real list (proves the guard is not vacuous)', () => {
  const patterns = excludePatterns();
  assert.equal(excluded('worker-bundle.mjs', patterns), 'worker-bundle.mjs', 'a known-excluded server file must be detected');
  assert.equal(excluded('docs/ci/notes.patch', patterns), 'docs', 'a directory rule must be detected');
  assert.equal(excluded('course-assets/x.test.mjs', patterns), '*.test.mjs', 'a glob rule must be detected');
  assert.equal(excluded('app-seed.js', patterns), undefined, 'a shipped asset must not be treated as excluded');
});

test('no asset index.html loads is stripped from the deploy bundle', () => {
  const patterns = excludePatterns();
  const stripped = referencedAssets()
    .map((rel) => [rel, excluded(rel, patterns)])
    .filter(([, pattern]) => pattern);
  assert.deepEqual(
    stripped.map(([rel, pattern]) => `${rel} (excluded by '${pattern}')`),
    [],
    'index.html loads an asset the Pages bundle drops, so it would 404 in production',
  );
});

// Same chain as the test above, but with a reference that is known to be
// stripped. Without it a green run only means "nothing here happens to be
// excluded", which is the vacuous pass this repo has been bitten by before.
test('the reference-to-exclusion chain really fires', () => {
  const patterns = excludePatterns();
  assert.equal(excluded('fcm-notification.mjs', patterns), 'fcm-notification.mjs');
  const caught = ['app-seed.js', 'fcm-notification.mjs']
    .map((rel) => [rel, excluded(rel, patterns)])
    .filter(([, pattern]) => pattern);
  assert.deepEqual(caught.map(([rel]) => rel), ['fcm-notification.mjs'], 'only the server-only file may be caught');
});
