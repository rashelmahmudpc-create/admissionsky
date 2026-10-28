/* Phase 4, Unified Analytics Engine & Smart Insights.
 *
 * One layer that turns the data Phase 1–3 already collected into metrics,
 * comparisons, trends and plain-language insights, for the student about
 * themselves, and for the admin about the platform.
 *
 * Data ownership is unchanged. This module reads what already exists and writes
 * nothing new:
 *   learning      user_daily_stats, user_exam_results, user_mistakes, user_activity
 *   course state  user_settings (the student's own course blob)
 *   notification  notification_outcomes, notification_sends        (Phase 3)
 *   campaigns     global_notifications, notification_reads, fcm_devices (Phase 1/2)
 *   funnel        the learning-event ledger, counted server-side
 *
 * Why the math lives here and not in the browser: `analytics-service.js` already
 * computes a client-side funnel from the on-device ledger, but it is a browser
 * UMD and the worker cannot import it. Rather than let a second, drifting copy
 * of the arithmetic appear, every Phase 4 figure is computed once, here, and
 * both dashboards read it over `/api/analytics/*`. The thresholds below mirror
 * `analytics-service.js` (funnel steps, 0.4 drop alert, minimum sample 5) and a
 * test pins them so the two cannot diverge silently.
 *
 * Everything in the "pure" section takes plain rows and returns plain objects:
 * no DOM, no storage, no network. That is what makes the numbers testable and
 * what makes them safe to hand to the Phase 5 AI layer as structured signals.
 */

import { DEFAULT_TZ_OFFSET_MIN, LEARNING_KINDS } from './notification-intelligence.mjs';
import { sessionUser } from './fcm-notification.mjs';
import { corsHeaders } from './cors-policy.mjs';

const DAY_MS = 86400000;

/* ── numbers ─────────────────────────────────────────────────────────────── */

const asInt = (v, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
};

const asNum = (v, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

const pct = (part, whole, dp = 1) => (whole > 0 ? Number(((part / whole) * 100).toFixed(dp)) : 0);

const ratio = (part, whole, dp = 4) => (whole > 0 ? Number((part / whole).toFixed(dp)) : 0);

const round = (n, dp = 2) => (Number.isFinite(Number(n)) ? Number(Number(n).toFixed(dp)) : 0);

const sum = (rows, pick) => rows.reduce((n, r) => n + asNum(pick(r)), 0);

/* ── days ────────────────────────────────────────────────────────────────── */

const parseDay = (day) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(day || ''));
  return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : NaN;
};

const formatDay = (ms) => new Date(ms).toISOString().slice(0, 10);

/* The student's local calendar day, not the server's. A student in Dhaka at
 * 02:00 is still on yesterday's date in UTC, and a dashboard that says
 * "today: 0" to someone mid-session is simply wrong. */
export function dayKey(ts, tzOffsetMin = DEFAULT_TZ_OFFSET_MIN) {
  const tz = Number.isFinite(Number(tzOffsetMin)) ? Number(tzOffsetMin) : DEFAULT_TZ_OFFSET_MIN;
  return formatDay(asInt(ts, Date.now()) + tz * 60000);
}

export function shiftDay(day, delta) {
  const base = parseDay(day);
  if (!Number.isFinite(base)) return '';
  return formatDay(base + asInt(delta) * DAY_MS);
}

export function daysBetween(from, to) {
  const a = parseDay(from);
  const b = parseDay(to);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.round((b - a) / DAY_MS);
}

/* Ascending list of `count` day keys ending at `endDay` (inclusive), so a chart
 * always has one bar per day even on a day the student did nothing. */
export function dayRange(endDay, count) {
  const end = parseDay(endDay);
  if (!Number.isFinite(end) || count <= 0) return [];
  const out = [];
  for (let i = count - 1; i >= 0; i -= 1) out.push(formatDay(end - i * DAY_MS));
  return out;
}

/* ── learning metrics ────────────────────────────────────────────────────── */

/* Longest run of consecutive active days. `days` must be unique and ascending. */
export function computeStreak(days = []) {
  const clean = [...new Set(days.filter(Boolean))].sort();
  if (!clean.length) return 0;
  let best = 1;
  let run = 1;
  for (let i = 1; i < clean.length; i += 1) {
    run = daysBetween(clean[i - 1], clean[i]) === 1 ? run + 1 : 1;
    if (run > best) best = run;
  }
  return best;
}

/* The streak that is still alive: it ends today or yesterday. A student who
 * studied yesterday but not yet today has not lost the streak, and showing 0
 * would be both wrong and demotivating. */
export function liveStreak(days = [], today = dayKey(Date.now())) {
  const set = new Set(days.filter(Boolean));
  if (!set.size) return 0;
  let cursor = set.has(today) ? today : shiftDay(today, -1);
  if (!set.has(cursor)) return 0;
  let run = 0;
  while (set.has(cursor)) { run += 1; cursor = shiftDay(cursor, -1); }
  return run;
}

/* Normalizes the four student-owned learning tables into the flat shape every
 * metric below consumes. `dailyStats` rows carry the day; the rest carry a
 * timestamp. */
export function normalizeLearning(input = {}) {
  const dailyStats = (Array.isArray(input.dailyStats) ? input.dailyStats : [])
    .map(r => ({
      day: String(r.day || r.date || '').slice(0, 10),
      questions: asInt(r.questions),
      correct: asInt(r.correct),
      wrong: asInt(r.wrong),
      lessons: asInt(r.lessons),
      timeMs: asInt(r.timeMs ?? r.time),
      exams: asInt(r.exams)
    }))
    .filter(r => /^\d{4}-\d{2}-\d{2}$/.test(r.day));

  const exams = (Array.isArray(input.examResults) ? input.examResults : [])
    .map(r => ({
      id: String(r.id || ''),
      score: asNum(r.score ?? r.percentage, NaN),
      at: asInt(r.at ?? r.updated_at ?? r.completedAt)
    }))
    .filter(r => r.id);

  const mistakes = (Array.isArray(input.mistakes) ? input.mistakes : [])
    .map(r => ({ topic: String(r.topic || r.topicId || 'general'), misses: asInt(r.misses) }));

  const courses = (Array.isArray(input.courses) ? input.courses : [])
    .map(c => ({
      id: String(c.id || ''),
      lessonsTotal: asInt(c.lessonsTotal),
      lessonsDone: asInt(c.lessonsDone)
    }))
    .filter(c => c.id && c.lessonsTotal > 0);

  return { dailyStats, exams, mistakes, courses };
}

/* The ten student metrics the brief names, from the four tables above. Pure. */
export function computeLearningMetrics(input = {}, options = {}) {
  const { dailyStats, exams, mistakes, courses } = normalizeLearning(input);
  const today = options.today || dayKey(options.nowMs ?? Date.now(), options.tzOffsetMin);

  const activeDays = [...new Set(dailyStats
    .filter(d => d.questions > 0 || d.correct > 0 || d.wrong > 0 || d.lessons > 0 || d.timeMs > 0 || d.exams > 0)
    .map(d => d.day))].sort();

  const questions = sum(dailyStats, d => d.questions);
  const correct = sum(dailyStats, d => d.correct);
  const wrong = sum(dailyStats, d => d.wrong);
  const answered = correct + wrong;

  /* Accuracy falls back to the daily counters; when a student only ever ran
   * exams, the exam scores are the only honest source. */
  const accuracy = answered > 0
    ? pct(correct, answered, 1)
    : (exams.length ? round(sum(exams, e => e.score) / exams.length, 1) : 0);

  const lessonsCompleted = sum(dailyStats, d => d.lessons);
  const learningTimeMs = sum(dailyStats, d => d.timeMs);

  const coursesStarted = courses.filter(c => c.lessonsDone > 0).length;
  const coursesCompleted = courses.filter(c => c.lessonsDone >= c.lessonsTotal).length;
  const lessonsTotal = sum(courses, c => c.lessonsTotal);
  const lessonsDone = sum(courses, c => c.lessonsDone);

  const byDay = new Map(dailyStats.map(d => [d.day, d]));
  const series = dayRange(today, options.seriesDays ?? 14).map(day => {
    const d = byDay.get(day);
    return {
      day,
      questions: d?.questions ?? 0,
      correct: d?.correct ?? 0,
      lessons: d?.lessons ?? 0,
      timeMs: d?.timeMs ?? 0,
      active: activeDays.includes(day)
    };
  });

  /* A student is "returning" when they were away for a while and came back -
   * derived from their own day history rather than from a caller's hint, so the
   * admin segmentation (which has no such hint) can still produce the segment. */
  const hadGap = (() => {
    for (let i = 1; i < activeDays.length; i += 1) {
      if (daysBetween(activeDays[i - 1], activeDays[i]) >= 4) return true;
    }
    return false;
  })();

  return {
    learningTimeMs,
    learningMinutes: Math.round(learningTimeMs / 60000),
    lessonsCompleted,
    quizActivity: exams.length,
    practiceActivity: questions,
    questionsCorrect: correct,
    questionsWrong: wrong,
    accuracy,
    streak: liveStreak(activeDays, today),
    longestStreak: computeStreak(activeDays),
    activeDays: activeDays.length,
    hadGap,
    lastActiveDay: activeDays[activeDays.length - 1] || null,
    daysSinceActive: activeDays.length ? Math.max(0, daysBetween(activeDays[activeDays.length - 1], today)) : null,
    courseProgress: {
      courses: courses.length,
      started: coursesStarted,
      completed: coursesCompleted,
      lessonsTotal,
      lessonsDone,
      percent: pct(lessonsDone, lessonsTotal, 1)
    },
    mistakes: {
      pending: sum(mistakes, m => m.misses),
      topics: mistakes.slice(0, 5)
    },
    series
  };
}

