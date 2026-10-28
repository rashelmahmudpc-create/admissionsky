/* Phase 3, Notification & Engagement Intelligence.
 *
 * The three engines that came before this one each answer a narrow question:
 * personalized-notification.mjs ("what is the one daily nudge?"),
 * event-notifications.mjs ("what did the student just achieve?") and
 * digest-notifications.mjs ("what happened this week?"). Each is correct on its
 * own, but nothing ranked them against each other, nothing learned from whether
 * the student ever acted, and every time was hardcoded to Asia/Dhaka.
 *
 * This module is the missing decision layer. It takes the Phase 1–2 behaviour
 * data, turns it into signals, builds every candidate the student qualifies for,
 * and runs them through one pipeline:
 *
 *   eligible? → enabled? → quiet hours? → already sent? → relevant?
 *            → priority → daily/category limit → cooldown → SEND | SKIP
 *
 * Four rules shape the design:
 *   1. One pipeline, not eight. Every stage is a named function returning a
 *      trace entry, so "why did nobody get notified?" has one answer.
 *   2. Restraint is the feature. Silence is a valid outcome and a frequent one.
 *   3. Nothing sends that cannot be measured. Every send records a variant, and
 *      the outcome row links the send to a later learning action.
 *   4. Rules now, AI later. The decision core is pure and has no model in it, so
 *      Phase 5 can put an optimiser in front of the same interface without
 *      touching eligibility, priority or frequency.
 *
 * All decision logic is pure and separate from I/O; the D1 reads/writes are
 * thin SQL. Times are per-student local, defaulting to Asia/Dhaka (UTC+6).
 */
import { corsHeaders } from './cors-policy.mjs';

import { fcmSendToTokens, fcmConfigured, FcmStore, sessionUser, parseBody } from './fcm-notification.mjs';

const DAY_MS = 24 * 3600 * 1000;
const MIN_MS = 60 * 1000;

/* ── constants ───────────────────────────────────────────────────────────── */

/* Asia/Dhaka. Kept as the default rather than the only value: a student who
 * travels (or simply lives elsewhere) sends their real offset from the client. */
export const DEFAULT_TZ_OFFSET_MIN = 360;

/* The eight kinds the product asks for, each with the category it belongs to,
 * its rank in the priority engine, and whether it is a "celebration" (good
 * news) or a "nudge" (a request to act). A fatigued student keeps receiving
 * celebrations, only the nudges thin out. */
export const KIND_META = Object.freeze({
  'certificate': { category: 'achievement', priority: 88, celebration: true, emoji: '🎓' },
  'achievement': { category: 'achievement', priority: 85, celebration: true, emoji: '🏆' },
  'streak-risk': { category: 'streak', priority: 90, celebration: false, emoji: '🔥' },
  'weak-topic': { category: 'learning', priority: 65, celebration: false, emoji: '🧠' },
  'progress': { category: 'learning', priority: 60, celebration: true, emoji: '🎯' },
  'pending-learning': { category: 'learning', priority: 55, celebration: false, emoji: '📚' },
  'comeback': { category: 'streak', priority: 70, celebration: false, emoji: '👋' },
  'challenge': { category: 'challenge', priority: 45, celebration: false, emoji: '🚀' }
});

export const KIND_ORDER = Object.freeze(
  Object.keys(KIND_META).sort((a, b) => KIND_META[b].priority - KIND_META[a].priority)
);

/* Section 5 of the brief. The defaults are deliberately tight: one personalised
 * notification a day, at most one per category, and a cooldown that survives a
 * cron tick that fires every minute. */
export const DEFAULTS = Object.freeze({
  push_enabled: 1,
  personalized_enabled: 1,
  lang: 'bn',
  max_per_day: 1,
  max_per_category_per_day: 1,
  cooldown_hours: 6,
  min_pending: 5,
  inactive_days: 3,
  weak_accuracy: 55,
  weak_min_attempts: 12,
  streak_risk_hour: 17,
  milestone_gap: 2,
  fatigue_window_days: 30,
  fatigue_min_sent: 8,
  fatigue_open_rate: 0.15,
  fatigue_max_extra_cap: 0,
  send_after_hour: 8,
  send_before_hour: 22,
  quiet_hours_enabled: 1,
  quiet_start: '23:00',
  quiet_end: '07:00'
});

/* Per-category switches the student controls (section 18). `push` and
 * `personalized` are the master gates; the rest mirror KIND_META categories. */
export const PREF_CATEGORIES = Object.freeze(['achievement', 'challenge', 'learning', 'streak']);

export const DEFAULT_PREFS = Object.freeze({
  push_enabled: 1,
  personalized_enabled: 1,
  quiet_hours_enabled: 1,
  quiet_start: '23:00',
  quiet_end: '07:00',
  categories: Object.freeze({ achievement: 1, challenge: 1, learning: 1, streak: 1 })
});

/* A/B foundation (section 10). Variants differ only in message copy, never in
 * eligibility, a student must not receive a worse-timed notification because
 * they landed in group B. */
export const AB_VARIANTS = Object.freeze(['A', 'B', 'C']);
export const AB_COPY = Object.freeze({
  'streak-risk': {
    A: { bn: '🔥 স্ট্রিক বাঁচাও', body: 'আজ এখনো পড়া শুরু হয়নি, কয়েকটা প্রশ্ন হলেও স্ট্রিক ধরে রাখো' },
    B: { bn: '🔥 আজকের স্ট্রিক এখনো বাকি', body: 'মাত্র ১০টা MCQ, দুই মিনিটের কাজ, কিন্তু স্ট্রিকটা থেকে যায়' },
    C: { bn: '🔥 স্ট্রিক নিয়ে ভাবছ?', body: 'আজ পড়া হয়নি। ছোট একটা সেশনই যথেষ্ট।' }
  },
  'comeback': {
    A: { bn: '👋 ফিরে এসো', body: 'কয়েকদিন পড়া হয়নি, আজ ছোট একটা সেশন দিয়ে আবার শুরু করো' },
    B: { bn: '👋 আবার শুরু করি?', body: 'যেখানে ছিলে সেখান থেকেই, একটা lesson হলেও আজ এগিয়ে যাও' },
    C: { bn: '👋 তোমার জন্য অপেক্ষা করছি', body: 'পড়ার ছন্দ ফেরাতে আজ একটা ছোট step নাও' }
  },
  'pending-learning': {
    A: { bn: '📚 রিভিশনের সময়', body: 'ভুল প্রশ্নগুলো রিভিশনের অপেক্ষায়, আজ ঝালাই করে ফেলো' },
    B: { bn: '📚 জমে যাচ্ছে', body: 'রিভিশন backlog বাড়ছে, আজ অর্ধেকটা শেষ করলেও লাভ' },
    C: { bn: '📚 ১০ মিনিট রিভিশন', body: 'যা ভুল করেছ, সেটাই সবচেয়ে দামি পড়া, আজ হাত দাও' }
  },
  'progress': {
    A: { bn: '🎯 এগিয়ে চলছো', body: 'তোমার course এগিয়ে চলেছে, এই গতি ধরে রাখো' },
    B: { bn: '🎯 অর্ধেক পথ পেরিয়ে', body: 'অর্ধেকের বেশি শেষ, পরের milestone খুব কাছেই' },
    C: { bn: '🎯 পরের ধাপ', body: 'আর কয়েকটা lesson-ই বাকি, আজ এগিয়ে যাও' }
  },
  'weak-topic': {
    A: { bn: '🧠 দুর্বল topic', body: 'কয়েকটা topic-এ বারবার ভুল হচ্ছে, আজ ওগুলো ধরে ফেলো' },
    B: { bn: '🧠 একটু নজর দরকার', body: 'যে topic-এ ভুল বেশি, সেটাই সবচেয়ে বেশি নম্বর ফেরায়' },
    C: { bn: '🧠 লক্ষ্য ঠিক করি', body: 'আজ শুধু দুর্বল topic-গুলোর practice করি' }
  },
  'achievement': {
    A: { bn: '🏆 সাফল্য', body: 'নতুন milestone unlock হয়েছে, দুর্দান্ত!' },
    B: { bn: '🏆 milestone unlocked', body: 'তোমার পরিশ্রম রঙিন হয়ে উঠল, এভাবেই চালিয়ে যাও' },
    C: { bn: '🏆 অভিনন্দন', body: 'আরেকটা ধাপ পেরিয়ে গেলে, পরেরটাও তোমার হাতের মুঠোয়' }
  },
  'certificate': {
    A: { bn: '🎓 Certificate unlocked', body: 'তোমার certificate তৈরি, এখনই দেখে নাও' },
    B: { bn: '🎓 অভিনন্দন!', body: 'course সম্পূর্ণ, certificate তোমার profile-এ যুক্ত হয়েছে' },
    C: { bn: '🎓 তুমি পারেছ', body: 'পুরো course শেষ, certificate নিতে প্রস্তুত' }
  },
  'challenge': {
    A: { bn: '🚀 চ্যালেঞ্জ', body: 'আজকের চ্যালেঞ্জ তোমার জন্য তৈরি, নিতে রাজি?' },
    B: { bn: '🚀 নতুন চ্যালেঞ্জ', body: 'নিজেকে পরখ করার সময়, আজকের চ্যালেঞ্জ নাও' },
    C: { bn: '🚀 একটু কঠিন কিছু?', body: 'আজকের চ্যালেঞ্জে নিজের সেরাটা দেখাও' }
  }
});

