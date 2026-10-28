/* v1, Admission Hub FCM client (Phase 1, FCM-NOTIFICATION-BLUEPRINT.md).
 *
 * Layers FCM web push on top of the existing notification-hub.js (which keeps
 * the legacy Telegram + admission-notify VAPID path). Golden rules:
 *  - The Firebase SDK is NEVER loaded on app boot, only when the user taps
 *    "Enable", or in the background (idle) for already-registered users.
 *  - Every remote request is bounded (timeout + try/catch); failure never
 *    breaks the app (spec §46).
 *  - Credentials live only server-side; the browser sees public web config.
 */
(() => {
  'use strict';

  /* Inline SVG line icons, the settings chrome used to be emoji-led (📡⭐🛠️);
   * one stroke set reads as a product, not a chat. */
  const ICONS = {
    signal: '<path d="M2 20h.01"/><path d="M7 20v-4"/><path d="M12 20v-8"/><path d="M17 20V8"/><path d="M22 4v16"/>',
    star: '<path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1Z"/>',
    tool: '<path d="M14.7 6.3a4 4 0 0 0 5 5l-9.4 9.4a2.8 2.8 0 1 1-4-4Z"/>',
    dot: '<circle cx="12" cy="12" r="4"/>'
  };
  const iconSvg = (name, size = 16) =>
    `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="vertical-align:-3px;flex:0 0 auto">${ICONS[name] || ''}</svg>`;

  const API = '/api/notifications';
  const SDK_BASE = 'https://www.gstatic.com/firebasejs/10.12.2';
  const SDK_LOCAL = './sdk'; /* self-hosted copy on our own domain (Cloudflare stack); gstatic is the fallback */
  const LS_STATE = 'ahFcmState';
  const GLOBAL_TOPIC = 'all_students'; /* Phase 2 global topic (spec §2) */
  const SDK_TIMEOUT_MS = 25000;

  let sdkPromise = null;
  let configCache = null;
  let onMessageAttached = false;

  const stateGet = () => {
    try { return JSON.parse(localStorage.getItem(LS_STATE) || '{}') || {}; } catch (_) { return {}; }
  };
  const stateSet = (patch) => {
    try { localStorage.setItem(LS_STATE, JSON.stringify({ ...stateGet(), ...patch })); } catch (_) {}
  };

  const boundedFetch = async (path, init) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SDK_TIMEOUT_MS);
    try {
      const res = await fetch(API + path, { credentials: 'include', ...init, signal: controller.signal });
      const data = await res.json().catch(() => ({}));
      return { ok: res.ok, status: res.status, data };
    } catch (_) {
      return { ok: false, status: 0, data: {} };
    } finally {
      clearTimeout(timer);
    }
  };

  const loadScript = (src) => new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.defer = true;
    const timer = setTimeout(() => { s.remove(); reject(new Error('sdk-timeout')); }, SDK_TIMEOUT_MS);
    s.onload = () => { clearTimeout(timer); resolve(); };
    s.onerror = () => { clearTimeout(timer); s.remove(); reject(new Error('sdk-load-failed')); };
    document.head.appendChild(s);
  });

  /* Lazy Firebase SDK (compat build), loaded at most once, only on demand.
   * Self-hosted copy on our own domain first (owner's whole-stack-on-Cloudflare
   * rule + faster than gstatic on mobile); gstatic is the fallback. */
  const tryLoadSdk = async (base) => {
    if (typeof firebase !== 'undefined' && firebase.messaging) return window.firebase;
    await loadScript(`${base}/firebase-app-compat.js`);
    await loadScript(`${base}/firebase-messaging-compat.js`);
    return window.firebase;
  };
  const loadSdk = () => {
    if (!sdkPromise) {
      sdkPromise = (async () => {
        try { return await tryLoadSdk(SDK_LOCAL); }
        catch (_) { return await tryLoadSdk(SDK_BASE); }
      })();
      sdkPromise.catch(() => { sdkPromise = null; });
    }
    return sdkPromise;
  };

  /* Returns null when the config fetch itself failed (network) so callers
   * can distinguish "server unreachable" from "FCM not configured". */
  const getConfig = async () => {
    if (configCache) return configCache;
    const out = await boundedFetch('/config');
    if (out.ok && out.data.ok) { configCache = out.data; return configCache; }
    return null;
  };

  /* Last enable() outcome, surfaced in the UI so the owner can report the
   * exact failure code instead of a vague "try again" (2026-09-17).
   * `detail` carries the raw browser/SDK message: without it every distinct
   * failure (SW race, permission, VAPID, network) collapses into one
   * unactionable code. */
  const setErr = (code, detail) => {
    try {
      if (code == null) localStorage.removeItem('ahFcmLastErr');
      else localStorage.setItem('ahFcmLastErr', JSON.stringify({
        code: String(code), at: Date.now(),
        detail: detail ? String(detail).slice(0, 200) : undefined
      }));
    } catch (_) {}
  };
  const errText = (e) => (e && (e.message || e.code || String(e))) || 'unknown';
  const lastErr = () => {
    try { return JSON.parse(localStorage.getItem('ahFcmLastErr') || 'null'); } catch (_) { return null; }
  };

  /* Firebase registers /firebase-messaging-sw.js itself, but subscribes without
   * waiting for it to activate, on a cold first enable that loses the race and
   * pushManager.subscribe() throws "no active Service Worker" (error 20), so no
   * device ever gets a token. Register here and wait until it is active, then
   * hand the ready registration to getToken().
   * A registration that never reaches `active` must fail loudly: silently
   * returning null would let the SDK re-register at its own default scope and
   * reintroduce the same race. */
  const SW_URL = './firebase-messaging-sw.js';
  const SW_SCOPE = '/firebase-cloud-messaging-push-scope';
  const readySw = async () => {
    if (!('serviceWorker' in navigator)) throw new Error('sw-unsupported');
    const reg = await navigator.serviceWorker.register(SW_URL, { scope: SW_SCOPE });
    for (let i = 0; i < 100 && !reg.active; i++) await new Promise((r) => setTimeout(r, 100));
    if (!reg.active) throw new Error('sw-not-active');
    return reg;
  };

  /* The VAPID public key must be handed to getToken(). The compat SDK exposes
   * no useVapidKey()/useVapidKeyIfAvailable() method at all (verified against
   * firebase-messaging-compat 10.12.2), so the old branch was dead code and the
   * configured key was never applied. */
  const getTokenWith = async (messaging, reg, cfg) => {
    const options = {};
    if (reg) options.serviceWorkerRegistration = reg;
    if (cfg && cfg.vapidKey) options.vapidKey = cfg.vapidKey;
    return messaging.getToken(options);
  };

  const initMessaging = async (cfg) => {
    const fb = await loadSdk();
    if (!fb || typeof fb.initializeApp !== 'function') throw new Error('sdk-missing');
    const app = (fb.apps && fb.apps.length) ? fb.apps[0] : fb.initializeApp(cfg);
    const messaging = fb.messaging(app);
    /* A foreground message is delivered to the page only through this callback.
     * Without it the SDK has nowhere to hand the payload and the toast never
     * appears, even though the push arrived. Attach once, enable/disable/
     * refresh all call this. */
    if (!onMessageAttached) {
      onMessageAttached = true;
      try {
        messaging.onMessage((payload) => {
          const n = (payload && payload.notification) || {};
          const d = (payload && payload.data) || {};
          const title = n.title || 'Admission Hub';
          const body = n.body || '';
          try { window.toast?.(`${title}, ${body}`.slice(0, 240)); } catch (_) {}
          try { window.AhFcmInbox?.onForeground?.(d); } catch (_) {}
          /* A foreground push is shown as a toast, so it was seen, credit the
           * open here. Background pushes are credited from the SW click record. */
          if (d.key) reportOutcome('opened', { notification_key: String(d.key) }).catch(() => {});
        });
      } catch (_) { onMessageAttached = false; }
    }
    return messaging;
  };

  const permission = () => (typeof Notification !== 'undefined' && Notification.permission) || 'unsupported';

  const browserInfo = () => {
    const ua = navigator.userAgent || '';
    let platform = 'web';
    if (/Android/i.test(ua)) platform = 'android';
    else if (/iPhone|iPad|iPod/i.test(ua)) platform = 'ios';
    else if (/Windows/i.test(ua)) platform = 'windows';
    else if (/Macintosh|Mac OS/i.test(ua)) platform = 'macos';
    else if (/Linux/i.test(ua)) platform = 'linux';
    let browser = 'unknown';
    if (/Edg\//.test(ua)) browser = 'edge';
    else if (/Chrome\//.test(ua)) browser = 'chrome';
    else if (/Safari\//.test(ua) && !/Chrome\//.test(ua)) browser = 'safari';
    else if (/Firefox\//.test(ua)) browser = 'firefox';
    return { platform, browser };
  };

  const registerToken = async (token) => {
    const { platform, browser } = browserInfo();
    const out = await boundedFetch('/register-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, platform, browser, deviceInfo: `${navigator.language || ''}`.slice(0, 12) })
    });
    return out;
  };

  /* Self-service test push to the user's OWN devices, no admin token
   * (owner: টোকেনের ঝামেলা চাই না). Server rate-limits 3/hour. */
  const selfTest = async () => {
    const out = await boundedFetch('/self-test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    return out;
  };

  /* Phase 2: subscribe this device to the global topic (spec §2). Best
   * effort, a topic failure never breaks enablement; the server's
   * multi-token fallback still reaches non-topic devices. The server call is
   * independent of `subscribeToTopic` because the client-side call can throw
   * without a custom VAPID key, and the server-side subscribe is what makes
   * the topic path real (it records the topic only if FCM accepts it). */
  const ensureTopic = async (messaging, token) => {
    try {
      await boundedFetch('/topics/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, topics: [GLOBAL_TOPIC] })
      });
      stateSet({ topic: GLOBAL_TOPIC });
    } catch (_) { /* server fallback covers this device */ }
    try { await messaging.subscribeToTopic(GLOBAL_TOPIC); } catch (_) { /* server-side subscribe already done */ }
  };

  /* User taps Enable → browser permission → FCM token → register on server.
   * Returns: 'granted' | 'denied' | 'unsupported' | 'not-configured' | 'error' */
  /* Returns: 'granted' | 'denied' | 'unsupported' | 'config-failed' |
   * 'not-configured' | 'sdk-failed' | 'token-failed' | 'register-<http>' | 'error' */
  const enable = async () => {
    /* iOS Safari: requestPermission() must run while the tap's transient
     * activation is still live, BEFORE any network await (owner bug
     * 2026-09-17: prompt silently never appeared). */
    try {
      if (permission() === 'default') {
        const ask = await Notification.requestPermission();
        if (ask !== 'granted') return ask;
      }
    } catch (e) { setErr('prompt-error', errText(e)); return 'error'; }
    const cfg = await getConfig();
    if (!cfg) { setErr('config-failed', 'config request failed'); return 'config-failed'; }
    if (!cfg.fcmConfigured || !cfg.webConfig) { setErr('not-configured', 'server has no FCM web config'); return 'not-configured'; }
    try {
      if (permission() !== 'granted') {
        const p = permission();
        if (p === 'denied') return 'denied';
        setErr(p); return 'unsupported';
      }
      let messaging;
      try { messaging = await initMessaging(cfg.webConfig); }
      catch (e) { setErr('sdk-failed', errText(e)); return 'sdk-failed'; }
      let token;
      try {
        const reg = await readySw();
        token = await getTokenWith(messaging, reg, cfg.webConfig);
      }
      catch (e) { setErr('token-failed', errText(e)); return 'token-failed'; }
      if (!token) { setErr('token-empty', 'getToken returned an empty value'); return 'token-failed'; }
      const out = await registerToken(token);
      if (out.ok) { setErr(null); stateSet({ enabled: true, optedOut: false, at: Date.now() }); await ensureTopic(messaging, token); return 'granted'; }
      setErr('register-' + out.status, 'server rejected the token registration');
      return 'register-' + out.status;
    } catch (e) {
      setErr('error', errText(e));
      return 'error';
    }
  };

  /* User turns push OFF → stop the FCM subscription + deactivate server-side. */
  const disable = async () => {
    /* Remember that this was the user's own choice: boot reconciliation must
     * never silently turn push back on against it. */
    stateSet({ enabled: false, optedOut: true, at: Date.now() });
    try {
      const cfg = await getConfig();
      if (cfg && cfg.fcmConfigured && cfg.webConfig) {
        const messaging = await initMessaging(cfg.webConfig);
        const reg = await readySw();
        const token = await getTokenWith(messaging, reg, cfg.webConfig);
        if (token) {
          await boundedFetch('/unregister-token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token })
          });
          await messaging.deleteToken().catch(() => {});
        }
      }
    } catch (_) { /* best effort, state already flipped */ }
    return true;
  };

  /* Boot / resume reconciliation, the self-healing heart of push.
   *
   * A user who granted permission once must keep receiving push with no
   * further action, yet several ordinary events silently break that:
   *   - the FCM token rotates and our stored copy is stale;
   *   - localStorage is cleared, so nothing knows push was ever on;
   *   - an earlier enable failed after the permission grant (network blip)
   *     and was never retried, leaving `enabled` unset forever.
   * In every one of those the device looks "off" while the user believes it
   * is on, so push just stops and only a manual re-enable fixes it.
   *
   * Reconcile instead of trusting the flag: if permission is granted and the
   * user has not explicitly opted out, (re)register the current token. The
   * server upsert is idempotent, so repeating it on every resume is safe and
   * also refreshes last_seen. Never prompts, permission is already granted. */
  const reconcile = async (force = false) => {
    const st = stateGet();
    if (st.optedOut) return;
    if (permission() !== 'granted') return;
    const cfg = await getConfig();
    if (!cfg || !cfg.fcmConfigured || !cfg.webConfig) { stateSet({ enabled: false }); return; }
    try {
      const messaging = await initMessaging(cfg.webConfig);
      const reg = await readySw();
      const token = await getTokenWith(messaging, reg, cfg.webConfig);
      if (!token) return;
      if (!force && st.enabled && st.token === token) return; /* nothing changed */
      const out = await registerToken(token);
      if (!out.ok) return; /* keep the flag as-is; try again next time */
      setErr(null);
      stateSet({ enabled: true, optedOut: false, token, at: Date.now() });
      await ensureTopic(messaging, token);
    } catch (e) { setErr('reconcile-failed', errText(e)); }
  };

  /* Kept as the public name used by the boot hook and callers. */
  const refreshIfEnabled = () => reconcile();

  /* Foreground FCM delivery, the SW postMessages focused clients.
   * The push arrives on the push-scope registration (firebase-messaging-sw.js),
   * NOT on navigator.serviceWorker.ready (which resolves to the shell worker),
   * so listening only on `ready` silently dropped every foreground message. */
  const watchForeground = () => {
    if (!('serviceWorker' in navigator)) return;
    const onMsg = (event) => {
      const msg = event.data;
      if (!msg || msg.ah !== 'fcm') return;
      try {
        window.toast?.(`${msg.title}, ${msg.body}`.slice(0, 240));
      } catch (_) {}
    };
    navigator.serviceWorker.addEventListener?.('message', onMsg);
    navigator.serviceWorker.getRegistrations?.().then((regs) => {
      regs.forEach((reg) => reg.addEventListener?.('message', onMsg));
    }).catch(() => {});
  };

  const status = async () => {
    const cfg = await getConfig();
    const st = stateGet();
    let devices = 0;
    if (cfg && cfg.fcmConfigured) {
      const out = await boundedFetch('/status');
      if (out.ok && out.data.ok) devices = Number(out.data.devices || 0);
    }
    return {
      fcmConfigured: Boolean(cfg && cfg.fcmConfigured),
      permission: permission(),
      registered: Boolean(st.enabled),
      devices
    };
  };

  /* Row injected into the notification-hub settings modal (extends, no fork).
   * Round 8 (owner directive 2026-09-17): no device/token jargon, no success
   * toasts, enablement routes to the premium centered allow dialog. */
  const settingsRow = async () => {
    const s = await status();
    const pad = 'padding:10px 0;border-bottom:1px solid var(--line);';
    const L = (() => { try { return window.AhI18n ? window.AhI18n.get() : 'bn'; } catch (_) { return 'bn'; } })();
    const st = (bn, en) => (L === 'en' ? en : bn);
    if (!s.fcmConfigured) {
      return `<div style="${pad}font-size:12px;color:var(--sub)"><span>${iconSvg('signal',15)} FCM Push</span> <span style="opacity:.7">${st('সংযোগ হচ্ছে না, configuration আসার অপেক্ষায়', 'Connecting, waiting for server settings')}</span></div>`;
    }
    if (s.permission === 'denied') {
      return `<div style="${pad}font-size:12px;color:var(--red)">${iconSvg('signal',15)} FCM Push, ${st('browser-এ অনুমতি বন্ধ আছে (Settings → Site settings → Notifications থেকে খুলতে হবে)', 'permission is blocked (enable in Settings → Site settings → Notifications)')}</div>`;
    }
    if (s.registered) {
      return `<div style="${pad}display:flex;align-items:center;gap:10px"><span style="flex:1;font-size:12px">${iconSvg('signal',15)} FCM Push <b style="color:var(--green)">✓ ${st('চলছে', 'Active')}</b></span><button class="btn ghost sm" onclick="AhFcm.disable().then(()=>NotificationHub.openSettings())">${st('বন্ধ করুন', 'Turn off')}</button></div>`;
    }
    return `<div style="${pad}display:flex;align-items:center;gap:10px"><span style="flex:1;font-size:12px">${iconSvg('signal',15)} FCM Push</span><button class="btn sm" onclick="closeModal();NotificationHub.openAllowDialog()">${st('চালু করুন', 'Turn on')}</button></div>`;
  };

  /* Student's own switch for the personalized daily reminder (Phase G).
   * Kept in the same settings modal as the FCM row, one line, no jargon. */
  const personalRow = async () => {
    const L = (() => { try { return window.AhI18n ? window.AhI18n.get() : 'bn'; } catch (_) { return 'bn'; } })();
    const st = (bn, en) => (L === 'en' ? en : bn);
    let on = true;
    try {
      const res = await boundedFetch('/personal-pref');
      if (res.data && typeof res.data.personalized_enabled !== 'undefined') on = Number(res.data.personalized_enabled) === 1;
    } catch (_) { /* leave default */ }
    return `<div id="ahPersonalCard" style="margin:10px 0;padding:13px 14px;border:1.5px solid ${on ? 'var(--emerald,#0f6b4f)' : 'var(--line)'};border-radius:14px;background:${on ? '#f2f8f5' : 'transparent'}">
      <div style="display:flex;align-items:center;gap:8px">
        <span style="color:var(--emerald,#0f6b4f)">${iconSvg('star',16)}</span>
        <b style="flex:1;font-size:13.5px">${st('দৈনিক স্মার্ট রিমাইন্ডার', 'Daily smart reminder')}</b>
        <span class="chip ${on ? 'active' : ''}" style="pointer-events:none">${on ? st('চালু', 'ON') : st('বন্ধ', 'OFF')}</span>
      </div>
      <p style="margin:7px 0 0;font-size:12px;color:var(--sub,#6b7a72);line-height:1.6">${st('প্রতিদিন একবার, আপনার পড়ার অবস্থা অনুযায়ী, কখনো অনুমান নয়, শুধু আসল তথ্য।', 'Once a day, based on your study, never guessed data, only real.')}</p>
      <button class="btn ${on ? 'ghost' : ''} sm" style="margin-top:10px" onclick="AhFcm.togglePersonal()">${on ? st('বন্ধ করুন', 'Turn off') : st('চালু করুন', 'Turn on')}</button>
    </div>`;
  };

  const togglePersonal = async () => {
    const L = (() => { try { return window.AhI18n ? window.AhI18n.get() : 'bn'; } catch (_) { return 'bn'; } })();
    try {
      const cur = await boundedFetch('/personal-pref');
      const next = !(cur.data && Number(cur.data.personalized_enabled) === 1);
      await boundedFetch('/personal-pref', { method: 'POST', body: JSON.stringify({ personalized_enabled: next }) });
      window.toast?.(next
        ? (L === 'en' ? 'Daily reminder on' : 'দৈনিক রিমাইন্ডার চালু হলো')
        : (L === 'en' ? 'Daily reminder off' : 'দৈনিক রিমাইন্ডার বন্ধ হলো'));
      window.NotificationHub?.openSettings?.();
    } catch (_) {
      window.toast?.(L === 'en' ? 'Could not save' : 'সেভ করা গেল না');
    }
  };

  /* ── Phase 3, notification intelligence bridge ────────────────────────────
   * Three jobs, all small:
   *   1. tell the server this device's real UTC offset, so quiet hours and the
   *      send window follow the student rather than the server's clock;
   *   2. expose the per-category switches the intelligence engine reads;
   *   3. echo open/click/learning outcomes back, so the engine can measure
   *      whether a notification actually caused learning. */

  const tzOffsetMin = () => {
    try { return -new Date().getTimezoneOffset(); } catch (_) { return 360; }
  };

  /* Sync the offset once per session, and again if the student crosses a zone
   * (the value is compared before sending, so a normal session writes nothing). */
  const syncTimezone = async () => {
    try {
      const mine = tzOffsetMin();
      if (Number(stateGet().tzSent) === mine) return { ok: true, skipped: true };
      const res = await boundedFetch('/intel-pref', { method: 'POST', body: JSON.stringify({ tz_offset_min: mine }) });
      if (res.ok) stateSet({ tzSent: mine });
      return res;
    } catch (_) { return { ok: false }; }
  };

  const CAT_LABELS = {
    learning: { bn: 'পড়া ও রিভিশন', en: 'Learning & revision' },
    streak: { bn: 'স্ট্রিক', en: 'Streak' },
    achievement: { bn: 'অর্জন', en: 'Achievements' },
    challenge: { bn: 'চ্যালেঞ্জ', en: 'Challenges' }
  };

  const intelRow = async () => {
    const L = (() => { try { return window.AhI18n ? window.AhI18n.get() : 'bn'; } catch (_) { return 'bn'; } })();
    const st = (bn, en) => (L === 'en' ? en : bn);
    let prefs = null;
    try {
      const res = await boundedFetch('/intel-pref');
      if (res.ok && res.data?.prefs) prefs = res.data.prefs;
    } catch (_) { /* leave default */ }
    if (!prefs) return '';
    const cats = prefs.categories || {};
    const rows = Object.keys(CAT_LABELS).map(key => {
      const on = Number(cats[key]) === 1;
      return `<label style="display:flex;align-items:center;gap:9px;padding:7px 0;font-size:12.5px;cursor:pointer">
        <input type="checkbox" ${on ? 'checked' : ''} onchange="AhFcm.toggleCategory('${key}', this.checked)" style="width:16px;height:16px;accent-color:var(--emerald,#0f6b4f)">
        <span>${st(CAT_LABELS[key].bn, CAT_LABELS[key].en)}</span>
      </label>`;
    }).join('');
    return `<div style="margin:10px 0;padding:13px 14px;border:1.5px solid var(--line);border-radius:14px">
      <div style="display:flex;align-items:center;gap:8px">
        <span style="color:var(--emerald,#0f6b4f)">${iconSvg('dot',15)}</span>
        <b style="flex:1;font-size:13.5px">${st('কোন ধরনের নোটিফিকেশন চাও', 'Which notifications you want')}</b>
      </div>
      <p style="margin:7px 0 4px;font-size:12px;color:var(--sub,#6b7a72);line-height:1.6">${st('বন্ধ করা ধরন কখনোই পাঠানো হবে না, প্রতিদিন সর্বোচ্চ একটি স্মার্ট রিমাইন্ডার।', 'A type you switch off is never sent, at most one smart reminder a day.')}</p>
      ${rows}
    </div>`;
  };

  const toggleCategory = async (key, on) => {
    const L = (() => { try { return window.AhI18n ? window.AhI18n.get() : 'bn'; } catch (_) { return 'bn'; } })();
    try {
      const res = await boundedFetch('/intel-pref', { method: 'POST', body: JSON.stringify({ categories: { [key]: on ? 1 : 0 } }) });
      if (!res.ok) throw new Error('save failed');
      window.toast?.(on
        ? (L === 'en' ? 'Category on' : 'চালু হলো')
        : (L === 'en' ? 'Category off' : 'বন্ধ হলো'));
    } catch (_) {
      window.toast?.(L === 'en' ? 'Could not save' : 'সেভ করা গেল না');
    }
  };

  /* Report that the student acted on a notification. `key` is the value the
   * engine put on the push; `learning` credits a real study action. Fire and
   * forget, a failed report must never interrupt the student. */
  const reportOutcome = async (action, payload = {}) => {
    try {
      return await boundedFetch('/outcome', { method: 'POST', body: JSON.stringify({ action, ...payload }) });
    } catch (_) { return { ok: false }; }
  };

  /* Dev test center (§18), hidden route #notif-dev. Admin Bearer token is
   * entered per call and never stored. */
  const devPanel = () => {
    const open = async () => {
      const s = await status();
      const cfgOut = await boundedFetch('/config');
      const html = `
        <h3>${iconSvg('tool',18)} FCM Test Center</h3>
        <p style="font-size:12px;margin-top:4px;line-height:1.7">
          FCM: <b id="ahFcmDevStatus">${s.fcmConfigured ? '<b style="color:var(--green)">Configured</b>' : '<b style="color:var(--red)">Not configured</b>'}</b><br>
          Device: ${s.registered ? `<b style="color:var(--green)">Registered</b> (${s.devices})` : '<b style="color:var(--red)">Not registered</b>'} · Permission: ${s.permission}<br>
          Web config: ${cfgOut.data.webConfig ? '<b style="color:var(--green)">present</b>' : '<b style="color:var(--red)">missing</b>'}
        </p>
        ${s.fcmConfigured && s.registered ? `
        <label class="flabel" style="margin-top:10px">Admin token (Bearer, store করা হয় না)</label>
        <input id="ahFcmDevToken" type="password" placeholder="ADMIN_TOKEN" style="width:100%;box-sizing:border-box">
        <label class="flabel" style="margin-top:8px">Test message</label>
        <input id="ahFcmDevBody" type="text" value="Admission Hub, FCM test successful" style="width:100%;box-sizing:border-box">
        <button class="btn sm" style="margin-top:10px" id="ahFcmDevSend"> Send Test</button>
        <pre id="ahFcmDevOut" style="font-size:11px;white-space:pre-wrap;margin-top:10px;color:var(--sub)"></pre>` : ''}
        <button class="btn ghost sm" style="margin-top:14px" onclick="closeModal()">Close</button>`;
      const { openModal } = window;
      if (typeof openModal !== 'function') { window.toast?.('Test center: modal unavailable'); return; }
      openModal(html);
      const send = document.getElementById('ahFcmDevSend');
      const out = document.getElementById('ahFcmDevOut');
      if (send && out) {
        send.addEventListener('click', async () => {
          const token = document.getElementById('ahFcmDevToken')?.value?.trim() || '';
          const body = document.getElementById('ahFcmDevBody')?.value?.trim() || '';
          out.textContent = 'Sending…';
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 15000);
          try {
            const res = await fetch(API + '/test', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
              credentials: 'include',
              body: JSON.stringify({ body, link: 'dashboard' }),
              signal: controller.signal
            });
            out.textContent = JSON.stringify(await res.json().catch(() => ({})), null, 2);
          } catch (_) {
            out.textContent = 'Send failed (network/timeout)';
          } finally {
            clearTimeout(timer);
          }
        });
      }
    };
    return open;
  };

  const boot = () => {
    if (typeof document === 'undefined') return;
    watchForeground();
    // Hidden dev route.
    const checkDev = () => { if (location.hash === '#notif-dev') devPanel(); };
    document.addEventListener?.('hashchange', checkDev);
    // Phase 3: the server needs this device's real timezone, and needs it once.
    // Sent on the idle path so it never competes with app boot.
    const syncTz = () => { if (document.visibilityState === 'visible') syncTimezone().catch(() => {}); };
    if ('requestIdleCallback' in window) requestIdleCallback(syncTz, { timeout: 20000 });
    else setTimeout(syncTz, 6000);
    /* Phase 3: a real study action after a notification is the conversion we
     * measure. The analytics bus already emits these; we forward only the
     * action name, and the server decides which send to credit. */
    document.addEventListener?.('admission:activity', event => {
      const type = String(event?.detail?.type || '');
      const map = { LESSON_START: 'lesson_start', LESSON_COMPLETE: 'lesson_complete', QUIZ_COMPLETE: 'quiz_complete', QUESTION_ATTEMPT: 'question_attempt', COURSE_COMPLETE: 'course_complete' };
      const kind = map[type];
      if (kind) reportOutcome('learning', { kind }).catch(() => {});
    });
    // Background token refresh for registered users, after the app has
    // settled, never on the critical boot path.
    const later = () => {
      if (document.visibilityState !== 'visible') return;
      refreshIfEnabled().catch(() => {});
    };
    if ('requestIdleCallback' in window) requestIdleCallback(later, { timeout: 20000 });
    else setTimeout(later, 6000);
    document.addEventListener?.('visibilitychange', () => {
      if (document.visibilityState === 'visible') { refreshIfEnabled().catch(() => {}); syncTimezone().catch(() => {}); }
    });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  /* The device's current FCM token, or '' when push is unsupported/off.
   * Exposed so callers that need to act on this specific device, the admin
   * sender recording its own topic, do not have to re-derive it. */
  const currentToken = async () => {
    try {
      const cfg = await getConfig();
      if (!cfg || !cfg.fcmConfigured || !cfg.webConfig) return '';
      if (permission() !== 'granted') return '';
      const messaging = await initMessaging(cfg.webConfig);
      const reg = await readySw();
      return (await getTokenWith(messaging, reg, cfg.webConfig)) || '';
    } catch (_) { return ''; }
  };

  window.AhFcm = {
    status, enable, disable, refresh: refreshIfEnabled,
    settingsRow, personalRow, togglePersonal, devPanel, getToken: currentToken,
    intelRow, toggleCategory, syncTimezone, reportOutcome, tzOffsetMin,
    _state: stateGet, _config: getConfig, lastErr, selfTest
  };
})();
