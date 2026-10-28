/* Phase 5, AI Analytics Store.
 *
 * Three jobs, all in D1 so they survive a restart and can be audited later:
 *
 *   cache       generated prose and computed insights, reused instead of
 *               re-generated. The spec's cost rule ("generate once, reuse") only
 *               holds if something actually remembers the result.
 *   decisions   one row per AI recommendation: what signal fired, what was
 *               suggested, which model and version, the confidence, and, later,
 *               when the outcome is known, what happened. This is what makes
 *               `evaluateAiPerformance` measurable rather than a matter of taste.
 *   approvals   the human-approval records the policy layer demands. A decision
 *               that needed approval cannot be actioned without a row here.
 *
 * Schema is created lazily and only for tables this module owns. Every read
 * tolerates a missing table (a fresh database is not a fault) but a missing
 * column throws, matching the Phase 4 store's contract, a schema drift must be
 * loud, not silently treated as no data.
 *
 * No PII beyond the caller-supplied student id is written. The decision log
 * deliberately stores a signal *name* and a reason *kind*, not the underlying
 * rows, so an audit can reconstruct the reasoning without copying student data
 * into a second table.
 */

export const AI_STORE_VERSION = 'ai-p5-store-v1';

export const AI_CACHE_TTL_MS = Object.freeze({
  insight: 6 * 3600 * 1000,
  copilot: 15 * 60 * 1000,
  summary: 6 * 3600 * 1000,
  wording: 24 * 3600 * 1000
});

const isMissingSchemaError = (err) => /no such table/i.test(String(err?.message || err?.cause?.message || err || ''));

const asInt = (v, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
};

const nowIso = (ms) => new Date(asInt(ms, Date.now())).toISOString();

export class AiAnalyticsStore {
  #d1;
  #ready;

  constructor(d1) {
    this.#d1 = d1 || null;
  }

  available() {
    return Boolean(this.#d1);
  }

  async init() {
    if (!this.#d1) return false;
    if (!this.#ready) {
      this.#ready = this.#createSchema().catch((err) => {
        this.#ready = null;
        throw err;
      });
    }
    await this.#ready;
    return true;
  }

