/* Phase 4 (FCM blueprint), automation digests.
 *
 * The blueprint asks for Daily / Weekly / Monthly automation. Phase G sends a
 * nudge when something needs doing; event notifications celebrate a milestone.
 * This engine does neither: it *recaps* work already done, so a student can see
 * the shape of their week instead of only its last moment.
 *
 * Three rules keep it from becoming noise:
 *   1. A digest is only sent when the period it covers has real study in it.
 *   2. Each period key (day / ISO week / month) is sent at most once, so a cron
 *      tick that repeats, or a worker that was down at the send hour, cannot
 *      deliver it twice.
 *   3. At most one digest per student per local day, the rarest winning, so the
 *      1st of a Monday does not fire three messages in one breath.
 *
 * Period math and message copy are pure; D1 work is thin SQL. Asia/Dhaka (UTC+6).
 */
import { fcmSendToTokens, fcmConfigured, FcmStore } from './fcm-notification.mjs';
import { dhakaParts, inQuietHours, inSendWindow } from './personalized-notification.mjs';
import { bestSendHour } from './send-planner.mjs';

const DAY_MS = 24 * 3600 * 1000;
const DHAKA_OFFSET_MS = 6 * 3600 * 1000;

/* Rarest first: when several periods come due together, this is the order. */
export const DIGEST_KINDS = Object.freeze(['monthly', 'weekly', 'daily']);

export const DEFAULTS = Object.freeze({
  daily_after_hour: 20,
  weekly_after_hour: 8,
  monthly_after_hour: 8,
  max_per_day: 1,
  send_after_hour: 8,
  send_before_hour: 23,
  quiet_hours_enabled: 1,
  quiet_start: '23:30',
  quiet_end: '06:30'
});

/* ── calendar helpers (pure) ─────────────────────────────────────────────── */

const pad2 = n => String(n).padStart(2, '0');
const utcDay = ms => new Date(ms).toISOString().slice(0, 10);
const shiftDays = (dateStr, days) => utcDay(Date.parse(dateStr + 'T00:00:00Z') + days * DAY_MS);

/* ISO-8601 week: Monday is day 1, week 1 is the week holding Jan 4. */
export function isoWeek(dateStr) {
  const d = new Date(dateStr + 'T00:00:00Z');
  const day = (d.getUTCDay() + 6) % 7;            // Mon=0 … Sun=6
  d.setUTCDate(d.getUTCDate() - day + 3);          // Thursday of this week
  const isoYear = d.getUTCFullYear();
  const jan4 = new Date(Date.UTC(isoYear, 0, 4));
  const jan4Day = (jan4.getUTCDay() + 6) % 7;
  const week1Monday = Date.UTC(isoYear, 0, 4 - jan4Day);
  const week = Math.round((d.getTime() - week1Monday) / (7 * DAY_MS)) + 1;
  return { isoYear, week };
}

/* Everything a digest decision needs, in one local-time read. */
export function dhakaCalendar(nowMs) {
  const { date, hour, minute } = dhakaParts(nowMs);
  const d = new Date(Date.parse(date + 'T00:00:00Z'));
  const { isoYear, week } = isoWeek(date);
  return {
    date,
    hour,
    minute,
    weekday: (d.getUTCDay() + 6) % 7,      // Mon=0 … Sun=6
    dayOfMonth: d.getUTCDate(),
    monthKey: date.slice(0, 7),
    weekKey: `${isoYear}-W${pad2(week)}`,
    prevMonthKey: new Date(Date.parse(date.slice(0, 8) + '01T00:00:00Z') - DAY_MS).toISOString().slice(0, 7)
  };
}

/* Which digests the clock says are due right now, rarest first. A period stays
 * due for the rest of its window, so a missed send hour is caught up later. */
export function dueDigests(cal, prefs = {}) {
  const out = [];
  if (cal.dayOfMonth === 1 && cal.hour >= Number(prefs.monthly_after_hour ?? DEFAULTS.monthly_after_hour)) {
    out.push({ kind: 'monthly', periodKey: cal.prevMonthKey });
  }
  if (cal.weekday === 6 && cal.hour >= Number(prefs.weekly_after_hour ?? DEFAULTS.weekly_after_hour)) {
    out.push({ kind: 'weekly', periodKey: cal.weekKey });
  }
  if (cal.hour >= Number(prefs.daily_after_hour ?? DEFAULTS.daily_after_hour)) {
    out.push({ kind: 'daily', periodKey: cal.date });
  }
  return out;
}

/* The [from, to] day range a digest summarizes, inclusive. */
export function digestRange(kind, cal) {
  if (kind === 'monthly') {
    const start = `${cal.prevMonthKey}-01`;
    const nextMonthStart = `${cal.monthKey}-01`;
    return { from: start, to: shiftDays(nextMonthStart, -1) };
  }
  if (kind === 'weekly') {
    return { from: shiftDays(cal.date, -7), to: shiftDays(cal.date, -1) };
  }
  return { from: cal.date, to: cal.date };
}

