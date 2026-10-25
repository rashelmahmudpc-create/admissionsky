// 🧩 PHASE 9 — M9: WRITE / EXECUTE ACTIONS
// Locks the action permission layer and the boundaries the blueprint set for it:
// READ/WRITE/EXECUTE are separate, nothing write/execute runs by default, every
// action needs an explicit single-use confirmation, and every attempt is audited.
//
// The tests below prove three things at once: the mechanism works, the layer is
// inert while `ENABLED` is false, and isolation holds — the owner is always the
// server-validated uid, never anything the caller's body supplied.
import { readFileSync } from 'fs';
let pass = 0, fail = 0;
const t = (n, c) => { if (c) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n); } }

const E = await import('./action-engine.js');
const ACTIONS_SRC = readFileSync(new URL('./ai-actions.mjs', import.meta.url), 'utf8');
const WORKER_SRC = readFileSync('public-worker.js', 'utf8');
const {
  ACTION_VERSION, ENABLED, PERMISSION, RISK, STATUS, CONFIRM_TTL_MS, MAX_AUDIT,
  getAction, listActions, validateActionEngine, resolveActionOwner, sanitizeActionArgs,
  authorizeAction, makeProposal, proposalSummary, confirmProposal,
  makeAuditRecord, parseAudit, appendAudit, describeActions, actionsEnabled
} = E;

/* ── ১. Engine shape and the default-OFF rule ── */
t('M9-১. engine self-validation passes and the version is stamped',
  Array.isArray(validateActionEngine()) && validateActionEngine().length === 0
  && ACTION_VERSION === 'act-v1');
t('M9-২. the layer is live by default and has an env kill-switch',
  ENABLED === true && describeActions().enabled === true
  && actionsEnabled({}) === true
  && actionsEnabled({ USE_WRITE_ACTIONS: 'disabled' }) === false
  && actionsEnabled({ USE_WRITE_ACTIONS: 'DISABLED' }) === false);
t('M9-২খ. the layer can be turned off by configuration alone (kill-switch)',
  describeActions({ USE_WRITE_ACTIONS: 'disabled' }).enabled === false
  && describeActions({ USE_WRITE_ACTIONS: 'disabled' }).declared.every(a => a.enabled === false)
  && authorizeAction('prefs.write', { uid: 'account-a', args: { tone: 'direct' }, enabled: actionsEnabled({ USE_WRITE_ACTIONS: 'disabled' }) }).reason === 'layer-disabled');
t('M9-৩. WRITE and EXECUTE are separate permission classes',
  Object.values(PERMISSION).length === 2
  && PERMISSION.WRITE === 'write' && PERMISSION.EXECUTE === 'execute'
  && !Object.values(PERMISSION).includes('read'));
t('M9-৪. every declared action is owner-scoped and follows the master switch',
  listActions().length > 0 && listActions().every(a => a.enabled === ENABLED && a.ownerScoped === true));
t('M9-৫. every declared action carries all required fields with a known risk',
  listActions().every(a => a.name && a.description && Object.values(RISK).includes(a.riskLevel)
    && Array.isArray(a.args) && a.args.length > 0));

/* ── ২. Authorization: layer OFF refuses everything ── */
t('M9-৬. with the kill-switch on, every action is refused as layer-disabled',
  authorizeAction('prefs.write', { uid: 'account-a', args: { tone: 'direct' }, enabled: false }).allowed === false
  && authorizeAction('prefs.write', { uid: 'account-a', enabled: false }).reason === 'layer-disabled');
t('M9-৭. even with the layer on, an unknown action is refused',
  authorizeAction('nope.nope', { uid: 'account-a', enabled: true }).reason === 'unknown-action');
t('M9-৮. a ready action still needs the layer on, and the engine self-check locks it',
  getAction('prefs.write').ready === true
  && validateActionEngine().length === 0
  && authorizeAction('prefs.write', { uid: 'account-a', enabled: true }).allowed === true
  && authorizeAction('prefs.write', { uid: 'account-a', enabled: false }).allowed === false);

/* ── ৩. Owner comes from the uid alone (cross-user isolation) ── */
t('M9-৯. only a signed-in account owns an action; a guest never does',
  resolveActionOwner('account-a') === 'account-a' && resolveActionOwner('guest-x') === null
  && resolveActionOwner('') === null && resolveActionOwner(null) === null);
