/* AdmissionSky, anonymous daily AI report (owner 2026-10-17).
 *
 * Every AI chat request adds a few COUNTS to one Durable Object (AI_STATE,
 * instance '__sky-daily-stats__'): how many requests, how they were answered
 * (tools / cache / model / failed / daily limit), which provider, and speed
 * buckets. No uid, no text, no question, no IP, only numbers, so the report
 * cannot identify anyone. Durable Object requests are used instead of KV
 * because the free plan allows 1,000 KV writes a day and 100,000 DO requests.
 *
 * At Bangladesh midnight (UTC 18:00) the per-minute cron turns the day that just
 * ended into one report and stores it in PUB_KV (2 writes a day). The Control
 * Center reads it from GET /api/admin/ai-daily-report (admin token).
 * Answers given inside the app (small talk, shared answers, in-app tools) never
 * reach the server and are not counted.
 */
export const DAILY_REPORT_VERSION = 'sky-daily-report-v1';
export const STATS_DO_NAME = '__sky-daily-stats__';
export const REPORT_KEY = (day) => 'sky:daily-report:' + day;
export const REPORT_INDEX_KEY = 'sky:daily-report:index';
export const REPORT_UTC_HOUR = 18;          /* 00:00 in Dhaka (UTC+6) */
export const REPORT_WINDOW_MIN = 10;        /* retry for 10 cron ticks if one fails */
const KEEP_DAYS = 60;
const DHAKA_MS = 6 * 60 * 60 * 1000;

/* The only counters that may be stored. Anything else is dropped. */
export const STAT_FIELDS = Object.freeze([
  'requests', 'out_model', 'out_cache', 'out_tools', 'out_failed', 'out_limited',
  'prov_gemini', 'prov_groq', 'prov_cloudflare', 'prov_openai', 'prov_other',
  'lat_lt2', 'lat_lt5', 'lat_ge5', 'lat_sum_ms', 'lat_n', 'ft_sum_ms', 'ft_n'
]);

export function dhakaDay(ms) {
  return new Date(Number(ms) + DHAKA_MS).toISOString().slice(0, 10);
}

/** Sanitise an increment: whitelisted fields, whole numbers 0..10 minutes of ms. */
export function cleanInc(inc) {
  const out = {};
  if (!inc || typeof inc !== 'object') return out;
  for (const k of STAT_FIELDS) {
    const n = Math.round(Number(inc[k]));
    if (Number.isFinite(n) && n > 0) out[k] = Math.min(n, 600000);
  }
  return out;
}

/** Counts for one finished request, from the ai.timing fields ai-agent.js logs. */
export function statsFromTiming(t) {
  t = t || {};
  const inc = { requests: 1 };
  if (t.limited) { inc.out_limited = 1; return inc; }
  if (t.failed) inc.out_failed = 1;
  else if (t.provider === 'tools' || t.quota === false) inc.out_tools = 1;
  else if (t.cache && !/miss|off/.test(String(t.cache))) inc.out_cache = 1;
  else inc.out_model = 1;
  if (inc.out_model) {
    const p = String(t.provider || '').toLowerCase();
    const key = p === 'gemini' || p === 'groq' || p === 'cloudflare' ? 'prov_' + p : (/openai|openrouter|compat/.test(p) ? 'prov_openai' : 'prov_other');
    inc[key] = 1;
  }
  const total = Number(t.totalMs);
  if (Number.isFinite(total) && total >= 0 && !inc.out_failed) {
    inc[total < 2000 ? 'lat_lt2' : total < 5000 ? 'lat_lt5' : 'lat_ge5'] = 1;
    inc.lat_sum_ms = Math.round(total); inc.lat_n = 1;
  }
  const ft = Number(t.firstToken);
  if (Number.isFinite(ft) && ft > 0) { inc.ft_sum_ms = Math.round(ft); inc.ft_n = 1; }
  return cleanInc(inc);
}

const statsStub = (env) => {
  const b = env && env.AI_STATE;
  if (!b || typeof b.idFromName !== 'function' || typeof b.get !== 'function') return null;
  return b.get(b.idFromName(STATS_DO_NAME));
};
const call = async (stub, path, body) => {
  const r = await stub.fetch(new Request('https://ai-state' + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) }));
  if (!r.ok) throw new Error('ai-state-' + r.status);
  return r.json();
};

