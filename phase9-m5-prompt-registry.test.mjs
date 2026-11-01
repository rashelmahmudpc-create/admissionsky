// 🧩 PHASE 9 — M5: PROMPT REGISTRY (server-side module test)
// Locks the prompt registry introduced in migration step M5. The one invariant
// that matters most: routing buildSystemPrompt() through the registry must not
// change a single byte of the prompt the model sees. The rest guards the
// registry's own shape so a future revision cannot silently overwrite v1.
import { readFileSync } from 'fs';
import { createHash } from 'crypto';
let pass = 0, fail = 0;
const t = (n, c) => { if (c) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n); } }

const P = await import('./prompt-registry.js');
const A = await import('./ai-agent.js');
const SRC = readFileSync('ai-agent.js', 'utf8');
const { getPrompt, getPromptText, listPrompts, validatePromptRegistry, BASE_PROMPT_ID, PROMPT_REGISTRY_VERSION } = P;
const { buildSystemPrompt, SYSTEM_PROMPT_V } = A;

/* ── ১. Registry shape ── */
t('M5-১. the core prompt entry carries the full required metadata', (() => {
  const e = getPrompt(BASE_PROMPT_ID);
  return e && e.promptId === BASE_PROMPT_ID && e.version === 'v3'
    && typeof e.purpose === 'string' && e.purpose.length > 0
    && typeof e.createdAt === 'string' && e.status === 'active'
    && typeof e.text === 'string' && e.text.length > 0;
})());
t('M5-২. registry self-validation passes and the public version is stamped',
  Array.isArray(validatePromptRegistry()) && validatePromptRegistry().length === 0
  && PROMPT_REGISTRY_VERSION === 'pr-v1');
t('M5-৩. listPrompts exposes metadata but never the prompt text', (() => {
  const rows = listPrompts();
  return rows.length >= 1 && rows.the_prompt_text === undefined
    && !('text' in rows[0]) && rows[0].promptId === BASE_PROMPT_ID;
})());
t('M5-৪. an unknown prompt id resolves to null, never an empty string',
  getPrompt('does-not-exist') === null && getPromptText('does-not-exist') === null && getPrompt('') === null);

/* ── ২. The legacy version id is preserved, not deleted ── */
t('M5-৫. the previous version constant is kept as a legacy alias',
  getPrompt(BASE_PROMPT_ID).legacyVersion === SYSTEM_PROMPT_V && SYSTEM_PROMPT_V === 'sys-sky-v3-1-live-tools');

/* ── ৩. Zero behaviour change: the prompt is byte-identical ── */
t('M5-৬. buildSystemPrompt reads its core text from the registry, not an inline literal',
  SRC.includes('getPromptText(BASE_PROMPT_ID)') && !SRC.includes('let p = `You are Admission Sky AI.'));
t('M5-৭. the composed base prompt equals the registry text exactly',
  buildSystemPrompt({}) === getPromptText(BASE_PROMPT_ID) && buildSystemPrompt({}).length === 6945);
t('M5-৮. the base prompt hash is stable (locks the exact wording against drift)', (() => {
  const h = createHash('sha256').update(buildSystemPrompt({})).digest('hex');
  return h === 'e0f49e242fe3b4f342afdccf4cdcd40c36054d2310181dcf86b337982edb500f';
})());
t('M5-৯. conditional blocks still append on top of the shared base text', (() => {
  const base = buildSystemPrompt({});
  const quiz = buildSystemPrompt({ quiz: true });
  const exam = buildSystemPrompt({ examMode: 'mock-running' });
  const prefs = buildSystemPrompt({ prefs: { langStyle: 'en', tone: 'direct', responseLen: 'detailed' } });
  return quiz.startsWith(base) && exam.startsWith(base) && prefs.startsWith(base)
    && quiz.length > base.length && exam.length > base.length;
})());

/* ── ৪. Hard safety rules survive the move ── */
t('M5-১০. the twelve hard rules and the OTP refusal are intact',
  (() => {
    const p = buildSystemPrompt({});
    return p.includes('HARD RULES:') && p.includes('12. Telegram verification proves control')
      && p.includes('Never generate, guess, transform, repeat, request, collect, or validate an OTP')
      && (p.match(/^\d+\. /gm) || []).length === 14;
  })());

console.log(`\n📚 PHASE9-M5-PROMPT-REGISTRY: ${pass} pass / ${fail} fail`);
process.exit(fail ? 1 : 0);
