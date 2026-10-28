/* F0.1 step 4b / DV-01 - GET /api/ai/prefs inside sky-ai.
 *
 * Same answer as admission-gk's public-worker.js handler: { prefs } from
 * PUB_KV "aiprefs:<uid>", sanitized, or the defaults. The uid is trusted ONLY
 * when the caller proves it is admission-gk with the shared internal key
 * (PUB_KV "secret:sky-internal"); sky-ai is also reachable directly on
 * workers.dev, so the x-sky-ai-caller header alone is not proof. Anything
 * missing -> null, and the worker answers 404 (admission-gk then falls back).
 *
 * sanitizeAiPrefs / AI_PREFS_DEFAULT are copied from ai-agent.js so sky-ai does
 * not bundle the whole AI core; prefs.test.mjs fails if the copies drift.
 */

export const INTERNAL_KEY_NAME = 'secret:sky-internal';

export const AI_PREFS_DEFAULT = Object.freeze({ langStyle: "bn", tone: "friendly", responseLen: "balanced" });
export function sanitizeAiPrefs(value) {
  if (!value || typeof value !== "object") return null;
  const pick = (v, set, dflt) => (set.has(String(v)) ? String(v) : dflt);
  return {
    langStyle: pick(value.langStyle, new Set(["bn", "en", "mix"]), AI_PREFS_DEFAULT.langStyle),
    tone: pick(value.tone, new Set(["friendly", "professional", "simple", "motivating", "direct"]), AI_PREFS_DEFAULT.tone),
    responseLen: pick(value.responseLen, new Set(["short", "balanced", "detailed"]), AI_PREFS_DEFAULT.responseLen)
  };
}

/* Same headers admission-gk's JSONH sends, so the browser sees no difference. */
const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization,content-type,x-ah-app,x-ah-guest',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'cache-control': 'no-store',
  'x-sky-ai-route': 'prefs'
};

export function sameKey(a, b) {
  a = String(a || ''); b = String(b || '');
  if (!a || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function handlePrefsGet(request, env = {}) {
  const kv = env && env.PUB_KV;
  if (!kv || typeof kv.get !== 'function') return null;
  if (request.headers.get('x-sky-ai-caller') !== 'admission-gk') return null;
  const uid = request.headers.get('x-sky-uid') || '';
  const given = request.headers.get('x-sky-internal') || '';
  if (!uid || !given) return null;
  let key = null;
  try { key = await kv.get(INTERNAL_KEY_NAME); } catch (_) { return null; }
  if (!sameKey(key, given)) return null;
  let prefs = null;
  try {
    const raw = await kv.get('aiprefs:' + uid);
    prefs = raw ? sanitizeAiPrefs(JSON.parse(raw)) : null;
  } catch (_) { prefs = null; }
  return new Response(JSON.stringify({ prefs: prefs || AI_PREFS_DEFAULT }), { status: 200, headers: HEADERS });
}
