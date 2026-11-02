/* Phase 5 — AI Safety, Policy, Copilot and Notification-Writer tests.
 *
 * The brief's Phase 5 constraints are the tests here: AI must never expose
 * another student's data, never bypass auth, never send outside the approved
 * pipeline, never exceed quiet hours or frequency caps, never act without the
 * permission an action needs, never present an invented figure as measured,
 * never infer sensitive traits the product does not need, and never override a
 * rule in the policy layer.
 *
 * The other half is the copilot's core promise: the model writes prose, the code
 * writes numbers. Every test that involves a model uses an injected generator, so
 * the real intent → query → grounding path runs while the test stays offline and
 * deterministic.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AI_POLICY_VERSION, AI_PROHIBITIONS, AI_PROHIBITION_KINDS,
  HUMAN_APPROVAL_REQUIRED, MASS_NOTIFICATION_THRESHOLD, APPROVAL_STATUS,
  classifyDecision, requiresApproval, approvalSatisfied,
  applyNotificationPolicy, COPY_VIOLATIONS, COPY_MAX_CHARS, COPY_MIN_CHARS, sanitiseGeneratedCopy,
  groundAnswer, normaliseBengaliDigits,
  AI_CALL_TRIGGERS, shouldCallModel,
  CAPABILITIES, canPerform,
  AI_RATE_LIMITS, checkAiRate,
  allocateVariant, policyEnvelope
} from './ai-analytics-policy.mjs';
import {
  AI_COPILOT_VERSION, INTENTS, QUERY_CATALOGUE, QUERY_IDS,
  normaliseQuestion, detectIntent, parseWindow, runQuery, composeAnswer,
  answerQuestion, exampleQuestions, buildWriterPrompt, writeNotification,
  optimiseExperiment, COPILOT_SYSTEM_PROMPT, WRITER_SYSTEM_PROMPT
} from './ai-analytics-copilot.mjs';

/* A Phase 4 admin payload, trimmed to the fields the queries read. */
const DASHBOARD = {
  engagement: { dau: 120, wau: 300, mau: 800, stickiness: 0.4, activeStudents: 900, totalStudents: 1500, sessions: 2000, avgSessionMs: 900000 },
  courses: [{ courseId: 'c1', learners: 80, completionRate: 22, lessonCompletionRate: 50, starts: 80, completed: 2 }],
  notifications: { overall: { sent: 400, openRate: 41.5, clickRate: 22, learningConversion: 12 }, bestCategory: 'study' },
  lessons: [{ courseId: 'c1', lessonId: 'l3', learners: 40, completionRate: 28, quizAccuracy: 35, starts: 40, exits: 22 }],
  quizzes: [{ quizId: 'q1', attempts: 30, accuracy: 32, completionRate: 80 }],
  segments: { counts: { at_risk: 120, inactive: 60, active: 400 }, total: 1500 },
  retention: { byWindow: { d1: 60, d7: 40, d14: 30, d30: 20 }, cohortSize: 300 },
  trends: { practiceActivity: { mean: 18 } },
  trendSummary: { text: 'অভ্যাস কমছে।', up: [], down: ['practice'] }
};

/* ── ১. prohibitions are enforced, not just documented ────────────────────── */

test('P5-১. every prohibited outcome is a named, exported rule', () => {
  assert.equal(AI_POLICY_VERSION, 'ai-p5-policy-v1');
  assert.deepEqual([...AI_PROHIBITION_KINDS], [
    'data_leak', 'auth_bypass', 'arbitrary_notification', 'limit_bypass',
    'permission_bypass', 'fabricated_analytics', 'unnecessary_inference', 'safety_override'
  ]);
  for (const kind of AI_PROHIBITION_KINDS) {
    assert.ok(AI_PROHIBITIONS[kind], `${kind} needs a description`);
  }
});

/* ── ২. approval gate ─────────────────────────────────────────────────────── */

test('P5-২. content, course, policy, mass-notification and platform decisions need a human', () => {
  assert.deepEqual([...HUMAN_APPROVAL_REQUIRED], [
    'content_change', 'course_restructure', 'policy_change', 'mass_notification', 'platform_decision'
  ]);
  for (const kind of HUMAN_APPROVAL_REQUIRED) {
    assert.equal(requiresApproval(kind), true, `${kind} must require approval`);
  }
  /* Ordinary student-facing wording is not escalated. */
  assert.equal(requiresApproval('lesson_reminder'), false);
  assert.equal(requiresApproval('streak_nudge'), false);
});

