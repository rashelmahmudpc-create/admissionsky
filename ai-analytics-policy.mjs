/* Phase 5, AI Safety, Policy and Human-Approval Layer.
 *
 * The intelligence core predicts and recommends. This module is the wall between
 * those recommendations and the student, and it exists because the Phase 5 spec
 * says something specific: AI is an assistant, not an authority.
 *
 * Everything here is deterministic. It is the counterweight to the one place a
 * model is allowed to generate text (the notification writer in
 * `ai-analytics-copilot.mjs`): the model may only produce wording, and that
 * wording must survive `sanitiseGeneratedCopy` before anyone sees it.
 *
 * Two hard rules the tests pin:
 *
 * 1. AI cannot widen a limit. Phase 3's eligibility, quiet hours, frequency caps
 *    and fatigue rules decide whether a notification may send at all. This layer
 *    runs *after* those and can only narrow the set, never extend it. If Phase 3
 *    says no, nothing here can say yes.
 *
 * 2. AI cannot act on content, policy, mass notification or platform decisions
 *    without a named human approval. Those are classified in
 *    `HUMAN_APPROVAL_REQUIRED` and enforced by `requiresApproval`, not by
 *    convention.
 */

import { AB_VARIANTS } from './notification-intelligence.mjs';

export const AI_POLICY_VERSION = 'ai-p5-policy-v1';

const asInt = (v, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
};

/* ── prohibited outcomes ──────────────────────────────────────────────────── */

/* Each entry is a class of thing the AI must never do, with the phrase used in
 * the refusal. Exported so a test can prove every one of them is enforced rather
 * than merely documented. */
export const AI_PROHIBITIONS = Object.freeze({
  data_leak: 'Expose another student’s data or raw identifiers',
  auth_bypass: 'Bypass authentication or act without a verified session',
  arbitrary_notification: 'Send a notification outside the approved pipeline',
  limit_bypass: 'Exceed quiet hours, frequency caps or fatigue limits',
  permission_bypass: 'Act without the admin permission the action requires',
  fabricated_analytics: 'Present an invented figure as measured data',
  unnecessary_inference: 'Infer sensitive traits the product does not need',
  safety_override: 'Override a rule in this policy layer'
});

export const AI_PROHIBITION_KINDS = Object.freeze(Object.keys(AI_PROHIBITIONS));

/* ── approval gate ────────────────────────────────────────────────────────── */

/* Decisions a human must approve. Ordering is by blast radius: the further down,
 * the more people one wrong call reaches. */
export const HUMAN_APPROVAL_REQUIRED = Object.freeze([
  'content_change',
  'course_restructure',
  'policy_change',
  'mass_notification',
  'platform_decision'
]);

/* Anything that reaches more than this many students is a mass notification and
 * stops for approval, however confident the AI claims to be. */
export const MASS_NOTIFICATION_THRESHOLD = 250;

export const APPROVAL_STATUS = Object.freeze(['pending', 'approved', 'rejected', 'modified']);

export function classifyDecision(kind, context = {}) {
  const audience = asInt(context.audience);
  if (kind === 'mass_notification' || audience >= MASS_NOTIFICATION_THRESHOLD) return 'mass_notification';
  if (HUMAN_APPROVAL_REQUIRED.includes(kind)) return kind;
  return null;
}

export function requiresApproval(kind, context = {}) {
  return classifyDecision(kind, context) !== null;
}

/* A proposal is only actionable once a named human approved it, and a modified
 * approval has to carry the human's edited payload, an "approved but changed"
 * record with no replacement text would silently send the AI's original. */
export function approvalSatisfied(approval = null) {
  if (!approval) return { ok: false, reason: 'no-approval' };
  if (approval.status === 'approved') {
    if (!approval.actor) return { ok: false, reason: 'approval-needs-actor' };
    return { ok: true, payload: approval.payload ?? null };
  }
  if (approval.status === 'modified') {
    if (!approval.actor) return { ok: false, reason: 'approval-needs-actor' };
    if (approval.payload === undefined || approval.payload === null) {
      return { ok: false, reason: 'modified-approval-needs-payload' };
    }
    return { ok: true, payload: approval.payload };
  }
  if (approval.status === 'rejected') return { ok: false, reason: 'rejected' };
  return { ok: false, reason: 'pending' };
}

/* ── notification safety: AI narrows, never widens ────────────────────────── */

/* Phase 3 owns eligibility. This takes its verdict as input and is only allowed
 * to take away, never to add. A model that could argue its way past a quiet-hour
 * or fatigue rule is exactly the failure the spec warns about. */
