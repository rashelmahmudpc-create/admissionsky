import {
  VERIFICATION_CHANNELS,
  VERIFICATION_FAILURE_CLASS,
  VERIFICATION_MODES,
  VerificationProviderError
} from './provider-contract.mjs';
import { deriveTelegramWebhookSecret, validTelegramWebhookSecret } from './telegram-security.mjs';
import { createPoolProviders } from './pool-providers.mjs';
import { createIdpProviders } from './idp-providers.mjs';

const safeInteger = (value, min = 0, max = Number.MAX_SAFE_INTEGER) => {
  const number = Number(value);
  return Number.isInteger(number) && number >= min && number <= max ? number : 0;
};
const validSecret = value => typeof value === 'string' && value.length >= 20 && value.length <= 4096 && !/[\r\n\u0000]/.test(value);
const validTelegramBotToken = value => /^[1-9]\d{5,19}:[A-Za-z0-9_-]{30,100}$/.test(String(value || ''));
const validTelegramBotUsername = value => /^(?=.{5,32}$)[A-Za-z][A-Za-z0-9_]*bot$/i.test(String(value || ''));
const validInboxId = value => /^[A-Za-z0-9_-]{8,64}$/.test(String(value || ''));

function httpsOrigin(value) {
  try {
    const url = new URL(String(value || ''));
    if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) return '';
    return url.origin;
  } catch { return ''; }
}

function telegramWebhookEndpoint(value) {
  try {
    const url = new URL(String(value || ''));
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/api/auth/v1/telegram/webhook') return '';
    if (!['admissionhub.pages.dev', 'admissionsky.pages.dev', 'admission-gk.admissionhub.workers.dev'].includes(url.hostname)) return '';
    return url.href;
  } catch { return ''; }
}

async function boundedJson(response, maximum = 32 * 1024) {
  if (!response.body) return {};
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maximum) {
      await reader.cancel();
      throw new VerificationProviderError('INVALID_PROVIDER_RESPONSE', VERIFICATION_FAILURE_CLASS.HARD);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  if (!total) return {};
  try { return JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw new VerificationProviderError('INVALID_PROVIDER_RESPONSE', VERIFICATION_FAILURE_CLASS.HARD); }
}

function httpFailure(response, _payload, { userStatuses = [400, 404, 422] } = {}) {
  const status = Number(response?.status || 0);
  const code = status >= 100 && status <= 599 ? `PROVIDER_HTTP_${status}` : 'PROVIDER_FAILURE';
  if (userStatuses.includes(status)) return new VerificationProviderError(code, VERIFICATION_FAILURE_CLASS.USER);
  if ([401, 403].includes(status)) return new VerificationProviderError(code, VERIFICATION_FAILURE_CLASS.HARD);
  if (status === 429 || status >= 500 || status === 0) return new VerificationProviderError(code, VERIFICATION_FAILURE_CLASS.TEMPORARY, { retryAfter: 60 });
  return new VerificationProviderError(code, VERIFICATION_FAILURE_CLASS.HARD);
}

async function fetchJson(fetchImpl, url, init = {}, { redirect = 'manual', timeoutMs = 12_000 } = {}) {
  let response;
  try {
    response = await fetchImpl(url, { ...init, redirect, signal: init.signal || AbortSignal.timeout(timeoutMs) });
  } catch { throw new VerificationProviderError('NETWORK_ERROR', VERIFICATION_FAILURE_CLASS.TEMPORARY); }
  const payload = await boundedJson(response);
  if (!response.ok) throw httpFailure(response, payload);
  return payload;
}

// Mailjet runs EU and US hosts; a US account only authenticates against the US host,
// so the base is validated rather than guessed.
const MAILJET_API_BASES = new Set(['https://api.mailjet.com', 'https://api.us.mailjet.com']);

const base64UrlBytes = bytes => {
  let binary = '';
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

// Standard base64 with padding intact, Basic auth needs the '=' characters that
// base64UrlBytes deliberately strips, so the two transforms stay separate.
const base64Bytes = value => btoa(String(value));

// Script IDs are ~57 chars; the bound keeps a hostile value from becoming a
// huge URL without rejecting legitimate ids.
function appsScriptWebAppUrl(value) {
  try {
    const url = new URL(String(value || ''));
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) return '';
    if (url.hostname !== 'script.google.com') return '';
    if (!/^\/macros\/s\/[A-Za-z0-9_-]{20,80}\/exec$/.test(url.pathname)) return '';
    return url.href;
  } catch { return ''; }
}

const validEmailAddress = value => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(value || '')) && String(value).length <= 254;

// Bengali first: the system UI stacks carry no Bengali coverage on Android or
// Windows, so a body of Bengali text falls back to whatever the client picks and
// renders with the wrong metrics (and, on a bare Linux/thin client, as tofu). The
// Latin-only families stay behind them so the digits and the brand still get a
// deliberate face on the clients that lack the Bengali ones.
const OTP_EMAIL_FONT = "'Hind Siliguri','Noto Sans Bengali','Nirmala UI',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const OTP_EMAIL_MONO = "'SF Mono','Roboto Mono','DejaVu Sans Mono',Menlo,Consolas,'Courier New',monospace";
const OTP_EMAIL_INK = '#101c19';
const OTP_EMAIL_MUTED = '#6b7b77';
// The onboarding brand mark, rendered from the same inline SVG the welcome flow
// uses. Served as a PNG because Gmail and Outlook strip inline SVG.
const OTP_EMAIL_MARK_URL = 'https://admissionsky.pages.dev/icons/email-mark.png';
const OTP_EMAIL_WORDMARK_ACCENT = '#2F6BFF';

// The product the student actually sees is AdmissionSky. Every sender name,
// subject, and body string uses this one constant so the brand cannot drift
// between providers again.
const OTP_EMAIL_APP = 'AdmissionSky';

const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]
));

// A recipient-supplied display name is untrusted: it is escaped for HTML above and
// stripped of control characters here so it cannot break the greeting line.
const cleanDisplayName = value => String(value ?? '')
  .replace(/[\u0000-\u001f\u007f]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, 60);

const OTP_EMAIL_TAGLINE = 'Your Admission Companion';

const otpEmailBody = (code, minutes, recipientName = '') => {
  const safeCode = escapeHtml(code);
  const safeMinutes = escapeHtml(minutes);
  const displayName = cleanDisplayName(recipientName);
  const greeting = displayName ? `প্রিয় ${escapeHtml(displayName)},` : 'প্রিয় ব্যবহারকারী,';
  const plainGreeting = displayName ? `প্রিয় ${displayName},` : 'প্রিয় ব্যবহারকারী,';

  const text = [
    plainGreeting,
    '',
    `আপনার ${OTP_EMAIL_APP} অ্যাকাউন্ট যাচাই করতে নিচের কোডটি ব্যবহার করুন।`,
    '',
    `    ${code}`,
    '',
    `কোডটি ${minutes} মিনিট পর্যন্ত কার্যকর থাকবে। কাউকে শেয়ার করবেন না।`,
    '',
    'শুভেচ্ছান্তে,',
    `${OTP_EMAIL_APP} Team`,
    '',
    '--',
    OTP_EMAIL_APP,
    OTP_EMAIL_TAGLINE,
    'এটি একটি স্বয়ংক্রিয় বার্তা। এই ইমেইলে উত্তর দেওয়ার প্রয়োজন নেই।'
  ].join('\n');

  const html = `<!DOCTYPE html>
<html lang="bn">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="format-detection" content="telephone=no,address=no,email=no,date=no">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${OTP_EMAIL_APP}, ইমেইল যাচাইকরণ</title>
<style>
  /* Progressive enhancement only: every rule below duplicates an inline value, so
     clients that strip <style> (or the whole head) still render the light design. */
  :root { color-scheme: light dark; supported-color-schemes: light dark; }
  /* Fluid on every screen: the shell fills whatever width the client gives it and
     the card centres itself, so mobile Gmail does not frame it as a narrow box. */
  .ah-shell { width: 100% !important; }
  .ah-card { width: 100% !important; max-width: 560px !important; margin: 0 auto !important; }
  @media (max-width: 620px) {
    .ah-pad { padding-left: 20px !important; padding-right: 20px !important; }
    .ah-otp-box { padding: 22px 12px !important; }
    .ah-otp { font-size: 40px !important; letter-spacing: 8px !important; text-indent: 8px !important; }
  }
  /* Gmail mobile dark mode paints its own chrome around the message. If the body
     and the shell keep their light colour while the card turns dark, the card
     reads as a floating box. All three surfaces therefore move together, and the
     card drops its border and shadow so nothing outlines it. */
  @media (prefers-color-scheme: dark) {
    .ah-body { background-color: #1f1f1f !important; }
    .ah-shell { background-color: #1f1f1f !important; }
    .ah-card { background-color: #1f1f1f !important; border-color: #1f1f1f !important; box-shadow: none !important; }
    .ah-otp-box { background-color: #14342a !important; border-color: #1f5c45 !important; }
    .ah-otp { color: #7ad9b8 !important; }
    .ah-heading { color: #f4f8f7 !important; }
    .ah-body-text { color: #c8d2cf !important; }
    .ah-muted { color: #a4b0ad !important; }
    .ah-foot { border-top-color: #3a3a3a !important; }
    .ah-foot-title { color: #dfe8e5 !important; }
  }
</style>
</head>
<body class="ah-body" style="margin:0;padding:0;width:100%;background-color:#ffffff;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:#ffffff;font-size:1px;line-height:1px;">আপনার ${OTP_EMAIL_APP} যাচাইকরণ কোড: ${safeCode}, ${safeMinutes} মিনিটের জন্য কার্যকর।&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="ah-shell" bgcolor="#ffffff" style="width:100%;background-color:#ffffff;font-family:${OTP_EMAIL_FONT};">
<tr><td align="center" class="ah-pad" style="padding:28px 12px;">

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="ah-card" bgcolor="#ffffff" style="width:100%;max-width:560px;background-color:#ffffff;border-radius:16px;">

<tr><td class="ah-pad" style="padding:30px 28px 0;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
<td width="52" valign="middle" style="width:52px;"><img src="${OTP_EMAIL_MARK_URL}" width="52" height="52" alt="${OTP_EMAIL_APP}" style="display:block;width:52px;height:52px;border:0;border-radius:16px;" /></td>
<td valign="middle" style="padding-left:13px;font-family:${OTP_EMAIL_FONT};font-size:22px;line-height:1.2;font-weight:700;color:${OTP_EMAIL_INK};letter-spacing:-0.2px;">Admission<span style="color:${OTP_EMAIL_WORDMARK_ACCENT};">Sky</span></td>
</tr></table>
</td></tr>

<tr><td class="ah-pad" style="padding:22px 28px 0;">
<!-- Bengali clusters carry their matras and reph above and below the baseline, so
     tightening the tracking makes them collide. The greeting is Bengali whenever a
     name is present, so it keeps the default tracking. -->
<p class="ah-heading" style="margin:0;font-family:${OTP_EMAIL_FONT};font-size:20px;line-height:1.5;font-weight:600;color:${OTP_EMAIL_INK};">${greeting}</p>
<p class="ah-body-text" style="margin:10px 0 0;font-family:${OTP_EMAIL_FONT};font-size:15px;line-height:1.7;font-weight:400;color:#48534f;">আপনার ${OTP_EMAIL_APP} অ্যাকাউন্ট যাচাই করতে নিচের কোডটি ব্যবহার করুন।</p>
</td></tr>

<tr><td class="ah-pad" style="padding:26px 28px 0;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="ah-otp-box" bgcolor="#f2fbf7" style="width:100%;background-color:#f2fbf7;border:1px solid #cdeede;border-radius:16px;">
<tr><td align="center" class="ah-otp-box" style="padding:30px 16px;">
<p class="ah-otp" style="margin:0;font-family:${OTP_EMAIL_MONO};font-size:48px;line-height:1.1;font-weight:700;letter-spacing:10px;text-indent:10px;color:${OTP_EMAIL_INK};">${safeCode}</p>
</td></tr>
</table>
</td></tr>

<tr><td class="ah-pad" align="center" style="padding:16px 28px 0;">
<p class="ah-muted" style="margin:0;font-family:${OTP_EMAIL_FONT};font-size:13px;line-height:1.6;font-weight:400;color:${OTP_EMAIL_MUTED};">এই কোডটি ${safeMinutes} মিনিট পর্যন্ত কার্যকর থাকবে।</p>
</td></tr>

<tr><td class="ah-pad" align="center" style="padding:10px 28px 30px;">
<p class="ah-muted" style="margin:0;font-family:${OTP_EMAIL_FONT};font-size:12.5px;line-height:1.65;font-weight:400;color:${OTP_EMAIL_MUTED};">কোডটি কারও সঙ্গে শেয়ার করবেন না। ${OTP_EMAIL_APP}-এর কেউ কখনও আপনার কোড চাইবে না।</p>
</td></tr>

<tr><td class="ah-foot" style="padding:18px 28px 26px;border-top:1px solid #eff2f1;">
<p class="ah-foot-title" style="margin:0;font-family:${OTP_EMAIL_FONT};font-size:12px;line-height:1.5;font-weight:600;color:#3f4a47;">${OTP_EMAIL_APP}</p>
<p class="ah-muted" style="margin:3px 0 0;font-family:${OTP_EMAIL_FONT};font-size:11px;line-height:1.5;font-weight:400;color:#8b9491;">${OTP_EMAIL_TAGLINE}</p>
<p class="ah-faint" style="margin:12px 0 0;font-family:${OTP_EMAIL_FONT};font-size:11px;line-height:1.6;font-weight:400;color:#9aa3a0;">এটি একটি স্বয়ংক্রিয় বার্তা। এই ইমেইলে উত্তর দেওয়ার প্রয়োজন নেই।</p>
</td></tr>

</table>

</td></tr>
</table>
</body>
</html>`;

  return { text, html };
};

const nextUtcMidnight = now => (Math.floor(Number(now) / 86_400_000) + 1) * 86_400_000;

export class BrevoOtpVerificationProvider {
  constructor({ id = 'otp-a', apiKey, fromAddress, fromName = OTP_EMAIL_APP, declaredDailyQuota, fetchImpl = globalThis.fetch, now = Date.now } = {}) {
    this.id = String(id || '');
    this.channel = VERIFICATION_CHANNELS.OTP;
    this.verificationMode = VERIFICATION_MODES.LOCAL_CODE;
    this.apiKey = String(apiKey || '');
    this.fromAddress = validEmailAddress(fromAddress) ? String(fromAddress) : '';
    this.fromName = String(fromName || OTP_EMAIL_APP).slice(0, 64);
    this.declaredDailyQuota = safeInteger(declaredDailyQuota, 1, 10_000_000);
    this.fetch = typeof fetchImpl === 'function' ? fetchImpl.bind(globalThis) : null;
    this.now = typeof now === 'function' ? now : Date.now;
    this.configured = Boolean(validSecret(this.apiKey) && this.fromAddress && this.declaredDailyQuota && this.fetch);
  }

