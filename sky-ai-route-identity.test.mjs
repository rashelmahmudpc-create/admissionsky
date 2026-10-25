import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { SKY_AI_IDENTITY_ROUTES, SKY_AI_BODY_IDENTITY_ROUTES, forwardWithIdentity, forwardWithIdentityBody } from './sky-ai-route.mjs';

const U = 'https://admission-gk.example/api/ai/prefs';
const R = ['GET /api/ai/prefs'];
const kv = (d) => ({ get: async (k) => (k in d ? d[k] : null) });
const postRecall = (body, extra = {}) => new Request('https://admission-gk.example/api/ai/recall', {
  method: 'POST',
  headers: { 'content-type': 'application/json', ...extra },
  body: JSON.stringify(body)
});

test('the GET allowlist is exactly what has been moved, nothing more', () => {
  assert.deepEqual([...SKY_AI_IDENTITY_ROUTES], [
    'GET /api/ai/prefs',
    'GET /api/ai/actions/audit',
    'GET /api/ai/sky-flags',
    'GET /api/ai/instructions'
  ]);
});

/* F0.2 / DV-02: the route only works when admission-gk answers it. sky-ai has
 * served GET /api/ai/sky-flags since F0.2, but with no handler here the public
 * URL answered 404 (verified live 2026-10-24). This pins the wiring. */
test('admission-gk answers GET /api/ai/sky-flags and forwards it with the uid', async () => {
  const src = await readFile(new URL('./public-worker.js', import.meta.url), 'utf8');
  assert.match(src, /path === '\/api\/ai\/sky-flags' && request\.method === 'GET'/);
  let seen = null;
  const env = { PUB_KV: kv({ 'secret:sky-internal': 'K' }), SKY_AI: { fetch: async (r) => { seen = r; return new Response('{"ok":true}'); } } };
  const res = await forwardWithIdentity(new Request('https://admission-gk.example/api/ai/sky-flags', { headers: { 'x-sky-uid': 'evil' } }), env, 'account-1');
  assert.equal(res.status, 200);
  assert.equal(seen.headers.get('x-sky-uid'), 'account-1');
  assert.equal(seen.headers.get('x-sky-ai-caller'), 'admission-gk');
});

test('forwards uid + internal key when listed and key exists', async () => {
  let seen = null;
  const env = { PUB_KV: kv({ 'secret:sky-internal': 'K' }), SKY_AI: { fetch: async (r) => { seen = r; return new Response('{"prefs":{}}'); } } };
  const res = await forwardWithIdentity(new Request(U, { headers: { 'x-sky-uid': 'evil' } }), env, 'account-1', R);
  assert.equal(res.status, 200);
  assert.equal(seen.headers.get('x-sky-uid'), 'account-1');
  assert.equal(seen.headers.get('x-sky-internal'), 'K');
  assert.equal(seen.headers.get('x-sky-ai-caller'), 'admission-gk');
});

test('falls back (null) when unlisted, no key, no uid, POST, or sky-ai fails', async () => {
  const ok = { fetch: async () => new Response('x') };
  const withKey = { PUB_KV: kv({ 'secret:sky-internal': 'K' }), SKY_AI: ok };
  assert.equal(await forwardWithIdentity(new Request(U), withKey, 'u', []), null);
  assert.equal(await forwardWithIdentity(new Request(U), { PUB_KV: kv({}), SKY_AI: ok }, 'u', R), null);
  assert.equal(await forwardWithIdentity(new Request(U), withKey, '', R), null);
  assert.equal(await forwardWithIdentity(new Request(U, { method: 'POST', body: '{}' }), withKey, 'u', ['POST /api/ai/prefs']), null);
  for (const f of [async () => new Response('', { status: 404 }), async () => new Response('', { status: 500 }), async () => { throw new Error('x'); }]) {
    assert.equal(await forwardWithIdentity(new Request(U), { PUB_KV: kv({ 'secret:sky-internal': 'K' }), SKY_AI: { fetch: f } }, 'u', R), null);
  }
});

/* ── F0.1 step 4d: the first identity route that carries a body ──────────── */

