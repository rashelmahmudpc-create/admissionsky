/*
 * Weekly AI Report, Admission Hub
 * Progress পেজে "এই সপ্তাহের রিপোর্ট" কার্ড। সপ্তাহ-কী cache: একই সপ্তাহে
 * একটাই নতুন AI call; AI secure proxy থেকে আসে (কোনো key client-side নেই)।
 */
(() => {
  'use strict';

  const CACHE_KEY = 'ah-weekly-report-v1';
  const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
  const safe = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));

  function isoWeekKey(d = new Date()) {
    const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    const day = t.getUTCDay() || 7;
    t.setUTCDate(t.getUTCDate() + 4 - day);
    const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
    const week = Math.ceil((((t - yearStart) / 86400000) + 1) / 7);
    return `${t.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
  }

  const rowsOf = (r) => (Array.isArray(r?.snapshot) ? r.snapshot : []);
  const inRange = (r, from, to) => { const t = Number(r?.completedAt || r?.date || 0); return t >= from && (to == null || t < to); };

  function summarize(results) {
    const s = { exams: results.length, questions: 0, correct: 0, wrong: 0, skipped: 0, subjects: {}, topics: {} };
    for (const r of results) for (const row of rowsOf(r)) {
      const st = String(row?.status || '');
      if (!['correct', 'wrong', 'skipped'].includes(st)) continue;
      s.questions++;
      if (st === 'correct') s.correct++; else if (st === 'wrong') s.wrong++; else s.skipped++;
      const sub = String(row?.subjectName || row?.subjectId || 'অন্যান্য');
      s.subjects[sub] = s.subjects[sub] || { attempts: 0, correct: 0, wrong: 0 };
      s.subjects[sub].attempts++; if (st === 'correct') s.subjects[sub].correct++; else if (st === 'wrong') s.subjects[sub].wrong++;
      const top = String(row?.topicName || '').trim();
      if (top) { s.topics[top] = s.topics[top] || { attempts: 0, correct: 0 }; s.topics[top].attempts++; if (st === 'correct') s.topics[top].correct++; }
    }
    s.accuracy = s.correct + s.wrong > 0 ? Math.round((s.correct / (s.correct + s.wrong)) * 100) : null;
    return s;
  }

  function weeklyStats() {
    const all = (typeof CACHE !== 'undefined' && Array.isArray(CACHE.examResults)) ? CACHE.examResults : [];
    const now = Date.now();
    const thisWeek = all.filter((r) => inRange(r, now - WEEK_MS));
    const prevWeek = all.filter((r) => inRange(r, now - 2 * WEEK_MS, now - WEEK_MS));
    const a = summarize(thisWeek), p = summarize(prevWeek);
    const subjects = Object.entries(a.subjects).map(([name, v]) => ({ name, attempts: v.attempts, accuracy: v.correct + v.wrong > 0 ? Math.round((v.correct / (v.correct + v.wrong)) * 100) : null })).sort((x, y) => (y.attempts - x.attempts)).slice(0, 8);
    const weakTopics = Object.entries(a.topics).map(([name, v]) => ({ name, attempts: v.attempts, accuracy: Math.round((v.correct / v.attempts) * 100) })).filter((t) => t.attempts >= 3 && t.accuracy < 70).sort((x, y) => (x.accuracy - y.accuracy)).slice(0, 4);
    return { weekKey: isoWeekKey(), thisWeek: { exams: a.exams, questions: a.questions, correct: a.correct, wrong: a.wrong, skipped: a.skipped, accuracy: a.accuracy }, prevWeek: { exams: p.exams, questions: p.questions, accuracy: p.accuracy }, subjects, weakTopics };
  }

  function loadCached(weekKey) {
    try { const c = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null'); return (c && c.weekKey === weekKey && c.data) ? c : null; } catch (_) { return null; }
  }
  function saveCached(weekKey, data) { try { localStorage.setItem(CACHE_KEY, JSON.stringify({ weekKey, data, at: Date.now() })); } catch (_) {} }

  function parseJson(text) {
    const raw = String(text || '').trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
    try { const p = JSON.parse(raw); return p && typeof p === 'object' ? p : null; } catch (_) {}
    const a = raw.indexOf('{'), b = raw.lastIndexOf('}');
    if (a >= 0 && b > a) { try { const p = JSON.parse(raw.slice(a, b + 1)); return p && typeof p === 'object' ? p : null; } catch (_) {} }
    return null;
  }

  function cardHtml() {
    const stats = weeklyStats();
    const cached = loadCached(stats.weekKey);
    const summary = stats.thisWeek.exams
      ? `এই সপ্তাহে <b>${stats.thisWeek.exams}</b>টি পরীক্ষা · ${stats.thisWeek.questions} প্রশ্ন · accuracy ${stats.thisWeek.accuracy == null ? '-' : stats.thisWeek.accuracy + '%'}`
      : 'এই সপ্তাহে এখনো কোনো পরীক্ষা হয়নি, পরীক্ষা দিলে রিপোর্ট আরও নিখুঁত হবে।';
    if (cached) return weeklyInner(cached.data, stats, true);
    return `<div class="card weekly-report-card" id="weeklyReportCard"><div class="row between"><b>📊 এই সপ্তাহের রিপোর্ট</b></div><div class="muted" style="margin-top:5px;font-size:12.5px">${summary}</div><button class="btn" style="margin-top:10px" onclick="WeeklyReport.generate()">${stats.thisWeek.exams ? '🤖 AI রিপোর্ট তৈরি করো' : '🤖 AI রিপোর্ট দেখাও'}</button></div>`;
  }

  function weeklyInner(data, stats, fromCache) {
    const tasks = Array.isArray(data.tasks) ? data.tasks.filter(Boolean) : [];
    const strong = Array.isArray(data.strongAreas) ? data.strongAreas.filter(Boolean) : [];
    const weak = Array.isArray(data.weakTopics) ? data.weakTopics.filter(Boolean) : [];
    return `<div class="card weekly-report-card" id="weeklyReportCard"><div class="row between"><b>📊 এই সপ্তাহের রিপোর্ট</b><span class="muted" style="font-size:10.5px">${fromCache ? 'জমানো ✓' : 'নতুন'}</span></div>${data.opening ? `<div style="margin-top:8px;font-size:13.5px;line-height:1.75;overflow-wrap:anywhere">${safe(data.opening)}</div>` : ''}${data.trend ? `<div class="muted" style="margin-top:7px;font-size:12.5px;line-height:1.7;overflow-wrap:anywhere">📈 ${safe(data.trend)}</div>` : ''}${strong.length ? `<div style="margin-top:9px;font-size:12.5px;line-height:1.7"><b>✓ শক্ত জায়গা:</b> ${strong.map((x) => safe(x)).join(' · ')}</div>` : ''}${weak.length ? `<div style="margin-top:5px;font-size:12.5px;line-height:1.7"><b>! একটু বেশি নজর দাও:</b> ${weak.map((x) => safe(x)).join(' · ')}</div>` : ''}${tasks.length ? `<div style="margin-top:10px"><b style="font-size:12.5px">📅 পরের সপ্তাহের ৩টি কাজ</b><ol style="margin:6px 0 0;padding-inline-start:20px;font-size:12.5px;line-height:1.8">${tasks.slice(0, 3).map((t) => `<li style="overflow-wrap:anywhere">${safe(t)}</li>`).join('')}</ol></div>` : ''}${data.motivation ? `<div style="margin-top:9px;font-size:12.5px;color:var(--emerald-d);font-weight:700;overflow-wrap:anywhere">${safe(data.motivation)}</div>` : ''}${data.verdict ? `<div style="margin-top:8px;font-size:13px;font-weight:800;overflow-wrap:anywhere">${safe(data.verdict)}</div>` : ''}<div class="muted" style="margin-top:8px;font-size:10.5px">AI রিপোর্ট, সিদ্ধান্তের আগে নিজের হিসাবও মিলিয়ে নিও।</div></div>`;
  }

  let tsApiPromise = null;
  function ensureTsApi() {
    if (window.turnstile) return Promise.resolve(window.turnstile);
    if (tsApiPromise) return tsApiPromise;
    tsApiPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      s.async = true;
      s.onload = () => window.turnstile ? resolve(window.turnstile) : reject(new Error('Turnstile লোড হয়নি'));
      s.onerror = () => { tsApiPromise = null; reject(new Error('Turnstile script লোড হয়নি')); };
      document.head.appendChild(s);
    });
    return tsApiPromise;
  }
  function getTurnstileToken(siteKey) {
    if (!siteKey) return Promise.reject(new Error('Human verification site key নেই।'));
    return ensureTsApi().then((api) => new Promise((resolve, reject) => {
      const host = document.createElement('div');
      host.setAttribute('aria-hidden', 'true');
      host.style.cssText = 'position:fixed;right:0;bottom:0;width:1px;height:1px;overflow:hidden;opacity:.01';
      document.body.appendChild(host);
      let done = false, wid = null;
      const finish = (fn, v) => { if (done) return; done = true; clearTimeout(t); try { api.remove(wid); } catch (_) {} try { host.remove(); } catch (_) {} fn(v); };
      const t = setTimeout(() => finish(reject, new Error('Human verification সময়মতো হয়নি।')), 45000);
      try {
        wid = api.render(host, { sitekey: siteKey, action: 'result_analysis', size: 'invisible', appearance: 'interaction-only',
          callback: (tok) => finish(resolve, String(tok || '')),
          'error-callback': () => finish(reject, new Error('Human verification ব্যর্থ।')),
          'expired-callback': () => finish(reject, new Error('Human verification মেয়াদ শেষ।')) });
      } catch (e) { finish(reject, e instanceof Error ? e : new Error('Turnstile শুরু হয়নি।')); return; }
      try { api.execute(wid); } catch (_) {}
    }));
  }

  async function pollRun(endpoint, runId) {
    const url = `${String(endpoint).replace(/\/+$/, '')}/${encodeURIComponent(runId)}`;
    const deadline = Date.now() + 180000;
    while (Date.now() < deadline) {
      const res = await fetch(url, { headers: { Accept: 'application/json' } });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      const st = String(data.status || '').toLowerCase();
      if (st === 'completed') return String(data.analysis || data.result || data.text || '');
      if (st === 'failed' || st === 'cancelled') throw new Error('AI run সম্পন্ন হয়নি।');
      await new Promise((r) => setTimeout(r, 2500));
    }
    throw new Error('AI অনেক সময় নিচ্ছে; পরে আবার চেষ্টা করো।');
  }

  function setBusy(busy, msg) {
    const card = document.getElementById('weeklyReportCard');
    if (!card) return;
    if (busy) card.innerHTML = `<div class="row between"><b>📊 এই সপ্তাহের রিপোর্ট</b></div><div class="muted" style="margin-top:8px;font-size:12.5px">🤖 AI এই সপ্তাহের হিসাব দেখে রিপোর্ট লিখছে… (৩০–৬০ সেকেন্ড)</div>`;
    else if (msg) card.innerHTML = `<div class="row between"><b>📊 এই সপ্তাহের রিপোর্ট</b></div><div class="muted" style="margin-top:8px;font-size:12.5px">${safe(msg)}</div><button class="btn" style="margin-top:10px" onclick="WeeklyReport.generate()">আবার চেষ্টা করো</button>`;
  }

  async function generate() {
    const stats = weeklyStats();
    const cached = loadCached(stats.weekKey);
    if (cached) { const card = document.getElementById('weeklyReportCard'); if (card) card.outerHTML = weeklyInner(cached.data, stats, true); return; }
    if (!stats.thisWeek.exams) {
      setBusy(false, 'এই সপ্তাহে এখনো কোনো সম্পন্ন পরীক্ষা নেই। অন্তত একটি পরীক্ষা শেষ করলে AI রিপোর্ট তৈরি হবে।');
      return;
    }
    const endpoint = String(window.ADMISSION_HUB_AI_ENDPOINT || '').trim();
    const siteKey = String(window.ADMISSION_HUB_TURNSTILE_SITEKEY || '').trim();
    if (!endpoint) { setBusy(false, 'Secure AI endpoint পাওয়া যায়নি।'); return; }
    setBusy(true);
    try {
      let token = '';
      try { token = siteKey ? await getTurnstileToken(siteKey) : ''; } catch (_) {
        // Keep the real request flowing; the proxy enforces its own daily quota.
        token = '';
      }
      const res = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ schemaVersion: 'admission-hub-result-analysis-v1', result: { id: 'weekly', title: 'Weekly report', examType: 'সাপ্তাহিক সংকলন', completedAt: new Date().toISOString() }, previousResults: [], subjectPerformance: [], topicPerformance: [], requestType: 'weekly_report', weekly: stats, turnstileToken: token }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      const text = data.analysis || data.result || data.text || (data.runId ? await pollRun(endpoint, data.runId) : '');
      const parsed = parseJson(text);
      if (!parsed) throw new Error('রিপোর্ট পড়া গেল না, আবার চেষ্টা করো।');
      saveCached(stats.weekKey, parsed);
      const card = document.getElementById('weeklyReportCard');
      if (card) card.outerHTML = weeklyInner(parsed, stats, false);
    } catch (e) {
      setBusy(false, `রিপোর্ট পাওয়া যায়নি: ${e?.message || 'অজানা সমস্যা'}`);
    }
  }

  const prevExtras = window.__phase3ProgressExtras;
  window.__phase3ProgressExtras = function weeklyReportExtra() {
    try { return cardHtml() + (typeof prevExtras === 'function' ? prevExtras() : ''); }
    catch (_) { return typeof prevExtras === 'function' ? prevExtras() : ''; }
  };
  window.WeeklyReport = { generate };
})();
