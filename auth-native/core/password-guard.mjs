// Password guard (P29): escalating lockout after repeated wrong passwords.
//
// Two scales, because the two surfaces carry different risk.
//
//   user  - the owner's numbers (2026-10-24, final): five wrong passwords in
//           a fifteen-minute window -> 30 minutes. Five more -> 5 hours.
//           Five more -> 1 day. The window is what keeps this from punishing
//           an ordinary student: typos inside a couple of minutes are not an
//           attack, and the count is held against the ip+email pair, never
//           the email alone - counting the email alone would let anyone lock
//           a stranger out by guessing wrong on their address.
//   admin - every wrong password escalates: 5 min, 7 h, 2 days, 7 days.
//
// The module decides, it does not store. Wire it to KV with
// createKvPasswordGuard, or to anything exposing { get, put }.
//
// A block is deliberately not resettable by a correct password: otherwise an
// attacker who guesses right learns that the guess was right by the fact that
// the block lifted. Only the clock (or the recovery path in the handler)
// clears it.

export const PASSWORD_GUARD_POLICY_VERSION = 'password-guard-v1';

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export const PASSWORD_GUARD_SCALES = Object.freeze({
  user: Object.freeze({
    name: 'user',
    windowMs: 15 * MINUTE,
    triggers: Object.freeze([5, 5, 5]),
    stepsMs: Object.freeze([30 * MINUTE, 5 * HOUR, 1 * DAY])
  }),
  admin: Object.freeze({
    name: 'admin',
    windowMs: 0,
    triggers: Object.freeze([1, 1, 1, 1]),
    stepsMs: Object.freeze([5 * MINUTE, 7 * HOUR, 2 * DAY, 7 * DAY])
  })
});

export function resolvePasswordGuardScale(scale) {
  if (typeof scale === 'string') return PASSWORD_GUARD_SCALES[scale] || PASSWORD_GUARD_SCALES.user;
  if (scale && typeof scale === 'object' && Array.isArray(scale.stepsMs) && scale.stepsMs.length) {
    const windowMs = Number.isFinite(scale.windowMs) && scale.windowMs > 0 ? scale.windowMs : 0;
    const triggers = (Array.isArray(scale.triggers) && scale.triggers.length ? scale.triggers : [1])
      .map(value => Math.max(1, Math.floor(Number(value) || 1)));
    return { name: String(scale.name || 'custom'), windowMs, triggers, stepsMs: scale.stepsMs.slice() };
  }
  return PASSWORD_GUARD_SCALES.user;
}

export function emptyGuardState() {
  return { fails: 0, windowStartedAt: 0, strikes: 0, until: 0, lastAt: 0 };
}

// Never trust a stored record: KV entries can be old, hand-edited or written
// by an earlier policy version, and a malformed one must fail closed to the
// empty state rather than to a negative block.
export function normalizeGuardState(raw) {
  if (!raw) return emptyGuardState();
  let value = raw;
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw);
    } catch {
      return emptyGuardState();
    }
  }
  if (!value || typeof value !== 'object') return emptyGuardState();
  const number = key => {
    const n = Math.floor(Number(value[key]));
    return Number.isFinite(n) && n > 0 ? n : 0;
  };
  return {
    fails: number('fails'),
    windowStartedAt: number('windowStartedAt'),
    strikes: number('strikes'),
    until: number('until'),
    lastAt: number('lastAt')
  };
}

function triggerFor(strikes, scale) {
  const list = scale.triggers;
  return list[Math.min(Math.max(strikes, 0), list.length - 1)];
}

function stepFor(strikes, scale) {
  const list = scale.stepsMs;
  return list[Math.min(Math.max(strikes - 1, 0), list.length - 1)] || 0;
}

export function guardDecision(state, now, scale = PASSWORD_GUARD_SCALES.user) {
  const resolved = resolvePasswordGuardScale(scale);
  const current = normalizeGuardState(state);
  const blocked = current.until > now;
  const needed = triggerFor(current.strikes, resolved);
  return Object.freeze({
    policyVersion: PASSWORD_GUARD_POLICY_VERSION,
    scale: resolved.name,
    blocked,
    retryAfterMs: blocked ? current.until - now : 0,
    retryAfterSeconds: blocked ? Math.ceil((current.until - now) / 1000) : 0,
    strikes: current.strikes,
    fails: current.fails,
    attemptsRemaining: Math.max(0, needed - current.fails),
    // The recovery path is the handler's job; the guard only states that a
    // blocked identity must be offered one.
    recoveryRequired: blocked
  });
}