export function summarize(stats = []) {
  let questions = 0;
  let correct = 0;
  let activeDays = 0;
  for (const s of stats) {
    const q = Number(s?.questions || 0);
    if (q <= 0) continue;
    questions += q;
    correct += Number(s?.correct || 0);
    activeDays += 1;
  }
  return {
    questions,
    correct,
    activeDays,
    accuracy: questions > 0 ? Math.round((correct / questions) * 100) : 0
  };
}

/* ── message copy (pure) ─────────────────────────────────────────────────── */

const MSG = {
  daily: {
    bn: s => ({ title: '📊 আজকের হিসাব', body: `আজ ${s.questions}টি প্রশ্ন, শুদ্ধতা ${s.accuracy}%, এই ছন্দ ধরে রাখো` }),
    en: s => ({ title: '📊 Today in numbers', body: `${s.questions} questions today at ${s.accuracy}% accuracy, keep the rhythm` })
  },
  weekly: {
    bn: s => ({ title: '🗓️ সপ্তাহের রিপোর্ট', body: `গত সপ্তাহে ${s.questions}টি প্রশ্ন, ${s.activeDays} দিন পড়া, শুদ্ধতা ${s.accuracy}%` }),
    en: s => ({ title: '🗓️ Your week', body: `Last week: ${s.questions} questions on ${s.activeDays} days at ${s.accuracy}% accuracy` })
  },
  monthly: {
    bn: s => ({ title: '📅 মাসের রিপোর্ট', body: `গত মাসে ${s.questions}টি প্রশ্ন, ${s.activeDays} দিন পড়া, শুদ্ধতা ${s.accuracy}%` }),
    en: s => ({ title: '📅 Your month', body: `Last month: ${s.questions} questions on ${s.activeDays} days at ${s.accuracy}% accuracy` })
  }
};

export function buildDigestMessage(kind, summary, lang = 'bn') {
  const set = MSG[kind];
  if (!set) return null;
  const pick = set[lang] || set.bn;
  const out = pick(summary || summarize([]));
  return out ? { ...out, kind: `digest-${kind}`, link: 'dashboard' } : null;
}

/* ── storage + I/O ───────────────────────────────────────────────────────── */

