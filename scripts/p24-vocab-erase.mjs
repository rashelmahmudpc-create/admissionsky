/* P24, Vocabulary erase. Owner-ordered (2026-10-11): remove every vocabulary
 * row from the published product so the bank can be rebuilt one category at a
 * time.
 *
 *   node scripts/p24-vocab-erase.mjs --in saved-content.json --out blanked.json
 *   node scripts/p24-vocab-erase.mjs --url https://<host>/api/content --out blanked.json
 *
 * It deliberately touches ONE thing: `vocabularyMaster` and the legacy
 * `vocabulary` list. Questions, subjects, topics and exams are copied through
 * untouched, because they are the exam product and an erase that reaches them
 * would take the app down with it. The signature is recomputed with the Worker's
 * own fingerprint function so the blanked document is self-consistent.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fingerprintGlobal } from '../public-worker.js';

const arg = name => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : null;
};

export function blankVocab(doc) {
  if (!doc || typeof doc !== 'object') throw new Error('no document');
  const out = { ...doc, vocabulary: [], vocabularyMaster: [] };
  const shaped = {
    subjects: out.subjects || [], topics: out.topics || [],
    questions: out.questions || [], vocabulary: [],
    vocabularyMaster: [],
  };
  out.sig = fingerprintGlobal(shaped);
  /* The blanked bank is smaller than the original, but a stale `counts` would
     disagree with the fingerprint and make /api/admin/verify report drift. */
  out.counts = {
    subjects: shaped.subjects.length, topics: shaped.topics.length,
    questions: shaped.questions.length, vocabulary: 0, vocabularyMaster: 0,
  };
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const inPath = arg('in');
  const url = arg('url');
  const out = arg('out');
  if (!out || (!inPath && !url)) {
    console.error('usage: node scripts/p24-vocab-erase.mjs (--in file | --url host/api/content) --out file [--meta meta.json] [--sql erase.sql]');
    process.exit(2);
  }
  const raw = inPath
    ? readFileSync(inPath, 'utf8')
    : await (await fetch(url)).text();
  const doc = JSON.parse(raw);
  const before = {
    vocabularyMaster: (doc.vocabularyMaster || []).length,
    vocabulary: (doc.vocabulary || []).length,
    questions: (doc.questions || []).length,
    subjects: (doc.subjects || []).length,
    topics: (doc.topics || []).length,
  };
  const blanked = blankVocab(doc);
  writeFileSync(out, JSON.stringify(blanked));

  /* `--meta` emits the small KV meta that signs the blanked document. Written
     as its own artifact because the workflow puts it with `wrangler kv key put`
     directly, which bypasses publishGlobal and therefore its sig computation. */
  const metaPath = arg('meta');
  if (metaPath) {
    const meta = {
      v: (Number(doc.v) || 0) + 1,
      at: Date.now(),
      sig: blanked.sig,
      counts: blanked.counts,
      categories: {},
    };
    writeFileSync(metaPath, JSON.stringify(meta));
  }
  /* `--sql` emits the D1 cleanup. `content_lists` is the D1 mirror the read
     path serves, so the erased kind must be removed there too; the sig stamp in
     `content_meta` is updated so the D1 path keeps serving instead of falling
     back to KV. `questions` is never touched. */
  const sqlPath = arg('sql');
  if (sqlPath) {
    const stmts = [
      'DELETE FROM content_lists WHERE kind IN (\'vocabularyMaster\', \'vocabulary\');',
      `INSERT INTO content_meta (k, v) VALUES ('sig', '${blanked.sig}') ON CONFLICT(k) DO UPDATE SET v = excluded.v;`,
    ];
    writeFileSync(sqlPath, stmts.join('\n') + '\n');
  }
  console.log(JSON.stringify({ before, after: { vocabularyMaster: 0, vocabulary: 0, questions: before.questions }, sig: blanked.sig }, null, 1));
}
