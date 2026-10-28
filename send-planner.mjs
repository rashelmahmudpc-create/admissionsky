/* Phase 5 (FCM blueprint), scale hardening.
 *
 * Two jobs the blueprint defers to "at size":
 *
 * 1. Quota-aware fanout. FCM enforces a per-project send rate; a blast larger
 *    than the window budget must be spread over several cron ticks instead of
 *    being fired all at once and losing most of itself to 429/503. This module
 *    turns "N devices, R per window" into a concrete plan, and gives the caller
 *    a resumable cursor so a run that stops halfway continues where it left off
 *    rather than re-sending to everyone below the cursor.
 *
 * 2. Send timing. Sending at the wrong hour is the quiet reason a correct push
 *    goes unseen. Given a student's own engagement by hour-of-day, this picks
 *    the hour they actually open things, then falls back to a sane default when
 *    there is not enough history to be sure.
 *
 * Everything here is pure on purpose: the planner is the part that must be
 * provably correct under retries and partial failure, so it is tested directly
 * rather than through a network.
 */

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const asInt = (v, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
};
const pad2 = n => String(n).padStart(2, '0');

/* Conservative default: FCM HTTP v1 allows a large but finite per-minute rate.
 * We deliberately under-claim it so several workers never add up past the cap. */
export const DEFAULT_WINDOW_BUDGET = 400;
export const DEFAULT_CONCURRENCY = 10;

/* ── plan (pure) ─────────────────────────────────────────────────────────── */

/* How a fanout of `total` distinct devices divides into this run's work.
 * `take` is what this tick may attempt; `remaining` is what later ticks owe. */
export function planFanout(total, { budget = DEFAULT_WINDOW_BUDGET, cursor = 0 } = {}) {
  const size = Math.max(0, asInt(total));
  /* A missing, zero or negative budget means "no number was given", not "send
   * one device per tick", fall back to the default rather than stall. */
  const budgetRaw = asInt(budget, DEFAULT_WINDOW_BUDGET);
  const limit = budgetRaw > 0 ? budgetRaw : DEFAULT_WINDOW_BUDGET;
  const start = clamp(asInt(cursor), 0, size);
  const take = Math.min(limit, size - start);
  return {
    start,
    take,
    end: start + take,
    remaining: Math.max(0, size - (start + take)),
    batches: Math.ceil(take / Math.max(1, DEFAULT_CONCURRENCY)),
    complete: start + take >= size
  };
}

/* Exponential backoff for a rate-limited send. FCM answers 429/503 when the
 * project is over budget; retrying immediately makes the burst worse, retrying
 * too late stalls the run. `attempt` is 1-based. */
export function backoffMs(attempt, { base = 250, cap = 30_000, jitter = 0 } = {}) {
  const n = Math.max(1, asInt(attempt, 1));
  const raw = Math.min(Math.max(1, asInt(cap, 30_000)), Math.max(1, asInt(base, 250)) * 2 ** (n - 1));
  const j = jitter > 0 ? Math.floor(Math.random() * Math.max(1, asInt(jitter))) : 0;
  return raw + j;
}

/* FCM errors that mean "try again later", as opposed to "this token is dead". */
export function isRetryable(reason) {
  const r = String(reason || '').toLowerCase();
  return r === 'rate-limited' || r === 'unavailable' || r === 'error' || r === 'timeout';
}

/* One retry decision, kept pure so the policy is visible and testable. */
export function retryDecision({ reason, attempt, maxAttempts = 4 }) {
  if (!isRetryable(reason)) return { retry: false, waitMs: 0 };
  if (asInt(attempt, 1) >= Math.max(1, asInt(maxAttempts, 4))) return { retry: false, waitMs: 0 };
  return { retry: true, waitMs: backoffMs(asInt(attempt, 1)) };
}

/* Map an FCM response to our retry vocabulary. Kept next to the planner so the
 * caller does not have to re-derive which HTTP codes mean "later". */
export function classifyFcmError(status, code) {
  /* Either argument may carry the code: some call sites pass the HTTP status
   * alone, others the parsed error code. Fold them so both work. */
  const s = asInt(status, 0);
  const c = code == null ? s : asInt(code, 0);
  const n = c || s;
  if (n === 429) return 'rate-limited';
  if (n === 503 || n === 500 || n === 502 || n === 504) return 'unavailable';
  if (n === 404 || n === 400) return 'unusable-token';
  return 'error';
}

/* ── send timing (pure) ──────────────────────────────────────────────────── */

