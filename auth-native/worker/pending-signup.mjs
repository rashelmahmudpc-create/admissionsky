// AUTH-ROADMAP step 1 (owner 2026-10-18): no Firebase account before the email
// OTP is proven. A signup is held here for 10 minutes (Durable Object KV storage),
// the code is sent through the same verification providers, and only a verified
// code releases the email/password to the caller, which then creates the account.
// Nothing in this file touches auth_users / auth_verification_challenges, whose
// user_id foreign keys require an existing account. No console logging here: delivery
// events go through the orchestrator's observability sink (onDeliveryEvent).
import { AUTH_ERROR_CODES, NativeAuthError } from '../core/errors.mjs';
import { AuthHmac, constantTimeEqual, maskAuthEmail, normalizeAuthEmail, randomSixDigitOtp, randomToken } from '../core/crypto.mjs';
import { AuthSecretVault } from '../core/secret-vault.mjs';
import { VERIFICATION_CHANNELS, VERIFICATION_FAILURE_CLASS, VERIFICATION_MODES, VerificationProviderError } from '../verification/provider-contract.mjs';

export const PENDING_SIGNUP_TTL_MS = 10 * 60 * 1000;
export const PENDING_SIGNUP_TICKET_PREFIX = 'p.';
const HOUR_MS = 60 * 60 * 1000;
const RECORD_PREFIX = 'psu:rec:';
const EMAIL_PREFIX = 'psu:email:';
const RATE_PREFIX = 'psu:rate:';
const MAGIC_LINK_PROVIDER_ID = 'otp-m';
const PROBE_TIMEOUT_MS = 5000;
const PASSWORD_MIN = 8;
const PASSWORD_MAX = 128;
// Code defaults on purpose: the Worker is at its 64-variable ceiling.
const BEGIN_LIMITS = Object.freeze([
  Object.freeze({ scope: 'email', limit: 5, windowMs: HOUR_MS }),
  Object.freeze({ scope: 'device', limit: 10, windowMs: HOUR_MS }),
  Object.freeze({ scope: 'ip', limit: 30, windowMs: HOUR_MS })
]);

const fail = (code, details) => { throw new NativeAuthError(code, details); };
const TICKET_PATTERN = /^p\.[A-Za-z0-9_-]{40,96}$/;

export const isPendingSignupTicket = value => typeof value === 'string' && TICKET_PATTERN.test(value);

async function bounded(action, milliseconds) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(action),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new VerificationProviderError('PROVIDER_TIMEOUT', VERIFICATION_FAILURE_CLASS.TEMPORARY)), milliseconds);
      })
    ]);
  } finally { clearTimeout(timer); }
}

const providerFailure = cause => cause instanceof VerificationProviderError
  ? { code: String(cause.code || 'PROVIDER_ERROR'), failureClass: cause.failureClass, retryAfter: Number(cause.retryAfter || 0) }
  : { code: 'PROVIDER_ERROR', failureClass: VERIFICATION_FAILURE_CLASS.TEMPORARY, retryAfter: 0 };

export class PendingSignupStore {
  constructor({ storage, hmacSecret, now = () => Date.now(), cryptoImpl = globalThis.crypto } = {}) {
    if (!storage || ['get', 'put', 'delete', 'list'].some(method => typeof storage[method] !== 'function')) {
      fail(AUTH_ERROR_CODES.STORAGE_UNAVAILABLE);
    }
    this.storage = storage;
    this.hmac = new AuthHmac(hmacSecret, cryptoImpl);
    this.vault = new AuthSecretVault(hmacSecret, cryptoImpl);
    this.now = now;
    this.crypto = cryptoImpl;
  }

