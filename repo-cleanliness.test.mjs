/* F0.8 — repo cleanliness guard (blueprint v1.0, owner order 2026-10-31).
 *
 * The phase's deliverable is the list in docs/sky-blueprint/F0.8-repo-cleanliness.md.
 * A list alone rots: it names today's mess, and tomorrow's mess arrives
 * unnamed. This guard locks the four OBJECTIVE rules from that document so the
 * measurable part cannot grow back:
 *
 *   1. no temp/junk file is tracked,
 *   2. every workflow has a name,
 *   3. no new orphan root source file (a .js/.mjs no tracked file mentions),
 *   4. a one-shot ops workflow is never reachable from push/PR/schedule,
 *   5. no tracked file carries an unresolved git conflict marker.
 *
 * It does NOT try to enforce the judgement calls (branch count, doc sprawl,
 * which one-shot workflow to archive). Those stay on the list for the owner.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const WORKFLOWS = join(ROOT, '.github', 'workflows');

function tracked() {
  return execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' })
    .split('\n').filter(Boolean);
}

test('rule 1: no temp or junk file is tracked', () => {
  const JUNK = /(^|\/)(node_modules\/|\.env$|\.DS_Store$)|\.(log|tmp|bak|orig|swp|swo)$/;
  const bad = tracked().filter((f) => JUNK.test(f));
  assert.deepEqual(bad, [], `junk files are tracked — remove them and gitignore the pattern: ${bad.join(', ')}`);
});

test('rule 2: every workflow has a name', () => {
  const unnamed = readdirSync(WORKFLOWS)
    .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
    .filter((f) => !/^name:\s*\S/m.test(readFileSync(join(WORKFLOWS, f), 'utf8')));
  assert.deepEqual(unnamed, [], `a workflow with no name: shows as its path in the Actions list: ${unnamed.join(', ')}`);
});

test('rule 3: no new orphan root source file', () => {
  // Files that are unreferenced BY DESIGN. Each needs a reason, so the next
  // agent does not "fix" it by deleting something that must stay.
  const ALLOWED = {
    // no-op stub at a deleted asset path; a stale cached shell still requests
    // it and would crash on #dots without it (header says bump sw.js first).
    'exam-center-sky.js': 'deliberate no-op stub for a stale cached shell',
    // one-time PWA migration, already run on the installed app; on the F0.8
    // list as a removal candidate pending the owner's OK.
    'vocabulary-range-cleanup.js': 'finished one-time migration, removal pending',
  };
  const files = tracked();
  const text = new Set(files.filter((f) => /\.(js|mjs|html|json|md|yml|yaml|toml|py|txt|css)$/.test(f)));
  const corpus = [...text].map((f) => { try { return readFileSync(join(ROOT, f), 'utf8'); } catch { return ''; } }).join('\n');
  const src = files.filter((f) => !f.includes('/') && /\.(js|mjs)$/.test(f) && !f.endsWith('.test.mjs'));
  const orphans = src.filter((f) => !ALLOWED[f] && !corpus.includes(f));
  assert.deepEqual(orphans, [],
    `these root source files are referenced nowhere — delete them, or add to ALLOWED with a reason: ${orphans.join(', ')}`);
});

test('rule 4: a one-shot ops workflow is never on an automatic trigger', () => {
  const ONESHOT = /(apply|revert|set-|rotate|wipe|backfill|bootstrap|provision|inventory|migrate)/;
  const AUTO = /^\s{2}(push|pull_request|schedule):/m;
  const bad = [];
  for (const f of readdirSync(WORKFLOWS)) {
    if (!f.endsWith('.yml') && !f.endsWith('.yaml')) continue;
    const name = f.replace(/\.ya?ml$/, '');
    if (!ONESHOT.test(name)) continue;
    const body = readFileSync(join(WORKFLOWS, f), 'utf8');
    const on = body.match(/^on:\s*([\s\S]*?)(?=^\S)/m);
    if (on && AUTO.test(on[1])) bad.push(f);
  }
  assert.deepEqual(bad, [],
    `a one-shot ops workflow must be workflow_dispatch only, it can mutate live state: ${bad.join(', ')}`);
});

test('rule 5: no tracked file carries a git conflict marker', () => {
  // PR #284 merged with its markers still in place. Nothing noticed, because a
  // marker is ordinary text everywhere: one file made GitHub refuse to run the
  // workflow (every push failed in 0s), another turned a guard into a syntax
  // error, and a third made the release-pin guard compare pins that no longer
  // ship. The map below lists the markers that are already known and owned by a
  // pending fix. An entry that outlives its marker is reported as a warning, not
  // a failure: the guard must stay green while the fix and this file's cleanup
  // land separately, but the entry must not go quiet either.
  const PENDING_FIX = {
    '.github/workflows/telegram-auth-canary-activate.yml':
      '#284 left markers here; removing them needs the workflow scope, which no agent token has',
  };
  const MARKER = /^(?:<{7}|>{7})(?: |$)/m;
  const SCANNED = /\.(js|mjs|cjs|json|md|yml|yaml|html|css|txt|toml|py|sh|ts)$/;
  const marked = tracked()
    .filter((f) => SCANNED.test(f))
    .filter((f) => { try { return MARKER.test(readFileSync(join(ROOT, f), 'utf8')); } catch { return false; } });
  const unexpected = marked.filter((f) => !PENDING_FIX[f]);
  assert.deepEqual(unexpected, [],
    `resolve these conflict markers before merging: ${unexpected.join(', ')}`);
  const stale = Object.keys(PENDING_FIX).filter((f) => !marked.includes(f));
  if (stale.length) {
    // A warning, not a failure: the marker is already gone, so the rule is
    // satisfied. What is left is bookkeeping — an exception that no longer
    // covers anything. It must be deleted, or the next marker in that file
    // would be waved through.
    const note = `these files no longer carry markers — delete their PENDING_FIX entry so the guard covers them again: ${stale.join(', ')}`;
    console.warn(`::warning title=stale marker exception::${note}`);
  }
});

test('the guard is not vacuous', () => {
  // If the repo walk silently found nothing, every rule above passes for free.
  assert.ok(tracked().length > 300, `expected to see the whole repo, saw ${tracked().length} files`);
  assert.ok(readdirSync(WORKFLOWS).length > 40, 'expected to see the workflows');
  assert.ok(existsSync(join(ROOT, 'docs', 'sky-blueprint', 'F0.8-repo-cleanliness.md')),
    'the F0.8 list this guard belongs to must exist');
});
