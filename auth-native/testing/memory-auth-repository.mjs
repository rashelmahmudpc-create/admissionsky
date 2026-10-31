import { AUTH_ERROR_CODES } from '../core/errors.mjs';
import { constantTimeEqual } from '../core/crypto.mjs';
import { transitionAccount, isSessionUsable } from '../core/account-lifecycle.mjs';

const copy = value => value == null ? value : structuredClone(value);

// Calendar year from a stored timestamp (ms epoch, s epoch, or YYYYMMDD
// compact date). The old raw-slice produced fake "1789"-style years.
function joinedYearOf(ts) {
  const t = Number(ts);
  if (!Number.isFinite(t) || t <= 0) return null;
  if (t >= 10000000 && t <= 99999999) return Math.floor(t / 10000); // YYYYMMDD
  const ms = t < 1e12 ? t * 1000 : t;
  const y = new Date(ms).getFullYear();
  return y >= 1990 && y <= 2100 ? y : null;
}

export class MemoryAuthRepository {
  constructor() {
    this.usersByEmail = new Map();
    this.users = new Map();
    this.externalIdentities = new Map();
    this.sessions = new Map();
    this.rates = new Map();
    this.events = [];
    this.passkeyHandles = new Map();
    this.passkeys = new Map();
    this.passkeyChallenges = new Map();
    this.passkeyTickets = new Map();
    this.accountVerificationTickets = new Map();
    this.profiles = new Map();
    this.publicIdentities = new Map();
    this.accountStates = new Map();
    this.trustedDevices = new Map();
    this.securityChallenges = new Map();
  }

