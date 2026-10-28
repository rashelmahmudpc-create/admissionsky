/* Phase 4 (FCM blueprint), event notifications.
 *
 * Phase G sends a nudge for the day. This engine reports what the student
 * actually achieved: a streak milestone, a new personal best, a cleared
 * backlog, a mastery milestone, a finished exam.
 *
 * Two rules, same as Phase G:
 *   1. Never announce without a real transition. An event fires only when the
 *      server data moved, never for a state that was already true.
 *   2. Never duplicate. Every event carries a stable key, so a cron tick that
 *      runs twice (or a retry) cannot deliver the same achievement again.
 *
 * The very first time a student is seen there is no previous snapshot, so the
 * snapshot is written and NOTHING is sent. That baseline rule is what stops a
 * new deploy from firing "personal best!" at every existing student at once.
 *
 * Decision logic is pure and separate from I/O; the D1 reads/writes are thin
 * SQL. All times are Asia/Dhaka (UTC+6).
 */
import { fcmSendToTokens, fcmConfigured, FcmStore } from './fcm-notification.mjs';
import { dhakaParts, inQuietHours, inSendWindow } from './personalized-notification.mjs';

const DAY_MS = 24 * 3600 * 1000;

export const EVENT_KINDS = Object.freeze([
  'streak-milestone', 'personal-best', 'backlog-cleared', 'mastery-milestone', 'exam-completed'
]);

export const STREAK_MILESTONES = Object.freeze([3, 7, 14, 30, 50, 100, 365]);
export const MASTERY_MILESTONES = Object.freeze([25, 50, 100, 250, 500]);

export const DEFAULTS = Object.freeze({
  max_per_day: 3,
  seen_exam_cap: 20,
  send_after_hour: 8,
  send_before_hour: 22,
  quiet_hours_enabled: 1,
  quiet_start: '23:00',
  quiet_end: '07:00'
});

/* ── message copy (pure) ─────────────────────────────────────────────────── */

const MSG = {
  'streak-milestone': {
    bn: n => ({ title: `🔥 ${n} দিনের স্ট্রিক!`, body: `${n} দিন টানা পড়ছো, এই অভ্যাসটাই তোমাকে এগিয়ে নেবে` }),
    en: n => ({ title: `🔥 ${n}-day streak!`, body: `${n} days in a row, that habit is what moves you forward` })
  },
  'personal-best': {
    bn: n => ({ title: '🏆 নতুন ব্যক্তিগত সেরা', body: `সর্বোচ্চ স্কোর এখন ${n}%, আগের সেরাটাও তুমিই ভেঙেছো` }),
    en: n => ({ title: '🏆 New personal best', body: `Your top score is now ${n}%, you broke your own record` })
  },
  'backlog-cleared': {
    bn: () => ({ title: '✅ রিভিশন শেষ', body: 'অপেক্ষমাণ ভুল প্রশ্নগুলো সব ঝালাই হয়ে গেছে, দুর্দান্ত!' }),
    en: () => ({ title: '✅ Backlog cleared', body: 'Every pending revision is cleared, excellent work!' })
  },
  'mastery-milestone': {
    bn: n => ({ title: `🎖️ ${n}টি প্রশ্নে দক্ষ`, body: `${n}টি প্রশ্ন এখন তোমার মুঠোয়, পরের ধাপে যাওয়ার সময়` }),
    en: n => ({ title: `🎖️ ${n} mastered`, body: `${n} questions mastered, time for the next milestone` })
  },
  'exam-completed': {
    bn: n => ({ title: '📝 পরীক্ষা সম্পন্ন', body: `তোমার স্কোর ${n}%, ফলাফল দেখে দুর্বল topic গুলোয় নজর দাও` }),
    en: n => ({ title: '📝 Exam completed', body: `You scored ${n}%, check the weak topics in your result` })
  }
};

export function buildEventMessage(event, lang = 'bn') {
  const set = MSG[event?.kind];
  if (!set) return null;
  const pick = set[lang] || set.bn;
  const out = typeof pick === 'function' ? pick(event.value) : pick;
  return out ? { ...out, kind: event.kind, link: event.link || 'dashboard' } : null;
}

/* ── detection core (pure) ───────────────────────────────────────────────── */

const nextMilestone = (value, table) => {
  const first = table.find(m => value < m);
  return first === undefined ? null : first;
};

/* The highest milestone reached at or below `value`, used to decide whether a
 * snapshot that predates this code still deserves one announcement. */
