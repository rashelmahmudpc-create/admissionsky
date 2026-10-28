/* Admission Hub, P10 Smart Mistake & Revision: mistake engine.
 *
 * Pure and dependency-free (like question-engine.js / analytics-insight-engine.js),
 * so it runs in the browser as window.AhMistakeEngine and under node:test for
 * verification. It answers the four P10 questions about a single wrong answer:
 *   - categorize:  which kind of mistake was it (careless/conceptual/memory/
 *                  confusion/time/repeated)?
 *   - priorityTier: how urgently should it be revised (critical/high/medium/
 *                  mastered)?
 *   - isRepeated:  has this exact question been missed more than once?
 *   - nextRevisionState: after a revision attempt, has it become mastered?
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.AhMistakeEngine = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const CATEGORY = { CARELESS: 'careless', CONCEPTUAL: 'conceptual', MEMORY: 'memory', CONFUSION: 'confusion', TIME: 'time', REPEATED: 'repeated' };
  const TIER = { CRITICAL: 'critical', HIGH: 'high', MEDIUM: 'medium', MASTERED: 'mastered' };

  const REPEATED_AT = 2;      // wrong twice = a repeated mistake
  const MASTER_STREAK = 2;    // two correct revisions in a row = mastered
  const FAST_SECONDS = 12;    // answered this fast and still wrong looks careless
  const SLOW_SECONDS = 150;   // this slow suggests time pressure

  const num = v => { const n = Number(v); return isFinite(n) ? n : 0; };
  const statusOf = (s) => (s && (s.status || s.result)) || '';
  const secondsOf = (s) => num(s && s.timing && s.timing.seconds) || num(s && s.seconds);
  const wrongCountOf = (rec, snap) => num(rec && rec.wrongCount) || num(snap && snap.wrongCount) || 1;

  /* Two options look alike when their bare text is very close once the leading
     A/B/C/D markers are stripped, the trap the naive student falls into. */
  function normOption(o) {
    return String(o == null ? '' : o).replace(/^\s*[A-Da-d][).:-]\s*/, '').replace(/\s+/g, '').toLowerCase();
  }
  function similarOptions(snap) {
    const opts = (snap && Array.isArray(snap.options)) ? snap.options.map(normOption) : [];
    if (opts.length < 2) return false;
    const chosen = num(snap.selectedIndex != null ? snap.selectedIndex : snap.selected);
    for (const o of opts) if (o && o !== opts[chosen] && o.length >= 2 && opts[chosen] && (o.includes(opts[chosen]) || opts[chosen].includes(o))) return true;
    return false;
  }

  /* Categorise a wrong answer. Only 'wrong' snapshots are classified; anything
     else returns null so callers never label a correct or skipped answer. */
  function categorize(input) {
    const snap = (input && input.snapshot) || input || {};
    if (statusOf(snap) && statusOf(snap) !== 'wrong') return null;
    const rec = (input && input.record) || snap;
    const wrongCount = wrongCountOf(rec, snap);
    const seconds = secondsOf(snap);
    const difficulty = String((input && input.difficulty) || (snap.question && snap.question.difficulty) || (input && input.question && input.question.difficulty) || '').toLowerCase();
    const qtype = String(((input && input.question) || (snap.question) || {}).type || '').toLowerCase();

    const signals = {
      wrongCount,
      seconds,
      fast: seconds > 0 && seconds <= FAST_SECONDS,
      slow: seconds >= SLOW_SECONDS,
      factual: qtype === 'factual',
      applied: qtype === 'application' || qtype === 'numerical' || qtype === 'conceptual',
      similarOptions: similarOptions(snap),
      lowDifficulty: difficulty === 'easy' || difficulty === 'medium'
    };

    let category = CATEGORY.CONCEPTUAL;
    if (wrongCount >= REPEATED_AT) category = CATEGORY.REPEATED;
    else if (signals.fast && signals.lowDifficulty) category = CATEGORY.CARELESS;
    else if (signals.slow) category = CATEGORY.TIME;
    else if (signals.factual) category = CATEGORY.MEMORY;
    else if (signals.similarOptions) category = CATEGORY.CONFUSION;

    return { category, wrongCount, signals };
  }

  function isRepeated(record) {
    return wrongCountOf(record, null) >= REPEATED_AT;
  }

  /* One ordinal ladder, so the app never mixes a numeric score with ad-hoc
     high/medium/low labels. A mastered mistake always sits at the bottom. */
  function priorityTier(record) {
    const rec = record || {};
    if (rec.mastered === true || rec.revisionStatus === 'mastered') return TIER.MASTERED;
    const wrong = wrongCountOf(rec, null);
    const attempts = num(rec.attempts) || num(rec.stats && rec.stats.attempts);
    const correct = num(rec.correct) || num(rec.stats && rec.stats.correct);
    const acc = attempts > 0 ? (correct / attempts) * 100 : num(rec.accuracy);
    if (wrong >= 4 || (attempts > 0 && acc < 50)) return TIER.CRITICAL;
    if (wrong >= 2 || (attempts > 0 && acc < 75)) return TIER.HIGH;
    return TIER.MEDIUM;
  }

  /* Advance a mistake after a revision attempt. Two correct answers in a row
     are enough to call it mastered; a fresh miss puts it straight back. */
  function nextRevisionState(record, outcome) {
    const rec = record || {};
    const correct = !!(outcome && (outcome.correct === true || outcome === true));
    const now = (outcome && outcome.at) || Date.now();
    const streak = correct ? num(rec.correctAfterMistake) + 1 : 0;
    const mastered = correct && streak >= MASTER_STREAK;
    const next = {
      correctAfterMistake: streak,
      revisionCount: num(rec.revisionCount) + 1,
      lastReviewedAt: now,
      status: mastered ? 'RESOLVED' : (correct ? 'IMPROVING' : 'UNRESOLVED'),
      mastered,
      revisionStatus: mastered ? 'mastered' : 'pending'
    };
    if (correct) next.lastCorrectAt = now;
    if (mastered) next.masteredAt = rec.masteredAt || now;
    else next.masteredAt = null;
    next.priorityTier = priorityTier({ ...rec, ...next });
    return next;
  }

  function label(category) {
    return {
      careless: 'অসতর্ক', conceptual: 'ধারণা', memory: 'মুখস্থ', confusion: 'বিভ্রান্তি',
      time: 'সময়', repeated: 'বারবার'
    }[category] || category || '';
  }
  function tierLabel(tier) {
    return { critical: 'জরুরি', high: 'উচ্চ', medium: 'মাঝারি', mastered: 'শেখা হয়েছে' }[tier] || tier || '';
  }

  return { CATEGORY, TIER, REPEATED_AT, MASTER_STREAK, categorize, isRepeated, priorityTier, nextRevisionState, label, tierLabel, __test: { normOption, similarOptions, secondsOf, wrongCountOf } };
});
