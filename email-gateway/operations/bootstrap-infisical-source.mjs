import { randomBytes as nodeRandomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { safeParseEmailGatewayConfig } from '../core/config.mjs';

const INFISICAL_DOMAIN = 'https://app.infisical.com';
const INFISICAL_ENVIRONMENT = 'prod';
const INFISICAL_SECRET_PATH = '/email-gateway';
const PROVIDER_PREFIXES = Object.freeze([
  'RESEND', 'BREVO', 'MAILJET', 'MAILTRAP', 'MAILERSEND', 'SENDPULSE', 'COURIER'
]);
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_JSON_BYTES = 512 * 1024;

const SAFE_GATEWAY_CONFIG = JSON.stringify({
  environment: 'production',
  providerPolicies: {
    resend: { enabled: false, priority: 10, dailyLimit: 1, monthlyLimit: 1 },
    brevo: { enabled: false, priority: 20, dailyLimit: 1, monthlyLimit: 1 },
    mailjet: { enabled: false, priority: 30, dailyLimit: 1, monthlyLimit: 1 },
    mailtrap: { enabled: false, priority: 40, dailyLimit: 1, monthlyLimit: 1 },
    mailersend: { enabled: false, priority: 50, dailyLimit: 1, monthlyLimit: 1 },
    sendpulse: { enabled: false, priority: 60, dailyLimit: 1, monthlyLimit: 1 },
    courier: { enabled: false, priority: 80, dailyLimit: 1, monthlyLimit: 1 },
    emailoctopus: { enabled: false, priority: 70, dailyLimit: 0, monthlyLimit: 0 }
  }
});

const FIXED_SAFE_VALUES = Object.freeze({
  EMAIL_PROVIDER_ACTIVATION: 'disabled',
  EMAIL_GATEWAY_CONFIG: SAFE_GATEWAY_CONFIG,
  ...Object.fromEntries(PROVIDER_PREFIXES.flatMap(prefix => [
    [`${prefix}_FROM_NAME`, 'AdmissionSky'],
    [`${prefix}_SENDER_VERIFIED`, 'false']
  ]))
});

export const INFISICAL_SAFE_BOOTSTRAP_NAMES = Object.freeze([
  'EMAIL_GATEWAY_SIGNING_SECRET',
  'EMAIL_RECIPIENT_HASH_PEPPER',
  ...Object.keys(FIXED_SAFE_VALUES)
].sort());

class SafeBootstrapError extends Error {
  constructor(code) {
    super(code);
    this.name = 'SafeBootstrapError';
    this.code = code;
  }
}

const fail = code => { throw new SafeBootstrapError(code); };
const validUuid = value => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const validProjectSlug = value => /^[a-z0-9](?:[a-z0-9-]{1,126}[a-z0-9])?$/.test(value);

function requireMetadata(env) {
  if (env.INFISICAL_DOMAIN !== INFISICAL_DOMAIN) fail('INFISICAL_DOMAIN_NOT_ALLOWED');
  if (env.INFISICAL_ENV_SLUG !== INFISICAL_ENVIRONMENT) fail('INFISICAL_ENVIRONMENT_NOT_ALLOWED');
  if (env.INFISICAL_SECRET_PATH !== INFISICAL_SECRET_PATH) fail('INFISICAL_PATH_NOT_ALLOWED');
  if (!validUuid(String(env.INFISICAL_IDENTITY_ID || ''))) fail('INFISICAL_IDENTITY_ID_INVALID');
  if (!validProjectSlug(String(env.INFISICAL_PROJECT_SLUG || ''))) fail('INFISICAL_PROJECT_SLUG_INVALID');
  if (!env.ACTIONS_ID_TOKEN_REQUEST_TOKEN) fail('GITHUB_OIDC_REQUEST_TOKEN_MISSING');
  let oidcUrl;
  try { oidcUrl = new URL(env.ACTIONS_ID_TOKEN_REQUEST_URL); } catch { fail('GITHUB_OIDC_REQUEST_URL_INVALID'); }
  if (oidcUrl.protocol !== 'https:' || !oidcUrl.hostname.endsWith('.actions.githubusercontent.com')) {
    fail('GITHUB_OIDC_REQUEST_URL_NOT_ALLOWED');
  }
  return Object.freeze({
    domain: env.INFISICAL_DOMAIN,
    environment: env.INFISICAL_ENV_SLUG,
    secretPath: env.INFISICAL_SECRET_PATH,
    identityId: env.INFISICAL_IDENTITY_ID,
    projectSlug: env.INFISICAL_PROJECT_SLUG,
    oidcRequestToken: env.ACTIONS_ID_TOKEN_REQUEST_TOKEN,
    oidcUrl
  });
}

async function request(fetchImpl, url, options = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort('bounded-request-timeout'), timeoutMs);
  try {
    return await fetchImpl(url, { ...options, signal: controller.signal, redirect: 'error' });
  } catch {
    fail('BOUNDED_REMOTE_REQUEST_FAILED');
  } finally {
    clearTimeout(timer);
  }
}

