/* ============================================================
   ADMISSION HUB · নোট স্ক্রিন (v2)
   ভুল প্রশ্নের রিভিশন: Question Bank / Flash Test-এর আসল ভুল
   (CACHE.mistakes) + নিজের সেভ করা নোট (CACHE.notes)।
   কোনো ডেমো ডেটা নেই, সব লেখা dbPut দিয়ে account storage-এ যায়,
   সেখান থেকে student-data-sync ব্যাকএন্ডে সিঙ্ক করে।
   হেডার status bar-এর সাথে এক রঙে মিশে থাকে; জুম/পাশে সরানো বন্ধ,
   শুধু তালিকা উপর-নিচ স্ক্রল হয়।
   ============================================================ */
(function installNotesScreen(){
  'use strict';
  if (window.__notesScreenV2) return;
  window.__notesScreenV2 = true;

  const PALETTE = ['#2E8BFF','#7C5CFF','#F28A2E','#0FB89A','#EC5C9B','#4A62C8','#E5A100','#14A3C7','#8E5BD8','#D9534F'];
  const TABS = ['সব','বাকি','আয়ত্ত','সেভ'];
  const P = {back:'M15 5l-7 7 7 7',search:'M11 18a7 7 0 100-14 7 7 0 000 14zM21 21l-4.5-4.5',moon:'M20 13.5A8.5 8.5 0 1110.5 4a7 7 0 009.5 9.5z',sun:'M12 4V2M12 22v-2M4 12H2M22 12h-2M5.6 5.6L4.2 4.2M19.8 19.8l-1.4-1.4M5.6 18.4l-1.4 1.4M19.8 4.2l-1.4 1.4M12 17a5 5 0 100-10 5 5 0 000 10z',mark:'M6 4h12v17l-6-4-6 4z',share:'M4 12v7h16v-7M12 15V3M7 8l5-5 5 5',x:'M6 6l12 12M18 6L6 18',ck:'M5 12.5l4.5 4.5L19 7',dn:'M6 9l6 6 6-6'};
  const ic = n => `<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="${P[n]}"/></svg>`;
  const bn = x => String(x).replace(/\d/g, d => '০১২৩৪৫৬৭৮৯'[d]);
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const clean = (v, max = 5000) => String(v ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, max);
  const optText = o => clean(o && typeof o === 'object' ? (o.text ?? o.value ?? o.label ?? '') : o, 1200);
  const idx = v => { if (v === null || v === undefined || v === '') return -1; const n = Number(v); return Number.isInteger(n) && n >= 0 ? n : -1; };
  const key = v => optText(v).toLocaleLowerCase('en-US').replace(/^\s*[a-d]\s*[.)\-:]*\s*/i, '').replace(/\s+/g, ' ').trim();
  const cache = () => { try { if (typeof CACHE !== 'undefined' && CACHE) return CACHE; } catch (_) {} return window.CACHE || {}; };
  const engine = () => window.AhMistakeEngine;
  const newId = p => p + '-' + (typeof uid === 'function' ? uid() : Date.now().toString(36) + Math.random().toString(36).slice(2, 8));
  const isRoute = () => String((window.Router && Router.path) || location.hash.replace(/^#\/?/, '')).startsWith('notes');

  const S = { f:'সব', sub:'', q:'', search:false, si:0, open:new Set(), ss:null, timer:0, saveT:{} };

  /* ---------- ডেটা: আসল ভুল + নিজের নোট ---------- */
  function subjectsMeta(){
    const list = cache().subjects || [], map = new Map();
    list.forEach((s, i) => map.set(String(s.id), { name: clean(s.name, 80) || 'বিষয়', color: PALETTE[i % PALETTE.length] }));
    return map;
  }
  function topicName(id){ const t = (cache().topics || []).find(r => String(r.id) === String(id)); return clean(t && t.name, 120); }

  function build(){
    const C = cache(), qById = new Map(), noteByQ = new Map(), seen = new Set(), out = [];
    (C.questions || []).forEach(q => q && qById.set(String(q.id), q));
    (C.notes || []).forEach(n => { if (n && n.questionId) noteByQ.set(String(n.questionId), n); });
    const make = (m, n) => {
      const qid = String((m && m.questionId) || (n && n.questionId) || '');
      const q = qById.get(qid) || {};
      const src = m || n;
      const raw = (Array.isArray(src.options) && src.options.length ? src.options : (Array.isArray(q.options) ? q.options : []));
      const options = raw.map(optText);
      let ci = idx(src.correctAnswerIndex); if (ci < 0) ci = idx(q.answerIndex ?? q.answer ?? q.correctAnswerIndex);
      const correctText = (ci >= 0 && options[ci]) || optText(src.correctAnswer) || '';
      if (ci < 0 && correctText) ci = options.findIndex(o => key(o) === key(correctText));
      const wrongText = optText(src.wrongAnswer || src.selectedAnswer || (n && (n.wrongAnswer || n.selectedAnswer)) || '');
      let wi = idx(src.selectedAnswerIndex); if (wi < 0 && wrongText) wi = options.findIndex(o => key(o) === key(wrongText));
      const subjectId = String(src.subjectId ?? q.subjectId ?? '');
      const topicId = String(src.topicId ?? q.topicId ?? '');
      return {
        k: m ? 'm:' + m.id : 'n:' + n.id, m: m || null, note: n || null, qid,
        question: clean(src.question || q.question, 5000), options, ci, wi, correctText, wrongText,
        subjectId, topicId, topic: topicName(topicId),
        explanation: clean((m && m.explanation) || q.explanation || (n && n.explanation), 4000),
        ts: Number((m && (m.lastWrongAt || m.time || m.updatedAt)) || (n && (n.updatedAt || n.createdAt)) || 0),
        wrongCount: Number((m && m.wrongCount) || 0),
        get mastered(){ const r = this.m || this.note; return !!(r && (r.mastered === true || r.status === 'RESOLVED')); },
        get saved(){ const r = this.m || this.note; return !!(r && r.bookmarked); }
      };
    };
    (C.mistakes || []).forEach(m => { if (!m || m.deleted) return; const it = make(m, noteByQ.get(String(m.questionId)) || null); seen.add(it.qid); out.push(it); });
    (C.notes || []).forEach(n => { if (!n || n.deleted) return; if (n.questionId && seen.has(String(n.questionId))) return; out.push(make(null, n)); });
    return out.filter(it => it.question).sort((a, b) => b.ts - a.ts);
  }

  let ITEMS = [], META = new Map();
  const subOf = it => META.get(it.subjectId) || { name:'বিষয় নির্ধারিত নয়', color:'#6F7FA8' };
  const pending = () => ITEMS.filter(it => !it.mastered);
  const pct = () => ITEMS.length ? Math.round((ITEMS.length - pending().length) / ITEMS.length * 100) : 0;
  function weakest(){
    const c = new Map(); pending().forEach(it => c.set(it.subjectId, (c.get(it.subjectId) || 0) + 1));
    let best = null, n = 0; c.forEach((v, k) => { if (v > n) { n = v; best = k; } });
    return best === null ? '' : (META.get(best) || {}).name || 'বিষয় নির্ধারিত নয়';
  }
  function when(ts){
    if (!ts) return '';
    const d0 = new Date(); d0.setHours(0,0,0,0);
    const d = new Date(ts); d.setHours(0,0,0,0);
    const days = Math.round((d0 - d) / 86400000);
    if (days <= 0) return 'আজ'; if (days === 1) return 'গতকাল';
    if (days < 7) return bn(days) + ' দিন আগে';
    if (days < 30) return bn(Math.floor(days / 7)) + ' সপ্তাহ আগে';
    try { return new Date(ts).toLocaleDateString('bn-BD', { day:'numeric', month:'short' }); } catch (_) { return ''; }
  }
  function streak(){ try { return typeof computeStreak === 'function' ? Number(computeStreak()) || 0 : 0; } catch (_) { return 0; } }

  /* ---------- লেখা (account storage → sync) ---------- */
  async function put(store, rec){ rec.updatedAt = Date.now(); if (typeof dbPut === 'function') await dbPut(store, rec); return rec; }
  function ensureNote(it){
    if (it.note) return it.note;
    const C = cache(), now = Date.now();
    const n = { id:newId('note'), type:'mistake-question-note', questionId:it.qid, source:'Question Bank', question:it.question, options:it.options.slice(),
      correctAnswerIndex:it.ci, correctAnswer:it.correctText, selectedAnswerIndex:it.wi >= 0 ? it.wi : null, wrongAnswer:it.wrongText, selectedAnswer:it.wrongText,
      subjectId:it.subjectId, topicId:it.topicId, explanation:it.explanation, aiExplain:'', createdAt:now, updatedAt:now };
    C.notes = C.notes || []; C.notes.unshift(n); it.note = n; return n;
  }
  async function setMastered(it, val){
    const r = it.m || it.note; if (!r) return;
    r.mastered = !!val; r.revisionStatus = val ? 'mastered' : 'pending'; r.status = val ? 'RESOLVED' : 'UNRESOLVED';
    if (val) r.masteredAt = r.masteredAt || Date.now(); else { r.masteredAt = null; r.correctAfterMistake = 0; }
    await put(it.m ? 'mistakes' : 'notes', r);
  }
  async function revise(it, correct){
    if (!it.m) { if (correct) await setMastered(it, true); return; }
    const eng = engine();
    if (eng && typeof eng.nextRevisionState === 'function') Object.assign(it.m, eng.nextRevisionState(it.m, { correct }));
    else if (correct) { it.m.mastered = true; it.m.revisionStatus = 'mastered'; it.m.status = 'RESOLVED'; }
    if (!correct) it.m.lastWrongAt = it.m.lastWrongAt || Date.now();
    await put('mistakes', it.m);
  }
  const safely = p => Promise.resolve(p).catch(() => toast('সেভ করা যায়নি, আবার চেষ্টা করুন'));

  /* ---------- UI ---------- */
  let root = null;
  const $ = s => root && root.querySelector(s);
  function toast(t){ const e = $('#ntxToast'); if (!e) return; e.textContent = t; e.classList.add('o'); clearTimeout(e._t); e._t = setTimeout(() => e.classList.remove('o'), 1800); }
  function isDark(){ try { const r = window.AhAppearance && AhAppearance.resolved ? AhAppearance.resolved() : 'light'; return r === 'dark' || r === 'midnight'; } catch (_) { return false; } }
  function paintChrome(){
    if (!root) return;
    root.classList.toggle('dk', isDark());
    const bg = getComputedStyle(root).getPropertyValue('--bg').trim();
    if (!bg) return;
    document.querySelectorAll('meta[name="theme-color"]').forEach(m => m.setAttribute('content', bg));
    document.documentElement.style.setProperty('--ah-chrome', bg);
    const scrim = document.getElementById('ah-status-scrim'); if (scrim) scrim.style.backgroundColor = bg;
  }

  function slides(){
    const p = pending().length, st = streak(), w = weakest(), qn = Math.min(10, quizPool().length);
    return [
      `<div class="si" style="background:linear-gradient(135deg,#1E78FF,#4AB8FF 65%,#8FE0FF)"><div><small>আজকের রিভিশন</small><h2>${p ? bn(p) + 'টি প্রশ্ন বাকি' : (ITEMS.length ? 'সব আয়ত্ত হয়েছে' : 'এখনো কোনো ভুল নেই')}</h2><p>${w ? 'সবচেয়ে বেশি ভুল: ' + esc(w) : (ITEMS.length ? 'দারুণ! নতুন ভুল এলে এখানে দেখাবে' : 'প্র্যাকটিস করলে ভুলগুলো এখানে জমবে')}</p>${ITEMS.length ? '<button class="go" data-fl="1">ফ্ল্যাশকার্ড</button>' : ''}</div><div class="vz"><svg viewBox="0 0 86 86"><circle class="c1" cx="43" cy="43" r="38"/><circle class="c2" cx="43" cy="43" r="38" style="stroke-dashoffset:${(238.8 * (1 - pct() / 100)).toFixed(1)}"/></svg><b>${bn(pct())}%</b></div></div>`,
      `<div class="si" style="background:linear-gradient(135deg,#0F1B45,#2748C4 70%,#4C7BFF)"><div><small>স্ট্রিক</small><h2>${st ? bn(st) + ' দিন টানা' : 'আজ থেকে শুরু'}</h2><p>${st ? 'আজকের পড়া হয়েছে, ধারা ধরে রাখুন' : 'আজ একটি রিভিশন করে স্ট্রিক শুরু করুন'}</p>${ITEMS.length ? '<button class="go" data-fl="1">আজকের রিভিশন</button>' : ''}</div><div class="vz">${bn(st)}</div></div>`,
      `<div class="si" style="background:linear-gradient(135deg,#0B7CD6,#22B8E8 65%,#6FE3F2)"><div><small>কুইজ</small><h2>ভুল থেকে কুইজ</h2><p>${qn ? bn(qn) + 'টি প্রশ্ন · প্রায় ' + bn(Math.max(1, Math.ceil(qn * 12 / 60))) + ' মিনিট' : 'কুইজের জন্য এখনো প্রশ্ন নেই'}</p>${qn ? '<button class="go" data-qz="1">শুরু করুন</button>' : ''}</div><div class="vz">?</div></div>`
    ];
  }
  function header(){ const h = $('#ntxSub'); if (h) h.textContent = ITEMS.length ? bn(pending().length) + 'টি বাকি · ' + bn(pct()) + '% আয়ত্ত' : 'ভুল প্রশ্নের রিভিশন'; }
  function chips(){
    const subs = [], cnt = new Map();
    ITEMS.forEach(it => { if (!cnt.has(it.subjectId)) { cnt.set(it.subjectId, 0); subs.push(it.subjectId); } if (!it.mastered) cnt.set(it.subjectId, cnt.get(it.subjectId) + 1); });
    if (S.sub && !cnt.has(S.sub)) S.sub = '';
    $('#ntxChips').innerHTML = subs.length ? `<button class="chip ${!S.sub ? 'a' : ''}" data-sb="">সব</button>` + subs.map(id => `<button class="chip ${S.sub === id ? 'a' : ''}" data-sb="${esc(id)}">${esc(subOf({subjectId:id}).name)}<em>${bn(cnt.get(id))}</em></button>`).join('') : '';
    $('#ntxTabs').innerHTML = TABS.map(x => `<button class="${x === S.f ? 'a' : ''}" data-f="${x}">${x}</button>`).join('');
  }
  function card(it){
    const s = subOf(it), r = it.note, open = S.open.has(it.k);
    const sub = [s.name, when(it.ts)].filter(Boolean).join(' · ');
    const expl = it.explanation ? `<p class="ex">${esc(it.explanation)}</p>` : '';
    return `<article class="nc ${it.mastered ? 'ok' : ''} ${open ? 'open' : ''}" data-k="${esc(it.k)}" style="--g:${s.color};--gt:${s.color}1F"><div class="ch"><span class="av">${esc(s.name.charAt(0) || 'ন')}</span><div class="mt2"><b>${esc(it.topic || s.name)}</b><small>${esc(sub)}${it.wrongCount > 1 ? ' · ' + bn(it.wrongCount) + ' বার ভুল' : ''}</small></div><button class="r bm ${it.saved ? 'a' : ''}" data-bm="1" aria-label="সেভ">${ic('mark')}</button><button class="r" data-sh="1" aria-label="শেয়ার">${ic('share')}</button></div><h3 data-ex="1">${esc(it.question)}</h3><div class="cmp">${it.wrongText ? `<div class="w"><small>${ic('x')}আপনার উত্তর</small><span>${esc(it.wrongText)}</span></div>` : ''}<div class="c" ${it.wrongText ? '' : 'style="grid-column:1/-1"'}><small>${ic('ck')}সঠিক উত্তর</small><span>${esc(it.correctText || '-')}</span></div></div><div class="more"><div>${expl}<textarea data-nt="1" placeholder="নিজের নোট লিখুন..." aria-label="নোট">${esc(r && r.aiExplain || '')}</textarea></div></div><div class="ft"><button class="lk" data-ex="1">${it.explanation ? 'ব্যাখ্যা' : 'নোট'} ${ic('dn')}</button><button class="ms" data-ms="1"><svg class="i" viewBox="0 0 24 24"><path d="${P.ck}"/></svg><span>${it.mastered ? 'আয়ত্ত হয়েছে' : 'আয়ত্ত করেছি'}</span></button></div></article>`;
  }
  let io = null;
  function list(){
    const q = S.q.trim().toLowerCase();
    const L = ITEMS.filter(it => (!S.sub || it.subjectId === S.sub)
      && (S.f === 'সব' || (S.f === 'বাকি' ? !it.mastered : S.f === 'আয়ত্ত' ? it.mastered : it.saved))
      && (!q || (it.question + ' ' + it.topic + ' ' + subOf(it).name + ' ' + it.correctText).toLowerCase().includes(q)));
    const box = $('#ntxList');
    box.innerHTML = L.length ? L.map(card).join('') : `<div class="emp"><b>${!ITEMS.length ? 'এখনো কোনো নোট নেই' : 'কিছু পাওয়া যায়নি'}</b>Question Bank বা Flash Test-এ ভুল হলে এখানে জমা হবে।</div>`;
    const cards = box.querySelectorAll('.nc');
    if (io) io.disconnect();
    if (typeof window.IntersectionObserver === 'function') {
      io = new IntersectionObserver(es => es.forEach(x => { if (x.isIntersecting) { x.target.classList.add('in'); io.unobserve(x.target); } }), { root: $('#ntxBody'), threshold: .05 });
      cards.forEach((c, i) => { c.style.transitionDelay = Math.min(i, 5) * 60 + 'ms'; io.observe(c); });
    } else cards.forEach(c => c.classList.add('in'));
  }
  function slidesMount(){
    $('#ntxCs').innerHTML = slides().map((s, i) => `<div class="sl ${i === S.si ? 'act' : ''}">${s}</div>`).join('');
    $('#ntxDots').innerHTML = [0,1,2].map(k => `<button class="dt ${k === S.si ? 'a' : ''}" data-sl="${k}" aria-label="স্লাইড ${bn(k + 1)}"><i></i></button>`).join('');
  }
  function refresh(full){ ITEMS = build(); META = subjectsMeta(); header(); chips(); list(); if (full) slidesMount(); else updSlides(); }
  function updSlides(){ const cs = $('#ntxCs'); if (!cs) return; const html = slides(); cs.querySelectorAll('.sl').forEach((el, i) => { el.innerHTML = html[i]; }); }
  const find = k => ITEMS.find(it => it.k === k);

  /* carousel */
  const SL = () => root ? root.querySelectorAll('#ntxCs .sl') : [];
  function dots(){ SL().forEach((s, k) => s.classList.toggle('act', k === S.si)); root.querySelectorAll('.dt').forEach((d, k) => { d.classList.remove('a'); if (k === S.si) { void d.offsetWidth; d.classList.add('a'); } }); }
  function go(i){ const cs = $('#ntxCs'); if (!cs || !SL()[0]) return; S.si = (i + 3) % 3; cs.scrollTo({ left: S.si * (SL()[0].offsetWidth + 12), behavior: 'smooth' }); dots(); auto(); }
  function auto(){ clearInterval(S.timer); S.timer = setInterval(() => { if (!root || !document.body.contains(root)) { clearInterval(S.timer); return; } if (!S.ss) go(S.si + 1); }, 4200); }

  /* flash / quiz */
  function quizPool(){ return pending().filter(it => it.options.length >= 2 && it.ci >= 0 && it.ci < it.options.length); }
  function sheet(h){ $('#ntxSh').innerHTML = '<div class="gr"></div>' + h; $('#ntxSh').classList.add('o'); $('#ntxBk').classList.add('o'); }
  function close(){ $('#ntxSh').classList.remove('o'); $('#ntxBk').classList.remove('o'); S.ss = null; refresh(false); }
  function sess(mode){
    const base = mode === 'quiz' ? quizPool() : pending().filter(it => it.correctText);
    const pool = (base.length ? base : (mode === 'quiz' ? ITEMS.filter(it => it.options.length >= 2 && it.ci >= 0) : ITEMS.filter(it => it.correctText))).slice(0, 10);
    if (!pool.length) { toast('রিভিশনের জন্য প্রশ্ন নেই'); return; }
    S.ss = { mode, list: pool, i: 0, sc: 0, fl: 0, an: -1 }; showS();
  }
  function showS(){
    const x = S.ss, it = x.list[x.i];
    const hd = `<div class="mt">${x.mode === 'quiz' ? 'কুইজ' : 'ফ্ল্যাশকার্ড'} · ${bn(Math.min(x.i + 1, x.list.length))}/${bn(x.list.length)}</div><div class="pg"><i style="width:${x.i / x.list.length * 100}%"></i></div>`;
    if (!it) { sheet(`<div class="done"><h2>দারুণ কাজ!</h2><p>${x.mode === 'quiz' ? 'স্কোর ' + bn(x.sc) + '/' + bn(x.list.length) : bn(x.sc) + 'টি প্রশ্ন জানা ছিল'}</p></div><button class="cta" data-cl="1">বন্ধ করুন</button>`); return; }
    const s = subOf(it);
    if (x.mode === 'flash') sheet(`${hd}<div class="fc ${x.fl ? 'f' : ''}" data-flip="1"><div class="ff"><small>${esc(s.name)}${it.topic ? ' · ' + esc(it.topic) : ''}</small><h3>${esc(it.question)}</h3><small>ট্যাপ করে উত্তর দেখুন</small></div><div class="fb"><div class="c">${esc(it.correctText)}</div>${it.explanation ? `<p>${esc(it.explanation)}</p>` : ''}</div></div><div class="ad"><button data-sk="0">জানি না</button><button class="a" data-sk="1">জানি</button></div>`);
    else sheet(`${hd}<h3 class="qq">${esc(it.question)}</h3>${it.options.map((o, k) => `<button class="op ${x.an >= 0 ? (k === it.ci ? 'ok' : k === x.an ? 'no' : '') : ''}" data-op="${k}">${esc(o)}</button>`).join('')}${x.an >= 0 ? `${it.explanation ? `<p class="ex">${esc(it.explanation)}</p>` : ''}<button class="cta" data-nx="1">${x.i + 1 < x.list.length ? 'পরের প্রশ্ন' : 'ফলাফল'}</button>` : ''}`);
  }

  function share(it){
    const text = `${it.question}\nসঠিক উত্তর: ${it.correctText}${it.explanation ? '\n' + it.explanation : ''}`;
    if (navigator.share) { navigator.share({ title: 'Admission Sky · নোট', text }).catch(() => {}); return; }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(() => toast('কপি হয়েছে'), () => toast('শেয়ার করা যায়নি'));
    else toast('শেয়ার করা যায়নি');
  }

  function onClick(e){
    const b = e.target.closest('button,[data-ex],[data-flip]'); if (!b || !root.contains(b)) return;
    const d = b.dataset, art = b.closest('.nc'), it = art ? find(art.dataset.k) : null;
    if (b.id === 'ntxBack') { if (typeof navigate === 'function') navigate('dashboard'); else location.hash = '#dashboard'; return; }
    if (b.id === 'ntxSs') { S.search = !S.search; $('#ntxSrw').classList.toggle('o', S.search); if (S.search) $('#ntxQ').focus(); else if (S.q) { S.q = ''; $('#ntxQ').value = ''; list(); } return; }
    if (b.id === 'ntxTh') { try { if (window.AhAppearance && AhAppearance.set) AhAppearance.set(isDark() ? 'light' : 'dark'); } catch (_) {} paintChrome(); themeIcon(); return; }
    if (d.sl !== undefined) return go(+d.sl);
    if (d.f) { S.f = d.f; chips(); list(); return; }
    if (d.sb !== undefined) { S.sub = d.sb; chips(); list(); return; }
    if (d.fl) return sess('flash');
    if (d.qz) return sess('quiz');
    if (d.cl) return close();
    if (it && d.ex !== undefined) { art.classList.toggle('open'); art.classList.contains('open') ? S.open.add(it.k) : S.open.delete(it.k); return; }
    if (it && d.bm) { const r = it.m || ensureNote(it); r.bookmarked = !r.bookmarked; b.classList.toggle('a', !!r.bookmarked); toast(r.bookmarked ? 'সেভ করা হয়েছে' : 'সেভ সরানো হয়েছে'); safely(put(it.m ? 'mistakes' : 'notes', r)); if (S.f === 'সেভ') list(); return; }
    if (it && d.ms) {
      const val = !it.mastered;
      safely(setMastered(it, val).then(() => {
        toast(val ? 'আয়ত্ত হয়েছে' : 'আবার রিভিশনে যোগ হলো');
        if (S.f === 'সব') { art.classList.toggle('ok', val); b.querySelector('span').textContent = val ? 'আয়ত্ত হয়েছে' : 'আয়ত্ত করেছি'; ITEMS = build(); header(); chips(); updSlides(); }
        else refresh(false);
      }));
      return;
    }
    if (it && d.sh) return share(it);
    const x = S.ss; if (!x) return;
    const cur = x.list[x.i];
    if (d.flip) { x.fl = x.fl ? 0 : 1; const fc = $('.fc'); if (fc) fc.classList.toggle('f'); return; }
    if (d.sk !== undefined) { const ok = d.sk === '1'; if (ok) x.sc++; safely(revise(cur, ok)); x.i++; x.fl = 0; showS(); return; }
    if (d.op !== undefined && x.an < 0) { x.an = +d.op; const ok = x.an === cur.ci; if (ok) x.sc++; safely(revise(cur, ok)); showS(); return; }
    if (d.nx) { x.i++; x.an = -1; showS(); }
  }
  function onInput(e){
    const t = e.target;
    if (t.id === 'ntxQ') { S.q = t.value; list(); return; }
    if (t.dataset && t.dataset.nt !== undefined) {
      const art = t.closest('.nc'), it = art && find(art.dataset.k); if (!it) return;
      const n = ensureNote(it); n.aiExplain = clean(t.value, 8000);
      clearTimeout(S.saveT[it.k]); S.saveT[it.k] = setTimeout(() => safely(put('notes', n)), 600);
    }
  }
  function themeIcon(){ const b = $('#ntxTh'); if (b) b.innerHTML = ic(isDark() ? 'sun' : 'moon'); }

  function render(){
    const html = `<div class="ntx" id="ntx"><div class="app"><header class="hd"><button class="ib" id="ntxBack" aria-label="ফিরে যান">${ic('back')}</button><div class="tt"><h1>নোট</h1><small id="ntxSub"></small></div><button class="ib" id="ntxSs" aria-label="সার্চ">${ic('search')}</button><button class="ib" id="ntxTh" aria-label="থিম"></button></header><div class="body" id="ntxBody"><div class="srw ${S.search ? 'o' : ''}" id="ntxSrw"><label class="sr">${ic('search')}<input id="ntxQ" placeholder="প্রশ্ন বা টপিক খুঁজুন" aria-label="খুঁজুন" value="${esc(S.q)}"></label></div><div class="cs" id="ntxCs"></div><div class="dts" id="ntxDots"></div><div class="chips" id="ntxChips"></div><div class="bar"><h2>ভুল প্রশ্ন</h2><div class="tabs" id="ntxTabs"></div></div><div id="ntxList"></div></div><div class="bk2" id="ntxBk"></div><div class="sh" id="ntxSh"></div><div class="tst" id="ntxToast" role="status" aria-live="polite"></div></div></div>`;
    if (typeof renderShell === 'function') renderShell(html, { topbar:false, hideNav:true });
    else { const app = document.getElementById('app'); if (app) app.innerHTML = html; }
    root = document.getElementById('ntx'); if (!root) return;
    S.ss = null;
    root.addEventListener('click', onClick);
    root.addEventListener('input', onInput);
    $('#ntxBk').addEventListener('click', close);
    const cs = $('#ntxCs');
    cs.addEventListener('scroll', () => { const w = SL()[0] ? SL()[0].offsetWidth + 12 : 1, k = Math.round(cs.scrollLeft / w); if (k !== S.si && k >= 0 && k < 3) { S.si = k; dots(); auto(); } }, { passive:true });
    cs.addEventListener('touchstart', () => clearInterval(S.timer), { passive:true });
    cs.addEventListener('touchend', auto, { passive:true });
    themeIcon(); paintChrome();
    refresh(true);
    requestAnimationFrame(() => { if (SL()[0]) cs.scrollLeft = S.si * (SL()[0].offsetWidth + 12); dots(); });
    auto(); fitViewport();
  }

  /* কিবোর্ড খুললে স্ক্রিন visual viewport-এর মাপে থাকে, পেজ সরে না */
  function fitViewport(){ const vv = window.visualViewport; if (!root || !vv) return; root.style.height = vv.height + 'px'; root.style.top = (vv.offsetTop || 0) + 'px'; }
  if (window.visualViewport) { visualViewport.addEventListener('resize', () => { if (root && document.body.contains(root)) fitViewport(); }); visualViewport.addEventListener('scroll', () => { if (root && document.body.contains(root)) fitViewport(); }); }
  window.addEventListener('ah:appearance', () => { if (root && document.body.contains(root)) { paintChrome(); themeIcon(); } });
  document.addEventListener('admission:route-rendered', () => {
    if (!isRoute() && root) { root = null; clearInterval(S.timer); try { window.AhAppearance && AhAppearance.apply && AhAppearance.apply(); } catch (_) {} }
  });

  window.renderNotesTool = function(){
    const parts = String((window.Router && Router.path) || 'notes').split('/');
    if (parts.length > 1 && typeof navigate === 'function') { history.replaceState(null, document.title, location.pathname + location.search + '#notes'); if (window.Router) Router.path = 'notes'; }
    render();
  };
  window.openNotesSubject = function(){ if (typeof navigate === 'function') navigate('notes'); };
  window.openNotesTopic = function(){ if (typeof navigate === 'function') navigate('notes'); };

  const style = document.createElement('style'); style.id = 'notes-screen-v2-styles';
  style.textContent = `
.ntx{--p:#2E8BFF;--navy:#0F1B45;--bg:#F3F7FD;--sol:#fff;--mut:#6F7FA8;--ln:#E7EEF9;--chip:#EAF2FF;--ok:#11A56E;--bad:#E5484D;--e:cubic-bezier(.22,1,.36,1);--cs:0 1px 2px rgba(15,27,69,.05),0 10px 28px rgba(46,139,255,.09);position:fixed;left:0;right:0;top:0;height:100%;z-index:60;background:var(--bg);color:var(--navy);font-family:"Noto Sans Bengali","Hind Siliguri",system-ui,sans-serif;line-height:1.5;-webkit-font-smoothing:antialiased;overflow:hidden;overscroll-behavior:none;touch-action:pan-y;-webkit-text-size-adjust:100%;text-size-adjust:100%;user-select:none;-webkit-user-select:none}
.ntx.dk{--bg:#0A1230;--sol:#142048;--navy:#EAF1FF;--mut:#8FA0D3;--ln:#22305F;--chip:#1C2A5C;--cs:0 1px 2px rgba(0,0,0,.3),0 10px 28px rgba(0,0,0,.25)}
.ntx *{box-sizing:border-box;margin:0;-webkit-tap-highlight-color:transparent}
.ntx button,.ntx input,.ntx textarea{font:inherit;color:inherit;border:0;background:none}.ntx button{cursor:pointer;transition:transform .2s var(--e),opacity .2s;touch-action:manipulation}.ntx button:active{transform:scale(.95)}
.ntx input,.ntx textarea{user-select:text;-webkit-user-select:text;font-size:16px}
.ntx :focus-visible{outline:2px solid var(--p);outline-offset:2px}.ntx input:focus,.ntx textarea:focus{outline:none}
.ntx svg.i{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;flex:none}
.ntx .app{position:relative;height:100%;max-width:480px;margin:0 auto;overflow:hidden;display:flex;flex-direction:column;background:var(--bg)}
.ntx .hd{flex:none;position:relative;z-index:3;display:flex;align-items:center;gap:8px;padding:calc(env(safe-area-inset-top,0px) + 12px) 20px 14px;background-color:var(--bg)}
.ntx .ib{width:42px;height:42px;border-radius:14px;background:var(--sol);box-shadow:var(--cs);display:grid;place-items:center;color:var(--navy);flex:none}
.ntx .tt{flex:1;min-width:0;margin-left:4px}.ntx .tt h1{font-size:26px;font-weight:700;line-height:1.25}.ntx .tt small{display:block;color:var(--mut);font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ntx .body{position:relative;flex:1;min-height:0;overflow-x:hidden;overflow-y:auto;padding:0 0 calc(48px + env(safe-area-inset-bottom,0px));-webkit-overflow-scrolling:touch;overscroll-behavior:contain;touch-action:pan-y}
.ntx .body:before{content:"";position:absolute;left:0;right:0;top:0;height:220px;background:radial-gradient(120% 100% at 50% 0%,rgba(92,200,255,.18),transparent 70%);pointer-events:none}.ntx .body>*{position:relative}
.ntx .srw{display:none;padding:0 20px 14px}.ntx .srw.o{display:block}.ntx .sr{display:flex;align-items:center;gap:8px;height:48px;padding:0 16px;border-radius:16px;background:var(--sol);box-shadow:var(--cs);color:var(--mut)}.ntx .sr input{flex:1;min-width:0;height:100%;color:var(--navy)}
.ntx .cs{display:flex;gap:12px;padding:4px 6% 6px;overflow-x:auto;overflow-y:hidden;scroll-snap-type:x mandatory;scrollbar-width:none;touch-action:pan-x pan-y;overscroll-behavior-x:contain}.ntx .cs::-webkit-scrollbar{display:none}
.ntx .sl{flex:0 0 88%;scroll-snap-align:center;transform:scale(.94);opacity:.6;transition:transform .7s var(--e),opacity .7s var(--e)}.ntx .sl.act{transform:none;opacity:1}
.ntx .si{position:relative;overflow:hidden;height:166px;border-radius:28px;padding:20px 22px;color:#fff;display:flex;justify-content:space-between;align-items:center;gap:12px;box-shadow:0 14px 30px rgba(15,27,69,.18)}
.ntx .si:before{content:"";position:absolute;inset:0;background:radial-gradient(70% 90% at 100% 0%,rgba(255,255,255,.28),transparent 60%)}.ntx .si>*{position:relative}.ntx .si>div:first-child{min-width:0}
.ntx .si small{opacity:.85;font-size:13px;font-weight:500}.ntx .si h2{font-size:21px;font-weight:700;line-height:1.35;margin:2px 0}.ntx .si p{font-size:13.5px;opacity:.9}
.ntx .go{margin-top:12px;background:#fff;color:#1556D8;padding:8px 18px;border-radius:14px;font-weight:600;font-size:14px;box-shadow:0 6px 14px rgba(0,0,0,.14)}
.ntx .vz{position:relative;width:86px;height:86px;border-radius:50%;background:rgba(255,255,255,.16);display:grid;place-items:center;font-size:34px;font-weight:700;flex:none}
.ntx .vz svg{position:absolute;inset:0;transform:rotate(-90deg)}.ntx .vz circle{fill:none;stroke-width:7;stroke-linecap:round}.ntx .vz .c2{stroke:#fff;stroke-dasharray:238.8;transition:stroke-dashoffset 1.4s var(--e)}.ntx .vz .c1{stroke:rgba(255,255,255,.25)}.ntx .vz b{font-size:19px;font-weight:700}
.ntx .dts{display:flex;justify-content:center;gap:6px;margin:12px 0 20px}.ntx .dt{width:6px;height:6px;border-radius:3px;background:var(--ln);overflow:hidden;padding:0;transition:width .5s var(--e)}.ntx .dt.a{width:26px}.ntx .dt i{display:block;height:100%;width:0;background:var(--p);border-radius:3px}.ntx .dt.a i{animation:ntxfill 4.2s linear forwards}@keyframes ntxfill{to{width:100%}}
.ntx .chips{display:flex;gap:8px;overflow-x:auto;padding:0 20px 4px;scrollbar-width:none;touch-action:pan-x pan-y}.ntx .chips::-webkit-scrollbar{display:none}.ntx .chips:empty{display:none}
.ntx .chip{padding:8px 16px;border-radius:14px;background:var(--sol);box-shadow:var(--cs);color:var(--mut);font-weight:500;font-size:14px;white-space:nowrap;transition:background .3s var(--e),color .3s var(--e),transform .2s}.ntx .chip.a{background:var(--navy);color:var(--bg)}.ntx .chip em{font-style:normal;opacity:.6;margin-left:5px;font-size:12px}
.ntx .bar{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:24px 20px 12px}.ntx .bar h2{font-size:18px;font-weight:700}
.ntx .tabs{display:flex;gap:4px;padding:3px;border-radius:12px;background:var(--chip)}.ntx .tabs button{font-size:13px;color:var(--mut);padding:4px 11px;border-radius:9px;font-weight:500;transition:background .3s var(--e),color .3s}.ntx .tabs .a{background:var(--sol);color:var(--p);font-weight:600;box-shadow:0 1px 4px rgba(15,27,69,.1)}
.ntx .nc{margin:0 20px 14px;padding:16px;background:var(--sol);border-radius:24px;box-shadow:var(--cs);opacity:0;transform:translateY(18px);transition:opacity .6s var(--e),transform .6s var(--e),box-shadow .3s}.ntx .nc.in{opacity:1;transform:none}.ntx .nc.ok.in{opacity:.72}
.ntx .ch{display:flex;align-items:center;gap:12px}.ntx .av{width:42px;height:42px;border-radius:14px;display:grid;place-items:center;font-weight:700;font-size:17px;flex:none;background:var(--gt);color:var(--g)}
.ntx .mt2{flex:1;min-width:0}.ntx .mt2 b{display:block;font-size:15px;font-weight:600;line-height:1.3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.ntx .mt2 small{color:var(--mut);font-size:12.5px}
.ntx .ch button.r{width:34px;height:34px;display:grid;place-items:center;border-radius:11px;color:var(--mut);flex:none}.ntx .ch .bm.a{color:#F5A000;animation:ntxpop .45s var(--e)}.ntx .ch .bm.a svg{fill:currentColor}@keyframes ntxpop{40%{transform:scale(1.35)}}
.ntx .nc h3{font-size:17px;font-weight:600;line-height:1.6;margin:14px 0;cursor:pointer;word-break:break-word}
.ntx .cmp{display:grid;grid-template-columns:1fr 1fr;gap:8px}.ntx .cmp>div{padding:10px 12px;border-radius:16px;min-width:0}.ntx .cmp small{display:flex;align-items:center;gap:5px;font-size:12px;font-weight:500;margin-bottom:2px}.ntx .cmp span{font-size:14.5px;font-weight:600;line-height:1.45;display:block;word-break:break-word}
.ntx .cmp .w{background:rgba(229,72,77,.09);color:var(--bad)}.ntx .cmp .c{background:rgba(17,165,110,.1);color:var(--ok)}.ntx .cmp svg.i{width:13px;height:13px;stroke-width:2.8}
.ntx .more{display:grid;grid-template-rows:0fr;transition:grid-template-rows .5s var(--e)}.ntx .nc.open .more{grid-template-rows:1fr}.ntx .more>div{overflow:hidden;min-height:0}
.ntx .ex{margin-top:12px;padding:12px 14px;border-radius:16px;background:var(--chip);font-size:14px;line-height:1.7;white-space:pre-wrap;word-break:break-word}
.ntx .more textarea{display:block;width:100%;margin-top:8px;border-radius:16px;border:1.5px dashed var(--ln);padding:10px 14px;resize:none;height:76px;background:transparent;transition:border-color .3s}.ntx .more textarea:focus{border-color:var(--p)}
.ntx .ft{display:flex;align-items:center;justify-content:space-between;margin-top:14px}.ntx .lk{display:flex;align-items:center;gap:4px;color:var(--p);font-size:14px;font-weight:500}.ntx .lk svg.i{width:16px;height:16px;transition:transform .4s var(--e)}.ntx .nc.open .lk svg.i{transform:rotate(180deg)}
.ntx .ms{display:flex;align-items:center;gap:6px;padding:9px 18px;border-radius:14px;background:var(--chip);color:var(--p);font-weight:600;font-size:14px;transition:background .4s var(--e),color .4s var(--e)}.ntx .ms svg.i{width:16px;height:16px;stroke-width:3;stroke-dasharray:24;stroke-dashoffset:24;transition:stroke-dashoffset .5s var(--e) .1s}.ntx .nc.ok .ms{background:var(--ok);color:#fff}.ntx .nc.ok .ms svg.i{stroke-dashoffset:0}
.ntx .emp{text-align:center;color:var(--mut);padding:40px 30px;font-size:14px}.ntx .emp b{display:block;font-size:17px;color:var(--navy);margin-bottom:4px;font-weight:600}
.ntx .bk2{position:absolute;inset:0;background:rgba(10,18,48,.45);opacity:0;pointer-events:none;transition:opacity .4s;z-index:8}.ntx .bk2.o{opacity:1;pointer-events:auto}
.ntx .sh{position:absolute;left:0;right:0;bottom:0;max-height:92%;overflow-y:auto;overscroll-behavior:contain;background:var(--sol);border-radius:30px 30px 0 0;transform:translateY(105%);transition:transform .55s var(--e);z-index:9;padding:0 20px calc(24px + env(safe-area-inset-bottom,0px))}.ntx .sh.o{transform:none}
.ntx .gr{width:40px;height:4px;border-radius:2px;background:var(--ln);margin:10px auto 16px}
.ntx .pg{height:6px;border-radius:3px;background:var(--chip);overflow:hidden;margin-bottom:16px}.ntx .pg i{display:block;height:100%;background:linear-gradient(90deg,#2E8BFF,#5CC8FF);border-radius:3px;transition:width .5s var(--e)}.ntx .mt{color:var(--mut);font-size:13px;margin-bottom:8px}
.ntx .fc{perspective:1000px;height:250px;cursor:pointer;position:relative}.ntx .fc>div{position:absolute;inset:0;border-radius:26px;backface-visibility:hidden;-webkit-backface-visibility:hidden;transition:transform .7s var(--e);display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center;padding:24px;gap:10px;overflow:auto}
.ntx .ff{background:linear-gradient(135deg,#1E78FF,#5CC8FF);color:#fff;box-shadow:0 14px 30px rgba(46,139,255,.35)}.ntx .ff h3{font-size:19px;line-height:1.6;font-weight:600}.ntx .ff small{opacity:.85;font-size:13px}.ntx .fb{background:var(--chip);transform:rotateY(180deg)}.ntx .fb .c{color:var(--ok);font-size:22px;font-weight:700}.ntx .fb p{font-size:14px;color:var(--mut);line-height:1.7}
.ntx .fc.f .ff{transform:rotateY(180deg)}.ntx .fc.f .fb{transform:rotateY(0)}
.ntx .ad{display:flex;gap:10px;margin-top:14px}.ntx .ad button{flex:1;height:50px;border-radius:16px;background:var(--chip);color:var(--navy);font-weight:600}.ntx .ad .a{background:var(--p);color:#fff}
.ntx .qq{font-size:18px;font-weight:600;margin-bottom:14px;line-height:1.6}
.ntx .op{display:block;width:100%;text-align:left;padding:13px 16px;border-radius:16px;background:var(--chip);margin-bottom:8px;font-weight:500;transition:background .3s,color .3s}.ntx .op.ok{background:var(--ok);color:#fff}.ntx .op.no{background:var(--bad);color:#fff}
.ntx .cta{width:100%;margin-top:14px;height:52px;border-radius:16px;background:var(--p);color:#fff;font-weight:600;font-size:16px;box-shadow:0 10px 22px rgba(46,139,255,.35)}
.ntx .done{text-align:center;padding:14px 0}.ntx .done h2{font-size:24px;font-weight:700}.ntx .done p{color:var(--mut);margin-top:6px}
.ntx .tst{position:absolute;left:50%;top:calc(env(safe-area-inset-top,0px) + 16px);transform:translate(-50%,-20px);background:var(--navy);color:var(--bg);padding:9px 18px;border-radius:14px;font-weight:500;font-size:14px;opacity:0;transition:.4s var(--e);z-index:20;pointer-events:none;white-space:nowrap}.ntx .tst.o{opacity:1;transform:translate(-50%,0)}
@media (prefers-reduced-motion:reduce){.ntx *{animation:none!important;transition:none!important}.ntx .nc{opacity:1;transform:none}}
`;
  document.head.appendChild(style);
})();
