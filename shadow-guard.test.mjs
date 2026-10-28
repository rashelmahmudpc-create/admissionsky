import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateRisk } from './auth-native/core/security-policy.mjs';
import {
  shadowVerdict,
  computeRiskSignals,
  shadowDelayMs,
  SHADOW_GUARD_DELAY_MIN_MS,
  SHADOW_GUARD_DELAY_MAX_MS,
  resolveGuardMode,
  SHADOW_GUARD_MODES
} from './auth-native/core/shadow-guard.mjs';
import {
  parseCanaryEmails,
  isCanaryEmail,
  createKvCanaryFlags
} from './auth-native/core/canary-accounts.mjs';
import {
  isCommonPassword,
  passwordLengthVerdict,
  sha1Hex,
  breachedPassword,
  signupPasswordVerdict,
  PASSWORD_STRENGTH_MIN,
  PASSWORD_STRENGTH_MAX
} from './auth-native/core/password-strength.mjs';

const memoryKv = () => {
  const store = new Map();
  return {
    store,
    async get(key) {
      return store.has(key) ? store.get(key) : null;
    },
    async put(key, value) {
      store.set(key, value);
    }
  };
};

// --- risk signals -----------------------------------------------------------

test('a returning student on a known device is low risk', () => {
  const verdict = shadowVerdict({ deviceKnown: true });
  assert.equal(verdict.band, 'low');
  assert.equal(verdict.shadowBan, false);
  assert.equal(verdict.challenge, null);
});

test('an unknown device on its own is only a medium band', () => {
  // One behavioural signal must never accuse anyone: the engine caps a
  // single signal, so a student on a new phone gets a challenge, not a ban.
  const verdict = shadowVerdict({ deviceKnown: false });
  assert.equal(verdict.band, 'medium');
  assert.equal(verdict.shadowBan, false);
  assert.ok(verdict.challenge, 'a medium band must ask for a challenge');
});

test('a bot score under the threshold counts as a signal', () => {
  assert.equal(shadowVerdict({ deviceKnown: true, botScore: 5 }).band, 'medium');
  assert.equal(shadowVerdict({ deviceKnown: true, botScore: 99 }).band, 'low', 'a good score is not a signal');
});

test('credential stuffing from one address reaches the high band', () => {
  const verdict = shadowVerdict({ deviceKnown: true, emailsFromIp: 25 });
  assert.equal(verdict.band, 'medium', 'one signal alone stays capped');

  const combined = shadowVerdict({ deviceKnown: false, emailsFromIp: 25 });
  assert.equal(combined.band, 'high', 'two independent signals escalate');
  assert.equal(combined.shadowBan, true);
});

test('a country and asn change together is a high band', () => {
  const verdict = shadowVerdict({ deviceKnown: true, countryChanged: true, asnChanged: true });
  assert.equal(verdict.band, 'high');
  assert.ok(verdict.reasons.includes('country-changed'));
  assert.ok(verdict.reasons.includes('asn-changed'));
});

test('a suspended account is high regardless of behaviour', () => {
  const verdict = shadowVerdict({ accountState: 'suspended' });
  assert.equal(verdict.band, 'high');
  assert.equal(verdict.genericError, 'INVALID_CREDENTIALS');
});

test('a shadow-banned attempt carries the same error a wrong password does', () => {
  const verdict = shadowVerdict({ accountState: 'suspended' });
  const wrongPassword = shadowVerdict({ deviceKnown: true });
  assert.equal(verdict.genericError, 'INVALID_CREDENTIALS');
  assert.equal(verdict.shadowBan, true);
  assert.equal(wrongPassword.genericError, null, 'a low attempt returns no error of its own');
});

test('missing facts degrade to less friction, never to an accusation', () => {
  assert.equal(shadowVerdict({}).band, 'low');
  assert.equal(shadowVerdict({ botScore: 'nonsense' }).band, 'low');
  assert.equal(shadowVerdict({ emailsFromIp: -4 }).band, 'low');
});

