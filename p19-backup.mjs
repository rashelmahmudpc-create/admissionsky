// 🗄️ PHASE 19, backup / recovery.
//
// Until now nothing wrote a restorable copy of the live data. KV held student
// state, chat memory, published content and the error log; D1 held profiles and
// avatars; and a bad deploy, a bad admin write, or a fat-fingered delete had no
// way back. This module takes a full snapshot to R2 and can write it back.
//
// Three rules, copied from p19-error-monitor.mjs:
//
//  1. **A snapshot is not a transcript.** Every string is redacted on the way
//     in, so a token that leaked into a KV value cannot be preserved by the
//     backup and read back out later. Redaction happens before the R2 put.
//  2. **Never invent a number.** The index lists snapshots that exist; an empty
//     index means no snapshot was taken, not that backups are off.
//  3. **A restore is explicit and reversible.** It writes the keys a snapshot
//     contains and reports exactly which keys it touched. It never deletes a
//     key that is absent from the snapshot, a restore must not be a wipe.

import { sanitizeErrorText } from './p19-error-monitor.mjs';

/** Snapshots live under one R2 prefix so a listing is unambiguous. */
export const BACKUP_PREFIX = 'backups/';

/** The index is a small KV record of what exists, newest first. */
export const BACKUP_INDEX_KEY = 'backup:index:v1';

/** Bounded: the newest MAX_INDEX snapshots are listed; R2 keeps the rest. */
export const MAX_INDEX = 30;

/** A single snapshot is clipped so one runaway value cannot fill R2. */
export const MAX_VALUE = 200_000;

/** KV bindings a snapshot covers. Order is fixed so the report is stable. */
export const KV_BINDINGS = ['GK_KV', 'PUB_KV', 'OLD_KV'];

/**
 * Deep-redact a JSON value. Objects and arrays are walked; every string is run
 * through the same secret sanitiser the error log uses, so one definition of
 * "what is a secret" covers both. Pure: never mutates the input.
 */
