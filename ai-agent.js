/**
 * 🤖 ADMISSION HUB AI, AGENT CORE v1 (Phase 1: AI Agent Foundation)
 * ====================================================================
 * মালিক-স্পেক (২০২৬-০৯-০৮): model-independent central AI brain.
 *   Chat UI → AI Gateway (public-worker: anonymous-device rate+validate) → Agent Core → Model Router
 *   → Provider Adapter (Gemini/Groq) → Response Stream
 *
 * নীতি:
 *  - uid কখনো prompt/body-থেকে নয়, Gateway validated/hashed device identity হিসেবে পাস করে।
 *  - কোনো client-সিক্রেট নেই (key শুধু server-env)।
 *  - Response সবসময় real context-ভিত্তিক; fabricate-সংখ্যা কঠোর-নিষিদ্ধ।
 *  - Mock-exam মোডে উত্তর/হিন্ট/ব্যাখ্যা hard-refuse (safety ↑)।
 *  - KV-রাইট-বাজেট: প্রতি চ্যাটে সর্বোচ্চ ২ রাইট (rate-counter + memory)।
 *
 * Test-যোগ্যতা: module-import-এ কোনো worker-API নেই, pure ফাংশন + handler,
 * env/fetch পরীক্ষায় mock করা যায় (ai-agent-f1.test.mjs)।
 */
import { corsHeaders } from './cors-policy.mjs';
import { buildContext, renderContext, describeContext, CONTEXT_VERSION } from './context-engine.js';
import { getPromptText, BASE_PROMPT_ID } from './prompt-registry.js';
import { listTools, TOOL_REGISTRY_VERSION } from './tool-registry.js';
import { isAppFeatureQuestion, loadAppFeatures, renderAppFeatures } from './sky-app-features.mjs';
import { planServerTools, isSimplePlan, simpleToolResponse, runTools, renderToolContext, toolsEnabled, nowLine } from './sky-tools.mjs';
import { bumpDailyStats, statsFromTiming } from './sky-daily-report.mjs';
/* Sky recall (owner plan step 2): the chat-open reminder. Pure, no model call. */
import { buildRecall, sanitizeRecent, RECALL_VERSION } from './sky-recall.mjs';
/* Sky goal (owner plan step 3): advice shaped around the admission goal. Pure. */
import { isGoalQuestion, resolveGoal, renderGoalContext } from './sky-goal.mjs';
/* Sky custom instructions (owner plan step 3): the student's own short note. */
import { checkInstruction, parseStoredInstruction, storedInstruction, renderInstructionBlock, INSTRUCTION_KV_PREFIX, INSTRUCTION_MAX, INSTRUCTION_EXAMPLES, INSTRUCTIONS_VERSION } from './sky-instructions.mjs';
import { extractMemoryCandidates, makeMemory, upsertMemory, parseMemory, renderMemory, resolveMemoryOwner, isPiiFree, statedWeakTopics, KIND, SOURCE, MEMORY_VERSION } from './memory-engine.js';
import { validateResponse, describeResponseValidation, RESPONSE_VALIDATION_VERSION } from './response-validator.js';
import { describeActions, ACTION_VERSION } from './action-engine.js';
import { makeTrace, makeRequestId, callerRef, quotaState, renderTrace, estimateTokens, FALLBACK, OBSERVABILITY_VERSION, describeObservability, parseTraces, appendTrace, addUsage, emptyUsage, estimateCost, validateObservability } from './observability.js';
import { aiStateStore, AI_STATE_VERSION } from './ai-state-do.mjs';
/* P25, chat response cache (step 1 of the owner's AI cost plan). The store is
 * the existing analytics one, which already owns the `ai_cache` table. */
import { AiAnalyticsStore } from './ai-analytics-store.mjs';
import { chatCacheEnabled, isCacheableRequest, isSharedAcademicCandidate, chatCacheKey, chatCacheTtl } from './ai-chat-cache.mjs';
/* P26, difficulty-aware tier routing (step 2 of the AI cost plan). */
import { routeTier, assessDifficulty } from './ai-tier-router.mjs';
/* P27, bounded history (step 3 of the AI cost plan). */
import { selectHistory, capRecalledTurns } from './ai-history-trim.mjs';
/* P28, provider chain health: a transient 5xx must not disable a model for a day. */
import { healthyChain, failureMarker, isEntryHealthy, rankChainByModelHealth } from './ai-provider-health.mjs';

export const AGENT_VERSION = 'agent-f1';
export const SYSTEM_PROMPT_V = 'sys-sky-v3-1-live-tools';

/* ── M4 Context Engine feature flag (default off) ------------------------ */
export function contextEngineEnabled(env) {
  return String((env && env.USE_CONTEXT_ENGINE) || '').trim() === 'enabled';
}

export const INTENTS = {
  GENERAL_CHAT: 'GENERAL_CHAT',
  ACADEMIC_EXPLAIN: 'ACADEMIC_EXPLAIN',
  PERFORMANCE_REQUEST: 'PERFORMANCE_REQUEST',
  QUIZ_REQUEST: 'QUIZ_REQUEST',
  SEARCH_REQUEST: 'SEARCH_REQUEST',
  IMAGE_REQUEST: 'IMAGE_REQUEST'
};

const TIER = { FAST: 'FAST', SMART: 'SMART' };

/* ── Intent Engine v1: rule-based (Bangla+English+Banglish) ────────────── */
const RE = {
  quiz: /(\d+\s*(টা|টি)?\s*(mcq|প্রশ্ন)?|\bquiz\b|\bchallenge\b|মক|প্রশ্ন বানাও|প্রশ্ন তৈরি|make.*(mcq|question)|\bmcq\b)/i,
  perf: /(performance|প্রোগ্রেস|progress|কেমন আছি|কেমন চলছে|কেমন করছি|কতটা (ভালো|খারাপ)|রিপোর্ট|report|streak|accuracy|সঠিক|ভুল করেছি|কয়টা ঠিক|মার্কস|marks|score|স্কোর)/i,
  image: /(ছবি|স্ক্রিনশট|ফটো|পিকচার|হাতে লেখা|চিত্র|\bimage\b|\bscreenshot\b|\bphoto\b|handwritten|\bdiagram\b)/i,
  search: /(নিউজ|খবর|নোটিশ|তারিখ|সার্কুলার|আপডেট|ভর্তির ফল|কবে|\bnews\b|\bnotice\b|\bdate\b|deadline|\bcircular\b|\bupdate\b)/i,
  academic: /(বুঝাও|understand|explain|ব্যাখ্যা|কী |কি |কী\?|কি\?|what|why|how|কেন|define|সংজ্ঞা|পার্থক্য|difference|সূত্র|formula|theorem|উপপাদ্য|concept|ধারণা|system|সিস্টেম|photosynthesis|সালোকসংশ্লেষণ|newton|নিউটন|physics|পদার্থ|chemistry|রসায়ন|biology|জীববিজ্ঞান|math|গণিত|english|ইংরেজি|bangla|বাংলা|grammar|ব্যাকরণ)/i,
  greeting: /(আসসালামু|আসসালাম|সালাম|আলাইকুম|হ্যালো|হাই|নমস্কার|good morning|good evening|\bhi\b|\bhello\b)/i
};

function lower(s) {
  return String(s || '').toLowerCase();
}
export function classifyIntent(text) {
  const t = lower(text);
  if (!t.trim()) return { intent: INTENTS.GENERAL_CHAT, tier: TIER.FAST, confidence: 0.4 };
  if (RE.greeting.test(t)) return { intent: INTENTS.GENERAL_CHAT, tier: TIER.FAST, confidence: 0.85 };
  if (RE.image.test(t)) return { intent: INTENTS.IMAGE_REQUEST, tier: TIER.FAST, confidence: 0.75 };
  if (RE.quiz.test(t) && /(বানাও|তৈরি|create|generate|দাও|make|build|আমাকে|নাও)/i.test(text))
    return { intent: INTENTS.QUIZ_REQUEST, tier: TIER.FAST, confidence: 0.8 };
  if (RE.perf.test(t)) return { intent: INTENTS.PERFORMANCE_REQUEST, tier: TIER.SMART, confidence: 0.7 };
  if (RE.search.test(t)) return { intent: INTENTS.SEARCH_REQUEST, tier: TIER.FAST, confidence: 0.65 };
  if (RE.academic.test(t)) return { intent: INTENTS.ACADEMIC_EXPLAIN, tier: TIER.SMART, confidence: 0.7 };
  return { intent: INTENTS.GENERAL_CHAT, tier: TIER.FAST, confidence: 0.5 };
}

/* ── Request Validation (AI Gateway) ------------------------------------- */
export function validateChatReq(body) {
  if (!body || typeof body !== 'object') return { ok: false, code: 'invalid_request', message: 'অনুরোধ সঠিক নয়।' };
  const raw = Array.isArray(body.messages) ? body.messages : null;
  if (!raw || !raw.length) return { ok: false, code: 'empty_messages', message: 'কোনো বার্তা নেই।' };
  if (raw.length > 24) return { ok: false, code: 'too_many_messages', message: 'একবারে ২৪-এর বেশি বার্তা পাঠানো যাবে না।' };
  const msgs = [];
  let total = 0;
  for (const m of raw) {
    /* 'ai' / 'model' are the UI's names for an assistant turn; an older cached
       client still sends them, so they are normalised instead of failing the
       whole follow-up question. */
    const role = m && (m.role === 'assistant' || m.role === 'ai' || m.role === 'model') ? 'assistant' : m && m.role === 'user' ? 'user' : null;
    let content = typeof (m && m.content) === 'string' ? m.content : typeof (m && m.text) === 'string' ? m.text : '';
    /* An empty or over-long earlier assistant turn (failed / long answer) is
       history, not input: skip or clip it rather than reject the request. */
    if (role === 'assistant' && !content.trim()) continue;
    if (role === 'assistant' && content.length > 4000) content = content.slice(0, 4000);
    if (!role || !content.trim()) return { ok: false, code: 'invalid_message', message: 'বার্তার গঠন সঠিক নয়।' };
    if (content.length > 4000) return { ok: false, code: 'message_too_long', message: 'একটি বার্তা ৪০০০ অক্ষরের বেশি হতে পারবে না।' };
    const image = typeof (m && m.image) === 'string' ? m.image : '';
    if (image) {
      if (!/^data:image\/(jpeg|png|webp|gif);base64,/.test(image)) return { ok: false, code: 'invalid_image', message: 'ছবির ফরম্যাট সাপোর্টেড নয় (jpeg/png/webp/gif)।' };
      if (image.length > 4700000) return { ok: false, code: 'image_too_large', message: 'ছবি ৩.৫MB-এর বেশি হতে পারবে না।' };
    }
    total += content.length;
    msgs.push({ role, content: content.trim(), image });
  }
  /* Trim the oldest history first; only reject when the latest turn alone is too big. */
  while (total > 20000 && msgs.length > 1) { total -= msgs[0].content.length; msgs.shift(); }
  if (!msgs.some(x => x.role === 'user')) return { ok: false, code: 'empty_messages', message: 'কোনো বার্তা নেই।' };
  if (total > 20000) return { ok: false, code: 'context_too_long', message: 'বার্তার মোট আকার খুব বড়।' };
  /* Collapse consecutive user turns. A model reads two identical consecutive
     user messages as one combined input (৮ + ৮ → ৮৮); merging them means no
     caller can ever duplicate a turn downstream. */
  const merged = [];
  for (const mm of msgs) {
    const prev = merged[merged.length - 1];
    if (prev && prev.role === 'user' && mm.role === 'user') {
      prev.content = `${prev.content}\n${mm.content}`.slice(0, 4000);
      if (!prev.image && mm.image) prev.image = mm.image;
    } else {
      merged.push({ ...mm });
    }
  }
  return { ok: true, messages: merged, fresh: body.fresh === true };
}

const ONBOARDING_ACTIONS = new Set([
  'focus-name', 'focus-email', 'focus-dob', 'focus-school', 'focus-college',
  'open-signup', 'open-login', 'explain-email', 'explain-telegram'
]);
const oneOf = (value, allowed, fallback) => allowed.includes(String(value || '')) ? String(value) : fallback;

export function onboardingSecretDetected(value) {
  const text = String(value || '').trim();
  if (!text) return false;
  const passwordWord = '(?:password|passcode|পাসওয়ার্ড|পাসওয়াৰ্ড|পাসওয়ার্ড)';
  if (/\b\d{6}\b/.test(text) || /eyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}/.test(text)
    || /-----BEGIN [A-Z ]+PRIVATE KEY-----/.test(text)) return true;
  if (new RegExp(`(?:my|amar|আমার)\\s*${passwordWord}\\s*(?:is|হলো|:)?\\s*\\S{4,}`, 'i').test(text)) return true;
  if (new RegExp(`${passwordWord}\\s*(?:is|হলো|:|=|-)\\s*\\S{4,}`, 'i').test(text)) return true;
  if (new RegExp(`${passwordWord}\\s+(?=\\S{6,})(?=\\S*[0-9])\\S+`, 'i').test(text)) return true;
  if (/(?:passcode|pin|otp|one[ -]?time code|ওটিপি)\D{0,8}\d{4,8}\b/i.test(text)) return true;
  if (/(?:secret|api[ -]?key|token|গোপন)\s*(?:is|হলো|:|=)\s*\S{4,}/i.test(text)) return true;
  return text.split(/\s+/).some(part => part.length >= 8 && /[a-z]/.test(part) && /[A-Z]/.test(part) && /\d/.test(part) && /[^A-Za-z0-9]/.test(part));
}