test('the signal builder keeps engine signals and extras apart', () => {
  const { signals, extras } = computeRiskSignals({ deviceKnown: false, countryChanged: true, botScore: 1 });
  assert.equal(signals.newDevice, true, 'the engine vocabulary carries the new device');
  assert.deepEqual([...extras], ['country-changed', 'bot-suspicious'], 'the extras are not folded into the engine signals');
  assert.equal(evaluateRisk(signals).level, 'ELEVATED');
  // Two independent extras reach the high band, which is the point of
  // keeping them separate.
  assert.equal(shadowVerdict({ deviceKnown: false, countryChanged: true, botScore: 1 }).band, 'high');
});

// --- the hidden delay -------------------------------------------------------

test('the delay stays inside the window and varies per attempt', () => {
  const samples = [0, 0.25, 0.5, 0.75, 1].map(value => shadowDelayMs(() => value));
  assert.equal(samples[0], SHADOW_GUARD_DELAY_MIN_MS);
  assert.equal(samples[4], SHADOW_GUARD_DELAY_MAX_MS);
  assert.deepEqual(samples, [...samples].sort((a, b) => a - b));
  assert.ok(new Set(samples).size > 1, 'a fixed delay would be learnable');
});

test('a broken random source cannot push the delay outside the window', () => {
  for (const value of [NaN, -1, 2, undefined]) {
    const ms = shadowDelayMs(() => value);
    assert.ok(ms >= SHADOW_GUARD_DELAY_MIN_MS && ms <= SHADOW_GUARD_DELAY_MAX_MS, `${value} produced ${ms}`);
  }
});

// --- canary accounts --------------------------------------------------------

test('the canary list comes from the secret and an empty list means off', () => {
  const list = parseCanaryEmails('Admin@example.com, test@example.com\nprobe@example.com');
  assert.deepEqual([...list], ['admin@example.com', 'test@example.com', 'probe@example.com']);
  assert.deepEqual([...parseCanaryEmails('')], [], 'no secret means no decoys');
  assert.deepEqual([...parseCanaryEmails('not-an-email')], []);
});

test('a canary hit is recognized whatever the case', () => {
  const list = parseCanaryEmails('admin@example.com');
  assert.equal(isCanaryEmail(' ADMIN@Example.com ', list), true);
  assert.equal(isCanaryEmail('student@example.com', list), false);
  assert.equal(isCanaryEmail('', list), false);
});

test('a canary hit flags the address and the device', async () => {
  const kv = memoryKv();
  const flags = createKvCanaryFlags(kv, { now: () => 1_000_000 });
  assert.equal(await flags.isFlagged('203.0.113.7', 'device-abc'), false);

  const written = await flags.flag('203.0.113.7', 'device-abc');
  assert.equal(written, 2);
  assert.equal(await flags.isFlagged('203.0.113.7', 'other-device'), true, 'the address is flagged');
  assert.equal(await flags.isFlagged('198.51.100.9', 'device-abc'), true, 'the device is flagged');
  assert.equal(await flags.isFlagged('198.51.100.9', 'other-device'), false);
});

// --- password strength ------------------------------------------------------

test('length is enforced without composition rules', () => {
  assert.equal(passwordLengthVerdict('short'), 'too-short');
  assert.equal(passwordLengthVerdict('a'.repeat(PASSWORD_STRENGTH_MIN)), 'ok');
  assert.equal(passwordLengthVerdict('correct horse battery staple'), 'ok', 'a long passphrase passes');
  assert.equal(passwordLengthVerdict('a'.repeat(PASSWORD_STRENGTH_MAX + 1)), 'too-long');
});

test('the obvious passwords are rejected, including the hardened ones', () => {
  for (const value of ['password', 'Password', 'password123', 'p@ssw0rd', '1234567890', 'qwertyuiop', 'student12345']) {
    assert.equal(isCommonPassword(value), true, `${value} must be rejected`);
  }
  assert.equal(isCommonPassword('Tr0ub4dor&3xample'), false);
});

test('sha1Hex matches the known digest', async () => {
  // The canonical test vector, so the range prefix is provably right.
  assert.equal(await sha1Hex('password'), '5baa61e4c9b93f3f0682250b6cf8331b7ee68fd8');
});

