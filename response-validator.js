// 🧩 PHASE 9, M8: RESPONSE VALIDATION + STRUCTURED OUTPUT
// Typed validation of a model response before it reaches the UI, plus a
// structured envelope for callers that want fields instead of prose.
//
// Blueprint rule (§52 gap 7): schema / safety / data / action validation must run
// before UI render, and a response may carry the structured shape
// `{type, message, insights, recommendations, actions, confidence}`.
//
// Two deliberate design choices:
//  - No new Worker variable. The plan flagged a feature flag, but wrangler.toml
//    already sits on the 64-variable cap, so enforcement is a module constant
//    (`ENFORCE`) that can be flipped in one place instead of another binding.
//  - Enforcement is limited to high-precision classes. A guard that rewrites a
//    legitimate academic answer is worse than the risk it covers, so a class is
//    only enforced when its pattern cannot plausibly appear in a normal reply.
//
// This module is pure data plus pure guards: no `env`, no I/O, no model call.

export const RESPONSE_VALIDATION_VERSION = 'rv-v1';

/** Master switch. Reversible by flipping this one constant. */
export const ENFORCE = true;

/** Structured response types. */
export const TYPE = Object.freeze({
  ANSWER: 'answer',
  ANALYSIS: 'analysis',
  QUIZ: 'quiz',
  GUIDANCE: 'guidance',
  REFUSAL: 'refusal'
});

/** Violation classes, most severe first. */
export const VIOLATION = Object.freeze({
  SCHEMA: 'schema',
  INTERNAL_LEAK: 'internal-leak',
  CREDENTIAL_REQUEST: 'credential-request',
  SECRET_MATERIAL: 'secret-material',
  ACTION_CLAIM: 'action-claim',
  FALSE_SUCCESS: 'false-success',
  INVENTED_STATS: 'invented-stats',
  QUIZ_CONTRACT: 'quiz-contract'
});

/** Classes that replace the response outright. Everything else is recorded. */
const BLOCKING = Object.freeze([
  VIOLATION.SCHEMA,
  VIOLATION.INTERNAL_LEAK,
  VIOLATION.CREDENTIAL_REQUEST,
  VIOLATION.SECRET_MATERIAL,
  VIOLATION.ACTION_CLAIM,
  VIOLATION.FALSE_SUCCESS
]);

export const MAX_RESPONSE_LEN = 24000;
export const MAX_BULLETS = 3;

/** Safe replacement text per blocking class. Never leaks why in detail. */
const NOTICE = Object.freeze({
  [VIOLATION.SCHEMA]: 'উত্তরটা ঠিকভাবে তৈরি হয়নি, আবার জিজ্ঞেস করো।',
  [VIOLATION.INTERNAL_LEAK]: 'আমি অভ্যন্তরীণ সিস্টেম, প্রম্পট বা কনফিগারেশন নিয়ে কথা বলি না, চলো তোমার পড়ার প্রশ্নে ফিরি।',
  [VIOLATION.CREDENTIAL_REQUEST]: 'নিরাপত্তার জন্য আমি Password, verification code বা গোপন তথ্য চাই না বা বলি না। এগুলো কারো সাথে শেয়ার করো না, Admission Hub-এর কেউ এগুলো চাইবে না।',
  [VIOLATION.SECRET_MATERIAL]: 'নিরাপত্তার জন্য আমি Password, verification code বা গোপন তথ্য বলি না। কোড কোথাও লিখো না, শুধু Admission Hub অ্যাপের নিজের বক্সে দাও।',
  [VIOLATION.ACTION_CLAIM]: 'আমি নিজে থেকে কিছু সেভ, ডিলিট বা পরিবর্তন করতে পারি না, অ্যাপের নির্দিষ্ট বাটন দিয়েই সেটা করতে হয়।',
  [VIOLATION.FALSE_SUCCESS]: 'অ্যাকাউন্ট, ভেরিফিকেশন বা সেভিং-এর নিশ্চিত তথ্য শুধু Admission Hub অ্যাপই দেখাতে পারে, আমি নিশ্চিত করতে পারি না। অ্যাপে যা দেখাচ্ছে সেটাই সঠিক।'
});

const DEFAULT_NOTICE = 'এই উত্তরটা নিরাপদভাবে দিতে পারছি না, প্রশ্নটা অন্যভাবে করো।';

