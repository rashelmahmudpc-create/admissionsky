// OTP_RAW provider pool (owner 2026-10-22).
//
// The Worker sits on the Workers Free ceiling of 64 variables, so every key for
// the mailers below lives in ONE secret, OTP_RAW. The owner pastes it in any
// shape (JSON, "name: key" lines, free text); parseOtpRawPool() works out which
// value belongs to which provider. Nothing here ever logs, returns or echoes a
// key: getProviderStatus() only exposes the last four characters.
//
// Slots (all LOCAL_CODE, priority 38, after every branded mailer and before the
// locked last-resort pair otp-g / otp-c):
//   otp-n Maileroo · otp-o Elastic Email · otp-q Mailgun · otp-r Alibaba DirectMail
//   otp-s SparkPost (Bird) · otp-t Plunk · otp-u Loops
// EmailOctopus is recognised by the parser but has no transactional send API, so
// it never gets a slot.
import {
  VERIFICATION_CHANNELS,
  VERIFICATION_FAILURE_CLASS,
  VERIFICATION_MODES,
  VerificationProviderError
} from './provider-contract.mjs';

export const POOL_SLOTS = Object.freeze({
  maileroo: 'otp-n', elasticemail: 'otp-o', mailgun: 'otp-q', alibaba: 'otp-r',
  sparkpost: 'otp-s', plunk: 'otp-t', loops: 'otp-u'
});

const ALIASES = Object.freeze([
  ['maileroo', /maileroo/i],
  ['elasticemail', /elastic\s*-?\s*e?mail|elastic/i],
  ['emailoctopus', /e?mail\s*-?\s*octopus|octopus/i],
  ['mailgun', /mail\s*-?\s*g[ua]n|mailguh/i],
  ['alibaba', /alibaba|aliyun|direct\s*-?\s*mail/i],
  ['sparkpost', /spark\s*-?\s*post|\bbird\b/i],
  ['plunk', /plunk/i],
  ['loops', /\bloops?\b/i]
]);

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,63}/g;
const LABEL = /\b(api[\s_-]*key|key|token|secret|access[\s_-]*(?:key)?[\s_-]*secret|access[\s_-]*(?:key)?[\s_-]*id|id|domain|from|sender|region|template|transactional[\s_-]*id)\b\s*[:=]\s*/i;

function emptyEntry() { return { keys: [], short: [], emails: [], domains: [], labels: {}, region: '' }; }

function classifyLine(line) {
  // ignore addresses/domains/URLs: "plunk ... from otp@x.maileroo.org" is Plunk
  const bare = String(line).replace(/https?:\/\/\S+/g, ' ').replace(EMAIL, ' ').replace(/\b[a-z0-9-]+(\.[a-z0-9-]+)+\b/gi, ' ');
  for (const [name, pattern] of ALIASES) if (pattern.test(bare)) return name;
  return '';
}

// Remove the provider word itself ("mailgun:", "Elastic") so it is never read as
// a key, but only when the WHOLE word is the name, a key that merely contains
// the provider name stays intact.
function stripName(line, named) {
  const pattern = ALIASES.find(([n]) => n === named)[1];
  const whole = new RegExp(`^(?:${pattern.source})[:=,;-]*$`, 'i');
  return line.split(/(\s+)/).map(word => (whole.test(word) ? ' ' : word)).join('');
}