test('P5-৩. any audience at or above the threshold is a mass notification', () => {
  assert.equal(MASS_NOTIFICATION_THRESHOLD, 250);
  assert.equal(classifyDecision('lesson_reminder', { audience: 249 }), null);
  assert.equal(classifyDecision('lesson_reminder', { audience: 250 }), 'mass_notification');
  assert.equal(classifyDecision('lesson_reminder', { audience: 5000 }), 'mass_notification');
  assert.equal(requiresApproval('lesson_reminder', { audience: 5000 }), true);
});

test('P5-৪. an approval is only satisfied by a named human, and a modified one needs the replacement payload', () => {
  assert.deepEqual([...APPROVAL_STATUS], ['pending', 'approved', 'rejected', 'modified']);

  assert.deepEqual(approvalSatisfied(null), { ok: false, reason: 'no-approval' });
  assert.deepEqual(approvalSatisfied({ status: 'pending' }), { ok: false, reason: 'pending' });
  assert.deepEqual(approvalSatisfied({ status: 'rejected', actor: 'admin@x' }), { ok: false, reason: 'rejected' });

  /* An "approved" row with nobody attached is not an approval. */
  assert.deepEqual(approvalSatisfied({ status: 'approved' }), { ok: false, reason: 'approval-needs-actor' });
  assert.deepEqual(approvalSatisfied({ status: 'approved', actor: 'admin@x' }), { ok: true, payload: null });

  /* A modified approval must carry the human's text, or the AI's original would
   * silently be the thing that ships. */
  assert.deepEqual(approvalSatisfied({ status: 'modified', actor: 'admin@x' }), { ok: false, reason: 'modified-approval-needs-payload' });
  const modified = approvalSatisfied({ status: 'modified', actor: 'admin@x', payload: { copy: 'নতুন text' } });
  assert.equal(modified.ok, true);
  assert.equal(modified.payload.copy, 'নতুন text');
});

/* ── ৫. AI narrows, never widens ─────────────────────────────────────────── */

test('P5-৫. Phase 3 declining a send is final — the AI layer cannot overrule it', () => {
  const result = applyNotificationPolicy({ copy: { bn: 'অল্প করে শুরু করো আজই' } }, { send: false, reason: 'quiet-hours' });
  assert.equal(result.allowed, false);
  assert.equal(result.reason, 'phase3-declined');
  assert.equal(result.detail, 'quiet-hours');
  /* Not a narrowing — a refusal at the source. */
  assert.equal(result.narrowed, false);
});

test('P5-৬. an eligible send passes, and the copy handed back is the sanitised one', () => {
  const result = applyNotificationPolicy({ copy: { bn: 'অল্প করে শুরু করো আজই' }, generated: true, model: 'gemini-x' }, { send: true }, { sentToday: 0, maxPerDay: 2 });
  assert.equal(result.allowed, true);
  assert.equal(result.reason, 'ok');
  assert.equal(result.copy.bn, 'অল্প করে শুরু করো আজই');
  assert.equal(result.attribution.generated, true);
  assert.equal(result.attribution.model, 'gemini-x');
  assert.equal(result.attribution.policyVersion, AI_POLICY_VERSION);
});

test('P5-৭. quiet hours, send window, fatigue and the daily cap each block on their own', () => {
  const copy = { copy: { bn: 'আজ একটু এগিয়ে যাও' } };
  const eligible = { send: true };

  assert.equal(applyNotificationPolicy(copy, eligible, { inQuietHours: true }).reason, 'quiet-hours');
  assert.equal(applyNotificationPolicy(copy, eligible, { inSendWindow: false }).reason, 'outside-send-window');
  assert.equal(applyNotificationPolicy(copy, eligible, { fatigued: true }).reason, 'fatigued');
  assert.equal(applyNotificationPolicy(copy, eligible, { sentToday: 5, maxPerDay: 2 }).reason, 'daily-ai-cap');
});

test('P5-৮. the kill switch turns the whole AI notification surface off', () => {
  const result = applyNotificationPolicy({ copy: { bn: 'ঠিক আছে' } }, { send: true }, { aiNotificationsEnabled: false });
  assert.equal(result.allowed, false);
  assert.equal(result.reason, 'ai-notifications-disabled');
});

test('P5-৯. unsafe copy blocks the send rather than being laundered into a send', () => {
  const result = applyNotificationPolicy({ copy: { bn: 'এখনই শেষ সুযোগ!' } }, { send: true }, {});
  assert.equal(result.allowed, false);
  assert.equal(result.reason, 'fake_urgency');
  assert.equal(result.copy, null);
});

