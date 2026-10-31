// AUTH-ROADMAP step 0 (3/3, owner 2026-10-18): Telegram alert when an OTP
// provider fails, every provider fails, or a send takes longer than 30 seconds.
//
// It reads only the already-sanitised record from otp-delivery-log.mjs, so an
// address, OTP code, link token or full attempt id can never reach Telegram.
// Alerts are throttled per (kind, provider) so one bad provider cannot flood the
// owner's chat. Missing TG_BOT_TOKEN / TG_CHAT_ID (e.g. staging) = silent no-op.

import { emitOtpDeliveryEvent } from './otp-delivery-log.mjs';
import { sendTelegramNotification } from '../email-gateway/operations/telegram-notifier.mjs';

export const OTP_SLOW_MS = 30000;
export const OTP_ALERT_COOLDOWN_MS = 15 * 60 * 1000;

export function otpAlertFor(record) {
  if (!record) return null;
  const ms = Math.max(Number(record.latencyMs) || 0, Number(record.totalMs) || 0);
  if (record.evt === 'otp_request' && record.outcome === 'all_failed') {
    return { kind: 'all_failed', key: 'all_failed', title: '🚨 সব OTP provider ব্যর্থ', ms };
  }
  if (record.evt === 'otp_delivery' && record.outcome === 'failed') {
    return { kind: 'provider_failed', key: `failed:${record.provider}`, title: `⚠️ OTP provider ব্যর্থ: ${record.name || record.provider}`, ms };
  }
  if (ms > OTP_SLOW_MS && (record.evt === 'otp_request' || record.outcome === 'accepted')) {
    return { kind: 'slow', key: `slow:${record.provider || 'request'}`, title: `🐢 OTP পাঠাতে ${Math.round(ms / 1000)} সেকেন্ড লেগেছে`, ms };
  }
  // AU-SEC-01 L8 (global fuzz): the day's provider quota is nearly gone. The
  // key is the band, not the provider, so a run working through the list
  // produces one message per escalation rather than one per slot.
  // Step 5: a refused reset is a support signal, not a failure. The handler
  // must answer 202 either way (enumeration protection), so the log is the
  // only place this is visible. One message per reason per cooldown window.
  if (record.evt === 'reset_request' && record.reason && record.reason !== 'ACCEPTED') {
    return { kind: 'reset_refused', key: `reset:${record.reason}`, title: `🔑 Password reset পাঠানো হয়নি (${record.reason})`, ms: 0 };
  }
  if (record.evt === 'otp_delivery' && record.outcome === 'quota_pressure') {
    const pct = Math.round((Number(record.ratio) || 0) * 100);
    return record.band === 'hard'
      ? { kind: 'fuzz_hard', key: 'fuzz_hard', title: `🛑 OTP কোটা ${pct}% শেষ — নতুন সাইনআপে কঠিন যাচাই চালু`, ms }
      : { kind: 'fuzz_alert', key: 'fuzz_alert', title: `⚠️ OTP কোটা ${pct}% শেষ (${record.provider || ''})`, ms };
  }
  return null;
}

export function formatOtpAlert(alert, record, at) {
  const lines = ['🔥 AdmissionSky · OTP alert', alert.title];
  if (record.evt === 'reset_request') {
    // Only the code and the count: no address ever reaches Telegram.
    lines.push('ছাত্র এই request-এ কোনো ইঙ্গিত পায়নি (202, একই উত্তর)।');
    lines.push(`সময় (UTC): ${new Date(at).toISOString()}`);
    return lines.join('\n');
  }
  if (record.provider) lines.push(`provider: ${record.name || record.provider} (${record.provider})`);
  if (record.reason) lines.push(`কারণ: ${record.reason}`);
  if (alert.ms) lines.push(`সময়: ${alert.ms} ms`);
  if (record.purpose) lines.push(`purpose: ${record.purpose}${record.method ? ` · ${record.method}` : ''}`);
  if (record.tried) lines.push(`চেষ্টা: ${record.tried}`);
  // A4 / AU-OB-02 (owner 2026-10-31): when a send is slow or fails outright,
  // the first question is which slots never got a turn. Without this the owner
  // sees "otp-y carried it" and "everything else was out of quota" as the same
  // message and has to open the logs to tell them apart.
  if (record.skipped) lines.push(`বাদ পড়েছে: ${record.skipped}`);
  if (record.attempt) lines.push(`ref: ${record.attempt}`);
  lines.push(`সময় (UTC): ${new Date(at).toISOString()}`);
  return lines.join('\n');
}

export function createOtpDeliverySink({
  env = {}, waitUntil = null, fetchImpl = globalThis.fetch, now = () => Date.now(),
  sink = console, cooldownMs = OTP_ALERT_COOLDOWN_MS, send = sendTelegramNotification
} = {}) {
  const lastSent = new Map();
  return function onOtpDeliveryEvent(event) {
    const record = emitOtpDeliveryEvent(event, sink);
    const alert = otpAlertFor(record);
    if (!alert || !env.TG_BOT_TOKEN || !env.TG_CHAT_ID) return record;
    const at = now();
    if (at - (lastSent.get(alert.key) || -Infinity) < cooldownMs) return record;
    lastSent.set(alert.key, at);
    const job = Promise.resolve()
      .then(() => send({ token: env.TG_BOT_TOKEN, chatId: env.TG_CHAT_ID, message: formatOtpAlert(alert, record, at), fetchImpl, timeoutMs: 5000 }))
      .catch(error => { try { sink.warn.call(sink, JSON.stringify({ evt: 'otp_alert_failed', kind: alert.kind, code: String(error?.code || 'ERROR').slice(0, 40) })); } catch {} });
    try { if (typeof waitUntil === 'function') waitUntil(job); } catch {}
    return record;
  };
}
