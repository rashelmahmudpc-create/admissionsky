/* F1 — routing set v1 builder.
 *
 * The F1 Done-condition is "রাউটিং নির্ভুলতা ≥ ৯০%" (routing accuracy ≥ 90%),
 * and nothing measured it: `classifyIntent` + `routeTier` decide which model a
 * student's message reaches, and no test stated what the *right* answer is.
 *
 * These labels are HUMAN JUDGEMENT, written from what a student means, NOT by
 * running the classifier and recording what it does. That distinction is the
 * whole point: a set labelled from the code's own output scores 100% forever
 * and measures nothing. A case here is a claim about what the right route is;
 * the harness then reports how often the code agrees.
 *
 * Every case carries `why`, so a later change that flips one has to argue with
 * a reason rather than edit a number.
 *
 * Regenerate with: node sky-ai/routing/build-set.mjs
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));

/* tier: FAST = cheap/free model, SMART = the reasoning model.
 * A case is `{ q, intent, tier, why }`. */
const CASES = [
  /* ── GENERAL_CHAT / FAST — greeting, small talk, about the assistant ── */
  { q: 'আসসালামু আলাইকুম', intent: 'GENERAL_CHAT', tier: 'FAST', why: 'greeting' },
  { q: 'হ্যালো স্যার', intent: 'GENERAL_CHAT', tier: 'FAST', why: 'greeting' },
  { q: 'নমস্কার', intent: 'GENERAL_CHAT', tier: 'FAST', why: 'greeting' },
  { q: 'শুভ সকাল', intent: 'GENERAL_CHAT', tier: 'FAST', why: 'greeting' },
  { q: 'তোমার নাম কী?', intent: 'GENERAL_CHAT', tier: 'FAST', why: 'about the assistant, not a subject question' },
  { q: 'তুমি কে?', intent: 'GENERAL_CHAT', tier: 'FAST', why: 'about the assistant' },
  { q: 'তুমি কী করতে পারো?', intent: 'GENERAL_CHAT', tier: 'FAST', why: 'capability question, not academic' },
  { q: 'তুমি কি মানুষের মতো?', intent: 'GENERAL_CHAT', tier: 'FAST', why: 'small talk' },
  { q: 'ধন্যবাদ', intent: 'GENERAL_CHAT', tier: 'FAST', why: 'courtesy' },
  { q: 'তোমাকে কে বানিয়েছে?', intent: 'GENERAL_CHAT', tier: 'FAST', why: 'about the assistant' },
  { q: 'hi', intent: 'GENERAL_CHAT', tier: 'FAST', why: 'english greeting' },
  { q: 'hello', intent: 'GENERAL_CHAT', tier: 'FAST', why: 'english greeting' },

  /* ── QUIZ_REQUEST / FAST — "make me questions" ── */
  { q: '১০টা MCQ বানাও', intent: 'QUIZ_REQUEST', tier: 'FAST', why: 'explicit question generation' },
  { q: '৫টা প্রশ্ন তৈরি করো', intent: 'QUIZ_REQUEST', tier: 'FAST', why: 'explicit generation' },
  { q: 'আমাকে একটা কুইজ দাও', intent: 'QUIZ_REQUEST', tier: 'FAST', why: 'quiz ask' },
  { q: 'make 10 mcq', intent: 'QUIZ_REQUEST', tier: 'FAST', why: 'english generation' },
  { q: 'এই অধ্যায় থেকে প্রশ্ন বানাও', intent: 'QUIZ_REQUEST', tier: 'FAST', why: 'generation from a topic' },
  { q: '২০টা প্রশ্ন বানাও পদার্থ থেকে', intent: 'QUIZ_REQUEST', tier: 'FAST', why: 'count + generate' },

  /* ── PERFORMANCE_REQUEST / SMART — the student's own progress ── */
  { q: 'আমার প্রোগ্রেস কেমন?', intent: 'PERFORMANCE_REQUEST', tier: 'SMART', why: 'own progress' },
  { q: 'আমি কেমন করছি?', intent: 'PERFORMANCE_REQUEST', tier: 'SMART', why: 'own progress' },
  { q: 'আমার রিপোর্ট দাও', intent: 'PERFORMANCE_REQUEST', tier: 'SMART', why: 'own report' },
  { q: 'আমি কয়টা ভুল করেছি?', intent: 'PERFORMANCE_REQUEST', tier: 'SMART', why: 'own mistake count' },
  { q: 'আমার স্কোর কত?', intent: 'PERFORMANCE_REQUEST', tier: 'SMART', why: 'own score' },
  { q: 'আমার streak কত?', intent: 'PERFORMANCE_REQUEST', tier: 'SMART', why: 'own streak' },
  { q: 'আমি কতটা ভালো করছি?', intent: 'PERFORMANCE_REQUEST', tier: 'SMART', why: 'own standing' },

  /* ── SEARCH_REQUEST / FAST — time-sensitive, needs fresh info ── */
  { q: 'আজকের ভর্তি খবর কী?', intent: 'SEARCH_REQUEST', tier: 'FAST', why: 'news' },
  { q: 'ভর্তির শেষ তারিখ কবে?', intent: 'SEARCH_REQUEST', tier: 'FAST', why: 'deadline' },
  { q: 'নোটিশ এসেছে কি?', intent: 'SEARCH_REQUEST', tier: 'FAST', why: 'notice' },
  { q: 'সার্কুলার কবে আসবে?', intent: 'SEARCH_REQUEST', tier: 'FAST', why: 'circular' },
  { q: 'ভর্তির ফল কবে দেবে?', intent: 'SEARCH_REQUEST', tier: 'FAST', why: 'result date' },
  { q: 'latest admission news', intent: 'SEARCH_REQUEST', tier: 'FAST', why: 'english news' },

  /* ── IMAGE_REQUEST / FAST — an image is the input ── */
  { q: 'এই ছবিটা পড়ো', intent: 'IMAGE_REQUEST', tier: 'FAST', why: 'image input' },
  { q: 'এই স্ক্রিনশট দেখো', intent: 'IMAGE_REQUEST', tier: 'FAST', why: 'screenshot' },
  { q: 'হাতে লেখা প্রশ্নটা বুঝে দাও', intent: 'IMAGE_REQUEST', tier: 'FAST', why: 'handwritten' },
  { q: 'ছবির অঙ্কটা করে দাও', intent: 'IMAGE_REQUEST', tier: 'FAST', why: 'image of a sum' },
  { q: 'read this screenshot', intent: 'IMAGE_REQUEST', tier: 'FAST', why: 'english image' },

  /* ── ACADEMIC_EXPLAIN / FAST — academic but provably simple ── */
  { q: 'নিউটনের দ্বিতীয় সূত্র কী?', intent: 'ACADEMIC_EXPLAIN', tier: 'FAST', why: 'single fact, no reasoning marker' },
  { q: 'বাংলাদেশের রাজধানী কোনটি?', intent: 'ACADEMIC_EXPLAIN', tier: 'FAST', why: 'single fact' },
  { q: 'পানির সংকেত কী?', intent: 'ACADEMIC_EXPLAIN', tier: 'FAST', why: 'single fact' },
  { q: 'সালোকসংশ্লেষণ কী?', intent: 'ACADEMIC_EXPLAIN', tier: 'FAST', why: 'definition, no marker' },
  { q: 'মহাদেশ কতটি?', intent: 'ACADEMIC_EXPLAIN', tier: 'FAST', why: 'single fact' },
  { q: 'what is photosynthesis', intent: 'ACADEMIC_EXPLAIN', tier: 'FAST', why: 'english definition' },
  { q: 'সূর্য কী?', intent: 'ACADEMIC_EXPLAIN', tier: 'FAST', why: 'short definition' },

  /* ── ACADEMIC_EXPLAIN / SMART — needs real reasoning ── */
  { q: 'সালোকসংশ্লেষণ কেন হয়?', intent: 'ACADEMIC_EXPLAIN', tier: 'SMART', why: '"কেন" — why' },
  { q: 'পদার্থ ও রসায়নের পার্থক্য বুঝাও', intent: 'ACADEMIC_EXPLAIN', tier: 'SMART', why: 'compare' },
  { q: 'নিউটনের সূত্র থেকে বল বের করো', intent: 'ACADEMIC_EXPLAIN', tier: 'SMART', why: 'derive/calculate' },
  { q: 'এই অঙ্কটা ধাপে ধাপে সমাধান করো', intent: 'ACADEMIC_EXPLAIN', tier: 'SMART', why: 'step by step' },
  { q: 'মাধ্যাকর্ষণ ও ঘর্ষণের তুলনা করো', intent: 'ACADEMIC_EXPLAIN', tier: 'SMART', why: 'comparison' },
  { q: 'explain why the sky is blue', intent: 'ACADEMIC_EXPLAIN', tier: 'SMART', why: 'english why' },
  { q: 'প্রমাণ করো ত্রিভুজের কোণের সমষ্টি ১৮০', intent: 'ACADEMIC_EXPLAIN', tier: 'SMART', why: 'proof' },
  { q: 'বাষ্পীভবন কী এবং কেন হয়?', intent: 'ACADEMIC_EXPLAIN', tier: 'SMART', why: 'multi-part + why' },
  { q: 'লাভ-ক্ষতির অঙ্কটা হিসাব করো', intent: 'ACADEMIC_EXPLAIN', tier: 'SMART', why: 'calculate' },
];

const items = CASES.map((c, i) => ({ id: 'r' + String(i + 1).padStart(3, '0'), ...c }));
const byIntent = {};
const byTier = {};
for (const it of items) {
  byIntent[it.intent] = (byIntent[it.intent] || 0) + 1;
  byTier[it.tier] = (byTier[it.tier] || 0) + 1;
}
const out = {
  version: 'routing-v1',
  built: '2026-10-31',
  count: items.length,
  bar: 0.9,
  byIntent,
  byTier,
  items,
};
writeFileSync(join(HERE, 'routing-set-v1.json'), JSON.stringify(out, null, 2) + '\n');
console.log(`wrote routing-set-v1.json: ${items.length} cases`);
console.log('byIntent', byIntent);
console.log('byTier', byTier);
