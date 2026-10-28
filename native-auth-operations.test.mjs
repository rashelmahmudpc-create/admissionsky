import test from 'node:test';
import assert from 'node:assert/strict';
import {
  discoverActiveMailjetSender,
  prepareProductionSecrets,
  productionEmailGatewayConfig
} from './auth-native/operations/prepare-production-secrets.mjs';
import { auditRecentMailjetDelivery } from './auth-native/operations/audit-mailjet-recent-delivery.mjs';
import { FirebaseConfigError, validateFirebaseProjectConfig, verifyFirebaseConfig } from './auth-native/operations/verify-firebase-config.mjs';
import { GoogleReadinessError, verifyGoogleReadiness } from './auth-native/operations/verify-google-readiness.mjs';
import { classifyGoogleBrowserPage } from './auth-native/operations/verify-google-browser-origin.mjs';
import { summarizeTelegramBindings } from './auth-native/operations/verify-telegram-bindings.mjs';
import { auditVerificationMessage, liveAuthMethodsReady, verificationAction } from './auth-native/operations/live-mailbox-e2e.mjs';
import { summarizePlacementReport } from './auth-native/operations/live-placement-audit.mjs';
import { FirebaseEmailPasswordProvider } from './auth-native/providers/firebase-auth.mjs';
import { verifyFirebaseWorkerBinding } from './auth-native/operations/verify-worker-binding.mjs';
import { setAgentMailDisplayName } from './auth-native/operations/set-agentmail-display-name.mjs';

const ENV = Object.freeze({
  MAILJET_API_KEY: 'mailjet-test-key',
  MAILJET_SECRET_KEY: 'mailjet-test-secret',
  MAILJET_FROM_ADDRESS: 'stale@admissionhub.pages.dev',
  CLOUDFLARE_ACCOUNT_ID: 'account-test',
  CLOUDFLARE_API_TOKEN: 'cloudflare-test-token'
});

const response = body => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });

const fetchFixture = ({ existing = [] } = {}) => async (url, options) => {
  if (String(url).includes('/v3/REST/sender')) {
    assert.match(String(options?.headers?.Authorization), /^Basic /);
    return response({ Data: [
      { Email: 'stale@admissionhub.pages.dev', Name: 'Pending', Status: 'Pending' },
      { Email: 'active.sender@example.com', Name: 'Admission Hub', Status: 'Active', IsDefaultSender: true }
    ] });
  }
  if (String(url).includes('/workers/scripts/admission-gk/secrets')) {
    assert.equal(options?.headers?.Authorization, 'Bearer cloudflare-test-token');
    return response({ success: true, result: existing.map(name => ({ name, type: 'secret_text' })) });
  }
  return new Response('not found', { status: 404 });
};

test('activation privately selects an Active Mailjet sender instead of stale Pending source', async () => {
  const sender = await discoverActiveMailjetSender({ env: ENV, fetchImpl: fetchFixture() });
  assert.equal(sender.address, 'active.sender@example.com');
  assert.equal(sender.name, 'Admission Hub');
  assert.equal(sender.apiBase, 'https://api.mailjet.com');
});

test('activation accepts an enabled account-wide MetaSender when the API-key sender list is Pending', async () => {
  const fetchImpl = async url => {
    if (String(url).includes('/v3/REST/metasender')) {
      return response({ Data: [
        { Email: '*@domain.example', IsEnabled: true },
        { Email: 'pretend@admissionhub.pages.dev', IsEnabled: true },
        { Email: 'shared.active@example.com', IsEnabled: true }
      ] });
    }
    if (String(url).includes('/v3/REST/sender')) return response({ Data: [{ Email: 'pending@example.com', Status: 'Pending' }] });
    return new Response('not found', { status: 404 });
  };
  const sender = await discoverActiveMailjetSender({ env: ENV, fetchImpl });
  assert.equal(sender.address, 'shared.active@example.com');
});

