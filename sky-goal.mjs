// 🎯 Sky goal (owner plan step 3, 2026-10-18): Sky keeps the student's admission
// goal in mind and shapes study advice around it. Pure: no model call, no I/O.
// The goal comes only from THIS student's own profile (sanitized server-side)
// or what they said in chat (their own long-term memory). Nothing is invented:
// no exam date, mark split, cut-off or "chance" is ever stated from here.
import { statedGoal, sanitizeMemoryText, isPiiFree } from './memory-engine.js';

export const GOAL_VERSION = 'goal-v1';

const clean = (v, max = 80) => {
  const s = sanitizeMemoryText(String(v == null ? '' : v), max);
  return s && isPiiFree(s) ? s : '';
};

/** Study-advice / preparation / admission question → the goal matters. */
const RE_GOAL_Q = /(প্রস্তুতি|প্রিপারেশন|কী\s*পড়ব|কি\s*পড়ব|কোনটা\s*আগে|কোথা\s*থেকে\s*শুরু|কিভাবে\s*পড়ব|কীভাবে\s*পড়ব|রুটিন|স্টাডি\s*প্ল্যান|পড়ার\s*প্ল্যান|পড়ার\s*পরিকল্পনা|পরামর্শ|সাজেশন|গাইডলাইন|চান্স|ভর্তি|অ্যাডমিশন|এডমিশন|আমার\s*(?:লক্ষ্য|টার্গেট)|লক্ষ্য\s*অনুযায়ী|[কখগঘচ]\s*ইউনিট|ইউনিটে\s*(?:ভর্তি|চান্স|পরীক্ষা)|ঢাবি|জাবি|রাবি|চবি|খুবি|বুয়েট|কুয়েট|রুয়েট|চুয়েট|মেডিকেল|গুচ্ছ|বিশ্ববিদ্যালয়ে|ভার্সিটিতে|admission|prepare|preparation|study\s*plan|routine|target|goal)/iu;
export function isGoalQuestion(text) {
  const t = String(text || '').slice(0, 600);
  return t.trim().length >= 4 && RE_GOAL_Q.test(t);
}

/**
 * The student's admission goal. Profile target first (they chose it on
 * purpose), then the profile's free-text goal, then the goal said in chat.
 * → { label, university, unit, year, source: 'profile' | 'chat' } | null
 */
export function resolveGoal({ profile, records } = {}) {
  const p = profile && typeof profile === 'object' ? profile : {};
  const t = Array.isArray(p.targets) && p.targets[0] ? p.targets[0] : null;
  if (t && clean(t.name, 120)) {
    const university = clean(t.name, 120), unit = clean(t.unit, 40), year = clean(t.year, 40);
    return { label: [university, unit].filter(Boolean).join(' '), university, unit, year, source: 'profile' };
  }
  const g = clean(p.academicGoal, 80);
  if (g) return { label: g, university: '', unit: '', year: '', source: 'profile' };
  const said = clean(statedGoal(records), 80);
  if (said) return { label: said, university: '', unit: '', year: '', source: 'chat' };
  return null;
}

/** Prompt block for an advice question. */
export function renderGoalContext(goal, opts = {}) {
  const weak = Array.isArray(opts.weakTopics) ? opts.weakTopics.filter((w) => w && w.name).slice(0, 3) : [];
  const stated = Array.isArray(opts.stated) ? opts.stated.slice(0, 2) : [];
  const weakLine = weak.length
    ? ' Measured weak topics: ' + weak.map((w) => w.name + ' ' + (w.accuracy | 0) + '%').join(', ') + '.'
    : stated.length ? ' The student said they are weak in: ' + stated.join(', ') + '.' : '';
  if (!goal || !goal.label) {
    if (opts.askedBefore) return 'ADMISSION GOAL (' + GOAL_VERSION + '): unknown (already asked once, do not ask again in this chat).' + weakLine;
    return 'ADMISSION GOAL (' + GOAL_VERSION + '): unknown, the student has not set a target university/unit.' + weakLine +
      ' Give useful general advice first, then ask ONE short question at the end: "তুমি কোন বিশ্ববিদ্যালয়/ইউনিটে ভর্তি হতে চাও? বললে সেই অনুযায়ী সাজিয়ে দেব (প্রোফাইলেও লক্ষ্য দিয়ে রাখতে পারো)।" Do not guess a target.';
  }
  const where = goal.source === 'chat' ? 'said earlier in chat' : 'from their profile';
  return 'ADMISSION GOAL (' + GOAL_VERSION + ', this student only, ' + where + '): ' + goal.label + (goal.year ? ' (' + goal.year + ')' : '') + '.' + weakLine +
    ' Shape this answer around that goal: name it once near the start (e.g. "তোমার লক্ষ্য ' + goal.label + ', তাই…"), put the subjects that exam tests first, and fit the weak topics into the plan.' +
    ' Never promise a seat or a chance. Never state exam dates, mark distribution, seat numbers or cut-offs unless they are given above; if needed say to check the official circular.';
}
