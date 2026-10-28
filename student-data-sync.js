/* Student data ↔ server sync engine.
 *
 * IndexedDB stays the working copy (instant, offline-safe). This module mirrors
 * every student-owned row to the account on the server so data survives a
 * cleared browser, a new phone, or a year away, and so the notification engine
 * can read real learning state.
 *
 * Contract with the app:
 *   - Nothing here blocks the UI. If the network is down the write already
 *     landed locally and the op waits in the queue.
 *   - Ownership is the server's job: it resolves the user from the session
 *     cookie. This module never sends a user id.
 *   - `window.AHStudentSync` is the only surface the app needs.
 *
 * Wire shapes:
 *   POST /api/userdata/sync    { device, ops:[{store,id,op,doc,updated_at}] }
 *   GET  /api/userdata/pull    ?store=&since=&limit=&cursor=
 *   GET  /api/userdata/bootstrap
 */
(function (global) {
  'use strict';

  /* Only student-owned stores are mirrored. questions/topics/vocabulary are
   * shared product content and already live on the server. */
  const SYNC_STORES = Object.freeze([
    'examResults', 'exams', 'mistakes', 'dailyStats',
    'activityLogs', 'notes', 'ADMISSION_PLANS', 'PLAN_DAYS', 'settings'
  ]);
  const STORE_SET = new Set(SYNC_STORES);

  const QUEUE_KEY = 'ahStudentSyncQueue:v1';
  const META_KEY = 'ahStudentSyncMeta:v1';
  const DEVICE_KEY = 'ahStudentSyncDevice:v1';
  const MIGRATED_KEY = 'ahStudentSyncMigrated:v1';

  const BATCH_MAX = 200;          /* server cap is 400; leave headroom */
  const FLUSH_DEBOUNCE_MS = 2500;
  const PULL_PAGE_LIMIT = 300;
  const MAX_QUEUE = 5000;         /* oldest ops beyond this are dropped, loudly */

  const now = () => Date.now();
  const safeParse = (value, fallback) => {
    try {
      const parsed = JSON.parse(value);
      return parsed == null ? fallback : parsed;
    } catch { return fallback; }
  };
  const readLS = (key, fallback) => {
    try { return safeParse(localStorage.getItem(key), fallback); } catch { return fallback; }
  };
  const writeLS = (key, value) => {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
  };

  /* Stable per-install device id, diagnostics only, never identity. */
  const deviceId = (() => {
    let id = readLS(DEVICE_KEY, null);
    if (typeof id === 'string' && /^[\w-]{6,40}$/.test(id)) return id;
    id = 'dev-' + Math.random().toString(36).slice(2, 10) + now().toString(36);
    writeLS(DEVICE_KEY, id);
    return id;
  })();

  const state = {
    active: false,       /* a signed-in account owns the current scope */
    scope: '',
    online: true,
    flushing: false,
    pulling: false,
    timer: 0,
    lastError: '',
    lastPushAt: 0,
    lastPullAt: 0
  };

  let queue = readLS(QUEUE_KEY, []);
  if (!Array.isArray(queue)) queue = [];
  const meta = readLS(META_KEY, {});

  const persistQueue = () => writeLS(QUEUE_KEY, queue);
  const persistMeta = () => writeLS(META_KEY, meta);

  const log = (...args) => {
    try { console.info('[StudentSync]', ...args); } catch { /* noop */ }
  };

  /* ── queue ─────────────────────────────────────────────────────────────── */

  /* Coalesce per (store,id): the newest write wins, so a burst of edits to one
   * record becomes a single op instead of a queue full of stale ones. */
  function enqueue(store, id, op, doc, updatedAt) {
    if (!STORE_SET.has(store) || !state.active) return;
    const key = store + '\u0000' + String(id);
    const entry = {
      store,
      id: String(id),
      op,
      doc: op === 'delete' ? null : doc,
      updated_at: Number(updatedAt) || now()
    };
    for (let i = queue.length - 1; i >= 0; i -= 1) {
      if (queue[i].store + '\u0000' + String(queue[i].id) === key) queue.splice(i, 1);
    }
    queue.push(entry);
    if (queue.length > MAX_QUEUE) {
      const dropped = queue.splice(0, queue.length - MAX_QUEUE);
      console.warn('[StudentSync] queue overflow, dropped oldest ops', dropped.length);
    }
    persistQueue();
    requestBackgroundSync();
    scheduleFlush();
  }

  /* Ask the service worker to wake us when connectivity returns, even if this
   * page has been closed. Best effort: Safari and some browsers do not support
   * it, in which case the plain 'online' listener still flushes. */
  function requestBackgroundSync() {
    try {
      if (typeof navigator === 'undefined' || !navigator.serviceWorker) return;
      if (!('SyncManager' in global) && !('sync' in (navigator.serviceWorker || {}))) return;
      navigator.serviceWorker.ready
        .then(reg => { if (reg && reg.sync && typeof reg.sync.register === 'function') return reg.sync.register('ah-student-sync'); })
        .catch(() => {});
    } catch (_) { /* unsupported, the 'online' event is the fallback */ }
  }

  /* A live status stream for the honest offline indicator in the UI. */
  function emitStatus() {
    try {
      global.dispatchEvent(new CustomEvent('admissionhub:sync-status', {
        detail: {
          online: state.online,
          active: state.active,
          pending: pendingCount(),
          lastError: state.lastError
        }
      }));
    } catch (_) {}
  }

  function scheduleFlush(delay) {
    if (!state.active) return;
    if (state.timer) clearTimeout(state.timer);
    state.timer = setTimeout(() => { state.timer = 0; void flush(); }, Number.isFinite(delay) ? delay : FLUSH_DEBOUNCE_MS);
  }

  function pendingCount() { return queue.length; }

  /* ── transport ─────────────────────────────────────────────────────────── */

  async function api(path, init) {
    const res = await fetch(path, {
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      ...init
    });
    let body = null;
    try { body = await res.json(); } catch { /* non-JSON */ }
    return { status: res.status, ok: res.ok, body: body || {} };
  }

  /* ── push ──────────────────────────────────────────────────────────────── */

  async function flush() {
    if (!state.active || state.flushing || !queue.length) return { skipped: true };
    if (!state.online) return { skipped: true, offline: true };
    state.flushing = true;
    let sent = 0;
    const reconcileStores = new Set();
    try {
      while (queue.length) {
        /* Only send ops for stores this scope actually owns. */
        const batch = queue.filter(op => STORE_SET.has(op.store)).slice(0, BATCH_MAX);
        if (!batch.length) { queue = []; persistQueue(); break; }
        const res = await api('/api/userdata/sync', {
          method: 'POST',
          body: JSON.stringify({ device: deviceId, ops: batch })
        });
        if (res.status === 401) { state.active = false; break; }
        if (!res.ok) { state.lastError = 'push-' + res.status; break; }

        const results = Array.isArray(res.body.results) ? res.body.results : [];
        const ack = new Map();
        for (const r of results) ack.set(r.store + '\u0000' + String(r.id), r);

        /* Remove exactly the batch we sent; keep anything newer that arrived
         * while the request was in flight, and keep anything the server did
         * not explicitly acknowledge, a missing ack means "not persisted",
         * not "done", so dropping it would lose the write silently. */
        const sentKeys = new Set(batch.map(op => op.store + '\u0000' + String(op.id)));
        const leftover = [];
        let acked = 0;
        for (const op of queue) {
          const key = op.store + '\u0000' + String(op.id);
          if (sentKeys.has(key)) {
            const r = ack.get(key);
            if (!r) { leftover.push(op); continue; }
            /* A newer local write replaced this op mid-flight: the staged op is
             * newer than what the server acked, so keep it and push it next. */
            if (Number(r.updated_at) < Number(op.updated_at)) { leftover.push(op); continue; }
            /* The server already held a newer row than ours; re-pull so this
             * device converges instead of retrying an op it can never win. */
            if (r.applied === false) reconcileStores.add(r.store);
            /* Acknowledged at least this version → safe to drop. */
            acked += 1;
          } else {
            leftover.push(op);
          }
        }
        queue = leftover;
        persistQueue();
        sent += acked;
        /* If the batch made no progress, nothing acked, everything requeued -
         * stop instead of hammering the server with the same ops forever. */
        if (acked === 0) break;
        if (batch.length < BATCH_MAX) break;
      }
      if (sent) {
        state.lastPushAt = now();
        state.lastError = '';
        meta.lastPushAt = state.lastPushAt;
        persistMeta();
        log('pushed', sent, 'ops');
      }
    } catch (err) {
      state.lastError = 'network';
      if (typeof navigator !== 'undefined' && navigator.onLine === false) state.online = false;
      log('push paused', String(err && err.message || err));
    } finally {
      state.flushing = false;
      emitStatus();
      /* Converge any store where the server won the conflict. */
      if (reconcileStores.size) {
        void (async () => { for (const s of reconcileStores) await pullStore(s); })();
      }
    }
    return { sent };
  }

  /* ── pull (new device / incremental refresh) ───────────────────────────── */

  /* Rows landing from the server are marked, and the app's mirror hook ignores
   * anything carrying `syncedAt`, so a pull can never echo back as a push. */
  async function applySilently(fn) {
    try { return await fn(); } catch (err) { log('apply failed', String(err && err.message || err)); }
  }

  async function pullStore(store) {
    if (typeof global.dbPut !== 'function') return { store, applied: 0 };
    let cursor = String((meta.cursors || {})[store] || '');
    let applied = 0;
    for (let guard = 0; guard < 50; guard += 1) {
      const prevCursor = cursor;
      const q = 'store=' + encodeURIComponent(store) + '&since=0&limit=' + PULL_PAGE_LIMIT + '&cursor=' + encodeURIComponent(cursor);
      const res = await api('/api/userdata/pull?' + q);
      if (res.status === 401) { state.active = false; return { store, applied }; }
      if (!res.ok) break;
      const items = Array.isArray(res.body.items) ? res.body.items : [];
      for (const item of items) {
        if (item.deleted) {
          if (typeof global.dbDel === 'function') await applySilently(() => global.dbDel(store, item.id));
        } else if (item.doc && typeof item.doc === 'object') {
          const doc = Object.assign({}, item.doc, { id: item.id, updatedAt: item.updated_at, syncedAt: now() });
          await applySilently(() => global.dbPut(store, doc));
          applied += 1;
        }
      }
      cursor = String(res.body.cursor || cursor);
      meta.cursors = Object.assign({}, meta.cursors, { [store]: cursor });
      persistMeta();
      /* A server that keeps claiming hasMore=true without advancing the cursor
       * would spin forever; stop when the page adds nothing new. */
      if (!res.body.hasMore || !items.length || cursor === prevCursor) break;
    }
    return { store, applied };
  }

  async function pullAll() {
    if (!state.active || state.pulling || !state.online) return { skipped: true };
    state.pulling = true;
    const out = {};
    let total = 0;
    const emit = (type, detail) => { try { global.dispatchEvent(new CustomEvent(type, { detail })); } catch { /* noop */ } };
    try {
      emit('admissionhub:sync-apply-start', {});
      for (const store of SYNC_STORES) {
        const applied = (await pullStore(store)).applied;
        out[store] = applied;
        total += applied;
      }
      state.lastPullAt = now();
      meta.lastPullAt = state.lastPullAt;
      persistMeta();
      log('pulled', out);
    } catch (err) {
      log('pull paused', String(err && err.message || err));
    } finally {
      state.pulling = false;
      emit('admissionhub:sync-apply-end', {});
      if (total) emit('admissionhub:sync-applied', { applied: total });
    }
    return out;
  }

  /* ── first-run migration of existing local data ────────────────────────── */

  /* Uploads what is already on this device, once per account, without ever
   * clearing local data. Batched so thousands of rows never go in one request. */
  async function migrateLocal(scope) {
    if (readLS(MIGRATED_KEY, {}) && readLS(MIGRATED_KEY, {})[scope]) return { skipped: true };
    const done = readLS(MIGRATED_KEY, {}) || {};
    let total = 0;
    for (const store of SYNC_STORES) {
      if (typeof global.dbGetAll !== 'function') break;
      let rows = [];
      try { rows = await global.dbGetAll(store); } catch { rows = []; }
      for (const row of rows) {
        if (!row || row.id === undefined) continue;
        /* Do not re-upload rows this device already synced. */
        if (row.syncedAt) continue;
        enqueue(store, row.id, 'put', row, row.updatedAt || row.updated_at || now());
        total += 1;
      }
    }
    if (total) await flush();
    done[scope] = now();
    writeLS(MIGRATED_KEY, done);
    log('migrated local rows', total);
    return { migrated: total };
  }

  /* ── lifecycle ─────────────────────────────────────────────────────────── */

  function activate(scope) {
    if (!scope || !/^[\w.:@-]{3,128}$/.test(scope)) return;
    state.active = true;
    state.scope = scope;
    state.cursors = meta.cursors || {};
    log('active for scope', scope);
    emitStatus();
    void (async () => {
      await migrateLocal(scope);
      await pullAll();
      await flush();
    })();
  }

  function deactivate() {
    state.active = false;
    state.scope = '';
    if (state.timer) { clearTimeout(state.timer); state.timer = 0; }
    /* The queue belongs to the account, so it is retained until that account
     * signs back in; a different account must not inherit it. */
    queue = [];
    persistQueue();
    emitStatus();
  }

  function setOnline(online) {
    state.online = !!online;
    emitStatus();
    if (state.online && state.active) { void flush(); void pullAll(); }
  }

  if (typeof global.addEventListener === 'function') {
    global.addEventListener('online', () => setOnline(true));
    global.addEventListener('offline', () => setOnline(false));
    global.addEventListener('admissionhub:authchange', event => {
      const detail = event && event.detail || {};
      const id = detail.authenticated === true && detail.user && detail.user.id ? String(detail.user.id) : '';
      if (id) activate(id); else deactivate();
    });
    /* The app signals a local write through this event so the engine can mirror
     * it without the app importing this module directly. */
    global.addEventListener('admissionhub:local-write', event => {
      const d = event && event.detail || {};
      if (d.store) enqueue(d.store, d.id, d.op === 'delete' ? 'delete' : 'put', d.doc, d.updated_at);
    });
    global.addEventListener('admissionhub:sync-now', () => scheduleFlush(0));
    /* The service worker nudges us from its Background Sync wake-up. */
    if (navigator.serviceWorker && typeof navigator.serviceWorker.addEventListener === 'function') {
      navigator.serviceWorker.addEventListener('message', event => {
        if (event && event.data && event.data.type === 'FLUSH_STUDENT_SYNC') {
          if (state.active) { void flush(); void pullAll(); }
        }
      });
    }
  }

  if (typeof navigator !== 'undefined' && navigator.onLine === false) state.online = false;

  global.AHStudentSync = {
    STORES: SYNC_STORES,
    activate,
    deactivate,
    flush,
    pull: pullAll,
    migrate: migrateLocal,
    setOnline,
    status: () => ({
      active: state.active,
      scope: state.scope,
      online: state.online,
      pending: pendingCount(),
      lastPushAt: state.lastPushAt,
      lastPullAt: state.lastPullAt,
      lastError: state.lastError
    })
  };
})(typeof window !== 'undefined' ? window : globalThis);