  #headers(content = false) {
    return {
      Accept: 'application/json',
      'Cache-Control': 'no-store',
      'api-key': this.apiKey,
      ...(content ? { 'Content-Type': 'application/json' } : {})
    };
  }

  // Brevo stores a name against the sender record, and the account had drifted to
  // a vendor-adjacent one, so a name that is not the brand leaks into every OTP.
  // Sync it on the probe that precedes every send, the way the AgentMail provider
  // syncs its inbox display_name, so the account cannot drift back on its own. The
  // write only happens while the value differs, and a failure never blocks a send.
  async #syncSenderName(sender) {
    if (!sender || String(sender.name || '').trim() === OTP_EMAIL_APP) return true;
    try {
      const response = await this.fetch(`https://api.brevo.com/v3/senders/${encodeURIComponent(sender.id)}`, {
        method: 'PUT',
        redirect: 'manual',
        headers: this.#headers(true),
        body: JSON.stringify({ name: OTP_EMAIL_APP, email: this.fromAddress }),
        signal: AbortSignal.timeout(15_000)
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async checkAvailability() {
    if (!this.configured) return { available: false, code: 'NOT_CONFIGURED' };
    const payload = await fetchJson(this.fetch, 'https://api.brevo.com/v3/senders', { method: 'GET', headers: this.#headers() });
    const sender = Array.isArray(payload?.senders)
      ? payload.senders.find(item => String(item?.email || '').toLowerCase() === this.fromAddress.toLowerCase())
      : null;
    const ready = sender?.active === true;
    if (ready) await this.#syncSenderName(sender);
    return { available: ready, code: ready ? 'READY' : 'SENDER_NOT_VERIFIED' };
  }

  async getRemainingQuota() {
    if (!this.configured) return { remaining: 0, limit: 0, resetAt: 0, source: 'not-configured' };
    const payload = await fetchJson(this.fetch, 'https://api.brevo.com/v3/account', { method: 'GET', headers: this.#headers() });
    const plans = Array.isArray(payload?.plan) ? payload.plan : [];
    const sendLimit = plans.find(plan => String(plan?.creditsType || '') === 'sendLimit');
    const credits = safeInteger(sendLimit?.credits, 0, 10_000_000);
    const limit = this.declaredDailyQuota;
    return {
      remaining: Math.min(credits, limit),
      limit,
      resetAt: nextUtcMidnight(this.now()),
      source: 'brevo-account-credits'
    };
  }

  async sendVerification(input = {}) {
    if (!this.configured) throw new VerificationProviderError('NOT_CONFIGURED', VERIFICATION_FAILURE_CLASS.HARD);
    const destination = String(input.destination || '');
    const code = String(input.code || '');
    if (!validEmailAddress(destination) || !/^\d{6}$/.test(code)) {
      throw new VerificationProviderError('INVALID_DESTINATION', VERIFICATION_FAILURE_CLASS.USER);
    }
    const expiresAt = Number(input.expiresAt || 0);
    const minutes = expiresAt > 0 ? Math.max(1, Math.round((expiresAt - Number(this.now())) / 60_000)) : 5;
    const { text, html } = otpEmailBody(code, minutes, input.recipientName);
    const payload = await fetchJson(this.fetch, 'https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: this.#headers(true),
      body: JSON.stringify({
        sender: { email: this.fromAddress, name: this.fromName },
        to: [{ email: destination }],
        subject: `${OTP_EMAIL_APP}, আপনার যাচাইকরণ কোড`,
        htmlContent: html,
        textContent: text,
        tags: ['admission-hub-transactional']
      })
    });
    if (typeof payload?.messageId !== 'string' || !payload.messageId) {
      throw new VerificationProviderError('INVALID_PROVIDER_RESPONSE', VERIFICATION_FAILURE_CLASS.HARD);
    }
    return { accepted: true };
  }

  async verifyCode() { throw new VerificationProviderError('LOCAL_VERIFICATION_ONLY', VERIFICATION_FAILURE_CLASS.USER); }
  async getProviderStatus() {
    return { status: this.configured ? 'configured' : 'disabled', configured: this.configured, officialApi: true, mailer: 'brevo' };
  }
}

export class ResendOtpVerificationProvider {
  constructor({ id = 'otp-d', apiKey, fromAddress, fromName = OTP_EMAIL_APP, declaredDailyQuota, fetchImpl = globalThis.fetch, now = Date.now } = {}) {
    this.id = String(id || '');
    this.channel = VERIFICATION_CHANNELS.OTP;
    this.verificationMode = VERIFICATION_MODES.LOCAL_CODE;
    this.apiKey = String(apiKey || '');
    this.fromAddress = validEmailAddress(fromAddress) ? String(fromAddress) : '';
    this.fromName = String(fromName || OTP_EMAIL_APP).slice(0, 64);
    this.declaredDailyQuota = safeInteger(declaredDailyQuota, 1, 10_000_000);
    this.fetch = typeof fetchImpl === 'function' ? fetchImpl.bind(globalThis) : null;
    this.now = typeof now === 'function' ? now : Date.now;
    this.configured = Boolean(validSecret(this.apiKey) && this.fromAddress && this.declaredDailyQuota && this.fetch);
  }

  #headers(content = false) {
    return {
      Accept: 'application/json',
      'Cache-Control': 'no-store',
      Authorization: `Bearer ${this.apiKey}`,
      ...(content ? { 'Content-Type': 'application/json' } : {})
    };
  }

  async checkAvailability() {
    if (!this.configured) return { available: false, code: 'NOT_CONFIGURED' };
    const senderDomain = this.fromAddress.split('@').pop()?.toLowerCase();
    const payload = await fetchJson(this.fetch, 'https://api.resend.com/domains', { method: 'GET', headers: this.#headers() });
    const domains = Array.isArray(payload?.data) ? payload.data : [];
    const ready = domains.some(domain =>
      String(domain?.name || '').toLowerCase() === senderDomain
      && domain.status === 'verified'
      && domain.capabilities?.sending !== 'disabled');
    return { available: ready, code: ready ? 'READY' : 'SENDER_NOT_VERIFIED' };
  }

  async getRemainingQuota() {
    if (!this.configured) return { remaining: 0, limit: 0, resetAt: 0, source: 'not-configured' };
    const limit = this.declaredDailyQuota;
    return { remaining: limit, limit, resetAt: nextUtcMidnight(this.now()), source: 'resend-declared-daily-quota' };
  }

  async sendVerification(input = {}) {
    if (!this.configured) throw new VerificationProviderError('NOT_CONFIGURED', VERIFICATION_FAILURE_CLASS.HARD);
    const destination = String(input.destination || '');
    const code = String(input.code || '');
    if (!validEmailAddress(destination) || !/^\d{6}$/.test(code)) {
      throw new VerificationProviderError('INVALID_DESTINATION', VERIFICATION_FAILURE_CLASS.USER);
    }
    const expiresAt = Number(input.expiresAt || 0);
    const minutes = expiresAt > 0 ? Math.max(1, Math.round((expiresAt - Number(this.now())) / 60_000)) : 5;
    const { text, html } = otpEmailBody(code, minutes, input.recipientName);
    const payload = await fetchJson(this.fetch, 'https://api.resend.com/emails', {
      method: 'POST',
      headers: this.#headers(true),
      body: JSON.stringify({
        from: `${this.fromName} <${this.fromAddress}>`,
        to: [destination],
        subject: `${OTP_EMAIL_APP}, আপনার যাচাইকরণ কোড`,
        html,
        text
      })
    });
    if (typeof payload?.id !== 'string' || !payload.id) {
      throw new VerificationProviderError('INVALID_PROVIDER_RESPONSE', VERIFICATION_FAILURE_CLASS.HARD);
    }
    return { accepted: true };
  }

  async verifyCode() { throw new VerificationProviderError('LOCAL_VERIFICATION_ONLY', VERIFICATION_FAILURE_CLASS.USER); }
  async getProviderStatus() {
    return { status: this.configured ? 'configured' : 'disabled', configured: this.configured, officialApi: true, mailer: 'resend' };
  }
}

export class AgentMailOtpVerificationProvider {
  constructor({ id = 'otp-e', apiKey, inboxId, declaredDailyQuota, fetchImpl = globalThis.fetch, now = Date.now } = {}) {
    this.id = String(id || '');
    this.channel = VERIFICATION_CHANNELS.OTP;
    this.verificationMode = VERIFICATION_MODES.LOCAL_CODE;
    this.apiKey = String(apiKey || '');
    this.inboxId = validEmailAddress(inboxId) ? String(inboxId) : '';
    this.declaredDailyQuota = safeInteger(declaredDailyQuota, 1, 10_000_000);
    this.fetch = typeof fetchImpl === 'function' ? fetchImpl.bind(globalThis) : null;
    this.now = typeof now === 'function' ? now : Date.now;
    this.configured = Boolean(validSecret(this.apiKey) && this.inboxId && this.declaredDailyQuota && this.fetch);
  }

  // AgentMail signs the sender with the inbox the message is sent from, so there is
  // no separate from-address to verify. A read of the inbox is the cheapest proof
  // that the key is live and scoped to an inbox this worker may send from.
  //
  // The recipient-visible name is the inbox display_name, which AgentMail defaults
  // to "AgentMail" -- a vendor name leaking into every OTP. There is no per-message
  // from field to override it, so sync it here, on the probe that precedes every
  // send, instead of depending on an operator to PATCH it by hand. The write only
  // happens while the value differs, and a failure never blocks the send.
  async #syncDisplayName(inbox) {
    const current = String(inbox?.display_name ?? inbox?.displayName ?? '').trim();
    if (current === OTP_EMAIL_APP) return true;
    try {
      const response = await this.fetch(`https://api.agentmail.to/inboxes/${encodeURIComponent(this.inboxId)}`, {
        method: 'PATCH',
        headers: {
          Accept: 'application/json',
          'Cache-Control': 'no-store',
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`
        },
        body: JSON.stringify({ display_name: OTP_EMAIL_APP }),
        signal: AbortSignal.timeout(15_000)
      });
      if (!response.ok) return false;
      let payload = {};
      try { payload = await response.json(); } catch {}
      return String(payload?.display_name ?? payload?.displayName ?? '').trim() === OTP_EMAIL_APP;
    } catch {
      return false;
    }
  }

  async checkAvailability() {
    if (!this.configured) return { available: false, code: 'NOT_CONFIGURED' };
    const payload = await fetchJson(this.fetch, `https://api.agentmail.to/inboxes/${encodeURIComponent(this.inboxId)}`, {
      method: 'GET',
      headers: { Accept: 'application/json', 'Cache-Control': 'no-store', Authorization: `Bearer ${this.apiKey}` }
    });
    const ready = String(payload?.inbox_id || payload?.inboxId || '') === this.inboxId;
    if (!ready) return { available: false, code: 'INBOX_NOT_AVAILABLE' };
    const named = await this.#syncDisplayName(payload);
    return { available: true, code: named ? 'READY' : 'DISPLAY_NAME_UNSET' };
  }

  async getRemainingQuota() {
    if (!this.configured) return { remaining: 0, limit: 0, resetAt: 0, source: 'not-configured' };
    const limit = this.declaredDailyQuota;
    return { remaining: limit, limit, resetAt: nextUtcMidnight(this.now()), source: 'agentmail-declared-daily-quota' };
  }

  async sendVerification(input = {}) {
    if (!this.configured) throw new VerificationProviderError('NOT_CONFIGURED', VERIFICATION_FAILURE_CLASS.HARD);
    const destination = String(input.destination || '');
    const code = String(input.code || '');
    if (!validEmailAddress(destination) || !/^\d{6}$/.test(code)) {
      throw new VerificationProviderError('INVALID_DESTINATION', VERIFICATION_FAILURE_CLASS.USER);
    }
    const expiresAt = Number(input.expiresAt || 0);
    const minutes = expiresAt > 0 ? Math.max(1, Math.round((expiresAt - Number(this.now())) / 60_000)) : 5;
    const { text, html } = otpEmailBody(code, minutes, input.recipientName);
    const payload = await fetchJson(this.fetch, `https://api.agentmail.to/inboxes/${encodeURIComponent(this.inboxId)}/messages/send`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Cache-Control': 'no-store',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`
      },
      body: JSON.stringify({
        to: destination,
        subject: `${OTP_EMAIL_APP}, আপনার যাচাইকরণ কোড`,
        html,
        text
      })
    });
    const reference = payload?.message_id || payload?.messageId || payload?.id;
    if (typeof reference !== 'string' || !reference) {
      throw new VerificationProviderError('INVALID_PROVIDER_RESPONSE', VERIFICATION_FAILURE_CLASS.HARD);
    }
    return { accepted: true };
  }

  async verifyCode() { throw new VerificationProviderError('LOCAL_VERIFICATION_ONLY', VERIFICATION_FAILURE_CLASS.USER); }
  async getProviderStatus() {
    return { status: this.configured ? 'configured' : 'disabled', configured: this.configured, officialApi: true, mailer: 'agentmail' };
  }
}

export class MailerSendOtpVerificationProvider {
  // MailerSend's trial domain (test-*.mlsender.net) is verified by MailerSend itself
  // and needs no DNS the owner controls, so it is one of the few senders that works
  // without a custom domain. The API reports it under /v1/domains as is_verified.
  constructor({ id = 'otp-f', apiKey, fromAddress, fromName = OTP_EMAIL_APP, declaredDailyQuota, fetchImpl = globalThis.fetch, now = Date.now } = {}) {
    this.id = String(id || '');
    this.channel = VERIFICATION_CHANNELS.OTP;
    this.verificationMode = VERIFICATION_MODES.LOCAL_CODE;
    this.apiKey = String(apiKey || '');
    this.fromAddress = validEmailAddress(fromAddress) ? String(fromAddress) : '';
    this.fromName = String(fromName || OTP_EMAIL_APP).slice(0, 64);
    this.declaredDailyQuota = safeInteger(declaredDailyQuota, 1, 10_000_000);
    this.fetch = typeof fetchImpl === 'function' ? fetchImpl.bind(globalThis) : null;
    this.now = typeof now === 'function' ? now : Date.now;
    this.configured = Boolean(validSecret(this.apiKey) && this.fromAddress && this.declaredDailyQuota && this.fetch);
  }

  #headers(content = false) {
    return {
      Accept: 'application/json',
      'Cache-Control': 'no-store',
      Authorization: `Bearer ${this.apiKey}`,
      ...(content ? { 'Content-Type': 'application/json' } : {})
    };
  }

  // The trial domain is only usable while it stays verified, so readiness is probed
  // live instead of trusted from a stored flag.
  async checkAvailability() {
    if (!this.configured) return { available: false, code: 'NOT_CONFIGURED' };
    const senderDomain = this.fromAddress.split('@').pop()?.toLowerCase();
    const payload = await fetchJson(this.fetch, 'https://api.mailersend.com/v1/domains', { method: 'GET', headers: this.#headers() });
    const domains = Array.isArray(payload?.data) ? payload.data : [];
    const ready = domains.some(domain =>
      String(domain?.name || '').toLowerCase() === senderDomain
      && domain.is_verified === true
      && domain.domain_settings?.send_paused !== true);
    return { available: ready, code: ready ? 'READY' : 'SENDER_NOT_VERIFIED' };
  }

  async getRemainingQuota() {
    if (!this.configured) return { remaining: 0, limit: 0, resetAt: 0, source: 'not-configured' };
    const limit = this.declaredDailyQuota;
    return { remaining: limit, limit, resetAt: nextUtcMidnight(this.now()), source: 'mailersend-declared-daily-quota' };
  }

  async sendVerification(input = {}) {
    if (!this.configured) throw new VerificationProviderError('NOT_CONFIGURED', VERIFICATION_FAILURE_CLASS.HARD);
    const destination = String(input.destination || '');
    const code = String(input.code || '');
    if (!validEmailAddress(destination) || !/^\d{6}$/.test(code)) {
      throw new VerificationProviderError('INVALID_DESTINATION', VERIFICATION_FAILURE_CLASS.USER);
    }
    const expiresAt = Number(input.expiresAt || 0);
    const minutes = expiresAt > 0 ? Math.max(1, Math.round((expiresAt - Number(this.now())) / 60_000)) : 5;
    const { text, html } = otpEmailBody(code, minutes, input.recipientName);
    await fetchJson(this.fetch, 'https://api.mailersend.com/v1/email', {
      method: 'POST',
      headers: this.#headers(true),
      body: JSON.stringify({
        from: { email: this.fromAddress, name: this.fromName },
        to: [{ email: destination }],
        subject: `${OTP_EMAIL_APP}, আপনার যাচাইকরণ কোড`,
        html,
        text
      })
    });
    // A 202 with an empty body is the success shape here, so acceptance is inferred
    // from the request not throwing.
    return { accepted: true };
  }

  async verifyCode() { throw new VerificationProviderError('LOCAL_VERIFICATION_ONLY', VERIFICATION_FAILURE_CLASS.USER); }
  async getProviderStatus() {
    return { status: this.configured ? 'configured' : 'disabled', configured: this.configured, officialApi: true, mailer: 'mailersend' };
  }
}

export class DeadSimpleEmailOtpVerificationProvider {
  // Dead Simple Email's inbox domain (box*.deadsimple.email) is signed by the
  // provider itself, so like AgentMail this slot carries real recipients without
  // the owner owning a domain. The inbox it sends from is the sender, so there is
  // no from-address to verify; a read of the inbox is the cheapest proof the key
  // is live and scoped to an inbox this worker may send from.
  constructor({ id = 'otp-g', apiKey, inboxId, declaredDailyQuota, fetchImpl = globalThis.fetch, now = Date.now } = {}) {
    this.id = String(id || '');
    this.channel = VERIFICATION_CHANNELS.OTP;
    this.verificationMode = VERIFICATION_MODES.LOCAL_CODE;
    this.apiKey = String(apiKey || '');
    this.inboxId = validInboxId(inboxId) ? String(inboxId) : '';
    this.declaredDailyQuota = safeInteger(declaredDailyQuota, 1, 10_000_000);
    this.fetch = typeof fetchImpl === 'function' ? fetchImpl.bind(globalThis) : null;
    this.now = typeof now === 'function' ? now : Date.now;
    this.configured = Boolean(validSecret(this.apiKey) && this.inboxId && this.declaredDailyQuota && this.fetch);
  }

  #headers(content = false) {
    return {
      Accept: 'application/json',
      'Cache-Control': 'no-store',
      Authorization: `Bearer ${this.apiKey}`,
      ...(content ? { 'Content-Type': 'application/json' } : {})
    };
  }

  async checkAvailability() {
    if (!this.configured) return { available: false, code: 'NOT_CONFIGURED' };
    const payload = await fetchJson(this.fetch, `https://api.deadsimple.email/v1/inboxes/${encodeURIComponent(this.inboxId)}`, { method: 'GET', headers: this.#headers() });
    const inbox = payload?.data || payload;
    const ready = String(inbox?.inbox_id || '') === this.inboxId && inbox?.status === 'active';
    if (!ready) return { available: false, code: 'INBOX_NOT_AVAILABLE' };
    const named = await this.#syncDisplayName(inbox);
    return { available: true, code: named ? 'READY' : 'DISPLAY_NAME_UNSET' };
  }

  // The inbox it sends from is the sender, and Dead Simple leaves display_name
  // empty until someone sets it, so the recipient sees a bare address. There is
  // no per-message from field to override it, so sync it here, on the probe that
  // precedes every send, instead of depending on an operator to PATCH it by hand.
  // The write only happens while the value differs, and a failure never blocks
  // the send.
  async #syncDisplayName(inbox) {
    const current = String(inbox?.display_name ?? inbox?.displayName ?? '').trim();
    if (current === OTP_EMAIL_APP) return true;
    try {
      const response = await this.fetch(`https://api.deadsimple.email/v1/inboxes/${encodeURIComponent(this.inboxId)}`, {
        method: 'PATCH',
        headers: this.#headers(true),
        body: JSON.stringify({ display_name: OTP_EMAIL_APP }),
        signal: AbortSignal.timeout(15_000)
      });
      if (!response.ok) return false;
      let payload = {};
      try { payload = await response.json(); } catch {}
      const updated = payload?.data || payload;
      return String(updated?.display_name ?? updated?.displayName ?? '').trim() === OTP_EMAIL_APP;
    } catch {
      return false;
    }
  }

  async getRemainingQuota() {
    if (!this.configured) return { remaining: 0, limit: 0, resetAt: 0, source: 'not-configured' };
    const limit = this.declaredDailyQuota;
    return { remaining: limit, limit, resetAt: nextUtcMidnight(this.now()), source: 'deadsimpleemail-declared-daily-quota' };
  }

  async sendVerification(input = {}) {
    if (!this.configured) throw new VerificationProviderError('NOT_CONFIGURED', VERIFICATION_FAILURE_CLASS.HARD);
    const destination = String(input.destination || '');
    const code = String(input.code || '');
    if (!validEmailAddress(destination) || !/^\d{6}$/.test(code)) {
      throw new VerificationProviderError('INVALID_DESTINATION', VERIFICATION_FAILURE_CLASS.USER);
    }
    const expiresAt = Number(input.expiresAt || 0);
    const minutes = expiresAt > 0 ? Math.max(1, Math.round((expiresAt - Number(this.now())) / 60_000)) : 5;
    const { text, html } = otpEmailBody(code, minutes, input.recipientName);
    const payload = await fetchJson(this.fetch, `https://api.deadsimple.email/v1/inboxes/${encodeURIComponent(this.inboxId)}/messages`, {
      method: 'POST',
      headers: this.#headers(true),
      body: JSON.stringify({
        to: destination,
        subject: `${OTP_EMAIL_APP}, আপনার যাচাইকরণ কোড`,
        html_body: html,
        text_body: text
      })
    });
    const reference = payload?.data?.message_id;
    if (typeof reference !== 'string' || !reference) {
      throw new VerificationProviderError('INVALID_PROVIDER_RESPONSE', VERIFICATION_FAILURE_CLASS.HARD);
    }
    return { accepted: true };
  }

  async verifyCode() { throw new VerificationProviderError('LOCAL_VERIFICATION_ONLY', VERIFICATION_FAILURE_CLASS.USER); }
  async getProviderStatus() {
    return { status: this.configured ? 'configured' : 'disabled', configured: this.configured, officialApi: true, mailer: 'deadsimpleemail' };
  }
}

export class MailjetOtpVerificationProvider {
  constructor({ id = 'mailjet', apiKey, secretKey, apiBase = 'https://api.mailjet.com', fromAddress, fromName = OTP_EMAIL_APP, declaredDailyQuota, fetchImpl = globalThis.fetch, now = Date.now } = {}) {
    this.id = String(id || '');
    this.channel = VERIFICATION_CHANNELS.OTP;
    this.verificationMode = VERIFICATION_MODES.LOCAL_CODE;
    this.apiKey = String(apiKey || '');
    this.secretKey = String(secretKey || '');
    // An unrecognized base is not silently rewritten: a US account sent to the EU
    // host authenticates against the wrong region, so fail closed instead.
    this.apiBase = MAILJET_API_BASES.has(String(apiBase || '').trim()) ? String(apiBase).trim() : '';
    this.fromAddress = validEmailAddress(fromAddress) ? String(fromAddress) : '';
    this.fromName = String(fromName || OTP_EMAIL_APP).slice(0, 64);
    this.declaredDailyQuota = safeInteger(declaredDailyQuota, 1, 10_000_000);
    this.fetch = typeof fetchImpl === 'function' ? fetchImpl.bind(globalThis) : null;
    this.now = typeof now === 'function' ? now : Date.now;
    this.configured = Boolean(validSecret(this.apiKey) && validSecret(this.secretKey) && this.apiBase && this.fromAddress && this.declaredDailyQuota && this.fetch);
  }

  #headers(content = false) {
    return {
      Accept: 'application/json',
      'Cache-Control': 'no-store',
      Authorization: `Basic ${base64Bytes(`${this.apiKey}:${this.secretKey}`)}`,
      ...(content ? { 'Content-Type': 'application/json' } : {})
    };
  }

  // A sender registered under a Mailjet subaccount is absent from /sender and only
  // listed by /metasender, so both endpoints are probed. Probing one would report a
  // working sender as SENDER_NOT_VERIFIED and silently drop the slot.
  async checkAvailability() {
    if (!this.configured) return { available: false, code: 'NOT_CONFIGURED' };
    const senderCheck = this.#probeSender();
    const metaCheck = this.#probeMetaSender();
    const results = await Promise.allSettled([senderCheck, metaCheck]);
    const verified = results.find(result => result.status === 'fulfilled' && result.value === true);
    if (verified) return { available: true, code: 'READY' };
    // A rejected probe is an outage, not a missing sender: only a clean false from
    // both endpoints proves the address is unconfirmed.
    const failed = results.find(result => result.status === 'rejected');
    if (failed) throw failed.reason;
    return { available: false, code: 'SENDER_NOT_VERIFIED' };
  }

  async #probeSender() {
    const payload = await fetchJson(this.fetch, `${this.apiBase}/v3/REST/sender?SenderEmail=${encodeURIComponent(this.fromAddress)}`, { method: 'GET', headers: this.#headers() });
    const rows = Array.isArray(payload?.Data) ? payload.Data : [];
    const sender = rows.find(item => String(item?.Email || item?.SenderEmail || '').toLowerCase() === this.fromAddress.toLowerCase());
    return Boolean(sender && ['active', 'validated'].includes(String(sender?.Status || '').toLowerCase()));
  }

  async #probeMetaSender() {
    const payload = await fetchJson(this.fetch, `${this.apiBase}/v3/REST/metasender?Limit=100`, { method: 'GET', headers: this.#headers() });
    const rows = Array.isArray(payload?.Data) ? payload.Data : [];
    const sender = rows.find(item => String(item?.Email || '').toLowerCase() === this.fromAddress.toLowerCase());
    return Boolean(sender && (sender?.IsEnabled === true || sender?.IsEnabled === 1 || String(sender?.IsEnabled || '').toLowerCase() === 'true'));
  }

  async getRemainingQuota() {
    if (!this.configured) return { remaining: 0, limit: 0, resetAt: 0, source: 'not-configured' };
    const limit = this.declaredDailyQuota;
    return { remaining: limit, limit, resetAt: nextUtcMidnight(this.now()), source: 'mailjet-declared-daily-quota' };
  }

  async sendVerification(input = {}) {
    if (!this.configured) throw new VerificationProviderError('NOT_CONFIGURED', VERIFICATION_FAILURE_CLASS.HARD);
    const destination = String(input.destination || '');
    const code = String(input.code || '');
    if (!validEmailAddress(destination) || !/^\d{6}$/.test(code)) {
      throw new VerificationProviderError('INVALID_DESTINATION', VERIFICATION_FAILURE_CLASS.USER);
    }
    const expiresAt = Number(input.expiresAt || 0);
    const minutes = expiresAt > 0 ? Math.max(1, Math.round((expiresAt - Number(this.now())) / 60_000)) : 5;
    const { text, html } = otpEmailBody(code, minutes, input.recipientName);
    const payload = await fetchJson(this.fetch, `${this.apiBase}/v3.1/send`, {
      method: 'POST',
      headers: this.#headers(true),
      body: JSON.stringify({
        Messages: [{
          From: { Email: this.fromAddress, Name: this.fromName },
          To: [{ Email: destination }],
          Subject: `${OTP_EMAIL_APP}, আপনার যাচাইকরণ কোড`,
          HTMLPart: html,
          TextPart: text,
          CustomID: 'admission-hub-transactional'
        }]
      })
    });
    const messageRef = payload?.Messages?.[0]?.To?.[0]?.MessageUUID;
    if (typeof messageRef !== 'string' || !messageRef) {
      throw new VerificationProviderError('INVALID_PROVIDER_RESPONSE', VERIFICATION_FAILURE_CLASS.HARD);
    }
    return { accepted: true };
  }

  async verifyCode() { throw new VerificationProviderError('LOCAL_VERIFICATION_ONLY', VERIFICATION_FAILURE_CLASS.USER); }
  async getProviderStatus() {
    return { status: this.configured ? 'configured' : 'disabled', configured: this.configured, officialApi: true, mailer: 'mailjet' };
  }
}

export class AppsScriptOtpVerificationProvider {
  constructor({ id = 'otp-b', webAppUrl, sharedSecret, declaredDailyQuota, fetchImpl = globalThis.fetch, cryptoImpl = globalThis.crypto, now = Date.now } = {}) {
    this.id = String(id || '');
    this.channel = VERIFICATION_CHANNELS.OTP;
    this.verificationMode = VERIFICATION_MODES.LOCAL_CODE;
    this.webAppUrl = appsScriptWebAppUrl(webAppUrl);
    this.sharedSecret = validSecret(sharedSecret) ? String(sharedSecret) : '';
    this.declaredDailyQuota = safeInteger(declaredDailyQuota, 1, 10_000_000);
    this.fetch = typeof fetchImpl === 'function' ? fetchImpl.bind(globalThis) : null;
    this.crypto = cryptoImpl?.subtle && typeof cryptoImpl.getRandomValues === 'function' ? cryptoImpl : null;
    this.now = typeof now === 'function' ? now : Date.now;
    this.keyPromise = null;
    this.configured = Boolean(this.webAppUrl && this.sharedSecret && this.declaredDailyQuota && this.fetch && this.crypto);
  }

  async #signature(canonical) {
    if (!this.keyPromise) {
      this.keyPromise = this.crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(this.sharedSecret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
      );
    }
    const key = await this.keyPromise;
    const signature = await this.crypto.subtle.sign('HMAC', key, new TextEncoder().encode(canonical));
    return base64UrlBytes(signature);
  }

  // The Apps Script web app answers on a googleusercontent.com redirect, so these
  // calls must follow redirects instead of the manual default.
  async #call(action, { destination = '', code = '' } = {}) {
    const timestamp = String(Math.floor(Number(this.now()) / 1000));
    const nonceBytes = new Uint8Array(18);
    this.crypto.getRandomValues(nonceBytes);
    const nonce = base64UrlBytes(nonceBytes);
    const signature = await this.#signature([action, timestamp, nonce, destination, code].join('\n'));
    const options = { redirect: 'follow', timeoutMs: 15_000 };
    if (action === 'send') {
      return fetchJson(this.fetch, this.webAppUrl, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
        body: JSON.stringify({ action, timestamp, nonce, destination, code, signature })
      }, options);
    }
    const url = new URL(this.webAppUrl);
    url.searchParams.set('action', action);
    url.searchParams.set('timestamp', timestamp);
    url.searchParams.set('nonce', nonce);
    url.searchParams.set('signature', signature);
    return fetchJson(this.fetch, url.href, {
      method: 'GET',
      headers: { Accept: 'application/json', 'Cache-Control': 'no-store' }
    }, options);
  }

  async checkAvailability() {
    if (!this.configured) return { available: false, code: 'NOT_CONFIGURED' };
    const payload = await this.#call('health');
    const ready = payload?.ok === true && payload?.ready === true;
    return { available: ready, code: ready ? 'READY' : 'NOT_READY' };
  }

  async getRemainingQuota() {
    if (!this.configured) return { remaining: 0, limit: 0, resetAt: 0, source: 'not-configured' };
    const payload = await this.#call('quota');
    const limit = safeInteger(payload?.limit, 1, this.declaredDailyQuota) || this.declaredDailyQuota;
    const remaining = Math.min(limit, safeInteger(payload?.remaining, 0, limit));
    const resetAt = safeInteger(payload?.resetAt, 0, 9_000_000_000_000);
    if (!resetAt) throw new VerificationProviderError('INVALID_QUOTA_RESPONSE', VERIFICATION_FAILURE_CLASS.HARD);
    return { remaining, limit, resetAt, source: 'apps-script-mail-quota' };
  }

  async sendVerification(input = {}) {
    if (!this.configured) throw new VerificationProviderError('NOT_CONFIGURED', VERIFICATION_FAILURE_CLASS.HARD);
    const destination = String(input.destination || '');
    const code = String(input.code || '');
    if (!validEmailAddress(destination) || !/^\d{6}$/.test(code)) {
      throw new VerificationProviderError('INVALID_DESTINATION', VERIFICATION_FAILURE_CLASS.USER);
    }
    const payload = await this.#call('send', { destination, code });
    if (payload?.accepted !== true || !/^[A-Za-z0-9_-]{6,128}$/.test(String(payload?.messageRef || ''))) {
      throw new VerificationProviderError('INVALID_PROVIDER_RESPONSE', VERIFICATION_FAILURE_CLASS.HARD);
    }
    return { accepted: true };
  }

  async verifyCode() { throw new VerificationProviderError('LOCAL_VERIFICATION_ONLY', VERIFICATION_FAILURE_CLASS.USER); }
  async getProviderStatus() {
    return { status: this.configured ? 'configured' : 'disabled', configured: this.configured, officialApi: false, mailer: 'google-apps-script' };
  }
}

export class BridgeOtpVerificationProvider {
  constructor({ id, origin, apiKey, declaredDailyQuota, fetchImpl = globalThis.fetch } = {}) {
    this.id = String(id || '');
    this.channel = VERIFICATION_CHANNELS.OTP;
    this.verificationMode = VERIFICATION_MODES.LOCAL_CODE;
    this.origin = httpsOrigin(origin);
    this.apiKey = String(apiKey || '');
    this.declaredDailyQuota = safeInteger(declaredDailyQuota, 1, 10_000_000);
    this.fetch = typeof fetchImpl === 'function' ? fetchImpl.bind(globalThis) : null;
    this.configured = Boolean(this.origin && validSecret(this.apiKey) && this.declaredDailyQuota && this.fetch);
  }

  #headers(content = false) {
    return {
      Accept: 'application/json',
      'Cache-Control': 'no-store',
      'X-Verification-Key': this.apiKey,
      ...(content ? { 'Content-Type': 'application/json' } : {})
    };
  }

  async checkAvailability() {
    if (!this.configured) return { available: false, code: 'NOT_CONFIGURED' };
    try {
      const payload = await fetchJson(this.fetch, `${this.origin}/v1/verification/health`, { method: 'GET', headers: this.#headers() });
      return { available: payload?.ok === true && payload?.ready === true, code: payload?.ready === true ? 'READY' : 'NOT_READY' };
    } catch (error) { throw error; }
  }

  async getRemainingQuota() {
    if (!this.configured) return { remaining: 0, limit: 0, resetAt: 0, source: 'not-configured' };
    const payload = await fetchJson(this.fetch, `${this.origin}/v1/verification/quota`, { method: 'GET', headers: this.#headers() });
    const limit = safeInteger(payload?.limit, 1, this.declaredDailyQuota) || this.declaredDailyQuota;
    const remaining = Math.min(limit, safeInteger(payload?.remaining, 0, limit));
    const resetAt = safeInteger(payload?.resetAt, 0, 9_000_000_000_000);
    if (!resetAt) throw new VerificationProviderError('INVALID_QUOTA_RESPONSE', VERIFICATION_FAILURE_CLASS.HARD);
    return { remaining, limit, resetAt, source: 'provider-api' };
  }

  async sendVerification(input = {}) {
    if (!this.configured) throw new VerificationProviderError('NOT_CONFIGURED', VERIFICATION_FAILURE_CLASS.HARD);
    if (!/^\d{6}$/.test(String(input.code || '')) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(input.destination || ''))) {
      throw new VerificationProviderError('INVALID_DESTINATION', VERIFICATION_FAILURE_CLASS.USER);
    }
    const payload = await fetchJson(this.fetch, `${this.origin}/v1/verification/send`, {
      method: 'POST',
      headers: this.#headers(true),
      body: JSON.stringify({
        attemptId: input.attemptId,
        destination: input.destination,
        code: input.code,
        purpose: input.purpose,
        expiresAt: input.expiresAt
      })
    });
    if (payload?.accepted !== true || !/^[A-Za-z0-9_-]{6,128}$/.test(String(payload?.messageRef || ''))) {
      throw new VerificationProviderError('INVALID_PROVIDER_RESPONSE', VERIFICATION_FAILURE_CLASS.HARD);
    }
    return { accepted: true };
  }

  async verifyCode() { throw new VerificationProviderError('LOCAL_VERIFICATION_ONLY', VERIFICATION_FAILURE_CLASS.USER); }
  async getProviderStatus() {
    return { status: this.configured ? 'configured' : 'disabled', configured: this.configured };
  }
}

export class OfficialWhatsAppVerificationProvider {
  constructor({ graphVersion, phoneNumberId, accessToken, templateName, templateLanguage = 'en_US', declaredDailyQuota, fetchImpl = globalThis.fetch } = {}) {
    this.id = 'whatsapp';
    this.channel = VERIFICATION_CHANNELS.WHATSAPP;
    this.verificationMode = VERIFICATION_MODES.LOCAL_CODE;
    this.graphVersion = /^v\d{1,2}\.\d$/.test(String(graphVersion || '')) ? String(graphVersion) : '';
    this.phoneNumberId = /^\d{6,32}$/.test(String(phoneNumberId || '')) ? String(phoneNumberId) : '';
    this.accessToken = String(accessToken || '');
    this.templateName = /^[a-z0-9_]{3,128}$/.test(String(templateName || '')) ? String(templateName) : '';
    this.templateLanguage = /^[a-z]{2,3}(?:_[A-Z]{2})?$/.test(String(templateLanguage || '')) ? String(templateLanguage) : '';
    this.declaredDailyQuota = safeInteger(declaredDailyQuota, 1, 10_000_000);
    this.fetch = typeof fetchImpl === 'function' ? fetchImpl.bind(globalThis) : null;
    this.configured = Boolean(this.graphVersion && this.phoneNumberId && validSecret(this.accessToken) && this.templateName && this.templateLanguage && this.declaredDailyQuota && this.fetch);
  }

  #url(suffix = '') { return `https://graph.facebook.com/${this.graphVersion}/${this.phoneNumberId}${suffix}`; }
  #headers(content = false) {
    return {
      Accept: 'application/json',
      Authorization: `Bearer ${this.accessToken}`,
      'Cache-Control': 'no-store',
      ...(content ? { 'Content-Type': 'application/json' } : {})
    };
  }

  async checkAvailability() {
    if (!this.configured) return { available: false, code: 'NOT_CONFIGURED' };
    const payload = await fetchJson(this.fetch, `${this.#url()}?fields=id`, { method: 'GET', headers: this.#headers() });
    return { available: String(payload?.id || '') === this.phoneNumberId, code: String(payload?.id || '') === this.phoneNumberId ? 'READY' : 'PHONE_ID_MISMATCH' };
  }

  async getRemainingQuota({ now = Date.now() } = {}) {
    if (!this.configured) return { remaining: 0, limit: 0, resetAt: 0, source: 'not-configured' };
    const resetAt = (Math.floor(Number(now) / 86_400_000) + 1) * 86_400_000;
    return { remaining: this.declaredDailyQuota, limit: this.declaredDailyQuota, resetAt, source: 'operator-declared-cap' };
  }

  async sendVerification(input = {}) {
    if (!this.configured) throw new VerificationProviderError('NOT_CONFIGURED', VERIFICATION_FAILURE_CLASS.HARD);
    const destination = String(input.destination || '');
    const code = String(input.code || '');
    if (!/^\+[1-9]\d{7,14}$/.test(destination) || !/^\d{6}$/.test(code)) {
      throw new VerificationProviderError('INVALID_DESTINATION', VERIFICATION_FAILURE_CLASS.USER);
    }
    const payload = await fetchJson(this.fetch, this.#url('/messages'), {
      method: 'POST',
      headers: this.#headers(true),
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: destination.slice(1),
        type: 'template',
        template: {
          name: this.templateName,
          language: { code: this.templateLanguage },
          components: [{ type: 'body', parameters: [{ type: 'text', text: code }] }]
        }
      })
    });
    if (!validSecret(String(payload?.messages?.[0]?.id || ''))) {
      throw new VerificationProviderError('INVALID_PROVIDER_RESPONSE', VERIFICATION_FAILURE_CLASS.HARD);
    }
    return { accepted: true };
  }

  async verifyCode() { throw new VerificationProviderError('LOCAL_VERIFICATION_ONLY', VERIFICATION_FAILURE_CLASS.USER); }
  async getProviderStatus() {
    return { status: this.configured ? 'configured' : 'disabled', configured: this.configured, officialApi: true };
  }
}

// Slot `otp-h` is Logto's free email service (no card, no domain; sender
// no-reply@logto.email, SPF/DKIM/DMARC pass, measured Inbox 2026-10-15). Logto
// creates and checks the code itself, so this slot is provider-evidence: the
// student's 6-digit code is the evidence. It drives Logto's public sign-in
// Experience API with the public SPA app id, so no secret is needed. The
// short-lived interaction cookies are kept per attempt in memory and KV (10 min).
const LOGTO_STATE_TTL_SECONDS = 600;
// Public, non-secret Logto values live in code, not in wrangler.toml [vars]:
// Workers Free caps a Worker at 64 variables (secrets + text) and this Worker
// already sits on that ceiling, so four extra vars failed the 2026-10-15 deploy
// (code 10055, 68 > 64). The defaults only apply when the owner has enabled
// `otp-h` in VERIFICATION_ORCHESTRATOR_CONFIG, so an empty env still fails
// closed; an env binding of the same name still overrides each value.
const LOGTO_PUBLIC_DEFAULTS = Object.freeze({
  endpoint: 'https://dl635v.logto.app',
  appId: 'dk00yf3jvdmyy4mduoizp',
  redirectUri: 'https://admissionsky.pages.dev/logto-callback'
});
function logtoSlotFromConfig(raw) {
  try {
    const text = String(raw || '');
    if (!text || text.length > 16_384) return null;
    const config = JSON.parse(text);
    if (config?.enabled !== true) return null;
    const rows = config.providers;
    const row = Array.isArray(rows) ? rows.find(item => item?.id === 'otp-h') : null;
    return row && row.enabled === true ? row : null;
  } catch { return null; }
}
const validLogtoAppId = value => /^[a-z0-9]{12,32}$/.test(String(value || ''));
function logtoRedirect(value) {
  try {
    const url = new URL(String(value || ''));
    return url.protocol === 'https:' && !url.username && !url.password && !url.hash ? url.href : '';
  } catch { return ''; }
}
function cookiePairs(response, jar) {
  const list = typeof response?.headers?.getSetCookie === 'function' ? response.headers.getSetCookie() : [];
  for (const line of list) {
    const pair = String(line || '').split(';', 1)[0];
    const at = pair.indexOf('=');
    if (at > 0) jar[pair.slice(0, at).trim()] = pair.slice(at + 1).trim();
  }
  return jar;
}
async function sha256Base64Url(text) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(text))));
  let bin = ''; for (const b of digest) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
const cookieHeader = jar => Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');

export class LogtoOtpVerificationProvider {
  constructor({ id = 'otp-h', endpoint, appId, redirectUri, declaredDailyQuota, kv = null, fetchImpl = globalThis.fetch, now = Date.now } = {}) {
    this.id = String(id || '');
    this.channel = VERIFICATION_CHANNELS.OTP;
    this.verificationMode = VERIFICATION_MODES.PROVIDER_EVIDENCE;
    this.endpoint = httpsOrigin(endpoint);
    this.appId = validLogtoAppId(appId) ? String(appId) : '';
    this.redirectUri = logtoRedirect(redirectUri);
    this.declaredDailyQuota = safeInteger(declaredDailyQuota, 1, 10_000_000);
    this.kv = kv && typeof kv.get === 'function' && typeof kv.put === 'function' ? kv : null;
    this.fetch = typeof fetchImpl === 'function' ? fetchImpl.bind(globalThis) : null;
    this.now = typeof now === 'function' ? now : Date.now;
    this.memory = new Map();
    this.configured = Boolean(this.endpoint && this.appId && this.redirectUri && this.declaredDailyQuota && this.fetch);
  }

  async #call(path, { method = 'POST', jar, body } = {}) {
    let response;
    try {
      response = await this.fetch(`${this.endpoint}${path}`, {
        method,
        redirect: 'manual',
        headers: {
          Accept: 'application/json',
          'Cache-Control': 'no-store',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
          ...(jar && Object.keys(jar).length ? { Cookie: cookieHeader(jar) } : {})
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(12_000)
      });
    } catch { throw new VerificationProviderError('NETWORK_ERROR', VERIFICATION_FAILURE_CLASS.TEMPORARY); }
    if (jar) cookiePairs(response, jar);
    const payload = response.status === 204 || response.status === 303 || response.status === 302 ? {} : await boundedJson(response);
    return { response, payload };
  }

  async #saveState(attemptId, state) {
    const expires = Number(this.now()) + LOGTO_STATE_TTL_SECONDS * 1000;
    this.memory.set(attemptId, { ...state, expires });
    for (const [key, row] of this.memory) if (row.expires < Number(this.now())) this.memory.delete(key);
    if (this.kv) {
      try { await this.kv.put(`logto-otp:${attemptId}`, JSON.stringify(state), { expirationTtl: LOGTO_STATE_TTL_SECONDS }); } catch {}
    }
  }

  async #loadState(attemptId) {
    const row = this.memory.get(attemptId);
    if (row && row.expires >= Number(this.now())) return row;
    if (!this.kv) return null;
    try {
      const raw = await this.kv.get(`logto-otp:${attemptId}`);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }

  async #dropState(attemptId) {
    this.memory.delete(attemptId);
    if (this.kv && typeof this.kv.delete === 'function') { try { await this.kv.delete(`logto-otp:${attemptId}`); } catch {} }
  }

  async checkAvailability() {
    if (!this.configured) return { available: false, code: 'NOT_CONFIGURED' };
    return { available: true, code: 'READY' };
  }

  async getRemainingQuota() {
    if (!this.configured) return { remaining: 0, limit: 0, resetAt: 0, source: 'not-configured' };
    return { remaining: this.declaredDailyQuota, limit: this.declaredDailyQuota, resetAt: nextUtcMidnight(this.now()), source: 'declared' };
  }

  async sendVerification(input = {}) {
    if (!this.configured) throw new VerificationProviderError('NOT_CONFIGURED', VERIFICATION_FAILURE_CLASS.HARD);
    const destination = String(input.destination || '').trim().toLowerCase();
    const attemptId = String(input.attemptId || '');
    if (!validEmailAddress(destination) || !/^[A-Za-z0-9_-]{24,96}$/.test(attemptId)) {
      throw new VerificationProviderError('INVALID_DESTINATION', VERIFICATION_FAILURE_CLASS.USER);
    }
    const jar = {};
    const challenge = await sha256Base64Url(`${attemptId}:${crypto.randomUUID()}`);
    const auth = new URLSearchParams({
      client_id: this.appId, redirect_uri: this.redirectUri, response_type: 'code', scope: 'openid',
      code_challenge: challenge, code_challenge_method: 'S256', state: attemptId.slice(0, 32), prompt: 'login'
    });
    const start = await this.#call(`/oidc/auth?${auth}`, { method: 'GET', jar });
    if (start.response.status >= 400) throw httpFailure(start.response, start.payload, { userStatuses: [] });
    const experience = await this.#call('/api/experience', { method: 'PUT', jar, body: { interactionEvent: 'SignIn' } });
    if (!experience.response.ok) throw httpFailure(experience.response, experience.payload, { userStatuses: [] });
    const sent = await this.#call('/api/experience/verification/verification-code', {
      jar, body: { identifier: { type: 'email', value: destination }, interactionEvent: 'SignIn' }
    });
    if (!sent.response.ok) throw httpFailure(sent.response, sent.payload, { userStatuses: [] });
    const verificationId = String(sent.payload?.verificationId || '');
    if (!/^[A-Za-z0-9_-]{8,64}$/.test(verificationId)) throw new VerificationProviderError('INVALID_PROVIDER_RESPONSE', VERIFICATION_FAILURE_CLASS.HARD);
    await this.#saveState(attemptId, { jar, verificationId, email: destination });
    return { accepted: true };
  }

  async verifyCode(input = {}) {
    if (!this.configured) throw new VerificationProviderError('NOT_CONFIGURED', VERIFICATION_FAILURE_CLASS.HARD);
    const attemptId = String(input.attemptId || '');
    const code = String(input.evidence || '').trim();
    if (!/^\d{6}$/.test(code)) return { verified: false };
    const state = await this.#loadState(attemptId);
    if (!state?.verificationId) throw new VerificationProviderError('CHALLENGE_EXPIRED', VERIFICATION_FAILURE_CLASS.USER);
    const jar = { ...(state.jar || {}) };
    const result = await this.#call('/api/experience/verification/verification-code/verify', {
      jar, body: { identifier: { type: 'email', value: state.email }, verificationId: state.verificationId, code }
    });
    if (result.response.ok && String(result.payload?.verificationId || '') === state.verificationId) {
      await this.#dropState(attemptId);
      return { verified: true };
    }
    if (result.response.status === 400) return { verified: false };
    throw httpFailure(result.response, result.payload, { userStatuses: [] });
  }

  async getProviderStatus() {
    return { status: this.configured ? 'configured' : 'disabled', configured: this.configured, officialApi: true, mailer: 'logto' };
  }
}