test('the breach check sends only the five-character prefix', async () => {
  const seen = [];
  const fetchImpl = async url => {
    seen.push(url);
    return { ok: true, text: async () => '1E4C9B93F3F0682250B6CF8331B7EE68FD8:99\r\nOTHERSUFFIX:1' };
  };
  const result = await breachedPassword('password', { fetchImpl });
  assert.equal(seen.length, 1);
  assert.equal(seen[0], 'https://api.pwnedpasswords.com/range/5BAA6', 'only the prefix leaves the server');
  assert.equal(result.verdict, 'breached');
});

test('a clean answer is clean', async () => {
  const fetchImpl = async () => ({ ok: true, text: async () => 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA:3' });
  assert.equal((await breachedPassword('a-very-unique-passphrase', { fetchImpl })).verdict, 'clean');
});

test('a breach API failure never blocks a signup', async () => {
  const failing = async () => {
    throw new Error('offline');
  };
  const offline = await signupPasswordVerdict('a-very-unique-passphrase', { fetchImpl: failing });
  assert.equal(offline.ok, true);
  assert.equal(offline.breachCheck, 'unknown');

  const badStatus = await signupPasswordVerdict('a-very-unique-passphrase', { fetchImpl: async () => ({ ok: false }) });
  assert.equal(badStatus.ok, true);
});

test('a short or common password is rejected before the network is touched', async () => {
  let called = 0;
  const fetchImpl = async () => {
    called += 1;
    return { ok: true, text: async () => '' };
  };
  assert.equal((await signupPasswordVerdict('short', { fetchImpl })).reason, 'too-short');
  assert.equal((await signupPasswordVerdict('password123', { fetchImpl })).reason, 'common');
  assert.equal(called, 0, 'local checks answer without a request');
});

test('a breached password is rejected', async () => {
  // A password that is not on the local list, so the API path is exercised.
  const password = 'A-very-unique-passphrase-42';
  const hash = (await sha1Hex(password)).toUpperCase();
  const body = `${hash.slice(5)}:99\r\nSOMETHINGELSE:1`;
  const fetchImpl = async url => {
    assert.ok(url.endsWith(`/range/${hash.slice(0, 5)}`), 'the prefix must match the password');
    return { ok: true, text: async () => body };
  };
  const verdict = await signupPasswordVerdict(password, { fetchImpl });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.reason, 'breached');
});

// --- the deployment mode ------------------------------------------------------

test('an unset or unrecognised activation value observes, and never enforces', () => {
  // Observe is the fail-safe on both sides: a typo cannot lock a student out,
  // and it cannot silently switch the guard off either.
  assert.equal(resolveGuardMode(undefined), SHADOW_GUARD_MODES.OBSERVE);
  assert.equal(resolveGuardMode(''), SHADOW_GUARD_MODES.OBSERVE);
  assert.equal(resolveGuardMode('yes please'), SHADOW_GUARD_MODES.OBSERVE);
  assert.equal(resolveGuardMode('ENABLE'), SHADOW_GUARD_MODES.OBSERVE);
  assert.notEqual(resolveGuardMode('ENABLE'), SHADOW_GUARD_MODES.ENFORCE);
});

test('observe, enforce and off are each reachable by name', () => {
  assert.equal(resolveGuardMode('observe'), SHADOW_GUARD_MODES.OBSERVE);
  assert.equal(resolveGuardMode('shadow'), SHADOW_GUARD_MODES.OBSERVE);
  assert.equal(resolveGuardMode('enforce'), SHADOW_GUARD_MODES.ENFORCE);
  assert.equal(resolveGuardMode('canary'), SHADOW_GUARD_MODES.ENFORCE);
  assert.equal(resolveGuardMode('enabled'), SHADOW_GUARD_MODES.ENFORCE);
  assert.equal(resolveGuardMode('off'), SHADOW_GUARD_MODES.OFF);
  assert.equal(resolveGuardMode('disabled'), SHADOW_GUARD_MODES.OFF);
});

test('a high band still reports every reason, so observe mode can explain it', () => {
  const verdict = shadowVerdict({ deviceKnown: false, countryChanged: true, asnChanged: true });
  assert.equal(verdict.shadowBan, true);
  assert.ok(verdict.reasons.includes('country-changed'));
  assert.ok(verdict.reasons.includes('asn-changed'));
});

