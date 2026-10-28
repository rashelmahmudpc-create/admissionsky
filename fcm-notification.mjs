/* FCM Notification Foundation, Phase 1 (FCM-NOTIFICATION-BLUEPRINT.md).
 *
 * Runs inside the admission-gk worker (same origin as the app through the
 * Pages proxy, so the `__Host-ah_session` cookie authenticates natively).
 *
 * Routes:
 *   GET  /api/notifications/config          , public Firebase WEB app config (public by design)
 *   GET  /api/notifications/status          , auth: fcm readiness + own device count
 *   POST /api/notifications/register-token  , auth: upsert a device token
 *   POST /api/notifications/unregister-token, auth: deactivate a device token
 *   GET  /api/notifications/devices         , auth: list own active devices
 *   GET  /api/notifications/preferences     , auth: notification_settings row
 *   POST /api/notifications/preferences     , auth: update notification_settings
 *   POST /api/notifications/test            , ADMIN_TOKEN: send a test push
 *   GET  /internal/notifications/health     , operator health (Pages blocks /internal/*)
 *
 * Secrets (Cloudflare worker secrets, never in the browser):
 *   FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY
 * Public web config (safe to expose, Firebase web config is public):
 *   FIREBASE_API_KEY, FIREBASE_MESSAGING_SENDER_ID, FIREBASE_APP_ID, FIREBASE_VAPID_KEY
 *
 * Storage: D1 binding PROFILE_DB (fcm_devices + notification_settings tables).
 * Rate limits: KV binding GK_KV (registration burst + test sends).
 */
import { corsHeaders } from './cors-policy.mjs';

import { computeAnalytics, AnalyticsStore } from './analytics-notifications.mjs';
import { retryDecision, isRetryable, advanceFanout, FanoutStore, DEFAULT_WINDOW_BUDGET } from './send-planner.mjs';
import { readAdminSession } from './admin-passkey.mjs';

const FCM_API_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
const FCM_TOKEN_URL = 'https://oauth2.googleapis.com/token';
/* Server-side topic subscription (IID v1). The client's subscribeToTopic is
 * best-effort and silently no-ops when no custom VAPID key is configured, so
 * every device's `topics` stayed NULL and the topic send reached nobody. Doing
 * it server-side from the registration token makes the topic path real. */
const IID_BATCH_ADD_URL = 'https://iid.googleapis.com/iid/v1:batchAdd';
const IID_BATCH_REMOVE_URL = 'https://iid.googleapis.com/iid/v1:batchRemove';
const AUTHORITY_NAME = 'admission-hub-global-auth-v1';
/* GA4 web-stream measurement ID for the analytics-service.js foundation. Public
 * by design and shipped as a default because this Worker sits on the Workers
 * Free 64-variable ceiling; an FIREBASE_MEASUREMENT_ID secret overrides it. */
const DEFAULT_MEASUREMENT_ID = 'G-06DEZGLFJE';
const SESSION_COOKIE = '__Host-ah_session';
const SESSION_TOKEN_RE = /^[A-Za-z0-9_-]{40,96}$/;
const MAX_DEVICES_PER_USER = 12;
const TOKEN_MIN_LEN = 100;
const TOKEN_MAX_LEN = 4096;
const PLATFORM_RE = /^[a-z0-9-]{1,32}$/;
const QUIET_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

const DEFAULT_PREFS = Object.freeze({
  push_enabled: 1,
  global_enabled: 1,
  personalized_enabled: 1,
  event_enabled: 1,
  quiet_hours_enabled: 1,
  quiet_start: '23:00',
  quiet_end: '07:00'
});

const b64u = bytes => {
  let s = '';
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const sha256Hex = async value => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(value)));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
};

const readSessionToken = request => {
  const cookie = String(request.headers.get('Cookie') || '');
  for (const part of cookie.split(';')) {
    const idx = part.indexOf('=');
    if (idx > 0 && part.slice(0, idx).trim() === SESSION_COOKIE) {
      return part.slice(idx + 1).trim();
    }
  }
  return '';
};

/* Verify the session cookie against the auth authority DO. Returns
 * { user: { id, ... }, expiresAt } or null. Never throws. */
async function sessionUser(env, request) {
  const token = readSessionToken(request);
  if (!SESSION_TOKEN_RE.test(token)) return null;
  try {
    const id = env.AUTH_AUTHORITY.idFromName(AUTHORITY_NAME);
    const stub = env.AUTH_AUTHORITY.get(id, { locationHint: 'apac' });
    const res = await stub.fetch('https://auth.internal/internal/session/get', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionToken: token })
    });
    const data = await res.json();
    if (!res.ok || !data?.ok || !data.result?.user?.id) return null;
    return data.result;
  } catch {
    return null;
  }
}

/* ── D1 store (lazy schema bootstrap, same pattern as D1ProfileStore) ────── */
export class FcmStore {
  #d1;
  #ready = false;

  constructor(d1) {
    this.#d1 = d1 || null;
  }

