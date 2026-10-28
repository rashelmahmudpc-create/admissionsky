/* R2 file storage contract (files-storage.mjs).
 * Stubs: R2 bucket (in-memory Map), AUTH_AUTHORITY (session DO), GK_KV (Map).
 * No network access. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { handleFilesStorageRequest, __filesStorageTest as T } from './files-storage.mjs';

const VALID_SESSION = `sess-${'b'.repeat(40)}`.slice(0, 64);
const USER_ID = 'user-files-1';

function makeFakeR2() {
  const objects = new Map(); // key → { bytes, contentType, size }
  return {
    _objects: objects,
    async put(key, value, opts) {
      objects.set(key, { bytes: new Uint8Array(value), contentType: opts?.httpMetadata?.contentType, size: value.length });
    },
    async get(key) {
      const o = objects.get(key);
      if (!o) return null;
      return { body: new Blob([o.bytes]), size: o.size, httpMetadata: { contentType: o.contentType } };
    },
    async delete(key) {
      objects.delete(key);
    }
  };
}

function makeAuthority(validTokens = new Set([VALID_SESSION])) {
  return {
    idFromName(name) { return name; },
    get() {
      return {
        async fetch(input, init) {
          const body = JSON.parse(init?.body || '{}');
          if (!validTokens.has(body.sessionToken)) {
            return Response.json({ ok: false, error: { code: 'SESSION_INVALID' } }, { status: 401 });
          }
          return Response.json({
            ok: true,
            result: { expiresAt: Date.now() + 3600_000, user: { id: USER_ID, emailMasked: 'a…e.com', status: 'active', createdAt: 1 } }
          });
        }
      };
    }
  };
}

function makeFakeKV() {
  const map = new Map();
  return {
    async get(k) { return map.has(k) ? map.get(k).v : null; },
    async put(k, v) { map.set(k, { v, t: Date.now() }); },
    async delete(k) { map.delete(k); }
  };
}

const makeEnv = (overrides = {}) => ({
  AUTH_AUTHORITY: makeAuthority(),
  FILE_BUCKET: makeFakeR2(),
  GK_KV: makeFakeKV(),
  ...overrides
});

const req = (path, { method = 'GET', session = VALID_SESSION, headers = {}, body } = {}) => {
  const h = { ...headers };
  if (session) h.Cookie = `__Host-ah_session=${session}`;
  return new Request(`https://admission-gk.admissionhub.workers.dev${path}`, { method, headers: h, body });
};

const call = async (request, env) => {
  const response = await handleFilesStorageRequest(request, env);
  assert.ok(response instanceof Response, 'expected a Response');
  const data = response.headers.get('Content-Type')?.includes('json') ? await response.json() : null;
  return { response, data };
};

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

test('non-files paths pass through (null)', async () => {
  const env = makeEnv();
  assert.equal(await handleFilesStorageRequest(req('/api/notifications/config'), env), null);
  assert.equal(await handleFilesStorageRequest(req('/api/ask'), env), null);
  assert.equal(await handleFilesStorageRequest(req('/'), env), null);
});

test('upload: no session → 401; valid session → 201 with our-domain URL', async () => {
  const env = makeEnv();
  const anon = await call(req('/api/files/upload', { method: 'POST', session: null, headers: { 'X-File-Ext': 'png', 'X-File-Folder': 'profile', 'Content-Length': '12' }, body: PNG_BYTES }), env);
  assert.equal(anon.response.status, 401);

  const out = await call(req('/api/files/upload', { method: 'POST', headers: { 'X-File-Ext': 'png', 'X-File-Folder': 'profile', 'Content-Length': '12' }, body: PNG_BYTES }), env);
  assert.equal(out.response.status, 201);
  assert.ok(out.data.url.startsWith('/api/files/profile/'));
  assert.match(out.data.key, /^profile\/user-files-1\/\d{4}-\d{2}-\d{2}\/[a-z0-9]{12}\.png$/);
  assert.equal(out.data.publicUrl, `https://admission-gk.admissionhub.workers.dev${out.data.url}`);
  const stored = env.FILE_BUCKET._objects.get(out.data.key);
  assert.ok(stored, 'object stored in the bucket');
  assert.equal(stored.contentType, 'image/png');
});

test('upload validation: type, folder, size', async () => {
  const env = makeEnv();
  const badType = await call(req('/api/files/upload', { method: 'POST', headers: { 'X-File-Ext': 'exe', 'X-File-Folder': 'profile', 'Content-Length': '12' }, body: PNG_BYTES }), env);
  assert.equal(badType.response.status, 400);
  assert.equal(badType.data.error, 'invalid-type');
  const badFolder = await call(req('/api/files/upload', { method: 'POST', headers: { 'X-File-Ext': 'png', 'X-File-Folder': '../etc', 'Content-Length': '12' }, body: PNG_BYTES }), env);
  assert.equal(badFolder.response.status, 400);
  assert.equal(badFolder.data.error, 'invalid-folder');
  const noLenReq = req('/api/files/upload', { method: 'POST', headers: { 'X-File-Ext': 'png', 'X-File-Folder': 'profile' }, body: PNG_BYTES });
  noLenReq.headers.delete('Content-Length'); /* undici sets it for sized bodies — strip to simulate a lying/absent length */
  const noLen = await call(noLenReq, env);
  assert.equal(noLen.response.status, 413, 'no declared size → rejected before reading the body');
  const big = new Request('https://x/api/files/upload', { method: 'POST', headers: { Cookie: `__Host-ah_session=${VALID_SESSION}`, 'X-File-Ext': 'png', 'X-File-Folder': 'profile', 'Content-Length': String(T.MAX_UPLOAD_BYTES + 1) } });
  const out = await call(big, env);
  assert.equal(out.response.status, 413);
  assert.equal(out.data.error, 'too-large');
  /* the bucket must be empty — nothing was stored */
  assert.equal(env.FILE_BUCKET._objects.size, 0);
});

