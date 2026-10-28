/* F0.1 step 4e / DV-01 — /api/ai/instructions inside sky-ai.
 *
 * A signed-in student writes ONE short note ("সবসময় উদাহরণ দিয়ে বোঝাবে") that
 * Sky follows on every answer. Three methods: GET reads, POST saves, DELETE
 * clears.
 *
 * This is the first route that MOVED here that WRITES, so the risk is different
 * from recall's. Recall could only ever answer wrongly; this one can change what
 * a student stored. Two properties make it safe to move:
 *
 * 1. The write is SAFE TO REPEAT. The forwarded body is the student's note and
 *    nothing else, so writing it twice stores the same text. If sky-ai saves and
 *    its answer is lost on the way back, admission-gk falls back and saves the
 *    same note again: the note is unchanged, only its "saved at" stamp moves
 *    forward. That costs nothing a student can notice — this is the opposite of
 *    an OTP send, where a duplicate is the entire problem and the reason that
 *    path was never hedged.
 * 2. The RULES STAY IN ONE PLACE. checkInstruction() decides what may be saved,
 *    it lives in sky-instructions.mjs, and this file imports agentInstructions
 *    straight from ai-agent.js rather than copying it. A refused note is refused
 *    by the same code on both sides, and the 400 passes back through the hop
 *    unchanged (the forwarder only falls back on 404/5xx).
 *
 * Trust is the same as the other routes: sky-ai is reachable only through
 * admission-gk's service binding (workers_dev = false), and the caller must
 * prove itself with the shared internal key from PUB_KV. Anything missing
 * returns null, the worker answers 404, and admission-gk's own handler answers —
 * so a broken split degrades to the code that runs today.
 */

import { agentInstructions } from '../ai-agent.js';
import { INTERNAL_KEY_NAME, sameKey } from './prefs.mjs';

const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization,content-type,x-ah-app,x-ah-guest',
  'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
  'cache-control': 'no-store',
  'x-sky-ai-route': 'instructions'
};

const METHODS = new Set(['GET', 'POST', 'DELETE']);

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

export async function handleInstructions(request, env = {}) {
  if (!METHODS.has(request.method)) return null;
  const uid = await trusted(request, env);
  if (!uid) return null;

  // Only POST carries a note. DELETE means "clear", GET has no body at all.
  const body = request.method === 'POST' ? await request.json().catch(() => null) : null;
  const res = await agentInstructions(env, uid, request.method, body);
  // Re-wrapped rather than returned as-is: the route marker is what a deploy can
  // look for to tell "sky-ai answered" from "admission-gk answered". Status and
  // body are untouched, so a refusal reads exactly the same to the client.
  return new Response(res.body, { status: res.status, headers: { ...HEADERS } });
}