  async #ticketRef(ticket) {
    if (!isPendingSignupTicket(ticket)) fail(AUTH_ERROR_CODES.TELEGRAM_VERIFICATION_INVALID);
    return this.hmac.hex('pending-signup-ticket-v1', ticket.slice(PENDING_SIGNUP_TICKET_PREFIX.length));
  }

  async #deviceRef(context = {}) {
    return this.hmac.hex('device-ref-v1', String(context.deviceId || ''));
  }

  async #consumeLimits(refs, now) {
    for (const limit of BEGIN_LIMITS) {
      const windowStart = Math.floor(now / limit.windowMs) * limit.windowMs;
      const key = `${RATE_PREFIX}${limit.scope}:${refs[limit.scope]}:${windowStart}`;
      const count = Number((await this.storage.get(key))?.count || 0) + 1;
      await this.storage.put(key, { count, expiresAt: windowStart + limit.windowMs });
      if (count > limit.limit) {
        fail(AUTH_ERROR_CODES.RATE_LIMITED, { retryAfter: Math.max(1, Math.ceil((windowStart + limit.windowMs - now) / 1000)) });
      }
    }
  }

  async begin({ email, password, profile = null, context = {} } = {}) {
    const normalized = normalizeAuthEmail(email);
    const secret = typeof password === 'string' ? password : '';
    if (secret.length < PASSWORD_MIN || secret.length > PASSWORD_MAX) fail(AUTH_ERROR_CODES.WEAK_PASSWORD);
    const now = Number(this.now());
    const [emailRef, deviceRef, ipRef] = await Promise.all([
      this.hmac.hex('email-ref-v1', normalized),
      this.#deviceRef(context),
      this.hmac.hex('network-ref-v1', String(context.ip || ''))
    ]);
    await this.#consumeLimits({ email: emailRef, device: deviceRef, ip: ipRef }, now);
    const token = randomToken(32, this.crypto);
    const ticket = `${PENDING_SIGNUP_TICKET_PREFIX}${token}`;
    const ticketRef = await this.#ticketRef(ticket);
    // One live signup per address: a fresh start replaces the old one.
    const previous = await this.storage.get(`${EMAIL_PREFIX}${emailRef}`);
    if (previous?.ticketRef) await this.storage.delete(`${RECORD_PREFIX}${previous.ticketRef}`);
    const cipher = await this.vault.seal(JSON.stringify({ email: normalized, password: secret }), `pending-signup:${ticketRef}`);
    const expiresAt = now + PENDING_SIGNUP_TTL_MS;
    const emailMask = maskAuthEmail(normalized);
    await this.storage.put(`${RECORD_PREFIX}${ticketRef}`, {
      v: 1, ticketRef, emailRef, emailMask, cipher, deviceRef,
      profile: profile && typeof profile === 'object' ? profile : null,
      challenge: null, verified: false, createdAt: now, expiresAt
    });
    await this.storage.put(`${EMAIL_PREFIX}${emailRef}`, { ticketRef, expiresAt });
    return Object.freeze({ verificationTicket: ticket, expiresAt, emailMask });
  }

  async #load(ticket, context) {
    const ticketRef = await this.#ticketRef(ticket);
    const record = await this.storage.get(`${RECORD_PREFIX}${ticketRef}`);
    const now = Number(this.now());
    if (!record) fail(AUTH_ERROR_CODES.TELEGRAM_VERIFICATION_INVALID);
    if (Number(record.expiresAt) <= now) {
      await this.#remove(record);
      fail(AUTH_ERROR_CODES.TELEGRAM_VERIFICATION_INVALID);
    }
    if (record.deviceRef !== await this.#deviceRef(context)) fail(AUTH_ERROR_CODES.TELEGRAM_VERIFICATION_INVALID);
    return record;
  }

  async #remove(record) {
    await this.storage.delete(`${RECORD_PREFIX}${record.ticketRef}`);
    const index = await this.storage.get(`${EMAIL_PREFIX}${record.emailRef}`);
    if (index?.ticketRef === record.ticketRef) await this.storage.delete(`${EMAIL_PREFIX}${record.emailRef}`);
  }

  async #save(record) {
    await this.storage.put(`${RECORD_PREFIX}${record.ticketRef}`, record);
  }

  async saveProfile(ticket, profile, context = {}) {
    const record = await this.#load(ticket, context);
    record.profile = profile && typeof profile === 'object' ? profile : null;
    await this.#save(record);
    return Object.freeze({ saved: true, profile: record.profile });
  }

  // Server-side only: the decrypted address and password never leave the worker.
  async material(ticket, context = {}) {
    const record = await this.#load(ticket, context);
    let opened;
    try { opened = JSON.parse(await this.vault.open(record.cipher, `pending-signup:${record.ticketRef}`)); } catch { fail(AUTH_ERROR_CODES.STORAGE_UNAVAILABLE); }
    return Object.freeze({
      email: opened.email,
      password: opened.password,
      emailRef: record.emailRef,
      emailMask: record.emailMask,
      profile: record.profile,
      challenge: record.challenge ? Object.freeze({ ...record.challenge }) : null,
      verified: record.verified === true,
      expiresAt: record.expiresAt
    });
  }

  async setChallenge(ticket, context, challenge) {
    const record = await this.#load(ticket, context);
    record.challenge = { ...challenge, attempts: 0 };
    record.verified = false;
    await this.#save(record);
  }

  async recordAttempt(ticket, context, { verified }) {
    const record = await this.#load(ticket, context);
    if (!record.challenge) fail(AUTH_ERROR_CODES.OTP_INVALID);
    if (verified) {
      record.verified = true;
      record.challenge = { ...record.challenge, codeMac: '' };
    } else {
      record.challenge = { ...record.challenge, attempts: Number(record.challenge.attempts || 0) + 1 };
    }
    await this.#save(record);
    return record.challenge.attempts;
  }

  async consume(ticket, context = {}) {
    const record = await this.#load(ticket, context);
    await this.#remove(record);
    return Object.freeze({ consumed: true });
  }

  async cleanup(now = Number(this.now())) {
    let removed = 0;
    const records = await this.storage.list({ prefix: RECORD_PREFIX });
    for (const record of records.values()) {
      if (Number(record?.expiresAt || 0) <= now) { await this.#remove(record); removed += 1; }
    }
    const rates = await this.storage.list({ prefix: RATE_PREFIX });
    const stale = [...rates].filter(([, value]) => Number(value?.expiresAt || 0) <= now).map(([key]) => key);
    if (stale.length) await this.storage.delete(stale);
    return Object.freeze({ removed });
  }

  async nextExpiry(now = Number(this.now())) {
    const records = await this.storage.list({ prefix: RECORD_PREFIX });
    let next = null;
    for (const record of records.values()) {
      const at = Number(record?.expiresAt || 0);
      if (at > now && (next === null || at < next)) next = at;
    }
    return next;
  }
}

