// Security alerts to the owner's Telegram (P30, component 9).
//
// Three events matter enough to interrupt the owner: a canary hit, a
// shadow-ban, and a login from a new device. Everything else is a log row.
//
// The bot token and chat id come from Worker secrets and are never written
// into a message, a log or an error. If either is unbound the function
// returns 'not-configured' rather than throwing: a missing secret must not
// turn a security event into a failed login.

export const SECURITY_ALERT_POLICY_VERSION = 'security-alert-v1';

export const SECURITY_ALERT_EVENTS = Object.freeze({
  CANARY_HIT: 'canary-hit',
  SHADOW_BAN: 'shadow-ban',
  NEW_DEVICE: 'new-device'
});

const MAX_FIELD = 200;

// The value is attacker-controlled (an email, a country, a user agent), so it
// is stripped of control characters and truncated before it reaches a message.
const field = (value, max = MAX_FIELD) =>
  typeof value === 'string'
    ? value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, max)
    : '';

const EMAIL_SHAPE = /^([^@\s]{1,64})@([^@\s]{1,190})$/;

// The owner gets enough to act on without the alert itself becoming a place
// a leaked address can be read from: the local part is masked the same way
// the rest of the auth code masks it.
export function maskAlertEmail(value) {
  const email = field(value, 254);
  const match = EMAIL_SHAPE.exec(email);
  if (!match) return '';
  const local = match[1];
  const head = local.slice(0, 1);
  return `${head}${'*'.repeat(Math.max(3, local.length - 1))}@${match[2].toLowerCase()}`;
}

const LABELS = Object.freeze({
  [SECURITY_ALERT_EVENTS.CANARY_HIT]: '🍯 ক্যানারি অ্যাকাউন্টে চেষ্টা',
  [SECURITY_ALERT_EVENTS.SHADOW_BAN]: '👻 ছায়া-ব্যান হয়েছে',
  [SECURITY_ALERT_EVENTS.NEW_DEVICE]: '📱 নতুন ডিভাইসে লগইন'
});

/**
 * Render one alert. Returns null for an unknown event, so a typo cannot send
 * a half-built message.
 */
export function renderSecurityAlert(input = {}) {
  const event = String(input.event || '');
  const label = LABELS[event];
  if (!label) return null;

  const lines = [label];
  const email = maskAlertEmail(input.email);
  if (email) lines.push(`অ্যাকাউন্ট: ${email}`);
  const country = field(input.country, 40);
  if (country) lines.push(`দেশ: ${country}`);
  const band = field(input.band, 20);
  if (band) lines.push(`ঝুঁকি: ${band}`);
  const reasons = Array.isArray(input.reasons)
    ? input.reasons.map(value => field(value, 40)).filter(Boolean).slice(0, 5)
    : [];
  if (reasons.length) lines.push(`কারণ: ${reasons.join(', ')}`);
  const at = Number(input.at);
  if (Number.isFinite(at) && at > 0) lines.push(`সময়: ${new Date(at).toISOString()}`);

  return Object.freeze({ event, text: lines.join('\n') });
}

/**
 * Send one alert. Never throws: a failed alert is reported as a value, so
 * the caller's login path is never broken by a Telegram outage.
 *
 * @returns {'sent'|'not-configured'|'failed'|'unknown-event'}
 */
export async function sendSecurityAlert(env, input = {}, options = {}) {
  const rendered = renderSecurityAlert(input);
  if (!rendered) return 'unknown-event';

  const token = String(env?.TG_BOT_TOKEN || '');
  const chatId = String(env?.TG_CHAT_ID || '');
  if (!token || !chatId) return 'not-configured';

  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') return 'failed';

  try {
    const response = await fetchImpl(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: rendered.text, disable_web_page_preview: true })
    });
    return response?.ok ? 'sent' : 'failed';
  } catch {
    return 'failed';
  }
}

// Alerts are best-effort and must not sit on the response path: a login must
// not wait for Telegram. The caller gets a promise it can ignore.
export function sendSecurityAlertInBackground(env, input, options = {}) {
  return Promise.resolve()
    .then(() => sendSecurityAlert(env, input, options))
    .catch(() => 'failed');
}

// Without this, one determined attacker turns the owner's Telegram into a
// firehose: every attempt is an event, and a stuffing run is thousands. The
// first event for a given shape is delivered; repeats inside the window are
// dropped. A key that cannot be read is treated as "not seen", because
// swallowing a real first alert is worse than one duplicate.
export function createKvAlertThrottle(store, options = {}) {
  const prefix = String(options.prefix || 'alert-seen');
  const windowMs = Number(options.windowMs) > 0 ? Number(options.windowMs) : 60 * 60 * 1000;
  const now = typeof options.now === 'function' ? options.now : () => Date.now();

  // A short hash keeps an address out of the key space, so the store never
  // holds a readable account identifier.
  const digest = async value => {
    const subtle = globalThis.crypto?.subtle;
    if (!subtle) return String(value).length.toString(36);
    const bytes = new TextEncoder().encode(String(value));
    const hash = await subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(hash).slice(0, 8)].map(b => b.toString(16).padStart(2, '0')).join('');
  };

  return Object.freeze({
    /** @returns {boolean} true when this event should be delivered. */
    async shouldSend(event, identity) {
      if (!store) return true;
      const key = `${prefix}:${event}:${await digest(`${identity || ''}`)}`;
      try {
        const seen = await store.get(key);
        if (seen) return false;
        await store.put(key, '1', { expirationTtl: Math.max(60, Math.ceil(windowMs / 1000)) });
        return true;
      } catch {
        return true;
      }
    },
    /** Exposed for tests. */
    keyFor: async (event, identity) => `${prefix}:${event}:${await digest(`${identity || ''}`)}`,
    windowMs,
    now
  });
}

// Throttled send: the caller never waits, and a burst collapses to one alert.
export function sendThrottledSecurityAlert(env, store, input = {}, options = {}) {
  return Promise.resolve()
    .then(async () => {
      const throttle = createKvAlertThrottle(store, options);
      if (!(await throttle.shouldSend(input.event, input.email || input.identity || ''))) return 'throttled';
      return sendSecurityAlert(env, input, options);
    })
    .catch(() => 'failed');
}
