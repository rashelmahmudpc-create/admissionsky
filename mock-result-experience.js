/*
 * Mock + Result Experience, Admission Hub
 * Design reminder: preserve Question Review markup and all existing result actions.
 * This layer only locks Mock choices and replaces the result-summary area above review.
 */
(() => {
  'use strict';

  const safe = (value) => typeof window.esc === 'function' ? window.esc(String(value ?? '')) : String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c]);
  const pct = (row) => {
    const attempted = Number(row?.correct || 0) + Number(row?.wrong || 0);
    return attempted ? Math.round(Number(row.correct || 0) / attempted * 100) : 0;
  };
  const average = (rows) => rows.length ? Math.round(rows.reduce((sum, value) => sum + Number(value || 0), 0) / rows.length) : null;
  const hash = (value) => [...String(value || '')].reduce((total, char) => ((total << 5) - total + char.charCodeAt(0)) | 0, 0) >>> 0;
  const toNum = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  const analysisRows = () => Array.isArray(window.RESULT_ANALYSIS_500) ? window.RESULT_ANALYSIS_500 : [];
  const defaultAnalysisRows = () => {
    const rows = analysisRows();
    if (rows.length <= 200) return rows;
    const picked = [];
    [...new Set(rows.map(row => String(row?.id || '').charAt(0)).filter(Boolean))].forEach(family => {
      const familyRows = rows.filter(row => String(row?.id || '').charAt(0) === family);
      const take = Math.min(40, familyRows.length);
      for (let i = 0; i < take; i += 1) picked.push(familyRows[Math.round(i * (familyRows.length - 1) / Math.max(1, take - 1))]);
    });
    return picked.length === 200 ? picked : rows.slice(0, 200);
  };
  const ruleNumber = id => Number(String(id || '').slice(1)) || 0;
  const round2 = value => Math.round(toNum(value) * 100) / 100;

  function resultMetrics(result) {
    const total = Math.max(0, toNum(result?.questionCount || result?.totalQuestions || result?.snapshot?.length));
    const correct = Math.max(0, toNum(result?.correct));
    const wrong = Math.max(0, toNum(result?.wrong));
    const skipped = Math.max(0, toNum(result?.skipped, Math.max(0, total - correct - wrong)));
    const attempted = correct + wrong;
    const marks = Math.max(0.01, toNum(result?.configuration?.marksPerQ || result?.marksPerQ, 1));
    const maxScore = total * marks;
    const positive = toNum(result?.positive, correct * marks);
    const negative = Math.max(0, toNum(result?.negativeMarks ?? result?.negative));
    const score = toNum(result?.score, positive - negative);
    return { total, correct, wrong, skipped, attempted, accuracy: attempted ? correct / attempted * 100 : 0, attemptRate: total ? attempted / total * 100 : 0, marks, maxScore, positive, negative, score, netPct: maxScore ? score / maxScore * 100 : 0, penaltyPct: maxScore ? negative / maxScore * 100 : 0 };
  }
  function bandIndex(value, thresholds) {
    const n = toNum(value);
    for (let i = 0; i < thresholds.length; i += 1) if (n < thresholds[i]) return i;
    return thresholds.length;
  }
  function scoreBand(m) { return Math.min(9, bandIndex(m.netPct, [20,30,40,50,60,70,80,90,100])); }
  function accuracyBand(m) { return Math.min(9, bandIndex(m.accuracy, [20,30,40,50,60,70,80,90,96])); }
  function penaltyBand(m) { return Math.min(9, bandIndex(m.penaltyPct, [0.01,2,4,6,8,10,15,20,30])); }
  function coverageBand(m) { return Math.min(9, bandIndex(m.attemptRate, [20,30,40,50,60,70,80,90,100])); }
  function timeBand(result) {
    const m = resultMetrics(result);
    const duration = toNum(result?.duration);
    const ratio = duration > 0 ? toNum(result?.timeUsed) / Math.max(1, duration) * 100 : (m.total ? toNum(result?.timeUsed) / Math.max(1, m.total) : 0);
    return Math.min(9, duration > 0 ? bandIndex(ratio, [20,30,40,50,60,70,80,90,100]) : bandIndex(ratio, [15,30,45,60,75,90,120,150,180]));
  }
  function topicPattern(result, m) {
    const rows = breakdown(result, 'topic').filter(row => row.correct + row.wrong > 0).map(row => ({ ...row, acc: row.correct / Math.max(1, row.correct + row.wrong) * 100 }));
    if (!rows.length) return 5;
    const low = rows.filter(row => row.acc < 50).length;
    const strong = rows.filter(row => row.acc >= 80).length;
    const average = rows.reduce((sum, row) => sum + row.acc, 0) / rows.length;
    if (rows.every(row => row.acc < 50)) return 0;
    if (strong === 1 && low === 0) return 1;
    if (strong >= 1 && low === 0 && rows.length <= 3) return 2;
    if (low === 1) return 6;
    if (low === 2) return 7;
    if (average >= 80 && m.netPct < 60) return 8;
    if (average >= 50 && m.netPct >= 50) return 9;
    return 5;
  }
  function consistencyPattern(result, m) {
    const rows = Array.isArray(result?.snapshot) ? result.snapshot : [];
    if (rows.length < 5) return 5;
    const size = Math.max(1, Math.ceil(rows.length / 5));
    const accuracyOf = part => { const answered = part.filter(row => row.status === 'correct' || row.status === 'wrong'); return answered.length ? part.filter(row => row.status === 'correct').length / answered.length * 100 : null; };
    const parts = Array.from({ length: 5 }, (_, index) => rows.slice(index * size, (index + 1) * size));
    const values = parts.map(accuracyOf).filter(value => value !== null);
    if (values.length < 2) return 5;
    const first = values[0], last = values.at(-1), spread = Math.max(...values) - Math.min(...values);
    if (last <= first - 15) return 0;
    if (last >= first + 15) return 1;
    if (first < 50 && last > first + 10) return 2;
    if (first >= 80 && last < first - 10) return 3;
    if (spread >= 25) return 4;
    if (toNum(result?.averageTimePerQuestion || result?.avgTimePerQuestion) > 60) return 5;
    if (m.accuracy >= 70 && toNum(result?.timeUsed) > 0 && m.attemptRate >= 80) return 6;
    if (m.attemptRate >= 80 && m.accuracy < 70) return 7;
    if (m.wrong > 0 && m.penaltyPct >= 8) return 8;
    if (m.accuracy >= 85) return 9;
    return 5;
  }
  function behaviourPattern(m, result) {
    if (m.netPct < 0) return 9;
    if (m.attemptRate >= 80 && m.accuracy < 50) return 0;
    if (m.attemptRate < 50 && m.accuracy >= 80) return 1;
    if (m.attemptRate >= 80 && m.accuracy >= 80) return 2;
    if (m.attemptRate < 50 && m.accuracy < 50) return 3;
    if (m.skipped / Math.max(1, m.total) >= 0.4 && m.penaltyPct < 4) return 4;
    if (m.skipped / Math.max(1, m.total) < 0.1 && m.penaltyPct >= 8) return 5;
    const topics = breakdown(result, 'topic');
    const topicLoads = topics.map(row => row.wrong + row.skipped).sort((a, b) => b - a);
    if (topicLoads[0] && topicLoads[0] >= Math.max(3, m.wrong + m.skipped) * 0.6) return 7;
    if (m.netPct > 0 && m.accuracy < 60) return 8;
    return 6;
  }
  function matchedAnalyses(result) {
    const m = resultMetrics(result);
    const ids = [
      `A${String(scoreBand(m) * 10 + accuracyBand(m) + 1).padStart(3, '0')}`,
      `B${String(scoreBand(m) * 10 + penaltyBand(m) + 1).padStart(3, '0')}`,
      `C${String(coverageBand(m) * 10 + timeBand(result) + 1).padStart(3, '0')}`,
      `D${String(topicPattern(result, m) * 10 + consistencyPattern(result, m) + 1).padStart(3, '0')}`,
      `E${String(behaviourPattern(m, result) * 10 + penaltyBand(m) + 1).padStart(3, '0')}`
    ];
    const defaults = defaultAnalysisRows();
    const byId = new Map(defaults.map(row => [row.id, row]));
    return [...new Set(ids)].map(id => {
      if (byId.has(id)) return byId.get(id);
      const family = String(id || '').charAt(0);
      return defaults.filter(row => String(row?.id || '').charAt(0) === family).sort((a, b) => Math.abs(ruleNumber(a.id) - ruleNumber(id)) - Math.abs(ruleNumber(b.id) - ruleNumber(id)))[0] || null;
    }).filter(Boolean);
  }

  const reportOpeners = [
    'এই ফলাফলের মূল ছবি হলো', 'বর্তমান পরীক্ষার ডেটা বলছে', 'এই রিপোর্টে সবচেয়ে গুরুত্বপূর্ণ সংকেত', 'স্কোরকার্ড থেকে স্পষ্ট',
    'আজকের পরীক্ষার বাস্তব চিত্র', 'এই attempt-এর সংক্ষিপ্ত পাঠ', 'প্রশ্নভিত্তিক তথ্যের সারাংশ', 'এই ফলাফলে দেখা যাচ্ছে'
  ];
  const reportSignals = [
    '{overall}', '{participation}', '{comparison}', '{subjectSignal}', '{topicSignal}', '{paceSignal}'
  ];
  const reportActions = [
    'পরের পরীক্ষায় এই তথ্যটিই লক্ষ্য ধরে রাখো।', 'এই ফলাফলের ভুল ও উত্তরহীন অংশ আগে review করো।',
    'পরের attempt-এ একই metric মিলিয়ে নিজের পরিবর্তন দেখো।', 'Revision পরিকল্পনায় এই priority-টি আগে রাখো।',
    'তথ্যভিত্তিক সিদ্ধান্ত নিয়ে পরের practice শুরু করো।'
  ];
  const RESULT_INSIGHT_LIBRARY = [];
  reportOpeners.forEach((opener) => reportSignals.forEach((signal) => reportActions.forEach((action) => RESULT_INSIGHT_LIBRARY.push(`${opener}: ${signal} ${action}`))));

  function breakdown(result, kind) {
    const groups = {};
    (result?.snapshot || []).forEach((row) => {
      const live = (CACHE.questions || []).find((question) => String(question.id) === String(row.questionId));
      const subjectId = live?.subjectId || row.subjectId;
      const topicId = live?.topicId || row.topicId;
      const id = kind === 'subject' ? subjectId : topicId;
      const fallbackName = kind === 'subject' ? window.subjectName?.(subjectId) : window.topicName?.(topicId);
      if (!groups[id]) groups[id] = { id, name: fallbackName || (kind === 'subject' ? row.subjectName : row.topicName) || 'অজানা', subName: window.subjectName?.(subjectId) || '', total: 0, correct: 0, wrong: 0, skipped: 0 };
      groups[id].total += 1;
      groups[id][row.status || 'skipped'] += 1;
    });
    return Object.values(groups);
  }

  function currentAccuracy(result) {
    const correct = Number(result?.correct || 0), wrong = Number(result?.wrong || 0);
    return correct + wrong ? Math.round(correct / (correct + wrong) * 100) : 0;
  }

  function recentHistory(result) {
    return (CACHE.examResults || [])
      .filter((item) => String(item?.id || '') !== String(result?.id || ''))
      .sort((a, b) => Number(b?.date || b?.completedAt || 0) - Number(a?.date || a?.completedAt || 0))
      .slice(0, 4);
  }

  function distinctStrengths(rows) {
    const candidates = rows.filter((row) => Number(row?.correct || 0) + Number(row?.wrong || 0) > 0).map((row) => ({ ...row, accuracy: pct(row) }));
    if (candidates.length < 2) return { strong: null, weak: null, comparable: false };
    const sorted = [...candidates].sort((a, b) => b.accuracy - a.accuracy);
    if (sorted[0].accuracy === sorted[sorted.length - 1].accuracy) return { strong: null, weak: null, comparable: false };
    return { strong: sorted[0], weak: sorted[sorted.length - 1], comparable: true };
  }

  function priorAccuracyForId(history, id, kind) {
    const values = [];
    history.forEach((result) => {
      const row = breakdown(result, kind).find((item) => String(item.id) === String(id));
      if (row && Number(row.correct || 0) + Number(row.wrong || 0) > 0) values.push(pct(row));
    });
    return average(values);
  }

  function deltaText(current, previous) {
    if (previous === null) return 'আগের attempt নেই';
    const delta = current - previous;
    if (delta === 0) return 'আগের গড়ের সমান';
    return `${delta > 0 ? '+' : ''}${delta} পয়েন্ট`;
  }

  function lineSvg(values) {
    const points = values.map((value, index) => {
      const x = values.length <= 1 ? 50 : 4 + (92 * index / (values.length - 1));
      const y = 40 - Math.max(0, Math.min(100, value)) * .34;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');
    return `<svg viewBox="0 0 100 44" role="img" aria-label="Accuracy comparison chart" preserveAspectRatio="none"><path d="M4 40H96" class="result-live-gridline"/><polyline points="${points}" class="result-live-line"/><circle cx="${points.split(' ').at(-1)?.split(',')[0] || 50}" cy="${points.split(' ').at(-1)?.split(',')[1] || 40}" r="2.7" class="result-live-dot"/></svg>`;
  }

  function barRow(row, history, kind) {
    const accuracy = pct(row);
    const previous = priorAccuracyForId(history, row.id, kind);
    const state = accuracy >= 80 ? 'strong' : accuracy >= 50 ? 'mid' : 'weak';
    return `<div class="result-live-bar-row"><div class="result-live-bar-head"><span>${safe(row.name)}</span><b>${accuracy}%</b></div><div class="result-live-track"><i class="${state}" style="--result-width:${accuracy}%"></i></div><small>${previous === null ? 'এই অংশের প্রথম recorded attempt' : `আগের গড় ${previous}% · ${safe(deltaText(accuracy, previous))}`}</small></div>`;
  }

  function renderDashboard(result) {
    const currentSubjects = breakdown(result, 'subject');
    const currentTopics = breakdown(result, 'topic');
    const history = recentHistory(result);
    const accuracy = currentAccuracy(result);
    const metrics = resultMetrics(result);
    // This is a deterministic local summary, not an AI response. Keep it visible
    // for immediate feedback but label it clearly so it cannot be mistaken for a live agent result.
    const primary = null;
    const correct = Number(result.correct || 0), wrong = Number(result.wrong || 0), skipped = Number(result.skipped || 0), total = Number(result.questionCount || result.snapshot?.length || 0);
    const attemptRate = total ? Math.round((correct + wrong) / total * 100) : 0;
    const comparisonValues = [...history].reverse().map(currentAccuracy).concat(accuracy);
    const priorAverage = average(history.map(currentAccuracy));
    const overallChange = priorAverage === null ? 'এটি তোমার প্রথম saved result, পরের পরীক্ষাগুলোতে তুলনা দেখা যাবে।' : `আগের ${history.length}টি পরীক্ষার গড় ${priorAverage}% থেকে ${accuracy}% (${safe(deltaText(accuracy, priorAverage))})।`;
    const strengths = distinctStrengths(currentSubjects);
    const topicStrengths = distinctStrengths(currentTopics);
    const priorityTopics = [...currentTopics].filter((row) => Number(row.total || 0) > 0).sort((a, b) => {
      const aLoad = Number(a.wrong || 0) + Number(a.skipped || 0), bLoad = Number(b.wrong || 0) + Number(b.skipped || 0);
      return bLoad - aLoad || pct(a) - pct(b);
    }).slice(0, 3);
    const subjectRows = [...currentSubjects].sort((a, b) => pct(b) - pct(a)).slice(0, 4);
    const singleSubject = currentSubjects.length === 1 ? currentSubjects[0] : null;
    const strongText = strengths.strong ? `${strengths.strong.name} · ${strengths.strong.accuracy}%` : (singleSubject ? `${singleSubject.name} · ${pct(singleSubject)}%` : (currentSubjects.length ? 'সমমান ফলাফল' : 'subject data নেই'));
    const weakText = strengths.weak ? `${strengths.weak.name} · ${strengths.weak.accuracy}%` : (singleSubject ? `${singleSubject.name} · ${pct(singleSubject)}%` : (currentSubjects.length ? 'সব subject-এর ফল কাছাকাছি' : 'subject data নেই'));
    const topicText = topicStrengths.weak ? `${topicStrengths.weak.name} (${topicStrengths.weak.accuracy}%)` : (priorityTopics[0] ? `${priorityTopics[0].name} (${pct(priorityTopics[0])}%)` : (currentTopics.length ? 'সব topic-এর result recorded' : 'topic data নেই'));
    const pace = Number(result.timeUsed || 0) && total ? Math.round(Number(result.timeUsed || 0) / Math.max(1, total)) : null;
    const variables = {
      overall: `তুমি ${total}টির মধ্যে ${correct}টি সঠিক করেছো; accuracy ${accuracy}%।`,
      participation: `উত্তরদানের হার ${attemptRate}%${skipped ? `, ${skipped}টি প্রশ্ন উত্তরহীন ছিল` : ' এবং কোনো প্রশ্ন উত্তরহীন ছিল না'}।`,
      comparison: overallChange,
      subjectSignal: strengths.comparable ? `শক্তিশালী বিষয় ${strengths.strong.name} (${strengths.strong.accuracy}%), priority subject ${strengths.weak.name} (${strengths.weak.accuracy}%)।` : (singleSubject ? `এই পরীক্ষায় শুধু ${singleSubject.name} ছিল, তাই subject strength তুলনা করা হয়নি।` : 'বিষয়গুলোর accuracy কাছাকাছি; আলাদা করে শক্তিশালী বা দুর্বল বলা হচ্ছে না।'),
      topicSignal: (() => { const ranked=[...currentTopics].filter((row) => Number(row.total || 0) > 0).sort((a,b) => (Number(b.wrong || 0) + Number(b.skipped || 0)) - (Number(a.wrong || 0) + Number(a.skipped || 0)) || pct(a) - pct(b)); const top=ranked[0]; if(!top)return 'এই ফলাফলে topic breakdown পাওয়া যায়নি।'; const topAttempted=Number(top.correct || 0)+Number(top.wrong || 0), topAccuracy=topAttempted?Math.round(Number(top.correct || 0)/topAttempted*100):0; if(Number(top.wrong || 0)+Number(top.skipped || 0)>0)return `সবচেয়ে বেশি ভুল/উত্তরহীনতা “${top.name}” topic-এ: ${top.wrong || 0}টি ভুল, ${top.skipped || 0}টি উত্তরহীন; topic accuracy ${topAccuracy}%।`; return `এই attempt-এ “${top.name}” topic-এ ${top.correct || 0}/${top.total || 0}টি সঠিক হয়েছে; topic accuracy ${topAccuracy}%।`; })(),
      paceSignal: pace === null ? 'সময় সংক্রান্ত তথ্য এই পরীক্ষায় পাওয়া যায়নি।' : `গড়ে প্রতি প্রশ্নে ${pace} সেকেন্ড সময় লেগেছে।`
    };
    const template = RESULT_INSIGHT_LIBRARY[hash(`${result.id}|${accuracy}|${correct}|${wrong}|${skipped}|${history.length}`) % RESULT_INSIGHT_LIBRARY.length];
    const insight = template.replace(/\{(overall|participation|comparison|subjectSignal|topicSignal|paceSignal)\}/g, (_, key) => variables[key]);
    const teacherInsight = `<div class="result-analysis-insight-head"><span>অ্যাপের হিসাব</span><b>LOCAL · NOT AI</b></div><h4 class="result-analysis-title">তোমার ফলের দ্রুত সারাংশ</h4><p>${safe(insight)}</p><div class="result-analysis-action"><strong>পরবর্তী পদক্ষেপ</strong><span>এটি শুধু saved result থেকে করা local summary। বিস্তারিত AI মতামতের জন্য আলাদা ✦ Analysis বাটন চাপো।</span></div><div class="result-analysis-motivation"><strong>মনে রাখো</strong><span>এই কার্ডে কোনো AI response বা বাইরের তথ্য ব্যবহার করা হয়নি।</span></div>`;
    const comparisonRows = history.length ? [...history].reverse().map((item, index) => `<div><span>পরীক্ষা ${index + 1}</span><b>${currentAccuracy(item)}%</b></div>`).join('') + `<div class="current"><span>বর্তমান</span><b>${accuracy}%</b></div>` : `<div class="current solo"><span>বর্তমান পরীক্ষা</span><b>${accuracy}%</b></div>`;
    const topicRows = priorityTopics.length ? priorityTopics.map((row, index) => `<div class="result-focus-item" data-result-topic-id="${safe(row.id)}" role="button" tabindex="0" aria-label="${safe(row.name)} প্রশ্ন রিভিউ দেখুন"><span class="result-focus-rank">${index + 1}</span><span><b>${safe(row.name)}</b><small>${safe(row.subName || '')} · ${row.correct} সঠিক · ${row.wrong} ভুল · ${row.skipped} উত্তরহীন</small></span><strong>${pct(row)}%</strong></div>`).join('') : `<div class="result-live-empty">এই ফলাফলে topic তথ্য পাওয়া যায়নি।</div>`;
    const dashboard = document.createElement('section');
    dashboard.className = 'result-live-dashboard';
    dashboard.innerHTML = `
      <section class="result-report-card result-report-story"><div class="result-report-eyebrow"><span>LOCAL RESULT SUMMARY</span><em>অ্যাপের saved result থেকে · AI নয়</em></div><h2>পারফরম্যান্সের দ্রুত সারাংশ</h2><div class="result-analysis-insight is-primary">${teacherInsight}</div><div class="result-report-metrics"><div><span>উত্তরদানের হার</span><b>${attemptRate}%</b></div><div><span>নেট স্কোর</span><b>${round2(metrics.score).toFixed(2)} / ${round2(metrics.maxScore).toFixed(2)}</b></div><div><span>Negative deduction</span><b class="${metrics.negative > 0 ? 'has-penalty' : ''}">−${round2(metrics.negative).toFixed(2)}</b></div></div><div class="result-report-score-note">Gross ${round2(metrics.positive).toFixed(2)} − penalty ${round2(metrics.negative).toFixed(2)} = <strong>${round2(metrics.score).toFixed(2)} net</strong></div></section>
      <section class="result-report-card result-compare-card"><div class="result-card-heading"><div><span>LOCAL PROGRESS</span><h3>সাম্প্রতিক পরীক্ষার তুলনা</h3></div><b>${priorAverage === null ? 'নতুন' : safe(deltaText(accuracy, priorAverage))}</b></div><div class="result-live-chart">${lineSvg(comparisonValues)}</div><div class="result-compare-points">${comparisonRows}</div><p>${safe(overallChange)}</p></section>
      <section class="result-report-card result-subject-card"><div class="result-card-heading"><div><span>LOCAL SUBJECT PULSE</span><h3>বিষয়ভিত্তিক অগ্রগতি</h3></div><b>${currentSubjects.length} বিষয়</b></div><div class="result-live-bars">${subjectRows.length ? subjectRows.map((row) => barRow(row, history, 'subject')).join('') : '<div class="result-live-empty">এই ফলাফলে subject তথ্য পাওয়া যায়নি।</div>'}</div></section>
      <section class="result-report-card result-focus-card"><div class="result-card-heading"><div><span>LOCAL TOPIC FOCUS</span><h3>পরবর্তী revision-এর জায়গা</h3></div><b>${safe(topicText)}</b></div><div class="result-focus-list">${topicRows}</div></section>
    `;
    return dashboard;
  }

  function resetResultScroll() {
    const reset = () => {
      window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
      if (document.scrollingElement) document.scrollingElement.scrollTop = 0;
      document.documentElement.scrollTop = 0;
      document.body.scrollTop = 0;
    };
    reset();
    requestAnimationFrame(reset);
    requestAnimationFrame(() => requestAnimationFrame(reset));
    window.setTimeout(reset, 90);
  }

  function installResultExperience() {
    const base = window.renderResultView;
    if (typeof base !== 'function' || base.__ahResultExperience) return;
    function wrapped(result, isFresh) {
      /* The analysis pack is deferred off the boot path, so it may not have
         arrived on the very first result. Render now with what we have, then
         re-render once it lands - the pack is warmed at idle, so this is only
         insurance for an immediate first result. */
      if (!Array.isArray(window.RESULT_ANALYSIS_500) && typeof window.admissionLoadPack === 'function') {
        window.admissionLoadPack('result-analysis-500')
          .then(() => { try { window.renderResultView(result, isFresh); } catch (_) {} })
          .catch(() => {});
      }
      const output = base.apply(this, arguments);
      const page = document.querySelector('.result-page');
      const stats = page?.querySelector('.result-stat-grid');
      const reviewTitle = [...(page?.querySelectorAll('.result-section-title') || [])].find((node) => node.textContent.includes('প্রশ্ন রিভিউ'));
      if (page && stats && reviewTitle && result) {
        let node = stats.nextElementSibling;
        while (node && node !== reviewTitle) {
          const next = node.nextElementSibling;
          node.remove();
          node = next;
        }
        stats.insertAdjacentElement('afterend', renderDashboard(result));
      }
      if (isFresh) resetResultScroll();
      return output;
    }
    wrapped.__ahResultExperience = true;
    wrapped.__ahOriginal = base;
    window.renderResultView = wrapped;
  }

  const style = document.createElement('style');
  style.id = 'mock-result-experience-style';
  style.textContent = `
    .exam-q-card.answer-locked{border-left-color:var(--emerald)!important}.exam-q-card.answer-locked .opt{cursor:default!important;pointer-events:none}.exam-q-card.answer-locked .opt:not(.selected){opacity:.68}.exam-q-card.answer-locked .opt.selected:after{content:'LOCKED';margin-left:auto;font-size:9px;letter-spacing:.08em;font-weight:900;color:var(--emerald-d);background:var(--mint);padding:4px 6px;border-radius:7px}
    .result-live-dashboard{display:grid;gap:14px}.result-live-dashboard+.result-section-title{margin-top:6px}.result-report-card{position:relative;overflow:hidden;background:linear-gradient(145deg,#ffffff 0%,#f1faf6 100%);border:1px solid #c4e2d7;border-radius:22px;padding:17px 15px;box-shadow:0 9px 24px rgba(15,107,79,.07)}.result-report-card:before{content:'';position:absolute;width:170px;height:170px;border:1px solid rgba(17,111,83,.11);border-radius:50%;right:-72px;top:-88px;pointer-events:none}.result-report-story{background:linear-gradient(145deg,#eaf8f1,#d7f0e4)}.result-report-eyebrow,.result-card-heading>div>span{position:relative;z-index:1;display:flex;align-items:center;justify-content:space-between;gap:8px;color:#176b56;font-size:10px;font-weight:900;letter-spacing:.09em}.result-report-eyebrow em{font-style:normal;color:#659184;font-size:9px;letter-spacing:0}.result-report-story h2{position:relative;z-index:1;color:#153e34;font-size:22px;line-height:1.2;margin:9px 0 8px}.result-report-story p{position:relative;z-index:1;color:#355e52;font-size:14px;line-height:1.72;margin:0}.result-report-metrics{position:relative;z-index:1;display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:13px}.result-report-metrics>div{min-width:0;background:rgba(255,255,255,.72);border:1px solid rgba(16,105,79,.12);border-radius:13px;padding:10px}.result-report-metrics span{display:block;color:#6a9084;font-size:9px;line-height:1.3}.result-report-metrics b{display:block;color:#163f34;font-size:13px;line-height:1.32;margin-top:4px;overflow-wrap:anywhere}.result-card-heading{position:relative;z-index:1;display:flex;align-items:flex-start;justify-content:space-between;gap:10px}.result-card-heading h3{color:#163f34;font-size:18px;line-height:1.25;margin:4px 0 0}.result-card-heading>b{flex:0 0 auto;color:#087156;background:#e8f7f0;border:1px solid #b9dfd0;border-radius:999px;padding:6px 8px;font-size:10px}.result-live-chart{position:relative;z-index:1;height:94px;margin:12px 0 4px;padding:8px 4px;background:rgba(255,255,255,.62);border-radius:15px}.result-live-chart svg{width:100%;height:100%;overflow:visible}.result-live-gridline{fill:none;stroke:#cbe4da;stroke-width:.7}.result-live-line{fill:none;stroke:#0b8061;stroke-width:2.6;stroke-linecap:round;stroke-linejoin:round;filter:drop-shadow(0 4px 3px rgba(11,128,97,.16))}.result-live-dot{fill:#fff;stroke:#0b8061;stroke-width:1.7}.result-compare-points{position:relative;z-index:1;display:grid;grid-template-columns:repeat(5,1fr);gap:5px}.result-compare-points>div{min-width:0;text-align:center;padding:6px 2px;border-radius:9px;background:#f7fcfa}.result-compare-points>div.current{background:#0b765a;color:#fff}.result-compare-points>div.solo{grid-column:3}.result-compare-points span,.result-compare-points b{display:block}.result-compare-points span{font-size:8px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.result-compare-points b{font-size:12px;margin-top:2px}.result-compare-card p{position:relative;z-index:1;color:#55796d;font-size:12px;line-height:1.55;margin:11px 0 0}.result-live-bars{position:relative;z-index:1;display:grid;gap:12px;margin-top:14px}.result-live-bar-head{display:flex;justify-content:space-between;gap:10px;color:#23483e;font-size:13px;font-weight:800}.result-live-bar-head span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.result-live-bar-head b{color:#0a765b}.result-live-track{height:10px;overflow:hidden;margin-top:6px;border-radius:999px;background:#e4f2ec}.result-live-track i{display:block;width:var(--result-width);height:100%;border-radius:inherit;background:#0c8263;transform-origin:left;animation:resultBarGrow .65s cubic-bezier(.23,1,.32,1) both}.result-live-track i.mid{background:#d59621}.result-live-track i.weak{background:#d55c5c}.result-live-bar-row small{display:block;color:#78968d;font-size:10px;margin-top:5px}.result-focus-list{position:relative;z-index:1;display:grid;gap:8px;margin-top:13px}.result-focus-item{display:grid;grid-template-columns:31px 1fr auto;align-items:center;gap:9px;padding:10px;border:1px solid #d6e9e1;border-radius:14px;background:rgba(255,255,255,.75)}.result-focus-rank{width:28px;height:28px;display:grid;place-items:center;border-radius:9px;background:#dff3ea;color:#126850;font-size:12px;font-weight:900}.result-focus-item b{display:block;color:#244a3e;font-size:13px}.result-focus-item small{display:block;color:#718d83;font-size:10px;line-height:1.4;margin-top:3px}.result-focus-item strong{color:#0a765b;font-size:14px}    .result-live-empty{padding:14px;border-radius:12px;background:#f6fbf8;color:#7b958c;font-size:12px;text-align:center}.result-report-score-note{position:relative;z-index:1;margin-top:9px;padding:9px 10px;border-radius:11px;background:rgba(255,255,255,.58);color:#557b6e;font-size:10px;line-height:1.45}.result-report-score-note strong{color:#0a765b}.result-report-metrics b.has-penalty{color:#c34e56}.result-analysis-insight-stack{display:grid;gap:9px}.result-analysis-insight{position:relative;overflow:hidden;padding:13px 14px;border:1px solid #d6e9e1;border-radius:17px;background:rgba(255,255,255,.64);box-shadow:0 5px 16px rgba(15,107,79,.045)}.result-analysis-insight.is-primary{border-color:#b8ddcc;background:linear-gradient(145deg,#f1fbf5,#fff)}.result-analysis-insight-head{display:flex;align-items:center;justify-content:space-between;gap:10px;color:#167457;font-size:9px;font-weight:900;letter-spacing:.07em;text-transform:uppercase}.result-analysis-insight-head b{padding:4px 6px;border-radius:7px;background:#e9f6ef;color:#4a8570;font-size:9px;letter-spacing:.02em}.result-analysis-insight p{margin:8px 0 0;color:#2f5c4e;font-size:13px;line-height:1.65}.result-analysis-title{margin:8px 0 0;color:#185f4a;font-size:15px;line-height:1.35}.result-analysis-action,.result-analysis-motivation{display:grid;gap:3px;margin-top:9px;padding:8px 9px;border-radius:10px;background:#f6fbf8}.result-analysis-action strong,.result-analysis-motivation strong{color:#177458;font-size:9px;letter-spacing:.05em}.result-analysis-action span,.result-analysis-motivation span{color:#567b6f;font-size:10px;line-height:1.5}.result-analysis-motivation{background:#fff9ed}.result-analysis-motivation strong{color:#a16a16}@keyframes resultBarGrow{from{transform:scaleX(.03);opacity:.25}to{transform:scaleX(1);opacity:1}}@media(max-width:420px){.result-report-story h2{font-size:20px}.result-report-metrics{grid-template-columns:1fr 1fr}.result-report-metrics>div:last-child{grid-column:1/-1}.result-card-heading h3{font-size:16px}.result-compare-points{gap:3px}.result-compare-points span{font-size:7px}.result-compare-points b{font-size:11px}.result-analysis-insight{padding:12px}.result-analysis-insight p{font-size:11.5px}}@media(prefers-reduced-motion:reduce){.result-live-track i{animation:none}}

  `;
  document.head.appendChild(style);

  installResultExperience();
  window.addEventListener('hashchange', () => {
    if (String(location.hash).replace(/^#/, '').split('?')[0] === 'exam/result') window.setTimeout(resetResultScroll, 0);
  });
})();