function absorb(entry, text) {
  const lower = text.toLowerCase();
  if (/\beu\b|europe/.test(lower)) entry.region = entry.region || 'eu';
  const aliRegion = lower.match(/\b(cn-[a-z]+|ap-southeast-\d|ap-[a-z]+-\d|eu-central-1|us-east-1)\b/);
  if (aliRegion) entry.region = aliRegion[1];
  for (const match of text.matchAll(EMAIL)) entry.emails.push(match[0]);
  // labelled pairs first, so "domain: mg.x.com" and "template: abc" are not mistaken for keys
  const parts = text.split(/[,;|]|\s{2,}|\t/);
  for (const part of parts) {
    const label = part.match(LABEL);
    if (!label) continue;
    const value = part.slice(label.index + label[0].length).trim().replace(/^["'`]|["'`]$/g, '').split(/\s+/)[0] || '';
    if (!value) continue;
    const name = label[1].toLowerCase().replace(/[\s_-]+/g, '');
    entry.labels[name] = value;
  }
  const stripped = text.replace(EMAIL, ' ').replace(/https?:\/\/\S+/g, ' ');
  for (const token of stripped.split(/[\s,;|"'`]+/)) {
    const clean = token.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9=+/_-]+$/g, '');
    if (/^(?=.*\.)[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(clean) && !/^\d+(\.\d+)+$/.test(clean)) { entry.domains.push(clean.toLowerCase()); continue; }
    if (!/^[A-Za-z0-9_+/=.-]+$/.test(clean) || !/\d/.test(clean) || !/[A-Za-z]/.test(clean)) continue;
    if (clean.length >= 16) entry.keys.push(clean);
    else if (clean.length >= 8) entry.short.push(clean);
  }
}

function fromJson(text) {
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const out = {};
    for (const [rawName, value] of Object.entries(parsed)) {
      const name = classifyLine(rawName);
      if (!name) continue;
      const entry = out[name] || emptyEntry();
      if (typeof value === 'string') absorb(entry, value.split('|').join(' , '));
      else if (value && typeof value === 'object') {
        for (const [field, inner] of Object.entries(value)) absorb(entry, `${field}: ${String(inner ?? '')}`);
      }
      out[name] = entry;
    }
    return out;
  } catch { return null; }
}

const pick = (labels, names) => { for (const name of names) if (labels[name]) return labels[name]; return ''; };
const firstKey = (entry, exclude = []) => entry.keys.find(key => !exclude.includes(key)) || '';

function finalize(name, entry) {
  const L = entry.labels;
  const labelledKey = pick(L, ['apikey', 'key', 'token', 'secret']);
  const labelledFrom = pick(L, ['from', 'sender']);
  const from = labelledFrom.includes('@') ? labelledFrom : (entry.emails[0] || '');
  const labelledDomain = pick(L, ['domain']);
  const domain = (labelledDomain || entry.domains.find(d => !from.endsWith(d)) || entry.domains[0] || (from.split('@')[1] || '')).toLowerCase();
  if (name === 'alibaba') {
    const id = pick(L, ['accesskeyid', 'accessid', 'id']) || entry.keys.find(key => /^LTAI/.test(key)) || entry.keys[0] || '';
    const secret = pick(L, ['accesskeysecret', 'accesssecret', 'secret']) || firstKey(entry, [id]);
    return { accessKeyId: id, accessKeySecret: secret, from, region: /^(cn-|ap-|eu-|us-)/.test(entry.region) ? entry.region : 'ap-southeast-1' };
  }
  if (name === 'loops') {
    const template = pick(L, ['template', 'transactionalid', 'id']);
    const key = labelledKey || firstKey(entry, [template]);
    return { apiKey: key, transactionalId: template || firstKey(entry, [key]) || entry.short[0] || '' };
  }
  const apiKey = labelledKey || firstKey(entry);
  if (name === 'mailgun') return { apiKey, domain, from: from || (domain ? `otp@${domain}` : ''), region: entry.region === 'eu' ? 'eu' : 'us' };
  if (name === 'sparkpost') return { apiKey, from, region: entry.region === 'eu' ? 'eu' : 'us' };
  return { apiKey, from };
}

// Accepts JSON or free text. Returns { maileroo: {...}, mailgun: {...}, ... }.
export function parseOtpRawPool(raw) {
  const text = String(raw || '').slice(0, 16_384);
  if (!text.trim()) return {};
  const entries = fromJson(text.trim()) || (() => {
    const out = {};
    let current = '';
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue;
      const named = classifyLine(line);
      if (named) current = named;
      if (!current) continue;
      out[current] = out[current] || emptyEntry();
      absorb(out[current], named ? stripName(line, named) : line);
    }
    return out;
  })();
  const result = {};
  for (const [name, entry] of Object.entries(entries)) result[name] = Object.freeze(finalize(name, entry));
  return Object.freeze(result);
}

const hint = value => (value && value.length >= 8 ? `****${value.slice(-4)}` : '');
const validEmail = value => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(value || '')) && String(value).length <= 254;
const nextUtcMidnight = now => (Math.floor(Number(now) / 86_400_000) + 1) * 86_400_000;

