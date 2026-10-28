/* Admission Hub, P17 student action agent: the "prepare me" plan panel.
 *
 * The visible half of the study-plan engine. The student taps "আমাকে প্রস্তুত করো"
 * on the Progress page and gets an ordered plan built from their own history:
 * what to study today and the next few days, which topics first and why, how many
 * questions and at what difficulty.
 *
 * Read-only: it never writes to the database. Classic script (window/self IIFE),
 * matching the other tool modules here.
 */
(function () {
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const engine = () => (typeof self !== 'undefined' ? self.AhStudyPlanEngine : undefined);

  const CSS = `
  .sp-overlay{position:fixed;inset:0;z-index:10050;background:var(--bg,#fff);display:flex;justify-content:center}
  .sp-sheet{width:100%;max-width:560px;height:100%;display:flex;flex-direction:column;background:var(--card,#fff);overflow:hidden}
  .sp-head{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:calc(12px + env(safe-area-inset-top,0px)) 18px 12px;border-bottom:1px solid var(--line,rgba(15,107,79,.12));font-size:16px}
  .sp-x{border:0;background:none;font-size:22px;line-height:1;cursor:pointer;color:var(--sub,#5F7A72)}
  .sp-body{padding:16px 18px calc(24px + env(safe-area-inset-bottom,0px));overflow-y:auto;flex:1;-webkit-overflow-scrolling:touch;overscroll-behavior:contain}
  /* While a full-screen panel owns the page the bottom nav must not show through. */
  body.ah-panel-open #navRoot{visibility:hidden!important;pointer-events:none!important}
  .sp-hero{border-radius:14px;padding:14px 15px;background:linear-gradient(135deg,#EFF7F2,#DBF3E6);margin-bottom:16px}
  .sp-hero small{color:var(--sub,#5F7A72);font-size:11.5px}
  .sp-hero p{margin:5px 0 0;font-size:13.5px;line-height:1.5;color:var(--ink,#16302A)}
  .sp-day{margin-bottom:16px}
  .sp-day h4{margin:0 0 8px;font-size:13px;color:var(--sub,#5F7A72);text-transform:uppercase;letter-spacing:.04em}
  .sp-block{border:1px solid var(--line,rgba(15,107,79,.12));border-radius:12px;padding:11px 12px;margin-bottom:8px}
  .sp-block .sp-top{display:flex;align-items:center;gap:8px}
  .sp-tag{flex:0 0 auto;font-size:10.5px;font-weight:700;padding:2px 7px;border-radius:20px;background:rgba(15,107,79,.12);color:#0E6B4F}
  .sp-tag.attention{background:rgba(192,57,43,.14);color:#C0392B}
  .sp-tag.positive{background:rgba(14,107,79,.14);color:#0E6B4F}
  .sp-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:700;color:var(--ink,#16302A)}
  .sp-why{margin:6px 0 0;font-size:12.5px;color:var(--sub,#5F7A72)}
  .sp-mix{margin:6px 0 0;font-size:12.5px;color:var(--ink,#16302A)}
  .sp-empty{padding:12px 0;color:#0E6B4F;font-size:13px;font-weight:600}
  .sp-cta{width:100%;margin-top:6px;padding:13px;border:0;border-radius:12px;background:#0E6B4F;color:#fff;font-size:14px;font-weight:700;cursor:pointer}`;

  function injectCss() {
    if (document.getElementById('spStyle')) return;
    const st = document.createElement('style');
    st.id = 'spStyle';
    st.textContent = CSS;
    document.head.appendChild(st);
  }

  const results = () => (typeof CACHE !== 'undefined' && Array.isArray(CACHE.examResults) ? CACHE.examResults : []);
  const questions = () => (typeof CACHE !== 'undefined' && Array.isArray(CACHE.questions) ? CACHE.questions : []);
  const mistakes = () => (typeof CACHE !== 'undefined' && Array.isArray(CACHE.mistakes) ? CACHE.mistakes : []);
  const topicName = (id) => {
    const t = typeof CACHE !== 'undefined' && Array.isArray(CACHE.topics) ? CACHE.topics.find((x) => x.id === id) : null;
    return (t && t.name) || id || '-';
  };

  const KIND_LABEL = { weak: 'দুর্বল', steady: 'মাঝারি', strong: 'শক্ত', new: 'নতুন' };
  const KIND_TONE = { weak: 'attention', strong: 'positive' };
  const DIFF_LABEL = { easy: 'সহজ', medium: 'মাঝারি', hard: 'কঠিন' };

  function mixText(mix) {
    return ['easy', 'medium', 'hard']
      .filter((d) => mix[d] > 0)
      .map((d) => `${DIFF_LABEL[d]} ${mix[d]}`)
      .join(' · ');
  }

  function dayHtml(day) {
    const blocks = day.blocks.map((b) => `
      <div class="sp-block">
        <div class="sp-top"><span class="sp-tag ${KIND_TONE[b.kind] || ''}">${esc(KIND_LABEL[b.kind] || b.kind)}</span>
          <span class="sp-name">${esc(topicName(b.topicId))}</span></div>
        <p class="sp-why">${esc(b.reason)}</p>
        <p class="sp-mix">${b.count}টি প্রশ্ন, ${esc(mixText(b.mix))}</p>
      </div>`).join('');
    return `<section class="sp-day"><h4>${esc(day.label)}</h4>${blocks}</section>`;
  }

  function bodyHtml(plan) {
    if (!plan.days.length) {
      return `<div class="sp-hero"><p>${esc(plan.message)}</p></div>`;
    }
    return `
      <div class="sp-hero"><small>তোমার জন্য পরিকল্পনা</small><p>${esc(plan.message)}</p></div>
      ${plan.days.map(dayHtml).join('')}
      <button class="sp-cta" onclick="window.startAdaptivePractice && window.startAdaptivePractice()">⚡ এই পরিকল্পনা দিয়ে অনুশীলন শুরু</button>`;
  }

  function open() {
    const eng = engine();
    if (!eng) { window.toast && window.toast('পরিকল্পনা ইঞ্জিন এখনো লোড হয়নি'); return; }
    injectCss();
    const plan = eng.build({ results: results(), questions: questions(), mistakes: mistakes() });
    let el = document.getElementById('spPanel');
    if (!el) {
      el = document.createElement('div');
      el.id = 'spPanel';
      el.className = 'sp-overlay';
      document.body.appendChild(el);
    }
    el.innerHTML = `
      <div class="sp-sheet">
        <div class="sp-head"><b>🎯 আমাকে প্রস্তুত করো</b><button class="sp-x" onclick="window.closeStudyPlanPanel()">×</button></div>
        <div class="sp-body">${bodyHtml(plan)}</div>
      </div>`;
    document.body.classList.add('ah-panel-open');
  }
  window.openStudyPlanPanel = open;
  window.closeStudyPlanPanel = () => { const el = document.getElementById('spPanel'); if (el) el.remove(); document.body.classList.remove('ah-panel-open'); };
})();
