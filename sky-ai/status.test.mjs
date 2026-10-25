import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import publicWorker from '../public-worker.js';
import { handleStatus } from './status.mjs';
import { handle, SKY_AI_VERSION } from './worker.mjs';

// F0.1 step 4i. Status is the route that was held back for a day because it would
// have lied: a status served from a room without the provider keys reports
// `providers: all false` and an empty chain — a confidently wrong dashboard.
//
// So the two tests that matter most are:
//   1. a room that cannot match the providers declines, rather than describing a
//      deployment that does not exist;
//   2. a STUDENT never sees the owner's numbers, even when the answer came from
//      the other Worker — because the redaction lives on admission-gk only.
//
// The second one is the reason this step is more than plumbing: the body crosses a
// service binding now, so "who may see what" must be decided on the side that has
// the owner's token.

const KV_KEY = 'secret:sky-internal';
const kvStore = (data = {}) => {
  const bag = { ...data };
  return {
    bag,
    get: async (k) => (k in bag ? bag[k] : null),
    put: async (k, v) => { bag[k] = v; },
    delete: async (k) => { delete bag[k]; }
  };
};
const headers = (extra = {}) => ({
  'x-sky-ai-caller': 'admission-gk',
  'x-sky-uid': 'account-1',
  'x-sky-internal': 'K',
  'x-sky-need-providers': 'gemini',
  ...extra
});
const statusReq = (extra = {}) => new Request('https://sky-ai.example/api/ai/status', { method: 'GET', headers: headers(extra) });
const envWithKeys = (over = {}) => ({ PUB_KV: kvStore({ [KV_KEY]: 'K' }), ...over });

test('trust is required — an unauthenticated caller gets no report at all', async () => {
  const env = envWithKeys({ GEMINI_KEYS: 'sk-test' });
  for (const extra of [{ 'x-sky-ai-caller': 'nobody' }, { 'x-sky-internal': 'wrong' }, { 'x-sky-uid': '' }]) {
    assert.equal(await handleStatus(statusReq(extra), env), null, JSON.stringify(extra));
  }
  assert.equal(await handleStatus(statusReq(), {}), null, 'no KV means no key to verify against');
});

test('a room with fewer providers declines instead of describing the wrong deployment', async () => {
  // admission-gk can reach gemini and groq; this room has only groq. Answering
  // would report gemini:false and a shorter chain — indistinguishable from "the
  // AI lost a provider" when nothing is actually wrong.
  const env = envWithKeys({ GROQ_API_KEY: 'gsk-test' });
  assert.equal(await handleStatus(statusReq({ 'x-sky-need-providers': 'gemini,groq' }), env), null);
  // With both present it answers, and the report is the real one.
  const full = envWithKeys({ GROQ_API_KEY: 'gsk-test', GEMINI_KEYS: 'sk-test' });
  const res = await handle(statusReq({ 'x-sky-need-providers': 'gemini,groq' }), full);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.providers.gemini, true, 'the report matches this room, and this room matches admission-gk');
  assert.ok(body.chain.length > 0);
});

test('an empty expected list means nothing to gain, so it declines', async () => {
  const env = envWithKeys({ GEMINI_KEYS: 'sk-test' });
  assert.equal(await handleStatus(statusReq({ 'x-sky-need-providers': '' }), env), null);
});

test('the daily cap and model overrides are applied, not just the providers', async () => {
  // A report is only true if it describes the settings the chat would use. A
  // forwarded status that ignored AGENT_DAILY_CAP would show 10 while the app
  // really allows 20.
  const env = envWithKeys({ GEMINI_KEYS: 'sk-test', AGENT_DAILY_CAP: '10' });
  const res = await handleStatus(statusReq({
    'x-sky-env-agent-daily-cap': '20',
    'x-sky-env-agent-gemini-models': 'gemini-test-a'
  }), env);
  const body = await res.json();
  assert.equal(body.limits.perDay, 20);
  /* The model override shows up in the CHAIN, not in `models`: `models.fast` is a
     constant in ai-agent.js (the name of the tier's default model), while
     AGENT_GEMINI_MODELS changes what the chain actually tries. Checking the chain
     is the honest assertion — the first draft of this test looked at models.fast
     and failed, which is how the difference got noticed. */
  assert.ok(body.chain.includes('gemini:gemini-test-a'), 'the override is what the chat would really try: ' + body.chain.join(','));
});

test('the answer is marked, so a deploy can tell which room replied', async () => {
  const env = envWithKeys({ GEMINI_KEYS: 'sk-test' });
  const res = await handle(statusReq(), env);
  assert.equal(res.headers.get('x-sky-ai-route'), 'status');
});

/* ── The integration half: who may see what, across the binding ───────────── */

const ADMIN = 'owner-token-0123456789abcdef';

/* admission-gk with a fake SKY_AI service binding that answers like the real one.
 * This is the shape that made the step worth thinking about: the body is now
 * produced in one room and redacted in another. */
