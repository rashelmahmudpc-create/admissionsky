/* Phase 5, AI Analytics Intelligence Core.
 *
 * Phase 4 produced metrics, comparisons and trends. This module turns those into
 * the four things the product actually needs to act on: what is happening, why,
 * what is likely next, and what to do about it.
 *
 *   profile     who this student is right now (dynamic, not a stored record)
 *   prediction  what their behaviour is probabilistically heading toward
 *   risk        which of eight disengagement signals are firing, and how hard
 *   action      the ranked next best action for this student
 *
 * Two rules shape everything here, and a test pins both.
 *
 * 1. Nothing is claimed without a sample. Every output carries `confidence`
 *    derived from how much data backs it, and below the minimum the answer is
 *    `insufficient` rather than a guess. A dashboard that invents a risk level
 *    from two events is worse than one that says "not enough data yet".
 *
 * 2. No model runs in this file. Every number below is deterministic arithmetic
 *    over rows the caller already has, so the same input always yields the same
 *    output. That is what makes it testable, cheap, and safe: the LLM in
 *    `ai-analytics-copilot.mjs` is only allowed to rephrase these figures, never
 *    to produce them. It is also why Phase 5 can run on every dashboard load
 *    without an API bill, the model is called for wording, not for arithmetic.
 *
 * `analytics-engine.mjs` stays the source of truth for metrics. This module
 * imports nothing from it and re-derives nothing it already published: callers
 * pass the Phase 4 payloads in.
 */

import { DEFAULT_TZ_OFFSET_MIN } from './notification-intelligence.mjs';

export const AI_INTELLIGENCE_VERSION = 'ai-p5-v1';

/* ── small numeric helpers (mirrors analytics-engine's, deliberately local so
 *    this module has no dependency on the engine's internals) ─────────────── */

const asInt = (v, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
};

