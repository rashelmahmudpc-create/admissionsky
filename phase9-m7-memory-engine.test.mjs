// 🧩 PHASE 9 — M7: MEMORY ENGINE
// Locks the long-term memory layer and the boundaries the owner set for it.
// Owner decision for M7: memory is automatic for a signed-in student, with no
// toggle and no consent prompt, and it never expires. The tests below prove the
// engine honours that while still refusing what must never be stored: guests,
// other users' records, low-confidence guesses and any PII.
import { readFileSync } from 'fs';
import { createHash } from 'crypto';
let pass = 0, fail = 0;
const t = (n, c) => { if (c) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n); } }

const M = await import('./memory-engine.js');
const A = await import('./ai-agent.js');
const AGENT_SRC = readFileSync('ai-agent.js', 'utf8');
const {
  KIND, SOURCE, CONFIDENCE_MIN, MAX_RECORDS,
  getKinds, sanitizeMemoryText, isPiiFree, resolveMemoryOwner, makeMemory,
  upsertMemory, parseMemory, guardMemoryRecord, validateMemoryEngine,
  isRetentionRequest, extractMemoryCandidates, renderMemory, MEMORY_VERSION
} = M;

/* ── ১. Engine shape ── */
t('M7-১. engine self-validation passes and the version is stamped',
  Array.isArray(validateMemoryEngine()) && validateMemoryEngine().length === 0 && MEMORY_VERSION === 'mem-v1');
t('M7-২. exactly three memorable kinds exist: studies, preference, habit',
  getKinds().length === 3 && getKinds().includes(KIND.STUDIES)
  && getKinds().includes(KIND.PREFERENCE) && getKinds().includes(KIND.HABIT));
t('M7-৩. sanitizeMemoryText collapses whitespace and drops control characters',
  sanitizeMemoryText('  গণিত\n\tভালো  ') === 'গণিত ভালো' && sanitizeMemoryText(null) === '');

/* ── ২. PII is never storable ── */
t('M7-৪. email, mobile, long ids, dates and secrets are all flagged',
  !isPiiFree('a@b.com') && !isPiiFree('01712345678') && !isPiiFree('+8801712345678')
  && !isPiiFree('123456789012') && !isPiiFree('2026-09-08') && !isPiiFree('08/09/2026')
  && !isPiiFree('password দাও') && !isPiiFree('verification code'));
t('M7-৫. ordinary study text is clean', isPiiFree('পদার্থবিজ্ঞানে দুর্বল') && isPiiFree('') && isPiiFree(null));

/* ── ৩. Owner comes from the uid alone (cross-user isolation) ── */
t('M7-৬. only a signed-in account owns memory; a guest never does',
  resolveMemoryOwner('account-a') === 'account-a' && resolveMemoryOwner('guest-x') === null
  && resolveMemoryOwner('') === null && resolveMemoryOwner(null) === null);
t('M7-৭. makeMemory refuses a guest owner outright',
  makeMemory({ kind: 'studies', key: 'k', value: 'v', source: SOURCE.USER_STATED, confidence: 0.9, reason: 'r' }, 'guest-x') === null);
t('M7-৮. makeMemory stamps the caller as owner even if the body names another',
  makeMemory({ kind: 'studies', key: 'k', value: 'v', source: SOURCE.USER_STATED, confidence: 0.9, reason: 'r', ownerUid: 'account-b' }, 'account-a').ownerUid === 'account-a');

/* ── ৪. Validation rules ── */
t('M7-৯. confidence below the threshold is a guess, not a memory',
  CONFIDENCE_MIN === 0.7
  && makeMemory({ kind: 'studies', key: 'k', value: 'v', source: SOURCE.USER_STATED, confidence: 0.69, reason: 'r' }, 'account-a') === null
  && !!makeMemory({ kind: 'studies', key: 'k', value: 'v', source: SOURCE.USER_STATED, confidence: 0.7, reason: 'r' }, 'account-a'));
