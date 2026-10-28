// P29 — the AI cost view is owner-only.
//
// The status endpoint used to hand every caller the provider list, both model
// ids, the 52-entry fallback chain, the per-day limit and the pricing block.
// That publishes which keys are live and what the AI costs — owner business,
// not student business. The owner reaches the same numbers through his own
// admin token, so nobody legitimately loses access.
import publicWorker from './public-worker.js';
import bundledWorker from './worker-bundle.mjs';
import { agentStatus } from './ai-agent.js';

let passed = 0, failed = 0;
async function test(name, check) {
  try {
    const ok = await (typeof check === 'function' ? check() : check);
    if (!ok) throw new Error('assertion returned false');
    passed++; console.log('  ✓', name);
  } catch (e) { failed++; console.error('  ✗', name, '—', e?.message || e); }
}

class MemoryKV {
  constructor(seed = {}) { this.data = new Map(Object.entries(seed)); this.writes = []; }
  async get(k, t) { const v = this.data.has(k) ? this.data.get(k) : null; if (t === 'json' && v != null) return JSON.parse(v); return v; }
  async put(k, v) { this.data.set(k, String(v)); this.writes.push({ key: k, value: String(v) }); }
  async delete(k) { this.data.delete(k); }
}

const ADMIN = 'admin-test-token-0123456789abcdef';
const env = () => ({ PUB_KV: new MemoryKV(), ADMIN_TOKEN: ADMIN, GEMINI_KEYS: 'k1|k2', GROQ_API_KEY: 'g1', AGENT_DAILY_CAP: 10 });

const GUEST = { 'X-AH-Guest': 'device-guest-00000001', 'CF-Connecting-IP': '203.0.113.7' };

await test('P29-১. guest (no token) gets NO provider list', async () => {
  const r = await publicWorker.fetch(new Request('https://w/api/ai/status', { headers: GUEST }), env());
  const d = await r.json();
  return r.status === 200 && d.providers === undefined;
});

await test('P29-২. guest gets NO model ids', async () => {
  const d = await (await publicWorker.fetch(new Request('https://w/api/ai/status', { headers: GUEST }), env())).json();
  return d.models === undefined;
});

await test('P29-৩. guest gets NO fallback chain', async () => {
  const d = await (await publicWorker.fetch(new Request('https://w/api/ai/status', { headers: GUEST }), env())).json();
  return d.chain === undefined;
});

await test('P29-৪. guest gets NO per-day limit', async () => {
  const d = await (await publicWorker.fetch(new Request('https://w/api/ai/status', { headers: GUEST }), env())).json();
  return d.limits === undefined;
});

await test('P29-৫. guest gets NO observability/pricing block', async () => {
  const d = await (await publicWorker.fetch(new Request('https://w/api/ai/status', { headers: GUEST }), env())).json();
  return d.observability === undefined;
});

await test('P29-৬. the generic shell the app relies on is intact for a guest', async () => {
  const d = await (await publicWorker.fetch(new Request('https://w/api/ai/status', { headers: GUEST }), env())).json();
  return d.ok === true && d.streaming === true && typeof d.agent === 'string';
});

await test('P29-৭. a wrong token is treated exactly like a guest', async () => {
  const d = await (await publicWorker.fetch(new Request('https://w/api/ai/status', { headers: { ...GUEST, Authorization: 'Bearer not-the-admin-token' } }), env())).json();
  return d.providers === undefined && d.chain === undefined && d.limits === undefined;
});

await test('P29-৮. the OWNER token still gets the full cost view', async () => {
  const d = await (await publicWorker.fetch(new Request('https://w/api/ai/status', { headers: { ...GUEST, Authorization: 'Bearer ' + ADMIN } }), env())).json();
  return !!d.providers && !!d.models && Array.isArray(d.chain) && d.chain.length > 0 && !!d.limits && !!d.observability;
});

await test('P29-৯. owner sees real provider state, not a placeholder', async () => {
  const d = await (await publicWorker.fetch(new Request('https://w/api/ai/status', { headers: { ...GUEST, Authorization: 'Bearer ' + ADMIN } }), env())).json();
  return d.providers.gemini === true && d.providers.groq === true && d.limits.perDay === 10;
});

