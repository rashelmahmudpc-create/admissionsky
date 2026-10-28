/* AdmissionSky, agent phase 1: tool runner + server tools (owner 2026-10-17).
 *
 * Limits for one question: at most 5 tools, at most 3 steps, 20 s in total and
 * 3 s per tool. A failing or slow tool never stops the answer; it is reported
 * as not done and the rest goes on. Every tool here is READ-only and works on
 * the caller's own data only (stats the student's own app sent with this
 * request), no argument may name another user.
 *
 * Server tools: get_exam_history, analyze_weak_topics, get_app_features,
 * calculate. The other five (search_question_bank, make_quiz, grade_quiz,
 * knowledge_lookup, open_page) need data that lives on the student's device,
 * so they run in the app (sky-tools-client.js) without a server call.
 *
 * Kill switch without a deploy: PUB_KV 'sky:agent-tools' = "off".
 *
 * web_search (owner 2026-10-18): Tavily, server only. Runs only for a news /
 * recent-facts question, has a daily cap (env.TAVILY_DAILY_CAP, default 50),
 * sends only the cleaned question text (no name, stats, email, phone or id),
 * and the answer must cite the source links. Off: PUB_KV 'sky:web-search' = "off".
 */
import { loadAppFeatures, renderAppFeatures, isAppFeatureQuestion } from './sky-app-features.mjs';
import { isNewsQuestion, cleanSearchQuery, webSearch, renderSearchContext } from './sky-web-search.mjs';
import { searchQueryFor, renderSearchFailure } from './sky-web-search.mjs';
export { searchQueryFor, renderSearchFailure } from './sky-web-search.mjs';
export { isNewsQuestion, cleanSearchQuery, webSearch, renderSearchContext, takeSearchQuota, SEARCH_KV_SWITCH, SEARCH_DAILY_DEFAULT } from './sky-web-search.mjs';

import { isTimeQuestion, getDateTime, renderDateTime } from './sky-time.mjs';
export { isTimeQuestion, getDateTime, nowLine } from './sky-time.mjs';
export const SKY_TOOLS_VERSION = 'sky-tools-v1';
export const TOOLS_KV_SWITCH = 'sky:agent-tools';
export const LIMITS = Object.freeze({ maxTools: 5, maxSteps: 3, budgetMs: 20000, perToolMs: 3000 });

export const TOOL_NAMES = Object.freeze([
  'get_exam_history', 'analyze_weak_topics', 'search_question_bank', 'make_quiz', 'grade_quiz',
  'get_app_features', 'knowledge_lookup', 'calculate', 'open_page', 'web_search', 'get_datetime'
]);
export const CLIENT_TOOLS = Object.freeze(['search_question_bank', 'make_quiz', 'grade_quiz', 'knowledge_lookup', 'open_page']);

export const TOOL_LABELS = Object.freeze({
  get_exam_history: 'তোমার পরীক্ষার ইতিহাস দেখছি',
  analyze_weak_topics: 'তোমার দুর্বল টপিক খুঁজছি',
  get_app_features: 'অ্যাপের ফিচার তালিকা দেখছি',
  calculate: 'হিসাব করছি',
  search_question_bank: 'প্রশ্নব্যাংকে খুঁজছি',
  make_quiz: 'কুইজ বানাচ্ছি',
  grade_quiz: 'তোমার উত্তর মিলিয়ে দেখছি',
  knowledge_lookup: 'জমানো জ্ঞানভান্ডারে খুঁজছি',
  open_page: 'পেজের পথ বের করছি',
  web_search: 'ওয়েবে সর্বশেষ খবর খুঁজছি',
  get_datetime: 'এখনকার সময় ও তারিখ দেখছি'
});
/* per-tool time cap override (a web call needs more than 3 s) */
const TOOL_MS = Object.freeze({ web_search: 6000 });

const BAD_ARG_KEYS = ['uid', 'owneruid', 'owner', 'userid', 'accountid', 'user', 'account', 'deviceid'];
const BN_DIGITS = '০১২৩৪৫৬৭৮৯';
export const toEnDigits = (s) => String(s == null ? '' : s).replace(/[০-৯]/g, (d) => String(BN_DIGITS.indexOf(d)));
export const toBnDigits = (s) => String(s == null ? '' : s).replace(/\d/g, (d) => BN_DIGITS[+d]);

