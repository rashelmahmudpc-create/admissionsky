// P22 — Voice worker provider logic: Cartesia default with an ElevenLabs fallback.
// Loads and RUNS the shipped voice-worker.js against a mocked upstream fetch, so the
// provider choice, the Cartesia request shape, the fallback, and the cache are real.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { allowedOrigin } from './cors-policy.mjs';

const src = readFileSync(new URL('./voice-worker.js', import.meta.url), 'utf8');
// AU-SEC-05: voice-worker.js now imports the shared CORS policy instead of
// keeping its own copy. This harness evaluates the file as a function body, so
// the import is rewritten to a local binding of the same function -- the worker
// still runs the real policy, it is just handed to it rather than imported.
const build = () => new Function(
  'allowedOrigin',
  `${src
    .replace("import { allowedOrigin } from './cors-policy.mjs';", '')
    .replace('export default', 'return')}`
)(allowedOrigin);

const MP3 = new Uint8Array([0x49, 0x44, 0x33, 1, 2, 3, 4, 5]); // "ID3" + junk

function mockEnv(over = {}) {
  const calls = [];
  const fetchMock = async (url, init) => { calls.push({ url: String(url), init }); return over.handler ? over.handler(String(url), init) : new Response(MP3, { status: 200 }); };
  return { env: { ...over.env }, calls, fetchMock };
}

async function run(worker, env, body, fetchMock) {
  const req = new Request('https://voice.example/api/voice', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-AH-App': 'admission-hub' },
    body: JSON.stringify(body)
  });
  const realFetch = globalThis.fetch;
  globalThis.fetch = fetchMock;
  try { return await worker.fetch(req, env); } finally { globalThis.fetch = realFetch; }
}

test('p22-01: health reports cartesia as the provider when its key is present', async () => {
  const worker = build();
  const req = new Request('https://voice.example/health');
  const res = await worker.fetch(req, { CARTESIA_API_KEY: 'k', ELEVENLABS_API_KEY: 'e' });
  const body = await res.json();
  assert.equal(body.provider, 'cartesia');
  assert.equal(body.cartesia, true);
  assert.equal(body.elevenlabs, true);
});

test('p22-02: with no key at all the worker refuses with 503', async () => {
  const worker = build();
  const { env, fetchMock } = mockEnv();
  const res = await run(worker, env, { word: 'apple' }, fetchMock);
  assert.equal(res.status, 503);
});

test('p22-03: a Cartesia key makes Cartesia the default, with the required headers and body', async () => {
  const worker = build();
  const { env, calls, fetchMock } = mockEnv({ env: { CARTESIA_API_KEY: 'ck', ELEVENLABS_API_KEY: 'ek' } });
  const res = await run(worker, env, { word: 'apple' }, fetchMock);
  assert.equal(res.status, 200);
  assert.equal(calls.length, 1, 'exactly one upstream call');
  assert.match(calls[0].url, /api\.cartesia\.ai\/tts\/bytes/);
  assert.equal(calls[0].init.headers['Cartesia-Version'], '2026-08-14');
  assert.equal(calls[0].init.headers['Authorization'], 'Bearer ck');
  const sent = JSON.parse(calls[0].init.body);
  assert.equal(sent.model_id, 'sonic-3.6');
  assert.equal(sent.transcript, 'apple');
  assert.equal(sent.language, 'en');
  assert.equal(sent.output_format.container, 'mp3');
  assert.ok(sent.voice.id, 'a voice id must be sent');
  assert.deepEqual(sent.generation_config, { speed: 0.95 }, 'a calmer default speed is sent');
  assert.equal((await res.arrayBuffer()).byteLength, MP3.byteLength);
});

test('p22-04b: a client speed request is clamped and reaches Cartesia', async () => {
  const worker = build();
  const { env, calls, fetchMock } = mockEnv({ env: { CARTESIA_API_KEY: 'ck' } });
  await run(worker, env, { word: 'apple', speed: 0.85 }, fetchMock);
  assert.equal(JSON.parse(calls[0].init.body).generation_config.speed, 0.85);
  const { env: e2, calls: c2, fetchMock: f2 } = mockEnv({ env: { CARTESIA_API_KEY: 'ck' } });
  await run(worker, e2, { word: 'apple', speed: 9 }, f2);
  assert.equal(JSON.parse(c2[0].init.body).generation_config.speed, 0.95, 'out-of-range speed falls back to the default');
});