async function readJson(response, failureCode) {
  if (!response.ok) fail(`${failureCode}_HTTP_${response.status}`);
  const declaredLength = Number(response.headers?.get?.('content-length') || 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_JSON_BYTES) fail(`${failureCode}_RESPONSE_TOO_LARGE`);
  let text;
  try { text = await response.text(); } catch { fail(`${failureCode}_RESPONSE_UNREADABLE`); }
  if (Buffer.byteLength(text, 'utf8') > MAX_JSON_BYTES) fail(`${failureCode}_RESPONSE_TOO_LARGE`);
  try { return JSON.parse(text); } catch { fail(`${failureCode}_RESPONSE_INVALID`); }
}

async function loginWithGithubOidc(fetchImpl, metadata) {
  const githubResponse = await request(fetchImpl, metadata.oidcUrl, {
    method: 'GET',
    headers: { authorization: `Bearer ${metadata.oidcRequestToken}`, accept: 'application/json' }
  });
  const githubBody = await readJson(githubResponse, 'GITHUB_OIDC_TOKEN_REQUEST_FAILED');
  if (typeof githubBody.value !== 'string' || githubBody.value.length < 100) fail('GITHUB_OIDC_TOKEN_RESPONSE_INVALID');

  const loginBody = new URLSearchParams({ identityId: metadata.identityId, jwt: githubBody.value });
  const loginResponse = await request(fetchImpl, `${metadata.domain}/api/v1/auth/oidc-auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: loginBody.toString()
  });
  const login = await readJson(loginResponse, 'INFISICAL_OIDC_LOGIN_FAILED');
  if (typeof login.accessToken !== 'string' || login.accessToken.length < 20) fail('INFISICAL_ACCESS_TOKEN_INVALID');
  return login.accessToken;
}

const bearer = token => ({ authorization: `Bearer ${token}`, accept: 'application/json' });

async function getProject(fetchImpl, metadata, accessToken) {
  const response = await request(fetchImpl, `${metadata.domain}/api/v1/projects/slug/${encodeURIComponent(metadata.projectSlug)}`, {
    method: 'GET', headers: bearer(accessToken)
  });
  const body = await readJson(response, 'INFISICAL_PROJECT_LOOKUP_FAILED');
  const project = body.project || body;
  if (!validUuid(String(project.id || '')) || project.slug !== metadata.projectSlug) fail('INFISICAL_PROJECT_RESPONSE_INVALID');
  if (!Array.isArray(project.environments) || !project.environments.some(item => item?.slug === metadata.environment)) {
    fail('INFISICAL_PRODUCTION_ENVIRONMENT_NOT_FOUND');
  }
  return project.id;
}

async function listSecretNames(fetchImpl, metadata, accessToken) {
  const url = new URL(`${metadata.domain}/api/v3/secrets/raw`);
  url.search = new URLSearchParams({
    workspaceSlug: metadata.projectSlug,
    environment: metadata.environment,
    secretPath: metadata.secretPath,
    include_imports: 'false',
    recursive: 'false',
    expandSecretReferences: 'false',
    viewSecretValue: 'false'
  }).toString();
  const response = await request(fetchImpl, url, { method: 'GET', headers: bearer(accessToken) });
  const body = await readJson(response, 'INFISICAL_SOURCE_INVENTORY_FAILED');
  if (!Array.isArray(body.secrets)) fail('INFISICAL_SOURCE_INVENTORY_INVALID');
  return new Set(body.secrets.map(item => item?.secretKey).filter(name => typeof name === 'string'));
}

function buildSecrets(randomBytes) {
  const generated = () => randomBytes(48).toString('base64url');
  const values = {
    ...FIXED_SAFE_VALUES,
    EMAIL_GATEWAY_SIGNING_SECRET: generated(),
    EMAIL_RECIPIENT_HASH_PEPPER: generated()
  };
  safeParseEmailGatewayConfig(values.EMAIL_GATEWAY_CONFIG);
  return INFISICAL_SAFE_BOOTSTRAP_NAMES.map(secretKey => ({
    secretKey,
    secretValue: values[secretKey],
    skipMultilineEncoding: true,
    secretComment: 'Admission Sky protected OIDC bootstrap; activation disabled'
  }));
}

async function createBatch(fetchImpl, metadata, accessToken, projectId, secrets) {
  const response = await request(fetchImpl, `${metadata.domain}/api/v4/secrets/batch`, {
    method: 'POST',
    headers: { ...bearer(accessToken), 'content-type': 'application/json' },
    body: JSON.stringify({
      projectId,
      environment: metadata.environment,
      secretPath: metadata.secretPath,
      secrets
    })
  });
  if (!response.ok) fail(`INFISICAL_SAFE_BATCH_CREATE_FAILED_HTTP_${response.status}`);
  try { await response.body?.cancel?.(); } catch { /* response details may contain values and are never consumed */ }
}

export async function bootstrapInfisicalSafeSource({
  env = process.env,
  fetchImpl = globalThis.fetch,
  randomBytes = nodeRandomBytes,
  stdout = process.stdout
} = {}) {
  if (typeof fetchImpl !== 'function') fail('FETCH_IMPLEMENTATION_MISSING');
  const metadata = requireMetadata(env);
  const accessToken = await loginWithGithubOidc(fetchImpl, metadata);
  const projectId = await getProject(fetchImpl, metadata, accessToken);
  const before = await listSecretNames(fetchImpl, metadata, accessToken);
  const existing = INFISICAL_SAFE_BOOTSTRAP_NAMES.filter(name => before.has(name));
  if (existing.length) fail(`INFISICAL_BOOTSTRAP_REFUSES_OVERWRITE_${existing.sort().join('_')}`);

  const secrets = buildSecrets(randomBytes);
  await createBatch(fetchImpl, metadata, accessToken, projectId, secrets);
  const after = await listSecretNames(fetchImpl, metadata, accessToken);
  const missing = INFISICAL_SAFE_BOOTSTRAP_NAMES.filter(name => !after.has(name));
  if (missing.length) fail(`INFISICAL_BOOTSTRAP_VERIFICATION_MISSING_${missing.sort().join('_')}`);

  stdout.write(`INFISICAL_SAFE_BOOTSTRAP_COMPLETED names=${INFISICAL_SAFE_BOOTSTRAP_NAMES.length} credentials=none activation=disabled senderVerified=false\n`);
  return Object.freeze({ names: INFISICAL_SAFE_BOOTSTRAP_NAMES.length, activation: 'disabled', credentials: 'none' });
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (invokedPath === import.meta.url) {
  bootstrapInfisicalSafeSource().catch(error => {
    const code = error instanceof SafeBootstrapError ? error.code : 'UNEXPECTED_SAFE_BOOTSTRAP_FAILURE';
    process.stderr.write(`::error title=Infisical safe bootstrap failed::${code}\n`);
    process.exitCode = 1;
  });
}
