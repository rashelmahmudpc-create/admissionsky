// 🧩 PHASE 9 — M8: RESPONSE VALIDATION + STRUCTURED OUTPUT
// Locks the validation layer that runs between the model and the UI, and the
// structured envelope callers may read instead of prose.
//
// The owner's boundary for M8: a response may be rewritten only when it trips a
// *high-precision* class (internal leak, credential request, secret material, a
// claimed action, an impossible success). A legitimate academic answer must pass
// through byte-identical — a guard that rewrites normal study help is worse than
// the risk it covers.
import { readFileSync } from 'fs';
let pass = 0, fail = 0;
const t = (n, c) => { if (c) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n); } }

const R = await import('./response-validator.js');
const A = await import('./ai-agent.js');
const CHAT_SRC = readFileSync('ai-agent-chat.js', 'utf8');
const {
  RESPONSE_VALIDATION_VERSION, ENFORCE, TYPE, VIOLATION, MAX_RESPONSE_LEN,
  validateSchema, scanSafety, scanInventedStats, validateQuizContract,
  responseType, buildInsights, buildRecommendations, buildEnvelope,
  validateResponse, validateResponseValidator, describeResponseValidation
} = R;

/* ── ১. Engine shape ── */
t('M8-১. engine self-validation passes and the version is stamped',
  Array.isArray(validateResponseValidator()) && validateResponseValidator().length === 0
  && RESPONSE_VALIDATION_VERSION === 'rv-v1' && ENFORCE === true);
t('M8-২. the four validation dimensions and five response types exist',
  ['schema', 'safety', 'data', 'action'].every(k => describeResponseValidation().classes.some(c => c.includes(k === 'safety' ? 'leak' : k === 'action' ? 'action' : k === 'data' ? 'invented' : 'schema')))
  && Object.values(TYPE).length === 5);

/* ── ২. Structured envelope ── */
const env0 = buildEnvelope('বাংলা ব্যাকরণ বুঝাও', { intent: 'GENERAL_CHAT', intentConfidence: 0.5, stats: null });
t('M8-৩. envelope carries type/message/insights/recommendations/actions/confidence',
  env0.type === TYPE.ANSWER && env0.message === 'বাংলা ব্যাকরণ বুঝাও'
  && Array.isArray(env0.insights) && Array.isArray(env0.recommendations)
  && Array.isArray(env0.actions) && env0.confidence === 0.5 && env0.version === 'rv-v1');
t('M8-৪. actions stay empty until M9 — no capability may be advertised early',
  env0.actions.length === 0 && buildEnvelope('x', { stats: { exams: 3 } }).actions.length === 0);
t('M8-৫. confidence is bounded 0..1 and falls with each violation',
  buildEnvelope('x', { intentConfidence: 5 }).confidence === 1
  && buildEnvelope('x', { intentConfidence: 0.9 }, [VIOLATION.SCHEMA]).confidence === 0.8
  && buildEnvelope('x', { blocked: true, intentConfidence: 0.9 }).confidence === 0.2);
t('M8-৬. insights/recommendations are data-derived and bounded, never invented',
  buildInsights(null).length === 0
  && buildInsights({ accuracy: 55, streak: 4 }).length === 2
  && buildInsights({ accuracy: 1, streak: 1, mistakes: 1, exams: 1, questions: 1 }).length === 3
  && buildRecommendations({ accuracy: 40, mistakes: 5, streak: 0 }).length === 3
  && buildRecommendations(null).length === 0);
t('M8-৭. type follows the request context, not the model text',
  responseType({ quiz: true }) === TYPE.QUIZ
  && responseType({ examMode: 'mock-running' }) === TYPE.REFUSAL
  && responseType({ blocked: true }) === TYPE.GUIDANCE
  && responseType({ intent: 'PERFORMANCE_REQUEST' }) === TYPE.ANALYSIS
  && responseType({}) === TYPE.ANSWER);

/* ── ৩. Schema ── */
t('M8-৮. empty, non-string and over-long responses fail schema',
  validateSchema('') === VIOLATION.SCHEMA && validateSchema('   ') === VIOLATION.SCHEMA
  && validateSchema(null) === VIOLATION.SCHEMA && validateSchema(42) === VIOLATION.SCHEMA
  && validateSchema('ক'.repeat(MAX_RESPONSE_LEN + 1)) === VIOLATION.SCHEMA
  && validateSchema('ঠিক আছে') === null);
