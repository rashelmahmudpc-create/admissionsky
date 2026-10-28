// Hosted identity-provider OTP slots (owner 2026-10-23).
//
// Each provider below creates, mails and checks its OWN 6-digit code, so every
// slot is PROVIDER_EVIDENCE: the app never sees or sends a code of its own.
// All four were live-probed on 2026-10-23 (send -> Gmail Inbox -> verify):
//   otp-v Stytch   (Consumer project "AdmissionSky", Test env, sender "Login")
//   otp-w WorkOS   (Magic Auth, Staging env, sender "Admissionsky")
//   otp-x MojoAuth (Email OTP, sender "MojoAuth")
//   otp-y Authgear (headless Authentication Flow API, sender no-reply@authgear.cloud)
//   otp-z  Stack Auth  (server key, 6-char A-Z0-9 code + magic link; iCloud Inbox)
//   otp-za SuperTokens (managed core + SuperTokens' free mail service, appName "Admissionsky")
//
// The Worker is one variable below the Workers-Free ceiling of 64, so every key
// lives in ONE secret, OTP_IDP (JSON):
//   {"stytch":{"projectId":"project-test-…","secret":"secret-test-…"},
//    "workos":{"apiKey":"sk_test_…","clientId":"client_…"},
//    "mojoauth":{"apiKey":"…"},
//    "stackauth":{"projectId":"<uuid>","secretServerKey":"ssk_…","callbackUrl":"https://…"},
//    "supertokens":{"connectionUri":"https://st-….supertokens.io","apiKey":"…"}}
// Authgear needs no secret (its public endpoint lives in code) but, like the
// OTP_RAW pool, the four slots only exist while OTP_IDP is bound. A slot whose keys
// are missing stays inert. Nothing here logs, returns or stores a key or a code;
// only the provider's own state handle and the bound address are kept, in KV,
// for 15 minutes between send and verify.
import {
  VERIFICATION_CHANNELS,
  VERIFICATION_FAILURE_CLASS,
  VERIFICATION_MODES,
  VerificationProviderError
} from './provider-contract.mjs';

export const IDP_SLOTS = Object.freeze({ stytch: 'otp-v', workos: 'otp-w', mojoauth: 'otp-x', authgear: 'otp-y', stackauth: 'otp-z', supertokens: 'otp-za' });
export const AUTHGEAR_PUBLIC_DEFAULTS = Object.freeze({ endpoint: 'https://admissionsky.authgear.cloud' });
const STATE_TTL_SECONDS = 900;

const safeInteger = (value, min = 0, max = Number.MAX_SAFE_INTEGER) => {
  const number = Number(value);
  return Number.isInteger(number) && number >= min && number <= max ? number : 0;
};
const cleanKey = (value, pattern) => (typeof value === 'string' && pattern.test(value) ? value : '');
const validEmail = value => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(value || '')) && String(value).length <= 254;
const validAttemptId = value => /^[A-Za-z0-9_-]{24,96}$/.test(String(value || ''));
const validCode = value => /^\d{6}$/.test(String(value || ''));
const nextUtcMidnight = now => (Math.floor(Number(now) / 86_400_000) + 1) * 86_400_000;
const basic = (user, pass) => `Basic ${btoa(`${user}:${pass}`)}`;

