/*
  ADMISSION HUB · MISTAKE NOTE ICON  (v14)

  Rules (user requirements):
  1. The icon is HIDDEN until the question has actually been answered WRONG.
     It never appears on unattempted / correct cards.
  2. It sits BELOW the card content (a neat bottom strip), not at the top.
  3. It works in the Question Bank AND in the Flash Test live page
     (wrong-feedback box).
  4. Mock Test: nothing during the exam. Only AFTER the exam ends, each WRONG
     result card gets TWO icons:
       (a) 🤖 AI Explain , opens the existing Gemini prompt modal (manual,
                            user copies the prompt themselves)
       (b) 📝 Note       , opens the note editor (question + wrong answer +
                            space to paste the AI explain) and saves to Notes.
*/
(function installMistakeNoteIcon(){
  'use strict';
  if (window.__mistakeNoteIconInstalled) return;
  window.__mistakeNoteIconInstalled = true;

  function getCache(){
    try { if (typeof CACHE !== 'undefined' && CACHE) return CACHE; } catch (_) {}
    return window.CACHE || { questions: [], mistakes: [], subjects: [], topics: [] };
  }

  function findQuestionById(qid){
    if (!qid) return null;
    return getCache().questions?.find(x => String(x.id) === String(qid)) || null;
  }

  function findQuestionByText(text){
    if (!text || text.length < 12) return null;
    const t = String(text);
    // Exact match first, then prefix match (card text carries status labels too).
    return getCache().questions?.find(q => {
      const qt = String(q.question);
      return qt.trim() === t.trim() || (qt.length >= 14 && t.trim().indexOf(qt.trim()) === 0) || (t.trim().length >= 14 && qt.trim().indexOf(t.trim()) === 0);
    }) || null;
  }

  function findQuestionForCard(card){
    const qid = card?.getAttribute?.('data-mistake-qid');
    const q = findQuestionById(qid);
    if (q) return q;
    return findQuestionByText(card?.textContent || '') || null;
  }

  /* ---------- openers ---------- */
  // Note editor (saves into the Notes tool, with AI Explain field).
  function openNoteFor(q, payload){
    if (typeof window.openQuestionNoteEditor === 'function') {
      const src = (payload && payload.source) || 'Mistake Note';
      const notePayload = Object.assign({ q, source: src }, payload || {});
      notePayload.selectedIndex = selectedIndex(q, notePayload);
      window.openQuestionNoteEditor(notePayload);
    }
  }

  // Gemini prompt modal, self-contained (manual-gemini-helper's showPrompt is
  // not exported to window, so this builds the same kind of prompt modal).
  function buildMnPrompt({ q, selectedIndex, source }){
    const correctIndex = Number(q?.answerIndex ?? q?.answer ?? 0);
    const letters = (q?.options || []).map((o, i) => String.fromCharCode(65 + i) + '. ' + String(o || '').slice(0, 200)).join(' | ');
    return [
      'তুমি একজন ভালো admission teacher। এই ভুল MCQ-টি আমার।',
      'আমি যাতে খাত বুঝতে পারি "আমি ঠিক কোথায় ভুল করেছি" এবং একই ধরনের প্রশ্নে আবার না ভুলে।',
      'লক্ষ্য: short নয়, short, memorable ও understandable।',
      '',
      'প্রশ্ন: ' + String(q?.question || '').slice(0, 600),
      'বিকল্প: ' + letters.slice(0, 600),
      'আমার উত্তর: ' + String(q?.options?.[selectedIndex] || '').slice(0, 260),
      'সঠিক উত্তর: ' + String(q?.options?.[correctIndex] || '').slice(0, 260),
      'ব্যাখ্যা (যদি থাকে): ' + String(q?.explanation || '').slice(0, 500)
    ].filter(Boolean).join('\n');
  }

  function openAiExplainFor(q, payload){
    if (window.AiExplain && typeof window.AiExplain.btn === 'function') { openInlineExplain(q, payload); return; }
    const src = (payload && payload.source) || 'Mock Test';
    const prompt = buildMnPrompt(Object.assign({ q }, payload || {}));
    window.__mnLastPrompt = prompt;
    let root = document.getElementById('mnAiRoot');
    if (!root) {
      root = document.createElement('div');
      root.id = 'mnAiRoot';
      document.body.appendChild(root);
    }
    const compact = window.innerWidth <= 480;
    root.style.cssText = 'position:fixed;inset:0;z-index:10060;display:flex;align-items:' + (compact ? 'flex-end' : 'center') + ';justify-content:center;padding:' + (compact ? '7px' : '12px') + ';box-sizing:border-box;background:rgba(8,28,22,.62);overflow:auto;';
    root.innerHTML =
      '<div style="position:relative;z-index:10062;width:min(640px,100%);max-height:' + (compact ? '91vh' : '90vh') + ';overflow:auto;background:#fff;border-radius:' + (compact ? '22px 22px 0 0' : '23px') + ';padding:' + (compact ? '19px 13px 13px' : '21px 16px 16px') + ';box-shadow:0 24px 80px rgba(0,0,0,.3);color:#153c2d">' +
      '<button type="button" id="mnAiClose" style="position:absolute;right:12px;top:10px;width:33px;height:33px;border:0;border-radius:50%;font-size:23px;background:#edf7f1;color:#24664e;cursor:pointer">×</button>' +
      '<div style="font-size:10px;letter-spacing:.12em;font-weight:900;color:#0f6b4f">GEMINI · ' + escMn(src) + '</div>' +
      '<h2 style="margin:4px 0 7px;font-size:23px">ভুল প্রশ্নটি বুঝে নাও</h2>' +
      '<p style="font-size:13px;line-height:1.55;color:#567267;margin:0 0 10px">Prompt কপি করে Gemini বা ChatGPT-এর যেকোনো একটি খুলে paste করে Send চাপো। ফিরে এসে প্রশ্নের নিচের "📝 নোট করুন" button-এ click করলে explanation save করতে পারবে।</p>' +
      '<div style="padding:11px;border-radius:13px;background:#f0f8f3;font-size:12px;line-height:1.5;overflow-wrap:anywhere"><b>প্রশ্ন</b><p style="font-size:14px;font-weight:800;margin:5px 0 8px">' + escMn(q?.question || '') + '</p>' +
      '<span>তোমার উত্তর: <strong>' + escMn(String(q?.options?.[selectedIndex(q, payload)] || '')) + '</strong></span>' +
      '<span>সঠিক উত্তর: <strong>' + escMn(String(q?.options?.[correctOf(q)] || '')) + '</strong></span></div>' +
      '<textarea id="mnAiPrompt" readonly aria-label="Gemini prompt" style="display:block;width:100%;height:145px;margin-top:10px;box-sizing:border-box;border:1px solid #cfe5d8;border-radius:12px;padding:10px;resize:vertical;font:12px/1.55 inherit;color:#254d3e;background:#fbfefc">' + escMn(prompt) + '</textarea>' +
      '<div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">' +
      '<button type="button" id="mnAiCopy" style="flex:1 1 180px;min-height:42px;border:0;border-radius:12px;padding:11px;font-weight:900;cursor:pointer;background:#0f6b4f;color:#fff">📋 Prompt কপি করুন</button>' +
      '<button type="button" id="mnAiGemini" style="flex:1 1 180px;min-height:42px;border:0;border-radius:12px;padding:11px;font-weight:900;cursor:pointer;background:#e8f1ff;color:#174a8b">✨ Gemini খুলুন</button>' +
      '</div></div>';
    document.getElementById('mnAiClose').onclick = () => root.remove();
    document.getElementById('mnAiCopy').onclick = () => {
      try { copyTextFn(prompt); document.getElementById('mnAiCopy').textContent = '✓ কপি হয়েছে'; } catch (_) {}
    };
    document.getElementById('mnAiGemini').onclick = () => {
      if (typeof window.openManualGemini === 'function') window.openManualGemini();
      else window.open('https://gemini.google.com/app', '_blank');
    };
  }

  // v122: ম্যানুয়াল prompt-copy বাদ, AiExplain ইনলাইন-প্যানেল (এক প্রশ্ন = এক রিকোয়েস্ট, ক্যাশ-রিইউজ)
  function openInlineExplain(q, payload){
    const qid = String(q?.id || q?.question || '').slice(0, 60) || 'q-' + Date.now().toString(36);
    let host = document.getElementById('mnAiexHost');
    if (!host) {
      host = document.createElement('div');
      host.id = 'mnAiexHost';
      host.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:10055;padding:8px 8px calc(8px + env(safe-area-inset-bottom));background:linear-gradient(180deg,rgba(240,253,246,0),#eefaf3 30%);pointer-events:none';
      document.body.appendChild(host);
    }
    host.style.pointerEvents = 'none';
    const inner = document.createElement('div');
    inner.style.cssText = 'max-width:640px;margin:0 auto;pointer-events:auto';
    host.innerHTML = ''; host.appendChild(inner);
    const letter = i => ['ক', 'খ', 'গ', 'ঘ', 'ঙ'][i] || String(i + 1);
    const sel = selectedIndex(q, Object.assign({}, payload));
    const cor = correctOf(q);
    const ctx = { q: q, options: q?.options || [], correctText: String((q?.options || [])[cor] || ''), student: sel, wrong: true, subject: String(q?.subjectName || payload?.subject || ''), topic: String(q?.topicName || payload?.topic || ''), mode: payload?.mode || 'mistake' };
    inner.innerHTML = window.AiExplain.btn(qid, ctx);
    const btnEl = inner.querySelector('.aiex-btn');
    if (btnEl) { btnEl.click(); try { btnEl.closest('.aiex-wrap')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch (_) {} }
    else host.innerHTML = '';
  }

  function correctOf(q){ return Number(q?.answerIndex ?? q?.answer ?? 0); }
  function selectedIndex(q, payload){
    if (payload && Number.isFinite(payload.selectedIndex)) return payload.selectedIndex;
    // Unknown wrong selection, return first incorrect option.
    const c = correctOf(q); const len = (q?.options?.length || 0);
    return len > 1 ? (c + 1) % len : 0;
  }
  function escMn(s){ return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function copyTextFn(txt){
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(txt);
    const ta = document.createElement('textarea'); ta.value = txt; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
  }

  /* ---------- button builder ---------- */
  function makeButton(emoji, title, click){
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'mn-note-btn';
    btn.title = title;
    btn.setAttribute('aria-label', title);
    btn.textContent = emoji;
    btn.addEventListener('click', (ev) => { ev.preventDefault(); ev.stopPropagation(); click(ev); }, true);
    return btn;
  }

  /* ---------- attachment ---------- */
  function attachButtonsToCard(card, q, opts){
    if (!q || !card) return;
    const row = card.querySelector('.mn-note-row') || (() => {
      const r = document.createElement('div');
      r.className = 'mn-note-row';
      card.appendChild(r);
      return r;
    })();
    const mode = opts.mode || 'note';
    if (q && q.id) card.setAttribute('data-mistake-qid', String(q.id));   // keep future runs from losing the link
    if (!row.querySelector('.mn-nt-btn')) {
      row.appendChild(makeButton('📝 নোট করুন', 'AI explain সহ নোট করুন', () => openNoteFor(q, opts)));
    }
  }

  /* ---------- id extraction ---------- */
  const ID_PATTERNS = [
    /data-qid="([^"]+)"/,
    /resultPracticeOne\("([^"]+?)","([^"]+?)"/,
    /resultPracticeOne\('([^']+?)','([^']+?)'/,
    /resultAddMistake\(\s*'([^']+?)'\s*,\s*'([^']+?)'/,
    /resultToggleBookmark\((?:'|"|\\u0027)([^"']+?)(?:'|"|\\u0027)\)/,
    /startQuestionPractice\(\[[\s\S]*?["']([^"']+?)["']\]/,
    /toggleQuestionBookmark\(['"]([^"']+?)['"]\)/,
    /ahEditQuestion\(['"]([^"']+?)['"]\)/,
    /revealTopicAnswer\(['"]([^"']+?)['"]\)/,
    /selectTopicAnswer\(['"]([^"']+?)['"]\)/
  ];

  function extractIdFromHandlers(card){
    const buttons = card.querySelectorAll('[onclick]');
    for (const b of buttons) {
      const oc = b.getAttribute('onclick') || '';
      for (const pat of ID_PATTERNS) {
        const m = oc.match(pat);
        if (m) return m[1];
      }
    }
    const own = card.getAttribute('onclick') || '';
    for (const pat of ID_PATTERNS) {
      const m = own.match(pat);
      if (m) return m[1];
    }
    return null;
  }

  /* ---------- wrong-detection per card type ---------- */
  function isWrong(card){
    const text = card.textContent || '';
    const cls = (card.className || '').toString();
    if (/wrong/.test(cls)) return true;                       // result-review-card.wrong / answer-reveal.wrong
    if (text.indexOf('Unattempted') !== -1) return false;     // q-card-v2: never attempted → hide
    if (text.indexOf('⏭ Skip') !== -1 || text.indexOf('Skip') !== -1 && !/Wrong/.test(text)) { if (/Wrong/.test(text) === false && /ভুল/.test(text) === false) return false; }
    return /✕ Wrong|ভুল উত্তর|Wrong answer/.test(text);        // q-card-v2 status banner
  }

  const CARD_SELECTORS = [
    '.q-card-v2',                      // question bank practice / topic review card
    '.result-review-card',             // exam / mock / flash result review card
    '.card.mistake-book-card',         // Smart Mistake Book
    '.card.mistake-row',               // Mistake Bank 2.0
    '.flash-feedback.wrong'            // flash test LIVE wrong-feedback box
  ];

  /* Special extraction for the flash live wrong-feedback box: it lives inside
     .flash-q-card whose options carry onclick="selectFlashAnswer('qid',i)". */
  function extractIdFromFlashHost(card){
    let host = card;
    while (host && !host.matches('.flash-q-card')) host = host.parentElement;
    if (!host) return null;
    const buttons = host.querySelectorAll('[onclick]');
    for (const b of buttons) {
      const m = (b.getAttribute('onclick') || '').match(/selectFlashAnswer\(['"]([^"']+?)['"]/);
      if (m) return m[1];
    }
    return null;
  }

  /* ---------- main pass ---------- */
  function run(){
    CARD_SELECTORS.forEach(sel => {
      document.querySelectorAll(sel).forEach(card => {
        const existingRow = card.querySelector('.mn-note-row');
        if (existingRow) {
          // A row from an older script version carries no question id, purge it
          // so the card gets re-evaluated against the current logic.
          if (!card.getAttribute('data-mistake-qid')) { removeRow(card); }
          else { card.setAttribute('data-mistake-done', '1'); return; }
        }
        // A stale 'done' flag from an earlier script version must not block
        // attachment forever, only skip when we already attached in THIS version.
        const stale = card.getAttribute('data-mistake-done') && !card.querySelector('.mn-note-row');
        if (stale) card.removeAttribute('data-mistake-done');
        if (card.getAttribute('data-mistake-done')) return;

        const hostSel = sel === '.flash-feedback.wrong' ? 'flash' : 'regular';
        const qid = hostSel === 'flash' ? extractIdFromFlashHost(card) : extractIdFromHandlers(card);
        let q = findQuestionById(qid);
        if (!q && hostSel !== 'flash') q = findQuestionByText(card.textContent || '');

        const isWrongCard = isWrong(card);

        if (hostSel === 'flash') {
          // Flash live page: one note button inside the wrong-feedback box,
          // only when the question is actually wrong (selector already ensures).
          if (q) attachButtonsToCard(card, q, { source: 'Flash Test' });
          return;
        }

        if (sel === '.result-review-card') {
          // Mock / flash result page: show the two icons ONLY on wrong cards,
          // and never while an exam is actively running in mock mode.
          const examRunning = Boolean(window.ActiveExam && window.ActiveExam.mode === 'mock');
          if (!isWrongCard || examRunning) { removeRow(card); return; }
          attachButtonsToCard(card, q, { mode: 'mock', source: 'Mock Test' });
          return;
        }

        // Question bank / mistake book cards: icon ONLY when wrong.
        if (!isWrongCard) { removeRow(card); return; }
        if (!q) { removeRow(card); return; }   // no question → nothing to note
        attachButtonsToCard(card, q, { source: 'Question Bank' });
      });
    });
  }

  function removeRow(card){
    const row = card.querySelector('.mn-note-row');
    if (row) row.remove();
    card.removeAttribute('data-mistake-qid');
    card.removeAttribute('data-mistake-done');
  }

  /* ---------- styles ---------- */
  const style = document.createElement('style');
  style.id = 'mistake-note-icon-styles';
  style.textContent = `.mn-note-row{display:flex;gap:8px;margin-top:12px;flex-wrap:wrap}.mn-note-btn{flex:1 1 140px;border:1px solid #b9ddc8;background:#f1fbf4;color:#0f6b4f;border-radius:12px;padding:10px 8px;font-size:12px;font-weight:900;cursor:pointer;line-height:1.3;box-shadow:0 2px 6px rgba(15,107,79,.1)}.mn-note-btn:active{transform:scale(.96)}`;
  document.head.appendChild(style);

  const observer = new MutationObserver(() => setTimeout(run, 0));
  observer.observe(document.body || document.documentElement, { childList: true, subtree: true });
  window.addEventListener('hashchange', () => setTimeout(run, 400));

  setTimeout(run, 400);
  setTimeout(run, 1200);
  setTimeout(run, 2600);
  setInterval(run, 2000);
})();