  available() {
    return Boolean(this.#d1);
  }

  async #ensureTables() {
    if (this.#ready) return;
    /* batch() takes D1PreparedStatements, NOT raw SQL strings. Passing strings
     * threw "D1_ERROR: Malformed input" and aborted the whole sequence, so
     * fcm_devices was never created and every register-token write failed -
     * which is why no device could ever receive a push. */
    await this.#d1.batch([
      this.#d1.prepare(`CREATE TABLE IF NOT EXISTS fcm_devices (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        fcm_token TEXT NOT NULL,
        platform TEXT,
        browser TEXT,
        device_info TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        last_seen INTEGER NOT NULL,
        is_active INTEGER NOT NULL DEFAULT 1
      )`),
      this.#d1.prepare(`CREATE INDEX IF NOT EXISTS idx_fcm_devices_user ON fcm_devices(user_id)`),
      this.#d1.prepare(`CREATE TABLE IF NOT EXISTS notification_settings (
        user_id TEXT PRIMARY KEY,
        push_enabled INTEGER NOT NULL DEFAULT 1,
        global_enabled INTEGER NOT NULL DEFAULT 1,
        personalized_enabled INTEGER NOT NULL DEFAULT 1,
        event_enabled INTEGER NOT NULL DEFAULT 1,
        quiet_hours_enabled INTEGER NOT NULL DEFAULT 1,
        quiet_start TEXT NOT NULL DEFAULT '23:00',
        quiet_end TEXT NOT NULL DEFAULT '07:00',
        updated_at INTEGER NOT NULL
      )`),
      this.#d1.prepare(`CREATE TABLE IF NOT EXISTS global_notifications (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        image_url TEXT,
        target_url TEXT,
        audience TEXT NOT NULL DEFAULT 'all_students',
        topic TEXT NOT NULL,
        dedup TEXT,
        scheduled_at INTEGER,
        sent_at INTEGER,
        created_by TEXT NOT NULL,
        status TEXT NOT NULL,
        fcm_message_id TEXT,
        reach_estimate INTEGER,
        clicks INTEGER NOT NULL DEFAULT 0,
        error TEXT,
        created_at INTEGER NOT NULL
      )`),
      this.#d1.prepare(`CREATE INDEX IF NOT EXISTS idx_gn_status ON global_notifications(status, scheduled_at)`),
      this.#d1.prepare(`CREATE INDEX IF NOT EXISTS idx_gn_created ON global_notifications(created_at DESC)`),
      this.#d1.prepare(`CREATE TABLE IF NOT EXISTS notification_reads (
        notification_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        read_at INTEGER NOT NULL,
        PRIMARY KEY (notification_id, user_id)
      )`),
      /* Inbox v7: a student can save (bookmark) a notice-board item. */
      this.#d1.prepare(`CREATE TABLE IF NOT EXISTS notice_saves (
        notification_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        saved_at INTEGER NOT NULL,
        PRIMARY KEY (notification_id, user_id)
      )`)
    ]);
    try { await this.#d1.prepare('ALTER TABLE fcm_devices ADD COLUMN topics TEXT').run(); } catch (_) { /* column already exists */ }
    try { await this.#d1.prepare('ALTER TABLE global_notifications ADD COLUMN delivered INTEGER').run(); } catch (_) { /* column already exists */ }
    this.#ready = true;
  }

  async upsertDevice({ userId, token, platform, browser, deviceInfo, now }) {
    await this.#ensureTables();
    const id = (await sha256Hex(`${userId}|${token}`)).slice(0, 40);
    await this.#d1.prepare(
      `INSERT INTO fcm_devices(id, user_id, fcm_token, platform, browser, device_info, created_at, updated_at, last_seen, is_active)
       VALUES (?,?,?,?,?,?,?,?,?,1)
       ON CONFLICT(id) DO UPDATE SET
         updated_at=excluded.updated_at, last_seen=excluded.last_seen, is_active=1,
         platform=excluded.platform, browser=excluded.browser, device_info=excluded.device_info`
    ).bind(id, userId, token, platform, browser, deviceInfo, now, now, now).run();
    const count = await this.#d1.prepare('SELECT COUNT(*) AS n FROM fcm_devices WHERE user_id=? AND is_active=1')
      .bind(userId).first();
    let overflow = Number(count?.n || 0) - MAX_DEVICES_PER_USER;
    while (overflow > 0) {
      const victim = await this.#d1.prepare(
        `SELECT id FROM fcm_devices WHERE user_id=? AND is_active=1 AND id<>? ORDER BY updated_at ASC LIMIT 1`
      ).bind(userId, id).first();
      if (!victim) break;
      await this.#d1.prepare('UPDATE fcm_devices SET is_active=0, updated_at=? WHERE id=?').bind(now, victim.id).run();
      overflow -= 1;
    }
    return { id };
  }

  async deactivateToken(userId, token) {
    await this.#ensureTables();
    const id = (await sha256Hex(`${userId}|${token}`)).slice(0, 40);
    const res = await this.#d1.prepare('UPDATE fcm_devices SET is_active=0, updated_at=? WHERE id=? AND is_active=1')
      .bind(Date.now(), id).run();
    return Boolean(res?.meta?.changes || 0);
  }

  async markInactive(ids, now) {
    if (!ids.length) return;
    await this.#ensureTables();
    await this.#d1.batch(ids.map(id =>
      this.#d1.prepare('UPDATE fcm_devices SET is_active=0, updated_at=? WHERE id=?').bind(now, id)
    ));
  }

  async activeDevices(userId) {
    await this.#ensureTables();
    const rows = await this.#d1.prepare(
      `SELECT id, fcm_token, platform, browser, device_info, created_at, updated_at, last_seen
       FROM fcm_devices WHERE user_id=? AND is_active=1 ORDER BY updated_at DESC`
    ).bind(userId).all();
    return (rows?.results || []).map(row => ({
      id: row.id,
      token: `${String(row.fcm_token).slice(0, 10)}…`,
      platform: row.platform,
      browser: row.browser,
      deviceInfo: row.device_info,
      createdAt: Number(row.created_at),
      lastSeen: Number(row.last_seen)
    }));
  }

  async activeTokens(userId) {
    await this.#ensureTables();
    const rows = await this.#d1.prepare(
      `SELECT id, fcm_token FROM fcm_devices WHERE user_id=? AND is_active=1 ORDER BY updated_at DESC`
    ).bind(userId).all();
    return (rows?.results || []).map(row => ({ id: row.id, token: row.fcm_token }));
  }

  async getPrefs(userId) {
    await this.#ensureTables();
    const row = await this.#d1.prepare('SELECT * FROM notification_settings WHERE user_id=?').bind(userId).first();
    if (!row) return { ...DEFAULT_PREFS, stored: false };
    return {
      push_enabled: Number(row.push_enabled),
      global_enabled: Number(row.global_enabled),
      personalized_enabled: Number(row.personalized_enabled),
      event_enabled: Number(row.event_enabled),
      quiet_hours_enabled: Number(row.quiet_hours_enabled),
      quiet_start: String(row.quiet_start),
      quiet_end: String(row.quiet_end),
      stored: true
    };
  }

  async savePrefs(userId, prefs, now) {
    await this.#ensureTables();
    await this.#d1.prepare(
      `INSERT INTO notification_settings(user_id, push_enabled, global_enabled, personalized_enabled, event_enabled,
        quiet_hours_enabled, quiet_start, quiet_end, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?)
       ON CONFLICT(user_id) DO UPDATE SET
         push_enabled=excluded.push_enabled, global_enabled=excluded.global_enabled,
         personalized_enabled=excluded.personalized_enabled, event_enabled=excluded.event_enabled,
         quiet_hours_enabled=excluded.quiet_hours_enabled, quiet_start=excluded.quiet_start,
         quiet_end=excluded.quiet_end, updated_at=excluded.updated_at`
    ).bind(userId, prefs.push_enabled, prefs.global_enabled, prefs.personalized_enabled, prefs.event_enabled,
      prefs.quiet_hours_enabled, prefs.quiet_start, prefs.quiet_end, now).run();
    return prefs;
  }

  /* ── Phase 2: global notification storage ───────────────────────────────── */
  async insertGlobal(row) {
    await this.#ensureTables();
    await this.#d1.prepare(
      `INSERT INTO global_notifications(id, type, title, body, image_url, target_url, audience, topic,
        dedup, scheduled_at, created_by, status, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(row.id, row.type, row.title, row.body, row.imageUrl || null, row.targetUrl || null,
      row.audience, row.topic, row.dedup || null, row.scheduledAt || null,
      row.createdBy, row.status, row.createdAt).run();
  }

  async updateGlobalStatus(id, patch) {
    await this.#ensureTables();
    const sets = [];
    const binds = [];
    if (patch.status !== undefined) { sets.push('status=?'); binds.push(patch.status); }
    if (patch.sentAt !== undefined) { sets.push('sent_at=?'); binds.push(patch.sentAt); }
    if (patch.fcmMessageId !== undefined) { sets.push('fcm_message_id=?'); binds.push(patch.fcmMessageId); }
    if (patch.reachEstimate !== undefined) { sets.push('reach_estimate=?'); binds.push(patch.reachEstimate); }
    if (patch.delivered !== undefined) { sets.push('delivered=?'); binds.push(patch.delivered); }
    if (patch.error !== undefined) { sets.push('error=?'); binds.push(patch.error); }
    if (!sets.length) return;
    binds.push(id);
    await this.#d1.prepare(`UPDATE global_notifications SET ${sets.join(', ')} WHERE id=?`).bind(...binds).run();
  }

  async dueGlobals(now) {
    await this.#ensureTables();
    const res = await this.#d1.prepare(
      `SELECT * FROM global_notifications WHERE status='scheduled' AND scheduled_at IS NOT NULL AND scheduled_at<=? ORDER BY scheduled_at ASC LIMIT 20`
    ).bind(now).all();
    return (res?.results || []).map(row => ({
      id: row.id, type: row.type, title: row.title, body: row.body,
      imageUrl: row.image_url, targetUrl: row.target_url,
      audience: row.audience, topic: row.topic, scheduledAt: Number(row.scheduled_at || 0)
    }));
  }

  async recentGlobals(limit = 50) {
    await this.#ensureTables();
    const res = await this.#d1.prepare(
      `SELECT id, type, title, body, image_url, target_url, audience, topic, status, scheduled_at, sent_at, reach_estimate, delivered, clicks, error, created_at
       FROM global_notifications ORDER BY created_at DESC, id DESC LIMIT ?`
    ).bind(limit).all();
    return (res?.results || []).map(row => ({
      id: row.id, type: row.type, title: row.title, body: row.body,
      imageUrl: row.image_url || '',
      targetUrl: row.target_url || '',
      audience: row.audience, topic: row.topic, status: row.status,
      scheduledAt: row.scheduled_at ? Number(row.scheduled_at) : null,
      sentAt: row.sent_at ? Number(row.sent_at) : null,
      reachEstimate: row.reach_estimate ? Number(row.reach_estimate) : null,
      delivered: row.delivered === null || row.delivered === undefined ? null : Number(row.delivered),
      clicks: Number(row.clicks || 0),
      error: row.error,
      createdAt: Number(row.created_at)
    }));
  }

  async duplicateRecent(dedup, sinceMs) {
    await this.#ensureTables();
    const row = await this.#d1.prepare(
      `SELECT id FROM global_notifications WHERE dedup=? AND status IN ('sent','scheduled') AND created_at>=? LIMIT 1`
    ).bind(dedup, sinceMs).first();
    return row ? row.id : null;
  }

  async failStaleSending(beforeMs) {
    await this.#ensureTables();
    const res = await this.#d1.prepare(
      `UPDATE global_notifications SET status='failed', sent_at=?, error='stale-sending'
       WHERE status='sending' AND created_at<=?`
    ).bind(Date.now(), beforeMs).run();
    return Number(res?.meta?.changes || 0);
  }

  async markRead(notificationId, userId, now) {
    await this.#ensureTables();
    await this.#d1.prepare(
      `INSERT OR IGNORE INTO notification_reads(notification_id, user_id, read_at) VALUES (?,?,?)`
    ).bind(notificationId, userId, now).run();
  }

  async readState(userId, ids) {
    if (!ids.length) return {};
    await this.#ensureTables();
    const res = await this.#d1.prepare(
      `SELECT notification_id, read_at FROM notification_reads WHERE user_id=? AND notification_id IN (${ids.map(() => '?').join(',')})`
    ).bind(userId, ...ids).all();
    const out = {};
    for (const row of res?.results || []) out[row.notification_id] = Number(row.read_at);
    return out;
  }

  /* Inbox v7: "mark all as read" must also clear server-side globals -
   * before this only the local hub log was cleared, so globals came back unread. */
  async markAllRead(userId, ids, now) {
    if (!ids.length) return 0;
    await this.#ensureTables();
    const stmt = `INSERT OR IGNORE INTO notification_reads(notification_id, user_id, read_at) VALUES (?,?,?)`;
    await this.#d1.batch(ids.map(id => this.#d1.prepare(stmt).bind(id, userId, now)));
    return ids.length;
  }

  async saveState(userId, ids) {
    if (!ids.length) return {};
    await this.#ensureTables();
    const res = await this.#d1.prepare(
      `SELECT notification_id, saved_at FROM notice_saves WHERE user_id=? AND notification_id IN (${ids.map(() => '?').join(',')})`
    ).bind(userId, ...ids).all();
    const out = {};
    for (const row of res?.results || []) out[row.notification_id] = Number(row.saved_at);
    return out;
  }

  async setSaved(userId, id, saved, now) {
    await this.#ensureTables();
    if (saved) {
      await this.#d1.prepare(`INSERT OR REPLACE INTO notice_saves(notification_id, user_id, saved_at) VALUES (?,?,?)`).bind(id, userId, now).run();
    } else {
      await this.#d1.prepare(`DELETE FROM notice_saves WHERE notification_id=? AND user_id=?`).bind(id, userId).run();
    }
  }

  async globalFeed(limit = 30) {
    await this.#ensureTables();
    const res = await this.#d1.prepare(
      `SELECT id, type, title, body, image_url, target_url, audience, sent_at
       FROM global_notifications WHERE status='sent' AND sent_at IS NOT NULL
       ORDER BY sent_at DESC LIMIT ?`
    ).bind(limit).all();
    return (res?.results || []).map(row => ({
      id: row.id, type: row.type, title: row.title, body: row.body,
      imageUrl: row.image_url, targetUrl: row.target_url,
      audience: row.audience, sentAt: Number(row.sent_at)
    }));
  }

  async incrementClicks(id) {
    await this.#ensureTables();
    await this.#d1.prepare(`UPDATE global_notifications SET clicks=clicks+1 WHERE id=?`).bind(id).run();
  }

  async setDeviceTopics(userId, token, topicsCsv) {
    await this.#ensureTables();
    await this.#d1.prepare('UPDATE fcm_devices SET topics=? WHERE user_id=? AND fcm_token=?')
      .bind(topicsCsv, userId, token).run();
  }

  async activeDevicesMissingTopic(topic) {
    await this.#ensureTables();
    /* Filter in process: the stored CSV is split into whole names so
     * `course_beginner` is never treated as a subscription to `beginner`,
     * and the query stays simple enough for the SQLite-backed test fake. */
    const res = await this.#d1.prepare(
      'SELECT id, fcm_token, topics FROM fcm_devices WHERE is_active=1 LIMIT 2000'
    ).all();
    return (res?.results || []).filter(row => {
      const held = String(row.topics || '').split(/[|,]/).map(t => t.trim()).filter(Boolean);
      return !held.includes(topic);
    }).map(row => ({ id: row.id, token: row.fcm_token }));
  }

  async allActiveTokens() {
    await this.#ensureTables();
    const res = await this.#d1.prepare(
      `SELECT id, fcm_token FROM fcm_devices WHERE is_active=1 LIMIT 2000`
    ).all();
    return (res?.results || []).map(row => ({ id: row.id, token: row.fcm_token }));
  }

  async activeDeviceCount() {
    await this.#ensureTables();
    /* Count physical devices, not account rows: one phone signed into three
     * accounts is three rows but one device, and the reach number the admin
     * sees must match how many phones actually ring. */
    const row = await this.#d1.prepare('SELECT COUNT(DISTINCT fcm_token) AS n FROM fcm_devices WHERE is_active=1').first();
    return Number(row?.n || 0);
  }
}

