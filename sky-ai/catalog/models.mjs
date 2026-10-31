/* F1.1 — the model catalog: one source of truth for every model the router knows.
 *
 * WHY THIS EXISTS. Before this file the model list lived as inline literals in
 * `ai-agent.js` — a `GEMINI_MODELS` object, a `COMPAT_PROVIDERS` array, and
 * default lists buried inside `routerChain`. Three consequences, all real:
 *
 *   - the data a model needs (its free limit, its ToS note, its Bangla score)
 *     had nowhere to live, so ML-02/ML-06 had no place to write it;
 *   - F1.3 (per-task chains) and F1.12 (auto-probe) both need to READ a model's
 *     capability and limit, and neither could;
 *   - a provider could be "known to the router" and absent from any list — the
 *     same class of drift `PROVIDER_KEY_NAMES` was added to close for
 *     credentials.
 *
 * The blueprint (page ০৬) is explicit that the RESEARCH — each source's real
 * free limit, ToS and Bangla score — happens when ML-06 starts, and that
 * "অনুমানে কোনো সংখ্যা লেখা হবে না" (no number is written from guesswork). So
 * this file does NOT invent limits. Every researched field is `null` until it is
 * actually verified, and `researchGaps()` reports which are still open. A field
 * that is silently blank and a field that is deliberately unverified must not
 * look the same; here the second is explicit and countable.
 *
 * Fields per entry:
 *   id          stable identifier, used in tests and traces
 *   label       human name for the owner-facing docs
 *   adapter     which reader drives it ('gemini' | 'groq' | 'cloudflare' | 'openai-compat')
 *   key         the credential NAME (never a value) the router looks for
 *   url         the OpenAI-compatible endpoint, or null for a native adapter
 *   models      default model ids, in the order the chain tries them
 *   tiers       optional FAST/SMART mapping for a tier-aware adapter
 *   capability  what the model can do — the set F1.3 will filter on
 *   limits      { rpm, rpd, tpm, source } free-tier limits, or null. `source` is
 *               the provider's own page the numbers came from, so a limit is
 *               auditable rather than remembered. A provider that publishes no
 *               free tier keeps null here — that is a finding, not a gap to fill.
 *   tos         free-text ToS note (commercial use, training-on-data), or null
 *   banglaScore { accuracy, correct, sample, set } measured on the F0.6 golden
 *               set, or null. The sample size is kept because a score from 24
 *               items is weak evidence and must not read like a full run.
 *   verifiedAt  ISO date the entry was last checked against the provider, or
 *               null. Set only when at least one real field was verified, so
 *               'verified' never counts an entry nothing was learned about.
 *
 * Regenerating research is a separate, deliberate step (ML-06), never a guess.
 */

/** Capability tags a chain may filter on. A closed set so a typo cannot pass. */
export const CAPABILITY = Object.freeze({
  CHAT: 'chat',
  REASONING: 'reasoning',
  VISION: 'vision',
  EMBEDDING: 'embedding',
  STT: 'stt',
  TTS: 'tts',
  TOOLS: 'tools',
});

export const ADAPTERS = Object.freeze(['gemini', 'groq', 'cloudflare', 'openai-compat']);

/* Every provider the router can reach, with the fields ML-02 names. The
 * `limits`/`tos`/`banglaScore`/`verifiedAt` values are null on purpose: page ০৬
 * forbids writing them from guesswork. Fill them in ML-06 from the provider's
 * own pricing/limits page, then set `verifiedAt`. */
