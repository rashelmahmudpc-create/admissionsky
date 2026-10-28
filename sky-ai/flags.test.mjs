import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_FLAGS, bucket, isEnabled, loadFlags, evaluateAll, FLAGS_KEY } from './flags.mjs';
import { handle } from './worker.mjs';

const kv = (raw) => ({ get: async (k) => (k === FLAGS_KEY ? raw : null) });

test('every default flag is off, so shipping changes nothing', () => {
  for (const name of Object.keys(DEFAULT_FLAGS)) assert.equal(isEnabled(DEFAULT_FLAGS, name, 'uid-1'), false);
});

test('bucket is stable and in 0..99', () => {
  for (const u of ['a', 'b', 'uid-123', 'বাংলা']) {
    const b = bucket('f', u);
    assert.ok(b >= 0 && b < 100);
    assert.equal(bucket('f', u), b);
  }
});

test('kill switch wins over beta and 100%', () => {
  const flags = { x: { on: true, percent: 100, beta: ['u'], killed: true } };
  assert.equal(isEnabled(flags, 'x', 'u'), false);
});

test('beta users are on even at 0%; others stay off', () => {
  const flags = { x: { on: true, percent: 0, beta: ['u1'] } };
  assert.equal(isEnabled(flags, 'x', 'u1'), true);
  assert.equal(isEnabled(flags, 'x', 'u2'), false);
});

test('canary percent roughly matches the share of users', () => {
  const flags = { x: { on: true, percent: 10 } };
  let n = 0;
  for (let i = 0; i < 5000; i++) if (isEnabled(flags, 'x', 'user-' + i)) n++;
  assert.ok(n > 350 && n < 650, 'got ' + n);
});

test('unknown flag and anonymous user below 100% are off', () => {
  assert.equal(isEnabled({}, 'nope', 'u'), false);
  assert.equal(isEnabled({ x: { on: true, percent: 50 } }, 'x', null), false);
});

test('KV override merges; bad JSON or KV error keeps defaults', async () => {
  const f = await loadFlags({ SKY_FLAGS: kv(JSON.stringify({ 'sky.route_via_binding': { on: true, percent: 100 } })) });
  assert.equal(isEnabled(f, 'sky.route_via_binding', 'u'), true);
  assert.deepEqual(await loadFlags({ SKY_FLAGS: kv('{bad') }), { ...DEFAULT_FLAGS });
  assert.deepEqual(await loadFlags({ SKY_FLAGS: { get: async () => { throw new Error('down'); } } }), { ...DEFAULT_FLAGS });
});

test('/api/ai/sky-flags ignores x-sky-uid unless called via admission-gk', async () => {
  const env = { SKY_FLAGS: kv(JSON.stringify({ x: { on: true, percent: 0, beta: ['u1'] } })) };
  const direct = await (await handle(new Request('https://s/api/ai/sky-flags', { headers: { 'x-sky-uid': 'u1' } }), env)).json();
  assert.equal(direct.flags.x, false);
  const bound = await (await handle(new Request('https://s/api/ai/sky-flags', { headers: { 'x-sky-uid': 'u1', 'x-sky-ai-caller': 'admission-gk' } }), env)).json();
  assert.equal(bound.ok, true);
  assert.equal(bound.flags.x, true);
  assert.equal(bound.flags['sky.route_via_binding'], false);
});
