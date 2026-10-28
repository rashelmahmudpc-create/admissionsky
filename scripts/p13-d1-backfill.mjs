/* P13, D1 backfill: turn the live /api/content document into SQL that fills the
 * indexed `questions` table the read path queries.
 *
 *   node scripts/p13-d1-backfill.mjs --in content.json --out backfill.sql
 *   node scripts/p13-d1-backfill.mjs --url https://<worker>/api/content --out backfill.sql
 *
 * Emits: CREATE TABLE/INDEXES (from p13-d1-read.mjs SCHEMA), a DELETE for a
 * clean re-run, then batched INSERT ... ON CONFLICT so re-running is idempotent.
 * Pure string building, so it is unit-testable without a database.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { SCHEMA } from '../p13-d1-read.mjs';

const DIFFICULTY = { easy: 1, medium: 2, hard: 3, mixed: 0 };
const BATCH = 25;
/* D1/SQLite rejects a statement past its size ceiling with SQLITE_TOOBIG. A
   count cap alone is not enough: a mirrored list can hold thousands of rows, so
   one INSERT built from them overflows even at a modest row count. Cap every
   statement by bytes as well as rows. */
const MAX_STMT_BYTES = 900 * 1024;

const sqlStr = v => (v === null || v === undefined) ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`;
const sqlInt = v => { const n = Number(v); return Number.isFinite(n) ? String(Math.trunc(n)) : '0'; };

/* difficulty arrives as a word ("mixed") from the live doc; the column is an
   integer tier so it can be ranged on. Unknown words fall to 0 (mixed). */
export function difficultyTier(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? Math.trunc(value) : 0;
  return DIFFICULTY[String(value || '').toLowerCase()] ?? 0;
}

/* A stable, indexed sort key. topic first so a topic page is one contiguous
   range, then id, matching idx_q_topic(topic_id, sort_key, id). */
export function sortKeyFor(q) {
  return `${q.topicId || ''}|${q.subjectId || ''}|${q.id || ''}`;
}

export function questionToRow(q, now = Date.now()) {
  const payload = { ...q };
  delete payload.id;
  return {
    id: String(q.id),
    topic_id: String(q.topicId || ''),
    subject_id: String(q.subjectId || ''),
    difficulty: difficultyTier(q.difficulty),
    published: 1,
    sort_key: sortKeyFor(q),
    payload: JSON.stringify(payload),
    updated_at: now,
  };
}

/* Split tuples into INSERT statements that stay under both the row cap and the
   byte cap, so no single statement can trip SQLITE_TOOBIG. Returns each
   statement's tuple lines (without the leading keyword or trailing suffix). */
function batchTuples(lines, batch) {
  const groups = [];
  let cur = [];
  let curBytes = 0;
  for (const line of lines) {
    const size = line.length + 2;
    if (cur.length && (cur.length >= batch || curBytes + size > MAX_STMT_BYTES)) {
      groups.push(cur);
      cur = [];
      curBytes = 0;
    }
    cur.push(line);
    curBytes += size;
  }
  if (cur.length) groups.push(cur);
  return groups;
}

export function buildSql(doc, { now = Date.now(), batch = BATCH, all = false } = {}) {
  const questions = Array.isArray(doc && doc.questions) ? doc.questions : [];
  const rows = questions.filter(q => q && q.id).map(q => questionToRow(q, now));
  const out = [];
  out.push('-- P13 D1 backfill, generated, idempotent.');
  out.push(SCHEMA.trim());
  // No explicit BEGIN/COMMIT: D1 runs on Durable Objects, which reject SQL
  // transaction statements (wrangler: "use state.storage.transaction()").
  // `d1 execute` applies the file atomically anyway.
  out.push('DELETE FROM questions;');
  const qLines = rows.map(r =>
    `  (${sqlStr(r.id)}, ${sqlStr(r.topic_id)}, ${sqlStr(r.subject_id)}, ${sqlInt(r.difficulty)}, 1, ${sqlStr(r.sort_key)}, ${sqlStr(r.payload)}, ${sqlInt(r.updated_at)})`);
  for (const chunk of batchTuples(qLines, batch)) {
    out.push('INSERT INTO questions (id, topic_id, subject_id, difficulty, published, sort_key, payload, updated_at) VALUES');
    out.push(chunk.join(',\n') + '\nON CONFLICT(id) DO UPDATE SET topic_id=excluded.topic_id, subject_id=excluded.subject_id, difficulty=excluded.difficulty, published=excluded.published, sort_key=excluded.sort_key, payload=excluded.payload, updated_at=excluded.updated_at;');
  }
  /* Record the content signature these rows came from. The read path refuses to
     serve a table whose sig does not match the live meta, so a stale D1 copy can
     never shadow newer KV content. */
  out.push(`INSERT INTO content_meta (k, v) VALUES ('sig', ${sqlStr(doc && doc.sig || '')}) ON CONFLICT(k) DO UPDATE SET v=excluded.v;`);
  /* The read-path switch. Stored in the database rather than a Worker variable
     so it does not count against the Free-plan 64-variable cap. */
  out.push(`INSERT INTO content_meta (k, v) VALUES ('mode', 'd1') ON CONFLICT(k) DO UPDATE SET v=excluded.v;`);
  // With --all, mirror the small lists too, so the document can be assembled
  // from D1 alone instead of reading the large KV blob.
  if (all) {
    const KINDS = ['subjects', 'topics', 'vocabulary', 'vocabularyMaster', 'exams'];
    out.push('DELETE FROM content_lists;');
    for (const kind of KINDS) {
      const list = Array.isArray(doc && doc[kind]) ? doc[kind].filter(x => x && x.id) : [];
      if (!list.length) continue;
      const lLines = list.map((x, i) => `  (${sqlStr(kind)}, ${sqlStr(x.id)}, ${sqlInt(i)}, ${sqlStr(JSON.stringify(x))})`);
      for (const chunk of batchTuples(lLines, batch)) {
        out.push(`INSERT INTO content_lists (kind, id, ord, payload) VALUES`);
        out.push(chunk.join(',\n') + '\nON CONFLICT(kind, id) DO UPDATE SET ord=excluded.ord, payload=excluded.payload;');
      }
    }
  }
  out.push(`SELECT COUNT(*) AS rows FROM questions;`);
  return out.join('\n') + '\n';
}

export function buildFromContentJson(jsonText, opts) {
  return buildSql(JSON.parse(jsonText), opts);
}

function arg(name, fallback = '') {
  const i = process.argv.indexOf('--' + name);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

async function main() {
  const out = arg('out', 'backfill.sql');
  const file = arg('in', '');
  const url = arg('url', '');
  let all = arg('all', '') === 'true' || process.argv.includes('--all');
  let text;
  if (file) text = readFileSync(file, 'utf8');
  else if (url) {
    const res = await fetch(url, { headers: { 'X-AH-App': 'admission-hub' } });
    if (!res.ok) throw new Error('fetch ' + url + ' -> HTTP ' + res.status);
    text = await res.text();
    // The content document does not embed its signature; /api/content/meta does.
    // The read path verifies this sig, so it must be captured here.
    const metaUrl = url.replace(/\/content$/, '/content/meta');
    if (metaUrl !== url) {
      const mr = await fetch(metaUrl, { headers: { 'X-AH-App': 'admission-hub' } });
      if (mr.ok) {
        const meta = await mr.json();
        const doc = JSON.parse(text);
        doc.sig = meta && meta.sig || '';
        text = JSON.stringify(doc);
      }
    }
    all = all || arg('all', '') === 'true';
  } else {
    console.error('usage: node scripts/p13-d1-backfill.mjs --in content.json | --url <endpoint> [--sig S] [--all] [--out backfill.sql]');
    process.exit(2);
  }
  const doc = JSON.parse(text);
  if (arg('sig', '')) doc.sig = arg('sig');
  const sql = buildSql(doc, { now: Date.now(), all });
  writeFileSync(out, sql);
  console.log(`p13-d1-backfill: ${(doc.questions || []).length} questions, sig="${doc.sig || ''}", all=${all} -> ${out} (${sql.length} bytes)`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(e => { console.error('backfill error:', e && e.message); process.exit(1); });
}
