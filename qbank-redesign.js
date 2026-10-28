(() => {
  const qEsc = s => { const d = document.createElement('div'); d.textContent = String(s ?? ''); return d.innerHTML; };
  const qStats = q => q.stats || { attempts: 0, correct: 0, wrong: 0 };
  const practice = window.QuestionBankPracticeSession || { topicId: '', answers: {}, revealed: {}, recent: [], query: '', visibleCount: 100 };
  window.QuestionBankPracticeSession = practice;

  function resetPracticeSession(topicId = '') {
    practice.topicId = topicId;
    practice.answers = {};
    practice.revealed = {};
    practice.recent = [];
    practice.query = '';
    practice.visibleCount = 100;
    window.BankAnswers = {};
  }

  function getAbbr(name) {
    const n = (name || '').toLowerCase();
    if (n.includes('bangla')) return 'বা';
    if (n.includes('english')) return 'En';
    if (n.includes('gk') || n.includes('general')) return 'GK';
    if (n.includes('math') || n.includes('iba')) return 'M';
    if (n.includes('iq')) return 'IQ';
    if (n.includes('ict') || n.includes('computer')) return 'CS';
    return String(name || '').trim().slice(0, 2).toUpperCase();
  }

  function getBadgeColor(name) {
    const n = (name || '').toLowerCase();
    if (n.includes('bangla')) return '#10b981';
    if (n.includes('english')) return '#3b82f6';
    if (n.includes('gk')) return '#8b5cf6';
    if (n.includes('math') || n.includes('iba')) return '#f59e0b';
    if (n.includes('iq')) return '#06b6d4';
    if (n.includes('ict')) return '#64748b';
    return '#0f6b4f';
  }

  function subjectRow(s) {
    const qs = CACHE.questions.filter(q => q.subjectId === s.id);
    const topics = CACHE.topics.filter(t => t.subjectId === s.id);
    return `<article class="q-nav-card" data-qnav-card data-qnav-name="${qEsc(String(s.name || '').toLocaleLowerCase())}" role="button" tabindex="0" onclick="openRedesignedSubject('${qEsc(s.id)}')" onkeydown="if(event.key==='Enter')openRedesignedSubject('${qEsc(s.id)}')">
      <div class="q-nav-badge" style="background:${getBadgeColor(s.name)}">${qEsc(getAbbr(s.name))}</div>
      <div class="q-nav-info"><strong>${qEsc(s.name)}</strong><span>${topics.length} Topics • ${qs.length} Questions</span></div>
      <span class="q-nav-arrow" aria-hidden="true">›</span>
    </article>`;
  }

  function filterQCards(value) {
    ExplorerState.query = String(value || '').trim().toLocaleLowerCase();
    const list = document.getElementById('qbankNavList');
    if (!list) return;
    const cards = [...list.querySelectorAll('[data-qnav-card]')];
    let visible = 0;
    cards.forEach(card => { const match = !ExplorerState.query || String(card.dataset.qnavName || '').includes(ExplorerState.query); card.hidden = !match; if (match) visible++; });
    let empty = list.querySelector('[data-qnav-empty]');
    if (!empty) { empty = document.createElement('div'); empty.className = 'empty'; empty.dataset.qnavEmpty = '1'; list.appendChild(empty); }
    empty.textContent = visible ? '' : 'No results found.';
    empty.hidden = visible > 0;
  }
  window.filterQCards = filterQCards;

  function topicRow(t) {
    const qs = CACHE.questions.filter(q => q.topicId === t.id);
    return `<article class="q-nav-card q-nav-card-topic" data-qnav-card data-qnav-name="${qEsc(String(t.name || '').toLocaleLowerCase())}" role="button" tabindex="0" onclick="openRedesignedTopic('${qEsc(t.id)}')" onkeydown="if(event.key==='Enter')openRedesignedTopic('${qEsc(t.id)}')">
      <span class="q-topic-icon" aria-hidden="true">📄</span><div class="q-nav-info"><strong>${qEsc(t.name)}</strong></div>
      <div class="q-topic-count">${qs.length} Q</div><span class="q-nav-arrow" aria-hidden="true">›</span>
    </article>`;
  }

  window.ahMoveSubject = async id => { const s=CACHE.subjects.find(x=>x.id===id); if(!s)return; const ordered=[...CACHE.subjects].sort((a,b)=>(a.order||0)-(b.order||0)); const i=ordered.findIndex(x=>x.id===id); if(i<=0)return; const prev=ordered[i-1]; [s.order,prev.order]=[prev.order||i,s.order||i-1]; await dbPut('subjects',s); await dbPut('subjects',prev); CACHE.subjects=await dbGetAll('subjects'); renderQuestionBankV2(); };
  window.ahMoveTopic = async id => { const t=CACHE.topics.find(x=>x.id===id); if(!t)return; const ordered=topicsOf(t.subjectId); const i=ordered.findIndex(x=>x.id===id); if(i<=0)return; const prev=ordered[i-1]; [t.order,prev.order]=[prev.order||i,t.order||i-1]; await dbPut('topics',t); await dbPut('topics',prev); CACHE.topics=await dbGetAll('topics'); renderQuestionBankV2(); };
  window.ahMoveTopicToSubject = async id => { const t=CACHE.topics.find(x=>x.id===id); if(!t)return; const target=prompt('Move topic to subject ID or name',CACHE.subjects.find(s=>s.id!==t.subjectId)?.name||''); const s=CACHE.subjects.find(x=>x.id===target||String(x.name).toLowerCase()===String(target||'').toLowerCase()); if(!s||s.id===t.subjectId){toast('Subject not found');return;} t.subjectId=s.id; t.order=topicsOf(s.id).length; await dbPut('topics',t); CACHE.topics=await dbGetAll('topics'); renderQuestionBankV2(); };
  window.ahDuplicateQuestion = async id => { const q=CACHE.questions.find(x=>x.id===id); if(!q)return; const copy={...q,id:uid(),question:(q.question||'')+' (Copy)',createdAt:Date.now(),updatedAt:Date.now(),stats:{attempts:0,correct:0,wrong:0},bookmarked:false}; await dbPut('questions',copy); CACHE.questions=await dbGetAll('questions'); toast('Question duplicated'); renderQuestionBankV2(); };
  window.ahBulkDeleteQuestions = async ids => { const list=Array.isArray(ids)?ids:[]; if(!list.length||!confirm(`Move ${list.length} selected question${list.length===1?'':'s'} to Deleted Questions?`))return; for(const id of list)await dbDel('questions',id); CACHE.questions=await dbGetAll('questions'); CACHE.deletedQuestions=await dbGetAll('deletedQuestions'); toast(`${list.length} question${list.length===1?'':'s'} moved to Deleted Questions`); renderQuestionBankV2(); };


  window.openRedesignedSubject = id => {
    resetPracticeSession();
    ExplorerState.subjectId = id; ExplorerState.topicId = ''; ExplorerState.query = '';
    location.hash = 'question-bank/subject/' + encodeURIComponent(id);
  };

  window.openRedesignedTopic = id => {
    const t = CACHE.topics.find(x => x.id === id);
    if (!t) return;
    resetPracticeSession(id);
    ExplorerState.subjectId = t.subjectId || ''; ExplorerState.topicId = id; ExplorerState.status = 'all'; ExplorerState.query = '';
    location.hash = 'question-bank/topic/' + encodeURIComponent(id);
  };

  window.leaveTopic = () => {
    const subjectId = ExplorerState.subjectId;
    resetPracticeSession();
    ExplorerState.topicId = ''; ExplorerState.status = 'all';
    location.hash = subjectId ? 'question-bank/subject/' + encodeURIComponent(subjectId) : 'question-bank';
  };

  function renderSubjectList() {
    const subs = [...CACHE.subjects].sort((a, b) => (a.order || 0) - (b.order || 0));
    const search = (ExplorerState.query || '').toLowerCase();
    /* Mistake Bank ও Smart Revision এখন Bank সেকশনের অংশ, আলাদা bottom tab নেই। */
    const bankTools = `<div class="ah-bank-tools">
      <button class="ah-bank-tool" type="button" onclick="navigate('mistakes-bank')"><span class="ic" aria-hidden="true">❌</span><span>Mistake Bank</span><i>›</i></button>
      <button class="ah-bank-tool" type="button" onclick="navigate('smart-revision')"><span class="ic" aria-hidden="true">🔁</span><span>Smart Revision</span><i>›</i></button>
    </div>`;
    const html = `<div class="q-bank-container"><header class="q-bank-header"><div class="row between"><div><h1>প্রশ্ন ব্যাংক</h1><p>সব Subject</p></div><div class="row"><button class="q-header-icon" type="button" aria-label="Search subjects" onclick="toggleQSearch()">${window.ICONS?.search || '🔍'}</button></div></div><div id="qSearchBox" class="q-search-box ${ExplorerState.query ? '' : 'hide'}"><input type="search" placeholder="Search subjects..." value="${qEsc(ExplorerState.query)}" oninput="filterQCards(this.value)"></div></header>${bankTools}<div id="qbankNavList" class="q-list-body ah-subject-grid">${subs.map(subjectRow).join('')}<div class="empty" data-qnav-empty ${subs.length ? 'hidden' : ''}>${subs.length ? '' : 'No subjects found.'}</div></div></div>`;
    renderShell(html, { title: 'Question Bank', back: "navigate('dashboard')" });
    if (search) setTimeout(() => filterQCards(search), 0);
  }

  function renderTopicList() {
    const sub = CACHE.subjects.find(s => s.id === ExplorerState.subjectId);
    if (!sub) { navigate('question-bank'); return; }
    const topics = CACHE.topics.filter(t => t.subjectId === sub.id).sort((a, b) => (a.order || 0) - (b.order || 0));
    const search = (ExplorerState.query || '').toLowerCase();
    const html = `<div class="q-bank-container"><header class="q-bank-header"><div class="row between"><div class="row"><button class="q-back-btn" type="button" aria-label="Back to subjects" onclick="location.hash='question-bank'">‹</button><div><h1>${qEsc(sub.name)}</h1><p>${topics.length} Topics</p></div></div><div class="row"><button class="q-header-icon" type="button" aria-label="Search topics" onclick="toggleQSearch()">${window.ICONS?.search || '🔍'}</button><button class="q-header-icon" type="button" aria-label="Add topic" onclick="openTopicForm('${qEsc(sub.id)}', null)">+</button><button class="q-header-icon" type="button" aria-label="Add question" onclick="ahAddQuestion()">＋Q</button></div></div><div id="qSearchBox" class="q-search-box ${ExplorerState.query ? '' : 'hide'}"><input type="search" placeholder="Search topics..." value="${qEsc(ExplorerState.query)}" oninput="filterQCards(this.value)"></div></header><div id="qbankNavList" class="q-list-body ah-topic-list">${topics.map(topicRow).join('')}<div class="empty" data-qnav-empty ${topics.length ? 'hidden' : ''}>${topics.length ? '' : 'No topics found.'}</div></div></div>`;
    renderShell(html, { title: sub.name, back: "navigate('question-bank')" });
    if (search) setTimeout(() => filterQCards(search), 0);
  }

  function currentTopicQuestions(topicId) { return CACHE.questions.filter(q => q.topicId === topicId); }
  function answerFor(q) { return Number(q.answerIndex ?? q.answer ?? 0); }
  function answeredRows(topicId) { return currentTopicQuestions(topicId).filter(q => practice.answers[q.id]); }
  function accuracy(topicId) { const rows = answeredRows(topicId); return rows.length ? Math.round(rows.filter(q => practice.answers[q.id].correct).length / rows.length * 100) : 0; }
  function sessionMistakes(topicId) { return answeredRows(topicId).filter(q => !practice.answers[q.id].correct).length; }

  function setPracticeFilter(filter) {
    ExplorerState.status = filter;
    practice.visibleCount = 100;
    window.renderQuestionBankV2 ? window.renderQuestionBankV2() : renderQuestionBank();
  }

  function filteredPracticeQuestions(topicId) {
    let all = currentTopicQuestions(topicId);
    const query = String(practice.query || '').trim().toLocaleLowerCase();
    if (query) all = all.filter(q => [q.question, ...(Array.isArray(q.options) ? q.options : [])].join(' ').toLocaleLowerCase().includes(query));
    const filter = ExplorerState.status || 'all';
    if (filter === 'unattempted') return all.filter(q => !practice.answers[q.id]);
    if (filter === 'mistakes') return all.filter(q => practice.answers[q.id] && !practice.answers[q.id].correct);
    if (filter === 'bookmarked') return all.filter(q => q.bookmarked === true);
    if (filter === 'recent') return practice.recent.map(id => all.find(q => q.id === id)).filter(Boolean);
    return all;
  }

  function qCard(q, i, topic, subject) {
    const state = practice.answers[q.id];
    const revealed = practice.revealed[q.id] || state;
    const correct = answerFor(q);
    const status = state ? (state.correct ? 'Correct' : 'Wrong') : 'Unattempted';
    const statusClass = state ? (state.correct ? 'correct' : 'wrong') : 'unattempted';
    const opts = (q.options || []).map((o, j) => {
      let cls = '';
      if (state) { if (j === correct) cls = 'correct'; else if (j === state.selected) cls = 'wrong'; }
      else if (revealed && j === correct) cls = 'correct';
      return `<button class="q-opt-v2 ${cls}" type="button" ${state ? 'disabled' : ''} aria-label="Option ${String.fromCharCode(65 + j)}" onclick="selectTopicAnswer('${qEsc(q.id)}',${j})"><span class="q-opt-letter">${String.fromCharCode(65 + j)}</span><span class="q-opt-text">${qEsc(o)}</span>${cls === 'correct' && (state || revealed) ? '<span class="q-opt-icon">✓</span>' : ''}${cls === 'wrong' ? '<span class="q-opt-icon">✕</span>' : ''}</button>`;
    }).join('');
    return `<article class="q-card-v2 card"><div class="q-card-header"><div class="q-card-meta"><span class="q-card-num">Q ${String(i + 1).padStart(2, '0')}</span><span class="q-breadcrumb">${qEsc(subject?.name || '')} • ${qEsc(topic.name)}</span></div><span class="q-status ${statusClass}">${status}</span></div><div class="q-text-v2">${qEsc(q.question)}</div><div class="q-options-v2">${opts}</div>${revealed ? `<div class="q-explanation-v2 ${state?.correct ? 'correct' : state ? 'wrong' : 'revealed'}"><strong>${state ? (state.correct ? '✓ Correct' : '✕ Wrong') : 'Answer revealed'}</strong><p>Correct answer: ${qEsc((q.options || [])[correct] || '')}</p>${q.explanation ? `<p>${qEsc(q.explanation)}</p>` : ''}</div>` : ''}<footer class="q-card-footer"><span>Accuracy <strong>${accuracy(topic.id)}%</strong></span><span>Mistakes <strong>${sessionMistakes(topic.id)}</strong></span><button class="q-footer-btn ${q.bookmarked ? 'active' : ''}" type="button" aria-pressed="${!!q.bookmarked}" onclick="toggleQuestionBookmark('${qEsc(q.id)}');renderQuestionBankV2()">⭐ ${q.bookmarked ? 'Bookmarked' : 'Bookmark'}</button>${!revealed ? `<button class="q-footer-btn" type="button" onclick="revealTopicAnswer('${qEsc(q.id)}')">Show Answer</button>` : ''}</footer></article>`;
  }

  window.setTopicQuery = window.setTopicQuery || (value => { practice.query = String(value || ''); practice.visibleCount = 100; if (window.__topicSearchTimer) clearTimeout(window.__topicSearchTimer); window.__topicSearchTimer = setTimeout(() => window.renderQuestionBankV2 && window.renderQuestionBankV2(), 180); });
  window.loadMoreTopicQuestions = () => { practice.visibleCount = (Number(practice.visibleCount) || 100) + 100; window.renderQuestionBankV2 ? window.renderQuestionBankV2() : renderQuestionBank(); };

  window.selectTopicAnswer = (qid, idx) => {
    if (practice.topicId !== ExplorerState.topicId || practice.answers[qid]) return;
    const q = CACHE.questions.find(x => x.id === qid);
    if (!q || q.topicId !== ExplorerState.topicId) return;
    const correct = answerFor(q);
    practice.answers[qid] = { selected: idx, correct: idx === correct, answeredAt: Date.now() };
    practice.recent = [qid, ...practice.recent.filter(id => id !== qid)];
    window.renderQuestionBankV2 ? window.renderQuestionBankV2() : renderQuestionBank();
  };

  window.revealTopicAnswer = qid => {
    const q = CACHE.questions.find(x => x.id === qid);
    if (!q || q.topicId !== ExplorerState.topicId || practice.answers[qid]) return;
    practice.revealed[qid] = true;
    window.renderQuestionBankV2 ? window.renderQuestionBankV2() : renderQuestionBank();
  };

  function renderFeed() {
    const topic = CACHE.topics.find(t => t.id === ExplorerState.topicId);
    const sub = CACHE.subjects.find(s => s.id === ExplorerState.subjectId);
    if (!topic || !sub) { navigate('question-bank'); return; }
    if (practice.topicId !== topic.id) resetPracticeSession(topic.id);
    const qs = filteredPracticeQuestions(topic.id);
    const visibleQs = qs.slice(0, Math.max(100, Number(practice.visibleCount) || 100));
    const hasMore = visibleQs.length < qs.length;
    const allCount = currentTopicQuestions(topic.id).length;
    const count = filter => filter === 'all' ? allCount : filter === 'bookmarked' ? currentTopicQuestions(topic.id).filter(q => q.bookmarked).length : filter === 'unattempted' ? currentTopicQuestions(topic.id).filter(q => !practice.answers[q.id]).length : filter === 'mistakes' ? sessionMistakes(topic.id) : practice.recent.length;
    const tabs = [['all','All'],['unattempted','Unattempted'],['mistakes','Mistakes'],['bookmarked','Bookmarked'],['recent','Recent']];
    const html = `<div class="q-bank-container"><header class="q-bank-header"><div class="row between"><div class="row"><button class="q-back-btn" type="button" aria-label="Back to topics" onclick="leaveTopic()">‹</button><div><h1>${qEsc(topic.name)}</h1><p>Practice / ${qEsc(sub.name)} / ${qEsc(topic.name)}</p></div></div></div></header><div class="q-filter-tabs-v2" role="tablist">${tabs.map(([k,l]) => `<button type="button" role="tab" aria-selected="${(ExplorerState.status || 'all') === k}" class="${(ExplorerState.status || 'all') === k ? 'active' : ''}" onclick="setPracticeFilter('${k}')">${l} <span>${count(k)}</span></button>`).join('')}</div><div class="q-search-box"><input type="search" inputmode="search" aria-label="Search questions" placeholder="Search this topic..." value="${qEsc(practice.query || '')}" oninput="setTopicQuery(this.value)"></div><div class="q-feed-summary"><span>${qs.length} question${qs.length === 1 ? '' : 's'}${hasMore ? ` · showing ${visibleQs.length}` : ''}</span><span>${answeredRows(topic.id).length}/${allCount} answered</span></div><div class="q-feed-body">${visibleQs.map((q, i) => qCard(q, i, topic, sub)).join('') || '<div class="empty card">No questions match this filter.</div>'}${hasMore ? '<button class="btn ghost explorer-load" type="button" onclick="loadMoreTopicQuestions()">Load more questions</button>' : ''}</div></div>`;
    renderShell(html, { title: topic.name, back: "leaveTopic()" });
  }

  window.toggleQSearch = () => { const box = document.getElementById('qSearchBox'); if (box) { box.classList.toggle('hide'); if (!box.classList.contains('hide')) box.querySelector('input')?.focus(); } };
  window.renderQuestionBankV2 = () => {
    const p = Router.path;
    if (p.startsWith('question-bank/topic/')) { const tid = decodeURIComponent(p.split('/')[2] || ''); ExplorerState.topicId = tid; const t = CACHE.topics.find(x => x.id === tid); ExplorerState.subjectId = t?.subjectId || ''; return renderFeed(); }
    if (p.startsWith('question-bank/subject/')) { const sid = decodeURIComponent(p.split('/')[2] || ''); ExplorerState.subjectId = sid; ExplorerState.topicId = ''; return renderTopicList(); }
    ExplorerState.subjectId = ''; ExplorerState.topicId = ''; return renderSubjectList();
  };

  const css = `html{scroll-behavior:auto}.ah-bank-tools{display:flex;flex-direction:column;gap:10px;margin-top:12px}.ah-bank-tool{display:flex;align-items:center;gap:12px;width:100%;min-height:56px;padding:12px 14px;border-radius:16px;border:1px solid var(--line);background:var(--card);color:var(--text);font:inherit;font-size:15px;font-weight:700;text-align:left;cursor:pointer;box-shadow:var(--shadow)}.ah-bank-tool:active{transform:scale(.98)}.ah-bank-tool .ic{font-size:20px;flex-shrink:0}.ah-bank-tool span:not(.ic){flex:1;min-width:0}.ah-bank-tool i{font-style:normal;font-size:20px;color:var(--sub)}.q-bank-container{padding-bottom:20px;transform:none;will-change:auto;min-height:calc(100dvh - 120px)}.q-bank-header{margin-bottom:16px}.q-bank-header h1{font-size:24px;font-weight:800;margin:0;color:var(--text)}.q-bank-header p{font-size:13px;color:var(--sub);margin:2px 0 0}.q-header-icon,.q-back-btn{background:none;border:0;cursor:pointer;color:var(--emerald)}.q-header-icon{font-size:20px;padding:8px}.q-back-btn{font-size:32px;padding:0 12px 0 0;line-height:1}.q-search-box{margin-top:12px}.q-search-box input{width:100%;min-height:44px;box-sizing:border-box;padding:10px 14px;border-radius:12px;border:1px solid var(--line);background:var(--card);color:var(--text);font-size:16px;line-height:1.25;-webkit-appearance:none;scroll-margin-top:12px}.q-nav-card{width:100%;display:flex;align-items:center;gap:14px;padding:16px;background:var(--card);border:1px solid var(--line);border-radius:16px;margin-bottom:10px;text-align:left;cursor:pointer;box-shadow:var(--shadow)}.q-nav-card:active{transform:scale(.98)}.q-nav-badge{width:44px;height:44px;border-radius:12px;display:grid;place-items:center;color:#fff;font-weight:800;flex-shrink:0}.q-nav-info{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}.q-nav-info strong{font-size:16px;color:var(--text)}.q-nav-info span{font-size:12px;color:var(--sub)}.q-nav-arrow{font-size:20px;color:var(--sub)}.q-manage-actions{display:flex;gap:4px;flex-shrink:0}.q-manage-icon{width:28px;height:28px;padding:0;display:inline-grid;place-items:center;font-size:14px;border-radius:8px;border:1px solid var(--line);background:var(--bg);cursor:pointer}.q-manage-icon.danger{color:#ef4444}.q-nav-card-topic{gap:8px;padding:12px}.q-nav-card-topic .q-nav-info{flex:1;min-width:0;overflow:hidden}.q-nav-card-topic .q-nav-info strong{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:block}.q-topic-icon{font-size:20px}.q-topic-count{font-size:12px;color:var(--sub);white-space:nowrap}.q-filter-tabs-v2{display:flex;gap:8px;overflow-x:auto;-webkit-overflow-scrolling:touch;margin-bottom:12px;padding-bottom:4px}.q-filter-tabs-v2 button{flex-shrink:0;padding:8px 13px;border-radius:20px;font-size:13px;font-weight:600;background:var(--card);border:1px solid var(--line);color:var(--sub);cursor:pointer}.q-filter-tabs-v2 button.active{background:var(--emerald);color:#fff;border-color:var(--emerald)}.q-filter-tabs-v2 span{font-size:11px;opacity:.8}.q-feed-summary{display:flex;justify-content:space-between;gap:12px;color:var(--sub);font-size:12px;margin:0 2px 12px}.q-card-v2{padding:18px;margin-bottom:14px;content-visibility:auto;contain:layout paint style;contain-intrinsic-size:360px auto}.q-feed-body{contain:layout style;transform:translateZ(0);will-change:contents}.q-card-header{display:flex;align-items:flex-start;justify-content:space-between;gap:10px}.q-card-meta{display:flex;align-items:center;gap:8px;min-width:0;flex-wrap:wrap}.q-card-num{font-size:12px;font-weight:800;color:var(--emerald);text-transform:uppercase;letter-spacing:.5px;white-space:nowrap}.q-breadcrumb{font-size:12px;color:var(--sub);overflow-wrap:anywhere}.q-status{font-size:11px;font-weight:800;border-radius:999px;padding:5px 9px;white-space:nowrap}.q-status.unattempted{background:#f3f4f6;color:#6b7280}.q-status.correct{background:#dcfce7;color:#166534}.q-status.wrong{background:#fee2e2;color:#991b1b}.q-text-v2{font-size:18px;font-weight:700;line-height:1.5;margin:12px 0 18px;color:var(--text)}.q-options-v2{display:flex;flex-direction:column;gap:10px}.q-opt-v2{display:flex;align-items:center;gap:12px;padding:14px;border-radius:12px;border:1px solid var(--line);background:var(--card);color:var(--text);text-align:left;cursor:pointer;font-size:15px}.q-opt-v2:disabled{cursor:default}.q-opt-letter{width:28px;height:28px;border-radius:50%;border:1px solid var(--line);display:grid;place-items:center;font-size:12px;font-weight:700;color:var(--sub);flex-shrink:0}.q-opt-text{flex:1;min-width:0}.q-opt-icon{font-weight:800;font-size:16px}.q-opt-v2.correct{background:#ecfdf5;border-color:#10b981;color:#065f46}.q-opt-v2.correct .q-opt-letter{background:#10b981;border-color:#10b981;color:#fff}.q-opt-v2.wrong{background:#fef2f2;border-color:#ef4444;color:#991b1b}.q-opt-v2.wrong .q-opt-letter{background:#ef4444;border-color:#ef4444;color:#fff}.q-explanation-v2{margin-top:16px;padding:14px;border-radius:12px;font-size:14px;line-height:1.5}.q-explanation-v2.correct{background:#f0fdf4;color:#166534;border-left:4px solid #10b981}.q-explanation-v2.wrong{background:#fff1f2;color:#9f1239;border-left:4px solid #ef4444}.q-explanation-v2.revealed{background:#eff6ff;color:#1e40af;border-left:4px solid #3b82f6}.q-explanation-v2 strong{display:block;margin-bottom:4px;font-size:15px}.q-explanation-v2 p{margin:3px 0}.q-card-footer{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:16px;padding-top:12px;border-top:1px solid var(--line);color:var(--sub);font-size:12px}.q-card-footer>span{white-space:nowrap}.q-footer-btn{border:1px solid var(--line);border-radius:9px;background:var(--card);color:var(--sub);padding:7px 9px;font-size:12px;cursor:pointer}.q-footer-btn.active{color:var(--orange);border-color:var(--orange)}@media(max-width:430px){.q-card-footer{gap:7px}.q-footer-btn{padding:7px 8px}.q-text-v2{font-size:17px}}`;
  if (!document.getElementById('qbank-redesign-style')) { const s = document.createElement('style'); s.id = 'qbank-redesign-style'; s.textContent = css; document.head.appendChild(s); }

  let previousPath = Router.path;
  window.addEventListener('hashchange', () => {
    const next = location.hash.slice(1) || 'dashboard';
    if (previousPath.startsWith('question-bank/topic/') && !next.startsWith('question-bank/topic/')) resetPracticeSession();
    previousPath = next;
  });
})();

function setPracticeFilter(filter) { ExplorerState.status = filter; window.renderQuestionBankV2 ? window.renderQuestionBankV2() : renderQuestionBank(); }
