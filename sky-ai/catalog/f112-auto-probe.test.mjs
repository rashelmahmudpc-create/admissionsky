/* F1.12 — Auto-probe: a recorded verification date nobody reads goes stale in
 * silence.
 *
 * ML-06 writes `verifiedAt` when a field was measured against a provider, and
 * nothing ever compared that date to today. A rate limit captured last year is
 * presented with the same confidence as one captured yesterday, so the catalog
 * quietly drifts away from the providers it describes — and every routing
 * decision reads it as current.
 *
 * These tests hold the property: the date yields a verdict, a missing date is
 * the oldest state rather than the newest, and the verdict survives a horizon
 * the caller chooses.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { CATALOG, catalogFreshness, catalogSummary, STALE_AFTER_DAYS } from './models.mjs';

test('a catalog verified long ago is reported stale, not silently current', () => {
  /* The regression this file exists for. */
  const future = new Date('2028-01-01');
  const f = catalogFreshness(future);
  assert.ok(f.stale.length > 0, 'a two-year-old catalog cannot be fresh');
  for (const e of f.entries) {
    if (e.verifiedAt) assert.equal(e.stale, true, e.id + ' should have expired');
  }
});

test('an entry verified today is fresh', () => {
  const today = new Date().toISOString().slice(0, 10);
  const f = catalogFreshness(new Date(today + 'T00:00:00Z'));
  for (const e of f.entries) {
    if (e.verifiedAt === today) assert.equal(e.stale, false, e.id + ' was verified today');
  }
});

test('a missing date is stale, not fresh', () => {
  /* "Never verified" is the oldest state there is. Treating unknown as current
     is exactly how drift hides. */
  const f = catalogFreshness(new Date('2026-11-01'));
  const never = f.entries.filter((e) => e.verifiedAt === null);
  assert.ok(never.length > 0, 'the catalog has unverified entries');
  for (const e of never) {
    assert.equal(e.stale, true);
    assert.equal(e.reason, 'never-verified');
  }
});

test('a future date is not evidence of freshness', () => {
  /* A typo or a clock problem still means the entry was not checked. */
  const f = catalogFreshness(new Date('2020-01-01'));
  for (const e of f.entries) {
    if (e.verifiedAt) assert.equal(e.stale, true, e.id + ' cannot be verified before it was written');
  }
});

test('the horizon is the caller\'s, not a buried constant', () => {
  const t = new Date('2026-11-01');
  const tight = catalogFreshness(t, 0);
  const loose = catalogFreshness(t, 3650);
  assert.ok(tight.stale.length >= loose.stale.length, 'a tighter horizon cannot find less');
  assert.equal(loose.stale.length, catalogFreshness(t, 3650).stale.length, 'deterministic');
});

test('the owner-facing summary carries the staleness count', () => {
  /* `verified` counts dates; `stale` counts expired ones. Reporting only the
     first reads as "all good" for a catalog verified a year ago. */
  const today = new Date('2026-11-01');
  const s = catalogSummary(today);
  assert.equal(s.stale, catalogFreshness(today).stale.length);
  assert.equal(s.providers, CATALOG.length);
  assert.ok(s.verified >= s.providers - s.stale);
});

test('the default horizon is 90 days', () => {
  assert.equal(STALE_AFTER_DAYS, 90);
  assert.equal(catalogFreshness(new Date('2026-11-01')).maxAgeDays, 90);
});
