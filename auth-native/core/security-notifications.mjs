// Phase 6 Chunk 4, security notification boundary (§27).
//
// A structured catalog of user-facing security events plus a thin dispatch
// adapter. Phase 6 ships DRY-RUN only: the dispatcher never sends live mail
// unless the deployment explicitly opts in (SECURITY_NOTIFICATIONS_ACTIVATION
// = 'enabled') AND a real sender is configured. Privacy boundary: the
// renderer only ever accepts the masked email, a raw address in the input
// fails closed.
export const SECURITY_NOTIFICATION_EVENTS = Object.freeze({
  'new-device-login': Object.freeze({
    template: 'security-new-device-login',
    subject: 'Admission Sky: নতুন device থেকে লগইন',
    body: 'তোমার Admission Sky account একটি নতুন device থেকে লগইন করেছে। যদি এটি তুমি না হও, তাহলে দ্রুত তোমার password পরিবর্তন করো এবং "সব device থেকে Log Out" ব্যবহার করো।'
  }),
  'password-changed': Object.freeze({
    template: 'security-password-changed',
    subject: 'Admission Sky: password পরিবর্তন হয়েছে',
    body: 'তোমার Admission Sky account-এর password সম্প্রতি পরিবর্তন হয়েছে। যদি এটি তুমি না করো, দ্রুত password reset করো।'
  }),
  'passkey-added': Object.freeze({
    template: 'security-passkey-added',
    subject: 'Admission Sky: নতুন Passkey যুক্ত হয়েছে',
    body: 'তোমার Admission Sky account-এ একটি নতুন Passkey যুক্ত হয়েছে। যদি এটি তুমি না করো, তাহলে Account-এ গিয়ে Passkey-গুলোর তালিকা দেখে নাও।'
  }),
  'passkey-removed': Object.freeze({
    template: 'security-passkey-removed',
    subject: 'Admission Sky: Passkey মুছে ফেলা হয়েছে',
    body: 'তোমার Admission Sky account থেকে একটি Passkey মুছে ফেলা হয়েছে।'
  }),
  'recovery-started': Object.freeze({
    template: 'security-recovery-started',
    subject: 'Admission Sky: account recovery শুরু হয়েছে',
    body: 'তোমার Admission Sky account-এর জন্য একটি recovery শুরু হয়েছে। Recovery code কেবল তোমাকেই ব্যবহার করো, এটি কারো সঙ্গে শেয়ার করো না।'
  }),
  'recovery-completed': Object.freeze({
    template: 'security-recovery-completed',
    subject: 'Admission Sky: account recovery সম্পন্ন',
    body: 'তোমার Admission Sky account-এর recovery সম্পন্ন হয়েছে। নিশ্চিত হতে তোমার security settings দেখে নাও।'
  }),
  'suspicious-activity': Object.freeze({
    template: 'security-suspicious-activity',
    subject: 'Admission Sky: অস্বাভাবিক activity',
    body: 'তোমার Admission Sky account-এ অস্বাভাবিক activity লক্ষ্য করা গেছে। নিশ্চিত হতে তোমার password, Passkey-গুলো এবং trusted devices দেখে নাও।'
  })
});

const isMaskedEmail = value => {
  const text = String(value || '');
  // Masked form only: 1-3 visible chars, an ellipsis, domain kept coarse -
  // never a full local part.
  return /^[A-Za-z0-9]{1,3}\*{2,}@[A-Za-z0-9.-]+$/.test(text);
};

// Render one notification from a catalog entry. Fails closed on any raw
// email (the only address material this boundary accepts is the mask).
export function renderSecurityNotification(input = {}) {
  const spec = SECURITY_NOTIFICATION_EVENTS[String(input.eventType || '')];
  if (!spec) return null;
  const emailMasked = String(input.emailMasked || '');
  if (input.email !== undefined) throw new TypeError('raw email is not allowed in security notifications');
  if (!isMaskedEmail(emailMasked)) throw new TypeError('security notifications require the masked email only');
  const lines = [spec.body];
  if (input.browserClass) lines.push(`Device: ${String(input.browserClass)}`);
  if (input.at) {
    let when = '';
    try {
      when = new Date(Number(input.at)).toLocaleString('bn-BD', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Dhaka' });
    } catch (_) { when = ''; }
    if (when) lines.push(`সময়: ${when} (ঢাকা)`);
  }
  return Object.freeze({
    eventType: String(input.eventType),
    template: spec.template,
    subject: spec.subject,
    body: lines.join('\n'),
    emailMasked
  });
}

// Dispatch rendered notifications. Dry-run (the Phase 6 default) renders and
// counts but never calls the sender.
//
// AUTH V2.1: the sender is called with the rendered item AND an envelope that
// carries the real recipient. The body stays PII-free (the renderer enforces
// that); the address travels beside it, which is the only way a notification
// can be delivered without putting an address in the content. `envelope` is
// per-event, so a batch of events for different students cannot cross wires.
export async function dispatchSecurityNotifications({
  events = [],
  dryRun = true,
  sendSecurityEmail,
  now = Date.now
} = {}) {
  const rendered = [];
  const envelopes = [];
  for (const event of events) {
    try {
      const item = renderSecurityNotification({ ...event, at: event.at ?? now() });
      if (item) rendered.push(item);
      // The recipient is read from the raw event, never from the rendered item:
      // a caller that tried to smuggle an address into the body still cannot
      // reach the envelope through it.
      envelopes.push(Object.freeze({ recipient: String(event?.recipient || '').trim() }));
    } catch (error) {
      // A PII violation in the event input is a contract break: skip it
      // (the ledger row already exists) but never forward raw data.
      rendered.push(Object.freeze({ skipped: true, eventType: String(event?.eventType || 'unknown'), reason: 'pii-contract' }));
      envelopes.push(Object.freeze({ recipient: '' }));
    }
  }
  const sent = [];
  if (!dryRun) {
    if (typeof sendSecurityEmail !== 'function') {
      for (const item of rendered) {
        if (!item.skipped) sent.push(Object.freeze({ template: item.template, ok: false, reason: 'sender-not-configured' }));
      }
    } else {
      for (let index = 0; index < rendered.length; index += 1) {
        const item = rendered[index];
        if (item.skipped) {
          sent.push(item);
          continue;
        }
        let ok = false;
        let reason = null;
        try {
          const result = await sendSecurityEmail(item, envelopes[index]);
          ok = result?.ok !== false;
          reason = ok ? null : String(result?.reason || 'send-failed');
        } catch (_) {
          ok = false;
          reason = 'send-error';
        }
        sent.push(Object.freeze({ template: item.template, ok, ...(reason ? { reason } : {}) }));
      }
    }
  }
  return Object.freeze({
    dryRun: dryRun === true,
    requested: rendered.length,
    skipped: rendered.filter(item => item.skipped === true).length,
    sent: Object.freeze(sent)
  });
}
