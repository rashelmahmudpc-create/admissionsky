#!/usr/bin/env node
/* Build the backend-wired Profile V2 page from the owner's static UI.

   Source (never edited): design/profile-v2-source.html
   Output: profile-v2.html

   The owner's markup, CSS and UI script are copied verbatim EXCEPT for the
   demo defaults he explicitly asked to remove. A small adapter is appended
   that feeds the real per-student profile and wires every action back to the
   existing backend. Run:  node scripts/build-profile-v2.mjs
*/
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
/* The design is vendored so the build runs anywhere (CI included). The
   sandbox-only copy is kept as a fallback for the session that produced it. */
const CANDIDATES = [
  join(root, 'design', 'profile-v2-source.html'),
  '/workspace/backups/profile-ui-2026-10-17/new-profile-ui.html',
];
const SRC = CANDIDATES.find((p) => existsSync(p));
if (!SRC) throw new Error(`build-profile-v2: source design not found in ${CANDIDATES.join(', ')}`);

const raw = readFileSync(SRC, 'utf8');
const pick = (re) => {
  const m = raw.match(re);
  if (!m) throw new Error(`build-profile-v2: pattern not found: ${re}`);
  return m[1];
};

let markup = pick(/<body[^>]*>([\s\S]*?)<\/body>/);
markup = markup.slice(0, markup.indexOf('<script'));
// The author left head-only tags inside <body>; strip them.
markup = markup
  .replace(/<title>[\s\S]*?<\/title>/g, '')
  .replace(/<meta\b[^>]*>/g, '')
  .replace(/<link\b[^>]*>/g, '');
// The author's stylesheet also sits at the top of <body>; it is hoisted into
// <head> below, so drop the copy here rather than shipping it twice.
markup = markup.replace(/<style[^>]*>[\s\S]*?<\/style>/g, '');
markup = markup.trim();

const styles = [...raw.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]);
const css = styles[1];
const uiScript = pick(/<script[^>]*>([\s\S]*?)<\/script>/);

/* ---- text size: the app is an app, not a website ---------------------- */
/* Pinch-zoom is off by owner order (2026-10-22), so text size is a setting.
   The scale lives in --ah-ts, set on this page's own :root by the boot block
   below and by the settings sheet. The parent document (index.html) runs the
   same engine and shares the localStorage key, so the choice survives a reload
   and stays in step between the shell and this frame. Inputs keep a 16px floor:
   below that iOS Safari zooms the whole page on focus, which is the exact bug
   the shell's guard exists for. */
const tsPx = (m) => `font-size:calc(${m[1]}px * var(--ah-ts,1))`;

