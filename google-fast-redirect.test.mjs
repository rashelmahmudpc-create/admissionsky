import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Owner 2026-10-22: "Continue with Google" took one to two minutes before
// Google's page appeared. The server was fast; the wait was in the browser.
// Firebase Auth talks to its own helper pages on the authDomain (/__/auth/iframe,
// /__/auth/handler, /__/firebase/init.json) and _worker.js proxies them to the
// Firebase project. The service worker treated every same-origin GET that asked
// for HTML as a document and answered it from the app shell — so the hidden
// iframe received the app's HTML instead of Firebase's page, its handshake never
// completed, and the SDK waited out its timeouts before the redirect could start.
// These tests run sw.js itself, not a copy of its text.
const SW = readFileSync(new URL('./sw.js', import.meta.url), 'utf8');
const WORKER = readFileSync(new URL('./_worker.js', import.meta.url), 'utf8');

const ORIGIN = 'https://admissionsky.pages.dev';

/** Boot sw.js in a sandbox with just enough of the worker scope to reach the fetch listener. */
function bootServiceWorker() {
  const listeners = {};
  const noop = async () => {};
  const emptyCache = { match: async () => undefined, put: noop, keys: async () => [], delete: noop, addAll: noop };
  const sandbox = {
    self: {
      location: { origin: ORIGIN, href: `${ORIGIN}/sw.js` },
      addEventListener: (type, handler) => { (listeners[type] ||= []).push(handler); },
      skipWaiting: () => {},
      clients: { claim: () => {}, matchAll: async () => [], openWindow: async () => null },
      registration: { sync: { register: noop } }
    },
    caches: { open: async () => emptyCache, match: async () => undefined, keys: async () => [], delete: noop },
    fetch: async () => new Response('<html>from the network</html>', { headers: { 'content-type': 'text/html' } }),
    Response, Request, Headers, URL, URLSearchParams, AbortController, DOMException, console,
    setTimeout, clearTimeout, TextEncoder
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(SW, sandbox);
  const handler = listeners.fetch?.[0];
  assert.equal(typeof handler, 'function', 'sw.js registers a fetch listener');
  return handler;
}

/** Fire a request at the fetch listener and report whether the SW answered it. */
function intercepted(handler, url, headers = { accept: 'text/html,application/xhtml+xml' }) {
  const answered = [];
  handler({
    request: new Request(url, { headers }),
    respondWith: response => answered.push(response),
    waitUntil: () => {}
  });
  return answered.length > 0;
}

const handler = bootServiceWorker();

test('Firebase Auth helper pages go straight to the network, never to the app shell', () => {
  for (const path of ['/__/auth/iframe', '/__/auth/handler', '/__/auth/iframe.js?x=1', '/__/firebase/init.json']) {
    assert.equal(intercepted(handler, ORIGIN + path), false, `${path} is not intercepted by the service worker`);
  }
});

test('the app itself is still served by the service worker', () => {
  // The guard must not turn into "the SW stopped working".
  assert.equal(intercepted(handler, `${ORIGIN}/`), true, 'the app shell is still answered');
  assert.equal(intercepted(handler, `${ORIGIN}/index.html`), true, 'index.html is still answered');
});

test('the network path the bypass lands on really serves Firebase Auth', () => {
  // Without this the bypass would only swap a stale shell for a 404.
  assert.ok(WORKER.includes("url.pathname.startsWith('/__/auth/')"), '_worker.js proxies /__/auth/*');
  assert.ok(WORKER.includes('/__/firebase/init.json'), '_worker.js proxies Firebase init.json');
});
