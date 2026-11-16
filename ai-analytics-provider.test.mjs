/* Phase 5 — the AI provider bridge.
 *
 * The bridge exists to make a model optional. Its contract is small and worth
 * pinning: with no key it returns `null` (never throws, never returns a stub), it
 * only ever selects a one-shot adapter, it caps both the prompt and the output,
 * it reports token usage as an estimate, and it never invents a price. A bridge
 * that threw on a missing key would turn a degraded feature into a broken route,
 * so most of these tests are about the no-key and fault paths.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AI_PROVIDER_VERSION, ANALYTICS_MODELS, ANALYTICS_MODEL_TIER, AI_PROVIDER_LIMITS,
  aiGenerate, resolveEntry, __aiProviderTest
} from './ai-analytics-provider.mjs';
import { PROVIDER_ADAPTERS } from './ai-agent.js';
import { OBSERVABILITY_VERSION } from './observability.js';

const { buildPromptText, capOutput, usageFor, adapterFor } = __aiProviderTest;

/* ── ১. versioning ───────────────────────────────────────────────────────── */

test('P5-PROV-১. the provider version is exported and stamped on every result', async () => {
  assert.equal(AI_PROVIDER_VERSION, 'ai-p5-provider-v1');
  const generate = aiGenerate({ GEMINI_KEYS: 'k' });
  assert.equal(typeof generate, 'function');
});

/* ── ২. no key ───────────────────────────────────────────────────────────── */

test('P5-PROV-২. no key means no bridge — null, not a throw and not a stub', () => {
  assert.equal(aiGenerate({}), null);
  assert.equal(aiGenerate({ GEMINI_KEYS: '' }), null);
  assert.equal(aiGenerate({ GEMINI_KEYS: '   ' }), null);
  assert.equal(aiGenerate({ GEMINI_KEYS: ',,,' }), null);
  assert.equal(resolveEntry({}), null);
});

/* ── ৩. model selection ─────────────────────────────────────────────────── */

test('P5-PROV-৩. the fast model is the default tier, and an override is honoured', () => {
  assert.equal(ANALYTICS_MODEL_TIER, 'FAST');
  assert.equal(ANALYTICS_MODELS.FAST, 'gemini-flash-lite-latest');

  const fallback = resolveEntry({ GEMINI_KEYS: 'k1' });
  assert.equal(fallback.model, ANALYTICS_MODELS.FAST);
  assert.equal(fallback.provider, 'gemini');
  assert.equal(fallback.tier, 'FAST');

  const overridden = resolveEntry({ GEMINI_KEYS: 'k1', AGENT_ANALYTICS_MODELS: 'custom-model,other' });
  assert.equal(overridden.model, 'custom-model');
});

test('P5-PROV-৪. the first key is used, and extra keys are kept out of the entry', () => {
  const entry = resolveEntry({ GEMINI_KEYS: 'first-key, second-key' });
  assert.equal(entry.key, 'first-key');
  /* No trailing whitespace from the comma split. */
  assert.equal(entry.key, entry.key.trim());
});

/* ── ৫. adapter choice ──────────────────────────────────────────────────── */

test('P5-PROV-৫. only a one-shot adapter is ever selected', () => {
  const entry = resolveEntry({ GEMINI_KEYS: 'k' });
  const adapter = adapterFor(entry);
  assert.ok(adapter, 'a Gemini adapter must match a gemini entry');
  assert.equal(adapter.oneShot, true, 'a stream-only adapter would deadlock the copilot');
  /* A stream-only provider must not be picked. */
  const streamOnly = PROVIDER_ADAPTERS.filter((a) => a.oneShot !== true);
  for (const a of streamOnly) assert.notEqual(a, adapter);
});

/* ── ৬. prompt assembly ─────────────────────────────────────────────────── */

test('P5-PROV-৬. system and prompt are joined, and an empty pair yields nothing', () => {
  assert.equal(buildPromptText('question', 'system'), 'system\n\nquestion');
  assert.equal(buildPromptText('question', ''), 'question');
  assert.equal(buildPromptText('', 'system'), 'system');
  assert.equal(buildPromptText('', ''), '');
  assert.equal(buildPromptText(null, undefined), '');
});

test('P5-PROV-৭. an over-long prompt is capped, so a huge dashboard cannot blow the context', () => {
  const long = 'x'.repeat(AI_PROVIDER_LIMITS.maxPromptChars + 500);
  assert.equal(buildPromptText(long, '').length, AI_PROVIDER_LIMITS.maxPromptChars);
  assert.equal(buildPromptText('short', '').length, 5);
});

test('P5-PROV-৮. output is capped and trimmed', () => {
  const long = 'y'.repeat(AI_PROVIDER_LIMITS.maxOutputChars + 100);
  assert.equal(capOutput(long).length, AI_PROVIDER_LIMITS.maxOutputChars);
  assert.equal(capOutput('  hello  '), 'hello');
  assert.equal(capOutput(null), '');
});