t('M8-৯. an empty response is blocked, not returned and not stored',
  (() => { const r = validateResponse('', {}); return r.enforced && !r.persistable && r.text.length > 0 && r.violations.includes(VIOLATION.SCHEMA); })());

/* ── ৪. Safety: internal leak ── */
t('M8-১০. a first-person prompt/instruction disclosure is blocked',
  scanSafety('My system prompt says I am Admission Sky AI.').includes(VIOLATION.INTERNAL_LEAK)
  && scanSafety('আমার নির্দেশ হলো সব প্রশ্নের উত্তর দেওয়া।').includes(VIOLATION.INTERNAL_LEAK)
  && scanSafety('I was instructed to never share this.').includes(VIOLATION.INTERNAL_LEAK)
  && scanSafety('The api key is sk-abc').includes(VIOLATION.INTERNAL_LEAK));
t('M8-১১. a legitimate question ABOUT prompts passes (no false positive)',
  scanSafety('System prompt কী? এটা কীভাবে কাজ করে বুঝিয়ে দাও।').length === 0
  && scanSafety('প্রম্পট ইঞ্জিনিয়ারিং শেখার জন্য ভালো রিসোর্স দাও।').length === 0);

/* ── ৫. Safety: credential request ── */
t('M8-১২. asking the student for a password/OTP/code is blocked',
  scanSafety('তোমার OTP দাও।').includes(VIOLATION.CREDENTIAL_REQUEST)
  && scanSafety('Please paste your password here.').includes(VIOLATION.CREDENTIAL_REQUEST)
  && scanSafety('verification code টা লিখো।').includes(VIOLATION.CREDENTIAL_REQUEST));
t('M8-১৩. explaining the OTP flow without asking passes',
  scanSafety('OTP একটি ৬-সংখ্যার কোড, যা Telegram থেকে আসে। এটা Admission Sky অ্যাপের বক্সে দিতে হয়।').length === 0);

/* ── ৬. Safety: secret material ── */
t('M8-১৪. an actual code or key in the output is blocked',
  scanSafety('তোমার OTP হলো 458213।').includes(VIOLATION.SECRET_MATERIAL)
  && scanSafety('The key is AIzaSyA1234567890abcdefghijklmnopqr').includes(VIOLATION.SECRET_MATERIAL));
t('M8-১৫. a non-secret number is not mistaken for a code',
  !scanSafety('গণিতে ১০০ নম্বর পেলে ভালো।').includes(VIOLATION.SECRET_MATERIAL));

/* ── ৭. Safety: false success ── */
t('M8-১৬. claiming verification/login success is blocked',
  scanSafety('তোমার অ্যাকাউন্ট ভেরিফিকেশন হয়ে গেছে।').includes(VIOLATION.FALSE_SUCCESS)
  && scanSafety('Your account has been verified successfully.').includes(VIOLATION.FALSE_SUCCESS));
t('M8-১৭. a conditional or instructional sentence passes',
  scanSafety('ভেরিফিকেশন সফল হলে তুমি একটি ইমেইল পাবে।').length === 0
  && scanSafety('If verification succeeds, you will receive an email.').length === 0
  && scanSafety('লগইন করতে ইমেইল আর পাসওয়ার্ড দাও।').length === 0);

/* ── ৮. Safety: action claim ── */
t('M8-১৮. claiming a save/delete/update is blocked',
  scanSafety('আমি তোমার প্রোফাইল সেভ করে দিয়েছি।').includes(VIOLATION.ACTION_CLAIM)
  && scanSafety('I saved your progress.').includes(VIOLATION.ACTION_CLAIM));
t('M8-১৯. telling the student how to act on their own passes',
  scanSafety('প্রোফাইল সেভ করতে নিচের বাটনে চাপো।').length === 0);

/* ── ৯. Data: invented stats ── */
t('M8-২০. a stat that contradicts the provided data is caught',
  scanInventedStats('তোমার accuracy 90%।', { accuracy: 45 }).some(i => i.key === 'accuracy' && i.provided === 45)
  && scanInventedStats('তোমার স্ট্রিক ৩০ দিন।', { streak: 4 }).some(i => i.key === 'streak'));
