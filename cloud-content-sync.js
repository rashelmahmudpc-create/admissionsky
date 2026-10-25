/* Phase 2/3, global content cloud bridge.
   Fast batched IDB (Android-safe). Never clear-before-write.
   control → POST /api/cloud/publish ; public ← GET /pub/content */
(() => {
  'use strict';
  const WORKER = ''; /* P15: same-origin-প্রক্সি-প্রথম */
  const CANON = 'https://admission-gk.admissionhub.workers.dev';
  const apiFetch = async (path, init) => { try { const r = await fetch(WORKER + path, init); return r; } catch (_) {} return fetch(CANON + path, init); };
  const ROLE = String(window.AH_CLOUD_ROLE || '').trim() || 'public';
  const GLOBAL_STORES = ['subjects', 'topics', 'questions', 'vocabulary', 'vocabularyMaster'];
  const META_KEY = 'ahCloudApplied';
  const APP_HEADER = { 'X-AH-App': 'admission-hub', 'Content-Type': 'application/json' };
  /* BUG-001: the worker no longer accepts the static header as proof on the
     write routes. A control-role device sends the owner's admin token, which it
     already holds for the admin pages; without one the publish is refused. */
  const writeHeaders = () => {
    let token = '';
    try { token = sessionStorage.getItem('ahAdminTok') || ''; } catch (_) {}
    return token ? { ...APP_HEADER, Authorization: 'Bearer ' + token } : APP_HEADER;
  };

  const bootReady = async () => {
    if (window.__admissionBootPromise) {
      try { await window.__admissionBootPromise; } catch (_) {}
    }
    return typeof dbGetAll === 'function' && typeof dbPut === 'function';
  };

  const stripHeavy = rec => {
    if (!rec || typeof rec !== 'object') return rec;
    const o = Object.assign({}, rec);
    ['imageDataUrl', 'image', 'thumbnail'].forEach(k => {
      if (typeof o[k] === 'string' && o[k].startsWith('data:') && o[k].length > 900000) delete o[k];
    });
    return o;
  };

  const nativeQuestion = q => q && q.id && (q.question || q.q) && (Array.isArray(q.options) || Array.isArray(q.o));

  const putManyFast = async (store, items) => {
    const rows = Array.isArray(items) ? items.filter(x => x && x.id) : [];
    if (!rows.length) return true;
    const chunkSize = 400;
    for (let i = 0; i < rows.length; i += chunkSize) {
      const chunk = rows.slice(i, i + chunkSize);
      const liveDb = () => (typeof DB !== 'undefined' && DB) ? DB : null;
      const db = liveDb();
      if (db && db.objectStoreNames.contains(store)) {
        await new Promise((resolve, reject) => {
          let settled = false, retried = false;
          const doTx = () => {
            const d = liveDb();
            if (!d || !d.objectStoreNames.contains(store)) { settled = true; reject(new Error('IndexedDB unavailable')); return; }
            try {
              const tx = d.transaction(store, 'readwrite');
              const os = tx.objectStore(store);
              for (let n = 0; n < chunk.length; n++) os.put(chunk[n]);
              tx.oncomplete = () => { settled = true; resolve(true); };
              tx.onabort = () => { if (!settled) { settled = true; reject(tx.error || new Error('abort')); } };
              tx.onerror = () => { if (!settled) { settled = true; reject(tx.error); } };
            } catch (err) {
              /* D-V186: connection-is-closing → একবার রি-ওপেন করে পুনরায় */
              if (!retried && /closing|InvalidState|not active|connection/i.test(String((err && err.message) || err)) && window.__ahReopenDb) {
                retried = true;
                window.__ahReopenDb().then(() => { if (!settled) doTx(); }).catch(() => { if (!settled) { settled = true; reject(err); } });
              } else { settled = true; reject(err); }
            }
          };
          doTx();
        });
      } else {
        for (let n = 0; n < chunk.length; n++) await dbPut(store, chunk[n]);
      }
      await new Promise(r => setTimeout(r, 0));
    }
    return true;
  };

  if (typeof window.dbPutMany === 'function' && !window.__ahFastPutMany) {
    window.__ahFastPutMany = true;
    const orig = window.dbPutMany;
    window.dbPutMany = async function (store, arr) {
      try { return await putManyFast(store, arr); } catch (_) { return orig.apply(this, arguments); }
    };
  }

  const collect = async () => {
    const out = {};
    for (const st of GLOBAL_STORES) {
      const rows = await dbGetAll(st).catch(() => []);
      out[st] = (Array.isArray(rows) ? rows : []).filter(x => x && x.id).map(stripHeavy);
    }
    return out;
  };

  const fingerprint = data => {
    const q = data.questions || [];
    const vm = data.vocabularyMaster || [];
    const imgs = vm.filter(x => x && (x.imageDataUrl || x.image)).length;
    return [
      (data.subjects || []).length,
      (data.topics || []).length,
      q.length,
      (data.vocabulary || []).length,
      vm.length,
      imgs,
      q.reduce((n, x) => n + String(x.question || x.q || '').length, 0)
    ].join(':');
  };

  let publishTimer = 0;
  let publishing = false;
  const publish = async () => {
    if (ROLE !== 'control' || publishing) return;
    if (!(await bootReady())) return;
    const full = await collect();
    if (!(full.questions || []).length && !(full.vocabularyMaster || []).length && !(full.vocabulary || []).length) return;
    const fp = fingerprint(full);
    try { if (sessionStorage.getItem('ahCloudFp') === fp) return; } catch (_) {}
    publishing = true;
    try {
      const res = await apiFetch('/api/cloud/publish', { method: 'POST', headers: writeHeaders(), body: JSON.stringify(full) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || ('http-' + res.status));
      try { sessionStorage.setItem('ahCloudFp', fp); localStorage.setItem('ahCloudLastPublishAt', String(Date.now())); } catch (_) {}
      window.__ahCloudLastPublish = data;
    } catch (e) {
      window.__ahCloudPublishErr = String(e && e.message || e).slice(0, 120);
    } finally {
      publishing = false;
    }
  };

  const schedulePublish = () => {
    if (ROLE !== 'control') return;
    clearTimeout(publishTimer);
    publishTimer = setTimeout(() => { publish().catch(() => {}); }, 4000);
  };

  const hookWrites = () => {
    if (ROLE !== 'control' || window.__ahCloudWriteHook) return;
    window.__ahCloudWriteHook = true;
    const stores = new Set(GLOBAL_STORES);
    ['dbPut', 'dbPutMany', 'dbDel', 'dbDelRaw', 'dbClear'].forEach(name => {
      const orig = window[name];
      if (typeof orig !== 'function') return;
      window[name] = function ahCloudWrapped() {
        const store = arguments[0];
        const ret = orig.apply(this, arguments);
        if (stores.has(store)) schedulePublish();
        return ret;
      };
    });
  };

  const appliedMeta = () => {
    try { return JSON.parse(localStorage.getItem(META_KEY) || 'null') || { v: 0 }; } catch (_) { return { v: 0 }; }
  };
  const saveApplied = meta => {
    try { localStorage.setItem(META_KEY, JSON.stringify(meta)); } catch (_) {}
  };
  /* A store whose rows are gone from the SERVER must be emptied on the device
     too. applyDoc only writes what it receives, so an emptied vocabulary bank
     would otherwise leave the device serving its old rows forever, the pull
     would look "already applied" and every screen would keep showing words that
     no longer exist upstream. Owner-ordered vocabulary erase (2026-10-11) is
     the reason this exists. Keys absent from the document are ignored: a
     partial payload must never be read as "everything was deleted". */
  const EMPTIED_STORES = ['vocabularyMaster', 'vocabulary'];
  const purgeServerEmptiedStores = async doc => {
    if (typeof dbClear !== 'function') return;
    for (const store of EMPTIED_STORES) {
      if (!Array.isArray(doc[store]) || doc[store].length) continue;
      try { await dbClear(store); } catch (_) {}
    }
  };

  const applyDoc = async doc => {
    if (!doc) return false;
    const subjects = Array.isArray(doc.subjects) ? doc.subjects : [];
    const topics = Array.isArray(doc.topics) ? doc.topics : [];
    const questions = Array.isArray(doc.questions) ? doc.questions : [];
    const vocabulary = Array.isArray(doc.vocabulary) ? doc.vocabulary : [];
    const vocabularyMaster = Array.isArray(doc.vocabularyMaster) ? doc.vocabularyMaster : [];
    if (!questions.length || !nativeQuestion(questions[0])) return false;
    if (!subjects.length || !topics.length) return false;
    await putManyFast('subjects', subjects);
    await putManyFast('topics', topics);
    await putManyFast('questions', questions);
    await purgeServerEmptiedStores(doc);
    if (vocabulary.length) await putManyFast('vocabulary', vocabulary.filter(x => x && x.id));
    if (typeof loadCache === 'function') await loadCache();
    if (typeof render === 'function') render();
    /* The vocabulary bank is thousands of rows and is read on its own route, so
       it must not sit on the first-paint path: writing 6k+ rows before render()
       is what made the app look like it was loading for hours. Paint from the
       core stores, then hydrate the bank in the background. `applied` is
       returned so the caller saves the signature only once the bank has landed
       too, otherwise a half-hydrated device would look up to date. */
    if (vocabularyMaster.length) return hydrateVocabularyInBackground(vocabularyMaster.filter(x => x && x.id));
    /* The bank was emptied upstream: reload the tool so a screen that is already
       open stops showing rows that no longer exist. */
    const vm = window.VocabularyMaster;
    if (vm && typeof vm.reload === 'function') { try { await vm.reload(); } catch (_) {} }
    return true;
  };

  let vocabularyHydrating = null;
  const hydrateVocabularyInBackground = rows => {
    if (vocabularyHydrating) return vocabularyHydrating;
    vocabularyHydrating = (async () => {
      try {
        await new Promise(r => setTimeout(r, 0)); /* let the first paint land */
        await putManyFast('vocabularyMaster', rows);
        const vm = window.VocabularyMaster;
        if (vm && typeof vm.reload === 'function') await vm.reload();
        return true;
      } catch (_) {
        return false; /* a failed hydrate leaves the sig unsaved, so it retries */
      } finally { vocabularyHydrating = null; }
    })();
    return vocabularyHydrating;
  };

  const applySeedIfEmpty = async () => {
    if (!window.AH_SEED || typeof dbGetAll !== 'function') return false;
    const qs = await dbGetAll('questions').catch(() => []);
    if ((qs || []).length) return false;
    const seed = window.AH_SEED;
    const ok = await applyDoc({
      subjects: seed.subjects || [],
      topics: seed.topics || [],
      questions: seed.questions || [],
      vocabulary: seed.vocabulary || [],
      vocabularyMaster: seed.vocabularyMaster || []
    });
    return ok;
  };

  const pull = async () => {
    if (ROLE !== 'public') return;
    if (!(await bootReady())) return;
    const localQs = await dbGetAll('questions').catch(() => []);
    if (!(localQs || []).length) await applySeedIfEmpty();
    let meta = null;
    try { meta = await apiFetch('/api/content/meta').then(r => r.ok ? r.json() : null).catch(() => null); } catch (_) { meta = null; }
    const local = appliedMeta();
    if (meta && Number(meta.v || 0) > 0 && Number(meta.v) === Number(local.v) && meta.sig && meta.sig === local.sig) return;
    let doc = null;
    try { doc = await apiFetch('/api/content').then(r => r.ok ? r.json() : null).catch(() => null); } catch (_) { doc = null; }
    if (!doc || Number(doc.v || 0) <= 0) { window.__ahCloudOffline = true; return; } /* অফলাইন → লোকাল-ক্যাশ চলুক */
    window.__ahCloudOffline = false;
    if (Number(doc.v) === Number(local.v) && doc.sig && doc.sig === local.sig) return;
    const ok = await applyDoc(doc);
    if (ok) saveApplied({ v: doc.v, at: doc.at, sig: doc.sig || (meta && meta.sig) || '', pulledAt: Date.now() });
    else if (!(await dbGetAll('questions').catch(() => []) || []).length) await applySeedIfEmpty();
    window.__ahCloudLastPull = { ok, v: doc && doc.v, at: doc && doc.at };
  };

  const start = async () => {
    if (!(await bootReady())) return;
    if (ROLE === 'control') {
      hookWrites();
      await publish();
      setInterval(() => { publish().catch(() => {}); }, 45000);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') schedulePublish();
      });
      return;
    }
    await pull();
    setInterval(() => { pull().catch(() => {}); }, 60000);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') pull().catch(() => {});
    });
  };

  window.AdmissionCloudContent = { publish, pull, role: ROLE, putManyFast };
  const kick = async () => {
    try { await start(); } catch (_) {}
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(kick, 100));
  else setTimeout(kick, 100);
})();