/* ── comparison ──────────────────────────────────────────────────────────── */

/* A metric's value in the current window against the one before it. `change` is
 * signed and `direction` is what the UI colours, so a fall is never drawn as a
 * rise by a stray sign. */
export function compareValue(current, previous) {
  const cur = asNum(current);
  const prev = asNum(previous);
  const delta = round(cur - prev, 2);
  const percent = prev > 0 ? round(((cur - prev) / prev) * 100, 1) : (cur > 0 ? 100 : 0);
  return {
    current: cur,
    previous: prev,
    delta,
    percent,
    direction: delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat'
  };
}

/* Splits a daily-stat series into "the last N days" and "the N days before
 * that", so every window comparison uses one definition of a period. */
export function splitPeriods(series = [], days = 7) {
  const rows = Array.isArray(series) ? series : [];
  const current = rows.slice(-days);
  const previous = rows.slice(-days * 2, -days);
  return { current, previous };
}

export function comparePeriods(series = [], days = 7) {
  const { current, previous } = splitPeriods(series, days);
  const active = rows => rows.filter(r => r.active).length;
  const pick = {
    practiceActivity: rows => sum(rows, r => r.questions),
    lessonsCompleted: rows => sum(rows, r => r.lessons),
    learningTimeMs: rows => sum(rows, r => r.timeMs),
    activeDays: active,
    accuracy: rows => {
      const c = sum(rows, r => r.correct);
      const w = sum(rows, r => r.wrong);
      return c + w > 0 ? pct(c, c + w, 1) : 0;
    }
  };
  const out = {};
  for (const [key, fn] of Object.entries(pick)) out[key] = compareValue(fn(current), fn(previous));
  return { days, current, previous, metrics: out };
}

/* ── trends ──────────────────────────────────────────────────────────────── */

/* Least-squares slope over the last `window` points, expressed as a share of the
 * mean so a busy student and a quiet one are judged on shape, not volume. A
 * trend needs at least three points and a non-zero mean; otherwise it is flat. */
export function linearTrend(values = [], options = {}) {
  const points = (Array.isArray(values) ? values : []).map(v => asNum(v));
  const window = Math.max(3, asInt(options.window, 7));
  const slice = points.slice(-window);
  if (slice.length < 3) return { slope: 0, direction: 'flat', strength: 0, mean: 0 };
  const n = slice.length;
  const meanX = (n - 1) / 2;
  const meanY = sum(slice, v => v) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i += 1) {
    num += (i - meanX) * (slice[i] - meanY);
    den += (i - meanX) ** 2;
  }
  const slope = den > 0 ? num / den : 0;
  const strength = meanY > 0 ? clamp01(Math.abs(slope) / meanY) : 0;
  /* Below 5% of the mean per day is noise, not a trend. */
  const direction = strength < (options.minStrength ?? 0.05) ? 'flat' : (slope > 0 ? 'up' : 'down');
  return { slope: round(slope, 3), direction, strength: round(strength, 3), mean: round(meanY, 2) };
}

const clamp01 = n => Math.min(1, Math.max(0, n));

export function detectTrends(series = [], options = {}) {
  const rows = Array.isArray(series) ? series : [];
  const window = asInt(options.window, 7);
  return {
    practiceActivity: linearTrend(rows.map(r => r.questions), { window }),
    lessonsCompleted: linearTrend(rows.map(r => r.lessons), { window }),
    learningTime: linearTrend(rows.map(r => r.timeMs), { window }),
    accuracy: linearTrend(rows.map(r => {
      const c = asNum(r.correct);
      const w = asNum(r.wrong);
      return c + w > 0 ? pct(c, c + w, 1) : 0;
    }), { window })
  };
}

/* ── segmentation ────────────────────────────────────────────────────────── */

/* Behaviour segments. A student lands in exactly one, checked from the most
 * urgent state to the least, because "at risk" must win over "active" for a
 * student who was busy a month ago. Thresholds are deliberately blunt, a
 * segment is a routing hint for the Phase 3 engine, not a verdict.
 *
 * There is no separate "dormant" state: a student who is quiet but still inside
 * the at-risk window is `at_risk`, and one who has been gone longer is
 * `inactive`. A third word for the same thing would only be a label nothing
 * could route on. */
export const SEGMENTS = Object.freeze(['new', 'active', 'highly_active', 'returning', 'at_risk', 'inactive']);

export function classifyBehaviourSegment(metrics = {}, options = {}) {
  const today = options.today || dayKey(options.nowMs ?? Date.now(), options.tzOffsetMin);
  const since = metrics.daysSinceActive;
  const activeDays = asInt(metrics.activeDays);
  const streak = asInt(metrics.streak);
  const windowDays = asInt(options.windowDays, 14);
  const trend = options.trend || null;

  if (activeDays === 0) return { segment: since === null ? 'new' : 'inactive', reason: 'no-activity' };
  if (since !== null && since >= 14) return { segment: 'inactive', reason: `inactive-${since}d` };
  if (since !== null && since >= 4) return { segment: 'at_risk', reason: `quiet-${since}d` };
  /* "Came back after a gap" comes from the student's own day history, with an
   * explicit option for a caller that knows something better (e.g. a re-engagement
   * campaign attribution). */
  if (options.returnedAfterGap ?? metrics.hadGap) return { segment: 'returning', reason: 'came-back' };
  if (activeDays <= 2) return { segment: 'new', reason: 'just-started' };
  if (activeDays >= Math.max(7, Math.ceil(windowDays * 0.6)) || streak >= 7) {
    return { segment: 'highly_active', reason: streak >= 7 ? `streak-${streak}` : `active-${activeDays}d` };
  }
  if (trend && trend.direction === 'down' && trend.strength >= 0.15) return { segment: 'at_risk', reason: 'activity-falling' };
  return { segment: 'active', reason: `active-${activeDays}d` };
}

/* Learning stage, how far through the content a student actually is. Separate
 * from the behaviour segment on purpose: a pro can be at risk, a beginner can be
 * highly active, and the Phase 3 engine wants both facts. */
export function classifyLearningStage(metrics = {}) {
  const lessons = asInt(metrics.lessonsCompleted);
  const questions = asInt(metrics.practiceActivity);
  const completed = asInt(metrics.courseProgress?.completed);
  if (completed >= 3 || lessons >= 40 || questions >= 500) return { stage: 'pro', lessons, questions };
  if (lessons >= 10 || questions >= 100) return { stage: 'intermediate', lessons, questions };
  return { stage: 'beginner', lessons, questions };
}

/* ── funnel & drop-off ───────────────────────────────────────────────────── */

/* Same steps and the same 0.4 / 5 thresholds as `analytics-service.js`; a test
 * pins the pair so the browser panel and the admin panel cannot disagree. */
export const FUNNEL_STEPS = Object.freeze([
  { key: 'course_view', event: 'course_view' },
  { key: 'course_start', event: 'course_start' },
  { key: 'lesson_start', event: 'lesson_start' },
  { key: 'lesson_complete', event: 'lesson_complete' },
  { key: 'quiz_start', event: 'quiz_start' },
  { key: 'quiz_complete', event: 'quiz_complete' }
]);

export const DROPOFF_ALERT_RATE = 0.4;
export const DROPOFF_MIN_SAMPLE = 5;

export function countByEvent(events = []) {
  const out = {};
  for (const e of events) {
    const name = String(e?.name || '');
    if (name) out[name] = (out[name] || 0) + 1;
  }
  return out;
}

export function buildFunnel(counts = {}) {
  return FUNNEL_STEPS.map((step, index) => {
    const count = asInt(counts[step.event]);
    const previous = index === 0 ? count : asInt(counts[FUNNEL_STEPS[index - 1].event]);
    return {
      key: step.key,
      event: step.event,
      count,
      reachRate: index === 0 ? 1 : ratio(count, previous),
      dropRate: index === 0 ? 0 : (previous ? round((previous - count) / previous, 4) : 0)
    };
  });
}

/* The steepest step that keeps far fewer students than the one before it, and
 * only once enough students reached it to make a percentage meaningful. Ties
 * break toward the earliest step, that is the one worth fixing first. */
export function detectFunnelDropOff(funnel = [], options = {}) {
  const alertRate = options.alertRate ?? DROPOFF_ALERT_RATE;
  const minSample = options.minSample ?? DROPOFF_MIN_SAMPLE;
  const eligible = funnel.filter(s => s.count >= minSample && s.dropRate >= alertRate);
  const steepest = eligible.length
    ? eligible.reduce((worst, s) => (s.dropRate > worst.dropRate ? s : worst), eligible[0])
    : null;
  return {
    hasAlert: Boolean(steepest),
    steepest: steepest ? steepest.key : null,
    dropRate: steepest ? steepest.dropRate : 0,
    threshold: alertRate,
    minSample,
    message: steepest ? dropOffMessage(steepest.key, steepest.dropRate) : ''
  };
}

export function dropOffMessage(key, rate) {
  const labels = {
    course_start: 'Course খোলার পর শুরু করেনি',
    lesson_start: 'Course শুরু করে পাঠ শুরু করেনি',
    lesson_complete: 'পাঠ শুরু করে শেষ করেনি',
    quiz_start: 'পাঠ শেষ করে কুইজ শুরু করেনি',
    quiz_complete: 'কুইজ শুরু করে শেষ করেনি'
  };
  return `${labels[key] || key}, ${Math.round(asNum(rate) * 100)}% এখানেই থেমে গেছে।`;
}

/* ── course / lesson / quiz analytics ────────────────────────────────────── */

