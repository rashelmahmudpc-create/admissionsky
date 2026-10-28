/* routine90-parser.js, full-page 90-day routine parser */
(function (window, document) {
  'use strict';

  var SAMPLE = [
    'Day 1',
    'মাসি- পিসি',
    'কারক + বিভক্তি',
    'Noun',
    'Vocabulary',
    'বাগধারা',
    'বাংলাদেশ পরিচিতি',
    '',
    'Day 2',
    'অপরিচিতা , গন্তব্য কাবুল',
    'Tense',
    'সমাস',
    'বাংলাদেশের ইতিহাস'
  ].join('\n');
  var SUBJECTS = ['Bangla 1st', 'Bangla 2nd', 'English 2nd', 'Memorizing', 'বিরচন', 'GK'];
  var state = { raw: '', preview: null };
  var hostNavigate = window.navigate;

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
    });
  }

  function digits(value) {
    return String(value || '').replace(/[০-৯]/g, function (c) { return '০১২৩৪৫৬৭৮৯'.indexOf(c); });
  }

  function clean(value) {
    return String(value || '').replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').trim();
  }

  function isDayHeader(line) {
    var match = clean(line).match(/^(?:day|দিন)\s*[-:]?\s*([0-9০-৯]{1,3})\s*[:：]?$/i);
    return match ? Number(digits(match[1])) : 0;
  }

  function parse(raw) {
    var days = {};
    var errors = [];
    var warnings = [];
    var activeDay = 0;
    var linePositions = {};
    var topicCount = 0;
    var lines = String(raw || '').split(/\r?\n/);

    lines.forEach(function (original, index) {
      var lineNumber = index + 1;
      var line = clean(original);
      if (!line || /^#/.test(line)) return;
      var headerDay = isDayHeader(line);
      if (headerDay) {
        if (headerDay < 1 || headerDay > 90) {
          errors.push('Line ' + lineNumber + ': Day must be between 1 and 90.');
          activeDay = 0;
          return;
        }
        activeDay = headerDay;
        if (!days[activeDay]) days[activeDay] = [];
        if (linePositions[activeDay] == null) linePositions[activeDay] = 0;
        return;
      }
      if (!activeDay) {
        errors.push('Line ' + lineNumber + ': topic found before a Day header.');
        return;
      }
      var topics = line.split(/[,،，]/).map(clean).filter(Boolean);
      if (!topics.length) return;
      var position = linePositions[activeDay] || 0;
      if (position >= SUBJECTS.length) {
        errors.push('Line ' + lineNumber + ': Day ' + activeDay + ' has more than 6 topic lines. Use comma-separated topics on one line for the same Subject.');
        return;
      }
      var subject = SUBJECTS[position];
      linePositions[activeDay] = position + 1;
      topics.forEach(function (topic) {
        days[activeDay].push({ subject: subject, topic: topic, line: lineNumber, position: position + 1 });
        topicCount += 1;
      });
      if (topics.length > 1) warnings.push('Line ' + lineNumber + ': ' + topics.length + ' topics kept under serial ' + (position + 1) + ', ' + subject + '.');
    });

    var dayKeys = Object.keys(days).map(Number).sort(function (a, b) { return a - b; });
    dayKeys.forEach(function (day) { if (!days[day].length) delete days[day]; });
    dayKeys = Object.keys(days).map(Number).sort(function (a, b) { return a - b; });
    if (!dayKeys.length && !errors.length) errors.push('At least one Day section is required.');
    if (dayKeys.length && dayKeys.length < 90) warnings.push((90 - dayKeys.length) + ' days are not included; those existing cards will remain unchanged.');
    return { days: days, dayKeys: dayKeys, errors: errors, warnings: warnings, topicCount: topicCount, dayCount: dayKeys.length };
  }

  function navigate(path) {
    if (hostNavigate) hostNavigate(path);
    else location.hash = '#/' + path;
  }

  function toast(message) {
    if (window.toast) window.toast(message);
  }

  function pageHtml() {
    var preview = state.preview;
    var summary = preview ? '<div class="r90p-summary"><div><b>' + preview.dayCount + '</b><span>days found</span></div><div><b>' + preview.topicCount + '</b><span>topics found</span></div><div><b>' + preview.errors.length + '</b><span>errors</span></div></div>' : '';
    var errors = preview && preview.errors.length ? '<div class="r90p-alert error"><b>Fix these lines before applying</b>' + preview.errors.map(function (x) { return '<div>' + esc(x) + '</div>'; }).join('') + '</div>' : '';
    var warnings = preview && preview.warnings.length ? '<div class="r90p-alert warning"><b>Review before applying</b>' + preview.warnings.map(function (x) { return '<div>' + esc(x) + '</div>'; }).join('') + '</div>' : '';
    var previewBody = preview && !preview.errors.length ? preview.dayKeys.map(function (day) {
      var groups = {};
      preview.days[day].forEach(function (item) { if (!groups[item.subject]) groups[item.subject] = []; groups[item.subject].push(item.topic); });
      var groupHtml = SUBJECTS.filter(function (subject) { return groups[subject]; }).map(function (subject) {
        return '<div class="r90p-group"><span class="r90p-subject">' + esc(subject) + '</span><div class="r90p-topics">' + groups[subject].map(function (topic) { return '<span>' + esc(topic) + '</span>'; }).join('') + '</div></div>';
      }).join('');
      return '<section class="r90p-day"><div class="r90p-daynum">' + String(day).padStart(2, '0') + '</div><div><div class="r90p-daytitle">Day ' + day + '</div>' + groupHtml + '</div></section>';
    }).join('') : '<div class="r90p-empty"><span>⌘</span><b>Your parsed routine preview will appear here.</b><small>Day sections এবং serial অনুযায়ী Subject preview save করার আগে এখানে দেখা যাবে।</small></div>';
    var canApply = !!preview && !preview.errors.length && preview.dayCount > 0;
    return '<main class="r90p-page"><div class="r90p-shell"><header class="r90p-header"><button class="r90p-back" data-parser-action="back">← Back</button><div class="r90p-kicker">90-day admission planner</div><div class="r90p-mark">⌘</div></header><section class="r90p-hero"><div><div class="r90p-eyebrow">SMART ROUTINE IMPORT</div><h1>Build your 90-day routine</h1><p>শুধু Day নম্বর আর topic লিখুন। serial অনুযায়ী Subject বসে প্রতিটি topic সঠিক routine card-এ বসবে।</p></div><div class="r90p-hero-badge"><b>90</b><span>days<br>ready</span></div></section><section class="r90p-grid"><section class="r90p-panel r90p-input-panel"><div class="r90p-panelhead"><div><span class="r90p-label">STEP 01</span><h2>Paste your routine</h2></div><button class="r90p-link" data-parser-action="sample">Load example</button></div><p class="r90p-help">প্রতি section-এ <b>Day 1</b>, <b>Day 2</b> এভাবে লিখুন। Subject লিখতে হবে না। প্রতি Day-এর ১ম line থেকে ৬ষ্ঠ line ক্রমে Subject হবে: Bangla 1st, Bangla 2nd, English 2nd, Memorizing, বিরচন, GK। একই line-এ কমা দিয়ে একাধিক topic লিখলে সবগুলো সেই serial Subject-এর অধীনে থাকবে।</p><textarea id="r90p-input" spellcheck="false" placeholder="Day 1\nমাসি- পিসি\nকারক + বিভক্তি\nNoun\nVocabulary\nবাগধারা\nবাংলাদেশ পরিচিতি\n\nDay 2\nঅপরিচিতা , গন্তব্য কাবুল\n..."></textarea><div class="r90p-actions"><button class="r90p-secondary" data-parser-action="clear">Clear</button><button class="r90p-primary" data-parser-action="preview">Parse preview →</button></div></section><section class="r90p-panel r90p-preview-panel"><div class="r90p-panelhead"><div><span class="r90p-label">STEP 02</span><h2>Review and save</h2></div><span class="r90p-live">LIVE PREVIEW</span></div>' + summary + errors + warnings + '<div class="r90p-preview" id="r90p-preview">' + previewBody + '</div><div class="r90p-savebar"><div><b>Ready to fill your routine?</b><span>Existing completion marks are kept when the topic matches.</span></div><button class="r90p-apply" data-parser-action="apply" ' + (canApply ? '' : 'disabled') + '>Fill 90-day cards</button></div></section></section><section class="r90p-legend"><span><i class="r90p-dot green"></i>1 · Bangla 1st</span><span><i class="r90p-dot blue"></i>2 · Bangla 2nd</span><span><i class="r90p-dot purple"></i>3 · English 2nd</span><span><i class="r90p-dot gold"></i>4 · Memorizing</span><span><i class="r90p-dot green"></i>5 · বিরচন</span><span><i class="r90p-dot blue"></i>6 · GK</span></section></div></main>';
  }

  function bind() {
    var input = document.getElementById('r90p-input');
    if (state.raw) input.value = state.raw;
    document.querySelectorAll('[data-parser-action]').forEach(function (button) {
      button.addEventListener('click', function () {
        var action = button.dataset.parserAction;
        if (action === 'back') return navigate('dashboard');
        if (action === 'sample') { state.raw = SAMPLE; state.preview = parse(state.raw); render(); return; }
        if (action === 'clear') { state.raw = ''; state.preview = null; render(); return; }
        if (action === 'preview') { state.raw = input ? input.value : ''; state.preview = parse(state.raw); render(); return; }
        if (action === 'apply' && state.preview && !state.preview.errors.length) {
          if (!window.Routine90 || typeof window.Routine90.applyParsedPlan !== 'function') return toast('90-day routine is still loading.');
          var count = window.Routine90.applyParsedPlan(state.preview.days);
          toast(count + ' days filled in your 90-day routine.');
          navigate('progress/plan');
        }
      });
    });
  }

  function render() {
    var root = document.querySelector('#app') || document.body;
    root.innerHTML = pageHtml();
    bind();
  }

  var style = document.createElement('style');
  style.textContent = `\
  .r90p-page{min-height:100vh;padding:24px max(16px,calc((100vw - 1240px)/2)) 70px;background:radial-gradient(circle at 5% 8%,rgba(127,231,196,.22),transparent 25%),radial-gradient(circle at 96% 14%,rgba(123,153,255,.18),transparent 26%),linear-gradient(145deg,#f6fffc,#eff8ff 48%,#fbfcff);font-family:Inter,ui-sans-serif,system-ui,-apple-system,"Noto Sans Bengali","Noto Sans",sans-serif;color:#102a54}.r90p-shell{max-width:1180px;margin:0 auto}.r90p-header{display:flex;align-items:center;gap:14px;margin-bottom:28px}.r90p-back{border:1px solid #cfe4df;background:rgba(255,255,255,.72);color:#296d60;border-radius:13px;padding:11px 15px;font-weight:850;cursor:pointer}.r90p-kicker{font-size:11px;letter-spacing:.19em;text-transform:uppercase;color:#4f8c7b;font-weight:900}.r90p-mark{margin-left:auto;width:42px;height:42px;display:grid;place-items:center;border-radius:14px;background:#0f6b4f;color:#fff;font-size:22px;box-shadow:0 12px 26px rgba(15,107,79,.22)}.r90p-hero{display:flex;align-items:flex-end;justify-content:space-between;gap:25px;padding:34px 38px;margin-bottom:20px;border-radius:28px;background:linear-gradient(120deg,#0d684d,#1c8a6b 58%,#316ccf);color:#fff;box-shadow:0 22px 52px rgba(23,104,101,.21)}.r90p-eyebrow{font-size:10px;letter-spacing:.18em;font-weight:900;opacity:.75}.r90p-hero h1{margin:8px 0 9px;font-size:clamp(30px,5vw,52px);line-height:1.02;letter-spacing:-.055em}.r90p-hero p{max-width:670px;margin:0;color:rgba(255,255,255,.83);font-size:14px;line-height:1.7}.r90p-hero-badge{display:flex;align-items:center;gap:8px;min-width:125px;padding:15px 17px;border:1px solid rgba(255,255,255,.3);border-radius:18px;background:rgba(255,255,255,.13);backdrop-filter:blur(12px)}.r90p-hero-badge b{font-size:42px;line-height:1}.r90p-hero-badge span{font-size:11px;line-height:1.3;text-transform:uppercase;letter-spacing:.12em}.r90p-grid{display:grid;grid-template-columns:minmax(0,.88fr) minmax(0,1.12fr);gap:18px;align-items:start}.r90p-panel{border:1px solid rgba(190,218,214,.8);border-radius:24px;background:rgba(255,255,255,.86);box-shadow:0 17px 44px rgba(30,92,111,.09);padding:21px}.r90p-input-panel{position:sticky;top:16px}.r90p-panelhead{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.r90p-label{font-size:10px;letter-spacing:.16em;color:#779790;font-weight:900}.r90p-panel h2{margin:5px 0 0;font-size:21px;letter-spacing:-.035em;color:#123e5f}.r90p-link{border:0;background:transparent;color:#236bb6;font-weight:850;cursor:pointer;padding:4px 0}.r90p-help{margin:15px 0 12px;color:#587269;font-size:12px;line-height:1.65}.r90p-input-panel textarea{width:100%;min-height:420px;resize:vertical;border:1px solid #c9dfd9;border-radius:16px;background:#fbfffe;color:#173d58;padding:15px;font:14px/1.72 Inter,system-ui,"Noto Sans Bengali",sans-serif;outline:none}.r90p-input-panel textarea:focus{border-color:#39a487;box-shadow:0 0 0 4px rgba(57,164,135,.12)}.r90p-actions{display:flex;justify-content:flex-end;gap:9px;margin-top:13px}.r90p-secondary,.r90p-primary,.r90p-apply{border:0;border-radius:12px;padding:11px 15px;font-weight:900;cursor:pointer;transition:transform .16s cubic-bezier(.23,1,.32,1),box-shadow .2s}.r90p-primary,.r90p-apply{background:linear-gradient(135deg,#0f6b4f,#267ec2);color:#fff;box-shadow:0 10px 22px rgba(15,107,79,.18)}.r90p-secondary{background:#eef8f5;color:#397266}.r90p-primary:active,.r90p-apply:active,.r90p-secondary:active,.r90p-back:active{transform:scale(.97)}.r90p-primary:hover,.r90p-apply:hover{box-shadow:0 14px 28px rgba(15,107,79,.25);transform:translateY(-1px)}.r90p-live{padding:6px 9px;border-radius:99px;background:#e7f7ef;color:#22835d;font-size:9px;font-weight:900;letter-spacing:.1em}.r90p-summary{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:17px 0 13px}.r90p-summary div{padding:11px 9px;border-radius:13px;background:#f0faf6;text-align:center}.r90p-summary b{display:block;color:#126e52;font-size:22px}.r90p-summary span{display:block;margin-top:2px;color:#668278;font-size:10px}.r90p-alert{display:grid;gap:4px;padding:11px 12px;border-radius:13px;margin:10px 0;font-size:11px;line-height:1.45}.r90p-alert b{font-size:11px}.r90p-alert.error{background:#fff0f2;color:#a33e50;border:1px solid #ffd5dc}.r90p-alert.warning{background:#fff9e9;color:#92703a;border:1px solid #f7e4a8}.r90p-preview{display:grid;gap:9px;max-height:660px;overflow:auto;padding:2px 3px 2px 1px}.r90p-day{display:grid;grid-template-columns:50px minmax(0,1fr);gap:12px;padding:13px;border:1px solid #d8ebe5;border-radius:16px;background:linear-gradient(135deg,#fff,#f5fbfa)}.r90p-daynum{display:grid;place-items:center;width:50px;height:50px;border-radius:15px;background:#e4f5ef;color:#16785b;font-size:20px;font-weight:950}.r90p-daytitle{margin:2px 0 8px;color:#184867;font-weight:950}.r90p-group{display:grid;grid-template-columns:110px minmax(0,1fr);gap:8px;align-items:start;margin-top:6px}.r90p-subject{color:#387467;font-size:11px;font-weight:900}.r90p-topics{display:flex;flex-wrap:wrap;gap:5px}.r90p-topics span{display:inline-block;padding:4px 7px;border-radius:7px;background:#f0f7ff;color:#365b79;font-size:11px;line-height:1.35}.r90p-empty{display:grid;place-items:center;gap:6px;min-height:300px;border:1px dashed #b8d9d0;border-radius:17px;background:#f8fffc;color:#587c70;text-align:center;padding:30px}.r90p-empty span{font-size:30px;color:#52a18b}.r90p-empty b{color:#2b695d}.r90p-empty small{max-width:260px;line-height:1.5;color:#7a9690}.r90p-savebar{display:flex;align-items:center;justify-content:space-between;gap:13px;margin-top:15px;padding-top:15px;border-top:1px solid #e0eee9}.r90p-savebar b,.r90p-savebar span{display:block}.r90p-savebar b{font-size:12px;color:#265c54}.r90p-savebar span{margin-top:3px;color:#79928d;font-size:10px;line-height:1.4}.r90p-apply:disabled{cursor:not-allowed;opacity:.45;box-shadow:none}.r90p-legend{display:flex;flex-wrap:wrap;gap:12px 21px;margin:17px 4px 0;color:#6d8882;font-size:10px}.r90p-legend span{display:inline-flex;align-items:center;gap:5px}.r90p-dot{width:7px;height:7px;border-radius:50%;display:inline-block}.r90p-dot.green{background:#2b9b7b}.r90p-dot.blue{background:#3e83cf}.r90p-dot.purple{background:#8065c5}.r90p-dot.gold{background:#c88a35}@media(max-width:860px){.r90p-grid{grid-template-columns:1fr}.r90p-input-panel{position:static}.r90p-input-panel textarea{min-height:300px}}@media(max-width:560px){.r90p-page{padding:15px 11px 50px}.r90p-header{margin-bottom:17px}.r90p-kicker{font-size:9px}.r90p-hero{align-items:flex-start;padding:23px 19px;flex-direction:column;border-radius:22px}.r90p-hero h1{font-size:34px}.r90p-hero-badge{min-width:110px}.r90p-panel{padding:16px;border-radius:19px}.r90p-group{grid-template-columns:1fr;gap:3px}.r90p-savebar{align-items:stretch;flex-direction:column}.r90p-apply{width:100%}.r90p-legend{line-height:1.45}}`;
  document.head.appendChild(style);
  window.Routine90Parser = { render: render, parse: parse };
})(window, document);
