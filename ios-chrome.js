/* Owner 2026-10-16/17: native-app feel on iPhone (Home-Screen PWA, black-translucent
 * status bar, viewport-fit=cover).
 *  1. Status-bar / notch strip always matches the screen right below it.
 *  2. Pinch / double-tap zoom and sideways drag are off (iOS ignores user-scalable=no).
 *  3. The outer page never rubber-bands or pull-refreshes; real inner scrollers
 *     (lists, forms, sheets) still scroll, and nothing is blocked while the
 *     keyboard is up so a focused field can always be brought into view. */
(() => {
  'use strict';
  const css = document.createElement('style');
  css.id = 'ah-ios-chrome';
  css.textContent = 'html{touch-action:manipulation;overflow-x:hidden;overscroll-behavior:none;-webkit-text-size-adjust:100%;text-size-adjust:100%}'
    // iOS zooms the whole page when a field under 16px is focused, which shifts the layout
    // differently on every phone; 16px minimum on iOS only keeps every device the same.
    + '@supports (-webkit-touch-callout:none){input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=file]):not([type=color]),select,textarea{font-size:max(16px,1em)}}'
    + 'body{touch-action:manipulation;overflow-x:clip;overscroll-behavior:none;max-width:100%}'
    // android-runtime-fix.js forces `html, body{overscroll-behavior-y:auto!important}` on every
    // platform, which re-enabled the iPhone rubber-band. :root raises specificity above it.
    + ':root,:root>body{overscroll-behavior:none!important}'
    + '#ah-status-scrim{position:fixed;top:0;left:0;right:0;height:env(safe-area-inset-top,0px);z-index:1150;pointer-events:none;transition:none}'
    + 'body.ah-account-page-active #ah-status-scrim{display:none}';
  document.head.append(css);

  const stop = event => event.preventDefault();
  ['gesturestart', 'gesturechange', 'gestureend'].forEach(type => document.addEventListener(type, stop, { passive: false }));

  /* ---- 3. outer-shell bounce / pull-to-refresh guard ---- */
  const EDITABLE = 'input,textarea,select,[contenteditable=""],[contenteditable="true"],[data-allow-touch-move]';
  const canScrollY = el => {
    if (el.scrollHeight <= el.clientHeight + 1) return false;
    const oy = getComputedStyle(el).overflowY;
    return oy === 'auto' || oy === 'scroll' || oy === 'overlay';
  };
  const canScrollX = el => {
    if (el.scrollWidth <= el.clientWidth + 1) return false;
    const ox = getComputedStyle(el).overflowX;
    return ox === 'auto' || ox === 'scroll' || ox === 'overlay';
  };
  let lastX = 0, lastY = 0;
  document.addEventListener('touchstart', event => {
    if (event.touches && event.touches.length === 1) { lastX = event.touches[0].clientX; lastY = event.touches[0].clientY; }
  }, { passive: true });
  document.addEventListener('touchmove', event => {
    if (event.touches && event.touches.length > 1) { event.preventDefault(); return; }
    if (!event.cancelable || !event.touches || !event.touches[0]) return;
    const touch = event.touches[0];
    const dx = touch.clientX - lastX, dy = touch.clientY - lastY;
    lastX = touch.clientX; lastY = touch.clientY;
    const horizontal = Math.abs(dx) > Math.abs(dy);
    let el = event.target instanceof Element ? event.target : null;
    if (el && el.closest(EDITABLE)) return;
    const body = document.body, root = document.scrollingElement || document.documentElement;
    while (el && el !== body && el !== document.documentElement) {
      if (horizontal) { if (canScrollX(el)) return; }
      else if (canScrollY(el)) {
        const atTop = el.scrollTop <= 0;
        const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 1;
        if (!((dy > 0 && atTop) || (dy < 0 && atBottom))) return;
      }
      el = el.parentElement;
    }
    // The document itself: scrolling is fine, only its two ends are guarded.
    if (!horizontal && body && !body.classList.contains('ah-account-page-active')
      && root.scrollHeight > root.clientHeight + 1 && getComputedStyle(body).overflowY !== 'hidden') {
      const atTop = root.scrollTop <= 0;
      const atBottom = root.scrollTop + root.clientHeight >= root.scrollHeight - 1;
      if (!((dy > 0 && atTop) || (dy < 0 && atBottom))) return;
    }
    // With the keyboard up iOS must stay free to pan the visual viewport.
    if (body && body.classList.contains('keyboard-open')) return;
    event.preventDefault();
  }, { passive: false });

  /* ---- 1. status-bar colour ---- */
  // THE RULE (owner 2026-10-17): the strip under the clock always shows exactly what is
  // directly below it, on every screen, in light and dark, within a second.
  //  - Translucent layers are blended (a dark sheet at 60% over a white page is dark grey,
  //    not white); gradient-only layers contribute their top stop; opacity is honoured.
  //  - Same-origin iframes are looked into; a screen that cannot be sampled declares its top
  //    colour with data-ah-chrome="#rrggbb" and the top-most visible declarer wins.
  //  - Nothing is remembered between screens: every change (DOM, class, theme, tap,
  //    transition end, OS theme) triggers a re-read and a short settle burst.
  const clamp = v => Math.max(0, Math.min(255, Math.round(v)));
  const toHex = (r, g, b) => '#' + [r, g, b].map(v => clamp(v).toString(16).padStart(2, '0')).join('');
  const toRgba = colour => {
    const s = String(colour || '').trim();
    if (!s || s === 'transparent') return null;
    let m = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/i.exec(s);
    if (m) {
      const a = m[4] === undefined ? 1 : (m[4].slice(-1) === '%' ? parseFloat(m[4]) / 100 : parseFloat(m[4]));
      return [+m[1], +m[2], +m[3], a];
    }
    m = /^color\(\s*(?:srgb|display-p3)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+%?))?\s*\)$/i.exec(s);
    if (m) {
      const a = m[4] === undefined ? 1 : (m[4].slice(-1) === '%' ? parseFloat(m[4]) / 100 : parseFloat(m[4]));
      return [m[1] * 255, m[2] * 255, m[3] * 255, a];
    }
    m = /^#([0-9a-f]{3,8})$/i.exec(s);
    if (m) {
      let h = m[1];
      if (h.length === 3 || h.length === 4) h = h.split('').map(ch => ch + ch).join('');
      if (h.length === 6 || h.length === 8) {
        return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1];
      }
    }
    return null;
  };
  const norm = colour => {
    const c = toRgba(colour);
    return c ? toHex(c[0], c[1], c[2]) : '';
  };
  // The colour one element adds to what is behind it, or null when it adds none.
  const layerOf = el => {
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden') return null;
    const op = parseFloat(cs.opacity);
    if (!(op > 0)) return null;
    let c = toRgba(cs.backgroundColor);
    if (!c || c[3] <= 0.01) {
      const image = cs.backgroundImage;
      c = null;
      if (image && image !== 'none' && /gradient/.test(image)) {
        const m = image.match(/rgba?\([^)]*\)|color\([^)]*\)|#[0-9a-f]{3,8}\b/i);
        c = m ? toRgba(m[0]) : null;
      }
    }
    if (!c || c[3] <= 0.01) return null;
    return [c[0], c[1], c[2], Math.min(1, c[3] * Math.min(1, op))];
  };
  // Every layer under one point, top to bottom, looking inside same-origin iframes.
  const stackAt = (x, y, doc, depth, out) => {
    const els = doc.elementsFromPoint(x, Math.max(0, Math.round(y)));
    for (const el of els) {
      if (el.id === 'ah-status-scrim') continue;
      if (el.tagName === 'IFRAME' && depth < 3) {
        try {
          const inner = el.contentDocument;
          if (inner && inner.documentElement) {
            const r = el.getBoundingClientRect();
            stackAt(x - r.left, y - r.top, inner, depth + 1, out);
          }
        } catch (_) {}
      }
      const layer = layerOf(el);
      if (layer) { out.push(layer); if (layer[3] >= 0.995) break; }
    }
    // A document's canvas takes the root/body colour even where neither element is hit
    // (an empty or short body); without it such a screen would read as transparent.
    if (!out.length || out[out.length - 1][3] < 0.995) {
      const base = layerOf(doc.documentElement) || (doc.body && layerOf(doc.body));
      if (base) out.push(base);
    }
    return out;
  };
  const colourAt = y => {
    const layers = stackAt(4, y, document, 0, []);
    let i = layers.findIndex(l => l[3] >= 0.995);
    const above = i < 0 ? layers : layers.slice(0, i);
    let [r, g, b] = i < 0 ? [255, 255, 255] : layers[i];
    for (let k = above.length - 1; k >= 0; k--) {
      const [lr, lg, lb, la] = above[k];
      r = lr * la + r * (1 - la); g = lg * la + g * (1 - la); b = lb * la + b * (1 - la);
    }
    return toHex(r, g, b);
  };
  const declared = () => {
    const list = document.querySelectorAll('[data-ah-chrome]');
    for (let i = list.length - 1; i >= 0; i--) {
      const el = list[i];
      if (!el.isConnected) continue;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) continue;
      const r = el.getBoundingClientRect();
      if (r.top > 2 || r.height < innerHeight * 0.5 || r.width < innerWidth * 0.5) continue;
      const v = norm(el.getAttribute('data-ah-chrome'));
      if (v) return v;
    }
    return '';
  };
  let scrim = null;
  const ensureScrim = () => {
    if (scrim || !document.body) return scrim;
    scrim = document.createElement('div');
    scrim.id = 'ah-status-scrim';
    scrim.setAttribute('aria-hidden', 'true');
    document.body.append(scrim);
    return scrim;
  };
  let last = '';
  let epoch = 0;
  let frozen = null;
  let hadDeclared = false;
  const sync = () => {
    try {
      const strip = ensureScrim();
      const inset = strip ? strip.getBoundingClientRect().height : 0;
      const accountUp = document.body && document.body.classList.contains('ah-account-page-active');
      const root = document.scrollingElement || document.documentElement;
      const scrolled = !accountUp && root && root.scrollTop > 4;
      const forced = accountUp ? '' : declared();
      if (hadDeclared && !forced) { try { window.AhAppearance && window.AhAppearance.apply(); } catch (_) {} }
      hadDeclared = Boolean(forced);
      let value = forced;
      if (!value) {
        // While the document itself is scrolled, content slides under the strip; hold the
        // colour read at rest, but only within the same screen (any change bumps epoch).
        if (scrolled && frozen && frozen.epoch === epoch) value = frozen.value;
        else value = colourAt(accountUp ? 2 : (inset ? inset + 2 : 2));
        if (!scrolled) frozen = { epoch, value };
      }
      if (!value) return;
      if (strip && !accountUp && strip.style.getPropertyValue('background-color') !== value) {
        strip.style.setProperty('background-color', value, 'important');
      }
      // Every theme-color tag (including the media-scoped ones iOS really reads) is
      // re-checked on each pass, so nothing can leave one of them stale.
      document.querySelectorAll('meta[name="theme-color"]').forEach(meta => {
        if (meta.getAttribute('content') !== value) meta.setAttribute('content', value);
      });
      if (!document.querySelector('meta[name="theme-color"]')) {
        const meta = document.createElement('meta'); meta.name = 'theme-color'; meta.content = value; document.head.append(meta);
      }
      const key = value + (accountUp ? ':a' : ':m');
      if (key === last) return;
      last = key;
      // Only the full-screen account surfaces recolour the canvas; the main app keeps
      // its theme background (the scrim alone matches the strip there).
      const canvas = accountUp ? value : '';
      document.documentElement.style.backgroundColor = canvas;
      if (document.body) document.body.style.backgroundColor = canvas;
    } catch (_) {}
  };
  // --- change detection: a screen change is noticed in well under a second ---
  let burst = [];
  let lastKick = 0;
  // Perf: while the page is still booting (until 1.5s after window load) the DOM churns
  // constantly and every kick used to schedule six full syncs. During that window one
  // coalesced pass (<=120ms later) is enough; the 250ms interval below still backstops it.
  // After boot the full burst is unchanged, so screen changes are noticed exactly as before.
  let loadedAt = document.readyState === 'complete' ? Date.now() : 0;
  if (!loadedAt) addEventListener('load', () => { loadedAt = Date.now(); });
  const booting = () => !loadedAt || Date.now() - loadedAt < 1500;
  const kick = () => {
    epoch++;
    const now = Date.now();
    if (now - lastKick < 120) return;
    lastKick = now;
    burst.forEach(clearTimeout);
    burst = (booting() ? [120] : [0, 60, 150, 300, 550, 900]).map(ms => setTimeout(sync, ms));
  };
  let soon = 0;
  const syncSoon = () => {
    epoch++;
    if (soon) return;
    soon = setTimeout(() => { soon = 0; sync(); }, 120);
  };
  try {
    const watch = (target, options, handler) => new MutationObserver(handler).observe(target, options);
    watch(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme', 'style'] }, kick);
    const attach = () => {
      if (!document.body) return;
      watch(document.body, { attributes: true, attributeFilter: ['class', 'style'] }, kick);
      watch(document.body, { attributes: true, childList: true, subtree: true, attributeFilter: ['class', 'style', 'hidden', 'data-theme', 'data-ah-chrome', 'aria-hidden'] }, syncSoon);
    };
    if (document.body) attach(); else document.addEventListener('DOMContentLoaded', attach);
    watch(document.head, { attributes: true, childList: true, subtree: true }, syncSoon);
  } catch (_) {}
  ['load', 'resize', 'hashchange', 'popstate', 'pageshow', 'orientationchange', 'ah:appearance', 'focus'].forEach(type => addEventListener(type, kick));
  ['transitionend', 'animationend', 'transitioncancel'].forEach(type => document.addEventListener(type, syncSoon, true));
  ['pointerup', 'touchend', 'click', 'keyup', 'focusin', 'focusout'].forEach(type => document.addEventListener(type, () => setTimeout(kick, 80), true));
  try { matchMedia('(prefers-color-scheme: dark)').addEventListener('change', kick); } catch (_) {}
  try { if (window.visualViewport) window.visualViewport.addEventListener('resize', kick); } catch (_) {}
  addEventListener('scroll', () => requestAnimationFrame(sync), { passive: true });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) kick(); });
  window.AhChrome = { sync, kick };
  setInterval(() => { if (!document.hidden) sync(); }, 250);
  if (document.body) sync(); else document.addEventListener('DOMContentLoaded', sync);

  /* ---- 4. one viewport everywhere ----
   * `vh` is the viewport with the browser bars hidden, so a sheet sized in vh is taller
   * than the visible screen on iPhone Safari and runs under the bar - and it differs from
   * phone to phone. Every vh length in every stylesheet gets a dvh (dynamic viewport) twin,
   * appended after the originals so it wins at equal specificity. Same selectors, same
   * media conditions; !important is preserved; nothing else is touched. */
  try {
    if (window.CSS && CSS.supports && CSS.supports('height', '1dvh')) {
      const VH = /(-?\d*\.?\d+)vh\b/g;
      const LAYOUT = /^(height|min-height|max-height|top|bottom|inset|inset-block|margin|margin-top|margin-bottom|padding|padding-top|padding-bottom|gap|row-gap|flex-basis)$/;
      const seen = new WeakSet();
      let twin = null;
      const twinsOf = list => {
        let out = '';
        for (const rule of Array.from(list)) {
          try {
            if (rule.type === 1) {
              let body = '';
              for (let i = 0; i < rule.style.length; i++) {
                const name = rule.style[i];
                if (!LAYOUT.test(name)) continue;
                const value = rule.style.getPropertyValue(name);
                if (!/vh\b/.test(value) || /dvh\b/.test(value)) continue;
                body += name + ':' + value.replace(VH, '$1dvh') + (rule.style.getPropertyPriority(name) ? '!important' : '') + ';';
              }
              if (body) out += rule.selectorText + '{' + body + '}';
            } else if (rule.type === 4 || rule.type === 12) {
              const inner = twinsOf(rule.cssRules);
              if (inner) out += (rule.type === 4 ? '@media ' : '@supports ') + rule.conditionText + '{' + inner + '}';
            }
          } catch (_) {}
        }
        return out;
      };
      const build = () => {
        let add = '';
        for (const sheet of Array.from(document.styleSheets)) {
          if (seen.has(sheet) || (sheet.ownerNode && sheet.ownerNode.id === 'ah-dvh-twins')) continue;
          let rules;
          try { rules = sheet.cssRules; } catch (_) { continue; }   // cross-origin sheet
          if (!rules) continue;
          seen.add(sheet);
          add += twinsOf(rules);
        }
        if (!add) return;
        if (!twin) { twin = document.createElement('style'); twin.id = 'ah-dvh-twins'; }
        twin.textContent += add;
        document.head.append(twin);      // always last, so it keeps winning
      };
      let timer = 0;
      const later = () => { clearTimeout(timer); timer = setTimeout(build, 250); };
      addEventListener('load', later);
      document.addEventListener('DOMContentLoaded', later);
      new MutationObserver(later).observe(document.head, { childList: true });
      window.AhDvh = { build };
      later();
    }
  } catch (_) {}

  /* ---- 5. keyboard closed => full height again ----
   * iOS sometimes never reports the keyboard going away, so the page keeps its shrunken
   * visual-viewport height (the Next button stays high, the bottom stays empty). Called by
   * the sign-up/sign-in flow when its last field loses focus: if nothing editable is focused
   * a moment later, the full height is restored. */
  window.AhViewport = {
    settle(force) {
      [150, 500, 1100].forEach(ms => setTimeout(() => {
        try {
          // `force`: the caller already knows the keyboard is gone although a field is still focused
          const a = document.activeElement;
          if (!force && a && a.matches && a.matches('input,textarea,select,[contenteditable]')) return;
          document.body.classList.remove('keyboard-open');
          const rootStyle = document.documentElement.style;
          rootStyle.setProperty('--visual-viewport-height', window.innerHeight + 'px');
          rootStyle.setProperty('--visual-viewport-offset-top', '0px');
          rootStyle.setProperty('--keyboard-inset', '0px');
        } catch (_) {}
      }, ms));
    }
  };

  /* ---- 6. on-device diagnostics (off by default) ----
   * Open the site once with ?kbdebug=1 to show a small black badge with the numbers iOS really
   * reports (visual viewport vs layout viewport, compact-mode flag, page and Next-button bottoms,
   * which build is running). It stays on until ?kbdebug=0. Used to compare a phone with the
   * simulated one when a layout looks different on the device. */
  try {
    const q = new URLSearchParams(location.search).get('kbdebug');
    if (q === '0') localStorage.removeItem('ah-kbdebug');
    else if (q !== null) localStorage.setItem('ah-kbdebug', '1');
    if (localStorage.getItem('ah-kbdebug') === '1') {
      const show = () => {
        if (!document.body) return;
        const badge = document.createElement('div');
        badge.id = 'ah-kbdebug';
        badge.style.cssText = 'position:fixed;top:calc(env(safe-area-inset-top,0px) + 2px);left:4px;right:4px;z-index:2147483600;font:10px/1.35 ui-monospace,Menlo,monospace;background:rgba(0,0,0,.78);color:#7CFF9B;padding:3px 6px;border-radius:7px;pointer-events:none;word-break:break-all';
        document.body.append(badge);
        const rect = el => (el ? Math.round(el.getBoundingClientRect().bottom) : '-');
        const tick = () => {
          const vv = window.visualViewport;
          const app = document.getElementById('sky-app');
          const page = document.querySelector('.ah-account-page[data-sky-flow="on"]');
          const skyJs = ((document.querySelector('script[src*="sky-onboarding"]') || {}).src || '').split('?v=')[1] || '-';
          const a = document.activeElement;
          badge.textContent = 'dbg1 | vv ' + (vv ? Math.round(vv.height) : '-') + '/' + window.innerHeight
            + ' off' + (vv ? Math.round(vv.offsetTop) : '-') + ' | compact ' + ((app && app.dataset.kb) || '-')
            + ' | kbOpen ' + (document.body.classList.contains('keyboard-open') ? 1 : 0)
            + ' | page.b ' + rect(page) + ' cta.b ' + rect(document.getElementById('sky-cta'))
            + ' | focus ' + (a && a.tagName === 'INPUT' ? 'input' : '-') + ' | sky ' + skyJs;
        };
        tick();
        setInterval(tick, 300);
      };
      if (document.body) show(); else document.addEventListener('DOMContentLoaded', show);
    }
  } catch (_) {}
})();
