import { chmod, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { safeParseEmailGatewayConfig } from '../../email-gateway/core/config.mjs';

const WORKER_NAME = 'admission-gk';
const CLOUDFLARE_API = 'https://api.cloudflare.com/client/v4';
const MAILJET_BASES = new Set(['https://api.mailjet.com', 'https://api.us.mailjet.com']);
const REQUIRED_MAILJET = Object.freeze(['MAILJET_API_KEY', 'MAILJET_SECRET_KEY']);
const PRESERVED_SECRETS = Object.freeze(['AUTH_HMAC_SECRET', 'EMAIL_INTERNAL_SECRET', 'EMAIL_PRIVATE_PEPPER']);
const PROVIDERS = Object.freeze(['resend', 'brevo', 'mailjet', 'mailtrap', 'mailersend', 'sendpulse', 'emailoctopus', 'courier']);

const required = (env, name) => {
  const value = String(env[name] || '').trim();
  if (!value) throw new Error(`Required environment value is missing: ${name}.`);
  return value;
};

const token = () => randomBytes(48).toString('base64url');
const basicAuthorization = (username, password) => `Basic ${Buffer.from(`${username}:${password}`, 'utf8').toString('base64')}`;

async function fetchJson(url, options, fetchImpl) {
  const response = await fetchImpl(url, { ...options, signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`Bounded provider or deployment metadata request failed with status ${response.status}.`);
  try { return await response.json(); } catch { throw new Error('Bounded provider or deployment metadata response was invalid.'); }
}

const validIndividualAddress = address => Boolean(
  address
  && !address.startsWith('*@')
  && !/@(?:[^@.]+\.)*pages\.dev$/i.test(address)
  && /^[^\s@<>]{1,64}@[^\s@<>]{1,190}\.[A-Za-z]{2,63}$/.test(address)
);

async function activeSendersForCredentials({ apiBase, apiKey, secretKey, fetchImpl }) {
  const requestOptions = {
    method: 'GET',
    headers: { Accept: 'application/json', Authorization: basicAuthorization(apiKey, secretKey), 'Cache-Control': 'no-store' }
  };
  const senderPayload = await fetchJson(`${apiBase}/v3/REST/sender?Limit=1000`, requestOptions, fetchImpl);
  let metaPayload = null;
  try {
    metaPayload = await fetchJson(`${apiBase}/v3/REST/metasender?Limit=1000`, requestOptions, fetchImpl);
  } catch {}
  const senders = Array.isArray(senderPayload?.Data) ? senderPayload.Data : [];
  const metaSenders = Array.isArray(metaPayload?.Data) ? metaPayload.Data : [];
  return [
    ...senders.map(record => ({
      address: String(record?.Email || record?.SenderEmail || '').trim().toLowerCase(),
      active: ['active', 'validated'].includes(String(record?.Status || '').trim().toLowerCase()),
      isDefault: record?.IsDefaultSender === true || record?.IsDefaultSender === 1,
      source: 'sender', apiKey, secretKey
    })),
    ...metaSenders.map(record => ({
      address: String(record?.Email || '').trim().toLowerCase(),
      active: record?.IsEnabled === true || record?.IsEnabled === 1 || String(record?.IsEnabled || '').toLowerCase() === 'true',
      isDefault: false,
      source: 'metasender', apiKey, secretKey
    }))
  ].filter(record => record.active && validIndividualAddress(record.address));
}

function repositorySenderCandidates(env) {
  let authors = '';
  try {
    authors = execFileSync('git', ['log', '--all', '--format=%ae', '-n', '200'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000
    });
  } catch {}
  return [
    env.MAILJET_FROM_ADDRESS,
    env.EMAIL_FROM_ADDRESS,
    env.RESEND_FROM_ADDRESS,
    env.BREVO_FROM_ADDRESS,
    ...String(authors).split(/\r?\n/)
  ].map(value => String(value || '').trim().toLowerCase())
    .filter(address => validIndividualAddress(address)
      && !/users\.noreply\.github\.com$/i.test(address)
      && !/(?:^|[.@+-])(?:bot|actions)(?:[.@+-]|$)/i.test(address))
    .filter((address, index, list) => list.indexOf(address) === index)
    .slice(0, 8);
}

async function sandboxValidatesSender({ apiBase, apiKey, secretKey, address, fetchImpl }) {
  try {
    const response = await fetchImpl(`${apiBase}/v3.1/send`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: basicAuthorization(apiKey, secretKey),
        'Cache-Control': 'no-store'
      },
      body: JSON.stringify({
        SandboxMode: true,
        Messages: [{
          From: { Email: address, Name: 'Admission Sky' },
          To: [{ Email: address }],
          Subject: 'Admission Sky sender validation',
          TextPart: 'Sandbox validation only. No message is delivered.'
        }]
      }),
      signal: AbortSignal.timeout(15_000)
    });
    if (!response.ok) return false;
    const payload = await response.json();
    return Array.isArray(payload?.Messages) && payload.Messages.some(message =>
      String(message?.Status || '').toLowerCase() === 'success'
      && (!Array.isArray(message?.Errors) || message.Errors.length === 0)
    );
  } catch { return false; }
}

