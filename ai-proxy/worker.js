const API_BASE = 'https://api.browser-use.com/api/v4';
const MAX_BODY_BYTES = 64 * 1024;
const MAX_TASK_CHARS = 48_000;
const MAX_DAILY_REQUESTS = 1; // owner decision 2026-10-27: one AI report per day
const MAX_POLL_SECONDS = 90;

function allowedOrigins(env) {
  const list = String(env.ALLOWED_ORIGINS || env.ALLOWED_ORIGIN || '')
    .split(',').map(o => o.trim()).filter(Boolean);
  if (!list.length) list.push('https://admissionhub.pages.dev', 'https://admissionsky.pages.dev');
  return list;
}

function corsHeaders(request, env) {
  const origin = (request && request.headers.get('Origin')) || '';
  const list = allowedOrigins(env);
  const headers = {
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin'
  };
  // Echo the caller's Origin only when it is on the allowlist, so a second
  // allowed host (BUG-002) does not force a wildcard.
  if (origin && list.includes(origin)) headers['Access-Control-Allow-Origin'] = origin;
  return headers;
}

function json(data, status, env, request) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders(request, env), 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function clientBucket(request) {
  const ip = request.headers.get('CF-Connecting-IP') || 'anonymous';
  return ip.slice(0, 80);
}

function compactQuestion(item) {
  const options = Array.isArray(item?.options) ? item.options.slice(0, 4).map((value) => String(value ?? '').slice(0, 160)) : [];
  return {
    id: String(item?.id ?? ''),
    number: item?.number,
    subject: String(item?.subject ?? '').slice(0, 100),
    topic: String(item?.topic ?? '').slice(0, 140),
    prompt: String(item?.prompt ?? '').slice(0, 360),
    options,
    selected: String(item?.selected ?? '').slice(0, 160),
    correct: String(item?.correct ?? '').slice(0, 160),
    status: String(item?.status ?? '')
  };
}

function buildTask(payload) {
  const requestType = String(payload?.requestType || 'result_analysis');
  const result = payload?.result || {};
  const previous = Array.isArray(payload?.previousResults) ? payload.previousResults.slice(0, 8) : [];
  const subjects = Array.isArray(payload?.subjectPerformance) ? payload.subjectPerformance.slice(0, 12) : [];
  const topics = Array.isArray(payload?.topicPerformance) ? payload.topicPerformance.slice(0, 20) : [];
  const base = { requestType, result, previousResults: previous, subjectPerformance: subjects, topicPerformance: topics };

  if (requestType === 'weekly_report') {
    const weekly = payload?.weekly && typeof payload.weekly === 'object' ? payload.weekly : {};
    return `তুমি Admission Sky-এর সাপ্তাহিক study mentor। নিচের VERIFIED weekly JSON দেখে সহজ বাংলায় সংক্ষিপ্ত, বাস্তবসম্মত রিপোর্ট তৈরি করো। কোনো বাইরের তথ্য বা বানানো সংখ্যা ব্যবহার করবে না। শুধু JSON ফেরত দাও, markdown fence ছাড়া:
{"opening":"...","trend":"...","strongAreas":["..."],"weakTopics":["..."],"tasks":["...","...","..."],"motivation":"...","verdict":"..."}
Verified JSON:
${JSON.stringify({ ...base, weekly })}`.slice(0, MAX_TASK_CHARS);
  }

  if (requestType === 'question_explanation_batch') {
    const source = Array.isArray(payload?.explanationQuestions) ? payload.explanationQuestions : [];
    const explanationQuestions = source.slice(0, 30).map(compactQuestion);
    return `তুমি Admission Sky-এর একজন সহানুভূতিশীল exam mentor। নিচের ভুল MCQ-গুলো দেখে প্রতিটি প্রশ্নের জন্য সহজ বাংলায় সংক্ষিপ্ত explanation লেখো। শুধু দেওয়া প্রশ্ন, option, শিক্ষার্থীর উত্তর ও সঠিক উত্তর ব্যবহার করবে; কোনো বাইরের তথ্য বা বানানো নিয়ম নয়। প্রতিটি questionId একবার রাখবে। শুধু JSON ফেরত দাও, markdown fence ছাড়া:
{"explanations":[{"questionId":"...","explanation":"...","whyCorrect":"...","whyWrong":"...","easy":"...","memory":"...","trap":"...","practice":"..."}]}
Verified JSON:
${JSON.stringify({ ...base, explanationQuestions })}`.slice(0, MAX_TASK_CHARS);
  }

  const allQuestions = Array.isArray(payload?.questions) ? payload.questions : [];
  const orderedQuestions = [...allQuestions.filter((item) => item?.status === 'wrong'), ...allQuestions.filter((item) => item?.status !== 'wrong')];
  const questions = orderedQuestions.slice(0, 40).map(compactQuestion);
  return `তুমি Admission Sky-এর একজন দক্ষ, সহানুভূতিশীল exam mentor। নিচের VERIFIED JSON result summary বিশ্লেষণ করো। কোনো website খুলবে না, কোনো বাইরের তথ্য ব্যবহার করবে না, এবং কোনো সংখ্যা বানাবে না। App-এর calculated score, accuracy, negative marking, current result ও previous result পরিবর্তন করবে না। ভুল প্রশ্নের তালিকা থাকলে শুধু সেই তালিকা থেকে focusQuestions বেছে নাও।

Explanation/analysis-এর ভাষা হবে সহজ, স্বাভাবিক, বন্ধুর মতো কিন্তু শিক্ষকের মতো গুছানো বাংলা। “বইয়ে বলা হয়েছে”, “বই অনুযায়ী”, “উৎসে উল্লেখ আছে”, “প্রদত্ত তথ্য অনুযায়ী”, “উপরের তথ্য থেকে”, “পাঠ্যাংশে বলা হয়েছে”, “প্রশ্নের তথ্য অনুযায়ী”, “উল্লিখিত তথ্য অনুযায়ী”, “এই অধ্যায়ে উল্লেখ করা হয়েছে”, “দেওয়া তথ্য অনুসারে”-এ ধরনের source-dependent phrase ব্যবহার করবে না।

শুধু এই JSON object ফেরত দাও, markdown fence ছাড়া:
{"headline":"...","summary":"...","strengths":["..."],"weaknesses":["..."],"mistakePattern":"...","comparison":"...","targetAdvice":"...","plan1Day":"...","plan3Days":"...","plan7Days":"...","motivation":"...","visualInsights":[{"label":"...","value":"...","tone":"strong|watch|focus"}],"focusQuestions":[{"questionId":"...","why":"..."}]}

Verified JSON:
${JSON.stringify({ ...base, questions })}`.slice(0, MAX_TASK_CHARS);
}

