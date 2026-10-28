// Login facts (P30): the observations the shadow guard needs and the runtime
// does not already keep.
//
// The guard scores risk from facts, and until now only one fact was ever
// supplied - whether the device was new - so the high band, and with it the
// shadow-ban, could never be reached. A guard that can never fire is
// decoration. This module supplies the rest: whether the account has moved
// country or network, and how many distinct accounts one address is trying.
//
// Design rules:
//
//  - Only hashes are stored. A KV key here never contains an address, and the
//    value holds a country code, a network number and a short hash list - no
//    account identifier in readable form.
//  - Every method is fail-open. If the store is absent, slow or broken the
//    answer is "no change", which scores less risk rather than accusing a
//    student.
//  - A first sighting is never a change. The first login from a new phone
//    must not look like travel.

const DAY_MS = 24 * 60 * 60 * 1000;

async function shortHash(value) {
  const text = String(value ?? '');
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    // No Web Crypto means no way to hash without leaking the value, so the
    // caller is told there is nothing to key on rather than storing it raw.
    return '';
  }
  const digest = await subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest).slice(0, 10)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Remember where an account was last seen from, and report whether this
 * attempt moved.
 *
 * @param {object} store a KV namespace (get/put), or null.
 * @param {object} [options] `prefix`, `ttlSeconds`, `now`.
 */
export function createKvLoginFacts(store, options = {}) {
  const prefix = String(options.prefix || 'acct-facts');
  const ttlSeconds = Number(options.ttlSeconds) > 0 ? Number(options.ttlSeconds) : 180 * 24 * 60 * 60;
  const now = typeof options.now === 'function' ? options.now : () => Date.now();

  const keyFor = async identity => `${prefix}:${await shortHash(identity)}`;

  return Object.freeze({
    keyFor,

    /**
     * @returns {Promise<{first:boolean, known:boolean, countryChanged:boolean,
     *   asnChanged:boolean}>} `known` is false when the store could not be
     *   read, so the caller can tell "nothing recorded" from "no change".
     */
    async observe(identity, observed = {}) {
      const empty = { first: false, known: false, countryChanged: false, asnChanged: false };
      if (!store || !identity) return empty;
      const country = String(observed.country || '').trim().toUpperCase();
      const asn = Number(observed.asn);
      const hasCountry = country.length === 2;
      const hasAsn = Number.isFinite(asn) && asn > 0;
      if (!hasCountry && !hasAsn) return empty;

      const key = await keyFor(identity);
      if (!key) return empty;

      let previous = null;
      try {
        const raw = await store.get(key);
        previous = raw ? JSON.parse(raw) : null;
      } catch {
        return empty;
      }
      if (!previous || typeof previous !== 'object') previous = null;

      const next = {
        country: hasCountry ? country : previous?.country || null,
        asn: hasAsn ? asn : previous?.asn || null,
        at: now()
      };

      const result = {
        first: !previous,
        known: Boolean(previous),
        // A first sighting records without reporting a move: the first login
        // on a new phone is not travel.
        countryChanged: Boolean(previous?.country && hasCountry && previous.country !== country),
        asnChanged: Boolean(previous?.asn && hasAsn && previous.asn !== asn)
      };

      const changed = !previous || result.countryChanged || result.asnChanged || !previous.country || !previous.asn;
      if (changed) {
        try {
          await store.put(key, JSON.stringify(next), { expirationTtl: ttlSeconds });
        } catch {
          // A fact that cannot be recorded is still a fact that was observed.
        }
      }
      return result;
    }
  });
}

/**
 * Count how many distinct accounts one address has tried inside the window.
 *
 * This is the shape of credential stuffing rather than of a shared campus
 * network: students behind one address sign in to their own accounts, not to
 * ten different ones.
 *
 * @param {object} store a KV namespace (get/put), or null.
 * @param {object} [options] `prefix`, `windowSeconds`, `cap`, `now`.
 */
export function createKvIpBreadth(store, options = {}) {
  const prefix = String(options.prefix || 'ip-breadth');
  const windowSeconds = Number(options.windowSeconds) > 0 ? Number(options.windowSeconds) : 60 * 60;
  const cap = Number(options.cap) > 0 ? Number(options.cap) : 50;

  const keyFor = async ip => `${prefix}:${await shortHash(ip)}`;

  return Object.freeze({
    keyFor,

    /**
     * @returns {Promise<{emailsFromIp:number, known:boolean}>} `known` is
     *   false when the store could not be read, so the caller never reads a
     *   failed lookup as "zero accounts, safe".
     */
    async observe(ip, identity) {
      if (!store || !ip || !identity) return { emailsFromIp: 0, known: false };
      const key = await keyFor(ip);
      if (!key) return { emailsFromIp: 0, known: false };

      let list = [];
      try {
        const raw = await store.get(key);
        if (raw) list = JSON.parse(raw);
      } catch {
        return { emailsFromIp: 0, known: false };
      }
      if (!Array.isArray(list)) list = [];
      list = list.filter(entry => typeof entry === 'string');

      const fingerprint = await shortHash(identity);
      if (!fingerprint) return { emailsFromIp: list.length, known: true };

      if (!list.includes(fingerprint)) {
        list = [...list, fingerprint].slice(-cap);
        try {
          await store.put(key, JSON.stringify(list), { expirationTtl: Math.max(60, windowSeconds) });
        } catch {
          // Counting is best effort; the attempt itself must not fail on it.
        }
      }
      return { emailsFromIp: list.length, known: true };
    }
  });
}

export const LOGIN_FACTS_TTL_MS = DAY_MS;