test('activation can discover an Active sender on an authorized Mailjet sub-account without printing credentials', async () => {
  const childKey = 'child-mailjet-api-key';
  const childSecret = 'child-mailjet-secret-key';
  const childAuthorization = `Basic ${Buffer.from(`${childKey}:${childSecret}`, 'utf8').toString('base64')}`;
  const fetchImpl = async (url, options = {}) => {
    const target = String(url);
    if (target.includes('/v3/REST/apikey')) return response({ Data: [{ APIKey: childKey, SecretKey: childSecret, IsActive: true }] });
    if (target.includes('/v3/REST/metasender')) return response({ Data: [] });
    if (target.includes('/v3/REST/sender')) {
      return options?.headers?.Authorization === childAuthorization
        ? response({ Data: [{ Email: 'subaccount.active@example.com', Status: 'Active' }] })
        : response({ Data: [{ Email: 'pending@example.com', Status: 'Pending' }] });
    }
    return new Response('not found', { status: 404 });
  };
  const sender = await discoverActiveMailjetSender({ env: ENV, fetchImpl });
  assert.equal(sender.address, 'subaccount.active@example.com');
  assert.equal(sender.apiKey, childKey);
  assert.equal(sender.secretKey, childSecret);
});

test('activation may validate a candidate with Mailjet SandboxMode but never treats it as delivery proof', async () => {
  let sandboxPayload = null;
  const fetchImpl = async (url, options = {}) => {
    const target = String(url);
    if (target.includes('/v3/REST/sender') || target.includes('/v3/REST/metasender')) return response({ Data: [] });
    if (target.includes('/v3/REST/apikey')) return response({ Data: [] });
    if (target.endsWith('/v3.1/send')) {
      sandboxPayload = JSON.parse(options.body);
      return response({ Messages: [{ Status: 'success', To: [] }] });
    }
    return new Response('not found', { status: 404 });
  };
  await assert.rejects(discoverActiveMailjetSender({
    env: ENV, fetchImpl, senderCandidates: ['owner.sender@example.org']
  }), /SandboxMode validated a payload, but no API-listed Active individual sender/i);
  assert.equal(sandboxPayload.SandboxMode, true);
  assert.equal(sandboxPayload.Messages.length, 1);
  assert.equal(sandboxPayload.Messages[0].From.Email, 'owner.sender@example.org');
});

test('recent Mailjet delivery audit is GET-only and returns status counts without addresses', async () => {
  const now = Date.parse('2026-09-09T14:00:00Z');
  const captures = [];
  const result = await auditRecentMailjetDelivery({
    env: ENV,
    now,
    fetchImpl: async (url, options) => {
      captures.push({ url: String(url), options });
      if (String(url).includes('/statcounters')) return response({ Data: [{
        MessageSentCount: '2', MessageQueuedCount: '3', MessageBlockedCount: '4',
        MessageDeferredCount: '5', MessageHardBouncedCount: '6', MessageSoftBouncedCount: '7'
      }] });
      return response({ Data: [
        { ArrivedAt: '2026-09-09T13:50:00Z', Status: 'queued', ContactAlt: 'private-one@example.org' },
        { ArrivedAt: '2026-09-09T13:51:00Z', Status: 'blocked', ContactAlt: 'private-two@example.org' },
        { ArrivedAt: '2026-09-09T13:52:00Z', Status: 'sent', ContactAlt: 'private-three@example.org' },
        { ArrivedAt: '2026-09-08T13:52:00Z', Status: 'sent', ContactAlt: 'old@example.org' }
      ] });
    }
  });
  assert.deepEqual(result, {
    recent: 3, credentialSetsInspected: 1, counterQueriesSucceeded: 1,
    delivered: 1, queued: 1, blocked: 1, bounced: 0, retrying: 0, other: 0,
    counterSent: 2, counterQueued: 3, counterBlocked: 4,
    counterDeferred: 5, counterHardBounced: 6, counterSoftBounced: 7
  });
  assert.ok(captures.every(capture => capture.options.method === 'GET' && capture.options.body === undefined));
  assert.ok(captures.some(capture => /ShowContactAlt=false/.test(capture.url)));
  assert.ok(captures.every(capture => !/example\.org/.test(capture.url)));
});

