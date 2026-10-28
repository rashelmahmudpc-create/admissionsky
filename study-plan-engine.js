/* Admission Hub, P17 student-facing action agent: "prepare me".
 *
 * The student presses one button ("আমাকে প্রস্তুত করো") and this engine turns
 * what the app already knows, exam history, per-topic ability, mistakes, into
 * an ordered, honest study plan: which topics first, why, how many questions,
 * at what difficulty, over the next few days.
 *
 * Pure and dependency-free (like adaptive-engine.js / mistake-engine.js), so it
 * runs in the browser as window.AhStudyPlanEngine and under node:test. It stores
 * nothing and calls no model: every number is derived from the history on demand.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.AhStudyPlanEngine = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DIFFS = ['easy', 'medium', 'hard'];
  const WEIGHT = { easy: 1, medium: 1.5, hard: 2 };
  const CONFIDENT_AT = 6;
  const DAY_MS = 86400000;

  const num = (v) => { const n = Number(v); return isFinite(n) ? n : 0; };
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const round1 = (v) => Math.round(v * 10) / 10;

  const difficultyOf = (q) => {
    const d = String((q && q.difficulty) || '').toLowerCase();
    return DIFFS.includes(d) ? d : 'medium';
  };
  const bandFor = (ability, attempts) => {
    if (num(attempts) < 3) return 'mixed';
    if (ability >= 75) return 'hard';
    if (ability >= 50) return 'medium';
    return 'easy';
  };
  const mixFor = (band) => {
    if (band === 'easy') return { easy: 0.5, medium: 0.35, hard: 0.15 };
    if (band === 'hard') return { easy: 0.15, medium: 0.35, hard: 0.5 };
    return { easy: 0.3, medium: 0.4, hard: 0.3 };
  };

  /* Every answered question in the history, tagged with topic + difficulty. */
  function rowsOf(results, questionsById) {
    const rows = [];
    for (const r of (Array.isArray(results) ? results : [])) {
      if (!r || typeof r !== 'object') continue;
      const at = num(r.completedAt || r.date);
      for (const s of (Array.isArray(r.snapshot) ? r.snapshot : [])) {
        if (!s || !s.status || s.status === 'skipped') continue;
        const q = questionsById.get(s.questionId);
        rows.push({
          at, topicId: s.topicId || (q && q.topicId) || 'unknown',
          questionId: s.questionId, difficulty: difficultyOf(q),
          correct: s.status === 'correct'
        });
      }
    }
    return rows;
  }

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
      const ability = total > 0 ? round1((gained / total) * 100) : 0;
      out.push({
        topicId, attempts: list.length, ability,
        wrongCount: list.filter((r) => !r.correct).length,
        confidence: Math.round(clamp(list.length / CONFIDENT_AT, 0, 1) * 100) / 100,
        band: bandFor(ability, list.length)
      });
    }
    out.sort((a, b) => a.ability - b.ability || b.attempts - a.attempts);
    return out;
  }

  /* The ranked list the agent works down: weakest first, but a topic the student
     has barely touched is not called "weak", it is marked as unattempted. */
  function priorities(topics, mistakes) {
    const missed = new Map();
    for (const m of (Array.isArray(mistakes) ? mistakes : [])) {
      if (!m || m.questionId == null) continue;
      const tid = m.topicId || m.topic || null;
      if (!tid) continue;
      missed.set(tid, (missed.get(tid) || 0) + num(m.wrongCount || 1));
    }
    const out = [];
    for (const t of topics) {
      const repeats = missed.get(t.topicId) || 0;
      let kind, reason;
      if (t.attempts < 3) {
        // Too little data to call it strong or steady. A wrong answer here is
        // still a real signal, so it goes to the top rather than being excused.
        if (t.wrongCount > 0) { kind = 'weak'; reason = 'কম অনুশীলন, আর ভুল হয়েছে, শুরু থেকে ধরো'; }
        else { kind = 'new'; reason = 'এখনো কম অনুশীলন, ভিত গড়ো'; }
      } else if (t.ability < 50) { kind = 'weak'; reason = 'সঠিক উত্তর কম, আগে এটা ঠিক করো'; }
      else if (t.ability < 75) { kind = 'steady'; reason = 'মাঝামাঝি, একটু অনুশীলনে ভালো হবে'; }
      else { kind = 'strong'; reason = 'ভালো করছো, কঠিন প্রশ্নে ধরে রাখো'; }
      if (repeats >= 2 && kind !== 'new') { kind = 'weak'; reason = 'বারবার ভুল হচ্ছে, বিশেষভাবে দেখো'; }
      // Lower score = higher urgency. A thin-data topic sits mid-pack unless it
      // has a wrong answer, which the kind above already escalates.
      const score = t.ability - (repeats * 4) - (t.attempts < 3 && t.wrongCount === 0 ? 15 : 0);
      out.push({ topicId: t.topicId, ability: t.ability, attempts: t.attempts, repeats, kind, reason, band: t.band, score });
    }
    out.sort((a, b) => a.score - b.score || b.repeats - a.repeats || a.topicId.localeCompare(b.topicId));
    return out;
  }

  /* Split a day's question budget across a topic list using the band mix. */
  function distribute(band, perTopic, count) {
    const mix = mixFor(band);
    const out = {};
    for (const d of DIFFS) out[d] = Math.round(count * mix[d]);
    let diff = count - DIFFS.reduce((s, d) => s + out[d], 0);
    // Hand any rounding remainder to the dominant band so the totals are exact.
    if (diff !== 0) { const top = DIFFS.slice().sort((a, b) => mix[b] - mix[a])[0]; out[top] = Math.max(0, out[top] + diff); }
    void perTopic;
    return out;
  }

  const DEFAULT_DAYS = 3;
  const PER_TOPIC = 12;

  /* The plan itself: the top-priority topics, a few per day, each with the
     difficulty mix its own ability band calls for. */
  function build(input) {
    const opts = input || {};
    const results = opts.results || [];
    const questions = opts.questions || [];
    const mistakes = opts.mistakes || [];
    const questionsById = new Map(questions.filter(Boolean).map((q) => [q.id, q]));
    const rows = rowsOf(results, questionsById);
    const topics = topicAbility(rows);
    const prio = priorities(topics, mistakes);

    const dayCount = clamp(num(opts.days) || DEFAULT_DAYS, 1, 14);
    const perDay = clamp(num(opts.perDay) || 3, 1, 6);
    const perTopic = clamp(num(opts.perTopic) || PER_TOPIC, 4, 60);

    const days = [];
    let cursor = 0;
    for (let d = 0; d < dayCount; d++) {
      const slice = prio.slice(cursor, cursor + perDay);
      if (!slice.length) break; // no topics left: never emit an empty day
      cursor += perDay;
      const blocks = slice.map((p) => ({
        topicId: p.topicId, kind: p.kind, reason: p.reason,
        ability: p.ability, count: perTopic,
        mix: distribute(p.band || 'mixed', perTopic, perTopic)
      }));
      days.push({ index: d + 1, label: d === 0 ? 'আজ' : (d === 1 ? 'কাল' : `${d + 1} নম্বর দিন`), blocks });
      if (cursor >= prio.length) break;
    }

    const totalQuestions = days.reduce((s, day) => s + day.blocks.reduce((a, b) => a + b.count, 0), 0);
    const overall = overallOf(rows, topics);
    const focus = prio.slice(0, perDay).map((p) => p.topicId);
    return {
      days, topics, priorities: prio, focus,
      totals: { questions: totalQuestions, topics: prio.length, days: days.length },
      overall,
      message: message(overall, prio, topics)
    };
  }

  function overallOf(rows, topics) {
    if (!rows.length) return { ability: 0, band: 'mixed', attempts: 0, confidence: 0 };
    let gained = 0, weight = 0;
    for (const r of rows) { const w = WEIGHT[r.difficulty] || 1; weight += w; if (r.correct) gained += w; }
    const ability = weight > 0 ? round1((gained / weight) * 100) : 0;
    return {
      ability, band: bandFor(ability, rows.length), attempts: rows.length,
      confidence: Math.round(clamp(rows.length / (CONFIDENT_AT * 3), 0, 1) * 100) / 100
    };
  }

  /* One honest sentence the student can read first. Never promises a rank. */
  function message(overall, prio, topics) {
    if (!topics.length) return 'এখনো পরীক্ষার ডেটা নেই, একটি পরীক্ষা দাও, তারপর পরিকল্পনা সাজাবো।';
    const weakest = prio.find((p) => p.kind === 'weak') || prio[0];
    const band = overall.band;
    const bandBn = band === 'easy' ? 'সহজ' : band === 'hard' ? 'কঠিন' : 'মাঝারি';
    return `তোমার সামগ্রিক সামর্থ্য ${overall.ability}%, এখন ${bandBn} প্রশ্নে অনুশীলন করলে সবচেয়ে লাভ হবে। ` +
      `প্রথমে "${weakest.topicId}"-এ মন দাও: ${weakest.reason}।`;
  }

  return { build, priorities, topicAbility, overallOf, mixFor, bandFor, message, DEFAULT_DAYS, PER_TOPIC };
});
