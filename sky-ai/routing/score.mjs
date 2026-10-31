/* F1 — routing scorer.
 *
 * Pure: given the labelled set and the two functions that make the real
 * decision, it reports how often the code agrees with the human label, split
 * by intent and by tier, so a miss names WHAT is wrong (wrong intent, wrong
 * tier, or both) instead of only lowering a number.
 *
 * Accuracy is counted per case on the pair (intent, tier): a case routed to the
 * right intent but the wrong tier is a miss, because the tier is what spends
 * quota — the whole reason the router exists.
 */

export function normalize(s) {
  return String(s == null ? '' : s).trim().replace(/\s+/g, ' ');
}

/** Run one case through the real decision path. `deps` are injected so the
 *  scorer can be tested without importing the Worker bundle. */
export function predict(c, deps) {
  const { classifyIntent, routeTier } = deps;
  const c1 = classifyIntent(c.q);
  const r = routeTier(c1.intent, c.q, c1.tier);
  return { intent: c1.intent, tier: r.tier, confidence: c1.confidence, downgraded: Boolean(r.downgraded) };
}

export function score(set, deps) {
  const items = set.items || [];
  const misses = [];
  const byIntent = {};
  const byTier = {};
  let ok = 0;
  for (const c of items) {
    const p = predict(c, deps);
    const intentOk = p.intent === c.intent;
    const tierOk = p.tier === c.tier;
    const hit = intentOk && tierOk;
    if (hit) ok++;
    else misses.push({ id: c.id, q: c.q, want: { intent: c.intent, tier: c.tier }, got: p, why: c.why });
    const bi = (byIntent[c.intent] ||= { n: 0, ok: 0 });
    bi.n++; if (intentOk) bi.ok++;
    const bt = (byTier[c.tier] ||= { n: 0, ok: 0 });
    bt.n++; if (tierOk) bt.ok++;
  }
  const n = items.length;
  return {
    n,
    ok,
    accuracy: n ? ok / n : 0,
    bar: set.bar ?? 0.9,
    pass: n ? ok / n >= (set.bar ?? 0.9) : false,
    byIntent,
    byTier,
    misses,
  };
}
