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

/* Reachability: a suite that some workflow RUNS must also be a file that can
 * START that workflow.
 *
 * The check above asks "is this suite run anywhere", and it passed while 171
 * suite files across five workflows could not trigger the workflow that runs
 * them. Each of those workflows chose with a hand-written list of names and
 * partial globs; the lists were accurate when written and stopped growing when
 * the suites did. Editing one of the unlisted files started no workflow at all,
 * so the suite that covers it never ran — and every guard in this repository
 * reported green, because nothing was failing. Nothing was running.
 *
 * That is a different failure from the one above, and it needs its own check:
 * "run" and "reachable" are two claims, and the first is worth little without
 * the second.
 */
function pushFiltersFor(text) {
  const m = text.match(/^  push:\n((?:[ ]{4,}.*\n|\n)*)/m);
  if (!m || !m[1].includes('main')) return null;
  return [...m[1].matchAll(/^\s+-\s+'([^']+)'/gm)].map(x => x[1]);
}

function filterMatches(entry, file) {
  if (entry === file) return true;
  // `dir/**` covers everything under dir, at any depth — the check has to know
  // that, or it reports a gap that is already closed. (It did: `sky-ai/**` was
  // read as covering nothing, and eleven catalog suites were flagged as
  // unreachable when they are covered.)
  if (entry.endsWith('/**')) return file.startsWith(entry.slice(0, -2));
  if (entry.includes('*')) {
    // A single `*` does not cross a `/` in GitHub's path filters.
    const rx = new RegExp(`^${entry.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\u0000/g, '.*')}$`);
    return rx.test(file);
  }
  return false;
}

function scriptsOf() {
  return JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).scripts || {};
}

test('a suite a workflow runs can also trigger that workflow', () => {
  const scripts = scriptsOf();
  const scriptFiles = new Map();
  for (const [name, cmd] of Object.entries(scripts)) {
    if (!cmd.includes('.test.mjs')) continue;
    scriptFiles.set(name, [...cmd.matchAll(/([A-Za-z0-9_./-]+\.test\.mjs)/g)].map(m => m[1]));
  }

  const unreachable = [];
  for (const name of readdirSync(WORKFLOW_DIR)) {
    if (!name.endsWith('.yml') && !name.endsWith('.yaml')) continue;
    const text = readFileSync(join(WORKFLOW_DIR, name), 'utf8');
    const filters = pushFiltersFor(text);
    if (!filters) continue; // manual-only, or no push trigger: nothing to check
    const invoked = [...scriptFiles.keys()].filter(s => text.includes(`npm run ${s}`));
    for (const script of invoked) {
      for (const file of scriptFiles.get(script)) {
        if (!filters.some(entry => filterMatches(entry, file))) {
          unreachable.push(`${name} runs ${script} but '${file}' cannot trigger it`);
        }
      }
    }
  }
  assert.deepEqual(unreachable, [],
    'these suites run in a workflow that their own file cannot start — add the file to the trigger, or a glob that covers it');

  /* Non-vacuity. The check is only worth anything if it is looking at real
   * workflows with real filters; if the parsing stops matching, this must fail
   * rather than report a clean tree. (The scan this one replaces reported clean
   * for exactly that reason.) */
  const withFilters = readdirSync(WORKFLOW_DIR)
    .filter(n => n.endsWith('.yml'))
    .map(n => readFileSync(join(WORKFLOW_DIR, n), 'utf8'))
    .filter(t => pushFiltersFor(t) && [...scriptFiles.keys()].some(s => t.includes(`npm run ${s}`)));
  assert.ok(withFilters.length >= 4,
    `only ${withFilters.length} workflows were analysed; if the workflow layout moved, fix this check rather than letting it go quiet`);
});

/* A skipped test is a suite that does not run — the same blind spot as a suite
 * no workflow runs, one level down.
 *
 * Five tests carry `test.skip`, all for one documented reason (the owner removed
 * the post-signup "verify with Telegram" flow on 2026-10-18, so they drive UI
 * that cannot exist). Keeping the assertions is right: if that flow returns,
 * the tests should come back with it. What is wrong is that nothing counts
 * them. A skip added for a quick reason and never revisited is indistinguishable
 * from one added deliberately, and the count can only be trusted if it is
 * pinned.
 *
 * Pinned by NAME, not by count: a swap (one skip removed, another added) keeps
 * the total the same and would pass a count check while losing a test that
 * someone meant to restore. */
const PINNED_SKIPS = Object.freeze([
  'telegram-otp-auth.test.mjs: wrong, expired, locked, used, and superseded Telegram OTPs fail closed without another delivery',
  'telegram-otp-ui.test.mjs: mobile-first signup presents Verify with Telegram, START link, OTP box, checking, and authoritative success states',
  'telegram-otp-ui.test.mjs: existing unverified login offers the Telegram alternative without creating a frontend session',
  'telegram-otp-ui.test.mjs: Telegram UI renders wrong, expired, locked, unavailable, and resend states without guessing or retaining a code',
  'telegram-otp-ui.test.mjs: refresh and reopen recover both pre-START links and post-START code-entry state on Mobile Safari'
]);

test('every skipped test is named, and the list only shrinks', () => {
  const found = [];
  for (const file of testFiles()) {
    const path = join(ROOT, file);
    if (!existsSync(path)) continue;
    const source = readFileSync(path, 'utf8');
    /* `test.skip('name'` and `test.skip("name"` — the name is what identifies it.
     *
     * This file is skipped when scanning itself: the pattern above is written as
     * a literal in this source, so a scan that reads its own text finds the
     * pattern rather than a use of it and reports two phantom skips named
     * "name". (It did, on the first run.) The check is about tests, not about
     * the checker. */
    if (file === 'test-wiring-guard.test.mjs') continue;
    for (const m of source.matchAll(/test\.skip\(\s*['"]([^'"]+)['"]/g)) {
      found.push(`${file}: ${m[1]}`);
    }
  }
  const added = found.filter(entry => !PINNED_SKIPS.includes(entry));
  assert.deepEqual(added, [],
    `a test was skipped without being recorded here: ${added.join(' | ')}. A skip is a suite that does not run — either restore it or pin it deliberately.`);
  const restored = PINNED_SKIPS.filter(entry => !found.includes(entry));
  assert.deepEqual(restored, [],
    `these are no longer skipped — remove them from the list so the pin stays true: ${restored.join(' | ')}`);

  // Non-vacuity: the scan must actually be reading files that contain skips.
  assert.ok(found.length >= 5,
    `only ${found.length} skipped tests were found; if the syntax moved, fix this check rather than letting it go quiet`);
});
