/* Admission Hub, Analytics Foundation (Phase 1).
 *
 * The single choke point between the app and Firebase Analytics (GA4). UI and
 * feature code never touch the Firebase SDK directly; they call this service,
 * so a future provider swap is one file, not a full-app rewrite.
 *
 * Design rules (see docs/ANALYTICS-FOUNDATION.md):
 *  • Never throws. Analytics failure is never app failure, every public call
 *    is wrapped and degrades to a no-op.
 *  • Privacy-first. Only named, whitelisted parameters survive; anything that
 *    looks like identity, credentials or free text is dropped before it leaves
 *    the browser.
 *  • One event dictionary. Unknown event names and unknown parameters are
 *    rejected rather than silently sent, so the data stays queryable.
 *  • Duplicate control. Once-only events (a completion, an app open) fire a
 *    single time per session/key.
 *  • Environment separation. Test/dev activity never reaches the production
 *    GA4 property: transmission requires the production origin.
 *  • Offline-friendly. Events queue in localStorage and flush on reconnect.
 *
 * Exposed as window.AhAnalytics; module.exports for node:test.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api; // node:test
  else root.AhAnalytics = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const EVENT_VERSION = 'ev2';
  const APP_VERSION_FALLBACK = 'v312-vm-scope-20261011';
  const SDK_BASE = 'https://www.gstatic.com/firebasejs/10.12.2';
  const SDK_LOCAL = './sdk';
  const QUEUE_KEY = 'ahAnalyticsQueueV1';
  const PROD_HOSTS = ['admissionhub.pages.dev', 'admissionsky.pages.dev'];
  const MAX_QUEUE = 400;
  const SDK_TIMEOUT_MS = 20000;

  /* ── Master Event Dictionary ────────────────────────────────────────────────
   * Every allowed event with the parameters it may carry. `required` must be
   * present and non-empty; `optional` may be absent. Any parameter not listed
   * here is dropped, that is what keeps the schema honest. Events are grouped
   * by the surface that emits them, which is also the naming prefix rule. */
  const EVENTS = {
    app_open: {
      purpose: 'App or PWA opened',
      when: 'once per session, after boot',
      required: [],
      optional: ['launch_source'],
      once: true,
      values: { launch_source: ['browser', 'pwa', 'unknown'] }
    },
    screen_view: {
      purpose: 'A top-level screen became visible',
      when: 'on route render',
      required: ['screen_name'],
      optional: ['screen_group', 'previous_screen'],
      once: false
    },
    session_start: {
      purpose: 'A student session began',
      when: 'after authentication resolves',
      required: [],
      optional: ['signed_in'],
      once: true,
      values: { signed_in: [true, false] }
    },

    course_view: {
      purpose: 'A course page was viewed',
      when: 'course render',
      required: ['course_id'],
      optional: ['course_type', 'category'],
      once: false
    },
    course_start: {
      purpose: 'A course was started',
      when: 'first interaction inside a course',
      required: ['course_id'],
      optional: ['course_type'],
      once: true
    },
    lesson_view: {
      purpose: 'A lesson/topic was viewed',
      when: 'lesson render',
      required: ['course_id', 'lesson_id'],
      optional: ['lesson_number', 'topic_id'],
      once: false
    },
    lesson_start: {
      purpose: 'A lesson was started',
      when: 'lesson first opened for study',
      required: ['course_id', 'lesson_id'],
      optional: ['lesson_number'],
      once: true
    },
    lesson_complete: {
      purpose: 'A lesson was completed',
      when: 'lesson marked complete',
      required: ['course_id', 'lesson_id'],
      optional: ['lesson_number', 'completion_percent', 'duration'],
      once: true
    },
    course_complete: {
      purpose: 'Every lesson in a course was completed',
      when: 'the last outstanding lesson is marked complete',
      required: ['course_id'],
      optional: ['course_type', 'lesson_count', 'completion_percent'],
      once: true
    },
    question_attempt: {
      purpose: 'A single question was answered',
      when: 'an answer is committed',
      required: ['quiz_id', 'question_id'],
      optional: ['quiz_type', 'correct', 'duration', 'question_number', 'subject_id', 'topic_id', 'attempt_no', 'mode'],
      once: false
    },
    quiz_start: {
      purpose: 'A quiz/practice/exam attempt started',
      when: 'attempt begins',
      required: ['quiz_id'],
      optional: ['quiz_type', 'question_count', 'subject_id', 'topic_id'],
      once: true,
      values: { quiz_type: ['practice', 'exam', 'mock', 'revision', 'flash'] }
    },
    quiz_complete: {
      purpose: 'A quiz/practice/exam attempt finished',
      when: 'result recorded',
      required: ['quiz_id'],
      optional: ['quiz_type', 'question_count', 'correct', 'wrong', 'skipped', 'accuracy', 'score', 'duration'],
      once: true,
      values: { quiz_type: ['practice', 'exam', 'mock', 'revision', 'flash'] }
    },

    search: {
      purpose: 'A search was performed',
      when: 'search submitted',
      required: ['search_scope'],
      optional: ['result_count'],
      once: false,
      values: { search_scope: ['question_bank', 'topic', 'course', 'global'] }
    },
    feature_open: {
      purpose: 'A feature surface was opened',
      when: 'feature navigation',
      required: ['feature_name'],
      optional: ['feature_group'],
      once: false
    },
    feature_use: {
      purpose: 'A feature was used',
      when: 'meaningful feature interaction',
      required: ['feature_name'],
      optional: ['feature_group', 'action'],
      once: false
    },
    feature_complete: {
      purpose: 'A feature flow finished',
      when: 'feature flow completed',
      required: ['feature_name'],
      optional: ['feature_group', 'duration'],
      once: true
    },
    notification_open: {
      purpose: 'A notification was opened in the center',
      when: 'notification tapped/opened',
      required: ['notification_id'],
      optional: ['notification_type', 'notification_source'],
      once: true
    },
    notification_click: {
      purpose: 'A notification action link was clicked',
      when: 'notification action tapped',
      required: ['notification_id'],
      optional: ['notification_type', 'link_route'],
      once: true
    },

    auth_landing_view: {
      purpose: 'Auth/onboarding surface viewed',
      when: 'account/onboarding render',
      required: [],
      optional: ['auth_step'],
      once: false
    },
    sign_up: {
      purpose: 'A student completed sign-up',
      when: 'successful registration',
      required: ['method'],
      optional: ['verification_required'],
      once: true,
      values: { method: ['email', 'google', 'telegram', 'passkey'] }
    },
    login: {
      purpose: 'A student signed in',
      when: 'successful login',
      required: ['method'],
      optional: ['returning'],
      once: true,
      values: { method: ['email', 'google', 'telegram', 'passkey'] }
    },
    logout: {
      purpose: 'A student signed out',
      when: 'session ended by the student',
      required: [],
      optional: ['reason'],
      once: true
    },
    ai_chat_open: {
      purpose: 'The AI chat surface was opened',
      when: 'AI page opened',
      required: [],
      optional: ['signed_in'],
      once: false
    },
    ai_message_sent: {
      purpose: 'A student sent an AI message',
      when: 'message submitted',
      required: [],
      optional: ['intent', 'tier', 'provider'],
      once: false
    },
    error_seen: {
      purpose: 'A user-visible failure was encountered',
      when: 'caught failure surfaced to UI',
      required: ['error_area'],
      optional: ['error_code'],
      once: false,
      values: { error_area: ['auth', 'ai', 'sync', 'storage', 'network', 'other'] }
    }
  };

  /* Parameter names that must never leave the browser. Checked case-
   * insensitively against the normalised key, so `APIKey`/`api_key` both die. */
  const FORBIDDEN_PARAM = /(pass(word)?|secret|token|api[_-]?key|credential|authorization|cookie|session[_-]?id|email|phone|mobile|address|full[_-]?name|answer|explanation|message|transcript|text|content|prompt|response|body|bio|dob|birth|nid|avatar|photo|url|query)/i;

  const MAX_PARAM_STR = 120;
  const MAX_PARAMS = 24;

  /* ── Phase 2 M4/M5, learning funnel ──────────────────────────────────────
   * The funnel is defined here, in one place, and every step is an EVENT name
   * (never a screen name): trackScreen collapses deep routes to their first
   * segment (pinned by test a16), so a screen-based funnel would silently
   * merge every course into one step. */
  const FUNNEL_STEPS = [
    { key: 'course_view', event: 'course_view' },
    { key: 'course_start', event: 'course_start' },
    { key: 'lesson_start', event: 'lesson_start' },
    { key: 'lesson_complete', event: 'lesson_complete' },
    { key: 'quiz_start', event: 'quiz_start' },
    { key: 'quiz_complete', event: 'quiz_complete' }
  ];

  /* A stage is "unusually steep" when it keeps far fewer students than the
   * stages before it. 40% is the drop that has always meant a real problem in
   * this app (a step that loses most of its traffic), and a step is only
   * flagged once at least 5 students reached it, below that a percentage is
   * noise, not a signal. */
  const DROPOFF_ALERT_RATE = 0.4;
  const DROPOFF_MIN_SAMPLE = 5;

  /* ── Phase 2 M4–M7, derived learning insights ────────────────────────────
   * Pure: takes already-counted funnel counts (or raw events) and returns the
   * funnel, the steepest drop-off, engagement/streak/retention and the data
   * quality report. No DOM, no storage, no network, so the same function runs
   * in the browser, in an admin panel, and in node:test. */
  function buildLearningInsights(input = {}) {
    const events = Array.isArray(input.events) ? input.events.filter(e => e && e.name) : [];
    const counts = (input.counts && typeof input.counts === 'object') ? input.counts : countByEvent(events);
    const dayCount = (input.dayCount && typeof input.dayCount === 'object') ? input.dayCount : countByDay(events);

    /* M4, funnel. Each step reports how many reached it, how many of the
     * previous step survived, and the drop from the step before. */
    const funnel = FUNNEL_STEPS.map((step, index) => {
      const count = Number(counts[step.event]) || 0;
      const previous = index === 0 ? count : (Number(counts[FUNNEL_STEPS[index - 1].event]) || 0);
      return {
        key: step.key,
        event: step.event,
        count,
        reachRate: index === 0 ? 1 : (previous ? Number((count / previous).toFixed(4)) : 0),
        dropRate: index === 0 ? 0 : (previous ? Number(((previous - count) / previous).toFixed(4)) : 0)
      };
    });

    /* M5, drop-off intelligence: the steepest step that has enough students
     * to be meaningful. Ties break toward the earliest step, which is the one
     * worth fixing first. */
    const eligible = funnel.filter(step => step.count >= DROPOFF_MIN_SAMPLE && step.dropRate >= DROPOFF_ALERT_RATE);
    const steepest = eligible.length
      ? eligible.reduce((worst, step) => (step.dropRate > worst.dropRate ? step : worst), eligible[0])
      : null;
    const dropOff = {
      hasAlert: Boolean(steepest),
      steepest: steepest ? steepest.key : null,
      dropRate: steepest ? steepest.dropRate : 0,
      threshold: DROPOFF_ALERT_RATE,
      minSample: DROPOFF_MIN_SAMPLE,
      message: steepest ? dropOffMessage(steepest.key, steepest.dropRate) : ''
    };

    /* M6, engagement, streak, retention. All derived from the same events;
     * nothing new is collected. */
    const days = Object.keys(dayCount).sort();
    const activeDays = days.filter(day => (Number(dayCount[day]) || 0) > 0);
    const engagement = {
      activeDays: activeDays.length,
      totalEvents: events.length,
      firstDay: activeDays[0] || null,
      lastDay: activeDays[activeDays.length - 1] || null,
      streak: computeStreak(activeDays),
      retention: retentionBuckets(activeDays)
    };

    /* M7, data quality: which expected events never fired, and which rows are
     * missing a required parameter or are duplicates. */
    const quality = checkDataQuality(events, counts);

    return { funnel, dropOff, engagement, quality };
  }

  const countByEvent = (events) => {
    const out = {};
    for (const e of events) out[e.name] = (out[e.name] || 0) + 1;
    return out;
  };

  const countByDay = (events) => {
    const out = {};
    for (const e of events) {
      const day = dayOf(e.at || e.timestamp || e.date);
      if (day) out[day] = (out[day] || 0) + 1;
    }
    return out;
  };

  const dayOf = (value) => {
    if (!value) return '';
    try {
      const d = (typeof value === 'number' || /^\d+$/.test(String(value))) ? new Date(Number(value)) : new Date(value);
      if (isNaN(d.getTime())) return '';
      return d.toISOString().slice(0, 10);
    } catch (_) { return ''; }
  };

  /* Longest run of consecutive calendar days in an ascending day list. */
  const computeStreak = (days) => {
    if (!days.length) return 0;
    let best = 1;
    let run = 1;
    for (let i = 1; i < days.length; i += 1) {
      const gap = (new Date(days[i] + 'T00:00:00Z') - new Date(days[i - 1] + 'T00:00:00Z')) / 86400000;
      run = gap === 1 ? run + 1 : 1;
      if (run > best) best = run;
    }
    return best;
  };

  /* D1/D7/D30 buckets: of the students active on their first day, how many
   * came back on a later day within the window. Days are the only key we hold,
   * so this is a cohort count, not a per-student join. */
  const retentionBuckets = (days) => {
    const out = { d1: 0, d7: 0, d30: 0 };
    if (!days.length) return out;
    const first = days[0];
    const start = new Date(first + 'T00:00:00Z').getTime();
    for (const day of days) {
      const diff = Math.round((new Date(day + 'T00:00:00Z').getTime() - start) / 86400000);
      if (diff >= 1) out.d1 += 1;
      if (diff >= 7) out.d7 += 1;
      if (diff >= 30) out.d30 += 1;
    }
    return out;
  };

  /* M7, expected-event validation. `expected` defaults to the learning events
   * every funnel needs; `required` reuses the dictionary so this can never
   * drift from what normalizeEvent enforces. */
  function checkDataQuality(events, counts, options = {}) {
    const expected = options.expected || ['course_view', 'lesson_start', 'lesson_complete', 'quiz_start', 'quiz_complete'];
    const missing = expected.filter(name => !(Number(counts[name]) > 0));

    let incomplete = 0;
    let duplicates = 0;
    const seen = new Set();
    for (const e of events) {
      const def = EVENTS[e.name];
      if (def) {
        const params = e.params || {};
        const lacks = (def.required || []).some(key => params[key] === undefined || params[key] === null || params[key] === '');
        if (lacks) incomplete += 1;
      }
      if (def && def.once) {
        const key = `${e.name}:${JSON.stringify(e.params || {})}`;
        if (seen.has(key)) duplicates += 1;
        else seen.add(key);
      }
    }

    return {
      ok: missing.length === 0 && incomplete === 0 && duplicates === 0,
      expected,
      missing,
      incomplete,
      duplicates,
      checked: events.length
    };
  }

  const dropOffMessage = (key, rate) => {
    const labels = {
      course_start: 'Course খোলার পর শুরু করেনি',
      lesson_start: 'Course শুরু করে পাঠ শুরু করেনি',
      lesson_complete: 'পাঠ শুরু করে শেষ করেনি',
      quiz_start: 'পাঠ শেষ করে কুইজ শুরু করেনি',
      quiz_complete: 'কুইজ শুরু করে শেষ করেনি'
    };
    return `${labels[key] || key}, ${Math.round(rate * 100)}% এখানেই থেমে গেছে।`;
  }

  /* An append-only, bounded local trail of the learning events this device
   * emitted. GA4 owns the aggregate view; this exists so the admin panel and
   * the data-quality check have something to read on-device without waiting on
   * the Data API (which is still not enabled). It stores the SAME already-
   * filtered params that were sent, no new personal data. */
  const LEDGER_KEY = 'ahLearningLedgerV1';
  const MAX_LEDGER = 500;
  /* Held in memory and flushed on a coalesced timer: re-parsing and re-writing
   * up to 500 rows on every event is O(n²) across a quiz (40+ attempts), which
   * is exactly the kind of work an analytics service must never charge the app
   * for. */
  let ledgerCache = null;
  let ledgerFlushTimer = null;

  const readLedger = () => {
    if (ledgerCache) return ledgerCache;
    try { ledgerCache = JSON.parse(localStorage.getItem(LEDGER_KEY) || '[]') || []; } catch (_) { ledgerCache = []; }
    return ledgerCache;
  };
  const flushLedger = () => {
    ledgerFlushTimer = null;
    try { localStorage.setItem(LEDGER_KEY, JSON.stringify(readLedger().slice(-MAX_LEDGER))); } catch (_) {}
  };
  const recordLedger = (row) => {
    const rows = readLedger();
    rows.push({ name: row.name, params: row.params, at: row.at });
    if (rows.length > MAX_LEDGER) rows.splice(0, rows.length - MAX_LEDGER);
    if (ledgerFlushTimer) return;
    try { ledgerFlushTimer = setTimeout(flushLedger, 400); } catch (_) { flushLedger(); }
  };

  function learningInsights(options = {}) {
    return buildLearningInsights({ events: options.events || readLedger() });
  }

  /* ── internal state ─────────────────────────────────────────────────────── */
  /* The app dispatches semantic learning signals on the `admission:activity`
   * bus (so emitters never import this service). Each bus type maps to a
   * dictionary event; the emitter's camelCase fields are snake_cased by
   * normalizeEvent, so {type:'LESSON_COMPLETE', courseId, lessonId} becomes
   * lesson_complete{course_id, lesson_id}. */
  const LEARNING_BUS_TYPES = {
    COURSE_VIEW: 'course_view',
    COURSE_START: 'course_start',
    COURSE_COMPLETE: 'course_complete',
    LESSON_VIEW: 'lesson_view',
    LESSON_START: 'lesson_start',
    LESSON_COMPLETE: 'lesson_complete',
    QUESTION_ATTEMPT: 'question_attempt',
    QUIZ_START: 'quiz_start',
    QUIZ_COMPLETE: 'quiz_complete',
    SEARCH: 'search',
    NOTIFICATION_OPEN: 'notification_open',
    NOTIFICATION_CLICK: 'notification_click',
    AI_MESSAGE_SENT: 'ai_message_sent'
  };

  let config = null;            // { measurementId, appVersion, environment, debug }
  let sdkPromise = null;
  let analyticsInstance = null;
  let firedOnce = new Set();    // dedupe keys for this session
  let started = false;
  let currentScreen = '';
  let userContext = { id: '', firstName: '' };
  const log = { sent: 0, dropped: 0, queued: 0, rejected: 0, reasons: {} };

  const now = () => Date.now();
  const noteDrop = (reason) => {
    log.dropped++;
    log.reasons[reason] = (log.reasons[reason] || 0) + 1;
  };

  /* ── normalisation + validation (pure, unit-tested) ─────────────────────── */

  /* snake_case a parameter key: courseId → course_id, CourseID → course_id. */
  const toSnake = (key) => String(key)
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[\s-]+/g, '_')
    .replace(/__+/g, '_')
    .toLowerCase();

  const isForbiddenKey = (key) => FORBIDDEN_PARAM.test(key);

  /* Coerce a value to something GA4 accepts: string/number/boolean only.
   * Objects, arrays, null and undefined are dropped. Strings are bounded. */
  const coerceValue = (value) => {
    if (value == null) return null;
    const type = typeof value;
    if (type === 'boolean') return value;
    if (type === 'number') return Number.isFinite(value) ? value : null;
    if (type === 'string') {
      const s = value.replace(/[\r\n\u0000<>]/g, ' ').trim();
      return s ? s.slice(0, MAX_PARAM_STR) : null;
    }
    return null; // objects/arrays/functions are never sent
  };

  /* Returns { name, params } or null when the event is not in the dictionary
   * or a required parameter is missing. `params` contains only whitelisted,
   * allowed-value-checked, privacy-filtered entries. */
  function normalizeEvent(name, params) {
    const def = EVENTS[name];
    if (!def) return null;
    const raw = params && typeof params === 'object' ? params : {};
    const out = {};

    /* Build a lookup so callers may pass camelCase and still match the
     * dictionary's snake_case keys (courseId → course_id). */
    const provided = {};
    for (const k of Object.keys(raw)) {
      const snake = toSnake(k);
      if (isForbiddenKey(snake)) continue;
      provided[snake] = raw[k];
    }

    const allowed = new Set([...(def.required || []), ...(def.optional || [])]);
    for (const key of allowed) {
      if (!(key in provided)) continue;
      const value = coerceValue(provided[key]);
      if (value == null) continue;
      const allowedValues = def.values && def.values[key];
      if (allowedValues && !allowedValues.includes(value)) continue;
      if (Object.keys(out).length >= MAX_PARAMS) break;
      out[key] = value;
    }

    for (const key of def.required || []) {
      if (!(key in out)) return null; // required parameter missing → reject
    }

    return { name, params: out };
  }

  /* ── environment + config ───────────────────────────────────────────────── */

  const hostOf = () => {
    try { return String(location.hostname || ''); } catch (_) { return ''; }
  };
  const queryFlag = (key) => {
    try { return new URLSearchParams(location.search).get(key) || ''; } catch (_) { return ''; }
  };
  const isProduction = () => PROD_HOSTS.includes(hostOf());

  /* Transmission is allowed only on the production origin, or when an explicit
   * debug flag asks for console-only tracing. Everything else (localhost, LAN
   * preview, file://) stays local so test data can never pollute the property. */
  function resolveMode() {
    if (isProduction()) return 'production';
    if (queryFlag('ahanalytics') === 'debug' || queryFlag('ahanalytics') === 'console') return 'debug';
    return 'disabled';
  }

  /* ── Firebase SDK (lazy, best-effort) ───────────────────────────────────── */

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const el = document.createElement('script');
      el.src = src;
      el.defer = true;
      const timer = setTimeout(() => { el.remove(); reject(new Error('sdk-timeout')); }, SDK_TIMEOUT_MS);
      el.onload = () => { clearTimeout(timer); resolve(); };
      el.onerror = () => { clearTimeout(timer); el.remove(); reject(new Error('sdk-load-failed')); };
      document.head.appendChild(el);
    });
  }

  async function loadSdkFrom(base) {
    if (typeof window.firebase !== 'undefined' && window.firebase.analytics) return window.firebase;
    if (!window.firebase || !window.firebase.apps || !window.firebase.apps.length) {
      await loadScript(`${base}/firebase-app-compat.js`);
    }
    await loadScript(`${base}/firebase-analytics-compat.js`);
    return window.firebase;
  }

  function loadSdk() {
    if (!sdkPromise) {
      sdkPromise = (async () => {
        try { return await loadSdkFrom(SDK_LOCAL); }
        catch (_) { return await loadSdkFrom(SDK_BASE); }
      })();
      sdkPromise.catch(() => { sdkPromise = null; });
    }
    return sdkPromise;
  }

  /* The GA4 measurement ID and the public Firebase web config are served by
   * the Worker (/api/notifications/config). When the measurement ID is absent,
   * Analytics has never been switched on for the project, the service then
   * stays in console mode instead of failing. */
  async function fetchRemoteConfig() {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), SDK_TIMEOUT_MS);
      const res = await fetch('/api/notifications/config', { credentials: 'include', signal: controller.signal });
      clearTimeout(timer);
      const data = await res.json().catch(() => ({}));
      const web = (data && data.webConfig) || null;
      return {
        firebase: web ? {
          apiKey: web.apiKey,
          projectId: web.projectId,
          messagingSenderId: web.messagingSenderId,
          appId: web.appId
        } : null,
        measurementId: String((web && web.measurementId) || '')
      };
    } catch (_) { return { firebase: null, measurementId: '' }; }
  }

  async function ensureAnalytics() {
    if (analyticsInstance) return analyticsInstance;
    if (config && config.mode !== 'production') return null;
    const fb = await loadSdk();
    if (!fb || typeof fb.initializeApp !== 'function') return null;
    /* GA4 uses the measurementId carried on the Firebase app config. */
    const appConfig = { ...(config.firebase || {}) };
    if (config.measurementId && !appConfig.measurementId) appConfig.measurementId = config.measurementId;
    const app = (fb.apps && fb.apps.length) ? fb.apps[0] : fb.initializeApp(appConfig);
    if (typeof fb.analytics !== 'function') return null;
    analyticsInstance = fb.analytics(app);
    return analyticsInstance;
  }

  /* ── offline queue ──────────────────────────────────────────────────────── */

  const readQueue = () => {
    try { return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]') || []; } catch (_) { return []; }
  };
  const writeQueue = (rows) => {
    try { localStorage.setItem(QUEUE_KEY, JSON.stringify(rows.slice(-MAX_QUEUE))); } catch (_) {}
  };
  const enqueue = (row) => {
    const q = readQueue();
    q.push(row);
    writeQueue(q);
    log.queued++;
  };
  const isOnline = () => {
    try { return navigator.onLine !== false; } catch (_) { return true; }
  };

  /* ── transport ──────────────────────────────────────────────────────────── */

  /* Fire one event through GA4. Returns true when handed to the SDK. */
  async function transmit(row) {
    const ga = await ensureAnalytics();
    if (!ga || typeof ga.logEvent !== 'function') return false;
    ga.logEvent(row.name, row.params);
    log.sent++;
    return true;
  }

  async function flushQueue() {
    if (!isOnline()) return;
    const q = readQueue();
    if (!q.length) return;
    const remaining = [];
    for (const row of q) {
      const ok = await transmit(row).catch(() => false);
      if (!ok) remaining.push(row);
    }
    writeQueue(remaining);
  }

  /* ── public API ─────────────────────────────────────────────────────────── */

  /* trackEvent(name, params), the one entry point every other helper uses.
   * Always returns a small result object; never throws. */
  function trackEvent(name, params) {
    try {
      if (!config || config.mode === 'disabled') { noteDrop('mode-disabled'); return { ok: false, reason: 'disabled' }; }
      const normalized = normalizeEvent(String(name), params);
      if (!normalized) { log.rejected++; noteDrop('unknown-or-invalid'); return { ok: false, reason: 'rejected' }; }

      /* Once-only dedupe keys must include EVERY identity parameter, otherwise
       * a per-lesson event would be suppressed after the first lesson of a
       * course (course_id alone was the old key). Build from required params,
       * falling back to the first identity param present. */
      const identity = (EVENTS[normalized.name].required || [])
        .map((k) => `${k}=${normalized.params[k]}`)
        .join('|');
      const fallbackIdentity = normalized.params.course_id || normalized.params.lesson_id || normalized.params.quiz_id || normalized.params.question_id || normalized.params.notification_id || normalized.params.feature_name || '';
      const dedupeKey = `${normalized.name}:${identity || fallbackIdentity}`;
      if (EVENTS[normalized.name].once) {
        if (firedOnce.has(dedupeKey)) { noteDrop('duplicate'); return { ok: false, reason: 'duplicate' }; }
        firedOnce.add(dedupeKey);
      }

      const row = {
        name: normalized.name,
        params: {
          ...normalized.params,
          event_version: EVENT_VERSION,
          app_version: config.appVersion || APP_VERSION_FALLBACK,
          environment: config.environment || 'production'
        },
        at: now()
      };

      if (config.mode === 'debug') {
        try { console.info('[AhAnalytics]', row.name, row.params); } catch (_) {}
        log.sent++;
        recordLedger(row);
        return { ok: true, reason: 'debug' };
      }

      if (!isOnline()) { enqueue(row); recordLedger(row); return { ok: true, reason: 'queued' }; }

      /* Fire and forget: a rejected promise must never become an unhandled
       * rejection, and the caller must not wait for the network. */
      transmit(row).catch(() => false);
      recordLedger(row);
      return { ok: true, reason: 'sent' };
    } catch (e) {
      noteDrop('exception');
      return { ok: false, reason: 'exception' };
    }
  }

  /* trackScreen(name, opts), screen views are the backbone of Phase 2. */
  function trackScreen(name, opts = {}) {
    try {
      const screen = String(name || '').replace(/^#?\/?/, '').split('?')[0] || 'dashboard';
      const group = screen.includes('/') ? screen.split('/')[0] : screen;
      const prev = currentScreen;
      if (prev === screen) { noteDrop('same-screen'); return { ok: false, reason: 'same-screen' }; }
      currentScreen = screen;
      return trackEvent('screen_view', {
        screen_name: screen.split('/')[0],
        screen_group: group,
        previous_screen: prev || undefined,
        ...opts
      });
    } catch (_) { return { ok: false, reason: 'exception' }; }
  }

  function trackLearning(action, params) {
    return trackEvent(String(action), params);
  }

  function trackFeature(name, action = 'use', params = {}) {
    const map = { open: 'feature_open', use: 'feature_use', complete: 'feature_complete' };
    return trackEvent(map[action] || 'feature_use', { feature_name: name, ...params });
  }

  function trackNotification(action, params) {
    const map = { open: 'notification_open', click: 'notification_click' };
    return trackEvent(map[action] || 'notification_open', params);
  }

  /* ── identity context ───────────────────────────────────────────────────── */

  /* Only two things are ever set on the GA4 user: an opaque student id and the
   * first name (so the product can greet, and so Phase 2 can segment). No
   * email, no phone, no full name. Read the same way ai-agent-chat.js does. */
  function setUserContext(user = {}) {
    try {
      const id = String(user.id || '').slice(0, 128);
      const firstName = String(user.firstName || '').replace(/[\r\n\u0000<>]/g, ' ').trim().split(/\s+/)[0].slice(0, 40);
      userContext = { id, firstName };
      if (!config || config.mode !== 'production') return { ok: true, reason: 'local' };
      ensureAnalytics().then((ga) => {
        if (!ga || typeof ga.setUserId !== 'function') return;
        if (id) ga.setUserId(id);
        if (firstName && typeof ga.setUserProperties === 'function') {
          ga.setUserProperties({ first_name: firstName, student_type: 'signed_in' });
        }
      }).catch(() => false);
      return { ok: true, reason: 'sent' };
    } catch (_) { return { ok: false, reason: 'exception' }; }
  }

  /* ── lifecycle ──────────────────────────────────────────────────────────── */

  async function configure(opts = {}) {
    try {
      const mode = opts.forceMode || resolveMode();
      config = {
        mode,
        debug: mode !== 'production',
        appVersion: opts.appVersion || APP_VERSION_FALLBACK,
        environment: opts.environment || (isProduction() ? 'production' : 'development'),
        firebase: opts.firebase || null,
        measurementId: opts.measurementId || ''
      };

      if (mode === 'production') {
        let measurementId = config.measurementId;
        if (!measurementId || !config.firebase) {
          const remote = await fetchRemoteConfig();
          measurementId = measurementId || remote.measurementId;
          config.firebase = config.firebase || remote.firebase;
        }
        config.measurementId = measurementId;
        if (!measurementId) {
          /* GA4 is not switched on for this project yet. Stay console-only so
           * nothing is lost and nothing is sent to a property that is not
           * ready. The moment the owner adds the ID, this path lights up. */
          config.mode = 'debug';
          config.debug = true;
          try { console.warn('[AhAnalytics] no measurementId yet, running in console mode'); } catch (_) {}
        }
      }

      started = true;
      if (mode === 'production' && config.measurementId) {
        ensureAnalytics().catch(() => false);
        if (isOnline()) flushQueue();
      }
      return status();
    } catch (_) {
      config = { mode: 'disabled', debug: false, appVersion: APP_VERSION_FALLBACK, environment: 'unknown' };
      return status();
    }
  }

  /* start(), idempotent boot: configure, then emit app_open exactly once. */
  async function start(opts = {}) {
    if (started) return status();
    const st = await configure(opts);
    const source = (() => {
      try {
        if (queryFlag('source') === 'pwa') return 'pwa';
        if ((navigator.standalone === true) || (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches)) return 'pwa';
        return 'browser';
      } catch (_) { return 'unknown'; }
    })();
    trackEvent('app_open', { launch_source: source });
    return { ...st, source };
  }

  function status() {
    return {
      version: EVENT_VERSION,
      started,
      mode: (config && config.mode) || 'disabled',
      environment: (config && config.environment) || 'unknown',
      appVersion: (config && config.appVersion) || APP_VERSION_FALLBACK,
      measurementConfigured: Boolean(config && config.measurementId),
      signalled: { sent: log.sent, dropped: log.dropped, queued: log.queued, rejected: log.rejected },
      reasons: { ...log.reasons },
      events: Object.keys(EVENTS).length,
      queue: readQueue().length,
      user: { signedIn: Boolean(userContext.id) }
    };
  }

  /* Wire the app-wide bus once. Every hook is defensive: a missing API or a
   * throw inside a handler must never surface to the student. */
  function attach() {
    try {
      /* Offline → online: drain whatever queued while the network was down. */
      window.addEventListener('online', () => { flushQueue().catch(() => false); });

      /* Screen tracking rides the router's own render event. */
      document.addEventListener('admission:route-rendered', (e) => {
        const path = (e && e.detail && e.detail.path) || 'dashboard';
        trackScreen(path);
        try { trackRouteContext(path); } catch (_) {}
      });

      /* Auth changes: user id + first name for segmentation, plus session. */
      window.addEventListener('admissionhub:authchange', (e) => {
        const detail = (e && e.detail) || {};
        if (detail.authenticated === true && detail.user && detail.user.id) {
          setUserContext({ id: detail.user.id, firstName: readFirstName() });
          trackEvent('session_start', { signed_in: true });
        } else {
          setUserContext({});
          trackEvent('session_start', { signed_in: false });
        }
      });

      /* Learning events already flow on this bus. The quiz-completion shapes are
       * built explicitly because their bus field names differ from the
       * dictionary's (`resultId`/`sessionId` → `quiz_id`); the rest are
       * table-driven and rely on camelCase → snake_case normalisation. */
      window.addEventListener('admission:activity', (e) => {
        const d = (e && e.detail) || {};
        if (d.type === 'TEST_COMPLETED' || d.type === 'REVISION_COMPLETED') {
          const isRevision = d.type === 'REVISION_COMPLETED';
          const quizType = d.quizType || d.testType || (isRevision ? 'revision' : d.mode);
          trackLearning('quiz_complete', {
            quiz_id: String((isRevision ? d.sessionId : d.resultId) || ''),
            quiz_type: quizType,
            question_count: d.questionCount,
            correct: d.correct,
            wrong: d.wrong,
            skipped: d.skipped,
            accuracy: d.accuracy,
            score: d.score,
            duration: d.duration
          });
          return;
        }
        const mapped = LEARNING_BUS_TYPES[d.type];
        if (!mapped) return;
        const slice = {};
        for (const k of Object.keys(d)) if (k !== 'type') slice[k] = d[k];
        trackLearning(mapped, slice);
      });
    } catch (_) { /* no DOM (node:test), hooks are optional */ }
  }

  /* Derive the Phase-1 learning events from a rendered route plus whatever the
   * app already exposes on `window`. Every read is defensive: this runs on every
   * navigation and must never be the reason a screen fails to render. */
  function trackRouteContext(path) {
    const route = String(path || '');
    const getExam = () => (typeof window.__admissionHubGetActiveExam === 'function' ? window.__admissionHubGetActiveExam() : null);

    if (route === 'exam/running') {
      const exam = getExam();
      if (exam) {
        trackLearning('quiz_start', {
          quiz_id: String(exam.id || ''),
          quiz_type: exam.mode === 'mock' ? 'mock' : 'exam',
          question_count: Array.isArray(exam.questions) ? exam.questions.length : undefined
        });
      }
      return;
    }
    if (route === 'exam/setup') return trackFeature('exam_setup', 'open');
    if (route === 'one-time-mock') return trackFeature('mock_exam', 'open');
    if (route === 'question-bank') return trackFeature('question_bank', 'open');
    if (route === 'progress') return trackFeature('progress', 'open');
    if (route === 'history') return trackFeature('exam_history', 'open');
    if (route === 'smart-formatter') return trackFeature('smart_formatter', 'open');
    if (route === 'import-questions' || route === 'add-question') return trackFeature('question_import', 'open');
    if (route === 'ai' || route.indexOf('ai/') === 0) return trackEvent('ai_chat_open', { signed_in: Boolean(userContext.id) });
    if (route === 'exam/result') return;

    if (route.indexOf('source-courses') === 0 || route.indexOf('courses/') === 0 ||
        route.indexOf('pdf-courses') === 0 || route.indexOf('interactive-courses') === 0) {
      /* Course routes carry the course id in the first path segment. */
      const seg = route.split('/').filter(Boolean);
      trackLearning('course_view', { course_id: seg.length > 1 ? seg[0] + '/' + seg[1] : seg[0] || route });
    }
  }

  /* Read only the first name, exactly like ai-agent-chat.js does. */
  function readFirstName() {
    try {
      const pid = localStorage.getItem('ah-profile-cache-key');
      if (!pid) return '';
      const entry = JSON.parse(localStorage.getItem('ah-profile-cache:' + pid) || 'null');
      const full = entry && entry.profile && entry.profile.fullName;
      return full ? String(full).split(/\s+/)[0] : '';
    } catch (_) { return ''; }
  }

  return {
    start,
    configure,
    status,
    attach,
    trackEvent,
    trackScreen,
    trackLearning,
    trackFeature,
    trackNotification,
    setUserContext,
    flushQueue,
    learningInsights,
    buildLearningInsights,
    readLedger,
    flushLedger,
    EVENTS,
    FUNNEL_STEPS,
    __test: { normalizeEvent, toSnake, coerceValue, isForbiddenKey, FORBIDDEN_PARAM, EVENT_VERSION, MAX_PARAMS, buildLearningInsights, checkDataQuality, computeStreak, retentionBuckets }
  };
});