import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { syncProviderKeysToKv, __resetKeySyncForTests } from './ai-key-sync.mjs';
import { PROVIDER_KEY_NAMES, providerReadiness } from './ai-agent.js';

// F0.1 step 4j follow-up. This module copies credentials from one Worker's
// environment into the KV blob both Workers read. That is exactly the kind of code
// that must be boring and provably safe, so the tests are about what it refuses to
// do rather than what it achieves.

const kvStore = (seed = {}) => {
  const bag = new Map(Object.entries(seed));
  const writes = [];
  return {
    bag,
    writes,
    get: async (k) => (bag.has(k) ? bag.get(k) : null),
    put: async (k, v) => { bag.set(k, v); writes.push(k); }
  };
};

const withFresh = (fn) => async () => { __resetKeySyncForTests(); return fn(); };

test('a credential that only exists in env is copied, by name, and nothing else', withFresh(async () => {
  const env = { AI_KEY_SYNC: 'on', PUB_KV: kvStore(), CLOUDFLARE_ACCOUNT_ID: 'acct-123', CLOUDFLARE_AI_API_KEY: 'cf-secret' };
  const r = await syncProviderKeysToKv(env);
  assert.equal(r.ok, true);
  assert.deepEqual(r.added.sort(), ['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_AI_API_KEY']);
  const stored = JSON.parse(env.PUB_KV.bag.get('secret:AI_KEYS'));
  assert.equal(stored.CLOUDFLARE_ACCOUNT_ID, 'acct-123');
  assert.equal(stored.CLOUDFLARE_AI_API_KEY, 'cf-secret');
}));

test('the result carries names, never secrets', withFresh(async () => {
  const env = { AI_KEY_SYNC: 'on', PUB_KV: kvStore(), GEMINI_KEYS: 'SECRET-VALUE-A', GROQ_API_KEY: 'SECRET-VALUE-B' };
  const r = await syncProviderKeysToKv(env);
  const printed = JSON.stringify(r);
  for (const secret of ['SECRET-VALUE-A', 'SECRET-VALUE-B']) {
    assert.equal(printed.includes(secret), false, 'a secret reached the return value');
  }
}));

test('a value already in KV is never overwritten', withFresh(async () => {
  // An operator may have rotated a key in KV deliberately; env must only fill gaps.
  const existing = { GEMINI_KEYS: 'rotated-in-kv' };
  const env = { AI_KEY_SYNC: 'on', PUB_KV: kvStore({ 'secret:AI_KEYS': JSON.stringify(existing) }), GEMINI_KEYS: 'stale-in-env' };
  const r = await syncProviderKeysToKv(env);
  assert.deepEqual(r.added, []);
  assert.equal(JSON.parse(env.PUB_KV.bag.get('secret:AI_KEYS')).GEMINI_KEYS, 'rotated-in-kv');
  assert.equal(env.PUB_KV.writes.length, 0, 'nothing was written when nothing was missing');
}));

test('it stops writing once the gap is closed', withFresh(async () => {
  // The KV write budget on the free plan is 1,000 a day; a per-request write would
  // spend it on nothing.
  const kv = kvStore();
  const env = { AI_KEY_SYNC: 'on', PUB_KV: kv, CLOUDFLARE_AI_API_KEY: 'x' };
  await syncProviderKeysToKv(env);
  assert.equal(kv.writes.length, 1);
  __resetKeySyncForTests();
  const second = await syncProviderKeysToKv(env);
  assert.deepEqual(second.added, []);
  assert.equal(kv.writes.length, 1, 'the second pass found nothing to do and wrote nothing');
}));

test('one isolate checks once, not once per request', withFresh(async () => {
  const env = { AI_KEY_SYNC: 'on', PUB_KV: kvStore(), GEMINI_KEYS: 'k' };
  await syncProviderKeysToKv(env);
  let reads = 0;
  const counting = { AI_KEY_SYNC: 'on', PUB_KV: { get: async () => { reads++; return null; }, put: async () => {} }, GEMINI_KEYS: 'k' };
  await syncProviderKeysToKv(counting);
  assert.equal(reads, 0, 'the isolate-local flag skips even the read');
}));

test('a malformed blob is left alone, not replaced', withFresh(async () => {
  // Overwriting an unparseable file with a fresh one would destroy whatever an
  // operator had in there.
  const env = { AI_KEY_SYNC: 'on', PUB_KV: kvStore({ 'secret:AI_KEYS': '{not json' }), GEMINI_KEYS: 'k' };
  const r = await syncProviderKeysToKv(env);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'unreadable');
  assert.equal(env.PUB_KV.bag.get('secret:AI_KEYS'), '{not json');
  assert.equal(env.PUB_KV.writes.length, 0);
}));

test('no KV, or a failing write, changes nothing', withFresh(async () => {
  assert.equal((await syncProviderKeysToKv({ AI_KEY_SYNC: 'on', GEMINI_KEYS: 'k' })).reason, 'no-kv');
  __resetKeySyncForTests();
  const env = { AI_KEY_SYNC: 'on', PUB_KV: { get: async () => null, put: async () => { throw new Error('kv down'); } }, GEMINI_KEYS: 'k' };
  const r = await syncProviderKeysToKv(env);
  assert.equal(r.ok, false);
  assert.deepEqual(r.added, [], 'a failed write reports nothing as added');
}));

