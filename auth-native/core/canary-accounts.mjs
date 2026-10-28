// Canary accounts (P30, component 4): decoy addresses nobody owns.
//
// A canary is only useful if it is never a real account, so the list lives in
// a secret, not in this file, and an empty list means the feature is simply
// off - a misconfigured deployment must not invent decoys.
//
// Any attempt on a canary is a deliberate act: no ordinary person types
// admin@ or test@ by accident and knows the password field well enough to
// submit. So the response is the same generic wrong-credentials answer as
// everywhere else (an attacker learns nothing), while the event is recorded
// and alerted.

export const CANARY_POLICY_VERSION = 'canary-v1';

/**
 * Parse the CANARY_EMAILS secret: a comma or newline separated list. Entries
 * are normalized the same way a login normalizes an address, so a decoy with
 * a capital letter still matches.
 */
export function parseCanaryEmails(raw = '') {
  return Object.freeze(
    String(raw || '')
      .split(/[\s,;]+/)
      .map(value => value.trim().toLowerCase())
      .filter(value => value.includes('@'))
      .filter((value, index, list) => list.indexOf(value) === index)
  );
}

export function isCanaryEmail(email, canaryEmails = []) {
  const value = String(email || '').trim().toLowerCase();
  if (!value) return false;
  return canaryEmails.includes(value);
}

// The flag a canary hit raises against the address and the device. Kept
// separate from the password counters: a flagged pair is suspicious even
// when it has not yet failed enough times to be locked out.
export const CANARY_FLAG_TTL_SECONDS = 30 * 24 * 60 * 60;

export function createKvCanaryFlags(store, options = {}) {
  const prefix = String(options.prefix || 'canaryflag');
  const clock = typeof options.now === 'function' ? options.now : () => Date.now();
  const keyFor = kind => `${prefix}:${kind}`;

  return Object.freeze({
    policyVersion: CANARY_POLICY_VERSION,

    async flag(ip, deviceId) {
      const at = clock();
      const entries = [
        ['ip', String(ip || '').trim()],
        ['device', String(deviceId || '').trim()]
      ].filter(([, value]) => value);
      for (const [kind, value] of entries) {
        const key = `${keyFor(kind)}:${value}`;
        const previous = Number(await store.get(key)) || 0;
        await store.put(key, String(previous + 1), { expirationTtl: CANARY_FLAG_TTL_SECONDS });
      }
      return entries.length;
    },

    async isFlagged(ip, deviceId) {
      for (const [kind, value] of [['ip', ip], ['device', deviceId]]) {
        if (!value) continue;
        const count = Number(await store.get(`${keyFor(kind)}:${String(value).trim()}`)) || 0;
        if (count > 0) return true;
      }
      return false;
    }
  });
}
