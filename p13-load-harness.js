/* Admission Hub, P13 load-test harness (pure, offline).
 *
 * Simulates many concurrent students hitting the read path and reports the
 * latency distribution + error rate, so a scaling claim is measured. It drives
 * an injected `request()` fn (a fetch wrapper in production, a fake in tests),
 * which is what keeps it runnable in CI without a network.
 *
 * Reports p50/p95/p99 and a pass/fail verdict against explicit budgets, so a
 * regression fails the run instead of being noticed in production.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.AhP13Load = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const num = (v, d = 0) => { const n = Number(v); return isFinite(n) ? n : d; };

  function percentile(sorted, p) {
    if (!sorted.length) return 0;
    const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
    return sorted[idx];
  }

  function summarize(samples) {
    const ok = samples.filter(s => s.ok);
    const times = ok.map(s => s.ms).sort((a, b) => a - b);
    const errors = samples.length - ok.length;
    return {
      total: samples.length,
      ok: ok.length,
      errors,
      errorRate: samples.length ? errors / samples.length : 0,
      p50: percentile(times, 50),
      p95: percentile(times, 95),
      p99: percentile(times, 99),
      mean: times.length ? times.reduce((a, b) => a + b, 0) / times.length : 0,
      max: times.length ? times[times.length - 1] : 0,
    };
  }

  /* Run `users` concurrent workers, each issuing `perUser` requests, never more
     than `concurrency` in flight at once. Returns every sample plus a summary. */
  async function run(options = {}) {
    const users = Math.max(1, num(options.users, 1));
    const perUser = Math.max(1, num(options.perUser, 1));
    const concurrency = Math.max(1, num(options.concurrency, users));
    const request = typeof options.request === 'function' ? options.request : async () => ({});
    const now = typeof options.now === 'function' ? options.now : () => Date.now();
    const total = users * perUser;
    const samples = [];
    let next = 0;

    async function worker() {
      while (true) {
        const i = next++;
        if (i >= total) return;
        const started = now();
        let ok = true;
        try { await request(i); } catch (_) { ok = false; }
        samples.push({ i, ok, ms: Math.max(0, now() - started) });
      }
    }

    const pool = [];
    for (let c = 0; c < Math.min(concurrency, total); c++) pool.push(worker());
    await Promise.all(pool);

    const summary = summarize(samples);
    const budget = options.budget || {};
    const verdict = {
      p95Ok: budget.p95 === undefined || summary.p95 <= budget.p95,
      errorRateOk: budget.errorRate === undefined || summary.errorRate <= budget.errorRate,
    };
    return { summary, verdict, pass: verdict.p95Ok && verdict.errorRateOk };
  }

  /* A deterministic, seeded request generator for repeatable CI runs: it returns
     a fake read-path request whose latency follows a simple model, so the harness
     itself is tested rather than a flaky network. */
  function fakeRequests(options = {}) {
    const base = num(options.baseMs, 5);
    const jitter = num(options.jitterMs, 10);
    const failRate = num(options.failRate, 0);
    let seed = num(options.seed, 42) || 42;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    return {
      async request() {
        if (failRate && rnd() < failRate) throw new Error('simulated');
        const delay = base + rnd() * jitter;
        await new Promise(r => setTimeout(r, delay));
        return { ok: true };
      },
      now: () => Date.now(),
    };
  }

  return { summarize, percentile, run, fakeRequests };
});
