/* Write / execute actions for the AI: propose and confirm, in ONE place.
 *
 * F0.1 step 4g. These two handlers used to live inline in public-worker.js. They
 * now have two callers — admission-gk (the fallback) and sky-ai — so they moved
 * here rather than being copied. A copy of the confirm path on the far side is
 * the worst kind of drift: the two sides could disagree about whether a proposal
 * is single-use, or about which owner a proposal belongs to.
 *
 * WHAT IS DELIBERATELY NOT HERE: identity. The caller resolves who is signed in
 * and passes a uid it has already verified; nothing in a request body can supply
 * an owner. That rule is unchanged from the inline version, and
 * action-engine.js still derives the owner from this uid alone
 * (resolveActionOwner), never from the body.
 *
 * THE KILL SWITCH is read here, from the env of whoever runs the code — so
 * admission-gk must not forward while its own switch says "disabled", because
 * sky-ai has no USE_WRITE_ACTIONS and would otherwise answer "enabled". That
 * guard lives at the call site in public-worker.js and is pinned by a test.
 *
 * Returns { status, body } instead of a Response so the shape stays testable and
 * both callers render it with their own json() helper.
 */
import {
  authorizeAction, makeProposal, confirmProposal,
  makeAuditRecord, parseAudit, appendAudit, STATUS, actionsEnabled
} from './action-engine.js';
import { sanitizeAiPrefs } from './ai-agent.js';

const PROPOSAL_KEY = (uid) => 'actprop:' + uid;
const AUDIT_KEY = (uid) => 'actaudit:' + uid;

export const readAudit = async (env, uid) => {
  try {
    const raw = await env.PUB_KV.get(AUDIT_KEY(uid));
    return parseAudit(raw, uid);
  } catch (_) { return []; }
};

export const writeAudit = async (env, uid, records) => {
  await env.PUB_KV.put(AUDIT_KEY(uid), JSON.stringify(records));
};

/* POST /api/ai/actions/propose — turn "do this" into something a student can
 * explicitly confirm. Nothing is executed here. */
export async function proposeAction(env, uid, body) {
  const name = String(body?.action || '');
  const auth = authorizeAction(name, { uid, args: body?.args, enabled: actionsEnabled(env) });
  if (!auth.allowed) return { status: 403, body: { error: 'action_denied', reason: auth.reason } };
  const proposal = makeProposal(name, { uid, args: auth.args, id: crypto.randomUUID(), enabled: actionsEnabled(env) });
  if (!proposal) return { status: 403, body: { error: 'action_denied', reason: 'no-proposal' } };
  try {
    await env.PUB_KV.put(PROPOSAL_KEY(uid), JSON.stringify(proposal), { expirationTtl: Math.ceil((proposal.expiresAt - Date.now()) / 1000) });
    const audit = await readAudit(env, uid);
    await writeAudit(env, uid, appendAudit(audit, makeAuditRecord({ proposal, status: STATUS.PROPOSED, uid }), uid));
  } catch (_) {
    return { status: 500, body: { error: 'propose_failed', message: 'এখন proposal তৈরি করা গেল না, আবার চেষ্টা করো।' } };
  }
  return {
    status: 200,
    body: {
      ok: true,
      proposal: {
        id: proposal.id, action: proposal.action, permission: proposal.permission,
        riskLevel: proposal.riskLevel, summary: proposal.summary, expiresAt: proposal.expiresAt
      }
    }
  };
}

/* POST /api/ai/actions/confirm — the single-use confirmation. The proposal is
 * consumed BEFORE the write so a replay finds nothing; that ordering is the
 * reason a retry can never execute the same action twice. */
export async function confirmAction(env, uid, body) {
  const token = String(body?.token || '');
  let stored = null;
  try {
    const raw = await env.PUB_KV.get(PROPOSAL_KEY(uid));
    stored = raw ? JSON.parse(raw) : null;
  } catch (_) { stored = null; }
  const decision = confirmProposal(stored, token, uid, { enabled: actionsEnabled(env) });
  if (!decision.ok) {
    const audit = await readAudit(env, uid);
    if (stored) await writeAudit(env, uid, appendAudit(audit, makeAuditRecord({ proposal: stored, status: decision.status, uid, detail: decision.reason }), uid));
    return { status: 403, body: { error: 'confirm_denied', reason: decision.reason } };
  }
  // Single-use: consume the proposal before the write so a replay finds nothing.
  try {
    await env.PUB_KV.delete(PROPOSAL_KEY(uid));
    if (decision.action === 'prefs.write') {
      const prefs = sanitizeAiPrefs(decision.args);
      await env.PUB_KV.put('aiprefs:' + uid, JSON.stringify(prefs));
    }
  } catch (_) {
    const audit = await readAudit(env, uid);
    await writeAudit(env, uid, appendAudit(audit, makeAuditRecord({ proposal: stored, status: STATUS.FAILED, uid, detail: 'write-failed' }), uid));
    return { status: 500, body: { error: 'action_failed', message: 'কাজটা সম্পন্ন করা গেল না, আবার চেষ্টা করো।' } };
  }
  const audit = await readAudit(env, uid);
  const record = makeAuditRecord({ proposal: stored, status: STATUS.CONFIRMED, uid });
  await writeAudit(env, uid, appendAudit(audit, record, uid));
  return { status: 200, body: { ok: true, action: decision.action, status: STATUS.CONFIRMED } };
}
