/* Admission Hub, P12 Smart Vocabulary (spaced repetition).
 *
 * A native tool page over the existing Vocabulary Master words. It adds three
 * P12 pieces on top of the words the app already stores:
 *   - weak-word detection  (a word failed repeatedly is flagged, via the engine)
 *   - an SRS review schedule (SM-2 style; grades Again/Hard/Good/Easy)
 *   - a mastery dashboard   (due / learning / mastered / weak, per bucket)
 *
 * It reads words from the vocabularyMaster store and delegates all scheduling
 * maths to window.AhVocabSrs, keeping its own small review state in localStorage.
 */
(() => {
  'use strict';

  const ROUTE = 'vocabulary-srs';
  const STATE_KEY = 'admission-hub-vocab-srs-state-v1';
  const HISTORY_KEY = 'admission-hub-vocab-srs-history-v1';
  const SIZE_KEY = 'admission-hub-vocab-srs-size-v1';
  const MODES = ['meaning', 'synonym', 'antonym'];

  const esc = v => String(v == null ? '' : v).replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));
  const now = () => Date.now();
  const route = () => String(location.hash.replace(/^#\/?/, '').split('?')[0] || window.Router?.path || 'dashboard').split('/')[0];
  const readJson = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key) || '') || fallback; } catch (_) { return fallback; } };
  const writeJson = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) {} };
  const S = () => window.AhVocabSrs;

  function relItems(list) {
    if (!Array.isArray(list)) return [];
    return list.map(x => (typeof x === 'string' ? { word: x, meaning: '' } : x)).filter(x => x && x.word);
  }

  /* Read the vocabulary words the app already stores, plus the offline A-seed so
     the dashboard is never empty on a first run. */
  async function loadWords() {
    let rows = [];
    try { rows = typeof dbGetAll === 'function' ? await dbGetAll('vocabularyMaster') : []; } catch (_) {}
    /* Mirror vocabulary-master-tool's loader: the store is dedicated to the
       bank, and the cloud copy ships rows with no `tool` marker, so requiring
       it emptied the SRS deck as well. */
    const words = (rows || [])
      .filter(r => r && (!r.tool || r.tool === 'vocabulary-master') && r.word)
      .map(r => ({ word: r.word, meaning: r.meaning || '', synonyms: relItems(r.synonyms), antonyms: relItems(r.antonyms), category: String(r.category || String(r.word)[0] || '#').toUpperCase() }));
    const have = new Set(words.map(w => S().keyOf(w.word)));
    for (const seed of (window.AH_VOCAB_A_SEED || [])) {
      if (seed && seed.word && !have.has(S().keyOf(seed.word))) {
        words.push({ word: seed.word, meaning: seed.meaning || '', synonyms: relItems(seed.synonyms), antonyms: relItems(seed.antonyms), category: 'A' });
      }
    }
    return words;
  }

  const readState = () => { const s = readJson(STATE_KEY, null); return s && s.cards ? s : { version: 1, cards: {}, updatedAt: 0 }; };
  const saveState = s => { s.updatedAt = now(); writeJson(STATE_KEY, s); };
  const getSession = () => { const s = readJson('admission-hub-vocab-srs-session-v1', null); return s && s.status === 'IN_PROGRESS' ? s : null; };
  const saveSession = s => writeJson('admission-hub-vocab-srs-session-v1', s);
  const clearSession = () => { try { localStorage.removeItem('admission-hub-vocab-srs-session-v1'); } catch (_) {} };

  let WORDS = [];
  let view = { mode: 'dashboard' };

  function shell(inner) {
    const html = `<main class="vsrs">${inner}</main>`;
    if (typeof window.renderShell === 'function') window.renderShell(html, { topbar: false, hideNav: true });
    else { const el = document.querySelector('#app'); if (el) el.innerHTML = html; }
  }

  /* ------------------------------- dashboard ------------------------------- */

  function dashboard() {
    const state = readState();
    const summary = S().summarize(WORDS, state.cards);
    const buckets = S().masteryByBucket(WORDS, state.cards);
    const plan = S().buildDailyPlan(WORDS, state.cards, { size: 20 });
    const session = getSession();
    const history = readJson(HISTORY_KEY, []);

    const bucketRow = b => `
      <div class="vsrs-bucket">
        <div class="vsrs-bucket-top"><b>${esc(b.bucket)}</b><span>${b.mastered}/${b.total} mastered</span></div>
        <div class="vsrs-bar"><i style="width:${b.mastery}%"></i></div>
        <small>${b.weak ? `${b.weak} weak · ` : ''}strength ${b.strength}%</small>
      </div>`;

    shell(`
      <header class="vsrs-head">
        <button class="vsrs-back" type="button" onclick="navigate('dashboard')">←</button>
        <div><span>SMART VOCABULARY</span><h1>Review your words at the right time.</h1></div>
      </header>

      ${session ? `<section class="vsrs-resume">
        <div><span class="vsrs-kicker">CONTINUE REVIEW</span><h2>${session.queue.length - session.index} words left</h2><p>Your unfinished review is saved.</p></div>
        <button class="btn" onclick="VocabSrsTool.resume()">RESUME</button>
      </section>` : ''}

      <section class="vsrs-hero">
        <span class="vsrs-kicker">TODAY</span>
        <h2>${summary.due} word${summary.due === 1 ? '' : 's'} due</h2>
        <p>A spaced review of what you are about to forget.</p>
        <div class="vsrs-stats">
          <span><b>${summary.due}</b>Due</span>
          <span><b>${summary.learning}</b>Learning</span>
          <span><b>${summary.mastered}</b>Mastered</span>
          <span><b>${summary.weak}</b>Weak</span>
        </div>
        <button class="btn vsrs-start" ${plan.length ? '' : 'disabled'} onclick="VocabSrsTool.start()">START REVIEW · ${plan.length}</button>
      </section>

      <section class="vsrs-card">
        <div class="vsrs-card-head"><span>MASTERY BY LETTER</span><h2>Where you are strong</h2></div>
        ${buckets.length ? buckets.map(bucketRow).join('') : '<div class="vsrs-empty">No vocabulary yet. Add words in Vocabulary Master first.</div>'}
      </section>

      <section class="vsrs-card">
        <div class="vsrs-card-head"><span>HOW IT WORKS</span><h2>Wrong words come back sooner</h2></div>
        <div class="vsrs-flow"><span>Review</span><i>→</i><span>Grade</span><i>→</i><span>Schedule</span><i>→</i><span>Recall</span></div>
      </section>

      ${history.length ? `<section class="vsrs-card">
        <div class="vsrs-card-head"><span>RECENT</span><h2>Latest reviews</h2></div>
        ${history.map(h => `<div class="vsrs-hist"><b>${new Date(h.at).toLocaleDateString()}</b><span>${h.correct}/${h.total} correct</span></div>`).join('')}
      </section>` : ''}
    `);
  }

  /* -------------------------------- session -------------------------------- */

  function currentQuestion(session) {
    const state = readState();
    const word = session.queue[session.index];
    const rec = WORDS.find(w => S().keyOf(w.word) === word);
    if (!rec) return null;
    const mode = MODES[session.index % MODES.length];
    const pool = WORDS;
    // Try the intended mode; fall back to meaning when the word lacks that relation.
    return S().buildQuestion(rec, pool, mode) || S().buildQuestion(rec, pool, 'meaning');
  }

  function renderQuestion(session) {
    const q = currentQuestion(session);
    if (!q) { finish(session); return; }
    const answered = session.picked != null;
    const correctIdx = q.options.findIndex(o => o.correct);
    const label = { meaning: 'Choose the meaning', synonym: 'Choose a synonym', antonym: 'Choose an antonym' }[q.mode] || 'Choose the answer';
    shell(`
      <header class="vsrs-run-head">
        <button class="vsrs-back" type="button" onclick="VocabSrsTool.leave()">←</button>
        <div><span>SMART VOCABULARY</span><b>${session.index + 1} / ${session.queue.length}</b></div>
      </header>
      <div class="vsrs-progress"><i style="width:${(session.index / session.queue.length) * 100}%"></i></div>
      <section class="vsrs-q">
        <span class="vsrs-kicker">${esc(label)}</span>
        <p class="vsrs-word">${esc(q.prompt)}</p>
        <div class="vsrs-options">
          ${q.options.map((o, i) => `<button type="button" class="vsrs-option ${answered && i === correctIdx ? 'correct' : ''} ${answered && i === session.picked && i !== correctIdx ? 'wrong' : ''}" ${answered ? 'disabled' : ''} onclick="VocabSrsTool.answer(${i})"><i>${i + 1}</i><span>${esc(o.text)}</span></button>`).join('')}
        </div>
        ${answered ? `<div class="vsrs-feedback"><b>${session.picked === correctIdx ? 'Correct, well done.' : 'Not quite.'}</b><small>${esc(WORDS.find(w => S().keyOf(w.word) === q.word)?.meaning || '')}</small></div>
        <button class="btn vsrs-next" onclick="VocabSrsTool.next()">${session.index === session.queue.length - 1 ? 'SEE RESULT' : 'NEXT →'}</button>` : ''}
      </section>
    `);
  }

  function finish(session) {
    const total = session.queue.length;
    const acc = total ? Math.round((session.correct / total) * 100) : 0;
    const history = readJson(HISTORY_KEY, []);
    history.unshift({ at: now(), total, correct: session.correct });
    writeJson(HISTORY_KEY, history.slice(0, 8));
    clearSession();
    shell(`
      <header class="vsrs-head"><button class="vsrs-back" onclick="navigate('dashboard')">←</button><div><span>SMART VOCABULARY</span><h1>Review complete</h1></div></header>
      <section class="vsrs-result">
        <div class="vsrs-result-big">${session.correct} / ${total}</div>
        <p>${acc}% correct</p>
        <button class="btn vsrs-start" onclick="VocabSrsTool.start()">REVIEW MORE</button>
        <button class="btn vsrs-ghost" onclick="navigate('dashboard')">Back to dashboard</button>
      </section>
    `);
  }

  function render() {
    if (view.mode === 'session') { const s = getSession(); if (s) { renderQuestion(s); return; } }
    const s = getSession();
    if (s) view.mode = 'dashboard';
    dashboard();
  }

  const api = {
    render,
    async start() {
      WORDS = WORDS.length ? WORDS : await loadWords();
      const state = readState();
      const size = Math.max(5, Number(localStorage.getItem(SIZE_KEY)) || 20);
      const plan = S().buildDailyPlan(WORDS, state.cards, { size });
      if (!plan.length) return dashboard();
      const session = { status: 'IN_PROGRESS', queue: plan.map(c => c.key), index: 0, picked: null, correct: 0, startedAt: now() };
      saveSession(session); view.mode = 'session'; renderQuestion(session);
    },
    resume() { const s = getSession(); if (s) { s.picked = null; view.mode = 'session'; saveSession(s); renderQuestion(s); } else dashboard(); },
    answer(i) {
      const s = getSession(); if (!s || s.picked != null) return;
      const q = currentQuestion(s); if (!q) return;
      const good = S().checkAnswer(q, i);
      s.picked = Number(i);
      if (good) s.correct += 1;
      const state = readState();
      const grade = S().gradeFor(good);
      state.cards[q.word] = S().schedule(state.cards[q.word] || S().freshCard(q.word), grade);
      saveState(state);
      saveSession(s);
      renderQuestion(s);
    },
    next() {
      const s = getSession(); if (!s) return;
      if (s.index >= s.queue.length - 1) return finish(s);
      s.index += 1; s.picked = null; saveSession(s); renderQuestion(s);
    },
    leave() { const s = getSession(); if (s) { s.picked = null; saveSession(s); } view.mode = 'dashboard'; dashboard(); },
    // test seam: build a session synchronously from already-loaded words
    _session(plan) { const s = { status: 'IN_PROGRESS', queue: plan.map(c => c.key), index: 0, picked: null, correct: 0, startedAt: now() }; saveSession(s); view.mode = 'session'; return s; },
  };

  window.VocabSrsEngine = { buildDailyPlan: (size) => S().buildDailyPlan(WORDS, readState().cards, { size }), summarize: () => S().summarize(WORDS, readState().cards), masteryByBucket: () => S().masteryByBucket(WORDS, readState().cards) };
  window.VocabSrsTool = api;

  function refresh() { return loadWords().then(list => { WORDS = list; render(); }); }

  function injectDashboardEntry() {
    const page = document.querySelector('#app .page');
    if (!page || page.querySelector('[data-vocab-srs-entry]')) return;
    const tools = page.querySelector('[data-unified-study-tools-list]');
    if (!tools) return;
    const entry = document.createElement('button');
    entry.type = 'button'; entry.className = 'vm-dashboard-entry'; entry.dataset.vocabSrsEntry = 'true';
    entry.innerHTML = '<i aria-hidden="true">🧠</i><span><b>Smart Vocabulary</b><small>Spaced review · weak words · mastery</small></span><em aria-hidden="true">›</em>';
    entry.onclick = () => navigate(ROUTE);
    tools.appendChild(entry);
  }
  const previousDashboard = window.renderDashboard;
  if (typeof previousDashboard === 'function') {
    window.renderDashboard = function vocabSrsDashboard() {
      const result = previousDashboard.apply(this, arguments);
      injectDashboardEntry();
      return result;
    };
  }

  const oldRender = window.render;
  if (typeof oldRender === 'function') window.render = function vocabSrsRender() { if (route() === ROUTE) { view = { mode: 'dashboard' }; refresh(); return; } return oldRender.apply(this, arguments); };
  const oldRoute = window.__admissionRenderRoute;
  if (typeof oldRoute === 'function') window.__admissionRenderRoute = function vocabSrsRoute() { if (route() === ROUTE) { refresh(); return; } return oldRoute.apply(this, arguments); };
  window.addEventListener('hashchange', () => { if (route() === ROUTE) refresh(); else if (route() === 'dashboard' || route() === 'home') setTimeout(injectDashboardEntry, 60); });
  window.addEventListener('load', () => { window.setTimeout(() => { if (route() === ROUTE) refresh(); else if (route() === 'dashboard' || route() === 'home') injectDashboardEntry(); }, 420); }, { once: true });
  setTimeout(() => { if (route() === ROUTE) refresh(); }, 0);

  if (!document.querySelector('#vocab-srs-styles')) {
    const style = document.createElement('style');
    style.id = 'vocab-srs-styles';
    style.textContent = `
.vsrs{max-width:680px;margin:0 auto;padding:16px 0 40px;color:#173128}
.vsrs-head,.vsrs-run-head{display:flex;align-items:center;gap:11px;margin-bottom:14px}
.vsrs-head>div,.vsrs-run-head>div{min-width:0;flex:1}
.vsrs-head span,.vsrs-run-head span,.vsrs-kicker,.vsrs-card-head span{display:block;color:#147457;font-size:10px;font-weight:900;letter-spacing:.15em}
.vsrs-head h1{margin:4px 0 0;font-size:23px;line-height:1.24}
.vsrs-back{width:40px;height:40px;border:1px solid var(--line);border-radius:12px;background:var(--card);color:var(--emerald-d);font-size:22px;cursor:pointer}
.vsrs-hero,.vsrs-card,.vsrs-resume,.vsrs-q,.vsrs-result{margin-top:12px;padding:18px;border:1px solid #d2e8dd;border-radius:20px;background:var(--card);box-shadow:0 8px 24px rgba(15,92,67,.06)}
.vsrs-hero{background:linear-gradient(140deg,#f7fcfa,#e7f5ee)}
.vsrs-hero>h2{margin:7px 0 3px;font-size:29px}
.vsrs-hero>p{margin:0;color:var(--sub);font-size:12px;line-height:1.5}
.vsrs-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:7px;margin:15px 0}
.vsrs-stats span{padding:10px 4px;border:1px solid #d9ebe3;border-radius:11px;background:rgba(255,255,255,.7);text-align:center;color:var(--sub);font-size:10px}
.vsrs-stats b{display:block;margin-bottom:3px;color:#147457;font-size:19px}
.vsrs-start{width:100%;min-height:48px}
.vsrs-ghost{width:100%;min-height:44px;margin-top:9px}
.vsrs-resume{display:flex;align-items:center;justify-content:space-between;gap:10px;background:#eef8f2}
.vsrs-resume h2{margin:5px 0 2px;font-size:17px}
.vsrs-card-head h2{margin:5px 0 0;font-size:18px}
.vsrs-bucket{margin-top:12px}
.vsrs-bucket-top{display:flex;justify-content:space-between;font-size:12px;color:#52766a}
.vsrs-bucket-top b{color:#173128;font-size:14px}
.vsrs-bar{height:8px;margin:6px 0 4px;border-radius:99px;background:#dceee5;overflow:hidden}
.vsrs-bar i{display:block;height:100%;border-radius:inherit;background:#147457}
.vsrs-bucket small{color:var(--sub);font-size:10px}
.vsrs-flow{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-top:14px;color:#52766a;font-size:12px}
.vsrs-flow i{color:#147457;font-style:normal}
.vsrs-hist{display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--line);font-size:12px}
.vsrs-hist span{color:#147457;font-weight:800}
.vsrs-progress{height:7px;margin:0 0 14px;border-radius:99px;background:#dceee5;overflow:hidden}
.vsrs-progress i{display:block;height:100%;border-radius:inherit;background:#147457;transition:width .3s ease}
.vsrs-run-head b{display:block;margin-top:4px;font-size:14px}
.vsrs-word{margin:8px 0 16px;font:800 30px/1.2 Georgia,'Noto Serif Bengali',serif}
.vsrs-options{display:grid;gap:8px}
.vsrs-option{display:flex;align-items:flex-start;gap:9px;width:100%;padding:12px;border:1px solid var(--line);border-radius:11px;background:#fff;color:var(--text);font:inherit;text-align:left;cursor:pointer}
.vsrs-option i{display:grid;place-items:center;flex:0 0 25px;width:25px;height:25px;border-radius:7px;background:#eaf7ef;color:#147457;font-style:normal;font-size:11px;font-weight:800}
.vsrs-option.correct{border-color:#87caa1;background:#eefaf2}
.vsrs-option.correct i{background:#147457;color:#fff}
.vsrs-option.wrong{border-color:#dfa09b;background:#fff2f0}
.vsrs-option.wrong i{background:#b9574d;color:#fff}
.vsrs-feedback{display:grid;gap:5px;margin-top:13px;padding:11px;border-radius:10px;background:#eef8f2;color:#147457;font-size:13px}
.vsrs-feedback small{color:#5a786d;font-size:12px}
.vsrs-next{width:100%;margin-top:12px}
.vsrs-result{text-align:center;background:linear-gradient(140deg,#f7fcfa,#e8f7ef)}
.vsrs-result-big{margin-top:7px;color:#147457;font-size:42px;font-weight:900}
.vsrs-result>p{margin:2px 0 18px;color:#53766a;font-size:14px}
.vsrs-empty{padding:26px 14px;text-align:center;border:1px dashed var(--line);border-radius:12px;color:var(--sub);font-size:12px}
@media(max-width:480px){.vsrs-stats{grid-template-columns:repeat(2,1fr)}.vsrs-word{font-size:25px}}
@media(prefers-reduced-motion:reduce){.vsrs-progress i{transition:none}}`;
    document.head.appendChild(style);
  }
})();