/* ── calculate: a small safe parser (+ − × ÷ ^ % brackets, √). Never eval. ── */
export function calculate(expr) {
  let src = toEnDigits(expr).replace(/[×xX✕]/g, '*').replace(/[÷]/g, '/').replace(/−/g, '-')
    .replace(/√/g, 'r').replace(/\s+/g, '');
  if (!src || src.length > 120 || /[^0-9.+\-*/^%()r]/.test(src)) return { ok: false, error: 'bad-expression' };
  let i = 0;
  const peek = () => src[i];
  const num = () => {
    const m = /^\d+(\.\d+)?|^\.\d+/.exec(src.slice(i));
    if (!m) throw new Error('num');
    i += m[0].length; return parseFloat(m[0]);
  };
  const atom = () => {
    if (peek() === '-') { i++; return -atom(); }
    if (peek() === '+') { i++; return atom(); }
    if (peek() === 'r') { i++; const v = atom(); if (v < 0) throw new Error('neg-root'); return Math.sqrt(v); }
    if (peek() === '(') { i++; const v = add(); if (peek() !== ')') throw new Error('paren'); i++; return v; }
    let v = num();
    if (peek() === '%') { i++; v = v / 100; }
    return v;
  };
  const pow = () => { const b = atom(); if (peek() === '^') { i++; const e = pow(); if (Math.abs(e) > 64) throw new Error('big'); return Math.pow(b, e); } return b; };
  const mul = () => { let v = pow(); while (peek() === '*' || peek() === '/') { const op = src[i++]; const r = pow(); if (op === '/' && r === 0) throw new Error('div0'); v = op === '*' ? v * r : v / r; } return v; };
  const add = () => { let v = mul(); while (peek() === '+' || peek() === '-') { const op = src[i++]; const r = mul(); v = op === '+' ? v + r : v - r; } return v; };
  try {
    const v = add();
    if (i !== src.length || !isFinite(v)) return { ok: false, error: 'bad-expression' };
    const value = Math.round(v * 1e10) / 1e10;
    return { ok: true, expression: toEnDigits(expr).trim().slice(0, 120), value };
  } catch (e) {
    return { ok: false, error: e && e.message === 'div0' ? 'divide-by-zero' : 'bad-expression' };
  }
}

/* A message that is only arithmetic: "২৫×৪ কত", "what is 12*7", "(3+4)^2 = ?" */
const RE_CALC_WORDS = /(কত|হয়|হবে|সমান|হিসাব কর[োো]?|calculate|what\s+is|=|\?|？)/gi;
export function extractCalculation(text) {
  const t = String(text || '').slice(0, 200);
  const rest = t.replace(RE_CALC_WORDS, ' ').trim();
  if (!rest || !/[0-9০-৯]/.test(rest) || !/[+\-*/×÷^%√−xX]/.test(rest)) return null;
  if (/[^\s0-9০-৯.+\-*/×÷^%()√−xX✕]/.test(rest)) return null;
  if (/^\s*[0-9০-৯]{1,2}\s*[/-]\s*[0-9০-৯]{1,2}\s*[/-]\s*[0-9০-৯]{2,4}\s*$/.test(rest)) return null; // a date, not a sum
  return rest;
}

/* ── exam history / weak topics: from the student's own stats (capStats shape) ── */
export function getExamHistory(stats) {
  if (!stats || typeof stats !== 'object' || !Number(stats.exams)) return { ok: true, empty: true };
  const out = { ok: true, exams: stats.exams | 0, questions: stats.questions | 0, accuracy: stats.accuracy | 0, streak: stats.streak | 0, mistakes: stats.mistakes | 0 };
  if (stats.weekly) out.weekly = stats.weekly;
  if (stats.prevWeekly) out.prevWeekly = stats.prevWeekly;
  return out;
}
/* Sky memory fix 2026-10-18: `stated` = weak topics the student named in chat
   (long-term memory, this student only). An empty exam record no longer means
   "nothing is known", the student's own words count too. */
