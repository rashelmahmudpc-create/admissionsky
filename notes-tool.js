/* ============================================================
   ADMISSION HUB · NOTES DATA + NOTE EDITOR
   Question Bank / Flash Test / Mock থেকে নোট সেভ করার API ও editor modal।
   নোট স্ক্রিনের UI (route #notes) এখন notes-screen.js-এ।
   ============================================================ */
(function installNotesTool(){
  'use strict';
  if(window.__notesToolInstalled) return;
  window.__notesToolInstalled=true;

  const NOTE_STORE='notes';
  const UNASSIGNED='__notes-unassigned__';
  const state={expandedAi:new Set()};
  function cache(){try{if(typeof CACHE!=='undefined'&&CACHE)return CACHE;}catch(_){}return window.CACHE||{notes:[],subjects:[],topics:[]};}
  function escValue(value){if(typeof window.esc==='function')return window.esc(String(value??''));return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
  function text(value,max=5000){return String(value??'').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g,'').trim().slice(0,max);}
  function decode(value){try{return decodeURIComponent(String(value||''));}catch(_){return String(value||'');}}
  function keyOf(value){return value||UNASSIGNED;}
  function subjectName(id){return text((cache().subjects||[]).find(row=>row.id===id)?.name||'');}
  function topicName(id){return text((cache().topics||[]).find(row=>row.id===id)?.name||'');}
  function subjectLabel(id){return id===UNASSIGNED?'বিষয় নির্ধারিত নয়':subjectName(id)||'বিষয় নির্ধারিত নয়';}
  function topicLabel(id){return id===UNASSIGNED?'টপিক নির্ধারিত নয়':topicName(id)||'টপিক নির্ধারিত নয়';}
  function sourceLabel(source){return source==='Flash Test'?'Flash Test':'Question Bank';}
  function questionAnswerIndex(q){const n=Number(q?.answerIndex??q?.answer??q?.correctAnswerIndex??0);return Number.isFinite(n)?n:0;}
  function routeId(id){return encodeURIComponent(id||UNASSIGNED);}
  function sourceCount(rows,source){return rows.filter(row=>row.source===source).length;}
  function noteDomId(note){return encodeURIComponent(String(note.id||''));}
  function getNote(id){return (cache().notes||[]).find(note=>note.id===id)||null;}
  function answerText(value){return text(value&&typeof value==='object'?(value.text??value.value??value.label??''):value,1200);}
  function optionKey(value){return answerText(value).toLocaleLowerCase('en-US').replace(/^\s*[a-d]\s*[.)\-:]*\s*/i,'').replace(/\s+/g,' ').trim();}
  function selectedAnswerValues(note){
    const mistake=(cache().mistakes||[]).find(row=>String(row.questionId||'')===String(note.questionId||''))||{};
    return [note.selectedAnswer,note.wrongAnswer,note.userAnswer,note.selectedOption,note.answer,mistake.selectedAnswer,mistake.wrongAnswer,mistake.userAnswer].map(answerText).filter(Boolean);
  }
  function selectedIndexOf(note){
    const raw=note.selectedAnswerIndex;
    if(raw!==null&&raw!==undefined&&raw!==''){const n=Number(raw);if(Number.isInteger(n)&&n>=0)return n;}
    const options=note.options||[];
    for(const value of selectedAnswerValues(note)){const index=options.findIndex(option=>optionKey(option)===optionKey(value));if(index>=0)return index;}
    return -1;
  }

  function noteFromQuestion({q,selectedIndex,source,existing}){
    const current=existing||{},correctIndex=questionAnswerIndex(q),options=Array.isArray(q?.options)?q.options.map(option=>text(option,1200)):[];
    const validIndex=value=>value!==null&&value!==undefined&&value!==''&&Number.isInteger(Number(value))&&Number(value)>=0?Number(value):null;
    const picked=validIndex(selectedIndex),stored=validIndex(current.selectedAnswerIndex),selectedIndexValue=picked??stored;
    return {id:current.id||`note-${typeof uid==='function'?uid():Date.now()}`,type:'mistake-question-note',questionId:q?.id||current.questionId||'',source:sourceLabel(source||current.source),question:text(q?.question??current.question,5000),options:options.length?options:(current.options||[]),correctAnswerIndex:correctIndex,correctAnswer:options[correctIndex]||current.correctAnswer||'',selectedAnswerIndex:selectedIndexValue,wrongAnswer:options[selectedIndexValue]||current.wrongAnswer||current.selectedAnswer||'',selectedAnswer:options[selectedIndexValue]||current.selectedAnswer||current.wrongAnswer||'',subjectId:q?.subjectId??current.subjectId??'',topicId:q?.topicId??current.topicId??'',explanation:text(q?.explanation??current.explanation,4000),aiExplain:text(current.aiExplain,8000),createdAt:current.createdAt||Date.now(),updatedAt:Date.now()};
  }
  async function saveNote(note){
    await dbPut(NOTE_STORE,note);const rows=cache().notes||[],index=rows.findIndex(item=>item.id===note.id);if(index>=0)rows[index]=note;else rows.unshift(note);cache().notes=rows;
    if(typeof closeModal==='function')closeModal();if(typeof toast==='function')toast('নোটে সেভ হয়েছে');if(String(typeof Router!=='undefined'?Router.path:'').startsWith('notes'))renderNotesTool();
  }
  function optionsMarkup(note){
    const selectedIndex=selectedIndexOf(note),correctIndex=Number(note.correctAnswerIndex);
    return (note.options||[]).map((option,index)=>{const isCorrect=index===correctIndex,isSelected=index===selectedIndex,tag=isCorrect&&isSelected?'তোমার উত্তর · সঠিক':isCorrect?'সঠিক উত্তর':isSelected?'তোমার উত্তর':'';return `<div class="note-option ${isCorrect?'is-correct':''} ${isSelected&&!isCorrect?'is-wrong':''}"><b>${String.fromCharCode(65+index)}</b><span>${escValue(option)}</span>${tag?`<em>${tag}</em>`:''}</div>`;}).join('');
  }
  function openEditor(note){
    openModal(`<div class="note-editor-head"><div><div class="note-kicker">${escValue(note.source)} · প্রশ্ন নোট</div><h3>AI Explain সম্পাদনা</h3></div><button class="iconbtn" onclick="closeModal()">×</button></div><div class="note-card-preview"><div class="note-meta">${escValue(subjectLabel(keyOf(note.subjectId)))} · ${escValue(topicLabel(keyOf(note.topicId)))}</div><div class="note-question">${escValue(note.question)}</div><div class="note-options">${optionsMarkup(note)}</div></div><label class="flabel">AI Explain</label><textarea id="noteAiExplainInput" placeholder="AI explanation এখানে লিখুন বা paste করুন...">${escValue(note.aiExplain)}</textarea><p class="note-save-hint">Save করলে প্রশ্ন, চারটি option ও answer state বদলাবে না।</p><button class="btn" style="margin-top:14px" onclick="window.saveCurrentQuestionNote()">💾 Save Note</button>`);
    window.__editingQuestionNote=note;
  }
  window.openQuestionNoteEditor=function(payload){if(payload?.q)openEditor(noteFromQuestion(payload));};
  window.saveCurrentQuestionNote=async function(){const note=window.__editingQuestionNote;if(!note)return;note.aiExplain=text(document.getElementById('noteAiExplainInput')?.value,8000);note.updatedAt=Date.now();await saveNote(note);window.__editingQuestionNote=null;};
  window.editSavedNote=function(id){const note=getNote(id);if(note)openEditor(note);};
  window.deleteSavedNote=async function(id){const note=getNote(id);if(!note)return;if(typeof confirmModal==='function')confirmModal('নোট মুছে ফেলবেন?','এই নোটটি Notes থেকে মুছে যাবে; মূল question ও Mistake Book বদলাবে না।',async()=>{await dbDel(NOTE_STORE,id);cache().notes=(cache().notes||[]).filter(item=>item.id!==id);state.expandedAi.delete(id);renderNotesTool();toast('নোট মুছে গেছে');},'Delete',true);};
  window.toggleNoteAiExplain=function(id){const note=getNote(id);if(!note)return;if(!text(note.aiExplain,8000)){openEditor(note);return;}state.expandedAi.has(id)?state.expandedAi.delete(id):state.expandedAi.add(id);renderNotesTool();requestAnimationFrame(()=>document.getElementById(`note-ai-${noteDomId(note)}`)?.scrollIntoView({block:'nearest',behavior:'smooth'}));};

  const previousRender=window.render;
  if(typeof previousRender==='function')window.render=function notesRouteRender(){if(String(Router.path||'').startsWith('notes'))return window.renderNotesTool();return previousRender.apply(this,arguments);};
  function addDashboardCard(){
    if(Router.path!=='dashboard')return;const candidates=[...document.querySelectorAll('.p3-special-section-v3, .dashboard-section')].filter(el=>el.textContent.includes('Study Tools')&&el.textContent.includes('Review & analysis'));const section=candidates.find(el=>{const box=el.getBoundingClientRect();return box.width>0&&box.height>0})||candidates[0];if(!section)return;const host=section.querySelector('[data-unified-study-tools-list]')||section;document.querySelectorAll('[data-notes-tool-card]').forEach(existing=>{if(existing.parentElement!==host)existing.remove();});if(host.querySelector('[data-notes-tool-card]'))return;const card=document.createElement('button');card.type='button';card.dataset.notesToolCard='';card.className='special-tool-card';card.innerHTML='<span class="special-tool-icon">📝</span><span><strong>নোট</strong><small>ভুল প্রশ্ন subject অনুযায়ী review করুন</small></span><span class="tool-arrow">↗</span>';card.onclick=()=>navigate('notes');host.appendChild(card);
  }
  const app=document.getElementById('app');if(app)new MutationObserver(()=>setTimeout(addDashboardCard,0)).observe(app,{childList:true,subtree:true});setTimeout(addDashboardCard,80);setTimeout(addDashboardCard,500);
  const style=document.createElement('style');style.id='notes-tool-styles';style.textContent=`
  /* Note editor modal only, the নোট screen itself lives in notes-screen.js. */
  .note-kicker{font-size:10px;font-weight:900;letter-spacing:.08em;color:var(--emerald-d)}.note-option{display:flex;align-items:center;gap:11px;min-height:54px;padding:12px 13px;border:1px solid #e1ece7;border-radius:14px;background:#fff;color:#38544b;font-size:15px;line-height:1.5}.note-option b{display:grid;place-items:center;flex:0 0 28px;width:28px;height:28px;border-radius:8px;background:#f0f6f3;color:#54746a;font-size:13px}.note-option span{flex:1;min-width:0}.note-option em{align-self:center;color:inherit;font-size:10px;font-style:normal;font-weight:900;white-space:nowrap}.note-option.is-correct{border-color:#9ed9b5;background:#effbf3;color:#197241}.note-option.is-correct b{background:#2ca45b;color:#fff}.note-option.is-wrong{border-color:#efb9b9;background:#fff5f5;color:#ae3636}.note-option.is-wrong b{background:#d95a5a;color:#fff}.note-editor-head{display:flex;align-items:flex-start;justify-content:space-between;gap:10px}.note-editor-head h3{margin:4px 0 0}.note-card-preview{margin-top:10px;padding:13px;border-radius:15px;background:var(--mint)}.note-meta{color:var(--sub);font-size:10px}.note-question{margin:7px 0 11px;color:var(--text);font-size:16px;font-weight:850;line-height:1.55}.note-options{display:grid;gap:6px}.note-card-preview .note-option{padding:8px;font-size:11px}.note-save-hint{margin:8px 0;color:var(--sub);font-size:11px;line-height:1.5}@media(max-width:430px){.note-option{min-height:50px;font-size:13.5px;padding:11px}.note-option b{flex-basis:26px;width:26px;height:26px}}`;document.head.appendChild(style);
})();