async function send(fetchImpl, url, init, helpers) {
  let response;
  try {
    response = await fetchImpl(url, { ...init, redirect: 'manual', signal: init.signal || AbortSignal.timeout(12_000) });
  } catch { throw new VerificationProviderError('NETWORK_ERROR', VERIFICATION_FAILURE_CLASS.TEMPORARY); }
  let payload = {};
  try { payload = await helpers.boundedJson(response); } catch { payload = {}; }
  // userStatuses: [], a 400/422 here means a bad key/sender on OUR side, never the
  // student's fault, so it must fail over to the next mailer.
  if (!response.ok) throw helpers.httpFailure(response, payload, { userStatuses: [] });
  return payload;
}

class PoolMailer {
  constructor({ id, mailer, config, required, declaredDailyQuota, fetchImpl, now, helpers }) {
    this.id = id;
    this.channel = VERIFICATION_CHANNELS.OTP;
    this.verificationMode = VERIFICATION_MODES.LOCAL_CODE;
    this.mailer = mailer;
    this.cfg = config || {};
    this.helpers = helpers || {};
    const quota = Number(declaredDailyQuota);
    this.declaredDailyQuota = Number.isInteger(quota) && quota > 0 ? quota : 0;
    this.fetch = typeof fetchImpl === 'function' ? fetchImpl.bind(globalThis) : null;
    this.now = typeof now === 'function' ? now : Date.now;
    this.missing = required.filter(field => {
      const value = String(this.cfg[field] || '');
      return field === 'from' ? !validEmail(value) : value.length < 4;
    });
    this.configured = Boolean(this.fetch && this.declaredDailyQuota && !this.missing.length);
  }
  async probe() { return { available: true, code: 'READY' }; }
  async checkAvailability() {
    if (!this.declaredDailyQuota) return { available: false, code: 'SLOT_DISABLED' };
    if (this.missing.length) return { available: false, code: `MISSING_${this.missing[0].toUpperCase()}` };
    try { return await this.probe(); }
    catch (error) { return { available: false, code: String(error?.code || 'PROBE_FAILED') }; }
  }
  async getRemainingQuota() {
    if (!this.configured) return { remaining: 0, limit: 0, resetAt: 0, source: 'not-configured' };
    return { remaining: this.declaredDailyQuota, limit: this.declaredDailyQuota, resetAt: nextUtcMidnight(this.now()), source: `${this.mailer}-declared-daily-quota` };
  }
  message(input) {
    if (!this.configured) throw new VerificationProviderError('NOT_CONFIGURED', VERIFICATION_FAILURE_CLASS.HARD);
    const destination = String(input.destination || '');
    const code = String(input.code || '');
    if (!validEmail(destination) || !/^\d{6}$/.test(code)) throw new VerificationProviderError('INVALID_DESTINATION', VERIFICATION_FAILURE_CLASS.USER);
    const expiresAt = Number(input.expiresAt || 0);
    const minutes = expiresAt > 0 ? Math.max(1, Math.round((expiresAt - Number(this.now())) / 60_000)) : 5;
    const { text, html } = this.helpers.otpEmailBody(code, minutes, input.recipientName);
    return { destination, code, minutes, text, html, subject: `${this.helpers.appName}, আপনার যাচাইকরণ কোড`, fromName: this.helpers.appName };
  }
  async verifyCode() { throw new VerificationProviderError('LOCAL_VERIFICATION_ONLY', VERIFICATION_FAILURE_CLASS.USER); }
  async getProviderStatus() {
    return { status: this.configured ? 'configured' : 'disabled', configured: this.configured, officialApi: true, mailer: this.mailer, keyHint: hint(this.cfg.apiKey || this.cfg.accessKeyId), missing: [...this.missing] };
  }
}

