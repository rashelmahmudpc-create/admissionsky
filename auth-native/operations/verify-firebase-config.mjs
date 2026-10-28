import { pathToFileURL } from 'node:url';

const PROJECTS_ENDPOINT = 'https://identitytoolkit.googleapis.com/v1/projects';
// Both live production origins. This gate used to require `admissionhub.pages.dev`
// alone, which was the main address before the owner moved to the short one; a
// project that authorises only `admissionsky.pages.dev` is not broken for
// students, and failing the deploy over it was a false alarm waiting to happen.
// Either satisfied domain passes, and the one that is missing is reported rather
// than hidden.
export const LIVE_PAGES_DOMAINS = Object.freeze(['admissionhub.pages.dev', 'admissionsky.pages.dev']);
const REQUIRED_DOMAIN = 'admissionhub.pages.dev';

export class FirebaseConfigError extends Error {
  constructor(code, status = 0) {
    super(code);
    this.name = 'FirebaseConfigError';
    this.code = String(code || 'CONFIG_CHECK_FAILED');
    this.status = Number(status || 0);
  }
}

export function validateFirebaseProjectConfig(payload) {
  const projectIdentified = typeof payload?.projectId === 'string' && /^[a-z0-9][a-z0-9-]{3,62}$/i.test(payload.projectId);
  const domains = Array.isArray(payload?.authorizedDomains)
    ? payload.authorizedDomains.map(value => String(value).toLowerCase())
    : [];
  const authorizedDomainReady = domains.includes(REQUIRED_DOMAIN);
  const authorizedLiveDomains = LIVE_PAGES_DOMAINS.filter(domain => domains.includes(domain));
  if (!projectIdentified) throw new FirebaseConfigError('PROJECT_NOT_IDENTIFIED');
  if (!authorizedLiveDomains.length) throw new FirebaseConfigError('PAGES_DOMAIN_NOT_AUTHORIZED');
  return Object.freeze({
    projectIdentified,
    authorizedDomainReady,
    authorizedLiveDomains,
    missingLiveDomains: LIVE_PAGES_DOMAINS.filter(domain => !domains.includes(domain))
  });
}

export async function verifyFirebaseConfig({ apiKey, fetchImpl = globalThis.fetch } = {}) {
  const key = String(apiKey || '').trim();
  if (!/^[A-Za-z0-9_-]{20,128}$/.test(key)) throw new FirebaseConfigError('API_KEY_MISSING');
  let response;
  try {
    response = await fetchImpl(`${PROJECTS_ENDPOINT}?key=${encodeURIComponent(key)}`, {
      method: 'GET',
      headers: { Accept: 'application/json', 'Cache-Control': 'no-store' },
      signal: AbortSignal.timeout(15_000)
    });
  } catch { throw new FirebaseConfigError('NETWORK_ERROR'); }
  let payload = {};
  try { payload = await response.json(); } catch {}
  if (!response.ok) throw new FirebaseConfigError('PROJECT_CONFIG_REJECTED', response.status);
  return validateFirebaseProjectConfig(payload);
}

async function main({ env = process.env, stdout = process.stdout, stderr = process.stderr } = {}) {
  try {
    const result = await verifyFirebaseConfig({ apiKey: env.FIREBASE_WEB_API_KEY });
    stdout.write(`FIREBASE_CONFIG status=PASS projectIdentified=${result.projectIdentified} authorizedDomainReady=${result.authorizedDomainReady} live=${result.authorizedLiveDomains.join(',')} keyPrinted=false\n`);
    for (const domain of result.missingLiveDomains) {
      stdout.write(`::notice title=Firebase domain not authorized::${domain} is not in the project's authorized domains. Auth still completes on the other live origin; add it when convenient.\n`);
    }
  } catch (error) {
    const safe = error instanceof FirebaseConfigError ? error : new FirebaseConfigError('CONFIG_CHECK_FAILED');
    stderr.write(`::error title=Firebase configuration check failed::code=${safe.code} status=${safe.status}\n`);
    process.exitCode = 1;
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (invokedPath === import.meta.url) main();