const INPUT_RE = /(^|[,\s{])(input|textarea|select|\.inp)\b/;
const cssSized = css.replace(/([^{}]*)\{([^{}]*)\}/g, (rule, sel, body) => {
  const floor = INPUT_RE.test(sel);
  const sized = body.replace(
    /font-size:([0-9.]+)px/g,
    (m, px) => (floor ? `font-size:max(16px,calc(${px}px * var(--ah-ts,1)))` : tsPx(m))
  );
  return sel + '{' + sized + '}';
});

const TS_ROW =
  "srow('tsize','device','\u099f\u09c7\u0995\u09cd\u09b8\u099f \u09b8\u09be\u0987\u099c'," +
  "(function(){try{var v=parseFloat(localStorage.getItem('ah-textscale'));" +
  "return v===0.9?'\u099b\u09cb\u099f':v===1.15?'\u09ac\u09a1\u09bc':v===1.3?'\u09b8\u09ac\u099a\u09c7\u09df\u09c7 \u09ac\u09a1\u09bc':'\u09b8\u09cd\u09ac\u09be\u09ad\u09be\u09ac\u09bf\u0995'}" +
  "catch(_){return '\u09b8\u09cd\u09ac\u09be\u09ad\u09be\u09ac\u09bf\u0995'}})()," +
  "'rgba(18,162,125,.14)','#12A27D')+\n  ";

const TS_SHEET = `
function sheetTextSize(){
  var STEPS=[['small',0.9,'\u099b\u09cb\u099f'],['normal',1,'\u09b8\u09cd\u09ac\u09be\u09ad\u09be\u09ac\u09bf\u0995'],['large',1.15,'\u09ac\u09a1\u09bc'],['xlarge',1.3,'\u09b8\u09ac\u099a\u09c7\u09df\u09c7 \u09ac\u09a1\u09bc']];
  function cur(){try{var v=parseFloat(localStorage.getItem('ah-textscale'));return STEPS.some(function(s){return s[1]===v})?v:1}catch(_){return 1}}
  var v=cur();
  openSheet({title:'\u099f\u09c7\u0995\u09cd\u09b8\u099f \u09b8\u09be\u0987\u099c',sub:'\u09b2\u09c7\u0996\u09be \u0995\u09a4 \u09ac\u09a1\u09bc \u09a6\u09c7\u0996\u09ac\u09c7\u0964',
   body:'<div class="opts" id="tsopts">'+STEPS.map(function(s){return '<button type="button" class="opt'+(v===s[1]?' on':'')+'" data-v="'+s[1]+'" aria-pressed="'+(v===s[1])+'">'+s[2]+'</button>'}).join('')+'</div>',
   foot:false,
   mount:function(r){$$('.opt',r).forEach(function(b){b.onclick=function(){
     var val=parseFloat(b.dataset.v);
     try{localStorage.setItem('ah-textscale',String(val))}catch(_){}
     try{document.documentElement.style.setProperty('--ah-ts',String(val))}catch(_){}
     try{if(window.parent&&window.parent.AhTextScale)window.parent.AhTextScale.set(val)}catch(_){}
     closeSheet();toast('\u099f\u09c7\u0995\u09cd\u09b8\u099f \u09b8\u09be\u0987\u099c \u09ac\u09a6\u09b2\u09c7\u099b\u09c7')}})}})}
`;

const TS_BOOT =
  "(function(){try{var v=parseFloat(localStorage.getItem('ah-textscale'));" +
  "if(v===0.9||v===1||v===1.15||v===1.3)document.documentElement.style.setProperty('--ah-ts',String(v))}catch(_){}})();";

/* ---- strip the demo data the owner asked to be gone ------------------- */
let script = uiScript;

// 1. Blank the hardcoded person. Every field the backend owns starts empty so
//    nothing fake can ever paint, and completion honestly reads 0/10.
const demoStart = script.indexOf('var P=Object.assign({');
const demoEnd = script.indexOf('window.PROFILE_DATA||{})', demoStart);
if (demoStart < 0 || demoEnd < 0) throw new Error('demo P block not found');
script =
  script.slice(0, demoStart) +
  "var P=Object.assign({name:'',ahid:'',email:'',mobile:'',dob:'',school:'',college:'',bio:''," +
  "session:'',targets:[],goal:'',subjects:[],avatarSet:false,lang:'বাংলা'," +
  "ai:{lang:'বাংলা',tone:'Friendly',depth:'Balanced'},pub:false,avatar:0,photo:'',theme:'auto'}," +
  script.slice(demoEnd);

// 2. Real study numbers instead of the 266 sample. The adapter sets
//    window.PROFILE_STATS from the same CACHE the rest of the app reads;
//    with no data the counters honestly stay at zero.
script = script.replace(
  'var SAMPLE={solved:266,mockDone:true};',
  'var SAMPLE=window.PROFILE_STATS||{solved:0,mockDone:false};'
);
if (script.includes("solved:266")) throw new Error('SAMPLE demo value still present');

/* ---- text size, wired into the owner's own script ---------------------- */
if (!script.includes("srow('sec','shield'")) throw new Error('settings rows not found');
script = script.replace("srow('sec','shield'", TS_ROW + "srow('sec','shield'");

if (!script.includes("else if(k==='sec')openPage('pSec');"))
  throw new Error('settings tap handler not found');
script = script.replace(
  "else if(k==='sec')openPage('pSec');",
  "else if(k==='sec')openPage('pSec');else if(k==='tsize')sheetTextSize();"
);

if (!script.includes('function applyTheme(')) throw new Error('applyTheme not found');
script = script.replace('function applyTheme(', TS_SHEET + '\nfunction applyTheme(');
script = script.trimEnd() + '\n' + TS_BOOT + '\n';

/* ---- adapter: real data in, real actions out ------------------------- */
/* Split in two: the SEED must run before the owner's UI script, because that
   script reads window.PROFILE_DATA / window.PROFILE_STATS at parse time. The
   WIRING runs after, once the UI's own functions exist. */
const shared = `
  var API = '/api/auth/v1';
  var PREF_KEY = 'as.profile.v4';

  /* 30 days (owner rule, 2026-10-17): a cached profile paints instantly on
     every visit until the student edits it; past 30 days it counts as stale, so
     a change made on another device cannot show on this one forever. */
  var PROFILE_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
  var CACHE_PREFIX = 'ah-profile-cache:';
  var CACHE_KEY = 'ah-profile-cache-key';

  function readCache() {
    try {
      var pid = localStorage.getItem(CACHE_KEY);
      if (!pid) return null;
      var raw = localStorage.getItem(CACHE_PREFIX + pid);
      if (!raw) return null;
      var entry = JSON.parse(raw);
      if (!entry || !entry.profile || entry.publicId !== pid) return null;
      if ((Date.now() - (entry.ts || 0)) > PROFILE_CACHE_TTL_MS) return null;
      return entry;
    } catch (_) { return null; }
  }

  /* The WRITE side of the cache above. profile-ui.js owned this, but the v2
     mount replaces renderProfilePage before that module's boot runs, so on this
     route nothing ever wrote it, the read above always missed and every tap on
     the profile tab re-fetched and re-painted from scratch. That is the owner's
     "বারবার লোডিং" (report 2026-10-17). The entry shape matches profile-ui's
     profileCacheWrite so the two modules never disagree about a cached profile. */
  function writeCache(entry) {
    try {
      if (!entry || !entry.publicId || !entry.profile) return;
      var prev = null;
      try { prev = JSON.parse(localStorage.getItem(CACHE_PREFIX + entry.publicId) || 'null'); } catch (_) {}
      /* A patch response carries the profile only, so anything it omits keeps
         the last known value. Caching present:false here would drop the photo
         and the dashboard header would fall back to the mascot after every
         edit, until the next full read put it back. */
      var keep = function (value, fallback) {
        return (value === undefined || value === null) ? fallback : value;
      };
      var av = keep(entry.avatar, null) || keep(prev && prev.avatar, null) || { present: false };
      localStorage.setItem(CACHE_PREFIX + entry.publicId, JSON.stringify({
        publicId: entry.publicId,
        email: keep(entry.email, prev && prev.email),
        profile: entry.profile,
        completion: keep(entry.completion, prev && prev.completion),
        context: keep(entry.context, prev && prev.context),
        avatar: av,
        avatarUrl: keep(entry.avatarUrl, prev && prev.avatarUrl),
        joinedYear: keep(entry.joinedYear, prev && prev.joinedYear),
        ts: Date.now()
      }));
      localStorage.setItem(CACHE_KEY, String(entry.publicId));
    } catch (_) {}
  }

  /* The app's mode -> this UI's theme. Everything except an explicit 'dark'
     maps to 'auto', never to 'light'. The app's light mode REMOVES data-theme
     and lets its own prefers-color-scheme rule decide, so a phone in dark mode
     paints the dashboard dark; the same rule is what this design keys off.
     Pinning 'light' here made the profile lighter than the dashboard on exactly
     those phones (owner report, 2026-10-16). 'green' has no equivalent in this
     UI, so it follows the phone too, which is also what the dashboard does. */
  function themeForUi() {
    var mode = '';
    try {
      mode = (window.AhAppearance && window.AhAppearance.get && window.AhAppearance.get()) ||
        localStorage.getItem('ah-appearance') || window.__AH_THEME__ || '';
    } catch (_) {}
    if (!mode) {
      try { mode = document.documentElement.getAttribute('data-theme') || ''; } catch (_) {}
    }
    return mode === 'dark' ? 'dark' : 'auto';
  }
  function themeForApp(mode) {
    if (mode === 'dark') return 'dark';
    if (mode === 'light') return 'light';
    return 'system';
  }

  /* Backend field names -> this UI's field names. */
  function mapProfile(entry) {
    var p = (entry && entry.profile) || {};
    var school = p.school || null;
    var higher = p.higherInstitution || null;
    var av = entry && entry.avatar;
    return {
      name: p.fullName || '',
      ahid: entry.publicId || '',
      email: entry.email || '',
      mobile: p.mobile || '',
      dob: p.dob || '',
      school: (school && school.name) || '',
      college: (higher && higher.name) || '',
      bio: p.bio || '',
      session: p.admissionSession || '',
      goal: p.academicGoal || '',
      targets: Array.isArray(p.targets) ? p.targets.map(function (t) {
        return typeof t === 'string' ? t : (t && (t.name || t.unit)) || '';
      }).filter(Boolean) : [],
      subjects: Array.isArray(p.subjects) ? p.subjects.map(function (s) {
        return typeof s === 'string' ? s : (s && s.name) || '';
      }).filter(Boolean) : [],
      pub: p.visibility === 'public',
      avatarSet: !!(av && av.present),
      photo: (av && av.present) ? (API + '/profile/avatar?v=' + (av.updatedAt || 0)) : '',
      theme: themeForUi()
    };
  }

  /* Real study numbers, from the same CACHE the dashboard trusts. */
  function readStats() {
    var out = { solved: 0, mockDone: false };
    try {
      var c = window.CACHE;
      var results = (c && Array.isArray(c.examResults)) ? c.examResults : [];
      var mcqs = 0;
      for (var i = 0; i < results.length; i++) {
        var r = results[i] || {};
        mcqs += Number(r.questionCount || r.totalQuestions || (r.snapshot || []).length) || 0;
        if (r.mode === 'mock') out.mockDone = true;
      }
      out.solved = mcqs;
    } catch (_) {}
    return out;
  }

  function writePrefs(mapped) {
    try {
      var saved = {};
      try { saved = JSON.parse(localStorage.getItem(PREF_KEY) || '{}') || {}; } catch (_) {}
      // A different student on this device must never inherit the last one's
      // values: start clean when the AH-ID changes.
      if (saved.ahid && mapped.ahid && saved.ahid !== mapped.ahid) saved = {};
      localStorage.setItem(PREF_KEY, JSON.stringify(Object.assign(saved, mapped)));
    } catch (_) {}
  }

  /* The owner's UI applies its theme only at boot and on a theme tap, so a
     theme that arrives with the backend response would never reach the screen.
     Mirror it onto the document root, which is what the design's own selectors
     (:root[data-theme="dark"]) key off. */
  function applyDocTheme(theme) {
    try {
      var r = document.documentElement;
      if (theme === 'dark' || theme === 'light') r.setAttribute('data-theme', theme);
      else r.removeAttribute('data-theme');
    } catch (_) {}
  }
`;

const seed = `
/* ===== ADMISSION HUB, PROFILE DATA SEED (runs before the UI) ===== */
(function () {
  'use strict';
${shared}
  window.PROFILE_STATS = readStats();

  /* The design boots with theme 'auto' and only consults the app on a tap, so
     without this the frame paints light while the app is dark. The attribute
     covers the instant before the UI parses; the value inside PROFILE_DATA is
     what survives the UI's own applyTheme() boot, which rewrites the attribute
     from P.theme. */
  var startTheme = themeForUi();
  applyDocTheme(startTheme);
  window.PROFILE_DATA = { theme: startTheme };

  var cached = readCache();
  if (cached && cached.profile) {
    var mapped = mapProfile(cached);
    // The UI merges window.PROFILE_DATA over its defaults at parse time, so
    // seeding here means the student's own data paints on the first frame.
    window.PROFILE_DATA = Object.assign({ theme: startTheme }, mapped);
    writePrefs(mapped);
  }
})();
`;

const wiring = `
/* ===== ADMISSION HUB, PROFILE BACKEND WIRING =====
   Routes every action this UI raises back to the existing backend, and
   refreshes from the server. The UI above is the owner's design, verbatim. */
(function () {
  'use strict';
${shared}
  function push(entry) {
    if (!entry || !entry.profile) return;
    var mapped = mapProfile(entry);
    writePrefs(mapped);
    applyDocTheme(mapped.theme);
    if (typeof window.setProfile === 'function') window.setProfile(mapped);
  }

  function api(path, opts) {
    // Reject rather than throw: a synchronous throw here would escape the
    // .catch() callers and abort the whole wiring block on a WebView with no
    // fetch, leaving the page with no actions at all.
    if (typeof fetch !== 'function') return Promise.reject(new Error('fetch unavailable'));
    opts = opts || {};
    return fetch(path, Object.assign({
      credentials: 'same-origin',
      headers: opts.body ? { 'Content-Type': 'application/json' } : undefined
    }, opts)).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (body) {
        if (!res.ok) {
          var e = new Error((body && body.error && body.error.message) || 'সমস্যা হয়েছে');
          e.status = res.status; e.code = body && body.error && body.error.code;
          throw e;
        }
        return body;
      });
    });
  }

  var version = null;
  /* The profile read carries the identity and avatar that a patch response does
     not, so both are kept from the last successful read rather than re-derived. */
  var cachedIdentity = { publicId: '', email: '' };
  var lastAvatar = null;

  function loadProfile() {
    return api(API + '/profile').then(function (entry) {
      cachedIdentity = { publicId: (entry && entry.publicId) || '', email: (entry && entry.email) || '' };
      lastAvatar = (entry && entry.avatar) || null;
      push(entry);
      if (entry && entry.profile) version = entry.profile.version;
      /* Persist what the rest of the app reads: the dashboard's avatar, and the
         instant first paint on the next visit. */
      writeCache(entry);
      prefetchAvatar(entry);
      return entry;
    });
  }

  /* Warm the service worker's avatar cache as soon as the version is known, so
     the dashboard header and the next profile open paint the photo from cache
     with no network round-trip. Idempotent per version: the ?v= makes the URL
     immutable, so re-fetching the same version would be pure waste. */
  var avatarPrefetched = '';
  function prefetchAvatar(entry) {
    try {
      var av = entry && entry.avatar;
      if (!av || !av.present) return;
      var v = String(av.updatedAt || 0);
      if (avatarPrefetched === v) return;
      avatarPrefetched = v;
      var img = new Image();
      img.decoding = 'async';
      img.src = API + '/profile/avatar?v=' + v;
    } catch (_) {}
  }

  /* Send only what changed, under the backend's own field names. */
  var FIELD_MAP = {
    name: 'fullName', mobile: 'mobile', bio: 'bio', dob: 'dob',
    goal: 'academicGoal', session: 'admissionSession'
  };
  /* The backend validates every field and rejects the whole patch on one bad
     value (normalizeProfilePatch in auth-engine.mjs). Two shapes here did not
     match it, so those saves failed silently and the field snapped back:
       - session: the UI stores a label ('2026', 'এখনো ঠিক করিনি'), the backend
         wants a 4-digit year or ''. 'এখনো ঠিক করিনি' is sent as '' to clear.
       - targets: the UI keeps a plain list of university names, the backend
         wants [{ name, unit, year }] with name at least 2 characters.
     Both are converted here, in the adapter, so the owner's design stays as-is. */
  function sessionValue(value) {
    var v = String(value == null ? '' : value).trim();
    /* \\d, not \d: this code is emitted from a template literal in the builder,
       which drops a single backslash and would turn \d into a literal 'd'. */
    return /^(19|20|21)\\d{2}$/.test(v) ? v : '';
  }
  function targetList(value) {
    if (!Array.isArray(value)) return [];
    var out = [];
    for (var i = 0; i < value.length && out.length < 5; i++) {
      var raw = value[i];
      var name = String(raw == null ? '' : (raw.name || raw)).trim();
      // A 1-character name is rejected by the backend and would fail the whole
      // patch, so drop it here rather than losing the rest of the edit.
      if (name.length < 2) continue;
      out.push({ name: name.slice(0, 120), unit: '', year: '' });
    }
    return out;
  }
  /* The backend's patch validator REQUIRES mobile to match a phone pattern, so
     an empty string is rejected, unlike signup, where mobile is optional.
     A student who signed up without a number therefore had every save refused,
     and because the edit-all form sends the whole profile in one patch, one
     empty mobile lost every other edit with it. There is no way to express
     "clear the mobile" in the patch API, so the key is omitted: an omitted key
     means unchanged, which keeps the rest of the patch valid. Every other field
     accepts its empty value.
     The regex backslashes are doubled because this code is emitted from a
     template literal, which collapses a single backslash. */
  function mobileValue(value) {
    var v = String(value == null ? '' : value).trim().replace(/[\\s()-]/g, '');
    return /^\\+?[0-9]{8,15}$/.test(v) ? v : null;
  }
  function toBackend(field, value) {
    var f = FIELD_MAP[field];
    if (f) {
      if (field === 'mobile') {
        var m = mobileValue(value);
        if (m === null) return null; // nothing sendable; never a doomed patch
        return { key: f, value: m };
      }
      return { key: f, value: field === 'session' ? sessionValue(value) : value };
    }
    if (field === 'school') return { key: 'school', value: value ? { name: value } : null };
    if (field === 'college') return { key: 'higherInstitution', value: value ? { name: value } : null };
    if (field === 'targets') return { key: 'targets', value: targetList(value) };
    if (field === 'subjects') return { key: 'subjects', value: value };
    return null;
  }

  function patchFields(fields) {
    return api(API + '/profile/patch', {
      method: 'POST',
      body: JSON.stringify({ fields: fields, expectVersion: version })
    }).then(function (res) {
      if (res && res.profile) {
        version = res.profile.version;
        var next = {
          profile: res.profile,
          publicId: cachedIdentity.publicId,
          email: cachedIdentity.email,
          /* The patch response carries the profile only, so the avatar must come
             from the last good read. Taking it from localStorage instead showed
             the mascot again after every edit, the cache key it reads is
             written by the app, not by this frame. */
          avatar: lastAvatar || undefined
        };
        push(next);
        /* Owner rule: an edit shows immediately everywhere and stays cached for
           the next 30 days. Writing here is what makes the dashboard avatar and
           the next profile open correct without waiting for a re-read. */
        writeCache(next);
      }
      return res;
    });
  }

  /* Avatar upload/remove. The owner's design keeps the cropped photo in its own
     store (as.profile.v4) and dispatches the action AFTER persisting it, so the
     bytes are readable here without touching the design. The backend wants
     { mime, data } with the base64 payload only, no data: prefix, and
     validates the magic bytes itself. */
  function readPersistedPhoto() {
    try {
      var raw = localStorage.getItem('as.profile.v4');
      if (!raw) return '';
      var parsed = JSON.parse(raw);
      return (parsed && typeof parsed.photo === 'string') ? parsed.photo : '';
    } catch (_) { return ''; }
  }
  function avatarPayload(dataUrl) {
    /* The slash is escaped twice: this code lives inside a template literal in
       the builder, where \/ would collapse to / and end the regex early. */
    var m = /^data:(image\\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
    return m ? { mime: m[1], data: m[2] } : null;
  }
  function saveAvatar(dataUrl) {
    var payload = avatarPayload(dataUrl);
    if (!payload) return Promise.resolve(false);
    return api(API + '/profile/avatar', {
      method: 'POST',
      body: JSON.stringify(payload)
    }).then(function () { return loadProfile(); }).then(function () { return true; });
  }
  function dropAvatar() {
    return api(API + '/profile/avatar', { method: 'DELETE' })
      .then(function () { return loadProfile(); })
      .then(function () { return true; });
  }
  /* The design toasts "সংরক্ষণ হয়েছে" the moment a sheet closes, before the
     request finishes, so a refused save still looked successful and the field
     silently reverted on the next read. Every write now reports its own
     outcome instead of failing invisibly. The design's own toast() is private
     to its closure, so this drives the same #toast element it uses. */
  function showError(text) {
    try {
      var el = document.getElementById('toast');
      if (!el) return;
      el.textContent = text;
      el.classList.add('on');
      clearTimeout(showError.t);
      showError.t = setTimeout(function () { el.classList.remove('on'); }, 2600);
    } catch (_) {}
  }
  function reportSaveFailure(e) {
    showError((e && e.message) || 'সংরক্ষণ করা যায়নি, আবার চেষ্টা করুন।');
    console.warn('[profile-v2] save failed', e && (e.code || e.message));
  }

  /* Every action the UI raises lands here. */
  document.addEventListener('app:action', function (ev) {
    var d = (ev && ev.detail) || {};
    var a = d.action;
    try {
      if (a === 'profile.update') {
        /* The design persists and re-renders before dispatching, so the photo it
           just cropped is already in its store. 'avatar' is the action for both
           "photo chosen" and "mascot colour chosen"; a stored photo means an
           upload, an empty one means the student picked a colour or removed the
           picture. */
        if (d.field === 'avatar') {
          var photo = readPersistedPhoto();
          var write = photo ? saveAvatar(photo) : dropAvatar();
          write.catch(reportSaveFailure);
          return;
        }
        var one = toBackend(d.field, d.value);
        if (one) {
          var f = {}; f[one.key] = one.value;
          patchFields(f).catch(reportSaveFailure);
        }
      } else if (a === 'profile.save') {
        var p = d.profile || {};
        var all = {};
        Object.keys(FIELD_MAP).forEach(function (k) {
          if (!(k in p)) return;
          /* An empty mobile must be omitted, not sent: the validator rejects ''
             and would fail the whole bulk patch. See mobileValue(). */
          if (k === 'mobile') {
            var m = mobileValue(p[k]);
            if (m !== null) all.mobile = m;
            return;
          }
          all[FIELD_MAP[k]] = k === 'session' ? sessionValue(p[k]) : p[k];
        });
        ['school', 'college', 'targets', 'subjects'].forEach(function (k) {
          if (k in p) { var o = toBackend(k, p[k]); if (o) all[o.key] = o.value; }
        });
        if (Object.keys(all).length) patchFields(all).catch(reportSaveFailure);
      } else if (a === 'profile.theme') {
        /* A theme tap inside the frame must reach the app's own store, or the
           rest of the app keeps the previous theme. AhAppearance lives on the
           parent document (index.html is not loaded in the frame), so use it
           when reachable and fall back to its storage key, same origin, so
           localStorage is shared either way. */
        var mode = themeForApp(d.theme);
        try {
          if (window.parent && window.parent !== window && window.parent.AhAppearance) {
            window.parent.AhAppearance.set(mode);
          } else if (window.AhAppearance) {
            window.AhAppearance.set(mode);
          } else {
            localStorage.setItem('ah-appearance', mode);
          }
        } catch (_) {}
      } else if (a === 'profile.public') {
        patchFields({ visibility: d.value ? 'public' : 'private' }).catch(function () {});
      } else if (a === 'auth.logout' || a === 'auth.logoutAll') {
        /* The profile runs inside an iframe: the account module lives on the
           parent document (same origin), so reach it there. */
        try {
          var acc = (window.parent && window.parent !== window && window.parent.AdmissionAccount) || window.AdmissionAccount;
          if (acc) {
            if (a === 'auth.logout' && acc.logout) acc.logout();
            else if (a === 'auth.logoutAll' && acc.terminateAllSessions) acc.terminateAllSessions();
            else if (acc.open) acc.open();
          }
        } catch (_) {}
      }
    } catch (_) {}
  });

  loadProfile().catch(function () {
    // No session: the page keeps its honest empty state rather than showing
    // anyone else's data.
    if (typeof window.setProfile === 'function') window.setProfile({});
  });

  // A tab returning to the foreground re-reads the profile, so a change made
  // elsewhere is never stale on screen.
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') loadProfile().catch(function () {});
  });

  window.ProfileV2 = { load: loadProfile, stats: readStats };
})();
`;

/* ---- assemble -------------------------------------------------------- */
const page = `<!DOCTYPE html>
<html lang="bn">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<!-- Fetched into an iframe's srcdoc by the profile mount, never navigated to,
     so it must not be offered to a crawler as a page of its own. -->
<meta name="robots" content="noindex,nofollow,noarchive">
<meta name="referrer" content="no-referrer">
<title>প্রোফাইল, Admission Hub</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Hind+Siliguri:wght@400;500;600;700&display=swap">
<style>${cssSized}</style>
</head>
<body>
${markup}
<script>${seed}</script>
<script>${script}</script>
<script>${wiring}</script>
</body>
</html>
`;

writeFileSync(join(root, 'profile-v2.html'), page, 'utf8');
console.log('profile-v2.html written:', page.length, 'chars');
console.log('  markup', markup.length, '| css', css.length, '| ui-script', script.length,
  '| seed', seed.length, '| wiring', wiring.length);
