// 🧩 PHASE 9, M4: CONTEXT ENGINE
// Typed, permission-scoped, minimum-necessary context for the AI agent.
//
// Blueprint rule (§52 gap 2): every context category is a *typed* thing with an
// explicit permission scope on the ladder NONE → MINIMAL → SUMMARY →
// FULL_ALLOWED, and the AI only ever receives what the current scope allows.
// Nothing here reaches a provider on its own; the caller renders the bundle it
// was given. The legacy prompt path stays untouched, see ai-agent.js.

export const CONTEXT_VERSION = 'ctx-v1';

/** Typed context categories. Adding one is a deliberate act, not a side effect. */
export const CATEGORY = Object.freeze({
  IDENTITY: 'identity',
  PROFILE: 'profile',
  ACADEMIC: 'academic',
  PERFORMANCE: 'performance',
  ACTIVITY: 'activity',
  PREFERENCE: 'preference',
  ONBOARDING: 'onboarding',
  MEMORY: 'memory'
});

/** Permission ladder, ordered. */
export const SCOPE = Object.freeze({
  NONE: 'none',
  MINIMAL: 'minimal',
  SUMMARY: 'summary',
  FULL_ALLOWED: 'full_allowed'
});

const RANK = Object.freeze({ none: 0, minimal: 1, summary: 2, full_allowed: 3 });

export function scopeAtLeast(scope, minimum) {
  return (RANK[String(scope)] || 0) >= (RANK[String(minimum)] || 0);
}

/** Identity kind is decided by the server-side uid shape, never by the client. */
export function identityKind(uid) {
  const value = String(uid || '');
  if (value.startsWith('account-')) return 'account';
  if (value.startsWith('guest-')) return 'guest';
  return 'unknown';
}

/**
 * Resolve the permission scope of every category.
 *
 * Minimum-necessary by default: a category with no legitimate source resolves to
 * NONE rather than being guessed at. Signed-in identity is SUMMARY (the AI may
 * know it is talking to a signed-in student, never who they are); a guest gets
 * NONE because there is no durable identity to expose.
 */
export function resolveScopes({ uid, prefs, stats, onboarding, profile, memoryOn } = {}) {
  const kind = identityKind(uid);
  const hasPrefs = !!prefs && typeof prefs === 'object';
  const hasStats = !!stats && typeof stats === 'object' && Object.keys(stats).length > 0;
  const hasOnboarding = !!onboarding && typeof onboarding === 'object';
  const hasProfile = !!profile && typeof profile === 'object' && Object.keys(profile).length > 0;
  return Object.freeze({
    identity: kind === 'account' ? SCOPE.SUMMARY : SCOPE.NONE,
    // Academic profile is SUMMARY only for a signed-in account that supplied an
    // already-sanitized payload. Defence in depth: the caller also gates the
    // payload by uid prefix, so a guest request can never resolve here.
    profile: (kind === 'account' && hasProfile) ? SCOPE.SUMMARY : SCOPE.NONE,
    academic: hasOnboarding ? SCOPE.SUMMARY : SCOPE.NONE,
    performance: hasStats ? SCOPE.SUMMARY : SCOPE.NONE,
    activity: SCOPE.NONE,                 // reserved
    preference: hasPrefs ? SCOPE.FULL_ALLOWED : SCOPE.NONE,
    onboarding: hasOnboarding ? SCOPE.FULL_ALLOWED : SCOPE.NONE,
    memory: memoryOn ? SCOPE.FULL_ALLOWED : SCOPE.NONE
  });
}

/**
 * Build an immutable context bundle. Each category's payload is attached only
 * when its scope is at least MINIMAL, so a NONE category can never leak by
 * accident. The uid itself is never included, only its kind.
 */
export function buildContext(input = {}) {
  const scope = resolveScopes(input);
  const kind = identityKind(input.uid);
  const data = {};

  if (scopeAtLeast(scope.identity, SCOPE.MINIMAL)) data.identity = Object.freeze({ kind });
  if (allowed(scope.profile) && input.profile) data.profile = Object.freeze({ ...input.profile });
  if (allowed(scope.performance) && input.stats) data.performance = Object.freeze({ ...input.stats });
  if (allowed(scope.preference) && input.prefs) data.preference = Object.freeze({ ...input.prefs });
  if (allowed(scope.onboarding) && input.onboarding) data.onboarding = input.onboarding;

  return Object.freeze({ version: CONTEXT_VERSION, scope, data: Object.freeze(data) });
}

// A payload is attached only when its category cleared MINIMAL.
function allowed(scopeValue) {
  return scopeAtLeast(scopeValue, SCOPE.MINIMAL);
}