test('recent Mailjet delivery audit searches bounded authorized sub-account keys when the root has no records', async () => {
  const childKey = 'child-audit-api-key';
  const childSecret = 'child-audit-secret-key';
  const childAuthorization = `Basic ${Buffer.from(`${childKey}:${childSecret}`).toString('base64')}`;
  const captures = [];
  const result = await auditRecentMailjetDelivery({
    env: ENV,
    now: Date.parse('2026-09-09T14:00:00Z'),
    fetchImpl: async (url, options) => {
      captures.push({ url: String(url), options });
      if (String(url).includes('/apikey')) return response({ Data: [
        { APIKey: childKey, SecretKey: childSecret, IsActive: true }
      ] });
      if (options.headers.Authorization === childAuthorization) return response({ Data: [
        { ArrivedAt: '2026-09-09T13:55:00Z', Status: 'blocked', ContactAlt: 'private@example.org' }
      ] });
      return response({ Data: [] });
    }
  });
  assert.equal(result.recent, 1);
  assert.equal(result.blocked, 1);
  assert.equal(result.credentialSetsInspected, 2);
  assert.ok(captures.every(capture => capture.options.method === 'GET' && capture.options.body === undefined));
  assert.ok(captures.every(capture => !capture.url.includes('private@example.org')));
});

test('activation config enables only Mailjet and caps free quota at 200/day and 6000/month', () => {
  const config = productionEmailGatewayConfig();
  assert.equal(config.environment, 'production');
  assert.equal(config.router.maxProviderAttempts, 1);
  assert.equal(config.router.emergencyMaxAttempts, 0);
  for (const [provider, policy] of Object.entries(config.providerPolicies)) {
    assert.equal(policy.enabled, provider === 'mailjet', provider);
    assert.equal(policy.dailyLimit, provider === 'mailjet' ? 200 : 0, provider);
    assert.equal(policy.monthlyLimit, provider === 'mailjet' ? 6000 : 0, provider);
    assert.equal(policy.emergency, false, provider);
  }
});

test('activation creates missing persistent HMAC/internal secrets without replacing existing names', async () => {
  let sequence = 0;
  const generated = await prepareProductionSecrets({
    env: ENV,
    fetchImpl: fetchFixture({ existing: ['EMAIL_INTERNAL_SECRET'] }),
    randomSecret: () => `generated-${++sequence}-${'x'.repeat(40)}`
  });
  assert.deepEqual(generated.reused, ['EMAIL_INTERNAL_SECRET']);
  assert.deepEqual(generated.generated, ['AUTH_HMAC_SECRET', 'EMAIL_PRIVATE_PEPPER']);
  assert.equal('EMAIL_INTERNAL_SECRET' in generated.secrets, false);
  assert.match(generated.secrets.AUTH_HMAC_SECRET, /^generated-1-/);
  assert.match(generated.secrets.EMAIL_PRIVATE_PEPPER, /^generated-2-/);
  assert.equal(generated.secrets.MAILJET_FROM_ADDRESS, 'active.sender@example.com');
  assert.equal(generated.secrets.MAILJET_SENDER_VERIFIED, 'true');
  assert.equal(generated.secrets.MAILJET_SANDBOX_SENDER_VERIFIED, 'false');
  assert.equal(generated.secrets.EMAIL_PROVIDER_ACTIVATION, 'enabled');
  const config = JSON.parse(generated.secrets.EMAIL_GATEWAY_CONFIG);
  assert.equal(config.providerPolicies.mailjet.dailyLimit, 200);
});

test('activation refuses to proceed when no Active Mailjet sender exists', async () => {
  const fetchImpl = async url => String(url).includes('/v3/REST/sender')
    ? response({ Data: [{ Email: 'pending@example.com', Status: 'Pending' }] })
    : response({ success: true, result: [] });
  await assert.rejects(() => prepareProductionSecrets({ env: ENV, fetchImpl }), /no Active individual sender/i);
});