/* Per-course rollup. `rows` are the student's course blobs (any number of
 * students); `events` are learning events carrying course_id/lesson_id. */
export function buildCourseAnalytics(rows = [], events = []) {
  const byCourse = new Map();
  const ensure = (id) => {
    if (!byCourse.has(id)) {
      byCourse.set(id, {
        courseId: id, learners: 0, activeLearners: 0, started: 0, completed: 0,
        lessonsTotal: 0, lessonsDone: 0, views: 0, starts: 0,
        lessonStarts: 0, lessonCompletes: 0, quizzes: 0
      });
    }
    return byCourse.get(id);
  };

  for (const row of rows) {
    const id = String(row?.courseId || row?.id || '');
    if (!id) continue;
    const c = ensure(id);
    c.learners += 1;
    c.lessonsTotal += asInt(row.lessonsTotal);
    c.lessonsDone += asInt(row.lessonsDone);
    if (asInt(row.lessonsDone) > 0) c.started += 1;
    if (asInt(row.lessonsTotal) > 0 && asInt(row.lessonsDone) >= asInt(row.lessonsTotal)) c.completed += 1;
    if (asInt(row.questions) > 0 || asInt(row.lessonsDone) > 0) c.activeLearners += 1;
  }

  for (const e of events) {
    const p = e?.params || {};
    const id = String(p.course_id || p.courseId || '');
    if (!id) continue;
    const c = ensure(id);
    if (e.name === 'course_view') c.views += 1;
    else if (e.name === 'course_start') c.starts += 1;
    else if (e.name === 'lesson_start') c.lessonStarts += 1;
    else if (e.name === 'lesson_complete') c.lessonCompletes += 1;
    else if (e.name === 'quiz_complete' || e.name === 'quiz_start') c.quizzes += 1;
  }

  return [...byCourse.values()].map(c => ({
    ...c,
    progressPercent: pct(c.lessonsDone, c.lessonsTotal, 1),
    completionRate: pct(c.completed, c.learners, 1),
    startRate: pct(c.started, c.learners, 1),
    lessonCompletionRate: pct(c.lessonCompletes, c.lessonStarts, 1)
  })).sort((a, b) => b.learners - a.learners);
}

/* Per-lesson performance. This is the only place the platform can see a single
 * lesson, and it is why events are ingested at all: `user_daily_stats.lessons`
 * is a count with no lesson id, so lesson-level quality is invisible without
 * them. */
export function buildLessonAnalytics(events = []) {
  const byLesson = new Map();
  const ensure = (courseId, lessonId) => {
    const key = `${courseId}::${lessonId}`;
    if (!byLesson.has(key)) {
      byLesson.set(key, {
        courseId, lessonId, views: 0, starts: 0, completes: 0,
        timeMs: 0, timeSamples: 0, retries: 0, quizAttempts: 0, quizCorrect: 0, exits: 0
      });
    }
    return byLesson.get(key);
  };

  const startedAt = new Map();
  for (const e of events) {
    const p = e?.params || {};
    const courseId = String(p.course_id || p.courseId || '');
    const lessonId = String(p.lesson_id || p.lessonId || '');
    if (!courseId || !lessonId) continue;
    const l = ensure(courseId, lessonId);
    const at = asInt(e.at);
    if (e.name === 'lesson_view') l.views += 1;
    else if (e.name === 'lesson_start') {
      l.starts += 1;
      const seen = startedAt.get(`${courseId}::${lessonId}`);
      if (seen) l.retries += 1;              /* a second start is a re-read */
      startedAt.set(`${courseId}::${lessonId}`, at);
    } else if (e.name === 'lesson_complete') {
      l.completes += 1;
      const seen = startedAt.get(`${courseId}::${lessonId}`);
      const dur = asInt(p.duration);
      if (dur > 0) { l.timeMs += dur; l.timeSamples += 1; }
      else if (seen && at > seen) { l.timeMs += at - seen; l.timeSamples += 1; }
    } else if (e.name === 'question_attempt') {
      l.quizAttempts += 1;
      if (p.correct === true || p.correct === 'true' || asInt(p.correct) === 1) l.quizCorrect += 1;
    } else if (e.name === 'quiz_complete') l.exits += 1;
  }

  return [...byLesson.values()].map(l => ({
    ...l,
    viewRate: ratio(l.views, Math.max(l.views, l.starts)),
    startRate: ratio(l.starts, l.views || l.starts),
    completionRate: ratio(l.completes, l.starts),
    avgTimeMs: l.timeSamples ? Math.round(l.timeMs / l.timeSamples) : 0,
    retryRate: ratio(l.retries, l.starts),
    quizAccuracy: pct(l.quizCorrect, l.quizAttempts, 1)
  })).sort((a, b) => a.completionRate - b.completionRate);
}

/* Quiz & practice analytics from committed attempts. Retry and drop-off are read
 * from the same rows, so a hard question shows up as low accuracy AND a high
 * retry rate rather than as two unrelated numbers. */
export function buildQuizAnalytics(events = []) {
  const byQuiz = new Map();
  const ensure = (id) => {
    if (!byQuiz.has(id)) {
      byQuiz.set(id, { quizId: id, attempts: 0, correct: 0, wrong: 0, skipped: 0, completed: 0, started: 0, timeMs: 0, timeSamples: 0, byTopic: new Map() });
    }
    return byQuiz.get(id);
  };

  for (const e of events) {
    const p = e?.params || {};
    const id = String(p.quiz_id || p.quizId || p.course_id || p.courseId || '');
    if (!id) continue;
    const q = ensure(id);
    if (e.name === 'quiz_start') q.started += 1;
    else if (e.name === 'quiz_complete') q.completed += 1;
    else if (e.name === 'question_attempt') {
      q.attempts += 1;
      const isCorrect = p.correct === true || p.correct === 'true' || asInt(p.correct) === 1;
      const isSkipped = p.skipped === true || p.skipped === 'true';
      if (isSkipped) q.skipped += 1;
      else if (isCorrect) q.correct += 1;
      else q.wrong += 1;
      const dur = asInt(p.duration);
      if (dur > 0) { q.timeMs += dur; q.timeSamples += 1; }
      const topic = String(p.topic_id || p.topicId || '');
      if (topic) {
        const t = q.byTopic.get(topic) || { topic, attempts: 0, correct: 0 };
        t.attempts += 1;
        if (isCorrect) t.correct += 1;
        q.byTopic.set(topic, t);
      }
    }
  }

  return [...byQuiz.values()].map(q => ({
    quizId: q.quizId,
    attempts: q.attempts,
    correct: q.correct,
    wrong: q.wrong,
    skipped: q.skipped,
    completed: q.completed,
    accuracy: pct(q.correct, q.attempts, 1),
    avgTimeMs: q.timeSamples ? Math.round(q.timeMs / q.timeSamples) : 0,
    completionRate: ratio(q.completed, q.started),
    retryRate: ratio(Math.max(0, q.attempts - 1), q.attempts),
    hardestTopics: [...q.byTopic.values()]
      .map(t => ({ topic: t.topic, attempts: t.attempts, accuracy: pct(t.correct, t.attempts, 1) }))
      .filter(t => t.attempts >= DROPOFF_MIN_SAMPLE)
      .sort((a, b) => a.accuracy - b.accuracy)
      .slice(0, 5)
  })).sort((a, b) => a.accuracy - b.accuracy);
}

/* ── engagement ──────────────────────────────────────────────────────────── */

/* DAU/WAU/MAU from per-student active days. `students` is one entry per student:
 * { userId, activeDays: ['YYYY-MM-DD', ...] }. Engagement is counted in active
 * students, never app opens, opening the app is not learning. */
export function computeEngagement(students = [], options = {}) {
  const today = options.today || dayKey(options.nowMs ?? Date.now(), options.tzOffsetMin);
  const rows = (Array.isArray(students) ? students : []).filter(s => s && s.userId);

  const within = (days) => {
    const cutoff = shiftDay(today, -(days - 1));
    return rows.filter(s => (s.activeDays || []).some(d => d >= cutoff && d <= today));
  };

  const dau = within(1).length;
  const wau = within(7).length;
  const mau = within(30).length;

  /* Sessions and their duration: a day with activity is one session, and the
   * daily stats carry the minutes. Rough by construction, and honest about it. */
  const sessionRows = rows.flatMap(s => (s.sessions || []));
  const totalMs = sum(sessionRows, r => r.timeMs);
  const sessionCount = sessionRows.length;

  const returning = rows.filter(s => (s.activeDays || []).length > 1).length;

  return {
    dau, wau, mau,
    dauWauRatio: ratio(dau, wau),
    wauMauRatio: ratio(wau, mau),
    stickiness: pct(dau, mau, 1),
    sessions: sessionCount,
    avgSessionMs: sessionCount ? Math.round(totalMs / sessionCount) : 0,
    activeStudents: mau,
    totalStudents: rows.length,
    returningUsers: returning,
    newUsers: rows.length - returning,
    returningRate: pct(returning, rows.length, 1),
    learningActiveStudents: rows.filter(s => asInt(s.learningActions) > 0).length
  };
}

/* ── retention ───────────────────────────────────────────────────────────── */

/* Cohort retention: a student's first active day is their cohort, and D1/D7/D14/
 * D30 asks whether they came back on or after that day + N. Mature cohorts only:
 * a student who joined yesterday cannot have returned on D30, and counting them
 * as a failure is the single most common way a retention number lies. */
export const RETENTION_WINDOWS = Object.freeze([1, 7, 14, 30]);