// Slot `otp-i` is Appwrite Cloud's built-in Email OTP (project 6ad1e9280025bf4464ee,
// Frankfurt region). Appwrite creates, mails and checks the 6-digit code itself, so
// like otp-h this slot is provider-evidence. It drives the public Account API
// (POST /account/tokens/email, then POST /account/sessions/token) with only the
// public project id, so no secret is required. The temporary Appwrite session
// that a successful check creates is deleted straight away; we only need the
// yes/no answer. An optional APPWRITE_API_KEY secret (scope sessions.write) lifts
// Appwrite's per-IP abuse limits, but binding it costs one of the 64 Worker vars.
const APPWRITE_STATE_TTL_SECONDS = 900;
// Public, non-secret values live in code for the same 64-variable reason as Logto.
const APPWRITE_PUBLIC_DEFAULTS = Object.freeze({
  endpoint: 'https://fra.cloud.appwrite.io/v1',
  projectId: '6ad1e9280025bf4464ee'
});
function slotFromConfig(raw, id) {
  try {
    const text = String(raw || '');
    if (!text || text.length > 16_384) return null;
    const config = JSON.parse(text);
    if (config?.enabled !== true) return null;
    const rows = config.providers;
    const row = Array.isArray(rows) ? rows.find(item => item?.id === id) : null;
    return row && row.enabled === true ? row : null;
  } catch { return null; }
}
const validAppwriteProjectId = value => /^[A-Za-z0-9][A-Za-z0-9._-]{0,35}$/.test(String(value || ''));
const validAppwriteUserId = value => /^[A-Za-z0-9][A-Za-z0-9._-]{0,35}$/.test(String(value || ''));
function appwriteEndpoint(value) {
  try {
    const url = new URL(String(value || ''));
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) return '';
    const path = url.pathname.replace(/\/+$/, '');
    if (path !== '/v1') return '';
    return `${url.origin}/v1`;
  } catch { return ''; }
}