test('upload rate limit: 10/hour per user → 429', async () => {
  const env = makeEnv();
  let last = null;
  for (let i = 0; i < 12; i++) {
    last = await call(req('/api/files/upload', { method: 'POST', headers: { 'X-File-Ext': 'png', 'X-File-Folder': 'profile', 'Content-Length': '12' }, body: PNG_BYTES }), env);
  }
  assert.equal(last.response.status, 429);
  assert.equal(last.data.error, 'rate-limited');
  assert.equal(env.FILE_BUCKET._objects.size, 10);
});

test('read: streams the stored object without wildcard CORS; missing → 404', async () => {
  const env = makeEnv();
  const up = await call(req('/api/files/upload', { method: 'POST', headers: { 'X-File-Ext': 'png', 'X-File-Folder': 'notif', 'Content-Length': '12' }, body: PNG_BYTES }), env);
  const stored = env.FILE_BUCKET._objects.get(up.data.key);
  const res = await handleFilesStorageRequest(req(up.data.url), env);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('Content-Type'), 'image/png');
  /* BUG-008: the public file read no longer advertises a wildcard origin or a
     year-long immutable cache -- a leaked key must not stay readable from any
     site forever. */
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), null);
  assert.match(res.headers.get('Cache-Control'), /private, max-age=86400/);
  const buf = new Uint8Array(await res.arrayBuffer());
  assert.deepEqual([...buf], [...stored.bytes]);
  const missing = await handleFilesStorageRequest(req('/api/files/notif/user-files-1/2026-09-18/aaaaaaaaaa.png'), env);
  assert.equal(missing.status, 404);
  const traversal = await handleFilesStorageRequest(req('/api/files/..%2f..%2fpasswd'), env);
  assert.equal(traversal.status, 404, 'KEY_RE rejects traversal/other shapes');
});

