/* v119, Admission Hub Smart Notification engine (client).
   Phase 2 (owner-approved 2026-09-17): global feed unread in the bell badge,
   notification click logging for the global engine analytics.
   Round 8 (owner directive 2026-09-17): auto engine OFF, premium centered
   allow dialog (one tap, silent success), bell = inbox-or-allow only.
   Golden rule: "Notification পাঠানোর মতো কারণ না থাকলে পাঠাবে না।"
   সব claim আসল ডেটা থেকে (activityLogs/examResults/mistakes/streak), fake praise নিষিদ্ধ।
   Delivery: Telegram + iPhone/PWA web-push (নিজের Cloudflare worker); user active থাকলে শুধু in-app toast। */
(() => {
  'use strict';

  const DEFAULT_ENDPOINT = 'https://admission-notify.admissionhub.workers.dev';
  const LS_ENDPOINT = 'ahNotifyUrl';
  const VAPID_PUBLIC = 'BJtpFY7isSDAQy7ck7zNQjNfmhAu4w-bcQ3_eFUTQbITSHBJO5f6n5ayYm_-TE7vNcnZ_1Ib45DVmxQkyLIFDsY';
  const APP_HEADER = 'admission-hub';
  /* Inline SVG line icons, the student chrome is emoji-led too; premium look
   * comes from one consistent stroke set, not pictographs. */
  const ICON = {
    bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2V23a2 2 0 1 1-4 0v-.1A1.7 1.7 0 0 0 7 21.4a1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0-1.2-2.9H1a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 2.6 7a1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 2.9-1.2V1a2 2 0 1 1 4 0v.1A1.7 1.7 0 0 0 17 7a1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0 1.2 2.9H23a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>',
    close: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    phone: '<rect x="6" y="2" width="12" height="20" rx="2"/><path d="M11 18h2"/>',
    shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    alert: '<path d="M12 9v4"/><path d="M12 17h.01"/><circle cx="12" cy="12" r="9"/>'
  };
  const icon = (name, size = 18) =>
    `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex:0 0 auto">${ICON[name] || ''}</svg>`;
  /* Owner directive 2026-09-17 (round 8): auto-generated notifications are
   * OFF ("সেকেন্ডের পর সেকেন্ড অটোমেটিক নোটিফিকেশন আসছে, বন্ধ করতে হবে").
   * The candidate/decision engine below stays in place; real announcements
   * (Phase 2+ global push) will use the explicit send path instead. */
  const AUTO_ENGINE_ENABLED = false;

  const DEFAULT_PREFS = Object.freeze({
    master: true,
    cats: { study: true, streak: true, revision: true, mistake: true, achievement: true, exam: true, admission: true, update: true },
    times: { morning: '08:00', afternoon: '16:00', evening: '20:00' },
    quiet: { start: 23, end: 7 },
    dailyCap: 3,
    cooldownH: 3
  });
  const CAT_LABEL = { study: 'Study Reminder', streak: 'Streak', revision: 'Revision', mistake: 'Mistake Bank', achievement: 'Progress & Achievement', exam: 'Exam Reminder', admission: 'Admission Alert', update: 'Important Update' };
  const CAT_SOON = { admission: true, update: true, exam: true }; // জেনারেটর আসছে, আসল ডেটা ছাড়া কিছু পাঠানো হবে না

  let endpoint = DEFAULT_ENDPOINT;
  try {
    const saved = String(localStorage.getItem(LS_ENDPOINT) || '').trim();
    endpoint = saved === 'off' ? '' : (saved || DEFAULT_ENDPOINT);
  } catch (_) {}
  const saveEndpoint = url => {
    const value = String(url || '').trim().replace(/\/+$/, '');
    endpoint = value === 'off' ? '' : (value || DEFAULT_ENDPOINT);
    try { localStorage.setItem(LS_ENDPOINT, value); } catch (_) {}
    return endpoint;
  };

  const uid = () => 'n-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const todayKey = (date) => { const d = date ? new Date(date) : new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

  // ── prefs + state (appMeta) + log (notifications store) ─────────────────────
  const getPrefs = async () => {
    try { const row = await dbGet('appMeta', 'ahNotifPrefs'); return { ...DEFAULT_PREFS, ...(row?.value || {}), cats: { ...DEFAULT_PREFS.cats, ...(row?.value?.cats || {}) }, times: { ...DEFAULT_PREFS.times, ...(row?.value?.times || {}) }, quiet: { ...DEFAULT_PREFS.quiet, ...(row?.value?.quiet || {}) } }; }
    catch (_) { return { ...DEFAULT_PREFS }; }
  };
  const savePrefs = async prefs => { try { await dbPut('appMeta', { id: 'ahNotifPrefs', value: prefs }); } catch (_) {} return prefs; };
  const getState = async () => { try { return (await dbGet('appMeta', 'ahNotifState'))?.value || {}; } catch (_) { return {}; } };
  const saveState = async value => { try { await dbPut('appMeta', { id: 'ahNotifState', value }); } catch (_) {} return value; };
  const logRows = async () => { try { return await dbGetAll('notifications'); } catch (_) { return []; } };
  const logRow = async row => { try { await dbPut('notifications', row); } catch (_) {} return row; };

  // ── আসল ডেটা ────────────────────────────────────────────────────────────────
  const todayQuestions = () => {
    try {
      const key = todayKey();
      return CACHE.examResults.filter(r => todayKey(new Date(r.date)) === key)
        .reduce((sum, r) => sum + (Number(r.correct) || 0) + (Number(r.wrong) || 0) + (Number(r.skipped) || 0), 0);
    } catch (_) { return 0; }
  };
  const streakBase = () => { // গতকাল-পর্যন্ত ধারা (আজ এখনো না হলে streak-ঝুঁকির আসল সংখ্যা)
    try {
      const days = new Set(CACHE.activityLogs.map(a => a.day));
      CACHE.examResults.forEach(r => days.add(todayKey(new Date(r.date))));
      let streak = 0; const d = new Date(); d.setDate(d.getDate() - 1);
      while (days.has(todayKey(d))) { streak++; d.setDate(d.getDate() - 1); }
      return streak;
    } catch (_) { return 0; }
  };
  const streakNow = () => { try { return typeof computeStreak === 'function' ? computeStreak() : 0; } catch (_) { return 0; } };
  const streakAtRisk = () => { const s = streakNow(); return s > 0 ? s : streakBase(); };
  const mistakeCount = () => { try { return (CACHE.mistakes || []).length; } catch (_) { return 0; } };
  const dailyTarget = () => { try { return Math.max(1, Number(CACHE.settings?.dailyTarget) || 100); } catch (_) { return 100; } };
  // Smart time learning: গত ১৪ দিনে study activity-র গড় ঘণ্টা (সন্ধ্যা-রাতের দিকে ভাঁজ করা)
  const preferredHour = () => {
    try {
      const cutoff = Date.now() - 14 * 86400000;
      const hours = (CACHE.activityLogs || []).filter(a => Number(a.ts) >= cutoff).map(a => new Date(Number(a.ts)).getHours());
      if (hours.length < 3) return null;
      const eveningish = hours.map(h => (h < 6 ? h + 24 : h));
      const mean = eveningish.reduce((a, b) => a + b, 0) / eveningish.length;
      return Math.floor(Math.min(23, Math.max(12, mean)));
    } catch (_) { return null; }
  };
  const inQuietHours = (hour, quiet) => quiet.start > quiet.end ? (hour >= quiet.start || hour < quiet.end) : (hour >= quiet.start && hour < quiet.end);

  // ── Candidate builders (spec §3–§8), সবই আসল সংখ্যা দিয়ে ────────────────────
  const buildCandidates = (snapshot, prefs, state) => {
    const list = [];
    const { now, streak, todayQ, target, mistakes, prefHour } = snapshot;
    const hour = now.getHours();
    const today = todayKey(now);
    if (prefs.cats.streak && streak >= 2 && todayQ === 0 && hour >= 17 && hour < 23) {
      list.push({ category: 'streak', priority: 4, dedup: `streak-risk-${today}`, title: `Streak ভাঙার ঝুঁকি (${streak} দিন)`, body: 'তোর streak আজ ভেঙে যেতে পারে। চল অন্তত 10টা MCQ দিয়ে বাঁচিয়ে রাখি।' });
    }
    if (prefs.cats.study && todayQ === 0 && prefHour !== null && hour >= Math.max(12, prefHour - 1) && hour < Math.min(23, prefHour + 2)) {
      list.push({ category: 'study', priority: 3, dedup: `study-${today}`, title: 'পড়ার সময় হয়ে গেছে', body: 'এই সময়টায় তুই সাধারণত পড়া শুরু করিস। চল আজকের practice দিয়ে শুরু করি।' });
    }
    if (prefs.cats.study && todayQ === 0 && hour >= 10 && hour < 12 && state.morningPrompt !== today) {
      list.push({ category: 'study', priority: 2, dedup: `study-am-${today}`, title: 'দিনটা শুরু করবি?', body: 'সকালের একটা ছোট practice সারাদিনের মুড ঠিক করে দেয়, 10টা MCQ দিয়ে শুরু করি!' });
    }
    if (prefs.cats.study && todayQ > 0 && todayQ < target && hour >= 21 && hour < 23) {
      list.push({ category: 'study', priority: 2, dedup: `study-eve-${today}`, title: 'একটু বাকি রয়ে গেছে', body: `আজ ${todayQ}টা হয়েছে, target ${target}। আর ${target - todayQ}টা দিলেই আজকেরটা complete!` });
    }
    if (prefs.cats.mistake && mistakes >= 25 && (state.lastMistakeSent || 0) <= mistakes - 5) {
      list.push({ category: 'mistake', priority: 3, dedup: `mistake-${mistakes}`, title: 'Mistake Bank ভর্তি', body: `${mistakes}টা ভুল জমেছে। আজ 10 মিনিট এগুলো ঘেঁটে দেখলে অনেক লাভ হবে।` });
    }
    for (const m of [50, 100, 200, 300, 500]) {
      if (prefs.cats.achievement && todayQ >= m && (state.lastMilestone || 0) < m && todayQ - 5 < m) {
        list.push({ category: 'achievement', priority: 2, dedup: `milestone-${today}-${m}`, title: `আজ ${m} MCQ complete!`, body: 'দুর্দান্ত গতি! এভাবেই চালিয়ে যা', milestone: m });
      }
    }
    if (prefs.cats.achievement && todayQ >= target && (state.lastTargetDone || '') !== today && todayQ - 5 < target) {
      list.push({ category: 'achievement', priority: 3, dedup: `target-${today}`, title: 'আজকের target complete!', body: `${todayQ}/${target}, আজকের প্রস্তুতি নিশ্চিত। শুভকামনা!` });
    }
    return list;
  };

  // ── Decision engine (spec §30 ধাপ ১–১০) ─────────────────────────────────────
  const evaluate = async (opts = {}) => {
    const result = { sent: null, suppressed: [], reason: '', inApp: false };
    if (!AUTO_ENGINE_ENABLED) { result.reason = 'engine-off'; return result; }
    try {
      const prefs = await getPrefs();
      if (!prefs.master) { result.reason = 'master-off'; return result; }
      const now = opts.now && typeof opts.now.getHours === 'function' ? opts.now : new Date();
      const hour = now.getHours();
      if (inQuietHours(hour, prefs.quiet)) { result.reason = 'quiet-hours'; return result; }
      const state = await getState();
      const today = todayKey(now);
      const snapshot = { now, streak: streakAtRisk(), todayQ: todayQuestions(), target: dailyTarget(), mistakes: mistakeCount(), prefHour: preferredHour() };
      const candidates = buildCandidates(snapshot, prefs, state)
        .filter(candidate => !!prefs.cats[candidate.category])
        .sort((a, b) => b.priority - a.priority);
      if (!candidates.length) { result.reason = 'no-relevant'; return result; }
      const seen = new Set();
      for (const candidate of candidates) {
        if (seen.has(candidate.dedup)) continue;
        seen.add(candidate.dedup);
        const rows = await logRows();
        if (rows.some(row => row.dedup === candidate.dedup && row.status !== 'cancelled')) { result.suppressed.push(candidate.title + ' (আগে পাঠানো)'); continue; }
        if (state.lastSentAt && now.getTime() - state.lastSentAt < prefs.cooldownH * 3600000) { result.suppressed.push(candidate.title + ' (cooldown)'); continue; }
        const sentToday = state.sentDate === today ? (state.sentCount || 0) : 0;
        if (sentToday >= prefs.dailyCap) { result.suppressed.push(candidate.title + ' (daily cap)'); continue; }
        // Active user → push নয়, in-app toast (spec §21)
        const active = typeof document !== 'undefined' && document.visibilityState === 'visible' && !opts.force;
        const chosen = candidate;
        result.inApp = active;
        await logRow({ id: uid(), category: chosen.category, title: chosen.title, body: chosen.body, priority: chosen.priority, dedup: chosen.dedup, status: active ? 'shown-in-app' : 'sent', readAt: active ? Date.now() : null, createdAt: now.getTime() });
        const nextState = { ...state, lastSentAt: now.getTime(), sentDate: today, sentCount: sentToday + 1, lastTodayQ: snapshot.todayQ };
        if (chosen.category === 'mistake') nextState.lastMistakeSent = snapshot.mistakes;
        if (chosen.milestone) nextState.lastMilestone = chosen.milestone;
        if (chosen.dedup?.startsWith('target-')) nextState.lastTargetDone = today;
        if (chosen.dedup?.startsWith('study-am-')) nextState.morningPrompt = today;
        await saveState(nextState);
        if (active) { try { window.toast?.(chosen.title + ', ' + chosen.body); } catch (_) {} }
        else await dispatch(chosen, snapshot);
        result.sent = chosen;
        return result;
      }
      result.reason = 'all-suppressed';
      return result;
    } catch (_) { result.reason = 'error'; return result; }
  };

  // ── Delivery: worker → Telegram + Web Push (+ state sync for cron fallback) ──
  /* BUG-001 (2026-10-26): /api/notify/dispatch now requires a real proof of
     identity, because the static X-AH-App header ships in this bundle and
     anyone could read it and message every subscriber. A control device sends
     the owner's admin token, exactly as cloud-content-sync.js does for
     /api/cloud/publish. */
  const dispatchHeaders = () => {
    const base = { 'Content-Type': 'application/json', 'X-AH-App': APP_HEADER };
    let token = '';
    try { token = sessionStorage.getItem('ahAdminTok') || ''; } catch (_) {}
    return token ? { ...base, Authorization: 'Bearer ' + token } : base;
  };
  const dispatch = async (chosen, snapshot) => {
    if (!endpoint) return 'off';
    try {
      const res = await fetch(endpoint + '/api/notify/dispatch', {
        method: 'POST',
        headers: dispatchHeaders(),
        body: JSON.stringify({
          telegram: { text: `${chosen.title}\n\n${chosen.body}` },
          state: { streak: snapshot.streak, todayQuestions: snapshot.todayQ, lastOpen: todayKey() }
        })
      });
      // 403 means this device holds no owner token; say so instead of reporting
      // a delivery that never happened.
      if (res && res.status === 403) return 'forbidden';
      return 'ok';
    } catch (_) { return 'fail'; } // spec §46: failure কখনো app break করবে না
  };
  const syncState = async () => {
    if (!endpoint) return;
    try {
      await fetch(endpoint + '/api/notify/state', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-AH-App': APP_HEADER },
        body: JSON.stringify({ state: { streak: streakNow(), todayQuestions: todayQuestions(), lastOpen: todayKey() } })
      });
    } catch (_) {}
  };

  // ── iOS/PWA push subscription (spec §26–§27: gesture-পরবর্তী, কখনো auto-popup নয়) ──
  const b64uToU8 = str => { const s = str.replace(/-/g, '+').replace(/_/g, '/'); const bin = atob(s + '='.repeat((4 - s.length % 4) % 4)); return Uint8Array.from(bin, c => c.charCodeAt(0)); };
  const pushReady = () => typeof Notification !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window;
  const standalone = () => window.matchMedia?.('(display-mode: standalone)')?.matches || window.navigator.standalone === true;
  const enablePush = async () => {
    if (!pushReady()) { window.toast?.('এই device-এ web push নেই, Telegram-এ notification আসবে'); return 'unsupported'; }
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') { window.toast?.('নোটিফিকেশন চালু হয়নি, পরে Settings → Notifications থেকে চালু করতে পারবে।'); return permission; }
    try {
      const registration = await navigator.serviceWorker.ready;
      let subscription = await registration.pushManager.getSubscription();
      subscription = subscription || await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64uToU8(VAPID_PUBLIC) });
      const sub = subscription.toJSON();
      await fetch(endpoint + '/api/push/subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-AH-App': APP_HEADER }, body: JSON.stringify(sub) });
      window.toast?.('Notification চালু হয়েছে! iPhone push-এর জন্য অ্যাপটা Home Screen থেকে খুললে সবচেয়ে ভালো চলে।');
      return 'granted';
    } catch (_) {
      window.toast?.('Push subscribe হয়নি, তবু Telegram notification চলবে');
      return 'subscribe-failed';
    }
  };
  let lastResub = 0;
  const maybeResubscribe = async () => {
    const nowTs = Date.now();
    if (nowTs - lastResub < 5 * 60000 || !endpoint || !pushReady()) return;
    try {
      if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
      lastResub = nowTs;
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) await fetch(endpoint + '/api/push/subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-AH-App': APP_HEADER }, body: JSON.stringify(subscription.toJSON()) }).catch(() => {});
    } catch (_) {}
  };
  const disablePush = async () => {
    /* This toggle owns the VAPID subscription only. The FCM registration in
     * AhFcm is a separate channel, so leaving it active kept pushes arriving
     * after the user had turned push off, the confusing part was that the UI
     * said "off" while notifications continued. Stop both. */
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        await fetch(endpoint + '/api/push/unsubscribe', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-AH-App': APP_HEADER }, body: JSON.stringify(subscription.toJSON()) }).catch(() => {});
        await subscription.unsubscribe();
      }
      await window.AhFcm?.disable?.().catch(() => {});
      window.toast?.('Push বন্ধ হয়েছে');
    } catch (_) {}
  };

  // ── UI: dashboard card + notification center + settings ─────────────────────
  const unreadCount = async () => (await logRows()).filter(row => !row.readAt).length;
  // DOM-বসানো: কোন renderer জিতুক, ড্যাশবোর্ডে streak-কার্ডের ঠিক নিচে কার্ড বসাও (v108)
  const mountDashboardCard = () => {
    try {
      if (typeof document === 'undefined') return false;
      const page = document.querySelector('#app .page');
      if (!page) return false;
      if (page.querySelector('#ahNotifCard')) return true;
      const streak = page.querySelector('#dailyStreakCard');
      const holder = document.createElement('div');
      holder.innerHTML = dashboardHtml();
      const card = holder.firstElementChild;
      if (streak && streak.parentElement) streak.insertAdjacentElement('afterend', card);
      else page.insertBefore(card, page.firstChild);
      return true;
    } catch (_) { return false; }
  };
  const fmtTime = ts => { try { return new Date(ts).toLocaleString('bn-BD', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' }); } catch (_) { return ''; } };
  const dashboardHtml = () => `
    <div id="ahNotifCard" class="card premium-card fade-in stagger-1" style="display:flex;align-items:center;gap:12px">
      <div id="ahNotifIcon" style="position:relative;color:var(--emerald);flex:0 0 auto;display:grid;place-items:center">${icon('bell', 22)}
        <span id="ahNotifBadge" style="display:none;position:absolute;top:-7px;right:-9px;background:var(--red);color:#fff;border-radius:99px;font-size:10px;font-weight:800;padding:1px 5px"></span>
      </div>
      <div id="ahNotifCopy" style="flex:1;min-width:0;font-size:13px;line-height:1.45"></div>
      <!-- Owner fix 2026-09-24: the gear used to open a near-empty sheet,
           so it felt like a dead button. It now opens the real settings modal. -->
      <button class="iconbtn" style="flex:0 0 auto" title="Notification settings" aria-label="Notification settings" onclick="NotificationHub.openSettings()">${icon('gear', 18)}</button>
    </div>`;
  /* Phase 2: unread global notifications from the server feed (for the bell
   * badge). Bounded + fail-soft, the badge must never break the dashboard. */
  const globalUnreadCount = async () => {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      const res = await fetch('/api/notifications/inbox', { credentials: 'include', signal: controller.signal });
      clearTimeout(timer);
      if (!res.ok) return 0;
      const data = await res.json();
      return Number(data.unread || 0);
    } catch (_) { return 0; }
  };
  const hydrateDashboard = async () => {
    try {
      const copy = document.getElementById('ahNotifCopy');
      if (!copy) return;
      const permission = typeof Notification !== 'undefined' ? Notification.permission : 'unsupported';
      if (permission === 'default') {
        /* No auto-prompt (owner directive 2026-09-17): a calm single action
         * that opens the premium centered allow dialog. */
        copy.innerHTML = `<b>Notifications</b><br><span style="opacity:.75;font-size:11.5px">খবর এলে যেন মিস না হয়</span>
          <div style="display:flex;gap:8px;margin-top:8px"><button class="btn sm" onclick="NotificationHub.openAllowDialog()">চালু করুন</button></div>`;
      } else {
        const unread = (await unreadCount()) + (await globalUnreadCount());
        const badge = document.getElementById('ahNotifBadge');
        if (badge) { badge.style.display = unread ? 'inline-block' : 'none'; badge.textContent = unread > 9 ? '9+' : unread; }
        copy.innerHTML = `<b>Notifications</b> <span style="opacity:.7;font-size:11.5px">${unread ? `${unread}টি নতুন` : 'সব পড়া হয়ে গেছে'}</span><br><button class="btn ghost sm" style="margin-top:6px" onclick="NotificationHub.goInbox()">ইনবক্স খোলো</button>`;
      }
    } catch (_) {}
  };
  const dismissPrompt = async () => { await saveState({ ...(await getState()), promptDismissed: todayKey() }); window.toast?.('ঠিক আছে, Settings → Notifications থেকে যখন চাও চালু করতে পারবে।'); const copy = document.getElementById('ahNotifCopy'); if (copy) copy.innerHTML = '<b>Notifications</b><br><button class="btn ghost sm" style="margin-top:6px" onclick="NotificationHub.openCenter()">Notification Center খোলো</button>'; };
  const promptEnable = async () => { const status = await enablePush(); if (status === 'granted') hydrateDashboard(); };

  const openCenter = async () => {
    const rows = (await logRows()).sort((a, b) => b.createdAt - a.createdAt).slice(0, 20);
    openModal(`<h3>Notification Center</h3><p class="muted" style="margin-top:4px;font-size:12px">শুধু আসল কারণ থাকলেই কিছু আসে, নীরবতাও একটা ফিচার।</p>${rows.length ? `<div style="display:grid;gap:9px;margin-top:12px">${rows.map(row => `<div style="padding:11px;border:1px solid var(--line);border-radius:12px;background:${row.readAt ? 'transparent' : 'var(--mint)'}"><div style="display:flex;gap:8px;align-items:center"><b style="font-size:13px;flex:1">${escapeHtml(row.title)}</b>${row.readAt ? '' : '<span style="width:8px;height:8px;border-radius:99px;background:var(--emerald)"></span>'}</div><div style="font-size:12.5px;margin-top:3px;line-height:1.5">${escapeHtml(row.body)}</div><small style="color:var(--sub);font-size:10.5px">${fmtTime(row.createdAt)} · ${CAT_LABEL[row.category] || row.category}</small></div>`).join('')}</div>` : '<p class="muted" style="margin-top:12px">এখনো কোনো notification পাঠানো হয়নি।</p>'}<div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap"><button class="btn ghost sm" onclick="NotificationHub.markAllRead();closeModal()">Mark all as read</button><button class="btn ghost sm" onclick="NotificationHub.openSettings()">Settings</button><button class="btn sm" onclick="closeModal()">Close</button></div>`);
    await markAllRead();
  };
  const markAllRead = async () => {
    const rows = await logRows();
    for (const row of rows) if (!row.readAt) await logRow({ ...row, readAt: Date.now(), status: row.status === 'sent' ? 'opened' : row.status });
    hydrateDashboard();
  };
  const escapeHtml = value => String(value).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  const toggleRow = (label, key, prefs) => `<div style="display:flex;align-items:center;gap:10px;padding:7px 0"><span style="flex:1;font-size:13px">${label}</span><button class="chip ${prefs.cats[key] ? 'active' : ''}" onclick="NotificationHub.toggleCat('${key}')">${prefs.cats[key] ? 'ON' : 'OFF'}</button></div>`;
  // ── Compact notifications sheet (owner directive 2026-09-16) ─────────────
  // Small bottom sheet, minimal options, visible close, official concise FCM
  // copy, DUAL LANGUAGE: bn + en written, only the user's active language is
  // rendered (AhI18n), both languages never shown at the same time.
  const SHEET_I18N = {
    title: { bn: 'নোটিফিকেশন', en: 'Notifications' },
    close: { bn: 'বন্ধ করুন', en: 'Close' },
    closeAria: { bn: 'বন্ধ করুন', en: 'Close' },
    pushTitle: { bn: 'Push নোটিফিকেশন', en: 'Push notifications' },
    pushBody: { bn: 'আপনার ফোনে নোটিফিকেশন চালু করুন', en: 'Turn on notifications on your phone' },
    enable: { bn: 'চালু করুন', en: 'Turn on' },
    disable: { bn: 'বন্ধ করুন', en: 'Turn off' },
    on: { bn: 'চালু', en: 'On' },
    off: { bn: 'বন্ধ', en: 'Off' },
    master: { bn: 'সব নোটিফিকেশন', en: 'All notifications' },
    settingUp: { bn: 'নোটিফিকেশন সেটআপ চলছে', en: 'Notification setup in progress' },
    blocked: { bn: 'ব্রাউজারে নোটিফিকেশন বন্ধ আছে, সাইট সেটিংস থেকে চালু করুন', en: 'Notifications are blocked in your browser, enable them in site settings' },
    onDone: { bn: 'Push চালু হয়েছে ✓', en: 'Push turned on ✓' },
    offDone: { bn: 'Push বন্ধ হয়েছে', en: 'Push turned off' },
    needPermission: { bn: 'ব্রাউজারে অনুমতি দিতে হবে', en: 'Browser permission is needed' },
    retry: { bn: 'এবার চলেছে না, আবার চেষ্টা করুন', en: 'Could not enable, please try again' },
    working: { bn: 'চালু হচ্ছে…', en: 'Turning on…' },
    iosInstallBody: { bn: 'iPhone-এ ওয়েব পুশ শুধু Home Screen-এ অ্যাপ যোগ করলেই চলে। করবেন: (১) Safari-র Share (⬆) বাটন → "Add to Home Screen", (২) Home Screen থেকে অ্যাপটি খুলুন, (৩) আবার এখানে এসে Turn on চাপুন।', en: 'On iPhone, web push works only when the app is on your Home Screen. Do this: (1) Safari Share (⬆) → "Add to Home Screen", (2) open the app from your Home Screen, (3) come back and tap Turn on.' },
    iosToast: { bn: 'iPhone: আগে Home Screen-এ যোগ করুন', en: 'iPhone: add to Home Screen first' },
    notSupported: { bn: 'এই ডিভাইসে push supported নয়', en: 'Push is not supported on this device' },
    errConfig: { bn: 'সার্ভার সেটিংস আসছে না, ইন্টারনেট চেক করে আবার চেষ্টা করুন', en: 'Server settings not loading, check internet and retry' },
    errSdk: { bn: 'Push SDK লোড হয়নি, ইন্টারনেট চেক করে আবার চেষ্টা করুন', en: 'Push SDK failed to load, check internet and retry' },
    errToken: { bn: 'Device token তৈরি হয়নি, Home Screen থেকে খোলা থাকলেও আবার চেষ্টা করুন', en: 'Device token failed, open from Home Screen and retry' },
    errRegister: { bn: 'সার্ভারে register ব্যর্থ, আবার চেষ্টা করুন', en: 'Server registration failed, try again' },
    errRate: { bn: 'বেশিবার চেষ্টা হয়েছে, ১ ঘণ্টা পর আবার চেষ্টা করুন', en: 'Too many attempts, please try again in an hour' },
    errLogin: { bn: 'Login session সমস্যা, আবার login করে চেষ্টা করুন', en: 'Login session issue, log in again, then retry' },
    lastErrLabel: { bn: 'সর্বশেষ সমস্যা', en: 'Last error' },
    testPush: { bn: 'টেস্ট push', en: 'Test push' },
    testSent: { bn: 'টেস্ট push পাঠানো হয়েছে ✓', en: 'Test push sent ✓' },
    testRate: { bn: 'বেশিবার পাঠানো হয়েছে, ১ ঘণ্টা পর আবার চেষ্টা করুন', en: 'Too many tests, try again in an hour' },
    testNoDevice: { bn: 'কোনো device নেই, আগে Turn on করুন', en: 'No device registered, turn on push first' },
    testFailed: { bn: 'টেস্ট পাঠানো যায়নি, আবার চেষ্টা করুন', en: 'Test could not be sent, try again' }
  };
  const sheetT = key => {
    let lang = 'bn';
    try { lang = window.AhI18n ? window.AhI18n.get() : 'bn'; } catch (_) {}
    const entry = SHEET_I18N[key];
    return (entry && entry[lang]) || (entry && entry.bn) || key;
  };
  /* Apple's rule (2026): the Push API exists ONLY in a Home-Screen-installed
   * web app on iOS, never in a Safari tab. So 'unsupported' on iOS means
   * "not installed yet", which is fixable, guide the user instead of
   * showing "blocked in settings" (owner confusion 2026-09-17). */
  const isIOS = () => { try { return /iPhone|iPad|iPod/i.test(navigator.userAgent || ''); } catch (_) { return false; } };
  const isStandalone = () => { try { return navigator.standalone === true || matchMedia('(display-mode: standalone)').matches; } catch (_) { return false; } };
  const fcmSheetRow = (s) => {
    const pad = 'padding:14px 0;border-bottom:1px solid var(--line);';
    if (!s.fcmConfigured) {
      return `<div style="${pad}"><div style="font-size:14px;font-weight:700">${sheetT('pushTitle')}</div>
        <div style="font-size:12.5px;opacity:.7;margin-top:6px;line-height:1.5">${sheetT('settingUp')}</div></div>`;
    }
    if (s.permission === 'denied') {
      return `<div style="${pad}"><div style="font-size:14px;font-weight:700">${sheetT('pushTitle')}</div>
        <div style="font-size:12.5px;margin-top:6px;color:var(--red);line-height:1.5">${sheetT('blocked')}</div></div>`;
    }
    if (s.permission === 'unsupported') {
      // iOS Safari tab (not installed): explain the Home Screen requirement.
      if (isIOS()) {
        return `<div style="${pad}"><div style="font-size:14px;font-weight:700">${sheetT('pushTitle')}</div>
          <div style="font-size:12.5px;margin-top:6px;line-height:1.6">${sheetT('iosInstallBody')}</div>
          <button class="btn sm" style="margin-top:12px" data-sheet-fcm-btn onclick="NotificationHub.fcmSheetToggle()">${sheetT('enable')}</button></div>`;
      }
      return `<div style="${pad}"><div style="font-size:14px;font-weight:700">${sheetT('pushTitle')}</div>
        <div style="font-size:12.5px;margin-top:6px;opacity:.7;line-height:1.5">${sheetT('notSupported')}</div></div>`;
    }
    if (s.registered) {
      return `<div style="${pad}display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap">
        <div><div style="font-size:14px;font-weight:700">${sheetT('pushTitle')}</div>
        <div style="font-size:12.5px;margin-top:4px;color:var(--green);font-weight:600">✓ ${sheetT('on')}</div></div>
        <button class="btn ghost sm" style="flex:0 0 auto" data-sheet-fcm-btn onclick="NotificationHub.fcmSheetToggle()">${sheetT('disable')}</button></div>`;
    }
    return `<div style="${pad}"><div style="font-size:14px;font-weight:700">${sheetT('pushTitle')}</div>
      <div style="font-size:13px;margin-top:6px;line-height:1.55">${sheetT('pushBody')}</div>
      <button class="btn sm" style="margin-top:12px" onclick="closeModal();NotificationHub.openAllowDialog()">${sheetT('enable')}</button></div>`;
  };
  const openSheet = async () => {
    const prefs = await getPrefs();
    let fcm = { fcmConfigured: false, registered: false, permission: 'unsupported', devices: 0 };
    try { if (window.AhFcm && typeof window.AhFcm.status === 'function') fcm = await window.AhFcm.status(); } catch (_) {}
    openModal(`<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px">
        <h3 style="margin:0">${sheetT('title')}</h3>
        <button class="iconbtn" style="flex:0 0 auto" onclick="closeModal()" aria-label="${sheetT('closeAria')}">${icon('close', 16)}</button>
      </div>
      ${fcmSheetRow(fcm)}
      <div style="display:flex;align-items:center;justify-content:space-between;padding:14px 0">
        <span style="font-size:14px">${sheetT('master')}</span>
        <button class="chip ${prefs.master ? 'active' : ''}" onclick="NotificationHub.toggleMasterSheet()">${sheetT(prefs.master ? 'on' : 'off')}</button>
      </div>
      <button class="btn" style="width:100%;margin-top:14px" onclick="closeModal()">${sheetT('close')}</button>`);
    try { if (window.AhI18n && window.AhI18n.apply) window.AhI18n.apply(document.getElementById('modalRoot')); } catch (_) {}
  };
  const toggleMasterSheet = async () => {
    const prefs = await getPrefs();
    prefs.master = !prefs.master;
    await savePrefs(prefs);
    await openSheet();
  };
  /* Shared push toggle. Owner bug 2026-09-17: on iOS the prompt never
   * appeared because the permission ask ran AFTER a network await (the
   * tap's transient activation was already spent). Fix: when permission is
   * still 'default', ask FIRST, synchronously at the top of the tap -
   * before any status/config fetch. AhFcm.enable() was fixed the same way. */
  const doPushToggle = async (rerender) => {
    try {
      if (typeof Notification === 'undefined') { toastShort(isIOS() ? sheetT('iosToast') : sheetT('blocked')); return; }
      if (Notification.permission === 'default') {
        const ask = await Notification.requestPermission();
        if (ask !== 'granted') {
          toastShort(ask === 'denied' ? sheetT('blocked') : sheetT('needPermission'));
          if (rerender) rerender();
          return;
        }
      }
      if (!window.AhFcm || !window.AhFcm.enable) { toastShort(sheetT('settingUp')); return; }
      const s = await window.AhFcm.status();
      if (!s.fcmConfigured) { toastShort(sheetT('settingUp')); return; }
      if (s.registered) {
        await window.AhFcm.disable();
        toastShort(sheetT('offDone'));
      } else {
        if (s.permission === 'denied') { toastShort(sheetT('blocked')); return; }
        const r = await window.AhFcm.enable();
        if (r === 'granted') toastShort(sheetT('onDone'));
        else if (r === 'denied' || r === 'unsupported') toastShort(sheetT('needPermission'));
        else if (r === 'config-failed') toastShort(sheetT('errConfig'));
        else if (r === 'sdk-failed') toastShort(sheetT('errSdk'));
        else if (r === 'token-failed') toastShort(sheetT('errToken'));
        else if (r === 'register-429') toastShort(sheetT('errRate') + ' (register-429)');
        else if (r === 'register-401') toastShort(sheetT('errLogin') + ' (register-401)');
        else if (String(r).startsWith('register-')) toastShort(sheetT('errRegister') + ' (' + r + ')');
        else toastShort(sheetT('retry') + ' (' + r + ')');
      }
    } catch (_) { toastShort(sheetT('retry')); }
    if (rerender) rerender();
  };
  const fcmSheetToggle = async () => {
    // Button feedback so the tap visibly does something (owner complaint).
    // NOTE: sync-only checks here, any network await before the permission
    // ask would spend the iOS tap's transient activation again.
    let busy = sheetT('working');
    try {
      const st = window.AhFcm && window.AhFcm._state ? window.AhFcm._state() : null;
      if (st && st.enabled && typeof Notification !== 'undefined' && Notification.permission === 'granted') busy = sheetT('off');
    } catch (_) {}
    try {
      document.querySelectorAll('[data-sheet-fcm-btn]').forEach(b => { b.disabled = true; b.textContent = busy; });
    } catch (_) {}
    await doPushToggle(openSheet);
  };
  /* Self-service test push, no admin token, only the user's own devices
   * (server-side, rate-limited 3/hour). */
  const sendSelfTest = async () => {
    try {
      if (!window.AhFcm || !window.AhFcm.selfTest) { toastShort(sheetT('testFailed')); return; }
      const out = await window.AhFcm.selfTest();
      if (out.ok && out.data && out.data.total > 0) toastShort(`${sheetT('testSent')} (${out.data.sent}/${out.data.total})`);
      else if (out.status === 429) toastShort(sheetT('testRate'));
      else if (out.status === 404) toastShort(sheetT('testNoDevice'));
      else toastShort(sheetT('testFailed'));
    } catch (_) { toastShort(sheetT('testFailed')); }
  };
  /* Inbox push banner toggle, same gesture-safe core, re-renders the inbox. */
  const inboxPushToggle = async () => {
    const reInbox = () => { try { if (typeof window.render === 'function') window.render(); } catch (_) {} };
    await doPushToggle(reInbox);
  };
  /* Dashboard 🔔 bell (owner directive 2026-09-17):
   *  - push registered        → straight to the full-screen inbox
   *  - not registered + prompt never shown → enable sheet ONCE
   *  - afterwards              → straight to the inbox */
  /* ── Premium centered allow dialog (owner directive 2026-09-17, round 8) ──
   * Like the other apps: one centered card, one tap → system prompt →
   * silently done. No test buttons, no device/token/FCM jargon, and no
   * "চালু হয়েছে" celebration, after the user taps Allow they see
   * nothing: the work is simply finished.
   * DUAL LANGUAGE: bn + en written, only the active language is rendered. */
  const ALLOW_I18N = {
    title: { bn: 'নোটিফিকেশন চালু করুন', en: 'Turn on notifications' },
    sub: { bn: 'খবর এলে যেন মিস না হয়', en: 'So you never miss an update' },
    allow: { bn: 'অনুমতি দিই', en: 'Allow' },
    later: { bn: 'এখন না', en: 'Not now' },
    denied: { bn: 'ব্রাউজারে নোটিফিকেশন বন্ধ আছে, Settings → Notifications থেকে চালু করুন', en: 'Notifications are blocked in your browser, enable them in Settings → Notifications' },
    gotIt: { bn: 'বুঝেছি', en: 'Got it' },
    retry: { bn: 'এবার চলেছে না, আবার চেষ্টা করুন', en: 'Could not turn on, please try again' },
    working: { bn: 'চালু হচ্ছে…', en: 'Turning on…' },
    iosHome: { bn: 'iPhone-এ push পেতে: Safari-র Share (⬆) → "Add to Home Screen", তারপর Home Screen থেকে অ্যাপটি খুলুন', en: 'On iPhone, push needs the app on your Home Screen: Safari Share (⬆) → "Add to Home Screen", then open it from there' }
  };
  const allowT = (key) => {
    let l = 'bn';
    try { l = window.AhI18n ? window.AhI18n.get() : 'bn'; } catch (_) {}
    const e = ALLOW_I18N[key];
    return (e && e[l]) || (e && e.bn) || key;
  };
  const openAllowDialog = () => {
    const allowFlow = async () => {
      const btn = document.getElementById('ahAllowBtn');
      const line = (text, color) => {
        const el = document.getElementById('ahAllowLine');
        if (el) { el.textContent = text; el.style.color = color || ''; }
      };
      try {
        if (typeof Notification === 'undefined') { line(allowT('denied'), 'var(--red)'); return; }
        /* Gesture-safe: the permission ask runs FIRST, before any network
         * await, so the iOS tap's transient activation is never spent. */
        if (Notification.permission === 'default') {
          const ask = await Notification.requestPermission();
          if (ask !== 'granted') { line(ask === 'denied' ? allowT('denied') : allowT('retry'), 'var(--red)'); return; }
        } else if (Notification.permission === 'denied') {
          line(allowT('denied'), 'var(--red)'); return;
        } else {
          /* 'unsupported', on iOS that means the app is not on the Home
           * Screen (Apple's Push API rule); on other browsers push is
           * unavailable. Guide, don't mislead. */
          line(isIOS() ? allowT('iosHome') : allowT('retry'), 'var(--red)'); return;
        }
        if (!window.AhFcm || typeof window.AhFcm.enable !== 'function') { line(allowT('retry'), 'var(--red)'); return; }
        if (btn) { btn.disabled = true; btn.textContent = allowT('working'); }
        const r = await window.AhFcm.enable();
        if (r === 'granted') {
          /* Silent success, nothing is shown to the user. The bell now
           * opens the inbox; that is the confirmation. */
          try { closeModal(); } catch (_) {}
          try { hydrateDashboard(); } catch (_) {}
        } else {
          if (btn) { btn.disabled = false; btn.textContent = allowT('allow'); }
          line(r === 'denied' ? allowT('denied') : allowT('retry'), 'var(--red)');
        }
      } catch (_) {
        if (btn) { btn.disabled = false; btn.textContent = allowT('allow'); }
        line(allowT('retry'), 'var(--red)');
      }
    };
    openModal(`<div style="display:flex;flex-direction:column;align-items:center;text-align:center;padding:12px 6px 6px">
      <div style="width:64px;height:64px;border-radius:22px;background:var(--mint,#eef5f1);color:var(--emerald);display:grid;place-items:center">${icon('bell', 30)}</div>
      <h3 style="margin:14px 0 6px;font-size:17px">${allowT('title')}</h3>
      <p style="font-size:13px;color:var(--sub,#64748b);margin:0 0 18px;line-height:1.6">${allowT('sub')}</p>
      <button class="btn" id="ahAllowBtn" style="width:100%;font-weight:800" onclick="window.__ahAllowFlow()">${allowT('allow')}</button>
      <div id="ahAllowLine" style="font-size:12px;min-height:16px;margin-top:10px;line-height:1.5"></div>
      <button class="btn ghost sm" style="margin-top:6px" onclick="closeModal()">${allowT('later')}</button>
    </div>`);
    window.__ahAllowFlow = allowFlow;
    try { if (window.AhI18n && window.AhI18n.apply) window.AhI18n.apply(document.getElementById('modalRoot')); } catch (_) {}
  };

  const goInbox = () => {
    try {
      if (location.hash === '#notifications') { if (typeof window.render === 'function') window.render(); return; }
    } catch (_) {}
    location.hash = 'notifications';
  };
  /* Bell (owner directive 2026-09-17, round 8):
   *  - push registered  → straight to the full-screen inbox
   *  - not registered   → the premium centered allow dialog (one tap)
   * Never an auto-prompt, never the settings sheet. */
  const bellTap = async () => {
    let registered = false;
    try { const s = window.AhFcm ? await window.AhFcm.status() : null; registered = Boolean(s && s.registered); } catch (_) {}
    if (registered) { goInbox(); return; }
    openAllowDialog();
  };
  const markOneRead = async (id) => {
    const rows = await logRows();
    const row = rows.find(r => r.id === id);
    if (row && !row.readAt) await logRow({ ...row, readAt: Date.now(), status: row.status === 'sent' ? 'opened' : row.status });
    hydrateDashboard();
  };
  /* Round 8b (owner 2026-09-17): let the user wipe the inbox list entirely
   * (old auto-generated entries left over from before the engine was
   * switched off). The inbox's "সব মুছে ফেলুন" button calls this. */
  const clearAllLog = async () => {
    try {
      const rows = await logRows();
      for (const row of rows) await dbDelRaw('notifications', row.id);
      return true;
    } catch (_) { return false; }
  };

  const openSettings = async () => {
    const prefs = await getPrefs();
    const soon = Object.entries(CAT_SOON).filter(([, v]) => v).map(([k]) => CAT_LABEL[k]).join(' · ');
    const perm = typeof Notification !== 'undefined' ? Notification.permission : 'unsupported';
    const fcmRow = '<div id="ahFcmRow" style="padding:10px 0;border-bottom:1px solid var(--line);font-size:12px;color:var(--sub)">FCM Push, checking…</div><div id="ahPersonalRow"></div><div id="ahIntelRow"></div>';
    const pushRow = !pushReady() ? '<div style="padding:9px 0;border-bottom:1px solid var(--line);font-size:12px;color:var(--sub)">এই device-এ web push নেই, Telegram-এ notification যাবে</div>'
      : perm === 'granted' ? `<div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--line)"><span style="flex:1;font-size:13px">iPhone push</span><span class="chip active" style="pointer-events:none">চালু</span></div>`
      : perm === 'denied' ? '<div style="padding:9px 0;border-bottom:1px solid var(--line);font-size:12px;color:var(--red)">Push অনুমতি ব্লকড, iOS Settings → Safari/Home-অ্যাপ → Notifications থেকে চালু করো</div>'
      : `<div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--line)"><span style="flex:1;font-size:13px">iPhone push</span><button class="btn sm" onclick="NotificationHub.enablePush().then(() => NotificationHub.openSettings())">চালু করি</button></div>`;
    openModal(`<h3>Notifications</h3>${fcmRow}${pushRow}
      <div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--line)"><span style="flex:1;font-weight:700">Master Notification</span><button class="chip ${prefs.master ? 'active' : ''}" onclick="NotificationHub.toggleMaster()">${prefs.master ? 'ON' : 'OFF'}</button></div>
      ${Object.keys(DEFAULT_PREFS.cats).map(key => toggleRow(CAT_LABEL[key] + (CAT_SOON[key] ? ' <span style="color:var(--sub);font-size:10px">(শীঘ্রই)</span>' : ''), key, prefs)).join('')}
      <label class="flabel" style="margin-top:10px">Quiet hours (এই সময়ে কিছু আসবে না)</label>
      <div style="display:flex;gap:8px;align-items:center"><select onchange="NotificationHub.setQuiet('start',this.value)">${[...Array(24)].map((_, h) => `<option value="${h}" ${prefs.quiet.start === h ? 'selected' : ''}>${String(h).padStart(2, '0')}:00</option>`).join('')}</select><span>→</span><select onchange="NotificationHub.setQuiet('end',this.value)">${[...Array(24)].map((_, h) => `<option value="${h}" ${prefs.quiet.end === h ? 'selected' : ''}>${String(h).padStart(2, '0')}:00</option>`).join('')}</select></div>
      <label class="flabel" style="margin-top:10px">দিনে সর্বোচ্চ notification</label>
      <select onchange="NotificationHub.setCap(this.value)">${[1, 2, 3, 4, 5].map(n => `<option value="${n}" ${prefs.dailyCap === n ? 'selected' : ''}>${n}টি</option>`).join('')}</select>
      ${soon ? `<p class="muted" style="font-size:11px;margin-top:10px">${soon}, verified আসল তথ্য পেলেই চালু হবে; অনুমান-নির্ভর কিছু পাঠানো হবে না।</p>` : ''}
      <div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap">
        ${pushReady() && Notification.permission === 'granted' ? '<button class="btn ghost sm" onclick="NotificationHub.disablePush();closeModal()">Push বন্ধ করো</button>' : ''}
        <button class="btn ghost sm" onclick="closeModal()">Close</button>
      </div>
      <small style="display:block;margin-top:10px;color:var(--sub);font-size:11px;line-height:1.5">Telegram (@myadmihubbot) + iPhone push দুটোতেই যায়। Active থাকলে অ্যাপের ভেতরেই দেখায়, push বিরক্ত করে না।</small>`);
    // FCM row hydrates async (config fetch), replace the placeholder when ready.
    try {
      window.AhFcm?.settingsRow?.().then(html => {
        const el = document.getElementById('ahFcmRow');
        if (el) el.outerHTML = html;
      }).catch(() => {});
      window.AhFcm?.personalRow?.().then(html => {
        const el = document.getElementById('ahPersonalRow');
        if (el) el.outerHTML = html;
      }).catch(() => {});
      window.AhFcm?.intelRow?.().then(html => {
        const el = document.getElementById('ahIntelRow');
        if (el && html) el.outerHTML = html;
      }).catch(() => {});
    } catch (_) {}
  };
  const toggleMaster = async () => { const prefs = await getPrefs(); prefs.master = !prefs.master; await savePrefs(prefs); openSettings(); toastShort(prefs.master ? 'Notification চালু' : 'Notification বন্ধ'); };
  const toggleCat = async key => { const prefs = await getPrefs(); prefs.cats[key] = !prefs.cats[key]; await savePrefs(prefs); openSettings(); };
  const setQuiet = async (part, value) => { const prefs = await getPrefs(); prefs.quiet[part] = Number(value); await savePrefs(prefs); toastShort('Quiet hours সেভ হয়েছে'); };
  const setCap = async value => { const prefs = await getPrefs(); prefs.dailyCap = Number(value); await savePrefs(prefs); toastShort('Cap সেভ হয়েছে'); };
  const testNow = async () => {
    closeModal();
    window.toast?.('টেস্ট পাঠানো হচ্ছে…');
    const okSend = await dispatch({ title: 'Admission Hub টেস্ট', body: 'বাহ! Notification চ্যানেল কাজ করছে, এখন থেকে ঠিক সময়ে আমি মনে করিয়ে দেব', category: 'update' }, { streak: streakNow(), todayQ: todayQuestions() });
    if (okSend === 'ok') await logRow({ id: uid(), category: 'update', title: 'টেস্ট notification', body: 'চ্যানেল যাচাই সম্পন্ন ✓', priority: 1, dedup: 'test-' + Date.now(), status: 'sent', readAt: null, createdAt: Date.now() });
    // BUG-001: the Worker now requires a real proof of identity, so a device
    // without the owner's admin token is refused. Say that plainly instead of
    // reporting a delivery that never happened.
    const msg = okSend === 'off' ? 'Endpoint বন্ধ আছে'
      : okSend === 'forbidden' ? 'এই ব্রাউজারে অ্যাডমিন টোকেন নেই, তাই টেস্ট পাঠানো হয়নি।'
      : 'টেস্ট পাঠানো হয়েছে, Telegram/push দেখো!';
    window.toast?.(msg);
  };
  const toastShort = text => { try { window.toast?.(text); } catch (_) {} };

  // ── boot: dashboard hydration + periodic engine ─────────────────────────────
  const boot = () => {
    /* Phase 2: a background notification click stores {id, link} in Cache
     * Storage (set by firebase-messaging-sw.js, a service worker has no
     * localStorage). Log the click once, then clear it.
     * Phase 3: an intelligence push stores {intelKey} instead, that is the
     * engine's candidate key, and it goes to the outcome route. */
    const logClick = click => {
      if (!click) return;
      if (click.intelKey) {
        fetch('/api/notifications/outcome', {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'clicked', notification_key: String(click.intelKey) })
        }).catch(() => {});
        return;
      }
      if (!click.id) return;
      fetch('/api/notifications/click', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: String(click.id) })
      }).catch(() => {});
    };
    const ahFcmClickKey = new Request('/__ahFcmClick');
    try {
      caches.open('ah-fcm-click').then(c => c.match(ahFcmClickKey)).then(res => {
        if (!res) return;
        return res.json().then(click => {
          logClick(click);
          return caches.open('ah-fcm-click').then(c => c.delete(ahFcmClickKey));
        });
      }).catch(() => {});
    } catch (_) {}
    try {
      const raw = localStorage.getItem('ahFcmClick');
      if (raw) { localStorage.removeItem('ahFcmClick'); logClick(JSON.parse(raw)); }
    } catch (_) {}
    const lazy = fn => () => { if (!window.__ahNotifyNoAuto) fn(); };
    setTimeout(lazy(() => { evaluate(); syncState(); maybeResubscribe(); }), 8000);
    setInterval(lazy(() => { evaluate(); syncState(); }), 15 * 60000);
    document.addEventListener?.('visibilitychange', () => { if (document.visibilityState === 'visible') maybeResubscribe(); });

  };
  if (typeof document !== 'undefined') boot();

  window.NotificationHub = {
    dashboardHtml, hydrateDashboard, mountDashboardCard, openCenter, openSettings, openSheet, openAllowDialog, fcmSheetToggle, toggleMasterSheet, markAllRead, markOneRead, clearAllLog, globalUnreadCount, bellTap, goInbox, inboxPushToggle, sendSelfTest, maybeResubscribe,
    promptEnable, dismissPrompt, enablePush, disablePush, testNow,
    toggleMaster, toggleCat, setQuiet, setCap, saveEndpoint,
    evaluate, syncState,
    _prefs: getPrefs, _state: getState, _log: logRows, _build: buildCandidates,
    _dbg: { streakAtRisk, streakBase, preferredHour, todayQuestions, mistakeCount, inQuietHours }
  };
})();