class MailerooMailer extends PoolMailer {
  async sendVerification(input = {}) {
    const m = this.message(input);
    await send(this.fetch, 'https://smtp.maileroo.com/api/v2/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.cfg.apiKey}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ from: { address: this.cfg.from, display_name: m.fromName }, to: [{ address: m.destination }], subject: m.subject, html: m.html, plain: m.text })
    }, this.helpers);
    return { accepted: true };
  }
}

class ElasticEmailMailer extends PoolMailer {
  async sendVerification(input = {}) {
    const m = this.message(input);
    await send(this.fetch, 'https://api.elasticemail.com/v4/emails/transactional', {
      method: 'POST',
      headers: { 'X-ElasticEmail-ApiKey': this.cfg.apiKey, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ Recipients: { To: [m.destination] }, Content: { From: `${m.fromName} <${this.cfg.from}>`, Subject: m.subject, Body: [{ ContentType: 'HTML', Content: m.html, Charset: 'utf-8' }, { ContentType: 'PlainText', Content: m.text, Charset: 'utf-8' }] } })
    }, this.helpers);
    return { accepted: true };
  }
}

class MailgunMailer extends PoolMailer {
  get base() { return this.cfg.region === 'eu' ? 'https://api.eu.mailgun.net' : 'https://api.mailgun.net'; }
  get auth() { return `Basic ${btoa(`api:${this.cfg.apiKey}`)}`; }
  async probe() {
    const payload = await send(this.fetch, `${this.base}/v3/domains/${encodeURIComponent(this.cfg.domain)}`, { method: 'GET', headers: { Authorization: this.auth, Accept: 'application/json' } }, this.helpers);
    const domain = payload?.domain || {};
    if (/sandbox/i.test(String(domain.name || this.cfg.domain))) return { available: false, code: 'SANDBOX_DOMAIN' };
    return domain.state === 'active' ? { available: true, code: 'READY' } : { available: false, code: 'DOMAIN_NOT_VERIFIED' };
  }
  async sendVerification(input = {}) {
    const m = this.message(input);
    const form = new FormData();
    form.set('from', `${m.fromName} <${this.cfg.from}>`); form.set('to', m.destination); form.set('subject', m.subject); form.set('text', m.text); form.set('html', m.html);
    await send(this.fetch, `${this.base}/v3/${encodeURIComponent(this.cfg.domain)}/messages`, { method: 'POST', headers: { Authorization: this.auth }, body: form }, this.helpers);
    return { accepted: true };
  }
}

const aliEncode = value => encodeURIComponent(value).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
class AlibabaMailer extends PoolMailer {
  async #call(action, extra) {
    const region = this.cfg.region || 'ap-southeast-1';
    const host = region === 'cn-hangzhou' ? 'dm.aliyuncs.com' : `dm.${region}.aliyuncs.com`;
    const params = {
      Action: action, Format: 'JSON', Version: '2015-11-23', AccessKeyId: this.cfg.accessKeyId,
      SignatureMethod: 'HMAC-SHA1', SignatureVersion: '1.0', SignatureNonce: crypto.randomUUID(),
      Timestamp: new Date(Number(this.now())).toISOString().replace(/\.\d{3}Z$/, 'Z'), RegionId: region, ...extra
    };
    const canonical = Object.keys(params).sort().map(key => `${aliEncode(key)}=${aliEncode(params[key])}`).join('&');
    const toSign = `POST&${aliEncode('/')}&${aliEncode(canonical)}`;
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(`${this.cfg.accessKeySecret}&`), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
    const signature = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(toSign)))));
    return send(this.fetch, `https://${host}/`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body: `${canonical}&Signature=${aliEncode(signature)}` }, this.helpers);
  }
  async sendVerification(input = {}) {
    const m = this.message(input);
    await this.#call('SingleSendMail', { AccountName: this.cfg.from, AddressType: '1', ReplyToAddress: 'false', ToAddress: m.destination, Subject: m.subject, HtmlBody: m.html, TextBody: m.text, FromAlias: m.fromName });
    return { accepted: true };
  }
}