test('POST recall forwards the uid, the key and the body', async () => {
  let seen = null;
  const env = {
    PUB_KV: kv({ 'secret:sky-internal': 'K' }),
    SKY_AI: { fetch: async (r) => { seen = r; return new Response('{"ok":true}', { headers: { 'x-sky-ai-route': 'recall' } }); } }
  };
  const res = await forwardWithIdentityBody(postRecall({ stats: { a: 1 } }), env, 'account-1');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('x-sky-ai-route'), 'recall');
  assert.equal(seen.method, 'POST');
  assert.equal(seen.headers.get('x-sky-uid'), 'account-1');
  assert.equal(seen.headers.get('x-sky-internal'), 'K');
  assert.equal(seen.headers.get('x-sky-ai-caller'), 'admission-gk');
  assert.deepEqual(await seen.json(), { stats: { a: 1 } }, 'the body arrived');
});

/* The original request is cloned before the body is consumed. Without that, a
 * failed forward leaves the caller with a used-up body and the local handler
 * answers as if the client sent nothing — a wrong answer, not an error. */
test('the fallback can still read the body after a failed forward', async () => {
  const env = {
    PUB_KV: kv({ 'secret:sky-internal': 'K' }),
    SKY_AI: { fetch: async () => new Response('', { status: 500 }) }
  };
  const request = postRecall({ stats: { b: 2 } });
  assert.equal(await forwardWithIdentityBody(request, env, 'account-1'), null);
  assert.deepEqual(await request.json(), { stats: { b: 2 } }, 'the local handler still gets its body');
});

test('a client cannot smuggle its own identity or key through the hop', async () => {
  let seen = null;
  const env = {
    PUB_KV: kv({ 'secret:sky-internal': 'K' }),
    SKY_AI: { fetch: async (r) => { seen = r; return new Response('{}'); } }
  };
  await forwardWithIdentityBody(postRecall({}, { 'x-sky-uid': 'account-evil', 'x-sky-internal': 'made-up' }), env, 'account-1');
  assert.equal(seen.headers.get('x-sky-uid'), 'account-1', 'the verified uid wins');
  assert.equal(seen.headers.get('x-sky-internal'), 'K', 'and so does the real key');
});

test('POST forwarding refuses what it should: no uid, no key, unlisted, GET, or transport failure', async () => {
  const ok = { fetch: async () => new Response('{}') };
  const withKey = { PUB_KV: kv({ 'secret:sky-internal': 'K' }), SKY_AI: ok };
  assert.equal(await forwardWithIdentityBody(postRecall({}), withKey, ''), null);
  assert.equal(await forwardWithIdentityBody(postRecall({}), { PUB_KV: kv({}), SKY_AI: ok }, 'account-1'), null);
  assert.equal(await forwardWithIdentityBody(postRecall({}), withKey, 'account-1', []), null);
  assert.equal(await forwardWithIdentityBody(new Request('https://x/api/ai/recall', { headers: { 'x-sky-ai-caller': 'admission-gk' } }), withKey, 'account-1'), null);
  for (const f of [async () => new Response('', { status: 404 }), async () => { throw new Error('down'); }]) {
    assert.equal(await forwardWithIdentityBody(postRecall({}), { PUB_KV: kv({ 'secret:sky-internal': 'K' }), SKY_AI: { fetch: f } }, 'account-1'), null);
  }
});

test('admission-gk answers recall itself when the forward returns null', async () => {
  const src = await readFile(new URL('./public-worker.js', import.meta.url), 'utf8');
  assert.match(src, /path === '\/api\/ai\/recall' && request\.method === 'POST'/);
  assert.match(src, /const viaSky = await forwardWithIdentityBody\(request, env, identity\.uid\);/);
  // The identity decisions stay on this side of the hop.
  assert.match(src, /if \(!identity\.authenticated\) return json\(\{ error: 'sign_in_required', recall: null \}, 401\);/);
  // And the local handler is still reachable after the forward: the fallback
  // is the code that runs today, so the move can never be worse than doing
  // nothing.
  assert.match(src, /if \(viaSky\) return viaSky;\n\s+const body = await request\.json\(\)\.catch\(\(\) => null\);\n\s+return await agentRecall\(env, identity\.uid, body\);/);
});

test('the non-GET allowlist names every method it allows, so rollback is one line', () => {
  assert.deepEqual([...SKY_AI_BODY_IDENTITY_ROUTES], [
    'POST /api/ai/recall',
    'POST /api/ai/instructions',
    'DELETE /api/ai/instructions',
    'POST /api/ai/memory/clear',
    'POST /api/ai/actions/propose',
    'POST /api/ai/actions/confirm'
  ]);
});
