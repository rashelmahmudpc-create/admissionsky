import { AUTH_ERROR_CODES } from '../core/errors.mjs';
import { constantTimeEqual } from '../core/crypto.mjs';
import { VERIFICATION_FAILURE_CLASS } from './provider-contract.mjs';

const DAY_MS = 86_400_000;
const copy = value => value == null ? value : JSON.parse(JSON.stringify(value));
const safeReason = value => String(value || 'UNKNOWN').toUpperCase().replace(/[^A-Z0-9_-]/g, '_').slice(0, 64) || 'UNKNOWN';

export class MemoryVerificationRepository {
  constructor() {
    this.challenges = new Map();
    this.quotas = new Map();
    this.providers = new Map();
    this.rates = new Map();
    this.events = [];
    this.telegramLinks = new Map();
    this.telegramLinksByExternal = new Map();
    this.emailOwnership = new Map();
    this.runtimeConfig = null;
  }

  async getRuntimeConfig() { return copy(this.runtimeConfig); }

  async setRuntimeConfig({ config, now }) {
    this.runtimeConfig = { ...copy(config), updatedAt: Number(now) };
    return { updated: true, updatedAt: Number(now) };
  }

  #consumeLimits(limits, now) {
    let denied = null;
    for (const limit of limits || []) {
      const start = Math.floor(now / limit.windowMs) * limit.windowMs;
      const key = `${limit.scope}:${limit.key}:${start}`;
      const row = this.rates.get(key) || { count: 0, expiresAt: start + limit.windowMs };
      row.count += 1;
      this.rates.set(key, row);
      if (row.count > limit.limit) {
        const retryAfter = Math.max(1, Math.ceil((row.expiresAt - now) / 1000));
        if (!denied || retryAfter > denied.retryAfter) denied = { error: AUTH_ERROR_CODES.RATE_LIMITED, retryAfter };
      }
    }
    return denied;
  }

  #event(input) {
    this.events.push({
      attemptId: input.attemptId || null,
      userId: input.userId || null,
      subjectRef: input.subjectRef || null,
      providerId: input.providerId || null,
      channel: input.channel || null,
      occurredAt: Number(input.now),
      outcome: safeReason(input.outcome),
      reason: safeReason(input.reason),
      latencyMs: Math.max(0, Math.round(Number(input.latencyMs || 0)))
    });
  }

  async reserveChallenge(input) {
    const activeLockout = [...this.challenges.values()]
      .filter(row => row.userId === input.userId && row.purpose === input.purpose && row.state === 'locked' && row.lockoutUntil > input.now)
      .reduce((latest, row) => Math.max(latest, Number(row.lockoutUntil || 0)), 0);
    if (activeLockout) {
      return { error: AUTH_ERROR_CODES.OTP_LOCKED, retryAfter: Math.max(1, Math.ceil((activeLockout - input.now) / 1000)) };
    }
    const denied = this.#consumeLimits(input.limits, input.now);
    if (denied) return denied;
    const latest = [...this.challenges.values()]
      .filter(row => row.userId === input.userId && row.purpose === input.purpose && ['pending', 'sent'].includes(row.state))
      .sort((left, right) => right.createdAt - left.createdAt)[0];
    if (latest && input.now < latest.resendAt) {
      return { error: AUTH_ERROR_CODES.RESEND_COOLDOWN, retryAfter: Math.max(1, Math.ceil((latest.resendAt - input.now) / 1000)) };
    }
    this.challenges.set(input.attemptId, copy({
      ...input,
      providerId: null,
      channel: null,
      verificationMode: null,
      state: 'pending',
      attempts: 0,
      verifiedAt: null,
      lockoutUntil: 0,
      providerConfirmed: false,
      externalIdentityRef: null
    }));
    this.#event({ ...input, outcome: 'prepared', reason: 'accepted' });
    return { reserved: true };
  }

  async markChallengeDelivery(input) {
    const row = this.challenges.get(input.attemptId);
    if (!row || row.state !== 'pending') return { error: AUTH_ERROR_CODES.OTP_INVALID };
    row.providerId = input.providerId;
    row.channel = input.channel;
    row.verificationMode = input.verificationMode;
    row.state = 'sent';
    row.sentAt = input.now;
    if (!input.retainCodeCipher) row.codeCipher = '';
    if (!input.retainLinkCipher) row.linkCipher = '';
    for (const candidate of this.challenges.values()) {
      if (candidate.attemptId !== row.attemptId && candidate.userId === row.userId
        && candidate.purpose === row.purpose && ['pending', 'sent'].includes(candidate.state)) {
        candidate.state = 'superseded';
        candidate.codeMac = '';
        candidate.codeCipher = '';
        candidate.linkTokenMac = '';
        candidate.linkCipher = '';
      }
    }
    this.#event({ ...row, now: input.now, outcome: 'sent', reason: 'accepted', latencyMs: input.latencyMs });
    return { delivered: true };
  }

  async confirmProviderEvidence(input) {
    const row = [...this.challenges.values()].find(candidate =>
      candidate.providerId === input.providerId &&
      candidate.channel === input.channel &&
      candidate.state === 'sent' &&
      candidate.expiresAt > input.now &&
      constantTimeEqual(candidate.linkTokenMac, input.linkTokenMac)
    );
    if (!row) return { error: AUTH_ERROR_CODES.OTP_INVALID };
    row.providerConfirmed = true;
    row.externalIdentityRef = input.externalIdentityRef;
    row.linkTokenMac = '';
    this.#event({ ...row, now: input.now, outcome: 'provider_confirmed', reason: 'webhook_verified' });
    return { confirmed: true, attemptId: row.attemptId };
  }

  async claimTelegramDelivery(input) {
    const row = [...this.challenges.values()].find(candidate =>
      candidate.providerId === 'telegram' && candidate.channel === 'telegram'
      && candidate.verificationMode === 'local-code' && candidate.state === 'sent'
      && candidate.expiresAt > input.now
      && constantTimeEqual(candidate.linkTokenMac, input.linkTokenMac)
    );
    if (!row || !row.codeCipher) return { error: AUTH_ERROR_CODES.OTP_INVALID };
    if (row.providerConfirmed && row.externalIdentityRef !== input.externalIdentityRef) {
      return { error: AUTH_ERROR_CODES.ACCOUNT_CONFLICT };
    }
    const externalOwner = this.telegramLinksByExternal.get(input.externalIdentityRef);
    const userLink = this.telegramLinks.get(row.userId);
    const claimedElsewhere = [...this.challenges.values()].find(candidate =>
      candidate.attemptId !== row.attemptId && candidate.providerId === 'telegram'
      && candidate.state === 'sent' && candidate.providerConfirmed
      && candidate.externalIdentityRef === input.externalIdentityRef
    );
    if ((externalOwner && (externalOwner.userId !== row.userId || externalOwner.subjectRef !== row.subjectRef))
      || (userLink && (userLink.externalIdentityRef !== input.externalIdentityRef || userLink.subjectRef !== row.subjectRef))
      || (claimedElsewhere && claimedElsewhere.userId !== row.userId)) {
      return { error: AUTH_ERROR_CODES.ACCOUNT_CONFLICT };
    }
    row.providerConfirmed = true;
    row.externalIdentityRef = input.externalIdentityRef;
    this.#event({ ...row, now: input.now, outcome: 'provider_confirmed', reason: 'private_same_user_start' });
    return {
      claimed: true,
      attemptId: row.attemptId,
      codeCipher: row.codeCipher,
      expiresAt: row.expiresAt,
      userId: row.userId,
      subjectRef: row.subjectRef
    };
  }

  async confirmTelegramDelivery(input) {
    const row = this.challenges.get(input.attemptId);
    if (!row || row.providerId !== 'telegram' || !row.providerConfirmed || row.state !== 'sent') {
      return { error: AUTH_ERROR_CODES.OTP_INVALID };
    }
    row.codeCipher = '';
    row.linkTokenMac = '';
    row.linkCipher = '';
    this.#event({ ...row, now: input.now, outcome: 'sent', reason: 'telegram_code_accepted' });
    return { delivered: true };
  }

  async getPendingChallenge(input) {
    const row = [...this.challenges.values()]
      .filter(candidate => candidate.userId === input.userId && candidate.sessionRef === input.sessionRef
        && candidate.subjectRef === input.subjectRef && candidate.emailRef === input.emailRef
        && candidate.deviceRef === input.deviceRef && candidate.purpose === input.purpose
        && candidate.state === 'sent')
      .sort((left, right) => right.createdAt - left.createdAt)[0];
    if (!row) return { pending: false };
    if (row.expiresAt <= input.now) {
      row.state = 'expired'; row.codeMac = ''; row.codeCipher = ''; row.linkTokenMac = ''; row.linkCipher = '';
      return { pending: false };
    }
    return { pending: true, challenge: copy(row) };
  }

  async isTelegramLinked(input) {
    const row = this.telegramLinks.get(input.userId);
    return { linked: Boolean(row && row.status === 'active' && row.subjectRef === input.subjectRef) };
  }

  async isEmailOwnershipProven(input) {
    const row = this.emailOwnership.get(input.userId);
    return {
      proven: Boolean(row && row.status === 'active' && row.subjectRef === input.subjectRef),
      method: row && row.status === 'active' && row.subjectRef === input.subjectRef ? row.method : null
    };
  }

  async revokeEmailOwnership(input) {
    const row = this.emailOwnership.get(input.userId);
    if (row && row.status === 'active') {
      row.status = 'revoked';
      row.revokedAt = input.now;
    }
    return { revoked: true };
  }

  async failChallenge(input) {
    const row = this.challenges.get(input.attemptId);
    if (row && ['pending', 'sent'].includes(row.state)) {
      row.state = 'failed';
      row.codeMac = '';
      row.codeCipher = '';
      row.linkTokenMac = '';
      row.linkCipher = '';
    }
    this.#event({ ...(row || {}), ...input, outcome: 'failed' });
    return { failed: true };
  }

  async getChallenge(input) {
    const row = this.challenges.get(input.attemptId);
    if (!row || row.sessionRef !== input.sessionRef || row.subjectRef !== input.subjectRef || row.userId !== input.userId
      || row.deviceRef !== input.deviceRef || row.emailRef !== input.emailRef || row.purpose !== input.purpose) {
      return { error: AUTH_ERROR_CODES.OTP_INVALID };
    }
    if (row.state === 'verified') return { error: AUTH_ERROR_CODES.OTP_USED };
    if (row.state === 'locked') return { error: AUTH_ERROR_CODES.OTP_LOCKED, retryAfter: Math.max(1, Math.ceil((row.lockoutUntil - input.now) / 1000)) };
    if (row.state !== 'sent') return { error: AUTH_ERROR_CODES.OTP_INVALID };
    if (row.expiresAt <= input.now) {
      row.state = 'expired';
      row.codeMac = '';
      row.codeCipher = '';
      row.linkTokenMac = '';
      row.linkCipher = '';
      return { error: AUTH_ERROR_CODES.OTP_EXPIRED };
    }
    return { challenge: copy(row) };
  }

  async rejectChallengeAttempt(input) {
    const selected = await this.getChallenge(input);
    if (selected.error) return selected;
    const row = this.challenges.get(input.attemptId);
    row.attempts += 1;
    if (row.attempts >= row.maxAttempts) {
      row.state = 'locked';
      row.codeMac = '';
      row.codeCipher = '';
      row.linkTokenMac = '';
      row.linkCipher = '';
      row.lockoutUntil = input.now + input.lockoutMs;
      this.#event({ ...row, now: input.now, outcome: 'locked', reason: 'attempt_limit' });
      return { error: AUTH_ERROR_CODES.OTP_LOCKED, retryAfter: Math.ceil(input.lockoutMs / 1000) };
    }
    this.#event({ ...row, now: input.now, outcome: 'rejected', reason: input.reason || 'user_code_mismatch' });
    return { error: AUTH_ERROR_CODES.OTP_INVALID, attemptsRemaining: row.maxAttempts - row.attempts };
  }

  async verifyLocalChallenge(input) {
    const selected = await this.getChallenge(input);
    if (selected.error) return selected;
    const row = this.challenges.get(input.attemptId);
    if (row.providerId === 'telegram' && (!row.providerConfirmed || !row.externalIdentityRef)) {
      return { error: AUTH_ERROR_CODES.TELEGRAM_VERIFICATION_PENDING };
    }
    if (!constantTimeEqual(row.codeMac, input.candidateCodeMac)) {
      return this.rejectChallengeAttempt({ ...input, reason: 'user_code_mismatch' });
    }
    if (row.providerId === 'telegram') {
      const externalOwner = this.telegramLinksByExternal.get(row.externalIdentityRef);
      const userLink = this.telegramLinks.get(row.userId);
      if ((externalOwner && (externalOwner.userId !== row.userId || externalOwner.subjectRef !== row.subjectRef))
        || (userLink && (userLink.externalIdentityRef !== row.externalIdentityRef || userLink.subjectRef !== row.subjectRef))) {
        return { error: AUTH_ERROR_CODES.ACCOUNT_CONFLICT };
      }
      const link = userLink || {
        userId: row.userId,
        subjectRef: row.subjectRef,
        externalIdentityRef: row.externalIdentityRef,
        status: 'active',
        linkedAt: input.now,
        lastVerifiedAt: input.now,
        revokedAt: null
      };
      link.status = 'active';
      link.lastVerifiedAt = input.now;
      link.revokedAt = null;
      this.telegramLinks.set(row.userId, link);
      this.telegramLinksByExternal.set(row.externalIdentityRef, link);
    }
    row.state = 'verified';
    row.codeMac = '';
    row.codeCipher = '';
    row.linkTokenMac = '';
    row.linkCipher = '';
    row.verifiedAt = input.now;
    if (row.purpose === 'email-ownership') {
      const existing = this.emailOwnership.get(row.userId);
      if (existing && (existing.subjectRef !== row.subjectRef || existing.emailRef !== row.emailRef)) {
        return { error: AUTH_ERROR_CODES.ACCOUNT_CONFLICT };
      }
      this.emailOwnership.set(row.userId, {
        userId: row.userId,
        subjectRef: row.subjectRef,
        emailRef: row.emailRef,
        providerId: row.providerId || 'otp',
        method: 'email-otp',
        status: 'active',
        provenAt: existing?.provenAt || input.now,
        lastVerifiedAt: input.now,
        revokedAt: null
      });
    }
    this.#event({ ...row, now: input.now, outcome: 'verified', reason: 'accepted' });
    return {
      verified: true,
      userId: row.userId,
      purpose: row.purpose,
      telegramLinked: row.providerId === 'telegram',
      emailOwnershipProven: row.purpose === 'email-ownership',
      emailVerified: false
    };
  }

  async completeRemoteChallenge(input) {
    const selected = await this.getChallenge(input);
    if (selected.error) return selected;
    const row = this.challenges.get(input.attemptId);
    // Owner 2026-10-17: provider-evidence codes prove ownership too (see sqlite).
    const ownership = row.purpose === 'email-ownership';
    const existingOwnership = ownership ? this.emailOwnership.get(row.userId) : null;
    if (existingOwnership && (existingOwnership.subjectRef !== row.subjectRef || existingOwnership.emailRef !== row.emailRef)) {
      return { error: AUTH_ERROR_CODES.ACCOUNT_CONFLICT };
    }
    if (ownership) {
      this.emailOwnership.set(row.userId, {
        userId: row.userId,
        subjectRef: row.subjectRef,
        emailRef: row.emailRef,
        providerId: row.providerId || 'otp',
        method: 'email-otp',
        status: 'active',
        provenAt: existingOwnership?.provenAt || input.now,
        lastVerifiedAt: input.now,
        revokedAt: null
      });
    }
    row.state = 'verified';
    row.codeMac = '';
    row.codeCipher = '';
    row.linkTokenMac = '';
    row.linkCipher = '';
    row.verifiedAt = input.now;
    this.#event({ ...row, now: input.now, outcome: 'verified', reason: 'provider_evidence' });
    return {
      verified: true,
      userId: row.userId,
      purpose: row.purpose,
      ...(ownership ? { emailOwnershipProven: true, emailVerified: false } : {})
    };
  }

  async dailyQuotaSnapshot({ providerId, dailyQuota, now }) {
    const dayStart = Math.floor(now / DAY_MS) * DAY_MS;
    const resetAt = dayStart + DAY_MS;
    const row = this.quotas.get(`${providerId}:${dayStart}`);
    const used = Math.max(0, Number(row?.used || 0));
    return { used, remaining: Math.max(0, dailyQuota - used), limit: dailyQuota, resetAt };
  }

  async reserveDailyQuota({ providerId, dailyQuota, now }) {
    const dayStart = Math.floor(now / DAY_MS) * DAY_MS;
    const resetAt = dayStart + DAY_MS;
    const key = `${providerId}:${dayStart}`;
    const row = this.quotas.get(key) || { providerId, dayStart, used: 0, limit: dailyQuota, resetAt };
    row.limit = dailyQuota;
    if (dailyQuota <= 0 || row.used >= dailyQuota) {
      this.quotas.set(key, row);
      return { exhausted: true, used: row.used, remaining: 0, limit: dailyQuota, resetAt };
    }
    row.used += 1;
    this.quotas.set(key, row);
    return { exhausted: false, used: row.used, remaining: Math.max(0, dailyQuota - row.used), limit: dailyQuota, resetAt };
  }

  async providerSnapshot({ providerId, now }) {
    const row = this.providers.get(providerId) || {
      providerId,
      circuit: 'closed',
      consecutiveFailures: 0,
      successCount: 0,
      failureCount: 0,
      userErrorCount: 0,
      latencyEwmaMs: 0,
      cooldownUntil: 0,
      lastSuccessAt: 0,
      lastFailureAt: 0,
      lastReason: 'NONE'
    };
    if (row.circuit === 'open' && row.cooldownUntil <= now) row.circuit = 'half-open';
    this.providers.set(providerId, row);
    return copy(row);
  }

  async recordProviderResult(input) {
    const row = await this.providerSnapshot({ providerId: input.providerId, now: input.now });
    const latency = Math.max(0, Number(input.latencyMs || 0));
    row.latencyEwmaMs = row.latencyEwmaMs ? Math.round((row.latencyEwmaMs * 0.8) + (latency * 0.2)) : Math.round(latency);
    row.lastReason = safeReason(input.reason);
    if (input.success) {
      row.successCount += 1;
      row.consecutiveFailures = 0;
      row.circuit = 'closed';
      row.cooldownUntil = 0;
      row.lastSuccessAt = input.now;
    } else if (input.failureClass === VERIFICATION_FAILURE_CLASS.USER) {
      row.userErrorCount += 1;
      // AUTH V2.0 (owner 2026-10-31): a probe that answers USER-class never
      // closes, so the circuit stays half-open forever. The slot is then sorted
      // first on every request as "the probe", and each request pays its full
      // timeout before the healthy providers get a turn — a permanent tax paid
      // for a provider that is merely answering oddly. Reopen it for another
      // cooldown instead: the slot keeps its chance to recover on a later
      // probe, but it stops being tried ahead of everyone else meanwhile.
      if (row.circuit === 'half-open') {
        row.circuit = 'open';
        row.cooldownUntil = input.now + input.cooldownMs;
      }
    } else {
      row.failureCount += 1;
      row.consecutiveFailures += 1;
      row.lastFailureAt = input.now;
      const shouldOpen = input.failureClass === VERIFICATION_FAILURE_CLASS.HARD || input.forceCooldown === true || row.consecutiveFailures >= input.failureThreshold;
      if (shouldOpen) {
        row.circuit = 'open';
        row.cooldownUntil = input.now + input.cooldownMs;
      }
    }
    this.providers.set(input.providerId, row);
    this.#event({ ...input, outcome: input.success ? 'provider_success' : 'provider_failure' });
    return copy(row);
  }

  async status({ providerIds, now }) {
    const providerStates = [];
    for (const providerId of providerIds) providerStates.push(await this.providerSnapshot({ providerId, now }));
    return {
      providerStates,
      quotas: [...this.quotas.values()].filter(row => row.resetAt > now).map(copy),
      recentEvents: this.events.slice(-100).map(copy)
    };
  }

  async cleanup(now) {
    for (const [key, row] of this.challenges) if (row.expiresAt <= now || ['verified', 'failed', 'superseded'].includes(row.state)) this.challenges.delete(key);
    for (const [key, row] of this.quotas) if (row.resetAt <= now) this.quotas.delete(key);
    for (const [key, row] of this.rates) if (row.expiresAt <= now) this.rates.delete(key);
    this.events = this.events.filter(row => row.occurredAt > now - (90 * DAY_MS));
    return { cleaned: true };
  }

  async nextExpiry(now) {
    const values = [
      ...[...this.challenges.values()].map(row => row.expiresAt),
      ...[...this.quotas.values()].map(row => row.resetAt),
      ...[...this.rates.values()].map(row => row.expiresAt),
      ...[...this.providers.values()].map(row => row.cooldownUntil)
    ].filter(value => Number(value) > now);
    return values.length ? Math.min(...values) : null;
  }

  snapshot() {
    return copy({
      challenges: [...this.challenges.values()],
      quotas: [...this.quotas.values()],
      providers: [...this.providers.values()],
      rates: [...this.rates.entries()],
      events: this.events,
      telegramLinks: [...this.telegramLinks.values()],
      runtimeConfig: this.runtimeConfig
    });
  }
}