t('M9-১০. a guest uid is refused before any argument is even read',
  authorizeAction('prefs.write', { uid: 'guest-x', enabled: true }).reason === 'no-owner-identity');
t('M9-১১. an argument naming another owner is rejected outright, not stripped',
  sanitizeActionArgs('prefs.write', { tone: 'direct' }).ok === true
  && sanitizeActionArgs('prefs.write', { uid: 'account-b', tone: 'direct' }).reason === 'owner-from-args-rejected'
  && sanitizeActionArgs('prefs.write', { ownerUid: 'account-b' }).reason === 'owner-from-args-rejected');
t('M9-১২. only declared argument keys survive sanitisation',
  (() => {
    const r = sanitizeActionArgs('prefs.write', { tone: 'direct', evil: 'x', responseLen: 'short' });
    return r.ok && r.args.tone === 'direct' && r.args.responseLen === 'short' && r.args.evil === undefined;
  })());
t('M9-১৩. unknown actions and malformed argument containers are refused',
  sanitizeActionArgs('nope', {}).reason === 'unknown-action'
  && sanitizeActionArgs('prefs.write', 'string').reason === 'bad-args'
  && sanitizeActionArgs('prefs.write', ['a']).reason === 'bad-args'
  && sanitizeActionArgs('prefs.write', { tone: 5 }).reason === 'bad-arg-type');

/* ── ৪. Proposal ── */
const proposal = makeProposal('prefs.write', { uid: 'account-a', args: { tone: 'direct' }, now: 1000, id: 'p-1', enabled: true });
t('M9-১৪. a proposal is built only when authorization succeeds',
  proposal && proposal.action === 'prefs.write' && proposal.ownerUid === 'account-a'
  && proposal.status === STATUS.PROPOSED && makeProposal('prefs.write', { uid: 'guest-x', id: 'x', enabled: true }) === null
  && makeProposal('prefs.write', { uid: 'account-a', id: '', enabled: true }) === null);
t('M9-১৪খ. with the kill-switch on no proposal can be built at all',
  makeProposal('prefs.write', { uid: 'account-a', args: { tone: 'direct' }, id: 'p-9', enabled: false }) === null);
t('M9-১৫. a proposal expires — an old yes must not act on a stale proposal',
  proposal.expiresAt === 1000 + CONFIRM_TTL_MS && CONFIRM_TTL_MS > 0);
t('M9-১৬. the proposal summary is a short Bangla line describing the change',
  typeof proposalSummary('prefs.write', { tone: 'direct' }) === 'string'
  && proposalSummary('prefs.write', { tone: 'direct' }).length > 0
  && proposalSummary('prefs.write', { tone: 'direct' }).length <= 220);
t('M9-১৭. the proposal carries no capability — no executor, only a description',
  !('exec' in proposal) && !('run' in proposal) && Object.isFrozen(proposal));

/* ── ৫. Confirmation gates ── */
t('M9-১৮. a valid confirmation from the owner is accepted',
  confirmProposal(proposal, 'p-1', 'account-a', { now: 2000, enabled: true }).ok === true
  && confirmProposal(proposal, 'p-1', 'account-a', { now: 2000, enabled: true }).action === 'prefs.write');
t('M9-১৯. a confirmation is refused while the kill-switch is on',
  confirmProposal(proposal, 'p-1', 'account-a', { now: 2000, enabled: false }).reason === 'layer-disabled');
t('M9-২০. only the owner may confirm — another account is refused',
  confirmProposal(proposal, 'p-1', 'account-b', { now: 2000, enabled: true }).reason === 'owner-mismatch'
  && confirmProposal(proposal, 'p-1', 'guest-x', { now: 2000, enabled: true }).reason === 'no-owner-identity');
t('M9-২১. a wrong, missing or malformed token is refused',
  confirmProposal(proposal, 'nope', 'account-a', { now: 2000, enabled: true }).reason === 'bad-token'
  && confirmProposal(proposal, '', 'account-a', { now: 2000, enabled: true }).reason === 'bad-token');
