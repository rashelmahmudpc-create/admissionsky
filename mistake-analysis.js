/* ============================================================================
   MISTAKE ANALYSIS / ভুল খাতা (Additive Module)
   --------------------------------------------------------------------------
   Fully additive layer, does NOT touch the Exam engine, Question Bank,
   Rewards/XP, Daily Quests, Vocabulary, Study Planner or the existing
   Smart Mistake Book. All data is saved in localStorage under a dedicated
   key, so the IndexedDB schema and existing questions remain untouched.

   Required flow (implemented):
     Exam Result → Wrong Questions → Mistake Analysis → Analysis Card
        → 📌 ভুল খাতায় যোগ করুন → Notebook (Search / Filter / Delete / Export)

   AI-READY: every saved card follows the structured schema used by the
   prototype (question, options, selectedAnswer, correctAnswer, explanation,
   whyWrong, topic, concept, commonMistake, revisionPoints, memoryTrick,
   relatedPracticeQuestions, difficulty, examImportance, agentStatus).
   The `toAgentPayload()` helper builds the payload the future Mistake
   Analysis Agent can consume directly, no API is called in this phase.
   ============================================================================ */
(function(){
  'use strict';

  const STORAGE_KEY = 'mistake-analysis-notebook-v1';

  /* ---------------- shared helpers from the host app ---------------- */
  const esc = (typeof window.esc === 'function') ? window.esc : function(s){
    return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){
      return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]);
    });
  };
  const uid = (typeof window.uid === 'function') ? window.uid : function(){
    try { return (crypto.randomUUID ? crypto.randomUUID() : null) || ('ma-' + Math.random().toString(36).slice(2) + Date.now().toString(36)); }
    catch(_){ return 'ma-' + Math.random().toString(36).slice(2) + Date.now().toString(36); }
  };
  const toast = (typeof window.toast === 'function') ? function(msg){ window.toast(msg); } : function(msg){};

  /* ---------------- notebook storage (localStorage) ---------------- */
  function loadNotebook(){
    try{
      const raw = localStorage.getItem(STORAGE_KEY);
      if(!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    }catch(_){ return []; }
  }
  function saveNotebook(items){
    try{ localStorage.setItem(STORAGE_KEY, JSON.stringify(items)); }catch(_){}
  }

  /* ---------------- difficulty / importance inference ---------------- */
  function difficultyOf(questionId){
    const q = (typeof CACHE !== 'undefined' ? CACHE.questions : []) || [];
    const found = q.find(function(x){ return x.id === questionId; });
    const wc = (found && found.stats && found.stats.wrong) || 0;
    const ac = (found && found.stats && found.stats.attempts) || 0;
    if(!ac) return 'medium';
    const rate = wc / ac;
    return rate >= 0.6 ? 'hard' : rate >= 0.3 ? 'medium' : 'easy';
  }
  function importanceOf(topicId){
    const tb = (typeof CACHE !== 'undefined' && CACHE.settings && CACHE.settings.mistakeAnalysisTopicImportance) || {};
    const base = tb[topicId];
    if(base) return base;
    const rows = (typeof CACHE !== 'undefined' && CACHE.mistakes) || [];
    const count = rows.filter(function(m){ return m.topicId === topicId; }).length;
    if(count >= 4) return 'critical';
    if(count >= 2) return 'high';
    if(count >= 1) return 'medium';
    return 'low';
  }

  /* ---------------- structured analysis card builder ---------------- */
  function deriveWhyWrong(s){
    if(s.status !== 'wrong') return '';
    const selText = (s.options && s.selected !== null && s.selected !== undefined) ? (s.options[s.selected] || '') : '';
    const corText = (s.options && s.answerIndex !== null && s.answerIndex !== undefined) ? (s.options[s.answerIndex] || '') : '';
    const selLen = String(selText).length, corLen = String(corText).length;
    const similar = selLen > 2 && corLen > 2 &&
      (String(selText).includes(String(corText)) || String(corText).includes(String(selText)) ||
       Math.abs(selLen - corLen) <= Math.min(selLen, corLen) / 2);
    if(similar) return 'সঠিক উত্তরের সাথে তোমার বেছে নেওয়া উত্তরটি প্রায় একই ধরনের, দুটি সাদৃশ্যপূর্ণ অপশনের মধ্যে পার্থক্যটি খেয়াল করো, যেমন সংখ্যা, তারিখ, বানান বা verb-এর রূপ।';
    return 'বেছে নেওয়া উত্তরটি সঠিক concept-এর সাথে মেলেনি। সঠিক option টি কোন ধারণার উপর ভিত্তি করে দেওয়া হয়েছে, সেটি প্রথমে নিজেয়ে বুঝে নাও, তারপর দেখো তোমার উত্তরটি কেন concept থেকে দূরে সরে গেছে।';
  }
  function deriveConcept(s){
    const names = [];
    if(typeof window.subjectName === 'function' && s.subjectId) names.push(subjectName(s.subjectId));
    if(typeof window.topicName === 'function' && s.topicId) names.push(topicName(s.topicId));
    return names.length ? names.join(', ') : 'General';
  }

  /* P10: use the pure mistake engine when present; degrade to an empty label
     rather than throwing if it has not loaded. */
  function engineCategory(snapshot, difficulty){
    try{
      var E = window.AhMistakeEngine; if(!E || !E.categorize) return '';
      var m = (window.CACHE && CACHE.mistakes || []).find(function(x){ return String(x.questionId) === String(snapshot.questionId); });
      var r = E.categorize({ snapshot: snapshot, record: m, difficulty: difficulty });
      return r ? r.category : '';
    }catch(_){ return ''; }
  }
  function engineTier(snapshot){
    try{
      var E = window.AhMistakeEngine; if(!E || !E.priorityTier) return '';
      var m = (window.CACHE && CACHE.mistakes || []).find(function(x){ return String(x.questionId) === String(snapshot.questionId); });
      return E.priorityTier(m || { wrongCount: 1 });
    }catch(_){ return ''; }
  }
  function buildAnalysisCardFromSnapshot(snapshot, result){
    if(!snapshot || snapshot.status !== 'wrong') return null;
    const options = (snapshot.options || []).map(function(opt, i){
      return { id: String.fromCharCode(65 + i), label: String.fromCharCode(65 + i), text: String(opt || '') };
    });
    const selected = options.find(function(o){ return o.id === String.fromCharCode(65 + (snapshot.selected == null ? -1 : Number(snapshot.selected))); });
    const correct = options.find(function(o){ return o.id === String.fromCharCode(65 + Number(snapshot.answerIndex || 0)); });
    if(!selected || !correct) return null;
    const now = new Date().toISOString();
    const topic = (typeof window.subjectName === 'function' && snapshot.subjectId) ? subjectName(snapshot.subjectId) : 'General';
    return {
      id: uid(),
      examId: (result && result.id) ? String(result.id) : '',
      examName: 'Exam Result, ' + (typeof window.examTypeLabel === 'function' && result ? examTypeLabel(result) : (result && result.mode) || 'Exam'),
      questionId: snapshot.questionId,
      question: snapshot.question || '',
      options: options,
      selectedAnswer: { optionId: selected.id, label: selected.label, text: selected.text },
      correctAnswer: { optionId: correct.id, label: correct.label, text: correct.text },
      whyWrong: deriveWhyWrong(snapshot),
      explanation: snapshot.explanation || '',
      topic: topic,
      concept: deriveConcept(snapshot),
      commonMistake: '',
      revisionPoints: [],
      memoryTrick: '',
      relatedPracticeQuestions: [],
      difficulty: difficultyOf(snapshot.questionId),
      examImportance: importanceOf(snapshot.topicId),
      mistakeCategory: engineCategory(snapshot, difficultyOf(snapshot.questionId)),
      priorityTier: engineTier(snapshot),
      createdAt: now,
      updatedAt: now,
      tags: [topic].filter(Boolean),
      agentStatus: 'pending',
      source: 'exam-result'
    };
  }

  /* ---------------- agent payload (future Mistake Analysis Agent) ------ */
  function toAgentPayload(mistake){
    return {
      meta: { source: 'admission-hub', createdAt: new Date().toISOString(), examId: mistake.examId || '', examName: mistake.examName || '' },
      mistake: mistake,
      instructions: {
        task: 'analyze_mistake',
        outputFormat: 'mistake_card',
        language: 'bn',
        requirements: [
          'Answer in concise Bangla',
          'Explain why the selected answer is wrong',
          'Keep revision points actionable',
          'Suggest memory trick if possible',
          'Generate 3 to 5 related practice questions',
          'Maintain structured JSON-like output'
        ]
      }
    };
  }

  /* ---------------- render: Mistake Analysis view -------------------- */
  function subjectOf(sid){ return (typeof window.subjectName === 'function' && sid) ? subjectName(sid) : '-'; }
  function topicOf(tid){ return (typeof window.topicName === 'function' && tid) ? topicName(tid) : '-'; }

  function renderAnalysisCard(card, resultId){
    const diffCls = { easy:'green', medium:'orange', hard:'red' }[card.difficulty] || '';
    const impCls = { low:'', medium:'orange', high:'green', critical:'red' }[card.examImportance] || '';
    const impPill = card.examImportance === 'low' ? '' : card.examImportance;
    const isSaved = isMistakeSaved(card.questionId);

    const optionHtml = card.options.map(function(opt){
      let cls = 'ma-opt';
      let note = '';
      if(opt.id === card.correctAnswer.optionId){ cls += ' ma-opt-correct'; note = '<span class="ma-opt-note correct">সঠিক উত্তর</span>'; }
      else if(opt.id === card.selectedAnswer.optionId){ cls += ' ma-opt-wrong'; note = '<span class="ma-opt-note wrong">তোমার উত্তর</span>'; }
      return '<div class="' + cls + '"><span class="ma-opt-let">' + esc(opt.label) + '</span><span class="ma-opt-text">' + esc(opt.text) + '</span>' + note + '</div>';
    }).join('');

    const subHtml = function(title, body, variant){
      variant = variant || '';
      if(!body || (Array.isArray(body) && !body.length)) return '';
      if(Array.isArray(body)){
        return '<div class="ma-sub ' + variant + '"><b>' + esc(title) + '</b><ul>' + body.map(function(b){ return '<li>' + esc(b) + '</li>'; }).join('') + '</ul></div>';
      }
      return '<div class="ma-sub ' + variant + '"><b>' + esc(title) + '</b><div>' + esc(body) + '</div></div>';
    };

    const subs = [
      subHtml('💡 ব্যাখ্যা (Explanation)', card.explanation || 'এই প্রশ্নের ব্যাখ্যা এখনো সংরক্ষণ করা হয়নি।'),
      subHtml('কেন ভুল হয়েছে (Why Wrong)', card.whyWrong),
      subHtml('Topic / Concept', card.concept || card.topic),
      subHtml('Common Mistake', card.commonMistake || '(Common mistake analysis, AI/Agent প্রস্তুত হলে এখানে দেখা যাবে)'),
      subHtml('📝 Revision Points', card.revisionPoints),
      subHtml('🧠 Memory Trick', card.memoryTrick || '(Memory trick, AI/Agent প্রস্তুত হলে এখানে দেখা যাবে)'),
      subHtml('🎯 Related Practice Questions', card.relatedPracticeQuestions)
    ].filter(Boolean).join('');

    const infoBoxes = [
      '<div class="ma-info-box"><span class="ma-info-label">তোমার উত্তর</span><div class="ma-info-value">' + esc(card.selectedAnswer.label) + '. ' + esc(card.selectedAnswer.text) + '</div></div>',
      '<div class="ma-info-box"><span class="ma-info-label">সঠিক উত্তর</span><div class="ma-info-value">' + esc(card.correctAnswer.label) + '. ' + esc(card.correctAnswer.text) + '</div></div>'
    ].join('');

    return '<div class="ma-card" id="maAnalysisCard">' +
      '<div class="ma-card-head"><div class="row wrap" style="gap:6px">' +
        '<span class="pill">' + esc(card.topic) + '</span>' +
        '<span class="pill ' + diffCls + '">Difficulty: ' + capitalize(card.difficulty) + '</span>' +
        (impPill ? '<span class="pill ' + impCls + '">Importance: ' + capitalize(impPill) + '</span>' : '') +
        '<span class="pill">Status: ' + (card.agentStatus === 'analyzed' ? 'Analyzed' : 'Pending Agent') + '</span>' +
      '</div></div>' +
      '<div class="ma-question">' + esc(card.question) + '</div>' +
      '<div class="ma-options">' + optionHtml + '</div>' +
      '<div class="ma-info-grid">' + infoBoxes + '</div>' +
      subs +
      '<div class="ma-actions">' +
        '<button class="btn" onclick="MA.saveCard(\'' + esc(card.id) + '\')">' + (isSaved ? '✓ ভুল খাতায় আছে' : '📌 ভুল খাতায় যোগ করুন') + '</button>' +
        '<button class="btn ghost sm" onclick="MA.editCard(\'' + esc(card.id) + '\')">✏️ Edit Analysis</button>' +
        (resultId ? '<button class="btn ghost sm" onclick="resultPracticeOne(\'' + esc(resultId) + '\',\'' + esc(card.questionId) + '\')">🔁 আবার অনুশীলন</button>' : '') +
      '</div>' +
      '<div class="muted" style="font-size:10.5px; margin-top:10px;">Analysis fields যেমন Common Mistake, Memory Trick ইত্যাদি এই ধাপে খালি রাখা হয়েছে, পরবর্তী phases-এ Mistake Analysis Agent এর structured response এখানে বসানো হবে।</div>' +
    '</div>';
  }

  /* ---------------- edit form for pending fields ---------------------- */
  function renderEditForm(card){
    const fields = [
      ['inputCommonMistake', 'Common Mistake (ছাত্ররা সাধারণত কী ভুল করে)', card.commonMistake || '', 'textarea'],
      ['inputRevisionPoints', 'Revision Points (প্রতিটি লাইনে বা | দিয়ে আলাদা)', (card.revisionPoints || []).join(' | '), 'textarea'],
      ['inputMemoryTrick', 'Memory Trick (মনে রাখার সহজ উপায়)', card.memoryTrick || '', 'textarea'],
      ['inputRelatedPractice', 'Related Practice Questions (| দিয়ে আলাদা)', (card.relatedPracticeQuestions || []).join(' | '), 'textarea'],
      ['inputDifficulty', 'Difficulty (easy / medium / hard)', card.difficulty || 'medium', 'text'],
      ['inputImportance', 'Exam Importance (low / medium / high / critical)', card.examImportance || 'medium', 'text'],
      ['inputTopic', 'Topic', card.topic || '', 'text'],
      ['inputConcept', 'Concept', card.concept || '', 'text'],
      ['inputWhyWrong', 'Why Wrong', card.whyWrong || '', 'textarea'],
      ['inputExplanation', 'Explanation', card.explanation || '', 'textarea']
    ];
    const html = '<h3>Analysis Edit</h3>' +
      '<p class="muted">Pending fields সম্পাদনা করুন, save করলে ভুল খাতায় এই তথ্যসহ সংরক্ষিত হবে।</p>' +
      fields.map(function(f){
        return '<label class="flabel">' + f[1] + '</label>' +
          (f[3] === 'textarea'
            ? '<textarea id="' + f[0] + '" rows="2">' + esc(f[2]) + '</textarea>'
            : '<input type="text" id="' + f[0] + '" value="' + esc(f[2]) + '">');
      }).join('') +
      '<div class="row" style="margin-top:14px; gap:8px">' +
        '<button class="btn ghost" onclick="closeModal()">Cancel</button>' +
        '<button class="btn" onclick="MA.applyEdit(\'' + esc(card.id) + '\')">Save</button>' +
      '</div>';
    openModal(html);
  }

  /* ---------------- Gemini tutor section ------------------------------ */
  function renderAITutorSection(){
    return '<div class="ma-ai-tutor" id="maAiTutor">' +
      '<div class="ma-ai-tutor-head"><h3>✨ Gemini AI Tutor</h3>' +
      '<p>ভুল প্রশ্ন, concept বা GK নিয়ে সংক্ষিপ্ত ও শিক্ষামূলক উত্তর পেতে prompt কপি করে Gemini-তে paste করো।</p></div>' +
      '<div style="padding:14px 0 4px; text-align:center;">' +
        '<button class="btn" onclick="window.open(\'https://gemini.google.com/app\',\'_blank\')">✨ Gemini খুলুন</button>' +
      '</div>' +
    '</div>';
  }
  function loadAITutorIframe(){ /* kept as a compatibility no-op for the existing notebook render flow */ }

  /* ---------------- notebook view ------------------------------------- */
  function matchesFilter(item, filter){
    if(filter === 'all') return true;
    if(['easy','medium','hard'].indexOf(filter) !== -1) return item.difficulty === filter;
    if(['low','mediumImportance','high','critical'].indexOf(filter) !== -1){
      return item.examImportance === (filter === 'mediumImportance' ? 'medium' : filter);
    }
    return true;
  }
  function matchesSearch(item, q){
    if(!q) return true;
    var hay = [
      item.question, item.topic, item.concept, item.whyWrong, item.explanation,
      item.commonMistake, item.memoryTrick, item.examName, item.questionId
    ].concat(item.revisionPoints || []).concat(item.relatedPracticeQuestions || []).concat(item.tags || []).join(' ').toLowerCase();
    return hay.indexOf(q.toLowerCase()) !== -1;
  }

  function renderNotebookPage(){
    var MAState = getMAState();
    var notebook = loadNotebook();
    var filtered = notebook.filter(function(it){ return matchesFilter(it, MAState.filter) && matchesSearch(it, MAState.search); });

    var savedCount = notebook.length;
    var lastUpdated = notebook[0] ? formatDate(notebook[0].updatedAt || notebook[0].createdAt) : '-';

    var statsHtml = '<div class="ma-stats-row">' +
      '<div class="ma-stat"><span class="ma-stat-label">Saved Mistakes</span><span class="ma-stat-value">' + savedCount + '</span></div>' +
      '<div class="ma-stat"><span class="ma-stat-label">Last Updated</span><span class="ma-stat-value">' + lastUpdated + '</span></div>' +
      '<div class="ma-stat"><span class="ma-stat-label">Storage</span><span class="ma-stat-value">LocalStorage</span></div>' +
    '</div>';

    var controlsHtml = '<div class="card ma-controls" style="padding:12px;">' +
      '<div class="searchbar" style="margin-bottom:8px;"><span class="search-icon">🔍</span><input id="maSearch" placeholder="Search mistakes... (question, topic, concept, trick)" value="' + esc(MAState.search) + '"></div>' +
      '<div class="row wrap" style="gap:6px;">' +
        '<select id="maFilter" style="flex:1;">' +
          ['all','easy','medium','hard','critical','high','mediumImportance','low'].map(function(v){
            var labels = {all:'All Filters',easy:'Difficulty: Easy',medium:'Difficulty: Medium',hard:'Difficulty: Hard',critical:'Importance: Critical',high:'Importance: High',mediumImportance:'Importance: Medium',low:'Importance: Low'};
            return '<option value="' + v + '" ' + (MAState.filter === v ? 'selected' : '') + '>' + labels[v] + '</option>';
          }).join('') +
        '</select>' +
        '<button class="btn ghost sm" onclick="MA.exportJSON()">Export JSON</button>' +
        '<button class="btn danger sm" onclick="MA.clearAll()">Clear All</button>' +
      '</div>' +
    '</div>';

    var cardsHtml = filtered.length === 0
      ? '<div class="empty">📒 ' + (MAState.search || MAState.filter !== 'all' ? 'কোনো মিল পাওয়া যায়নি, filter পরিবর্তন করো' : 'ভুল খাতা এখনো খালি') +
          (notebook.length === 0 ? '<br><br>Exam Result পাতায় কোনো ভুল প্রশ্ন থেকে "🔍 Mistake Analysis" প্রেস করে Analysis Card দেখো, তারপর "📌 ভুল খাতায় যোগ করুন" চাপো।' : '') + '</div>'
      : filtered.map(function(it){ return renderNotebookCard(it); }).join('');

    var html = '<div class="ma-page">' +
      '<div class="explorer-head"><div class="explorer-kicker">Revision Tools</div><h1 class="explorer-title">Mistake Analysis / ভুল খাতা</h1><p class="explorer-subtitle">Exam-এর ভুল প্রশ্নগুলো বিশ্লেষণ করে structured card হিসেবে সংরক্ষণ করো, future Mistake Analysis Agent integration-এর জন্য প্রস্তুত।</p></div>' +
      statsHtml + controlsHtml +
      '<div class="row between" style="margin:12px 0 6px;"><b>📒 Notebook <span class="muted">(' + filtered.length + ' item' + (filtered.length === 1 ? '' : 's') + ')</span></b>' +
        (notebook.length > 0 ? '<span class="muted" style="font-size:11px;">সংরক্ষিত কার্ড browser-এর localStorage-এ থাকবে, refresh-এর পরেও থাকবে।</span>' : '') +
      '</div>' +
      cardsHtml +
      renderAITutorSection() +
    '</div>';

    renderShell(html, { title: 'Mistake Analysis', back: "navigate('mistakes')" });

    loadAITutorIframe();

    var searchEl = document.getElementById('maSearch');
    if(searchEl){ searchEl.addEventListener('input', function(){ MAState.search = String(searchEl.value || '').trim(); setMAState(MAState); renderNotebookPage(); }); }
    var filterEl = document.getElementById('maFilter');
    if(filterEl){ filterEl.addEventListener('change', function(){ MAState.filter = String(filterEl.value || 'all'); setMAState(MAState); renderNotebookPage(); }); }
  }

  function renderNotebookCard(item){
    var diffCls = { easy:'green', medium:'orange', hard:'red' }[item.difficulty] || '';
    var impCls = { low:'', medium:'orange', high:'green', critical:'red' }[item.examImportance] || '';
    var impPill = item.examImportance === 'low' ? '' : item.examImportance;
    var correct = item.correctAnswer ? item.correctAnswer.label + '. ' + esc(item.correctAnswer.text) : '';
    var selected = item.selectedAnswer ? item.selectedAnswer.label + '. ' + esc(item.selectedAnswer.text) : '';
    var agentBtn = item.agentStatus === 'pending'
      ? '<button class="btn ghost sm" onclick="MA.showAgentPayload(\'' + esc(item.id) + '\')">🤖 Show Agent Payload</button>'
      : '<span class="pill green">Analyzed</span>';
    var editBtn = item.source === 'custom'
      ? '<button class="btn ghost sm" onclick="MA.editNotebookItem(\'' + esc(item.id) + '\')">✏️ Edit</button>'
      : '';

    return '<article class="card ma-notebook-card" id="ma-notebook-' + esc(item.id) + '">' +
      '<div class="row between" style="align-items:flex-start; gap:8px;">' +
        '<div><div style="font-weight:750; font-size:14px; line-height:1.5;">' + esc(item.question) + '</div>' +
          '<div class="muted" style="margin-top:5px;">' + esc(item.examName || 'Exam') + ' · ' + esc(item.topic || 'General') + (item.questionId ? ' · ID: ' + esc(String(item.questionId).slice(0,12)) : '') + '</div></div>' +
      '</div>' +
      '<div class="row wrap" style="gap:6px; margin-top:10px;">' +
        '<span class="pill ' + diffCls + '">Difficulty: ' + capitalize(item.difficulty || 'medium') + '</span>' +
        (impPill ? '<span class="pill ' + impCls + '">Importance: ' + capitalize(impPill) + '</span>' : '') +
        '<span class="pill">Status: ' + capitalize(item.agentStatus || 'pending') + '</span>' +
        '<span class="pill">Added: ' + formatDate(item.createdAt) + '</span>' +
      '</div>' +
      '<div class="ma-notebook-answers" style="margin-top:10px;">' +
        '<div class="ma-notebook-answer wrong-ans"><b>তোমার উত্তর:</b> ' + selected + '</div>' +
        '<div class="ma-notebook-answer correct-ans"><b>সঠিক উত্তর:</b> ' + correct + '</div>' +
      '</div>' +
      (item.explanation ? '<div class="ma-notebook-explain"><b>💡 ব্যাখ্যা:</b> ' + esc(item.explanation) + '</div>' : '') +
      (item.concept ? '<div class="ma-notebook-meta"><b>📚 Topic / Concept:</b> ' + esc(item.concept) + '</div>' : (item.topic ? '<div class="ma-notebook-meta"><b>📚 Topic:</b> ' + esc(item.topic) + '</div>' : '')) +
      (item.whyWrong ? '<div class="ma-notebook-meta ma-notebook-wrong"><b>⚠️ কেন ভুল হয়েছে:</b> ' + esc(item.whyWrong) + '</div>' : '') +
      (item.commonMistake ? '<div class="ma-notebook-meta"><b>🎯 Common Mistake:</b> ' + esc(item.commonMistake) + '</div>' : '') +
      ((item.revisionPoints || []).length ? '<div class="ma-notebook-meta"><b>📝 Revision Points:</b> ' + (item.revisionPoints || []).map(function(rp){ return esc(rp); }).join(' · ') + '</div>' : '') +
      (item.memoryTrick ? '<div class="ma-notebook-meta"><b>🧠 Memory Trick:</b> ' + esc(item.memoryTrick) + '</div>' : '') +
      ((item.relatedPracticeQuestions || []).length ? '<div class="ma-notebook-meta"><b>🔁 Related Practice Questions:</b> ' + (item.relatedPracticeQuestions || []).map(function(rq){ return esc(typeof rq === 'string' ? rq : (rq.question || '')); }).join(' · ') + '</div>' : '') +
      '<div class="ma-notebook-actions">' +
        '<button class="btn ghost sm" onclick="MA.copyJSON(\'' + esc(item.id) + '\')">Copy JSON</button>' +
        agentBtn + editBtn +
        '<button class="btn danger sm" onclick="MA.deleteItem(\'' + esc(item.id) + '\')">Delete</button>' +
      '</div>' +
    '</article>';
  }

  /* ---------------- state helpers -------------------------------------- */
  function getMAState(){
    try{
      const raw = localStorage.getItem(STORAGE_KEY + ':state');
      const parsed = raw ? JSON.parse(raw) : {};
      return { search: String(parsed.search || ''), filter: String(parsed.filter || 'all') };
    }catch(_){ return { search:'', filter:'all' }; }
  }
  function setMAState(s){
    try{ localStorage.setItem(STORAGE_KEY + ':state', JSON.stringify(s)); }catch(_){}
  }
  function capitalize(v){ return String(v || '').charAt(0).toUpperCase() + String(v || '').slice(1); }
  function formatDate(iso){
    const d = new Date(iso);
    if(isNaN(d.getTime())) return '-';
    return d.toLocaleString(undefined, { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' });
  }
  function isMistakeSaved(questionId){
    return loadNotebook().some(function(it){ return it.questionId === questionId; });
  }

  /* ---------------- actions --------------------------------------------- */
  const publicApi = {};

  publicApi.openAnalysis = function(questionId, resultId){
    let r = (typeof CACHE !== 'undefined' && CACHE.examResults) ? CACHE.examResults.find(function(x){ return x.id === resultId; }) : null;
    if(!r){
      // Result id may be empty/unknown (e.g. after page reload); fall back to
      // the most recent result in history, matching the result page behavior.
      const results = (typeof CACHE !== 'undefined' && CACHE.examResults) ? CACHE.examResults : [];
      r = results.length ? results[results.length - 1] : null;
    }
    const norm = (typeof window.normalizeExamResult === 'function') ? normalizeExamResult(r) : r;
    const snap = (norm && norm.snapshot ? norm.snapshot : []).find(function(s){ return s.questionId === questionId; });
    if(!snap || snap.status !== 'wrong'){
      toast('শুধু ভুল প্রশ্নের Mistake Analysis পাওয়া যায়');
      return;
    }
    let pending = window.__maPendingCards || {};
    if(!pending[questionId]){
      const card = buildAnalysisCardFromSnapshot(snap, norm);
      if(!card){ toast('Analysis card তৈরি করা সম্ভব হয়নি'); return; }
      pending[questionId] = card;
      window.__maPendingCards = pending;
    }
    const card = pending[questionId];
    setMAState({ search:'', filter:'all' });
    renderMAView(card, questionId, resultId);
  };

  function renderMAView(card, questionId, resultId){
    const html = '<div class="ma-page">' +
      '<div class="explorer-head"><div class="explorer-kicker">Mistake Analysis</div><h1 class="explorer-title">Analysis Card</h1><p class="explorer-subtitle">প্রশ্নটি কেন ভুল হয়েছে, সঠিক concept কী, structure হিসেবে দেখো ও ভুল খাতায় সংরক্ষণ করো।</p></div>' +
      renderAnalysisCard(card, resultId) +
    '</div>';
    renderShell(html, { title: 'Mistake Analysis', back: "MA.backToResult('" + esc(resultId || '') + "','" + esc(questionId || '') + "')" });
  }

  publicApi.backToResult = function(resultId, questionId){
    setMAState({ search:'', filter:'all' });
    if(resultId){ navigate('history/' + resultId); ResultFilter = 'wrong'; window.render && render(); }
    else { navigate('exam/result'); }
  };

  publicApi.saveCard = function(cardId){
    const card = findPending(cardId);
    if(!card){ toast('Card পাওয়া যায়নি, আগে Analysis page-এ ফিরে যাও'); return; }
    const notebook = loadNotebook();
    if(notebook.some(function(it){ return it.questionId === card.questionId; })){
      toast('এই প্রশ্নটি ইতোমধ্যে ভুল খাতায় আছে');
      renderMAView(card, card.questionId, card.examId);
      return;
    }
    notebook.unshift(card);
    saveNotebook(notebook);
    const pending = window.__maPendingCards || {};
    if(pending[card.questionId]) delete pending[card.questionId];
    window.__maPendingCards = pending;
    toast('✓ ভুল খাতায় সংরক্ষণ করা হয়েছে');
    renderMAView(card, card.questionId, card.examId);
  };

  publicApi.editCard = function(cardId){
    const card = findPending(cardId);
    if(!card) return;
    renderEditForm(card);
  };

  publicApi.applyEdit = function(cardId){
    const card = findPending(cardId);
    if(!card) return;
    const v = function(id){ var el = document.getElementById(id); return el ? String(el.value).trim() : ''; };
    const split = function(raw){ return raw ? raw.split('|').map(function(s){ return s.trim(); }).filter(Boolean) : []; };
    card.commonMistake = v('inputCommonMistake');
    card.revisionPoints = split(v('inputRevisionPoints'));
    card.memoryTrick = v('inputMemoryTrick');
    card.relatedPracticeQuestions = split(v('inputRelatedPractice'));
    const diff = v('inputDifficulty').toLowerCase();
    card.difficulty = ['easy','medium','hard'].indexOf(diff) !== -1 ? diff : 'medium';
    const imp = v('inputImportance').toLowerCase();
    card.examImportance = ['low','medium','high','critical'].indexOf(imp) !== -1 ? imp : 'medium';
    const topic = v('inputTopic');
    if(topic){ card.topic = topic; card.tags = [topic]; }
    const concept = v('inputConcept'); if(concept) card.concept = concept;
    const why = v('inputWhyWrong'); if(why) card.whyWrong = why;
    const expl = v('inputExplanation'); if(expl) card.explanation = expl;
    card.updatedAt = new Date().toISOString();
    closeModal();
    toast('✏️ Analysis আপডেট হয়েছে');
    renderMAView(card, card.questionId, card.examId);
  };

  publicApi.editNotebookItem = function(itemId){
    const notebook = loadNotebook();
    const item = notebook.find(function(it){ return it.id === itemId; });
    if(!item) return;
    renderEditNotebookForm(item);
  };

  function renderEditNotebookForm(item){
    const html = '<h3>Edit Saved Mistake</h3>' +
      '<label class="flabel">Topic</label><input type="text" id="nbInputTopic" value="' + esc(item.topic || '') + '">' +
      '<label class="flabel">Common Mistake</label><textarea id="nbInputCommonMistake" rows="2">' + esc(item.commonMistake || '') + '</textarea>' +
      '<label class="flabel">Revision Points (| দিয়ে আলাদা)</label><textarea id="nbInputRevisionPoints" rows="2">' + esc((item.revisionPoints || []).join(' | ')) + '</textarea>' +
      '<label class="flabel">Memory Trick</label><textarea id="nbInputMemoryTrick" rows="2">' + esc(item.memoryTrick || '') + '</textarea>' +
      '<label class="flabel">Related Practice Questions (| দিয়ে আলাদা)</label><textarea id="nbInputRelatedPractice" rows="2">' + esc((item.relatedPracticeQuestions || []).join(' | ')) + '</textarea>' +
      '<div class="row" style="margin-top:14px; gap:8px">' +
        '<button class="btn ghost" onclick="closeModal()">Cancel</button>' +
        '<button class="btn" onclick="MA.applyNotebookEdit(\'' + esc(item.id) + '\')">Save</button>' +
      '</div>';
    openModal(html);
  }

  publicApi.applyNotebookEdit = function(itemId){
    const notebook = loadNotebook();
    const item = notebook.find(function(it){ return it.id === itemId; });
    if(!item) return;
    const v = function(id){ var el = document.getElementById(id); return el ? String(el.value).trim() : ''; };
    const split = function(raw){ return raw ? raw.split('|').map(function(s){ return s.trim(); }).filter(Boolean) : []; };
    const topic = v('nbInputTopic');
    item.commonMistake = v('nbInputCommonMistake');
    item.revisionPoints = split(v('nbInputRevisionPoints'));
    item.memoryTrick = v('nbInputMemoryTrick');
    item.relatedPracticeQuestions = split(v('nbInputRelatedPractice'));
    if(topic){ item.topic = topic; item.tags = [topic]; }
    item.updatedAt = new Date().toISOString();
    saveNotebook(notebook);
    closeModal();
    toast('✓ Saved Mistake আপডেট হয়েছে');
    renderNotebookPage();
  };

  publicApi.deleteItem = function(itemId){
    const notebook = loadNotebook();
    const idx = notebook.findIndex(function(it){ return it.id === itemId; });
    if(idx === -1) return;
    const item = notebook[idx];
    confirmModal('Delete Saved Mistake', 'এই mistake card টি কি ভুল খাতা থেকে মুছে ফেলবে?', function(){
      const nb = loadNotebook();
      nb.splice(nb.findIndex(function(it){ return it.id === itemId; }), 1);
      saveNotebook(nb);
      toast('🗑️ Delete করা হয়েছে');
      renderNotebookPage();
    }, 'Delete', true);
  };

  publicApi.copyJSON = function(itemId){
    const item = loadNotebook().find(function(it){ return it.id === itemId; });
    if(!item) return;
    if(navigator.clipboard){
      navigator.clipboard.writeText(JSON.stringify(item, null, 2)).then(function(){ toast('📋 JSON clipboard-এ কপি হয়েছে'); }).catch(function(){ copyFallback(item); });
    }else{ copyFallback(item); }
  };
  function copyFallback(item){
    const ta = document.createElement('textarea');
    ta.value = JSON.stringify(item, null, 2);
    document.body.appendChild(ta); ta.select();
    try{ document.execCommand('copy'); toast('📋 JSON কপি হয়েছে'); }catch(_){ toast('কপি করা সম্ভব হয়নি'); }
    document.body.removeChild(ta);
  }

  publicApi.showAgentPayload = function(itemId){
    const item = loadNotebook().find(function(it){ return it.id === itemId; });
    if(!item) return;
    const payload = toAgentPayload(item);
    openModal('<h3>🤖 Agent-Ready Payload</h3>' +
      '<p class="muted">এই structured payload পরবর্তী phases-এ Mistake Analysis Agent-এর কাছে পাঠানো হবে। এখনো কোনো API call করা হচ্ছে না।</p>' +
      '<pre style="background:var(--bg); border:1px solid var(--line); border-radius:10px; padding:10px; font-size:11px; overflow:auto; max-height:55vh; white-space:pre-wrap; word-break:break-word;">' + esc(JSON.stringify(payload, null, 2)) + '</pre>' +
      '<div class="row" style="margin-top:12px; gap:8px"><button class="btn ghost" onclick="closeModal()">Close</button>' +
      '<button class="btn sm" onclick="MA.copyJSON(\'' + esc(item.id) + '\'); closeModal();">Copy Full Payload</button></div>');
  };

  publicApi.exportJSON = function(){
    const notebook = loadNotebook();
    const blob = new Blob([JSON.stringify(notebook, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'bhul-khata-' + new Date().toISOString().slice(0,10) + '.json';
    document.body.appendChild(a); a.click();
    document.body.removeChild(a);
    setTimeout(function(){ URL.revokeObjectURL(url); }, 2000);
    toast('Export JSON ডাউনলোড শুরু হয়েছে');
  };

  publicApi.clearAll = function(){
    const notebook = loadNotebook();
    if(!notebook.length){ toast('ভুল খাতা ইতোমধ্যে খালি'); return; }
    confirmModal('Clear All Mistakes', 'ভুল খাতা থেকে সব ' + notebook.length + 'টি mistake card কি মুছে ফেলবে? এই action undo করা যাবে না।', function(){
      saveNotebook([]);
      toast('🗑️ সব mistake card মুছে ফেলা হয়েছে');
      renderNotebookPage();
    }, 'Clear All', true);
  };

  publicApi.renderNotebook = function(){ renderNotebookPage(); };

  function findPending(cardId){
    const pending = window.__maPendingCards || {};
    const found = Object.values(pending).find(function(c){ return c.id === cardId; });
    return found || null;
  }

  window.MA = publicApi;

  /* ---------------- render dispatch hook (additive) -------------------- */
  const oldRender = window.render;
  window.render = function(){
    const p = Router.path;
    if(p === 'mistake-analysis' || p === 'bhul-khata' || p === 'mistake-notebook'){
      setMAState({ search:'', filter:'all' });
      renderNotebookPage();
      return;
    }
    if(p === 'mistake-analysis/view' || p === 'bhul-khata/view'){
      // pending view without a specific question, go to notebook
      renderNotebookPage();
      return;
    }
    if(/^mistake-analysis\/(.+)$/.test(p)){
      const parts = p.split('/');
      const questionId = decodeURIComponent(parts[1]);
      const resultId = parts[2] ? decodeURIComponent(parts[2]) : ((window.LastResult || {}).id || '');
      publicApi.openAnalysis(questionId, resultId);
      return;
    }
    return oldRender.apply(this, arguments);
  };

  /* ---------------- result page: hook into wrong-question review cards - */
  // Adds a "🔍 Mistake Analysis" button next to the existing
  // "📕 ভুলের খাতায় যোগ করুন" action for every wrong question.
  // NOTE: the Phase-3 module wraps renderResultView itself AND calls it
  // directly (bypassing function reference capture), so instead of wrapping
  // renderResultView we patch the resulting DOM after every render cycle.
  function patchResultReviewButtons(resultId){
    const app = document.getElementById('app');
    if(!app) return;
    const cards = app.querySelectorAll('.result-review-card');
    cards.forEach(function(card){
      if(card.dataset.maPatched) return;
      // Find the existing "ভুলের খাতা যোগ" action button.
      let addBtn = null;
      card.querySelectorAll('button').forEach(function(b){
        const oc = (b.getAttribute('onclick') || '');
        if(oc.indexOf('resultAddMistake(') !== -1) addBtn = b;
      });
      if(!addBtn) return;
      const btn = document.createElement('button');
      btn.className = 'result-action';
      btn.type = 'button';
      btn.textContent = '🔍 Analysis';
      btn.addEventListener('click', function(){ publicApi.openAnalysisFromResult(btn, resultId); });
      addBtn.parentNode.insertBefore(btn, addBtn);
      card.dataset.maPatched = '1';
    });
  }
  function tryPatchResultPage(){
    // Only relevant on result / result-detail routes.
    const p = Router.path || '';
    if(p === 'exam/result' || /^exam-result\//.test(p)){
      patchResultReviewButtons(((window.LastResult || {}).id) || '');
    }
  }
  // The app replaces #app innerHTML on every render, and several later
  // modules overwrite window.render (which would wipe a render-hook here).
  // A MutationObserver on #app is order-independent and always catches it.
  const maObserver = new MutationObserver(function(mutations){
    let needsPatch = false;
    mutations.forEach(function(m){
      if(!needsPatch){
        for(let i=0;i<m.addedNodes.length;i++){
          const n = m.addedNodes[i];
          if(n.nodeType === 1 && (n.className === 'result-review-list' ||
             (n.querySelector && n.querySelector('.result-review-card')))){
            needsPatch = true; break;
          }
        }
      }
    });
    if(needsPatch) setTimeout(tryPatchResultPage, 0);
  });
  (function startMaObserver(){
    const app = document.getElementById('app');
    if(app){ maObserver.observe(app, { childList: true, subtree: true }); }
    else { setTimeout(startMaObserver, 300); }
    tryPatchResultPage();
  })();
  publicApi.openAnalysisFromResult = function(btn, resultId){
    // btn lives inside a .result-review-card, find its question id.
    const cardEl = btn.closest('.result-review-card');
    if(!cardEl){ toast('প্রশ্ন তথ্য পাওয়া যায়নি'); return; }
    // The existing resultAddMistake('qid','rid') call encodes both ids.
    let questionId = '';
    let cardResultId = resultId || '';
    cardEl.querySelectorAll('button').forEach(function(b){
      const oc = (b.getAttribute('onclick') || '');
      if(oc.indexOf('resultAddMistake(') !== -1){
        const m = oc.match(/resultAddMistake\('([^']+)'\s*,\s*'([^']+)'/);
        if(m){
          questionId = m[1];
          if(!cardResultId) cardResultId = m[2];
        }
      }
    });
    if(!questionId) return;
    MA.openAnalysis(questionId, cardResultId);
  };
  // openAnalysisFromResult is hoisted for the click handler above.
  // (defined below in module order; referenced safely via window.MA at click time)

  /* ---------------- history detail route helper ------------------------ */
  // When opening a past result (history/:id), wrong cards also get the
  // analysis entry via the same patch above (renderResultView shared).
})();