t('M7-১০. an unknown kind, source, or empty field is rejected',
  makeMemory({ kind: 'chatlog', key: 'k', value: 'v', source: SOURCE.USER_STATED, confidence: 0.9, reason: 'r' }, 'account-a') === null
  && makeMemory({ kind: 'studies', key: 'k', value: 'v', source: 'telepathy', confidence: 0.9, reason: 'r' }, 'account-a') === null
  && makeMemory({ kind: 'studies', key: '', value: 'v', source: SOURCE.USER_STATED, confidence: 0.9, reason: 'r' }, 'account-a') === null);
t('M7-১১. a PII-bearing value or reason cannot become a memory',
  makeMemory({ kind: 'studies', key: 'k', value: 'a@b.com', source: SOURCE.USER_STATED, confidence: 0.9, reason: 'r' }, 'account-a') === null
  && makeMemory({ kind: 'studies', key: 'k', value: 'v', source: SOURCE.USER_STATED, confidence: 0.9, reason: '01712345678' }, 'account-a') === null);

/* ── ৫. Merge, isolation and rendering ── */
const recA = () => makeMemory({ kind: KIND.STUDIES, key: 'weak-topic', value: 'পদার্থবিজ্ঞান', source: SOURCE.AI_INFERRED, confidence: 0.8, reason: 'কথা থেকে' }, 'account-a');
t('M7-১২. the same kind+key replaces rather than duplicates',
  (() => {
    let list = upsertMemory([], recA(), 'account-a');
    list = upsertMemory(list, makeMemory({ kind: KIND.STUDIES, key: 'weak-topic', value: 'রসায়ন', source: SOURCE.AI_INFERRED, confidence: 0.8, reason: 'x' }, 'account-a'), 'account-a');
    return list.length === 1 && list[0].value === 'রসায়ন';
  })());
t('M7-১৩. upsert drops a record that belongs to someone else', (() => {
  const foreign = makeMemory({ kind: KIND.STUDIES, key: 'k', value: 'v', source: SOURCE.USER_STATED, confidence: 0.9, reason: 'r' }, 'account-b');
  return upsertMemory([foreign], null, 'account-a').length === 0
    && upsertMemory([foreign], recA(), 'account-a').length === 1;
})());
t('M7-১৪. parseMemory keeps only the caller\x27s clean records',
  (() => {
    const raw = JSON.stringify([recA(), makeMemory({ kind: KIND.STUDIES, key: 'k', value: 'v', source: SOURCE.USER_STATED, confidence: 0.9, reason: 'r' }, 'account-b')]);
    return parseMemory(raw, 'account-a').length === 1 && parseMemory(raw, 'account-b').length === 1
      && parseMemory('not json', 'account-a').length === 0
      && parseMemory(raw, 'guest-x').length === 0;
  })());
t('M7-১৫. guardMemoryRecord blocks a foreign, unknown-kind or PII record',
  guardMemoryRecord(recA(), 'account-a').ok === true
  && guardMemoryRecord(recA(), 'account-b').reason === 'owner-mismatch'
  && guardMemoryRecord(recA(), 'guest-x').reason === 'no-owner-identity'
  && guardMemoryRecord({ kind: 'nope', ownerUid: 'account-a' }, 'account-a').reason === 'unknown-kind'
  && guardMemoryRecord({ kind: 'studies', ownerUid: 'account-a', value: 'a@b.com', reason: 'r' }, 'account-a').reason === 'pii-detected');
t('M7-১৬. storage is bounded and empty memory renders nothing',
  MAX_RECORDS >= 1 && renderMemory([], MEMORY_VERSION) === '' && (() => {
    let list = [];
    for (let i = 0; i < MAX_RECORDS + 25; i++) {
      list = upsertMemory(list, makeMemory({ kind: KIND.HABIT, key: 'slot-' + i, value: 'স্লট ' + i, source: SOURCE.AI_INFERRED, confidence: 0.75, reason: 'r' }, 'account-a'), 'account-a');
    }
    return list.length === MAX_RECORDS;
  })());

