/* Admission Hub, P11 Adaptive Learning: insight panel.
 *
 * The visible half of P11. It feeds the student's own exam history to
 * window.AhAdaptiveEngine (see adaptive-engine.js) and shows what the engine
 * measures: overall ability and the difficulty band it recommends, per-topic
 * ability (weakest first), the speed profile (fast-accurate / fast-wrong /
 * slow-right), and a short memory of how they practise.
 *
 * Read-only: it never writes to the database. Classic script (window/self
 * IIFE), matching the other tool modules here.
 */
(function () {
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const engine = () => (typeof self !== 'undefined' ? self.AhAdaptiveEngine : undefined);

  const CSS = `
  .ad-overlay{position:fixed;inset:0;z-index:9000;background:rgba(8,30,24,.55);display:flex;align-items:flex-end;justify-content:center;padding:0}
  .ad-sheet{width:100%;max-width:560px;max-height:90vh;display:flex;flex-direction:column;background:var(--card,#fff);border-radius:20px 20px 0 0;overflow:hidden;box-shadow:0 -8px 40px rgba(0,0,0,.3)}
  .ad-head{display:flex;align-items:center;justify-content:space-between;padding:16px 18px;border-bottom:1px solid var(--line,rgba(15,107,79,.12));font-size:16px}
  .ad-x{border:0;background:none;font-size:22px;line-height:1;cursor:pointer;color:var(--sub,#5F7A72)}
  .ad-body{padding:16px 18px;overflow-y:auto}
  .ad-hero{border-radius:14px;padding:14px 15px;background:linear-gradient(135deg,#EFF7F2,#DBF3E6);margin-bottom:16px}
  .ad-hero small{color:var(--sub,#5F7A72);font-size:11.5px}
  .ad-hero b{display:block;font-size:26px;color:#0E6B4F;margin:3px 0}
  .ad-hero .ad-band{display:inline-block;font-size:11.5px;font-weight:700;padding:3px 9px;border-radius:20px;background:#0E6B4F;color:#fff}
  .ad-sec{margin-bottom:15px}
  .ad-sec h4{margin:0 0 8px;font-size:13px;color:var(--sub,#5F7A72);text-transform:uppercase;letter-spacing:.04em}
  .ad-row{display:flex;align-items:center;gap:9px;padding:7px 0;border-top:1px solid var(--line,rgba(15,107,79,.1));font-size:13px}
  .ad-tag{flex:0 0 auto;font-size:10.5px;font-weight:700;padding:2px 7px;border-radius:20px;background:rgba(15,107,79,.12);color:#0E6B4F}
  .ad-tag.attention{background:rgba(192,57,43,.14);color:#C0392B}
  .ad-tag.positive{background:rgba(14,107,79,.14);color:#0E6B4F}
  .ad-row .ad-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--ink,#16302A)}
  .ad-row b{margin-left:auto;color:var(--ink,#16302A);flex:0 0 auto}
  .ad-bar{display:grid;grid-template-columns:64px 1fr 46px;align-items:center;gap:8px;font-size:12.5px;margin-bottom:6px}
  .ad-bar-t{height:7px;background:rgba(15,107,79,.12);border-radius:5px;overflow:hidden}
  .ad-bar-t i{display:block;height:100%;background:linear-gradient(90deg,#2EE6A8,#0E6B4F)}
  .ad-empty{padding:12px 0;color:#0E6B4F;font-size:13px;font-weight:600}
  .ad-cta{width:100%;margin-top:6px;padding:13px;border:0;border-radius:12px;background:#0E6B4F;color:#fff;font-size:14px;font-weight:700;cursor:pointer}`;

  function injectCss() {
    if (document.getElementById('adStyle')) return;
    const st = document.createElement('style');
    st.id = 'adStyle';
    st.textContent = CSS;
    document.head.appendChild(st);
  }

  const results = () => (typeof CACHE !== 'undefined' && Array.isArray(CACHE.examResults) ? CACHE.examResults : []);
  const questions = () => (typeof CACHE !== 'undefined' && Array.isArray(CACHE.questions) ? CACHE.questions : []);
  const topicName = (id) => {
    const t = typeof CACHE !== 'undefined' && Array.isArray(CACHE.topics) ? CACHE.topics.find(x => x.id === id) : null;
    return (t && t.name) || id || '-';
  };

  const BAND_LABEL = { easy: 'সহজ থেকে শুরু', medium: 'মাঝারি', hard: 'কঠিন', mixed: 'মিশ্র' };
  const BAND_TONE = { easy: 'attention', hard: 'positive' };
  const SPEED_LABEL = {
    'fast-accurate': 'দ্রুত ও নির্ভুল', 'fast-wrong': 'দ্রুত কিন্তু ভুল',
    'slow-right': 'ধীর কিন্তু ঠিক', balanced: 'ভারসাম্যপূর্ণ'
  };
  const DIFF_LABEL = { easy: 'সহজ', medium: 'মাঝারি', hard: 'কঠিন' };

  function topicRows(topics) {
    if (!topics.length) return '<div class="ad-empty">কোনো টপিক-ডেটা নেই</div>';
    return topics.slice(0, 12).map(t => {
      const tone = t.band === 'easy' ? 'attention' : t.band === 'hard' ? 'positive' : '';
      return `<div class="ad-row"><span class="ad-tag ${tone}">${esc(BAND_LABEL[t.band] || t.band)}</span><span class="ad-name">${esc(topicName(t.topicId))}</span><b>${t.ability}%</b></div>`;
    }).join('');
  }

  function speedHtml(s) {
    const fa = s.fastAccuracy == null ? '-' : s.fastAccuracy + '%';
    const sa = s.slowAccuracy == null ? '-' : s.slowAccuracy + '%';
    return `<div class="ad-row"><span class="ad-name">ধরন</span><b>${esc(SPEED_LABEL[s.profile] || s.profile)}</b></div>
      <div class="ad-row"><span class="ad-name">দ্রুত উত্তরে সঠিক</span><b>${esc(fa)}</b></div>
      <div class="ad-row"><span class="ad-name">ধীর উত্তরে সঠিক</span><b>${esc(sa)}</b></div>
      <div class="ad-row"><span class="ad-name">গড় সময় / প্রশ্ন</span><b>${s.averageSeconds || 0} সে.</b></div>`;
  }

  function patternHtml(p) {
    return `<div class="ad-row"><span class="ad-name">মোট পরীক্ষা</span><b>${p.exams}</b></div>
      <div class="ad-row"><span class="ad-name">সক্রিয় দিন</span><b>${p.activeDays}</b></div>
      <div class="ad-row"><span class="ad-name">প্রতি পরীক্ষায় গড় প্রশ্ন</span><b>${p.averageQuestionsPerExam}</b></div>
      <div class="ad-row"><span class="ad-name">বেশি যে কঠিনতায় অনুশীলন</span><b>${esc(DIFF_LABEL[p.preferredDifficulty] || p.preferredDifficulty)}</b></div>`;
  }

  function bodyHtml(m) {
    const o = m.overall || {};
    return `
      <div class="ad-hero"><small>তোমার সামগ্রিক সামর্থ্য</small><b>${o.ability || 0}%</b>
        <span class="ad-band">${esc(BAND_LABEL[o.band] || o.band)}</span></div>
      <section class="ad-sec"><h4>টপিক, সামর্থ্য (দুর্বল আগে)</h4>${topicRows(m.topics || [])}</section>
      <section class="ad-sec"><h4>উত্তরের ধরন</h4>${speedHtml(m.speed || {})}</section>
      <section class="ad-sec"><h4>তোমার পড়ার ধরন</h4>${patternHtml(m.practicePattern || {})}</section>
      <button class="ad-cta" onclick="window.startAdaptivePractice && window.startAdaptivePractice()">⚡ আমার সামর্থ্য অনুযায়ী অনুশীলন</button>`;
  }

  function open() {
    const eng = engine();
    if (!eng) { window.toast && window.toast('Adaptive engine এখনো লোড হয়নি'); return; }
    injectCss();
    const model = eng.analyze({ results: results(), questions: questions() });
    let el = document.getElementById('adPanel');
    if (!el) {
      el = document.createElement('div');
      el.id = 'adPanel';
      el.className = 'ad-overlay';
      document.body.appendChild(el);
    }
    el.innerHTML = `
      <div class="ad-sheet">
        <div class="ad-head"><b>🧠 আমার সামর্থ্য</b><button class="ad-x" onclick="window.closeAdaptivePanel()">×</button></div>
        <div class="ad-body">${bodyHtml(model)}</div>
      </div>`;
  }

  window.openAdaptivePanel = open;
  window.closeAdaptivePanel = () => { const el = document.getElementById('adPanel'); if (el) el.remove(); };
})();