  #storeTrustedDevice({ userId, deviceRef, browserClass, now, ttlMs, policyVersion, maxDevices }) {
    const browser = String(browserClass || '').slice(0, 40) || 'unknown';
    const expiresAt = now + Number(ttlMs);
    const active = [...this.trustedDevices.values()]
      .filter(row => row.userId === userId && !row.revokedAt && row.expiresAt > now)
      .sort((a, b) => a.trustedAt - b.trustedAt || String(a.deviceRef).localeCompare(String(b.deviceRef)));
    const max = Math.max(1, Number(maxDevices) || 10);
    if (active.length >= max) {
      const overflow = active.slice(0, active.length - max + 1);
      for (const row of overflow) {
        row.revokedAt = now;
        this.events.push({ type: 'device-trust-evicted', userId, at: now, purpose: null, policyVersion });
      }
    }
    this.trustedDevices.set(`${userId}|${deviceRef}`, {
      userId, deviceRef, browserClass: browser, trustedAt: now, expiresAt, revokedAt: null, policyVersion
    });
    this.events.push({ type: 'device-trusted', userId, at: now, deviceRef, policyVersion });
    return expiresAt;
  }

  #consume(limits, now) {
    let denied = null;
    for (const limit of limits || []) {
      const start = Math.floor(now / limit.windowMs) * limit.windowMs;
      const id = `${limit.scope}:${limit.key}:${start}`;
      const row = this.rates.get(id) || { count: 0, resetAt: start + limit.windowMs };
      row.count += 1;
      this.rates.set(id, row);
      if (row.count > limit.limit) {
        const retryAfter = Math.max(1, Math.ceil((row.resetAt - now) / 1000));
        if (!denied || retryAfter > denied.retryAfter) denied = { error: AUTH_ERROR_CODES.RATE_LIMITED, retryAfter };
      }
    }
    return denied;
  }

  #canonicalSession({ sessionRef, subjectRef, emailRef, now }) {
    const session = this.sessions.get(sessionRef);
    if (!session || session.revokedAt || session.expiresAt <= now) return { error: AUTH_ERROR_CODES.SESSION_INVALID };
    const user = this.users.get(session.userId);
    const identity = this.externalIdentities.get(`firebase:${subjectRef}`);
    if (!user || !identity || identity.userId !== user.id || user.emailRef !== emailRef) return { error: AUTH_ERROR_CODES.SESSION_INVALID };
    if (user.status !== 'active') return { error: AUTH_ERROR_CODES.ACCOUNT_DISABLED };
    return { user };
  }

  #passkeyChallenge({ challengeId, candidateChallengeMac, deviceRef, kind, now }) {
    const row = this.passkeyChallenges.get(challengeId);
    if (!row || row.kind !== kind || row.deviceRef !== deviceRef || !constantTimeEqual(row.challengeMac, candidateChallengeMac) || row.state !== 'active') {
      return { error: AUTH_ERROR_CODES.PASSKEY_INVALID };
    }
    if (row.expiresAt <= now) {
      row.state = 'expired'; row.challengeMac = ''; row.refreshCipher = '';
      return { error: AUTH_ERROR_CODES.PASSKEY_INVALID };
    }
    return { challenge: row };
  }

  async consumeLimits({ limits, now, eventType, subjectRef }) {
    const denied = this.#consume(limits, now);
    if (denied) return denied;
    this.events.push({ type: eventType, subjectRef, at: now });
    return { accepted: true };
  }

  async establishExternalSession(input) {
    const identityKey = `${input.provider}:${input.subjectRef}`;
    const identity = this.externalIdentities.get(identityKey);
    let user = identity ? this.users.get(identity.userId) : this.usersByEmail.get(input.emailRef);
    let created = false;
    if (identity && !user) return { error: AUTH_ERROR_CODES.STORAGE_UNAVAILABLE };
    if (!identity && user) {
      const existing = [...this.externalIdentities.values()].find(row => row.provider === input.provider && row.userId === user.id);
      if (existing && existing.subjectRef !== input.subjectRef) return { error: AUTH_ERROR_CODES.ACCOUNT_CONFLICT };
    }
    if (!user) {
      user = {
        id: input.userIdCandidate,
        emailRef: input.emailRef,
        emailMask: input.emailMask,
        status: 'active',
        createdAt: input.now,
        lastLoginAt: input.now
      };
      this.usersByEmail.set(input.emailRef, user);
      this.users.set(user.id, user);
      created = true;
    }
    if (user.status !== 'active') return { error: AUTH_ERROR_CODES.ACCOUNT_DISABLED };
    if (identity && user.emailRef !== input.emailRef) {
      const emailOwner = this.usersByEmail.get(input.emailRef);
      if (emailOwner && emailOwner.id !== user.id) return { error: AUTH_ERROR_CODES.ACCOUNT_CONFLICT };
      this.usersByEmail.delete(user.emailRef);
      user.emailRef = input.emailRef;
      user.emailMask = input.emailMask;
      this.usersByEmail.set(input.emailRef, user);
    }
    if (!identity) {
      this.externalIdentities.set(identityKey, {
        provider: input.provider,
        subjectRef: input.subjectRef,
        userId: user.id,
        createdAt: input.now,
        lastVerifiedAt: input.now
      });
    } else identity.lastVerifiedAt = input.now;
    user.lastLoginAt = input.now;
    this.sessions.set(input.sessionRef, {
      sessionRef: input.sessionRef,
      userId: user.id,
      createdAt: input.now,
      expiresAt: input.sessionExpiresAt,
      lastSeenAt: input.now,
      revokedAt: null,
      ipRef: input.ipRef,
      deviceRef: input.deviceRef,
      userAgent: input.userAgent
    });
    this.events.push({
      type: input.loginEvent || (created ? 'firebase-account-linked' : 'firebase-login'),
      subjectRef: input.subjectRef, userId: user.id, at: input.now,
      ...(input.eventExtras || {})
    });
    return { established: true, created, user: copy(user) };
  }

  async getExternalSession({ sessionRef, provider, subjectRef, emailRef, now, trackRefresh = false }) {
    const session = this.sessions.get(sessionRef);
    if (!session || session.revokedAt || session.expiresAt <= now) return { error: AUTH_ERROR_CODES.SESSION_INVALID };
    const user = this.users.get(session.userId);
    const identity = this.externalIdentities.get(`${provider}:${subjectRef}`);
    if (!user || !identity || identity.userId !== user.id || user.emailRef !== emailRef) return { error: AUTH_ERROR_CODES.SESSION_INVALID };
    if (user.status !== 'active') return { error: AUTH_ERROR_CODES.ACCOUNT_DISABLED };
    if (now - session.lastSeenAt > 6 * 60 * 60 * 1000) session.lastSeenAt = now;
    if (trackRefresh) this.events.push({ type: 'session-refreshed', subjectRef, userId: user.id, at: now });
    return { expiresAt: session.expiresAt, user: copy(user) };
  }

  async beginFirebaseAccountVerification(input) {
    const denied = this.#consume(input.limits, input.now);
    if (denied) return denied;
    const identity = this.externalIdentities.get(`firebase:${input.subjectRef}`);
    let user = identity ? this.users.get(identity.userId) : this.usersByEmail.get(input.emailRef);
    if (identity && !user) return { error: AUTH_ERROR_CODES.STORAGE_UNAVAILABLE };
    if (!identity && user) {
      const existing = this.externalIdentities.get(`firebase:${input.subjectRef}`)
        || [...this.externalIdentities.values()].find(row => row.provider === 'firebase' && row.userId === user.id);
      if (existing && existing.subjectRef !== input.subjectRef) return { error: AUTH_ERROR_CODES.ACCOUNT_CONFLICT };
    }
    if (!user) {
      user = {
        id: input.userIdCandidate,
        emailRef: input.emailRef,
        emailMask: input.emailMask,
        status: 'active',
        createdAt: input.now,
        lastLoginAt: input.now
      };
      this.users.set(user.id, user);
      this.usersByEmail.set(user.emailRef, user);
    }
    if (user.status !== 'active') return { error: AUTH_ERROR_CODES.ACCOUNT_DISABLED };
    if (user.emailRef !== input.emailRef) return { error: AUTH_ERROR_CODES.ACCOUNT_CONFLICT };
    if (!identity) {
      this.externalIdentities.set(`firebase:${input.subjectRef}`, {
        provider: 'firebase', subjectRef: input.subjectRef, userId: user.id,
        createdAt: input.now, lastVerifiedAt: input.now
      });
    }
    for (const row of this.accountVerificationTickets.values()) {
      if (row.userId === user.id && row.state === 'active') { row.state = 'superseded'; row.refreshCipher = ''; }
    }
    this.accountVerificationTickets.set(input.ticketRef, {
      ticketRef: input.ticketRef,
      userId: user.id,
      subjectRef: input.subjectRef,
      emailRef: input.emailRef,
      refreshCipher: input.refreshCipher,
      state: 'active',
      purpose: input.purpose || null,
      createdAt: input.now,
      expiresAt: input.expiresAt,
      consumedAt: null,
      ipRef: input.ipRef,
      deviceRef: input.deviceRef
    });
    return { prepared: true, user: copy(user) };
  }

  async getFirebaseAccountVerification(input) {
    const row = this.accountVerificationTickets.get(input.ticketRef);
    if (!row || row.deviceRef !== input.deviceRef || row.state !== 'active') return { error: AUTH_ERROR_CODES.TELEGRAM_VERIFICATION_INVALID };
    if (row.expiresAt <= input.now) { row.state = 'expired'; row.refreshCipher = ''; return { error: AUTH_ERROR_CODES.TELEGRAM_VERIFICATION_INVALID }; }
    const user = this.users.get(row.userId);
    if (!user || user.status !== 'active') return { error: AUTH_ERROR_CODES.ACCOUNT_DISABLED };
    return { ...copy(row), emailMask: user.emailMask, status: user.status, createdAt: user.createdAt };
  }

  async completeFirebaseAccountVerification(input) {
    const row = this.accountVerificationTickets.get(input.ticketRef);
    if (!row || row.deviceRef !== input.deviceRef || row.state !== 'active' || row.expiresAt <= input.now
      || row.subjectRef !== input.subjectRef || row.emailRef !== input.emailRef) {
      return { error: AUTH_ERROR_CODES.TELEGRAM_VERIFICATION_INVALID };
    }
    const user = this.users.get(row.userId);
    if (!user || user.status !== 'active') return { error: AUTH_ERROR_CODES.ACCOUNT_DISABLED };
    row.state = 'consumed'; row.refreshCipher = ''; row.consumedAt = input.now;
    this.sessions.set(input.sessionRef, {
      sessionRef: input.sessionRef, userId: user.id, createdAt: input.now,
      expiresAt: input.sessionExpiresAt, lastSeenAt: input.now, revokedAt: null,
      ipRef: input.ipRef, deviceRef: input.deviceRef, userAgent: input.userAgent
    });
    user.lastLoginAt = input.now;
    let trusted = false;
    if (row.purpose === 'new-device' && input.trust && Number(input.trust.ttlMs) > 0) {
      this.#storeTrustedDevice({
        userId: user.id, deviceRef: input.deviceRef, browserClass: input.userAgent,
        now: input.now, ttlMs: input.trust.ttlMs, policyVersion: input.trust.policyVersion, maxDevices: input.trust.maxDevices
      });
      trusted = true;
    }
    this.events.push({
      type: row.purpose === 'new-device' ? 'new-device-challenge-completed' : 'firebase-telegram-verification-session',
      subjectRef: input.subjectRef, userId: user.id, at: input.now,
      ...(row.purpose ? { deviceRef: input.deviceRef, purpose: row.purpose, policyVersion: input.trust?.policyVersion } : {})
    });
    return { established: true, trusted, user: copy(user) };
  }

  async getFirebaseIdentity(input) {
    const identity = this.externalIdentities.get(`firebase:${input.subjectRef}`);
    const user = identity ? this.users.get(identity.userId) : null;
    if (!user || user.emailRef !== input.emailRef) return { error: AUTH_ERROR_CODES.SESSION_INVALID };
    if (user.status !== 'active') return { error: AUTH_ERROR_CODES.ACCOUNT_DISABLED };
    return { user: copy(user) };
  }

  // Mirrors SqliteAuthRepository: greeting name comes from the saved profile,
  // resolved against the verification ticket rather than client input.
  async getFirebaseVerificationRecipientName(input) {
    const ticket = this.accountVerificationTickets.get(input.ticketRef);
    if (!ticket || ticket.deviceRef !== input.deviceRef || ticket.state !== 'active' || ticket.expiresAt <= input.now) return { fullName: '' };
    return { fullName: String(this.profiles.get(ticket.userId)?.fullName || '') };
  }

  async savePendingProfile(input) {
    const ticket = this.accountVerificationTickets.get(input.ticketRef);
    if (!ticket || ticket.deviceRef !== input.deviceRef || ticket.state !== 'active' || ticket.expiresAt <= input.now) {
      return { error: AUTH_ERROR_CODES.TELEGRAM_VERIFICATION_INVALID };
    }
    const user = this.users.get(ticket.userId);
    if (!user || user.status !== 'active') return { error: AUTH_ERROR_CODES.ACCOUNT_DISABLED };
    const previous = this.profiles.get(user.id);
    const profile = { ...copy(input.profile), createdAt: previous?.createdAt || input.now, updatedAt: input.now };
    this.profiles.set(user.id, profile);
    return { saved: true, profile: copy(profile) };
  }

  async saveProfile(input) {
    const session = this.#canonicalSession(input);
    if (session.error) return session;
    const previous = this.profiles.get(session.user.id);
    const profile = { ...copy(input.profile), createdAt: previous?.createdAt || input.now, updatedAt: input.now };
    this.profiles.set(session.user.id, profile);
    return { saved: true, profile: copy(profile) };
  }

  async getProfile(input) {
    const session = this.#canonicalSession(input);
    if (session.error) return session;
    return { profile: copy(this.profiles.get(session.user.id) || null) };
  }

  // Phase 7, mirrors SqliteAuthRepository profile API (same behavior,
  // in-memory storage).
  #withDefaults(profile, now) {
    return {
      mobile: '',
      bio: '',
      targets: [],
      visibility: 'private',
      ...copy(profile || {}),
      createdAt: now,
      updatedAt: now
    };
  }

  async #derivePublicId(userId, attempt) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`ah-public-id-v1|${userId}|${attempt}`));
    const bytes = new Uint8Array(digest).subarray(0, 4);
    const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    let value = ((bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]) >>> 0;
    let out = '';
    for (let i = 0; i < 6; i += 1) { out += alphabet[value % 31]; value = Math.floor(value / 31); }
    return `AH-${out}`;
  }

  async #ensurePublicIdentity(userId, now) {
    const existing = this.publicIdentities.get(userId);
    if (existing) return existing;
    let attempt = 0;
    for (;;) {
      attempt += 1;
      const candidate = await this.#derivePublicId(userId, attempt - 1);
      const clash = [...this.publicIdentities.entries()].find(([, id]) => id === candidate);
      if (clash && clash[0] !== userId) continue;
      this.publicIdentities.set(userId, candidate);
      return candidate;
    }
  }

  #provisionProfile(userId, now) {
    if (this.profiles.get(userId)) return null;
    const profile = this.#withDefaults({ fullName: '', dob: '', school: { id: '', name: '', district: '' } }, now);
    this.profiles.set(userId, profile);
    this.events.push({ eventType: 'profile-provisioned', userId, occurredAt: now });
    return copy(profile);
  }

  #profileCompletion(profile, { avatarPresent = false } = {}) {
    if (!profile) return 0;
    let score = 0;
    if (profile.fullName && String(profile.fullName).length >= 2) score += 25;
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(profile.dob || ''))) score += 15;
    if (profile.mobile) score += 15;
    if (profile.school && profile.school.name) score += 10;
    if (profile.higherInstitution && profile.higherInstitution.name) score += 10;
    if (Array.isArray(profile.targets) && profile.targets.length > 0 && profile.targets[0]?.name) score += 15;
    if (avatarPresent) score += 10;
    return Math.min(100, score);
  }

  async getProfileV2(input) {
    const session = this.#canonicalSession(input);
    if (session.error) return session;
    const provisioned = this.#provisionProfile(session.user.id, input.now);
    const profile = provisioned || this.profiles.get(session.user.id);
    const publicId = await this.#ensurePublicIdentity(session.user.id, input.now);
    const avatarPresent = input.avatarPresent === true;
    const user = this.users.get(session.user.id);
    return {
      profile: copy(profile) || null,
      publicId,
      completion: this.#profileCompletion(profile, { avatarPresent }),
      avatarPresent,
      joinedYear: user ? joinedYearOf(user.createdAt) : null,
      lastLoginAt: user?.lastLoginAt || null
    };
  }

  async saveProfilePatch(input) {
    const session = this.#canonicalSession(input);
    if (session.error) return session;
    const provisioned = this.#provisionProfile(session.user.id, input.now);
    const current = provisioned || this.profiles.get(session.user.id);
    const expect = input.expectVersion === undefined || input.expectVersion === null
      ? null
      : Number(input.expectVersion);
    if (expect !== null && Number.isFinite(expect) && expect !== current.version) {
      return { error: AUTH_ERROR_CODES.PROFILE_VERSION_CONFLICT, currentVersion: current.version };
    }
    const next = { ...copy(current), ...copy(input.fields), version: current.version + 1, updatedAt: input.now };
    this.profiles.set(session.user.id, next);
    const changed = Object.keys(input.fields || {});
    this.events.push({
      eventType: changed.includes('visibility') ? 'profile-visibility-changed' : 'profile-patched',
      userId: session.user.id,
      occurredAt: input.now
    });
    return { saved: true, profile: copy(this.profiles.get(session.user.id)) };
  }

  async getPublicProfile(input) {
    const entry = [...this.publicIdentities.entries()].find(([, id]) => id === input.publicId);
    if (!entry) return { error: AUTH_ERROR_CODES.PUBLIC_PROFILE_NOT_FOUND };
    const user = this.users.get(entry[0]);
    const accountState = this.accountStates.get(entry[0]);
    // Phase 6 fact: suspension lives in the account state, deactivation in
    // auth_users.status, both must be active for a public surface.
    if (!user || user.status !== 'active' || (accountState?.status && accountState.status !== 'active')) {
      return { error: AUTH_ERROR_CODES.PUBLIC_PROFILE_NOT_FOUND };
    }
    const profile = this.profiles.get(entry[0]);
    if (!profile) return { error: AUTH_ERROR_CODES.PUBLIC_PROFILE_NOT_FOUND };
    const visibility = ['private', 'limited', 'public'].includes(profile.visibility) ? profile.visibility : 'private';
    if (visibility === 'private') return { error: AUTH_ERROR_CODES.PUBLIC_PROFILE_NOT_FOUND };
    const subjectRef = [...this.externalIdentities.entries()]
      .find(([key, value]) => key.startsWith('firebase:') && value?.userId === entry[0])?.[0]
      ?.slice('firebase:'.length) || null;
    const base = {
      publicId: input.publicId,
      displayName: profile.fullName || 'Admission Student',
      avatarPresent: false,
      visibility
    };
    if (visibility !== 'public') return { profile: base, subjectRef };
    const target = Array.isArray(profile.targets) && profile.targets[0] ? profile.targets[0] : null;
    return {
      profile: {
        ...base,
        target: target ? { name: target.name, unit: target.unit || '', year: target.year || '' } : null,
        joinedYear: joinedYearOf(user.createdAt),
        bio: profile.bio || '',
        completion: this.#profileCompletion(profile, { avatarPresent: false })
      },
      subjectRef
    };
  }

  async beginPasskeyRegistration(input) {
    const denied = this.#consume(input.limits, input.now);
    if (denied) return denied;
    const session = this.#canonicalSession(input);
    if (session.error) return session;
    let userHandle = this.passkeyHandles.get(session.user.id);
    if (!userHandle) { userHandle = input.userHandleCandidate; this.passkeyHandles.set(session.user.id, userHandle); }
    for (const row of this.passkeyChallenges.values()) {
      if (row.kind === 'registration' && row.userId === session.user.id && row.state === 'active') {
        row.state = 'superseded'; row.challengeMac = ''; row.refreshCipher = '';
      }
    }
    this.passkeyChallenges.set(input.challengeId, {
      challengeId: input.challengeId,
      challengeMac: input.challengeMac,
      kind: 'registration',
      userId: session.user.id,
      subjectRef: input.subjectRef,
      userHandle,
      refreshCipher: input.refreshCipher,
      state: 'active',
      createdAt: input.now,
      expiresAt: input.expiresAt,
      ipRef: input.ipRef,
      deviceRef: input.deviceRef
    });
    const credentials = [...this.passkeys.values()]
      .filter(row => row.userId === session.user.id && row.status === 'active')
      .map(row => ({ credentialId: row.credentialId, transports: row.transports }));
    return { user: copy(session.user), userHandle, credentials: copy(credentials) };
  }

  async getPasskeyRegistrationChallenge(input) {
    const selected = this.#passkeyChallenge({ ...input, kind: 'registration' });
    if (selected.error) return selected;
    const session = this.#canonicalSession(input);
    if (session.error) return session;
    if (session.user.id !== selected.challenge.userId || input.subjectRef !== selected.challenge.subjectRef) return { error: AUTH_ERROR_CODES.ACCOUNT_CONFLICT };
    return { ...copy(selected.challenge), user: copy(session.user) };
  }

  async finishPasskeyRegistration(input) {
    const selected = this.#passkeyChallenge({ ...input, kind: 'registration' });
    if (selected.error) return selected;
    const challenge = selected.challenge;
    if (this.passkeys.has(input.credential.credentialId)) return { error: AUTH_ERROR_CODES.ACCOUNT_CONFLICT };
    this.passkeys.set(input.credential.credentialId, {
      ...copy(input.credential),
      credentialId: input.credential.credentialId,
      userId: challenge.userId,
      subjectRef: challenge.subjectRef,
      userHandle: challenge.userHandle,
      status: 'active',
      createdAt: input.now,
      lastUsedAt: null
    });
    challenge.state = 'consumed'; challenge.challengeMac = ''; challenge.refreshCipher = ''; challenge.consumedAt = input.now;
    const user = this.users.get(challenge.userId);
    const count = [...this.passkeys.values()].filter(row => row.userId === challenge.userId && row.status === 'active').length;
    return { registered: true, credentialCount: count, user: copy(user) };
  }

  async beginPasskeyAuthentication(input) {
    const denied = this.#consume(input.limits, input.now);
    if (denied) return denied;
    for (const row of this.passkeyChallenges.values()) {
      if (row.kind === 'authentication' && row.deviceRef === input.deviceRef && row.state === 'active') {
        row.state = 'superseded'; row.challengeMac = '';
      }
    }
    this.passkeyChallenges.set(input.challengeId, {
      challengeId: input.challengeId,
      challengeMac: input.challengeMac,
      kind: 'authentication',
      userId: null,
      subjectRef: null,
      userHandle: null,
      refreshCipher: '',
      state: 'active',
      createdAt: input.now,
      expiresAt: input.expiresAt,
      ipRef: input.ipRef,
      deviceRef: input.deviceRef
    });
    return { prepared: true };
  }

  async getPasskeyAuthenticationMaterial(input) {
    const selected = this.#passkeyChallenge({ ...input, kind: 'authentication' });
    if (selected.error) return selected;
    const credential = this.passkeys.get(input.credentialId);
    if (!credential || credential.status !== 'active') return { error: AUTH_ERROR_CODES.PASSKEY_NOT_FOUND };
    const user = this.users.get(credential.userId);
    if (!user || user.status !== 'active') return { error: AUTH_ERROR_CODES.ACCOUNT_DISABLED };
    return { credential: copy({
      credentialId: credential.credentialId,
      userHandle: credential.userHandle,
      publicKeyJwk: credential.publicKeyJwk,
      counter: credential.counter
    }) };
  }

  async issuePasskeyTicket(input) {
    const selected = this.#passkeyChallenge({ ...input, kind: 'authentication' });
    if (selected.error) return selected;
    const credential = this.passkeys.get(input.credentialId);
    if (!credential || credential.status !== 'active') return { error: AUTH_ERROR_CODES.PASSKEY_NOT_FOUND };
    if (Number(credential.counter || 0) !== Number(input.previousCounter || 0)) return { error: AUTH_ERROR_CODES.PASSKEY_INVALID };
    credential.counter = Math.max(Number(credential.counter || 0), Number(input.nextCounter || 0));
    credential.backupState = Boolean(input.backupState);
    credential.lastUsedAt = input.now;
    selected.challenge.state = 'consumed'; selected.challenge.challengeMac = ''; selected.challenge.consumedAt = input.now;
    for (const ticket of this.passkeyTickets.values()) if (ticket.credentialId === credential.credentialId && ticket.state === 'active') ticket.state = 'expired';
    this.passkeyTickets.set(input.ticketRef, {
      ticketRef: input.ticketRef,
      credentialId: credential.credentialId,
      userId: credential.userId,
      subjectRef: credential.subjectRef,
      deviceRef: input.deviceRef,
      state: 'active',
      createdAt: input.now,
      expiresAt: input.expiresAt
    });
    return { issued: true, refreshCipher: credential.refreshCipher, subjectRef: credential.subjectRef };
  }

  async completePasskeySession(input) {
    const ticket = this.passkeyTickets.get(input.ticketRef);
    if (!ticket || ticket.state !== 'active' || ticket.deviceRef !== input.deviceRef || ticket.subjectRef !== input.subjectRef) return { error: AUTH_ERROR_CODES.PASSKEY_INVALID };
    if (ticket.expiresAt <= input.now) { ticket.state = 'expired'; return { error: AUTH_ERROR_CODES.PASSKEY_INVALID }; }
    const user = this.users.get(ticket.userId);
    const identity = this.externalIdentities.get(`firebase:${input.subjectRef}`);
    if (!user || !identity || identity.userId !== user.id) return { error: AUTH_ERROR_CODES.ACCOUNT_CONFLICT };
    if (user.status !== 'active') return { error: AUTH_ERROR_CODES.ACCOUNT_DISABLED };
    if (user.emailRef !== input.emailRef) {
      const owner = this.usersByEmail.get(input.emailRef);
      if (owner && owner.id !== user.id) return { error: AUTH_ERROR_CODES.ACCOUNT_CONFLICT };
      this.usersByEmail.delete(user.emailRef);
      user.emailRef = input.emailRef;
      user.emailMask = input.emailMask;
      this.usersByEmail.set(input.emailRef, user);
    }
    const credential = this.passkeys.get(ticket.credentialId);
    if (!credential || credential.status !== 'active') return { error: AUTH_ERROR_CODES.PASSKEY_NOT_FOUND };
    ticket.state = 'consumed'; ticket.consumedAt = input.now;
    credential.refreshCipher = input.refreshCipher; credential.lastUsedAt = input.now;
    this.sessions.set(input.sessionRef, {
      sessionRef: input.sessionRef,
      userId: user.id,
      createdAt: input.now,
      expiresAt: input.sessionExpiresAt,
      lastSeenAt: input.now,
      revokedAt: null,
      ipRef: input.ipRef,
      deviceRef: input.deviceRef,
      userAgent: input.userAgent
    });
    user.lastLoginAt = input.now;
    return { established: true, user: copy(user) };
  }

  async getPasskeyStatus(input) {
    const session = this.#canonicalSession(input);
    if (session.error) return session;
    const credentials = [...this.passkeys.values()]
      .filter(row => row.userId === session.user.id && row.subjectRef === input.subjectRef && row.status === 'active')
      .map(row => ({ id: row.credentialId, createdAt: row.createdAt, lastUsedAt: row.lastUsedAt, synced: Boolean(row.backupEligible), backedUp: Boolean(row.backupState) }));
    return { count: credentials.length, credentials: copy(credentials) };
  }

  async removePasskey(input) {
    const session = this.#canonicalSession(input);
    if (session.error) return session;
    const credential = this.passkeys.get(input.credentialId);
    if (!credential || credential.userId !== session.user.id || credential.subjectRef !== input.subjectRef || credential.status !== 'active') return { error: AUTH_ERROR_CODES.PASSKEY_NOT_FOUND };
    credential.status = 'revoked'; credential.refreshCipher = ''; credential.revokedAt = input.now;
    for (const ticket of this.passkeyTickets.values()) if (ticket.credentialId === credential.credentialId && ticket.state === 'active') ticket.state = 'expired';
    const count = [...this.passkeys.values()].filter(row => row.userId === session.user.id && row.status === 'active').length;
    return { removed: true, credentialCount: count };
  }

  async getSession({ sessionRef, now }) {
    const session = this.sessions.get(sessionRef);
    if (!session || session.revokedAt || session.expiresAt <= now) return { error: AUTH_ERROR_CODES.SESSION_INVALID };
    const user = this.users.get(session.userId);
    if (!user) return { error: AUTH_ERROR_CODES.SESSION_INVALID };
    if (user.status !== 'active') return { error: AUTH_ERROR_CODES.ACCOUNT_DISABLED };
    if (now - session.lastSeenAt > 6 * 60 * 60 * 1000) session.lastSeenAt = now;
    return { expiresAt: session.expiresAt, createdAt: session.createdAt, user: copy(user) };
  }

  recordSecurityEvent({ eventType, subjectRef, userId, now, deviceRef, purpose, policyVersion }) {
    this.events.push({
      type: eventType, subjectRef, userId, at: now,
      deviceRef: deviceRef || null, purpose: purpose || null, policyVersion: policyVersion || null
    });
  }

  async revokeSession({ sessionRef, now }) {
    const session = this.sessions.get(sessionRef);
    if (!session || session.revokedAt) return { revoked: false };
    session.revokedAt = now;
    return { revoked: true };
  }

  async revokeUserSessions({ userId, now }) {
    if (!this.users.has(userId)) return { error: AUTH_ERROR_CODES.ACCOUNT_NOT_FOUND };
    let revoked = 0;
    for (const session of this.sessions.values()) {
      if (session.userId === userId && !session.revokedAt) {
        session.revokedAt = now;
        revoked += 1;
      }
    }
    this.events.push({ type: 'logout-all', userId, at: now });
    return { revoked };
  }

  async isDeviceTrusted({ userId, deviceRef, now }) {
    const row = this.trustedDevices.get(`${userId}|${deviceRef}`);
    return Object.freeze({ trusted: Boolean(row && !row.revokedAt && row.expiresAt > now) });
  }

  async registerTrustedDevice({ userId, deviceRef, browserClass, now, ttlMs, policyVersion, maxDevices }) {
    if (!this.users.has(userId)) return { error: AUTH_ERROR_CODES.ACCOUNT_NOT_FOUND };
    if (!deviceRef || deviceRef.length > 128) return { error: AUTH_ERROR_CODES.INVALID_INPUT };
    const expiresAt = this.#storeTrustedDevice({ userId, deviceRef, browserClass, now, ttlMs, policyVersion, maxDevices });
    return Object.freeze({ registered: true, expiresAt });
  }

  async revokeTrustedDevice({ userId, deviceRef, now, policyVersion }) {
    if (!this.users.has(userId)) return { error: AUTH_ERROR_CODES.ACCOUNT_NOT_FOUND };
    let revoked = 0;
    for (const row of this.trustedDevices.values()) {
      if (row.userId !== userId || row.revokedAt || row.expiresAt <= now) continue;
      if (deviceRef && row.deviceRef !== deviceRef) continue;
      row.revokedAt = now;
      revoked += 1;
    }
    if (revoked > 0) this.events.push({ type: 'device-revoked', userId, at: now, deviceRef: deviceRef || null, policyVersion });
    return Object.freeze({ revoked });
  }

  async listTrustedDevices({ userId, now }) {
    const rows = [...this.trustedDevices.values()]
      .filter(row => row.userId === userId && !row.revokedAt && row.expiresAt > now)
      .sort((a, b) => b.trustedAt - a.trustedAt)
      .map(row => ({ deviceRef: row.deviceRef, browserClass: row.browserClass, trustedAt: row.trustedAt, expiresAt: row.expiresAt }));
    return Object.freeze(rows.map(row => Object.freeze(row)));
  }

  async getLoginRiskSignals({ emailScope, emailWindowMs, ipScope, ipWindowMs, emailRef, ipRef, now }) {
    const emailStart = Math.floor(Number(now) / Number(emailWindowMs)) * Number(emailWindowMs);
    const ipStart = Math.floor(Number(now) / Number(ipWindowMs)) * Number(ipWindowMs);
    return Object.freeze({
      failedLogins: Number(this.rates.get(`${emailScope}:${emailRef}:${emailStart}`)?.count || 0),
      rapidRequests: Number(this.rates.get(`${ipScope}:${ipRef}:${ipStart}`)?.count || 0)
    });
  }

  createSecurityChallenge({ challengeRef, userId, purpose, method, maxAttempts, now, ttlMs, policyVersion, deviceRef }) {
    this.securityChallenges.set(challengeRef, {
      challengeRef, userId, purpose, method,
      status: 'created', attempts: 0, maxAttempts,
      attemptId: null, deviceRef, stepUpTokenMac: null,
      createdAt: now, expiresAt: now + Number(ttlMs),
      verifiedAt: null, consumedAt: null, policyVersion
    });
    this.events.push({ type: 'security-challenge-created', userId, at: now, deviceRef, purpose, policyVersion });
  }

  markSecurityChallengeSent({ challengeRef, attemptId, now }) {
    const row = this.securityChallenges.get(challengeRef);
    if (row && row.status === 'created') { row.status = 'sent'; row.attemptId = attemptId; }
  }

  getSecurityChallenge({ challengeRef, userId, now }) {
    const row = this.securityChallenges.get(challengeRef);
    if (!row || row.userId !== userId) return null;
    if (row.status === 'sent' && row.expiresAt <= now) { row.status = 'expired'; }
    return { ...row };
  }

  recordSecurityChallengeAttempt({ challengeRef, now }) {
    const row = this.securityChallenges.get(challengeRef);
    if (row) row.attempts += 1;
  }

  verifySecurityChallenge({ challengeRef, now, stepUpTokenMac }) {
    const row = this.securityChallenges.get(challengeRef);
    if (!row || row.status !== 'sent') return false;
    row.status = 'verified';
    row.verifiedAt = now;
    row.stepUpTokenMac = stepUpTokenMac;
    return true;
  }

  failSecurityChallenge({ challengeRef }) {
    const row = this.securityChallenges.get(challengeRef);
    if (row && row.status === 'sent') row.status = 'failed';
  }

  cancelSecurityChallenge({ challengeRef }) {
    const row = this.securityChallenges.get(challengeRef);
    if (row && ['created', 'sent'].includes(row.status)) row.status = 'cancelled';
  }

  consumeSecurityChallenge({ challengeRef, now }) {
    const row = this.securityChallenges.get(challengeRef);
    if (!row || row.status !== 'verified' || row.consumedAt != null) return false;
    row.consumedAt = now;
    return true;
  }

  latestVerifiedStepUpChallenge({ userId, now }) {
    const rows = [...this.securityChallenges.values()]
      .filter(row => row.userId === userId && row.purpose === 'step-up' && row.status === 'verified'
        && row.consumedAt == null && row.expiresAt > now)
      .sort((a, b) => (b.verifiedAt || 0) - (a.verifiedAt || 0));
    return rows.length ? { ...rows[0] } : null;
  }

  listSecurityChallenges({ userId, now }) {
    const rows = [...this.securityChallenges.values()]
      .filter(row => row.userId === userId && row.createdAt > now - (90 * 24 * 60 * 60 * 1000))
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 50);
    return Object.freeze(rows.map(row => Object.freeze({
      purpose: row.purpose, method: row.method, status: row.status,
      attempts: row.attempts, createdAt: row.createdAt, expiresAt: row.expiresAt,
      verifiedAt: row.verifiedAt, consumedAt: row.consumedAt, policyVersion: row.policyVersion
    })));
  }

  recentSecurityHistory({ userId, now, limit }) {
    const loginTypes = ['firebase-login', 'firebase-account-linked', 'login-trusted-device', 'firebase-passkey-login', 'new-device-challenge-completed'];
    const rows = [...this.sessions.values()]
      .filter(session => session.userId === userId)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, Math.min(Number(limit) || 10, 50));
    return Object.freeze(rows.map(session => {
      const event = [...this.events].reverse().find(candidate =>
        candidate.userId === userId
        && candidate.at === session.createdAt
        && loginTypes.includes(candidate.type)
        && (candidate.deviceRef == null ? session.deviceRef == null : candidate.deviceRef === session.deviceRef)
      );
      const type = event ? event.type : 'firebase-login';
      return Object.freeze({
        at: Number(session.createdAt),
        method: type === 'firebase-passkey-login' ? 'passkey' : 'credentials',
        browserClass: String(session.userAgent || 'unknown'),
        trusted: type === 'login-trusted-device',
        active: session.revokedAt == null
      });
    }));
  }

  securityEventCounts({ now, windowMs }) {
    const start = Number(now) - Number(windowMs);
    const counts = {};
    for (const event of this.events) if (event.at >= start) counts[event.type] = (counts[event.type] || 0) + 1;
    return Object.freeze({
      failedLogins: counts['login-failed'] || 0,
      challengesCreated: counts['security-challenge-created'] || 0,
      challengesVerified: counts['security-challenge-verified'] || 0,
      challengesFailed: counts['security-challenge-failed'] || 0,
      newDeviceLogins: counts['new-device-challenge-completed'] || 0,
      devicesRevoked: counts['device-revoked'] || 0,
      sessionsRevoked: counts['account-sessions-revoked'] || 0
    });
  }

  listSecurityEvents({ limit, before }) {
    const rows = this.events
      .filter(event => (before ? event.at < Number(before) : true))
      .sort((a, b) => b.at - a.at)
      .slice(0, limit)
      .map(event => Object.freeze({
        eventType: event.type,
        subjectRef: event.subjectRef || null,
        userId: event.userId || null,
        occurredAt: Number(event.at),
        deviceRef: event.deviceRef || null,
        purpose: event.purpose || null,
        policyVersion: event.policyVersion || null
      }));
    return Object.freeze({ entries: rows });
  }

  async identitySnapshot() {
    const users = [...this.users.values()]
      .filter(user => user && user.id)
      .map(user => Object.freeze({ id: user.id, status: user.status }));
    const externalIdentities = [...this.externalIdentities.values()]
      .filter(row => row && row.provider && row.subjectRef)
      .map(row => Object.freeze({ provider: row.provider, subjectRef: row.subjectRef, userId: row.userId }));
    return Object.freeze({ users: Object.freeze(users), externalIdentities: Object.freeze(externalIdentities) });
  }

  async listLinkedIdentities({ userId }) {
    const rows = [...this.externalIdentities.values()]
      .filter(row => row && row.userId === userId)
      .sort((a, b) => String(a.provider).localeCompare(String(b.provider)));
    return Object.freeze(rows.map(row => Object.freeze({
      provider: String(row.provider),
      linked: true,
      verified: Boolean(row.lastVerifiedAt),
      lastVerifiedAt: Number(row.lastVerifiedAt || 0),
      linkedAt: Number(row.createdAt || 0)
    })));
  }

  async getAccountState({ userId, now }) {
    if (!this.users.has(userId)) return { error: AUTH_ERROR_CODES.ACCOUNT_NOT_FOUND };
    const row = this.accountStates.get(userId);
    return Object.freeze({
      userId,
      status: row ? row.status : 'active',
      stateVersion: row ? row.stateVersion : 0,
      updatedAt: row ? row.updatedAt : 0,
      now: Number(now)
    });
  }

  async setAccountState({ userId, toStatus, now }) {
    if (!this.users.has(userId)) return { error: AUTH_ERROR_CODES.ACCOUNT_NOT_FOUND };
    const row = this.accountStates.get(userId);
    const currentStatus = row ? row.status : 'active';
    let target;
    try {
      target = transitionAccount(currentStatus, toStatus);
    } catch {
      return { error: AUTH_ERROR_CODES.ACCOUNT_STATE_INVALID };
    }
    if (target === currentStatus) {
      return Object.freeze({ userId, status: target, stateVersion: row ? row.stateVersion : 0, changed: false, revokedSessions: 0 });
    }
    const version = (row ? row.stateVersion : 0) + 1;
    this.accountStates.set(userId, { status: target, stateVersion: version, createdAt: row ? row.createdAt : now, updatedAt: now });
    let revoked = 0;
    if (!isSessionUsable(target)) {
      for (const session of this.sessions.values()) {
        if (session.userId === userId && !session.revokedAt) {
          session.revokedAt = now;
          revoked += 1;
        }
      }
      this.events.push({ type: 'account-sessions-revoked', userId, at: now });
    }
    this.events.push({ type: 'account-state-changed', userId, at: now });
    return Object.freeze({ userId, status: target, stateVersion: version, changed: true, revokedSessions: revoked });
  }

  async ping() {
    return { ok: true, storage: 'memory-test', schema: 4, users: this.users.size };
  }

  async cleanup(now) {
    for (const row of this.accountVerificationTickets.values()) {
      if (row.state === 'active' && row.expiresAt <= now) { row.state = 'expired'; row.refreshCipher = ''; }
    }
    for (const [id, row] of this.accountVerificationTickets) if (row.expiresAt < now - (24 * 60 * 60 * 1000)) this.accountVerificationTickets.delete(id);
    for (const [id, row] of this.passkeyChallenges) if (row.expiresAt <= now) this.passkeyChallenges.delete(id);
    for (const [id, row] of this.passkeyTickets) if (row.expiresAt <= now) this.passkeyTickets.delete(id);
    for (const [id, row] of this.sessions) if (row.expiresAt <= now || row.revokedAt) this.sessions.delete(id);
    for (const [id, row] of this.trustedDevices) if (row.expiresAt < now - (24 * 60 * 60 * 1000)) this.trustedDevices.delete(id);
    for (const [id, row] of this.securityChallenges) if (row.expiresAt < now - (24 * 60 * 60 * 1000)) this.securityChallenges.delete(id);
    for (const [id, row] of this.rates) if (row.resetAt <= now) this.rates.delete(id);
    return { cleaned: true };
  }

  async nextExpiry(now) {
    const values = [
      ...[...this.accountVerificationTickets.values()].filter(row => row.state === 'active' && row.expiresAt > now).map(row => row.expiresAt),
      ...[...this.passkeyChallenges.values()].filter(row => row.expiresAt > now).map(row => row.expiresAt),
      ...[...this.passkeyTickets.values()].filter(row => row.expiresAt > now).map(row => row.expiresAt),
      ...[...this.sessions.values()].filter(row => row.expiresAt > now && !row.revokedAt).map(row => row.expiresAt),
      ...[...this.rates.values()].filter(row => row.resetAt > now).map(row => row.resetAt)
    ];
    return values.length ? Math.min(...values) : null;
  }

  snapshot() {
    return copy({
      users: [...this.users.values()],
      externalIdentities: [...this.externalIdentities.values()],
      sessions: [...this.sessions.values()],
      rates: [...this.rates.entries()],
      events: this.events,
      passkeyHandles: [...this.passkeyHandles.entries()],
      passkeys: [...this.passkeys.values()],
      passkeyChallenges: [...this.passkeyChallenges.values()],
      passkeyTickets: [...this.passkeyTickets.values()],
      accountVerificationTickets: [...this.accountVerificationTickets.values()],
      profiles: [...this.profiles.entries()],
      trustedDevices: [...this.trustedDevices.values()],
      securityChallenges: [...this.securityChallenges.values()]
    });
  }
}