// Email OTP slots in operator priority order (half-open probes first on ties).
// Mirrors the orchestrator's readiness checks; magic link is never a code slot.
// A4 / AU-OB-02: returns `{ rows, skipped }` just like the orchestrator's own
// candidate list, so a signup that lands on otp-y can also say which faster
// slots were passed over and why.
async function signupCandidates(orchestrator, now) {
  const config = orchestrator?.config;
  if (!config?.enabled) return { rows: [], skipped: [] };
  const skipped = [];
  const eligible = [];
  for (const entry of config.providers) {
    if (!entry.enabled) continue;
    // A signup code goes to email only, so a WhatsApp or Telegram slot is not a
    // candidate at all and naming it would only add noise to the log line.
    if (entry.channel !== VERIFICATION_CHANNELS.OTP) continue;
    if (entry.id === MAGIC_LINK_PROVIDER_ID) { skipped.push(`${entry.id}:magic-link-only`); continue; }
    eligible.push(entry);
  }
  const rows = await Promise.all(eligible.map(async entry => {
    const provider = orchestrator.providers.get(entry.id);
    if (!provider) { skipped.push(`${entry.id}:unavailable`); return null; }
    try {
      const [availability, remoteQuota, localQuota, state] = await Promise.all([
        bounded(() => provider.checkAvailability({ purpose: 'email-ownership' }), Math.min(entry.timeoutMs, PROBE_TIMEOUT_MS)),
        bounded(() => provider.getRemainingQuota({ now }), Math.min(entry.timeoutMs, PROBE_TIMEOUT_MS)),
        orchestrator.repository.dailyQuotaSnapshot({ providerId: entry.id, dailyQuota: entry.dailyQuota, now }),
        orchestrator.repository.providerSnapshot({ providerId: entry.id, now })
      ]);
      if (availability?.available !== true || state.circuit === 'open' || Number(remoteQuota?.remaining || 0) <= 0 || localQuota.remaining <= 0) {
        skipped.push(`${entry.id}:${availability?.available !== true ? 'unavailable'
          : state.circuit === 'open' ? 'circuit-open'
            : Number(remoteQuota?.remaining || 0) <= 0 ? 'provider-quota'
              : 'local-quota'}`);
        return null;
      }
      return { entry, provider, probe: state.circuit === 'half-open' };
    } catch { skipped.push(`${entry.id}:unavailable`); return null; }
  }));
  return {
    rows: rows.filter(Boolean).sort((a, b) => a.entry.priority - b.entry.priority || Number(b.probe) - Number(a.probe)),
    skipped: skipped.sort()
  };
}

