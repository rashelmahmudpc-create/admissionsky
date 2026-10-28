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

const EVENTS = new Set(['otp_delivery', 'otp_request']);
const STRING_FIELDS = new Set(['attempt', 'purpose', 'method', 'provider', 'label', 'outcome', 'reason', 'failureClass', 'tried']);
const NUMBER_FIELDS = new Set(['candidates', 'rank', 'try', 'latencyMs', 'totalMs']);

export function sanitizeOtpDeliveryEvent(event) {
  if (!event || !EVENTS.has(event.evt)) return null;
  const out = { evt: event.evt };
  for (const [key, value] of Object.entries(event)) {
    if (STRING_FIELDS.has(key) && value != null && typeof value !== 'object') out[key] = String(value).slice(0, key === 'tried' ? 400 : 64);
    else if (NUMBER_FIELDS.has(key) && Number.isFinite(Number(value))) out[key] = Math.round(Number(value));
  }
  if (out.attempt) out.attempt = out.attempt.slice(0, 8);
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