async function browserHeaders(env) {
  return {
    'X-Browser-Use-API-Key': env.BROWSER_USE_API_KEY,
    'Content-Type': 'application/json'
  };
}

async function checkQuota(request, env) {
  if (!env.AI_ANALYSIS_KV) return { allowed: true, count: 0, key: null };
  const key = `analysis:${todayKey()}:${clientBucket(request)}`;
  const count = Number(await env.AI_ANALYSIS_KV.get(key) || 0);
  return { allowed: count < MAX_DAILY_REQUESTS, count, key };
}

async function incrementQuota(quota, env) {
  if (!env.AI_ANALYSIS_KV || !quota.key) return;
  await env.AI_ANALYSIS_KV.put(quota.key, String(quota.count + 1), { expirationTtl: 172800 });
}

/* A per-IP limit gives every IP its own allowance, so it cannot bound the
   owner's total spend (BUG-001). This is the ceiling across all callers. */
const MAX_DAILY_REQUESTS_GLOBAL = 50;

async function checkGlobalQuota(env) {
  if (!env.AI_ANALYSIS_KV) return { allowed: true, count: 0, key: null };
  const key = `analysis:global:${todayKey()}`;
  const count = Number(await env.AI_ANALYSIS_KV.get(key) || 0);
  return { allowed: count < MAX_DAILY_REQUESTS_GLOBAL, count, key };
}

async function incrementGlobalQuota(quota, env) {
  if (!env.AI_ANALYSIS_KV || !quota.key) return;
  await env.AI_ANALYSIS_KV.put(quota.key, String(quota.count + 1), { expirationTtl: 172800 });
}