export function analyzeWeakTopics(stats, stated) {
  const rows = stats && Array.isArray(stats.weakTopics) ? stats.weakTopics : [];
  const said = (Array.isArray(stated) ? stated : []).map((s) => String(s || '').trim().slice(0, 80)).filter(Boolean).slice(0, 3);
  const exams = stats && Number(stats.exams) > 0 ? stats.exams | 0 : 0;
  if (!rows.length && !said.length) return { ok: true, empty: true };
  const weak = rows.slice(0, 4).map((r) => ({ name: r.name, accuracy: r.accuracy | 0, attempts: r.attempts | 0 }))
    .sort((a, b) => a.accuracy - b.accuracy);
  const out = { ok: true, weak, exams };
  if (said.length) out.stated = said;
  return out;
}

/* "সমাসে" → "সমাস", "ইংরেজিতে" → "ইংরেজি", "বাংলায়" → "বাংলা" (for "X দিয়ে শুরু করি"). */
export function topicBase(word) {
  const w = String(word || '').trim();
  if (w.length > 4 && /তে$/u.test(w)) return w.slice(0, -2);
  if (w.length > 3 && /া(?:\u09AF\u09BC|\u09DF)$/u.test(w)) return w.replace(/(?:\u09AF\u09BC|\u09DF)$/u, '');
  if (w.length > 2 && /[\u0995-\u09B9]ে$/u.test(w)) return w.slice(0, -1);
  return w;
}

function statedWeakLine(r, hi) {
  const said = r.stated.map((s) => '**' + s + '**').join(', ');
  const first = topicBase(r.stated[0]);
  const lead = r.weak.length
    ? '📝 আগে নিজেও বলেছিলে ' + said + ' দুর্বল, এটাও মাথায় রাখছি।'
    : (r.exams ? '🧠 ' + hi + 'পরীক্ষার ফলে এখনো দুর্বল টপিক ধরা পড়েনি, তবে আগে বলেছিলে ' + said + ' দুর্বল।'
      : '🧠 ' + hi + 'তুমি এখনো পরীক্ষা দাওনি, তবে আগে বলেছিলে ' + said + ' দুর্বল।');
  return r.weak.length ? lead : lead + ' আজ **' + first + '** দিয়ে শুরু করি? চাইলে বলো "' + first + ' থেকে কুইজ দাও"।';
}

/* ── planner: which tools a question needs (rule based, no model call) ── */
const RE_HISTORY = /(আমার\s*(পরীক্ষা|রেজাল্ট|ফলাফল|ফল|স্কোর|নম্বর|অগ্রগতি|প্রোগ্রেস|পারফরম্যান্স)|কয়টা পরীক্ষা|কতগুলো পরীক্ষা|কেমন করছি|কেমন চলছে|my\s*(exam|result|score|progress|performance))/i;
const RE_WEAK = /(দুর্বলতা\s*(কী|কি|কোথায়|কোনগুলো|গুলো|বলো|দেখাও)|(কোথায়|কিসে|কীসে)\s*দুর্বল|আমার\s*(দুর্বল|কম পারা)\s*(টপিক|জায়গা|অধ্যায়|বিষয়|দিক)|দুর্বল\s*(টপিক|জায়গা|অধ্যায়|বিষয়)\s*(কোন|কী|কি|বলো|দেখাও)|কোন\s*(টপিকে|অধ্যায়ে|বিষয়ে)\s*(বেশি\s*)?(ভুল|দুর্বল|কম)|my\s*weak\s*(topic|area|point)s?|which\s*topics?\s*am\s*i\s*weak)/i;
const RE_REMEMBER = /(মনে\s*রাখ|মনে\s*রেখ|remember|ভুলে যেও না)/i;