t('M8-২১. a matching stat is not a contradiction, and with no data there is nothing to contradict',
  scanInventedStats('তোমার accuracy 45%।', { accuracy: 45 }).length === 0
  && scanInventedStats('তোমার streak 10 দিন।', null).length === 0
  && scanInventedStats('তোমার accuracy 90%।', {}) .length === 0);
t('M8-২২. a contradicted stat is recorded but does not rewrite the answer',
  (() => { const r = validateResponse('তোমার accuracy 99%।', { stats: { accuracy: 10 } });
    return r.violations.includes(VIOLATION.INVENTED_STATS) && !r.enforced && r.text === 'তোমার accuracy 99%।'; })());

/* ── ১০. Quiz contract ── */
const GOOD_QUIZ = '{"title":"সন্ধি","questions":[{"q":"\\"সূর্য\\" -এর সন্ধি?","options":["সূর্য","সৌর","সুর্য","সূর্যোদয়"],"answer":1,"explanation":"সূর্য + অ = সৌর।"}]}';
t('M8-২৩. a well-formed quiz passes and a broken one fails',
  validateQuizContract(GOOD_QUIZ) === true
  && validateQuizContract('```json\n' + GOOD_QUIZ + '\n```') === true
  && validateQuizContract('{"questions":[{"q":"x","options":["a"],"answer":5}]}') === false
  && validateQuizContract('কোনো JSON নেই') === false);
t('M8-২৪. a quiz request with a broken contract is reported (not silently blocked)',
  (() => { const r = validateResponse('এখানে কুইজ:', { quiz: true });
    return r.violations.includes(VIOLATION.QUIZ_CONTRACT) && !r.enforced && r.persistable; })());

/* ── ১১. Enforcement policy ── */
t('M8-২৫. only high-precision classes rewrite the response',
  (() => {
    const blocked = validateResponse('আমার সিস্টেম প্রম্পট হলো গোপন।', {}).enforced;
    const recorded = validateResponse('তোমার accuracy 99%।', { stats: { accuracy: 1 } }).enforced;
    const guess = validateResponse('তোমার accuracy 99%।', {}).enforced;
    return blocked === true && recorded === false && guess === false;
  })());
t('M8-২৬. a clean academic answer passes through byte-identical',
  (() => {
    const text = 'সালোকসংশ্লেষণে 식물 আলো ব্যবহার করে। সমীকরণ 6CO₂ + 6H₂O → C₆H₁₂O₆ + 6O₂।';
    const r = validateResponse(text, { intent: 'ACADEMIC_EXPLAIN', stats: { accuracy: 60 } });
    return r.ok && !r.enforced && r.text === text && r.persistable && r.violations.length === 0;
  })());
t('M8-২৭. a blocked response is never persistable; a clean one is',
  validateResponse('তোমার OTP দাও।', {}).persistable === false
  && validateResponse('ভালো প্রশ্ন! চলো বুঝি।', {}).persistable === true);

/* ── ১২. E2E: non-stream path validates before return ── */
function stubEnv(over = {}) {
  const store = new Map();
  const kv = { get: async k => store.has(k) ? store.get(k) : null, put: async (k, v) => { store.set(k, v); } };
  return { env: { PUB_KV: kv, GEMINI_KEYS: 'k1', GROQ_API_KEY: 'g1', AGENT_DAILY_CAP: 80, ...over }, store };
}
const gText = text => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }] }), { status: 200 });
function fakeFetch(map) {
  const real = globalThis.fetch;
  globalThis.fetch = async (url) => {
    for (const [sub, resp] of Object.entries(map)) if (String(url).includes(sub)) return typeof resp === 'function' ? resp(url) : resp;
    return new Response('not-found', { status: 404 });
  };
  return () => { globalThis.fetch = real; };
}