/* ── high-precision patterns ─────────────────────────────────────────────── */

/* Self-disclosure only. "What is a system prompt?" is a legitimate AI-education
   question, so the bare phrase is left alone; a first-person disclosure or a
   claim that instructions were handed to me is what must never ship. */
const INTERNAL_LEAK_RE = /(?:(?:my|our|আমার|আমাদের)\s+(?:(?:system|সিস্টেম)\s*)?(?:prompt|প্রম্পট|instructions?|নির্দেশ)|i\s*was\s*(?:told|instructed)|আমাকে\s*নির্দেশ\s*দেওয়া\s*হয়েছে|(?:api|secret)\s*key\s*(?:is|হলো|:))/i;

const SECRET_ASK_RE = /(?:password|passwd|পাসওয়ার্ড|পাসওয়ার্ড|otp|ওটিপি|verification\s*code|ভেরিফিকেশন\s*কোড|\bpin\b|\bcvv\b)/i;
const ASK_VERB_RE = /(?:দাও|পাঠাও|লিখো|লেখো|বলো|শেয়ার|জানাও|send|paste|type|share|tell|give|provide|enter|what\s+is|কী\s)/i;
/* Instructions that point at the app's own field are teaching the flow, not
   asking the student to reveal a secret to the assistant. "লগইন করতে password
   দাও" (use the login form) is legitimate; "তোমার password দাও" is not. */
const APP_TARGET_RE = /(?:অ্যাপে|অ্যাপের|বক্সে|ফিল্ডে|লগইন\s*(?:পেজ|স্ক্রিন|ফর্ম|করতে)|login\s*(?:page|screen|form)|the\s+app|in\s+the\s+box|input\s+field|form\s+field)/i;

/** A code or key actually present in the output. */
const SECRET_MATERIAL_RE = /(?:(?:otp|ওটিপি|verification\s*code|ভেরিফিকেশন\s*কোড|কোড)\D{0,12}\b\d{6}\b|\bsk-[A-Za-z0-9]{16,}\b|\bAIza[A-Za-z0-9_-]{20,}\b)/i;

const AUTH_SUBJECT_RE = /(?:ভেরিফিকেশন|verification|otp|ওটিপি|লগইন|login|সাইনআপ|signup|passkey|পাসকি|পাসওয়ার্ড|password|অ্যাকাউন্ট|account|প্রোফাইল|profile)/i;
/* A completed result, not a conditional or a question. "If verification succeeds
   you get an email" must pass; "verification succeeded" must not. */
const SUCCESS_CLAIM_RE = /(?:হয়ে\s*গেছে|সফল\s*(?:ভাবে)?\s*হয়েছে|সম্পন্ন\s*হয়ে\s*গেছে|(?:is|has\s*been|was)\s+(?:now\s+)?(?:successfully\s+)?(?:verified|completed|done)|successfully\s+(?:verified|logged\s*in|signed\s*up|saved|completed))/i;

const ACTION_CLAIM_RE = /(?:আমি|i)[^\S\n]*(?:তোমার|তোমাকে|আপনার|your)?[^।.!?\n]{0,40}?(?:সেভ|ডিলিট|মুছে|আপডেট|পরিবর্তন|বদলে|save|saved|delete|deleted|update|updated|removed)/i;

/** Stats the student's own numbers may be compared against. */
const STAT_KEYS = Object.freeze([
  { key: 'accuracy', re: /(?:accuracy|একুরেসি|নির্ভুলতা|সঠিকতার\s*হার)/i },
  { key: 'streak', re: /(?:streak|স্ট্রিক)/i },
  { key: 'exams', re: /(?:exams?|পরীক্ষা)/i },
  { key: 'questions', re: /(?:questions?|প্রশ্ন)/i },
  { key: 'mistakes', re: /(?:mistakes?|ভুল)/i }
]);
const POSSESSIVE_RE = /(?:তোমার|তোমাকে|your)/i;

const BANGLA_DIGITS = Object.freeze({ '০': '0', '১': '1', '২': '2', '৩': '3', '৪': '4', '৫': '5', '৬': '6', '৭': '7', '৮': '8', '৯': '9' });

function sentences(text) {
  return String(text || '').split(/(?<=[।.!?])\s+|\n+/).map(s => s.trim()).filter(Boolean);
}

