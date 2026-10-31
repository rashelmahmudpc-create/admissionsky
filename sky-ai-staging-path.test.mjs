/* F0.3 — "Staging-এ AI টেস্ট পথ": the AI test path on staging.
 *
 * The path has three links and a test is only meaningful if all three hold:
 *   1. sky-ai/wrangler.staging.toml declares the staging twin `sky-ai-staging`,
 *   2. admission-gk-staging binds SKY_AI to that twin (never to live sky-ai),
 *   3. the twin reads and writes ONLY staging KV and the staging AI_STATE object.
 * A break in any link is silent: the route answers 404 or falls back locally, and
 * a "passing" test would be exercising production. These tests pin all three.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const SKY = readFileSync('sky-ai/wrangler.staging.toml', 'utf8');
const APP = readFileSync('wrangler.staging.toml', 'utf8');
const SKY_PROD = readFileSync('sky-ai/wrangler.toml', 'utf8');
const APP_PROD = readFileSync('wrangler.toml', 'utf8');

/** The value of `key = "..."` on the line following `section`, or null. */
const after = (text, section, key) => {
  const i = text.indexOf(section);
  if (i < 0) return null;
  const m = text.slice(i).match(new RegExp(`^\\s*${key}\\s*=\\s*"([^"]+)"`, 'm'));
  return m ? m[1] : null;
};

test('f03-১: the staging twin is its own script, not the production one', () => {
  assert.equal(after(SKY, 'name =', 'name'), 'sky-ai-staging');
  assert.equal(after(SKY_PROD, 'name =', 'name'), 'sky-ai', 'production is unchanged');
});

test('f03-২: admission-gk-staging forwards AI to the staging twin', () => {
  const i = APP.indexOf('binding = "SKY_AI"');
  assert.ok(i > 0, 'the staging app binds SKY_AI');
  assert.equal(after(APP.slice(i), '', 'service'), 'sky-ai-staging',
    'the hop must land on the twin, never on live sky-ai');
});

test('f03-৩: the twin shares no KV with production', () => {
  assert.ok(!SKY.includes('fd9a455d1be64c2eade1309186462808'), 'no production PUB_KV');
  assert.ok(!SKY.includes('0fe1817e14f2466b84ac727a4405859c'), 'no production SKY_FLAGS');
  assert.ok(SKY.includes('2827bff9b9974101a305102e1fbd1214'), 'staging PUB_KV');
  assert.ok(SKY.includes('36d6cb09f9104693b7d58e1fde07b40c'), 'staging SKY_FLAGS');
});

test('f03-৪: the twin resolves AI_STATE to the staging object, not production', () => {
  const i = SKY.indexOf('class_name = "AiStateObject"');
  assert.ok(i > 0, 'the twin binds AI_STATE');
  assert.equal(after(SKY.slice(i), '', 'script_name'), 'admission-gk-staging',
    'a DO id is scoped to the declaring script; production would be admission-gk');
});

test('f03-৫: the staging app declares the AI state object the twin points at', () => {
  assert.ok(APP.includes('class_name = "AiStateObject"'),
    'sky-ai-staging points AI_STATE at admission-gk-staging, so that script must declare it');
  assert.ok(/new_sqlite_classes\s*=\s*\["AiStateObject"\]/.test(APP),
    'and the class must be in a migration, or the binding resolves to nothing');
});

test('f03-৬: the twin has no cron trigger and keeps no production binding', () => {
  assert.ok(!/^\s*crons\s*=/m.test(SKY), 'a staging cron would send real notifications');
  assert.ok(!/^\s*service\s*=\s*"sky-ai"\s*$/m.test(SKY), 'never bind live sky-ai from staging');
});

test('f03-৭: production configs are untouched by F0.3', () => {
  // F0.3 adds a staging twin; it must not quietly move production off sky-ai.
  assert.equal(after(APP_PROD.slice(APP_PROD.indexOf('binding = "SKY_AI"')), '', 'service'), 'sky-ai',
    'production still binds the production AI Worker');
  assert.ok(!APP_PROD.includes('sky-ai-staging'), 'production never mentions the twin');
});

/* F0.3 follow-up (2026-10-31): the two staging scripts bind EACH OTHER, so on a
 * fresh account neither can be deployed first. Both errors were hit live:
 *   sky-ai-staging first  -> 10061 (admission-gk-staging does not declare the class)
 *   admission-gk-staging  -> 10143 (sky-ai-staging does not exist)
 * tools/setup-staging-ai.sh is the order that works. These pin it, because a
 * future edit that "simplifies" the bootstrap back to two steps would fail only
 * on a fresh account, long after anyone remembers why. */

test('f03-৮: the bootstrap strips the AI_STATE binding for the first deploy', () => {
  const sh = readFileSync('tools/setup-staging-ai.sh', 'utf8');
  assert.ok(/AI_STATE/.test(sh), 'it must name the binding it strips');
  assert.ok(/class_name = \\?"AiStateObject\\?"/.test(sh), 'the strip targets the DO binding');
  assert.ok(/wrangler.staging.bootstrap.toml/.test(sh), 'the first deploy uses a stripped config');
});

test('f03-৯: the bootstrap deploys the app before the twin in full', () => {
  const sh = readFileSync('tools/setup-staging-ai.sh', 'utf8');
  const appFirst = sh.indexOf('deploy --config wrangler.staging.toml');
  const twinFull = sh.indexOf('cd sky-ai && $WRANGLER deploy --config wrangler.staging.toml');
  assert.ok(appFirst > 0 && twinFull > 0, 'both full deploys are present');
  assert.ok(appFirst < twinFull,
    'the app must declare AiStateObject before the twin binds it (code 10061 otherwise)');
});

test('f03-১০: the bootstrap seeds the staging internal key, not production', () => {
  const sh = readFileSync('tools/setup-staging-ai.sh', 'utf8');
  assert.ok(sh.includes('2827bff9b9974101a305102e1fbd1214'), 'the staging PUB_KV');
  assert.ok(!sh.includes('fd9a455d1be64c2eade1309186462808'), 'never the production PUB_KV');
  assert.ok(/secret:sky-internal/.test(sh), 'without this key the identity routes fall back silently');
});

test('f03-১১: the deploy workflow warns that it cannot bootstrap a fresh account', () => {
  const wf = readFileSync('.github/workflows/sky-ai-staging-deploy.yml', 'utf8');
  assert.ok(/setup-staging-ai\.sh/.test(wf), 'it points at the bootstrap');
  assert.ok(/10143/.test(wf) && /10061/.test(wf), 'both failure codes are recorded');
});
