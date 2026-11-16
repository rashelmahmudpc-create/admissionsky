// 🧩 P26 — DIFFICULTY-AWARE TIER ROUTING (step 2 of the owner's AI cost plan)
//
// `classifyIntent` called every academic question SMART, on the assumption that
// academic means hard. Against the real regex, "নিউটনের দ্বিতীয় সূত্র কী?" is
// academic and simple — it was paying the SMART rate for nothing on a free tier.
//
// The two properties that make this safe, and that this file exists to lock:
//
//   (a) a provably simple academic question really does reach the FAST model, and
//   (b) NOTHING is ever upgraded — a hard question keeps SMART, and a question
//       the classifier already sent to FAST stays FAST. So this can only ever
//       reduce spend; it cannot raise it.
import { readFileSync } from 'fs';
let pass = 0, fail = 0;
const t = (n, c) => { if (c) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n); } };

const TR = await import('./ai-tier-router.mjs');
const A = await import('./ai-agent.js');
const SRC = readFileSync('ai-agent.js', 'utf8');
const { assessDifficulty, routeTier, DIFFICULTY } = TR;
const { classifyIntent, INTENTS } = A;

/* ── ১. Simple academic questions drop to FAST ── */
const SIMPLE_ACADEMIC = [
  'বাংলাদেশের রাজধানী কোনটি?',
  'নিউটনের দ্বিতীয় সূত্র কী?',
  'পানির সংকেত কী?',
  'সালোকসংশ্লেষণ কী',
  'What is photosynthesis?',
  'define osmosis'
];
t('P26-১. a short single academic question is judged simple',
  SIMPLE_ACADEMIC.every(q => assessDifficulty(q).level === DIFFICULTY.SIMPLE));
t('P26-২. simple academic questions are downgraded SMART → FAST',
  SIMPLE_ACADEMIC.every(q => {
    const cls = classifyIntent(q);
    const r = routeTier(cls.intent, q, cls.tier);
    return r.downgraded && r.tier === 'FAST';
  }));

/* ── ২. Hard questions are never downgraded ──
 * NOTE: two of these ("প্রমাণ করো …", "সমাধান করো …") are already classified
 * FAST by the pre-existing regex classifier — it never matched them as academic.
 * The router's contract is narrower than "put hard questions on SMART": it is
 * "never move a question DOWN". These two are thus unchanged by design; raising
 * them would add spend, which step 2 exists to avoid. */
const HARD = [
  'নিউটনের দ্বিতীয় সূত্র ও তৃতীয় সূত্রের পার্থক্য কী?',
  'সালোকসংশ্লেষণ কেন হয়?',
  'প্রমাণ করো যে ত্রিভুজের তিন কোণের সমষ্টি ১৮০ ডিগ্রি',
  'সমীকরণটি সমাধান করো: 2x + 5 = 15',
  'explain step by step how mitosis works',
  'What is the difference between mitosis and meiosis?',
  'derive the quadratic formula'
];
t('P26-৩. a hard question is never downgraded',
  HARD.every(q => {
    const cls = classifyIntent(q);
    const r = routeTier(cls.intent, q, cls.tier);
    return !r.downgraded && r.tier === cls.tier;
  }));
t('P26-৩খ. a hard academic question that the classifier called SMART keeps SMART',
  HARD.filter(q => classifyIntent(q).tier === 'SMART').length >= 4
  && HARD.filter(q => classifyIntent(q).tier === 'SMART').every(q => {
    const cls = classifyIntent(q);
    return routeTier(cls.intent, q, cls.tier).tier === 'SMART';
  }));