export function computeRetention(students = [], options = {}) {
  const today = options.today || dayKey(options.nowMs ?? Date.now(), options.tzOffsetMin);
  const rows = (Array.isArray(students) ? students : []).filter(s => s && s.userId && (s.activeDays || []).length);

  const cohorts = new Map();
  const buckets = new Map(RETENTION_WINDOWS.map(w => [w, { window: w, cohortSize: 0, retained: 0, matureCohortSize: 0, rate: 0 }]));

  for (const s of rows) {
    const days = [...new Set(s.activeDays.filter(Boolean))].sort();
    if (!days.length) continue;
    const first = days[0];
    const age = daysBetween(first, today);
    if (!cohorts.has(first)) cohorts.set(first, { cohort: first, size: 0, retained: {}, matureSize: {} });
    const cohort = cohorts.get(first);
    cohort.size += 1;

    for (const w of RETENTION_WINDOWS) {
      const bucket = buckets.get(w);
      const mature = age >= w;
      /* A student younger than the window is excluded from the denominator
       * entirely, so an immature cohort cannot drag the rate down. */
      if (mature) {
        bucket.matureCohortSize += 1;
        cohort.matureSize[w] = (cohort.matureSize[w] || 0) + 1;
      }
      const target = shiftDay(first, w);
      const cameBack = days.some(d => d >= target);
      if (cameBack && mature) {
        bucket.retained += 1;
        cohort.retained[w] = (cohort.retained[w] || 0) + 1;
      }
    }
  }

  const windows = [...buckets.values()]
    .map(b => ({ ...b, rate: pct(b.retained, b.matureCohortSize, 1) }))
    .sort((a, b) => a.window - b.window);

  return {
    windows,
    byWindow: Object.fromEntries(windows.map(w => [`d${w.window}`, w.rate])),
    cohortSize: rows.length,
    cohortCount: cohorts.size,
    cohorts: [...cohorts.values()]
      .map(c => ({
        cohort: c.cohort,
        size: c.size,
        d1: pct(c.retained[1] || 0, c.matureSize[1] || 0, 1),
        d7: pct(c.retained[7] || 0, c.matureSize[7] || 0, 1),
        d14: pct(c.retained[14] || 0, c.matureSize[14] || 0, 1),
        d30: pct(c.retained[30] || 0, c.matureSize[30] || 0, 1)
      }))
      .sort((a, b) => (a.cohort < b.cohort ? 1 : -1))
      .slice(0, 12)
  };
}

/* ── notification & campaign analytics ───────────────────────────────────── */

/* The Phase 3 outcome rows already carry the whole funnel: sent → opened →
 * clicked → learning. Nothing is recollected; this only aggregates. The metric
 * that matters most is conversion, a notification that is opened but never
 * leads to study has not worked, however good the open rate looks. */
export function computeNotificationAnalytics(outcomes = [], options = {}) {
  const rows = (Array.isArray(outcomes) ? outcomes : []).filter(o => o && o.notification_key);

  const bucket = (list) => {
    const sent = list.length;
    const opened = list.filter(o => asInt(o.opened_at) > 0).length;
    const clicked = list.filter(o => asInt(o.clicked_at) > 0).length;
    const learning = list.filter(o => asInt(o.learning_at) > 0 && LEARNING_KINDS.includes(String(o.learning_kind || ''))).length;
    return {
      sent, opened, clicked, learning,
      openRate: pct(opened, sent, 1),
      clickRate: pct(clicked, sent, 1),
      learningConversion: pct(learning, sent, 1),
      /* Of the students who engaged, how many actually studied, separates a
       * good subject line from a good nudge. */
      clickToLearning: pct(learning, clicked, 1),
      openToLearning: pct(learning, opened, 1)
    };
  };

  const overall = bucket(rows);

  const group = (keyOf) => {
    const map = new Map();
    for (const o of rows) {
      const key = String(keyOf(o) || 'unknown');
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(o);
    }
    return [...map.entries()]
      .map(([key, list]) => ({ key, ...bucket(list) }))
      .sort((a, b) => b.sent - a.sent);
  };

  const categories = group(o => o.category);
  const kinds = group(o => o.kind);
  const variants = group(o => o.variant);
  const campaigns = group(o => o.campaign || o.day_key);

  const best = (list) => (list.length ? list.reduce((w, x) => (x.learningConversion > w.learningConversion ? x : w), list[0]) : null);
  const worst = (list) => (list.length ? list.reduce((w, x) => (x.learningConversion < w.learningConversion ? x : w), list[0]) : null);

  return {
    overall,
    categories,
    kinds,
    variants,
    campaigns,
    bestCategory: best(categories),
    bestKind: best(kinds),
    bestVariant: best(variants),
    worstCategory: categories.length > 1 ? worst(categories) : null,
    /* Which part of the local day the student actually acted on. */
    byHour: (() => {
      const map = new Map();
      for (const o of rows) {
        const at = asInt(o.learning_at) || asInt(o.clicked_at);
        if (!at) continue;
        const hour = new Date(at).getUTCHours();
        map.set(hour, (map.get(hour) || 0) + 1);
      }
      return [...map.entries()].map(([hour, n]) => ({ hour, actions: n })).sort((a, b) => b.actions - a.actions);
    })()
  };
}

/* Campaign performance: the admin-visible view over global sends, joined to the
 * reads Phase 1 recorded. `globals` are global_notifications rows, `readCounts`
 * maps notification id → distinct readers (same input `analytics-notifications`
 * takes, so the two panels agree). */
export function computeCampaignAnalytics(globals = [], readCounts = {}) {
  return (Array.isArray(globals) ? globals : []).map(g => {
    const id = String(g.id || '');
    const delivered = asInt(g.delivered);
    const readers = asInt(readCounts?.[id]);
    const status = String(g.status || '');
    return {
      campaignId: id,
      type: String(g.type || ''),
      audience: String(g.audience || 'all_students'),
      topic: String(g.topic || ''),
      status,
      sentAt: asInt(g.sent_at),
      scheduledAt: asInt(g.scheduled_at),
      delivered,
      opened: readers,
      failed: status === 'failed',
      openRate: pct(readers, delivered, 1),
      /* A campaign is only judged once it has actually gone out. */
      isLive: status === 'sent' && delivered > 0
    };
  }).sort((a, b) => b.sentAt - a.sentAt);
}

/* Ranks campaigns by open rate among those with enough reach to mean anything. */
export function rankCampaigns(campaigns = [], minDelivered = DROPOFF_MIN_SAMPLE) {
  const live = campaigns.filter(c => c.isLive && c.delivered >= minDelivered);
  const ranked = [...live].sort((a, b) => b.openRate - a.openRate);
  return { ranked, best: ranked[0] || null, worst: ranked.length > 1 ? ranked[ranked.length - 1] : null };
}

/* ── milestones ──────────────────────────────────────────────────────────── */

/* The next round number a student is actually close to. A milestone the student
 * can reach this week motivates; one that is 60% away does not, so the list is
 * ordered by how soon it is reachable and the nearest one is surfaced. */
export const MILESTONES = Object.freeze([10, 25, 50, 75, 90, 100]);

export function computeMilestones(metrics = {}, options = {}) {
  const progress = metrics.courseProgress || {};
  const percent = asNum(progress.percent);
  const lessonsDone = asInt(progress.lessonsDone);
  const lessonsTotal = asInt(progress.lessonsTotal);
  const questions = asInt(metrics.practiceActivity);
  const streak = asInt(metrics.streak);

  const out = [];

  const nextPercent = MILESTONES.find(m => m > percent);
  if (nextPercent !== undefined) {
    const lessonsNeeded = lessonsTotal > 0
      ? Math.max(1, Math.ceil((nextPercent / 100) * lessonsTotal) - lessonsDone)
      : null;
    out.push({
      kind: 'course_progress',
      target: nextPercent,
      current: round(percent, 1),
      remaining: round(nextPercent - percent, 1),
      lessonsNeeded,
      message: lessonsNeeded
        ? `আর ${lessonsNeeded}টি পাঠ শেষ করলেই ${nextPercent}% milestone।`
        : `আর ${round(nextPercent - percent, 1)}% এগোলেই ${nextPercent}% milestone।`
    });
  }

  for (const target of [7, 14, 30, 50, 100]) {
    if (streak < target) {
      out.push({
        kind: 'streak',
        target,
        current: streak,
        remaining: target - streak,
        message: `আর ${target - streak} দিন চালিয়ে গেলে ${target} দিনের streak।`
      });
      break;
    }
  }

  for (const target of [100, 250, 500, 1000]) {
    if (questions < target) {
      out.push({
        kind: 'practice',
        target,
        current: questions,
        remaining: target - questions,
        message: `আর ${target - questions}টি প্রশ্ন অভ্যাস করলেই ${target}টি সম্পূর্ণ।`
      });
      break;
    }
  }

  return { milestones: out, next: out[0] || null, percent: round(percent, 1) };
}

/* ── insight engine ──────────────────────────────────────────────────────── */

/* Turns metrics into sentences a student can act on, and signals an admin can
 * investigate. An insight is only emitted when the data supports it: a claim
 * needs a sample and a direction, otherwise it is noise dressed as advice. The
 * output is deliberately plain objects, the same structure the Phase 5 AI layer
 * will consume, so nothing has to be re-derived later. */

export const INSIGHT_KINDS = Object.freeze(['positive', 'attention', 'neutral']);

const insight = (kind, id, text, data = {}) => ({ kind, id, text, ...data });

