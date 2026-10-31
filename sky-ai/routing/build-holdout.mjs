/* F1 — routing HOLDOUT set (validation), written separately from the tuning set.
 *
 * WHY THIS EXISTS. A set is only evidence if it can fail. The tuning set
 * (`routing-set-v1.json`) was used to fix the classifier, so 100% on it proves
 * the fixes fit THAT set — not that routing is right. This holdout was written
 * as a second, independent judgement pass and is never tuned against: it is the
 * number that is allowed to disagree.
 *
 * Kept deliberately separate (its own file, its own builder) so editing one
 * cannot quietly move the other.
 *
 * Regenerate with: node sky-ai/routing/build-holdout.mjs
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));

const CASES = [
  /* GENERAL_CHAT / FAST — fresh wording, not reused from the tuning set */
  { q: 'কেমন আছো?', intent: 'GENERAL_CHAT', tier: 'FAST', why: 'small talk' },
  { q: 'আপনি কে?', intent: 'GENERAL_CHAT', tier: 'FAST', why: 'about the assistant (আপনি form)' },
  { q: 'তোমার কাজ কী?', intent: 'GENERAL_CHAT', tier: 'FAST', why: 'about the assistant' },
  { q: 'তুমি কি বাস্তব?', intent: 'GENERAL_CHAT', tier: 'FAST', why: 'small talk' },
  { q: 'শুভ রাত্রি', intent: 'GENERAL_CHAT', tier: 'FAST', why: 'greeting' },
  { q: 'তোমার নাম বলো', intent: 'GENERAL_CHAT', tier: 'FAST', why: 'about the assistant' },
  { q: 'good morning', intent: 'GENERAL_CHAT', tier: 'FAST', why: 'english greeting' },
  { q: 'আপনার সম্পর্কে বলুন', intent: 'GENERAL_CHAT', tier: 'FAST', why: 'about the assistant (আপনি form)' },

  /* QUIZ_REQUEST / FAST */
  { q: '১৫টা প্রশ্ন বানাও ইতিহাস থেকে', intent: 'QUIZ_REQUEST', tier: 'FAST', why: 'count + generate' },
  { q: 'কুইজ দাও', intent: 'QUIZ_REQUEST', tier: 'FAST', why: 'quiz ask' },
  { q: 'আমাকে ৫টা MCQ দাও', intent: 'QUIZ_REQUEST', tier: 'FAST', why: 'count + mcq' },
  { q: 'generate 20 questions', intent: 'QUIZ_REQUEST', tier: 'FAST', why: 'english generate' },

  /* PERFORMANCE_REQUEST / SMART */
  { q: 'আমার ফলাফল কেমন?', intent: 'PERFORMANCE_REQUEST', tier: 'SMART', why: 'own result' },
  { q: 'আমি ভালো করছি কি?', intent: 'PERFORMANCE_REQUEST', tier: 'SMART', why: 'own standing' },
  { q: 'আমার অগ্রগতি জানাও', intent: 'PERFORMANCE_REQUEST', tier: 'SMART', why: 'own progress (synonym)' },
  { q: 'আমার মার্কস কত?', intent: 'PERFORMANCE_REQUEST', tier: 'SMART', why: 'own marks' },

  /* SEARCH_REQUEST / FAST */
  { q: 'ভর্তি নোটিশ কবে?', intent: 'SEARCH_REQUEST', tier: 'FAST', why: 'notice date' },
  { q: 'সর্বশেষ খবর কী?', intent: 'SEARCH_REQUEST', tier: 'FAST', why: 'latest news' },
  { q: 'আবেদনের শেষ তারিখ কত?', intent: 'SEARCH_REQUEST', tier: 'FAST', why: 'deadline' },
  { q: 'any new update?', intent: 'SEARCH_REQUEST', tier: 'FAST', why: 'english update' },

  /* IMAGE_REQUEST / FAST */
  { q: 'এই ছবিটা দেখো', intent: 'IMAGE_REQUEST', tier: 'FAST', why: 'image input' },
  { q: 'হাতে লেখা নোটটা পড়ো', intent: 'IMAGE_REQUEST', tier: 'FAST', why: 'handwritten note' },
  { q: 'ছবির প্রশ্নটার উত্তর দাও', intent: 'IMAGE_REQUEST', tier: 'FAST', why: 'image question' },
  { q: 'photo থেকে পড়ে দাও', intent: 'IMAGE_REQUEST', tier: 'FAST', why: 'banglish photo' },

  /* ACADEMIC_EXPLAIN / FAST — simple */
  { q: 'পৃথিবীর ব্যাসার্ধ কত?', intent: 'ACADEMIC_EXPLAIN', tier: 'FAST', why: 'single fact' },
  { q: 'জল কত ডিগ্রিতে ফোটে?', intent: 'ACADEMIC_EXPLAIN', tier: 'FAST', why: 'single fact' },
  { q: 'বাংলা বর্ণমালায় স্বরবর্ণ কয়টি?', intent: 'ACADEMIC_EXPLAIN', tier: 'FAST', why: 'single fact' },
  { q: 'কোষ কী?', intent: 'ACADEMIC_EXPLAIN', tier: 'FAST', why: 'short definition' },
  { q: 'define gravity', intent: 'ACADEMIC_EXPLAIN', tier: 'FAST', why: 'english definition' },

  /* ACADEMIC_EXPLAIN / SMART — needs reasoning */
  { q: 'গ্রিনহাউস প্রভাব কেন বাড়ছে?', intent: 'ACADEMIC_EXPLAIN', tier: 'SMART', why: '"কেন"' },
  { q: 'আবহাওয়া ও জলবায়ুর পার্থক্য কী?', intent: 'ACADEMIC_EXPLAIN', tier: 'SMART', why: 'compare' },
  { q: 'সমীকরণটি ধাপে ধাপে সমাধান করো', intent: 'ACADEMIC_EXPLAIN', tier: 'SMART', why: 'step by step' },
  { q: 'প্রমাণ করো যে বৃত্তের কেন্দ্রে কোণ পরিধির দ্বিগুণ', intent: 'ACADEMIC_EXPLAIN', tier: 'SMART', why: 'proof' },
  { q: 'শ্বসন ও সালোকসংশ্লেষণের তুলনা করো', intent: 'ACADEMIC_EXPLAIN', tier: 'SMART', why: 'comparison' },
  { q: 'why does ice float on water', intent: 'ACADEMIC_EXPLAIN', tier: 'SMART', why: 'english why' },
  { q: 'গড় বের করো এই সংখ্যাগুলোর', intent: 'ACADEMIC_EXPLAIN', tier: 'SMART', why: 'calculate' },
];

const items = CASES.map((c, i) => ({ id: 'h' + String(i + 1).padStart(3, '0'), ...c }));
const byIntent = {};
const byTier = {};
for (const it of items) {
  byIntent[it.intent] = (byIntent[it.intent] || 0) + 1;
  byTier[it.tier] = (byTier[it.tier] || 0) + 1;
}
const out = { version: 'routing-holdout-v1', built: '2026-10-31', count: items.length, bar: 0.9, byIntent, byTier, items };
writeFileSync(join(HERE, 'routing-holdout-v1.json'), JSON.stringify(out, null, 2) + '\n');
console.log(`wrote routing-holdout-v1.json: ${items.length} cases`);
console.log('byIntent', byIntent);
console.log('byTier', byTier);
