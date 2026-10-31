// AUTH-ROADMAP step 8: the daily "send one OTP and see" tick.
//
// `authgear-liveness.mjs` answers the question; this decides when to ask it and
// who to tell. It rides the admission-gk Worker's existing every-minute cron
// rather than a new scheduled workflow, because a new workflow file cannot be
// pushed with the token this repository is operated with (no `workflow` scope),
// and because the alert path — `sendTelegramAlert`, the same bot that already
// carries the OTP and security alerts — already lives there.
//
// The day guard is the pattern the snapshot and cache sweeps already use: the
// cron ticks 1,440 times a day and exactly one of those ticks does the work.
// The marker is written *before* the probe runs, not after. A probe that hangs
// or throws would otherwise leave no marker, and the next tick would start
// another one — 1,440 failed sends a day at a third party is a good way to get
// the account suspended, which is a worse outcome than a missed day.
//
// A failure alerts once per Dhaka day for the same reason: the marker is the
// throttle. No marker, no alert — so a broken probe cannot become a broken
// pager.

import { probeAuthgearLiveness, AUTHGEAR_LIVENESS_CODES } from '../verification/authgear-liveness.mjs';

export const OTP_LIVENESS_MARKER_PREFIX = 'otpLivenessDay:';

/** Dhaka is UTC+6 year-round; there is no daylight saving to track. */
export const dhakaDay = (now = Date.now()) => new Date(now + 6 * 3600000).toISOString().slice(0, 10);

/**
 * The owner-facing message. Deliberately plain text: `sendTelegramAlert` sends
 * without `parse_mode`, so Markdown or HTML here would arrive as literal
 * asterisks. No provider name, no endpoint, no address — this lands in a chat
 * log, and the slot id alone is enough to act on.
 */
export function renderOtpLivenessAlert(result, day) {
  const failed = !result?.ok;
  const head = failed
    ? `🔴 OTP লাইভ probe ব্যর্থ — ${day}`
    : `🟢 OTP লাইভ probe ঠিক আছে — ${day}`;
  const lines = [
    head,
    `slot: otp-y (Authgear)`,
    `code: ${String(result?.code || 'UNKNOWN')}`,
    `latency: ${Number(result?.latencyMs || 0)} ms`
  ];
  if (failed) {
    lines.push('', 'এই slot এখন কোড পাঠাতে পারছে না। chain-এ এটা দ্বিতীয়, তাই ছাত্র আটকাবে না — তবে ঠিক করা দরকার।');
  }
  return lines.join('\n');
}

/**
 * Run today's probe if it has not run yet. Returns what happened so the caller
 * (and a test) can see the decision, not just the side effect.
 *
 * @returns {Promise<{ran: boolean, day: string, ok?: boolean, code?: string, alerted?: boolean}>}
 */
export async function runDailyOtpLiveness({
  env,
  now = Date.now(),
  probe = probeAuthgearLiveness,
  alert = null,
  alwaysAlert = false
} = {}) {
  const day = dhakaDay(now);
  const marker = `${OTP_LIVENESS_MARKER_PREFIX}${day}`;
  const kv = env?.PUB_KV;

  // No KV means no day guard, and an unguarded probe on a per-minute cron is
  // the failure mode described above. Do nothing rather than something harmful.
  if (!kv) return { ran: false, day, code: 'NO_KV' };
  try {
    if ((await kv.get(marker)) === 'done') return { ran: false, day };
  } catch { return { ran: false, day, code: 'KV_READ_FAILED' }; }
  try { await kv.put(marker, 'done'); } catch { return { ran: false, day, code: 'KV_WRITE_FAILED' }; }

  let result;
  try {
    result = await probe({});
  } catch (cause) {
    // The probe is written not to throw; if it does, that is itself the finding.
    result = { ok: false, code: AUTHGEAR_LIVENESS_CODES.NETWORK_ERROR, latencyMs: 0, detail: String(cause?.name || 'ERROR') };
  }

  // The owner asked for an alert when it fails. A daily green is also useful —
  // it is the difference between "no alert because it is fine" and "no alert
  // because the probe stopped running" — but that is opt-in, so the default
  // tick stays quiet and the noise stays proportional to the problem.
  let alerted = false;
  if (typeof alert === 'function' && (!result.ok || alwaysAlert)) {
    try { alerted = (await alert(renderOtpLivenessAlert(result, day))) !== false; } catch { alerted = false; }
  }
  return { ran: true, day, ok: result.ok === true, code: String(result.code || 'UNKNOWN'), alerted };
}
