/* Phase 5, AI Admin Copilot, Natural-Language Query and Notification Writer.
 *
 * Three surfaces, one shared rule: the model may write prose, never numbers.
 *
 *   intent      a question in Bangla or English is mapped to a *predefined*
 *               query over the Phase 4 payloads. The model never sees a SQL
 *               string and never picks what to read, `QUERY_CATALOGUE` decides.
 *   answer      the numbers come out of that query, then the model is asked only
 *               to phrase them. `groundAnswer` re-checks the phrasing and throws
 *               it away if it cites a figure the query did not return.
 *   writer      notification wording, produced per Phase 3 variant and then run
 *               through the sanitiser in `ai-analytics-policy.mjs`.
 *
 * The provider is injected (`deps.generate`) rather than imported. That keeps
 * this module free of a hard dependency on the Agent Core, lets the route pass
 * whichever chain is configured, and means the tests exercise the real
 * intent → query → grounding path with a deterministic generator instead of
 * stubbing the module under test. When no provider is supplied the copilot still
 * answers: it falls back to the deterministic template, because a data question
 * should not fail just because the wording layer is unavailable.
 */

import { normaliseBengaliDigits, groundAnswer, sanitiseGeneratedCopy } from './ai-analytics-policy.mjs';
import { AI_INTELLIGENCE_VERSION } from './ai-analytics-intelligence.mjs';
import { getPromptText } from './prompt-registry.js';

export const AI_COPILOT_VERSION = 'ai-p5-copilot-v1';

const asInt = (v, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
};

