import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createEmailGateway,
  createEmailGatewayPort,
  EMAIL_GATEWAY_VERSION,
  EMAIL_TYPES,
  EMAIL_FAILURE_CODES,
  PROVIDER_IDS
} from './email-gateway/index.mjs';
import { createEmailGatewayConfig } from './email-gateway/core/config.mjs';
import { deriveQuotaState } from './email-gateway/core/quota.mjs';
import { createProviderEntries, PROVIDER_CATALOG } from './email-gateway/providers/catalog.mjs';
import { MemoryEmailStore } from './email-gateway/storage/memory-store.mjs';
import { MockEmailProvider, mockProviderEntry } from './email-gateway/testing/mock-provider.mjs';
import { createMockGateway, sampleEmailRequest } from './email-gateway/testing/create-mock-gateway.mjs';
import { BrevoProvider } from './email-gateway/providers/brevo.mjs';
import { ResendProvider } from './email-gateway/providers/resend.mjs';
import { MailjetProvider } from './email-gateway/providers/mailjet.mjs';
import { MailtrapProvider } from './email-gateway/providers/mailtrap.mjs';
import { MailerSendProvider } from './email-gateway/providers/mailersend.mjs';
import { SendPulseProvider } from './email-gateway/providers/sendpulse.mjs';
import { EmailOctopusProvider } from './email-gateway/providers/emailoctopus.mjs';
import { CourierProvider } from './email-gateway/providers/courier.mjs';

const enabledEntry = (provider, overrides = {}) => mockProviderEntry(provider, overrides);

const fakeFetch = captures => async (url, init) => {
  captures.push({ url: String(url), init });
  return new Response(JSON.stringify({ id: 'provider-message', requestId: 'provider-message', result: true, message_ids: ['provider-message'], messageId: 'provider-message', MessageId: 'provider-message', MessageID: 'provider-message', TransactionID: 'provider-message', data: { 0: { message_id: 'provider-message' }, email_id: 'provider-message', succeeded: ['provider-message'] }, Messages: [{ To: [{ MessageUUID: 'provider-message' }] }] }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'X-Message-Id': 'provider-message' }
  });
};

const renderedMessage = Object.freeze({ recipient: 'student@example.com', subject: 'Admission Sky test', text: 'Plain body', html: '<p>HTML body</p>' });
const providerContext = Object.freeze({ requestId: 'email-request-provider-0001', idempotencyKey: 'email-idempotency-provider-0001', deliveryAttemptId: 'attempt-provider-0001', requestRef: 'private-request-ref-01' });

test('public Email Gateway contract and version are frozen', async () => {
  const gateway = await createEmailGateway({ config: { environment: 'test', rateLimits: { enabled: false } }, privatePepper: 'test-private-pepper-000000000000' });
  assert.equal(EMAIL_GATEWAY_VERSION, 'phase2b-2');
  assert.ok(Object.isFrozen(gateway));
  assert.deepEqual(Object.keys(gateway), ['send', 'healthCheck', 'getCapabilities', 'recordDeliveryEvent']);
  const health = await gateway.healthCheck();
  assert.equal(health.status, 'DISABLED');
  assert.equal(health.enabledProviders, 0);
  assert.equal(health.providers.length, 8);
  const port = createEmailGatewayPort(gateway);
  assert.ok(Object.isFrozen(port));
  assert.deepEqual(Object.keys(port), ['send', 'healthCheck', 'getCapabilities']);
  assert.equal((await port.getCapabilities()).length, 8);
});

test('default provider catalog is complete and safely disabled', async () => {
  assert.deepEqual(PROVIDER_CATALOG.map(provider => provider.id), PROVIDER_IDS);
  const config = createEmailGatewayConfig();
  const entries = await createProviderEntries({ config, env: {}, runtime: { fetchImpl: async () => { throw new Error('must not fetch'); } } });
  assert.equal(entries.length, 8);
  assert.ok(entries.every(entry => !entry.enabled));
  assert.ok(entries.every(entry => entry.activationIssues.includes('POLICY_DISABLED')));
});