export const CATALOG = Object.freeze([
  {
    id: 'gemini',
    label: 'Google AI Studio (Gemini)',
    adapter: 'gemini',
    key: 'GEMINI_KEYS',
    url: null,
    models: ['gemini-3.1-flash-lite', 'gemini-3-flash-preview'],
    tiers: { FAST: 'gemini-3.1-flash-lite', SMART: 'gemini-3-flash-preview' },
    capability: [CAPABILITY.CHAT, CAPABILITY.REASONING, CAPABILITY.VISION, CAPABILITY.TOOLS],
    limits: null,
    tos: 'Free tier: inputs and outputs are used to improve Google\'s products and human reviewers may read API input/output; the paid tier is not. Source: https://ai.google.dev/gemini-api/docs/pricing',
    banglaScore: { accuracy: 0.2917, correct: 7, sample: 24, set: 'golden-v1' },
    verifiedAt: '2026-10-31',
  },
  {
    id: 'groq',
    label: 'Groq',
    adapter: 'groq',
    key: 'GROQ_API_KEY',
    url: null,
    models: ['openai/gpt-oss-120b', 'openai/gpt-oss-20b'],
    capability: [CAPABILITY.CHAT, CAPABILITY.REASONING],
    limits: { rpm: 30, rpd: 1000, tpm: 8000, source: 'https://console.groq.com/docs/rate-limits' },
    tos: null,
    banglaScore: { accuracy: 0.4167, correct: 10, sample: 24, set: 'golden-v1' },
    verifiedAt: '2026-10-31',
  },
  {
    id: 'cloudflare',
    label: 'Cloudflare Workers AI',
    adapter: 'cloudflare',
    key: 'CLOUDFLARE_AI_API_KEY',
    url: null,
    models: ['@cf/meta/llama-3.3-70b-instruct-fp8-fast'],
    capability: [CAPABILITY.CHAT],
    limits: { neuronsPerDay: 10000, source: 'https://developers.cloudflare.com/workers-ai/platform/pricing' },
    tos: null,
    banglaScore: null,
    verifiedAt: '2026-10-31',
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    adapter: 'openai-compat',
    key: 'OPENROUTER_API_KEYS',
    url: 'https://openrouter.ai/api/v1/chat/completions',
    models: ['google/gemma-4-31b-it:free'],
    capability: [CAPABILITY.CHAT],
    limits: { rpd: 50, source: 'https://openrouter.ai/docs/api-reference/limits' },
    tos: 'Free \':free\' model variants are capped and may be logged by the upstream provider; check each provider\'s policy. Source: https://openrouter.ai/docs/features/privacy-and-logging',
    banglaScore: null,
    verifiedAt: '2026-10-31',
  },
  {
    id: 'vercel-ai-gateway',
    label: 'Vercel AI Gateway',
    adapter: 'openai-compat',
    key: 'VERCEL_AI_GATEWAY_KEY',
    url: 'https://ai-gateway.vercel.sh/v1/chat/completions',
    models: ['openai/gpt-4o-mini'],
    capability: [CAPABILITY.CHAT],
    limits: null,
    tos: null,
    banglaScore: null,
    verifiedAt: null,
  },
  {
    id: 'github-models',
    label: 'GitHub Models',
    adapter: 'openai-compat',
    key: 'GITHUB_MODELS_TOKEN',
    url: 'https://models.github.ai/inference/chat/completions',
    models: ['openai/gpt-4o-mini'],
    capability: [CAPABILITY.CHAT],
    limits: null,
    tos: null,
    banglaScore: null,
    verifiedAt: null,
  },
  {
    id: 'mistral',
    label: 'Mistral AI',
    adapter: 'openai-compat',
    key: 'MISTRAL_API_KEYS',
    url: 'https://api.mistral.ai/v1/chat/completions',
    models: ['ministral-14b-latest'],
    capability: [CAPABILITY.CHAT],
    limits: null,
    tos: null,
    banglaScore: { accuracy: 0.5833, correct: 14, sample: 24, set: 'golden-v1' },
    verifiedAt: '2026-10-31',
  },
  {
    id: 'cerebras',
    label: 'Cerebras',
    adapter: 'openai-compat',
    key: 'CEREBRAS_API_KEYS',
    url: 'https://api.cerebras.ai/v1/chat/completions',
    models: ['llama-3.3-70b'],
    capability: [CAPABILITY.CHAT],
    limits: { rpm: 5, tpm: 30000, tpd: 1000000, source: 'https://inference-docs.cerebras.ai/support/rate-limits' },
    tos: null,
    banglaScore: null,
    verifiedAt: '2026-10-31',
  },
  {
    id: 'sambanova',
    label: 'SambaNova',
    adapter: 'openai-compat',
    key: 'SAMBANOVA_API_KEYS',
    url: 'https://api.sambanova.ai/v1/chat/completions',
    models: ['Meta-Llama-3.3-70B-Instruct'],
    capability: [CAPABILITY.CHAT],
    limits: null,
    tos: null,
    banglaScore: null,
    verifiedAt: null,
  },
  {
    id: 'cohere',
    label: 'Cohere',
    adapter: 'openai-compat',
    key: 'COHERE_API_KEYS',
    url: 'https://api.cohere.ai/compatibility/v1/chat/completions',
    models: ['command-r7b-12-2024'],
    capability: [CAPABILITY.CHAT],
    limits: null,
    tos: null,
    banglaScore: null,
    verifiedAt: null,
  },
  {
    id: 'huggingface',
    label: 'Hugging Face Inference',
    adapter: 'openai-compat',
    key: 'HUGGINGFACE_API_KEYS',
    url: 'https://router.huggingface.co/v1/chat/completions',
    models: ['meta-llama/Llama-3.3-70B-Instruct'],
    capability: [CAPABILITY.CHAT],
    limits: null,
    tos: null,
    banglaScore: null,
    verifiedAt: null,
  },
  {
    id: 'deepinfra',
    label: 'DeepInfra',
    adapter: 'openai-compat',
    key: 'DEEPINFRA_API_KEYS',
    url: 'https://api.deepinfra.com/v1/openai/chat/completions',
    models: ['meta-llama/Meta-Llama-3.1-70B-Instruct'],
    capability: [CAPABILITY.CHAT],
    limits: null,
    tos: null,
    banglaScore: null,
    verifiedAt: null,
  },
  {
    id: 'together',
    label: 'Together AI',
    adapter: 'openai-compat',
    key: 'TOGETHER_API_KEYS',
    url: 'https://api.together.xyz/v1/chat/completions',
    models: ['meta-llama/Llama-3.3-70B-Instruct-Turbo'],
    capability: [CAPABILITY.CHAT],
    limits: null,
    tos: null,
    banglaScore: null,
    verifiedAt: null,
  },
  {
    id: 'kimi',
    label: 'Moonshot (Kimi)',
    adapter: 'openai-compat',
    key: 'KIMI_API_KEYS',
    url: 'https://api.moonshot.ai/v1/chat/completions',
    models: ['moonshot-v1-8k'],
    capability: [CAPABILITY.CHAT],
    limits: null,
    tos: null,
    banglaScore: null,
    verifiedAt: null,
  },
  {
    id: 'aimlapi',
    label: 'AI/ML API',
    adapter: 'openai-compat',
    key: 'AIML_API_KEYS',
    url: 'https://api.aimlapi.com/v1/chat/completions',
    models: ['gpt-4o-mini'],
    capability: [CAPABILITY.CHAT],
    limits: null,
    tos: null,
    banglaScore: null,
    verifiedAt: null,
  },
  {
    id: 'llm7',
    label: 'LLM7',
    adapter: 'openai-compat',
    key: 'LLM7_API_KEYS',
    url: 'https://api.llm7.io/v1/chat/completions',
    models: ['gpt-4o-mini'],
    capability: [CAPABILITY.CHAT],
    limits: null,
    tos: null,
    banglaScore: null,
    verifiedAt: null,
  },
  {
    id: 'siliconflow',
    label: 'SiliconFlow',
    adapter: 'openai-compat',
    key: 'SILICONFLOW_API_KEYS',
    url: 'https://api.siliconflow.cn/v1/chat/completions',
    models: ['Qwen/Qwen2.5-7B-Instruct'],
    capability: [CAPABILITY.CHAT],
    limits: null,
    tos: null,
    banglaScore: null,
    verifiedAt: null,
  },
  {
    id: 'stepfun',
    label: 'StepFun',
    adapter: 'openai-compat',
    key: 'STEPFUN_API_KEYS',
    url: 'https://api.stepfun.ai/v1/chat/completions',
    models: ['step-1-8k'],
    capability: [CAPABILITY.CHAT],
    limits: null,
    tos: null,
    banglaScore: null,
    verifiedAt: null,
  },
  {
    id: 'minimax',
    label: 'MiniMax',
    adapter: 'openai-compat',
    key: 'MINIMAX_API_KEYS',
    url: 'https://api.minimax.chat/v1/text/chatcompletion_v2',
    models: ['abab6.5s-chat'],
    capability: [CAPABILITY.CHAT],
    limits: null,
    tos: null,
    banglaScore: null,
    verifiedAt: null,
  },
]);

