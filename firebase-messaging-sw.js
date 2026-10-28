/* firebase-messaging-sw.js, FCM background message handler.
 *
 * Firebase's web SDK registers THIS exact path itself (/firebase-messaging-sw.js,
 * scope /firebase-cloud-messaging-push-scope) unless a serviceWorkerRegistration
 * is passed to getToken(). Its absence made getToken() reject with
 * "failed-service-worker-registration" on every device, push never enabled.
 *
 * Coexists with sw.js (the precache/shell layer): different scope, no overlap.
 * Config is hardcoded because a static SW cannot read runtime config; these are
 * the public web config values the worker already returns from /config.
 */
importScripts('./sdk/firebase-app-compat.js');
importScripts('./sdk/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: 'AIzaSyDOcARNpuV0BizWVlOmNSMexnVOzZV31Hc',
  projectId: 'admission-hub-fcm',
  messagingSenderId: '298090335130',
  appId: '1:298090335130:web:8ff32d5fa70f2037e68823'
});

const messaging = firebase.messaging();

/* No onBackgroundMessage handler on purpose. When the payload carries a
 * `notification` block the SDK ALREADY calls showNotification() itself; adding
 * our own handler made every background push appear twice (two entries with the
 * same tag). Supplying only `data` payloads would keep a manual handler, but
 * the worker sends `notification` and iOS/Chrome need it for reliable delivery. */

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  /* The SDK shows the notification itself whenever the payload carries a
   * `notification` block (our senders always set one), and it does NOT hand our
   * fields over at the top level, it wraps the whole FCM payload:
   *   t.data = { FCM_MSG: <payload> }     (sdk/firebase-messaging-compat.js)
   * Reading nd.gid / nd.link / nd.src directly therefore always found nothing,
   * so every tap fell through to './' and lost the deep link (and global clicks
   * were never logged). Unwrap first, then fall back to the flat shape for any
   * payload that does arrive unwrapped. */
  const wrapped = event.notification.data && event.notification.data.FCM_MSG;
  const nd = (wrapped && typeof wrapped === 'object')
    ? { ...(wrapped.data || {}), url: wrapped.fcmOptions && wrapped.fcmOptions.link }
    : (event.notification.data || {});
  /* Route precedence: our explicit data.link, else the hash of an
   * fcmOptions.link, else the dashboard. */
  const hashRoute = (u) => {
    const m = String(u || '').match(/#\/?([\w./#-]+)/);
    return m ? m[1] : '';
  };
  const route = String(nd.link || hashRoute(nd.url) || 'dashboard').replace(/^#?\/?/, '');
  /* Phase 2: global notifications carry `gid`, store the click for the app
   * (which logs it to /api/notifications/click on next boot/route).
   * Phase 3: intelligence notifications carry `key` (the engine's candidate
   * key), store that too so /api/notifications/outcome can attribute the click
   * to the exact send. Service workers have no localStorage, so this uses Cache
   * Storage, which the page reads with the same key. The write is inside
   * event.waitUntil so the entry survives the worker being terminated once this
   * event completes. */
  const url = String(nd.src || '').startsWith('fcm') ? `./#${route}` : (nd.url || './');
  const clickRecord = nd.gid
    ? { id: String(nd.gid), link: route, at: Date.now() }
    : (nd.key ? { intelKey: String(nd.key), link: route, at: Date.now() } : null);
  event.waitUntil(Promise.all([
    clickRecord
      ? caches.open('ah-fcm-click').then((c) => c.put(
          new Request('/__ahFcmClick'),
          new Response(JSON.stringify(clickRecord))
        )).catch(() => {})
      : Promise.resolve(),
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const client of list) { if ('focus' in client) { try { client.navigate(url); } catch (_) {} return client.focus(); } }
      return self.clients.openWindow(url);
    })
  ]));
});
