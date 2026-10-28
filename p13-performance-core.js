/* Admission Hub, P13 Performance Core.
 *
 * The "no loading" goal needs three things, and this file provides them as a
 * small, testable layer (window.AhPerf):
 *
 *   1. Windowing , render only the rows on screen, so a 50,000-row list costs
 *      the same as a 20-row one. computeWindow() is pure; the tool paints it.
 *   2. Stale-while-revalidate, show cached data instantly, refresh silently.
 *      swr() decides what to render now and what to fetch in the background.
 *   3. Prefetch, warm the browser cache for the routes/assets a student is
 *      most likely to open next, during idle time, deduped.
 *
 * Plus a tiny mark/measure helper so the speed claim is measured, not asserted.
 * Pure enough to run under node:test; the DOM bits are opt-in at the edges.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.AhPerf = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const num = (v, d = 0) => { const n = Number(v); return isFinite(n) ? n : d; };
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  /* Which rows to render for the current scroll position, plus the spacer needed
     to keep the scrollbar honest. Pure: no DOM, no side effects. */
  function computeWindow(opts = {}) {
    const itemCount = Math.max(0, num(opts.itemCount));
    const rowHeight = Math.max(1, num(opts.rowHeight, 1));
    const viewportHeight = Math.max(0, num(opts.viewportHeight));
    const scrollTop = Math.max(0, num(opts.scrollTop));
    const overscan = Math.max(0, num(opts.overscan, 3));

    const first = Math.floor(scrollTop / rowHeight);
    const visible = Math.ceil(viewportHeight / rowHeight) + 1;
    const start = clamp(first - overscan, 0, itemCount);
    const end = clamp(first + visible + overscan, 0, itemCount);
    return {
      start,
      end,
      offsetY: start * rowHeight,
      totalHeight: itemCount * rowHeight,
      count: end - start,
    };
  }

  /* Stale-while-revalidate decision, kept pure so both the SW and the UI can use
     it. Returns whether to render now, whether to fetch, and whether the cache
     is fresh enough to skip the network entirely. */
  function swr(cached, opts = {}) {
    const now = num(opts.now, Date.now());
    const maxAge = Math.max(0, num(opts.maxAge, 5 * 60000));
    const hasCache = cached != null && cached !== false;
    const at = hasCache ? num(cached.at, 0) : 0;
    const fresh = hasCache && now - at <= maxAge;
    return {
      render: hasCache ? cached.value : (opts.fallback === undefined ? null : opts.fallback),
      fetch: !fresh,
      cached: hasCache,
      fresh,
      age: hasCache ? Math.max(0, now - at) : null,
    };
  }

  /* An idle-time prefetch queue. addMany() dedupes against what has already been
     warmed; drain() runs one task at a time so prefetch never competes with real
     work for bandwidth. `runner` is injected for tests. */
  function createPrefetcher(opts = {}) {
    const warmed = new Set();
    const queue = [];
    let running = false;
    const runner = typeof opts.runner === 'function' ? opts.runner : () => {};
    const limit = Math.max(1, num(opts.limit, 200));

    function addMany(urls) {
      let added = 0;
      for (const u of urls || []) {
        const key = String(u || '').trim();
        if (!key || warmed.has(key) || queue.length >= limit) continue;
        if (queue.some(t => t.key === key)) continue;
        queue.push({ key, url: key });
        added += 1;
      }
      return added;
    }

    async function drain() {
      if (running) return 0;
      running = true;
      let done = 0;
      try {
        while (queue.length) {
          const task = queue.shift();
          warmed.add(task.key);
          try { await runner(task.url); } catch (_) { /* a failed warm is harmless */ }
          done += 1;
        }
      } finally { running = false; }
      return done;
    }

    return { addMany, drain, size: () => queue.length, warmedCount: () => warmed.size, has: u => warmed.has(String(u)) };
  }

  /* mark/measure, a thin, safe wrapper over the User Timing API. */
  const marks = new Map();
  function mark(name) {
    const at = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    marks.set(String(name), at);
    try { if (typeof performance !== 'undefined' && performance.mark) performance.mark(String(name)); } catch (_) {}
    return at;
  }
  function measure(name, from) {
    const end = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    const start = marks.has(String(from)) ? marks.get(String(from)) : num(from);
    const ms = Math.max(0, end - start);
    try { if (typeof performance !== 'undefined' && performance.measure) performance.measure(String(name), String(from)); } catch (_) {}
    return ms;
  }

  /* Are we allowed to warm the cache right now? Respects save-data and slow
     connections so prefetch never costs a student their data. */
  function canPrefetch(nav = (typeof navigator !== 'undefined' ? navigator : {})) {
    try {
      const c = nav.connection || nav.mozConnection || nav.webkitConnection || {};
      if (c.saveData) return false;
      const type = String(c.effectiveType || '');
      if (type && /(^|-)2g$/.test(type)) return false;
      return true;
    } catch (_) { return true; }
  }

  return { computeWindow, swr, createPrefetcher, mark, measure, canPrefetch };
});
