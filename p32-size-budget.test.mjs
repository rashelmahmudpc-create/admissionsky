/* P32 — size budget ("আর ভারী হবে না" পাহারা).
 *
 * Speed blueprint T15 (Notion: "Admission Hub — স্পিড ব্লুপ্রিন্ট").
 * Measured 2026-10-23 on main @ 0efabbe:
 *   index.html 523,667 B raw (≈137 KB over the wire, Brotli)
 *   inline <script> ≈406,254 chars in 20 blocks · inline <style> ≈85,728 chars · 100 <script src> tags
 *   result-analysis-500.js 650,485 B · account-access.js 260,584 B
 *
 * These are CEILINGS, not targets: each sits ~3–5% above today's size so the
 * suite passes now and fails the moment the shell grows. When a blueprint task
 * (T4 inline-JS extraction, T6 bundling, ...) makes a file smaller, LOWER the
 * matching ceiling in the same PR so the win can never silently regress.
 * Never raise a ceiling to make a PR pass — shrink the change instead.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';

const KB = 1024;
const INDEX = readFileSync('index.html', 'utf8');

const BUDGET = {
  indexHtmlBytes: 540_000,
  inlineScriptBytes: 420_000,
  inlineStyleBytes: 90_000,
  scriptSrcTags: 100,
  files: {
    'result-analysis-500.js': 680_000,
    'account-access.js': 275_000,
    'vocabulary-master-tool.js': 172_000,
    'profile-ui.js': 154_000,
    'ai-agent-chat.js': 146_000,
  },
};

const sum = (re) => [...INDEX.matchAll(re)].reduce((n, m) => n + m[1].length, 0);

test('p32-১: index.html stays under its byte ceiling', () => {
  const size = Buffer.byteLength(INDEX, 'utf8');
  assert.ok(size <= BUDGET.indexHtmlBytes,
    `index.html is ${(size / KB).toFixed(1)} KB, ceiling ${(BUDGET.indexHtmlBytes / KB).toFixed(1)} KB — move code to an external ?v= file instead of inlining it`);
});

test('p32-২: inline <script> payload does not grow', () => {
  const size = sum(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g);
  assert.ok(size <= BUDGET.inlineScriptBytes,
    `inline JS is ${(size / KB).toFixed(1)} KB, ceiling ${(BUDGET.inlineScriptBytes / KB).toFixed(1)} KB — inline JS is re-downloaded on every visit; put it in a cached file`);
});

test('p32-৩: inline <style> payload does not grow', () => {
  const size = sum(/<style[^>]*>([\s\S]*?)<\/style>/g);
  assert.ok(size <= BUDGET.inlineStyleBytes,
    `inline CSS is ${(size / KB).toFixed(1)} KB, ceiling ${(BUDGET.inlineStyleBytes / KB).toFixed(1)} KB`);
});

test('p32-৪: no new <script src> tags (bundle instead of adding files)', () => {
  const count = (INDEX.match(/<script[^>]*\bsrc=/g) || []).length;
  assert.ok(count <= BUDGET.scriptSrcTags,
    `index.html has ${count} <script src> tags, ceiling ${BUDGET.scriptSrcTags} — add code to an existing bundle, or merge a fix-file into its owner`);
});

test('p32-৫: the heaviest client files stay under their ceilings', () => {
  for (const [file, ceiling] of Object.entries(BUDGET.files)) {
    const size = statSync(file).size;
    assert.ok(size <= ceiling,
      `${file} is ${(size / KB).toFixed(1)} KB, ceiling ${(ceiling / KB).toFixed(1)} KB — lazy-load or split it`);
  }
});
