/**
 * 🔔 ADMISSION HUB, Smart Notification Worker
 * v107 · Telegram delivery + iPhone/PWA web-push (VAPID) + cron streak-fallback
 *
 * Secrets (worker → Settings → Variables & Secrets):
 *   TG_BOT_TOKEN , @BotFather টোকেন
 *   TG_CHAT_ID   , ইউজারের chat id (Start-এর পর getUpdates থেকে)
 *   VAPID_PRIV   , URL-safe base64url P-256 private key (32 bytes)
 *   VAPID_PUB    , URL-safe base64url P-256 public key (65 bytes, 0x04 সহ)
 * KV binding: NOTIFY_KV  (subs + state + dispatch dates)
 */

const APP_HEADER = 'admission-hub';
const TG_API = token => `https://api.telegram.org/bot${token}`;

/* BUG-001 (2026-10-26 audit). APP_HEADER is a hardcoded literal that ships in
   the client bundle, so it is a routing hint and never a credential: anyone who
   reads the bundle could POST /api/notify/dispatch and make this Worker send
   Telegram messages and push to every subscribed device. The dispatch route now
   needs a real proof of identity. Same helpers as gk-agent-worker.js, kept in
   sync by the bug001-write-auth test. */
const tokenEquals = (a, b) => {
  const x = String(a == null ? '' : a); const y = String(b == null ? '' : b);
  if (!x || x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
};
const ownerProof = (request, env) => {
  if (!env || !env.ADMIN_TOKEN) return false;
  const bearer = String(request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
  const header = String(request.headers.get('X-AH-Admin-Token') || '').trim();
  return tokenEquals(bearer, env.ADMIN_TOKEN) || tokenEquals(header, env.ADMIN_TOKEN);
};
const readSessionCookie = request => {
  const raw = String(request.headers.get('Cookie') || '');
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i < 1 || part.slice(0, i).trim() !== '__Host-ah_session') continue;
    try { return decodeURIComponent(part.slice(i + 1).trim()); } catch (_) { return ''; }
  }
  return '';
};
const verifiedSession = async (request, env) => {
  const token = readSessionCookie(request);
  if (!/^[A-Za-z0-9_-]{32,160}$/.test(token) || !env || !env.AUTH_AUTHORITY) return false;
  try {
    const id = env.AUTH_AUTHORITY.idFromName('admission-hub-global-auth-v1');
    const stub = env.AUTH_AUTHORITY.get(id);
    const res = await stub.fetch('https://auth.internal/internal/session/get', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionToken: token })
    });
    const payload = await res.json().catch(() => null);
    return res.ok && payload?.ok === true && !!payload?.result?.user?.id;
  } catch (_) { return false; }
};

const cors = request => {
  const origin = request.headers.get('Origin') || '';
  /* BUG-002 (2026-10-26 audit): this allowlist still took any *.github.io site
     and any localhost / 127.0.0.1 page. With credentials attached that lets a
     stranger's page, or any script on a developer machine, call this Worker as
     the signed-in student and read the response. Only the app's own origins
     remain, matching cors-policy.mjs. */
  const ok = /^https:\/\/([a-z0-9-]+\.)?(admissionsky|admissionhub)\.pages\.dev$/.test(origin);
  const headers = {
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-AH-App',
    'Access-Control-Max-Age': '86400'
  };
  if (ok) headers['Access-Control-Allow-Origin'] = origin;
  return headers;
};
const json = (request, obj, status = 200) => new Response(JSON.stringify(obj), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...cors(request) }
});

// ── base64url helpers ────────────────────────────────────────────────────────
const b64uToBytes = str => { const s = String(str).replace(/-/g, '+').replace(/_/g, '/'); const pad = s + '='.repeat((4 - s.length % 4) % 4); const bin = atob(pad); return Uint8Array.from(bin, ch => ch.charCodeAt(0)); };
const bytesToB64u = bytes => { let s = ''; for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
const subHash = async endpoint => { const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(endpoint)); return [...new Uint8Array(digest)].slice(0, 16).map(b => b.toString(16).padStart(2, '0')).join(''); };

// ── HKDF (RFC 5869, SHA-256) ────────────────────────────────────────────────
async function hkdf(ikm, salt, info, length) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, length * 8));
}

// ── VAPID JWT (ES256) ────────────────────────────────────────────────────────
async function vapidJwt(endpointUrl, env) {
  const url = new URL(endpointUrl);
  const header = bytesToB64u(new TextEncoder().encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const payload = bytesToB64u(new TextEncoder().encode(JSON.stringify({
    aud: `${url.protocol}//${url.host}`, exp: Math.floor(Date.now() / 1000) + 43200, sub: 'mailto:admission-hub@sheikhrashel47-stack.github.io'
  })));
  const data = new TextEncoder().encode(`${header}.${payload}`);
  const pub = b64uToBytes(env.VAPID_PUB);   // 65 bytes: 0x04 || X || Y
  const priv = b64uToBytes(env.VAPID_PRIV); // 32 bytes scalar
  const jwk = { kty: 'EC', crv: 'P-256', x: bytesToB64u(pub.slice(1, 33)), y: bytesToB64u(pub.slice(33, 65)), d: bytesToB64u(priv) };
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, data));
  return `${header}.${payload}.${bytesToB64u(sig)}`;
}

