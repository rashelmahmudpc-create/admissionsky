/* Phase 5, AI Analytics routes.
 *
 * Owns `/api/analytics/ai/*`. This handler is registered **before** the Phase 4
 * `handleAnalyticsRequest`, because Phase 4 claims every path under
 * `/api/analytics/` and would answer these with its admin gate, a 403 that looks
 * like a permissions problem instead of a missing route. A test pins the
 * registration order for exactly that reason.
 *
 * Access model, mirrored from Phase 4 and deliberately identical:
 *   student routes   a verified session, and only ever that student's own data
 *   admin routes     `Authorization: Bearer <ADMIN_TOKEN>`; unset token means
 *                    closed, and a wrong token gets the same answer as no token
 *
 * Every admin payload is aggregate. The AI layer adds predictions and rankings
 * about *populations*; the per-student intelligence is only reachable by that
 * student, through the session. That split is what keeps a new, richer analytics
 * surface from becoming a new way to read someone else's activity.
 *
 * Cost shape: the LLM is reached only from `/chat` and `/notify`, only when the
 * policy layer allows it, and only on a cache miss. Everything else is
 * deterministic arithmetic, so a dashboard load costs nothing.
 */

import { corsHeaders } from './cors-policy.mjs';

import {
  AI_INTELLIGENCE_VERSION,
  buildStudentProfile,
  buildAdminAiSignals,
  confidenceBand,
  predictBehaviour,
  predictRisk,
  predictBestTime,
  rankNextBestActions,
  detectAnomalies,
  evaluateAiPerformance,
  localHour,
  CONFIDENCE_TARGETS
} from './ai-analytics-intelligence.mjs';
import {
  AI_POLICY_VERSION,
  applyNotificationPolicy,
  approvalSatisfied,
  canPerform,
  checkAiRate,
  policyEnvelope,
  sanitiseGeneratedCopy,
  shouldCallModel
} from './ai-analytics-policy.mjs';
import { AiAnalyticsStore } from './ai-analytics-store.mjs';
import { answerQuestion, writeNotification, optimiseExperiment, exampleQuestions, AI_COPILOT_VERSION } from './ai-analytics-copilot.mjs';
import { buildStudentDashboard, buildAdminDashboard, parseFilters, AnalyticsStore } from './analytics-engine.mjs';
import { sessionUser } from './fcm-notification.mjs';

export const AI_ANALYTICS_PREFIX = '/api/analytics/ai/';

const DAY_MS = 24 * 3600 * 1000;

