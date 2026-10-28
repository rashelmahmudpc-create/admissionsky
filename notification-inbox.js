/* v7, Admission Hub ইনবক্স (owner directive 2026-10-16).
 * The old notification-only list (v6) is retired; this is the new Inbox
 * design from the owner's "Inbox UI প্রোটোটাইপ", animated sky-blue hero,
 * search, stat pills and four top tabs: চ্যাট · গ্রুপ · নোটিশ · নোটিফিকেশন.
 *
 * Rules carried over / added:
 *  • NO bottom navigation bar inside the Inbox, neither the app's nav
 *    (#navRoot is emptied + #app.no-nav) nor the prototype's own bottom
 *    nav; the tabs live at the top under the hero.
 *  • Two themes, wired to the app-wide appearance engine (AhAppearance):
 *    dark (default, the prototype's dark palette on the Scholar navy) and
 *    light (the prototype's sky-blue design). The hero toggle switches the
 *    app theme; data-theme-keep stops the unified theme guard repainting.
 *  • Real data only, never fake: notifications = local hub log (IDB) +
 *    server global feed; নোটিশ বোর্ড = server globals of notice kind
 *    (announcement / important / course / new-feature). Chat & groups have
 *    no backend yet, so they show an honest "শীঘ্রই আসছে" state, no
 *    made-up conversations.
 *  • Backend: /api/notifications/inbox (+kind, savedAt), /read, /read-all,
 *    /save. No status bar, no test button, no FCM jargon (round 8).
 *  • Dual language via AhI18n, only the active language is rendered.
 */