export class AppwriteOtpVerificationProvider {
  constructor({ id = 'otp-i', endpoint, projectId, apiKey, declaredDailyQuota, kv = null, fetchImpl = globalThis.fetch, now = Date.now } = {}) {
    this.id = String(id || '');
    this.channel = VERIFICATION_CHANNELS.OTP;
    this.verificationMode = VERIFICATION_MODES.PROVIDER_EVIDENCE;
    this.endpoint = appwriteEndpoint(endpoint);
    this.projectId = validAppwriteProjectId(projectId) ? String(projectId) : '';
    this.apiKey = validSecret(apiKey) ? apiKey : '';
    this.declaredDailyQuota = safeInteger(declaredDailyQuota, 1, 10_000_000);
    this.kv = kv && typeof kv.get === 'function' && typeof kv.put === 'function' ? kv : null;
    this.fetch = typeof fetchImpl === 'function' ? fetchImpl.bind(globalThis) : null;
    this.now = typeof now === 'function' ? now : Date.now;
    this.memory = new Map();
    this.configured = Boolean(this.endpoint && this.projectId && this.declaredDailyQuota && this.fetch);
  }

  #headers(extra = {}) {
    return {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'X-Appwrite-Project': this.projectId,
      'X-Appwrite-Response-Format': '1.6.0',
      ...(this.apiKey ? { 'X-Appwrite-Key': this.apiKey } : {}),
      ...extra
    };
  }

  async #call(path, { method = 'POST', body, headers = {} } = {}) {
    let response;
    try {
      response = await this.fetch(`${this.endpoint}${path}`, {
        method,
        redirect: 'manual',
        headers: this.#headers(headers),
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(12_000)
      });
    } catch { throw new VerificationProviderError('NETWORK_ERROR', VERIFICATION_FAILURE_CLASS.TEMPORARY); }
    const payload = response.status === 204 ? {} : await boundedJson(response);
    return { response, payload };
  }

  async #saveState(attemptId, state) {
    const expires = Number(this.now()) + APPWRITE_STATE_TTL_SECONDS * 1000;
    this.memory.set(attemptId, { ...state, expires });
    for (const [key, row] of this.memory) if (row.expires < Number(this.now())) this.memory.delete(key);
    if (this.kv) {
      try { await this.kv.put(`appwrite-otp:${attemptId}`, JSON.stringify(state), { expirationTtl: APPWRITE_STATE_TTL_SECONDS }); } catch {}
    }
  }

  async #loadState(attemptId) {
    const row = this.memory.get(attemptId);
    if (row && row.expires >= Number(this.now())) return row;
    if (!this.kv) return null;
    try {
      const raw = await this.kv.get(`appwrite-otp:${attemptId}`);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }

  async #dropState(attemptId) {
    this.memory.delete(attemptId);
    if (this.kv && typeof this.kv.delete === 'function') { try { await this.kv.delete(`appwrite-otp:${attemptId}`); } catch {} }
  }

  // Best effort: the session only proves the code was right, so it is removed.
  async #discardSession(response, payload, userId) {
    try {
      const sessionId = String(payload?.$id || '');
      if (this.apiKey && validAppwriteUserId(sessionId)) {
        await this.#call(`/users/${encodeURIComponent(userId)}/sessions/${encodeURIComponent(sessionId)}`, { method: 'DELETE' });
        return;
      }
      const jar = cookiePairs(response, {});
      const fallback = String(response?.headers?.get?.('X-Fallback-Cookies') || '');
      const headers = {};
      if (Object.keys(jar).length) headers.Cookie = cookieHeader(jar);
      if (fallback && fallback.length <= 4096) headers['X-Fallback-Cookies'] = fallback;
      if (!headers.Cookie && !headers['X-Fallback-Cookies']) return;
      await this.#call('/account/sessions/current', { method: 'DELETE', headers });
    } catch {}
  }

  async checkAvailability() {
    if (!this.configured) return { available: false, code: 'NOT_CONFIGURED' };
    return { available: true, code: 'READY' };
  }

  async getRemainingQuota() {
    if (!this.configured) return { remaining: 0, limit: 0, resetAt: 0, source: 'not-configured' };
    return { remaining: this.declaredDailyQuota, limit: this.declaredDailyQuota, resetAt: nextUtcMidnight(this.now()), source: 'declared' };
  }

  async sendVerification(input = {}) {
    if (!this.configured) throw new VerificationProviderError('NOT_CONFIGURED', VERIFICATION_FAILURE_CLASS.HARD);
    const destination = String(input.destination || '').trim().toLowerCase();
    const attemptId = String(input.attemptId || '');
    if (!validEmailAddress(destination) || !/^[A-Za-z0-9_-]{24,96}$/.test(attemptId)) {
      throw new VerificationProviderError('INVALID_DESTINATION', VERIFICATION_FAILURE_CLASS.USER);
    }
    // 'unique()' lets Appwrite reuse the existing user for a known email or create one.
    const sent = await this.#call('/account/tokens/email', { body: { userId: 'unique()', email: destination, phrase: false } });
    if (!sent.response.ok) {
      // 501 = Email OTP is switched off in the Appwrite console: a config fault, not an outage.
      if (Number(sent.response.status) === 501) throw new VerificationProviderError('PROVIDER_HTTP_501', VERIFICATION_FAILURE_CLASS.HARD);
      throw httpFailure(sent.response, sent.payload, { userStatuses: [] });
    }
    const userId = String(sent.payload?.userId || '');
    if (!validAppwriteUserId(userId)) throw new VerificationProviderError('INVALID_PROVIDER_RESPONSE', VERIFICATION_FAILURE_CLASS.HARD);
    await this.#saveState(attemptId, { userId, email: destination });
    return { accepted: true };
  }

  async verifyCode(input = {}) {
    if (!this.configured) throw new VerificationProviderError('NOT_CONFIGURED', VERIFICATION_FAILURE_CLASS.HARD);
    const attemptId = String(input.attemptId || '');
    const code = String(input.evidence || '').trim();
    if (!/^\d{6}$/.test(code)) return { verified: false };
    const state = await this.#loadState(attemptId);
    if (!state?.userId) throw new VerificationProviderError('CHALLENGE_EXPIRED', VERIFICATION_FAILURE_CLASS.USER);
    const result = await this.#call('/account/sessions/token', { body: { userId: state.userId, secret: code } });
    if (result.response.ok && String(result.payload?.userId || '') === state.userId) {
      await this.#dropState(attemptId);
      await this.#discardSession(result.response, result.payload, state.userId);
      return { verified: true };
    }
    if ([400, 401, 404].includes(Number(result.response.status))) return { verified: false };
    throw httpFailure(result.response, result.payload, { userStatuses: [] });
  }

  async getProviderStatus() {
    return { status: this.configured ? 'configured' : 'disabled', configured: this.configured, officialApi: true, mailer: 'appwrite' };
  }
}

