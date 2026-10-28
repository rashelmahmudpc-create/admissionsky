/* Phase G, personalized smart notifications.
 *
 * The global broadcaster (fcm-notification.mjs) sends one message to everyone.
 * This engine sends the RIGHT message to ONE student, using the learning state
 * that Phase B–F now keeps on the server: pending revisions, streak, recent
 * exam scores, inactivity.
 *
 * Two rules shape the design:
 *   1. Never annoy. At most one nudge per student per local day, only inside
 *      waking hours, and only for a reason the data actually supports.
 *   2. Never duplicate. Every send is logged, so a cron tick that runs twice
 *      (or a retry) cannot deliver the same nudge again.
 *
 * Decision logic is pure and separate from I/O so it can be tested directly;
 * the D1 reads/writes are thin SQL. All times are Asia/Dhaka (UTC+6).
 */
import { corsHeaders } from './cors-policy.mjs';

import { UserDataStore } from './userdata-api.mjs';
import { parseBody, sessionUser, FcmStore, fcmSendToTokens, fcmConfigured } from './fcm-notification.mjs';

const DHAKA_OFFSET_MS = 6 * 3600 * 1000;
const DAY_MS = 24 * 3600 * 1000;

/* Daily nudges, best reason first. A student gets the first one that fits. */
export const NUDGE_KINDS = Object.freeze(['revision-due', 'streak-risk', 'exam-weak', 'inactive-3d', 'daily-glow']);

export const DEFAULTS = Object.freeze({
  daily_enabled: 1,
  max_per_day: 1,
  min_pending_revisions: 5,
  inactive_days: 3,
  weak_score_threshold: 60,
  quiet_hours_enabled: 1,
  quiet_start: '23:00',
  quiet_end: '07:00',
  send_after_hour: 8,
  send_before_hour: 22
});

/* ── time helpers (pure) ─────────────────────────────────────────────────── */

export function dhakaParts(nowMs) {
  const d = new Date(Number(nowMs) + DHAKA_OFFSET_MS);
  return {
    date: d.toISOString().slice(0, 10),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes()
  };
}

