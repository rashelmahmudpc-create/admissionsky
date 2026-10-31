// AUTH-ROADMAP step 0 (owner 2026-10-18): Workers Logs line for every OTP send.
//
// The verification orchestrator (auth-native/) never logs by itself; it hands one
// event per provider try ("otp_delivery") and one per request ("otp_request") to
// this sink. Only the allow-listed fields below survive, so an address, OTP code,
// link token or full attempt id can never reach the log even if a caller passes it.

export const OTP_PROVIDER_NAMES = Object.freeze({
  'otp-a': 'Brevo', 'otp-b': 'AppsScript', 'otp-c': 'Mailjet', 'otp-d': 'Resend',
  'otp-e': 'AgentMail', 'otp-f': 'MailerSend', 'otp-g': 'DeadSimple', 'otp-h': 'Logto',
  'otp-i': 'Appwrite', 'otp-j': 'Ory', 'otp-k': 'Hanko', 'otp-l': 'Descope-OTP',
  'otp-m': 'Descope-MagicLink', 'otp-n': 'Maileroo', 'otp-o': 'ElasticEmail',
  'otp-q': 'Mailgun', 'otp-r': 'AlibabaDirectMail', 'otp-s': 'SparkPost', 'otp-t': 'Plunk',
  'otp-u': 'Loops', 'otp-v': 'Stytch', 'otp-w': 'WorkOS', 'otp-x': 'MojoAuth',
  'otp-y': 'Authgear', 'otp-z': 'Stack Auth', 'otp-za': 'SuperTokens', telegram: 'Telegram'
});

// AUTH-ROADMAP step 5 (owner 2026-10-31): the password-reset path used to be
// silent. Firebase answers USER_DISABLED / EMAIL_NOT_FOUND and the handler
// deliberately swallows it so a stranger cannot probe for accounts — correct
// for the student, but it left the owner with no way to tell "the mail went
// out" from "we refused it". `reset_request` records the refusal reason code
// (never the address) in the same allow-listed shape as the OTP events.
const EVENTS = new Set(['otp_delivery', 'otp_request', 'reset_request']);
// `tried` and `skipped` are comma-joined provider lists, so they get room for a
// whole run (26 slots); every other string field is a short label.
const LONG_STRING_FIELDS = new Set(['tried', 'skipped']);
const STRING_FIELDS = new Set(['attempt', 'purpose', 'method', 'provider', 'label', 'outcome', 'reason', 'failureClass', 'tried', 'skipped']);
const NUMBER_FIELDS = new Set(['candidates', 'rank', 'try', 'latencyMs', 'totalMs']);
// reset_request only ever carries the Firebase reason code, which is a fixed
// token from a closed list. An allow-list keeps a caller that passes an address
// by mistake from ever reaching the log.
const RESET_REASONS = new Set([
  'EMAIL_NOT_FOUND', 'USER_DISABLED', 'INVALID_EMAIL', 'MISSING_EMAIL',
  'TOO_MANY_ATTEMPTS_TRY_LATER', 'TOO_MANY_ATTEMPTS', 'QUOTA_EXCEEDED', 'ACCEPTED'
]);

export function sanitizeOtpDeliveryEvent(event) {
  if (!event || !EVENTS.has(event.evt)) return null;
  const out = { evt: event.evt };
  for (const [key, value] of Object.entries(event)) {
    if (STRING_FIELDS.has(key) && value != null && typeof value !== 'object') out[key] = String(value).slice(0, LONG_STRING_FIELDS.has(key) ? 400 : 64);
    else if (NUMBER_FIELDS.has(key) && Number.isFinite(Number(value))) out[key] = Math.round(Number(value));
  }
  if (out.attempt) out.attempt = out.attempt.slice(0, 8);
  // A reset line carries a reason code and nothing else. Anything not on the
  // closed list is dropped rather than printed, so no free-form string (an
  // address, a provider message) can ride along on this event.
  if (out.evt === 'reset_request') {
    if (!RESET_REASONS.has(out.reason)) delete out.reason;
    delete out.provider;
    delete out.label;
    delete out.method;
    delete out.failureClass;
    delete out.purpose;
    return out;
  }
  if (out.provider) out.name = OTP_PROVIDER_NAMES[out.provider] || out.provider;
  return out;
}

export function emitOtpDeliveryEvent(event, sink = console) {
  const record = sanitizeOtpDeliveryEvent(event);
  if (!record) return null;
  try {
    const failed = record.outcome === 'failed' || record.outcome === 'all_failed';
    (failed ? sink.warn : sink.log).call(sink, JSON.stringify(record));
  } catch {}
  return record;
}