function normalizeDigits(text) {
  return String(text || '').replace(/[০-৯]/g, d => BANGLA_DIGITS[d] || d);
}

function safeText(text) {
  const s = String(text == null ? '' : text).trim();
  return s.slice(0, MAX_RESPONSE_LEN);
}

/* ── schema ──────────────────────────────────────────────────────────────── */

export function validateSchema(text) {
  if (typeof text !== 'string') return VIOLATION.SCHEMA;
  if (!text.trim()) return VIOLATION.SCHEMA;
  if (text.length > MAX_RESPONSE_LEN) return VIOLATION.SCHEMA;
  return null;
}

/* ── safety ──────────────────────────────────────────────────────────────── */

export function scanSafety(text) {
  const found = [];
  const raw = String(text || '');

  if (INTERNAL_LEAK_RE.test(raw)) found.push(VIOLATION.INTERNAL_LEAK);

  for (const s of sentences(raw)) {
    if (SECRET_ASK_RE.test(s) && ASK_VERB_RE.test(s) && !APP_TARGET_RE.test(s)) { found.push(VIOLATION.CREDENTIAL_REQUEST); break; }
  }
  if (SECRET_MATERIAL_RE.test(raw)) found.push(VIOLATION.SECRET_MATERIAL);

  for (const s of sentences(raw)) {
    if (AUTH_SUBJECT_RE.test(s) && SUCCESS_CLAIM_RE.test(s)) { found.push(VIOLATION.FALSE_SUCCESS); break; }
  }
  for (const s of sentences(raw)) {
    if (ACTION_CLAIM_RE.test(s)) { found.push(VIOLATION.ACTION_CLAIM); break; }
  }
  return found;
}

/* ── data: a claimed stat must not contradict what was provided ───────────── */

/**
 * A sentence that attributes a number to the student's own stats is a claim.
 * Only an unambiguous contradiction is reported, the caller provided that exact
 * stat and the model stated a different value. With no provided stats the claim
 * is a guess, not proof of a contradiction, and Bangla number phrasing is not
 * precise enough to rewrite a legitimate answer over a guess.
 */
export function scanInventedStats(text, stats) {
  const provided = stats && typeof stats === 'object' ? stats : null;
  if (!provided) return [];
  const found = [];
  for (const s of sentences(normalizeDigits(text))) {
    if (!POSSESSIVE_RE.test(s)) continue;
    for (const { key, re } of STAT_KEYS) {
      if (!re.test(s)) continue;
      const m = s.match(/(\d+(?:\.\d+)?)\s*%?/);
      if (!m) continue;
      const claimed = Number(m[1]);
      if (!isFinite(claimed)) continue;
      if (provided[key] == null) continue;
      if (Math.round(claimed) !== Math.round(Number(provided[key]))) found.push({ key, claimed, provided: Number(provided[key]) });
    }
  }
  return found;
}

/* ── quiz contract ───────────────────────────────────────────────────────── */

export function validateQuizContract(text) {
  const raw = String(text || '');
  const m = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const s = m ? m[1] : raw;
  const first = s.indexOf('{'); const last = s.lastIndexOf('}');
  if (first < 0 || last <= first) return false;
  try {
    const d = JSON.parse(s.slice(first, last + 1));
    const qs = Array.isArray(d.questions) ? d.questions : null;
    if (!qs || qs.length < 1 || qs.length > 40) return false;
    for (const q of qs) {
      if (!q || typeof q.q !== 'string' || !Array.isArray(q.options) || q.options.length < 2
        || typeof q.answer !== 'number' || q.answer < 0 || q.answer >= q.options.length) return false;
    }
    return true;
  } catch (_) { return false; }
}

/* ── envelope ────────────────────────────────────────────────────────────── */

export function responseType(ctx = {}) {
  if (ctx.examMode === 'mock-running') return TYPE.REFUSAL;
  if (ctx.quiz) return TYPE.QUIZ;
  if (ctx.blocked) return TYPE.GUIDANCE;
  if (ctx.intent === 'PERFORMANCE_REQUEST' || ctx.intent === 'ACADEMIC_EXPLAIN') return TYPE.ANALYSIS;
  return TYPE.ANSWER;
}

