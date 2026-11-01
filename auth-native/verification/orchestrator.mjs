import { AuthHmac, normalizeAuthEmail, randomSixDigitOtp, randomToken } from '../core/crypto.mjs';
import { FUZZ_ALERT_RATIO, FUZZ_HARD_RATIO, networkPrefix, worstFuzzBand } from '../core/abuse-signals.mjs';
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

// AU-SEC-01 L7 (destination quota). The daily cap above stops a slow burn
// against one address, but nothing stopped a burst: three codes inside four
// seconds is not a student waiting for a mail that has not arrived, it is a
// script. The hourly window is the tighter of the two in practice.
//
// The blueprint's L7 reads "≤3/hour, ≤8/day". The daily half is deliberately
// NOT raised to 8: the owner's own 2026-10-16 rule above is 3/day, and a
// looser ceiling here would quietly undo it. Both windows are keyed on the
// destination hash, never on the address itself.
const EMAIL_HOURLY_LIMIT = 3;

// AU-SEC-01 L6 (device quota): "one device (signed cookie + IP/64 + ASN) ≤ 5
// OTP a day". Two keys, because either one alone is free to forge. The cookie
// key catches a single browser being reused; the /64 key catches the same
// machine (or the same script host) cycling cookies. Neither is a hard refusal
// on its own — a campus uplink shares a /64 with hundreds of students, which is
// why the network ceiling is far above the device one and why the ASN half of
// the blueprint's rule lands as a harder human check in the handler rather than
// as a block here.
const DEVICE_DAILY_OTP_LIMIT = 5;

