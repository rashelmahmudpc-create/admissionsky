// Admission Sky, Public Product Worker (account system retired, v221)
// Active routes: public content · Firebase-account/ephemeral-guest AI · content admin.
// The former login/profile/onboarding/session/state APIs are intentionally absent.
import { agentChat, agentStatus, agentRecall, agentInstructions, sanitizeAiPrefs, AI_PREFS_DEFAULT, clearAiEverything, providerReadiness, readyProviderNames } from './ai-agent.js';
import { actionsEnabled } from './action-engine.js';
import { proposeAction, confirmAction, readAudit } from './ai-actions.mjs';
import { checkAbuse, isGuarded } from './p14-abuse-guard.mjs';
import { recordError, summarizeErrors } from './p19-error-monitor.mjs';
import { listReports } from './sky-daily-report.mjs';
import { forwardWithIdentity, forwardWithIdentityBody } from './sky-ai-route.mjs';
import { createSnapshot, listSnapshots, restoreSnapshot } from './p19-backup.mjs';

import { corsHeaders } from './cors-policy.mjs';
import { SKY_REQUEST_ID_HEADER, normalizeRequestId, mintRequestId } from './sky-request.mjs';

/* BUG-004 (2026-10-29 audit). This used to hardcode
   `Access-Control-Allow-Origin: *` on every JSON response, which let any site
   read them cross-origin and drive the header-based guest identity from a
   foreign page. The shared allowlist in cors-policy.mjs is the one the auth and
   gk workers already use, so this handler now honours it too: an allowed Origin
   is echoed, anything else gets no grant at all. */
const CORS_ALLOW_HEADERS = 'authorization,content-type,x-ah-app,x-ah-guest';
const json = (data, status = 200, request = null) => new Response(JSON.stringify(data), {
  status,
  headers: {
    'Content-Type': 'application/json',
    ...corsHeaders(request),
    'Access-Control-Allow-Headers': CORS_ALLOW_HEADERS,
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS'
  }
});
const onlyRows = rows => (Array.isArray(rows) ? rows : []).filter(row => row && row.id).map(row => {
  const clean = { ...row };
  for (const key of ['imageDataUrl', 'image', 'thumbnail']) {
    if (typeof clean[key] === 'string' && clean[key].startsWith('data:') && clean[key].length > 900000) delete clean[key];
  }
  return clean;
});
/* A cheap, deterministic string hash (FNV-1a). The signature must change when a
   word's meaning, synonym/antonym gloss or tips change, a length-only
   fingerprint does not, so a corrected gloss would never leave the KV blob: the
   D1 read path would keep serving the stale copy forever. */
const hashText = text => {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
};
/* Exported so P24 tooling can recompute the same signature the Worker signs a
   publish with; a hand-written copy would silently drift. */
export const fingerprintGlobal = doc => {
  const questions = doc.questions || [];
  const vocabularyMaster = doc.vocabularyMaster || [];
  const vocabulary = doc.vocabulary || [];
  // Per-word content hash, order-independent, so an edit changes the signature
  // without the cost of hashing the whole multi-megabyte document.
  let vmHash = 0;
  for (const row of vocabularyMaster) {
    const text = `${row.word}|${row.meaning}|${row.tips || ''}|` +
      (row.synonyms || []).map(r => `${r.word}=${r.meaning}`).join(',') + '|' +
      (row.antonyms || []).map(r => `${r.word}=${r.meaning}`).join(',');
    vmHash = (vmHash + parseInt(hashText(text), 36)) % 0xffffffff;
  }
  let vHash = 0;
  for (const row of vocabulary) {
    vHash = (vHash + parseInt(hashText(`${row.word}|${row.meaning}`), 36)) % 0xffffffff;
  }
  return [
    (doc.subjects || []).length,
    (doc.topics || []).length,
    questions.length,
    vocabulary.length,
    vocabularyMaster.length,
    questions.reduce((total, row) => total + String(row.question || row.q || '').length, 0),
    vmHash.toString(36),
    vHash.toString(36)
  ].join(':');
};
const countsOf = doc => ({
  subjects: (doc.subjects || []).length,
  topics: (doc.topics || []).length,
  questions: (doc.questions || []).length,
  vocabulary: (doc.vocabulary || []).length,
  vocabularyMaster: (doc.vocabularyMaster || []).length
});
/* Per-category totals ride in the meta (tiny, 26 keys) so the A–Z grid can show
   real numbers on a first-ever open, before the bank itself is written to the
   device. Kept out of countsOf on purpose: that object is compared byte-for-byte
   by verifyIntegrity, so widening it would flag every already-stored meta. */
