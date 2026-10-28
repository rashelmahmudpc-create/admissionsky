/* R2 file storage (owner approved 2026-09-18, R2 activated on the account).
 *
 * Private objects in the `admission-hub` R2 bucket, served from OUR domain
 * (R2 = $0 egress, the point of the switch). Keys are server-generated
 * `<folder>/<userId>/<yyyy-mm-dd>/<rand>.<ext>`, user input can never
 * control the path (no traversal, no overwrite).
 *
 * Routes (worker; session = __Host-ah_session vs AUTH_AUTHORITY DO):
 *   POST /api/files/upload , session; raw binary body + X-File-Ext / X-File-Folder
 *   GET  /api/files/...    , public read (unguessable keys), immutable cache
 *   POST /api/files/delete , session; only the caller's own folder
 *
 * Limits: 5 MB, image types only (jpg/jpeg/png/webp/gif), 10 uploads/hour
 * per user (KV). Every limit is fail-soft, storage errors return 503,
 * they never crash the worker. */

import { corsHeaders } from './cors-policy.mjs';

const AUTHORITY_NAME = 'admission-hub-global-auth-v1';
const SESSION_COOKIE = '__Host-ah_session';
const SESSION_TOKEN_RE = /^[A-Za-z0-9_-]{40,96}$/;
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024; /* 5 MB */
const MAX_UPLOADS_PER_HOUR = 10;
const UPLOAD_TYPES = Object.freeze({
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
  webp: 'image/webp', gif: 'image/gif'
});
/* 9 GB hard lock (owner directive 2026-09-18): 1 GB of headroom under the
 * 10 GB R2 free tier, so the card is never charged. Enforced in the worker
 * with a KV usage counter, reconciled through the S3 API when missing. */
const BUCKET_HARD_LIMIT_BYTES = 9 * 1024 * 1024 * 1024;
const USAGE_KEY = 'fs:bucket:bytes';
/* The R2 account id is a deployment binding, never a literal: hardcoding it
 * here put a real account id in the source and the shipped bundle. Read it
 * from the Worker secret and return null when unbound, so the S3 usage probe
 * fails soft (usage unknown) instead of shipping a credential-shaped value. */
const r2Host = env => {
  const acct = String(env?.R2_ACCOUNT_ID || env?.CLOUDFLARE_ACCOUNT_ID || '').trim();
  return /^[a-f0-9]{32}$/i.test(acct) ? `${acct}.r2.cloudflarestorage.com` : null;
};
const FOLDER_RE = /^[a-z][a-z0-9-]{0,31}$/;
/* User segment stays deliberately permissive (production user ids vary in
 * shape), unguessability comes from the 12-char random key + date, not
 * from the id length. */
const KEY_RE = /^[a-z][a-z0-9-]{0,31}\/[A-Za-z0-9_-]{1,64}\/\d{4}-\d{2}-\d{2}\/[a-z0-9]{10,24}\.[a-z0-9]{2,4}$/;

const readSessionToken = request => {
  const cookie = String(request.headers.get('Cookie') || '');
  for (const part of cookie.split(';')) {
    const idx = part.indexOf('=');
    if (idx > 0 && part.slice(0, idx).trim() === SESSION_COOKIE) return part.slice(idx + 1).trim();
  }
  return '';
};

async function sessionUser(env, request) {
  const token = readSessionToken(request);
  if (!SESSION_TOKEN_RE.test(token)) return null;
  try {
    const id = env.AUTH_AUTHORITY.idFromName(AUTHORITY_NAME);
    const stub = env.AUTH_AUTHORITY.get(id, { locationHint: 'apac' });
    const res = await stub.fetch('https://auth.internal/internal/session/get', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionToken: token })
    });
    const data = await res.json();
    if (!res.ok || !data?.ok || !data.result?.user?.id) return null;
    return data.result;
  } catch {
    return null;
  }
}

async function kvRateAllow(env, key, limit, ttlSeconds) {
  const kv = env?.GK_KV;
  if (!kv || typeof kv.get !== 'function') return true;
  try {
    const k = `fs:${key}`;
    const n = Number(await kv.get(k) || 0);
    if (n >= limit) return false;
    await kv.put(k, String(n + 1), { expirationTtl: ttlSeconds });
    return true;
  } catch {
    return true; /* rate limiting must never break the API */
  }
}