test('provider requires explicit policy, activation, sender verification, credentials and quota', async () => {
  const base = { environment: 'test', providerPolicies: { brevo: { enabled: true, priority: 1, dailyLimit: 100 } } };
  const config = createEmailGatewayConfig(base);
  const noGate = await createProviderEntries({ config, env: { BREVO_API_KEY: 'private-test-value', EMAIL_FROM_ADDRESS: 'sender@example.com' }, runtime: {} });
  assert.equal(noGate.find(entry => entry.id === 'brevo').enabled, false);
  const enabled = await createProviderEntries({
    config,
    env: { EMAIL_PROVIDER_ACTIVATION: 'enabled', BREVO_SENDER_VERIFIED: 'true', BREVO_API_KEY: 'private-test-value', EMAIL_FROM_ADDRESS: 'sender@example.com' },
    runtime: { fetchImpl: async () => new Response('{}') }
  });
  assert.equal(enabled.find(entry => entry.id === 'brevo').enabled, true);
  assert.equal(enabled.filter(entry => entry.enabled).length, 1);
  const historicalNameOnly = await createProviderEntries({
    config,
    env: { EMAIL_PROVIDER_ACTIVATION: 'enabled', BREVO_SENDER_VERIFIED: 'true', BREVO_KEY: 'historical-name-is-not-consumed', EMAIL_FROM_ADDRESS: 'sender@example.com' },
    runtime: {}
  });
  assert.equal(historicalNameOnly.find(entry => entry.id === 'brevo').enabled, false);

  const runtimeSender = await createProviderEntries({
    config,
    env: { BREVO_API_KEY: 'private-test-value' },
    runtime: { allowProviderActivation: true, senderVerified: true, fromAddress: 'sender@example.com' }
  });
  assert.equal(runtimeSender.find(entry => entry.id === 'brevo').enabled, true);

  const octopusConfig = createEmailGatewayConfig({ providerPolicies: { emailoctopus: { enabled: true, priority: 70, dailyLimit: 10 } } });
  const octopusEntries = await createProviderEntries({
    config: octopusConfig,
    env: { EMAIL_PROVIDER_ACTIVATION: 'enabled', EMAILOCTOPUS_SENDER_VERIFIED: 'true', EMAIL_FROM_ADDRESS: 'sender@example.com', EMAILOCTOPUS_API_KEY: 'private-test-value' },
    runtime: {}
  });
  const octopus = octopusEntries.find(entry => entry.id === 'emailoctopus');
  assert.equal(octopus.configured, true);
  assert.equal(octopus.enabled, false);
  assert.ok(octopus.activationIssues.includes('TRANSACTIONAL_CAPABILITY_MISSING'));
});

test('Mailjet SandboxMode flag never bypasses live sender health', async () => {
  const config = createEmailGatewayConfig({ providerPolicies: {
    mailjet: { enabled: true, priority: 1, dailyLimit: 200, monthlyLimit: 6000 }
  } });
  const baseEnv = {
    EMAIL_PROVIDER_ACTIVATION: 'enabled',
    MAILJET_API_KEY: 'private-test-api-value',
    MAILJET_SECRET_KEY: 'private-test-secret-value',
    MAILJET_FROM_ADDRESS: 'sender@example.com',
    MAILJET_SENDER_VERIFIED: 'true'
  };
  const apiListed = await createProviderEntries({ config, env: baseEnv, runtime: {} });
  assert.equal(apiListed.find(entry => entry.id === 'mailjet').requiresRemoteHealth, true);
  const sandboxProven = await createProviderEntries({
    config, env: { ...baseEnv, MAILJET_SANDBOX_SENDER_VERIFIED: 'true' }, runtime: {}
  });
  const mailjet = sandboxProven.find(entry => entry.id === 'mailjet');
  assert.equal(mailjet.enabled, true);
  assert.equal(mailjet.requiresRemoteHealth, true);
});

test('provider-specific sender bindings isolate From identities with a global fallback available', async () => {
  const captures = [];
  const fetchImpl = async (url, init) => {
    captures.push({ url: String(url), body: JSON.parse(String(init.body)) });
    const data = String(url).includes('resend') ? { id: 'resend-message' } : { messageId: 'brevo-message' };
    return new Response(JSON.stringify(data), { status: 201, headers: { 'Content-Type': 'application/json' } });
  };
  const config = createEmailGatewayConfig({ providerPolicies: {
    resend: { enabled: true, priority: 10, dailyLimit: 10 },
    brevo: { enabled: true, priority: 20, dailyLimit: 10 }
  } });
  const entries = await createProviderEntries({ config, env: {
    EMAIL_PROVIDER_ACTIVATION: 'enabled',
    RESEND_API_KEY: 'private-resend-test-value', RESEND_FROM_ADDRESS: 'resend@example.com', RESEND_SENDER_VERIFIED: 'true',
    BREVO_API_KEY: 'private-brevo-test-value', BREVO_FROM_ADDRESS: 'brevo@example.org', BREVO_SENDER_VERIFIED: 'true'
  }, runtime: { fetchImpl } });
  const resend = entries.find(entry => entry.id === 'resend');
  const brevo = entries.find(entry => entry.id === 'brevo');
  assert.equal(resend.enabled, true);
  assert.equal(brevo.enabled, true);
  await resend.adapter.sendEmail(renderedMessage, providerContext);
  await brevo.adapter.sendEmail(renderedMessage, providerContext);
  assert.match(captures[0].body.from, /resend@example\.com/);
  assert.equal(captures[1].body.sender.email, 'brevo@example.org');
});