export function sanitizeOnboardingContext(value) {
  if (!value || typeof value !== 'object' || value.surface !== 'premium-onboarding') return null;
  const validity = value.validity && typeof value.validity === 'object' ? value.validity : {};
  const cleanInstitution = text => String(text || '').normalize('NFKC').replace(/[\r\n\u0000<>]/g, '').trim().slice(0, 80);
  const institutionQuery = cleanInstitution(value.institutionQuery);
  const institutionSuggestions = Array.isArray(value.institutionSuggestions)
    ? value.institutionSuggestions.slice(0, 3).map(cleanInstitution).filter(Boolean) : [];
  return Object.freeze({
    surface: 'premium-onboarding',
    view: oneOf(value.view, ['welcome','login','forgot','signup','verify','telegram','security-setup','success','signed'], 'welcome'),
    step: oneOf(value.step, ['none','personal','education','security'], 'none'),
    field: oneOf(value.field, ['none','name','email','school','college','date-of-birth','sensitive-field'], 'none'),
    validity: Object.freeze({
      personal: validity.personal === true,
      education: validity.education === true,
      verificationAuthoritative: validity.verificationAuthoritative === true
    }),
    institutionQuery,
    institutionSuggestions: Object.freeze(institutionSuggestions),
    allowedActions: Object.freeze(Array.isArray(value.allowedActions)
      ? value.allowedActions.filter(action => ONBOARDING_ACTIONS.has(action)).slice(0, 12) : [])
  });
}

/* ── User-Context stats sanitize (শুধু প্রদত্ত সংখ্যা; কখনো বানানো নয়) --- */
export function capStats(stats) {
  if (!stats || typeof stats !== 'object') return null;
  const num = (v, min, max) => {
    const n = Number(v);
    if (!isFinite(n) || n < 0) return 0;
    return Math.min(max, Math.round(n));
  };
  const s = {};
  if (stats.exams != null) s.exams = num(stats.exams, 0, 100000);
  if (stats.questions != null) s.questions = num(stats.questions, 0, 1000000);
  if (stats.accuracy != null) s.accuracy = num(stats.accuracy, 0, 100);
  if (stats.streak != null) s.streak = num(stats.streak, 0, 3650);
  if (stats.mistakes != null) s.mistakes = num(stats.mistakes, 0, 100000);
  /* P06 personal learning profile. Academic topic/subject NAMES only, the same
     class of data the profile already carries, never identity. Each row is
     trimmed, de-duplicated and range-checked so a malformed payload cannot
     smuggle prompt structure or a fabricated figure past the model. */
  const name = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
  const pii = (v) => /[\w.+-]+@[\w-]+\.[\w.]+|(?:\+?880|0)1[3-9]\d{8}|\b\d{10,}\b/.test(v);
  const rows = (input, limit) => {
    if (!Array.isArray(input)) return null;
    const seen = new Set();
    const out = [];
    for (const row of input) {
      if (!row || typeof row !== 'object') continue;
      const n = name(row.name, 60);
      if (!n || seen.has(n) || pii(n)) continue;
      seen.add(n);
      out.push({ name: n, attempts: num(row.attempts, 0, 100000), accuracy: num(row.accuracy, 0, 100) });
      if (out.length >= limit) break;
    }
    return out.length ? out : null;
  };
  const weak = rows(stats.weakTopics, 4);
  if (weak) s.weakTopics = weak;
  const subs = rows(stats.subjects, 6);
  if (subs) s.subjects = subs;
  /* This week vs last week, bounded to the same shapes as the lifetime stats. */
  const period = (input) => {
    if (!input || typeof input !== 'object') return null;
    return { exams: num(input.exams, 0, 1000), accuracy: num(input.accuracy, 0, 100) };
  };
  const weekly = period(stats.weekly);
  if (weekly) s.weekly = weekly;
  const prevWeekly = period(stats.prevWeekly);
  if (prevWeekly) s.prevWeekly = prevWeekly;
  return Object.keys(s).length ? s : null;
}

/* ── AI Personalization (blueprint §19-20), per-user, allowlisted, bounded ── */
export const AI_PREFS_DEFAULT = Object.freeze({ langStyle: "bn", tone: "friendly", responseLen: "balanced" });
export function sanitizeAiPrefs(value) {
  if (!value || typeof value !== "object") return null;
  const pick = (v, set, dflt) => (set.has(String(v)) ? String(v) : dflt);
  /* No `memory` field: M7 removed the toggle. Memory is automatic for a signed-in
     student and cannot be switched off from the client. */
  return {
    langStyle: pick(value.langStyle, new Set(["bn", "en", "mix"]), AI_PREFS_DEFAULT.langStyle),
    tone: pick(value.tone, new Set(["friendly", "professional", "simple", "motivating", "direct"]), AI_PREFS_DEFAULT.tone),
    responseLen: pick(value.responseLen, new Set(["short", "balanced", "detailed"]), AI_PREFS_DEFAULT.responseLen)
  };
}

/* ── Student profile context (academic structure only, never PII) ──────────
   Allowlist, not blocklist: any key not named here is dropped, so a hand-built
   request cannot smuggle an identity field into the model. The first name is
   always included for a signed-in student (no setup needed); only a single name
   token is kept, and no other identity field is ever read. */
const PROFILE_TEXT = (value, max) => String(value ?? '').normalize('NFKC').replace(/[\r\n\u0000<>]/g, '').trim().slice(0, max);
export function sanitizeProfileContext(value, opts = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const out = {};

  {
    const firstName = PROFILE_TEXT(value.firstName, 40);
    // A single name token only, never a full name, never any other identity field.
    if (firstName && !/\s/.test(firstName)) out.firstName = firstName;
  }
  const institutionName = PROFILE_TEXT(value.institutionName, 120);
  if (institutionName) out.institutionName = institutionName;
  const institutionType = pickInstitutionType(value.institutionType);
  if (institutionType) out.institutionType = institutionType;
  const district = PROFILE_TEXT(value.district, 60);
  if (district) out.district = district;
  const admissionSession = PROFILE_TEXT(value.admissionSession, 40);
  if (admissionSession) out.admissionSession = admissionSession;
  const academicGoal = PROFILE_TEXT(value.academicGoal, 80);
  if (academicGoal) out.academicGoal = academicGoal;
  if (Array.isArray(value.subjects)) {
    const subjects = value.subjects.slice(0, 10).map(s => PROFILE_TEXT(s, 40)).filter(Boolean);
    if (subjects.length) out.subjects = Array.from(new Set(subjects));
  }
  if (Array.isArray(value.targets) && value.targets.length) {
    const t = value.targets[0] || {};
    const name = PROFILE_TEXT(t.name, 120);
    if (name) out.targets = [{ name, unit: PROFILE_TEXT(t.unit, 40), year: PROFILE_TEXT(t.year, 40) }];
  }
  return Object.keys(out).length ? Object.freeze(out) : null;
}
const pickInstitutionType = value => {
  const v = String(value || '').trim().toLowerCase();
  return ['school', 'college', 'university', 'madrasa', 'other'].includes(v) ? v : '';
};

/* Rich-answer contract. The chat UI renders every construct named here. */
export const RESPONSE_FORMAT_RULES = `RESPONSE FORMAT (the chat app renders Markdown, always use it):
- Answer like a top-tier tutor in a ChatGPT-style layout. Default length is MEDIUM: complete and clear, never padded.
- Open with a one-line direct answer. Then organise with "## " section headings and "### " sub-headings.
- Use **bold** for key terms, ==highlight== for the single most important fact, numbered lists for steps, bullets for points, and "- [ ]" checklists for study tasks.
- Use a Markdown table (header row + |---| separator) whenever comparing two or more things, listing formulas/values/dates, or summarising.
- Use "> " quotes for definitions, laws and rules to memorise.
- Callout lines start with one emoji: 💡 tip, 📌 key point, ⚠️ common mistake, 🧠 concept, 📚 revision, ✅ answer/summary.
- For a process, cycle or sequence add a flow block: a line \`\`\`flow, then one short step per line (2-8 steps, each under 40 characters), then \`\`\`.
- For a numeric comparison add a chart block: \`\`\`chart, then JSON {"type":"bar" or "line","title":"...","labels":[...],"values":[numbers]}, then \`\`\`. Never invent the student's own statistics.
- Put "---" between major parts of a long answer and finish multi-section answers with a short "✅ সারসংক্ষেপ" line.
- Greetings and small talk get a short friendly reply with no headings. If STUDENT PREFERENCES ask for short answers, stay short but keep the Markdown.
- Never mention which AI model, provider or service is answering.`;

/* ── Master System Prompt (মালিক-স্পেক §9) ------------------------------- */
export function buildSystemPrompt(opts = {}) {
  const stats = capStats(opts.stats);
  const examMode = String(opts.examMode || '');
  /* The core prompt text lives in prompt-registry.js (M5) so its id/version are
     recorded and old revisions are never lost. The text is byte-identical to the
     previous inline literal; only its home changed. */
  let p = getPromptText(BASE_PROMPT_ID) || '';
  const onboarding = sanitizeOnboardingContext(opts.onboarding);
  if (onboarding) p += `\n\nONBOARDING ASSISTANT, STRICT MODE:
- Help only with the visible AdmissionSky welcome, signup, login, institution search, and verification journey.
- The current structured context is ${JSON.stringify(onboarding)}.
- Never ask for, repeat, infer, transform, store, or validate a password, confirm-password value, OTP, session value, key, secret, or credential.
- Never claim signup, delivery, verification, Passkey creation, login, or profile saving succeeded. Only the application's confirmed state can show success.
- Respond with student-friendly Bengali and never expose technical infrastructure words such as backend, API, provider, token, webhook, SMTP, quota, or database.
- You return explanation text only. You cannot execute actions or emit JavaScript, selectors, commands, or tool calls. The interface alone may offer its predefined safe actions.
- Never submit forms or trigger signup, delivery, verification, login, profile-save, or security actions. Any critical action requires the student's explicit confirmation in the interface and the application's confirmed result.
- If field is sensitive-field, discuss only general safety and never ask what is typed there.
- Institution suggestions are advisory and limited to the exact supplied names; if no match, explain the manual-name option.`;
  if (examMode === 'mock-running') p += `\n\nEXAM INTEGRITY, ACTIVE (mock-running): answers, hints and explanations are REFUSED.`;
  if (opts.quiz) p += `\n\nQUIZ MODE, reply with ONLY a valid JSON object (no markdown fences, no text outside JSON):\n{"title":"<short topic title>","questions":[{"q":"<question>","options":["<A>","<B>","<C>","<D>"],"answer":0,"explanation":"<1-2 sentence Bangla explanation of the answer>"}]}\nRules: exactly 5 questions (or the count the user asked, 1-10); admission-level quality; answer is the 0-based index of the correct option; question/options/explanation in the user's language (Bangla unless the user wrote English); 4 options each.`;
  const prefs = sanitizeAiPrefs(opts.prefs);
  if (prefs) {
    const langLine = prefs.langStyle === "en"
      ? "Reply in English."
      : prefs.langStyle === "mix"
        ? "Reply in a natural mix of Bangla and English (code-mixing is fine)."
        : "Reply in Bangla (Bangla script).";
    const toneLine = {
      friendly: "Keep a warm, encouraging, friendly tone.",
      professional: "Keep a professional, precise tone.",
      simple: "Use the simplest possible words and short sentences.",
      motivating: "Keep an uplifting, motivating tone; encourage the student.",
      direct: "Be direct and to the point; no small talk."
    }[prefs.tone];
    const lenLine = prefs.responseLen === "short"
      ? "Keep answers short (2-4 sentences unless the student asks for more)."
      : prefs.responseLen === "detailed"
        ? "Give detailed, well-structured answers with examples when useful."
        : "Keep answers balanced: enough detail, no padding.";
    p += `\n\nSTUDENT PREFERENCES (এই ব্যবহারকারীর নিজস্ব পছন্দ, অন্য কারাংশে প্রয়োগ করো না): ${langLine} ${toneLine} ${lenLine}`;
  }
  if (stats) {
    const bits = [];
    if (stats.exams != null) bits.push(`মোট পরীক্ষা: ${stats.exams}`);
    if (stats.questions != null) bits.push(`মোট প্রশ্ন: ${stats.questions}`);
    if (stats.accuracy != null) bits.push(`একুরেসি: ${stats.accuracy}%`);
    if (stats.streak != null) bits.push(`স্ট্রিক: ${stats.streak} দিন`);
    if (stats.mistakes != null) bits.push(`ভুল-তালিকা: ${stats.mistakes}টা`);
    if (bits.length) p += `\n\nUSER STATS (শুধু এই প্রদত্ত সংখ্যা ব্যবহার করো, এগুলোর বাইরে কোনো সংখ্যা বানাবে না): ${bits.join(' · ')}.`;
    /* P06 learning profile: where the student is weak, so the tutor can guide
       revision instead of giving a generic answer. Names/figures come straight
       from the student's own results and are never invented. */
    const fmtRows = (list) => list.filter(Boolean).map(x => `${x.name} (${x.accuracy}%, ${x.attempts}টা)`);
    if (Array.isArray(stats.weakTopics) && stats.weakTopics.length) {
      p += `\n\nLEARNING PROFILE, দুর্বল টপিক (শিক্ষার্থীর নিজের ফলাফল থেকে): ${fmtRows(stats.weakTopics).join(' · ')}.
- শিক্ষার্থী এসব টপিক নিয়ে জিজ্ঞেস করলে, বা সাধারণভাবে কী পড়বে জানতে চাইলে, এই দুর্বল টপিকগুলো অগ্রাধিকার দাও।
- সংখ্যা কখনো বানাবে না; শুধু উপরের দেওয়া টপিক ও পার্সেন্ট ব্যবহার করো। শিক্ষার্থীকে বলো কেন দুর্বল এবং কীভাবে ঠিক করবে।`;
    }
    if (Array.isArray(stats.subjects) && stats.subjects.length) {
      p += `\n\nSUBJECT ACCURACY (প্রদত্ত): ${fmtRows(stats.subjects).join(' · ')}.`;
    }
    /* The ready-made revision line. Offered, not forced: the model weaves it in
       when the student asks what to study or how to improve, and stays silent
       about it otherwise. */
    const rec = buildStudyRecommendation(stats, { langStyle: prefs && prefs.langStyle });
    if (rec) p += `\n\nSTUDY RECOMMENDATION (শিক্ষার্থী কী পড়বে জানতে চাইলে এই লাইনটি স্বাভাবিকভাবে ব্যবহার করো): ${rec}`;
  }
  return p;
}

/* ── P06: study recommendation (deterministic, from the student's own data) ──
   Turns the sanitized weak-topic rows into one actionable revision line. Pure
   (no env, no model, no I/O) so it is unit-testable and reusable by the chat UI.
   Returns null when the student has no measured weak topic yet, the tutor then
   gives its normal answer instead of inventing a plan. */
