import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { handlePrefsGet, sanitizeAiPrefs, AI_PREFS_DEFAULT } from './prefs.mjs';
import { handle } from './worker.mjs';

const kv = (data) => ({ get: async (k) => (k in data ? data[k] : null) });
const H = (extra = {}) => ({ 'x-sky-ai-caller': 'admission-gk', 'x-sky-uid': 'account-1', 'x-sky-internal': 'K', ...extra });
const req = (h) => new Request('https://sky-ai.example/api/ai/prefs', { headers: h });

test('copy of sanitizeAiPrefs/AI_PREFS_DEFAULT matches ai-agent.js', () => {
  const src = readFileSync(new URL('../ai-agent.js', import.meta.url), 'utf8');
  assert.ok(src.includes('export const AI_PREFS_DEFAULT = Object.freeze({ langStyle: "bn", tone: "friendly", responseLen: "balanced" });'));
  for (const s of ['new Set(["bn", "en", "mix"])', 'new Set(["friendly", "professional", "simple", "motivating", "direct"])', 'new Set(["short", "balanced", "detailed"])']) assert.ok(src.includes(s), s);
});

test('valid internal call returns the stored, sanitized prefs', async () => {
  const env = { PUB_KV: kv({ 'secret:sky-internal': 'K', 'aiprefs:account-1': '{"langStyle":"en","tone":"evil","responseLen":"short"}' }) };
  const res = await handlePrefsGet(req(H()), env);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('access-control-allow-origin'), '*');
  assert.deepEqual(await res.json(), { prefs: { langStyle: 'en', tone: 'friendly', responseLen: 'short' } });
});

test('no stored prefs -> defaults', async () => {
  const res = await handlePrefsGet(req(H()), { PUB_KV: kv({ 'secret:sky-internal': 'K' }) });
  assert.deepEqual(await res.json(), { prefs: AI_PREFS_DEFAULT });
});

test('wrong / missing key, caller or uid -> refused (null) and worker 404', async () => {
  const env = { PUB_KV: kv({ 'secret:sky-internal': 'K', 'aiprefs:account-1': '{}' }) };
  for (const h of [H({ 'x-sky-internal': 'X' }), H({ 'x-sky-internal': '' }), H({ 'x-sky-ai-caller': 'someone' }), H({ 'x-sky-uid': '' })]) {
    assert.equal(await handlePrefsGet(req(h), env), null);
  }
  assert.equal(await handlePrefsGet(req(H()), { PUB_KV: kv({}) }), null, 'no key stored -> refused');
  assert.equal(await handlePrefsGet(req(H()), {}), null, 'no KV -> refused');
  const res = await handle(req(H({ 'x-sky-internal': 'X' })), env);
  assert.equal(res.status, 404);
});

test('worker serves /api/ai/prefs on a valid internal call', async () => {
  const env = { PUB_KV: kv({ 'secret:sky-internal': 'K' }) };
  const res = await handle(req(H()), env);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('x-sky-ai-route'), 'prefs');
});

test('sanitize rejects non-objects', () => {
  assert.equal(sanitizeAiPrefs(null), null);
  assert.equal(sanitizeAiPrefs('x'), null);
});