const asNum = (v, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

/* Bengali numerals for the deterministic answer, so the fallback reads natively
 * instead of switching to Latin digits mid-sentence. */
const BN_DIGITS = '০১২৩৪৫৬৭৮৯';
function bn(value) {
  if (value === null || value === undefined || value === '') return '-';
  return String(value).replace(/[0-9]/g, (d) => BN_DIGITS[Number(d)]);
}

/* Latin digits for the English sentence, plus an em dash for a missing value so
 * an absent metric never prints as "0". */
function sp(value) {
  return value === null || value === undefined || value === '' ? '-' : String(value);
}

/* ── intent detection ─────────────────────────────────────────────────────── */

/* Keyword sets, Bangla and English. Deterministic, ordered, and deliberately
 * small: an admin asking something outside this set gets "I don't have a query
 * for that", which is the correct answer, rather than a model improvising a
 * number. */
export const INTENTS = Object.freeze([
  {
    id: 'engagement',
    query: 'engagement.summary',
    keywords: ['ইনগেজমেন্ট', 'সক্রিয়তা', 'engagement', 'active', 'dau', 'wau', 'mau', 'stickiness']
  },
  {
    id: 'dropoff',
    query: 'courses.dropoff',
    keywords: ['ড্রপ', 'drop-off', 'dropoff', 'ঝরে', 'কোথায় আটকে', 'কোথায় থেমে', 'completion', 'abandon']
  },
  {
    id: 'notifications',
    query: 'notifications.performance',
    keywords: ['নোটিফিকেশন', 'বিজ্ঞপ্তি', 'notification', 'open rate', 'click rate', 'campaign', 'কোন নোটিফিকেশন ভালো']
  },
  {
    id: 'lessons',
    query: 'lessons.review',
    keywords: ['লেসন', 'পাঠ', 'lesson', 'কঠিন', 'review', 'difficult', 'hard']
  },
  {
    id: 'quizzes',
    query: 'quizzes.review',
    keywords: ['কুইজ', 'quiz', 'accuracy']
  },
  {
    id: 'retention',
    query: 'retention.summary',
    keywords: ['রিটেনশন', 'retention', 'cohort', 'returning', 'ফিরে আস', 'come back']
  },
  {
    id: 'segments',
    query: 'segments.summary',
    keywords: ['সেগমেন্ট', 'segment', 'ঝুঁকিতে', 'at risk', 'নিষ্ক্রিয়', 'inactive']
  },
  {
    id: 'funnel',
    query: 'funnel.summary',
    keywords: ['ফানেল', 'funnel', 'ধাপ', 'step', 'stage']
  },
  {
    id: 'risk',
    query: 'risk.summary',
    keywords: ['ঝুঁকি', 'risk', 'risky']
  },
  {
    id: 'trend',
    query: 'trend.summary',
    keywords: ['প্রবণতা', 'trend', 'বাড়ছে', 'কমছে', 'declining', 'rising']
  },
  {
    id: 'anomaly',
    query: 'anomaly.summary',
    keywords: ['অস্বাভাবিক', 'anomaly', 'unusual', 'হঠাৎ', 'sudden', 'spike']
  }
]);

/* Lowercased, Bengali digits normalised, so "গত ৩০ দিনে" and "last 30 days"
 * match the same window. */
export function normaliseQuestion(question) {
  return normaliseBengaliDigits(String(question || ''))
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function detectIntent(question) {
  const q = normaliseQuestion(question);
  if (!q) return { intent: null, query: null, confidence: 0, reason: 'empty-question' };

  let best = null;
  for (const spec of INTENTS) {
    let hits = 0;
    for (const k of spec.keywords) {
      if (q.includes(k.toLowerCase())) hits += 1;
    }
    if (hits > 0 && (!best || hits > best.hits)) best = { spec, hits };
  }

  if (!best) return { intent: null, query: null, confidence: 0, reason: 'no-matching-intent' };
  return {
    intent: best.spec.id,
    query: best.spec.query,
    /* Intent confidence is about the *question*, not the data: one keyword is
     * enough to route, more keywords is a stronger match. */
    confidence: Math.min(1, 0.5 + best.hits * 0.2),
    hits: best.hits,
    reason: 'ok'
  };
}

/* A window mentioned in the question ("last 7 days", "গত ৩০ দিনে") is honoured;
 * otherwise the caller's default applies. Bounded to the same range Phase 4
 * allows so a question cannot widen the read. */
export function parseWindow(question, fallbackDays = 30) {
  const q = normaliseQuestion(question);
  const m = q.match(/(?:last|গত|সর্বশেষ|past)\s*(\d{1,3})\s*(?:days?|দিন)/) || q.match(/(\d{1,3})\s*(?:days?|দিন)/);
  if (!m) return { days: Math.max(1, Math.min(asInt(fallbackDays, 30), 365)), fromQuestion: false };
  return { days: Math.max(1, Math.min(asInt(m[1], fallbackDays), 365)), fromQuestion: true };
}

/* ── predefined query catalogue ───────────────────────────────────────────── */

/* Only finite numbers reach the payload. An `undefined` left as-is would pass the
 * grounding check as "no number" while also letting an empty metric read as a
 * real zero; `null` is the one honest representation of "not measured". */
function nd(value) {
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

/* Every query is a small pure function over the Phase 4 admin payload. This is
 * the only thing the copilot is allowed to read, which is what makes "AI cannot
 * invent an analytics number" structural rather than a promise: if a figure is
 * not in one of these results, the grounding check rejects it. */
export const QUERY_CATALOGUE = Object.freeze({
  'engagement.summary': (d) => ({
    dau: nd(d.engagement?.dau),
    wau: nd(d.engagement?.wau),
    mau: nd(d.engagement?.mau),
    stickiness: nd(d.engagement?.stickiness),
    dauWauRatio: nd(d.engagement?.dauWauRatio),
    activeStudents: nd(d.engagement?.activeStudents),
    totalStudents: nd(d.engagement?.totalStudents),
    sessions: nd(d.engagement?.sessions),
    avgSessionMin: d.engagement?.avgSessionMs ? Number((d.engagement.avgSessionMs / 60000).toFixed(1)) : null
  }),
  'courses.dropoff': (d) => {
    const courses = (d.courses || []).slice().sort((a, b) => asNum(a.completionRate) - asNum(b.completionRate));
    return {
      worst: courses.slice(0, 3).map((c) => ({
        courseId: c.courseId,
        learners: asInt(c.learners),
        completionRate: asNum(c.completionRate),
        lessonCompletionRate: asNum(c.lessonCompletionRate)
      })),
      withZeroCompletions: courses.filter((c) => asInt(c.completed) === 0 && asInt(c.starts) > 0).map((c) => c.courseId),
      totalCourses: courses.length
    };
  },
  'notifications.performance': (d) => {
    const n = d.notifications || {};
    const ranked = n.campaigns || d.campaigns?.ranked || [];
    return {
      sent: asInt(n.overall?.sent),
      openRate: asNum(n.overall?.openRate),
      clickRate: asNum(n.overall?.clickRate),
      learningConversion: asNum(n.overall?.learningConversion),
      bestCategory: n.bestCategory || null,
      bestKind: n.bestKind || null,
      bestVariant: n.bestVariant || null,
      topCampaigns: ranked.slice(0, 3).map((c) => ({
        campaignId: c.campaignId,
        delivered: asInt(c.delivered),
        openRate: asNum(c.openRate)
      })),
      isLive: ranked.filter((c) => c.isLive).length
    };
  },
  'lessons.review': (d) => {
    const lessons = (d.lessons || [])
      .filter((l) => asInt(l.learners ?? l.views) >= 5)
      .slice()
      .sort((a, b) => asNum(a.completionRate) - asNum(b.completionRate));
    return {
      needsReview: lessons.slice(0, 5).map((l) => ({
        courseId: l.courseId || null,
        lessonId: l.lessonId || null,
        learners: asInt(l.learners ?? l.views),
        completionRate: asNum(l.completionRate),
        quizAccuracy: asNum(l.quizAccuracy),
        exitRate: asInt(l.starts) ? Number((asInt(l.exits) / asInt(l.starts)).toFixed(3)) : 0
      })),
      reportedLessons: lessons.length
    };
  },
  'quizzes.review': (d) => {
    const quizzes = (d.quizzes || [])
      .filter((q) => asInt(q.attempts) >= 5)
      .slice()
      .sort((a, b) => asNum(a.accuracy) - asNum(b.accuracy));
    return {
      hardest: quizzes.slice(0, 5).map((q) => ({
        quizId: q.quizId || null,
        attempts: asInt(q.attempts),
        accuracy: asNum(q.accuracy),
        completionRate: asNum(q.completionRate)
      })),
      totalQuizzes: (d.quizzes || []).length
    };
  },
  'retention.summary': (d) => ({
    d1: asNum(d.retention?.byWindow?.d1),
    d7: asNum(d.retention?.byWindow?.d7),
    d14: asNum(d.retention?.byWindow?.d14),
    d30: asNum(d.retention?.byWindow?.d30),
    cohortSize: asInt(d.retention?.cohortSize)
  }),
  'segments.summary': (d) => ({
    counts: d.segments?.counts || {},
    total: asInt(d.segments?.total),
    stages: d.segments?.stages || {}
  }),
  'funnel.summary': (d) => ({
    steps: (d.funnel || []).map((s) => ({
      key: s.key, count: asInt(s.count), reachRate: asNum(s.reachRate), dropRate: asNum(s.dropRate)
    })),
    steepest: d.dropOff?.steepest?.key || null,
    dropRate: asNum(d.dropOff?.dropRate),
    hasAlert: Boolean(d.dropOff?.hasAlert)
  }),
  'risk.summary': (d) => ({
    atRisk: asInt(d.segments?.counts?.at_risk),
    inactive: asInt(d.segments?.counts?.inactive),
    total: asInt(d.segments?.total),
    riskInsightCount: (d.insights || []).filter((i) => /risk|ঝুঁকি|drop|declin/i.test(String(i.id || '') + String(i.text || ''))).length
  }),
  'trend.summary': (d) => ({
    text: d.trendSummary?.text || null,
    up: (d.trendSummary?.up || []).slice(0, 4),
    down: (d.trendSummary?.down || []).slice(0, 4),
    trends: d.trends || {}
  }),
  'anomaly.summary': (d) => ({
    anomalySignals: (d.signals?.insights || []).length,
    dropOffAlert: Boolean(d.dropOff?.hasAlert)
  })
});

export const QUERY_IDS = Object.freeze(Object.keys(QUERY_CATALOGUE));

export function runQuery(queryId, dashboard = {}, filters = {}) {
  const fn = QUERY_CATALOGUE[queryId];
  if (!fn) return { ok: false, reason: 'unknown-query', queryId };
  try {
    return { ok: true, queryId, data: fn(dashboard, filters) };
  } catch (err) {
    return { ok: false, reason: 'query-failed', queryId, detail: String(err?.message || err) };
  }
}

/* ── deterministic answer ─────────────────────────────────────────────────── */

/* The answer that is always available, model or no model. Every sentence here is
 * assembled from query output, so it is grounded by construction. */
export function composeAnswer(intent, queryResult, filters = {}) {
  if (!queryResult?.ok) {
    return {
      ok: false,
      reason: queryResult?.reason || 'no-data',
      textBn: 'এই প্রশ্নের জন্য কোনো নির্দিষ্ট analytics query নেই।',
      textEn: 'There is no specific analytics query for that question.'
    };
  }
  const d = queryResult.data || {};
  const lines = [];

  switch (intent) {
    case 'engagement':
      lines.push([
        `গত ${filters.days || 30} দিনে দৈনিক সক্রিয় student (DAU) ${bn(d.dau)}, সাপ্তাহিক ${bn(d.wau)}, মাসিক ${bn(d.mau)}।`,
        `Over the last ${filters.days || 30} days, DAU was ${sp(d.dau)}, WAU ${sp(d.wau)}, MAU ${sp(d.mau)}.`
      ]);
      lines.push([
        `মোট ${bn(d.totalStudents)} জন student-এর মধ্যে ${bn(d.activeStudents)} জন সক্রিয়; stickiness ${bn(d.stickiness)}।`,
        `${sp(d.activeStudents)} of ${sp(d.totalStudents)} students were active; stickiness ${sp(d.stickiness)}.`
      ]);
      break;
    case 'dropoff':
      lines.push([
        `সবচেয়ে কম completion rate: ${d.worst?.map((c) => `${c.courseId} (${bn(c.completionRate)}%)`).join(', ') || 'কোনো data নেই'}।`,
        `Lowest completion: ${d.worst?.map((c) => `${c.courseId} (${sp(c.completionRate)}%)`).join(', ') || 'no data'}.`
      ]);
      if (d.withZeroCompletions?.length) {
        lines.push([
          `এখনো কেউ শেষ করেনি: ${d.withZeroCompletions.join(', ')}।`,
          `No completions yet: ${d.withZeroCompletions.join(', ')}.`
        ]);
      }
      break;
    case 'notifications':
      lines.push([
        `গত ${filters.days || 30} দিনে ${bn(d.sent)}টি নোটিফিকেশন পাঠানো হয়েছে; open rate ${bn(d.openRate)}%, click rate ${bn(d.clickRate)}%, learning conversion ${bn(d.learningConversion)}%।`,
        `${sp(d.sent)} notifications sent in the last ${filters.days || 30} days; open rate ${sp(d.openRate)}%, click rate ${sp(d.clickRate)}%, learning conversion ${sp(d.learningConversion)}%.`
      ]);
      if (d.bestCategory) lines.push([`সবচেয়ে ভালো category: ${d.bestCategory}।`, `Best category: ${d.bestCategory}.`]);
      break;
    case 'lessons':
      lines.push([
        `review দরকার এমন lesson: ${d.needsReview?.map((l) => `${l.lessonId || l.courseId} (completion ${bn(l.completionRate)}%, quiz ${bn(l.quizAccuracy)}%)`).join('; ') || 'কোনো lesson-এ পর্যাপ্ত data নেই'}।`,
        `Lessons worth review: ${d.needsReview?.map((l) => `${l.lessonId || l.courseId} (completion ${sp(l.completionRate)}%, quiz ${sp(l.quizAccuracy)}%)`).join('; ') || 'no lesson has enough data'}.`
      ]);
      break;
    case 'quizzes':
      lines.push([
        `সবচেয়ে কঠিন quiz: ${d.hardest?.map((q) => `${q.quizId} (accuracy ${bn(q.accuracy)}%, ${bn(q.attempts)} attempt)`).join('; ') || 'পর্যাপ্ত data নেই'}।`,
        `Hardest quizzes: ${d.hardest?.map((q) => `${q.quizId} (accuracy ${sp(q.accuracy)}%, ${sp(q.attempts)} attempts)`).join('; ') || 'not enough data'}.`
      ]);
      break;
    case 'retention':
      lines.push([
        `Retention: day-1 ${bn(d.d1)}%, day-7 ${bn(d.d7)}%, day-14 ${bn(d.d14)}%, day-30 ${bn(d.d30)}% (cohort ${bn(d.cohortSize)})।`,
        `Retention: day-1 ${sp(d.d1)}%, day-7 ${sp(d.d7)}%, day-14 ${sp(d.d14)}%, day-30 ${sp(d.d30)}% (cohort ${sp(d.cohortSize)}).`
      ]);
      break;
    case 'segments':
      lines.push([
        `Segment বণ্টন: ${Object.entries(d.counts || {}).map(([k, v]) => `${k} ${bn(v)}`).join(', ') || 'কোনো data নেই'} (মোট ${bn(d.total)})।`,
        `Segment split: ${Object.entries(d.counts || {}).map(([k, v]) => `${k} ${sp(v)}`).join(', ') || 'no data'} (total ${sp(d.total)}).`
      ]);
      break;
    case 'funnel':
      lines.push([
        `Funnel: ${d.steps?.map((s) => `${s.key} ${bn(s.count)}`).join(' → ') || 'কোনো data নেই'}।`,
        `Funnel: ${d.steps?.map((s) => `${s.key} ${sp(s.count)}`).join(' → ') || 'no data'}.`
      ]);
      if (d.hasAlert) lines.push([`সবচেয়ে বেশি drop: ${d.steepest} (${bn(d.dropRate)}%)।`, `Steepest drop: ${d.steepest} (${sp(d.dropRate)}%).`]);
      break;
    case 'risk':
      lines.push([
        `ঝুঁকিতে ${bn(d.atRisk)} জন, নিষ্ক্রিয় ${bn(d.inactive)} জন, মোট ${bn(d.total)} জনের মধ্যে।`,
        `${sp(d.atRisk)} at risk and ${sp(d.inactive)} inactive out of ${sp(d.total)}.`
      ]);
      break;
    case 'trend':
      lines.push([
        d.text || 'প্রবণতার জন্য যথেষ্ট data নেই।',
        d.text || 'Not enough data to describe a trend.'
      ]);
      break;
    case 'anomaly':
      lines.push([
        d.dropOffAlert ? 'Funnel-এ একটি drop-off alert আছে।' : 'বর্তমানে কোনো অস্বাভাবিক drop-off alert নেই।',
        d.dropOffAlert ? 'There is a funnel drop-off alert right now.' : 'No unusual drop-off alert right now.'
      ]);
      break;
    default:
      return { ok: false, reason: 'no-template', textBn: 'এই প্রশ্নের জন্য উত্তর তৈরি করা যায়নি।', textEn: 'No answer template for that question.' };
  }

  /* Each line carries both languages; the caller picks. Keeping them side by side
   * means a new intent cannot ship in only one language by accident. */
  return {
    ok: true,
    intent,
    lines,
    textBn: lines.map((l) => l[0]).join(' '),
    textEn: lines.map((l) => l[1]).join(' '),
    grounded: queryResult.data
  };
}

/* ── model-assisted rephrasing ────────────────────────────────────────────── */

/* The prompt is deliberately constrained: restate these figures, invent nothing,
 * add nothing. The grounding check is the real enforcement; the instruction just
 * gives the model a fair chance to comply. The text lives in the prompt registry
 * so it is versioned alongside the other prompts, with a local fallback for the
 * (test-only) case where the registry has been emptied. */
export const COPILOT_SYSTEM_PROMPT = getPromptText('analytics-copilot') || [
  'You are the Admission Hub analytics copilot.',
  'You are given a computed result and must restate it in one short, plain paragraph.',
  'HARD RULES:',
  '1. Use only the numbers present in the provided result. Never compute, round differently, or invent a number.',
  '2. If the result is empty or null, say plainly that there is not enough data.',
  '3. Never mention a student by name or id, and never describe an individual student.',
  '4. No markdown, no headings, no lists, one paragraph of at most three sentences.',
  '5. Answer in the language asked for: Bangla if the question is Bangla, English if it is English.'
].join('\n');

export const WRITER_SYSTEM_PROMPT = getPromptText('notification-writer') || null;

export function buildCopilotPrompt(question, queryResult, filters = {}) {
  return [
    COPILOT_SYSTEM_PROMPT,
    '',
    `Question: ${String(question || '').slice(0, 400)}`,
    `Window: last ${asInt(filters.days, 30)} days`,
    'Result (JSON, the only permitted source of numbers):',
    JSON.stringify(queryResult?.data ?? null)
  ].join('\n');
}

/* Runs intent → query → grounding. Returns `usedModel:false` and the
 * deterministic answer whenever the model is unavailable, fails, or produces an
 * answer that cites an ungrounded number, so the copilot degrades to correct
 * instead of to wrong. */
export async function answerQuestion(question, options = {}) {
  const { dashboard = {}, filters = {}, deps = {} } = options;
  const started = Date.now();

  const intent = detectIntent(question);
  if (!intent.intent) {
    return {
      version: AI_COPILOT_VERSION,
      ok: false,
      reason: intent.reason,
      textBn: 'এই প্রশ্নটি বুঝতে পারিনি অথবা এর জন্য কোনো নির্দিষ্ট query নেই। নিচের উদাহরণগুলো দেখুন।',
      textEn: 'I could not map that question to a query. Try one of the examples.',
      suggestionsBn: exampleQuestions('bn'),
      suggestionsEn: exampleQuestions('en'),
      usedModel: false,
      latencyMs: Date.now() - started
    };
  }

  const queryResult = runQuery(intent.query, dashboard, filters);
  const composed = composeAnswer(intent.intent, queryResult, filters);

  if (!composed.ok) {
    return {
      version: AI_COPILOT_VERSION, ok: false, reason: composed.reason,
      intent: intent.intent,
      textBn: composed.textBn, textEn: composed.textEn,
      usedModel: false, latencyMs: Date.now() - started
    };
  }

  const base = {
    version: AI_COPILOT_VERSION,
    ok: true,
    intent: intent.intent,
    query: intent.query,
    window: { days: asInt(filters.days, 30) },
    grounded: queryResult.data,
    textBn: composed.textBn,
    textEn: composed.textEn,
    usedModel: false,
    latencyMs: Date.now() - started
  };

  if (typeof deps.generate !== 'function') return base;

  try {
    const prompt = buildCopilotPrompt(question, queryResult, filters);
    const lang = isBangla(question) ? 'bn' : 'en';
    const generated = await deps.generate({ prompt, system: COPILOT_SYSTEM_PROMPT, lang, purpose: 'copilot' });
    const raw = String(generated?.text || generated || '').trim();
    if (!raw) return base;

    /* The check runs on digit-normalised text, so a Bangla answer with Bengali
     * numerals is verified against the same figures the query returned. The window
     * length is whitelisted because naming the period is not a data claim. */
    const check = groundAnswer(normaliseBengaliDigits(raw), queryResult.data, { allow: [asInt(filters.days, 30)] });
    if (!check.ok) {
      return {
        ...base,
        usedModel: false,
        degraded: 'ungrounded-number',
        ungrounded: check.ungrounded,
        model: generated?.model || null,
        modelVersion: generated?.modelVersion || null,
        latencyMs: Date.now() - started
      };
    }

    return {
      ...base,
      usedModel: true,
      model: generated?.model || null,
      modelVersion: generated?.modelVersion || null,
      textBn: lang === 'bn' ? raw : base.textBn,
      textEn: lang === 'en' ? raw : base.textEn,
      latencyMs: Date.now() - started
    };
  } catch (err) {
    return { ...base, usedModel: false, degraded: 'provider-error', detail: String(err?.message || err), latencyMs: Date.now() - started };
  }
}

export function exampleQuestions(lang = 'bn') {
  const bnList = [
    'এই সপ্তাহে students-এর engagement কেমন?',
    'কোন course-এ সবচেয়ে বেশি drop-off?',
    'কোন notification সবচেয়ে ভালো কাজ করেছে?',
    'কোন lesson review করা দরকার?',
    'গত ৩০ দিনে retention কেমন?'
  ];
  const enList = [
    'How is student engagement this week?',
    'Which course has the most drop-off?',
    'Which notification performed best?',
    'Which lesson needs review?',
    'How is retention over the last 30 days?'
  ];
  return lang === 'en' ? enList : bnList;
}

const isBangla = (text) => /[\u0980-\u09FF]/.test(String(text || ''));

/* ── AI notification writer ───────────────────────────────────────────────── */

/* Phase 3 owns the copy catalogue and the variant assignment. This produces an
 * alternative wording for an already-decided notification, it never decides
 * whether to send, which kind, or to whom. Whatever comes back must pass the
 * policy sanitiser before it is usable. */
export function buildWriterPrompt(kind, params = {}, options = {}) {
  const lang = options.lang === 'en' ? 'English' : 'Bangla';
  return [
    WRITER_SYSTEM_PROMPT || 'You write one short in-app notification for a student preparing for university admission in Bangladesh.',
    `Language: ${lang}.`,
    `Notification kind: ${kind}.`,
    `Facts you may reference: ${JSON.stringify(compactParams(params))}`
  ].join('\n');
}

/* Only the fields the writer is allowed to see. Anything else, ids, internal
 * flags, is dropped before the prompt is built, so the model cannot echo it. */
function compactParams(params = {}) {
  const allowed = ['lessonTitle', 'courseTitle', 'topic', 'streak', 'remaining', 'target', 'percent', 'bestTime', 'name'];
  const out = {};
  for (const k of allowed) {
    if (params[k] !== undefined && params[k] !== null) out[k] = params[k];
  }
  return out;
}

export async function writeNotification(kind, params = {}, options = {}) {
  const deterministic = options.fallbackCopy || null;
  const started = Date.now();

  if (typeof options.deps?.generate !== 'function') {
    return {
      version: AI_COPILOT_VERSION,
      ok: Boolean(deterministic),
      source: 'phase3-catalogue',
      copy: deterministic,
      usedModel: false,
      latencyMs: Date.now() - started
    };
  }

  const lang = options.lang === 'en' ? 'en' : 'bn';
  const prompt = buildWriterPrompt(kind, params, { lang });
  try {
    const generated = await options.deps.generate({ prompt, lang, purpose: 'notification-writer' });
    const raw = String(generated?.text || generated || '').trim();
    const sanitised = sanitiseGeneratedCopy({ [lang]: raw }, { lang });

    /* If the model's wording trips a safety rule, fall back to the Phase 3 copy
     * rather than shipping something manipulative. */
    if (!sanitised.ok) {
      return {
        version: AI_COPILOT_VERSION,
        ok: Boolean(deterministic),
        source: 'phase3-catalogue',
        copy: deterministic,
        usedModel: false,
        rejected: sanitised.violations,
        model: generated?.model || null,
        latencyMs: Date.now() - started
      };
    }

    return {
      version: AI_COPILOT_VERSION,
      ok: true,
      source: 'ai-writer',
      copy: sanitised.copy,
      model: generated?.model || null,
      modelVersion: generated?.modelVersion || null,
      usedModel: true,
      latencyMs: Date.now() - started
    };
  } catch (err) {
    return {
      version: AI_COPILOT_VERSION,
      ok: Boolean(deterministic),
      source: 'phase3-catalogue',
      copy: deterministic,
      usedModel: false,
      degraded: 'provider-error',
      detail: String(err?.message || err),
      latencyMs: Date.now() - started
    };
  }
}

/* ── A/B optimisation read-out ────────────────────────────────────────────── */

/* Turns stored experiment rows into a recommendation. It needs a minimum sample
 * per variant before it will declare a winner, because a 2-of-3 "win" is how
 * A/B testing lies. */
export function optimiseExperiment(rows = [], options = {}) {
  const minSample = asInt(options.minSample, 30);
  const usable = rows.filter((r) => asInt(r.shown) >= minSample);

  if (!usable.length) {
    return {
      version: AI_INTELLIGENCE_VERSION,
      ready: false,
      reason: 'insufficient-sample',
      minSample,
      variants: rows.map((r) => ({ variant: r.variant, shown: asInt(r.shown), meetsSample: asInt(r.shown) >= minSample }))
    };
  }

  /* Ranked on learning conversion first, then click, then open, deliberate
   * ordering, because the spec forbids optimising for short-term clicks at the
   * expense of learning. */
  const ranked = usable.slice().sort((a, b) =>
    asNum(b.conversionRate) - asNum(a.conversionRate) ||
    asNum(b.clickRate) - asNum(a.clickRate) ||
    asNum(b.openRate) - asNum(a.openRate)
  );

  const best = ranked[0];
  const runnerUp = ranked[1] || null;
  const margin = runnerUp ? Number((asNum(best.conversionRate) - asNum(runnerUp.conversionRate)).toFixed(4)) : null;

  return {
    version: AI_INTELLIGENCE_VERSION,
    ready: true,
    minSample,
    ranked,
    best,
    runnerUp,
    margin,
    /* A thin margin is reported as such; the caller should not retire a variant
     * on a difference smaller than a couple of students. */
    decisive: margin === null ? true : margin >= asNum(options.minMargin, 0.02),
    recommendationBn: margin === null
      ? `শুধু "${best.variant}" variant যথেষ্ট sample পেয়েছে, এখন এটিই ব্যবহার করা যুক্তিযুক্ত।`
      : `"${best.variant}" variant learning conversion-এ এগিয়ে (পার্থক্য ${Math.round(margin * 100)}%)।`,
    recommendationEn: margin === null
      ? `Only variant "${best.variant}" has enough sample, use it for now.`
      : `Variant "${best.variant}" leads on learning conversion (margin ${Math.round(margin * 100)}%).`,
    noteBn: 'শুধু learning conversion-কে ভিত্তি ধরা হয়েছে, শুধু click বাড়ানোকে নয়।',
    noteEn: 'Ranked on learning conversion, not on short-term clicks.'
  };
}

export const __copilotTest = Object.freeze({ nd, sp, bn, compactParams, isBangla, normaliseQuestion });
