/* F0.1 step 4g — /api/ai/actions/propose and /api/ai/actions/confirm in sky-ai.
 *
 * The write/execute layer: the student asks for a change, the server builds a
 * proposal, the student taps "yes", and only then does anything happen.
 *
 * THE LOGIC IS NOT COPIED. Both routes call proposeAction()/confirmAction() from
 * ai-actions.mjs — the same functions admission-gk's fallback calls. A copy here
 * would be the worst kind of drift, because the properties that matter are
 * orderings: the proposal is consumed BEFORE the write (single-use), and the
 * owner comes from the verified uid, never from the body.
 *
 * THE KILL SWITCH. `USE_WRITE_ACTIONS = "disabled"` is read from whoever runs the
 * code. This Worker has no such var, so actionsEnabled() is true here — which is
 * exactly why admission-gk must not FORWARD while its own switch is off. That
 * guard is in public-worker.js and is pinned by a test there. As a second line,
 * this handler also refuses when its own env says disabled, so a var set here
 * later cannot be silently ignored.
 *
 * WHY A RETRY CANNOT DOUBLE-EXECUTE. admission-gk falls back when the answer is
 * lost (404/5xx/throw). A retry that reaches the fallback finds the proposal
 * already consumed and is refused — so the action is applied once at most, never
 * twice. The mirror image is a "denied" message over an action that did happen;
 * that is a wording problem, not a data problem, and the audit record written by
 * the side that acted is the source of truth.
 */

import { proposeAction, confirmAction } from '../ai-actions.mjs';
import { actionsEnabled } from '../action-engine.js';
import { INTERNAL_KEY_NAME, sameKey } from './prefs.mjs';

const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Headers': 'authorization,content-type,x-ah-app,x-ah-guest',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
  'cache-control': 'no-store'
};

const PATH_MARKER = {
  '/api/ai/actions/propose': 'actions-propose',
  '/api/ai/actions/confirm': 'actions-confirm'
};

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

export async function handleActionsPost(request, env = {}) {
  if (request.method !== 'POST') return null;
  const marker = PATH_MARKER[new URL(request.url).pathname];
  if (!marker) return null;
  const uid = await trusted(request, env);
  if (!uid) return null;
  if (!actionsEnabled(env)) return null; // let admission-gk answer "layer-disabled"

  const body = await request.json().catch(() => null);
  const result = marker === 'actions-propose'
    ? await proposeAction(env, uid, body)
    : await confirmAction(env, uid, body);
  return new Response(JSON.stringify(result.body), {
    status: result.status,
    headers: { ...HEADERS, 'x-sky-ai-route': marker }
  });
}