test('remote sender evidence can block an otherwise activated provider before mutation', async () => {
  let healthCalls = 0;
  let sendCalls = 0;
  const fetchImpl = async (_url, init = {}) => {
    if (init.method === 'GET') {
      healthCalls += 1;
      return new Response(JSON.stringify({ senders: [{ email: 'sender@example.com', active: false }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    sendCalls += 1;
    return new Response(JSON.stringify({ messageId: 'must-not-send' }), { status: 201, headers: { 'Content-Type': 'application/json' } });
  };
  const config = createEmailGatewayConfig({ environment: 'test', rateLimits: { enabled: false }, providerPolicies: { brevo: { enabled: true, priority: 1, dailyLimit: 10 } } });
  const gateway = await createEmailGateway({
    config,
    store: new MemoryEmailStore(),
    env: { EMAIL_PROVIDER_ACTIVATION: 'enabled', BREVO_SENDER_VERIFIED: 'true', BREVO_API_KEY: 'private-test-value', EMAIL_FROM_ADDRESS: 'sender@example.com' },
    privatePepper: 'private-test-pepper-000000000000',
    runtime: { fetchImpl }
  });
  await assert.rejects(gateway.send(sampleEmailRequest('0000000000000009')), error => error.code === EMAIL_FAILURE_CODES.NO_ELIGIBLE_PROVIDER);
  assert.equal(healthCalls, 1);
  assert.equal(sendCalls, 0);
});

test('quota reporting uses the complete NORMAL LOW CRITICAL EXHAUSTED UNKNOWN state model', () => {
  const policy = { warningRatio: 0.30, reduceRatio: 0.10 };
  assert.equal(deriveQuotaState({ remainingRatio: 0.80, exhausted: false }, policy), 'NORMAL');
  assert.equal(deriveQuotaState({ remainingRatio: 0.20, exhausted: false }, policy), 'LOW');
  assert.equal(deriveQuotaState({ remainingRatio: 0.05, exhausted: false }, policy), 'CRITICAL');
  assert.equal(deriveQuotaState({ remainingRatio: 0, exhausted: true }, policy), 'EXHAUSTED');
  assert.equal(deriveQuotaState({ remainingRatio: null, exhausted: false }, policy), 'UNKNOWN');
});

test('configuration rejects secrets, unknown providers and unsafe production limits', () => {
  assert.throws(() => createEmailGatewayConfig({ apiKey: 'nope' }), error => error.code === EMAIL_FAILURE_CODES.INVALID_CONFIGURATION);
  assert.throws(() => createEmailGatewayConfig({ environment: 'production', rateLimits: { enabled: false } }), /cannot be disabled/);
  assert.throws(() => createEmailGatewayConfig({ providerPolicies: { unknown: { enabled: false } } }), /Unknown email provider/);
  assert.throws(() => createEmailGatewayConfig({ providerPolicies: { brevo: { enabled: true, secret: 'nope' } } }), error => error.code === EMAIL_FAILURE_CODES.INVALID_CONFIGURATION);
  assert.throws(() => createEmailGatewayConfig({ quota: { warningRatio: 0.01, reduceRatio: 0.5 } }), /must descend/);
  assert.throws(() => createEmailGatewayConfig({ router: { unknown: true } }), /router\.unknown/);
  assert.throws(() => createEmailGatewayConfig({ providerPolicies: { brevo: { enabled: false, capabilities: ['sk-forbidden-value'] } } }), /Secret-like value/);
});

test('production composition requires a durable store and forbids custom provider bypass', async () => {
  await assert.rejects(createEmailGateway(), /durable Email Gateway store/);
  const provider = new MockEmailProvider({ id: 'injected' });
  await assert.rejects(createEmailGateway({ store: new MemoryEmailStore(), entries: [enabledEntry(provider)] }), /Custom provider entries are forbidden/);
});

test('template escapes user values and never puts OTP in a URL', async () => {
  const provider = new MockEmailProvider({ id: 'template' });
  const { gateway } = await createMockGateway({ entries: [enabledEntry(provider)] });
  await gateway.send(sampleEmailRequest('0000000000000010', { variables: { otp: '654321', name: '<img src=x onerror=alert(1)>' } }));
  assert.equal(provider.calls, 1);
  assert.match(provider.messages[0].html, /654321/);
  assert.doesNotMatch(provider.messages[0].html, /<img src=x/);
  assert.match(provider.messages[0].html, /&lt;img/);
  assert.doesNotMatch(provider.messages[0].html, /href=.*654321|https?:[^\s"']*654321/i);
});

test('all nine transactional email types render from one escaped template engine', async () => {
  const provider = new MockEmailProvider({ id: 'all-templates' });
  const { gateway } = await createMockGateway({ entries: [enabledEntry(provider)] });
  const otpTypes = Object.values(EMAIL_TYPES).filter(type => !['WELCOME_EMAIL', 'SECURITY_ALERT'].includes(type));
  for (const [index, type] of otpTypes.entries()) {
    await gateway.send(sampleEmailRequest(`0000000000001${String(index).padStart(3, '0')}`, { type, template: type, variables: { otp: '123456', purpose: `<${type}>` } }));
  }
  await gateway.send(sampleEmailRequest('0000000000001998', { type: 'WELCOME_EMAIL', template: 'WELCOME_EMAIL', variables: { name: '<Welcome>' } }));
  await gateway.send(sampleEmailRequest('0000000000001999', { type: 'SECURITY_ALERT', template: 'SECURITY_ALERT', variables: { activity: '<Changed>', time: 'Now' } }));
  assert.equal(provider.calls, 9);
  assert.ok(provider.messages.every(message => message.subject && message.text && message.html));
  assert.ok(provider.messages.every(message => !message.html.includes('<Changed>') && !message.html.includes('<Welcome>')));
  await assert.rejects(gateway.send(sampleEmailRequest('0000000000002000', { variables: { otp: '12345' } })), error => error.code === EMAIL_FAILURE_CODES.INVALID_REQUEST);
});

test('request validation blocks header injection, invalid recipients and unknown fields', async () => {
  const provider = new MockEmailProvider({ id: 'validate' });
  const { gateway } = await createMockGateway({ entries: [enabledEntry(provider)] });
  await assert.rejects(gateway.send(sampleEmailRequest('0000000000000011', { subject: 'hello\r\nBcc: victim@example.com' })), error => error.code === EMAIL_FAILURE_CODES.INVALID_REQUEST);
  await assert.rejects(gateway.send(sampleEmailRequest('0000000000000012', { recipient: 'not-an-email' })), error => error.code === EMAIL_FAILURE_CODES.INVALID_REQUEST);
  const withoutIdempotency = sampleEmailRequest('0000000000000013');
  delete withoutIdempotency.idempotencyKey;
  await assert.rejects(gateway.send(withoutIdempotency), error => error.code === EMAIL_FAILURE_CODES.INVALID_REQUEST);
  await assert.rejects(gateway.send({ ...sampleEmailRequest('0000000000000013'), password: 'never' }), error => error.code === EMAIL_FAILURE_CODES.INVALID_REQUEST);
  await assert.rejects(gateway.send(sampleEmailRequest('0000000000000014', { variables: { otp: '123456', password: 'never' } })), error => error.code === EMAIL_FAILURE_CODES.INVALID_REQUEST);
  await assert.rejects(gateway.send(sampleEmailRequest('0000000000000015', { variables: { otp: '123456', apiKey: 'not-template-data' } })), error => error.code === EMAIL_FAILURE_CODES.INVALID_REQUEST);
  assert.equal(provider.calls, 0);
});

test('successful send persists minimized metadata without recipient or OTP', async () => {
  const provider = new MockEmailProvider({ id: 'primary' });
  const { gateway, store } = await createMockGateway({ entries: [enabledEntry(provider)] });
  const result = await gateway.send(sampleEmailRequest('0000000000000020'));
  assert.equal(result.ok, true);
  assert.equal(result.status, 'ACCEPTED');
  assert.equal(result.providerId, 'primary');
  const serialized = JSON.stringify([...store.requests.values()]);
  assert.doesNotMatch(serialized, /student-|@example\.com|123456|শিক্ষার্থী/);
  assert.match(serialized, /recipientRef|fingerprint/);
});

test('production-style recipient references use keyed HMAC rather than raw hashes', async () => {
  const provider = new MockEmailProvider({ id: 'hmac-provider' });
  const store = new MemoryEmailStore();
  const gateway = await createEmailGateway({
    config: { environment: 'test', rateLimits: { enabled: false } }, store,
    entries: [enabledEntry(provider)], privatePepper: 'private-hmac-pepper-value-000000001'
  });
  const request = sampleEmailRequest('0000000000000029', { recipient: 'hmac.student@example.com' });
  await gateway.send(request);
  const record = await store.getRequest(request.requestId);
  assert.match(record.recipientRef, /^[a-f0-9]{32}$/);
  assert.notEqual(record.recipientRef, request.recipient);
});

test('stable requestId prevents duplicate provider sends', async () => {
  const provider = new MockEmailProvider({ id: 'once' });
  const { gateway } = await createMockGateway({ entries: [enabledEntry(provider)] });
  const request = sampleEmailRequest('0000000000000021');
  const first = await gateway.send(request);
  const second = await gateway.send(request);
  assert.equal(first.duplicate, false);
  assert.equal(second.duplicate, true);
  assert.equal(provider.calls, 1);
  assert.equal(second.providerMessageId, first.providerMessageId);
});

test('distinct idempotency key is the atomic deduplication boundary and every mutation has an attempt ID', async () => {
  const provider = new MockEmailProvider({ id: 'atomic', mode: 'slow', delayMs: 5 });
  const { gateway, store } = await createMockGateway({ entries: [enabledEntry(provider)] });
  const request = sampleEmailRequest('0000000000000023', { idempotencyKey: 'email-idempotency-0000000000000023' });
  const results = await Promise.allSettled(Array.from({ length: 10 }, () => gateway.send(request)));
  assert.equal(provider.calls, 1);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter(result => result.status === 'rejected').length, 9);
  assert.equal((await store.getRequest(request.idempotencyKey)).requestId, request.requestId);
  assert.equal(provider.messages[0].idempotencyKey, request.idempotencyKey);
  assert.match(provider.messages[0].deliveryAttemptId, /^test-[a-f0-9]{8}:atomic:1$/);
  const duplicate = await gateway.send(request);
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.idempotencyKey, request.idempotencyKey);
});

test('requestId reuse with a different recipient or OTP is rejected', async () => {
  const provider = new MockEmailProvider({ id: 'conflict' });
  const { gateway } = await createMockGateway({ entries: [enabledEntry(provider)] });
  const request = sampleEmailRequest('0000000000000022');
  await gateway.send(request);
  await assert.rejects(gateway.send({ ...request, recipient: 'other@example.com' }), error => error.code === EMAIL_FAILURE_CODES.IDEMPOTENCY_CONFLICT);
  await assert.rejects(gateway.send({ ...request, variables: { ...request.variables, otp: '654321' } }), error => error.code === EMAIL_FAILURE_CODES.IDEMPOTENCY_CONFLICT);
  assert.equal(provider.calls, 1);
});

test('layered rate limit blocks resend without a second provider call', async () => {
  const provider = new MockEmailProvider({ id: 'limited' });
  const config = {
    environment: 'test',
    rateLimits: {
      enabled: true,
      recipientWindow: { limit: 1, windowMs: 60000 }, recipientDay: { limit: 10, windowMs: 86400000 },
      ipWindow: { limit: 10, windowMs: 60000 }, accountWindow: { limit: 10, windowMs: 60000 },
      deviceWindow: { limit: 10, windowMs: 60000 }, globalWindow: { limit: 100, windowMs: 60000 }
    }
  };
  const { gateway } = await createMockGateway({ entries: [enabledEntry(provider)], config });
  await gateway.send(sampleEmailRequest('0000000000000030', { recipient: 'same@example.com' }));
  await assert.rejects(gateway.send(sampleEmailRequest('0000000000000031', { recipient: 'same@example.com' })), error => error.code === EMAIL_FAILURE_CODES.RATE_LIMITED);
  assert.equal(provider.calls, 1);
});

test('delivery events update truth and are idempotent', async () => {
  const provider = new MockEmailProvider({ id: 'brevo' });
  const { gateway } = await createMockGateway({ entries: [enabledEntry(provider)] });
  const request = sampleEmailRequest('0000000000000040');
  await gateway.send(request);
  const event = { requestId: request.requestId, idempotencyKey: request.idempotencyKey, providerId: 'brevo', providerEventId: 'provider-event-0001', status: 'DELIVERED', occurredAt: Date.now() + 1000 };
  assert.deepEqual(await gateway.recordDeliveryEvent(event), { accepted: true, duplicate: false, ignored: false, requestId: request.requestId, status: 'DELIVERED' });
  assert.deepEqual(await gateway.recordDeliveryEvent(event), { accepted: true, duplicate: true });
  assert.deepEqual(await gateway.recordDeliveryEvent({ ...event, providerEventId: 'provider-event-0002', status: 'SENT', occurredAt: event.occurredAt + 1000 }), { accepted: true, duplicate: false, ignored: true, requestId: request.requestId, status: 'DELIVERED' });
  await assert.rejects(gateway.recordDeliveryEvent({ ...event, providerEventId: 'provider-event-future', occurredAt: Date.now() + (6 * 60 * 1000) }), error => error.code === EMAIL_FAILURE_CODES.INVALID_REQUEST);
  await assert.rejects(gateway.recordDeliveryEvent({ ...event, providerEventId: 'provider-event-0003', providerId: 'resend' }), error => error.code === EMAIL_FAILURE_CODES.INVALID_REQUEST);
});

test('delivery-event lease recovers safely after a request-state persistence failure', async () => {
  let now = Date.now();
  const store = new MemoryEmailStore({ now: () => now });
  const provider = new MockEmailProvider({ id: 'brevo' });
  const { gateway } = await createMockGateway({ entries: [enabledEntry(provider)], store, runtime: { now: () => now } });
  const request = sampleEmailRequest('0000000000000042');
  await gateway.send(request);
  const event = { requestId: request.requestId, idempotencyKey: request.idempotencyKey, providerId: 'brevo', providerEventId: 'provider-event-lease-0001', status: 'DELIVERED', occurredAt: now + 1000 };
  let failUpdate = true;
  store.fail = operation => operation === 'updateRequest' && failUpdate ? (failUpdate = false, true) : false;
  await assert.rejects(gateway.recordDeliveryEvent(event), error => error.code === EMAIL_FAILURE_CODES.STORAGE_UNAVAILABLE);
  await assert.rejects(gateway.recordDeliveryEvent(event), error => error.code === EMAIL_FAILURE_CODES.STORAGE_UNAVAILABLE && error.retryable);
  now += 31 * 1000;
  const recovered = await gateway.recordDeliveryEvent(event);
  assert.equal(recovered.status, 'DELIVERED');
  assert.equal((await store.getRequest(request.requestId)).status, 'DELIVERED');
});

test('observability records no raw recipient, OTP or rendered content', async () => {
  const provider = new MockEmailProvider({ id: 'events' });
  const { gateway, store } = await createMockGateway({ entries: [enabledEntry(provider)] });
  await gateway.send(sampleEmailRequest('0000000000000041'));
  const events = JSON.stringify(await store.listEvents(50));
  assert.doesNotMatch(events, /@example\.com|123456|শিক্ষার্থী|Plain body|html/i);
  assert.match(events, /PROVIDER_ATTEMPT|REQUEST_FINAL/);
});

test('all eight owner-selected adapters expose one normalized interface and truthful OTP capability', async () => {
  const captures = [];
  const fetchImpl = fakeFetch(captures);
  const common = { apiKey: 'private-test-api-value', fromAddress: 'sender@example.com', fromName: 'Admission Sky', fetchImpl };
  const sendable = [
    new ResendProvider(common),
    new BrevoProvider(common),
    new MailjetProvider({ ...common, secretKey: 'private-test-secret-value' }),
    new MailtrapProvider(common),
    new MailerSendProvider(common),
    new SendPulseProvider(common),
    new CourierProvider(common)
  ];
  const emailOctopus = new EmailOctopusProvider({ apiKey: 'private-test-api-value', fetchImpl });
  for (const adapter of [...sendable, emailOctopus]) {
    assert.equal((await adapter.verifyConfiguration()).configured, true, adapter.id);
    for (const method of ['sendEmail', 'checkHealth', 'getStatus', 'getCapabilities']) assert.equal(typeof adapter[method], 'function', `${adapter.id}:${method}`);
  }
  for (const adapter of sendable) {
    const result = await adapter.sendEmail(renderedMessage, providerContext);
    assert.equal(result.status, 'ACCEPTED', adapter.id);
    assert.ok(adapter.getCapabilities().includes('transactional'), adapter.id);
  }
  assert.equal(emailOctopus.getCapabilities().includes('transactional'), false);
  await assert.rejects(emailOctopus.sendEmail(renderedMessage, providerContext), error => error.code === EMAIL_FAILURE_CODES.NOT_CONFIGURED && !error.dispatched);
  assert.equal(captures.length, 7);
  assert.deepEqual(captures.map(item => new URL(item.url).hostname), [
    'api.resend.com', 'api.brevo.com', 'api.mailjet.com', 'send.api.mailtrap.io',
    'api.mailersend.com', 'api.sendpulse.com', 'api.courier.com'
  ]);
  const serialized = captures.map(capture => String(capture.init.body));
  assert.ok(serialized.every(body => body.includes('student@example.com')));
  assert.equal(captures[0].init.headers['Idempotency-Key'], providerContext.idempotencyKey);
  assert.equal(captures[6].init.headers['Idempotency-Key'], providerContext.idempotencyKey);
});

test('all eight adapters use bounded non-mutating remote health endpoints without sending email', async () => {
  const captures = [];
  const fetchImpl = async (url, init = {}) => {
    captures.push({ url: String(url), init });
    const target = String(url);
    let data = {};
    if (target === 'https://api.resend.com/domains') data = { data: [{ name: 'example.com', status: 'verified', capabilities: { sending: 'enabled' } }] };
    else if (target === 'https://api.brevo.com/v3/senders') data = { senders: [{ email: 'sender@example.com', active: true }] };
    else if (target.includes('/v3/REST/sender')) data = { Data: [{ Email: 'sender@example.com', Status: 'Active' }] };
    else if (target.startsWith('https://mailtrap.io/api/stats/domains?')) data = [];
    else if (target.includes('api.mailersend.com/v1/domains')) data = { data: [{ name: 'example.com', is_verified: true }] };
    else if (target.includes('api.sendpulse.com/smtp/senders')) data = [{ email: 'sender@example.com', status: 'Active' }];
    return new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  const common = { apiKey: 'private-test-api-value', fromAddress: 'sender@example.com', fetchImpl };
  const adapters = [
    new ResendProvider(common), new BrevoProvider(common), new MailjetProvider({ ...common, secretKey: 'private-test-secret-value' }),
    new MailtrapProvider(common), new MailerSendProvider(common), new SendPulseProvider(common),
    new EmailOctopusProvider({ apiKey: 'private-test-api-value', fetchImpl }), new CourierProvider(common)
  ];
  const results = await Promise.all(adapters.map(adapter => adapter.checkHealth()));
  assert.equal(captures.length, 9); // Mailjet checks per-key Sender and account-wide MetaSender in parallel.
  assert.ok(captures.every(capture => capture.init.method === 'GET' && capture.init.body == null));
  assert.ok(results.every(result => result.remoteVerified === true));
  assert.equal(results[0].senderVerified, true);
  assert.equal(results[4].senderVerified, true);
  assert.equal(results[5].senderVerified, true);
  assert.equal(results[6].status, 'INELIGIBLE');
});

test('Mailjet account-wide enabled MetaSender is accepted when the API-key Sender record is pending', async () => {
  const captures = [];
  const provider = new MailjetProvider({
    apiKey: 'private-test-api-value',
    secretKey: 'private-test-secret-value',
    fromAddress: 'shared.sender@example.com',
    fetchImpl: async (url, init = {}) => {
      captures.push({ url: String(url), init });
      const data = String(url).includes('/metasender')
        ? { Data: [{ Email: 'shared.sender@example.com', IsEnabled: true }] }
        : { Data: [{ Email: 'shared.sender@example.com', Status: 'Pending' }] };
      return new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
  });
  const result = await provider.checkHealth();
  assert.equal(result.status, 'HEALTHY');
  assert.equal(result.senderVerified, true);
  assert.equal(result.remoteVerified, true);
  assert.equal(captures.length, 2);
  assert.ok(captures.every(capture => capture.init.method === 'GET' && capture.init.body == null));
});

test('MailerSend paused and fully suppressed 202 responses are never reported as accepted', async () => {
  const paused = new MailerSendProvider({
    apiKey: 'private-test-value', fromAddress: 'sender@example.com',
    fetchImpl: async () => new Response('', { status: 202, headers: { 'X-Message-Id': 'paused-id', 'X-Send-Paused': 'true' } })
  });
  await assert.rejects(paused.sendEmail(renderedMessage, providerContext), error => error.code === EMAIL_FAILURE_CODES.PROVIDER_SUSPENDED && !error.uncertain);
  const suppressed = new MailerSendProvider({
    apiKey: 'private-test-value', fromAddress: 'sender@example.com',
    fetchImpl: async () => new Response(JSON.stringify({ warnings: [{ type: 'ALL_SUPPRESSED' }] }), { status: 202, headers: { 'Content-Type': 'application/json', 'X-Message-Id': 'suppressed-id' } })
  });
  await assert.rejects(suppressed.sendEmail(renderedMessage, providerContext), error => error.code === EMAIL_FAILURE_CODES.RECIPIENT_REJECTED && !error.uncertain);
});

test('HTTP adapters classify 4xx, timeout, rate and 5xx without response-body leakage', async () => {
  const cases = [
    [400, EMAIL_FAILURE_CODES.INVALID_REQUEST],
    [401, EMAIL_FAILURE_CODES.AUTHENTICATION_ERROR],
    [404, EMAIL_FAILURE_CODES.DOMAIN_ERROR],
    [408, EMAIL_FAILURE_CODES.TIMEOUT],
    [422, EMAIL_FAILURE_CODES.RECIPIENT_REJECTED],
    [429, EMAIL_FAILURE_CODES.RATE_LIMIT],
    [503, EMAIL_FAILURE_CODES.FIVE_XX_SERVER_ERROR]
  ];
  for (const [status, code] of cases) {
    const provider = new BrevoProvider({ apiKey: 'private-test-value', fromAddress: 'sender@example.com', fetchImpl: async () => new Response('provider secret diagnostic', { status }) });
    await assert.rejects(provider.sendEmail(renderedMessage, providerContext), error => error.code === code && !error.safeMessage.includes('provider secret diagnostic'));
  }
});

test('oversized or missing provider acceptance evidence fails uncertain without body retention', async () => {
  const provider = new BrevoProvider({
    apiKey: 'private-test-value', fromAddress: 'sender@example.com',
    fetchImpl: async () => new Response(JSON.stringify({ messageId: 'hidden-id', padding: 'x'.repeat(70 * 1024) }), { status: 201, headers: { 'Content-Type': 'application/json' } })
  });
  await assert.rejects(provider.sendEmail(renderedMessage, providerContext), error => error.code === EMAIL_FAILURE_CODES.UNKNOWN && error.uncertain);
});

test('safe status report exposes rates, latency, quota label, circuit, priority, failover and load', async () => {
  const provider = new MockEmailProvider({ id: 'metrics' });
  const { gateway } = await createMockGateway({ entries: [enabledEntry(provider, { priority: 7, dailyLimit: 5, maxConcurrent: 2, timeoutMs: 50 })], config: { router: { defaultProviderTimeoutMs: 50, globalDeadlineMs: 150, maxProviderAttempts: 1 } } });
  await gateway.send(sampleEmailRequest('0000000000000050'));
  provider.mode = 'timeout';
  await assert.rejects(gateway.send(sampleEmailRequest('0000000000000051')), error => error.code === EMAIL_FAILURE_CODES.DELIVERY_UNCERTAIN);
  const health = await gateway.healthCheck();
  const status = health.providers[0];
  assert.equal(status.successCount, 1);
  assert.equal(status.failureCount, 1);
  assert.equal(status.timeoutCount, 1);
  assert.equal(status.successRate, 0.5);
  assert.equal(status.failureRate, 0.5);
  assert.equal(status.timeoutRate, 0.5);
  assert.equal(status.currentLoad, 0);
  assert.equal(status.maxConcurrent, 2);
  assert.equal(status.loadRatio, 0);
  assert.equal(status.quotaState, 'NORMAL');
  assert.equal(status.circuit, 'CLOSED');
  assert.equal(status.priority, 7);
  assert.equal(status.failover, 'PRIMARY');
  assert.doesNotMatch(JSON.stringify(health), /student-|@example\.com|123456/);
});

test('disabled health exposes reason codes but never credential values', async () => {
  const config = createEmailGatewayConfig({ environment: 'test', providerPolicies: { brevo: { enabled: true, priority: 1, dailyLimit: 100 } } });
  const gateway = await createEmailGateway({ config, env: { BREVO_API_KEY: 'ultra-private-value-never-return', EMAIL_FROM_ADDRESS: 'sender@example.com' }, privatePepper: 'test-private-pepper-000000000000' });
  const health = await gateway.healthCheck();
  const serialized = JSON.stringify(health);
  assert.doesNotMatch(serialized, /ultra-private-value-never-return|sender@example\.com/);
  assert.match(serialized, /ACTIVATION_GATE_CLOSED/);
});