/* ── ১০. copy sanitiser ───────────────────────────────────────────────────── */

test('P5-১০. each manipulation class is caught, in Bangla and in English', () => {
  const cases = [
    ['fake_urgency', { bn: 'এখনই শুরু করো' }],
    ['fake_urgency', { en: 'Act now, only 3 minutes left' }],
    ['emotional_pressure', { en: 'You are failing and falling behind' }],
    ['manipulation', { en: "If you don't study you will regret it" }],
    ['misleading_claim', { en: 'This guarantees 100% success' }],
    ['misleading_claim', { bn: '১০০% নিশ্চিতভাবে সফল হবে' }],
    ['pressure_fomo', { en: 'Everyone is ahead of you, do not miss out' }]
  ];
  for (const [expected, copy] of cases) {
    const result = sanitiseGeneratedCopy(copy);
    assert.equal(result.ok, false, `${JSON.stringify(copy)} should be rejected`);
    assert.ok(result.violations.includes(expected), `${JSON.stringify(copy)} → ${result.violations.join(',')} (wanted ${expected})`);
    assert.equal(result.copy, null);
  }
});

test('P5-১১. a credential-shaped string is never allowed into a message', () => {
  const otp = sanitiseGeneratedCopy({ bn: 'তোমার কোড 483920 দিয়ে যাচাই করো' });
  assert.equal(otp.ok, false);
  assert.ok(otp.violations.includes('secret_leak'));

  const token = sanitiseGeneratedCopy({ en: 'Your token: abc123def456' });
  assert.equal(token.ok, false);
  assert.ok(token.violations.includes('secret_leak'));

  const raw = sanitiseGeneratedCopy({ en: 'Account 8f3c1d9b7a6e5f4c3b2a1908fedcba98 is ready' });
  assert.equal(raw.ok, false);
  assert.ok(raw.violations.includes('raw_identifier'));
});

test('P5-১২. encouraging copy passes untouched, and the sanitiser reports its length', () => {
  const result = sanitiseGeneratedCopy({ bn: 'তোমার পরের lessonটা ready — আজ একটু এগিয়ে গেলে streak ধরে রাখতে পারবে 🚀' });
  assert.equal(result.ok, true);
  assert.equal(result.violations.length, 0);
  assert.equal(result.copy.lang, 'bn');
  assert.equal(result.copy.chars, result.copy.bn.length);
  assert.equal(result.copy.text, result.copy.bn);
});

test('P5-১৩. copy is bounded in length and empty copy is refused', () => {
  assert.equal(sanitiseGeneratedCopy({ bn: '' }).ok, false);
  assert.deepEqual(sanitiseGeneratedCopy({ bn: '' }).violations, ['empty']);
  /* Whitespace-only is empty too. */
  assert.equal(sanitiseGeneratedCopy({ bn: '    ' }).ok, false);
  /* Too short to be a sentence. */
  const short = sanitiseGeneratedCopy({ bn: 'ok' });
  assert.ok(short.violations.includes('too-short'));

  const long = sanitiseGeneratedCopy({ bn: 'পড়াশোনা '.repeat(80) });
  assert.equal(long.ok, true);
  assert.ok(long.copy.chars <= COPY_MAX_CHARS);
  assert.ok(long.copy.bn.endsWith('…'));
  assert.ok(COPY_MIN_CHARS < COPY_MAX_CHARS);
});

test('P5-১৪. markdown can be stripped when the surface does not render it', () => {
  const result = sanitiseGeneratedCopy({ en: '## Today **start** with one lesson' }, { allowMarkdown: false });
  assert.equal(result.ok, true);
  assert.ok(!result.copy.en.includes('##'));
  assert.ok(!result.copy.en.includes('**'));
});

test('P5-১৫. a shouting pile of exclamation marks is rejected', () => {
  const result = sanitiseGeneratedCopy({ en: 'Great job today!!!!' });
  assert.equal(result.ok, false);
  assert.ok(result.violations.includes('excessive_exclamation'));
  /* Two is still fine. */
  assert.equal(sanitiseGeneratedCopy({ en: 'Great job today!! Keep going' }).ok, true);
});

test('P5-১৬. the violation catalogue is non-empty and every rule compiles', () => {
  assert.ok(COPY_VIOLATIONS.length >= 6);
  for (const rule of COPY_VIOLATIONS) {
    assert.ok(rule.id);
    assert.ok(Array.isArray(rule.patterns) && rule.patterns.length > 0);
    for (const p of rule.patterns) assert.ok(p instanceof RegExp);
  }
});

