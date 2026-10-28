import { VERIFICATION_CHANNELS, VERIFICATION_MODES } from './provider-contract.mjs';

const SLOT_DEFINITIONS = Object.freeze({
  'otp-a': Object.freeze({ channel: VERIFICATION_CHANNELS.OTP, verificationMode: VERIFICATION_MODES.LOCAL_CODE, priority: 10 }),
  'otp-h': Object.freeze({ channel: VERIFICATION_CHANNELS.OTP, verificationMode: VERIFICATION_MODES.PROVIDER_EVIDENCE, priority: 15 }),
  'otp-i': Object.freeze({ channel: VERIFICATION_CHANNELS.OTP, verificationMode: VERIFICATION_MODES.PROVIDER_EVIDENCE, priority: 38 }),
  'otp-j': Object.freeze({ channel: VERIFICATION_CHANNELS.OTP, verificationMode: VERIFICATION_MODES.PROVIDER_EVIDENCE, priority: 38 }),
  'otp-k': Object.freeze({ channel: VERIFICATION_CHANNELS.OTP, verificationMode: VERIFICATION_MODES.PROVIDER_EVIDENCE, priority: 38 }),
  'otp-l': Object.freeze({ channel: VERIFICATION_CHANNELS.OTP, verificationMode: VERIFICATION_MODES.PROVIDER_EVIDENCE, priority: 38 }),
  // otp-m is the Descope magic link. It never joins the code failover: only an
  // explicit 'magic-link' email-ownership request may select it.
  'otp-m': Object.freeze({ channel: VERIFICATION_CHANNELS.OTP, verificationMode: VERIFICATION_MODES.PROVIDER_EVIDENCE, priority: 38 }),
  'otp-b': Object.freeze({ channel: VERIFICATION_CHANNELS.OTP, verificationMode: VERIFICATION_MODES.LOCAL_CODE, priority: 20 }),
  'otp-c': Object.freeze({ channel: VERIFICATION_CHANNELS.OTP, verificationMode: VERIFICATION_MODES.LOCAL_CODE, priority: 30 }),
  'otp-d': Object.freeze({ channel: VERIFICATION_CHANNELS.OTP, verificationMode: VERIFICATION_MODES.LOCAL_CODE, priority: 35 }),
  'otp-e': Object.freeze({ channel: VERIFICATION_CHANNELS.OTP, verificationMode: VERIFICATION_MODES.LOCAL_CODE, priority: 37 }),
  'otp-f': Object.freeze({ channel: VERIFICATION_CHANNELS.OTP, verificationMode: VERIFICATION_MODES.LOCAL_CODE, priority: 38 }),
  'otp-g': Object.freeze({ channel: VERIFICATION_CHANNELS.OTP, verificationMode: VERIFICATION_MODES.LOCAL_CODE, priority: 39 }),
  // otp-n..otp-u: OTP_RAW pool mailers (pool-providers.mjs).
  'otp-n': Object.freeze({ channel: VERIFICATION_CHANNELS.OTP, verificationMode: VERIFICATION_MODES.LOCAL_CODE, priority: 38 }),
  'otp-o': Object.freeze({ channel: VERIFICATION_CHANNELS.OTP, verificationMode: VERIFICATION_MODES.LOCAL_CODE, priority: 38 }),
  'otp-q': Object.freeze({ channel: VERIFICATION_CHANNELS.OTP, verificationMode: VERIFICATION_MODES.LOCAL_CODE, priority: 38 }),
  'otp-r': Object.freeze({ channel: VERIFICATION_CHANNELS.OTP, verificationMode: VERIFICATION_MODES.LOCAL_CODE, priority: 38 }),
  'otp-s': Object.freeze({ channel: VERIFICATION_CHANNELS.OTP, verificationMode: VERIFICATION_MODES.LOCAL_CODE, priority: 38 }),
  'otp-t': Object.freeze({ channel: VERIFICATION_CHANNELS.OTP, verificationMode: VERIFICATION_MODES.LOCAL_CODE, priority: 38 }),
  'otp-u': Object.freeze({ channel: VERIFICATION_CHANNELS.OTP, verificationMode: VERIFICATION_MODES.LOCAL_CODE, priority: 38 }),
  // otp-v..otp-za: hosted IdP OTP (idp-providers.mjs) — provider mails and checks the code.
  'otp-v': Object.freeze({ channel: VERIFICATION_CHANNELS.OTP, verificationMode: VERIFICATION_MODES.PROVIDER_EVIDENCE, priority: 38 }),
  'otp-w': Object.freeze({ channel: VERIFICATION_CHANNELS.OTP, verificationMode: VERIFICATION_MODES.PROVIDER_EVIDENCE, priority: 38 }),
  'otp-x': Object.freeze({ channel: VERIFICATION_CHANNELS.OTP, verificationMode: VERIFICATION_MODES.PROVIDER_EVIDENCE, priority: 38 }),
  'otp-y': Object.freeze({ channel: VERIFICATION_CHANNELS.OTP, verificationMode: VERIFICATION_MODES.PROVIDER_EVIDENCE, priority: 38 }),
  'otp-z': Object.freeze({ channel: VERIFICATION_CHANNELS.OTP, verificationMode: VERIFICATION_MODES.PROVIDER_EVIDENCE, priority: 38 }),
  'otp-za': Object.freeze({ channel: VERIFICATION_CHANNELS.OTP, verificationMode: VERIFICATION_MODES.PROVIDER_EVIDENCE, priority: 38 }),
  whatsapp: Object.freeze({ channel: VERIFICATION_CHANNELS.WHATSAPP, verificationMode: VERIFICATION_MODES.LOCAL_CODE, priority: 40 }),
  telegram: Object.freeze({ channel: VERIFICATION_CHANNELS.TELEGRAM, verificationMode: VERIFICATION_MODES.LOCAL_CODE, priority: 50 })
});

