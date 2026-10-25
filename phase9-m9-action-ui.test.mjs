// 🧩 PHASE 9 — M9: IN-CHAT ACTION CONFIRMATION UI
// Locks the student-facing half of the write/execute layer: the chat turns an
// explicit personalization request into a *proposal*, renders the server-built
// summary, and writes nothing until the student taps "yes". The tests below load
// the real card/decide code out of ai-agent-chat.js and drive it, so a regression
// in the confirmation handshake fails here rather than in production.
import { readFileSync } from 'fs';
let pass = 0, fail = 0;
/* Async cases must be awaited — an unawaited promise is always truthy and would
   make every one of them pass vacuously. */
const t = async (n, c) => { if (await c) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n); } };

const UI = readFileSync('ai-agent-chat.js', 'utf8');
const PW = readFileSync('public-worker.js', 'utf8');

/* Load the M9 block out of the real source and build a callable factory. */
const START = 'const ACT_ACTIONS = {';
const END = '  function msgHtml(m, idx) {';
const block = UI.slice(UI.indexOf(START), UI.indexOf(END, UI.indexOf(START)));
const T_STUB = {
  title: 'AI', actTitle: 'নিশ্চিত করো', actConfirmQ: 'সেভ করবো?', actYes: 'হ্যাঁ', actNo: 'না',
  actApplied: '✓ সেভ হয়েছে', actCancelled: 'বাতিল', actExpired: 'সময় শেষ', actFail: 'ব্যর্থ',
  actOffline: 'অফলাইন', actOnly: 'শুধু তোমার', actPending: '…'
};
function build({ lang = 'bn', msgs = [], fetchImpl = null } = {}) {
  const calls = [];
  const toasts = [];
  const fetchStub = fetchImpl || ((...a) => { calls.push(a); return Promise.resolve({ status: 200, json: () => Promise.resolve({ ok: true }) }); });
  const save = () => {};
  const renderMsgs = () => {};
  const toast = (m) => { toasts.push(m); };
  const fn = new Function('esc', 'T', 'lang', 'window', 'fetch', 'msgs', 'save', 'renderMsgs', 'toast',
    block + '\nreturn { ACT_ACTIONS, AUTO_CONFIRM_ACTIONS, actLabel, actionCardHtml, actionExpired, dropExpiredAction, decideAction, resolveProposal, actParseIntent, offerAction };');
  /* Mirror the real esc(): textContent→innerHTML escaping. If the card ever
     concatenated a proposal summary raw, the markup assertions below would see it. */
  const escStub = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const api = fn(escStub, T_STUB, lang, {}, fetchStub, msgs, save, renderMsgs, toast);
  return { ...api, calls, toasts, msgs };
}

/* ── ১. The intent parser maps plain Bangla/English requests ── */
await t('M9UI-১. "উত্তর ছোট করে দাও" → prefs.write{responseLen:short}',
  (() => { const i = build().actParseIntent('উত্তর ছোট করে দাও'); return i && i.action === 'prefs.write' && i.args.responseLen === 'short'; })());
await t('M9UI-২. "keep it concise" and "answer in English" map to length and language',
  (() => { const a = build().actParseIntent('keep it concise'); const b = build().actParseIntent('answer in English please');
    return a && a.args.responseLen === 'short' && b && b.args.langStyle === 'en'; })());
await t('M9UI-৩. a plain study question proposes nothing at all',
  (['বাংলা সন্ধি বুঝিয়ে দাও', 'give me 5 MCQs', 'আমার পারফরম্যান্স কেমন?', '']
    .every((q) => build().actParseIntent(q) === null)));
await t('M9UI-৪. every parsed arg key is a declared prefs.write argument',
  (() => {
    const declared = ['langStyle', 'tone', 'responseLen'];
    const probes = ['উত্তর ছোট করে দাও', 'আরও সহজ করে বলো', 'professional tone please', 'উত্তর বিস্তারিত দাও', 'answer in Bangla', 'উৎসাহ দাও', 'সরাসরি বলো'];
    return probes.every((q) => { const i = build().actParseIntent(q); return i && Object.keys(i.args).every((k) => declared.includes(k)); });
  })());

/* ── ২. The card shows the server summary, never client-invented copy ── */
await t('M9UI-৫. the pending card renders the proposal summary and both choices',
  (() => {
    const m = { pending: true, actId: 'tok-1', actAction: 'prefs.write', actSummary: 'উত্তরের দৈর্ঘ্য: short' };
    const h = build({ msgs: [m] }).actionCardHtml(m, 0);
    return h.includes('উত্তরের দৈর্ঘ্য: short') && h.includes('__AiActDecide(0,1)') && h.includes('__AiActDecide(0,0)');
  })());