/* ── ৬. Extraction: both triggers the owner asked for ── */
t('M7-১৭. an explicit "মনে রাখো" is recognised',
  isRetentionRequest('মনে রাখো, আমি পদার্থবিজ্ঞানে দুর্বল') && isRetentionRequest('remember this') && !isRetentionRequest('আজকের আবহাওয়া কেমন'));
t('M7-১৮. a weak topic stated in passing is captured without any prompt',
  (() => {
    const c = extractMemoryCandidates('আমি ফিজিক্সে দুর্বল');
    return c.length === 1 && c[0].kind === KIND.STUDIES && c[0].value.includes('ফিজিক্স') && c[0].source === SOURCE.AI_INFERRED;
  })());
t('M7-১৯. explicit retention raises the source and the confidence',
  (() => {
    const c = extractMemoryCandidates('মনে রাখো, আমি পদার্থবিজ্ঞানে দুর্বল');
    return c[0].source === SOURCE.USER_STATED && c[0].confidence >= 0.8 && c[0].value.includes('পদার্থবিজ্ঞান');
  })());
t('M7-২০. goal, habit and answer-style produce typed candidates',
  (() => {
    const goal = extractMemoryCandidates('আমার লক্ষ্য বুয়েটে ভর্তি');
    const habit = extractMemoryCandidates('আমি রাতে পড়াশোনা করি');
    const pref = extractMemoryCandidates('উত্তর ছোট করে দিও');
    return goal[0]?.kind === KIND.STUDIES && goal[0].value.includes('বুয়েটে')
      && habit[0]?.kind === KIND.HABIT && pref[0]?.kind === KIND.PREFERENCE;
  })());
t('M7-২১. an unrelated message yields no candidate', extractMemoryCandidates('আজকের আবহাওয়া কেমন').length === 0);
t('M7-২২. the retention phrase and filler words never leak into a value',
  (() => {
    const v = extractMemoryCandidates('মনে রাখো, আমি পদার্থবিজ্ঞানে দুর্বল')[0].value;
    return !v.includes('মনে') && !v.includes('রাখো') && !v.includes('আমি');
  })());

/* ── ৭. Wiring: account-only, automatic, no toggle ── */
t('M7-২৩. a guest is refused before any processing (chat + non-stream)',
  AGENT_SRC.includes("!sendCtx.uid.startsWith('account-')") && AGENT_SRC.includes("error: 'sign_in_required'"));
t('M7-২৪. memory is automatic — no preference can switch it off',
  !AGENT_SRC.includes('aiPrefs.memory') && !AGENT_SRC.includes('memory: true') && AGENT_SRC.includes('const memoryOn = persistMemory;'));
t('M7-২৫. the long-term store is keyed by mem-v1 plus the account uid',
  AGENT_SRC.includes("'mem:' + MEMORY_VERSION + ':' + sendCtx.uid"));
t('M7-২৬. the stored memory is rendered into the prompt, and external keys never leak',
  (() => {
    const rendered = renderMemory([recA()], MEMORY_VERSION);
    return rendered.includes('LONG-TERM MEMORY') && rendered.includes('পদার্থবিজ্ঞান')
      && !rendered.includes('ownerUid') && !rendered.includes('account-a');
  })());
t('M7-২৭. the prompt base is untouched by M7 (hash unchanged)',
  createHash('sha256').update(A.buildSystemPrompt({})).digest('hex')
  === 'e0f49e242fe3b4f342afdccf4cdcd40c36054d2310181dcf86b337982edb500f');
t('M7-২৮. agentStatus advertises memory metadata only',
  AGENT_SRC.includes("memory: { version: MEMORY_VERSION, mode: 'auto', scope: 'account-only' }"));

