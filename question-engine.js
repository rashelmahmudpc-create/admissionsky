/* Admission Hub, P07 Intelligent Question Engine.
 *
 * The question bank's own quality layer. It gives every question a difficulty,
 * a type, a concept tag and an expected solving time; checks that the answer
 * key is internally consistent and that the explanation actually teaches; and
 * finds exact + near-duplicate questions. The analysis panel is built from the
 * same single-pass analyser, so it stays fast as the bank grows to lakhs.
 *
 * Shipped as a classic script (window/self UMD) and loaded verbatim by
 * node:test, so the tested code is the shipped code, never a re-implementation.
 * No storage writes happen here: callers persist via applyTags().
 *
 * Exposed as window.AhQuestionEngine / self.AhQuestionEngine and module.exports.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api; // node:test
  if (root) root.AhQuestionEngine = api; // browser (self/window)
})(typeof self !== 'undefined' ? self : this, function () {
  const ENGINE_VERSION = 'qe1';
  const DIFFICULTIES = ['easy', 'medium', 'hard'];
  const TYPES = ['factual', 'conceptual', 'numerical', 'application'];
  const DIFFICULTY_WEIGHT = { easy: 30, medium: 55, hard: 82 };

  /* ── text normalisation + similarity ─────────────────────────────────────── */

  /* Canonical key for duplicate matching. Unicode-aware so Bengali survives,
     punctuation and spacing collapse. */
  function normalizeText(value) {
    return String(value == null ? '' : value)
      .toLocaleLowerCase()
      .replace(/[\u0964\u0965।॥]/g, ' ')   // Bengali full stop / danda
      .replace(/[^\p{L}\p{N}\p{M}\s]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function tokens(value) {
    const n = normalizeText(value);
    return n ? n.split(' ') : [];
  }

  /* Question words ("কী", "কোনটি", "কত", "which" …) carry no subject matter, so
     they are stripped before word-overlap comparison. Without this, "X কী?" and
     "X কোনটি?" look 60% similar instead of identical, a real duplicate that is
     also the most common duplicate this bank produces. */
  const QWORDS = new Set(['কী', 'কি', 'কে', 'কত', 'কোন', 'কোনটি', 'নিচের', 'কেন', 'কোথায়', 'কখন',
    'what', 'who', 'which', 'when', 'where', 'how', 'the', 'a', 'an', 'of', 'is', 'are', 'in', 'on', 'and', 'was', 'were']);
  function contentTokens(value) {
    const t = tokens(value);
    const kept = t.filter(w => !QWORDS.has(w));
    return kept.length ? kept : t;
  }

  /* Jaccard over word sets, order-insensitive, cheap, good for "same question,
     reworded" cases (the common duplicate in this bank). */
  function jaccard(a, b) {
    const A = new Set(a), B = new Set(b);
    if (!A.size || !B.size) return 0;
    let inter = 0;
    for (const t of A) if (B.has(t)) inter++;
    const union = A.size + B.size - inter;
    return union ? inter / union : 0;
  }

  /* Character bigram Dice, catches near-identical strings that differ by a
     couple of characters, which word-Jaccard can miss on short questions. */
  function bigrams(s) {
    const t = normalizeText(s).replace(/ /g, '');
    const out = [];
    for (let i = 0; i < t.length - 1; i++) out.push(t.slice(i, i + 2));
    return out;
  }
  function dice(a, b) {
    const A = bigrams(a), B = bigrams(b);
    if (!A.length || !B.length) return normalizeText(a) === normalizeText(b) ? 1 : 0;
    const seen = new Map();
    for (const g of A) seen.set(g, (seen.get(g) || 0) + 1);
    let inter = 0;
    for (const g of B) { const c = seen.get(g); if (c) { inter++; seen.set(g, c - 1); } }
    return (2 * inter) / (A.length + B.length);
  }

  /* Combined similarity: exact-normalised short-circuits to 1; otherwise the
     word overlap and the character overlap are blended. */
  function similarity(a, b) {
    const na = normalizeText(a), nb = normalizeText(b);
    if (!na || !nb) return 0;
    if (na === nb) return 1;
    const j = jaccard(contentTokens(na), contentTokens(nb));
    const d = dice(na, nb);
    return Math.round(((j * 0.6) + (d * 0.4)) * 1000) / 1000;
  }

  /* ── per-question analysis ───────────────────────────────────────────────── */

  function answerIndex(q) {
    const raw = q && (q.answerIndex != null ? q.answerIndex : q.answer);
    const n = Number(raw);
    return Number.isInteger(n) ? n : -1;
  }

  function optionCount(q) {
    return Array.isArray(q && q.options) ? q.options.length : 0;
  }

  /* Difficulty: a blend of intrinsic cues (question/option length, numeric
     content) and, when the bank knows it, observed accuracy from stats. The
     observed signal wins when there is enough of it, because real student
     performance beats any heuristic. */
  function difficultyScore(q) {
    const qText = tokens(q && q.question);
    const opts = Array.isArray(q && q.options) ? q.options : [];
    const optTokens = opts.reduce((n, o) => n + tokens(o).length, 0);
    const avgOpt = opts.length ? optTokens / opts.length : 0;
    let score = 38;
    score += Math.min(24, qText.length * 1.5);        // longer stem → harder
    score += Math.min(14, avgOpt * 0.7);              // longer options → harder
    if (/[\p{N}]/u.test(String(q && q.question || ''))) score += 12;  // numerical
    if (/সবগুলো|কোনটি নয়|নিচের কোনটি|which of the following|all of the/i.test(String(q && q.question || ''))) score += 8;
    const st = q && q.stats;
    if (st && (st.attempts >= 5)) {
      const acc = st.attempts ? st.correct / st.attempts : 0.5;
      score = (score * 0.25) + ((1 - acc) * 100 * 0.75);   // observed accuracy dominates
    }
    return Math.max(0, Math.min(100, Math.round(score)));
  }

  function difficultyOf(q) {
    const declared = String((q && q.difficulty) || '').toLowerCase();
    const score = difficultyScore(q);
    const st = q && q.stats;
    if (st && st.attempts >= 5) {
      return score < 45 ? 'easy' : score < 70 ? 'medium' : 'hard';
    }
    if (DIFFICULTIES.includes(declared)) return declared;
    return score < 40 ? 'easy' : score < 68 ? 'medium' : 'hard';
  }

  function typeOf(q) {
    const text = String((q && q.question) || '');
    const opts = Array.isArray(q && q.options) ? q.options : [];
    const numeric = opts.some(o => /[\p{N}]/u.test(String(o))) || /[\p{N}]/u.test(text);
    if (numeric && /[\p{N}]/u.test(text)) return 'numerical';
    if (/কারণ|কেন|ব্যাখ্যা|why|reason|because|explain/i.test(text)) return 'conceptual';
    if (/উদাহরণ|প্রয়োগ|ক্ষেত্রে|apply|example|in which case/i.test(text)) return 'application';
    if (/কী|কে|কত|কোন|নাম|what|who|when|where|which/i.test(text)) return 'factual';
    return 'conceptual'; // default for statement-style questions
  }

  /* Concept tag: the topic plus the most salient content token, so questions
     inside one topic still group by idea without an external taxonomy. */
  const STOP = new Set(['কী', 'কে', 'কত', 'কোন', 'কোনটি', 'নিচের', 'what', 'who', 'which', 'the', 'a', 'an', 'of', 'is', 'are', 'in', 'on', 'and']);
  function conceptOf(q) {
    const topic = String((q && q.topicName) || (q && q.topicId) || '').trim();
    const words = tokens(q && q.question).filter(w => w.length > 2 && !STOP.has(w));
    const key = words.slice(0, 2).join('-');
    return [topic, key].filter(Boolean).join(':') || 'general';
  }

  function expectedTime(q) {
    const diff = difficultyOf(q);
    const base = { easy: 35, medium: 55, hard: 85 };
    return base[diff] || 55;
  }

  /* Explanation quality: an explanation that is missing, or that never names
     the correct option's content, does not teach. Returns a score + issues. */
  function explanationScore(q) {
    const exp = String((q && q.explanation) || '').trim();
    const issues = [];
    if (!exp) return { score: 0, issues: ['missing explanation'] };
    const expNorm = normalizeText(exp);
    const wc = tokens(exp).length;
    let score = exp.length >= 40 ? 60 : 25;
    if (wc >= 8) score += 20; else issues.push('explanation too short');
    const idx = answerIndex(q);
    const ans = idx >= 0 && Array.isArray(q.options) ? String(q.options[idx] || '') : '';
    const ansNorm = normalizeText(ans);
    // The key tokens of the correct option (length >= 2 so short answers like
    // "H2O" or Bengali one-syllable words still count).
    const ansTokens = tokens(ans).filter(w => w.length >= 2);
    const references = (ansNorm && expNorm.includes(ansNorm)) || ansTokens.some(w => expNorm.includes(w));
    if (references) score += 20;
    else issues.push('explanation does not reference the correct option');
    if (/সঠিক উত্তর|the answer is|because|কারণ/i.test(exp)) score += 5;
    return { score: Math.max(0, Math.min(100, score)), issues };
  }

  /* Answer-consistency: the key must point at exactly one real, distinct
     option. These are the mistakes that make a question unanswerable. */
  function consistencyIssues(q) {
    const issues = [];
    const opts = Array.isArray(q && q.options) ? q.options : [];
    if (opts.length < 2) issues.push('fewer than two options');
    if (opts.length && opts.length !== 4) issues.push('option count is not four');
    if (opts.some(o => !String(o || '').trim())) issues.push('an option is empty');
    const idx = answerIndex(q);
    if (idx < 0 || idx >= opts.length) issues.push('answer key is out of range');
    const norm = opts.map(o => normalizeText(o));
    if (norm.length && new Set(norm).size !== norm.length) issues.push('duplicate options');
    return issues;
  }

  /* One 0-100 quality score per question, with the reasons. */
  function scoreQuestion(q) {
    const consistency = consistencyIssues(q);
    const expl = explanationScore(q);
    let score = 100;
    score -= consistency.length * 18;
    score -= expl.issues.length * 10;
    if (!String((q && q.explanation) || '').trim()) score -= 10;
    return {
      score: Math.max(0, Math.min(100, Math.round(score))),
      issues: [...consistency, ...expl.issues],
      explanation: expl.score,
    };
  }

  /* Additive, pure: returns a new question with the P07 metadata filled in.
     Never mutates the input, so callers decide when to persist. */
  function tagQuestion(q) {
    const analysis = scoreQuestion(q);
    return {
      ...q,
      difficulty: difficultyOf(q),
      difficultyScore: difficultyScore(q),
      type: typeOf(q),
      concept: conceptOf(q),
      expectedTime: expectedTime(q),
      quality: analysis.score,
      qualityIssues: analysis.issues,
      taggedBy: ENGINE_VERSION,
      taggedAt: Date.now(),
    };
  }

  /* ── duplicate detection (blocked, so lakhs stay tractable) ───────────────── */

  /* Two questions are compared only when they land in the same block: a shared
     first content token, or a similar length. That turns a full O(n²) scan into
     a handful of small buckets, and keeps the result identical for real
     duplicates (which almost always share both). */
  const normCacheKey = q => normalizeText(q && q.question);

  function blockingKeys(q) {
    const t = tokens(normCacheKey(q));
    const first = t[0] || '';
    const lenBucket = Math.floor(t.length / 4);
    return [first ? `f:${first}` : '', `l:${lenBucket}`];
  }

  function findDuplicates(questions, opts) {
    const list = Array.isArray(questions) ? questions : [];
    const threshold = opts && Number.isFinite(opts.threshold) ? opts.threshold : 0.82;
    const maxBucket = opts && opts.maxBucket ? opts.maxBucket : 200;
    const clusters = [];
    const seen = new Set();

    // Index by block key → list of indices.
    const index = new Map();
    list.forEach((q, i) => {
      const key = normCacheKey(q);
      if (!key) return;
      for (const bk of blockingKeys(q)) {
        if (!bk) continue;
        if (!index.has(bk)) index.set(bk, []);
        index.get(bk).push(i);
      }
    });

    for (let i = 0; i < list.length; i++) {
      if (seen.has(i)) continue;
      const a = list[i];
      const na = normCacheKey(a);
      if (!na) continue;
      // Gather candidate neighbours from this question's blocks (deduped, capped).
      const cand = new Set();
      for (const bk of blockingKeys(a)) {
        const bucket = index.get(bk);
        if (!bucket || bucket.length > maxBucket) continue;
        for (const j of bucket) if (j !== i) cand.add(j);
      }
      const group = [i];
      for (const j of cand) {
        if (seen.has(j)) continue;
        const score = similarity(a.question, list[j].question);
        if (score >= threshold) group.push(j);
      }
      if (group.length > 1) {
        const memberIds = group.map(j => list[j].id != null ? list[j].id : j);
        for (const j of group) seen.add(j);
        const normalised = new Set(group.map(j => normCacheKey(list[j])));
        clusters.push({
          ids: memberIds,
          count: group.length,
          exact: normalised.size === 1,
          maxSimilarity: Math.round(Math.max(...group.map(j => similarity(a.question, list[j].question))) * 100) / 100,
          sample: String(a.question || '').slice(0, 140),
        });
      }
    }
    clusters.sort((x, y) => y.count - x.count || y.maxSimilarity - x.maxSimilarity);
    return clusters;
  }

  /* ── bank-wide analysis (single pass, lakhs-ready) ────────────────────────── */

  function analyzeBank(questions, opts) {
    const list = Array.isArray(questions) ? questions : [];
    const byDifficulty = { easy: 0, medium: 0, hard: 0 };
    const byType = { factual: 0, conceptual: 0, numerical: 0, application: 0 };
    const bySubject = new Map();
    const byTopic = new Map();
    let qualitySum = 0, missingExplanation = 0, untagged = 0, inconsistent = 0, lowQuality = 0;
    const LOW = (opts && opts.lowQuality) || 70;

    for (const q of list) {
      const diff = difficultyOf(q);
      const type = typeOf(q);
      byDifficulty[diff] = (byDifficulty[diff] || 0) + 1;
      byType[type] = (byType[type] || 0) + 1;
      const analysis = scoreQuestion(q);
      qualitySum += analysis.score;
      if (analysis.score < LOW) lowQuality++;
      if (!String((q && q.explanation) || '').trim()) missingExplanation++;
      if (consistencyIssues(q).length) inconsistent++;
      if (!q || q.taggedBy !== ENGINE_VERSION) untagged++;
      const s = String((q && q.subjectId) || 'unknown');
      const t = String((q && q.topicId) || 'unknown');
      bySubject.set(s, (bySubject.get(s) || 0) + 1);
      byTopic.set(t, (byTopic.get(t) || 0) + 1);
    }

    const total = list.length;
    const duplicates = findDuplicates(list, opts);
    return {
      version: ENGINE_VERSION,
      total,
      avgQuality: total ? Math.round(qualitySum / total) : 0,
      byDifficulty,
      byType,
      bySubject: Object.fromEntries(bySubject),
      byTopic: Object.fromEntries(byTopic),
      missingExplanation,
      inconsistent,
      untagged,
      lowQuality,
      duplicateClusters: duplicates.length,
      duplicateQuestions: duplicates.reduce((n, c) => n + c.count, 0),
      topDuplicates: duplicates.slice(0, 10),
    };
  }

  /* Apply tags in bulk without touching storage, returns new array; the caller
     persists the changed records. */
  function applyTags(questions) {
    return (Array.isArray(questions) ? questions : []).map(tagQuestion);
  }

  /* Self-check used by the test suite and an optional runtime guard. */
  function validate() {
    const problems = [];
    if (!DIFFICULTIES.length) problems.push('no difficulties');
    if (similarity('a b c', 'a b c') !== 1) problems.push('similarity identity failed');
    if (similarity('a b c', 'x y z') !== 0) problems.push('similarity disjoint failed');
    const bad = scoreQuestion({ question: 'x', options: ['a', 'b'], answer: 5 });
    if (!bad.issues.length) problems.push('unanswerable question passed');
    return problems;
  }

  return {
    ENGINE_VERSION, DIFFICULTIES, TYPES,
    normalizeText, tokens, similarity, jaccard, dice,
    answerIndex, difficultyScore, difficultyOf, typeOf, conceptOf, expectedTime,
    explanationScore, consistencyIssues, scoreQuestion, tagQuestion,
    findDuplicates, analyzeBank, applyTags, validate,
  };
});
