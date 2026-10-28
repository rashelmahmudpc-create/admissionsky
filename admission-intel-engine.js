/* Admission Hub, P18 Admission Intelligence Engine.
 *
 * Turns what the app already knows about a student, their chosen university,
 * unit and session, plus their own exam history, into admission intelligence:
 * which of the official eligible subjects are covered and which are untouched,
 * which topics are weak, what question pattern their history shows, and a
 * prioritised revision plan that lands on the exam date.
 *
 * Pure and dependency-free (like adaptive-engine.js / study-plan-engine.js), so
 * it runs in the browser as window.AhAdmissionIntel and under node:test. It
 * stores nothing and calls no model.
 *
 * The university/unit/subject map is NOT hard-coded here: it is read from
 * window.AH_AcademicCatalog (academic-catalog.js), the single source of truth
 * already maintained against the official prospectuses. If that catalog is
 * absent the engine degrades to history-only analysis rather than inventing a
 * unit structure.
 *
 * HARD POLICY (locked at blueprint level): this engine never promises a rank, a
 * pass, or a seat. Every output is an observation about the student's own
 * practice data. `guaranteeSafe()` exists so the UI can assert that.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.AhAdmissionIntel = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DIFFS = ['easy', 'medium', 'hard'];
  const CONFIDENT_AT = 6;
  const DAY_MS = 86400000;

  const num = (v) => { const n = Number(v); return isFinite(n) ? n : 0; };
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const pct = (a, b) => (b > 0 ? Math.round((a / b) * 100) : 0);

  /* ── history → flat rows (same shape study-plan-engine uses) ── */
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
          difficulty: String((q && q.difficulty) || 'medium').toLowerCase(),
          correct: s.status === 'correct'
        });
      }
    }
    return rows;
  }

  /* ── the official map, read from the catalog (never re-declared here) ── */
  function resolveMap(catalog, goal, session) {
    const uni = goal && goal.university ? String(goal.university).trim() : '';
    const unit = goal && goal.unit ? String(goal.unit).trim() : '';
    if (!catalog || typeof catalog.getUniversity !== 'function') {
      return { ok: false, reason: 'no-catalog', university: null, unit: null, subjects: [] };
    }
    const u = catalog.getUniversity(uni);
    if (!u) {
      return { ok: false, reason: uni ? 'unknown-university' : 'no-university', university: null, unit: null, subjects: [] };
    }
    const sessions = typeof catalog.listSessions === 'function' ? catalog.listSessions() : [];
    const sess = session || (sessions[0] && sessions[0].id) || '2025-26';
    const units = typeof catalog.unitsFor === 'function' ? catalog.unitsFor(u.id, sess) : [];
    // The stored goal keeps a label like "A Unit"; the catalog keys on "A".
    const wanted = unit.replace(/\s*unit\s*/i, '').trim();
    const match = units.find((x) => x.id === wanted || x.label === wanted) || null;
    if (!match) {
      return { ok: false, reason: unit ? 'unknown-unit' : 'no-unit', university: u, unit: null, subjects: [], session: sess, units };
    }
    const subjects = typeof catalog.subjectsFor === 'function' ? catalog.subjectsFor(u.id, sess, match.id) : [];
    const group = typeof catalog.groupLabel === 'function' ? catalog.groupLabel(u.id, sess, match.id) : '';
    return { ok: true, university: u, unit: match, subjects, group, session: sess, units };
  }

  /* ── per-topic ability from the student's own answers ── */
  function topicStats(rows, topics) {
    const by = new Map();
    for (const r of rows) {
      const t = by.get(r.topicId) || { topicId: r.topicId, asked: 0, correct: 0 };
      t.asked += 1;
      if (r.correct) t.correct += 1;
      by.set(r.topicId, t);
    }
    const nameOf = new Map((Array.isArray(topics) ? topics : []).map((t) => [t.id, t.name]));
    return [...by.values()].map((t) => ({
      topicId: t.topicId,
      name: nameOf.get(t.topicId) || t.topicId,
      asked: t.asked,
      correct: t.correct,
      accuracy: pct(t.correct, t.asked),
      confident: t.asked >= CONFIDENT_AT
    })).sort((a, b) => a.accuracy - b.accuracy || b.asked - a.asked);
  }

  /* ── what the student's history says about the question pattern ── */
  function pattern(rows) {
    const by = { easy: { asked: 0, correct: 0 }, medium: { asked: 0, correct: 0 }, hard: { asked: 0, correct: 0 } };
    for (const r of rows) {
      const d = DIFFS.includes(r.difficulty) ? r.difficulty : 'medium';
      by[d].asked += 1;
      if (r.correct) by[d].correct += 1;
    }
    return DIFFS.map((d) => ({
      difficulty: d, asked: by[d].asked, correct: by[d].correct,
      accuracy: pct(by[d].correct, by[d].asked),
      attempted: by[d].asked > 0
    }));
  }

  /* ── subject coverage: official eligible subjects vs topics actually practised ── */
  function coverage(rows, topics, subjects) {
    const nameOf = new Map((Array.isArray(topics) ? topics : []).map((t) => [t.id, String(t.name || t.id)]));
    const subjectsSeen = new Set();
    for (const t of nameOf.values()) {
      for (const s of subjects) {
        if (t.toLowerCase().includes(String(s).toLowerCase())) { subjectsSeen.add(s); break; }
      }
    }
    const touched = new Set(rows.map((r) => r.topicId));
    // A subject counts as practised only when a topic mapped to it was answered.
    const practised = new Set();
    for (const t of touched) {
      const n = nameOf.get(t);
      if (!n) continue;
      for (const s of subjects) if (n.toLowerCase().includes(String(s).toLowerCase())) practised.add(s);
    }
    return {
      subjects: subjects.map((s) => ({ subject: s, practised: practised.has(s) })),
      covered: practised.size,
      total: subjects.length,
      percent: pct(practised.size, subjects.length),
      untouched: subjects.filter((s) => !practised.has(s))
    };
  }

  /* ── a plan that lands on the exam date, weakest topics first ── */
  function revisionPlan(stats, coverageInfo, daysLeft, opts) {
    const maxDays = clamp(Math.round(num((opts && opts.days) || daysLeft || 7)) || 7, 1, 14);
    const perDay = clamp(Math.round(num((opts && opts.perDay) || 25)) || 25, 5, 100);
    const pool = stats.slice();
    // Unpractised official subjects are a priority in their own right, but we
    // cannot invent topics for them, we name the subject and say "শুরু করো".
    const untouched = coverageInfo.untouched.slice();
    const days = [];
    let cursor = 0;
    for (let d = 0; d < maxDays; d++) {
      const focus = pool[cursor % Math.max(1, pool.length)] || null;
      const extraSubject = d < untouched.length ? untouched[d] : null;
      if (!focus && !extraSubject) break;
      const blocks = [];
      if (focus) {
        blocks.push({
          topicId: focus.topicId, name: focus.name, kind: focus.accuracy < 50 ? 'weak' : focus.accuracy < 75 ? 'steady' : 'strong',
          accuracy: focus.accuracy, questions: perDay,
          why: focus.confident
            ? `তোমার ${focus.asked}টি প্রশ্নে দক্ষতা ${focus.accuracy}%, এখানে সময় দিলে সবচেয়ে বেশি লাভ।`
            : `মাত্র ${focus.asked}টি প্রশ্ন হয়েছে, তাই এখনো নিশ্চিত নই, বেশি অভ্যাস দরকার।`
        });
      }
      if (extraSubject) {
        blocks.push({ subject: extraSubject, kind: 'new', questions: 0, why: 'এই সাবজেক্টে এখনো কোনো প্রশ্ন করোনি, শুরু করা দরকার।' });
      }
      days.push({ day: d + 1, blocks });
      if (focus) cursor += 1;
    }
    return days;
  }

  function message(rows, coverageInfo, stats, daysLeft) {
    if (!rows.length) return 'এখনো পরীক্ষার ডেটা নেই, কয়েকটি প্রশ্ন করলেই তোমার জন্য পরিকল্পনা সাজাতে পারব।';
    const weakest = stats.find((s) => s.confident) || stats[0];
    const bits = [`তোমার ${rows.length}টি উত্তর থেকে বলছি`];
    if (coverageInfo.total) bits.push(`অফিসিয়াল ${coverageInfo.total}টি সাবজেক্টের মধ্যে ${coverageInfo.covered}টিতে অভ্যাস হয়েছে`);
    if (weakest) bits.push(`সবচেয়ে দুর্বল ${weakest.name} (${weakest.accuracy}%)`);
    if (num(daysLeft) > 0) bits.push(`পরীক্ষার আগে ${Math.round(daysLeft)} দিন বাকি`);
    return bits.join(', ') + '।';
  }

  /* ── the policy lock, exposed so the UI can assert it ── */
  const BANNED = [/র‍্যাঙ্ক\s*নিশ্চিত/, /পাসের\s*নিশ্চয়তা/, /নিশ্চিত\s*ভর্তি/, /guarantee/i, /নিশ্চিত\s*র‍্যাঙ্ক/];
  function guaranteeSafe(text) {
    const t = String(text == null ? '' : text);
    return !BANNED.some((re) => re.test(t));
  }

  function build(input) {
    const o = input || {};
    const results = Array.isArray(o.results) ? o.results : [];
    const questions = Array.isArray(o.questions) ? o.questions : [];
    const topics = Array.isArray(o.topics) ? o.topics : [];
    const goal = o.goal || {};
    const catalog = o.catalog || null;
    const patterns = o.patterns || null;
    const session = o.session || null;

    const questionsById = new Map(questions.map((q) => [q.id, q]));
    const rows = rowsOf(results, questionsById);
    const map = resolveMap(catalog, goal, session);
    const stats = topicStats(rows, topics);
    const coverageInfo = coverage(rows, topics, map.subjects);
    const patt = pattern(rows);
    // Official format comes only from the dataset; a missing entry stays null
    // so the panel says "no official data" instead of inventing a pattern.
    const official = (map.ok && patterns && typeof patterns.forUnit === 'function')
      ? patterns.forUnit(map.university.id, map.unit.id) : null;
    const daysLeft = num(goal.daysLeft);
    const plan = revisionPlan(stats, coverageInfo, daysLeft, o.opts);

    return {
      university: map.university,
      unit: map.unit,
      group: map.group || '',
      session: map.session || '',
      mapReason: map.ok ? 'ok' : map.reason,
      eligibleSubjects: map.subjects,
      coverage: coverageInfo,
      topics: stats,
      pattern: patt,
      official,
      plan,
      daysLeft,
      totals: { answered: rows.length, topics: stats.length, days: plan.length },
      message: message(rows, coverageInfo, stats, daysLeft)
    };
  }

  return { build, topicStats, pattern, coverage, revisionPlan, guaranteeSafe, resolveMap };
});
