// Canonical coverage guard (task ঙ১ in the owner's Notion list).
//
// The 24-10-2026 audit reported "৫টা সেকেন্ডারি পেজে canonical নেই". Every page
// that is *meant* to be indexed now carries exactly one canonical on the live
// host; the pages without one are noindex control panels, which is correct and
// must stay allowed. So the thing worth guarding is not "every file has a
// canonical" — that would force one onto students-control-center.html and could
// later conflict with its X-Robots-Tag — but two rules:
//
//   1. an indexable page must have exactly one canonical, absolute, https, on
//      https://admissionsky.pages.dev and pointing at its own path;
//   2. a canonical must never name the retired host. The k1 SEO pass moved 18
//      files off `admissionhub`; a single copy-paste can move one back, and
//      Google would then be told the old address is the real page.
//
// Derived from the files on disk, not from a hardcoded list, so a new landing
// page is covered the day it is added.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const LIVE_ORIGIN = 'https://admissionsky.pages.dev';
const RETIRED_ORIGINS = ['admissionhub.pages.dev', 'sheikhrashel47-stack.github.io'];

function htmlFiles() {
  const files = readdirSync(ROOT)
    .filter((f) => f.endsWith('.html'))
    .map((f) => [f, f === 'index.html' ? '' : f]);
  const coursesDir = join(ROOT, 'courses');
  if (existsSync(coursesDir)) {
    for (const slug of readdirSync(coursesDir, { withFileTypes: true })) {
      if (!slug.isDirectory()) continue;
      const entry = join('courses', slug.name, 'index.html');
      if (existsSync(join(ROOT, entry))) files.push([entry, `courses/${slug.name}/`]);
    }
  }
  return files;
}

function canonicals(html) {
  return [...html.matchAll(/<link\b[^>]*\brel\s*=\s*["']canonical["'][^>]*>/gi)]
    .map((m) => (/\bhref\s*=\s*["']([^"']+)["']/i.exec(m[0]) || [])[1])
    .filter(Boolean);
}

function isNoindex(html) {
  for (const m of html.matchAll(/<meta\b[^>]*\bname\s*=\s*["']robots["'][^>]*>/gi)) {
    const content = (/\bcontent\s*=\s*["']([^"']+)["']/i.exec(m[0]) || [])[1] || '';
    if (/noindex/i.test(content)) return true;
  }
  return false;
}

test('ঙ১ — every indexable page has exactly one canonical on the live host', () => {
  const checked = [];
  for (const [file, path] of htmlFiles()) {
    const html = readFileSync(join(ROOT, file), 'utf8');
    assert.ok(html.length > 0, `${file} is empty`);
    if (isNoindex(html)) continue;

    const found = canonicals(html);
    assert.equal(found.length, 1, `${file} must carry exactly one <link rel="canonical">, found ${found.length}`);

    const href = found[0];
    assert.match(href, /^https:\/\//, `${file} canonical must be absolute https: ${href}`);
    const expected = `${LIVE_ORIGIN}/${path}`;
    assert.equal(href, expected, `${file} canonical must point at ${expected}`);
    checked.push(file);
  }
  assert.ok(checked.includes('index.html'), 'the root page must be part of the coverage');
  assert.ok(checked.length >= 6, `expected at least 6 indexable pages, checked ${checked.length}`);
});

test('ঙ১ — no canonical names a retired host', () => {
  for (const [file] of htmlFiles()) {
    const html = readFileSync(join(ROOT, file), 'utf8');
    for (const href of canonicals(html)) {
      for (const host of RETIRED_ORIGINS) {
        assert.ok(!href.includes(host), `${file} canonical still points at the retired host: ${href}`);
      }
    }
  }
});

test('ঙ১ — the crawler files agree with the canonical host', () => {
  const robots = readFileSync(join(ROOT, 'robots.txt'), 'utf8');
  const sitemap = readFileSync(join(ROOT, 'sitemap.xml'), 'utf8');
  assert.match(robots, new RegExp(`Sitemap:\\s*${LIVE_ORIGIN.replace(/\./g, '\\.')}/sitemap\\.xml`),
    'robots.txt must advertise the live sitemap');
  for (const match of sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)) {
    assert.ok(match[1].startsWith(`${LIVE_ORIGIN}/`), `sitemap entry is not on the live host: ${match[1]}`);
  }
});

test('ঙ১ — every indexable page is listed in sitemap.xml', () => {
  const sitemap = readFileSync(join(ROOT, 'sitemap.xml'), 'utf8');
  const listed = new Set([...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]));

  const missing = [];
  for (const [file, path] of htmlFiles()) {
    const html = readFileSync(join(ROOT, file), 'utf8');
    if (isNoindex(html)) continue;
    const url = `${LIVE_ORIGIN}/${path}`;
    if (!listed.has(url)) missing.push(`${file} -> ${url}`);
  }

  assert.deepEqual(missing, [], 'a page Google may index is not in sitemap.xml');
});
