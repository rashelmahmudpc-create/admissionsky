import test from 'node:test';
import assert from 'node:assert/strict';
import { handleAuditGet } from './audit.mjs';
import { handle } from './worker.mjs';
import { parseAudit, actionsEnabled } from '../action-engine.js';

const kv = (data) => ({ get: async (k) => (k in data ? data[k] : null) });
const H = (extra = {}) => ({ 'x-sky-ai-caller': 'admission-gk', 'x-sky-uid': 'account-1', 'x-sky-internal': 'K', ...extra });
const req = (h) => new Request('https://sky-ai.example/api/ai/actions/audit', { headers: h });
const STORED = JSON.stringify([
  { id: 'a', ownerUid: 'account-1', action: 'x' },
  { id: 'b', ownerUid: 'account-2', action: 'y' }
]);

test('valid internal call returns the same body admission-gk builds', async () => {
  const env = { PUB_KV: kv({ 'secret:sky-internal': 'K', 'actaudit:account-1': STORED }) };
  const res = await handleAuditGet(req(H()), env);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('access-control-allow-origin'), '*');
  assert.equal(res.headers.get('x-sky-ai-route'), 'actions-audit');
  const expected = { ok: true, actionsEnabled: actionsEnabled(env), audit: parseAudit(STORED, 'account-1') };
  assert.deepEqual(await res.json(), JSON.parse(JSON.stringify(expected)));
});

test('only the caller own records are returned', async () => {
  const env = { PUB_KV: kv({ 'secret:sky-internal': 'K', 'actaudit:account-1': STORED }) };
  const body = await (await handleAuditGet(req(H()), env)).json();
  assert.deepEqual(body.audit.map(r => r.id), ['a']);
});

test('no stored audit -> empty list', async () => {
  const body = await (await handleAuditGet(req(H()), { PUB_KV: kv({ 'secret:sky-internal': 'K' }) })).json();
  assert.deepEqual(body, { ok: true, actionsEnabled: true, audit: [] });
});

test('wrong / missing key, caller or uid -> refused (null) and worker 404', async () => {
  const env = { PUB_KV: kv({ 'secret:sky-internal': 'K', 'actaudit:account-1': STORED }) };
  for (const h of [H({ 'x-sky-internal': 'X' }), H({ 'x-sky-internal': '' }), H({ 'x-sky-ai-caller': 'someone' }), H({ 'x-sky-uid': '' })]) {
    assert.equal(await handleAuditGet(req(h), env), null);
  }
  assert.equal(await handleAuditGet(req(H()), { PUB_KV: kv({}) }), null, 'no key stored');
  assert.equal(await handleAuditGet(req(H()), {}), null, 'no KV');
  assert.equal((await handle(req(H({ 'x-sky-internal': 'X' })), env)).status, 404);
});

test('worker serves /api/ai/actions/audit on a valid internal call', async () => {
  const res = await handle(req(H()), { PUB_KV: kv({ 'secret:sky-internal': 'K' }) });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('x-sky-ai-route'), 'actions-audit');
});