const reachedMilestone = (value, table) => {
  let hit = null;
  for (const m of table) { if (value >= m) hit = m; else break; }
  return hit;
};

export function emptySnapshot() {
  return { streak: 0, bestScore: null, mastered: 0, pending: 0, exams: [] };
}

/* Exam entries are stored as bare ids, but an older/alternate snapshot may hold
 * `{id, score}` objects. Reading both keeps a snapshot written by either shape
 * from re-announcing every exam it lists. */
const examIds = list => (Array.isArray(list) ? list : [])
  .map(e => (e && typeof e === 'object' ? e.id : e))
  .filter(v => v !== undefined && v !== null && String(v) !== '')
  .map(String);

/* `prev` null means this student has never been seen, write the baseline only. */
export function detectEvents(prev, curr, nowMs = Date.now()) {
  if (!prev) return { events: [], baseline: true };
  const events = [];
  const p = { ...emptySnapshot(), ...prev };
  const c = { ...emptySnapshot(), ...curr };

  /* Streak milestone: only when this run crosses a milestone boundary. */
  const hitStreak = reachedMilestone(Number(c.streak || 0), STREAK_MILESTONES);
  if (hitStreak && Number(p.streak || 0) < hitStreak) {
    events.push({ kind: 'streak-milestone', key: `streak:${hitStreak}`, value: hitStreak, link: 'dashboard' });
  }

  /* Personal best: needs a previous best to beat, so the first exam is not a
   * "record" and the very first snapshot cannot spam one. */
  const best = Number(c.bestScore);
  const prevBest = p.bestScore == null ? null : Number(p.bestScore);
  if (Number.isFinite(best) && prevBest != null && best > prevBest) {
    events.push({ kind: 'personal-best', key: `pb:${Math.round(best)}`, value: Math.round(best), link: 'dashboard' });
  }

  /* Backlog cleared: a real transition from "had work" to "no work". */
  if (Number(p.pending || 0) > 0 && Number(c.pending || 0) === 0) {
    events.push({ kind: 'backlog-cleared', key: `backlog:${dhakaParts(nowMs).date}`, value: 0, link: 'smart-revision' });
  }

  /* Mastery milestone: crossed a threshold between snapshots. */
  const hitMastery = reachedMilestone(Number(c.mastered || 0), MASTERY_MILESTONES);
  if (hitMastery && Number(p.mastered || 0) < hitMastery) {
    events.push({ kind: 'mastery-milestone', key: `mastery:${hitMastery}`, value: hitMastery, link: 'dashboard' });
  }

  /* Exams: one notification per result id never seen before. */
  const seen = new Set(examIds(p.exams));
  for (const exam of Array.isArray(c.exams) ? c.exams : []) {
    const id = String(exam?.id || '');
    if (!id || seen.has(id)) continue;
    if (!Number.isFinite(Number(exam.score))) continue;
    events.push({ kind: 'exam-completed', key: `exam:${id}`, value: Math.round(Number(exam.score)), link: 'dashboard' });
  }

  /* A new record IS an exam result. Announcing both tells the student the same
   * number twice, so the plain exam message yields to the record. */
  const record = events.find(e => e.kind === 'personal-best');
  return {
    events: record ? events.filter(e => !(e.kind === 'exam-completed' && e.value === record.value)) : events,
    baseline: false
  };
}

/* Keep the exam-id list bounded so the snapshot row cannot grow forever.
 * Exams are normalized to bare ids: only identity matters for duplicate
 * detection, and `String({...})` would otherwise collapse every entry to
 * "[object Object]", making a new exam look already-seen. */
export function trimSnapshot(snapshot, cap = DEFAULTS.seen_exam_cap) {
  const s = { ...emptySnapshot(), ...(snapshot || {}) };
  const exams = examIds(s.exams);
  return { ...s, exams: exams.slice(Math.max(0, exams.length - cap)) };
}

/* ── storage + I/O ───────────────────────────────────────────────────────── */

