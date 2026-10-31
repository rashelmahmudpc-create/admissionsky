/* F0.5 / GW-07 — requestId and idempotency.
 *
 * Two behaviours are under test, and they pull in opposite directions, which is
 * the whole point of the feature:
 *
 *   - a RETRY of one turn must replay its first quota decision, so a lost
 *     answer does not cost the student a second message;
 *   - a REPLAY must be bounded, so one id cannot answer the same question for
 *     free all day. Without the bound, "idempotent" would mean "unlimited".
 *
 * A third group pins the correlation: the id the quota counter sees, the id the
 * log line carries and the id the client gets back must be the same id, or the
 * id correlates nothing.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  SKY_REQUEST_ID_HEADER, normalizeRequestId, mintRequestId, requestIdFrom, turnId
} from './sky-request.mjs';
import { AiStateObject, REPLAY_WINDOW_MS } from './ai-state-do.mjs';

const read = (name) => readFileSync(new URL(name, import.meta.url), 'utf8');

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

const consume = (obj, body) => obj.fetch(new Request('https://ai-state/quota/consume', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
})).then(r => r.json());

test('f05-১. a well-formed id is accepted, and anything odd is refused, not thrown', () => {
  assert.equal(normalizeRequestId('9f3c1a2b-4d5e-4f60-8a91-b2c3d4e5f607'), '9f3c1a2b-4d5e-4f60-8a91-b2c3d4e5f607');
  assert.equal(normalizeRequestId('abc_DEF-123'), 'abc_DEF-123');
  // Too short, too long, and the characters that would collide with the storage
  // key prefix or break a header. Each one is ignored rather than fatal.
  for (const bad of ['', '   ', 'short', 'a'.repeat(65), 'has space', 'has:colon', 'x'.repeat(70), null, undefined, 42]) {
    assert.equal(normalizeRequestId(bad), '', `refused: ${JSON.stringify(bad)}`);
  }
});

test('f05-২. a minted id is always well-formed, so the server will accept it back', () => {
  for (let i = 0; i < 200; i++) {
    const id = mintRequestId();
    assert.equal(normalizeRequestId(id), id, `round-trips: ${id}`);
  }
  // Distinct ids, or two turns would replay each other.
  assert.notEqual(mintRequestId(), mintRequestId());
});

test('f05-৩. turnId reuses a held id and mints only when there is none', () => {
  const held = 'held-request-0001';
  assert.equal(turnId(held), held, 'a held id is kept');
  const fresh = turnId('');
  assert.equal(normalizeRequestId(fresh), fresh, 'a minted id is well-formed');
  assert.notEqual(fresh, held);
});

test('f05-৪. the header is read by name, and a request without one yields empty', () => {
  const withId = new Request('https://x/api/ai/chat', { headers: { [SKY_REQUEST_ID_HEADER]: 'turn-abcdef01' } });
  assert.equal(requestIdFrom(withId), 'turn-abcdef01');
  assert.equal(requestIdFrom(new Request('https://x/api/ai/chat')), '');
  assert.equal(requestIdFrom(null), '');
});

test('f05-৫. a RETRY replays its first decision — the student is not charged twice', async () => {
  const obj = new AiStateObject(fakeCtx(), {});
  const t = Date.now();
  const first = await consume(obj, { uid: 'account-a', cap: 3, reqId: 'turn-11111111', now: t });
  assert.equal(first.used, 1);
  const retry = await consume(obj, { uid: 'account-a', cap: 3, reqId: 'turn-11111111', now: t + 1000 });
  assert.equal(retry.replayed, true);
  assert.equal(retry.used, 1, 'the retry did not spend a second message');
  // A different turn still counts: the guard is about identity, not about
  // refusing every repeat.
  const other = await consume(obj, { uid: 'account-a', cap: 3, reqId: 'turn-22222222', now: t + 2000 });
  assert.equal(other.used, 2);
  assert.equal(other.replayed, undefined);
});

test('f05-৬. a replay is BOUNDED — one id cannot answer the same question all day', async () => {
  const obj = new AiStateObject(fakeCtx(), {});
  const t = Date.now();
  const first = await consume(obj, { uid: 'account-b', cap: 5, reqId: 'turn-stale-01', now: t });
  assert.equal(first.used, 1);
  // Inside the window: still a retry.
  const soon = await consume(obj, { uid: 'account-b', cap: 5, reqId: 'turn-stale-01', now: t + REPLAY_WINDOW_MS - 1 });
  assert.equal(soon.replayed, true);
  // Past the window: a new request, charged as one. This is the line that keeps
  // idempotency from becoming a quota bypass.
  const late = await consume(obj, { uid: 'account-b', cap: 5, reqId: 'turn-stale-01', now: t + REPLAY_WINDOW_MS + 1 });
  assert.equal(late.replayed, undefined);
  assert.equal(late.used, 2, 'a stale id is charged like any new request');
});

test('f05-৭. the replay entry expires on the replay clock, not the 24-hour quota window', async () => {
  const ctx = fakeCtx();
  const obj = new AiStateObject(ctx, {});
  const t = Date.now();
  await consume(obj, { uid: 'account-c', cap: 5, reqId: 'turn-expiry-1', now: t });
  const entry = ctx.map.get('quotaid:turn-expiry-1');
  assert.ok(entry, 'the decision was stored');
  assert.equal(entry.v.at, t, 'the replay clock is recorded');
  assert.equal(entry.exp, t + REPLAY_WINDOW_MS, 'it expires with the replay window');
});

test('f05-৮. two students never share a replay, even with the same id', async () => {
  const a = new AiStateObject(fakeCtx(), {});
  const b = new AiStateObject(fakeCtx(), {});
  const t = Date.now();
  await consume(a, { uid: 'account-x', cap: 5, reqId: 'same-id-0001', now: t });
  const other = await consume(b, { uid: 'account-y', cap: 5, reqId: 'same-id-0001', now: t });
  assert.equal(other.used, 1, 'a fresh object has its own allowance');
  assert.equal(other.replayed, undefined, 'no cross-student replay');
});

test('f05-৯. the gateway honours a client id and echoes it back', () => {
  const worker = read('public-worker.js');
  const helper = worker.slice(worker.indexOf('const chatWithFallback ='), worker.indexOf('const publishGlobal'));
  assert.match(helper, /normalizeRequestId\(request\.headers\.get\(SKY_REQUEST_ID_HEADER\)\)/,
    'a client-supplied id is read');
  assert.match(helper, /mintRequestId\(\)/, 'and one is minted only when absent');
  assert.match(helper, /headers\.set\(SKY_REQUEST_ID_HEADER, reqId\)/, 'the id is echoed back');
  assert.match(helper, /withRequestId\(viaSky, reqId\)/, 'the sky-ai hop keeps the same id');
});

test('f05-১০. one id runs through the quota counter, the trace line and the done frame', () => {
  const agent = read('ai-agent.js');
  // Minted once, at the top, from the gateway's id when there is one.
  assert.match(agent, /const reqId = normalizeRequestId\(opts && opts\.reqId\) \|\| makeRequestId\(/);
  // The quota decision uses it.
  assert.match(agent, /consumeQuota\(sendCtx\.uid, cap, reqId\)/);
  // The log line uses the same one, not a second derived id.
  assert.match(agent, /const rid = reqId;/);
  // And it rides out on `done` so a client that keeps only parsed events has it.
  assert.match(agent, /s\.done\(\{ rid, model: c\.model/);
  assert.match(agent, /s\.done\(\{ rid, model: model \|\| null, provider: 'cache'/);
});

test('f05-১১. the client mints one id per turn and sends it', () => {
  const chat = read('ai-agent-chat.js');
  assert.match(chat, /function turnIdFor\(text\)/, 'the turn id is derived from the question');
  assert.match(chat, /if \(turnReqId && t === turnReqText && \(Date\.now\(\) - turnReqAt\) < TURN_ID_TTL_MS\) return turnReqId;/,
    'an identical repeat reuses the id, so only a retry replays');
  assert.match(chat, /'X-Sky-Req-Id': reqId/, 'the id is sent');
  assert.match(chat, /reqId: turnIdFor\(t\)/, 'the send path binds the id to the question');
  // The same text is what makes it a retry, so the id cannot be reused for a
  // different question.
  assert.match(chat, /TURN_ID_TTL_MS = 10 \* 60 \* 1000/);
});