export async function discoverActiveMailjetSender({ env = process.env, fetchImpl = globalThis.fetch, senderCandidates } = {}) {
  const apiKey = required(env, 'MAILJET_API_KEY');
  const secretKey = required(env, 'MAILJET_SECRET_KEY');
  const apiBase = MAILJET_BASES.has(String(env.MAILJET_API_BASE || '').trim()) ? String(env.MAILJET_API_BASE).trim() : 'https://api.mailjet.com';
  let active = await activeSendersForCredentials({ apiBase, apiKey, secretKey, fetchImpl });
  const credentialSets = [{ apiKey, secretKey }];

  if (!active.length) {
    let apiKeysPayload = null;
    try {
      apiKeysPayload = await fetchJson(`${apiBase}/v3/REST/apikey?Limit=50`, {
        method: 'GET',
        headers: { Accept: 'application/json', Authorization: basicAuthorization(apiKey, secretKey), 'Cache-Control': 'no-store' }
      }, fetchImpl);
    } catch {}
    const candidates = (Array.isArray(apiKeysPayload?.Data) ? apiKeysPayload.Data : [])
      .map(record => ({
        apiKey: String(record?.APIKey || '').trim(),
        secretKey: String(record?.SecretKey || '').trim(),
        active: !['false', '0', 'inactive'].includes(String(record?.IsActive ?? 'true').toLowerCase())
      }))
      .filter(candidate => candidate.active
        && candidate.apiKey.length >= 8 && candidate.apiKey.length <= 256
        && candidate.secretKey.length >= 8 && candidate.secretKey.length <= 256
        && !/[\r\n\u0000]/.test(candidate.apiKey + candidate.secretKey)
        && (candidate.apiKey !== apiKey || candidate.secretKey !== secretKey))
      .slice(0, 12);
    credentialSets.push(...candidates.map(({ apiKey: candidateKey, secretKey: candidateSecret }) => ({ apiKey: candidateKey, secretKey: candidateSecret })));
    for (let offset = 0; offset < candidates.length; offset += 4) {
      const group = await Promise.all(candidates.slice(offset, offset + 4).map(async candidate => {
        try { return await activeSendersForCredentials({ apiBase, ...candidate, fetchImpl }); }
        catch { return []; }
      }));
      active.push(...group.flat());
    }
  }

  let sandboxValidated = false;
  if (!active.length) {
    const addresses = (senderCandidates || repositorySenderCandidates(env))
      .map(value => String(value || '').trim().toLowerCase())
      .filter((address, index, list) => validIndividualAddress(address) && list.indexOf(address) === index)
      .slice(0, 8);
    outer: for (const credentials of credentialSets.slice(0, 4)) {
      for (const address of addresses) {
        if (await sandboxValidatesSender({ apiBase, ...credentials, address, fetchImpl })) {
          // SandboxMode proves that the payload is structurally valid and never delivers.
          // It does not prove that Mailjet will admit a message into its delivery pipeline.
          sandboxValidated = true;
          break outer;
        }
      }
    }
  }

  const unique = [...new Map(active.map(record => [`${record.address}:${record.apiKey}`, record])).values()];
  if (!unique.length) throw new Error(sandboxValidated
    ? 'Mailjet SandboxMode validated a payload, but no API-listed Active individual sender is available to the authorized API-key set.'
    : 'Mailjet has no Active individual sender listed by the authorized API-key set.');
  const configured = String(env.MAILJET_FROM_ADDRESS || '').trim().toLowerCase();
  unique.sort((left, right) => {
    const score = record => (record.address === configured ? 100 : 0)
      + (record.apiKey === apiKey ? 30 : 0)
      + (record.isDefault ? 20 : 0)
      + (record.source === 'sender' ? 5 : 0);
    return score(right) - score(left) || left.address.localeCompare(right.address);
  });
  const selected = unique[0];
  return Object.freeze({
    apiBase,
    apiKey: selected.apiKey,
    secretKey: selected.secretKey,
    address: selected.address,
    name: 'Admission Sky',
    evidence: 'api'
  });
}

