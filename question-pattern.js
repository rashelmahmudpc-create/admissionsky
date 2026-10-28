/* Admission Hub, P18 official question-pattern dataset.
 *
 * The engine (admission-intel-engine.js) already analyses the student's OWN
 * practice history. This file adds the other half of "question pattern": the
 * OFFICIAL test format a university publishes for each unit, how many marks,
 * how many minutes, MCQ vs written, and the negative-marking rule.
 *
 * Only values taken from a citable source appear here. Every entry carries the
 * `source` it came from and a `status`, so a provisional figure is never shown
 * as confirmed. A university or unit that is absent is reported by the engine
 * as "no official data", it is NEVER guessed (MASTER_KNOWLEDGE_BASE §43 "never
 * assume all universities use identical patterns" and §120 "do not invent
 * negative-marking values").
 *
 * Pure and dependency-free (like academic-catalog.js) so it runs in the browser
 * as window.AH_QuestionPattern and under node:test. It stores nothing and calls
 * no model. To add a university: add an entry with its source, bump `version`.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api; // node:test
  else root.AH_QuestionPattern = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Fields: total, mcq, written, mcqQuestions, mcqMinutes, writtenMinutes,
  // duration (whole test, minutes), negative (marks deducted per wrong MCQ),
  // pass (MCQ pass mark where the source states one). Any field left out is
  // simply not claimed.
  const P = (o) => Object.freeze(o);

  const SOURCES = {
    pa: 'prothomalo.com',
    cu: 'cu.ac.bd prospectus',
    sust: 'admission.sust.edu.bd prospectus',
    ku: 'admissionassistant.com.bd'
  };

  const UNIVERSITIES = {
    du: {
      // All units except Fine Arts and IBA: 60-mark MCQ (45 min) + 40-mark
      // written (45 min) = 90 minutes total. (Prothom Alo, DU 2025-26 decision.)
      default: P({ total: 100, mcq: 60, written: 40, mcqMinutes: 45, writtenMinutes: 45, negative: 0.25, source: SOURCES.pa, status: 'confirmed' }),
      E: P({ total: 100, mcq: 40, written: 60, mcqMinutes: 30, writtenMinutes: 60, negative: 0.25, source: SOURCES.pa, status: 'confirmed', note: 'চারুকলা ইউনিট, ৬০ নম্বরের অঙ্কন পরীক্ষা।' }),
      F: P({ total: 100, mcq: 70, written: 30, mcqMinutes: 90, writtenMinutes: 30, negative: 0.25, source: SOURCES.pa, status: 'confirmed', note: 'আইবিএ ইউনিট, ৩০ নম্বরের বর্ণনামূলক অংশ।' })
    },
    // 100 marks, 80 questions, one hour, MCQ only, 0.25 deducted per wrong.
    ru: { default: P({ total: 100, mcq: 100, mcqQuestions: 80, duration: 60, negative: 0.25, pass: 40, source: SOURCES.pa, status: 'confirmed' }) },
    // 100-mark MCQ paper, one hour, 0.25 deducted per wrong.
    cu: { default: P({ total: 100, mcq: 100, duration: 60, negative: 0.25, source: SOURCES.cu, status: 'confirmed' }) },
    // MCQ 60 (45 min) + written 40 (45 min); 0.25 deducted per wrong.
    ku: { default: P({ total: 100, mcq: 60, written: 40, mcqMinutes: 45, writtenMinutes: 45, duration: 90, negative: 0.25, source: SOURCES.ku, status: 'confirmed' }) },
    // MCQ paper of 80 marks; pass 35%. Negative-marking rule not stated in the
    // source used, so it is left out rather than assumed.
    ju: { default: P({ total: 80, mcq: 80, pass: 28, source: SOURCES.pa, status: 'partial' }) },
    // Per the SUST prospectus, total marks and question counts differ by unit,
    // so only the negative-marking rule is claimed here.
    su: { default: P({ negative: 0.2, source: SOURCES.sust, status: 'partial', note: 'ইউনিটভেদে মোট নম্বর ও প্রশ্নসংখ্যা ভিন্ন, অফিসিয়াল প্রসপেক্টাস দেখো।' }) },
    // Single admission test (no unit system): 100-mark MCQ, two hours,
    // Math 35 / Physics 35 / Chemistry 15 / English 15, 0.25 per wrong.
    iut: { default: P({ total: 100, mcq: 100, duration: 120, negative: 0.25, source: SOURCES.pa, status: 'confirmed', note: 'গণিত ৩৫, পদার্থবিজ্ঞান ৩৫, রসায়ন ১৫, ইংরেজি ১৫।' }) }
  };

  const DIFF_LABEL = { confirmed: 'নিশ্চিত', partial: 'আংশিক', provisional: 'সাময়িক' };

  // Official pattern for a university + unit. Falls back to the university's
  // default entry; returns null when nothing official is known.
  function forUnit(uniId, unitId) {
    const u = UNIVERSITIES[String(uniId || '').trim()];
    if (!u) return null;
    const key = String(unitId || '').trim();
    const hit = (key && u[key]) || u.default || null;
    return hit ? Object.assign({}, hit) : null;
  }

  function statusLabel(status) {
    return DIFF_LABEL[String(status || '')] || '';
  }

  return Object.freeze({
    version: 'ah-question-pattern-v1',
    generated: '2026-10-11',
    forUnit,
    statusLabel,
    universities: Object.keys(UNIVERSITIES)
  });
});
