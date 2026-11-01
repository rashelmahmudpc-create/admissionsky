/*
 * Mistake Notebook, Admission Sky
 * সব পরীক্ষার ভুল প্রশ্ন + AI ব্যাখ্যা এক জায়গায়; exam-এর আগে revision।
 * ব্যাখ্যা AI secure proxy (admission-hub-ai-proxy) থেকে আসে, কোনো API key এখানে নেই।
 * Explanation cache result-analysis tool-এর সাথে শেয়ার হয় (ah-explanation-cache)।
 */
(() => {
  'use strict';

  const EXPL_KEY = 'ah-explanation-cache';
  const LEARNED_KEY = 'ah-notebook-learned';
  const STYLE_ID = 'mistake-notebook-style';
  const safe = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  let EXPL = {}, LEARNED = {}, filter = 'active', busy = false;

  const load = () => {
    try { EXPL = JSON.parse(localStorage.getItem(EXPL_KEY) || '{}') || {}; } catch (_) { EXPL = {}; }
    try { LEARNED = JSON.parse(localStorage.getItem(LEARNED_KEY) || '{}') || {}; } catch (_) { LEARNED = {}; }
  };
  const saveLearned = () => { try { localStorage.setItem(LEARNED_KEY, JSON.stringify(LEARNED)); } catch (_) {} };
  const saveExpl = () => { try { localStorage.setItem(EXPL_KEY, JSON.stringify(EXPL)); } catch (_) {} };
  const explKey = (q) => `${q.id}::${q.selected ?? q.selectedIndex}::2`;
  const isLearned = (q) => Boolean(LEARNED[q.id]);
  const optText = (q, i) => (Array.isArray(q.options) && Number.isInteger(i) && q.options[i] != null) ? q.options[i] : '';

  function allWrongQuestions() {
    const byId = new Map();
    const cacheRef = (typeof CACHE !== 'undefined' && CACHE) || window.CACHE || {};
    for (const r of (Array.isArray(cacheRef.examResults) ? cacheRef.examResults : [])) {
      const snap = Array.isArray(r?.snapshot) ? r.snapshot : [];
      for (const row of snap) {
        if (row?.status !== 'wrong') continue;
        const qid = String(row.questionId || '');
        if (!qid) continue;
        const prev = byId.get(qid);
        const live = (Array.isArray(cacheRef.questions) ? cacheRef.questions : []).find((x) => String(x?.id) === qid) || {};
        const entry = {
          id: qid,
          prompt: live.question || live.text || row.question || `প্রশ্ন ${qid}`,
          options: Array.isArray(live.options) ? live.options : (Array.isArray(row.options) ? row.options : []),
          answerIndex: Number.isInteger(Number(row.answerIndex)) ? Number(row.answerIndex) : (Number.isInteger(Number(live.answerIndex)) ? Number(live.answerIndex) : -1),
          selectedIndex: Number.isInteger(Number(row.selectedIndex)) ? Number(row.selectedIndex) : (Number.isInteger(Number(row.answer)) ? Number(row.answer) : -1),
          subject: row.subjectName || live.subjectId || '',
          topic: row.topicName || live.topicId || '',
          examTitle: r?.title || r?.name || 'পরীক্ষা',
          date: r?.completedAt || r?.date || 0,
          count: (prev?.count || 0) + 1
        };
        if (!prev || entry.date >= prev.date) byId.set(qid, Object.assign({}, prev, entry, { count: Math.max(entry.count, prev?.count || 0) }));
        else byId.set(qid, Object.assign({}, prev, { count: prev.count + 1 }));
      }
    }
    return [...byId.values()].sort((a, b) => b.date - a.date);
  }

  function explanationOf(q) { const e = EXPL[explKey(q)]; if (!e) return ''; if (typeof e.explanation === 'string' && e.explanation.trim()) return e.explanation.trim(); return [e.whyCorrect, e.whyWrong, e.easy, e.memory, e.trap, e.practice].filter((x) => typeof x === 'string' && x.trim()).join(' '); }
  function memoryOf(q) { const e = EXPL[explKey(q)]; return e && typeof e.memory === 'string' ? e.memory.trim() : ''; }

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const st = document.createElement('style');
    st.id = STYLE_ID;
    st.textContent = `
    .nb-wrap{display:flex;flex-direction:column;gap:12px}
    .nb-head{background:linear-gradient(135deg,#0d6b50,#084331);color:#fff;border-radius:20px;padding:18px 16px}
    .nb-head h2{margin:0;font-size:19px}.nb-head p{margin:6px 0 0;font-size:12px;opacity:.85}
    .nb-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}
    .nb-actions button{border:0;border-radius:12px;padding:11px 13px;font:800 11.5px inherit;cursor:pointer}
    .nb-btn-primary{background:#fff;color:#0b6b50}.nb-btn-flash{background:#ffd57a;color:#5c3d00}.nb-btn-ghost{background:rgba(255,255,255,.16);color:#fff}
    .nb-filters{display:flex;gap:6px;flex-wrap:wrap}
    .nb-filter{border:1px solid var(--line);background:var(--card);color:var(--sub);border-radius:999px;padding:7px 12px;font-size:11px;font-weight:800;cursor:pointer}
    .nb-filter.active{background:var(--emerald);border-color:var(--emerald);color:#fff}
    .nb-item{background:var(--card);border:1px solid var(--line);border-left:5px solid var(--red);border-radius:16px;padding:14px;box-shadow:0 6px 18px rgba(15,107,79,.05)}
    .nb-item.learned{border-left-color:var(--green);opacity:.82}
    .nb-item-head{display:flex;justify-content:space-between;gap:8px;align-items:center;flex-wrap:wrap}
    .nb-qno{font-weight:900;color:var(--emerald-d);font-size:12px}
    .nb-count{font-size:10px;background:#fee2e2;color:#b91c1c;padding:3px 7px;border-radius:8px;font-weight:800}
    .nb-q{font-size:15px;line-height:1.6;margin:9px 0;overflow-wrap:anywhere}
    .nb-tags{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px}
    .nb-tags span{font-size:10px;color:var(--sub);background:var(--mint);padding:4px 8px;border-radius:8px;overflow-wrap:anywhere}
    .nb-ans{font-size:12px;line-height:1.7;background:var(--mint);border-radius:10px;padding:9px 10px;color:var(--sub);margin-top:8px}
    .nb-ans b{color:var(--text)}
    .nb-exp{margin-top:9px;padding:11px;border-radius:11px;background:#fff8e8;border:1px solid #f0dcb0;color:#5c4a1a;font-size:12.5px;line-height:1.8;overflow-wrap:anywhere}
    .nb-exp b{display:block;margin-bottom:4px;color:#8a6100}
    .nb-mem{margin-top:7px;font-size:12px;color:#7a5200;font-weight:700;overflow-wrap:anywhere}
    .nb-none{margin-top:9px;font-size:11.5px;color:var(--sub)}
    .nb-foot{display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-top:10px}
    .nb-meta{font-size:10.5px;color:var(--sub)}
    .nb-learn{border:1px solid var(--line);background:var(--card);color:var(--text);border-radius:10px;padding:7px 10px;font-size:10.5px;font-weight:800;cursor:pointer}
    .nb-learn.on{background:#dcfce7;border-color:#86efac;color:#15803d}
    .nb-empty{text-align:center;padding:26px 16px;background:var(--card);border:1px dashed var(--line);border-radius:16px;color:var(--sub);font-size:13px}
    .nb-status{font-size:11.5px;color:var(--sub);min-height:16px}
    @keyframes nbSpin{to{transform:rotate(360deg)}}
    .nb-spin{display:inline-block;animation:nbSpin .9s linear infinite}`;
    document.head.appendChild(st);
  }

  function shell(html) { if (typeof window.renderShell === 'function') return window.renderShell(html, { title: 'Mistake Notebook' }); const app = document.getElementById('app'); if (app) app.innerHTML = html; }

  function render() {
    ensureStyle(); load();
    const all = allWrongQuestions();
    const learnedCount = all.filter(isLearned).length;
    const withExpl = all.filter((q) => explanationOf(q)).length;
    const missing = all.length - withExpl;
    const shown = all.filter((q) => filter === 'all' ? true : filter === 'learned' ? isLearned(q) : !isLearned(q) && (filter === 'active' ? true : filter === 'have' ? Boolean(explanationOf(q)) : !explanationOf(q)));
    const html = `<div class="page"><div class="nb-wrap">
      <div class="nb-head"><h2>📓 ভুলের খাতা</h2><p>মোট <b>${all.length}</b>টি ভুল প্রশ্ন · ব্যাখ্যা আছে <b>${withExpl}</b>টিতে · শিখে ফেলেছো <b>${learnedCount}</b>টি${missing > 0 ? ` · ব্যাখ্যা বাকি <b>${missing}</b>টি` : ''}</p>
      <div class="nb-actions">
        ${missing > 0 ? `<button class="nb-btn-primary" onclick="MistakeNotebook.explainMissing()">${busy ? '<span class="nb-spin">◌</span> AI ব্যাখ্যা আসছে…' : '🔄 AI ব্যাখ্যা তৈরি করো (বাকি ' + missing + 'টি)'}</button>` : ''}
        ${all.some((q) => !isLearned(q)) ? `<button class="nb-btn-flash" onclick="MistakeNotebook.flashUnlearned()">⚡ না শেখা ভুলগুলোতে পরীক্ষা দাও</button>` : ''}
        ${all.length ? `<button class="nb-btn-ghost" onclick="MistakeNotebook.resetLearned()">↺ শেখা রিসেট</button>` : ''}
      </div></div>
      <div class="nb-status" id="nbStatus"></div>
      ${all.length ? `<div class="nb-filters">${[['active','এখনো শেখো'],['have','ব্যাখ্যা আছে'],['missing','ব্যাখ্যা নেই'],['learned','শেখা হয়েছে'],['all','সব']].map(([k, l]) => `<button class="nb-filter ${filter === k ? 'active' : ''}" onclick="MistakeNotebook.setFilter('${k}')">${l}</button>`).join('')}</div>` : ''}
      ${!all.length ? `<div class="nb-empty">এখনো কোনো ভুল প্রশ্ন জমা হয়নি।<br>পরীক্ষা দিলে ভুলগুলো এখানে একে একে জমা হতে থাকবে 📚</div>`
        : !shown.length ? `<div class="nb-empty">এই ফিল্টারে কিছু নেই।</div>`
        : shown.map((q) => { const exp = explanationOf(q); const mem = memoryOf(q); const learned = isLearned(q); return `<article class="nb-item ${learned ? 'learned' : ''}"><div class="nb-item-head"><span class="nb-qno">${q.count > 1 ? `🔁 ${q.count} বার ভুল · ` : ''}${safe(q.subject || '')}</span>${learned ? '<span class="nb-count" style="background:#dcfce7;color:#15803d">✅ শেখা</span>' : ''}</div><div class="nb-tags">${q.topic ? `<span>${safe(q.topic)}</span>` : ''}<span>${q.date ? new Date(q.date).toLocaleDateString('bn-BD') : ''}</span></div><p class="nb-q">${safe(q.prompt)}</p><div class="nb-ans"><b>তোমার উত্তর:</b> ${safe(q.selectedIndex >= 0 ? optText(q, q.selectedIndex) : 'উত্তর দেওয়া হয়নি')} · <b>সঠিক উত্তর:</b> ${safe(optText(q, q.answerIndex) || 'তথ্য নেই')}</div>${exp ? `<div class="nb-exp"><b>💡 AI ব্যাখ্যা</b>${safe(exp)}${mem ? `<div class="nb-mem">🧠 ${safe(mem)}</div>` : ''}</div>` : `<div class="nb-none">ব্যাখ্যা এখনো নেই, উপরের “🔄 AI ব্যাখ্যা তৈরি করো” বাটনে চাপো।</div>`}<div class="nb-foot"><span class="nb-meta">📚 ${safe(q.examTitle)}</span><button class="nb-learn ${learned ? 'on' : ''}" onclick="MistakeNotebook.toggleLearned('${safe(q.id)}')">${learned ? '✅ শিখে ফেলেছি' : 'শিখে ফেলেছি চিহ্নিত করো'}</button></div></article>`; }).join('')}
    </div></div>`;
    shell(html);
  }

  let tsApiPromise = null;
  function ensureTsApi() {
    if (window.turnstile) return Promise.resolve(window.turnstile);
    if (tsApiPromise) return tsApiPromise;
    tsApiPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      s.async = true;
      s.onload = () => window.turnstile ? resolve(window.turnstile) : reject(new Error('Turnstile লোড হয়নি'));
      s.onerror = () => { tsApiPromise = null; reject(new Error('Turnstile script লোড হয়নি')); };
      document.head.appendChild(s);
    });
    return tsApiPromise;
  }
  function getTurnstileToken(siteKey) {
    if (!siteKey) return Promise.reject(new Error('Human verification site key নেই।'));
    return ensureTsApi().then((api) => new Promise((resolve, reject) => {
      const host = document.createElement('div');
      host.setAttribute('aria-hidden', 'true');
      host.style.cssText = 'position:fixed;right:0;bottom:0;width:1px;height:1px;overflow:hidden;opacity:.01';
      document.body.appendChild(host);
      let done = false, wid = null;
      const finish = (fn, v) => { if (done) return; done = true; clearTimeout(t); try { api.remove(wid); } catch (_) {} try { host.remove(); } catch (_) {} fn(v); };
      const t = setTimeout(() => finish(reject, new Error('Human verification সময়মতো হয়নি।')), 45000);
      try {
        wid = api.render(host, { sitekey: siteKey, action: 'result_analysis', size: 'invisible', appearance: 'interaction-only',
          callback: (tok) => finish(resolve, String(tok || '')),
          'error-callback': () => finish(reject, new Error('Human verification ব্যর্থ।')),
          'expired-callback': () => finish(reject, new Error('Human verification মেয়াদ শেষ।')) });
      } catch (e) { finish(reject, e instanceof Error ? e : new Error('Turnstile শুরু হয়নি।')); return; }
      try { api.execute(wid); } catch (_) {}
    }));
  }
  async function pollRun(endpoint, runId) {
    const url = `${String(endpoint).replace(/\/+$/, '')}/${encodeURIComponent(runId)}`;
    const deadline = Date.now() + 180000;
    while (Date.now() < deadline) {
      const res = await fetch(url, { headers: { Accept: 'application/json' } });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      const st = String(data.status || '').toLowerCase();
      if (st === 'completed') return String(data.analysis || data.result || data.text || '');
      if (st === 'failed' || st === 'cancelled') throw new Error('AI run সম্পন্ন হয়নি।');
      await new Promise((r) => setTimeout(r, 2500));
    }
    throw new Error('AI অনেক সময় নিচ্ছে; পরে আবার চেষ্টা করো।');
  }
  const parseJson = (text) => { const raw = String(text || '').trim(); try { const p = JSON.parse(raw); return p && typeof p === 'object' ? p : null; } catch (_) {} const a = raw.indexOf('{'), b = raw.lastIndexOf('}'); if (a >= 0 && b > a) { try { const p = JSON.parse(raw.slice(a, b + 1)); return p && typeof p === 'object' ? p : null; } catch (_) {} } return null; };

  function setStatus(msg) { const el = document.getElementById('nbStatus'); if (el) el.textContent = msg || ''; }

  async function explainMissing() {
    if (busy) return;
    load();
    const all = allWrongQuestions();
    const missing = all.filter((q) => !explanationOf(q));
    if (!missing.length) { setStatus('সব প্রশ্নের ব্যাখ্যা আগেই আছে ✓'); render(); return; }
    const endpoint = String(window.ADMISSION_HUB_AI_ENDPOINT || '').trim();
    const siteKey = String(window.ADMISSION_HUB_TURNSTILE_SITEKEY || '').trim();
    if (!endpoint) { setStatus('Secure AI endpoint পাওয়া যায়নি।'); return; }
    busy = true; render();
    let ok = 0;
    try {
      /* One batch a day: the server accepts a single request and takes at most
         30 questions in it. Sending 30 once beats looping in 25s, which spent
         the day's only request and then failed part-way with a 429. */
      const chunk = missing.slice(0, 30);
      const leftOver = missing.length - chunk.length;
      setStatus(`AI ব্যাখ্যা আসছে… (${chunk.length}/${missing.length})`);
      const payload = { schemaVersion: 'admission-hub-result-analysis-v1', result: { id: 'notebook', title: 'Mistake Notebook', examType: 'ভুল সংকলন', completedAt: new Date().toISOString() }, previousResults: [], subjectPerformance: [], topicPerformance: [], requestType: 'question_explanation_batch', explanationQuestions: chunk.map((q) => ({ id: q.id, prompt: q.prompt, options: q.options, selected: q.selectedIndex >= 0 ? optText(q, q.selectedIndex) : 'উত্তর দেওয়া হয়নি', correct: optText(q, q.answerIndex), subject: q.subject, topic: q.topic, difficulty: 'মাঝারি', status: 'wrong' })) };
      const token = await getTurnstileToken(siteKey);
      const res = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(Object.assign({}, payload, { turnstileToken: token })) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      const text = data.analysis || data.result || data.text || (data.runId ? await pollRun(endpoint, data.runId) : '');
      const parsed = parseJson(text);
      const rows = Array.isArray(parsed?.explanations) ? parsed.explanations : (parsed && parsed.questionId ? [parsed] : []);
      const wanted = new Set(chunk.map((q) => q.id));
      rows.forEach((row) => { if (row && wanted.has(String(row.questionId))) { const q = chunk.find((x) => String(x.id) === String(row.questionId)); if (q) EXPL[explKey(q)] = row; ok++; } });
      saveExpl(); render(); busy = true;
      setStatus(leftOver > 0 ? `✅ ${ok}টি যোগ হয়েছে। দৈনিক সীমা ১, তাই বাকি ${leftOver}টি আগামীকাল আসবে।` : `✅ ${ok}টি নতুন ব্যাখ্যা যোগ হয়েছে।`);
    } catch (e) {
      setStatus(`ব্যাখ্যা পাওয়া যায়নি: ${e?.message || 'অজানা সমস্যা'}, পরে আবার চেষ্টা করো।`);
    } finally { busy = false; render(); }
  }

  function flashUnlearned() {
    load();
    const ids = allWrongQuestions().filter((q) => !isLearned(q)).map((q) => q.id);
    if (!ids.length) { setStatus('সব শিখে ফেলেছো! নতুন পরীক্ষা দাও 💪'); return; }
    if (typeof window.startAiFlashTest === 'function') { window.startAiFlashTest(ids); }
    else setStatus('Flash test ইঞ্জিন পাওয়া যায়নি।');
  }
  function toggleLearned(id) { load(); if (LEARNED[id]) delete LEARNED[id]; else LEARNED[id] = Date.now(); saveLearned(); render(); }
  function resetLearned() { if (!confirm('সব “শিখে ফেলেছি” চিহ্ন মুছে যাবে, নিশ্চিত?')) return; LEARNED = {}; saveLearned(); render(); }
  function setFilter(k) { filter = k; render(); }

  window.MistakeNotebook = { render, explainMissing, flashUnlearned, toggleLearned, resetLearned, setFilter };
  const nbRoute = () => String(location.hash.replace(/^#\/?/, '').split('?')[0] || window.Router?.path || 'dashboard');
  const prevRoute = window.__admissionRenderRoute;
  if (typeof prevRoute === 'function') window.__admissionRenderRoute = function mistakeNotebookRoute() { if (nbRoute() === 'mistake-notebook') return render(); return prevRoute.apply(this, arguments); };
  const prevRender = window.render;
  if (typeof prevRender === 'function') window.render = function mistakeNotebookRender() { if (nbRoute() === 'mistake-notebook') return render(); return prevRender.apply(this, arguments); };
  window.renderMistakeNotebook = render;
})();
