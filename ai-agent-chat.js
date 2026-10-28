/* ✦ ADMISSION HUB AI, Sky (student study partner)
 * UI: owner-supplied Sky design v2 (sky-chat 2.html, 2026-10-15), animated
 *     Sky avatar with props (laptop, book, note, cup, magnifier, calculator,
 *     headphones, cap), hero, live status panel, drawer, bottom sheet, themes.
 * Backend: LIVE. No demo/canned data anywhere in this file.
 *   POST /api/ai/chat              (SSE stream) , the real tutor
 *   POST /api/ai/actions/propose   /api/ai/actions/confirm, personalization
 * Theme: follows the app's Global Appearance Engine (window.AhAppearance,
 *   <html data-theme>), so app-dark → chat-dark, app-light → chat-light.
 * Contract kept from the previous chatv1 module: window.renderAiAgentPage.
 */
(function () {
  'use strict';
  if (window.renderAiAgentPage) return;

  const STORE = 'aiSkyChat:v1';
  const MAX_MSGS = 60;
  const MAX_HISTORY = 12;

  /* ───────── theme: single source of truth is the app's engine ───────── */
  function appResolved() {
    /* The app carries two theme engines: phase1-upgrade owns
       'admission_theme_v1' (emerald-glass/midnight-academic/ivory-academic) and
       writes <html data-theme>, while AhAppearance owns 'ah-appearance'
       (light/dark/system/green). They can disagree, so ask them in order of
       authority: the attribute phase1 writes, then phase1's stored pick, then
       AhAppearance. AhAppearance only ever reports 'light' for phase1's dark
       theme, so it must never be consulted first. */
    const darkName = (v) => v === 'dark' || v === 'midnight' || v === 'midnight-academic';
    const lightName = (v) => v === 'light' || v === 'green' || v === 'emerald-glass' || v === 'ivory-academic';
    try {
      const t = document.documentElement.getAttribute('data-theme')
        || (document.body && document.body.getAttribute('data-theme')) || '';
      if (darkName(t)) return 'dark';
      if (lightName(t)) return 'light';
    } catch (_) {}
    try { if (darkName(localStorage.getItem('admission_theme_v1'))) return 'dark'; } catch (_) {}
    try {
      const r = (window.AhAppearance && typeof window.AhAppearance.resolved === 'function')
        ? window.AhAppearance.resolved() : '';
      if (darkName(r)) return 'dark';
    } catch (_) {}
    return 'light';
  }
  /* AhAppearance.apply() REMOVES <html data-theme> whenever its own key says
     light - which is its default - so calling it from the chat wiped phase1's
     midnight theme out from under the app. With the attribute gone, phase1's
     [data-theme="midnight-academic"] overrides stopped matching and every input
     fell back to phase1's :root --glass-strong of rgba(255,255,255,.88), which
     its global input,textarea,select{background:...!important} rule then painted
     over the composer and the drawer search box. Re-assert phase1's pick after. */
  function syncAppChrome() {
    try { if (window.AhAppearance && window.AhAppearance.apply) window.AhAppearance.apply(); } catch (_) {}
    try { if (typeof window.applyTheme === 'function') window.applyTheme(); } catch (_) {}
  }
  function paintTheme() {
    const r = appResolved();
    const app = document.getElementById('app');
    if (app) app.setAttribute('data-sky-theme', r);
    syncThemeBtns(r);
    try {
      const c = r === 'dark' ? '#0B1020' : '#F6F9FF';
      document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute('content', c));
    } catch (_) {}
  }
  function syncThemeBtns(r) {
    const th = document.getElementById('th');
    if (!th) return;
    [...th.children].forEach((b) => {
      const t = b.getAttribute('data-t');
      const on = t === 'auto' ? false : t === r;
      b.classList.toggle('on', on);
    });
  }

  /* ───────── tiny helpers ───────── */
  const $ = (s, r) => (r || document).querySelector(s);
  const ic = (n, c) => '<svg class="i ' + (c || '') + '"><use href="#' + n + '"/></svg>';
  const pick = (a) => a[Math.random() * a.length | 0];
  const bn = (n) => String(n).replace(/\d/g, (d) => '০১২৩৪৫৬৭৮৯'[d]);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  let guestMemo = '';
  const guestId = () => {
    if (guestMemo) return guestMemo;
    let v = '';
    try { v = crypto.randomUUID(); } catch (_) {
      const b = new Uint8Array(18);
      try { crypto.getRandomValues(b); } catch (_) { for (let i = 0; i < b.length; i++) b[i] = Math.floor(Math.random() * 256); }
      v = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
    }
    guestMemo = v;
    return v;
  };

  /* Academic-only context. Identity fields are never read here; the server
     re-sanitizes. Guests send null. */
  function profilePayload() {
    try {
      const pid = localStorage.getItem('ah-profile-cache-key');
      if (!pid) return null;
      const entry = JSON.parse(localStorage.getItem('ah-profile-cache:' + pid) || 'null');
      const p = entry && entry.profile;
      if (!p || typeof p !== 'object') return null;
      const text = (v, max) => (typeof v === 'string' ? v.replace(/[\r\n\u0000<>]/g, '').trim().slice(0, max) : '');
      const school = p.school && typeof p.school === 'object' && p.school.name ? p.school : null;
      const higher = p.higherInstitution && typeof p.higherInstitution === 'object' && p.higherInstitution.name ? p.higherInstitution : null;
      const inst = higher || school;
      const out = {
        firstName: text(String(p.fullName || '').split(/\s+/)[0], 40),
        institutionName: inst ? text(inst.name, 120) : '',
        institutionType: inst ? (inst === higher ? 'college' : 'school') : '',
        district: inst ? text(inst.district, 60) : '',
        admissionSession: text(p.admissionSession, 40),
        academicGoal: text(p.academicGoal, 80),
        subjects: Array.isArray(p.subjects) ? p.subjects.slice(0, 10).map((s) => text(s, 40)).filter(Boolean) : [],
        targets: Array.isArray(p.targets) && p.targets[0] ? [{ name: text(p.targets[0].name, 120), unit: text(p.targets[0].unit, 40), year: text(p.targets[0].year, 40) }] : []
      };
      const any = out.firstName || out.institutionName || out.admissionSession || out.academicGoal || out.subjects.length || out.targets.length;
      return any ? out : null;
    } catch (_) { return null; }
  }

  /* Per-topic accuracy from the student's own result snapshots, so the tutor can
     say "your accuracy here is low, revise this". Only academic names leave the
     device. */
  const P06_TOPIC_MIN_ATTEMPTS = 3;
  const P06_WEAK_ACC = 70;
  const learningProfile = () => {
    try {
      if (typeof CACHE === 'undefined' || !Array.isArray(CACHE.examResults)) return { weakTopics: [], subjects: [] };
      const nameOf = (fn, id) => { try { return typeof fn === 'function' ? String(fn(id) || '').trim() : ''; } catch (_) { return ''; } };
      const topics = {}, subjects = {};
      for (const r of CACHE.examResults) {
        for (const q of (Array.isArray(r && r.snapshot) ? r.snapshot : [])) {
          const st = q && q.status;
          if (st !== 'correct' && st !== 'wrong') continue;
          const tn = nameOf(typeof topicName === 'function' ? topicName : null, q.topicId);
          if (tn && tn !== '\u2014') { const t = topics[tn] || (topics[tn] = { attempts: 0, correct: 0 }); t.attempts++; if (st === 'correct') t.correct++; }
        }
      }
      const weakTopics = Object.keys(topics)
        .filter((k) => topics[k].attempts >= P06_TOPIC_MIN_ATTEMPTS)
        .map((k) => ({ name: k, accuracy: Math.round((topics[k].correct / topics[k].attempts) * 100) }))
        .filter((t) => t.accuracy < P06_WEAK_ACC)
        .sort((a, b) => a.accuracy - b.accuracy)
        .slice(0, 5);
      return { weakTopics, subjects: Object.keys(subjects) };
    } catch (_) { return { weakTopics: [], subjects: [] }; }
  };

  /* Lifetime stats from the app's own store. Returns null when the host page
     does not expose them, the server then answers without personal stats. */
  function localStats() {
    try {
      if (typeof computeLifetimeStats !== 'function') return null;
      const s = computeLifetimeStats();
      const lp = learningProfile();
      const out = {
        exams: Number(s.exams || 0),
        questions: Number(s.totalQuestions || s.attempted || 0),
        accuracy: Number(s.accuracy || 0),
        streak: typeof computeStreak === 'function' ? Number(computeStreak() || 0) : 0,
        mistakes: typeof CACHE !== 'undefined' && Array.isArray(CACHE.mistakes) ? CACHE.mistakes.length : Number(s.wrong || 0),
        weakTopics: lp.weakTopics, subjects: lp.subjects
      };
      return out;
    } catch (_) { return null; }
  }

  /* Sky recall (owner plan step 2): mistakes the student got wrong in the last
     48 h and has not mastered yet. Only a count and the oldest time leave the
     phone, never the question text. */
  function recentMistakes() {
    try {
      if (typeof CACHE === 'undefined' || !Array.isArray(CACHE.mistakes)) return null;
      const cut = Date.now() - 48 * 3600 * 1000;
      let n = 0, since = 0;
      CACHE.mistakes.forEach((m) => {
        if (!m || m.mastered === true || m.revisionStatus === 'mastered') return;
        const t = Number(m.lastWrongAt || m.time || 0);
        if (!(t >= cut)) return;
        n++;
        if (!since || t < since) since = t;
      });
      return { mistakes: n, since: since };
    } catch (_) { return null; }
  }

  /* ───────── markdown → safe HTML (escape-first) ───────── */
  function mdInline(raw) {
    const codes = [];
    let s = String(raw).replace(/`([^`\n]+)`/g, (m, c) => { codes.push(c); return '\u0002C' + (codes.length - 1) + '\u0002'; });
    s = esc(s);
    s = s.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
    s = s.replace(/==([^=\n]+)==/g, '<mark>$1</mark>');
    s = s.replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>').replace(/__([^_\n]+)__/g, '<b>$1</b>');
    s = s.replace(/(^|[^*\w])\*([^*\n]+)\*(?!\*)/g, '$1<i>$2</i>');
    s = s.replace(/~~([^~\n]+)~~/g, '<s>$1</s>');
    return s.replace(/\u0002C(\d+)\u0002/g, (m, i) => '<code>' + esc(codes[+i]) + '</code>');
  }
  const MD_CAL = { '✅': 'ok', '📌': 'key', '🧠': 'con', '📚': 'rev', '💡': 'tip', '⚠️': 'warn', '❗': 'warn', '🎯': 'key', '📝': 'rev', '🔑': 'key' };
  const MD_CAL_RE = /^(✅|📌|🧠|📚|💡|⚠️|❗|🎯|📝|🔑)\s*(.+)$/;
  const MD_SEP_RE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;
  const MD_LIST_RE = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
  const mdCells = (line) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
  function mdBlocks(lines) {
    const out = [];
    let para = [];
    const flush = () => { if (para.length) { out.push('<p>' + para.map(mdInline).join('<br>') + '</p>'); para = []; } };
    let i = 0;
    while (i < lines.length) {
      const L = lines[i];
      let m = L.match(/^\s*```\s*([\w-]*)\s*$/);
      if (m) {
        flush();
        const buf = []; i++;
        while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) { buf.push(lines[i]); i++; }
        i++;
        out.push((m[1] ? '<pre data-lang="' + esc(m[1]) + '"><code>' : '<pre><code>') + esc(buf.join('\n')) + '</code></pre>');
        continue;
      }
      if (!L.trim()) { flush(); i++; continue; }
      if (/^\s*\u0001V\d+\u0001\s*$/.test(L)) { flush(); out.push(L.trim()); i++; continue; }
      m = L.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
      if (m) {
        flush();
        const n = m[1].length;
        const tag = n <= 2 ? 'h2' : n === 3 ? 'h3' : 'h4';
        out.push('<' + tag + (n === 1 ? ' class="h1"' : '') + '>' + mdInline(m[2]) + '</' + tag + '>');
        i++; continue;
      }
      if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(L)) { flush(); out.push('<hr>'); i++; continue; }
      if (L.indexOf('|') >= 0 && i + 1 < lines.length && MD_SEP_RE.test(lines[i + 1]) && lines[i + 1].indexOf('-') >= 0) {
        flush();
        const head = mdCells(L);
        const al = mdCells(lines[i + 1]).map((c) => /^:-+:$/.test(c) ? 'center' : /-+:$/.test(c) ? 'right' : '');
        const st = (k) => al[k] ? ' style="text-align:' + al[k] + '"' : '';
        let html = '<div class="tw"><table><thead><tr>' + head.map((c, k) => '<th' + st(k) + '>' + mdInline(c) + '</th>').join('') + '</tr></thead><tbody>';
        i += 2;
        while (i < lines.length && lines[i].indexOf('|') >= 0 && lines[i].trim()) {
          const r = mdCells(lines[i]);
          html += '<tr>' + head.map((_, k) => '<td' + st(k) + '>' + mdInline(r[k] == null ? '' : r[k]) + '</td>').join('') + '</tr>';
          i++;
        }
        out.push(html + '</tbody></table></div>');
        continue;
      }
      if (/^\s*>/.test(L)) {
        flush();
        const buf = [];
        while (i < lines.length && /^\s*>/.test(lines[i])) { buf.push(lines[i].replace(/^\s*>\s?/, '')); i++; }
        out.push('<blockquote>' + mdBlocks(buf) + '</blockquote>');
        continue;
      }
      m = L.match(MD_CAL_RE);
      if (m) { flush(); out.push('<div class="cal ' + MD_CAL[m[1]] + '"><b>' + m[1] + '</b> ' + mdInline(m[2]) + '</div>'); i++; continue; }
      if (MD_LIST_RE.test(L)) {
        flush();
        const items = [];
        while (i < lines.length) {
          const lm = lines[i].match(MD_LIST_RE);
          if (lm) { items.push({ ind: lm[1].replace(/\t/g, '  ').length, ord: /\d/.test(lm[2]), text: lm[3] }); i++; continue; }
          if (lines[i].trim() && /^\s{2,}\S/.test(lines[i]) && items.length) { items[items.length - 1].text += ' ' + lines[i].trim(); i++; continue; }
          break;
        }
        let html = '';
        const stack = [];
        for (const it of items) {
          while (stack.length && it.ind < stack[stack.length - 1].ind) { html += '</li></' + stack.pop().tag + '>'; }
          if (stack.length && it.ind === stack[stack.length - 1].ind && stack[stack.length - 1].tag !== (it.ord ? 'ol' : 'ul')) { html += '</li></' + stack.pop().tag + '>'; }
          if (!stack.length || it.ind > stack[stack.length - 1].ind) { const tag = it.ord ? 'ol' : 'ul'; stack.push({ ind: it.ind, tag }); html += '<' + tag + '>'; }
          else html += '</li>';
          const task = it.text.match(/^\[( |x|X)\]\s+(.*)$/);
          html += task ? '<li class="task"><span class="ck' + (task[1] === ' ' ? '' : ' on') + '">' + (task[1] === ' ' ? '' : '✓') + '</span>' + mdInline(task[2]) : '<li>' + mdInline(it.text);
        }
        while (stack.length) html += '</li></' + stack.pop().tag + '>';
        out.push(html);
        continue;
      }
      para.push(L);
      i++;
    }
    flush();
    return out.join('');
  }
  function md(src) {
    const lines = String(src == null ? '' : src).replace(/\r\n?/g, '\n').split('\n');
    return '<div class="body">' + mdBlocks(lines) + '</div>';
  }


  /* ───────── interactive visuals: charts + flow diagrams (student data / AI blocks) ─────────
     Charts and flows are drawn from THIS student's own local stats, or from an
     explicit ```chart / ```flow block in the AI answer. Nothing is invented. */
  function ahChartSVG(a) {
    const W = 320, H = 150, P = 26;
    const nums = (a.values || []).map((v) => Math.max(0, Number(v) || 0));
    if (!nums.length) return '';
    const max = Math.max(...nums, 1), iw = W - P * 2, ih = H - P - 18;
    const gid = 'g' + Math.random().toString(36).slice(2, 8);
    const grid = [0.25, 0.5, 0.75, 1].map((f) => { const y = (P + ih - ih * f).toFixed(1); return '<line x1="' + P + '" y1="' + y + '" x2="' + (W - P) + '" y2="' + y + '" class="cg"/>'; }).join('');
    let body = '';
    if ((a.type || 'bar') === 'line') {
      const pts = nums.map((v, i) => (P + (nums.length === 1 ? iw / 2 : iw * i / (nums.length - 1))).toFixed(1) + ',' + (P + ih - ih * v / max).toFixed(1)).join(' ');
      body = '<polyline points="' + pts + '" class="cl"/><polygon points="' + P + ',' + (P + ih) + ' ' + pts + ' ' + (W - P) + ',' + (P + ih) + '" fill="url(#' + gid + ')" opacity=".35"/><circle cx="' + pts.split(' ').slice(-1)[0].split(',')[0] + '" cy="' + pts.split(' ').slice(-1)[0].split(',')[1] + '" r="4" class="cp"/>';
    } else {
      const bw = iw / nums.length;
      body = nums.map((v, i) => { const h = Math.max(4, ih * v / max), x = (P + i * bw + bw * .18).toFixed(1), y = (P + ih - h).toFixed(1); return '<rect x="' + x + '" y="' + y + '" width="' + (bw * .64).toFixed(1) + '" height="' + h.toFixed(1) + '" rx="6" class="cfr"/><text x="' + (P + i * bw + bw / 2).toFixed(1) + '" y="' + (H - 4) + '" class="cx">' + esc(String((a.labels || [])[i] || (i + 1)).slice(0, 8)) + '</text><text x="' + (P + i * bw + bw / 2).toFixed(1) + '" y="' + (y - 5).toFixed(1) + '" class="cv">' + bn(Math.round(v)) + '</text>'; }).join('');
    }
    return '<figure class="viz"><figcaption>' + esc(a.title || 'চার্ট') + '</figcaption><svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(a.title || 'chart') + '"><defs><linearGradient id="' + gid + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3D6BFF"/><stop offset="1" stop-color="#3D6BFF" stop-opacity="0"/></linearGradient></defs>' + grid + body + '</svg></figure>';
  }
  function ahFlowSVG(steps) {
    const rows = (steps || []).map((x) => String(x || '').trim()).filter(Boolean).slice(0, 8);
    if (rows.length < 2) return '';
    const W = 320, rh = 40, H = rows.length * rh + 10;
    const body = rows.map((t, i) => { const y = 6 + i * rh; return '<g><rect x="46" y="' + y + '" width="228" height="30" rx="15" class="fb"/><text x="160" y="' + (y + 19) + '" class="ft">' + esc(t.slice(0, 42)) + '</text>' + (i < rows.length - 1 ? '<path d="M160 ' + (y + 30) + 'v8m0 0l-4-5m4 5l4-5" class="fa"/>' : '') + '</g>'; }).join('');
    return '<figure class="viz flowz"><figcaption>ধাপে ধাপে</figcaption><svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="flow diagram">' + body + '</svg></figure>';
  }
  function ahStudentChart() {
    try {
      const st = (typeof localStats === 'function') ? localStats() : null;
      if (!st) return '';
      const weak = (st.weakTopics || []).filter((t) => t && t.name);
      if (weak.length >= 2) return ahChartSVG({ type: 'bar', title: 'তোমার দুর্বল টপিক, Accuracy %', labels: weak.map((t) => t.name), values: weak.map((t) => t.accuracy) });
      if (Number(st.questions) > 0) return ahChartSVG({ type: 'bar', title: 'তোমার অগ্রগতি', labels: ['প্রশ্ন', 'সঠিক হার %', 'পরীক্ষা'], values: [st.questions, st.accuracy, st.exams] });
    } catch (_) {}
    return '';
  }
  /* Owner 2026-10-18: quiz mode answers are JSON ({"title","questions":[{q,options,answer,explanation}]}).
     Show them as a tap-to-answer card, never as raw JSON. While the JSON is still
     streaming (not parseable yet) show a short "making questions" line. */
  function quizJson(src) {
    const s = String(src == null ? '' : src).trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
    if (!/^\{\s*"(title|questions)"/.test(s)) return null;
    try {
      const j = JSON.parse(s);
      const qs = (j && Array.isArray(j.questions) ? j.questions : []).filter((x) => x && (x.q || x.question) && Array.isArray(x.options) && x.options.length > 1);
      return qs.length ? { title: String(j.title || 'কুইজ'), qs } : { pending: true };
    } catch (_) { return { pending: true }; }
  }
  function quizCard(src) {
    const j = quizJson(src);
    if (!j) return null;
    if (j.pending) return '<div class="body md"><p class="qzw">⏳ ' + esc(T.stageQuiz) + '…</p></div>';
    const L = 'কখগঘঙচ';
    const items = j.qs.map((x, n) => {
      const a = Number.isInteger(x.answer) ? x.answer : Number(x.answer);
      const opts = x.options.map((o, i) => '<button type="button" class="qb" data-qo="' + i + '"><span>' + (L[i] || i + 1) + '</span>' + esc(o) + '</button>').join('');
      const ex = x.explanation ? '<div class="qx" hidden>💡 ' + esc(x.explanation) + '</div>' : '';
      return '<div class="qz" data-qa="' + (a >= 0 ? a : -1) + '"><p class="qq"><b>' + String(n + 1).replace(/[0-9]/g, (d) => '০১২৩৪৫৬৭৮৯'[d]) + '.</b> ' + esc(x.q || x.question) + '</p><div class="qo">' + opts + '</div>' + ex + '</div>';
    }).join('');
    return '<div class="body md"><h3>📝 ' + esc(j.title) + '</h3>' + items + '<p class="qs" hidden></p></div>';
  }
  function quizTap(btn) {
    const box = btn.closest('.qz');
    if (!box || box.classList.contains('done')) return;
    const pick = +btn.getAttribute('data-qo'), ans = +box.getAttribute('data-qa');
    box.classList.add('done');
    box.querySelectorAll('.qb').forEach((b) => { const i = +b.getAttribute('data-qo'); b.disabled = true; if (i === ans) b.classList.add('ok'); else if (i === pick) b.classList.add('no'); });
    const ex = box.querySelector('.qx'); if (ex) ex.hidden = false;
    if (pick === ans) box.classList.add('right');
    mood(pick === ans ? 'nod' : 'oops', 1300);
    const card = box.parentNode, all = card.querySelectorAll('.qz'), done = card.querySelectorAll('.qz.done');
    if (all.length && all.length === done.length) {
      const bn = (v) => String(v).replace(/[0-9]/g, (d) => '০১২৩৪৫৬৭৮৯'[d]);
      const right = card.querySelectorAll('.qz.right').length; setTimeout(() => mood(right === all.length ? 'cheer' : (right * 2 >= all.length ? 'happy' : 'think'), 1800), 900);
      const sc = card.querySelector('.qs'); if (sc) { sc.hidden = false; sc.textContent = '🎯 তোমার স্কোর: ' + bn(card.querySelectorAll('.qz.right').length) + '/' + bn(all.length); }
    }
  }
  function mdRich(src) {
    const qz = quizCard(src); if (qz !== null) return qz;
    let t = String(src == null ? '' : src);
    const visuals = [];
    t = t.replace(/```(chart|flow)\s*\n([\s\S]*?)```/gi, (m, kind, body) => {
      try {
        if (kind.toLowerCase() === 'flow') { const v = ahFlowSVG(body.split('\n')); if (v) visuals.push(v); }
        else { const j = JSON.parse(body); const v = ahChartSVG(j); if (v) visuals.push(v); }
      } catch (_) {}
      return '\u0001V' + (visuals.length - 1) + '\u0001';
    });
    let out = md(t).replace(/\u0001V(\d+)\u0001/g, (m, i) => visuals[+i] || '');
    if (/পারফরম্যান্স|অগ্রগতি|accuracy|performance|দুর্বল/i.test(t) && !visuals.length) { const c = ahStudentChart(); if (c) out += c; }
    return out.replace('<div class="body">', '<div class="body md">');
  }
  try {
    const st = document.createElement('style'); st.id = 'skyVizCss';
    st.textContent = '#app.sky .md{--h2c:#3D6BFF;--h3c:#7C4DFF;--h4c:#0E9F9A;--bc:#1B2F8F;--ic:#B4530F;--mk:rgba(255,182,61,.38);--cc:#B0179F;--vio:#7C4DFF;--vioS:rgba(124,77,255,.08);font-size:17.5px;line-height:1.8;color:var(--ink)}#app.sky[data-sky-theme="dark"] .md{--h2c:#9DB6FF;--h3c:#C4B2FF;--h4c:#6FE0D6;--bc:#C9D7FF;--ic:#FDBA74;--mk:rgba(255,182,61,.3);--cc:#F2A8F7;--vioS:rgba(124,77,255,.16)}#app.sky .md p{margin:0 0 12px}#app.sky .md>p:last-child{margin-bottom:0}#app.sky .md h2{font-size:21px;line-height:1.4;font-weight:800;margin:20px 0 10px;color:var(--h2c)}#app.sky .md h2.h1{font-size:23px}#app.sky .md>h2:first-child,#app.sky .md>h3:first-child{margin-top:4px}#app.sky .md h3{font-size:18.5px;line-height:1.45;font-weight:700;margin:18px 0 8px;color:var(--h3c);padding-left:10px;border-left:4px solid var(--h3c)}#app.sky .md h4{font-size:17px;font-weight:700;margin:14px 0 6px;color:var(--h4c)}#app.sky .md b{color:var(--bc);font-weight:700}#app.sky .md i{color:var(--ic)}#app.sky .md mark{background:var(--mk);color:inherit;padding:1px 5px;border-radius:6px}#app.sky .md s{opacity:.7}#app.sky .md code{font-size:.88em;background:var(--soft);color:var(--cc);padding:1px 6px;border-radius:6px}#app.sky .md pre{background:#0F1630;color:#E6ECFF;padding:12px 14px;border-radius:14px;overflow:auto;font-size:14px;line-height:1.6;margin:12px 0}#app.sky .md pre code{background:none;color:inherit;padding:0}#app.sky .md ul,#app.sky .md ol{margin:6px 0 12px;padding-left:24px}#app.sky .md li{margin:5px 0}#app.sky .md li::marker{color:var(--h2c);font-weight:700}#app.sky .md li li::marker{color:var(--h4c)}#app.sky .md li.task{list-style:none;margin-left:-22px}#app.sky .md .ck{display:inline-grid;place-items:center;width:18px;height:18px;border-radius:5px;border:2px solid var(--h2c);margin-right:8px;font-size:12px;line-height:1;vertical-align:-3px;color:#fff}#app.sky .md .ck.on{background:var(--ok);border-color:var(--ok)}#app.sky .md blockquote{margin:12px 0;padding:10px 14px;border-left:4px solid var(--vio);background:var(--vioS);border-radius:0 14px 14px 0}#app.sky .md blockquote p{margin:0}#app.sky .md hr{border:0;height:2px;background:linear-gradient(90deg,transparent,var(--line),transparent);margin:18px 0}#app.sky .md .tw{overflow-x:auto;margin:12px 0;border-radius:14px;box-shadow:0 0 0 1px var(--line)}#app.sky .md table{border-collapse:collapse;width:100%;font-size:15px}#app.sky .md th{background:var(--grad);color:#fff;font-weight:700;padding:9px 12px;text-align:left;white-space:nowrap}#app.sky .md td{padding:9px 12px;border-top:1px solid var(--line);color:var(--ink)}#app.sky .md tbody tr:nth-child(even) td{background:var(--soft)}#app.sky .md a{color:var(--h2c);text-decoration:underline}#app.sky .md .cal{font-size:16px;line-height:1.7;border-left:4px solid;border-radius:0 14px 14px 0;padding:10px 14px;margin:10px 0}#app.sky .md .cal.tip{background:rgba(255,182,61,.14);border-color:#FFB63D}#app.sky .md .cal.warn{background:rgba(229,72,77,.1);border-color:#E5484D}#app.sky .md .cal.ok{background:rgba(18,163,107,.1);border-color:#12A36B}#app.sky .md .cal.con{background:var(--vioS);border-color:var(--vio)}#app.sky .md .cal.rev{background:rgba(14,159,154,.1);border-color:#0E9F9A}#app.sky .md .cal.key{background:rgba(61,107,255,.1);border-color:#3D6BFF}#app.sky .md .cal b{color:inherit}#app.sky .md{font-size:17.5px;line-height:1.8}#app.sky .md h2,#app.sky .md h3{letter-spacing:-.01em}#app.sky .md table{font-size:14px}#app.sky .md th{background:var(--soft);color:var(--mute)}#app.sky .md td{color:var(--ink)}#app.sky .viz{margin:12px 0;padding:12px 12px 6px;border-radius:18px;background:var(--surf);box-shadow:0 0 0 1px var(--line)}#app.sky .viz figcaption{font-size:13px;font-weight:700;color:var(--ink);margin-bottom:6px}#app.sky .viz svg{width:100%;height:auto;display:block}#app.sky .viz .cg{stroke:var(--chart-grid,var(--line));stroke-width:1}#app.sky .viz .cl{fill:none;stroke:#3D6BFF;stroke-width:3;stroke-linecap:round;stroke-linejoin:round}#app.sky .viz .cp{fill:#3D6BFF;stroke:var(--surf);stroke-width:2}#app.sky .viz .cfr{fill:#3D6BFF;opacity:.88}#app.sky .viz .cx{fill:var(--mute);font-size:9px;text-anchor:middle}#app.sky .viz .cv{fill:var(--ink);font-size:10px;font-weight:700;text-anchor:middle}#app.sky .viz .fb{fill:var(--soft);stroke:var(--line)}#app.sky .viz .ft{fill:var(--ink);font-size:11.5px;font-weight:600;text-anchor:middle}#app.sky .viz .fa{stroke:#3D6BFF;stroke-width:2;fill:none;stroke-linecap:round;stroke-linejoin:round}#app.sky .md .qz{margin:12px 0;padding:12px;border-radius:16px;background:var(--surf);box-shadow:0 0 0 1px var(--line)}#app.sky .md .qq{margin:0 0 10px;font-weight:600}#app.sky .md .qo{display:grid;gap:8px}#app.sky .md .qb{display:flex;gap:10px;align-items:center;text-align:left;width:100%;min-height:44px;padding:10px 12px;border-radius:12px;border:1.5px solid var(--line);background:var(--soft);color:var(--ink);font:inherit;font-size:16px;cursor:pointer}#app.sky .md .qb span{flex:none;display:inline-grid;place-items:center;width:26px;height:26px;border-radius:50%;background:var(--surf);font-weight:700;font-size:14px}#app.sky .md .qb.ok{border-color:#12A36B;background:rgba(18,163,107,.14)}#app.sky .md .qb.no{border-color:#E5484D;background:rgba(229,72,77,.12)}#app.sky .md .qb:disabled{cursor:default;opacity:1}#app.sky .md .qx{margin-top:10px;font-size:15.5px;line-height:1.7;padding:8px 12px;border-radius:12px;background:rgba(255,182,61,.14)}#app.sky .md .qs{font-weight:800;font-size:18px;color:var(--h2c);margin-top:8px}#app.sky[data-sky-theme="dark"] .md .qb.ok{background:#123326;border-color:#2BC48A}#app.sky[data-sky-theme="dark"] .md .qb.no{background:#3A1A1C;border-color:#F06A6E}#app.sky[data-sky-theme="dark"] .md .qx{background:#3A2E12}#app.sky[data-sky-theme="dark"] .md pre{background:#070B18}@media (prefers-reduced-motion:no-preference){#app.sky .viz{animation:up .35s both}}';
    document.head.appendChild(st);
  } catch (_) {}

  /* ───────── session store: Firebase-account scoped ─────────
     Chat history is personal. It is keyed by the signed-in account and is never
     written to a shared key, so one student's conversations can never surface in
     another's session on a shared device. Guests get no persistence at all. */
  let sessions = [];
  let cur = 0;
  let accountScope = '';
  const scopedKey = key => accountScope ? key + ':account:' + accountScope : '';
  const scopedRead = (key) => {
    if (!accountScope) return null;
    try { return localStorage.getItem(scopedKey(key)); } catch (_) { return null; }
  };
  const scopedWrite = (key, value) => {
    if (!accountScope) return false;
    try { localStorage.setItem(scopedKey(key), String(value)); return true; } catch (_) { return false; }
  };

  function load() {
    sessions = [{ name: '', msgs: [], ts: Date.now() }]; cur = 0;
    if (accountScope) {
      try {
        const raw = JSON.parse(scopedRead(STORE) || 'null');
        if (raw && raw.v === 1 && Array.isArray(raw.list) && raw.list.length) {
          sessions = raw.list; cur = Math.min(+raw.cur || 0, sessions.length - 1);
        }
      } catch (_) { sessions = [{ name: '', msgs: [], ts: Date.now() }]; cur = 0; }
    }
  }
  function save() {
    /* No account → nothing is written. A guest conversation lives only in memory
       for the length of the visit. */
    if (!accountScope) return;
    try { sessions[cur].msgs = sessions[cur].msgs.slice(-MAX_MSGS); sessions[cur].ts = Date.now(); scopedWrite(STORE, JSON.stringify({ v: 1, list: sessions.slice(0, 20), cur: cur })); } catch (_) {}
  }

  /* Remove the legacy shared-device chat keys once. They were not bound to an
     account and must never leak into a newly signed-in student's history. */
  try { [STORE, 'ahAiGuestV1'].forEach(key => localStorage.removeItem(key)); } catch (_) {}

  window.addEventListener('admissionhub:authchange', (event) => {
    const detail = (event && event.detail) || {};
    const nextScope = detail.authenticated === true && /^[A-Za-z0-9_-]{8,128}$/.test(String((detail.user && detail.user.id) || ''))
      ? String(detail.user.id)
      : '';
    if (nextScope === accountScope) return;
    if (accountScope) {
      try { sessions[cur].msgs = sessions[cur].msgs.slice(-MAX_MSGS); scopedWrite(STORE, JSON.stringify({ v: 1, list: sessions.slice(0, 20), cur: cur })); } catch (_) {}
    }
    accountScope = nextScope;
    guestMemo = '';
    load();
    if (document.getElementById('msgs')) { renderMsgs(); if (!sessions[cur].msgs.length) resetHero(); }
  });

  /* ───────── live backend: SSE tutor ───────── */
  let activeReq = null;
  let streaming = false;

  async function ask(messages, onChunk, opts, onReplace) {
    opts = opts || {};
    const fresh = opts.fresh != null ? opts.fresh : messages.filter((m) => m.role === 'user').length <= 1;
    const payload = { messages: messages, fresh: fresh, context: { stats: localStats(), profile: profilePayload(), examMode: opts.mode || null } };
    const ctrl = new AbortController();
    activeReq = ctrl;
    let r;
    try {
      r = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-AH-Guest': guestId() },
        body: JSON.stringify(payload),
        signal: ctrl.signal
      });
    } catch (e) { activeReq = null; return { ok: false, code: 'offline' }; }
    if (!r.ok || !r.body) {
      activeReq = null;
      let detail = null; try { detail = await r.json(); } catch (_) {}
      return { ok: false, code: 'http', status: r.status, meta: detail };
    }
    const reader = r.body.getReader();
    const dec = new TextDecoder();
    let buf = '', full = '', meta = null, failed = null;
    while (true) {
      let step;
      try { step = await reader.read(); } catch (_) { break; }
      if (step.done) break;
      buf += dec.decode(step.value, { stream: true });
      const parts = buf.split('\n\n');
      buf = parts.pop() || '';
      for (const part of parts) {
        let evt = '';
        for (const line of part.split('\n')) {
          const t = line.trim();
          if (t.startsWith('event:')) { evt = t.slice(6).trim(); continue; }
          if (!t.startsWith('data:')) continue;
          let j = null; try { j = JSON.parse(t.slice(5).trim()); } catch (_) { continue; }
          if (evt === 'stage') { if (j.label && opts.onStage) { try { opts.onStage(String(j.label)); } catch (_) {} } continue; }
          if (evt === 'replace' && typeof j.text === 'string') { full = j.text; if (onReplace) onReplace(full); else onChunk(full, true); }
          else if (j.text) { full += j.text; onChunk(full, false); }
          else if (j.error) failed = { message: j.message, retryable: j.retryable };
          else if (j.model || j.provider || j.intent) meta = { model: j.model, provider: j.provider, intent: j.intent };
        }
      }
    }
    activeReq = null;
    if (failed && !full) return { ok: false, code: 'ai', meta: failed };
    return { ok: true, text: full, meta: meta };
  }

  /* The server may correct text that already streamed (event: replace). A
     corrected answer is untrusted content arriving mid-render, so it is written
     with textContent and never re-parsed as markup. */
  let liveNode = null;
  function replaceStream(text) {
    const bw = liveNode && liveNode.querySelector('.bw');
    if (!bw) return;
    bw.textContent = '';
    const p = document.createElement('p');
    p.textContent = text;
    bw.appendChild(p);
    scrollEnd();
  }

  /* ───────── UI strings (no demo content) ───────── */
  const T = {
    stageRead: 'তোমার প্রশ্ন বুঝে নিচ্ছি', stageWrite: 'উত্তর লিখছি', stageConnect: 'সার্ভারের সঙ্গে যুক্ত হচ্ছি', stageSend: 'প্রশ্ন পাঠাচ্ছি', stageFirst: 'প্রথম অংশ এসেছে', stageStream: 'উত্তর আসছে', stageChart: 'ছবি/চার্ট সাজাচ্ছি', stageQuiz: 'প্রশ্ন তৈরি করছি', stageDone: 'উত্তর তৈরি',
    title: 'Sky', sub: 'স্টাডি পার্টনার', online: 'অনলাইন',
    heroTitle: 'আমি স্কাই, তোমার পড়ার সঙ্গী',
    heroBody: 'ভর্তি প্রস্তুতির প্রশ্ন, MCQ, ব্যাখ্যা আর পড়ার সব সাহায্য, সব এখানে।',
    notice: 'স্কাইয়ের উত্তরে ভুল হতে পারে। ভর্তির গুরুত্বপূর্ণ তথ্য অফিসিয়াল সূত্রে যাচাই করুন।',
    tryAsking: 'জিজ্ঞেস করে দেখো',
    chips: [
      ['🧠', 'সহজ করে বুঝাও', 'এই টপিকটা সহজ করে বুঝাও'],
      ['📝', '১০টা MCQ বানাও', '১০টা MCQ বানাও'],
      ['🎯', 'কুইজ নাও', 'আমাকে কুইজ নাও, ৫টা প্রশ্ন'],
      ['📊', 'পারফরম্যান্স দেখো', 'আমার পারফরম্যান্স বিশ্লেষণ করো'],
      ['📚', 'টপিক শেখাও', 'এই টপিকটা শেখাও']
    ],
    ph: 'স্কাইকে জিজ্ঞেস করো…',
    thinking: 'ভাবছি', writing: 'লিখছি', searching: 'খুঁজছি',
    newChat: 'নতুন চ্যাট', recent: 'আগের কথোপকথন', none: 'এখনো কোনো কথোপকথন নেই',
    noHit: 'কিছু পাওয়া যায়নি', untitled: 'নতুন চ্যাট',
    copy: 'কপি', copied: 'কপি হয়েছে', regen: 'আবার', good: 'ভালো',
    backHome: 'অ্যাপে ফিরুন', homeBtn: 'অ্যাপের হোমে ফিরুন',
    tools: 'স্কাই টুলস', attach: 'কথোপকথনে যোগ করুন',
    offline: 'এখন ইন্টারনেট নেই, একটু পরে আবার চেষ্টা করো।',
    failed: 'উত্তরটা আসেনি। আবার চেষ্টা করো।',
    needLoginLong: [
      'স্কাই উত্তর দিতে পারেনি, কারণ তুমি এখনো লগইন করোনি।',
      '',
      'লগইন ছাড়া স্কাই তোমার পড়ার অগ্রগতি, ভুলের তালিকা বা লক্ষ্য দেখতে পায় না, তাই সে জানেই না তুমি কোন বিষয়ে কতটা এগিয়েছ। শুধু এই কারণেই উত্তরটা আসেনি; কোনো সমস্যা হয়নি।',
      '',
      'লগইন করলে স্কাই তোমার নিজের তথ্য অনুযায়ী উত্তর দিতে পারবে, কোন বিষয়ে দুর্বল, কী অনুশীলন করা দরকার, কোনটা আগে পড়া উচিত।'
    ].join('\n'),
    stopped: 'থামানো হয়েছে', stop: 'থামাও', send: 'পাঠাও', menu: 'মেনু',
    clear: 'সব মুছো', del: 'ডিলিট', pin: 'পিন', ren: 'নাম বদলাও', search: 'খুঁজুন',
    actTitle: 'নিশ্চিত করো', actConfirmQ: 'সেভ করবো?', actYes: 'হ্যাঁ', actNo: 'না',
    actApplied: 'সেভ হয়েছে', actCancelled: 'বাতিল', actExpired: 'সময় শেষ',
    actFail: 'সেভ করা যায়নি', actOffline: 'অফলাইন', actOnly: 'শুধু তোমার', actPending: 'অপেক্ষায়',
    needLogin: 'এটার জন্য লগইন করতে হবে'
  };
  /* English mirror. The language engine flips the page; the chat carries its own
     table so a switch never leaves half the UI in Bengali. */
  const T_EN = {
    actTitle: 'Confirm', actConfirmQ: 'Save this?', actYes: 'Yes', actNo: 'No',
    actApplied: 'Saved', actCancelled: 'Cancelled', actExpired: 'Expired',
    actFail: 'Could not save', actOffline: 'Offline', actOnly: 'Only for you', actPending: 'Pending',
    needLogin: 'Please sign in for this'
  };
  const lang = (() => { try { return localStorage.getItem('ahLang') === 'en' ? 'en' : 'bn'; } catch (_) { return 'bn'; } })();
  if (lang === 'en') Object.assign(T, T_EN);

  /* ───────── styles (scoped to #app.sky) ───────── */
  const CSS = `
#app.sky{--bg:#F6F9FF;--surf:#fff;--ink:#0F1B3D;--mute:#6B7799;--line:#E4EAF7;--field:#fff;--field-line:#E4EAF7;--chart-grid:#DCE6FB;--pri:#3D6BFF;--pri2:#5AA9FF;--soft:#EDF2FF;--sun:#FFB63D;--ok:#12A36B;--bad:#E5484D;--grad:linear-gradient(135deg,#3D6BFF,#5AA9FF);--sh:0 8px 24px rgba(40,70,160,.08);--sh2:0 14px 34px rgba(61,107,255,.22);box-sizing:border-box;padding-top:env(safe-area-inset-top,0px)}
#app.sky[data-sky-theme="dark"]{--bg:#0D1326;--surf:#151D3A;--ink:#EEF2FF;--mute:#A6B1D4;--line:#2A3566;--soft:#1C2750;--sh:0 8px 24px rgba(0,0,0,.35);--sh2:0 14px 34px rgba(61,107,255,.3);--field:#0F1730;--field-line:#2A3766;--chart-grid:#24305C}
#app.sky *{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
#app.sky,#app.sky{height:100%;margin:0;background:var(--bg);color:var(--ink);font-family:"Hind Siliguri",system-ui,sans-serif;font-size:16px;-webkit-font-smoothing:antialiased}
#app.sky button,#app.sky input,#app.sky textarea{font:inherit;color:inherit}
#app.sky{color-scheme:light}#app.sky[data-sky-theme="dark"]{color-scheme:dark}
#app.sky button{background:none;border:0;cursor:pointer;padding:0}
#app.sky svg.i{width:22px;height:22px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round;flex:none}
#app.sky{max-width:520px;height:100%;margin:0 auto;display:flex;flex-direction:column;position:relative;overflow:hidden;background:radial-gradient(90% 38% at 50% -6%,var(--soft),transparent 72%),var(--bg)}
/* Sky has no bottom nav, so the shell's 82px nav reserve would float the composer
   far above the true bottom. Drop only that reserve and keep a small breathing
   margin: the shell's --safe-b must survive, or the composer lands under the
   home indicator on a notched phone (owner: "এখন একদম বেশি নিচে হয়ে গেছে").
   Uses the shell's variable, not env(), so the no-save-area guard still holds. */
#app.sky{padding-bottom:calc(8px + var(--safe-b))}
#app.sky header{display:flex;align-items:center;gap:8px;padding:calc(8px) 14px 6px;position:relative;z-index:3;background:transparent;color:var(--ink)}
#app.sky .ib{width:42px;height:42px;border-radius:50%;display:grid;place-items:center;background:var(--surf);box-shadow:0 0 0 1px var(--line),0 2px 6px rgba(40,70,160,.05);transition:transform .15s}
#app.sky .ib:active{transform:scale(.88)}
#app.sky .brand{flex:1;display:flex;align-items:center;gap:6px;min-width:0;padding-left:4px}
#app.sky .hbw{width:0;opacity:0;transition:width .35s,opacity .35s}
#app.sky.chatting .hbw{width:42px;opacity:1}
#app.sky .hbw svg{width:42px;height:42px;cursor:pointer}
#app.sky .brand b{display:block;font-size:18px;font-weight:700;line-height:1.1}
#app.sky .brand small{display:flex;align-items:center;gap:5px;color:var(--mute);font-size:12px}
#app.sky .dot{width:7px;height:7px;border-radius:50%;background:var(--ok);box-shadow:0 0 0 3px rgba(18,163,107,.16)}
#app.sky main{flex:1;overflow-y:auto;overscroll-behavior:contain;padding:0 20px 24px;position:relative;z-index:2;display:flex;flex-direction:column;scroll-behavior:smooth}
#app.sky #msgs{flex:none}
#app.sky .hero{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;padding-bottom:7vh}
#app.sky .bub{height:46px;display:flex;align-items:flex-end}
#app.sky .say{position:relative;max-width:300px;padding:9px 18px;border-radius:999px;background:var(--surf);box-shadow:0 0 0 1px var(--line),var(--sh);font-size:14.5px;font-weight:600;text-align:center;line-height:1.4;opacity:0;transform:translateY(6px) scale(.96);transition:opacity .25s,transform .3s cubic-bezier(.3,1.4,.5,1)}
#app.sky .say:after{content:"";position:absolute;left:50%;bottom:-5px;width:11px;height:11px;margin-left:-5px;background:var(--surf);transform:rotate(45deg);box-shadow:2px 2px 0 0 var(--line)}
#app.sky .say.on{opacity:1;transform:none}
#app.sky .say.long{border-radius:18px;max-width:330px}
#app.sky .recallb{display:block;margin:12px auto 0;border:0;border-radius:999px;padding:8px 16px;font:inherit;font-size:13.5px;font-weight:700;background:var(--surf);box-shadow:0 0 0 1px var(--line),var(--sh);color:inherit;cursor:pointer;animation:drop .5s ease both}
#app.sky .hbig{width:176px;height:176px;cursor:pointer;animation:drop .8s cubic-bezier(.3,1.5,.5,1) both}
@keyframes drop{from{opacity:0;transform:translateY(-40px) scale(.8)}}
#app.sky .av{display:block;overflow:visible}
#app.sky .av .all{transform-origin:100px 190px;animation:fl 3.6s ease-in-out infinite}
#app.sky .av .sh{transform-origin:100px 195px;animation:sd 3.6s ease-in-out infinite}
#app.sky .av .wl{transform-origin:64px 120px;animation:wl 3.6s ease-in-out infinite}
#app.sky .av .wr{transform-origin:136px 120px;animation:wr 3.6s ease-in-out infinite}
#app.sky .av .eyes{transform-origin:100px 104px;animation:bl 5s infinite}
#app.sky .av .pup{transition:transform .2s}
#app.sky .av .br{transition:transform .25s}
#app.sky .av .tas{transform-origin:150px 60px;animation:sw 2.6s ease-in-out infinite}
#app.sky .av .cap{transform-origin:100px 70px}
#app.sky .av .bulb{transform-origin:100px 20px}
#app.sky .av .jaw{transform-origin:100px 134px}
#app.sky .av .pgf{transform-origin:100px 160px}
#app.sky .av .tk,#app.sky .av .sp,#app.sky .av .zz,#app.sky .av .bulb,#app.sky .av .hd{opacity:0}
#app.sky .av .hd{transition:opacity .25s}
#app.sky .av .pr{opacity:0;transform:translateY(12px) scale(.9);transform-origin:100px 170px;transition:opacity .3s,transform .4s cubic-bezier(.3,1.4,.5,1)}
#app.sky .av[data-p=lap] .p-lap,#app.sky .av[data-p=book] .p-book,#app.sky .av[data-p=note] .p-note,#app.sky .av[data-p=cup] .p-cup,#app.sky .av[data-p=mag] .p-mag,#app.sky .av[data-p=calc] .p-calc,#app.sky .av[data-p=ph] .p-ph{opacity:1;transform:none}
#app.sky .av[data-p] .hd{opacity:1}
#app.sky .av[data-p=ph] .hd,#app.sky .av[data-p=zz] .hd,#app.sky .av[data-p=idea] .hd{opacity:0}
#app.sky .av[data-p=cup] .hl2{opacity:0}
#app.sky .av[data-p=zz] .zz{opacity:1;animation:zz 2.4s infinite}
#app.sky .av .steam{animation:st 2s ease-in-out infinite}
#app.sky .av .nt{animation:nt 1.8s ease-in-out infinite}
@keyframes st{50%{transform:translateY(-4px);opacity:.4}}
@keyframes nt{50%{transform:translateY(-10px)}}
#app.sky .av .sp path,#app.sky .av .tk circle{transform-box:fill-box;transform-origin:center}
@keyframes fl{50%{transform:translateY(-6px) rotate(-1.2deg)}}
@keyframes sd{50%{transform:scale(.84);opacity:.08}}
@keyframes wl{50%{transform:rotate(9deg)}}
@keyframes wr{50%{transform:rotate(-9deg)}}
@keyframes bl{0%,92%,100%{transform:scaleY(1)}95%{transform:scaleY(.08)}}
@keyframes sw{50%{transform:rotate(16deg)}}
#app.sky .av[data-s=type] .all{animation:ln 3s ease-in-out infinite}
@keyframes ln{0%,100%{transform:rotate(4deg) translateY(3px)}50%{transform:rotate(2deg) translateY(1px)}}
#app.sky .av[data-s=type] .br{transform:translateY(-5px)}
#app.sky .av[data-s=think] .all{animation:tl 1.8s ease-in-out infinite}
@keyframes tl{0%,100%{transform:rotate(-2deg)}50%{transform:rotate(-6deg)}}
#app.sky .av[data-s=think] .tk{opacity:1}
#app.sky .av[data-s=think] .tk circle{animation:dt 1.2s infinite}
#app.sky .av .tk circle:nth-child(2){animation-delay:.2s!important}
#app.sky .av .tk circle:nth-child(3){animation-delay:.4s!important}
@keyframes dt{50%{transform:scale(1.5);opacity:.4}}
#app.sky .av[data-s=think] .wl{animation:none;transform:rotate(-10deg)}
#app.sky .av[data-s=wave] .wr{animation:wv .4s infinite alternate}
@keyframes wv{from{transform:rotate(-105deg)}to{transform:rotate(-70deg)}}
#app.sky .av[data-s=happy] .all{animation:jp .8s cubic-bezier(.3,1.6,.5,1)}#app.sky .av[data-s=nod] .all{animation:sknod .5s ease-in-out 2}#app.sky .av[data-s=nod] .br{transform:translateY(-4px)}#app.sky .av[data-s=oops] .all{animation:skshake .6s ease-in-out}#app.sky .av[data-s=oops] .br{transform:translateY(3px)}#app.sky .av[data-s=cheer] .all{animation:skcheer .9s cubic-bezier(.3,1.6,.5,1) 2}#app.sky .av[data-s=cheer] .sp{opacity:1}#app.sky .av[data-s=cheer] .wl{animation:hl .2s infinite alternate}#app.sky .av[data-s=cheer] .wr{animation:hr .2s infinite alternate}#app.sky .av[data-s=listen] .all{transform:rotate(-4deg) translateY(-2px);transition:transform .3s}
@keyframes sknod{30%{transform:translateY(4px) rotate(2deg)}60%{transform:translateY(-3px)}}@keyframes skshake{20%,60%{transform:translateX(-5px) rotate(-3deg)}40%,80%{transform:translateX(5px) rotate(3deg)}}@keyframes skcheer{30%{transform:translateY(-30px) rotate(-8deg) scale(1.06)}60%{transform:translateY(-14px) rotate(8deg)}}@keyframes jp{40%{transform:translateY(-26px) scale(1.04,.97)}70%{transform:none}}
#app.sky .av[data-s=happy] .wl{animation:hl .25s infinite alternate}
#app.sky .av[data-s=happy] .wr{animation:hr .25s infinite alternate}
@keyframes hl{from{transform:rotate(100deg)}to{transform:rotate(75deg)}}
@keyframes hr{from{transform:rotate(-100deg)}to{transform:rotate(-75deg)}}
#app.sky .av[data-s=happy] .sp{opacity:1}
#app.sky .av[data-s=happy] .sp path{animation:tw .45s infinite alternate}
@keyframes tw{from{transform:scale(.4)}to{transform:scale(1.3)}}
#app.sky .av[data-s=happy] .br{transform:translateY(-6px)}
#app.sky .av[data-s=sad] .wl,#app.sky .av[data-s=sad] .wr{animation:none}
#app.sky .av[data-s=sad] .wl{transform:rotate(-8deg)}
#app.sky .av[data-s=sad] .wr{transform:rotate(8deg)}
#app.sky .av[data-s=sad] .all{animation:sd2 2s ease-in-out infinite}
@keyframes sd2{50%{transform:translateY(3px) scaleY(.98)}}
#app.sky .av[data-s=sad] .br{transform:translateY(4px)}
#app.sky .av[data-s=sleep] .eyes{animation:none;transform:scaleY(.1)}
#app.sky .av[data-s=sleep] .all{animation:fl 5.5s ease-in-out infinite}
#app.sky .av[data-s=sleep] .zz{opacity:1;animation:zz 2.4s infinite}
@keyframes zz{0%{transform:translate(0,8px);opacity:0}50%{opacity:1}100%{transform:translate(8px,-14px);opacity:0}}
#app.sky .av.xs *{animation:none!important}
#app.sky .u{display:flex;justify-content:flex-end;margin:20px 0 6px;animation:up .3s both}
#app.sky .u span{max-width:84%;padding:10px 16px;border-radius:20px 20px 6px 20px;background:var(--grad);color:#fff;line-height:1.5;font-size:15.5px;box-shadow:0 6px 16px rgba(61,107,255,.25)}
@keyframes up{from{opacity:0;transform:translateY(8px)}}
#app.sky .ai{margin:12px 0 26px;font-size:16px;line-height:1.7}
#app.sky .who{display:flex;align-items:center;gap:8px;font-weight:700;font-size:14px;margin-bottom:8px}
#app.sky .who svg{width:30px;height:30px}
#app.sky .blk{opacity:0;transform:translateY(8px);transition:opacity .3s,transform .35s}
#app.sky .blk.in{opacity:1;transform:none}
#app.sky .proc{border-radius:16px;background:var(--surf);box-shadow:0 0 0 1px var(--line);margin-bottom:14px;overflow:hidden}
#app.sky .proc .ph{display:flex;align-items:center;gap:10px;width:100%;padding:11px 14px;text-align:left;font-size:14px;font-weight:600}
#app.sky .proc .pt{flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#app.sky .proc.run .pt{background:linear-gradient(90deg,var(--mute) 30%,var(--ink) 50%,var(--mute) 70%);background-size:200% 100%;-webkit-background-clip:text;background-clip:text;color:transparent;animation:shim 1.4s linear infinite}
@keyframes shim{to{background-position:-200% 0}}
#app.sky .spin{width:16px;height:16px;border-radius:50%;border:2.5px solid var(--soft);border-top-color:var(--pri);animation:rot .7s linear infinite;flex:none}
#app.sky .proc:not(.run) .spin{animation:none;border:0;background:var(--ok) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath d='M4 8.5l2.5 2.5L12 5.5' fill='none' stroke='white' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") center/100%}
@keyframes rot{to{transform:rotate(360deg)}}
#app.sky .chev{width:18px;height:18px;color:var(--mute);transition:transform .25s}
#app.sky .proc.open .chev{transform:rotate(180deg)}
#app.sky .ps{display:grid;grid-template-rows:0fr;transition:grid-template-rows .3s}
#app.sky .proc.open .ps{grid-template-rows:1fr}
#app.sky .ps>div{overflow:hidden;padding:0 14px}
#app.sky .proc.open .ps>div{padding-bottom:10px}
#app.sky .ps p{display:flex;align-items:center;gap:9px;margin:6px 0 0;font-size:13.5px;color:var(--mute);line-height:1.4;animation:up .25s both}
#app.sky .ps p:before{content:"";width:6px;height:6px;border-radius:50%;background:var(--ok);flex:none}
#app.sky .hd2{display:flex;align-items:center;gap:12px;margin:2px 0 12px}
#app.sky .hd2>span{width:46px;height:46px;border-radius:16px;background:var(--grad);color:#fff;display:grid;place-items:center;box-shadow:var(--sh2);flex:none}
#app.sky .hd2 small{display:block;color:var(--pri);font-weight:700;font-size:12.5px;letter-spacing:.02em}
#app.sky .hd2 h2{margin:0;font-size:23px;line-height:1.3;font-weight:700}
#app.sky .sum{padding:14px 16px;border-radius:20px;background:var(--soft);margin:10px 0}
#app.sky .sum b{display:flex;align-items:center;gap:8px;font-size:15px;color:var(--pri)}
#app.sky .sum b svg{width:18px;height:18px}
#app.sky .sum ul{margin:8px 0 0;padding:0;list-style:none}
#app.sky .sum li{display:flex;gap:10px;margin:7px 0;font-size:15.5px;line-height:1.55}
#app.sky .sum li:before{content:"";width:8px;height:8px;border-radius:50%;background:var(--grad);margin-top:9px;flex:none}
#app.sky .sec{display:flex;align-items:center;gap:10px;margin:20px 0 8px;font-size:13px;font-weight:700;color:var(--mute);letter-spacing:.03em}
#app.sky .sec:after{content:"";flex:1;height:1px;background:var(--line)}
#app.sky .flow{padding-left:2px}
#app.sky .st{display:flex;gap:14px;position:relative;padding-bottom:16px}
#app.sky .st:last-child{padding-bottom:0}
#app.sky .st i{width:14px;height:14px;border-radius:50%;background:var(--pri);margin-top:7px;flex:none;box-shadow:0 0 0 4px var(--soft);z-index:1}
#app.sky .st:not(:last-child):before{content:"";position:absolute;left:6px;top:22px;bottom:-4px;width:2px;background:var(--line)}
#app.sky .st b{display:block;font-size:15.5px}
#app.sky .st span{color:var(--mute);font-size:14px;line-height:1.5}
#app.sky .tbl{overflow-x:auto;border-radius:18px;box-shadow:0 0 0 1px var(--line);background:var(--surf);margin:4px 0}
#app.sky table{border-collapse:collapse;width:100%;min-width:300px;font-size:14.5px}
#app.sky th{background:var(--soft);text-align:left;padding:10px 14px;font-weight:600;font-size:13px;color:var(--mute)}
#app.sky td{padding:11px 14px;border-top:1px solid var(--line)}
#app.sky td:first-child{font-weight:700;color:var(--pri);white-space:nowrap}
#app.sky .trick{display:flex;gap:12px;padding:14px 16px;border-radius:20px;background:linear-gradient(135deg,rgba(255,182,61,.16),rgba(255,182,61,.06));box-shadow:0 0 0 1px rgba(255,182,61,.4);margin:14px 0;font-size:15px}
#app.sky .trick svg{color:#E89A0C;margin-top:2px}
#app.sky .trick b{display:block;margin-bottom:2px}
#app.sky .qs{display:flex;flex-direction:column;gap:8px}
#app.sky .qs button{display:flex;align-items:center;gap:12px;padding:12px 14px;border-radius:16px;background:var(--surf);box-shadow:0 0 0 1px var(--line);text-align:left;font-size:15px;transition:.15s}
#app.sky .qs button:active{background:var(--soft);transform:scale(.98)}
#app.sky .qs svg{width:18px;height:18px;color:var(--pri)}
#app.sky .qs span{flex:1}
#app.sky .fu{display:flex;flex-wrap:wrap;gap:8px;margin-top:14px}
#app.sky .fu button{padding:9px 15px;border-radius:999px;background:var(--surf);box-shadow:0 0 0 1px var(--line);font-size:14px;font-weight:600;color:var(--pri);transition:.15s}
#app.sky .fu button:active{background:var(--soft);transform:scale(.96)}
#app.sky .mh{display:flex;align-items:center;gap:12px;margin:2px 0 12px}
#app.sky .mh .hd2{margin:0;flex:1}
#app.sky .pg{height:6px;border-radius:9px;background:var(--soft);overflow:hidden;margin:0 0 10px}
#app.sky .pg i{display:block;height:100%;width:0;background:var(--grad);border-radius:9px;transition:width .4s}
#app.sky .mcq{background:var(--surf);box-shadow:0 0 0 1px var(--line),var(--sh);border-radius:22px;padding:16px;margin:12px 0}
#app.sky .mcq .meta{font-size:12px;color:var(--pri);margin-bottom:6px;font-weight:700;letter-spacing:.04em}
#app.sky .mcq .q{font-weight:700;margin-bottom:6px;font-size:16.5px;line-height:1.5}
#app.sky .opt{display:flex;align-items:center;gap:12px;width:100%;text-align:left;padding:11px 12px;border-radius:14px;box-shadow:0 0 0 1.5px var(--line);margin-top:8px;font-size:15px;transition:.2s}
#app.sky .opt em{width:28px;height:28px;border-radius:50%;background:var(--soft);display:grid;place-items:center;font-style:normal;font-size:13px;font-weight:700;color:var(--pri);flex:none;transition:.2s}
#app.sky .opt:active{background:var(--soft);transform:scale(.99)}
#app.sky .opt.ok{background:rgba(18,163,107,.1);box-shadow:0 0 0 1.5px var(--ok)}
#app.sky .opt.ok em{background:var(--ok);color:#fff}
#app.sky .opt.no{background:rgba(229,72,77,.09);box-shadow:0 0 0 1.5px var(--bad);animation:shk .35s}
#app.sky .opt.no em{background:var(--bad);color:#fff}
@keyframes shk{25%{transform:translateX(-5px)}75%{transform:translateX(5px)}}
#app.sky .exp{display:none;margin-top:12px;padding:11px 13px;border-radius:14px;background:var(--soft);font-size:14.5px;color:var(--mute);line-height:1.6}
#app.sky .exp b{color:var(--ink)}
#app.sky .mcq.done .exp{display:block;animation:up .3s both}
#app.sky .mcq.done .opt{pointer-events:none}
#app.sky .score{padding:16px;border-radius:22px;background:var(--grad);color:#fff;margin:12px 0;box-shadow:var(--sh2);animation:up .4s both}
#app.sky .score b{font-size:20px}
#app.sky .score p{margin:4px 0 0;opacity:.9;font-size:14.5px}
#app.sky .bars{padding:14px 16px;border-radius:20px;background:var(--surf);box-shadow:0 0 0 1px var(--line);margin:4px 0}
#app.sky .bar{margin:10px 0}
#app.sky .bar div{display:flex;justify-content:space-between;font-size:14px;font-weight:600;margin-bottom:5px}
#app.sky .bar i{display:block;height:8px;border-radius:9px;background:var(--soft);overflow:hidden}
#app.sky .bar i b{display:block;height:100%;border-radius:9px;background:var(--grad);transition:width .8s .2s;width:0}
#app.sky .bars small{color:var(--mute);font-size:12px}
#app.sky .acts{display:flex;gap:2px;margin-top:10px}
#app.sky .faqm{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;margin-top:10px;font-size:12.5px;color:var(--mute)}
#app.sky .faqm button{padding:7px 12px;border-radius:999px;background:var(--soft);color:var(--pri);font-weight:600;font-size:13px}
#app.sky .cta{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}
#app.sky .cta a{display:inline-flex;align-items:center;gap:6px;padding:9px 14px;border-radius:999px;background:var(--soft);color:var(--pri);font-weight:600;font-size:13.5px;text-decoration:none}
#app.sky .acts button{width:38px;height:38px;border-radius:12px;display:grid;place-items:center;color:var(--mute);transition:.15s}
#app.sky .acts button:active{background:var(--soft);color:var(--pri)}
#app.sky .acts svg{width:19px;height:19px}
#app.sky .say2{position:absolute;top:60px;left:60px;z-index:4;max-width:260px;padding:8px 15px;border-radius:14px 14px 14px 4px;background:var(--surf);box-shadow:0 0 0 1px var(--line),var(--sh);font-size:13.5px;font-weight:600;opacity:0;transform:translateY(-4px);transition:.25s;pointer-events:none}
#app.sky .say2.on{opacity:1;transform:none}
#app.sky .dock{padding:4px 14px 6px;position:relative;z-index:3;background:linear-gradient(transparent,var(--bg) 45%)}
#app.sky .comp{display:flex;align-items:flex-end;gap:4px;padding:5px;border-radius:26px;background:var(--field,var(--surf));box-shadow:0 0 0 1px var(--field-line,var(--line)),var(--sh);transition:box-shadow .2s,background .2s}
#app.sky .comp:focus-within{box-shadow:0 0 0 1.5px var(--pri),0 0 0 6px rgba(61,107,255,.12)}
#app.sky .comp textarea{flex:1;min-width:0;min-height:0;height:auto;border:0;outline:0;background:transparent!important;color:var(--ink)!important;box-shadow:none!important;resize:none;font-size:15.5px;padding:8px 2px;max-height:132px;line-height:1.45;-webkit-appearance:none;appearance:none;color-scheme:inherit}
#app.sky .comp textarea::placeholder{color:var(--mute);opacity:.85}
#app.sky .cb{width:36px;height:36px;border-radius:50%;display:grid;place-items:center;background:transparent;color:var(--mute);flex:none;transition:background .2s,color .2s,transform .15s,box-shadow .2s}
#app.sky .cb.send{background:var(--ink);color:var(--bg);box-shadow:0 4px 14px rgba(15,27,61,.28)}#app.sky[data-sky-theme="dark"] .cb.send{background:#EAF0FF;color:#0B1020;box-shadow:0 4px 14px rgba(0,0,0,.4)}#app.sky .cb svg{width:20px;height:20px}
#app.sky .cb:active{transform:scale(.88)}
#app.sky .scrim{position:absolute;inset:0;background:rgba(10,16,38,.42);opacity:0;pointer-events:none;transition:opacity .25s;z-index:20}
#app.sky .scrim.on{opacity:1;pointer-events:auto}
#app.sky .drawer{position:absolute;top:0;bottom:0;left:0;width:86%;max-width:350px;background:var(--surf);z-index:30;transform:translateX(-102%);transition:transform .3s cubic-bezier(.2,.9,.25,1);display:flex;flex-direction:column;padding:calc(16px + env(safe-area-inset-top,0px)) 14px 16px;border-radius:0 28px 28px 0;box-shadow:var(--sh);will-change:transform}
#app.sky .drawer.on{transform:none}
#app.sky .drawer.drag{transition:none}
#app.sky .dp{display:flex;align-items:center;gap:12px;padding:12px;border-radius:20px;background:linear-gradient(135deg,var(--soft),transparent);box-shadow:0 0 0 1px var(--line);margin-bottom:12px}
#app.sky .dp svg.av{width:48px;height:48px;flex:none}
#app.sky .dp div{flex:1}
#app.sky .dp b{display:block;font-size:17px}
#app.sky .dp small{display:flex;align-items:center;gap:5px;color:var(--mute);font-size:12.5px}
#app.sky .new{display:flex;align-items:center;justify-content:center;gap:8px;padding:13px 16px;border-radius:16px;background:var(--grad);color:#fff;font-weight:700;font-size:15.5px;box-shadow:var(--sh2);transition:transform .15s}
#app.sky .new:active{transform:scale(.97)}
#app.sky .sc{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:12px 0}
#app.sky .sc button{display:flex;flex-direction:column;align-items:center;gap:6px;padding:11px 4px;border-radius:16px;background:var(--bg);font-size:12.5px;font-weight:600;transition:.15s}
#app.sky .sc button:active{background:var(--soft);transform:scale(.96)}
#app.sky .sc svg{color:var(--pri);width:22px;height:22px}
#app.sky .srch{display:flex;align-items:center;gap:8px;padding:0 12px;border-radius:999px;background:var(--field,var(--bg));box-shadow:inset 0 0 0 1px var(--field-line,var(--line));color:var(--mute)}
#app.sky .srch svg{width:18px;height:18px}
#app.sky .srch input{flex:1;min-width:0;border:0;outline:0;background:transparent!important;color:var(--ink)!important;box-shadow:none!important;padding:10px 0;font-size:14.5px;-webkit-appearance:none;appearance:none;color-scheme:inherit}#app.sky .srch input::placeholder{color:var(--mute);opacity:.85}#app.sky input,#app.sky textarea,#app.sky select{color-scheme:inherit}#app.sky .comp:focus-within{box-shadow:0 0 0 1.5px var(--pri),var(--sh)}
#app.sky .dl{flex:1;overflow-y:auto;margin:4px -4px 0;padding:0 4px}
#app.sky .gl{font-size:12.5px;color:var(--mute);font-weight:600;margin:14px 6px 4px}
#app.sky .hi{border-radius:14px;transition:background .15s}
#app.sky .hi.act{background:var(--soft)}
#app.sky .hr1{display:flex;align-items:center;gap:6px}
#app.sky .it{flex:1;display:flex;align-items:center;gap:10px;text-align:left;padding:11px 10px;min-width:0;font-size:15px}
#app.sky .it span{flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#app.sky .hi.act .it{font-weight:600}
#app.sky .it svg{width:18px;height:18px;color:var(--mute)}
#app.sky .mo{width:34px;height:34px;border-radius:10px;display:grid;place-items:center;color:var(--mute)}
#app.sky .mo svg{width:18px;height:18px}
#app.sky .ha{display:none;gap:6px;padding:0 8px 8px}
#app.sky .hi.open .ha{display:flex;animation:up .2s both}
#app.sky .ha button{flex:1;display:flex;align-items:center;justify-content:center;gap:6px;padding:8px;border-radius:12px;background:var(--bg);font-size:13px;font-weight:600}
#app.sky .ha button:last-child{color:var(--bad)}
#app.sky .ha svg{width:15px;height:15px}
#app.sky .df{padding-top:8px}
#app.sky .th{display:grid;grid-template-columns:repeat(3,1fr);gap:4px;padding:4px;border-radius:14px;background:var(--bg)}
#app.sky .th button{display:flex;align-items:center;justify-content:center;gap:6px;padding:9px 0;border-radius:11px;font-size:13px;font-weight:600;color:var(--mute);transition:.2s}
#app.sky .th button.on{background:var(--surf);color:var(--ink);box-shadow:0 0 0 1px var(--line),0 2px 6px rgba(40,70,160,.08)}
#app.sky .th svg{width:16px;height:16px}
#app.sky .exit{display:flex;align-items:center;gap:10px;width:100%;padding:13px 14px;border-radius:16px;box-shadow:0 0 0 1.5px var(--line);font-weight:600;margin-top:8px;transition:.15s}
#app.sky .exit:active{background:var(--soft)}
#app.sky .exit svg{color:var(--pri)}
#app.sky .dnote{font-size:11.5px;color:var(--mute);text-align:center;margin:10px 4px 0;line-height:1.5}
#app.sky .sheet{position:absolute;left:0;right:0;bottom:0;background:var(--surf);z-index:30;border-radius:28px 28px 0 0;padding:10px 18px 22px;transform:translateY(105%);transition:transform .32s cubic-bezier(.2,.9,.25,1);box-shadow:var(--sh)}
#app.sky .sheet.on{transform:none}
#app.sky .grab{width:42px;height:5px;border-radius:9px;background:var(--line);margin:0 auto 14px}
#app.sky .sheet h4{margin:4px 2px 10px;font-size:13px;color:var(--mute);font-weight:600}
#app.sky .g{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:14px}
#app.sky .g button{display:flex;flex-direction:column;align-items:center;gap:7px;padding:8px 0;font-size:12.5px;font-weight:500}
#app.sky .g button span{width:54px;height:54px;border-radius:18px;background:var(--soft);display:grid;place-items:center;color:var(--pri);transition:.15s}
#app.sky .g button:active span{background:var(--pri);color:#fff;transform:scale(.94)}
#app.sky .tools{display:flex;flex-wrap:wrap;gap:8px}
#app.sky .tools button{display:flex;align-items:center;gap:7px;padding:9px 14px;border-radius:999px;box-shadow:0 0 0 1px var(--line);font-size:14px;transition:.15s}
#app.sky .tools button:active{background:var(--soft)}
#app.sky .tools svg{width:17px;height:17px;color:var(--pri)}
@media (prefers-reduced-motion:reduce){#app.sky *{animation:none!important;transition:none!important}}
/* live-only additions: markdown answers, callouts, streaming dots */
#app.sky .ai .bw{font-size:15px;line-height:1.75;word-break:break-word}
#app.sky .ai .bw p{margin:0 0 10px}
#app.sky .ai .bw ul{margin:6px 0 12px;padding-left:22px}
#app.sky .ai .bw li{margin:4px 0}
#app.sky .ai .bw h2,#app.sky .ai .bw h3{font-size:16.5px;margin:14px 0 8px;color:var(--pri)}
#app.sky .ai .bw code{background:var(--soft);padding:2px 6px;border-radius:6px;font-size:13.5px}
#app.sky .ai .bw pre{background:var(--field);color:var(--ink);box-shadow:inset 0 0 0 1px var(--field-line,var(--line));padding:12px 14px;border-radius:14px;overflow-x:auto;margin:10px 0;font-size:13.5px;line-height:1.6}
#app.sky .ai .bw pre code{background:none;color:inherit;padding:0}
#app.sky .cal{border-radius:12px;padding:10px 12px;margin:8px 0;font-size:14.5px;line-height:1.6}
#app.sky .cal.tip{background:#FFF6E5}
#app.sky .cal.warn{background:#FFECEC}
#app.sky .cal.ok{background:#E9F9F1}
#app.sky .cal.con{background:var(--soft)}
#app.sky .cal.rev{background:#F1ECFF}
#app.sky .cal.key{background:#EAF1FF}
#app.sky[data-sky-theme="dark"] .cal.tip{background:#3A2E12}
#app.sky[data-sky-theme="dark"] .cal.warn{background:#3A1A1C}
#app.sky[data-sky-theme="dark"] .cal.ok{background:#123326}
#app.sky[data-sky-theme="dark"] .cal.rev{background:#241C3D}
#app.sky[data-sky-theme="dark"] .cal.key{background:#16224A}
#app.sky .tw{overflow-x:auto;margin:10px 0}
#app.sky .acts button.on{color:var(--pri)}
#app.sky .typing{display:flex;gap:5px;padding:6px 2px}
#app.sky .typing i{width:8px;height:8px;border-radius:50%;background:var(--mute);opacity:.35;animation:skyb 1.1s infinite}
#app.sky .typing i:nth-child(2){animation-delay:.18s}
#app.sky .typing i:nth-child(3){animation-delay:.36s}
@keyframes skyb{0%,60%,100%{transform:translateY(0);opacity:.3}30%{transform:translateY(-5px);opacity:.85}}
#app.sky .ha button:active{background:var(--soft)}
/* host shell: fixed full-screen inside the SPA */
#app.sky .comp textarea{-webkit-appearance:none;appearance:none}
#app.sky{position:fixed;inset:0;height:auto;max-width:520px;margin:0 auto;display:flex;flex-direction:column;overflow:hidden;color:var(--ink);font-family:"Hind Siliguri",system-ui,-apple-system,"Noto Sans Bengali",sans-serif;font-size:16px;-webkit-font-smoothing:antialiased;padding-top:env(safe-area-inset-top,0px);box-sizing:border-box}
`;

  /* ───────── avatar (owner's Sky orb) ───────── */
  const AV = '<g class="sh"><ellipse cx="100" cy="195" rx="46" ry="6" fill="#1B2A6B" opacity=".16"/></g><g class="all"><rect x="68" y="172" width="30" height="18" rx="8" fill="#FFA23A"/><rect x="102" y="172" width="30" height="18" rx="8" fill="#FFA23A"/><path d="M90 172q10 22 20 0z" fill="#3F5BE0"/><g class="wl"><path d="M46 106C22 116 18 144 30 158C50 156 64 142 66 122Z" fill="#3E5FE6"/></g><g class="wr"><path d="M154 106C178 116 182 144 170 158C150 156 136 142 134 122Z" fill="#3E5FE6"/></g><circle cx="100" cy="108" r="72" fill="url(#gB)"/><ellipse cx="100" cy="146" rx="46" ry="34" fill="#F6F9FF"/><ellipse cx="66" cy="68" rx="24" ry="13" fill="#fff" opacity=".22" transform="rotate(-25 66 68)"/><circle cx="56" cy="116" r="11" fill="#B79BEA" opacity=".5"/><circle cx="144" cy="116" r="11" fill="#B79BEA" opacity=".5"/><g class="eyes"><circle cx="74" cy="104" r="19" fill="#fff"/><circle cx="126" cy="104" r="19" fill="#fff"/><g class="pup"><circle cx="75" cy="106" r="11.5" fill="#17234F"/><circle cx="125" cy="106" r="11.5" fill="#17234F"/><circle cx="70" cy="101" r="4.4" fill="#fff"/><circle cx="120" cy="101" r="4.4" fill="#fff"/><circle cx="80" cy="111" r="2" fill="#fff"/><circle cx="130" cy="111" r="2" fill="#fff"/></g></g><g class="br" fill="none" stroke="#1B2A6B" stroke-width="4.5" stroke-linecap="round"><path d="M54 84q18-9 36-2"/><path d="M110 82q18-7 36 2"/></g><path d="M89 125q11-8 22 0q-3 11-11 12q-8-1-11-12z" fill="#FFA83B"/><g class="jaw"><path d="M93 134q7 5 14 0q-2 7-7 8q-5-1-7-8z" fill="#E9812B"/></g><g class="pr p-lap"><rect x="68" y="140" width="64" height="28" rx="6" fill="#DCE3F5"/><path d="M96 152l4-5 4 5-4 5z" fill="#fff"/><rect x="58" y="166" width="84" height="8" rx="4" fill="#B3BFE2"/></g><g class="pr p-book"><path d="M100 150C86 144 72 146 64 150V176C74 172 88 172 100 178Z" fill="#fff" stroke="#C9D3EE" stroke-width="2"/><path d="M100 150C114 144 128 146 136 150V176C126 172 112 172 100 178Z" fill="#F4F7FF" stroke="#C9D3EE" stroke-width="2"/><path d="M72 158h20M72 165h18M108 158h20M108 165h18" stroke="#B4C0E0" stroke-width="2" stroke-linecap="round"/><path class="pgf" d="M100 150C114 144 128 146 136 150V176C126 172 112 172 100 178Z" fill="#fff" stroke="#C9D3EE" stroke-width="2"/></g><g class="pr p-note"><rect x="72" y="146" width="56" height="30" rx="4" fill="#fff" stroke="#C9D3EE" stroke-width="2"/><path d="M80 156h40M80 164h28" stroke="#C9D3EE" stroke-width="2.4" stroke-linecap="round"/><path class="pen" d="M120 148l9 11" stroke="#FFB63D" stroke-width="4.5" stroke-linecap="round"/></g><g class="pr p-cup"><g class="steam"><path d="M122 146q-4-6 0-11M130 146q-4-6 0-11" stroke="#9FB4E8" stroke-width="2" fill="none" stroke-linecap="round"/></g><g class="cup"><rect x="116" y="150" width="20" height="22" rx="5" fill="#fff" stroke="#C9D3EE" stroke-width="2"/><path d="M136 156q8 0 8 6t-8 6" fill="none" stroke="#C9D3EE" stroke-width="3"/><rect x="118" y="155" width="16" height="6" rx="2" fill="#FFB63D" opacity=".75"/></g></g><g class="pr p-mag"><g class="mag"><circle cx="124" cy="152" r="13" fill="#fff" fill-opacity=".4" stroke="#3E5FE6" stroke-width="4"/><path d="M133 162l12 12" stroke="#3E5FE6" stroke-width="5" stroke-linecap="round"/></g></g><g class="pr p-calc"><rect x="76" y="144" width="48" height="32" rx="6" fill="#25347A"/><rect x="81" y="149" width="38" height="8" rx="2" fill="#9FD6FF"/><g fill="#fff" opacity=".85"><circle cx="86" cy="164" r="2.4"/><circle cx="96" cy="164" r="2.4"/><circle cx="106" cy="164" r="2.4"/><circle cx="116" cy="164" r="2.4"/><circle cx="86" cy="171" r="2.4"/><circle cx="96" cy="171" r="2.4"/><circle cx="106" cy="171" r="2.4"/><circle cx="116" cy="171" r="2.4"/></g></g><g class="pr p-ph"><path d="M32 98C30 40 170 40 168 98" fill="none" stroke="#25347A" stroke-width="5"/><ellipse cx="30" cy="106" rx="9" ry="14" fill="#25347A"/><ellipse cx="170" cy="106" rx="9" ry="14" fill="#25347A"/><g class="nt" fill="#3D6BFF" font-size="18" font-weight="700"><text x="8" y="66">♪</text><text x="176" y="58" fill="#FFB63D" font-size="16">♫</text></g></g><g class="hd"><ellipse class="hl2" cx="82" cy="170" rx="10" ry="8" fill="#3E5FE6"/><ellipse class="hr2" cx="118" cy="170" rx="10" ry="8" fill="#3E5FE6"/></g><g class="cap"><path d="M66 58v14q34 14 68 0V58z" fill="#25347A"/><path d="M42 56l60-20 60 20-60 22z" fill="#1B2765"/><path d="M102 46l2.8 5.6 6.2.9-4.5 4.3 1.1 6.1-5.6-2.9-5.6 2.9 1.1-6.1-4.5-4.3 6.2-.9z" fill="#FFB63D"/><g class="tas"><path d="M150 60q4 14 2 26" stroke="#FFB63D" stroke-width="3.5" fill="none" stroke-linecap="round"/><circle cx="152" cy="90" r="5.5" fill="#FFB63D"/></g></g></g><g transform="translate(0 -14)"><g class="bulb"><path d="M100 4a12 12 0 0 0-6 22v6h12v-6a12 12 0 0 0-6-22z" fill="#FFD66B"/><rect x="95" y="33" width="10" height="4" rx="2" fill="#B3BFE2"/><path d="M80 14l-8-4M120 14l8-4M100-4v-7" stroke="#FFB63D" stroke-width="3" stroke-linecap="round"/></g></g><g class="tk" fill="#3D6BFF"><circle cx="152" cy="30" r="4"/><circle cx="165" cy="20" r="5"/><circle cx="180" cy="8" r="6.5"/></g><g class="sp" fill="#FFB63D"><g transform="translate(26 50)"><path d="M0-9Q0 0 9 0Q0 0 0 9Q0 0-9 0Q0 0 0-9z"/></g><g transform="translate(176 62)"><path d="M0-9Q0 0 9 0Q0 0 0 9Q0 0-9 0Q0 0 0-9z"/></g><g transform="translate(18 128)"><path d="M0-7Q0 0 7 0Q0 0 0 7Q0 0-7 0Q0 0 0-7z"/></g></g><g class="zz" fill="#6B7FD6" font-weight="800"><text x="150" y="40" font-size="22">z</text><text x="168" y="22" font-size="15">z</text></g>';
  const av = (c) => '<svg class="av ' + (c || '') + '" viewBox="0 0 200 200">' + AV + '</svg>';

  /* ───────── markup ───────── */
  function shell() {
    return '' +
      '<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>' +
      '<linearGradient id="gB" x1=".2" y1="0" x2=".8" y2="1"><stop offset="0" stop-color="#7DB4FF"/><stop offset="1" stop-color="#4A6CF2"/></linearGradient>' +
      '<symbol id="menu" viewBox="0 0 24 24"><path d="M4 7h16M4 12h16M4 17h16"/></symbol>' +
      '<symbol id="edit" viewBox="0 0 24 24"><path d="M4 20h4l10-10-4-4L4 16z"/><path d="M14 6l4 4"/></symbol>' +
      '<symbol id="home" viewBox="0 0 24 24"><path d="M4 10.5L12 4l8 6.5V20H4z"/><path d="M9 20v-6h6v6"/></symbol>' +
      '<symbol id="plus" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></symbol>' +
      '<symbol id="mic" viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></symbol>' +
      '<symbol id="send" viewBox="0 0 24 24"><path d="M4 12l16-8-6 8 6 8z"/></symbol>' +
      '<symbol id="copy" viewBox="0 0 24 24"><rect x="8" y="8" width="11" height="12" rx="2.5"/><path d="M5 15V6a2 2 0 0 1 2-2h8"/></symbol>' +
      '<symbol id="redo" viewBox="0 0 24 24"><path d="M19 5v5h-5M18.5 10A7 7 0 1 0 19 14"/></symbol>' +
      '<symbol id="up" viewBox="0 0 24 24"><path d="M8 11v9H4v-9zM8 11l4-7c2 0 3 1.5 2.5 3.5L14 10h5a2 2 0 0 1 2 2.4l-1.2 6A2 2 0 0 1 18 20H8"/></symbol>' +
      '<symbol id="x" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></symbol>' +
      '<symbol id="chat" viewBox="0 0 24 24"><path d="M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-7l-5 4v-4H6a2 2 0 0 1-2-2z"/></symbol>' +
      '<symbol id="book" viewBox="0 0 24 24"><path d="M4 5.5C7 4 10 4.5 12 6c2-1.5 5-2 8-.5V19c-3-1.5-6-1-8 .5-2-1.5-5-2-8-.5z"/><path d="M12 6v13.5"/></symbol>' +
      '<symbol id="xc" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M9 9l6 6M15 9l-6 6"/></symbol>' +
      '<symbol id="exam" viewBox="0 0 24 24"><rect x="5" y="4" width="14" height="17" rx="3"/><path d="M9 4V3h6v1M9 11l2 2 4-4M9 17h6"/></symbol>' +
      '<symbol id="spark" viewBox="0 0 24 24"><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/></symbol>' +
      '<symbol id="dots" viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/></symbol>' +
      '<symbol id="trash" viewBox="0 0 24 24"><path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13"/></symbol>' +
      '<symbol id="pin" viewBox="0 0 24 24"><path d="M9 4h6l-1 6 3 3H7l3-3zM12 13v7"/></symbol>' +
      '<symbol id="sun" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6L7 7M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4"/></symbol>' +
      '<symbol id="moon" viewBox="0 0 24 24"><path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z"/></symbol>' +
      '<symbol id="auto" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M12 3.5v17"/><path d="M12 3.5a8.5 8.5 0 0 1 0 17z" fill="currentColor"/></symbol>' +
      '<symbol id="search" viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4 4"/></symbol>' +
      '<symbol id="arrow" viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6"/></symbol>' +
      '<symbol id="cam" viewBox="0 0 24 24"><path d="M4 8h3l2-2h6l2 2h3v11H4z"/><circle cx="12" cy="13" r="3.4"/></symbol>' +
      '<symbol id="img" viewBox="0 0 24 24"><rect x="4" y="5" width="16" height="14" rx="3"/><path d="M4 16l5-4 4 3 3-2 4 3"/></symbol>' +
      '<symbol id="doc" viewBox="0 0 24 24"><path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/></symbol>' +
      '<symbol id="vid" viewBox="0 0 24 24"><rect x="4" y="6" width="12" height="12" rx="3"/><path d="M16 11l4-3v8l-4-3z"/></symbol>' +
      '<symbol id="globe" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.5 3 2.5 14 0 17M12 3.5c-2.5 3-2.5 14 0 17"/></symbol>' +
      '<symbol id="mcq" viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8 10h8M8 14h5"/></symbol>' +
      '<symbol id="target" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="1"/></symbol>' +
      '<symbol id="bulb" viewBox="0 0 24 24"><path d="M12 4a6 6 0 0 0-3 11v3h6v-3a6 6 0 0 0-3-11z"/><path d="M10 21h4"/></symbol>' +
      '<symbol id="chart" viewBox="0 0 24 24"><path d="M5 19V9M12 19V5M19 19v-7"/></symbol>' +
      '<symbol id="sum" viewBox="0 0 24 24"><path d="M5 5h14M5 5l7 7-7 7h14"/></symbol>' +
      '<symbol id="stop" viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="2.5"/></symbol>' +
      '</defs></svg>' +
      '<header>' +
      '<button class="ib" id="menuB" aria-label="' + T.menu + '">' + ic('menu') + '</button>' +
      '<div class="brand"><div class="hbw" id="hbw"></div><div><b>Sky</b><small><i class="dot"></i>' + T.sub + '</small></div></div>' +
      '<button class="ib" id="newB" aria-label="' + T.newChat + '">' + ic('edit') + '</button>' +
      '<button class="ib" id="homeB" aria-label="' + T.backHome + '">' + ic('home') + '</button>' +
      '</header>' +
      '<div class="say2" id="say2"></div>' +
      '<main id="chat"><section class="hero" id="hero">' +
      '<div class="bub"><div class="say" id="say"></div></div>' +
      '<div class="hbig" id="hbig"></div>' +
      '</section><div id="msgs"></div></main>' +
      '<div class="dock"><div class="comp">' +
      '<button class="cb" id="plusB" aria-label="' + T.attach + '">' + ic('plus') + '</button>' +
      '<textarea id="inp" rows="1" placeholder="' + T.ph + '"></textarea>' +
      '<button class="cb" id="actB" aria-label="' + T.send + '">' + ic('mic') + '</button>' +
      '</div></div>' +
      '<div class="scrim" id="scrim"></div>' +
      '<aside class="drawer" id="drawer">' +
      '<div class="dp"><span id="dw"></span><div><b>Sky</b><small><i class="dot"></i>' + T.online + '</small></div><button class="ib" id="closeD" aria-label="বন্ধ">' + ic('x') + '</button></div>' +
      '<button class="new" id="newD">' + ic('plus') + T.newChat + '</button>' +
      '<div class="sc">' +
      '<button data-go="question-bank">' + ic('book') + 'প্রশ্ন ব্যাংক</button>' +
      '<button data-go="mistake-bank">' + ic('xc') + 'ভুল-ব্যাংক</button>' +
      '<button data-go="exam">' + ic('exam') + 'পরীক্ষা</button>' +
      '</div>' +
      '<label class="srch">' + ic('search') + '<input id="hs" placeholder="' + T.search + '" autocomplete="off"></label>' +
      '<div class="dl" id="hl"></div>' +
      '<div class="df">' +
      '<div class="th" id="th"><button data-t="light">' + ic('sun') + 'লাইট</button><button data-t="dark">' + ic('moon') + 'ডার্ক</button><button data-t="auto">' + ic('auto') + 'অটো</button></div>' +
      '<button class="exit" id="exitD">' + ic('home') + T.homeBtn + '</button>' +
      '<p class="dnote">' + T.notice + '</p>' +
      '</div></aside>' +
      '<div class="sheet" id="sheet"><div class="grab"></div>' +
      '<h4>' + T.attach + '</h4>' +
      '<div class="g"><button id="camB"><span>' + ic('cam') + '</span>ক্যামেরা</button><button id="imgB"><span>' + ic('img') + '</span>ছবি</button><button id="docB"><span>' + ic('doc') + '</span>ডকুমেন্ট</button><button id="vidB"><span>' + ic('vid') + '</span>ভিডিও</button></div>' +
      '<h4>' + T.tools + '</h4>' +
      '<div class="tools">' +
      '<button data-q="ওয়েবে খুঁজে দেখো">' + ic('globe') + 'সার্চ</button>' +
      '<button data-q="১০টা MCQ বানাও">' + ic('mcq') + 'MCQ</button>' +
      '<button data-q="আমাকে কুইজ নাও, ৫টা প্রশ্ন">' + ic('target') + 'Quiz</button>' +
      '<button data-q="এই টপিকটা সহজ করে বুঝাও">' + ic('bulb') + 'ব্যাখ্যা</button>' +
      '<button data-q="আমার পারফরম্যান্স বিশ্লেষণ করো">' + ic('chart') + 'বিশ্লেষণ</button>' +
      '<button data-q="সারসংক্ষেপ করো">' + ic('sum') + 'সারসংক্ষেপ</button>' +
      '</div></div>' +
      '<input type="file" id="filePick" accept="image/*" style="display:none">';
  }

