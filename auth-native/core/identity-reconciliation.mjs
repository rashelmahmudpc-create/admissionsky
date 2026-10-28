// Phase 3, Identity Reconciliation Engine (blueprint §45-46 / EXTRA 06, 07)
//
// Read-only reconciliation over the identity/account snapshot. Detect →
// classify → report. Never mutates state; repair/escalation decisions are
// made by an authorized operator or a later controlled repair flow.
//
// Finding types:
//   orphan-external-identity , external identity row exists without a user
//   orphan-user              , user exists without any external identity
//   duplicate-provider-identity, same provider+subject mapped to >1 user
//   unknown-provider         , identity row with a provider outside the known set
//   invalid-user-status      , user row with a status outside the canonical set

import { ACCOUNT_STATES } from './account-lifecycle.mjs';

// Providers that may legitimately appear in auth_external_identities today.
// Extend this list only when a new provider mapping layer is implemented.
export const KNOWN_IDENTITY_PROVIDERS = Object.freeze(['firebase']);

const ALIAS = Object.freeze({ disabled: 'suspended' });

export function reconcileIdentitySnapshot(snapshot = {}, options = {}) {
  const users = Array.isArray(snapshot.users) ? snapshot.users : [];
  const identities = Array.isArray(snapshot.externalIdentities) ? snapshot.externalIdentities : [];
  const knownProviders = options.providers || KNOWN_IDENTITY_PROVIDERS;

  const findings = [];
  const userById = new Map();
  for (const user of users) {
    if (user && user.id) userById.set(String(user.id), user);
  }

  // 1. users missing any external identity
  for (const user of users) {
    if (!user || !user.id) {
      findings.push({ type: 'invalid-user', detail: 'user row without id' });
      continue;
    }
    const status = String(user.status ?? '').trim().toLowerCase();
    const canonical = ALIAS[status] || status;
    if (!ACCOUNT_STATES.includes(canonical)) {
      findings.push({ type: 'invalid-user-status', userId: String(user.id), status });
    }
  }

  const identityByUser = new Map();
  const providerSubjectOwners = new Map();

  for (const identity of identities) {
    if (!identity || !identity.provider || !identity.subjectRef) {
      findings.push({ type: 'invalid-identity', detail: 'identity row without provider/subject' });
      continue;
    }
    const provider = String(identity.provider);
    const subjectRef = String(identity.subjectRef);
    const userId = identity.userId != null ? String(identity.userId) : null;

    if (!knownProviders.includes(provider)) {
      findings.push({ type: 'unknown-provider', provider, userId });
    }

    if (!userId || !userById.has(userId)) {
      findings.push({ type: 'orphan-external-identity', provider, subjectRef });
      continue;
    }

    identityByUser.set(userId, (identityByUser.get(userId) || 0) + 1);

    const key = `${provider}:${subjectRef}`;
    let owners = providerSubjectOwners.get(key);
    if (!owners) {
      owners = new Set();
      providerSubjectOwners.set(key, owners);
    }
    if (owners.size > 0 && ![...owners].some(owner => owner === userId)) {
      findings.push({ type: 'duplicate-provider-identity', provider, subjectRef, userId });
    }
    owners.add(userId);
  }

  for (const user of users) {
    if (!user || !user.id) continue;
    if (!identityByUser.has(String(user.id))) {
      findings.push({ type: 'orphan-user', userId: String(user.id) });
    }
  }

  const counts = Object.create(null);
  for (const finding of findings) counts[finding.type] = (counts[finding.type] || 0) + 1;

  return Object.freeze({
    findings: Object.freeze(findings),
    counts: Object.freeze(counts),
    totals: Object.freeze({ users: users.length, externalIdentities: identities.length }),
    health: Object.freeze({
      ok: findings.length === 0,
      checks: Object.freeze({
        'identity.authority': Object.freeze({ ok: users.length > 0 || identities.length === 0 }),
        'identity.mapping': Object.freeze({ ok: !counts['orphan-external-identity'] && !counts['duplicate-provider-identity'] && !counts['invalid-identity'] }),
        'identity.account': Object.freeze({ ok: !counts['orphan-user'] && !counts['invalid-user'] && !counts['invalid-user-status'] }),
        'identity.security': Object.freeze({ ok: !counts['unknown-provider'] })
      })
    })
  });
}

// Diagnostic summary for admin health endpoints (EXTRA 07). Never includes
// raw subjects, emails, tokens or secrets, counts and flags only.
export function summarizeIdentityHealth(result) {
  return Object.freeze({
    ok: result.health.ok,
    users: result.totals.users,
    externalIdentities: result.totals.externalIdentities,
    findings: result.counts,
    checks: result.health.checks
  });
}
