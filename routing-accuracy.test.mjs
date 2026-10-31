/* F1 — routing accuracy guard.
 *
 * The F1 Done-condition is "রাউটিং নির্ভুলতা ≥ ৯০%". Before this file nothing
 * stated what the RIGHT route was, so the number could not be checked at all.
 * Two labelled sets now exist, and this pins three things:
 *
 *   1. the yardstick is sound (every case is a real claim with a reason),
 *   2. the classifier MEETS the 90% bar on BOTH sets, and
 *   3. the scorer itself grades correctly — a scorer that always says "pass"
 *      would satisfy (2) for free.
 *
 * The two sets are kept honest by being separate: `routing-set-v1` was used to
 * fix the classifier; `routing-holdout-v1` was written as an independent second
 * pass and is never tuned against, so it is the number allowed to disagree.
 *
 * Hermetic: no network, no keys. It imports the real classifier, which is the
 * whole point — a copy of the routing rules here could drift from the Worker.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { score, predict } from './sky-ai/routing/score.mjs';
import { classifyIntent } from './ai-agent.js';
import { routeTier } from './ai-tier-router.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const deps = { classifyIntent, routeTier };
const load = (f) => JSON.parse(readFileSync(join(HERE, 'sky-ai', 'routing', f), 'utf8'));
const SET = load('routing-set-v1.json');
const HOLDOUT = load('routing-holdout-v1.json');

for (const [name, set] of [['routing-set-v1', SET], ['routing-holdout-v1', HOLDOUT]]) {
  test(`${name}: the set is sound (ids unique, labels valid, every case reasoned)`, () => {
    assert.ok(set.items.length >= 30, `only ${set.items.length} cases`);
    assert.equal(set.count, set.items.length);
    const ids = new Set();
    for (const c of set.items) {
      assert.ok(c.q && c.q.trim(), `empty question: ${c.id}`);
      assert.ok(!ids.has(c.id), `duplicate id ${c.id}`);
      ids.add(c.id);
      assert.ok(['GENERAL_CHAT', 'ACADEMIC_EXPLAIN', 'PERFORMANCE_REQUEST', 'QUIZ_REQUEST', 'SEARCH_REQUEST', 'IMAGE_REQUEST'].includes(c.intent), `bad intent ${c.id}: ${c.intent}`);
      assert.ok(['FAST', 'SMART'].includes(c.tier), `bad tier ${c.id}: ${c.tier}`);
      // Every label carries a human reason, so a change that flips it must argue.
      assert.ok(c.why && c.why.trim(), `no reason on ${c.id}`);
    }
    // No question may appear twice across the two sets, or the holdout is not held out.
    const other = name === 'routing-set-v1' ? HOLDOUT : SET;
    const otherQ = new Set(other.items.map((c) => c.q));
    const overlap = set.items.filter((c) => otherQ.has(c.q));
    assert.deepEqual(overlap, [], `a question is in both sets, so the holdout is not held out: ${overlap.map((c) => c.q).join(' | ')}`);
  });

  test(`${name}: routing accuracy meets the 90% F1 bar`, () => {
    const res = score(set, deps);
    assert.equal(res.bar, 0.9);
    const detail = res.misses.map((m) => `${m.id} "${m.q}" got ${m.got.intent}/${m.got.tier} want ${m.want.intent}/${m.want.tier}`).join('; ');
    assert.ok(res.pass, `routing accuracy ${(res.accuracy * 100).toFixed(1)}% (${res.ok}/${res.n}) is below the 90% bar: ${detail}`);
  });
}

test('the scorer is not vacuous: a wrong label is a miss, not a pass', () => {
  // Flip one label; the score must drop and the case must be reported.
  const flipped = { ...SET, items: SET.items.map((c, i) => (i === 0 ? { ...c, tier: c.tier === 'FAST' ? 'SMART' : 'FAST' } : c)) };
  const res = score(flipped, deps);
  assert.ok(res.misses.length >= 1, 'a deliberately wrong label produced no miss');
  assert.ok(res.accuracy < 1, 'a deliberately wrong label did not lower the score');
});

test('the scorer agrees with the real decision path', () => {
  // predict() must be the same two calls the Worker makes, not a re-implementation.
  const c = SET.items.find((x) => x.intent === 'QUIZ_REQUEST');
  const p = predict(c, deps);
  const direct = classifyIntent(c.q);
  assert.equal(p.intent, direct.intent);
  assert.equal(p.tier, routeTier(direct.intent, c.q, direct.tier).tier);
});
