// A test suite that no workflow runs is not a guard (জ-style sweep).
//
// On 25-10-2026 an audit found 45 `*.test.mjs` files named in neither
// `package.json` nor any workflow — 322 passing assertions that would have
// caught a regression and never did. One of them (sky-instructions) had even
// drifted into a failing assertion, silently, because nothing ran it.
//
// This test is the door that stops that from coming back: add a suite, wire it
// in the same change, or this fails.

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const WORKFLOW_DIR = join(ROOT, '.github', 'workflows');

function testFiles() {
  const files = readdirSync(ROOT).filter((f) => f.endsWith('.test.mjs'));
  const skyAi = join(ROOT, 'sky-ai');
  if (existsSync(skyAi)) {
    // A directory whose suites are run by a glob does not need a per-file entry.
    for (const f of readdirSync(skyAi)) if (f.endsWith('.test.mjs')) files.push(`sky-ai/${f}`);
  }
  return files;
}

function wiring() {
  const scripts = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).scripts || {};
  let haystack = Object.values(scripts).join(' \n ');
  for (const name of readdirSync(WORKFLOW_DIR)) {
    if (!name.endsWith('.yml') && !name.endsWith('.yaml')) continue;
    haystack += `\n${readFileSync(join(WORKFLOW_DIR, name), 'utf8')}`;
  }
  return haystack;
}

function isWired(file, haystack) {
  // A directory glob counts as wiring for the files inside it.
  const dir = file.includes('/') ? file.slice(0, file.indexOf('/')) : null;
  return haystack.includes(file) || (dir ? new RegExp(`${dir}/\\*\\.test\\.mjs`).test(haystack) : false);
}

test('no test suite is left without a workflow that runs it', () => {
  const haystack = wiring();
  const orphans = testFiles().filter((file) => !isWired(file, haystack));
  assert.deepEqual(
    orphans,
    [],
    'these suites run in no script and no workflow — wire them (usually test:shell-guards) or delete them',
  );
});

test('the wiring check itself is not vacuous', () => {
  const haystack = wiring();
  assert.ok(isWired('seo-routing.test.mjs', haystack), 'a known-run suite must be detected');
  assert.ok(!isWired('definitely-not-a-suite.test.mjs', haystack), 'an unknown suite must not be detected');
  assert.ok(testFiles().length > 100, `expected the audit to see every suite, saw ${testFiles().length}`);
});
