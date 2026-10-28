/* Admission Hub, Academic Catalog Engine (code-native, zero-raster)
   Owner spec: units/subjects come from the selected university + admission
   session, NEVER a generic A/B/C/D assumption in the UI.
   Source of truth: official admission portals / prospectuses
   (admission.cu.ac.bd, admission.ru.ac.bd, apply.ku.ac.bd, …).
   Maintainable data layer: UI selectors (UniversitySelector / UnitSelector /
   SubjectSelector) consume window.AH_AcademicCatalog only.
   To add a session/university: edit the DATA below, bump `version`.        */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api; // node:test
  else root.AH_AcademicCatalog = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const norm = (s) => String(s || '').toLowerCase().replace(/[\s._-]+/g, '').trim();

  // Canonical subject pools (official eligibility sets per unit group).
  const SUBJECTS = {
    sciencePhysics: ['Physics', 'Chemistry', 'Math', 'Higher Math', 'English'],
    scienceBiology: ['Biology', 'Chemistry', 'Math', 'English'],
    commerce: ['English', 'Math', 'Accounting', 'Finance & Banking', 'Business Organization & Management', 'ICT'],
    humanities: ['Bangla', 'English', 'Economics', 'Civics', 'Logic', 'Islamic Studies', 'Geography', 'History', 'Social Work', 'Psychology']
  };
  const GROUPS = {
    sciencePhysics: { label: 'Science, Physics Group', subjects: SUBJECTS.sciencePhysics },
    scienceBiology: { label: 'Science, Biology Group', subjects: SUBJECTS.scienceBiology },
    commerce: { label: 'Business / Commerce', subjects: SUBJECTS.commerce },
    humanities: { label: 'Arts / Humanities', subjects: SUBJECTS.humanities }
  };
  const U = (id, group) => Object.freeze({ id: id, label: id, group });
  const UNITS = {
    // DU, 6 units (A, B, C, D, E, F)
    du: { A: U('A', 'sciencePhysics'), B: U('B', 'commerce'), C: U('C', 'humanities'), D: U('D', 'scienceBiology'), E: U('E', 'sciencePhysics'), F: U('F', 'commerce') },
    // RU, 3 units (A, B, C) per admission.ru.ac.bd
    ru: { A: U('A', 'sciencePhysics'), B: U('B', 'commerce'), C: U('C', 'humanities') },
    // CU, 7 units (A, B, B1, B2, C, D, D1) per admission.cu.ac.bd
    cu: { A: U('A', 'sciencePhysics'), B: U('B', 'commerce'), B1: U('B1', 'commerce'), B2: U('B2', 'commerce'), C: U('C', 'humanities'), D: U('D', 'scienceBiology'), D1: U('D1', 'scienceBiology') },
    // KU / JU / SU / BU, 5 units (A–E)
    ku: { A: U('A', 'sciencePhysics'), B: U('B', 'commerce'), C: U('C', 'humanities'), D: U('D', 'scienceBiology'), E: U('E', 'sciencePhysics') },
    ju: { A: U('A', 'sciencePhysics'), B: U('B', 'commerce'), C: U('C', 'humanities'), D: U('D', 'scienceBiology'), E: U('E', 'sciencePhysics') },
    su: { A: U('A', 'sciencePhysics'), B: U('B', 'commerce'), C: U('C', 'humanities'), D: U('D', 'scienceBiology'), E: U('E', 'sciencePhysics') },
    bu: { A: U('A', 'sciencePhysics'), B: U('B', 'commerce'), C: U('C', 'humanities'), D: U('D', 'scienceBiology'), E: U('E', 'sciencePhysics') },
    // BUET / IUT, single admission, no unit system (never A/B/C/D)
    buet: { BUET: U('BUET', 'sciencePhysics') },
    iut: { IUT: U('IUT', 'sciencePhysics') }
  };
  const sameForAllSessions = (map) => ({ '2025-26': map, '2026-27': map });

  const UNIVERSITIES = [
    { id: 'du', name: 'University of Dhaka', aliases: ['DU', 'ঢাকা বিশ্ববিদ্যালয়', 'ঢাকা', 'Dhaka'], units: sameForAllSessions(UNITS.du) },
    { id: 'ru', name: 'Rajshahi University', aliases: ['RU', 'রাজশাহী বিশ্ববিদ্যালয়', 'রাজশাহী', 'Rajshahi'], units: sameForAllSessions(UNITS.ru) },
    { id: 'cu', name: 'University of Chittagong', aliases: ['CU', 'চট্টগ্রাম বিশ্ববিদ্যালয়', 'চট্টিগ্রাম', 'চট্টগ্রাম', 'Chittagong', 'Chittagong U'], units: sameForAllSessions(UNITS.cu) },
    { id: 'ku', name: 'Khulna University', aliases: ['KU', 'খুলনা বিশ্ববিদ্যালয়', 'খুলনা', 'Khulna'], units: sameForAllSessions(UNITS.ku) },
    { id: 'ju', name: 'Jagannath University', aliases: ['JU', 'জগন্নাথ বিশ্ববিদ্যালয়', 'জগন্নাথ', 'Jagannath'], units: sameForAllSessions(UNITS.ju) },
    { id: 'su', name: 'Shahjalal University of Science and Technology', aliases: ['SUST', 'শাহজালাল বিজ্ঞান ও প্রযুক্তি বিশ্ববিদ্যালয়', 'শাহজালাল', 'Sylhet', 'সিলেট'], units: sameForAllSessions(UNITS.su) },
    { id: 'bu', name: 'University of Barishal', aliases: ['BU', 'বরিশাল বিশ্ববিদ্যালয়', 'বরিশাল', 'Barishal', 'Barisal'], units: sameForAllSessions(UNITS.bu) },
    { id: 'buet', name: 'BUET', aliases: ['বুয়েট', 'BUET', 'Bangladesh University of Engineering and Technology'], units: sameForAllSessions(UNITS.buet) },
    { id: 'iut', name: 'IUT', aliases: ['ইউটিউ', 'IUT', 'Islamic University of Technology'], units: sameForAllSessions(UNITS.iut) }
  ];

  // 2025-26 confirmed from current prospectuses; 2026-27 provisional v1 -
  // same unit structure until the next official prospectus is published.
  const SESSIONS = [
    { id: '2025-26', label: '2025-26', status: 'confirmed' },
    { id: '2026-27', label: '2026-27', status: 'provisional' }
  ];

  function listSessions() {
    return SESSIONS.map((s) => Object.assign({}, s));
  }

  function getUniversity(idOrQuery) {
    if (!idOrQuery) return null;
    const q = String(idOrQuery).trim();
    if (!q) return null;
    const byId = UNIVERSITIES.find((u) => u.id === q) || null;
    if (byId) return byId;
    const hit = searchUniversities(q, 1)[0];
    return hit ? hit.university : null;
  }

  // Bangla + English alias search. Rank: exact alias > name startsWith > substring.
  function searchUniversities(query, limit = 5) {
    const q = norm(query);
    if (!q) return UNIVERSITIES.slice(0, limit).map((u) => ({ university: u, score: 0 }));
    const scored = [];
    for (const u of UNIVERSITIES) {
      const nameN = norm(u.name);
      let score = 0;
      for (const a of u.aliases) {
        const an = norm(a);
        if (!an) continue;
        if (an === q) { score = 100; break; }
        if (an.startsWith(q)) score = Math.max(score, 90);
        else if (an.includes(q)) score = Math.max(score, 60);
      }
      if (!score) {
        if (nameN.startsWith(q)) score = 80;
        else if (nameN.includes(q)) score = 50;
      }
      if (score) scored.push({ university: u, score });
    }
    scored.sort((a, b) => b.score - a.score || a.university.name.localeCompare(b.university.name));
    return scored.slice(0, Math.max(0, Number(limit) || 5));
  }

  // Units ONLY from the selected university + session (no generic A/B/C/D).
  function unitsFor(uniId, sessionId) {
    const u = getUniversity(uniId);
    if (!u) return [];
    const map = u.units && u.units[String(sessionId || '')];
    if (!map) return [];
    return Object.keys(map).map((id) => Object.assign({}, map[id])).sort((a, b) => a.label.localeCompare(b.label, 'en', { numeric: true }));
  }

  function unitFor(uniId, sessionId, unitId) {
    return unitsFor(uniId, sessionId).find((x) => x.id === String(unitId || '')) || null;
  }

  // Official eligible subjects for university + unit + session.
  function subjectsFor(uniId, sessionId, unitId) {
    const u = unitFor(uniId, sessionId, unitId);
    if (!u) return [];
    return (GROUPS[u.group] || { subjects: [] }).subjects.slice();
  }

  function groupLabel(uniId, sessionId, unitId) {
    const u = unitFor(uniId, sessionId, unitId);
    if (!u) return '';
    return (GROUPS[u.group] || { label: '' }).label;
  }

  return Object.freeze({
    version: 'ah-acad-catalog-v1',
    generated: '2026-09-15',
    sources: ['admission.cu.ac.bd', 'admission.ru.ac.bd', 'apply.ku.ac.bd', 'admission.du.ac.bd'],
    listSessions,
    searchUniversities,
    getUniversity,
    unitsFor,
    unitFor,
    subjectsFor,
    groupLabel
  });
});