const recordResult = (orchestrator, entry, fields) => orchestrator.repository.recordProviderResult({
  providerId: entry.id,
  attemptId: fields.attemptId,
  userId: '',
  subjectRef: '',
  channel: entry.channel,
  success: fields.success,
  failureClass: fields.failureClass,
  reason: String(fields.reason || '').slice(0, 64),
  latencyMs: fields.latencyMs,
  failureThreshold: orchestrator.config.policy.circuitFailureThreshold,
  forceCooldown: Number(fields.retryAfter || 0) > 0,
  cooldownMs: Math.max(orchestrator.config.policy.circuitCooldownSeconds * 1000, Math.max(0, Number(fields.retryAfter || 0)) * 1000),
  now: fields.now
});

export async function requestPendingSignupCode({ store, orchestrator, ticket, context = {}, recipientName = '' } = {}) {
  const material = await store.material(ticket, context);
  const now = Number(store.now());
  const policy = orchestrator.config.policy;
  if (material.challenge && Number(material.challenge.resendAt || 0) > now) {
    fail(AUTH_ERROR_CODES.RESEND_COOLDOWN, { retryAfter: Math.ceil((material.challenge.resendAt - now) / 1000) });
  }
  const attemptId = randomToken(24, store.crypto);
  const code = randomSixDigitOtp(store.crypto);
  const codeTtlMs = Math.min(policy.codeTtlSeconds * 1000, Math.max(1000, material.expiresAt - now));
  const { rows: candidates, skipped } = await signupCandidates(orchestrator, now);
  const emit = (evt, fields) => { try { orchestrator.onDeliveryEvent?.({ evt, ...fields }); } catch {} };
  const logBase = { attempt: attemptId.slice(0, 8), purpose: 'signup', method: 'code', candidates: candidates.length, ...(skipped.length ? { skipped: skipped.join(',') } : {}) };
  const started = Date.now();
  const tried = [];
  let rank = 0;
  for (const { entry, provider } of candidates) {
    rank += 1;
    for (let currentTry = 0; currentTry < 1 + policy.maxProviderRetries; currentTry += 1) {
      const quota = await orchestrator.repository.reserveDailyQuota({ providerId: entry.id, dailyQuota: entry.dailyQuota, now });
      if (quota.exhausted) {
        tried.push(`${entry.id}:quota`);
        emit('otp_delivery', { ...logBase, provider: entry.id, rank, try: currentTry + 1, outcome: 'quota_exhausted' });
        break;
      }
      const sendStarted = Date.now();
      try {
        const result = await bounded(() => provider.sendVerification({
          attemptId,
          purpose: 'email-ownership',
          destination: material.email,
          code,
          linkToken: randomToken(32, store.crypto),
          recipientName,
          expiresAt: now + codeTtlMs,
          signalContext: { origin: String(context.origin || '') }
        }), entry.timeoutMs);
        if (result?.accepted !== true) throw new VerificationProviderError('INVALID_PROVIDER_RESPONSE', VERIFICATION_FAILURE_CLASS.HARD);
        const latencyMs = Date.now() - sendStarted;
        tried.push(`${entry.id}:ok`);
        emit('otp_delivery', { ...logBase, provider: entry.id, label: entry.label, rank, try: currentTry + 1, outcome: 'accepted', latencyMs });
        emit('otp_request', { ...logBase, outcome: 'sent', provider: entry.id, totalMs: Date.now() - started, tried: tried.join(',') });
        try { await recordResult(orchestrator, entry, { attemptId, success: true, reason: 'accepted', latencyMs, now }); } catch {}
        const local = entry.verificationMode === VERIFICATION_MODES.LOCAL_CODE;
        await store.setChallenge(ticket, context, {
          attemptId,
          providerId: entry.id,
          verificationMode: entry.verificationMode,
          codeMac: local ? await store.hmac.hex('pending-signup-code-v1', `${attemptId}:${code}`) : '',
          expiresAt: now + codeTtlMs,
          resendAt: now + policy.resendCooldownSeconds * 1000
        });
        return Object.freeze({
          accepted: true,
          attemptId,
          expiresAt: now + codeTtlMs,
          resendAfter: policy.resendCooldownSeconds,
          attemptsAllowed: policy.maxAttempts,
          emailMasked: material.emailMask
        });
      } catch (cause) {
        if (cause instanceof NativeAuthError) throw cause;
        const failure = providerFailure(cause);
        tried.push(`${entry.id}:${failure.code}`);
        emit('otp_delivery', { ...logBase, provider: entry.id, label: entry.label, rank, try: currentTry + 1, outcome: 'failed', reason: failure.code, failureClass: failure.failureClass, latencyMs: Date.now() - sendStarted });
        let state = {};
        try { state = await recordResult(orchestrator, entry, { attemptId, success: false, failureClass: failure.failureClass, reason: failure.code, retryAfter: failure.retryAfter, latencyMs: Date.now() - sendStarted, now }); } catch {}
        if (failure.code === 'INVALID_DESTINATION') {
          emit('otp_request', { ...logBase, outcome: 'invalid_destination', totalMs: Date.now() - started, tried: tried.join(',') });
          fail(AUTH_ERROR_CODES.INVALID_INPUT);
        }
        if (failure.failureClass !== VERIFICATION_FAILURE_CLASS.TEMPORARY || state?.circuit === 'open' || failure.code === 'PROVIDER_TIMEOUT') break;
      }
    }
  }
  emit('otp_request', { ...logBase, outcome: 'all_failed', totalMs: Date.now() - started, tried: tried.join(',') });
  fail(AUTH_ERROR_CODES.BACKUP_UNAVAILABLE);
}

