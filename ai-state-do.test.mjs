/* Admission Hub — AiStateObject tests.
 *
 * The object replaces three KV writes per chat with Durable Object calls,
 * because the Workers Free KV allowance is 1,000 writes a day and that capped
 * the whole chat feature at a few hundred messages.
 *
 * A Map-backed fake ctx stands in for Durable Object storage; no real binding is
 * involved, so the object's own logic is what is under test.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AiStateObject, aiStateStore, AI_STATE_VERSION, RL_WINDOW_MS } from './ai-state-do.mjs';

function fakeCtx() {
  const map = new Map();
  return {
    map,
    storage: {
      get: async (k) => map.get(k),
      put: async (k, v) => { map.set(k, v); },
      delete: async (k) => map.delete(k)
    }
  };
}

const call = (obj, path, body) => obj.fetch(new Request('https://ai-state' + path, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body || {})
})).then(r => r.json());

test('AI-STATE: version is exported', () => {
  assert.equal(AI_STATE_VERSION, 'ai-state-v1');
});

test('AI-STATE: first message is allowed and counts as one', async () => {
  const o = new AiStateObject(fakeCtx(), {});
  const r = await call(o, '/quota/consume', { uid: 'account-a', cap: 3, now: 1000 });
  assert.equal(r.allowed, true);
  assert.equal(r.used, 1);
  assert.equal(r.remaining, 2);
});

test('AI-STATE: quota is exhausted exactly at the cap', async () => {
  const o = new AiStateObject(fakeCtx(), {});
  const now = 5000;
  for (let i = 1; i <= 3; i++) {
    const r = await call(o, '/quota/consume', { uid: 'account-b', cap: 3, now });
    assert.equal(r.allowed, true, 'call ' + i + ' should pass');
  }
  const fourth = await call(o, '/quota/consume', { uid: 'account-b', cap: 3, now });
  assert.equal(fourth.allowed, false);
  assert.equal(fourth.remaining, 0);
});

test('AI-STATE: the window rolls over after 24 hours', async () => {
  const o = new AiStateObject(fakeCtx(), {});
  const t0 = 100000;
  for (let i = 0; i < 2; i++) await call(o, '/quota/consume', { uid: 'account-c', cap: 2, now: t0 });
  const blocked = await call(o, '/quota/consume', { uid: 'account-c', cap: 2, now: t0 });
  assert.equal(blocked.allowed, false);
  const after = await call(o, '/quota/consume', { uid: 'account-c', cap: 2, now: t0 + RL_WINDOW_MS });
  assert.equal(after.allowed, true);
  assert.equal(after.used, 1);
});

test('AI-STATE: cap defaults to 10 when absent', async () => {
  const o = new AiStateObject(fakeCtx(), {});
  const r = await call(o, '/quota/consume', { uid: 'account-d', now: 1 });
  assert.equal(r.cap, 10);
});

test('AI-STATE: state round-trips through put then get', async () => {
  const o = new AiStateObject(fakeCtx(), {});
  await call(o, '/state/put', { key: 'chatmem:account-e', value: '[{"role":"user","content":"hi"}]', ttlMs: 0 });
  const got = await call(o, '/state/get', { key: 'chatmem:account-e' });
  assert.equal(got.value, '[{"role":"user","content":"hi"}]');
});

test('AI-STATE: an expired entry reads as absent', async () => {
  const ctx = fakeCtx();
  const o = new AiStateObject(ctx, {});
  await call(o, '/state/put', { key: 'gone', value: 'x', ttlMs: 1 });
  // force the stored expiry into the past rather than waiting
  const stored = ctx.map.get('gone');
  ctx.map.set('gone', { v: stored.v, exp: Date.now() - 1000 });
  const got = await call(o, '/state/get', { key: 'gone' });
  assert.equal(got.value, null);
});

test('AI-STATE: a missing key reads as null, not an error', async () => {
  const o = new AiStateObject(fakeCtx(), {});
  const got = await call(o, '/state/get', { key: 'never-written' });
  assert.equal(got.value, null);
});

test('AI-STATE: network rate allows up to the limit then refuses', async () => {
  const o = new AiStateObject(fakeCtx(), {});
  const now = 1000;
  for (let i = 0; i < 3; i++) {
    const r = await call(o, '/rate/consume', { limit: 3, windowMs: 60000, now });
    assert.equal(r.allowed, true, 'request ' + (i + 1));
  }
  const over = await call(o, '/rate/consume', { limit: 3, windowMs: 60000, now });
  assert.equal(over.allowed, false);
  assert.ok(over.retryAfter >= 1);
});

test('AI-STATE: network rate resets in the next window', async () => {
  const o = new AiStateObject(fakeCtx(), {});
  const now = 1000;
  await call(o, '/rate/consume', { limit: 1, windowMs: 60000, now });
  const blocked = await call(o, '/rate/consume', { limit: 1, windowMs: 60000, now });
  assert.equal(blocked.allowed, false);
  const next = await call(o, '/rate/consume', { limit: 1, windowMs: 60000, now: now + 60000 });
  assert.equal(next.allowed, true);
});

test('AI-STATE: an unknown path is a 404, not a crash', async () => {
  const o = new AiStateObject(fakeCtx(), {});
  const res = await o.fetch(new Request('https://ai-state/nope', { method: 'POST', body: '{}' }));
  assert.equal(res.status, 404);
});

test('AI-STATE: the store returns null without a binding', () => {
  assert.equal(aiStateStore({}), null);
  assert.equal(aiStateStore({ AI_STATE: {} }), null);
  assert.equal(aiStateStore(null), null);
});

test('AI-STATE: the store drives the object through a fake binding', async () => {
  const objects = new Map();
  const binding = {
    idFromName: (name) => name,
    get: (id) => {
      if (!objects.has(id)) objects.set(id, new AiStateObject(fakeCtx(), {}));
      return { fetch: (req) => objects.get(id).fetch(req) };
    }
  };
  const store = aiStateStore({ AI_STATE: binding });
  const first = await store.consumeQuota('account-x', 2);
  assert.equal(first.allowed, true);
  assert.equal(first.remaining, 1);
  await store.put('account-x', 'chatmem:account-x', 'remembered', 0);
  assert.equal(await store.get('account-x', 'chatmem:account-x'), 'remembered');
  const rate = await store.consumeRate('account-x', 5, 60000, 1000);
  assert.equal(rate.allowed, true);
  assert.equal(rate.limit, 5);
});

test('AI-STATE: a repeated request id replays the decision instead of charging twice', async () => {
  /* F0.1 step 4h. This is the only duplicate that costs the STUDENT something
     real: a wasted message from the daily allowance. The id travels with the
     request, so an attempt answered by either Worker counts once. */
  const objects = new Map();
  const binding = {
    idFromName: (name) => name,
    get: (id) => {
      if (!objects.has(id)) objects.set(id, new AiStateObject(fakeCtx(), {}));
      return { fetch: (req) => objects.get(id).fetch(req) };
    }
  };
  const store = aiStateStore({ AI_STATE: binding });
  const first = await store.consumeQuota('account-dup', 3, 'req-1');
  assert.equal(first.allowed, true);
  assert.equal(first.used, 1);
  const again = await store.consumeQuota('account-dup', 3, 'req-1');
  assert.equal(again.allowed, true);
  assert.equal(again.used, 1, 'the same request id did not consume a second message');
  assert.equal(again.remaining, first.remaining);
  assert.equal(again.replayed, true);
  // A different request still counts, so the guard is about identity, not about
  // refusing every repeat.
  const third = await store.consumeQuota('account-dup', 3, 'req-2');
  assert.equal(third.used, 2);
  assert.equal(third.replayed, undefined);
  // Without an id nothing changes for callers that do not have one.
  const fourth = await store.consumeQuota('account-dup', 3);
  assert.equal(fourth.used, 3);
});

test('AI-STATE: two users do not share a quota', async () => {
  const objects = new Map();
  const binding = {
    idFromName: (name) => name,
    get: (id) => {
      if (!objects.has(id)) objects.set(id, new AiStateObject(fakeCtx(), {}));
      return { fetch: (req) => objects.get(id).fetch(req) };
    }
  };
  const store = aiStateStore({ AI_STATE: binding });
  await store.consumeQuota('account-one', 1);
  const other = await store.consumeQuota('account-two', 1);
  assert.equal(other.allowed, true, 'a second user has their own allowance');
});
