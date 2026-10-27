// v133b: public-product module
import pubHandler, { publishGlobal } from './public-worker.js';
import { tryRouteToSkyAi } from './sky-ai-route.mjs';
import { providerReadiness, readyProviderNames } from './ai-agent.js';
import { syncProviderKeysToKv } from './ai-key-sync.mjs';
import { runDailyReport } from './sky-daily-report.mjs';
import { handleInternalEmailRequest } from './email-gateway/worker/handler.mjs';
import { createNativeAuthHandler } from './auth-native/worker/public-auth-handler.mjs';
/* F-04 phase 2: AUTH_ROUTE = "service" forwards the auth surface to the
 * admission-auth Worker; anything else keeps the in-process handler. */
import { routeAuthRequest } from './auth-native/worker/auth-route.mjs';
import { handleFcmNotificationRequest, runScheduledGlobalNotifications } from './fcm-notification.mjs';
import { handleAdminPasskeyRequest } from './admin-passkey.mjs';
import { handlePersonalizedNotificationRequest, runScheduledPersonalizedNotifications } from './personalized-notification.mjs';
import { handleIntelligenceRequest, runScheduledIntelligenceNotifications } from './notification-intelligence.mjs';
import { runScheduledEventNotifications } from './event-notifications.mjs';
import { runScheduledDigests } from './digest-notifications.mjs';
import { handleUserDataRequest } from './userdata-api.mjs';
/* Phase 4, unified analytics & smart insights (owns /api/analytics/*). */
import { handleAnalyticsRequest } from './analytics-engine.mjs';
/* Phase 5, AI analytics intelligence (owns /api/analytics/ai/*; registered
 * before the Phase 4 handler, which claims the wider prefix). */
import { handleAiAnalyticsRequest } from './ai-analytics-routes.mjs';
import { aiGenerate } from './ai-analytics-provider.mjs';
import { handleFilesStorageRequest } from './files-storage.mjs';
import { handleSkyContactRequest } from './sky-contact.mjs';
/* P13, gzip/br for large JSON replies (read path scale). */
import { compressResponse } from './p13-api-compression.mjs';
import { createSnapshot } from './p19-backup.mjs';
/* P25, the daily cache sweep needs the store class here as well. */
import { AiAnalyticsStore } from './ai-analytics-store.mjs';
export { EmailGatewayCoordinator } from './email-gateway/worker/email-coordinator.mjs';
export { AdmissionAuthAuthority } from './auth-native/worker/auth-authority-do.mjs';
/* P23, live voice agent. One Durable Object per owner holds the socket and the
 * durable memory, so a provider-key swap never loses context. */
export { VoiceAgentSession } from './voice-agent.mjs';
/* Per-user AI state (quota + memory) moved out of Workers KV, whose free plan
 * allows 1,000 writes a day and capped the whole chat feature. */
export { AiStateObject } from './ai-state-do.mjs';

const nativeAuthHandler = createNativeAuthHandler();
/**
 * 🤖 ADMISSION HUB, Daily GK Agent Worker
 * v111 · Browser Use cloud (৩ key failover) → দিনে মাত্র ১ রান → GK MCQ + verified admission news
 *
 * Secrets:
 *   BROWSER_USE_API_KEYS, কমা-দিয়ে আলাদা করা ৩টা Browser Use cloud key (একাউন্ট ১,২,৩)
 *   TG_BOT_TOKEN, TG_CHAT_ID, রান শেষে Telegram খবর
 * KV: GK_KV (namespace admission-gk-kv)
 * Cron: 30 18 * * * (UTC) = রাত ০০:৩০ ঢাকা, অ্যাপ না খুললেও দিনে ১ বার
 *
 * নীতি: প্রতিদিন ঠিক ১টা run (KV date-guard)। key শেষ/না-চলা (401/402/429) হলে
 * স্বয়ংক্রিয়ভাবে পরের key, সেদিনের জন্য ও key আর চেষ্টা হয় না।
 */

const APP_HEADER = 'admission-hub';
const BU_BASE = 'https://api.browser-use.com/api/v2';
const POLL_EVERY_MS = 30000;
const POLL_MAX_MS = 15 * 60000;

const GK_SCHEMA = {
  type: 'object',
  properties: {
    questions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          q: { type: 'string' },
          options: { type: 'array', items: { type: 'string' } },
          answer: { type: 'string' },
          explain: { type: 'string' },
          source: { type: 'string' }
        },
        required: ['q', 'options', 'answer']
      }
    }
  },
  required: ['questions']
};
const NEWS_SCHEMA = {
  type: 'object',
  properties: {
    news: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          date: { type: 'string' },
          summary: { type: 'string' },
          source: { type: 'string' },
          url: { type: 'string' }
        },
        required: ['title', 'summary']
      }
    }
  },
  required: ['news']
};

/* BUG-002 (2026-10-26 audit). The allowlist used to accept localhost /
   127.0.0.1 (and *.e2b.app) as well, which let any page served on a developer
   machine make credentialed cross-origin calls and read the response with the
   signed-in student's session. Production stopped accepting those on
   2026-10-22 in cors-policy.mjs, but this handler kept its own copy. The
   preview origin is now opt-in via ALLOW_PREVIEW_ORIGINS, unset in production. */
let previewOriginsAllowed = false;
const cors = request => {
  const origin = request.headers.get('Origin') || '';
  const ok = /^https:\/\/([a-z0-9-]+\.)?(admissionsky|admissionhub)\.pages\.dev$/.test(origin)
    || (previewOriginsAllowed && /^https:\/\/[a-z0-9-]+\.e2b\.app$/.test(origin));
  const headers = { 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, X-AH-App', 'Access-Control-Max-Age': '86400' };
  if (ok) headers['Access-Control-Allow-Origin'] = origin;
  return headers;
};
const json = (request, obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...cors(request) } });

/* BUG-001 (2026-10-25 audit). X-AH-App is a hardcoded literal that ships in
   client code (cloud-content-sync.js, vocabulary-elevenlabs.js), so it is a
   routing hint and never a credential: anyone who reads the bundle can forge
   it. These helpers give the state-changing routes a real proof of identity. */
const tokenEquals = (a, b) => {
  const x = String(a == null ? '' : a); const y = String(b == null ? '' : b);
  if (!x || x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
};
const ownerProof = (request, env) => {
  if (!env || !env.ADMIN_TOKEN) return false;
  const bearer = String(request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
  const header = String(request.headers.get('X-AH-Admin-Token') || '').trim();
  return tokenEquals(bearer, env.ADMIN_TOKEN) || tokenEquals(header, env.ADMIN_TOKEN);
};
const readSessionCookie = request => {
  const raw = String(request.headers.get('Cookie') || '');
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i < 1 || part.slice(0, i).trim() !== '__Host-ah_session') continue;
    try { return decodeURIComponent(part.slice(i + 1).trim()); } catch (_) { return ''; }
  }
  return '';
};
const verifiedSession = async (request, env) => {
  const token = readSessionCookie(request);
  if (!/^[A-Za-z0-9_-]{32,160}$/.test(token) || !env || !env.AUTH_AUTHORITY) return false;
  try {
    const id = env.AUTH_AUTHORITY.idFromName('admission-hub-global-auth-v1');
    const stub = env.AUTH_AUTHORITY.get(id);
    const res = await stub.fetch('https://auth.internal/internal/session/get', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionToken: token })
    });
    const payload = await res.json().catch(() => null);
    return res.ok && payload?.ok === true && !!payload?.result?.user?.id;
  } catch (_) { return false; }
};
const dhakaToday = () => new Date(Date.now() + 6 * 3600000).toISOString().slice(0, 10);
const sleep = ms => new Promise(r => setTimeout(r, ms));