/** The OpenAI-compatible providers, in the shape the router's loop already
 *  consumes: `{ key, url, models }`. Derived, so the router cannot drift from
 *  the catalog. */
export const COMPAT_PROVIDERS = CATALOG
  .filter((c) => c.adapter === 'openai-compat')
  .map((c) => ({ id: c.id, key: c.key, url: c.url, models: c.models }));

/** The capability tags of a provider id, or [] when the id is unknown. F1.3
 *  filters a chain with this so a task's requirement is answered by the
 *  catalog rather than by a hardcoded provider name. */
export function capabilityOf(id) {
  const entry = CATALOG.find((c) => c.id === id);
  return entry ? [...entry.capability] : [];
}

/** Provider ids that declare a capability. The inverse of capabilityOf, for a
 *  caller that needs the set rather than a per-entry test. */
export function providersWith(cap) {
  return CATALOG.filter((c) => c.capability.includes(cap)).map((c) => c.id);
}

/** FAST/SMART model ids for a tier-aware adapter (Gemini today). */
export function tierModels(id) {
  const entry = CATALOG.find((c) => c.id === id);
  return entry && entry.tiers ? entry.tiers : null;
}

/** Default model ids for a provider id, or [] when unknown. */
export function modelsFor(id) {
  const entry = CATALOG.find((c) => c.id === id);
  return entry ? [...entry.models] : [];
}

/**
 * The fields ML-02 requires that are still unverified, per provider. This is the
 * honest gap list: it exists so "not yet researched" is a visible, countable
 * state rather than a blank that reads like a zero.
 */
export function researchGaps() {
  const out = [];
  for (const c of CATALOG) {
    const missing = [];
    if (c.limits == null) missing.push('limits');
    if (c.tos == null) missing.push('tos');
    if (c.banglaScore == null) missing.push('banglaScore');
    if (c.verifiedAt == null) missing.push('verifiedAt');
    if (missing.length) out.push({ id: c.id, missing });
  }
  return out;
}

/** A short, owner-facing summary of catalog coverage. */
export function catalogSummary() {
  const gaps = researchGaps();
  return {
    providers: CATALOG.length,
    verified: CATALOG.filter((c) => c.verifiedAt).length,
    withLimits: CATALOG.filter((c) => c.limits != null).length,
    withTos: CATALOG.filter((c) => c.tos != null).length,
    withBanglaScore: CATALOG.filter((c) => c.banglaScore != null).length,
    unverifiedProviders: gaps.map((g) => g.id),
  };
}