const toMinutes = hhmm => {
  const m = String(hhmm || '').match(/^(\d{2}):(\d{2})$/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

/* Quiet hours may wrap midnight (23:00 → 07:00). Returns false for a malformed
 * range so a bad value can never silence a student forever. */
export function inQuietHours(hour, minute, prefs) {
  if (!prefs || !Number(prefs.quiet_hours_enabled)) return false;
  const start = toMinutes(prefs.quiet_start);
  const end = toMinutes(prefs.quiet_end);
  if (start == null || end == null || start === end) return false;
  const nowM = hour * 60 + minute;
  return start < end ? (nowM >= start && nowM < end) : (nowM >= start || nowM < end);
}

export function inSendWindow(hour, prefs) {
  const after = Number.isFinite(Number(prefs?.send_after_hour)) ? Number(prefs.send_after_hour) : DEFAULTS.send_after_hour;
  const before = Number.isFinite(Number(prefs?.send_before_hour)) ? Number(prefs.send_before_hour) : DEFAULTS.send_before_hour;
  return hour >= after && hour < before;
}

const dayDiff = (a, b) => Math.round((Date.parse(a + 'T00:00:00Z') - Date.parse(b + 'T00:00:00Z')) / DAY_MS);

/* ── message copy (pure) ─────────────────────────────────────────────────── */

const MSG = {
  'revision-due': {
    bn: n => ({ title: '📚 রিভিশনের সময় হয়েছে', body: `${n}টি ভুল প্রশ্ন রিভিশনের অপেক্ষায় আছে, আজই ঝালাই করে ফেলো` }),
    en: n => ({ title: '📚 Time to revise', body: `${n} missed questions are waiting for revision, clear them today` })
  },
  'streak-risk': {
    bn: () => ({ title: '🔥 স্ট্রিক বাঁচাও', body: 'আজ এখনো পড়া শুরু হয়নি, কয়েকটা প্রশ্ন হলেও স্ট্রিক ধরে রাখো' }),
    en: () => ({ title: '🔥 Keep your streak', body: 'You have not studied yet today, a few questions keeps your streak alive' })
  },
  'exam-weak': {
    bn: n => ({ title: '🎯 দুর্বল topic', body: `সর্বশেষ পরীক্ষায় ${n}% এসেছে, দুর্বল topicগুলো রিভিশন করলে লাভ হবে` }),
    en: n => ({ title: '🎯 Weak topics', body: `Your last exam was ${n}%, revising the weak topics will pay off` })
  },
  'inactive-3d': {
    bn: n => ({ title: '👋 ফিরে এসো', body: `${n} দিন পড়া হয়নি, আজ ছোট একটা সেশন দিয়ে আবার শুরু করো` }),
    en: n => ({ title: '👋 Come back', body: `${n} days without study, a short session today restarts the habit` })
  },
  'daily-glow': {
    bn: n => ({ title: '⭐ চালিয়ে যাও', body: `আজ ${n}টি প্রশ্ন solved, এই ছন্দ ধরে রাখো` }),
    en: n => ({ title: '⭐ Keep going', body: `${n} questions solved today, keep the rhythm` })
  }
};

export function buildMessage(kind, params = {}, lang = 'bn') {
  const set = MSG[kind];
  if (!set) return null;
  const pick = set[lang] || set.bn;
  const out = typeof pick === 'function' ? pick(params.count) : pick;
  return out ? { ...out, kind, link: params.link || 'dashboard' } : null;
}

/* ── decision core (pure) ────────────────────────────────────────────────── */

/* `state` is what the server knows about one student:
 *   { pendingRevisions, mastered, todayQuestions, lastStudyDay, todayDay,
 *     recentExams:[{score,at}], lastActiveAt } */
export function pickNudge(state = {}, prefs = {}, nowMs = Date.now()) {
  const p = { ...DEFAULTS, ...(prefs || {}) };
  if (!Number(p.daily_enabled)) return null;

  const { hour, minute, date } = dhakaParts(nowMs);
  if (inQuietHours(hour, minute, p)) return null;
  if (!inSendWindow(hour, p)) return null;

  const today = state.todayDay || date;
  const studiedToday = Number(state.todayQuestions || 0) > 0;
  const lastDay = String(state.lastStudyDay || '');
  const gapDays = lastDay ? dayDiff(today, lastDay) : null;

  const examScore = Number(state.recentExams?.[0]?.score);
  const revisionCount = Number(state.pendingRevisions || 0);

  const candidates = {
    /* Priority 1: a real backlog the student can act on right now. */
    'revision-due': revisionCount >= p.min_pending_revisions && gapDays !== 0 ? revisionCount : 0,
    /* Priority 2: they studied yesterday, not today, and the day is wearing on. */
    'streak-risk': gapDays === 1 && !studiedToday && hour >= 18 ? 1 : 0,
    /* Priority 3: a genuinely weak recent result. */
    'exam-weak': Number.isFinite(examScore) && examScore > 0 && examScore < p.weak_score_threshold && gapDays !== 0 ? Math.round(examScore) : 0,
    /* Priority 4: drifting away. */
    'inactive-3d': gapDays != null && gapDays >= p.inactive_days ? gapDays : 0,
    /* Priority 5: quiet encouragement on an active day. */
    'daily-glow': studiedToday && Number(state.todayCorrect || 0) >= 10 && gapDays === 0 ? Number(state.todayQuestions || 0) : 0
  };

  for (const kind of NUDGE_KINDS) {
    const value = candidates[kind];
    if (!value) continue;
    if (kind === 'revision-due' || kind === 'inactive-3d') {
      return buildMessage(kind, { count: value, link: kind === 'revision-due' ? 'smart-revision' : 'dashboard' });
    }
    if (kind === 'exam-weak') return buildMessage(kind, { count: value, link: 'smart-revision' });
    if (kind === 'streak-risk') return buildMessage(kind, { count: 1, link: 'dashboard' });
    return buildMessage(kind, { count: value, link: 'dashboard' });
  }
  return null;
}

/* ── storage + I/O ───────────────────────────────────────────────────────── */

export class PersonalizedStore {
  #d1;
  #ready;
  constructor(d1) {
    this.#d1 = d1 || null;
  }

  available() {
    return Boolean(this.#d1);
  }

  async init() {
    if (!this.#d1) return;
    if (!this.#ready) {
      this.#ready = (async () => {
        /* Ensure the student tables this engine reads actually exist. */
        const ud = new UserDataStore(this.#d1);
        if (ud.available()) await ud.init();
        await this.#d1.prepare(`CREATE TABLE IF NOT EXISTS notification_sends (
          user_id TEXT NOT NULL,
          kind TEXT NOT NULL,
          day_key TEXT NOT NULL,
          sent_at INTEGER NOT NULL,
          PRIMARY KEY (user_id, kind, day_key)
        )`).run();
        await this.#d1.prepare('CREATE INDEX IF NOT EXISTS idx_ns_user_day ON notification_sends(user_id, day_key)').run();
      })().catch(err => { this.#ready = null; throw err; });
    }
    await this.#ready;
  }

  /* Every student who currently has at least one active device. */
  async audience() {
    await this.init();
    const rows = await this.#d1.prepare(
      'SELECT DISTINCT user_id FROM fcm_devices WHERE is_active=1'
    ).all();
    return (rows?.results || []).map(r => String(r.user_id));
  }

  async prefs(userId) {
    await this.init();
    const row = await this.#d1.prepare('SELECT * FROM notification_settings WHERE user_id=?').bind(userId).first();
    if (!row) return { ...DEFAULTS };
    return {
      daily_enabled: Number(row.personalized_enabled),
      quiet_hours_enabled: Number(row.quiet_hours_enabled),
      quiet_start: String(row.quiet_start),
      quiet_end: String(row.quiet_end)
    };
  }

  async learningState(userId, today) {
    await this.init();
    const pending = await this.#d1.prepare(
      `SELECT COUNT(*) AS n FROM user_mistakes
       WHERE user_id=? AND deleted_at IS NULL AND COALESCE(mastered,0)=0
         AND (revision_status IS NULL OR revision_status<>'mastered')`
    ).bind(userId).first();

    const lastDay = await this.#d1.prepare(
      'SELECT MAX(day) AS d FROM user_daily_stats WHERE user_id=? AND deleted_at IS NULL'
    ).bind(userId).first();

    const todayRow = await this.#d1.prepare(
      'SELECT payload_json FROM user_daily_stats WHERE user_id=? AND day=? AND deleted_at IS NULL'
    ).bind(userId, today).first();

    const exams = await this.#d1.prepare(
      `SELECT payload_json, updated_at FROM user_exam_results
       WHERE user_id=? AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT 3`
    ).bind(userId).all();

    const activity = await this.#d1.prepare(
      'SELECT MAX(updated_at) AS t FROM user_activity WHERE user_id=? AND deleted_at IS NULL'
    ).bind(userId).first();

    let todayStats = null;
    if (todayRow?.payload_json) {
      try { todayStats = JSON.parse(String(todayRow.payload_json)); } catch { todayStats = null; }
    }
    const recentExams = (exams?.results || []).map(r => {
      let doc = null;
      try { doc = JSON.parse(String(r.payload_json)); } catch { doc = null; }
      return { score: Number(doc?.score ?? doc?.percentage ?? NaN), at: Number(r.updated_at || 0) };
    }).filter(e => Number.isFinite(e.score));

    return {
      pendingRevisions: Number(pending?.n || 0),
      todayQuestions: Number(todayStats?.questions || 0),
      todayCorrect: Number(todayStats?.correct || 0),
      lastStudyDay: lastDay?.d ? String(lastDay.d) : '',
      todayDay: today,
      recentExams,
      lastActiveAt: Number(activity?.t || 0)
    };
  }

  async nudgedToday(userId, dayKey) {
    await this.init();
    const row = await this.#d1.prepare(
      'SELECT COUNT(*) AS n FROM notification_sends WHERE user_id=? AND day_key=?'
    ).bind(userId, dayKey).first();
    return Number(row?.n || 0);
  }

  async recordSend(userId, kind, dayKey, at) {
    await this.init();
    const res = await this.#d1.prepare(
      `INSERT INTO notification_sends(user_id, kind, day_key, sent_at) VALUES (?,?,?,?)
       ON CONFLICT(user_id, kind, day_key) DO NOTHING`
    ).bind(userId, kind, dayKey, at).run();
    /* changes=0 means this exact nudge was already delivered today. */
    return Number(res?.meta?.changes || 0) > 0;
  }
}

/* Send one student's message to their own devices. Injected in tests; the worker
 * passes the real FCM fan-out, so nothing here depends on the network. */
export async function sendToUser(env, userId, store, message) {
  const targets = await store.activeTokens(userId);
  if (!targets.length) return { ok: false, reason: 'no-devices', sent: 0 };
  const out = await fcmSendToTokens(env, targets, {
    title: message.title,
    body: message.body,
    data: { link: message.link, src: 'fcm-personal', kind: message.kind }
  });
  if (out.badIds?.length) await store.markInactive(out.badIds, Date.now());
  return { ok: out.sent > 0, sent: out.sent, failed: out.failed };
}

/* Cron entry: for each student with a device, decide and send at most one nudge.
 * `deps` lets tests inject the clock and the transport. */
export async function runScheduledPersonalizedNotifications(env, deps = {}) {
  const now = deps.now ? deps.now() : Date.now();
  const personalized = deps.store || new PersonalizedStore(env?.PROFILE_DB);
  if (!personalized.available()) return { processed: 0, sent: 0, skipped: 0 };
  if (!(env?.__skipFcmCheck) && deps.requireFcm !== false) {
    if (!fcmConfigured(env)) return { processed: 0, sent: 0, skipped: 0, reason: 'fcm-not-configured' };
  }

  const fcm = deps.fcmStore || new FcmStore(env?.PROFILE_DB);
  const send = deps.send || ((userId, message) => sendToUser(env, userId, fcm, message));

  const { date } = dhakaParts(now);
  const users = await personalized.audience();
  let sent = 0;
  let skipped = 0;
  const results = [];

  for (const userId of users) {
    try {
      if ((await personalized.nudgedToday(userId, date)) >= DEFAULTS.max_per_day) { skipped += 1; continue; }
      const prefs = await personalized.prefs(userId);
      if (!Number(prefs.daily_enabled)) { skipped += 1; continue; }
      const state = await personalized.learningState(userId, date);
      const message = pickNudge(state, prefs, now);
      if (!message) { skipped += 1; continue; }
      /* Claim the slot BEFORE sending: a crash mid-send cannot double-deliver. */
      const claimed = await personalized.recordSend(userId, message.kind, date, now);
      if (!claimed) { skipped += 1; continue; }
      const outcome = await send(userId, message);
      if (outcome?.ok) sent += 1;
      results.push({ userId, kind: message.kind, ok: Boolean(outcome?.ok) });
    } catch (err) {
      /* One bad account must not stop the run. */
      results.push({ userId, ok: false, error: String(err?.message || err).slice(0, 120) });
    }
  }
  return { processed: users.length, sent, skipped, date, results };
}

const jsonResponse = (request, obj, status = 200) => new Response(JSON.stringify(obj), {
  status,
  headers: {
    'Content-Type': 'application/json; charset=utf-8',
    ...corsHeaders(request),
    'Cache-Control': 'no-store'
  }
});

/* Owns /api/notifications/personal-pref (student, session-authenticated) and
 * /api/notifications/personal/* (admin: preview and manual run). */
export async function handlePersonalizedNotificationRequest(request, env, deps = {}) {
  const url = new URL(request.url);
  const path = url.pathname;
  /* The clock is injectable so a preview test never depends on wall-clock hour;
   * the worker passes its ExecutionContext here, which has no `now`. */
  const nowMs = () => (typeof deps?.now === 'function' ? Number(deps.now()) : Date.now());

  /* ── student's own daily-reminder switch ─────────────────────────────────── */
  if (path === '/api/notifications/personal-pref') {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204 });
    const store = new PersonalizedStore(env?.PROFILE_DB);
    if (!store.available()) return jsonResponse(request, { error: 'storage-unavailable' }, 503);
    const session = await sessionUser(env, request);
    if (!session) return jsonResponse(request, { error: 'auth-required' }, 401);
    const userId = String(session.user.id);
    const fcm = new FcmStore(env?.PROFILE_DB);

    if (request.method === 'GET') {
      const prefs = await fcm.getPrefs(userId);
      return jsonResponse(request, { ok: true, personalized_enabled: Number(prefs.personalized_enabled) });
    }
    if (request.method === 'POST') {
      const body = await parseBody(request);
      if (!body || typeof body.personalized_enabled === 'undefined') {
        return jsonResponse(request, { error: 'invalid-body' }, 400);
      }
      const current = await fcm.getPrefs(userId);
      const next = { ...current, personalized_enabled: body.personalized_enabled ? 1 : 0 };
      delete next.stored;
      await fcm.savePrefs(userId, next, Date.now());
      return jsonResponse(request, { ok: true, personalized_enabled: next.personalized_enabled });
    }
    return jsonResponse(request, { error: 'method-not-allowed' }, 405);
  }

  /* ── admin: preview and manual run ───────────────────────────────────────── */
  const PREFIX = '/api/notifications/personal/';
  if (!path.startsWith(PREFIX)) return null;
  if (request.method === 'OPTIONS') return new Response(null, { status: 204 });

  const token = String(request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!env.ADMIN_TOKEN || token !== env.ADMIN_TOKEN) return jsonResponse(request, { error: 'forbidden' }, 403);

  const store = new PersonalizedStore(env?.PROFILE_DB);
  if (!store.available()) return jsonResponse(request, { error: 'storage-unavailable' }, 503);
  const { date, hour, minute } = dhakaParts(nowMs());

  /* Dry run for one student: shows the decision inputs and message, sends nothing. */
  if (path === `${PREFIX}preview` && request.method === 'GET') {
    const userId = String(url.searchParams.get('user') || '').trim();
    if (!userId) return jsonResponse(request, { error: 'missing-user' }, 400);
    const prefs = await store.prefs(userId);
    const state = await store.learningState(userId, date);
    const nudged = await store.nudgedToday(userId, date);
    const now = nowMs();
    return jsonResponse(request, {
      ok: true,
      user: userId,
      dhaka: { date, hour, minute },
      prefs,
      state,
      nudgedToday: nudged,
      alreadySentToday: nudged >= DEFAULTS.max_per_day,
      message: nudged >= DEFAULTS.max_per_day ? null : pickNudge(state, prefs, now)
    });
  }

  /* Roster view: who would get what right now. Sends nothing. */
  if (path === `${PREFIX}preview-all` && request.method === 'GET') {
    const now = nowMs();
    const users = await store.audience();
    const out = [];
    for (const userId of users) {
      const prefs = await store.prefs(userId);
      const nudged = await store.nudgedToday(userId, date);
      const state = await store.learningState(userId, date);
      out.push({
        user: userId,
        alreadySentToday: nudged >= DEFAULTS.max_per_day,
        message: nudged >= DEFAULTS.max_per_day ? null : pickNudge(state, prefs, now)
      });
    }
    return jsonResponse(request, { ok: true, date, audience: users.length, plan: out });
  }

  /* Trigger a run now (same code path as cron). */
  if (path === `${PREFIX}run` && request.method === 'POST') {
    const result = await runScheduledPersonalizedNotifications(env, { store });
    return jsonResponse(request, { ok: true, ...result });
  }

  return jsonResponse(request, { error: 'not_found' }, 404);
}

export const __personalizedTest = Object.freeze({
  pickNudge, buildMessage, dhakaParts, inQuietHours, inSendWindow, NUDGE_KINDS, DEFAULTS,
  PersonalizedStore, runScheduledPersonalizedNotifications, sendToUser, handlePersonalizedNotificationRequest
});
