/* P19 — the staging isolation guard, and the config it guards.
 *
 * The guard exists because a staging config that points at a production resource
 * fails silently and destructively. These tests pin both directions: the shipped
 * config must pass the guard's own isolation rules, and the guard must actually
 * catch a production id, a production name, an unfilled placeholder and a cron
 * trigger when they are present.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  checkStagingConfig, findProductionIds, findProductionNames, findPlaceholders,
  hasCronTrigger, PRODUCTION_IDS, findProductionServices,
} from './scripts/check-staging-isolation.mjs';

const CONFIG = readFileSync('wrangler.staging.toml', 'utf8');
/* F0.3: the sky-ai twin is a second staging config and must satisfy the same
 * isolation rules. It is the one that could bind the production AI Worker. */
const SKY_CONFIG = readFileSync('sky-ai/wrangler.staging.toml', 'utf8');

test('p19s-১: the shipped staging config contains no production resource id', () => {
  assert.deepEqual(findProductionIds(CONFIG), [], 'staging must never reference a live KV/D1/R2 id');
});

test('p19s-২: the shipped staging config contains no production resource name', () => {
  assert.deepEqual(findProductionNames(CONFIG), [],
    'admission-gk-staging is fine; bare admission-gk / admission-hub / admission-profile are not');
});

test('p19s-৩: the shipped staging config carries no cron trigger', () => {
  assert.equal(hasCronTrigger(CONFIG), false,
    'a cron on staging would send real notifications to real students');
});

test('p19s-৪: a config with unfilled placeholders is refused', () => {
  // A synthetic config, not the shipped one: once tools/setup-staging.sh has
  // run, the committed file carries real staging ids and this precondition is
  // gone. The guard's job -- refuse a placeholder -- must be pinned regardless
  // of whether provisioning has happened yet.
  const unfilled = 'name = "admission-gk-staging"\n[[kv_namespaces]]\n'
    + 'binding = "GK_KV"\nid = "REPLACE_WITH_STAGING_GK_KV_ID"\n';
  const { ok, problems } = checkStagingConfig(unfilled);
  assert.equal(ok, false, 'an unfilled placeholder must block the deploy');
  assert.ok(problems.some(p => p.includes('unfilled placeholder')),
    'the refusal must name the placeholder problem');
});

test('p19s-৪b: the shipped config is deployable once provisioned, and isolated either way', () => {
  // The shipped file is valid in exactly two states: still holding placeholders
  // (not yet provisioned) or fully filled (provisioned). What it must NEVER do
  // is reference a production resource -- p19s-১/২/৩ pin that separately.
  const { ok, problems } = checkStagingConfig(CONFIG);
  const onlyPlaceholders = problems.every(p => p.includes('unfilled placeholder'));
  assert.ok(ok || onlyPlaceholders,
    'the shipped config must be either filled or placeholder-only, never otherwise unsafe');
});

test('p19s-৫: the guard catches a production id', () => {
  const bad = 'name = "admission-gk-staging"\n[[kv_namespaces]]\n'
    + `binding = "GK_KV"\nid = "${PRODUCTION_IDS[0]}"\n`;
  assert.deepEqual(findProductionIds(bad), [PRODUCTION_IDS[0]]);
  assert.equal(checkStagingConfig(bad).ok, false);
});

test('p19s-৬: the guard catches a production name written as a whole value', () => {
  const bad = CONFIG.replace('bucket_name = "admission-hub-staging"', 'bucket_name = "admission-hub"');
  assert.deepEqual(findProductionNames(bad), ['admission-hub']);
  assert.equal(checkStagingConfig(bad).ok, false);
});

test('p19s-৭: the guard does not mistake a staging name for a production one', () => {
  assert.deepEqual(findProductionNames('bucket_name = "admission-hub-staging"'), []);
  assert.deepEqual(findProductionNames('database_name = "admission-profile-staging"'), []);
});

test('p19s-৮: the guard catches a cron trigger', () => {
  const bad = `${CONFIG}\n[triggers]\ncrons = ["* * * * *"]\n`;
  assert.equal(hasCronTrigger(bad), true);
  assert.ok(checkStagingConfig(bad).problems.some(p => p.includes('cron trigger')));
});

test('p19s-৯: a fully configured, isolated config passes', () => {
  const good = CONFIG
    .replace(/REPLACE_WITH_STAGING_[A-Z0-9_]+/g, 'staging-id-0000000000000000000000000000000')
    .replace(/REPLACE_WITH_STAGING_D1_ID/g, '00000000-0000-0000-0000-000000000000');
  const { ok, problems } = checkStagingConfig(good);
  assert.equal(ok, true, `expected a clean pass, got: ${problems.join('; ')}`);
});

test('p19s-১০: placeholders are reported once each, however often they appear', () => {
  const text = 'a REPLACE_X b REPLACE_X c REPLACE_Y';
  assert.deepEqual(findPlaceholders(text).sort(), ['REPLACE_X', 'REPLACE_Y']);
});

/* F0.3 — the sky-ai staging twin. These are the assertions that keep a staging
 * AI test off the live AI Worker and off live student data. */

test('p19s-১১: the sky-ai staging config carries no production resource id', () => {
  assert.deepEqual(findProductionIds(SKY_CONFIG), [],
    'sky-ai-staging must not read production PUB_KV or write production SKY_FLAGS');
});

test('p19s-১২: the sky-ai staging config binds the staging twin, not production sky-ai', () => {
  assert.ok(SKY_CONFIG.includes('name = "sky-ai-staging"'),
    'the script itself is the staging twin');
  assert.deepEqual(findProductionServices(SKY_CONFIG), [],
    'a service = "sky-ai" here would route a staging test through live prefs and live quota');
});

test('p19s-১৩: the app staging config forwards AI to the staging twin, never production sky-ai', () => {
  assert.deepEqual(findProductionServices(CONFIG), [],
    'admission-gk-staging must bind sky-ai-staging, not the live sky-ai Worker');
  assert.ok(CONFIG.includes('service = "sky-ai-staging"'),
    'the F0.3 hop must exist, or a staging AI test has nowhere to go');
});

test('p19s-১৪: a production service binding is refused, the staging twin is not', () => {
  const bad = 'name = "admission-gk-staging"\n[[services]]\nbinding = "SKY_AI"\nservice = "sky-ai"\n';
  const { ok, problems } = checkStagingConfig(bad);
  assert.equal(ok, false, 'binding the production AI Worker from staging must be refused');
  assert.ok(problems.some(p => p.includes('production service binding')), 'the refusal names the service');
  const good = 'name = "admission-gk-staging"\n[[services]]\nbinding = "SKY_AI"\nservice = "sky-ai-staging"\n';
  assert.equal(checkStagingConfig(good).ok, true, 'the staging twin is allowed');
});

test('p19s-১৫: the sky-ai staging twin shares nothing with production', () => {
  // The two things that would make a staging test destructive: the live KV and
  // the live flags namespace. Both must be absent.
  assert.ok(!SKY_CONFIG.includes('fd9a455d1be64c2eade1309186462808'), 'not the production PUB_KV');
  assert.ok(!SKY_CONFIG.includes('0fe1817e14f2466b84ac727a4405859c'), 'not the production SKY_FLAGS');
  assert.ok(SKY_CONFIG.includes('36d6cb09f9104693b7d58e1fde07b40c'), 'the staging flags namespace');
  assert.ok(SKY_CONFIG.includes('2827bff9b9974101a305102e1fbd1214'), 'the staging PUB_KV');
});