/* ── time helpers (pure) ─────────────────────────────────────────────────── */

/* Convert a UTC instant into a student's wall clock using their own offset.
 * Offset is minutes east of UTC, so Asia/Dhaka is +360. */
export function localParts(nowMs, tzOffsetMin = DEFAULT_TZ_OFFSET_MIN) {
  const offset = Number.isFinite(Number(tzOffsetMin)) ? Number(tzOffsetMin) : DEFAULT_TZ_OFFSET_MIN;
  const d = new Date(Number(nowMs) + offset * MIN_MS);
  return {
    date: d.toISOString().slice(0, 10),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
    weekday: d.getUTCDay(),
    offsetMin: offset
  };
}

const toMinutes = hhmm => {
  const m = String(hhmm || '').match(/^(\d{2}):(\d{2})$/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

/* Quiet hours may wrap midnight (23:00 → 07:00). A malformed range returns
 * false so a bad value can never silence a student forever. */
export function inQuietHours(hour, minute, prefs = {}) {
  if (!Number(prefs.quiet_hours_enabled)) return false;
  const start = toMinutes(prefs.quiet_start);
  const end = toMinutes(prefs.quiet_end);
  if (start == null || end == null || start === end) return false;
  const nowM = hour * 60 + minute;
  return start < end ? (nowM >= start && nowM < end) : (nowM >= start || nowM < end);
}

export function inSendWindow(hour, prefs = {}) {
  const after = Number.isFinite(Number(prefs.send_after_hour)) ? Number(prefs.send_after_hour) : DEFAULTS.send_after_hour;
  const before = Number.isFinite(Number(prefs.send_before_hour)) ? Number(prefs.send_before_hour) : DEFAULTS.send_before_hour;
  return hour >= after && hour < before;
}

export const dayDiff = (a, b) => Math.round((Date.parse(a + 'T00:00:00Z') - Date.parse(b + 'T00:00:00Z')) / DAY_MS);

/* ── behaviour signals (pure) ────────────────────────────────────────────── */

const asInt = (v, fallback = 0) => (Number.isFinite(Number(v)) ? Number(v) : fallback);
const rate = (part, whole) => (whole > 0 ? part / whole : 0);

/* Turn raw Phase 1–2 rows into the nine signals the brief lists (section 7).
 * Everything downstream reads this object and nothing else, so the meaning of
 * "engaged" or "at risk" is defined exactly once. */
export function computeSignals(state = {}, nowMs = Date.now(), tzOffsetMin = DEFAULT_TZ_OFFSET_MIN) {
  const { date: today } = localParts(nowMs, tzOffsetMin);
  const stats = (Array.isArray(state.dailyStats) ? state.dailyStats : [])
    .map(s => ({ day: String(s?.day || ''), questions: asInt(s?.questions), correct: asInt(s?.correct), lessons: asInt(s?.lessons) }))
    .filter(s => s.day);

  const byDay = new Map(stats.map(s => [s.day, s]));
  const questionsToday = asInt(byDay.get(today)?.questions);
  const lessonsToday = asInt(byDay.get(today)?.lessons);

  /* Streak counts consecutive active days ending today or yesterday, so the
   * streak is not reported broken before the day is actually missed. */
  const dayAt = offset => new Date(Date.parse(today + 'T00:00:00Z') - offset * DAY_MS).toISOString().slice(0, 10);
  const active = d => asInt(byDay.get(d)?.questions) > 0 || asInt(byDay.get(d)?.lessons) > 0;
  let streak = 0;
  let cursor = active(today) ? 0 : 1;
  if (active(dayAt(cursor))) while (active(dayAt(cursor))) { streak += 1; cursor += 1; }

  const lastActiveDay = [...byDay.keys()].filter(active).sort().pop() || '';
  const lastActiveAt = asInt(state.activityAt) || (lastActiveDay ? Date.parse(lastActiveDay + 'T12:00:00Z') : 0);
  const daysSinceActive = lastActiveDay ? Math.max(0, dayDiff(today, lastActiveDay)) : null;

  const window7 = stats.filter(s => { const d = dayDiff(today, s.day); return d >= 0 && d < 7; });
  const questions7 = window7.reduce((n, s) => n + s.questions, 0);
  const correct7 = window7.reduce((n, s) => n + s.correct, 0);
  const activeDays7 = window7.filter(s => s.questions > 0 || s.lessons > 0).length;

  const exams = (Array.isArray(state.examScores) ? state.examScores : [])
    .map(e => ({ id: String(e?.id || ''), score: asInt(e?.score, NaN), at: asInt(e?.at) }))
    .filter(e => Number.isFinite(e.score));
  const recentExam = exams.slice().sort((a, b) => b.at - a.at)[0] || null;

  const mistakes = state.mistakes || {};
  const pending = asInt(mistakes.pending);
  const mastered = asInt(mistakes.mastered);
  const topics = (Array.isArray(mistakes.topics) ? mistakes.topics : [])
    .map(t => ({ topic: String(t?.topic || ''), misses: asInt(t?.misses) }))
    .filter(t => t.topic && t.misses > 0)
    .sort((a, b) => b.misses - a.misses);

  const courses = (Array.isArray(state.courses) ? state.courses : []).map(c => {
    const total = asInt(c?.lessonsTotal);
    const done = Math.min(asInt(c?.lessonsDone), total || asInt(c?.lessonsDone));
    return { id: String(c?.id || ''), lessonsTotal: total, lessonsDone: done, percent: total > 0 ? Math.round((done / total) * 100) : 0 };
  }).filter(c => c.id && c.lessonsTotal > 0);

  const history = (Array.isArray(state.history) ? state.history : []).map(h => ({
    key: String(h?.key || ''),
    kind: String(h?.kind || ''),
    sentAt: asInt(h?.sentAt),
    openedAt: asInt(h?.openedAt),
    clickedAt: asInt(h?.clickedAt)
  })).filter(h => h.sentAt);

  const recentNotifs = history.filter(h => nowMs - h.sentAt <= DEFAULTS.fatigue_window_days * DAY_MS);
  const openedNotifs = recentNotifs.filter(h => h.openedAt).length;
  const clickedNotifs = recentNotifs.filter(h => h.clickedAt).length;

  const accuracy = questions7 > 0 ? Math.round(rate(correct7, questions7) * 100) : null;

  /* Engagement level from how many of the last 7 days were active, a count,
   * not a feeling. 5+ days is high, 2+ is medium, below that is low. */
  const engagementLevel = activeDays7 >= 5 ? 'high' : activeDays7 >= 2 ? 'medium' : 'low';

  /* Retention status separates "never really started" from "was active, now
   * drifting", the two need different messages. */
  const retentionStatus = daysSinceActive == null ? 'new'
    : daysSinceActive <= 1 ? 'active'
      : daysSinceActive < DEFAULTS.inactive_days ? 'cooling'
        : 'inactive';

  return {
    today,
    tzOffsetMin,
    lastActiveAt,
    lastActiveDay,
    daysSinceActive,
    recentSessions: activeDays7,
    lessonActivity: lessonsToday,
    lessons7: window7.reduce((n, s) => n + s.lessons, 0),
    quizActivity: exams.length,
    practiceActivity: questions7,
    questionsToday,
    completionRate: courses.length ? Math.round(courses.reduce((n, c) => n + c.percent, 0) / courses.length) : 0,
    accuracy,
    engagementLevel,
    retentionStatus,
    notificationEngagement: {
      sent: recentNotifs.length,
      opened: openedNotifs,
      clicked: clickedNotifs,
      openRate: Math.round(rate(openedNotifs, recentNotifs.length) * 100),
      clickRate: Math.round(rate(clickedNotifs, recentNotifs.length) * 100)
    },
    streak,
    streakRisk: streak >= 2 && questionsToday === 0 && lessonsToday === 0,
    pending,
    mastered,
    repeatedMistakes: topics.reduce((n, t) => n + t.misses, 0),
    weakTopics: topics,
    courses,
    recentExam,
    milestoneNear: nextMilestoneGap(courses)
  };
}

/* How many lessons short of the next 25/50/75/100 mark the closest course is. */
function nextMilestoneGap(courses) {
  let best = null;
  for (const c of courses) {
    for (const mark of [25, 50, 75, 100]) {
      if (c.percent >= mark) continue;
      const lessonsAway = Math.max(1, Math.ceil(((mark - c.percent) / 100) * c.lessonsTotal));
      if (!best || lessonsAway < best.lessonsAway) best = { courseId: c.id, mark, lessonsAway, percent: c.percent };
      break;
    }
  }
  return best;
}

/* ── smart audience selection (pure) ─────────────────────────────────────── */

/* One label per student, most urgent first. This is what makes the audience
 * "smart": the label is derived from behaviour, not from a segment the admin
 * typed in. */
export function classifySegment(signals = {}) {
  const reasons = [];
  const s = signals;
  if (s.daysSinceActive == null) { reasons.push('no-activity-yet'); return { segment: 'new', reasons }; }
  if (s.retentionStatus === 'inactive') { reasons.push(`inactive-${s.daysSinceActive}d`); return { segment: 'dormant', reasons }; }
  if (s.streakRisk && s.streak >= 2) { reasons.push(`streak-${s.streak}-at-risk`); return { segment: 'streak-risk', reasons }; }
  if (s.weakTopics?.length && s.accuracy != null && s.accuracy < DEFAULTS.weak_accuracy && s.practiceActivity >= DEFAULTS.weak_min_attempts) {
    reasons.push(`accuracy-${s.accuracy}%`);
    return { segment: 'struggling', reasons };
  }
  if (s.milestoneNear && s.milestoneNear.lessonsAway <= DEFAULTS.milestone_gap) {
    reasons.push(`milestone-${s.milestoneNear.mark}-in-${s.milestoneNear.lessonsAway}`);
    return { segment: 'milestone-near', reasons };
  }
  if (s.retentionStatus === 'cooling') { reasons.push(`cooling-${s.daysSinceActive}d`); return { segment: 'cooling', reasons }; }
  if (s.engagementLevel === 'high') { reasons.push(`active-${s.recentSessions}/7`); return { segment: 'engaged', reasons }; }
  reasons.push(`active-${s.recentSessions}/7`);
  return { segment: 'active', reasons };
}

/* ── candidate builders (pure) ───────────────────────────────────────────── */

/* Every candidate carries a stable `key`, which is what duplicate protection
 * matches on. A key must encode the event, not the moment: `streak:5` fires
 * once, `streak:5:<date>` would fire daily. */
export function buildCandidates(signals = {}, ctx = {}) {
  const s = signals;
  const out = [];
  const today = s.today;
  const hour = asInt(ctx.hour, 0);

  if (s.streakRisk && s.streak >= 2 && hour >= DEFAULTS.streak_risk_hour) {
    out.push({ kind: 'streak-risk', key: `streak-risk:${today}:${s.streak}`, value: s.streak, link: 'dashboard', reason: `streak ${s.streak}, nothing today` });
  }

  if (s.daysSinceActive != null && s.daysSinceActive >= DEFAULTS.inactive_days) {
    out.push({ kind: 'comeback', key: `comeback:${today}`, value: s.daysSinceActive, link: 'dashboard', reason: `${s.daysSinceActive} days idle` });
  }

  if (s.pending >= DEFAULTS.min_pending) {
    out.push({ kind: 'pending-learning', key: `pending:${today}:${Math.floor(s.pending / 5) * 5}`, value: s.pending, link: 'smart-revision', reason: `${s.pending} pending` });
  }

  /* Weak topic needs evidence, not one bad day: enough attempts AND a low
   * accuracy AND an actual topic with misses. */
  if (s.weakTopics?.length && s.accuracy != null && s.accuracy < DEFAULTS.weak_accuracy && s.practiceActivity >= DEFAULTS.weak_min_attempts) {
    const top = s.weakTopics[0];
    out.push({ kind: 'weak-topic', key: `weak:${top.topic}:${today}`, value: top.misses, link: 'smart-revision', reason: `${top.topic} ×${top.misses}, accuracy ${s.accuracy}%` });
  }

  for (const c of s.courses || []) {
    for (const mark of [25, 50, 75, 100]) {
      if (c.percent >= mark) continue;
      const lessonsAway = Math.max(1, Math.ceil(((mark - c.percent) / 100) * c.lessonsTotal));
      if (lessonsAway <= DEFAULTS.milestone_gap) {
        out.push({ kind: 'progress', key: `progress:${c.id}:${mark}`, value: mark, link: 'dashboard', reason: `${c.id} ${c.percent}% → ${mark}% in ${lessonsAway}` });
      }
      break;
    }
    if (c.percent >= 100) {
      out.push({ kind: 'certificate', key: `certificate:${c.id}`, value: c.id, link: 'dashboard', reason: `${c.id} complete` });
    }
  }

  /* Achievement: a course crossing a quarter mark is a real milestone the
   * student did not see announced anywhere else. */
  for (const c of s.courses || []) {
    for (const mark of [50, 100]) {
      if (c.percent >= mark) {
        out.push({ kind: 'achievement', key: `achievement:${c.id}:${mark}`, value: mark, link: 'dashboard', reason: `${c.id} hit ${mark}%` });
      }
    }
  }

  /* Challenge: an engaged student with no weak area and a live streak gets the
   * optional extra, never a drifting one. */
  if (s.engagementLevel === 'high' && s.streak >= 3 && !s.weakTopics?.length) {
    out.push({ kind: 'challenge', key: `challenge:${today}`, value: s.streak, link: 'dashboard', reason: `engaged, streak ${s.streak}` });
  }

  return out;
}

/* ── priority engine (pure) ──────────────────────────────────────────────── */

/* Highest priority first; ties break toward the candidate with the larger
 * value (a 40-item backlog outranks a 5-item one) and then by kind order so the
 * result is deterministic. */
export function rankCandidates(candidates = []) {
  const order = new Map(KIND_ORDER.map((k, i) => [k, i]));
  return candidates.slice().sort((a, b) => {
    const pa = KIND_META[a.kind]?.priority ?? 0;
    const pb = KIND_META[b.kind]?.priority ?? 0;
    if (pb !== pa) return pb - pa;
    const va = asInt(a.value), vb = asInt(b.value);
    if (typeof a.value === 'number' && typeof b.value === 'number' && vb !== va) return vb - va;
    return (order.get(a.kind) ?? 99) - (order.get(b.kind) ?? 99);
  });
}

/* ── fatigue detection (pure) ────────────────────────────────────────────── */

/* Section 11. Fatigue is sent-up / opened-down, measured over the window. The
 * minimum sample stops a student who has received two notifications from being
 * labelled fatigued on one unlucky open. */
export function detectFatigue(history = [], nowMs = Date.now(), opts = {}) {
  const windowDays = asInt(opts.windowDays, DEFAULTS.fatigue_window_days);
  const minSent = asInt(opts.minSent, DEFAULTS.fatigue_min_sent);
  const threshold = Number.isFinite(Number(opts.openRate)) ? Number(opts.openRate) : DEFAULTS.fatigue_open_rate;

  const recent = (Array.isArray(history) ? history : [])
    .map(h => ({ sentAt: asInt(h?.sentAt), openedAt: asInt(h?.openedAt), clickedAt: asInt(h?.clickedAt) }))
    .filter(h => h.sentAt && nowMs - h.sentAt <= windowDays * DAY_MS);

  const sent = recent.length;
  const opened = recent.filter(h => h.openedAt).length;
  const clicked = recent.filter(h => h.clickedAt).length;
  const openRate = rate(opened, sent);
  const clickRate = rate(clicked, sent);
  const fatigued = sent >= minSent && openRate < threshold;

  return {
    sent,
    opened,
    clicked,
    openRate: Math.round(openRate * 1000) / 1000,
    clickRate: Math.round(clickRate * 1000) / 1000,
    fatigued,
    level: fatigued ? 'high' : (sent >= minSent && openRate < threshold * 2 ? 'watch' : 'normal')
  };
}

/* ── frequency control (pure) ────────────────────────────────────────────── */

/* The cap a student is allowed today, after fatigue. A fatigued student drops to
 * zero *nudges* but keeps celebrations; a healthy student keeps the base cap. */
export function effectiveCap(prefs = {}, fatigue = {}) {
  const base = asInt(prefs.max_per_day, DEFAULTS.max_per_day);
  if (!fatigue?.fatigued) return base;
  return Math.max(0, base - 1 + asInt(prefs.fatigue_max_extra_cap, DEFAULTS.fatigue_max_extra_cap));
}

export function checkFrequency({ prefs = {}, fatigue = {}, sendsToday = 0, categorySends = 0, lastSentAt = 0, nowMs = Date.now(), isCelebration = false }) {
  const cap = effectiveCap(prefs, fatigue);
  const cooldownMs = asInt(prefs.cooldown_hours, DEFAULTS.cooldown_hours) * 3600 * 1000;

  /* Fatigue silences nudges, never good news. */
  if (fatigue?.fatigued && !isCelebration) return { allowed: false, stage: 'fatigue', reason: 'fatigued' };
  if (sendsToday >= cap) {
    if (isCelebration && fatigue?.fatigued) return { allowed: true, stage: 'fatigue', reason: 'celebration-exempt' };
    return { allowed: false, stage: 'daily-limit', reason: `cap ${cap}` };
  }
  const categoryCap = asInt(prefs.max_per_category_per_day, DEFAULTS.max_per_category_per_day);
  if (categorySends >= categoryCap) return { allowed: false, stage: 'category-limit', reason: `category cap ${categoryCap}` };
  if (lastSentAt && nowMs - lastSentAt < cooldownMs) return { allowed: false, stage: 'cooldown', reason: `cooldown ${asInt(prefs.cooldown_hours, DEFAULTS.cooldown_hours)}h` };
  return { allowed: true, stage: 'ok', reason: 'within-limits', cap };
}

/* ── smart timing (pure) ─────────────────────────────────────────────────── */

/* Section 4. The baseline is a coarse day-part table; when the student has
 * enough history the engine prefers their own observed hour instead. */
export function dayPart(hour) {
  if (hour < 6) return 'night';
  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  if (hour < 22) return 'evening';
  return 'night';
}

export const DAY_PART_WEIGHT = Object.freeze({ night: 4, morning: 1, afternoon: 2, evening: 3 });

export function preferredHour(history = [], opts = {}) {
  const min = asInt(opts.min, 3);
  const hours = (Array.isArray(history) ? history : [])
    .map(h => asInt(h?.hour, NaN))
    .filter(h => Number.isFinite(h));
  if (hours.length < min) return null;
  /* Fold the small hours onto the evening so a student who studies at 00:30 is
   * not averaged into the middle of the night. */
  const folded = hours.map(h => (h < 6 ? h + 24 : h));
  const mean = folded.reduce((a, b) => a + b, 0) / folded.length;
  return Math.floor(Math.min(23, Math.max(6, mean % 24)));
}

export function bestSendWindow(signals = {}, prefs = {}) {
  const learned = preferredHour(signals.history || [], { min: 3 });
  if (learned != null) return { hour: learned, source: 'learned' };
  const after = asInt(prefs.send_after_hour, DEFAULTS.send_after_hour);
  const before = asInt(prefs.send_before_hour, DEFAULTS.send_before_hour);
  const mid = Math.round((after + before) / 2);
  return { hour: mid, source: 'baseline' };
}

/* ── A/B foundation (pure) ───────────────────────────────────────────────── */

/* FNV-1a over the student key. Deterministic on purpose: the same student must
 * land in the same variant across cron ticks, otherwise an A/B result measures
 * the assignment, not the message. */
export function hashToInt(str) {
  let h = 0x811c9dc5;
  const s = String(str);
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export function assignVariant(userId, kind, variants = AB_VARIANTS) {
  const list = Array.isArray(variants) && variants.length ? variants : AB_VARIANTS;
  return list[hashToInt(`${userId}|${kind}`) % list.length];
}

export function buildMessage(kind, params = {}, lang = 'bn', variant = 'A') {
  const meta = KIND_META[kind];
  if (!meta) return null;
  const set = AB_COPY[kind];
  const copy = set?.[variant] || set?.A;
  if (!copy) return null;
  const value = params.value;
  const body = typeof copy.body === 'function' ? copy.body(value) : copy.body;
  const title = typeof copy.bn === 'function' ? copy.bn(value) : copy.bn;
  return { title, body, kind, category: meta.category, variant, link: params.link || 'dashboard' };
}

/* ── conversion attribution (pure) ───────────────────────────────────────── */

/* Section 8. A notification is only effective if the student then *learned*.
 * We accept a learning event as attributable when it happens inside the window
 * after the send, and we require it to be after the open, because a lesson
 * started before the tap cannot have been caused by it. */
export const LEARNING_KINDS = Object.freeze(['lesson_start', 'lesson_complete', 'quiz_complete', 'question_attempt', 'course_complete']);

export function attributeConversion(send = {}, learningEvents = [], windowMs = 6 * 3600 * 1000) {
  const sentAt = asInt(send.sentAt);
  if (!sentAt) return { converted: false, kind: null, lagMs: null };
  const floor = Math.max(sentAt, asInt(send.openedAt) || 0, asInt(send.clickedAt) || 0);
  const candidates = (Array.isArray(learningEvents) ? learningEvents : [])
    .map(e => ({ kind: String(e?.kind || e?.name || ''), at: asInt(e?.at) }))
    .filter(e => LEARNING_KINDS.includes(e.kind) && e.at >= floor && e.at - sentAt <= windowMs)
    .sort((a, b) => a.at - b.at);
  if (!candidates.length) return { converted: false, kind: null, lagMs: null };
  return { converted: true, kind: candidates[0].kind, lagMs: candidates[0].at - sentAt };
}

/* ── performance + feedback (pure) ───────────────────────────────────────── */

const pct = (part, whole) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0);

/* Section 9 + 10: per-kind, per-variant and per-hour performance, plus the
 * best hour to feed back into smart timing. */
export function computePerformance(rows = []) {
  const byKind = {};
  const byVariant = {};
  const byHour = {};
  let sent = 0, opened = 0, clicked = 0, converted = 0, failed = 0;

  for (const r of rows) {
    const kind = String(r?.kind || 'unknown');
    const variant = String(r?.variant || 'A');
    const hour = Number.isFinite(Number(r?.hour)) ? Number(r.hour) : null;
    const ok = r?.status !== 'failed';
    if (ok) sent += 1; else failed += 1;
    if (r?.openedAt) opened += 1;
    if (r?.clickedAt) clicked += 1;
    if (r?.learningAt) converted += 1;

    for (const [bucket, key] of [[byKind, kind], [byVariant, variant], [byHour, hour == null ? 'unknown' : String(hour)]]) {
      if (key == null) continue;
      const b = bucket[key] || (bucket[key] = { sent: 0, opened: 0, clicked: 0, converted: 0, failed: 0 });
      if (ok) b.sent += 1; else b.failed += 1;
      if (r?.openedAt) b.opened += 1;
      if (r?.clickedAt) b.clicked += 1;
      if (r?.learningAt) b.converted += 1;
    }
  }

  for (const bucket of [byKind, byVariant, byHour]) {
    for (const b of Object.values(bucket)) {
      b.openRate = pct(b.opened, b.sent);
      b.clickRate = pct(b.clicked, b.sent);
      b.conversion = pct(b.converted, b.sent);
    }
  }

  const hours = Object.entries(byHour)
    .filter(([h]) => h !== 'unknown')
    .map(([h, b]) => ({ hour: Number(h), ...b }))
    .filter(b => b.sent >= 3)
    .sort((a, b) => (b.conversion - a.conversion) || (b.openRate - a.openRate));
  const bestHour = hours.length ? hours[0].hour : null;

  return {
    totals: { sent, opened, clicked, converted, failed, openRate: pct(opened, sent), clickRate: pct(clicked, sent), conversion: pct(converted, sent) },
    byKind, byVariant, byHour, bestHour
  };
}

/* The feedback loop, in one function: learn the best hour and whether a variant
 * is clearly winning, then hand both back to the decision core. */
export function computeFeedback(rows = [], opts = {}) {
  const perf = computePerformance(rows);
  const minSample = asInt(opts.minSample, 20);
  const variants = Object.entries(perf.byVariant).filter(([, b]) => b.sent >= minSample);
  let winner = null;
  if (variants.length >= 2) {
    const ranked = variants.sort((a, b) => (b[1].conversion - a[1].conversion) || (b[1].openRate - a[1].openRate));
    const [topKey, top] = ranked[0];
    const [secondKey, second] = ranked[1];
    if (top.conversion > second.conversion || top.openRate > second.openRate) winner = { variant: topKey, beat: secondKey, conversion: top.conversion, openRate: top.openRate };
  }
  return { ...perf, winner, ready: perf.totals.sent >= minSample };
}

/* Section 20, the admin control tower, in one pure function over the decision
 * log. It answers the four questions an operator actually asks: how many were
 * eligible, how many we chose to send, why we skipped the rest, and which kind
 * performs. CTR is clicks/sent, not clicks/eligible, so it cannot be inflated by
 * a large eligible population that was never sent to. */
export function computeDecisionStats(decisions = [], outcomes = []) {
  const rows = Array.isArray(decisions) ? decisions : [];
  const out = Array.isArray(outcomes) ? outcomes : [];

  let sent = 0, skipped = 0;
  const byRule = {};
  const bySkipStage = {};
  const byReason = {};

  for (const d of rows) {
    const decision = String(d?.decision || '');
    const rule = String(d?.rule || 'unknown');
    if (decision === 'send') sent += 1; else skipped += 1;
    const r = byRule[rule] || (byRule[rule] = { sent: 0, skipped: 0 });
    if (decision === 'send') r.sent += 1; else r.skipped += 1;
    if (decision !== 'send') {
      const stage = String(d?.stage || 'unknown');
      bySkipStage[stage] = (bySkipStage[stage] || 0) + 1;
      const reason = String(d?.reason || 'unknown');
      byReason[reason] = (byReason[reason] || 0) + 1;
    }
  }

  const rank = obj => Object.entries(obj)
    .map(([key, value]) => ({ key, count: value }))
    .sort((a, b) => (b.count - a.count) || a.key.localeCompare(b.key));

  let opened = 0, clicked = 0, delivered = 0;
  const perfByRule = {};
  for (const o of out) {
    if (o?.status === 'failed') continue;
    const rule = String(o?.kind || 'unknown');
    const b = perfByRule[rule] || (perfByRule[rule] = { sent: 0, opened: 0, clicked: 0 });
    b.sent += 1;
    delivered += 1;
    if (o?.openedAt) { opened += 1; b.opened += 1; }
    if (o?.clickedAt) { clicked += 1; b.clicked += 1; }
  }
  const perfRanked = Object.entries(perfByRule)
    .map(([kind, b]) => ({ kind, ...b, clickRate: pct(b.clicked, b.sent), openRate: pct(b.opened, b.sent) }))
    .sort((a, b) => (b.clickRate - a.clickRate) || (b.openRate - a.openRate) || a.kind.localeCompare(b.kind));

  return {
    eligible: rows.length,
    sent,
    skipped,
    /* CTR is over delivered sends, not decisions: a decision to send that FCM
     * then rejected must not sit in the denominator. */
    totals: { sent: delivered, opened, clicked, clickRate: pct(clicked, delivered), openRate: pct(opened, delivered) },
    byRule,
    bySkipStage,
    topSkipStage: rank(bySkipStage)[0] || null,
    topReason: rank(byReason)[0] || null,
    topRule: rank(Object.fromEntries(Object.entries(byRule).map(([k, v]) => [k, v.sent])))[0] || null,
    bestPerforming: perfRanked[0] || null,
    byRulePerformance: perfRanked
  };
}

/* ── the pipeline (pure) ─────────────────────────────────────────────────── */

/* Sections 1, 2, 5, 6, 17 and 18 in one ordered pass. Each stage appends a trace
 * entry so a skip is explainable, not mysterious. `deps` carries the pieces that
 * need I/O in production but are plain values in tests. */
export function decide({ signals = {}, prefs = {}, fatigue = {}, ctx = {}, deps = {} } = {}) {
  const trace = [];
  const nowMs = asInt(deps.nowMs, Date.now());
  const tzOffsetMin = asInt(prefs.tz_offset_min, DEFAULT_TZ_OFFSET_MIN);
  const { hour, minute } = localParts(nowMs, tzOffsetMin);
  const p = { ...DEFAULTS, ...prefs };

  const skip = (stage, reason) => { trace.push({ stage, ok: false, reason }); return { decision: 'skip', stage, reason, trace, candidate: null, variant: null, message: null }; };

  /* 1. Eligible at all: a device to reach, and something to say. */
  if (!deps.hasDevices) return skip('eligible', 'no-devices');
  trace.push({ stage: 'eligible', ok: true });

  /* 2. Enabled: master push, then the personalised switch. */
  if (!Number(p.push_enabled)) return skip('enabled', 'push-off');
  if (!Number(p.personalized_enabled)) return skip('enabled', 'personalized-off');
  trace.push({ stage: 'enabled', ok: true });

  /* 3. Quiet hours and the send window, in the student's own timezone. */
  if (inQuietHours(hour, minute, p)) return skip('quiet-hours', `${p.quiet_start}-${p.quiet_end}`);
  if (!inSendWindow(hour, p)) return skip('send-window', `outside ${p.send_after_hour}-${p.send_before_hour}`);
  trace.push({ stage: 'quiet-hours', ok: true, hour });

  /* 4. Relevance: build everything this student qualifies for, then drop the
   *    categories they switched off (section 18). */
  const built = buildCandidates(signals, { hour });
  const ranked = rankCandidates(built).filter(c => Number((p.categories || {})[KIND_META[c.kind]?.category] ?? 1));
  if (!ranked.length) return skip('relevant', 'no-candidate');
  trace.push({ stage: 'relevant', ok: true, candidates: ranked.map(c => c.kind) });

  /* 5–8. Walk the ranked list; the first candidate that clears duplicate
   *      protection, priority, the frequency controls and the cooldown wins.
   *      A blocked candidate does not stop the list, the next-best may be
   *      allowed (e.g. a celebration while a nudge is rate-limited). */
  const seenKeys = new Set(deps.seenKeys instanceof Set ? deps.seenKeys : []);
  /* When everything is blocked, report the most informative stage (the first
   * block we hit) rather than a generic "suppressed", so "why did nothing go
   * out?" is answerable from the top-level result alone. */
  let firstBlock = null;
  for (const candidate of ranked) {
    if (seenKeys.has(candidate.key)) {
      trace.push({ stage: 'duplicate', ok: false, kind: candidate.kind, reason: candidate.key });
      firstBlock = firstBlock || { stage: 'duplicate', reason: candidate.key };
      continue;
    }
    const isCelebration = Boolean(KIND_META[candidate.kind]?.celebration);
    const freq = checkFrequency({
      prefs: p,
      fatigue,
      sendsToday: asInt(deps.sendsToday),
      categorySends: asInt((deps.categorySends || {})[KIND_META[candidate.kind]?.category], 0),
      lastSentAt: asInt(deps.lastSentAt),
      nowMs,
      isCelebration
    });
    if (!freq.allowed) {
      trace.push({ stage: freq.stage, ok: false, kind: candidate.kind, reason: freq.reason });
      firstBlock = firstBlock || { stage: freq.stage, reason: freq.reason };
      continue;
    }
    const variant = deps.forceVariant || assignVariant(deps.userId || 'anon', candidate.kind);
    const built = buildMessage(candidate.kind, { value: candidate.value, link: candidate.link }, deps.lang || 'bn', variant);
    if (!built) {
      trace.push({ stage: 'message', ok: false, kind: candidate.kind, reason: 'no-copy' });
      firstBlock = firstBlock || { stage: 'message', reason: 'no-copy' };
      continue;
    }
    /* Carry the candidate key on the message so the send, the open, the click
     * and any later learning action all join on the same value. */
    const message = { ...built, key: candidate.key };
    trace.push({ stage: 'priority', ok: true, kind: candidate.kind, priority: KIND_META[candidate.kind]?.priority });
    trace.push({ stage: 'frequency', ok: true, reason: freq.reason, cap: freq.cap });
    return { decision: 'send', stage: 'send', reason: candidate.reason, trace, candidate, variant, message, window: bestSendWindow(signals, p) };
  }

  const blocked = firstBlock || { stage: 'all-suppressed', reason: 'every-candidate-blocked' };
  trace.push({ stage: 'all-suppressed', ok: false, reason: blocked.reason });
  return { decision: 'skip', stage: blocked.stage, reason: blocked.reason, trace, candidate: null, variant: null, message: null };
}

/* ── storage ─────────────────────────────────────────────────────────────── */

export class IntelligenceStore {
  #d1;
  #ready;

  constructor(d1) {
    this.#d1 = d1 || null;
  }

  available() {
    return Boolean(this.#d1);
  }

  async init() {
    if (!this.#d1) return;
    if (!this.#ready) {
      this.#ready = (async () => {
        await this.#d1.batch([
          this.#d1.prepare(`CREATE TABLE IF NOT EXISTS notification_intel_state (
            user_id TEXT PRIMARY KEY,
            tz_offset_min INTEGER NOT NULL DEFAULT 360,
            prefs_json TEXT NOT NULL,
            updated_at INTEGER NOT NULL
          )`),
          this.#d1.prepare(`CREATE TABLE IF NOT EXISTS notification_outcomes (
            user_id TEXT NOT NULL,
            notification_key TEXT NOT NULL,
            kind TEXT NOT NULL,
            category TEXT NOT NULL,
            variant TEXT NOT NULL,
            day_key TEXT NOT NULL,
            sent_at INTEGER NOT NULL,
            opened_at INTEGER,
            clicked_at INTEGER,
            learning_at INTEGER,
            learning_kind TEXT,
            status TEXT NOT NULL,
            PRIMARY KEY (user_id, notification_key)
          )`),
          this.#d1.prepare('CREATE INDEX IF NOT EXISTS idx_no_user_sent ON notification_outcomes(user_id, sent_at DESC)'),
          this.#d1.prepare('CREATE INDEX IF NOT EXISTS idx_no_kind ON notification_outcomes(kind, sent_at DESC)'),
          this.#d1.prepare(`CREATE TABLE IF NOT EXISTS notification_fatigue (
            user_id TEXT PRIMARY KEY,
            sent INTEGER NOT NULL,
            opened INTEGER NOT NULL,
            clicked INTEGER NOT NULL,
            open_rate REAL NOT NULL,
            level TEXT NOT NULL,
            computed_at INTEGER NOT NULL
          )`),
          this.#d1.prepare(`CREATE TABLE IF NOT EXISTS notification_decisions (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            rule TEXT NOT NULL,
            kind TEXT,
            score INTEGER NOT NULL,
            decision TEXT NOT NULL,
            stage TEXT,
            reason TEXT,
            day_key TEXT NOT NULL,
            created_at INTEGER NOT NULL
          )`),
          this.#d1.prepare('CREATE INDEX IF NOT EXISTS idx_nd_day ON notification_decisions(day_key, decision)'),
          this.#d1.prepare('CREATE INDEX IF NOT EXISTS idx_nd_user ON notification_decisions(user_id, created_at DESC)')
        ]);
      })().catch(err => { this.#ready = null; throw err; });
    }
    await this.#ready;
  }

  async audience() {
    await this.init();
    const rows = await this.#d1.prepare('SELECT DISTINCT user_id FROM fcm_devices WHERE is_active=1').all();
    return (rows?.results || []).map(r => String(r.user_id));
  }

  async getState(userId) {
    await this.init();
    const row = await this.#d1.prepare('SELECT * FROM notification_intel_state WHERE user_id=?').bind(userId).first();
    if (!row) return { tz_offset_min: DEFAULT_TZ_OFFSET_MIN, prefs: { ...DEFAULT_PREFS }, stored: false };
    let prefs = {};
    try { prefs = JSON.parse(String(row.prefs_json)); } catch { prefs = {}; }
    return {
      tz_offset_min: asInt(row.tz_offset_min, DEFAULT_TZ_OFFSET_MIN),
      prefs: { ...DEFAULT_PREFS, ...prefs, categories: { ...DEFAULT_PREFS.categories, ...(prefs.categories || {}) } },
      stored: true
    };
  }

  async saveState(userId, { tzOffsetMin, prefs }, now) {
    await this.init();
    const current = await this.getState(userId);
    const merged = {
      ...current.prefs,
      ...(prefs || {}),
      categories: { ...current.prefs.categories, ...((prefs || {}).categories || {}) }
    };
    const tz = Number.isFinite(Number(tzOffsetMin)) ? Math.max(-720, Math.min(840, Math.round(Number(tzOffsetMin)))) : current.tz_offset_min;
    await this.#d1.prepare(
      `INSERT INTO notification_intel_state(user_id, tz_offset_min, prefs_json, updated_at) VALUES (?,?,?,?)
       ON CONFLICT(user_id) DO UPDATE SET tz_offset_min=excluded.tz_offset_min, prefs_json=excluded.prefs_json, updated_at=excluded.updated_at`
    ).bind(userId, tz, JSON.stringify(merged), now).run();
    return { tz_offset_min: tz, prefs: merged };
  }

  /* The daily cap is shared with the Phase G engine through notification_sends,
   * so turning this engine on cannot double a student's daily allowance. */
  async sendsToday(userId, dayKey) {
    await this.init();
    const row = await this.#d1.prepare('SELECT COUNT(*) AS n FROM notification_sends WHERE user_id=? AND day_key=?').bind(userId, dayKey).first();
    return asInt(row?.n, 0);
  }

  async categorySendsToday(userId, dayKey, category) {
    await this.init();
    const row = await this.#d1.prepare(
      `SELECT COUNT(*) AS n FROM notification_outcomes
       WHERE user_id=? AND day_key=? AND category=? AND status<>'failed'`
    ).bind(userId, dayKey, category).first();
    return asInt(row?.n, 0);
  }

  async lastSentAt(userId) {
    await this.init();
    const row = await this.#d1.prepare('SELECT MAX(sent_at) AS t FROM notification_outcomes WHERE user_id=?').bind(userId).first();
    return asInt(row?.t, 0);
  }

  async seenKeys(userId) {
    await this.init();
    const rows = await this.#d1.prepare('SELECT notification_key FROM notification_outcomes WHERE user_id=?').bind(userId).all();
    return new Set((rows?.results || []).map(r => String(r.notification_key)));
  }

  async history(userId, limit = 200) {
    await this.init();
    const rows = await this.#d1.prepare(
      'SELECT notification_key, kind, sent_at, opened_at, clicked_at FROM notification_outcomes WHERE user_id=? ORDER BY sent_at DESC LIMIT ?'
    ).bind(userId, limit).all();
    return (rows?.results || []).map(r => ({
      key: String(r.notification_key), kind: String(r.kind),
      sentAt: asInt(r.sent_at), openedAt: asInt(r.opened_at), clickedAt: asInt(r.clicked_at)
    }));
  }

  /* Claim the day slot in the shared table AND write the outcome row. The claim
   * happens before the send so a crash cannot double-deliver. */
  async claimSend({ userId, key, kind, category, variant, dayKey, at }) {
    await this.init();
    const claimed = await this.#d1.prepare(
      `INSERT INTO notification_sends(user_id, kind, day_key, sent_at) VALUES (?,?,?,?)
       ON CONFLICT(user_id, kind, day_key) DO NOTHING`
    ).bind(userId, `intel:${kind}`, dayKey, at).run();
    if (!(asInt(claimed?.meta?.changes, 0) > 0)) return false;
    await this.#d1.prepare(
      `INSERT INTO notification_outcomes(user_id, notification_key, kind, category, variant, day_key, sent_at, status)
       VALUES (?,?,?,?,?,?,?,?)
       ON CONFLICT(user_id, notification_key) DO NOTHING`
    ).bind(userId, key, kind, category, variant, dayKey, at, 'sent').run();
    return true;
  }

  /* Section 17, why did we send (or not send)? One row per evaluated student
   * per run, keyed by user+day+rule so a cron tick that fires twice cannot grow
   * the log without bound. `decision` is 'send' or 'skip'; `stage`/`reason` come
   * from the pipeline trace so a skip is answerable after the fact. */
  async logDecision({ userId, rule, kind, score, decision, stage, reason, dayKey, at }) {
    await this.init();
    const id = `${userId}|${dayKey}|${rule}`;
    await this.#d1.prepare(
      `INSERT INTO notification_decisions(id, user_id, rule, kind, score, decision, stage, reason, day_key, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET
         kind=excluded.kind, score=excluded.score, decision=excluded.decision,
         stage=excluded.stage, reason=excluded.reason, created_at=excluded.created_at`
    ).bind(id, userId, String(rule), kind ? String(kind) : null, asInt(score, 0), String(decision),
      stage ? String(stage) : null, reason ? String(reason) : null, String(dayKey), at).run();
  }

  async decisionsForDay(dayKey) {
    await this.init();
    const rows = await this.#d1.prepare(
      `SELECT user_id, rule, kind, score, decision, stage, reason, day_key, created_at
       FROM notification_decisions WHERE day_key=? ORDER BY created_at DESC`
    ).bind(dayKey).all();
    return (rows?.results || []).map(r => ({
      userId: String(r.user_id), rule: String(r.rule), kind: r.kind ? String(r.kind) : null,
      score: asInt(r.score, 0), decision: String(r.decision),
      stage: r.stage ? String(r.stage) : null, reason: r.reason ? String(r.reason) : null,
      dayKey: String(r.day_key), createdAt: asInt(r.created_at, 0)
    }));
  }

  /* One day's outcomes, for the admin dashboard's CTR. Failed sends are kept so
   * the dashboard can exclude them from the denominator itself. */
  async outcomesForDay(dayKey) {
    await this.init();
    const rows = await this.#d1.prepare(
      `SELECT kind, category, variant, sent_at, opened_at, clicked_at, status
       FROM notification_outcomes WHERE day_key=? ORDER BY sent_at DESC`
    ).bind(dayKey).all();
    return (rows?.results || []).map(r => ({
      kind: String(r.kind), category: String(r.category), variant: String(r.variant),
      sentAt: asInt(r.sent_at, 0), openedAt: asInt(r.opened_at, 0),
      clickedAt: asInt(r.clicked_at, 0), status: String(r.status)
    }));
  }

  async markOutcome({ userId, key, field, at }) {
    await this.init();
    if (!['opened_at', 'clicked_at'].includes(field)) return false;
    const res = await this.#d1.prepare(
      `UPDATE notification_outcomes SET ${field}=COALESCE(${field}, ?) WHERE user_id=? AND notification_key=?`
    ).bind(at, userId, key).run();
    return asInt(res?.meta?.changes, 0) > 0;
  }

  async markLearning({ userId, key, kind, at }) {
    await this.init();
    const res = await this.#d1.prepare(
      `UPDATE notification_outcomes SET learning_at=COALESCE(learning_at, ?), learning_kind=COALESCE(learning_kind, ?)
       WHERE user_id=? AND notification_key=?`
    ).bind(at, kind, userId, key).run();
    return asInt(res?.meta?.changes, 0) > 0;
  }

  /* The most recent sends still inside the attribution window, what a learning
   * event can be credited to. */
  async convertibleSends(userId, sinceMs) {
    await this.init();
    const rows = await this.#d1.prepare(
      `SELECT notification_key, kind, sent_at, opened_at, clicked_at FROM notification_outcomes
       WHERE user_id=? AND sent_at>=? AND learning_at IS NULL ORDER BY sent_at DESC LIMIT 10`
    ).bind(userId, sinceMs).all();
    return (rows?.results || []).map(r => ({
      key: String(r.notification_key), kind: String(r.kind),
      sentAt: asInt(r.sent_at), openedAt: asInt(r.opened_at), clickedAt: asInt(r.clicked_at)
    }));
  }

  async saveFatigue(userId, fatigue, now) {
    await this.init();
    await this.#d1.prepare(
      `INSERT INTO notification_fatigue(user_id, sent, opened, clicked, open_rate, level, computed_at) VALUES (?,?,?,?,?,?,?)
       ON CONFLICT(user_id) DO UPDATE SET sent=excluded.sent, opened=excluded.opened, clicked=excluded.clicked,
         open_rate=excluded.open_rate, level=excluded.level, computed_at=excluded.computed_at`
    ).bind(userId, fatigue.sent, fatigue.opened, fatigue.clicked, fatigue.openRate, fatigue.level, now).run();
  }

  async fatigue(userId) {
    await this.init();
    const row = await this.#d1.prepare('SELECT * FROM notification_fatigue WHERE user_id=?').bind(userId).first();
    if (!row) return { sent: 0, opened: 0, clicked: 0, openRate: 0, clickRate: 0, fatigued: false, level: 'normal' };
    return {
      sent: asInt(row.sent), opened: asInt(row.opened), clicked: asInt(row.clicked),
      openRate: Number(row.open_rate) || 0, clickRate: 0,
      fatigued: String(row.level) === 'high', level: String(row.level)
    };
  }

  async rowsForPerformance(limit = 2000) {
    await this.init();
    const rows = await this.#d1.prepare(
      `SELECT kind, category, variant, status, sent_at, opened_at, clicked_at, learning_at, learning_kind
       FROM notification_outcomes ORDER BY sent_at DESC LIMIT ?`
    ).bind(limit).all();
    return (rows?.results || []).map(r => ({
      kind: String(r.kind), category: String(r.category), variant: String(r.variant), status: String(r.status),
      sentAt: asInt(r.sent_at), openedAt: asInt(r.opened_at), clickedAt: asInt(r.clicked_at),
      learningAt: asInt(r.learning_at), learningKind: r.learning_kind ? String(r.learning_kind) : null,
      hour: localParts(asInt(r.sent_at)).hour
    }));
  }

  /* ── behaviour reads (Phase 1–2 tables, read-only) ───────────────────────
   * These are the rows the signals are computed from. They are plain reads of
   * tables other features already own, this engine never writes them. */
  async dailyStats(userId, limitDays = 60) {
    await this.init();
    const rows = await this.#d1.prepare(
      `SELECT day, payload_json FROM user_daily_stats
       WHERE user_id=? AND deleted_at IS NULL ORDER BY day DESC LIMIT ?`
    ).bind(userId, limitDays).all();
    return (rows?.results || []).map(r => {
      let doc = null;
      try { doc = JSON.parse(String(r.payload_json)); } catch { doc = null; }
      return {
        day: String(r.day),
        questions: asInt(doc?.questions),
        correct: asInt(doc?.correct),
        lessons: asInt(doc?.lessons)
      };
    });
  }

  async examScores(userId, limit = 20) {
    await this.init();
    const rows = await this.#d1.prepare(
      `SELECT id, payload_json, updated_at FROM user_exam_results
       WHERE user_id=? AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT ?`
    ).bind(userId, limit).all();
    return (rows?.results || []).map(r => {
      let doc = null;
      try { doc = JSON.parse(String(r.payload_json)); } catch { doc = null; }
      return { id: String(r.id), score: asInt(doc?.score ?? doc?.percentage, NaN), at: asInt(r.updated_at) };
    }).filter(e => Number.isFinite(e.score));
  }

  /* Pending revisions plus the topics those misses cluster in, the two numbers
   * weak-topic intelligence needs. */
  async mistakeState(userId) {
    await this.init();
    const rows = await this.#d1.prepare(
      `SELECT topic_id, COUNT(*) AS misses FROM user_mistakes
       WHERE user_id=? AND deleted_at IS NULL AND COALESCE(mastered,0)=0
         AND (revision_status IS NULL OR revision_status<>'mastered')
       GROUP BY topic_id ORDER BY misses DESC LIMIT 10`
    ).bind(userId).all();
    const topics = (rows?.results || []).map(r => ({ topic: String(r.topic_id || 'general'), misses: asInt(r.misses) }));
    const pending = topics.reduce((n, t) => n + t.misses, 0);

    const masteredRow = await this.#d1.prepare(
      `SELECT COUNT(*) AS n FROM user_mistakes
       WHERE user_id=? AND deleted_at IS NULL AND (COALESCE(mastered,0)=1 OR revision_status='mastered')`
    ).bind(userId).first();
    return { pending, mastered: asInt(masteredRow?.n), topics };
  }

  async lastActiveAt(userId) {
    await this.init();
    const row = await this.#d1.prepare(
      'SELECT MAX(updated_at) AS t FROM user_activity WHERE user_id=? AND deleted_at IS NULL'
    ).bind(userId).first();
    return asInt(row?.t, 0);
  }

  /* Course progress lives in the student's own settings blob (the client writes
   * it there). Missing or malformed means "no course data", never a guess. */
  async courseProgress(userId) {
    await this.init();
    const row = await this.#d1.prepare(
      `SELECT payload_json FROM user_settings WHERE user_id=? AND id='settings' AND deleted_at IS NULL`
    ).bind(userId).first();
    if (!row?.payload_json) return [];
    let doc = null;
    try { doc = JSON.parse(String(row.payload_json)); } catch { return []; }
    const raw = doc?.courses || doc?.courseProgress || [];
    if (!Array.isArray(raw)) return [];
    return raw.map(c => ({
      id: String(c?.id || c?.courseId || ''),
      lessonsTotal: asInt(c?.lessonsTotal ?? c?.total),
      lessonsDone: asInt(c?.lessonsDone ?? c?.done)
    })).filter(c => c.id && c.lessonsTotal > 0);
  }
}

/* ── send ────────────────────────────────────────────────────────────────── */

export async function sendIntelligence(env, userId, message, store) {
  const fcm = store || new FcmStore(env?.PROFILE_DB);
  const targets = await fcm.activeTokens(userId);
  if (!targets.length) return { ok: false, reason: 'no-devices', sent: 0 };
  const out = await fcmSendToTokens(env, targets, {
    title: message.title,
    body: message.body,
    /* `key` is what the client echoes back so an open, a click and a later
     * learning action can all be attributed to this exact send. Without it the
     * conversion measurement has nothing to join on. */
    data: { link: message.link, src: 'fcm-intel', kind: message.kind, variant: message.variant, key: message.key || '' }
  });
  if (out.badIds?.length) await fcm.markInactive(out.badIds, Date.now());
  return { ok: out.sent > 0, sent: out.sent, failed: out.failed };
}

/* ── cron runner ─────────────────────────────────────────────────────────── */

/* One student at a time: read their state, compute signals, run the pipeline,
 * and only then touch the network. `deps` injects the clock, the transport and
 * the learning state so the whole thing is testable without a database. */
export async function runScheduledIntelligenceNotifications(env, deps = {}) {
  const now = deps.now ? Number(deps.now()) : Date.now();
  const store = deps.store || new IntelligenceStore(env?.PROFILE_DB);
  if (!store.available()) return { processed: 0, sent: 0, skipped: 0, reason: 'storage-unavailable' };
  if (!env?.__skipFcmCheck && deps.requireFcm !== false && !fcmConfigured(env)) {
    return { processed: 0, sent: 0, skipped: 0, reason: 'fcm-not-configured' };
  }

  const users = await store.audience();
  const send = deps.send || ((userId, message) => sendIntelligence(env, userId, message, new FcmStore(env?.PROFILE_DB)));
  const signalsFor = deps.signalsFor || null;

  let sent = 0;
  let skipped = 0;
  const results = [];

  for (const userId of users) {
    try {
      const state = await store.getState(userId);
      const { date } = localParts(now, state.tz_offset_min);
      const signals = signalsFor
        ? await signalsFor(userId, date)
        : await defaultSignals(store, userId, date, now, state.tz_offset_min);
      const fatigue = await store.fatigue(userId);

      const outcome = decide({
        signals,
        prefs: { ...state.prefs, tz_offset_min: state.tz_offset_min },
        fatigue,
        ctx: { hour: localParts(now, state.tz_offset_min).hour },
        deps: {
          nowMs: now,
          userId,
          hasDevices: true,
          sendsToday: await store.sendsToday(userId, date),
          categorySends: {},
          lastSentAt: await store.lastSentAt(userId),
          seenKeys: await store.seenKeys(userId),
          lang: state.prefs.lang || 'bn'
        }
      });

      if (outcome.decision !== 'send') {
        skipped += 1;
        results.push({ userId, decision: 'skip', stage: outcome.stage });
        try {
          await store.logDecision({
            userId, rule: 'none', kind: null, score: 0, decision: 'skip',
            stage: outcome.stage, reason: outcome.reason, dayKey: date, at: now
          });
        } catch (_) { /* the log must never break a run */ }
        continue;
      }

      const category = KIND_META[outcome.candidate.kind]?.category || 'learning';
      const claimed = await store.claimSend({
        userId, key: outcome.candidate.key, kind: outcome.candidate.kind,
        category, variant: outcome.variant, dayKey: date, at: now
      });
      if (!claimed) {
        skipped += 1;
        results.push({ userId, decision: 'skip', stage: 'duplicate-claim' });
        try {
          await store.logDecision({
            userId, rule: outcome.candidate.kind, kind: outcome.candidate.kind,
            score: KIND_META[outcome.candidate.kind]?.priority || 0, decision: 'skip',
            stage: 'duplicate-claim', reason: outcome.candidate.key, dayKey: date, at: now
          });
        } catch (_) { /* the log must never break a run */ }
        continue;
      }

      const delivered = await send(userId, outcome.message);
      if (delivered?.ok) sent += 1;
      results.push({ userId, decision: 'send', kind: outcome.candidate.kind, variant: outcome.variant, ok: Boolean(delivered?.ok) });
      try {
        await store.logDecision({
          userId, rule: outcome.candidate.kind, kind: outcome.candidate.kind,
          score: KIND_META[outcome.candidate.kind]?.priority || 0, decision: 'send',
          stage: 'send', reason: outcome.reason, dayKey: date, at: now
        });
      } catch (_) { /* the log must never break a run */ }
    } catch (err) {
      /* One bad account must not stop the run. */
      results.push({ userId, decision: 'error', error: String(err?.message || err).slice(0, 120) });
    }
  }

  return { processed: users.length, sent, skipped, results };
}

/* The production signals read. Each number comes from a Phase 1–2 table; when a
 * table is empty the signal is simply absent, and the pipeline sees a student
 * with nothing to say, which is the correct, silent outcome. */
async function defaultSignals(store, userId, dayKey, nowMs, tzOffsetMin) {
  const [dailyStats, examScores, mistakes, courses, history, activityAt] = await Promise.all([
    store.dailyStats(userId),
    store.examScores(userId),
    store.mistakeState(userId),
    store.courseProgress(userId),
    store.history(userId),
    store.lastActiveAt(userId)
  ]);
  return computeSignals({
    dailyStats,
    examScores,
    mistakes,
    courses,
    activityAt,
    history: history.map(h => ({ ...h, hour: localParts(h.sentAt, tzOffsetMin).hour }))
  }, nowMs, tzOffsetMin);
}

/* ── routes ──────────────────────────────────────────────────────────────── */

const jsonResponse = (request, obj, status = 200) => new Response(JSON.stringify(obj), {
  status,
  headers: {
    'Content-Type': 'application/json; charset=utf-8',
    ...corsHeaders(request),
    'Cache-Control': 'no-store'
  }
});

const ADMIN_PREFIX = '/api/notifications/intel/';
const OWNED_PATHS = new Set(['/api/notifications/intel-pref', '/api/notifications/outcome']);

/* Owns the student-facing preference/outcome routes and the admin preview,
 * run, performance and fatigue routes. Returns null when the path is not ours,
 * so the worker can fall through to the next handler. */
export async function handleIntelligenceRequest(request, env, deps = {}) {
  const url = new URL(request.url);
  const path = url.pathname;
  const nowMs = () => (typeof deps?.now === 'function' ? Number(deps.now()) : Date.now());

  /* Claim only our own paths, and claim them before anything else, this handler
   * runs ahead of the other /api/* handlers, so an unguarded early return here
   * would answer CORS preflight for the whole app. */
  if (!OWNED_PATHS.has(path) && !path.startsWith(ADMIN_PREFIX)) return null;

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: {
      ...corsHeaders(request),
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400'
    } });
  }

  /* ── student: timezone + per-category preferences ─────────────────────── */
  if (path === '/api/notifications/intel-pref') {
    const store = new IntelligenceStore(env?.PROFILE_DB);
    if (!store.available()) return jsonResponse(request, { error: 'storage-unavailable' }, 503);
    const session = await (deps.sessionUser || sessionUser)(env, request);
    if (!session) return jsonResponse(request, { error: 'auth-required' }, 401);
    const userId = String(session.user.id);

    if (request.method === 'GET') {
      const state = await store.getState(userId);
      return jsonResponse(request, { ok: true, tz_offset_min: state.tz_offset_min, prefs: state.prefs });
    }
    if (request.method === 'POST') {
      const body = await parseBody(request);
      if (!body) return jsonResponse(request, { error: 'invalid-body' }, 400);
      const patch = {};
      if (typeof body.tz_offset_min !== 'undefined') patch.tz_offset_min = body.tz_offset_min;
      for (const key of ['push_enabled', 'personalized_enabled', 'quiet_hours_enabled', 'quiet_start', 'quiet_end', 'lang']) {
        if (typeof body[key] !== 'undefined') patch[key] = body[key];
      }
      if (body.categories && typeof body.categories === 'object') patch.categories = body.categories;
      const saved = await store.saveState(userId, { tzOffsetMin: patch.tz_offset_min, prefs: patch }, nowMs());
      return jsonResponse(request, { ok: true, tz_offset_min: saved.tz_offset_min, prefs: saved.prefs });
    }
    return jsonResponse(request, { error: 'method-not-allowed' }, 405);
  }

  /* ── student: notification → learning conversion ──────────────────────── */
  if (path === '/api/notifications/outcome' && request.method === 'POST') {
    const store = new IntelligenceStore(env?.PROFILE_DB);
    if (!store.available()) return jsonResponse(request, { error: 'storage-unavailable' }, 503);
    const session = await (deps.sessionUser || sessionUser)(env, request);
    if (!session) return jsonResponse(request, { error: 'auth-required' }, 401);
    const userId = String(session.user.id);
    const body = await parseBody(request);
    if (!body) return jsonResponse(request, { error: 'invalid-body' }, 400);
    const action = String(body.action || '');
    const at = nowMs();

    /* `learning` is the interesting one: the client tells us the student did the
     * thing, and we credit the most recent send that can plausibly have caused
     * it rather than trusting a client-supplied notification id. */
    if (action === 'learning') {
      const kind = String(body.kind || '');
      if (!LEARNING_KINDS.includes(kind)) return jsonResponse(request, { error: 'invalid-kind' }, 400);
      const sends = await store.convertibleSends(userId, at - 6 * 3600 * 1000);
      const learningEvents = [{ kind, at }];
      for (const send of sends) {
        const credit = attributeConversion(send, learningEvents);
        if (credit.converted) {
          await store.markLearning({ userId, key: send.key, kind: credit.kind, at });
          return jsonResponse(request, { ok: true, credited: send.key, lagMs: credit.lagMs });
        }
      }
      return jsonResponse(request, { ok: true, credited: null });
    }

    const key = String(body.notification_key || body.key || '');
    if (!key) return jsonResponse(request, { error: 'missing-key' }, 400);
    const field = action === 'opened' ? 'opened_at' : action === 'clicked' ? 'clicked_at' : '';
    if (!field) return jsonResponse(request, { error: 'invalid-action' }, 400);
    const changed = await store.markOutcome({ userId, key, field, at });
    return jsonResponse(request, { ok: true, key, recorded: changed });
  }

  /* ── admin: everything else ───────────────────────────────────────────── */
  if (!path.startsWith(ADMIN_PREFIX)) return null;
  const token = String(request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!env.ADMIN_TOKEN || token !== env.ADMIN_TOKEN) return jsonResponse(request, { error: 'forbidden' }, 403);

  const store = new IntelligenceStore(env?.PROFILE_DB);
  if (!store.available()) return jsonResponse(request, { error: 'storage-unavailable' }, 503);

  if (path === `${ADMIN_PREFIX}preview` && request.method === 'GET') {
    const userId = String(url.searchParams.get('user') || '').trim();
    if (!userId) return jsonResponse(request, { error: 'missing-user' }, 400);
    const now = nowMs();
    const state = await store.getState(userId);
    const { date, hour } = localParts(now, state.tz_offset_min);
    const signals = deps.signalsFor ? await deps.signalsFor(userId, date) : await defaultSignals(store, userId, date, now, state.tz_offset_min);
    const fatigue = await store.fatigue(userId);
    const decision = decide({
      signals, prefs: { ...state.prefs, tz_offset_min: state.tz_offset_min }, fatigue,
      ctx: { hour },
      deps: {
        nowMs: now, userId, hasDevices: true,
        sendsToday: await store.sendsToday(userId, date),
        categorySends: {},
        lastSentAt: await store.lastSentAt(userId),
        seenKeys: await store.seenKeys(userId)
      }
    });
    return jsonResponse(request, {
      ok: true, user: userId,
      local: { date, hour, tz_offset_min: state.tz_offset_min },
      segment: classifySegment(signals),
      signals, fatigue, decision
    });
  }

  if (path === `${ADMIN_PREFIX}preview-all` && request.method === 'GET') {
    const now = nowMs();
    const users = await store.audience();
    const plan = [];
    for (const userId of users) {
      const state = await store.getState(userId);
      const { date, hour } = localParts(now, state.tz_offset_min);
      const signals = deps.signalsFor ? await deps.signalsFor(userId, date) : await defaultSignals(store, userId, date, now, state.tz_offset_min);
      const decision = decide({
        signals, prefs: { ...state.prefs, tz_offset_min: state.tz_offset_min }, fatigue: await store.fatigue(userId),
        ctx: { hour },
        deps: {
          nowMs: now, userId, hasDevices: true,
          sendsToday: await store.sendsToday(userId, date), categorySends: {},
          lastSentAt: await store.lastSentAt(userId), seenKeys: await store.seenKeys(userId)
        }
      });
      plan.push({ user: userId, segment: classifySegment(signals).segment, decision: decision.decision, stage: decision.stage, kind: decision.candidate?.kind || null });
    }
    return jsonResponse(request, { ok: true, audience: users.length, plan });
  }

  if (path === `${ADMIN_PREFIX}run` && request.method === 'POST') {
    const result = await runScheduledIntelligenceNotifications(env, { store, now: nowMs, signalsFor: deps.signalsFor });
    return jsonResponse(request, { ok: true, ...result });
  }

  if (path === `${ADMIN_PREFIX}performance` && request.method === 'GET') {
    const rows = await store.rowsForPerformance();
    return jsonResponse(request, { ok: true, ...computeFeedback(rows), rows: rows.length });
  }

  if (path === `${ADMIN_PREFIX}fatigue` && request.method === 'GET') {
    const userId = String(url.searchParams.get('user') || '').trim();
    if (!userId) return jsonResponse(request, { error: 'missing-user' }, 400);
    const history = await store.history(userId);
    return jsonResponse(request, { ok: true, user: userId, fatigue: detectFatigue(history, nowMs()) });
  }

  /* Section 20, the admin control tower. Eligible / sent / skipped for a day,
   * the top reason we held back, the top rule we sent, and per-kind CTR. */
  if (path === `${ADMIN_PREFIX}dashboard` && request.method === 'GET') {
    const day = String(url.searchParams.get('day') || '').trim();
    const targetDay = day || localParts(nowMs(), DEFAULT_TZ_OFFSET_MIN).date;
    const decisions = await store.decisionsForDay(targetDay);
    const outcomes = await store.outcomesForDay(targetDay);
    return jsonResponse(request, { ok: true, day: targetDay, ...computeDecisionStats(decisions, outcomes) });
  }

  return jsonResponse(request, { error: 'not-found' }, 404);
}

export const __intelligenceTest = Object.freeze({
  KIND_META, KIND_ORDER, DEFAULTS, DEFAULT_PREFS, PREF_CATEGORIES, AB_VARIANTS, AB_COPY,
  localParts, inQuietHours, inSendWindow, dayDiff,
  computeSignals, classifySegment, buildCandidates, rankCandidates,
  detectFatigue, effectiveCap, checkFrequency, dayPart, DAY_PART_WEIGHT, preferredHour, bestSendWindow,
  hashToInt, assignVariant, buildMessage, attributeConversion, LEARNING_KINDS,
  computePerformance, computeFeedback, computeDecisionStats, decide,
  IntelligenceStore, sendIntelligence, runScheduledIntelligenceNotifications, handleIntelligenceRequest
});