// ── Web Push payload encryption (RFC 8188 aes128gcm) ────────────────────────
async function encryptFor(subscription, plaintext) {
  const subPubRaw = b64uToBytes(subscription.keys.p256dh);
  const authSecret = b64uToBytes(subscription.keys.auth);
  const asKeys = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const subPubKey = await crypto.subtle.importKey('raw', subPubRaw, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: subPubKey }, asKeys.privateKey, 256));
  const asPubRaw = new Uint8Array(await crypto.subtle.exportKey('raw', asKeys.publicKey));
  const u16 = n => new Uint8Array([n >> 8 & 255, n & 255]);
  const info = new Uint8Array(19 + 2 + asPubRaw.length + 2 + subPubRaw.length);
  info.set(new TextEncoder().encode('WebPush: info'), 0);
  info.set(u16(asPubRaw.length), 19); info.set(asPubRaw, 21);
  info.set(u16(subPubRaw.length), 21 + asPubRaw.length); info.set(subPubRaw, 23 + asPubRaw.length);
  const prkKey = await hkdf(authSecret, shared, info, 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(prkKey, salt, new TextEncoder().encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(prkKey, salt, new TextEncoder().encode('Content-Encoding: nonce\0'), 12);
  const content = new Uint8Array(plaintext.length + 1);
  content.set(plaintext, 0); content[plaintext.length] = 2; // padding delimiter, final record
  const aesKey = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce, tagLength: 128 }, aesKey, content));
  const rs = 4096;
  if (17 + ciphertext.length > rs) throw new Error('payload too large');
  const header = new Uint8Array(21 + asPubRaw.length); // salt(16) + rs(4) + idlen(1) + keyid(65)
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, rs);
  header[20] = asPubRaw.length; header.set(asPubRaw, 21);
  const body = new Uint8Array(header.length + ciphertext.length);
  body.set(header, 0); body.set(ciphertext, header.length);
  return body;
}

async function sendWebPush(request, env, subscription, payload) {
  const body = await encryptFor(subscription, new TextEncoder().encode(JSON.stringify(payload)));
  const jwt = await vapidJwt(subscription.endpoint, env);
  const resp = await fetch(subscription.endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream', 'Content-Encoding': 'aes128gcm', 'TTL': '3600', 'Urgency': 'normal', 'Authorization': `vapid t=${jwt}, k=${env.VAPID_PUB}` },
    body
  });
  if (resp.status === 404 || resp.status === 410) {
    try { await env.NOTIFY_KV.delete('sub:' + await subHash(subscription.endpoint)); } catch (_) {}
  }
  return resp.status;
}