test('Firebase provider binds platform fetch to the global runtime receiver', async () => {
  let receiver = null;
  const strictPlatformFetch = async function (url, options) {
    receiver = this;
    if (this !== globalThis) throw new TypeError('Illegal invocation');
    assert.match(String(url), /^https:\/\/identitytoolkit\.googleapis\.com\/v1\/projects\?key=/);
    assert.equal(options.method, 'GET');
    assert.equal(options.redirect, 'manual');
    return response({ projectId: 'admission-hub-test', authorizedDomains: ['admissionhub.pages.dev'] });
  };
  const provider = new FirebaseEmailPasswordProvider({
    apiKey: 'firebase-test-api-key-123456789',
    continueUrl: 'https://admissionhub.pages.dev/?firebaseVerified=1',
    fetchImpl: strictPlatformFetch
  });
  assert.deepEqual(await provider.inspectProject(), {
    projectIdentified: true,
    continueDomainAuthorized: true,
    google: { enabled: false, clientId: '' },
    facebook: { enabled: false, clientId: '' }
  });
  assert.equal(receiver, globalThis);
});

test('Firebase activation preflight validates project identity and authorized Pages domain without mutation', async () => {
  let request = null;
  const result = await verifyFirebaseConfig({
    apiKey: 'firebase-test-api-key-123456789',
    fetchImpl: async (url, options) => {
      request = { url: String(url), options };
      return response({ projectId: 'admission-hub-test', authorizedDomains: ['localhost', 'admissionhub.pages.dev'] });
    }
  });
  assert.equal(result.projectIdentified, true);
  assert.equal(result.authorizedDomainReady, true);
  assert.deepEqual(result.authorizedLiveDomains, ['admissionhub.pages.dev']);
  assert.deepEqual(result.missingLiveDomains, ['admissionsky.pages.dev']);
  assert.match(request.url, /^https:\/\/identitytoolkit\.googleapis\.com\/v1\/projects\?key=/);
  assert.equal(request.options.method, 'GET');
  assert.equal(request.options.body, undefined);
});

test('Firebase activation preflight passes when only the short live origin is authorized', () => {
  // The owner's public address is admissionsky.pages.dev. A project that lists
  // only that one is not broken for students, and this gate used to fail on it.
  const result = validateFirebaseProjectConfig({ projectId: 'admissionsky-997d2', authorizedDomains: ['localhost', 'admissionsky.pages.dev'] });
  assert.equal(result.projectIdentified, true);
  assert.deepEqual(result.authorizedLiveDomains, ['admissionsky.pages.dev']);
  assert.deepEqual(result.missingLiveDomains, ['admissionhub.pages.dev']);
});

test('Firebase activation preflight rejects a project without the Pages authorized domain', async () => {
  assert.throws(
    () => validateFirebaseProjectConfig({ projectId: 'admission-hub-test', authorizedDomains: ['localhost'] }),
    error => error instanceof FirebaseConfigError && error.code === 'PAGES_DOMAIN_NOT_AUTHORIZED'
  );
});

test('Google readiness audit accepts an enabled Firebase project config without printing or exchanging credentials', async () => {
  const calls = [];
  const result = await verifyGoogleReadiness({
    apiKey: 'firebase-test-api-key-123456789',
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options });
      const parsed = new URL(url);
      if (parsed.pathname.endsWith('/projects')) {
        return response({
          projectId: 'admission-hub-test',
          authorizedDomains: ['admissionhub.pages.dev'],
          idpConfig: [{
            provider: 'google.com',
            enabled: true,
            clientId: '123456789012-readinessclient.apps.googleusercontent.com'
          }]
        });
      }
      if (parsed.hostname === 'accounts.google.com') {
        return new Response(null, { status: 302, headers: { Location: 'https://accounts.google.com/v3/signin/identifier' } });
      }
      const body = JSON.parse(options.body);
      return response({
        providerId: 'google.com',
        sessionId: body.sessionId,
        authUri: 'https://accounts.google.com/o/oauth2/v2/auth?client_id=123456789012-readinessclient.apps.googleusercontent.com&response_type=code&redirect_uri=https%3A%2F%2Fadmission-hub-auth.firebaseapp.com%2F__%2Fauth%2Fhandler'
      });
    }
  });
  assert.deepEqual(result, {
    ready: true,
    provider: 'google.com',
    clientIdValidated: true,
    source: 'project-config',
    redirectSessionBound: true,
    redirectResponseMode: 'code',
    redirectCallbackKind: 'firebase-handler',
    authorizationRequestAccepted: true
  });
  assert.equal(calls.length, 3);
  assert.equal(calls[0].options.method, 'GET');
  assert.equal(calls[0].options.redirect, 'manual');
  const redirectProbe = JSON.parse(calls[1].options.body);
  assert.equal(redirectProbe.authFlowType, 'CODE_FLOW');
  assert.match(redirectProbe.sessionId, /^readiness-/);
  assert.equal(/id_token|access_token|password/i.test(calls[1].options.body), false);
});