const categoryCountsOf = doc => {
  const out = {};
  for (const row of (doc.vocabularyMaster || [])) {
    const key = row && row.category;
    if (key) out[key] = (out[key] || 0) + 1;
  }
  return out;
};
const paginateContent = (doc, limit, offset) => {
  if (!doc || typeof doc !== 'object') return doc;
  const rawLimit = Number(limit);
  const pageLimit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(500, rawLimit) : 0;
  const pageOffset = Math.max(0, Number(offset) || 0);
  if (!pageLimit) return doc;
  const out = { ...doc };
  for (const key of ['questions', 'vocabulary', 'vocabularyMaster', 'subjects', 'topics', 'exams']) {
    if (Array.isArray(doc[key])) out[key] = doc[key].slice(pageOffset, pageOffset + pageLimit);
  }
  out.total = Array.isArray(doc.questions) ? doc.questions.length : 0;
  out.page = { limit: pageLimit, offset: pageOffset };
  return out;
};
const sha256 = async value => {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(value || '')));
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
};
const dayKey = () => new Date().toISOString().slice(0, 10);
/* Constant-time string compare for the admin token (AI audit 2026-10-16). */
const tokenEquals = (a, b) => {
  const x = String(a == null ? '' : a); const y = String(b == null ? '' : b);
  if (!x || x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
};
const readGuestHeader = request => {
  const value = String(request.headers.get('X-AH-Guest') || '').trim();
  return /^[A-Za-z0-9_-]{16,96}$/.test(value) ? value : '';
};
const readCookie = (request, name) => {
  const header = String(request.headers.get('Cookie') || '');
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 1 || part.slice(0, index).trim() !== name) continue;
    try { return decodeURIComponent(part.slice(index + 1).trim()); } catch (_) { return ''; }
  }
  return '';
};
async function authenticatedAiIdentity(request, env) {
  const sessionToken = readCookie(request, '__Host-ah_session');
  if (!/^[A-Za-z0-9_-]{32,160}$/.test(sessionToken) || !env?.AUTH_AUTHORITY) return null;
  try {
    const id = env.AUTH_AUTHORITY.idFromName('admission-hub-global-auth-v1');
    const stub = env.AUTH_AUTHORITY.get(id);
    const response = await stub.fetch('https://auth.internal/internal/session/get', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionToken })
    });
    const payload = await response.json().catch(() => null);
    const userId = String(payload?.result?.user?.id || '');
    if (!response.ok || payload?.ok !== true || !/^[A-Za-z0-9_-]{8,128}$/.test(userId)) return null;
    return `account-${(await sha256(userId)).slice(0, 40)}`;
  } catch (_) { return null; }
}
async function anonymousAiIdentity(request, env, countUsage = true) {
  const supplied = readGuestHeader(request);
  const userAgent = String(request.headers.get('User-Agent') || '').slice(0, 180);
  const network = String(request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || 'unknown').split(',')[0].trim();
  const deviceHash = await sha256(supplied || `${network}|${userAgent}`);
  const networkHash = await sha256(network === 'unknown' ? `${network}|${userAgent}` : network);

  // Public AI remains usable without recreating a login system. A network-level
  // ceiling complements the per-anonymous-device cap inside agentChat.
  if (countUsage && env.PUB_KV) {
    const key = `aipub:${networkHash.slice(0, 24)}:${dayKey()}`;
    let count = 0;
    try { count = Number((await env.PUB_KV.get(key)) || 0); } catch (_) {}
    const cap = Math.max(40, Math.min(800, Number(env.AGENT_PUBLIC_DAILY_CAP || 240)));
    if (count >= cap) throw Object.assign(new Error('আজকের public AI সীমা শেষ, কাল আবার চেষ্টা করো।'), { status: 429 });
    try { await env.PUB_KV.put(key, String(count + 1), { expirationTtl: 172800 }); } catch (_) {}
  }
  return `guest-${deviceHash.slice(0, 40)}`;
}
async function aiRequestIdentity(request, env, countUsage = true) {
  const accountUid = await authenticatedAiIdentity(request, env);
  if (accountUid) return { uid: accountUid, persistMemory: true, authenticated: true };
  const uid = await anonymousAiIdentity(request, env, countUsage);
  return { uid, persistMemory: false, authenticated: false };
}

/* Is this request the owner's? The admin token is his own proof of identity, the
   same gate /api/admin/* uses. No token configured means nobody, which keeps the
   old fail-closed behaviour. */
const ownerRequest = (request, env) => {
  const token = String(request.headers.get('Authorization') || '').replace('Bearer ', '').trim();
  return Boolean(env.ADMIN_TOKEN) && tokenEquals(token, env.ADMIN_TOKEN);
};

/* What a NON-owner may see of the AI status. This is the only definition: the
   answer is applied to whatever body comes back, local or forwarded, so the split
   cannot leak a field by omission.
 *
 * Owner-only cost view: the provider list, model ids, the fallback chain, the
 * per-day limit and the pricing/observability block expose which keys are live
 * and what the AI costs.
 *
 * BUG-002 (2026-10-25 audit): the remaining blocks are an attacker's map, not the
 * student's. `state` names the state store and its schema version, `tools` lists
 * every declared tool with its permission and owner-scope, `memory` gives the
 * memory mode and scope, and `response` names the exact filter classes plus which
 * ones block — precisely the list to craft an evasion against. The app's own
 * shell (ok, agent, streaming, pv) is untouched, because the student's client
 * reads those. */
const REDACTED_STATUS_FIELDS = [
  'providers', 'models', 'chain', 'limits', 'observability',
  'state', 'tools', 'memory', 'response', 'actions', 'context'
];

const redactAiStatus = (data, isOwner) => {
  if (isOwner || !data || typeof data !== 'object') return data;
  const out = { ...data };
  for (const field of REDACTED_STATUS_FIELDS) delete out[field];
  return out;
};

/* The headers a status request needs across the service binding: which providers
   must be reachable, and the settings that shape the report (a different daily
   cap or model list would describe a different deployment). */