test('p22-04: a Bengali word switches language and uses a different voice than English', async () => {
  const worker = build();
  const en = mockEnv({ env: { CARTESIA_API_KEY: 'ck' } });
  await run(worker, en.env, { word: 'apple' }, en.fetchMock);
  const w = mockEnv({ env: { CARTESIA_API_KEY: 'ck' } });
  await run(worker, w.env, { word: 'বই' }, w.fetchMock);
  const enBody = JSON.parse(en.calls[0].init.body);
  const bnBody = JSON.parse(w.calls[0].init.body);
  assert.equal(bnBody.language, 'bn');
  assert.equal(enBody.language, 'en');
  assert.notEqual(bnBody.voice.id, enBody.voice.id, 'Bengali must pick its own voice');
});

test('p22-05: when Cartesia fails, the worker falls back to ElevenLabs automatically', async () => {
  const worker = build();
  const { env, calls, fetchMock } = mockEnv({
    env: { CARTESIA_API_KEY: 'ck', ELEVENLABS_API_KEY: 'ek' },
    handler: (url) => url.includes('cartesia') ? new Response('{"message":"nope"}', { status: 500 }) : new Response(MP3, { status: 200 })
  });
  const res = await run(worker, env, { word: 'apple' }, fetchMock);
  assert.equal(res.status, 200, 'the fallback must still deliver audio');
  assert.equal(calls.length, 2, 'cartesia then elevenlabs');
  assert.match(calls[0].url, /cartesia/);
  assert.match(calls[1].url, /api\.elevenlabs\.io/);
  assert.equal(calls[1].init.headers['xi-api-key'], 'ek');
});

test('p22-06: if Cartesia fails and there is no ElevenLabs key, it reports the bare error', async () => {
  const worker = build();
  const { env, fetchMock } = mockEnv({
    env: { CARTESIA_API_KEY: 'ck' },
    handler: () => new Response('{"message":"quota"}', { status: 429 })
  });
  const res = await run(worker, env, { word: 'apple' }, fetchMock);
  assert.equal(res.status, 429);
  const body = await res.json();
  assert.equal(body.provider, 'cartesia');
});

test('p22-07: an explicit provider=elevenlabs request bypasses Cartesia', async () => {
  const worker = build();
  const { env, calls, fetchMock } = mockEnv({ env: { CARTESIA_API_KEY: 'ck', ELEVENLABS_API_KEY: 'ek' } });
  await run(worker, env, { word: 'apple', provider: 'elevenlabs' }, fetchMock);
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /elevenlabs\.io/);
});

test('p22-08: the level-2 cache serves a second request without touching any provider', async () => {
  const worker = build();
  const store = new Map();
  const kv = { get: async (k) => store.get(k) || null, put: async (k, v) => { store.set(k, v); } };
  const { env, calls, fetchMock } = mockEnv({ env: { CARTESIA_API_KEY: 'ck', VOICE_KV: kv } });
  const first = await run(worker, env, { word: 'apple' }, fetchMock);
  assert.equal(first.headers.get('X-Voice-Cache'), 'miss');
  assert.equal(calls.length, 1);
  const second = await run(worker, env, { word: 'apple' }, fetchMock);
  assert.equal(second.headers.get('X-Voice-Cache'), 'hit');
  assert.equal(calls.length, 1, 'the cache hit must not generate again');
});

test('p22-09: Cartesia voice ids (uuid form) survive the input sanitiser', async () => {
  const worker = build();
  const { env, calls, fetchMock } = mockEnv({ env: { CARTESIA_API_KEY: 'ck' } });
  const uuid = '47c38ca4-5f35-497b-b1a3-415245fb35e1';
  await run(worker, env, { word: 'apple', voiceId: uuid }, fetchMock);
  assert.equal(JSON.parse(calls[0].init.body).voice.id, uuid);
});

