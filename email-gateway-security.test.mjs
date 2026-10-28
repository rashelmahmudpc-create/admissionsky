import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import pagesWorker from './_worker.js';
import { handleInternalEmailRequest } from './email-gateway/worker/handler.mjs';
import { signInternalRequest, INTERNAL_AUTH_HEADERS } from './email-gateway/core/internal-auth.mjs';
import { createEmailGatewayConfig } from './email-gateway/core/config.mjs';
import { MemoryEmailStore } from './email-gateway/storage/memory-store.mjs';
import { createMockGateway, sampleEmailRequest } from './email-gateway/testing/create-mock-gateway.mjs';
import { MockEmailProvider, mockProviderEntry } from './email-gateway/testing/mock-provider.mjs';
import { EMAIL_FAILURE_CODES } from './email-gateway/core/constants.mjs';
import { createEmailGatewayServiceClient } from './email-gateway/index.mjs';
import {
  REQUIRED_EMAIL_GATEWAY_BINDINGS,
  inventoryCloudflareWorkerBindings,
  summarizeWorkerSecretBindings
} from './email-gateway/operations/inventory-cloudflare-bindings.mjs';
import {
  collectInfisicalWorkerSecrets,
  prepareInfisicalWorkerSecretFile
} from './email-gateway/operations/prepare-infisical-worker-secrets.mjs';

const root = process.cwd();
const read = file => readFileSync(resolve(root, file), 'utf8');
const walk = directory => readdirSync(resolve(root, directory)).flatMap(name => {
  const path = resolve(root, directory, name);
  return statSync(path).isDirectory() ? walk(relative(root, path)) : [relative(root, path).split(sep).join('/')];
});
const emailFiles = walk('email-gateway').filter(file => file.endsWith('.mjs'));
const runtimeFiles = emailFiles.filter(file => !file.includes('/testing/'));
const secret = 'test-signing-secret-that-is-at-least-thirty-two-characters';
let nonceCounter = 0;
const infisicalStageEnvironment = () => Object.fromEntries(REQUIRED_EMAIL_GATEWAY_BINDINGS.map(name => {
  if (name === 'EMAIL_GATEWAY_CONFIG') return [name, JSON.stringify({ environment: 'production', providerPolicies: {} })];
  if (name === 'EMAIL_GATEWAY_SIGNING_SECRET') return [name, 'test-stage-signing-secret-at-least-thirty-two-characters'];
  if (name === 'EMAIL_RECIPIENT_HASH_PEPPER') return [name, 'test-stage-independent-recipient-hash-pepper'];
  if (name === 'EMAIL_PROVIDER_ACTIVATION') return [name, 'disabled'];
  if (name.endsWith('_FROM_ADDRESS')) return [name, `${name.split('_')[0].toLowerCase()}@example.com`];
  if (name.endsWith('_FROM_NAME')) return [name, `AdmissionSky ${name.split("_")[0]}`];
  if (name.endsWith('_SENDER_VERIFIED')) return [name, 'false'];
  return [name, `test-credential-for-${name.toLowerCase()}`];
}));