async function sendTelegram(env, text) {
  if (!env.TG_BOT_TOKEN || !env.TG_CHAT_ID) return 'not-configured';
  try {
    const resp = await fetch(`${TG_API(env.TG_BOT_TOKEN)}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: env.TG_CHAT_ID, text: String(text).slice(0, 3500) })
    });
    return resp.ok ? 'sent' : `tg-http-${resp.status}`;
  } catch (_) { return 'tg-error'; }
}

const dhakaToday = () => new Date(Date.now() + 6 * 3600000).toISOString().slice(0, 10);

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(request) });

    if (url.pathname === '/health') {
      let subs = 0;
      try { subs = ((await env.NOTIFY_KV.list({ prefix: 'sub:' })) || { keys: [] }).keys.length; } catch (_) {}
      return json(request, { ok: true, tg: !!env.TG_BOT_TOKEN, chat: !!env.TG_CHAT_ID, vapid: !!env.VAPID_PUB, kv: !!env.NOTIFY_KV, subs });
    }

    if (request.headers.get('X-AH-App') !== APP_HEADER) return json(request, { error: 'forbidden' }, 403);

    /* BUG-001: dispatch is the route that sends Telegram messages and pushes to
       every subscribed device, and it overwrites the cron-fallback state. The
       header above only proves the caller read the client bundle, so this route
       now requires the owner's admin token or a session the auth authority
       confirms. Push subscribe/unsubscribe stay header-gated on purpose: they
       are a per-device user action from a student's own browser, they touch only
       that one device's record, and requiring a proof there would break the
       enable-push button for signed-in students without closing the abuse path
       that matters (mass messaging). */
    if (request.method === 'POST' && url.pathname === '/api/notify/dispatch') {
      if (!ownerProof(request, env) && !(await verifiedSession(request, env))) {
        return json(request, { error: 'forbidden' }, 403);
      }
    }

    /* The app syncs its own streak snapshot here on every open, and the cron
       fallback reads it to decide whether a reminder is still needed. That call
       comes from a student's browser and cannot carry an admin token, so it
       lives on its own route: state only, never a message. Keeping it separate
       is what lets /api/notify/dispatch be locked down completely. */
    if (request.method === 'POST' && url.pathname === '/api/notify/state') {
      let body; try { body = await request.json(); } catch (_) { return json(request, { error: 'bad_json' }, 400); }
      if (body?.state && env.NOTIFY_KV) {
        try { await env.NOTIFY_KV.put('state', JSON.stringify({ ...body.state, updatedAt: Date.now() })); } catch (_) {}
      }
      return json(request, { ok: true });
    }

    if (request.method === 'POST' && url.pathname === '/api/push/subscribe') {
      let body; try { body = await request.json(); } catch (_) { return json(request, { error: 'bad_json' }, 400); }
      if (!body?.endpoint || !body?.keys?.p256dh || !body?.keys?.auth) return json(request, { error: 'invalid_subscription' }, 400);
      if (!env.NOTIFY_KV) return json(request, { error: 'kv-unavailable' }, 503);
      await env.NOTIFY_KV.put('sub:' + await subHash(body.endpoint), JSON.stringify(body));
      return json(request, { ok: true });
    }

    if (request.method === 'POST' && url.pathname === '/api/push/unsubscribe') {
      let body; try { body = await request.json(); } catch (_) { return json(request, { error: 'bad_json' }, 400); }
      if (body?.endpoint && env.NOTIFY_KV) await env.NOTIFY_KV.delete('sub:' + await subHash(body.endpoint));
      return json(request, { ok: true });
    }

    if (request.method === 'POST' && url.pathname === '/api/notify/dispatch') {
      let body; try { body = await request.json(); } catch (_) { return json(request, { error: 'bad_json' }, 400); }
      const results = {};
      // state sync for cron fallback (streak snapshot)
      if (body.state && env.NOTIFY_KV) {
        try { await env.NOTIFY_KV.put('state', JSON.stringify({ ...body.state, updatedAt: Date.now() })); } catch (_) {}
      }
      if (body.telegram?.text) results.telegram = await sendTelegram(env, body.telegram.text);
      if (body.push?.title) {
        if (!env.NOTIFY_KV || !env.VAPID_PUB || !env.VAPID_PRIV) results.push = 'not-configured';
        else {
          const list = await env.NOTIFY_KV.list({ prefix: 'sub:' });
          let sent = 0;
          for (const key of (list?.keys || []).slice(0, 10)) {
            try {
              const sub = JSON.parse(await env.NOTIFY_KV.get(key.name));
              const status = await sendWebPush(request, env, sub, { title: String(body.push.title).slice(0, 80), body: String(body.push.body || '').slice(0, 200), tag: body.push.tag || 'admission-hub', url: body.push.url || 'https://admissionsky.pages.dev/' });
              if (status >= 200 && status < 300) sent++;
            } catch (_) {}
          }
          results.push = `${sent} devices`;
        }
      }
      if (results.telegram === 'sent' || (results.push || '').includes('devices')) {
        try { await env.NOTIFY_KV.put('dispatchDate', dhakaToday()); } catch (_) {}
      }
      return json(request, { ok: true, ...results });
    }

    return json(request, { error: 'not_found' }, 404);
  },

  // দিনে একবার: অ্যাপ না খুললে streak-বাঁচানো fallback (Dhaka 20:30 = UTC 14:30)
  async scheduled(event, env) {
    if (!env.TG_BOT_TOKEN || !env.TG_CHAT_ID || !env.NOTIFY_KV) return;
    const today = dhakaToday();
    try {
      const dispatchDate = await env.NOTIFY_KV.get('dispatchDate');
      if (dispatchDate === today) return; // আজ already পাঠানো হয়েছে
      const state = JSON.parse(await env.NOTIFY_KV.get('state') || 'null');
      if (!state || state.lastOpen === today) return; // অ্যাপ আজ খোলা হয়েছে, দরকার নেই
      const streak = Number(state.streak) || 0;
      const msg = streak >= 2
        ? `ভাই, আজ অ্যাপ খোলা হয়নি 😶 তোর ${streak} দিনের streak ভাঙার ঝুঁকিতে আছে, অন্তত 10টা MCQ দিয়ে বাঁচিয়ে রাখি! 🔥`
        : 'চল আজকের practice দিয়ে দিনটা শুরু করি 📚 ছোট শুরুই যথেষ্ট, 10টা MCQ!';
      await sendTelegram(env, msg);
      await env.NOTIFY_KV.put('dispatchDate', today);
    } catch (_) {}
  }
};

// ── test-only exports (node roundtrip tests) ────────────────────────────────
export const __test = { hkdf, encryptFor, vapidJwt, b64uToBytes, bytesToB64u };