export function recordPasswordFailure(state, now, scale = PASSWORD_GUARD_SCALES.user) {
  const resolved = resolvePasswordGuardScale(scale);
  const current = normalizeGuardState(state);

  // Inside an active block a further wrong guess must not extend the block:
  // otherwise an attacker (or the owner mistyping) turns 5 minutes into
  // forever, and the delay stops being predictable.
  if (current.until > now) {
    return Object.freeze({ state: current, decision: guardDecision(current, now, resolved), escalated: false });
  }

  const windowExpired = resolved.windowMs > 0 && now - current.windowStartedAt > resolved.windowMs;
  const fails = (windowExpired ? 0 : current.fails) + 1;
  const windowStartedAt = windowExpired || !current.windowStartedAt ? now : current.windowStartedAt;

  let next = { fails, windowStartedAt, strikes: current.strikes, until: current.until, lastAt: now };
  let escalated = false;

  if (fails >= triggerFor(current.strikes, resolved)) {
    const strikes = current.strikes + 1;
    next = { fails: 0, windowStartedAt: 0, strikes, until: now + stepFor(strikes, resolved), lastAt: now };
    escalated = true;
  }

  return Object.freeze({ state: next, decision: guardDecision(next, now, resolved), escalated });
}

export function recordPasswordSuccess(state, now, scale = PASSWORD_GUARD_SCALES.user) {
  const resolved = resolvePasswordGuardScale(scale);
  const current = normalizeGuardState(state);
  // A correct password during a block proves nothing: the caller must not be
  // able to clear its own block by guessing right. The handler refuses the
  // login and the state is left untouched.
  if (current.until > now) return current;
  return { ...emptyGuardState(), lastAt: now };
}

// The lockout counter is held against the ip+email pair, never the email on
// its own. A counter keyed on the email alone is a lockout weapon: anyone who
// knows a student's address could spend the five attempts and lock them out
// without ever touching their account. Keying on the pair means an attacker
// from one address only ever blocks that address, while the real student's
// own address stays open.
export function passwordGuardKey(email, ip) {
  const mail = String(email || '').trim().toLowerCase();
  const address = String(ip || '').trim();
  return `${address}|${mail}`;
}

/**
 * The total number of wrong guesses a decision represents.
 *
 * A decision reports `strikes` (blocks already served) and `fails` (wrong
 * guesses inside the current window), and the second resets at every strike,
 * so neither number on its own is the count of attempts. The risk engine
 * wants attempts, so the two are recombined here, where the scale that
 * defines a strike is known.
 */
export function passwordFailuresSoFar(decision, scale = PASSWORD_GUARD_SCALES.user) {
  if (!decision) return 0;
  const resolved = resolvePasswordGuardScale(scale);
  const perStrike = Number(resolved.triggers?.[0]) > 0 ? Number(resolved.triggers[0]) : 1;
  const strikes = Math.max(0, Number(decision.strikes) || 0);
  const fails = Math.max(0, Number(decision.fails) || 0);
  return strikes * perStrike + fails;
}

// KV-backed store. Cloudflare KV requires expirationTtl >= 60, so a short
// cooldown still gets a minute of life - harmless, the clock governs the
// decision and the record is read again on the next attempt anyway.
export function createKvPasswordGuard(store, options = {}) {
  const prefix = String(options.prefix || 'pwfail');
  const clock = typeof options.now === 'function' ? options.now : () => Date.now();

  const keyFor = identity => `${prefix}:${identity}`;

  async function read(identity) {
    const raw = await store.get(keyFor(identity));
    return normalizeGuardState(raw);
  }

  async function write(identity, state, scale) {
    const resolved = resolvePasswordGuardScale(scale);
    const ttlMs = Math.max(60_000, state.until - clock(), resolved.windowMs * 2);
    await store.put(keyFor(identity), JSON.stringify(state), { expirationTtl: Math.ceil(ttlMs / 1000) });
  }

  async function one(identity, run) {
    if (!identity) return null;
    return run(String(identity));
  }

  return Object.freeze({
    policyVersion: PASSWORD_GUARD_POLICY_VERSION,

    async check(identity, scale) {
      return one(identity, async key => guardDecision(await read(key), clock(), scale));
    },

    async recordFailure(identity, scale) {
      return one(identity, async key => {
        const result = recordPasswordFailure(await read(key), clock(), scale);
        await write(key, result.state, scale);
        return result.decision;
      });
    },

    // The recovery path (an email OTP or a reset link) calls this to lift the
    // block; nothing else may, so a correct password alone cannot clear it.
    // A pair with nothing recorded is left alone: most logins are successful
    // first try, and a write per login would be pure cost.
    async recordSuccess(identity, scale) {
      return one(identity, async key => {
        const current = await read(key);
        if (!current.fails && !current.strikes && !current.until) return true;
        const cleared = recordPasswordSuccess(current, clock(), scale);
        await write(key, cleared, scale);
        return true;
      });
    }
  });
}