export async function listWorkerSecretNames({ accountId, apiToken, fetchImpl = globalThis.fetch } = {}) {
  const payload = await fetchJson(
    `${CLOUDFLARE_API}/accounts/${encodeURIComponent(accountId)}/workers/scripts/${WORKER_NAME}/secrets`,
    { method: 'GET', headers: { Accept: 'application/json', Authorization: `Bearer ${apiToken}` } },
    fetchImpl
  );
  if (payload?.success !== true || !Array.isArray(payload.result)) throw new Error('Cloudflare secret inventory response was unsuccessful.');
  return new Set(payload.result.map(item => String(item?.name || '')).filter(Boolean));
}

export function productionEmailGatewayConfig() {
  const providerPolicies = Object.fromEntries(PROVIDERS.map((provider, index) => [provider, {
    enabled: provider === 'mailjet',
    priority: index + 1,
    weight: 1,
    dailyLimit: provider === 'mailjet' ? 200 : 0,
    monthlyLimit: provider === 'mailjet' ? 6000 : 0,
    timeoutMs: 6500,
    maxConcurrent: provider === 'mailjet' ? 5 : 1,
    emergency: false,
    costWeight: provider === 'mailjet' ? 0 : 100
  }]));
  return Object.freeze({
    environment: 'production',
    router: {
      mode: 'priority', maxProviderAttempts: 1, globalDeadlineMs: 9000,
      defaultProviderTimeoutMs: 6500, emergencyMaxAttempts: 0
    },
    providerPolicies
  });
}

export async function prepareProductionSecrets({ env = process.env, fetchImpl = globalThis.fetch, randomSecret = token } = {}) {
  for (const name of REQUIRED_MAILJET) required(env, name);
  const accountId = required(env, 'CLOUDFLARE_ACCOUNT_ID');
  const apiToken = required(env, 'CLOUDFLARE_API_TOKEN');
  const selected = await discoverActiveMailjetSender({ env, fetchImpl });
  const existing = await listWorkerSecretNames({ accountId, apiToken, fetchImpl });
  const config = productionEmailGatewayConfig();
  safeParseEmailGatewayConfig(JSON.stringify(config));

  const output = {
    MAILJET_API_KEY: selected.apiKey,
    MAILJET_SECRET_KEY: selected.secretKey,
    MAILJET_API_BASE: selected.apiBase,
    MAILJET_FROM_ADDRESS: selected.address,
    MAILJET_FROM_NAME: selected.name,
    MAILJET_SENDER_VERIFIED: 'true',
    MAILJET_SANDBOX_SENDER_VERIFIED: selected.evidence === 'sandbox' ? 'true' : 'false',
    EMAIL_PROVIDER_ACTIVATION: 'enabled',
    EMAIL_GATEWAY_CONFIG: JSON.stringify(config)
  };
  for (const name of PRESERVED_SECRETS) if (!existing.has(name)) output[name] = randomSecret();
  return Object.freeze({
    secrets: Object.freeze(output),
    generated: Object.freeze(PRESERVED_SECRETS.filter(name => !existing.has(name))),
    reused: Object.freeze(PRESERVED_SECRETS.filter(name => existing.has(name)))
  });
}

async function main({ env = process.env, fetchImpl = globalThis.fetch, stdout = process.stdout } = {}) {
  const destination = required(env, 'AUTH_SECRET_BULK_FILE');
  const prepared = await prepareProductionSecrets({ env, fetchImpl });
  await writeFile(destination, `${JSON.stringify(prepared.secrets)}\n`, { mode: 0o600 });
  await chmod(destination, 0o600);
  stdout.write(`NATIVE_AUTH_ACTIVATION prepared=${Object.keys(prepared.secrets).length} generated=${prepared.generated.length} reused=${prepared.reused.length} mailjetSender=api-active-private-selection dailyLimit=200 monthlyLimit=6000 valuesPrinted=false\n`);
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (invokedPath === import.meta.url) {
  main().catch(error => {
    process.stderr.write(`::error title=Native Auth production secret preparation failed::${error.message}\n`);
    process.exitCode = 1;
  });
}
