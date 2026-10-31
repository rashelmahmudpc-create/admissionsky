/* F1 — run the routing set against the real classifier and print the score.
 *
 * A deliberate, separate run (like F0.6's run-baseline.mjs): it imports the
 * Worker bundle, so it is not part of the fast hermetic test suite. The test
 * suite pins the yardstick; this prints the number.
 *
 *   node sky-ai/routing/run-accuracy.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { score } from './score.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..');
const which = process.argv[2] || 'routing-set-v1.json';
const set = JSON.parse(readFileSync(join(HERE, which), 'utf8'));
const A = await import(join(REPO, 'ai-agent.js'));
const TR = await import(join(REPO, 'ai-tier-router.mjs'));

const res = score(set, { classifyIntent: A.classifyIntent, routeTier: TR.routeTier });
const pct = (x) => (x * 100).toFixed(1) + '%';
console.log(`routing accuracy: ${res.ok}/${res.n} = ${pct(res.accuracy)} (bar ${pct(res.bar)}) -> ${res.pass ? 'PASS' : 'FAIL'}`);
console.log('by intent:');
for (const [k, v] of Object.entries(res.byIntent)) console.log(`  ${k.padEnd(20)} ${v.ok}/${v.n}`);
console.log('by tier:');
for (const [k, v] of Object.entries(res.byTier)) console.log(`  ${k.padEnd(20)} ${v.ok}/${v.n}`);
if (res.misses.length) {
  console.log(`\nmisses (${res.misses.length}):`);
  for (const m of res.misses) {
    console.log(`  ${m.id} "${m.q}" -> got ${m.got.intent}/${m.got.tier}, want ${m.want.intent}/${m.want.tier} (${m.why})`);
  }
}
process.exit(res.pass ? 0 : 1);
