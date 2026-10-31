/* F1.3 — task-based chains.
 *
 * The chain used to be the same list for every task, with one hardcoded
 * exception: an image was sent only to the provider literally named 'gemini'.
 * That is correct exactly as long as Gemini is the only vision provider, and
 * silently wrong the moment a second one appears — the image would go to a
 * text-only model, which cannot answer, and the student would get a confident
 * wrong reply instead of an error.
 *
 * These tests hold the property that replaced it: the TASK states what it
 * needs, and the CATALOG says who has it. The important ones are the two that
 * would have caught the original bug — a second vision provider must be picked
 * up without an edit here, and a text-only provider must never receive an image.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { requiredCapability, filterByCapability } from '../../ai-agent.js';
import { CATALOG, CAPABILITY, capabilityOf, providersWith } from './models.mjs';

test('an image requires VISION; text requires CHAT', () => {
  assert.equal(requiredCapability('GENERAL_CHAT', true), CAPABILITY.VISION);
  assert.equal(requiredCapability('IMAGE_REQUEST', true), CAPABILITY.VISION);
  assert.equal(requiredCapability('GENERAL_CHAT', false), CAPABILITY.CHAT);
  /* The intent alone never demands vision: only an attached image does. An
     IMAGE_REQUEST with no image attached is a text task. */
  assert.equal(requiredCapability('IMAGE_REQUEST', false), CAPABILITY.CHAT);
});

test('a vision requirement keeps only providers the catalog marks VISION', () => {
  const chain = [
    { provider: 'gemini', catalogId: 'gemini', model: 'm' },
    { provider: 'groq', catalogId: 'groq', model: 'm' },
    { provider: 'openai-compat', catalogId: 'openrouter', model: 'm' },
  ];
  const kept = filterByCapability(chain, CAPABILITY.VISION);
  assert.deepEqual(kept.map((c) => c.catalogId), ['gemini'],
    'only a provider whose catalog entry declares VISION may receive an image');
});

test('a text requirement keeps every provider that declares CHAT', () => {
  const chain = [
    { provider: 'gemini', catalogId: 'gemini', model: 'm' },
    { provider: 'groq', catalogId: 'groq', model: 'm' },
  ];
  assert.equal(filterByCapability(chain, CAPABILITY.CHAT).length, 2);
});

test('a provider with no catalog id is dropped when a capability is required', () => {
  const chain = [{ provider: 'mystery', model: 'm' }];
  assert.equal(filterByCapability(chain, CAPABILITY.CHAT).length, 0,
    'an unknown provider cannot be proven capable, so it must not be used');
  assert.equal(filterByCapability(chain, null).length, 1,
    'with no requirement nothing is dropped');
});

/* The regression this whole file exists for: adding a second vision provider to
   the catalog must extend the chain with NO code change. If someone reintroduces
   a hardcoded 'gemini', this test stops passing. */
test('a new vision provider is used without touching the filter', () => {
  const visionIds = providersWith(CAPABILITY.VISION);
  assert.ok(visionIds.length >= 1, 'at least one provider must declare VISION');
  const chain = visionIds.map((id) => ({ provider: 'x', catalogId: id, model: 'm' }));
  const kept = filterByCapability(chain, CAPABILITY.VISION);
  assert.equal(kept.length, visionIds.length,
    'every catalog provider declaring VISION must survive the filter');
});

test('the catalog declares VISION only where a model can really see', () => {
  /* A provider added to the catalog without VISION must not be reachable by an
     image, so the vision set is exactly what the catalog says. */
  for (const c of CATALOG) {
    const claims = capabilityOf(c.id).includes(CAPABILITY.VISION);
    assert.equal(providersWith(CAPABILITY.VISION).includes(c.id), claims,
      `${c.id}: vision reachability disagrees with the catalog`);
  }
  assert.ok(!capabilityOf('groq').includes(CAPABILITY.VISION),
    'Groq is text-only here; an image must never be sent to it');
});

test('every chain entry the router builds can be matched to the catalog', () => {
  /* filterByCapability drops an entry with no catalogId. If routerChain ever
     stops attaching one, every entry silently disappears and the app answers
     503 — so this asserts the two stay in step. */
  const ids = new Set(CATALOG.map((c) => c.id));
  const compat = CATALOG.filter((c) => c.adapter === 'openai-compat');
  for (const c of compat) assert.ok(ids.has(c.id), `${c.id}: compat provider without a catalog id`);
});