  async #createSchema() {
    const statements = [
      `CREATE TABLE IF NOT EXISTS ai_cache (
         cache_key TEXT PRIMARY KEY,
         kind TEXT NOT NULL,
         payload_json TEXT NOT NULL,
         model TEXT,
         created_at INTEGER NOT NULL,
         expires_at INTEGER NOT NULL
       )`,
      `CREATE INDEX IF NOT EXISTS idx_ai_cache_kind ON ai_cache(kind, expires_at)`,
      `CREATE TABLE IF NOT EXISTS ai_decisions (
         id TEXT PRIMARY KEY,
         student_id TEXT,
         signal TEXT NOT NULL,
         recommendation TEXT NOT NULL,
         reason TEXT,
         model TEXT,
         model_version TEXT,
         confidence REAL,
         action_taken TEXT,
         outcome_json TEXT,
         latency_ms INTEGER,
         cost_usd REAL,
         created_at INTEGER NOT NULL,
         resolved_at INTEGER
       )`,
      `CREATE INDEX IF NOT EXISTS idx_ai_decisions_student ON ai_decisions(student_id, created_at)`,
      `CREATE INDEX IF NOT EXISTS idx_ai_decisions_created ON ai_decisions(created_at)`,
      `CREATE TABLE IF NOT EXISTS ai_approvals (
         id TEXT PRIMARY KEY,
         kind TEXT NOT NULL,
         payload_json TEXT,
         status TEXT NOT NULL,
         actor TEXT,
         note TEXT,
         created_at INTEGER NOT NULL,
         decided_at INTEGER
       )`,
      `CREATE INDEX IF NOT EXISTS idx_ai_approvals_status ON ai_approvals(status, created_at)`,
      /* Experiment outcomes: which variant was shown and whether it converted, so
       * A/B optimisation has data instead of a guess. */
      `CREATE TABLE IF NOT EXISTS ai_experiments (
         id TEXT PRIMARY KEY,
         experiment TEXT NOT NULL,
         variant TEXT NOT NULL,
         student_id TEXT,
         shown_at INTEGER NOT NULL,
         opened_at INTEGER,
         clicked_at INTEGER,
         converted_at INTEGER
       )`,
      `CREATE INDEX IF NOT EXISTS idx_ai_experiments_exp ON ai_experiments(experiment, variant, shown_at)`
    ];
    for (const sql of statements) await this.#d1.prepare(sql).run();
  }

  /* ── cache ──────────────────────────────────────────────────────────────── */

  async getCache(key, nowMs = Date.now()) {
    if (!this.#d1) return null;
    await this.init();
    try {
      const row = await this.#d1.prepare(
        'SELECT payload_json, model, created_at, expires_at FROM ai_cache WHERE cache_key = ?'
      ).bind(String(key)).first();
      if (!row) return null;
      if (asInt(row.expires_at) <= asInt(nowMs)) {
        /* Expired rows are left for the sweep rather than deleted inline, so a
         * read never turns into a write on the hot path. */
        return null;
      }
      return {
        payload: safeParse(row.payload_json),
        model: row.model || null,
        createdAt: asInt(row.created_at),
        expiresAt: asInt(row.expires_at),
        fresh: true
      };
    } catch (err) {
      if (isMissingSchemaError(err)) return null;
      throw err;
    }
  }

  async putCache(key, kind, payload, options = {}) {
    if (!this.#d1) return { stored: false };
    await this.init();
    const now = asInt(options.now, Date.now());
    const ttl = asInt(options.ttlMs, AI_CACHE_TTL_MS[kind] ?? AI_CACHE_TTL_MS.insight);
    await this.#d1.prepare(
      `INSERT INTO ai_cache (cache_key, kind, payload_json, model, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(cache_key) DO UPDATE SET
         payload_json = excluded.payload_json,
         kind = excluded.kind,
         model = excluded.model,
         created_at = excluded.created_at,
         expires_at = excluded.expires_at`
    ).bind(
      String(key), String(kind), JSON.stringify(payload ?? null),
      options.model ? String(options.model) : null, now, now + ttl
    ).run();
    return { stored: true, expiresAt: now + ttl, ttlMs: ttl };
  }

  async sweepCache(nowMs = Date.now(), limit = 500) {
    if (!this.#d1) return { removed: 0 };
    await this.init();
    const res = await this.#d1.prepare(
      'DELETE FROM ai_cache WHERE cache_key IN (SELECT cache_key FROM ai_cache WHERE expires_at <= ? LIMIT ?)'
    ).bind(asInt(nowMs), asInt(limit, 500)).run();
    return { removed: asInt(res?.meta?.changes) };
  }

  async cacheStats(nowMs = Date.now()) {
    if (!this.#d1) return { total: 0, live: 0, expired: 0 };
    await this.init();
    const row = await this.#d1.prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN expires_at > ? THEN 1 ELSE 0 END) AS live
       FROM ai_cache`
    ).bind(asInt(nowMs)).first();
    const total = asInt(row?.total);
    const live = asInt(row?.live);
    return { total, live, expired: Math.max(0, total - live) };
  }

  /* ── decision log ───────────────────────────────────────────────────────── */

  async logDecision(entry = {}, nowMs = Date.now()) {
    if (!this.#d1) return { stored: false };
    await this.init();
    const now = asInt(nowMs, Date.now());
    const id = String(entry.id || makeId('dec', now, entry.studentId, entry.signal));
    await this.#d1.prepare(
      `INSERT INTO ai_decisions
         (id, student_id, signal, recommendation, reason, model, model_version,
          confidence, action_taken, outcome_json, latency_ms, cost_usd, created_at, resolved_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         action_taken = excluded.action_taken,
         outcome_json = excluded.outcome_json,
         resolved_at = excluded.resolved_at`
    ).bind(
      id,
      entry.studentId ? String(entry.studentId) : null,
      String(entry.signal || 'unknown'),
      String(entry.recommendation || 'none'),
      entry.reason ? String(entry.reason) : null,
      entry.model ? String(entry.model) : null,
      entry.modelVersion ? String(entry.modelVersion) : null,
      Number.isFinite(Number(entry.confidence)) ? Number(entry.confidence) : null,
      entry.actionTaken ? String(entry.actionTaken) : null,
      entry.outcome !== undefined ? JSON.stringify(entry.outcome) : null,
      Number.isFinite(Number(entry.latencyMs)) ? Math.trunc(Number(entry.latencyMs)) : null,
      Number.isFinite(Number(entry.costUsd)) ? Number(entry.costUsd) : null,
      now,
      entry.outcome !== undefined ? now : null
    ).run();
    return { stored: true, id };
  }

  async listDecisions(options = {}) {
    if (!this.#d1) return [];
    await this.init();
    const limit = Math.min(asInt(options.limit, 200), 1000);
    try {
      const since = asInt(options.sinceMs);
      const rows = since > 0
        ? await this.#readAll('SELECT * FROM ai_decisions WHERE created_at >= ? ORDER BY created_at DESC LIMIT ?', since, limit)
        : await this.#readAll('SELECT * FROM ai_decisions ORDER BY created_at DESC LIMIT ?', limit);
      return rows.map(mapDecision);
    } catch (err) {
      if (isMissingSchemaError(err)) return [];
      throw err;
    }
  }

  async getDecision(id) {
    if (!this.#d1) return null;
    await this.init();
    try {
      const row = await this.#d1.prepare('SELECT * FROM ai_decisions WHERE id = ?').bind(String(id)).first();
      return row ? mapDecision(row) : null;
    } catch (err) {
      if (isMissingSchemaError(err)) return null;
      throw err;
    }
  }

  async decisionStats(nowMs = Date.now()) {
    if (!this.#d1) return { total: 0, resolved: 0 };
    const row = await this.#d1.prepare(
      `SELECT COUNT(*) AS total, SUM(CASE WHEN outcome_json IS NOT NULL THEN 1 ELSE 0 END) AS resolved
       FROM ai_decisions`
    ).first();
    return { total: asInt(row?.total), resolved: asInt(row?.resolved) };
  }

  /* ── approvals ──────────────────────────────────────────────────────────── */

  async createApproval(entry = {}, nowMs = Date.now()) {
    if (!this.#d1) return { stored: false };
    await this.init();
    const now = asInt(nowMs, Date.now());
    const id = String(entry.id || makeId('apr', now, entry.kind, entry.actor));
    await this.#d1.prepare(
      `INSERT INTO ai_approvals (id, kind, payload_json, status, actor, note, created_at, decided_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      id, String(entry.kind || 'unknown'),
      entry.payload !== undefined ? JSON.stringify(entry.payload) : null,
      String(entry.status || 'pending'),
      entry.actor ? String(entry.actor) : null,
      entry.note ? String(entry.note) : null,
      now, entry.status && entry.status !== 'pending' ? now : null
    ).run();
    return { stored: true, id };
  }

  async getApproval(id) {
    if (!this.#d1) return null;
    await this.init();
    try {
      const row = await this.#d1.prepare('SELECT * FROM ai_approvals WHERE id = ?').bind(String(id)).first();
      return row ? mapApproval(row) : null;
    } catch (err) {
      if (isMissingSchemaError(err)) return null;
      throw err;
    }
  }

  async decideApproval(id, status, actor, options = {}, nowMs = Date.now()) {
    if (!this.#d1) return { stored: false };
    await this.init();
    if (!['approved', 'rejected', 'modified'].includes(status)) return { stored: false, reason: 'bad-status' };
    /* A decision without a person attached is not an approval; refuse it here so
     * `approvalSatisfied` can trust every non-pending row it reads. */
    if (!actor) return { stored: false, reason: 'actor-required' };
    const now = asInt(nowMs, Date.now());
    const res = await this.#d1.prepare(
      `UPDATE ai_approvals
       SET status = ?, actor = ?, note = COALESCE(?, note), payload_json = COALESCE(?, payload_json), decided_at = ?
       WHERE id = ?`
    ).bind(
      status, String(actor),
      options.note ? String(options.note) : null,
      options.payload !== undefined ? JSON.stringify(options.payload) : null,
      now, String(id)
    ).run();
    return { stored: asInt(res?.meta?.changes) > 0, id };
  }

  async listApprovals(options = {}) {
    if (!this.#d1) return [];
    await this.init();
    const limit = Math.min(asInt(options.limit, 100), 500);
    try {
      const rows = options.status
        ? await this.#readAll('SELECT * FROM ai_approvals WHERE status = ? ORDER BY created_at DESC LIMIT ?', String(options.status), limit)
        : await this.#readAll('SELECT * FROM ai_approvals ORDER BY created_at DESC LIMIT ?', limit);
      return rows.map(mapApproval);
    } catch (err) {
      if (isMissingSchemaError(err)) return [];
      throw err;
    }
  }

  /* ── experiments ────────────────────────────────────────────────────────── */

  async recordExperiment(entry = {}, nowMs = Date.now()) {
    if (!this.#d1) return { stored: false };
    await this.init();
    const now = asInt(nowMs, Date.now());
    const id = String(entry.id || makeId('exp', now, entry.experiment, entry.variant, entry.studentId));
    await this.#d1.prepare(
      `INSERT INTO ai_experiments (id, experiment, variant, student_id, shown_at, opened_at, clicked_at, converted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         opened_at = COALESCE(excluded.opened_at, opened_at),
         clicked_at = COALESCE(excluded.clicked_at, clicked_at),
         converted_at = COALESCE(excluded.converted_at, converted_at)`
    ).bind(
      id, String(entry.experiment || 'unknown'), String(entry.variant || 'A'),
      entry.studentId ? String(entry.studentId) : null, now,
      entry.opened ? now : null, entry.clicked ? now : null, entry.converted ? now : null
    ).run();
    return { stored: true, id };
  }

  async experimentResults(experiment) {
    if (!this.#d1) return [];
    await this.init();
    try {
      const rows = await this.#readAll(
        `SELECT variant,
                COUNT(*) AS shown,
                SUM(CASE WHEN opened_at IS NOT NULL THEN 1 ELSE 0 END) AS opened,
                SUM(CASE WHEN clicked_at IS NOT NULL THEN 1 ELSE 0 END) AS clicked,
                SUM(CASE WHEN converted_at IS NOT NULL THEN 1 ELSE 0 END) AS converted
         FROM ai_experiments WHERE experiment = ? GROUP BY variant`, String(experiment)
      );
      return rows.map((r) => ({
        variant: r.variant,
        shown: asInt(r.shown),
        opened: asInt(r.opened),
        clicked: asInt(r.clicked),
        converted: asInt(r.converted),
        openRate: asInt(r.shown) ? Number((asInt(r.opened) / asInt(r.shown)).toFixed(4)) : 0,
        clickRate: asInt(r.shown) ? Number((asInt(r.clicked) / asInt(r.shown)).toFixed(4)) : 0,
        conversionRate: asInt(r.shown) ? Number((asInt(r.converted) / asInt(r.shown)).toFixed(4)) : 0
      }));
    } catch (err) {
      if (isMissingSchemaError(err)) return [];
      throw err;
    }
  }

  /* ── student activity hours ─────────────────────────────────────────────── */

  /* Only the timestamp column is read. The AI best-time layer needs *when* a
   * student studied, not *what* they did, so it never pulls event names or
   * params into the intelligence path. Reads `analytics_events`, which Phase 4
   * owns; a database that has not been through a Phase 4 ingest yet returns
   * empty rather than throwing. */
  async analyticsEventsFor(userId, sinceMs, limit = 2000) {
    if (!this.#d1) return [];
    try {
      const rows = await this.#d1.prepare(
        'SELECT at FROM analytics_events WHERE user_id = ? AND at >= ? ORDER BY at ASC LIMIT ?'
      ).bind(String(userId), asInt(sinceMs), Math.min(asInt(limit, 2000), 5000)).all();
      return (rows?.results || []).map((r) => ({ at: asInt(r.at) }));
    } catch (err) {
      if (isMissingSchemaError(err)) return [];
      throw err;
    }
  }

  /* ── monitoring ─────────────────────────────────────────────────────────── */

  /* One call the health route uses. Fail-soft per section so a single missing
   * table cannot make the whole health check look down. */
  async health(nowMs = Date.now()) {
    if (!this.#d1) return { available: false };
    try {
      await this.init();
    } catch (err) {
      return { available: false, schemaError: String(err?.message || err) };
    }
    const [cache, decisions, approvals] = await Promise.all([
      this.cacheStats(nowMs).catch(() => ({ total: 0, live: 0, expired: 0 })),
      this.decisionStats(nowMs).catch(() => ({ total: 0, resolved: 0 })),
      this.listApprovals({ status: 'pending', limit: 1 }).catch(() => [])
    ]);
    return {
      available: true,
      version: AI_STORE_VERSION,
      cache,
      decisions,
      pendingApprovals: Array.isArray(approvals) ? approvals.length : 0
    };
  }

  /* ── internals ──────────────────────────────────────────────────────────── */

  async #readAll(sql, ...bindings) {
    try {
      const res = await this.#d1.prepare(sql).bind(...bindings).all();
      return res?.results || [];
    } catch (err) {
      if (isMissingSchemaError(err)) return [];
      throw err;
    }
  }
}

function mapDecision(row) {
  return {
    id: row.id,
    studentId: row.student_id || null,
    signal: row.signal,
    recommendation: row.recommendation,
    reason: row.reason || null,
    model: row.model || null,
    modelVersion: row.model_version || null,
    confidence: row.confidence === null || row.confidence === undefined ? null : Number(row.confidence),
    actionTaken: row.action_taken || null,
    outcome: row.outcome_json ? safeParse(row.outcome_json) : null,
    latencyMs: row.latency_ms === null || row.latency_ms === undefined ? null : Number(row.latency_ms),
    costUsd: row.cost_usd === null || row.cost_usd === undefined ? null : Number(row.cost_usd),
    createdAt: asInt(row.created_at),
    resolvedAt: row.resolved_at === null || row.resolved_at === undefined ? null : asInt(row.resolved_at)
  };
}

function mapApproval(row) {
  return {
    id: row.id,
    kind: row.kind,
    payload: row.payload_json ? safeParse(row.payload_json) : null,
    status: row.status,
    actor: row.actor || null,
    note: row.note || null,
    createdAt: asInt(row.created_at),
    decidedAt: row.decided_at === null || row.decided_at === undefined ? null : asInt(row.decided_at)
  };
}

/* Deterministic id: the same logical decision logged twice maps to one row, so a
 * retry cannot inflate the outcome counts that `evaluateAiPerformance` reads. */
function makeId(prefix, ts, ...parts) {
  const seed = `${prefix}|${ts}|${parts.filter(Boolean).join('|')}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${prefix}_${ts.toString(36)}_${h.toString(36)}`;
}

function safeParse(text) {
  try { return JSON.parse(text); } catch (_) { return null; }
}

export const __aiStoreTest = Object.freeze({ makeId, mapDecision, mapApproval, isMissingSchemaError, nowIso });