test('after a sync the other room sees the same provider — the point of it all', withFresh(async () => {
  // One KV, two Workers: env-only credential → copied → both compute the same
  // readiness from the SAME namespace. This is the property parity checks for.
  const shared = kvStore();
  const admissionGk = { AI_KEY_SYNC: 'on', PUB_KV: shared, CLOUDFLARE_ACCOUNT_ID: 'acct', CLOUDFLARE_AI_API_KEY: 'key', GEMINI_KEYS: 'g' };
  const skyAi = { PUB_KV: shared }; // its own environment has nothing
  const before = await providerReadiness(skyAi);
  assert.equal(before.cloudflare, false, 'before the sync the far room cannot reach it');
  await syncProviderKeysToKv(admissionGk);
  const after = await providerReadiness(skyAi);
  assert.equal(after.cloudflare, true, 'after the sync it can');
  assert.equal(after.gemini, true);
}));

test('every provider the router knows is on the sync list', () => {
  // If these lists drifted, a provider could be reachable here and invisible
  // there, which is the exact failure that started this.
  const src = readFileSync(new URL('./ai-agent.js', import.meta.url), 'utf8');
  const names = PROVIDER_KEY_NAMES;
  for (const name of ['GEMINI_KEYS', 'GROQ_API_KEY', 'CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_AI_API_KEY']) {
    assert.ok(names.includes(name), `${name} is synced`);
    assert.ok(src.includes(name), `${name} is used by the router`);
  }
  assert.ok(names.length > 4, 'the compat providers are included too');
});

test('the Worker runs it off the request path, and logs names only', () => {
  const src = readFileSync(new URL('./gk-agent-worker.js', import.meta.url), 'utf8');
  const block = src.slice(src.indexOf('syncProviderKeysToKv(env)'));
  assert.match(block, /ctx\.waitUntil\(p\)/, 'the request does not wait for it');
  assert.match(block, /catch\(\(\) => \{\}\)/, 'a failure cannot fail the request');
  assert.match(block, /names: r\.added/, 'the log line carries names');
  assert.equal(/names: .*(value|secret|key\b)/i.test(block), false, 'and never a value');
});

/* ── F0.1 step 4l: fail safe, and observe before fixing ──────────────────── */

test('the automatic pass is off unless explicitly armed', withFresh(async () => {
  // After the first deploy the provider list came back SHORTER than before, and
  // this module is the only code that writes that file. Until the file's shape
  // can be observed, guessing is worse than waiting — chat falls back meanwhile,
  // so no student is affected.
  const kv = kvStore();
  const env = { PUB_KV: kv, GEMINI_KEYS: 'k' };
  const r = await syncProviderKeysToKv(env);
  assert.equal(r.skipped, 'disabled');
  assert.deepEqual(r.added, []);
  assert.equal(kv.writes.length, 0, 'nothing was written while disarmed');

  // Explicitly armed, it does its job again — the capability is not gone, only
  // switched off.
  const armed = { PUB_KV: kv, GEMINI_KEYS: 'k', AI_KEY_SYNC: 'on' };
  const r2 = await syncProviderKeysToKv(armed);
  assert.deepEqual(r2.added, ['GEMINI_KEYS']);
  assert.equal(kv.writes.length, 1);
}));

test('the shape probe says WHY the file is unusable, without showing it', async () => {
  const { aiKeyBlobShape } = await import('./ai-agent.js');
  assert.deepEqual(await aiKeyBlobShape({}), { present: false, reason: 'no-kv' });
  assert.equal((await aiKeyBlobShape({ PUB_KV: kvStore() })).reason, 'absent');
  assert.equal((await aiKeyBlobShape({ PUB_KV: kvStore({ 'secret:AI_KEYS': '{oops' }) })).reason, 'unparseable');
  assert.equal((await aiKeyBlobShape({ PUB_KV: kvStore({ 'secret:AI_KEYS': '[1,2]' }) })).reason, 'not-an-object');
  const ok = await aiKeyBlobShape({ PUB_KV: kvStore({ 'secret:AI_KEYS': JSON.stringify({ GEMINI_KEYS: 'SECRET', OTHER_THING: 'x' }) }) });
  assert.deepEqual(ok, { present: true, count: 2, providers: ['GEMINI_KEYS'] });
  assert.equal(JSON.stringify(ok).includes('SECRET'), false, 'the shape never carries a value');
});

test('the deploy reports the shape, so the next run answers this instead of guessing', () => {
  const wf = readFileSync(new URL('./.github/workflows/deploy-pages-worker.yml', import.meta.url), 'utf8');
  assert.match(wf, /"aiKeys"/);
  assert.match(wf, /Sky AI key file/);
  assert.match(wf, /both rooms read KV secret:AI_KEYS/);
});
