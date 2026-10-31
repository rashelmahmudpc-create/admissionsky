/* AU-SEC-01 layers L3, L5, L6 and L8, in one place.
 *
 * L3 (ASN): an OTP request that arrives from a hosting/VPS network is almost
 * never a student. Cloudflare reports the caller's ASN on `request.cf.asn`, so
 * the decision costs nothing to make and needs no third-party lookup. The
 * response is deliberately NOT a refusal: plenty of students reach the app
 * through a free VPN that happens to live on one of these networks, and a
 * blocked student is the one outcome the owner's rules forbid. What a
 * datacenter ASN buys the caller instead is a mandatory human check (the
 * handler passes `required: true` to verifyTurnstile, which fails closed even
 * when no Turnstile secret is bound) and the tightened quotas in the
 * orchestrator.
 *
 * L6 (device quota): a device cookie is trivially discarded, so counting by
 * cookie alone lets one machine mint a fresh identity per request. The quota is
 * therefore keyed on the /64 network prefix too — a household or a campus
 * uplink shares one, while a script cycling addresses inside its own /64 does
 * not escape. See `networkPrefix`.
 *
 * L5 (honeypot + speed): a hidden field no human can see, and the time the
 * form was on screen. Either one going wrong means the submission was not
 * typed by a person. The answer is a silent 202 — the bot is told it worked,
 * so it does not retry and does not learn which field caught it, while no
 * account is created and no OTP is sent.
 *
 * The rule that keeps both layers honest: an ABSENT value is not a signal.
 * Older clients do not send these fields at all, and treating "missing" as
 * "automated" would refuse every student still on a cached bundle. Only a
 * value that is present AND wrong counts. That does mean a bot which simply
 * omits the fields is not caught here — the honeypot is the load-bearing half,
 * because a scraper that fills every input it finds trips it without knowing.
 */

/** Hosting and cloud networks, one ASN per operator, each the number that
 *  operator actually announces to the routing table. Kept short on purpose: a
 *  long hand-written list is a maintenance liability nobody re-verifies, and a
 *  wrong entry here costs a real student a harder human check. The majors
 *  below cover the overwhelming share of cheap bot infrastructure.
 *
 *  Deliberately absent: the mobile and broadband ASNs students actually use
 *  (Grameenphone 24389, Robi 24432, Banglalink 25227, BTCL 17494, Link3
 *  23688, Amber IT 23956, Carnival 132602) and Cloudflare's own edge (13335),
 *  which would otherwise flag every request that passes through the proxy. */
export const DATACENTER_ASNS = Object.freeze(new Set([
  14061,  // DigitalOcean
  16509,  // Amazon AWS
  14618,  // Amazon AES
  8075,   // Microsoft Azure
  24940,  // Hetzner
  63949,  // Akamai / Linode
  20473,  // Vultr / Choopa
  16276,  // OVH
  51167,  // Contabo
  12876,  // Scaleway / Online SAS
  197540, // netcup
  9009,   // M247
  212238, // Datacamp / CDN77
  45102,  // Alibaba Cloud (intl)
  37963,  // Alibaba Cloud (cn)
  132203, // Tencent Cloud
  36351,  // IBM SoftLayer
  53667,  // FranTech / BuyVM
  26496,  // GoDaddy
  32244,  // Liquid Web
  28753,  // LeaseWeb
  49981,  // WorldStream
  200651, // Flokinet
  49505,  // Selectel
  9123,   // Timeweb
  29802,  // Hivelocity
  63018,  // ColoCrossing
  40021,  // ColoCrossing
  3223,   // Voxility
  202425, // IP Volume
  209854, // Stark Industries
  62240,  // Clouvider
  215925, // Neterra
  197695, // Reg.ru
  48096,  // Itldc
  198610, // Beget
  210644, // Aeza
  401120, // Zenlayer
  55990,  // Huawei Cloud
  136907, // Huawei Cloud
  55967,  // Baidu
  55020,  // Hostinger
  47583,  // Hostinger
  22612,  // Namecheap hosting
  54290,  // Hostwinds
  30083,  // GoDaddy / ASCIO
  8560,   // IONOS
  34011,  // IONOS
  6724,   // Strato
  31898,  // Oracle Cloud
  14413,  // Linode legacy
  40676,  // Psychz
  53755,  // IOFlood
  19969,  // Joe's Datacenter
  15003,  // Nobis
  32475,  // SingleHop
  21859,  // Zenlayer
  62567,  // DigitalOcean legacy
  393406, // DigitalOcean
  152900, // Sharktech
  26347,  // Dreamhost
  30148,  // Sucuri
  32400,  // Linode
  54540,  // HostUS
  199524, // G-Core
  205544, // G-Core
  202422  // G-Core
]));

/** True when the edge reported an ASN that belongs to a hosting network.
 *  A missing or nonsensical ASN is never a signal. */
export function isDatacenterAsn(asn) {
  const value = Number(asn);
  return Number.isFinite(value) && value > 0 && DATACENTER_ASNS.has(value);
}

/**
 * The network a caller shares with its neighbours, for the L6 quota key.
 *
 * IPv6 is grouped by /64 — the smallest block a residential or campus uplink
 * normally hands out, and the size a script would be given if it were renting
 * a slice. IPv4 is grouped by /24 for the same reason: a single address is one
 * machine, but a /24 is one customer, and rotating inside it is free for the
 * caller and not a new identity.
 *
 * Returns '' for anything unparseable, and the caller must treat '' as "no
 * network signal" rather than as a shared bucket: lumping every unparseable
 * address into one key would make one bad header rate-limit the whole world.
 */