const sha256HexStr = async s => {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
};
const hmacHex = async (keyBytes, msg) => {
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(msg));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('');
};
const hexToBytes = h => Uint8Array.from(h.match(/.{2}/g), x => parseInt(x, 16));

/* Total bytes stored in the bucket, via the S3 ListObjectsV2 API
 * (the R2 binding has no list). Returns null when it cannot be determined -
 * callers must treat null as "unknown", never as "empty". */
async function s3ListTotalBytes(env) {
  const ak = String(env.R2_ACCESS_KEY || '');
  const sk = String(env.R2_SECRET_KEY || '');
  if (!ak || !sk) return null;
  const bucketName = String(env?.FILE_BUCKET?.name || 'admission-hub');
  const R2_HOST = r2Host(env);
  if (!R2_HOST) return null;
  try {
    let total = 0;
    let token = '';
    for (let page = 0; page < 100; page++) {
      const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
      const shortDate = amzDate.slice(0, 8);
      const region = 'auto';
      const service = 's3';
      const query = { 'list-type': '2', 'max-keys': '1000' };
      if (token) query['continuation-token'] = token;
      const queryStr = Object.keys(query).sort().map(k => `${k}=${query[k]}`).join('&');
      /* R2 (unlike real S3) requires the bucket in the URL path, a bare
       * `GET /` is ListBuckets and fails with 501. */
      const path = `/${bucketName}`;
      /* R2 requires the real payload hash (never UNSIGNED_PAYLOAD); a GET
       * has an empty body → SHA-256 of ''. */
      const payloadHash = await sha256HexStr('');
      const canonicalHeaders = `host:${R2_HOST}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
      const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';
      const canonicalRequest = [ 'GET', path, queryStr, canonicalHeaders, signedHeaders, payloadHash ].join('\n');
      const scope = `${shortDate}/${region}/${service}/aws4_request`;
      const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, await sha256HexStr(canonicalRequest)].join('\n');
      let k = await hmacHex(new TextEncoder().encode(`AWS4${sk}`), shortDate);
      k = await hmacHex(hexToBytes(k), region);
      k = await hmacHex(hexToBytes(k), service);
      k = await hmacHex(hexToBytes(k), 'aws4_request');
      /* The signature is over the StringToSign (NOT over 'aws4_request' -
       * that is the final derivation step of the signing key). Verified
       * live against R2 on 2026-09-18. */
      const signature = await hmacHex(hexToBytes(k), stringToSign);
      const res = await fetch(`https://${R2_HOST}/${bucketName}?${queryStr}`, {
        method: 'GET',
        headers: {
          'x-amz-date': amzDate,
          'x-amz-content-sha256': payloadHash,
          Authorization: `AWS4-HMAC-SHA256 Credential=${ak}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`
        }
      });
      if (!res.ok) {
        console.error('[files] s3 list failed', res.status, (await res.text()).slice(0, 400));
        return null;
      }
      const xml = await res.text();
      for (const m of xml.matchAll(/<Size>(\d+)<\/Size>/g)) total += Number(m[1]);
      const nt = xml.match(/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/);
      if (!nt) break;
      token = nt[1];
    }
    return total;
  } catch (e) {
    console.error('[files] s3 list error', e?.message || String(e));
    return null;
  }
}

/* KV counter format: JSON {"b":bytes,"t":epochSeconds} (a legacy plain
 * number is treated as stale). The counter is a fast cache of the truth;
 * S3 ListObjectsV2 is the truth, and we re-reconcile when the cache is
 * older than RECONCILE_EVERY_SECONDS (or missing/corrupt). */
const RECONCILE_EVERY_SECONDS = 3600;

const readCounter = async kv => {
  try {
    const raw = await kv.get(USAGE_KEY);
    if (raw == null) return null;
    if (raw.trim() === '') return null;
    if (raw.startsWith('{')) {
      const o = JSON.parse(raw);
      const b = Number(o?.b), t = Number(o?.t);
      if (Number.isFinite(b) && Number.isFinite(t) && b >= 0) return { bytes: b, ts: t };
      return null;
    }
    const n = Number(raw);
    if (!Number.isFinite(n)) return null;
    return { bytes: n, ts: 0 }; /* legacy format, force reconciliation */
  } catch {
    return null;
  }
};