export function buildStudentInsights(metrics = {}, context = {}) {
  const out = [];
  const trend = context.trend || null;
  const comparison = context.comparison || null;
  const accuracy = asNum(metrics.accuracy);
  const practice = asInt(metrics.practiceActivity);
  const lessons = asInt(metrics.lessonsCompleted);
  const streak = asInt(metrics.streak);

  /* Positive first: what is working is as actionable as what is not, and a
   * dashboard that only ever reports problems gets ignored. */
  if (comparison?.metrics?.practiceActivity) {
    const c = comparison.metrics.practiceActivity;
    if (c.direction === 'up' && c.previous > 0) {
      out.push(insight('positive', 'practice-up',
        `📈 এই সপ্তাহে তোমার অভ্যাস গত সপ্তাহের চেয়ে ${c.percent}% বেড়েছে।`, { change: c.percent }));
    }
  }
  if (comparison?.metrics?.lessonsCompleted) {
    const c = comparison.metrics.lessonsCompleted;
    if (c.direction === 'up' && c.previous > 0) {
      out.push(insight('positive', 'lessons-up',
        `📚 গত সপ্তাহের তুলনায় ${c.delta}টি বেশি পাঠ শেষ করেছ।`, { change: c.delta }));
    }
  }
  if (streak >= 3) {
    out.push(insight('positive', 'streak',
      `🔥 টানা ${streak} দিন পড়ছ, এই ছন্দটা ধরে রাখো।`, { streak }));
  }
  if (practice >= 20 && accuracy >= 80) {
    out.push(insight('positive', 'accuracy',
      `🎯 তোমার নির্ভুলতা ${accuracy}%, বেশ ভালো। এখন একটু কঠিন প্রশ্নে যাওয়ার সময়।`, { accuracy }));
  }

  /* Course progress gets a named call-out, because "which section" is the part
   * a raw percentage cannot say. */
  const courses = Array.isArray(context.courses) ? context.courses : [];
  if (courses.length) {
    const top = [...courses].sort((a, b) => pct(b.lessonsDone, b.lessonsTotal, 1) - pct(a.lessonsDone, a.lessonsTotal, 1))[0];
    const percent = pct(top.lessonsDone, top.lessonsTotal, 1);
    if (percent > 0) {
      out.push(insight('neutral', 'course-focus',
        `🎯 তোমার সবচেয়ে বেশি progress হয়েছে ${top.id}-এ (${percent}%)।`, { courseId: top.id, percent }));
    }
  }

  /* Attention signals. */
  if (trend?.practiceActivity?.direction === 'down' && trend.practiceActivity.strength >= 0.15) {
    out.push(insight('attention', 'practice-down',
      `📉 অভ্যাস কমে আসছে, আজ অল্প করে হলেও কিছু প্রশ্ন solve করো।`, { strength: trend.practiceActivity.strength }));
  }
  if (practice > 0 && accuracy > 0 && accuracy < 50) {
    out.push(insight('attention', 'accuracy-low',
      `⚠️ নির্ভুলতা ${accuracy}%, ভুলগুলো একবার revise করলে দ্রুত বাড়বে।`, { accuracy }));
  }
  const pending = asInt(metrics.mistakes?.pending);
  if (pending >= 5) {
    out.push(insight('attention', 'mistakes-pending',
      `📝 ${pending}টি ভুল এখনো revise করা হয়নি।`, { pending }));
  }
  if (metrics.daysSinceActive !== null && metrics.daysSinceActive >= 4) {
    out.push(insight('attention', 'inactive',
      `⏰ ${metrics.daysSinceActive} দিন ধরে পড়া হয়নি, আজ ছোট করে শুরু করো।`, { days: metrics.daysSinceActive }));
  }
  if (lessons > 0 && practice === 0) {
    out.push(insight('attention', 'no-practice',
      `📖 পাঠ শেষ করেছ কিন্তু এখনো প্রশ্ন solve করনি, অভ্যাস ছাড়া মনে থাকবে না।`, {}));
  }

  return out;
}

/* Admin insights: the platform-level "what should I look at". Every claim
 * carries the number behind it so the admin can check rather than trust, and a
 * signal only appears once the sample supports it. */
export function buildAdminInsights(input = {}) {
  const out = [];
  const courses = Array.isArray(input.courses) ? input.courses : [];
  const lessons = Array.isArray(input.lessons) ? input.lessons : [];
  const quizzes = Array.isArray(input.quizzes) ? input.quizzes : [];
  const engagement = input.engagement || {};
  const retention = input.retention || {};
  const notifications = input.notifications || {};
  const campaigns = input.campaigns || {};
  const funnel = input.funnel || [];

  if (courses.length) {
    const most = [...courses].sort((a, b) => b.learners - a.learners)[0];
    if (most?.learners > 0) {
      out.push(insight('neutral', 'most-engaged-course',
        `Most engaged course: ${most.courseId} (${most.learners} জন learner)।`, { courseId: most.courseId, learners: most.learners }));
    }
    const weakest = [...courses].filter(c => c.learners >= DROPOFF_MIN_SAMPLE)
      .sort((a, b) => a.lessonCompletionRate - b.lessonCompletionRate)[0];
    if (weakest) {
      out.push(insight('attention', 'weakest-course',
        `⚠️ ${weakest.courseId}-এ lesson completion সবচেয়ে কম (${pct(weakest.lessonCompletionRate * 100, 100, 1)}%)।`, { courseId: weakest.courseId }));
    }
  }

  /* Lesson drop-off: the automatic signal the brief asks for. It names the
   * lesson and the gap, and leaves the diagnosis to a human on purpose. */
  const worstLesson = lessons.filter(l => l.starts >= DROPOFF_MIN_SAMPLE)
    .sort((a, b) => a.completionRate - b.completionRate)[0];
  if (worstLesson && worstLesson.completionRate < (1 - DROPOFF_ALERT_RATE)) {
    const others = lessons.filter(l => l.starts >= DROPOFF_MIN_SAMPLE && l !== worstLesson);
    const avg = others.length ? sum(others, l => l.completionRate) / others.length : null;
    out.push(insight('attention', 'lesson-dropoff',
      `⚠️ Lesson ${worstLesson.lessonId}-এর completion rate অন্যান্য lesson-এর তুলনায় উল্লেখযোগ্যভাবে কম (${pct(worstLesson.completionRate * 100, 100, 1)}%${avg !== null ? `, গড় ${pct(avg * 100, 100, 1)}%` : ''})।`,
      { courseId: worstLesson.courseId, lessonId: worstLesson.lessonId, completionRate: worstLesson.completionRate }));
  }

  const hardest = quizzes.filter(q => q.attempts >= DROPOFF_MIN_SAMPLE).sort((a, b) => a.accuracy - b.accuracy)[0];
  if (hardest) {
    out.push(insight('attention', 'hardest-quiz',
      `📝 ${hardest.quizId}-এ accuracy সবচেয়ে কম (${hardest.accuracy}%, ${hardest.attempts} attempts)।`, { quizId: hardest.quizId, accuracy: hardest.accuracy }));
  }

  if (funnel.length) {
    const drop = detectFunnelDropOff(funnel);
    if (drop.hasAlert) {
      out.push(insight('attention', 'funnel-drop', `🚨 ${drop.message}`, { step: drop.steepest, dropRate: drop.dropRate }));
    }
  }

  if (notifications.bestCategory?.sent >= DROPOFF_MIN_SAMPLE) {
    const b = notifications.bestCategory;
    out.push(insight('neutral', 'best-notification-category',
      `🔔 Best notification category: ${b.key} (learning conversion ${b.learningConversion}%)।`, { category: b.key }));
  }
  if (notifications.overall?.sent >= 20 && notifications.overall.learningConversion < 5) {
    out.push(insight('attention', 'notification-conversion-low',
      `⚠️ Notification → learning conversion মাত্র ${notifications.overall.learningConversion}%, পাঠানো কমিয়ে relevance বাড়ানো দরকার।`, { conversion: notifications.overall.learningConversion }));
  }

  if (campaigns.best) {
    out.push(insight('neutral', 'best-campaign',
      `📣 সবচেয়ে ভালো campaign: ${campaigns.best.campaignId} (open ${campaigns.best.openRate}%)।`, { campaignId: campaigns.best.campaignId }));
  }

  if (retention.byWindow && asNum(retention.cohortSize) >= DROPOFF_MIN_SAMPLE) {
    const d7 = asNum(retention.byWindow.d7);
    const d1 = asNum(retention.byWindow.d1);
    if (d1 > 0 && d7 < d1 * 0.5) {
      out.push(insight('attention', 'retention-gap',
        `⚠️ D1 ${d1}% থেকে D7-এ নেমে এসেছে ${d7}%, প্রথম সপ্তাহেই অনেকেই হারিয়ে যাচ্ছে।`, { d1, d7 }));
    } else if (d1 > 0) {
      out.push(insight('positive', 'retention-ok',
        `✅ D1 retention ${d1}%।`, { d1 }));
    }
  }

  if (engagement.totalStudents >= DROPOFF_MIN_SAMPLE) {
    out.push(insight('neutral', 'stickiness',
      `👥 Stickiness (DAU/MAU) ${engagement.stickiness}%, ${engagement.dau} active আজ, ${engagement.mau} এই মাসে।`, { stickiness: engagement.stickiness }));
  }

  return out;
}

/* A one-line trend summary, because the brief asks for exactly that: not three
 * charts, but "lesson completion বাড়ছে, কিন্তু practice কমছে". */
export function summarizeTrends(trends = {}) {
  const up = [];
  const down = [];
  const labels = {
    practiceActivity: 'practice activity',
    lessonsCompleted: 'lesson completion',
    learningTime: 'learning time',
    accuracy: 'quiz accuracy'
  };
  for (const [key, t] of Object.entries(trends || {})) {
    const label = labels[key] || key;
    if (t?.direction === 'up') up.push(label);
    else if (t?.direction === 'down') down.push(label);
  }
  if (!up.length && !down.length) return { text: 'এই সময়ে বড় কোনো পরিবর্তন নেই, ধারা স্থির।', up, down };
  const parts = [];
  if (up.length) parts.push(`${up.join(', ')} বাড়ছে`);
  if (down.length) parts.push(`${down.join(', ')} কমছে`);
  return { text: `${parts.join(', কিন্তু ')}।`, up, down };
}