// Shared KV/memory store for provider-evidence slots that must remember a
// provider-side flow between send and verify (otp-j Ory, otp-k Hanko).
function evidenceStateStore(prefix, ttlSeconds, kv, now) {
  const memory = new Map();
  const key = attemptId => `${prefix}:${attemptId}`;
  return {
    async save(attemptId, state) {
      const expires = Number(now()) + ttlSeconds * 1000;
      memory.set(attemptId, { ...state, expires });
      for (const [id, row] of memory) if (row.expires < Number(now())) memory.delete(id);
      if (kv) { try { await kv.put(key(attemptId), JSON.stringify(state), { expirationTtl: ttlSeconds }); } catch {} }
    },
    async load(attemptId) {
      const row = memory.get(attemptId);
      if (row && row.expires >= Number(now())) return row;
      if (!kv) return null;
      try { const raw = await kv.get(key(attemptId)); return raw ? JSON.parse(raw) : null; } catch { return null; }
    },
    async drop(attemptId) {
      memory.delete(attemptId);
      if (kv && typeof kv.delete === 'function') { try { await kv.delete(key(attemptId)); } catch {} }
    }
  };
}
const validOtpAttemptId = value => /^[A-Za-z0-9_-]{24,96}$/.test(String(value || ''));

// Slot `otp-j` is Ory Network's built-in one-time code (project "Admission Sky",
// free Developer plan). Ory creates, mails (its own SMTP, sender
// "Admission Sky via Ory") and checks the code, so the slot is provider-evidence.
// It drives the public native self-service API with no secret:
//   GET  /self-service/login/api                -> flow id
//   POST /self-service/login?flow=<id>           {"method":"code","identifier":email}
// and, when Ory answers 4000035 (no such account), the registration flow with
// traits.email instead. Verify posts the code to the same flow; the session that a
// correct code yields is revoked straight away via DELETE /self-service/logout/api.
// Probed live 2026-10-16 (login + registration, both mailboxes, logout -> 401).
const ORY_STATE_TTL_SECONDS = 900;
// Public, non-secret values live in code for the 64-variable reason (see Logto).
const ORY_PUBLIC_DEFAULTS = Object.freeze({
  endpoint: 'https://ecstatic-torvalds-2tcj5aljui.projects.oryapis.com'
});
const ORY_ACCOUNT_UNKNOWN = 4000035;
function oryEndpoint(value) {
  try {
    const url = new URL(String(value || ''));
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.port) return '';
    if (url.pathname.replace(/\/+$/, '') !== '') return '';
    if (!/^[a-z0-9][a-z0-9-]{2,80}\.projects\.oryapis\.com$/.test(url.hostname)) return '';
    return url.origin;
  } catch { return ''; }
}
const validOryFlowId = value => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value || ''));
const oryMessageIds = payload => (Array.isArray(payload?.ui?.messages) ? payload.ui.messages : []).map(row => Number(row?.id));
const orySentEmail = result => [200, 400].includes(Number(result.response.status)) && result.payload?.state === 'sent_email';

export class OryOtpVerificationProvider {
  constructor({ id = 'otp-j', endpoint, declaredDailyQuota, kv = null, fetchImpl = globalThis.fetch, now = Date.now } = {}) {
    this.id = String(id || '');
    this.channel = VERIFICATION_CHANNELS.OTP;
    this.verificationMode = VERIFICATION_MODES.PROVIDER_EVIDENCE;
    this.endpoint = oryEndpoint(endpoint);
    this.declaredDailyQuota = safeInteger(declaredDailyQuota, 1, 10_000_000);
    this.kv = kv && typeof kv.get === 'function' && typeof kv.put === 'function' ? kv : null;
    this.fetch = typeof fetchImpl === 'function' ? fetchImpl.bind(globalThis) : null;
    this.now = typeof now === 'function' ? now : Date.now;
    this.state = evidenceStateStore('ory-otp', ORY_STATE_TTL_SECONDS, this.kv, this.now);
    this.configured = Boolean(this.endpoint && this.declaredDailyQuota && this.fetch);
  }

  async #call(path, { method = 'GET', body } = {}) {
    let response;
    try {
      response = await this.fetch(`${this.endpoint}${path}`, {
        method,
        redirect: 'manual',
        headers: { Accept: 'application/json', 'Cache-Control': 'no-store', ...(body ? { 'Content-Type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(8_000)
      });
    } catch { throw new VerificationProviderError('NETWORK_ERROR', VERIFICATION_FAILURE_CLASS.TEMPORARY); }
    const payload = response.status === 204 ? {} : await boundedJson(response);
    return { response, payload };
  }

  async #flow(kind) {
    const result = await this.#call(`/self-service/${kind}/api`);
    if (!result.response.ok) throw httpFailure(result.response, result.payload, { userStatuses: [] });
    const flowId = String(result.payload?.id || '');
    if (!validOryFlowId(flowId)) throw new VerificationProviderError('INVALID_PROVIDER_RESPONSE', VERIFICATION_FAILURE_CLASS.HARD);
    return flowId;
  }

  #submit(kind, flowId, body) {
    return this.#call(`/self-service/${kind}?flow=${encodeURIComponent(flowId)}`, { method: 'POST', body });
  }

