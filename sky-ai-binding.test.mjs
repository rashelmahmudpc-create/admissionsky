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

test('other /api/ai routes never reach SKY_AI yet', async () => {
  let called = false;
  const env = { SKY_AI: { fetch: async () => { called = true; return new Response('x'); } } };
  for (const p of ['/api/ai/status', '/api/ai/chat']) {
    try { await worker.fetch(new Request('https://admission-gk.example' + p), env, { waitUntil() {} }); } catch (_) {}
  }
  assert.equal(called, false);
});