export const TIMING_DEFAULTS = Object.freeze({
  min_samples: 12,
  default_hour: 20,          // evening, when study tends to happen
  floor: 0.15
});

/* Build an hour-of-day histogram from engagement events.
 * `events` are `{ hour, opened? }`, an open counts double a plain send, since
 * it is the behaviour we want to move, not the message we sent. */
export function hourHistogram(events = []) {
  const hist = Array.from({ length: 24 }, () => ({ sent: 0, opened: 0 }));
  for (const e of events) {
    const h = asInt(e?.hour, -1);
    if (h < 0 || h > 23) continue;
    hist[h].sent += 1;
    if (e?.opened) hist[h].opened += 1;
  }
  return hist;
}

/* A 0..1 score per hour, weighted by opens, with a small floor so an hour we
 * have never seen is not treated as impossible, only as unproven. */
export function scoreHours(events = []) {
  const hist = hourHistogram(events);
  const weights = hist.map(h => h.sent + 2 * h.opened);
  const total = weights.reduce((a, b) => a + b, 0);
  const floor = TIMING_DEFAULTS.floor;
  if (total <= 0) return hist.map(() => floor);
  const peak = Math.max(...weights);
  return weights.map(w => Math.round((floor + (1 - floor) * (peak > 0 ? w / peak : 0)) * 1000) / 1000);
}

/* The hour to send to this student, plus how confident we are.
 * Below `min_samples` we are not confident, so we return the default hour and
 * say so, rather than guessing from three data points. */
export function bestSendHour(events = [], opts = {}) {
  const minSamples = Math.max(1, asInt(opts.min_samples, TIMING_DEFAULTS.min_samples));
  const defaultHour = clamp(asInt(opts.default_hour, TIMING_DEFAULTS.default_hour), 0, 23);
  const usable = events.filter(e => asInt(e?.hour, -1) >= 0 && asInt(e?.hour, -1) <= 23);
  if (usable.length < minSamples) {
    return { hour: defaultHour, score: TIMING_DEFAULTS.floor, confident: false, samples: usable.length };
  }
  const scores = scoreHours(usable);
  let best = defaultHour;
  for (let h = 0; h < 24; h += 1) if (scores[h] > scores[best]) best = h;
  return { hour: best, score: scores[best], confident: true, samples: usable.length };
}

/* ── resumable fanout state ──────────────────────────────────────────────── */

export class FanoutStore {
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
        await this.#d1.prepare(`CREATE TABLE IF NOT EXISTS notification_fanout (
          id TEXT PRIMARY KEY,
          cursor INTEGER NOT NULL DEFAULT 0,
          total INTEGER NOT NULL DEFAULT 0,
          status TEXT NOT NULL DEFAULT 'pending',
          updated_at INTEGER NOT NULL
        )`).run();
      })().catch(err => { this.#ready = null; throw err; });
    }
    await this.#ready;
  }

  async getState(id) {
    await this.init();
    const row = await this.#d1.prepare('SELECT * FROM notification_fanout WHERE id=?').bind(id).first();
    return row ? { id: row.id, cursor: asInt(row.cursor), total: asInt(row.total), status: String(row.status) } : null;
  }

  async saveState(id, { cursor, total, status }, now = Date.now()) {
    await this.init();
    await this.#d1.prepare(
      `INSERT INTO notification_fanout(id, cursor, total, status, updated_at) VALUES (?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET cursor=excluded.cursor, total=excluded.total,
         status=excluded.status, updated_at=excluded.updated_at`
    ).bind(id, asInt(cursor), asInt(total), String(status), now).run();
  }
}

/* The cron-facing planner for one large send: decide this tick's slice from
 * stored progress, persist the new cursor, and report whether more ticks are
 * owed. The caller does the actual sending; this only keeps the ledger. */
export async function advanceFanout(store, id, total, opts = {}) {
  const plan = planFanout(total, opts);
  const prev = store.available() ? await store.getState(id) : null;
  const cursor = prev && prev.total === total ? Math.max(prev.cursor, plan.start) : plan.start;
  const effective = planFanout(total, { ...opts, cursor });
  if (store.available()) {
    await store.saveState(id, {
      cursor: effective.end,
      total,
      status: effective.complete ? 'complete' : 'in-progress'
    }, opts.now ? opts.now() : Date.now());
  }
  return effective;
}

export const __plannerTest = Object.freeze({
  planFanout, backoffMs, isRetryable, retryDecision, classifyFcmError,
  hourHistogram, scoreHours, bestSendHour
});
