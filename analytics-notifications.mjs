/* Phase 4 (FCM blueprint), notification analytics.
 *
 * The blueprint asks to see which notifications are effective: Sent, Delivered,
 * Opened, Clicked, Failed, Invalid token, CTR, Engagement. Every one of those
 * already exists somewhere in the Phase 1–2 schema; nothing new is collected
 * here. This module reads them together and does the arithmetic in one pure
 * place so the admin figure and the tests cannot drift apart.
 *
 * Definitions used (so the numbers mean one thing everywhere):
 *   Sent      , a notification row whose send was attempted and accepted.
 *   Delivered , distinct devices that accepted the message (topic reach, or
 *                the per-device fallback count when the topic was not usable).
 *   Failed    , a row that could not be delivered to any device.
 *   Opened    , rows in notification_reads: the student opened the item in the
 *                Notification Center. Opened is a subset of delivered.
 *   Clicked   , taps recorded on the row's action link.
 *   CTR       , clicked / delivered, as a percentage.
 *   Engagement, opened / delivered, as a percentage.
 *
 * All math is pure and takes plain rows; the D1 reads are thin SQL.
 */

const asInt = (v, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

const pct = (part, whole) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0);

/* `rows` are global_notifications rows normalized by FcmStore.recentGlobals;
 * `readCounts` maps notification id → number of distinct students who read it.
 * `inactiveDevices` is the count of tokens FCM told us are dead. */
export function computeAnalytics(rows = [], readCounts = {}, inactiveDevices = 0) {
  const items = [];
  let sent = 0;
  let delivered = 0;
  let failed = 0;
  let opened = 0;
  let clicked = 0;

  for (const row of rows) {
    const status = String(row?.status || '');
    const wasSent = status === 'sent';
    const didFail = status === 'failed';
    const reach = Math.max(0, asInt(row?.delivered, 0));
    const clicks = Math.max(0, asInt(row?.clicks, 0));
    const reads = Math.max(0, asInt(readCounts[String(row?.id)], 0));

    if (wasSent) sent += 1;
    if (didFail) failed += 1;
    delivered += reach;
    clicked += clicks;
    opened += reads;

    items.push({
      id: String(row?.id || ''),
      title: String(row?.title || ''),
      type: String(row?.type || ''),
      status,
      audience: String(row?.audience || ''),
      sentAt: row?.sentAt ? asInt(row.sentAt) : null,
      reachEstimate: row?.reachEstimate == null ? null : asInt(row.reachEstimate, null),
      delivered: reach,
      opened: reads,
      clicked: clicks,
      openRate: pct(reads, reach),
      ctr: pct(clicks, reach),
      error: row?.error ? String(row.error).slice(0, 200) : null
    });
  }

  return {
    totals: {
      notifications: rows.length,
      sent,
      failed,
      delivered,
      opened,
      clicked,
      /* Dead tokens are a health signal, not a send failure: they are the
       * registrations FCM rejected and the worker already deactivated. */
      invalidTokens: Math.max(0, asInt(inactiveDevices, 0)),
      ctr: pct(clicked, delivered),
      engagement: pct(opened, delivered)
    },
    items
  };
}

/* Compact one-line history for the admin list: the same figures, newest first,
 * with a rate only where a denominator exists. */
export function summarizeHistory(rows = [], readCounts = {}) {
  return computeAnalytics(rows, readCounts).items.map(item => ({
    id: item.id,
    title: item.title,
    status: item.status,
    audience: item.audience,
    sentAt: item.sentAt,
    delivered: item.delivered,
    opened: item.opened,
    clicked: item.clicked,
    ctr: item.ctr,
    openRate: item.openRate
  }));
}

/* ── storage reads ───────────────────────────────────────────────────────── */

export class AnalyticsStore {
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
      /* Reuse the Phase 1/2 tables; only ensure the read table exists so a
       * fresh database does not error before the first inbox read. */
      this.#ready = (async () => {
        await this.#d1.prepare(`CREATE TABLE IF NOT EXISTS notification_reads (
          notification_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          read_at INTEGER NOT NULL,
          PRIMARY KEY (notification_id, user_id)
        )`).run();
      })().catch(err => { this.#ready = null; throw err; });
    }
    await this.#ready;
  }

  /* Distinct readers per notification, for the ids given. */
  async readCounts(ids = []) {
    await this.init();
    if (!ids.length) return {};
    const placeholders = ids.map(() => '?').join(',');
    const res = await this.#d1.prepare(
      `SELECT notification_id, COUNT(DISTINCT user_id) AS n
       FROM notification_reads WHERE notification_id IN (${placeholders})
       GROUP BY notification_id`
    ).bind(...ids).all();
    const out = {};
    for (const row of res?.results || []) out[String(row.notification_id)] = asInt(row.n, 0);
    return out;
  }

  /* Registrations FCM has told us are dead and the worker deactivated. */
  async inactiveDeviceCount() {
    await this.init();
    const row = await this.#d1.prepare('SELECT COUNT(*) AS n FROM fcm_devices WHERE is_active=0').first();
    return asInt(row?.n, 0);
  }
}

export const __analyticsTest = Object.freeze({ computeAnalytics, summarizeHistory, pct });
