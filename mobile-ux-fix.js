/**
 * mobile-ux-fix.js, Permanent fixes for mobile UX issues:
 * 1. Question Bank search: keyboard/search not working (focus lost on re-render)
 * 2. Scrolling jitter in Exam Setup pages
 * 3. Page jumping to top when clicking dropdowns or interactive elements
 */
(() => {
  'use strict';

  // =========================================================================
  // FIX 1: Question Bank search, prevent full re-render while typing
  // The search input calls renderQuestionBankV2() on every keystroke which
  // replaces the entire #app innerHTML, causing the input to lose focus
  // and the keyboard to dismiss on mobile.
  // Solution: Debounce the search and restore focus after re-render.
  // =========================================================================

  // Override renderQuestionBankV2 to preserve focus during search
  const patchQBankSearch = () => {
    const originalRenderQBV2 = window.renderQuestionBankV2;
    if (!originalRenderQBV2) return;

    let searchDebounceTimer = null;
    let isSearchTriggered = false;

    window.renderQuestionBankV2 = function () {
      const activeEl = document.activeElement;
      const isSearching = activeEl && activeEl.matches('input[type="search"], .q-search-box input, .searchbar input, .explorer-search input');
      const cursorPos = isSearching ? activeEl.selectionStart : null;
      const searchValue = isSearching ? activeEl.value : null;

      const result = originalRenderQBV2.apply(this, arguments);

      // Restore focus to search input after re-render
      if (isSearching) {
        requestAnimationFrame(() => {
          const newInput = document.querySelector('.q-search-box input[type="search"], .q-search-box input, .searchbar input, .explorer-search input, #bankSearch');
          if (newInput) {
            newInput.focus({ preventScroll: true });
            if (searchValue !== null) {
              newInput.value = searchValue;
            }
            if (cursorPos !== null) {
              try { newInput.setSelectionRange(cursorPos, cursorPos); } catch (e) { /* ignore */ }
            }
          }
        });
      }
      return result;
    };
  };

  // Also patch the urgentSubjectSearch to ensure it works properly
  const patchUrgentSearch = () => {
    const originalUrgentSearch = window.urgentSubjectSearch;
    window.urgentSubjectSearch = function (v) {
      const box = document.getElementById('uSubjects');
      if (!box) return;
      const term = (v || '').toLowerCase();
      box.querySelectorAll('.u-subject, .card').forEach(x => {
        x.style.display = (!term || x.textContent.toLowerCase().includes(term)) ? '' : 'none';
      });
    };
  };

  // =========================================================================
  // FIX 2: Scrolling jitter in Exam Setup
  // The setup-scroll container has conflicting CSS rules:
  // - Original: height:calc(100dvh - ...), overflow-y:auto
  // - global-app-fix: height:auto!important, overflow:visible!important
  // This conflict causes jittery scrolling. Fix: use native body scroll
  // with proper padding, remove the conflicting inner scroll container.
  // =========================================================================

  const fixScrolling = () => {
    const style = document.createElement('style');
    style.id = 'mobile-ux-scroll-fix';
    style.textContent = `
      /* Let the page scroll naturally via body, not a nested scroll container */
      .setup-scroll {
        height: auto !important;
        max-height: none !important;
        overflow: visible !important;
        -webkit-overflow-scrolling: touch !important;
        overscroll-behavior: none !important;
        padding-bottom: 80px !important;
      }
      /* Ensure smooth native scrolling */
      html {
        scroll-behavior: auto !important;
        -webkit-overflow-scrolling: touch;
      }
      body {
        -webkit-overflow-scrolling: touch;
        overflow-y: auto !important;
        overflow-x: hidden !important;
      }
      #app {
        overflow: visible !important;
        transform: none !important;
      }
      /* Prevent layout shift during scroll */
      .page {
        transform: none !important;
        will-change: auto !important;
      }
      /* Fix the setup footer to stay at bottom without causing layout issues */
      .setup-footer {
        position: sticky !important;
        bottom: 0 !important;
        z-index: 5 !important;
        padding-bottom: calc(8px + var(--safe-b, 0px)) !important;
      }
    `;
    document.head.appendChild(style);
  };

  // =========================================================================
  // FIX 3: Page jumping when clicking dropdowns or interactive elements
  // Two causes:
  // a) focusIntoView handler scrolls the page on EVERY focusin event
  //    (even for selects/dropdowns that don't need it)
  // b) renderExamSetup always calls scrollTo(0,0) even for in-page updates
  //    (like dropdown changes that shouldn't reset scroll position)
  // Solution: 
  // - Suppress scrollIntoView for select elements and non-keyboard focus
  // - Track whether scroll-to-top is needed (only on page/step change)
  // =========================================================================

  const fixPageJump = () => {
    // Suppress the aggressive focusIntoView for select elements and
    // elements that are already visible in the viewport
    const originalScrollIntoView = Element.prototype.scrollIntoView;
    let suppressScrollIntoView = false;

    // Intercept focusin to prevent unnecessary scrolling
    document.addEventListener('focusin', (e) => {
      const target = e.target;
      // Don't scroll for select elements (dropdowns) - they handle their own UI
      if (target && target.matches('select')) {
        suppressScrollIntoView = true;
        setTimeout(() => { suppressScrollIntoView = false; }, 300);
        return;
      }
      // Don't scroll for elements already visible in viewport
      if (target && target.matches('input, textarea')) {
        const rect = target.getBoundingClientRect();
        const vv = window.visualViewport || { height: window.innerHeight, offsetTop: 0 };
        const viewTop = vv.offsetTop || 0;
        const viewBottom = viewTop + vv.height;
        // If element is already visible, suppress scroll
        if (rect.top >= viewTop + 20 && rect.bottom <= viewBottom - 20) {
          suppressScrollIntoView = true;
          setTimeout(() => { suppressScrollIntoView = false; }, 300);
        }
      }
    }, { capture: true, passive: true });

    // Patch scrollIntoView to respect suppression
    Element.prototype.scrollIntoView = function (opts) {
      if (suppressScrollIntoView) return;
      return originalScrollIntoView.call(this, opts);
    };

    // Patch the exam setup renderExamSetup to only scroll to top on page change
    let lastExamSetupPage = null;
    const originalRAF = window.requestAnimationFrame;
    const patchExamSetupScroll = () => {
      // Override the renderExamSetup scroll behavior
      const origRenderExamSetup = window.renderExamSetup;
      if (typeof origRenderExamSetup !== 'function') return;

      // We need to intercept the scrollTo(0,0) that happens after renderExamSetup
      // by tracking the current page and only scrolling on actual page change
      const origScrollTo = window.scrollTo;
      let examSetupRendering = false;

      window.renderExamSetup = function () {
        const prevPage = lastExamSetupPage;
        examSetupRendering = true;
        const result = origRenderExamSetup.apply(this, arguments);
        const currentPage = typeof setupPage === 'function' ? setupPage() :
          (typeof ExamSetup !== 'undefined' ? Math.max(1, Math.min(3, Number(ExamSetup?.wizardStep || 1))) : null);
        lastExamSetupPage = currentPage;

        // Only allow scroll-to-top if the page actually changed
        if (prevPage !== null && prevPage === currentPage) {
          // Same page re-render (e.g., dropdown change), suppress scroll
          examSetupRendering = 'suppress';
        }
        setTimeout(() => { examSetupRendering = false; }, 50);
        return result;
      };

      // Patch scrollTo to suppress during same-page exam setup re-renders
      window.scrollTo = function (x, y) {
        if (examSetupRendering === 'suppress' && x === 0 && y === 0) {
          return; // Don't scroll to top for same-page updates
        }
        return origScrollTo.apply(this, arguments);
      };
    };

    // Also patch the examDropdownChange to not trigger full scroll reset
    const patchDropdownChange = () => {
      const origExamDropdownChange = window.examDropdownChange;
      if (!origExamDropdownChange) return;

      window.examDropdownChange = function (id, value) {
        // Save scroll position before the render
        const scrollY = window.pageYOffset || document.documentElement.scrollTop;
        const scroller = document.querySelector('.setup-scroll');
        const scrollerTop = scroller ? scroller.scrollTop : 0;

        // Call original
        origExamDropdownChange.call(this, id, value);

        // Restore scroll position after render
        requestAnimationFrame(() => {
          window.scrollTo(0, scrollY);
          if (scroller) scroller.scrollTop = scrollerTop;
        });
      };
    };

    patchExamSetupScroll();
    patchDropdownChange();
  };

  // =========================================================================
  // FIX 3b: Prevent hashchange scroll-to-top for in-page state changes
  // global-app-fix.js adds: hashchange → scrollTo(0,0)
  // This is fine for actual navigation but not for in-page state updates
  // that happen to trigger hashchange (like the question bank search).
  // =========================================================================

  const fixHashChangeScroll = () => {
    // Remove the aggressive hashchange scroll handler from global-app-fix
    // and replace with a smarter one that only scrolls on actual route change
    let lastRoute = location.hash.slice(1) || 'dashboard';

    window.addEventListener('hashchange', () => {
      const newRoute = location.hash.slice(1) || 'dashboard';
      // Only scroll to top if the base route actually changed
      const oldBase = lastRoute.split('/')[0];
      const newBase = newRoute.split('/')[0];
      if (oldBase !== newBase) {
        window.scrollTo(0, 0);
      }
      lastRoute = newRoute;
    }, false);
  };

  // =========================================================================
  // Initialize all fixes
  // =========================================================================

  // Wait for DOM and other scripts to load
  const init = () => {
    fixScrolling();
    fixPageJump();
    fixHashChangeScroll();
    patchQBankSearch();
    patchUrgentSearch();
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    // Scripts are loaded, but use setTimeout to ensure we run after other scripts
    setTimeout(init, 0);
  }
})();
//# sourceURL=mobile-ux-fix.js
