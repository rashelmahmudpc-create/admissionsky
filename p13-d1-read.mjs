/* Admission Hub, P13 D1 public read path.
 *
 * The public question/content read path, moved off KV blobs onto D1 with real
 * indexes and keyset pagination, so a table of a million questions answers as
 * fast as one of a thousand. Pure query building + row normalization here, so
 * it is testable without a live database; `createD1Reader(db)` runs the SQL.
 *
 * Keyed (cursor) pagination is deliberate: OFFSET degrades linearly on large
 * tables, a WHERE on an indexed (sort_key, id) pair does not.
 */
/* Schema the reader expects. Every list query is served by one of these
   indexes; adding a column without an index is what makes a table slow. */
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS questions (
  id          TEXT PRIMARY KEY,
  topic_id    TEXT NOT NULL,
  subject_id  TEXT NOT NULL,
  difficulty  INTEGER NOT NULL DEFAULT 1,
  published   INTEGER NOT NULL DEFAULT 1,
  sort_key    TEXT NOT NULL,
  payload     TEXT NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_q_topic   ON questions(topic_id, sort_key, id);
CREATE INDEX IF NOT EXISTS idx_q_subject ON questions(subject_id, sort_key, id);
CREATE INDEX IF NOT EXISTS idx_q_sort    ON questions(sort_key, id);
CREATE INDEX IF NOT EXISTS idx_q_pub     ON questions(published, sort_key, id);
/* One row recording which content version the rows above were built from, so a
   read path can prove the table is in sync before trusting it. */
CREATE TABLE IF NOT EXISTS content_meta (
  k TEXT PRIMARY KEY,
  v TEXT NOT NULL
);
/* Small lists (subjects, topics, vocabulary, …) mirrored per kind, so the whole
   document can be assembled from D1 without reading the large KV blob. */
CREATE TABLE IF NOT EXISTS content_lists (
  kind    TEXT NOT NULL,
  id      TEXT NOT NULL,
  ord     INTEGER NOT NULL DEFAULT 0,
  payload TEXT NOT NULL,
  PRIMARY KEY (kind, id)
);
CREATE INDEX IF NOT EXISTS idx_list_kind ON content_lists(kind, ord);
`;

export const MAX_LIMIT = 100;
export const DEFAULT_LIMIT = 20;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const num = (v, d = 0) => { const n = Number(v); return isFinite(n) ? n : d; };

  /* Decode an opaque cursor. Kept as JSON+base64 so the client never builds SQL. */
export function encodeCursor(row) {
    if (!row) return null;
    const raw = JSON.stringify({ s: String(row.sort_key), i: String(row.id) });
    if (typeof btoa === 'function') return btoa(raw);
    return Buffer.from(raw, 'utf8').toString('base64');
  }
export function decodeCursor(cursor) {
    if (!cursor) return null;
    try {
      const raw = typeof atob === 'function' ? atob(String(cursor)) : Buffer.from(String(cursor), 'base64').toString('utf8');
      const p = JSON.parse(raw);
      if (!p || typeof p.s !== 'string' || typeof p.i !== 'string') return null;
      return { sortKey: p.s, id: p.i };
    } catch (_) { return null; }
  }

  /* Build the page query. `after` continues from the previous page's last row. */
export function buildQuery(params = {}) {
    const where = [];
    const bind = [];
    if (params.topicId) { where.push('topic_id = ?'); bind.push(String(params.topicId)); }
    if (params.subjectId) { where.push('subject_id = ?'); bind.push(String(params.subjectId)); }
    if (params.publishedOnly !== false) where.push('published = 1');
    const after = decodeCursor(params.cursor);
    if (after) { where.push('(sort_key, id) > (?, ?)'); bind.push(after.sortKey, after.id); }
    const limit = clamp(num(params.limit, DEFAULT_LIMIT), 1, MAX_LIMIT);
    const sql = 'SELECT id, topic_id, subject_id, difficulty, sort_key, payload, updated_at FROM questions'
      + (where.length ? ' WHERE ' + where.join(' AND ') : '')
      + ' ORDER BY sort_key ASC, id ASC LIMIT ?';
    bind.push(limit);
    return { sql, bind, limit };
  }

export function normalizeRow(row) {
    if (!row) return null;
    let payload = {};
    try { payload = typeof row.payload === 'string' ? JSON.parse(row.payload) : (row.payload || {}); } catch (_) {}
    return {
      id: String(row.id),
      topicId: row.topic_id, subjectId: row.subject_id,
      difficulty: num(row.difficulty, 1),
      sortKey: String(row.sort_key),
      updatedAt: num(row.updated_at),
      ...payload,
    };
  }

  /* Turn a raw result set into a page: rows + the cursor for the next page.
     A short page means the end; the cursor is null then. */
export function toPage(rows, limit) {
    const list = (rows || []).map(normalizeRow).filter(Boolean);
    const hasMore = list.length >= num(limit, DEFAULT_LIMIT);
    return { items: list, nextCursor: hasMore ? encodeCursor({ sort_key: list[list.length - 1].sortKey, id: list[list.length - 1].id }) : null, count: list.length };
  }

  /* Reader bound to a live D1 database. Returns null-safe results when the
     binding is absent, so a deployment without D1 keeps working (KV fallback). */
export function createD1Reader(db) {
    const available = !!db && typeof db.prepare === 'function';
    return {
      available,
      async page(params = {}) {
        if (!available) return null;
        const q = buildQuery(params);
        const stmt = db.prepare(q.sql);
        const bound = q.bind.length ? stmt.bind(...q.bind) : stmt;
        const res = await bound.all();
        return toPage(res && res.results ? res.results : [], q.limit);
      },
      /* Every row for a filter, ordered by the index. Used for the current
         full-document pull; a paging client uses page() instead. */
      async all(params = {}) {
        if (!available) return null;
        const where = [];
        const bind = [];
        if (params.topicId) { where.push('topic_id = ?'); bind.push(String(params.topicId)); }
        if (params.subjectId) { where.push('subject_id = ?'); bind.push(String(params.subjectId)); }
        if (params.publishedOnly !== false) where.push('published = 1');
        const sql = 'SELECT id, topic_id, subject_id, difficulty, sort_key, payload, updated_at FROM questions'
          + (where.length ? ' WHERE ' + where.join(' AND ') : '') + ' ORDER BY sort_key ASC, id ASC';
        const stmt = db.prepare(sql);
        const res = await (bind.length ? stmt.bind(...bind) : stmt).all();
        return (res && res.results ? res.results : []).map(normalizeRow).filter(Boolean);
      },
      /* Read a small keyed value from content_meta (e.g. the content sig, or the
         'mode' toggle). Null-safe. */
      async meta(key) {
        if (!available) return null;
        try {
          const stmt = db.prepare('SELECT v FROM content_meta WHERE k = ?').bind(String(key));
          const res = await stmt.first();
          return res ? String(res.v) : null;
        } catch (_) { return null; }
      },
      /* Signature of the content version these rows were built from. The read
         path compares it to the live meta and refuses a stale table. */
      async sig() {
        return this.meta('sig');
      },
      /* The mirrored small lists (subjects, topics, vocabulary, …) as one
         object. These are tiny next to `questions`, so a paged read returns
         them whole. Null-safe. */
      async lists() {
        if (!available) return null;
        try {
          const lres = await db.prepare('SELECT kind, payload FROM content_lists ORDER BY kind ASC, ord ASC').all();
          const out = {};
          for (const r of (lres && lres.results ? lres.results : [])) {
            let item = {};
            try { item = JSON.parse(r.payload); } catch (_) { continue; }
            (out[r.kind] = out[r.kind] || []).push(item);
          }
          return out;
        } catch (_) { return null; }
      },
      /* Assemble the same document shape the KV blob holds, entirely from D1:
         questions plus the mirrored small lists. Returns null when the tables
         are not there, so a caller can fall back to KV. */
      async document() {
        if (!available) return null;
        try {
          const qres = await db.prepare('SELECT id, topic_id, subject_id, difficulty, sort_key, payload, updated_at FROM questions WHERE published = 1 ORDER BY sort_key ASC, id ASC').all();
          const questions = (qres && qres.results ? qres.results : []).map(normalizeRow).filter(Boolean);
          /* Questions gate the read path: no questions means D1 cannot serve a
             document at all, so the caller falls back to KV. An EMPTY bank is a
             different case, the lists are authoritative and may legitimately
             be empty (an owner-ordered vocabulary erase), and returning null
             there would serve the stale KV copy forever. */
          if (!questions.length) return null;
          const lists = (await this.lists()) || {};
          return { questions, ...lists };
        } catch (_) { return null; }
      },
      /* A cheap bounded probe used by health checks. */
      async count(params = {}) {
        if (!available) return null;
        const where = [];
        const bind = [];
        if (params.topicId) { where.push('topic_id = ?'); bind.push(String(params.topicId)); }
        if (params.subjectId) { where.push('subject_id = ?'); bind.push(String(params.subjectId)); }
        if (params.publishedOnly !== false) where.push('published = 1');
        const sql = 'SELECT COUNT(*) AS n FROM questions' + (where.length ? ' WHERE ' + where.join(' AND ') : '');
        const stmt = db.prepare(sql);
        const res = await (bind.length ? stmt.bind(...bind) : stmt).first();
        return res ? num(res.n) : 0;
      },
    };
  }