export function networkPrefix(ip) {
  const value = String(ip || '').trim().toLowerCase();
  if (!value || value === 'unknown') return '';
  // Strip a zone id ("fe80::1%eth0"). CF-Connecting-IP never carries a port,
  // and guessing at one here is how a plain 8-group address gets mistaken for
  // "2001" plus a port, so no port stripping is attempted.
  const bare = value.split('%')[0];

  if (bare.includes(':')) {
    // IPv6: keep the first four groups (a /64). A shorthand group ("::") is
    // expanded far enough to know where the prefix ends, then truncated.
    const [head, tail = ''] = bare.split('::');
    const headGroups = head ? head.split(':').filter(Boolean) : [];
    const tailGroups = tail ? tail.split(':').filter(Boolean) : [];
    if (!headGroups.length && !tailGroups.length) return '';
    const groups = bare.includes('::')
      ? [...headGroups, ...Array(Math.max(0, 8 - headGroups.length - tailGroups.length)).fill('0'), ...tailGroups]
      : headGroups;
    if (groups.length !== 8 || groups.some(group => !/^[0-9a-f]{1,4}$/.test(group))) return '';
    return groups.slice(0, 4).map(group => group.padStart(4, '0')).join(':');
  }

  const parts = bare.split('.');
  if (parts.length !== 4) return '';
  if (parts.some(part => !/^\d{1,3}$/.test(part) || Number(part) > 255)) return '';
  return `${parts[0]}.${parts[1]}.${parts[2]}.0/24`;
}

/** The hidden field a human never sees and never fills. Kept out of every
 *  label and every stylesheet hook so a screen reader does not announce it. */
export const HONEYPOT_FIELD = 'ah_contact_website';

/** A person cannot read a form, type an email and a password, and submit in
 *  under two seconds. Bots do it in milliseconds. */
export const MIN_FORM_MS = 2000;

/** The most a clock can be trusted to be plausible: a form left open for two
 *  hours and then submitted is a person coming back to a tab, not a bot. */
export const MAX_FORM_MS = 2 * 60 * 60 * 1000;

/**
 * Decide whether a submission looks automated.
 *
 * @param {{honeypot?: unknown, elapsedMs?: unknown}} input
 * @returns {{automated: boolean, reason: string}}
 */
export function looksAutomated(input = {}) {
  // A filled honeypot is the strongest signal there is: no human can see the
  // field, so anything in it was written by something reading the markup.
  const honeypot = input.honeypot;
  if (typeof honeypot === 'string' && honeypot.trim() !== '') return { automated: true, reason: 'HONEYPOT_FILLED' };
  if (typeof honeypot === 'number' && Number.isFinite(honeypot)) return { automated: true, reason: 'HONEYPOT_FILLED' };

  // Absent timing is not evidence. A client that does not send it is an older
  // bundle, and refusing on that basis would lock out every cached device.
  if (input.elapsedMs === undefined || input.elapsedMs === null || input.elapsedMs === '') {
    return { automated: false, reason: 'NO_TIMING_SIGNAL' };
  }
  const elapsed = Number(input.elapsedMs);
  if (!Number.isFinite(elapsed) || elapsed < 0 || elapsed > MAX_FORM_MS) {
    return { automated: true, reason: 'FORM_TIMING_IMPLAUSIBLE' };
  }
  if (elapsed < MIN_FORM_MS) return { automated: true, reason: 'FORM_TOO_FAST' };

  return { automated: false, reason: 'CLEAN' };
}

/** AU-SEC-01 L8 (global fuzz). Below `alertRatio` of the day's provider quota
 *  spent, nothing changes. Between alert and hard the owner is told once, so a
 *  run that is eating capacity is visible before it finishes. At `hardRatio`
 *  every new signup gets a human check it cannot skip, which is the cheapest
 *  way to make an automated run expensive without refusing a real student.
 *
 *  Both thresholds read the SAME number: the fraction of the day's quota that
 *  is gone. `used` and `limit` come from the local reservation table, so this
 *  costs no provider call and cannot be spoofed by a caller. */
export const FUZZ_ALERT_RATIO = 0.8;
export const FUZZ_HARD_RATIO = 0.95;

/**
 * @param {{used?: unknown, limit?: unknown}} quota
 * @returns {{band: 'normal'|'alert'|'hard', ratio: number}}
 */
export function fuzzBand(quota = {}) {
  const limit = Number(quota.limit);
  const used = Number(quota.used);
  // No configured ceiling is not pressure: a slot with dailyQuota 0 is
  // unlimited by design, and dividing by it would flag every request.
  if (!Number.isFinite(limit) || limit <= 0 || !Number.isFinite(used) || used < 0) {
    return { band: 'normal', ratio: 0 };
  }
  const spent = Math.max(0, Math.min(1, used / limit));
  if (spent >= FUZZ_HARD_RATIO) return { band: 'hard', ratio: spent };
  if (spent >= FUZZ_ALERT_RATIO) return { band: 'alert', ratio: spent };
  return { band: 'normal', ratio: spent };
}

/** The band for a whole deployment: the worst band any enabled slot is in.
 *  One exhausted provider is a fuzz signal even while the others are idle,
 *  because the run is clearly working through the list. */
export function worstFuzzBand(quotas = []) {
  let worst = { band: 'normal', ratio: 0 };
  for (const quota of quotas) {
    const next = fuzzBand(quota);
    if (next.band === 'hard') return next;
    if (next.band === 'alert' && worst.band === 'normal') worst = next;
    else if (next.band === 'normal' && next.ratio > worst.ratio) worst = { band: 'normal', ratio: next.ratio };
  }
  return worst;
}

export const __abuseSignalsTest = Object.freeze({
  DATACENTER_ASNS, HONEYPOT_FIELD, MIN_FORM_MS, MAX_FORM_MS,
  FUZZ_ALERT_RATIO, FUZZ_HARD_RATIO, networkPrefix
});