await test('P29-১০. no ADMIN_TOKEN configured → fail closed (nobody gets the block)', async () => {
  const e = env(); delete e.ADMIN_TOKEN;
  const d = await (await publicWorker.fetch(new Request('https://w/api/ai/status', { headers: { ...GUEST, Authorization: 'Bearer ' + ADMIN } }), e)).json();
  return d.providers === undefined && d.observability === undefined;
});

await test('P29-১১. the raw engine still reports the full block to its own caller', async () => {
  // The gate lives at the route, not inside agentStatus, so direct callers
  // (tests, internal probes) keep the complete contract.
  const r = await agentStatus(new Request('https://w/api/ai/status'), env(), 'account-x');
  const d = await r.json();
  return !!d.providers && !!d.chain && !!d.limits && !!d.observability;
});

await test('P29-১২. the gate never turns a served status into an error', async () => {
  const r = await publicWorker.fetch(new Request('https://w/api/ai/status', { headers: GUEST }), env());
  return r.status === 200;
});

await test('P29-১৩. the BUNDLE that actually ships carries the same gate (guest blocked)', async () => {
  const d = await (await bundledWorker.fetch(new Request('https://w/api/ai/status', { headers: GUEST }), env())).json();
  return d.ok === true && d.providers === undefined && d.chain === undefined && d.observability === undefined;
});

await test('P29-১৪. the BUNDLE still serves the owner the full cost view', async () => {
  const d = await (await bundledWorker.fetch(new Request('https://w/api/ai/status', { headers: { ...GUEST, Authorization: 'Bearer ' + ADMIN } }), env())).json();
  return !!d.providers && Array.isArray(d.chain) && !!d.limits;
});

/* BUG-002 (2026-10-25 audit): the cost view was gated, but the same response
   still handed every caller the internal architecture — the state store and its
   schema version, every declared tool with its permission and owner-scope, the
   memory mode, and the exact response-filter classes plus which ones block.
   That is a map for crafting an evasion, and a student has no use for it. */
await test('P29-১৫. guest gets NO state store / schema version', async () => {
  const d = await (await publicWorker.fetch(new Request('https://w/api/ai/status', { headers: GUEST }), env())).json();
  return d.state === undefined;
});

await test('P29-১৬. guest gets NO declared tool list', async () => {
  const d = await (await publicWorker.fetch(new Request('https://w/api/ai/status', { headers: GUEST }), env())).json();
  return d.tools === undefined;
});

await test('P29-১৭. guest gets NO memory mode/scope', async () => {
  const d = await (await publicWorker.fetch(new Request('https://w/api/ai/status', { headers: GUEST }), env())).json();
  return d.memory === undefined;
});

await test('P29-১৮. guest gets NO response-filter classes', async () => {
  const d = await (await publicWorker.fetch(new Request('https://w/api/ai/status', { headers: GUEST }), env())).json();
  return d.response === undefined;
});

await test('P29-১৯. the BUNDLE that ships also hides the internal blocks from a guest', async () => {
  const d = await (await bundledWorker.fetch(new Request('https://w/api/ai/status', { headers: GUEST }), env())).json();
  return d.state === undefined && d.tools === undefined && d.memory === undefined && d.response === undefined;
});

await test('P29-২০. the OWNER token still sees the internal blocks', async () => {
  const d = await (await publicWorker.fetch(new Request('https://w/api/ai/status', { headers: { ...GUEST, Authorization: 'Bearer ' + ADMIN } }), env())).json();
  return !!d.tools && !!d.response && !!d.state && !!d.memory;
});

await test('P29-২১. the raw engine still reports the internal blocks to its own caller', async () => {
  const d = await (await agentStatus(new Request('https://w/api/ai/status'), env(), 'account-x')).json();
  return !!d.tools && !!d.response && !!d.state;
});

console.log('\n✅ P29 ai-status owner-only: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