/* ── ১৭. grounding ───────────────────────────────────────────────────────── */

test('P5-১৭. an answer that cites a real figure passes grounding', () => {
  const result = groundAnswer('DAU was 120 and stickiness 0.4.', { dau: 120, stickiness: 0.4 });
  assert.equal(result.ok, true);
  assert.equal(result.ungrounded.length, 0);
  assert.ok(result.checked >= 2);
});

test('P5-১৮. an invented figure is caught and named', () => {
  const result = groundAnswer('DAU was 999.', { dau: 120, wau: 300 });
  assert.equal(result.ok, false);
  assert.deepEqual(result.ungrounded, [999]);
});

test('P5-১৯. a ratio may be restated as a percentage without tripping the check', () => {
  /* The query returns 0.415; the prose may say 41.5% or 42%. */
  const result = groundAnswer('Open rate was 41.5%, roughly 42%.', { openRate: 0.415 });
  assert.equal(result.ok, true, `ungrounded: ${result.ungrounded.join(',')}`);
});

test('P5-২০. grounding reads numbers nested in arrays and objects, and ignores words', () => {
  const grounded = { steps: [{ count: 40 }, { count: 25 }], note: 'drop', empty: null };
  assert.equal(groundAnswer('The steps were 40 then 25.', grounded).ok, true);
  assert.equal(groundAnswer('The steps were 41 then 25.', grounded).ok, false);
});

test('P5-২১. Bengali numerals are normalised before grounding, so a Bangla answer is verified', () => {
  assert.equal(normaliseBengaliDigits('১২৩৪৫৬৭৮৯০'), '1234567890');
  assert.equal(normaliseBengaliDigits('গত ৩০ দিনে'), 'গত 30 দিনে');
  const result = groundAnswer(normaliseBengaliDigits('DAU ছিল ১২০'), { dau: 120 });
  assert.equal(result.ok, true);
});

/* ── ২২. cost control ─────────────────────────────────────────────────────── */

test('P5-২২. only the three human-facing surfaces may reach a model', () => {
  assert.deepEqual([...AI_CALL_TRIGGERS], ['copilot-question', 'notification-wording', 'admin-summary']);
  assert.equal(shouldCallModel('dashboard-render', {}).call, false);
  assert.equal(shouldCallModel('event-ingest', {}).call, false);
  assert.equal(shouldCallModel('copilot-question', { signalSamples: 5 }).call, true);
});

test('P5-২৩. a cache hit or an exhausted budget skips the model entirely', () => {
  assert.deepEqual(shouldCallModel('copilot-question', { cachedFresh: true }), { call: false, reason: 'cache-hit' });
  assert.deepEqual(shouldCallModel('copilot-question', { remainingBudget: 0, signalSamples: 5 }), { call: false, reason: 'budget-exhausted' });
  assert.deepEqual(shouldCallModel('copilot-question', { signalSamples: 0 }), { call: false, reason: 'no-signal' });
});

/* ── ২৪. permissions ──────────────────────────────────────────────────────── */

test('P5-২৪. a student can read only their own data, and only an admin can approve', () => {
  assert.equal(canPerform('student:read-self', 'student').ok, true);
  assert.equal(canPerform('student:read-self', 'admin').ok, false);
  assert.equal(canPerform('admin:read-aggregate', 'student').ok, false);
  assert.equal(canPerform('admin:read-aggregate', 'admin').ok, true);
  assert.equal(canPerform('admin:approve', 'admin').ok, true);
  assert.equal(canPerform('admin:approve', 'student').ok, false);
  /* Content changes are the admin's, never the system's. */
  assert.equal(canPerform('content:change', 'system').ok, false);
  assert.equal(canPerform('content:suggest', 'system').ok, true);
  assert.equal(canPerform('made-up-capability', 'admin').ok, false);
  assert.ok(Object.keys(CAPABILITIES).length >= 7);
});

/* ── ২৫. rate limits ──────────────────────────────────────────────────────── */

test('P5-২৫. AI surfaces are rate limited per hour and per day', () => {
  const limit = AI_RATE_LIMITS['copilot-question'];
  assert.ok(limit.perHour > 0 && limit.perDay > limit.perHour);

  assert.equal(checkAiRate('copilot-question', { hour: 0, day: 0 }).ok, true);
  assert.equal(checkAiRate('copilot-question', { hour: limit.perHour, day: limit.perHour }).reason, 'hourly-limit');
  assert.equal(checkAiRate('copilot-question', { hour: 0, day: limit.perDay }).reason, 'daily-limit');
  assert.equal(checkAiRate('unknown-trigger', {}).ok, false);

  const remaining = checkAiRate('copilot-question', { hour: 10, day: 20 });
  assert.equal(remaining.remaining.hour, limit.perHour - 10);
  assert.equal(remaining.remaining.day, limit.perDay - 20);
});

