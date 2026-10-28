(() => {
  'use strict';

  const SH_KEY = 'admission_study_hub_v1';
  const TIMER_TICK = 1000;
  let timerHandle = null;

  const defaultState = () => ({
    removedMistakes: [],
    manualMistakes: [],
    mistakeMeta: {},
    revisions: [],
    notes: [],
    countdown: null,
    focusTimer: { duration: 1500, remaining: 1500, running: false, startedAt: null }
  });

  const readState = () => {
    try {
      const raw = JSON.parse(localStorage.getItem(SH_KEY) || 'null');
      return { ...defaultState(), ...(raw && typeof raw === 'object' ? raw : {}) };
    } catch (_) {
      return defaultState();
    }
  };
  const saveState = (state) => {
    try { localStorage.setItem(SH_KEY, JSON.stringify(state)); } catch (_) { toast('Could not save Study Hub data'); }
  };
  const state = () => readState();
  const save = (next) => { saveState(next); return next; };
  const htmlEsc = (value) => typeof esc === 'function' ? esc(value == null ? '' : String(value)) : String(value == null ? '' : value).replace(/[&<>"']/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  const safeToast = (message) => typeof toast === 'function' ? toast(message) : window.alert(message);
  const route = (name) => `study-hub/${name}`;
  const hasFn = (name) => typeof window[name] === 'function';
  const now = () => Date.now();

  const toolCatalog = [
    { id: 'mistake-book', icon: '🔥', title: 'Mistake Book', subtitle: 'Review what went wrong', tone: 'coral' },
    { id: 'revision', icon: '🧠', title: 'Revision', subtitle: 'Keep topics on track', tone: 'violet' },
    { id: 'bookmarks', icon: '🔖', title: 'Bookmarks', subtitle: 'Save important questions', tone: 'gold' },
    { id: 'quick-notes', icon: '📝', title: 'Quick Notes', subtitle: 'Capture a thought fast', tone: 'cyan' },
    { id: 'focus-timer', icon: '⏱', title: 'Focus Timer', subtitle: 'Study without distraction', tone: 'blue' },
    { id: 'exam-countdown', icon: '📅', title: 'Exam Countdown', subtitle: 'Know what is ahead', tone: 'navy' }
  ];

  function subjectLabel(id) {
    try { return typeof subjectName === 'function' ? subjectName(id) : (id || 'General'); } catch (_) { return id || 'General'; }
  }
  function topicLabel(id) {
    try { return typeof topicName === 'function' ? topicName(id) : (id || 'General'); } catch (_) { return id || 'General'; }
  }
  function questionById(id) {
    return (CACHE?.questions || []).find((item) => item.id === id) || null;
  }
  function cardButton(inner, className = '') {
    return `<button type="button" class="sh-tool-card ${className}" onclick="navigate('${route(inner.id)}')"><span class="sh-tool-icon">${inner.icon}</span><span class="sh-tool-copy"><strong>${inner.title}</strong><small>${inner.subtitle}</small></span><span class="sh-arrow">→</span></button>`;
  }
  function backToHub() { return `navigate('study-hub')`; }
  function shell(content, title, back = "navigate('study-hub')") {
    document.body.classList.add('study-hub-active');
    renderShell(`<div class="study-hub-view">${content}</div>`, { title, back });
  }
  function sectionIntro(kicker, title, subtitle) {
    return `<div class="sh-intro"><div class="sh-kicker">${kicker}</div><h2>${title}</h2><p>${subtitle}</p></div>`;
  }
  function empty(icon, title, body, action = '') {
    return `<div class="sh-empty"><div class="sh-empty-icon">${icon}</div><strong>${title}</strong><p>${body}</p>${action}</div>`;
  }
  function actionButton(label, onclick, className = 'sh-button') {
    return `<button type="button" class="${className}" onclick="${onclick}">${label}</button>`;
  }

  function renderStudyHub() {
    const cards = toolCatalog.map((tool) => cardButton(tool, `sh-tone-${tool.tone}`)).join('');
    shell(`${sectionIntro('YOUR PRIVATE TOOLKIT', 'Study Hub', 'Everything you need to stay on track')}
      <div class="sh-hub-hero"><div><span class="sh-hero-orb">✦</span><strong>Study with intention.</strong><p>Your focused space for mistakes, revision, notes and exam readiness.</p></div><span class="sh-hero-mark">SH</span></div>
      <div class="sh-tool-grid">${cards}</div>`, 'Study Hub', "navigate('dashboard')");
  }

  function dashboardCleanup() {
    const currentRoute = String(window.Router?.path || location.hash.replace(/^#\/?/, '').split('?')[0] || 'dashboard');
    if (currentRoute !== 'dashboard') return;
    const page = document.querySelector('#app .page');
    if (!page) return;

    page.querySelectorAll('[data-study-hub-dashboard-card]').forEach((node) => node.remove());
    const section = document.createElement('section');
    section.className = 'sh-dashboard-entry';
    section.dataset.studyHubDashboardCard = '';
    section.innerHTML = `<div class="sh-dashboard-card" role="button" tabindex="0" onclick="navigate('study-hub')" onkeydown="if(event.key==='Enter'||event.key===' ')navigate('study-hub')"><div class="sh-dashboard-card-glow"></div><div class="sh-dashboard-card-top"><span class="sh-dashboard-icon">✦</span><span class="sh-dashboard-badge">6 TOOLS</span></div><strong>STUDY HUB</strong><p>Your essential admission toolkit</p><div class="sh-preview">Mistake Book <i>·</i> Revision <i>·</i> Bookmarks <i>·</i> Quick Notes <i>·</i> Focus <i>·</i> Countdown</div><span class="sh-dashboard-cta">Open Study Hub <b>→</b></span></div>`;
    const dashboardRoot = page.querySelector('.dashboard-existing') || page;
    dashboardRoot.insertBefore(section, dashboardRoot.firstChild || null);

    const existingStudio = page.querySelector('[data-experience-studio-entry]');
    if (existingStudio) existingStudio.remove();
    const studioSection = document.createElement('section');
    studioSection.className = 'es-dashboard-entry';
    studioSection.dataset.experienceStudioEntry = '';
    studioSection.innerHTML = `<button type="button" class="es-dashboard-card" onclick="navigate('experience-studio')" aria-label="Open Experience Studio"><span class="es-dashboard-orb">✨</span><span class="es-dashboard-copy"><small>PREMIUM TOOL · FUTURE EXPERIENCES</small><strong>Experience Studio</strong><em>Shape the next layer of your personal study space.</em></span><span class="es-dashboard-arrow">↗</span></button>`;
    page.appendChild(studioSection);
  }

  function getMistakeRows() {
    const s = state();
    const removed = new Set(s.removedMistakes || []);
    const meta = s.mistakeMeta || {};
    const rows = new Map();
    (CACHE?.mistakes || []).forEach((mistake) => {
      const q = questionById(mistake.questionId);
      const key = mistake.questionId || mistake.id;
      if (!key || removed.has(key)) return;
      rows.set(key, {
        id: `db-${key}`, questionId: mistake.questionId, question: q?.question || mistake.question || 'Saved mistake', options: q?.options || mistake.options || [], correctAnswer: q ? (q.options || [])[Number(q.answerIndex ?? q.answer ?? mistake.correctAnswerIndex ?? 0)] : (mistake.correctAnswer || ''), subject: subjectLabel(q?.subjectId || mistake.subjectId), topic: topicLabel(q?.topicId || mistake.topicId), wrongCount: Number(mistake.wrongCount || 1), reviewed: Boolean(meta[key]?.reviewed || mistake.mastered), note: meta[key]?.note || mistake.note || '', source: 'question-bank'
      });
    });
    (s.manualMistakes || []).forEach((mistake) => {
      const key = mistake.questionId || mistake.id;
      if (!key || removed.has(key)) return;
      rows.set(key, { ...mistake, id: mistake.id || `manual-${key}`, subject: mistake.subject || 'General', topic: mistake.topic || 'General', options: mistake.options || [], reviewed: Boolean(meta[key]?.reviewed || mistake.reviewed), note: meta[key]?.note || mistake.note || '', source: mistake.source || 'manual' });
    });
    return [...rows.values()].sort((a, b) => Number(b.wrongCount || 0) - Number(a.wrongCount || 0));
  }
  function saveMistakeMeta(key, patch) {
    const s = state();
    s.mistakeMeta = { ...(s.mistakeMeta || {}), [key]: { ...(s.mistakeMeta?.[key] || {}), ...patch } };
    save(s);
  }
  function renderMistakeBook() {
    const rows = getMistakeRows();
    const query = (window.studyHubMistakeQuery || '').trim().toLowerCase();
    const filtered = rows.filter((row) => [row.question, row.subject, row.topic, row.note].join(' ').toLowerCase().includes(query));
    const cards = filtered.map((row) => `<article class="sh-list-card sh-mistake-card ${row.reviewed ? 'is-reviewed' : ''}"><div class="sh-list-head"><div><span class="sh-meta">${htmlEsc(row.subject)} · ${htmlEsc(row.topic)}</span><h3>${htmlEsc(row.question)}</h3></div><span class="sh-count">${row.wrongCount || 1}×</span></div>${row.options?.length ? `<div class="sh-options">${row.options.slice(0,4).map((option, index) => `<span><b>${String.fromCharCode(65 + index)}</b>${htmlEsc(option)}</span>`).join('')}</div>` : ''}<div class="sh-answer">Correct answer: <strong>${htmlEsc(row.correctAnswer || 'Not recorded')}</strong></div><label class="sh-note-label">My mistake<textarea placeholder="Write a short note about this mistake" onchange="studyHubUpdateMistakeNote('${htmlEsc(row.questionId || row.id)}', this.value)">${htmlEsc(row.note || '')}</textarea></label><div class="sh-card-actions">${row.questionId && hasFn('startQuestionPractice') ? actionButton('Practice', `startQuestionPractice(['${htmlEsc(row.questionId)}'])`, 'sh-button sh-button-primary') : ''}${actionButton(row.reviewed ? 'Reviewed' : 'Mark reviewed', `studyHubToggleMistakeReviewed('${htmlEsc(row.questionId || row.id)}')`, 'sh-button sh-button-soft')}${actionButton('Remove', `studyHubRemoveMistake('${htmlEsc(row.questionId || row.id)}')`, 'sh-button sh-button-danger')}</div></article>`).join('');
    const addFromBank = (CACHE?.questions || []).filter((q) => !rows.some((row) => row.questionId === q.id)).slice(0, 80);
    const addOptions = addFromBank.map((q) => `<option value="${htmlEsc(q.id)}">${htmlEsc((q.question || '').slice(0, 90))}</option>`).join('');
    shell(`${sectionIntro('REVIEW WITH HONESTY', 'Mistake Book', 'Turn incorrect answers into your highest-impact revision.')}
      <div class="sh-toolbar"><input class="sh-search" type="search" placeholder="Search mistakes" value="${htmlEsc(window.studyHubMistakeQuery || '')}" oninput="window.studyHubMistakeQuery=this.value;renderMistakeBook()"><button type="button" class="sh-icon-action" onclick="studyHubOpenMistakeForm()" aria-label="Add mistake">＋</button></div>
      <div class="sh-inline-panel"><div><strong>Add from Question Bank</strong><small>Reuse an existing question without creating duplicate data.</small></div><select id="studyHubMistakeQuestion"><option value="">Choose a question</option>${addOptions}</select>${actionButton('Save question', 'studyHubSaveMistakeFromBank()', 'sh-button sh-button-primary')}</div>
      ${filtered.length ? `<div class="sh-list-stack">${cards}</div>` : empty('✓', query ? 'No matching mistakes' : 'No mistakes saved yet', query ? 'Try another search term.' : 'Your incorrect questions will appear here after practice.', actionButton('Add a mistake', 'studyHubOpenMistakeForm()', 'sh-button sh-button-primary'))}`, 'Mistake Book');
  }
  window.studyHubUpdateMistakeNote = (key, note) => saveMistakeMeta(key, { note: note.trim() });
  window.studyHubToggleMistakeReviewed = (key) => { saveMistakeMeta(key, { reviewed: !state().mistakeMeta?.[key]?.reviewed }); safeToast('Mistake status updated'); renderMistakeBook(); };
  window.studyHubRemoveMistake = (key) => {
    const remove = () => { const s = state(); s.removedMistakes = [...new Set([...(s.removedMistakes || []), key])]; s.manualMistakes = (s.manualMistakes || []).filter((item) => (item.questionId || item.id) !== key); save(s); safeToast('Removed from Study Hub'); renderMistakeBook(); };
    if (hasFn('confirmModal')) confirmModal('Remove mistake', 'This removes the item from Study Hub without deleting your original exam history.', remove, 'Remove', true); else if (window.confirm('Remove this mistake?')) remove();
  };
  window.studyHubSaveMistakeFromBank = () => {
    const id = document.getElementById('studyHubMistakeQuestion')?.value;
    if (!id) return safeToast('Choose a question first');
    const q = questionById(id); if (!q) return safeToast('Question not found');
    const s = state(); s.removedMistakes = (s.removedMistakes || []).filter((item) => item !== id); s.manualMistakes = [...(s.manualMistakes || []).filter((item) => (item.questionId || item.id) !== id), { id: `bank-${id}`, questionId: id, question: q.question, options: q.options || [], correctAnswer: (q.options || [])[Number(q.answerIndex ?? q.answer ?? 0)] || '', subject: subjectLabel(q.subjectId), topic: topicLabel(q.topicId), wrongCount: 1, source: 'question-bank', createdAt: now() }]; save(s); safeToast('Saved to Mistake Book'); renderMistakeBook();
  };
  window.studyHubOpenMistakeForm = () => openModal(`<h3>Add mistake</h3><label class="flabel">Question</label><textarea id="shMistakeQuestion" placeholder="Write the question"></textarea><label class="flabel">Options, one per line</label><textarea id="shMistakeOptions" placeholder="Option A\nOption B\nOption C\nOption D"></textarea><label class="flabel">Correct answer</label><input id="shMistakeAnswer" type="text" placeholder="B"><label class="flabel">My mistake</label><textarea id="shMistakeNote" placeholder="What did you misunderstand?"></textarea><button class="btn" style="margin-top:14px" onclick="studyHubSaveManualMistake()">Save mistake</button>`);
  window.studyHubSaveManualMistake = () => {
    const question = document.getElementById('shMistakeQuestion')?.value.trim(); const options = (document.getElementById('shMistakeOptions')?.value || '').split('\n').map((item) => item.trim()).filter(Boolean); const correctAnswer = document.getElementById('shMistakeAnswer')?.value.trim(); const note = document.getElementById('shMistakeNote')?.value.trim();
    if (!question) return safeToast('Question is required');
    const s = state(); const id = `manual-${now().toString(36)}-${Math.random().toString(36).slice(2,7)}`; s.manualMistakes = [...(s.manualMistakes || []), { id, questionId: id, question, options, correctAnswer, note, wrongCount: 1, source: 'manual', createdAt: now() }]; save(s); closeModal(); safeToast('Mistake saved'); renderMistakeBook();
  };

  function renderRevision() {
    const s = state(); const query = (window.studyHubRevisionQuery || '').trim().toLowerCase(); const subject = window.studyHubRevisionSubject || 'all'; const priority = window.studyHubRevisionPriority || 'all';
    const rows = (s.revisions || []).filter((item) => (!query || `${item.topic} ${item.subject}`.toLowerCase().includes(query)) && (subject === 'all' || item.subject === subject) && (priority === 'all' || item.priority === priority)).sort((a,b) => ({ high:0, medium:1, low:2 }[a.priority] ?? 1) - ({ high:0, medium:1, low:2 }[b.priority] ?? 1) || Number(a.completed) - Number(b.completed) || Number(b.createdAt) - Number(a.createdAt));
    const subjects = [...new Set((s.revisions || []).map((item) => item.subject).filter(Boolean))];
    const cards = rows.map((item) => `<article class="sh-list-card sh-revision-card priority-${htmlEsc(item.priority)} ${item.completed ? 'is-completed' : ''}"><div class="sh-list-head"><div><span class="sh-meta">${htmlEsc(item.subject || 'General')}</span><h3>${htmlEsc(item.topic)}</h3></div><span class="sh-priority">${htmlEsc(item.priority)}</span></div><div class="sh-card-actions">${actionButton(item.completed ? 'Mark for review' : 'Mark revised', `studyHubToggleRevision('${htmlEsc(item.id)}')`, 'sh-button sh-button-soft')}${actionButton('Edit', `studyHubOpenRevisionForm('${htmlEsc(item.id)}')`, 'sh-button sh-button-soft')}${actionButton('Delete', `studyHubDeleteRevision('${htmlEsc(item.id)}')`, 'sh-button sh-button-danger')}</div></article>`).join('');
    shell(`${sectionIntro('KEEP MOVING FORWARD', 'Revision', 'Save the topics that deserve another focused pass.')}
      <div class="sh-toolbar"><input class="sh-search" type="search" placeholder="Search topics" value="${htmlEsc(window.studyHubRevisionQuery || '')}" oninput="window.studyHubRevisionQuery=this.value;renderRevision()"><button type="button" class="sh-icon-action" onclick="studyHubOpenRevisionForm()">＋</button></div>
      <div class="sh-filter-row"><select onchange="window.studyHubRevisionSubject=this.value;renderRevision()"><option value="all">All subjects</option>${subjects.map((item) => `<option value="${htmlEsc(item)}" ${subject === item ? 'selected' : ''}>${htmlEsc(item)}</option>`).join('')}</select><select onchange="window.studyHubRevisionPriority=this.value;renderRevision()"><option value="all">All priorities</option><option value="high" ${priority==='high'?'selected':''}>High</option><option value="medium" ${priority==='medium'?'selected':''}>Medium</option><option value="low" ${priority==='low'?'selected':''}>Low</option></select></div>
      ${rows.length ? `<div class="sh-list-stack">${cards}</div>` : empty('↻', 'Nothing to revise', 'Add a topic whenever you need another review.', actionButton('Add revision', 'studyHubOpenRevisionForm()', 'sh-button sh-button-primary'))}`, 'Revision');
  }
  window.studyHubOpenRevisionForm = (id) => { const item = id ? state().revisions.find((row) => row.id === id) : null; openModal(`<h3>${item ? 'Edit' : 'Add'} revision</h3><label class="flabel">Subject</label><input id="shRevisionSubject" value="${htmlEsc(item?.subject || '')}" placeholder="English"><label class="flabel">Topic</label><input id="shRevisionTopic" value="${htmlEsc(item?.topic || '')}" placeholder="Narration"><label class="flabel">Priority</label><select id="shRevisionPriority"><option value="high" ${item?.priority==='high'?'selected':''}>High</option><option value="medium" ${!item || item?.priority==='medium'?'selected':''}>Medium</option><option value="low" ${item?.priority==='low'?'selected':''}>Low</option></select><button class="btn" style="margin-top:14px" onclick="studyHubSaveRevision(${item ? `'${htmlEsc(id)}'` : 'null'})">Save revision</button>`); };
  window.studyHubSaveRevision = (id) => { const subject = document.getElementById('shRevisionSubject')?.value.trim(); const topic = document.getElementById('shRevisionTopic')?.value.trim(); const priority = document.getElementById('shRevisionPriority')?.value || 'medium'; if (!topic) return safeToast('Topic is required'); const s = state(); if (id) { const item = s.revisions.find((row) => row.id === id); if (item) Object.assign(item, { subject: subject || 'General', topic, priority }); } else s.revisions = [...(s.revisions || []), { id: `rev-${now().toString(36)}`, subject: subject || 'General', topic, priority, completed: false, createdAt: now() }]; save(s); closeModal(); safeToast('Revision saved'); renderRevision(); };
  window.studyHubToggleRevision = (id) => { const s = state(); const item = s.revisions.find((row) => row.id === id); if (item) item.completed = !item.completed; save(s); renderRevision(); };
  window.studyHubDeleteRevision = (id) => { const remove = () => { const s = state(); s.revisions = s.revisions.filter((row) => row.id !== id); save(s); safeToast('Revision deleted'); renderRevision(); }; if (hasFn('confirmModal')) confirmModal('Delete revision', 'Remove this topic from your revision list?', remove, 'Delete', true); else remove(); };

  function renderBookmarks() {
    const query = (window.studyHubBookmarkQuery || '').trim().toLowerCase(); const subject = window.studyHubBookmarkSubject || 'all';
    const rows = (CACHE?.questions || []).filter((q) => q.bookmarked === true && (!query || [q.question, subjectLabel(q.subjectId), topicLabel(q.topicId)].join(' ').toLowerCase().includes(query)) && (subject === 'all' || subjectLabel(q.subjectId) === subject));
    const subjects = [...new Set((CACHE?.questions || []).filter((q) => q.bookmarked).map((q) => subjectLabel(q.subjectId)))];
    const cards = rows.map((q) => `<article class="sh-list-card sh-bookmark-card"><div class="sh-list-head"><div><span class="sh-meta">${htmlEsc(subjectLabel(q.subjectId))} · ${htmlEsc(topicLabel(q.topicId))}</span><h3>${htmlEsc(q.question || 'Untitled question')}</h3></div><span class="sh-bookmark-star">★</span></div><div class="sh-card-actions">${actionButton('Open question', `studyHubOpenQuestion('${htmlEsc(q.id)}')`, 'sh-button sh-button-primary')}${actionButton('Practice', hasFn('startQuestionPractice') ? `startQuestionPractice(['${htmlEsc(q.id)}'])` : `studyHubOpenQuestion('${htmlEsc(q.id)}')`, 'sh-button sh-button-soft')}${actionButton('Remove', `studyHubToggleBookmark('${htmlEsc(q.id)}')`, 'sh-button sh-button-danger')}</div></article>`).join('');
    shell(`${sectionIntro('SAVE THE SIGNAL', 'Bookmarks', 'Keep the questions and ideas you want to revisit.')}
      <div class="sh-toolbar"><input class="sh-search" type="search" placeholder="Search bookmarks" value="${htmlEsc(window.studyHubBookmarkQuery || '')}" oninput="window.studyHubBookmarkQuery=this.value;renderBookmarks()"><span class="sh-result-count">${rows.length} saved</span></div><div class="sh-filter-row"><select onchange="window.studyHubBookmarkSubject=this.value;renderBookmarks()"><option value="all">All subjects</option>${subjects.map((item) => `<option value="${htmlEsc(item)}" ${subject===item?'selected':''}>${htmlEsc(item)}</option>`).join('')}</select></div>
      ${rows.length ? `<div class="sh-list-stack">${cards}</div>` : empty('🔖', 'No bookmarks yet', 'Save important questions from the Question Bank and they will appear here.', actionButton('Open Question Bank', "navigate('question-bank')", 'sh-button sh-button-primary'))}`, 'Bookmarks');
  }
  window.studyHubOpenQuestion = (id) => { if (hasFn('navigate')) navigate(`question/${id}`); };
  window.studyHubToggleBookmark = async (id) => { const q = questionById(id); if (!q) return; q.bookmarked = !q.bookmarked; q.bookmarkUpdatedAt = now(); try { if (hasFn('dbPut')) await dbPut('questions', q); if (hasFn('loadCache')) await loadCache(); safeToast(q.bookmarked ? 'Bookmark saved' : 'Bookmark removed'); renderBookmarks(); } catch (_) { safeToast('Could not update bookmark'); } };

  function renderNotes() {
    const s = state(); const query = (window.studyHubNotesQuery || '').trim().toLowerCase(); const rows = (s.notes || []).filter((note) => !query || [note.title, note.note, note.subject].join(' ').toLowerCase().includes(query)).sort((a,b) => Number(b.pinned) - Number(a.pinned) || Number(b.updatedAt || b.createdAt) - Number(a.updatedAt || a.createdAt));
    const cards = rows.map((note) => `<article class="sh-note-card ${note.pinned ? 'is-pinned' : ''}"><div class="sh-note-head"><span class="sh-note-subject">${htmlEsc(note.subject || 'General')}</span><div>${note.pinned ? '<span class="sh-pin">Pinned</span>' : ''}<button class="sh-small-icon" onclick="studyHubOpenNoteForm('${htmlEsc(note.id)}')">✎</button><button class="sh-small-icon" onclick="studyHubDeleteNote('${htmlEsc(note.id)}')">×</button></div></div><h3>${htmlEsc(note.title)}</h3><p>${htmlEsc(note.note)}</p><small>${new Date(note.updatedAt || note.createdAt).toLocaleDateString()}</small><button class="sh-note-pin" onclick="studyHubToggleNotePin('${htmlEsc(note.id)}')">${note.pinned ? 'Unpin note' : 'Pin important note'}</button></article>`).join('');
    shell(`${sectionIntro('CAPTURE THE MOMENT', 'Quick Notes', 'A simple, fast space for the ideas you do not want to lose.')}
      <div class="sh-toolbar"><input class="sh-search" type="search" placeholder="Search notes" value="${htmlEsc(window.studyHubNotesQuery || '')}" oninput="window.studyHubNotesQuery=this.value;renderNotes()"><button type="button" class="sh-icon-action" onclick="studyHubOpenNoteForm()">＋</button></div>
      ${rows.length ? `<div class="sh-note-grid">${cards}</div>` : empty('✎', 'No notes yet', 'Create your first quick note.', actionButton('New note', 'studyHubOpenNoteForm()', 'sh-button sh-button-primary'))}`, 'Quick Notes');
  }
  window.studyHubOpenNoteForm = (id) => { const note = id ? state().notes.find((row) => row.id === id) : null; openModal(`<h3>${note ? 'Edit' : 'New'} note</h3><label class="flabel">Title</label><input id="shNoteTitle" value="${htmlEsc(note?.title || '')}" placeholder="Vocabulary reminder"><label class="flabel">Note</label><textarea id="shNoteBody" placeholder="Write your note">${htmlEsc(note?.note || '')}</textarea><label class="flabel">Subject / category</label><input id="shNoteSubject" value="${htmlEsc(note?.subject || '')}" placeholder="English"><button class="btn" style="margin-top:14px" onclick="studyHubSaveNote(${note ? `'${htmlEsc(id)}'` : 'null'})">Save note</button>`); };
  window.studyHubSaveNote = (id) => { const title = document.getElementById('shNoteTitle')?.value.trim(); const note = document.getElementById('shNoteBody')?.value.trim(); const subject = document.getElementById('shNoteSubject')?.value.trim(); if (!title || !note) return safeToast('Title and note are required'); const s = state(); if (id) { const item = s.notes.find((row) => row.id === id); if (item) Object.assign(item, { title, note, subject: subject || 'General', updatedAt: now() }); } else s.notes = [...(s.notes || []), { id: `note-${now().toString(36)}`, title, note, subject: subject || 'General', pinned: false, createdAt: now(), updatedAt: now() }]; save(s); closeModal(); safeToast('Note saved'); renderNotes(); };
  window.studyHubDeleteNote = (id) => { const remove = () => { const s = state(); s.notes = s.notes.filter((row) => row.id !== id); save(s); safeToast('Note deleted'); renderNotes(); }; if (hasFn('confirmModal')) confirmModal('Delete note', 'Remove this note permanently?', remove, 'Delete', true); else remove(); };
  window.studyHubToggleNotePin = (id) => { const s = state(); const item = s.notes.find((row) => row.id === id); if (item) item.pinned = !item.pinned; save(s); renderNotes(); };

  function timerState() {
    const s = state(); const timer = { duration: 1500, remaining: 1500, running: false, startedAt: null, ...(s.focusTimer || {}) };
    if (timer.running && timer.startedAt) timer.remaining = Math.max(0, Number(timer.duration) - Math.floor((now() - Number(timer.startedAt)) / 1000));
    if (timer.remaining <= 0) { timer.remaining = 0; timer.running = false; timer.startedAt = null; s.focusTimer = timer; save(s); }
    return timer;
  }
  function fmtSeconds(seconds) { const value = Math.max(0, Math.floor(seconds)); return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`; }
  function renderFocusTimer() {
    const timer = timerState(); const progress = Math.max(0, Math.min(100, Math.round((timer.remaining / Math.max(1, timer.duration)) * 100))); const complete = timer.remaining === 0;
    shell(`${sectionIntro('DEEP WORK, ONE SESSION', 'Focus Timer', 'A distraction-free timer for the next focused block.')}
      <div class="sh-timer-panel ${complete ? 'is-complete' : ''}"><div class="sh-timer-ring" style="--sh-progress:${progress}%"><div><span>${complete ? 'Done' : 'FOCUS'}</span><strong id="shTimerValue">${fmtSeconds(timer.remaining)}</strong></div></div><p>${complete ? 'Excellent work. Take a short reset before the next session.' : timer.running ? 'Stay with the task in front of you.' : 'Choose a preset and begin when you are ready.'}</p><div class="sh-timer-actions">${timer.running ? actionButton('Pause', 'studyHubPauseTimer()', 'sh-button sh-button-primary') : actionButton(timer.remaining < timer.duration && timer.remaining > 0 ? 'Resume' : 'Start', 'studyHubStartTimer()', 'sh-button sh-button-primary')}${actionButton('Reset', 'studyHubResetTimer()', 'sh-button sh-button-soft')}</div></div>
      <div class="sh-presets"><button onclick="studyHubSetTimer(1500)" class="${timer.duration===1500?'active':''}">25 min</button><button onclick="studyHubSetTimer(3000)" class="${timer.duration===3000?'active':''}">50 min</button><button onclick="studyHubOpenCustomTimer()" class="${timer.duration!==1500&&timer.duration!==3000?'active':''}">Custom</button></div>`, 'Focus Timer');
    clearInterval(timerHandle); if (timer.running && Router.path === route('focus-timer')) timerHandle = setInterval(() => { if (Router.path === route('focus-timer')) renderFocusTimer(); else clearInterval(timerHandle); }, TIMER_TICK);
  }
  window.studyHubSetTimer = (seconds) => { const s = state(); s.focusTimer = { duration: seconds, remaining: seconds, running: false, startedAt: null }; save(s); renderFocusTimer(); };
  window.studyHubOpenCustomTimer = () => openModal(`<h3>Custom focus session</h3><label class="flabel">Minutes</label><input id="shCustomMinutes" type="number" min="1" max="180" value="35"><button class="btn" style="margin-top:14px" onclick="studyHubSaveCustomTimer()">Set timer</button>`);
  window.studyHubSaveCustomTimer = () => { const minutes = Math.max(1, Math.min(180, Number(document.getElementById('shCustomMinutes')?.value || 0))); if (!minutes) return safeToast('Enter a valid duration'); closeModal(); studyHubSetTimer(minutes * 60); };
  window.studyHubStartTimer = () => { const s = state(); const timer = timerState(); timer.running = true; timer.startedAt = now() - (Number(timer.duration) - Number(timer.remaining)) * 1000; s.focusTimer = timer; save(s); renderFocusTimer(); };
  window.studyHubPauseTimer = () => { const s = state(); const timer = timerState(); timer.running = false; timer.startedAt = null; s.focusTimer = timer; save(s); renderFocusTimer(); safeToast('Timer paused'); };
  window.studyHubResetTimer = () => { const reset = () => { const s = state(); const timer = timerState(); timer.remaining = timer.duration; timer.running = false; timer.startedAt = null; s.focusTimer = timer; save(s); renderFocusTimer(); }; if (hasFn('confirmModal')) confirmModal('Reset timer', 'Start this focus session again from the beginning?', reset, 'Reset', true); else reset(); };

  function countdownDays(date) { if (!date) return null; const target = new Date(`${date}T23:59:59`); return Math.ceil((target.getTime() - now()) / 86400000); }
  function renderCountdown() {
    const item = state().countdown; const days = countdownDays(item?.date); const display = days == null ? '-' : Math.max(0, days); const label = days == null ? 'DAYS LEFT' : days < 0 ? 'EXAM PASSED' : days === 0 ? 'EXAM DAY' : 'DAYS LEFT';
    shell(`${sectionIntro('MAKE THE DATE VISIBLE', 'Exam Countdown', 'Keep your admission exam in view without adding pressure.')}
      <div class="sh-countdown-card"><div class="sh-countdown-ambient"></div><span class="sh-countdown-label">${htmlEsc(item?.name || 'Your next admission exam')}</span><strong>${display}</strong><span class="sh-countdown-days">${label}</span>${item ? `<div class="sh-countdown-date">Exam date · ${new Date(`${item.date}T12:00:00`).toLocaleDateString('en-GB', { day:'numeric', month:'long', year:'numeric' })}</div>` : '<div class="sh-countdown-date">Add an exam date to begin</div>'}<div class="sh-card-actions">${actionButton(item ? 'Edit date' : 'Add exam date', 'studyHubOpenCountdownForm()', 'sh-button sh-button-primary')}${item ? actionButton('Reset', 'studyHubResetCountdown()', 'sh-button sh-button-soft') : ''}</div></div>`, 'Exam Countdown');
  }
  window.studyHubOpenCountdownForm = () => { const item = state().countdown; openModal(`<h3>${item ? 'Edit' : 'Add'} exam countdown</h3><label class="flabel">Exam name</label><input id="shCountdownName" value="${htmlEsc(item?.name || '')}" placeholder="DU Admission Test"><label class="flabel">Exam date</label><input id="shCountdownDate" type="date" value="${htmlEsc(item?.date || '')}"><button class="btn" style="margin-top:14px" onclick="studyHubSaveCountdown()">Save countdown</button>`); };
  window.studyHubSaveCountdown = () => { const name = document.getElementById('shCountdownName')?.value.trim(); const date = document.getElementById('shCountdownDate')?.value; if (!name || !date) return safeToast('Exam name and date are required'); if (Number.isNaN(new Date(`${date}T12:00:00`).getTime())) return safeToast('Choose a valid date'); const s = state(); s.countdown = { name, date, updatedAt: now() }; save(s); closeModal(); safeToast('Countdown saved'); renderCountdown(); };
  window.studyHubResetCountdown = () => { const remove = () => { const s = state(); s.countdown = null; save(s); safeToast('Countdown reset'); renderCountdown(); }; if (hasFn('confirmModal')) confirmModal('Reset countdown', 'Remove this exam date from Study Hub?', remove, 'Reset', true); else remove(); };

  function renderTool(path) {
    if (path === route('mistake-book')) return renderMistakeBook();
    if (path === route('revision')) return renderRevision();
    if (path === route('bookmarks')) return renderBookmarks();
    if (path === route('quick-notes')) return renderNotes();
    if (path === route('focus-timer')) return renderFocusTimer();
    if (path === route('exam-countdown')) return renderCountdown();
    return renderStudyHub();
  }

  const originalRender = window.render;
  const originalDashboard = window.renderDashboard;
  window.renderDashboard = function studyHubDashboardRenderer() {
    if (typeof originalDashboard === 'function') originalDashboard.apply(this, arguments);
    dashboardCleanup();
    setTimeout(dashboardCleanup, 0);
    setTimeout(dashboardCleanup, 60);
  };
  const studyHubRender = function studyHubRouteRenderer() {
    const current = (window.Router && Router.path) || location.hash.replace(/^#/, '') || 'dashboard';
    if (current === 'study-hub' || current.startsWith('study-hub/')) return renderTool(current);
    document.body.classList.remove('study-hub-active');
    return originalRender.apply(this, arguments);
  };
  window.render = studyHubRender;
  try { render = studyHubRender; } catch (_) {}
  window.renderStudyHub = renderStudyHub;
  window.studyHubToolCatalog = toolCatalog;

  const style = document.createElement('style');
  style.id = 'study-hub-style-v1';
  style.textContent = `
    body.study-hub-active{background:linear-gradient(180deg,#eef6ff 0%,#f7fbff 58%,#edf5ff 100%);color:#10233f}
    body.study-hub-active .topbar{background:rgba(248,252,255,.88);border-bottom:1px solid rgba(37,99,235,.10);box-shadow:0 6px 20px rgba(30,64,175,.06)}
    body.study-hub-active .topbar h1{color:#10233f}
    body.study-hub-active .backbtn{color:#1d4ed8}
    .study-hub-view{position:relative;isolation:isolate;min-height:calc(100dvh - 90px);padding:2px 0 26px;color:#10233f}
    .study-hub-view:before,.study-hub-view:after{content:'';position:absolute;z-index:-1;border-radius:999px;filter:blur(2px);pointer-events:none}
    .study-hub-view:before{width:190px;height:190px;right:-90px;top:30px;background:radial-gradient(circle,rgba(96,165,250,.20),transparent 68%)}
    .study-hub-view:after{width:170px;height:170px;left:-100px;bottom:70px;background:radial-gradient(circle,rgba(129,140,248,.14),transparent 68%)}
    .sh-intro{padding:8px 3px 16px;position:relative}
    .sh-kicker{font-size:10px;letter-spacing:.16em;font-weight:900;color:#2563eb;text-transform:uppercase}
    .sh-intro h2{font-size:28px;line-height:1.12;letter-spacing:-.04em;margin:6px 0 7px;color:#10233f}
    .sh-intro p{font-size:13px;line-height:1.55;color:#5d7394;margin:0;max-width:310px}
    .sh-hub-hero{position:relative;overflow:hidden;display:flex;align-items:flex-start;justify-content:space-between;gap:14px;margin:4px 0 20px;padding:20px;border:1px solid rgba(96,165,250,.22);border-radius:24px;background:linear-gradient(135deg,#0f3b91 0%,#2563eb 58%,#38bdf8 130%);color:#fff;box-shadow:0 18px 34px rgba(37,99,235,.22)}
    .sh-hub-hero:before{content:'';position:absolute;width:130px;height:130px;right:-35px;top:-55px;border:1px solid rgba(255,255,255,.22);border-radius:50%;box-shadow:0 0 0 16px rgba(255,255,255,.05),0 0 0 34px rgba(255,255,255,.035)}
    .sh-hub-hero strong,.sh-hub-hero p,.sh-hero-orb,.sh-hero-mark{position:relative;z-index:1}
    .sh-hub-hero strong{display:block;font-size:18px;letter-spacing:-.02em}.sh-hub-hero p{max-width:245px;margin:7px 0 0;color:rgba(255,255,255,.78);font-size:12px;line-height:1.5}.sh-hero-orb{display:inline-grid;place-items:center;width:28px;height:28px;margin-bottom:10px;border-radius:10px;background:rgba(255,255,255,.16);font-size:16px}.sh-hero-mark{font-size:11px;letter-spacing:.15em;font-weight:900;color:rgba(255,255,255,.58)}
    .sh-tool-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:11px}
    .sh-tool-card{position:relative;overflow:hidden;min-height:142px;width:100%;border:1px solid rgba(37,99,235,.13);border-radius:20px;padding:15px 13px;background:rgba(255,255,255,.83);color:#10233f;text-align:left;display:flex;flex-direction:column;align-items:flex-start;justify-content:space-between;gap:12px;box-shadow:0 10px 24px rgba(30,64,175,.08);cursor:pointer;transition:transform .18s cubic-bezier(.23,1,.32,1),box-shadow .18s ease,border-color .18s ease,background .18s ease}
    .sh-tool-card:before{content:'';position:absolute;width:75px;height:75px;right:-25px;top:-25px;border-radius:50%;background:var(--sh-glow,rgba(37,99,235,.10));pointer-events:none}.sh-tool-card:hover{transform:translateY(-2px);border-color:rgba(37,99,235,.30);box-shadow:0 15px 28px rgba(30,64,175,.13)}.sh-tool-card:active{transform:scale(.97)}
    .sh-tool-icon{position:relative;z-index:1;display:grid;place-items:center;width:38px;height:38px;border-radius:13px;background:var(--sh-icon-bg,#eaf2ff);font-size:20px}.sh-tool-copy{position:relative;z-index:1;min-width:0}.sh-tool-copy strong,.sh-tool-copy small{display:block}.sh-tool-copy strong{font-size:13px;line-height:1.25}.sh-tool-copy small{font-size:10.5px;line-height:1.35;color:#657b9a;margin-top:4px}.sh-arrow{position:absolute;right:12px;bottom:12px;color:#2563eb;font-size:17px;font-weight:800;transition:transform .18s ease}.sh-tool-card:hover .sh-arrow{transform:translateX(3px)}
    .sh-tone-coral{--sh-glow:rgba(251,113,133,.13);--sh-icon-bg:#fff0f1}.sh-tone-violet{--sh-glow:rgba(139,92,246,.13);--sh-icon-bg:#f1edff}.sh-tone-gold{--sh-glow:rgba(245,158,11,.15);--sh-icon-bg:#fff7df}.sh-tone-cyan{--sh-glow:rgba(6,182,212,.13);--sh-icon-bg:#e8fbff}.sh-tone-blue{--sh-glow:rgba(37,99,235,.13);--sh-icon-bg:#eaf2ff}.sh-tone-navy{--sh-glow:rgba(30,64,175,.16);--sh-icon-bg:#e7edff}
    .sh-dashboard-entry{margin:0 0 24px;position:relative}.sh-dashboard-card{position:relative;overflow:hidden;display:block;width:100%;padding:19px 18px 17px;border:1px solid rgba(96,165,250,.30);border-radius:23px;background:linear-gradient(135deg,#102f78 0%,#1d4ed8 62%,#38bdf8 140%);color:#fff;box-shadow:0 17px 32px rgba(29,78,216,.22);cursor:pointer;transition:transform .18s cubic-bezier(.23,1,.32,1),box-shadow .18s ease}.sh-dashboard-card:hover{transform:translateY(-2px);box-shadow:0 21px 36px rgba(29,78,216,.27)}.sh-dashboard-card:active{transform:scale(.985)}.sh-dashboard-card:focus-visible{outline:3px solid #93c5fd;outline-offset:3px}.sh-dashboard-card-glow{position:absolute;width:150px;height:150px;right:-50px;top:-80px;border-radius:50%;background:rgba(255,255,255,.12);box-shadow:0 0 0 18px rgba(255,255,255,.04),0 0 0 38px rgba(255,255,255,.025)}.sh-dashboard-card-top{position:relative;display:flex;align-items:center;justify-content:space-between;margin-bottom:11px}.sh-dashboard-icon{display:grid;place-items:center;width:32px;height:32px;border-radius:11px;background:rgba(255,255,255,.16);font-size:17px}.sh-dashboard-badge{font-size:9px;letter-spacing:.13em;font-weight:900;color:rgba(255,255,255,.75)}.sh-dashboard-card>strong{position:relative;display:block;font-size:18px;letter-spacing:.03em}.sh-dashboard-card>p{position:relative;margin:4px 0 11px;color:rgba(255,255,255,.80);font-size:12px}.sh-preview{position:relative;color:rgba(255,255,255,.67);font-size:10px;line-height:1.5}.sh-preview i{font-style:normal;color:#93c5fd;padding:0 2px}.sh-dashboard-cta{position:relative;display:flex;justify-content:space-between;align-items:center;margin-top:16px;padding-top:12px;border-top:1px solid rgba(255,255,255,.16);font-size:12px;font-weight:800}.sh-dashboard-cta b{font-size:18px}
    .sh-toolbar{display:flex;align-items:center;gap:8px;margin:0 0 12px}.sh-search{flex:1;min-width:0!important;border:1px solid rgba(37,99,235,.16)!important;border-radius:13px!important;background:rgba(255,255,255,.88)!important;color:#10233f!important;padding:11px 13px!important;box-shadow:0 5px 15px rgba(30,64,175,.05)}.sh-icon-action{width:43px;height:43px;border:1px solid rgba(37,99,235,.16);border-radius:13px;background:#2563eb;color:#fff;font-size:25px;line-height:1;cursor:pointer;box-shadow:0 8px 16px rgba(37,99,235,.18)}.sh-filter-row{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:13px}.sh-filter-row select{border-color:rgba(37,99,235,.16);background:rgba(255,255,255,.88);color:#23466e;padding:10px 11px;font-size:12px}
    .sh-inline-panel{display:grid;grid-template-columns:1fr;gap:8px;padding:13px;margin-bottom:14px;border:1px solid rgba(37,99,235,.13);border-radius:17px;background:rgba(255,255,255,.67)}.sh-inline-panel strong,.sh-inline-panel small{display:block}.sh-inline-panel strong{font-size:12px}.sh-inline-panel small{color:#6b82a1;font-size:10.5px;margin-top:3px}.sh-inline-panel select{border-color:rgba(37,99,235,.16);background:#fff;color:#23466e;padding:10px 11px;font-size:12px}
    .sh-list-stack{display:flex;flex-direction:column;gap:11px}.sh-list-card,.sh-note-card{border:1px solid rgba(37,99,235,.12);border-radius:18px;background:rgba(255,255,255,.88);padding:15px;box-shadow:0 8px 20px rgba(30,64,175,.06)}.sh-list-card{border-left:4px solid #60a5fa}.sh-mistake-card{border-left-color:#fb7185}.sh-revision-card{border-left-color:#8b5cf6}.sh-revision-card.priority-high{border-left-color:#ef4444}.sh-revision-card.priority-medium{border-left-color:#f59e0b}.sh-revision-card.priority-low{border-left-color:#22c55e}.sh-bookmark-card{border-left-color:#f59e0b}.sh-list-card.is-reviewed,.sh-revision-card.is-completed{opacity:.72}.sh-list-head{display:flex;align-items:flex-start;justify-content:space-between;gap:10px}.sh-list-head h3{font-size:14px;line-height:1.45;margin:5px 0 0;color:#10233f}.sh-meta{display:block;color:#6882a3;font-size:10px;font-weight:800;letter-spacing:.02em}.sh-count,.sh-priority,.sh-bookmark-star{flex:0 0 auto;color:#dc2626;font-size:12px;font-weight:900}.sh-priority{text-transform:capitalize;color:#7c3aed}.sh-bookmark-star{color:#f59e0b;font-size:20px}.sh-options{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:12px}.sh-options span{display:flex;gap:5px;align-items:flex-start;padding:7px 8px;border-radius:9px;background:#f2f6fc;color:#526b8b;font-size:10.5px;line-height:1.35}.sh-options b{color:#2563eb}.sh-answer{margin-top:11px;padding:9px 10px;border-radius:10px;background:#eef8f2;color:#24704b;font-size:11px}.sh-note-label{display:block;color:#6882a3;font-size:10.5px;font-weight:800;margin-top:11px}.sh-note-label textarea{min-height:54px;margin-top:5px;padding:9px 10px;font-size:12px;border-color:rgba(37,99,235,.13);background:#fbfdff}.sh-card-actions{display:flex;flex-wrap:wrap;gap:7px;margin-top:12px}.sh-button{display:inline-flex;align-items:center;justify-content:center;min-height:37px;width:auto;border:0;border-radius:10px;padding:8px 11px;font-size:11px;font-weight:800;cursor:pointer;transition:transform .14s ease,filter .14s ease}.sh-button:active{transform:scale(.97)}.sh-button-primary{background:#2563eb;color:#fff;box-shadow:0 6px 12px rgba(37,99,235,.16)}.sh-button-soft{background:#edf4ff;color:#2452a3}.sh-button-danger{background:#fff0f1;color:#c2414f}.sh-result-count{font-size:11px;color:#6983a3;font-weight:800;white-space:nowrap}
    .sh-empty{padding:42px 18px;text-align:center;border:1px dashed rgba(37,99,235,.20);border-radius:19px;background:rgba(255,255,255,.54);color:#23466e}.sh-empty-icon{font-size:32px;margin-bottom:9px}.sh-empty strong{display:block;font-size:15px}.sh-empty p{margin:6px auto 15px;max-width:260px;color:#7085a0;font-size:12px;line-height:1.5}
    .sh-note-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}.sh-note-card{position:relative;padding:14px}.sh-note-card.is-pinned{border-color:#f4c75d;box-shadow:0 8px 20px rgba(245,158,11,.12)}.sh-note-head{display:flex;justify-content:space-between;align-items:center;gap:6px}.sh-note-subject,.sh-pin{font-size:9px;font-weight:900;text-transform:uppercase;letter-spacing:.08em;color:#2563eb}.sh-pin{color:#b7791f}.sh-small-icon{border:0;background:transparent;color:#6b82a1;font-size:18px;padding:1px 3px;cursor:pointer}.sh-note-card h3{font-size:13px;line-height:1.35;margin:13px 0 6px}.sh-note-card p{font-size:11.5px;line-height:1.5;color:#5f7695;margin:0 0 12px;white-space:pre-wrap;overflow-wrap:anywhere}.sh-note-card>small{color:#90a0b5;font-size:9px}.sh-note-pin{display:block;border:0;background:transparent;padding:8px 0 0;color:#2563eb;font-size:10px;font-weight:800;cursor:pointer}
    .sh-timer-panel{padding:23px 17px 20px;border:1px solid rgba(37,99,235,.15);border-radius:25px;background:linear-gradient(150deg,#fafdff,#eaf3ff);box-shadow:0 15px 30px rgba(37,99,235,.11);text-align:center}.sh-timer-ring{--sh-progress:100%;width:218px;height:218px;margin:4px auto 16px;border-radius:50%;display:grid;place-items:center;background:conic-gradient(#2563eb var(--sh-progress),#dbeafe 0);box-shadow:0 0 0 10px rgba(147,197,253,.24),0 18px 30px rgba(37,99,235,.14)}.sh-timer-ring>div{width:184px;height:184px;border-radius:50%;display:flex;flex-direction:column;align-items:center;justify-content:center;background:#fafdff}.sh-timer-ring span{font-size:10px;letter-spacing:.17em;font-weight:900;color:#6682a4}.sh-timer-ring strong{font-variant-numeric:tabular-nums;font-size:42px;letter-spacing:-.06em;color:#163f8f;margin-top:7px}.sh-timer-panel p{color:#6882a3;font-size:12px;line-height:1.5;margin:0 auto 16px;max-width:270px}.sh-timer-actions{display:flex;justify-content:center;gap:8px}.sh-presets{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:12px}.sh-presets button{border:1px solid rgba(37,99,235,.15);border-radius:12px;background:rgba(255,255,255,.80);color:#42658e;padding:11px 8px;font-size:12px;font-weight:800;cursor:pointer}.sh-presets button.active{background:#2563eb;color:#fff;border-color:#2563eb;box-shadow:0 7px 14px rgba(37,99,235,.16)}.sh-timer-panel.is-complete{background:linear-gradient(150deg,#f0fdf4,#e0f2fe)}
    .sh-countdown-card{position:relative;overflow:hidden;padding:28px 18px 20px;border-radius:25px;background:linear-gradient(145deg,#0b225a,#1d4ed8 68%,#38bdf8);color:#fff;text-align:center;box-shadow:0 18px 34px rgba(29,78,216,.24)}.sh-countdown-ambient{position:absolute;width:190px;height:190px;right:-55px;top:-70px;border-radius:50%;border:1px solid rgba(255,255,255,.20);box-shadow:0 0 0 18px rgba(255,255,255,.04),0 0 0 38px rgba(255,255,255,.03)}.sh-countdown-label,.sh-countdown-card>strong,.sh-countdown-days,.sh-countdown-date,.sh-countdown-card .sh-card-actions{position:relative;z-index:1}.sh-countdown-label{display:block;font-size:14px;font-weight:800;color:rgba(255,255,255,.86)}.sh-countdown-card>strong{display:block;font-size:92px;line-height:.95;letter-spacing:-.09em;margin:20px 0 7px}.sh-countdown-days{display:block;font-size:11px;letter-spacing:.18em;font-weight:900;color:#bfdbfe}.sh-countdown-date{margin-top:17px;font-size:12px;color:rgba(255,255,255,.78)}.sh-countdown-card .sh-card-actions{justify-content:center;margin-top:20px}.sh-countdown-card .sh-button-primary{background:#fff;color:#1d4ed8}.sh-countdown-card .sh-button-soft{background:rgba(255,255,255,.15);color:#fff}
    @media(max-width:390px){.sh-tool-grid{gap:8px}.sh-tool-card{min-height:134px;padding:13px 11px}.sh-tool-copy strong{font-size:12px}.sh-tool-copy small{font-size:10px}.sh-dashboard-card{padding:17px 15px}.sh-preview{font-size:9px}.sh-note-grid{grid-template-columns:1fr}.sh-timer-ring{width:196px;height:196px}.sh-timer-ring>div{width:166px;height:166px}.sh-timer-ring strong{font-size:37px}}
    @media(prefers-reduced-motion:no-preference){.sh-tool-card,.sh-dashboard-card{animation:shRise .32s cubic-bezier(.23,1,.32,1) both}.sh-tool-card:nth-child(2){animation-delay:.04s}.sh-tool-card:nth-child(3){animation-delay:.08s}.sh-tool-card:nth-child(4){animation-delay:.12s}.sh-tool-card:nth-child(5){animation-delay:.16s}.sh-tool-card:nth-child(6){animation-delay:.20s}.sh-dashboard-card{animation-delay:.05s}@keyframes shRise{from{opacity:0;transform:translateY(7px)}to{opacity:1;transform:translateY(0)}}}
    @media(prefers-reduced-motion:reduce){.sh-tool-card,.sh-dashboard-card{animation:none!important;transition:none!important}}
  `;
  document.head.appendChild(style);
})();
