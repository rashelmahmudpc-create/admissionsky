import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import worker from './gk-agent-worker.js';

test('wrangler.toml binds SKY_AI to the sky-ai Worker', () => {
  const toml = readFileSync(new URL('./wrangler.toml', import.meta.url), 'utf8');
  assert.match(toml, /\[\[services\]\]\s*\nbinding = "SKY_AI"\s*\nservice = "sky-ai"/);
});

test('/api/ai/sky-health is forwarded to SKY_AI with the caller header', async () => {
  let seen = null;
  const env = { SKY_AI: { fetch: async (req) => { seen = req; return new Response('{"ok":true,"service":"sky-ai"}'); } } };
  const res = await worker.fetch(new Request('https://admission-gk.example/api/ai/sky-health'), env, { waitUntil() {} });
  assert.equal(res.status, 200);
  assert.ok(seen, 'SKY_AI.fetch was called');
  assert.equal(seen.headers.get('x-sky-ai-caller'), 'admission-gk');
  assert.equal(new URL(seen.url).pathname, '/api/ai/sky-health');
});

test('identity routes fall back when no internal key is available', async () => {
  let called = false;
  const env = { SKY_AI: { fetch: async () => { called = true; return new Response('x'); } } };
  for (const p of ['/api/ai/status', '/api/ai/chat']) {
    try { await worker.fetch(new Request('https://admission-gk.example' + p), env, { waitUntil() {} }); } catch (_) {}
  }
  assert.equal(called, false);
});

/* F0.2 follow-up (2026-10-31): the bug this guards against was that SKY_AI was
 * missing from the envPub whitelist, so the public handler never saw the
 * binding and every identity route fell back locally — silently, because the
 * fallback answers 200. sky-health passed only because it is forwarded before
 * the whitelist. With PUB_KV holding the internal key, sky-flags must now reach
 * SKY_AI with the caller header and the verified uid. */
test('sky-flags reaches SKY_AI through the public handler (envPub carries SKY_AI)', async () => {
  let seen = null;
  const env = {
    SKY_AI: { fetch: async (r) => { seen = r; return new Response('{"ok":true,"service":"sky-ai"}', { headers: { 'content-type': 'application/json' } }); } },
    PUB_KV: { get: async (k) => (k === 'secret:sky-internal' ? 'K' : null), put: async () => {} }
  };
  const res = await worker.fetch(new Request('https://admission-gk.example/api/ai/sky-flags'), env, { waitUntil() {} });
  assert.equal(res.status, 200);
  assert.ok(seen, 'SKY_AI.fetch was called — SKY_AI must be in the envPub whitelist');
  assert.equal(seen.headers.get('x-sky-ai-caller'), 'admission-gk');
  assert.ok(seen.headers.get('x-sky-uid'), 'a verified uid is forwarded');
  assert.equal(new URL(seen.url).pathname, '/api/ai/sky-flags');
});