/* ── storage ─────────────────────────────────────────────────────────────── */

/* Reads only. Phase 4 adds no tables: every figure below is derived from the
 * Phase 1–3 schema, and the one thing that could not be derived, a per-student
 * event trail, is ingested into `analytics_events` by the client, which is the
 * only new storage and the only new write path. */

const MAX_EVENT_ROWS = 5000;

/* D1 and SQLite report a table that has not been created yet as "no such
 * table". Only that is treated as "no data": a missing *column* means the table
 * exists but its schema is not the one this engine was written against, which
 * is a deployment fault worth surfacing rather than rendering as zeros. */
function isMissingSchemaError(err) {
  const message = String(err?.message || err?.cause?.message || err || '');
  return /no such table/i.test(message);
}

export class AnalyticsStore {
  #d1;
  #ready;

  constructor(d1) {
    this.#d1 = d1 || null;
  }

  available() {
    return Boolean(this.#d1);
  }

  /* A read that touches a table another module owns must not fail just because
   * that module has not created its schema yet, a fresh database, or a first
   * request that lands on analytics before the feature it reads. "No such
   * table" means "no data yet", which every metric here already renders as
   * zero; it does not mean the request is broken. Real SQL errors still throw,
   * so a wrong column or a bad query is never silently swallowed. */
  async #readAll(query) {
    try {
      const rows = await query.all();
      return rows?.results || [];
    } catch (err) {
      if (isMissingSchemaError(err)) return [];
      throw err;
    }
  }

  async #readFirst(query) {
    try {
      return await query.first();
    } catch (err) {
      if (isMissingSchemaError(err)) return null;
      throw err;
    }
  }

  async init() {
    if (!this.#d1) return;
    if (!this.#ready) this.#ready = this.#createSchema().catch(err => { this.#ready = null; throw err; });
    await this.#ready;
  }

  async #createSchema() {
    /* Lazy bootstrap, the same convention every other store here uses: no
     * separate migration, so a fresh database and an existing one converge. */
    const ddl = [
      `CREATE TABLE IF NOT EXISTS analytics_events (
        user_id TEXT NOT NULL,
        id TEXT NOT NULL,
        name TEXT NOT NULL,
        params_json TEXT,
        at INTEGER NOT NULL,
        day_key TEXT,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (user_id, id))`,
      'CREATE INDEX IF NOT EXISTS idx_ae_user_at ON analytics_events(user_id, at)',
      'CREATE INDEX IF NOT EXISTS idx_ae_name_at ON analytics_events(name, at)',
      'CREATE INDEX IF NOT EXISTS idx_ae_user_day ON analytics_events(user_id, day_key)'
    ];
    for (const stmt of ddl) await this.#d1.prepare(stmt).run();
  }

  /* Ingest a batch of already-filtered learning events. Idempotent on
   * (user_id, id): a client retry or a replayed flush cannot double-count, which
   * is the whole reason the client is allowed to be at-least-once. */
  async ingestEvents(userId, events, now) {
    await this.init();
    const rows = (Array.isArray(events) ? events : []).slice(0, 200);
    let stored = 0;
    for (const e of rows) {
      const id = String(e?.id || '').slice(0, 120);
      const name = String(e?.name || '').slice(0, 60);
      if (!id || !name) continue;
      const at = asInt(e.at, now);
      const params = e.params && typeof e.params === 'object' ? e.params : {};
      const res = await this.#d1.prepare(
        `INSERT INTO analytics_events(user_id, id, name, params_json, at, day_key, created_at)
         VALUES (?,?,?,?,?,?,?) ON CONFLICT(user_id, id) DO NOTHING`
      ).bind(userId, id, name, JSON.stringify(params).slice(0, 4000), at, dayKey(at), now).run();
      if (asInt(res?.meta?.changes, 0) > 0) stored += 1;
    }
    return { received: rows.length, stored };
  }

  #events(rows) {
    return (rows?.results || []).map(r => {
      let params = {};
      try { params = JSON.parse(String(r.params_json || '{}')) || {}; } catch { params = {}; }
      return { id: String(r.id), name: String(r.name), params, at: asInt(r.at) };
    });
  }

  /* Platform-wide events inside a window. This is the admin read; it is never
   * reachable without the admin token. */
  async eventsSince(sinceMs, limit = MAX_EVENT_ROWS) {
    await this.init();
    const rows = await this.#d1.prepare(
      'SELECT id, name, params_json, at FROM analytics_events WHERE at>=? ORDER BY at ASC LIMIT ?'
    ).bind(sinceMs, limit).all();
    return this.#events(rows);
  }

  async userEvents(userId, sinceMs, limit = MAX_EVENT_ROWS) {
    await this.init();
    const rows = await this.#d1.prepare(
      'SELECT id, name, params_json, at FROM analytics_events WHERE user_id=? AND at>=? ORDER BY at ASC LIMIT ?'
    ).bind(userId, sinceMs, limit).all();
    return this.#events(rows);
  }

  /* Every student's learning picture, one row per student, for the platform
   * metrics. `activeDays` is a comma-joined day list, D1 has no array type and
   * the only consumer is the segmentation/engagement code above. */
  async studentSnapshots(sinceMs) {
    await this.init();
    const query = this.#d1.prepare(
      `SELECT s.user_id AS user_id,
              GROUP_CONCAT(DISTINCT s.day) AS days,
              SUM(COALESCE(json_extract(s.payload_json,'$.questions'),0)) AS questions,
              SUM(COALESCE(json_extract(s.payload_json,'$.lessons'),0)) AS lessons,
              SUM(COALESCE(json_extract(s.payload_json,'$.timeMs'),0)) AS time_ms
       FROM user_daily_stats s
       WHERE s.deleted_at IS NULL AND s.day>=?
       GROUP BY s.user_id`
    ).bind(dayKey(sinceMs));
    const rows = await this.#readAll(query);
    return rows.map(r => ({
      userId: String(r.user_id),
      activeDays: String(r.days || '').split(',').filter(Boolean).sort(),
      questions: asInt(r.questions),
      lessons: asInt(r.lessons),
      timeMs: asInt(r.time_ms),
      learningActions: asInt(r.questions) + asInt(r.lessons)
    }));
  }

  /* Per-student daily series for one student, the student dashboard's read. */
  async dailyStats(userId, limitDays = 60) {
    await this.init();
    const query = this.#d1.prepare(
      'SELECT day, payload_json FROM user_daily_stats WHERE user_id=? AND deleted_at IS NULL ORDER BY day DESC LIMIT ?'
    ).bind(userId, limitDays);
    const rows = await this.#readAll(query);
    return rows.map(r => {
      let doc = {};
      try { doc = JSON.parse(String(r.payload_json)) || {}; } catch { doc = {}; }
      return {
        day: String(r.day),
        questions: asInt(doc.questions),
        correct: asInt(doc.correct),
        wrong: asInt(doc.wrong),
        lessons: asInt(doc.lessons),
        timeMs: asInt(doc.timeMs ?? doc.time),
        exams: asInt(doc.exams)
      };
    });
  }

  async examResults(userId, limit = 50) {
    await this.init();
    const query = this.#d1.prepare(
      'SELECT id, payload_json, updated_at FROM user_exam_results WHERE user_id=? AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT ?'
    ).bind(userId, limit);
    const rows = await this.#readAll(query);
    return rows.map(r => {
      let doc = {};
      try { doc = JSON.parse(String(r.payload_json)) || {}; } catch { doc = {}; }
      return { id: String(r.id), score: asNum(doc.score ?? doc.percentage, NaN), at: asInt(r.updated_at) };
    }).filter(e => Number.isFinite(e.score));
  }

  async mistakes(userId) {
    await this.init();
    const query = this.#d1.prepare(
      `SELECT COALESCE(topic_id,'general') AS topic, COUNT(*) AS misses FROM user_mistakes
       WHERE user_id=? AND deleted_at IS NULL AND COALESCE(mastered,0)=0
         AND (revision_status IS NULL OR revision_status<>'mastered')
       GROUP BY topic ORDER BY misses DESC LIMIT 10`
    ).bind(userId);
    const rows = await this.#readAll(query);
    return rows.map(r => ({ topic: String(r.topic), misses: asInt(r.misses) }));
  }

  /* Course progress lives in the student's own settings blob (same read Phase 3
   * uses). A malformed or absent blob means "no course data", never a guess. */
  async courses(userId) {
    await this.init();
    const query = this.#d1.prepare(
      "SELECT payload_json FROM user_settings WHERE user_id=? AND id='settings' AND deleted_at IS NULL"
    ).bind(userId);
    const row = await this.#readFirst(query);
    if (!row?.payload_json) return [];
    let doc = {};
    try { doc = JSON.parse(String(row.payload_json)) || {}; } catch { return []; }
    const raw = doc.courses || doc.courseProgress || [];
    if (!Array.isArray(raw)) return [];
    return raw.map(c => ({
      id: String(c?.id || c?.courseId || ''),
      lessonsTotal: asInt(c?.lessonsTotal ?? c?.total),
      lessonsDone: asInt(c?.lessonsDone ?? c?.done)
    })).filter(c => c.id && c.lessonsTotal > 0);
  }

  /* The student's course blob as an analytics row, so the admin course rollup
   * and the student view use the same shape. */
  async courseRows(sinceMs) {
    await this.init();
    const query = this.#d1.prepare(
      "SELECT user_id, payload_json, updated_at FROM user_settings WHERE id='settings' AND deleted_at IS NULL AND updated_at>=?"
    ).bind(sinceMs);
    const rows = await this.#readAll(query);
    const out = [];
    for (const r of rows) {
      let doc = {};
      try { doc = JSON.parse(String(r.payload_json)) || {}; } catch { continue; }
      const raw = Array.isArray(doc.courses || doc.courseProgress) ? (doc.courses || doc.courseProgress) : [];
      for (const c of raw) {
        const id = String(c?.id || c?.courseId || '');
        const lessonsTotal = asInt(c?.lessonsTotal ?? c?.total);
        if (!id || lessonsTotal <= 0) continue;
        out.push({ userId: String(r.user_id), courseId: id, lessonsTotal, lessonsDone: asInt(c?.lessonsDone ?? c?.done) });
      }
    }
    return out;
  }

  async notificationOutcomes(sinceMs) {
    await this.init();
    const query = this.#d1.prepare(
      `SELECT notification_key, kind, category, variant, day_key, sent_at, opened_at, clicked_at, learning_at, learning_kind
       FROM notification_outcomes WHERE sent_at>=? ORDER BY sent_at DESC LIMIT 5000`
    ).bind(sinceMs);
    const rows = await this.#readAll(query);
    return rows.map(r => ({
      notification_key: String(r.notification_key),
      kind: String(r.kind || ''),
      category: String(r.category || ''),
      variant: String(r.variant || ''),
      day_key: String(r.day_key || ''),
      sent_at: asInt(r.sent_at),
      opened_at: asInt(r.opened_at),
      clicked_at: asInt(r.clicked_at),
      learning_at: asInt(r.learning_at),
      learning_kind: String(r.learning_kind || '')
    }));
  }

  async userOutcomes(userId, sinceMs) {
    await this.init();
    const query = this.#d1.prepare(
      `SELECT notification_key, kind, category, variant, day_key, sent_at, opened_at, clicked_at, learning_at, learning_kind
       FROM notification_outcomes WHERE user_id=? AND sent_at>=? ORDER BY sent_at DESC LIMIT 500`
    ).bind(userId, sinceMs);
    const rows = await this.#readAll(query);
    return rows.map(r => ({
      notification_key: String(r.notification_key),
      kind: String(r.kind || ''),
      category: String(r.category || ''),
      variant: String(r.variant || ''),
      day_key: String(r.day_key || ''),
      sent_at: asInt(r.sent_at),
      opened_at: asInt(r.opened_at),
      clicked_at: asInt(r.clicked_at),
      learning_at: asInt(r.learning_at),
      learning_kind: String(r.learning_kind || '')
    }));
  }

  async globalNotifications(sinceMs) {
    await this.init();
    const query = this.#d1.prepare(
      `SELECT id, type, audience, topic, status, sent_at, scheduled_at, COALESCE(delivered,0) AS delivered
       FROM global_notifications WHERE COALESCE(sent_at, scheduled_at, 0)>=? ORDER BY COALESCE(sent_at, scheduled_at, 0) DESC LIMIT 500`
    ).bind(sinceMs);
    const rows = await this.#readAll(query);
    return rows.map(r => ({
      id: String(r.id), type: String(r.type || ''), audience: String(r.audience || ''),
      topic: String(r.topic || ''), status: String(r.status || ''),
      sent_at: asInt(r.sent_at), scheduled_at: asInt(r.scheduled_at), delivered: asInt(r.delivered)
    }));
  }

  async readCounts() {
    await this.init();
    const query = this.#d1.prepare(
      'SELECT notification_id, COUNT(*) AS n FROM notification_reads GROUP BY notification_id'
    );
    const rows = await this.#readAll(query);
    const out = {};
    for (const r of rows) out[String(r.notification_id)] = asInt(r.n);
    return out;
  }

  /* How many students have a device registered, the honest denominator for a
   * "reached" percentage. */
  async deviceCount() {
    await this.init();
    const row = await this.#readFirst(this.#d1.prepare('SELECT COUNT(DISTINCT user_id) AS n FROM fcm_devices'));
    return asInt(row?.n);
  }

  /* Segments for the Phase 3 engine and for the admin filter list. Computed here
   * once so the notification engine and the dashboard cannot disagree about who
   * is "at risk". */
  async segments(options = {}) {
    const since = options.sinceMs ?? (Date.now() - 60 * DAY_MS);
    const students = await this.studentSnapshots(since);
    return students.map(s => {
      const metrics = computeLearningMetrics({
        dailyStats: (s.activeDays || []).map(day => ({ day, questions: 0, lessons: 0 })),
        courses: []
      }, { today: options.today || dayKey(Date.now(), options.tzOffsetMin) });
      /* daysSinceActive is what the segment turns on, so it is computed from the
       * real day list rather than the zeroed counters above. */
      const today = options.today || dayKey(Date.now(), options.tzOffsetMin);
      const last = s.activeDays[s.activeDays.length - 1] || null;
      const enriched = {
        ...metrics,
        activeDays: s.activeDays.length,
        practiceActivity: s.questions,
        lessonsCompleted: s.lessons,
        lastActiveDay: last,
        daysSinceActive: last ? Math.max(0, daysBetween(last, today)) : null
      };
      return {
        userId: s.userId,
        ...classifyBehaviourSegment(enriched, { today }),
        stage: classifyLearningStage(enriched).stage
      };
    });
  }
}