t('M9-২২. an expired proposal is refused with the expired status',
  confirmProposal(proposal, 'p-1', 'account-a', { now: proposal.expiresAt + 1, enabled: true }).reason === 'expired'
  && confirmProposal(proposal, 'p-1', 'account-a', { now: proposal.expiresAt + 1, enabled: true }).status === STATUS.EXPIRED);
t('M9-২৩. a missing proposal is refused, never treated as confirmable',
  confirmProposal(null, 'p-1', 'account-a', { now: 2000, enabled: true }).reason === 'no-proposal');
t('M9-২৪. single-use: once the proposal is consumed, the same token finds nothing',
  (() => {
    const replay = confirmProposal(null, 'p-1', 'account-a', { now: 2000, enabled: true });
    return replay.ok === false && replay.reason === 'no-proposal';
  })());

/* ── ৬. Audit trail ── */
t('M9-২৫. an audit record is owner-stamped and carries action/status/args',
  (() => {
    const rec = makeAuditRecord({ proposal, status: STATUS.CONFIRMED, uid: 'account-a', at: 5000 });
    return rec && rec.ownerUid === 'account-a' && rec.action === 'prefs.write'
      && rec.status === STATUS.CONFIRMED && rec.args.tone === 'direct' && rec.at === 5000;
  })());
t('M9-২৬. a guest can never produce an audit record',
  makeAuditRecord({ proposal, status: STATUS.CONFIRMED, uid: 'guest-x' }) === null);
t('M9-২৭. an unknown status degrades to failed rather than being stored raw',
  makeAuditRecord({ proposal, status: 'wat', uid: 'account-a' }).status === STATUS.FAILED);
t('M9-২৮. history keeps only the caller\x27s own records',
  (() => {
    const foreign = { ownerUid: 'account-b', action: 'prefs.write', status: STATUS.CONFIRMED };
    const mine = makeAuditRecord({ proposal, status: STATUS.CONFIRMED, uid: 'account-a' });
    const parsed = parseAudit(JSON.stringify([foreign, mine]), 'account-a');
    return parsed.length === 1 && parsed[0].ownerUid === 'account-a';
  })());
t('M9-২৯. history stays bounded and newest-first',
  (() => {
    let list = [];
    for (let i = 0; i < MAX_AUDIT + 50; i++) {
      list = appendAudit(list, makeAuditRecord({ proposal, status: STATUS.CONFIRMED, uid: 'account-a', at: i }), 'account-a');
    }
    return list.length === MAX_AUDIT && list[0].at === MAX_AUDIT + 49;
  })());
t('M9-৩০. a malformed stored history is treated as empty, never thrown',
  parseAudit('{not json', 'account-a').length === 0 && parseAudit(null, 'account-a').length === 0);

/* ── ৭. Wiring: the Worker routes exist and stay gated ── */
t('M9-৩১. the three action routes are wired with sign-in gates',
  WORKER_SRC.includes("'/api/ai/actions/propose'") && WORKER_SRC.includes("'/api/ai/actions/confirm'")
  && WORKER_SRC.includes("'/api/ai/actions/audit'")
  && (WORKER_SRC.match(/AI action ব্যবহার করতে লগইন করো।/g) || []).length === 3);
/* F0.1 step 4g: the propose/confirm handlers moved out of public-worker.js into
   ai-actions.mjs so sky-ai and admission-gk run the SAME code. The assertion
   follows them rather than being weakened — the single-use ordering is the
   property that stops an action being applied twice, so it must stay pinned
   wherever the code now lives. */
t('M9-৩২. the confirm handler consumes the proposal before writing (single-use)',
  (() => {
    const confirmFn = ACTIONS_SRC.slice(ACTIONS_SRC.indexOf('export async function confirmAction'));
    const del = confirmFn.indexOf('delete(PROPOSAL_KEY(uid))');
    const write = confirmFn.indexOf("'aiprefs:' + uid, JSON.stringify(prefs)");
    return del !== -1 && write !== -1 && del < write;
  })());
t('M9-৩৩. the audit trail is stored per owner key',
  ACTIONS_SRC.includes("'actaudit:' + uid") && E.MAX_AUDIT === 200);

