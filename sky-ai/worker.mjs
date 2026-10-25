/* Sky AI Worker, F0.1 / DV-01 (blueprint v1.0, 2026-10-19).
 *
 * The new home for every /api/ai/* route. Step 1 (this file) is a skeleton
 * only: it answers a health check and nothing else, so deploying it changes
 * nothing for students. admission-gk keeps serving all AI traffic until a
 * later step adds the SKY_AI service binding and forwards routes behind a
 * feature flag, one route at a time.
 *
 * Why a separate Worker: admission-gk sits on the Workers Free ceiling of 64
 * variables (BUG-DV-001). sky-ai starts with zero, so new AI keys/config can
 * live here.
 */

import { loadFlags, evaluateAll } from './flags.mjs';
import { handlePrefsGet } from './prefs.mjs';
import { handleAuditGet } from './audit.mjs';
import { handleRecallPost } from './recall.mjs';
import { handleInstructions } from './instructions.mjs';
import { handleMemoryClear } from './memory-clear.mjs';
import { handleActionsPost } from './actions.mjs';
import { handleChat, chatReadiness } from './chat.mjs';
import { aiStateStore } from '../ai-state-do.mjs';

export const SKY_AI_VERSION = 'sky-ai-f0.1-4h-chat';

/* F0.1 step 4d: what /health reports about this Worker's dependencies.
 *
 * The split-out script is only as good as its bindings, and a missing or broken
 * one fails quietly — recall would fall back to KV and return an empty reminder
 * that looks like "this student has no memory yet". So the binding is reported
 * here, and the deploy asserts it.
 *
 * `aiState: 'missing'`  — no AI_STATE binding at all (wrangler.toml not deployed)
 * `aiState: 'error'`    — bound, but the call failed (wrong script_name, or the
 *                         declaring script does not export the class)
 * `aiState: 'ok'`       — a read reached the Durable Object and came back
 *
 * The probe is a READ of a key that does not exist: it costs one object request
 * and writes nothing, so calling /health never changes state. */
async function dependencies(env = {}) {
  const store = aiStateStore(env);
  if (!store) return { kv: Boolean(env && env.PUB_KV), aiState: 'missing' };
  try {
    await store.get('__health__', 'probe');
    return { kv: Boolean(env && env.PUB_KV), aiState: 'ok' };
  } catch (_) {
    return { kv: Boolean(env && env.PUB_KV), aiState: 'error' };
  }
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-sky-ai': SKY_AI_VERSION
    }
  });
}

export async function handle(request, env = {}) {
  const url = new URL(request.url);
  const path = url.pathname;

  if (request.method === 'GET' && (path === '/health' || path === '/api/ai/sky-health')) {
    return json({
      ok: true,
      service: 'sky-ai',
      version: SKY_AI_VERSION,
      /* Shows whether the call came through admission-gk's service binding
       * (internal header set by the caller) or straight from the internet. */
      via: request.headers.get('x-sky-ai-caller') === 'admission-gk' ? 'service-binding' : 'direct',
      deps: await dependencies(env),
      /* F0.1 step 4h: which AI providers THIS room can reach, by name only. Chat
       * refuses to answer when it is missing one that admission-gk has, so this is
       * the number to read when chat has not moved yet. */
      providers: await chatReadiness(env)
    });
  }

  /* F0.2 / DV-02: evaluated flags for one student. The uid is trusted only
   * when admission-gk (which verified the session) sets it on the internal
   * service-binding call; a direct internet caller is always anonymous. */
  if (request.method === 'GET' && path === '/api/ai/sky-flags') {
    const trusted = request.headers.get('x-sky-ai-caller') === 'admission-gk';
    const uid = trusted ? (request.headers.get('x-sky-uid') || '') : '';
    const flags = await loadFlags(env);
    return json({ ok: true, version: SKY_AI_VERSION, flags: evaluateAll(flags, uid || null) });
  }

  /* F0.1 step 4b: GET /api/ai/prefs (internal-key protected, see prefs.mjs). */
  if (request.method === 'GET' && path === '/api/ai/prefs') {
    const res = await handlePrefsGet(request, env);
    if (res) return res;
  }

  /* F0.1 step 4c: GET /api/ai/actions/audit (internal-key protected, see audit.mjs). */
  if (request.method === 'GET' && path === '/api/ai/actions/audit') {
    const res = await handleAuditGet(request, env);
    if (res) return res;
  }

  /* F0.1 step 4e: /api/ai/instructions — GET reads, POST saves, DELETE clears
   * (internal-key protected, see instructions.mjs). The first moved route that
   * writes, so the note about idempotence in that file is worth reading before
   * touching it. */
  if (['GET', 'POST', 'DELETE'].includes(request.method) && path === '/api/ai/instructions') {
    const res = await handleInstructions(request, env);
    if (res) return res;
  }

  /* F0.1 step 4f: POST /api/ai/memory/clear — the student's own "forget"
   * (internal-key protected, see memory-clear.mjs). Idempotent, which is what
   * makes the admission-gk fallback safe for a destructive route. */
  if (request.method === 'POST' && path === '/api/ai/memory/clear') {
    const res = await handleMemoryClear(request, env);
    if (res) return res;
  }

  /* F0.1 step 4h: POST /api/ai/chat (and the non-streaming /api/ai) — the real
   * model call (internal-key protected, see chat.mjs). Refuses unless this room
   * can reach every provider admission-gk can, so a partial key set can never
   * quietly answer with a weaker model. */
  if (request.method === 'POST' && (path === '/api/ai/chat' || path === '/api/ai')) {
    const res = await handleChat(request, env);
    if (res) return res;
  }

  /* F0.1 step 4g: POST /api/ai/actions/propose and /confirm — the write layer
   * (internal-key protected, see actions.mjs). Refuses when the layer is off, so
   * admission-gk keeps answering the kill-switch case. */
  if (request.method === 'POST' && path.startsWith('/api/ai/actions/') && path !== '/api/ai/actions/audit') {
    const res = await handleActionsPost(request, env);
    if (res) return res;
  }

  /* F0.1 step 4d: POST /api/ai/recall (internal-key protected, see recall.mjs).
   * The first route that takes a body, so it is also the first that can lose one:
   * admission-gk clones the request before forwarding, and its fallback re-reads
   * the original. Both sides are covered by tests. */
  if (request.method === 'POST' && path === '/api/ai/recall') {
    const res = await handleRecallPost(request, env);
    if (res) return res;
  }

  /* Nothing else is served yet. A clear 404 (not a silent fallback) makes a
   * mis-routed request obvious in logs instead of looking like an AI error. */
  return json({ ok: false, error: 'not-implemented-in-sky-ai', path }, 404);
}

export default {
  async fetch(request, env, ctx) {
    try {
      return await handle(request, env);
    } catch (_) {
      return json({ ok: false, error: 'sky-ai-internal' }, 500);
    }
  }
};