async function signedRequest({ path = '/internal/email/send', method = 'POST', body = '', timestamp = 1_800_000_000, nonce } = {}) {
  const actualNonce = nonce || `nonce-security-${String(++nonceCounter).padStart(8, '0')}`;
  const signature = await signInternalRequest({ secret, method, path, timestamp: String(timestamp), nonce: actualNonce, bodyText: body });
  return new Request(`https://worker.example${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      [INTERNAL_AUTH_HEADERS.KEY_ID]: 'current',
      [INTERNAL_AUTH_HEADERS.TIMESTAMP]: String(timestamp),
      [INTERNAL_AUTH_HEADERS.NONCE]: actualNonce,
      [INTERNAL_AUTH_HEADERS.SIGNATURE]: signature
    },
    ...(method === 'GET' ? {} : { body })
  });
}

const handlerRuntime = (store, gateway, now = () => 1_800_000_000_000) => ({
  store,
  gateway,
  now,
  signingSecrets: { current: secret },
  config: createEmailGatewayConfig({ environment: 'test', rateLimits: { enabled: false } })
});

test('internal route is hidden when signing secret is absent', async () => {
  const response = await handleInternalEmailRequest(new Request('https://worker/internal/email/health'), {}, {});
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: 'not-found' });
});

test('signed health succeeds without CORS or secret disclosure', async () => {
  const provider = new MockEmailProvider({ id: 'health-provider' });
  const { gateway, store } = await createMockGateway({ entries: [mockProviderEntry(provider)] });
  const request = await signedRequest({ path: '/internal/email/health', method: 'GET', body: '' });
  const response = await handleInternalEmailRequest(request, {}, {}, handlerRuntime(store, gateway));
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.enabledProviders, 1);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), null);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.doesNotMatch(JSON.stringify(body), new RegExp(secret));
});

test('stable server client signs health and send without exposing its secret', async () => {
  const provider = new MockEmailProvider({ id: 'service-client-provider' });
  const { gateway, store } = await createMockGateway({ entries: [mockProviderEntry(provider)] });
  const runtime = handlerRuntime(store, gateway);
  let nonce = 0;
  const client = createEmailGatewayServiceClient({
    origin: 'https://worker.example', signingSecret: secret, now: runtime.now,
    nonce: () => `service-client-nonce-${String(++nonce).padStart(4, '0')}`,
    fetchImpl: (url, init) => handleInternalEmailRequest(new Request(url, init), {}, {}, runtime)
  });
  assert.ok(Object.isFrozen(client));
  assert.doesNotMatch(JSON.stringify(client), new RegExp(secret));
  assert.equal((await client.healthCheck()).enabledProviders, 1);
  assert.equal((await client.send(sampleEmailRequest('0000000000000199'))).status, 'ACCEPTED');
  assert.equal(provider.calls, 1);
});

test('trusted service client bounds hangs and treats send transport loss as uncertain', async () => {
  const hanging = createEmailGatewayServiceClient({
    origin: 'https://worker.example', signingSecret: secret,
    fetchImpl: async () => new Promise(() => {}), nonce: () => 'service-timeout-nonce-0001', timeoutMs: 100,
    setTimer: callback => { queueMicrotask(callback); return 1; }, clearTimer: () => {}
  });
  await assert.rejects(hanging.send(sampleEmailRequest('0000000000000209')), error => error.code === EMAIL_FAILURE_CODES.DELIVERY_UNCERTAIN && error.uncertain);

  const offline = createEmailGatewayServiceClient({
    origin: 'https://worker.example', signingSecret: secret,
    fetchImpl: async () => { throw new TypeError('offline'); }, nonce: () => 'service-offline-nonce-0001'
  });
  await assert.rejects(offline.healthCheck(), error => error.code === EMAIL_FAILURE_CODES.NETWORK_ERROR && !error.uncertain);
});

test('missing, wrong and body-tampered signatures are rejected', async () => {
  const { gateway, store } = await createMockGateway();
  const runtime = handlerRuntime(store, gateway);
  const missing = await handleInternalEmailRequest(new Request('https://worker/internal/email/send', { method: 'POST', body: '{}' }), {}, {}, runtime);
  assert.equal(missing.status, 403);
  const valid = await signedRequest({ body: '{}' });
  valid.headers.set(INTERNAL_AUTH_HEADERS.SIGNATURE, 'A'.repeat(43));
  const wrong = await handleInternalEmailRequest(valid, {}, {}, runtime);
  assert.equal(wrong.status, 403);
  const signed = await signedRequest({ body: '{}' });
  const tampered = new Request(signed.url, { method: 'POST', headers: signed.headers, body: '{"changed":true}' });
  const changed = await handleInternalEmailRequest(tampered, {}, {}, runtime);
  assert.equal(changed.status, 403);
});

test('previous signing key ID supports a bounded rotation window', async () => {
  const previousSecret = 'previous-signing-secret-that-is-also-thirty-two-characters';
  const { gateway, store } = await createMockGateway();
  const timestamp = '1800000000';
  const nonce = 'nonce-previous-key-0001';
  const path = '/internal/email/health';
  const signature = await signInternalRequest({ secret: previousSecret, method: 'GET', path, timestamp, nonce, bodyText: '' });
  const request = new Request(`https://worker${path}`, { headers: {
    [INTERNAL_AUTH_HEADERS.KEY_ID]: 'previous', [INTERNAL_AUTH_HEADERS.TIMESTAMP]: timestamp,
    [INTERNAL_AUTH_HEADERS.NONCE]: nonce, [INTERNAL_AUTH_HEADERS.SIGNATURE]: signature
  } });
  const runtime = handlerRuntime(store, gateway);
  runtime.signingSecrets = { current: secret, previous: previousSecret };
  assert.equal((await handleInternalEmailRequest(request, {}, {}, runtime)).status, 200);
});

