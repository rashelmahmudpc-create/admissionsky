/* AUTH V2.4 (owner 2026-11-02): the silent catches, counted and pinned.
 *
 * The blueprint's fourth pillar is one sentence — "নীরব `catch {}` নিষিদ্ধ।
 * প্রতিটা ব্যর্থতা হয় লগে, নয় অ্যালার্টে, নয় দুটোতেই — কোনোটায় না থাকা চলবে
 * না" — and its risk table puts a number on the debt: "৩৩টা খালি `catch`".
 *
 * The number is wrong, and it is wrong by more than half. Measured across
 * `auth-native/` there are 75. (The first pass over this file said 61; the 14 it
 * missed are catches whose only content is a comment — an explanation for a
 * reader, nothing at all for the running system.) That gap between a documented
 * count and the real one is why this file exists: a debt nobody has measured
 * cannot be paid down, and a debt reported at half its size reads as small.
 *
 * This change removes nothing and changes no behaviour. Like the route
 * inventory (V2.3) and the dead schema (V2.4), it ships the measurement first,
 * because a change is only safe once what it changes is counted.
 *
 * What the guard holds:
 *
 *   • the exact set of silent catches is pinned, per file, so the list can only
 *     shrink by someone deciding it should — a new one fails here;
 *   • a catch that swallows a failure and says nothing fails here, comment or
 *     no comment, because the pillar is about the failure being visible — and a
 *     comment is visible to a reader, not to the system;
 *   • the count is asserted against the number the blueprint publishes, so the
 *     document cannot drift away from the code it describes.
 *
 * Deliberately NOT a ban. Several of these are correct and deliberate: a
 * best-effort cache write, a reporter that must never throw, a JSON.parse of a
 * column whose default is already handled. Banning them outright would force
 * worse code, so the pin is the mechanism: the count can only go down, and each
 * removal is a decision someone made rather than an accident a refactor made.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const ROOT = new URL('./', import.meta.url);
const AUTH_ROOT = new URL('./auth-native/', import.meta.url).pathname;

/* The silent catches as of this change. Pinned per file rather than as a total,
 * so a new one in one file cannot hide behind a fix in another. */
const PINNED = Object.freeze({
  'auth-native/verification/providers.mjs': 15,
  'auth-native/worker/public-auth-handler.mjs': 14,
  'auth-native/operations/live-mailbox-e2e.mjs': 5,
  'auth-native/verification/idp-providers.mjs': 5,
  'auth-native/worker/pending-signup-public.mjs': 5,
  'auth-native/providers/firebase-auth.mjs': 4,
  'auth-native/verification/orchestrator.mjs': 4,
  'auth-native/operations/live-placement-audit.mjs': 3,
  'auth-native/operations/prepare-production-secrets.mjs': 3,
  'auth-native/worker/pending-signup.mjs': 3,
  'auth-native/core/login-facts.mjs': 2,
  'auth-native/core/security-alerts.mjs': 2,
  'auth-native/worker/auth-authority-do.mjs': 2,
  'auth-native/core/auth-engine.mjs': 1,
  'auth-native/operations/audit-mailjet-recent-delivery.mjs': 1,
  'auth-native/operations/set-agentmail-display-name.mjs': 1,
  'auth-native/operations/verify-firebase-config.mjs': 1,
  'auth-native/operations/verify-google-browser-origin.mjs': 1,
  'auth-native/storage/sqlite-auth-repository.mjs': 1,
  'auth-native/verification/turnstile.mjs': 1,
  'auth-native/worker/auth-route.mjs': 1
});

/* `catch {}` and `catch (_) {}` — a block with no STATEMENT in it, whatever it
 * is bound to. A comment does not count as a statement, and that is deliberate:
 * the pillar is about a failure being visible — "প্রতিটা ব্যর্থতা হয় লগে, নয়
 * অ্যালার্টে" — and a comment gives a reader an explanation while giving the
 * running system nothing. Counting comment-only blocks as silent is what stops
 * the guard being bypassed by writing `catch { /* handled *\/ }`, which would
 * otherwise be the cheapest way past it and would leave the failure exactly as
 * invisible as before. */
