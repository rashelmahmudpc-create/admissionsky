import { CloudflareNativeAuthEngine } from '../core/auth-engine.mjs';
import { asNativeAuthError, AUTH_ERROR_CODES, NativeAuthError } from '../core/errors.mjs';
import { reconcileIdentitySnapshot, summarizeIdentityHealth } from '../core/identity-reconciliation.mjs';
import { SqliteAuthRepository } from '../storage/sqlite-auth-repository.mjs';
import { VerificationOrchestrator } from '../verification/orchestrator.mjs';
import { createOtpDeliverySink } from '../../observability/otp-alert.mjs';
import { createConfiguredVerificationProviders } from '../verification/providers.mjs';
import { dispatchSecurityNotifications } from '../core/security-notifications.mjs';
import { SqliteVerificationRepository } from '../verification/sqlite-verification-repository.mjs';
import { D1ProfileStore } from '../storage/d1-profile-repository.mjs';
import { migrateStudentDirectory } from '../storage/student-directory-schema.mjs';
import { listStudents, studentProfile } from '../storage/student-admin-view.mjs';
import { wipeAll, wipeConfirmPhrase, wipeCounts } from '../storage/student-wipe.mjs';
import { normalizeAuthEmail } from '../core/crypto.mjs';
import { PendingSignupStore } from './pending-signup.mjs';
import { isTelegramLoginEmail, TELEGRAM_LOGIN_DOMAIN } from '../verification/telegram-login.mjs';
import { handlePendingSignupRoute, isPendingSignupRoute } from './pending-signup-authority.mjs';

const JSON_HEADERS = Object.freeze({
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store, max-age=0',
  Pragma: 'no-cache',
  'X-Content-Type-Options': 'nosniff'
});

const response = (status, body, extraHeaders = {}) => new Response(JSON.stringify(body), {
  status,
  headers: { ...JSON_HEADERS, ...extraHeaders }
});

async function readJson(request, maxBytes = 32_768) {
  const raw = await request.text();
  if (!raw || raw.length > maxBytes) throw new NativeAuthError(AUTH_ERROR_CODES.INVALID_INPUT);
  try { return JSON.parse(raw); } catch { throw new NativeAuthError(AUTH_ERROR_CODES.INVALID_INPUT); }
}