const ACT_ACTIONS = { 'prefs.write': { bn: 'তোমার AI পছন্দ সেভ করা', en: 'Save your AI preferences' } };
  const AUTO_CONFIRM_ACTIONS = new Set(['prefs.write']);
  function actLabel(action) {
    const k = ACT_ACTIONS[action];
    return k ? (lang === 'en' ? k.en : k.bn) : String(action || '');
  }
  function actionCardHtml(m, idx) {
    const head = `<div class="ai-msg ai"><div class="ai-msg-head"><span class="mini"></span>${esc(T.title)}</div><div class="ai-act">
      <div class="ai-act-h">⚙️ ${esc(T.actTitle)} · ${esc(actLabel(m.actAction))}</div>`;
    const sum = m.actSummary ? `<div class="ai-act-sum">${esc(m.actSummary)}</div>` : '';
    if (m.actDone) {
      return `${head}${sum}<div class="ai-act-done ${m.actDone === 'cancelled' || m.actDone === 'error' ? 'bad' : ''}">${esc(m.actDoneText || T.actApplied)}</div></div></div>`;
    }
    return `${head}<div class="ai-act-q">${esc(m.actWhy || T.actConfirmQ)}</div>${sum}
      <div class="ai-act-btns"><button class="ai-act-yes" onclick="window.__AiActDecide(${idx},1)">✔ ${esc(T.actYes)}</button><button class="ai-act-no" onclick="window.__AiActDecide(${idx},0)">✖ ${esc(T.actNo)}</button></div>
      <div class="ai-act-note">🔒 ${esc(T.actOnly)}</div></div></div>`;
  }
  function actionExpired(m) {
    return !m.actDone && m.actExpiresAt && Date.now() > m.actExpiresAt;
  }
  function dropExpiredAction() {
    const last = msgs[msgs.length - 1];
    if (!last || !last.pending || !actionExpired(last)) return false;
    last.pending = false; last.actDone = 'error'; last.actDoneText = T.actExpired;
    save(); return true;
  }
  function postAction(path, payload) {
    return fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload || {}) })
      .then((r) => r.json().catch(() => null).then((j) => ({ status: r.status, body: j })))
      .catch(() => ({ status: 0, body: null }));
  }
  /* Confirm a pending proposal and collapse it to a terminal state. Returns the
     toast to show, if any. Shared by the tap handler and the auto-confirm path. */
  async function resolveProposal(m) {
    const res = await postAction('/api/ai/actions/confirm', { token: m.actId });
    if (res.status === 200 && res.body && res.body.ok) {
      m.actDone = 'applied'; m.actDoneText = T.actApplied;
      return '';
    }
    if (res.status === 0) return T.actOffline;
    const reason = res.body && (res.body.reason || res.body.error);
    m.actDone = 'error';
    m.actDoneText = reason === 'expired' ? T.actExpired : T.actFail;
    return '';
  }
  async function decideAction(idx, yes) {
    const m = msgs[idx];
    if (!m || !m.pending || m.actBusy) return;
    if (actionExpired(m)) { m.pending = false; m.actDone = 'error'; m.actDoneText = T.actExpired; save(); renderMsgs(); return; }
    m.actBusy = true; renderMsgs();
    if (!yes) {
      m.pending = false; m.actDone = 'cancelled'; m.actDoneText = T.actCancelled;
      m.actBusy = false; save(); renderMsgs(); return;
    }
    const warn = await resolveProposal(m);
    m.actBusy = false;
    if (warn) { save(); renderMsgs(); toast(warn); return; }
    m.pending = false; save(); renderMsgs();
  }
  window.__AiActDecide = decideAction;
  /* Detect an explicit personalization request in the student's own words and map
     it to declared args. Keep it deliberately narrow: only clear, first-person
     requests, and never when a preference is already being offered. */
  function actParseIntent(q) {
    const s = String(q || '');
    const args = {};
    if (/(উত্তর\s*(ছোট|সংক্ষিপ্ত|short)|সংক্ষেপে\s*উত্তর|keep\s+(it|answers?|responses?)\s+short|short(er)?\s+answers?|concise)/i.test(s)) args.responseLen = 'short';
    if (/(বিস্তারিত|ডিটেইল|detailed|in\s+detail|elaborate)/i.test(s)) args.responseLen = 'detailed';
    if (/(আরও\s*সহজ|সহজ\s*(করে|ভাষায়)|simple\s+(words|language)|simpler)/i.test(s)) args.tone = 'simple';
    if (/(professional|আনুষ্ঠানিক|formal)/i.test(s)) args.tone = 'professional';
    if (/(উৎসাহ|motivat|inspir)/i.test(s)) args.tone = 'motivating';
    if (/(সরাসরি|সংক্ষেপে\s*বলো|direct|straight\s*to)/i.test(s)) args.tone = 'direct';
    if (/(ইংরেজিতে\s*উত্তর|answer\s+in\s+english|reply\s+in\s+english|english\s*-?এ\s*উত্তর)/i.test(s)) args.langStyle = 'en';
    if (/(বাংলায়\s*উত্তর|answer\s+in\s+bangla|reply\s+in\s+bangla)/i.test(s)) args.langStyle = 'bn';
    if (!Object.keys(args).length) return null;
    return { action: 'prefs.write', args };
  }
  async function offerAction(intent) {
    const res = await postAction('/api/ai/actions/propose', { action: intent.action, args: intent.args });
    if (res.status === 200 && res.body && res.body.ok && res.body.proposal) {
      const p = res.body.proposal;
      const m = { role: 'ai', text: '', ts: Date.now(), pending: true, actId: p.id, actAction: p.action, actSummary: p.summary || '', actExpiresAt: p.expiresAt || (Date.now() + 300000) };
      if (AUTO_CONFIRM_ACTIONS.has(p.action)) {
        /* Confirm before the first paint, so the card only ever shows the outcome. */
        const warn = await resolveProposal(m);
        if (warn) {
          /* The confirm never reached the Worker, so the token is still good:
             leave the card tappable rather than showing a dead or false result. */
          m.pending = true; m.actBusy = false;
          msgs.push(m); save(); renderMsgs(); toast(warn);
          return true;
        }
        m.pending = false;
        msgs.push(m); save(); renderMsgs();
        return true;
      }
      msgs.push(m); save(); renderMsgs();
      return true;
    }
    if (res.status === 401) { toast(T.needLogin, true); return true; }
    /* Anything else (layer off, denied) falls through: the normal answer proceeds. */
    return false;
  }

  /* Message renderer entry point. Kept as the named boundary the M9 action-ui
     guard slices on, and as the one place a message becomes HTML. */
  function msgHtml(m, idx) { return bubble(m, idx); }

  /* ───────── render ───────── */
  let msgsEl, mainEl, inpEl, actEl, busy = 0;

  /* Live status panel (owner's "proc" design). Every line is a REAL state of
     the request, sent, first token received, finished, never a canned step. */
  function procHtml(m) {
    if (m.role === 'user' || m.error) return '';
    const steps = (m.steps || []).map((x) => '<p>' + esc(x) + '</p>').join('');
    if (m.pending) {
      return '<div class="proc run open"><button class="ph"><span class="spin"></span><span class="pt">' + esc(m.stage || T.stageRead) + '…</span>' + ic('chev', 'chev') + '</button><div class="ps"><div>' + steps + '</div></div></div>';
    }
    if (m.secs) {
      return '<div class="proc"><button class="ph"><span class="spin"></span><span class="pt">' + bn((m.steps || []).length) + 'টি ধাপে ' + bn(m.secs) + ' সেকেন্ডে তৈরি</span>' + ic('chev', 'chev') + '</button><div class="ps"><div>' + steps + '</div></div></div>';
    }
    return '';
  }
  /* PR-3: shared-answer note + "আরো বিস্তারিত" chip (data-q sends it to the AI). */
  function faqNote(m) {
    if (!m.faq || m.pending) return '';
    const more = String(m.q || '').slice(0, 120) + ', আরো বিস্তারিত বুঝিয়ে বলো';
    return '<div class="faqm"><span>📌 সবার জন্য জমানো উত্তর</span><button data-q="' + esc(more) + '">আরো বিস্তারিত →</button></div>';
  }
  /* Owner 2026-10-17: support replies get two buttons instead of a printed
     number / address. The Worker reads both from PUB_KV ('sky:contact') and
     redirects, so they are never in the app or in the public repo. */
  function contactNote(m) {
    if (!m.contact || m.pending) return '';
    return '<div class="cta"><a href="/api/go/whatsapp" target="_blank" rel="noopener">💬 WhatsApp-এ লিখো</a>' +
      '<a href="/api/go/email" target="_blank" rel="noopener">📧 ইমেল করো</a></div>';
  }
  /* Agent phase 1: open_page button. */
  function goNote(m) {
    if (!m.go || m.pending || !/^[a-z0-9-]{2,40}$/.test(String(m.go))) return '';
    return '<div class="faqm"><span>🧭 ' + esc(m.goName || '') + '</span><button data-tgo="' + esc(m.go) + '">খুলে দাও →</button></div>';
  }
  function bubble(m, idx) {
    if (m.role === 'user') return '<div class="u"><span>' + esc(m.text) + '</span></div>';
    let inner;
    if (m.error) {
      const login = m.errorKind === 'login';
      const body = String(m.error).split('\n')
        .map((ln) => ln.trim())
        .filter(Boolean)
        .map((ln) => '<p>' + esc(ln) + '</p>')
        .join('');
      const limit = m.errorKind === 'limit';
      inner = '<div class="cal ' + (login || limit ? 'key' : 'warn') + '"><b>' + (login ? '🔒' : (limit ? '🌙' : '⚠️')) + '</b> ' + body + '</div>';
    }
    else if (m.pending && !m.text) inner = '';
    else inner = mdRich(m.text);
    const acts = (!m.pending && !m.error && m.text) ? '<div class="acts">' +
      '<button data-c="' + idx + '" aria-label="' + T.copy + '">' + ic('copy') + '</button>' +
      '<button data-r="' + idx + '" aria-label="' + T.regen + '">' + ic('redo') + '</button>' +
      '<button data-g="' + idx + '" aria-label="' + T.good + '">' + ic('up') + '</button>' +
      '</div>' : '';
    return '<div class="ai" data-i="' + idx + '"><div class="who">' + av('xs') + 'Sky</div>' + procHtml(m) + '<div class="bw">' + inner + '</div>' + goNote(m) + faqNote(m) + contactNote(m) + acts + '</div>';
  }
  function procStage(node, holder, next) {
    if (holder.stage) (holder.steps = holder.steps || []).push(holder.stage);
    holder.stage = next;
    const el = node && node.querySelector('.proc');
    if (!el) return;
    const pt = el.querySelector('.pt'), ls = el.querySelector('.ps>div');
    if (ls) ls.innerHTML = (holder.steps || []).map((x) => '<p>' + esc(x) + '</p>').join('');
    if (pt) pt.textContent = next + '…';
  }

  function renderMsgs() {
    if (!msgsEl) return;
    msgsEl.innerHTML = sessions[cur].msgs.map(bubble).join('');
    scrollEnd();
  }
  function scrollEnd() { try { mainEl.scrollTop = mainEl.scrollHeight; } catch (_) {} }

  function setBusy(on) {
    busy = on ? 1 : 0;
    if (!actEl) return;
    if (on) { actEl.className = 'cb'; actEl.innerHTML = ic('stop'); actEl.setAttribute('aria-label', T.stop); }
    else { actEl.className = 'cb' + (inpEl.value.trim() ? ' send' : ''); actEl.innerHTML = ic(inpEl.value.trim() ? 'send' : 'mic'); actEl.setAttribute('aria-label', inpEl.value.trim() ? T.send : 'ভয়েস'); }
  }

  /* ───────── Sky custom instructions (owner plan step 3) ───────── */
  const INSTR_HOWTO = 'Sky-কে এক লাইনে বলে দাও কীভাবে উত্তর দেবে, আমি সবসময় সেটা মানব।\nযেমন লেখো:\nনির্দেশনা: সবসময় উদাহরণ দিয়ে বোঝাবে, শেষে একটা MCQ দেবে\n\nদেখতে: "আমার নির্দেশনা"   মুছতে: "নির্দেশনা মুছে দাও"';
  function instrParse(q) {
    const s = String(q || '').trim();
    let m = s.match(/^(?:sky\s*[,，]?\s*)?(?:\/?নির্দেশনা|\/?instruction|\/?নির্দেশ)\s*[:：=\-–]\s*([\s\S]+)$/i);
    if (m) return { op: 'save', text: m[1].trim() };
    if (/^(?:আমার\s*)?(?:নির্দেশনা|instruction)\s*(?:টা|গুলো)?\s*(?:মুছে\s*(?:দাও|ফেলো|দিন)|মুছো|ডিলিট\s*করো|delete|clear|remove)\s*[।.!]?$/i.test(s)) return { op: 'clear' };
    if (/^(?:আমার\s*(?:নির্দেশনা|instruction)\s*(?:কী|কি|দেখাও)?|নির্দেশনা\s*দেখাও|my\s+instruction)\s*[?？।]?$/i.test(s)) return { op: 'show' };
    if (/^\/?(?:নির্দেশনা|instruction)\s*[?？]?$/i.test(s)) return { op: 'help' };
    return null;
  }
  async function instrRun(cmd) {
    if (cmd.op === 'help') return INSTR_HOWTO;
    const opts = cmd.op === 'show'
      ? { method: 'GET', credentials: 'same-origin' }
      : { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: cmd.op === 'clear' ? '' : cmd.text }) };
    let r = null;
    try {
      const res = await fetch('/api/ai/instructions', opts);
      r = { status: res.status, body: await res.json().catch(() => ({})) };
    } catch (_) { return 'ইন্টারনেট সংযোগ দেখে আবার চেষ্টা করো।'; }
    const b = r.body || {};
    if (r.status === 401) return 'নির্দেশনা দিতে আগে লগইন করো।';
    if (b.off) return 'এই সুবিধা এখন সাময়িক বন্ধ আছে।';
    if (r.status !== 200) return b.message || 'এখন সেভ করা গেল না, আবার চেষ্টা করো।';
    if (cmd.op === 'show') return b.text ? 'তোমার নির্দেশনা:\n' + b.text + '\n\nবদলাতে নতুন করে লেখো "নির্দেশনা: …"। মুছতে: "নির্দেশনা মুছে দাও"' : 'তুমি এখনো কোনো নির্দেশনা দাওনি।\n\n' + INSTR_HOWTO;
    if (cmd.op === 'clear') return 'তোমার নির্দেশনা মুছে ফেলেছি। এখন থেকে আগের মতো উত্তর দেব।';
    return 'ঠিক আছে, মনে রাখলাম ✓\n"' + b.text + '"\nএখন থেকে প্রতিটা উত্তরে এভাবেই বলব। বদলাতে আবার "নির্দেশনা: …" লেখো।';
  }

  async function send(text) {
    const t = String(text == null ? inpEl.value : text).trim();
    if (!t || busy) return;
    const hero = document.getElementById('hero');
    if (hero) hero.style.display = 'none';
    const app = document.getElementById('app');
    if (app) app.classList.add('chatting');
    inpEl.value = ''; inpEl.style.height = 'auto'; inpEl.blur();

    sessions[cur].msgs.push({ role: 'user', text: t, ts: Date.now() });
    if (!sessions[cur].name) sessions[cur].name = t.slice(0, 40);
    /* Step 3 (owner 2026-10-18): "নির্দেশনা: …" saves the student's own note,
       Sky follows it on every answer. Checked on the server; no AI limit used. */
    const instrCmd = instrParse(t);
    if (instrCmd) {
      const reply = await instrRun(instrCmd);
      sessions[cur].msgs.push({ role: 'ai', text: reply, ts: Date.now(), local: true });
      save(); renderMsgs(); mood('happy', 1200);
      return;
    }
    /* PR-2 (owner 2026-10-17): hi / ধন্যবাদ / তুমি কে … are answered here from the
       in-app bank (sky-smalltalk.js): instant, no server call, no AI limit used. */
    /* The big reply bank (sky-replies.json) loads once on first use; wait at most 0.8 s. */
    const ST = window.SkySmallTalk;
    if (ST && ST.ready) { try { await ST.ready(800); } catch (_) {} }
    const fname = (profilePayload() || {}).firstName;
    let quick = null;
    if (ST && ST.replyMsg) quick = ST.replyMsg(t, fname);
    else if (ST) { const r0 = ST.reply(t, fname); quick = r0 ? { text: r0 } : null; }
    if (quick) {
      sessions[cur].msgs.push({ role: 'ai', text: quick.text, ts: Date.now(), local: true, contact: !!quick.contact });
      save(); renderMsgs(); mood('happy', 1200);
      return;
    }
    /* PR-3 (owner 2026-10-17): common textbook questions (সমাস কী …) get the same
       reviewed answer for everyone from the in-app bank (sky-faq*.js): instant, no
       server call, no AI limit. "আরো বিস্তারিত" sends the question to the AI. */
    const faq = window.SkyFAQ ? window.SkyFAQ.match(t) : null;
    if (faq) {
      sessions[cur].msgs.push({ role: 'ai', text: faq.a, ts: Date.now(), local: true, faq: faq.id, q: faq.q });
      save(); renderMsgs(); mood('happy', 1200);
      return;
    }
    /* Agent phase 1 (owner 2026-10-17): in-app tools (sky-tools-client.js) -
       question bank search, quiz, quiz grading, knowledge lookup, open a page.
       Instant, no server call, no AI limit. The proc panel lists the tools. */
    if (window.SkyTools) {
      const tq0 = Date.now();
      const prevQuiz = (() => { const ms = sessions[cur].msgs; for (let i = ms.length - 2; i >= 0; i--) { if (ms[i].role === 'ai') return ms[i].quiz || null; } return null; })();
      let tr = null;
      try { tr = window.SkyTools.run(t, { lastQuiz: prevQuiz }); } catch (_) { tr = null; }
      if (tr && tr.text) {
        const m = { role: 'ai', text: tr.text, ts: Date.now(), local: true, steps: tr.steps || [], secs: Math.max(0.1, (Date.now() - tq0) / 1000).toFixed(1), tools: tr.tools || [] };
        if (tr.quiz) m.quiz = tr.quiz;
        if (tr.go) { m.go = tr.go; m.goName = tr.goName || ''; }
        if (tr.faq) { m.faq = tr.faq; m.q = tr.q; }
        sessions[cur].msgs.push(m);
        save(); renderMsgs(); mood('happy', 1200);
        return;
      }
    }
    const holder = { role: 'ai', text: '', ts: Date.now(), pending: true, stage: T.stageRead, steps: [] };
    const t0 = Date.now();
    let gotFirst = false;
    sessions[cur].msgs.push(holder);
    save(); renderMsgs();

    const node = msgsEl.querySelector('.ai[data-i="' + (sessions[cur].msgs.length - 1) + '"]');
    liveNode = node;
    setBusy(true); mood('think');

    /* slice(0,-1) drops the pending AI placeholder, so the history ends with the
       turn the student just typed. It must stay: the model needs the question.
       Adding it a second time is the duplicate-turn bug (regression 2026-09). */
    /* The UI stores model turns as role 'ai', but the gateway only accepts
       'user' / 'assistant' and rejected the whole request (400 invalid_message)
       from the 2nd question on. Map the role, drop pending/failed/action turns
       that carry no text, and clip long answers so history stays in budget. */
    const history = sessions[cur].msgs.slice(0, -1)
      .filter((m) => m && !m.pending && !m.error && !m.actId && typeof m.text === 'string' && m.text.trim())
      .slice(-MAX_HISTORY)
      .map((m) => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.role === 'user' ? m.text.slice(0, 4000) : m.text.slice(0, 1500) }));
    procStage(node, holder, T.stageSend);
    /* Live progress comes from the server: each `stage` event is real work the
       gateway is doing right now. Nothing here is simulated. */
    const res = await ask(history, (full) => {
      holder.text = full;
      if (!gotFirst) { gotFirst = true; mood('type'); }
      /* stream straight into the live node with the full rich renderer, so
         headings, tables and diagrams appear while the answer is written. */
      if (node) { const b = node.querySelector('.bw'); if (b) b.innerHTML = mdRich(full); }
      scrollEnd();
    }, { onStage: (label) => procStage(node, holder, label) }, (corrected) => { holder.text = corrected; replaceStream(corrected); });

    setBusy(false);
    if (holder.stage) { holder.steps.push(holder.stage); holder.stage = ''; }
    holder.secs = ((Date.now() - t0) / 1000).toFixed(1);
    if (res.ok && res.text) {
      holder.pending = false; holder.text = res.text;
      mood('happy', 1200);
    } else {
      const needLogin = res.status === 401 || (res.meta && /sign_in_required/.test(String(res.meta.error || '')));
      const limited = !needLogin && (res.status === 429 || (res.meta && res.meta.error === 'rate_limited'));
      holder.pending = false;
      holder.error = needLogin ? T.needLoginLong : (limited ? limitText(res.meta) : (res.code === 'offline' ? T.offline : T.failed));
      if (needLogin) holder.errorKind = 'login';
      else if (limited) holder.errorKind = 'limit';
      mood('sad', 1400);
    }
    save(); renderMsgs();
  }

  /* Owner 2026-10-17: the daily-limit card. The reset time is the server's
     resetAt (window start + 24 h); nothing here is guessed. */
  function limitText(meta) {
    const bn = (s) => String(s).replace(/[0-9]/g, (d) => '০১২৩৪৫৬৭৮৯'[d]);
    const cap = meta && Number(meta.cap) > 0 ? Number(meta.cap) : 10;
    const at = meta && Number(meta.resetAt) > Date.now() ? Number(meta.resetAt) : 0;
    const lines = [
      'আজকের জন্য তোমার ' + bn(cap) + 'টি AI প্রশ্নের সুযোগ ব্যবহার করা হয়ে গেছে।',
      'প্রতিটি শিক্ষার্থী যেন নিয়মিত ও মানসম্মত সহায়তা পায়, সেজন্য AdmissionSky-তে প্রতিদিন একটি নির্দিষ্ট সীমা রাখা হয়েছে।'
    ];
    if (at) {
      const left = Math.max(1, Math.round((at - Date.now()) / 60000));
      const h = Math.floor(left / 60), mi = left % 60;
      let clock = '';
      try { clock = new Date(at).toLocaleTimeString('bn-BD', { hour: 'numeric', minute: '2-digit' }); } catch (_) { clock = ''; }
      const day = new Date(at).toDateString() === new Date().toDateString() ? 'আজ' : 'আগামীকাল';
      const span = ((h ? bn(h) + ' ঘণ্টা ' : '') + (mi ? bn(mi) + ' মিনিট' : '')).trim();
      lines.push('তোমার পরবর্তী সুযোগ চালু হবে ' + (clock ? day + ' ' + clock + '-এ' : 'শিগগিরই') + ' (আর প্রায় ' + span + ' পর)। তখন আমি আবার তোমার প্রশ্নের উত্তর দেবো।');
    } else {
      lines.push('পরবর্তী সুযোগ ২৪ ঘণ্টার মধ্যে আবার চালু হবে। তখন আমি আবার তোমার প্রশ্নের উত্তর দেবো।');
    }
    lines.push('ততক্ষণে কোর্স, প্রশ্নব্যাংক বা মক টেস্ট দিয়ে প্রস্তুতি চালিয়ে যাও। 💙');
    return lines.join('\n');
  }

  function stop() { try { if (activeReq) activeReq.abort(); } catch (_) {} setBusy(false); say(T.stopped, 1600); }

  function newChat() {
    sessions.unshift({ name: '', msgs: [], ts: Date.now() });
    if (sessions.length > 20) sessions = sessions.slice(0, 20);
    cur = 0; save(); renderMsgs(); resetHero(); closeLayers();
  }
  /* Sky recall (owner plan step 2): on chat open Sky reminds the student of
     recent mistakes / their weak topic by itself, in place of the time-based
     greeting. Signed-in, empty chat, Bangla UI only. 2.5 s timeout; any
     failure or "nothing to say" (null) keeps the normal greeting. The bubble
     and the button use textContent only, never HTML/Markdown. */
  function fetchRecall() {
    if (lang === 'en' || !accountScope || !sessions[cur] || sessions[cur].msgs.length) return Promise.resolve(null);
    const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    const t = setTimeout(() => { try { ctrl && ctrl.abort(); } catch (_) {} }, 2500);
    return fetch('/api/ai/recall', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-AH-Guest': guestId() },
      body: JSON.stringify({ stats: localStats(), recent: recentMistakes(), profile: profilePayload() }),
      signal: ctrl ? ctrl.signal : undefined
    }).then((r) => (r.ok ? r.json() : null)).then((j) => {
      const rc = j && j.recall;
      return rc && typeof rc.line === 'string' && rc.line ? rc : null;
    }).catch(() => null).finally(() => clearTimeout(t));
  }
  function showRecall(rc, greet) {
    if (sessions[cur].msgs.length) return;
    if (!rc) { say(greet, 4200); return; }
    { const sy = document.getElementById('say'); if (sy) sy.classList.add('long'); }
    say(String(rc.line).slice(0, 300), 15000);
    const btn = rc.button;
    const bub = document.querySelector('#hero .bub');
    if (!btn || !btn.prompt || !bub) return;
    let el = document.getElementById('skyRecallBtn');
    if (!el) { el = document.createElement('button'); el.type = 'button'; el.id = 'skyRecallBtn'; el.className = 'recallb'; bub.insertAdjacentElement('afterend', el); }
    el.textContent = String(btn.label || 'শুরু করি').slice(0, 60);
    el.onclick = () => { el.remove(); send(String(btn.prompt).slice(0, 300)); };
  }
  function resetHero() {
    const hero = document.getElementById('hero');
    if (hero) hero.style.display = '';
    { const ob = document.getElementById('skyRecallBtn'); if (ob) ob.remove(); const sy = document.getElementById('say'); if (sy) sy.classList.remove('long'); }
    const app = document.getElementById('app');
    if (app) app.classList.remove('chatting');
    say('নতুন কথা শুরু করি, কী জানতে চাও?', 3200);
  }

  /* ───────── avatar animation engine (owner's Sky) ───────── */
  let birds = [], curA = [], lk, mt, lastMsg = 0, lastAct = -1, nextT, sleepT, dozing = 0, busyA = 0;
  const k = (o, ...a) => a.map((t) => ({ transform: t, ...(o ? { transformOrigin: o } : {}) }));
  function A(sel, kf, ms, o) {
    o = o || {};
    vis().forEach((b) => b.querySelectorAll(sel).forEach((el) => curA.push(el.animate(kf, { duration: ms, iterations: Infinity, easing: 'ease-in-out', ...o }))));
  }
  function vis() { return birds.filter((b) => b.getBoundingClientRect().width); }
  function mood(s, ms) { birds.forEach((b) => b.dataset.s = s); clearTimeout(mt); if (ms) mt = setTimeout(() => mood('idle'), ms); }
  function look(x, y) { birds.forEach((b) => b.querySelectorAll('.pup').forEach((p) => p.style.transform = 'translate(' + x + 'px,' + y + 'px)')); }
  function lookSeq(a, ms) { clearInterval(lk); let i = 0; look(...a[0]); if (a.length > 1) lk = setInterval(() => look(...a[++i % a.length]), ms); }
  function say(t, ms) {
    const el = document.getElementById('app').classList.contains('chatting') ? document.getElementById('say2') : document.getElementById('say');
    if (!el) return;
    el.textContent = t; el.classList.add('on'); clearTimeout(say.t);
    say.t = setTimeout(() => el.classList.remove('on'), ms || 3800); lastMsg = Date.now();
  }
  function end() { clearTimeout(stopT); curA.forEach((a) => { try { a.cancel(); } catch (_) {} }); curA = []; clearInterval(lk); birds.forEach((b) => delete b.dataset.p); look(0, 0); if (!busy && birds[0] && birds[0].dataset.s === 'think') mood('idle'); }
  const tap = (d) => [k('', 'translateY(0)', 'translateY(-5px)', 'translateY(0)'), 260, { delay: d || 0 }];
  let stopT;
  /* activities: [name, prop, ms, fn, time-tags(m a e n | *), messages] */
  const ACT=[
['typing','lap',7000,()=>{A('.hl2',...tap());A('.hr2',...tap(130));A('.all',k('','rotate(0)','rotate(1.5deg)','rotate(0)'),2400);lookSeq([[0,6],[-2,6],[2,6],[0,6],[0,-2]],700)},'aen',['প্রশ্ন সাজাচ্ছি, চাইলে MCQ বানিয়ে দিই?']],
['reading','book',8000,()=>{A('.pgf',[{transform:'scaleX(1)'},{transform:'scaleX(1)',offset:.75},{transform:'scaleX(-1)'}],3600,{easing:'ease-in'});A('.all',k('','rotate(0)','rotate(-1.5deg)','rotate(0)'),3000);lookSeq([[-6,6],[-2,6],[2,6],[6,6],[-6,7]],650)},'amen',['তুমি আজ কোন টপিক পড়ছো?','পড়ার সময় মোবাইল দূরে রাখো']],
['writing','note',6500,()=>{const f=k('','translate(0,0)','translate(-8px,2px)','translate(-2px,5px)','translate(-10px,7px)','translate(0,0)');A('.pen',f,1600);A('.hr2',f,1600);lookSeq([[-3,6],[0,6],[3,6]],900)},'am',['ছোট নোট লিখে রাখলে মনে থাকে বেশি']],
['sipping','cup',4400,()=>{const f=[{transform:'translate(0,0) rotate(0)'},{transform:'translate(0,0) rotate(0)',offset:.25},{transform:'translate(-18px,-24px) rotate(-18deg)',offset:.45},{transform:'translate(-18px,-24px) rotate(-18deg)',offset:.65},{transform:'translate(0,0) rotate(0)'}];A('.cup',f,4200,{iterations:1});A('.hr2',f,4200,{iterations:1});A('.eyes',[{transform:'scaleY(1)'},{transform:'scaleY(1)',offset:.4},{transform:'scaleY(.15)',offset:.5},{transform:'scaleY(.15)',offset:.65},{transform:'scaleY(1)',offset:.75},{transform:'scaleY(1)'}],4200,{iterations:1})},'man',['পড়ার ফাঁকে পানি খেয়ে নাও','এক কাপ চা-কফির সময় কি হলো?']],
['searching','mag',5500,()=>{const f=k('','translateX(-34px)','translateX(10px)','translateX(-10px)','translateX(-34px)');A('.mag',f,3000);A('.hr2',f,3000);lookSeq([[-6,5],[4,5],[0,5]],900)},'a*',['কিছু যাচাই করতে চাইলে বলো, খুঁজে দেখি']],
['calc','calc',5500,()=>{A('.hl2',...tap());A('.hr2',...tap(150));A('.br',k('','translateY(0)','translateY(-4px)','translateY(0)'),2600);lookSeq([[0,6],[0,-3],[0,6]],1000)},'a',['অংক আটকে গেলে ধাপে ধাপে দেখিয়ে দেব']],
['music','ph',7000,()=>{A('.all',k('','translateY(0) rotate(0)','translateY(-5px) rotate(-3deg)','translateY(0) rotate(0)','translateY(-5px) rotate(3deg)'),1400);A('.wl',k('','rotate(10deg)','rotate(32deg)','rotate(10deg)'),700);A('.wr',k('','rotate(-10deg)','rotate(-32deg)','rotate(-10deg)'),700,{delay:350})},'ea',['মনোযোগ দরকার? বিনা কথার মিউজিক শুনে দেখো']],
['dance','ph',5000,()=>{A('.all',k('','translateX(0) rotate(0)','translateX(-9px) rotate(-6deg)','translateX(9px) rotate(6deg)','translateX(0) rotate(0)'),900);A('.wl',k('','rotate(10deg)','rotate(60deg)','rotate(10deg)'),450);A('.wr',k('','rotate(-10deg)','rotate(-60deg)','rotate(-10deg)'),450,{delay:225})},'e',[]],
['think','',3800,()=>{mood('think');lookSeq([[5,-5]],1e9)},'*',[]],
['idea','',2800,()=>{A('.bulb',[{transform:'scale(.2)',opacity:0},{transform:'scale(1.15)',opacity:1,offset:.25},{transform:'scale(1)',opacity:1,offset:.85},{transform:'scale(.2)',opacity:0}],2600,{iterations:1,transformOrigin:'100px 20px'});A('.all',k('','translateY(0)','translateY(-14px)','translateY(0)'),900,{iterations:1,delay:500})},'*',['একটা ভালো আইডিয়া, ছোট একটা কুইজ দিই?']],
['stretch','',2400,()=>{A('.all',k('','scaleY(1)','scaleY(1.14) translateY(-4px)','scaleY(1)'),2200,{iterations:1});A('.wl',k('','rotate(10deg)','rotate(120deg)','rotate(10deg)'),2200,{iterations:1});A('.wr',k('','rotate(-10deg)','rotate(-120deg)','rotate(-10deg)'),2200,{iterations:1})},'ma',['৪৫ মিনিট পড়ে ৫ মিনিট বিরতি নাও']],
['yawn','',2800,()=>{A('.eyes',k('100px 104px','scaleY(1)','scaleY(.1)','scaleY(.1)','scaleY(1)'),2600,{iterations:1});A('.jaw',k('','translateY(0)','translateY(8px)','translateY(8px)','translateY(0)'),2600,{iterations:1});A('.all',k('','scaleY(1)','scaleY(1.06)','scaleY(1)'),2600,{iterations:1})},'n',['ঘুম কম হলে মনেও থাকে কম, আজ ঠিকমতো ঘুমিও']],
['look','',3200,()=>lookSeq([[-6,0],[6,0],[0,-5],[-4,3],[0,0]],620),'*',[]],
['wave','',1800,()=>{A('.wr',k('','rotate(-10deg)','rotate(-105deg)','rotate(-65deg)','rotate(-105deg)','rotate(-65deg)','rotate(-10deg)'),1700,{iterations:1})},'*',[]],
['doze','zz',6500,()=>{A('.all',k('','rotate(0)','rotate(5deg) translateY(4px)','rotate(0)'),2600);A('.eyes',k('100px 104px','scaleY(1)','scaleY(.15)','scaleY(1)'),2600)},'n',[]],
['breathe','',4200,()=>{A('.all',k('','scale(1)','scale(1.045)','scale(1)'),2600);A('.eyes',k('100px 104px','scaleY(1)','scaleY(.2)','scaleY(1)'),3400)},'*',['একটু গভীর শ্বাস নাও, তারপর আবার শুরু']],
['clap','',1700,()=>{A('.wl',k('','rotate(10deg)','rotate(55deg)','rotate(20deg)','rotate(55deg)','rotate(20deg)','rotate(55deg)','rotate(10deg)'),1500,{iterations:1});A('.wr',k('','rotate(-10deg)','rotate(-55deg)','rotate(-20deg)','rotate(-55deg)','rotate(-20deg)','rotate(-55deg)','rotate(-10deg)'),1500,{iterations:1})},'*',[]],
['hop','',1200,()=>A('.all',k('','translateY(0)','translateY(-24px)','translateY(0)','translateY(-14px)','translateY(0)'),1000,{iterations:1}),'*',[]],
['capTip','',1700,()=>{A('.cap',k('','translateY(0) rotate(0)','translateY(-10px) rotate(-14deg)','translateY(-10px) rotate(-14deg)','translateY(0) rotate(0)'),1500,{iterations:1});A('.br',k('','translateY(0)','translateY(-6px)','translateY(0)'),1500,{iterations:1})},'*',[]],
['tassel','',1500,()=>A('.tas',k('150px 60px','rotate(0)','rotate(360deg)','rotate(720deg)'),1400,{iterations:1}),'*',[]],
['bow','',1800,()=>A('.all',k('100px 190px','rotate(0)','rotate(22deg) translateY(4px)','rotate(22deg) translateY(4px)','rotate(0)'),1600,{iterations:1}),'m',[]],
['peek','',2000,()=>A('.all',k('','translateY(0)','translateY(130px)','translateY(130px)','translateY(-18px)','translateY(0)'),1800,{iterations:1}),'*',[]],
['fly','',2800,()=>{A('.all',k('','translate(0,0) rotate(0)','translate(-70px,-56px) rotate(-14deg)','translate(0,-96px) rotate(0)','translate(70px,-56px) rotate(14deg)','translate(0,0)'),2600,{iterations:1});A('.wl',[{transform:'rotate(15deg)'},{transform:'rotate(70deg)'}],170,{direction:'alternate'});A('.wr',[{transform:'rotate(-15deg)'},{transform:'rotate(-70deg)'}],170,{direction:'alternate'})},'*',[]],
['sneeze','',1200,()=>{A('.all',k('','scale(1)','scale(1.1) translateY(2px)','scale(.94) translateY(-4px) rotate(4deg)','scale(1)'),1000,{iterations:1});A('.jaw',k('','translateY(0)','translateY(6px)','translateY(0)'),1000,{iterations:1})},'*',[]],
['blink','',1300,()=>{A('.eyes',k('100px 104px','scaleY(1)','scaleY(.1)','scaleY(1)','scaleY(.1)','scaleY(1)'),1100,{iterations:1});A('.br',k('','translateY(0)','translateY(-6px)','translateY(0)'),1100,{iterations:1})},'*',[]],
['nod','',1300,()=>A('.all',k('','translateY(0) scaleY(1)','translateY(5px) scaleY(.94)','translateY(0)','translateY(5px) scaleY(.94)','translateY(0)'),1000,{iterations:1}),'*',[]],
['shake','',1200,()=>A('.all',k('','rotate(0)','rotate(-9deg)','rotate(9deg)','rotate(-9deg)','rotate(0)'),900,{iterations:1}),'*',[]],
['flip','',1400,()=>A('.all',k('','scaleX(1)','scaleX(.05)','scaleX(-1)','scaleX(.05)','scaleX(1)'),1200,{iterations:1}),'*',[]],
['backflip','',1500,()=>A('.all',k('100px 110px','translateY(0) rotate(0)','translateY(-56px) rotate(-180deg)','translateY(0) rotate(-360deg)'),1300,{iterations:1}),'*',[]],
['sidestep','',1600,()=>A('.all',k('','translateX(0) rotate(0)','translateX(34px) rotate(8deg)','translateX(34px) rotate(-6deg)','translateX(0) rotate(0)'),1400,{iterations:1}),'*',[]],
['squash','',1200,()=>A('.all',k('','scale(1,1)','scale(1.12,.88)','scale(.92,1.1)','scale(1.05,.96)','scale(1,1)'),1000,{iterations:1}),'*',[]]
];
  const period = () => { const h = new Date().getHours(); return h < 5 || h >= 22 ? 'n' : h < 12 ? 'm' : h < 17 ? 'a' : 'e'; };
  function startAct(i) {
    end(); lastAct = i;
    const a = ACT[i]; const pr = a[1], ms = a[2], fn = a[3], m = a[5];
    if (pr) birds.forEach((b) => b.dataset.p = pr);
    fn();
    if (m.length && Date.now() - lastMsg > 20000 && Math.random() < .5) setTimeout(() => say(pick(m)), 600);
    stopT = setTimeout(() => { end(); loop(); }, ms);
  }
  function calm() { return busyA || (inpEl && inpEl.value) || document.activeElement === inpEl || dozing || (birds[0] && birds[0].dataset.s !== 'idle'); }
  function loop() {
    clearTimeout(nextT);
    nextT = setTimeout(() => {
      const app = document.getElementById('app');
      const chat = app && app.classList.contains('chatting');
      if (calm() || (chat && Math.random() < .6)) { loop(); return; }
      const p = period();
      const c = ACT.map((a, i) => i).filter((i) => i !== lastAct && (ACT[i][4].indexOf('*') >= 0 || ACT[i][4].indexOf(p) >= 0));
      if (c.length) startAct(pick(c));
      else loop();
    }, 2200 + Math.random() * 2400);
  }
  function sleepNow() { end(); dozing = 1; mood('sleep'); }
  function wake() {
    clearTimeout(sleepT);
    if (dozing) { dozing = 0; mood('wave', 1600); say('আবার স্বাগতম! কী পড়বে আজ?'); }
    sleepT = setTimeout(() => { if (!busyA && inpEl && !inpEl.value) sleepNow(); }, 45000);
  }

  /* ───────── drawer / sheet ───────── */
  function layer(on, el) {
    const scrim = document.getElementById('scrim');
    scrim.classList.toggle('on', !!on);
    if (!on) { document.getElementById('drawer').classList.remove('on'); document.getElementById('sheet').classList.remove('on'); }
    else el.classList.add('on');
  }
  function closeLayers() { layer(false); }

  function renderList(q) {
    q = q || '';
    const g = {};
    sessions.forEach((s, i) => {
      const name = s.name || T.untitled;
      if (q && name.toLowerCase().indexOf(q.toLowerCase()) < 0) return;
      const day = i === 0 ? 'আজ' : new Date(s.ts).toLocaleDateString('bn-BD', { day: 'numeric', month: 'short' });
      (g[day] = g[day] || []).push([name, i]);
    });
    const keys = Object.keys(g);
    document.getElementById('hl').innerHTML = keys.length ? keys.map((n) => '<div class="gl">' + n + '</div>' + g[n].map(([t, i]) => '<div class="hi' + (i === cur ? ' act' : '') + '" data-i="' + i + '"><div class="hr1"><button class="it">' + ic('chat') + '<span>' + esc(t) + '</span></button><button class="mo" data-m aria-label="' + T.menu + '">' + ic('dots') + '</button></div><div class="ha"><button data-ren="' + i + '">' + ic('pin') + T.ren + '</button><button data-del="' + i + '">' + ic('trash') + T.del + '</button></div></div>').join('')).join('') : '<div class="gl">' + T.noHit + '</div>';
  }

  function backHome() {
    try {
      document.documentElement.classList.remove('ai-chat-open');
      const a = document.getElementById('app'); if (a) { a.classList.remove('ai-chat-open', 'sky'); a.style.height = a.style.top = a.style.bottom = a.style.paddingBottom = ''; } try { syncAppChrome(); } catch (_) {}
      const nb = document.querySelector('.bottomnav'); if (nb) nb.style.display = '';
    } catch (_) {}
    if (window.navigate) window.navigate('dashboard'); else history.back();
  }

  /* ───────── render + wire ───────── */
  function render() {
    const root = document.getElementById('app') || document.body;
    if (!document.getElementById('skyCss')) {
      const st = document.createElement('style'); st.id = 'skyCss'; st.textContent = CSS;
      document.head.appendChild(st);
    }
    /* The host fires admissionhub:authchange on sign-in, but a returning student
       is already signed in before this page renders. Read the current scope so
       they get their own history instead of an empty guest session. */
    try {
      const d = document.documentElement;
      const uid = (window.__ahAccountScope || (window.AHAuth && typeof window.AHAuth.getUser === 'function' && (window.AHAuth.getUser() || {}).uid) || '').toString();
      if (uid && /^[A-Za-z0-9_-]{8,128}$/.test(uid)) accountScope = uid;
    } catch (_) {}
    load();
    root.className = 'sky';
    try { syncAppChrome(); } catch (_) {}
    root.classList.add('ai-chat-open');
    root.innerHTML = shell();
    try { document.documentElement.classList.add('ai-chat-open'); } catch (_) {}
    const navBar = document.querySelector('.bottomnav'); if (navBar) navBar.style.display = 'none';

    msgsEl = document.getElementById('msgs');
    try { if (window.SkySmallTalk && window.SkySmallTalk.ready) window.SkySmallTalk.ready(); } catch (_) {}
    mainEl = document.getElementById('chat');
    inpEl = document.getElementById('inp');
    actEl = document.getElementById('actB');
    birds = [...document.querySelectorAll('.av:not(.xs)')];
    document.getElementById('hbig').innerHTML = av();
    document.getElementById('hbw').innerHTML = av();
    document.getElementById('dw').innerHTML = av('xs');

    paintTheme();
    renderMsgs();
    if (sessions[cur].msgs.length) document.getElementById('hero').style.display = 'none';

    /* hero greeting, time based, honest, no fake content */
    const H = new Date().getHours();
    const greet = H < 5 ? 'এত রাতে জেগে? আজ একটু কম পড়ে ঘুমিয়ে নাও' : H < 12 ? 'শুভ সকাল! আজ কোন বিষয় দিয়ে শুরু করবে?' : H < 16 ? 'শুভ দুপুর! পড়ার সময় হলো, কী ধরবে?' : H < 19 ? 'শুভ বিকেল! আজকের পড়ার রিভিশন দেবে?' : 'শুভ সন্ধ্যা! আজকের পড়া কতদূর?';
    mood('wave', 2200);
    const recallP = fetchRecall();
    setTimeout(() => { recallP.then((rc) => showRecall(rc, greet)); }, 900);
    loop(); wake();
    const askMsg = ['বাংলা, ইংরেজি, GK, কোনটা দিয়ে শুরু?', 'শেষ কবে রিভিশন দিয়েছিলে?', 'Mistake Bank-এ নতুন ভুল জমেছে কি?', 'পরীক্ষার আগে একটা Mock Test দিয়েছো?', 'ছবি তুলে প্রশ্ন পাঠালেও আমি বুঝে নেব', 'Smart Revision করলে বেশি দিন মনে থাকে', 'আজকের পড়ার লক্ষ্য কত?'];
    clearInterval(window.__skyNudge);
    window.__skyNudge = setInterval(() => {
      const a = document.getElementById('app');
      if (!a || !a.classList.contains('sky')) { clearInterval(window.__skyNudge); return; }
      if (!calm() && Date.now() - lastMsg > 40000 && !a.classList.contains('chatting')) say(pick(askMsg));
    }, 9000);

    /* composer */
    inpEl.oninput = () => {
      inpEl.style.height = 'auto'; inpEl.style.height = Math.min(inpEl.scrollHeight, 120) + 'px';
      const h = inpEl.value.trim();
      if (!busy) { if (h) { mood('listen'); clearTimeout(inpEl._lt); inpEl._lt = setTimeout(() => { if (!busy) mood('idle'); }, 2500); } else mood('idle'); }
      actEl.className = 'cb' + (h ? ' send' : '');
      actEl.innerHTML = ic(busy ? 'stop' : h ? 'send' : 'mic');
      look(Math.sin(inpEl.value.length / 2) * 3, 5);
    };
    inpEl.onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); actEl.click(); } };
    inpEl.onfocus = () => { end(); mood('type'); look(0, 5); const a = document.getElementById('app'); if (Date.now() - lastMsg > 15000 && a && !a.classList.contains('chatting')) say('বলো, আমি শুনছি', 2600); };
    inpEl.onblur = () => { if (!busy) mood('idle'); look(0, 0); loop(); };
    /* Mic is the default composer action, so it must actually listen. Falls back
       to a plain hint where the browser has no speech engine rather than sitting
       there as a dead button. */
    let rec = null, recOn = false;
    function voiceIn() {
      const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SR) { say('এই ব্রাউজারে ভয়েস শোনা যায় না, লিখে পাঠাও।', 3200); return; }
      if (recOn) { try { rec.stop(); } catch (_) {} return; }
      try {
        rec = new SR();
        rec.lang = lang === 'en' ? 'en-US' : 'bn-BD';
        rec.interimResults = true;
        rec.continuous = false;
        rec.onstart = () => { recOn = true; actEl.innerHTML = ic('stop'); say('শুনছি…', 6000); mood('type'); };
        rec.onerror = () => { recOn = false; setBusy(false); say('শুনতে পারিনি, আবার চেষ্টা করো।', 2600); };
        rec.onend = () => { recOn = false; setBusy(false); inpEl.focus(); };
        rec.onresult = (e) => {
          let t = '';
          for (let i = e.resultIndex; i < e.results.length; i++) t += e.results[i][0].transcript;
          inpEl.value = t.trim();
          inpEl.oninput();
          if (e.results[e.results.length - 1].isFinal) { try { rec.stop(); } catch (_) {} send(); }
        };
        rec.start();
      } catch (_) { recOn = false; say('ভয়েস চালু করা গেল না।', 2600); }
    }
    actEl.onclick = () => { if (busy) stop(); else if (inpEl.value.trim()) send(); else voiceIn(); };

    /* message actions + question chips */
    msgsEl.addEventListener('click', (e) => {
      const qb = e.target.closest('.qz .qb');
      if (qb) { quizTap(qb); return; }
      const ph = e.target.closest('.proc .ph');
      if (ph) { ph.parentNode.classList.toggle('open'); return; }
      const c = e.target.closest('[data-c]');
      if (c) { const m = sessions[cur].msgs[+c.getAttribute('data-c')]; try { navigator.clipboard.writeText(m.text); } catch (_) {} say(T.copied, 1600); return; }
      const r = e.target.closest('[data-r]');
      if (r) { const i = +r.getAttribute('data-r'); const prev = sessions[cur].msgs[i - 1]; if (prev && prev.role === 'user') { sessions[cur].msgs.splice(i, 1); save(); renderMsgs(); send(prev.text); } return; }
      const g = e.target.closest('[data-g]');
      if (g) { g.classList.add('on'); say('ধন্যবাদ!', 1600); return; }
      const tg = e.target.closest('[data-tgo]');
      if (tg) {
        const p = tg.getAttribute('data-tgo');
        const sb = document.querySelector('[data-go="' + p + '"]');
        if (sb) { sb.click(); return; }
        closeLayers(); layer(false);
        try {
          document.documentElement.classList.remove('ai-chat-open');
          const a = document.getElementById('app'); if (a) { a.classList.remove('ai-chat-open', 'sky'); ['height', 'top', 'bottom', 'paddingBottom'].forEach((k) => { a.style[k] = ''; }); } try { syncAppChrome(); } catch (_) {}
          const nb = document.querySelector('.bottomnav'); if (nb) nb.style.display = '';
        } catch (_) {}
        if (window.navigate) window.navigate(p); else location.hash = p;
        return;
      }
      const q = e.target.closest('[data-q]');
      if (q) { closeLayers(); send(q.getAttribute('data-q')); return; }
    });
    document.addEventListener('click', (e) => {
      const q = e.target.closest('[data-q]');
      if (q && q.closest('#sheet')) { closeLayers(); send(q.getAttribute('data-q')); }
    });

    /* header */
    document.getElementById('menuB').onclick = () => { renderList(document.getElementById('hs').value); layer(true, document.getElementById('drawer')); };
    document.getElementById('newB').onclick = newChat;
    document.getElementById('homeB').onclick = backHome;
    document.getElementById('exitD').onclick = backHome;
    document.getElementById('closeD').onclick = () => layer(false);
    document.getElementById('scrim').onclick = () => layer(false);
    document.getElementById('plusB').onclick = () => { inpEl.blur(); layer(true, document.getElementById('sheet')); };
    document.getElementById('newD').onclick = newChat;

    /* Theme buttons drive BOTH engines. phase1-upgrade owns the app's real
       theme, so a tap that only moved AhAppearance left the app and the chat
       disagreeing - the fault the owner reported as white boxes in dark mode. */
    document.getElementById('th').onclick = (e) => {
      const b = e.target.closest('button'); if (!b) return;
      const t = b.getAttribute('data-t');
      try {
        if (window.AhAppearance && window.AhAppearance.set) window.AhAppearance.set(t === 'auto' ? 'system' : t);
      } catch (_) {}
      try {
        if (typeof window.setTheme === 'function') window.setTheme(t === 'dark' ? 'midnight-academic' : 'emerald-glass');
      } catch (_) {}
      paintTheme();
    };

    /* session list */
    document.getElementById('hs').oninput = (e) => renderList(e.target.value);
    document.getElementById('hl').onclick = (e) => {
      const hi = e.target.closest('.hi'); if (!hi) return;
      const i = +hi.getAttribute('data-i');
      if (e.target.closest('[data-m]')) { hi.classList.toggle('open'); return; }
      if (e.target.closest('[data-del]')) {
        sessions.splice(i, 1);
        if (!sessions.length) sessions = [{ name: '', msgs: [], ts: Date.now() }];
        cur = Math.min(cur, sessions.length - 1); save(); renderMsgs(); renderList(document.getElementById('hs').value);
        if (!sessions[cur].msgs.length) resetHero();
        return;
      }
      if (e.target.closest('[data-ren]')) {
        const v = prompt('নতুন নাম:', sessions[i].name || '');
        if (v != null) { sessions[i].name = String(v).slice(0, 60); save(); renderList(document.getElementById('hs').value); }
        return;
      }
      if (e.target.closest('.it')) { cur = i; save(); renderMsgs(); layer(false); if (!sessions[cur].msgs.length) resetHero(); }
    };

    /* in-app navigation hooks */
    document.querySelectorAll('[data-go]').forEach((b) => {
      b.onclick = () => {
        const p = b.getAttribute('data-go');
        layer(false);
        try {
          document.documentElement.classList.remove('ai-chat-open');
          const a = document.getElementById('app'); if (a) { a.classList.remove('ai-chat-open', 'sky'); a.style.height = a.style.top = a.style.bottom = a.style.paddingBottom = ''; } try { syncAppChrome(); } catch (_) {}
          const nb = document.querySelector('.bottomnav'); if (nb) nb.style.display = '';
        } catch (_) {}
        if (window.navigate) window.navigate(p); else location.hash = p;
      };
    });

    /* attachments, open the app's own pickers where it has them */
    const pick_ = (accept) => { const f = document.getElementById('filePick'); f.accept = accept; f.value = ''; f.click(); };
    document.getElementById('camB').onclick = () => pick_('image/*');
    document.getElementById('imgB').onclick = () => pick_('image/*');
    document.getElementById('docB').onclick = () => pick_('*/*');
    document.getElementById('vidB').onclick = () => pick_('video/*');
    document.getElementById('filePick').onchange = (e) => {
      const f = e.target.files && e.target.files[0];
      layer(false);
      if (!f) return;
      say('ফাইলটা দেখা হচ্ছে, এই ফিচারটা অ্যাপের নিজের পাঠানোর জায়গা থেকে কাজ করে।', 4200);
    };

    /* pet the avatar */
    const pet = () => {
      const i = pick([...ACT.keys()].filter((x) => ['wave', 'hop', 'capTip', 'clap', 'backflip', 'bow', 'fly', 'tassel', 'nod'].indexOf(ACT[x][0]) >= 0));
      startAct(i);
      say(pick(['বলো, কী জানতে চাও?', 'প্রশ্ন লিখে ফেলো, আমি আছি', 'কোনো টপিক বুঝতে সমস্যা হচ্ছে?', '১০টা MCQ দিয়ে শুরু করবে?', 'গতকালের ভুলগুলো একবার দেখে নেবে?', 'কোন সাবজেক্টে সাহায্য লাগবে?']));
    };
    document.getElementById('hbig').onclick = pet;
    document.getElementById('hbw').onclick = pet;
    addEventListener('pointermove', (e) => {
      if (document.activeElement === inpEl || dozing || (birds[0] && birds[0].dataset.p)) return;
      const b = document.getElementById('app').classList.contains('chatting') ? birds[0] : birds[1];
      if (!b) return;
      const r = b.getBoundingClientRect();
      const dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
      const d = Math.hypot(dx, dy) || 1, kk = Math.min(5, d / 40);
      look(dx / d * kk, dy / d * kk);
    });
    ['pointerdown', 'keydown'].forEach((ev) => addEventListener(ev, wake));

    /* follow the app's appearance engine live */
    try { window.addEventListener('ah:appearance', paintTheme); } catch (_) {}
    try { if (window.matchMedia) matchMedia('(prefers-color-scheme: dark)').addEventListener('change', paintTheme); } catch (_) {}
    /* phase1's setTheme rewrites <html data-theme> in place and fires no event,
       so watch the attribute itself or a theme switch while the chat is open
       would not repaint it. */
    try {
      new MutationObserver(paintTheme).observe(document.documentElement, {
        attributes: true, attributeFilter: ['data-theme'],
      });
    } catch (_) {}
    try {
      if (window.visualViewport) {
        /* The soft keyboard shrinks visualViewport without resizing the layout
           viewport. The dock is bottom-anchored inside a fixed, full-height
           shell, so without this it stays under the keyboard and the composer
           is invisible while typing. Size the shell to the VISIBLE height and
           pin it to the visual viewport's top, which keeps the composer just
           above the keyboard the way a chat input should sit. */
        const vv = window.visualViewport;
        const fitKeyboard = () => {
          const a = document.getElementById('app');
          if (!a || !a.classList.contains('sky')) return;
          const kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
          a.style.height = vv.height + 'px';
          a.style.top = vv.offsetTop + 'px';
          a.style.bottom = 'auto';
          a.style.paddingBottom = kb > 0 ? '0px' : '';
          if (kb > 0 && msgsEl) msgsEl.scrollIntoView({ block: 'end' });
        };
        vv.addEventListener('resize', fitKeyboard);
        vv.addEventListener('scroll', fitKeyboard);
        window.__skyFitKeyboard = fitKeyboard;
      }
    } catch (_) {}

    /* drawer swipe */
    let sx = 0, dx0 = 0, dr = 0;
    const drawer = document.getElementById('drawer');
    drawer.addEventListener('touchstart', (e) => { sx = e.touches[0].clientX; dr = 1; dx0 = 0; drawer.classList.add('drag'); }, { passive: true });
    drawer.addEventListener('touchmove', (e) => { if (!dr) return; dx0 = Math.min(0, e.touches[0].clientX - sx); drawer.style.transform = 'translateX(' + dx0 + 'px)'; }, { passive: true });
    drawer.addEventListener('touchend', () => { dr = 0; drawer.classList.remove('drag'); drawer.style.transform = ''; if (dx0 < -70) layer(false); });
    let ex = 0;
    const app = document.getElementById('app');
    app.addEventListener('touchstart', (e) => { ex = e.touches[0].clientX < 16 ? e.touches[0].clientX : -1; }, { passive: true });
    app.addEventListener('touchend', (e) => { if (ex >= 0 && e.changedTouches[0].clientX - ex > 60) layer(true, drawer); ex = -1; });

    setBusy(false);
  }

  window.renderAiAgentPage = render;
  window.addEventListener('hashchange', () => {
    try {
      const p = (location.hash.slice(1).split('?')[0] || '').toLowerCase();
      if (p !== 'ai' && p !== 'ai-chat') {
        document.documentElement.classList.remove('ai-chat-open');
        const a = document.getElementById('app'); if (a) { a.classList.remove('ai-chat-open', 'sky'); a.style.height = a.style.top = a.style.bottom = a.style.paddingBottom = ''; } try { syncAppChrome(); } catch (_) {}
        const nb = document.querySelector('.bottomnav'); if (nb) nb.style.display = '';
      }
    } catch (_) {}
  });
})();