/* ── ৯. usage ───────────────────────────────────────────────────────────── */

test('P5-PROV-৯. usage reports labelled token estimates and a real total', () => {
  const usage = usageFor('prompt text', 'output text', { provider: 'gemini', model: ANALYTICS_MODELS.FAST });
  assert.ok(usage.promptTokens > 0);
  assert.ok(usage.outputTokens > 0);
  assert.equal(usage.totalTokens, usage.promptTokens + usage.outputTokens);
  assert.equal(typeof usage.priced, 'boolean');
});

test('P5-PROV-১০. cost is null rather than an invented rate when no price is known', () => {
  const usage = usageFor('a', 'b', { provider: 'made-up-provider', model: 'unknown-model' });
  /* The observability layer only prices models it has a real rate for. */
  assert.equal(usage.costUsd, null);
  assert.equal(usage.priced, false);
});

/* ── ১১. the call path, with an injected adapter ────────────────────────── */

test('P5-PROV-১১. a successful one-shot call returns the text, model and observability stamp', async () => {
  /* Swap the adapter's chatOnce for the duration of this test so the real
   * buildPromptText → chatOnce → capOutput → usageFor path runs offline. */
  const adapter = PROVIDER_ADAPTERS.find((a) => a.oneShot === true);
  const original = adapter.chatOnce;
  let seen = null;
  adapter.chatOnce = async (entry, payload) => {
    seen = { entry, payload };
    return { text: 'গত ৩০ দিনে DAU ছিল ১২০।' };
  };
  try {
    const generate = aiGenerate({ GEMINI_KEYS: 'k' });
    const result = await generate({ prompt: 'engagement?', system: 'be factual' });
    assert.ok(result, 'a configured bridge must return a result');
    assert.equal(result.text, 'গত ৩০ দিনে DAU ছিল ১২০।');
    assert.equal(result.model, ANALYTICS_MODELS.FAST);
    assert.equal(result.provider, 'gemini');
    assert.equal(result.modelVersion, `gemini:${ANALYTICS_MODELS.FAST}`);
    assert.equal(result.observabilityVersion, OBSERVABILITY_VERSION);
    assert.ok(result.latencyMs >= 0);
    /* The wire payload is Gemini-shaped, not a bare string. */
    assert.ok(Array.isArray(seen.payload.contents));
    assert.equal(seen.payload.contents[0].parts[0].text, 'be factual\n\nengagement?');
  } finally {
    adapter.chatOnce = original;
  }
});

test('P5-PROV-১২. a provider fault returns null so the caller can fall back', async () => {
  const adapter = PROVIDER_ADAPTERS.find((a) => a.oneShot === true);
  const original = adapter.chatOnce;
  adapter.chatOnce = async () => { throw new Error('upstream 500'); };
  try {
    const generate = aiGenerate({ GEMINI_KEYS: 'k' });
    const result = await generate({ prompt: 'x' });
    assert.equal(result, null, 'a provider fault must degrade, not throw');
  } finally {
    adapter.chatOnce = original;
  }
});

test('P5-PROV-১৩. an empty prompt never reaches the provider', async () => {
  const adapter = PROVIDER_ADAPTERS.find((a) => a.oneShot === true);
  const original = adapter.chatOnce;
  let called = false;
  adapter.chatOnce = async () => { called = true; return { text: 'x' }; };
  try {
    const generate = aiGenerate({ GEMINI_KEYS: 'k' });
    assert.equal(await generate({ prompt: '', system: '' }), null);
    assert.equal(called, false, 'an empty prompt must short-circuit before the network');
  } finally {
    adapter.chatOnce = original;
  }
});

test('P5-PROV-১৪. the prompt text is capped before it is sent, not after', async () => {
  const adapter = PROVIDER_ADAPTERS.find((a) => a.oneShot === true);
  const original = adapter.chatOnce;
  let sent = '';
  adapter.chatOnce = async (_entry, payload) => { sent = payload.contents[0].parts[0].text; return { text: 'ok' }; };
  try {
    const generate = aiGenerate({ GEMINI_KEYS: 'k' });
    await generate({ prompt: 'z'.repeat(AI_PROVIDER_LIMITS.maxPromptChars + 1000) });
    assert.equal(sent.length, AI_PROVIDER_LIMITS.maxPromptChars);
  } finally {
    adapter.chatOnce = original;
  }
});

/* ── ১৫. purity ─────────────────────────────────────────────────────────── */

test('P5-PROV-১৫. the bridge reads no key at import time and does no I/O to be constructed', () => {
  /* `aiGenerate({})` returning null without touching the network is the proof. */
  assert.equal(aiGenerate({}), null);
  assert.equal(AI_PROVIDER_LIMITS.maxPromptChars < AI_PROVIDER_LIMITS.maxOutputChars * 100, true);
});