/* ── ২৬. variant allocation ──────────────────────────────────────────────── */

test('P5-২৬. a retired variant is never allocated, and an unknown assignment falls back', () => {
  const pool = allocateVariant('u1', 'lesson', { variants: ['A', 'B'], retired: ['B'] });
  assert.equal(pool, 'A');

  const assigned = allocateVariant('u1', 'lesson', { variants: ['A', 'B'] }, () => 'B');
  assert.equal(assigned, 'B');

  /* An assigner returning something outside the pool is a bug; fall back. */
  const bogus = allocateVariant('u1', 'lesson', { variants: ['A', 'B'] }, () => 'Z');
  assert.equal(bogus, 'A');

  /* If everything is retired, one variant is still returned — never undefined. */
  const allRetired = allocateVariant('u1', 'lesson', { variants: ['A'], retired: ['A'] });
  assert.equal(allRetired, 'A');
});

/* ── ২৭. policy envelope ─────────────────────────────────────────────────── */

test('P5-২৭. the policy envelope reports every check and the narrowest outcome', () => {
  const pass = policyEnvelope({ role: 'admin', capability: 'admin:read-aggregate', trigger: 'copilot-question', counters: { hour: 0, day: 0 }, modelContext: { signalSamples: 3 } });
  assert.equal(pass.ok, true);
  assert.equal(pass.failed.length, 0);
  assert.deepEqual(pass.prohibitions, AI_PROHIBITION_KINDS);

  const fail = policyEnvelope({ role: 'student', capability: 'admin:read-aggregate', trigger: 'copilot-question', counters: { hour: 0, day: 0 }, modelContext: { signalSamples: 3 } });
  assert.equal(fail.ok, false);
  assert.ok(fail.failed.some((f) => f.startsWith('permission:')));
});

/* ── ২৮. intent detection ────────────────────────────────────────────────── */

test('P5-২৮. every declared intent maps to a real query', () => {
  assert.ok(INTENTS.length >= 10);
  for (const spec of INTENTS) {
    assert.ok(spec.id && spec.query, `${spec.id} incomplete`);
    assert.ok(QUERY_CATALOGUE[spec.query], `${spec.id} points at missing query ${spec.query}`);
    assert.ok(spec.keywords.length > 0);
  }
  assert.deepEqual([...QUERY_IDS].sort(), Object.keys(QUERY_CATALOGUE).sort());
});

test('P5-২৯. Bangla and English questions route to the same intents', () => {
  const pairs = [
    ['engagement কেমন?', 'how is engagement?', 'engagement'],
    ['কোন course-এ সবচেয়ে বেশি drop-off?', 'which course has the most dropoff?', 'dropoff'],
    ['কোন notification ভালো কাজ করেছে?', 'which notification performed best?', 'notifications'],
    ['কোন lesson review দরকার?', 'which lesson needs review?', 'lessons'],
    ['গত ৩০ দিনে retention কেমন?', 'retention over 30 days?', 'retention']
  ];
  for (const [bnQuestion, enQuestion, expected] of pairs) {
    assert.equal(detectIntent(bnQuestion).intent, expected, bnQuestion);
    assert.equal(detectIntent(enQuestion).intent, expected, enQuestion);
  }
});

test('P5-৩০. an unrecognised question routes nowhere rather than to a guess', () => {
  const result = detectIntent('তোমার নাম কী?');
  assert.equal(result.intent, null);
  assert.equal(result.query, null);
  assert.equal(result.confidence, 0);
  assert.equal(detectIntent('').reason, 'empty-question');
  assert.equal(detectIntent('asdfgh').reason, 'no-matching-intent');
});

test('P5-৩১. intent confidence rises with the number of matching keywords', () => {
  const one = detectIntent('lesson');
  const many = detectIntent('কোন lesson review করা দরকার, কোন lesson কঠিন?');
  assert.ok(many.confidence >= one.confidence);
  assert.ok(many.confidence <= 1);
});

/* ── ৩২. window parsing ──────────────────────────────────────────────────── */

