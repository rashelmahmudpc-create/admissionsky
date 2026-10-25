/* F0.1 step 4a / DV-01 (Sky AI blueprint) - allowlist-gated proxy from
 * admission-gk to the sky-ai Worker over the SKY_AI service binding.
 *
 * SKY_AI_ROUTES is EMPTY on purpose: shipping this file changes nothing for
 * students. A route moves to sky-ai only after sky-ai really serves it, by
 * adding "METHOD /path" here. Rollback = remove it again.
 *
 * Safety: returns null (= caller keeps using the local handler) when the
 * binding is missing, the route is not listed, sky-ai answers 404 or 5xx, or
 * the call throws. The original request is cloned, so its body is still
 * readable by the local fallback. A client-supplied x-sky-uid is stripped so
 * nobody can impersonate a student through this hop.
 */

export const SKY_AI_ROUTES = Object.freeze([]);

export function routeKey(request) {
  return request.method + ' ' + new URL(request.url).pathname;
}

export function shouldRouteToSkyAi(request, env, routes = SKY_AI_ROUTES) {
  if (!env || !env.SKY_AI || typeof env.SKY_AI.fetch !== 'function') return false;
  return Array.isArray(routes) && routes.includes(routeKey(request));
}

export async function tryRouteToSkyAi(request, env, routes = SKY_AI_ROUTES) {
  if (!shouldRouteToSkyAi(request, env, routes)) return null;
  try {
    const copy = request.clone();
    const headers = new Headers(copy.headers);
    headers.delete('x-sky-uid');
    headers.set('x-sky-ai-caller', 'admission-gk');
    const hasBody = !['GET', 'HEAD'].includes(copy.method);
    const res = await env.SKY_AI.fetch(new Request(copy.url, {
      method: copy.method,
      headers,
      body: hasBody ? await copy.arrayBuffer() : undefined
    }));
    if (!res || res.status === 404 || res.status >= 500) return null;
    return res;
  } catch (_) {
    return null;
  }
}

/* F0.1 step 4b: routes that need the student's identity. admission-gk first
 * resolves the uid itself, then forwards it with a shared internal key read
 * from PUB_KV ("secret:sky-internal", created once by the owner). EMPTY on
 * purpose; add 'GET /api/ai/prefs' only after sky-ai is deployed with PUB_KV
 * and the key exists. Missing key / any sky-ai error -> null (local handler). */
export const SKY_AI_IDENTITY_ROUTES = Object.freeze([
  'GET /api/ai/prefs',
  'GET /api/ai/actions/audit',
  /* F0.2 / DV-02: evaluated flags for ONE student, so sky-ai needs the uid
   * admission-gk verified. A guest stays anonymous and keeps the defaults
   * (the local fallback in public-worker.js answers all-off). */
  'GET /api/ai/sky-flags',
  /* F0.1 step 4e: reading the student's saved note. The write methods for the
   * same path are in SKY_AI_BODY_IDENTITY_ROUTES below — the list is keyed on
   * "METHOD /path", so a GET here can never let a POST through. */
  'GET /api/ai/instructions'
]);
export const SKY_INTERNAL_KEY_NAME = 'secret:sky-internal';

/* F0.1 steps 4d–4e: identity routes that are not a plain GET. Kept separate from
 * the GET list above for two reasons:
 *
 *   - the body is the risk: a service binding consumes it, so the original has
 *     to be cloned or the local fallback answers as if the client sent nothing;
 *   - the method is part of the key. `shouldRouteToSkyAi` compares
 *     "METHOD /path", so adding a POST entry can never accidentally route a GET.
 *
 * Every entry is one line to add and one line to remove; that is the rollback. */
export const SKY_AI_BODY_IDENTITY_ROUTES = Object.freeze([
  'POST /api/ai/recall',
  'POST /api/ai/instructions',
  'DELETE /api/ai/instructions',
  'POST /api/ai/memory/clear',
  /* F0.1 step 4g: the write layer. admission-gk forwards these only while write
   * actions are enabled on ITS env — sky-ai has no USE_WRITE_ACTIONS, so a
   * forwarded call would otherwise resurrect a switched-off layer. */
  'POST /api/ai/actions/propose',
  'POST /api/ai/actions/confirm',
  /* F0.1 step 4h: the model call itself, last on purpose. sky-ai answers only
   * when it can reach every provider admission-gk can (see chat.mjs), so listing
   * it here is safe before the credentials are copied across. */
  'POST /api/ai/chat',
  'POST /api/ai'
]);

export async function forwardWithIdentityBody(request, env, uid, routes = SKY_AI_BODY_IDENTITY_ROUTES, extraHeaders = null) {
  // The allowlist carries the method, so this only needs to refuse the methods
  // that have no business carrying anything.
  if (!uid || ['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return null;
  if (!shouldRouteToSkyAi(request, env, routes) || !env.PUB_KV) return null;
  try {
    const key = await env.PUB_KV.get(SKY_INTERNAL_KEY_NAME);
    if (!key) return null;
    // Clone BEFORE reading: the caller's local handler still has to be able to
    // read this same body if anything below fails. Same trap F-04 hit.
    // DELETE has no body, and a Request with an empty ArrayBuffer would be sent
    // as a zero-length body — harmless, but `undefined` is what the local code
    // would have seen, so it is what gets forwarded.
    const body = await request.clone().arrayBuffer();
    const res = await env.SKY_AI.fetch(new Request(request.url, {
      method: request.method,
      headers: {
        // Only meaningful when there is a body; a DELETE with a content-type but
        // no body is odd enough to avoid.
        ...(body.byteLength ? { 'content-type': 'application/json' } : {}),
        'x-sky-ai-caller': 'admission-gk',
        'x-sky-uid': String(uid),
        'x-sky-internal': key,
        /* F0.1 step 4h: the chat route carries what the far side needs to answer
           IDENTICALLY — which providers must be reachable, the per-day cap, the
           model overrides and the request id the quota counter is keyed on. Sent
           only by the routes that pass them; everything else stays as before. */
        ...(extraHeaders && typeof extraHeaders === 'object' ? extraHeaders : {})
      },
      body: body.byteLength ? body : undefined
    }));
    if (!res || res.status === 404 || res.status >= 500) return null;
    return res;
  } catch (_) {
    return null;
  }
}

export async function forwardWithIdentity(request, env, uid, routes = SKY_AI_IDENTITY_ROUTES) {
  if (!uid || request.method !== 'GET') return null;
  if (!shouldRouteToSkyAi(request, env, routes) || !env.PUB_KV) return null;
  try {
    const key = await env.PUB_KV.get(SKY_INTERNAL_KEY_NAME);
    if (!key) return null;
    const res = await env.SKY_AI.fetch(new Request(request.url, {
      method: 'GET',
      headers: { 'x-sky-ai-caller': 'admission-gk', 'x-sky-uid': String(uid), 'x-sky-internal': key }
    }));
    if (!res || res.status === 404 || res.status >= 500) return null;
    return res;
  } catch (_) {
    return null;
  }
}