export function applyNotificationPolicy(candidate = {}, intelligenceDecision = {}, options = {}) {
  const reasons = [];

  /* 1. Phase 3's decision is final on eligibility. */
  if (!intelligenceDecision || intelligenceDecision.send !== true) {
    return {
      allowed: false,
      reason: 'phase3-declined',
      detail: intelligenceDecision?.reason || 'not-eligible',
      reasons: ['phase3-declined'],
      narrowed: false
    };
  }

  /* 2. A policy kill-switch, and a per-run ceiling on how many AI-worded
   *    notifications may leave in one batch. */
  if (options.aiNotificationsEnabled === false) {
    return { allowed: false, reason: 'ai-notifications-disabled', reasons: ['kill-switch'], narrowed: false };
  }

  const sentToday = asInt(options.sentToday);
  const maxPerDay = asInt(options.maxPerDay, 2);
  if (sentToday >= maxPerDay) {
    reasons.push('daily-ai-cap');
  }

  /* 3. Quiet hours and send windows are Phase 3 facts; re-checked here so a
   *    caller that passes a stale decision cannot smuggle a 3am send. */
  if (options.inQuietHours === true) reasons.push('quiet-hours');
  if (options.inSendWindow === false) reasons.push('outside-send-window');

  /* 4. Fatigue is an explicit veto, not a scoring input. */
  if (options.fatigued === true) reasons.push('fatigued');

  /* 5. If the wording had to be rewritten or dropped by the sanitiser, the
   *    notification does not go as generated. */
  const copy = sanitiseGeneratedCopy(candidate.copy || {}, options.copyPolicy || {});
  if (!copy.ok) reasons.push(...copy.violations);

  if (reasons.length) {
    return {
      allowed: false,
      reason: reasons[0],
      reasons,
      narrowed: true,
      copy: null
    };
  }

  return {
    allowed: true,
    reason: 'ok',
    reasons: [],
    narrowed: false,
    copy: copy.copy,
    /* The student-facing text is the sanitised copy, never the raw generator
     * output, so a caller cannot accidentally send the pre-filter version. */
    attribution: {
      generated: Boolean(candidate.generated),
      model: candidate.model || null,
      variant: candidate.variant || null,
      policyVersion: AI_POLICY_VERSION
    }
  };
}

/* ── generated-copy sanitiser ─────────────────────────────────────────────── */

/* Patterns that make a notification manipulative or untrue. The spec bans
 * emotional pressure, fake urgency, manipulation, misleading claims and
 * unnecessary sends; each maps to a rule here. Bengali and English are both
 * covered because the product speaks both. */