export class AdmissionAuthAuthority {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.ready = state.blockConcurrencyWhile(async () => {
      this.repository = new SqliteAuthRepository(state.storage);
      this.repository.migrate();
      this.verificationRepository = new SqliteVerificationRepository(state.storage);
      this.verificationRepository.migrate();
      // Fresh Start phase 2: additive, versioned student-directory schema.
      // Isolated so a problem here can never take sign-in down.
      try {
        this.studentDirectorySchema = migrateStudentDirectory(state.storage);
      } catch (error) {
        this.studentDirectorySchema = { version: 0, applied: [], error: String(error?.message || error).slice(0, 200) };
      }
      this.engine = new CloudflareNativeAuthEngine({
        repository: this.repository,
        hmacSecret: env.AUTH_HMAC_SECRET,
        securityConfigRaw: env.SECURITY_CONFIG_JSON,
        // Phase 7, avatar store (D1 binding PROFILE_DB; absent until the
        // binding is added at publish time, avatar routes degrade to 503).
        avatarStore: new D1ProfileStore(env.PROFILE_DB || null)
      });
      const persistedVerificationConfig = await this.verificationRepository.getRuntimeConfig();
      this.verification = new VerificationOrchestrator({
        repository: this.verificationRepository,
        hmacSecret: env.AUTH_HMAC_SECRET,
        config: persistedVerificationConfig || env.VERIFICATION_ORCHESTRATOR_CONFIG,
        providers: createConfiguredVerificationProviders(env),
        activated: ['canary', 'enabled'].includes(String(env.VERIFICATION_AUTH_ACTIVATION || '')),
        // AUTH-ROADMAP step 0: Workers Logs line per send + Telegram alert on failure / >30s.
        onDeliveryEvent: createOtpDeliverySink({ env, waitUntil: typeof state.waitUntil === 'function' ? promise => state.waitUntil(promise) : null })
      });
      // Phase 6, the engine's security challenges reuse this orchestrator
      // for email/Telegram delivery.
      this.engine.bindVerification(this.verification);
      // AUTH-ROADMAP step 1: account-less signup rows (DO KV, prefix psu:).
      try { this.pendingSignups = new PendingSignupStore({ storage: state.storage, hmacSecret: env.AUTH_HMAC_SECRET }); } catch { this.pendingSignups = null; }
      // Phase 6 Chunk 4, security notifications. Phase 6 ships DRY-RUN:
      // nothing is sent live unless the deployment explicitly enables it AND
      // a sender is configured (none is wired yet, so it stays inert).
      this.securityNotificationsDryRun = String(env.SECURITY_NOTIFICATIONS_ACTIVATION || 'dry-run') !== 'enabled';
      this.securityNotificationSender = null;
    });
  }

  // Fire-and-forget: a notification failure must never break the auth path.
  #dispatchSecurityEvents(events = []) {
    if (!events.length) return;
    try {
      void dispatchSecurityNotifications({
        events,
        dryRun: this.securityNotificationsDryRun !== false,
        sendSecurityEmail: this.securityNotificationSender
      }).catch(() => {});
    } catch (_) {
      // Never let notification bookkeeping break a security decision.
    }
  }

  async #scheduleExpiry() {
    const expiries = await Promise.all([this.engine.nextExpiry(), this.verification.nextExpiry(), this.pendingSignups?.nextExpiry() ?? null]);
    const next = expiries.filter(Boolean).sort((left, right) => left - right)[0] || null;
    if (!next) return;
    const scheduled = await this.state.storage.getAlarm();
    if (!scheduled || next < scheduled) await this.state.storage.setAlarm(next);
  }

  async #verificationIdentity(input = {}) {
    const session = await this.engine.getFirebaseSession(input.sessionToken, {
      email: input.email,
      subject: input.subject
    });
    return { ...input, userId: session.user.id };
  }

  async #preverificationIdentity(input = {}, context = {}, purpose = 'account-backup') {
    const material = await this.engine.getFirebaseAccountVerification(
      input.verificationTicket,
      input.email && input.subject ? { email: input.email, subject: input.subject } : {},
      context
    );
    // The greeting name is resolved server-side from the profile saved during
    // signup: the client cannot carry a Bengali name in a header, and a
    // client-supplied value is not trustworthy for the email body.
    const recipientName = purpose === 'email-ownership'
      ? (await this.engine.getFirebaseVerificationRecipientName(input.verificationTicket, context)).fullName
      : '';
    return {
      material,
      verificationInput: {
        purpose,
        trustedIdentity: {
          userId: material.userId,
          sessionRef: material.sessionRef,
          subjectRef: material.subjectRef,
          emailRef: material.emailRef,
          // Only the ownership purpose needs the address itself: it is the delivery
          // destination for the code. The worker takes it from the Firebase lookup
          // and getFirebaseAccountVerification has already checked it matches the
          // ticket, so it never arrives from client input.
          ...(purpose === 'email-ownership'
            ? { email: input.email, recipientName }
            : {})
        }
      }
    };
  }

  async fetch(request) {
    try {
      await this.ready;
      const url = new URL(request.url);
      if (request.method === 'GET' && url.pathname === '/internal/ping') {
        return response(200, { ok: true, ...(await this.engine.ping()) });
      }
      if (request.method !== 'POST') return response(405, { ok: false, error: { code: 'METHOD_NOT_ALLOWED' } }, { Allow: 'POST' });
      // Phase 7, avatar uploads are base64 JSON (≤ ~2.8 MB for 2 MB images).
      const body = await readJson(request, url.pathname === '/internal/avatar/save' ? 3_500_000 : 32_768);
      if (isPendingSignupRoute(url.pathname)) {
        const result = await handlePendingSignupRoute(this, url.pathname, body);
        await this.#scheduleExpiry();
        return response(200, { ok: true, result });
      }
      if (url.pathname === '/internal/firebase/rate') {
        const result = await this.engine.consumeFirebaseOperation(body.input, body.context);
        await this.#scheduleExpiry();
        return response(200, { ok: true, result });
      }
      if (url.pathname === '/internal/firebase/session/create') {
        const result = await this.engine.establishFirebaseSession(body.input, body.context);
        await this.#scheduleExpiry();
        // Phase 6 Chunk 4, a login the policy flags as a new device earns
        // the new-device-login notice (dry-run in Phase 6).
        if (result?.security?.trustOffer === true && result?.security?.trusted !== true && result?.user?.emailMasked) {
          this.#dispatchSecurityEvents([{
            eventType: 'new-device-login',
            emailMasked: result.user.emailMasked,
            browserClass: body.context?.userAgent || null
          }]);
        }
        return response(200, { ok: true, result });
      }
      if (url.pathname === '/internal/firebase/session/get') {
        const result = await this.engine.getFirebaseSession(body.sessionToken, body.input);
        return response(200, { ok: true, result });
      }
      if (url.pathname === '/internal/firebase/account-verification/begin') {
        const result = await this.engine.beginFirebaseAccountVerification(body.input, body.context);
        await this.#scheduleExpiry();
        return response(200, { ok: true, result });
      }
      if (url.pathname === '/internal/firebase/account-verification/material') {
        const result = await this.engine.getFirebaseAccountVerification(body.verificationTicket, body.input || {}, body.context);
        return response(200, { ok: true, result });
      }
      if (url.pathname === '/internal/firebase/account-verification/complete') {
        const result = await this.engine.completeFirebaseAccountVerification(body.input, body.context);
        await this.#scheduleExpiry();
        return response(200, { ok: true, result });
      }
      if (url.pathname === '/internal/profile/save-pending') {
        const result = await this.engine.savePendingProfile(body.verificationTicket, body.input, body.context);
        return response(200, { ok: true, result });
      }
      if (url.pathname === '/internal/profile/save') {
        const result = await this.engine.saveProfile(body.input, body.context);
        return response(200, { ok: true, result });
      }
      if (url.pathname === '/internal/profile/get') {
        const result = await this.engine.getProfile(body.input, body.context);
        return response(200, { ok: true, result });
      }
      // Phase 7, Profile & Personal Identity.
      if (url.pathname === '/internal/profile/get-v2') {
        const result = await this.engine.getProfileV2(body.input, body.context);
        return response(200, { ok: true, result });
      }
      if (url.pathname === '/internal/profile/patch') {
        const result = await this.engine.saveProfilePatch(body.input, body.context);
        return response(200, { ok: true, result });
      }
      if (url.pathname === '/internal/avatar/save') {
        const result = await this.engine.saveAvatar(body.input, body.context);
        return response(200, { ok: true, result });
      }
      if (url.pathname === '/internal/avatar/delete') {
        const result = await this.engine.deleteAvatar(body.input, body.context);
        return response(200, { ok: true, result });
      }
      if (url.pathname === '/internal/avatar/get') {
        const result = await this.engine.getAvatarData(body.input, body.context);
        return response(200, { ok: true, result });
      }
      if (url.pathname === '/internal/public-profile/get') {
        const result = await this.engine.getPublicProfile(body.input || {});
        return response(200, { ok: true, result });
      }
      if (url.pathname === '/internal/public-profile/avatar') {
        const result = await this.engine.getPublicAvatar(body.input || {});
        return response(200, { ok: true, result });
      }
      if (url.pathname === '/internal/account/state') {
        const session = await this.engine.getFirebaseSession(body.sessionToken, body.input);
        const state = await this.repository.getAccountState({ userId: session.user.id, now: Date.now() });
        if (state.error) throw new NativeAuthError(state.error);
        return response(200, { ok: true, account: state });
      }
      if (url.pathname === '/internal/account/identities') {
        const session = await this.engine.getFirebaseSession(body.sessionToken, body.input);
        const identities = await this.repository.listLinkedIdentities({ userId: session.user.id });
        return response(200, { ok: true, identities });
      }
      if (url.pathname === '/internal/account/state/set') {
        const result = await this.repository.setAccountState({
          userId: String(body?.userId || '').slice(0, 256),
          toStatus: String(body?.status || ''),
          now: Date.now()
        });
        if (result.error) throw new NativeAuthError(result.error);
        await this.#scheduleExpiry();
        return response(200, { ok: true, account: result });
      }
      if (url.pathname === '/internal/identity/health') {
        const snapshot = await this.repository.identitySnapshot();
        const health = summarizeIdentityHealth(reconcileIdentitySnapshot(snapshot));
        return response(200, { ok: true, health });
      }
      if (url.pathname === '/internal/passkey/registration/begin') {
        const result = await this.engine.beginPasskeyRegistration(body.input, body.context);
        await this.#scheduleExpiry();
        return response(200, { ok: true, result });
      }
      if (url.pathname === '/internal/passkey/registration/finish') {
        const result = await this.engine.finishPasskeyRegistration(body.input, body.context);
        await this.#scheduleExpiry();
        return response(200, { ok: true, result });
      }
      if (url.pathname === '/internal/passkey/authentication/begin') {
        const result = await this.engine.beginPasskeyAuthentication(body.context);
        await this.#scheduleExpiry();
        return response(200, { ok: true, result });
      }
      if (url.pathname === '/internal/passkey/authentication/finish') {
        const result = await this.engine.finishPasskeyAuthentication(body.input, body.context);
        await this.#scheduleExpiry();
        return response(200, { ok: true, result });
      }
      if (url.pathname === '/internal/passkey/session/complete') {
        const result = await this.engine.completePasskeySession(body.input, body.context);
        await this.#scheduleExpiry();
        return response(200, { ok: true, result });
      }
      if (url.pathname === '/internal/passkey/status') {
        const result = await this.engine.getPasskeyStatus(body.input, body.context);
        return response(200, { ok: true, result });
      }
      if (url.pathname === '/internal/passkey/remove') {
        const result = await this.engine.removePasskey(body.input, body.context);
        return response(200, { ok: true, result });
      }
      if (url.pathname === '/internal/verification/capabilities') {
        const result = await this.verification.capabilities();
        return response(200, { ok: true, result });
      }
      if (url.pathname === '/internal/verification/request') {
        const input = await this.#verificationIdentity(body.input);
        const result = await this.verification.requestVerification(input, body.context);
        await this.#scheduleExpiry();
        return response(200, { ok: true, result });
      }
      if (url.pathname === '/internal/verification/preauth/request') {
        const prepared = await this.#preverificationIdentity(body.input, body.context);
        const result = await this.verification.requestVerification(prepared.verificationInput, body.context);
        await this.#scheduleExpiry();
        return response(200, { ok: true, result });
      }
      if (url.pathname === '/internal/verification/preauth/pending') {
        const prepared = await this.#preverificationIdentity(body.input, body.context);
        const result = await this.verification.pendingVerification(prepared.verificationInput, body.context);
        return response(200, { ok: true, result });
      }
      if (url.pathname === '/internal/verification/preauth/verify') {
        const prepared = await this.#preverificationIdentity(body.input, body.context);
        const result = await this.verification.verify({
          ...prepared.verificationInput,
          attemptId: body.input.attemptId,
          code: body.input.code
        }, body.context);
        await this.#scheduleExpiry();
        return response(200, { ok: true, result });
      }
      // Email-ownership runs on the pre-verification ticket too, because the point
      // is to prove the address before Firebase's own emailVerified flag exists.
      // The only difference from the Telegram pair is the purpose and the address.
      if (url.pathname === '/internal/verification/ownership/request') {
        const prepared = await this.#preverificationIdentity(body.input, body.context, 'email-ownership');
        const deliveryMethod = body.input?.deliveryMethod === 'magic-link' ? { deliveryMethod: 'magic-link' } : {};
        const result = await this.verification.requestVerification({ ...prepared.verificationInput, ...deliveryMethod }, body.context);
        await this.#scheduleExpiry();
        return response(200, { ok: true, result });
      }
      if (url.pathname === '/internal/verification/ownership/verify') {
        const prepared = await this.#preverificationIdentity(body.input, body.context, 'email-ownership');
        const result = await this.verification.verify({
          ...prepared.verificationInput,
          attemptId: body.input.attemptId,
          code: body.input.code
        }, body.context);
        await this.#scheduleExpiry();
        return response(200, { ok: true, result });
      }
      if (url.pathname === '/internal/verification/ownership/status') {
        const identity = await this.engine.getFirebaseIdentity(body.input, body.context);
        // A status read proves nothing and sends nothing, so it uses the session
        // purpose: the ownership purpose would demand a delivery address that a
        // plain session query does not have. The flag itself is keyed by the
        // user and subject, which is all this check needs.
        const result = await this.verification.isEmailOwnershipProven({
          purpose: 'account-backup',
          trustedIdentity: {
            userId: identity.userId,
            sessionRef: identity.subjectRef,
            subjectRef: identity.subjectRef,
            emailRef: identity.emailRef
          }
        }, body.context);
        return response(200, { ok: true, result });
      }
      // F-04 phase 3: the split-out auth Worker cannot hold AUTH_HMAC_SECRET —
      // a Cloudflare secret is write-only, and re-issuing it would change every
      // derived Telegram address and orphan those accounts. So the derivation
      // stays with the secret, and the front asks instead of guessing.
      if (url.pathname === '/internal/telegram/login-email') {
        const email = String(body?.email || '').trim().toLowerCase();
        const loginAccount = email.endsWith(`@${TELEGRAM_LOGIN_DOMAIN}`)
          && await isTelegramLoginEmail(email, this.env);
        return response(200, { ok: true, result: { loginAccount } });
      }
      if (url.pathname === '/internal/verification/telegram/status') {
        const identity = await this.engine.getFirebaseIdentity(body.input, body.context);
        const result = await this.verification.isTelegramLinked({
          purpose: 'account-backup',
          trustedIdentity: {
            userId: identity.userId,
            sessionRef: identity.subjectRef,
            subjectRef: identity.subjectRef,
            emailRef: identity.emailRef
          }
        }, body.context);
        return response(200, { ok: true, result });
      }
      if (url.pathname === '/internal/verification/verify') {
        const input = await this.#verificationIdentity(body.input);
        const result = await this.verification.verify(input, body.context);
        await this.#scheduleExpiry();
        return response(200, { ok: true, result });
      }
      if (url.pathname === '/internal/verification/telegram/webhook') {
        const result = await this.verification.confirmTelegramWebhook(body.input);
        await this.#scheduleExpiry();
        return response(200, { ok: true, result });
      }
      if (url.pathname === '/internal/verification/telegram/activate') {
        if (!['canary', 'enabled'].includes(this.env.VERIFICATION_AUTH_ACTIVATION)) throw new NativeAuthError(AUTH_ERROR_CODES.BACKUP_UNAVAILABLE);
        await this.verification.updateConfig(this.env.VERIFICATION_ORCHESTRATOR_CONFIG);
        const result = await this.verification.configureTelegramWebhook();
        return response(200, { ok: true, result });
      }
      if (url.pathname === '/internal/verification/telegram/deactivate') {
        if (!['canary', 'enabled'].includes(this.env.VERIFICATION_AUTH_ACTIVATION)) throw new NativeAuthError(AUTH_ERROR_CODES.BACKUP_UNAVAILABLE);
        const result = await this.verification.removeTelegramWebhook();
        return response(200, { ok: true, result });
      }
      if (url.pathname === '/internal/verification/admin/status') {
        const result = await this.verification.adminStatus();
        return response(200, { ok: true, result });
      }
      if (url.pathname === '/internal/verification/admin/config') {
        const result = await this.verification.updateConfig(body.config);
        await this.#scheduleExpiry();
        return response(200, { ok: true, result });
      }
      if (url.pathname === '/internal/session/get') {
        const result = await this.engine.getSession(body.sessionToken);
        return response(200, { ok: true, result });
      }
      if (url.pathname === '/internal/session/revoke') {
        const result = await this.engine.revokeSession(body.sessionToken);
        return response(200, { ok: true, result });
      }
      if (url.pathname === '/internal/session/revoke-all') {
        // Phase 6, step-up-gated: the engine enforces recent-session or a
        // verified step-up challenge before any session is revoked.
        const result = await this.engine.revokeAllSessions({ ...(body.input || {}), sessionToken: body.sessionToken }, body.context);
        // A step-up token proves the policy demanded a fresh verification -
        // that is the suspicious-activity signal worth a notice.
        if (result?.emailMasked && String(body.input?.stepUpToken || '')) {
          this.#dispatchSecurityEvents([{
            eventType: 'suspicious-activity',
            emailMasked: result.emailMasked,
            browserClass: result.browserClass || null
          }]);
        }
        return response(200, { ok: true, result });
      }
      // Phase 6, device trust + security state (internal; the public
      // /security/* surface lands with its own auth+shape in Chunk 4).
      if (url.pathname === '/internal/firebase/login/failure') {
        const result = await this.engine.recordLoginFailure(body.input, body.context);
        return response(200, { ok: true, result });
      }
      if (url.pathname === '/internal/security/device/trust') {
        const result = await this.engine.trustCurrentDevice(body.input, body.context);
        await this.#scheduleExpiry();
        return response(200, { ok: true, result });
      }
      if (url.pathname === '/internal/security/device/revoke') {
        const result = await this.engine.revokeTrustedDevice(body.input, body.context);
        await this.#scheduleExpiry();
        return response(200, { ok: true, result });
      }
      if (url.pathname === '/internal/security/state') {
        const result = await this.engine.getSecurityState(body.input, body.context);
        return response(200, { ok: true, result });
      }
      // Phase 6, purpose-bound security challenges (§11-§12).
      if (url.pathname === '/internal/security/challenge/request') {
        const result = await this.engine.requestChallenge(body.input, body.context);
        return response(200, { ok: true, result });
      }
      if (url.pathname === '/internal/security/challenge/verify') {
        const result = await this.engine.verifyChallenge(body.input, body.context);
        if (result?.emailMasked) {
          this.#dispatchSecurityEvents([{
            eventType: 'suspicious-activity',
            emailMasked: result.emailMasked,
            browserClass: result.browserClass || null
          }]);
        }
        return response(200, { ok: true, result });
      }
      if (url.pathname === '/internal/security/challenge/cancel') {
        const result = await this.engine.cancelChallenge(body.input, body.context);
        return response(200, { ok: true, result });
      }
      // Phase 6 Chunk 4, user-facing security history (privacy boundary:
      // method + coarse browser class + time; no IP, no location).
      if (url.pathname === '/internal/security/history') {
        const result = await this.engine.securityHistory(body.input, body.context);
        return response(200, { ok: true, result });
      }
      // Phase 6 Chunk 4, admin security surface (token-gated in the public
      // handler; refs only, no PII).
      if (url.pathname === '/internal/admin/security/health') {
        const result = await this.engine.securityHealth();
        return response(200, { ok: true, result });
      }
      // Fresh Start phase 3, Control Center Students (read-only; token-gated
      // in the public handler; masked email, short refs, no secrets).
      if (url.pathname === '/internal/admin/students/list') {
        const input = body.input || {};
        const q = String(input.q || '').trim().slice(0, 254);
        let emailRef = null;
        let text = null;
        if (q.includes('@')) {
          try { emailRef = await this.engine.hmac.hex('email-ref-v1', normalizeAuthEmail(q)); } catch { emailRef = 'no-match'; }
        } else if (q) {
          text = q;
        }
        const result = listStudents(this.state.storage.sql, { limit: input.limit, before: input.before, emailRef, text, now: Date.now() });
        return response(200, { ok: true, result });
      }
      if (url.pathname === '/internal/admin/students/get') {
        const profile = studentProfile(this.state.storage.sql, String(body.input?.userId || ''), { now: Date.now() });
        return response(200, { ok: true, result: profile ? { found: true, student: profile } : { found: false } });
      }
      // Fresh Start phase 4, wipe all users (token-gated in the public
      // handler). Dry run by default; the real wipe needs the exact phrase
      // WIPE-ALL-<users> for the count the dry run just returned.
      if (url.pathname === '/internal/admin/students/wipe') {
        const input = body.input || {};
        const sql = this.state.storage.sql;
        const before = wipeCounts(sql);
        const expected = wipeConfirmPhrase(before.users);
        if (input.dryRun !== false) return response(200, { ok: true, result: { dryRun: true, confirmPhrase: expected, ...before } });
        if (String(input.confirm || '') !== expected) {
          return response(409, { ok: false, error: { code: 'WIPE_CONFIRM_MISMATCH', message: 'Confirm phrase does not match the current user count.', users: before.users } });
        }
        const outcome = wipeAll(sql);
        return response(200, { ok: true, result: { dryRun: false, before, outcome, after: wipeCounts(sql) } });
      }
      if (url.pathname === '/internal/admin/security/events') {
        const result = await this.engine.securityEventsPage(body.input || {});
        return response(200, { ok: true, result });
      }
      return response(404, { ok: false, error: { code: 'NOT_FOUND' } });
    } catch (cause) {
      const error = asNativeAuthError(cause);
      return response(error.status, { ok: false, error: error.toPublic() }, error.retryAfter ? { 'Retry-After': String(error.retryAfter) } : {});
    }
  }

  async alarm() {
    try {
      await this.ready;
      await Promise.all([this.engine.cleanup(), this.verification.cleanup(), this.pendingSignups?.cleanup()]);
      const expiries = await Promise.all([this.engine.nextExpiry(), this.verification.nextExpiry(), this.pendingSignups?.nextExpiry() ?? null]);
      const next = expiries.filter(Boolean).sort((left, right) => left - right)[0] || null;
      if (next) await this.state.storage.setAlarm(next);
    } catch {
      await this.state.storage.setAlarm(Date.now() + 60 * 60 * 1000);
    }
  }
}
