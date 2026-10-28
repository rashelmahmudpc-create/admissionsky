// BUG-001 (2026-10-25 audit) — the static X-AH-App header is not a credential.
//
// The write routes (/api/cloud/publish, /api/bank, /api/ask) used to trust
// `X-AH-App: admission-hub`, a literal that ships in the client bundle, and a
// bare POST /api/bank was additionally allowed on the strength of the Origin
// header alone. Anyone who read the bundle could therefore overwrite the live
// question bank or spend the owner's paid keys. These tests pin the fix: the
// static header alone, and a forged Origin, must both be refused; the owner's
// admin token and a verified session must still pass.
import gkWorker from './gk-agent-worker.js';

let passed = 0, failed = 0;
async function test(name, check) {
  try {
    const ok = await (typeof check === 'function' ? check() : check);
    if (!ok) throw new Error('assertion returned false');
    passed++; console.log('  ✓', name);
  } catch (e) { failed++; console.error('  ✗', name, '—', e?.message || e); }
}

const ADMIN = 'admin-test-token-0123456789abcdef';
const SESSION = 's'.repeat(48);

class MemoryKV {
  constructor(seed = {}) { this.data = new Map(Object.entries(seed)); }
  async get(k) { return this.data.has(k) ? this.data.get(k) : null; }
  async put(k, v) { this.data.set(k, String(v)); }
  async delete(k) { this.data.delete(k); }
  async list() { return { keys: [] }; }
}

// AUTH_AUTHORITY stub: confirms the one session token the test uses, rejects
// everything else — the same contract the real Durable Object exposes.
const authAuthority = (valid = SESSION) => ({
  idFromName: () => 'id',
  get: () => ({
    fetch: async (_url, init) => {
      const { sessionToken } = JSON.parse(init.body);
      const ok = sessionToken === valid;
      return new Response(JSON.stringify(ok
        ? { ok: true, result: { user: { id: 'user-abc-12345678' } } }
        : { ok: false }), { status: ok ? 200 : 401 });
    }
  })
});

const env = () => ({ GK_KV: new MemoryKV(), PUB_KV: new MemoryKV(), ADMIN_TOKEN: ADMIN, ASK_API_KEY: 'ask-key', AUTH_AUTHORITY: authAuthority() });
const fetchWorker = (request, e = env()) => gkWorker.fetch(request, e, { waitUntil() {}, passThroughOnException() {} });

const post = (path, headers = {}, body = '{}') => new Request('https://worker' + path, {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body
});

const APP = { 'X-AH-App': 'admission-hub' };

await test('BUG-001-১. static header alone cannot publish the global bank', async () => {
  const r = await fetchWorker(post('/api/cloud/publish', APP, JSON.stringify({ questions: [{ id: 'q1', question: 'x', options: ['a', 'b'], answer: 0 }] })));
  return r.status === 403;
});

await test('BUG-001-২. static header alone cannot inject into the bank', async () => {
  const r = await fetchWorker(post('/api/bank', APP, JSON.stringify({ questions: [{ id: 'q1', q: 'x', o: ['a'], a: 0 }] })));
  return r.status === 403;
});

await test('BUG-001-৩. static header alone cannot spend the paid ask keys', async () => {
  const r = await fetchWorker(post('/api/ask', APP, JSON.stringify({ question: 'hi' })));
  return r.status === 403;
});

await test('BUG-001-৪. a forged Origin no longer opens POST /api/bank (beaconOk removed)', async () => {
  const r = await fetchWorker(post('/api/bank', { Origin: 'https://admissionhub.pages.dev' }, JSON.stringify({ questions: [{ id: 'q1', q: 'x', o: ['a'], a: 0 }] })));
  return r.status === 403;
});

await test('BUG-001-৫. no header at all is still refused', async () => {
  const r = await fetchWorker(post('/api/cloud/publish'));
  return r.status === 403;
});

await test('BUG-001-৬. a WRONG admin token is refused', async () => {
  const r = await fetchWorker(post('/api/cloud/publish', { ...APP, Authorization: 'Bearer not-the-token' }, JSON.stringify({ questions: [{ id: 'q1', question: 'x', options: ['a', 'b'], answer: 0 }] })));
  return r.status === 403;
});

await test('BUG-001-৭. the OWNER admin token passes the gate', async () => {
  const r = await fetchWorker(post('/api/cloud/publish', { ...APP, Authorization: 'Bearer ' + ADMIN }, JSON.stringify({ questions: [{ id: 'q1', question: 'x', options: ['a', 'b'], answer: 0 }] })));
  return r.status !== 403;
});

await test('BUG-001-৮. a VERIFIED session passes the gate (signed-in student keeps saving)', async () => {
  const r = await fetchWorker(post('/api/bank', { ...APP, Cookie: '__Host-ah_session=' + SESSION }, JSON.stringify({ questions: [{ id: 'q1', q: 'x', o: ['a'], a: 0 }] })));
  return r.status !== 403;
});

await test('BUG-001-৯. an UNVERIFIED session cookie is refused', async () => {
  const r = await fetchWorker(post('/api/bank', { ...APP, Cookie: '__Host-ah_session=' + 'z'.repeat(48) }, JSON.stringify({ questions: [{ id: 'q1', q: 'x', o: ['a'], a: 0 }] })));
  return r.status === 403;
});

await test('BUG-001-১০. a malformed session cookie never reaches the authority', async () => {
  const r = await fetchWorker(post('/api/bank', { ...APP, Cookie: '__Host-ah_session=short' }, JSON.stringify({ questions: [{ id: 'q1', q: 'x', o: ['a'], a: 0 }] })));
  return r.status === 403;
});

await test('BUG-001-১১. the gate fails closed when ADMIN_TOKEN is unset', async () => {
  const e = env(); delete e.ADMIN_TOKEN;
  const r = await fetchWorker(post('/api/cloud/publish', { ...APP, Authorization: 'Bearer ' + ADMIN }, JSON.stringify({ questions: [{ id: 'q1', question: 'x', options: ['a', 'b'], answer: 0 }] })), e);
  return r.status === 403;
});

await test('BUG-001-১২. reading GET /api/bank is not blocked by the write gate', async () => {
  const r = await fetchWorker(new Request('https://worker/api/bank', { headers: APP }));
  return r.status !== 403;
});

await test('BUG-001-১৩. /health stays open for monitoring', async () => {
  const r = await fetchWorker(new Request('https://worker/health', { headers: APP }));
  return r.status === 200;
});

console.log('\n✅ BUG-001 write-route auth: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
