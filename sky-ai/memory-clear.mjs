/* F0.1 step 4f — /api/ai/memory/clear inside sky-ai.
 *
 * The student's own "forget my AI memory" button. This is the first moved route
 * that DESTROYS data, so the reasoning is written down rather than assumed.
 *
 * WHAT IS DELETED is defined in exactly one place: clearAiEverything() in
 * ai-agent.js. It removed the split that used to exist (three keys here, four
 * more inline in public-worker.js) as soon as this route would have had two
 * callers: a copied list of key names on the far side would drift, and a student
 * who pressed "forget" would be told their memory was gone while their saved
 * instructions or action history stayed behind.
 *
 * WHY FALLING BACK IS SAFE. Deleting a key twice is the same as deleting it
 * once. If sky-ai clears the account and its answer is lost on the way back,
 * admission-gk falls back and clears the same keys again — the end state is
 * identical, so the retry cannot do harm. That is the reason this route may be
 * hedged at all, and it is the opposite of an OTP send, where a repeated
 * delivery is the whole problem.
 *
 * WHAT IS NOT DUPLICATED. The signed-in check stays in admission-gk because
 * identity is resolved there; a guest never reaches this file with a usable uid
 * because clearAiEverything() refuses anything that is not an `account-` uid. A
 * 500 passes back through the hop unchanged (the forwarder only falls back on
 * 404/5xx), so a half-cleared account can never be reported as a success.
 */

import { clearAiEverything } from '../ai-agent.js';
import { INTERNAL_KEY_NAME, sameKey } from './prefs.mjs';

const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization,content-type,x-ah-app,x-ah-guest',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
  'cache-control': 'no-store',
  'x-sky-ai-route': 'memory-clear'
};

const MESSAGE = 'তোমার AI মেমরি মুছে ফেলা হয়েছে।';
const FAILED = 'এখন মুছে ফেলা গেল না, আবার চেষ্টা করো।';

async function trusted(request, env) {
  const kv = env && env.PUB_KV;
  if (!kv || typeof kv.get !== 'function' || typeof kv.delete !== 'function') return null;
  if (request.headers.get('x-sky-ai-caller') !== 'admission-gk') return null;
  const uid = request.headers.get('x-sky-uid') || '';
  const given = request.headers.get('x-sky-internal') || '';
  if (!uid || !given) return null;
  let key = null;
  try { key = await kv.get(INTERNAL_KEY_NAME); } catch (_) { return null; }
  return sameKey(key, given) ? uid : null;
}

export async function handleMemoryClear(request, env = {}) {
  if (request.method !== 'POST') return null;
  const uid = await trusted(request, env);
  if (!uid) return null;

  let result = null;
  try {
    result = await clearAiEverything(env, uid);
  } catch (_) {
    return new Response(JSON.stringify({ error: 'clear_failed', message: FAILED }), { status: 500, headers: { ...HEADERS } });
  }
  // A guest uid is not an account, so nothing was cleared. Saying "cleared" here
  // would be a lie, and the local handler answers the same way.
  if (!result || result.ok === false) {
    return new Response(JSON.stringify({ error: 'clear_failed', message: FAILED }), { status: 500, headers: { ...HEADERS } });
  }
  return new Response(JSON.stringify({ ok: true, message: MESSAGE }), { status: 200, headers: { ...HEADERS } });
}