/* ── routes ──────────────────────────────────────────────────────────────── */

export const ANALYTICS_PREFIX = '/api/analytics/';

const jsonResponse = (request, obj, status = 200) => new Response(JSON.stringify(obj), {
  status,
  headers: {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...corsHeaders(request)
  }
});

const readBody = async (request) => {
  try { return await request.json(); } catch { return null; }
};

/* Filters are parsed once, from one place, and every admin view honours the same
 * set. Unknown values are dropped rather than passed through to SQL. */
export function parseFilters(url, now = Date.now()) {
  const days = Math.min(365, Math.max(1, asInt(url.searchParams.get('days'), 30)));
  const from = asInt(url.searchParams.get('from'), 0);
  const to = asInt(url.searchParams.get('to'), 0);
  const sinceMs = from > 0 ? from : (now - days * DAY_MS);
  const untilMs = to > 0 ? to : now;
  const pick = key => {
    const v = String(url.searchParams.get(key) || '').trim().slice(0, 80);
    return v || '';
  };
  return {
    days,
    sinceMs,
    untilMs,
    course: pick('course'),
    lesson: pick('lesson'),
    category: pick('category'),
    segment: pick('segment'),
    notificationType: pick('type'),
    platform: pick('platform'),
    tzOffsetMin: asInt(url.searchParams.get('tz'), DEFAULT_TZ_OFFSET_MIN)
  };
}

const inWindow = (at, f) => asInt(at) >= f.sinceMs && asInt(at) <= f.untilMs;

/* Every filter is applied in one place so a view can never accidentally ignore
 * one, the bug that makes two admin screens disagree. */
export function applyFilters({ events = [], courses = [], lessons = [], quizzes = [], campaigns = [], outcomes = [], segments = [] }, f) {
  let ev = events.filter(e => inWindow(e.at, f));
  let co = courses;
  let le = lessons;
  let qu = quizzes;
  let ca = campaigns.filter(c => inWindow(c.sentAt || c.scheduledAt, f));
  let ou = outcomes.filter(o => inWindow(o.sent_at, f));
  let sg = segments;

  if (f.course) {
    ev = ev.filter(e => String(e.params?.course_id || e.params?.courseId || '') === f.course);
    co = co.filter(c => c.courseId === f.course);
    le = le.filter(l => l.courseId === f.course);
    qu = qu.filter(q => String(q.quizId) === f.course);
  }
  if (f.lesson) {
    ev = ev.filter(e => String(e.params?.lesson_id || e.params?.lessonId || '') === f.lesson);
    le = le.filter(l => l.lessonId === f.lesson);
  }
  if (f.category) ou = ou.filter(o => o.category === f.category);
  if (f.notificationType) {
    ou = ou.filter(o => o.kind === f.notificationType);
    ca = ca.filter(c => c.type === f.notificationType);
  }
  if (f.segment) sg = sg.filter(s => s.segment === f.segment);
  /* Platform is a client-side dimension; nothing server-side stores it, so a
   * platform filter narrows campaigns by topic and leaves the rest untouched
   * rather than silently returning everything. */
  if (f.platform) ca = ca.filter(c => String(c.topic || '').includes(f.platform));

  return { events: ev, courses: co, lessons: le, quizzes: qu, campaigns: ca, outcomes: ou, segments: sg };
}

/* Builds the student's own dashboard. Scoped to `userId` by construction: every
 * read below is keyed on the session user, so there is no path by which one
 * student's payload can contain another's data. */
