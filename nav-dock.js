/* ============================================================
   NAV DOCK, the Dashboard's bottom navigation, everywhere (owner 2026-10-17)
   The Dashboard (dashboard-v2.js frame) has the floating 5-slot dock:
   Home · Bank · AI orb · Exam · Profile. Every other screen that shows a
   bottom bar still drew the old flat 4-tab bar. This file replaces
   window.bottomNavHtml so those screens draw the SAME dock (same markup,
   sizes, colours, icons and motion as the Dashboard frame).
   • Screens that hide the bar (hideNav) stay hidden, nothing is added there.
   • Taps go through the same routes the Dashboard dock uses.
   • Theme follows the app (html[data-theme="dark"] = dark dock).
   ============================================================ */
(function () {
  'use strict';
  if (window.__ahNavDockInstalled) return;
  window.__ahNavDockInstalled = true;

  var CSS = [
    '#navRoot{overflow:visible!important}',
    /* The old bar rules (index.html / phase12 / dashboard-v2.css) all target
       .bottomnav with !important; this wrapper neutralises them so only the dock shows. */
    'html body #navRoot .bottomnav.ahd-host{position:fixed!important;left:0!important;right:0!important;top:auto!important;bottom:0!important;width:100%!important;max-width:none!important;height:calc(74px + var(--safe-b,0px))!important;margin:0!important;padding:0!important;transform:none!important;border:0!important;border-radius:0!important;background:transparent!important;box-shadow:none!important;opacity:1!important;display:block!important;overflow:visible!important;pointer-events:none!important;backdrop-filter:none!important;-webkit-backdrop-filter:none!important}',
    'html body #navRoot .bottomnav.ahd-host:hover{transform:none!important}',
    /* AI chat is full screen (owner 2026-10-17): no dock there. ai-agent-chat.js hides .bottomnav with an inline style, which the !important rule above would beat. */
    'html.ai-chat-open body #navRoot .bottomnav.ahd-host{display:none!important}',
    'html:not(.ai-chat-open) body #app:not(.no-nav){padding-bottom:calc(112px + var(--safe-b,0px))!important}',
    /* sticky action rows that sat on top of the old 74px bar: lift them above the dock + orb */
    'body.ahd-on .setup-footer,body.ahd-on #app [style*="bottom:calc(74px"]{bottom:calc(112px + var(--safe-b,0px))!important}',
    /* Profile V2 frame ends above the dock + orb. Set the HEIGHT, not bottom:
       an iframe is a replaced element, so a bottom offset without an explicit
       height is ignored and the frame collapses to its intrinsic 150px. */
    'body.ahd-on iframe.pv2-frame{height:calc(100dvh - 112px - var(--safe-b,0px))!important}',
    '.ahd-host{--ahd-bg:#F4F6FD;--ahd-line:rgba(30,42,94,.08);--ahd-fg:#111B4B;--ahd-fg3:#8B94BC;--ahd-violet:#7A5AF0;--ahd-tint2:rgba(59,111,232,.15);--ahd-nav:rgba(255,255,255,.92);font-family:\'Noto Sans Bengali\',\'Hind Siliguri\',\'Inter\',system-ui,-apple-system,\'Segoe UI\',sans-serif;line-height:1.5;-webkit-font-smoothing:antialiased}',
    'html[data-theme="dark"] .ahd-host{--ahd-bg:#080D29;--ahd-line:rgba(150,175,255,.13);--ahd-fg:#EEF2FF;--ahd-fg3:#7E8BC6;--ahd-violet:#A58BFF;--ahd-tint2:rgba(108,149,255,.2);--ahd-nav:rgba(18,26,72,.92)}',
    '.ahd-nav{position:absolute;left:50%;transform:translateX(-50%);bottom:calc(14px + env(safe-area-inset-bottom,0px));width:min(440px,calc(100% - 32px));z-index:50;box-sizing:border-box;display:grid;grid-template-columns:repeat(5,1fr);align-items:center;height:70px;border-radius:30px;background:var(--ahd-nav);border:1px solid var(--ahd-line);box-shadow:0 18px 40px rgba(16,26,90,.24);backdrop-filter:blur(24px) saturate(1.6);-webkit-backdrop-filter:blur(24px) saturate(1.6);pointer-events:auto}',
    '.ahd-nav button{font:inherit;color:inherit;border:0;background:none;cursor:pointer;padding:0;margin:0;touch-action:manipulation;-webkit-tap-highlight-color:transparent;min-width:0}',
    '.ahd-pill{position:absolute;left:0;top:8px;bottom:8px;width:20%;transition:transform .5s cubic-bezier(.34,1.45,.64,1),opacity .2s;pointer-events:none}',
    '.ahd-pill::before{content:"";position:absolute;inset:0 5px;border-radius:21px;background:var(--ahd-tint2)}',
    '.ahd-pill.ahd-none{opacity:0}',
    '.ahd-tab{height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;font-size:11px!important;font-weight:700;color:var(--ahd-fg3)!important;transition:color .25s;position:relative}',
    '.ahd-tab .ti{position:relative;width:28px;height:28px;display:block}',
    '.ahd-tab .ti>*{position:absolute;inset:0;transition:opacity .3s,transform .45s cubic-bezier(.34,1.56,.64,1)}',
    '.ahd-tab .ti .ico{width:28px;height:28px}',
    '.ahd-tab .ti .onI{opacity:0;transform:scale(.5) translateY(6px)}',
    '.ahd-tab.on{color:var(--ahd-fg)!important}',
    '.ahd-tab.on .ti .off{opacity:0;transform:scale(.5)}',
    '.ahd-tab.on .ti .onI{opacity:1;transform:scale(1.08) translateY(-1px)}',
    '.ahd-tab.pop .ti .onI{animation:ahdPop .6s cubic-bezier(.34,1.56,.64,1)}',
    '.ahd-host .ico{flex:none;overflow:visible}',
    '.ahd-host .ico .a{fill:currentColor;opacity:.22;stroke:none}',
    '.ahd-host .ico .b{fill:none;stroke:currentColor;stroke-width:1.9;stroke-linecap:round;stroke-linejoin:round}',
    '.ahd-host .ico .c{fill:currentColor;stroke:none}',
    '.ahd-host .ill{width:100%;height:100%;display:block;overflow:visible}',
    '.ahd-slot{position:relative;height:100%}',
    '.ahd-ai{position:absolute!important;left:50%;top:-26px;transform:translateX(-50%);width:66px;height:66px;border-radius:50%;box-shadow:0 0 0 5px var(--ahd-bg),0 14px 28px rgba(108,76,234,.5);transition:transform .3s cubic-bezier(.34,1.56,.64,1)}',
    '.ahd-ai .orbring{position:absolute;inset:-3px;border-radius:50%;background:conic-gradient(from 0deg,#6C95FF,#B07BFF,#FF7CC8,#FFC857,#6C95FF);animation:ahdSpin 4s linear infinite}',
    '.ahd-ai .core{position:absolute;inset:2.5px;border-radius:50%;background:radial-gradient(circle at 30% 22%,#8FAEFF 0%,#4B5FE6 45%,#2A2E9E 100%);box-shadow:inset 0 3px 8px rgba(255,255,255,.45),inset 0 -6px 10px rgba(20,10,90,.4)}',
    '.ahd-ai .core::after{content:"";position:absolute;left:14%;top:8%;width:52%;height:30%;border-radius:50%;background:linear-gradient(rgba(255,255,255,.5),transparent)}',
    '.ahd-ai svg{position:absolute;inset:0;margin:auto;width:38px;height:38px;z-index:2;overflow:visible}',
    '.ahd-ai .sp1{transform-origin:center;transform-box:fill-box;animation:ahdTw 2.2s ease-in-out infinite}',
    '.ahd-ai .sp2{transform-origin:center;transform-box:fill-box;animation:ahdTw 2.2s ease-in-out infinite .7s}',
    '.ahd-ai .sp3{transform-origin:center;transform-box:fill-box;animation:ahdTw 2.2s ease-in-out infinite 1.4s}',
    '.ahd-ai::before{content:"";position:absolute;inset:-9px;border-radius:50%;border:2px solid rgba(124,92,240,.4);animation:ahdPing 3s ease-out infinite;pointer-events:none}',
    '.ahd-ai:active{transform:translateX(-50%) scale(.9)}',
    '.ahd-ailabel{position:absolute;left:0;right:0;bottom:8px;text-align:center;font-size:11px;font-weight:800;color:var(--ahd-violet);letter-spacing:.04em;pointer-events:none}',
    '@keyframes ahdPing{0%{transform:scale(.9);opacity:.9}100%{transform:scale(1.55);opacity:0}}',
    '@keyframes ahdPop{0%{transform:scale(.6) translateY(4px)}60%{transform:scale(1.3) translateY(-5px)}100%{transform:scale(1.08) translateY(-1px)}}',
    '@keyframes ahdTw{0%,100%{transform:scale(.6);opacity:.4}50%{transform:scale(1.25);opacity:1}}',
    '@keyframes ahdSpin{to{transform:rotate(360deg)}}',
    '@media (prefers-reduced-motion: reduce){.ahd-host *,.ahd-host *::before,.ahd-host *::after{animation-duration:.01ms!important;animation-iteration-count:1!important;transition-duration:.01ms!important}}'
  ].join('\n');

  function injectStyle() {
    if (document.getElementById('ah-nav-dock-style')) return;
    var s = document.createElement('style');
    s.id = 'ah-nav-dock-style';
    s.textContent = CSS;
    (document.head || document.documentElement).appendChild(s);
  }
  injectStyle();

  /* Icons: the exact outline (inactive) + illustrated (active) art of the Dashboard dock. */
  var HOME = 'M4 11 12 4l8 7v8.2a1.3 1.3 0 0 1-1.3 1.3H5.3A1.3 1.3 0 0 1 4 19.2z';
  var IC = {
    home: '<path class="a" d="' + HOME + '"/><path class="b" d="' + HOME + '"/><path class="b" d="M10 20.5v-5h4v5"/>',
    library: '<rect class="a" x="3.5" y="4" width="5" height="16" rx="1.4"/><rect class="b" x="3.5" y="4" width="5" height="16" rx="1.4"/><rect class="a" x="9.5" y="4" width="5" height="16" rx="1.4"/><rect class="b" x="9.5" y="4" width="5" height="16" rx="1.4"/><rect class="a" x="15.5" y="4" width="5" height="16" rx="1.4"/><rect class="b" x="15.5" y="4" width="5" height="16" rx="1.4"/>',
    exam: '<rect class="a" x="5" y="4.5" width="14" height="17" rx="3"/><rect class="b" x="5" y="4.5" width="14" height="17" rx="3"/><rect class="b" x="9" y="2.5" width="6" height="4" rx="1.5"/><path class="b" d="M8.8 13l2.2 2.2 4.2-4.6"/><path class="b" d="M9 18.5h6"/>',
    user: '<circle class="a" cx="12" cy="8" r="3.9"/><circle class="b" cx="12" cy="8" r="3.9"/><path class="a" d="M4.5 20.5c.6-4 3.7-6 7.5-6s6.9 2 7.5 6z"/><path class="b" d="M4.5 20.5c.6-4 3.7-6 7.5-6s6.9 2 7.5 6"/>'
  };
  var ILL = {
    home: '<path d="M9 22 24 9l15 13v17a3 3 0 0 1-3 3H12a3 3 0 0 1-3-3z" fill="#5B8CFF"/><path d="M3.5 24.5 24 6l20.5 18.5-3.3 3.6L24 12.4 6.8 28.1z" fill="#F0485B"/><rect x="20" y="29" width="8" height="13" rx="2" fill="#fff"/><rect x="32" y="9" width="5" height="9" rx="1.5" fill="#C93346"/>',
    bank: '<rect x="5" y="8" width="11" height="35" rx="3" fill="#3F6FF0"/><rect x="5" y="14" width="11" height="3" fill="#fff" opacity=".7"/><rect x="18" y="5" width="11" height="38" rx="3" fill="#F5A623"/><rect x="18" y="12" width="11" height="3" fill="#fff" opacity=".7"/><path d="M31.5 11.5l9.5-2.6 6 31.6-9.5 2.6z" fill="#7C5CF0"/>',
    mock: '<rect x="9" y="8" width="30" height="36" rx="6" fill="#3F6FF0"/><rect x="13" y="13" width="22" height="27" rx="3" fill="#fff"/><rect x="17" y="4" width="14" height="8" rx="3" fill="#1E2A5E"/><rect x="17" y="19" width="14" height="3" rx="1.5" fill="#C7D3F5"/><rect x="17" y="26" width="9" height="3" rx="1.5" fill="#C7D3F5"/><circle cx="33" cy="35" r="8" fill="#22C07A" stroke="#fff" stroke-width="2"/><path d="M29.4 35l2.6 2.6 4.8-5.2" stroke="#fff" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
    profile: '<path d="M7 43c1.4-9.5 8-14 17-14s15.6 4.5 17 14z" fill="#3F6FF0"/><circle cx="24" cy="19" r="9.5" fill="#FFC9A3"/><path d="M12 14 24 8l12 6-12 6z" fill="#1E2A5E"/><path d="M36 15v8" stroke="#F5B03E" stroke-width="2.4" stroke-linecap="round"/><circle cx="36" cy="25" r="2.4" fill="#F5B03E"/>'
  };
  var ico = function (n) { return '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true">' + IC[n] + '</svg>'; };
  var ill = function (n) { return '<svg class="ill" viewBox="0 0 48 48" aria-hidden="true">' + ILL[n] + '</svg>'; };

  /* slot index → same order as the Dashboard dock (2 = AI orb in the middle) */
  var TABS = [
    { i: 0, key: 'dashboard', label: 'Home', off: 'home', on: 'home' },
    { i: 1, key: 'question-bank', label: 'Bank', off: 'library', on: 'bank' },
    { i: 3, key: 'exam', label: 'Exam', off: 'exam', on: 'mock' },
    { i: 4, key: 'my-profile', label: 'Profile', off: 'user', on: 'profile' }
  ];
  var indexFor = function (key) {
    for (var k = 0; k < TABS.length; k++) if (TABS[k].key === key) return TABS[k].i;
    return -1;
  };

  var lastIndex = null;   /* where the pill was on the previous screen (for the slide) */
  var popKey = '';        /* the tab just tapped: replays the Dashboard's pop on arrival */

  window.ahDockTap = function (key) {
    popKey = key;
    try {
      if (key === 'ai') { if (typeof window.navigate === 'function') return window.navigate('ai'); location.hash = '#/ai'; return; }
      if (window.AdmissionNavigation && window.AdmissionNavigation.openTab) return window.AdmissionNavigation.openTab(key);
      if (typeof window.navigate === 'function') return window.navigate(key);
      location.hash = '#/' + key;
    } catch (e) { try { console.warn('[nav-dock] tap failed', key, e); } catch (_) {} }
  };

  function dockHtml(active) {
    injectStyle();
    var idx = indexFor(active);
    var from = lastIndex == null ? idx : lastIndex;
    var pop = popKey; popKey = '';
    lastIndex = idx < 0 ? lastIndex : idx;
    var tabsHtml = TABS.map(function (t) {
      var on = t.key === active;
      var btn = '<button type="button" class="ahd-tab' + (on ? ' on' : '') + (on && pop === t.key ? ' pop' : '') + '" data-nav-tab="' + t.key + '" data-tab="' + t.i + '" aria-label="' + t.label + '" aria-current="' + (on ? 'page' : 'false') + '" onclick="window.ahDockTap(\'' + t.key + '\')">' +
        '<span class="ti" aria-hidden="true"><span class="off">' + ico(t.off) + '</span><span class="onI">' + ill(t.on) + '</span></span>' + t.label + '</button>';
      if (t.i === 1) btn += aiSlot();
      return btn;
    }).join('');
    var pillStart = from < 0 ? (idx < 0 ? 0 : idx) : from;
    return '<div class="bottomnav ahd-host"><nav class="ahd-nav" aria-label="প্রধান নেভিগেশন">' +
      '<span class="ahd-pill' + (idx < 0 ? ' ahd-none' : '') + '" data-to="' + idx + '" style="transform:translateX(' + (pillStart * 100) + '%)"></span>' +
      tabsHtml + '</nav></div>';
  }

  function aiSlot() {
    return '<div class="ahd-slot"><button type="button" class="ahd-ai" aria-label="AI সহায়ক" data-nav-tab="ai" onclick="window.ahDockTap(\'ai\')">' +
      '<span class="orbring"></span><span class="core"></span>' +
      '<svg viewBox="0 0 48 48" aria-hidden="true"><defs><linearGradient id="ahdAig" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FFFFFF"/><stop offset="1" stop-color="#FFE9A8"/></linearGradient></defs>' +
      '<path d="M22 7l4.2 11.3L37.5 22.5 26.2 26.7 22 38l-4.2-11.3L6.5 22.5l11.3-4.2z" fill="url(#ahdAig)"/>' +
      '<path class="sp1" d="M37 6l1.8 4.6 4.6 1.8-4.6 1.8L37 18.8l-1.8-4.6-4.6-1.8 4.6-1.8z" fill="#FFD36E"/>' +
      '<path class="sp2" d="M37.5 31l1.3 3.2 3.2 1.3-3.2 1.3-1.3 3.2-1.3-3.2-3.2-1.3 3.2-1.3z" fill="#FFB6E1"/>' +
      '<path class="sp3" d="M9 32l1 2.4 2.4 1-2.4 1-1 2.4-1-2.4-2.4-1 2.4-1z" fill="#BFD3FF"/></svg>' +
      '</button><span class="ahd-ailabel">AI</span></div>';
  }

  /* slide the pill from the previous tab to the current one, like the Dashboard */
  function settlePill() {
    try {
      var p = document.querySelector('#navRoot .ahd-pill');
      if (!p) return;
      var to = +p.getAttribute('data-to');
      if (to < 0) return;
      requestAnimationFrame(function () { requestAnimationFrame(function () { p.style.transform = 'translateX(' + (to * 100) + '%)'; }); });
    } catch (_) {}
  }

  window.bottomNavHtml = function ahNavDock(active) { return dockHtml(active); };
  window.__ahNavDockHtml = dockHtml;

  document.addEventListener('admission:route-rendered', function (e) {
    var path = (e && e.detail && e.detail.path) || '';
    /* The Dashboard draws its own dock (Home slot); remember it for the next slide. */
    if (path === 'dashboard' || path === '') lastIndex = 0;
    try { document.body.classList.toggle('ahd-on', !!document.querySelector('#navRoot .ahd-host')); } catch (_) {}
    settlePill();
  });
})();