export class EventStore {
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
        await this.#d1.prepare(`CREATE TABLE IF NOT EXISTS notification_event_state (
          user_id TEXT PRIMARY KEY,
          snapshot_json TEXT NOT NULL,
          updated_at INTEGER NOT NULL
        )`).run();
        await this.#d1.prepare(`CREATE TABLE IF NOT EXISTS notification_event_sends (
          user_id TEXT NOT NULL,
          event_key TEXT NOT NULL,
          kind TEXT NOT NULL,
          sent_at INTEGER NOT NULL,
          PRIMARY KEY (user_id, event_key)
        )`).run();
        await this.#d1.prepare('CREATE INDEX IF NOT EXISTS idx_nes_user_day ON notification_event_sends(user_id, sent_at)').run();
      })().catch(err => { this.#ready = null; throw err; });
    }
    await this.#ready;
  }

  async getSnapshot(userId) {
    await this.init();
    const row = await this.#d1.prepare('SELECT snapshot_json FROM notification_event_state WHERE user_id=?').bind(userId).first();
    if (!row?.snapshot_json) return null;
    try { return JSON.parse(String(row.snapshot_json)); } catch { return null; }
  }

  async putSnapshot(userId, snapshot, now) {
    await this.init();
    await this.#d1.prepare(
      `INSERT INTO notification_event_state(user_id, snapshot_json, updated_at) VALUES (?,?,?)
       ON CONFLICT(user_id) DO UPDATE SET snapshot_json=excluded.snapshot_json, updated_at=excluded.updated_at`
    ).bind(userId, JSON.stringify(trimSnapshot(snapshot)), now).run();
  }

  /* Claim an event before sending: a duplicate key means it already went out. */
  async claimEvent(userId, eventKey, kind, now) {
    await this.init();
    const res = await this.#d1.prepare(
      `INSERT INTO notification_event_sends(user_id, event_key, kind, sent_at) VALUES (?,?,?,?)
       ON CONFLICT(user_id, event_key) DO NOTHING`
    ).bind(userId, eventKey, kind, now).run();
    return Number(res?.meta?.changes || 0) > 0;
  }

  async sentToday(userId, sinceMs) {
    await this.init();
    const row = await this.#d1.prepare(
      'SELECT COUNT(*) AS n FROM notification_event_sends WHERE user_id=? AND sent_at>=?'
    ).bind(userId, sinceMs).first();
    return Number(row?.n || 0);
  }

  /* Everyone who currently has an active device. */
  async audience() {
    await this.init();
    const rows = await this.#d1.prepare('SELECT DISTINCT user_id FROM fcm_devices WHERE is_active=1').all();
    return (rows?.results || []).map(r => String(r.user_id));
  }

  async prefs(userId) {
    await this.init();
    const row = await this.#d1.prepare('SELECT * FROM notification_settings WHERE user_id=?').bind(userId).first();
    if (!row) return { ...DEFAULTS, event_enabled: 1 };
    return {
      event_enabled: Number(row.event_enabled ?? 1),
      quiet_hours_enabled: Number(row.quiet_hours_enabled ?? 1),
      quiet_start: String(row.quiet_start || DEFAULTS.quiet_start),
      quiet_end: String(row.quiet_end || DEFAULTS.quiet_end)
    };
  }

  /* The student's real progress, straight from the Phase B–F tables. */
  async learningState(userId, today) {
    await this.init();
    const daily = await this.#d1.prepare(
      `SELECT day, payload_json FROM user_daily_stats
       WHERE user_id=? AND deleted_at IS NULL AND day<=? ORDER BY day DESC LIMIT 400`
    ).bind(userId, today).all();

    const stats = (daily?.results || []).map(r => {
      let doc = null;
      try { doc = JSON.parse(String(r.payload_json)); } catch { doc = null; }
      return { day: String(r.day), questions: Number(doc?.questions || 0) };
    }).filter(s => s.questions > 0);

    /* Streak: consecutive active days ending today or yesterday. Counting from
     * yesterday keeps the streak alive until the day is actually missed. */
    const activeDays = new Set(stats.map(s => s.day));
    const dayAt = offset => new Date(Date.parse(today + 'T00:00:00Z') - offset * DAY_MS).toISOString().slice(0, 10);
    let streak = 0;
    let cursor = activeDays.has(today) ? 0 : 1;
    if (activeDays.has(dayAt(cursor))) {
      while (activeDays.has(dayAt(cursor))) { streak += 1; cursor += 1; }
    }

    const exams = await this.#d1.prepare(
      `SELECT id, payload_json FROM user_exam_results
       WHERE user_id=? AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT 200`
    ).bind(userId).all();
    const examRows = (exams?.results || []).map(r => {
      let doc = null;
      try { doc = JSON.parse(String(r.payload_json)); } catch { doc = null; }
      const score = Number(doc?.score ?? doc?.percentage ?? NaN);
      return { id: String(r.id), score };
    }).filter(e => Number.isFinite(e.score));

    const masteredRow = await this.#d1.prepare(
      `SELECT COUNT(*) AS n FROM user_mistakes
       WHERE user_id=? AND deleted_at IS NULL AND (COALESCE(mastered,0)=1 OR revision_status='mastered')`
    ).bind(userId).first();

    const pendingRow = await this.#d1.prepare(
      `SELECT COUNT(*) AS n FROM user_mistakes
       WHERE user_id=? AND deleted_at IS NULL AND COALESCE(mastered,0)=0
         AND (revision_status IS NULL OR revision_status<>'mastered')`
    ).bind(userId).first();

    return {
      streak,
      mastered: Number(masteredRow?.n || 0),
      pending: Number(pendingRow?.n || 0),
      bestScore: examRows.length ? Math.max(...examRows.map(e => e.score)) : null,
      exams: examRows.slice(0, DEFAULTS.seen_exam_cap).map(e => ({ id: e.id, score: Math.round(e.score) }))
    };
  }
}

/* Send one student their event message. Injected in tests. */
async function defaultSend(env, userId, message) {
  const fcm = new FcmStore(env?.PROFILE_DB);
  const targets = await fcm.activeTokens(userId);
  if (!targets.length) return { ok: false, reason: 'no-devices', sent: 0 };
  const out = await fcmSendToTokens(env, targets, {
    title: message.title,
    body: message.body,
    data: { link: message.link, src: 'fcm-event', kind: message.kind }
  });
  if (out.badIds?.length) await fcm.markInactive(out.badIds, Date.now());
  return { ok: out.sent > 0, sent: out.sent, failed: out.failed };
}

/* Cron entry: announce real achievements, at most `max_per_day` per student.
 * `deps` lets tests inject the clock and the transport. */
export async function runScheduledEventNotifications(env, deps = {}) {
  const now = deps.now ? deps.now() : Date.now();
  const store = deps.store || new EventStore(env?.PROFILE_DB);
  if (!store.available()) return { processed: 0, sent: 0, baseline: 0 };
  if (!(env?.__skipFcmCheck) && deps.requireFcm !== false && !fcmConfigured(env)) {
    return { processed: 0, sent: 0, baseline: 0, reason: 'fcm-not-configured' };
  }

  const send = deps.send || ((userId, message) => defaultSend(env, userId, message));
  const { date, hour, minute } = dhakaParts(now);
  const dayStart = Date.parse(date + 'T00:00:00Z') - 6 * 3600 * 1000;
  const users = await store.audience();
  let sent = 0;
  let baseline = 0;
  const results = [];

  for (const userId of users) {
    try {
      const prefs = await store.prefs(userId);
      if (!Number(prefs.event_enabled)) { continue; }
      const curr = await store.learningState(userId, date);
      const prev = await store.getSnapshot(userId);
      /* First sight: record the baseline and stay silent. */
      if (!prev) {
        await store.putSnapshot(userId, curr, now);
        baseline += 1;
        continue;
      }
      const { events } = detectEvents(prev, curr, now);
      if (!events.length) { await store.putSnapshot(userId, curr, now); continue; }

      let budget = Math.max(0, (Number(deps.maxPerDay ?? DEFAULTS.max_per_day)) - await store.sentToday(userId, dayStart));
      /* Order matters: the rarest achievements go first when the budget is
       * tight, so a busy day cannot crowd out a milestone. */
      const rank = { 'streak-milestone': 0, 'personal-best': 1, 'mastery-milestone': 2, 'backlog-cleared': 3, 'exam-completed': 4 };
      events.sort((a, b) => (rank[a.kind] ?? 9) - (rank[b.kind] ?? 9));

      for (const event of events) {
        if (budget <= 0) break;
        const message = buildEventMessage(event);
        if (!message) continue;
        if (inQuietHours(hour, minute, prefs)) break;
        if (!inSendWindow(hour, { ...prefs, ...DEFAULTS })) break;
        /* Claim first: a crash mid-send cannot double-deliver. */
        const claimed = await store.claimEvent(userId, event.key, event.kind, now);
        if (!claimed) continue;
        const outcome = await send(userId, message);
        budget -= 1;
        if (outcome?.ok) sent += 1;
        results.push({ userId, kind: event.kind, ok: Boolean(outcome?.ok) });
      }
      await store.putSnapshot(userId, curr, now);
    } catch (err) {
      /* One bad account must not stop the run. */
      results.push({ userId, ok: false, error: String(err?.message || err).slice(0, 120) });
    }
  }
  return { processed: users.length, sent, baseline, date, results };
}

export const __eventTest = Object.freeze({
  detectEvents,
  buildEventMessage,
  trimSnapshot,
  emptySnapshot,
  reachedMilestone,
  MSG
});
