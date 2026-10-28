/* Admission Hub, Mistakes Bank
 * One record per question. Uses the shared mistakes store and question cache.
 */
(() => {
  'use strict';
  const ROUTE = 'mistakes-bank';
  const q = (s, root = document) => root.querySelector(s);
  const esc = v => String(v ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  const cache = () => typeof CACHE !== 'undefined' ? CACHE : { mistakes:[], questions:[], subjects:[], topics:[] };
  const route = () => String(location.hash.replace(/^#\/?/, '').split('?')[0] || window.Router?.path || 'dashboard');
  const now = () => Date.now();
  const question = id => (cache().questions || []).find(row => String(row.id) === String(id));
  const subjectName = id => (cache().subjects || []).find(row => String(row.id) === String(id))?.name || '';
  const topicName = id => (cache().topics || []).find(row => String(row.id) === String(id))?.name || '';
  const engine = () => (typeof self !== 'undefined' ? self.AhMistakeEngine : undefined);
  const normalize = row => {
    const base = {...row, status:row.status || (row.mastered || row.revisionStatus === 'resolved' ? 'RESOLVED' : row.correctAfterMistake > 0 || row.revisionStatus === 'improving' ? 'IMPROVING' : 'UNRESOLVED'), wrongCount:Number(row.wrongCount || 0), revisionCount:Number(row.revisionCount || 0), correctAfterMistake:Number(row.correctAfterMistake || 0)};
    const eng = engine();
    base.repeated = eng ? eng.isRepeated(base) : base.wrongCount >= 2;
    base.tier = eng ? eng.priorityTier(base) : (base.wrongCount >= 4 ? 'critical' : base.wrongCount >= 2 ? 'high' : 'medium');
    base.tierLabel = eng ? eng.tierLabel(base.tier) : base.tier;
    return base;
  };
  const rows = () => (cache().mistakes || []).filter(Boolean).map(normalize).filter(row => row.questionId != null);

  function sortRows(list) { return [...list].sort((a,b) => (b.wrongCount-a.wrongCount) || (String(b.lastWrongAt||b.updatedAt||'').localeCompare(String(a.lastWrongAt||a.updatedAt||'')))); }
  function getRecords(filter = 'UNRESOLVED', subject = 'all') { return sortRows(rows().filter(row => (filter === 'ALL' || row.status === filter) && (subject === 'all' || String(row.subjectId) === String(subject)))); }
  async function persist(record) {
    const value = normalize({...record, updatedAt:now()});
    if (typeof dbPut === 'function') await dbPut('mistakes', value);
    cache().mistakes = [...(cache().mistakes || []).filter(row => String(row.id) !== String(value.id)), value];
    return value;
  }
  async function recordWrong(questionId, meta = {}) {
    let record = rows().find(row => String(row.questionId) === String(questionId));
    if (!record) record = {id:typeof uid === 'function' ? uid() : `mistake-${questionId}-${now()}`, questionId, subjectId:meta.subjectId, topicId:meta.topicId, firstWrongAt:now(), wrongCount:0, revisionCount:0, correctAfterMistake:0, createdAt:now()};
    return persist({...record, lastWrongAt:now(), wrongCount:Number(record.wrongCount || 0) + 1, revisionCount:Number(record.revisionCount || 0) + 1, status:'UNRESOLVED'});
  }
  async function recordOutcome(questionId, isCorrect, meta = {}) {
    if (!isCorrect) return recordWrong(questionId, meta);
    const record = rows().find(row => String(row.questionId) === String(questionId));
    if (!record) return null;
    const eng = engine();
    const next = eng ? eng.nextRevisionState(record, { correct: true, at: now() })
      : { revisionCount:Number(record.revisionCount || 0) + 1, correctAfterMistake:Number(record.correctAfterMistake || 0) + 1, lastCorrectAt:now(), lastReviewedAt:now(), status:Number(record.correctAfterMistake || 0) + 1 >= 2 ? 'RESOLVED' : 'IMPROVING', mastered:Number(record.correctAfterMistake || 0) + 1 >= 2 };
    return persist({...record, ...next});
  }
  window.MistakesBankTool = { getRecords, recordWrong, recordOutcome, count:() => rows().length };

  function shell(inner) { if (typeof window.renderShell === 'function') window.renderShell(`<main class="mistakes-tool">${inner}</main>`, {topbar:false, hideNav:true}); else q('#app').innerHTML = `<main class="mistakes-tool">${inner}</main>`; }
  function renderCard(row) {
    const source = question(row.questionId) || row; const options = Array.isArray(source.options) ? source.options : [];
    const answer = Number(row.userAnswerIndex ?? row.selectedAnswerIndex ?? row.answerIndex);
    const correct = Number(row.correctAnswerIndex ?? source.answer ?? source.answerIndex);
    return `<article class="mistake-card"><div class="mistake-card-head"><span>${esc(subjectName(row.subjectId) || source.subject || 'Question')} · ${esc(topicName(row.topicId) || source.topic || 'General')}</span><b class="mistake-status ${row.status.toLowerCase()}">${row.status}</b></div><h2>Q. ${esc(source.question || 'Question unavailable')}</h2>${options.length ? `<div class="mistake-options">${options.slice(0,4).map((option,index)=>`<div class="mistake-option ${index===correct?'correct':''} ${index===answer?'wrong':''}"><i>${String.fromCharCode(65+index)}</i><span>${esc(option)}</span>${index===correct?'<small>Correct</small>':''}${index===answer&&index!==correct?'<small>Yours</small>':''}</div>`).join('')}</div>` : ''}<div class="mistake-meta"><span>Wrong ${row.wrongCount}×</span><span>${row.status === 'RESOLVED' ? 'Successfully corrected' : row.status === 'IMPROVING' ? 'Corrected once' : 'Needs review'}</span><span class="mistake-tier ${row.tier}">${esc(row.tierLabel)}</span>${row.repeated ? '<span class="mistake-repeat">বারবার</span>' : ''}</div><div class="mistake-actions"><button type="button" class="btn" onclick="MistakesBankTool.review('${esc(row.questionId)}')">Review</button><button type="button" class="btn secondary" onclick="MistakesBankTool.practice('${esc(row.questionId)}')">Practice</button></div></article>`;
  }
  function render() {
    const path = route(); const params = new URLSearchParams(location.hash.split('?')[1] || ''); const filter = String(params.get('filter') || 'UNRESOLVED').toUpperCase(); const subject = params.get('subject') || 'all'; const records = getRecords(['ALL','UNRESOLVED','IMPROVING','RESOLVED'].includes(filter) ? filter : 'UNRESOLVED', subject); const all = rows(); const count = key => all.filter(row => key === 'ALL' || row.status === key).length;
    const subjects = [...new Map(all.map(row => [String(row.subjectId), row.subjectId]).filter(([id]) => id && id !== 'undefined')).keys()].map(id => ({id,name:subjectName(id)})).filter(row => row.name);
    shell(`<header class="mistakes-head"><button type="button" class="mistakes-back" onclick="navigate('dashboard')">←</button><div><span>MISTAKES BANK</span><h1>${all.length} Questions</h1></div></header><section class="mistakes-summary"><div><b>${count('UNRESOLVED')}</b><small>Unresolved</small></div><div><b>${count('IMPROVING')}</b><small>Improving</small></div><div><b>${count('RESOLVED')}</b><small>Resolved</small></div></section><div class="mistake-filters"><div class="mistake-chips">${[['UNRESOLVED','Unresolved'],['ALL','All'],['IMPROVING','Improving'],['RESOLVED','Resolved']].map(([key,label])=>`<button type="button" class="${filter===key?'active':''}" onclick="MistakesBankTool.filter('${key}')">${label}</button>`).join('')}</div><select onchange="MistakesBankTool.subject(this.value)"><option value="all">All Subjects</option>${subjects.map(item=>`<option value="${esc(item.id)}" ${String(item.id)===String(subject)?'selected':''}>${esc(item.name)}</option>`).join('')}</select></div>${records.length ? `<section class="mistake-list">${records.map(renderCard).join('')}</section>` : `<section class="mistake-empty"><div>🎯</div><h2>${filter === 'UNRESOLVED' ? 'Your Mistakes Bank is clear' : 'No mistake questions here'}</h2><p>Mistake questions will automatically appear when you answer incorrectly.</p></section>`}`);
  }
  window.MistakesBankTool.render = render;
  window.MistakesBankTool.filter = filter => { navigate(`${ROUTE}?filter=${encodeURIComponent(filter)}`); };
  window.MistakesBankTool.subject = subject => { navigate(`${ROUTE}?filter=ALL&subject=${encodeURIComponent(subject)}`); };
  window.MistakesBankTool.review = id => { const target = question(id); if (target && typeof toast === 'function') toast('Question Bank থেকে প্রশ্নটি review করুন'); navigate('question-bank'); };
  window.MistakesBankTool.practice = id => { navigate(`smart-revision?questionId=${encodeURIComponent(id)}`); };
  const previousRoute = window.__admissionRenderRoute;
  if (typeof previousRoute === 'function') window.__admissionRenderRoute = function mistakesRoute() { if (route() === ROUTE) return render(); return previousRoute.apply(this, arguments); };
  const previousRender = window.render;
  if (typeof previousRender === 'function') window.render = function mistakesRender() { if (route() === ROUTE) return render(); return previousRender.apply(this, arguments); };
  window.addEventListener('hashchange', () => { if (route() === ROUTE) setTimeout(render, 0); });
  if (!q('#mistakes-tool-styles')) { const style = document.createElement('style'); style.id='mistakes-tool-styles'; style.textContent=`.mistakes-tool{max-width:700px;margin:0 auto;padding:18px 0 38px;color:#173128}.mistakes-head{display:flex;align-items:center;gap:12px}.mistakes-head span{color:#168062;font-size:10px;font-weight:900;letter-spacing:.14em}.mistakes-head h1{margin:4px 0 0;font-size:25px}.mistakes-back{width:40px;height:40px;border:1px solid var(--line);border-radius:12px;background:var(--card);font-size:22px;color:var(--emerald-d)}.mistakes-summary{display:grid;grid-template-columns:repeat(3,1fr);gap:9px;margin-top:14px}.mistakes-summary div{padding:13px 7px;text-align:center;border:1px solid var(--line);border-radius:14px;background:var(--card);box-shadow:var(--shadow)}.mistakes-summary b,.mistakes-summary small{display:block}.mistakes-summary b{font-size:22px;color:var(--emerald)}.mistakes-summary small{margin-top:4px;color:var(--sub);font-size:10px}.mistake-filters{display:grid;grid-template-columns:1fr 150px;gap:9px;margin:16px 0 12px}.mistake-chips{display:flex;gap:6px;overflow:auto}.mistake-chips button{white-space:nowrap;border:1px solid var(--line);border-radius:999px;background:var(--card);color:var(--sub);padding:8px 11px;font:inherit;font-size:11px}.mistake-chips button.active{background:var(--emerald);border-color:var(--emerald);color:#fff}.mistake-filters select{min-height:38px;border:1px solid var(--line);border-radius:10px;background:var(--card);color:var(--text);font:inherit;font-size:11px}.mistake-list{display:grid;gap:12px}.mistake-card{padding:15px;border:1px solid var(--line);border-left:4px solid var(--red);border-radius:17px;background:var(--card);box-shadow:var(--shadow)}.mistake-card-head{display:flex;justify-content:space-between;gap:8px;align-items:center;color:var(--sub);font-size:10px}.mistake-status{padding:4px 7px;border-radius:7px;font-size:9px}.mistake-status.unresolved{background:#fff0ef;color:var(--red)}.mistake-status.improving{background:#fff6df;color:#94631b}.mistake-status.resolved{background:#e7f7ed;color:var(--green)}.mistake-card h2{margin:12px 0;font-size:16px;line-height:1.5}.mistake-options{display:grid;gap:6px}.mistake-option{display:flex;align-items:flex-start;gap:8px;padding:8px;border-radius:9px;background:rgba(255,255,255,.65);font-size:12px;line-height:1.45}.mistake-option i{display:grid;place-items:center;flex:0 0 22px;width:22px;height:22px;border-radius:6px;background:var(--mint);font-style:normal;font-weight:850}.mistake-option.correct{background:#e7f7ed}.mistake-option.correct i{background:var(--green);color:#fff}.mistake-option.wrong{background:#fff0ef}.mistake-option small{margin-left:auto;color:var(--sub);font-size:9px;white-space:nowrap}.mistake-meta{display:flex;gap:8px;flex-wrap:wrap;margin-top:11px;color:var(--sub);font-size:10px}.mistake-tier{padding:2px 7px;border-radius:7px;font-weight:800}.mistake-tier.critical{background:#fdeceb;color:#c0392b}.mistake-tier.high{background:#fff3e0;color:#a5610f}.mistake-tier.medium{background:#eef4f8;color:#476479}.mistake-tier.mastered{background:#e7f7ed;color:var(--green)}.mistake-repeat{padding:2px 7px;border-radius:7px;font-weight:800;background:#f0ecfb;color:#6a4ec2}.mistake-actions{display:flex;gap:7px;margin-top:12px}.mistake-actions .btn{min-height:38px}.mistake-empty{margin-top:14px;padding:44px 18px;text-align:center;border:1px dashed var(--line);border-radius:17px;color:var(--sub)}.mistake-empty div{font-size:32px}.mistake-empty h2{margin:8px 0 4px;color:var(--text);font-size:19px}.mistake-empty p{margin:0;font-size:12px;line-height:1.5}@media(max-width:560px){.mistake-filters{grid-template-columns:1fr}.mistakes-summary{gap:6px}}`; document.head.appendChild(style); }
})();
