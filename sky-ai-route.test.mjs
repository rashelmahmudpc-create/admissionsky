import test from 'node:test';
import assert from 'node:assert/strict';
import { SKY_AI_ROUTES, shouldRouteToSkyAi, tryRouteToSkyAi } from './sky-ai-route.mjs';

const U = 'https://admission-gk.example';
const sky = (impl) => ({ SKY_AI: { fetch: impl } });

test('allowlist ships empty (zero student impact)', () => {
  assert.equal(SKY_AI_ROUTES.length, 0);
});

test('no binding or unlisted route -> not routed', async () => {
  const req = new Request(U + '/api/ai/status');
  assert.equal(shouldRouteToSkyAi(req, {}, ['GET /api/ai/status']), false);
  let called = false;
  const res = await tryRouteToSkyAi(req, sky(async () => { called = true; return new Response('x'); }));
  assert.equal(res, null);
  assert.equal(called, false);
});

test('listed route is forwarded with caller header, spoofed uid stripped', async () => {
  let seen = null;
  const req = new Request(U + '/api/ai/status', { headers: { 'x-sky-uid': 'evil' } });
  const res = await tryRouteToSkyAi(req, sky(async (r) => { seen = r; return new Response('{"ok":true}'); }), ['GET /api/ai/status']);
  assert.equal(res.status, 200);
  assert.equal(seen.headers.get('x-sky-ai-caller'), 'admission-gk');
  assert.equal(seen.headers.get('x-sky-uid'), null);
});

test('POST body is forwarded and the original stays readable', async () => {
  let body = null;
  const req = new Request(U + '/api/ai/prefs', { method: 'POST', body: '{"a":1}' });
  await tryRouteToSkyAi(req, sky(async (r) => { body = await r.text(); return new Response('ok'); }), ['POST /api/ai/prefs']);
  assert.equal(body, '{"a":1}');
  assert.equal(await req.text(), '{"a":1}');
});

test('sky-ai 404 / 5xx / throw -> fallback (null)', async () => {
  const routes = ['GET /api/ai/status'];
  for (const impl of [async () => new Response('', { status: 404 }), async () => new Response('', { status: 503 }), async () => { throw new Error('down'); }]) {
    assert.equal(await tryRouteToSkyAi(new Request(U + '/api/ai/status'), sky(impl), routes), null);
  }
});