test('P5-৩২. a window in the question is honoured and bounded', () => {
  assert.deepEqual(parseWindow('গত ৩০ দিনে engagement?'), { days: 30, fromQuestion: true });
  assert.deepEqual(parseWindow('engagement last 7 days'), { days: 7, fromQuestion: true });
  assert.equal(parseWindow('engagement কেমন?', 14).days, 14);
  assert.equal(parseWindow('engagement কেমন?', 14).fromQuestion, false);
  /* A question cannot widen the read past a year. */
  assert.equal(parseWindow('last 9999 days').days, 365);
  assert.equal(parseWindow('last 0 days').days, 1);
});

/* ── ৩৩. queries ─────────────────────────────────────────────────────────── */

test('P5-৩৩. every query returns a result over a real admin payload', () => {
  for (const id of QUERY_IDS) {
    const result = runQuery(id, DASHBOARD, { days: 30 });
    assert.equal(result.ok, true, `${id} failed: ${result.reason}`);
    assert.ok(result.data, `${id} returned no data`);
  }
});

test('P5-৩৪. an unknown query fails loudly instead of returning an empty object', () => {
  const result = runQuery('made.up.query', DASHBOARD, {});
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'unknown-query');
});

test('P5-৩৫. queries survive a completely empty dashboard without throwing', () => {
  for (const id of QUERY_IDS) {
    const result = runQuery(id, {}, { days: 30 });
    assert.equal(result.ok, true, `${id} threw on an empty dashboard`);
  }
});

test('P5-৩৬. a missing metric is null, never a fabricated zero', () => {
  const result = runQuery('engagement.summary', { engagement: { dau: 120 } }, {});
  assert.equal(result.data.dau, 120);
  /* WAU was not measured, so it is null — not 0, which would read as "nobody". */
  assert.equal(result.data.wau, null);
  assert.equal(result.data.mau, null);
});

/* ── ৩৭. deterministic answer ────────────────────────────────────────────── */

test('P5-৩৭. the deterministic answer is assembled from the query, in both languages', () => {
  const query = runQuery('engagement.summary', DASHBOARD, { days: 30 });
  const answer = composeAnswer('engagement', query, { days: 30 });
  assert.equal(answer.ok, true);
  assert.equal(answer.lines.length, 2);
  /* Bangla digits in the Bangla sentence. */
  assert.ok(answer.textBn.includes('১২০'));
  /* Latin digits in the English sentence. */
  assert.ok(answer.textEn.includes('120'));
  /* Both cite the same figures the query returned. */
  assert.equal(answer.grounded.dau, 120);
});

test('P5-৩৮. the deterministic answer is grounded by construction', () => {
  for (const id of QUERY_IDS) {
    const intent = INTENTS.find((i) => i.query === id).id;
    const query = runQuery(id, DASHBOARD, { days: 30 });
    const answer = composeAnswer(intent, query, { days: 30 });
    assert.equal(answer.ok, true, `${intent} produced no answer`);
    /* The window length is context, not a measurement, so it is whitelisted —
     * exactly as the copilot does when it checks a model's phrasing. */
    const check = groundAnswer(normaliseBengaliDigits(answer.textEn), query.data, { allow: [30] });
    assert.equal(check.ok, true, `${intent} cited ungrounded numbers: ${check.ungrounded.join(',')}`);
  }
});

test('P5-৩৯. a failed query produces an honest refusal, not an empty sentence', () => {
  const answer = composeAnswer('engagement', { ok: false, reason: 'unknown-query' }, {});
  assert.equal(answer.ok, false);
  assert.match(answer.textBn, /query নেই/);
  assert.match(answer.textEn, /no specific analytics query/i);
});

/* ── ৪০. answerQuestion with an injected model ───────────────────────────── */

const okGenerator = (text) => async () => ({ text, model: 'test-model', modelVersion: 'test:1' });

test('P5-৪০. without a provider the copilot still answers, deterministically', async () => {
  const answer = await answerQuestion('engagement কেমন?', { dashboard: DASHBOARD, filters: { days: 30 } });
  assert.equal(answer.ok, true);
  assert.equal(answer.usedModel, false);
  assert.equal(answer.intent, 'engagement');
  assert.equal(answer.version, AI_COPILOT_VERSION);
  assert.ok(answer.textBn.includes('১২০'));
});

