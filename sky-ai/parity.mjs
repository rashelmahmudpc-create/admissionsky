/* Two checks that every routable sky-ai endpoint needs, written once.
 *
 * F0.1 step 4i. Until now each route file carried its own copy of the trust
 * check — the same eight lines, once per file — and chat carried the only copy of
 * the provider-parity check. The status route needs both, which is the moment to
 * stop copying: a trust check that is subtly weaker in one file is the kind of
 * difference nobody notices until it matters.
 *
 * TRUST. sky-ai is reachable only through admission-gk's service binding
 * (workers_dev = false), and the caller must still prove itself with the shared
 * internal key from PUB_KV. Anything missing returns null and the caller's Worker
 * answers 404, so admission-gk's own handler serves the request — a broken split
 * degrades to the code that runs today.
 *
 * PARITY. A room with fewer credentials can still answer, and would answer
 * differently (weaker models, an empty chain, a default daily cap) with no error
 * anywhere. admission-gk therefore says which providers it can reach and this
 * side refuses when it is missing any of them. Names only — never a key, never a
 * length, never a prefix.
 */
import { INTERNAL_KEY_NAME, sameKey } from './prefs.mjs';
import { providerReadiness } from '../ai-agent.js';

/** The verified uid, or null when this request must not be served here. */
export async function trustedUid(request, env) {
  const kv = env && env.PUB_KV;
  if (!kv || typeof kv.get !== 'function') return null;
  if (request.headers.get('x-sky-ai-caller') !== 'admission-gk') return null;
  const uid = request.headers.get('x-sky-uid') || '';
  const given = request.headers.get('x-sky-internal') || '';
  if (!uid || !given) return null;
  let key = null;
  try { key = await kv.get(INTERNAL_KEY_NAME); } catch (_) { return null; }
  return sameKey(key, given) ? uid : null;
}

/** The providers admission-gk says it can reach, as a clean list. */
export function neededProviders(request) {
  return String(request.headers.get('x-sky-need-providers') || '')
    .split(',').map((s) => s.trim()).filter(Boolean);
}

/**
 * Names this room cannot reach that admission-gk can. An empty list means the two
 * sides match. `needed` being empty means admission-gk has no provider either, in
 * which case there is nothing to gain by serving here and the caller should keep
 * its own answer.
 */
export async function missingProviders(request, env) {
  const needed = neededProviders(request);
  if (!needed.length) return ['*'];
  let mine = {};
  try { mine = await providerReadiness(env); } catch (_) { return ['*']; }
  return needed.filter((name) => !mine[name]);
}

/** The settings that change an ANSWER, carried across the hop. */
export const ENV_PASSTHROUGH = [
  'AGENT_DAILY_CAP',
  'AGENT_GEMINI_MODELS',
  'AGENT_GROQ_MODELS',
  'AGENT_CLOUDFLARE_MODELS',
  'AGENT_FIRST_CHUNK_MS'
];

/** Header name for one passthrough setting: AGENT_DAILY_CAP → x-sky-env-agent-daily-cap. */
export const envHeaderName = (name) => 'x-sky-env-' + String(name).toLowerCase().replace(/_/g, '-');

/** Apply the settings that were actually sent; this Worker's own defaults stay in charge of the rest. */
export function applyEnvPassthrough(baseEnv, request) {
  const out = { ...baseEnv };
  for (const name of ENV_PASSTHROUGH) {
    const sent = request.headers.get(envHeaderName(name));
    if (sent != null && sent !== '') out[name] = sent;
  }
  return out;
}