  // 400 without `sent_email` means the project refused (e.g. code method off): a
  // config fault, so the orchestrator moves on instead of blaming the student.
  #failure(result) {
    const status = Number(result.response.status);
    if (status === 400 || result.response.ok) return new VerificationProviderError('PROVIDER_REJECTED', VERIFICATION_FAILURE_CLASS.HARD);
    if (status === 410) return new VerificationProviderError('PROVIDER_HTTP_410', VERIFICATION_FAILURE_CLASS.TEMPORARY, { retryAfter: 5 });
    return httpFailure(result.response, result.payload, { userStatuses: [] });
  }

  async #discardSession(sessionToken) {
    try { await this.#call('/self-service/logout/api', { method: 'DELETE', body: { session_token: sessionToken } }); } catch {}
  }

  async checkAvailability() {
    if (!this.configured) return { available: false, code: 'NOT_CONFIGURED' };
    return { available: true, code: 'READY' };
  }

  async getRemainingQuota() {
    if (!this.configured) return { remaining: 0, limit: 0, resetAt: 0, source: 'not-configured' };
    return { remaining: this.declaredDailyQuota, limit: this.declaredDailyQuota, resetAt: nextUtcMidnight(this.now()), source: 'declared' };
  }

  async sendVerification(input = {}) {
    if (!this.configured) throw new VerificationProviderError('NOT_CONFIGURED', VERIFICATION_FAILURE_CLASS.HARD);
    const destination = String(input.destination || '').trim().toLowerCase();
    const attemptId = String(input.attemptId || '');
    if (!validEmailAddress(destination) || !validOtpAttemptId(attemptId)) {
      throw new VerificationProviderError('INVALID_DESTINATION', VERIFICATION_FAILURE_CLASS.USER);
    }
    const loginFlow = await this.#flow('login');
    const login = await this.#submit('login', loginFlow, { method: 'code', identifier: destination });
    if (orySentEmail(login)) {
      await this.state.save(attemptId, { kind: 'login', flowId: loginFlow, email: destination });
      return { accepted: true };
    }
    if (!(Number(login.response.status) === 400 && oryMessageIds(login.payload).includes(ORY_ACCOUNT_UNKNOWN))) throw this.#failure(login);
    const registrationFlow = await this.#flow('registration');
    const registration = await this.#submit('registration', registrationFlow, { method: 'code', traits: { email: destination } });
    if (!orySentEmail(registration)) throw this.#failure(registration);
    await this.state.save(attemptId, { kind: 'registration', flowId: registrationFlow, email: destination });
    return { accepted: true };
  }

  async verifyCode(input = {}) {
    if (!this.configured) throw new VerificationProviderError('NOT_CONFIGURED', VERIFICATION_FAILURE_CLASS.HARD);
    const attemptId = String(input.attemptId || '');
    const code = String(input.evidence || '').trim();
    if (!/^\d{6}$/.test(code)) return { verified: false };
    const state = await this.state.load(attemptId);
    if (!state?.flowId || !['login', 'registration'].includes(state.kind)) throw new VerificationProviderError('CHALLENGE_EXPIRED', VERIFICATION_FAILURE_CLASS.USER);
    const body = state.kind === 'registration'
      ? { method: 'code', code, traits: { email: state.email } }
      : { method: 'code', code, identifier: state.email };
    const result = await this.#submit(state.kind, state.flowId, body);
    const status = Number(result.response.status);
    const sessionToken = String(result.payload?.session_token || '');
    if (result.response.ok && sessionToken) {
      const identity = result.payload?.session?.identity || result.payload?.identity || {};
      const email = String(identity?.traits?.email || '').trim().toLowerCase();
      await this.state.drop(attemptId);
      await this.#discardSession(sessionToken);
      if (email !== state.email) throw new VerificationProviderError('INVALID_PROVIDER_RESPONSE', VERIFICATION_FAILURE_CLASS.HARD);
      return { verified: true };
    }
    if (status === 400) return { verified: false };
    if (status === 410 || status === 403) {
      await this.state.drop(attemptId);
      throw new VerificationProviderError('CHALLENGE_EXPIRED', VERIFICATION_FAILURE_CLASS.USER);
    }
    throw httpFailure(result.response, result.payload, { userStatuses: [] });
  }

  async getProviderStatus() {
    return { status: this.configured ? 'configured' : 'disabled', configured: this.configured, officialApi: true, mailer: 'ory' };
  }
}

// Slot `otp-k` is Hanko Cloud's email passcode (free plan, 10,000 MAU, Hanko's
// own mailer). Hanko creates, mails and checks the code, so the slot is
// provider-evidence. It drives the public Flow API (POST /registration, /login,
// /profile) with no secret; every step returns the next action href + csrf token,
// and no cookie is needed. Project settings this relies on (owner 2026-10-16):
// passwords OFF, account deletion ON.
// Hanko hides whether an address exists: a login for an unknown address and a
// registration for a known one both look accepted but mail a notice instead of a
// code. So every verified address is deleted from Hanko straight after the check
// (profile flow `account_delete`), which keeps every next send a fresh
// registration. Only if that deletion fails is a hashed "known" marker kept in KV
// so the next send uses the login flow instead.
const HANKO_STATE_TTL_SECONDS = 900;
const HANKO_KNOWN_TTL_SECONDS = 31_536_000;
const HANKO_PUBLIC_DEFAULTS = Object.freeze({
  endpoint: 'https://9b4c7063-c179-4586-8481-a415631a710a.hanko.io'
});
const HANKO_SKIPPABLE = new Set(['mfa_method_chooser', 'passkey_onboarding', 'credential_onboarding_chooser']);
function hankoEndpoint(value) {
  try {
    const url = new URL(String(value || ''));
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.port) return '';
    if (url.pathname.replace(/\/+$/, '') !== '') return '';
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.hanko\.io$/.test(url.hostname)) return '';
    return url.origin;
  } catch { return ''; }
}
const validHankoHref = value => typeof value === 'string' && /^\/[A-Za-z0-9_\-/?=&%@.~]{1,511}$/.test(value) && !value.startsWith('//');

export class HankoOtpVerificationProvider {
  constructor({ id = 'otp-k', endpoint, declaredDailyQuota, kv = null, fetchImpl = globalThis.fetch, now = Date.now } = {}) {
    this.id = String(id || '');
    this.channel = VERIFICATION_CHANNELS.OTP;
    this.verificationMode = VERIFICATION_MODES.PROVIDER_EVIDENCE;
    this.endpoint = hankoEndpoint(endpoint);
    this.declaredDailyQuota = safeInteger(declaredDailyQuota, 1, 10_000_000);
    this.kv = kv && typeof kv.get === 'function' && typeof kv.put === 'function' ? kv : null;
    this.fetch = typeof fetchImpl === 'function' ? fetchImpl.bind(globalThis) : null;
    this.now = typeof now === 'function' ? now : Date.now;
    this.state = evidenceStateStore('hanko-otp', HANKO_STATE_TTL_SECONDS, this.kv, this.now);
    this.knownMemory = new Set();
    this.configured = Boolean(this.endpoint && this.declaredDailyQuota && this.fetch);
  }

  async #call(path, { body = {}, token = '' } = {}) {
    let response;
    try {
      response = await this.fetch(`${this.endpoint}${path}`, {
        method: 'POST',
        redirect: 'manual',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(8_000)
      });
    } catch { throw new VerificationProviderError('NETWORK_ERROR', VERIFICATION_FAILURE_CLASS.TEMPORARY); }
    const payload = response.status === 204 ? {} : await boundedJson(response);
    return { response, payload };
  }

  #act(payload, name, inputData = {}, token = '') {
    const href = payload?.actions?.[name]?.href;
    if (!validHankoHref(href)) throw new VerificationProviderError('INVALID_PROVIDER_RESPONSE', VERIFICATION_FAILURE_CLASS.HARD);
    return this.#call(href, { body: { input_data: inputData, csrf_token: String(payload?.csrf_token || '') }, token });
  }

  #ok(result) {
    if (!result.response.ok) throw httpFailure(result.response, result.payload, { userStatuses: [] });
    return result.payload;
  }

  async #start(path, token = '') {
    let payload = this.#ok(await this.#call(path, { token }));
    if (payload?.name === 'preflight') payload = this.#ok(await this.#act(payload, 'register_client_capabilities', { webauthn_available: false }, token));
    return payload;
  }

  async #knownKey(email) { return `hanko-known:${await sha256Base64Url(email)}`; }
  async #isKnown(email) {
    if (this.knownMemory.has(email)) return true;
    if (!this.kv) return false;
    try { return Boolean(await this.kv.get(await this.#knownKey(email))); } catch { return false; }
  }
  async #setKnown(email, known) {
    if (known) this.knownMemory.add(email); else this.knownMemory.delete(email);
    if (!this.kv) return;
    try {
      const key = await this.#knownKey(email);
      if (known) await this.kv.put(key, '1', { expirationTtl: HANKO_KNOWN_TTL_SECONDS });
      else if (typeof this.kv.delete === 'function') await this.kv.delete(key);
    } catch {}
  }

  // The session only proves the code was right: delete the Hanko account it
  // belongs to; fall back to logout and remember the address as known.
  async #discardAccount(token, email) {
    try {
      const profile = await this.#start('/profile', token);
      if (profile?.actions?.account_delete) {
        const deleted = await this.#act(profile, 'account_delete', {}, token);
        if (deleted.response.ok && deleted.payload?.name === 'account_deleted') { await this.#setKnown(email, false); return; }
      }
    } catch {}
    await this.#setKnown(email, true);
    try { await this.#call('/logout', { token }); } catch {}
  }

  async checkAvailability() {
    if (!this.configured) return { available: false, code: 'NOT_CONFIGURED' };
    return { available: true, code: 'READY' };
  }

  async getRemainingQuota() {
    if (!this.configured) return { remaining: 0, limit: 0, resetAt: 0, source: 'not-configured' };
    return { remaining: this.declaredDailyQuota, limit: this.declaredDailyQuota, resetAt: nextUtcMidnight(this.now()), source: 'declared' };
  }

  async sendVerification(input = {}) {
    if (!this.configured) throw new VerificationProviderError('NOT_CONFIGURED', VERIFICATION_FAILURE_CLASS.HARD);
    const destination = String(input.destination || '').trim().toLowerCase();
    const attemptId = String(input.attemptId || '');
    if (!validEmailAddress(destination) || !validOtpAttemptId(attemptId)) {
      throw new VerificationProviderError('INVALID_DESTINATION', VERIFICATION_FAILURE_CLASS.USER);
    }
    let payload;
    if (await this.#isKnown(destination)) {
      payload = await this.#start('/login');
      payload = this.#ok(await this.#act(payload, 'continue_with_login_identifier', { email: destination }));
      if (payload?.name === 'login_method_chooser') payload = this.#ok(await this.#act(payload, 'continue_to_passcode_confirmation'));
    } else {
      payload = await this.#start('/registration');
      payload = this.#ok(await this.#act(payload, 'register_login_identifier', { email: destination }));
    }
    const href = payload?.actions?.verify_passcode?.href;
    if (payload?.name !== 'passcode_confirmation' || !validHankoHref(href)) throw new VerificationProviderError('PROVIDER_REJECTED', VERIFICATION_FAILURE_CLASS.HARD);
    await this.state.save(attemptId, { email: destination, href, csrf: String(payload.csrf_token || '') });
    return { accepted: true };
  }

  async verifyCode(input = {}) {
    if (!this.configured) throw new VerificationProviderError('NOT_CONFIGURED', VERIFICATION_FAILURE_CLASS.HARD);
    const attemptId = String(input.attemptId || '');
    const code = String(input.evidence || '').trim();
    if (!/^\d{6}$/.test(code)) return { verified: false };
    const state = await this.state.load(attemptId);
    if (!state?.href || !validHankoHref(state.href)) throw new VerificationProviderError('CHALLENGE_EXPIRED', VERIFICATION_FAILURE_CLASS.USER);
    let result = await this.#act({ csrf_token: state.csrf, actions: { verify_passcode: { href: state.href } } }, 'verify_passcode', { code });
    let payload = result.payload;
    if (!result.response.ok || payload?.name === 'passcode_confirmation') {
      const status = Number(result.response.status);
      if (status === 429 || status >= 500 || status === 0) throw httpFailure(result.response, payload, { userStatuses: [] });
      const next = payload?.actions?.verify_passcode?.href;
      if (payload?.name === 'passcode_confirmation' && validHankoHref(next)) {
        // Each Hanko step issues a fresh href + csrf token; the next try must use them.
        await this.state.save(attemptId, { email: state.email, href: next, csrf: String(payload.csrf_token || '') });
        return { verified: false };
      }
      await this.state.drop(attemptId);
      throw new VerificationProviderError('CHALLENGE_EXPIRED', VERIFICATION_FAILURE_CLASS.USER);
    }
    for (let step = 0; step < 3 && HANKO_SKIPPABLE.has(payload?.name) && payload?.actions?.skip; step += 1) {
      result = await this.#act(payload, 'skip');
      payload = this.#ok(result);
    }
    if (payload?.name !== 'success') {
      await this.state.drop(attemptId);
      throw new VerificationProviderError('INVALID_PROVIDER_RESPONSE', VERIFICATION_FAILURE_CLASS.HARD);
    }
    await this.state.drop(attemptId);
    const token = String(result.response?.headers?.get?.('X-Auth-Token') || '');
    if (token && token.length <= 4096 && !/[\r\n\s]/.test(token)) await this.#discardAccount(token, state.email);
    else await this.#setKnown(state.email, true);
    return { verified: true };
  }

  async getProviderStatus() {
    return { status: this.configured ? 'configured' : 'disabled', configured: this.configured, officialApi: true, mailer: 'hanko' };
  }
}

export class TelegramLinkVerificationProvider {
  constructor({ botUsername, botToken, webhookSecret, webhookSecretSource, webhookUrl, declaredDailyQuota, fetchImpl = globalThis.fetch, cryptoImpl = globalThis.crypto } = {}) {
    this.id = 'telegram';
    this.channel = VERIFICATION_CHANNELS.TELEGRAM;
    this.verificationMode = VERIFICATION_MODES.LOCAL_CODE;
    this.botUsername = validTelegramBotUsername(botUsername) ? String(botUsername) : '';
    this.botToken = validTelegramBotToken(botToken) ? String(botToken) : '';
    this.botId = this.botToken ? this.botToken.split(':', 1)[0] : '';
    this.webhookSecret = validTelegramWebhookSecret(webhookSecret) ? String(webhookSecret) : '';
    this.webhookSecretSource = validSecret(webhookSecretSource) ? String(webhookSecretSource) : '';
    this.webhookUrl = telegramWebhookEndpoint(webhookUrl);
    this.declaredDailyQuota = safeInteger(declaredDailyQuota, 1, 10_000_000);
    this.fetch = typeof fetchImpl === 'function' ? fetchImpl.bind(globalThis) : null;
    this.crypto = cryptoImpl;
    this.resolvedBotUsername = '';
    this.configured = Boolean(
      this.botToken && (this.webhookSecret || this.webhookSecretSource)
      && this.webhookUrl && this.declaredDailyQuota && this.fetch
    );
  }

  #base(method) { return `https://api.telegram.org/bot${this.botToken}/${method}`; }
  #headers(content = false) {
    return {
      Accept: 'application/json',
      'Cache-Control': 'no-store',
      ...(content ? { 'Content-Type': 'application/json' } : {})
    };
  }

  async #resolvedWebhookSecret() {
    if (this.webhookSecret) return this.webhookSecret;
    const derived = await deriveTelegramWebhookSecret(this.webhookSecretSource, this.crypto);
    if (!derived) throw new VerificationProviderError('NOT_CONFIGURED', VERIFICATION_FAILURE_CLASS.HARD);
    return derived;
  }

  async #identity() {
    const identity = await fetchJson(this.fetch, this.#base('getMe'), { method: 'GET', headers: this.#headers() });
    const username = String(identity?.result?.username || '');
    const providerId = String(identity?.result?.id || '');
    const ready = identity?.ok === true
      && identity?.result?.is_bot === true
      && providerId === this.botId
      && validTelegramBotUsername(username)
      && (!this.botUsername || username.toLowerCase() === this.botUsername.toLowerCase());
    if (ready) this.resolvedBotUsername = username;
    return { ready, username };
  }

  async #webhookInfo() {
    return fetchJson(this.fetch, this.#base('getWebhookInfo'), { method: 'GET', headers: this.#headers() });
  }

  async #deleteWebhook() {
    const payload = await fetchJson(this.fetch, this.#base('deleteWebhook'), {
      method: 'POST',
      headers: this.#headers(true),
      body: JSON.stringify({ drop_pending_updates: false })
    });
    if (payload?.ok !== true || payload?.result !== true) {
      throw new VerificationProviderError('INVALID_PROVIDER_RESPONSE', VERIFICATION_FAILURE_CLASS.HARD);
    }
  }

  async checkAvailability() {
    if (!this.configured) return { available: false, code: 'NOT_CONFIGURED' };
    const [identity, webhook] = await Promise.all([this.#identity(), this.#webhookInfo()]);
    const currentUrl = String(webhook?.result?.url || '');
    const webhookReady = webhook?.ok === true && currentUrl === this.webhookUrl;
    const updates = webhook?.result?.allowed_updates;
    const updateScopeReady = !Array.isArray(updates) || (updates.length === 1 && updates[0] === 'message');
    return {
      available: identity.ready && webhookReady && updateScopeReady,
      code: !identity.ready ? 'BOT_IDENTITY_MISMATCH' : !webhookReady ? 'WEBHOOK_NOT_READY' : !updateScopeReady ? 'WEBHOOK_SCOPE_MISMATCH' : 'READY'
    };
  }

  async configureWebhook() {
    if (!this.configured) throw new VerificationProviderError('NOT_CONFIGURED', VERIFICATION_FAILURE_CLASS.HARD);
    const identity = await this.#identity();
    if (!identity.ready) throw new VerificationProviderError('BOT_IDENTITY_MISMATCH', VERIFICATION_FAILURE_CLASS.HARD);
    const before = await this.#webhookInfo();
    const previousUrl = String(before?.result?.url || '');
    if (previousUrl && previousUrl !== this.webhookUrl) {
      throw new VerificationProviderError('WEBHOOK_CONFLICT', VERIFICATION_FAILURE_CLASS.HARD);
    }
    const changed = !previousUrl;
    try {
      const secret = await this.#resolvedWebhookSecret();
      const configured = await fetchJson(this.fetch, this.#base('setWebhook'), {
        method: 'POST',
        headers: this.#headers(true),
        body: JSON.stringify({
          url: this.webhookUrl,
          secret_token: secret,
          allowed_updates: ['message'],
          drop_pending_updates: false
        })
      });
      if (configured?.ok !== true || configured?.result !== true) {
        throw new VerificationProviderError('INVALID_PROVIDER_RESPONSE', VERIFICATION_FAILURE_CLASS.HARD);
      }
      const after = await this.#webhookInfo();
      const scope = after?.result?.allowed_updates;
      const webhookReady = after?.ok === true
        && String(after?.result?.url || '') === this.webhookUrl
        && (!Array.isArray(scope) || (scope.length === 1 && scope[0] === 'message'));
      if (!webhookReady) throw new VerificationProviderError('WEBHOOK_NOT_READY', VERIFICATION_FAILURE_CLASS.HARD);
      const probe = await fetchJson(this.fetch, this.webhookUrl, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Cache-Control': 'no-store',
          'Content-Type': 'application/json',
          'X-Telegram-Bot-Api-Secret-Token': secret
        },
        body: JSON.stringify({ update_id: 0 })
      });
      if (probe?.ok !== true) throw new VerificationProviderError('WEBHOOK_ENDPOINT_REJECTED', VERIFICATION_FAILURE_CLASS.HARD);
      return Object.freeze({ ready: true, identityReady: true, webhookReady: true, endpointAccepted: true, webhookChanged: changed });
    } catch (cause) {
      if (changed) await this.#deleteWebhook().catch(() => {});
      throw cause;
    }
  }

  async removeConfiguredWebhook() {
    if (!this.configured) throw new VerificationProviderError('NOT_CONFIGURED', VERIFICATION_FAILURE_CLASS.HARD);
    const current = await this.#webhookInfo();
    if (String(current?.result?.url || '') !== this.webhookUrl) return Object.freeze({ removed: false });
    await this.#deleteWebhook();
    return Object.freeze({ removed: true });
  }

  async getRemainingQuota({ now = Date.now() } = {}) {
    if (!this.configured) return { remaining: 0, limit: 0, resetAt: 0, source: 'not-configured' };
    return {
      remaining: this.declaredDailyQuota,
      limit: this.declaredDailyQuota,
      resetAt: (Math.floor(Number(now) / 86_400_000) + 1) * 86_400_000,
      source: 'internal-safety-cap'
    };
  }

  async sendVerification(input = {}) {
    if (!this.configured) throw new VerificationProviderError('NOT_CONFIGURED', VERIFICATION_FAILURE_CLASS.HARD);
    if (!/^[A-Za-z0-9_-]{32,64}$/.test(String(input.linkToken || ''))) {
      throw new VerificationProviderError('INVALID_LINK_TOKEN', VERIFICATION_FAILURE_CLASS.HARD);
    }
    if (!this.resolvedBotUsername) {
      const identity = await this.#identity();
      if (!identity.ready) throw new VerificationProviderError('BOT_IDENTITY_MISMATCH', VERIFICATION_FAILURE_CLASS.HARD);
    }
    const link = new URL(`https://t.me/${this.resolvedBotUsername}`);
    link.searchParams.set('start', input.linkToken);
    return { accepted: true, interaction: { type: 'telegram-link', url: link.href } };
  }

  async sendTelegramCode(input = {}) {
    if (!this.configured) throw new VerificationProviderError('NOT_CONFIGURED', VERIFICATION_FAILURE_CLASS.HARD);
    const chatId = String(input.chatId || '');
    const code = String(input.code || '');
    if (!/^[1-9]\d{0,19}$/.test(chatId) || !/^\d{6}$/.test(code)) {
      throw new VerificationProviderError('INVALID_DESTINATION', VERIFICATION_FAILURE_CLASS.USER);
    }
    const minutes = Math.max(1, Math.min(10, Math.ceil(safeInteger(input.expiresInSeconds, 60, 600) / 60)));
    const text = [
      `🔐 ${OTP_EMAIL_APP} Verification`,
      'আপনার verification code:',
      code,
      `এই code-টি ${OTP_EMAIL_APP} app-এর verification box-এ দিন।`,
      `⏱️ Code-এর মেয়াদ ${minutes} মিনিট।`,
      'কাউকে এই code বা আপনার password দেবেন না।'
    ].join('\n');
    const payload = await fetchJson(this.fetch, this.#base('sendMessage'), {
      method: 'POST',
      headers: this.#headers(true),
      body: JSON.stringify({
        chat_id: chatId,
        text,
        protect_content: true,
        disable_web_page_preview: true
      })
    });
    if (payload?.ok !== true || !Number.isSafeInteger(Number(payload?.result?.message_id))) {
      throw new VerificationProviderError('INVALID_PROVIDER_RESPONSE', VERIFICATION_FAILURE_CLASS.HARD);
    }
    return { accepted: true };
  }

  async verifyCode() {
    throw new VerificationProviderError('LOCAL_VERIFICATION_ONLY', VERIFICATION_FAILURE_CLASS.USER);
  }

  async getProviderStatus() {
    return { status: this.configured ? 'configured' : 'disabled', configured: this.configured, identityKind: 'telegram-account', phoneOwnership: false };
  }
}


