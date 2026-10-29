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
const PROXY_SECRET = 'proxy-secret-0123456789abcdef';
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

const env = () => ({ GK_KV: new MemoryKV(), PUB_KV: new MemoryKV(), ADMIN_TOKEN: ADMIN, ASK_API_KEY: 'ask-key', AUTH_AUTHORITY: authAuthority(), ALERT_PROXY_SECRET: PROXY_SECRET });

/* BUG-001 (2026-10-29 audit): the proxy header alone is forgeable, so the
   Pages proxy signs the alert body. These helpers sign the same way so the
   valid path is exercised, not assumed. */
const hex = b => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
async function proxyHeaders(body, { ts = Date.now(), secret = PROXY_SECRET } = {}) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${ts}.${body}`)));
  return { 'x-ah-pages-proxy': '1', 'x-ah-proxy-ts': String(ts), 'x-ah-proxy-sig': sig };
}
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

await test('BUG-001-১২. reading GET /api/bank now needs a proof too (BUG-002 fix)', async () => {
  /* This used to assert the opposite. That assertion pinned the vulnerability
     BUG-002 describes: the public X-AH-App literal opened the whole bank via
     ?full=1. The read now requires the same owner/session proof as a write. */
  const r = await fetchWorker(new Request('https://worker/api/bank', { headers: APP }));
  return r.status === 403;
});

await test('BUG-001-১৩. /health stays open for monitoring', async () => {
  const r = await fetchWorker(new Request('https://worker/health', { headers: APP }));
  return r.status === 200;
});


/* ── BUG-001 (2026-10-29): the alert channel needs a real proof ───────────── */

const alertBody = JSON.stringify({ message: 'probe', path: '/probe', signature: 's-' + Math.random() });
const alertReq = async (headers, body = alertBody) => new Request('https://worker/api/report-error', {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body
});

await test('BUG-001-১৪. a forged x-ah-pages-proxy header can no longer inject an alert', async () => {
  const r = await fetchWorker(await alertReq({ 'x-ah-pages-proxy': '1' }));
  return r.status === 403;
});

await test('BUG-001-১৫. a WRONG signature is refused', async () => {
  const r = await fetchWorker(await alertReq(await proxyHeaders(alertBody, { secret: 'not-the-secret' })));
  return r.status === 403;
});

await test('BUG-001-১৬. a STALE timestamp is refused (no replay)', async () => {
  const r = await fetchWorker(await alertReq(await proxyHeaders(alertBody, { ts: Date.now() - 10 * 60 * 1000 })));
  return r.status === 403;
});

await test('BUG-001-১৭. a signature over a DIFFERENT body is refused', async () => {
  const r = await fetchWorker(await alertReq(await proxyHeaders('{"message":"other"}'), alertBody));
  return r.status === 403;
});

await test('BUG-001-১৮. the gate fails closed when ALERT_PROXY_SECRET is unset', async () => {
  const e = env(); delete e.ALERT_PROXY_SECRET;
  const r = await fetchWorker(await alertReq(await proxyHeaders(alertBody)), e);
  return r.status === 403;
});

await test('BUG-001-১৯. a validly signed alert passes the gate', async () => {
  const e = env();
  const r = await fetchWorker(await alertReq(await proxyHeaders(alertBody)), e);
  return r.status !== 403;
});

/* ── BUG-002 (2026-10-29): the bank read needs the same proof as a write ──── */

await test('BUG-002-১. GET /api/bank with only the public header is refused', async () => {
  const r = await fetchWorker(new Request('https://worker/api/bank?full=1', { headers: APP }));
  return r.status === 403;
});

await test('BUG-002-২. GET /api/bank?full=1 with no header is refused', async () => {
  const r = await fetchWorker(new Request('https://worker/api/bank?full=1'));
  return r.status === 403;
});

await test('BUG-002-৩. the OWNER token still reads the bank', async () => {
  const r = await fetchWorker(new Request('https://worker/api/bank', { headers: { ...APP, Authorization: 'Bearer ' + ADMIN } }));
  return r.status !== 403;
});

await test('BUG-002-৪. a VERIFIED session still reads the bank', async () => {
  const r = await fetchWorker(new Request('https://worker/api/bank', { headers: { ...APP, Cookie: '__Host-ah_session=' + SESSION } }));
  return r.status !== 403;
});

/* ── BUG-003 (2026-10-29): /health must not fingerprint the deployment ────── */

await test('BUG-003-১. an anonymous /health reveals no secret booleans', async () => {
  const r = await fetchWorker(new Request('https://worker/health', { headers: APP }));
  const body = await r.json();
  return r.status === 200 && body.ok === true
    && !('keys' in body) && !('askKey' in body) && !('tg' in body) && !('gemini' in body);
});

await test('BUG-003-২. the OWNER still sees the full health detail', async () => {
  const r = await fetchWorker(new Request('https://worker/health', { headers: { ...APP, Authorization: 'Bearer ' + ADMIN } }));
  const body = await r.json();
  return r.status === 200 && body.ok === true && typeof body.keys === 'number' && 'tg' in body;
});

console.log('\n✅ BUG-001 write-route auth: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
