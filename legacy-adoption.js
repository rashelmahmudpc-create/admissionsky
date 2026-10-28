/* Pre-account (legacy) record adoption.
 *
 * Before per-account scoping, IndexedDB records were stored with a bare id and
 * no `__ahOwner`. `fromScopedRecord()` hides any row it does not own, so a
 * signing-in account saw an empty app and re-seeded defaults, the "my data is
 * gone" report. Owner approved a one-time adoption.
 *
 * The rules this module enforces (pure logic, dependencies injected):
 *   1. Relabel in place. A legacy row is rewritten to `${scope}::${id}` with
 *      `__ahOwner`/`__ahId`, never copied, never deleted, so nothing is lost
 *      and the total row count per store is unchanged.
 *   2. Never overwrite account data. If the account already has a row with the
 *      same bare id, the legacy row is left untouched.
 *   3. Never cross accounts. Only rows with no owner at all are eligible; a row
 *      owned by another account is invisible and untouched.
 *   4. Idempotent. A per-account flag makes this run at most once per device.
 *
 * The caller supplies `scanStore(store)` and `writeStore(store, ops)` so the
 * real app can pass IndexedDB while tests pass in-memory doubles.
 */
(function (global) {
  'use strict';

  const FLAG_PREFIX = 'ahLegacyAdopt:v1:';
  const isLegacy = row => Boolean(row) && typeof row === 'object' && row.__ahOwner === undefined;

  /* Which unscoped rows in one store should be relabelled to `scope`. */
  function planStore(rows, scope) {
    const list = Array.isArray(rows) ? rows : [];
    const ownedBareIds = new Set();
    for (const row of list) {
      if (row && row.__ahOwner === scope) {
        ownedBareIds.add(String(row.__ahId !== undefined && row.__ahId !== null ? row.__ahId : row.id));
      }
    }
    const ops = [];
    let skipped = 0;
    for (const row of list) {
      if (!isLegacy(row)) continue;
      const bareId = String(row.id);
      /* A bare id that already carries this scope's prefix is this account's. */
      if (bareId.indexOf(scope + '::') === 0) { skipped += 1; continue; }
      if (ownedBareIds.has(bareId)) { skipped += 1; continue; }
      ops.push({
        from: bareId,
        to: scope + '::' + bareId,
        doc: Object.assign({}, row, { id: scope + '::' + bareId, __ahOwner: scope, __ahId: bareId })
      });
    }
    return { ops, skipped };
  }

  function readFlag(flagStore, scope) {
    try {
      const parsed = flagStore && flagStore.read ? flagStore.read(FLAG_PREFIX + scope) : null;
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch { return {}; }
  }

  function writeFlag(flagStore, scope, value) {
    try { if (flagStore && flagStore.write) flagStore.write(FLAG_PREFIX + scope, value); } catch { /* non-fatal */ }
  }

  /* Returns a report; never throws for a single failed store. */
  async function migrate(deps) {
    const {
      scope, stores, scanStore, writeStore,
      flagStore, snapshot,
      onAdopted,
      log = () => {},
      warn = () => {}
    } = deps || {};

    if (!scope || !Array.isArray(stores) || !stores.length) {
      return { skipped: true, reason: 'no-scope' };
    }
    if (readFlag(flagStore, scope).done) return { skipped: true, reason: 'already-done' };

    /* A pre-adoption snapshot so a bad run can be undone from the backup. */
    if (typeof snapshot === 'function') {
      try { await snapshot(); } catch (error) { warn('snapshot failed', error); }
    }

    let adopted = 0;
    let skippedRows = 0;
    const perStore = {};
    const failed = [];
    for (const store of stores) {
      let rows = [];
      try { rows = await scanStore(store); } catch (error) { warn('scan failed', store, error); failed.push(store); continue; }
      const { ops, skipped } = planStore(rows, scope);
      skippedRows += skipped;
      if (!ops.length) continue;
      try {
        await writeStore(store, ops);
        perStore[store] = ops.length;
        adopted += ops.length;
        /* Let the app mirror the adopted rows to the cloud; a local-only
         * rescue would be lost on the next device. */
        if (typeof onAdopted === 'function') {
          try { onAdopted(store, ops); } catch (error) { warn('onAdopted failed', store, error); }
        }
      } catch (error) {
        /* Leave the store untouched rather than half-migrating it. */
        warn('adopt failed; store left unchanged', store, error);
        failed.push(store);
      }
    }

    /* Mark done only when every store was handled, so a transient failure is
     * retried on the next sign-in instead of being silently abandoned. A re-run
     * is safe: already-adopted rows are scoped and therefore no longer eligible. */
    const done = failed.length === 0;
    writeFlag(flagStore, scope, { done, at: Date.now(), adopted, skipped: skippedRows, perStore, failed });
    if (adopted) log('adopted', adopted, 'pre-account records');
    return { adopted, skipped: skippedRows, perStore, failed, done };
  }

  global.AHLegacyAdoption = {
    FLAG_PREFIX,
    isLegacy,
    planStore,
    migrate
  };
})(typeof window !== 'undefined' ? window : globalThis);