const int = (value, fallback, min, max) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
};
const ratio = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : fallback;
};
const bool = value => value === true;
const cleanReason = value => String(value || '').replace(/[^A-Za-z0-9 _.-]/g, '').slice(0, 80);

const DEFAULT_POLICY = Object.freeze({
  codeTtlSeconds: 600,
  maxAttempts: 5,
  resendCooldownSeconds: 60,
  lockoutSeconds: 900,
  maxProviderRetries: 1,
  circuitFailureThreshold: 3,
  circuitCooldownSeconds: 300,
  lowQuotaRatio: 0.15,
  /* F-02 (blueprint 06): one code, one wall-clock budget. The send chain used to
     be unbounded — every enabled slot waited its own timeoutMs in turn, so a bad
     day across a dozen providers could hold the student for ~160s. The budget
     caps the whole request (health probes included), not each attempt. */
  deliveryBudgetMs: 25_000
});

function safeJson(raw) {
  if (!raw) return {};
  const text = String(raw);
  if (text.length > 16_384) return {};
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch { return {}; }
}

// Owner 2026-10-16 (final): "শুধুমাত্র gmail.com, yahoo.com, icloud.com,
// outlook.com ... বাইরে একটাও না". Real .ac.bd / .edu.bd college addresses are
// allowed by suffix in the orchestrator. Applied whenever a deployment does not
// set allowedDomains, so the guard is live by default; an explicit empty array
// opts out (unrestricted).
export const OWNER_ALLOWED_DOMAINS = Object.freeze(['gmail.com', 'yahoo.com', 'icloud.com', 'hotmail.com', 'outlook.com']);

export function verificationConfig(raw) {
  const input = typeof raw === 'string' ? safeJson(raw) : (raw && typeof raw === 'object' ? raw : {});
  const policyInput = input.policy && typeof input.policy === 'object' ? input.policy : {};
  const policy = Object.freeze({
    codeTtlSeconds: int(policyInput.codeTtlSeconds, DEFAULT_POLICY.codeTtlSeconds, 60, 600),
    maxAttempts: int(policyInput.maxAttempts, DEFAULT_POLICY.maxAttempts, 1, 5),
    resendCooldownSeconds: int(policyInput.resendCooldownSeconds, DEFAULT_POLICY.resendCooldownSeconds, 30, 600),
    lockoutSeconds: int(policyInput.lockoutSeconds, DEFAULT_POLICY.lockoutSeconds, 60, 86_400),
    maxProviderRetries: int(policyInput.maxProviderRetries, DEFAULT_POLICY.maxProviderRetries, 0, 2),
    circuitFailureThreshold: int(policyInput.circuitFailureThreshold, DEFAULT_POLICY.circuitFailureThreshold, 1, 10),
    circuitCooldownSeconds: int(policyInput.circuitCooldownSeconds, DEFAULT_POLICY.circuitCooldownSeconds, 30, 3_600),
    lowQuotaRatio: ratio(policyInput.lowQuotaRatio, DEFAULT_POLICY.lowQuotaRatio),
    deliveryBudgetMs: int(policyInput.deliveryBudgetMs, DEFAULT_POLICY.deliveryBudgetMs, 3_000, 60_000)
  });
  const supplied = Array.isArray(input.providers) ? input.providers : [];
  const byId = new Map(supplied.map(row => [String(row?.id || ''), row]));
  const providers = Object.entries(SLOT_DEFINITIONS).map(([id, slot]) => {
    const row = byId.get(id) || {};
    return Object.freeze({
      id,
      channel: slot.channel,
      verificationMode: slot.verificationMode,
      enabled: bool(row.enabled),
      priority: int(row.priority, slot.priority, 1, 10_000),
      dailyQuota: int(row.dailyQuota, 0, 0, 10_000_000),
      timeoutMs: int(row.timeoutMs, 8_000, 1_000, 20_000),
      label: cleanReason(row.label) || id.toUpperCase()
    });
  }).sort((left, right) => left.priority - right.priority || left.id.localeCompare(right.id));
  // Owner 2026-10-16: only real, deliverable mailboxes may take an email-ownership
  // OTP. An absent list falls back to OWNER_ALLOWED_DOMAINS so the guard is live by
  // default; an explicit empty array opts out. Widenable from the admin config.
  const allowedDomains = Object.freeze((Array.isArray(input.allowedDomains) ? input.allowedDomains : OWNER_ALLOWED_DOMAINS)
    .map(value => String(value || '').trim().toLowerCase().replace(/^\.+/, ''))
    .filter(value => /^[a-z0-9.-]+$/.test(value) && value.length <= 253)
    .slice(0, 200));
  return Object.freeze({
    enabled: bool(input.enabled),
    policy,
    allowedDomains,
    providers: Object.freeze(providers)
  });
}

export const defaultVerificationConfig = () => verificationConfig({});
export const __verificationConfigTest = Object.freeze({ SLOT_DEFINITIONS, DEFAULT_POLICY, safeJson });