(() => {
  'use strict';

  const I18N = {
    title: { bn: 'নোটিফিকেশন', en: 'Notifications' },
    inbox: { bn: 'ইনবক্স', en: 'Inbox' },
    greet: { bn: 'আসসালামু আলাইকুম 👋', en: 'Assalamu Alaikum 👋' },
    back: { bn: 'ফিরে যান', en: 'Back' },
    search: { bn: 'নাম বা মেসেজ খুঁজুন', en: 'Search names or messages' },
    theme: { bn: 'থিম বদলান', en: 'Change theme' },
    tabChat: { bn: 'চ্যাট', en: 'Chats' },
    tabGroups: { bn: 'গ্রুপ', en: 'Groups' },
    tabNotice: { bn: 'নোটিশ', en: 'Notices' },
    tabNotif: { bn: 'নোটিফিকেশন', en: 'Notifications' },
    statUnread: { bn: 'অপঠিত', en: 'Unread' },
    statNotice: { bn: 'নোটিশ', en: 'Notices' },
    statSaved: { bn: 'সেভ করা', en: 'Saved' },
    all: { bn: 'সব', en: 'All' },
    unread: { bn: 'অপঠিত', en: 'Unread' },
    content: { bn: 'কনটেন্ট', en: 'Content' },
    system: { bn: 'সিস্টেম', en: 'System' },
    saved: { bn: 'সেভ করা', en: 'Saved' },
    markAll: { bn: 'সব পড়া চিহ্নিত করুন', en: 'Mark all as read' },
    clearAll: { bn: 'সব মুছে ফেলুন', en: 'Clear all' },
    confirmClear: { bn: 'নিশ্চিত?', en: 'Sure?' },
    emptyAll: { bn: 'এখনো কোনো নোটিফিকেশন নেই', en: 'No notifications yet' },
    emptyAllSub: { bn: 'Study, streak ও admission-এর খবর এখানে আসবে', en: 'Study, streak and admission updates will appear here' },
    emptyUnread: { bn: 'সব পড়া হয়েছে', en: 'You are all caught up' },
    emptyUnreadSub: { bn: 'নতুন কিছু এলে এখানে দেখাবে', en: 'New notifications will appear here' },
    emptyFilter: { bn: 'এই ফিল্টারে কিছু নেই', en: 'Nothing in this filter' },
    emptySearch: { bn: 'কিছু পাওয়া যায়নি। অন্যভাবে খুঁজুন।', en: 'Nothing found. Try another search.' },
    emptyNotice: { bn: 'এখনো কোনো নোটিশ নেই', en: 'No notices yet' },
    emptyNoticeSub: { bn: 'পরীক্ষা, রুটিন ও কোর্সের জরুরি ঘোষণা এখানে আসবে', en: 'Exam, routine and course announcements will appear here' },
    soonChat: { bn: 'চ্যাট শীঘ্রই আসছে', en: 'Chats are coming soon' },
    soonChatSub: { bn: 'বন্ধুদের সাথে সরাসরি চ্যাট করে একসাথে পড়ার সুবিধা তৈরি হচ্ছে', en: 'Direct chat with friends is being built' },
    soonGroups: { bn: 'গ্রুপ ও চ্যানেল শীঘ্রই আসছে', en: 'Groups & channels are coming soon' },
    soonGroupsSub: { bn: 'স্টাডি গ্রুপ ও চ্যানেলে যুক্ত হয়ে একসাথে প্রস্তুতি নিন, খুব শিগগির', en: 'Join study groups and channels, very soon' },
    noticeTag: { bn: 'নোটিশ', en: 'Notice' },
    details: { bn: 'বিস্তারিত দেখুন', en: 'View details' },
    save: { bn: 'সেভ', en: 'Save' },
    savedBtn: { bn: 'সেভড', en: 'Saved' },
    share: { bn: 'শেয়ার', en: 'Share' },
    open: { bn: 'খুলুন', en: 'Open' },
    gotIt: { bn: 'বুঝেছি', en: 'Got it' },
    toastSaved: { bn: 'সেভ করা হয়েছে', en: 'Saved' },
    toastUnsaved: { bn: 'সেভ বাতিল', en: 'Removed from saved' },
    toastShared: { bn: 'শেয়ার লিংক কপি হয়েছে', en: 'Share link copied' },
    toastAllRead: { bn: 'সব পড়া হয়েছে', en: 'All marked as read' },
    toastFail: { bn: 'সংযোগ সমস্যা, আবার চেষ্টা করুন', en: 'Connection problem, try again' },
    yesterday: { bn: 'গতকাল', en: 'Yesterday' },
    earlier: { bn: 'আগে', en: 'Earlier' },
    today: { bn: 'আজ', en: 'Today' }
  };

  const lang = () => { try { return window.AhI18n ? window.AhI18n.get() : 'bn'; } catch (_) { return 'bn'; } };
  const t = (key) => { const e = I18N[key]; return (e && e[lang()]) || (e && e.bn) || key; };

  const CAT_ICON = {
    study: '📚', streak: '🔥', revision: '🔁', mistake: '🧠',
    achievement: '🏆', exam: '📝', admission: '🎓', update: '📢'
  };
  /* "সিস্টেম" chip = app/system updates; everything else is study content. */
  const SYSTEM_CATS = new Set(['update']);

  const esc = (v) => String(v ?? '').replace(/[&<>\"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const safeImg = (u) => (/^https:\/\/[^\s"'<>]+$/i.test(String(u || '')) ? String(u) : '');

  /* Global notification types → inbox category icons (Phase 2). */
  const GLOBAL_ICONS = {
    'new-content': 'study', announcement: 'update', 'new-feature': 'update',
    challenge: 'achievement', course: 'admission', important: 'update'
  };
  /* Mirrors NOTICE_TYPES in fcm-notification.mjs (fallback if `kind` absent). */
  const NOTICE_TYPES = new Set(['announcement', 'important', 'course', 'new-feature']);
  const NOTICE_LABEL = {
    announcement: { bn: 'ঘোষণা', en: 'Announcement' },
    important: { bn: 'জরুরি', en: 'Important' },
    course: { bn: 'কোর্স', en: 'Course' },
    'new-feature': { bn: 'নতুন ফিচার', en: 'New feature' }
  };
  const noticeLabel = (type) => { const e = NOTICE_LABEL[type]; return e ? (e[lang()] || e.bn) : t('noticeTag'); };

  /* Real data only, never fake: local events from the hub log (IDB) +
   * global notifications from the server feed (Phase 2), deduped by id. */
  const localRows = async () => {
    try {
      const hub = window.NotificationHub;
      if (hub && typeof hub._log === 'function') return (await hub._log()) || [];
    } catch (_) {}
    return [];
  };
  const globalRows = async () => {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 6000);
      const res = await fetch('/api/notifications/inbox', { credentials: 'include', signal: controller.signal });
      clearTimeout(timer);
      if (!res.ok) return [];
      const data = await res.json();
      return (data.items || []).map(r => ({
        id: r.id,
        title: r.title,
        body: r.body,
        createdAt: Number(r.sentAt || 0),
        readAt: r.readAt ? Number(r.readAt) : null,
        savedAt: r.savedAt ? Number(r.savedAt) : null,
        category: GLOBAL_ICONS[r.type] || 'update',
        type: r.type || '',
        kind: r.kind || (NOTICE_TYPES.has(r.type) ? 'notice' : 'notification'),
        imageUrl: safeImg(r.imageUrl),
        targetUrl: r.targetUrl || null,
        source: 'global'
      }));
    } catch (_) { return []; }
  };
  const rows = async () => {
    const [local, global] = await Promise.all([localRows(), globalRows()]);
    const seen = new Set(global.map(r => r.id));
    return [...global, ...local.filter(r => !seen.has(r.id))];
  };

  const fmtTime = (ts) => {
    const d = new Date(Number(ts));
    const now = new Date();
    const L = lang() === 'bn' ? 'bn-BD' : 'en-GB';
    const sameDay = d.toDateString() === now.toDateString();
    const y = new Date(now); y.setDate(now.getDate() - 1);
    if (sameDay) return d.toLocaleTimeString(L, { hour: 'numeric', minute: '2-digit' });
    if (d.toDateString() === y.toDateString()) return t('yesterday');
    return d.toLocaleDateString(L, { day: 'numeric', month: 'short' });
  };
  const fmtNum = (n) => { try { return Number(n).toLocaleString(lang() === 'bn' ? 'bn-BD' : 'en-US'); } catch (_) { return String(n); } };

  /* section: chat | groups | notice | notif.  tab: notification chip
   * (all | unread | content | system).  nf: notice chip (all | saved). */
  /* Inbox theme follows the app-wide appearance engine (dark default + light). */
  const readTheme = () => {
    try { if (window.AhAppearance) return window.AhAppearance.resolved() === 'light' ? 'light' : 'dark'; } catch (_) {}
    try { return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark'; } catch (_) { return 'dark'; }
  };
  const state = { section: 'notif', tab: 'all', nf: 'all', q: '', data: [], sheetId: null };

  const dayBucket = (ts, now) => {
    const d = new Date(Number(ts));
    if (Number.isNaN(d.getTime())) return 'earlier';
    if (d.toDateString() === now.toDateString()) return 'today';
    const y = new Date(now); y.setDate(now.getDate() - 1);
    if (d.toDateString() === y.toDateString()) return 'yesterday';
    return 'earlier';
  };
  const groupRows = (list, now = new Date()) => {
    const buckets = { today: [], yesterday: [], earlier: [] };
    for (const row of list) buckets[dayBucket(row.createdAt, now)].push(row);
    return buckets;
  };

  /* ── prototype artwork (SVG, no network) ─────────────────────────────── */
  const ICON = {
    chat: 'M5 4h14a2 2 0 012 2v9a2 2 0 01-2 2H10l-5 4v-4a2 2 0 01-2-2V6a2 2 0 012-2z',
    users: 'M9 11a3.5 3.5 0 100-7 3.5 3.5 0 000 7zM2.5 20c0-3.3 2.9-5.5 6.5-5.5s6.5 2.2 6.5 5.5M16 4.5a3.5 3.5 0 010 6.6M18 14.8c2 .6 3.5 2.2 3.5 5.2',
    mega: 'M3 10v4a1 1 0 001 1h2l7 4V5L6 9H4a1 1 0 00-1 1zM17 8.5a5 5 0 010 7M19.5 6a8.5 8.5 0 010 12',
    bell: 'M6 16v-5a6 6 0 1112 0v5l2 2H4zM10 21h4',
    search: 'M11 18a7 7 0 100-14 7 7 0 000 14zM21 21l-4.5-4.5',
    back: 'M15 5l-7 7 7 7',
    moon: 'M20 13.5A8.5 8.5 0 1110.5 4a7 7 0 009.5 9.5z',
    sun: 'M12 16a4 4 0 100-8 4 4 0 000 8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
    mark: 'M5 4h14v17l-7-4-7 4z',
    share: 'M4 12v7h16v-7M12 15V3M7 8l5-5 5 5',
    trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
    check: 'M4 12l5 5L20 6'
  };
  const ic = (n) => `<svg class="ibx-i" viewBox="0 0 24 24" aria-hidden="true"><path d="${ICON[n]}"/></svg>`;
  const bird = (s = 34) => `<svg width="${s}" height="${s}" viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="38" r="20" fill="#2E8BFF"/><ellipse cx="32" cy="44" rx="12" ry="11" fill="#F4F8FF"/><circle cx="25" cy="34" r="4" fill="#14214F"/><circle cx="39" cy="34" r="4" fill="#14214F"/><circle cx="26" cy="33" r="1.4" fill="#fff"/><circle cx="40" cy="33" r="1.4" fill="#fff"/><path d="M28 40l4 3 4-3z" fill="#FFB020"/><path d="M12 22l20-9 20 9-20 8z" fill="#14214F"/><path d="M32 17l2 4h-4z" fill="#FFB020"/><path d="M50 24v10" stroke="#FFB020" stroke-width="2.5"/></svg>`;
  const PAL = [['#2E8BFF', '#7FD3FF'], ['#7C5CFF', '#9FD0FF'], ['#FF8A3D', '#FFD27A'], ['#14C8A0', '#8FE8FF']];
  const ART_FOR = { course: 0, important: 1, announcement: 2, 'new-feature': 3 };
  const art = (type, uid, big) => {
    const k = ART_FOR[type] ?? 0;
    const [a, b] = PAL[k];
    const g = `ibxg${String(uid).replace(/[^a-z0-9]/gi, '')}${big ? 'b' : ''}`;
    const motif = [
      `<g transform="translate(150 78)"><rect x="-52" y="-4" width="50" height="46" rx="6" fill="#fff"/><rect x="2" y="-4" width="50" height="46" rx="6" fill="#EAF4FF"/><path d="M-40 10h30M-40 20h30M12 10h30M12 20h30" stroke="${a}" stroke-width="3" stroke-linecap="round"/><path d="M-62-12l62-26 62 26-62 24z" fill="#14214F"/><path d="M52-10v22" stroke="#FFB020" stroke-width="3"/><circle cx="52" cy="14" r="4" fill="#FFB020"/></g>`,
      `<g transform="translate(150 80)"><path d="M0-46l14 30 32 4-24 22 7 32-29-17-29 17 7-32-24-22 32-4z" fill="#FFB020"/><circle cx="-90" cy="20" r="6" fill="#fff"/><circle cx="96" cy="-10" r="8" fill="#fff" opacity=".7"/></g>`,
      `<g transform="translate(150 80)"><path d="M-48-6l56-30v76l-56-26z" fill="#fff"/><rect x="-62" y="-8" width="20" height="30" rx="6" fill="#14214F"/><path d="M22-14a22 22 0 010 38M34-28a40 40 0 010 66" stroke="#fff" stroke-width="5" fill="none" stroke-linecap="round"/><circle cx="-30" cy="38" r="9" fill="#FFB020"/></g>`,
      `<g transform="translate(150 78)"><rect x="-56" y="-34" width="112" height="86" rx="14" fill="#fff"/><rect x="-56" y="-34" width="112" height="26" rx="14" fill="#14214F"/><g fill="${a}"><circle cx="-32" cy="8" r="6"/><circle cx="-10" cy="8" r="6"/><circle cx="12" cy="8" r="6"/><circle cx="34" cy="8" r="6"/><circle cx="-32" cy="30" r="6"/><circle cx="-10" cy="30" r="6" fill="#FFB020"/><circle cx="12" cy="30" r="6"/></g></g>`
    ][k];
    return `<svg class="${big ? 'ibx-artbig' : 'ibx-art'}" viewBox="0 0 300 140" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><defs><linearGradient id="${g}" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="300" height="140" fill="url(#${g})"/><circle cx="250" cy="20" r="46" fill="#fff" opacity=".15"/><circle cx="30" cy="130" r="50" fill="#fff" opacity=".12"/>${motif}</svg>`;
  };
  const cover = (row, big) => row.imageUrl
    ? `<img class="${big ? 'ibx-artbig' : 'ibx-art'}" src="${esc(row.imageUrl)}" alt="" loading="lazy" referrerpolicy="no-referrer">`
    : art(row.type, row.id, big);

  /* ── data views ─────────────────────────────────────────────────────── */
  const notices = () => state.data.filter(r => r.source === 'global' && r.kind === 'notice');
  const notifs = () => state.data;
  const matchQ = (r) => {
    const q = state.q.trim().toLowerCase();
    return !q || String(r.title || '').toLowerCase().includes(q) || String(r.body || '').toLowerCase().includes(q);
  };
  const unreadCount = () => notifs().filter(r => !r.readAt).length;

  const empty = (icon, main, sub) => `<div class="ibx-empty">${icon}<b>${esc(main)}</b>${sub ? `<p>${esc(sub)}</p>` : ''}</div>`;

  const renderNotifs = () => {
    const all = notifs();
    const unread = all.filter(r => !r.readAt).length;
    const on = (key) => (state.tab === key ? 'active' : '');
    let h = `<div class="ibx-chips" role="tablist">
      <button class="nif-tab ibx-chip ${on('all')}" onclick="window.__nifTab('all')">${esc(t('all'))}</button>
      <button class="nif-tab ibx-chip ${on('unread')}" onclick="window.__nifTab('unread')">${esc(t('unread'))}${unread ? `<span class="nif-count">${fmtNum(unread)}</span>` : ''}</button>
      <button class="nif-tab ibx-chip ${on('content')}" onclick="window.__nifTab('content')">${esc(t('content'))}</button>
      <button class="nif-tab ibx-chip ${on('system')}" onclick="window.__nifTab('system')">${esc(t('system'))}</button>
    </div>`;
    if (all.length) {
      h += `<div class="ibx-acts">
        ${unread > 0 ? `<button class="ibx-act" onclick="window.__nifMarkAll()">${ic('check')}${esc(t('markAll'))}</button>` : '<span></span>'}
        <button class="ibx-act ibx-clear" id="nifClearBtn" onclick="window.__nifClearAll()" title="${esc(t('clearAll'))}" aria-label="${esc(t('clearAll'))}">${ic('trash')}</button>
      </div>`;
    }
    const list = all.filter(r =>
      (state.tab === 'all') ||
      (state.tab === 'unread' && !r.readAt) ||
      (state.tab === 'content' && !SYSTEM_CATS.has(r.category)) ||
      (state.tab === 'system' && SYSTEM_CATS.has(r.category))
    ).filter(matchQ);
    if (!list.length) {
      if (state.q.trim()) return h + empty(bird(64), t('emptySearch'));
      if (state.tab === 'unread') return h + empty(bird(64), t('emptyUnread'), t('emptyUnreadSub'));
      if (state.tab !== 'all') return h + empty(bird(64), t('emptyFilter'));
      return h + empty(bird(64), t('emptyAll'), t('emptyAllSub'));
    }
    let idx = 0;
    const rowHtml = (row) => {
      const icon = CAT_ICON[row.category] || '🔔';
      const unreadRow = !row.readAt;
      const i = idx++;
      /* Phase 2: a rendered row is a notification seen (deduped by the service). */
      try { window.dispatchEvent(new CustomEvent('admission:activity', { detail: { type: 'NOTIFICATION_OPEN', notificationId: row.id, notificationType: row.source === 'global' ? 'global' : 'local' } })); } catch (_) {}
      return `<button class="ibx-ni ${unreadRow ? 'u nif-unread' : ''}" style="--d:${Math.min(i, 8)}"
        data-nif-id="${esc(row.id)}" data-nif-global="${row.source === 'global' ? '1' : '0'}" data-nif-link="${esc(row.targetUrl || '')}"
        onclick="window.__nifTap(this)">
        <span class="ibx-nic" aria-hidden="true">${icon}</span>
        <span class="ibx-m"><span class="ibx-top"><b>${esc(row.title || '-')}</b><small>${esc(fmtTime(row.createdAt))}</small></span><span class="ibx-p">${esc(row.body || '')}</span></span>
        ${unreadRow ? '<span class="ibx-dot" aria-hidden="true"></span>' : ''}
      </button>`;
    };
    const buckets = groupRows(list.slice(0, 60));
    return h + ['today', 'yesterday', 'earlier']
      .filter(key => buckets[key].length)
      .map(key => `<div class="ibx-sec">${esc(t(key))}</div>` + buckets[key].map(rowHtml).join(''))
      .join('');
  };

  const renderNotices = () => {
    const all = notices();
    const savedN = all.filter(r => r.savedAt).length;
    const chip = (key, label) => `<button class="ibx-chip ${state.nf === key ? 'active' : ''}" onclick="window.__ibxNf('${key}')">${esc(label)}</button>`;
    let h = `<div class="ibx-chips">${chip('all', t('all'))}${chip('saved', t('saved') + (savedN ? ` (${fmtNum(savedN)})` : ''))}</div>`;
    const list = all.filter(r => state.nf === 'all' || r.savedAt).filter(matchQ);
    if (!list.length) {
      if (state.q.trim()) return h + empty(bird(64), t('emptySearch'));
      if (state.nf === 'saved') return h + empty(bird(64), t('emptyFilter'));
      return h + empty(bird(64), t('emptyNotice'), t('emptyNoticeSub'));
    }
    return h + list.map((n, i) => `<button class="ibx-nc ${n.readAt ? '' : 'u'}" style="--d:${Math.min(i, 8)}" data-ibx-id="${esc(n.id)}" onclick="window.__ibxNotice(this)">
      ${cover(n)}
      <span class="ibx-in"><span class="ibx-tag">${esc(noticeLabel(n.type))}</span>${n.savedAt ? `<span class="ibx-pin">${esc(t('saved'))}</span>` : ''}${n.readAt ? '' : '<span class="ibx-new"></span>'}
      <b class="ibx-h3">${esc(n.title || '-')}</b><span class="ibx-p2">${esc(String(n.body || '').slice(0, 90))}${String(n.body || '').length > 90 ? '…' : ''}</span>
      <span class="ibx-ft"><span>${esc(fmtTime(n.createdAt))}</span><span>${esc(t('details'))}</span></span></span>
    </button>`).join('');
  };

  const renderSoon = (kind) => kind === 'chat'
    ? empty(bird(96), t('soonChat'), t('soonChatSub'))
    : empty(bird(96), t('soonGroups'), t('soonGroupsSub'));

  const SECTIONS = [['chat', 'tabChat', 'chat'], ['groups', 'tabGroups', 'users'], ['notice', 'tabNotice', 'mega'], ['notif', 'tabNotif', 'bell']];

  const bodyHtml = () => state.section === 'notif' ? renderNotifs()
    : state.section === 'notice' ? renderNotices()
    : renderSoon(state.section);

  const heroHtml = () => {
    const un = unreadCount();
    const nUnread = notices().filter(r => !r.readAt).length;
    const tabs = SECTIONS.map(([key, label, icon]) => {
      const badge = key === 'notif' ? un : key === 'notice' ? nUnread : 0;
      return `<button class="ibx-tb ${state.section === key ? 'a' : ''}" role="tab" aria-selected="${state.section === key}" onclick="window.__ibxSection('${key}')">${badge && state.section !== key ? `<span class="ibx-bd">${fmtNum(badge)}</span>` : ''}${ic(icon)}<span>${esc(t(label))}</span></button>`;
    }).join('');
    return `<div class="ibx-hd">
      <i class="ibx-sp1">✦</i><i class="ibx-sp2">✦</i><i class="ibx-sp3">✦</i>
      <div class="ibx-hr">
        <button class="ibx-ib nif-back" onclick="window.__nifBack()" aria-label="${esc(t('back'))}">${ic('back')}</button>
        <div class="ibx-logo">${bird(40)}</div>
        <div class="ibx-t"><small>${esc(t('greet'))}</small><h1>${esc(t('inbox'))}</h1></div>
        <button class="ibx-ib" onclick="window.__ibxTheme()" aria-label="${esc(t('theme'))}" title="${esc(t('theme'))}">${ic(readTheme() === 'light' ? 'moon' : 'sun')}</button>
      </div>
      <div class="ibx-stt">
        <button onclick="window.__ibxSection('notif')"><b>${fmtNum(un)}</b><span>${esc(t('statUnread'))}</span></button>
        <button onclick="window.__ibxSection('notice')"><b>${fmtNum(notices().length)}</b><span>${esc(t('statNotice'))}</span></button>
        <button onclick="window.__ibxSection('notice');window.__ibxNf('saved')"><b>${fmtNum(notices().filter(r => r.savedAt).length)}</b><span>${esc(t('statSaved'))}</span></button>
      </div>
      <label class="ibx-sr">${ic('search')}<input id="ibxQ" value="${esc(state.q)}" placeholder="${esc(t('search'))}" aria-label="${esc(t('search'))}" autocomplete="off"></label>
    </div>
    <div class="ibx-tabs" role="tablist" style="--i:${SECTIONS.findIndex(s => s[0] === state.section)}">${tabs}</div>`;
  };

  const styles = () => `<style id="ibx-css">
  /* Theme = the app's unified appearance (AhAppearance): dark is the
   * default, light is the prototype's sky-blue design. */
  .ibx{--p:#2E8BFF;--p2:#5CC8FF;--navy:#EEF2FF;--acc:#FFB020;--bg:#080D29;--sf:rgba(18,26,72,.88);--sol:#121A48;--mut:#93A2D4;--chip:#1A2560;--sh:0 8px 24px rgba(0,0,10,.4);
    --hd:linear-gradient(120deg,#1F6FFF,#2E8BFF,#5CC8FF,#2E8BFF);--hdsh:0 12px 30px rgba(0,0,10,.45);--hdfg:#fff;--glow:radial-gradient(circle at 90% 20%,rgba(92,200,255,.14),transparent 40%);
    position:fixed;top:0;bottom:0;left:0;right:0;z-index:40;overflow:hidden;background:var(--glow),var(--bg);color:var(--navy);font-family:"Hind Siliguri","Noto Sans Bengali",system-ui,sans-serif;display:flex;flex-direction:column;max-width:560px;margin:0 auto;color-scheme:dark;}
  .ibx[data-ibx-theme="light"]{--navy:#14214F;--bg:#E9F4FF;--sf:rgba(255,255,255,.88);--sol:#fff;--mut:#6C7BA8;--chip:#E1EFFF;--sh:0 8px 24px rgba(46,139,255,.14);
    --hdsh:0 12px 30px rgba(46,139,255,.35);--glow:radial-gradient(circle at 90% 20%,rgba(92,200,255,.25),transparent 40%);color-scheme:light}
  .ibx *{box-sizing:border-box;margin:0;-webkit-tap-highlight-color:transparent}
  .ibx button,.ibx input{font:inherit;color:inherit;border:0;background:none}
  .ibx button{cursor:pointer;transition:transform .15s}.ibx button:active{transform:scale(.96)}
  .ibx :focus-visible{outline:2px solid var(--p);outline-offset:2px}
  .ibx h1,.ibx b,.ibx .ibx-sec{font-family:"Baloo Da 2","Hind Siliguri","Noto Sans Bengali",sans-serif}
  .ibx-i{width:22px;height:22px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;flex:none}
  .ibx-hd{position:relative;overflow:hidden;padding:calc(12px + env(safe-area-inset-top,0px)) 16px 14px;background:var(--hd);background-size:300% 300%;animation:ibxG 9s ease infinite;color:var(--hdfg);border-radius:0 0 30px 30px;box-shadow:var(--hdsh);flex:none}
  @keyframes ibxG{50%{background-position:100% 50%}}
  .ibx-hd:before,.ibx-hd:after{content:"";position:absolute;border-radius:50%;background:rgba(255,255,255,.14);animation:ibxF 7s ease-in-out infinite;pointer-events:none}
  .ibx-hd:before{width:170px;height:170px;right:-50px;top:-70px}.ibx-hd:after{width:110px;height:110px;left:30%;bottom:-70px;animation-delay:-3s}
  @keyframes ibxF{50%{transform:translate(-14px,12px) scale(1.1)}}
  .ibx-hd i[class^="ibx-sp"]{position:absolute;font-style:normal;color:#fff;opacity:.6;animation:ibxTw 3s ease-in-out infinite;pointer-events:none}
  .ibx-sp1{right:36%;top:18px;font-size:12px}.ibx-sp2{right:22%;top:52px;font-size:9px;animation-delay:-1s!important}.ibx-sp3{left:52%;top:30px;font-size:14px;animation-delay:-2s!important}
  @keyframes ibxTw{50%{opacity:.15;transform:scale(.7)}}
  .ibx-hr{position:relative;z-index:1;display:flex;align-items:center;gap:10px}
  .ibx-logo{width:46px;height:46px;border-radius:16px;background:#fff;display:grid;place-items:center;box-shadow:0 6px 16px rgba(0,0,0,.18);animation:ibxBob 3s ease-in-out infinite;flex:none}
  @keyframes ibxBob{50%{transform:translateY(-4px) rotate(-4deg)}}
  .ibx-t{flex:1;min-width:0}.ibx-t small{opacity:.85;font-size:12.5px}.ibx-t h1{font-size:25px;font-weight:800;line-height:1.1}
  .ibx-ib{width:40px;height:40px;border-radius:14px;background:rgba(255,255,255,.22);backdrop-filter:blur(8px);display:grid;place-items:center;color:var(--hdfg);flex:none}
  .ibx-stt{position:relative;z-index:1;display:flex;gap:8px;margin-top:12px}
  .ibx-stt button{flex:1;display:grid;justify-items:center;padding:7px 4px;border-radius:15px;background:rgba(255,255,255,.18);backdrop-filter:blur(8px);color:var(--hdfg)}
  .ibx-stt b{font-size:18px;line-height:1.1}.ibx-stt span{font-size:11.5px;opacity:.9}
  .ibx-sr{position:relative;z-index:1;margin-top:12px;background:rgba(255,255,255,.96);border-radius:18px;display:flex;align-items:center;gap:8px;padding:0 14px;height:46px;color:#5E73AE;box-shadow:0 6px 16px rgba(0,0,0,.1)}
  .ibx-sr input{flex:1;height:100%;color:#14214F;outline:none;min-width:0}
  .ibx-tabs{position:relative;display:flex;margin:12px 14px 0;padding:5px;background:var(--sf);backdrop-filter:blur(18px);border-radius:22px;box-shadow:var(--sh);flex:none}
  .ibx-tabs:before{content:"";position:absolute;top:5px;bottom:5px;left:5px;width:calc((100% - 10px)/4);border-radius:17px;background:linear-gradient(135deg,var(--p),var(--p2));box-shadow:0 6px 14px rgba(46,139,255,.4);transform:translateX(calc(var(--i)*100%));transition:transform .4s cubic-bezier(.5,1.5,.5,1)}
  .ibx-tb{flex:1;position:relative;display:grid;justify-items:center;gap:1px;padding:7px 0 5px;color:var(--mut);font-size:11.5px;font-weight:600;transition:color .3s}
  .ibx-tb.a{color:#fff}
  .ibx-bd,.nif-count{min-width:18px;height:18px;border-radius:10px;background:linear-gradient(135deg,#FFB020,#FF8A3D);color:#fff;font:700 10.5px "Baloo Da 2",sans-serif;display:inline-grid;place-items:center;padding:0 5px;box-shadow:0 4px 10px rgba(255,138,61,.4)}
  .ibx-tb .ibx-bd{position:absolute;top:1px;right:calc(50% - 22px)}
  .nif-count{margin-left:5px}
  .ibx-body{flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch;padding:14px 14px calc(28px + env(safe-area-inset-bottom,0px));animation:ibxIn .35s ease}
  @keyframes ibxIn{from{opacity:0;transform:translateY(10px)}}
  .ibx-chips{display:flex;gap:8px;overflow-x:auto;margin-bottom:12px;padding-bottom:2px;scrollbar-width:none}
  .ibx-chip{padding:8px 15px;border-radius:15px;background:var(--sol);color:var(--p);font-weight:600;font-size:14px;white-space:nowrap;box-shadow:0 3px 8px rgba(46,139,255,.1);display:inline-flex;align-items:center}
  .ibx-chip.active{background:linear-gradient(135deg,var(--p),var(--p2));color:#fff}
  .ibx-acts{display:flex;justify-content:space-between;align-items:center;margin:-2px 2px 10px}
  .ibx-act{display:inline-flex;align-items:center;gap:6px;color:var(--p);font-weight:600;font-size:13.5px;padding:6px 8px;border-radius:12px}
  .ibx-act .ibx-i{width:18px;height:18px}
  .ibx-clear{color:var(--mut)}.ibx-clear.nif-clear-armed{background:#DC2626;color:#fff;font-weight:700;font-size:12.5px;padding:6px 12px}
  .ibx-sec{font-weight:700;font-size:14px;color:var(--mut);margin:6px 4px 9px}
  .ibx-ni{display:flex;gap:12px;align-items:center;padding:13px;border-radius:22px;background:var(--sf);margin-bottom:10px;width:100%;text-align:left;box-shadow:var(--sh);animation:ibxIn .4s both;animation-delay:calc(var(--d,0)*55ms)}
  .ibx-ni.u{box-shadow:inset 4px 0 0 var(--p),var(--sh)}
  .ibx-nic{width:46px;height:46px;border-radius:16px;background:var(--chip);display:grid;place-items:center;font-size:22px;flex:none}
  .ibx-m{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
  .ibx-top{display:flex;justify-content:space-between;align-items:baseline;gap:8px}
  .ibx-top b{font-size:16px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .ibx-top small{font-size:11.5px;color:var(--mut);flex:none}
  .ibx-p{font-size:13.5px;color:var(--mut);line-height:1.45;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
  .ibx-dot{width:10px;height:10px;border-radius:50%;background:var(--p);box-shadow:0 0 0 4px rgba(46,139,255,.2);flex:none}
  .ibx-nc{background:var(--sol);border-radius:26px;margin-bottom:16px;overflow:hidden;box-shadow:var(--sh);width:100%;text-align:left;display:block;animation:ibxIn .45s both;animation-delay:calc(var(--d,0)*80ms)}
  .ibx-art{height:140px;display:block;width:100%;object-fit:cover}
  .ibx-artbig{height:180px;display:block;width:100%;object-fit:cover;border-radius:24px 24px 0 0}
  .ibx-in{display:block;padding:13px 16px 16px;position:relative}
  .ibx-h3{display:block;font-size:18px;font-weight:700;margin:6px 0 2px;line-height:1.25}
  .ibx-p2{display:block;font-size:14px;color:var(--mut);line-height:1.5}
  .ibx-ft{display:flex;justify-content:space-between;align-items:center;margin-top:10px;font-size:12.5px;color:var(--mut)}
  .ibx-ft span:last-child{color:var(--p);font-weight:600}
  .ibx-tag{font-size:11px;padding:2px 9px;border-radius:9px;background:var(--chip);color:var(--p);font-weight:600;margin-right:6px}
  .ibx-pin{display:inline-block;background:linear-gradient(135deg,#FFB020,#FF8A3D);color:#fff;font-size:11px;font-weight:600;padding:2px 9px;border-radius:9px}
  .ibx-new{position:absolute;right:16px;top:17px;width:10px;height:10px;border-radius:50%;background:var(--p);box-shadow:0 0 0 4px rgba(46,139,255,.2)}
  .ibx-empty{display:grid;justify-items:center;text-align:center;gap:6px;padding:48px 24px;color:var(--mut)}
  .ibx-empty b{font-size:18px;color:var(--navy);margin-top:6px}.ibx-empty p{font-size:13.5px;line-height:1.6;max-width:32ch}
  .ibx-bk{position:absolute;inset:0;background:rgba(10,18,48,.45);opacity:0;pointer-events:none;transition:opacity .3s;z-index:5}
  .ibx-bk.o{opacity:1;pointer-events:auto}
  .ibx-sh{position:absolute;left:0;right:0;bottom:0;max-height:88%;overflow-y:auto;background:var(--sol);border-radius:28px 28px 0 0;transform:translateY(105%);transition:transform .35s cubic-bezier(.3,.9,.3,1);z-index:6;padding-bottom:env(safe-area-inset-bottom,0px)}
  .ibx-sh.o{transform:none}
  .ibx-gr{width:44px;height:5px;border-radius:3px;background:var(--chip);margin:8px auto 0;position:absolute;left:0;right:0;top:0;z-index:1}
  .ibx-spd{padding:16px 18px 20px}.ibx-spd h2{font-size:21px;margin:8px 0 2px;font-family:"Baloo Da 2","Hind Siliguri",sans-serif}
  .ibx-spd small{color:var(--mut)}.ibx-spd p{margin:10px 0;line-height:1.7;white-space:pre-line}
  .ibx-ad{display:flex;gap:8px;margin:12px 0}
  .ibx-ad button{flex:1;display:flex;align-items:center;justify-content:center;gap:6px;padding:10px;border-radius:15px;background:var(--chip);color:var(--p);font-weight:600}
  .ibx-ad button.a{background:linear-gradient(135deg,var(--p),var(--p2));color:#fff}
  .ibx-cta{width:100%;height:50px;border-radius:17px;background:linear-gradient(135deg,var(--p),var(--p2));color:#fff!important;font-weight:700;font-size:16px;box-shadow:0 10px 22px rgba(46,139,255,.35)}
  .ibx-toast{position:absolute;left:50%;bottom:calc(28px + env(safe-area-inset-bottom,0px));transform:translate(-50%,30px);opacity:0;background:var(--navy);color:var(--bg);padding:10px 18px;border-radius:16px;font-size:14px;font-weight:600;transition:.3s;z-index:9;pointer-events:none;white-space:nowrap}
  .ibx-toast.o{opacity:1;transform:translate(-50%,0)}
  @media (prefers-reduced-motion:reduce){.ibx *,.ibx-hd{animation:none!important;transition:none!important}}
  </style>`;

  const sheetHtml = (n) => `<div class="ibx-gr"></div>${cover(n, true)}<div class="ibx-spd">
    <span class="ibx-tag">${esc(noticeLabel(n.type))}</span>${n.savedAt ? `<span class="ibx-pin">${esc(t('saved'))}</span>` : ''}
    <h2>${esc(n.title || '-')}</h2><small>${esc(fmtTime(n.createdAt))}</small>
    <p>${esc(n.body || '')}</p>
    <div class="ibx-ad">
      <button class="${n.savedAt ? 'a' : ''}" onclick="window.__ibxSave()">${ic('mark')}${esc(n.savedAt ? t('savedBtn') : t('save'))}</button>
      <button onclick="window.__ibxShare()">${ic('share')}${esc(t('share'))}</button>
      ${n.targetUrl ? `<button onclick="window.__ibxOpenLink()">${esc(t('open'))}</button>` : ''}
    </div>
    <button class="ibx-cta" onclick="window.__ibxCloseSheet()">${esc(t('gotIt'))}</button>
  </div>`;

  const root = () => document.getElementById('ibxRoot');
  const paintBody = () => {
    const r = root(); if (!r) return;
    const body = r.querySelector('.ibx-body');
    if (body) body.innerHTML = bodyHtml();
  };
  const paint = () => {
    const app = document.getElementById('app');
    if (!app) return;
    app.classList.add('no-nav');
    const focusQ = document.activeElement && document.activeElement.id === 'ibxQ';
    const scroll = root()?.querySelector('.ibx-body')?.scrollTop || 0;
    app.innerHTML = styles() + `<div class="page" data-admission-component="route-notifications">
      <div class="ibx nif-root" id="ibxRoot" data-ibx-theme="${readTheme()}" data-theme-keep lang="${lang()}">
        ${heroHtml()}
        <div class="ibx-body">${bodyHtml()}</div>
        <div class="ibx-bk" id="ibxBk" onclick="window.__ibxCloseSheet()"></div>
        <div class="ibx-sh" id="ibxSh" role="dialog" aria-modal="true"></div>
        <div class="ibx-toast" id="ibxToast" role="status" aria-live="polite"></div>
      </div></div>`;
    const navRoot = document.getElementById('navRoot');
    if (navRoot) navRoot.innerHTML = '';
    const q = document.getElementById('ibxQ');
    if (q) {
      q.addEventListener('input', () => { state.q = q.value; paintBody(); });
      if (focusQ) { q.focus(); try { q.setSelectionRange(q.value.length, q.value.length); } catch (_) {} }
    }
    const body = root()?.querySelector('.ibx-body');
    if (body) body.scrollTop = scroll;
  };

  const render = async () => {
    state.data = (await rows()).sort((a, b) => Number(b.createdAt) - Number(a.createdAt));
    paint();
    window.scrollTo(0, 0);
  };

  const reRender = () => render().catch(() => {});

  let toastTimer = 0;
  const toast = (msg) => {
    const el = document.getElementById('ibxToast'); if (!el) return;
    el.textContent = msg; el.classList.add('o');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('o'), 1900);
  };
  const post = (url, body) => fetch(url, {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {})
  });

  /* Back (owner bug 2026-09-17: tapping back did not leave the inbox).
   * Prefer the app's own navigate() (hash + render + resume plumbing);
   * if the route is still stuck after 450ms, force the hash change. */
  window.__nifBack = () => {
    const force = () => {
      try {
        if (location.hash && location.hash.replace(/^#\/?/, '') !== 'dashboard') {
          location.hash = 'dashboard';
        } else if (typeof window.render === 'function') {
          window.render();
        }
      } catch (_) {}
    };
    try {
      if (typeof window.navigate === 'function') window.navigate('dashboard');
      else location.hash = 'dashboard';
    } catch (_) { location.hash = 'dashboard'; }
    window.setTimeout(force, 450);
  };

  window.__ibxSection = (key) => {
    state.section = ['chat', 'groups', 'notice', 'notif'].includes(key) ? key : 'notif';
    paint();
  };
  window.__ibxNf = (key) => { state.nf = key === 'saved' ? 'saved' : 'all'; paint(); };
  window.__ibxTheme = () => {
    const next = readTheme() === 'light' ? 'dark' : 'light';
    try {
      if (window.AhAppearance) window.AhAppearance.set(next);
      else document.documentElement.setAttribute('data-theme', next);
    } catch (_) {}
    const r = root(); if (r) r.setAttribute('data-ibx-theme', readTheme());
    paint();
  };
  /* Theme changed elsewhere (profile → appearance) while the inbox is open. */
  window.addEventListener('ah:appearance', () => { const r = root(); if (r) { r.setAttribute('data-ibx-theme', readTheme()); paint(); } });
  window.__nifTab = (tab) => { state.tab = ['all', 'unread', 'content', 'system'].includes(tab) ? tab : 'all'; paint(); };
  window.__nifTap = (el) => {
    const id = el.dataset.nifId;
    const isGlobal = el.dataset.nifGlobal === '1';
    const targetUrl = el.dataset.nifLink || '';
    /* Phase 2: an opened notification is an engagement signal. */
    try { window.dispatchEvent(new CustomEvent('admission:activity', { detail: { type: 'NOTIFICATION_CLICK', notificationId: id, notificationType: isGlobal ? 'global' : 'local', linkRoute: targetUrl || undefined } })); } catch (_) {}
    (async () => {
      try {
        if (isGlobal) {
          await fetch('/api/notifications/read', {
            method: 'POST', credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id })
          });
        } else {
          const hub = window.NotificationHub;
          if (hub && typeof hub.markOneRead === 'function') await hub.markOneRead(id);
        }
      } catch (_) {}
      if (isGlobal && targetUrl) {
        try { location.hash = targetUrl.replace(/^#?\/?/, ''); } catch (_) {}
        return;
      }
      reRender();
    })();
  };
  /* Mark all: local hub log AND the server-side global feed (v7 fix -
   * previously globals came straight back as unread). */
  window.__nifMarkAll = () => {
    (async () => {
      try { const hub = window.NotificationHub; if (hub && typeof hub.markAllRead === 'function') await hub.markAllRead(); } catch (_) {}
      try { await post('/api/notifications/read-all', {}); } catch (_) {}
      await reRender();
      toast(t('toastAllRead'));
    })();
  };
  /* Clear all (two-tap confirm, first tap arms the button for 3s). */
  let clearArmedAt = 0;
  window.__nifClearAll = () => {
    const btn = document.getElementById('nifClearBtn');
    if (!btn) return;
    if (Date.now() - clearArmedAt < 3000) {
      clearArmedAt = 0;
      btn.classList.remove('nif-clear-armed');
      (async () => {
        try { const hub = window.NotificationHub; if (hub && typeof hub.clearAllLog === 'function') await hub.clearAllLog(); } catch (_) {}
        reRender();
      })();
    } else {
      clearArmedAt = Date.now();
      btn.textContent = t('confirmClear');
      btn.classList.add('nif-clear-armed');
      window.setTimeout(() => {
        const b = document.getElementById('nifClearBtn');
        if (!b) return;
        b.innerHTML = ic('trash');
        b.classList.remove('nif-clear-armed');
        if (Date.now() - clearArmedAt >= 3000) clearArmedAt = 0;
      }, 3000);
    }
  };

  /* ── notice board sheet ─────────────────────────────────────────────── */
  const current = () => state.data.find(r => r.id === state.sheetId);
  const openSheet = () => {
    const n = current(); const sh = document.getElementById('ibxSh'); const bk = document.getElementById('ibxBk');
    if (!n || !sh || !bk) return;
    sh.innerHTML = sheetHtml(n);
    sh.classList.add('o'); bk.classList.add('o');
  };
  window.__ibxNotice = (el) => {
    const id = el.dataset.ibxId;
    const n = state.data.find(r => r.id === id);
    if (!n) return;
    state.sheetId = id;
    try { window.dispatchEvent(new CustomEvent('admission:activity', { detail: { type: 'NOTIFICATION_CLICK', notificationId: id, notificationType: 'global' } })); } catch (_) {}
    if (!n.readAt) {
      n.readAt = Date.now();
      post('/api/notifications/read', { id }).catch(() => {});
    }
    openSheet();
  };
  window.__ibxCloseSheet = () => {
    const sh = document.getElementById('ibxSh'); const bk = document.getElementById('ibxBk');
    if (sh) sh.classList.remove('o'); if (bk) bk.classList.remove('o');
    state.sheetId = null;
    setTimeout(() => { if (!state.sheetId) paint(); }, 320);
  };
  window.__ibxSave = () => {
    const n = current(); if (!n) return;
    const next = !n.savedAt;
    const prev = n.savedAt;
    n.savedAt = next ? Date.now() : null;
    openSheet();
    toast(next ? t('toastSaved') : t('toastUnsaved'));
    post('/api/notifications/save', { id: n.id, saved: next })
      .then(res => { if (!res.ok) throw new Error('save'); })
      .catch(() => { n.savedAt = prev; if (state.sheetId === n.id) openSheet(); toast(t('toastFail')); });
  };
  window.__ibxShare = () => {
    const n = current(); if (!n) return;
    const url = location.origin + '/#' + String(n.targetUrl || 'notifications').replace(/^#?\/?/, '');
    const text = `${n.title || ''}\n${n.body || ''}`.trim();
    try {
      if (navigator.share) { navigator.share({ title: n.title || '', text, url }).catch(() => {}); return; }
    } catch (_) {}
    try { navigator.clipboard.writeText(`${text}\n${url}`).then(() => toast(t('toastShared'))).catch(() => {}); } catch (_) {}
  };
  window.__ibxOpenLink = () => {
    const n = current(); if (!n || !n.targetUrl) return;
    try { location.hash = n.targetUrl.replace(/^#?\/?/, ''); } catch (_) {}
  };

  window.renderNotificationsInbox = function renderNotificationsInbox() {
    render().catch(() => {});
  };
})();