test('stale timestamp is rejected before nonce acquisition', async () => {
  const { gateway, store } = await createMockGateway();
  const request = await signedRequest({ body: '{}', timestamp: 1_799_999_000 });
  const response = await handleInternalEmailRequest(request, {}, {}, handlerRuntime(store, gateway));
  assert.equal(response.status, 403);
  assert.equal(store.nonces.size, 0);
});

test('valid signature is single-use and replay returns 409', async () => {
  const provider = new MockEmailProvider({ id: 'replay-provider' });
  const { gateway, store } = await createMockGateway({ entries: [mockProviderEntry(provider)] });
  const body = JSON.stringify(sampleEmailRequest('0000000000000200'));
  const request = await signedRequest({ body, nonce: 'nonce-security-replay-0001' });
  const first = await handleInternalEmailRequest(request.clone(), {}, {}, handlerRuntime(store, gateway));
  const replay = await handleInternalEmailRequest(request.clone(), {}, {}, handlerRuntime(store, gateway));
  assert.equal(first.status, 202);
  assert.equal(replay.status, 409);
  assert.equal((await replay.json()).error.code, EMAIL_FAILURE_CODES.REPLAY_DETECTED);
  assert.equal(provider.calls, 1);
});

test('signed send response and persistence contain no recipient or OTP', async () => {
  const provider = new MockEmailProvider({ id: 'secure-provider' });
  const { gateway, store } = await createMockGateway({ entries: [mockProviderEntry(provider)] });
  const body = JSON.stringify(sampleEmailRequest('0000000000000201', { recipient: 'private.student@example.com', variables: { otp: '987654', name: 'Private Student' } }));
  const response = await handleInternalEmailRequest(await signedRequest({ body }), {}, {}, handlerRuntime(store, gateway));
  assert.equal(response.status, 202);
  const publicBody = JSON.stringify(await response.json());
  const persisted = JSON.stringify([...store.requests.values()]);
  const events = JSON.stringify(await store.listEvents(50));
  for (const output of [publicBody, persisted, events]) {
    assert.doesNotMatch(output, /private\.student@example\.com|987654|Private Student/);
  }
});

test('changing request IDs or one context dimension cannot bypass layered abuse limits', async () => {
  const provider = new MockEmailProvider({ id: 'abuse-provider' });
  const limits = {
    enabled: true,
    recipientWindow: { limit: 2, windowMs: 60000 }, recipientDay: { limit: 20, windowMs: 86400000 },
    ipWindow: { limit: 2, windowMs: 60000 }, accountWindow: { limit: 20, windowMs: 60000 },
    deviceWindow: { limit: 20, windowMs: 60000 }, globalWindow: { limit: 100, windowMs: 60000 }
  };
  const first = await createMockGateway({ entries: [mockProviderEntry(provider)], config: { environment: 'test', rateLimits: limits } });
  await first.gateway.send(sampleEmailRequest('0000000000000250', { recipient: 'one@example.com', context: { ip: '203.0.113.8' } }));
  await first.gateway.send(sampleEmailRequest('0000000000000251', { recipient: 'two@example.com', context: { ip: '203.0.113.8' } }));
  await assert.rejects(first.gateway.send(sampleEmailRequest('0000000000000252', { recipient: 'three@example.com', context: { ip: '203.0.113.8' } })), error => error.code === EMAIL_FAILURE_CODES.RATE_LIMITED);

  const secondProvider = new MockEmailProvider({ id: 'recipient-limit' });
  const second = await createMockGateway({ entries: [mockProviderEntry(secondProvider)], config: { environment: 'test', rateLimits: limits } });
  await second.gateway.send(sampleEmailRequest('0000000000000253', { recipient: 'same@example.com', context: { ip: '203.0.113.10' } }));
  await second.gateway.send(sampleEmailRequest('0000000000000254', { recipient: 'same@example.com', context: { ip: '203.0.113.11' } }));
  await assert.rejects(second.gateway.send(sampleEmailRequest('0000000000000255', { recipient: 'same@example.com', context: { ip: '203.0.113.12' } })), error => error.code === EMAIL_FAILURE_CODES.RATE_LIMITED);
});

test('preflight is hidden and browser callers receive no permissive CORS', async () => {
  const response = await handleInternalEmailRequest(new Request('https://worker/internal/email/send', { method: 'OPTIONS', headers: { Origin: 'https://evil.example' } }), { EMAIL_GATEWAY_SIGNING_SECRET: secret });
  assert.equal(response.status, 404);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), null);
});