export function buildStudyRecommendation(stats, opts = {}) {
  const s = capStats(stats);
  const en = opts.langStyle === 'en';
  const improvement = buildImprovementLine(s, { langStyle: opts.langStyle });
  if (!s || !Array.isArray(s.weakTopics) || !s.weakTopics.length) return improvement || null;
  const list = s.weakTopics.slice(0, 3).map(t => `${t.name} (${t.accuracy}%)`).join(', ');
  const lead = en
    ? `Your revision priority right now: ${list}.`
    : `এখন রিভিশনে সবচেয়ে জরুরি: ${list}।`;
  const tip = en
    ? 'Practise these with a few MCQs daily, then re-test after a day to confirm the gap is closing.'
    : 'প্রতিদিন অল্প কিছু MCQ দিয়ে এগুলোর অনুশীলন করো, এক দিন পর আবার পরীক্ষা দিয়ে দেখো দুর্বলতা কমছে কি না।';
  return [improvement, `${lead} ${tip}`].filter(Boolean).join(' ');
}

/* ── P06: improvement line (this week vs last week) ────────────────────────
   A single honest sentence about direction of travel, or null when there is not
   enough recent activity to say anything. Deterministic and pure. */
export function buildImprovementLine(stats, opts = {}) {
  const s = capStats(stats);
  if (!s || !s.weekly || !s.weekly.exams) return null;
  const en = opts.langStyle === 'en';
  const cur = s.weekly;
  const prev = s.prevWeekly;
  if (!prev || !prev.exams) {
    return en
      ? `This week: ${cur.exams} exam(s) at ${cur.accuracy}% accuracy.`
      : `এই সপ্তাহে: ${cur.exams}টি পরীক্ষা, একুরেসি ${cur.accuracy}%।`;
  }
  const delta = cur.accuracy - prev.accuracy;
  if (delta >= 3) {
    return en
      ? `You improved this week: ${prev.accuracy}% → ${cur.accuracy}% (up ${delta} points). Nice work, keep going.`
      : `এই সপ্তাহে উন্নতি হয়েছে: গত সপ্তাহে ${prev.accuracy}% → এখন ${cur.accuracy}% (${delta} পয়েন্ট বেশি)। ভালো করছো, চালিয়ে যাও।`;
  }
  if (delta <= -3) {
    return en
      ? `Your accuracy dipped this week: ${prev.accuracy}% → ${cur.accuracy}% (down ${Math.abs(delta)} points). Slow down and revise the basics before the next test.`
      : `এই সপ্তাহে একুরেসি একটু কমেছে: গত সপ্তাহে ${prev.accuracy}% → এখন ${cur.accuracy}% (${Math.abs(delta)} পয়েন্ট কম)। পরের পরীক্ষার আগে বেসিকটা আরেকবার দেখে নাও।`;
  }
  return en
    ? `Steady this week: ${prev.accuracy}% → ${cur.accuracy}% accuracy. Push a little harder to move it up.`
    : `এই সপ্তাহে প্রায় একই রকম: গত সপ্তাহে ${prev.accuracy}% → এখন ${cur.accuracy}%। একটু বেশি চেষ্টা করলে বাড়বে।`;
}

/* ── Conversation Memory: summarize (short/session 2-layer) -------------- */
export function summarizeTo(messages, maxTurns = 6, maxChars = 900) {
  const msgs = Array.isArray(messages) ? messages.slice(0, -maxTurns) : [];
  // যারা 'অতিরিক্ত' (লেজ বাদ), সেগুলোকে সংক্ষেপ
  if (!msgs.length) return '';
  let out = 'পূর্বের কথোপকথন (সংক্ষেপ):\n';
  for (const m of msgs) {
    const who = m.role === 'user' ? 'শিক্ষার্থী' : 'AI';
    const txt = String(m.content || '').replace(/\s+/g, ' ').trim().slice(0, 90);
    if (!txt) continue;
    out += `- ${who}: ${txt}\n`;
  }
  return out.length > maxChars ? out.slice(0, maxChars) + '…' : out;
}

/* ── Provider Adapters (model-independent interface) --------------------- */
/* Live-progress labels for the understood intent (shown in the chat card). */
const STAGE_UNDERSTAND = {
  GENERAL_CHAT: 'তোমার কথাটা বুঝে নিচ্ছি',
  ACADEMIC_EXPLAIN: 'প্রশ্নটা বুঝছি, ব্যাখ্যা তৈরি করব',
  PERFORMANCE_REQUEST: 'তোমার পারফরম্যান্সের প্রশ্ন বুঝছি',
  QUIZ_REQUEST: 'কুইজের অনুরোধ বুঝছি',
  SEARCH_REQUEST: 'কী খুঁজছ বুঝে নিচ্ছি',
  IMAGE_REQUEST: 'ছবির প্রশ্ন বুঝছি'
};

/* A provider that has not produced its first token within `ms` is skipped so a
   stalled endpoint can never hold the student's answer hostage. */
export async function* firstChunkGuard(iterable, ms) {
  const it = iterable[Symbol.asyncIterator]();
  let timer;
  let first;
  try {
    first = await Promise.race([
      it.next(),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new ProviderError('first-chunk-timeout', { retryable: true, bad: false })), ms); })
    ]);
  } catch (e) {
    try { const r = it.return && it.return(); if (r && r.catch) r.catch(() => {}); } catch (_) {}
    throw e;
  } finally { clearTimeout(timer); }
  if (first.done) return;
  yield first.value;
  while (true) { const n = await it.next(); if (n.done) return; yield n.value; }
}

export class ProviderError extends Error {
  constructor(message, opts = {}) {
    super(message);
    this.retryable = !!opts.retryable;
    this.bad = !!opts.bad; /* এই key/model আজ আর চেষ্টা করবে না (401/402/429/5xx) */
    /* P28: the HTTP status, so the catch site can tell a transient 5xx (short
       cooldown) from a revoked key (day-long ban) instead of treating both as an
       equally permanent failure. */
    this.status = Number(opts.status) || 0;
  }
}

const GEMINI_MODELS = {
  FAST: 'gemini-3.1-flash-lite',
  SMART: 'gemini-3-flash-preview'
};

export function sseParse(raw) {
  /* "data: {...}\n\n" → {...} | null */
  const out = [];
  for (const line of String(raw || '').split('\n')) {
    const s = line.trim();
    if (!s.startsWith('data:')) continue;
    const json = s.slice(5).trim();
    if (!json || json === '[DONE]') continue;
    try { out.push(JSON.parse(json)); } catch (_) { /* অবৈধ-টুকরা বাদ */ }
  }
  return out;
}

export function geminiTextFromChunk(chunk) {
  let t = '';
  for (const c of chunk.candidates || []) {
    for (const p of c.content && c.content.parts || []) {
      if (p.text) t += p.text;
      else if (p.inlineData) t += ' [image-data omitted]';
    }
  }
  return t;
}

export async function* geminiStream(key, model, payload, signal) {
  if (!key) throw new ProviderError('gemini-key-না', { retryable: false });
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${encodeURIComponent(key)}`;
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal
  });
  if (!r.ok || !r.body) {
    const bad = r.status === 401 || r.status === 402 || r.status === 403 || r.status === 429 || r.status >= 500;
    throw new ProviderError(`Gemini HTTP ${r.status} (${model})`, { retryable: r.status >= 500 || r.status === 429, bad, status: r.status });
  }
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const chunks = buf.split('\n\n');
    buf = chunks.pop() || '';
    for (const ch of chunks) {
      for (const j of sseParse(ch)) {
        const t = geminiTextFromChunk(j);
        if (t) yield t;
        if (j.candidates && j.candidates[0] && j.candidates[0].finishReason) return;
      }
    }
  }
  for (const j of sseParse(buf)) {
    const t = geminiTextFromChunk(j);
    if (t) yield t;
  }
}

export async function* groqStream(key, model, payload, signal) {
  if (!key) throw new ProviderError('groq-key-না', { retryable: false });
  const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
    body: JSON.stringify({ ...payload, model, stream: true }),
    signal
  });
  if (!r.ok || !r.body) {
    const bad = r.status === 401 || r.status === 402 || r.status === 403 || r.status === 429 || r.status >= 500;
    throw new ProviderError(`Groq HTTP ${r.status} (${model})`, { retryable: r.status >= 500 || r.status === 429, bad, status: r.status });
  }
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() || '';
    for (const line of lines) {
      const s = line.trim();
      if (!s.startsWith('data:')) continue;
      const j = s.slice(5).trim();
      if (j === '[DONE]') return;
      try {
        const d = JSON.parse(j);
        const delta = d.choices && d.choices[0] && d.choices[0].delta && d.choices[0].delta.content;
        if (delta) yield delta;
      } catch (_) { /* অবৈধ-টুকরা বাদ */ }
    }
  }
}

/* ── Provider Adapters: normalized interface (Phase 9 §6, migration M2) ---
   Adapter contract:
     id           stable provider id, used in logs and bad-set keys
     matches(e)   can this adapter serve this chain entry?
     oneShot      true when a non-streaming completion path exists
     chatOnce(e,payload)    one-shot completion → text
     chatStream(e,payload)  async iterator of text deltas

   The orchestrator keeps owning the payload builders (it knows whether an
   image is attached, and Gemini/Groq need different shapes: native parts vs
   messages), and keeps owning the retry/bad-mark loop. Adapters only own the
   provider-specific call. URLs, headers, status handling and error wording are
   unchanged from before this step, structure only.
------------------------------------------------------------------------ */
function geminiEndpoint(model, action, key) {
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:${action}?key=${encodeURIComponent(key)}`;
}

function geminiFirstText(d) {
  return String(
    d.candidates && d.candidates[0] && d.candidates[0].content && d.candidates[0].content.parts &&
      d.candidates[0].content.parts.map(x => x.text || '').join('') || ''
  ).trim();
}

export const GEMINI_ADAPTER = {
  id: 'gemini',
  matches: (entry) => entry.provider === 'gemini',
  oneShot: true,
  async chatOnce(entry, payload) {
    const r = await fetch(geminiEndpoint(entry.model, 'generateContent', entry.key), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!r.ok) {
      const bad = r.status === 401 || r.status === 402 || r.status === 403 || r.status === 429 || r.status >= 500;
      throw new ProviderError(`Gemini HTTP ${r.status} (${entry.model})`, { retryable: r.status >= 500 || r.status === 429, bad, status: r.status });
    }
    return geminiFirstText(await r.json().catch(() => ({})));
  },
  chatStream: (entry, payload) => geminiStream(entry.key, entry.model, payload)
};

export const GROQ_ADAPTER = {
  id: 'groq',
  matches: (entry) => entry.provider === 'groq',
  /* Groq is stream-only here: the non-stream route has always been Gemini-only,
     and adding a Groq one-shot path would change behaviour (M2 forbids that).
     Fail honestly instead of inventing a fallback. */
  oneShot: false,
  async chatOnce() {
    throw new ProviderError('groq-এ non-stream পথ এখনো নেই', { retryable: false, bad: false });
  },
  chatStream: (entry, payload) => groqStream(entry.key, entry.model, payload)
};

/* ── generic OpenAI-compatible streaming helper (Phase 9 M2.5) ------------
   Providers that speak the OpenAI chat-completions wire format (Cloudflare
   Workers AI, and later OpenRouter / GitHub Models / Mistral / Cerebras /
   NVIDIA) share one stream reader. Keeping it here means adding the next such
   provider is a URL + model list, not another copy-pasted reader.
------------------------------------------------------------------------ */
async function* openAiCompatStream({ url, key, model, payload, signal }) {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: 'Bearer ' + key } : {}) },
    body: JSON.stringify({ ...payload, model, stream: true }),
    signal
  });
  if (!r.ok || !r.body) {
    const bad = r.status === 401 || r.status === 402 || r.status === 403 || r.status === 429 || r.status >= 500;
    throw new ProviderError(`OpenAI-compat HTTP ${r.status} (${model})`, { retryable: r.status >= 500 || r.status === 429, bad, status: r.status });
  }
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() || '';
    for (const line of lines) {
      const s = line.trim();
      if (!s.startsWith('data:')) continue;
      const j = s.slice(5).trim();
      if (j === '[DONE]') return;
      try {
        const d = JSON.parse(j);
        const delta = d.choices && d.choices[0] && d.choices[0].delta && d.choices[0].delta.content;
        if (delta) yield delta;
      } catch (_) { /* অবৈধ-টুকরা বাদ */ }
    }
  }
}

/* Cloudflare Workers AI, free 10,000 Neurons/day, runs on the same edge as the
   worker, so it is the cheapest backup to reach. It authenticates with
   account id + API token (the env.AI binding is not threaded through agentChat,
   so this stays a plain fetch adapter like the others). */