/**
 * Deterministic, PII-free description of what the AI was permitted to see.
 * Safe to log, surface in agentStatus, or attach to observability records.
 */
export function describeContext(bundle) {
  const scope = (bundle && bundle.scope) || {};
  const allowed = Object.keys(scope).filter(key => scopeAtLeast(scope[key], SCOPE.MINIMAL)).sort();
  const denied = Object.keys(scope).filter(key => !scopeAtLeast(scope[key], SCOPE.MINIMAL)).sort();
  return Object.freeze({
    version: (bundle && bundle.version) || CONTEXT_VERSION,
    allowed: Object.freeze(allowed),
    denied: Object.freeze(denied)
  });
}

/** Render the scoped context as system-prompt lines. Only allowed data appears. */
export function renderContext(bundle) {
  if (!bundle || bundle.version !== CONTEXT_VERSION) return '';
  const { scope, data } = bundle;
  const lines = [];

  if (scopeAtLeast(scope.identity, SCOPE.MINIMAL)) {
    lines.push(`- identity: ${data.identity.kind === 'account' ? 'signed-in student' : 'anonymous guest'}`);
  }
  if (scopeAtLeast(scope.preference, SCOPE.MINIMAL) && data.preference) {
    const p = data.preference;
    lines.push(`- preference: ${p.langStyle}/${p.tone}/${p.responseLen}, memory=${p.memory !== false}`);
  }
  if (scopeAtLeast(scope.performance, SCOPE.MINIMAL) && data.performance) {
    const s = data.performance;
    const bits = [];
    if (s.exams != null) bits.push(`exams=${s.exams}`);
    if (s.questions != null) bits.push(`questions=${s.questions}`);
    if (s.accuracy != null) bits.push(`accuracy=${s.accuracy}%`);
    if (s.streak != null) bits.push(`streak=${s.streak}d`);
    if (s.mistakes != null) bits.push(`mistakes=${s.mistakes}`);
    if (bits.length) lines.push(`- performance: ${bits.join(' ')}`);
    /* P06: weak topics as short pills so the model can prioritise revision.
       Already sanitized by capStats; rendered plain so no prompt structure leaks. */
    const pill = (list) => list.filter(Boolean).slice(0, 4).map(x => `${x.name} ${x.accuracy}%`).join(', ');
    if (Array.isArray(s.weakTopics) && s.weakTopics.length) {
      lines.push(`- weak topics: ${pill(s.weakTopics)}`);
    }
    if (s.weekly && s.weekly.exams) {
      const delta = s.prevWeekly && s.prevWeekly.exams ? `, prev ${s.prevWeekly.accuracy}%` : '';
      lines.push(`- this week: ${s.weekly.exams} exams, ${s.weekly.accuracy}% accuracy${delta}`);
    }
  }
  if (scopeAtLeast(scope.profile, SCOPE.MINIMAL) && data.profile) {
    const p = data.profile;
    const bits = [];
    if (p.firstName) bits.push(`name: ${p.firstName}`);
    if (p.institutionName) bits.push(`${p.institutionType || 'institution'}: ${p.institutionName}`);
    if (p.district) bits.push(`district: ${p.district}`);
    if (p.admissionSession) bits.push(`session: ${p.admissionSession}`);
    if (p.academicGoal) bits.push(`goal: ${p.academicGoal}`);
    if (Array.isArray(p.subjects) && p.subjects.length) bits.push(`subjects: ${p.subjects.join(', ')}`);
    if (Array.isArray(p.targets) && p.targets.length) {
      const t = p.targets[0];
      bits.push(`target: ${[t.name, t.unit, t.year].filter(Boolean).join(' / ')}`);
    }
    if (bits.length) lines.push(`- profile (academic): ${bits.join(' | ')}`);
  }
  if (scopeAtLeast(scope.academic, SCOPE.MINIMAL) && data.onboarding) {
    const q = String(data.onboarding.institutionQuery || '').trim();
    if (q) lines.push(`- academic: institution search "${q}"`);
  }
  if (!lines.length) return '';
  const named = scopeAtLeast(scope.profile, SCOPE.MINIMAL) && data.profile && data.profile.firstName;
  const tail = named
    ? ` Address the student by first name (${data.profile.firstName}) where it reads naturally. Never ask for or infer anything outside the categories above.`
    : ` Only the categories above were shared with you. Never ask for or infer anything outside them.`;
  return `\n\nCONTEXT ENGINE (permission-scoped, ${CONTEXT_VERSION}):\n${lines.join('\n')}\n${tail}`;
}
