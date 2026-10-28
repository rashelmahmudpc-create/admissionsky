/* F0.1 step 4d / DV-01 — POST /api/ai/recall inside sky-ai.
 *
 * The reminder Sky shows when the chat opens: recent mistakes plus the weak
 * topic. It was the safest route to move first because it only reads — no
 * write, no model call, no AI limit used.
 *
 * Two things had to be true before it could move, and both are checked rather
 * than assumed:
 *
 * 1. MEMORY STORAGE. agentRecall reads per-student memory from the AI_STATE
 *    Durable Object first and falls back to KV. That object is declared by
 *    admission-gk, so sky-ai binds it cross-script (`script_name` in
 *    wrangler.toml) — the same technique F-04 needed for AUTH_AUTHORITY. A DO id
 *    is scoped to the declaring script, so declaring the class here would have
 *    created a second, empty store and recall would quietly return nothing.
 *    /health reports whether the binding is really bound, so a deploy can prove
 *    it instead of trusting the config file.
 *
 * 2. NO LOGIC COPY. Unlike prefs.mjs (which copies two small pure functions),
 *    this imports agentRecall straight from ../ai-agent.js. esbuild tree-shakes,
 *    so the whole AI core is not bundled — measured: 72 KB for the single
 *    import. A copy would drift; an import cannot.
 *
 * Trust is the same as prefs/audit: sky-ai is reachable only through
 * admission-gk's service binding (workers_dev = false), and even so the caller
 * must prove itself with the shared internal key from PUB_KV. Anything missing
 * returns null, the worker answers 404, and admission-gk's local handler answers
 * instead — so a broken split degrades to the code that runs today.
 */

import { agentRecall } from '../ai-agent.js';
import { INTERNAL_KEY_NAME, sameKey } from './prefs.mjs';

const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization,content-type,x-ah-app,x-ah-guest',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'cache-control': 'no-store',
  'x-sky-ai-route': 'recall'
};

export async function handleRecallPost(request, env = {}) {
  const kv = env && env.PUB_KV;
  if (!kv || typeof kv.get !== 'function') return null;
  if (request.headers.get('x-sky-ai-caller') !== 'admission-gk') return null;
  const uid = request.headers.get('x-sky-uid') || '';
  const given = request.headers.get('x-sky-internal') || '';
  if (!uid || !given) return null;
  let key = null;
  try { key = await kv.get(INTERNAL_KEY_NAME); } catch (_) { return null; }
  if (!sameKey(key, given)) return null;

  // A body that is not JSON is not an error worth inventing an answer for:
  // agentRecall accepts null and answers with an empty recall, exactly as the
  // local handler does today.
  const body = await request.json().catch(() => null);
  const res = await agentRecall(env, uid, body);
  // Re-wrap rather than returning the agent's own Response: the route marker is
  // what a deploy can look for to tell "sky-ai answered" from "admission-gk
  // answered". The body and status are untouched.
  return new Response(res.body, { status: res.status, headers: { ...HEADERS } });
}
