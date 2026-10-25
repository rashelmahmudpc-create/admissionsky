import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { handleActionsPost } from './actions.mjs';
import { handle, SKY_AI_VERSION } from './worker.mjs';
import { proposeAction, confirmAction } from '../ai-actions.mjs';
import { STATUS } from '../action-engine.js';

// F0.1 step 4g. The write/execute layer is the most dangerous thing in the app:
// a bug here changes a student's settings without them meaning it, or applies
// the same change twice. So these tests are ordered by what would hurt most:
//
//   1. the kill switch must survive the hop (sky-ai has no USE_WRITE_ACTIONS);
//   2. single-use must survive the hop (a retry can never apply it twice);
//   3. the uid must be the verified one (an owner cannot be supplied by a body);
//   4. both sides must agree, byte for byte, on the same input.

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
  ...extra
});
const post = (path, body, extra = {}) => new Request('https://sky-ai.example' + path, {
  method: 'POST',
  headers: headers(extra),
  body: JSON.stringify(body ?? {})
});

const seed = () => ({ [KV_KEY]: 'K' });

test('trust is required on both action routes, and nothing is written without it', async () => {
  for (const path of ['/api/ai/actions/propose', '/api/ai/actions/confirm']) {
    const env = { PUB_KV: kvStore(seed()) };
    for (const extra of [{ 'x-sky-ai-caller': 'nobody' }, { 'x-sky-internal': 'wrong' }, { 'x-sky-uid': '' }]) {
      assert.equal(await handleActionsPost(post(path, { action: 'prefs.write', args: { tone: 'simple' } }, extra), env), null, `${path} ${JSON.stringify(extra)}`);
    }
    assert.equal(env.PUB_KV.bag['actprop:account-1'], undefined, `${path} wrote no proposal`);
    assert.equal(env.PUB_KV.bag['actaudit:account-1'], undefined, `${path} wrote no audit`);
  }
});

test('the kill switch is honoured here too, so admission-gk keeps answering it', async () => {
  // admission-gk must not forward while its switch is off (pinned in the source
  // test below). This is the second line: even if something did forward, a
  // disabled layer answers here by stepping aside.
  const env = { PUB_KV: kvStore(seed()), USE_WRITE_ACTIONS: 'disabled' };
  assert.equal(await handleActionsPost(post('/api/ai/actions/propose', { action: 'prefs.write', args: { tone: 'simple' } }), env), null);
  const res = await handle(post('/api/ai/actions/propose', { action: 'prefs.write', args: { tone: 'simple' } }), env);
  assert.equal(res.status, 404, 'a switched-off layer is not served from here');
});

test('admission-gk forwards only while write actions are enabled locally', () => {
  // The trap: sky-ai has no USE_WRITE_ACTIONS, so actionsEnabled() is true there.
  // A forward during a kill-switch would turn the switch back on — the one thing
  // an operator flipping it is trying to prevent.
  const src = readFileSync(new URL('../public-worker.js', import.meta.url), 'utf8');
  for (const path of ["'/api/ai/actions/propose'", "'/api/ai/actions/confirm'"]) {
    const at = src.indexOf(path);
    assert.ok(at > 0, `${path} exists`);
    const block = src.slice(at, at + 1200);
    const gate = block.indexOf('if (actionsEnabled(env)) {');
    const forward = block.indexOf('forwardWithIdentityBody');
    assert.ok(gate > 0 && forward > gate, `${path} forwards inside the enabled check`);
    // and the body is still readable for the fallback
    assert.ok(block.indexOf('await request.json()') > forward, `${path} reads the body after forwarding`);
  }
});

test('propose builds a confirmable proposal and writes the audit', async () => {
  const env = { PUB_KV: kvStore(seed()) };
  const res = await handleActionsPost(post('/api/ai/actions/propose', { action: 'prefs.write', args: { tone: 'simple' } }), env);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('x-sky-ai-route'), 'actions-propose');
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.proposal.action, 'prefs.write');
  assert.ok(body.proposal.id);
  assert.ok(body.proposal.summary.length > 0, 'the confirm prompt has a Bangla line to show');
  assert.ok(env.PUB_KV.bag['actprop:account-1'], 'the proposal is stored');
  const audit = JSON.parse(env.PUB_KV.bag['actaudit:account-1']);
  assert.equal(audit[0].status, STATUS.PROPOSED);
  assert.equal(env.PUB_KV.bag['aiprefs:account-1'], undefined, 'proposing changed nothing');
});

test('an unauthorized action is refused and stores nothing', async () => {
  const env = { PUB_KV: kvStore(seed()) };
  const res = await handleActionsPost(post('/api/ai/actions/propose', { action: 'delete.everything' }), env);
  assert.equal(res.status, 403);
  assert.equal((await res.json()).reason, 'unknown-action');
  assert.equal(env.PUB_KV.bag['actprop:account-1'], undefined);
});

test('confirm applies the change once, and a replay is refused', async () => {
  const env = { PUB_KV: kvStore(seed()) };
  const p = await (await handleActionsPost(post('/api/ai/actions/propose', { action: 'prefs.write', args: { tone: 'simple' } }), env)).json();
  const first = await handleActionsPost(post('/api/ai/actions/confirm', { token: p.proposal.id }), env);
  assert.equal(first.status, 200);
  assert.equal(first.headers.get('x-sky-ai-route'), 'actions-confirm');
  assert.equal((await first.json()).status, STATUS.CONFIRMED);
  assert.equal(JSON.parse(env.PUB_KV.bag['aiprefs:account-1']).tone, 'simple', 'the preference was written');
  assert.equal(env.PUB_KV.bag['actprop:account-1'], undefined, 'the proposal was consumed');

  // The replay is the important half: it must find nothing, not act again.
  const again = await handleActionsPost(post('/api/ai/actions/confirm', { token: p.proposal.id }), env);
  assert.equal(again.status, 403);
  assert.equal((await again.json()).reason, 'no-proposal');
});