export function planServerTools(text, ctx = {}) {
  const t = String(text || '').slice(0, 600);
  const plan = [];
  if (RE_REMEMBER.test(t)) return plan;
  const expr = extractCalculation(t);
  if (expr) plan.push({ name: 'calculate', args: { expression: expr } });
  if (RE_HISTORY.test(t)) plan.push({ name: 'get_exam_history', args: {} });
  if (RE_WEAK.test(t)) plan.push({ name: 'analyze_weak_topics', args: {} });
  if (!ctx.quizMode && !ctx.hasImage && isAppFeatureQuestion(t)) plan.push({ name: 'get_app_features', args: {} });
  /* get_datetime (owner 2026-10-18): a clock/calendar question is answered from
     the live Dhaka clock and never goes to the web. */
  const timeQ = !ctx.quizMode && isTimeQuestion(t);
  if (timeQ) plan.push({ name: 'get_datetime', args: { text: t.slice(0, 200) } });
  if (!timeQ && ctx.searchOn && !ctx.quizMode && !ctx.hasImage) {
    const query = searchQueryFor(t, ctx.prevText, ctx.firstName);
    if (query) plan.push({ name: 'web_search', args: { query } });
  }
  return plan.slice(0, LIMITS.maxTools);
}

/* A plan the server can answer alone (no model, no AI limit): pure arithmetic,
   or a plain "how am I doing" with nothing else in the question. */
export function isSimplePlan(plan, text) {
  if (!plan.length || plan.length > 2) return false;
  if (RE_REMEMBER.test(String(text || ''))) return false; /* a fact to remember goes to the AI + memory */
  const names = plan.map((p) => p.name);
  if (names.length === 1 && names[0] === 'calculate') return true;
  if (names.length === 1 && names[0] === 'get_datetime') return String(text || '').trim().length <= 80;
  const short = String(text || '').trim().length <= 60;
  return short && names.every((n) => n === 'get_exam_history' || n === 'analyze_weak_topics');
}

/* ── runner ── */
const withTimeout = (p, ms) => Promise.race([p, new Promise((r) => setTimeout(() => r({ ok: false, error: 'timeout' }), ms))]);

async function execOne(call, ctx) {
  switch (call.name) {
    case 'calculate': return calculate(call.args && call.args.expression);
    case 'get_exam_history': return getExamHistory(ctx.stats);
    case 'analyze_weak_topics': return analyzeWeakTopics(ctx.stats, ctx.statedWeak);
    case 'get_app_features': return { ok: true, data: await loadAppFeatures(ctx.kv) };
    case 'get_datetime': return getDateTime(ctx.nowMs || Date.now(), call.args && call.args.text);
    case 'web_search': return webSearch(call.args && call.args.query, ctx);
    default: return { ok: false, error: CLIENT_TOOLS.includes(call.name) ? 'client-tool' : 'unknown-tool' };
  }
}

/**
 * Run a plan in at most LIMITS.maxSteps parallel steps. Each step is a list of
 * calls; extra calls beyond maxTools are dropped. onStage(id, label) is called
 * the moment a tool really starts, so the chat shows only real work.
 */
export async function runTools(steps, ctx = {}) {
  const startedAt = Date.now();
  const lim = Object.assign({}, LIMITS, ctx.limits || {});
  const list = (Array.isArray(steps) && Array.isArray(steps[0]) ? steps : [steps || []]).slice(0, lim.maxSteps);
  const results = [];
  let used = 0;
  for (const step of list) {
    const calls = [];
    for (const c of step) {
      if (used >= lim.maxTools) break;
      if (!c || !TOOL_NAMES.includes(c.name)) { results.push({ name: String(c && c.name || ''), ok: false, error: 'unknown-tool' }); continue; }
      const args = c.args && typeof c.args === 'object' ? c.args : {};
      if (Object.keys(args).some((k) => BAD_ARG_KEYS.includes(String(k).toLowerCase()))) { results.push({ name: c.name, ok: false, error: 'owner-from-args-rejected' }); continue; }
      used++; calls.push({ name: c.name, args });
    }
    const left = lim.budgetMs - (Date.now() - startedAt);
    if (left <= 0) { for (const c of calls) results.push({ name: c.name, ok: false, error: 'budget' }); break; }
    const done = await Promise.all(calls.map((c) => {
      try { if (ctx.onStage) ctx.onStage('tool-' + c.name, 'টুল চালাচ্ছি, ' + TOOL_LABELS[c.name]); } catch (_) {}
      return withTimeout(Promise.resolve().then(() => execOne(c, ctx)).catch(() => ({ ok: false, error: 'failed' })), Math.min(TOOL_MS[c.name] || lim.perToolMs, left))
        .then((r) => Object.assign({ name: c.name }, r));
    }));
    results.push(...done);
  }
  return { results, ms: Date.now() - startedAt, version: SKY_TOOLS_VERSION };
}

