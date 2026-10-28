/* ============================================================
   ADMISSION HUB, SESSION STATE PERSIST (v1 · 2026-09-03)
   🎯 অ্যাপ background-এ গিয়ে ফিরলে / PWA reopen-এ একই জায়গায় ফেরা।
   - কোনো auto-reload নেই, কোনো auto-logout নেই
   - route + scroll position ধরে রাখে (একই route-এ থাকলে scroll ফেরত)
   - visible-এ SW update-check শুধু (নতুন ভার্সন পরের launch-এ)
   ============================================================ */
(function () {
  'use strict';
  if (window.AdmissionSession) return;
  var KEY = 'ahSessionState';

  function currentPath() {
    try {
      return String((window.Router && Router.path) || location.hash.replace(/^#\/?/, '').split('?')[0] || 'dashboard');
    } catch (_) { return 'dashboard'; }
  }
  function read() {
    try {
      var raw = sessionStorage.getItem(KEY) || localStorage.getItem(KEY);
      if (!raw) return null;
      var st = JSON.parse(raw);
      return st && typeof st.route === 'string' ? st : null;
    } catch (_) { return null; }
  }
  function save() {
    try {
      var st = { route: currentPath(), scroll: Math.max(0, window.scrollY || 0), at: Date.now() };
      sessionStorage.setItem(KEY, JSON.stringify(st));
    } catch (_) {}
    try { localStorage.setItem(KEY, JSON.stringify({ route: currentPath(), scroll: Math.max(0, window.scrollY || 0), at: Date.now() })); } catch (_) {}
  }
  function restore() {
    try {
      var st = read();
      if (!st) return;
      if (st.route === currentPath() && st.scroll > 0) {
        var target = st.scroll;
        requestAnimationFrame(function () {
          requestAnimationFrame(function () {
            try { window.scrollTo(0, target); } catch (_) {}
          });
        });
      }
    } catch (_) {}
  }

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) save();
    else { save(); restore(); }
  });
  window.addEventListener('pagehide', save);
  window.addEventListener('beforeunload', save);
  window.addEventListener('pageshow', function (e) { if (e.persisted) restore(); });
  window.addEventListener('hashchange', function () { setTimeout(save, 60); });
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(restore, 150); }, { once: true });
  } else {
    setTimeout(restore, 150);
  }
  window.addEventListener('load', function () { setTimeout(restore, 250); });
  // ফোরগ্রাউন্ড-এ প্রতি ১২ সেকেন্ডে fresh, কখনো স্টেল না
  setInterval(function () { if (!document.hidden) save(); }, 12000);

  window.AdmissionSession = { save: save, restore: restore, path: currentPath };
})();