const keys = env => String(env.BROWSER_USE_API_KEYS || '').split(',').map(k => k.trim()).filter(Boolean);

const badKeysToday = async (env, date, ns = 'gk') => {
  try { return JSON.parse(await env.GK_KV.get(`badKeys:${date}:${ns}`) || '[]'); } catch (_) { return []; }
};
const markBad = async (env, date, index, ns = 'gk') => {
  try {
    const bad = await badKeysToday(env, date);
    if (!bad.includes(index)) { bad.push(index); await env.GK_KV.put(`badKeys:${date}:${ns}`, JSON.stringify(bad)); }
  } catch (_) {}
};

// একটা key দিয়ে task তৈরি; 401/402 → dead, 429 → busy
const tryCreate = async (key, body) => {
  try {
    const resp = await fetch(`${BU_BASE}/tasks`, {
      method: 'POST',
      headers: { 'X-Browser-Use-API-Key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (resp.status === 401 || resp.status === 402) return { dead: true };
    if (resp.status === 429) return { busy: true };
    if (!resp.ok) return { error: 'http-' + resp.status };
    const data = await resp.json();
    return data?.id ? { id: data.id } : { error: 'no-id' };
  } catch (_) { return { error: 'network' }; }
};

const createWithFailover = async (env, date, body, shift = 0, forceKeys = null) => {
  const all = forceKeys || keys(env);
  if (!all.length) return null;
  const ns = forceKeys ? 'ask' : 'gk'; // forceKeys-এর index আলাদা নেমস্পেসে, GK-পুল অক্ষত
  const bad = await badKeysToday(env, date, ns); // 401/402, সেদিনের জন্য মৃত
  // দৈনিক রোটেশন: প্রতিদিন ভিন্ন key দিয়ে শুরু, কোটা সব key-এ সমান ভাগে খরচ হয়
  const dayIndex = Math.floor(Date.parse(date + 'T00:00:00+06:00') / 86400000);
  const offset = ((((dayIndex % all.length) + all.length) % all.length) + shift) % all.length;
  const busy = new Set(); // 429/নেটওয়ার্ক, শুধু এই রানে স্কিপ, key বাতিল নয়
  for (let i = 0; i < all.length; i++) {
    const idx = (offset + i) % all.length;
    if (bad.includes(idx) || busy.has(idx)) continue;
    const result = await tryCreate(all[idx], body);
    if (result.id) return { id: result.id, keyIndex: idx };
    if (result.dead) { await markBad(env, date, idx, ns); continue; }
    busy.add(idx);
  }
  return null;
};

const GK_PROMPT = date => `Today's date is ${date} (Bangladesh, Asia/Dhaka). You are preparing daily current-affairs GK practice for Bangladeshi university admission candidates.
Browse credible Bangladeshi and international sources today, e.g. prothomalo.com, bangla.bdnews24.com, jagonews24.com, kalerkantho.com, ittefaq.com.bd, bbc.com/bengali, samakal.com, and any reliable reference pages needed for verification.
Collect 15-25 multiple-choice current-affairs/GK questions useful for university admission tests. CORRECTNESS IS THE #1 PRIORITY, a single wrong fact is a critical failure. Rules:
- Double-source rule: every question's fact MUST be verified during this session by actually OPENING at least 2 independent credible pages (e.g. a news site + a second outlet or an official/reference page). One search-result snippet is NOT enough.
- If you cannot confirm a fact from 2 sources, DROP that question. Skip anything uncertain, ambiguous or time-sensitive-until-confirmed.
- Prefer the last ~30 days: national BD news, international, sports, science-tech, awards, economy, and important anniversaries.
- Write the question in Bangla (short), options in Bangla (exactly 4, one clearly correct), "answer" must exactly match one option, "explain" is one short Bangla line, "source" is the site name or URL you verified from.
- No duplicates, no opinion-based questions, no placeholder text.
- STRICT FORBIDDEN: do NOT use your memory/training knowledge alone for any fact, everything must come from pages you opened today. Do not guess dates, numbers, names or award winners.`;

const NEWS_PROMPT = date => `Today's date is ${date} (Bangladesh, Asia/Dhaka). You are a news researcher for Bangladeshi university-admission candidates. Find the LATEST verified admission news (last 2-3 days, today first).
Categories: application circular openings & deadlines, exam dates, seat plans, admit cards, results, admission requirements/fees, for DU, BUET, CU, JU, RU, RUET, CUET, SUST, GST/GUST cluster, agricultural universities and major private universities.
You MUST actually OPEN and read at least 6-8 of these verified sources before concluding (visit several, not just one):
- National dailies & TV: prothomalo.com, bangla.bdnews24.com, kalerkantho.com, ittefaq.com.bd, samakal.com, jagonews24.com, banglatribune.com, bbc.com/bengali, somoynews.tv, channelsonline.com
- Discovery: also search Google News (news.google.com) for "admission circular", "admission test date" etc. and follow only credible/official links.
- University official sites when a circular is mentioned: du.ac.bd, buet.ac.bd, cu.ac.bd, ju.edu.bd? (verify via search), ru.ac.bd, gstadmission.ac.bd, rsu?, official .ac.bd / .edu domains only.
Rules: ONLY items you verified on a page you actually opened this session. For each: title in Bangla, date (YYYY-MM-DD), 1-2 line Bangla summary, source domain, full URL. If after checking multiple sources nothing verified exists, return an empty news array, do NOT invent or reuse old news.`;

const parseOutput = task => {
  if (!task) return null;
  if (task.status !== 'finished') return null;
  const raw = task.output ?? task.result ?? task.data ?? task.finalResult;
  if (raw == null) return null;
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw.replace(/^```json\s*|```$/g, '').trim()) : raw;
    return parsed;
  } catch (_) { return null; }
};

const getTask = async (key, id) => {
  try {
    const resp = await fetch(`${BU_BASE}/tasks/${id}`, { headers: { 'X-Browser-Use-API-Key': key } });
    if (!resp.ok) return null;
    return await resp.json();
  } catch (_) { return null; }
};

// সব টাস্ক শেষ হলে ডেটা KV-তে + Telegram খবর
const newsTaskBody = (env, date) => ({ task: NEWS_PROMPT(date), llm: env.BU_LLM_NEWS || 'browser-use-2.0', maxSteps: 30, structuredOutput: JSON.stringify(NEWS_SCHEMA), flashMode: false });

const runBackground = async (env, date, jobs) => {
  const all = keys(env);
  const deadline = Date.now() + POLL_MAX_MS;
  const results = { gk: null, news: null };
  while (Date.now() < deadline) {
    await sleep(POLL_EVERY_MS);
    for (const job of jobs) {
      if (results[job.kind]) continue;
      const task = await getTask(all[job.keyIndex] || all[0], job.id);
      if (!task) continue;
      if (task.status === 'failed') results[job.kind] = { error: 'agent-failed' };
      else results[job.kind] = parseOutput(task);
    }
    if (results.gk && results.news) break;
  }
  await finalizeResults(env, date, results);
};

// ফলাফল ফিল্টার → KV-সেভ → Telegram খবর (runBackground + healTasks দুই জায়গায় ব্যবহৃত)
const finalizeResults = async (env, date, results) => {
  let prev = null;
  try { const saved = await env.GK_KV.get(`gkData:${date}`); if (saved) prev = JSON.parse(saved); } catch (_) {}
  const sameDay = prev && prev.date === date;
  const gkRes = results.gk || (sameDay && Array.isArray(prev.questions) ? { questions: prev.questions, reused: true } : null);
  const newsRes = results.news || (sameDay && Array.isArray(prev.news) ? { news: prev.news, reused: true } : null);
  const questions = Array.isArray(gkRes?.questions) ? gkRes.questions.filter(q => q?.q && Array.isArray(q.options) && q.options.length >= 2).slice(0, 40) : [];
  const news = Array.isArray(newsRes?.news) ? newsRes.news.filter(n => n?.title && n?.summary).slice(0, 8) : [];
  const payload = { date, count: questions.length, newsCount: news.length, questions, news, finishedAt: Date.now(), partial: !results.gk || !results.news };
  try { await env.GK_KV.put(`gkData:${date}`, JSON.stringify(payload)); await env.GK_KV.put('latest', JSON.stringify(payload)); } catch (_) {}
  try {
    if (env.TG_BOT_TOKEN && env.TG_CHAT_ID) {
      const msg = results.gk
        ? (questions.length
          ? `🤖 আজকের GK এসেছে!\n\n📚 ${questions.length}টি নতুন MCQ${news.length ? `\n📰 ${news.length}টি verified admission news` : '\n📰 আজ কোনো verified news নেই'}\n\nঅ্যাপে Dashboard → 🤖 ডেইলি GK এজেন্ট খোলো!`
          : '🤖 আজ GK এজেন্ট যথেষ্ট verified প্রশ্ন জোগাড় করতে পারেনি, কাল আবার চেষ্টা হবে।')
        : (news.length ? `📰 আজকের admission নিউজ এসেছে!\n\n${news.length}টি verified খবর, অ্যাপে Dashboard → 🤖 ডেইলি GK এজেন্ট → নিউজ ট্যাব` : null);
      if (!msg) return payload;
      await fetch(`https://api.telegram.org/bot${env.TG_BOT_TOKEN}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: env.TG_CHAT_ID, text: msg }) }).catch(() => {});
    }
  } catch (_) {}
  return payload;
};

// ── Study-AI: ব্রাউজার-এজেন্ট চ্যাট (দ্রুত ইঞ্জিন অ্যাপে, ওয়েব-মোড এখানে) ──
const ASK_SCHEMA = {
  type: 'object',
  properties: {
    answer: { type: 'string' },
    sources: { type: 'array', items: { type: 'string' } }
  },
  required: ['answer']
};

const ASK_PROMPT = (question, context, bankBlock, histBlock) => `You are "স্টাডি বন্ধু", a warm, friendly Bangla study-helper for a Bangladeshi university-admission candidate. Today: ${dhakaToday()} (Asia/Dhaka).
User's question: """${question}"""
${context ? `User's study context (use silently, never dump raw): ${context}` : ''}${bankBlock || ''}${histBlock || ''}
Rules: Reply in simple warm Bangla (তুমি-ফর্ম), 2-6 short lines, light emoji ok.${bankBlock ? ' When the bank block is present, base your answer primarily on it (it is the student\'s own verified bank) and mention you answered from their question bank.' : ''} FRESHNESS RULE (critical): for ANY factual, current-affairs, date/number/name, exam-deadline or "এখন/আজ/সর্বশেষ"-type question you MUST browse the live web RIGHT NOW and verify from at least one credible page you actually open before answering, Google-overview-level freshness is the minimum bar. NEVER answer such questions from memory/training data; a stale or outdated fact is a critical failure. If today's verified info cannot be found, say clearly what could not be verified instead of guessing. Always include source domains in sources. Never invent facts. End with a tiny nudge to keep studying.`;

// ── ইউজারের প্রশ্নব্যাংক-মেমোরি: অ্যাপ থেকে আসা সব প্রশ্ন+ইতিহাস KV-তে ──
const normalizeBank = (questions, stats) => {
  const qs = (Array.isArray(questions) ? questions : []).slice(0, 3000).map(q => {
    const o = (Array.isArray(q && (q.o ?? q.options)) ? (q.o ?? q.options) : []).slice(0, 6).map(x => String(x).slice(0, 90));
    const ai = Number(q && (q.answerIndex ?? q.correctAnswerIndex));
    const a = String((q && (q.a ?? q.answer)) ?? (Number.isFinite(ai) && o[ai] != null ? o[ai] : '')).slice(0, 120);
    return {
    q: String((q && (q.q ?? q.question)) ?? '').slice(0, 260),
    o,
    a,
    e: String((q && (q.e ?? q.explain)) ?? '').slice(0, 260),
    s: String((q && (q.s ?? q.subject)) ?? '').slice(0, 70),
    t: String((q && (q.t ?? q.topic)) ?? '').slice(0, 70)
    };
  }).filter(x => x.q && x.o.length >= 2);
  const st = (stats && typeof stats === 'object') ? stats : {};
  return { qs, stats: { count: Number(st.count) || qs.length, exams: Number(st.exams) || 0, avgAcc: st.avgAcc ?? null, weak: Array.isArray(st.weak) ? st.weak.slice(0, 8).map(x => String(x).slice(0, 60)) : [] } };
};

const bankUpload = async (request, env) => {
  try {
    let body = {}; try { body = await request.json(); } catch (_) {}
    const bank = normalizeBank(body.questions, body.stats);
    if (!bank.qs.length) return json(request, { error: 'empty-bank' }, 400);
    await env.GK_KV.put('userBank', JSON.stringify({ ...bank, history: Array.isArray(body.history) ? body.history.slice(0, 500) : [], mistakes: Array.isArray(body.mistakes) ? body.mistakes.slice(0, 400) : [], vocabulary: Array.isArray(body.vocabulary) ? body.vocabulary.slice(0, 1500) : [], activity: body.activity && typeof body.activity === 'object' ? body.activity : {}, ...(body.full && typeof body.full === 'object' ? { full: body.full } : {}), savedAt: Date.now() }));
    if (body.full && typeof body.full === 'object' && env.PUB_KV) {
      try { await publishGlobal(env, body.full); } catch (_) {}
    }
    return json(request, { saved: true, count: bank.qs.length });
  } catch (_) { return json(request, { error: 'bank-failed' }, 500); }
};

const bankInfo = async (request, env) => {
  try {
    const raw = await env.GK_KV.get('userBank');
    if (!raw) return json(request, { saved: false });
    // v133: full=1 → পুরো ব্যাংক (প্রশ্ন+ভুল+শব্দ+ইতিহাস), public-প্রোডাক্ট পাইপলাইনের সেতু (admin-only ব্যবহার)
    try { if (new URL(request.url).searchParams.get('full') === '1') return json(request, { saved: true, bank: JSON.parse(raw) }); } catch (_) {}
    const b = JSON.parse(raw);
    return json(request, { saved: true, count: b.qs.length, stats: b.stats, savedAt: b.savedAt, history: Array.isArray(b.history) ? b.history.length : 0, mistakes: Array.isArray(b.mistakes) ? b.mistakes.length : 0, vocabulary: Array.isArray(b.vocabulary) ? b.vocabulary.length : 0, activity: b.activity || {} });
  } catch (_) { return json(request, { saved: false }); }
};

// ইতিহাস+অ্যাক্টিভিটি → এজেন্ট-প্রম্পট ব্লক (সাইলেন্ট-ইউজ)
const histBlock = b => {
  try {
    const h = Array.isArray(b && b.history) ? b.history.slice(0, 10) : [];
    const a = (b && b.activity) || {};
    let out = '';
    if (h.length) out += '\nপরীক্ষার ইতিহাস (নতুন→পুরনো): ' + h.map(x => `${(x && x.d) || ''}, ${((x && x.s) || '?')}${x && x.m ? ' (' + x.m + ')' : ''}`).join(' | ');
    if (a && (a.exams || a.mistakes || a.vocab)) out += `\nঅ্যাক্টিভিটি: মোট পরীক্ষা ${a.exams || 0} · ভুল-নোট ${a.mistakes || 0} · শব্দ ${a.vocab || 0}`;
    const lt = (a && a.lifetime) || {};
    if (lt && (lt.answered || lt.daysActive)) out += `\nলাইফটাইম: উত্তর ${lt.answered || 0}টি · সঠিক ${lt.correct || 0}${lt.acc != null ? ' (' + lt.acc + '%)' : ''} · সক্রিয় দিন ${lt.daysActive || 0} · চ্যাট-ওপেন ${lt.opens || 0}`;
    if (a && a.coach && a.coach.total) out += `\nশেষ চ্যাট-পরীক্ষা (কোচ-নোট): ${a.coach.score || 0}/${a.coach.total}${Array.isArray(a.coach.weak) && a.coach.weak.length ? ', দুর্বল: ' + a.coach.weak.slice(0, 4).join(', ') : ''}`;
    const ms2 = Array.isArray(b && b.mistakes) ? b.mistakes.slice(0, 8) : [];
    if (ms2.length) out += '\nসাম্প্রতিক ভুল-প্রশ্ন (সঠিক-উত্তরসহ):\n' + ms2.map(x => `- ${String((x && x.q) || '').slice(0, 90)}${x && x.a ? ' ⇒ সঠিক: ' + String(x.a).slice(0, 40) : ''}`).join('\n');
    const vs2 = Array.isArray(b && b.vocabulary) ? b.vocabulary.slice(0, 12) : [];
    if (vs2.length) out += '\nশব্দ-সংগ্রহ: ' + vs2.map(x => `${String((x && x.w) || '').slice(0, 30)}${x && x.m ? '=' + String(x.m).slice(0, 30) : ''}`).join(', ');
    return out ? `\n(শিক্ষার্থীর পরীক্ষার ইতিহাস ও অ্যাক্টিভিটি, সাইলেন্টলি ব্যবহার করো, raw ডাম্প করো না)${out}` : '';
  } catch (_) { return ''; }
};

// ব্যাংক থেকে প্রশ্নের সাথে মিলিয়ে top-পিক (subject ফিল্টারসহ)
const bankPick = (bank, question, subject) => {
  const toks = String(question).toLowerCase().split(/[^\p{L}\p{M}\p{N}]+/u).filter(t => t.length > 2).slice(0, 20);
  let pool = bank.qs || [];
  if (subject) { const f = pool.filter(q => (q.s || '').includes(subject) || (q.t || '').includes(subject)); if (f.length) pool = f; }
  return pool.map(q => {
    const hay = (q.q + ' ' + (q.o || []).join(' ') + ' ' + (q.s || '') + ' ' + (q.t || '')).toLowerCase();
    let sc = 0; for (const t of toks) if (hay.includes(t)) sc++;
    return { q, sc };
  }).filter(x => x.sc > 0).sort((a, b) => b.sc - a.sc).slice(0, 12).map(x => x.q);
};

const newId = () => (crypto.randomUUID ? crypto.randomUUID() : 'ask-' + Date.now() + '-' + Math.floor(Math.random() * 1e6));

const createAsk = async (request, env, ctx) => {
  const date = dhakaToday();
  try {
    let body = {};
    try { body = await request.json(); } catch (_) {}
    const question = String(body.question || '').trim().slice(0, 600);
    const context = String(body.context || '').trim().slice(0, 1200);
    if (!question) return json(request, { error: 'empty-question' }, 400);
    if (!keys(env).length) return json(request, { error: 'keys-not-configured' }, 503);
    const id = newId();
    const source = String(body.source || 'auto').slice(0, 60);
    let bankBlock = '';
    let histB = '';
    {
      const raw = await env.GK_KV.get('userBank');
      if (raw) {
        const bank = JSON.parse(raw);
        histB = histBlock(bank);
        if (source.startsWith('bank')) {
          const subject = source.startsWith('bank:') ? decodeURIComponent(source.slice(5)) : '';
          const picks = bankPick(bank, question, subject);
          bankBlock = picks.length
            ? `\nশিক্ষার্থীর নিজের প্রশ্নব্যাংক থেকে মিলে-যাওয়া প্রশ্ন-উত্তর (উত্তরের প্রধান ভিত্তি এগুলো):\n${picks.map((q, i) => `${i + 1}) প্র: ${q.q}\n${(q.o || []).map((o, oi) => `   ${'কখগঘঙ'[oi] || oi + 1}) ${o}`).join('\n')}\n   উত্তর: ${q.a}${q.e ? `, ${q.e}` : ''}`).join('\n')}\n`
            : `\n(শিক্ষার্থীর প্রশ্নব্যাংকে এই বিষয়ে সরাসরি মিল পাওয়া যায়নি, তার অবস্থা মাথায় রেখে সাবধানে উত্তর দাও।)\n`;
        }
      }
    }
    const askBody = { task: ASK_PROMPT(question, context, bankBlock, histB), llm: env.BU_LLM || 'browser-use-2.0', maxSteps: 14, structuredOutput: JSON.stringify(ASK_SCHEMA), flashMode: false };
    const askKey = String(env.ASK_API_KEY || '').trim();
    if (!askKey) return json(request, { error: 'ask-key-not-configured' }, 503);
    let job = await createWithFailover(env, date, askBody, 0, [askKey]); // dedicated চ্যাট-key
    let dedicated = !!job;
    if (!job) job = await createWithFailover(env, date, askBody, Math.floor(Date.now() / 60000)); // মরে গেলে GK-পুল ফলব্যাক
    if (!job) return json(request, { error: 'all-keys-exhausted' }, 429);
    await env.GK_KV.put(`ask:${id}`, JSON.stringify({ id, jobId: job.id, keyIndex: job.keyIndex, dedicated, date, status: 'running', createdAt: Date.now() }), { expirationTtl: 86400 * 3 });
    return json(request, { id, started: true });
  } catch (_) { return json(request, { error: 'ask-failed' }, 500); }
};

const askStatus = async (request, env, id) => {
  try {
    if (!/^[a-f0-9-]{8,40}$/i.test(id)) return json(request, { error: 'bad-id' }, 400);
    const rec = await env.GK_KV.get(`ask:${id}`);
    if (!rec) return json(request, { error: 'not-found' }, 404);
    const ask = JSON.parse(rec);
    if (ask.status !== 'running') return json(request, ask);
    const all = keys(env);
    const key = ask.dedicated ? (String(env.ASK_API_KEY || '').trim() || all[0]) : (all[ask.keyIndex] || all[0]);
    let task = await getTask(key, ask.jobId).catch(() => null);
    if (!task && String(env.ASK_API_KEY || '').trim() && key !== String(env.ASK_API_KEY).trim()) task = await getTask(String(env.ASK_API_KEY).trim(), ask.jobId).catch(() => null); // legacy-shim
    if (!task) return json(request, { status: 'running' });
    if (task.status === 'failed') { ask.status = 'failed'; await env.GK_KV.put(`ask:${id}`, JSON.stringify(ask)); return json(request, { status: 'failed' }); }
    const out = parseOutput(task);
    if (out && typeof out.answer === 'string' && out.answer.trim()) {
      ask.status = 'finished';
      ask.answer = String(out.answer).slice(0, 4000);
      ask.sources = Array.isArray(out.sources) ? out.sources.map(x => String(x).slice(0, 120)).slice(0, 6) : [];
      await env.GK_KV.put(`ask:${id}`, JSON.stringify(ask));
      return json(request, { status: 'finished', answer: ask.answer, sources: ask.sources });
    }
    return json(request, { status: task.status === 'finished' ? 'failed' : 'running' });
  } catch (_) { return json(request, { error: 'status-failed' }, 500); }
};

// self-heal: ব্যাকগ্রাউন্ড-পোল শেষ হয়ে গেলেও /api/gk/today GET-ই BU-তে finished টাস্ক এনে সেভ করে
const healTasks = async (env, date) => {
  try {
    const rec = await env.GK_KV.get(`gkTasks:${date}`);
    if (!rec) return null;
    const { jobs = [] } = JSON.parse(rec);
    if (!jobs.length) return null;
    const all = keys(env);
    const results = { gk: null, news: null };
    let pending = false;
    for (const job of jobs) {
      const task = await getTask(all[job.keyIndex] || all[0], job.id).catch(() => null);
      if (!task || (task.status !== 'finished' && task.status !== 'failed')) { pending = true; continue; }
      results[job.kind] = task.status === 'failed' ? { error: 'agent-failed' } : parseOutput(task);
    }
    if (pending && !results.gk && !results.news) return null; // এখনো চলছে
    return await finalizeResults(env, date, results);
  } catch (_) { return null; }
};

// নিউজ-আলাদা রি-রান: আজকের GK প্রশ্ন অক্ষত রেখে শুধু news টাস্ক নতুন করে চলে
const startNewsOnly = async (request, env, ctx, date) => {
  try {
    if (!keys(env).length) return json(request, { error: 'keys-not-configured' }, 503);
    const newsJob = await createWithFailover(env, date, newsTaskBody(env, date), 1);
    if (!newsJob) return json(request, { error: 'all-keys-exhausted' }, 429);
    const job = { kind: 'news', id: newsJob.id, keyIndex: newsJob.keyIndex };
    const rec = await env.GK_KV.get(`gkTasks:${date}`);
    const tasksRec = rec ? JSON.parse(rec) : { jobs: [], startedAt: Date.now() };
    tasksRec.jobs = tasksRec.jobs.filter(j => j.kind !== 'news').concat([job]);
    await env.GK_KV.put(`gkTasks:${date}`, JSON.stringify(tasksRec));
    if (ctx && ctx.waitUntil) ctx.waitUntil(runBackground(env, date, [job]));
    else runBackground(env, date, [job]);
    return json(request, { started: true, kind: 'news' });
  } catch (_) { return json(request, { error: 'run-failed' }, 500); }
};

const maybeStart = async (request, env, ctx) => {
  const date = dhakaToday();
  try {
    if (new URL(request.url).searchParams.get('kind') === 'news') return await startNewsOnly(request, env, ctx, date);
    const lastDay = await env.GK_KV.get('gkDay');
    if (lastDay === date) {
      const stored = await env.GK_KV.get(`gkData:${date}`);
      return json(request, stored ? { already: true, ready: true } : { already: true, ready: false });
    }
    if (!keys(env).length) return json(request, { error: 'keys-not-configured' }, 503);
    await env.GK_KV.put('gkDay', date); // দিনে ১ run, এখনই গার্ড বসে
    const gkJob = await createWithFailover(env, date, { task: GK_PROMPT(date), llm: env.BU_LLM || 'browser-use-2.0', maxSteps: 45, structuredOutput: JSON.stringify(GK_SCHEMA), flashMode: false });
    const newsJob = await createWithFailover(env, date, newsTaskBody(env, date), 1); // shift+1: GK ও news ভিন্ন key-এ; শক্ত মডেল + ধীর ব্রাউজিং
    const jobs = [
      gkJob ? { kind: 'gk', id: gkJob.id, keyIndex: gkJob.keyIndex } : null,
      newsJob ? { kind: 'news', id: newsJob.id, keyIndex: newsJob.keyIndex } : null
    ].filter(Boolean);
    await env.GK_KV.put(`gkTasks:${date}`, JSON.stringify({ jobs, startedAt: Date.now() }));
    if (!jobs.length) return json(request, { error: 'all-keys-exhausted' }, 429);
    if (ctx && ctx.waitUntil) ctx.waitUntil(runBackground(env, date, jobs));
    else runBackground(env, date, jobs);
    return json(request, { started: true, tasks: jobs.length });
  } catch (error) {
    return json(request, { error: 'run-failed' }, 500);
  }
};

/* P27, the owner's phone alert (owner order 2026-10-17).
 *
 * The client reporter posts here and this Worker forwards to Telegram, so the
 * bot token never reaches the browser. Same-origin only (the Pages proxy adds
 * `x-ah-pages-proxy`), because an open endpoint here would let anyone make the
 * owner's phone buzz. The chat is fixed server-side: a caller cannot choose who
 * receives the message.
 *
 * Dedupe is the point of `signature`. A render loop fires the same error
 * hundreds of times, and the client quota cannot see other visitors, so the KV
 * guard here is what actually protects the phone.
 */
const ALERT_KV_TTL = 60 * 60 * 24 * 30;
const ALERT_MAX_PER_HOUR = 20;
const ALERT_FIELD = 400;

const alertField = (value, max = ALERT_FIELD) =>
  typeof value === 'string' ? value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, max) : '';

async function sendTelegramAlert(env, text) {
  if (!env.TG_BOT_TOKEN || !env.TG_CHAT_ID) return false;
  try {
    const resp = await fetch(`https://api.telegram.org/bot${env.TG_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: env.TG_CHAT_ID, text, disable_web_page_preview: true })
    });
    return resp.ok;
  } catch (_) {
    return false;
  }
}

async function handleErrorReport(request, env) {
  /* BUG-003 (2026-10-25 audit). This endpoint sits before the app gate on
     purpose — the reporter is an unauthenticated browser beacon — but its only
     control was an Origin whitelist, and Origin is set by the caller, so any
     script could inject arbitrary text into the owner's Telegram alert channel.
     The Pages proxy sets x-ah-pages-proxy on the requests it forwards, and that
     header cannot survive a cross-origin call (it would need a CORS preflight
     the Pages deployment does not grant), so it is the one signal a foreign
     origin cannot fake. Origin alone no longer suffices. */
  const proxied = request.headers.get('x-ah-pages-proxy') === '1';
  if (!proxied) return json(request, { error: 'forbidden' }, 403);

  let body = {};
  try { body = await request.json(); } catch (_) {}
  const message = alertField(body.message, 500);
  if (!message) return json(request, { error: 'empty' }, 400);
  const path = alertField(body.path, 120) || '(unknown)';
  const signature = alertField(body.signature, 120) || path;
  const release = alertField(body.release, 60);
  const source = alertField(body.source, 40);

  if (!env.TG_BOT_TOKEN || !env.TG_CHAT_ID) return json(request, { skipped: 'telegram-not-configured' });
  if (!env.GK_KV) return json(request, { skipped: 'no-kv' });

  const now = Date.now();
  const hourBucket = `alertHour:${Math.floor(now / 3600000)}`;
  try {
    if (await env.GK_KV.get(`alert:${signature}`)) return json(request, { skipped: 'duplicate' });
    const used = Number(await env.GK_KV.get(hourBucket)) || 0;
    if (used >= ALERT_MAX_PER_HOUR) return json(request, { skipped: 'hourly-cap' });

    const lines = ['🚨 AdmissionSky, নতুন সমস্যা', '', message, '', `📄 পেজ: ${path}`];
    if (source) lines.push(`📍 সূত্র: ${source}`);
    if (release) lines.push(`🏷️ ভার্সন: ${release}`);
    lines.push(`🕒 ${new Date(now + 6 * 3600000).toISOString().slice(0, 16).replace('T', ' ')} (ঢাকা)`);

    if (!await sendTelegramAlert(env, lines.join('\n'))) return json(request, { error: 'telegram-failed' }, 502);
    /* Written only after a successful send: a failed alert must stay retryable
     * rather than be silenced by its own marker. */
    await env.GK_KV.put(`alert:${signature}`, String(now), { expirationTtl: ALERT_KV_TTL });
    await env.GK_KV.put(hourBucket, String(used + 1), { expirationTtl: 3600 });
    return json(request, { sent: true });
  } catch (_) {
    return json(request, { error: 'alert-failed' }, 500);
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    previewOriginsAllowed = String(env.ALLOW_PREVIEW_ORIGINS || '') === '1';
    /* F0.1 step 4j follow-up: put any credential that exists only in THIS
     * Worker's environment into KV, where both rooms can read it. Measurement
     * found exactly that gap — admission-gk could reach `cloudflare`, sky-ai could
     * not, so chat quietly stayed on the fallback.
     *
     * Off the request path (waitUntil), once per isolate, names only in the log,
     * and it never overwrites what KV already has. A failure changes nothing:
     * the deployment behaves exactly as it does today. */
    try {
      const p = syncProviderKeysToKv(env).then((r) => {
        if (r && r.added && r.added.length) {
          // Names, never values. This is the one line that explains, later, why
          // sky-ai suddenly reported a provider it did not have before.
          try { console.log(JSON.stringify({ evt: 'ai.keys.synced', names: r.added })); } catch (_) {}
        }
      }).catch(() => {});
      if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(p);
    } catch (_) { /* never fail a request for this */ }
    /* F0.1 / DV-01 (Sky AI blueprint), first route through the new sky-ai
     * Worker via the SKY_AI service binding. Only this new health path is
     * forwarded; every existing /api/ai/* route is still served here. Without
     * the binding (e.g. staging) the request falls through unchanged. */
    if (url.pathname === '/api/ai/sky-health' && request.method === 'GET' && env.SKY_AI) {
      /* F0.1 step 4j: tell sky-ai which providers THIS Worker can reach, so its
       * health report can say whether the two rooms match. Without it, "chat is
       * live" could only be inferred from sky-ai listing *a* provider — which is
       * not the same claim. Names only; the keys never leave this Worker.
       * Best-effort: no list simply means "nothing to compare". */
      const headers = { 'x-sky-ai-caller': 'admission-gk' };
      try {
        const needed = readyProviderNames(await providerReadiness(env));
        if (needed.length) headers['x-sky-need-providers'] = needed.join(',');
      } catch (_) { /* a health probe must never fail because of the probe */ }
      return env.SKY_AI.fetch(new Request(request.url, { method: 'GET', headers }));
    }
    /* F0.1 step 4a / DV-01: generic, allowlist-gated proxy to sky-ai. The
     * allowlist in sky-ai-route.mjs is EMPTY, so nothing changes for students.
     * A route is moved by adding it there (after sky-ai serves it); any sky-ai
     * 404/5xx/throw falls back to the local handler below. */
    {
      const viaSky = await tryRouteToSkyAi(request, env);
      if (viaSky) return viaSky;
    }
    /* P23, live voice agent. Routed first because it answers a WebSocket
     * upgrade, which no downstream handler should try to read. One object per
     * owner keeps the socket and the durable memory together. The ticket path is
     * matched too, without it the ticket request would 404 here and the socket
     * could never be opened. The login/session paths are the owner's password
     * gate for the page, and must reach the object for the same reason. */
    if (url.pathname === '/api/voice/agent' || url.pathname.startsWith('/api/voice/agent/') ||
        url.pathname === '/api/voice/login' || url.pathname === '/api/voice/session') {
      const id = env.VOICE_AGENT.idFromName(String(env.VOICE_OWNER_UID || 'owner'));
      return env.VOICE_AGENT.get(id).fetch(request);
    }
    const authResponse = await routeAuthRequest({
      request,
      env,
      ctx,
      local: nativeAuthHandler,
      forward: forwarded => env.AUTH_WORKER.fetch(forwarded)
    });
    if (authResponse) return authResponse;
    const emailResponse = await handleInternalEmailRequest(request, env, ctx);
    if (emailResponse) return emailResponse;
    // Phase 1, FCM notification foundation (owns /api/notifications/* + /internal/notifications/health).
    /* Phase 3, notification intelligence. Registered BEFORE the FCM handler
     * because that one answers 404 for any /api/notifications/* path it does not
     * recognise, which would swallow /intel/* and /intel-pref and /outcome. */
    const intelResponse = await handleIntelligenceRequest(request, env, ctx);
    if (intelResponse) return intelResponse;
    const fcmResponse = await handleFcmNotificationRequest(request, env, ctx);
    if (fcmResponse) return fcmResponse;
    // Admin passkey login (owns /api/admin/webauthn/*).
    const adminPasskeyResponse = await handleAdminPasskeyRequest(request, env);
    if (adminPasskeyResponse) return adminPasskeyResponse;
    // Phase G, personalized smart notifications (owns /api/notifications/personal/*).
    const personalResponse = await handlePersonalizedNotificationRequest(request, env, ctx);
    if (personalResponse) return personalResponse;
    // Student data sync (server-backed student learning data), owns /api/userdata/*.
    const userDataResponse = await handleUserDataRequest(request, env, ctx);
    if (userDataResponse) return userDataResponse;
    /* Phase 5, AI analytics intelligence. Registered *before* the Phase 4
     * analytics handler, which claims every /api/analytics/* path and would
     * otherwise answer /api/analytics/ai/* with its own admin gate (a 403 that
     * reads like a permissions fault instead of a missing route). Both handlers
     * live under the same prefix; order is the only thing that separates them. */
    const aiAnalyticsResponse = await handleAiAnalyticsRequest(request, env, ctx, {
      /* The one place a model is reachable from the analytics surface. Injecting
       * it keeps the copilot testable without a network call, and means the AI
       * layer is inert if no provider key is configured. */
      generate: aiGenerate(env)
    });
    if (aiAnalyticsResponse) return aiAnalyticsResponse;
    /* Phase 4, analytics. Registered after userdata (it reads those tables) and
     * before the /api/* pubHandler catch-all, which would otherwise treat
     * /api/analytics/* as an unknown public route. */
    const analyticsResponse = await handleAnalyticsRequest(request, env, ctx);
    if (analyticsResponse) return analyticsResponse;
    // R2 file storage (owner-approved 2026-09-18), owns /api/files/*.
    // Must run before the /api/* pubHandler catch-all.
    const filesResponse = await handleFilesStorageRequest(request, env, ctx);
    if (filesResponse) return filesResponse;
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(request) });

    /* P27, must run before the /api/* pub forward and the X-AH-App gate below:
     * the reporter is an unauthenticated same-origin browser request, so neither
     * gate would let it through. */
    if (request.method === 'POST' && url.pathname === '/api/report-error') return await handleErrorReport(request, env);
    /* Owner 2026-10-17, Sky support buttons: GET /api/go/whatsapp|email redirect to
     * the contact kept in PUB_KV 'sky:contact' (never in the repo). Before the /api/* forward. */
    const contactResponse = await handleSkyContactRequest(request, env);
    if (contactResponse) return contactResponse;

    // Public product API: content, Firebase-session-aware or ephemeral-guest AI,
    // and content admin only. Retired legacy identity routes are not forwarded.
    if (url.pathname.startsWith('/pub/') || url.pathname.startsWith('/api/')) {
      const gatedApi = url.pathname === '/api/ask' || url.pathname.startsWith('/api/ask/') || url.pathname === '/api/bank' || url.pathname.startsWith('/api/gk/') || url.pathname === '/api/cloud/publish';
      const u2p = new URL(request.url); u2p.pathname = url.pathname.replace(/^\/pub\//, '/api/');
      if (url.pathname.startsWith('/pub/') || !gatedApi) {
        const envPub = {
          PUB_KV: env.PUB_KV,
          AUTH_AUTHORITY: env.AUTH_AUTHORITY,
          OLD_KV: env.OLD_KV || env.GK_KV,
          ADMIN_TOKEN: env.ADMIN_TOKEN,
          /* P19, backup/restore reads GK_KV and writes snapshots to R2. Without
             these two the admin backup routes answer "no-backup-bucket" even
             though the bindings exist on the outer Worker. */
          GK_KV: env.GK_KV,
          FILE_BUCKET: env.FILE_BUCKET,
          GEMINI_KEYS: env.GEMINI_KEYS,
          GROQ_API_KEY: env.GROQ_API_KEY,
          CLOUDFLARE_ACCOUNT_ID: env.CLOUDFLARE_ACCOUNT_ID,
          CLOUDFLARE_AI_API_KEY: env.CLOUDFLARE_AI_API_KEY,
          AGENT_CLOUDFLARE_MODELS: env.AGENT_CLOUDFLARE_MODELS,
          USE_CONTEXT_ENGINE: env.USE_CONTEXT_ENGINE,
          AGENT_DAILY_CAP: env.AGENT_DAILY_CAP,
          AGENT_PUBLIC_DAILY_CAP: env.AGENT_PUBLIC_DAILY_CAP,
          AGENT_GEMINI_MODELS: env.AGENT_GEMINI_MODELS,
          /* web_search (owner 2026-10-18): Tavily key + optional daily cap. Left out of
             this whitelist, the chat never saw the key and never searched. */
          TAVILY_API_KEY: env.TAVILY_API_KEY,
          TAVILY_DAILY_CAP: env.TAVILY_DAILY_CAP,
          /* AI audit 2026-10-16: the dashboard kill-switches and tuning knobs the
             AI path reads. Without them here a secret bound from the dashboard
             (e.g. USE_WRITE_ACTIONS = "disabled", AI_CHAT_CACHE = "off") never
             reaches the public handler and the switch silently does nothing. */
          USE_WRITE_ACTIONS: env.USE_WRITE_ACTIONS,
          AI_CHAT_CACHE: env.AI_CHAT_CACHE,
          AGENT_GROQ_MODELS: env.AGENT_GROQ_MODELS,
          AGENT_FIRST_CHUNK_MS: env.AGENT_FIRST_CHUNK_MS,
          AI_KV_KEY_NAMES: env.AI_KV_KEY_NAMES,
          PUBLIC_RATE_SALT: env.PUBLIC_RATE_SALT,
          PUBLIC_RATE_LIMIT: env.PUBLIC_RATE_LIMIT,
          PUBLIC_RATE_WINDOW_MS: env.PUBLIC_RATE_WINDOW_MS,
          /* P13, D1 read path (public question/content lists). Absent binding
             leaves the KV path in place, so this is additive. */
          PROFILE_DB: env.PROFILE_DB,
          /* AI chat state. This object is a whitelist: a binding left out here
             is invisible to the public handler, and both the per-user quota and
             the P14 abuse guard fall back to KV without saying so. The AI status
             endpoint reports which store is live, which is how this was caught. */
          AI_STATE: env.AI_STATE
        };
        const pubResponse = await pubHandler.fetch(new Request(u2p.href, request), envPub, ctx);
        return await compressResponse(request, pubResponse);
      }
    }

    if (url.pathname === '/health') {
      return json(request, { ok: true, keys: keys(env).length, askKey: !!env.ASK_API_KEY, kv: !!env.GK_KV, tg: !!env.TG_BOT_TOKEN, agent: 'agent-f1', gemini: !!env.GEMINI_KEYS, groq: !!env.GROQ_API_KEY, lastDay: env.GK_KV ? await env.GK_KV.get('gkDay') : null });
    }

    const isApp = request.headers.get('X-AH-App') === APP_HEADER;
    /* BUG-001: the header above is a routing hint only. The routes below change
       live data — /api/cloud/publish overwrites the global question bank,
       /api/bank injects questions, /api/ask spends the owner's paid keys — so
       they now require a real proof: the owner's admin token, or a session the
       auth authority confirms. The old `beaconOk` exception accepted a bare
       POST /api/bank on the strength of the Origin header alone, which any
       non-browser client sets freely; it is gone. */
    const writeRoute = url.pathname === '/api/cloud/publish' || url.pathname === '/api/bank' || url.pathname === '/api/ask';
    const stateChanging = writeRoute && request.method === 'POST';
    const beaconOk = false;
    if (!isApp && !beaconOk) return json(request, { error: 'forbidden' }, 403);
    if (stateChanging && !ownerProof(request, env) && !(await verifiedSession(request, env))) {
      return json(request, { error: 'forbidden' }, 403);
    }
    if (request.method === 'POST' && url.pathname === '/api/ask') return await createAsk(request, env, ctx);
    if (request.method === 'POST' && url.pathname === '/api/bank') return await bankUpload(request, env);
    if (request.method === 'GET' && url.pathname === '/api/bank') return await bankInfo(request, env);
    if (request.method === 'POST' && url.pathname === '/api/cloud/publish') {
      let body = {};
      try { body = await request.json(); } catch (_) {}
      const result = await publishGlobal(env, body);
      if (result.error === 'empty') return json(request, { error: 'empty-global' }, 400);
      if (result.error) return json(request, result, 500);
      return json(request, result);
    }
    if (request.method === 'GET' && url.pathname.startsWith('/api/ask/')) return await askStatus(request, env, url.pathname.split('/').pop() || '');

    if (request.method === 'POST' && url.pathname === '/api/gk/run') return maybeStart(request, env, ctx);

    if (request.method === 'GET' && url.pathname === '/api/gk/today') {
      const date = dhakaToday();
      try {
        const tasks = await env.GK_KV.get(`gkTasks:${date}`);
        if (tasks) { // টাস্ক আছে → আগে heal: finished টাস্ক এনে merge-করে সেভ করে
          const healed = await healTasks(env, date);
          if (healed) return json(request, { ready: true, date, payload: healed });
        }
        const stored = await env.GK_KV.get(`gkData:${date}`);
        if (stored) return json(request, { ready: true, date, payload: JSON.parse(stored) });
        return json(request, { ready: false, date, running: !!tasks });
      } catch (_) { return json(request, { ready: false, date, running: false }); }
    }

    return json(request, { error: 'not_found' }, 404);
  },

  async scheduled(event, env, ctx) {
    /* Phase 2 (owner-approved 2026-09-17): global notification scheduler -
     * every cron tick sends any due scheduled global (topic-first). Cloudflare
     * Cron Triggers replace the spec's "Vercel Cron" (owner: no Vercel).
     * The GK run below stays date-guarded (once per day). */
    try { await runScheduledGlobalNotifications(env); } catch (_) {}
    /* Phase G, one personalized nudge per student per day (restraint built in:
     * daily cap, quiet hours, duplicate guard). Runs after the global send. */
    try { await runScheduledPersonalizedNotifications(env); } catch (_) {}
    /* Phase 3, the intelligence layer. Runs after Phase G and shares its daily
     * allowance, so a student still gets at most one nudge a day; this one adds
     * timezone awareness, the priority ranking, fatigue and the A/B variant. */
    try { await runScheduledIntelligenceNotifications(env); } catch (_) {}
    /* Phase 4, event notifications (streak/best/mastery/exam achievements) and
     * the daily/weekly/monthly digests. Both are dedup-guarded, so a repeated
     * cron tick is harmless. */
    try { await runScheduledEventNotifications(env); } catch (_) {}
    try { await runScheduledDigests(env); } catch (_) {}
    /* Anonymous daily AI report (owner 2026-10-17): built once at Bangladesh
       midnight (UTC 18:00) from counts only; read in the Control Center. */
    try { await runDailyReport(env); } catch (_) {}
    /* P19, a daily restorable snapshot, taken once per Dhaka day. Guarded by
       the same day key the GK run uses, so the per-minute cron does not produce
       a snapshot every minute; best-effort, since a failed backup must not stop
       the notification work above it. */
    try {
      const backupDay = `backupDay:${dhakaToday()}`;
      if (env.PUB_KV && (await env.PUB_KV.get(backupDay)) !== 'done') {
        await createSnapshot(env);
        await env.PUB_KV.put(backupDay, 'done');
      }
    } catch (_) {}
    /* P25, drop expired chat-cache rows. Reads already ignore an expired row,
       so this is housekeeping, not correctness: it stops the table growing
       without bound on a free-plan database. Guarded to once per Dhaka day for
       the same reason the snapshot is, the cron ticks every minute. */
    try {
      const sweepDay = `cacheSweepDay:${dhakaToday()}`;
      if (env.PROFILE_DB && env.PUB_KV && (await env.PUB_KV.get(sweepDay)) !== 'done') {
        await new AiAnalyticsStore(env.PROFILE_DB).sweepCache();
        await env.PUB_KV.put(sweepDay, 'done');
      }
    } catch (_) {}
    if (!env.GK_KV || !keys(env).length) return;
    const date = dhakaToday();
    try { if ((await env.GK_KV.get('gkDay')) === date) return; } catch (_) {}
    const fakeRequest = new Request('https://cron/api/gk/run', { method: 'POST', headers: { 'X-AH-App': APP_HEADER } });
    await maybeStart(fakeRequest, env, ctx);
  }
};

export const __test = { tryCreate, createWithFailover, parseOutput, dhakaToday, keys, GK_PROMPT, GK_SCHEMA, NEWS_SCHEMA, finalizeResults, normalizeBank, bankPick, bankUpload, bankInfo, ASK_PROMPT, histBlock };