/* ── turning results into words ── */
const pct = (n) => toBnDigits(n) + '%';
function fmtNumber(v) {
  const s = String(v);
  return /e/i.test(s) ? s : toBnDigits(s);
}

/** Markdown answer for a simple plan (no model). */
export function renderSimpleAnswer(results, firstName) {
  const hi = firstName ? String(firstName).slice(0, 30) + ', ' : '';
  const parts = [];
  for (const r of results) {
    if (r.name === 'calculate') {
      if (r.ok) parts.push('🧮 **' + toBnDigits(r.expression) + ' = ' + fmtNumber(r.value) + '**');
      else parts.push(r.error === 'divide-by-zero' ? '⚠️ শূন্য দিয়ে ভাগ করা যায় না।' : '⚠️ হিসাবটা বুঝতে পারিনি, সংখ্যা আর চিহ্ন (+ − × ÷) দিয়ে আবার লেখো।');
    } else if (r.name === 'get_datetime') {
      if (r.ok) parts.push(renderDateTime(r));
    } else if (r.name === 'get_exam_history') {
      if (!r.ok) continue;
      if (r.empty) { parts.push('📊 ' + hi + 'এখনো কোনো পরীক্ষার ফল জমা নেই। একটা মক টেস্ট দাও, তারপর আমি তোমার অগ্রগতি দেখাতে পারব।'); continue; }
      const lines = ['📊 **' + hi + 'তোমার পরীক্ষার হিসাব**', '',
        '- পরীক্ষা দিয়েছ: **' + toBnDigits(r.exams) + 'টা**', '- প্রশ্ন: **' + toBnDigits(r.questions) + 'টা**',
        '- সঠিকতা: **' + pct(r.accuracy) + '**', '- টানা পড়া: **' + toBnDigits(r.streak) + ' দিন**', '- ভুল-তালিকায়: **' + toBnDigits(r.mistakes) + 'টা**'];
      if (r.weekly && r.prevWeekly) {
        const d = (r.weekly.accuracy | 0) - (r.prevWeekly.accuracy | 0);
        lines.push('', d >= 0 ? '✅ গত সপ্তাহের চেয়ে সঠিকতা ' + pct(d) + ' বেড়েছে।' : '📌 গত সপ্তাহের চেয়ে সঠিকতা ' + pct(-d) + ' কমেছে, ভুল-তালিকা থেকে রিভিশন দাও।');
      }
      parts.push(lines.join('\n'));
    } else if (r.name === 'analyze_weak_topics') {
      if (!r.ok) continue;
      if (r.empty) { parts.push('🧠 এখনো কোনো টপিকে যথেষ্ট প্রশ্ন দাওনি, তাই দুর্বল টপিক বলা যাচ্ছে না। কয়েকটা পরীক্ষা দিলে আমি বলে দেব।'); continue; }
      if (!r.weak.length) { parts.push(statedWeakLine(r, hi)); continue; }
      if (r.stated) { parts.push(['🧠 **যেসব টপিকে আরো পড়া দরকার**', ''].concat(r.weak.map((w, i) => toBnDigits(i + 1) + '. ' + w.name + ', সঠিকতা ' + pct(w.accuracy))).concat(['', statedWeakLine(r, hi), '💡 সবচেয়ে কম যেটায়, সেটা দিয়ে শুরু করো। চাইলে বলো "' + r.weak[0].name + ' থেকে কুইজ দাও"।']).join('\n')); continue; }
      parts.push(['🧠 **যেসব টপিকে আরো পড়া দরকার**', ''].concat(r.weak.map((w, i) => toBnDigits(i + 1) + '. ' + w.name + ', সঠিকতা ' + pct(w.accuracy))).concat(['', '💡 সবচেয়ে কম যেটায়, সেটা দিয়ে শুরু করো। চাইলে বলো "' + r.weak[0].name + ' থেকে কুইজ দাও"।']).join('\n'));
    }
  }
  return parts.join('\n\n') || null;
}