await t('M9UI-৬. a long/terminal state renders a status line instead of buttons',
  (() => {
    const m = { pending: false, actDone: 'applied', actDoneText: T_STUB.actApplied };
    const h = build().actionCardHtml(m, 0);
    return h.includes(T_STUB.actApplied) && !h.includes('__AiActDecide');
  })());
await t('M9UI-৭. the card is escape-first — a hostile summary cannot inject markup',
  (() => {
    const m = { pending: true, actId: 't', actAction: 'prefs.write', actSummary: '<img src=x onerror=alert(1)><script>bad()</script>' };
    const h = build({ msgs: [m] }).actionCardHtml(m, 0);
    return !h.includes('<img src=x') && !h.includes('<script>') && h.includes('&lt;img src=x');
  })());

/* ── ৩. Saying no writes nothing ── */
await t('M9UI-৮. "না" resolves the card locally and never calls confirm',
  (async () => {
    const m = { pending: true, actId: 'tok', actAction: 'prefs.write', actExpiresAt: Date.now() + 60000 };
    const b = build({ msgs: [m] });
    await b.decideAction(0, false);
    return m.pending === false && m.actDone === 'cancelled' && b.calls.length === 0;
  })());

/* ── ৪. Saying yes confirms with the single-use token only ── */
await t('M9UI-৯. "হ্যাঁ" POSTs only {token} to /api/ai/actions/confirm and marks applied',
  (async () => {
    const m = { pending: true, actId: 'tok-9', actAction: 'prefs.write', actExpiresAt: Date.now() + 60000 };
    const seen = [];
    const b = build({
      msgs: [m],
      fetchImpl: (url, opts) => { seen.push({ url, opts }); return Promise.resolve({ status: 200, json: () => Promise.resolve({ ok: true, status: 'confirmed' }) }); }
    });
    await b.decideAction(0, true);
    const call = seen[0];
    const body = JSON.parse(call.opts.body);
    return call.url === '/api/ai/actions/confirm' && call.opts.method === 'POST'
      && Object.keys(body).length === 1 && body.token === 'tok-9'
      && m.pending === false && m.actDone === 'applied';
  })());
await t('M9UI-১০. a refused confirm (expired) becomes a terminal, non-retryable state',
  (async () => {
    const m = { pending: true, actId: 'tok', actAction: 'prefs.write', actExpiresAt: Date.now() + 60000 };
    const b = build({ msgs: [m], fetchImpl: () => Promise.resolve({ status: 403, json: () => Promise.resolve({ error: 'confirm_denied', reason: 'expired' }) }) });
    await b.decideAction(0, true);
    return m.pending === false && m.actDone === 'error' && m.actDoneText === T_STUB.actExpired;
  })());
await t('M9UI-১১. a network failure keeps the card pending and warns offline (no false success)',
  (async () => {
    const m = { pending: true, actId: 'tok', actAction: 'prefs.write', actExpiresAt: Date.now() + 60000 };
    const b = build({ msgs: [m], fetchImpl: () => Promise.reject(new Error('offline')) });
    await b.decideAction(0, true);
    return m.pending === true && m.actDone === undefined && b.toasts.includes(T_STUB.actOffline);
  })());
await t('M9UI-১২. an expired proposal is refused locally without any round-trip',
  (async () => {
    const m = { pending: true, actId: 'tok', actAction: 'prefs.write', actExpiresAt: Date.now() - 1 };
    const b = build({ msgs: [m] });
    await b.decideAction(0, true);
    return m.pending === false && m.actDone === 'error' && b.calls.length === 0;
  })());
await t('M9UI-১৩. a double tap cannot fire two confirms',
  (async () => {
    const m = { pending: true, actBusy: true, actId: 'tok', actAction: 'prefs.write', actExpiresAt: Date.now() + 60000 };
    const b = build({ msgs: [m] });
    await b.decideAction(0, true);
    return b.calls.length === 0 && m.pending === true;
  })());

/* ── ৫. Proposal flow and layer-off fallthrough ── */
/* prefs.write is low-risk and reversible, so it confirms itself: one POST to
   propose, one to confirm, and a single terminal card — never a tap. */