// Descope is a verifier, not a generic mail transport. The existing Durable
// Object owns challenge expiry, attempt limits, identity binding and single-use
// consumption. Only a server-resolved destination reaches verifyCode; no raw
// address, OTP, Descope JWT or second browser session is persisted here.
export class DescopeOtpVerificationProvider {
  constructor({ id = 'otp-l', projectId, declaredDailyQuota, fetchImpl = globalThis.fetch, now = Date.now } = {}) {
    this.id = String(id || '');
    this.channel = VERIFICATION_CHANNELS.OTP;
    this.verificationMode = VERIFICATION_MODES.PROVIDER_EVIDENCE;
    this.projectId = /^P[A-Za-z0-9]{20,63}$/.test(String(projectId || '')) ? String(projectId) : '';
    this.declaredDailyQuota = safeInteger(declaredDailyQuota, 1, 1000);
    this.fetch = typeof fetchImpl === 'function' ? fetchImpl : null;
    this.now = typeof now === 'function' ? now : Date.now;
    this.configured = Boolean(this.projectId && this.declaredDailyQuota && this.fetch);
  }

  async checkAvailability() {
    // Configuration readiness only: this MUST NOT send a probe email or claim
    // that the project/connector has passed a live delivery test.
    return { available: this.configured, code: this.configured ? 'READY' : 'NOT_CONFIGURED' };
  }

  async getRemainingQuota() {
    if (!this.configured) return { remaining: 0, limit: 0, resetAt: 0, source: 'not-configured' };
    return { remaining: this.declaredDailyQuota, limit: this.declaredDailyQuota, resetAt: nextUtcMidnight(this.now()), source: 'declared' };
  }

  async #request(action, body, verify = false) {
    if (!this.configured) throw new VerificationProviderError('NOT_CONFIGURED', VERIFICATION_FAILURE_CLASS.HARD);
    let response;
    try {
      response = await this.fetch(`https://api.descope.com/v1/auth/otp/${action}/email`, {
        method: 'POST',
        redirect: 'manual',
        credentials: 'omit',
        headers: {
          Authorization: `Bearer ${this.projectId}`,
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store'
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(8000)
      });
    } catch {
      throw new VerificationProviderError('NETWORK_ERROR', VERIFICATION_FAILURE_CLASS.TEMPORARY, { retryAfter: 60 });
    }
    // Don't propagate provider messages, response bodies, JWTs or Set-Cookie.
    if (!response.ok) {
      if (response.body) { try { await response.body.cancel(); } catch {} }
      throw httpFailure(response, null, { userStatuses: verify ? [400, 404, 422] : [] });
    }
    let payload;
    try { payload = await boundedJson(response); }
    catch (error) {
      if (error instanceof VerificationProviderError) throw error;
      throw new VerificationProviderError('INVALID_PROVIDER_RESPONSE', VERIFICATION_FAILURE_CLASS.HARD);
    }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new VerificationProviderError('INVALID_PROVIDER_RESPONSE', VERIFICATION_FAILURE_CLASS.HARD);
    }
    return payload;
  }

  async sendVerification(input = {}) {
    if (!this.configured) throw new VerificationProviderError('NOT_CONFIGURED', VERIFICATION_FAILURE_CLASS.HARD);
    const destination = String(input.destination || '').trim().toLowerCase();
    if (!validEmailAddress(destination)) throw new VerificationProviderError('INVALID_DESTINATION', VERIFICATION_FAILURE_CLASS.USER);
    // Descope generates its own OTP. Never transmit the app's local OTP.
    await this.#request('signup-in', { loginId: destination });
    return { accepted: true };
  }

  async verifyCode(input = {}) {
    if (!this.configured) throw new VerificationProviderError('NOT_CONFIGURED', VERIFICATION_FAILURE_CLASS.HARD);
    const destination = String(input.destination || '').trim().toLowerCase();
    const code = String(input.evidence || '').trim();
    if (!validEmailAddress(destination) || !/^\d{6}$/.test(code)) return { verified: false };
    let payload;
    try { payload = await this.#request('verify', { loginId: destination, code }, true); }
    catch (error) {
      if (error?.failureClass === VERIFICATION_FAILURE_CLASS.USER) return { verified: false };
      throw error;
    }
    // Trust only the direct TLS response from the fixed Descope API, not a
    // browser-supplied token. Require verified ownership of the exact address.
    if (payload.user?.verifiedEmail !== true ||
        String(payload.user?.email || '').trim().toLowerCase() !== destination ||
        typeof payload.user?.userId !== 'string' || !payload.user.userId ||
        typeof payload.sessionJwt !== 'string' || !payload.sessionJwt) {
      throw new VerificationProviderError('INVALID_PROVIDER_RESPONSE', VERIFICATION_FAILURE_CLASS.HARD);
    }
    return { verified: true };
  }

  async getProviderStatus() {
    return { status: this.configured ? 'configured' : 'disabled', configured: this.configured, officialApi: true, mailer: 'descope', liveDeliveryVerified: false };
  }
}

// Descope Magic Link (otp-m). Same trust model as otp-l: the Durable Object owns
// the challenge; Descope only proves that the owner of the bound address clicked
// the link. The link token is single-use at Descope; sessionJwt/refreshJwt are
// checked for presence and dropped, never logged, returned or stored.
export const DESCOPE_MAGIC_LINK_URI = 'https://admissionsky.pages.dev/?magic=1';
export class DescopeMagicLinkVerificationProvider {
  constructor({ id = 'otp-m', projectId, declaredDailyQuota, redirectUri = DESCOPE_MAGIC_LINK_URI, fetchImpl = globalThis.fetch, now = Date.now } = {}) {
    this.id = String(id || '');
    this.channel = VERIFICATION_CHANNELS.OTP;
    this.verificationMode = VERIFICATION_MODES.PROVIDER_EVIDENCE;
    this.deliveryMethod = 'magic-link';
    this.projectId = /^P[A-Za-z0-9]{20,63}$/.test(String(projectId || '')) ? String(projectId) : '';
    this.declaredDailyQuota = safeInteger(declaredDailyQuota, 1, 1000);
    this.redirectUri = redirectUri === DESCOPE_MAGIC_LINK_URI ? redirectUri : '';
    this.fetch = typeof fetchImpl === 'function' ? fetchImpl : null;
    this.now = typeof now === 'function' ? now : Date.now;
    this.configured = Boolean(this.projectId && this.declaredDailyQuota && this.redirectUri && this.fetch);
  }

  async checkAvailability() {
    return { available: this.configured, code: this.configured ? 'READY' : 'NOT_CONFIGURED' };
  }

  async getRemainingQuota() {
    if (!this.configured) return { remaining: 0, limit: 0, resetAt: 0, source: 'not-configured' };
    return { remaining: this.declaredDailyQuota, limit: this.declaredDailyQuota, resetAt: nextUtcMidnight(this.now()), source: 'declared' };
  }