export const CLOUDFLARE_ADAPTER = {
  id: 'cloudflare',
  matches: (entry) => entry.provider === 'cloudflare',
  oneShot: false,
  async chatOnce() {
    throw new ProviderError('cloudflare-এ non-stream পথ এখনো নেই', { retryable: false, bad: false });
  },
  chatStream(entry, payload, env) {
    const account = String(env?.CLOUDFLARE_ACCOUNT_ID || '').trim();
    const key = entry.key || String(env?.CLOUDFLARE_AI_API_KEY || '').trim();
    const url = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(account)}/ai/v1/chat/completions`;
    return openAiCompatStream({ url, key, model: entry.model, payload });
  }
};

/* Extra OpenAI-compatible providers (OpenRouter, GitHub Models, Mistral,
   Cerebras, …). One adapter covers them all because they share the wire format;
   a provider is described by data (url + model list), not by a new reader. */
export const OPENAI_COMPAT_ADAPTER = {
  id: 'openai-compat',
  matches: (entry) => entry.provider === 'openai-compat',
  oneShot: false,
  async chatOnce() {
    throw new ProviderError('openai-compat-এ non-stream পথ এখনো নেই', { retryable: false, bad: false });
  },
  chatStream(entry, payload) {
    return openAiCompatStream({ url: entry.url, key: entry.key, model: entry.model, payload });
  }
};

export const PROVIDER_ADAPTERS = [GEMINI_ADAPTER, GROQ_ADAPTER, CLOUDFLARE_ADAPTER, OPENAI_COMPAT_ADAPTER];

export function adapterFor(entry) {
  return PROVIDER_ADAPTERS.find(a => a.matches(entry)) || null;
}

/* Chain for the non-streaming route: the router chain restricted to adapters
   that actually have a one-shot path (Gemini today). Unknown providers are
   dropped rather than dispatched to a missing adapter. */
export function providerChain(env, tier = 'FAST', badSet = new Set(), kv = {}) {
  return routerChain(env, tier, badSet, kv).filter(c => {
    const adapter = adapterFor(c);
    return Boolean(adapter) && adapter.oneShot === true;
  });
}

/* ── Model Router (basic): intent-tier → provider-chain ------------------ */
/* OpenAI-compatible providers the router can reach when a key exists. Each is
   data only, a URL plus a default model, because they share one stream reader.
   A `<NAME>_MODELS` value (env or KV) overrides the default list. */
const COMPAT_PROVIDERS = [
  /* openai/gpt-4o-mini is a PAID OpenRouter model ($0.15/M input, checked
     2026-10-16): with no credit it answers 402, with credit it spends money.
     Default to free (`:free`) models; OPENROUTER_API_KEYS_MODELS overrides. */
  { key: 'OPENROUTER_API_KEYS', url: 'https://openrouter.ai/api/v1/chat/completions', models: ['google/gemma-4-31b-it:free'] },
  /* Vercel AI Gateway is an OpenAI-compatible front door to many models; the
   * free tier serves openai/gpt-4o-mini. Its 400 floor on max_output_tokens is
   * satisfied by the agent core's normal token budget. */
  { key: 'VERCEL_AI_GATEWAY_KEY', url: 'https://ai-gateway.vercel.sh/v1/chat/completions', models: ['openai/gpt-4o-mini'] },
  { key: 'GITHUB_MODELS_TOKEN', url: 'https://models.github.ai/inference/chat/completions', models: ['openai/gpt-4o-mini'] },
  /* mistral-small-latest is a paid-plan model and answers 429 on the free tier;
   * ministral-14b-latest is served to free accounts. */
  { key: 'MISTRAL_API_KEYS', url: 'https://api.mistral.ai/v1/chat/completions', models: ['ministral-14b-latest'] },
  { key: 'CEREBRAS_API_KEYS', url: 'https://api.cerebras.ai/v1/chat/completions', models: ['llama-3.3-70b'] },
  { key: 'SAMBANOVA_API_KEYS', url: 'https://api.sambanova.ai/v1/chat/completions', models: ['Meta-Llama-3.3-70B-Instruct'] },
  { key: 'COHERE_API_KEYS', url: 'https://api.cohere.ai/compatibility/v1/chat/completions', models: ['command-r7b-12-2024'] },
  { key: 'HUGGINGFACE_API_KEYS', url: 'https://router.huggingface.co/v1/chat/completions', models: ['meta-llama/Llama-3.3-70B-Instruct'] },
  { key: 'DEEPINFRA_API_KEYS', url: 'https://api.deepinfra.com/v1/openai/chat/completions', models: ['meta-llama/Meta-Llama-3.1-70B-Instruct'] },
  { key: 'TOGETHER_API_KEYS', url: 'https://api.together.xyz/v1/chat/completions', models: ['meta-llama/Llama-3.3-70B-Instruct-Turbo'] },
  { key: 'KIMI_API_KEYS', url: 'https://api.moonshot.ai/v1/chat/completions', models: ['moonshot-v1-8k'] },
  { key: 'AIML_API_KEYS', url: 'https://api.aimlapi.com/v1/chat/completions', models: ['gpt-4o-mini'] },
  { key: 'LLM7_API_KEYS', url: 'https://api.llm7.io/v1/chat/completions', models: ['gpt-4o-mini'] },
  { key: 'SILICONFLOW_API_KEYS', url: 'https://api.siliconflow.cn/v1/chat/completions', models: ['Qwen/Qwen2.5-7B-Instruct'] },
  { key: 'STEPFUN_API_KEYS', url: 'https://api.stepfun.ai/v1/chat/completions', models: ['step-1-8k'] },
  /* MiniMax does not expose /chat/completions; its OpenAI-shaped path is
     /text/chatcompletion_v2, which this adapter can drive unchanged. */
  { key: 'MINIMAX_API_KEYS', url: 'https://api.minimax.chat/v1/text/chatcompletion_v2', models: ['abab6.5s-chat'] }
];

/* Provider keys that live in KV rather than as Worker variables. The Workers Free
   plan caps a Worker at 64 variables and admission-gk sits on that cap, so a new
   key cannot be bound with `wrangler secret put`. GK_KV and PUB_KV are the same
   namespace, so a key the voice agent already stored is visible here too.

   Two paths, both needing no new variable:
   - `secret:AI_KEYS`, one JSON object of name→value, read in a single KV get.
     This is the path to use for OpenRouter and anything added later.
   - `secret:<NAME>`, one entry per name, which is what the voice workflow
     writes; GROQ_API_KEY is picked up from there automatically.
   `AI_KV_KEY_NAMES` overrides the name list only if an operator wants to. */
const AI_KV_JSON_KEY = 'secret:AI_KEYS';
const AI_KV_NAME_DEFAULTS = ['GROQ_API_KEY'];

export async function aiKeyOverlay(env) {
  const out = {};
  try {
    const raw = await env.PUB_KV.get(AI_KV_JSON_KEY);
    const j = raw ? JSON.parse(raw) : null;
    if (j && typeof j === 'object') {
      for (const [k, v] of Object.entries(j)) if (v && String(v).trim()) out[k] = String(v).trim();
    }
  } catch (_) { /* absent or malformed blob is simply no keys */ }
  const declared = String(env?.AI_KV_KEY_NAMES || '').split(',').map(s => s.trim()).filter(Boolean);
  for (const name of (declared.length ? declared : AI_KV_NAME_DEFAULTS)) {
    if (out[name]) continue;
    try {
      const v = await env.PUB_KV.get('secret:' + name);
      if (v && String(v).trim()) out[name] = String(v).trim();
    } catch (_) { /* KV miss is simply an absent key */ }
  }
  return out;
}

/* A key from KV wins over the env one only when the env slot is empty, so an
   operator can always override from the dashboard without touching KV. */
const pickKey = (env, kv, name) => String((env && env[name]) || kv[name] || '').trim();

/* Which providers this Worker can actually reach, by NAME only — never the keys,
   never a length, never a prefix. F0.1 step 4h needs this because chat can now be
   answered by two different Workers: admission-gk forwards the list it can reach,
   and sky-ai REFUSES to answer if it is missing any of them. Without that check a
   room with fewer keys would answer every request with a weaker free model and
   nobody would notice anything except slower, worse replies.

   One definition, used by both sides, so the two lists are comparable by
   construction rather than by careful maintenance. */
/* Every credential name a provider can come from, in one list. Used by
   providerReadiness() and by the env→KV sync (ai-key-sync.mjs), so a provider can
   never be "known to the router" but unknown to the sync. */
export const PROVIDER_KEY_NAMES = Object.freeze([
  'GEMINI_KEYS',
  'GROQ_API_KEY',
  'CLOUDFLARE_ACCOUNT_ID',
  'CLOUDFLARE_AI_API_KEY',
  ...COMPAT_PROVIDERS.map((p) => p.key)
]);

/* The SHAPE of the credential blob, never its contents: is it there, how many
   names does it hold, and which of them are providers we know. Added because a
   parity mismatch alone cannot say whether a room is missing a credential or
   missing the whole file — and the difference decides the fix.
   Returns no value, no length, no prefix. */
export async function aiKeyBlobShape(env) {
  const kv = env && env.PUB_KV;
  if (!kv || typeof kv.get !== 'function') return { present: false, reason: 'no-kv' };
  let raw = null;
  try { raw = await kv.get(AI_KV_JSON_KEY); } catch (_) { return { present: false, reason: 'read-failed' }; }
  if (!raw) return { present: false, reason: 'absent' };
  let parsed = null;
  try { parsed = JSON.parse(raw); } catch (_) { return { present: true, reason: 'unparseable' }; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { present: true, reason: 'not-an-object' };
  const names = Object.keys(parsed).filter((k) => parsed[k] && String(parsed[k]).trim());
  return {
    present: true,
    count: names.length,
    providers: names.filter((k) => PROVIDER_KEY_NAMES.includes(k)).sort()
  };
}

export async function providerReadiness(env) {
  const kv = await aiKeyOverlay(env);
  const has = (name) => !!pickKey(env, kv, name);
  const out = {
    gemini: has('GEMINI_KEYS'),
    groq: has('GROQ_API_KEY'),
    cloudflare: has('CLOUDFLARE_ACCOUNT_ID') && has('CLOUDFLARE_AI_API_KEY')
  };
  for (const p of COMPAT_PROVIDERS) {
    // Name it after the key so a comma-separated list of ready providers stays short.
    out[p.key.toLowerCase().replace(/_api_keys?$|_key$|_token$/, '')] = has(p.key);
  }
  return out;
}

/* Only the names that are ready, in a stable order, for the header that crosses
   the service binding. */
export function readyProviderNames(readiness) {
  return Object.keys(readiness || {}).filter((k) => readiness[k]).sort();
}

export function routerChain(env, tier, badSet = new Set(), kv = {}) {
  const geminiModels = String(env && env.AGENT_GEMINI_MODELS || '')
    .split(',').map(s => s.trim()).filter(Boolean);
  const chain = [];
  const addGem = (m) => {
    if (!m) return;
    const k = String(pickKey(env, kv, 'GEMINI_KEYS') || '').split(',').map(s => s.trim()).filter(Boolean);
    for (const key of k) {
      const sig = String(key).slice(0, 12) + ':' + m;
      if (badSet.has(sig)) continue;
      chain.push({ provider: 'gemini', key, model: m });
    }
  };
  if (geminiModels.length) geminiModels.forEach(addGem);
  else {
    const first = tier === TIER.SMART ? GEMINI_MODELS.SMART : GEMINI_MODELS.FAST;
    const second = tier === TIER.SMART ? GEMINI_MODELS.FAST : GEMINI_MODELS.SMART;
    addGem(first); addGem(second);
  }
  const groqKey = pickKey(env, kv, 'GROQ_API_KEY');
  if (groqKey) {
    /* Groq retired the llama-3.x lineup; both of these used to be here and now
       answer 404 model_not_found, which the chain treated as a transient
       failure and retried on every request. The gpt-oss models are the current
       free-tier text models. AGENT_GROQ_MODELS overrides this list. */
    const groqModels = String((env && env.AGENT_GROQ_MODELS) || kv.AGENT_GROQ_MODELS || '')
      .split(',').map(s => s.trim()).filter(Boolean);
    for (const m of (groqModels.length ? groqModels : ['openai/gpt-oss-120b', 'openai/gpt-oss-20b'])) {
      chain.push({ provider: 'groq', key: groqKey, model: m });
    }
  }
  /* Cloudflare Workers AI backup (Phase 9 M2.5). Needs both the account id and
     an API token; either missing means the slot is simply absent, exactly like
     a missing GEMINI_KEYS/GROQ_API_KEY. Model list is overridable because
     Cloudflare rotates its catalogue. */
  const cfAccount = pickKey(env, kv, 'CLOUDFLARE_ACCOUNT_ID');
  const cfKey = pickKey(env, kv, 'CLOUDFLARE_AI_API_KEY');
  if (cfAccount && cfKey) {
    const cfModels = String((env && env.AGENT_CLOUDFLARE_MODELS) || kv.AGENT_CLOUDFLARE_MODELS || '')
      .split(',').map(s => s.trim()).filter(Boolean);
    const list = cfModels.length ? cfModels : ['@cf/meta/llama-3.3-70b-instruct-fp8-fast'];
    for (const m of list) chain.push({ provider: 'cloudflare', key: cfKey, model: m });
  }
  /* Extra OpenAI-compatible providers, each appears only when its key exists.
     A comma-separated value yields one chain entry per key, the same shape
     GEMINI_KEYS already uses, so a second key for a provider is rotated to
     instead of being sent verbatim as a single invalid credential. */
  for (const p of COMPAT_PROVIDERS) {
    const keys = String(pickKey(env, kv, p.key) || '').split(',').map(s => s.trim()).filter(Boolean);
    if (!keys.length) continue;
    const models = String((env && env[p.key + '_MODELS']) || kv[p.key + '_MODELS'] || '')
      .split(',').map(s => s.trim()).filter(Boolean);
    for (const key of keys) {
      for (const m of (models.length ? models : p.models)) {
        const sig = String(key).slice(0, 12) + ':' + m;
        if (badSet.has(sig)) continue;
        chain.push({ provider: 'openai-compat', key, model: m, url: p.url });
      }
    }
  }
  return chain;
}

/* ── helpers: KV (best-effort) -------------------------------------------- */
const dayKey = () => new Date().toISOString().slice(0, 10);
/* Rolling quota window: a student gets `cap` messages, then `cap` more 24h after
   their first message of the window, not at UTC midnight (which lands mid-morning
   in Dhaka and would hand out a second allowance early). */
const RL_WINDOW_MS = 24 * 60 * 60 * 1000;
/* Owner 2026-10-17: official, kind daily-limit wording with the real reset time. */
export function limitMessage(cap, resetAt, now) {
  const bn = (s) => String(s).replace(/[0-9]/g, (d) => '০১২৩৪৫৬৭৮৯'[d]);
  const left = Math.max(1, Math.round((Number(resetAt) - Number(now)) / 60000));
  const h = Math.floor(left / 60), m = left % 60;
  const span = ((h ? bn(h) + ' ঘণ্টা ' : '') + (m ? bn(m) + ' মিনিট' : '')).trim();
  let clock = '';
  try { clock = new Date(Number(resetAt)).toLocaleTimeString('bn-BD', { timeZone: 'Asia/Dhaka', hour: 'numeric', minute: '2-digit' }); } catch (_) { clock = ''; }
  return 'আজকের জন্য তোমার ' + bn(cap) + 'টি AI প্রশ্নের সুযোগ ব্যবহার করা হয়ে গেছে। পরবর্তী সুযোগ চালু হবে '
    + (clock ? 'বাংলাদেশ সময় ' + clock + '-এ, ' : '') + 'আর প্রায় ' + span + ' পর। তখন আমি আবার তোমার প্রশ্নের উত্তর দেবো।';
}
/* AI audit 2026-10-16: the short-term conversation memory and its rolling
   summary expire after 180 idle days instead of living forever. Every new
   message rewrites them, so an active student never notices. */
export const CHAT_MEMORY_TTL_MS = 180 * 24 * 60 * 60 * 1000;
export function readQuota(raw, now) {
  let n = 0, start = now;
  if (raw !== null && raw !== undefined && raw !== '') {
    let parsed;
    try { parsed = JSON.parse(raw); } catch (_) { parsed = raw; }
    if (parsed && typeof parsed === 'object') {
      n = Math.max(0, Number(parsed.n) || 0);
      start = Number(parsed.start) || now;
    } else {
      n = Math.max(0, Number(parsed) || 0);
    }
  }
  if (now - start >= RL_WINDOW_MS) { n = 0; start = now; }
  return { n, start };
}
const getKv = async (kv, key) => { try { return await kv.get(key); } catch (_) { return null; } };
const putKv = async (kv, key, val, ttl) => { try { await kv.put(key, val, ttl ? { expirationTtl: ttl } : undefined); } catch (_) {} };
const badKeyName = (key, model) => 'aibad:' + String(key).slice(0, 12) + ':' + model + ':' + dayKey();

/* P28: record a failed chain entry with the cooldown its status earns. A 5xx is
   transient and clears in minutes; a bad credential keeps the long ban. A status
   with no cooldown (4xx other than 401/402/403/429) is not remembered at all -
   it would otherwise be retried forever against a request-shaped error. */
const markEntryFailed = async (kv, key, model, status) => {
  const marker = failureMarker(status, Date.now());
  if (!marker) return;
  const until = Number(JSON.parse(marker).until) || 0;
  const ttl = Math.max(60, Math.round((until - Date.now()) / 1000));
  await putKv(kv, badKeyName(key, model), marker, ttl);
};

/* ── নিরাপদ-টেক্সট আউটপুট: লজিক-গার্ড (safety) ---------------------------- */
export function safetyGate(intent, examMode) {
  if (examMode === 'mock-running' && (intent === INTENTS.ACADEMIC_EXPLAIN || intent === INTENTS.QUIZ_REQUEST)) {
    return { blocked: true, message: 'মক-পরীক্ষা চলছে, এখানে উত্তর বা হিন্ট দেওয়া হয় না। পরীক্ষা শেষ হলে সম্পূর্ণ বিশ্লেষণ পাবে।' };
  }
  return { blocked: false };
}

export function authVerificationGuidance(text) {
  const input = String(text || '').trim();
  const verificationTopic = /(telegram|টেলিগ্রাম|\botp\b|ওটিপি|one[ -]?time code|verification code|যাচাই(?:য়ের)? কোড)/i.test(input);
  const possibleBareOtp = /^\D*\d{6}\D*$/.test(input);
  if (!verificationTopic && !possibleBareOtp) return '';
  return 'Telegram যাচাই করতে AdmissionSky-এ “Telegram দিয়ে যাচাই করুন” চাপুন, official bot খুলে START চাপুন, তারপর bot-এর পাঠানো কোডটি শুধু AdmissionSky-এর verification box-এ লিখুন। আমি OTP তৈরি, অনুমান, দেখা, পুনরাবৃত্তি বা যাচাই করতে পারি না এবং verification সফলও ঘোষণা করতে পারি না, শুধু AdmissionSky-এর নিশ্চিত ফলই চূড়ান্ত। Telegram যাচাই Gmail/ইমেইল মালিকানা প্রমাণ করে না।';
}

function guidanceResponse(text, stream, request = null) {
  if (!stream) return jsonResp({ text, intent: INTENTS.GENERAL_CHAT, pv: SYSTEM_PROMPT_V, agent: AGENT_VERSION, authoritative: false }, 200, request);
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text })}\n\n`));
      controller.enqueue(encoder.encode(`event: done\ndata: ${JSON.stringify({ intent: INTENTS.GENERAL_CHAT, pv: SYSTEM_PROMPT_V, agent: AGENT_VERSION, authoritative: false })}\n\n`));
      controller.close();
    }
  }), {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', ...corsHeaders(request) }
  });
}

