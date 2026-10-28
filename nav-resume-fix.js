/**
 * nav-resume-fix.js v4, Safety net for bottom nav bar displacement
 * in iOS PWA after returning from background/external app.
 *
 * Primary fix: openExternalProvider now uses window.open('_blank') in
 * standalone mode, which prevents the viewport bug entirely.
 *
 * This file provides a fallback safety net:
 * - Removes false keyboard-open class on resume
 * - Periodically checks nav position and scrolls to fix if needed
 */
(() => {
  'use strict';

  function resetNavState() {
    // Remove false keyboard state if no input is focused
    const el = document.activeElement;
    const editing = el && el.matches('input,textarea,select,[contenteditable]');
    if (!editing) {
      document.body.classList.remove('keyboard-open');
    }
    // Resume must never force-scroll or change the current route. A user's
    // scroll position is state; altering it in the background feels like
    // autonomous app movement and can fight route renderers on mobile/PWA.
    // The existing keyboard class cleanup above is intentionally retained.
  }

  // On visibility change (returning to app)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      setTimeout(resetNavState, 100);
      setTimeout(resetNavState, 500);
    }
  });

  window.addEventListener('pageshow', () => {
    setTimeout(resetNavState, 100);
    setTimeout(resetNavState, 500);
  });

  // No perpetual timer: cleanup runs only on real resume events above. This
  // prevents background work from making the PWA appear to run by itself.

})();