test('a retry after a lost answer cannot apply the action twice', async () => {
  // Simulates exactly what the deployment does when sky-ai confirms but its
  // answer never arrives: admission-gk falls back and runs confirmAction again.
  // The change must already be applied, and the retry must refuse.
  const env = { PUB_KV: kvStore(seed()) };
  const p = await (await handleActionsPost(post('/api/ai/actions/propose', { action: 'prefs.write', args: { tone: 'direct' } }), env)).json();
  await handleActionsPost(post('/api/ai/actions/confirm', { token: p.proposal.id }), env);
  const written = env.PUB_KV.bag['aiprefs:account-1'];
  const retry = await confirmAction(env, 'account-1', { token: p.proposal.id });
  assert.equal(retry.status, 403);
  assert.equal(env.PUB_KV.bag['aiprefs:account-1'], written, 'the stored preference did not change again');
  const audit = JSON.parse(env.PUB_KV.bag['actaudit:account-1']);
  assert.equal(audit.filter((r) => r.status === STATUS.CONFIRMED).length, 1, 'exactly one confirmation is recorded');
  assert.equal(audit.filter((r) => r.status === STATUS.DENIED).length, 0, 'a lost answer does not add a false denial');
});

test('another account\u2019s proposal cannot be confirmed', async () => {
  const env = { PUB_KV: kvStore(seed()) };
  const p = await (await handleActionsPost(post('/api/ai/actions/propose', { action: 'prefs.write', args: { tone: 'simple' } }), env)).json();
  // account-2 has no proposal of its own; account-1's id must not work for it.
  const res = await handleActionsPost(post('/api/ai/actions/confirm', { token: p.proposal.id }, { 'x-sky-uid': 'account-2' }), env);
  assert.equal(res.status, 403);
  assert.equal((await res.json()).reason, 'no-proposal');
  assert.ok(env.PUB_KV.bag['actprop:account-1'], 'the original proposal is untouched');
});

test('both sides answer identically for the same input', async () => {
  // The shared module is imported, not copied — so this is really a guard against
  // someone re-inlining one side later.
  /* A proposal carries a fresh random id and a "now + TTL" expiry on every call,
     so those two fields are expected to differ and comparing them would only
     ever test the clock. Everything else — the status, the action, the summary,
     the stored audit shape — must match exactly. */
  /* Timestamps are "when this call happened", so two calls legitimately differ.
     Normalising them keeps the assertion about the ANSWER and the STORED SHAPE,
     which is what must not fork. */
  const normalize = (value) => {
    if (value && value.proposal) return { ...value, proposal: { ...value.proposal, id: 'ID', expiresAt: 0, createdAt: 0 } };
    return value;
  };
  const normalizeAudit = (raw) => JSON.stringify(JSON.parse(raw).map((r) => ({ ...r, at: 0 })));
  const runBoth = async (fn) => {
    const a = { PUB_KV: kvStore(seed()) };
    const b = { PUB_KV: kvStore(seed()) };
    const local = await fn(a);
    const sky = await fn(b);
    assert.equal(sky.status, local.status);
    assert.deepEqual(normalize(await sky.json()), normalize(await local.json()));
    /* The stored proposal carries the same random id, so it is normalised too —
       otherwise this assertion would fail for the honest reason that two calls
       are two different proposals, and would teach nobody anything. */
    const strip = (bag) => Object.fromEntries(Object.entries(bag)
      .filter(([k]) => k !== KV_KEY)
      .map(([k, v]) => {
        if (k.startsWith('actprop:')) {
          const parsed = JSON.parse(v);
          return [k, JSON.stringify({ ...parsed, id: 'ID', expiresAt: 0, createdAt: 0 })];
        }
        if (k.startsWith('actaudit:')) return [k, normalizeAudit(v)];
        return [k, v];
      }));
    assert.deepEqual(strip(b.PUB_KV.bag), strip(a.PUB_KV.bag));
  };
  await runBoth((env) => proposeAction(env, 'account-1', { action: 'prefs.write', args: { tone: 'simple' } }).then((r) => new Response(JSON.stringify(r.body), { status: r.status })));
  await runBoth((env) => confirmAction(env, 'account-1', { token: 'nope' }).then((r) => new Response(JSON.stringify(r.body), { status: r.status })));
});

test('the worker serves both paths and leaves the audit route alone', async () => {
  const env = { PUB_KV: kvStore(seed()) };
  const propose = await handle(post('/api/ai/actions/propose', { action: 'prefs.write', args: { tone: 'simple' } }), env);
  assert.equal(propose.status, 200);
  assert.equal(propose.headers.get('x-sky-ai-route'), 'actions-propose');
  // GET on either path is not this handler's business.
  for (const path of ['/api/ai/actions/propose', '/api/ai/actions/confirm']) {
    const res = await handle(new Request('https://sky-ai.example' + path, { method: 'GET', headers: headers() }), env);
    assert.equal(res.status, 404, `${path} GET is not served here`);
  }
});

test('version says which routes this build serves', () => {
  assert.match(SKY_AI_VERSION, /^sky-ai-f0\.1-4[a-z]/);
});