test('p22-10: a legacy ElevenLabs voice id never leaks into a Cartesia request', async () => {
  const worker = build();
  const { env, calls, fetchMock } = mockEnv({ env: { CARTESIA_API_KEY: 'ck', ELEVENLABS_API_KEY: 'ek' } });
  await run(worker, env, { word: 'apple', voiceId: 'EXAVITQu4vr4xnSDxMaL', modelId: 'eleven_flash_v2_5' }, fetchMock);
  const sent = JSON.parse(calls[0].init.body);
  assert.match(calls[0].url, /cartesia/);
  assert.notEqual(sent.voice.id, 'EXAVITQu4vr4xnSDxMaL', 'the ElevenLabs id must be ignored');
  assert.match(sent.voice.id, /^[0-9a-fA-F-]{36}$/, 'a Cartesia uuid default must be used instead');
});

test('p22-11: Bengali vowel signs and conjuncts pass the input sanitiser', async () => {
  const worker = build();
  const { env, calls, fetchMock } = mockEnv({ env: { CARTESIA_API_KEY: 'ck' } });
  // "আসসালামু" (matra U+09C1), "কেমন" (matra U+09C7), "শ্রদ্ধা" (hasant+ra)
  for (const bn of ['আসসালামু', 'কেমন', 'শ্রদ্ধা', 'বই পড়া']) {
    const res = await run(worker, env, { word: bn }, fetchMock);
    assert.equal(res.status, 200, `${bn} must be accepted, not invalid_word`);
  }
  assert.equal(JSON.parse(calls.at(-1).init.body).language, 'bn');
});

test('p22-12: non-letters and control input are still rejected', async () => {
  const worker = build();
  const { env, fetchMock } = mockEnv({ env: { CARTESIA_API_KEY: 'ck' } });
  for (const bad of ['a}],"x":1', '123', '', 'x'.repeat(61), 'a\nb', 'a;b']) {
    const res = await run(worker, env, { word: bad }, fetchMock);
    assert.equal(res.status, 400, `${JSON.stringify(bad)} must stay invalid`);
  }
});

test('p22-13: a generated clip is stored in KV with no expiry (permanent)', async () => {
  const worker = build();
  const puts = [];
  const kv = { get: async () => null, put: async (k, v, opts) => { puts.push({ k, opts }); } };
  const { env, fetchMock } = mockEnv({ env: { CARTESIA_API_KEY: 'ck', VOICE_KV: kv } });
  const res = await run(worker, env, { word: 'apple' }, fetchMock);
  assert.equal(res.status, 200);
  const stored = puts.find(p => p.k === 'v3:cartesia:47c38ca4-5f35-497b-b1a3-415245fb35e1:default:0.95:apple');
  assert.ok(stored, 'audio must be stored under the v3 cache key (resolved voice + speed)');
  assert.equal(stored.opts, undefined, 'no expirationTtl => permanent (আজীবন)');
});

test('p22-14: the edge cache answers a repeat before any provider call', async () => {
  const worker = build();
  const store = new Map();
  globalThis.caches = { default: {
    match: async (u) => store.get(String(u)) || undefined,
    put: async (u, resp) => { store.set(String(u), resp.clone()); }
  } };
  try {
    const { env, calls, fetchMock } = mockEnv({ env: { CARTESIA_API_KEY: 'ck', VOICE_KV: { get: async () => null, put: async () => {} } } });
    const first = await run(worker, env, { word: 'apple' }, fetchMock);
    assert.equal(first.headers.get('X-Voice-Cache'), 'miss');
    const second = await run(worker, env, { word: 'apple' }, fetchMock);
    assert.equal(second.headers.get('X-Voice-Cache'), 'edge');
    assert.equal(calls.length, 1, 'the edge hit must not reach Cartesia');
  } finally { delete globalThis.caches; }
});

test('p22-15: a concurrent-second request waits for the lock holder and reuses its KV row', async () => {
  const worker = build();
  let stored = null;
  const kv = {
    get: async (k, o) => (k.startsWith('lock:') ? '1' : (o && o.type === 'arrayBuffer' ? stored : null)),
    put: async (k, v) => { if (!k.startsWith('lock:')) stored = v; }
  };
  const { env, calls, fetchMock } = mockEnv({ env: { CARTESIA_API_KEY: 'ck', VOICE_KV: kv } });
  stored = MP3; // pretend the lock holder finished and stored the clip
  const res = await run(worker, env, { word: 'apple' }, fetchMock);
  assert.equal(res.headers.get('X-Voice-Cache'), 'hit');
  assert.equal(calls.length, 0, 'the waiter must not call the provider');
});