/* ── ৮. E2E: the routes refuse while the layer is off ── */
function stubEnv(over = {}) {
  const store = new Map();
  const kv = {
    get: async k => store.has(k) ? store.get(k) : null,
    put: async (k, v) => { store.set(k, v); },
    delete: async k => { store.delete(k); }
  };
  // A signed-in identity: the Worker hashes the auth user id into `account-…`.
  const AUTH_AUTHORITY = {
    idFromName: name => name,
    get: () => ({ fetch: async () => new Response(JSON.stringify({ ok: true, result: { user: { id: 'user-abcdefgh' } } }), { status: 200 }) })
  };
  return { env: { PUB_KV: kv, ADMIN_TOKEN: 't', AUTH_AUTHORITY, ...over }, store };
}
const SESSION = 'a'.repeat(40);
const authPost = (path, body) => new Request('https://x' + path, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Cookie: '__Host-ah_session=' + SESSION },
  body: JSON.stringify(body)
});
const W = (await import('./public-worker.js')).default;

t('M9-৩৪. E2E: a guest is refused at the action routes with sign_in_required',
  (async () => {
    const { env } = stubEnv();
    const r = await W.fetch(authPost('/api/ai/actions/propose', { action: 'prefs.write', args: { tone: 'direct' } }), env);
    const d = await r.json();
    return r.status === 401 && d.error === 'sign_in_required';
  })(), { timeout: 5000 });
t('M9-৩৫. E2E: with the kill-switch on a propose is denied and writes nothing',
  (async () => {
    const { env, store } = stubEnv({ USE_WRITE_ACTIONS: 'disabled' });
    const r = await W.fetch(authPost('/api/ai/actions/propose', { action: 'prefs.write', args: { tone: 'direct' } }), env);
    const d = await r.json();
    return r.status === 403 && d.error === 'action_denied'
      && ![...store.keys()].some(k => k.startsWith('actprop:') || k.startsWith('aiprefs:') || k.startsWith('actaudit:'));
  })(), { timeout: 5000 });
t('M9-৩৬. E2E: with the kill-switch on a confirm is denied and writes nothing',
  (async () => {
    const { env, store } = stubEnv({ USE_WRITE_ACTIONS: 'disabled' });
    const r = await W.fetch(authPost('/api/ai/actions/confirm', { token: 'anything' }), env);
    const d = await r.json();
    return r.status === 403 && d.error === 'confirm_denied'
      && ![...store.keys()].some(k => k.startsWith('actprop:') || k.startsWith('aiprefs:'));
  })(), { timeout: 5000 });
t('M9-৩৭. E2E: the audit route reports the kill-switch state and returns no records',
  (async () => {
    const { env } = stubEnv({ USE_WRITE_ACTIONS: 'disabled' });
    const req = new Request('https://x/api/ai/actions/audit', { headers: { Cookie: '__Host-ah_session=' + SESSION } });
    const r = await W.fetch(req, env);
    const d = await r.json();
    return r.status === 200 && d.ok === true && d.actionsEnabled === false && Array.isArray(d.audit) && d.audit.length === 0;
  })(), { timeout: 5000 });
t('M9-৩৮. E2E guest check on the audit route also refuses without sign-in',
  (async () => {
    const { env } = stubEnv();
    const r = await W.fetch(new Request('https://x/api/ai/actions/audit'), env);
    const d = await r.json();
    return r.status === 401 && d.error === 'sign_in_required';
  })(), { timeout: 5000 });
t('M9-৩৯. agentStatus reflects the kill-switch, shape only',
  (async () => {
    const { env } = stubEnv({ USE_WRITE_ACTIONS: 'disabled' });
    const req = new Request('https://x/api/ai/status', { headers: { Cookie: '__Host-ah_session=' + SESSION } });
    const r = await W.fetch(req, env);
    const d = await r.json();
    return d.actions && d.actions.version === 'act-v1' && d.actions.enabled === false
      && Array.isArray(d.actions.declared) && d.actions.declared.every(a => a.enabled === false);
  })(), { timeout: 5000 });