  async #request(path, body, verify = false) {
    if (!this.configured) throw new VerificationProviderError('NOT_CONFIGURED', VERIFICATION_FAILURE_CLASS.HARD);
    let response;
    try {
      response = await this.fetch(`https://api.descope.com/v1/auth/magiclink/${path}`, {
        method: 'POST',
        redirect: 'manual',
        credentials: 'omit',
        headers: {
          Authorization: `Bearer ${this.projectId}`,
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store'
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(8000)
      });
    } catch {
      throw new VerificationProviderError('NETWORK_ERROR', VERIFICATION_FAILURE_CLASS.TEMPORARY, { retryAfter: 60 });
    }
    if (!response.ok) {
      if (response.body) { try { await response.body.cancel(); } catch {} }
      throw httpFailure(response, null, { userStatuses: verify ? [400, 401, 404, 422] : [] });
    }
    let payload;
    try { payload = await boundedJson(response); }
    catch (error) {
      if (error instanceof VerificationProviderError) throw error;
      throw new VerificationProviderError('INVALID_PROVIDER_RESPONSE', VERIFICATION_FAILURE_CLASS.HARD);
    }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new VerificationProviderError('INVALID_PROVIDER_RESPONSE', VERIFICATION_FAILURE_CLASS.HARD);
    }
    return payload;
  }

  async sendVerification(input = {}) {
    if (!this.configured) throw new VerificationProviderError('NOT_CONFIGURED', VERIFICATION_FAILURE_CLASS.HARD);
    const destination = String(input.destination || '').trim().toLowerCase();
    if (!validEmailAddress(destination)) throw new VerificationProviderError('INVALID_DESTINATION', VERIFICATION_FAILURE_CLASS.USER);
    // Fixed redirect only; Descope appends &t=<token>. Local OTP/link token are never sent.
    await this.#request('signup-in/email', { loginId: destination, URI: this.redirectUri });
    return { accepted: true };
  }

  async verifyCode(input = {}) {
    if (!this.configured) throw new VerificationProviderError('NOT_CONFIGURED', VERIFICATION_FAILURE_CLASS.HARD);
    const destination = String(input.destination || '').trim().toLowerCase();
    const token = String(input.evidence || '').trim();
    if (!validEmailAddress(destination) || !/^[A-Za-z0-9._~-]{16,2048}$/.test(token)) return { verified: false };
    let payload;
    try { payload = await this.#request('verify', { token }, true); }
    catch (error) {
      if (error?.failureClass === VERIFICATION_FAILURE_CLASS.USER) return { verified: false };
      throw error;
    }
    if (payload.user?.verifiedEmail !== true ||
        String(payload.user?.email || '').trim().toLowerCase() !== destination ||
        typeof payload.user?.userId !== 'string' || !payload.user.userId ||
        typeof payload.sessionJwt !== 'string' || !payload.sessionJwt) {
      throw new VerificationProviderError('INVALID_PROVIDER_RESPONSE', VERIFICATION_FAILURE_CLASS.HARD);
    }
    return { verified: true };
  }

  async getProviderStatus() {
    return { status: this.configured ? 'configured' : 'disabled', configured: this.configured, officialApi: true, mailer: 'descope', deliveryMethod: 'magic-link', liveDeliveryVerified: false };
  }
}

export function createConfiguredVerificationProviders(env = {}, { fetchImpl = globalThis.fetch } = {}) {
  // Slot `otp-a` prefers the direct Brevo API and falls back to the external OTP
  // bridge when Brevo is not bound. Slot `otp-b` prefers the free Google Apps
  // Script mailer and otherwise falls back to a bridge. The orchestrator still
  // sees two ordinary OTP providers and rotates on declared quota.
  const brevoOtpA = new BrevoOtpVerificationProvider({
    id: 'otp-a',
    apiKey: env.BREVO_API_KEY,
    fromAddress: env.BREVO_FROM_ADDRESS,
    fromName: env.BREVO_FROM_NAME,
    declaredDailyQuota: env.OTP_A_DAILY_QUOTA,
    fetchImpl
  });
  const bridgeOtpA = new BridgeOtpVerificationProvider({ id: 'otp-a', origin: env.OTP_A_PROVIDER_ORIGIN, apiKey: env.OTP_A_PROVIDER_KEY, declaredDailyQuota: env.OTP_A_DAILY_QUOTA, fetchImpl });
  const appsScriptOtpB = new AppsScriptOtpVerificationProvider({
    id: 'otp-b',
    webAppUrl: env.OTP_B_PROVIDER_APPS_SCRIPT_URL,
    sharedSecret: env.OTP_B_PROVIDER_SHARED_SECRET,
    declaredDailyQuota: env.OTP_B_DAILY_QUOTA,
    fetchImpl
  });
  const bridgeOtpB = new BridgeOtpVerificationProvider({ id: 'otp-b', origin: env.OTP_B_PROVIDER_ORIGIN, apiKey: env.OTP_B_PROVIDER_KEY, declaredDailyQuota: env.OTP_B_DAILY_QUOTA, fetchImpl });
  const mailjetOtpC = new MailjetOtpVerificationProvider({
    id: 'otp-c',
    apiKey: env.MAILJET_API_KEY,
    secretKey: env.MAILJET_SECRET_KEY,
    apiBase: env.MAILJET_API_BASE,
    fromAddress: env.MAILJET_FROM_ADDRESS,
    fromName: env.MAILJET_FROM_NAME,
    declaredDailyQuota: env.OTP_C_DAILY_QUOTA,
    fetchImpl
  });
  const bridgeOtpC = new BridgeOtpVerificationProvider({ id: 'otp-c', origin: env.OTP_C_PROVIDER_ORIGIN, apiKey: env.OTP_C_PROVIDER_KEY, declaredDailyQuota: env.OTP_C_DAILY_QUOTA, fetchImpl });
  // Slot `otp-d` is Resend. It sits behind the three mailers the owner already
  // trusted, so a failing Resend account can never starve the earlier slots.
  const resendOtpD = new ResendOtpVerificationProvider({
    id: 'otp-d',
    apiKey: env.RESEND_API_KEY,
    fromAddress: env.RESEND_FROM_ADDRESS,
    fromName: env.RESEND_FROM_NAME,
    declaredDailyQuota: env.OTP_D_DAILY_QUOTA,
    fetchImpl
  });
  const bridgeOtpD = new BridgeOtpVerificationProvider({ id: 'otp-d', origin: env.OTP_D_PROVIDER_ORIGIN, apiKey: env.OTP_D_PROVIDER_KEY, declaredDailyQuota: env.OTP_D_DAILY_QUOTA, fetchImpl });
  // Slot `otp-e` is AgentMail. It needs no verified domain and no from-address -
  // the inbox it sends from is the sender, so it is the only slot that can carry
  // real recipients without the owner buying a domain.
  const agentMailOtpE = new AgentMailOtpVerificationProvider({
    id: 'otp-e',
    apiKey: env.AGENTMAIL_API_KEY,
    inboxId: env.AGENTMAIL_INBOX_ID,
    declaredDailyQuota: env.OTP_E_DAILY_QUOTA,
    fetchImpl
  });
  const bridgeOtpE = new BridgeOtpVerificationProvider({ id: 'otp-e', origin: env.OTP_E_PROVIDER_ORIGIN, apiKey: env.OTP_E_PROVIDER_KEY, declaredDailyQuota: env.OTP_E_DAILY_QUOTA, fetchImpl });
  // Slot `otp-f` is MailerSend. Its trial domain is verified by MailerSend itself,
  // so like AgentMail it carries real recipients without the owner buying a domain.
  const mailerSendOtpF = new MailerSendOtpVerificationProvider({
    id: 'otp-f',
    apiKey: env.MAILERSEND_API_KEY,
    fromAddress: env.MAILERSEND_FROM_ADDRESS,
    fromName: env.MAILERSEND_FROM_NAME,
    declaredDailyQuota: env.OTP_F_DAILY_QUOTA,
    fetchImpl
  });
  const bridgeOtpF = new BridgeOtpVerificationProvider({ id: 'otp-f', origin: env.OTP_F_PROVIDER_ORIGIN, apiKey: env.OTP_F_PROVIDER_KEY, declaredDailyQuota: env.OTP_F_DAILY_QUOTA, fetchImpl });
  // Slot `otp-g` is Dead Simple Email. Its inbox domain is provider-signed, so it
  // reaches real recipients with no owner domain, and it has no daily cap on the
  // free plan (5,000 emails/month).
  // Quota comes from VERIFICATION_ORCHESTRATOR_CONFIG (the authoritative row),
  // as otp-h/otp-i already do. The dedicated text var was a duplicate of the
  // config value and only consumed one of the 64 Workers-Free variable slots.
  const deadSimpleSlot = slotFromConfig(env.VERIFICATION_ORCHESTRATOR_CONFIG, 'otp-g');
  const deadSimpleQuota = env.OTP_G_DAILY_QUOTA || (deadSimpleSlot ? deadSimpleSlot.dailyQuota : '');
  const deadSimpleOtpG = new DeadSimpleEmailOtpVerificationProvider({
    id: 'otp-g',
    apiKey: env.DEADSIMPLEEMAIL_API_KEY,
    inboxId: env.DEADSIMPLEEMAIL_INBOX_ID,
    declaredDailyQuota: deadSimpleQuota,
    fetchImpl
  });
  const bridgeOtpG = new BridgeOtpVerificationProvider({ id: 'otp-g', origin: env.OTP_G_PROVIDER_ORIGIN, apiKey: env.OTP_G_PROVIDER_KEY, declaredDailyQuota: deadSimpleQuota, fetchImpl });
  const logtoSlot = logtoSlotFromConfig(env.VERIFICATION_ORCHESTRATOR_CONFIG);
  const logtoOtpH = new LogtoOtpVerificationProvider({
    id: 'otp-h',
    endpoint: env.LOGTO_ENDPOINT || (logtoSlot ? LOGTO_PUBLIC_DEFAULTS.endpoint : ''),
    appId: env.LOGTO_APP_ID || (logtoSlot ? LOGTO_PUBLIC_DEFAULTS.appId : ''),
    redirectUri: env.LOGTO_REDIRECT_URI || (logtoSlot ? LOGTO_PUBLIC_DEFAULTS.redirectUri : ''),
    declaredDailyQuota: env.OTP_H_DAILY_QUOTA || (logtoSlot ? logtoSlot.dailyQuota : ''),
    kv: env.GK_KV || null,
    fetchImpl
  });
  const appwriteSlot = slotFromConfig(env.VERIFICATION_ORCHESTRATOR_CONFIG, 'otp-i');
  const appwriteOtpI = new AppwriteOtpVerificationProvider({
    id: 'otp-i',
    endpoint: env.APPWRITE_ENDPOINT || (appwriteSlot ? APPWRITE_PUBLIC_DEFAULTS.endpoint : ''),
    projectId: env.APPWRITE_PROJECT_ID || (appwriteSlot ? APPWRITE_PUBLIC_DEFAULTS.projectId : ''),
    apiKey: env.APPWRITE_API_KEY,
    declaredDailyQuota: env.OTP_I_DAILY_QUOTA || (appwriteSlot ? appwriteSlot.dailyQuota : ''),
    kv: env.GK_KV || null,
    fetchImpl
  });
  const orySlot = slotFromConfig(env.VERIFICATION_ORCHESTRATOR_CONFIG, 'otp-j');
  const oryOtpJ = new OryOtpVerificationProvider({
    id: 'otp-j',
    endpoint: orySlot ? ORY_PUBLIC_DEFAULTS.endpoint : '',
    declaredDailyQuota: orySlot ? orySlot.dailyQuota : '',
    kv: env.GK_KV || null,
    fetchImpl
  });
  const hankoSlot = slotFromConfig(env.VERIFICATION_ORCHESTRATOR_CONFIG, 'otp-k');
  const hankoOtpK = new HankoOtpVerificationProvider({
    id: 'otp-k',
    endpoint: hankoSlot ? HANKO_PUBLIC_DEFAULTS.endpoint : '',
    declaredDailyQuota: hankoSlot ? hankoSlot.dailyQuota : '',
    kv: env.GK_KV || null,
    fetchImpl
  });
  const descopeSlot = slotFromConfig(env.VERIFICATION_ORCHESTRATOR_CONFIG, 'otp-l');
  const descopeOtpL = new DescopeOtpVerificationProvider({
    id: 'otp-l',
    projectId: descopeSlot ? descopeSlot.projectId : '',
    declaredDailyQuota: descopeSlot ? descopeSlot.dailyQuota : '',
    fetchImpl
  });
  const descopeMagicSlot = slotFromConfig(env.VERIFICATION_ORCHESTRATOR_CONFIG, 'otp-m');
  const descopeMagicM = new DescopeMagicLinkVerificationProvider({
    id: 'otp-m',
    projectId: descopeMagicSlot ? descopeMagicSlot.projectId : '',
    declaredDailyQuota: descopeMagicSlot ? descopeMagicSlot.dailyQuota : '',
    fetchImpl
  });
  // otp-n..otp-u: mailers whose keys all live in the single OTP_RAW secret
  // (64-variable ceiling). A slot only gets a quota while its orchestrator row
  // is enabled, so an unconfigured mailer stays inert. Appended after every
  // existing slot, and only while OTP_RAW is bound.
  const poolProviders = env.OTP_RAW ? createPoolProviders({
    raw: env.OTP_RAW,
    slotQuota: id => { const slot = slotFromConfig(env.VERIFICATION_ORCHESTRATOR_CONFIG, id); return slot ? slot.dailyQuota : ''; },
    fetchImpl,
    helpers: { boundedJson, httpFailure, otpEmailBody, appName: OTP_EMAIL_APP }
  }) : [];
  // otp-v..otp-y: hosted identity providers that mail and check their own code
  // (Stytch, WorkOS, MojoAuth, Authgear). Keys live in the single OTP_IDP secret
  // (idp-providers.mjs); Authgear needs none. A slot only gets a quota while its
  // orchestrator row is enabled, so a slot without keys or row stays inert.
  // Appended after every existing slot, and only while OTP_IDP is bound.
  const idpProviders = !env.OTP_IDP ? [] : createIdpProviders({
    raw: env.OTP_IDP,
    slotQuota: id => { const slot = slotFromConfig(env.VERIFICATION_ORCHESTRATOR_CONFIG, id); return slot ? slot.dailyQuota : ''; },
    kv: env.GK_KV || null,
    fetchImpl,
    helpers: { boundedJson, httpFailure }
  });
  return [
    brevoOtpA.configured ? brevoOtpA : bridgeOtpA,
    appsScriptOtpB.configured ? appsScriptOtpB : bridgeOtpB,
    mailjetOtpC.configured ? mailjetOtpC : bridgeOtpC,
    resendOtpD.configured ? resendOtpD : bridgeOtpD,
    agentMailOtpE.configured ? agentMailOtpE : bridgeOtpE,
    mailerSendOtpF.configured ? mailerSendOtpF : bridgeOtpF,
    deadSimpleOtpG.configured ? deadSimpleOtpG : bridgeOtpG,
    logtoOtpH,
    appwriteOtpI,
    oryOtpJ,
    hankoOtpK,
    descopeOtpL,
    descopeMagicM,
    new OfficialWhatsAppVerificationProvider({
      graphVersion: env.WHATSAPP_GRAPH_VERSION,
      phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID,
      accessToken: env.WHATSAPP_ACCESS_TOKEN,
      templateName: env.WHATSAPP_TEMPLATE_NAME,
      templateLanguage: env.WHATSAPP_TEMPLATE_LANGUAGE,
      declaredDailyQuota: env.WHATSAPP_DAILY_QUOTA,
      fetchImpl
    }),
    new TelegramLinkVerificationProvider({
      botUsername: env.TELEGRAM_AUTH_BOT_USERNAME,
      botToken: env.TELEGRAM_AUTH_BOT_TOKEN || env.TG_BOT_TOKEN,
      webhookSecret: env.TELEGRAM_AUTH_WEBHOOK_SECRET,
      webhookSecretSource: env.AUTH_HMAC_SECRET,
      webhookUrl: env.TELEGRAM_AUTH_WEBHOOK_URL,
      declaredDailyQuota: env.TELEGRAM_AUTH_DAILY_QUOTA,
      fetchImpl
    }),
    ...poolProviders,
    ...idpProviders
  ];
}

export const __verificationProvidersTest = Object.freeze({ httpsOrigin, boundedJson, httpFailure, appsScriptWebAppUrl, otpEmailBody });