const statusHopHeaders = (env, needed) => {
  const headers = { 'x-sky-need-providers': needed.join(',') };
  for (const name of ['AGENT_DAILY_CAP', 'AGENT_GEMINI_MODELS', 'AGENT_GROQ_MODELS', 'AGENT_CLOUDFLARE_MODELS', 'AGENT_FIRST_CHUNK_MS']) {
    const value = env && env[name];
    if (value != null && String(value) !== '') headers['x-sky-env-' + name.toLowerCase().replace(/_/g, '-')] = String(value);
  }
  return headers;
};

/* F0.1 step 4h: the model call, with sky-ai given the first chance and
   admission-gk always the last word.

   Three things are decided HERE rather than inside the other room, because this
   Worker is where they are known for certain:

   1. ONE REQUEST ID per chat (`reqId`). It travels in the header AND is handed to
      the local agentChat, so the quota counter sees the same id on both sides and
      a repeated attempt replays the first decision instead of spending a second
      message from the student's daily allowance.
   2. WHICH PROVIDERS must be reachable. sky-ai answers only if it can reach every
      one of these (see sky-ai/chat.mjs); otherwise it declines and the local path
      below answers exactly as it does today. A room with fewer keys never gets to
      answer with a weaker model.
   3. THE SETTINGS that change the answer (daily cap, model overrides), so both
      sides behave identically rather than drifting apart silently.

   No providers here means nothing to gain: skip the hop and save the round trip. */
const chatWithFallback = async (request, env, identity, { stream }) => {
  /* F0.5 / GW-07: the id belongs to the TURN, not to this HTTP request. A
     client retrying the turn it just failed to get an answer for sends the id
     back, so the retry replays the first quota decision instead of spending a
     second message. An absent or malformed id is ignored, never an error. */
  const reqId = normalizeRequestId(request.headers.get(SKY_REQUEST_ID_HEADER)) || mintRequestId();
  const local = { stream, persistMemory: identity.persistMemory, reqId };
  let needed = [];
  try { needed = readyProviderNames(await providerReadiness(env)); } catch (_) { needed = []; }
  if (needed.length) {
    const headers = {
      'x-sky-need-providers': needed.join(','),
      'x-sky-req-id': reqId,
      'x-sky-persist-memory': identity.persistMemory === false ? '0' : '1'
    };
    for (const name of ['AGENT_DAILY_CAP', 'AGENT_GEMINI_MODELS', 'AGENT_GROQ_MODELS', 'AGENT_CLOUDFLARE_MODELS', 'AGENT_FIRST_CHUNK_MS']) {
      const value = env && env[name];
      if (value != null && String(value) !== '') headers['x-sky-env-' + name.toLowerCase().replace(/_/g, '-')] = String(value);
    }
    try {
      const viaSky = await forwardWithIdentityBody(request, env, identity.uid, undefined, headers);
      if (viaSky) return withRequestId(viaSky, reqId);
    } catch (_) { /* the local path below is the whole point of the fallback */ }
  }
  return withRequestId(await agentChat(request, env, identity.uid, local), reqId);
};

/* F0.5 / GW-07: hand the id back on every chat response. The body is NOT read
   or copied — the answer is a stream and buffering it would delay the first
   token — so the id rides as a header, which reaches the client before the
   first byte. `done` carries it too, inside the stream, for a client that only
   keeps the parsed events. */
const withRequestId = (response, reqId) => {
  try {
    const headers = new Headers(response.headers);
    headers.set(SKY_REQUEST_ID_HEADER, reqId);
    return new Response(response.body, { status: response.status, headers });
  } catch (_) { return response; }
};

