/* P09, Advanced Analytics insight engine.
 *
 * Pure and dependency-free (like question-engine.js), so it runs in the browser
 * as window.AhAnalyticsInsights and under node:test for verification. It turns
 * raw exam results, questions and mistakes into the P09 picture:
 *   strong/weak/improving/declining/needs-revision topics, difficulty-wise and
 *   time-spent breakdowns, wrong-pattern detection, improvement-rate, and
 *   plain-language insight cards.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.AhAnalyticsInsights = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const STATUS = { STRONG: 'strong', STEADY: 'steady', WEAK: 'weak', IMPROVING: 'improving', DECLINING: 'declining', REVISION: 'needs-revision', NEW: 'new' };
  const DIFFS = ['easy', 'medium', 'hard'];
  const STRONG_ACC = 80, WEAK_ACC = 60, TREND_DELTA = 8, MIN_ATTEMPTS = 3;

  const num = v => { const n = Number(v); return isFinite(n) ? n : 0; };
  const pct = (c, t) => (t > 0 ? Math.round((c / t) * 1000) / 10 : 0);
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  function snapshots(results) {
    const out = [];
    for (const r of (Array.isArray(results) ? results : [])) {
      const snaps = Array.isArray(r && r.snapshot) ? r.snapshot : [];
      const at = num(r && (r.completedAt || r.date));
      for (const s of snaps) if (s && s.status) out.push({ at, ...s });
    }
    return out;
  }

  function accuracyOf(rows) {
    let c = 0, t = 0;
    for (const s of rows) { if (s.status === 'correct') { c++; t++; } else if (s.status === 'wrong') { t++; } }
    return { correct: c, attempted: t, accuracy: pct(c, t) };
  }

  /* Split a topic's answers in half to see which way it is moving. The answers
     must come from more than one exam: a trend is only meaningful across days,
     never within a single paper, and fewer than 4 answers is not enough signal. */
  function trendOf(rows) {
    const sorted = rows.slice().sort((a, b) => a.at - b.at);
    const distinctExams = new Set(sorted.map(r => r.at)).size;
    if (sorted.length < 4 || distinctExams < 2) return 'flat';
    const mid = Math.floor(sorted.length / 2);
    const early = accuracyOf(sorted.slice(0, mid)).accuracy;
    const late = accuracyOf(sorted.slice(mid)).accuracy;
    if (late - early >= TREND_DELTA) return 'up';
    if (early - late >= TREND_DELTA) return 'down';
    return 'flat';
  }

  /* One label per topic. Order matters: a solid score stands on its own, a
     downward move is called out even at a decent average, and only then do
     unreviewed mistakes and plain weakness get their labels. */
  function classifyTopic(acc, trend, pendingMistakes, attempts) {
    if (attempts === 0) return STATUS.NEW;
    if (acc >= STRONG_ACC) return STATUS.STRONG;
    if (trend === 'down') return STATUS.DECLINING;
    if (trend === 'up') return STATUS.IMPROVING;
    if (pendingMistakes > 0 && acc < 70) return STATUS.REVISION;
    if (acc < WEAK_ACC && attempts >= MIN_ATTEMPTS) return STATUS.WEAK;
    return STATUS.STEADY;
  }

  /* Per-topic strength map. `pending` is the count of mistakes still awaiting
     revision in that topic, which is what makes "needs-revision" different
     from a plain low score. */
  function topicStats(results, mistakes) {
    const byTopic = new Map();
    for (const s of snapshots(results)) {
      const key = s.topicId || 'unknown';
      if (!byTopic.has(key)) byTopic.set(key, []);
      byTopic.get(key).push(s);
    }
    const pendingByTopic = new Map();
    for (const m of (Array.isArray(mistakes) ? mistakes : [])) {
      if (m && m.revisionStatus === 'pending' && !m.mastered) {
        const key = m.topicId || 'unknown';
        pendingByTopic.set(key, (pendingByTopic.get(key) || 0) + 1);
      }
    }
    const rows = [];
    for (const [topicId, list] of byTopic.entries()) {
      const a = accuracyOf(list);
      const trend = trendOf(list);
      const pending = pendingByTopic.get(topicId) || 0;
      rows.push({
        topicId, attempts: a.attempted, correct: a.correct, accuracy: a.accuracy,
        trend, pendingMistakes: pending,
        status: classifyTopic(a.accuracy, trend, pending, a.attempted)
      });
    }
    rows.sort((x, y) => y.attempts - x.attempts);
    return rows;
  }

  /* Difficulty-wise accuracy. Difficulty comes from the question record (P07
     tags it); the answer status comes from the exam snapshot. */
  function difficultyStats(results, questionsById) {
    const buckets = Object.fromEntries(DIFFS.map(d => [d, { correct: 0, attempted: 0 }]));
    let untagged = 0;
    for (const s of snapshots(results)) {
      if (s.status === 'skipped') continue;
      const q = questionsById && questionsById.get ? questionsById.get(s.questionId) : null;
      let d = String((q && q.difficulty) || '').toLowerCase();
      if (!DIFFS.includes(d)) d = 'medium';
      if (!q || !q.difficulty) untagged++;
      buckets[d].attempted++;
      if (s.status === 'correct') buckets[d].correct++;
    }
    const out = {};
    for (const d of DIFFS) out[d] = { attempted: buckets[d].attempted, correct: buckets[d].correct, accuracy: pct(buckets[d].correct, buckets[d].attempted) };
    out.untagged = untagged;
    return out;
  }

  /* Time spent: total, average per answered question, and per difficulty. */
  function timeStats(results, questionsById) {
    let totalSeconds = 0, answered = 0;
    const byDifficulty = Object.fromEntries(DIFFS.map(d => [d, { seconds: 0, n: 0 }]));
    for (const r of (Array.isArray(results) ? results : [])) {
      totalSeconds += num(r && (r.timeUsed || r.duration)) || 0;
      const snaps = Array.isArray(r && r.snapshot) ? r.snapshot : [];
      for (const s of snaps) {
        if (s.status === 'skipped') continue;
        answered++;
        const sec = num(s.timing && s.timing.seconds) || num(s.seconds);
        const q = questionsById && questionsById.get ? questionsById.get(s.questionId) : null;
        const d = DIFFS.includes(String((q && q.difficulty) || '').toLowerCase()) ? String(q.difficulty).toLowerCase() : null;
        if (d) { byDifficulty[d].seconds += sec; byDifficulty[d].n++; }
      }
    }
    const perDiff = {};
    for (const d of DIFFS) perDiff[d] = { seconds: byDifficulty[d].seconds, average: byDifficulty[d].n ? Math.round(byDifficulty[d].seconds / byDifficulty[d].n) : 0 };
    return { totalSeconds, answered, averagePerQuestion: answered ? Math.round(totalSeconds / answered) : 0, byDifficulty: perDiff };
  }

  /* Wrong-pattern report: questions wrong more than once, and the topic each
     sits in, so a repeated slip is visible rather than a single bad day. */
  function wrongPatterns(mistakes) {
    const list = (Array.isArray(mistakes) ? mistakes : []).filter(m => m);
    const repeated = list.filter(m => num(m.wrongCount) >= 2)
      .map(m => ({ questionId: m.questionId, topicId: m.topicId || 'unknown', wrongCount: num(m.wrongCount), mastered: !!m.mastered }))
      .sort((a, b) => b.wrongCount - a.wrongCount);
    const byTopic = new Map();
    for (const m of list) {
      const key = m.topicId || 'unknown';
      byTopic.set(key, (byTopic.get(key) || 0) + 1);
    }
    const topicCounts = [...byTopic.entries()].map(([topicId, count]) => ({ topicId, count })).sort((a, b) => b.count - a.count);
    return { repeated, byTopic: topicCounts, totalWrong: list.length };
  }

  /* Improvement rate: accuracy across the first half vs the second half of
     completed exams, plus per-topic. Positive means getting better. */
  function improvementRate(results) {
    const exams = (Array.isArray(results) ? results : []).filter(r => r && typeof r === 'object').slice()
      .sort((a, b) => num(a.completedAt || a.date) - num(b.completedAt || b.date));
    const accs = exams.map(r => num(r.accuracy));
    if (accs.length < 2) return { overall: 0, samples: accs.length };
    const mid = Math.floor(accs.length / 2);
    const mean = xs => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
    const overall = Math.round((mean(accs.slice(mid)) - mean(accs.slice(0, mid))) * 10) / 10;
    return { overall, samples: accs.length };
  }

  /* Plain-language insight cards, built only from what the data supports, no
     insight is emitted when there is nothing to say. */
  function insights(model) {
    const cards = [];
    const topics = model.topics || [];
    const strong = topics.filter(t => t.status === STATUS.STRONG).slice(0, 3);
    const weak = topics.filter(t => t.status === STATUS.WEAK).slice(0, 3);
    const improving = topics.filter(t => t.status === STATUS.IMPROVING).slice(0, 3);
    const declining = topics.filter(t => t.status === STATUS.DECLINING).slice(0, 3);
    const revision = topics.filter(t => t.status === STATUS.REVISION).slice(0, 3);

    if (strong.length) cards.push({ kind: 'positive', title: 'শক্ত দিক', text: `এই টপিকগুলোতে তুমি ভালো করছ: ${strong.map(t => t.topicId).join(', ')}।` });
    if (improving.length) cards.push({ kind: 'positive', title: 'উন্নতি হচ্ছে', text: `সম্প্রতি উন্নতি করেছ: ${improving.map(t => t.topicId).join(', ')}, এভাবে চালিয়ে যাও।` });
    if (weak.length) cards.push({ kind: 'attention', title: 'দুর্বল দিক', text: `এখানে আরও অনুশীলন দরকার: ${weak.map(t => `${t.topicId} (${t.accuracy}%)`).join(', ')}।` });
    if (declining.length) cards.push({ kind: 'attention', title: 'কমে যাচ্ছে', text: `এই টপিকগুলোতে নম্বর নামছে: ${declining.map(t => t.topicId).join(', ')}, আবার রিভিশন দাও।` });
    if (revision.length) cards.push({ kind: 'attention', title: 'রিভিশন বাকি', text: `${revision.reduce((a, t) => a + t.pendingMistakes, 0)}টি ভুল-প্রশ্ন এখনো রিভিশন হয়নি (${revision.map(t => t.topicId).join(', ')})।` });

    const d = model.difficulty || {};
    const weakest = DIFFS.filter(x => d[x] && d[x].attempted >= 3).sort((a, b) => d[a].accuracy - d[b].accuracy)[0];
    if (weakest && d[weakest].accuracy < 70) cards.push({ kind: 'neutral', title: 'কঠিনতা-ভিত্তিক', text: `${weakest} প্রশ্নে তোমার নির্ভুলতা ${d[weakest].accuracy}%, এটাই সবচেয়ে দুর্বল স্তর।` });

    const imp = model.improvement || {};
    if (imp.samples >= 2 && Math.abs(imp.overall) >= 3) {
      cards.push({ kind: imp.overall > 0 ? 'positive' : 'attention', title: 'উন্নতির হার', text: imp.overall > 0 ? `গড় নির্ভুলতা ${imp.overall} পয়েন্ট বেড়েছে আগের তুলনায়।` : `গড় নির্ভুলতা ${Math.abs(imp.overall)} পয়েন্ট কমেছে, সময় দাও।` });
    }

    const wp = model.patterns || {};
    if (wp.repeated && wp.repeated.length) cards.push({ kind: 'attention', title: 'বারবার ভুল', text: `${wp.repeated.length}টি প্রশ্নে তুমি একাধিকবার ভুল করেছ, এগুলো আগে রিভিশন করো।` });
    return cards;
  }

  function analyze(input) {
    const results = (input && input.results) || [];
    const mistakes = (input && input.mistakes) || [];
    const questions = (input && input.questions) || [];
    const questionsById = new Map(questions.map(q => [q && q.id, q]));
    const model = {
      topics: topicStats(results, mistakes),
      difficulty: difficultyStats(results, questionsById),
      time: timeStats(results, questionsById),
      patterns: wrongPatterns(mistakes),
      improvement: improvementRate(results)
    };
    model.insights = insights(model);
    return model;
  }

  return { STATUS, DIFFS, pct, snapshots, accuracyOf, trendOf, classifyTopic, topicStats, difficultyStats, timeStats, wrongPatterns, improvementRate, insights, analyze };
});