/* Constant-time compare for the admin token (AI audit 2026-10-16). */
function constantTimeEqual(a, b) {
  const x = String(a == null ? '' : a); const y = String(b == null ? '' : b);
  if (!x || x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}

export async function handleAiAnalyticsRequest(request, env, ctx, deps = {}) {
  const url = new URL(request.url);
  const path = url.pathname;
  if (path !== '/api/analytics/ai' && !path.startsWith(AI_ANALYTICS_PREFIX)) return null;

  if (request.method === 'OPTIONS') return preflight(request);

  const store = deps.aiStore || new AiAnalyticsStore(env?.PROFILE_DB);
  if (!store.available()) return json(request, { error: 'storage-unavailable' }, 503);

  /* Phase 4's own store, for the dashboard reads the AI layer reasons over. Two
   * separate stores on purpose: the AI store owns the Phase 5 tables (cache,
   * decisions, approvals) and must never write to Phase 4's learning tables. */
  const analyticsStore = deps.store || new AnalyticsStore(env?.PROFILE_DB);

  const adminToken = String(request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
  const isAdmin = Boolean(env?.ADMIN_TOKEN) && constantTimeEqual(adminToken, env.ADMIN_TOKEN);
  const resolveSession = deps.sessionUser || sessionUser;
  const filters = parseFilters(url);

  /* The route after the prefix, e.g. `chat` or `approvals/abc/decide`. */
  const route = path === '/api/analytics/ai' ? '' : path.slice(AI_ANALYTICS_PREFIX.length).replace(/\/$/, '');

  /* ── student: their own intelligence ──────────────────────────────────── */
  if (route === 'me' && request.method === 'GET') {
    const session = await resolveSession(env, request);
    if (!session?.user?.id) return json(request, { error: 'auth-required' }, 401);
    const userId = String(session.user.id);
    const bundle = await buildStudentIntelligence(store, analyticsStore, env, userId, filters, deps);

    /* The recommendation is logged so it can later be scored. Without a row here
     * the student has no decision id to give feedback on, and
     * `evaluateAiPerformance` would have nothing to measure. */
    if (bundle.actions?.best) {
      const logged = await store.logDecision({
        studentId: userId,
        signal: `nba:${bundle.actions.best.kind}`,
        recommendation: bundle.actions.best.kind,
        reason: 'ranking',
        modelVersion: bundle.version,
        confidence: bundle.actions.best.confidence
      });
      bundle.decisionId = logged.id;
    }
    return json(request, bundle);
  }

  if (route === 'feedback' && request.method === 'POST') {
    const session = await resolveSession(env, request);
    if (!session?.user?.id) return json(request, { error: 'auth-required' }, 401);
    const body = await readBody(request);
    const decisionId = String(body?.decisionId || '').slice(0, 120);
    if (!decisionId) return json(request, { error: 'decision-required' }, 400);

    /* A student may only resolve their own decision. A missing id and another
     * student's id get the same 403 on purpose: distinguishing them would turn
     * this endpoint into an oracle for which decision ids exist. */
    const match = await store.getDecision(decisionId);
    if (!match || match.studentId !== String(session.user.id)) {
      return json(request, { error: 'forbidden' }, 403);
    }

    /* An action the API does not support is refused rather than silently
     * downgraded to `ignored`, otherwise a typo would be recorded as a real
     * outcome and quietly corrupt the performance figures. `ignored` is only
     * ever the explicit default when no action is supplied. */
    const actionTaken = body?.actionTaken == null ? 'ignored' : String(body.actionTaken);
    if (!['accepted', 'rejected', 'ignored'].includes(actionTaken)) {
      return json(request, { error: 'bad-action' }, 400);
    }

    const result = await store.logDecision({
      id: decisionId,
      signal: match.signal,
      recommendation: match.recommendation,
      confidence: match.confidence,
      actionTaken,
      outcome: {
        accepted: actionTaken === 'accepted',
        learned: body?.learned === true
      }
    });
    return json(request, { ok: result.stored });
  }

  /* ── admin: everything below requires the token ───────────────────────── */
  if (!isAdmin) return json(request, { error: 'forbidden' }, 403);

  if (route === 'chat' && request.method === 'POST') {
    const body = await readBody(request);
    const question = String(body?.question || '').slice(0, 600);
    if (!question.trim()) return json(request, { error: 'question-required', ...examples() }, 400);

    const window = body?.days ? Math.max(1, Math.min(Number(body.days) || 30, 365)) : filters.days;
    const questionFilters = { ...filters, days: window };

    const gate = policyEnvelope({
      role: 'admin',
      capability: 'admin:read-aggregate',
      trigger: 'copilot-question',
      counters: await aiCounters(store, 'copilot-question'),
      modelContext: { signalSamples: 1, remainingBudget: Number(env?.AI_DAILY_BUDGET ?? -1) }
    });
    if (!gate.ok) return json(request, { error: 'policy-denied', checks: gate.failed, ...examples() }, 429);

    const dashboard = await buildAdminDashboard(analyticsStore, questionFilters);
    const cacheKey = `copilot:${await digest(question)}:${window}`;
    const cached = await store.getCache(cacheKey);
    if (cached?.payload) {
      return json(request, { ok: true, cached: true, ...cached.payload });
    }

    const modelGate = shouldCallModel('copilot-question', { cachedFresh: false, signalSamples: 1 });
    const answer = await answerQuestion(question, {
      dashboard,
      filters: questionFilters,
      deps: modelGate.call ? { generate: deps.generate } : {}
    });

    await store.putCache(cacheKey, 'copilot', answer, { ttlMs: 15 * 60 * 1000 });
    await store.logDecision({
      studentId: null,
      signal: `copilot:${answer.intent || 'unmatched'}`,
      recommendation: 'answer-question',
      reason: answer.usedModel ? 'ai-rephrased' : 'deterministic',
      model: answer.model || null,
      modelVersion: answer.modelVersion || null,
      confidence: answer.ok ? 0.9 : 0.2,
      latencyMs: answer.latencyMs
    });
    return json(request, { ok: answer.ok, cached: false, ...answer }, answer.ok ? 200 : 200);
  }

  if (route === 'insights' && request.method === 'GET') {
    const dashboard = await buildAdminDashboard(analyticsStore, filters);
    const series = dashboard.trends ? seriesFromTrends(dashboard) : [];
    const signals = buildAdminAiSignals({ dashboard, series }, { horizonDays: 7 });
    const anomalies = detectAnomalies({
      recent: dashboard.signals?.anomalyRecent || {},
      baseline: dashboard.signals?.anomalyBaseline || {},
      recentSample: dashboard.totals?.students || 0,
      baselineSample: dashboard.totals?.students || 0
    }, { minSample: 5 });
    return json(request, {
      version: AI_INTELLIGENCE_VERSION,
      scope: 'admin',
      generatedAt: Date.now(),
      filters,
      forecasts: signals.forecasts,
      content: signals.content,
      course: signals.course,
      anomalies,
      /* The Phase 4 rules keep their own insights; Phase 5 adds to them. */
      baseInsights: signals.baseInsights,
      requiresAdminApproval: true
    });
  }

  if (route === 'risk' && request.method === 'GET') {
    const dashboard = await buildAdminDashboard(analyticsStore, filters);
    const counts = dashboard.segments?.counts || {};
    const total = Number(dashboard.segments?.total) || 0;
    const atRisk = Number(counts.at_risk) || 0;
    const inactive = Number(counts.inactive) || 0;
    const riskRatio = total > 0 ? (atRisk + inactive) / total : 0;
    const confidence = Math.min(1, total / CONFIDENCE_TARGETS.risk);
    return json(request, {
      version: AI_INTELLIGENCE_VERSION,
      scope: 'admin',
      filters,
      cohort: { total, atRisk, inactive, withGap: Number(counts.new) || 0 },
      riskRatio: Number(riskRatio.toFixed(4)),
      level: confidenceBand(confidence) === 'insufficient' ? 'unknown'
        : riskRatio >= 0.5 ? 'high' : riskRatio >= 0.25 ? 'medium' : 'low',
      confidence: Number(confidence.toFixed(2)),
      band: confidenceBand(confidence),
      /* Aggregate only, the same rule as Phase 4's admin payload. */
      segments: dashboard.segments,
      dropOff: dashboard.dropOff
    });
  }

  if (route === 'notifications' && request.method === 'GET') {
    const dashboard = await buildAdminDashboard(analyticsStore, filters);
    const notifications = dashboard.notifications || {};
    return json(request, {
      version: AI_INTELLIGENCE_VERSION,
      scope: 'admin',
      filters,
      variants: notifications.variants || [],
      bestVariant: notifications.bestVariant || null,
      byHour: notifications.byHour || [],
      /* Phase 3's rule-based timing is the baseline the AI best-time layer
       * sharpens; it is not replaced. */
      timingBase: { source: 'phase3-rules' },
      suggestion: notificationSuggestion(notifications)
    });
  }

  if (route === 'trends' && request.method === 'GET') {
    const dashboard = await buildAdminDashboard(analyticsStore, filters);
    const signals = buildAdminAiSignals({ dashboard, series: seriesFromTrends(dashboard) }, { horizonDays: 7 });
    return json(request, {
      version: AI_INTELLIGENCE_VERSION,
      scope: 'admin',
      filters,
      descriptive: dashboard.trends || {},
      summary: dashboard.trendSummary || null,
      forecasts: signals.forecasts
    });
  }

  if (route === 'decisions' && request.method === 'GET') {
    const rows = await store.listDecisions({ limit: Number(url.searchParams.get('limit')) || 100 });
    return json(request, {
      version: AI_INTELLIGENCE_VERSION,
      decisions: rows,
      performance: evaluateAiPerformance(rows)
    });
  }

  if (route === 'experiments' && request.method === 'GET') {
    const name = String(url.searchParams.get('experiment') || 'notification-copy');
    const rows = await store.experimentResults(name);
    return json(request, { version: AI_INTELLIGENCE_VERSION, experiment: name, variants: rows, optimisation: optimiseExperiment(rows) });
  }

  if (route === 'approvals' && request.method === 'GET') {
    const status = url.searchParams.get('status') || undefined;
    const rows = await store.listApprovals({ status, limit: 100 });
    return json(request, {
      version: AI_INTELLIGENCE_VERSION,
      policyVersion: AI_POLICY_VERSION,
      approvals: rows,
      pending: rows.filter((r) => r.status === 'pending').length,
      /* The contract the UI reads: these kinds cannot be actioned without a human. */
      requiresApprovalFor: ['content_change', 'course_restructure', 'policy_change', 'mass_notification', 'platform_decision']
    });
  }

  const decideMatch = /^approvals\/([^/]+)\/decide$/.exec(route);
  if (decideMatch && request.method === 'POST') {
    const body = await readBody(request);
    const status = String(body?.status || '');
    const actor = String(body?.actor || '').slice(0, 120);
    if (!actor) return json(request, { error: 'actor-required' }, 400);
    const result = await store.decideApproval(decodeURIComponent(decideMatch[1]), status, actor, {
      note: body?.note, payload: body?.payload
    });
    if (!result.stored) return json(request, { error: result.reason || 'not-found' }, 400);
    const approval = await store.getApproval(decodeURIComponent(decideMatch[1]));
    return json(request, { ok: true, approval, satisfied: approvalSatisfied(approval) });
  }

  if (route === 'notify' && request.method === 'POST') {
    const body = await readBody(request);
    const kind = String(body?.kind || '').slice(0, 60);
    if (!kind) return json(request, { error: 'kind-required' }, 400);

    const audience = Number(body?.audience) || 0;
    const trigger = 'notification-wording';
    const gate = policyEnvelope({
      role: 'admin',
      capability: 'admin:read-aggregate',
      trigger,
      counters: await aiCounters(store, trigger),
      modelContext: { signalSamples: 1, remainingBudget: Number(env?.AI_DAILY_BUDGET ?? -1) }
    });
    if (!gate.ok) return json(request, { error: 'policy-denied', checks: gate.failed }, 429);

    /* Wording only. This route cannot send: it returns copy for a human to
     * approve, and a mass audience is escalated rather than acted on. */
    const written = await writeNotification(kind, body?.params || {}, {
      lang: body?.lang === 'en' ? 'en' : 'bn',
      fallbackCopy: body?.fallbackCopy || null,
      deps: { generate: deps.generate }
    });

    const policyKind = audience >= 250 ? 'mass_notification' : kind;
    const needsApproval = audience >= 250;
    let approval = null;
    if (needsApproval) {
      const created = await store.createApproval({ kind: policyKind, payload: { kind, audience, copy: written.copy } });
      approval = created.stored ? await store.getApproval(created.id) : null;
    }

    await store.logDecision({
      studentId: null,
      signal: `notify:${kind}`,
      recommendation: written.source,
      reason: written.usedModel ? 'ai-writer' : 'phase3-catalogue',
      model: written.model || null,
      confidence: written.ok ? 0.7 : 0.2,
      latencyMs: written.latencyMs
    });

    return json(request, {
      version: AI_COPILOT_VERSION,
      ok: written.ok,
      copy: written.copy,
      source: written.source,
      usedModel: written.usedModel,
      rejected: written.rejected || [],
      /** This endpoint never sends. Sending remains Phase 3's job. */
      sends: false,
      requiresApproval: needsApproval,
      approval,
      approvalKinds: needsApproval ? ['mass_notification'] : []
    });
  }

  if (route === 'health' && request.method === 'GET') {
    const health = await store.health();
    return json(request, {
      version: AI_INTELLIGENCE_VERSION,
      policyVersion: AI_POLICY_VERSION,
      copilotVersion: AI_COPILOT_VERSION,
      store: health,
      /* Says plainly whether a model is wired, so an operator never has to guess
       * why answers look templated. */
      model: { configured: typeof deps.generate === 'function', source: deps.modelSource || null },
      capabilities: ['admin:read-aggregate', 'admin:approve', 'student:read-self']
    });
  }

  return json(request, { error: 'not-found', ...examples() }, 404);
}

/* ── student bundle ───────────────────────────────────────────────────────── */

/* Builds one student's intelligence in a single pass: the Phase 4 dashboard is
 * the input, so the profile, the predictions, the risk scores and the ranked
 * actions can never describe a different window than the numbers beside them. */
export async function buildStudentIntelligence(store, analyticsStore, env, userId, filters, deps = {}) {
  const dashboard = await buildStudentDashboard(analyticsStore, userId, { filters });
  const events = await store.analyticsEventsFor(userId, filters.sinceMs).catch(() => []);

  const hours = new Array(24).fill(0);
  for (const e of events) hours[localHour(e.at, filters.tzOffsetMin)] += 1;

  const goal = { target: Number(deps.goalTarget) || 0, progress: 0 };
  const profile = buildStudentProfile({
    metrics: dashboard.metrics,
    series: dashboard.metrics?.series,
    activityHours: hours,
    notificationOutcomes: dashboard.notifications?.overall,
    retention: dashboard.notifications?.retention,
    segment: dashboard.segment,
    stage: dashboard.stage,
    quizAttempts: dashboard.notifications?.attempts,
    windowDays: filters.days
  }, { windowDays: filters.days });

  const prediction = predictBehaviour(profile, { series: dashboard.metrics?.series }, { horizonDays: 7, windowDays: 14 });
  const risk = predictRisk({ profile, series: dashboard.metrics?.series, metrics: dashboard.metrics }, { windowDays: 14 });
  const actions = rankNextBestActions({
    profile, metrics: dashboard.metrics, risk, milestones: dashboard.milestones, goal
  });
  const bestTime = predictBestTime({ hours, samples: events.length });

  return {
    version: AI_INTELLIGENCE_VERSION,
    scope: 'student',
    generatedAt: Date.now(),
    filters,
    profile,
    prediction,
    risk,
    actions,
    bestTime,
    /* The Phase 4 view stays intact underneath, so the UI has one payload rather
     * than two that can disagree. */
    metrics: dashboard.metrics,
    milestones: dashboard.milestones,
    insights: dashboard.insights,
    trendSummary: dashboard.trendSummary,
    /* Deterministic advice always ships, model or not. */
    advice: {
      nextBest: actions.best,
      all: actions.actions,
      disclaimerBn: prediction.disclaimerBn,
      noteBn: 'এটি analysis-ভিত্তিক পরামর্শ, কোনো সিদ্ধান্ত চাপিয়ে দেওয়া হয় না।'
    }
  };
}

function seriesFromTrends(dashboard) {
  const t = dashboard.trends || {};
  /* The admin dashboard keeps trends as slope summaries, not the raw series. For
   * forecasting we rebuild a coarse series from the trend means so the forecast
   * is anchored to real averages rather than inventing points. */
  const questions = Number(t.practiceActivity?.mean) || 0;
  const lessons = Number(t.lessonsCompleted?.mean) || 0;
  const days = 14;
  return Array.from({ length: days }, () => ({ questions, lessons, correct: 0, wrong: 0 }));
}

function notificationSuggestion(notifications = {}) {
  const best = notifications.bestVariant;
  const hour = (notifications.byHour || []).slice().sort((a, b) => Number(b.opens || b.opened || 0) - Number(a.opens || a.opened || 0))[0];
  return {
    bestVariant: best || null,
    bestHour: hour ? Number(hour.hour) : null,
    noteBn: 'Best-time ও variant পরামর্শ, পাঠানোর অনুমতি Phase 3-এর নিয়মেই থাকবে।',
    noteEn: 'Timing and variant suggestions only, Phase 3 keeps the final send decision.'
  };
}

function examples() {
  return { suggestionsBn: exampleQuestions('bn'), suggestionsEn: exampleQuestions('en') };
}

async function aiCounters(store, trigger) {
  /* Counters come from the decision log, which is already written for every AI
   * action, so the rate limit needs no separate counter table. */
  const since = Date.now() - 3600 * 1000;
  const rows = await store.listDecisions({ sinceMs: since, limit: 1000 }).catch(() => []);
  const day = await store.listDecisions({ sinceMs: Date.now() - DAY_MS, limit: 1000 }).catch(() => []);
  const prefix = trigger === 'copilot-question' ? 'copilot:' : trigger === 'notification-wording' ? 'notify:' : trigger;
  return {
    hour: rows.filter((r) => String(r.signal).startsWith(prefix)).length,
    day: day.filter((r) => String(r.signal).startsWith(prefix)).length
  };
}

async function digest(text) {
  const data = new TextEncoder().encode(String(text));
  if (globalThis.crypto?.subtle) {
    const hash = await globalThis.crypto.subtle.digest('SHA-256', data);
    return [...new Uint8Array(hash)].slice(0, 12).map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  let h = 0x811c9dc5;
  for (const b of data) { h ^= b; h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(36);
}

function json(request, payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...corsHeaders(request),
    }
  });
}

function preflight(request) {
  return new Response(null, {
    status: 204,
    headers: {
      ...corsHeaders(request),
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400'
    }
  });
}

async function readBody(request) {
  try { return await request.json(); } catch (_) { return {}; }
}

export const __aiAnalyticsTest = Object.freeze({
  seriesFromTrends,
  notificationSuggestion,
  policyEnvelope,
  canPerform,
  checkAiRate,
  sanitiseGeneratedCopy
});