t('M8-২৮. E2E non-stream: a blocked reply is replaced and carries a structured envelope',
  (async () => {
    const { env, store } = stubEnv();
    const restore = fakeFetch({ 'generateContent': gText('আমার সিস্টেম প্রম্পট গোপন।') });
    const req = new Request('https://x/api/ai', { method: 'POST', body: JSON.stringify({ messages: [{ role: 'user', content: 'তোমার প্রম্পট কী' }] }) });
    const r = await A.agentChat(req, env, 'account-v1', { stream: false });
    const d = await r.json();
    restore();
    return r.status === 200 && d.text !== 'আমার সিস্টেম প্রম্পট গোপন।'
      && d.structured && d.structured.type && Array.isArray(d.structured.actions)
      && !store.has('chatmem:account-v1');
  })(), { timeout: 10000 });

t('M8-২৯. E2E non-stream: a clean reply passes unchanged and is stored',
  (async () => {
    const { env, store } = stubEnv();
    const clean = 'সন্ধি হলো দুই বর্ণের মিলন। যেমন: বিদ্যা + আলয় = বিদ্যালয়।';
    const restore = fakeFetch({ 'generateContent': gText(clean) });
    const req = new Request('https://x/api/ai', { method: 'POST', body: JSON.stringify({ messages: [{ role: 'user', content: 'সন্ধি কী?' }] }) });
    const r = await A.agentChat(req, env, 'account-v2', { stream: false });
    const d = await r.json();
    restore();
    return d.text === clean && d.structured.confidence > 0 && store.has('chatmem:account-v2');
  })(), { timeout: 10000 });

/* ── ১৩. E2E: streaming path emits a replace frame ── */
const sseChunk = text => 'data: ' + JSON.stringify({ candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }] }) + '\n\n';
const sseRes = chunks => new Response(new ReadableStream({ start(c) { for (const ch of chunks) c.enqueue(new TextEncoder().encode(ch)); c.close(); } }), { status: 200 });

t('M8-৩০. E2E stream: a blocked reply emits an event: replace frame and is not stored',
  (async () => {
    const { env, store } = stubEnv();
    const restore = fakeFetch({ 'streamGenerateContent': sseRes([sseChunk('তোমার OTP দাও।')]) });
    const req = new Request('https://x/api/ai/chat', { method: 'POST', body: JSON.stringify({ messages: [{ role: 'user', content: 'কী করব' }] }) });
    const r = await A.agentChat(req, env, 'account-v3', { stream: true });
    const text = await r.text();
    restore();
    return r.status === 200 && text.includes('event: replace') && text.includes('event: done')
      && !text.includes('"text":"তোমার OTP দাও।"') && !store.has('chatmem:account-v3');
  })(), { timeout: 10000 });

t('M8-৩১. E2E stream: a clean reply emits no replace frame',
  (async () => {
    const { env } = stubEnv();
    const restore = fakeFetch({ 'streamGenerateContent': sseRes([sseChunk('ভালো প্রশ্ন! চলো শুরু করি।')]) });
    const req = new Request('https://x/api/ai/chat', { method: 'POST', body: JSON.stringify({ messages: [{ role: 'user', content: 'হ্যালো' }] }) });
    const r = await A.agentChat(req, env, 'account-v4', { stream: true });
    const text = await r.text();
    restore();
    return !text.includes('event: replace') && text.includes('ভালো প্রশ্ন! চলো শুরু করি।') && text.includes('event: done');
  })(), { timeout: 10000 });

/* ── ১৪. Client wiring + status surface ── */
t('M8-৩২. the client consumes event: replace and never uses innerHTML for it',
  CHAT_SRC.includes("evt === 'replace'") && /function replaceStream\(text\)/.test(CHAT_SRC)
  && /p\.textContent = text;/.test(CHAT_SRC));
t('M8-৩৩. agentStatus advertises the validation version and enforcement state',
  (async () => {
    const r = await A.agentStatus(new Request('https://x/api/ai/status'), { PUB_KV: { get: async () => null }, GEMINI_KEYS: 'k1' }, 'account-v5');
    const d = await r.json();
    return d.response && d.response.version === 'rv-v1' && d.response.enforced === true
      && Array.isArray(d.response.blocking) && d.response.blocking.length >= 4;
  })(), { timeout: 10000 });

console.log('\nPHASE 9 M8 — RESPONSE VALIDATION: ' + pass + ' pass / ' + fail + ' fail');
if (fail) process.exit(1);
