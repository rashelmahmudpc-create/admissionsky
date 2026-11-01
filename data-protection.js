/* Admission Sky data protection layer.
 * This module is intentionally additive: it never clears storage, deletes records,
 * or replaces user-created content. Migration failures are surfaced for recovery.
 */
(function (global) {
  'use strict';

  const PROTECTION_VERSION = 2;
  const BACKUP_KEY = 'admissionHub:data-protection:snapshots:v2';
  const MAX_SNAPSHOTS = 8;
  const STORE_NAMES = ['appMeta','subjects','topics','questions','exams','examResults','mistakes','vocabulary','dailyStats','activityLogs','settings','notes','ADMISSION_PLANS','PLAN_DAYS'];

  function safeParse(value, fallback) {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' ? parsed : fallback;
    } catch (_) {
      return fallback;
    }
  }

  function readSnapshots() {
    let raw = null;
    try { raw = localStorage.getItem(BACKUP_KEY); } catch (_) { return []; }
    if (raw == null) return [];
    const parsed = safeParse(raw, null);
    if (!Array.isArray(parsed)) {
      try { localStorage.setItem(BACKUP_KEY + ':corrupt:' + Date.now(), raw); } catch (_) {}
      return [];
    }
    return parsed.filter(x => x && typeof x === 'object' && x.snapshotId);
  }

  function writeSnapshot(snapshot) {
    const snapshots = readSnapshots();
    snapshots.push(snapshot);
    try {
      localStorage.setItem(BACKUP_KEY, JSON.stringify(snapshots.slice(-MAX_SNAPSHOTS)));
      localStorage.setItem('admissionHub:data-protection:last-snapshot', String(snapshot.snapshotId));
    } catch (error) {
      console.warn('[Admission Sky] Could not persist protection snapshot.', error);
    }
    return snapshot;
  }

  function requestToPromise(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('IndexedDB request failed'));
    });
  }

  async function summarizeDatabase(db) {
    const summary = { stores: {}, totalRecords: 0 };
    const names = Array.from(db.objectStoreNames);
    for (const name of names) {
      try {
        const tx = db.transaction(name, 'readonly');
        const count = await requestToPromise(tx.objectStore(name).count());
        summary.stores[name] = Number(count) || 0;
        summary.totalRecords += Number(count) || 0;
      } catch (error) {
        summary.stores[name] = { unreadable: true, error: String(error?.message || error) };
      }
    }
    return summary;
  }

  function recordIssues(storeName, record) {
    const issues = [];
    if (!record || typeof record !== 'object' || Array.isArray(record)) {
      issues.push('record is not an object');
      return issues;
    }
    if (record.id === undefined || record.id === null || String(record.id).trim() === '') issues.push('missing id');
    if (storeName === 'subjects' && !String(record.name || '').trim()) issues.push('missing subject name');
    if (storeName === 'topics' && (!String(record.name || '').trim() || !record.subjectId)) issues.push('missing topic identity');
    if (storeName === 'questions') {
      if (!String(record.question || '').trim()) issues.push('missing question text');
      if (!Array.isArray(record.options) || record.options.length < 2) issues.push('invalid options');
      const answer = record.answerIndex ?? record.answer;
      if (answer !== undefined && (!Number.isInteger(Number(answer)) || Number(answer) < 0)) issues.push('invalid answer index');
    }
    if (storeName === 'settings' && String(record.id) !== 'main') issues.push('unexpected settings identity');
    return issues;
  }

  async function auditDatabase(db) {
    const audit = { stores: {}, totalRecords: 0, corruptRecords: [] };
    for (const name of Array.from(db.objectStoreNames)) {
      const result = { count: 0, corrupt: [] };
      await new Promise((resolve, reject) => {
        let tx;
        try { tx = db.transaction(name, 'readonly'); } catch (error) { reject(error); return; }
        const request = tx.objectStore(name).openCursor();
        request.onsuccess = event => {
          const cursor = event.target.result;
          if (!cursor) { resolve(); return; }
          result.count += 1;
          const issues = recordIssues(name, cursor.value);
          if (issues.length && result.corrupt.length < 50) result.corrupt.push({ key: cursor.key, issues });
          cursor.continue();
        };
        request.onerror = () => reject(request.error || new Error('IndexedDB audit failed'));
        tx.onerror = () => reject(tx.error || new Error('IndexedDB audit transaction failed'));
      });
      audit.stores[name] = result;
      audit.totalRecords += result.count;
      result.corrupt.forEach(item => audit.corruptRecords.push({ store: name, ...item }));
    }
    return audit;
  }

  async function openForSummary(dbName) {
    if (!global.indexedDB) return null;
    return new Promise((resolve) => {
      let req;
      try { req = global.indexedDB.open(dbName); } catch (_) { resolve(null); return; }
      req.onsuccess = async () => {
        const db = req.result;
        try { resolve({ version: db.version, summary: await summarizeDatabase(db) }); }
        catch (_) { resolve({ version: db.version, summary: null }); }
        finally { db.close(); }
      };
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    });
  }

  async function snapshot(dbName, reason, extra) {
    const dbInfo = await openForSummary(dbName);
    const snapshot = {
      protectionVersion: PROTECTION_VERSION,
      snapshotId: 'snap-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8),
      createdAt: new Date().toISOString(),
      reason: String(reason || 'boot'),
      dbName,
      dbVersion: dbInfo?.version || 0,
      summary: dbInfo?.summary || { stores: {}, totalRecords: 0, unavailable: true },
      localStorageKeys: storageKeys().filter(k => k !== BACKUP_KEY).sort(),
      extra: extra && typeof extra === 'object' ? extra : undefined
    };
    return writeSnapshot(snapshot);
  }

  function storageKeys() {
    try { return Object.keys(localStorage); } catch (_) { return []; }
  }

  function localStorageHealth() {
    const bad = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (!key) continue;
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const looksJson = /^[\[{]/.test(raw.trim());
      if (looksJson && safeParse(raw, null) === null) bad.push(key);
    }
    return { ok: bad.length === 0, corruptedKeys: bad };
  }

  function validateImport(payload, options) {
    const opts = options || {};
    const source = Array.isArray(payload) ? payload : (payload && Array.isArray(payload.records) ? payload.records : null);
    if (!source) return { valid: false, records: [], rejected: [{ reason: 'Import must contain an array of records.' }] };
    const keyOf = typeof opts.keyOf === 'function' ? opts.keyOf : (record => record && (record.id || record.question || record.word || record.name));
    const seen = new Set();
    const records = [];
    const rejected = [];
    source.forEach((record, index) => {
      if (!record || typeof record !== 'object' || Array.isArray(record)) {
        rejected.push({ index, reason: 'Record is not an object.' });
        return;
      }
      const key = String(keyOf(record) || '').trim().toLowerCase();
      if (!key) {
        rejected.push({ index, reason: 'Record has no stable identity.' });
        return;
      }
      if (seen.has(key)) {
        rejected.push({ index, reason: 'Duplicate record in import.' });
        return;
      }
      seen.add(key);
      records.push(record);
    });
    return { valid: rejected.length === 0, records, rejected, duplicateCount: rejected.filter(x => /Duplicate/.test(x.reason)).length };
  }

  function dedupeRecords(records, keyOf) {
    const seen = new Set();
    return (Array.isArray(records) ? records : []).filter(record => {
      const key = String((keyOf || (x => x && (x.id || x.question || x.word || x.name)))(record) || '').trim().toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  /* Startup must never wait for a full IndexedDB scan. The latest metadata-only
     snapshot is enough to decide whether a post-migration audit is useful; a fresh
     snapshot is scheduled after the first usable paint instead. */
  async function prepareOpen(dbName, targetVersion) {
    const before = readSnapshots().slice().reverse().find(item => item.dbName === dbName) || null;
    return { before, targetVersion, deferred: true };
  }

  async function verifyMigration(db, beforeSnapshot) {
    const after = await summarizeDatabase(db);
    const beforeStores = beforeSnapshot?.summary?.stores || {};
    const losses = [];
    Object.keys(beforeStores).forEach(name => {
      const beforeCount = Number(beforeStores[name]);
      const afterCount = Number(after.stores[name]);
      if (Number.isFinite(beforeCount) && Number.isFinite(afterCount) && afterCount < beforeCount) losses.push({ store: name, before: beforeCount, after: afterCount });
    });
    const beforeVersion = Number(beforeSnapshot?.dbVersion || 0);
    let audit = { skipped: true, reason: 'no schema version change' };
    if (beforeVersion > 0 && Number(db.version) > beforeVersion) {
      try { audit = await auditDatabase(db); }
      catch (error) { audit = { skipped: false, failed: true, error: String(error?.message || error) }; }
    }
    const warnings = { losses, corruptRecords: audit.corruptRecords || [], auditFailure: audit.failed ? audit.error : null };
    if (losses.length || warnings.corruptRecords.length || warnings.auditFailure) {
      console.error('[Admission Sky] Migration verification detected a possible safety issue. No automatic data repair was attempted.', warnings);
      await snapshot(db.name, 'migration-safety-warning', { warnings, after, dbVersion: db.version });
    } else {
      await snapshot(db.name, 'after-open-or-migration', { after, dbVersion: db.version, audit });
    }
    return { ok: !losses.length && !warnings.corruptRecords.length && !warnings.auditFailure, losses, after, audit };
  }

  global.AdmissionDataProtection = {
    version: PROTECTION_VERSION,
    storeNames: STORE_NAMES.slice(),
    snapshot,
    prepareOpen,
    summarizeDatabase,
    auditDatabase,
    verifyMigration,
    validateImport,
    dedupeRecords,
    localStorageHealth,
    getSnapshots: readSnapshots
  };

  /* Protection telemetry is deliberately idle work: on iPhone, counting every
     object store during boot delayed the dashboard and could hold the splash for
     several seconds. This remains read-only and never clears or rewrites app data. */
  let bootSnapshotScheduled = false;
  function scheduleBootSnapshot() {
    if (bootSnapshotScheduled) return;
    bootSnapshotScheduled = true;
    const run = () => snapshot('admissionHubPublicDB', 'boot-idle')
      .catch(error => console.warn('[Admission Sky] Boot snapshot skipped.', error));
    if (typeof global.requestIdleCallback === 'function') global.requestIdleCallback(run, { timeout: 12000 });
    else global.setTimeout(run, 8000);
  }
  global.addEventListener('admission:boot-ready', scheduleBootSnapshot, { once: true });
})(window);
