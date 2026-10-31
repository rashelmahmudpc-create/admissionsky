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

// A workflow's `paths:` filter is a list of files that TRIGGER it, not files it
// runs. Reading the whole workflow as one haystack therefore counted a name in a
// trigger list as proof the suite executes — and three auth suites had been
// sitting in `auth-identity-guard.yml`'s path filter only, running nowhere, with
// this guard reporting them wired. Split the trigger block from the job body so
// the check only sees what actually runs.
function splitWorkflow(text) {
  const jobsAt = text.search(/^jobs:/m);
  if (jobsAt === -1) return { triggers: text, body: '' };
  return { triggers: text.slice(0, jobsAt), body: text.slice(jobsAt) };
}

function wiring() {
  const scripts = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).scripts || {};
  // Scripts are commands, so everything in them runs.
  const runs = [Object.values(scripts).join(' \n ')];
  // `on:` blocks are not runs; only the job bodies are.
  const triggers = [];
  for (const name of readdirSync(WORKFLOW_DIR)) {
    if (!name.endsWith('.yml') && !name.endsWith('.yaml')) continue;
    const { triggers: t, body } = splitWorkflow(readFileSync(join(WORKFLOW_DIR, name), 'utf8'));
    triggers.push(t);
    runs.push(body);
  }
  return { runs: runs.join('\n'), triggers: triggers.join('\n') };
}

function isWired(file, haystack) {
  // A directory glob counts as wiring for the files inside it.
  const dir = file.includes('/') ? file.slice(0, file.indexOf('/')) : null;
  const glob = dir ? new RegExp(`${dir}/\\*\\.test\\.mjs`) : null;
  const inRuns = haystack.runs.includes(file) || (glob ? glob.test(haystack.runs) : false);
  return inRuns;
}

// Kept for the non-vacuity assertions below: names that appear somewhere, so a
// test can tell "not wired" apart from "not present at all".
function isMentionedAnywhere(file, haystack) {
  return haystack.runs.includes(file) || haystack.triggers.includes(file);
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

test('a name in a path filter is not mistaken for a run', () => {
  // Built from a synthetic workflow rather than the real ones: once the orphan
  // suites are wired there is no live example left, and this must keep proving
  // the distinction forever.
  const workflow = [
    'name: example',
    'on:',
    '  push:',
    '    paths:',
    "      - 'only-a-trigger.test.mjs'",
    'jobs:',
    '  check:',
    '    steps:',
    '      - run: node --test a-real-suite.test.mjs',
  ].join('\n');
  const { triggers, body } = splitWorkflow(workflow);
  assert.match(triggers, /only-a-trigger\.test\.mjs/, 'the trigger block holds the path filter');
  assert.ok(!body.includes('only-a-trigger.test.mjs'), 'the job body must not hold it');
  assert.match(body, /a-real-suite\.test\.mjs/, 'a run line stays in the body');
  // And the real repo must have no suite living only in a path filter.
  const haystack = wiring();
  const fake = testFiles().filter((f) => !isWired(f, haystack) && isMentionedAnywhere(f, haystack));
  assert.deepEqual(fake, [], 'these are named in a path filter but no script or job runs them');
});

test('the wiring check itself is not vacuous', () => {
  const haystack = wiring();
  assert.ok(isWired('seo-routing.test.mjs', haystack), 'a known-run suite must be detected');
  assert.ok(!isWired('definitely-not-a-suite.test.mjs', haystack), 'an unknown suite must not be detected');
  assert.ok(testFiles().length > 100, `expected the audit to see every suite, saw ${testFiles().length}`);
});