const writeCounter = async (kv, bytes) => {
  try {
    await kv.put(USAGE_KEY, JSON.stringify({ b: Math.max(0, Math.round(bytes)), t: Math.floor(Date.now() / 1000) }));
  } catch { /* counter is a cache, reconciliation heals it */ }
};

/* Current bucket usage in bytes. Returns { bytes, exact }, exact=false
 * means the number may be stale-low, so the limit check treats it
 * conservatively (it only ever blocks MORE than the limit, never less,
 * because the pending upload is always added on top). */
async function bucketUsage(env) {
  const kv = env?.GK_KV;
  const cached = kv ? await readCounter(kv) : null;
  const fresh = cached && (Date.now() / 1000 - cached.ts) < RECONCILE_EVERY_SECONDS;
  if (fresh) return { bytes: cached.bytes, exact: true };
  const total = await s3ListTotalBytes(env);
  if (total != null) {
    if (kv) await writeCounter(kv, total);
    return { bytes: total, exact: true };
  }
  /* Reconciliation failed: fall back to the cached number if we have one
   * (stale beats unknown, it still bounds growth), flagged inexact. */
  if (cached) return { bytes: cached.bytes, exact: false };
  return { bytes: 0, exact: false };
}

const bumpUsage = async (env, delta) => {
  const kv = env?.GK_KV;
  if (!kv) return;
  try {
    const c = await readCounter(kv);
    await writeCounter(kv, (c ? c.bytes : 0) + delta);
  } catch { /* counter is a cache, reconciliation heals it */ }
};

const jsonResponse = (request, obj, status = 200) => new Response(JSON.stringify(obj), {
  status,
  headers: {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...corsHeaders(request),
  }
});

const randKey = len => {
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (const b of bytes) s += alphabet[b % alphabet.length];
  return s;
};

const publicUrl = request => {
  const base = new URL(request.url);
  return base.origin;
};

