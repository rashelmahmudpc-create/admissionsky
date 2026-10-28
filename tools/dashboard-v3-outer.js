/* ============================================================
   DASHBOARD v3, Scholar Dashboard (owner's design, ২০২৬-১০-১৫)
   The owner supplied the design; it is rendered in an isolated full-screen
   frame so the layout is pixel-for-pixel what he approved. This file is the
   host half: it turns the app's real CACHE data into the frame's data model
   and routes the frame's button taps back into the app.

   নিয়ম:
   • ডেটা-ইঞ্জিন/DB/অন্য-পৃষ্ঠা স্পর্শ করে না, শুধু dashboard-দৃশ্য।
   • সব সংখ্যা CACHE (সত্যিকারের ব্যবহারকারী-ডেটা) থেকে; কোনো ডেমো/বানানো সংখ্যা নেই।
   • ডেটা নেই → সৎ শূন্য-অবস্থা + কর্ম-বাটন (কখনো ভাঙা লেআউট নয়)।
   • থিম অ্যাপেরই (AhAppearance); ফ্রেম কখনো আলাদা থিম রাখে না।
   ============================================================ */
(function () {
  'use strict';
  if (window.__dashboardV2Installed) return;
  window.__dashboardV2Installed = true;

  const FRAME_HTML = /*__SRCDOC__*/ '';

  const DAY = 86400000;
  const keyOf = (ts) => { const d = new Date(ts || Date.now()); const p = (n) => String(n).padStart(2, '0'); return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()); };
  const num = (v) => Number(v) || 0;
  const escv = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  /* CACHE রেজলভার: index.html-এ `const CACHE` (ক্লাসিক-স্ক্রিপ্ট টপ-লেভেল const) window-এ যায় না -
     তাই প্রথমে window, পরে গ্লোবাল-লেক্সিকাল (typeof-গার্ড), শেষ-ফলব্যাক {}, কোনো অবস্থায় ক্র্যাশ নয়। */
  const C = () => {
    try {
      if (window.CACHE) return window.CACHE;
      if (typeof CACHE !== 'undefined' && CACHE) return CACHE;
    } catch (_) {}
    return {};
  };
  const DSTATS = () => {
    const m = {};
    (C().dailyStats || []).forEach((s) => {
      const k = keyOf(new Date(num(s.date) || num(s.id) || Date.now()));
      m[k] = s;
      if (typeof s.id === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s.id)) m[s.id] = s;
    });
    return m;
  };
  const dayStat = (map, ts) => {
    const s = map[keyOf(ts)] || {};
    const c = num(s.correct), w = num(s.wrong);
    return { q: num(s.questions), c, w, time: num(s.timeMs), exams: num(s.exams) };
  };

  /* ── ৭ দিনের সিরিজ (প্রশ্ন + সঠিকতা) ── */
  function weekSeries() {
    const map = DSTATS();
    const out = [];
    for (let i = 6; i >= 0; i--) {
      const ts = Date.now() - i * DAY;
      const d = dayStat(map, ts);
      const ans = d.c + d.w;
      out.push({ k: keyOf(ts), q: d.q, acc: ans ? Math.round(d.c / ans * 100) : null });
    }
    return out;
  }
  const todayStats = () => dayStat(DSTATS(), Date.now());
  function streakDays() {
    const map = DSTATS();
    let run = 0;
    for (let i = 0; i < 400; i++) {
      const s = map[keyOf(Date.now() - i * DAY)];
      if (s && num(s.questions) > 0) run++; else { if (i === 0) continue; break; }
    }
    return run;
  }

  /* ── টপিক-দুর্বলতা (examResults-স্ন্যাপশট) ── */
  function topicRows() {
    const agg = {};
    (C().examResults || []).forEach((r) => (r.snapshot || []).forEach((q) => {
      if (!q || !q.topicId || (q.status !== 'correct' && q.status !== 'wrong')) return;
      const a = agg[q.topicId] || (agg[q.topicId] = { n: 0, c: 0 });
      a.n++; if (q.status === 'correct') a.c++;
    }));
    return Object.keys(agg).map((tid) => {
      const a = agg[tid];
      const name = (typeof window.topicName === 'function' ? window.topicName(tid) : '') || 'টপিক';
      return { tid, n: name, v: Math.round(a.c / a.n * 100), cnt: a.n };
    }).filter((x) => x.cnt >= 1).sort((x, y) => x.v - y.v);
  }

  /* ── আজকের বিষয়ভিত্তিক অগ্রগতি (mission-chips) ── */
  function missionSubjects(target, today) {
    const by = {};
    (C().examResults || []).forEach((r) => {
      const ts = num(r.date || r.createdAt || r.finishedAt || r.endedAt || 0);
      if (!ts || keyOf(ts) !== keyOf(Date.now())) return;
      (r.snapshot || []).forEach((q) => {
        if (!q || !q.subjectId || (q.status !== 'correct' && q.status !== 'wrong')) return;
        by[q.subjectId] = (by[q.subjectId] || 0) + 1;
      });
    });
    const ids = Object.keys(by).sort((a, b) => by[b] - by[a]).slice(0, 3);
    if (!ids.length) return [{ n: 'আজ', done: Math.min(target, today.q), total: target }];
    const share = Math.max(1, Math.round(target / ids.length));
    return ids.map((sid) => ({
      n: (typeof window.subjectName === 'function' ? window.subjectName(sid) : '') || 'বিষয়',
      done: Math.min(share, by[sid]),
      total: share
    }));
  }

  /* ── চলমান কোর্স (localStorage-progress) ── */
  function courseInfo() {
    let best = null;
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        const m = /^admissionInteractiveQuizV1:([^:]+):progress$/.exec(k || '');
        if (!m) continue;
        const p = JSON.parse(localStorage.getItem(k) || 'null');
        if (p && (!best || num(p.updatedAt) > num(best.p.updatedAt))) best = { id: m[1], p };
      }
    } catch (_) {}
    if (!best) return { title: 'এখনো কোনো কোর্স শুরু করোনি', progress: 0, id: null };
    const packs = Array.isArray(window.__admissionInteractiveCoursePacks) ? window.__admissionInteractiveCoursePacks : [];
    const pack = packs.find((p) => p.id === best.id);
    const total = pack && Array.isArray(pack.lessons) ? pack.lessons.length : 0;
    const done = Array.isArray(best.p.doneLessons) ? best.p.doneLessons.length : 0;
    return {
      title: (pack && (pack.title || pack.label)) || best.id,
      progress: total ? Math.min(100, Math.round(done / total * 100)) : 0,
      id: best.id
    };
  }

  /* ── ভর্তি-লক্ষ্য (settings.dv2Goal; সেট না থাকলে সৎ খালি-অবস্থা) ── */
  function goalInfo() {
    const S = C().settings;
    const s = (S && typeof S === 'object') ? S : {};
    const g = s.dv2Goal || null;
    const target = Math.max(1, num(s.dailyTarget || 100));
    const examDate = (g && g.examDate) ? g.examDate : null;
    const hasDate = !!examDate;
    // সেট না থাকলে ৯০-দিনের নিরপেক্ষ টাইমলাইন ধরে অগ্রগতির বার আঁকা হয়,
    // কিন্তু সব লেখা সৎ থাকে (hasDate=false → "লক্ষ্য এখনো সেট করোনি")।
    const examTs = hasDate ? new Date(examDate + 'T10:00:00+06:00').getTime() : Date.now() + 90 * DAY;
    const diff = hasDate ? Math.max(0, Math.ceil((new Date(examDate + 'T23:59:59') - Date.now()) / DAY)) : 0;
    const wq = weekSeries().reduce((a, x) => a + x.q, 0);
    const prep = hasDate ? Math.min(100, Math.round(wq / (target * 7) * 100)) : 0;
    return {
      uni: (g && g.university) || '',
      unit: (g && g.unit) || '',
      date: examTs,
      hasDate,
      daysLeft: diff,
      prep,
      weeklyTarget: target * 7
    };
  }

  /* ── ফ্রেমের ডেটা-মডেল (প্রতিটি ফিল্ড সবসময় উপস্থিত) ── */
  function frameData() {
    const t = todayStats();
    const week = weekSeries();
    const run = streakDays();
    const g = goalInfo();
    const target = Math.max(1, num((C().settings || {}).dailyTarget || 100));
    const ans = t.c + t.w;
    const mastery = ans ? Math.round(t.c / ans * 100) : 0;
    const topics = topicRows().slice(0, 6).map((x) => ({ n: x.n, v: x.v }));

    // গ্রাফ: যেদিন উত্তর নেই সেদিন আগের সঠিকতা বহন করে (রেখা অটুট); স্ক্রাব-টুলটিপ
    // প্রতিদিনের প্রশ্ন-সংখ্যা দেখায়, তাই ০-প্রশ্নের দিন স্পষ্ট বোঝা যায়।
    const known = week.filter((x) => x.acc != null);
    const perfHasData = known.length > 0;
    let carry = known.length ? known[0].acc : 0;
    const perf = week.map((x) => { if (x.acc != null) carry = x.acc; return perfHasData ? carry : 0; });

    let avatar = null;
    try { avatar = typeof window.__ahAvatarUrl === 'function' ? window.__ahAvatarUrl() : null; } catch (_) {}
    const name = String((C().user && C().user.name) || (C().settings && C().settings.profile && C().settings.profile.name) || 'Scholar').trim() || 'Scholar';

    return {
      user: { name, avatar },
      mission: { total: target, done: Math.min(target, t.q), subjects: missionSubjects(target, t) },
      exam: { date: g.date, uni: g.uni, unit: g.unit, prepDays: 90, hasDate: g.hasDate, daysLeft: g.daysLeft },
      streak: { days: run, target: [3, 7, 14, 30, 60, 100, 365].find((n) => n > run) || run + 30, week: week.map((x) => x.q) },
      stats: { solved: t.q, correct: t.c, wrong: t.w, mastery, minutes: Math.round(t.time / 60000) },
      course: courseInfo(),
      perf,
      perfHasData,
      topics,
      goal: { weeklyTarget: g.weeklyTarget, prep: g.prep },
      board: { week: null, month: null }
    };
  }
  window.__dv3Data = frameData;

  /* ── অ্যাকশন → আসল অ্যাপ-নেভিগেশন ── */
  const go = (path) => {
    try { if (typeof window.navigate === 'function') return window.navigate(path); location.hash = '#/' + path; } catch (_) {}
  };
  const tab = (path) => {
    try { if (window.AdmissionNavigation && window.AdmissionNavigation.openTab) return window.AdmissionNavigation.openTab(path); } catch (_) {}
    go(path);
  };
  const ACTIONS = {
    'mission.continue': () => go((C().exams || []).find((e) => e && e.status === 'running') ? 'exam/running' : 'exam/setup'),
    // With a goal set the richer admission-intel sheet is what "লক্ষ্য দেখো" should
    // reveal; without one there is nothing to analyse, so open the goal editor.
    'goal.open': () => {
      const g = goalInfo();
      if (g.hasDate && g.uni && window.openAdmissionIntelPanel) return window.openAdmissionIntelPanel();
      return window.dv2EditGoal();
    },
    'goal.settings': () => window.dv2EditGoal(),
    'ai.plan': () => (window.openStudyPlanPanel ? window.openStudyPlanPanel() : go('progress/plan')),
    'radar.practice': () => {
      const w = topicRows()[0];
      if (w && window.startWeakTopicPractice) window.startWeakTopicPractice(w.tid); else go('question-bank');
    },
    notifications: () => { try { if (window.NotificationHub && window.NotificationHub.bellTap) return window.NotificationHub.bellTap(); } catch (_) {} go('notifications'); },
    'course.open': () => { const c = courseInfo(); go(c.id ? 'interactive-courses/' + c.id : 'courses'); },
    'roadmap.create': () => go('progress/plan'),
    'nav.home': () => go('dashboard'),
    'nav.bank': () => tab('question-bank'),
    'nav.ai': () => go('ai'),
    'nav.exam': () => tab('exam'),
    'nav.profile': () => tab('my-profile'),
    'tool.quick': () => (window.openSmartPracticeModal ? window.openSmartPracticeModal() : go('smart-practice')),
    'tool.mock': () => go('exam/setup'),
    'tool.mistakes': () => go('mistakes'),
    'tool.revision': () => go('smart-revision'),
    'tool.courses': () => go('courses'),
    'tool.ai': () => go('ai'),
    'tool.notes': () => go('notes'),
    'tool.vocab': () => go('vocabulary-master'),
    'tool.progress': () => go('progress'),
    'tool.goals': () => go('progress/plan'),
    'tool.dict': () => go('dictionary'),
    'tool.search': () => go('question-bank')
  };
  window.__dv3Action = function (action) {
    const fn = ACTIONS[action];
    if (!fn) return false;
    try { fn(); } catch (e) { console.warn('[dv3] action failed', action, e); }
    return true;
  };

  /* ── পুরনো ১১+ টুল (No-loss) ── */
  window.dv2AllTools = function () { go('study-tools'); };
  window.dv2EditGoal = function () {
    const g = (C().settings && C().settings.dv2Goal) || { university: '', unit: '', examDate: '' };
    window.openModal('<h3>ভর্তি লক্ষ্য</h3><label class="flabel">বিশ্ববিদ্যালয়</label><input id="dv2G1" class="ah-inp" value="' + escv(g.university) + '"><label class="flabel">ইউনিট</label><input id="dv2G2" class="ah-inp" value="' + escv(g.unit) + '"><label class="flabel">পরীক্ষার তারিখ</label><input id="dv2G3" type="date" class="ah-inp" value="' + escv(g.examDate) + '"><div class="row" style="margin-top:12px"><button class="btn ghost" style="flex:1" onclick="closeModal()">বাতিল</button><button class="btn" style="flex:1" onclick="dv2SaveGoal()">সংরক্ষণ</button></div>');
  };
  window.dv2SaveGoal = function () {
    try {
      const s = C().settings || {};
      const val = (id) => { const el = document.getElementById(id); return el ? String(el.value || '').trim() : ''; };
      s.dv2Goal = { university: val('dv2G1'), unit: val('dv2G2'), examDate: val('dv2G3') };
      const done = () => { try { window.closeModal(); } catch (_) {} try { window.render(); } catch (_) {} };
      if (window.dbPut) window.dbPut('settings', s).then(done).catch(done); else done();
    } catch (_) { try { window.closeModal(); } catch (e) {} }
  };
  window.dv2Task = function () {};

  /* ── Device chrome: the dashboard is an iframe, so the page cannot see its colour.
     The frame reports its real background and the iframe DECLARES it with
     data-ah-chrome; ios-chrome.js then paints the strip, every theme-color tag and the
     canvas from that one value, and drops it the moment the frame leaves. ── */
  window.__dv3Chrome = function (bg) {
    try {
      if (!bg) return;
      const fr = document.querySelector('iframe.dv3-frame');
      if (fr) { fr.setAttribute('data-ah-chrome', bg); fr.style.background = bg; }
      document.documentElement.style.setProperty('--ah-chrome', bg);
      if (window.AhChrome && window.AhChrome.sync) window.AhChrome.sync();
    } catch (_) {}
  };
  window.__dv3SafeTop = function () {
    try {
      const d = document.createElement('div');
      d.style.cssText = 'position:fixed;top:0;left:0;width:0;visibility:hidden;pointer-events:none;padding-top:env(safe-area-inset-top,0px)';
      document.body.appendChild(d);
      const h = d.offsetHeight;
      d.remove();
      return h;
    } catch (_) { return 0; }
  };

  /* ── renderDashboard override (সব আগের ইঞ্জিন অক্ষত) ── */
  const previous = window.renderDashboard;
  window.renderDashboard = function () {
    const path = (window.Router && Router.path) || 'dashboard';
    if (path !== 'dashboard' && path !== '') {
      if (typeof previous === 'function') return previous.apply(this, arguments);
      return undefined;
    }
    return renderV3();
  };

  function renderV3() {
    try {
      const html = mountHtml();
      if (typeof window.renderShell === 'function') window.renderShell(html, { title: 'Dashboard', topbar: false, hideNav: true });
      else { const app = document.getElementById('app'); if (app) app.innerHTML = '<main class="page">' + html + '</main>'; }
      dv2Cleanup();
    } catch (e) {
      console.warn('[dv3] render failed', e);
      try {
        if (typeof window.renderShell === 'function') {
          window.renderShell('<section class="card"><h3>ড্যাশবোর্ড লোড হয়নি</h3><p class="muted">পেজটি আবার খুলুন।</p></section>', { title: 'Dashboard' });
        }
      } catch (_) {}
      dv2Cleanup();
    }
    return undefined;
  }

  function mountHtml() {
    return '<iframe class="dv3-frame" title="Dashboard" style="position:fixed;inset:0;width:100%;height:100%;border:0;display:block;z-index:5;background:var(--ah-chrome,#F4F6FD)"></iframe>';
  }

  /* ফ্রেমের srcdoc বসানো, renderShell প্রতিবার নতুন ফ্রেম বানায়, তাই সোর্স এখানেই দেওয়া হয় */
  function paintFrame() {
    const app = document.getElementById('app');
    const fr = app && app.querySelector('iframe.dv3-frame');
    if (fr && !fr.getAttribute('srcdoc')) fr.setAttribute('srcdoc', FRAME_HTML);
  }

  /* পুরনো-চেইনের সম্ভব্য-অবশিষ্ট-পরিচ্ছন্নতা: একাধিক .page / পুরনো-ড্যাশ-মার্কর → কেবল dv3-পেজ */
  function dv2Cleanup() {
    try {
      const app = document.getElementById('app');
      if (!app) return;
      const pages = Array.from(app.querySelectorAll('.page'));
      if (pages.length > 1) {
        const keep = pages.filter((p) => p.querySelector('.dv3-frame')).pop() || pages[pages.length - 1];
        pages.forEach((p) => { if (p !== keep) p.remove(); });
      }
      app.querySelectorAll('[data-phase5-dashboard],[data-phase34-dashboard],[data-dashboard-comparison],[data-phase5-quicklinks],.daily-gk-teaser,.p3-dashboard-v3,.dashboard-v2,.p3-dashboard,.dv2-root').forEach((n) => n.remove());
      paintFrame();
    } catch (_) {}
  }

  window.__admissionDashboardModuleReady = true;
  if (typeof window.__admissionRequestFinalRender === 'function') window.__admissionRequestFinalRender();
})();
