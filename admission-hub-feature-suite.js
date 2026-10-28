/* Admission Hub additive feature suite
 * Keeps original question records immutable during exam sessions and adds safe tools.
 */
(function () {
  'use strict';
  const escA = (v) => typeof esc === 'function' ? esc(v == null ? '' : String(v)) : String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const uidA = () => typeof uid === 'function' ? uid() : `ah-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
  const refresh = async () => { if (typeof loadCache === 'function') await loadCache(); const current=String(location.hash.replace(/^#\/?/,'').split('?')[0]||''); if(current==='question-bank/settings' && typeof window.renderQuestionBankSettings==='function') return window.renderQuestionBankSettings(); if (typeof render === 'function') render(); };
  const put = (table, value) => dbPut(table, value);
  const state = { format: 'text', text: '', fileName: '', rows: [], rejected: [], parserMode: false, subjectId: '', rootTopicId: '', subTopicId: '', topicId: '', successMessage: '', successAdded: 0, successSkipped: 0, importing: false };

  function cleanLabel(s) { return String(s || '').replace(/^\s*(question|প্রশ্ন|q)\s*\d*\s*[:.)-]?\s*/i, '').trim(); }
  function answerIndex(value, options) {
    if (Number.isInteger(value)) return value >= 0 && value < 4 ? value : -1;
    const x = String(value || '').trim();
    const letter = x.match(/\b([ABCD])\b/i)?.[1];
    if (letter) return 'ABCD'.indexOf(letter.toUpperCase());
    const n = Number(x); if (Number.isInteger(n) && n >= 1 && n <= 4) return n - 1;
    const hit = options.findIndex(o => o.toLowerCase() === x.toLowerCase());
    return hit;
  }
  function normalizeItem(item) {
    const raw = item || {};
    const options = raw.options || raw.choices || raw.answers || [raw.A, raw.B, raw.C, raw.D];
    const opts = Array.from({ length: 4 }, (_, i) => String(options?.[i] ?? '').replace(/^\s*[A-D][.)\-:]\s*/i, '').trim());
    const q = cleanLabel(raw.question || raw.prompt || raw.text || raw.Question || '');
    const answer = answerIndex(raw.answer ?? raw.correctAnswer ?? raw.correct ?? raw.Answer, opts);
    return { question: q, options: opts, answer, explanation: String(raw.explanation || raw.reason || raw.Explanation || '').trim(), subject: String(raw.subject || raw.Subject || 'Imported').trim(), topic: String(raw.topic || raw.Topic || 'General').trim() };
  }
  function parseJson(text) {
    const parsed = JSON.parse(text);
    const arr = Array.isArray(parsed) ? parsed : (parsed.questions || parsed.data || parsed.items || []);
    return arr.map(normalizeItem);
  }
  function parseHtml(text) {
    const doc = new DOMParser().parseFromString(text, 'text/html');
    const explicit = [...doc.querySelectorAll('[data-question], .question, .mcq, .quiz-question')];
    if (explicit.length) return explicit.map(block => parseText(typeof htmlToText === 'function' ? htmlToText(block) : block.textContent || '')).flat();
    return parseText(typeof htmlToText === 'function' ? htmlToText(doc.body) : doc.body?.textContent || '');
  }
  function parseText(text) {
    const source = String(text || '').replace(/\r/g, '');
    const rawLines = source.split('\n');
    const numbered = /^\s*(?:q(?:uestion)?\s*\d+|প্রশ্ন\s*[০-৯\d]+|\d+)\s*[.)।:-]\s*/i;
    const numberedStarts = [];
    rawLines.forEach((line, i) => { if (numbered.test(line)) numberedStarts.push(i); });
    let chunks;
    if (numberedStarts.length) {
      chunks = numberedStarts.map((start, i) => rawLines.slice(start, numberedStarts[i + 1] ?? rawLines.length));
    } else {
      chunks = source.split(/\n\s*\n+/).map(part => part.split('\n')).filter(hasContent);
      if (!chunks.length) chunks = [rawLines];
    }
    return chunks.map(chunk => {
      const lines = chunk.map(x => String(x || '').trim()).filter(Boolean);
      const item = { question: '', options: ['', '', '', ''], answer: -1, explanation: '', subject: 'Imported', topic: 'General' };
      const qLines = []; let field = '';
      lines.forEach(line => {
        const om = line.match(/^\s*([A-D])\s*[.)\-:]\s*(.*)$/i);
        const fm = line.match(/^\s*(answer|correct answer|উত্তর|explanation|ব্যাখ্যা|subject|বিষয়|topic|টপিক)\s*[:：-]\s*(.*)$/i);
        if (om) { item.options['ABCD'.indexOf(om[1].toUpperCase())] = om[2].trim(); field = ''; return; }
        if (fm) { field = fm[1].toLowerCase(); const val = fm[2].trim(); if (/answer|উত্তর/.test(field)) item.answer = answerIndex(val, item.options); else if (/explanation|ব্যাখ্যা/.test(field)) item.explanation = val; else if (/subject|বিষয়/.test(field)) item.subject = val; else item.topic = val; return; }
        if (field === 'explanation' || field === 'ব্যাখ্যা') item.explanation += (item.explanation ? ' ' : '') + line;
        else if (!item.question) qLines.push(line);
      });
      item.question = cleanLabel(qLines.join(' '));
      return normalizeItem(item);
    });
  }
  function parseSource(format, text) {
    if (format === 'json') return parseJson(text);
    if (format === 'html') return parseHtml(text);
    return parseText(text);
  }
  function validRows(rows) {
    const accepted = [], rejected = [];
    rows.forEach((row, i) => {
      const missing = []; if (!row.question) missing.push('question'); if (row.options.filter(Boolean).length < 4) missing.push('A-D options'); if (row.answer < 0) missing.push('answer');
      (missing.length ? rejected : accepted).push({ ...row, row: i + 1, reason: missing.join(', ') });
    }); return { accepted, rejected };
  }
  function parserSubjects() { return [...(CACHE.subjects || [])].sort((a, b) => (a.order || 0) - (b.order || 0)); }
  function parserRoots(subjectId) { return (CACHE.topics || []).filter(t => t.subjectId === subjectId && !t.parentTopicId).sort((a, b) => (a.order || 0) - (b.order || 0)); }
  function parserChildren(parentId) { return (CACHE.topics || []).filter(t => t.parentTopicId === parentId).sort((a, b) => (a.order || 0) - (b.order || 0)); }
  function parserLeaves(parentId, seen = new Set()) { if (!parentId || seen.has(parentId)) return []; seen.add(parentId); const children = parserChildren(parentId); return children.length ? children.flatMap(child => parserLeaves(child.id, new Set(seen))) : (CACHE.topics || []).filter(t => t.id === parentId); }
  function parserSubtopics(rootId) { const children = parserChildren(rootId); return children.length ? parserLeaves(rootId) : []; }
  function parserTopics(subjectId) { return parserRoots(subjectId); }
  function parserSubjectName(id) { return CACHE.subjects.find(s => s.id === id)?.name || '-'; }
  function parserTopicName(id) { return CACHE.topics.find(t => t.id === id)?.name || '-'; }
  function parserQuestionKey(value) { return typeof normalizeQ === 'function' ? normalizeQ(value) : String(value || '').trim().toLowerCase().replace(/\s+/g, ' '); }
  window.ahSetSubject = value => { state.subjectId = value; state.rootTopicId = ''; state.subTopicId = ''; state.topicId = ''; render(); };
  window.ahSetTopic = value => { state.rootTopicId = value; const choices = parserSubtopics(value); state.subTopicId = choices[0]?.id || ''; state.topicId = state.subTopicId; render(); };
  window.ahSetSubTopic = value => { state.subTopicId = value; state.topicId = value; render(); };
  window.ahAddSubject = async () => { const name = prompt('New subject name', '')?.trim(); if (!name) return; const existing = CACHE.subjects.find(s => s.name.trim().toLowerCase() === name.toLowerCase()); if (existing) { state.subjectId = existing.id; state.rootTopicId = ''; state.subTopicId = ''; state.topicId = ''; render(); return; } const subject = { id: uidA(), name, icon: '📘', color: '#0f6b4f', order: CACHE.subjects.length, createdAt: Date.now() }; await put('subjects', subject); await loadCache(); state.subjectId = subject.id; state.rootTopicId = ''; state.subTopicId = ''; state.topicId = ''; render(); };
  window.ahAddTopic = async () => { if (!state.subjectId) return toast?.('Select a Subject first'); const name = prompt('New topic name', '')?.trim(); if (!name) return; const existing = parserRoots(state.subjectId).find(t => t.name.trim().toLowerCase() === name.toLowerCase()); if (existing) { window.ahSetTopic(existing.id); return; } const topic = { id: uidA(), subjectId: state.subjectId, name, order: parserRoots(state.subjectId).length, createdAt: Date.now(), updatedAt: Date.now() }; await put('topics', topic); await loadCache(); state.rootTopicId = topic.id; state.subTopicId = ''; state.topicId = ''; render(); };
  window.ahAddSubTopic = async () => { const parentId = state.rootTopicId; if (!state.subjectId || !parentId) return toast?.('Select a Topic first'); const name = prompt('New sub-topic name', '')?.trim(); if (!name) return; const existing = parserChildren(parentId).find(t => t.name.trim().toLowerCase() === name.toLowerCase()); if (existing) { state.subTopicId = existing.id; state.topicId = existing.id; render(); return; } if (window.topicHierarchy?.ensureDirectQuestionsLeaf) await window.topicHierarchy.ensureDirectQuestionsLeaf(parentId); const child = { id: uidA(), subjectId: state.subjectId, parentTopicId: parentId, name, order: parserChildren(parentId).length, createdAt: Date.now(), updatedAt: Date.now() }; await put('topics', child); await loadCache(); state.subTopicId = child.id; state.topicId = child.id; render(); };
  function parserView() {
    const subjects = parserSubjects();
    const topics = parserTopics(state.subjectId);
    const subtopics = parserSubtopics(state.rootTopicId);
    const validCount = state.rows.filter(x => x.answer >= 0 && x.options.filter(Boolean).length === 4).length;
    const invalidCount = state.rows.length - validCount;
    const destination = `<section class="card"><div class="row between"><b>Import Destination</b><div class="row wrap"><button class="btn secondary sm" onclick="ahAddSubject()">+ Add New Subject</button><button class="btn secondary sm" onclick="ahAddTopic()">+ Add New Topic</button><button class="btn secondary sm" onclick="ahAddSubTopic()" ${state.rootTopicId ? '' : 'disabled'}>+ Add Sub-topic</button></div></div><label class="flabel">Subject</label><select onchange="ahSetSubject(this.value)" required><option value="">Select Subject</option>${subjects.map(s => `<option value="${s.id}" ${state.subjectId === s.id ? 'selected' : ''}>${escA(s.name)}</option>`).join('')}</select><label class="flabel">Topic</label><select onchange="ahSetTopic(this.value)" ${state.subjectId ? '' : 'disabled'} required><option value="">Select Topic</option>${topics.map(t => `<option value="${t.id}" ${state.rootTopicId === t.id ? 'selected' : ''}>${escA(t.name)}</option>`).join('')}</select><label class="flabel">Sub-topic</label><select onchange="ahSetSubTopic(this.value)" ${state.rootTopicId ? '' : 'disabled'} required><option value="">Select Sub-topic</option>${subtopics.map(t => `<option value="${t.id}" ${state.subTopicId === t.id ? 'selected' : ''}>${escA(t.name)}</option>`).join('')}</select><div class="muted" style="margin-top:8px">Selected Subject: <b>${escA(parserSubjectName(state.subjectId))}</b><br>Selected Topic: <b>${escA(parserTopicName(state.rootTopicId))}</b><br>Selected Sub-topic: <b>${escA(parserTopicName(state.subTopicId || state.topicId))}</b></div></section>`;
    const preview = state.successMessage ? `<section class="card" style="text-align:center"><div style="font-size:32px">✓</div><div class="big">${escA(state.successMessage)}</div><div class="muted" style="margin-top:8px">Existing subjects, topics, and questions were preserved. Duplicate questions are shown for confirmation before import.</div><button class="btn" style="margin-top:14px" onclick="ahResetParser()">Import More Questions</button></section>` : state.rows.length ? `<section class="card"><div class="row between"><b>Preview</b><span class="pill">Total Questions: ${state.rows.length}</span></div><p class="muted">Selected Subject: <b>${escA(parserSubjectName(state.subjectId))}</b> · Selected Topic: <b>${escA(parserTopicName(state.topicId))}</b></p><div class="phase5-grid three"><div class="phase5-kpi"><b>${state.rows.length}</b><span>Total Questions</span></div><div class="phase5-kpi"><b>${validCount}</b><span>Valid Questions</span></div><div class="phase5-kpi"><b>${invalidCount}</b><span>Invalid Questions</span></div></div>${destination}${state.rows.slice(0, 5).map((r, i) => `<article class="card" style="margin:10px 0"><b>Q${i + 1}. ${escA(r.question)}</b><div class="muted" style="margin-top:6px">A. ${escA(r.options[0])} · B. ${escA(r.options[1])} · C. ${escA(r.options[2])} · D. ${escA(r.options[3])}</div><small>Answer: ${'ABCD'[r.answer] || 'Needs Review'} · Parsed source: ${escA(r.subject)} / ${escA(r.topic)}</small>${r.reason ? `<div class="p2-issues" style="margin-top:6px">Needs review: ${escA(r.reason)}</div>` : ''}</article>`).join('')}<div class="row wrap"><button class="btn" onclick="ahConfirmImport()" ${!state.subjectId || !state.rootTopicId || !state.subTopicId || !validCount ? 'disabled' : ''}>Import ${validCount} Questions to Selected Sub-topic</button><button class="btn ghost sm" onclick="ahResetParser()">Discard Preview</button></div></section>` : '';
    return `<div class="page"><div class="explorer-kicker">SAFE QUESTION IMPORT</div><h1 class="explorer-title">Question Parser</h1><p class="explorer-subtitle">HTML, TXT, Plain Text এবং JSON থেকে MCQ detect করুন। Existing questions overwrite হবে না।</p><section class="card"><label class="flabel">Format</label><select id="ahFormat" onchange="ahSetFormat(this.value)"><option value="html" ${state.format === 'html' ? 'selected' : ''}>HTML File</option><option value="txt" ${state.format === 'txt' ? 'selected' : ''}>TXT File</option><option value="text" ${state.format === 'text' ? 'selected' : ''}>Plain Text</option><option value="json" ${state.format === 'json' ? 'selected' : ''}>JSON File</option></select><label class="flabel">Upload file</label><input id="ahFile" type="file" accept=".html,.htm,.txt,.json,text/plain,text/html,application/json" onchange="ahReadFile(this)"><label class="flabel">Paste content</label><textarea id="ahInput" rows="12" placeholder="Q1. Question text\nA. First option\nB. Second option\nC. Third option\nD. Fourth option\nAnswer: B\nExplanation: Why B is correct">${escA(state.text)}</textarea><div class="row wrap" style="margin-top:10px"><button class="btn sm" onclick="ahDetect()">Detect & Preview</button><button class="btn ghost sm" onclick="navigate('question-bank')">Open Question Bank</button></div></section>${preview}</div>`;
  }
  window.ahSetFormat = v => { state.format = v; state.rows = []; state.rejected = []; state.successMessage = ''; render(); };
  window.ahReadFile = input => { const f = input.files?.[0]; if (!f) return; state.fileName = f.name; state.format = /json$/i.test(f.name) ? 'json' : /html?$/i.test(f.name) ? 'html' : 'txt'; const reader = new FileReader(); reader.onload = () => { state.text = String(reader.result || ''); render(); }; reader.readAsText(f); };
  window.ahDetect = () => { state.text = document.getElementById('ahInput')?.value || state.text; state.successMessage = ''; try { const result = validRows(parseSource(state.format, state.text)); state.rows = result.accepted.concat(result.rejected); state.rejected = result.rejected; if (!state.rows.length) throw Error('No questions detected'); render(); } catch (e) { toast?.(`Parser error: ${e.message}`); } };
  window.ahResetParser = () => { state.rows = []; state.rejected = []; state.text = ''; state.subjectId = ''; state.rootTopicId = ''; state.subTopicId = ''; state.topicId = ''; state.successMessage = ''; state.importing = false; render(); };
  window.ahConfirmImport = async () => {
    if (state.importing) return toast?.('Import is already running. Please wait.');
    state.importing = true;
    const selection = Object.freeze({
      subjectId: String(state.subjectId || ''),
      rootTopicId: String(state.rootTopicId || ''),
      subTopicId: String(state.subTopicId || ''),
      topicId: String(state.subTopicId || state.topicId || state.rootTopicId || ''),
    });
    try {
      if (typeof loadCache === 'function') await loadCache();
      const subject = CACHE.subjects.find(s => s.id === selection.subjectId);
      const root = CACHE.topics.find(t => t.id === selection.rootTopicId && t.subjectId === selection.subjectId);
      const topic = CACHE.topics.find(t => t.id === selection.topicId && t.subjectId === selection.subjectId);
      const belongsToRoot = (targetId, rootId) => {
        const seen = new Set(); let current = CACHE.topics.find(t => t.id === targetId);
        while (current && !seen.has(current.id)) {
          if (current.id === rootId) return true;
          seen.add(current.id); current = CACHE.topics.find(t => t.id === current.parentTopicId);
        }
        return false;
      };
      const hasChildren = CACHE.topics.some(t => t.parentTopicId === selection.rootTopicId);
      const targetIsValid = Boolean(subject && root && topic && belongsToRoot(topic.id, root.id) && (selection.subTopicId || !hasChildren));
      if (!targetIsValid) { state.importing = false; return toast?.('Destination changed or is invalid. Select Subject, Topic and Sub-topic again.'); }
      const candidateRows = state.rows.filter(x => x && x.answer >= 0 && Array.isArray(x.options) && x.options.filter(Boolean).length === 4 && parserQuestionKey(x.question));
      if (!candidateRows.length) { state.importing = false; return toast?.('No valid questions to import'); }
      const existing = new Set((CACHE.questions || []).filter(q => q.subjectId === selection.subjectId && q.topicId === selection.topicId).map(q => parserQuestionKey(q.question)).filter(Boolean));
      const seenInImport = new Set(); const duplicateRows = [];
      candidateRows.forEach(row => {
        const key = parserQuestionKey(row.question);
        if (existing.has(key) || seenInImport.has(key)) duplicateRows.push(row);
        seenInImport.add(key);
      });
      // Duplicate detection is informational only. Keep every valid row and save it as a new record.
      const rows = candidateRows;
      let added = 0; let nextNumber = nextQuestionNumberForTopic(selection.topicId);
      for (const row of rows) {
        await put('questions', {
          id: uidA(), subjectId: selection.subjectId, topicId: selection.topicId, questionNumber: nextNumber++,
          question: String(row.question || '').trim(), options: row.options.map(o => String(o || '').trim()), answer: row.answer,
          explanation: String(row.explanation || '').trim(), stats: { attempts: 0, correct: 0, wrong: 0 }, bookmarked: false,
          createdAt: Date.now(), updatedAt: Date.now(), source: 'question-parser-v6'
        });
        existing.add(parserQuestionKey(row.question)); added++;
      }
      await loadCache();
      state.successAdded = added; state.successSkipped = 0;
      state.successMessage = `${added} questions successfully added to ${subject.name} → ${parserTopicName(selection.rootTopicId)} → ${topic.name}${duplicateRows.length ? ` (${duplicateRows.length} duplicate kept as new)` : ''}`;
      state.rows = []; state.rejected = []; state.text = '';
      render();
    } catch (error) {
      console.error('[Admission Hub] Question import failed', error);
      toast?.(`Import failed: ${error?.message || error}`);
    } finally { state.importing = false; }
  };

  function subjectRows() { return [...(CACHE.subjects || [])].sort((a, b) => (a.order || 0) - (b.order || 0)); }
  function bankView() { const subs = subjectRows(); const query = (window.ahBankQuery || '').toLowerCase(); const qs = (CACHE.questions || []).filter(q => !query || `${q.question} ${q.subjectId} ${q.topicId}`.toLowerCase().includes(query)); return `<div class="page"><div class="explorer-kicker">CONTENT MANAGEMENT</div><div class="row between"><h1 class="explorer-title">Question Bank</h1><button class="btn sm" onclick="ahAddSubject()">+ Subject</button></div><p class="explorer-subtitle">Subject → Topic → Question hierarchy. Rename keeps stable IDs; delete requires confirmation.</p><input class="card" style="width:100%;padding:12px" placeholder="Search question, subject or topic" value="${escA(window.ahBankQuery || '')}" oninput="window.ahBankQuery=this.value;render()"><div class="row wrap"><button class="btn secondary sm" onclick="navigate('question-parser')">Import Parser</button><button class="btn ghost sm" onclick="ahAddQuestion()">+ Question</button><button class="btn secondary sm" onclick="window.openQuestionEnginePanel&&window.openQuestionEnginePanel()">🧬 বিশ্লেষণ</button></div>${subs.map(s => { const topics = (CACHE.topics || []).filter(t => t.subjectId === s.id); return `<section class="card"><div class="row between"><div><h3 style="margin:0;cursor:pointer" onclick="openRedesignedSubject('${s.id}')">${escA(s.icon || '📘')} ${escA(s.name)}</h3><small>${topics.length} topics · ${(CACHE.questions || []).filter(q => q.subjectId === s.id).length} questions</small></div><div class="row"><button class="btn ghost sm" onclick="ahRenameSubject('${s.id}')">Rename</button><button class="btn danger sm" onclick="ahDeleteSubject('${s.id}')">Delete</button></div></div>${topics.map(t => { const rows = qs.filter(q => q.topicId === t.id); return `<div style="border-top:1px solid var(--line);margin-top:12px;padding-top:10px"><div class="row between"><b style="cursor:pointer" onclick="openRedesignedTopic('${t.id}')">▸ ${escA(t.name)}</b><span><button class="btn ghost sm" onclick="ahRenameTopic('${t.id}')">Rename</button><button class="btn danger sm" onclick="ahDeleteTopic('${t.id}')">Delete</button></span></div>${rows.slice(0, 20).map(q => `<div class="listitem"><span>${escA(q.question)}</span><span class="row"><button class="btn ghost sm" onclick="ahEditQuestion('${q.id}')">Edit</button><button class="btn danger sm" onclick="ahDeleteQuestion('${q.id}')">Delete</button></span></div>`).join('') || '<small class="muted">No matching questions</small>'}</div>`; }).join('')}</section>`; }).join('') || '<div class="empty">No subjects yet. Add a subject or import questions.</div>'}</div>`; }
  function askText(title, initial, callback) { const value = prompt(title, initial || ''); if (value?.trim()) callback(value.trim()); }
  window.ahAddSubject = () => askText('Subject name', '', async name => { await put('subjects', { id: uidA(), name, icon: '📘', color: '#0f6b4f', order: CACHE.subjects.length, createdAt: Date.now() }); await refresh(); });
  window.ahRenameSubject = id => { const s = CACHE.subjects.find(x => x.id === id); askText('Rename subject', s?.name, async name => { if (!s) return; s.name = name; s.updatedAt = Date.now(); await put('subjects', s); await refresh(); }); };
  window.ahDeleteSubject = async id => { const s = CACHE.subjects.find(x => x.id === id); if (!s) return; const topicIds = new Set((CACHE.topics || []).filter(t => t.subjectId === id).map(t => t.id)); const questions = (CACHE.questions || []).filter(q => q.subjectId === id || topicIds.has(q.topicId)); if (!confirm(`Delete ${s.name}? ${topicIds.size} topics will be removed and ${questions.length} questions will move to Deleted Questions. You can permanently remove them later from Trash.`)) return; try { for (const q of questions) await dbDel('questions', q.id); for (const topicId of topicIds) await dbDel('topics', topicId); await dbDel('subjects', id); await refresh(); toast(`${s.name} and its topics were deleted; questions moved to Deleted Questions.`); } catch (error) { console.error('ahDeleteSubject failed', error); toast('Subject could not be deleted. No records were moved.'); } };
  window.ahRenameTopic = id => { const t = CACHE.topics.find(x => x.id === id); askText('Rename topic', t?.name, async name => { if (!t) return; t.name = name; t.updatedAt = Date.now(); await put('topics', t); await refresh(); }); };
  window.ahClearTopicQuestions = async id => { const t = CACHE.topics.find(x => x.id === id); if (!t) return; const ids = new Set(typeof window.topicHierarchy?.descendantIds === 'function' ? window.topicHierarchy.descendantIds(id) : [id]); const questions = (CACHE.questions || []).filter(q => ids.has(q.topicId)); const count = questions.length; if (!count) { toast('এই টপিকে মুছার মতো কোনো প্রশ্ন নেই।'); return; } if (!confirm(`"${t.name}" থেকে ${count}টি প্রশ্ন মুছে যাবে, টপিকটি থেকে যাবে। মুছা প্রশ্নগুলো Trash (Deleted Questions)-এ জমা থাকবে, চাইলে ফেরানো যাবে।`)) return; try { for (const q of questions) await dbDel('questions', q.id); await refresh(); toast(`${count}টি প্রশ্ন মুছে গেছে, টপিক অক্ষত আছে ✓`); } catch (error) { console.error('ahClearTopicQuestions failed', error); toast('প্রশ্ন মুছা গেল না; আবার চেষ্টা করো।'); } };
  window.ahDeleteTopic = async id => { const t = CACHE.topics.find(x => x.id === id); if (!t) return; const childIds = typeof window.topicHierarchy?.descendantIds === 'function' ? window.topicHierarchy.descendantIds(id) : [id]; const ids = new Set(childIds); const questions = (CACHE.questions || []).filter(q => ids.has(q.topicId) || (q.subjectId === t.subjectId && q.topicId === id)); const count = questions.length; const topicCount = ids.size; if (!confirm(`Delete ${t.name}? ${topicCount} topic${topicCount === 1 ? '' : 's'} will be removed and ${count} question${count === 1 ? '' : 's'} will move to Deleted Questions. You can permanently remove them later from Trash.`)) return; try { for (const q of questions) await dbDel('questions', q.id); for (const topicId of [...ids].reverse()) await dbDel('topics', topicId); await refresh(); toast(`${topicCount > 1 ? 'Topic tree' : 'Topic'} deleted; questions moved to Deleted Questions.`); } catch (error) { console.error('ahDeleteTopic failed', error); toast('Topic could not be deleted. No questions were moved.'); } };
  function questionForm(q) { const subs = subjectRows(); const subjectId = q?.subjectId || subs[0]?.id || ''; const topics = window.topicPickerOptions ? window.topicPickerOptions(subjectId) : (CACHE.topics || []).filter(t => t.subjectId === subjectId); const raw = prompt('Question text', q?.question || ''); if (!raw?.trim()) return; const opts = ['A','B','C','D'].map((l, i) => prompt(`${l} option`, q?.options?.[i] || '') || ''); const ans = prompt('Correct answer (A/B/C/D)', q ? 'ABCD'[q.answer] : 'A') || 'A'; const topic = topics.find(t => t.id === q?.topicId) || topics[0] || { id: uidA(), subjectId, name: 'General', order: 0, createdAt: Date.now() }; return { ...(q || {}), id: q?.id || uidA(), subjectId, topicId: topic.id, question: raw.trim(), options: opts, answer: Math.max(0, 'ABCD'.indexOf(ans.toUpperCase())), explanation: q?.explanation || '', createdAt: q?.createdAt || Date.now(), updatedAt: Date.now() }; }
  const tagQ = q => (window.AhQuestionEngine?.tagQuestion ? window.AhQuestionEngine.tagQuestion(q) : q);
  const withTopicName = q => ({ ...q, topicName: (CACHE.topics || []).find(t => t.id === q.topicId)?.name || '' });
  window.ahAddQuestion = async () => { const q = questionForm(); if (q) { await put('questions', tagQ(withTopicName(q))); await refresh(); } };
  window.ahEditQuestion = async id => { const q = CACHE.questions.find(x => x.id === id); const next = questionForm(q); if (next) { await put('questions', tagQ(withTopicName(next))); await refresh(); } };
  window.ahDeleteQuestion = id => { if (!confirm('Move this question to Deleted Questions? You can permanently delete it later from Trash.')) return; dbDel('questions', id).then(async () => { if (typeof CACHE !== 'undefined') CACHE.deletedQuestions = await dbGetAll('deletedQuestions'); await refresh(); toast('Question moved to Deleted Questions'); }); };

  function patchExam() {
    if (window.__ahExamPatched || typeof window.beginExam !== 'function') return; window.__ahExamPatched = true; const original = window.beginExam;
    window.beginExam = async function () { await original.apply(this, arguments); const exam = (CACHE.exams || []).at(-1); if (exam && (exam.mode === 'mock' || exam.mode === 'flash')) { exam.sessionLocked = true; exam.optionOrderLocked = true; exam.configuration = { ...(exam.configuration || {}), shuffleAnswerOptions: !!exam.configuration?.randomizeOpt }; await dbPut('exams', exam); CACHE.exams = await dbGetAll('exams'); } };
  }
  window.renderQuestionParser = () => renderShell(parserView(), { title: 'Question Parser', back: "navigate('dashboard')" });
  function hook() { const old = window.render; if (!old || window.__ahFeatureRender) return; window.__ahFeatureRender = true; window.render = function () { const p = Router.path; if (p === 'question-parser' || p === 'smart-formatter') return window.renderQuestionParser(); if (p.startsWith('question-bank/subject/') || p.startsWith('question-bank/topic/')) { if (window.renderQuestionBankV2) return window.renderQuestionBankV2(); } if (p === 'question-bank' || p.startsWith('question-bank/')) { if (window.renderQuestionBankV2) return window.renderQuestionBankV2(); return renderShell(bankView(), { title: 'Question Bank' }); } return old.apply(this, arguments); }; patchExam(); }
  const boot = () => { hook(); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true }); else setTimeout(boot, 0);
})();
