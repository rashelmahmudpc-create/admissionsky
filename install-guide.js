/*
 * Install Guide, Admission Hub
 *
 * A short, one-tap invitation to keep the app on the phone.
 *  · Android, a single button opens the browser's real install prompt, so the
 *    student is added in one tap.
 *  · iPhone/iPad, Apple does not let any web page install itself, so Safari
 *    shows the Share → Add to Home Screen steps. Tapping the primary button
 *    reveals that short guide on demand (the demo animation is tucked here too)
 *    instead of front-loading it.
 * It never nags: it shows once, remembers a dismissal for two weeks, and stays
 * silent when the app is already installed.
 */
(() => {
  'use strict';

  const KEY = 'ah-install-guide-v1';
  const DAY = 24 * 60 * 60 * 1000;
  const SNOOZE_DAYS = 14;
  const AUTO_DELAY_MS = 7000;
  const DEMO_STEP_MS = 2400;

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function isStandalone() {
    try {
      return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
        window.navigator.standalone === true;
    } catch (_) { return false; }
  }

  function platform() {
    const ua = String((navigator && navigator.userAgent) || '');
    const touchMac = navigator && navigator.platform === 'MacIntel' && Number(navigator.maxTouchPoints) > 1;
    if (/iPad|iPhone|iPod/.test(ua) || touchMac) return 'ios';
    if (/Android/.test(ua)) return 'android';
    return 'desktop';
  }

  function readState() {
    try {
      const raw = localStorage.getItem(KEY);
      const v = raw ? JSON.parse(raw) : null;
      return v && typeof v === 'object' ? v : {};
    } catch (_) { return {}; }
  }
  function writeState(next) {
    try { localStorage.setItem(KEY, JSON.stringify(next)); } catch (_) {}
  }
  function snooze(reason) {
    writeState(Object.assign(readState(), { dismissedAt: Date.now(), reason: reason || 'dismiss' }));
  }
  function recentlyDismissed() {
    const s = readState();
    return Number(s.dismissedAt) > 0 && (Date.now() - Number(s.dismissedAt)) < SNOOZE_DAYS * DAY;
  }

  /* The browser's real install prompt, when it offers one (Android/Chrome). */
  let deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    try { e.preventDefault(); } catch (_) {}
    deferredPrompt = e;
  });

  const STEPS = {
    ios: ['Safari-এর নিচের Share বাটনে ট্যাপ করুন।', '“Add to Home Screen” → “Add” চাপুন।'],
    android: ['ব্রাউজারের উপরে-ডানে ⋮ মেনুতে ট্যাপ করুন।', '“Add to Home screen” → “Add” চাপুন।'],
    desktop: ['ঠিকানা-বারের ডানদিকের ইনস্টল-আইকনে ক্লিক করুন।', '“Install” → “Install” চাপুন।']
  };

  /* The little motion demo: gesture → menu → result. */
  function demoMarkup(p) {
    if (p === 'ios') {
      return `<div class="ahig-stage" data-demo="ios" aria-hidden="true">
          <div class="ahig-bar"><span class="ahig-bar-title">admissionsky.pages.dev</span>
            <span class="ahig-share" data-anim="tap">↑</span></div>
          <div class="ahig-menu" data-anim="menu">
            <div class="ahig-menu-row">অনুলিপি করুন</div>
            <div class="ahig-menu-row ahig-menu-hit" data-anim="hit">➕ Add to Home Screen</div>
            <div class="ahig-menu-row">বুকমার্ক</div></div>
          <div class="ahig-result" data-anim="land"><span class="ahig-appicon">🎓</span>
            <span class="ahig-result-label">Admission Hub</span></div></div>`;
    }
    if (p === 'android') {
      return `<div class="ahig-stage" data-demo="android" aria-hidden="true">
          <div class="ahig-bar"><span class="ahig-bar-title">admissionsky.pages.dev</span>
            <span class="ahig-dots" data-anim="tap">⋮</span></div>
          <div class="ahig-menu" data-anim="menu">
            <div class="ahig-menu-row">Share</div>
            <div class="ahig-menu-row ahig-menu-hit" data-anim="hit">Install app</div>
            <div class="ahig-menu-row">Bookmark</div></div>
          <div class="ahig-result" data-anim="land"><span class="ahig-appicon">🎓</span>
            <span class="ahig-result-label">Admission Hub</span></div></div>`;
    }
    return `<div class="ahig-stage" data-demo="desktop" aria-hidden="true">
        <div class="ahig-bar"><span class="ahig-bar-title">admissionsky.pages.dev</span>
          <span class="ahig-dots" data-anim="tap">⤓</span></div>
        <div class="ahig-result" data-anim="land"><span class="ahig-appicon">🎓</span>
          <span class="ahig-result-label">Admission Hub</span></div></div>`;
  }

  let root = null;
  let shown = false;
  let demoTimer = 0;

  function build() {
    const p = platform();
    const steps = STEPS[p] || STEPS.desktop;
    const canOneTap = p === 'android';
    const el = document.createElement('div');
    el.className = 'ahig-backdrop';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-labelledby', 'ahig-title');
    el.innerHTML = `
      <div class="ahig-card" tabindex="-1">
        <button class="ahig-close" type="button" aria-label="বন্ধ করুন">✕</button>
        <h2 class="ahig-title" id="ahig-title">পড়াশোনা থাকুক হাতের কাছেই 📚</h2>
        <p class="ahig-lead">Admission Hub হোম স্ক্রিনে যোগ করুন, এক ক্লিকে খুলবে, অফলাইনেও পড়া যাবে।</p>
        <div class="ahig-detail" hidden>
          ${demoMarkup(p)}
          <div class="ahig-howtitle">যেভাবে যোগ করবেন</div>
          <ol class="ahig-steps">${steps.map(s => `<li>${esc(s)}</li>`).join('')}</ol>
          <p class="ahig-foot">এরপর হোম স্ক্রিন থেকেই Admission Hub খুলতে পারবেন।</p>
        </div>
        <div class="ahig-actions">
          <button class="ahig-primary" type="button" data-action="install">${canOneTap ? 'এখনই যোগ করুন' : 'কীভাবে যোগ করব?'}</button>
          <button class="ahig-secondary" type="button" data-action="later">পরে মনে করাব</button>
        </div>
      </div>`;
    return el;
  }

  function stopDemo() { if (demoTimer) { clearInterval(demoTimer); demoTimer = 0; } }

  function startDemo() {
    if (!root) return;
    const stage = root.querySelector('.ahig-stage');
    if (!stage) return;
    const seq = ['tap', 'menu', 'hit', 'land'];
    let i = 0;
    const total = seq.length * 2;
    const paint = () => {
      const stepIndex = Math.min(i, seq.length - 1);
      const active = i >= total ? 'land' : seq[stepIndex];
      stage.querySelectorAll('[data-anim]').forEach(n => {
        n.classList.toggle('is-on', n.getAttribute('data-anim') === active);
        n.classList.toggle('is-done', seq.indexOf(n.getAttribute('data-anim')) < seq.indexOf(active));
      });
      i += 1;
      if (i > total) { clearInterval(demoTimer); demoTimer = 0; }
    };
    paint();
    demoTimer = setInterval(paint, DEMO_STEP_MS);
  }

  function revealDetail() {
    if (!root) return;
    const d = root.querySelector('.ahig-detail');
    if (!d || !d.hidden) return;
    d.hidden = false;
    root.querySelector('[data-action="install"]').hidden = true;
    startDemo();
  }

  function hide(why) {
    if (!root) return;
    snooze(why);
    stopDemo();
    const node = root;
    root = null;
    node.classList.add('ahig-out');
    setTimeout(() => { try { node.remove(); } catch (_) {} }, 220);
  }

  async function show() {
    if (shown || root) return false;
    if (isStandalone()) return false;
    if (recentlyDismissed()) return false;
    shown = true;
    root = build();
    document.body.appendChild(root);
    requestAnimationFrame(() => root && root.querySelector('.ahig-card')?.focus());

    root.addEventListener('click', async (ev) => {
      const el = ev.target;
      const action = el && el.getAttribute && el.getAttribute('data-action');
      if (el === root) { hide('backdrop'); return; }
      if (el && el.classList.contains('ahig-close')) { hide('close'); return; }
      if (action === 'later') { hide('later'); return; }
      if (action === 'install') {
        if (deferredPrompt) {
          try {
            deferredPrompt.prompt();
            const choice = await deferredPrompt.userChoice;
            deferredPrompt = null;
            hide(choice && choice.outcome === 'accepted' ? 'accepted' : 'declined');
          } catch (_) { hide('dismiss'); }
          return;
        }
        /* No native prompt (iOS/desktop): show the short how-to + demo. */
        revealDetail();
      }
    });

    const onKey = (e) => { if (e.key === 'Escape') { hide('escape'); document.removeEventListener('keydown', onKey); } };
    document.addEventListener('keydown', onKey);
    return true;
  }

  /* The welcome / account entry is on screen: a modal install pop-up here covers
     the first thing a new student should see, so it reads as a blank screen.
     Wait until the student has actually entered the app instead of nagging on
     the front door. */
  function entryShowing() {
    try {
      const page = document.getElementById('ah-account-page');
      if (page && !page.hidden) return true;
      if (document.querySelector('.ah-welcome-live')) return true;
    } catch (_) {}
    return false;
  }
  function autoDelay() {
    const override = Number(window.__ahigAutoDelay);
    return override > 0 ? override : AUTO_DELAY_MS;
  }
  function maybeAutoShow() {
    if (isStandalone() || recentlyDismissed()) return;
    setTimeout(() => {
      if (entryShowing()) { maybeAutoShow(); return; }
      void show();
    }, autoDelay());
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', maybeAutoShow, { once: true });
  } else {
    maybeAutoShow();
  }

  window.AhInstallGuide = { show, hide, revealDetail, isStandalone, platform, _reset: () => { try { localStorage.removeItem(KEY); } catch (_) {} } };
})();