test('P5-৪১. a model answer that restates the real figures is accepted and attributed', async () => {
  const answer = await answerQuestion('engagement কেমন?', {
    dashboard: DASHBOARD,
    filters: { days: 30 },
    deps: { generate: okGenerator('গত ৩০ দিনে DAU ছিল ১২০, WAU ৩০০।') }
  });
  assert.equal(answer.usedModel, true);
  assert.equal(answer.model, 'test-model');
  assert.equal(answer.modelVersion, 'test:1');
  assert.equal(answer.textBn, 'গত ৩০ দিনে DAU ছিল ১২০, WAU ৩০০।');
  assert.equal(answer.degraded, undefined);
});

test('P5-৪২. a model answer citing an invented number is discarded for the deterministic one', async () => {
  const answer = await answerQuestion('engagement কেমন?', {
    dashboard: DASHBOARD,
    filters: { days: 30 },
    deps: { generate: okGenerator('গত ৩০ দিনে DAU ছিল ৮৮৮৮, WAU ৩০০।') }
  });
  assert.equal(answer.usedModel, false);
  assert.equal(answer.degraded, 'ungrounded-number');
  assert.deepEqual(answer.ungrounded, [8888]);
  /* The deterministic text is what survives, and it never contained the
   * invented figure. */
  assert.ok(answer.textBn.includes('১২০'));
  assert.ok(!answer.textBn.includes('৮৮৮৮'));
});

test('P5-৪২খ. the window length is context and does not count as an invented figure', async () => {
  const answer = await answerQuestion('engagement কেমন?', {
    dashboard: DASHBOARD,
    filters: { days: 30 },
    deps: { generate: okGenerator('গত ৩০ দিনে DAU ১২০ ছিল।') }
  });
  assert.equal(answer.usedModel, true);
  assert.equal(answer.degraded, undefined);
});

test('P5-৪৩. a provider that throws degrades to the deterministic answer', async () => {
  const answer = await answerQuestion('engagement কেমন?', {
    dashboard: DASHBOARD,
    filters: { days: 30 },
    deps: { generate: async () => { throw new Error('provider down'); } }
  });
  assert.equal(answer.ok, true);
  assert.equal(answer.usedModel, false);
  assert.equal(answer.degraded, 'provider-error');
  assert.ok(answer.textBn.includes('১২০'));
});

test('P5-৪৪. an empty model response is ignored rather than shown as a blank answer', async () => {
  const answer = await answerQuestion('engagement কেমন?', {
    dashboard: DASHBOARD,
    filters: { days: 30 },
    deps: { generate: okGenerator('   ') }
  });
  assert.equal(answer.usedModel, false);
  assert.ok(answer.textBn.length > 10);
});

test('P5-৪৫. an unmatched question returns suggestions, never a fabricated answer', async () => {
  const answer = await answerQuestion('আজ আবহাওয়া কেমন?', { dashboard: DASHBOARD, filters: {} });
  assert.equal(answer.ok, false);
  assert.equal(answer.reason, 'no-matching-intent');
  assert.ok(answer.suggestionsBn.length > 0);
  assert.ok(answer.suggestionsEn.length > 0);
  assert.equal(answer.grounded, undefined);
});

test('P5-৪৬. the copilot prompt forbids inventing numbers and names the result as the only source', () => {
  assert.match(COPILOT_SYSTEM_PROMPT, /only the numbers present/i);
  assert.match(COPILOT_SYSTEM_PROMPT, /never (compute|invent)/i);
  /* The prompt text comes from the versioned registry. */
  assert.ok(COPILOT_SYSTEM_PROMPT.includes('Admission Sky analytics copilot'));
});

test('P5-৪৭. example questions are offered in both languages', () => {
  assert.ok(exampleQuestions('bn').length >= 5);
  assert.ok(exampleQuestions('en').length >= 5);
  assert.notDeepEqual(exampleQuestions('bn'), exampleQuestions('en'));
  /* Bangla examples are actually in Bangla script. */
  assert.ok(exampleQuestions('bn').every((q) => /[\u0980-\u09FF]/.test(q)));
});

/* ── ৪৮. notification writer ─────────────────────────────────────────────── */

test('P5-৪৮. without a provider the writer falls back to the Phase 3 catalogue copy', async () => {
  const result = await writeNotification('lesson_reminder', {}, { fallbackCopy: { bn: 'পরের lesson ready' } });
  assert.equal(result.source, 'phase3-catalogue');
  assert.equal(result.usedModel, false);
  assert.equal(result.copy.bn, 'পরের lesson ready');
  assert.equal(result.ok, true);
});

