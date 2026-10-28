import { AuthHmac, normalizeAuthEmail, randomSixDigitOtp, randomToken } from '../core/crypto.mjs';
import { AUTH_ERROR_CODES, errorFromRepository, failAuth, NativeAuthError } from '../core/errors.mjs';
import { AuthSecretVault } from '../core/secret-vault.mjs';
import { verificationConfig } from './config.mjs';
import { isDisposableEmail } from '../../email-policy.js';
import {
  assertVerificationProvider,
  DisabledVerificationProvider,
  VERIFICATION_FAILURE_CLASS,
  VERIFICATION_MODES,
  VerificationProviderError
} from './provider-contract.mjs';

const PURPOSES = new Set(['account-backup', 'sensitive-action', 'email-ownership']);
const HOUR_MS = 60 * 60 * 1000;
const SEND_LIMITS = Object.freeze([
  Object.freeze({ scope: 'backup-user-hour', source: 'user', limit: 5, windowMs: HOUR_MS }),
  Object.freeze({ scope: 'backup-ip-hour', source: 'ip', limit: 20, windowMs: HOUR_MS }),
  Object.freeze({ scope: 'backup-device-hour', source: 'device', limit: 10, windowMs: HOUR_MS }),
  Object.freeze({ scope: 'backup-global-minute', source: 'global', limit: 120, windowMs: 60_000 })
]);

// Owner 2026-10-16: "এক E-mail এ দিনে ৩–৫ বার সর্বোচ্চ, যতটা কম রাখা যায় ভালো" -
// 3 per address per day, counted per email, on top of the hourly windows above.
const DAY_MS = 24 * HOUR_MS;
const EMAIL_DAILY_LIMIT = 3;

const validText = (value, min, max) => typeof value === 'string' && value.length >= min && value.length <= max && !/[\r\n\u0000]/.test(value);

// Greeting personalisation only: it never feeds a lock, ref, or rate key, so it is
// capped and stripped of control characters rather than validated as an identity.
const cleanRecipientName = value => String(value ?? '')
  .replace(/[\u0000-\u001f\u007f]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, 60);
const reason = value => String(value || 'UNKNOWN').toUpperCase().replace(/[^A-Z0-9_-]/g, '_').slice(0, 64) || 'UNKNOWN';
const safeInteraction = value => {
  if (value?.type !== 'telegram-link') return null;
  try {
    const url = new URL(String(value.url || ''));
    const token = url.searchParams.get('start') || '';
    if (url.protocol !== 'https:' || url.hostname !== 't.me' || !/^\/(?=.{5,32}$)[A-Za-z][A-Za-z0-9_]*bot$/i.test(url.pathname) || !/^[A-Za-z0-9_-]{32,64}$/.test(token)) return null;
    return Object.freeze({ type: 'telegram-link', url: url.href, proof: 'local-code-required', identityKind: 'telegram-account', phoneOwnership: false });
  } catch { return null; }
};
const ratio = quota => {
  const limit = Number(quota?.limit || 0);
  const remaining = Number(quota?.remaining || 0);
  return limit > 0 ? Math.max(0, Math.min(1, remaining / limit)) : 0;
};

function contextOf(input = {}) {
  const deviceId = String(input.deviceId || '');
  if (!/^[A-Za-z0-9_-]{20,96}$/.test(deviceId)) failAuth(AUTH_ERROR_CODES.INVALID_INPUT);
  return Object.freeze({
    deviceId,
    ip: String(input.ip || 'unknown').slice(0, 96),
    userAgent: String(input.userAgent || '').slice(0, 300),
    origin: String(input.origin || '').slice(0, 256)
  });
}

function providerFailure(error) {
  if (error instanceof VerificationProviderError) return error;
  return new VerificationProviderError('UNEXPECTED_PROVIDER_FAILURE', VERIFICATION_FAILURE_CLASS.TEMPORARY);
}

// A slot that has measurably slow sends moves behind the others. This is the one
// latency lever that cannot create a duplicate: the send still happens once, it
// just leaves through the provider that has been answering fastest. Readings are
// only trusted after a few successful sends, and a slot is never demoted for
// being under a sane absolute floor, so a quiet day on every provider does not
// reshuffle the operator's order.
const SLOW_SLOT_MIN_SAMPLES = 3;
const SLOW_SLOT_FLOOR_MS = 1_500;
const SLOW_SLOT_RATIO = 2;

const PROBE_TIMEOUT_MS = 5000;

// Owner 2026-10-16: iCloud / Yahoo / Outlook mailboxes did not receive codes that
// Brevo (top slot) accepted. Owner 2026-10-16 (later): route those recipients
// through Appwrite (otp-i), which he has confirmed does land in iCloud, Yahoo and
// Outlook. Appwrite mails the code itself from its own well-signed domain, so it
// does not depend on any sender verification the owner still has to do.
// A preference only lowers a slot's score; it cannot promote a slot the probe
// judged unready, so a misconfigured Appwrite falls through to the next slot
// instead of starving the send. Gmail recipients keep the operator order. A
// resend still demotes the slot that carried the previous code.
const NON_GMAIL_FREEMAIL = new Set(['icloud.com', 'me.com', 'mac.com', 'yahoo.com', 'yahoo.co.uk', 'yahoo.co.in', 'ymail.com', 'rocketmail.com', 'outlook.com', 'hotmail.com', 'live.com', 'msn.com', 'aol.com']);
// Owner 2026-10-16 (later still): Logto (otp-h) lands in Yahoo within seconds while
// Appwrite can arrive after the code expired, so Logto goes first (15-30 = -15) and
// Appwrite second (38-40 = -2); a resend (+25) then alternates between the two.
const NON_GMAIL_PREFERENCE = Object.freeze({ 'otp-h': -30, 'otp-i': -40, 'otp-b': -15, 'otp-e': -30 });
// Owner 2026-10-17: the control center posts only enabled/priority/dailyQuota per
// slot and no allowedDomains, so every save reset each timeoutMs to 8s (Logto,
// Apps Script and Telegram need longer). Keep whatever the panel did not send.
function mergeRuntimeConfig(input, current) {
  const raw = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const prior = new Map((current?.providers || []).map(row => [row.id, row]));
  const providers = Array.isArray(raw.providers) ? raw.providers.map(row => {
    const known = row && typeof row === 'object' ? prior.get(String(row.id || '')) : null;
    if (!known) return row;
    return { ...row, timeoutMs: row.timeoutMs ?? known.timeoutMs, label: row.label ?? known.label };
  }) : raw.providers;
  const keepDomains = !Array.isArray(raw.allowedDomains) && Array.isArray(current?.allowedDomains);
  return { ...raw, providers, ...(keepDomains ? { allowedDomains: [...current.allowedDomains] } : {}) };
}