test('Google readiness audit may validate Firebase createAuthUri but never signs in or creates an account', async () => {
  const paths = [];
  const result = await verifyGoogleReadiness({
    apiKey: 'firebase-test-api-key-123456789',
    fetchImpl: async (url, options) => {
      const parsed = new URL(url);
      const bodyText = String(options.body || '');
      paths.push({ path: parsed.pathname, method: options.method, body: bodyText });
      if (parsed.pathname.endsWith('/projects')) {
        return response({ projectId: 'admission-hub-test', authorizedDomains: ['admissionhub.pages.dev'] });
      }
      if (parsed.hostname === 'accounts.google.com') {
        return new Response(null, { status: 302, headers: { Location: 'https://accounts.google.com/v3/signin/identifier' } });
      }
      const body = JSON.parse(bodyText);
      if (body.authFlowType === 'CODE_FLOW') {
        return response({
          providerId: 'google.com',
          sessionId: body.sessionId,
          authUri: 'https://accounts.google.com/o/oauth2/v2/auth?client_id=123456789012-readinessclient.apps.googleusercontent.com&response_type=code&redirect_uri=https%3A%2F%2Fadmission-hub-auth.firebaseapp.com%2F__%2Fauth%2Fhandler'
        });
      }
      return response({
        providerId: 'google.com',
        sessionId: `provider-session-${'x'.repeat(32)}`,
        authUri: 'https://accounts.google.com/o/oauth2/v2/auth?client_id=123456789012-readinessclient.apps.googleusercontent.com'
      });
    }
  });
  assert.equal(result.ready, true);
  assert.equal(result.source, 'firebase-auth-uri');
  assert.equal(result.redirectSessionBound, true);
  assert.equal(result.redirectResponseMode, 'code');
  assert.equal(result.redirectCallbackKind, 'firebase-handler');
  assert.equal(result.authorizationRequestAccepted, true);
  assert.deepEqual(paths.map(row => [row.path, row.method]), [
    ['/v1/projects', 'GET'],
    ['/v1/accounts:createAuthUri', 'POST'],
    ['/v1/accounts:createAuthUri', 'POST'],
    ['/o/oauth2/v2/auth', 'GET']
  ]);
  assert.equal(paths.some(row => /signIn|signUp/.test(row.path)), false);
  assert.equal(paths.some(row => /id_token|access_token|password/i.test(row.body)), false);
});

test('Google readiness audit rejects an OAuth authorization request that Google refuses before sign-in', async () => {
  await assert.rejects(
    verifyGoogleReadiness({
      apiKey: 'firebase-test-api-key-123456789',
      fetchImpl: async (url, options) => {
        const parsed = new URL(url);
        if (parsed.pathname.endsWith('/projects')) {
          return response({
            projectId: 'admission-hub-test',
            authorizedDomains: ['admissionhub.pages.dev'],
            idpConfig: [{ provider: 'google.com', enabled: true, clientId: '123456789012-readinessclient.apps.googleusercontent.com' }]
          });
        }
        if (parsed.hostname === 'accounts.google.com') return new Response(null, { status: 400 });
        const body = JSON.parse(options.body);
        return response({
          providerId: 'google.com',
          sessionId: body.sessionId,
          authUri: 'https://accounts.google.com/o/oauth2/v2/auth?client_id=123456789012-readinessclient.apps.googleusercontent.com&response_type=code&redirect_uri=https%3A%2F%2Fadmissionhub.pages.dev%2F%3FgoogleAuthCallback%3D1'
        });
      }
    }),
    error => error instanceof GoogleReadinessError && error.code === 'OAUTH_AUTHORIZATION_REQUEST_REJECTED' && error.status === 400
  );
});

