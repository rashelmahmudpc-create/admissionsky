/* F0.1 step 4h — /api/ai/chat inside sky-ai. The last route, and the only one a
 * student notices directly: it is the answer they read every day.
 *
 * WHY THIS ONE IS DIFFERENT FROM EVERY EARLIER STEP. The other routes moved a
 * decision — what to recall, what to save, what to forget. This one moves the
 * model call, and the model call depends on CREDENTIALS that live on
 * admission-gk (GEMINI_KEYS, GROQ_API_KEY, CLOUDFLARE_AI_API_KEY). sky-ai has its
 * own environment and may have none of them.
 *
 * THE FAILURE THAT WOULD BE INVISIBLE: sky-ai with a partial key set still answers
 * — from a weaker free model — so the student gets a slower, worse reply and
 * nobody sees an error anywhere. That is worse than an outage, because an outage
 * is noticed.
 *
 * SO THE ROUTE REFUSES TO GUESS. admission-gk sends the provider names it can
 * reach (x-sky-need-providers) and the per-day cap and model overrides that shape
 * the answer. This handler compares that list with its OWN readiness, computed by
 * the same function (providerReadiness) from the same module, and returns null —
 * "not mine" — if even one provider is missing. Null means the Worker answers 404,
 * admission-gk's forwarder treats that as a miss, and the student is served by
 * the code that runs today. Nothing degrades; it simply does not move until the
 * credentials are there.
 *
 * WHY A REPEAT CANNOT CHARGE TWICE. admission-gk generates one request id per
 * chat and sends it here; both sides hand the same id to the quota counter, which
 * remembers the decision against that id. So if sky-ai counts a message and its
 * answer is lost on the way back, the fallback's count is a replay of the same
 * decision, not a second charge. This is the one place where a duplicate would be
 * a real loss to the student (a wasted daily message), which is why it is handled
 * here rather than left to chance.
 */

import { agentChat, providerReadiness, readyProviderNames } from '../ai-agent.js';
import { INTERNAL_KEY_NAME, sameKey } from './prefs.mjs';

const PATHS = new Set(['/api/ai/chat', '/api/ai']);

/* The env keys that change what a chat DOES (as opposed to which secret it reads).
   Carried across the hop so the two Workers cannot answer differently for the
   same request — a different daily cap or a stale model id would be a silent
   behaviour change. Absent headers keep the defaults, which is what admission-gk
   would have used too. */
const ENV_PASSTHROUGH = ['AGENT_DAILY_CAP', 'AGENT_GEMINI_MODELS', 'AGENT_GROQ_MODELS', 'AGENT_CLOUDFLARE_MODELS', 'AGENT_FIRST_CHUNK_MS'];

async function trusted(request, env) {
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

export async function handleChat(request, env = {}) {
  if (request.method !== 'POST') return null;
  if (!PATHS.has(new URL(request.url).pathname)) return null;
  const uid = await trusted(request, env);
  if (!uid) return null;

  /* Parity is the gate. An empty expected list means admission-gk has no provider
     either, so forwarding it here would only produce the same failure in a room
     with fewer keys to try. */
  const needed = String(request.headers.get('x-sky-need-providers') || '')
    .split(',').map((s) => s.trim()).filter(Boolean);
  if (!needed.length) return null;
  let mine = {};
  try { mine = await providerReadiness(env); } catch (_) { return null; }
  const missing = needed.filter((name) => !mine[name]);
  if (missing.length) return null;

  /* Rebuild the env only for the keys that were actually sent, so this Worker's
     own defaults stay in charge of everything else. */
  const chatEnv = { ...env };
  for (const name of ENV_PASSTHROUGH) {
    const sent = request.headers.get('x-sky-env-' + name.toLowerCase().replace(/_/g, '-'));
    if (sent != null && sent !== '') chatEnv[name] = sent;
  }

  // agentChat reads the body itself, so it gets a Request, not parsed JSON.
  const chatRequest = new Request(request.url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: await request.arrayBuffer()
  });
  const res = await agentChat(chatRequest, chatEnv, uid, {
    stream: new URL(request.url).pathname !== '/api/ai',
    persistMemory: request.headers.get('x-sky-persist-memory') !== '0',
    reqId: request.headers.get('x-sky-req-id') || undefined
  });

  /* Re-wrapped to carry the route marker *and* to leave everything else exactly
     as agentChat produced it — status, SSE headers and the body stream. Copying
     the body would buffer the whole answer before the student saw a word; the
     stream has to pass through untouched. */
  const headers = new Headers(res.headers);
  headers.set('x-sky-ai-route', 'chat');
  return new Response(res.body, { status: res.status, headers });
}

/* Used by the worker's /health so a deploy can see, without trying a chat, whether
   this room could answer one at all. Names only — never a key, never its length. */
export async function chatReadiness(env) {
  try {
    return readyProviderNames(await providerReadiness(env));
  } catch (_) { return []; }
}
