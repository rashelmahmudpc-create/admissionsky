/* Admission Hub, P11 Adaptive Learning Engine.
 *
 * Pure and dependency-free (like question-engine.js / analytics-insight-engine.js /
 * mistake-engine.js), so it runs in the browser as window.AhAdaptiveEngine and
 * under node:test for verification. It turns the raw exam history into the four
 * P11 pieces, with no storage of its own:
 *   - ability:    a per-topic estimate of how strong the student is (hard
 *                 questions count for more than easy ones).
 *   - recommendedDifficulty: which difficulty band to practise next.
 *   - practicePattern: a small memory of how the student studies.
 *   - speedProfile: fast-accurate / fast-wrong / slow-right / balanced.
 *
 * Nothing here writes to the database; every value is derived on demand.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.AhAdaptiveEngine = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DIFFS = ['easy', 'medium', 'hard'];
  const WEIGHT = { easy: 1, medium: 1.5, hard: 2 };
  const FALLBACK_TIME = { easy: 35, medium: 55, hard: 85 };
  const CONFIDENT_AT = 6;   // answers before a topic's estimate is trusted

  const num = v => { const n = Number(v); return isFinite(n) ? n : 0; };
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  function difficultyOf(q) {
    const d = String((q && q.difficulty) || '').toLowerCase();
    return DIFFS.includes(d) ? d : 'medium';
  }
  function expectedTime(q) {
    const t = num(q && q.expectedTime);
    if (t > 0) return t;
    return FALLBACK_TIME[difficultyOf(q)];
  }
  function secondsOf(snap) {
    const t = snap && snap.timing;
    if (t && num(t.ms) > 0) return num(t.ms) / 1000;
    return num(snap && snap.seconds);
  }

  /* Every answered question in the history, tagged with topic and difficulty. */
  function collect(results, questionsById) {
    const rows = [];
    const list = Array.isArray(results) ? results : [];
    for (const r of list) {
      if (!r || typeof r !== 'object') continue;
      const at = num(r.completedAt || r.date);
      const snaps = Array.isArray(r.snapshot) ? r.snapshot : [];
      for (const s of snaps) {
        if (!s || !s.status || s.status === 'skipped') continue;
        const q = questionsById && questionsById.get ? questionsById.get(s.questionId) : null;
        rows.push({
          at, topicId: s.topicId || 'unknown', questionId: s.questionId,
          difficulty: difficultyOf(q), expected: expectedTime(q),
          correct: s.status === 'correct', seconds: secondsOf(s)
        });
      }
    }
    return rows;
  }

  /* Per-topic ability: weighted accuracy (hard counts double) plus a confidence
     that grows with the number of answers, and a band to practise next. */
  function topicAbility(rows) {
    const byTopic = new Map();
    for (const r of rows) {
      if (!byTopic.has(r.topicId)) byTopic.set(r.topicId, []);
      byTopic.get(r.topicId).push(r);
    }
    const out = [];
    for (const [topicId, list] of byTopic.entries()) {
      let gained = 0, total = 0;
      for (const r of list) { const w = WEIGHT[r.difficulty] || 1; total += w; if (r.correct) gained += w; }
      const ability = total > 0 ? Math.round((gained / total) * 1000) / 10 : 0;
      out.push({
        topicId, attempts: list.length, ability,
        accuracy: list.length ? Math.round((list.filter(r => r.correct).length / list.length) * 1000) / 10 : 0,
        confidence: Math.round(clamp(list.length / CONFIDENT_AT, 0, 1) * 100) / 100,
        band: recommendBand(ability, list.length)
      });
    }
    out.sort((a, b) => a.ability - b.ability || b.attempts - a.attempts);
    return out;
  }

  /* Low ability -> easy, high ability -> hard. Too few answers -> mixed, so an
     unknown student is not pushed into a band the data does not support. */
  function recommendBand(ability, attempts) {
    if (num(attempts) < 3) return 'mixed';
    if (ability >= 75) return 'hard';
    if (ability >= 50) return 'medium';
    return 'easy';
  }

  /* Overall ability is the answer-weighted mean across every topic. */
  function overallAbility(rows, topics) {
    const total = rows.length;
    if (!total) return { ability: 0, confidence: 0, band: 'mixed', attempts: 0 };
    let gained = 0, weight = 0;
    for (const r of rows) { const w = WEIGHT[r.difficulty] || 1; weight += w; if (r.correct) gained += w; }
    const ability = weight > 0 ? Math.round((gained / weight) * 1000) / 10 : 0;
    void topics;
    return { ability, confidence: Math.round(clamp(total / (CONFIDENT_AT * 3), 0, 1) * 100) / 100, band: recommendBand(ability, total), attempts: total };
  }

  /* Speed profile: compare accuracy when answering quickly against accuracy when
     answering slowly, relative to each question's expected time. */
  function speedProfile(rows) {
    let fastN = 0, fastC = 0, slowN = 0, slowC = 0, sumSeconds = 0, timed = 0;
    for (const r of rows) {
      if (!(r.seconds > 0)) continue;
      timed++;
      sumSeconds += r.seconds;
      if (r.seconds <= 0.6 * r.expected) { fastN++; if (r.correct) fastC++; }
      else if (r.seconds >= 1.4 * r.expected) { slowN++; if (r.correct) slowC++; }
    }
    const fastAcc = fastN ? (fastC / fastN) * 100 : null;
    const slowAcc = slowN ? (slowC / slowN) * 100 : null;
    const avgSeconds = timed ? Math.round(sumSeconds / timed) : 0;
    let profile = 'balanced';
    if (timed >= 4) {
      if (fastN >= 3 && fastAcc >= 70 && (slowAcc == null || fastAcc >= slowAcc)) profile = 'fast-accurate';
      else if (slowN >= 3 && slowAcc >= 70 && (fastAcc == null || slowAcc >= fastAcc)) profile = 'slow-right';
      else if (fastN >= 3 && fastAcc < 70 && (slowAcc == null || fastAcc < slowAcc - 12)) profile = 'fast-wrong';
    }
    return { profile, fastAccuracy: fastAcc == null ? null : Math.round(fastAcc), slowAccuracy: slowAcc == null ? null : Math.round(slowAcc), fastCount: fastN, slowCount: slowN, averageSeconds: avgSeconds };
  }

  /* A small, honest memory of how the student practises, not a stored record,
     just what this history says right now. */
  function practicePattern(results, rows) {
    const list = (Array.isArray(results) ? results : []).filter(r => r && typeof r === 'object');
    const days = new Set();
    for (const r of list) {
      const at = num(r.completedAt || r.date);
      if (at > 0) days.add(new Date(at).toISOString().slice(0, 10));
    }
    const totalQuestions = rows.length;
    const counts = {};
    for (const r of rows) counts[r.difficulty] = (counts[r.difficulty] || 0) + 1;
    const preferred = DIFFS.slice().sort((a, b) => (counts[b] || 0) - (counts[a] || 0))[0];
    return {
      exams: list.length,
      activeDays: days.size,
      totalQuestions,
      averageQuestionsPerExam: list.length ? Math.round(totalQuestions / list.length) : 0,
      preferredDifficulty: counts[preferred] ? preferred : 'medium'
    };
  }

  function analyze(input) {
    const results = (input && input.results) || [];
    const questions = (input && input.questions) || [];
    const questionsById = new Map(questions.filter(Boolean).map(q => [q.id, q]));
    const rows = collect(results, questionsById);
    const topics = topicAbility(rows);
    const overall = overallAbility(rows, topics);
    return {
      topics,
      overall,
      recommendedDifficulty: overall.band,
      speed: speedProfile(rows),
      practicePattern: practicePattern(results, rows)
    };
  }

  /* The adaptive target mix for ExamSelect: a struggling student gets more easy
     questions, a strong one more hard ones. Always sums to 1. */
  function targetMix(band) {
    if (band === 'easy') return { easy: 0.5, medium: 0.35, hard: 0.15 };
    if (band === 'hard') return { easy: 0.15, medium: 0.35, hard: 0.5 };
    return { easy: 0.3, medium: 0.5, hard: 0.2 };
  }

  return { DIFFS, analyze, topicAbility, recommendBand, speedProfile, practicePattern, targetMix, difficultyOf, expectedTime, __test: { collect, secondsOf, WEIGHT, CONFIDENT_AT } };
});