export const COPY_VIOLATIONS = Object.freeze([
  /* Bengali patterns carry no `\b`: JavaScript word boundaries are defined on
   * [A-Za-z0-9_], so a boundary before Bengali script never matches and the rule
   * would silently never fire. */
  { id: 'fake_urgency', patterns: [/(এখনই|শেষ সুযোগ|আর মাত্র \d+ (সেকেন্ড|মিনিট|ঘণ্টা)|তাড়াতাড়ি)/, /\b(act now|last chance|hurry|only \d+ (seconds|minutes|hours) left|urgent)\b/i] },
  { id: 'emotional_pressure', patterns: [/(তুমি ব্যর্থ|তুমি পিছিয়ে|সবাই তোমার চেয়ে|লজ্জা|অপমান)/, /\b(you('| a)?re failing|falling behind|everyone else|shame|disappoint|embarrass)\b/i] },
  { id: 'manipulation', patterns: [/(না করলে|নাহলে সব|নিশ্চিত (সফল|র্যাংক)|তোমার জন্য ক্ষতিকর|warranty)/i, /\b(if you don't|or else|you will regret|guaranteed)\b/i] },
  { id: 'misleading_claim', patterns: [/(১০০%|নিশ্চিতভাবে)/, /(100%|guaranteed|never fail)|\balways\b/i] },
  { id: 'pressure_fomo', patterns: [/(সবাই এখন|ফোমো)/, /\b(fomo|everyone is|miss out)\b/i] },
  /* Credential-shaped strings must never be generated into a message. The word
   * may sit on either side of the digits, "কোড 483920" and "483920 কোড" are the
   * same leak. */
  { id: 'secret_leak', patterns: [/(\d{6}[^\d]{0,20}(code|otp|কোড))|((code|otp|কোড)[^\d]{0,20}\d{6})/i, /\b(otp|password|পাসওয়ার্ড|token)\s*[:=]\s*\S+/i] },
  { id: 'raw_identifier', patterns: [/\b[0-9a-f]{32,}\b/i, /\baccount-[0-9a-f]{8,}\b/i] }
]);

export const COPY_MAX_CHARS = 320;
export const COPY_MIN_CHARS = 8;

/* Returns the safe copy, or the reasons it cannot be made safe. A violation is
 * never silently stripped: an over-urgent message is dropped, not laundered,
 * because "act now" and "consider starting" promise different things and the
 * model does not get to pick which one the student reads. */
export function sanitiseGeneratedCopy(copy = {}, policy = {}) {
  const violations = [];
  /* Infer the language from the payload when the caller did not name one. A
   * default of 'bn' would read an `{ en: ... }` payload as empty and reject every
   * English notification, so the shape decides. */
  const declared = policy.lang === 'en' ? 'en' : policy.lang === 'bn' ? 'bn' : null;
  const lang = declared || (copy.bn ? 'bn' : copy.en ? 'en' : 'bn');
  let text = String(copy[lang] ?? copy.text ?? '').trim();

  if (!text) return { ok: false, violations: ['empty'], copy: null };

  if (policy.allowMarkdown === false) text = text.replace(/[*_`#>]/g, '');
  /* Collapse whitespace and cap length; a wall of text is its own problem. */
  text = text.replace(/\s+/g, ' ').trim();
  if (text.length > COPY_MAX_CHARS) text = text.slice(0, COPY_MAX_CHARS - 1).trimEnd() + '…';

  for (const rule of COPY_VIOLATIONS) {
    if (rule.patterns.some((p) => p.test(text))) violations.push(rule.id);
  }

  if (text.length < COPY_MIN_CHARS) violations.push('too-short');
  /* An unchecked "!" pile-up reads as shouting; one is fine, four is not. */
  if ((text.match(/!/g) || []).length > 2) violations.push('excessive_exclamation');

  if (violations.length) return { ok: false, violations, copy: null };

  return {
    ok: true,
    violations: [],
    copy: { [lang]: text, text, lang, chars: text.length }
  };
}

/* ── analytics query guard ────────────────────────────────────────────────── */

/* The copilot answer may only cite figures that came back from the engine. This
 * pulls every number out of the generated answer and checks it appears in the
 * grounded data. Without this the model can smooth over a gap with a plausible
 * number, which is the single most damaging failure for an analytics assistant. */
export function groundAnswer(answer, grounded = {}, options = {}) {
  const text = String(answer || '');
  const allowed = new Set();
  collectNumbers(grounded).forEach((n) => {
    allowed.add(n);
    allowed.add(Math.round(n));
    allowed.add(Number(n.toFixed(1)));
    allowed.add(Number(n.toFixed(2)));
    /* Percentages appear in prose as the same number a ratio or count feeds. */
    allowed.add(Math.round(n * 100));
    allowed.add(Number((n * 100).toFixed(1)));
    allowed.add(Number((n * 100).toFixed(2)));
  });
  /* Callers may whitelist figures that are context rather than measurement, the
   * window length ("the last 30 days") is the common case, and without it every
   * honest answer would be rejected for naming its own period. */
  for (const extra of (Array.isArray(options.allow) ? options.allow : [])) {
    const n = Number(extra);
    if (Number.isFinite(n)) allowed.add(n);
  }

  /* A digit run only counts as a figure when it stands alone. Without the
   * lookarounds, an identifier ("l3") or a hyphenated label ("day-7") would be
   * read as a claim and every honest answer would be rejected. Negative values
   * are deliberately not extracted, no metric in this product is negative, and
   * "day-7" is far more common than a real minus sign. */
  const found = text.match(/(?<![\w-])\d+(?:[.,]\d+)?(?![\w])/g) || [];
  const ungrounded = [];
  for (const raw of found) {
    const n = Number(String(raw).replace(/,/g, ''));
    if (!Number.isFinite(n)) continue;
    /* Bengali digit forms are normalised by the caller before this runs. */
    if (!allowed.has(n) && !allowed.has(Math.round(n)) && !allowed.has(Number(n.toFixed(1)))) {
      ungrounded.push(n);
    }
  }

  return {
    ok: ungrounded.length === 0,
    ungrounded: [...new Set(ungrounded)].slice(0, 10),
    checked: found.length
  };
}

function collectNumbers(value, out = []) {
  if (value === null || value === undefined) return out;
  if (typeof value === 'number') { if (Number.isFinite(value)) out.push(value); return out; }
  if (typeof value === 'string') {
    /* A numeric string is data ("62"), a word is not. */
    const n = Number(value);
    if (value.trim() !== '' && Number.isFinite(n)) out.push(n);
    return out;
  }
  if (Array.isArray(value)) { value.forEach((v) => collectNumbers(v, out)); return out; }
  if (typeof value === 'object') { Object.values(value).forEach((v) => collectNumbers(v, out)); return out; }
  return out;
}

/* Bengali digits, for normalising a model's Bangla answer before grounding. */
const BN_DIGITS = '০১২৩৪৫৬৭৮৯';
export function normaliseBengaliDigits(text) {
  return String(text || '').replace(/[০-৯]/g, (d) => String(BN_DIGITS.indexOf(d)));
}

/* ── cost control ─────────────────────────────────────────────────────────── */

/* The spec's cost rule: never call a model per event. Aggregation first, and a
 * model only when a human-facing surface actually needs prose. This predicate is
 * the single place that decision is made. */
export const AI_CALL_TRIGGERS = Object.freeze(['copilot-question', 'notification-wording', 'admin-summary']);

export function shouldCallModel(trigger, context = {}) {
  if (!AI_CALL_TRIGGERS.includes(trigger)) return { call: false, reason: 'not-a-model-surface' };
  if (context.cachedFresh === true) return { call: false, reason: 'cache-hit' };
  const budget = asInt(context.remainingBudget, -1);
  if (budget === 0) return { call: false, reason: 'budget-exhausted' };
  if (asInt(context.signalSamples) < asInt(context.minSamples, 1)) return { call: false, reason: 'no-signal' };
  return { call: true, reason: 'allowed' };
}

/* ── permission matrix ────────────────────────────────────────────────────── */

/* What each surface may do. Kept as data so a route cannot quietly grant itself
 * a capability it was never meant to have. */
export const CAPABILITIES = Object.freeze({
  'student:read-self': ['student'],
  'admin:read-aggregate': ['admin'],
  'admin:approve': ['admin'],
  'notification:suggest': ['system'],
  'notification:send': ['system'],
  'content:suggest': ['system'],
  'content:change': ['admin']
});

export function canPerform(capability, role) {
  const allowed = CAPABILITIES[capability];
  if (!allowed) return { ok: false, reason: 'unknown-capability' };
  if (!allowed.includes(role)) return { ok: false, reason: 'role-not-permitted' };
  return { ok: true };
}

/* ── rate limiting for AI surfaces ────────────────────────────────────────── */

export const AI_RATE_LIMITS = Object.freeze({
  'copilot-question': { perHour: 30, perDay: 200 },
  'notification-wording': { perHour: 100, perDay: 600 },
  'admin-summary': { perHour: 10, perDay: 60 }
});

export function checkAiRate(trigger, counters = {}) {
  const limit = AI_RATE_LIMITS[trigger];
  if (!limit) return { ok: false, reason: 'unknown-trigger' };
  const hour = asInt(counters.hour);
  const day = asInt(counters.day);
  if (day >= limit.perDay) return { ok: false, reason: 'daily-limit', limit: limit.perDay, remaining: 0 };
  if (hour >= limit.perHour) return { ok: false, reason: 'hourly-limit', limit: limit.perHour, remaining: 0 };
  return { ok: true, remaining: { hour: limit.perHour - hour, day: limit.perDay - day } };
}

/* ── A/B variant allocation ───────────────────────────────────────────────── */

/* Phase 3 already defines the variants and the stable hash assignment. This adds
 * the Phase 5 safety constraint: a variant is only eligible if it has not been
 * ruled out, and allocation never produces an empty assignment. */
export function allocateVariant(userId, kind, experiment = {}, assignFn) {
  const variants = Array.isArray(experiment.variants) && experiment.variants.length ? experiment.variants : AB_VARIANTS;
  const active = variants.filter((v) => !experiment.retired?.includes(v));
  const pool = active.length ? active : [variants[0]];
  if (typeof assignFn !== 'function') return pool[0];
  const picked = assignFn(userId, kind, pool);
  /* A caller-supplied assigner that returns something outside the pool is a bug;
   * fall back rather than send an unknown variant. */
  return pool.includes(picked) ? picked : pool[0];
}

/* ── safety envelope ──────────────────────────────────────────────────────── */

/* One call the routes use to prove the whole policy stack ran, so a future route
 * cannot skip it. Returns every verdict plus the narrowest outcome. */
export function policyEnvelope(input = {}) {
  const checks = [];
  const role = input.role;
  const capability = input.capability;

  if (capability) checks.push({ name: 'permission', ...canPerform(capability, role) });
  if (input.trigger) checks.push({ name: 'rate', ...checkAiRate(input.trigger, input.counters) });
  if (input.trigger) checks.push({ name: 'model-call', ...shouldCallModel(input.trigger, input.modelContext) });

  const failed = checks.filter((c) => c.ok === false);
  return {
    version: AI_POLICY_VERSION,
    ok: failed.length === 0,
    checks,
    failed: failed.map((f) => `${f.name}:${f.reason}`),
    prohibitions: AI_PROHIBITION_KINDS
  };
}
