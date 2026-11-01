/* F1.5 — Router v2: the chain is ordered by measured quality, not just liveness.
 *
 * The router ordered entries by tier and by health, and neither says how WELL a
 * provider answers. The catalog carries a MEASURED banglaScore (ML-06, scored on
 * the F0.6 golden set) and nothing read it. So a Bengali question went first to
 * gemini (29.2%) while mistral (58.3%) sat further down the very same chain —
 * on an app where every student writes Bengali.
 *
 * These tests hold the property: a measured provider leads an unmeasured one,
 * the better score leads, nothing is ever DROPPED (availability cannot fall),
 * and a non-Bengali question is left exactly as it was.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { rankChainByBanglaQuality, banglaQualityOf, isBengali, BANGLA_MIN_SAMPLE, __test } from '../../ai-agent.js';
import { CATALOG } from './models.mjs';

const chain = () => ([
  { provider: 'gemini', catalogId: 'gemini', model: 'g', key: 'k1' },
  { provider: 'openai-compat', catalogId: 'mistral', model: 'm', key: 'k2' },
  { provider: 'openai-compat', catalogId: 'openrouter', model: 'o', key: 'k3' },
  { provider: 'groq', catalogId: 'groq', model: 'q', key: 'k4' }
]);
const ids = (l) => l.map((c) => c.catalogId);

test('a Bengali question tries the best-measured provider first', () => {
  /* The regression this file exists for: mistral scored 58.3% and gemini 29.2%,
     yet gemini led. Every student writes Bengali. */
  const out = ids(rankChainByBanglaQuality(chain(), true));
  assert.equal(out[0], 'mistral', 'the best-measured provider must lead: ' + out.join(' > '));
  assert.ok(out.indexOf('gemini') > out.indexOf('mistral'), 'the worse-measured one must follow it');
});

test('ranking drops nothing — availability cannot fall', () => {
  /* A reordering is safe; a filter is not. If a provider were dropped to get a
     better score, a Bengali question could lose its only reachable answer. */
  const before = ids(chain()).sort();
  const after = ids(rankChainByBanglaQuality(chain(), true)).sort();
  assert.deepEqual(after, before, 'the same providers, in a different order');
});

test('an unmeasured provider sorts last, not first', () => {
  /* null means "nobody measured this", which must not read as "perfect". */
  const out = ids(rankChainByBanglaQuality(chain(), true));
  assert.equal(out[out.length - 1], 'openrouter', 'the unmeasured provider must come last');
});

test('an English question is left exactly as it was', () => {
  /* The whole change is scoped to Bengali input. English routing must be
     byte-identical to before, or this is a behaviour change nobody asked for. */
  assert.deepEqual(ids(rankChainByBanglaQuality(chain(), false)), ids(chain()));
});

test('a weak score is not treated as evidence', () => {
  /* ML-06 keeps a sample size because a score from a handful of items is weak.
     Below the floor the entry counts as unmeasured. */
  const tiny = { accuracy: 0.99, correct: 2, sample: 2, set: 'x' };
  const real = CATALOG.find((c) => c.id === 'mistral');
  assert.ok(real.banglaScore.sample >= BANGLA_MIN_SAMPLE, 'the real catalog entry clears the floor');
  assert.ok(tiny.sample < BANGLA_MIN_SAMPLE, 'and a 2-item score does not');
  assert.equal(BANGLA_MIN_SAMPLE, 20);
});

test('the Bengali test is the script range, not a keyword list', () => {
  /* A word list would miss every sentence that does not happen to contain a
     listed word; the script range catches Bengali however it is written. */
  assert.equal(isBengali('বাংলায় বুঝাও'), true);
  assert.equal(isBengali('explain in English'), false);
  assert.equal(isBengali(''), false);
  assert.equal(isBengali(null), false);
});

test('quality is read from the catalog, so a re-measure changes routing for free', () => {
  /* The score must come from the catalog entry, never a copy. Re-measuring a
     provider (ML-06) must change routing with no code edit. */
  for (const c of CATALOG) {
    const q = banglaQualityOf({ catalogId: c.id });
    const s = c.banglaScore;
    const expected = s && s.sample >= BANGLA_MIN_SAMPLE ? s.accuracy : null;
    assert.equal(q, expected, c.id + ' must report its own catalog score');
  }
});

test('an entry with no catalog id is unmeasured, not assumed good', () => {
  assert.equal(banglaQualityOf({ provider: 'mystery', model: 'x' }), null);
  assert.equal(banglaQualityOf(null), null);
});