export async function buildStudentDashboard(store, userId, options = {}) {
  const f = options.filters || { sinceMs: Date.now() - 30 * DAY_MS, untilMs: Date.now(), tzOffsetMin: DEFAULT_TZ_OFFSET_MIN };
  const today = options.today || dayKey(Date.now(), f.tzOffsetMin);

  const [dailyStats, examResults, mistakes, courses, events, outcomes] = await Promise.all([
    store.dailyStats(userId, options.limitDays ?? 90),
    store.examResults(userId, 50),
    store.mistakes(userId),
    store.courses(userId),
    store.userEvents(userId, f.sinceMs),
    store.userOutcomes(userId, f.sinceMs)
  ]);

  const metrics = computeLearningMetrics({ dailyStats, examResults, mistakes, courses }, { today, seriesDays: options.seriesDays ?? 14 });
  const comparison = comparePeriods(metrics.series, 7);
  const trends = detectTrends(metrics.series, { window: 7 });
  const segment = classifyBehaviourSegment(metrics, { today, trend: trends.practiceActivity });
  const stage = classifyLearningStage(metrics);
  const milestones = computeMilestones(metrics);
  const insights = buildStudentInsights(metrics, { trend: trends, comparison, courses });
  const trendSummary = summarizeTrends(trends);

  /* The student sees only their own funnel and their own notifications. */
  const funnel = buildFunnel(countByEvent(events));
  const notifications = computeNotificationAnalytics(outcomes);

  return {
    scope: 'student',
    userId,
    generatedAt: Date.now(),
    today,
    metrics,
    comparison,
    trends,
    trendSummary,
    segment,
    stage,
    milestones,
    insights,
    funnel,
    dropOff: detectFunnelDropOff(funnel),
    notifications,
    recentActivity: events.slice(-20).reverse().map(e => ({ name: e.name, at: e.at, params: e.params }))
  };
}

/* Builds the admin's platform view. Aggregate only: it returns counts, rates and
 * segment sizes, never a per-student row. The one exception is `export`, which
 * the caller must ask for explicitly and which is admin-token-gated. */
export async function buildAdminDashboard(store, filters, options = {}) {
  const [events, courseRows, outcomes, globals, readCounts, students, deviceCount] = await Promise.all([
    store.eventsSince(filters.sinceMs),
    store.courseRows(filters.sinceMs),
    store.notificationOutcomes(filters.sinceMs),
    store.globalNotifications(filters.sinceMs),
    store.readCounts(),
    store.studentSnapshots(filters.sinceMs),
    store.deviceCount()
  ]);

  const courses = buildCourseAnalytics(courseRows, events);
  const lessons = buildLessonAnalytics(events);
  const quizzes = buildQuizAnalytics(events);
  const campaigns = computeCampaignAnalytics(globals, readCounts);
  const segments = students.map(s => {
    const last = s.activeDays[s.activeDays.length - 1] || null;
    /* hadGap is derived from the student's own day list, the same rule the
     * student dashboard uses, so both surfaces segment a student identically. */
    let hadGap = false;
    for (let i = 1; i < s.activeDays.length; i += 1) {
      if (daysBetween(s.activeDays[i - 1], s.activeDays[i]) >= 4) { hadGap = true; break; }
    }
    const enriched = {
      activeDays: s.activeDays.length,
      practiceActivity: s.questions,
      lessonsCompleted: s.lessons,
      courseProgress: {},
      hadGap,
      daysSinceActive: last ? Math.max(0, daysBetween(last, filters.today || dayKey(Date.now(), filters.tzOffsetMin))) : null
    };
    return { userId: s.userId, ...classifyBehaviourSegment(enriched, { today: filters.today }), stage: classifyLearningStage(enriched).stage };
  });

  const filtered = applyFilters({ events, courses, lessons, quizzes, campaigns, outcomes, segments }, filters);

  const engagement = computeEngagement(
    students.map(s => ({ userId: s.userId, activeDays: s.activeDays, learningActions: s.learningActions, sessions: s.activeDays.map(d => ({ timeMs: 0 })) })),
    { today: filters.today, tzOffsetMin: filters.tzOffsetMin }
  );
  const retention = computeRetention(students, { today: filters.today, tzOffsetMin: filters.tzOffsetMin });
  const notifications = computeNotificationAnalytics(filtered.outcomes);
  const ranked = rankCampaigns(filtered.campaigns);
  const funnel = buildFunnel(countByEvent(filtered.events));
  const dropOff = detectFunnelDropOff(funnel);

  const trends = detectTrends(
    dayRange(filters.today || dayKey(Date.now(), filters.tzOffsetMin), 14).map(day => {
      const rows = filtered.events.filter(e => dayKey(e.at, filters.tzOffsetMin) === day);
      return {
        day,
        questions: rows.filter(e => e.name === 'question_attempt').length,
        lessons: rows.filter(e => e.name === 'lesson_complete').length,
        correct: rows.filter(e => e.name === 'question_attempt' && (e.params?.correct === true || e.params?.correct === 'true')).length,
        wrong: rows.filter(e => e.name === 'question_attempt' && !(e.params?.correct === true || e.params?.correct === 'true')).length,
        timeMs: 0
      };
    }),
    { window: 7 }
  );

  const segmentCounts = {};
  for (const s of filtered.segments) segmentCounts[s.segment] = (segmentCounts[s.segment] || 0) + 1;
  const stageCounts = {};
  for (const s of filtered.segments) stageCounts[s.stage] = (stageCounts[s.stage] || 0) + 1;

  const insights = buildAdminInsights({
    courses: filtered.courses, lessons: filtered.lessons, quizzes: filtered.quizzes,
    engagement, retention, notifications, campaigns: ranked, funnel
  });

  return {
    scope: 'admin',
    generatedAt: Date.now(),
    filters,
    totals: {
      students: students.length,
      devices: deviceCount,
      events: filtered.events.length,
      courses: filtered.courses.length,
      lessons: filtered.lessons.length,
      quizzes: filtered.quizzes.length
    },
    engagement,
    retention,
    funnel,
    dropOff,
    trends,
    trendSummary: summarizeTrends(trends),
    courses: filtered.courses,
    lessons: filtered.lessons,
    quizzes: filtered.quizzes,
    notifications,
    campaigns: ranked,
    segments: { counts: segmentCounts, stages: stageCounts, total: filtered.segments.length },
    insights,
    /* The AI-ready layer: the structured signals Phase 5 will consume, already
     * computed and already interpreted. */
    signals: {
      funnel, dropOff, trends, trendSummary: summarizeTrends(trends),
      insights, segments: segmentCounts,
      notificationConversion: notifications.overall.learningConversion
    }
  };
}

/* Route handler. Mirrors the Phase 1–3 handlers: returns null for anything it
 * does not own so the worker's chain falls through. */
export async function handleAnalyticsRequest(request, env, ctx, deps = {}) {
  const url = new URL(request.url);
  const path = url.pathname;
  if (!path.startsWith(ANALYTICS_PREFIX) && path !== '/api/analytics') return null;

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: {
      ...corsHeaders(request),
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400'
    } });
  }

  const store = deps.store || new AnalyticsStore(env?.PROFILE_DB);
  if (!store.available()) return jsonResponse(request, { error: 'storage-unavailable' }, 503);

  const resolveSession = deps.sessionUser || sessionUser;
  const filters = parseFilters(url);
  const adminToken = String(request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
  const isAdmin = Boolean(env?.ADMIN_TOKEN) && adminToken === env.ADMIN_TOKEN;

  /* ── student: their own analytics ───────────────────────────────────────── */
  if (path === `${ANALYTICS_PREFIX}events` && request.method === 'POST') {
    const session = await resolveSession(env, request);
    if (!session?.user?.id) return jsonResponse(request, { error: 'auth-required' }, 401);
    const body = await readBody(request);
    const events = Array.isArray(body?.events) ? body.events : [];
    const result = await store.ingestEvents(String(session.user.id), events, Date.now());
    return jsonResponse(request, { ok: true, ...result });
  }

  if (path === `${ANALYTICS_PREFIX}me` && request.method === 'GET') {
    const session = await resolveSession(env, request);
    if (!session?.user?.id) return jsonResponse(request, { error: 'auth-required' }, 401);
    const payload = await buildStudentDashboard(store, String(session.user.id), { filters });
    return jsonResponse(request, payload);
  }

  /* ── admin: platform analytics, aggregate only ──────────────────────────── */
  if (!isAdmin) return jsonResponse(request, { error: 'forbidden' }, 403);

  const dashboard = await buildAdminDashboard(store, filters);

  if (path === `${ANALYTICS_PREFIX}overview` && request.method === 'GET') {
    return jsonResponse(request, {
      scope: 'admin',
      generatedAt: dashboard.generatedAt,
      filters: dashboard.filters,
      totals: dashboard.totals,
      engagement: dashboard.engagement,
      retention: dashboard.retention,
      insights: dashboard.insights,
      trendSummary: dashboard.trendSummary,
      trends: dashboard.trends,
      segments: dashboard.segments
    });
  }

  const views = {
    courses: () => dashboard.courses,
    lessons: () => dashboard.lessons,
    quizzes: () => dashboard.quizzes,
    engagement: () => ({ engagement: dashboard.engagement, retention: dashboard.retention }),
    retention: () => dashboard.retention,
    notifications: () => dashboard.notifications,
    campaigns: () => dashboard.campaigns,
    segments: () => dashboard.segments,
    funnel: () => ({ funnel: dashboard.funnel, dropOff: dashboard.dropOff }),
    insights: () => dashboard.insights,
    trends: () => ({ trends: dashboard.trends, summary: dashboard.trendSummary }),
    signals: () => dashboard.signals
  };

  const view = path.slice(ANALYTICS_PREFIX.length).replace(/\/$/, '');
  if (views[view] && request.method === 'GET') {
    return jsonResponse(request, { scope: 'admin', filters: dashboard.filters, [view]: views[view]() });
  }

  /* The raw export is the only route that carries user-level rows, and it is
   * behind the admin token by the guard above. */
  if (view === 'export' && request.method === 'GET') {
    return jsonResponse(request, {
      scope: 'admin',
      exportedAt: Date.now(),
      filters: dashboard.filters,
      courses: dashboard.courses,
      lessons: dashboard.lessons,
      quizzes: dashboard.quizzes,
      campaigns: dashboard.campaigns,
      segments: dashboard.segments,
      signals: dashboard.signals
    });
  }

  return jsonResponse(request, { error: 'not-found' }, 404);
}