/* ── KV rate limiter (bounded; full windowing arrives in Phase 5) ────────── */
async function kvRateAllow(env, key, limit, ttlSeconds) {
  const kv = env?.GK_KV;
  if (!kv || typeof kv.get !== 'function') return true;
  try {
    const k = `fcm:${key}`;
    const n = Number(await kv.get(k) || 0);
    if (n >= limit) return false;
    await kv.put(k, String(n + 1), { expirationTtl: ttlSeconds });
    return true;
  } catch {
    return true; // rate limiting must never break the API
  }
}

/* Read the current counter for a rate-limit key without consuming it. Used to
 * report real quota usage to the admin; a missing KV or a read error means "no
 * data", never a fabricated number. */
async function kvRatePeek(env, key) {
  const kv = env?.GK_KV;
  if (!kv || typeof kv.get !== 'function') return null;
  try {
    return Number(await kv.get(`fcm:${key}`) || 0);
  } catch {
    return null;
  }
}

/* ── FCM HTTP v1 (server-side only) ──────────────────────────────────────── */
const fcmTokenCache = { token: '', exp: 0 };

/* PEM (PKCS#8) → DER bytes for WebCrypto importKey. Handles both real
 * newlines and the `\n`-escaped form Cloudflare secret storage uses. */
const pemToDer = pemValue => {
  const pem = String(pemValue).replace(/\\n/g, '\n');
  const body = pem.replace(/-----(BEGIN|END)[^-]+-----/g, '').replace(/\s/g, '');
  if (!body) return null;
  const bin = atob(body);
  return Uint8Array.from(bin, ch => ch.charCodeAt(0));
};

async function fcmAccessToken(env) {
  if (fcmTokenCache.token && fcmTokenCache.exp > Date.now() + 60_000) return fcmTokenCache.token;
  if (!env.FIREBASE_PROJECT_ID || !env.FIREBASE_CLIENT_EMAIL || !env.FIREBASE_PRIVATE_KEY) throw new Error('fcm-not-configured');
  const der = pemToDer(env.FIREBASE_PRIVATE_KEY);
  if (!der) throw new Error('fcm-key-invalid');
  const key = await crypto.subtle.importKey(
    'pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']
  );
  const iat = Math.floor(Date.now() / 1000);
  const header = b64u(new TextEncoder().encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
  const payload = b64u(new TextEncoder().encode(JSON.stringify({
    iss: env.FIREBASE_CLIENT_EMAIL,
    scope: FCM_API_SCOPE,
    aud: FCM_TOKEN_URL,
    iat,
    exp: iat + 3600
  })));
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${header}.${payload}`));
  // Google's token endpoint enforces the full RFC 7523 URN for the JWT
  // bearer grant (the shorthand "jwt-bearer" is rejected as unsupported).
  const form = new URLSearchParams();
  form.set('grant_type', 'urn:ietf:params:oauth:grant-type:jwt-bearer');
  form.set('assertion', `${header}.${payload}.${b64u(signature)}`);
  const res = await fetch(FCM_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString()
  });
  const data = await res.json();
  if (!res.ok || !data?.access_token) throw new Error('fcm-auth-failed');
  fcmTokenCache.token = data.access_token;
  fcmTokenCache.exp = Date.now() + Number(data.expires_in || 3600) * 1000;
  return data.access_token;
}

/* Send one message per token. Returns per-token outcomes:
 * { ok: true } | { ok: false, reason: 'unregistered' | 'invalid' | 'error' } */
async function fcmSendToDevice(env, { token, title, body, data }) {
  const accessToken = await fcmAccessToken(env);
  const message = {
    token,
    notification: { title, body },
    data: Object.fromEntries(Object.entries(data || {}).map(([k, v]) => [k, String(v)]))
  };
  let res;
  try {
    res = await fetch(`https://fcm.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/messages:send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ message })
    });
  } catch {
    return { ok: false, reason: 'error' };
  }
  const out = await res.json().catch(() => ({}));
  if (res.ok && out?.name) return { ok: true, name: out.name };
  const code = Number(out?.error?.code || 0);
  // 3 = NOT_FOUND (unregistered token), 6 = INVALID_ARGUMENT (malformed token)
  if (code === 3 || code === 6) return { ok: false, reason: code === 3 ? 'unregistered' : 'invalid' };
  return { ok: false, reason: 'error', detail: String(out?.error?.message || '').slice(0, 200) };
}

function fcmConfigured(env) {
  return Boolean(env?.FIREBASE_PROJECT_ID && env?.FIREBASE_CLIENT_EMAIL && env?.FIREBASE_PRIVATE_KEY);
}
export { fcmConfigured, sessionUser, parseBody, fcmSendToTokens };

function publicWebConfig(env) {
  if (!fcmConfigured(env)) return null;
  const cfg = {
    apiKey: String(env.FIREBASE_API_KEY || ''),
    projectId: String(env.FIREBASE_PROJECT_ID || ''),
    messagingSenderId: String(env.FIREBASE_MESSAGING_SENDER_ID || ''),
    appId: String(env.FIREBASE_APP_ID || ''),
    vapidKey: String(env.FIREBASE_VAPID_KEY || '')
  };
  /* GA4 measurement ID (G-XXXXXXX) for the analytics-service.js foundation.
   * This Worker sits on the Workers Free 64-variable ceiling, so the ID ships
   * as a module default instead of a binding; an FIREBASE_MEASUREMENT_ID secret
   * still wins when present, so a different GA4 stream needs no code change.
   * A measurement ID is public by design (every browser receives it), so hard
   * coding it leaks nothing. */
  const measurementId = String(env.FIREBASE_MEASUREMENT_ID || '').trim() || DEFAULT_MEASUREMENT_ID;
  if (measurementId) cfg.measurementId = measurementId;
  return cfg;
}

const jsonResponse = (request, obj, status = 200) => new Response(JSON.stringify(obj), {
  status,
  headers: {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...corsHeaders(request),
  }
});

const parseBody = async request => {
  try {
    const text = await request.text();
    if (!text) return {};
    const data = JSON.parse(text);
    return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  } catch {
    return null;
  }
};

/* Admin send rejections are invisible from the phone: the client collapses
 * every failure into one generic message. Log the deciding field so a 400 can
 * be told apart from a stale token or a delivery failure. */
const rejectNotify = (request, why, detail) => {
  try { console.log('notify-reject', why, JSON.stringify(detail || {}).slice(0, 300)); } catch (_) {}
  return jsonResponse(request, { error: why }, 400);
};