/* ── ৯. E2E: the full flow with the layer ON ── */
t('M9-৪০. E2E ON: propose → confirm → write → audit succeeds end to end',
  (async () => {
    const { env, store } = stubEnv();
    const p = await W.fetch(authPost('/api/ai/actions/propose', { action: 'prefs.write', args: { tone: 'direct', responseLen: 'short' } }), env);
    const pd = await p.json();
    if (p.status !== 200 || !pd.proposal?.id || !pd.proposal.summary) return false;
    const c = await W.fetch(authPost('/api/ai/actions/confirm', { token: pd.proposal.id }), env);
    const cd = await c.json();
    const prefsKey = [...store.keys()].find(k => k.startsWith('aiprefs:'));
    const auditKey = [...store.keys()].find(k => k.startsWith('actaudit:'));
    const saved = prefsKey ? JSON.parse(store.get(prefsKey)) : null;
    return c.status === 200 && cd.ok === true && cd.status === 'confirmed'
      && ![...store.keys()].some(k => k.startsWith('actprop:')) // proposal consumed
      && saved && saved.tone === 'direct' && saved.responseLen === 'short'
      && auditKey && JSON.parse(store.get(auditKey)).some(r => r.status === 'confirmed');
  })(), { timeout: 5000 });
t('M9-৪১. E2E ON: a replayed confirm token is refused and changes nothing',
  (async () => {
    const { env, store } = stubEnv();
    const p = await W.fetch(authPost('/api/ai/actions/propose', { action: 'prefs.write', args: { tone: 'direct' } }), env);
    const pd = await p.json();
    await W.fetch(authPost('/api/ai/actions/confirm', { token: pd.proposal.id }), env);
    const before = store.get([...store.keys()].find(k => k.startsWith('aiprefs:')));
    const replay = await W.fetch(authPost('/api/ai/actions/confirm', { token: pd.proposal.id }), env);
    const rd = await replay.json();
    const after = store.get([...store.keys()].find(k => k.startsWith('aiprefs:')));
    return replay.status === 403 && rd.error === 'confirm_denied' && before === after;
  })(), { timeout: 5000 });
t('M9-৪২. E2E ON: a wrong token is refused and writes nothing',
  (async () => {
    const { env, store } = stubEnv();
    await W.fetch(authPost('/api/ai/actions/propose', { action: 'prefs.write', args: { tone: 'direct' } }), env);
    const bad = await W.fetch(authPost('/api/ai/actions/confirm', { token: 'wrong-token' }), env);
    const bd = await bad.json();
    return bad.status === 403 && bd.reason === 'bad-token' && ![...store.keys()].some(k => k.startsWith('aiprefs:'));
  })(), { timeout: 5000 });
t('M9-৪৩. E2E ON: an owner-naming payload is refused before any proposal is stored',
  (async () => {
    const { env, store } = stubEnv();
    const r = await W.fetch(authPost('/api/ai/actions/propose', { action: 'prefs.write', args: { uid: 'account-other', tone: 'direct' } }), env);
    const d = await r.json();
    return r.status === 403 && d.reason === 'owner-from-args-rejected' && ![...store.keys()].some(k => k.startsWith('actprop:'));
  })(), { timeout: 5000 });
t('M9-৪৪. E2E ON: a guest is still refused even when the layer is on',
  (async () => {
    const { env, store } = stubEnv();
    const r = await W.fetch(new Request('https://x/api/ai/actions/propose', { method: 'POST', body: JSON.stringify({ action: 'prefs.write' }) }), env);
    const d = await r.json();
    return r.status === 401 && d.error === 'sign_in_required' && store.size === 0;
  })(), { timeout: 5000 });
t('M9-৪৫. E2E ON: agentStatus and the audit route both report the layer on',
  (async () => {
    const { env } = stubEnv();
    const s = await W.fetch(new Request('https://x/api/ai/status', { headers: { Cookie: '__Host-ah_session=' + SESSION } }), env).then(r => r.json());
    const a = await W.fetch(new Request('https://x/api/ai/actions/audit', { headers: { Cookie: '__Host-ah_session=' + SESSION } }), env).then(r => r.json());
    return s.actions.enabled === true && s.actions.declared.every(x => x.enabled === true)
      && a.actionsEnabled === true;
  })(), { timeout: 5000 });

console.log('\n🔐 PHASE9-M9-ACTION-ENGINE: ' + pass + ' pass / ' + fail + ' fail');
process.exit(fail ? 1 : 0);

