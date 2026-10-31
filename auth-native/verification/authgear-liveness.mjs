// AUTH-ROADMAP step 8 (owner 2026-10-31): a daily live probe of the OTP chain.
//
// The gap this closes: every OTP slot is probed for health only when a student
// asks for a code, so a slot that has silently stopped accepting sends is
// invisible until someone says "the code never came". The owner asked for a
// daily send-and-see instead. The obstacle was that the send path needs a
// credential for every measured slot — Brevo, Resend, Mailjet, the five hosted
// IdPs all read a key this box does not have — and the one slot that needs no
// key at all is `otp-y` (Authgear), whose public Authentication Flow endpoint
// lives in code (`idp-providers.mjs`, `AUTHGEAR_PUBLIC_DEFAULTS`).
//
// So the probe drives exactly the flow the real provider drives, in
// `AuthgearOtpVerificationProvider.sendVerification`: create a `signup_login`
// flow, submit an address, and require the flow to arrive at the email-OTP step
// with a six-digit code and `delivery_status` past `pending`. Reaching that
// state means Authgear accepted the send — which is the whole question. It is
// the second slot in the Gmail chain (`otp-y` priority 11, behind Brevo at 10),
// so it is a live failover path, not a spare.
//
// The address is on the reserved `.invalid` TLD (RFC 2606), so it can never be
// registered and the mail is undeliverable by construction: the probe proves
// the send was accepted without delivering anything to a real inbox. No
// credential is read, nothing is written, and no student-visible state changes.
//
// This module deliberately returns a code rather than throwing: a probe that
// throws is a probe whose caller has to guess, and the caller here is a cron
// tick that must never be broken by a third party being down.

export const AUTHGEAR_LIVENESS_ENDPOINT = 'https://admissionsky.authgear.cloud';

/** RFC 2606 reserves `.invalid`, so this address is undeliverable by design. */
export const AUTHGEAR_LIVENESS_ADDRESS = 'otp-liveness@admissionsky-probe.invalid';

export const AUTHGEAR_LIVENESS_CODES = Object.freeze({
  READY: 'READY',
  NETWORK_ERROR: 'NETWORK_ERROR',
  FLOW_CREATE_FAILED: 'FLOW_CREATE_FAILED',
  IDENTIFY_REJECTED: 'IDENTIFY_REJECTED',
  NO_EMAIL_OTP: 'NO_EMAIL_OTP',
  NOT_DELIVERING: 'NOT_DELIVERING',
  INVALID_PROVIDER_RESPONSE: 'INVALID_PROVIDER_RESPONSE'
});

const bounded = (value, max = 40) =>
  String(value || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, max);

const isEndpoint = value => {
  try {
    const url = new URL(String(value || ''));
    return url.protocol === 'https:' && /^[a-z0-9-]{2,63}\.authgear\.cloud$/.test(url.hostname) && !url.username && !url.password;
  } catch { return false; }
};

/**
 * Drive Authgear's public email-OTP flow as far as "the code was accepted for
 * delivery". Reads no secret; the caller passes only a fetch implementation.
 *
 * @returns {Promise<{ok: boolean, code: string, deliveryStatus: string, latencyMs: number}>}
 */
export async function probeAuthgearLiveness({
  fetchImpl = globalThis.fetch,
  endpoint = AUTHGEAR_LIVENESS_ENDPOINT,
  address = AUTHGEAR_LIVENESS_ADDRESS,
  timeoutMs = 12_000,
  now = Date.now
} = {}) {
  const started = Number(now());
  const done = (ok, code, deliveryStatus = '') => Object.freeze({
    ok,
    code,
    deliveryStatus: bounded(deliveryStatus, 20),
    latencyMs: Math.max(0, Number(now()) - started)
  });
  if (typeof fetchImpl !== 'function' || !isEndpoint(endpoint)) {
    return done(false, AUTHGEAR_LIVENESS_CODES.INVALID_PROVIDER_RESPONSE);
  }

  const step = async (path, body) => {
    const response = await fetchImpl(`${new URL(endpoint).origin}${path}`, {
      method: 'POST',
      redirect: 'manual',
      credentials: 'omit',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs)
    });
    let payload = {};
    try { payload = await response.json(); } catch { payload = {}; }
    return { response, payload: payload && typeof payload === 'object' ? payload : {} };
  };

  let created;
  try {
    created = await step('/api/v1/authentication_flows', { type: 'signup_login', name: 'default' });
  } catch { return done(false, AUTHGEAR_LIVENESS_CODES.NETWORK_ERROR); }
  const stateToken = String(created.payload?.result?.state_token || '');
  if (!created.response?.ok || !/^[A-Za-z0-9_-]{16,128}$/.test(stateToken)) {
    return done(false, AUTHGEAR_LIVENESS_CODES.FLOW_CREATE_FAILED);
  }

  let identified;
  try {
    identified = await step('/api/v1/authentication_flows/states/input', {
      state_token: stateToken,
      input: { identification: 'email', login_id: address }
    });
  } catch { return done(false, AUTHGEAR_LIVENESS_CODES.NETWORK_ERROR); }
  if (!identified.response?.ok) return done(false, AUTHGEAR_LIVENESS_CODES.IDENTIFY_REJECTED);

  // A brand-new address takes the signup branch: identify -> verify. A known
  // one would take authenticate -> pick primary_oob_otp_email. Both end at the
  // same `verify_oob_otp_data` action, and the probe address is always new, so
  // only the signup shape is required — the real provider still handles both.
  const action = identified.payload?.result?.action || {};
  const data = action.data || {};
  const reachedEmailOtp = action.type === 'verify'
    && data.type === 'verify_oob_otp_data'
    && data.channel === 'email'
    && Number(data.code_length) === 6;
  if (!reachedEmailOtp) return done(false, AUTHGEAR_LIVENESS_CODES.NO_EMAIL_OTP, data.delivery_status);

  // `delivery_status` is the provider's own word for whether it took the send.
  // An unrecognised or empty value is not treated as success: the probe exists
  // to catch a slot that has quietly stopped delivering, so anything other than
  // an explicit in-flight status must fail rather than pass by default.
  const status = String(data.delivery_status || '').toLowerCase();
  if (!['sending', 'sent', 'delivered'].includes(status)) {
    return done(false, AUTHGEAR_LIVENESS_CODES.NOT_DELIVERING, status);
  }
  return done(true, AUTHGEAR_LIVENESS_CODES.READY, status);
}
