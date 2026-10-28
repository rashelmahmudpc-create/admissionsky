/* Admission Hub, P09 Advanced Analytics: insight panel.
 *
 * The visible half of P09. It feeds the student's own history, exam results,
 * questions and mistakes, to window.AhAnalyticsInsights (see
 * analytics-insight-engine.js) and shows the picture it returns: per-topic
 * strength, difficulty and time breakdowns, repeated wrong answers, the
 * improvement rate, and plain-language insight cards.
 *
 * Read-only: it never writes to the database. Classic script (window/self
 * IIFE), matching the other tool modules here.
 */
(function () {
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const engine = () => (typeof self !== 'undefined' ? self.AhAnalyticsInsights : undefined);

  const CSS = `
  .ai-overlay{position:fixed;inset:0;z-index:9000;background:rgba(8,30,24,.55);display:flex;align-items:flex-end;justify-content:center;padding:0}
  .ai-sheet{width:100%;max-width:560px;max-height:90vh;display:flex;flex-direction:column;background:var(--card,#fff);border-radius:20px 20px 0 0;overflow:hidden;box-shadow:0 -8px 40px rgba(0,0,0,.3)}
  .ai-head{display:flex;align-items:center;justify-content:space-between;padding:16px 18px;border-bottom:1px solid var(--line,rgba(15,107,79,.12));font-size:16px}
  .ai-x{border:0;background:none;font-size:22px;line-height:1;cursor:pointer;color:var(--sub,#5F7A72)}
  .ai-body{padding:16px 18px;overflow-y:auto}
  .ai-cards{display:grid;grid-template-columns:1fr;gap:9px;margin-bottom:16px}
  .ai-card{border-radius:12px;padding:11px 13px;background:var(--mint,#EFF7F2);border-left:4px solid #0E6B4F}
  .ai-card.attention{background:rgba(253,235,235,.7);border-left-color:#C0392B}
  .ai-card.positive{background:var(--mint,#EFF7F2);border-left-color:#0E6B4F}
  .ai-card.neutral{background:rgba(238,242,247,.8);border-left-color:#5F7A72}
  .ai-card b{display:block;font-size:13px;margin-bottom:3px;color:var(--ink,#16302A)}
  .ai-card span{font-size:12.5px;color:var(--sub,#5F7A72);line-height:1.5}
  .ai-sec{margin-bottom:15px}
  .ai-sec h4{margin:0 0 8px;font-size:13px;color:var(--sub,#5F7A72);text-transform:uppercase;letter-spacing:.04em}
  .ai-row{display:flex;align-items:center;gap:9px;padding:7px 0;border-top:1px solid var(--line,rgba(15,107,79,.1));font-size:13px}
  .ai-tag{flex:0 0 auto;font-size:10.5px;font-weight:700;padding:2px 7px;border-radius:20px;background:rgba(15,107,79,.12);color:#0E6B4F}
  .ai-tag.attention{background:rgba(192,57,43,.14);color:#C0392B}
  .ai-tag.positive{background:rgba(14,107,79,.14);color:#0E6B4F}
  .ai-row .ai-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--ink,#16302A)}
  .ai-row b{margin-left:auto;color:var(--ink,#16302A);flex:0 0 auto}
  .ai-bar{display:grid;grid-template-columns:64px 1fr 46px;align-items:center;gap:8px;font-size:12.5px;margin-bottom:6px}
  .ai-bar-t{height:7px;background:rgba(15,107,79,.12);border-radius:5px;overflow:hidden}
  .ai-bar-t i{display:block;height:100%;background:linear-gradient(90deg,#2EE6A8,#0E6B4F)}
  .ai-empty{padding:12px 0;color:#0E6B4F;font-size:13px;font-weight:600}`;

  function injectCss() {
    if (document.getElementById('aiStyle')) return;
    const st = document.createElement('style');
    st.id = 'aiStyle';
    st.textContent = CSS;
    document.head.appendChild(st);
  }

  const results = () => (typeof CACHE !== 'undefined' && Array.isArray(CACHE.examResults) ? CACHE.examResults : []);
  const questions = () => (typeof CACHE !== 'undefined' && Array.isArray(CACHE.questions) ? CACHE.questions : []);
  const mistakes = () => (typeof CACHE !== 'undefined' && Array.isArray(CACHE.mistakes) ? CACHE.mistakes : []);
  const topicName = (id) => {
    const t = typeof CACHE !== 'undefined' && Array.isArray(CACHE.topics) ? CACHE.topics.find(x => x.id === id) : null;
    return (t && t.name) || id || '-';
  };

  const STATUS_LABEL = {
    strong: 'শক্ত', weak: 'দুর্বল', improving: 'উন্নতি', declining: 'নামছে',
    'needs-revision': 'রিভিশন', steady: 'স্থির', new: 'নতুন'
  };
  const STATUS_TONE = { strong: 'positive', improving: 'positive', declining: 'attention', 'needs-revision': 'attention', weak: 'attention' };

  function identityOf(q) {
    const raw = q || '';
    const m = String(raw).match(/\d+/);
    return m ? m[0] : String(raw).slice(0, 6) || '-';
  }

  function insightsHtml(cards) {
    if (!cards.length) return '<div class="ai-empty">এখনো যথেষ্ট ডেটা নেই, পরীক্ষা দিলে এখানে পরামর্শ আসবে ✓</div>';
    return cards.map(c => `<div class="ai-card ${esc(c.kind)}"><b>${esc(c.title)}</b><span>${esc(c.text)}</span></div>`).join('');
  }

  function topicRowsHtml(topics) {
    const ranked = topics.slice().sort((a, b) => {
      const rank = { weak: 0, 'needs-revision': 1, declining: 2, improving: 3, steady: 4, strong: 5, new: 6 };
      return (rank[a.status] ?? 9) - (rank[b.status] ?? 9) || b.attempts - a.attempts;
    }).slice(0, 12);
    if (!ranked.length) return '<div class="ai-empty">কোনো টপিক-ডেটা নেই</div>';
    return ranked.map(t => `<div class="ai-row"><span class="ai-tag ${esc(STATUS_TONE[t.status] || '')}">${esc(STATUS_LABEL[t.status] || t.status)}</span><span class="ai-name">${esc(topicName(t.topicId))}</span><b>${t.accuracy}%</b></div>`).join('');
  }

  const diffLabel = { easy: 'সহজ', medium: 'মাঝারি', hard: 'কঠিন' };
  function diffBars(diff) {
    return ['easy', 'medium', 'hard'].map(d => {
      const x = diff[d] || { attempted: 0, accuracy: 0 };
      return `<div class="ai-bar"><span>${esc(diffLabel[d])}</span><span class="ai-bar-t"><i style="width:${x.accuracy}%"></i></span><b>${x.attempted ? x.accuracy + '%' : '-'}</b></div>`;
    }).join('');
  }

  function timeHtml(time) {
    const mins = Math.round((time.totalSeconds || 0) / 60);
    return `<div class="ai-row"><span class="ai-name">মোট সময়</span><b>${mins} মিনিট</b></div>
      <div class="ai-row"><span class="ai-name">প্রতি প্রশ্নে গড়</span><b>${time.averagePerQuestion || 0} সে.</b></div>`;
  }

  function patternHtml(p) {
    if (!p.repeated.length) return '<div class="ai-empty">বারবার-ভুল প্রশ্ন নেই ✓</div>';
    return p.repeated.slice(0, 8).map(r => `<div class="ai-row"><span class="ai-tag attention">${r.wrongCount}×</span><span class="ai-name">${esc(topicName(r.topicId))} · প্রশ্ন #${esc(identityOf(r.questionId))}</span></div>`).join('');
  }

  function bodyHtml(model) {
    const imp = model.improvement || { overall: 0, samples: 0 };
    const impText = imp.samples < 2 ? 'যথেষ্ট ডেটা নেই' : (imp.overall > 0 ? `+${imp.overall}` : String(imp.overall)) + ' পয়েন্ট';
    return `
      <section class="ai-sec"><h4>মূল কথা</h4><div class="ai-cards">${insightsHtml(model.insights || [])}</div></section>
      <section class="ai-sec"><h4>টপিক, শক্তি ও দুর্বলতা</h4>${topicRowsHtml(model.topics || [])}</section>
      <section class="ai-sec"><h4>কঠিনতা অনুযায়ী নির্ভুলতা</h4>${diffBars(model.difficulty || {})}</section>
      <section class="ai-sec"><h4>সময়</h4>${timeHtml(model.time || {})}</section>
      <section class="ai-sec"><h4>উন্নতির হার</h4><div class="ai-row"><span class="ai-name">শেষ অর্ধেক বনাম আগের অর্ধেক</span><b>${esc(impText)}</b></div></section>
      <section class="ai-sec"><h4>বারবার ভুল (${(model.patterns && model.patterns.repeated.length) || 0})</h4>${patternHtml(model.patterns || { repeated: [] })}</section>`;
  }

  function open() {
    const eng = engine();
    if (!eng) { window.toast && window.toast('Analytics engine now load হয়নি'); return; }
    injectCss();
    const model = eng.analyze({ results: results(), questions: questions(), mistakes: mistakes() });
    let el = document.getElementById('aiPanel');
    if (!el) {
      el = document.createElement('div');
      el.id = 'aiPanel';
      el.className = 'ai-overlay';
      document.body.appendChild(el);
    }
    el.innerHTML = `
      <div class="ai-sheet">
        <div class="ai-head"><b>📊 পড়াশোনার বিশ্লেষণ</b><button class="ai-x" onclick="window.closeAnalyticsInsightsPanel()">×</button></div>
        <div class="ai-body">${bodyHtml(model)}</div>
      </div>`;
  }

  window.openAnalyticsInsightsPanel = open;
  window.closeAnalyticsInsightsPanel = () => { const el = document.getElementById('aiPanel'); if (el) el.remove(); };
})();
