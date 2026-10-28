/**
 * P25, chat response cache (owner order 2026-10-15, step 1 of the AI cost plan).
 *
 * WHY THIS EXISTS
 * ---------------
 * `agentChat` is the main student path and it called the model on every single
 * request. Measured from the code: `getCache`/`putCache` were used in exactly one
 * place, the admin analytics copilot. So a thousand students asking the same
 * common question caused a thousand model calls, and the free provider quota -
 * which is the real cost here, not money, was spent on answers we already had.
 *
 * WHY IT IS NARROW ON PURPOSE
 * ---------------------------
 * The system prompt is personalised: memory records, the rolling summary, the
 * context bundle and the student's stats are all rendered into it. Caching a
 * reply across users would therefore leak one student's personalisation into
 * another student's answer, which is far worse than the quota it saves. So a
 * request is cacheable ONLY when its prompt is provably impersonal:
 *
 *   - a single user turn (no history to be confused about),
 *   - no image,
 *   - no memory, no summary, no context bundle, no stats, no onboarding,
 *   - an intent whose answer does not depend on the caller.
 *
 * Anything else is answered live, exactly as before. The cache is an
 * optimisation on the impersonal tail, never a shortcut on personalised work.
 *
 * The key includes the prompt and agent version, so shipping a new prompt
 * invalidates every stored answer by construction rather than by a sweep.
 */

/* Bengali digits map to ASCII for the KEY only (never for the content), so
 * "২০২৬ সালে" and "2026 সালে" reach the same entry. */
const BN_DIGITS = { '০': '0', '১': '1', '২': '2', '৩': '3', '৪': '4', '৫': '5', '৬': '6', '৭': '7', '৮': '8', '৯': '9' };

/** Intents whose answer does not depend on who is asking. */
export const CACHEABLE_INTENTS = Object.freeze(['ACADEMIC_EXPLAIN', 'GENERAL_CHAT', 'SEARCH_REQUEST']);

export const CHAT_CACHE_VERSION = 'chat-cache-v2';

/** Study answers stay valid for a day; anything time-sensitive for six hours. */
export const CHAT_CACHE_TTL_MS = Object.freeze({
  ACADEMIC_EXPLAIN: 24 * 3600 * 1000,
  GENERAL_CHAT: 24 * 3600 * 1000,
  SEARCH_REQUEST: 6 * 3600 * 1000
});

/**
 * Enabled by default, and disabled only by an explicit value. The Worker sits on
 * the Workers Free ceiling of 64 variables, so this deliberately does NOT add a
 * `[vars]` entry, same pattern as the write/execute layer, which is live in code
 * and turned off by binding `USE_WRITE_ACTIONS = "disabled"` from the dashboard.
 * To turn this cache off without a deploy, bind `AI_CHAT_CACHE = "off"`.
 */
export function chatCacheEnabled(env) {
  const v = String((env && env.AI_CHAT_CACHE) || '').trim().toLowerCase();
  return v !== 'off' && v !== 'disabled' && v !== 'false' && v !== '0';
}

/** Normalise a question into a stable key component. */
export function normaliseQuestion(text) {
  return String(text == null ? '' : text)
    .replace(/[০-৯]/g, (d) => BN_DIGITS[d] || d)
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * True when this request's prompt is impersonal enough to share a cached reply.
 * Every input is a value the caller already computed; nothing is re-derived, so
 * the check cannot drift from the prompt that is actually sent.
 */
export function isCacheableRequest(input = {}) {
  const {
    messages, hasImage, quizMode, onboarding,
    memoryText, summaryText, ctxText, stats, intent
  } = input;
  if (hasImage) return false;
  if (quizMode) return false;
  if (onboarding) return false;
  if (!Array.isArray(messages) || messages.length !== 1) return false;
  if (messages[0] && messages[0].role !== 'user') return false;
  if (!normaliseQuestion(messages[0] && messages[0].content)) return false;
  /* Any personalisation rendered into the system prompt disqualifies the reply. */
  if (memoryText || summaryText || ctxText || stats) return false;
  return CACHEABLE_INTENTS.includes(String(intent || ''));
}

/**
 * P30 (owner order 2026-10-16), the shared academic path.
 *
 * `isCacheableRequest` refuses any prompt that carries personalisation, and a
 * signed-in student's prompt always does (last-topic memory, stats), so the
 * cache never hit in practice. This predicate selects a narrower set of
 * questions that can be answered from an IMPERSONAL prompt instead:
 *
 *   - one user turn, no image, no quiz, no onboarding, no running mock exam,
 *   - a fresh thread, or no recalled turns were prepended,
 *   - intent ACADEMIC_EXPLAIN only (a pure study question),
 *   - the text does not refer to the student, earlier messages or "this/that".
 *
 * The caller must then build the prompt WITHOUT stats, memory, summary,
 * context or prefs. Only that impersonal answer is ever stored, so a shared
 * reply cannot contain anything about another student.
 */
export const SHARED_CACHE_INTENTS = Object.freeze(['ACADEMIC_EXPLAIN']);
export const SHARED_MAX_CHARS = 300;
const SELF_OR_DEICTIC = /(আমার|আমাকে|আমি|আমরা|আমাদের|আমায়|নিজের|আগের|আগে যে|উপরের|ওপরের|এটা|এটি|ওটা|ওটি|সেটা|সেটি|এইটা|ঐটা|এগুলো|ওগুলো|আবার বুঝ|আরো বুঝ|আরও বুঝ|বুঝিনি|বুঝলাম না|উত্তরটা|প্রশ্নটা|\b(my|me|mine|myself|i|i'm|im|we|our|us|this|that|these|those|it|above|previous|earlier|again)\b)/i;

export function isSharedAcademicCandidate(input = {}) {
  const { messages, hasImage, quizMode, onboarding, examMode, intent, fresh, recalled } = input;
  if (hasImage || quizMode || onboarding || examMode) return false;
  if (!Array.isArray(messages) || messages.length !== 1) return false;
  if (!messages[0] || messages[0].role !== 'user') return false;
  if (recalled && fresh !== true) return false;
  if (!SHARED_CACHE_INTENTS.includes(String(intent || ''))) return false;
  const q = normaliseQuestion(messages[0].content);
  if (!q || q.length > SHARED_MAX_CHARS) return false;
  if (SELF_OR_DEICTIC.test(q)) return false;
  return true;
}

/** Cache key: question + intent + both versions, so a prompt change invalidates. */
export async function chatCacheKey({ question, intent, promptVersion, agentVersion }) {
  const material = [
    CHAT_CACHE_VERSION,
    normaliseQuestion(question),
    String(intent || ''),
    String(promptVersion || ''),
    String(agentVersion || '')
  ].join('\u0001');
  return 'chat:' + (await digest(material));
}

async function digest(text) {
  const data = new TextEncoder().encode(text);
  if (globalThis.crypto?.subtle) {
    const hash = await globalThis.crypto.subtle.digest('SHA-256', data);
    return [...new Uint8Array(hash)].slice(0, 16).map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  let h = 0x811c9dc5;
  for (const b of data) { h ^= b; h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(36);
}

/** TTL for a cacheable intent. */
export function chatCacheTtl(intent) {
  return CHAT_CACHE_TTL_MS[String(intent || '')] ?? CHAT_CACHE_TTL_MS.GENERAL_CHAT;
}

export const __chatCacheTest = Object.freeze({ digest, BN_DIGITS });
