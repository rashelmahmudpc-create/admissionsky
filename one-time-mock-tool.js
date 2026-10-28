/* Native One-Time Mock Tool: Admission Hub internal route, isolated in-memory question/test state only. */
(() => {
  'use strict';

  const ROUTE = 'one-time-mock';
  const PAGE_SIZE = 50;
  const state = { view: 'mock', bank: [], pool: [], answers: {}, bookmarks: new Set(), flags: new Set(), negative: 0.25, duration: 60, elapsed: 0, active: false, page: 0, draft: '', rows: [], filter: 'all', confirm: false, timer: null };
  const q = (selector, root = document) => root.querySelector(selector);
  const qa = (selector, root = document) => [...root.querySelectorAll(selector)];
  const esc = (value) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
  const bn = (value, digits = 0) => new Intl.NumberFormat('bn-BD', { maximumFractionDigits: digits }).format(Number(value) || 0);
  const time = (seconds) => `${bn(Math.floor(Math.max(0, seconds) / 60)).padStart(2, '০')}:${bn(Math.max(0, seconds) % 60).padStart(2, '০')}`;
  const route = () => String(location.hash.replace(/^#\/?/, '').split('?')[0] || (window.Router && Router.path) || 'dashboard');
  const cloneQuestions = (rows) => rows.map((row, index) => ({ id: index + 1, question: String(row.question || '').trim(), options: Array.isArray(row.options) ? row.options.map(String).slice(0, 4) : ['', '', '', ''], answer: Number(row.answer), explanation: String(row.explanation || '').trim() }));
  const clearClock = () => { if (state.timer) { clearInterval(state.timer); state.timer = null; } };
  const pageRows = () => state.pool.slice(state.page * PAGE_SIZE, (state.page + 1) * PAGE_SIZE);
  const totalPages = () => Math.max(1, Math.ceil(state.pool.length / PAGE_SIZE));
  const answered = () => Object.keys(state.answers).length;
  const remaining = () => Math.max(0, state.duration * 60 - state.elapsed);

  function setSeed() {
    /* The seed pack is deferred off the boot path. It is warmed at idle, so it
       is normally present; if not, load it and seed again. */
    if (!Array.isArray(window.OneTimeMockSeed) && typeof window.admissionLoadPack === 'function') {
      window.admissionLoadPack('one-time-mock-seed')
        .then(() => { try { setSeed(); } catch (_) {} })
        .catch(() => {});
    }
    const seed = Array.isArray(window.OneTimeMockSeed) ? window.OneTimeMockSeed : [];
    state.bank = cloneQuestions(seed);
    state.pool = cloneQuestions(seed);
  }

  function optionShuffle(question) {
    const order = [0, 1, 2, 3].sort(() => Math.random() - 0.5);
    return { ...question, options: order.map((index) => question.options[index]), answer: order.indexOf(question.answer) };
  }

  function answerIndex(value, options) {
    if (Number.isInteger(value) && value >= 0 && value < 4) return value;
    const raw = String(value ?? '').trim();
    const letter = raw.match(/[A-Da-d]/)?.[0];
    if (letter) return letter.toUpperCase().charCodeAt(0) - 65;
    return options.findIndex((option) => option === raw);
  }

  function parseQuestions(raw) {
    const trimmed = String(raw || '').trim();
    if (!trimmed) return [];
    try {
      const json = JSON.parse(trimmed);
      const rows = Array.isArray(json) ? json : Array.isArray(json.questions) ? json.questions : [];
      return rows.map((item, index) => {
        const options = Array.isArray(item.options) ? item.options.slice(0, 4).map(String) : ['', '', '', ''];
        const answer = answerIndex(item.answer ?? item.correctAnswer, options);
        const valid = Boolean(String(item.question ?? item.q ?? '').trim()) && options.length === 4 && options.every(Boolean) && answer >= 0 && answer < 4;
        return { id: index + 1, question: String(item.question ?? item.q ?? '').trim(), options, answer: valid ? answer : 0, explanation: String(item.explanation ?? item.explain ?? '').trim(), valid, issue: valid ? '' : 'প্রশ্ন, ৪টি option এবং answer লাগবে' };
      });
    } catch (_) {
      const blocks = trimmed.split(/(?=^\s*(?:Q(?:uestion)?\.?\s*\d+|\d+)[\s.:)])/gim).filter(Boolean);
      return blocks.map((block, index) => {
        const lines = block.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
        const options = ['', '', '', ''];
        const questionLines = [];
        const answerLine = lines.find((line) => /^(?:answer|ans|correct\s*answer|উত্তর)\s*[:=]/i.test(line));
        const explanationLine = lines.find((line) => /^(?:explanation|ব্যাখ্যা)\s*[:=]/i.test(line));
        lines.forEach((line) => {
          const option = line.match(/^([A-Da-d])\s*[.)\-:]\s*(.+)$/);
          if (option) { options[option[1].toUpperCase().charCodeAt(0) - 65] = option[2].trim(); return; }
          if (/^(?:Q(?:uestion)?\.?\s*\d+|\d+)[\s.:)]/i.test(line)) { questionLines.push(line.replace(/^(?:Q(?:uestion)?\.?\s*\d+|\d+)[\s.:)]+/i, '').trim()); return; }
          if (!/^(?:answer|ans|correct\s*answer|উত্তর|explanation|ব্যাখ্যা)\s*[:=]/i.test(line) && !explanationLine) questionLines.push(line);
        });
        const answer = answerIndex(answerLine?.replace(/^[^:=]+[:=]\s*/, ''), options);
        const valid = Boolean(questionLines.join(' ')) && options.every(Boolean) && answer >= 0 && answer < 4;
        return { id: index + 1, question: questionLines.join(' '), options, answer: valid ? answer : 0, explanation: explanationLine?.replace(/^[^:=]+[:=]\s*/, '') || '', valid, issue: valid ? '' : 'প্রশ্ন, ৪টি option এবং answer লাগবে' };
      });
    }
  }

  function score() {
    const correct = state.pool.filter((question) => state.answers[question.id] === question.answer).length;
    const wrong = state.pool.filter((question) => state.answers[question.id] !== undefined && state.answers[question.id] !== question.answer).length;
    const skipped = state.pool.length - correct - wrong;
    return { correct, wrong, skipped, accuracy: correct + wrong ? Math.round((correct / (correct + wrong)) * 100) : 0, value: correct - wrong * state.negative };
  }

  function installStyles() {
    if (document.getElementById('one-time-mock-native-styles')) return;
    const style = document.createElement('style');
    style.id = 'one-time-mock-native-styles';
    style.textContent = `
      /* Native One-Time Mock Tool visual reminder: Admission Hub mint/emerald, question-first 50-card mock flow. */
      .otm-tool{max-width:760px;margin:0 auto;color:#173128;padding:2px 0 28px}.otm-header{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 2px 18px;border-bottom:1px solid #d9e8e1}.otm-brand{display:flex;align-items:center;gap:8px;border:0;background:transparent;color:#135b47;font-weight:850;cursor:pointer}.otm-brand i{width:20px;height:20px;display:inline-grid;place-items:center;border:2px solid #0f7557;border-radius:50%;font-style:normal;font-size:11px}.otm-back,.otm-btn{border:1px solid #cddfd7;background:#fff;color:#174b3d;border-radius:12px;padding:9px 12px;font-weight:750;cursor:pointer}.otm-btn.primary{border-color:#0e7255;background:#0f6b4f;color:#fff}.otm-btn:disabled{opacity:.45;cursor:not-allowed}.otm-page{padding:18px 0 88px}.otm-kicker{display:block;color:#168062;font-size:10px;font-weight:900;letter-spacing:.12em}.otm-title{font-size:26px;line-height:1.16;margin:5px 0 5px;letter-spacing:-.04em}.otm-sub{color:#6d8279;font-size:13px;margin:0;line-height:1.5}.otm-card{margin-top:16px;padding:16px;border:1px solid #d9e8e1;border-radius:18px;background:#fff;box-shadow:0 8px 18px rgba(15,107,79,.05)}.otm-mode{display:flex;align-items:center;gap:11px;border:1px solid #bcd9cf;background:#f1faf6;border-radius:13px;padding:11px;margin-bottom:16px}.otm-mode strong{display:block;font-size:14px}.otm-mode small{display:block;color:#71867d;font-size:11px;margin-top:2px}.otm-label{display:block;font-size:11px;color:#587268;font-weight:850;margin:14px 0 7px}.otm-chip-row{display:flex;flex-wrap:wrap;gap:7px}.otm-chip-row button{border:1px solid #d4e1dc;background:#fff;color:#5a7268;border-radius:999px;padding:7px 10px;font-size:12px;font-weight:750;cursor:pointer}.otm-chip-row button.active{background:#0f6b4f;color:#fff;border-color:#0f6b4f}.otm-setup-note{display:flex;justify-content:space-between;gap:10px;margin:17px 0 12px;padding-top:12px;border-top:1px solid #e3ede8;color:#6d8279;font-size:11px}.otm-full{display:block;width:100%;padding:12px}.otm-bottom{position:fixed;bottom:0;left:0;right:0;z-index:20;display:flex;justify-content:center;padding:8px max(12px,env(safe-area-inset-right)) calc(8px + env(safe-area-inset-bottom)) max(12px,env(safe-area-inset-left));background:rgba(250,253,251,.94);backdrop-filter:blur(14px);border-top:1px solid #dce9e3}.otm-bottom-inner{width:min(100%,600px);display:grid;grid-template-columns:repeat(3,1fr);gap:4px}.otm-bottom button{border:0;background:transparent;color:#759087;padding:7px 4px;font-size:11px;font-weight:750;cursor:pointer}.otm-bottom button.active{color:#0f6b4f}.otm-top-run{position:sticky;top:0;z-index:11;display:flex;gap:8px;align-items:center;justify-content:flex-end;padding:10px;background:rgba(250,253,251,.95);backdrop-filter:blur(10px);border-bottom:1px solid #d7e6df}.otm-timer{margin-right:auto;display:flex;align-items:center;gap:5px;color:#315e50;font-weight:800;font-variant-numeric:tabular-nums}.otm-run-meta{padding:14px 0 9px}.otm-run-meta b{font-size:13px}.otm-run-meta small{display:block;margin-top:3px;color:#6f867c;font-size:11px}.otm-progress{height:5px;border-radius:99px;background:#e4efe9;margin-top:8px;overflow:hidden}.otm-progress i{display:block;height:100%;background:#118064;border-radius:inherit}.otm-rail{display:flex;gap:7px;overflow:auto;padding:10px 0 12px;scrollbar-width:none}.otm-rail button{flex:0 0 38px;height:38px;border:1px solid #d5e3dd;background:#fff;color:#5f746b;border-radius:10px;font-weight:750;cursor:pointer}.otm-rail button.answered{background:#e1f3e9;color:#0e7054;border-color:#93cbb7}.otm-question{scroll-margin-top:70px;margin:0 0 13px;padding:16px;border:1px solid #d9e8e1;border-radius:17px;background:#fff;box-shadow:0 7px 17px rgba(15,107,79,.04)}.otm-qhead{display:flex;justify-content:space-between;align-items:center;gap:10px}.otm-qnum{display:inline-flex;align-items:center;padding:5px 8px;border-radius:7px;background:#edf8f2;color:#12674f;font-size:11px;font-weight:850}.otm-icon-row{display:flex;gap:4px}.otm-icon-row button{width:29px;height:29px;border:0;background:transparent;color:#90a49a;font-size:20px;cursor:pointer}.otm-icon-row button.on{color:#d9941d}.otm-question h2{font-size:17px;line-height:1.55;margin:12px 0;color:#19352a}.otm-options{display:grid;gap:8px}.otm-option{display:flex;gap:10px;align-items:flex-start;text-align:left;padding:11px;border:1px solid #dce9e4;border-radius:11px;background:#fff;color:#2b473c;cursor:pointer;font:inherit}.otm-option span{display:grid;place-items:center;flex:0 0 22px;width:22px;height:22px;border-radius:6px;background:#f0f5f2;color:#547367;font-size:11px;font-weight:900}.otm-option b{font-size:14px;font-weight:650;line-height:1.45}.otm-option.selected{background:#e6f5ed;border-color:#76bfa4}.otm-option.selected span{background:#0f6b4f;color:#fff}.otm-clear{margin-top:10px;border:0;background:transparent;color:#687e74;font-size:11px;text-decoration:underline;cursor:pointer}.otm-page-foot{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:18px 0 84px;color:#61796f;font-size:12px}.otm-textarea{display:block;width:100%;min-height:190px;box-sizing:border-box;border:1px solid #d7e5df;border-radius:12px;padding:12px;font:inherit;font-size:13px;line-height:1.55;resize:vertical;background:#fcfffd;color:#203b31}.otm-upload{display:flex;align-items:center;justify-content:center;width:100%;border:1px dashed #99c8b6;background:#f4fbf7;color:#17674f;border-radius:11px;padding:11px;cursor:pointer;font-weight:750}.otm-row-actions{display:flex;justify-content:flex-end;margin-top:12px}.otm-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:9px;margin-top:14px}.otm-stats div,.otm-result-stats div{padding:13px 8px;border:1px solid #e0ece7;border-radius:12px;background:#fff;text-align:center}.otm-stats b,.otm-result-stats b{display:block;color:#0f6b4f;font-size:20px}.otm-stats span,.otm-result-stats span{display:block;margin-top:3px;color:#71887e;font-size:10px}.otm-parser-row{display:flex;justify-content:space-between;gap:10px;padding:11px 0;border-bottom:1px solid #e4eee9}.otm-parser-row:last-of-type{border-bottom:0}.otm-parser-row b{display:block;font-size:13px}.otm-parser-row small{display:block;color:#71877d;margin-top:4px;font-size:11px;line-height:1.4}.otm-parser-row span{color:#148061;font-size:11px;font-weight:850}.otm-modal-back{position:fixed;inset:0;z-index:80;display:grid;place-items:center;padding:18px;background:rgba(13,42,32,.38);backdrop-filter:blur(4px)}.otm-modal{width:min(100%,390px);border-radius:18px;background:#fff;padding:20px;box-shadow:0 20px 50px rgba(0,0,0,.22)}.otm-modal h2{margin:6px 0;font-size:22px}.otm-modal p{margin:0;color:#61786e;font-size:13px;line-height:1.55}.otm-modal div{display:flex;justify-content:flex-end;gap:8px;margin-top:17px}.otm-result-hero{display:grid;grid-template-columns:auto 1fr;gap:16px;padding:20px;border-radius:19px;background:linear-gradient(135deg,#0e6a50,#167d61);color:#fff}.otm-ring{display:grid;place-content:center;width:76px;height:76px;border:4px solid #d9ac52;border-radius:50%;text-align:center}.otm-ring b{font-size:18px}.otm-ring small{font-size:9px;color:#dbeee5}.otm-result-hero h1{margin:5px 0;font-size:23px}.otm-result-hero p{margin:0;color:#d7ede3;font-size:12px;line-height:1.45}.otm-score{margin-top:10px}.otm-score b{font-size:22px}.otm-score small{font-size:12px;font-weight:600}.otm-score span{display:block;font-size:10px;color:#d8eee4}.otm-result-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:11px 0}.otm-result-stats b{font-size:17px}.otm-insight{margin:14px 0}.otm-insight p{color:#647c72;font-size:12px;line-height:1.55}.otm-filter{display:flex;gap:7px;overflow:auto;margin:12px 0}.otm-filter button{flex:0 0 auto;border:1px solid #d8e6e0;background:#fff;color:#668076;border-radius:999px;padding:7px 11px;font-size:12px;cursor:pointer}.otm-filter button.active{background:#0f6b4f;color:#fff;border-color:#0f6b4f}.otm-review{margin:12px 0;padding:15px;border:1px solid #dce9e4;border-radius:15px;background:#fff}.otm-review header{display:flex;justify-content:space-between;gap:10px;color:#668075;font-size:11px}.otm-review h3{font-size:16px;line-height:1.5;margin:10px 0}.otm-review-option{display:flex;gap:9px;padding:8px 9px;margin-top:5px;border-radius:8px;font-size:13px}.otm-review-option span{font-weight:850}.otm-review-option.correct{background:#e4f5ea;color:#12674e}.otm-review-option.wrong{background:#ffe9e8;color:#b74440}.otm-explain{margin:10px 0 0;padding-top:10px;border-top:1px dashed #d3e2db;color:#587268;font-size:12px;line-height:1.55}.otm-actions{display:flex;gap:8px;flex-wrap:wrap}@media(max-width:540px){.otm-tool{padding:0}.otm-title{font-size:23px}.otm-question h2{font-size:16px}.otm-result-stats{grid-template-columns:repeat(2,1fr)}.otm-result-hero{padding:17px}.otm-page{padding-bottom:86px}.otm-setup-note{align-items:flex-start;flex-direction:column}}
    `;
    document.head.appendChild(style);
  }

  function renderShell(html) {
    installStyles();
    if (typeof window.renderShell === 'function') window.renderShell(`<div class="otm-tool">${html}</div>`, { topbar: false, hideNav: true });
    else (document.getElementById('app') || document.body).innerHTML = `<div class="otm-tool">${html}</div>`;
  }

  function renderHeader(running = false) {
    return `<header class="otm-header"><button class="otm-brand" type="button" onclick="navigate('dashboard')"><i>✓</i>Admission Hub</button>${running ? `<div class="otm-timer" id="otmClock">◷ ${state.duration ? time(remaining()) : '∞'}</div><button class="otm-btn" type="button" onclick="window.OneTimeMockTool.askFinish()">পরীক্ষা শেষ করুন</button>` : `<button class="otm-back" type="button" onclick="navigate('dashboard')">← Dashboard</button>`}</header>`;
  }

  function renderNav() {
    return `<nav class="otm-bottom" aria-label="One-Time Mock Tool navigation"><div class="otm-bottom-inner"><button class="${state.view === 'parser' ? 'active' : ''}" type="button" onclick="window.OneTimeMockTool.open('parser')">▣<br>Parser</button><button class="${state.view === 'mock' ? 'active' : ''}" type="button" onclick="window.OneTimeMockTool.open('mock')">▰<br>Mock</button><button class="${state.view === 'result' ? 'active' : ''}" type="button" onclick="window.OneTimeMockTool.open('result')">▤<br>Result</button></div></nav>`;
  }

  function renderSetup() {
    return `<main class="otm-page"><span class="otm-kicker">EXAM CENTER · ISOLATED TOOL</span><h1 class="otm-title">One-Time Mock Test</h1><p class="otm-sub">Admission Hub-এর ভেতরের আলাদা mock space · main data-তে save হবে না।</p><section class="otm-card"><div class="otm-mode"><span>📝</span><div><strong>Mock Test</strong><small>Real exam simulation · no feedback during exam</small></div></div><label class="otm-label">Questions</label><div class="otm-chip-row"><button class="active" type="button">${bn(state.pool.length)} Questions</button></div><label class="otm-label">Time</label><div class="otm-chip-row">${[30, 60, 90, 120].map((value) => `<button type="button" class="${state.duration === value ? 'active' : ''}" onclick="window.OneTimeMockTool.setDuration(${value})">${value % 60 === 0 ? `${bn(value / 60)} hr` : `${bn(value)} min`}</button>`).join('')}</div><label class="otm-label">Negative Marking</label><div class="otm-chip-row">${[0, .25, .5].map((value) => `<button type="button" class="${state.negative === value ? 'active' : ''}" onclick="window.OneTimeMockTool.setNegative(${value})">${value ? `−${bn(value, 2)}` : 'None'}</button>`).join('')}</div><div class="otm-setup-note"><span>Option order shuffled</span><span>+1 correct · −${bn(state.negative, 2)} wrong</span></div><button class="otm-btn primary otm-full" type="button" onclick="window.OneTimeMockTool.start()">▷ Start Mock Test</button></section></main>${renderNav()}`;
  }

  function renderParser() {
    const valid = state.rows.filter((row) => row.valid).length;
    const preview = state.rows.length ? `<section class="otm-stats"><div><b>${bn(state.rows.length)}</b><span>Total</span></div><div><b>${bn(valid)}</b><span>Valid</span></div><div><b>${bn(state.rows.length - valid)}</b><span>Invalid</span></div></section><section class="otm-card"><b>Import Preview</b>${state.rows.slice(0, 8).map((row) => `<article class="otm-parser-row"><div><b>Q${bn(row.id)}. ${esc(row.question || 'প্রশ্ন নেই')}</b><small>A. ${esc(row.options[0] || '-')} · B. ${esc(row.options[1] || '-')} · C. ${esc(row.options[2] || '-')} · D. ${esc(row.options[3] || '-')}</small></div><span>${row.valid ? 'Valid' : esc(row.issue)}</span></article>`).join('')}${state.rows.length > 8 ? `<p class="otm-sub" style="margin-top:10px">আরও ${bn(state.rows.length - 8)}টি প্রশ্ন import হবে।</p>` : ''}<button class="otm-btn primary otm-full" style="margin-top:12px" ${valid ? '' : 'disabled'} type="button" onclick="window.OneTimeMockTool.importRows()">Import ${bn(valid)} Questions & Start Mock</button></section>` : '';
    return `<main class="otm-page"><span class="otm-kicker">SAFE QUESTION IMPORT · ISOLATED TOOL</span><h1 class="otm-title">Question Parser</h1><p class="otm-sub">TXT বা JSON প্রশ্ন paste/upload করুন। Import শুধু এই tool-এর runtime session-এ থাকবে।</p><section class="otm-card"><label class="otm-label">Question file</label><label class="otm-upload">↥ TXT বা JSON Upload<input id="otmFile" type="file" accept=".txt,.json,text/plain,application/json" hidden></label><label class="otm-label">Paste content</label><textarea id="otmDraft" class="otm-textarea" placeholder="Q1. Question&#10;A. First option&#10;B. Second option&#10;C. Third option&#10;D. Fourth option&#10;Answer: B&#10;Explanation: Why B">${esc(state.draft)}</textarea><div class="otm-row-actions"><button class="otm-btn primary" type="button" onclick="window.OneTimeMockTool.preview()">➤ Detect & Preview</button></div></section>${preview}</main>${renderNav()}`;
  }

  function renderExam() {
    const rows = pageRows();
    const first = state.page * PAGE_SIZE + 1;
    const last = Math.min(state.page * PAGE_SIZE + PAGE_SIZE, state.pool.length);
    return `${renderHeader(true)}<main class="otm-page"><div class="otm-run-meta"><b>MOCK TEST</b><small><strong id="otmAnswered">${bn(answered())}</strong> answered · ${bn(first)}–${bn(last)} / ${bn(state.pool.length)}</small><div class="otm-progress"><i id="otmProgress" style="width:${state.pool.length ? answered() / state.pool.length * 100 : 0}%"></i></div></div><div class="otm-rail">${rows.map((question, index) => `<button id="otmRail${question.id}" class="${state.answers[question.id] !== undefined ? 'answered' : ''}" type="button" onclick="window.OneTimeMockTool.jump(${question.id})">${bn(first + index)}</button>`).join('')}</div><section>${rows.map((question, index) => questionCard(question, first + index)).join('')}</section><footer class="otm-page-foot"><button class="otm-btn" type="button" ${state.page === 0 ? 'disabled' : ''} onclick="window.OneTimeMockTool.setPage(-1)">← আগের ৫০</button><span>পৃষ্ঠা ${bn(state.page + 1)} / ${bn(totalPages())}</span><button class="otm-btn primary" type="button" ${state.page === totalPages() - 1 ? 'disabled' : ''} onclick="window.OneTimeMockTool.setPage(1)">পরের ৫০ →</button></footer></main>${state.confirm ? confirmModal() : ''}`;
  }

  function questionCard(question, number) {
    const selected = state.answers[question.id];
    return `<article class="otm-question" id="otmQuestion${question.id}"><header class="otm-qhead"><span class="otm-qnum">Q${bn(number)}</span><div class="otm-icon-row"><button id="otmBook${question.id}" class="${state.bookmarks.has(question.id) ? 'on' : ''}" type="button" onclick="window.OneTimeMockTool.toggleBookmark(${question.id})">${state.bookmarks.has(question.id) ? '★' : '☆'}</button><button id="otmFlag${question.id}" class="${state.flags.has(question.id) ? 'on' : ''}" type="button" onclick="window.OneTimeMockTool.toggleFlag(${question.id})">⚑</button></div></header><h2>${esc(question.question)}</h2><div class="otm-options">${question.options.map((option, index) => `<button id="otmOption${question.id}_${index}" type="button" class="otm-option ${selected === index ? 'selected' : ''}" onclick="window.OneTimeMockTool.select(${question.id},${index})"><span>${String.fromCharCode(65 + index)}</span><b>${esc(option)}</b></button>`).join('')}</div><button id="otmClear${question.id}" class="otm-clear" type="button" style="${selected === undefined ? 'display:none' : ''}" onclick="window.OneTimeMockTool.clear(${question.id})">Clear Selection</button></article>`;
  }

  function confirmModal() {
    return `<div class="otm-modal-back"><section class="otm-modal"><span class="otm-kicker">MOCK TEST</span><h2>পরীক্ষা শেষ করবেন?</h2><p>আপনি ${bn(answered())}টি প্রশ্নের উত্তর দিয়েছেন। বাকি ${bn(state.pool.length - answered())}টি প্রশ্ন উত্তরহীন হিসেবে থাকবে।</p><div><button class="otm-btn" type="button" onclick="window.OneTimeMockTool.cancelFinish()">ফিরে যান</button><button class="otm-btn primary" type="button" onclick="window.OneTimeMockTool.finish()">ফলাফল দেখুন</button></div></section></div>`;
  }

  function renderResult() {
    const result = score();
    const filtered = state.pool.filter((question) => state.filter === 'all' || state.filter === 'correct' && state.answers[question.id] === question.answer || state.filter === 'wrong' && state.answers[question.id] !== undefined && state.answers[question.id] !== question.answer || state.filter === 'skipped' && state.answers[question.id] === undefined);
    const review = filtered.map((question) => { const selected = state.answers[question.id]; const status = selected === undefined ? 'skipped' : selected === question.answer ? 'correct' : 'wrong'; return `<article class="otm-review"><header><span>প্রশ্ন ${bn(question.id)}</span><b>${status === 'correct' ? '🟢 সঠিক উত্তর' : status === 'wrong' ? '🔴 ভুল উত্তর' : '🟡 উত্তর দেওয়া হয়নি'}</b></header><h3>${esc(question.question)}</h3>${question.options.map((option, index) => `<div class="otm-review-option ${index === question.answer ? 'correct' : ''} ${status === 'wrong' && index === selected ? 'wrong' : ''}"><span>${String.fromCharCode(65 + index)}</span>${esc(option)}</div>`).join('')}${question.explanation ? `<p class="otm-explain"><b>💡 ব্যাখ্যা</b><br>${esc(question.explanation)}</p>` : ''}</article>`; }).join('');
    return `${renderHeader(false)}<main class="otm-page"><section class="otm-result-hero"><div class="otm-ring"><b>${bn(result.accuracy)}%</b><small>নির্ভুলতা</small></div><div><span class="otm-kicker" style="color:#d2eadf">MOCK TEST · সদ্য সম্পন্ন</span><h1>${result.accuracy >= 75 ? 'দারুণ করেছো!' : result.accuracy >= 50 ? 'ভালো চেষ্টা!' : 'চেষ্টা চালিয়ে যাও!'}</h1><p>ভুল প্রশ্নগুলো review করে আবার অনুশীলন করলে score দ্রুত উন্নত হবে।</p><div class="otm-score"><b>${bn(result.value, 2)}<small> / ${bn(state.pool.length)}</small></b><span>তোমার স্কোর</span></div></div></section><section class="otm-result-stats"><div><b>${bn(result.correct)}</b><span>সঠিক</span></div><div><b>${bn(result.wrong)}</b><span>ভুল</span></div><div><b>${bn(result.skipped)}</b><span>উত্তরহীন</span></div><div><b>${time(state.elapsed)}</b><span>মোট সময়</span></div></section><section class="otm-card otm-insight"><b>পারফরম্যান্স বিশ্লেষণ</b><p>উত্তরদানের হার <strong>${bn(state.pool.length ? ((result.correct + result.wrong) / state.pool.length) * 100 : 0)}%</strong> · Negative mark <strong>−${bn(result.wrong * state.negative, 2)}</strong></p><div class="otm-actions"><button class="otm-btn primary" type="button" ${result.wrong ? '' : 'disabled'} onclick="window.OneTimeMockTool.retryWrong()">↻ ভুলগুলো আবার দাও</button><button class="otm-btn" type="button" onclick="window.OneTimeMockTool.newMock()">▷ নতুন Mock</button></div></section><h2 class="otm-title" style="font-size:20px;margin-top:23px">প্রশ্ন রিভিউ <small style="font-size:12px;color:#6d8279">${bn(filtered.length)}/${bn(state.pool.length)}</small></h2><div class="otm-filter">${[['all','সব'],['correct','সঠিক'],['wrong','ভুল'],['skipped','উত্তর দেওয়া হয়নি']].map(([key,label]) => `<button class="${state.filter === key ? 'active' : ''}" type="button" onclick="window.OneTimeMockTool.setFilter('${key}')">${label}</button>`).join('')}</div><section>${review || '<section class="otm-card">এই filter-এ কোনো প্রশ্ন নেই।</section>'}</section></main>${renderNav()}`;
  }

  function render() {
    if (!state.bank.length) setSeed();
    if (!state.bank.length) { renderShell('<main class="otm-page"><h1 class="otm-title">Mock Tool loading হয়নি</h1><p class="otm-sub">আবার Dashboard থেকে toolটি খুলুন।</p></main>'); return; }
    clearClock();
    if (state.active) renderShell(renderExam());
    else if (state.view === 'parser') renderShell(`${renderHeader(false)}${renderParser()}`);
    else if (state.view === 'result') renderShell(renderResult());
    else renderShell(`${renderHeader(false)}${renderSetup()}`);
    if (state.active) startClock();
    window.scrollTo({ top: 0, behavior: 'auto' });
    attachFileInput();
  }

  function attachFileInput() {
    const input = q('#otmFile');
    if (input) input.onchange = (event) => { const file = event.target.files?.[0]; if (!file) return; const reader = new FileReader(); reader.onload = () => { state.draft = String(reader.result || ''); state.rows = parseQuestions(state.draft); render(); }; reader.readAsText(file); };
  }

  function startClock() {
    clearClock();
    state.timer = setInterval(() => {
      state.elapsed += 1;
      const clock = q('#otmClock');
      if (clock) clock.textContent = `◷ ${state.duration ? time(remaining()) : '∞'}`;
      if (state.duration && remaining() <= 0) { clearClock(); state.confirm = true; render(); }
    }, 1000);
  }

  function updateSelection(id) {
    const selected = state.answers[id];
    for (let index = 0; index < 4; index += 1) q(`#otmOption${id}_${index}`)?.classList.toggle('selected', selected === index);
    const clear = q(`#otmClear${id}`); if (clear) clear.style.display = selected === undefined ? 'none' : '';
    const rail = q(`#otmRail${id}`); if (rail) rail.classList.toggle('answered', selected !== undefined);
    const count = q('#otmAnswered'); if (count) count.textContent = bn(answered());
    const progress = q('#otmProgress'); if (progress) progress.style.width = `${state.pool.length ? answered() / state.pool.length * 100 : 0}%`;
  }

  window.OneTimeMockTool = {
    open(view) { if (state.active) return; state.view = view === 'result' && !state.pool.length ? 'mock' : view; render(); },
    setDuration(value) { if (!state.active) { state.duration = Number(value); render(); } },
    setNegative(value) { if (!state.active) { state.negative = Number(value); render(); } },
    start(pool = state.bank) { state.pool = cloneQuestions(pool); state.answers = {}; state.bookmarks = new Set(); state.flags = new Set(); state.page = 0; state.elapsed = 0; state.active = true; state.view = 'mock'; state.confirm = false; render(); },
    setPage(delta) { state.page = Math.max(0, Math.min(totalPages() - 1, state.page + Number(delta))); render(); },
    select(id, option) { if (!state.active) return; state.answers[id] === option ? delete state.answers[id] : state.answers[id] = option; updateSelection(id); },
    clear(id) { if (!state.active) return; delete state.answers[id]; updateSelection(id); },
    jump(id) { q(`#otmQuestion${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); },
    toggleBookmark(id) { state.bookmarks.has(id) ? state.bookmarks.delete(id) : state.bookmarks.add(id); const node = q(`#otmBook${id}`); if (node) { node.classList.toggle('on', state.bookmarks.has(id)); node.textContent = state.bookmarks.has(id) ? '★' : '☆'; } },
    toggleFlag(id) { state.flags.has(id) ? state.flags.delete(id) : state.flags.add(id); q(`#otmFlag${id}`)?.classList.toggle('on', state.flags.has(id)); },
    askFinish() { if (!state.active) return; state.confirm = true; render(); },
    cancelFinish() { state.confirm = false; render(); },
    finish() { clearClock(); state.confirm = false; state.active = false; state.view = 'result'; render(); },
    preview() { state.draft = q('#otmDraft')?.value || ''; state.rows = parseQuestions(state.draft); render(); },
    importRows() { const valid = state.rows.filter((row) => row.valid).map((row, index) => optionShuffle({ ...row, id: index + 1 })); if (!valid.length) return; state.bank = cloneQuestions(valid); state.pool = cloneQuestions(valid); state.rows = []; state.draft = ''; state.view = 'mock'; render(); },
    setFilter(filter) { state.filter = filter; render(); },
    retryWrong() { const wrong = state.pool.filter((question) => state.answers[question.id] !== undefined && state.answers[question.id] !== question.answer); if (wrong.length) this.start(wrong); },
    newMock() { this.start(state.bank); },
    render,
    reset() { clearClock(); state.view = 'mock'; state.answers = {}; state.bookmarks = new Set(); state.flags = new Set(); state.active = false; state.page = 0; state.elapsed = 0; state.confirm = false; setSeed(); render(); }
  };

  const previousRoute = window.__admissionRenderRoute;
  if (typeof previousRoute === 'function') window.__admissionRenderRoute = function nativeOneTimeMockRoute() { if (route() === ROUTE) return window.OneTimeMockTool.render(); return previousRoute.apply(this, arguments); };
  const previousRender = window.render;
  if (typeof previousRender === 'function') window.render = function nativeOneTimeMockRender() { if (route() === ROUTE) return window.OneTimeMockTool.render(); return previousRender.apply(this, arguments); };
  window.addEventListener('hashchange', () => { if (route() === ROUTE) setTimeout(() => window.OneTimeMockTool.render(), 0); });
})();
