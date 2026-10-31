/* AUTH V2.0 (owner 2026-10-31): signup starts must be counted, not raced.
 *
 * The pending-signup limiter and the one-live-signup-per-address rule are both
 * read-modify-write over storage. When two starts for the same address arrive
 * together, both read the same counter and both write the same incremented
 * value, so the cap is silently doubled: five allowed becomes ten. Worse, both
 * also delete "the previous ticket" for that address, so each can delete the
 * one the other just wrote, leaving whichever lands last.
 *
 * The store runs inside one Durable Object, which handles one request at a
 * time, so serialising the whole begin is a real fix rather than a hopeful one.
 * These tests fire genuinely concurrent calls and assert what the student sees:
 * a refused start is refused, and the count that gets enforced is the count
 * that was configured.
 *
 * This is written against the real storage semantics on purpose. The memory KV
 * below yields on every read and write, which is what lets an unserialised
 * implementation interleave — the same window the real object closes by
 * handling one request at a time.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { PendingSignupStore } from './auth-native/worker/pending-signup.mjs';

const SECRET = 'pending-signup-rate-secret-0123456789-ABCDEFGHIJK';
const EMAIL_LIMIT = 5;
const HOUR_MS = 60 * 60 * 1000;
const NOW = 1_800_000_000_000;

class YieldingKv {
  constructor() {
    this.map = new Map();
    this.reads = 0;
    this.writes = 0;
  }
  // Every access yields a full macrotask, so two callers that are not
  // serialised always interleave between a read and the write that depends on
  // it. A microtask yield is not enough: the awaits inside a single begin would
  // still run to completion before the next begin got a turn, which would make
  // this suite pass against a racy implementation.
  static #tick() { return new Promise(resolve => setTimeout(resolve, 0)); }
  async get(key) { await YieldingKv.#tick(); this.reads += 1; return this.map.has(key) ? structuredClone(this.map.get(key)) : undefined; }
  async put(key, value) { await YieldingKv.#tick(); this.writes += 1; this.map.set(key, structuredClone(value)); }
  async delete(key) { await YieldingKv.#tick(); for (const k of Array.isArray(key) ? key : [key]) this.map.delete(k); }
  async list({ prefix = '' } = {}) { await YieldingKv.#tick(); return new Map([...this.map].filter(([k]) => k.startsWith(prefix)).map(([k, v]) => [k, structuredClone(v)])); }
}

const setup = () => {
  const storage = new YieldingKv();
  const store = new PendingSignupStore({ storage, hmacSecret: SECRET, now: () => NOW });
  return { storage, store };
};

const start = (store, overrides = {}) => store.begin({
  email: 'racer@example.com',
  password: 'Strong-Pass-123',
  context: { ip: '203.0.113.9', deviceId: 'device-racer-0123456789', userAgent: 'Chrome' },
  ...overrides
});

const settle = results => results.map(result => (result.status === 'fulfilled' ? 'ok' : result.reason?.code || 'error'));

test('V2.0-৬: parallel starts from one address cannot exceed the configured cap', async () => {
  /* Ten starts at once against a cap of five. Unserialised, every call reads a
   * counter of zero and writes one, so all ten are admitted and the limiter
   * reports a number it never enforced. */
  const { store } = setup();
  const results = await Promise.allSettled(Array.from({ length: EMAIL_LIMIT * 2 }, () => start(store)));
  const outcomes = settle(results);
  const allowed = outcomes.filter(o => o === 'ok').length;
  const refused = outcomes.filter(o => o === 'RATE_LIMITED').length;

  assert.equal(allowed, EMAIL_LIMIT, `the cap is ${EMAIL_LIMIT}; ${allowed} were admitted`);
  assert.equal(refused, EMAIL_LIMIT, 'the rest are refused, not quietly allowed through');
  assert.equal(outcomes.filter(o => o === 'error').length, 0, 'nothing failed for any other reason');
});

test('V2.0-৭: the counter the limiter enforces is the counter it stored', async () => {
  /* The failure mode is not only "too many allowed" — it is also that the
   * stored count disagrees with what was enforced, so the next window starts
   * from a number nobody can explain. */
  const { store, storage } = setup();
  await Promise.allSettled(Array.from({ length: 8 }, () => start(store)));

  const counters = [...storage.map.entries()]
    .filter(([key]) => key.startsWith('psu:rate:email:'))
    .map(([, value]) => value.count);
  assert.equal(counters.length, 1, 'one window, one counter');
  assert.equal(counters[0], 8, 'every start was counted, including the refused ones');
});

test('V2.0-৮: parallel starts leave exactly one live signup for the address', async () => {
  /* Each start deletes the previous ticket for the address. Run together
   * without a lock, two starts can each delete what the other wrote, so the
   * address ends up with a ticket nobody holds — or with two. */
  const { store, storage } = setup();
  await Promise.allSettled(Array.from({ length: EMAIL_LIMIT }, () => start(store)));

  const records = [...storage.map.keys()].filter(key => key.startsWith('psu:rec:'));
  const pointers = [...storage.map.keys()].filter(key => key.startsWith('psu:email:'));
  assert.equal(pointers.length, 1, 'one pointer per address');
  assert.equal(records.length, 1, 'and exactly the one record it points at');

  const pointer = storage.map.get(pointers[0]);
  assert.ok(records.includes(`psu:rec:${pointer.ticketRef}`),
    'the pointer must name a record that still exists, not one a racing start deleted');
});

test('V2.0-৯: a refused start does not wedge the ones behind it', async () => {
  /* The lock is a promise chain. If a rejection broke the chain, one refused
   * signup would leave every later one hanging forever — a worse bug than the
   * race it fixes. */
  const { store } = setup();
  await Promise.allSettled(Array.from({ length: EMAIL_LIMIT }, () => start(store)));

  // Past the cap now; this must be refused promptly rather than hanging.
  const refused = await Promise.allSettled([start(store)]);
  assert.equal(settle(refused)[0], 'RATE_LIMITED');

  // And a different address is unaffected by the first one's refusals.
  const other = await start(store, {
    email: 'someone.else@example.com',
    context: { ip: '203.0.113.10', deviceId: 'device-other-0123456789', userAgent: 'Chrome' }
  });
  assert.ok(other.verificationTicket?.startsWith('p.'), 'a fresh address still starts normally');
});

test('V2.0-১০: sequential starts behave exactly as before', async () => {
  /* The lock must be invisible when calls are already one at a time — the
   * common case, and the one every other test in this repo exercises. */
  const { store } = setup();
  const tickets = [];
  for (let i = 0; i < EMAIL_LIMIT; i += 1) {
    tickets.push((await start(store)).verificationTicket);
  }
  assert.equal(new Set(tickets).size, EMAIL_LIMIT, 'each start mints its own ticket');
  await assert.rejects(() => start(store), error => error?.code === 'RATE_LIMITED',
    'the sixth sequential start is refused, as configured');
});
