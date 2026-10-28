import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { handle, SKY_AI_VERSION } from './worker.mjs';

test('health answers ok via direct call', async () => {
  const res = await worker.fetch(new Request('https://sky-ai.example/health'), {}, {});
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.service, 'sky-ai');
  assert.equal(body.version, SKY_AI_VERSION);
  assert.equal(body.via, 'direct');
});

test('health reports service-binding caller', async () => {
  const req = new Request('https://internal/api/ai/sky-health', { headers: { 'x-sky-ai-caller': 'admission-gk' } });
  const body = await (await handle(req, {})).json();
  assert.equal(body.via, 'service-binding');
});

test('every other route is a clear 404, never a fake AI answer', async () => {
  for (const p of ['/api/ai/chat', '/api/ai/status', '/']) {
    const res = await handle(new Request('https://sky-ai.example' + p, { method: 'POST' }), {});
    assert.equal(res.status, 404);
    assert.equal((await res.json()).error, 'not-implemented-in-sky-ai');
  }
});

test('responses are never cached', async () => {
  const res = await handle(new Request('https://sky-ai.example/health'), {});
  assert.equal(res.headers.get('cache-control'), 'no-store');
});
