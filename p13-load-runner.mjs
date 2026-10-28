/* P13, repeatable load test for the public read path.
 *
 *   node p13-load-runner.mjs                    # simulated, always runnable
 *   LOAD_URL=https://admission-gk.../api/content node p13-load-runner.mjs
 *
 * With LOAD_URL set it issues real GETs (bounded, read-only) and asserts the
 * p95 latency and error-rate budgets; without it, it proves the harness itself
 * on a deterministic model. Exits non-zero on a blown budget, so it can guard
 * a deploy the same way the unit tests do.
 */
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('./p13-load-harness.js', import.meta.url), 'utf8');
const { run, fakeRequests } = new Function('self', `${src}\nreturn self.AhP13Load;`)({});

const USERS = Number(process.env.LOAD_USERS || 50);
const PER_USER = Number(process.env.LOAD_PER_USER || 4);
const CONCURRENCY = Number(process.env.LOAD_CONCURRENCY || 20);
const P95_BUDGET = Number(process.env.LOAD_P95_MS || 800);
const ERROR_BUDGET = Number(process.env.LOAD_ERROR_RATE || 0.01);
const URL_UNDER_TEST = process.env.LOAD_URL || '';

async function main() {
  const real = URL_UNDER_TEST
    ? { request: async () => { const r = await fetch(URL_UNDER_TEST, { headers: { 'X-AH-App': 'admission-hub' } }); if (!r.ok) throw new Error('HTTP ' + r.status); return r; } }
    : fakeRequests({ baseMs: 30, jitterMs: 120, failRate: 0.002, seed: 20261010 });

  const res = await run({ users: USERS, perUser: PER_USER, concurrency: CONCURRENCY, request: real.request, now: real.now, budget: { p95: P95_BUDGET, errorRate: ERROR_BUDGET } });
  const s = res.summary;
  console.log(`load: ${URL_UNDER_TEST || 'simulated'}, ${s.total} reqs, ${s.errors} errors (${(s.errorRate * 100).toFixed(2)}%)`);
  console.log(`load: p50 ${s.p50.toFixed(0)}ms  p95 ${s.p95.toFixed(0)}ms  p99 ${s.p99.toFixed(0)}ms  max ${s.max.toFixed(0)}ms`);
  console.log(`load: budget p95<=${P95_BUDGET}ms err<=${(ERROR_BUDGET * 100).toFixed(2)}% -> ${res.pass ? 'PASS' : 'FAIL'}`);
  process.exit(res.pass ? 0 : 1);
}

main().catch(e => { console.error('load runner error:', e && e.message); process.exit(1); });