test('Cloudflare Pages blocks every internal path before asset or API proxy', async () => {
  let assetReads = 0;
  const env = { ASSETS: { fetch: async () => { assetReads += 1; return new Response('unexpected'); } } };
  for (const path of ['/internal/email/send', '/internal/email/health', '/internal/email/delivery-event', '/internal/anything']) {
    const response = await pagesWorker.fetch(new Request(`https://pages.example${path}`), env);
    assert.equal(response.status, 404);
    assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
  }
  assert.equal(assetReads, 0);
});

test('Cloudflare Pages returns 404 instead of SPA fallback for protected server source', async () => {
  let assetReads = 0;
  const env = { ASSETS: { fetch: async () => { assetReads += 1; return new Response('unexpected'); } } };
  for (const path of ['/worker-bundle.mjs', '/wrangler.toml', '/auth/index.mjs', '/email-gateway/index.mjs', '/docs/private.md', '/.github/workflows/private.yml']) {
    const response = await pagesWorker.fetch(new Request(`https://pages.example${path}`), env);
    assert.equal(response.status, 404, path);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
  }
  assert.equal(assetReads, 0);
});

test('Worker binding inventory reports names only and distinguishes missing activation prerequisites', () => {
  assert.equal(REQUIRED_EMAIL_GATEWAY_BINDINGS.includes('COURIER_API_KEY'), true);
  assert.equal(REQUIRED_EMAIL_GATEWAY_BINDINGS.includes('EMAILOCTOPUS_API_KEY'), false);
  const complete = summarizeWorkerSecretBindings({
    result: [
      ...REQUIRED_EMAIL_GATEWAY_BINDINGS.map(name => ({ name, type: 'secret_text' })),
      { name: 'OTHER_WORKER_SECRET', type: 'secret_text' },
      { name: 'OTHER_WORKER_SECRET', type: 'secret_text' },
      { name: 'invalid name', value: 'must-not-surface' }
    ]
  });
  assert.equal(complete.requiredBindingNamesComplete, true);
  assert.deepEqual(complete.missingRequiredNames, []);
  assert.equal(complete.names.includes('OTHER_WORKER_SECRET'), true);
  assert.doesNotMatch(JSON.stringify(complete), /must-not-surface/);

  const missing = summarizeWorkerSecretBindings({
    result: REQUIRED_EMAIL_GATEWAY_BINDINGS
      .filter(name => name !== 'RESEND_API_KEY')
      .map(name => ({ name, type: 'secret_text' }))
  });
  assert.equal(missing.requiredBindingNamesComplete, false);
  assert.deepEqual(missing.missingRequiredNames, ['RESEND_API_KEY']);
});

test('Cloudflare binding inventory bounds transport and never includes response details in errors', async () => {
  let authorization = '';
  const fetchImpl = async (_url, options) => {
    authorization = options.headers.Authorization;
    return { ok: false, status: 403, json: async () => ({ secret: 'provider-secret-must-not-surface' }) };
  };
  await assert.rejects(
    inventoryCloudflareWorkerBindings({ accountId: 'safe-account-id', apiToken: 'private-api-token', fetchImpl }),
    error => error.message === 'Cloudflare binding inventory request failed (HTTP 403).' &&
      !/private-api-token|provider-secret-must-not-surface/.test(error.message)
  );
  assert.equal(authorization, 'Bearer private-api-token');
});

test('Infisical staging allowlists every required binding and forces activation disabled', () => {
  assert.equal(REQUIRED_EMAIL_GATEWAY_BINDINGS.length, 33);
  assert.equal(REQUIRED_EMAIL_GATEWAY_BINDINGS.includes('EMAIL_RECIPIENT_HASH_PEPPER'), true);
  const env = infisicalStageEnvironment();
  env.UNRELATED_SECRET = 'must-not-enter-payload';
  const payload = collectInfisicalWorkerSecrets(env);
  assert.deepEqual(Object.keys(payload).sort(), [...REQUIRED_EMAIL_GATEWAY_BINDINGS]);
  assert.equal('UNRELATED_SECRET' in payload, false);
  assert.equal(payload.EMAIL_PROVIDER_ACTIVATION, 'disabled');

  const unsafe = { ...env, EMAIL_PROVIDER_ACTIVATION: 'enabled' };
  assert.throws(() => collectInfisicalWorkerSecrets(unsafe), /initial Infisical staging requires/i);
});