export const publishGlobal = async (env, full) => {
  if (!env || !env.PUB_KV) return { error: 'no-pub-kv' };
  const source = full && typeof full === 'object' ? full : {};
  const subjects = onlyRows(source.subjects);
  const topics = onlyRows(source.topics);
  const questions = onlyRows(source.questions);
  const vocabulary = onlyRows(source.vocabulary);
  const vocabularyMaster = onlyRows(source.vocabularyMaster);
  /* An all-empty document is refused because it is almost always a bad call
     (a truncated payload or a failed pull), and publishing it would blank the
     live product. But a deliberate, owner-ordered erase sends QUESTIONS plus an
     emptied vocabulary bank, and that shape must be allowed through. So guard
     on "nothing at all", not on the vocabulary bank: questions alone are a
     legitimate document. */
  if (!questions.length && !vocabularyMaster.length && !subjects.length && !topics.length) return { error: 'empty' };

  const sig = fingerprintGlobal({ subjects, topics, questions, vocabulary, vocabularyMaster });
  let previousMeta = { v: 0 };
  try { previousMeta = JSON.parse((await env.PUB_KV.get('pubContentMeta')) || '{"v":0}'); } catch (_) {}
  if (previousMeta.sig === sig && previousMeta.v) {
    /* The body is unchanged, but a meta written before `categories` existed has
       no per-category totals, backfill them once so the A–Z grid can show real
       numbers on a first-ever open without a content re-publish. */
    const counts = previousMeta.counts || countsOf({ subjects, topics, questions, vocabulary, vocabularyMaster });
    if (!previousMeta.categories) {
      const categories = categoryCountsOf({ vocabularyMaster });
      try { await env.PUB_KV.put('pubContentMeta', JSON.stringify({ ...previousMeta, counts, categories })); } catch (_) {}
      return { published: false, unchanged: true, v: previousMeta.v, counts, categories };
    }
    return { published: false, unchanged: true, v: previousMeta.v, counts, categories: previousMeta.categories };
  }

  let exams = [{ id: 'mock1', title: 'মক পরীক্ষা ১', mins: 15, n: Math.min(15, questions.length || 1), published: true, desc: 'সব বিষয় মিশিয়ে' }];
  try {
    const previous = JSON.parse((await env.PUB_KV.get('pubContent')) || '{}');
    if (Array.isArray(previous.exams) && previous.exams.length) exams = previous.exams;
  } catch (_) {}

  const doc = { v: (Number(previousMeta.v) || 0) + 1, at: Date.now(), sig, subjects, topics, questions, vocabulary, vocabularyMaster, exams };
  const cap = Number(env.PUB_CONTENT_MAX_BYTES) > 0 ? Number(env.PUB_CONTENT_MAX_BYTES) : 24 * 1024 * 1024;
  let raw = JSON.stringify(doc);
  if (raw.length > cap) {
    doc.vocabularyMaster = (doc.vocabularyMaster || []).map(row => {
      const clean = { ...row };
      delete clean.imageDataUrl;
      delete clean.image;
      return clean;
    });
    raw = JSON.stringify(doc);
  }
  /* P14 integrity pre-check: never publish a blob that is oversized (the old
     `.slice(cap)` wrote truncated, unparseable JSON straight into KV) or whose
     round-trip fingerprint no longer matches what was signed. A refused publish
     leaves the previous good version serving. */
  if (raw.length > cap) return { error: 'too-large' };
  let roundTrip;
  try {
    roundTrip = JSON.parse(raw);
  } catch (_) {
    return { error: 'integrity' };
  }
  if (fingerprintGlobal(roundTrip) !== sig) return { error: 'integrity' };
  /* P13, mirror the small lists into D1 before the meta that signs them. The
     D1 read path serves the bank from `content_lists`, so a publish that
     removes rows must land in D1 too, or /api/content keeps serving the stale
     rows whose hash still matches. `content_lists` is the authoritative mirror:
     kinds that vanished from the document are deleted, present kinds replaced.
     Failure here is non-fatal, KV stays correct on its own, and the stale D1
     copy stops matching once the sig below changes. */
  if (env.PROFILE_DB) {
    try {
      await env.PROFILE_DB.prepare('CREATE TABLE IF NOT EXISTS content_lists (kind TEXT NOT NULL, id TEXT NOT NULL, ord INTEGER NOT NULL DEFAULT 0, payload TEXT NOT NULL, PRIMARY KEY (kind, id))').run();
      const present = [['subjects', subjects], ['topics', topics], ['vocabulary', vocabulary], ['vocabularyMaster', vocabularyMaster], ['exams', exams]];
      const gone = present.filter(([, rows]) => !rows.length).map(([kind]) => kind);
      if (gone.length) {
        await env.PROFILE_DB.prepare(`DELETE FROM content_lists WHERE kind IN (${gone.map(() => '?').join(',')})`).bind(...gone).run();
      }
      for (const [kind, rows] of present) {
        if (!rows.length) continue;
        await env.PROFILE_DB.prepare('DELETE FROM content_lists WHERE kind = ?').bind(kind).run();
        for (let i = 0; i < rows.length; i += 25) {
          const chunk = rows.slice(i, i + 25);
          await env.PROFILE_DB.prepare(
            `INSERT INTO content_lists (kind, id, ord, payload) VALUES ${chunk.map(() => '(?,?,?,?)').join(',')}`
          ).bind(...chunk.flatMap((row, j) => [kind, String(row.id), i + j, JSON.stringify(row)])).run();
        }
      }
    } catch (_) { /* D1 is a mirror: KV remains the source of truth */ }
  }
  await env.PUB_KV.put('pubContent', raw);
  const meta = { v: doc.v, at: doc.at, sig: doc.sig, counts: countsOf(doc), categories: categoryCountsOf(doc) };
  await env.PUB_KV.put('pubContentMeta', JSON.stringify(meta));
  return { published: true, v: doc.v, counts: meta.counts };
};

/* P14, content integrity. The published doc carries `sig`, a fingerprint of
   the live shapes, and `counts`. This recomputes both from the stored doc and
   reports any drift, so a publication that was silently mangled (or a tampered
   KV value) is visible from an admin check instead of surfacing as a user bug. */
export const verifyIntegrity = doc => {
  const source = doc && typeof doc === 'object' ? doc : {};
  const expected = fingerprintGlobal({
    subjects: onlyRows(source.subjects), topics: onlyRows(source.topics),
    questions: onlyRows(source.questions), vocabulary: onlyRows(source.vocabulary),
    vocabularyMaster: onlyRows(source.vocabularyMaster)
  });
  const counts = countsOf(source);
  const mismatches = [];
  if (source.sig && source.sig !== expected) mismatches.push('sig');
  if (source.counts && JSON.stringify(source.counts) !== JSON.stringify(counts)) mismatches.push('counts');
  return { ok: mismatches.length === 0, v: source.v || 0, sig: source.sig || '', expectedSig: expected, counts, mismatches };
};