/* ── AI Gateway handler: POST /api/ai/chat (stream ফ্লো) ------------------ */
export async function agentChat(request, env, uid, opts = {}) {
  const stream = opts && opts.stream !== false;
  const persistMemory = opts?.persistMemory !== false;
  const startedAt = Date.now();
  /* P30 (owner order 2026-10-16): per-stage timings, ms since startedAt. Only
     numbers are recorded, never text, and they ride on the existing trace
     line, so this adds no storage write. */
  const timings = {};
  const mark = (name) => { if (timings[name] == null) timings[name] = Date.now() - startedAt; };
  const emitTiming = (extra = {}) => {
    try { console.log(JSON.stringify({ evt: 'ai.timing', agent: AGENT_VERSION, totalMs: Date.now() - startedAt, ...timings, ...extra })); } catch (_) {}
    /* Anonymous daily report (owner 2026-10-17): counts only, no uid, no text. */
    try { bumpDailyStats(env, statsFromTiming({ totalMs: Date.now() - startedAt, ...timings, ...extra })).catch(() => {}); } catch (_) {}
  };
  const sendCtx = { uid: String(uid || ''), stream };
  /* M7: AI chat is for signed-in students only. A guest has no durable identity,
     so it can neither personalise nor be remembered, it is refused up front. */
  if (!sendCtx.uid.startsWith('account-')) {
    const msg = { error: 'sign_in_required', message: 'AI চ্যাট ব্যবহার করতে লগইন করো।' };
    return stream ? sseError(msg, 401, request) : jsonResp(msg, 401, request);
  }
  const body = await request.json().catch(() => null);
  const v = validateChatReq(body);
  if (!v.ok) return jsonResp({ error: v.code, message: v.message }, 400, request);
  const onboarding = sanitizeOnboardingContext(body?.context?.onboarding);
  if (onboarding && v.messages.some(message => message.role === 'user' && onboardingSecretDetected(message.content))) {
    return guidanceResponse('নিরাপত্তার জন্য Password, verification code বা গোপন তথ্য Assistant নেয় না। এমন কিছু লিখে থাকলে সেটি বদলে শুধু সাধারণ প্রশ্ন করো।', stream, request);
  }

  const intentCls = classifyIntent(v.messages[v.messages.length - 1].content);
  const intent = intentCls.intent;
  const baseTier = intentCls.tier;
  /* P26: a provably simple academic question goes to the FAST model even though
     the classifier called it academic. This can only lower spend, it never
     upgrades a tier, so the worst case is a correct but cheaper answer. */
  const routing = routeTier(intent, v.messages[v.messages.length - 1].content, baseTier);
  const tier = routing.tier;
  const quizMode = intent === INTENTS.QUIZ_REQUEST;
  const examMode = body.context && body.context.examMode === 'mock-running' ? 'mock-running' : '';
  const stats = capStats(body.context && body.context.stats);
  const safety = safetyGate(intent, examMode);

  /* PR-2 (owner 2026-10-17): the provider health probe needs only the tier, so it
     starts now and overlaps the quota round-trip instead of running after it. */
  const providersP = (async () => {
  /* bad-set (আজ-মার্ক-করা key/model) */
  const kvKeys = await aiKeyOverlay(env);
  const healthNow = Date.now();
  /* P28: per-entry markers, kept so the chain can tell a cooling-down model from
     a healthy one rather than treating every past failure as permanent. */
  const badMap = {};
  const badSet = new Set();
  /* One parallel round instead of one KV read per chain entry in sequence -
     the sequential loop cost seconds before the first token on a long chain. */
  {
    const probe = routerChain(env, tier, new Set(), kvKeys);
    const flags = await Promise.all(probe.map(c => Promise.resolve().then(() => getKv(env.PUB_KV, badKeyName(c.key, c.model))).catch(() => null)));
    probe.forEach((c, i) => {
      const sig = String(c.key).slice(0, 12) + ':' + c.model;
      badMap[sig] = flags[i];
      /* Only entries still inside their cooldown are excluded, a transient 5xx
         earns a short cooldown and is retried automatically afterwards. */
      if (!isEntryHealthy(flags[i], healthNow)) badSet.add(sig);
    });
  }
  /* A model that failed transiently (503 "high demand") must not disable its tier
     for the rest of the day. If every entry is cooling down, the whole list comes
     back for one attempt, so the student gets an answer instead of a 503, the
     previous behaviour read as "the AI is switched off". */
  const fullChain = routerChain(env, tier, new Set(), kvKeys)
    .map(c => ({ ...c, sig: String(c.key).slice(0, 12) + ':' + c.model }));
  let chain = healthyChain(fullChain, badMap, healthNow);
  if (v.messages.some(m => m.image)) chain = chain.filter(c => c.provider === 'gemini');
  /* P31: a working model is tried before a dead one. `healthyChain` already
     drops individually-cooling entries, so this matters when everything is
     cooling and the whole list comes back, the least-broken model then leads. */
  chain = rankChainByModelHealth(chain, badMap, healthNow);
  return { kvKeys, badMap, badSet, chain };
  })();
  providersP.catch(() => {});

  /* Per-user AI state lives in a Durable Object when the binding is present.
     The KV path wrote three keys a message, and the free plan allows only 1,000
     KV writes a day, which capped the whole app. The object allows 100,000
     requests a day. KV stays as the fallback so a missing binding still works. */
  const aiState = aiStateStore(env);
  const stateGet = async (key) => {
    if (aiState) { try { return await aiState.get(sendCtx.uid, key); } catch (_) { /* fall through */ } }
    return getKv(env.PUB_KV, key);
  };
  const statePut = async (key, val, ttlMs) => {
    if (aiState) { try { await aiState.put(sendCtx.uid, key, val, ttlMs); return; } catch (_) { /* fall through */ } }
    return putKv(env.PUB_KV, key, val, ttlMs ? Math.round(ttlMs / 1000) : undefined);
  };

  /* Agent phase 1 (owner 2026-10-17): server tools. The plan is pure (no I/O).
     A simple plan (pure arithmetic, a short "how am I doing") is answered here
     by the tools alone: no model call and no AI limit used. Never during a
     running mock exam. Kill switch: PUB_KV 'sky:agent-tools' = "off". */
  const toolText = String((v.messages[v.messages.length - 1] || {}).content || '');
  /* the student's previous turn, so a short follow-up keeps the search topic */
  const prevUser = v.messages.slice(0, -1).reverse().find(m => m.role === 'user');
  let toolPlan = examMode ? [] : planServerTools(toolText, { prevText: prevUser ? String(prevUser.content || '') : '', firstName: (sanitizeProfileContext(body && body.context && body.context.profile) || {}).firstName, quizMode, hasImage: v.messages.some(m => m.image), searchOn: !!(env && env.TAVILY_API_KEY) });
  if (toolPlan.length && !(await toolsEnabled(env && env.PUB_KV))) toolPlan = [];
  /* Sky memory fix 2026-10-18: a weakness question also needs what the student
     SAID about their weak topics (long-term memory), not only exam stats, or an
     empty exam record makes Sky answer "no information" on the first try. The
     read happens only for such a question and is reused below (no second read). */
  let earlyLongP = null;
  let statedWeak = [];
  if (persistMemory && toolPlan.some(p => p.name === 'analyze_weak_topics')) {
    earlyLongP = Promise.resolve().then(() => stateGet('mem:' + MEMORY_VERSION + ':' + sendCtx.uid)).catch(() => null);
    try { statedWeak = statedWeakTopics(parseMemory(await earlyLongP, sendCtx.uid)); } catch (_) { statedWeak = []; }
  }
  if (toolPlan.length && isSimplePlan(toolPlan, toolText)) {
    const prof = sanitizeProfileContext(body && body.context && body.context.profile) || {};
    const tr = await simpleToolResponse(toolPlan, stream, { intent, pv: SYSTEM_PROMPT_V, agent: AGENT_VERSION, firstName: prof.firstName, stats, statedWeak, kv: env && env.PUB_KV }, request).catch(() => null);
    if (tr) { mark('tools'); emitTiming({ tools: toolPlan.length, quota: false }); return tr; }
  }

  /* rate limit: প্রতি-user rolling 24h window-এ cap */
  const cap = Math.max(1, Math.min(500, Number((env && env.AGENT_DAILY_CAP) || 10)));
  const now = Date.now();
  let quota = null;
  if (aiState) {
    try {
      const q = await aiState.consumeQuota(sendCtx.uid, cap, opts && opts.reqId);
      quota = { exhausted: !q.allowed, remaining: q.remaining, start: Number(q.start) || 0 };
    } catch (_) { quota = null; }
  }
  if (!quota) {
    const rlKey = 'airl:' + sendCtx.uid;
    let quotaNow = { n: 0, start: now };
    try { quotaNow = readQuota(await getKv(env.PUB_KV, rlKey), now); } catch (_) { quotaNow = { n: 0, start: now }; }
    quota = Object.assign(quotaState({ used: quotaNow.n, cap }), { start: Number(quotaNow.start) || 0 });
    if (!quota.exhausted) await putKv(env.PUB_KV, rlKey, JSON.stringify({ n: quotaNow.n + 1, start: quotaNow.start }), 172800);
  }
  mark('quota');
  if (quota.exhausted) {
    /* Owner 2026-10-17: tell the student exactly when the window reopens. */
    const resetAt = (quota.start || now) + RL_WINDOW_MS;
    try { bumpDailyStats(env, statsFromTiming({ limited: true })).catch(() => {}); } catch (_) {}
    return jsonResp({ error: 'rate_limited', message: limitMessage(cap, resetAt, now), cap, remaining: quota.remaining, resetAt, retryAfterSec: Math.max(60, Math.ceil((resetAt - now) / 1000)) }, 429, request);
  }
  /* AI audit 2026-10-16: a message the AI never answered (every provider
     failed) gives its credit back, with a default cap of 10/day a provider
     outage used to burn a student's whole allowance. Best effort, never throws. */
  const refundQuota = async () => {
    try {
      if (aiState && typeof aiState.refundQuota === 'function') { await aiState.refundQuota(sendCtx.uid); return; }
      const rlKey = 'airl:' + sendCtx.uid;
      const q = readQuota(await getKv(env.PUB_KV, rlKey), Date.now());
      if (q.n > 0) await putKv(env.PUB_KV, rlKey, JSON.stringify({ n: q.n - 1, start: q.start }), 172800);
    } catch (_) { /* a failed refund only costs the student one credit */ }
  };

  const verificationGuidance = authVerificationGuidance(v.messages[v.messages.length - 1].content);
  if (verificationGuidance) return guidanceResponse(verificationGuidance, stream, request);
  const { kvKeys, badMap, badSet } = await providersP;
  let { chain } = await providersP;
  if (!chain.length) {
    const msg = { error: 'no_providers', message: 'AI-সেবা এখন কনফিগার করা নেই, দয়া করে মালিককে জানাও (GEMINI_KEYS)।' };
    return stream ? sseError(msg, 503, request) : jsonResp(msg, 503, request);
  }
  if (safety.blocked) {
    const msg = { error: 'mock_refused', message: safety.message };
    return stream ? sseError(msg, 403, request) : jsonResp(msg, 403, request);
  }
  /* PR-2: from here on, in streaming mode the work runs inside an already-open
     stream, so the student sees the first byte at once and each stage is sent
     the moment that work really happens (not all together at the end). */
  const early = { sent: new Set(), push: null };
  const prepStage = (id, label) => {
    if (!early.push || early.sent.has(id)) return;
    early.sent.add(id);
    early.push(`event: stage\ndata: ${JSON.stringify({ stage: id, label })}\n\n`);
  };
  const core = async () => {


  /* AI personalization (blueprint §19-20): per-user KV prefs, allowlisted.
     Keyed by identity uid, never shared/leaked between users. */
  /* Independent per-user reads start together; each is awaited where it was
     read before, so behaviour is unchanged and only the waiting overlaps. */
  const appFeatureHit = !quizMode && !v.messages.some(m => m.image) && isAppFeatureQuestion((v.messages[v.messages.length - 1] || {}).content);
  if (appFeatureHit) prepStage('app-features', 'টুল চালাচ্ছি, অ্যাপের ফিচার তালিকা দেখছি');
  const appFeaturesP = appFeatureHit ? Promise.resolve().then(() => loadAppFeatures(env && env.PUB_KV)).catch(() => null) : null;
  const memKeyEarly = 'mem:' + MEMORY_VERSION + ':' + sendCtx.uid;
  const safeRead = (fn) => Promise.resolve().then(fn).catch(() => null);
  const prefsP = safeRead(() => getKv(env.PUB_KV, 'aiprefs:' + sendCtx.uid));
  /* Step 3: the student's own instruction. Read in parallel with prefs; never
     in a running mock exam, quiz JSON or onboarding (those formats are fixed). */
  const instrWanted = sendCtx.uid.startsWith('account-') && !quizMode && examMode !== 'mock-running' && !onboarding;
  const instrP = instrWanted ? safeRead(() => readInstruction(env, sendCtx.uid)) : Promise.resolve(null);
  const chatMemP = persistMemory ? safeRead(async () => await stateGet('chatmem:' + sendCtx.uid)) : Promise.resolve(null);
  const sumP = persistMemory && v.fresh !== true ? safeRead(() => stateGet('chatmemsum:' + sendCtx.uid)) : Promise.resolve('');
  const longP = persistMemory ? (earlyLongP || safeRead(() => stateGet(memKeyEarly))) : Promise.resolve(null);
  let aiPrefs = null;
  try {
    const rawPrefs = await prefsP;
    aiPrefs = rawPrefs ? sanitizeAiPrefs(JSON.parse(rawPrefs)) : null;
  } catch (_) { aiPrefs = null; }
  let instrText = '';
  try { const ins = await instrP; instrText = ins && ins.text ? ins.text : ''; } catch (_) { instrText = ''; }
  /* M7: long-term memory is automatic for a signed-in student, no toggle and no
     prompt. Guests never reach here (refused above), so persistMemory is true. */
  const memoryOn = persistMemory;

  /* conversation memory: পুরনো কনভো (KV) + সাম্প্রতিক message */
  let mem = [];
  if (memoryOn) {
    try {
      const rawMem = await chatMemP;
      const parsedMem = JSON.parse(rawMem || '[]');
      mem = Array.isArray(parsedMem) ? parsedMem : [];
    } catch (_) { mem = []; }
  }
  /* A short thread is normally a continuation, so stored memory gets prepended.
     But "New Chat" opens an empty thread and its first message is short too -
     it matched that branch, so a greeting was answered with whatever topic the
     user had discussed days earlier. The client flags the first message of a
     fresh thread and that flag suppresses memory entirely. */
  const freshThread = v.fresh === true;
  let msgs = v.messages.slice();
  /* P27: the recalled turns are prepended before the current thread, so an
     over-long stored value would inflate every request in the session. Keep the
     newest few only. */
  if (!freshThread && msgs.length < 3 && mem.length) msgs = capRecalledTurns(mem).concat(msgs);
  /* P27: keep the last few turns word-for-word and digest everything older, so a
     follow-up still has its immediate context without re-sending the whole
     thread. A thread at or below the window is returned byte-identical to
     before. */
  const history = selectHistory(msgs);
  msgs = history.kept;
  /* P27: for a short thread (<= 16 turns) the digest is shown for this request
     only and nothing is persisted, so the chat path keeps its two-write budget.
     For a genuinely long one the digest is also saved as the rolling summary, so
     the same context carries into the next session. Stored memory already
     suppresses the summary (see summaryText below), so there is no double-count. */
  const persistSummary = memoryOn && history.digest && history.compacted >= 8;
  let freshSummary = history.digest || null;
  /* P30: background writes. Each is started here and awaited only at the end of
     the request (see settleBackground), so the model call no longer waits on
     a storage round-trip. They still finish inside this request. */
  const background = [];
  const later = (fn) => { background.push(Promise.resolve().then(fn).catch(() => {})); };
  const settleBackground = async () => { if (background.length) await Promise.all(background.splice(0)); };
  if (persistSummary) later(() => statePut('chatmemsum:' + sendCtx.uid, freshSummary, CHAT_MEMORY_TTL_MS));

  /* owner 2026-10-18: the live Dhaka clock rides on every turn (one line). */
  const systemPrompt = buildSystemPrompt({ stats, examMode, quiz: quizMode, onboarding, prefs: aiPrefs }) + '\n\n' + nowLine() + (instrText ? '\n\n' + renderInstructionBlock(instrText) : '');
  /* M4 Context Engine (opt-in). When enabled, a typed permission-scoped bundle
     is rendered and appended; when disabled the prompt above is byte-identical
     to the pre-M4 output, so the legacy path stays intact.
     The student's academic profile is attached only for a signed-in account and
     only after server-side sanitization; the first name is included by default,
     with no setting to switch it on. */
  const profileCtx = sendCtx.uid.startsWith('account-')
    ? sanitizeProfileContext(body?.context?.profile)
    : null;
  const ctxBundle = contextEngineEnabled(env)
    ? buildContext({ uid: sendCtx.uid, prefs: aiPrefs, stats, onboarding, profile: profileCtx, memoryOn })
    : null;
  const ctxText = ctxBundle ? renderContext(ctxBundle) : '';
  /* The rolling summary carries older topics too, so it is suppressed with
     memory, otherwise the stale subject leaks back through the system prompt. */
  let summaryText = memoryOn && !freshThread ? (freshSummary != null ? freshSummary : ((await sumP) || '')) : '';

  /* M7 long-term memory: read the caller's own records, render only the newest,
     most confident few. Storage is bounded by the engine and the owner is the
     server-validated account uid, a record for anyone else is dropped on parse. */
  const memKey = 'mem:' + MEMORY_VERSION + ':' + sendCtx.uid;
  let memRecords = [];
  if (memoryOn) {
    try {
      const rawLong = await longP;
      memRecords = parseMemory(rawLong, sendCtx.uid);
    } catch (_) { memRecords = []; }
  }
  /* P06 conversation-memory: remember the topic just discussed so a later, new
     session can continue it. Only the student's own question is stored (never a
     model output), it is PII-checked, and it is reserved under keys the chat
     extractor can never produce, so it never collides with a student-stated
     memory. Joined to the render below for free: no extra read, no extra KV
     write on the read path. Guests are refused earlier, so this is account-only. */
  let tutorContext = [];
  let lastTopicWrite = null;
  if (memoryOn) {
    const lastUser = v.messages[v.messages.length - 1];
    const priorTopic = memRecords.find(r => r.kind === KIND.STUDIES && r.key === 'last-topic');
    const topic = String(lastUser.content || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
    const isFresh = v.fresh === true;
    if (topic && isPiiFree(topic) && !(isFresh && priorTopic)) {
      try {
        const record = makeMemory(
          { kind: KIND.STUDIES, key: 'last-topic', value: topic, source: SOURCE.USER_STATED, confidence: 0.9, reason: 'সর্বশেষ আলোচনার বিষয়' },
          sendCtx.uid
        );
        if (record) {
          /* P30: reuse the records already read above (no second read) and write in
             the background, so the model call is not held up by this save. */
          const stored = memRecords.filter(r => !(r.kind === KIND.STUDIES && r.key === 'last-topic'));
          lastTopicWrite = Promise.resolve().then(() => statePut(memKey, JSON.stringify(upsertMemory(stored, record, sendCtx.uid)))).catch(() => {});
          background.push(lastTopicWrite);
        }
      } catch (_) {}
    }
    if (priorTopic && !isFresh) {
      tutorContext = [Object.freeze({ kind: KIND.STUDIES, key: 'last-topic', value: priorTopic.value, source: SOURCE.USER_STATED, confidence: priorTopic.confidence, reason: priorTopic.reason, ts: priorTopic.ts, ownerUid: sendCtx.uid })];
    }
  }
  const baseRecords = memRecords.filter(r => !(r.kind === KIND.STUDIES && r.key === 'last-topic'));
  const memoryText = memoryOn ? renderMemory(baseRecords.concat(tutorContext), MEMORY_VERSION) : '';
  if (memoryText || summaryText || (msgs.length > v.messages.length)) prepStage('memory', 'তোমার আগের কথাগুলো মনে করছি');
  /* The rich-answer contract rides beside the registered base prompt (whose
     text and hash stay locked) and is skipped for quiz JSON and onboarding. */
  const formatRules = (!quizMode && !onboarding) ? RESPONSE_FORMAT_RULES : '';
  let sys = [systemPrompt, formatRules, ctxText, memoryText, summaryText].filter(Boolean).join('\n\n');
  /* Sky goal (owner plan step 3): a study-advice / admission question is shaped
     around this student's own goal (profile target, else what they said in
     chat). Unknown goal → Sky asks once. Personal, so never cached or shared. */
  let goalUsed = false;
  if (!quizMode && !onboarding && !examMode && sendCtx.uid.startsWith('account-') && isGoalQuestion(toolText)) {
    try {
      const goalRecs = memoryOn ? memRecords : [];
      const askedBefore = v.messages.some(m => m && m.role === 'assistant' && /ভর্তি হতে চাও/.test(String(m.content || '')));
      const goalBlock = renderGoalContext(resolveGoal({ profile: profileCtx, records: goalRecs }), { weakTopics: stats && stats.weakTopics, stated: statedWeakTopics(goalRecs, 2), askedBefore });
      if (goalBlock) { sys = sys + '\n\n' + goalBlock; goalUsed = true; }
    } catch (_) { goalUsed = false; }
  }

  const hasImage = msgs.some(m => m.image);
  mark('context');

  /* ── P25 chat response cache ──
     Placed after `sys` and `hasImage` so it can prove the prompt is impersonal,
     and after the quota charge so a cached answer still counts against the
     per-user cap (the cap is an abuse guard, not a spend guard, and must not
     become bypassable). Everything below runs only when the flag is on AND the
     request qualifies; otherwise behaviour is byte-identical to before. */
  /* get_app_features (owner 2026-10-17): only a question about the app pays for
     the feature list; such answers are never cached, so a list edit shows at once. */
  if (appFeatureHit) sys = sys + '\n\n' + renderAppFeatures(await appFeaturesP);
  /* Agent phase 1: the other planned server tools (≤5 tools, ≤3 steps, 20 s).
     Each sends its own live stage; results are personal, so never cached. */
  const extraTools = toolPlan.filter(p => p.name !== 'get_app_features');
  let toolCtxUsed = false;
  if (extraTools.length) {
    try {
      const tr = await runTools([extraTools], { stats, statedWeak, env, kv: env && env.PUB_KV, onStage: prepStage });
      const block = renderToolContext(tr.results);
      if (block) { sys = sys + '\n\n' + block; toolCtxUsed = true; }
      mark('tools');
    } catch (_) { /* answer without tools */ }
  }
  /* Step 3: a student with their own instruction never gets a cached/shared
     answer, the cached one was written without their wish. */
  const chatCacheOn = chatCacheEnabled(env) && env && env.PROFILE_DB && !toolCtxUsed && !goalUsed && !appFeatureHit;
  const cacheQuestion = (v.messages[v.messages.length - 1] || {}).content;
  const cacheable = chatCacheOn && !instrText && isCacheableRequest({
    messages: v.messages, hasImage, quizMode, onboarding,
    memoryText, summaryText, ctxText, stats, intent
  });
  /* P30 (গ): a shared academic answer. A first-turn, self-contained study
     question ("সন্ধি কী?") does not need the student's stats or memory, so it is
     answered from an IMPERSONAL prompt and that answer may be shared. The
     personal prompt is never used to produce a shared answer, so nothing about
     one student can reach another. Memory is still updated as usual. */
  const sharedCandidate = !cacheable && chatCacheOn && !instrText && isSharedAcademicCandidate({
    messages: v.messages, hasImage, quizMode, onboarding, examMode, intent,
    fresh: freshThread, recalled: msgs.length > v.messages.length
  });
  const cacheMode = cacheable ? 'strict' : (sharedCandidate ? 'shared' : '');
  if (cacheMode === 'shared') {
    sys = [buildSystemPrompt({ stats: null, examMode: '', quiz: false, onboarding: null, prefs: null }), RESPONSE_FORMAT_RULES].join('\n\n');
    msgs = v.messages.slice();
  }
  let chatStore = null;
  let cacheKey = '';
  if (cacheMode) {
    try {
      chatStore = new AiAnalyticsStore(env.PROFILE_DB);
      cacheKey = await chatCacheKey({
        question: cacheQuestion, intent,
        promptVersion: SYSTEM_PROMPT_V, agentVersion: AGENT_VERSION
      });
      const hit = await chatStore.getCache(cacheKey);
      if (hit && hit.payload && typeof hit.payload.text === 'string') {
        /* Only the validated text is stored, so a cached reply is exactly what
           the student would have received live. */
        const cachedText = hit.payload.text;
        const cachedModel = hit.payload.model || hit.model || '';
        mark('cacheHit');
        /* P30: the background last-topic save must land before we return. */
        await settleBackground();
        emitTiming({ cache: cacheMode });
        if (!stream) {
          return jsonResp({ text: cachedText, structured: hit.payload.structured ?? null, model: cachedModel || null, intent, cached: true, pv: SYSTEM_PROMPT_V, latencyMs: Date.now() - startedAt, agent: AGENT_VERSION }, 200, request);
        }
        return sseCached(cachedText, intent, startedAt, cachedModel, request);
      }
    } catch (_) { /* a cache fault never breaks chat, fall through to the live path */ }
  }

  const partsOf = (m) => {
    const p = [{ text: m.content }];
    if (m.image) {
      const i = m.image.indexOf(',');
      const mt = String(m.image.slice(5, i) || 'image/jpeg').split(';')[0];
      p.push({ inline_data: { mime_type: mt, data: m.image.slice(i + 1) } });
    }
    return p;
  };
  const payloadG = () => ({
    system_instruction: { parts: [{ text: sys }] },
    contents: msgs.map(m => ({ role: m.role, parts: partsOf(m) }))
  });
  const payloadO = () => ({ messages: [{ role: 'system', content: sys }].concat(msgs.map(m => ({ role: m.role, content: m.content }))) });


  const failures = [];
  /* M10: one trace per request, emitted to the Worker log sink. It carries ids,
     counts and durations only, never message text, prompt text or a raw uid -
     and it costs no KV write, so the chat path keeps its two-write budget. */
  const rid = makeRequestId(sendCtx.uid + ':' + startedAt);
  const traceCtx = {
    rid,
    callerRef: callerRef(sendCtx.uid),
    intent,
    tier,
    stream,
    promptVersion: SYSTEM_PROMPT_V,
    contextVersion: ctxBundle ? CONTEXT_VERSION : '',
    agentVersion: AGENT_VERSION
  };
  const emitTrace = (extra = {}) => {
    try {
      console.log(renderTrace(makeTrace({
        ...traceCtx,
        at: Date.now(),
        latencyMs: Date.now() - startedAt,
        tokensIn: estimateTokens(sys),
        tokensOut: estimateTokens(extra.text || ''),
        ...extra
      })));
    } catch (_) {}
  };
  /* M8: validate every model response before it is returned or stored. The
     context (intent, stats, quiz, exam mode) is what the checks compare against;
     nothing here reaches the model. */
  const validationCtx = {
    intent,
    intentConfidence: intentCls.confidence,
    stats,
    quiz: quizMode,
    examMode,
    blocked: safety.blocked
  };
  const finalize = async (model, provider, text) => {
    /* Guests are refused before this point; a signed-in student's memory is keyed
       only by the server-validated account identity and has no client UID. */
    if (!memoryOn) return text;
    /* M8: a response that failed validation is never written to conversation or
       long-term memory, an unsafe reply is not a memory. */
    if (!validateResponse(text, validationCtx).persistable) return text;
    try {
      /* AI audit 2026-10-16: `msgs` already ends with the current user turn, so
         appending it again stored every question twice. Add it only if absent. */
      const lastTurn = msgs[msgs.length - 1];
      const withUser = lastTurn && lastTurn.role === 'user'
        ? msgs
        : msgs.concat([{ role: 'user', content: v.messages[v.messages.length - 1].content }]);
      const next = withUser.concat([{ role: 'assistant', content: text }]).slice(-24).map(x => ({ role: x.role, content: x.content }));
      await statePut('chatmem:' + sendCtx.uid, JSON.stringify(next), CHAT_MEMORY_TTL_MS);
    } catch (_) {}

    /* M7: both triggers the owner asked for, an explicit "মনে রাখো" and a
       study/preference/habit fact stated in passing, are extracted from the
       latest user turn. Each candidate must still clear makeMemory(), so a weak
       signal never stores, and no PII can enter a record. */
    try {
      /* P30: the last-topic save now runs in the background and writes this
         same key, so it must land before this read-modify-write. */
      if (lastTopicWrite) await lastTopicWrite;
      const latest = String(v.messages[v.messages.length - 1].content || '');
      const candidates = extractMemoryCandidates(latest);
      if (candidates.length) {
        const key = 'mem:' + MEMORY_VERSION + ':' + sendCtx.uid;
        let list = parseMemory(await stateGet(key), sendCtx.uid);
        let changed = false;
        for (const candidate of candidates) {
          const record = makeMemory(candidate, sendCtx.uid);
          if (!record) continue;
          list = upsertMemory(list, record, sendCtx.uid);
          changed = true;
        }
        if (changed) await statePut(key, JSON.stringify(list));
      }
    } catch (_) {}
  };

  if (!stream) {
    let lastErr = '';
    /* P28: same health-aware chain as the streaming path (Gemini-only here, since
       it is the only adapter with a one-shot path). Never empty when keys exist. */
    const oneShot = chain.filter(c => { const a = adapterFor(c); return Boolean(a) && a.oneShot === true; });
    mark('modelStart');
    /* P31: the same per-model fail limit as the streaming loop, so a busy model
       is not retried once per key on the one-shot path either. */
    const oneShotFails = new Map();
    const ONESHOT_FAIL_LIMIT = 2;
    for (const c of (oneShot.length ? oneShot : providerChain(env, tier, badSet, kvKeys))) {
      if ((oneShotFails.get(c.model) || 0) >= ONESHOT_FAIL_LIMIT) continue;
      try {
        const raw = await GEMINI_ADAPTER.chatOnce(c, payloadG());
        if (raw) {
          /* M8: the validated text is what the caller receives; the raw model
             output never leaves this function unchecked. */
          const check = validateResponse(raw, validationCtx);
          mark('modelDone');
          /* P25: same store-on-success rule as the streaming path. P30: the memory
             save and the cache write now run together instead of one after the
             other. */
          if (cacheMode && chatStore) {
            const toStore = check.text || raw;
            later(() => chatStore.putCache(cacheKey, 'summary', { text: toStore, structured: check.structured ?? null, model: c.model, intent }, { ttlMs: chatCacheTtl(intent), model: c.model }));
          }
          later(() => finalize(c.model, c.provider, raw));
          await settleBackground();
          emitTrace({ provider: c.provider, model: c.model, text: raw, responseType: check.structured?.type, validated: !check.enforced });
          emitTiming({ cache: cacheMode ? cacheMode + '-miss' : 'off', provider: c.provider });
          return jsonResp({ text: check.text, structured: check.structured, model: c.model, intent, pv: SYSTEM_PROMPT_V, latencyMs: Date.now() - startedAt, agent: AGENT_VERSION }, 200, request);
        }
        lastErr = 'empty-' + c.model;
      } catch (e) {
        lastErr = String(e.message || e);
        /* P28: a transient 5xx earns a short cooldown and recovers on its own;
           only a credential failure keeps the day-long ban. */
        if (e instanceof ProviderError) {
          const st = Number(e.status) || 0;
          oneShotFails.set(c.model, (st >= 500 || st === 429)
            ? ONESHOT_FAIL_LIMIT
            : (oneShotFails.get(c.model) || 0) + 1);
          if (e.bad) await markEntryFailed(env.PUB_KV, c.key, c.model, e.status);
        }
      }
    }
    await settleBackground();
    await refundQuota();
    emitTrace({ fallbackReason: FALLBACK.PROVIDER_ERROR, validated: false });
    emitTiming({ failed: true });
    return jsonResp({ error: 'provider_failed', message: 'AI একটু ব্যস্ত, কয়েক সেকেন্ড পরে আবার চেষ্টা করো।', retryable: true }, 502, request);
  }

  /* ── STREAMING (SSE) ── */
  const encoder = new TextEncoder();
  const streamOut = new ReadableStream({
    async start(controller) {
      const push = (s) => { try { controller.enqueue(encoder.encode(s)); } catch (_) {} };
      /* Live progress: each stage is sent only when that work really happens.
         Provider / model switching is deliberately never surfaced. */
      const sentStages = early.sent;
      const stage = (id, label) => { if (sentStages.has(id)) return; sentStages.add(id); push(`event: stage\ndata: ${JSON.stringify({ stage: id, label })}\n\n`); };
      try {
        stage('understand', STAGE_UNDERSTAND[intent] || STAGE_UNDERSTAND.GENERAL_CHAT);
        if (appFeatureHit) stage('app-features', 'টুল চালাচ্ছি, অ্যাপের ফিচার তালিকা দেখছি');
        if (memoryText || summaryText || (msgs.length > v.messages.length)) stage('memory', 'তোমার আগের কথাগুলো মনে করছি');
        if (stats && intent === INTENTS.PERFORMANCE_REQUEST) stage('tool', 'টুল চালাচ্ছি, তোমার অগ্রগতির তথ্য পড়ছি');
        else if (profileCtx && ctxBundle) stage('profile', 'তোমার লক্ষ্য অনুযায়ী উত্তর মিলিয়ে নিচ্ছি');
        if (hasImage) stage('image', 'ছবিটা বিশ্লেষণ করছি');
        stage('think', 'ভাবছি, উত্তর সাজাচ্ছি');
        let ok = false;
        let lastErr = '';
        /* P31: a model that fails is not retried once per key inside this same
           request. Measured 2026-10-16: a globally busy `gemini-3.1-flash-lite`
           was tried ~17 times at ~0.42 s each, so the student waited ~7.2 s of
           silence before the healthy model was even reached.
           An explicit 5xx/429 kills the model outright, that status is a
           property of the model, not the key. Any other failure (including a
           first-chunk stall, which is ambiguous) is tolerated once per model so
           a single bad key can still be routed around, but never more. */
        const modelFails = new Map();
        const MODEL_FAIL_LIMIT = 2;
        /* P30 (ক): a busy provider is abandoned after 5 s instead of 10 s, so one
           stalled model no longer costs the student ten seconds of silence.
           AGENT_FIRST_CHUNK_MS still overrides it (3–30 s). */
        const firstMs = Math.max(3000, Math.min(30000, Number(env && env.AGENT_FIRST_CHUNK_MS) || 5000));
        mark('modelStart');
        for (const c of chain) {
          /* P31: skip the rest of a model's keys once that model has failed. */
          if ((modelFails.get(c.model) || 0) >= MODEL_FAIL_LIMIT) continue;
          /* AI audit 2026-10-16: if this provider already streamed text and then
             fails, the client must drop that partial text before the next
             provider starts, otherwise the student saw "partial + partial +
             full" glued together, and the unvalidated partial stayed on screen. */
          let streamedAny = false;
          try {
            let full = '';
            const adapter = adapterFor(c);
            if (!adapter) throw new ProviderError('unknown-provider:' + c.provider, { retryable: false, bad: false });
            const payload = adapter.id === 'gemini' ? payloadG() : payloadO();
            for await (const t of firstChunkGuard(adapter.chatStream(c, payload, env), firstMs)) {
              if (!full) { mark('firstToken'); stage('write', quizMode ? 'প্রশ্ন তৈরি করছি' : 'উত্তর লিখছি'); }
              full += t;
              if (/```(chart|flow)/i.test(full)) stage('visual', 'চার্ট / ডায়াগ্রাম আঁকছি');
              if (/\n\s*\|?\s*:?-{3,}/.test(full)) stage('table', 'টেবিল সাজাচ্ছি');
              push(`data: ${JSON.stringify({ text: t })}\n\n`);
              streamedAny = true;
            }
            if (full.trim()) {
              ok = true;
              mark('modelDone');
              stage('verify', 'উত্তর যাচাই করছি');
              /* M8: text already streamed, so a blocked response is corrected in
                 place, the client replaces what it rendered with the safe notice.
                 Only high-precision classes fire here, so a normal answer is never
                 rewritten mid-stream. */
              const check = validateResponse(full, validationCtx);
              if (check.enforced) push(`event: replace\ndata: ${JSON.stringify({ text: check.text })}\n\n`);
              /* P25: store only the validated text, so a later cache hit returns
                 exactly what the live caller received. Fire-and-forget: a cache
                 write must never delay or fail the answer the student is reading. */
              if (cacheMode && chatStore) {
                const toStore = check.text || full;
                later(() => chatStore.putCache(cacheKey, 'summary', { text: toStore, structured: check.structured ?? null, model: c.model, intent }, { ttlMs: chatCacheTtl(intent), model: c.model }));
              }
              /* P30 (খ): `done` goes out first, so the student's answer is complete on
                 screen right away; the memory save finishes afterwards, still inside
                 this request (the stream closes only after it lands). */
              push(`event: done\ndata: ${JSON.stringify({ model: c.model, provider: c.provider, intent, quiz: quizMode, pv: SYSTEM_PROMPT_V, agent: AGENT_VERSION, latencyMs: Date.now() - startedAt, structured: check.structured })}\n\n`);
              later(() => finalize(c.model, c.provider, full));
              await settleBackground();
              emitTrace({ provider: c.provider, model: c.model, text: full, responseType: check.structured?.type, validated: !check.enforced });
              emitTiming({ cache: cacheMode ? cacheMode + '-miss' : 'off', provider: c.provider });
              break;
            }
            lastErr = 'empty-' + c.model;
          } catch (e) {
            if (streamedAny) push(`event: replace\ndata: ${JSON.stringify({ text: '' })}\n\n`);
            if (e instanceof ProviderError) {
              lastErr = e.message;
              /* P31: count the failure against the MODEL. A 5xx/429 is the model
                 being unavailable, so it is retired at once; anything else is
                 tolerated up to the limit so one bad key can still be routed
                 around. Credentials stay per key, another key may still serve
                 the same model. */
              const st = Number(e.status) || 0;
              modelFails.set(c.model, (st >= 500 || st === 429)
                ? MODEL_FAIL_LIMIT
                : (modelFails.get(c.model) || 0) + 1);
              if (e.bad) await markEntryFailed(env.PUB_KV, c.key, c.model, e.status);
            } else lastErr = String(e.message || e);
          }
        }
        if (!ok) {
          await settleBackground();
          await refundQuota();
          emitTrace({ fallbackReason: FALLBACK.PROVIDER_ERROR, validated: false });
          emitTiming({ failed: true });
          push(`event: error\ndata: ${JSON.stringify({ error: 'provider_failed', message: 'AI একটু ব্যস্ত, কয়েক সেকেন্ড পরে আবার চেষ্টা করো।', retryable: true })}\n\n`);
        }
      } catch (e) {
        await settleBackground();
        push(`event: error\ndata: ${JSON.stringify({ error: 'stream_failed', message: 'সংযোগ বিচ্ছিন্ন হয়েছে, আবার চেষ্টা করো।', retryable: true })}\n\n`);
      } finally {
        try { controller.close(); } catch (_) {}
      }
    }
  });
  return new Response(streamOut, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
      ...corsHeaders(request)
    }
  });
  };
  if (!stream) return core();
  mark('open');
  return openEarly(core, early, () => prepStage('understand', STAGE_UNDERSTAND[intent] || STAGE_UNDERSTAND.GENERAL_CHAT), request);
}

/* PR-2: open the SSE response at once and pipe the real answer into it when it
   is ready. Stage events written during preparation go out first, in order.
   A plain queue (no backpressure): the work and the memory save must finish
   even when the reader is slow, exactly as with the inner stream. */
function openEarly(run, early, first, request = null) {
  const enc = new TextEncoder();
  let ctl = null;
  const readable = new ReadableStream({ start(c) { ctl = c; } });
  const write = (chunk) => { try { ctl.enqueue(typeof chunk === 'string' ? enc.encode(chunk) : chunk); } catch (_) {} };
  early.push = write;
  write(': open\n\n');
  if (first) first();
  (async () => {
    try {
      const resp = await run();
      const reader = resp && resp.body ? resp.body.getReader() : null;
      if (reader) { for (;;) { const step = await reader.read(); if (step.done) break; write(step.value); } }
    } catch (e) {
      write(`event: error\ndata: ${JSON.stringify({ error: 'stream_failed', message: 'যুক্তি-বিচ্ছেদ ঘটেছে।', detail: String((e && e.message) || e), retryable: true })}\n\n`);
    } finally {
      early.push = null;
      try { ctl.close(); } catch (_) {}
    }
  })();
  return new Response(readable, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
      ...corsHeaders(request)
    }
  });
}

/* ── POST /api/ai/recall ---------------------------------------------------- */
/* Sky recall (owner plan step 2, 2026-10-18): when a signed-in student opens the
   chat, Sky reminds them of recent mistakes and their weak topic by itself.
   One memory read, no write, no model call and no AI limit used. Only the
   caller's own memory is read (parseMemory re-checks the owner). Guests get
   nothing. Kill switch: PUB_KV 'sky:recall' = "off". */
export async function agentRecall(env, uid, body) {
  const id = String(uid || '');
  if (!id.startsWith('account-')) return jsonResp({ ok: true, recall: null });
  let off = false;
  try { off = String((await getKv(env && env.PUB_KV, 'sky:recall')) || '').trim().toLowerCase() === 'off'; } catch (_) { off = false; }
  if (off) return jsonResp({ ok: true, recall: null, off: true });
  const b = body && typeof body === 'object' ? body : {};
  const stats = capStats(b.stats) || {};
  const recent = sanitizeRecent(b.recent);
  const key = 'mem:' + MEMORY_VERSION + ':' + id;
  let raw = null;
  const aiState = aiStateStore(env);
  let fromState = false;
  if (aiState) { try { raw = await aiState.get(id, key); fromState = true; } catch (_) { fromState = false; } }
  if (!fromState) { try { raw = await getKv(env && env.PUB_KV, key); } catch (_) { raw = null; } }
  let recall = null;
  let records = [];
  try { records = parseMemory(raw, id); } catch (_) { records = []; }
  let goal = null;
  try { goal = resolveGoal({ profile: sanitizeProfileContext(b.profile), records }); } catch (_) { goal = null; }
  try { recall = buildRecall({ records, stats, recent, goal, now: Date.now() }); } catch (_) { recall = null; }
  return jsonResp({ ok: true, recall, version: RECALL_VERSION });
}

/* ── /api/ai/instructions --------------------------------------------------- */
/* Sky custom instructions (owner plan step 3, 2026-10-18). One short note per
   signed-in student, saved in PUB_KV 'aiinstr:<uid>'. checkInstruction() runs
   on save AND on every read, so a rule added later also cleans old notes.
   Kill switch: PUB_KV 'sky:instructions' = "off" (reads return nothing, saves
   are refused). */
async function instructionsOff(env) {
  try { return String((await getKv(env && env.PUB_KV, 'sky:instructions')) || '').trim().toLowerCase() === 'off'; } catch (_) { return false; }
}
export async function readInstruction(env, uid) {
  const id = String(uid || '');
  if (!id.startsWith('account-') || !env || !env.PUB_KV) return null;
  const [off, raw] = await Promise.all([instructionsOff(env), getKv(env.PUB_KV, INSTRUCTION_KV_PREFIX + id).catch(() => null)]);
  if (off) return null;
  return parseStoredInstruction(raw);
}
export async function agentInstructions(env, uid, method, body) {
  const id = String(uid || '');
  if (!id.startsWith('account-')) return jsonResp({ error: 'sign_in_required', message: 'নির্দেশনা সেভ করতে লগইন করো।' }, 401);
  const base = { max: INSTRUCTION_MAX, examples: INSTRUCTION_EXAMPLES, version: INSTRUCTIONS_VERSION };
  if (await instructionsOff(env)) return jsonResp({ ok: true, off: true, text: '', ...base });
  const key = INSTRUCTION_KV_PREFIX + id;
  if (method === 'GET') {
    let cur = null;
    try { cur = parseStoredInstruction(await getKv(env.PUB_KV, key)); } catch (_) { cur = null; }
    return jsonResp({ ok: true, text: cur ? cur.text : '', ts: cur ? cur.ts : 0, ...base });
  }
  const raw = method === 'DELETE' ? '' : (body && typeof body === 'object' ? body.text : '');
  if (raw != null && typeof raw !== 'string') return jsonResp({ error: 'invalid_instruction', message: 'নির্দেশনা লেখা হিসেবে পাঠাও।' }, 400);
  if (typeof raw === 'string' && raw.trim().length > INSTRUCTION_MAX * 2) {
    return jsonResp({ error: 'too_long', message: `নির্দেশনা ${INSTRUCTION_MAX} অক্ষরের মধ্যে রাখো।` }, 400);
  }
  const c = checkInstruction(raw);
  if (!c.ok) return jsonResp({ error: 'instruction_refused', reason: c.reason, message: c.message }, 400);
  try {
    if (!c.text) await env.PUB_KV.delete(key);
    else await env.PUB_KV.put(key, storedInstruction(c.text));
  } catch (_) {
    return jsonResp({ error: 'save_failed', message: 'এখন সেভ করা গেল না, আবার চেষ্টা করো।' }, 500);
  }
  return jsonResp({ ok: true, text: c.text, message: c.message, ...base });
}

/* ── GET /api/ai/status ---------------------------------------------------- */
/* AI audit 2026-10-16: the student's "forget me" for the AI. Removes the
   conversation memory, its summary and the long-term memory from the AI state
   object and from the KV fallback. The quota is deliberately untouched. */
/* The COMPLETE meaning of "forget my AI memory", in one place.

   It used to be split: clearAiMemory() removed the conversation and the
   long-term note, and public-worker.js then deleted four more KV keys inline.
   That is fine while there is one caller, but /api/ai/memory/clear now has two
   (admission-gk and sky-ai) and a copy of the four key names on the far side
   would drift. A student who pressed "forget" and still had their saved
   instructions or their action history behind would be told something untrue.

   Error semantics are deliberately unchanged from the inline version: the four
   deletes are NOT caught here, so a failure surfaces as 500 on both sides rather
   than as a cheerful "cleared" over a half-cleared account. clearAiMemory keeps
   its own internal tolerance, as before. */
export async function clearAiEverything(env, uid) {
  const id = String(uid || '');
  if (!id.startsWith('account-')) return { ok: false, reason: 'no-account' };
  const r = await clearAiMemory(env, id);
  const keys = ['aiprefs:' + id, 'aiinstr:' + id, 'actaudit:' + id, 'actprop:' + id];
  for (const k of keys) await env.PUB_KV.delete(k);
  return { ok: r.ok !== false, cleared: (r.cleared || 0) + keys.length };
}

export async function clearAiMemory(env, uid) {
  const id = String(uid || '');
  if (!id.startsWith('account-')) return { ok: false, reason: 'no-account' };
  const keys = ['chatmem:' + id, 'chatmemsum:' + id, 'mem:' + MEMORY_VERSION + ':' + id];
  const aiState = aiStateStore(env);
  if (aiState && typeof aiState.del === 'function') {
    try { await aiState.del(id, keys); } catch (_) { /* KV half still runs */ }
  }
  for (const k of keys) { try { await env.PUB_KV.delete(k); } catch (_) {} }
  return { ok: true, cleared: keys.length };
}

export async function agentStatus(request, env, uid) {
  const kv = await aiKeyOverlay(env);
  /* Same three answers the chat route's parity header is built from, read through
     providerReadiness() so the dashboard and the routing check cannot disagree. */
  const ready = await providerReadiness(env);
  const hasGemini = ready.gemini;
  const hasGroq = ready.groq;
  const hasCloudflare = ready.cloudflare;
  const ctxOn = contextEngineEnabled(env);
  return jsonResp({
    ok: true, agent: AGENT_VERSION, pv: SYSTEM_PROMPT_V,
    providers: { gemini: hasGemini, groq: hasGroq, cloudflare: hasCloudflare },
    models: { fast: GEMINI_MODELS.FAST, smart: GEMINI_MODELS.SMART },
    /* The provider chain the streaming chat actually walks, in order. A bare
       `providers.groq: true` only proves a key exists, it said true while both
       Groq models in the chain were already retired and answering 404. This is
       routerChain, not providerChain: the latter filters to adapters with a
       one-shot path, which is Gemini alone, so it would report a two-entry
       chain while the chat really tries Gemini, then Groq, then Cloudflare. */
    chain: routerChain(env, TIER.FAST, new Set(), kv).map(c => c.provider + ':' + c.model),
    limits: { perDay: Math.max(1, Math.min(500, Number(env.AGENT_DAILY_CAP || 10))) },
    /* Which store the per-user state actually uses. Without this the migration
       off KV could only be inferred; here it is observable from the status
       endpoint, so a missing binding is visible rather than assumed. */
    state: aiStateStore(env) ? { store: 'durable-object', version: AI_STATE_VERSION } : { store: 'kv', version: 'kv-fallback' },
    streaming: true,
    tools: { version: TOOL_REGISTRY_VERSION, declared: listTools() },
    memory: { version: MEMORY_VERSION, mode: 'auto', scope: 'account-only' },
    response: describeResponseValidation(),
    actions: describeActions(env),
    observability: describeObservability(),
    context: ctxOn
      ? describeContext(buildContext({ uid, prefs: null, stats: null, onboarding: null, memoryOn: true }))
      : { enabled: false }
  });
}

function jsonResp(d, s = 200, request = null) {
  return new Response(JSON.stringify(d), {
    status: s,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(request), 'Access-Control-Allow-Headers': 'content-type,x-ah-guest', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' }
  });
}
function sseError(msg, status, request = null) {
  const enc = new TextEncoder();
  return new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(enc.encode(`event: error\ndata: ${JSON.stringify(msg)}\n\n`));
      controller.close();
    }
  }), { status, headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', ...corsHeaders(request) } });
}

/* P25: replay a cached answer on the SSE contract the client already parses.
   No provider was called, so no stage events are emitted, the text and the
   `done` event are the whole exchange, exactly as the client expects. */
function sseCached(text, intent, startedAt, model, request = null) {
  const enc = new TextEncoder();
  return new Response(new ReadableStream({
    start(controller) {
      const push = (s) => { try { controller.enqueue(enc.encode(s)); } catch (_) {} };
      push(`data: ${JSON.stringify({ text })}\n\n`);
      push(`event: done\ndata: ${JSON.stringify({ model: model || null, provider: 'cache', intent, cached: true, pv: SYSTEM_PROMPT_V, agent: AGENT_VERSION, latencyMs: Date.now() - startedAt })}\n\n`);
      try { controller.close(); } catch (_) {}
    }
  }), { status: 200, headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', ...corsHeaders(request) } });
}

export const __test = {
  classifyIntent, validateChatReq, capStats, buildSystemPrompt, summarizeTo, buildStudyRecommendation, buildImprovementLine,
  safetyGate, authVerificationGuidance, routerChain, geminiTextFromChunk, sseParse, ProviderError,
  adapterFor, providerChain, PROVIDER_ADAPTERS, GEMINI_ADAPTER, GROQ_ADAPTER, CLOUDFLARE_ADAPTER,
  INTENTS, TIER, GEMINI_MODELS, AGENT_VERSION, SYSTEM_PROMPT_V,
  contextEngineEnabled, buildContext, renderContext, describeContext, CONTEXT_VERSION, sanitizeProfileContext,
  listTools, TOOL_REGISTRY_VERSION,
  extractMemoryCandidates, makeMemory, upsertMemory, parseMemory, renderMemory, MEMORY_VERSION,
  validateResponse, describeResponseValidation, RESPONSE_VALIDATION_VERSION,
  describeActions, ACTION_VERSION,
  makeTrace, makeRequestId, callerRef, estimateTokens, quotaState, renderTrace,
  parseTraces, appendTrace, addUsage, emptyUsage, estimateCost, describeObservability,
  validateObservability, OBSERVABILITY_VERSION, FALLBACK,
  readQuota
};
