/* Admission Hub, P13 Performance Runtime.
 *
 * Wires window.AhPerf into the live app so the "no loading" feel is real:
 *   - prefetches the pages/assets a student opens next (idle, deduped, save-data aware)
 *   - keeps a warm HTTP cache for those resources
 *   - exposes a VirtualList helper the question-bank tools can adopt safely
 *
 * Deliberately additive and non-destructive: it never clears storage, never
 * replaces an existing renderer, and every hook is guarded so a missing host
 * object just means that optimisation is skipped.
 */
(() => {
  'use strict';
  const Perf = window.AhPerf;
  if (!Perf) return;

  /* ---- idle-time prefetch of the next likely pages and their scripts ---- */
  const prefetcher = Perf.createPrefetcher({
    runner: url => fetch(url, { credentials: 'same-origin', cache: 'force-cache' }).then(r => r.ok ? r.arrayBuffer() : null).catch(() => null),
  });

  const PREFETCH_ROUTES = {
    'dashboard': ['./dashboard-v2.js', './today-command-center-live.js'],
    'question-bank': ['./question-engine.js', './question-engine-panel.js', './question-card-game-visual.js'],
    'progress': ['./progress-tool.js', './adaptive-insights-panel.js'],
    'vocabulary-srs': ['./vocabulary-master-tool.js'],
    'mistakes-bank': ['./mistakes-bank-tool.js'],
    'smart-revision': ['./smart-revision-tool.js', './adaptive-engine.js'],
  };

  function warmRoute(path) {
    if (!Perf.canPrefetch()) return 0;
    const key = String(path || 'dashboard').split('/')[0];
    const list = PREFETCH_ROUTES[key];
    return list ? prefetcher.addMany(list) : 0;
  }

  const runIdle = fn => {
    if (typeof requestIdleCallback === 'function') requestIdleCallback(fn, { timeout: 2000 });
    else setTimeout(fn, 1200);
  };

  /* Prefetch after the first paint, not during it. */
  window.addEventListener('load', () => {
    runIdle(() => { warmRoute(window.Router?.path || 'dashboard'); prefetcher.drain(); });
  }, { once: true });

  /* When a student moves to a route, quietly warm the *next* likely one. */
  window.addEventListener('hashchange', () => {
    const path = String(window.Router?.path || location.hash.replace(/^#\/?/, '') || 'dashboard');
    Perf.mark('route:' + path);
    runIdle(() => { warmRoute(path); prefetcher.drain(); });
  });

  /* ---- VirtualList: render only visible rows for very long lists ---- *
   * Use as:  const vl = AhPerfRuntime.VirtualList(container, { rowHeight, render, onBind })
   * Adopt per-list; a list that never switches to it is simply left untouched. */
  function VirtualList(container, opts = {}) {
    if (!container) return null;
    const rowHeight = Math.max(1, Number(opts.rowHeight) || 56);
    const render = typeof opts.render === 'function' ? opts.render : (item => String(item));
    let items = [];
    const spacer = document.createElement('div');
    spacer.style.cssText = 'position:relative;will-change:transform';
    const window_ = document.createElement('div');
    const below = document.createElement('div');
    spacer.appendChild(window_);
    spacer.appendChild(below);
    container.innerHTML = '';
    container.appendChild(spacer);
    container.style.overflowY = 'auto';

    function paint() {
      const win = Perf.computeWindow({
        itemCount: items.length,
        rowHeight,
        viewportHeight: container.clientHeight,
        scrollTop: container.scrollTop,
        overscan: opts.overscan || 3,
      });
      const slice = items.slice(win.start, win.end);
      window_.style.transform = `translateY(${win.offsetY}px)`;
      window_.innerHTML = slice.map((item, i) => render(item, win.start + i)).join('');
      below.style.height = Math.max(0, win.totalHeight - win.offsetY - win.count * rowHeight) + 'px';
      if (typeof opts.onBind === 'function') opts.onBind(window_, slice, win.start);
    }

    let raf = 0;
    const schedule = () => { if (raf) return; raf = requestAnimationFrame(() => { raf = 0; paint(); }); };
    container.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule, { passive: true });

    return {
      setItems(next) { items = Array.isArray(next) ? next : []; container.scrollTop = 0; paint(); },
      refresh: paint,
      count: () => items.length,
      destroy() { container.removeEventListener('scroll', schedule); window.removeEventListener('resize', schedule); },
    };
  }

  window.AhPerfRuntime = { warmRoute, prefetcher, VirtualList, loadedAt: Perf.mark('perf:runtime') };
})();
