// AUTH V2.1 (owner 2026-10-31): the security-notification sender.
//
// Phase 6 built the notification boundary and shipped it dry-run, with
// `this.securityNotificationSender = null` on the Durable Object. The blueprint's
// finding ৩ is exactly that: the feature exists in name only. `password-changed`,
// `new-device-login` and `suspicious-activity` are rendered, counted, and then
// dropped, because nothing was ever wired to carry them. A security notice that
// never arrives is not security — it is code that looks like security.
//
// This file is the missing half. It stays OUT of security-notifications.mjs on
// purpose: that module's whole job is to fail closed on a raw address, and the
// only way to send mail is to know the address. Splitting them keeps that
// boundary honest — the renderer still refuses PII, and the one component that
// legitimately holds an address is this one, small enough to read in a minute.
//
// Privacy rules this file holds, so a later edit cannot quietly relax them:
//   • the address never enters the rendered body — it is the envelope, not the
//     content, and the renderer's own guard is what enforces that;
//   • the address is never logged, never returned in a result, and never put in
//     an error;
//   • a failure is reported as a code, so the caller can count it without
//     learning an address.
//
// Delivery goes through the same Email Gateway the OTP chain uses, so a security
// notice inherits the provider failover, quota and delivery ledger that path
// already has — rather than growing a second, unmonitored way to send mail.

/** The gateway's own type for a security notice. Chosen from its closed list
 *  rather than a free-form string: the template engine rejects anything else,
 *  and `SECURITY_ALERT` is the one whose variables are activity/time. */
export const SECURITY_ALERT_EMAIL_TYPE = 'SECURITY_ALERT';

/** How long a gateway send may take before it is abandoned. The notification is
 *  fire-and-forget, so a slow provider must never hold the auth response — but
 *  an unbounded await would leak a pending promise per login. */
const SEND_TIMEOUT_MS = 8000;

const REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9:_-]{15,127}$/;
/* The same shape the auth code normalises addresses to: a local part, an @, and
 * a dotted domain with a real TLD. Deliberately stricter than "contains an @":
 * `a@b` is not deliverable, and handing it to the gateway would burn a provider
 * attempt and a quota slot to learn what this line already knows. */
const EMAIL_SHAPE = /^[^@\s]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;

/** A gateway requestId must match the gateway's own pattern. Derived from the
 *  event so a retry of the same event is idempotent at the gateway — the same
 *  login noticed twice must not produce two emails. */
export function notificationRequestId({ eventType, at, recipientRef }) {
  const seed = `${String(eventType || 'security')}:${Number(at) || 0}:${String(recipientRef || '')}`;
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) >>> 0;
  }
  return `sec-${String(eventType || 'event').replace(/[^A-Za-z0-9]/g, '').slice(0, 20)}-${hash.toString(36)}-${String(Number(at) || 0).toString(36)}`.slice(0, 127);
}

/**
 * Build the one function `dispatchSecurityNotifications` calls per event.
 *
 * The dispatcher calls this with TWO arguments: the rendered item (PII-free by
 * contract) and an `envelope` holding the real recipient. Splitting them is the
 * point — the body can never contain the address, because the sender is the
 * only thing that ever sees the envelope, and it puts it in the gateway's
 * `recipient` field, never in `variables`.
 *
 * `send` is the gateway's own `send`, injected rather than imported so this
 * stays unit-testable without a gateway and so the composition root — the
 * Durable Object — is the single place that decides whether mail can go out.
 *
 * Returns a sender that resolves `{ ok, reason }` and never throws: the
 * dispatcher already guards, but a sender that cannot throw is one less way for
 * a notification to break a login.
 */
export function createSecurityNotificationSender({
  send,
  now = () => Date.now(),
  timeoutMs = SEND_TIMEOUT_MS,
  setTimer = setTimeout,
  clearTimer = clearTimeout
} = {}) {
  if (typeof send !== 'function') return null;

  return async function sendSecurityNotification(item = {}, envelope = {}) {
    const address = String(envelope?.recipient || '').trim();
    // No address, no send. Reported as a value, never thrown, and never with
    // the address attached.
    if (!EMAIL_SHAPE.test(address)) return Object.freeze({ ok: false, reason: 'recipient-unavailable' });

    const at = Number(item.at) || now();
    const requestId = notificationRequestId({
      eventType: item.eventType,
      at,
      recipientRef: item.emailMasked || ''
    });
    if (!REQUEST_ID.test(requestId)) return Object.freeze({ ok: false, reason: 'request-id-invalid' });

    let timer = null;
    try {
      const result = await Promise.race([
        send({
          type: SECURITY_ALERT_EMAIL_TYPE,
          recipient: address,
          subject: String(item.subject || '').slice(0, 200),
          template: SECURITY_ALERT_EMAIL_TYPE,
          // The gateway's SECURITY_ALERT template accepts exactly these three.
          // `name` is deliberately omitted: the masked address is not a name,
          // and the template already falls back to a neutral salutation.
          variables: {
            activity: String(item.body || '').slice(0, 600),
            time: new Date(at).toISOString()
          },
          requestId,
          idempotencyKey: requestId,
          priority: 'HIGH'
        }),
        new Promise(resolve => {
          timer = setTimer(() => resolve({ __timeout__: true }), timeoutMs);
        })
      ]);
      if (result && result.__timeout__ === true) return Object.freeze({ ok: false, reason: 'send-timeout' });
      return Object.freeze({ ok: true });
    } catch (error) {
      // A code, never the message: a provider error can quote the address.
      return Object.freeze({ ok: false, reason: String(error?.code || 'send-failed').slice(0, 40) });
    } finally {
      if (timer !== null) clearTimer(timer);
    }
  };
}