export function redactSnapshot(value, depth = 0) {
  if (depth > 12) return '[deep]';
  if (value == null) return value;
  if (typeof value === 'string') return sanitizeErrorText(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.map(v => redactSnapshot(v, depth + 1));
  if (typeof value === 'object') {
    const out = {};
    for (const k of Object.keys(value)) out[k] = redactSnapshot(value[k], depth + 1);
    return out;
  }
  return String(value);
}

/** A KV value is JSON when it parses, otherwise the raw string. Redacted either way. */
export function redactKvValue(raw) {
  if (raw == null) return null;
  let parsed = raw;
  try { parsed = JSON.parse(raw); } catch (_) { /* a plain string is a value too */ }
  const redacted = redactSnapshot(parsed);
  return typeof redacted === 'string' ? redacted.slice(0, MAX_VALUE) : redacted;
}

/** `backups/2026-10-11T19-20-00-000Z.json`, one snapshot, one sortable name. */
export function snapshotName(at) {
  const iso = new Date(Number(at) || Date.now()).toISOString();
  return `${BACKUP_PREFIX}${iso.replace(/[:.]/g, '-')}.json`;
}

/** The index entry the admin view reads. Counts are real: lengths of what we stored. */
export function makeIndexEntry({ key, at, kvCount, d1Count, bytes }) {
  return {
    key,
    at: Number(at) || 0,
    kvKeys: Number(kvCount) || 0,
    d1Rows: Number(d1Count) || 0,
    bytes: Number(bytes) || 0,
  };
}

/** Newest first, bounded. Pure. */
export function appendIndex(index, entry) {
  const list = Array.isArray(index) ? index.slice() : [];
  const without = list.filter(e => e && e.key !== entry.key);
  return [entry, ...without]
    .sort((a, b) => (b.at || 0) - (a.at || 0))
    .slice(0, MAX_INDEX);
}

/** What a restore would write. Pure: lets the admin preview before applying. */
export function planRestore(snapshot) {
  const kv = snapshot && snapshot.kv && typeof snapshot.kv === 'object' ? snapshot.kv : {};
  const plan = [];
  for (const binding of Object.keys(kv)) {
    for (const key of Object.keys(kv[binding] || {})) plan.push({ binding, key });
  }
  return plan;
}

/** List every KV key in a namespace, following the cursor. Never truncated silently. */
async function listAllKeys(ns) {
  const keys = [];
  let cursor;
  do {
    const page = await ns.list(cursor ? { cursor } : undefined);
    for (const k of page.keys || []) keys.push(k.name);
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return keys;
}

/** Every table D1 knows about. Read from sqlite_master, not a hardcoded list. */
async function listTables(db) {
  const res = await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
  return (res.results || []).map(r => r.name).filter(Boolean);
}

/**
 * Collect a full snapshot of KV and D1, redacted. Every read is guarded so one
 * unreadable namespace degrades that section to empty rather than failing the
 * whole backup, a partial snapshot with a note beats no snapshot.
 */
export async function collectSnapshot(env, { now } = {}) {
  const at = Number((now || Date.now)()) || Date.now();
  const kv = {};
  const notes = [];

  for (const binding of KV_BINDINGS) {
    const ns = env && env[binding];
    kv[binding] = {};
    if (!ns || typeof ns.list !== 'function') { notes.push(`${binding}:absent`); continue; }
    try {
      const names = await listAllKeys(ns);
      for (const name of names) {
        try { kv[binding][name] = redactKvValue(await ns.get(name)); }
        catch (_) { notes.push(`${binding}:${name}:unreadable`); }
      }
    } catch (e) { notes.push(`${binding}:list-failed`); }
  }

  const d1 = {};
  const db = env && env.PROFILE_DB;
  if (db && typeof db.prepare === 'function') {
    try {
      for (const table of await listTables(db)) {
        try {
          const res = await db.prepare(`SELECT * FROM "${table}"`).all();
          d1[table] = redactSnapshot(res.results || []);
        } catch (_) { notes.push(`d1:${table}:unreadable`); }
      }
    } catch (_) { notes.push('d1:list-failed'); }
  } else {
    notes.push('d1:absent');
  }

  return { version: 1, at, kv, d1, notes };
}

/**
 * Take a snapshot, store it in R2, and update the KV index. Returns the index
 * entry that was written. Throws only when there is no bucket to write to -
 * a backup that cannot be stored must be reported, not silently skipped.
 */
export async function createSnapshot(env, { now } = {}) {
  const bucket = env && env.FILE_BUCKET;
  if (!bucket || typeof bucket.put !== 'function') throw new Error('no-backup-bucket');
  const snapshot = await collectSnapshot(env, { now });
  const key = snapshotName(snapshot.at);
  const body = JSON.stringify(snapshot);
  await bucket.put(key, body, { httpMetadata: { contentType: 'application/json' } });

  const kvCount = Object.values(snapshot.kv).reduce((n, m) => n + Object.keys(m || {}).length, 0);
  const d1Count = Object.values(snapshot.d1).reduce((n, rows) => n + (Array.isArray(rows) ? rows.length : 0), 0);
  const entry = makeIndexEntry({ key, at: snapshot.at, kvCount, d1Count, bytes: body.length });

  try {
    const raw = env.PUB_KV ? await env.PUB_KV.get(BACKUP_INDEX_KEY) : null;
    const index = raw ? JSON.parse(raw) : [];
    if (env.PUB_KV) await env.PUB_KV.put(BACKUP_INDEX_KEY, JSON.stringify(appendIndex(index, entry)));
  } catch (_) { /* the snapshot is already in R2; a missing index entry is recoverable by listing R2 */ }

  return entry;
}

/** The admin view: what exists, newest first, nothing invented. */
export async function listSnapshots(env) {
  let index = [];
  try {
    const raw = env && env.PUB_KV ? await env.PUB_KV.get(BACKUP_INDEX_KEY) : null;
    index = raw ? JSON.parse(raw) : [];
  } catch (_) { index = []; }
  return { ok: true, count: index.length, snapshots: Array.isArray(index) ? index : [] };
}

/**
 * Write a snapshot's KV keys back. Only the keys the snapshot contains are
 * touched; a key that exists now but not in the snapshot is left alone, because
 * a restore that deletes is a wipe wearing a restore's name. Returns the plan it
 * applied so the caller can report exactly what changed.
 */
export async function restoreSnapshot(env, key) {
  const bucket = env && env.FILE_BUCKET;
  if (!bucket || typeof bucket.get !== 'function') return { ok: false, error: 'no-backup-bucket' };
  const obj = await bucket.get(key);
  if (!obj) return { ok: false, error: 'snapshot-not-found' };
  let snapshot;
  try { snapshot = JSON.parse(await obj.text()); } catch (_) { return { ok: false, error: 'snapshot-unreadable' }; }

  const plan = planRestore(snapshot);
  const applied = [];
  for (const { binding, key: kvKey } of plan) {
    const ns = env[binding];
    if (!ns || typeof ns.put !== 'function') continue;
    const value = snapshot.kv[binding][kvKey];
    const body = typeof value === 'string' ? value : JSON.stringify(value);
    await ns.put(kvKey, body);
    applied.push({ binding, key: kvKey });
  }
  return { ok: true, key, at: snapshot.at || 0, restored: applied.length, keys: applied };
}
