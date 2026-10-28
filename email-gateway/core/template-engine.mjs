import { EMAIL_TYPES } from './constants.mjs';
import { EmailGatewayError } from './errors.mjs';
import { EMAIL_FAILURE_CODES } from './constants.mjs';

const SUBJECTS = Object.freeze({
  [EMAIL_TYPES.EMAIL_VERIFICATION]: 'AdmissionSky ইমেইল যাচাই কোড',
  [EMAIL_TYPES.SIGNUP_VERIFICATION]: 'AdmissionSky সাইনআপ যাচাই কোড',
  [EMAIL_TYPES.PASSWORD_RESET]: 'AdmissionSky পাসওয়ার্ড রিসেট কোড',
  [EMAIL_TYPES.NEW_DEVICE_VERIFICATION]: 'নতুন ডিভাইস যাচাই করুন',
  [EMAIL_TYPES.LOGIN_SECURITY_CHALLENGE]: 'Login security verification code',
  [EMAIL_TYPES.MFA_CODE]: 'AdmissionSky MFA code',
  [EMAIL_TYPES.ACCOUNT_RECOVERY]: 'AdmissionSky account recovery code',
  [EMAIL_TYPES.WELCOME_EMAIL]: 'AdmissionSky-এ স্বাগতম',
  [EMAIL_TYPES.SECURITY_ALERT]: 'AdmissionSky security alert'
});

const OTP_TYPES = new Set([
  EMAIL_TYPES.EMAIL_VERIFICATION,
  EMAIL_TYPES.SIGNUP_VERIFICATION,
  EMAIL_TYPES.PASSWORD_RESET,
  EMAIL_TYPES.NEW_DEVICE_VERIFICATION,
  EMAIL_TYPES.LOGIN_SECURITY_CHALLENGE,
  EMAIL_TYPES.MFA_CODE,
  EMAIL_TYPES.ACCOUNT_RECOVERY
]);

const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
})[character]);

const fail = message => {
  throw new EmailGatewayError({ code: EMAIL_FAILURE_CODES.INVALID_REQUEST, safeMessage: message, retryable: false, status: 400 });
};

const safeLabel = value => escapeHtml(String(value || '').trim().slice(0, 160));

export class EmailTemplateEngine {
  constructor({ config }) {
    this.config = config;
  }

  render(request) {
    const subject = request.subject || SUBJECTS[request.type];
    if (!subject) fail('Email template type is unsupported.');
    const allowedVariables = OTP_TYPES.has(request.type)
      ? new Set(['otp', 'name', 'purpose'])
      : request.type === EMAIL_TYPES.WELCOME_EMAIL
        ? new Set(['name'])
        : new Set(['name', 'activity', 'time']);
    for (const key of Object.keys(request.variables)) if (!allowedVariables.has(key)) fail(`Email template variable is unsupported: ${key}`);
    const name = safeLabel(request.variables.name || 'শিক্ষার্থী');
    const app = 'AdmissionSky';

    if (OTP_TYPES.has(request.type)) {
      const otp = String(request.variables.otp || '');
      const pattern = new RegExp(`^\\d{${this.config.otp.digits}}$`);
      if (!pattern.test(otp)) fail(`A ${this.config.otp.digits}-digit OTP is required.`);
      const purpose = safeLabel(request.variables.purpose || SUBJECTS[request.type]);
      const expiry = this.config.otp.expiryMinutes;
      const text = `${name},\n\n${purpose}\n\nআপনার যাচাই কোড: ${otp}\n\nকোডটি ${expiry} মিনিটের মধ্যে ব্যবহার করুন। এই কোড কাউকে জানাবেন না। আপনি অনুরোধ না করলে ইমেইলটি উপেক্ষা করুন।\n\n- ${app}`;
      const html = `<!doctype html><html lang="bn"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(subject)}</title></head><body style="margin:0;background:#f4f7f6;color:#18322c;font-family:Arial,sans-serif"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:28px 14px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#fff;border:1px solid #dfe9e5;border-radius:18px"><tr><td style="padding:30px"><div style="font-size:13px;font-weight:700;color:#2b7866;letter-spacing:.06em">ADMISSIONSKY</div><h1 style="font-size:22px;margin:16px 0 8px">${purpose}</h1><p style="font-size:16px;line-height:1.65;margin:0 0 22px">${name}, আপনার যাচাই কোড:</p><div style="font-size:34px;font-weight:800;letter-spacing:10px;text-align:center;background:#eef8f4;border-radius:14px;padding:18px;color:#145b4b">${otp}</div><p style="font-size:14px;line-height:1.65;color:#526862;margin:22px 0 0">কোডটি ${expiry} মিনিটের মধ্যে ব্যবহার করুন। কোডটি কাউকে জানাবেন না। আপনি অনুরোধ না করলে ইমেইলটি উপেক্ষা করুন।</p></td></tr></table></td></tr></table></body></html>`;
      return Object.freeze({ subject, text, html, transactional: true });
    }

    if (request.type === EMAIL_TYPES.WELCOME_EMAIL) {
      const text = `${name},\n\n${app}-এ স্বাগতম। আপনার ভর্তি প্রস্তুতির যাত্রা আরও গুছিয়ে নিতে আমরা পাশে আছি।\n\n- ${app}`;
      const html = `<!doctype html><html lang="bn"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(subject)}</title></head><body style="margin:0;background:#f4f7f6;font-family:Arial,sans-serif;color:#18322c"><div style="max-width:560px;margin:28px auto;background:#fff;border:1px solid #dfe9e5;border-radius:18px;padding:30px"><div style="font-size:13px;font-weight:700;color:#2b7866">ADMISSIONSKY</div><h1 style="font-size:24px">স্বাগতম, ${name}</h1><p style="font-size:16px;line-height:1.7">আপনার ভর্তি প্রস্তুতির যাত্রা আরও গুছিয়ে নিতে আমরা পাশে আছি।</p></div></body></html>`;
      return Object.freeze({ subject, text, html, transactional: true });
    }

    if (request.type === EMAIL_TYPES.SECURITY_ALERT) {
      const activity = safeLabel(request.variables.activity || 'আপনার অ্যাকাউন্টে একটি নিরাপত্তা-সংক্রান্ত পরিবর্তন হয়েছে।');
      const time = safeLabel(request.variables.time || 'সাম্প্রতিক সময়ে');
      const text = `${name},\n\nনিরাপত্তা সতর্কতা: ${activity}\nসময়: ${time}\n\nএটি আপনি না করলে দ্রুত account recovery ব্যবহার করুন।\n\n- ${app}`;
      const html = `<!doctype html><html lang="bn"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(subject)}</title></head><body style="margin:0;background:#fff7f4;font-family:Arial,sans-serif;color:#3c2823"><div style="max-width:560px;margin:28px auto;background:#fff;border:1px solid #efdcd5;border-radius:18px;padding:30px"><div style="font-size:13px;font-weight:700;color:#a64f35">ADMISSIONSKY SECURITY</div><h1 style="font-size:22px">নিরাপত্তা সতর্কতা</h1><p style="font-size:16px;line-height:1.7">${activity}</p><p style="font-size:14px;color:#6f5b54">সময়: ${time}</p><p style="font-size:14px;line-height:1.65">এটি আপনি না করলে দ্রুত account recovery ব্যবহার করুন।</p></div></body></html>`;
      return Object.freeze({ subject, text, html, transactional: true });
    }

    fail('Email template type is unsupported.');
  }
}

export const TEMPLATE_SUBJECTS = SUBJECTS;
