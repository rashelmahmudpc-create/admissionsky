/* AdmissionSky, agent phase 1, in-app tools (owner 2026-10-17).
   These five tools need data that lives on this device (CACHE.questions,
   CACHE.examResults, the in-app knowledge bank), so they run here: instant, no
   server call, no AI limit used. READ-only: nothing is saved or deleted.
     search_question_bank  "সমাস নিয়ে প্রশ্ন খুঁজে দাও"
     make_quiz             "নেকলেস থেকে ৫টা কুইজ দাও"  (default 5, max 20)
     grade_quiz            "১-ক ২-খ ৩-গ" right after a quiz
     knowledge_lookup      "সমাস সম্পর্কে তথ্য খুঁজে দাও"
     open_page             "প্রশ্নব্যাংক খোলো"
   At most 5 tools per question. A question the bank cannot answer returns null
   and goes to the AI as before. */
(function (root) {
  'use strict';
  const MAX_TOOLS = 5, QUIZ_DEFAULT = 5, QUIZ_MAX = 20, SEARCH_MAX = 5;
  const BN = '০১২৩৪৫৬৭৮৯', LET = ['ক', 'খ', 'গ', 'ঘ', 'ঙ', 'চ'];
  const en = (s) => String(s == null ? '' : s).replace(/[০-৯]/g, (d) => String(BN.indexOf(d)));
  const bn = (s) => String(s == null ? '' : s).replace(/\d/g, (d) => BN[+d]);
  const norm = (s) => String(s == null ? '' : s).normalize('NFC').toLowerCase().replace(/[\u200c\u200d]/g, '').replace(/[?？!।,.:;"“”‘’'`()[\]{}]+/g, ' ').replace(/\s+/g, ' ').trim();
  const LABEL = {
    search_question_bank: 'প্রশ্নব্যাংকে খুঁজছি', make_quiz: 'কুইজ বানাচ্ছি', grade_quiz: 'তোমার উত্তর মিলিয়ে দেখছি',
    knowledge_lookup: 'জমানো জ্ঞানভান্ডারে খুঁজছি', open_page: 'পেজের পথ বের করছি'
  };
  const cache = () => (typeof root.CACHE !== 'undefined' && root.CACHE) || (typeof CACHE !== 'undefined' ? CACHE : null) || {};
  const nameOf = (list, id) => { const r = (list || []).find((x) => x && String(x.id) === String(id)); return r ? String(r.name || '') : ''; };
  const ansIndex = (q) => { const n = Number(q.answer != null ? q.answer : q.answerIndex); if (isFinite(n) && n >= 0) return n; const i = (q.options || []).indexOf(q.correctAnswer); return i; };
  const usable = (q) => q && q.question && Array.isArray(q.options) && q.options.length >= 2 && ansIndex(q) >= 0 && ansIndex(q) < q.options.length;

  /* pages a student may be sent to (same names the app's navigate() uses) */
  const PAGES = [
    { id: 'question-bank', name: 'প্রশ্নব্যাংক', k: ['প্রশ্নব্যাংক', 'প্রশ্ন ব্যাংক', 'question bank', 'qbank'] },
    { id: 'mistakes-bank', name: 'ভুল-ব্যাংক', k: ['ভুল ব্যাংক', 'ভুল-ব্যাংক', 'ভুলের তালিকা', 'mistake'] },
    { id: 'exam', name: 'পরীক্ষা', k: ['মক টেস্ট', 'পরীক্ষা', 'exam', 'mock'] },
    { id: 'progress', name: 'অগ্রগতি', k: ['অগ্রগতি', 'প্রোগ্রেস', 'progress', 'রেজাল্ট পেজ'] },
    { id: 'notes', name: 'নোট', k: ['নোট', 'notes'] },
    { id: 'dictionary', name: 'ডিকশনারি', k: ['ডিকশনারি', 'অভিধান', 'dictionary'] },
    { id: 'daily-gk', name: 'দৈনিক সাধারণ জ্ঞান', k: ['সাধারণ জ্ঞান', 'daily gk', 'জিকে'] },
    { id: 'my-profile', name: 'প্রোফাইল', k: ['প্রোফাইল', 'profile'] },
    { id: 'dashboard', name: 'হোম', k: ['হোম', 'ড্যাশবোর্ড', 'home', 'dashboard'] }
  ];
  const RE_OPEN = /(খোলো|খুলো|খুলে দাও|খোল|নিয়ে চলো|নিয়ে যাও|যাব|যাও|open|go to)/i;
  const RE_QUIZ = /(কুইজ|quiz|এমসিকিউ|mcq|পরীক্ষা নাও|প্রশ্ন দাও|প্রশ্ন করো)/i;
  const RE_SEARCH = /(প্রশ্ন\s*(খুঁজ|খোঁজ|দেখাও|বের কর)|question.*(search|find)|search.*question)/i;
  const RE_LOOKUP = /(সম্পর্কে (তথ্য|জানতে)|তথ্য খুঁজ|খুঁজে (দেখ|দাও)|lookup|look up)/i;
  const RE_GRADE = /^(?:\s*[0-9০-৯]{1,2}\s*[-.)।:=]?\s*[কখগঘঙচabcdefABCDEF]\s*[,;\s]*){2,20}$|^\s*(?:[কখগঘঙচ]\s*[,;\s]+){1,19}[কখগঘঙচ]\s*$/;

  function topicMatch(text) {
    const c = cache(), t = norm(text);
    let best = null;
    for (const tp of (c.topics || [])) {
      const n = norm(tp && tp.name);
      if (n && n.length >= 2 && t.includes(n) && (!best || n.length > best.n.length)) best = { id: tp.id, n, name: tp.name };
    }
    for (const sb of (c.subjects || [])) {
      const n = norm(sb && sb.name);
      if (n && n.length >= 2 && t.includes(n) && !best) best = { subjectId: sb.id, n, name: sb.name };
    }
    return best;
  }
  function pool(match) {
    const qs = (cache().questions || []).filter(usable);
    if (!match) return [];
    return qs.filter((q) => (match.id != null ? String(q.topicId) === String(match.id) : String(q.subjectId) === String(match.subjectId)));
  }
  function count(text) {
    const m = /(\d{1,3})/.exec(en(text));
    const n = m ? parseInt(m[1], 10) : QUIZ_DEFAULT;
    return Math.max(1, Math.min(QUIZ_MAX, n > 0 ? n : QUIZ_DEFAULT));
  }
  function shuffle(a, seed) { const r = a.slice(); let s = seed >>> 0 || 1; for (let i = r.length - 1; i > 0; i--) { s = (s * 1664525 + 1013904223) >>> 0; const j = s % (i + 1); [r[i], r[j]] = [r[j], r[i]]; } return r; }

  /* ── the five tools ── */
  function makeQuiz(text, seed) {
    const m = topicMatch(text); const p = pool(m);
    if (!m || !p.length) return null;
    const n = count(text);
    const pick = shuffle(p, seed || Date.now()).slice(0, n);
    const lines = ['📝 **' + m.name + ', ' + bn(pick.length) + 'টা প্রশ্নের কুইজ**', ''];
    pick.forEach((q, i) => {
      lines.push('**' + bn(i + 1) + '.** ' + String(q.question).trim());
      q.options.slice(0, 6).forEach((o, j) => lines.push('   ' + LET[j] + ') ' + String(o).trim()));
      lines.push('');
    });
    lines.push('✅ উত্তর এভাবে লেখো: **' + pick.slice(0, 3).map((_, i) => bn(i + 1) + '-ক').join(' ') + (pick.length > 3 ? ' …' : '') + '**, আমি মিলিয়ে নম্বর দেব।');
    if (pick.length < n) lines.push('', '📌 এই টপিকে এখন ' + bn(pick.length) + 'টা প্রশ্নই আছে।');
    return { text: lines.join('\n'), quiz: pick.map((q) => ({ id: q.id, a: ansIndex(q) })) };
  }
  function parseAnswers(text, size) {
    const t = en(text).replace(/[abcdef]/gi, (x) => LET['abcdef'.indexOf(x.toLowerCase())]);
    const out = new Array(size).fill(-1);
    const numbered = [...t.matchAll(/(\d{1,2})\s*[-.)।:=]?\s*([কখগঘঙচ])/g)];
    if (numbered.length) { for (const m of numbered) { const i = parseInt(m[1], 10) - 1; if (i >= 0 && i < size) out[i] = LET.indexOf(m[2]); } return out; }
    [...t.matchAll(/[কখগঘঙচ]/g)].slice(0, size).forEach((m, i) => { out[i] = LET.indexOf(m[0]); });
    return out;
  }
  function gradeQuiz(text, quiz) {
    if (!Array.isArray(quiz) || !quiz.length || !RE_GRADE.test(String(text).trim())) return null;
    const ans = parseAnswers(text, quiz.length);
    const byId = {}; for (const q of (cache().questions || [])) if (q) byId[q.id] = q;
    let right = 0; const rows = [];
    quiz.forEach((it, i) => {
      const got = ans[i];
      if (got === it.a) { right++; rows.push(bn(i + 1) + '. ✅ ' + LET[got]); }
      else {
        const q = byId[it.id];
        const exp = q && q.explanation ? ', ' + String(q.explanation).trim().slice(0, 160) : '';
        rows.push(bn(i + 1) + '. ' + (got < 0 ? '⏭️ উত্তর দাওনি' : '❌ ' + LET[got]) + ' → সঠিক: **' + LET[it.a] + (q ? ') ' + String(q.options[it.a]).trim() : '') + '**' + exp);
      }
    });
    const p = Math.round(right * 100 / quiz.length);
    const head = '🎯 **ফল: ' + bn(quiz.length) + 'টার মধ্যে ' + bn(right) + 'টা সঠিক (' + bn(p) + '%)**';
    const tail = p >= 80 ? '✅ দারুণ! আরেকটা কঠিন সেট চাইলে বলো।' : (p >= 50 ? '💡 ভালো হয়েছে। ভুলগুলো আরেকবার দেখে নাও।' : '📚 এই টপিকটা আরেকবার রিভিশন দাও, তারপর আবার কুইজ নাও।');
    return { text: [head, ''].concat(rows).concat(['', tail]).join('\n'), graded: true };
  }
  function searchBank(text) {
    if (!RE_SEARCH.test(text)) return null;
    const m = topicMatch(text);
    let rows = pool(m);
    if (!rows.length) {
      const words = norm(text).split(' ').filter((w) => w.length >= 3 && !/প্রশ্ন|খুঁজ|খোঁজ|দেখাও|দাও|নিয়ে|সম্পর্কে|question|search|find/.test(w));
      if (!words.length) return null;
      rows = (cache().questions || []).filter((q) => usable(q) && words.some((w) => norm(q.question).includes(w)));
    }
    if (!rows.length) return { text: '🔎 প্রশ্নব্যাংকে এ নিয়ে কোনো প্রশ্ন পাইনি। অন্য শব্দে খুঁজে দেখো, বা আমাকে সরাসরি প্রশ্ন করো।', go: 'question-bank' };
    const c = cache();
    const lines = ['🔎 **প্রশ্নব্যাংকে ' + bn(rows.length) + 'টা প্রশ্ন পেয়েছি**' + (rows.length > SEARCH_MAX ? ', প্রথম ' + bn(SEARCH_MAX) + 'টা:' : ''), ''];
    rows.slice(0, SEARCH_MAX).forEach((q, i) => {
      const tn = nameOf(c.topics, q.topicId);
      lines.push(bn(i + 1) + '. ' + String(q.question).trim() + (tn ? '  _(' + tn + ')_' : ''));
    });
    lines.push('', '💡 এগুলো দিয়ে কুইজ চাইলে বলো "' + (m ? m.name : 'এই টপিক') + ' থেকে কুইজ দাও"।');
    return { text: lines.join('\n'), go: 'question-bank' };
  }
  function lookup(text) {
    if (!RE_LOOKUP.test(text) || !root.SkyFAQ || typeof root.SkyFAQ.match !== 'function') return null;
    const q = String(text).replace(new RegExp(RE_LOOKUP.source, 'gi'), ' ').replace(/(^|\s)(দাও|তো|একটু|প্লিজ|please)(?=\s|$)/gi, ' ').replace(/\s+/g, ' ').trim();
    const hit = q ? root.SkyFAQ.match(q + ' কী') : null;
    return hit ? { text: hit.a, faq: hit.id, q: hit.q } : null;
  }
  function openPage(text) {
    if (!RE_OPEN.test(text)) return null;
    const t = norm(text);
    for (const p of PAGES) if (p.k.some((k) => t.includes(norm(k)))) return { text: '🧭 **' + p.name + '** পেজ খুলতে নিচের বোতাম চাপো।', go: p.id, goName: p.name };
    return null;
  }

  /**
   * Try the in-app tools for one message. Returns null (send to the AI) or
   * { text, steps: [labels], tools: [names], quiz?, go?, goName?, faq?, q? }.
   * ctx.lastQuiz: the quiz from the last Sky turn (for grade_quiz).
   */
  function run(text, ctx) {
    const t = String(text == null ? '' : text).trim();
    if (!t || t.length > 300) return null;
    if (root.SkyTools && root.SkyTools.off) return null;
    ctx = ctx || {};
    const order = [
      ['grade_quiz', () => gradeQuiz(t, ctx.lastQuiz)],
      ['open_page', () => openPage(t)],
      ['search_question_bank', () => searchBank(t)],
      ['make_quiz', () => (RE_QUIZ.test(t) ? makeQuiz(t, ctx.seed) : null)],
      ['knowledge_lookup', () => lookup(t)]
    ];
    const steps = [], tools = [];
    for (const [name, fn] of order) {
      if (tools.length >= MAX_TOOLS) break;
      let r = null;
      try { r = fn(); } catch (_) { r = null; }
      if (r) { steps.push('টুল চালিয়েছি, ' + LABEL[name]); tools.push(name); return Object.assign({ steps, tools }, r); }
    }
    return null;
  }

  root.SkyTools = { run, version: 'sky-tools-client-v1', limits: { maxTools: MAX_TOOLS, quizDefault: QUIZ_DEFAULT, quizMax: QUIZ_MAX }, _t: { parseAnswers, gradeQuiz, makeQuiz, openPage, searchBank, topicMatch, count } };
})(typeof window !== 'undefined' ? window : globalThis);