/* ── Phase 2, Global Notification Engine (owner-approved 2026-09-17) ──────
 * Topic-first sends (spec "$0-first"): ONE FCM topic call reaches every
 * subscribed device, no per-user loop. Devices that could not subscribe to
 * the topic get a multi-token fallback (chunks of 500), so API calls stay
 * O(1), never O(users). Scheduled globals run from the worker cron
 * (Cloudflare Cron Triggers, the owner's no-Vercel rule replaces the
 * spec's "Vercel Cron").
 *
 * Routes (admin = session + Bearer ADMIN_TOKEN; user = session cookie):
 *   POST /api/notifications/global/send       , admin: create + send now
 *   POST /api/notifications/global/schedule   , admin: create + schedule
 *   POST /api/notifications/global/cancel     , admin: cancel a scheduled
 *   GET  /api/notifications/history           , admin: recent globals
 *   GET  /api/notifications/templates         , admin: preset templates
 *   POST /api/notifications/topics/subscribe  , user: mark device topics
 *   POST /api/notifications/topics/unsubscribe, user: unmark device topics
 *   GET  /api/notifications/inbox             , user: global feed + read state
 *   POST /api/notifications/read              , user: mark a global read
 *   POST /api/notifications/read-all          , user: mark every global read (inbox v7)
 *   POST /api/notifications/save              , user: save/unsave a notice (inbox v7)
 *   POST /api/notifications/click             , user: log a deep-link click
 */
const GLOBAL_TYPES = Object.freeze(['new-content', 'announcement', 'new-feature', 'challenge', 'course', 'important']);
const GLOBAL_AUDIENCES = Object.freeze({
  all_students: { topic: 'all_students', bn: 'সব Student', en: 'All Students' },
  beginner: { topic: 'course_beginner', bn: 'Beginner Student', en: 'Beginner Students' },
  intermediate: { topic: 'course_intermediate', bn: 'Intermediate Student', en: 'Intermediate Students' },
  pro: { topic: 'course_pro', bn: 'Pro Student', en: 'Pro Students' },
  course_subscribers: { topic: 'course_all', bn: 'Course Subscribers', en: 'Course Subscribers' }
});
const GLOBAL_DAILY_CAP = 10;
const GLOBAL_MAX_SCHEDULE_DAYS = 30;
const GN_ID_RE = /^gn-[a-z0-9]{12}$/;
/* Inbox v7: global types that belong on the নোটিশ বোর্ড tab. */
const NOTICE_TYPES = new Set(['announcement', 'important', 'course', 'new-feature']);
const TOPIC_RE = /^[a-z][a-z0-9_-]{0,63}$/;
/* Phase 2 global audience topic. Mirrors the client's GLOBAL_TOPIC. */
const GLOBAL_TOPIC = 'all_students';
/* Stable same-origin URL of the app logo, used as the notification icon/badge.
 * Referenced (not inlined) so changing icons/icon-192.png changes every future
 * push automatically, with no redeploy and no per-message asset handling. */
const APP_ICON_PATH = '/icons/icon-192.png';
/* Absolute, publicly reachable app origin for notification assets.
 * `request.url` cannot be trusted for this: every /api/* call is proxied from
 * Pages to the worker, so inside the worker it is the worker's own origin
 * (admission-gk...workers.dev), which does NOT serve /icons/* and returns 403.
 * Android then drew the OS default "A" avatar. The Pages origin is the one that
 * serves the real logo and the R2 image read path. Overridable for staging. */
const publicOrigin = request => {
  try {
    const h = new URL(request?.url || '');
    /* A non-proxied call on our own public host keeps that host. */
    if (h.hostname === 'admissionhub.pages.dev' || h.hostname === 'admissionsky.pages.dev' || /\.pages\.dev$/.test(h.hostname)) return h.origin;
  } catch (_) {}
  return 'https://admissionhub.pages.dev';
};
const iconAbsolute = request => `${publicOrigin(request)}${APP_ICON_PATH}`;
/* Notification image uploads (admin → R2). Images only, and small enough that a
 * phone photo re-encoded by the client fits well under the FCM limits. */