test('Infisical staging reports missing names without exposing another value', () => {
  const env = infisicalStageEnvironment();
  const valueThatMustStayPrivate = env.RESEND_API_KEY;
  delete env.COURIER_API_KEY;
  assert.throws(
    () => collectInfisicalWorkerSecrets(env),
    error => /COURIER_API_KEY/.test(error.message) && !error.message.includes(valueThatMustStayPrivate)
  );
});

test('Infisical staging writes only a mode-0600 ephemeral bulk file', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'admission-hub-infisical-'));
  const outputPath = join(directory, 'worker-secrets.json');
  try {
    const result = await prepareInfisicalWorkerSecretFile({ env: infisicalStageEnvironment(), outputPath });
    assert.equal(result.bindingCount, 33);
    assert.equal(result.activation, 'disabled');
    assert.equal(statSync(outputPath).mode & 0o777, 0o600);
    assert.deepEqual(Object.keys(JSON.parse(readFileSync(outputPath, 'utf8'))).sort(), [...REQUIRED_EMAIL_GATEWAY_BINDINGS]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('oversized body is rejected without provider call', async () => {
  const provider = new MockEmailProvider({ id: 'size-provider' });
  const { gateway, store } = await createMockGateway({ entries: [mockProviderEntry(provider)] });
  const runtime = handlerRuntime(store, gateway);
  runtime.config = createEmailGatewayConfig({ environment: 'test', rateLimits: { enabled: false }, request: { maxBodyBytes: 1024 } });
  const body = JSON.stringify({ payload: 'x'.repeat(1500) });
  const response = await handleInternalEmailRequest(await signedRequest({ body }), {}, {}, runtime);
  assert.equal(response.status, 413);
  assert.equal(provider.calls, 0);
});

test('provider error details are redacted at the internal boundary', async () => {
  const provider = new MockEmailProvider({ id: 'leaky', onSend: () => { throw new Error('API key private-provider-key recipient secret@example.com'); } });
  const { gateway, store } = await createMockGateway({ entries: [mockProviderEntry(provider)] });
  const body = JSON.stringify(sampleEmailRequest('0000000000000202'));
  const response = await handleInternalEmailRequest(await signedRequest({ body }), {}, {}, handlerRuntime(store, gateway));
  const text = await response.text();
  assert.equal(response.status, 500);
  assert.doesNotMatch(text, /private-provider-key|secret@example\.com/);
  assert.match(text, /DELIVERY_UNCERTAIN/);
});

test('Email Gateway runtime has no browser persistence, logs or dynamic code execution', () => {
  const source = runtimeFiles.map(read).join('\n');
  assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB|document\.cookie/i);
  assert.doesNotMatch(source, /console\.(?:log|info|warn|error|debug)\s*\(/);
  assert.doesNotMatch(source, /eval\s*\(|new Function\s*\(/);
  assert.doesNotMatch(source, /-----BEGIN [A-Z ]+PRIVATE KEY-----|Bearer\s+[A-Za-z0-9._-]{24,}/);
});

test('frontend, Auth Core and Pages worker never import provider implementations', () => {
  const candidates = ['index.html', 'sw.js', '_worker.js', 'public-worker.js', ...walk('auth').filter(file => file.endsWith('.mjs') && !file.includes('/testing/'))];
  const violations = candidates.filter(file => /email-gateway\/(?:providers|core|storage|worker)|BREVO_API_KEY|RESEND_API_KEY|EMAIL_GATEWAY_SIGNING_SECRET/.test(read(file)));
  assert.deepEqual(violations, []);
  assert.match(read('gk-agent-worker.js'), /email-gateway\/worker\/handler\.mjs/);
});

test('Cloudflare static bundle excludes all server-only infrastructure', () => {
  const workflow = read('.github/workflows/cf-pages.yml');
  for (const excluded of ['auth', 'email-gateway', 'gk-agent-worker.js', 'public-worker.js', 'ai-agent.js', 'worker-bundle.mjs', 'wrangler.toml']) {
    assert.match(workflow, new RegExp(`--exclude='${excluded.replace('.', '\\.')}'`));
  }
});

test('protection contract, required operations docs, CODEOWNERS and CI guard exist', () => {
  const required = [
    'email-gateway/EMAIL_GATEWAY_PROTECTION_CONTRACT.md',
    'docs/email-gateway/EMAIL_ARCHITECTURE.md', 'docs/email-gateway/PROVIDER_SETUP.md',
    'docs/email-gateway/FAILOVER_POLICY.md', 'docs/email-gateway/SECURITY.md',
    'docs/email-gateway/OPERATIONS.md', 'docs/email-gateway/TESTING.md', 'docs/email-gateway/INFISICAL_SETUP.md',
    '.github/workflows/email-gateway-guard.yml', '.github/workflows/email-gateway-deploy.yml',
    '.github/workflows/email-gateway-infisical-sync.yml',
    'email-gateway/operations/telegram-notifier.mjs', 'email-gateway/operations/notify-telegram.mjs',
    'email-gateway/operations/prepare-infisical-worker-secrets.mjs'
  ];
  assert.ok(required.every(file => existsSync(resolve(root, file))));
  const owners = read('.github/CODEOWNERS');
  assert.match(owners, /\/email-gateway\/\s+@sheikhrashel47-stack/);
  assert.match(owners, /\/worker-bundle\.mjs\s+@sheikhrashel47-stack/);
  const workflow = read('.github/workflows/email-gateway-guard.yml');
  assert.match(workflow, /npm run test:email/);
  assert.match(workflow, /npm run test:auth/);
  assert.match(workflow, /npm run check:worker-bundle/);
  const deploy = read('.github/workflows/email-gateway-deploy.yml');
  assert.match(deploy, /workflow_dispatch/);
  assert.match(deploy, /inputs\.confirmation == 'DEPLOY'/);
  assert.match(deploy, /command: deploy --config wrangler\.toml/);
  assert.match(deploy, /npm run notify:telegram/);
  assert.doesNotMatch(deploy, /RESEND_API_KEY|BREVO_API_KEY|MAILJET_API_KEY|MAILTRAP_API_KEY|MAILERSEND_API_KEY|SENDPULSE_API_KEY|EMAILOCTOPUS_API_KEY|COURIER_API_KEY/);
  const infisical = read('.github/workflows/email-gateway-infisical-sync.yml');
  assert.match(infisical, /id-token: write/);
  assert.match(infisical, /inputs\.confirmation == 'STAGE_INFISICAL_SECRETS'/);
  assert.match(infisical, /environment: email-gateway-production/);
  // The contract is "pinned to a full commit SHA", not "pinned to one exact SHA".
  // Hard-coding the literal digests made every Dependabot bump (e.g. PR #218) fail
  // here without adding any safety, so the guard checks the shape instead.
  assert.match(infisical, /actions\/checkout@[0-9a-f]{40}(?![0-9a-f])/);
  assert.match(infisical, /actions\/setup-node@[0-9a-f]{40}(?![0-9a-f])/);
  assert.match(infisical, /Infisical\/secrets-action@[0-9a-f]{40}(?![0-9a-f])/);
  assert.match(infisical, /cloudflare\/wrangler-action@[0-9a-f]{40}(?![0-9a-f])/);
  assert.match(infisical, /EMAIL_GATEWAY_REQUIRE_COMPLETE_BINDINGS: 'true'/);
  assert.match(infisical, /Remove ephemeral secret payload[\s\S]*if: \$\{\{ always\(\) \}\}/);
  assert.doesNotMatch(infisical, /client-secret:|INFISICAL_TOKEN/);
  assert.equal(existsSync(resolve(root, '.github/workflows/main.yml')), false, 'legacy unguarded Worker deploy must stay retired');
});

test('Durable Object binding is explicit and no email credential is stored in wrangler config', () => {
  const wrangler = read('wrangler.toml');
  assert.match(wrangler, /name = "EMAIL_COORDINATOR"/);
  assert.match(wrangler, /class_name = "EmailGatewayCoordinator"/);
  assert.match(wrangler, /new_sqlite_classes = \["EmailGatewayCoordinator"\]/);
  assert.match(wrangler, /binding = "GK_KV"/);
  assert.match(wrangler, /crons = \["\* \* \* \* \*"\]/); /* Phase 2 (2026-09-17): every-minute cron runs the global notification scheduler; GK stays date-guarded */
  assert.doesNotMatch(wrangler, /EMAIL_GATEWAY_SIGNING_SECRET|RECIPIENT_HASH_PEPPER|API_KEY|PASSWORD|TOKEN/);
});

test('public server entry exports contract/constants but no router, store or adapter class', () => {
  const index = read('email-gateway/index.mjs');
  assert.match(index, /createEmailGateway/);
  assert.doesNotMatch(index, /EmailRouter|MemoryEmailStore|DurableObjectEmailStore|BrevoProvider|ProviderRegistry/);
});

test('all server modules parse/import without credential-bearing globals', async () => {
  for (const file of runtimeFiles) await import(pathToFileURL(resolve(root, file)).href);
});