// The network ceiling is a backstop, not a quota. Its only job is to stop the
// one evasion the device key cannot see: a script that throws its cookie away
// between requests and moves to a new address inside the same prefix. It must
// never be the reason a real student is refused, and the prefix it keys on
// means very different things on the two families: an IPv6 /64 is one
// household, while an IPv4 /24 is whatever the ISP put behind it — a campus, a
// hostel, or a carrier-grade NAT pool shared by thousands.
//
// So it is set ABOVE what a single address could ever spend in a day. The
// per-IP window is 20/hour, so one address tops out at 480/day; a ceiling of
// 500 therefore cannot fire on one caller however persistent, and can only
// fire on rotation. That is the point: the tight per-caller controls (5/device,
// 20/IP/hour) do the real work, and the spend ceiling is the provider quota
// plus the L8 fuzz band, which tightens everyone's check at 80% and forces a
// hard human check at 95%. This layer just removes the free lunch of "cycle
// the cookie, keep the machine".
const NETWORK_DAILY_OTP_LIMIT = 500;

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
    // AU-SEC-01 L6: the /64 (v6) or /24 (v4) the caller sits in, so a device
    // that throws its cookie away and comes back is still the same caller.
    network: networkPrefix(input.ip),
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
// A4 done-when (owner 2026-10-31): the provider dashboard has to answer within
// three seconds. `adminStatus` probes all 26 slots at once, so its ceiling is the
// slowest single probe, not their sum — but one slot that has stopped answering
// would otherwise hold the page for its own timeoutMs (up to 20s for Apps Script
// and Telegram). A dashboard is a status read, never a send: a slot that misses
// this window is reported as unproven rather than waited for.
const STATUS_PROBE_TIMEOUT_MS = 2500;

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
// Appwrite can arrive after the code expired, so Logto goes first and Appwrite second;
// a resend (+25) then alternates between the two.
//
// A4 ③ (owner order 2026-10-31): these offsets are *additive*, so renumbering the
// priorities silently reordered this group. otp-i moved 38 -> 20, which would have put
// Appwrite ahead of Logto for Yahoo/iCloud — the exact inversion the owner reported on
// 2026-10-16. The offsets are therefore re-derived as (old effective score - new
// priority), which leaves every score exactly where the owner verified it:
//   otp-h 15-30 = -15   otp-i 20-22 = -2   otp-b 25-20 = 5   otp-e 30-23 = 7
// Brevo keeps its bare priority of 10, so the non-Gmail sequence stays
// Logto > Appwrite > Apps Script > AgentMail > Brevo, and Gmail keeps the operator order.
const NON_GMAIL_PREFERENCE = Object.freeze({ 'otp-h': -30, 'otp-i': -22, 'otp-b': -20, 'otp-e': -23 });
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
      const [ipRef, deviceRef, destinationRef, networkRef] = await Promise.all([
        this.hmac.hex('network-ref-v1', context.ip),
        this.hmac.hex('device-ref-v1', context.deviceId),
        this.hmac.hex('verification-destination-v1', purpose === 'email-ownership'
          ? `email-ownership:${ownershipEmail}`
          : 'telegram-account-verification'),
        context.network ? this.hmac.hex('netblock-ref-v1', context.network) : ''
      ]);
      return Object.freeze({
        sessionToken: '', subject: '', userId, email: ownershipEmail, purpose, recipientName,
        destinations: Object.freeze({
          otp: ownershipEmail,
          whatsapp: '',
          telegram: purpose === 'email-ownership' ? '' : 'user-initiated-link'
        }),
        context, sessionRef, subjectRef, emailRef, ipRef, deviceRef, destinationRef, networkRef
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
    const [sessionRef, subjectRef, emailRef, ipRef, deviceRef, destinationRef, networkRef] = await Promise.all([
      this.hmac.hex('session-ref-v1', sessionToken),
      this.hmac.hex('firebase-subject-v1', subject),
      this.hmac.hex('email-ref-v1', email),
      this.hmac.hex('network-ref-v1', context.ip),
      this.hmac.hex('device-ref-v1', context.deviceId),
      this.hmac.hex('verification-destination-v1', `${email}|${whatsapp}|${telegram}`),
      context.network ? this.hmac.hex('netblock-ref-v1', context.network) : ''
    ]);
    return Object.freeze({ sessionToken, subject, userId, email, purpose, recipientName, destinations, context, sessionRef, subjectRef, emailRef, ipRef, deviceRef, destinationRef, networkRef });
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
    // AU-SEC-01 L6: the per-day device ceiling the blueprint asks for. The
    // hourly window above is deliberately more generous than this one, because
    // an hourly cap cannot tell a burst from a long day; the daily cap is what
    // bounds the total a single device can spend.
    limits.push(Object.freeze({ scope: 'device-otp-day', key: identity.deviceRef, limit: DEVICE_DAILY_OTP_LIMIT, windowMs: DAY_MS }));
    // The network ceiling only exists when the edge actually reported an
    // address. An empty networkRef is "no signal", not a shared bucket.
    if (identity.networkRef) {
      limits.push(Object.freeze({ scope: 'netblock-otp-day', key: identity.networkRef, limit: NETWORK_DAILY_OTP_LIMIT, windowMs: DAY_MS }));
    }
    if (identity.purpose === 'email-ownership' && identity.emailRef) {
      limits.push(Object.freeze({ scope: 'ownership-email-day', key: identity.emailRef, limit: EMAIL_DAILY_LIMIT, windowMs: DAY_MS }));
      // AU-SEC-01 L7: the burst window. Separate scope, so the two windows
      // count independently and neither resets the other.
      limits.push(Object.freeze({ scope: 'ownership-email-hour', key: identity.emailRef, limit: EMAIL_HOURLY_LIMIT, windowMs: HOUR_MS }));
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
    const enabled = this.config.enabled ? this.config.providers.filter(entry => entry.enabled) : [];
    // A4 / AU-OB-02: say why a slot never entered the run. Without this the
    // delivery log shows only the slots that were tried, so "the OTP went out
    // through otp-y" and "every fast slot was exhausted and otp-y was all that
    // was left" look identical — which is exactly the question the owner asks
    // when a student says the code took a minute to arrive.
    const skipped = [];
    const eligible = [];
    for (const entry of enabled) {
      if (!destinations[entry.channel]) { skipped.push(`${entry.id}:no-${entry.channel}-destination`); continue; }
      if ((entry.id === MAGIC_LINK_PROVIDER_ID) !== magicLink) { skipped.push(`${entry.id}:${magicLink ? 'code-slot' : 'magic-link-only'}`); continue; }
      eligible.push(entry);
    }
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
        if (availability?.available !== true || state.circuit === 'open' || Number(remoteQuota?.remaining || 0) <= 0 || localQuota.remaining <= 0) {
          // A4 / AU-OB-02: the reason, not just the fact. One slot can be out of
          // the run for four different reasons and only two of them are the
          // owner's to fix, so the log has to name which.
          skipped.push(`${entry.id}:${availability?.available !== true ? 'unavailable'
            : state.circuit === 'open' ? 'circuit-open'
              : Number(remoteQuota?.remaining || 0) <= 0 ? 'provider-quota'
                : 'local-quota'}`);
          return null;
        }
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
    // A4 / AU-OB-02: hand the reasons back alongside the rows, sorted so two
    // runs of the same configuration produce the same log line.
    return Object.freeze({
      rows: candidates.sort((left, right) => left.score - right.score || (Number(right.probe) - Number(left.probe)) || left.health - right.health || left.entry.priority - right.entry.priority),
      skipped: Object.freeze(skipped.sort())
    });
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
    const { rows: candidates, skipped } = await this.#candidateRows({ ...identity, attemptId, previousProviderId, deliveryMethod }, destinations, now, deliveryDeadline);
    const attemptRef = String(attemptId).slice(0, 8);
    // Visible in the delivery log: which slots the latency rule moved back.
    const demoted = candidates.filter(candidate => candidate.slow).map(candidate => candidate.entry.id).join(',');
    const tried = [];
    // `skipped` is the list of slots that never entered the run and why; it is
    // attached to the request-level event, so one log line explains the whole
    // attempt rather than leaving the reader to infer it from what is absent.
    const logBase = { attempt: attemptRef, purpose: identity.purpose, method: deliveryMethod || 'code', candidates: candidates.length, ...(skipped.length ? { skipped: skipped.join(',') } : {}) };
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
        // AU-SEC-01 L8 (global fuzz). The reservation above is the only place
        // that knows how much of today's capacity is gone, so the band is read
        // here and emitted as a delivery event. The owner's sink throttles and
        // turns `alert` into a Telegram message; the handler reads the same
        // band on the signup path to force the strict human check at `hard`.
        // Best-effort: a failure to measure pressure must never fail a send.
        try {
          if (quota.limit > 0 && quota.used / quota.limit >= FUZZ_ALERT_RATIO) {
            logDelivery({
              ...logBase,
              provider: entry.id,
              rank,
              try: currentTry + 1,
              outcome: 'quota_pressure',
              band: quota.used / quota.limit >= FUZZ_HARD_RATIO ? 'hard' : 'alert',
              ratio: Math.round((quota.used / quota.limit) * 1000) / 1000
            });
          }
        } catch { /* pressure measurement is advisory */ }
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
    // AUTH V2.0 (owner 2026-10-31): the student waits on this call too, so it
    // gets the same ceiling the send path already honours. `requestVerification`
    // bounds every provider call by the shared delivery budget; this one used
    // the slot's own timeoutMs, which may be 20s — a single hung provider could
    // therefore hold a verification for longer than the whole send budget the
    // product promises. The deadline is measured from here, so it caps the
    // provider call rather than the work that already happened above.
    const verifyDeadline = Date.now() + this.config.policy.deliveryBudgetMs;
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
        }), Math.min(entry.timeoutMs, Math.max(1, verifyDeadline - Date.now())));
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
      const { rows } = await this.#candidateRows(
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
        bounded(() => provider.checkAvailability({ purpose: 'status' }), Math.min(entry.timeoutMs, STATUS_PROBE_TIMEOUT_MS)),
        bounded(() => provider.getRemainingQuota({ now }), Math.min(entry.timeoutMs, STATUS_PROBE_TIMEOUT_MS)),
        bounded(() => provider.getProviderStatus({ now }), Math.min(entry.timeoutMs, STATUS_PROBE_TIMEOUT_MS))
      ]);
      if (probes[0].status === 'fulfilled') availability = probes[0].value;
      else availability = { available: false, code: providerFailure(probes[0].reason).code };
      if (probes[1].status === 'fulfilled') remoteQuota = probes[1].value;
      if (probes[2].status === 'fulfilled') remoteStatus = probes[2].value;
      const total = Number(state.successCount || 0) + Number(state.failureCount || 0);
      /* AUTH V2.4 (owner 2026-10-31): say which slots have actually delivered.
       *
       * The blueprint's finding ২৫: `liveDeliveryVerified` is never true, so the
       * dashboard cannot tell a slot that has carried a real code from one that
       * has only ever been configured. The owner's decision on the chain is to
       * keep the unproven slots and put them BEHIND the proven ones rather than
       * delete them — and he cannot do that from a screen that shows both as
       * merely "configured".
       *
       * `successCount` was already reported, but a count is not a verdict: an
       * operator reading a table of 26 rows should not have to compare numbers to
       * learn which three are carrying the mail. `proven` is that verdict in one
       * word, and `deliveryEvidence` says what it is based on, so the claim can
       * be checked rather than trusted.
       *
       * One accepted send is the bar, deliberately: it is the weakest evidence
       * that is still real evidence, and a higher bar would keep a working slot
       * labelled unproven for days. `never-tried` and `tried-and-failed` are kept
       * apart because they mean different things to an operator — the first says
       * "we have not tested this", the second says "this did not work". */
      const successCount = Number(state.successCount || 0);
      const failureCount = Number(state.failureCount || 0);
      const deliveryEvidence = successCount > 0 ? 'proven' : (failureCount > 0 ? 'failed' : 'never-tried');
      return Object.freeze({
        id: entry.id,
        channel: entry.channel,
        enabled: entry.enabled,
        configured: remoteStatus?.configured === true,
        priority: entry.priority,
        // The single word an operator needs, and what it rests on.
        proven: successCount > 0,
        deliveryEvidence,
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

  /**
   * AU-SEC-01 L8 (global fuzz). How much of today's provider quota is gone,
   * as one band the caller can act on. Reads only the local reservation
   * counters, so it is cheap enough to call on a request path and cannot be
   * influenced by a caller.
   *
   * @returns {Promise<{band: 'normal'|'alert'|'hard', ratio: number, used: number, limit: number}>}
   */
  async fuzzPressure() {
    const now = Number(this.now());
    const enabled = this.config.providers.filter(entry => entry.enabled && entry.dailyQuota > 0);
    if (!enabled.length) return Object.freeze({ band: 'normal', ratio: 0, used: 0, limit: 0 });
    const snapshots = await Promise.all(enabled.map(entry =>
      this.repository.dailyQuotaSnapshot({ providerId: entry.id, dailyQuota: entry.dailyQuota, now })
        .catch(() => ({ used: 0, limit: 0 }))
    ));
    const worst = worstFuzzBand(snapshots);
    const spent = snapshots.reduce((total, row) => total + Number(row?.used || 0), 0);
    const capacity = snapshots.reduce((total, row) => total + Number(row?.limit || 0), 0);
    return Object.freeze({ band: worst.band, ratio: worst.ratio, used: spent, limit: capacity });
  }

  async updateConfig(input) {
    // AUTH V2.0: pass the live config as the base so a slot the panel did not
    // send keeps its current row instead of defaulting to disabled.
    const next = verificationConfig(mergeRuntimeConfig(input, this.config), this.config);
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
