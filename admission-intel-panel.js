/* Admission Hub, P18 Admission Intelligence: the visible panel.
 *
 * The student taps "ভর্তি-বুদ্ধি" on the dashboard and sees what their own
 * practice says about their admission preparation: which official subjects they
 * have covered for their chosen university + unit, which they have not touched,
 * which topics are weak, what their question-pattern looks like, and a revision
 * plan that counts down to the exam.
 *
 * Read-only: it never writes to the database and never calls a model. Classic
 * script (window/self IIFE), matching the other tool modules here.
 *
 * POLICY: no rank/pass/seat promise anywhere. If the engine ever produced such
 * a sentence the panel drops it rather than showing it.
 */
(function () {
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const engine = () => (typeof self !== 'undefined' ? self.AhAdmissionIntel : undefined);
  const catalog = () => (typeof self !== 'undefined' ? self.AH_AcademicCatalog : undefined);
  const patterns = () => (typeof self !== 'undefined' ? self.AH_QuestionPattern : undefined);

  const CSS = `
.ip-overlay{position:fixed;inset:0;z-index:10050;background:var(--bg,#fff);display:flex;justify-content:center}
.ip-sheet{width:100%;max-width:560px;height:100%;display:flex;flex-direction:column;background:var(--card,#fff);overflow:hidden}
.ip-head{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:calc(12px + env(safe-area-inset-top,0px)) 18px 12px;border-bottom:1px solid var(--line,rgba(15,107,79,.12));font-size:16px}
.ip-x{border:0;background:none;font-size:22px;line-height:1;cursor:pointer;color:var(--sub,#5F7A72)}
.ip-body{padding:16px 18px calc(24px + env(safe-area-inset-bottom,0px));overflow-y:auto;flex:1;-webkit-overflow-scrolling:touch;overscroll-behavior:contain}
  /* While a full-screen panel owns the page the bottom nav must not show through. */
  body.ah-panel-open #navRoot{visibility:hidden!important;pointer-events:none!important}
.ip-hero{border-radius:14px;padding:14px 15px;background:linear-gradient(135deg,#EFF7F2,#DBF3E6);margin-bottom:16px}
.ip-hero small{color:var(--sub,#5F7A72);font-size:11.5px}
.ip-hero p{margin:5px 0 0;font-size:13.5px;line-height:1.5;color:var(--ink,#16302A)}
.ip-sec{margin-bottom:18px}
.ip-sec h4{margin:0 0 9px;font-size:12.5px;color:var(--sub,#5F7A72);text-transform:uppercase;letter-spacing:.04em}
.ip-chips{display:flex;flex-wrap:wrap;gap:6px}
.ip-chip{font-size:11.5px;padding:4px 10px;border-radius:20px;background:rgba(15,107,79,.12);color:#0E6B4F;font-weight:600}
.ip-chip.miss{background:rgba(192,57,43,.12);color:#C0392B}
.ip-row{display:flex;align-items:center;gap:9px;padding:8px 0;border-bottom:1px solid var(--line,rgba(15,107,79,.08))}
.ip-row:last-child{border-bottom:0}
.ip-row .nm{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;color:var(--ink,#16302A)}
.ip-bar{flex:0 0 84px;height:7px;border-radius:5px;background:rgba(15,107,79,.12);overflow:hidden}
.ip-bar i{display:block;height:100%;background:#0E6B4F}
.ip-bar i.low{background:#C0392B}
.ip-pc{flex:0 0 38px;text-align:right;font-size:12px;font-weight:700;color:var(--sub,#5F7A72)}
.ip-day{border:1px solid var(--line,rgba(15,107,79,.12));border-radius:12px;padding:11px 12px;margin-bottom:8px}
.ip-day b{font-size:13px;color:var(--ink,#16302A)}
.ip-day p{margin:6px 0 0;font-size:12.5px;color:var(--sub,#5F7A72)}
.ip-note{margin-top:14px;font-size:11.5px;line-height:1.5;color:var(--sub,#5F7A72);border-top:1px solid var(--line,rgba(15,107,79,.12));padding-top:12px}
.ip-facts{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.ip-fact{border:1px solid var(--line,rgba(15,107,79,.12));border-radius:11px;padding:9px 11px}
.ip-fact small{display:block;color:var(--sub,#5F7A72);font-size:10.5px;margin-bottom:3px}
.ip-fact b{font-size:14px;color:var(--ink,#16302A)}
.ip-tag{display:inline-block;font-size:10px;font-weight:700;padding:2px 8px;border-radius:20px;background:rgba(15,107,79,.12);color:#0E6B4F;margin-bottom:8px}
.ip-tag.partial{background:rgba(214,158,46,.18);color:#8A6100}
.ip-src{font-size:10.5px;color:var(--sub,#5F7A72);margin-top:8px}
.ip-actions{display:flex;gap:8px;margin-top:16px}
.ip-actions button{flex:1;border:0;border-radius:11px;padding:11px 10px;font-size:13px;font-weight:700;cursor:pointer;background:#0E6B4F;color:#fff}
.ip-actions button.ghost{background:rgba(15,107,79,.12);color:#0E6B4F}`;

  function injectCss() {
    if (document.getElementById('aiStyle')) return;
    const st = document.createElement('style');
    st.id = 'aiStyle';
    st.textContent = CSS;
    document.head.appendChild(st);
  }

  const results = () => (typeof CACHE !== 'undefined' && Array.isArray(CACHE.examResults) ? CACHE.examResults : []);
  const questions = () => (typeof CACHE !== 'undefined' && Array.isArray(CACHE.questions) ? CACHE.questions : []);
  const topics = () => (typeof CACHE !== 'undefined' && Array.isArray(CACHE.topics) ? CACHE.topics : []);
  function goal() {
    try {
      if (typeof CACHE !== 'undefined' && CACHE && CACHE.settings && CACHE.settings.dv2Goal) return CACHE.settings.dv2Goal;
    } catch (_) {}
    return {};
  }

  const DIFF_LABEL = { easy: 'সহজ', medium: 'মাঝারি', hard: 'কঠিন' };
  const safeText = (s) => { const E = engine(); return (!E || E.guaranteeSafe(s)) ? s : ''; };

  function coverageHtml(cov, mapReason) {
    if (!cov.total) {
      return `<div class="ip-hero"><small>সাবজেক্ট-মানচিত্র</small><p>বিশ্ববিদ্যালয় ও ইউনিট সেট করলে তোমার অফিসিয়াল সাবজেক্টের তালিকা এখানে দেখাবে।</p></div>`;
    }
    return `<div class="ip-hero"><small>${esc(mapReason === 'ok' ? 'তোমার সাবজেক্ট-কভারেজ' : 'সাবজেক্ট')}</small><p>অফিসিয়াল ${cov.total}টি সাবজেক্টের মধ্যে ${cov.covered}টিতে অভ্যাস হয়েছে (${cov.percent}%)।</p></div>
      <div class="ip-sec"><h4>অফিসিয়াল সাবজেক্ট</h4><div class="ip-chips">${cov.subjects.map((s) =>
        `<span class="ip-chip${s.practised ? '' : ' miss'}">${esc(s.subject)}</span>`).join('')}</div></div>`;
  }

  function topicsHtml(list) {
    if (!list.length) return '';
    return `<div class="ip-sec"><h4>টপিক-দক্ষতা</h4>${list.slice(0, 8).map((t) =>
      `<div class="ip-row"><span class="nm">${esc(t.name)}${t.confident ? '' : ' · কম ডেটা'}</span><span class="ip-bar"><i class="${t.accuracy < 50 ? 'low' : ''}" style="width:${t.accuracy}%"></i></span><span class="ip-pc">${t.accuracy}%</span></div>`).join('')}</div>`;
  }

  function patternHtml(rows) {
    const any = rows.some((r) => r.attempted);
    if (!any) return '';
    return `<div class="ip-sec"><h4>তোমার অভ্যাসের ধারা</h4>${rows.map((r) =>
      `<div class="ip-row"><span class="nm">${esc(DIFF_LABEL[r.difficulty])}</span><span class="ip-bar"><i class="${r.accuracy < 50 ? 'low' : ''}" style="width:${r.accuracy}%"></i></span><span class="ip-pc">${r.attempted ? r.accuracy + '%' : '-'}</span></div>`).join('')}</div>`;
  }

  function officialHtml(p) {
    if (!p) {
      return `<div class="ip-sec"><h4>অফিসিয়াল প্রশ্ন-প্যাটার্ন</h4><p class="ip-src">এই ইউনিটের অফিসিয়াল প্যাটার্ন এখনো যোগ করা হয়নি, বানানো তথ্য দেখানো হবে না।</p></div>`;
    }
    const P2 = patterns();
    const tag = P2 && P2.statusLabel ? P2.statusLabel(p.status) : '';
    const facts = [];
    if (p.total) facts.push(['মোট নম্বর', p.total]);
    if (p.mcq) facts.push(['এমসিকিউ', p.mcq]);
    if (p.written) facts.push(['লিখিত', p.written]);
    if (p.mcqQuestions) facts.push(['এমসিকিউ প্রশ্ন', p.mcqQuestions]);
    if (p.mcqMinutes) facts.push(['এমসিকিউ সময়', p.mcqMinutes + ' মিনিট']);
    else if (p.duration) facts.push(['সময়', p.duration + ' মিনিট']);
    if (p.negative != null) facts.push(['ভুলে কাটা', p.negative + ' নম্বর']);
    if (p.pass != null) facts.push(['পাস (এমসিকিউ)', p.pass + ' নম্বর']);
    return `<div class="ip-sec"><h4>অফিসিয়াল প্রশ্ন-প্যাটার্ন</h4>${tag ? `<span class="ip-tag${p.status === 'partial' ? ' partial' : ''}">${esc(tag)}</span>` : ''}
      <div class="ip-facts">${facts.map(([k, v]) => `<div class="ip-fact"><small>${esc(k)}</small><b>${esc(String(v))}</b></div>`).join('')}</div>
      ${p.note ? `<p class="ip-src">${esc(p.note)}</p>` : ''}
      ${p.source ? `<p class="ip-src">সূত্র: ${esc(p.source)}</p>` : ''}</div>`;
  }

  function planHtml(days) {
    if (!days.length) return '';
    return `<div class="ip-sec"><h4>রিভিশন-প্ল্যান</h4>${days.map((d) =>
      `<div class="ip-day"><b>দিন ${d.day}</b>${d.blocks.map((b) =>
        `<p>${esc(b.name || b.subject)}${b.questions ? ' · ' + b.questions + ' প্রশ্ন' : ''}, ${esc(safeText(b.why))}</p>`).join('')}</div>`).join('')}</div>`;
  }

  /* A plain-text weakness report the student can copy or share. Built from the
   * same engine output, so it can never say more than the panel shows, and it
   * passes the engine's own guarantee-safe check. */
  function reportText(plan) {
    const E = engine();
    const L = ['🏆 ভর্তি-বুদ্ধি রিপোর্ট', ''];
    if (plan.university) L.push('লক্ষ্য: ' + plan.university.name + (plan.unit ? ', ' + plan.unit.label + ' Unit' : ''), '');
    L.push(safeText(plan.message), '');
    if (plan.coverage.total) {
      L.push('সাবজেক্ট-কভারেজ: ' + plan.coverage.covered + '/' + plan.coverage.total + ' (' + plan.coverage.percent + '%)');
      if (plan.coverage.untouched.length) L.push('বাকি: ' + plan.coverage.untouched.join(', '));
      L.push('');
    }
    const weak = plan.topics.filter((t) => t.confident).slice(0, 5);
    if (weak.length) {
      L.push('দুর্বল টপিক:');
      for (const t of weak) L.push('• ' + t.name + ', ' + t.accuracy + '%');
      L.push('');
    }
    if (plan.official) {
      const o = plan.official;
      const bits = [];
      if (o.total) bits.push('মোট ' + o.total);
      if (o.mcq) bits.push('এমসিকিউ ' + o.mcq);
      if (o.written) bits.push('লিখিত ' + o.written);
      if (o.negative != null) bits.push('ভুলে কাটা ' + o.negative);
      if (bits.length) L.push('অফিসিয়াল প্যাটার্ন: ' + bits.join(', '), '');
    }
    if (plan.plan.length) {
      L.push('রিভিশন-প্ল্যান:');
      for (const d of plan.plan) L.push('• দিন ' + d.day + ': ' + d.blocks.map((b) => b.name || b.subject).join(', '));
      L.push('');
    }
    L.push('এটা নিজের অভ্যাসের ডেটা থেকে তৈরি পরামর্শ, কোনো নিশ্চয়তা নয়।');
    const text = L.join('\n');
    return (!E || E.guaranteeSafe(text)) ? text : '';
  }

  function copyFallback(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '-1000px';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (_) {}
    ta.remove();
    return ok;
  }

  function share() {
    const el = document.getElementById('aiPanel');
    if (!el) return;
    const text = el.__report || '';
    if (!text) return;
    if (navigator.share) {
      try {
        navigator.share({ title: 'ভর্তি-বুদ্ধি রিপোর্ট', text: text }).catch(() => {});
        return;
      } catch (_) {}
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(
        () => window.toast && window.toast('রিপোর্ট কপি হয়েছে'),
        () => copyFallback(text) && window.toast && window.toast('রিপোর্ট কপি হয়েছে'));
      return;
    }
    if (copyFallback(text) && window.toast) window.toast('রিপোর্ট কপি হয়েছে');
  }

  function open() {
    const E = engine();
    if (!E) { window.toast && window.toast('ভর্তি-বুদ্ধি ইঞ্জিন এখনো লোড হয়নি'); return; }
    injectCss();
    const plan = E.build({ results: results(), questions: questions(), topics: topics(), goal: goal(), catalog: catalog(), patterns: patterns() });
    let el = document.getElementById('aiPanel');
    if (!el) {
      el = document.createElement('div');
      el.id = 'aiPanel';
      el.className = 'ip-overlay';
      document.body.appendChild(el);
    }
    const head = plan.university ? `${esc(plan.university.name)}, ${esc(plan.unit ? plan.unit.label + ' Unit' : '')}` : '';
    el.innerHTML = `
      <div class="ip-sheet">
        <div class="ip-head"><b>🏆 ভর্তি-বুদ্ধি</b><button class="ip-x" onclick="window.closeAdmissionIntelPanel()">×</button></div>
        <div class="ip-body">
          ${head ? `<div class="ip-hero"><small>তোমার লক্ষ্য</small><p>${head}</p></div>` : ''}
          <div class="ip-hero"><small>সারসংক্ষেপ</small><p>${esc(safeText(plan.message))}</p></div>
          ${officialHtml(plan.official)}
          ${coverageHtml(plan.coverage, plan.mapReason)}
          ${topicsHtml(plan.topics)}
          ${patternHtml(plan.pattern)}
          ${planHtml(plan.plan)}
          <div class="ip-actions"><button onclick="window.shareAdmissionIntelReport()">রিপোর্ট শেয়ার করো</button></div>
          <div class="ip-note">এটা তোমার নিজের অভ্যাসের ডেটা থেকে তৈরি পরামর্শ, কোনো র‍্যাঙ্ক, পাস বা আসনের নিশ্চয়তা নয়।</div>
        </div>
      </div>`;
    el.__report = reportText(plan);
    document.body.classList.add('ah-panel-open');
  }

  window.openAdmissionIntelPanel = open;
  window.shareAdmissionIntelReport = share;
  window.closeAdmissionIntelPanel = () => { const el = document.getElementById('aiPanel'); if (el) el.remove(); document.body.classList.remove('ah-panel-open'); };
})();
