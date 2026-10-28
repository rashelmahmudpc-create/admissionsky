/*
 * Accessibility core, Admission Hub
 *
 * Small, app-wide accessibility foundations that must exist everywhere:
 *  · a skip link so a keyboard user can jump straight to the content,
 *  · a focusable main-content target for that link,
 *  · a polite live region so dynamic status changes are announced,
 *  · a marker on <html> when the visitor prefers reduced motion, so CSS can
 *    calm looping animation down.
 * It is defensive: every step is wrapped so a failure here can never stop the
 * app from booting.
 */
(() => {
  'use strict';

  const MAIN_SELECTORS = ['#app main', 'main.page', 'main', '#app'];
  const MAIN_ID = 'ah-main-content';

  function addSkipLink() {
    if (!document.body || document.querySelector('.ah-skip-link')) return;
    const link = document.createElement('a');
    link.className = 'ah-skip-link';
    link.href = '#' + MAIN_ID;
    link.textContent = 'মূল কনটেন্টে যান';
    link.addEventListener('click', (e) => {
      const target = document.getElementById(MAIN_ID);
      if (!target) return;
      e.preventDefault();
      target.focus({ preventScroll: false });
      if (typeof window.ahAnnounce === 'function') window.ahAnnounce('মূল কনটেন্ট');
    });
    document.body.insertBefore(link, document.body.firstChild);
  }

  /* Give the current main content a stable, focusable id. No-op once set. */
  function tagMain() {
    const existing = document.getElementById(MAIN_ID);
    if (existing) {
      if (!existing.hasAttribute('tabindex')) existing.setAttribute('tabindex', '-1');
      return;
    }
    for (const sel of MAIN_SELECTORS) {
      const el = document.querySelector(sel);
      if (el) {
        el.id = MAIN_ID;
        el.setAttribute('tabindex', '-1');
        return;
      }
    }
  }

  /* One polite live region the app can announce through window.ahAnnounce(). */
  function addLiveRegion() {
    if (document.getElementById('ah-live-status')) return;
    const region = document.createElement('div');
    region.id = 'ah-live-status';
    region.className = 'ah-sr-only';
    region.setAttribute('role', 'status');
    region.setAttribute('aria-live', 'polite');
    region.setAttribute('aria-atomic', 'true');
    document.body.appendChild(region);
    window.ahAnnounce = (message) => {
      try {
        region.textContent = '';
        requestAnimationFrame(() => { region.textContent = String(message == null ? '' : message); });
      } catch (_) {}
    };
  }

  function markReducedMotion() {
    try {
      const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
      const apply = () => document.documentElement.classList.toggle('ah-reduce-motion', !!mq.matches);
      apply();
      if (typeof mq.addEventListener === 'function') mq.addEventListener('change', apply);
      else if (typeof mq.addListener === 'function') mq.addListener(apply);
    } catch (_) {}
  }

  /* ---- icon buttons: a name a screen reader can read aloud ---- */
  const GLYPH_LABELS = {
    '⚙️': 'সেটিংস', '⚙': 'সেটিংস', '×': 'বন্ধ করুন', '✕': 'বন্ধ করুন', '✏️': 'সম্পাদনা',
    '🗑️': 'মুছুন', '←': 'পিছনে যান', '⋮': 'আরও অপশন', '★': 'বুকমার্ক', '☆': 'বুকমার্ক',
    '☰': 'মেনু', '🔍': 'খুঁজুন', '▶': 'চালান', '⏸': 'থামান', '⇤': 'পিছনে', '⇥': 'সামনে'
  };
  function labelIconButtons(root) {
    const scope = root && root.querySelectorAll ? root : document;
    const buttons = scope.querySelectorAll('button');
    buttons.forEach((btn) => {
      if (btn.hasAttribute('aria-label') || btn.hasAttribute('aria-labelledby')) return;
      const text = (btn.textContent || '').trim();
      const hasText = /[A-Za-z0-9\u0980-\u09FF]/.test(text);
      if (hasText) return; // it already reads out its own text
      const existing = btn.getAttribute('title');
      let label = existing;
      if (!label && GLYPH_LABELS[text]) label = GLYPH_LABELS[text];
      if (!label) {
        // Last resort: the handler often names the action, e.g. closeModal().
        const oc = btn.getAttribute('onclick') || '';
        if (/closeModal/.test(oc)) label = 'বন্ধ করুন';
        else if (/confirmSubmitExam/.test(oc)) label = 'পরীক্ষা জমা দিন';
        else if (glyphOnly(text)) label = 'বাটন';
      }
      if (label) { btn.setAttribute('aria-label', label); if (!existing) btn.setAttribute('title', label); }
    });
  }
  function glyphOnly(text) {
    if (!text) return true;
    return !/[A-Za-z0-9\u0980-\u09FF]/.test(text);
  }
  function hideDecorativeSvg(root) {
    const scope = root && root.querySelectorAll ? root : document;
    scope.querySelectorAll('svg:not([aria-label]):not([aria-labelledby])').forEach((s) => {
      s.setAttribute('aria-hidden', 'true');
      s.setAttribute('focusable', 'false');
    });
  }

  /* ---- modal: real dialog semantics, focus trap, Esc, focus restore ---- */
  let lastFocused = null;
  function isModalOpen() {
    const root = document.getElementById('modalRoot');
    return !!(root && root.querySelector('.modal'));
  }
  function focusables(box) {
    return Array.from(box.querySelectorAll(
      'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )).filter((el) => el.offsetParent !== null || el === document.activeElement);
  }
  function decorateModal() {
    const root = document.getElementById('modalRoot');
    if (!root) return;
    const box = root.querySelector('.modal');
    if (!box) { restoreFocus(); return; }
    const bg = box.parentElement;
    if (bg) { bg.setAttribute('role', 'dialog'); bg.setAttribute('aria-modal', 'true'); }
    box.setAttribute('role', 'document');
    if (!lastFocused) lastFocused = document.activeElement;
    const first = focusables(box)[0];
    if (first) { try { first.focus({ preventScroll: true }); } catch (_) {} }
  }
  function restoreFocus() {
    if (!lastFocused) return;
    try { if (document.contains(lastFocused)) lastFocused.focus({ preventScroll: true }); } catch (_) {}
    lastFocused = null;
  }
  function trapKey(e) {
    if (!isModalOpen()) { if (e.key === 'Escape') return; return; }
    if (e.key === 'Escape') {
      e.preventDefault();
      if (typeof window.closeModal === 'function') window.closeModal();
      else { const r = document.getElementById('modalRoot'); if (r) r.innerHTML = ''; }
      return;
    }
    if (e.key !== 'Tab') return;
    const box = document.querySelector('#modalRoot .modal');
    if (!box) return;
    const items = focusables(box);
    if (!items.length) return;
    const first = items[0], last = items[items.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && active === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
    else if (!box.contains(active)) { e.preventDefault(); first.focus(); }
  }

  let scheduled = false;
  function scheduleTag() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => { scheduled = false; tagMain(); });
  }

  function boot() {
    try { markReducedMotion(); } catch (_) {}
    try { addSkipLink(); } catch (_) {}
    try { tagMain(); } catch (_) {}
    try { addLiveRegion(); } catch (_) {}
    try { hideDecorativeSvg(); labelIconButtons(); } catch (_) {}
    try { document.addEventListener('keydown', trapKey); } catch (_) {}
    try {
      /* The SPA swaps its content; keep the skip-link target alive and keep
         icon buttons named for anything rendered later. */
      const mo = new MutationObserver((records) => {
        scheduleTag();
        try {
          hideDecorativeSvg();
          labelIconButtons();
          const root = document.getElementById('modalRoot');
          if (root && records.some((r) => root.contains(r.target) || r.target === root)) decorateModal();
        } catch (_) {}
      });
      mo.observe(document.body, { childList: true, subtree: true });
    } catch (_) {}
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