test('Google readiness audit rejects an untrusted OAuth authorization host with a bounded code', async () => {
  await assert.rejects(
    verifyGoogleReadiness({
      apiKey: 'firebase-test-api-key-123456789',
      fetchImpl: async url => String(url).includes('/projects')
        ? response({ projectId: 'admission-hub-test', authorizedDomains: ['admissionhub.pages.dev'] })
        : response({ providerId: 'google.com', sessionId: `provider-session-${'x'.repeat(32)}`, authUri: 'https://evil.example/oauth?client_id=123456789012-readinessclient.apps.googleusercontent.com' })
    }),
    error => error instanceof GoogleReadinessError && error.code === 'INVALID_PROVIDER_RESPONSE'
  );
});

test('Google browser-origin classifier accepts only a non-error Google challenge without retaining URLs or credentials', () => {
  assert.deepEqual(classifyGoogleBrowserPage({
    url: 'https://accounts.google.com/signin/v2/challenge',
    text: 'Sign in with Google\nEmail or phone'
  }), { ready: true, googlePage: true, mismatch: false, rejected: false });
  assert.deepEqual(classifyGoogleBrowserPage({
    url: 'https://accounts.google.com/signin/oauth/error',
    text: 'Access blocked: Authorization Error\nError 400: origin_mismatch'
  }), { ready: false, googlePage: true, mismatch: true, rejected: true });
  assert.equal(classifyGoogleBrowserPage({
    url: 'https://evil.example/signin', text: 'Sign in with Google'
  }).ready, false);
});

test('Telegram readiness inventory checks only required binding names and never values', () => {
  assert.deepEqual(summarizeTelegramBindings([
    'AUTH_HMAC_SECRET', 'FIREBASE_WEB_API_KEY', 'TG_BOT_TOKEN', 'UNRELATED_SECRET'
  ]), {
    ready: true,
    authAuthority: true,
    firebaseAuthority: true,
    botCredential: true,
    valuesRead: false
  });
  const missing = summarizeTelegramBindings(['AUTH_HMAC_SECRET', 'FIREBASE_WEB_API_KEY']);
  assert.equal(missing.ready, false);
  assert.equal(missing.botCredential, false);
  assert.equal('names' in missing, false);
});

test('live Firebase lifecycle guard requires public Google, Passkey, and the Telegram selector with the generic backup flow', () => {
  const methods = {
    emailPassword: { available: true },
    google: {
      available: true,
      availabilityCode: 'READY',
      clientId: '123456789012-live-guard.apps.googleusercontent.com'
    },
    passkey: { available: true, enrollmentAvailable: true },
    telegramVerification: { available: true, availabilityCode: 'READY', verifiesEmailOwnership: false },
    backup: { available: true, availabilityCode: 'READY', providerNamesExposed: false }
  };
  assert.equal(liveAuthMethodsReady(methods), true);
  assert.equal(liveAuthMethodsReady({ ...methods, google: { available: false } }), false);
  assert.equal(liveAuthMethodsReady({ ...methods, telegramVerification: { available: false } }), false);
  assert.equal(liveAuthMethodsReady({ ...methods, backup: { available: false } }), false);
  assert.equal(liveAuthMethodsReady({ ...methods, backup: { available: true, providerNamesExposed: true } }), false);
  assert.equal(liveAuthMethodsReady({ ...methods, passkey: { available: false, enrollmentAvailable: false } }), false);
  assert.equal(liveAuthMethodsReady({ ...methods, passkey: { available: true, enrollmentAvailable: false } }), false);
});