const SILENT = /catch\s*(?:\([^)]*\))?\s*\{(?:\s|\/\*[\s\S]*?\*\/|\/\/[^\n]*)*\}/g;

const sourceFiles = () => {
  const walk = dir => readdirSync(dir).flatMap(name => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return walk(full);
    return full.endsWith('.mjs') ? [full] : [];
  });
  return walk(AUTH_ROOT);
};

const measure = () => {
  const found = {};
  for (const file of sourceFiles()) {
    const rel = relative(ROOT.pathname, file).split(sep).join('/');
    const count = (readFileSync(file, 'utf8').match(SILENT) || []).length;
    if (count) found[rel] = count;
  }
  return found;
};

test('V2.4-নীরব: the silent catches are counted, and the count only shrinks', () => {
  /* The load-bearing assertion. A new silent catch fails here and the author has
   * to either explain it or not write it — which is the whole point, because the
   * failure mode this pillar names is a catch nobody remembers adding. */
  const found = measure();
  const grown = Object.entries(found).filter(([file, n]) => n > (PINNED[file] || 0));
  assert.deepEqual(grown, [],
    `a new silent catch was added: ${grown.map(([f, n]) => `${f} (${PINNED[f] || 0} -> ${n})`).join(', ')}. `
    + 'Either give it a same-line reason (then add it here), or let the failure show.');

  // And the pin still describes reality, so a fix must come here to be recorded.
  const shrunk = Object.entries(PINNED).filter(([file, n]) => (found[file] || 0) < n);
  assert.deepEqual(shrunk, [],
    `these files now have fewer silent catches than pinned — lower the pin so the count is true: ${shrunk.map(([f]) => f).join(', ')}`);
});

test('V2.4-নীরব: every one of them is still a silent catch, none has quietly vanished', () => {
  /* The other direction, stated separately because the two failures mean
   * different things: one says "you added debt", this says "the file moved and
   * the pin is now pointing at nothing". */
  const found = measure();
  const missing = Object.keys(PINNED).filter(file => !found[file]);
  assert.deepEqual(missing, [],
    `these files no longer contain a silent catch — delete their pin so the guard stops covering a file that has none: ${missing.join(', ')}`);
});

test('V2.4-নীরব: the blueprint publishes a number, and it is this number', () => {
  /* The finding that started this: the document said 33, the code had 61. A
   * count in prose is a claim, and this is the only place it can be checked. If
   * the number changes, both sides change together or this fails. */
  const total = Object.values(measure()).reduce((sum, n) => sum + n, 0);
  const blueprint = readFileSync(new URL('./docs/AUTH-V2-BLUEPRINT.md', import.meta.url), 'utf8');

  /* Bengali digits are not `\d` — JavaScript's digit class is ASCII-only, so a
   * pattern written the obvious way matches nothing in this document and the
   * assertion would fail with "the blueprint still states a count" while the
   * count sits right there. The first version of this test did exactly that. */
  const BENGALI = '০১২৩৪৫৬৭৮৯';
  const toBengali = n => String(n).replace(/[0-9]/g, d => BENGALI[Number(d)]);
  const toWestern = s => s.replace(/[০-৯]/g, d => String(BENGALI.indexOf(d)));

  const claimed = [...blueprint.matchAll(/([০-৯0-9]+)\s*টা নীরব\s*`catch`/g)].map(m => Number(toWestern(m[1])));
  assert.ok(claimed.length > 0,
    'the blueprint no longer states a silent-catch count — the number is part of the finding, so keep it');

  // Every figure it publishes must be the measured one, so the document cannot
  // quietly keep a stale number beside a code base that moved on.
  assert.deepEqual(claimed.filter(n => n !== total), [],
    `the blueprint states ${claimed.join(', ')}; the code has ${total} (${toBengali(total)})`);
});