const asNum = (v, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

const clamp01 = (n) => (n < 0 ? 0 : n > 1 ? 1 : n);

const round = (n, dp = 2) => (Number.isFinite(Number(n)) ? Number(Number(n).toFixed(dp)) : 0);

const mean = (values = []) => (values.length ? values.reduce((a, b) => a + asNum(b), 0) / values.length : 0);

const stddev = (values = []) => {
  if (values.length < 2) return 0;
  const m = mean(values);
  return Math.sqrt(values.reduce((a, b) => a + (asNum(b) - m) ** 2, 0) / (values.length - 1));
};

const sumOf = (rows = [], pick = (r) => r) => rows.reduce((n, r) => n + asNum(pick(r)), 0);

/* ── confidence ───────────────────────────────────────────────────────────── */

/* How many observations each kind of claim needs before it is worth stating.
 * These are the numbers that keep the dashboards honest, so they are exported
 * and pinned by tests rather than buried in the call sites. */
export const CONFIDENCE_TARGETS = Object.freeze({
  profile: 10,        // active days
  prediction: 14,     // active days across the observed window
  risk: 10,           // active days
  bestTime: 8,        // sessions with a usable local hour
  anomaly: 14,        // baseline observations
  content: 8,         // learners touching the item
  course: 8,          // learners in the course
  copilot: 5          // rows behind an answer
});

export const CONFIDENCE_BANDS = Object.freeze(['insufficient', 'low', 'moderate', 'high']);

/* Confidence is a function of sample size only, never of how interesting the
 * result looks. A dramatic pattern in three events is still three events. */
export function confidenceFromSample(samples, target = CONFIDENCE_TARGETS.profile) {
  const t = asNum(target) > 0 ? asNum(target) : 1;
  return round(clamp01(asNum(samples) / t), 2);
}

export function confidenceBand(value) {
  const v = clamp01(asNum(value));
  if (v < 0.4) return 'insufficient';
  if (v < 0.6) return 'low';
  if (v < 0.8) return 'moderate';
  return 'high';
}

const evidence = (samples, target) => {
  const confidence = confidenceFromSample(samples, target);
  return { samples: asInt(samples), confidence, band: confidenceBand(confidence) };
};

/* ── bands ────────────────────────────────────────────────────────────────── */

export const RISK_LEVELS = Object.freeze(['low', 'medium', 'high']);
export const RISK_KINDS = Object.freeze([
  'engagement_drop',
  'course_abandonment',
  'lesson_completion_decline',
  'practice_decline',
  'quiz_performance_decline',
  'streak_break',
  'long_inactivity',
  'consistency_decline'
]);

export const ACTION_KINDS = Object.freeze([
  'return_after_inactivity',
  'continue_lesson',
  'review_previous_lesson',
  'revise_weak_topic',
  'practice',
  'take_quiz',
  'complete_milestone'
]);

export const DAY_PARTS = Object.freeze(['night', 'morning', 'afternoon', 'evening']);

/* Fixed priority used only to break exact score ties, so ranking is stable and
 * reproducible instead of depending on array order. */
const ACTION_ORDER = Object.freeze([
  'return_after_inactivity',
  'continue_lesson',
  'complete_milestone',
  'revise_weak_topic',
  'review_previous_lesson',
  'practice',
  'take_quiz'
]);

const riskLevelFromScore = (score) => (score >= 0.66 ? 'high' : score >= 0.33 ? 'medium' : 'low');

export const PROFILE_DIMENSIONS = Object.freeze([
  'learningLevel',
  'engagementLevel',
  'consistency',
  'courseProgress',
  'accuracy',
  'practicePattern',
  'quizPattern',
  'preferredTime',
  'retentionPattern',
  'notificationResponse'
]);

/* ── day parts ────────────────────────────────────────────────────────────── */

export function dayPartOf(hour) {
  const h = ((asInt(hour) % 24) + 24) % 24;
  if (h < 5) return 'night';
  if (h < 12) return 'morning';
  if (h < 17) return 'afternoon';
  return 'evening';
}

export const DAY_PART_LABEL_BN = Object.freeze({
  night: 'রাত',
  morning: 'সকাল',
  afternoon: 'বিকেল',
  evening: 'সন্ধ্যা/রাত'
});

/* The student's local hour, not the server's. A Dhaka student studying at 21:00
 * is at UTC 15:00, and a "best time" computed in UTC would tell them to study at
 * 3pm, the same timezone bug the Phase 1 day-key work exists to prevent. */
export function localHour(atMs, tzOffsetMin = DEFAULT_TZ_OFFSET_MIN) {
  const shifted = asNum(atMs) + asNum(tzOffsetMin) * 60 * 1000;
  return Math.floor((((shifted % 86400000) + 86400000) % 86400000) / 3600000);
}

/* ── 1. AI student profile ────────────────────────────────────────────────── */

const levelFromScore = (score) => (score >= 0.75 ? 'high' : score >= 0.4 ? 'medium' : 'low');

const accuracyBand = (value) => {
  const v = asNum(value);
  if (v >= 80) return 'strong';
  if (v >= 60) return 'steady';
  if (v > 0) return 'needs_work';
  return 'unknown';
};

const LEARNING_STAGE_LABEL_BN = Object.freeze({
  beginner: 'শুরু',
  developing: 'উন্নতি',
  consistent: 'নিয়মিত',
  advanced: 'উচ্চ'
});

const SEGMENT_LABEL_BN = Object.freeze({
  new: 'নতুন',
  active: 'সক্রিয়',
  highly_active: 'খুব সক্রিয়',
  returning: 'ফিরে এসেছে',
  at_risk: 'ঝুঁকিতে',
  inactive: 'নিষ্ক্রিয়'
});

/* Builds the dynamic profile. Every dimension carries its own confidence so the
 * UI can grey out the ones the data does not yet support rather than showing a
 * confident-looking zero. */
export function buildStudentProfile(input = {}, options = {}) {
  const m = input.metrics || {};
  const series = Array.isArray(input.series) ? input.series : [];
  const activityHours = Array.isArray(input.activityHours) ? input.activityHours : [];
  const outcomes = input.notificationOutcomes || {};
  const retention = input.retention || {};
  const now = asNum(options.now, Date.now());

  const activeDays = asInt(m.activeDays);
  const daysSinceActive = asInt(m.daysSinceActive);
  const accuracy = asNum(m.accuracy);
  const practice = asInt(m.practiceActivity);
  const lessons = asInt(m.lessonsCompleted);
  const cp = m.courseProgress || {};
  const progressPercent = asNum(cp.percent);

  /* consistency: share of the observed window that had activity, penalised for a
   * broken streak. A student active 6 of 7 days scores far above one active 6 of
   * 30 even though both have 6 active days. */
  const windowDays = Math.max(asInt(options.windowDays, series.length || 30), 1);
  const density = clamp01(activeDays / windowDays);
  const gapPenalty = m.hadGap ? 0.15 : 0;
  const consistencyScore = clamp01(density - gapPenalty);

  /* practice pattern: questions per active day, and how steady that is. */
  const perActiveDay = activeDays > 0 ? round(practice / activeDays, 2) : 0;
  const practiceValues = series.map((d) => asNum(d.questions)).filter((v, i) => v > 0 || asNum(series[i]?.lessons) > 0);
  const cadence = practiceValues.length >= 2 ? round(1 - clamp01(stddev(practiceValues) / (mean(practiceValues) || 1)), 2) : 0;

  const hoursTotal = sumOf(activityHours);
  const peakHour = activityHours.length ? activityHours.indexOf(Math.max(...activityHours.map(asNum))) : -1;
  const timeSamples = asInt(input.activitySamples, hoursTotal);
  const timeConfidence = confidenceFromSample(timeSamples, CONFIDENCE_TARGETS.bestTime);
  /* Shaped like every other dimension, `value`, `band`, `confidence`, so the UI
   * can treat the ten dimensions uniformly instead of special-casing this one. */
  const preferredTime = hoursTotal > 0 && peakHour >= 0
    ? {
      value: dayPartOf(peakHour),
      hour: peakHour,
      dayPart: dayPartOf(peakHour),
      dayPartLabelBn: DAY_PART_LABEL_BN[dayPartOf(peakHour)],
      confidence: timeConfidence,
      band: confidenceBand(timeConfidence),
      samples: timeSamples
    }
    : { value: null, hour: null, dayPart: null, dayPartLabelBn: null, confidence: 0, band: 'insufficient', samples: 0 };

  const learningScore = clamp01(
    (lessons / 20) * 0.4 + (practice / 300) * 0.35 + (accuracy / 100) * 0.25
  );
  const engagementScore = clamp01(
    clamp01(activeDays / 14) * 0.6 + clamp01(1 - daysSinceActive / 14) * 0.4
  );

  const dimensions = {
    learningLevel: {
      value: levelFromScore(learningScore),
      score: round(learningScore, 3),
      stage: input.stage?.stage || null,
      stageLabelBn: LEARNING_STAGE_LABEL_BN[input.stage?.stage] || null,
      ...evidence(activeDays, CONFIDENCE_TARGETS.profile)
    },
    engagementLevel: {
      value: levelFromScore(engagementScore),
      score: round(engagementScore, 3),
      segment: input.segment?.segment || null,
      segmentLabelBn: SEGMENT_LABEL_BN[input.segment?.segment] || null,
      streak: asInt(m.streak),
      longestStreak: asInt(m.longestStreak),
      daysSinceActive,
      ...evidence(activeDays, CONFIDENCE_TARGETS.profile)
    },
    consistency: {
      value: levelFromScore(consistencyScore),
      score: round(consistencyScore, 3),
      activeDays,
      windowDays,
      hadGap: Boolean(m.hadGap),
      ...evidence(activeDays, CONFIDENCE_TARGETS.profile)
    },
    courseProgress: {
      value: round(progressPercent, 1),
      courses: asInt(cp.courses),
      started: asInt(cp.started),
      completed: asInt(cp.completed),
      lessonsDone: asInt(cp.lessonsDone),
      lessonsTotal: asInt(cp.lessonsTotal),
      ...evidence(activeDays, CONFIDENCE_TARGETS.profile)
    },
    accuracy: {
      value: round(accuracy, 1),
      band: accuracyBand(accuracy),
      correct: asInt(m.questionsCorrect),
      wrong: asInt(m.questionsWrong),
      ...evidence(practice, CONFIDENCE_TARGETS.profile)
    },
    practicePattern: {
      perActiveDay,
      cadence,
      total: practice,
      ...evidence(practice, CONFIDENCE_TARGETS.profile)
    },
    quizPattern: {
      attempts: asInt(input.quizAttempts),
      accuracy: round(asNum(input.quizAccuracy), 1),
      avgTimeMs: asInt(input.quizAvgTimeMs),
      retryRate: round(asNum(input.quizRetryRate), 3),
      ...evidence(asInt(input.quizAttempts), CONFIDENCE_TARGETS.profile)
    },
    preferredTime,
    retentionPattern: {
      d1: asNum(retention.d1),
      d7: asNum(retention.d7),
      d14: asNum(retention.d14),
      ...evidence(activeDays, CONFIDENCE_TARGETS.profile)
    },
    notificationResponse: {
      openRate: asNum(outcomes.openRate),
      clickRate: asNum(outcomes.clickRate),
      learningConversion: asNum(outcomes.learningConversion),
      sent: asInt(outcomes.sent),
      ...evidence(asInt(outcomes.sent), CONFIDENCE_TARGETS.profile)
    }
  };

  const weakAreas = (m.mistakes?.topics || [])
    .slice(0, 5)
    .map((t) => ({ topic: t.topic, misses: asInt(t.misses) }));
  const strongAreas = Array.isArray(input.strongAreas) ? input.strongAreas.slice(0, 5) : [];

  return {
    version: AI_INTELLIGENCE_VERSION,
    generatedAt: now,
    dimensions,
    learning: dimensions.learningLevel,
    engagement: dimensions.engagementLevel,
    consistency: dimensions.consistency,
    progress: dimensions.courseProgress,
    accuracy: dimensions.accuracy,
    practicePattern: dimensions.practicePattern,
    quizPattern: dimensions.quizPattern,
    preferredTime,
    weakAreas,
    strongAreas,
    retention: dimensions.retentionPattern,
    notificationResponse: dimensions.notificationResponse,
    readiness: {
      score: round(clamp01(engagementScore * 0.4 + learningScore * 0.4 + consistencyScore * 0.2), 3),
      confidence: confidenceFromSample(activeDays, CONFIDENCE_TARGETS.profile)
    },
    /* A profile is only as trustworthy as its thinnest sample; surface the
     * weakest dimension so the UI can say what is still unknown. */
    weakestDimension: weakestDimension(dimensions),
    samples: { activeDays, practice, lessons }
  };
}

function weakestDimension(dimensions = {}) {
  let worst = null;
  for (const [key, d] of Object.entries(dimensions)) {
    if (!d || typeof d.confidence !== 'number') continue;
    if (!worst || d.confidence < worst.confidence) worst = { key, confidence: d.confidence, band: d.band };
  }
  return worst;
}

/* ── 2. learning behaviour prediction ─────────────────────────────────────── */

/* Least-squares slope over the tail of a series. Returns per-day change. */
export function trendSlope(values = [], options = {}) {
  const tail = asInt(options.tail, 14);
  const v = values.slice(-tail).map(asNum);
  if (v.length < 3) return { slope: 0, mean: mean(v), samples: v.length, confidence: 0 };
  const n = v.length;
  const xs = v.map((_, i) => i);
  const mx = mean(xs);
  const my = mean(v);
  const denom = xs.reduce((a, x) => a + (x - mx) ** 2, 0);
  const slope = denom === 0 ? 0 : xs.reduce((a, x, i) => a + (x - mx) * (v[i] - my), 0) / denom;
  return {
    slope: round(slope, 4),
    mean: round(my, 3),
    samples: n,
    confidence: confidenceFromSample(n, CONFIDENCE_TARGETS.prediction)
  };
}

const directionOf = (slope, mean, tolerance = 0.05) => {
  const scale = Math.abs(mean) || 1;
  const rel = slope / scale;
  if (rel > tolerance) return 'rising';
  if (rel < -tolerance) return 'declining';
  return 'steady';
};

const DIRECTION_BN = Object.freeze({ rising: 'বাড়ছে', declining: 'কমছে', steady: 'স্থির' });

/* Probabilistic, and labelled as such. Each probability is a bounded function of
 * observed rate and direction, never a promise. `confidence` says how much the
 * probability should be trusted. */
export function predictBehaviour(profile = {}, input = {}, options = {}) {
  const series = Array.isArray(input.series) ? input.series : [];
  const horizon = Math.max(asInt(options.horizonDays, 7), 1);
  const windowDays = Math.max(asInt(options.windowDays, 14), 1);

  const recent = series.slice(-windowDays);
  const activeRate = recent.length ? recent.filter((d) => asNum(d.questions) > 0 || asNum(d.lessons) > 0).length / recent.length : 0;
  const questionSlope = trendSlope(series.map((d) => asNum(d.questions)), { tail: windowDays });
  const lessonSlope = trendSlope(series.map((d) => asNum(d.lessons)), { tail: windowDays });

  const daysSinceActive = asInt(profile.engagement?.daysSinceActive);
  const streak = asInt(profile.engagement?.streak);

  const engagementDirection = directionOf(questionSlope.slope, questionSlope.mean);
  const expectedActiveDays = round(clamp01(activeRate) * horizon, 1);

  /* Inactivity probability rises with time already away and falls with recent
   * density. Capped at 0.95 so it never reads as certainty. */
  const inactivityProbability = round(clamp01(
    0.15 + clamp01(daysSinceActive / 14) * 0.6 + (1 - clamp01(activeRate)) * 0.25
  ) * 0.95, 2);

  const streakContinuation = streak > 0 && daysSinceActive === 0
    ? round(clamp01(0.4 + activeRate * 0.5), 2)
    : 0;

  const expectedLessons = round(Math.max(0, lessonSlope.mean * horizon + lessonSlope.slope * horizon * 0.5), 1);

  const predictions = {
    engagement: {
      direction: engagementDirection,
      expectedActiveDays,
      horizonDays: horizon,
      probabilityActive: round(clamp01(activeRate), 2),
      confidence: questionSlope.confidence
    },
    completion: {
      direction: directionOf(lessonSlope.slope, lessonSlope.mean),
      expectedLessons,
      horizonDays: horizon,
      confidence: lessonSlope.confidence
    },
    inactivity: {
      probability: inactivityProbability,
      daysSinceActive,
      confidence: confidenceFromSample(recent.length, CONFIDENCE_TARGETS.prediction)
    },
    streakContinuation: {
      probability: streakContinuation,
      streak,
      confidence: confidenceFromSample(recent.length, CONFIDENCE_TARGETS.prediction)
    }
  };

  const overallConfidence = Math.min(
    questionSlope.confidence, confidenceFromSample(recent.length, CONFIDENCE_TARGETS.prediction)
  );

  return {
    version: AI_INTELLIGENCE_VERSION,
    horizonDays: horizon,
    predictions,
    /* These are estimates from past behaviour, not forecasts the product may
     * state as fact. The disclaimer travels with the payload so no caller has to
     * remember to add it. */
    disclaimerBn: 'এগুলো সম্ভাব্য অনুমান, নিশ্চিত ভবিষ্যদ্বাণী নয়, student-এর behavior বদলালে অনুমানও বদলাবে।',
    notes: predictionNotes(predictions, profile),
    confidence: round(overallConfidence, 2),
    band: confidenceBand(overallConfidence)
  };
}

function predictionNotes(predictions, profile) {
  const out = [];
  const e = predictions.engagement;
  if (e.confidence >= 0.4) {
    out.push({
      id: 'engagement-direction',
      textBn: `গত সময়ের সক্রিয়তা ${DIRECTION_BN[e.direction] || 'স্থির'}, সামনের ${e.horizonDays} দিনে প্রায় ${e.expectedActiveDays} দিন সক্রিয় থাকার সম্ভাবনা।`,
      confidence: e.confidence
    });
  }
  const i = predictions.inactivity;
  if (i.confidence >= 0.4 && i.probability >= 0.5) {
    out.push({
      id: 'inactivity-risk',
      textBn: `নিষ্ক্রিয় থাকার সম্ভাবনা বেশি (${Math.round(i.probability * 100)}%), শেষ সক্রিয়তা ${i.daysSinceActive} দিন আগে।`,
      confidence: i.confidence
    });
  }
  const t = profile.preferredTime;
  if (t?.dayPart && t.confidence >= 0.4) {
    out.push({
      id: 'preferred-time',
      textBn: `সাধারণত ${DAY_PART_LABEL_BN[t.dayPart]} সময়ে পড়াশোনা করে (প্রায় ${String(t.hour).padStart(2, '0')}:00 টার দিকে)।`,
      confidence: t.confidence
    });
  }
  return out;
}

/* ── 3. learning risk prediction ──────────────────────────────────────────── */

const RISK_LABEL_BN = Object.freeze({
  engagement_drop: 'সক্রিয়তা কমছে',
  course_abandonment: 'কোর্স অসমাপ্ত থাকার ঝুঁকি',
  lesson_completion_decline: 'লেসন শেষ করার হার কমছে',
  practice_decline: 'অভ্যাস কমছে',
  quiz_performance_decline: 'কুইজের ফল খারাপ হচ্ছে',
  streak_break: 'স্ট্রিক ভাঙার ঝুঁকি',
  long_inactivity: 'দীর্ঘ নিষ্ক্রিয়তা',
  consistency_decline: 'নিয়ম ভাঙছে'
});

const RISK_LABEL_EN = Object.freeze({
  engagement_drop: 'Engagement is falling',
  course_abandonment: 'Course abandonment risk',
  lesson_completion_decline: 'Lesson completion is declining',
  practice_decline: 'Practice volume is declining',
  quiz_performance_decline: 'Quiz performance is declining',
  streak_break: 'Streak break risk',
  long_inactivity: 'Prolonged inactivity',
  consistency_decline: 'Consistency is slipping'
});

const riskItem = (kind, score, samples, target, reasonBn, reasonEn, extra = {}) => {
  const s = clamp01(score);
  const conf = confidenceFromSample(samples, target);
  return {
    kind,
    level: riskLevelFromScore(s),
    score: round(s, 3),
    confidence: conf,
    band: confidenceBand(conf),
    labelBn: RISK_LABEL_BN[kind],
    labelEn: RISK_LABEL_EN[kind],
    reasonBn,
    reasonEn,
    ...extra
  };
};

/* The eight signals from the Phase 5 spec. Each is scored 0..1 from an observed
 * rate plus its direction; none is emitted below its sample floor, and a
 * below-floor signal is reported as `insufficient` instead of `low` so "we don't
 * know" never gets mistaken for "all clear". */
export function predictRisk(input = {}, options = {}) {
  const profile = input.profile || {};
  const series = Array.isArray(input.series) ? input.series : [];
  const metrics = input.metrics || {};
  const windowDays = Math.max(asInt(options.windowDays, 14), 1);

  const activeDays = asInt(metrics.activeDays);
  const daysSinceActive = asInt(profile.engagement?.daysSinceActive ?? metrics.daysSinceActive);
  const streak = asInt(profile.engagement?.streak ?? metrics.streak);
  const accuracy = asNum(metrics.accuracy);

  const qSlope = trendSlope(series.map((d) => asNum(d.questions)), { tail: windowDays });
  const lSlope = trendSlope(series.map((d) => asNum(d.lessons)), { tail: windowDays });

  /* Slope alone misses a step change: a student who halved their practice at day
   * 20 shows no slope across the last 14 days, yet they plainly declined. So each
   * decline signal blends the slope with a recent-vs-prior period comparison. */
  const declineScore = (slope, pick) => {
    const recentMean = mean(series.slice(-windowDays).map(pick));
    const priorMean = mean(series.slice(-2 * windowDays, -windowDays).map(pick));
    const periodDrop = priorMean > 0 ? clamp01((priorMean - recentMean) / priorMean) : 0;
    const slopeDrop = slope.slope < 0 ? clamp01(Math.abs(slope.slope) / (Math.abs(slope.mean) || 1)) : 0;
    return clamp01(Math.max(periodDrop, slopeDrop));
  };

  const recent = series.slice(-windowDays);
  const activeRate = recent.length
    ? recent.filter((d) => asNum(d.questions) > 0 || asNum(d.lessons) > 0).length / recent.length
    : 0;
  const recentAccuracy = recent.length
    ? mean(recent.map((d) => (asNum(d.correct) + asNum(d.wrong)) > 0 ? (asNum(d.correct) / (asNum(d.correct) + asNum(d.wrong))) * 100 : NaN).filter((v) => Number.isFinite(v)))
    : 0;
  const priorAccuracy = series.slice(0, Math.max(0, series.length - windowDays)).length
    ? mean(series.slice(0, Math.max(0, series.length - windowDays)).map((d) => (asNum(d.correct) + asNum(d.wrong)) > 0 ? (asNum(d.correct) / (asNum(d.correct) + asNum(d.wrong))) * 100 : NaN).filter((v) => Number.isFinite(v)))
    : 0;

  const items = [];

  items.push(riskItem(
    'engagement_drop',
    clamp01((1 - activeRate) * 0.7 + (qSlope.slope < 0 ? 0.3 : 0)),
    activeDays, CONFIDENCE_TARGETS.risk,
    `গত ${windowDays} দিনের মধ্যে ${recent.filter((d) => asNum(d.questions) > 0 || asNum(d.lessons) > 0).length} দিন সক্রিয় ছিল।`,
    `Active on ${recent.filter((d) => asNum(d.questions) > 0 || asNum(d.lessons) > 0).length} of the last ${windowDays} days.`
  ));

  const cp = metrics.courseProgress || {};
  const started = asInt(cp.started);
  const completed = asInt(cp.completed);
  const abandonment = started > 0 ? clamp01((started - completed) / started) : 0;
  items.push(riskItem(
    'course_abandonment',
    abandonment,
    activeDays, CONFIDENCE_TARGETS.risk,
    started > 0 ? `${started}টি কোর্স শুরু হয়েছে, ${completed}টি শেষ, বাকিগুলো অসমাপ্ত।` : 'এখনো কোনো কোর্স শুরু হয়নি।',
    started > 0 ? `${started} courses started, ${completed} completed, the rest are unfinished.` : 'No course started yet.'
  ));

  items.push(riskItem(
    'lesson_completion_decline',
    declineScore(lSlope, (d) => asNum(d.lessons)),
    lSlope.samples, CONFIDENCE_TARGETS.risk,
    `লেসন শেষ করার ধারা ${DIRECTION_BN[directionOf(lSlope.slope, lSlope.mean)] || 'স্থির'}।`,
    `Lesson completion is ${directionOf(lSlope.slope, lSlope.mean)}.`
  ));

  items.push(riskItem(
    'practice_decline',
    declineScore(qSlope, (d) => asNum(d.questions)),
    qSlope.samples, CONFIDENCE_TARGETS.risk,
    `প্রশ্ন সমাধানের ধারা ${DIRECTION_BN[directionOf(qSlope.slope, qSlope.mean)] || 'স্থির'}।`,
    `Practice volume is ${directionOf(qSlope.slope, qSlope.mean)}.`
  ));

  const quizDrop = priorAccuracy > 0 && recentAccuracy > 0 ? clamp01((priorAccuracy - recentAccuracy) / Math.max(priorAccuracy, 1)) : 0;
  items.push(riskItem(
    'quiz_performance_decline',
    quizDrop,
    recent.filter((d) => (asNum(d.correct) + asNum(d.wrong)) > 0).length, CONFIDENCE_TARGETS.risk,
    priorAccuracy > 0 && recentAccuracy > 0
      ? `আগের নির্ভুলতা ${round(priorAccuracy, 1)}%, সাম্প্রতিক ${round(recentAccuracy, 1)}%।`
      : 'কুইজের তুলনার জন্য যথেষ্ট ডেটা নেই।',
    priorAccuracy > 0 && recentAccuracy > 0
      ? `Accuracy moved from ${round(priorAccuracy, 1)}% to ${round(recentAccuracy, 1)}%.`
      : 'Not enough quiz data to compare.'
  ));

  const streakRisk = streak > 0 && daysSinceActive >= 1
    ? clamp01(daysSinceActive / Math.max(streak, 3))
    : 0;
  items.push(riskItem(
    'streak_break',
    streakRisk,
    activeDays, CONFIDENCE_TARGETS.risk,
    streak > 0 ? `${streak} দিনের স্ট্রিক, শেষ সক্রিয়তা ${daysSinceActive} দিন আগে।` : 'চলতি স্ট্রিক নেই।',
    streak > 0 ? `${streak}-day streak, last active ${daysSinceActive} days ago.` : 'No active streak.'
  ));

  items.push(riskItem(
    'long_inactivity',
    clamp01(daysSinceActive / 14),
    activeDays, CONFIDENCE_TARGETS.risk,
    daysSinceActive > 0 ? `${daysSinceActive} দিন ধরে কোনো পড়াশোনা হয়নি।` : 'আজ সক্রিয় ছিল।',
    daysSinceActive > 0 ? `No study activity for ${daysSinceActive} days.` : 'Active today.'
  ));

  items.push(riskItem(
    'consistency_decline',
    clamp01(1 - asNum(profile.consistency?.score, activeRate)),
    activeDays, CONFIDENCE_TARGETS.risk,
    `নিয়মিত থাকার স্কোর ${round(asNum(profile.consistency?.score, activeRate), 2)}।`,
    `Consistency score is ${round(asNum(profile.consistency?.score, activeRate), 2)}.`
  ));

  const scored = items.filter((i) => i.confidence > 0);
  const overallScore = scored.length ? mean(scored.map((i) => i.score)) : 0;
  const overallConfidence = scored.length ? Math.min(...scored.map((i) => i.confidence)) : 0;

  return {
    version: AI_INTELLIGENCE_VERSION,
    risks: items,
    /* Kept separate on purpose: `insufficient` items are not evidence of safety,
     * and a caller that only reads `level` must not be able to confuse them. */
    insufficient: items.filter((i) => i.band === 'insufficient').map((i) => i.kind),
    overall: {
      level: scored.length ? riskLevelFromScore(overallScore) : 'unknown',
      score: round(overallScore, 3),
      confidence: round(overallConfidence, 2),
      band: confidenceBand(overallConfidence),
      topKinds: scored.slice().sort((a, b) => b.score - a.score).slice(0, 3).map((i) => i.kind)
    },
    accuracy: round(accuracy, 1)
  };
}

/* ── 4. next best action engine ───────────────────────────────────────────── */

const ACTION_LABEL_BN = Object.freeze({
  return_after_inactivity: 'ফিরে এসে ছোট করে শুরু করো',
  continue_lesson: 'চলতি lesson শেষ করো',
  review_previous_lesson: 'আগের lesson আবার দেখো',
  revise_weak_topic: 'দুর্বল topic আবার practice করো',
  practice: 'নতুন প্রশ্ন practice করো',
  take_quiz: 'একটি quiz দাও',
  complete_milestone: 'পরের milestone পূরণ করো'
});

const ACTION_LABEL_EN = Object.freeze({
  return_after_inactivity: 'Return with a short session',
  continue_lesson: 'Finish the lesson in progress',
  review_previous_lesson: 'Review the previous lesson',
  revise_weak_topic: 'Revise a weak topic',
  practice: 'Practise new questions',
  take_quiz: 'Take a quiz',
  complete_milestone: 'Complete the next milestone'
});

/* Ranked on the five inputs the spec names, current progress, weakness, recent
 * activity, learning goal, past behaviour, with a floor so a student with no
 * data gets an explicit empty list rather than a confident recommendation. */
export function rankNextBestActions(input = {}, options = {}) {
  const profile = input.profile || {};
  const metrics = input.metrics || {};
  const risk = input.risk || { risks: [] };
  const milestones = input.milestones || {};
  const goal = input.goal || {};
  const minScore = asNum(options.minScore, 0.2);

  const daysSinceActive = asInt(profile.engagement?.daysSinceActive ?? metrics.daysSinceActive);
  const activeDays = asInt(metrics.activeDays);
  const cp = metrics.courseProgress || {};
  const lessonsDone = asInt(cp.lessonsDone);
  const lessonsTotal = asInt(cp.lessonsTotal);
  const progressPercent = asNum(cp.percent);
  const weak = (profile.weakAreas || []);
  const practice = asInt(metrics.practiceActivity);
  const quizAttempts = asInt(profile.quizPattern?.attempts);
  const accuracy = asNum(metrics.accuracy);
  const streak = asInt(profile.engagement?.streak);

  const riskScore = (kind) => asNum(risk.risks?.find((r) => r.kind === kind)?.score);

  /* The same floor the risk layer uses. Below it there is no behaviour to reason
   * from, so the engine returns nothing rather than dressing "less than a target"
   * up as a recommendation, a brand-new student's first step belongs to
   * onboarding, not to a prediction engine. */
  if (activeDays < CONFIDENCE_TARGETS.risk) {
    return {
      version: AI_INTELLIGENCE_VERSION,
      actions: [],
      best: null,
      reason: 'insufficient-data',
      minActiveDays: CONFIDENCE_TARGETS.risk,
      activeDays,
      streak,
      confidence: 0,
      band: 'insufficient'
    };
  }

  /* Goal pressure: a student close to their weekly target is pushed toward
   * volume, one far behind toward a small restart. */
  const goalProgress = clamp01(asNum(goal.progress, 0));
  const goalWeight = goal.target ? clamp01(1 - goalProgress) : 0.5;

  const candidates = [];

  if (daysSinceActive >= 3) {
    candidates.push({
      kind: 'return_after_inactivity',
      score: clamp01(0.75 + clamp01(daysSinceActive / 14) * 0.25),
      reasonBn: `${daysSinceActive} দিন ধরে পড়াশোনা হয়নি, ছোট একটি session দিয়ে ফেরাটাই সবচেয়ে সহজ।`,
      reasonEn: `No activity for ${daysSinceActive} days, a short session is the easiest way back.`,
      confidence: confidenceFromSample(activeDays, CONFIDENCE_TARGETS.risk)
    });
  }

  if (lessonsTotal > 0 && lessonsDone < lessonsTotal) {
    candidates.push({
      kind: 'continue_lesson',
      score: clamp01(0.55 + (1 - progressPercent / 100) * 0.25 + riskScore('lesson_completion_decline') * 0.2),
      reasonBn: `${lessonsDone}/${lessonsTotal} lesson শেষ, অসমাপ্ত lesson আগে শেষ করলে অগ্রগতি এগোবে।`,
      reasonEn: `${lessonsDone}/${lessonsTotal} lessons done, finishing the unfinished one moves progress.`,
      confidence: confidenceFromSample(activeDays, CONFIDENCE_TARGETS.profile)
    });
  }

  if (riskScore('lesson_completion_decline') >= 0.3 || asNum(profile.practicePattern?.cadence) < 0.4) {
    candidates.push({
      kind: 'review_previous_lesson',
      score: clamp01(0.4 + riskScore('lesson_completion_decline') * 0.4),
      reasonBn: 'আগের lesson-এ ফিরে গেলে ভিত্তি মজবুত হবে, নতুন lesson-এর চাপ কমবে।',
      reasonEn: 'Going back to the previous lesson strengthens the base before adding new load.',
      confidence: confidenceFromSample(activeDays, CONFIDENCE_TARGETS.profile)
    });
  }

  if (weak.length && accuracy < 80) {
    const top = weak[0];
    candidates.push({
      kind: 'revise_weak_topic',
      score: clamp01(0.5 + clamp01(asInt(top.misses) / 10) * 0.3 + (accuracy < 60 ? 0.15 : 0)),
      reasonBn: `"${top.topic}" topic-এ ${asInt(top.misses)} বার ভুল হয়েছে, এটাই এখন সবচেয়ে বড় ফাঁক।`,
      reasonEn: `"${top.topic}" has ${asInt(top.misses)} misses, the biggest current gap.`,
      params: { topic: top.topic },
      confidence: confidenceFromSample(practice, CONFIDENCE_TARGETS.profile)
    });
  }

  if (practice < 100 || riskScore('practice_decline') >= 0.3) {
    candidates.push({
      kind: 'practice',
      score: clamp01(0.45 + goalWeight * 0.25 + riskScore('practice_decline') * 0.2),
      reasonBn: goal.target
        ? `সাপ্তাহিক লক্ষ্যের ${Math.round(goalProgress * 100)}% হয়েছে, practice বাড়ালে লক্ষ্যের কাছাকাছি পৌঁছাবে।`
        : `এখন পর্যন্ত ${practice}টি প্রশ্ন, practice বাড়ালে নির্ভুলতাও বাড়বে।`,
      reasonEn: goal.target
        ? `${Math.round(goalProgress * 100)}% of the weekly target is done, more practice closes the gap.`
        : `${practice} questions so far, more practice also lifts accuracy.`,
      confidence: confidenceFromSample(activeDays, CONFIDENCE_TARGETS.profile)
    });
  }

  if (quizAttempts < 3 && practice >= 50) {
    candidates.push({
      kind: 'take_quiz',
      score: clamp01(0.35 + goalWeight * 0.2),
      reasonBn: 'যথেষ্ট practice হয়েছে, একটি quiz দিলে আসল প্রস্তুতিটা বোঝা যাবে।',
      reasonEn: 'Enough practice has accumulated, a quiz shows where the real readiness is.',
      confidence: confidenceFromSample(practice, CONFIDENCE_TARGETS.profile)
    });
  }

  const next = milestones.next;
  if (next && asNum(next.remaining) > 0 && asNum(next.target) > 0 && asNum(next.remaining) / asNum(next.target) <= 0.25) {
    candidates.push({
      kind: 'complete_milestone',
      score: clamp01(0.5 + (1 - asNum(next.remaining) / asNum(next.target)) * 0.3),
      reasonBn: `পরের milestone (${asInt(next.target)}) থেকে মাত্র ${asInt(next.remaining)} বাকি, অল্প পরিশ্রমেই পূরণ হবে।`,
      reasonEn: `Only ${asInt(next.remaining)} short of the next milestone (${asInt(next.target)}).`,
      params: { target: asInt(next.target), remaining: asInt(next.remaining) },
      confidence: confidenceFromSample(activeDays, CONFIDENCE_TARGETS.profile)
    });
  }

  const ranked = candidates
    .map((c) => ({
      ...c,
      labelBn: ACTION_LABEL_BN[c.kind],
      labelEn: ACTION_LABEL_EN[c.kind],
      score: round(c.score, 3),
      confidence: round(c.confidence, 2),
      band: confidenceBand(c.confidence)
    }))
    .filter((c) => c.score >= minScore)
    .sort((a, b) => (b.score - a.score) || (ACTION_ORDER.indexOf(a.kind) - ACTION_ORDER.indexOf(b.kind)));

  const best = ranked[0] || null;
  return {
    version: AI_INTELLIGENCE_VERSION,
    actions: ranked,
    best,
    /* No candidate cleared the floor: say so rather than padding the list. */
    reason: best ? 'ok' : (activeDays < CONFIDENCE_TARGETS.risk ? 'insufficient-data' : 'nothing-actionable'),
    streak,
    confidence: best ? best.confidence : 0,
    band: best ? best.band : 'insufficient'
  };
}

/* ── 5. best-time prediction ──────────────────────────────────────────────── */

/* Phase 3's rule-based timing stays in charge of *whether* a notification may
 * send. This only estimates *when* the student is actually present, which is the
 * signal the AI layer may add on top. */
export function predictBestTime(input = {}, options = {}) {
  const hours = Array.isArray(input.hours) ? input.hours.map(asNum) : new Array(24).fill(0);
  const total = sumOf(hours);
  const samples = asInt(input.samples, total);

  if (total <= 0 || samples < CONFIDENCE_TARGETS.bestTime) {
    return {
      version: AI_INTELLIGENCE_VERSION,
      hour: null,
      dayPart: null,
      confidence: confidenceFromSample(samples, CONFIDENCE_TARGETS.bestTime),
      band: confidenceBand(confidenceFromSample(samples, CONFIDENCE_TARGETS.bestTime)),
      histogram: hours,
      dayParts: dayPartTotals(hours),
      reason: 'insufficient-data',
      reasonBn: `সময় বোঝার জন্য এখনো যথেষ্ট activity নেই (${samples}/${CONFIDENCE_TARGETS.bestTime})।`,
      reasonEn: `Not enough activity to infer a time yet (${samples}/${CONFIDENCE_TARGETS.bestTime}).`
    };
  }

  /* A two-hour window, not a single hour, because a one-hour claim would be
   * noise-level precision from this sample. */
  const best = hours.indexOf(Math.max(...hours));
  const window = [best, (best + 1) % 24];
  const parts = dayPartTotals(hours);
  const bestPart = Object.entries(parts).sort((a, b) => b[1] - a[1])[0][0];

  return {
    version: AI_INTELLIGENCE_VERSION,
    hour: best,
    window,
    dayPart: bestPart,
    dayPartLabelBn: DAY_PART_LABEL_BN[bestPart],
    confidence: confidenceFromSample(samples, CONFIDENCE_TARGETS.bestTime),
    band: confidenceBand(confidenceFromSample(samples, CONFIDENCE_TARGETS.bestTime)),
    histogram: hours,
    dayParts: parts,
    reason: 'ok',
    reasonBn: `সাধারণত ${DAY_PART_LABEL_BN[bestPart]} সময়ে সক্রিয় থাকে, প্রায় ${String(best).padStart(2, '0')}:00–${String(window[1]).padStart(2, '0')}:00 এর মধ্যে।`,
    reasonEn: `Usually active in the ${bestPart}, around ${String(best).padStart(2, '0')}:00–${String(window[1]).padStart(2, '0')}:00.`
  };
}

function dayPartTotals(hours = []) {
  const out = { night: 0, morning: 0, afternoon: 0, evening: 0 };
  hours.forEach((v, h) => { out[dayPartOf(h)] += asNum(v); });
  return out;
}

/* ── 6. anomaly detection ─────────────────────────────────────────────────── */

/* Compares a recent window against a baseline and reports only shifts large
 * enough to be worth a human look. The baseline floor matters: a "drop" measured
 * against three observations is not an anomaly, it is noise. */
export function detectMetricAnomaly(recent, baseline, options = {}) {
  const r = asNum(recent);
  const b = asNum(baseline);
  const rSample = asInt(options.recentSample);
  const bSample = asInt(options.baselineSample);
  const higherIsBetter = options.higherIsBetter !== false;
  const minSample = asInt(options.minSample, CONFIDENCE_TARGETS.anomaly);
  const threshold = asNum(options.threshold, 0.3);

  const samples = Math.min(rSample, bSample);
  const confidence = confidenceFromSample(samples, minSample);
  if (samples < minSample || b <= 0) {
    return {
      status: 'insufficient',
      delta: 0,
      changeRatio: 0,
      confidence,
      band: confidenceBand(confidence),
      samples
    };
  }

  const changeRatio = (r - b) / b;
  const worsened = higherIsBetter ? changeRatio <= -threshold : changeRatio >= threshold;
  return {
    status: worsened ? 'anomaly' : Math.abs(changeRatio) >= threshold ? 'shift' : 'stable',
    delta: round(r - b, 3),
    changeRatio: round(changeRatio, 3),
    direction: changeRatio > 0 ? 'up' : changeRatio < 0 ? 'down' : 'flat',
    confidence,
    band: confidenceBand(confidence),
    samples,
    higherIsBetter
  };
}

export const ANOMALY_METRICS = Object.freeze([
  { key: 'quizCompletionRate', labelBn: 'কুইজ শেষ করার হার', labelEn: 'Quiz completion rate', higherIsBetter: true },
  { key: 'lessonErrorRate', labelBn: 'লেসন থেকে বেরিয়ে যাওয়ার হার', labelEn: 'Lesson exit rate', higherIsBetter: false },
  { key: 'engagementDau', labelBn: 'দৈনিক সক্রিয় student', labelEn: 'Daily active students', higherIsBetter: true },
  { key: 'notificationOpenRate', labelBn: 'নোটিফিকেশন খোলার হার', labelEn: 'Notification open rate', higherIsBetter: true }
]);

export function detectAnomalies(input = {}, options = {}) {
  const recent = input.recent || {};
  const baseline = input.baseline || {};
  const recentSample = asInt(input.recentSample);
  const baselineSample = asInt(input.baselineSample);

  const found = ANOMALY_METRICS.map((spec) => {
    const result = detectMetricAnomaly(recent[spec.key], baseline[spec.key], {
      recentSample, baselineSample, higherIsBetter: spec.higherIsBetter, ...options
    });
    return {
      key: spec.key,
      labelBn: spec.labelBn,
      labelEn: spec.labelEn,
      recent: asNum(recent[spec.key]),
      baseline: asNum(baseline[spec.key]),
      ...result,
      reasonBn: result.status === 'anomaly'
        ? `${spec.labelBn} অস্বাভাবিকভাবে ${result.direction === 'down' ? 'কমেছে' : 'বেড়েছে'} (${Math.round(Math.abs(result.changeRatio) * 100)}%)।`
        : null,
      reasonEn: result.status === 'anomaly'
        ? `${spec.labelEn} moved ${result.direction} ${Math.round(Math.abs(result.changeRatio) * 100)}% against the baseline.`
        : null
    };
  });

  return {
    version: AI_INTELLIGENCE_VERSION,
    anomalies: found.filter((f) => f.status === 'anomaly'),
    shifts: found.filter((f) => f.status === 'shift'),
    insufficient: found.filter((f) => f.status === 'insufficient').map((f) => f.key),
    all: found
  };
}

/* ── 7. trend prediction ──────────────────────────────────────────────────── */

/* Projects a series forward using the observed slope, and refuses to project
 * when the fit is too weak to mean anything. The confidence blends sample size
 * with R² so a long but noisy series does not read as a confident forecast. */
export function forecastTrend(values = [], options = {}) {
  const horizon = Math.max(asInt(options.horizonDays, 7), 1);
  const v = values.map(asNum);
  const slope = trendSlope(v, { tail: asInt(options.tail, 21) });
  if (v.length < 5) {
    return {
      version: AI_INTELLIGENCE_VERSION,
      direction: 'unknown', projected: null, slope: 0,
      confidence: 0, band: 'insufficient', samples: v.length,
      reasonBn: 'প্রবণতা বোঝার জন্য যথেষ্ট ডেটা নেই।',
      reasonEn: 'Not enough data to read a trend.'
    };
  }

  const m = mean(v);
  const fitted = v.map((_, i) => m + slope.slope * (i - (v.length - 1) / 2));
  const ssTot = v.reduce((a, x) => a + (x - m) ** 2, 0);
  const ssRes = v.reduce((a, x, i) => a + (x - fitted[i]) ** 2, 0);
  const r2 = ssTot === 0 ? 0 : clamp01(1 - ssRes / ssTot);

  const direction = directionOf(slope.slope, m);
  const confidence = round(clamp01(slope.confidence * 0.6 + r2 * 0.4), 2);
  const projected = round(Math.max(0, m + slope.slope * horizon), 2);

  return {
    version: AI_INTELLIGENCE_VERSION,
    direction,
    projected,
    current: round(m, 2),
    slope: slope.slope,
    r2: round(r2, 3),
    horizonDays: horizon,
    samples: v.length,
    confidence,
    band: confidenceBand(confidence),
    reasonBn: `প্রবণতা ${DIRECTION_BN[direction] || 'অজানা'}, পরের ${horizon} দিনে গড় প্রায় ${projected} হতে পারে।`,
    reasonEn: `Trend is ${direction}, the average may reach about ${projected} over the next ${horizon} days.`
  };
}

/* ── 8. content intelligence ──────────────────────────────────────────────── */

/* Reads the Phase 4 lesson/quiz rows and names the specific content that looks
 * wrong. It only suggests; it never edits content. */
export function buildContentIntelligence(input = {}, options = {}) {
  const lessons = Array.isArray(input.lessons) ? input.lessons : [];
  const quizzes = Array.isArray(input.quizzes) ? input.quizzes : [];
  const minSample = asInt(options.minSample, CONFIDENCE_TARGETS.content);
  const findings = [];

  for (const l of lessons) {
    const learners = asInt(l.learners ?? l.views);
    if (learners < minSample) continue;
    const completion = asNum(l.completionRate);
    const quizAccuracy = asNum(l.quizAccuracy);
    const exitRate = asNum(l.exits) / Math.max(asInt(l.starts), 1);
    const confidence = confidenceFromSample(learners, minSample);

    if (completion > 0 && completion < 50) {
      findings.push({
        id: `lesson-hard:${l.courseId || ''}/${l.lessonId}`,
        kind: 'low_completion',
        courseId: l.courseId || null,
        lessonId: l.lessonId || null,
        severity: completion < 30 ? 'high' : 'medium',
        confidence,
        band: confidenceBand(confidence),
        evidence: { learners, completionRate: completion, quizAccuracy, exitRate: round(exitRate, 3) },
        reasonBn: `এই lesson-এর completion rate ${completion}%, অনেক student শেষ করছে না। Content difficulty বা explanation review করা যেতে পারে।`,
        reasonEn: `Completion rate is ${completion}%, many students stop before the end. Review difficulty or explanation quality.`,
        suggestionBn: 'লেসনটি ছোট ভাগে ভাগ করা বা explanation স্পষ্ট করার পরামর্শ।',
        suggestionEn: 'Consider splitting the lesson or clarifying the explanation.'
      });
    }

    if (completion > 0 && completion < 50 && quizAccuracy > 0 && quizAccuracy < 50) {
      findings.push({
        id: `lesson-content:${l.courseId || ''}/${l.lessonId}`,
        kind: 'difficult_content',
        courseId: l.courseId || null,
        lessonId: l.lessonId || null,
        severity: 'high',
        confidence,
        band: confidenceBand(confidence),
        evidence: { learners, completionRate: completion, quizAccuracy },
        reasonBn: `completion ${completion}% এবং quiz accuracy ${quizAccuracy}%, দুটোই কম, তাই বিষয়বস্তু কঠিন বা অপরিষ্কার হওয়ার সম্ভাবনা।`,
        reasonEn: `Completion ${completion}% and quiz accuracy ${quizAccuracy}% are both low, the material is likely too hard or unclear.`,
        suggestionBn: 'লেসনের বিষয়বস্তু ও উদাহরণ পুনর্বিবেচনা করুন (admin approval ছাড়া পরিবর্তন নয়)।',
        suggestionEn: 'Revisit the content and examples (no change without admin approval).'
      });
    }

    if (exitRate >= 0.4 && asInt(l.starts) >= minSample) {
      findings.push({
        id: `lesson-exit:${l.courseId || ''}/${l.lessonId}`,
        kind: 'high_exit_rate',
        courseId: l.courseId || null,
        lessonId: l.lessonId || null,
        severity: exitRate >= 0.6 ? 'high' : 'medium',
        confidence,
        band: confidenceBand(confidence),
        evidence: { learners, starts: asInt(l.starts), exits: asInt(l.exits), exitRate: round(exitRate, 3) },
        reasonBn: `শুরু করার পর ${Math.round(exitRate * 100)}% ক্ষেত্রে student বেরিয়ে গেছে, মাঝপথে আটকে যাচ্ছে।`,
        reasonEn: `${Math.round(exitRate * 100)}% of starts end in an exit, students stall partway.`,
        suggestionBn: 'লেসনের মাঝের ধাপগুলো যাচাই করুন, সম্ভবত কোনো bug বা অস্পষ্ট ধাপ আছে।',
        suggestionEn: 'Check the middle steps, possibly a bug or an unclear step.'
      });
    }
  }

  for (const q of quizzes) {
    const attempts = asInt(q.attempts);
    if (attempts < minSample) continue;
    const accuracy = asNum(q.accuracy);
    const confidence = confidenceFromSample(attempts, minSample);
    if (accuracy > 0 && accuracy < 45) {
      findings.push({
        id: `quiz-hard:${q.quizId}`,
        kind: 'challenging_quiz',
        quizId: q.quizId || null,
        severity: accuracy < 30 ? 'high' : 'medium',
        confidence,
        band: confidenceBand(confidence),
        evidence: { attempts, accuracy, retryRate: asNum(q.retryRate) },
        reasonBn: `এই quiz-এর accuracy ${accuracy}%, খুব challenging। প্রশ্নের কঠিনতা বা ভাষা পুনর্বিবেচনা করা যেতে পারে।`,
        reasonEn: `Quiz accuracy is ${accuracy}%, unusually challenging. Review difficulty or wording.`,
        suggestionBn: 'প্রশ্নগুলোর কঠিনতা যাচাই করুন, প্রয়োজনে ভাগ করুন।',
        suggestionEn: 'Review question difficulty; consider splitting the quiz.'
      });
    }
    const hard = (q.hardestTopics || []).slice(0, 3);
    if (hard.length) {
      findings.push({
        id: `quiz-topics:${q.quizId}`,
        kind: 'recurring_mistakes',
        quizId: q.quizId || null,
        severity: 'medium',
        confidence,
        band: confidenceBand(confidence),
        evidence: { attempts, hardestTopics: hard },
        reasonBn: `বারবার ভুল হচ্ছে: ${hard.map((t) => (typeof t === 'string' ? t : t.topic)).join(', ')}।`,
        reasonEn: `Recurring misses: ${hard.map((t) => (typeof t === 'string' ? t : t.topic)).join(', ')}.`,
        suggestionBn: 'এই topic-গুলোতে অতিরিক্ত practice যোগ করার পরামর্শ।',
        suggestionEn: 'Consider adding extra practice for these topics.'
      });
    }
  }

  return {
    version: AI_INTELLIGENCE_VERSION,
    findings: findings.sort((a, b) => b.confidence - a.confidence || (b.severity === 'high' ? 1 : 0) - (a.severity === 'high' ? 1 : 0)),
    /* Content never changes on its own: this flag is the contract the admin UI
     * and the tests both read. */
    requiresAdminApproval: true,
    noteBn: 'AI শুধু পরামর্শ দেয়, কোনো content পরিবর্তন admin approval ছাড়া হবে না।',
    noteEn: 'AI only suggests, no content changes without admin approval.'
  };
}

/* ── 9. course optimisation ───────────────────────────────────────────────── */

export function buildCourseIntelligence(input = {}, options = {}) {
  const courses = Array.isArray(input.courses) ? input.courses : [];
  const minSample = asInt(options.minSample, CONFIDENCE_TARGETS.course);
  const suggestions = [];

  for (const c of courses) {
    const learners = asInt(c.learners);
    if (learners < minSample) continue;
    const completion = asNum(c.completionRate);
    const lessonCompletion = asNum(c.lessonCompletionRate);
    const confidence = confidenceFromSample(learners, minSample);

    if (completion > 0 && completion < 40) {
      suggestions.push({
        id: `course-completion:${c.courseId}`,
        courseId: c.courseId,
        kind: 'completion_risk',
        severity: completion < 20 ? 'high' : 'medium',
        confidence,
        band: confidenceBand(confidence),
        evidence: { learners, completionRate: completion, lessonCompletionRate: lessonCompletion },
        suggestionBn: 'lesson ordering ও দৈর্ঘ্য পুনর্বিবেচনা করুন, শুরুর দিকের lesson-এ drop-off বেশি হলে সেটাই আগে দেখুন।',
        suggestionEn: 'Review lesson ordering and length, check early lessons first if drop-off clusters there.'
      });
    }

    if (lessonCompletion > 0 && lessonCompletion < 55) {
      suggestions.push({
        id: `course-lessons:${c.courseId}`,
        courseId: c.courseId,
        kind: 'lesson_completion_low',
        severity: 'medium',
        confidence,
        band: confidenceBand(confidence),
        evidence: { learners, lessonCompletionRate: lessonCompletion },
        suggestionBn: 'লেসনগুলো ছোট টুকরোতে ভাগ করলে ও practice মিশিয়ে দিলে completion বাড়তে পারে।',
        suggestionEn: 'Shorter lessons with interleaved practice tend to lift completion.'
      });
    }

    if (asInt(c.starts) > 0 && completion === 0 && asInt(c.completed) === 0) {
      suggestions.push({
        id: `course-abandoned:${c.courseId}`,
        courseId: c.courseId,
        kind: 'no_completions',
        severity: 'high',
        confidence,
        band: confidenceBand(confidence),
        evidence: { learners, starts: asInt(c.starts), completed: asInt(c.completed) },
        suggestionBn: 'এখনো কেউ কোর্সটি শেষ করেনি, প্রথম lesson-এর দৈর্ঘ্য ও কঠিনতা যাচাই করুন।',
        suggestionEn: 'Nobody has finished this course yet, check the first lesson for length and difficulty.'
      });
    }
  }

  return {
    version: AI_INTELLIGENCE_VERSION,
    suggestions: suggestions.sort((a, b) => b.confidence - a.confidence),
    requiresAdminApproval: true,
    noteBn: 'কোর্স কাঠামো AI নিজে বদলাবে না, admin অনুমোদনের পরই পরিবর্তন।',
    noteEn: 'AI never restructures a course on its own, changes need admin approval.'
  };
}

/* ── 10. AI performance evaluation ────────────────────────────────────────── */

/* Measures the AI layer itself. Without this the only evidence that a
 * recommendation engine works is that someone liked the wording. */
export function evaluateAiPerformance(decisions = [], options = {}) {
  const rows = Array.isArray(decisions) ? decisions : [];
  const withOutcome = rows.filter((d) => d && d.outcome);
  const accepted = rows.filter((d) => d.actionTaken === 'accepted' || d.outcome?.accepted === true);
  const converted = withOutcome.filter((d) => d.outcome?.learned === true);
  const rejected = rows.filter((d) => d.actionTaken === 'rejected');

  const confidences = rows.map((d) => asNum(d.confidence)).filter((c) => c > 0);
  const latencies = rows.map((d) => asNum(d.latencyMs)).filter((l) => l > 0);
  const costs = rows.map((d) => d.costUsd).filter((c) => Number.isFinite(Number(c)));

  /* A false positive is a confident recommendation whose outcome was negative;
   * a false negative is a low-confidence call that turned out positive. Both are
   * counted only where an outcome exists, so silence is never scored as success. */
  const falsePositive = withOutcome.filter((d) => asNum(d.confidence) >= 0.6 && d.outcome?.learned === false).length;
  const falseNegative = withOutcome.filter((d) => asNum(d.confidence) < 0.4 && d.outcome?.learned === true).length;

  return {
    version: AI_INTELLIGENCE_VERSION,
    total: rows.length,
    scored: withOutcome.length,
    acceptanceRate: rows.length ? round(accepted.length / rows.length, 3) : 0,
    learningConversion: withOutcome.length ? round(converted.length / withOutcome.length, 3) : 0,
    rejectionRate: rows.length ? round(rejected.length / rows.length, 3) : 0,
    falsePositive,
    falseNegative,
    falsePositiveRate: withOutcome.length ? round(falsePositive / withOutcome.length, 3) : 0,
    falseNegativeRate: withOutcome.length ? round(falseNegative / withOutcome.length, 3) : 0,
    avgConfidence: confidences.length ? round(mean(confidences), 3) : 0,
    avgLatencyMs: latencies.length ? Math.round(mean(latencies)) : 0,
    cost: {
      /* Never fabricate a price. Unpriced stays unpriced, exactly as the Phase 9
       * observability layer does. */
      samples: costs.length,
      totalUsd: costs.length ? round(costs.reduce((a, b) => a + Number(b), 0), 4) : null,
      priced: costs.length > 0
    },
    /* Honest about the ceiling: with no outcomes recorded, quality is unknown,
     * not perfect. */
    quality: withOutcome.length < asInt(options.minScored, 5)
      ? 'insufficient-outcomes'
      : (falsePositive + falseNegative) / withOutcome.length <= 0.2 ? 'good' : 'needs-review'
  };
}

/* ── 11. aggregate signals for the admin AI surface ───────────────────────── */

export function buildAdminAiSignals(input = {}, options = {}) {
  const dashboard = input.dashboard || {};
  const series = Array.isArray(input.series) ? input.series : [];

  const engagementForecast = forecastTrend(series.map((d) => asNum(d.questions)), options);
  const lessonForecast = forecastTrend(series.map((d) => asNum(d.lessons)), options);
  const content = buildContentIntelligence({ lessons: dashboard.lessons, quizzes: dashboard.quizzes }, options);
  const course = buildCourseIntelligence({ courses: dashboard.courses }, options);

  return {
    version: AI_INTELLIGENCE_VERSION,
    forecasts: { engagement: engagementForecast, lessons: lessonForecast },
    content,
    course,
    /* The Phase 4 insight list is passed through untouched, the AI layer adds
     * to it, it does not rewrite what the rules already established. */
    baseInsights: Array.isArray(dashboard.insights) ? dashboard.insights : [],
    generatedAt: asNum(options.now, Date.now())
  };
}