class SparkPostMailer extends PoolMailer {
  get base() { return this.cfg.region === 'eu' ? 'https://api.eu.sparkpost.com' : 'https://api.sparkpost.com'; }
  async probe() {
    const domain = this.cfg.from.split('@')[1];
    const payload = await send(this.fetch, `${this.base}/api/v1/sending-domains/${encodeURIComponent(domain)}`, { method: 'GET', headers: { Authorization: this.cfg.apiKey, Accept: 'application/json' } }, this.helpers);
    const status = payload?.results?.status || {};
    return status.ownership_verified === true ? { available: true, code: 'READY' } : { available: false, code: 'DOMAIN_NOT_VERIFIED' };
  }
  async sendVerification(input = {}) {
    const m = this.message(input);
    await send(this.fetch, `${this.base}/api/v1/transmissions`, {
      method: 'POST',
      headers: { Authorization: this.cfg.apiKey, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ options: { transactional: true, open_tracking: false, click_tracking: false }, content: { from: { email: this.cfg.from, name: m.fromName }, subject: m.subject, html: m.html, text: m.text }, recipients: [{ address: { email: m.destination } }] })
    }, this.helpers);
    return { accepted: true };
  }
}

class PlunkMailer extends PoolMailer {
  async sendVerification(input = {}) {
    const m = this.message(input);
    await send(this.fetch, 'https://api.useplunk.com/v1/send', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.cfg.apiKey}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ to: m.destination, subject: m.subject, body: m.html, name: m.fromName, ...(validEmail(this.cfg.from) ? { from: this.cfg.from } : {}) })
    }, this.helpers);
    return { accepted: true };
  }
}

class LoopsMailer extends PoolMailer {
  async probe() {
    await send(this.fetch, 'https://app.loops.so/api/v1/api-key', { method: 'GET', headers: { Authorization: `Bearer ${this.cfg.apiKey}`, Accept: 'application/json' } }, this.helpers);
    return { available: true, code: 'READY' };
  }
  async sendVerification(input = {}) {
    const m = this.message(input);
    await send(this.fetch, 'https://app.loops.so/api/v1/transactional', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.cfg.apiKey}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ transactionalId: this.cfg.transactionalId, email: m.destination, dataVariables: { code: m.code, minutes: String(m.minutes) } })
    }, this.helpers);
    return { accepted: true };
  }
}

const DEFINITIONS = Object.freeze([
  ['maileroo', MailerooMailer, ['apiKey', 'from']],
  ['elasticemail', ElasticEmailMailer, ['apiKey', 'from']],
  ['mailgun', MailgunMailer, ['apiKey', 'domain', 'from']],
  ['alibaba', AlibabaMailer, ['accessKeyId', 'accessKeySecret', 'from']],
  ['sparkpost', SparkPostMailer, ['apiKey', 'from']],
  ['plunk', PlunkMailer, ['apiKey']],
  ['loops', LoopsMailer, ['apiKey', 'transactionalId']]
]);

// slotQuota(id) -> the dailyQuota of an ENABLED orchestrator row, or '' when off.
export function createPoolProviders({ raw, slotQuota, fetchImpl = globalThis.fetch, now = Date.now, helpers }) {
  const pool = parseOtpRawPool(raw);
  return DEFINITIONS.map(([mailer, Klass, required]) => new Klass({
    id: POOL_SLOTS[mailer], mailer, config: pool[mailer], required,
    declaredDailyQuota: slotQuota(POOL_SLOTS[mailer]), fetchImpl, now, helpers
  }));
}