test('live Firebase check extracts only a standard verify-email action', () => {
  const action = verificationAction('<a href="https://sample.firebaseapp.com/__/auth/action?mode=verifyEmail&amp;oobCode=secret-code&amp;continueUrl=https%3A%2F%2Fadmissionhub.pages.dev%2F%3FfirebaseVerified%3D1">Verify</a>');
  assert.deepEqual(action, {
    oobCode: 'secret-code',
    continueUrl: 'https://admissionhub.pages.dev/?firebaseVerified=1'
  });
  assert.equal(verificationAction('https://sample.firebaseapp.com/__/auth/action?mode=signIn&oobCode=not-accepted'), null);
});

test('live Firebase check reports only sanitized sender, authentication, DNS, and template evidence', async () => {
  const actionUrl = 'https://sample.firebaseapp.com/__/auth/action?mode=verifyEmail&oobCode=do-not-print';
  const source = [
    'From: Admission Hub <noreply@sample.firebaseapp.com>',
    'Return-Path: <bounce@sample.firebaseapp.com>',
    'Authentication-Results: mx.example; spf=pass smtp.mailfrom=sample.firebaseapp.com; dkim=pass header.d=firebaseapp.com; dmarc=pass header.from=sample.firebaseapp.com',
    'DKIM-Signature: v=1; d=firebaseapp.com; s=firebase1; bh=safe; b=redacted',
    'Content-Type: text/html; charset=UTF-8',
    '',
    'body omitted'
  ].join('\r\n');
  const fetchImpl = async url => {
    const name = new URL(url).searchParams.get('name');
    const data = name === 'sample.firebaseapp.com'
      ? ['"v=spf1 include:_spf.google.com ~all"']
      : name === 'firebase1._domainkey.firebaseapp.com'
        ? ['"v=DKIM1; p=public-key"']
        : name === '_dmarc.firebaseapp.com'
          ? ['"v=DMARC1; p=reject"']
          : [];
    return response({ Status: 0, Answer: data.map(value => ({ data: value })) });
  };
  const audit = await auditVerificationMessage({
    message: {
      from: { name: 'Admission Hub', address: 'noreply@sample.firebaseapp.com' },
      subject: 'Admission Hub ইমেইল যাচাই',
      size: 2048,
      text: 'বোতামটি কাজ না করলে যাচাইয়ের লিংকটি ব্যবহার করুন। এই অনুরোধ আপনার না হলে উপেক্ষা করুন।',
      html: [`<p>Admission Hub</p><a href="${actionUrl}">Verify My Email</a>`]
    },
    source,
    fetchImpl
  });
  assert.deepEqual({
    senderDomain: audit.senderDomain,
    returnPathDomain: audit.returnPathDomain,
    dkimDomain: audit.dkimDomain,
    spf: audit.spfResult,
    dkim: audit.dkimResult,
    dmarc: audit.dmarcResult,
    spfConfigured: audit.spfConfigured,
    duplicateSpf: audit.duplicateSpf,
    dkimConfigured: audit.dkimConfigured,
    dmarcConfigured: audit.dmarcConfigured,
    spfAligned: audit.spfAligned,
    dkimAligned: audit.dkimAligned,
    styledCta: audit.styledCta,
    rawUrlVisible: audit.rawUrlVisible
  }, {
    senderDomain: 'sample.firebaseapp.com',
    returnPathDomain: 'sample.firebaseapp.com',
    dkimDomain: 'firebaseapp.com',
    spf: 'pass',
    dkim: 'pass',
    dmarc: 'pass',
    spfConfigured: true,
    duplicateSpf: false,
    dkimConfigured: true,
    dmarcConfigured: true,
    spfAligned: true,
    dkimAligned: true,
    styledCta: true,
    rawUrlVisible: false
  });
  assert.doesNotMatch(JSON.stringify(audit), /do-not-print|oobCode|https?:\/\//i);
});

test('placement report keeps only bounded authentication, score, spam, and provider signals', () => {
  const report = {
    email_info: { email_address: 'private@in.mailtester.ai', subject: 'private subject' },
    status_info: { status: 'completed' },
    deliverability_score: 87,
    technical_analysis: {
      view: { score: { value: 91 } },
      results: [
        { check_type: 'SPF', status: 'pass', details: { domain: 'private.example' } },
        { check_type: 'DKIM', status: 'pass', details: { selector: 'private' } },
        { check_type: 'DMARC', status: 'warning', details: { policy: 'none' } },
        { check_type: 'spamassassin', status: 'pass', details: { is_spam: false, raw_spamassassin_score: 0.4, raw_required_score: 5 } }
      ]
    },
    ai_analysis: {
      ai_prediction: { inbox: 78, promotions: 17, spam: 5, primary_destination: 'inbox', confidence: 'high' },
      provider_placement: {
        gmail: { placement: 'primary', score: 90, email: 'leak@gmail.com' },
        outlook: { folder: 'inbox' },
        yahoo: { status: 'spam' }
      }
    }
  };
  const summary = summarizePlacementReport(report);
  assert.deepEqual(summary, {
    status: 'completed',
    score: 91,
    authentication: { spf: 'pass', dkim: 'pass', dmarc: 'warning' },
    spamFilter: { status: 'pass', isSpam: false, score: 0.4, threshold: 5 },
    placement: { inbox: 78, promotions: 17, spam: 5, primary: 'inbox', confidence: 'high' },
    providers: {
      gmail: { placement: 'primary', score: 90 },
      outlook: { folder: 'inbox' },
      yahoo: { status: 'spam' }
    }
  });
  assert.doesNotMatch(JSON.stringify(summary), /private|@|subject|example|https?:\/\//i);
});

test('protected deployments require the Firebase Worker binding by name without reading its value', async () => {
  const fetchImpl = async (_url, options) => {
    assert.match(options.headers.Authorization, /^Bearer /);
    return response({ success: true, result: [{ name: 'FIREBASE_WEB_API_KEY', type: 'secret_text' }] });
  };
  assert.deepEqual(await verifyFirebaseWorkerBinding({
    accountId: 'account-test', apiToken: 'token-test', fetchImpl
  }), { installed: true });
  await assert.rejects(() => verifyFirebaseWorkerBinding({
    accountId: 'account-test', apiToken: 'token-test',
    fetchImpl: async () => response({ success: true, result: [] })
  }), /not installed/i);
});

test('AgentMail display name is set on the inbox and requires the echoed value', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, method: options.method, body: JSON.parse(options.body), auth: options.headers.Authorization });
    return response({ inbox_id: 'otp-inbox@agentmail.to', display_name: 'AdmissionSky' });
  };
  assert.deepEqual(await setAgentMailDisplayName({
    apiKey: 'agentmail-test-key', inboxId: 'otp-inbox@agentmail.to', displayName: 'AdmissionSky', fetchImpl
  }), { applied: true });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'PATCH');
  assert.match(calls[0].url, /\/v0\/inboxes\/otp-inbox%40agentmail\.to$/);
  assert.deepEqual(calls[0].body, { display_name: 'AdmissionSky' });
  assert.equal(calls[0].auth, 'Bearer agentmail-test-key');

  // A response that does not echo the requested name means the write did not take.
  await assert.rejects(() => setAgentMailDisplayName({
    apiKey: 'agentmail-test-key', inboxId: 'otp-inbox@agentmail.to', displayName: 'AdmissionSky',
    fetchImpl: async () => response({ inbox_id: 'otp-inbox@agentmail.to', display_name: 'AgentMail' })
  }), /NOT_APPLIED/);
  await assert.rejects(() => setAgentMailDisplayName({
    apiKey: 'agentmail-test-key', inboxId: 'otp-inbox@agentmail.to', displayName: 'AdmissionSky',
    fetchImpl: async () => new Response('nope', { status: 403 })
  }), /UPDATE_FAILED_403/);
  await assert.rejects(() => setAgentMailDisplayName({
    apiKey: 'short', inboxId: 'otp-inbox@agentmail.to', displayName: 'AdmissionSky', fetchImpl
  }), /API_KEY_MISSING/);
});
