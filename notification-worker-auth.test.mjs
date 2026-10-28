// BUG-001 / BUG-002 (2026-10-26 audit) — the notification Worker.
//
// /api/notify/dispatch was gated only by `X-AH-App: admission-hub`, a literal
// that ships in the client bundle. Anyone who read the bundle could POST it and
// make this Worker send Telegram messages and push to every subscribed device,
// and overwrite the cron-fallback state. These tests pin the fix: the static
// header alone must be refused on dispatch, the owner's admin token and a
// verified session must still pass, and the student-facing routes that cannot
// carry a token (state sync, push subscribe) must keep working.
import worker from './notification-worker.js';

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

const env = () => ({ NOTIFY_KV: new MemoryKV(), ADMIN_TOKEN: ADMIN, AUTH_AUTHORITY: authAuthority() });
const fetchWorker = (request, e = env()) => worker.fetch(request, e, { waitUntil() {} });

const post = (path, headers = {}, body = '{}') => new Request('https://worker' + path, {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body
});

const APP = { 'X-AH-App': 'admission-hub' };
const dispatchBody = JSON.stringify({ telegram: { text: 'hello' } });

await test('BUG-001-১. static header alone cannot dispatch Telegram messages', async () => {
  const r = await fetchWorker(post('/api/notify/dispatch', APP, dispatchBody));
  return r.status === 403;
});

await test('BUG-001-২. static header alone cannot push to every subscribed device', async () => {
  const r = await fetchWorker(post('/api/notify/dispatch', APP, JSON.stringify({ push: { title: 'x', body: 'y' } })));
  return r.status === 403;
});

await test('BUG-001-৩. static header alone cannot overwrite the cron-fallback state', async () => {
  const r = await fetchWorker(post('/api/notify/dispatch', APP, JSON.stringify({ state: { streak: 99, lastOpen: '1970-01-01' } })));
  return r.status === 403;
});

await test('BUG-001-৪. no header at all is refused', async () => {
  const r = await fetchWorker(post('/api/notify/dispatch', {}, dispatchBody));
  return r.status === 403;
});

await test('BUG-001-৫. a WRONG admin token is refused', async () => {
  const r = await fetchWorker(post('/api/notify/dispatch', { ...APP, Authorization: 'Bearer not-the-token' }, dispatchBody));
  return r.status === 403;
});

await test('BUG-001-৬. an UNVERIFIED session cookie is refused', async () => {
  const r = await fetchWorker(post('/api/notify/dispatch', { ...APP, Cookie: '__Host-ah_session=' + 'z'.repeat(48) }, dispatchBody));
  return r.status === 403;
});

await test('BUG-001-৭. the gate fails closed when ADMIN_TOKEN is unset', async () => {
  const e = env(); delete e.ADMIN_TOKEN;
  const r = await fetchWorker(post('/api/notify/dispatch', { ...APP, Authorization: 'Bearer ' + ADMIN }, dispatchBody), e);
  return r.status === 403;
});

await test('BUG-001-৮. the OWNER admin token passes the gate', async () => {
  const r = await fetchWorker(post('/api/notify/dispatch', { ...APP, Authorization: 'Bearer ' + ADMIN }, JSON.stringify({ state: { streak: 1 } })));
  return r.status === 200;
});

await test('BUG-001-৯. the owner token is also accepted in X-AH-Admin-Token', async () => {
  const r = await fetchWorker(post('/api/notify/dispatch', { ...APP, 'X-AH-Admin-Token': ADMIN }, JSON.stringify({ state: { streak: 1 } })));
  return r.status === 200;
});

await test('BUG-001-১০. a VERIFIED session passes the gate (signed-in device keeps working)', async () => {
  const r = await fetchWorker(post('/api/notify/dispatch', { ...APP, Cookie: '__Host-ah_session=' + SESSION }, JSON.stringify({ state: { streak: 1 } })));
  return r.status === 200;
});

await test('BUG-001-১১. state sync stays reachable for a student device (no token)', async () => {
  const e = env();
  const r = await fetchWorker(post('/api/notify/state', APP, JSON.stringify({ state: { streak: 4, lastOpen: '2026-10-26' } })), e);
  if (r.status !== 200) return false;
  const stored = JSON.parse(await e.NOTIFY_KV.get('state'));
  return stored.streak === 4;
});

await test('BUG-001-১২. state sync cannot send a message even if one is smuggled in', async () => {
  const r = await fetchWorker(post('/api/notify/state', APP, JSON.stringify({ telegram: { text: 'spam' }, state: { streak: 1 } })));
  const body = await r.json();
  return r.status === 200 && !body.telegram;
});

await test('BUG-001-১৩. push subscribe stays reachable for a student device (no token)', async () => {
  const r = await fetchWorker(post('/api/push/subscribe', APP, JSON.stringify({ endpoint: 'https://push.example/x', keys: { p256dh: 'k', auth: 'a' } })));
  return r.status === 200;
});

await test('BUG-001-১৪. push subscribe still needs the app header', async () => {
  const r = await fetchWorker(post('/api/push/subscribe', {}, JSON.stringify({ endpoint: 'https://push.example/x', keys: { p256dh: 'k', auth: 'a' } })));
  return r.status === 403;
});

await test('BUG-002-১. a localhost Origin gets no CORS grant', async () => {
  const r = await fetchWorker(new Request('https://worker/health', { headers: { Origin: 'http://localhost:3000' } }));
  return !r.headers.get('Access-Control-Allow-Origin');
});

await test('BUG-002-২. a 127.0.0.1 Origin gets no CORS grant', async () => {
  const r = await fetchWorker(new Request('https://worker/health', { headers: { Origin: 'http://127.0.0.1:5173' } }));
  return !r.headers.get('Access-Control-Allow-Origin');
});

await test('BUG-002-৩. a *.github.io Origin gets no CORS grant', async () => {
  const r = await fetchWorker(new Request('https://worker/health', { headers: { Origin: 'https://someone.github.io' } }));
  return !r.headers.get('Access-Control-Allow-Origin');
});

await test('BUG-002-৪. the app origin still gets its CORS grant', async () => {
  const r = await fetchWorker(new Request('https://worker/health', { headers: { Origin: 'https://admissionhub.pages.dev' } }));
  return r.headers.get('Access-Control-Allow-Origin') === 'https://admissionhub.pages.dev';
});

await test('BUG-002-৫. /health stays open for monitoring', async () => {
  const r = await fetchWorker(new Request('https://worker/health', { headers: APP }));
  return r.status === 200;
});

console.log('\n✅ notification worker auth + CORS: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
