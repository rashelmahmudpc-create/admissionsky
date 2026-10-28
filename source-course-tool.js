(() => {
  'use strict';

  const COURSE_DEFS = {
    sandhi: { id: 'sandhi-exact-native-v1', category: 'বাংলা', path: './courses/sandhi/index.html', hash: 'eb3376f93f7c5a80ee90cd314399a8a40de623c0347fe51248aa84fabbf7aa67', label: 'সন্ধি', title: 'সন্ধি, University Admission Master Guide', subtitle: 'Visual University Admission Master Guide · Bangla 2nd Paper' },
    somas: { id: 'somas-exact-native-v1', category: 'বাংলা', path: './courses/somas/index.html', hash: '02bc032b62c12ed852690b0a0017c270350ea47f2f7ad7143b15423c1df3b4d4', label: 'সমাস', title: 'সমাস, University Admission Master Guide', subtitle: 'Visual University Admission Master Guide · Bangla 2nd Paper' },
    prottoy: { id: 'prottoy-exact-native-v1', category: 'বাংলা', path: './courses/prottoy/index.html', hash: '55da5a2b846b20cdd22da5f149b1216eddeb7b5eea8dfd82d8b229c167774eef', label: 'প্রত্যয়', title: 'প্রত্যয়, Visual Admission Master Guide', subtitle: 'Visual University Admission Master Guide · Bangla 2nd Paper' },
    'prottoy-master': { id: 'prottoy-master-exact-native-v1', category: 'বাংলা', path: './courses/prottoy-master/index.html', hash: 'dff4c9dbe1ed7d243cfd8de7f0c273a018eae33d5dacda1b6a404b3f8cfdecf3', label: 'প্রত্যয় Master', title: 'প্রত্যয় • Visual Admission Master Guide, Interactive', subtitle: 'Bangla 2nd Paper · 200 MCQ · Interactive guide' },
  };
  const REMOVED_ENGLISH_PREFIXES = [
    'admissionHubNativeCourseV1:english-voice-exact-native-v1',
    'admissionHubNativeCourseV1:parts-of-speech-premium-exact-native-v1',
    'admissionHubNativeCourseV1:adverb-mastery-exact-native-v1',
    'admissionHubNativeCourseV1:adjective-lab-exact-native-v1',
    'admissionHubNativeCourseV1:parts-of-speech-visual-exact-native-v1',
    'admissionHubNativeCourseV1:prepositions-master-exact-native-v1',
    'admissionHubNativeCourseV1:concord-lab-exact-native-v1',
    'admissionHubNativeCourseV1:figures-of-speech-exact-native-v1',
    'admissionHubNativeCourseV1:noun-master-exact-native-v1',
    'admissionHubNativeCourseV1:numbers-gender-exact-native-v1',
    'admissionHubNativeCourseV1:right-form-verbs-exact-native-v1'
  ];
  const purgeRemovedEnglishState = () => {
    try {
      Object.keys(localStorage).forEach(key => {
        if (key === 'english_voice_course_v2' || REMOVED_ENGLISH_PREFIXES.some(prefix => key.startsWith(prefix))) localStorage.removeItem(key);
      });
    } catch (_) {}
  };
  const courseKey = () => { const p = coursePath(); return p.startsWith('source-courses/') ? p.split('/')[1] : 'sandhi'; };
  const courseDef = () => COURSE_DEFS[courseKey()] || COURSE_DEFS.sandhi;
  const storagePrefix = () => `admissionHubNativeCourseV1:${courseDef().id}`;
  const SOURCE_STYLE_ID = 'source-course-native-style';
  const state = { payload: null, loading: null, loadingKey: null, routeMounted: false, mountedCourseKey: null, flash: null, previousTheme: null, previousBodyTheme: null, quizFilterTouched: false, quizStarted: false, seenLessons: new Set(), courseCompleted: false, lessonObserver: null, sourceListeners: [], questionSeenAt: new Map(), quizSeenAt: 0 };
  const scopedStorage = (prefix, base) => {
    const prefixed = key => `${prefix}${String(key)}`;
    const keys = () => { const out = []; for (let i = 0; i < base.length; i += 1) { const key = base.key(i); if (key && key.startsWith(prefix)) out.push(key.slice(prefix.length)); } return out; };
    const api = {
      getItem(key) { return base.getItem(prefixed(key)); },
      setItem(key, value) { base.setItem(prefixed(key), String(value)); },
      removeItem(key) { base.removeItem(prefixed(key)); },
      clear() { keys().forEach(key => base.removeItem(prefixed(key))); },
      key(index) { return keys()[Number(index)] ?? null; },
      get length() { return keys().length; }
    };
    return new Proxy(api, {
      get(target, prop) { if (prop in target) return target[prop]; if (typeof prop === 'string') return target.getItem(prop); return undefined; },
      set(target, prop, value) { if (typeof prop === 'string') { target.setItem(prop, value); return true; } return false; },
      deleteProperty(target, prop) { if (typeof prop === 'string') target.removeItem(prop); return true; }
    });
  };
  const sourceWindowProxy = (sourceStorage, sourceSessionStorage) => {
    const listeners = state.sourceListeners;
    const shadow = Object.create(null);
    return new Proxy(window, {
      get(target, prop) {
        if (prop === 'localStorage') return sourceStorage;
        if (prop === 'sessionStorage') return sourceSessionStorage;
        if (prop === 'addEventListener') return (type, listener, options) => { listeners.push({ target, type, listener, options }); target.addEventListener(type, listener, options); };
        if (prop === 'removeEventListener') return (type, listener, options) => { target.removeEventListener(type, listener, options); };
        if (Object.prototype.hasOwnProperty.call(shadow, prop)) return shadow[prop];
        const value = Reflect.get(target, prop, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
      set(target, prop, value) { shadow[prop] = value; return true; },
      deleteProperty(target, prop) { if (Object.prototype.hasOwnProperty.call(shadow, prop)) delete shadow[prop]; return true; }
    });
  };
  const sourceDocumentProxy = documentTarget => {
    const listeners = state.sourceListeners;
    return new Proxy(documentTarget, {
      get(target, prop) {
        if (prop === 'addEventListener') return (type, listener, options) => { listeners.push({ target, type, listener, options }); target.addEventListener(type, listener, options); };
        if (prop === 'removeEventListener') return (type, listener, options) => { target.removeEventListener(type, listener, options); };
        const value = Reflect.get(target, prop, target);
        return typeof value === 'function' ? value.bind(target) : value;
      }
    });
  };
  let routeCleanupInstalled = false;

  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  /* Phase 2: learning signals ride the app-wide bus; the analytics service is
   * the only consumer, so this module never imports it. */
  const track = (type, detail) => { try { window.dispatchEvent(new CustomEvent('admission:activity', { detail: { type, ...(detail || {}) } })); } catch (_) {} };
  const coursePath = () => String(location.hash.replace(/^#\/?/, '').split('?')[0] || 'dashboard');
  /* SHA-256 of a fetched course document, lowercase hex. Returns '' when the
   * browser cannot compute it (no crypto.subtle), which fails the comparison
   * above and withholds script execution, fail closed, never fail open. */
  const sha256Hex = async text => {
    try {
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
      return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
    } catch (_) { return ''; }
  };
  /* Cloudflare Pages appends its own analytics beacon to every served HTML
   * document, so the bytes the browser receives are never the bytes on disk and
   * the pinned SHA-256 below could never match in production -- every course
   * silently lost its interactivity while the tests, which read the file
   * directly, still passed. Only the injected block is removed, identified by
   * the comment markers Cloudflare wraps it in: `prottoy` legitimately ships a
   * cloudflareinsights script of its own, so matching the URL alone would
   * change the hash of an unmodified course. */
  const stripInjectedBeacon = text => String(text || '').replace(
    /<!--\s*Cloudflare Pages Analytics\s*-->[\s\S]*?<!--\s*Cloudflare Pages Analytics\s*-->/g, '');
  const isCoursePath = path => path === 'source-courses' || path.startsWith('source-courses/');
  const installRouteCleanup = () => {
    if (routeCleanupInstalled) return;
    routeCleanupInstalled = true;
    window.addEventListener('hashchange', () => {
      if (!isCoursePath(coursePath())) removeNativeState();
    });
  };
  const shell = (html, opts = {}) => {
    if (typeof window.renderShell === 'function') return window.renderShell(html, opts);
    const app = document.getElementById('app');
    if (app) app.innerHTML = html;
  };
  const read = suffix => { try { return JSON.parse(localStorage.getItem(`${storagePrefix()}:${suffix}`) || 'null'); } catch (_) { return null; } };
  const write = (suffix, value) => { try { localStorage.setItem(`${storagePrefix()}:${suffix}`, JSON.stringify(value)); } catch (_) {} };
  const quizStore = () => {
    const value = read('quiz');
    return value && typeof value === 'object' ? { index: Number(value.index) || 0, filter: value.filter || 'all', answers: value.answers || {}, revealed: value.revealed || {}, bookmarks: Array.isArray(value.bookmarks) ? value.bookmarks : [], notes: value.notes || {} } : { index: 0, filter: 'all', answers: {}, revealed: {}, bookmarks: [], notes: {} };
  };
  const sourceQuestions = () => Array.isArray(state.payload?.mcq) ? state.payload.mcq : (Array.isArray(window.__sourceCourseMCQ) ? window.__sourceCourseMCQ : []);
  const filteredQuestions = store => {
    const all = sourceQuestions();
    if (store.filter === 'basic' || store.filter === 'inter' || store.filter === 'adm' || store.filter === 'trap') return all.filter(q => q.d === store.filter);
    if (store.filter === 'unattempted') return all.filter(q => store.answers[q.id] === undefined);
    if (store.filter === 'mistakes') return all.filter(q => q.answers?.correct === false || (store.answers[q.id] !== undefined && Number(store.answers[q.id]) !== Number(q.a)));
    if (store.filter === 'bookmarked') return all.filter(q => store.bookmarks.includes(q.id));
    return all;
  };
  const qId = (q, index) => q.id || `${courseKey()}-source-q-${String(q.number || q.n || index + 1).padStart(2, '0')}`;
  const normalizeDifficulty = value => ({ BASIC: 'basic', EASY: 'basic', INTERMEDIATE: 'inter', MEDIUM: 'inter', ADMISSION: 'adm', HARD: 'adm', TRAP: 'trap' }[String(value || '').toUpperCase()] || String(value || 'basic').toLowerCase());
  const normalizeQuestions = questions => questions.map((q, index) => ({ ...q, d: normalizeDifficulty(q.d || q.lvl || q.difficulty), id: qId(q, index), number: Number(q.number || q.n || index + 1), question: q.q || q.question || q.stem || '', options: Array.isArray(q.o) ? q.o : (q.options || []), answer: Number(q.a ?? q.answer ?? 0), family: q.t || q.topic || q.cat || q.subtopic || q.examCategory || 'Source MCQ', difficulty: normalizeDifficulty(q.d || q.lvl || q.difficulty), explanation: q.e || q.explanation || q.explain || '' }));
  const questions = () => { const qs = normalizeQuestions(sourceQuestions()); if (state.payload) state.payload.mcq = qs; return qs; };

  const removeNativeState = () => {
    if (window.__sourceCourseScrollHandler) {
      window.removeEventListener('scroll', window.__sourceCourseScrollHandler);
      delete window.__sourceCourseScrollHandler;
    }
    state.sourceListeners.forEach(({ target = window, type, listener, options }) => { try { target.removeEventListener(type, listener, options); } catch (_) {} });
    state.sourceListeners = [];
    document.getElementById(SOURCE_STYLE_ID)?.remove();
    document.body.classList.remove('source-course-native-body');
    document.getElementById('app')?.classList.remove('source-course-native-app');
    document.documentElement.style.removeProperty('--source-course-active');
    if (state.previousTheme !== null) document.documentElement.setAttribute('data-theme', state.previousTheme);
    if (state.previousBodyTheme !== null) document.body.setAttribute('data-theme', state.previousBodyTheme);
    else document.body.removeAttribute('data-theme');
    state.previousTheme = null;
    state.previousBodyTheme = null;
    state.routeMounted = false;
    state.mountedCourseKey = null;
    state.flash = null;
    state.quizFilterTouched = false;
    state.quizStarted = false;
    state.seenLessons = new Set();
    state.courseCompleted = false;
    if (state.lessonObserver) { try { state.lessonObserver.disconnect(); } catch (_) {} state.lessonObserver = null; }
    delete window.__sourceCourseMCQ;
    if (window.__sourceCourseActiveKey === 'prottoy-master') delete window.G;
    delete window.__sourceCourseActiveKey;
  };

  const addSourceStyle = text => {
    document.getElementById(SOURCE_STYLE_ID)?.remove();
    const style = document.createElement('style');
    style.id = SOURCE_STYLE_ID;
    style.textContent = `${text}\n#app.source-course-native-app{max-width:100%!important;padding-bottom:0!important;margin:0!important}\n#app.source-course-native-app .page.source-course-native-page{max-width:none!important;padding:0!important;margin:0!important;overflow:visible!important}\n#app.source-course-native-app .source-native-host{position:relative;width:100%;min-height:100dvh;margin:0;padding:0}#app.source-course-native-app .topbar .source-course-inline-back{display:grid;place-items:center;width:40px;height:40px;flex:0 0 40px;padding:0;border:1px solid var(--line);border-radius:10px;background:var(--card);color:var(--text);font:800 22px/1 system-ui,sans-serif;box-shadow:0 3px 9px rgba(28,36,72,.08);cursor:pointer}.source-course-native-legacy-quiz-guard{display:none!important}\n#app.source-course-native-app .native-course-quiz-wrap{margin-top:12px}\n#app.source-course-native-app .native-course-quiz-head{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin:10px 0 14px}\n#app.source-course-native-app .native-course-quiz-head .native-course-quiz-tools{display:flex;gap:8px;flex-wrap:wrap}\n#app.source-course-native-app .native-course-quiz-head button{border:1px solid var(--line);background:var(--card);color:var(--text);padding:8px 12px;border-radius:10px;font-weight:800;cursor:pointer}\n#app.source-course-native-app .native-course-quiz-head button.primary{background:var(--brand);border-color:var(--brand);color:#fff}\n#app.source-course-native-app .native-course-quiz-filters{display:flex;gap:8px;flex-wrap:wrap;margin:0 0 14px}\n#app.source-course-native-app .native-course-quiz-filters button{border:1px solid var(--line);background:var(--card);color:var(--text);padding:7px 12px;border-radius:999px;font-size:12px;font-weight:800;cursor:pointer}\n#app.source-course-native-app .native-course-quiz-filters button.on{background:var(--brand);border-color:var(--brand);color:#fff}\n#app.source-course-native-app .native-course-quiz-nav{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-top:14px;flex-wrap:wrap}\n#app.source-course-native-app .native-course-quiz-nav button{border:1px solid var(--line);background:var(--card);color:var(--text);padding:9px 14px;border-radius:10px;font-weight:800;cursor:pointer}\n#app.source-course-native-app .native-course-quiz-nav button:disabled{opacity:.45;cursor:not-allowed}\n#app.source-course-native-app .native-course-quiz-summary{display:flex;gap:10px;flex-wrap:wrap;color:var(--muted);font-size:12px;margin:8px 0}\n#app.source-course-native-app .native-course-flash{border:1px solid color-mix(in srgb,var(--brand) 22%,var(--line));background:linear-gradient(135deg,color-mix(in srgb,var(--brand) 8%,var(--card)),var(--card));border-radius:16px;padding:15px;margin:12px 0}\n#app.source-course-native-app .native-course-flash h3{margin:0 0 4px;color:var(--ink)}\n#app.source-course-native-app .native-course-flash p{margin:0;color:var(--muted);font-size:12px}\n#app.source-course-native-app .native-course-flash-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}\n#app.source-course-native-app .native-course-flash-actions button{border:1px solid var(--line);background:var(--card);color:var(--text);padding:8px 12px;border-radius:10px;font-weight:800;cursor:pointer}\n@media(max-width:640px){#app.source-course-native-app .native-course-quiz-head{align-items:flex-start}#app.source-course-native-app .native-course-quiz-head .native-course-quiz-tools{width:100%}#app.source-course-native-app .native-course-quiz-head button{flex:1;min-width:140px}}`;
    document.head.appendChild(style);
  };

  const library = () => {
    removeNativeState();
    const grouped = Object.entries(COURSE_DEFS).reduce((all, entry) => { const category = entry[1].category || 'বাংলা'; (all[category] ||= []).push(entry); return all; }, {});
    const categorySections = Object.entries(grouped).map(([category, entries]) => `<section class="source-course-category"><div class="source-course-category-head"><span>COURSE CATEGORY</span><h2>${esc(category)} Courses</h2></div>${entries.map(([key, course]) => { const status = course.missingDependency ? 'COMPANION FILE NEEDED' : 'SOURCE-LOCKED · NATIVE COURSE'; const note = course.missingDependency ? `Supplied source preserved · missing companion: ${course.missingDependency}` : 'Original source content preserved · Native MCQ · Separate Course progress'; return `<section class="source-course-card"><div class="source-course-icon">${esc(course.label)}</div><div><span>${esc(category.toUpperCase())} · ${esc(status)}</span><h2>${esc(course.title)}</h2><p>${esc(course.subtitle)}</p><small>${esc(note)}</small></div><button class="btn" onclick="navigate('source-courses/${key}')">Open Course →</button></section>`; }).join('')}</section>`).join('');
    shell(`<main class="source-course-page"><button class="source-course-library-back" data-source-course-back type="button" onclick="navigate('dashboard')" aria-label="Dashboard-এ ফিরে যান">←</button><header class="source-course-hero"><div><span>ADMISSION HUB · SOURCE COURSE LIBRARY</span><h1>Courses Library</h1><p>বাংলা category-র supplied Courseগুলো native Admission Hub tool হিসেবে চলছে।</p></div><b>SC</b></header>${categorySections}</main>`, {title:'Courses Library'});
    const page = document.querySelector('#app .page');
    if (page) page.insertAdjacentHTML('beforeend', `<style>.source-course-page{max-width:980px;margin:0 auto;padding:18px 14px 92px;color:#173128}.source-course-library-back{display:grid;place-items:center;width:40px;height:40px;margin:0 0 10px;border:1px solid #e0e4f0;border-radius:11px;background:#fff;color:#173128;font-size:22px;cursor:pointer;box-shadow:0 4px 12px rgba(46,38,120,.07)}.source-course-hero{display:flex;justify-content:space-between;align-items:center;gap:15px;padding:25px 20px;border-radius:24px;background:linear-gradient(135deg,#eef1ff,#faf7ff);border:1px solid #ddd9ff}.source-course-hero span,.source-course-category-head>span,.source-course-card span{font-size:10px;font-weight:900;letter-spacing:.12em;color:#5846c7}.source-course-hero h1{margin:7px 0 5px;color:#20205c;font-size:32px}.source-course-hero p{margin:0;color:#657080;font-size:13px}.source-course-hero>b{display:grid;place-items:center;width:68px;height:68px;border-radius:20px;background:linear-gradient(135deg,#4f46e5,#7c3aed);color:#fff;font-size:20px}.source-course-category{margin-top:24px}.source-course-category-head{padding:0 2px}.source-course-category-head h2{margin:5px 0 10px;color:#20205c;font-size:24px}.source-course-card{display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:14px;margin-top:12px;padding:18px;border:1px solid #e0e4f0;border-radius:20px;background:#fff;box-shadow:0 10px 25px rgba(46,38,120,.07)}.source-course-icon{display:grid;place-items:center;width:58px;height:58px;border-radius:17px;background:#eeeaff;color:#5544c4;font-size:13px;font-weight:900}.source-course-card h2{margin:5px 0 4px;font-size:19px;color:#20283d}.source-course-card p{margin:0;color:#647085;font-size:12px}.source-course-card small{display:block;margin-top:9px;color:#7b8492;font-size:10px}@media(max-width:640px){.source-course-card{grid-template-columns:auto minmax(0,1fr)}.source-course-card .btn{grid-column:1/-1;width:100%}.source-course-hero h1{font-size:27px}}</style>`);
    return;
  };

  const loadSource = () => {
    const key = courseKey();
    if (state.payload?.courseKey === key) return Promise.resolve(state.payload);
    if (state.loading && state.loadingKey === key) return state.loading;
    state.payload = null;
    const def = COURSE_DEFS[key] || COURSE_DEFS.sandhi;
    const request = fetch(`${def.path}?nativeCourse=v3`, { cache: 'reload' }).then(response => {
      if (!response.ok) throw new Error(`source ${response.status}`);
      return response.text();
    }).then(async text => {
      /* The course documents are supplied files and their scripts are executed
       * with new Function() further down, which is remote code execution in the
       * app origin unless the bytes are pinned. The SHA-256 recorded in
       * COURSE_DEFS is enforced here: a document that does not match its
       * recorded hash still renders, but its scripts are never executed.
       * Update the hash in COURSE_DEFS whenever a course file legitimately
       * changes, or that course's interactivity stops. */
      /* BUG-007: an empty def.hash used to compare against '' and, if the file
       * also hashed to something, fail closed by luck. Make that explicit: a
       * course with no recorded hash is never executed, so a regression that
       * drops the hash cannot silently re-open the new Function() sink. */
      const recordedHash = String(def.hash || '').trim().toLowerCase();
      const integrityOk = recordedHash.length === 64
        && await sha256Hex(stripInjectedBeacon(text)) === recordedHash;
      if (!integrityOk) console.error(`source-course integrity mismatch for "${key}", its scripts will not run`);
      const doc = new DOMParser().parseFromString(text, 'text/html');
      const styles = Array.from(doc.querySelectorAll('style')).map(s => s.textContent || '').join('\n');
      /* Only executable scripts may be concatenated. Course pages carry a
       * `type="application/ld+json"` SEO block; feeding that to new Function()
       * threw "Unexpected token ':'" and no course would open at all. */
      const JS_TYPES = new Set(['', 'text/javascript', 'application/javascript', 'module']);
      const scripts = integrityOk ? Array.from(doc.querySelectorAll('script'))
        .filter(s => JS_TYPES.has(String(s.getAttribute('type') || '').trim().toLowerCase()))
        .map(s => s.textContent || '')
        .filter(text => !/__CF\$cv_params|cdn-cgi\/challenge-platform/.test(text))
        .join('\n') : '';
      const bodyHtml = Array.from(doc.body.childNodes).filter(node => node.nodeName !== 'SCRIPT').map(node => node.outerHTML || node.textContent || '').join('');
      const transformed = scripts
        .replace('const questions = [', 'const questions = window.__sourceCourseMCQ = [')
        .replace('var MCQ = [', 'var MCQ = window.__sourceCourseMCQ = [')
        .replace('function onScroll(){', 'function onScroll(){ if (!document.querySelector(".source-native-host")) return;')
        .replace('window.addEventListener("scroll", ()=>{\n    if(window.scrollY > 400) fab.classList.add("show"); else fab.classList.remove("show");\n  });', 'window.__sourceCourseScrollHandler = ()=>{\n    if(window.scrollY > 400) fab.classList.add("show"); else fab.classList.remove("show");\n  };')
        .replace('document.getElementById("scrollbar").style.width =', 'var sourceScrollbar = document.getElementById("scrollbar"); if (sourceScrollbar) sourceScrollbar.style.width =')
        .replace('window.addEventListener("scroll", onScroll, {passive:true});', 'window.__sourceCourseScrollHandler = onScroll; window.addEventListener("scroll", window.__sourceCourseScrollHandler, {passive:true});')
        .replace('document.addEventListener("DOMContentLoaded", function(){', 'if (document.readyState !== "loading") {')
        .replace('document.addEventListener("DOMContentLoaded", init);', 'if (document.readyState !== "loading") init(); else document.addEventListener("DOMContentLoaded", init);')
        .replace(/document\.addEventListener\(\s*(['\"])DOMContentLoaded\1\s*,\s*(?:\(\s*\)\s*=>|function\s*\([^)]*\))\s*\{/g, 'if (document.readyState !== "loading") {')
        .replace(/window\.addEventListener\(\s*(['\"])DOMContentLoaded\1\s*,\s*(?:\(\s*\)\s*=>|function\s*\([^)]*\))\s*\{/g, 'if (document.readyState !== "loading") {')
        .replace(/document\.addEventListener\((['\"])DOMContentLoaded\1/g, 'document.addEventListener("admission:source-domcontentloaded"')
        .replace(/window\.addEventListener\((['\"])load\1/g, 'window.addEventListener("admission:source-load"')
        .replace(/\n\}\);\s*$/, '\n}') + (def.bridge ? `\n${def.bridge}` : '');
      const payload = { title: doc.title, styles, scripts: transformed,
        /* Same gate as `scripts`: an unverified document must not have its markup
         * injected either, because inline handlers in that markup execute in the app
         * origin even though new Function() never runs. */
        bodyHtml: integrityOk ? bodyHtml : '',
        integrityOk, sourceHash: def.hash, mcq: [], courseKey: key, courseLabel: def.label };
      if (courseKey() === key) state.payload = payload;
      return payload;
    });
    state.loading = request;
    state.loadingKey = key;
    request.then(() => {
      if (state.loading === request) { state.loading = null; state.loadingKey = null; }
    }, () => {
      if (state.loading === request) { state.loading = null; state.loadingKey = null; }
    });
    return request;
  };

  const executeSource = payload => {
    state.previousTheme = document.documentElement.getAttribute('data-theme');
    state.previousBodyTheme = document.body.getAttribute('data-theme');
    document.documentElement.setAttribute('data-theme', 'light');
    document.body.setAttribute('data-theme', 'light');
    addSourceStyle(payload.styles);
    document.body.classList.add('source-course-native-body');
    document.getElementById('app')?.classList.add('source-course-native-app');
    document.documentElement.style.setProperty('--source-course-active', '1');
    const page = document.querySelector('#app .page');
    if (!page) throw new Error('Course page shell missing');
    page.classList.add('source-course-native-page');
    const host = page.querySelector('.source-native-host');
    if (!host) throw new Error('Course host missing');
    const sourceBack = '<button class="source-course-inline-back" type="button" aria-label="কোর্স তালিকায় ফিরে যান" title="কোর্স তালিকায় ফিরে যান" onclick="SourceCourse.exit()">←</button>';
    const sourceHtml = payload.bodyHtml.includes('class="spacer"') ? payload.bodyHtml.replace(/(<div class="spacer">)/, '$1' + sourceBack) : sourceBack + payload.bodyHtml;
    host.innerHTML = sourceHtml;
    const def = courseDef();
    if (payload.integrityOk === false) {
      host.insertAdjacentHTML('afterbegin', `<section class="card" style="margin:16px auto;max-width:860px;border:1px solid #f0c36a;background:#fff9e8;color:#5b4315"><strong>এই কোর্স ফাইলটি যাচাই করা যায়নি</strong><p style="margin:6px 0 0">ফাইলের হ্যাশ মেলেনি, তাই এর কিছুই চালানো হয়নি। কনটেন্ট বদলানো হয়ে থাকলে কোর্সটি আবার প্রকাশ করতে হবে।</p></section>`);
      state.routeMounted = true;
      state.mountedCourseKey = courseKey();
      return;
    }
    if (def.missingDependency) {
      host.insertAdjacentHTML('afterbegin', `<section class="card" style="margin:16px auto;max-width:860px;border:1px solid #f0c36a;background:#fff9e8;color:#5b4315"><strong>এই supplied source-এর companion file পাওয়া যায়নি</strong><p style="margin:6px 0 0">${esc(def.missingDependency)} ছাড়া original source-এর data ও MCQ চালু করা সম্ভব নয়। কোনো invented question যোগ করা হয়নি। companion file যোগ করলে এই Course nativeভাবে সম্পূর্ণ করা যাবে।</p></section>`);
      state.routeMounted = true;
      state.mountedCourseKey = courseKey();
      return;
    }
    if (!host.querySelector('#quiz')) host.insertAdjacentHTML('beforeend', '<section id="quiz" class="card source-course-native-quiz-section"><div class="sec-head"><h2>Native Question Bank MCQ</h2><p>Source-এর original questions · instant feedback · temporary flash test</p></div></section>');
    const sourceStorage = scopedStorage(`${storagePrefix()}:source:`, window.localStorage);
    const sourceSessionStorage = scopedStorage(`${storagePrefix()}:session:`, window.sessionStorage);
    const sourceWindow = sourceWindowProxy(sourceStorage, sourceSessionStorage);
    const sourceDocument = sourceDocumentProxy(document);
    if (payload.scripts) new Function('window', 'document', 'localStorage', 'sessionStorage', payload.scripts)(sourceWindow, sourceDocument, sourceStorage, sourceSessionStorage);
    document.dispatchEvent(new Event('admission:source-domcontentloaded'));
    window.dispatchEvent(new Event('admission:source-load'));
    payload.mcq = normalizeQuestions(sourceWindow.__sourceCourseMCQ || []);
    replaceQuizSection(payload.mcq);
    installLessonTracking(host);
    state.routeMounted = true;
    state.mountedCourseKey = courseKey();
  };

  const setQuizStore = value => write('quiz', value);
  const answerCount = store => Object.keys(store.answers || {}).length;
  const correctCount = store => questions().filter(q => store.answers[q.id] !== undefined && Number(store.answers[q.id]) === q.answer).length;
  const qbankCard = (q, store, position, total, mode = 'course') => {
    const selected = store.answers[q.id];
    const revealed = selected !== undefined || !!store.revealed[q.id];
    const correct = Number(selected) === Number(q.answer);
    const status = selected === undefined ? (store.revealed[q.id] ? 'Revealed' : 'Unattempted') : (correct ? 'Correct' : 'Wrong');
    const statusClass = selected === undefined ? 'unattempted' : (correct ? 'correct' : 'wrong');
    const opts = q.options.map((option, index) => {
      const isCorrect = revealed && index === q.answer;
      const isWrong = selected !== undefined && index === Number(selected) && !isCorrect;
      const cls = isCorrect ? 'correct' : isWrong ? 'wrong' : '';
      return `<button class="q-opt-v2 ${cls}" type="button" ${revealed ? 'disabled' : ''} aria-label="Option ${String.fromCharCode(65 + index)}" onclick="SourceCourse.answer('${esc(q.id)}',${index},'${mode}')"><span class="q-opt-letter">${String.fromCharCode(65 + index)}</span><span class="q-opt-text">${esc(option)}</span>${isCorrect ? '<span class="q-opt-icon">✓</span>' : isWrong ? '<span class="q-opt-icon">✕</span>' : ''}</button>`;
    }).join('');
    const explanation = revealed ? `<div class="q-explanation-v2 ${selected === undefined ? 'revealed' : correct ? 'correct' : 'wrong'}"><strong>${selected === undefined ? 'Answer revealed' : correct ? '✓ Correct' : '✕ Wrong'}</strong><p>Correct answer: ${esc(q.options[q.answer] || '')}</p>${q.explanation ? `<p>${esc(q.explanation)}</p>` : ''}</div>` : '';
    const isBookmarked = store.bookmarks.includes(q.id);
    const note = store.notes[q.id] || '';
    return `<article class="q-card-v2 card" data-qid="${esc(q.id)}"><div class="q-card-header"><div class="q-card-meta"><span class="q-card-num">Q ${String(q.number).padStart(2, '0')}</span><span class="q-breadcrumb">${esc(courseDef().label)} • ${esc(q.family)}</span></div><span class="q-status ${statusClass}">${status}</span></div><div class="q-text-v2">${esc(q.question)}</div><div class="q-options-v2">${opts}</div>${explanation}<footer class="q-card-footer"><span>Accuracy <strong>${answerCount(store) ? Math.round(correctCount(store) / answerCount(store) * 100) : 0}%</strong></span><span>Mistakes <strong>${questions().filter(x => store.answers[x.id] !== undefined && Number(store.answers[x.id]) !== x.answer).length}</strong></span>${mode === 'course' ? `<button class="q-footer-btn ${isBookmarked ? 'active' : ''}" type="button" aria-pressed="${isBookmarked}" onclick="SourceCourse.bookmark('${esc(q.id)}','course')">⭐ ${isBookmarked ? 'Bookmarked' : 'Bookmark'}</button>${!revealed ? `<button class="q-footer-btn" type="button" onclick="SourceCourse.reveal('${esc(q.id)}','course')">Show Answer</button>` : ''}<button class="q-footer-btn" type="button" onclick="SourceCourse.note('${esc(q.id)}','course')">✎ Note</button>` : ''}</footer>${note ? `<div class="q-note">✎ ${esc(note)}</div>` : ''}<small style="display:block;margin-top:10px;color:var(--sub);font-size:11px">Source: supplied ${esc(courseDef().label)} Course · Question ${String(q.number).padStart(2, '0')}</small></article>`;
  };

  const nativeQuiz = mcqs => {
    const store = quizStore();
    let visible = filteredQuestions(store);
    if (!visible.length && store.filter !== 'all' && !state.quizFilterTouched) {
      store.filter = 'all';
      store.index = 0;
      setQuizStore(store);
      visible = filteredQuestions(store);
    }
    const filters = [['all','সব'],['basic','Basic'],['inter','Intermediate'],['adm','Admission'],['trap','Trap'],['mistakes','Mistakes'],['bookmarked','Bookmarked']];
    const result = `<div class="native-course-quiz-summary"><span>${answerCount(store)}/${mcqs.length} answered</span><span>${correctCount(store)} correct</span><span>${mcqs.length ? Math.round(correctCount(store) / Math.max(1, answerCount(store)) * 100) : 0}% accuracy</span></div>`;
    const header = `<div class="native-course-quiz-head"><div><b>Native Question Bank MCQ Engine</b><div class="muted">Four-option card, instant feedback, bookmark, note ও result</div></div><div class="native-course-quiz-tools"><button class="primary" type="button" onclick="SourceCourse.startFlash()">⚡ Temporary Flash Test</button></div></div>`;
    const filterBar = `<div class="native-course-quiz-filters">${filters.map(([key,label]) => `<button class="${store.filter === key ? 'on' : ''}" type="button" onclick="SourceCourse.filter('${key}')">${label}</button>`).join('')}</div>`;
    if (!visible.length) return `<div class="native-course-quiz-wrap">${header}${filterBar}${result}<div class="card empty">এই filter-এ কোনো প্রশ্ন নেই।<br><button type="button" style="margin-top:10px;border:1px solid var(--line);background:var(--card);color:var(--text);padding:8px 12px;border-radius:10px;font-weight:800;cursor:pointer" onclick="SourceCourse.filter('all')">সব ${mcqs.length}টি প্রশ্ন দেখুন</button></div></div>`;
    store.index = Math.min(Math.max(0, Number(store.index) || 0), visible.length - 1);
    const q = visible[store.index];
    return `<div class="native-course-quiz-wrap">${header}${filterBar}${result}${qbankCard(q, store, store.index, visible.length)}<div class="native-course-quiz-nav"><button type="button" ${store.index === 0 ? 'disabled' : ''} onclick="SourceCourse.prev()">← Previous</button><span>Question ${store.index + 1} of ${visible.length}</span><button type="button" onclick="SourceCourse.next()">${store.index === visible.length - 1 ? 'See Result →' : 'Next →'}</button></div></div>`;
  };

  const flashCard = () => {
    const f = state.flash;
    if (!f) return '';
    const q = f.questions[f.index];
    const selected = f.answers[q.id];
    const revealed = selected !== undefined;
    const store = { answers: f.answers, revealed: {}, bookmarks: [], notes: {} };
    return `<div class="native-course-flash"><h3>⚡ Temporary Flash Test</h3><p>এই round-এর কোনো answer, result, progress বা bookmark save হবে না।</p><div class="native-course-flash-actions"><button type="button" onclick="SourceCourse.exitFlash()">Exit Flash Test</button></div></div>${qbankCard(q, store, f.index, f.questions.length, 'flash')}<div class="native-course-quiz-nav"><button type="button" ${f.index === 0 ? 'disabled' : ''} onclick="SourceCourse.flashPrev()">← Previous</button><span>Flash ${f.index + 1} of ${f.questions.length}</span><button type="button" onclick="SourceCourse.flashNext()">${f.index === f.questions.length - 1 ? 'Finish' : 'Next →'}</button></div>`;
  };

  /* Phase 2 M2: the supplied course HTML ships real lesson sections
   * (`section.lesson-sec#lessonN`) and its own "পড়া শেষ" buttons
   * (`button.done-btn[data-lesson]`). We never re-implement completion, we
   * observe the source's own UI and mirror it onto the analytics bus. */
  const installLessonTracking = host => {
    const sections = Array.from(host.querySelectorAll('section.lesson-sec[id]'));
    if (!sections.length) return;
    const lessonOf = el => {
      const id = el.getAttribute('data-lesson') || el.id || '';
      const m = /(\d+)\s*$/.exec(id);
      return { lessonId: id, lessonNumber: m ? Number(m[1]) : undefined };
    };
    const firstSeenAt = new Map();
    const markViewed = el => {
      const { lessonId, lessonNumber } = lessonOf(el);
      if (!lessonId || firstSeenAt.has(lessonId)) return;
      firstSeenAt.set(lessonId, Date.now());
      if (!state.seenLessons.has(lessonId)) state.seenLessons.add(lessonId);
      track('LESSON_VIEW', { courseId: courseDef().id, lessonId, lessonNumber });
      track('LESSON_START', { courseId: courseDef().id, lessonId, lessonNumber });
    };
    if (typeof IntersectionObserver === 'function') {
      /* threshold must be 0: a lesson section is routinely taller than the
       * viewport (thousands of px), so any ratio > 0 with a shrunken root can
       * never be reached and the event would never fire on a real phone. */
      state.lessonObserver = new IntersectionObserver(entries => {
        entries.forEach(entry => { if (entry.isIntersecting) markViewed(entry.target); });
      }, { rootMargin: '0px 0px -25% 0px', threshold: 0 });
      sections.forEach(section => state.lessonObserver.observe(section));
    } else {
      sections.forEach(markViewed); // no observer (old browser / test DOM), count as viewed
    }
    /* Delegated: the source's own handler toggles `.on` first, so reading the
     * class in the bubble phase reflects the post-click state. */
    const onClick = event => {
      const btn = event.target && event.target.closest ? event.target.closest('.done-btn[data-lesson]') : null;
      if (!btn || !host.contains(btn) || !btn.classList.contains('on')) return;
      const { lessonId, lessonNumber } = lessonOf(btn);
      const seenAt = firstSeenAt.get(lessonId);
      track('LESSON_COMPLETE', {
        courseId: courseDef().id,
        lessonId,
        lessonNumber,
        completionPercent: 100,
        duration: seenAt ? Math.round((Date.now() - seenAt) / 1000) : undefined
      });
      const total = sections.length;
      const done = host.querySelectorAll('.done-btn[data-lesson].on').length;
      if (total && done >= total && !state.courseCompleted) {
        state.courseCompleted = true;
        track('COURSE_COMPLETE', { courseId: courseDef().id, courseType: 'source', lessonCount: total, completionPercent: 100 });
      }
    };
    host.addEventListener('click', onClick);
    state.sourceListeners.push({ target: host, type: 'click', listener: onClick });
  };

  const renderNativeQuiz = () => {
    const qSection = document.getElementById('quiz');
    if (!qSection) return;
    if (!state.flash && !state.quizStarted) { state.quizStarted = true; state.quizSeenAt = Date.now(); track('QUIZ_START', { quizId: courseDef().id + ':course', quizType: 'practice', questionCount: questions().length }); }
    /* Stamp when the question currently on screen became visible, so the
     * duration riding QUESTION_ATTEMPT is real think-time, not zero. */
    if (!state.flash) {
      const store = quizStore();
      const visible = filteredQuestions(store);
      const current = visible[Math.min(Math.max(0, Number(store.index) || 0), Math.max(0, visible.length - 1))];
      if (current && !state.questionSeenAt.has(current.id)) state.questionSeenAt.set(current.id, Date.now());
    }
    const heading = qSection.querySelector('.sec-head')?.outerHTML || '';
    const current = state.flash ? flashCard() : nativeQuiz(questions());
    const legacyGuard = `<div class="source-course-native-legacy-quiz-guard" aria-hidden="true"><div id="qCard"><div id="qMeta"></div><div id="qText"></div><div id="qOpts"></div><div id="qExplain"></div><button id="qPrev"></button><button id="qNext"></button><button id="quizReset"></button><span id="scCorrect"></span><span id="scWrong"></span><span id="scLeft"></span><span id="pbarFill"></span><div id="qGrid"></div></div></div>`;
    qSection.innerHTML = `${heading}${legacyGuard}<div id="nativeCourseQuizMount">${current}</div>`;
  };

  const replaceQuizSection = mcqs => {
    const qSection = document.getElementById('quiz');
    if (!qSection) return;
    const heading = qSection.querySelector('.sec-head')?.outerHTML || '';
    const legacyGuard = `<div class="source-course-native-legacy-quiz-guard" aria-hidden="true"><div id="qCard"><div id="qMeta"></div><div id="qText"></div><div id="qOpts"></div><div id="qExplain"></div><button id="qPrev"></button><button id="qNext"></button><button id="quizReset"></button><span id="scCorrect"></span><span id="scWrong"></span><span id="scLeft"></span><span id="pbarFill"></span><div id="qGrid"></div></div></div>`;
    state.quizFilterTouched = false;
    qSection.innerHTML = `${heading}${legacyGuard}<div id="nativeCourseQuizMount"></div>`;
    renderNativeQuiz(mcqs);
  };

  const mount = payload => {
    removeNativeState();
    shell(`<div class="source-native-host" aria-label="${esc(courseDef().label)} Course"></div>`, { topbar: false, hideNav: true, title: '' });
    executeSource(payload);
  };

  const open = () => {
    const key = courseKey();
    if (state.routeMounted && state.mountedCourseKey === key && document.querySelector('.source-native-host')) return true;
    /* Phase 2: opening a course is a view; entering its quiz set is a start. */
    track('COURSE_VIEW', { courseId: courseDef().id, courseType: 'source' });
    track('COURSE_START', { courseId: courseDef().id });
    shell('<div class="source-native-loading" style="min-height:100dvh;display:grid;place-items:center;padding:20px;text-align:center">Opening source course…</div>', { topbar: false, hideNav: true, title: '' });
    loadSource().then(payload => {
      if (courseKey() !== key || coursePath() !== `source-courses/${key}`) return;
      mount(payload);
    }).catch(error => {
      if (courseKey() !== key || coursePath() !== `source-courses/${key}`) return;
      console.error('Source course failed', error);
      shell(`<div style="min-height:100dvh;display:grid;place-items:center;padding:24px;text-align:center"><div style="max-width:420px"><p style="font-size:15px;line-height:1.75;margin:0 0 16px">কোর্সটি লোড করা যায়নি। ইন্টারনেট সংযোগ দেখে আবার চেষ্টা করো।</p><button class="btn" onclick="SourceCourse.retry()">আবার চেষ্টা করুন</button> <button class="btn secondary" onclick="navigate('source-courses')">কোর্স লিস্ট</button></div></div>`, { topbar: false, hideNav: true, title: '' });
    });
    return true;
  };

  const render = () => {
    purgeRemovedEnglishState();
    const p = coursePath();
    if (p === 'source-courses') { library(); return true; }
    if (p.startsWith('source-courses/') && COURSE_DEFS[courseKey()]) { return open(); }
    if (p.startsWith('source-courses/')) { location.hash = '#source-courses'; return true; }
    removeNativeState();
    return false;
  };

  installRouteCleanup();

  window.SourceCourse = {
    exit() { state.flash = null; navigate('source-courses'); },
    retry() { state.payload = null; state.loading = null; state.loadingKey = null; state.routeMounted = false; state.mountedCourseKey = null; removeNativeState(); render(); },
    answer(qid, option, mode = 'course') {
      if (mode === 'flash') {
        if (!state.flash || state.flash.answers[qid] !== undefined) return;
        state.flash.answers[qid] = Number(option); renderNativeQuiz(); return;
      }
      const store = quizStore(); if (store.answers[qid] !== undefined) return;
      /* M3: the course's own MCQ engine answers questions too, not just the exam
       * engine. Mirror the attempt onto the bus so question_attempt is complete
       * for every quiz surface. The answer text is never sent, only which
       * question and whether it was right. */
      const q = questions().find(item => item.id === qid);
      const seenAt = state.questionSeenAt.get(qid);
      track('QUESTION_ATTEMPT', {
        quizId: `${courseDef().id}:course`,
        questionId: qid,
        quizType: 'practice',
        correct: q ? Number(option) === Number(q.answer) : undefined,
        duration: seenAt ? Math.round((Date.now() - seenAt) / 1000) : undefined,
        questionNumber: q ? q.number : undefined,
        subjectId: courseDef().id,
        topicId: q ? q.family : undefined,
        attemptNo: 1,
        mode: 'course'
      });
      store.answers[qid] = Number(option); store.revealed[qid] = true; setQuizStore(store); renderNativeQuiz();
    },
    bookmark(qid, mode = 'course') {
      if (mode === 'flash') return;
      const store = quizStore(); store.bookmarks = store.bookmarks.includes(qid) ? store.bookmarks.filter(id => id !== qid) : [...store.bookmarks, qid]; setQuizStore(store); renderNativeQuiz();
    },
    note(qid, mode = 'course') {
      if (mode === 'flash') return;
      const store = quizStore(); const value = window.prompt('এই প্রশ্নের note লিখুন', store.notes[qid] || ''); if (value !== null) { store.notes[qid] = value.trim(); setQuizStore(store); renderNativeQuiz(); }
    },
    reveal(qid, mode = 'course') {
      if (mode === 'flash') return;
      const store = quizStore(); store.revealed[qid] = true; setQuizStore(store); renderNativeQuiz();
    },
    filter(value) { state.quizFilterTouched = true; const store = quizStore(); store.filter = value; store.index = 0; setQuizStore(store); renderNativeQuiz(); },
    prev() { const store = quizStore(); store.index = Math.max(0, store.index - 1); setQuizStore(store); renderNativeQuiz(); },
    next() { const store = quizStore(); const visible = filteredQuestions(store); if (store.index >= visible.length - 1) { renderResult(); return; } store.index += 1; setQuizStore(store); renderNativeQuiz(); },
    startFlash() { const all = questions().slice().sort(() => Math.random() - 0.5); state.flash = { questions: all.slice(0, Math.min(20, all.length)), index: 0, answers: {} }; renderNativeQuiz(); },
    exitFlash() { state.flash = null; renderNativeQuiz(); },
    flashPrev() { if (!state.flash) return; state.flash.index = Math.max(0, state.flash.index - 1); renderNativeQuiz(); },
    flashNext() { if (!state.flash) return; if (state.flash.index >= state.flash.questions.length - 1) { renderFlashResult(); return; } state.flash.index += 1; renderNativeQuiz(); },
    reset() { write('quiz', { index: 0, filter: 'all', answers: {}, revealed: {}, bookmarks: [], notes: {} }); renderNativeQuiz(); }
  };

  function renderResult() {
    const store = quizStore(); const qs = questions(); const answered = answerCount(store); const correct = correctCount(store); const wrong = qs.filter(q => store.answers[q.id] !== undefined && Number(store.answers[q.id]) !== q.answer).length; const skipped = qs.length - answered; const accuracy = answered ? Math.round(correct / answered * 100) : 0;
    /* The course MCQ result is a real quiz completion, not the temporary flash
     * test: it persists, so it carries quiz_complete with the attempt duration
     * measured from quiz_start. */
    track('QUIZ_COMPLETE', { quizId: `${courseDef().id}:course`, questionCount: qs.length, correct, wrong, skipped, accuracy, quizType: 'practice', duration: state.quizSeenAt ? Math.round((Date.now() - state.quizSeenAt) / 1000) : undefined });
    const mountPoint = document.getElementById('nativeCourseQuizMount'); if (!mountPoint) return;
    mountPoint.innerHTML = `<section class="card"><div class="kicker">NATIVE QUESTION BANK RESULT</div><h3>${esc(courseDef().label)} MCQ Result</h3><div class="stats"><div class="stat"><div class="n">${accuracy}%</div><div class="l">Accuracy</div></div><div class="stat"><div class="n">${correct}</div><div class="l">Correct</div></div><div class="stat"><div class="n">${wrong}</div><div class="l">Wrong</div></div><div class="stat"><div class="n">${skipped}</div><div class="l">Skipped</div></div></div><div class="native-course-flash-actions"><button class="btn" type="button" onclick="SourceCourse.reset()">Retry MCQ</button><button class="btn secondary" type="button" onclick="document.getElementById('quiz')?.scrollIntoView({behavior:'smooth'})">Back to Quiz</button></div></section>`;
  }

  function renderFlashResult() {
    const f = state.flash; if (!f) return;
    const correct = f.questions.filter(q => f.answers[q.id] !== undefined && Number(f.answers[q.id]) === q.answer).length; const answered = Object.keys(f.answers).length; const accuracy = answered ? Math.round(correct / answered * 100) : 0; const mountPoint = document.getElementById('nativeCourseQuizMount'); if (!mountPoint) return;
    mountPoint.innerHTML = `<section class="card"><div class="kicker">TEMPORARY FLASH RESULT</div><h3>${esc(courseDef().label)} Flash Test শেষ</h3><div class="stats"><div class="stat"><div class="n">${accuracy}%</div><div class="l">Accuracy</div></div><div class="stat"><div class="n">${correct}</div><div class="l">Correct</div></div><div class="stat"><div class="n">${f.questions.length - correct}</div><div class="l">Wrong/Skipped</div></div></div><p class="muted">এই result save করা হয়নি এবং Course progress বা Question Bank-এ যোগ হয়নি।</p><div class="native-course-flash-actions"><button class="btn" type="button" onclick="SourceCourse.startFlash()">New Temporary Flash Test</button><button class="btn secondary" type="button" onclick="SourceCourse.exitFlash()">Back to Course MCQ</button></div></section>`;
  }

  window.addEventListener('hashchange', () => {
    if (!isCoursePath(coursePath())) removeNativeState();
  }, { passive: true });
  window.renderSourceCourseTool = render;
})();