export function parseOtpIdp(raw) {
  try {
    const text = String(raw || '');
    if (!text || text.length > 8192) return {};
    const value = JSON.parse(text);
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch { return {}; }
}

function stateStore(prefix, kv, now) {
  const memory = new Map();
  const usableKv = kv && typeof kv.get === 'function' && typeof kv.put === 'function' ? kv : null;
  const key = attemptId => `${prefix}:${attemptId}`;
  return {
    async save(attemptId, state) {
      const expires = Number(now()) + STATE_TTL_SECONDS * 1000;
      memory.set(attemptId, { ...state, expires });
      for (const [id, row] of memory) if (row.expires < Number(now())) memory.delete(id);
      if (usableKv) { try { await usableKv.put(key(attemptId), JSON.stringify(state), { expirationTtl: STATE_TTL_SECONDS }); } catch {} }
    },
    async load(attemptId) {
      const row = memory.get(attemptId);
      if (row && row.expires >= Number(now())) return row;
      if (!usableKv) return null;
      try { const raw = await usableKv.get(key(attemptId)); return raw ? JSON.parse(raw) : null; } catch { return null; }
    },
    async drop(attemptId) {
      memory.delete(attemptId);
      if (usableKv && typeof usableKv.delete === 'function') { try { await usableKv.delete(key(attemptId)); } catch {} }
    }
  };
}

class HostedOtpProvider {
  constructor({ id, mailer, declaredDailyQuota, kv = null, fetchImpl = globalThis.fetch, now = Date.now, boundedJson, httpFailure, ready }) {
    this.id = String(id || '');
    this.channel = VERIFICATION_CHANNELS.OTP;
    this.verificationMode = VERIFICATION_MODES.PROVIDER_EVIDENCE;
    this.mailer = mailer;
    this.declaredDailyQuota = safeInteger(declaredDailyQuota, 1, 10_000_000);
    this.fetch = typeof fetchImpl === 'function' ? fetchImpl.bind(globalThis) : null;
    this.now = typeof now === 'function' ? now : Date.now;
    this.boundedJson = boundedJson;
    this.httpFailure = httpFailure;
    this.state = stateStore(`idp-otp-${this.id}`, kv, this.now);
    this.configured = Boolean(ready && this.declaredDailyQuota && this.fetch && boundedJson && httpFailure);
  }

  async call(url, { method = 'POST', headers = {}, body, timeoutMs = 12_000 } = {}) {
    let response;
    try {
      response = await this.fetch(url, {
        method,
        redirect: 'manual',
        credentials: 'omit',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(timeoutMs)
      });
    } catch { throw new VerificationProviderError('NETWORK_ERROR', VERIFICATION_FAILURE_CLASS.TEMPORARY, { retryAfter: 60 }); }
    let payload = {};
    try { payload = await this.boundedJson(response); }
    catch (error) {
      if (error instanceof VerificationProviderError) throw error;
      throw new VerificationProviderError('INVALID_PROVIDER_RESPONSE', VERIFICATION_FAILURE_CLASS.HARD);
    }
    return { response, payload: payload && typeof payload === 'object' ? payload : {} };
  }

  fail(result, userStatuses = []) { return this.httpFailure(result.response, null, { userStatuses }); }

  ensureConfigured() {
    if (!this.configured) throw new VerificationProviderError('NOT_CONFIGURED', VERIFICATION_FAILURE_CLASS.HARD);
  }

  sendInput(input) {
    this.ensureConfigured();
    const destination = String(input.destination || '').trim().toLowerCase();
    const attemptId = String(input.attemptId || '');
    if (!validEmail(destination) || !validAttemptId(attemptId)) {
      throw new VerificationProviderError('INVALID_DESTINATION', VERIFICATION_FAILURE_CLASS.USER);
    }
    return { destination, attemptId };
  }

  async verifyInput(input) {
    this.ensureConfigured();
    const attemptId = String(input.attemptId || '');
    const code = String(input.evidence || '').trim();
    if (!this.validCode(code)) return { code: '', attemptId, state: null };
    const state = await this.state.load(attemptId);
    if (!state?.email) throw new VerificationProviderError('CHALLENGE_EXPIRED', VERIFICATION_FAILURE_CLASS.USER);
    return { code, attemptId, state };
  }

  validCode(code) { return validCode(code); }

  async checkAvailability() { return { available: this.configured, code: this.configured ? 'READY' : 'NOT_CONFIGURED' }; }

  async getRemainingQuota() {
    if (!this.configured) return { remaining: 0, limit: 0, resetAt: 0, source: 'not-configured' };
    return { remaining: this.declaredDailyQuota, limit: this.declaredDailyQuota, resetAt: nextUtcMidnight(this.now()), source: 'declared' };
  }

  async getProviderStatus() {
    return { status: this.configured ? 'configured' : 'disabled', configured: this.configured, officialApi: true, mailer: this.mailer };
  }
}

// otp-v Stytch: POST /v1/otps/email/login_or_create -> email_id; POST /v1/otps/authenticate.
export class StytchOtpVerificationProvider extends HostedOtpProvider {
  constructor({ projectId, secret, ...rest } = {}) {
    const pid = cleanKey(projectId, /^project-(test|live)-[0-9a-f-]{36}$/);
    const key = cleanKey(secret, /^secret-(test|live)-[A-Za-z0-9_=-]{20,128}$/);
    super({ id: 'otp-v', mailer: 'stytch', ...rest, ready: Boolean(pid && key) });
    this.base = pid.startsWith('project-live-') ? 'https://api.stytch.com' : 'https://test.stytch.com';
    this.auth = pid && key ? basic(pid, key) : '';
  }

  async sendVerification(input = {}) {
    const { destination, attemptId } = this.sendInput(input);
    const sent = await this.call(`${this.base}/v1/otps/email/login_or_create`, { headers: { Authorization: this.auth }, body: { email: destination, expiration_minutes: 10 } });
    if (!sent.response.ok) throw this.fail(sent, [400]);
    const methodId = String(sent.payload.email_id || '');
    if (!/^email-(test|live)-[0-9a-f-]{36}$/.test(methodId)) throw new VerificationProviderError('INVALID_PROVIDER_RESPONSE', VERIFICATION_FAILURE_CLASS.HARD);
    await this.state.save(attemptId, { email: destination, methodId });
    return { accepted: true };
  }

  async verifyCode(input = {}) {
    const { code, attemptId, state } = await this.verifyInput(input);
    if (!code) return { verified: false };
    const result = await this.call(`${this.base}/v1/otps/authenticate`, { headers: { Authorization: this.auth }, body: { method_id: state.methodId, code } });
    if (result.response.ok && typeof result.payload.user_id === 'string' && result.payload.user_id) {
      await this.state.drop(attemptId);
      return { verified: true };
    }
    if ([400, 401, 404].includes(Number(result.response.status))) return { verified: false };
    throw this.fail(result);
  }
}

// otp-w WorkOS Magic Auth: POST /user_management/magic_auth; POST /user_management/authenticate.
export class WorkOsOtpVerificationProvider extends HostedOtpProvider {
  constructor({ apiKey, clientId, ...rest } = {}) {
    const key = cleanKey(apiKey, /^sk_(test|live)_[A-Za-z0-9]{20,200}$/);
    const client = cleanKey(clientId, /^client_[A-Za-z0-9]{10,64}$/);
    super({ id: 'otp-w', mailer: 'workos', ...rest, ready: Boolean(key && client) });
    this.apiKey = key;
    this.clientId = client;
  }

  async sendVerification(input = {}) {
    const { destination, attemptId } = this.sendInput(input);
    const sent = await this.call('https://api.workos.com/user_management/magic_auth', { headers: { Authorization: `Bearer ${this.apiKey}` }, body: { email: destination } });
    if (!sent.response.ok) throw this.fail(sent, [422]);
    // WorkOS also echoes the code in this response; it is deliberately ignored.
    await this.state.save(attemptId, { email: destination });
    return { accepted: true };
  }

  async verifyCode(input = {}) {
    const { code, attemptId, state } = await this.verifyInput(input);
    if (!code) return { verified: false };
    const result = await this.call('https://api.workos.com/user_management/authenticate', {
      body: { grant_type: 'urn:workos:oauth:grant-type:magic-auth:code', client_id: this.clientId, client_secret: this.apiKey, code, email: state.email }
    });
    const email = String(result.payload?.user?.email || '').trim().toLowerCase();
    if (result.response.ok && email === state.email) {
      await this.state.drop(attemptId);
      return { verified: true };
    }
    if (result.response.ok || [400, 401, 403, 404, 422].includes(Number(result.response.status))) return { verified: false };
    throw this.fail(result);
  }
}

// otp-x MojoAuth: POST /users/emailotp -> state_id; POST /users/emailotp/verify.
export class MojoAuthOtpVerificationProvider extends HostedOtpProvider {
  constructor({ apiKey, ...rest } = {}) {
    const key = cleanKey(apiKey, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    super({ id: 'otp-x', mailer: 'mojoauth', ...rest, ready: Boolean(key) });
    this.apiKey = key;
  }

  async sendVerification(input = {}) {
    const { destination, attemptId } = this.sendInput(input);
    const sent = await this.call('https://api.mojoauth.com/users/emailotp', { headers: { 'X-API-Key': this.apiKey }, body: { email: destination } });
    if (!sent.response.ok) throw this.fail(sent, [400]);
    const stateId = String(sent.payload.state_id || '');
    if (!/^[A-Za-z0-9_-]{8,128}$/.test(stateId)) throw new VerificationProviderError('INVALID_PROVIDER_RESPONSE', VERIFICATION_FAILURE_CLASS.HARD);
    await this.state.save(attemptId, { email: destination, stateId });
    return { accepted: true };
  }

  async verifyCode(input = {}) {
    const { code, attemptId, state } = await this.verifyInput(input);
    if (!code) return { verified: false };
    const result = await this.call('https://api.mojoauth.com/users/emailotp/verify', { headers: { 'X-API-Key': this.apiKey }, body: { state_id: state.stateId, otp: code } });
    const email = String(result.payload?.user?.email || result.payload?.user?.identifier || '').trim().toLowerCase();
    if (result.response.ok && result.payload.authenticated === true && email === state.email) {
      await this.state.drop(attemptId);
      return { verified: true };
    }
    if ([400, 401, 404].includes(Number(result.response.status)) || result.response.ok) return { verified: false };
    throw this.fail(result);
  }
}

// otp-y Authgear: public headless Authentication Flow API, no secret.
//   signup path: identify -> verify (code mailed) -> code -> create_authenticator -> finished
//   login path:  identify -> authenticate -> pick primary_oob_otp_email (code mailed) -> code -> finished
export class AuthgearOtpVerificationProvider extends HostedOtpProvider {
  constructor({ endpoint = AUTHGEAR_PUBLIC_DEFAULTS.endpoint, ...rest } = {}) {
    let origin = '';
    try {
      const url = new URL(String(endpoint || ''));
      if (url.protocol === 'https:' && /^[a-z0-9-]{2,63}\.authgear\.cloud$/.test(url.hostname) && !url.username && !url.password) origin = url.origin;
    } catch {}
    super({ id: 'otp-y', mailer: 'authgear', ...rest, ready: Boolean(origin) });
    this.origin = origin;
  }

  async step(stateToken, input) {
    const result = await this.call(`${this.origin}/api/v1/authentication_flows/states/input`, { body: { state_token: stateToken, input } });
    return result;
  }

  async sendVerification(input = {}) {
    const { destination, attemptId } = this.sendInput(input);
    const created = await this.call(`${this.origin}/api/v1/authentication_flows`, { body: { type: 'signup_login', name: 'default' } });
    if (!created.response.ok) throw this.fail(created);
    let token = String(created.payload?.result?.state_token || '');
    if (!token) throw new VerificationProviderError('INVALID_PROVIDER_RESPONSE', VERIFICATION_FAILURE_CLASS.HARD);
    let next = await this.step(token, { identification: 'email', login_id: destination });
    if (!next.response.ok) throw this.fail(next, [400]);
    let action = next.payload?.result?.action || {};
    if (action.type === 'authenticate' && action.data?.type === 'authentication_data') {
      const options = Array.isArray(action.data.options) ? action.data.options : [];
      const index = options.findIndex(row => row?.authentication === 'primary_oob_otp_email');
      if (index < 0) throw new VerificationProviderError('PROVIDER_NO_EMAIL_OTP', VERIFICATION_FAILURE_CLASS.HARD);
      next = await this.step(String(next.payload.result.state_token || ''), { authentication: 'primary_oob_otp_email', index });
      if (!next.response.ok) throw this.fail(next, [400]);
      action = next.payload?.result?.action || {};
    }
    token = String(next.payload?.result?.state_token || '');
    if (action.data?.type !== 'verify_oob_otp_data' || !token) throw new VerificationProviderError('INVALID_PROVIDER_RESPONSE', VERIFICATION_FAILURE_CLASS.HARD);
    await this.state.save(attemptId, { email: destination, token });
    return { accepted: true };
  }

  async verifyCode(input = {}) {
    const { code, attemptId, state } = await this.verifyInput(input);
    if (!code) return { verified: false };
    let result = await this.step(state.token, { code });
    if ([400, 401].includes(Number(result.response.status)) || result.payload?.error) return { verified: false };
    if (!result.response.ok) throw this.fail(result);
    let action = result.payload?.result?.action || {};
    // A brand-new address finishes sign-up by keeping email OTP as its only factor.
    if (action.type === 'create_authenticator') {
      result = await this.step(String(result.payload.result.state_token || ''), { authentication: 'primary_oob_otp_email' });
      if (!result.response.ok) throw this.fail(result);
      action = result.payload?.result?.action || {};
    }
    if (action.type === 'finished') {
      await this.state.drop(attemptId);
      return { verified: true };
    }
    return { verified: false };
  }
}

// otp-z Stack Auth: POST /api/v1/auth/otp/send-sign-in-code -> nonce;
//   POST /api/v1/auth/otp/sign-in with code = <6-char OTP> + nonce. The code is
//   six letters/digits (e.g. NQWKN5), not digits only.
export const STACK_AUTH_DEFAULT_CALLBACK = 'http://localhost:3000/handler/magic-link-callback';
export class StackAuthOtpVerificationProvider extends HostedOtpProvider {
  constructor({ projectId, secretServerKey, callbackUrl, ...rest } = {}) {
    const pid = cleanKey(projectId, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    const key = cleanKey(secretServerKey, /^ssk_[A-Za-z0-9]{20,128}$/);
    let cb = STACK_AUTH_DEFAULT_CALLBACK;
    try { const u = new URL(String(callbackUrl || '')); if (u.protocol === 'https:') cb = u.href; } catch {}
    super({ id: 'otp-z', mailer: 'stackauth', ...rest, ready: Boolean(pid && key) });
    this.headers = { 'x-stack-project-id': pid, 'x-stack-access-type': 'server', 'x-stack-secret-server-key': key };
    this.callbackUrl = cb;
  }

  validCode(code) { return /^[A-Za-z0-9]{6}$/.test(code); }

  async sendVerification(input = {}) {
    const { destination, attemptId } = this.sendInput(input);
    const sent = await this.call('https://api.stack-auth.com/api/v1/auth/otp/send-sign-in-code', { headers: this.headers, body: { email: destination, callback_url: this.callbackUrl } });
    if (!sent.response.ok) throw this.fail(sent, [400]);
    const nonce = String(sent.payload.nonce || '');
    if (!/^[A-Za-z0-9]{8,128}$/.test(nonce)) throw new VerificationProviderError('INVALID_PROVIDER_RESPONSE', VERIFICATION_FAILURE_CLASS.HARD);
    await this.state.save(attemptId, { email: destination, nonce });
    return { accepted: true };
  }

  async verifyCode(input = {}) {
    const { code, attemptId, state } = await this.verifyInput(input);
    if (!code) return { verified: false };
    const result = await this.call('https://api.stack-auth.com/api/v1/auth/otp/sign-in', { headers: this.headers, body: { code: code.toUpperCase() + state.nonce } });
    if (result.response.ok && result.payload.access_token) {
      await this.state.drop(attemptId);
      return { verified: true };
    }
    if ([400, 401, 404, 409].includes(Number(result.response.status)) || result.response.ok) return { verified: false };
    throw this.fail(result);
  }
}

// otp-za SuperTokens (managed core): POST <core>/recipe/signinup/code makes the code,
//   SuperTokens' own free mail service (api.supertokens.io, no key) mails it with
//   appName "Admissionsky"; POST <core>/recipe/signinup/code/consume checks it.
//   The code passes through memory once on send and is never stored or logged.
export const SUPERTOKENS_APP_NAME = 'Admissionsky';
export class SuperTokensOtpVerificationProvider extends HostedOtpProvider {
  constructor({ connectionUri, apiKey, ...rest } = {}) {
    let origin = '';
    try {
      const u = new URL(String(connectionUri || ''));
      if (u.protocol === 'https:' && /^st-[a-z0-9-]{8,80}\.aws\.supertokens\.io$/.test(u.hostname) && !u.username && !u.password) origin = u.origin;
    } catch {}
    const key = cleanKey(apiKey, /^[A-Za-z0-9_=-]{16,128}$/);
    super({ id: 'otp-za', mailer: 'supertokens', ...rest, ready: Boolean(origin && key) });
    this.origin = origin;
    this.headers = { 'api-key': key, rid: 'passwordless', 'cdi-version': '5.2' };
  }

  async sendVerification(input = {}) {
    const { destination, attemptId } = this.sendInput(input);
    const made = await this.call(`${this.origin}/recipe/signinup/code`, { headers: this.headers, body: { email: destination } });
    const p = made.payload;
    if (!made.response.ok) throw this.fail(made, [400]);
    if (p.status !== 'OK' || !validCode(String(p.userInputCode || '')) || !p.preAuthSessionId || !p.deviceId) {
      throw new VerificationProviderError('INVALID_PROVIDER_RESPONSE', VERIFICATION_FAILURE_CLASS.HARD);
    }
    const mailed = await this.call('https://api.supertokens.io/0/st/auth/passwordless/login', {
      headers: { 'api-version': '0' },
      body: { email: destination, appName: SUPERTOKENS_APP_NAME, codeLifetime: safeInteger(p.codeLifetime, 60_000, 3_600_000) || 900_000, urlWithLinkCode: '', userInputCode: String(p.userInputCode) }
    });
    if (!mailed.response.ok) throw this.fail(mailed);
    await this.state.save(attemptId, { email: destination, preAuthSessionId: String(p.preAuthSessionId), deviceId: String(p.deviceId) });
    return { accepted: true };
  }

  async verifyCode(input = {}) {
    const { code, attemptId, state } = await this.verifyInput(input);
    if (!code) return { verified: false };
    const result = await this.call(`${this.origin}/recipe/signinup/code/consume`, { headers: this.headers, body: { preAuthSessionId: state.preAuthSessionId, deviceId: state.deviceId, userInputCode: code } });
    if (!result.response.ok) {
      if ([400, 401, 404].includes(Number(result.response.status))) return { verified: false };
      throw this.fail(result);
    }
    const emails = (Array.isArray(result.payload?.user?.emails) ? result.payload.user.emails : []).map(e => String(e).toLowerCase());
    if (result.payload.status === 'OK' && emails.includes(state.email)) {
      await this.state.drop(attemptId);
      return { verified: true };
    }
    if (result.payload.status === 'RESTART_FLOW_ERROR' || result.payload.status === 'EXPIRED_USER_INPUT_CODE_ERROR') await this.state.drop(attemptId);
    return { verified: false };
  }
}

export function createIdpProviders({ raw, slotQuota, kv = null, fetchImpl = globalThis.fetch, helpers = {} } = {}) {
  const keys = parseOtpIdp(raw);
  const common = id => ({ declaredDailyQuota: slotQuota(id), kv, fetchImpl, boundedJson: helpers.boundedJson, httpFailure: helpers.httpFailure });
  return [
    new StytchOtpVerificationProvider({ ...common('otp-v'), projectId: keys.stytch?.projectId, secret: keys.stytch?.secret }),
    new WorkOsOtpVerificationProvider({ ...common('otp-w'), apiKey: keys.workos?.apiKey, clientId: keys.workos?.clientId }),
    new MojoAuthOtpVerificationProvider({ ...common('otp-x'), apiKey: keys.mojoauth?.apiKey }),
    new AuthgearOtpVerificationProvider({ ...common('otp-y') }),
    new StackAuthOtpVerificationProvider({ ...common('otp-z'), projectId: keys.stackauth?.projectId, secretServerKey: keys.stackauth?.secretServerKey, callbackUrl: keys.stackauth?.callbackUrl }),
    new SuperTokensOtpVerificationProvider({ ...common('otp-za'), connectionUri: keys.supertokens?.connectionUri, apiKey: keys.supertokens?.apiKey })
  ];
}
