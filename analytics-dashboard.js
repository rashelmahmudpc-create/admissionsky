/* Admission Hub, Phase 4 analytics dashboard (client).
 *
 * Mobile-first surface for the Phase 4 engine in `analytics-engine.mjs`. It
 * shows the student their own learning picture and, for an admin, the platform
 * view. Nothing is computed here: every number arrives from `/api/analytics/*`,
 * so the browser and the worker cannot disagree, which is exactly the failure
 * the old client-side-only funnel had.
 *
 * Two jobs:
 *   1. ship the on-device learning ledger to the server, once, idempotently, so
 *      lesson/quiz-level analytics exist at all (the daily counters have no
 *      lesson id);
 *   2. render. Overview → key metrics → trends → insights → details, which is
 *      the order the brief asks for and the only order that works on a phone.
 *
 * Fail-soft by construction: an analytics outage must never break the app, so
 * every network call degrades to "nothing to show" rather than an error.
 *
 * Exposed as window.AhAnalyticsDashboard; module.exports for node:test.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api; // node:test
  else root.AhAnalyticsDashboard = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* The factory closes over globals, not over the UMD `root`, so the same code
   * runs in the browser and under `new Function(...)` in node:test, the tested
   * build is the shipped build. */
  const win = typeof window !== 'undefined' ? window : (typeof self !== 'undefined' ? self : globalThis);

  const INGEST_PATH = '/api/analytics/events';
  const STUDENT_PATH = '/api/analytics/me';
  const ADMIN_PATH = '/api/analytics';
  const INGEST_KEY = 'ahAnalyticsIngestV1';
  const INGEST_BATCH = 100;
  const MAX_INGESTED_IDS = 800;
  const FETCH_TIMEOUT_MS = 12000;

  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

  const bn = (n) => {
    try { return new Intl.NumberFormat('bn-BD').format(num(n)); } catch (_) { return String(num(n)); }
  };

  const duration = (ms) => {
    const mins = Math.round(num(ms) / 60000);
    if (mins < 60) return `${bn(mins)} মিনিট`;
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m ? `${bn(h)} ঘণ্টা ${bn(m)} মিনিট` : `${bn(h)} ঘণ্টা`;
  };

  /* Which events are worth the round trip. Only the ones an admin cannot derive
   * from the daily counters, i.e. anything that carries a course/lesson/quiz
   * id. A `app_open` or `screen_view` would be cost with no answer. */
  const INGESTABLE = new Set([
    'course_view', 'course_start', 'course_complete',
    'lesson_view', 'lesson_start', 'lesson_complete',
    'question_attempt', 'quiz_start', 'quiz_complete'
  ]);

  /* ── ingest ──────────────────────────────────────────────────────────────── */

  const readIngested = () => {
    try { return new Set(JSON.parse(win.localStorage.getItem(INGEST_KEY) || '[]') || []); } catch (_) { return new Set(); }
  };
  const writeIngested = (set) => {
    try {
      const ids = [...set];
      win.localStorage.setItem(INGEST_KEY, JSON.stringify(ids.slice(-MAX_INGESTED_IDS)));
    } catch (_) { /* storage full or blocked, the server dedupes anyway */ }
  };

  /* The ledger row id is a stable hash of the row's own content, so a re-flush
   * after a crash sends the same id and the server's ON CONFLICT turns it into a
   * no-op. Without that, an offline queue would inflate every count it retried. */
  const rowId = (row) => {
    const raw = `${row.name}|${row.at}|${JSON.stringify(row.params || {})}`;
    let h = 2166136261;
    for (let i = 0; i < raw.length; i += 1) {
      h ^= raw.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return `ev-${(h >>> 0).toString(36)}-${raw.length.toString(36)}`;
  };

  const ledgerRows = () => {
    try {
      const svc = win.AhAnalytics;
      if (!svc || typeof svc.readLedger !== 'function') return [];
      return svc.readLedger() || [];
    } catch (_) { return []; }
  };

  const pendingEvents = () => {
    const seen = readIngested();
    const out = [];
    const localSeen = new Set();
    for (const row of ledgerRows()) {
      if (!row || !INGESTABLE.has(String(row.name))) continue;
      const id = rowId(row);
      if (seen.has(id) || localSeen.has(id)) continue;
      localSeen.add(id);
      out.push({ id, name: String(row.name), params: row.params || {}, at: num(row.at) || Date.now() });
    }
    return out;
  };

  async function post(path, body, init) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await win.fetch(path, {
        method: (init && init.method) || 'GET',
        credentials: 'include',
        signal: controller.signal,
        headers: Object.assign({ 'Content-Type': 'application/json' }, (init && init.headers) || {}),
        ...(body ? { body: JSON.stringify(body) } : {})
      });
      const data = await res.json().catch(() => ({}));
      return { ok: res.ok, status: res.status, data };
    } catch (_) {
      return { ok: false, status: 0, data: {} };
    } finally {
      clearTimeout(timer);
    }
  }

  /* Ships the ledger in bounded batches. Returns how many were accepted, so a
   * caller (or a test) can tell "nothing to send" from "send failed". */
  async function syncEvents() {
    const batch = pendingEvents().slice(0, INGEST_BATCH);
    if (!batch.length) return { sent: 0, stored: 0, reason: 'nothing-pending' };
    const res = await post(INGEST_PATH, { events: batch });
    if (!res.ok) return { sent: batch.length, stored: 0, reason: res.status === 401 ? 'auth-required' : 'failed' };
    /* Only mark as shipped what the server actually stored or already had. A
     * 200 means the batch was processed; the ids are safe to remember. */
    const seen = readIngested();
    for (const e of batch) seen.add(e.id);
    writeIngested(seen);
    return { sent: batch.length, stored: num(res.data?.stored), reason: 'ok' };
  }

  /* ── render ──────────────────────────────────────────────────────────────── */

  const metricTile = (label, value, sub) => `
    <div class="ah-metric">
      <div class="ah-metric-v">${esc(value)}</div>
      <div class="ah-metric-l">${esc(label)}</div>
      ${sub ? `<div class="ah-metric-s">${esc(sub)}</div>` : ''}
    </div>`;

  const insightRow = (i) => {
    const tone = i.kind === 'positive' ? 'good' : i.kind === 'attention' ? 'warn' : 'neutral';
    return `<div class="ah-insight ah-insight-${tone}">${esc(i.text)}</div>`;
  };

  const deltaChip = (c, label) => {
    if (!c || c.direction === 'flat') return '';
    const arrow = c.direction === 'up' ? '▲' : '▼';
    const cls = c.direction === 'up' ? 'up' : 'down';
    return `<span class="ah-delta ${cls}">${arrow} ${esc(label)} ${bn(Math.abs(c.percent))}%</span>`;
  };

  /* A tiny bar chart is enough: 14 numbers, one per day. An SVG avoids a chart
   * library and renders identically in the shell and in a test. */
  const sparkline = (series, pick) => {
    const rows = Array.isArray(series) ? series : [];
    if (!rows.length) return '';
    const values = rows.map(pick);
    const max = Math.max(1, ...values);
    const w = 100 / rows.length;
    const bars = values.map((v, i) => {
      const h = Math.max(2, Math.round((v / max) * 100));
      return `<rect x="${(i * w).toFixed(2)}%" y="${100 - h}%" width="${(w * 0.7).toFixed(2)}%" height="${h}%" rx="1"></rect>`;
    }).join('');
    return `<svg class="ah-spark" viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label="daily activity">${bars}</svg>`;
  };

  function studentHtml(d) {
    const m = d.metrics || {};
    const p = m.courseProgress || {};
    const insights = (d.insights || []).slice(0, 4);
    const milestones = d.milestones || {};

    return `
    <section class="card ah-dash" id="ahAnalyticsCard">
      <div class="ah-dash-head">
        <div>
          <div class="kicker">তোমার অগ্রগতি</div>
          <h3>এই সপ্তাহের ছবি</h3>
        </div>
        ${deltaChip(d.comparison?.metrics?.practiceActivity, 'অভ্যাস')}
      </div>

      ${milestones.next ? `<div class="ah-milestone">
        <div class="ah-milestone-bar"><span style="width:${Math.min(100, num(milestones.percent))}%"></span></div>
        <div class="ah-milestone-txt">${esc(milestones.next.message)}</div>
      </div>` : ''}

      <div class="ah-metrics">
        ${metricTile('পড়ার সময়', duration(m.learningTimeMs), 'সর্বমোট')}
        ${metricTile('পাঠ শেষ', bn(m.lessonsCompleted), `${bn(p.courses || 0)}টি কোর্সে`)}
        ${metricTile('প্রশ্ন', bn(m.practiceActivity), `${bn(m.accuracy)}% নির্ভুল`)}
        ${metricTile('Streak', bn(m.streak), `সেরা ${bn(m.longestStreak || 0)} দিন`)}
      </div>

      <div class="ah-spark-wrap">
        <div class="ah-spark-l">গত ১৪ দিনের অভ্যাস</div>
        ${sparkline(m.series, s => s.questions)}
      </div>

      ${d.trendSummary?.text ? `<div class="ah-trendline">${esc(d.trendSummary.text)}</div>` : ''}

      ${insights.length ? `<div class="ah-insights">${insights.map(insightRow).join('')}</div>` : '<div class="ah-empty">এখনো যথেষ্ট ডেটা নেই, কয়েকটা প্রশ্ন solve করলেই এখানে ছবি দেখা যাবে।</div>'}
    </section>`;
  }

  function adminHtml(d) {
    const e = d.engagement || {};
    const r = d.retention || {};
    const insights = (d.insights || []).slice(0, 6);
    return `
    <section class="card ah-dash ah-admin" id="ahAnalyticsAdmin">
      <div class="ah-dash-head"><div><div class="kicker">প্ল্যাটফর্ম</div><h3>Analytics overview</h3></div></div>
      <div class="ah-metrics">
        ${metricTile('Active আজ', bn(e.dau), `WAU ${bn(e.wau)} · MAU ${bn(e.mau)}`)}
        ${metricTile('Stickiness', `${bn(e.stickiness)}%`, 'DAU / MAU')}
        ${metricTile('Retention D1', `${bn(r.byWindow?.d1)}%`, `D7 ${bn(r.byWindow?.d7)}%`)}
        ${metricTile('শিক্ষার্থী', bn(d.totals?.students || 0), `${bn(d.totals?.devices || 0)} ডিভাইস`)}
      </div>
      ${d.trendSummary?.text ? `<div class="ah-trendline">${esc(d.trendSummary.text)}</div>` : ''}
      ${insights.length ? `<div class="ah-insights">${insights.map(insightRow).join('')}</div>` : ''}
    </section>`;
  }

  /* ── data ────────────────────────────────────────────────────────────────── */

  async function loadStudent() {
    const res = await post(STUDENT_PATH);
    if (res.status === 401) return { ok: false, reason: 'auth-required' };
    if (!res.ok) return { ok: false, reason: 'failed' };
    return { ok: true, data: res.data };
  }

  async function loadAdmin(token) {
    const res = await post(`${ADMIN_PATH}/overview`, null, { headers: { Authorization: `Bearer ${token || ''}` } });
    if (res.status === 403) return { ok: false, reason: 'forbidden' };
    if (!res.ok) return { ok: false, reason: 'failed' };
    return { ok: true, data: res.data };
  }

  /* Mounts the student card beside the notification card, which is where a
   * student already looks for "how am I doing". */
  async function mount(options = {}) {
    if (typeof win.document === 'undefined' || typeof win.document.querySelector !== 'function') {
      return { ok: false, reason: 'no-dom' };
    }
    try {
      const page = win.document.querySelector(options.selector || '#app .page');
      if (!page) return { ok: false, reason: 'no-mount' };

      /* Ship what is pending first, so the numbers just fetched include this
       * session rather than lagging a day behind. */
      try { await syncEvents(); } catch (_) {}

      const loaded = await loadStudent();
      if (!loaded.ok) return loaded;

      const holder = win.document.createElement('div');
      holder.innerHTML = studentHtml(loaded.data);
      const card = holder.firstElementChild;
      if (page.querySelector('#ahAnalyticsCard')) return { ok: true, reason: 'already-mounted' };
      const anchor = page.querySelector('#ahNotifCard');
      if (anchor && anchor.parentElement) anchor.insertAdjacentElement('afterend', card);
      else page.appendChild(card);
      return { ok: true };
    } catch (_) {
      return { ok: false, reason: 'exception' };
    }
  }

  /* The card has to appear on its own: the notification hub exposes its own
   * mount function but nothing calls it, so a card that waits to be mounted by
   * someone else never renders. Retries briefly because the shell renders the
   * page after scripts load, and stops as soon as the target exists. */
  function boot(options = {}) {
    if (typeof win.document === 'undefined') return;
    const selector = options.selector || '#app .page';
    /* Delay is overridable so a test can exercise the real auto-boot path
     * without waiting the full startup interval. */
    const delayMs = options.delayMs ?? win.__ahAnalyticsBootDelay ?? 1200;
    const maxTries = options.maxTries ?? 20;
    let tries = 0;
    const attempt = async () => {
      tries += 1;
      const page = win.document.querySelector(selector);
      if (page) {
        const res = await mount({ selector });
        if (res.ok || res.reason === 'auth-required' || res.reason === 'forbidden') return;
      }
      if (tries < maxTries) setTimeout(attempt, delayMs);
    };
    setTimeout(attempt, delayMs);
  }

  if (typeof win.document !== 'undefined' && !win.__ahAnalyticsNoAuto) boot();

  return {
    syncEvents,
    pendingEvents,
    rowId,
    INGESTABLE,
    studentHtml,
    adminHtml,
    loadStudent,
    loadAdmin,
    mount,
    boot,
    duration,
    __test: { esc, bn, sparkline, deltaChip, metricTile }
  };
});