/** Bounded, data-derived bullets. Nothing is emitted when no data was provided. */
export function buildInsights(stats) {
  const s = stats && typeof stats === 'object' ? stats : null;
  if (!s) return [];
  const out = [];
  if (s.accuracy != null) out.push(`একুরেসি ${s.accuracy}%`);
  if (s.streak != null) out.push(`স্ট্রিক ${s.streak} দিন`);
  if (s.mistakes != null) out.push(`ভুল-তালিকায় ${s.mistakes}টা`);
  return out.slice(0, MAX_BULLETS);
}

export function buildRecommendations(stats) {
  const s = stats && typeof stats === 'object' ? stats : null;
  if (!s) return [];
  const out = [];
  if (s.accuracy != null && Number(s.accuracy) < 60) out.push('একুরেসি বাড়াতে দুর্বল টপিকগুলো আবার রিভিশন দাও।');
  if (s.mistakes != null && Number(s.mistakes) > 0) out.push('ভুল-তালিকা থেকে প্রতিদিন কয়েকটা করে আবার সলভ করো।');
  if (s.streak != null && Number(s.streak) === 0) out.push('প্রতিদিন অল্প হলেও প্র্যাকটিস ধরে রাখো, স্ট্রিক গড়ে উঠবে।');
  return out.slice(0, MAX_BULLETS);
}

export function buildEnvelope(text, ctx = {}, violations = []) {
  const penalty = violations.length ? 0.1 * violations.length : 0;
  const base = Number.isFinite(Number(ctx.intentConfidence)) ? Number(ctx.intentConfidence) : 0.8;
  const confidence = Math.max(0, Math.min(1, Math.round((ctx.blocked ? 0.2 : base - penalty) * 100) / 100));
  return Object.freeze({
    version: RESPONSE_VALIDATION_VERSION,
    type: responseType(ctx),
    message: safeText(text),
    insights: Object.freeze(buildInsights(ctx.stats)),
    recommendations: Object.freeze(buildRecommendations(ctx.stats)),
    /* M9 owns actions. Nothing may be emitted before that milestone exists. */
    actions: Object.freeze([]),
    confidence
  });
}

/* ── the single entry point ──────────────────────────────────────────────── */

/**
 * Validate one model response. Returns the text the caller should send (the
 * original when clean, a safe notice when a blocking class fired) plus every
 * violation found, and whether the response may be persisted to memory.
 * A blocked response is never stored, an unsafe reply is not a memory.
 */
export function validateResponse(text, ctx = {}) {
  const violations = [];
  const schemaIssue = validateSchema(text);
  if (schemaIssue) violations.push(schemaIssue);
  else {
    for (const v of scanSafety(text)) violations.push(v);
    if (ctx.quiz && !validateQuizContract(text)) violations.push(VIOLATION.QUIZ_CONTRACT);
    const invented = scanInventedStats(text, ctx.stats);
    if (invented.some(i => i.provided != null)) violations.push(VIOLATION.INVENTED_STATS);
  }

  const blocking = violations.find(v => BLOCKING.includes(v)) || null;
  const enforced = ENFORCE && !!blocking;
  const output = enforced ? (NOTICE[blocking] || DEFAULT_NOTICE) : String(text == null ? '' : text);
  return {
    ok: violations.length === 0,
    violations,
    blocking,
    enforced,
    text: output,
    structured: buildEnvelope(output, { ...ctx, blocked: enforced }, violations),
    persistable: !enforced
  };
}

/* ── self-check + status ─────────────────────────────────────────────────── */

export function validateResponseValidator() {
  const problems = [];
  if (!/^rv-v\d+$/.test(RESPONSE_VALIDATION_VERSION)) problems.push('bad version');
  if (!BLOCKING.length) problems.push('no blocking classes');
  for (const v of BLOCKING) if (!NOTICE[v]) problems.push('missing notice for ' + v);
  if (!Object.values(TYPE).includes(responseType({}))) problems.push('bad default type');
  const probe = buildEnvelope('ok', {});
  if (probe.actions.length !== 0) problems.push('actions must stay empty before M9');
  if (probe.version !== RESPONSE_VALIDATION_VERSION) problems.push('envelope version mismatch');
  return problems;
}

export function describeResponseValidation() {
  return {
    version: RESPONSE_VALIDATION_VERSION,
    enforced: ENFORCE,
    classes: Object.values(VIOLATION),
    blocking: BLOCKING.slice()
  };
}