const gkEnv = (over = {}) => {
  const kv = kvStore({
    [KV_KEY]: 'K',
    'secret:AI_KEYS': JSON.stringify({ GEMINI_KEYS: 'sk-test' }),
    'secret:GROQ_API_KEY': 'gsk-test'
  });
  const forwarded = [];
  const SKY_AI = {
    fetch: async (req) => {
      forwarded.push({ url: String(req.url), headers: Object.fromEntries(req.headers) });
      return new Response(JSON.stringify({
        ok: true, agent: 'test', pv: 'pv1', streaming: true,
        providers: { gemini: true, groq: true },
        models: { fast: 'f', smart: 's' },
        chain: ['gemini:f'],
        limits: { perDay: 10 },
        state: { store: 'durable-object', version: 'v1' },
        tools: { declared: ['a'] },
        memory: { mode: 'auto' },
        response: { blocking: ['x'] },
        actions: { enabled: true },
        context: { enabled: true },
        observability: { pricing: 'owner-only' }
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
  };
  return { env: { PUB_KV: kv, ADMIN_TOKEN: ADMIN, SKY_AI, GEMINI_KEYS: 'sk-test', GROQ_API_KEY: 'gsk-test', ...over }, forwarded };
};

const OWNER_ONLY = ['providers', 'models', 'chain', 'limits', 'observability', 'state', 'tools', 'memory', 'response', 'actions', 'context'];

test('a student never sees the owner\u2019s numbers, even when sky-ai answered', async () => {
  const { env, forwarded } = gkEnv();
  const guest = { 'X-AH-Guest': 'device-guest-00000001', 'CF-Connecting-IP': '203.0.113.7' };
  const res = await publicWorker.fetch(new Request('https://w/api/ai/status', { headers: guest }), env);
  const body = await res.json();
  for (const field of OWNER_ONLY) {
    assert.equal(body[field], undefined, `${field} was redacted`);
  }
  // The shell the app's own client reads must survive.
  assert.equal(body.ok, true);
  assert.equal(body.streaming, true);
  assert.ok(forwarded.length >= 1, 'the route really did go through the binding (so this is not a local-only pass)');
});

test('the owner still gets the whole report, from the same forwarded body', async () => {
  const { env } = gkEnv();
  const guest = { 'X-AH-Guest': 'device-guest-00000001', 'CF-Connecting-IP': '203.0.113.7' };
  const res = await publicWorker.fetch(new Request('https://w/api/ai/status', {
    headers: { ...guest, Authorization: 'Bearer ' + ADMIN }
  }), env);
  const body = await res.json();
  assert.deepEqual(body.providers, { gemini: true, groq: true });
  assert.ok(body.chain.length > 0);
});

test('no owner token configured means nobody is the owner', async () => {
  const { env } = gkEnv();
  delete env.ADMIN_TOKEN;
  const guest = { 'X-AH-Guest': 'device-guest-00000001', 'CF-Connecting-IP': '203.0.113.7' };
  const res = await publicWorker.fetch(new Request('https://w/api/ai/status', {
    headers: { ...guest, Authorization: 'Bearer ' + ADMIN }
  }), env);
  const body = await res.json();
  assert.equal(body.providers, undefined, 'a token that cannot be checked grants nothing');
});

test('a broken binding falls back to the local report, still redacted correctly', async () => {
  // The invariant every route in this split keeps: a sky-ai failure is never the
  // student's problem.
  const broken = {
    PUB_KV: gkEnv().env.PUB_KV,
    ADMIN_TOKEN: ADMIN,
    GEMINI_KEYS: 'sk-test',
    SKY_AI: { fetch: async () => { throw new Error('binding down'); } }
  };
  const guest = { 'X-AH-Guest': 'device-guest-00000001', 'CF-Connecting-IP': '203.0.113.7' };
  const res = await publicWorker.fetch(new Request('https://w/api/ai/status', { headers: guest }), broken);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.providers, undefined, 'the local answer is redacted the same way');
});

test('the redaction list exists in exactly one place', async () => {
  // The bug this prevents: one side learns a new field and the other does not, so
  // a field leaks because nobody remembered. BUG-002 had to add six names to this
  // list after the fact — that is the failure mode.
  const worker = readFileSync(new URL('../public-worker.js', import.meta.url), 'utf8');
  assert.equal((worker.match(/REDACTED_STATUS_FIELDS/g) || []).length, 2, 'declared once, used once');
  assert.match(worker, /const redactAiStatus = \(data, isOwner\)/);
  const sky = readFileSync(new URL('./status.mjs', import.meta.url), 'utf8');
  assert.equal(sky.includes('providers'), true);
  assert.equal(/delete (out|data)\.(providers|chain|limits)/.test(sky), false, 'sky-ai does not redact on its own');
});

test('version says which routes this build serves', () => {
  assert.equal(SKY_AI_VERSION, 'sky-ai-f0.1-4i-status');
});