function recipientBias(providerId, email) {
  const domain = String(email || '').trim().toLowerCase().split('@').pop();
  return NON_GMAIL_FREEMAIL.has(domain) ? (NON_GMAIL_PREFERENCE[providerId] || 0) : 0;
}

// Suffix forms that must match as the whole registrable domain or a parent
// (a.bd college would pass had we used a bare endsWith on '.bd').
// Owner 2026-10-18: no school/college/edu bypass any more.
const INSTITUTIONAL_SUFFIXES = Object.freeze([]);
// A domain is accepted when it equals an entry, or ends with `entry` where the
// entry already carries its leading dot (e.g. '.ac.bd').
const matchesDomain = (domain, list) =>
  list.some(entry => domain === entry || (entry.startsWith('.') && domain.endsWith(entry)));

const MAGIC_LINK_PROVIDER_ID = 'otp-m';

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

export class VerificationOrchestrator {
  constructor({ repository, hmacSecret, config, providers = [], activated = false, now = Date.now, cryptoImpl = globalThis.crypto, onDeliveryEvent = null } = {}) {
    const required = [
      'reserveChallenge', 'markChallengeDelivery', 'confirmProviderEvidence', 'claimTelegramDelivery',
      'confirmTelegramDelivery', 'getPendingChallenge', 'isTelegramLinked', 'failChallenge', 'getChallenge',
      'verifyLocalChallenge', 'rejectChallengeAttempt', 'completeRemoteChallenge',
      'dailyQuotaSnapshot', 'reserveDailyQuota', 'providerSnapshot', 'recordProviderResult',
      'status', 'getRuntimeConfig', 'setRuntimeConfig', 'cleanup', 'nextExpiry'
    ];
    if (!repository || required.some(method => typeof repository[method] !== 'function')) throw new TypeError('Verification repository is invalid.');
    this.repository = repository;
    this.hmac = new AuthHmac(hmacSecret, cryptoImpl);
    this.vault = new AuthSecretVault(hmacSecret, cryptoImpl);
    this.activated = activated === true;
    const configured = verificationConfig(config);
    this.runtimeEnabled = configured.enabled;
    this.config = this.activated ? configured : Object.freeze({ ...configured, enabled: false });
    this.now = now;
    this.crypto = cryptoImpl;
    this.capabilityCache = null;
    // AUTH-ROADMAP step 0 (owner 2026-10-18): optional sink for one event per provider
    // try and one per request (provider id, outcome, reason, timing only). The worker
    // wires observability/otp-delivery-log.mjs here; tests leave it null (silent).
    this.onDeliveryEvent = typeof onDeliveryEvent === 'function' ? onDeliveryEvent : null;
    const supplied = providers instanceof Map ? providers : new Map(providers.map(provider => [provider.id, provider]));
    this.providers = new Map(this.config.providers.map(entry => {
      const provider = supplied.get(entry.id) || new DisabledVerificationProvider(entry);
      assertVerificationProvider(provider);
      if (provider.id !== entry.id || provider.channel !== entry.channel || provider.verificationMode !== entry.verificationMode) {
        throw new TypeError(`Verification provider does not match configured slot: ${entry.id}`);
      }
      return [entry.id, provider];
    }));
  }