const admin = async (request, env, path) => {
  const token = String(request.headers.get('Authorization') || '').replace('Bearer ', '').trim();
  if (!env.ADMIN_TOKEN || token !== env.ADMIN_TOKEN) return json({ error: 'forbidden' }, 403, request);
  if (path === '/api/admin/content' && request.method === 'GET') {
    const raw = await env.PUB_KV.get('pubContent');
    return json(raw ? JSON.parse(raw) : { v: 0, questions: [], vocabulary: [], exams: [] }, 200, request);
  }
  if (path === '/api/admin/verify' && request.method === 'GET') {
    const raw = await env.PUB_KV.get('pubContent');
    const doc = raw ? JSON.parse(raw) : {};
    const report = verifyIntegrity(doc);
    return json(report, report.ok ? 200 : 409, request);
  }
  if (path === '/api/admin/publish' && request.method === 'POST') {
    const body = await request.json().catch(() => ({}));
    let full = body.full && typeof body.full === 'object' ? body.full : null;
    if (body.pull) {
      const raw = env.OLD_KV ? await env.OLD_KV.get('userBank') : null;
      const bank = raw ? JSON.parse(raw) : {};
      if (bank.full && typeof bank.full === 'object') full = bank.full;
    }
    if (!full && Array.isArray(body.subjects) && Array.isArray(body.questions)) {
      full = { subjects: body.subjects, topics: body.topics, questions: body.questions, vocabulary: body.vocabulary, vocabularyMaster: body.vocabularyMaster };
    }
    if (full && Array.isArray(full.questions) && full.questions.some(row => row && row.id)) {
      const result = await publishGlobal(env, full);
      if (result.error === 'empty') return json({ error: 'প্রশ্ন খালি' }, 400, request);
      if (result.error === 'too-large') return json({ error: 'কনটেন্ট আকারসীমার বেশি, কমানো ছবি বাদ দিয়ে আবার চেষ্টা করো', code: 'too-large' }, 413, request);
      if (result.error === 'integrity') return json({ error: 'কনটেন্ট যাচাইয়ে ব্যর্থ, আগের সংস্করণই থাকল', code: 'integrity' }, 409, request);
      return json(result, 200, request);
    }
    return json({ error: 'প্রশ্ন খালি' }, 400, request);
  }
  if (path === '/api/admin/ai-daily-report' && request.method === 'GET') {
    /* Anonymous daily AI report, counts only, newest first. */
    const days = new URL(request.url).searchParams.get('days');
    return json(await listReports(env.PUB_KV, days || 7), 200, request);
  }
  if (path === '/api/admin/errors' && request.method === 'GET') {
    /* P19, what the Worker actually caught. Reads the same KV the catch block
       writes; an empty list is reported as empty, never padded. */
    let log = [];
    try {
      const raw = await env.PUB_KV.get('errlog:v1');
      log = raw ? JSON.parse(raw) : [];
    } catch (_) { log = []; }
    return json(summarizeErrors(log), 200, request);
  }
  if (path === '/api/admin/backup' && request.method === 'GET') {
    /* P19, what snapshots exist, newest first. Real index, never padded. */
    return json(await listSnapshots(env), 200, request);
  }
  if (path === '/api/admin/backup' && request.method === 'POST') {
    /* P19, take a snapshot now. The daily cron does this too; this is the
       on-demand door for the owner before a risky change. */
    try {
      const entry = await createSnapshot(env);
      return json({ ok: true, snapshot: entry }, 200, request);
    } catch (error) {
      return json({ ok: false, error: String(error?.message || error) }, 500, request);
    }
  }
  if (path === '/api/admin/restore' && request.method === 'POST') {
    /* P19, write a snapshot's KV keys back. Explicit key, explicit action:
       the body must name the snapshot, so a bare POST cannot guess a target. */
    const body = await request.json().catch(() => ({}));
    const key = String(body.key || '').trim();
    if (!key) return json({ ok: false, error: 'key-required' }, 400, request);
    const result = await restoreSnapshot(env, key);
    return json(result, result.ok ? 200 : 404, request);
  }
  return json({ error: 'not-found' }, 404, request);
};

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      /* Preflight metadata only advertises which headers/methods exist; the
         browser still requires a matching Access-Control-Allow-Origin on the
         real response, so the allow-list in corsHeaders is what actually
         decides access. */
      return new Response(null, { status: 204, headers: {
        ...corsHeaders(request),
        'Access-Control-Allow-Headers': CORS_ALLOW_HEADERS,
        'Access-Control-Allow-Methods': 'GET,POST,OPTIONS'
      } });
    }
    const url = new URL(request.url);
    const path = url.pathname;
    try {
      /* P14, public-API abuse ceiling. Counted per network, before any route
         work, so a scripted flood of AI/write calls is stopped at the edge
         rather than reaching the model or KV. Content GETs are excluded. */
      if (isGuarded(request, path)) {
        const guard = await checkAbuse(request, env, { salt: env.PUBLIC_RATE_SALT || '' });
        if (!guard.allowed) {
          return json({ error: 'rate_limited', message: 'একটু বেশি অনুরোধ এসেছে, কিছুক্ষণ পরে আবার চেষ্টা করো।', retryAfter: guard.retryAfter }, 429, request);
        }
      }
      if (path === '/api/health') return json({ ok: true, accountSystem: 'retired', legacyAccountSystem: 'retired', nativeAuth: 'cloudflare-native-v1', identity: 'firebase-account-or-ephemeral-guest', at: Date.now() }, 200, request);
      if (path === '/api/content/meta' && request.method === 'GET') {
        const raw = await env.PUB_KV.get('pubContentMeta');
        if (raw) {
          const meta = JSON.parse(raw);
          if (meta.categories) return json(meta, 200, request);
          /* One-time lazy backfill for a meta written before `categories`
             existed. The vocabulary bank now lives in D1, so read the small
             mirrored list there and fall back to the KV blob; fold the totals
             into the meta and store them back. After this the endpoint is a
             single small KV read again. */
          try {
            let vocabRows = null;
            if (env.PROFILE_DB) {
              const { createD1Reader } = await import('./p13-d1-read.mjs');
              const lists = await createD1Reader(env.PROFILE_DB).lists();
              if (lists && Array.isArray(lists.vocabularyMaster)) vocabRows = lists.vocabularyMaster;
            }
            if (!vocabRows) {
              const full = await env.PUB_KV.get('pubContent');
              const doc = full ? JSON.parse(full) : null;
              if (doc) vocabRows = doc.vocabularyMaster || [];
            }
            if (vocabRows) {
              const enriched = { ...meta, categories: categoryCountsOf({ vocabularyMaster: vocabRows }) };
              await env.PUB_KV.put('pubContentMeta', JSON.stringify(enriched));
              return json(enriched, 200, request);
            }
          } catch (_) { /* fall through to the un-enriched meta */ }
          return json(meta, 200, request);
        }
        const full = await env.PUB_KV.get('pubContent');
        const doc = full ? JSON.parse(full) : { v: 0, at: 0, questions: [] };
        return json({ v: doc.v || 0, at: doc.at || 0, sig: doc.sig || '', counts: countsOf(doc), categories: categoryCountsOf(doc) }, 200, request);
      }
      if (path === '/api/content' && request.method === 'GET') {
        /* P13, optional D1 fast path. Enabled by a flag row in content_meta
           (set by the p13-d1-backfill workflow), not by a Worker variable, so
           the Free-plan 64-variable cap is not touched. The D1 copy is served
           only when its stored sig matches /api/content/meta's live sig; the
           whole document is assembled from D1. Any mismatch or error falls back
           to the KV blob untouched. */
        if (env.PROFILE_DB) {
          try {
            const { createD1Reader } = await import('./p13-d1-read.mjs');
            const reader = createD1Reader(env.PROFILE_DB);
            if ((await reader.meta('mode')) === 'd1') {
              const rawMeta = await env.PUB_KV.get('pubContentMeta');
              const meta = rawMeta ? JSON.parse(rawMeta) : null;
              if (meta && meta.sig && (await reader.sig()) === String(meta.sig)) {
                const limit = Number(url.searchParams.get('limit'));
                if (Number.isFinite(limit) && limit > 0) {
                  /* P13, paged read. Pull one bounded page from D1 (keyset on
                     the indexed key), never the whole table: a full scan of a
                     large `questions` table is what blew the Worker CPU budget
                     and returned `1102`. The small mirrored lists ride along. */
                  const pageLimit = Math.min(500, limit);
                  const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0);
                  // Never fetch an unbounded window: offset+limit is capped so a
                  // crafted `offset` cannot force a full-table read again.
                  const window = Math.min(pageLimit + offset, 1000);
                  const paged = await reader.page({ limit: window });
                  if (paged && paged.items) {
                    const slice = offset < window ? paged.items.slice(offset, offset + pageLimit) : [];
                    const lists = (await reader.lists()) || {};
                    return json({
                      v: meta.v || 0, at: meta.at || 0, sig: meta.sig,
                      ...lists, questions: slice,
                      total: meta.counts && meta.counts.questions,
                      page: { limit: pageLimit, offset },
                      source: 'd1'
                    }, 200, request);
                  }
                }
                const document = await reader.document();
                if (document) return json({ v: meta.v || 0, at: meta.at || 0, sig: meta.sig, ...document, source: 'd1' }, 200, request);
              }
            }
          } catch (_) { /* fall through to KV */ }
        }
        const raw = await env.PUB_KV.get('pubContent');
        return json(paginateContent(raw ? JSON.parse(raw) : { v: 0, at: 0, questions: [], vocabulary: [], exams: [] }, url.searchParams.get('limit'), url.searchParams.get('offset')), 200, request);
      }
      if (path.startsWith('/api/admin/')) return admin(request, env, path);
      if (path === '/api/ai/status' && request.method === 'GET') {
        const identity = await aiRequestIdentity(request, env, false);
        /* F0.1 step 4i: sky-ai answers this when the route is listed in
           sky-ai-route.mjs — and it returns the COMPLETE body on purpose. What a
           caller may see is decided here, once, by redactAiStatus(), for the
           forwarded answer and the local one alike. The owner token exists only
           on this Worker, so a copy of that decision on the far side would be
           both impossible to trust and free to drift. */
        const isOwner = ownerRequest(request, env);
        let needed = [];
        try { needed = readyProviderNames(await providerReadiness(env)); } catch (_) { needed = []; }
        if (needed.length) {
          const headers = statusHopHeaders(env, needed);
          const viaSky = await forwardWithIdentity(request, env, identity.uid, undefined, headers);
          if (viaSky) {
            const data = await viaSky.json().catch(() => null);
            if (data) return json(redactAiStatus(data, isOwner), viaSky.status, request);
            // A body this Worker cannot parse is not worth showing; fall through.
          }
        }
        const res = await agentStatus(request, env, identity.uid);
        const data = await res.json().catch(() => null);
        return data ? json(redactAiStatus(data, isOwner), res.status, request) : res;
      }
      if (path === '/api/ai/prefs' && request.method === 'GET') {
        const identity = await aiRequestIdentity(request, env, false);
        /* F0.1 step 4b / DV-01: served by sky-ai only when 'GET /api/ai/prefs'
           is in SKY_AI_IDENTITY_ROUTES (empty) and the internal key exists;
           otherwise (or on any sky-ai error) the local code below answers. */
        const viaSky = await forwardWithIdentity(request, env, identity.uid);
        if (viaSky) return viaSky;
        let prefs = null;
        try {
          const raw = await env.PUB_KV.get('aiprefs:' + identity.uid);
          prefs = raw ? sanitizeAiPrefs(JSON.parse(raw)) : null;
        } catch (_) { prefs = null; }
        return json({ prefs: prefs || AI_PREFS_DEFAULT }, 200, request);
      }
      /* F0.2 / DV-02: this student's evaluated Sky flags (on/percent/beta/
         killed). Evaluated by sky-ai, which needs the uid admission-gk already
         verified; a guest keeps DEFAULT_FLAGS (every flag off), so shipping
         this changes nothing for anyone until a flag is turned on. */
      if (path === '/api/ai/sky-flags' && request.method === 'GET') {
        const identity = await aiRequestIdentity(request, env, false);
        const viaSky = identity.uid ? await forwardWithIdentity(request, env, identity.uid) : null;
        if (viaSky) return viaSky;
        return json({ ok: true, flags: {}, source: 'gk-fallback' }, 200, request);
      }
      if (path === '/api/ai/prefs' && request.method === 'POST') {
        const identity = await aiRequestIdentity(request, env, false);
        // Personalization is saved per ACCOUNT (guest uids are ephemeral by design).
        if (!identity.authenticated) return json({ error: 'sign_in_required', message: 'AI Personalization save-এর জন্য login দরকার।' }, 401, request);
        const body = await request.json().catch(() => null);
        const prefs = sanitizeAiPrefs(body);
        if (!prefs) return json({ error: 'invalid_prefs', message: 'সঠিক preference দাও।' }, 400, request);
        try {
          await env.PUB_KV.put('aiprefs:' + identity.uid, JSON.stringify(prefs));
        } catch (_) {
          return json({ error: 'save_failed', message: 'এখন save করা গেল না, আবার চেষ্টা করো।' }, 500, request);
        }
        return json({ ok: true, prefs }, 200, request);
      }
      /* Sky custom instructions (owner plan step 3): the student's own short
         note that Sky follows on every answer. Signed-in only; the note is
         checked on save (harmful / cheating / rule-breaking / PII refused). */
      if (path === '/api/ai/instructions' && (request.method === 'GET' || request.method === 'POST' || request.method === 'DELETE')) {
        const identity = await aiRequestIdentity(request, env, false);
        if (!identity.authenticated) return json({ error: 'sign_in_required', message: 'নির্দেশনা সেভ করতে লগইন করো।' }, 401, request);
        /* F0.1 step 4e: sky-ai answers this when the route is listed in
           sky-ai-route.mjs. The 401 above stays here because identity is resolved
           here. NOTE the body is read AFTER the forward, never before: reading it
           first would consume it and leave the fallback with nothing, so a failed
           forward would silently clear the student's note instead of saving it.
           The forwarder clones, so this request is still readable below. */
        const viaSky = request.method === 'GET'
          ? await forwardWithIdentity(request, env, identity.uid)
          : await forwardWithIdentityBody(request, env, identity.uid);
        if (viaSky) return viaSky;
        const body = request.method === 'POST' ? await request.json().catch(() => null) : null;
        return await agentInstructions(env, identity.uid, request.method, body);
      }
      /* AI audit 2026-10-16: the student's own "forget my AI memory". Signed-in
         only; clears conversation + long-term memory, personalization and the
         action audit. The daily quota is not reset. */
      if (path === '/api/ai/memory/clear' && request.method === 'POST') {
        const identity = await aiRequestIdentity(request, env, false);
        if (!identity.authenticated) return json({ error: 'sign_in_required', message: 'AI মেমরি মুছতে লগইন করো।' }, 401, request);
        /* F0.1 step 4f: sky-ai answers this when the route is listed in
           sky-ai-route.mjs. Forwarded BEFORE the local work, and the local work
           is idempotent (deleting the same keys twice is the same as once), so a
           lost answer can only cost a second, harmless attempt — never a
           half-cleared account. WHAT gets deleted is defined once, in
           clearAiEverything(). */
        const viaSky = await forwardWithIdentityBody(request, env, identity.uid);
        if (viaSky) return viaSky;
        try {
          await clearAiEverything(env, identity.uid);
        } catch (_) {
          return json({ error: 'clear_failed', message: 'এখন মুছে ফেলা গেল না, আবার চেষ্টা করো।' }, 500, request);
        }
        return json({ ok: true, message: 'তোমার AI মেমরি মুছে ফেলা হয়েছে।' }, 200, request);
      }
      /* M9: write/execute actions. Live by default (action-engine `ENABLED`);
         the kill-switch is the USE_WRITE_ACTIONS = "disabled" secret, which
         reaches this handler through envPub. Confirmation is single-use. */
      if (path === '/api/ai/actions/propose' && request.method === 'POST') {
        const identity = await aiRequestIdentity(request, env, false);
        if (!identity.authenticated) return json({ error: 'sign_in_required', message: 'AI action ব্যবহার করতে লগইন করো।' }, 401, request);
        /* F0.1 step 4g: sky-ai answers this when the route is listed in
           sky-ai-route.mjs — but ONLY while write actions are enabled here.
           sky-ai has no USE_WRITE_ACTIONS, so forwarding during a kill-switch
           would turn the switch back on. The body is read after the forward, so
           the fallback below still has it. */
        if (actionsEnabled(env)) {
          const viaSky = await forwardWithIdentityBody(request, env, identity.uid);
          if (viaSky) return viaSky;
        }
        const body = await request.json().catch(() => null);
        const r = await proposeAction(env, identity.uid, body);
        return json(r.body, r.status, request);
      }
      if (path === '/api/ai/actions/confirm' && request.method === 'POST') {
        const identity = await aiRequestIdentity(request, env, false);
        if (!identity.authenticated) return json({ error: 'sign_in_required', message: 'AI action ব্যবহার করতে লগইন করো।' }, 401, request);
        /* F0.1 step 4g. Confirming is the one route that CHANGES something on the
           student's behalf, and it is single-use by design: the proposal is
           consumed before the write. That ordering is what makes the fallback
           safe — if sky-ai confirms and the answer is lost, the retry below finds
           no proposal and refuses, so an action can be applied once at most. It
           can never be applied twice. */
        if (actionsEnabled(env)) {
          const viaSky = await forwardWithIdentityBody(request, env, identity.uid);
          if (viaSky) return viaSky;
        }
        const body = await request.json().catch(() => null);
        const r = await confirmAction(env, identity.uid, body);
        return json(r.body, r.status, request);
      }
      if (path === '/api/ai/actions/audit' && request.method === 'GET') {
        const identity = await aiRequestIdentity(request, env, false);
        if (!identity.authenticated) return json({ error: 'sign_in_required', message: 'AI action ব্যবহার করতে লগইন করো।' }, 401, request);
        /* F0.1 step 4c / DV-01: served by sky-ai (same body) only while write
           actions are enabled here (sky-ai has no USE_WRITE_ACTIONS); any sky-ai
           miss or error falls back to the local answer below. */
        if (actionsEnabled(env)) {
          const viaSky = await forwardWithIdentity(request, env, identity.uid);
          if (viaSky) return viaSky;
        }
        return json({ ok: true, actionsEnabled: actionsEnabled(env), audit: await readAudit(env, identity.uid) }, 200, request);
      }
      /* Sky recall (owner plan step 2): the reminder shown when the chat opens.
         Signed-in only; a guest or a no-memory session simply gets nothing. */
      if (path === '/api/ai/recall' && request.method === 'POST') {
        const identity = await aiRequestIdentity(request, env, false);
        if (!identity.authenticated) return json({ error: 'sign_in_required', recall: null }, 401, request);
        if (identity.persistMemory === false) return json({ ok: true, recall: null }, 200, request);
        /* F0.1 step 4d: sky-ai answers this when it is listed in
           SKY_AI_POST_IDENTITY_ROUTES. The two checks above stay here on
           purpose — the 401 and the "this student turned memory off" case are
           decisions about identity, and identity is resolved by this Worker.
           Anything sky-ai cannot serve (no binding, no internal key, a 404 or a
           5xx) returns null and the two lines below answer exactly as they do
           today. forwardPostWithIdentity clones the body for that reason. */
        const viaSky = await forwardWithIdentityBody(request, env, identity.uid);
        if (viaSky) return viaSky;
        const body = await request.json().catch(() => null);
        return await agentRecall(env, identity.uid, body);
      }
      if (path === '/api/ai/chat' && request.method === 'POST') {
        const identity = await aiRequestIdentity(request, env, false);
        /* M7: AI chat is signed-in only. Refuse the guest here, before the
           public rate-limit counter or any KV write, so a guest leaves no trace. */
        if (!identity.authenticated) return json({ error: 'sign_in_required', message: 'AI চ্যাট ব্যবহার করতে লগইন করো।' }, 401, request);
        return await chatWithFallback(request, env, identity, { stream: true });
      }
      if (path === '/api/ai' && request.method === 'POST') {
        const identity = await aiRequestIdentity(request, env, false);
        if (!identity.authenticated) return json({ error: 'sign_in_required', message: 'AI চ্যাট ব্যবহার করতে লগইন করো।' }, 401, request);
        return await chatWithFallback(request, env, identity, { stream: false });
      }
      return json({ error: 'not-found' }, 404, request);
    } catch (error) {
      const status = Number(error?.status) || 500;
      /* P19, an uncaught route failure must leave a trace. A 4xx is a caller
         mistake the caller already sees; only a real failure (5xx) is recorded,
         so the log stays a list of things that actually broke. Best-effort:
         recordError never throws and never delays the reply. */
      if (status >= 500) {
        await recordError(env, { path, method: request.method, status, message: error?.message || String(error) });
      }
      return json({ error: String(error?.message || error).slice(0, 180) }, status, request);
    }
  }
};