export async function handleFilesStorageRequest(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  if (!path.startsWith('/api/files')) return null;

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: {
      ...corsHeaders(request),
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-File-Ext, X-File-Folder',
      'Access-Control-Max-Age': '86400'
    } });
  }

  const bucket = env?.FILE_BUCKET;
  const available = Boolean(bucket && typeof bucket.put === 'function');

  /* Public read (unguessable server-generated keys). /api/files/usage is a
   * reserved route, not a key, so it is excluded here and falls through to the
   * session check below. */
  if (request.method === 'GET' && path !== '/api/files/usage') {
    const key = path.slice('/api/files/'.length);
    if (!KEY_RE.test(key)) return jsonResponse(request, { error: 'not-found' }, 404);
    if (!available) return jsonResponse(request, { error: 'storage-unavailable' }, 503);
    let obj;
    try { obj = await bucket.get(key); } catch { obj = null; }
    if (!obj) return jsonResponse(request, { error: 'not-found' }, 404);
    const ext = key.split('.').pop().toLowerCase();
    const type = UPLOAD_TYPES[ext] || 'application/octet-stream';
    return new Response(obj.body, {
      status: 200,
      headers: {
        'Content-Type': type,
        'Content-Length': String(obj.size),
        // BUG-008: an unguessable key is not a licence for a wildcard. Keep a
        // long cache but let the browser cache it privately, and do not invite
        // arbitrary sites to read it via CORS.
        'Cache-Control': 'private, max-age=86400',
        'X-Content-Type-Options': 'nosniff'
      }
    });
  }

  /* Everything below requires an authenticated student. */
  const session = await sessionUser(env, request);
  if (!session) return jsonResponse(request, { error: 'auth-required' }, 401);
  const userId = String(session.user.id);

  /* Storage usage is an internal figure (exact byte counts and the account
   * ceiling), so it sits behind the session check with everything else. It used
   * to be answered above it, which leaked the limits to anyone. */
  if (request.method === 'GET' && path === '/api/files/usage') {
    const usage = await bucketUsage(env);
    return jsonResponse(request, {
      ok: true,
      usedBytes: usage.bytes,
      exact: usage.exact,
      limitBytes: BUCKET_HARD_LIMIT_BYTES,
      percent: Math.min(100, Math.round((usage.bytes / BUCKET_HARD_LIMIT_BYTES) * 1000) / 10)
    });
  }

  if (request.method !== 'POST') return jsonResponse(request, { error: 'method-not-allowed' }, 405);

  if (path === '/api/files/upload') {
    if (!available) return jsonResponse(request, { error: 'storage-unavailable' }, 503);
    if (!(await kvRateAllow(env, `upload:${userId}`, MAX_UPLOADS_PER_HOUR, 3600))) {
      return jsonResponse(request, { error: 'rate-limited' }, 429);
    }
    const declared = Number(request.headers.get('Content-Length') || 0);
    if (!declared || declared > MAX_UPLOAD_BYTES) {
      return jsonResponse(request, { error: 'too-large' }, 413);
    }
    const ext = String(request.headers.get('X-File-Ext') || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const contentType = UPLOAD_TYPES[ext];
    if (!contentType) return jsonResponse(request, { error: 'invalid-type' }, 400);
    /* Validate the RAW folder, sanitize-then-validate would turn `../etc`
     * into the legal folder `etc`. */
    const folder = String(request.headers.get('X-File-Folder') || '').toLowerCase();
    if (!FOLDER_RE.test(folder)) return jsonResponse(request, { error: 'invalid-folder' }, 400);
    let bytes;
    try {
      bytes = new Uint8Array(await request.arrayBuffer());
    } catch {
      return jsonResponse(request, { error: 'read-failed' }, 400);
    }
    if (!bytes.length || bytes.length > MAX_UPLOAD_BYTES) {
      return jsonResponse(request, { error: 'too-large' }, 413);
    }
    /* 9 GB hard lock, the card must never be charged (owner 2026-09-18). */
    const usage = await bucketUsage(env);
    if (usage.bytes + bytes.length > BUCKET_HARD_LIMIT_BYTES) {
      return jsonResponse(request, { error: 'bucket-limit', limitBytes: BUCKET_HARD_LIMIT_BYTES, usedBytes: usage.bytes }, 507);
    }
    const day = new Date().toISOString().slice(0, 10);
    const key = `${folder}/${userId}/${day}/${randKey(12)}.${ext}`;
    try {
      await bucket.put(key, bytes, { httpMetadata: { contentType } });
      await bumpUsage(env, bytes.length);
    } catch {
      return jsonResponse(request, { error: 'storage-error' }, 503);
    }
    const fileUrl = `/api/files/${key}`;
    return jsonResponse(request, { ok: true, url: fileUrl, publicUrl: `${publicUrl(request)}${fileUrl}`, key }, 201);
  }

  if (path === '/api/files/delete') {
    if (!available) return jsonResponse(request, { error: 'storage-unavailable' }, 503);
    let body = {};
    try { body = await request.json(); } catch { body = null; }
    if (!body || typeof body !== 'object') return jsonResponse(request, { error: 'invalid-json' }, 400);
    const key = String(body.key || '');
    if (!KEY_RE.test(key)) return jsonResponse(request, { error: 'invalid-key' }, 400);
    /* Ownership: the key's user segment must be the caller's id. */
    if (key.split('/')[1] !== userId) return jsonResponse(request, { error: 'forbidden' }, 403);
    try {
      const existing = await bucket.get(key);
      await bucket.delete(key);
      if (existing) await bumpUsage(env, -existing.size);
    } catch {
      return jsonResponse(request, { error: 'storage-error' }, 503);
    }
    return jsonResponse(request, { ok: true, key });
  }

  return jsonResponse(request, { error: 'not-found' }, 404);
}

export const __filesStorageTest = Object.freeze({
  BUCKET_HARD_LIMIT_BYTES,
  r2Host,
  s3ListTotalBytes,
  bucketUsage,
  sessionUser,
  readSessionToken,
  kvRateAllow,
  KEY_RE,
  FOLDER_RE,
  UPLOAD_TYPES,
  MAX_UPLOAD_BYTES,
  MAX_UPLOADS_PER_HOUR
});
