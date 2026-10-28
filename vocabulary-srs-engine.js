/* Admission Hub, P12 Smart Vocabulary Engine.
 *
 * Pure, dependency-free spaced-repetition core (like mistake-engine.js /
 * adaptive-engine.js), so it runs in the browser as window.AhVocabSrs and under
 * node:test for verification. It owns no storage: the tool keeps the per-word
 * state and hands it in. The engine only decides *what* to review and *when*.
 *
 * Model: a compact SM-2. Each vocab word is a card with an ease factor, an
 * interval in days, a repetition count and a due timestamp. A grade (Again /
 * Hard / Good / Easy) advances or resets it. A word that is failed repeatedly
 * becomes a "leech", the weak-word signal the dashboard surfaces.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.AhVocabSrs = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DAY = 86400000;
  const MIN_EASE = 1.3;
  const START_EASE = 2.5;
  const MASTERED_INTERVAL = 21;   // days at which a word is "mastered"
  const LEECH_LAPSES = 3;         // failures before a word is flagged weak

  const GRADE = Object.freeze({ AGAIN: 0, HARD: 1, GOOD: 2, EASY: 3 });

  const num = (v, d = 0) => { const n = Number(v); return isFinite(n) ? n : d; };
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const now = () => Date.now();

  function keyOf(word) { return String(word || '').trim().toLowerCase(); }

  /* A brand-new card: due immediately, repetitions 0. */
  function freshCard(word, at = now()) {
    return {
      word: String(word || '').trim(),
      key: keyOf(word),
      ease: START_EASE,
      interval: 0,
      repetitions: 0,
      lapses: 0,
      dueAt: at,
      lastGrade: null,
      lastReviewedAt: 0,
      reviews: 0,
      correct: 0,
    };
  }

  function normalizeCard(raw) {
    const card = freshCard(raw && raw.word);
    if (!raw) return card;
    card.ease = clamp(num(raw.ease, START_EASE), MIN_EASE, 3.2);
    card.interval = Math.max(0, num(raw.interval, 0));
    card.repetitions = Math.max(0, num(raw.repetitions, 0));
    card.lapses = Math.max(0, num(raw.lapses, 0));
    card.dueAt = num(raw.dueAt, now());
    card.lastGrade = raw.lastGrade == null ? null : num(raw.lastGrade);
    card.lastReviewedAt = num(raw.lastReviewedAt, 0);
    card.reviews = Math.max(0, num(raw.reviews, 0));
    card.correct = Math.max(0, num(raw.correct, 0));
    return card;
  }

  /* Advance a card by one graded review. Returns a NEW card (no mutation). */
  function schedule(card, grade, at = now()) {
    const c = normalizeCard(card);
    const g = clamp(num(grade, GRADE.GOOD), 0, 3);
    c.reviews += 1;
    c.lastGrade = g;
    c.lastReviewedAt = at;

    if (g === GRADE.AGAIN) {
      c.repetitions = 0;
      c.lapses += 1;
      c.interval = 0;                       // relearn today
      c.ease = clamp(c.ease - 0.2, MIN_EASE, 3.2);
      c.dueAt = at + 10 * 60000;            // 10 minutes, same session
      return c;
    }

    c.correct += 1;
    if (g === GRADE.HARD) c.ease = clamp(c.ease - 0.15, MIN_EASE, 3.2);
    else if (g === GRADE.EASY) c.ease = clamp(c.ease + 0.15, MIN_EASE, 3.2);

    c.repetitions += 1;
    if (c.repetitions === 1) c.interval = 1;
    else if (c.repetitions === 2) c.interval = 6;
    else c.interval = Math.max(1, Math.round(c.interval * c.ease * (g === GRADE.HARD ? 0.6 : g === GRADE.EASY ? 1.3 : 1)));
    c.interval = Math.min(c.interval, 3650);
    c.dueAt = at + c.interval * DAY;
    return c;
  }

  const isDue = (card, at = now()) => normalizeCard(card).dueAt <= at;
  const isMastered = card => normalizeCard(card).interval >= MASTERED_INTERVAL;
  const isLeech = card => normalizeCard(card).lapses >= LEECH_LAPSES;

  /* A 0–100 strength score for the dashboard, from interval + accuracy. */
  function strength(card) {
    const c = normalizeCard(card);
    const acc = c.reviews ? c.correct / c.reviews : 0;
    const ivlScore = clamp(c.interval / MASTERED_INTERVAL, 0, 1);
    return Math.round(clamp(ivlScore * 70 + acc * 30, 0, 100));
  }

  /* Turn one practice answer into a grade: a correct answer grades Good, unless
   * the caller passes a speed hint (fast+fresh => Easy, slow => Hard). */
  function gradeFor(isCorrect, opts = {}) {
    if (!isCorrect) return GRADE.AGAIN;
    if (opts.easy) return GRADE.EASY;
    if (opts.hard) return GRADE.HARD;
    return GRADE.GOOD;
  }

  /* Build the day's review plan: due cards first (most overdue first), then the
   * weakest, then brand-new words up to the requested size. */
  function buildDailyPlan(words, states, opts = {}) {
    const at = num(opts.now, now());
    const size = Math.max(1, num(opts.size, 20));
    const stateOf = k => (states && (states[k] || states[keyOf(k)])) || null;
    const cards = (words || []).map(w => {
      const word = typeof w === 'string' ? w : w && w.word;
      const state = stateOf(word);
      return state ? normalizeCard(state) : freshCard(word, at);
    });
    const seen = new Set();
    const uniq = [];
    for (const c of cards) { if (c.key && !seen.has(c.key)) { seen.add(c.key); uniq.push(c); } }

    const due = uniq.filter(c => c.reviews > 0 && c.dueAt <= at)
      .sort((a, b) => a.dueAt - b.dueAt);
    const weak = uniq.filter(c => c.reviews > 0 && c.dueAt > at && (isLeech(c) || strength(c) < 45))
      .sort((a, b) => strength(a) - strength(b));
    const fresh = uniq.filter(c => c.reviews === 0);

    const out = [];
    const push = list => { for (const c of list) { if (out.length >= size) return; if (!out.includes(c)) out.push(c); } };
    push(due); push(weak); push(fresh);
    return out.slice(0, size);
  }

  /* Review counts for the dashboard: due / learning / mastered / weak. */
  function summarize(words, states, at = now()) {
    const stateOf = k => (states && (states[k] || states[keyOf(k)])) || null;
    const s = { total: 0, due: 0, learning: 0, mastered: 0, weak: 0 };
    const seen = new Set();
    for (const w of words || []) {
      const word = typeof w === 'string' ? w : w && w.word;
      const k = keyOf(word);
      if (!k || seen.has(k)) continue;
      seen.add(k);
      const raw = stateOf(word);
      s.total += 1;
      if (!raw || raw.reviews === 0) continue;
      const c = normalizeCard(raw);
      if (isMastered(c)) s.mastered += 1;
      else s.learning += 1;
      if (c.dueAt <= at) s.due += 1;
      if (isLeech(c)) s.weak += 1;
    }
    return s;
  }

  /* Mastery grouped by a bucket (vocab letter/category), for the dashboard. */
  function masteryByBucket(records, states) {
    const buckets = new Map();
    for (const r of records || []) {
      const cat = String((r && r.category) || '#').toUpperCase();
      if (!buckets.has(cat)) buckets.set(cat, { bucket: cat, total: 0, mastered: 0, weak: 0, strengthSum: 0 });
      const b = buckets.get(cat);
      const raw = states && (states[keyOf(r.word)] || states[r.word]);
      b.total += 1;
      if (raw && raw.reviews > 0) {
        const c = normalizeCard(raw);
        if (isMastered(c)) b.mastered += 1;
        if (isLeech(c)) b.weak += 1;
        b.strengthSum += strength(c);
      }
    }
    return [...buckets.values()].map(b => ({
      bucket: b.bucket,
      total: b.total,
      mastered: b.mastered,
      weak: b.weak,
      mastery: b.total ? Math.round((b.mastered / b.total) * 100) : 0,
      strength: b.total ? Math.round(b.strengthSum / b.total) : 0,
    })).sort((a, b) => a.bucket.localeCompare(b.bucket));
  }

  const shuffle = (arr, rnd = Math.random) => {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  };

  /* Build one multiple-choice question for a word. mode: meaning | synonym | antonym. */
  function buildQuestion(record, pool, mode = 'meaning', rnd = Math.random) {
    if (!record || !record.word) return null;
    const distinct = new Set();
    const pick = [];
    const addOption = (text, correct) => {
      const t = String(text || '').trim();
      if (!t || distinct.has(t)) return;
      distinct.add(t); pick.push({ text: t, correct: !!correct });
    };

    if (mode === 'synonym' || mode === 'antonym') {
      const rels = Array.isArray(record[mode === 'synonym' ? 'synonyms' : 'antonyms']) ? record[mode === 'synonym' ? 'synonyms' : 'antonyms'] : [];
      const correct = rels[Math.floor(rnd() * rels.length)];
      if (!correct || !correct.word) return null;
      addOption(correct.word, true);
      const others = [];
      for (const r of pool || []) {
        if (r === record || keyOf(r.word) === keyOf(record.word)) continue;
        for (const rel of (r[mode === 'synonym' ? 'synonyms' : 'antonyms'] || [])) others.push(rel.word);
      }
      for (const o of shuffle(others, rnd)) { if (pick.length >= 4) break; addOption(o, false); }
      return { word: record.word, mode, prompt: record.word, options: shuffle(pick, rnd), answerWord: correct.word };
    }

    // meaning: prompt = the synonym, answer = the meaning
    addOption(record.meaning, true);
    for (const r of pool || []) {
      if (pick.length >= 4) break;
      if (r === record || keyOf(r.word) === keyOf(record.word)) continue;
      addOption(r.meaning, false);
    }
    if (pick.length < 2) return null;
    return { word: record.word, mode: 'meaning', prompt: record.word, options: shuffle(pick, rnd), answerWord: record.meaning };
  }

  /* Grade a picked option index against the built question. */
  function checkAnswer(question, pickedIndex) {
    if (!question || !Array.isArray(question.options)) return false;
    const opt = question.options[num(pickedIndex, -1)];
    return !!(opt && opt.correct);
  }

  return {
    DAY, GRADE, START_EASE, MASTERED_INTERVAL, LEECH_LAPSES,
    freshCard, normalizeCard, schedule, isDue, isMastered, isLeech,
    strength, gradeFor, buildDailyPlan, summarize, masteryByBucket,
    buildQuestion, checkAnswer, keyOf, shuffle,
  };
});