test('P5-৪৯. safe generated wording is used and attributed', async () => {
  const result = await writeNotification('lesson_reminder', { lessonTitle: 'সমাস' }, {
    deps: { generate: okGenerator('তোমার পরের lessonটা ready — আজ একটু এগিয়ে যাও 🚀') }
  });
  assert.equal(result.source, 'ai-writer');
  assert.equal(result.usedModel, true);
  assert.equal(result.model, 'test-model');
  assert.ok(result.copy.bn.includes('lesson'));
});

test('P5-৫০. generated wording that trips a safety rule falls back to the catalogue', async () => {
  const result = await writeNotification('streak_nudge', {}, {
    fallbackCopy: { bn: 'স্ট্রিক ধরে রাখো' },
    deps: { generate: okGenerator('এখনই পড়ো, শেষ সুযোগ! ১০০% নিশ্চিত সফল হবে!!') }
  });
  assert.equal(result.source, 'phase3-catalogue');
  assert.equal(result.usedModel, false);
  assert.ok(result.rejected.length > 0);
  assert.equal(result.copy.bn, 'স্ট্রিক ধরে রাখো');
});

test('P5-৫১. the writer prompt only ever sees whitelisted facts', () => {
  const prompt = buildWriterPrompt('lesson_reminder', {
    lessonTitle: 'সমাস',
    streak: 7,
    studentId: 'internal-123',
    authToken: 'secret',
    internalFlag: true
  });
  assert.ok(prompt.includes('সমাস'));
  assert.ok(prompt.includes('7'));
  /* Identifiers and internal flags are dropped before the prompt is built. */
  assert.ok(!prompt.includes('internal-123'));
  assert.ok(!prompt.includes('secret'));
  assert.ok(!prompt.includes('internalFlag'));
  assert.ok(WRITER_SYSTEM_PROMPT.includes('140 characters'));
});

/* ── ৫২. experiment optimisation ────────────────────────────────────────── */

test('P5-৫২. a variant is not declared a winner below the minimum sample', () => {
  const result = optimiseExperiment([
    { variant: 'A', shown: 10, converted: 4, conversionRate: 0.4, clickRate: 0.5, openRate: 0.6 },
    { variant: 'B', shown: 12, converted: 2, conversionRate: 0.17, clickRate: 0.2, openRate: 0.3 }
  ], { minSample: 30 });
  assert.equal(result.ready, false);
  assert.equal(result.reason, 'insufficient-sample');
  assert.ok(result.variants.every((v) => v.meetsSample === false));
});

test('P5-৫৩. the winner is chosen on learning conversion, not on clicks', () => {
  const result = optimiseExperiment([
    /* B gets more clicks but converts fewer learners — A must still win. */
    { variant: 'A', shown: 100, converted: 30, conversionRate: 0.3, clickRate: 0.1, openRate: 0.2 },
    { variant: 'B', shown: 100, converted: 10, conversionRate: 0.1, clickRate: 0.9, openRate: 0.95 }
  ]);
  assert.equal(result.ready, true);
  assert.equal(result.best.variant, 'A');
  assert.equal(result.runnerUp.variant, 'B');
  assert.ok(result.margin > 0.02);
  assert.equal(result.decisive, true);
  assert.match(result.noteEn, /learning conversion, not on short-term clicks/i);
});

test('P5-৫৪. a thin margin is reported as indecisive', () => {
  const result = optimiseExperiment([
    { variant: 'A', shown: 100, converted: 20, conversionRate: 0.2, clickRate: 0.3, openRate: 0.4 },
    { variant: 'B', shown: 100, converted: 19, conversionRate: 0.19, clickRate: 0.3, openRate: 0.4 }
  ]);
  assert.equal(result.decisive, false);
  assert.ok(result.margin < 0.02);
});

/* ── ৫৫. purity / offline ───────────────────────────────────────────────── */

test('P5-৫৫. the policy layer is pure — same input, same verdict', () => {
  const copy = { copy: { bn: 'অল্প করে শুরু করো' } };
  const a = applyNotificationPolicy(copy, { send: true }, { sentToday: 1 });
  const b = applyNotificationPolicy(copy, { send: true }, { sentToday: 1 });
  assert.deepEqual(a, b);
});

test('P5-৫৬. the copilot module never imports a provider directly', async () => {
  const fs = await import('node:fs/promises');
  const source = await fs.readFile(new URL('./ai-analytics-copilot.mjs', import.meta.url), 'utf8');
  /* The provider is injected, so the module must not reach for one itself. */
  assert.ok(!/from '\.\/ai-agent\.js'/.test(source), 'copilot must not import the agent');
  assert.ok(!/\bfetch\s*\(/.test(source), 'copilot must not fetch');
});
