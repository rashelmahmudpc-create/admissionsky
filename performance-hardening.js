/*
 * Admission Hub Part 2, Performance Hardening Layer
 *
 * This file is deliberately additive. It does not clear storage, replace the
 * application cache, reset user state, or alter the existing feature files.
 * It installs opt-in helpers and narrowly scoped compatibility wrappers.
 */
(() => {
  'use strict';

  const NS = window.AdmissionHubPerformance || {};
  const timers = new Set();
  const intervals = new Set();
  const observers = new Set();
  const listeners = new Map();
  const renderSignatures = new Map();
  const ROUTE_PREFIXES = ['question-bank', 'flash', 'exam'];
  const EXAM_BACKUP_KEY = 'admissionHub:performance:activeExamBackup:v1';
  const SEARCH_DEBOUNCE = 300;
  let lastRoute = routeName();
  let lastScrollY = window.scrollY || 0;
  let examFrame = 0;
  let examTickTimer = 0;
  let examPersistTimer = 0;
  let examPersistInFlight = false;
  let examPersistDirty = false;
  let submissionLock = null;

  function routeName() {
    return String(window.Router?.path || location.hash.replace(/^#\/?/, '').split('?')[0] || 'dashboard');
  }

  function isStabilityRoute(route = routeName()) {
    return ROUTE_PREFIXES.some(prefix => route === prefix || route.startsWith(`${prefix}/`));
  }

  function safeJson(value) {
    try { return JSON.stringify(value); } catch (_) { return null; }
  }

  function trackTimeout(fn, ms) {
    const id = window.setTimeout(() => { timers.delete(id); fn(); }, ms);
    timers.add(id);
    return id;
  }

  function trackInterval(fn, ms) {
    const id = window.setInterval(fn, ms);
    intervals.add(id);
    return id;
  }

  function clearTracked() {
    timers.forEach(id => window.clearTimeout(id));
    intervals.forEach(id => window.clearInterval(id));
    timers.clear(); intervals.clear();
    observers.forEach(observer => { try { observer.disconnect(); } catch (_) {} });
    observers.clear();
    if (examTickTimer) { window.clearInterval(examTickTimer); examTickTimer = 0; }
    if (examPersistDirty) void flushExamPersist();
    if (examPersistTimer) { window.clearTimeout(examPersistTimer); examPersistTimer = 0; }
  }

  function on(target, type, handler, options = {}) {
    if (!target?.addEventListener) return () => {};
    const capture = Boolean(typeof options === 'boolean' ? options : options.capture);
    const key = `${type}:${capture ? 'capture' : 'bubble'}`;
    const existing = listeners.get(key);
    if (existing) target.removeEventListener(type, existing, options);
    target.addEventListener(type, handler, options);
    listeners.set(key, handler);
    return () => {
      target.removeEventListener(type, handler, options);
      if (listeners.get(key) === handler) listeners.delete(key);
    };
  }

  function observe(target, callback, options) {
    if (!target || typeof MutationObserver === 'undefined') return null;
    const observer = new MutationObserver(callback);
    observer.observe(target, options);
    observers.add(observer);
    return observer;
  }

  function saveScroll() {
    lastScrollY = window.scrollY || document.documentElement.scrollTop || 0;
    return lastScrollY;
  }

  function restoreScroll(value = lastScrollY) {
    window.requestAnimationFrame(() => window.scrollTo({ top: Math.max(0, value), left: 0, behavior: 'auto' }));
  }

  function routeScrollGuard() {
    const routeBefore = routeName();
    const position = saveScroll();
    return () => {
      const routeAfter = routeName();
      // A running mock page transition intentionally resets to the first
      // question; restoring the previous page's bottom would undo that.
      if (routeAfter === routeBefore && routeAfter === 'exam/running') return;
      if (routeAfter === routeBefore && isStabilityRoute(routeAfter)) restoreScroll(position);
      else if (routeAfter !== routeBefore) window.requestAnimationFrame(() => window.scrollTo(0, 0));
    };
  }

  function questionSignature() {
    const practice = window.QuestionBankPracticeSession;
    const topic = window.ExplorerState?.topicId || '';
    const answers = practice?.answers || {};
    const revealed = practice?.revealed || {};
    const answerVersion = Object.keys(answers).sort().map(id => `${id}:${answers[id]?.selected}:${answers[id]?.correct}`).join('|');
    const revealVersion = Object.keys(revealed).sort().join('|');
    return [routeName(), topic, window.ExplorerState?.status || '', practice?.query || '', answerVersion, revealVersion].join('::');
  }

  function lazyRender(container, items, renderItem, options = {}) {
    if (!container || !Array.isArray(items) || typeof renderItem !== 'function') return;
    const chunk = Math.max(1, Number(options.chunkSize || 20));
    let cursor = 0;
    const append = () => {
      const fragment = document.createDocumentFragment();
      const end = Math.min(items.length, cursor + chunk);
      for (; cursor < end; cursor += 1) {
        const node = renderItem(items[cursor], cursor);
        if (node) fragment.appendChild(node);
      }
      container.appendChild(fragment);
      if (cursor < items.length) window.requestAnimationFrame(append);
    };
    append();
  }

  async function cursorPage(storeName, options = {}) {
    const db = options.db || window.__admissionHubDB || window.db;
    const database = db?.db || db;
    if (!database?.transaction) return { items: [], nextKey: null, hasMore: false };
    const pageSize = Math.max(1, Number(options.pageSize || 20));
    const direction = options.direction === 'prev' ? 'prev' : 'next';
    const range = options.startKey == null ? undefined : (direction === 'next' ? IDBKeyRange.lowerBound(options.startKey, Boolean(options.startExclusive)) : IDBKeyRange.upperBound(options.startKey, Boolean(options.startExclusive)));
    return new Promise((resolve, reject) => {
      let tx;
      try { tx = database.transaction(storeName, 'readonly'); } catch (error) { reject(error); return; }
      const request = tx.objectStore(storeName).openCursor(range, direction);
      const items = [];
      let nextKey = null;
      request.onsuccess = event => {
        const cursor = event.target.result;
        if (!cursor || items.length >= pageSize) { resolve({ items, nextKey, hasMore: Boolean(cursor) }); return; }
        items.push(cursor.value);
        nextKey = cursor.key;
        cursor.continue();
      };
      request.onerror = () => reject(request.error || new Error('IndexedDB cursor failed'));
    });
  }

  function activeExam() {
    try {
      if (typeof window.__admissionHubGetActiveExam === 'function') return window.__admissionHubGetActiveExam();
    } catch (_) {}
    return window.ActiveExam || window.activeExam || null;
  }

  function backupExamState(reason = 'answer') {
    const exam = activeExam();
    if (!exam || typeof exam !== 'object') return false;
    // Keep this emergency backup intentionally lightweight. The full question
    // snapshot already lives in IndexedDB; serializing 500 questions on every
    // answer tap makes long tests lag and can trigger mobile tab eviction.
    const safeExam = {
      id: exam.id, mode: exam.mode, questionIds: Array.isArray(exam.questionIds) ? exam.questionIds : [],
      currentIndex: Number(exam.currentIndex || 0), selectedAnswers: {...(exam.selectedAnswers || {})},
      startTime: exam.startTime, duration: exam.duration, endTime: exam.endTime, negative: exam.negative,
      status: exam.status, configuration: exam.configuration || {}, timing: {...(exam.timing || {})},
      questionStartedAt: {...(exam.questionStartedAt || {})}, flashResults: {...(exam.flashResults || {})},
      bookmarks: Array.from(exam.bookmarks || []), flags: Array.from(exam.flags || [])
    };
    const payload = { version: 3, reason, savedAt: Date.now(), route: routeName(), exam: safeExam };
    const serialized = safeJson(payload);
    if (!serialized) return false;
    try { sessionStorage.setItem(EXAM_BACKUP_KEY, serialized); return true; } catch (_) { return false; }
  }

  function readExamBackup() {
    try { return JSON.parse(sessionStorage.getItem(EXAM_BACKUP_KEY) || 'null'); } catch (_) { return null; }
  }

  function nowRemaining(exam) {
    if (!exam || exam.mode !== 'mock') return null;
    const duration = Number(exam.duration || 0);
    const start = Number(exam.startTime || 0);
    if (!duration || !start) return null;
    return Math.max(0, duration - Math.floor((Date.now() - start) / 1000));
  }

  // Persist only the latest in-memory exam state. A full 500-question exam
  // object does not need a separate IndexedDB transaction for every tap.
  function queueExamPersist() {
    examPersistDirty = true;
    if (examPersistInFlight || examPersistTimer) return;
    examPersistTimer = window.setTimeout(flushExamPersist, 180);
  }
  async function flushExamPersist() {
    examPersistTimer = 0;
    if (!examPersistDirty) return;
    examPersistDirty = false;
    const exam = activeExam();
    if (!exam) return;
    examPersistInFlight = true;
    try { await dbPut('exams', exam); } catch (_) {}
    examPersistInFlight = false;
    if (examPersistDirty) queueExamPersist();
  }

  function accurateClock(exam, callback) {
    const start = Number(exam?.startTime || Date.now());
    const duration = Math.max(0, Number(exam?.duration || 0));
    const tick = () => {
      const remaining = Math.max(0, duration - Math.floor((Date.now() - start) / 1000));
      callback?.(remaining);
      return remaining;
    };
    return { tick, remaining: tick() };
  }

  function startExamWatch() {
    if (examTickTimer) return;
    const tick = () => {
      const exam = activeExam();
      if (!exam || routeName() !== 'exam/running') return;
      const remaining = nowRemaining(exam);
      if (remaining == null) return;
      const timer = document.querySelector('#examTimer, .timerbox, .timer');
      if (timer && typeof window.fmtTime === 'function') timer.textContent = window.fmtTime(remaining);
      if (remaining <= 0 && typeof window.submitExam === 'function' && !exam.isSubmitting) {
        try { window.submitExam(true); } catch (_) {}
      }
    };
    tick();
    examTickTimer = window.setInterval(tick, 1000);
  }

  function wrapSubmission() {
    const original = window.submitExam;
    if (typeof original !== 'function' || original.__ahPerformanceLocked) return;
    const wrapped = function (...args) {
      if (submissionLock) return submissionLock;
      const exam = activeExam();
      if (!exam || exam.isSubmitting) return original.apply(this, args);
      backupExamState('submit');
      submissionLock = Promise.resolve().then(() => original.apply(this, args)).finally(() => {
        trackTimeout(() => { submissionLock = null; }, 0);
      });
      return submissionLock;
    };
    wrapped.__ahPerformanceLocked = true;
    wrapped.__ahOriginal = original;
    window.submitExam = wrapped;
    try { submitExam = wrapped; } catch (_) {}
  }

  function wrapAnswerFunction(name) {
    const original = window[name];
    if (typeof original !== 'function' || original.__ahPerformanceBackedUp) return;
    let lastBackupAt = 0;
    const wrapped = function (...args) {
      const now = Date.now();
      if (now - lastBackupAt > 450) { backupExamState(`before:${name}`); lastBackupAt = now; }
      const result = original.apply(this, args);
      backupExamState(`after:${name}`);
      return result;
    };
    wrapped.__ahPerformanceBackedUp = true;
    window[name] = wrapped;
    try { window[name] = wrapped; } catch (_) {}
  }

  function installQbankHardening() {
    const originalSearch = window.qbankSearch;
    if (typeof originalSearch === 'function' && !originalSearch.__ahDebounced) {
      let timer = 0;
      const debounced = function (value) {
        window.QuestionBankPracticeSession && (window.QuestionBankPracticeSession.query = String(value || ''));
        window.clearTimeout(timer);
        timer = window.setTimeout(() => originalSearch(value), SEARCH_DEBOUNCE - 200);
      };
      debounced.__ahDebounced = true;
      debounced.__ahDebounceMs = SEARCH_DEBOUNCE;
      window.qbankSearch = debounced;
    }
    const originalRender = window.renderQuestionBankV2;
    if (typeof originalRender === 'function' && !originalRender.__ahDiffChecked) {
      const wrapped = function (...args) {
        const key = routeName();
        const signature = questionSignature();
        const current = document.querySelector('.q-bank-container');
        if (current && renderSignatures.get(key) === signature) return current;
        renderSignatures.set(key, signature);
        return originalRender.apply(this, args);
      };
      wrapped.__ahDiffChecked = true;
      wrapped.__ahOriginal = originalRender;
      window.renderQuestionBankV2 = wrapped;
    }
  }

  function installRenderStability() {
    const originalShell = window.renderShell;
    if (typeof originalShell !== 'function' || originalShell.__ahScrollStable) return;
    const wrapped = function (...args) {
      const restore = routeScrollGuard();
      const result = originalShell.apply(this, args);
      restore();
      return result;
    };
    wrapped.__ahScrollStable = true;
    wrapped.__ahOriginal = originalShell;
    window.renderShell = wrapped;
  }

  function injectPerformanceStyles() {
    if (document.getElementById('admission-hub-performance-style')) return;
    const style = document.createElement('style');
    style.id = 'admission-hub-performance-style';
    style.textContent = `
      .q-card-v2,.explorer-card,.flash-card,.q-feed-body > * { content-visibility:auto; contain-intrinsic-size:240px; }
      .q-card-v2,.explorer-card,.flash-card { will-change:transform,opacity; }
      /* Mock cards must stay in a stable native flow on iOS/PWA. */
      .exam-q-card,.exam-q-card:active { content-visibility:visible !important; contain:none !important; will-change:auto !important; transform:none !important; transition:none !important; }
      .qbank-page-btn,.q-opt-v2,.opt,.btn,.iconbtn,.navbtn { backface-visibility:hidden; transform:translateZ(0); }
      body.ah-is-scrolling .card, body.ah-is-scrolling .q-card-v2, body.ah-is-scrolling .explorer-card { box-shadow:none !important; filter:none !important; }
      @media (prefers-reduced-motion: reduce) {
        *, *::before, *::after { animation-duration:.001ms !important; animation-iteration-count:1 !important; transition-duration:.001ms !important; scroll-behavior:auto !important; }
        [will-change] { will-change:auto !important; }
      }
    `;
    document.head.appendChild(style);
  }

  function installScrollPerformance() {
    let scrollFrame = 0;
    on(window, 'scroll', () => {
      if (scrollFrame) return;
      scrollFrame = window.requestAnimationFrame(() => {
        scrollFrame = 0;
        document.body.classList.add('ah-is-scrolling');
        window.clearTimeout(window.__ahScrollEndTimer);
        window.__ahScrollEndTimer = window.setTimeout(() => document.body.classList.remove('ah-is-scrolling'), 120);
      });
    }, { passive: true });
    on(window, 'touchstart', saveScroll, { passive: true });
    on(window, 'touchmove', saveScroll, { passive: true });
  }

  function installRouteCleanup() {
    const handleRoute = () => {
      const next = routeName();
      if (next !== lastRoute) {
        clearTracked();
        renderSignatures.clear();
        lastRoute = next;
        if (isStabilityRoute(next)) window.requestAnimationFrame(() => window.scrollTo(0, 0));
      }
      if (next === 'exam/running') startExamWatch();
      if (next.startsWith('question-bank/topic/')) installQbankHardening();
    };
    on(window, 'hashchange', handleRoute, { passive: true });
    on(window, 'popstate', handleRoute, { passive: true });
    observe(document.body, () => { if (routeName() !== lastRoute) handleRoute(); }, { childList: true, subtree: true });
  }

  function init() {
    NS.cursorPage = cursorPage;
    NS.lazyRender = lazyRender;
    NS.trackTimeout = trackTimeout;
    NS.trackInterval = trackInterval;
    NS.observe = observe;
    NS.cleanup = clearTracked;
    NS.saveScroll = saveScroll;
    NS.restoreScroll = restoreScroll;
    NS.backupExamState = backupExamState;
    NS.readExamBackup = readExamBackup;
    NS.accurateClock = accurateClock;
    NS.getRemainingSeconds = () => nowRemaining(activeExam());
    NS.SEARCH_DEBOUNCE = SEARCH_DEBOUNCE;
    NS.queueExamPersist = queueExamPersist;
    NS.flushExamPersist = flushExamPersist;
    window.AdmissionHubPerformance = NS;

    injectPerformanceStyles();
    installScrollPerformance();
    installRenderStability();
    installQbankHardening();
    ['selectMockAnswer', 'selectFlashAnswer', 'selectTopicAnswer'].forEach(wrapAnswerFunction);
    wrapSubmission();
    backupExamState('initial');
    installRouteCleanup();
    startExamWatch();
    on(window, 'pagehide', () => { try { flushExamPersist(); } catch (_) {} backupExamState('pagehide'); }, { passive: true });
    on(document, 'visibilitychange', () => { if (document.visibilityState !== 'visible') { try { flushExamPersist(); } catch (_) {} backupExamState('hidden'); } }, { passive: true });
    window.__admissionHubPerformanceReady = true;
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true, passive: true });
  else init();
})();
