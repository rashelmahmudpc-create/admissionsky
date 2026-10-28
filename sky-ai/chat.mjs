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
import { trustedUid, missingProviders, applyEnvPassthrough } from './parity.mjs';

const PATHS = new Set(['/api/ai/chat', '/api/ai']);

/* The trust check and the provider-parity rule now live in parity.mjs, because
   status needs exactly the same two — see that file for what each one guarantees. */

export async function handleChat(request, env = {}) {
  if (request.method !== 'POST') return null;
  if (!PATHS.has(new URL(request.url).pathname)) return null;
  const uid = await trustedUid(request, env);
  if (!uid) return null;

  /* Parity is the gate: a room with fewer credentials would answer with a weaker
     model and report nothing. An empty expected list means admission-gk has no
     provider either, so there is nothing to gain by answering here. */
  if ((await missingProviders(request, env)).length) return null;

  const chatEnv = applyEnvPassthrough(env, request);

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