export class DigestStore {
  #d1;
  #ready = null;

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
        await this.#d1.prepare(`CREATE TABLE IF NOT EXISTS notification_digest_sends (
          user_id TEXT NOT NULL,
          period_key TEXT NOT NULL,
          kind TEXT NOT NULL,
          sent_at INTEGER NOT NULL,
          PRIMARY KEY (user_id, period_key)
        )`).run();
        await this.#d1.prepare('CREATE INDEX IF NOT EXISTS idx_nds_user_day ON notification_digest_sends(user_id, sent_at)').run();
      })().catch(err => { this.#ready = null; throw err; });
    }
    await this.#ready;
  }

  /* Claim a period before sending: a duplicate key means it already went out. */
  async claimPeriod(userId, periodKey, kind, now) {
    await this.init();
    const res = await this.#d1.prepare(
      `INSERT INTO notification_digest_sends(user_id, period_key, kind, sent_at) VALUES (?,?,?,?)
       ON CONFLICT(user_id, period_key) DO NOTHING`
    ).bind(userId, periodKey, kind, now).run();
    return Number(res?.meta?.changes || 0) > 0;
  }

  async sentToday(userId, sinceMs) {
    await this.init();
    const row = await this.#d1.prepare(
      'SELECT COUNT(*) AS n FROM notification_digest_sends WHERE user_id=? AND sent_at>=?'
    ).bind(userId, sinceMs).first();
    return Number(row?.n || 0);
  }

  async audience() {
    await this.init();
    const rows = await this.#d1.prepare('SELECT DISTINCT user_id FROM fcm_devices WHERE is_active=1').all();
    return (rows?.results || []).map(r => String(r.user_id));
  }

  async prefs(userId) {
    await this.init();
    const row = await this.#d1.prepare('SELECT * FROM notification_settings WHERE user_id=?').bind(userId).first();
    if (!row) return { ...DEFAULTS, digest_enabled: 1 };
    return {
      /* Reuses the Phase G daily switch as the master opt-out: a student who
       * turned nudges off does not want recaps either. */
      digest_enabled: Number(row.personalized_enabled ?? 1),
      quiet_hours_enabled: Number(row.quiet_hours_enabled ?? 1),
      quiet_start: String(row.quiet_start || DEFAULTS.quiet_start),
      quiet_end: String(row.quiet_end || DEFAULTS.quiet_end)
    };
  }

  /* Daily totals for one student inside [from, to], deleted rows excluded. */
  async rangeStats(userId, from, to) {
    await this.init();
    const res = await this.#d1.prepare(
      `SELECT day, payload_json FROM user_daily_stats
       WHERE user_id=? AND deleted_at IS NULL AND day>=? AND day<=? ORDER BY day ASC`
    ).bind(userId, from, to).all();
    return (res?.results || []).map(r => {
      let doc = null;
      try { doc = JSON.parse(String(r.payload_json)); } catch { doc = null; }
      return { day: String(r.day), questions: Number(doc?.questions || 0), correct: Number(doc?.correct || 0) };
    });
  }

  /* When this student tends to open things, as `{hour, opened}` events for the
   * timing model. The read timestamp is the honest signal: it is when they
   * actually looked, not when we sent. Dhaka local hour, last 60 reads. */
  async openHours(userId) {
    await this.init();
    const res = await this.#d1.prepare(
      `SELECT read_at FROM notification_reads WHERE user_id=? ORDER BY read_at DESC LIMIT 60`
    ).bind(userId).all();
    return (res?.results || []).map(r => {
      const t = Number(r.read_at) + DHAKA_OFFSET_MS;
      return { hour: new Date(t).getUTCHours(), opened: true };
    });
  }
}

async function defaultSend(env, userId, message) {
  const fcm = new FcmStore(env?.PROFILE_DB);
  const targets = await fcm.activeTokens(userId);
  if (!targets.length) return { ok: false, reason: 'no-devices', sent: 0 };
  const out = await fcmSendToTokens(env, targets, {
    title: message.title,
    body: message.body,
    data: { link: message.link, src: 'fcm-digest', kind: message.kind }
  });
  if (out.badIds?.length) await fcm.markInactive(out.badIds, Date.now());
  return { ok: out.sent > 0, sent: out.sent, failed: out.failed };
}

/* Cron entry: send the digests the calendar says are due. `deps` injects the
 * clock and the transport so tests never touch the network. */
export async function runScheduledDigests(env, deps = {}) {
  const now = deps.now ? deps.now() : Date.now();
  const store = deps.store || new DigestStore(env?.PROFILE_DB);
  if (!store.available()) return { processed: 0, sent: 0, skipped: 0 };
  if (!(env?.__skipFcmCheck) && deps.requireFcm !== false && !fcmConfigured(env)) {
    return { processed: 0, sent: 0, skipped: 0, reason: 'fcm-not-configured' };
  }

  const send = deps.send || ((userId, message) => defaultSend(env, userId, message));
  const cal = dhakaCalendar(now);
  const dayStart = Date.parse(cal.date + 'T00:00:00Z') - DHAKA_OFFSET_MS;
  const maxPerDay = Number(deps.maxPerDay ?? DEFAULTS.max_per_day);
  const users = await store.audience();
  let sent = 0;
  let skipped = 0;
  const results = [];

  for (const userId of users) {
    try {
      const prefs = await store.prefs(userId);
      if (!Number(prefs.digest_enabled)) { skipped += 1; continue; }
      /* Phase 5 AI timing: when we know this student's opening hour, the daily
       * recap waits for it instead of the fixed default. Below the confidence
       * floor bestSendHour returns the default, so behaviour is unchanged for a
       * student we have no history for. */
      let timedPrefs = prefs;
      try {
        const events = await store.openHours(userId);
        const best = bestSendHour(events, { default_hour: Number(prefs.daily_after_hour ?? DEFAULTS.daily_after_hour) });
        if (best.confident) timedPrefs = { ...prefs, daily_after_hour: best.hour };
      } catch (_) { /* timing is an optimisation, never a blocker */ }

      if (inQuietHours(cal.hour, cal.minute, timedPrefs)) { skipped += 1; continue; }
      if (!inSendWindow(cal.hour, { ...DEFAULTS, ...timedPrefs })) { skipped += 1; continue; }

      let budget = Math.max(0, maxPerDay - await store.sentToday(userId, dayStart));
      if (budget <= 0) { skipped += 1; continue; }

      for (const due of dueDigests(cal, timedPrefs)) {
        if (budget <= 0) break;
        const { from, to } = digestRange(due.kind, cal);
        const summary = summarize(await store.rangeStats(userId, from, to));
        /* Silence over an empty period: never recap nothing. */
        if (summary.questions <= 0) continue;
        const message = buildDigestMessage(due.kind, summary);
        if (!message) continue;
        const claimed = await store.claimPeriod(userId, due.periodKey, due.kind, now);
        if (!claimed) continue;
        const outcome = await send(userId, message);
        budget -= 1;
        if (outcome?.ok) sent += 1;
        results.push({ userId, kind: due.kind, periodKey: due.periodKey, ok: Boolean(outcome?.ok) });
      }
    } catch (err) {
      results.push({ userId, ok: false, error: String(err?.message || err).slice(0, 120) });
    }
  }
  return { processed: users.length, sent, skipped, date: cal.date, results };
}

export const __digestTest = Object.freeze({
  dhakaCalendar,
  dueDigests,
  digestRange,
  summarize,
  buildDigestMessage,
  isoWeek,
  MSG
});