/** Block appended to the system prompt when a model still writes the answer. */
export function renderToolContext(results) {
  const out = [];
  for (const r of results) {
    if (!r.ok && r.name === 'web_search') { out.push(renderSearchFailure(r)); continue; }
    if (!r.ok) continue;
    if (r.name === 'get_app_features') out.push(renderAppFeatures(r.data));
    else if (r.name === 'calculate') out.push('TOOL calculate: ' + r.expression + ' = ' + r.value + ' (exact; use this number).');
    else if (r.name === 'get_exam_history' && !r.empty) out.push('TOOL get_exam_history (this student only): exams ' + r.exams + ', questions ' + r.questions + ', accuracy ' + r.accuracy + '%, streak ' + r.streak + ', mistakes ' + r.mistakes + '.');
    else if (r.name === 'get_datetime') out.push('TOOL get_datetime (live clock, Asia/Dhaka): ' + r.weekday + ', ' + r.date + ', ' + r.bangla + ', ' + r.time + (r.target ? '; ' + r.target + ' is ' + r.daysLeft + ' day(s) from today' : '') + '. Use exactly these values.');
    else if (r.name === 'web_search' && r.results && r.results.length) out.push(renderSearchContext(r));
    else if (r.name === 'web_search') out.push(renderSearchFailure(r));
    else if (r.name === 'analyze_weak_topics' && !r.empty) {
      const measured = r.weak.length ? 'measured from exams: ' + r.weak.map((w) => w.name + ' ' + w.accuracy + '%').join(', ') + '.' : 'no measured weak topic yet (exams taken: ' + (r.exams | 0) + ').';
      const said = r.stated ? ' The student said earlier in chat they are weak in: ' + r.stated.join(', ') + '. Mention this in your FIRST answer (e.g. "তুমি এখনো পরীক্ষা দাওনি, তবে আগে বলেছিলে ' + r.stated[0] + ' দুর্বল। আজ ' + topicBase(r.stated[0]) + ' দিয়ে শুরু করি?") and never say there is no information about their weakness.' : '';
      out.push('TOOL analyze_weak_topics (this student only): ' + measured + said);
    }
  }
  return out.length ? out.join('\n') : '';
}

/** Kill switch (PUB_KV 'sky:agent-tools' = "off"), 300 ms cap, default on. */
export async function toolsEnabled(kv) {
  if (!kv || typeof kv.get !== 'function') return true;
  try {
    const v = await Promise.race([kv.get(TOOLS_KV_SWITCH), new Promise((r) => setTimeout(() => r(null), 300))]);
    return String(v || '').trim().toLowerCase() !== 'off';
  } catch (_) { return true; }
}

/**
 * Answer a simple plan with no model call (and no AI limit used): runs the
 * tools, streams one real `stage` event per tool, then the text and `done`.
 * Returns null when the tools could not produce an answer (the normal AI path
 * then takes over). meta: { intent, pv, agent, firstName, stats, kv }.
 */
export async function simpleToolResponse(plan, stream, meta = {}) {
  const startedAt = Date.now();
  const stages = [];
  const run = await runTools([plan], { stats: meta.stats, statedWeak: meta.statedWeak, kv: meta.kv, onStage: (id, label) => stages.push({ stage: id, label }) });
  const text = renderSimpleAnswer(run.results, meta.firstName);
  if (!text) return null;
  const tools = run.results.map((r) => ({ name: r.name, ok: !!r.ok }));
  const done = { intent: meta.intent || 'GENERAL_CHAT', pv: meta.pv, agent: meta.agent, provider: 'tools', tools, toolsVersion: SKY_TOOLS_VERSION, latencyMs: Date.now() - startedAt, quotaUsed: false };
  if (!stream) return new Response(JSON.stringify(Object.assign({ text }, done)), { status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' } });
  const enc = new TextEncoder();
  return new Response(new ReadableStream({
    start(c) {
      const push = (s) => { try { c.enqueue(enc.encode(s)); } catch (_) {} };
      for (const s of stages) push(`event: stage\ndata: ${JSON.stringify(s)}\n\n`);
      push(`data: ${JSON.stringify({ text })}\n\n`);
      push(`event: done\ndata: ${JSON.stringify(done)}\n\n`);
      try { c.close(); } catch (_) {}
    }
  }), { status: 200, headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', 'Access-Control-Allow-Origin': '*' } });
}