// A verified code returns the held credentials exactly once per verification;
// the caller creates the Firebase account and then calls store.consume().
export async function verifyPendingSignupCode({ store, orchestrator, ticket, context = {}, attemptId, code } = {}) {
  const material = await store.material(ticket, context);
  const challenge = material.challenge;
  const now = Number(store.now());
  const policy = orchestrator.config.policy;
  const value = String(code || '').trim();
  if (!/^\d{6}$/.test(value)) fail(AUTH_ERROR_CODES.INVALID_INPUT);
  if (!challenge || challenge.attemptId !== String(attemptId || '')) fail(AUTH_ERROR_CODES.OTP_INVALID);
  if (material.verified) return Object.freeze({ verified: true, email: material.email, password: material.password, profile: material.profile, emailMask: material.emailMask });
  if (Number(challenge.expiresAt) <= now) fail(AUTH_ERROR_CODES.OTP_EXPIRED);
  if (Number(challenge.attempts || 0) >= policy.maxAttempts) fail(AUTH_ERROR_CODES.OTP_LOCKED);
  let verified = false;
  if (challenge.verificationMode === VERIFICATION_MODES.LOCAL_CODE) {
    const candidate = await store.hmac.hex('pending-signup-code-v1', `${challenge.attemptId}:${value}`);
    verified = Boolean(challenge.codeMac) && constantTimeEqual(candidate, challenge.codeMac);
  } else {
    const entry = orchestrator.config.providers.find(row => row.id === challenge.providerId && row.enabled);
    const provider = entry ? orchestrator.providers.get(entry.id) : null;
    if (!entry || !provider) fail(AUTH_ERROR_CODES.BACKUP_UNAVAILABLE);
    try {
      const result = await bounded(() => provider.verifyCode({
        attemptId: challenge.attemptId,
        evidence: value,
        ...(entry.id === 'otp-l' ? { destination: material.email } : {}),
        purpose: 'email-ownership',
        serverConfirmed: false
      }), entry.timeoutMs);
      verified = result?.verified === true;
    } catch (cause) {
      const failure = providerFailure(cause);
      if (failure.failureClass !== VERIFICATION_FAILURE_CLASS.USER) fail(AUTH_ERROR_CODES.BACKUP_UNAVAILABLE, { retryAfter: 3 });
      verified = false;
    }
  }
  const attempts = await store.recordAttempt(ticket, context, { verified });
  if (!verified) fail(attempts >= policy.maxAttempts ? AUTH_ERROR_CODES.OTP_LOCKED : AUTH_ERROR_CODES.OTP_INVALID);
  return Object.freeze({ verified: true, email: material.email, password: material.password, profile: material.profile, emailMask: material.emailMask });
}
