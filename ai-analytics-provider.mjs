/* Phase 5, AI provider bridge for the analytics intelligence layer.
 *
 * The analytics layer needs exactly one thing from a model: given a prompt and a
 * set of numbers it may not change, return one paragraph of prose. That is a
 * one-shot completion, so this bridge uses the Agent Core's existing provider
 * adapters (`GEMINI_ADAPTER`) rather than a new HTTP client. Reusing them means
 * the analytics copilot inherits the same key handling, model list and failure
 * behaviour the chat surface already has, and adds no second place for a key to
 * be read or a model name to drift.
 *
 * Why a one-shot and not the chat chain: `providerChain` filters to adapters with
 * `oneShot === true`, which today is Gemini only. Groq and Cloudflare are
 * stream-only in that module, and the copilot has no use for a stream, the
 * grounding check runs on the finished text. So the chain here is deliberately
 * the one-shot subset, and when no key is configured the bridge returns `null`
 * and every caller falls back to deterministic wording. A missing key is a
 * degraded feature, never a broken route.
 *
 * Cost: no price table is invented. Usage is reported only as a token estimate
 * from the shared observability helper, and `costUsd` stays null unless a real
 * rate exists, the same rule the Phase 9 observability layer follows.
 */

import { PROVIDER_ADAPTERS } from './ai-agent.js';
import { estimateTokens, estimateCost, OBSERVABILITY_VERSION } from './observability.js';

export const AI_PROVIDER_VERSION = 'ai-p5-provider-v1';

/* Mirrors the Agent Core's fast/smart split without importing its private table:
 * the copilot is a restatement task, so the fast model is always the right tier. */
export const ANALYTICS_MODELS = Object.freeze({
  FAST: 'gemini-3.1-flash-lite',
  SMART: 'gemini-3-flash-preview'
});

/* Model tier for analytics prose. The fast model is the right choice: the task is
 * restatement, not reasoning, and a slow model here would delay a dashboard. */
export const ANALYTICS_MODEL_TIER = 'FAST';

export const AI_PROVIDER_LIMITS = Object.freeze({
  maxPromptChars: 8000,
  maxOutputChars: 1200,
  timeoutMs: 12000
});

/* Returns a `generate` function bound to the worker env, or `null` when no
 * provider is configured. `null` is a supported state: every Phase 5 surface has
 * a deterministic answer and uses it. */
export function aiGenerate(env = {}) {
  const entry = resolveEntry(env);
  if (!entry) return null;

  return async function generate({ prompt, system, purpose } = {}) {
    const adapter = adapterFor(entry);
    if (!adapter || adapter.oneShot !== true) return null;

    const text = buildPromptText(prompt, system);
    if (!text) return null;

    const started = Date.now();
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), AI_PROVIDER_LIMITS.timeoutMs) : null;

    try {
      /* `chatOnce` takes the adapter's own wire payload, not a bare string: Gemini
       * expects `contents[].parts[].text`. Passing the plain string here would
       * send a body the API rejects, which is why this shape is built explicitly
       * rather than reusing the chat module's multi-turn builder. */
      const out = await adapter.chatOnce(entry, {
        contents: [{ role: 'user', parts: [{ text }] }]
      });
      const raw = typeof out === 'string' ? out : String(out?.text || '');
      const trimmed = capOutput(raw);
      return {
        text: trimmed,
        model: entry.model,
        provider: entry.provider,
        modelVersion: `${entry.provider}:${entry.model}`,
        purpose: purpose || 'analytics',
        latencyMs: Date.now() - started,
        usage: usageFor(text, trimmed, entry),
        observabilityVersion: OBSERVABILITY_VERSION
      };
    } catch (err) {
      /* Swallowed on purpose: a provider fault must degrade the copilot to
       * deterministic wording, not fail the request the admin made. */
      return null;
    } finally {
      if (timer) clearTimeout(timer);
    }
  };
}

/* Picks the first usable one-shot provider from the env. Ordering mirrors the
 * Agent Core chain: the fast Gemini model first, then any configured override.
 * No key, no entry, the bridge stays inert. */
export function resolveEntry(env = {}) {
  const keys = String(env.GEMINI_KEYS || '').split(',').map((k) => k.trim()).filter(Boolean);
  if (!keys.length) return null;

  const models = String(env.AGENT_ANALYTICS_MODELS || env.AGENT_GEMINI_MODELS || '')
    .split(',').map((m) => m.trim()).filter(Boolean);

  const model = models[0] || ANALYTICS_MODELS[ANALYTICS_MODEL_TIER] || ANALYTICS_MODELS.FAST;
  return { provider: 'gemini', key: keys[0], model, tier: ANALYTICS_MODEL_TIER };
}

function adapterFor(entry) {
  return PROVIDER_ADAPTERS.find((a) => a.matches(entry)) || null;
}

function buildPromptText(prompt, system) {
  const parts = [];
  if (system) parts.push(String(system));
  if (prompt) parts.push(String(prompt));
  const text = parts.join('\n\n').trim();
  return text.length > AI_PROVIDER_LIMITS.maxPromptChars
    ? text.slice(0, AI_PROVIDER_LIMITS.maxPromptChars)
    : text;
}

function capOutput(text) {
  const t = String(text || '').trim();
  return t.length > AI_PROVIDER_LIMITS.maxOutputChars ? t.slice(0, AI_PROVIDER_LIMITS.maxOutputChars).trim() : t;
}

/* Token counts are labelled estimates (the shared helper is explicit about
 * this), and cost stays null when no rate exists rather than defaulting to a
 * made-up number. The argument names match `estimateCost`'s real signature so a
 * renamed parameter cannot silently turn every call unpriced. */
function usageFor(promptText, outputText, entry = {}) {
  const tokensIn = estimateTokens(promptText);
  const tokensOut = estimateTokens(outputText);
  const cost = estimateCost({ provider: entry.provider, model: entry.model, tokensIn, tokensOut });
  return {
    promptTokens: tokensIn,
    outputTokens: tokensOut,
    totalTokens: tokensIn + tokensOut,
    costUsd: cost?.usd ?? null,
    priced: Boolean(cost?.priced)
  };
}

export const __aiProviderTest = Object.freeze({ buildPromptText, capOutput, usageFor, adapterFor });