test('delete: own folder only', async () => {
  const env = makeEnv();
  const up = await call(req('/api/files/upload', { method: 'POST', headers: { 'X-File-Ext': 'png', 'X-File-Folder': 'profile', 'Content-Length': '12' }, body: PNG_BYTES }), env);
  /* another user's key for the same layout → 403 */
  const foreign = `profile/some-other-user-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/${new Date().toISOString().slice(0, 10)}/${up.data.key.split('/').pop()}`;
  const denied = await call(req('/api/files/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: foreign }) }), env);
  assert.equal(denied.response.status, 403);
  const badKey = await call(req('/api/files/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: 'profile/a/b' }) }), env);
  assert.equal(badKey.response.status, 400);
  const ok = await call(req('/api/files/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: up.data.key }) }), env);
  assert.equal(ok.response.status, 200);
  assert.equal(env.FILE_BUCKET._objects.size, 0);
  const gone = await handleFilesStorageRequest(req(up.data.url), env);
  assert.equal(gone.status, 404);
});

test('storage unavailable → 503, never a crash', async () => {
  const env = makeEnv({ FILE_BUCKET: null });
  const up = await call(req('/api/files/upload', { method: 'POST', headers: { 'X-File-Ext': 'png', 'X-File-Folder': 'profile', 'Content-Length': '12' }, body: PNG_BYTES }), env);
  assert.equal(up.response.status, 503);
  const read = await handleFilesStorageRequest(req('/api/files/profile/user-files-1/2026-09-18/aaaaaaaaaa.png'), env);
  assert.equal(read.status, 503);
  const del = await call(req('/api/files/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: 'profile/user-files-1/2026-09-18/aaaaaaaaaa.png' }) }), env);
  assert.equal(del.response.status, 503);
});


test('9 GB hard lock: bucket usage caps uploads (owner: card must never be charged)', async () => {
  const env = makeEnv();
  /* seed the counter just under the 9 GB limit (500 B of headroom) */
  await env.GK_KV.put('fs:bucket:bytes', String(T.BUCKET_HARD_LIMIT_BYTES - 500));
  const small = new Uint8Array(400);
  const okUp = await call(req('/api/files/upload', { method: 'POST', headers: { 'X-File-Ext': 'png', 'X-File-Folder': 'profile', 'Content-Length': '400' }, body: small }), env);
  assert.equal(okUp.response.status, 201, '400 B fits into the 500 B headroom');
  const over = await call(req('/api/files/upload', { method: 'POST', headers: { 'X-File-Ext': 'png', 'X-File-Folder': 'profile', 'Content-Length': '400' }, body: small }), env);
  assert.equal(over.response.status, 507, 'over the 9 GB lock → 507');
  assert.equal(over.data.error, 'bucket-limit');
  assert.equal(env.FILE_BUCKET._objects.size, 1, 'nothing stored past the lock');
  /* usage endpoint reports the lock state */
  const usage = await handleFilesStorageRequest(req('/api/files/usage'), env);
  assert.equal(usage.status, 200);
  const u = await usage.json();
  assert.equal(u.limitBytes, T.BUCKET_HARD_LIMIT_BYTES);
  assert.ok(u.usedBytes > T.BUCKET_HARD_LIMIT_BYTES - 2000);
  assert.ok(u.percent >= 99.9);
});

test('usage counter: delete subtracts the removed size (JSON format)', async () => {
  const env = makeEnv();
  const up = await call(req('/api/files/upload', { method: 'POST', headers: { 'X-File-Ext': 'png', 'X-File-Folder': 'profile', 'Content-Length': '12' }, body: PNG_BYTES }), env);
  const after = JSON.parse(await env.GK_KV.get('fs:bucket:bytes'));
  assert.equal(after.b, 12);
  assert.ok(after.t > 0, 'counter stores a reconciliation timestamp');
  await call(req('/api/files/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: up.data.key }) }), env);
  assert.equal((JSON.parse(await env.GK_KV.get('fs:bucket:bytes'))).b, 0, 'delete decrements the counter');
});

test('usage reconciliation: counter missing + S3 creds present → S3 list heals it', async () => {
  /* env without S3 secrets: counter missing → unknown (bytes 0, exact false) */
  const envNoCreds = makeEnv();
  const u1 = await T.bucketUsage(envNoCreds);
  assert.equal(u1.exact, false, 'no S3 creds → unknown, not falsely "empty"');
});

test('usage counter: fresh JSON short-circuits S3; legacy number falls back inexact', async () => {
  /* fresh counter (t = now) → served from KV even without S3 creds */
  const freshEnv = makeEnv();
  await freshEnv.GK_KV.put('fs:bucket:bytes', JSON.stringify({ b: 777, t: Math.floor(Date.now() / 1000) }));
  const fresh = await T.bucketUsage(freshEnv);
  assert.equal(fresh.bytes, 777);
  assert.equal(fresh.exact, true, 'fresh counter is trusted without re-listing');

  /* legacy plain number → stale → S3 attempted; no creds → cached bytes, inexact */
  const legacyEnv = makeEnv();
  await legacyEnv.GK_KV.put('fs:bucket:bytes', '4242');
  const legacy = await T.bucketUsage(legacyEnv);
  assert.equal(legacy.bytes, 4242, 'stale cache still bounds growth');
  assert.equal(legacy.exact, false, 'unreconciled number is flagged inexact');

  /* corrupt value → treated as missing */
  const corruptEnv = makeEnv();
  await corruptEnv.GK_KV.put('fs:bucket:bytes', '{oops');
  const corrupt = await T.bucketUsage(corruptEnv);
  assert.equal(corrupt.bytes, 0);
  assert.equal(corrupt.exact, false);
});

test('R2 account id is a binding, never a hardcoded literal', async () => {
  /* Regression guard: a real account id was committed in the source and the
   * bundle. The host must come from the Worker secret, and nothing at all when
   * the secret is absent. */
  assert.equal(T.r2Host({}), null, 'no binding → no host');
  assert.equal(T.r2Host({ R2_ACCOUNT_ID: 'not-hex' }), null, 'junk is rejected');
  const acct = 'a'.repeat(32);
  assert.equal(T.r2Host({ R2_ACCOUNT_ID: acct }), acct + '.r2.cloudflarestorage.com');
  assert.equal(T.r2Host({ CLOUDFLARE_ACCOUNT_ID: acct }), acct + '.r2.cloudflarestorage.com');
});

test('units: KEY_RE shape + KV prefix', async () => {
  assert.ok(T.KEY_RE.test('profile/user-files-1/2026-09-18/abcdefghijkl.png'));
  assert.ok(!T.KEY_RE.test('profile/user-files-1/2026-09-18/../../etc.png'));
  assert.ok(!T.KEY_RE.test('../profile/user-files-1/2026-09-18/abcdefghijkl.png'));
  assert.ok(!T.KEY_RE.test('PROFILE/user-files-1/2026-09-18/abcdefghijkl.png'));
  assert.ok(T.FOLDER_RE.test('notifs-2'));
  assert.ok(!T.FOLDER_RE.test('Notifs'));
  assert.ok(!T.FOLDER_RE.test(''));
});