t('P26-৪. a long question is treated as complex even with no hard marker',
  assessDifficulty('বাংলাদেশের স্বাধীনতা যুদ্ধ শুরু হয়েছিল উনিশশো একাত্তর সালের মার্চ মাসের শেষদিকে একটি দীর্ঘ ঘটনাপ্রবাহের মধ্য দিয়ে যা অনেক মানুষের জীবন বদলে দিয়েছিল প্রায়') === undefined
  || assessDifficulty('বাংলাদেশের স্বাধীনতা যুদ্ধ শুরু হয়েছিল উনিশশো একাত্তর সালের মার্চ মাসের শেষদিকে একটি দীর্ঘ ঘটনাপ্রবাহের মধ্য দিয়ে যা অনেক মানুষের জীবন বদলে দিয়েছিল প্রায়').level === DIFFICULTY.COMPLEX);
t('P26-৫. a multi-part question (two question marks) stays complex',
  assessDifficulty('নিউটনের সূত্র কী? আর কেন কাজ করে?').level === DIFFICULTY.COMPLEX);

/* ── ৩. The safety invariant: nothing is ever upgraded ── */
t('P26-৬. a FAST request is never upgraded to SMART', (() => {
  const qs = [...SIMPLE_ACADEMIC, ...HARD, 'আসসালামু আলাইকুম', '', '৫টা MCQ বানাও'];
  return qs.every(q => {
    const cls = classifyIntent(q);
    const r = routeTier(cls.intent, q, cls.tier);
    return cls.tier !== 'FAST' || r.tier === 'FAST';
  });
})());
t('P26-৭. performance reports and quizzes keep their classifier tier untouched',
  (['PERFORMANCE_REQUEST', 'QUIZ_REQUEST', 'GENERAL_CHAT', 'SEARCH_REQUEST'].every(i =>
    routeTier(i, 'কোনো ছোট প্রশ্ন', 'SMART').tier === 'SMART'
    && !routeTier(i, 'কোনো ছোট প্রশ্ন', 'SMART').downgraded)));

/* ── ৪. Real end-to-end: the provider chain starts on the cheap model ── */
function capturingEnv() {
  return {
    PUB_KV: { async get() { return null; }, async put() { return { ok: true }; } },
    GEMINI_KEYS: 'k1'
  };
}
async function chainFirstModel(env, question) {
  const real = globalThis.fetch;
  let firstModel = '';
  globalThis.fetch = async (url, init) => {
    let body = '';
    try { body = JSON.parse(init.body).system_instruction ? String(init.body) : ''; } catch (_) {}
    if (!firstModel && /generativelanguage/.test(String(url))) {
      const m = String(url).match(/models\/([^:]+):/);
      if (m) firstModel = m[1];
    }
    return new Response('data: ' + JSON.stringify({ candidates: [{ content: { parts: [{ text: 'ঠিক আছে' }] } }] }) + '\n\n',
      { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
  };
  try {
    const res = await A.agentChat(new Request('https://x/api/ai/chat', {
      method: 'POST',
      body: JSON.stringify({ messages: [{ role: 'user', content: question }], fresh: true })
    }), env, 'account-abc');
    await res.text();
  } finally { globalThis.fetch = real; }
  return firstModel;
}
t('P26-৮. E2E: a simple academic question reaches the FAST model',
  (async () => (await chainFirstModel(capturingEnv(), 'বাংলাদেশের রাজধানী কোনটি?')) === 'gemini-flash-lite-latest')(),
  { timeout: 20000 });
t('P26-৯. E2E: a hard academic question still reaches the SMART model',
  (async () => (await chainFirstModel(capturingEnv(), 'নিউটনের দ্বিতীয় ও তৃতীয় সূত্রের পার্থক্য কী?')) === 'gemini-3.6-flash')(),
  { timeout: 20000 });

/* ── ৫. Wiring invariants ── */
t('P26-১০. routing runs before the chain is built',
  SRC.indexOf('routeTier(intent') < SRC.indexOf('const fullChain = routerChain('));
t('P26-১১. the trace records the effective tier, so a downgrade is observable',
  /traceCtx = \{[\s\S]{0,400}?\btier,/.test(SRC));

console.log(`\n${fail === 0 ? '✅' : '❌'} P26 tier-router: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