  async #identity(input, requestContext) {
    const purpose = PURPOSES.has(input?.purpose) ? input.purpose : 'account-backup';
    const context = contextOf(requestContext);
    const trusted = input?.trustedIdentity;
    if (trusted && typeof trusted === 'object') {
      const userId = String(trusted.userId || '').trim();
      const sessionRef = String(trusted.sessionRef || '');
      const subjectRef = String(trusted.subjectRef || '');
      const emailRef = String(trusted.emailRef || '');
      if (!validText(userId, 3, 128) || ![sessionRef, subjectRef, emailRef].every(value => /^[a-f0-9]{64}$/.test(value))) {
        failAuth(AUTH_ERROR_CODES.SESSION_INVALID);
      }
      // Pre-verification path: the worker already holds the address from the
      // Firebase lookup, so it passes it in and we hash it here. It never arrives
      // from client input, which keeps this from becoming a send-to-anyone vector.
      const ownershipEmail = purpose === 'email-ownership' ? normalizeAuthEmail(trusted.email) : '';
      if (purpose === 'email-ownership' && !ownershipEmail) failAuth(AUTH_ERROR_CODES.INVALID_INPUT);
      this.#assertDeliverable(ownershipEmail);
      const recipientName = purpose === 'email-ownership' ? cleanRecipientName(trusted.recipientName) : '';
      const [ipRef, deviceRef, destinationRef] = await Promise.all([
        this.hmac.hex('network-ref-v1', context.ip),
        this.hmac.hex('device-ref-v1', context.deviceId),
        this.hmac.hex('verification-destination-v1', purpose === 'email-ownership'
          ? `email-ownership:${ownershipEmail}`
          : 'telegram-account-verification')
      ]);
      return Object.freeze({
        sessionToken: '', subject: '', userId, email: ownershipEmail, purpose, recipientName,
        destinations: Object.freeze({
          otp: ownershipEmail,
          whatsapp: '',
          telegram: purpose === 'email-ownership' ? '' : 'user-initiated-link'
        }),
        context, sessionRef, subjectRef, emailRef, ipRef, deviceRef, destinationRef
      });
    }
    const sessionToken = String(input?.sessionToken || '').trim();
    const subject = String(input?.subject || '').trim();
    const userId = String(input?.userId || '').trim();
    const email = normalizeAuthEmail(input?.email);
    if (purpose === 'email-ownership') this.#assertDeliverable(email);
    if (!/^[A-Za-z0-9_-]{40,96}$/.test(sessionToken) || !validText(subject, 1, 256) || !validText(userId, 3, 128)) {
      failAuth(AUTH_ERROR_CODES.SESSION_INVALID);
    }
    const linked = input?.linkedDestinations && typeof input.linkedDestinations === 'object' ? input.linkedDestinations : {};
    const suppliedPhone = String(linked.whatsapp || input?.contact || '');
    const whatsapp = /^\+[1-9]\d{7,14}$/.test(suppliedPhone) ? suppliedPhone : '';
    const linkedTelegram = /^[A-Za-z0-9_-]{8,128}$/.test(String(linked.telegram || '')) ? String(linked.telegram) : '';
    const telegram = linkedTelegram || (input?.allowTelegramLink === true ? 'user-initiated-link' : '');
    const destinations = Object.freeze({ otp: email, whatsapp, telegram });
    const recipientName = cleanRecipientName(input?.recipientName);
    const [sessionRef, subjectRef, emailRef, ipRef, deviceRef, destinationRef] = await Promise.all([
      this.hmac.hex('session-ref-v1', sessionToken),
      this.hmac.hex('firebase-subject-v1', subject),
      this.hmac.hex('email-ref-v1', email),
      this.hmac.hex('network-ref-v1', context.ip),
      this.hmac.hex('device-ref-v1', context.deviceId),
      this.hmac.hex('verification-destination-v1', `${email}|${whatsapp}|${telegram}`)
    ]);
    return Object.freeze({ sessionToken, subject, userId, email, purpose, recipientName, destinations, context, sessionRef, subjectRef, emailRef, ipRef, deviceRef, destinationRef });
  }

  // Email-ownership only. The other purposes carry no real address in tests or
  // deliveries, and the allowlist is opt-in, so an unset list never blocks.
  #assertDeliverable(email) {
    if (!email) return;
    // Owner 2026-10-18: only the five allowed domains, always (config cannot widen it).
    if (isDisposableEmail(email)) failAuth(AUTH_ERROR_CODES.INVALID_INPUT);
    const allow = this.config.allowedDomains;
    if (!allow || allow.length === 0) return;
    const domain = email.slice(email.lastIndexOf('@') + 1);
    if (matchesDomain(domain, allow) || matchesDomain(domain, INSTITUTIONAL_SUFFIXES)) return;
    failAuth(AUTH_ERROR_CODES.INVALID_INPUT);
  }

  #limits(identity) {
    const limits = SEND_LIMITS.map(limit => Object.freeze({
      scope: limit.scope,
      key: limit.source === 'user' ? identity.userId
        : limit.source === 'ip' ? identity.ipRef
          : limit.source === 'device' ? identity.deviceRef : 'global',
      limit: limit.limit,
      windowMs: limit.windowMs
    }));
    if (identity.purpose === 'email-ownership' && identity.emailRef) {
      limits.push(Object.freeze({ scope: 'ownership-email-day', key: identity.emailRef, limit: EMAIL_DAILY_LIMIT, windowMs: DAY_MS }));
    }
    return limits;
  }

  async #record(entry, input) {
    return this.repository.recordProviderResult({
      providerId: entry.id,
      attemptId: input.attemptId,
      userId: input.userId,
      subjectRef: input.subjectRef,
      channel: entry.channel,
      success: input.success,
      failureClass: input.failureClass,
      reason: reason(input.reason),
      latencyMs: input.latencyMs,
      failureThreshold: this.config.policy.circuitFailureThreshold,
      forceCooldown: Number(input.retryAfter || 0) > 0,
      cooldownMs: Math.max(
        this.config.policy.circuitCooldownSeconds * 1000,
        Math.max(0, Number(input.retryAfter || 0)) * 1000
      ),
      now: input.now
    });
  }

  async #candidateRows(identity, destinations, now, deadline = 0) {
    // otp-m (magic link) is never part of the code failover, and a magic-link
    // request never falls back to a code provider the student is not expecting.
    const magicLink = identity.deliveryMethod === 'magic-link';
    const eligible = this.config.enabled
      ? this.config.providers.filter(entry => entry.enabled && destinations[entry.channel] && ((entry.id === MAGIC_LINK_PROVIDER_ID) === magicLink))
      : [];
    // Probes read live health from every enabled slot, so they are part of the
    // student's wait and must come out of the same budget as the sends.
    const probeCeiling = Math.min(PROBE_TIMEOUT_MS, Math.max(250, deadline - Date.now()));
    const rows = await Promise.all(eligible.map(async entry => {
      const provider = this.providers.get(entry.id);
      const started = Date.now();
      try {
        const [availability, remoteQuota, localQuota, state] = await Promise.all([
          // Readiness probes run for every slot before a single send, so a slow
          // probe delayed the whole OTP past the browser's patience. Probes get
          // a short ceiling; the send itself keeps the slot's full timeoutMs.
          bounded(() => provider.checkAvailability({ purpose: identity.purpose }), Math.min(entry.timeoutMs, probeCeiling)),
          bounded(() => provider.getRemainingQuota({ now }), Math.min(entry.timeoutMs, probeCeiling)),
          this.repository.dailyQuotaSnapshot({ providerId: entry.id, dailyQuota: entry.dailyQuota, now }),
          this.repository.providerSnapshot({ providerId: entry.id, now })
        ]);
        if (availability?.available !== true || state.circuit === 'open' || Number(remoteQuota?.remaining || 0) <= 0 || localQuota.remaining <= 0) return null;
        const lowestRatio = Math.min(ratio(remoteQuota), ratio(localQuota));
        const lowPenalty = lowestRatio <= this.config.policy.lowQuotaRatio ? 10_000 : (1 - lowestRatio) * 100;
        // Priority is the operator's explicit ordering and the gap between
        // neighbouring slots is 10, so a soft health signal must stay under it.
        // Left unbounded, one hard failure (500) or a slow reading (latency/50)
        // demotes a slot permanently: it is never retried, so its counters never
        // recover and a repaired credential is never used again. Demotion is the
        // circuit breaker's job, it opens after `circuitFailureThreshold`
        // consecutive failures and probes again after the cooldown, so these two
        // only break ties between equally ranked slots. `lowPenalty` stays large
        // on purpose: exhausted capacity is a hard constraint, not a preference.
        const failureTotal = Number(state.successCount || 0) + Number(state.failureCount || 0);
        const failurePenalty = failureTotal ? (Number(state.failureCount || 0) / failureTotal) * 5 : 0;
        const latencyPenalty = Math.min(Number(state.latencyEwmaMs || 0) / 50, 5);
        // A half-open circuit is the probe that closes it, so it is the one slot
        // that must actually be tried. Probe it first; if it fails the circuit
        // reopens and the next provider carries the send as before.
        return {
          entry,
          provider,
          probe: state.circuit === 'half-open',
          // Owner 2026-10-17: Brevo (10) must go before Logto (15) on Gmail. The
          // soft health penalties reach 10, more than that gap, so a fresh Logto
          // jumped ahead. They now only break ties; the order is the operator's
          // priority plus the deliberate recipient bias and resend demotion.
          score: entry.priority + lowPenalty + recipientBias(entry.id, destinations.otp) + (identity.previousProviderId && identity.previousProviderId === entry.id ? 25 : 0),
          health: failurePenalty + latencyPenalty,
          latencyMs: Number(state.latencyEwmaMs || 0),
          successes: Number(state.successCount || 0)
        };
      } catch (cause) {
        const failure = providerFailure(cause);
        await this.#record(entry, {
          attemptId: identity.attemptId,
          userId: identity.userId,
          subjectRef: identity.subjectRef,
          success: false,
          failureClass: failure.failureClass,
          reason: failure.code,
          retryAfter: failure.retryAfter,
          latencyMs: Date.now() - started,
          now
        });
        return null;
      }
    }));
    const candidates = rows.filter(Boolean);
    // Owner 2026-10-24: the OTP must be quick without ever sending twice, so the
    // order — not a second parallel send — is what carries the speed. Only a slot
    // that has proven itself slow (a few successes, and an average more than twice
    // the fastest healthy slot, above an absolute floor) is pushed back, far enough
    // to sit behind every other candidate. Everything else keeps the operator's
    // priority order untouched.
    const measured = candidates.filter(row => row.successes >= SLOW_SLOT_MIN_SAMPLES && row.latencyMs > 0);
    if (measured.length > 1) {
      const fastest = Math.min(...measured.map(row => row.latencyMs));
      const slowFrom = Math.max(SLOW_SLOT_FLOOR_MS, fastest * SLOW_SLOT_RATIO);
      const priorities = candidates.map(row => row.entry.priority);
      // Wide enough to clear the whole priority span, so a demoted slot really is last.
      const demotion = Math.max(...priorities) - Math.min(...priorities) + 10;
      for (const row of measured) {
        if (row.latencyMs < slowFrom) continue;
        row.score += demotion;
        row.slow = true;
      }
    }
    return candidates.sort((left, right) => left.score - right.score || (Number(right.probe) - Number(left.probe)) || left.health - right.health || left.entry.priority - right.entry.priority);
  }

  async requestVerification(input = {}, requestContext = {}) {
    const identity = await this.#identity(input, requestContext);
    const now = Number(this.now());
    const attemptId = randomToken(24, this.crypto);
    const code = randomSixDigitOtp(this.crypto);
    const linkToken = randomToken(32, this.crypto);
    const requiresRecoverableTelegramMaterial = this.config.providers.some(entry => {
      const provider = this.providers.get(entry.id);
      return entry.enabled && provider?.id === 'telegram' && provider?.verificationMode === VERIFICATION_MODES.LOCAL_CODE;
    });
    // F-02: the student's clock starts when the request arrives, not when the
    // first send leaves, so health probes cannot spend the budget for free.
    const requestStarted = Date.now();
    const deliveryDeadline = requestStarted + this.config.policy.deliveryBudgetMs;
    const [codeMac, linkTokenMac, codeCipher, linkCipher] = await Promise.all([
      this.hmac.hex('backup-verification-code-v1', `${attemptId}:${code}`),
      this.hmac.hex('backup-verification-link-v1', linkToken),
      requiresRecoverableTelegramMaterial ? this.vault.seal(`telegram-otp-v1:${code}`, `telegram-verification-code:${attemptId}`) : '',
      requiresRecoverableTelegramMaterial ? this.vault.seal(linkToken, `telegram-verification-link:${attemptId}`) : ''
    ]);
    const policy = this.config.policy;
    errorFromRepository(await this.repository.reserveChallenge({
      attemptId,
      userId: identity.userId,
      sessionRef: identity.sessionRef,
      subjectRef: identity.subjectRef,
      emailRef: identity.emailRef,
      destinationRef: identity.destinationRef,
      deviceRef: identity.deviceRef,
      ipRef: identity.ipRef,
      purpose: identity.purpose,
      codeMac,
      codeCipher,
      linkTokenMac,
      linkCipher,
      maxAttempts: policy.maxAttempts,
      createdAt: now,
      expiresAt: now + (policy.codeTtlSeconds * 1000),
      resendAt: now + (policy.resendCooldownSeconds * 1000),
      limits: this.#limits(identity),
      now
    }));
    let previousProviderId = '';
    try {
      const prior = await this.repository.getPendingChallenge({
        userId: identity.userId, sessionRef: identity.sessionRef, subjectRef: identity.subjectRef,
        emailRef: identity.emailRef, deviceRef: identity.deviceRef, purpose: identity.purpose, now
      });
      previousProviderId = String(prior?.challenge?.providerId || '');
    } catch {}
    const destinations = identity.destinations;
    const deliveryMethod = input?.deliveryMethod === 'magic-link' && identity.purpose === 'email-ownership' ? 'magic-link' : '';
    const candidates = await this.#candidateRows({ ...identity, attemptId, previousProviderId, deliveryMethod }, destinations, now, deliveryDeadline);
    const attemptRef = String(attemptId).slice(0, 8);
    // Visible in the delivery log: which slots the latency rule moved back.
    const demoted = candidates.filter(candidate => candidate.slow).map(candidate => candidate.entry.id).join(',');
    const tried = [];
    const logBase = { attempt: attemptRef, purpose: identity.purpose, method: deliveryMethod || 'code', candidates: candidates.length };
    const emit = (evt, fields) => { try { this.onDeliveryEvent?.({ evt, ...fields }); } catch {} };
    const logDelivery = fields => emit('otp_delivery', fields);
    const logRequest = fields => emit('otp_request', fields);
    let rank = 0;
    let budgetExhausted = false;
    // One send at a time, always. A parallel "hedged" send was tried on
    // 2026-10-24 and withdrawn the same day: two providers can both deliver, so
    // the student got two mails with the same code and no cancellation exists for
    // a message already handed to a provider. Speed comes from the budget below
    // and from the slot order, never from sending twice.
    for (const candidate of candidates) {
      const { entry, provider } = candidate;
      rank += 1;
      const maxTries = 1 + policy.maxProviderRetries;
      for (let currentTry = 0; currentTry < maxTries; currentTry += 1) {
        // F-02: once the shared budget is gone, stop. Spending another slot's
        // timeoutMs after the student has already given up only burns quota and
        // turns a fast failure into a minute-long spinner.
        const remainingBudget = deliveryDeadline - Date.now();
        if (remainingBudget <= 0) { budgetExhausted = true; break; }
        const quota = await this.repository.reserveDailyQuota({ providerId: entry.id, dailyQuota: entry.dailyQuota, now });
        if (quota.exhausted) {
          tried.push(`${entry.id}:quota`);
          logDelivery({ ...logBase, provider: entry.id, rank, try: currentTry + 1, outcome: 'quota_exhausted' });
          break;
        }
        const started = Date.now();
        let providerAccepted = false;
        try {
          const result = await bounded(() => provider.sendVerification({
            attemptId,
            purpose: identity.purpose,
            destination: destinations[entry.channel],
            code,
            linkToken,
            recipientName: identity.recipientName,
            expiresAt: now + (policy.codeTtlSeconds * 1000),
            signalContext: { origin: identity.context.origin }
          }), Math.min(entry.timeoutMs, deliveryDeadline - Date.now()));
          if (result?.accepted !== true) throw new VerificationProviderError('INVALID_PROVIDER_RESPONSE', VERIFICATION_FAILURE_CLASS.HARD);
          const latencyMs = Date.now() - started;
          providerAccepted = true;
          tried.push(`${entry.id}:ok`);
          logDelivery({ ...logBase, provider: entry.id, label: entry.label, rank, try: currentTry + 1, outcome: 'accepted', latencyMs });
          logRequest({ ...logBase, outcome: 'sent', provider: entry.id, totalMs: Date.now() - requestStarted, tried: tried.join(','), ...(demoted ? { demoted } : {}) });
          await this.#record(entry, { attemptId, userId: identity.userId, subjectRef: identity.subjectRef, success: true, reason: 'accepted', latencyMs, now });
          errorFromRepository(await this.repository.markChallengeDelivery({
            attemptId,
            providerId: entry.id,
            channel: entry.channel,
            verificationMode: entry.verificationMode,
            retainCodeCipher: entry.id === 'telegram',
            retainLinkCipher: entry.id === 'telegram',
            latencyMs,
            now
          }));
          const interaction = safeInteraction(result.interaction);
          return Object.freeze({
            accepted: true,
            attemptId,
            expiresAt: now + (policy.codeTtlSeconds * 1000),
            resendAfter: policy.resendCooldownSeconds,
            attemptsAllowed: policy.maxAttempts,
            ...(interaction ? { interaction } : {})
          });
        } catch (cause) {
          if (providerAccepted) {
            try { await this.repository.failChallenge({ attemptId, reason: 'delivery_state_unavailable', now }); } catch {}
            if (cause instanceof NativeAuthError) throw cause;
            throw new NativeAuthError(AUTH_ERROR_CODES.STORAGE_UNAVAILABLE);
          }
          const failure = providerFailure(cause);
          tried.push(`${entry.id}:${failure.code}`);
          logDelivery({
            ...logBase, provider: entry.id, label: entry.label, rank, try: currentTry + 1, outcome: 'failed',
            reason: failure.code, failureClass: failure.failureClass, latencyMs: Date.now() - started
          });
          const providerState = await this.#record(entry, {
            attemptId, userId: identity.userId, subjectRef: identity.subjectRef,
            success: false, failureClass: failure.failureClass, reason: failure.code, retryAfter: failure.retryAfter,
            latencyMs: Date.now() - started, now
          });
          if (failure.failureClass === VERIFICATION_FAILURE_CLASS.USER) {
            // Owner 2026-10-16: only a rejected address stops the request. Any other
            // USER-class reply (e.g. MailerSend 422 while half-open) is that provider's
            // problem, so skip it and let the next slot (Logto/Appwrite) carry the send.
            if (failure.code === 'INVALID_DESTINATION') {
              await this.repository.failChallenge({ attemptId, reason: failure.code, now });
              logRequest({ ...logBase, outcome: 'invalid_destination', totalMs: Date.now() - requestStarted, tried: tried.join(',') });
              throw new NativeAuthError(AUTH_ERROR_CODES.INVALID_INPUT);
            }
            break;
          }
          if (failure.failureClass === VERIFICATION_FAILURE_CLASS.HARD || providerState.circuit === 'open') break;
          // Owner 2026-10-16: a hung provider already burned its whole timeoutMs, so a
          // second wait on it only doubles the delay. Move to the next slot at once;
          // 429/5xx (also TEMPORARY) keep the single same-provider retry.
          if (failure.code === 'PROVIDER_TIMEOUT') break;
        }
      }
      if (budgetExhausted) break;
    }
    logRequest({
      ...logBase,
      outcome: budgetExhausted ? 'budget_exhausted' : 'all_failed',
      budgetMs: policy.deliveryBudgetMs,
      totalMs: Date.now() - requestStarted,
      tried: tried.join(','),
      ...(demoted ? { demoted } : {})
    });
    await this.repository.failChallenge({ attemptId, reason: 'all_providers_unavailable', now });
    throw new NativeAuthError(AUTH_ERROR_CODES.BACKUP_UNAVAILABLE);
  }

  async verify(input = {}, requestContext = {}) {
    const identity = await this.#identity(input, requestContext);
    const attemptId = String(input.attemptId || '').trim();
    if (!/^[A-Za-z0-9_-]{24,96}$/.test(attemptId)) failAuth(AUTH_ERROR_CODES.INVALID_INPUT);
    const now = Number(this.now());
    const selectedResult = errorFromRepository(await this.repository.getChallenge({
      attemptId,
      userId: identity.userId,
      sessionRef: identity.sessionRef,
      subjectRef: identity.subjectRef,
      deviceRef: identity.deviceRef,
      emailRef: identity.emailRef,
      purpose: identity.purpose,
      now
    }));
    const selected = selectedResult.challenge;
    if (!selected) throw new NativeAuthError(AUTH_ERROR_CODES.STORAGE_UNAVAILABLE);
    let verified;
    if (selected.verificationMode === VERIFICATION_MODES.LOCAL_CODE) {
      const code = String(input.code || '').trim();
      if (!/^\d{6}$/.test(code)) failAuth(AUTH_ERROR_CODES.INVALID_INPUT);
      const candidateCodeMac = await this.hmac.hex('backup-verification-code-v1', `${attemptId}:${code}`);
      verified = errorFromRepository(await this.repository.verifyLocalChallenge({
        attemptId,
        userId: identity.userId,
        sessionRef: identity.sessionRef,
        subjectRef: identity.subjectRef,
        deviceRef: identity.deviceRef,
        emailRef: identity.emailRef,
        purpose: identity.purpose,
        candidateCodeMac,
        lockoutMs: this.config.policy.lockoutSeconds * 1000,
        now
      }));
    } else {
      // otp-h (Logto) checks the student's own 6-digit code at the provider.
      const evidence = String(input.evidence || input.code || '').trim();
      if (!validText(evidence, 8, 4096) && !/^\d{6}$/.test(evidence)) failAuth(AUTH_ERROR_CODES.INVALID_INPUT);
      const entry = this.config.providers.find(row => row.id === selected.providerId && row.enabled);
      const provider = entry ? this.providers.get(entry.id) : null;
      if (!entry || !provider) throw new NativeAuthError(AUTH_ERROR_CODES.BACKUP_UNAVAILABLE);
      if (entry.id === 'telegram' && !Boolean(selected.providerConfirmed)) {
        throw new NativeAuthError(AUTH_ERROR_CODES.BACKUP_UNAVAILABLE, { retryAfter: 3 });
      }
      const started = Date.now();
      try {
        const result = await bounded(() => provider.verifyCode({
          attemptId,
          evidence,
          // Only this adapter needs the address at verification time. Resolve it
          // from the identity already bound to the challenge, never client input.
          ...(entry.id === 'otp-l' || entry.id === MAGIC_LINK_PROVIDER_ID ? { destination: identity.destinations[entry.channel] } : {}),
          purpose: identity.purpose,
          serverConfirmed: Boolean(selected.providerConfirmed)
        }), entry.timeoutMs);
        if (result?.verified !== true) {
          errorFromRepository(await this.repository.rejectChallengeAttempt({
            attemptId,
            userId: identity.userId,
            sessionRef: identity.sessionRef,
            subjectRef: identity.subjectRef,
            deviceRef: identity.deviceRef,
            emailRef: identity.emailRef,
            purpose: identity.purpose,
            lockoutMs: this.config.policy.lockoutSeconds * 1000,
            reason: 'provider_evidence_rejected',
            now
          }));
        }
        await this.#record(entry, { attemptId, userId: identity.userId, subjectRef: identity.subjectRef, success: true, reason: 'verified', latencyMs: Date.now() - started, now });
      } catch (cause) {
        if (cause instanceof NativeAuthError) throw cause;
        const failure = providerFailure(cause);
        await this.#record(entry, {
          attemptId, userId: identity.userId, subjectRef: identity.subjectRef,
          success: false, failureClass: failure.failureClass, reason: failure.code, retryAfter: failure.retryAfter,
          latencyMs: Date.now() - started, now
        });
        if (failure.failureClass === VERIFICATION_FAILURE_CLASS.USER) {
          errorFromRepository(await this.repository.rejectChallengeAttempt({
            attemptId,
            userId: identity.userId,
            sessionRef: identity.sessionRef,
            subjectRef: identity.subjectRef,
            deviceRef: identity.deviceRef,
            emailRef: identity.emailRef,
            purpose: identity.purpose,
            lockoutMs: this.config.policy.lockoutSeconds * 1000,
            reason: failure.code,
            now
          }));
        }
        throw new NativeAuthError(AUTH_ERROR_CODES.BACKUP_UNAVAILABLE);
      }
      verified = errorFromRepository(await this.repository.completeRemoteChallenge({
        attemptId,
        userId: identity.userId,
        sessionRef: identity.sessionRef,
        subjectRef: identity.subjectRef,
        deviceRef: identity.deviceRef,
        emailRef: identity.emailRef,
        purpose: identity.purpose,
        now
      }));
    }
    if (verified.userId !== identity.userId || verified.purpose !== identity.purpose) failAuth(AUTH_ERROR_CODES.ACCOUNT_CONFLICT);
    return Object.freeze({
      verified: true,
      purpose: verified.purpose,
      userId: identity.userId,
      ...(verified.telegramLinked === true ? { telegramLinked: true, emailVerified: false } : {}),
      ...(verified.emailOwnershipProven === true ? { emailOwnershipProven: true, emailVerified: false } : {})
    });
  }

  async pendingVerification(input = {}, requestContext = {}) {
    const identity = await this.#identity(input, requestContext);
    const selected = await this.repository.getPendingChallenge({
      userId: identity.userId,
      sessionRef: identity.sessionRef,
      subjectRef: identity.subjectRef,
      deviceRef: identity.deviceRef,
      emailRef: identity.emailRef,
      purpose: identity.purpose,
      now: Number(this.now())
    });
    if (selected?.pending !== true || !selected.challenge) return Object.freeze({ pending: false });
    const challenge = selected.challenge;
    const codeSent = challenge.providerId === 'telegram'
      ? challenge.providerConfirmed === true && !challenge.codeCipher
      : true;
    let interaction = null;
    if (challenge.providerId === 'telegram' && !codeSent && challenge.linkCipher) {
      const entry = this.config.providers.find(row => row.id === 'telegram' && row.enabled);
      const provider = entry ? this.providers.get(entry.id) : null;
      if (provider) {
        const linkToken = await this.vault.open(challenge.linkCipher, `telegram-verification-link:${challenge.attemptId}`);
        const result = await provider.sendVerification({ linkToken, attemptId: challenge.attemptId, purpose: identity.purpose });
        interaction = safeInteraction(result?.interaction);
      }
    }
    return Object.freeze({
      pending: true,
      attemptId: challenge.attemptId,
      expiresAt: Number(challenge.expiresAt),
      resendAt: Number(challenge.resendAt),
      codeSent,
      ...(interaction ? { interaction } : {})
    });
  }

  async isTelegramLinked(input = {}, requestContext = {}) {
    const identity = await this.#identity(input, requestContext);
    const result = await this.repository.isTelegramLinked({ userId: identity.userId, subjectRef: identity.subjectRef });
    return Object.freeze({ linked: result?.linked === true });
  }

  // Read-only counterpart to isTelegramLinked for the email-ownership proof. The
  // worker calls it with a trusted identity resolved from the Firebase session.
  async isEmailOwnershipProven(input = {}, requestContext = {}) {
    const identity = await this.#identity(input, requestContext);
    const result = await this.repository.isEmailOwnershipProven({ userId: identity.userId, subjectRef: identity.subjectRef });
    return Object.freeze({ proven: result?.proven === true, method: result?.method || null });
  }

  async confirmTelegramWebhook(input = {}) {
    const linkToken = String(input.linkToken || '').trim();
    const telegramUserId = String(input.telegramUserId || '').trim();
    const chatId = String(input.chatId || '').trim();
    if (!/^[A-Za-z0-9_-]{32,64}$/.test(linkToken) || !/^[1-9]\d{0,19}$/.test(telegramUserId) || chatId !== telegramUserId) {
      failAuth(AUTH_ERROR_CODES.INVALID_INPUT);
    }
    const entry = this.config.providers.find(row => row.id === 'telegram' && row.enabled);
    const provider = entry ? this.providers.get(entry.id) : null;
    if (!this.config.enabled || !entry || !provider || typeof provider.sendTelegramCode !== 'function') {
      throw new NativeAuthError(AUTH_ERROR_CODES.BACKUP_UNAVAILABLE);
    }
    const status = await bounded(() => provider.getProviderStatus({ now: Number(this.now()) }), entry.timeoutMs);
    if (status?.configured !== true) throw new NativeAuthError(AUTH_ERROR_CODES.BACKUP_UNAVAILABLE);
    const now = Number(this.now());
    const [linkTokenMac, externalIdentityRef] = await Promise.all([
      this.hmac.hex('backup-verification-link-v1', linkToken),
      this.hmac.hex('telegram-identity-v1', telegramUserId)
    ]);
    const claimed = errorFromRepository(await this.repository.claimTelegramDelivery({
      linkTokenMac,
      externalIdentityRef,
      now
    }));
    try {
      const packedCode = await this.vault.open(claimed.codeCipher, `telegram-verification-code:${claimed.attemptId}`);
      const code = /^telegram-otp-v1:(\d{6})$/.exec(packedCode)?.[1] || '';
      if (!code) throw new NativeAuthError(AUTH_ERROR_CODES.STORAGE_UNAVAILABLE);
      const delivered = await bounded(() => provider.sendTelegramCode({
        chatId,
        code,
        expiresInSeconds: Math.max(1, Math.ceil((Number(claimed.expiresAt) - Number(this.now())) / 1000))
      }), entry.timeoutMs);
      if (delivered?.accepted !== true) throw new VerificationProviderError('INVALID_PROVIDER_RESPONSE', VERIFICATION_FAILURE_CLASS.HARD);
      errorFromRepository(await this.repository.confirmTelegramDelivery({ attemptId: claimed.attemptId, now: Number(this.now()) }));
      return Object.freeze({ accepted: true, codeSent: true, identityKind: 'telegram-account', phoneOwnership: false });
    } catch {
      // Keep the encrypted, expiring code recoverable so Telegram can retry the same
      // authenticated update after a transient Bot API failure. A later resend still
      // supersedes this challenge atomically.
      throw new NativeAuthError(AUTH_ERROR_CODES.BACKUP_UNAVAILABLE);
    }
  }

  async configureTelegramWebhook() {
    const entry = this.config.providers.find(row => row.id === 'telegram' && row.enabled);
    const provider = entry ? this.providers.get(entry.id) : null;
    if (!this.config.enabled || !entry || !provider || typeof provider.configureWebhook !== 'function') {
      throw new NativeAuthError(AUTH_ERROR_CODES.BACKUP_UNAVAILABLE);
    }
    try {
      const result = await bounded(() => provider.configureWebhook(), entry.timeoutMs);
      if (result?.ready !== true || result?.identityReady !== true || result?.webhookReady !== true || result?.endpointAccepted !== true) {
        throw new VerificationProviderError('WEBHOOK_NOT_READY', VERIFICATION_FAILURE_CLASS.HARD);
      }
      return Object.freeze({
        ready: true,
        identityReady: true,
        webhookReady: true,
        endpointAccepted: true,
        webhookChanged: result.webhookChanged === true
      });
    } catch {
      throw new NativeAuthError(AUTH_ERROR_CODES.BACKUP_UNAVAILABLE);
    }
  }

  async removeTelegramWebhook() {
    const entry = this.config.providers.find(row => row.id === 'telegram' && row.enabled);
    const provider = entry ? this.providers.get(entry.id) : null;
    if (!entry || !provider || typeof provider.removeConfiguredWebhook !== 'function') {
      throw new NativeAuthError(AUTH_ERROR_CODES.BACKUP_UNAVAILABLE);
    }
    try {
      const result = await bounded(() => provider.removeConfiguredWebhook(), entry.timeoutMs);
      return Object.freeze({ removed: result?.removed === true });
    } catch {
      throw new NativeAuthError(AUTH_ERROR_CODES.BACKUP_UNAVAILABLE);
    }
  }

  async capabilities() {
    const now = Number(this.now());
    if (this.capabilityCache?.expiresAt > now) return this.capabilityCache.value || this.capabilityCache.promise;
    const promise = (async () => {
      const rows = await this.#candidateRows(
        { purpose: 'account-backup', attemptId: '', userId: '', subjectRef: '' },
        { otp: 'configured', whatsapp: 'configured', telegram: 'user-initiated-link' },
        now
      );
      const channels = new Set(rows.map(row => row.entry.channel));
      const phoneMode = channels.has('whatsapp')
        ? (channels.has('otp') || channels.has('telegram') ? 'optional' : 'required')
        : 'none';
      return Object.freeze({
        available: rows.length > 0,
        telegramAvailable: channels.has('telegram'),
        availabilityCode: rows.length ? 'READY' : this.config.enabled ? 'NO_HEALTHY_PROVIDER' : 'NOT_ACTIVATED',
        genericFlow: true,
        providerNamesExposed: false,
        contactInput: phoneMode,
        maxAttempts: this.config.policy.maxAttempts,
        expiresInSeconds: this.config.policy.codeTtlSeconds
      });
    })();
    this.capabilityCache = { promise, expiresAt: now + 30_000 };
    const value = await promise;
    this.capabilityCache = { value, expiresAt: now + 30_000 };
    return value;
  }

  async adminStatus() {
    const now = Number(this.now());
    const stored = await this.repository.status({ providerIds: this.config.providers.map(row => row.id), now });
    const providers = await Promise.all(this.config.providers.map(async entry => {
      const provider = this.providers.get(entry.id);
      const state = stored.providerStates.find(row => row.providerId === entry.id) || {};
      const quota = await this.repository.dailyQuotaSnapshot({ providerId: entry.id, dailyQuota: entry.dailyQuota, now });
      let availability = { available: false, code: 'NOT_RUN' };
      let remoteQuota = { remaining: 0, limit: 0, resetAt: 0 };
      let remoteStatus = { status: 'unknown', configured: false };
      const probes = await Promise.allSettled([
        bounded(() => provider.checkAvailability({ purpose: 'status' }), entry.timeoutMs),
        bounded(() => provider.getRemainingQuota({ now }), entry.timeoutMs),
        bounded(() => provider.getProviderStatus({ now }), entry.timeoutMs)
      ]);
      if (probes[0].status === 'fulfilled') availability = probes[0].value;
      else availability = { available: false, code: providerFailure(probes[0].reason).code };
      if (probes[1].status === 'fulfilled') remoteQuota = probes[1].value;
      if (probes[2].status === 'fulfilled') remoteStatus = probes[2].value;
      const total = Number(state.successCount || 0) + Number(state.failureCount || 0);
      return Object.freeze({
        id: entry.id,
        channel: entry.channel,
        enabled: entry.enabled,
        configured: remoteStatus?.configured === true,
        priority: entry.priority,
        timeoutMs: entry.timeoutMs,
        availability: availability?.available === true,
        availabilityCode: reason(availability?.code || 'UNKNOWN'),
        quota: Object.freeze({
          local: quota,
          remote: {
            remaining: Math.max(0, Number(remoteQuota?.remaining || 0)),
            limit: Math.max(0, Number(remoteQuota?.limit || 0)),
            resetAt: Math.max(0, Number(remoteQuota?.resetAt || 0))
          },
          low: ratio(quota) <= this.config.policy.lowQuotaRatio
        }),
        health: Object.freeze({
          circuit: state.circuit || 'closed',
          cooldownUntil: Number(state.cooldownUntil || 0),
          successCount: Number(state.successCount || 0),
          failureCount: Number(state.failureCount || 0),
          userErrorCount: Number(state.userErrorCount || 0),
          successRate: total ? Number(state.successCount || 0) / total : 0,
          failureRate: total ? Number(state.failureCount || 0) / total : 0,
          latencyMs: Number(state.latencyEwmaMs || 0),
          lastSuccessAt: Number(state.lastSuccessAt || 0),
          lastFailureAt: Number(state.lastFailureAt || 0),
          lastReason: reason(state.lastReason || 'NONE')
        })
      });
    }));
    return Object.freeze({
      enabled: this.config.enabled,
      runtimeEnabled: this.runtimeEnabled,
      activation: this.activated ? 'enabled' : 'disabled',
      policy: this.config.policy,
      providers: Object.freeze(providers),
      recentEvents: Object.freeze((stored.recentEvents || []).slice(-100))
    });
  }

  async updateConfig(input) {
    const next = verificationConfig(mergeRuntimeConfig(input, this.config));
    await this.repository.setRuntimeConfig({ config: next, now: Number(this.now()) });
    this.runtimeEnabled = next.enabled;
    this.config = this.activated ? next : Object.freeze({ ...next, enabled: false });
    this.capabilityCache = null;
    return this.adminStatus();
  }

  cleanup() { return this.repository.cleanup(Number(this.now())); }
  nextExpiry() { return this.repository.nextExpiry(Number(this.now())); }
}

export const __verificationOrchestratorTest = Object.freeze({ PURPOSES, SEND_LIMITS, providerFailure, ratio });