/** Best effort, never throws, never blocks an answer (500 ms cap). */
export async function bumpDailyStats(env, inc, now = Date.now()) {
  try {
    const stub = statsStub(env);
    const clean = cleanInc(inc);
    if (!stub || !Object.keys(clean).length) return false;
    await Promise.race([call(stub, '/stats/bump', { day: dhakaDay(now), inc: clean }), new Promise((r) => setTimeout(r, 500))]);
    return true;
  } catch (_) { return false; }
}

export async function readDailyStats(env, day) {
  const stub = statsStub(env);
  if (!stub) return null;
  return (await call(stub, '/stats/get', { day })).stats || {};
}

const pct = (a, b) => (b > 0 ? Math.round((a * 1000) / b) / 10 : 0);
/** The report: only totals, shares and averages. */
export function buildReport(day, s, now = Date.now()) {
  s = cleanInc(s);
  const n = (k) => s[k] || 0;
  const req = n('requests');
  const answered = n('out_model') + n('out_cache') + n('out_tools');
  return {
    version: DAILY_REPORT_VERSION, day, generatedAt: new Date(now).toISOString(), anonymous: true,
    totals: { requests: req, answered, failed: n('out_failed'), dailyLimitReached: n('out_limited') },
    answeredBy: { model: n('out_model'), cache: n('out_cache'), tools: n('out_tools') },
    shares: { successPct: pct(answered, req - n('out_limited')), cachePct: pct(n('out_cache'), answered), toolsPct: pct(n('out_tools'), answered), failedPct: pct(n('out_failed'), req) },
    providers: { gemini: n('prov_gemini'), groq: n('prov_groq'), cloudflare: n('prov_cloudflare'), openai: n('prov_openai'), other: n('prov_other') },
    speed: {
      avgMs: n('lat_n') ? Math.round(n('lat_sum_ms') / n('lat_n')) : null,
      firstWordAvgMs: n('ft_n') ? Math.round(n('ft_sum_ms') / n('ft_n')) : null,
      under2sPct: pct(n('lat_lt2'), n('lat_n')), from2to5sPct: pct(n('lat_lt5'), n('lat_n')), over5sPct: pct(n('lat_ge5'), n('lat_n'))
    },
    note: 'অ্যাপের ভেতরে দেওয়া উত্তর (hi/ধন্যবাদ, জমানো উত্তর, অ্যাপের টুল) server-এ আসে না, তাই এখানে গোনা হয়নি।'
  };
}

/**
 * Cron hook (every minute). Does real work only in the first REPORT_WINDOW_MIN
 * minutes after UTC 18:00 and only once per day (KV guard).
 */
export async function runDailyReport(env, now = Date.now()) {
  const d = new Date(now);
  if (d.getUTCHours() !== REPORT_UTC_HOUR || d.getUTCMinutes() >= REPORT_WINDOW_MIN) return { skipped: 'not-time' };
  const kv = env && env.PUB_KV;
  if (!kv) return { skipped: 'no-kv' };
  const day = dhakaDay(now - (d.getUTCMinutes() + 1) * 60000); /* the Dhaka day that just ended */
  if (await kv.get(REPORT_KEY(day))) return { skipped: 'done', day };
  const stats = await readDailyStats(env, day);
  if (stats == null) return { skipped: 'no-state', day };
  const report = buildReport(day, stats, now);
  await kv.put(REPORT_KEY(day), JSON.stringify(report), { expirationTtl: 400 * 86400 });
  let index = [];
  try { index = JSON.parse((await kv.get(REPORT_INDEX_KEY)) || '[]'); } catch (_) { index = []; }
  index = [day].concat((Array.isArray(index) ? index : []).filter((x) => x !== day)).slice(0, KEEP_DAYS);
  await kv.put(REPORT_INDEX_KEY, JSON.stringify(index));
  return { ok: true, day, report };
}

/** For the admin route: newest first, at most `days` (1..60). */
export async function listReports(kv, days = 7) {
  if (!kv) return { version: DAILY_REPORT_VERSION, reports: [] };
  const want = Math.max(1, Math.min(KEEP_DAYS, Math.round(Number(days)) || 7));
  let index = [];
  try { index = JSON.parse((await kv.get(REPORT_INDEX_KEY)) || '[]'); } catch (_) { index = []; }
  const reports = [];
  for (const day of (Array.isArray(index) ? index : []).slice(0, want)) {
    try { const r = JSON.parse((await kv.get(REPORT_KEY(day))) || 'null'); if (r) reports.push(r); } catch (_) {}
  }
  return { version: DAILY_REPORT_VERSION, reports };
}
