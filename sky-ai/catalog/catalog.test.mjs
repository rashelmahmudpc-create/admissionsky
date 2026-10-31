/* F1.1 — tests for the model catalog.
 *
 * The catalog is a single source of truth, so these tests hold two things that
 * would otherwise rot silently:
 *
 *   1. INTERNAL CONSISTENCY — no duplicate provider, every entry well-formed,
 *      every capability from the closed set, every adapter known.
 *   2. THE ROUTER ACTUALLY READS IT — the router's own provider list and its
 *      Gemini tiers must be derivable from the catalog, so a model can never be
 *      "known to the router" and absent from the catalog. This is the drift the
 *      file exists to prevent, so it is asserted rather than trusted.
 *
 * The unverified fields (limits/tos/banglaScore/verifiedAt) are null ON PURPOSE:
 * page ০৬ forbids writing them from guesswork, and they are filled in ML-06. The
 * test asserts the gap list is honest and countable, not that it is empty.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { CATALOG, CAPABILITY, ADAPTERS, COMPAT_PROVIDERS, tierModels, modelsFor, researchGaps, catalogSummary } from './models.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..');

test('every provider is well-formed and uniquely identified', () => {
  assert.ok(CATALOG.length >= 15, `only ${CATALOG.length} providers; page ০৬ asks for 15-20`);
  const ids = new Set();
  const keys = new Set();
  for (const c of CATALOG) {
    assert.ok(c.id && c.id.trim(), 'entry without id');
    assert.ok(!ids.has(c.id), `duplicate provider id: ${c.id}`);
    ids.add(c.id);
    assert.ok(c.label && c.label.trim(), `${c.id}: no label`);
    assert.ok(ADAPTERS.includes(c.adapter), `${c.id}: unknown adapter ${c.adapter}`);
    assert.ok(c.key && /^[A-Z0-9_]+$/.test(c.key), `${c.id}: bad credential name ${c.key}`);
    assert.ok(!keys.has(c.key), `duplicate credential name: ${c.key}`);
    keys.add(c.key);
    assert.ok(Array.isArray(c.models) && c.models.length > 0, `${c.id}: no default model`);
    assert.ok(Array.isArray(c.capability) && c.capability.length > 0, `${c.id}: no capability`);
    for (const cap of c.capability) {
      assert.ok(Object.values(CAPABILITY).includes(cap), `${c.id}: unknown capability ${cap}`);
    }
    // An OpenAI-compatible entry must have a URL; a native adapter must not need one.
    if (c.adapter === 'openai-compat') assert.ok(/^https:\/\//.test(c.url || ''), `${c.id}: compat entry needs an https url`);
  }
});

test('no credential value is ever stored in the catalog', () => {
  // Only NAMES belong here. A value would look like a long token, not an env name.
  for (const c of CATALOG) {
    assert.ok(!/\s/.test(c.key), `${c.id}: key name contains whitespace`);
    assert.ok(c.key.length <= 40, `${c.id}: key name is suspiciously long for a name`);
  }
});

test('the router derives its provider list from the catalog (no drift)', () => {
  const src = readFileSync(join(REPO, 'ai-agent.js'), 'utf8');
  // The router must use the catalog, not a private array.
  assert.match(src, /COMPAT_PROVIDERS\s*=\s*CATALOG_COMPAT/, 'ai-agent.js must take COMPAT_PROVIDERS from the catalog');
  assert.match(src, /tierModels\('gemini'\)/, 'ai-agent.js must take the Gemini tiers from the catalog');
  // And the derived list must match what the catalog holds.
  const compatInCatalog = CATALOG.filter((c) => c.adapter === 'openai-compat');
  assert.equal(COMPAT_PROVIDERS.length, compatInCatalog.length);
  for (const p of COMPAT_PROVIDERS) {
    assert.ok(compatInCatalog.some((c) => c.key === p.key && c.url === p.url), `compat provider not from the catalog: ${p.key}`);
  }
});

test('the Gemini tiers are the catalog tiers', () => {
  const t = tierModels('gemini');
  assert.deepEqual(t, { FAST: 'gemini-3.1-flash-lite', SMART: 'gemini-3-flash-preview' });
  assert.deepEqual(modelsFor('gemini'), [t.FAST, t.SMART]);
});

test('the unverified fields are honest: reported, not guessed', () => {
  const gaps = researchGaps();
  const summary = catalogSummary();
  // Every provider with a null researched field must appear in the gap list...
  for (const c of CATALOG) {
    const hasGap = c.limits == null || c.tos == null || c.banglaScore == null || c.verifiedAt == null;
    assert.equal(gaps.some((g) => g.id === c.id), hasGap, `${c.id}: gap list disagrees with the entry`);
  }
  // ...and the summary counts must agree with the entries, so the number the
  // owner sees cannot drift from the data.
  assert.equal(summary.providers, CATALOG.length);
  assert.equal(summary.withLimits, CATALOG.filter((c) => c.limits != null).length);
  assert.equal(summary.withTos, CATALOG.filter((c) => c.tos != null).length);
  assert.equal(summary.withBanglaScore, CATALOG.filter((c) => c.banglaScore != null).length);
});

test('an unknown provider yields an empty list, not a crash', () => {
  assert.deepEqual(modelsFor('nope-not-a-provider'), []);
  assert.equal(tierModels('groq'), null);
});

/* ML-06 — a filled research field must be AUDITABLE and must not overclaim.
 *
 * The gap test above keeps "unverified" honest. This one keeps "verified"
 * honest, which is the opposite failure and the easier one to commit: a number
 * written from memory, or a score from a handful of items presented as a
 * result. Both are checked here so ML-06 cannot quietly degrade into guesswork.
 */
test('a filled limit cites its source, and the numbers are positive', () => {
  for (const c of CATALOG) {
    if (c.limits == null) continue;
    assert.ok(typeof c.limits.source === 'string' && /^https:\/\//.test(c.limits.source),
      `${c.id}: a limit without a source URL is not auditable`);
    for (const [k, v] of Object.entries(c.limits)) {
      if (k === 'source') continue;
      assert.ok(typeof v === 'number' && v > 0, `${c.id}: limits.${k} must be a positive number`);
    }
  }
});

test('a banglaScore carries its sample size, and never claims more than it ran', () => {
  for (const c of CATALOG) {
    if (c.banglaScore == null) continue;
    const b = c.banglaScore;
    assert.equal(b.set, 'golden-v1', `${c.id}: a score must name the set it came from`);
    assert.ok(Number.isInteger(b.sample) && b.sample > 0, `${c.id}: a score needs a sample size`);
    assert.ok(Number.isInteger(b.correct) && b.correct >= 0, `${c.id}: correct must be a count`);
    assert.ok(b.correct <= b.sample, `${c.id}: correct cannot exceed the sample`);
    assert.ok(Math.abs(b.accuracy - b.correct / b.sample) < 0.001, `${c.id}: accuracy must match correct/sample`);
    /* A 24-item sample is a signal, not a verdict. Recording the sample size is
       what stops a weak number from reading like a full-set run. */
    assert.ok(b.sample >= 20, `${c.id}: a sample below 20 is too small to record`);
  }
});

test('verifiedAt is a date, and only set where something was actually learned', () => {
  for (const c of CATALOG) {
    if (c.verifiedAt == null) continue;
    assert.match(c.verifiedAt, /^\d{4}-\d{2}-\d{2}$/, `${c.id}: verifiedAt must be an ISO date`);
    const learned = c.limits != null || c.tos != null || c.banglaScore != null;
    assert.ok(learned, `${c.id}: verifiedAt is set but nothing was verified`);
  }
});
