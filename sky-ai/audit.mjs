/* F0.1 step 4c / DV-01 - GET /api/ai/actions/audit inside sky-ai.
 *
 * Same answer as admission-gk's public-worker.js handler:
 *   { ok: true, actionsEnabled, audit } with audit = parseAudit(PUB_KV "actaudit:<uid>").
 * parseAudit / actionsEnabled are imported from the shared action-engine.js (it has
 * no imports, so sky-ai bundles only that file), so the logic cannot drift.
 *
 * Trust: the uid is accepted ONLY with the shared internal key (PUB_KV
 * "secret:sky-internal"), exactly like prefs.mjs. admission-gk forwards here
 * only for signed-in students and only while write actions are enabled there,
 * so the 401 and the "disabled" cases keep being answered by admission-gk.
 * Anything missing -> null, the worker answers 404 and admission-gk falls back.
 */
import { parseAudit, actionsEnabled } from '../action-engine.js';
import { INTERNAL_KEY_NAME, sameKey } from './prefs.mjs';

const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization,content-type,x-ah-app,x-ah-guest',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'cache-control': 'no-store',
  'x-sky-ai-route': 'actions-audit'
};

export async function handleAuditGet(request, env = {}) {
  const kv = env && env.PUB_KV;
  if (!kv || typeof kv.get !== 'function') return null;
  if (request.headers.get('x-sky-ai-caller') !== 'admission-gk') return null;
  const uid = request.headers.get('x-sky-uid') || '';
  const given = request.headers.get('x-sky-internal') || '';
  if (!uid || !given) return null;
  let key = null;
  try { key = await kv.get(INTERNAL_KEY_NAME); } catch (_) { return null; }
  if (!sameKey(key, given)) return null;
  let audit = [];
  try { audit = parseAudit(await kv.get('actaudit:' + uid), uid); } catch (_) { audit = []; }
  return new Response(JSON.stringify({ ok: true, actionsEnabled: actionsEnabled(env), audit }), { status: 200, headers: HEADERS });
}
