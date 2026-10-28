/* Admission Hub, P07 Intelligent Question Engine: analysis panel.
 *
 * The visible half of P07. It reads the bank through window.AhQuestionEngine
 * (see question-engine.js), shows what the bank actually contains, difficulty
 * and type mix, quality gaps, and duplicate clusters, and can write the
 * computed tags back onto the questions. All persistence goes through the
 * app's own dbPut, and only after a confirm, so the panel never writes by itself.
 *
 * Classic script (window/self IIFE), matching the other tool modules here.
 */
(function () {
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const engine = () => (typeof self !== 'undefined' ? self.AhQuestionEngine : undefined);

  /* Self-contained styles so the panel ships with its own look and never
     depends on another module's CSS having loaded first. */
  const CSS = `
  .qe-overlay{position:fixed;inset:0;z-index:9000;background:rgba(8,30,24,.55);display:flex;align-items:flex-end;justify-content:center;padding:0}
  .qe-sheet{width:100%;max-width:560px;max-height:90vh;display:flex;flex-direction:column;background:var(--card,#fff);border-radius:20px 20px 0 0;overflow:hidden;box-shadow:0 -8px 40px rgba(0,0,0,.3)}
  .qe-head{display:flex;align-items:center;justify-content:space-between;padding:16px 18px;border-bottom:1px solid var(--line,rgba(15,107,79,.12));font-size:16px}
  .qe-x{border:0;background:none;font-size:22px;line-height:1;cursor:pointer;color:var(--sub,#5F7A72)}
  .qe-body{padding:16px 18px;overflow-y:auto}
  .qe-foot{display:flex;gap:10px;padding:14px 18px;border-top:1px solid var(--line,rgba(15,107,79,.12))}
  .qe-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:9px;margin-bottom:16px}
  .qe-stat{background:var(--mint,#EFF7F2);border-radius:12px;padding:10px 11px;display:flex;flex-direction:column;gap:2px}
  .qe-stat b{font-size:19px;color:var(--ink,#16302A)}
  .qe-stat span{font-size:11.5px;color:var(--sub,#5F7A72)}
  .qe-stat.warn{background:rgba(253,235,235,.6)}.qe-stat.bad{background:rgba(248,215,215,.8)}.qe-stat.ok b{color:#0E6B4F}
  .qe-cols{display:grid;grid-template-columns:1fr 1fr;gap:14px}
  .qe-sec{margin-bottom:14px}
  .qe-sec h4{margin:0 0 8px;font-size:13px;color:var(--sub,#5F7A72);text-transform:uppercase;letter-spacing:.04em}
  .qe-bar{display:grid;grid-template-columns:72px 1fr 34px;align-items:center;gap:8px;font-size:12.5px;margin-bottom:6px}
  .qe-bar-k{color:var(--ink,#16302A);font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .qe-bar-t{height:7px;background:rgba(15,107,79,.12);border-radius:5px;overflow:hidden}
  .qe-bar-t i{display:block;height:100%;background:linear-gradient(90deg,#2EE6A8,#0E6B4F)}
  .qe-bar b{text-align:right;color:var(--ink,#16302A)}
  .qe-dup{display:flex;align-items:baseline;gap:9px;padding:8px 0;border-top:1px solid var(--line,rgba(15,107,79,.1));font-size:13px}
  .qe-dup-n{font-weight:800;color:#0E6B4F;flex:0 0 auto}
  .qe-dup em{margin-left:auto;font-style:normal;color:var(--sub,#5F7A72);font-size:12px;flex:0 0 auto}
  .qe-empty{padding:12px 0;color:#0E6B4F;font-size:13px;font-weight:600}`;

  function injectCss() {
    if (document.getElementById('qeStyle')) return;
    const st = document.createElement('style');
    st.id = 'qeStyle';
    st.textContent = CSS;
    document.head.appendChild(st);
  }
  const questions = () => (typeof CACHE !== 'undefined' && Array.isArray(CACHE.questions) ? CACHE.questions : []);

  function bar(label, n, total) {
    const pct = total ? Math.round((n / total) * 100) : 0;
    return `<div class="qe-bar"><span class="qe-bar-k">${esc(label)}</span><span class="qe-bar-t"><i style="width:${pct}%"></i></span><b>${n}</b></div>`;
  }

  function statCard(label, value, tone) {
    return `<div class="qe-stat ${tone || ''}"><b>${esc(value)}</b><span>${esc(label)}</span></div>`;
  }

  function bodyHtml(report) {
    const t = report.total || 0;
    const diff = ['easy', 'medium', 'hard'];
    const type = ['factual', 'conceptual', 'numerical', 'application'];
    const dups = report.topDuplicates || [];
    return `
      <div class="qe-stats">
        ${statCard('প্রশ্ন', t)}
        ${statCard('গড় কোয়ালিটি', report.avgQuality + '%', report.avgQuality < 70 ? 'warn' : 'ok')}
        ${statCard('ডুপ্লিকেট', report.duplicateQuestions, report.duplicateQuestions ? 'warn' : 'ok')}
        ${statCard('ব্যাখ্যা নেই', report.missingExplanation, report.missingExplanation ? 'warn' : 'ok')}
        ${statCard('উত্তর-ভুল', report.inconsistent, report.inconsistent ? 'bad' : 'ok')}
        ${statCard('ট্যাগ হয়নি', report.untagged, report.untagged ? 'warn' : 'ok')}
      </div>
      <div class="qe-cols">
        <section class="qe-sec"><h4>কঠিনতা</h4>${diff.map(d => bar(d, report.byDifficulty[d] || 0, t)).join('')}</section>
        <section class="qe-sec"><h4>ধরন</h4>${type.map(d => bar(d, report.byType[d] || 0, t)).join('')}</section>
      </div>
      <section class="qe-sec"><h4>ডুপ্লিকেট গ্রুপ (${report.duplicateClusters})</h4>
        ${dups.length ? dups.map(c => `<div class="qe-dup"><span class="qe-dup-n">${c.count}×</span><span>${esc(c.sample)}…</span><em>${c.exact ? 'হুবহু' : Math.round(c.maxSimilarity * 100) + '%'}</em></div>`).join('')
          : '<div class="qe-empty">কোনো ডুপ্লিকেট পাওয়া যায়নি ✓</div>'}
      </section>`;
  }

  function open() {
    const eng = engine();
    if (!eng) { window.toast && window.toast('Question engine now load হয়নি'); return; }
    injectCss();
    const report = eng.analyzeBank(questions());
    let el = document.getElementById('qePanel');
    if (!el) {
      el = document.createElement('div');
      el.id = 'qePanel';
      el.className = 'qe-overlay';
      document.body.appendChild(el);
    }
    el.innerHTML = `
      <div class="qe-sheet">
        <div class="qe-head"><b>🧬 Question Engine, বিশ্লেষণ</b><button class="qe-x" onclick="window.closeQuestionEnginePanel()">×</button></div>
        <div class="qe-body">${bodyHtml(report)}</div>
        <div class="qe-foot">
          <button class="btn secondary sm" onclick="window.tagAllQuestions()">সব প্রশ্নে ট্যাগ দাও</button>
          <button class="btn ghost sm" onclick="window.openQuestionEnginePanel()">রিফ্রেশ</button>
        </div>
      </div>`;
  }

  /* Tag every question, then persist only the records that actually changed. */
  async function tagAll() {
    const eng = engine();
    if (!eng || typeof dbPut !== 'function') return;
    const list = questions();
    if (!list.length) { window.toast && window.toast('প্রশ্নভান্ডার খালি'); return; }
    if (!window.confirm(`এই ${list.length}টি প্রশ্নে difficulty/type/concept ট্যাগ বসানো হবে, ঠিক আছে?`)) return;
    let changed = 0;
    try {
      for (const q of list) {
        const tagged = eng.tagQuestion(q);
        const same = q.difficulty === tagged.difficulty && q.type === tagged.type &&
          q.concept === tagged.concept && q.expectedTime === tagged.expectedTime && q.taggedBy === eng.ENGINE_VERSION;
        if (same) continue;
        await dbPut('questions', tagged);
        changed++;
      }
      if (typeof CACHE !== 'undefined' && typeof dbGetAll === 'function') CACHE.questions = await dbGetAll('questions');
      window.toast && window.toast(`${changed}টি প্রশ্নে ট্যাগ বসানো হয়েছে ✓`);
      open();
    } catch (e) {
      console.error('[P07] tagAll failed', e);
      window.toast && window.toast('ট্যাগ বসানো গেল না; আবার চেষ্টা করো।');
    }
  }

  window.openQuestionEnginePanel = open;
  window.closeQuestionEnginePanel = () => { const el = document.getElementById('qePanel'); if (el) el.remove(); };
  window.tagAllQuestions = tagAll;
})();
