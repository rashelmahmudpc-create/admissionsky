/* F1.2 — the key vault reads the catalog.
 *
 * providerReadiness() used to NAME each provider by stripping a suffix off its
 * credential name: OPENROUTER_API_KEYS -> openrouter, AIML_API_KEYS -> aiml,
 * GEMINI_KEYS -> gemini_keys, VERCEL_AI_GATEWAY_KEY -> vercel_ai_gateway.
 *
 * Nothing broke, and that is the interesting part. Both Workers run the same
 * function, so the parity check compared the names to themselves and always
 * agreed — a shared mistake compares equal. What it did break is any comparison
 * against the OTHER vocabulary in the codebase, the catalog ids the router uses.
 * A provider could be "ready" under one name and absent under the other.
 *
 * These tests hold the property that replaced it: a readiness key IS a catalog
 * id, so the provider the router picks and the provider the health report names
 * are the same string by construction.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { providerReadiness, readyProviderNames, PROVIDER_READY_RULES, routerChain, agentStatus } from '../../ai-agent.js';
import { CATALOG } from './models.mjs';

test('every readiness key is a catalog id, with no derived names', async () => {
  const ready = await providerReadiness({ GEMINI_KEYS: 'k', MISTRAL_API_KEYS: 'm', AIML_API_KEYS: 'a' });
  const ids = new Set(CATALOG.map((c) => c.id));
  for (const key of Object.keys(ready)) {
    assert.ok(ids.has(key), `${key} is not a catalog id — a derived name came back`);
  }
  /* The specific names the old suffix-strip produced must not return. */
  for (const wrong of ['gemini_keys', 'aiml', 'vercel_ai_gateway', 'github_models', 'cloudflare_ai']) {
    assert.equal(wrong in ready, false, `${wrong} is a derived name, not a catalog id`);
  }
});

test('a provider is ready under exactly the id the router uses for it', async () => {
  /* The bug this file exists for: readiness and the router must agree on the
     NAME of a provider, not merely on whether one exists. */
  const env = { GEMINI_KEYS: 'k', MISTRAL_API_KEYS: 'm' };
  const ready = await providerReadiness(env);
  const chainIds = new Set(routerChain(env, 'FAST', new Set(), {}).map((c) => c.catalogId));
  for (const id of chainIds) {
    assert.equal(ready[id], true, `${id} is in the chain but readiness does not name it`);
  }
});

test('a second credential of one provider does not invent a second provider', () => {
  /* Cloudflare is two credentials, one provider. A rule per credential would
     report it twice or once under a name nothing else uses. */
  const cf = PROVIDER_READY_RULES.filter((r) => r.id === 'cloudflare');
  assert.equal(cf.length, 1);
  assert.deepEqual(cf[0].keys.sort(), ['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_AI_API_KEY']);
});

test('readiness needs EVERY credential of a provider, not just one', async () => {
  const half = await providerReadiness({ CLOUDFLARE_ACCOUNT_ID: 'a' });
  assert.equal(half.cloudflare, false, 'an account id without the token cannot answer');
  /* The token alone is the case that caught a real bug: the catalog names only
     the token for Cloudflare, so a catalog rule overwrote the two-credential
     rule and reported the provider ready without its account id. */
  const tokenOnly = await providerReadiness({ CLOUDFLARE_AI_API_KEY: 't' });
  assert.equal(tokenOnly.cloudflare, false, 'a token without the account id cannot answer either');
  const both = await providerReadiness({ CLOUDFLARE_ACCOUNT_ID: 'a', CLOUDFLARE_AI_API_KEY: 't' });
  assert.equal(both.cloudflare, true);
});

test('the status chain names the real provider, not the adapter', async () => {
  /* Before F1.2 every OpenAI-compatible provider reported as `openai-compat`,
     so an owner with 16 such keys could not tell which one the chat would try. */
  const env = { GEMINI_KEYS: 'k', MISTRAL_API_KEYS: 'm' };
  const res = await agentStatus(new Request('https://w/api/ai/status'), env, 'account-x');
  const body = await res.json();
  assert.ok(body.chain.some((e) => e.startsWith('mistral:')), 'the real provider must be named: ' + body.chain.join(','));
  assert.equal(body.chain.some((e) => e.startsWith('openai-compat:')), false,
    'the adapter name must never stand in for the provider');
});

test('readiness names never carry a secret', async () => {
  const env = { GEMINI_KEYS: 'SECRET-A,SECRET-B', GROQ_API_KEY: 'gsk-SECRET' };
  const ready = await providerReadiness(env);
  const printed = JSON.stringify(ready) + readyProviderNames(ready).join(',');
  for (const secret of ['SECRET-A', 'SECRET-B', 'gsk-']) {
    assert.equal(printed.includes(secret), false, 'a secret reached the output');
  }
});
