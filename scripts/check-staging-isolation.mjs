#!/usr/bin/env node
/* P19, staging isolation guard.
 *
 * A staging config that quietly points at a production resource is worse than no
 * staging config: a test write lands on the owner's live data and nobody sees it
 * until the numbers move. This guard reads wrangler.staging.toml and refuses a
 * deploy when either of these is true:
 *
 *   1. a production resource id or name appears in it, or
 *   2. a REPLACE_ placeholder is still unfilled (setup-staging.sh has not run).
 *
 * It is a hard gate in .github/workflows/deploy-staging.yml and a plain command
 * locally: `npm run check:staging-isolation`.
 */
import { readFileSync } from 'node:fs';

/** The production resources staging must never touch. */
export const PRODUCTION_IDS = [
  'b9353515b098427687afcfb8654ed359', // GK_KV (private agent state)
  'fd9a455d1be64c2eade1309186462808', // PUB_KV (public content, split out 2026-10-26)
  '942828aa82e546d4af11796ef92ab134', // OLD_KV
  '8f7cf101-66a3-437d-bc98-a8984698d7f5', // PROFILE_DB (D1)
];

/** Production resource names. Matched as whole TOML values, not substrings, so
 *  `admission-hub-staging` does not trip the `admission-hub` rule. */
export const PRODUCTION_NAMES = ['admission-profile', 'admission-hub', 'admission-gk'];

const valueOf = (name) => new RegExp(`^\\s*(?:name|database_name|bucket_name)\\s*=\\s*"${name}"\\s*$`, 'm');

/** Every production id found in `text`. Pure. */
export function findProductionIds(text) {
  return PRODUCTION_IDS.filter(id => text.includes(id));
}

/** Every production name found as a whole value in `text`. Pure. */
export function findProductionNames(text) {
  return PRODUCTION_NAMES.filter(name => valueOf(name).test(text));
}

/** Every unfilled placeholder in `text`. Pure. */
export function findPlaceholders(text) {
  return [...new Set(text.match(/REPLACE_[A-Z0-9_]+/g) || [])];
}

/** A cron trigger would make staging send real notifications. Pure. */
export function hasCronTrigger(text) {
  return /^\s*crons\s*=/m.test(text);
}

/**
 * The whole verdict for a config's text. Returns `{ ok, problems }`, `ok` is
 * true only when the config is safe to deploy.
 */
export function checkStagingConfig(text) {
  const problems = [];
  const ids = findProductionIds(text);
  if (ids.length) problems.push(`production resource id(s) present: ${ids.join(', ')}`);
  const names = findProductionNames(text);
  if (names.length) problems.push(`production resource name(s) present: ${names.join(', ')}`);
  const placeholders = findPlaceholders(text);
  if (placeholders.length) problems.push(`unfilled placeholder(s): ${placeholders.join(', ')}, run tools/setup-staging.sh`);
  if (hasCronTrigger(text)) problems.push('a cron trigger is present: staging must not run the notification scheduler');
  return { ok: problems.length === 0, problems };
}

const isMain = process.argv[1] && process.argv[1].endsWith('check-staging-isolation.mjs');
if (isMain) {
  const file = process.argv[2] || 'wrangler.staging.toml';
  let text;
  try { text = readFileSync(file, 'utf8'); }
  catch (e) { console.error(`staging-isolation: cannot read ${file}: ${e.message}`); process.exit(2); }
  const { ok, problems } = checkStagingConfig(text);
  if (!ok) {
    console.error(`staging-isolation: REFUSED, ${file} is not safe to deploy:`);
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log(`staging-isolation: ${file} is isolated from production and fully configured.`);
}
