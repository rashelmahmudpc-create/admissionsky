/* F0.1 step 4i — /api/ai/status inside sky-ai. The last route of the split.
 *
 * This one was BLOCKED for a day, on purpose. Status is a report about which AI
 * engines and models are reachable, and while the provider keys lived only on
 * admission-gk a status served from here would have said `providers: all false`,
 * an empty chain and a default daily cap — a confidently wrong dashboard. The
 * chat step proved the keys are visible from this room; only then does this
 * route become honest, and that is why it is last.
 *
 * WHAT IS *NOT* MOVED: the owner-only redaction. The provider list, model ids,
 * the fallback chain, the daily limit and the observability block are owner
 * business, and the owner proves himself with ADMIN_TOKEN — which exists on
 * admission-gk, not here. So this handler returns the COMPLETE body and
 * admission-gk decides what to reveal, for both the local and the forwarded
 * answer, through one function. Copying the redaction list into this file would
 * be exactly the drift that leaks a field nobody remembered: the previous audit
 * (BUG-002) had to add six more names to that list after the fact.
 *
 * PARITY still applies, for the same reason as chat: a room that can reach fewer
 * providers reports `providers: {gemini:false}` and a shorter chain, which reads
 * as "the AI lost a provider" when nothing is wrong. Refusing sends the request
 * to admission-gk, which answers exactly as it does today.
 */

import { agentStatus } from '../ai-agent.js';
import { trustedUid, missingProviders, applyEnvPassthrough } from './parity.mjs';

const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization,content-type,x-ah-app,x-ah-guest',
  'Access-Control-Allow-Methods': 'GET,OPTIONS',
  'cache-control': 'no-store',
  'x-sky-ai-route': 'status'
};

export async function handleStatus(request, env = {}) {
  if (request.method !== 'GET') return null;
  if (new URL(request.url).pathname !== '/api/ai/status') return null;
  const uid = await trustedUid(request, env);
  if (!uid) return null;
  if ((await missingProviders(request, env)).length) return null;

  const statusEnv = applyEnvPassthrough(env, request);
  const res = await agentStatus(request, statusEnv, uid);
  // Everything is passed through unchanged, owner fields included: the caller
  // redacts. A status body is small and not streamed, so nothing is buffered
  // that the student was waiting for.
  const body = await res.text();
  return new Response(body, { status: res.status, headers: HEADERS });
}