async function createRun(request, env) {
  if (!env.BROWSER_USE_API_KEY) return json({ error: 'AI backend secret is not configured.' }, 503, env, request);
  const size = Number(request.headers.get('Content-Length') || 0);
  if (size > MAX_BODY_BYTES) return json({ error: 'Request is too large.' }, 413, env, request);
  let payload;
  try { payload = await request.json(); } catch (_) { return json({ error: 'Invalid JSON.' }, 400, env, request); }
  if (!payload?.result || typeof payload.result !== 'object') return json({ error: 'Verified result summary is required.' }, 400, env, request);
  // BUG-001: prove the caller is a real human before spending the owner's paid
  // Browser Use quota. A forged Origin gets this far; a forged Turnstile token
  // does not. Enforced only once TURNSTILE_SECRET_KEY is configured.
  const human = await verifyTurnstile(request, env, payload?.turnstileToken);
  if (human.enforced && !human.ok) {
    return json({ error: 'Human verification failed. Please reload and try again.' }, 403, env, request);
  }
  const quota = await checkQuota(request, env);
  if (!quota.allowed) return json({ error: 'আজকের AI analysis limit শেষ হয়েছে। আগামীকাল আবার চেষ্টা করো।', limit: MAX_DAILY_REQUESTS }, 429, env, request);
  // A per-IP limit is trivially multiplied across IPs (BUG-001), so bound the
  // total spend as well.
  const global = await checkGlobalQuota(env);
  if (!global.allowed) return json({ error: 'আজকের AI analysis limit শেষ হয়েছে। আগামীকাল আবার চেষ্টা করো।', limit: MAX_DAILY_REQUESTS }, 429, env, request);
  const response = await fetch(`${API_BASE}/runs`, {
    method: 'POST',
    headers: await browserHeaders(env),
    body: JSON.stringify({
      task: buildTask(payload),
      model: env.BROWSER_USE_MODEL || 'gpt-5.6-luna'
    })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) return json({ error: data?.detail || data?.message || 'Browser Use run could not be started.', providerStatus: response.status }, response.status >= 500 ? 502 : response.status, env, request);
  await incrementQuota(quota, env);
  await incrementGlobalQuota(global, env);
  return json({ runId: data.id || data.runId, status: data.status || 'queued', remainingToday: Math.max(0, MAX_DAILY_REQUESTS - quota.count - 1) }, 202, env, request);
}

async function getRun(runId, env, request) {
  if (!env.BROWSER_USE_API_KEY) return json({ error: 'AI backend secret is not configured.' }, 503, env, request);
  if (!/^[a-f0-9-]{20,80}$/i.test(runId)) return json({ error: 'Invalid run id.' }, 400, env, request);
  const statusResponse = await fetch(`${API_BASE}/runs/${encodeURIComponent(runId)}/status`, { headers: await browserHeaders(env) });
  const statusData = await statusResponse.json().catch(() => ({}));
  if (!statusResponse.ok) return json({ error: statusData?.detail || 'Unable to read run status.' }, statusResponse.status >= 500 ? 502 : statusResponse.status, env, request);
  const status = String(statusData.status || '').toLowerCase();
  if (!['completed', 'failed', 'cancelled'].includes(status)) return json({ runId, status: status || 'running' }, 200, env, request);
  if (status !== 'completed') return json({ runId, status, error: 'AI analysis run did not complete.' }, 200, env, request);
  const fullResponse = await fetch(`${API_BASE}/runs/${encodeURIComponent(runId)}`, { headers: await browserHeaders(env) });
  const fullData = await fullResponse.json().catch(() => ({}));
  if (!fullResponse.ok) return json({ error: 'Completed run result could not be fetched.' }, fullResponse.status >= 500 ? 502 : fullResponse.status, env, request);
  let analysis = fullData.result || fullData.output || fullData.text || '';
  if (typeof analysis !== 'string') analysis = JSON.stringify(analysis);
  return json({ runId, status: 'completed', analysis }, 200, env, request);
}

/* ALLOWED_ORIGIN only sets a response header; it does not decide anything.
   Without a real check any site could POST /analyze and spend the owner's
   Browser Use quota (the per-IP guard gives every visitor of that site its own
   three). So the Origin is enforced here, and a request with no Origin — which
   a browser always sends for a cross-origin POST — is refused too. */
function originAllowed(request, env) {
  const origin = request.headers.get('Origin') || '';
  return allowedOrigins(env).includes(origin);
}

/* BUG-001: the Origin header is a normal HTTP header any script can forge, so
   it cannot be the only gate on /analyze. The client already sends a Turnstile
   token; this verifies it server-side against Cloudflare. It is inert until
   TURNSTILE_SECRET_KEY is configured (so enabling the code cannot break the
   live site), and fails CLOSED once the secret exists: a missing token, a
   rejected token, or a Cloudflare outage refuses the run. */
const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

async function verifyTurnstile(request, env, token) {
  const secret = String(env.TURNSTILE_SECRET_KEY || '').trim();
  if (!secret) return { enforced: false, ok: true };
  const value = String(token || '');
  if (!value || value.length > 4096) return { enforced: true, ok: false };
  const form = new URLSearchParams({ secret, response: value });
  const ip = request.headers.get('CF-Connecting-IP');
  if (ip && ip !== 'unknown') form.set('remoteip', String(ip).slice(0, 96));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(SITEVERIFY_URL, { method: 'POST', body: form, signal: controller.signal });
    const data = await res.json().catch(() => null);
    return { enforced: true, ok: !!(data && data.success === true) };
  } catch (_) {
    return { enforced: true, ok: false };
  } finally {
    clearTimeout(timer);
  }
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(request, env) });
    const url = new URL(request.url);
    if (url.pathname === '/health') return json({ ok: true, service: 'admission-hub-ai-proxy' }, 200, env, request);
    const isAnalyze = url.pathname === '/analyze' || url.pathname.startsWith('/analyze/');
    // The Origin check stays as a cheap first filter, but it is NOT the
    // authentication for /analyze -- Turnstile is verified in createRun.
    if (isAnalyze && !originAllowed(request, env)) {
      return json({ error: 'forbidden' }, 403, env, request);
    }
    if (request.method === 'POST' && url.pathname === '/analyze') return createRun(request, env);
    if (request.method === 'GET' && url.pathname.startsWith('/analyze/')) return getRun(url.pathname.split('/').pop(), env, request);
    return json({ error: 'Not found.' }, 404, env, request);
  }
};