const IMAGE_TYPES = Object.freeze({ jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' });
const NOTIFY_IMAGE_MAX_BYTES = 4 * 1024 * 1024;
const randKey = len => {
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (const b of bytes) s += alphabet[b % alphabet.length];
  return s;
};

/* Dual-language preset templates (spec §13). Variables: {{title}} {{lesson}}
 * {{course}} {{feature}} {{date}}, the admin replaces them in the composer. */
const GLOBAL_TEMPLATES = Object.freeze([
  { key: 'new-content', type: 'new-content',
    bn: { title: '{{title}} এখন available', body: 'নতুন content এখন available, দেখে নিন।' },
    en: { title: '{{title}} is now available', body: 'New content is live, take a look.' } },
  { key: 'announcement', type: 'announcement',
    bn: { title: 'গুরুত্বপূর্ণ আপডেট', body: '{{title}}' },
    en: { title: 'Important update', body: '{{title}}' } },
  { key: 'new-feature', type: 'new-feature',
    bn: { title: 'নতুন feature live হয়েছে', body: '{{feature}} এখন available, ব্যবহার করে দেখুন।' },
    en: { title: 'New feature is live', body: '{{feature}} is available, give it a try.' } },
  { key: 'challenge', type: 'challenge',
    bn: { title: 'সাপ্তাহিক challenge শুরু!', body: 'নতুন challenge ready। শেষ: {{date}}' },
    en: { title: 'Weekly challenge is on!', body: 'Your new challenge is ready. Ends: {{date}}' } },
  { key: 'course', type: 'course',
    bn: { title: '{{course}}-এ নতুন module', body: '{{course}}-এর নতুন module প্রকাশিত হয়েছে।' },
    en: { title: 'New module in {{course}}', body: 'A new module was published in {{course}}.' } },
  { key: 'important', type: 'important',
    bn: { title: '🚨 গুরুত্বপূর্ণ', body: '{{title}}' },
    en: { title: '🚨 Important', body: '{{title}}' } }
]);

async function fcmSendToTopic(env, topic, { title, body, imageUrl, iconUrl, badgeUrl, data }) {
  const accessToken = await fcmAccessToken(env);
  const notification = { title, body };
  if (imageUrl) notification.image = imageUrl;
  const message = {
    topic,
    notification,
    /* Explicit platform blocks so the app logo (not the OS default "A" avatar)
     * shows on Android and the web fallback. `iconUrl` is the live logo URL, so
     * a logo swap propagates to every future push with no code change. */
    webpush: { notification: {
      title, body,
      ...(iconUrl ? { icon: iconUrl } : {}),
      ...(badgeUrl ? { badge: badgeUrl } : {}),
      ...(imageUrl ? { image: imageUrl } : {})
    } },
    android: { notification: {
      ...(iconUrl ? { icon: iconUrl } : {}),
      ...(imageUrl ? { image: imageUrl } : {})
    } },
    data: Object.fromEntries(Object.entries(data || {}).map(([k, v]) => [k, String(v)]))
  };
  let res;
  try {
    res = await fetch(`https://fcm.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/messages:send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ message })
    });
  } catch {
    return { ok: false, reason: 'error' };
  }
  const out = await res.json().catch(() => ({}));
  if (res.ok && out?.name) return { ok: true, name: out.name };
  return { ok: false, reason: 'error', detail: String(out?.error?.message || '').slice(0, 200) };
}

/* Server-side topic subscription. The client's subscribeToTopic is best-effort
 * and silently no-ops without a custom VAPID key, so the topic path never
 * reached anyone. IID returns 200 with a per-token error entry, so a 200 alone
 * is not success, the result body has to be inspected. */
async function iidBatch(env, url, token, topic) {
  if (!TOPIC_RE.test(topic)) return { ok: false, reason: 'invalid-topic' };
  let accessToken;
  try { accessToken = await fcmAccessToken(env); } catch { return { ok: false, reason: 'auth' }; }
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ to: `/topics/${topic}`, registration_tokens: [token] })
    });
  } catch {
    return { ok: false, reason: 'network' };
  }
  const out = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, reason: 'error', detail: String(out?.error || '').slice(0, 200) };
  const entry = (out?.results || [])[0];
  if (entry && entry.error) return { ok: false, reason: String(entry.error).slice(0, 60) };
  return { ok: true };
}
const subscribeDeviceToTopic = (env, token, topic) => iidBatch(env, IID_BATCH_ADD_URL, token, topic);
const unsubscribeDeviceFromTopic = (env, token, topic) => iidBatch(env, IID_BATCH_REMOVE_URL, token, topic);

/* Per-device send, bounded concurrency. The FCM HTTP v1 single-send body takes
 * ONE `token`, never a `tokens` array, the array form belongs to the batch
 * endpoint, which lives at a different URL. Sending `tokens` here got a 400 for
 * every fallback batch and silently delivered nothing while the row still read
 * "sent", so the whole non-topic path was dead. */
const FCM_SEND_URL = project => `https://fcm.googleapis.com/v1/projects/${project}/messages:send`;
const FCM_SEND_CONCURRENCY = 10;
/* One global send fans out to every active device, so the only bound that
 * matters is memory, not cost (a token send is one HTTP request either way).
 * A fixed small cap silently stopped delivering to users beyond it while the
 * row still read "sent", the exact class of bug this path exists to avoid. */
const FCM_FANOUT_MAX = 20_000;

async function fcmSendOne(env, accessToken, target, { title, body, imageUrl, iconUrl, badgeUrl, data: messageData }) {
  const notification = { title, body };
  if (imageUrl) notification.image = imageUrl;
  const message = {
    token: target.token,
    notification,
    webpush: { notification: {
      title, body,
      ...(iconUrl ? { icon: iconUrl } : {}),
      ...(badgeUrl ? { badge: badgeUrl } : {}),
      ...(imageUrl ? { image: imageUrl } : {})
    } },
    android: { notification: {
      ...(iconUrl ? { icon: iconUrl } : {}),
      ...(imageUrl ? { image: imageUrl } : {})
    } },
    data: messageData
  };
  let res;
  try {
    res = await fetch(FCM_SEND_URL(env.FIREBASE_PROJECT_ID), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ message })
    });
  } catch {
    return { id: target.id, ok: false, reason: 'error' };
  }
  const out = await res.json().catch(() => ({}));
  if (res.ok && out?.name) return { id: target.id, ok: true, reason: 'ok' };
  /* 404 NOT_FOUND / 400 INVALID_ARGUMENT → the token is dead, stop retrying. */
  const code = Number(out?.error?.code || 0);
  const msg = String(out?.error?.message || '');
  if (code === 404 || /not.?registered|Requested entity was not found/i.test(msg)) {
    return { id: target.id, ok: false, reason: 'unregistered' };
  }
  if (code === 400 || /INVALID_ARGUMENT/i.test(msg)) {
    return { id: target.id, ok: false, reason: 'invalid' };
  }
  return { id: target.id, ok: false, reason: 'error' };
}

async function fcmSendToTokens(env, targets, { title, body, imageUrl, iconUrl, badgeUrl, data }) {
  const accessToken = await fcmAccessToken(env);
  const messageData = Object.fromEntries(Object.entries(data || {}).map(([k, v]) => [k, String(v)]));
  /* One physical device is one FCM token. When the same phone is used by more
   * than one account, `fcm_devices` holds one row per (user,token), so the raw
   * list repeats the token and the device receives the same push N times. Send
   * once per distinct token; keep every row id so all of them can be retired
   * when the token turns out to be dead. */
  const byToken = new Map();
  for (const t of targets) {
    const key = String(t.token || '');
    if (!key) continue;
    const cur = byToken.get(key);
    if (cur) cur.ids.push(t.id);
    else byToken.set(key, { id: t.id, ids: [t.id], token: t.token });
  }
  const batch = [...byToken.values()];
  const idToIds = new Map(batch.map(b => [b.id, b.ids]));
  let sent = 0;
  let failedTotal = 0;
  let rateLimited = 0;
  const failed = [];
  const badIds = [];
  for (let i = 0; i < batch.length; i += FCM_SEND_CONCURRENCY) {
    const slice = batch.slice(i, i + FCM_SEND_CONCURRENCY);
    let results = await Promise.all(
      slice.map(t => fcmSendOne(env, accessToken, t, { title, body, imageUrl, iconUrl, badgeUrl, data: messageData }))
    );
    /* A rate-limited or unavailable device is worth one backoff retry: FCM's
     * 429/503 means "later", not "never", and dropping it would silently
     * under-deliver a valid send. A dead token is never retried. */
    let attempt = 1;
    for (;;) {
      const stuck = results.map((r, idx) => ({ r, idx }))
        .filter(({ r }) => retryDecision({ reason: r.reason, attempt, maxAttempts: 2 }).retry);
      if (!stuck.length) break;
      await new Promise(resolve => setTimeout(resolve, retryDecision({ reason: stuck[0].r.reason, attempt, maxAttempts: 2 }).waitMs));
      const again = await Promise.all(
        stuck.map(({ r }) => fcmSendOne(env, accessToken, slice.find(t => t.id === r.id) || slice[0], { title, body, imageUrl, iconUrl, badgeUrl, data: messageData }))
      );
      again.forEach((r, k) => { results[stuck[k].idx] = r; });
      attempt += 1;
    }
    for (const r of results) {
      if (r.ok) sent += 1;
      else {
        failedTotal += 1;
        if (isRetryable(r.reason)) rateLimited += 1;
        /* Keep the sample small: it is diagnostic detail, the count is truth. */
        if (failed.length < 20) failed.push({ id: r.id, reason: r.reason });
        if (r.reason === 'unregistered' || r.reason === 'invalid') {
          for (const id of (idToIds.get(r.id) || [r.id])) badIds.push(id);
        }
      }
    }
  }
  return { sent, failed: failedTotal, failedSample: failed, badIds, rateLimited };
}

async function sendGlobal(env, store, row, request) {
  const data = { gid: row.id, link: row.targetUrl || 'notifications', type: row.type, src: 'fcm-global' };
  const iconUrl = iconAbsolute(request);
  const visual = { imageUrl: row.imageUrl, iconUrl, badgeUrl: iconUrl };
  const budget = Math.max(0, Number(env?.FCM_FANOUT_BUDGET || DEFAULT_WINDOW_BUDGET));
  const ledger = new FanoutStore(env?.PROFILE_DB);
  const prior = store.available() && ledger.available() ? await ledger.getState(row.id) : null;
  /* A row still 'scheduled' with progress means an earlier tick sliced it and
   * owes more. The topic send already reached every subscriber on that first
   * tick, so resuming must NOT re-fire it, it continues the per-device tail. */
  const resuming = Boolean(prior && prior.cursor > 0 && prior.status !== 'complete');
  let topicRes = { ok: resuming, name: null, detail: resuming ? 'resumed' : null };
  let fallbackSent = 0;
  let fallbackFailed = 0;
  let deferred = 0;
  let reach = await store.activeDeviceCount();

  if (!resuming) {
    topicRes = await fcmSendToTopic(env, row.topic, { title: row.title, body: row.body, ...visual, data });
  }
  /* Hybrid (spec §23 + iOS topic support varies by browser): topic first;
   * only devices WITHOUT the topic get the per-device fallback. If the topic
   * send itself failed, every active device goes through the fallback. */
  const targets = topicRes.ok
    ? await store.activeDevicesMissingTopic(row.topic)
    : await store.allActiveTokens();
  if (targets.length) {
    /* Phase 5: a fanout past the per-run budget is sliced and the cursor is
     * persisted, so the next tick resumes it instead of re-sending to everyone
     * below the cursor. Small sends fit in one tick and are unchanged. The
     * cursor is positional, which is why the ledger also records `total`: a
     * size change restarts rather than skips. */
    if (budget > 0 && targets.length > budget) {
      /* advanceFanout reads its own ledger state: a resume continues from the
       * stored cursor, and a changed audience size restarts from the top. */
      const plan = await advanceFanout(ledger, row.id, targets.length, { budget });
      const slice = targets.slice(plan.start, plan.end);
      const out = await fcmSendToTokens(env, slice, { title: row.title, body: row.body, ...visual, data });
      fallbackSent = out.sent;
      fallbackFailed = out.failed;
      deferred = plan.remaining;
      if (out.badIds.length) await store.markInactive(out.badIds, Date.now());
    } else {
      const out = await fcmSendToTokens(env, targets, { title: row.title, body: row.body, ...visual, data });
      fallbackSent = out.sent;
      fallbackFailed = out.failed;
      if (out.badIds.length) await store.markInactive(out.badIds, Date.now());
    }
  }
  /* Distinct physical devices, not user rows: the same phone under several
   * accounts is one device and must not inflate the delivered count. */
  reach = await store.activeDeviceCount();
  const ok = topicRes.ok || fallbackSent > 0;
  /* A "sent" row must mean at least one device really accepted the message.
   * The delivered count is stored so a future "users get nothing" report can
   * be answered from the row itself instead of re-deriving it from code. */
  const delivered = topicRes.ok ? reach : fallbackSent;
  /* More ticks are owed: leave the row scheduled so the next cron resumes it
   * instead of marking it sent and silently dropping the deferred tail. */
  if (deferred > 0) {
    await store.updateGlobalStatus(row.id, {
      status: 'scheduled',
      error: null,
      reachEstimate: reach,
      delivered
    });
    return { ok, topicOk: topicRes.ok, fallbackSent, fallbackFailed, reach, delivered, deferred };
  }
  await store.updateGlobalStatus(row.id, {
    status: ok ? 'sent' : 'failed',
    sentAt: Date.now(),
    fcmMessageId: topicRes.name || null,
    reachEstimate: reach,
    delivered,
    error: ok ? null : String(topicRes.detail || 'send-failed').slice(0, 200)
  });
  return { ok, topicOk: topicRes.ok, fallbackSent, fallbackFailed, reach, delivered, deferred: 0 };
}

/* Read the effectiveness numbers for a set of global rows: distinct readers per
 * notification plus the dead-token count. Kept out of the routes so the history
 * and the analytics endpoint cannot compute the funnel two different ways. */
async function analyticsFor(env, items) {
  const store = new AnalyticsStore(env?.PROFILE_DB);
  if (!store.available()) return computeAnalytics(items, {}, 0);
  try {
    const [readCounts, invalidTokens] = await Promise.all([
      store.readCounts(items.map(r => r.id)),
      store.inactiveDeviceCount()
    ]);
    return computeAnalytics(items, readCounts, invalidTokens);
  } catch (_) {
    /* Analytics must never break the history the admin came for. */
    return computeAnalytics(items, {}, 0);
  }
}

/* Cron entry (Cloudflare Cron Triggers): send every due scheduled global.
 * Exported so the worker entry can call it from scheduled(). */
export async function runScheduledGlobalNotifications(env) {
  if (!fcmConfigured(env)) return { processed: 0 };
  const store = new FcmStore(env?.PROFILE_DB);
  if (!store.available()) return { processed: 0 };
  /* Recover sends that died mid-flight: a row left in 'sending' (worker killed
   * between insert and update) would otherwise sit there forever, counted
   * neither as sent nor failed. Mark it failed so the history is truthful. */
  try { await store.failStaleSending(Date.now() - 10 * 60_000); } catch (_) { /* best effort */ }
  const due = await store.dueGlobals(Date.now());
  let processed = 0;
  for (const row of due) {
    try {
      await sendGlobal(env, store, row);
    } catch (e) {
      await store.updateGlobalStatus(row.id, { status: 'failed', sentAt: Date.now(), error: String(e?.message || e).slice(0, 200) });
    }
    processed += 1;
  }
  return { processed };
}

/* Key for the daily global-send cap. The cap resets at 00:00 UTC: the KV entry
 * lives under one UTC date with a 24h TTL, so counting a UTC day is what the
 * limiter actually enforces. (This used to be called dhakaDayKey while also
 * using the UTC date, the admin panel then labelled the window "Asia/Dhaka",
 * which was wrong by 6 hours.) */
const utcDayKey = () => new Date().toISOString().slice(0, 10);

/* ── Route handler ───────────────────────────────────────────────────────── */
export async function handleFcmNotificationRequest(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  const isApi = path.startsWith('/api/notifications/');
  const isInternal = path === '/internal/notifications/health';
  if (!isApi && !isInternal) return null;

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: {
      ...corsHeaders(request),
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400'
    } });
  }

  const store = new FcmStore(env.PROFILE_DB);

  // Public web app config (Firebase web config values are public by design).
  if (path === '/api/notifications/config' && request.method === 'GET') {
    return jsonResponse(request, { ok: true, fcmConfigured: fcmConfigured(env), webConfig: publicWebConfig(env) });
  }

  if (path === '/internal/notifications/health') {
    return jsonResponse(request, {
      ok: true,
      fcmConfigured: fcmConfigured(env),
      d1: store.available(),
      authAuthority: Boolean(env?.AUTH_AUTHORITY?.idFromName),
      kv: Boolean(env?.GK_KV),
      at: Date.now()
    });
  }

  /* ── Phase 2: global notification ADMIN routes ─────────────────────────────
   * The Bearer ADMIN_TOKEN is the credential, a valid token is enough, with
   * or without a logged-in session (the session, when present, is only used
   * to record who the admin is). Keeps the Admin Center usable from any
   * device/browser. User routes below still require a session. */
  const ADMIN_PATHS = new Set([
    '/api/notifications/global/send',
    '/api/notifications/global/schedule',
    '/api/notifications/global/cancel',
    '/api/notifications/global/image',
    '/api/notifications/history',
    '/api/notifications/analytics',
    '/api/notifications/templates'
  ]);
  if (ADMIN_PATHS.has(path)) {
    const adminToken = String(request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
    /* Two ways in: the break-glass ADMIN_TOKEN, or a short-lived passkey
     * session minted by /api/admin/webauthn/assert. The session path exists so
     * the owner stops carrying a long-lived secret in a browser. */
    const tokenOk = Boolean(env.ADMIN_TOKEN) && adminToken === env.ADMIN_TOKEN;
    const adminSession = tokenOk ? null : await readAdminSession(env, request);
    if (!tokenOk && !adminSession) {
      return jsonResponse(request, { error: 'forbidden' }, 403);
    }
    const maybeSession = await sessionUser(env, request);
    const adminUserId = maybeSession ? String(maybeSession.user.id) : (adminSession ? `passkey:${adminSession.credentialId.slice(0, 12)}` : 'admin');
    if (path === '/api/notifications/global/send' && request.method === 'POST') {
      if (!fcmConfigured(env)) return jsonResponse(request, { error: 'fcm-not-configured' }, 503);
      if (!store.available()) return jsonResponse(request, { error: 'storage-unavailable' }, 503);
      const body = await parseBody(request);
      if (!body) return jsonResponse(request, { error: 'invalid-json' }, 400);
      const type = GLOBAL_TYPES.includes(body.type) ? body.type : null;
      if (!type) return rejectNotify(request, "invalid-type", body);
      const title = String(body.title || '').trim().slice(0, 120);
      const text = String(body.body || '').trim().slice(0, 400);
      if (title.length < 1 || title.length > 120) return rejectNotify(request, "invalid-title", { title, n: title.length });
      if (text.length < 1 || text.length > 400) return rejectNotify(request, "invalid-body", { n: text.length });
      const imageUrl = String(body.imageUrl || '').slice(0, 500) || null;
      const targetUrl = String(body.targetUrl || '').replace(/[^\w./#-]/g, '').slice(0, 200) || null;
      const audience = GLOBAL_AUDIENCES[body.audience] ? body.audience : 'all_students';
      const topic = GLOBAL_AUDIENCES[audience].topic;
      if (!TOPIC_RE.test(topic)) return jsonResponse(request, { error: 'invalid-topic' }, 500);
      /* Rule (spec §17): duplicate protection, the same *send* within 10 days.
       * The mode is part of the key: scheduling a message is a different intent
       * from sending it, so an earlier test-send of identical text must not
       * make the real scheduled message impossible to create (that 409 was why
       * no scheduled notification could ever be saved). */
      const dedup = (await sha256Hex(`${type}|${title}|${text}|now`)).slice(0, 40);
      const dup = await store.duplicateRecent(dedup, Date.now() - 10 * 86400000);
      if (dup) return jsonResponse(request, { error: 'duplicate', existingId: dup }, 409);
      /* Rule (spec §17): daily spam cap. */
      if (!(await kvRateAllow(env, `global:day:${utcDayKey()}`, GLOBAL_DAILY_CAP, 86400))) {
        return jsonResponse(request, { error: 'rate-limited' }, 429);
      }
      const id = `gn-${Math.random().toString(36).slice(2, 8)}${Math.random().toString(36).slice(2, 8)}`;
      const row = {
        id, type, title, body: text, imageUrl, targetUrl,
        audience, topic, dedup, scheduledAt: null,
        createdBy: adminUserId, status: 'sending', createdAt: Date.now()
      };
      await store.insertGlobal(row);
      /* Subscribe the creator's own device(s) to the audience topic so the
       * admin who just sent is reachable, and record the topic only if FCM
       * accepted it, same rule as register-token, or the fallback would skip
       * the device while the topic send never reached it. */
      if (body.deviceToken) {
        const adminDeviceToken = String(body.deviceToken);
        try {
          const sub = await subscribeDeviceToTopic(env, adminDeviceToken, topic);
          if (sub.ok) await store.setDeviceTopics(adminUserId, adminDeviceToken, topic);
        } catch (_) { /* fallback covers this device */ }
      }
      let result;
      try {
        result = await sendGlobal(env, store, row, request);
      } catch (e) {
        /* Never leave a row stuck in 'sending': a thrown fanout used to strand
         * it there forever, invisible to both the history view and the cron. */
        await store.updateGlobalStatus(id, { status: 'failed', sentAt: Date.now(), error: String(e?.message || e).slice(0, 200) });
        result = { ok: false, reach: 0, delivered: 0 };
      }
      return jsonResponse(request, { ok: result.ok, id, status: result.ok ? 'sent' : 'failed', reachEstimate: result.reach, delivered: result.delivered }, result.ok ? 201 : 502);
    }

    if (path === '/api/notifications/global/schedule' && request.method === 'POST') {
      if (!store.available()) return jsonResponse(request, { error: 'storage-unavailable' }, 503);
      const body = await parseBody(request);
      if (!body) return jsonResponse(request, { error: 'invalid-json' }, 400);
      const type = GLOBAL_TYPES.includes(body.type) ? body.type : null;
      if (!type) return jsonResponse(request, { error: 'invalid-type' }, 400);
      const title = String(body.title || '').trim().slice(0, 120);
      const text = String(body.body || '').trim().slice(0, 400);
      if (title.length < 1 || title.length > 120) return jsonResponse(request, { error: 'invalid-title' }, 400);
      if (text.length < 1 || text.length > 400) return jsonResponse(request, { error: 'invalid-body' }, 400);
      const imageUrl = String(body.imageUrl || '').slice(0, 500) || null;
      const targetUrl = String(body.targetUrl || '').replace(/[^\w./#-]/g, '').slice(0, 200) || null;
      const audience = GLOBAL_AUDIENCES[body.audience] ? body.audience : 'all_students';
      const topic = GLOBAL_AUDIENCES[audience].topic;
      const when = Number(body.scheduledAt);
      if (!Number.isFinite(when) || when <= Date.now() + 60_000) {
        return jsonResponse(request, { error: 'invalid-schedule' }, 400);
      }
      if (when > Date.now() + GLOBAL_MAX_SCHEDULE_DAYS * 86400000) {
        return jsonResponse(request, { error: 'schedule-too-far' }, 400);
      }
      /* Same mode-aware key as /global/send. Scheduled rows also carry the
       * target time so re-scheduling the same text for a different slot is
       * allowed rather than silently rejected as a duplicate. */
      const dedup = (await sha256Hex(`${type}|${title}|${text}|scheduled|${Math.floor(when)}`)).slice(0, 40);
      const dup = await store.duplicateRecent(dedup, Date.now() - 10 * 86400000);
      if (dup) return jsonResponse(request, { error: 'duplicate', existingId: dup }, 409);
      const id = `gn-${Math.random().toString(36).slice(2, 8)}${Math.random().toString(36).slice(2, 8)}`;
      await store.insertGlobal({
        id, type, title, body: text, imageUrl, targetUrl,
        audience, topic, dedup, scheduledAt: Math.floor(when),
        createdBy: adminUserId, status: 'scheduled', createdAt: Date.now()
      });
      return jsonResponse(request, { ok: true, id, status: 'scheduled', scheduledAt: Math.floor(when) }, 201);
    }

    if (path === '/api/notifications/global/cancel' && request.method === 'POST') {
      if (!store.available()) return jsonResponse(request, { error: 'storage-unavailable' }, 503);
      const body = await parseBody(request);
      if (!body) return jsonResponse(request, { error: 'invalid-json' }, 400);
      const id = String(body.id || '');
      if (!GN_ID_RE.test(id)) return jsonResponse(request, { error: 'invalid-id' }, 400);
      const rows = await store.recentGlobals(50);
      const row = rows.find(r => r.id === id);
      if (!row) return jsonResponse(request, { error: 'not-found' }, 404);
      if (row.status !== 'scheduled') return jsonResponse(request, { error: 'not-scheduled' }, 409);
      await store.updateGlobalStatus(id, { status: 'cancelled' });
      return jsonResponse(request, { ok: true, id, status: 'cancelled' });
    }

    if (path === '/api/notifications/history' && request.method === 'GET') {
      if (!store.available()) return jsonResponse(request, { error: 'storage-unavailable' }, 503);
      const items = await store.recentGlobals(50);
      /* Phase 4 analytics ride along with the history the admin already loads,
       * so the Sent tab shows real effectiveness with no extra request. */
      const analytics = await analyticsFor(env, items);
      return jsonResponse(request, {
        ok: true,
        items,
        analytics,
        reachEstimate: await store.activeDeviceCount(),
        dailyCap: GLOBAL_DAILY_CAP,
        /* Real sends counted against today's cap, straight from the limiter's own
         * counter. The panel used to show the total history length here, so a
         * busy month read as "50 / 10" and looked permanently over quota. */
        dailyUsed: await kvRatePeek(env, `global:day:${utcDayKey()}`)
      });
    }

    if (path === '/api/notifications/analytics' && request.method === 'GET') {
      if (!store.available()) return jsonResponse(request, { error: 'storage-unavailable' }, 503);
      const items = await store.recentGlobals(50);
      const analytics = await analyticsFor(env, items);
      return jsonResponse(request, { ok: true, ...analytics });
    }

    if (path === '/api/notifications/templates' && request.method === 'GET') {
      return jsonResponse(request, { ok: true, templates: GLOBAL_TEMPLATES });
    }

    if (path === '/api/notifications/global/image' && request.method === 'POST') {
      /* Lets the admin attach a picture straight from the phone instead of
       * pasting a URL. Stored in the same R2 bucket and served from our own
       * /api/files/<key> path, so the FCM `image` field gets a stable https URL
       * with no egress cost. Auth is the admin Bearer token (ADMIN_PATHS). */
      const bucket = env?.FILE_BUCKET;
      if (!bucket || typeof bucket.put !== 'function') return jsonResponse(request, { error: 'storage-unavailable' }, 503);
      const ext = String(request.headers.get('X-File-Ext') || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      const type = IMAGE_TYPES[ext];
      if (!type) return jsonResponse(request, { error: 'invalid-type' }, 400);
      const declared = Number(request.headers.get('Content-Length') || 0);
      if (!declared || declared > NOTIFY_IMAGE_MAX_BYTES) return jsonResponse(request, { error: 'too-large' }, 413);
      let bytes;
      try { bytes = new Uint8Array(await request.arrayBuffer()); } catch { return jsonResponse(request, { error: 'read-failed' }, 400); }
      if (!bytes.length || bytes.length > NOTIFY_IMAGE_MAX_BYTES) return jsonResponse(request, { error: 'too-large' }, 413);
      const day = new Date().toISOString().slice(0, 10);
      /* The key must match files-storage KEY_RE
       * (`folder/<segment>/<date>/<rand>.<ext>`), or the public GET rejects it
       * as 404 and the notification image renders as a broken "?", a
       * tell-tale that upload succeeded but read-back did not. */
      const owner = String(adminUserId).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64) || 'admin';
      const key = `notify/${owner}/${day}/${randKey(12)}.${ext}`;
      try { await bucket.put(key, bytes, { httpMetadata: { contentType: type } }); }
      catch { return jsonResponse(request, { error: 'storage-error' }, 503); }
      const url = `${publicOrigin(request)}/api/files/${key}`;
      return jsonResponse(request, { ok: true, url, key }, 201);
    }

  }

  // Everything below requires an authenticated student.
  const session = await sessionUser(env, request);
  if (!session) return jsonResponse(request, { error: 'auth-required' }, 401);
  const userId = String(session.user.id);

  if (path === '/api/notifications/status' && request.method === 'GET') {
    const prefs = store.available() ? await store.getPrefs(userId) : { ...DEFAULT_PREFS, stored: false };
    const devices = store.available() ? (await store.activeDevices(userId)).length : 0;
    return jsonResponse(request, {
      ok: true,
      fcmConfigured: fcmConfigured(env),
      pushEnabled: Boolean(prefs.push_enabled),
      devices
    });
  }

  if (path === '/api/notifications/register-token' && request.method === 'POST') {
    if (!store.available()) return jsonResponse(request, { error: 'storage-unavailable' }, 503);
    if (!(await kvRateAllow(env, `reg:${userId}`, 10, 3600))) {
      return jsonResponse(request, { error: 'rate-limited' }, 429);
    }
    const body = await parseBody(request);
    if (!body) return jsonResponse(request, { error: 'invalid-json' }, 400);
    const token = String(body.token || '');
    if (token.length < TOKEN_MIN_LEN || token.length > TOKEN_MAX_LEN) {
      return jsonResponse(request, { error: 'invalid-token' }, 400);
    }
    const platform = PLATFORM_RE.test(String(body.platform || '')) ? String(body.platform) : 'web';
    const browser = PLATFORM_RE.test(String(body.browser || '')) ? String(body.browser) : 'unknown';
    const deviceInfo = String(body.deviceInfo || '').slice(0, 120);
    const now = Date.now();
    await store.upsertDevice({ userId, token, platform, browser, deviceInfo, now });
    /* Subscribe server-side so the topic path actually reaches this device.
     * Best-effort: a topic failure must never fail registration, the per-device
     * fallback still covers the device. Only record the topic when FCM accepted
     * it, otherwise `topics` would lie and the device would be skipped by the
     * fallback too. */
    let topicOk = false;
    try {
      const sub = await subscribeDeviceToTopic(env, token, GLOBAL_TOPIC);
      topicOk = sub.ok;
      if (sub.ok) await store.setDeviceTopics(userId, token, GLOBAL_TOPIC);
    } catch (_) { /* fallback covers this device */ }
    /* Round 8 (owner directive 2026-09-17): no welcome push, enabling is
     * silent; the user sees nothing after tapping Allow. The bell opening
     * the inbox is the confirmation. */
    return jsonResponse(request, { ok: true, registered: true, topicSubscribed: topicOk, devices: (await store.activeDevices(userId)).length }, 201);
  }

  if (path === '/api/notifications/unregister-token' && request.method === 'POST') {
    if (!store.available()) return jsonResponse(request, { error: 'storage-unavailable' }, 503);
    const body = await parseBody(request);
    if (!body) return jsonResponse(request, { error: 'invalid-json' }, 400);
    const token = String(body.token || '');
    if (!token) return jsonResponse(request, { error: 'invalid-token' }, 400);
    const changed = await store.deactivateToken(userId, token);
    return jsonResponse(request, { ok: true, deactivated: changed, devices: (await store.activeDevices(userId)).length });
  }

  if (path === '/api/notifications/devices' && request.method === 'GET') {
    if (!store.available()) return jsonResponse(request, { error: 'storage-unavailable' }, 503);
    return jsonResponse(request, { ok: true, devices: await store.activeDevices(userId) });
  }

  if (path === '/api/notifications/preferences' && request.method === 'GET') {
    if (!store.available()) return jsonResponse(request, { error: 'storage-unavailable' }, 503);
    const prefs = await store.getPrefs(userId);
    return jsonResponse(request, { ok: true, prefs: { ...prefs, stored: undefined }, defaults: DEFAULT_PREFS });
  }

  if (path === '/api/notifications/preferences' && request.method === 'POST') {
    if (!store.available()) return jsonResponse(request, { error: 'storage-unavailable' }, 503);
    const body = await parseBody(request);
    if (!body) return jsonResponse(request, { error: 'invalid-json' }, 400);
    const current = await store.getPrefs(userId);
    const asBool = value => (value === undefined ? null : (value ? 1 : 0));
    const next = {
      push_enabled: asBool(body.push_enabled) ?? current.push_enabled,
      global_enabled: asBool(body.global_enabled) ?? current.global_enabled,
      personalized_enabled: asBool(body.personalized_enabled) ?? current.personalized_enabled,
      event_enabled: asBool(body.event_enabled) ?? current.event_enabled,
      quiet_hours_enabled: asBool(body.quiet_hours_enabled) ?? current.quiet_hours_enabled
    };
    const quietStart = body.quiet_start === undefined ? current.quiet_start : String(body.quiet_start);
    const quietEnd = body.quiet_end === undefined ? current.quiet_end : String(body.quiet_end);
    if (!QUIET_RE.test(quietStart) || !QUIET_RE.test(quietEnd)) {
      return jsonResponse(request, { error: 'invalid-quiet-hours' }, 400);
    }
    next.quiet_start = quietStart;
    next.quiet_end = quietEnd;
    await store.savePrefs(userId, next, Date.now());
    return jsonResponse(request, { ok: true, prefs: next });
  }

  if (path === '/api/notifications/test' && request.method === 'POST') {
    const token = String(request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
    if (!env.ADMIN_TOKEN || token !== env.ADMIN_TOKEN) {
      return jsonResponse(request, { error: 'forbidden' }, 403);
    }
    if (!fcmConfigured(env)) return jsonResponse(request, { error: 'fcm-not-configured' }, 503);
    if (!store.available()) return jsonResponse(request, { error: 'storage-unavailable' }, 503);
    if (!(await kvRateAllow(env, `test:${userId}`, 5, 600))) {
      return jsonResponse(request, { error: 'rate-limited' }, 429);
    }
    const body = await parseBody(request) || {};
    const title = String(body.title || '🔔 Admission Hub').slice(0, 120);
    const text = String(body.body || 'FCM notification system successfully configured.').slice(0, 400);
    const link = String(body.link || '/').replace(/[^\w./#-]/g, '').slice(0, 200);
    const targets = (await store.activeTokens(userId)).slice(0, 8);
    if (!targets.length) return jsonResponse(request, { error: 'no-devices' }, 404);
    const results = [];
    for (const device of targets) {
      const outcome = await fcmSendToDevice(env, { token: device.token, title, body: text, data: { link, src: 'fcm-test' } });
      if (!outcome.ok && (outcome.reason === 'unregistered' || outcome.reason === 'invalid')) {
        await store.markInactive([device.id], Date.now());
      }
      results.push({ id: device.id, ok: outcome.ok, reason: outcome.reason || 'ok' });
    }
    return jsonResponse(request, { ok: results.every(r => r.ok), sent: results.filter(r => r.ok).length, total: results.length, results });
  }

  /* Self-service test push: an authenticated user sends a test notification
   * to their OWN registered devices, no admin token needed (owner directive
   * 2026-09-17: "টোকেনের ঝামেলা না"). Strictly rate-limited (3/hour). */
  if (path === '/api/notifications/self-test' && request.method === 'POST') {
    if (!fcmConfigured(env)) return jsonResponse(request, { error: 'fcm-not-configured' }, 503);
    if (!store.available()) return jsonResponse(request, { error: 'storage-unavailable' }, 503);
    if (!(await kvRateAllow(env, `selftest:${userId}`, 3, 3600))) {
      return jsonResponse(request, { error: 'rate-limited' }, 429);
    }
    const targets = (await store.activeTokens(userId)).slice(0, 8);
    if (!targets.length) return jsonResponse(request, { error: 'no-devices' }, 404);
    const results = [];
    for (const device of targets) {
      const outcome = await fcmSendToDevice(env, {
        token: device.token,
        title: '📡 Test notification',
        body: 'এটি Admission Hub-এর test push, সিস্টেম ঠিকঠাক চলছে ✅',
        data: { link: 'notifications', src: 'fcm-self-test' }
      });
      if (!outcome.ok && (outcome.reason === 'unregistered' || outcome.reason === 'invalid')) {
        await store.markInactive([device.id], Date.now());
      }
      results.push({ id: device.id, ok: outcome.ok, reason: outcome.reason || 'ok' });
    }
    return jsonResponse(request, { ok: results.every(r => r.ok), sent: results.filter(r => r.ok).length, total: results.length, results });
  }

  /* ── Phase 2: user routes (session) ─────────────────────────────────────── */
  if (path === '/api/notifications/topics/subscribe' && request.method === 'POST') {
    if (!store.available()) return jsonResponse(request, { error: 'storage-unavailable' }, 503);
    const body = await parseBody(request);
    if (!body) return jsonResponse(request, { error: 'invalid-json' }, 400);
    const token = String(body.token || '');
    const topics = Array.isArray(body.topics) ? body.topics.map(t => String(t)).filter(t => TOPIC_RE.test(t)).slice(0, 10) : [];
    if (token.length < TOKEN_MIN_LEN || topics.length < 1) return jsonResponse(request, { error: 'invalid-payload' }, 400);
    /* Subscribe through IID and record only what FCM actually accepted, so
     * `topics` never claims a subscription the device does not have, the
     * fallback decides from this column whether a device still needs a send. */
    const accepted = [];
    for (const topic of topics) {
      const sub = await subscribeDeviceToTopic(env, token, topic);
      if (sub.ok) accepted.push(topic);
    }
    if (accepted.length) await store.setDeviceTopics(userId, token, accepted.join(','));
    return jsonResponse(request, { ok: accepted.length === topics.length, topics: accepted });
  }

  if (path === '/api/notifications/topics/unsubscribe' && request.method === 'POST') {
    if (!store.available()) return jsonResponse(request, { error: 'storage-unavailable' }, 503);
    const body = await parseBody(request);
    if (!body) return jsonResponse(request, { error: 'invalid-json' }, 400);
    const token = String(body.token || '');
    if (token.length < TOKEN_MIN_LEN) return jsonResponse(request, { error: 'invalid-payload' }, 400);
    const topics = Array.isArray(body.topics) && body.topics.length
      ? body.topics.map(t => String(t)).filter(t => TOPIC_RE.test(t)).slice(0, 10)
      : [GLOBAL_TOPIC];
    /* Remove from IID first so the device really stops receiving the topic,
     * then clear the local column. Both are best-effort: the column must not
     * keep advertising a subscription the backend dropped. */
    for (const topic of topics) await unsubscribeDeviceFromTopic(env, token, topic);
    await store.setDeviceTopics(userId, token, '');
    return jsonResponse(request, { ok: true });
  }

  if (path === '/api/notifications/inbox' && request.method === 'GET') {
    if (!store.available()) return jsonResponse(request, { error: 'storage-unavailable' }, 503);
    const feed = await store.globalFeed(30);
    const reads = await store.readState(userId, feed.map(r => r.id));
    const saves = await store.saveState(userId, feed.map(r => r.id));
    /* Inbox v7: each row says which inbox tab owns it (notice board vs.
     * notification list) and whether the student saved it. */
    const items = feed.map(r => ({
      ...r,
      readAt: reads[r.id] || null,
      savedAt: saves[r.id] || null,
      kind: NOTICE_TYPES.has(r.type) ? 'notice' : 'notification'
    }));
    return jsonResponse(request, { ok: true, items, unread: items.filter(r => !r.readAt).length });
  }

  if (path === '/api/notifications/read-all' && request.method === 'POST') {
    if (!store.available()) return jsonResponse(request, { error: 'storage-unavailable' }, 503);
    if (!(await kvRateAllow(env, `readall:${userId}`, 20, 600))) return jsonResponse(request, { error: 'rate-limited' }, 429);
    const feed = await store.globalFeed(30);
    const reads = await store.readState(userId, feed.map(r => r.id));
    const ids = feed.map(r => r.id).filter(id => !reads[id]);
    const marked = await store.markAllRead(userId, ids, Date.now());
    return jsonResponse(request, { ok: true, marked });
  }

  if (path === '/api/notifications/save' && request.method === 'POST') {
    if (!store.available()) return jsonResponse(request, { error: 'storage-unavailable' }, 503);
    const body = await parseBody(request);
    if (!body) return jsonResponse(request, { error: 'invalid-json' }, 400);
    const id = String(body.id || '');
    if (!GN_ID_RE.test(id)) return jsonResponse(request, { error: 'invalid-id' }, 400);
    if (!(await kvRateAllow(env, `save:${userId}`, 60, 600))) return jsonResponse(request, { error: 'rate-limited' }, 429);
    const saved = body.saved !== false;
    await store.setSaved(userId, id, saved, Date.now());
    return jsonResponse(request, { ok: true, id, saved });
  }

  if (path === '/api/notifications/read' && request.method === 'POST') {
    if (!store.available()) return jsonResponse(request, { error: 'storage-unavailable' }, 503);
    const body = await parseBody(request);
    if (!body) return jsonResponse(request, { error: 'invalid-json' }, 400);
    const id = String(body.id || '');
    if (!GN_ID_RE.test(id)) return jsonResponse(request, { error: 'invalid-id' }, 400);
    await store.markRead(id, userId, Date.now());
    return jsonResponse(request, { ok: true, id });
  }

  if (path === '/api/notifications/click' && request.method === 'POST') {
    if (!store.available()) return jsonResponse(request, { error: 'storage-unavailable' }, 503);
    const body = await parseBody(request);
    if (!body) return jsonResponse(request, { error: 'invalid-json' }, 400);
    const id = String(body.id || '');
    if (!GN_ID_RE.test(id)) return jsonResponse(request, { error: 'invalid-id' }, 400);
    if (!(await kvRateAllow(env, `click:${userId}`, 60, 600))) return jsonResponse(request, { error: 'rate-limited' }, 429);
    await store.incrementClicks(id);
    return jsonResponse(request, { ok: true, id });
  }

  return jsonResponse(request, { error: 'not-found' }, 404);
}

export const __fcmNotificationTest = Object.freeze({
  sendGlobal,
  runScheduledGlobalNotifications,
  fcmSendToTopic,
  fcmSendToTokens,
  GLOBAL_TYPES,
  GLOBAL_AUDIENCES,
  GLOBAL_TEMPLATES,
  b64u,
  sha256Hex,
  readSessionToken,
  pemToDer,
  FcmStore,
  fcmConfigured,
  publicWebConfig,
  kvRateAllow,
  DEFAULT_PREFS
});
