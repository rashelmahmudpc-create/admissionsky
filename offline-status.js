/*
 * Offline status indicator, Admission Hub
 *
 * P15's promise is "works offline, syncs when the network returns". The device
 * only speaks up when it is actually offline, and never over the UI:
 *   · offline with unsent changes  → tells them how many will be sent later,
 *   · offline with nothing pending → a quiet "offline" note.
 * While online it stays silent, the owner read a lingering sync pill as a bug.
 * It never blocks the UI and never claims success it cannot verify.
 */
(() => {
  'use strict';

  const PILL_ID = 'ah-offline-pill';
  let hideTimer = 0;
  let last = { online: true, active: false, pending: 0 };

  function ensurePill() {
    let el = document.getElementById(PILL_ID);
    if (el) return el;
    el = document.createElement('div');
    el.id = PILL_ID;
    el.className = 'ah-offline-pill';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    el.hidden = true;
    document.body.appendChild(el);
    return el;
  }

  function render(state) {
    const el = ensurePill();
    const online = state.online !== false;
    const pending = Number(state.pending) || 0;
    const want = [];

    /* The status pill is gone. The owner asked for it off: a floating sync
       message that lingers over the bottom nav reads as a bug, not a promise.
       Keep only a quiet note when the device is actually offline, and nothing
       at all while online. */
    if (!online) want.push(pending > 0 ? `পরে পাঠানো হবে · ${pending}` : 'অফলাইন');

    if (!want.length) { el.hidden = true; return; }
    el.textContent = want[0];
    el.dataset.mode = !online ? 'offline' : pending > 0 ? 'syncing' : 'done';
    el.hidden = false;

    if (el.dataset.mode === 'done') {
      clearTimeout(hideTimer);
      hideTimer = setTimeout(() => { el.hidden = true; }, 2200);
    }
  }

  function apply(detail) {
    const next = Object.assign({}, last, detail || {});
    const previous = last;
    last = next;
    /* Keep the "all synced" confirmation, which only makes sense as a transition. */
    if (previous.pending > 0 && next.pending === 0 && next.online !== false && next.active !== false) {
      last = next;
      render({ online: true, active: true, pending: 0 });
      return;
    }
    render(next);
  }

  function boot() {
    try { ensurePill(); } catch (_) { return; }
    try {
      window.addEventListener('admissionhub:sync-status', (e) => apply(e.detail));
      window.addEventListener('online', () => apply({ online: true }));
      window.addEventListener('offline', () => apply({ online: false }));
      apply({ online: navigator.onLine !== false });
    } catch (_) {}
    /* The indicator must not float over the phone; wait for boot to settle. */
    try {
      window.addEventListener('admission:boot-ready', () => {
        const el = document.getElementById(PILL_ID);
        if (el) el.classList.add('is-ready');
      });
    } catch (_) {}
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