/* ── ৮. End-to-end through agentChat (mocked provider, no live call) ── */
function stubEnv(over = {}) {
  const store = new Map();
  const kv = { get: async (k) => store.has(k) ? store.get(k) : null, put: async (k, v) => { store.set(k, v); } };
  return { env: { PUB_KV: kv, GEMINI_KEYS: 'k1', GROQ_API_KEY: 'g1', AGENT_DAILY_CAP: 50, ...over }, store };
}
const sseRes = (text) => new Response(new ReadableStream({
  start(c) { c.enqueue(new TextEncoder().encode('data: ' + JSON.stringify({ candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }] }) + '\n\n')); c.close(); }
}), { status: 200 });
function fakeFetch(responder) {
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init) => String(url).includes('streamGenerateContent') ? responder(url, init) : new Response('nf', { status: 404 });
  return () => { globalThis.fetch = real; };
}

{
  await new Promise(r => setTimeout(r, 100));
  const { env, store } = stubEnv();
  let captured = '';
  const restore = fakeFetch((url, init) => { captured = String(init.body || ''); return sseRes('বুঝেছি'); });
  const res = await A.agentChat(new Request('https://x/api/ai/chat', { method: 'POST', body: JSON.stringify({ messages: [{ role: 'user', content: 'মনে রাখো, আমি ফিজিক্সে দুর্বল' }] }) }), env, 'account-mem1');
  await res.text();
  restore();
  const memKey = [...store.keys()].find(k => k.startsWith('mem:mem-v1:account-mem1'));
  t('M7-২৯. E2E: a stated fact is stored under the caller\x27s own key',
    res.status === 200 && !!memKey && String(store.get(memKey)).includes('ফিজিক্স'));
  t('M7-৩০. E2E: the stored fact belongs to the caller and is PII-free',
    parseMemory(store.get(memKey), 'account-mem1').every(r => r.ownerUid === 'account-mem1' && M.isPiiFree(r.value)));

  // A later chat receives the stored memory in its prompt.
  let captured2 = '';
  const restore2 = fakeFetch((url, init) => { captured2 = String(init.body || ''); return sseRes('ঠিক আছে'); });
  const res2 = await A.agentChat(new Request('https://x/api/ai/chat', { method: 'POST', body: JSON.stringify({ messages: [{ role: 'user', content: 'আমাকে আরেকটা উদাহরণ দাও' }] }) }), env, 'account-mem1');
  await res2.text();
  restore2();
  t('M7-৩১. E2E: a follow-up prompt carries the long-term memory block',
    captured2.includes('LONG-TERM MEMORY') && captured2.includes('ফিজিক্স'));

  // Another account must not see it.
  const { env: env2 } = stubEnv();
  let captured3 = '';
  const restore3 = fakeFetch((url, init) => { captured3 = String(init.body || ''); return sseRes('হ্যালো'); });
  const res3 = await A.agentChat(new Request('https://x/api/ai/chat', { method: 'POST', body: JSON.stringify({ messages: [{ role: 'user', content: 'আমাকে আরেকটা উদাহরণ দাও' }] }) }), env2, 'account-other');
  await res3.text();
  restore3();
  t('M7-৩২. E2E: another account never receives a foreign memory',
    res3.status === 200 && !captured3.includes('LONG-TERM MEMORY') && !captured3.includes('ফিজিক্স'));

  // A guest is refused outright.
  const { env: env3, store: store3 } = stubEnv();
  const res4 = await A.agentChat(new Request('https://x/api/ai/chat', { method: 'POST', body: JSON.stringify({ messages: [{ role: 'user', content: 'হ্যালো' }] }) }), env3, 'guest-abc');
  t('M7-৩৩. E2E: a guest chat is refused and writes nothing at all',
    res4.status === 401 && store3.size === 0);
}

console.log(`\n🧠 PHASE9-M7-MEMORY-ENGINE: ${pass} pass / ${fail} fail`);
process.exit(fail ? 1 : 0);