await t('M9UI-১৪. an auto-confirm action proposes and confirms in one pass, leaving a terminal card',
  (async () => {
    const msgs = [];
    const seen = [];
    const b = build({ msgs, fetchImpl: (url, opts) => {
      seen.push(url);
      if (url.endsWith('/propose')) {
        const body = JSON.parse(opts.body);
        return Promise.resolve({ status: 200, json: () => Promise.resolve({ ok: true, proposal: { id: 'srv-1', action: body.action, summary: 'নতুন সেটিং', expiresAt: Date.now() + 300000 } }) });
      }
      return Promise.resolve({ status: 200, json: () => Promise.resolve({ ok: true, status: 'confirmed' }) });
    } });
    const ok = await b.offerAction({ action: 'prefs.write', args: { tone: 'simple' } });
    const card = msgs[msgs.length - 1];
    return ok === true && msgs.length === 1 && card.pending === false && card.actDone === 'applied'
      && card.actId === 'srv-1' && card.actSummary === 'নতুন সেটিং'
      && seen.length === 2 && seen[0].endsWith('/api/ai/actions/propose') && seen[1].endsWith('/api/ai/actions/confirm');
  })());
await t('M9UI-১৪ব. an action outside the auto-confirm allowlist still waits for the student tap',
  (async () => {
    const msgs = [];
    const seen = [];
    const b = build({ msgs, fetchImpl: (url, opts) => {
      seen.push(url);
      const body = JSON.parse(opts.body);
      return Promise.resolve({ status: 200, json: () => Promise.resolve({ ok: true, proposal: { id: 'srv-2', action: body.action, summary: 'x', expiresAt: Date.now() + 300000 } }) });
    } });
    const ok = await b.offerAction({ action: 'account.delete', args: {} });
    const card = msgs[msgs.length - 1];
    return ok === true && card.pending === true && seen.length === 1 && seen[0].endsWith('/propose');
  })());
await t('M9UI-১৪গ. the allowlist holds only prefs.write',
  (() => { const s = build().AUTO_CONFIRM_ACTIONS; return s.size === 1 && s.has('prefs.write'); })());
await t('M9UI-১৪ঘ. an auto-confirm network failure keeps the card tappable and warns offline (no silent success)',
  (async () => {
    const msgs = [];
    const b = build({ msgs, fetchImpl: (url, opts) => {
      if (url.endsWith('/propose')) return Promise.resolve({ status: 200, json: () => Promise.resolve({ ok: true, proposal: { id: 'srv-3', action: 'prefs.write', summary: 'x', expiresAt: Date.now() + 300000 } }) });
      return Promise.reject(new Error('offline'));
    } });
    await b.offerAction({ action: 'prefs.write', args: { tone: 'simple' } });
    const card = msgs[msgs.length - 1];
    return card.pending === true && card.actDone === undefined && b.toasts.includes(T_STUB.actOffline);
  })());
await t('M9UI-১৫. when the layer is off (403 layer-disabled) the chat falls through to a normal answer',
  (async () => {
    const msgs = [];
    const b = build({ msgs, fetchImpl: () => Promise.resolve({ status: 403, json: () => Promise.resolve({ error: 'action_denied', reason: 'layer-disabled' }) }) });
    const ok = await b.offerAction({ action: 'prefs.write', args: { tone: 'simple' } });
    return ok === false && msgs.length === 0;
  })());
await t('M9UI-১৬. the client asks for a proposal — it never writes preferences itself',
  UI.includes("'/api/ai/actions/propose'") && UI.includes("'/api/ai/actions/confirm'")
  && !UI.includes('aiprefs:') && !UI.includes("'/api/ai/prefs'") && !/method:\s*['"]PUT['"]/.test(UI));
await t('M9UI-১৭. the UI strings for both languages exist',
  ['actYes', 'actNo', 'actExpired', 'actFail', 'actOnly'].every((k) => (UI.match(new RegExp(k + ':', 'g')) || []).length >= 2));

/* ── ৬. Server contract is unchanged and still gated ── */
/* F0.1 step 4g: the confirmation logic moved to ai-actions.mjs, which both
   admission-gk and sky-ai call. The route still has to be gated here (sign-in is
   resolved by this Worker) and the single-use delete still has to exist — so the
   check follows the code instead of being dropped. */
const ACTIONS_SRC = readFileSync(new URL('./ai-actions.mjs', import.meta.url), 'utf8');
await t('M9UI-১৮. the confirm route still requires a signed-in student and a single-use token',
  PW.includes("path === '/api/ai/actions/confirm'")
  && PW.includes("error: 'sign_in_required', message: 'AI action ব্যবহার করতে লগইন করো।'")
  && ACTIONS_SRC.includes('confirmProposal(stored, token, uid')
  && ACTIONS_SRC.includes('delete(PROPOSAL_KEY(uid))'));

console.log('\n🧩 PHASE9-M9-ACTION-UI: ' + pass + ' pass / ' + fail + ' fail');
process.exit(fail ? 1 : 0);
